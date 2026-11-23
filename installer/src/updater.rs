//! GitHub Release 自更新引擎：直连 releases/latest/download/manifest.json（免 API 限流），
//! 支持系统代理自动探测、自定义镜像前缀、6 小时冷却控制与 SHA-256 强制校验。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::Duration;

use crate::patcher;
use crate::paths;
use crate::state::{self, LOADER_VERSION};

/// 默认 GitHub Release 最新版本清单地址（走 302 CDN，不受 api.github.com 60次/小时限流）
pub const DEFAULT_MANIFEST_URL: &str =
    "https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider/releases/latest/download/manifest.json";

/// 默认自动检查冷却时间（12 小时）
#[allow(dead_code)]
pub const CHECK_COOLDOWN_SECS: u64 = 12 * 3600;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseManifest {
    pub version: String,
    #[serde(default = "default_min_loader")]
    pub min_loader_version: u32,
    #[serde(default)]
    pub notes: String,
    pub files: ManifestFiles,
}

fn default_min_loader() -> u32 {
    1
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFiles {
    pub client: ManifestAsset,
    #[serde(default)]
    pub binaries: HashMap<String, ManifestAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAsset {
    pub url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub ok: bool,
    pub status: String, // "updated" | "up_to_date" | "cooldown" | "disabled" | "error"
    pub version: Option<String>,
    pub notes: Option<String>,
    pub loader_upgraded: bool,
    pub message: String,
}

/// 解析当前系统对应的平台二进制键名
pub fn current_platform_key() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "windows-x86_64"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "macos-aarch64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "macos-x86_64"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "linux-x86_64"
    } else {
        "unknown"
    }
}

/// 比较语义化版本号（支持 `v` 前缀与 `major.minor.patch`）
pub fn is_newer_version(remote: &str, local: &str) -> bool {
    let parse = |s: &str| -> (u64, u64, u64) {
        let clean = s.trim().trim_start_matches('v').trim_start_matches('V');
        let core = clean.split('-').next().unwrap_or(clean);
        let mut parts = core.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
        (
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
        )
    };
    parse(remote) > parse(local)
}

/// 拼接可选镜像加速前缀
pub fn apply_mirror_prefix(url: &str, mirror_prefix: &str) -> String {
    let prefix = mirror_prefix.trim();
    if prefix.is_empty() {
        return url.to_string();
    }
    let normalized = prefix.trim_end_matches('/');
    format!("{normalized}/{url}")
}

/// 校验字节流 SHA-256 摘要
pub fn verify_sha256(bytes: &[u8], expected_hex: &str) -> bool {
    let actual = hex::encode(Sha256::digest(bytes));
    actual.eq_ignore_ascii_case(expected_hex.trim())
}

/// 探测系统 HTTP/HTTPS 代理（环境变量优先，Windows 兜底读取 IE/WinINet 注册表）
pub fn detect_system_proxy() -> Option<String> {
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] {
        if let Ok(val) = env::var(key) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return Some(normalize_proxy_url(trimmed));
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(reg_proxy) = detect_windows_registry_proxy() {
            return Some(normalize_proxy_url(&reg_proxy));
        }
    }
    None
}

fn normalize_proxy_url(raw: &str) -> String {
    let s = raw.trim();
    if s.contains("://") {
        s.to_string()
    } else {
        format!("http://{s}")
    }
}

