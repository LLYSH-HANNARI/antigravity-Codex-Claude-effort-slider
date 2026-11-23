//! 补丁安装、修复、状态探测、延时文件替换与彻底卸载模块。

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::asar;
use crate::loader;
use crate::paths;
use crate::state::{self, PluginState, BUNDLED_VERSION, LOADER_VERSION};

/// 内嵌编译时的最新版 lib/client.js，使单文件安装器无需额外附件即可离线安装
pub const BUNDLED_CLIENT_JS: &str = include_str!("../../lib/client.js");

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;

/// 安装/修复操作汇总结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationReport {
    pub ok: bool,
    pub messages: Vec<String>,
    pub deferred_targets: Vec<String>,
    pub errors: Vec<String>,
}

/// 只读环境状态报告
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub plugin_root: String,
    pub plugin_installed: bool,
    pub installed_version: Option<String>,
    pub auto_update: bool,
    pub mirror_prefix: String,
    pub pending_update_version: Option<String>,
    pub desktop_targets: Vec<DesktopStatus>,
    pub ide_targets: Vec<IdeStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    pub path: String,
    pub patched: bool,
    pub loader_version: Option<u32>,
    pub has_staged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeStatus {
    pub path: String,
    pub patched: bool,
    pub loader_version: Option<u32>,
}

/// 清理上次运行中替换二进制留下的 `.old` 残留文件
pub fn cleanup_old_binary() {
    let bin = paths::installed_binary_path();
    let old = old_binary_path(&bin);
    if old.exists() {
        let _ = fs::remove_file(old);
    }
}

pub fn old_binary_path(bin: &Path) -> PathBuf {
    let mut os_str = bin.as_os_str().to_os_string();
    os_str.push(".old");
    PathBuf::from(os_str)
}

/// 脱离父进程与控制台窗口，后台异步启动已安装的自身二进制
pub fn spawn_detached_self(args: &[&str]) -> bool {
    if cfg!(test) || env::var("AG_SLIDER_SKIP_DETACHED_SPAWN").as_deref() == Ok("1") {
        return true;
    }
    let exe = {
        let installed = paths::installed_binary_path();
        if installed.exists() {
            installed
        } else if let Ok(cur) = env::current_exe() {
            cur
        } else {
            return false;
        }
    };

    let mut cmd = Command::new(exe);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    cmd.spawn().is_ok()
}

/// 原子写入文本或二进制文件（写入同目录 `.tmp` 后替换）
pub fn atomic_write_bytes(target: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    }
    let mut tmp_name = target.as_os_str().to_os_string();
    tmp_name.push(".tmp");
    let tmp_path = PathBuf::from(tmp_name);
    fs::write(&tmp_path, data).map_err(|e| format!("写入临时文件失败 {}: {e}", tmp_path.display()))?;
    if target.exists() {
        if let Err(err) = fs::remove_file(target) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("移除旧文件失败 {}: {err}", target.display()));
        }
    }
    fs::rename(&tmp_path, target).map_err(|e| format!("重命名落盘失败 {}: {e}", target.display()))?;
    Ok(())
}

/// 写入 Antigravity 原生插件清单 (`plugin.json`) 与 `SessionStart` 自愈钩子 (`hooks.json`)
pub fn write_plugin_metadata(version: &str) -> Result<(), String> {
    let root = paths::plugin_root();
    fs::create_dir_all(&root).map_err(|e| format!("创建插件目录失败: {e}"))?;

    let plugin_json = serde_json::json!({
        "name": "antigravity-effort-slider",
        "displayName": "Codex & Claude 推理等级滑条",
        "version": version,
        "description": "Codex 风格物理推理等级滑条与 Claude 像素点阵滑条（支持 GitHub Release 自动更新与官方更新后自动修复）",
        "homepage": "https://llysh-hannari.github.io/antigravity-Codex-Claude-effort-slider/",
        "repository": {
            "type": "git",
            "url": "https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider.git"
        }
    });
    let plugin_bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(&plugin_json).map_err(|e| e.to_string())?
    );
    atomic_write_bytes(&paths::plugin_json_path(), plugin_bytes.as_bytes())?;

    let hook_cmd = if cfg!(windows) {
        ".\\bin\\ag-effort-slider.exe hook session-start"
    } else {
        "./bin/ag-effort-slider hook session-start"
    };
    let hooks_json = serde_json::json!({
        "effort-slider-auto-heal": {
            "SessionStart": [
                {
                    "type": "command",
                    "command": hook_cmd,
                    "timeout": 10
                }
            ]
        }
    });
    let hooks_bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(&hooks_json).map_err(|e| e.to_string())?
    );
    atomic_write_bytes(&paths::hooks_json_path(), hooks_bytes.as_bytes())?;
    Ok(())
}

