//! Electron ASAR 归档解析、快速切片探测与完整 SHA-256 integrity 重打包模块。
//! 算法与 tools/patch-asar.cjs 保持 100% 等价，确保 Antigravity Desktop ASAR 校验零告警。

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const DEFAULT_BLOCK_SIZE: usize = 4 * 1024 * 1024; // 4MB

/// ASAR 文件头信息与数据区偏移
pub struct AsarHeaderInfo {
    pub root: Value,
    pub data_start: u64,
}

/// 计算指定字节切片的 ASAR SHA-256 完整性校验块（全量 hash + 4MB 分块 blocks）
pub fn compute_integrity(data: &[u8], block_size: usize) -> Value {
    let effective_block = if block_size == 0 {
        DEFAULT_BLOCK_SIZE
    } else {
        block_size
    };
    let full_hash = hex::encode(Sha256::digest(data));
    let mut blocks = Vec::new();
    if data.is_empty() {
        blocks.push(hex::encode(Sha256::digest([])));
    } else {
        for chunk in data.chunks(effective_block) {
            blocks.push(hex::encode(Sha256::digest(chunk)));
        }
    }
    serde_json::json!({
        "algorithm": "SHA256",
        "hash": full_hash,
        "blockSize": effective_block,
        "blocks": blocks,
    })
}

/// 仅解析 ASAR 文件头部 JSON（不读取整个百兆 payload），供 SessionStart 钩子毫秒级探测使用
pub fn read_asar_header_only(asar_path: &Path) -> Result<AsarHeaderInfo, String> {
    let mut file = File::open(asar_path).map_err(|e| format!("打开 ASAR 失败: {e}"))?;
    let mut prefix = [0u8; 16];
    file.read_exact(&mut prefix)
        .map_err(|e| format!("读取 ASAR Pickle 头失败: {e}"))?;

    let header_size = u32::from_le_bytes(prefix[4..8].try_into().unwrap()) as u64;
    let json_len = u32::from_le_bytes(prefix[12..16].try_into().unwrap()) as usize;
    let data_start = 8 + header_size;

    let mut json_buf = vec![0u8; json_len];
    file.read_exact(&mut json_buf)
        .map_err(|e| format!("读取 ASAR 头部 JSON 失败: {e}"))?;
    let root: Value =
        serde_json::from_slice(&json_buf).map_err(|e| format!("解析 ASAR 头部 JSON 失败: {e}"))?;

    Ok(AsarHeaderInfo { root, data_start })
}

/// 在 ASAR 头树中按相对路径查找条目（例如 "dist/preload.js"）
pub fn find_entry<'a>(root: &'a Value, rel_path: &str) -> Option<&'a Value> {
    let mut cur = root;
    for part in rel_path.split('/') {
        cur = cur.get("files")?.get(part)?;
    }
    Some(cur)
}

/// 从磁盘上的 ASAR 文件按偏移 seek 读取单个内嵌文件文本（避免读入整个 ASAR）
pub fn read_entry_text_by_seek(asar_path: &Path, rel_path: &str) -> Result<String, String> {
    let info = read_asar_header_only(asar_path)?;
    let entry = find_entry(&info.root, rel_path)
        .ok_or_else(|| format!("ASAR 中未找到条目: {rel_path}"))?;
    let offset = entry
        .get("offset")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| format!("条目 {rel_path} 缺少有效 offset"))?;
    let size = entry
        .get("size")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("条目 {rel_path} 缺少有效 size"))?;

    let mut file = File::open(asar_path).map_err(|e| format!("打开 ASAR 失败: {e}"))?;
    file.seek(SeekFrom::Start(info.data_start + offset))
        .map_err(|e| format!("定位 ASAR 条目失败: {e}"))?;
    let mut buf = vec![0u8; size as usize];
    file.read_exact(&mut buf)
        .map_err(|e| format!("读取 ASAR 条目内容失败: {e}"))?;
    String::from_utf8(buf).map_err(|e| format!("ASAR 条目不是有效 UTF-8: {e}"))
}

/// 从内存字节解析 ASAR 头部和 payload 切片
pub fn parse_asar_buffer(asar_bytes: &[u8]) -> Result<(Value, &[u8]), String> {
    if asar_bytes.len() < 16 {
        return Err("ASAR 文件过小".to_string());
    }
    let header_size = u32::from_le_bytes(asar_bytes[4..8].try_into().unwrap()) as usize;
    let json_len = u32::from_le_bytes(asar_bytes[12..16].try_into().unwrap()) as usize;
    let data_start = 8 + header_size;
    if 16 + json_len > asar_bytes.len() || data_start > asar_bytes.len() {
        return Err("ASAR 头部长度越界".to_string());
    }
    let root: Value = serde_json::from_slice(&asar_bytes[16..16 + json_len])
        .map_err(|e| format!("解析 ASAR JSON 失败: {e}"))?;
    Ok((root, &asar_bytes[data_start..]))
}

