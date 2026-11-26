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
/// 内嵌编译时的品牌图标 assets/logo.svg
pub const BUNDLED_LOGO_SVG: &str = include_str!("../../assets/logo.svg");
/// 内嵌编译时的 Sidecar 控制面板网页 lib/sidecar-panel.html
pub const BUNDLED_SIDECAR_HTML: &str = include_str!("../../lib/sidecar-panel.html");

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
    pub coexisting_plugins: Vec<String>,
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

/// 写入 Antigravity 原生插件清单 (`plugin.json`)、`SessionStart` 自愈钩子 (`hooks.json`) 与 Sidecar 清单
pub fn write_plugin_metadata(version: &str) -> Result<(), String> {
    let root = paths::plugin_root();
    fs::create_dir_all(&root).map_err(|e| format!("创建插件目录失败: {e}"))?;

    atomic_write_bytes(&paths::logo_svg_path(), BUNDLED_LOGO_SVG.as_bytes())?;
    atomic_write_bytes(&paths::sidecar_html_path(), BUNDLED_SIDECAR_HTML.as_bytes())?;

    let plugin_json = serde_json::json!({
        "name": "antigravity-effort-slider",
        "displayName": "Codex & Claude 推理等级滑条",
        "version": version,
        "logo": "assets/logo.svg",
        "description": "Codex 风格物理推理等级滑条与 Claude 像素点阵滑条（支持 Sidecar 控制面板、GitHub Release 自动更新与官方更新后自动修复）",
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

    // 注册右侧 Overview -> Plugins 原生 Sidecar 控制面板
    let sidecar_json = serde_json::json!({
        "command": paths::installed_binary_path().to_string_lossy(),
        "args": ["sidecar"],
        "restart_policy": "always",
        "display_name": "推理滑条控制面板",
        "description": "调整推理等级滑条动画与刻度设置、查看共存插件状态与管理自动更新",
        "has_web_ui": true,
        "agent_permissions": {
            "allows_user_interactions": false
        },
        "ui_config": {
            "display_name": "推理滑条控制面板",
            "views": [
                {
                    "path": "/",
                    "entrypoint": "SIDECAR_UI_ENTRYPOINT_AUX_PANE",
                    "title": "推理滑条"
                }
            ]
        }
    });
    let sidecar_bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(&sidecar_json).map_err(|e| e.to_string())?
    );
    atomic_write_bytes(&paths::sidecar_json_path(), sidecar_bytes.as_bytes())?;
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

    if let Some(legacy_dir) = paths::legacy_prototype_plugin_dir() {
        if legacy_dir.exists() && fs::remove_dir_all(&legacy_dir).is_ok() {
            report.messages.push(format!(
                "已自动清理旧实验插件目录: {}",
                legacy_dir.display()
            ));
        }
    }

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
            Ok(PatchWriteOutcome::Direct) => {
                report
                    .messages
                    .push(format!("[Desktop] 已直接写入动态引导器: {}", asar_path.display()));
            }
            Ok(PatchWriteOutcome::RenameBypass) => {
                report.messages.push(format!(
                    "[Desktop] 已通过原子换包 (rename-bypass) 即时写入动态引导器: {}",
                    asar_path.display()
                ));
            }
            Ok(PatchWriteOutcome::Deferred(target_str)) => {
                report.deferred_targets.push(target_str.clone());
                report.messages.push(format!(
                    "[Desktop] 文件正被独占锁定，已启动动态退后任务：客户端退出释放锁后将按最新文件原地写入 ({target_str})"
                ));
            }
            Err(e) => {
                report.ok = false;
                report.errors.push(format!("[Desktop] 处理失败 ({}): {e}", asar_path.display()));
            }
        }
    }

    // 2. 清理 IDE 历史遗留注入并修补 extension.js（原地精准剥离，绝不拿旧备份覆盖其他插件）
    for legacy_path in paths::find_ide_legacy_files() {
        let bak = bak_path(&legacy_path, ".codex.bak");
        if let Ok(cur) = fs::read_to_string(&legacy_path) {
            let cleaned = loader::strip_marker_block(
                &cur,
                loader::PRELOAD_PATCH_START,
                loader::PRELOAD_PATCH_END,
            );
            if cleaned != cur && fs::write(&legacy_path, cleaned).is_ok() {
                report
                    .messages
                    .push(format!("[IDE] 已精准清理历史补丁标记: {}", legacy_path.display()));
            }
        }
        if bak.exists() {
            let _ = fs::remove_file(&bak);
        }
    }

    let selected_ide_files = paths::find_ide_extension_files();
    let selected_keys: HashSet<String> = selected_ide_files
        .iter()
        .map(|p| {
            let resolved = fs::canonicalize(p).unwrap_or_else(|_| p.clone());
            let s = resolved.to_string_lossy().to_string();
            if cfg!(windows) { s.to_lowercase() } else { s }
        })
        .collect();

    // 若同目录下其他非目标入口文件（例如曾误打过补丁的 dist/extension.js）含有本插件旧标记，先顺手精准剥离
    for cand_path in paths::find_all_ide_extension_candidates() {
        let resolved = fs::canonicalize(&cand_path).unwrap_or_else(|_| cand_path.clone());
        let key = {
            let s = resolved.to_string_lossy().to_string();
            if cfg!(windows) { s.to_lowercase() } else { s }
        };
        if selected_keys.contains(&key) {
            continue;
        }
        if let Ok(cur) = fs::read_to_string(&cand_path) {
            let cleaned = loader::strip_marker_block(&cur, loader::IDE_PATCH_START, loader::IDE_PATCH_END);
            if cleaned != cur && fs::write(&cand_path, cleaned).is_ok() {
                report.messages.push(format!(
                    "[IDE] 已清理非目标扩展入口中的历史本插件标记: {}",
                    cand_path.display()
                ));
            }
        }
    }

    for ext_path in selected_ide_files {
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
    Direct,
    RenameBypass,
    Deferred(String),
}