#[cfg(windows)]
fn detect_windows_registry_proxy() -> Option<String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        REG_DWORD, REG_SZ,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe {
        let subkey = to_wide("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");
        let mut hkey: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey) != 0 {
            return None;
        }

        let mut enable: u32 = 0;
        let mut enable_len: u32 = std::mem::size_of::<u32>() as u32;
        let mut val_type: u32 = 0;
        let enable_name = to_wide("ProxyEnable");
        let ok_enable = RegQueryValueExW(
            hkey,
            enable_name.as_ptr(),
            std::ptr::null(),
            &mut val_type,
            (&mut enable as *mut u32).cast::<u8>(),
            &mut enable_len,
        );
        if ok_enable != 0 || val_type != REG_DWORD || enable == 0 {
            RegCloseKey(hkey);
            return None;
        }

        let server_name = to_wide("ProxyServer");
        let mut buf = vec![0u16; 512];
        let mut byte_len = (buf.len() * 2) as u32;
        let ok_server = RegQueryValueExW(
            hkey,
            server_name.as_ptr(),
            std::ptr::null(),
            &mut val_type,
            buf.as_mut_ptr().cast::<u8>(),
            &mut byte_len,
        );
        RegCloseKey(hkey);
        if ok_server != 0 || val_type != REG_SZ || byte_len < 2 {
            return None;
        }

        let u16_len = (byte_len as usize / 2).saturating_sub(1);
        let raw = String::from_utf16_lossy(&buf[..u16_len]).trim().to_string();
        if raw.is_empty() {
            return None;
        }
        // 处理形如 `http=127.0.0.1:7890;https=127.0.0.1:7890` 或纯 `127.0.0.1:7890`
        if raw.contains('=') {
            for part in raw.split(';') {
                let mut kv = part.splitn(2, '=');
                let k = kv.next().unwrap_or("").trim().to_ascii_lowercase();
                let v = kv.next().unwrap_or("").trim();
                if (k == "https" || k == "http") && !v.is_empty() {
                    return Some(v.to_string());
                }
            }
            None
        } else {
            Some(raw)
        }
    }
}

fn build_http_agent() -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(30))
        .user_agent(concat!("ag-effort-slider/", env!("CARGO_PKG_VERSION")));
    if let Some(proxy_str) = detect_system_proxy() {
        if let Ok(proxy) = ureq::Proxy::new(&proxy_str) {
            builder = builder.proxy(proxy);
        }
    }
    builder.build()
}

fn download_bytes(agent: &ureq::Agent, url: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
    let resp = agent
        .get(url)
        .call()
        .map_err(|e| format!("网络请求失败 ({url}): {e}"))?;
    let mut reader = resp.into_reader().take((max_bytes + 1) as u64);
    let mut buf = Vec::new();
    reader
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取响应流失败: {e}"))?;
    if buf.len() > max_bytes {
        return Err("下载文件超出大小上限".to_string());
    }
    Ok(buf)
}