/// 将修改后的头树与 payload 分片重新编码为标准 Electron ASAR 字节流
pub fn build_asar_buffer(root: &Value, chunks: &[&[u8]]) -> Result<Vec<u8>, String> {
    let header_json = serde_json::to_vec(root).map_err(|e| format!("序列化 ASAR JSON 失败: {e}"))?;
    let json_len = header_json.len();
    let aligned_json_len = ((json_len + 3) / 4) * 4;
    let header_size = aligned_json_len + 8;

    let total_payload: usize = chunks.iter().map(|c| c.len()).sum();
    let mut out = Vec::with_capacity(16 + aligned_json_len + total_payload);

    out.extend_from_slice(&4u32.to_le_bytes());
    out.extend_from_slice(&(header_size as u32).to_le_bytes());
    out.extend_from_slice(&((header_size - 4) as u32).to_le_bytes());
    out.extend_from_slice(&(json_len as u32).to_le_bytes());
    out.extend_from_slice(&header_json);
    if aligned_json_len > json_len {
        out.resize(16 + aligned_json_len, 0);
    }
    for chunk in chunks {
        out.extend_from_slice(chunk);
    }
    Ok(out)
}

/// 递归重打包 ASAR 目录树：应用替换表与删除表，重算全部偏移量和 SHA-256 校验块
pub fn repack_asar<'a>(
    mut root: Value,
    orig_payload: &'a [u8],
    replacements: &'a BTreeMap<String, Vec<u8>>,
    removed_paths: &HashSet<String>,
) -> Result<Vec<u8>, String> {
    let mut chunks: Vec<&'a [u8]> = Vec::new();
    let mut offset: u64 = 0;

    fn walk<'a>(
        node: &mut Value,
        orig_payload: &'a [u8],
        current_path: &str,
        replacements: &'a BTreeMap<String, Vec<u8>>,
        removed_paths: &HashSet<String>,
        chunks: &mut Vec<&'a [u8]>,
        offset: &mut u64,
    ) -> Result<(), String> {
        let Some(obj) = node.as_object_mut() else {
            return Ok(());
        };
        let Some(files_val) = obj.get_mut("files") else {
            return Ok(());
        };
        let Some(files_map) = files_val.as_object_mut() else {
            return Ok(());
        };

        let keys: Vec<String> = files_map.keys().cloned().collect();
        let mut kept_map = Map::new();

        for name in keys {
            let Some(mut child) = files_map.remove(&name) else {
                continue;
            };
            let rel_path = if current_path.is_empty() {
                name.clone()
            } else {
                format!("{current_path}/{name}")
            };

            if removed_paths.contains(&rel_path) {
                continue;
            }

            if child.get("files").is_some() {
                walk(
                    &mut child,
                    orig_payload,
                    &rel_path,
                    replacements,
                    removed_paths,
                    chunks,
                    offset,
                )?;
                kept_map.insert(name, child);
                continue;
            }

            let is_unpacked = child
                .get("unpacked")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let has_offset = child.get("offset").is_some();
            let old_size = child.get("size").and_then(|v| v.as_u64());

            if !is_unpacked && has_offset && old_size.is_some() {
                let slice: &'a [u8] = if let Some(new_buf) = replacements.get(&rel_path) {
                    new_buf.as_slice()
                } else {
                    let old_off = child
                        .get("offset")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<usize>().ok())
                        .ok_or_else(|| format!("条目 {rel_path} offset 非法"))?;
                    let sz = old_size.unwrap() as usize;
                    if old_off + sz > orig_payload.len() {
                        return Err(format!("条目 {rel_path} 越界"));
                    }
                    &orig_payload[old_off..old_off + sz]
                };

                if let Some(child_obj) = child.as_object_mut() {
                    child_obj.insert("offset".to_string(), Value::String(offset.to_string()));
                    child_obj.insert("size".to_string(), Value::from(slice.len() as u64));
                    if let Some(integrity) = child_obj.get("integrity") {
                        let block_size = integrity
                            .get("blockSize")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(DEFAULT_BLOCK_SIZE as u64) as usize;
                        child_obj.insert(
                            "integrity".to_string(),
                            compute_integrity(slice, block_size),
                        );
                    }
                }
                chunks.push(slice);
                *offset += slice.len() as u64;
            }

            kept_map.insert(name, child);
        }

        *files_map = kept_map;
        Ok(())
    }

    walk(
        &mut root,
        orig_payload,
        "",
        replacements,
        removed_paths,
        &mut chunks,
        &mut offset,
    )?;

    build_asar_buffer(&root, &chunks)
}

/// 写盘前内存自检：回读解析新生成的 ASAR 字节流，验证头部、关键条目可读性与 SHA-256 完整性
pub fn verify_asar_buffer(asar_bytes: &[u8], required_entries: &[&str]) -> Result<(), String> {
    let (root, payload) = parse_asar_buffer(asar_bytes)?;
    for rel_path in required_entries {
        let entry = find_entry(&root, rel_path)
            .ok_or_else(|| format!("ASAR 自检失败：缺少必要条目 {rel_path}"))?;
        let offset = entry
            .get("offset")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<usize>().ok())
            .ok_or_else(|| format!("ASAR 自检失败：{rel_path} offset 非法"))?;
        let size = entry
            .get("size")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| format!("ASAR 自检失败：{rel_path} size 非法"))? as usize;
        if offset + size > payload.len() {
            return Err(format!("ASAR 自检失败：{rel_path} 数据越界"));
        }
        let slice = &payload[offset..offset + size];
        if std::str::from_utf8(slice).is_err() {
            return Err(format!("ASAR 自检失败：{rel_path} 不是有效 UTF-8"));
        }
        if let Some(expected_hash) = entry
            .get("integrity")
            .and_then(|i| i.get("hash"))
            .and_then(|h| h.as_str())
        {
            let actual = hex::encode(Sha256::digest(slice));
            if !actual.eq_ignore_ascii_case(expected_hash) {
                return Err(format!("ASAR 自检失败：{rel_path} SHA-256 不匹配"));
            }
        }
    }
    Ok(())
}