/// 将当前二进制部署到 `<plugin_root>/bin/ag-effort-slider(.exe)`
fn deploy_self_binary() -> Result<(), String> {
    let target = paths::installed_binary_path();
    let bin_dir = paths::bin_dir();
    fs::create_dir_all(&bin_dir).map_err(|e| format!("创建 bin 目录失败: {e}"))?;

    let Ok(current) = env::current_exe() else {
        return Ok(());
    };
    let cur_canon = fs::canonicalize(&current).unwrap_or_else(|_| current.clone());
    let tgt_canon = fs::canonicalize(&target).unwrap_or_else(|_| target.clone());
    if cur_canon == tgt_canon {
        return Ok(());
    }

    if target.exists() {
        let old = old_binary_path(&target);
        let _ = fs::remove_file(&old);
        if fs::rename(&target, &old).is_err() {
            let _ = fs::remove_file(&target);
        }
    }
    fs::copy(&current, &target)
        .map_err(|e| format!("复制安装器到插件目录失败 {}: {e}", target.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&target) {
            let mut perm = meta.permissions();
            perm.set_mode(0o755);
            let _ = fs::set_permissions(&target, perm);
        }
    }
    Ok(())
}

/// 解析待安装的 client.js 内容与版本号
fn resolve_client_payload(custom_client_path: Option<&Path>) -> Result<(String, String), String> {
    let code = if let Some(p) = custom_client_path {
        fs::read_to_string(p).map_err(|e| format!("读取指定 client.js 失败 {}: {e}", p.display()))?
    } else if paths::client_js_path().exists() && custom_client_path.is_none() {
        // 若插件目录已有更新过的版本且未强制指定，仍优先用内置最新（首次安装或修复）；
        // 但在 repair 模式下会调用 repair_loaders_only 保留现有 client.js。
        BUNDLED_CLIENT_JS.to_string()
    } else {
        BUNDLED_CLIENT_JS.to_string()
    };

    let version = extract_client_version(&code).unwrap_or_else(|| BUNDLED_VERSION.to_string());
    Ok((code, version))
}

fn extract_client_version(client_js: &str) -> Option<String> {
    for marker in ["PLUGIN_VERSION = \"", "antigravity-codex-effort-slider@"] {
        if let Some(idx) = client_js.find(marker) {
            let rest = &client_js[idx + marker.len()..];
            if let Some(end) = rest.find('"') {
                let ver = rest[..end].trim();
                if !ver.is_empty() {
                    return Some(ver.to_string());
                }
            }
        }
    }
    None
}

/// 完整安装：部署插件目录 + 写入/升级引导器（Desktop app.asar 与 IDE extension.js）
pub fn install_all(custom_asar: Option<&Path>, custom_client: Option<&Path>) -> OperationReport {
    let mut report = OperationReport {
        ok: true,
        messages: Vec::new(),
        deferred_targets: Vec::new(),
        errors: Vec::new(),
    };

    cleanup_old_binary();

    let (client_code, client_version) = match resolve_client_payload(custom_client) {
        Ok(v) => v,
        Err(e) => {
            report.ok = false;
            report.errors.push(e);
            return report;
        }
    };

    if let Err(e) = deploy_self_binary() {
        report.ok = false;
        report.errors.push(e);
        return report;
    }
    if let Err(e) = atomic_write_bytes(&paths::client_js_path(), client_code.as_bytes()) {
        report.ok = false;
        report.errors.push(e);
        return report;
    }
    if let Err(e) = write_plugin_metadata(&client_version) {
        report.ok = false;
        report.errors.push(e);
        return report;
    }

    let mut st = state::load_state();
    st.version = client_version.clone();
    st.loader_version = LOADER_VERSION;
    st.pending_update_version = None;
    st.pending_update_notes = None;
    st.pending_loader_upgrade = false;
    if let Err(e) = state::save_state(&st) {
        report.errors.push(e);
    }
    report.messages.push(format!(
        "已部署原生插件目录 (v{client_version}): {}",
        paths::plugin_root().display()
    ));

    apply_loaders_to_targets(custom_asar, &client_code, &mut report);
    report
}