enum WriteResult {
    Direct,
    RenameBypass,
    Locked,
}

fn patch_desktop_asar(
    asar_path: &Path,
    plugin_root: &Path,
    fallback_client_js: &str,
) -> Result<PatchWriteOutcome, String> {
    let out_buf = build_desktop_patched_buffer(asar_path, plugin_root, fallback_client_js)?;
    match write_asar_safely(asar_path, &out_buf) {
        Ok(WriteResult::Direct) => Ok(PatchWriteOutcome::Direct),
        Ok(WriteResult::RenameBypass) => Ok(PatchWriteOutcome::RenameBypass),
        Ok(WriteResult::Locked) => {
            let target_str = asar_path.to_string_lossy().to_string();
            let _ = spawn_detached_self(&["deferred-op", "--action", "install", "--target", &target_str]);
            Ok(PatchWriteOutcome::Deferred(target_str))
        }
        Err(e) => Err(e),
    }
}

fn build_desktop_patched_buffer(
    asar_path: &Path,
    plugin_root: &Path,
    fallback_client_js: &str,
) -> Result<Vec<u8>, String> {
    // 始终基于磁盘当前 app.asar 做原地增量修补，绝不创建或读取通用 app.asar.bak，
    // 既可与其他第三方插件无损共存，也避免官方升级后旧备份倒灌降级。
    let raw = fs::read(asar_path).map_err(|e| format!("读取 ASAR 失败: {e}"))?;
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
    asar::verify_asar_buffer(&out_buf, &["dist/main.js", "dist/preload.js"])?;
    Ok(out_buf)
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

/// 安全写入目标 app.asar：优先直写 -> 被占用时采用 rename-bypass 原子换包 -> 仍独占则交由动态重算退后处理
fn write_asar_safely(target: &Path, buffer: &[u8]) -> Result<WriteResult, String> {
    let locked_old = bak_path(target, ".codex-locked");
    if locked_old.exists() {
        let _ = fs::remove_file(&locked_old);
    }

    let temp_new = bak_path(target, ".codex-new");
    fs::write(&temp_new, buffer).map_err(|e| format!("写入临时包失败: {e}"))?;

    if fs::copy(&temp_new, target).is_ok() {
        let _ = fs::remove_file(&temp_new);
        return Ok(WriteResult::Direct);
    }

    // rename-bypass：Windows 允许重命名被进程映射中的文件，随后立即落盘新包
    if fs::rename(target, &locked_old).is_ok() {
        if fs::rename(&temp_new, target).is_ok() {
            return Ok(WriteResult::RenameBypass);
        }
        let _ = fs::rename(&locked_old, target);
    }

    let _ = fs::remove_file(&temp_new);
    Ok(WriteResult::Locked)
}

fn patch_ide_extension(
    ext_path: &Path,
    plugin_root: &Path,
    fallback_client_js: &str,
) -> Result<(), String> {
    // 原地增量修补：仅剥离并重写本插件标记块，保留其他插件的扩展注入
    let cur = fs::read_to_string(ext_path).map_err(|e| format!("读取失败: {e}"))?;
    let patched = loader::apply_ide_extension_patch(&cur, plugin_root, fallback_client_js)?;
    fs::write(ext_path, patched).map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

/// 按磁盘实际文件同步更新 IDE `product.json` 的 SHA-256 Base64 校验表（绝不用旧备份覆盖其他插件修改）
pub fn sync_ide_product_checksums(product_json_path: &Path, is_uninstall: bool) -> Result<(), String> {
    if !product_json_path.exists() {
        return Ok(());
    }
    let app_root = product_json_path
        .parent()
        .ok_or_else(|| "无效的 product.json 路径".to_string())?;
    let bak = bak_path(product_json_path, ".codex.bak");
    if is_uninstall && bak.exists() {
        let _ = fs::remove_file(&bak);
    }

    let raw_text = fs::read_to_string(product_json_path).map_err(|e| format!("读取 product.json 失败: {e}"))?;
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

/// 卸载本插件：原地精准摘除本插件标记与托管目录，完整保留其他插件与浏览器 localStorage 偏好
pub fn uninstall_all(custom_asar: Option<&Path>) -> OperationReport {
    let mut report = OperationReport {
        ok: true,
        messages: Vec::new(),
        deferred_targets: Vec::new(),
        errors: Vec::new(),
    };

    // 1. 原地精准移除 Desktop app.asar 中的本插件补丁（不读取或触碰任何 .bak）
    for asar_path in paths::find_desktop_asar_paths(custom_asar) {
        if !asar_path.exists() {
            continue;
        }
        match restore_desktop_asar(&asar_path) {
            Ok(Some(PatchWriteOutcome::Direct)) => {
                report.messages.push(format!(
                    "[Desktop] 已精准移除本插件补丁（已保留其他插件）: {}",
                    asar_path.display()
                ));
            }
            Ok(Some(PatchWriteOutcome::RenameBypass)) => {
                report.messages.push(format!(
                    "[Desktop] 已通过原子换包 (rename-bypass) 精准移除本插件补丁（已保留其他插件）: {}",
                    asar_path.display()
                ));
            }
            Ok(Some(PatchWriteOutcome::Deferred(target_str))) => {
                report.deferred_targets.push(target_str.clone());
                report.messages.push(format!(
                    "[Desktop] 文件正被独占锁定，已启动动态退后任务：客户端退出释放锁后将按最新文件精准移除本插件 ({target_str})"
                ));
            }
            Ok(None) => {
                report.messages.push(format!(
                    "[Desktop] 当前未检测到本插件补丁，跳过修改: {}",
                    asar_path.display()
                ));
            }
            Err(e) => {
                report.ok = false;
                report.errors.push(format!("[Desktop] 卸载失败 ({}): {e}", asar_path.display()));
            }
        }
    }

    // 2. 原地精准移除 IDE 所有候选扩展入口中的本插件补丁并重算校验表（顺手清理本插件历史 .codex.bak）
    for ext_path in paths::find_all_ide_extension_candidates() {
        let bak = bak_path(&ext_path, ".codex.bak");
        if bak.exists() {
            let _ = fs::remove_file(&bak);
        }
        if let Ok(cur) = fs::read_to_string(&ext_path) {
            let cleaned = loader::strip_marker_block(&cur, loader::IDE_PATCH_START, loader::IDE_PATCH_END);
            if cleaned != cur {
                if let Err(e) = fs::write(&ext_path, cleaned) {
                    report.errors.push(format!("[IDE] 移除扩展补丁失败: {e}"));
                } else {
                    report.messages.push(format!(
                        "[IDE] 已精准移除本插件扩展补丁（已保留其他插件）: {}",
                        ext_path.display()
                    ));
                }
            }
        }
    }

    for ide_root in paths::find_ide_roots() {
        let _ = sync_ide_product_checksums(&ide_root.join("product.json"), true);
    }
    clear_ide_code_cache();

    // 3. 清除旧实验目录与本插件目录（若当前运行的正是目录内二进制，Windows 上先清理其余文件并挂起退出后清理）
    if let Some(legacy_dir) = paths::legacy_prototype_plugin_dir() {
        if legacy_dir.exists() && fs::remove_dir_all(&legacy_dir).is_ok() {
            report.messages.push(format!(
                "已清理旧实验插件目录: {}",
                legacy_dir.display()
            ));
        }
    }

    let plugin_root = paths::plugin_root();
    if plugin_root.exists() {
        // 先尝试保留 .uninstall-request（若有）给运行中的 Desktop 主进程读取后自删；
        // 若无 .uninstall-request 则可直接整目录删除
        let has_uninstall_signal = paths::uninstall_request_path().exists();
        if !has_uninstall_signal && fs::remove_dir_all(&plugin_root).is_ok() {
            report
                .messages
                .push(format!("已移除原生插件目录: {}", plugin_root.display()));
        } else {
            // 逐个删除非锁定文件与目录（保留 .uninstall-request 让宿主主进程读取并自删）
            for sub in ["lib", "assets", "sidecars", "plugin.json", "hooks.json", "state.json"] {
                let p = plugin_root.join(sub);
                if p.is_dir() {
                    let _ = fs::remove_dir_all(&p);
                } else if p.is_file() {
                    let _ = fs::remove_file(&p);
                }
            }
            schedule_windows_self_cleanup(&plugin_root);
            report.messages.push(format!(
                "已清理插件配置与脚本（占用中的程序将在退出 Antigravity 后自动清理）: {}",
                plugin_root.display()
            ));
        }
    }

    report
}

fn schedule_windows_self_cleanup(plugin_root: &Path) {
    if cfg!(test) || env::var("AG_SLIDER_SKIP_DETACHED_SPAWN").as_deref() == Ok("1") {
        return;
    }
    #[cfg(windows)]
    {
        if plugin_root.file_name().and_then(|s| s.to_str()) != Some(paths::PLUGIN_DIR_NAME) {
            return;
        }
        let dir_str = plugin_root.to_string_lossy().replace('"', "");
        let script = format!(
            "for /L %i in (1,1,90) do (ping -n 3 127.0.0.1 >nul & rd /s /q \"{dir_str}\" >nul 2>&1 & if not exist \"{dir_str}\" exit 0)"
        );
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/C", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
        let _ = cmd.spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = plugin_root;
    }
}

fn restore_desktop_asar(target: &Path) -> Result<Option<PatchWriteOutcome>, String> {
    let Some(restored) = build_desktop_restored_buffer(target)? else {
        return Ok(None);
    };
    match write_asar_safely(target, &restored) {
        Ok(WriteResult::Direct) => Ok(Some(PatchWriteOutcome::Direct)),
        Ok(WriteResult::RenameBypass) => Ok(Some(PatchWriteOutcome::RenameBypass)),
        Ok(WriteResult::Locked) => {
            let target_str = target.to_string_lossy().to_string();
            let _ = spawn_detached_self(&["deferred-op", "--action", "uninstall", "--target", &target_str]);
            Ok(Some(PatchWriteOutcome::Deferred(target_str)))
        }
        Err(e) => Err(e),
    }
}

fn build_desktop_restored_buffer(target: &Path) -> Result<Option<Vec<u8>>, String> {
    let raw = fs::read(target).map_err(|e| format!("读取 ASAR 失败: {e}"))?;
    let (root, payload) = asar::parse_asar_buffer(&raw)?;

    let mut changed = asar::find_entry(&root, "dist/antigravity-codex-effort-slider.js").is_some();
    let mut replacements = BTreeMap::new();
    if let Some(main_entry) = asar::find_entry(&root, "dist/main.js") {
        let cur = read_payload_utf8(payload, main_entry, "dist/main.js")?;
        let cleaned = loader::strip_marker_block(&cur, loader::MAIN_PATCH_START, loader::MAIN_PATCH_END);
        if cleaned != cur {
            changed = true;
            replacements.insert("dist/main.js".to_string(), cleaned.into_bytes());
        }
    }
    if let Some(preload_entry) = asar::find_entry(&root, "dist/preload.js") {
        let cur = read_payload_utf8(payload, preload_entry, "dist/preload.js")?;
        let cleaned =
            loader::strip_marker_block(&cur, loader::PRELOAD_PATCH_START, loader::PRELOAD_PATCH_END);
        if cleaned != cur {
            changed = true;
            replacements.insert("dist/preload.js".to_string(), cleaned.into_bytes());
        }
    }
    if !changed {
        return Ok(None);
    }

    let mut removed = HashSet::new();
    removed.insert("dist/antigravity-codex-effort-slider.js".to_string());

    let restored = asar::repack_asar(root, payload, &replacements, &removed)?;
    asar::verify_asar_buffer(&restored, &["dist/main.js", "dist/preload.js"])?;
    Ok(Some(restored))
}

/// 动态重算型退后处理：等待文件锁释放后重新读取磁盘最新 app.asar 并执行原地外科手术式操作
pub fn run_deferred_op(action: &str, target: &Path, relaunch_exe: Option<&Path>) -> bool {
    for _ in 0..7200 {
        if !target.exists() {
            return false;
        }
        // 探测是否已具备独占写权限，避免在锁未释放时反复重打包
        if fs::OpenOptions::new().write(true).open(target).is_ok() {
            let ok = match action {
                "uninstall" => match build_desktop_restored_buffer(target) {
                    Ok(Some(buf)) => matches!(
                        write_asar_safely(target, &buf),
                        Ok(WriteResult::Direct | WriteResult::RenameBypass)
                    ),
                    Ok(None) => true,
                    Err(_) => false,
                },
                _ => {
                    let fallback = fs::read_to_string(paths::client_js_path())
                        .unwrap_or_else(|_| BUNDLED_CLIENT_JS.to_string());
                    match build_desktop_patched_buffer(target, &paths::plugin_root(), &fallback) {
                        Ok(buf) => matches!(
                            write_asar_safely(target, &buf),
                            Ok(WriteResult::Direct | WriteResult::RenameBypass)
                        ),
                        Err(_) => false,
                    }
                }
            };
            if ok {
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
        }
        thread::sleep(Duration::from_secs(1));
    }
    false
}

/// 后台延时替换被占用的 app.asar（向后兼容旧版引导器调用）
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

/// 动态扫描同级 plugins 目录下其他已安装插件的 plugin.json（零硬编码项目名）
fn detect_sibling_installed_plugins() -> Vec<String> {
    let cur_root = paths::plugin_root();
    let Some(plugins_dir) = cur_root.parent() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(plugins_dir) else {
        return Vec::new();
    };

    let cur_canon = fs::canonicalize(&cur_root).unwrap_or_else(|_| cur_root.clone());
    let cur_name = cur_root.file_name().and_then(|s| s.to_str()).unwrap_or("");

    let mut names = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let dir_name = dir.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if dir_name.is_empty() || dir_name == cur_name || dir_name == "codex-effort-slider" {
            continue;
        }
        let canon = fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
        if canon == cur_canon {
            continue;
        }

        let plugin_json_path = dir.join("plugin.json");
        if !plugin_json_path.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&plugin_json_path) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let label = parsed
            .get("displayName")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                parsed
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or(dir_name)
            .to_string();
        if !names.contains(&label) {
            names.push(label);
        }
    }
    names.sort();
    names
}

fn has_third_party_asar_marker(source: &str, self_start: &str, self_end: &str) -> bool {
    let stripped = if self_start.is_empty() {
        source.to_string()
    } else {
        loader::strip_marker_block(source, self_start, self_end)
    };
    stripped.contains("/* __AG_") && stripped.contains("_START__ */")
}

/// 快速探测共存的其他插件：动态读取同级插件清单 + seek 探测 app.asar 中的第三方补丁标记
pub fn detect_coexisting_plugins(asar_path: &Path) -> Vec<String> {
    let mut found = detect_sibling_installed_plugins();

    let mut has_other_marker = false;
    if let Ok(main_src) = asar::read_entry_text_by_seek(asar_path, "dist/main.js") {
        if has_third_party_asar_marker(&main_src, loader::MAIN_PATCH_START, loader::MAIN_PATCH_END) {
            has_other_marker = true;
        }
    }
    if !has_other_marker {
        if let Ok(preload_src) = asar::read_entry_text_by_seek(asar_path, "dist/preload.js") {
            if has_third_party_asar_marker(&preload_src, loader::PRELOAD_PATCH_START, loader::PRELOAD_PATCH_END) {
                has_other_marker = true;
            }
        }
    }
    if !has_other_marker {
        if let Ok(overlay_src) = asar::read_entry_text_by_seek(asar_path, "dist/loadingOverlay.js") {
            if has_third_party_asar_marker(&overlay_src, "", "") {
                has_other_marker = true;
            }
        }
    }
    if has_other_marker && found.is_empty() {
        found.push("其他第三方补丁".to_string());
    }
    found
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
            let coexisting_plugins = detect_coexisting_plugins(&p);
            DesktopStatus {
                path: p.to_string_lossy().to_string(),
                patched,
                loader_version: loader_ver,
                has_staged,
                coexisting_plugins,
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