/// 检查更新并按需下载校验后原子落盘
pub fn check_and_apply_update(force: bool, background: bool) -> UpdateResult {
    let mut st = state::load_state();

    if background && !st.auto_update {
        return UpdateResult {
            ok: true,
            status: "disabled".to_string(),
            version: None,
            notes: None,
            loader_upgraded: false,
            message: "已关闭自动检查更新".to_string(),
        };
    }

    let now = state::now_unix_secs();
    let cooldown_secs = st.check_interval_hours.max(1) * 3600;
    if !force && st.last_check_at > 0 && now.saturating_sub(st.last_check_at) < cooldown_secs {
        return UpdateResult {
            ok: true,
            status: "cooldown".to_string(),
            version: Some(st.version),
            notes: None,
            loader_upgraded: false,
            message: "处于检查冷却期内".to_string(),
        };
    }

    let base_manifest_url = env::var("AG_SLIDER_MANIFEST_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MANIFEST_URL.to_string());
    let manifest_url = apply_mirror_prefix(&base_manifest_url, &st.mirror_prefix);

    let agent = build_http_agent();
    let manifest_bytes = match download_bytes(&agent, &manifest_url, 1024 * 1024) {
        Ok(b) => b,
        Err(e) => {
            return UpdateResult {
                ok: false,
                status: "error".to_string(),
                version: None,
                notes: None,
                loader_upgraded: false,
                message: e,
            };
        }
    };

    let manifest: ReleaseManifest = match serde_json::from_slice(&manifest_bytes) {
        Ok(m) => m,
        Err(e) => {
            return UpdateResult {
                ok: false,
                status: "error".to_string(),
                version: None,
                notes: None,
                loader_upgraded: false,
                message: format!("解析 Release 清单失败: {e}"),
            };
        }
    };

    st.last_check_at = now;
    if !is_newer_version(&manifest.version, &st.version) {
        let _ = state::save_state(&st);
        return UpdateResult {
            ok: true,
            status: "up_to_date".to_string(),
            version: Some(st.version),
            notes: None,
            loader_upgraded: false,
            message: "当前已是最新版本".to_string(),
        };
    }

    // 1. 下载并校验 client.js
    let client_url = apply_mirror_prefix(&manifest.files.client.url, &st.mirror_prefix);
    let client_bytes = match download_bytes(&agent, &client_url, 5 * 1024 * 1024) {
        Ok(b) => b,
        Err(e) => {
            return UpdateResult {
                ok: false,
                status: "error".to_string(),
                version: None,
                notes: None,
                loader_upgraded: false,
                message: e,
            };
        }
    };
    if !verify_sha256(&client_bytes, &manifest.files.client.sha256) {
        return UpdateResult {
            ok: false,
            status: "error".to_string(),
            version: None,
            notes: None,
            loader_upgraded: false,
            message: "client.js SHA-256 校验失败，已自动保留旧版本".to_string(),
        };
    }

    // 2. 若平台二进制存在且哈希不一致，则同步升级本地原生引擎
    let plat_key = current_platform_key();
    if let Some(bin_asset) = manifest.files.binaries.get(plat_key) {
        let installed_bin = paths::installed_binary_path();
        let need_bin_update = match fs::read(&installed_bin) {
            Ok(existing) => !verify_sha256(&existing, &bin_asset.sha256),
            Err(_) => true,
        };
        if need_bin_update {
            let bin_url = apply_mirror_prefix(&bin_asset.url, &st.mirror_prefix);
            match download_bytes(&agent, &bin_url, 32 * 1024 * 1024) {
                Ok(bin_bytes) if verify_sha256(&bin_bytes, &bin_asset.sha256) => {
                    if let Err(e) = replace_binary_safely(&installed_bin, &bin_bytes) {
                        return UpdateResult {
                            ok: false,
                            status: "error".to_string(),
                            version: None,
                            notes: None,
                            loader_upgraded: false,
                            message: e,
                        };
                    }
                }
                Ok(_) => {
                    return UpdateResult {
                        ok: false,
                        status: "error".to_string(),
                        version: None,
                        notes: None,
                        loader_upgraded: false,
                        message: "二进制 SHA-256 校验失败，已回滚".to_string(),
                    };
                }
                Err(e) => {
                    return UpdateResult {
                        ok: false,
                        status: "error".to_string(),
                        version: None,
                        notes: None,
                        loader_upgraded: false,
                        message: e,
                    };
                }
            }
        }
    }

    // 3. 原子落盘最新 client.js 与元数据
    if let Err(e) = patcher::atomic_write_bytes(&paths::client_js_path(), &client_bytes) {
        return UpdateResult {
            ok: false,
            status: "error".to_string(),
            version: None,
            notes: None,
            loader_upgraded: false,
            message: e,
        };
    }
    let _ = patcher::write_plugin_metadata(&manifest.version);

    // 4. 若协议版本提升则升级本地引导器
    let mut loader_upgraded = false;
    if manifest.min_loader_version > st.loader_version || st.loader_version < LOADER_VERSION {
        let repair_res = patcher::repair_loaders_only(None);
        loader_upgraded = !repair_res.deferred_targets.is_empty() || repair_res.ok;
        st.pending_loader_upgrade = !repair_res.deferred_targets.is_empty();
    }

    st.version = manifest.version.clone();
    st.pending_update_version = Some(manifest.version.clone());
    st.pending_update_notes = if manifest.notes.trim().is_empty() {
        None
    } else {
        Some(manifest.notes.clone())
    };
    let _ = state::save_state(&st);

    UpdateResult {
        ok: true,
        status: "updated".to_string(),
        version: Some(manifest.version.clone()),
        notes: st.pending_update_notes.clone(),
        loader_upgraded,
        message: format!("已更新至 v{}，重启 Antigravity 生效", manifest.version),
    }
}

/// 安全替换运行中的自身二进制（Windows 先 rename 为 `.old` 后再写新文件）
fn replace_binary_safely(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 bin 目录失败: {e}"))?;
    }
    let tmp = target.with_extension("download.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("写入临时二进制失败: {e}"))?;

    if target.exists() {
        let old = patcher::old_binary_path(target);
        let _ = fs::remove_file(&old);
        if fs::rename(target, &old).is_err() {
            let _ = fs::remove_file(target);
        }
    }
    if let Err(e) = fs::rename(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("替换二进制失败: {e}"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(target) {
            let mut perm = meta.permissions();
            perm.set_mode(0o755);
            let _ = fs::set_permissions(target, perm);
        }
    }
    Ok(())
}