/// 仅修复/升级 Desktop 与 IDE 引导器（不覆盖当前已更新的 lib/client.js）
pub fn repair_loaders_only(custom_asar: Option<&Path>) -> OperationReport {
    let mut report = OperationReport {
        ok: true,
        messages: Vec::new(),
        deferred_targets: Vec::new(),
        errors: Vec::new(),
    };
    cleanup_old_binary();

    let fallback_code = fs::read_to_string(paths::client_js_path())
        .unwrap_or_else(|_| BUNDLED_CLIENT_JS.to_string());
    let ver = extract_client_version(&fallback_code).unwrap_or_else(|| BUNDLED_VERSION.to_string());
    let _ = write_plugin_metadata(&ver);

    apply_loaders_to_targets(custom_asar, &fallback_code, &mut report);

    let mut st = state::load_state();
    st.loader_version = LOADER_VERSION;
    let _ = state::save_state(&st);
    report
}

fn apply_loaders_to_targets(
    custom_asar: Option<&Path>,
    fallback_client_js: &str,
    report: &mut OperationReport,
) {
    let plugin_root = paths::plugin_root();

    // 1. 修补 Antigravity Desktop app.asar
    let asars = paths::find_desktop_asar_paths(custom_asar);
    if asars.is_empty() && custom_asar.is_some() {
        report.ok = false;
        report.errors.push(format!(
            "未找到指定的 app.asar: {}",
            custom_asar.unwrap().display()
        ));
    }
    for asar_path in asars {
        if !asar_path.exists() {
            report.ok = false;
            report.errors.push(format!("未找到目标文件: {}", asar_path.display()));
            continue;
        }
        match patch_desktop_asar(&asar_path, &plugin_root, fallback_client_js) {
            Ok(PatchWriteOutcome::Written) => {
                report
                    .messages
                    .push(format!("[Desktop] 已写入动态引导器: {}", asar_path.display()));
            }
            Ok(PatchWriteOutcome::Deferred(staged)) => {
                report.deferred_targets.push(staged.to_string_lossy().to_string());
                report.messages.push(format!(
                    "[Desktop] 文件正在被占用，已生成待替换包 {}，后台守护进程将在客户端退出后自动完成替换。",
                    staged.display()
                ));
            }
            Err(e) => {
                report.ok = false;
                report.errors.push(format!("[Desktop] 处理失败 ({}): {e}", asar_path.display()));
            }
        }
    }

    // 2. 清理 IDE 历史遗留注入并修补 extension.js
    for legacy_path in paths::find_ide_legacy_files() {
        let bak = bak_path(&legacy_path, ".codex.bak");
        if bak.exists() {
            if fs::copy(&bak, &legacy_path).is_ok() {
                report
                    .messages
                    .push(format!("[IDE] 已还原历史注入文件: {}", legacy_path.display()));
            }
        } else if let Ok(cur) = fs::read_to_string(&legacy_path) {
            let cleaned = loader::strip_marker_block(
                &cur,
                loader::PRELOAD_PATCH_START,
                loader::PRELOAD_PATCH_END,
            );
            if cleaned != cur && fs::write(&legacy_path, cleaned).is_ok() {
                report
                    .messages
                    .push(format!("[IDE] 已清理历史补丁标记: {}", legacy_path.display()));
            }
        }
    }

    for ext_path in paths::find_ide_extension_files() {
        match patch_ide_extension(&ext_path, &plugin_root, fallback_client_js) {
            Ok(()) => {
                report
                    .messages
                    .push(format!("[IDE] 已写入动态代理引导器: {}", ext_path.display()));
            }
            Err(e) => {
                report.ok = false;
                report.errors.push(format!("[IDE] 处理失败 ({}): {e}", ext_path.display()));
            }
        }
    }

    for ide_root in paths::find_ide_roots() {
        if let Err(e) = sync_ide_product_checksums(&ide_root.join("product.json"), false) {
            report
                .errors
                .push(format!("[IDE] 校验同步警告 ({}): {e}", ide_root.display()));
        }
    }
    clear_ide_code_cache();
}

enum PatchWriteOutcome {
    Written,
    Deferred(PathBuf),
}

fn patch_desktop_asar(
    asar_path: &Path,
    plugin_root: &Path,
    fallback_client_js: &str,
) -> Result<PatchWriteOutcome, String> {
    let bak = bak_path(asar_path, ".bak");
    if !bak.exists() {
        fs::copy(asar_path, &bak).map_err(|e| format!("创建备份失败: {e}"))?;
    }

    // 优先基于干净备份（或剥离旧补丁后的当前包）进行重打包
    let source_path = if bak.exists() { bak.as_path() } else { asar_path };
    let raw = fs::read(source_path).map_err(|e| format!("读取 ASAR 失败: {e}"))?;
    let (root, payload) = asar::parse_asar_buffer(&raw)?;

    let main_entry = asar::find_entry(&root, "dist/main.js")
        .ok_or_else(|| "未在 app.asar 中找到 dist/main.js".to_string())?;
    let preload_entry = asar::find_entry(&root, "dist/preload.js")
        .ok_or_else(|| "未在 app.asar 中找到 dist/preload.js".to_string())?;

    let orig_main = read_payload_utf8(payload, main_entry, "dist/main.js")?;
    let orig_preload = read_payload_utf8(payload, preload_entry, "dist/preload.js")?;

    let patched_main = loader::apply_desktop_main_patch(&orig_main, plugin_root, fallback_client_js);
    let patched_preload = loader::apply_desktop_preload_patch(&orig_preload);

    let mut replacements = BTreeMap::new();
    replacements.insert("dist/main.js".to_string(), patched_main.into_bytes());
    replacements.insert("dist/preload.js".to_string(), patched_preload.into_bytes());

    let mut removed = HashSet::new();
    removed.insert("dist/antigravity-codex-effort-slider.js".to_string());

    let out_buf = asar::repack_asar(root, payload, &replacements, &removed)?;
    try_write_asar_atomically(asar_path, &out_buf)
}

fn read_payload_utf8(payload: &[u8], entry: &Value, name: &str) -> Result<String, String> {
    let offset = entry
        .get("offset")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or_else(|| format!("{name} 缺少 offset"))?;
    let size = entry
        .get("size")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("{name} 缺少 size"))? as usize;
    if offset + size > payload.len() {
        return Err(format!("{name} 越界"));
    }
    String::from_utf8(payload[offset..offset + size].to_vec())
        .map_err(|e| format!("{name} UTF-8 解码失败: {e}"))
}

fn try_write_asar_atomically(target: &Path, buffer: &[u8]) -> Result<PatchWriteOutcome, String> {
    let staged = bak_path(target, ".codex-staged");
    fs::write(&staged, buffer).map_err(|e| format!("写入 staged 包失败: {e}"))?;
    match fs::copy(&staged, target) {
        Ok(_) => {
            let _ = fs::remove_file(&staged);
            Ok(PatchWriteOutcome::Written)
        }
        Err(_) => {
            let staged_str = staged.to_string_lossy().to_string();
            let target_str = target.to_string_lossy().to_string();
            let _ = spawn_detached_self(&["deferred-swap", "--staged", &staged_str, "--target", &target_str]);
            Ok(PatchWriteOutcome::Deferred(staged))
        }
    }
}

fn patch_ide_extension(
    ext_path: &Path,
    plugin_root: &Path,
    fallback_client_js: &str,
) -> Result<(), String> {
    let bak = bak_path(ext_path, ".codex.bak");
    let cur = fs::read_to_string(ext_path).map_err(|e| format!("读取失败: {e}"))?;
    let clean_base = loader::strip_marker_block(
        &cur,
        loader::IDE_PATCH_START,
        loader::IDE_PATCH_END,
    );
    if !bak.exists() {
        fs::write(&bak, &clean_base).map_err(|e| format!("备份失败: {e}"))?;
    }
    let patched = loader::apply_ide_extension_patch(&clean_base, plugin_root, fallback_client_js);
    fs::write(ext_path, patched).map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

/// 同步或还原 IDE `product.json` 的 SHA-256 Base64 校验表
pub fn sync_ide_product_checksums(product_json_path: &Path, is_uninstall: bool) -> Result<(), String> {
    if !product_json_path.exists() {
        return Ok(());
    }
    let app_root = product_json_path
        .parent()
        .ok_or_else(|| "无效的 product.json 路径".to_string())?;
    let bak = bak_path(product_json_path, ".codex.bak");

    if is_uninstall && bak.exists() {
        fs::copy(&bak, product_json_path).map_err(|e| format!("还原 product.json 失败: {e}"))?;
        let _ = fs::remove_file(&bak);
        return Ok(());
    }

    let raw_text = fs::read_to_string(product_json_path).map_err(|e| format!("读取 product.json 失败: {e}"))?;
    if !is_uninstall && !bak.exists() {
        fs::write(&bak, &raw_text).map_err(|e| format!("备份 product.json 失败: {e}"))?;
    }

    let mut product: Value = serde_json::from_str(&raw_text).map_err(|e| format!("解析 product.json 失败: {e}"))?;
    let Some(checksums) = product.get_mut("checksums").and_then(|v| v.as_object_mut()) else {
        return Ok(());
    };

    let mut updated = 0usize;
    let keys: Vec<String> = checksums.keys().cloned().collect();
    for rel_key in keys {
        let mut disk_file = app_root.join("out");
        for seg in rel_key.split('/') {
            disk_file.push(seg);
        }
        if !disk_file.exists() {
            continue;
        }
        if let Ok(bytes) = fs::read(&disk_file) {
            let hash_b64 = STANDARD_NO_PAD.encode(Sha256::digest(&bytes));
            if checksums.get(&rel_key).and_then(|v| v.as_str()) != Some(&hash_b64) {
                checksums.insert(rel_key, Value::String(hash_b64));
                updated += 1;
            }
        }
    }

    if updated > 0 {
        let formatted = format!(
            "{}\n",
            serde_json::to_string_pretty(&product).map_err(|e| e.to_string())?
        );
        fs::write(product_json_path, formatted).map_err(|e| format!("更新 product.json 失败: {e}"))?;
    }
    Ok(())
}

fn clear_ide_code_cache() {
    if let Some(dir) = paths::ide_cached_data_dir() {
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
    }
}

/// 完全卸载：还原官方原版 app.asar 与 IDE 文件，并清除原生插件目录（保留浏览器 localStorage 偏好）
pub fn uninstall_all(custom_asar: Option<&Path>) -> OperationReport {
    let mut report = OperationReport {
        ok: true,
        messages: Vec::new(),
        deferred_targets: Vec::new(),
        errors: Vec::new(),
    };

    // 1. 还原 Desktop app.asar
    for asar_path in paths::find_desktop_asar_paths(custom_asar) {
        if !asar_path.exists() {
            continue;
        }
        let bak = bak_path(&asar_path, ".bak");
        let source = if bak.exists() { bak.as_path() } else { asar_path.as_path() };
        match restore_desktop_asar(source, &asar_path) {
            Ok(PatchWriteOutcome::Written) => {
                report
                    .messages
                    .push(format!("[Desktop] 已还原纯净 app.asar: {}", asar_path.display()));
            }
            Ok(PatchWriteOutcome::Deferred(staged)) => {
                report.deferred_targets.push(staged.to_string_lossy().to_string());
                report.messages.push(format!(
                    "[Desktop] 文件占用中，已生成还原包 {}，关闭客户端后将自动恢复。",
                    staged.display()
                ));
            }
            Err(e) => {
                report.ok = false;
                report.errors.push(format!("[Desktop] 还原失败 ({}): {e}", asar_path.display()));
            }
        }
    }

    // 2. 还原 IDE 文件与校验表
    for ext_path in paths::find_ide_extension_files() {
        let bak = bak_path(&ext_path, ".codex.bak");
        if bak.exists() {
            if let Err(e) = fs::copy(&bak, &ext_path) {
                report.errors.push(format!("[IDE] 还原失败: {e}"));
            } else {
                let _ = fs::remove_file(&bak);
                report
                    .messages
                    .push(format!("[IDE] 已还原扩展文件: {}", ext_path.display()));
            }
        } else if let Ok(cur) = fs::read_to_string(&ext_path) {
            let cleaned = loader::strip_marker_block(&cur, loader::IDE_PATCH_START, loader::IDE_PATCH_END);
            if cleaned != cur && fs::write(&ext_path, cleaned).is_ok() {
                report
                    .messages
                    .push(format!("[IDE] 已移除扩展补丁: {}", ext_path.display()));
            }
        }
    }

    for ide_root in paths::find_ide_roots() {
        let _ = sync_ide_product_checksums(&ide_root.join("product.json"), true);
    }
    clear_ide_code_cache();

    // 3. 清除插件目录（若当前运行的正是目录内二进制，Windows 上先清理其余文件并跳过自删错误）
    let plugin_root = paths::plugin_root();
    if plugin_root.exists() {
        if fs::remove_dir_all(&plugin_root).is_ok() {
            report
                .messages
                .push(format!("已移除原生插件目录: {}", plugin_root.display()));
        } else {
            // 逐个删除非锁定文件
            for sub in ["lib", "plugin.json", "hooks.json", "state.json"] {
                let p = plugin_root.join(sub);
                if p.is_dir() {
                    let _ = fs::remove_dir_all(&p);
                } else if p.is_file() {
                    let _ = fs::remove_file(&p);
                }
            }
            report.messages.push(format!(
                "已清理插件配置与脚本（bin 目录因自身占用将在退出后可手动删除）: {}",
                plugin_root.display()
            ));
        }
    }

    report
}

fn restore_desktop_asar(source: &Path, target: &Path) -> Result<PatchWriteOutcome, String> {
    let raw = fs::read(source).map_err(|e| format!("读取 ASAR 失败: {e}"))?;
    let (root, payload) = asar::parse_asar_buffer(&raw)?;

    let mut replacements = BTreeMap::new();
    if let Some(main_entry) = asar::find_entry(&root, "dist/main.js") {
        let cur = read_payload_utf8(payload, main_entry, "dist/main.js")?;
        let cleaned = loader::strip_marker_block(&cur, loader::MAIN_PATCH_START, loader::MAIN_PATCH_END);
        replacements.insert("dist/main.js".to_string(), cleaned.into_bytes());
    }
    if let Some(preload_entry) = asar::find_entry(&root, "dist/preload.js") {
        let cur = read_payload_utf8(payload, preload_entry, "dist/preload.js")?;
        let cleaned =
            loader::strip_marker_block(&cur, loader::PRELOAD_PATCH_START, loader::PRELOAD_PATCH_END);
        replacements.insert("dist/preload.js".to_string(), cleaned.into_bytes());
    }
    let mut removed = HashSet::new();
    removed.insert("dist/antigravity-codex-effort-slider.js".to_string());

    let restored = asar::repack_asar(root, payload, &replacements, &removed)?;
    try_write_asar_atomically(target, &restored)
}

/// 后台延时替换被占用的 app.asar（每秒轮询，最多等待 2 小时）
pub fn run_deferred_swap(staged: &Path, target: &Path, relaunch_exe: Option<&Path>) -> bool {
    for _ in 0..7200 {
        if !staged.exists() {
            return false;
        }
        if fs::copy(staged, target).is_ok() {
            let _ = fs::remove_file(staged);
            if let Some(exe) = relaunch_exe {
                if exe.exists() {
                    let mut cmd = Command::new(exe);
                    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
                    #[cfg(windows)]
                    cmd.creation_flags(DETACHED_PROCESS);
                    let _ = cmd.spawn();
                }
            }
            return true;
        }
        thread::sleep(Duration::from_secs(1));
    }
    false
}

/// 只读探测当前系统上的插件、Desktop 与 IDE 安装状态
pub fn inspect_status(custom_asar: Option<&Path>) -> StatusReport {
    let plugin_root = paths::plugin_root();
    let plugin_installed = paths::client_js_path().exists() && paths::hooks_json_path().exists();
    let st: PluginState = if paths::state_json_path().exists() {
        state::load_state()
    } else {
        PluginState::default()
    };

    let desktop_targets = paths::find_desktop_asar_paths(custom_asar)
        .into_iter()
        .map(|p| {
            let (patched, loader_ver) = inspect_desktop_asar_loader(&p);
            let has_staged = bak_path(&p, ".codex-staged").exists();
            DesktopStatus {
                path: p.to_string_lossy().to_string(),
                patched,
                loader_version: loader_ver,
                has_staged,
            }
        })
        .collect();

    let ide_targets = paths::find_ide_extension_files()
        .into_iter()
        .map(|p| {
            let (patched, loader_ver) = inspect_ide_extension_loader(&p);
            IdeStatus {
                path: p.to_string_lossy().to_string(),
                patched,
                loader_version: loader_ver,
            }
        })
        .collect();

    StatusReport {
        plugin_root: plugin_root.to_string_lossy().to_string(),
        plugin_installed,
        installed_version: if plugin_installed { Some(st.version) } else { None },
        auto_update: st.auto_update,
        mirror_prefix: st.mirror_prefix,
        pending_update_version: st.pending_update_version,
        desktop_targets,
        ide_targets,
    }
}

/// 毫秒级检查 Desktop app.asar 是否仍保有最新引导器（仅 seek 读取目标入口切片，不读取整个 ASAR）
pub fn inspect_desktop_asar_loader(asar_path: &Path) -> (bool, Option<u32>) {
    let Ok(main_src) = asar::read_entry_text_by_seek(asar_path, "dist/main.js") else {
        return (false, None);
    };
    let Ok(preload_src) = asar::read_entry_text_by_seek(asar_path, "dist/preload.js") else {
        return (false, None);
    };
    let has_main = loader::has_loader_marker(&main_src, loader::MAIN_PATCH_START);
    let has_preload = loader::has_loader_marker(&preload_src, loader::PRELOAD_PATCH_START);
    let ver = loader::parse_loader_version(&main_src);
    (has_main && has_preload, ver)
}

/// 检查 IDE extension.js 是否仍保有引导器
pub fn inspect_ide_extension_loader(ext_path: &Path) -> (bool, Option<u32>) {
    let Ok(src) = fs::read_to_string(ext_path) else {
        return (false, None);
    };
    let has = loader::has_loader_marker(&src, loader::IDE_PATCH_START);
    let ver = loader::parse_loader_version(&src);
    (has, ver)
}

/// 快速检测是否存在被官方更新冲掉（丢失引导器）的目标，并返回其指纹（用于 SessionStart 去重）
pub fn detect_missing_loaders(custom_asar: Option<&Path>) -> Option<String> {
    let mut missing_parts = Vec::new();
    for asar_path in paths::find_desktop_asar_paths(custom_asar) {
        if !asar_path.exists() {
            continue;
        }
        // 若存在待替换包说明已经在等待退出替换，不重复判定为丢失
        if bak_path(&asar_path, ".codex-staged").exists() {
            continue;
        }
        let (ok, ver) = inspect_desktop_asar_loader(&asar_path);
        if !ok || ver.unwrap_or(0) < LOADER_VERSION {
            missing_parts.push(format!("desktop:{}", file_fingerprint(&asar_path)));
        }
    }
    for ext_path in paths::find_ide_extension_files() {
        let (ok, ver) = inspect_ide_extension_loader(&ext_path);
        if !ok || ver.unwrap_or(0) < LOADER_VERSION {
            missing_parts.push(format!("ide:{}", file_fingerprint(&ext_path)));
        }
    }
    if missing_parts.is_empty() {
        None
    } else {
        Some(missing_parts.join("|"))
    }
}

fn file_fingerprint(path: &Path) -> String {
    let Ok(meta) = fs::metadata(path) else {
        return "missing".to_string();
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}:{}", meta.len(), mtime)
}

fn bak_path(target: &Path, suffix: &str) -> PathBuf {
    let mut os_str = target.as_os_str().to_os_string();
    os_str.push(suffix);
    PathBuf::from(os_str)
}
