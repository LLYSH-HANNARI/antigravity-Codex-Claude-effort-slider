//! Rust 原生引擎单元测试与隔离端到端测试（不触碰真实 Antigravity 安装目录）。

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::asar;
use crate::hook;
use crate::loader;
use crate::patcher;
use crate::paths;
use crate::state::{self, LOADER_VERSION};
use crate::updater;

/// 全局测试互斥锁：确保修改进程级环境变量（AG_SLIDER_PLUGIN_ROOT 等）的测试串行执行
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn make_temp_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = env::temp_dir().join(format!("ag-slider-test-{label}-{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// 构造包含 dist/main.js、dist/preload.js 与遗留文件的测试 ASAR 字节流
fn build_mock_asar(main_js: &str, preload_js: &str, include_legacy_file: bool) -> Vec<u8> {
    let main_bytes = main_js.as_bytes();
    let preload_bytes = preload_js.as_bytes();
    let legacy_bytes = b"// legacy";

    let mut payload = Vec::new();
    let mut dist_files = serde_json::Map::new();

    let main_off = payload.len();
    payload.extend_from_slice(main_bytes);
    dist_files.insert(
        "main.js".to_string(),
        json!({
            "offset": main_off.to_string(),
            "size": main_bytes.len(),
            "integrity": asar::compute_integrity(main_bytes, 4194304)
        }),
    );

    let preload_off = payload.len();
    payload.extend_from_slice(preload_bytes);
    dist_files.insert(
        "preload.js".to_string(),
        json!({
            "offset": preload_off.to_string(),
            "size": preload_bytes.len(),
            "integrity": asar::compute_integrity(preload_bytes, 4194304)
        }),
    );

    if include_legacy_file {
        let leg_off = payload.len();
        payload.extend_from_slice(legacy_bytes);
        dist_files.insert(
            "antigravity-codex-effort-slider.js".to_string(),
            json!({
                "offset": leg_off.to_string(),
                "size": legacy_bytes.len(),
                "integrity": asar::compute_integrity(legacy_bytes, 4194304)
            }),
        );
    }

    let root = json!({
        "files": {
            "dist": {
                "files": dist_files
            }
        }
    });
    asar::build_asar_buffer(&root, &[&payload]).unwrap()
}

#[test]
fn test_asar_parse_repack_and_seek() {
    let dir = make_temp_dir("asar");
    let asar_path = dir.join("app.asar");
    let raw = build_mock_asar("console.log('main');", "console.log('preload');", true);
    fs::write(&asar_path, &raw).unwrap();

    // seek 读单文件
    let read_main = asar::read_entry_text_by_seek(&asar_path, "dist/main.js").unwrap();
    assert_eq!(read_main, "console.log('main');");

    // 重打包替换并删除遗留文件
    let (root, payload) = asar::parse_asar_buffer(&raw).unwrap();
    let mut replacements = BTreeMap::new();
    replacements.insert("dist/preload.js".to_string(), b"console.log('new-preload');".to_vec());
    let mut removed = HashSet::new();
    removed.insert("dist/antigravity-codex-effort-slider.js".to_string());

    let repacked = asar::repack_asar(root, payload, &replacements, &removed).unwrap();
    fs::write(&asar_path, &repacked).unwrap();

    let (new_root, _) = asar::parse_asar_buffer(&repacked).unwrap();
    assert!(asar::find_entry(&new_root, "dist/antigravity-codex-effort-slider.js").is_none());
    assert_eq!(
        asar::read_entry_text_by_seek(&asar_path, "dist/preload.js").unwrap(),
        "console.log('new-preload');"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_loader_strip_legacy_and_idempotence() {
    let legacy_preload = "const a = 1;\ntry { require('./antigravity-codex-effort-slider.js'); } catch (e) {}\n/* __AG_CODEX_EFFORT_SLIDER_START__ */\nold();\n/* __AG_CODEX_EFFORT_SLIDER_END__ */\n";
    let patched1 = loader::apply_desktop_preload_patch(legacy_preload);
    let patched2 = loader::apply_desktop_preload_patch(&patched1);
    assert_eq!(patched1, patched2);
    assert!(!patched1.contains("antigravity-codex-effort-slider.js"));
    assert!(patched1.contains("__agCodexSliderBridge"));
    assert_eq!(loader::parse_loader_version(&patched1), Some(LOADER_VERSION));

    let ide_raw = "var Jx={};Jx.BaseVsCodeWebviewDelegate=class{renderIframe(){}};\n}.call(Object.assign(Object.create(globalThis), {}));";
    let ide1 = loader::apply_ide_extension_patch(ide_raw, Path::new("C:/tmp/plugin"), "console.log(1);").unwrap();
    let ide2 = loader::apply_ide_extension_patch(&ide1, Path::new("C:/tmp/plugin"), "console.log(1);").unwrap();
    assert_eq!(ide1, ide2);
    assert!(ide1.contains("Jx.BaseVsCodeWebviewDelegate.prototype.renderIframe"));
    assert!(!ide1.contains("sv.BaseVsCodeWebviewDelegate"));
    let anchor_pos = ide1.find(loader::IDE_INSERT_ANCHOR).unwrap();
    let patch_pos = ide1.find(loader::IDE_PATCH_START).unwrap();
    assert!(patch_pos < anchor_pos);
}

#[test]
fn test_semver_mirror_and_sha256() {
    assert!(updater::is_newer_version("1.4.1", "1.4.0"));
    assert!(updater::is_newer_version("v2.0.0", "1.9.9"));
    assert!(!updater::is_newer_version("1.4.0", "1.4.0"));
    assert!(!updater::is_newer_version("1.3.9", "1.4.0"));

    assert_eq!(
        updater::apply_mirror_prefix("https://github.com/a/b", ""),
        "https://github.com/a/b"
    );
    assert_eq!(
        updater::apply_mirror_prefix("https://github.com/a/b", "https://gh-proxy.com/"),
        "https://gh-proxy.com/https://github.com/a/b"
    );

    let data = b"hello-slider";
    let hex_hash = hex::encode(Sha256::digest(data));
    assert!(updater::verify_sha256(data, &hex_hash));
    assert!(!updater::verify_sha256(data, "0000deadbeef"));
}

#[test]
fn test_e2e_isolated_install_status_hook_and_uninstall() {
    let _guard = ENV_LOCK.lock().unwrap();
    let tmp = make_temp_dir("e2e");
    let plugin_dir = tmp.join("plugin-root");
    let desktop_asar = tmp.join("desktop").join("resources").join("app.asar");
    let ide_root = tmp.join("ide");
    let ide_app = ide_root.join("resources").join("app");
    let ide_ext = ide_app.join("extensions").join("agy").join("vscode").join("extension.js");
    let ide_out_file = ide_app.join("out").join("vs").join("test.js");
    let ide_product = ide_app.join("product.json");
    let cached_data = tmp.join("CachedData");

    fs::create_dir_all(desktop_asar.parent().unwrap()).unwrap();
    fs::create_dir_all(ide_ext.parent().unwrap()).unwrap();
    fs::create_dir_all(ide_out_file.parent().unwrap()).unwrap();
    fs::create_dir_all(&cached_data).unwrap();

    fs::write(&desktop_asar, build_mock_asar("const m=1;", "const p=1;", true)).unwrap();
    fs::write(
        &ide_ext,
        "var Jx={};Jx.BaseVsCodeWebviewDelegate=class{renderIframe(){}};\n}.call(Object.assign(Object.create(globalThis), {}));",
    )
    .unwrap();
    fs::write(&ide_out_file, b"console.log('out');").unwrap();
    let init_b64 = STANDARD_NO_PAD.encode(Sha256::digest(b"console.log('out');"));
    fs::write(
        &ide_product,
        json!({ "nameShort": "Antigravity IDE", "checksums": { "vs/test.js": init_b64 } }).to_string(),
    )
    .unwrap();

    env::set_var("AG_SLIDER_PLUGIN_ROOT", &plugin_dir);
    env::set_var("ANTIGRAVITY_ASAR_PATH", &desktop_asar);
    env::set_var("ANTIGRAVITY_IDE_PATH", &ide_root);
    env::set_var("AG_SLIDER_IDE_CACHED_DATA", &cached_data);

    // 1. 安装
    let rep = patcher::install_all(None, None);
    assert!(rep.ok, "install errors: {:?}", rep.errors);
    assert!(paths::client_js_path().exists());
    assert!(paths::plugin_json_path().exists());
    assert!(paths::hooks_json_path().exists());

    // 2. 状态检查
    let st = patcher::inspect_status(None);
    assert!(st.plugin_installed);
    assert_eq!(st.desktop_targets.len(), 1);
    assert!(st.desktop_targets[0].patched);
    assert_eq!(st.ide_targets.len(), 1);
    assert!(st.ide_targets[0].patched);

    // 3. 补丁完好时，SessionStart 钩子输出 {}（避免冷却触发后台更新，先把 last_check_at 设成当前）
    let mut pstate = state::load_state();
    pstate.last_check_at = state::now_unix_secs();
    state::save_state(&pstate).unwrap();
    assert_eq!(hook::handle_session_start(), "{}");

    // 4. 模拟 Antigravity 官方更新覆盖 app.asar
    fs::write(&desktop_asar, build_mock_asar("const m=2;", "const p=2;", false)).unwrap();
    let missing_fp = patcher::detect_missing_loaders(None);
    assert!(missing_fp.is_some());

    // 第一次触发 SessionStart 应返回带 user_markdown 的提示卡片；同一指纹第二次不重复弹出
    let hook_out_1 = hook::handle_session_start();
    assert!(hook_out_1.contains("user_markdown"));
    let hook_out_2 = hook::handle_session_start();
    assert_eq!(hook_out_2, "{}");

    // 5. 卸载并还原
    let un = patcher::uninstall_all(None);
    assert!(un.ok, "uninstall errors: {:?}", un.errors);
    let st_after = patcher::inspect_status(None);
    assert!(!st_after.desktop_targets[0].patched);
    assert!(!st_after.ide_targets[0].patched);
    assert!(!paths::client_js_path().exists());

    env::remove_var("AG_SLIDER_PLUGIN_ROOT");
    env::remove_var("ANTIGRAVITY_ASAR_PATH");
    env::remove_var("ANTIGRAVITY_IDE_PATH");
    env::remove_var("AG_SLIDER_IDE_CACHED_DATA");
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn test_multi_plugin_coexistence_with_third_party_plugin() {
    let _guard = ENV_LOCK.lock().unwrap();
    let tmp = make_temp_dir("coexist");
    let plugin_dir = tmp.join("plugin-root");
    let desktop_res = tmp.join("desktop").join("resources");
    let desktop_asar = desktop_res.join("app.asar");
    let old_generic_bak = desktop_res.join("app.asar.bak");
    let third_party_bak = desktop_res.join("app.asar.thirdparty.bak");

    let ide_root = tmp.join("ide");
    let ide_app = ide_root.join("resources").join("app");
    let ide_ext = ide_app.join("extensions").join("agy").join("vscode").join("extension.js");
    let ide_ext_bak = ide_app.join("extensions").join("agy").join("vscode").join("extension.js.codex.bak");
    let ide_out_file = ide_app.join("out").join("vs").join("test.js");
    let ide_product = ide_app.join("product.json");
    let ide_product_bak = ide_app.join("product.json.codex.bak");
    let cached_data = tmp.join("CachedData");

    fs::create_dir_all(&desktop_res).unwrap();
    fs::create_dir_all(ide_ext.parent().unwrap()).unwrap();
    fs::create_dir_all(ide_out_file.parent().unwrap()).unwrap();
    fs::create_dir_all(&cached_data).unwrap();

    // 构造已安装第三方插件的 Desktop app.asar（含 main/preload 注入 + 第三方额外条目 dist/third-party-plugin.js）
    let third_party_main = "const m=1;\n/* __THIRD_PARTY_MAIN_START__ */\nconsole.log('tp-main');\n/* __THIRD_PARTY_MAIN_END__ */\n";
    let third_party_preload = "const p=1;\n/* __THIRD_PARTY_PRELOAD_START__ */\nconsole.log('tp-preload');\n/* __THIRD_PARTY_PRELOAD_END__ */\n";
    let third_party_extra = b"/* third-party-plugin payload */";

    let mut payload = Vec::new();
    let mut dist_files = serde_json::Map::new();
    for (name, bytes) in [
        ("main.js", third_party_main.as_bytes()),
        ("preload.js", third_party_preload.as_bytes()),
        ("third-party-plugin.js", third_party_extra),
    ] {
        let off = payload.len();
        payload.extend_from_slice(bytes);
        dist_files.insert(
            name.to_string(),
            json!({
                "offset": off.to_string(),
                "size": bytes.len(),
                "integrity": asar::compute_integrity(bytes, 4194304)
            }),
        );
    }
    let root = json!({ "files": { "dist": { "files": dist_files } } });
    fs::write(&desktop_asar, asar::build_asar_buffer(&root, &[&payload]).unwrap()).unwrap();

    // 同目录存在旧 app.asar.bak（不含第三方插件）与第三方备份文件，验证均不被读写或覆盖
    fs::write(&old_generic_bak, b"OLD_GENERIC_BAK_DO_NOT_USE").unwrap();
    fs::write(&third_party_bak, b"THIRD_PARTY_BAK_KEEP_INTACT").unwrap();

    // 构造已安装第三方插件的 IDE extension.js 与历史残留 .codex.bak
    let third_party_ide = "var Jx={};Jx.BaseVsCodeWebviewDelegate=class{renderIframe(){}};\n/* __THIRD_PARTY_IDE_START__ */\nconsole.log('tp-ide');\n/* __THIRD_PARTY_IDE_END__ */\n}.call(Object.assign(Object.create(globalThis), {}));";
    fs::write(&ide_ext, third_party_ide).unwrap();
    fs::write(&ide_ext_bak, "LEGACY_CODEX_BAK_WITHOUT_TP").unwrap();

    fs::write(&ide_out_file, b"console.log('out-with-tp');").unwrap();
    let actual_b64 = STANDARD_NO_PAD.encode(Sha256::digest(b"console.log('out-with-tp');"));
    fs::write(
        &ide_product,
        json!({ "nameShort": "Antigravity IDE", "checksums": { "vs/test.js": actual_b64 } }).to_string(),
    )
    .unwrap();
    fs::write(&ide_product_bak, "{\"stale\":true}").unwrap();

    env::set_var("AG_SLIDER_PLUGIN_ROOT", &plugin_dir);
    env::set_var("ANTIGRAVITY_ASAR_PATH", &desktop_asar);
    env::set_var("ANTIGRAVITY_IDE_PATH", &ide_root);
    env::set_var("AG_SLIDER_IDE_CACHED_DATA", &cached_data);

    // 1. 安装 effort-slider：必须保留第三方插件全部代码与额外文件
    let rep = patcher::install_all(None, None);
    assert!(rep.ok, "coexist install errors: {:?}", rep.errors);

    let main_after_install = asar::read_entry_text_by_seek(&desktop_asar, "dist/main.js").unwrap();
    let preload_after_install = asar::read_entry_text_by_seek(&desktop_asar, "dist/preload.js").unwrap();
    let extra_after_install = asar::read_entry_text_by_seek(&desktop_asar, "dist/third-party-plugin.js").unwrap();
    assert!(main_after_install.contains("__THIRD_PARTY_MAIN_START__"));
    assert!(main_after_install.contains(loader::MAIN_PATCH_START));
    assert!(preload_after_install.contains("__THIRD_PARTY_PRELOAD_START__"));
    assert!(preload_after_install.contains(loader::PRELOAD_PATCH_START));
    assert_eq!(extra_after_install, "/* third-party-plugin payload */");

    let ext_after_install = fs::read_to_string(&ide_ext).unwrap();
    assert!(ext_after_install.contains("__THIRD_PARTY_IDE_START__"));
    assert!(ext_after_install.contains(loader::IDE_PATCH_START));
    assert!(ext_after_install.contains("origRenderIframe.call(this, a, proxiedUrl, c)"));

    // 2. 修复引导器：同样不得抹掉第三方插件
    let rep_repair = patcher::repair_loaders_only(None);
    assert!(rep_repair.ok);
    let main_after_repair = asar::read_entry_text_by_seek(&desktop_asar, "dist/main.js").unwrap();
    assert!(main_after_repair.contains("__THIRD_PARTY_MAIN_START__"));

    // 3. 卸载 effort-slider：精准摘除本插件，第三方插件必须 100% 完好
    let un = patcher::uninstall_all(None);
    assert!(un.ok, "coexist uninstall errors: {:?}", un.errors);

    let main_after_un = asar::read_entry_text_by_seek(&desktop_asar, "dist/main.js").unwrap();
    let preload_after_un = asar::read_entry_text_by_seek(&desktop_asar, "dist/preload.js").unwrap();
    let extra_after_un = asar::read_entry_text_by_seek(&desktop_asar, "dist/third-party-plugin.js").unwrap();
    assert!(!main_after_un.contains(loader::MAIN_PATCH_START));
    assert!(main_after_un.contains("__THIRD_PARTY_MAIN_START__"));
    assert!(!preload_after_un.contains(loader::PRELOAD_PATCH_START));
    assert!(preload_after_un.contains("__THIRD_PARTY_PRELOAD_START__"));
    assert_eq!(extra_after_un, "/* third-party-plugin payload */");

    let ext_after_un = fs::read_to_string(&ide_ext).unwrap();
    assert!(!ext_after_un.contains(loader::IDE_PATCH_START));
    assert!(ext_after_un.contains("__THIRD_PARTY_IDE_START__"));
    assert!(!ide_ext_bak.exists(), "历史遗留 extension.js.codex.bak 应被清理");
    assert!(!ide_product_bak.exists(), "历史遗留 product.json.codex.bak 应被清理");

    let prod_after_un: serde_json::Value = serde_json::from_str(&fs::read_to_string(&ide_product).unwrap()).unwrap();
    assert_eq!(prod_after_un["checksums"]["vs/test.js"].as_str(), Some(actual_b64.as_str()));

    assert_eq!(fs::read(&old_generic_bak).unwrap(), b"OLD_GENERIC_BAK_DO_NOT_USE");
    assert_eq!(fs::read(&third_party_bak).unwrap(), b"THIRD_PARTY_BAK_KEEP_INTACT");

    env::remove_var("AG_SLIDER_PLUGIN_ROOT");
    env::remove_var("ANTIGRAVITY_ASAR_PATH");
    env::remove_var("ANTIGRAVITY_IDE_PATH");
    env::remove_var("AG_SLIDER_IDE_CACHED_DATA");
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn test_coexisting_detection_and_deferred_op_preserves_late_plugin() {
    let _guard = ENV_LOCK.lock().unwrap();
    let tmp = make_temp_dir("deferred-op");
    let plugins_dir = tmp.join("plugins");
    let plugin_dir = plugins_dir.join(paths::PLUGIN_DIR_NAME);
    let desktop_asar = tmp.join("desktop").join("resources").join("app.asar");
    fs::create_dir_all(desktop_asar.parent().unwrap()).unwrap();

    // 1. 构造含第三方补丁标记的 app.asar（无同级插件目录时应通用探测为「其他第三方补丁」）
    let main_raw = b"const m=1;\n";
    let preload_raw = b"const p=1;\n";
    let overlay_tp = b"/* __AG_THIRD_PARTY_LOADER_START__ */\nexports.attachLoadingOverlay=()=>{};\n";
    let tray_raw = b"const trayOrig = true;\n";

    let build_custom_asar = |entries: &[(&str, &[u8])]| -> Vec<u8> {
        let mut payload = Vec::new();
        let mut dist_files = serde_json::Map::new();
        for (name, bytes) in entries {
            let off = payload.len();
            payload.extend_from_slice(bytes);
            dist_files.insert(
                name.to_string(),
                json!({
                    "offset": off.to_string(),
                    "size": bytes.len(),
                    "integrity": asar::compute_integrity(bytes, 4194304)
                }),
            );
        }
        let root = json!({ "files": { "dist": { "files": dist_files } } });
        asar::build_asar_buffer(&root, &[&payload]).unwrap()
    };

    fs::write(
        &desktop_asar,
        build_custom_asar(&[
            ("main.js", main_raw),
            ("preload.js", preload_raw),
            ("loadingOverlay.js", overlay_tp),
            ("tray.js", tray_raw),
        ]),
    )
    .unwrap();

    env::set_var("AG_SLIDER_PLUGIN_ROOT", &plugin_dir);
    env::set_var("ANTIGRAVITY_ASAR_PATH", &desktop_asar);
    env::set_var("ANTIGRAVITY_IDE_PATH", tmp.join("no-ide"));

    let st = patcher::inspect_status(None);
    assert_eq!(st.desktop_targets.len(), 1);
    assert_eq!(st.desktop_targets[0].coexisting_plugins, vec!["其他第三方补丁".to_string()]);

    // 1.5 同级目录存在任意第三方插件 plugin.json 时，应动态识别其 displayName
    let other_plugin_dir = plugins_dir.join("other-plugin");
    fs::create_dir_all(&other_plugin_dir).unwrap();
    fs::write(
        other_plugin_dir.join("plugin.json"),
        r#"{"name":"other-plugin","displayName":"示例第三方插件"}"#,
    )
    .unwrap();
    let st_with_sibling = patcher::inspect_status(None);
    assert_eq!(
        st_with_sibling.desktop_targets[0].coexisting_plugins,
        vec!["示例第三方插件".to_string()]
    );

    // 2. 模拟先安装 effort-slider，之后第三方插件更新写入了新内容，再执行动态重算卸载
    let rep = patcher::install_all(None, None);
    assert!(rep.ok);

    let cur_main = asar::read_entry_text_by_seek(&desktop_asar, "dist/main.js").unwrap();
    let cur_preload = asar::read_entry_text_by_seek(&desktop_asar, "dist/preload.js").unwrap();
    let late_tray = b"/* __AG_TP_PATCH:TRAY_ICON:ORIG=dHJheQ==__ */const lateIcon=1;/* __AG_TP_PATCH:TRAY_ICON:END__ */";
    fs::write(
        &desktop_asar,
        build_custom_asar(&[
            ("main.js", cur_main.as_bytes()),
            ("preload.js", cur_preload.as_bytes()),
            ("loadingOverlay.js", overlay_tp),
            ("tray.js", late_tray),
        ]),
    )
    .unwrap();

    assert!(patcher::run_deferred_op("uninstall", &desktop_asar, None));

    let final_main = asar::read_entry_text_by_seek(&desktop_asar, "dist/main.js").unwrap();
    let final_preload = asar::read_entry_text_by_seek(&desktop_asar, "dist/preload.js").unwrap();
    let final_overlay = asar::read_entry_text_by_seek(&desktop_asar, "dist/loadingOverlay.js").unwrap();
    let final_tray = asar::read_entry_text_by_seek(&desktop_asar, "dist/tray.js").unwrap();

    assert!(!final_main.contains(loader::MAIN_PATCH_START));
    assert!(!final_preload.contains(loader::PRELOAD_PATCH_START));
    assert_eq!(final_overlay.as_bytes(), overlay_tp);
    assert_eq!(final_tray.as_bytes(), late_tray);
    assert!(other_plugin_dir.exists());

    env::remove_var("AG_SLIDER_PLUGIN_ROOT");
    env::remove_var("ANTIGRAVITY_ASAR_PATH");
    env::remove_var("ANTIGRAVITY_IDE_PATH");
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn test_sidecar_http_auth_settings_sync_and_surgical_uninstall() {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::Arc;
    use std::thread;

    let _guard = ENV_LOCK.lock().unwrap();
    let tmp = make_temp_dir("sidecar-http");
    let plugins_dir = tmp.join("plugins");
    let plugin_dir = plugins_dir.join(paths::PLUGIN_DIR_NAME);
    let legacy_dir = plugins_dir.join("codex-effort-slider");
    let other_dir = plugins_dir.join("other-third-party-plugin");
    fs::create_dir_all(&legacy_dir).unwrap();
    fs::write(legacy_dir.join("plugin.json"), "{}").unwrap();
    fs::create_dir_all(&other_dir).unwrap();
    fs::write(other_dir.join("plugin.json"), r#"{"name":"other-third-party-plugin"}"#).unwrap();

    let desktop_asar = tmp.join("desktop").join("resources").join("app.asar");
    fs::create_dir_all(desktop_asar.parent().unwrap()).unwrap();
    fs::write(&desktop_asar, build_mock_asar("const m=1;", "const p=1;", false)).unwrap();

    env::set_var("AG_SLIDER_PLUGIN_ROOT", &plugin_dir);
    env::set_var("AG_SLIDER_GEMINI_CONFIG_DIR", tmp.join("gemini-cfg"));
    env::set_var("ANTIGRAVITY_ASAR_PATH", &desktop_asar);
    env::set_var("ANTIGRAVITY_IDE_PATH", tmp.join("no-ide"));

    let rep = patcher::install_all(None, None);
    assert!(rep.ok);
    assert!(!legacy_dir.exists(), "安装时应自动清理旧实验目录 codex-effort-slider");
    assert!(other_dir.exists(), "安装时绝不能触碰其他第三方插件目录");
    assert!(paths::logo_svg_path().exists(), "应写入 assets/logo.svg");
    assert!(paths::sidecar_html_path().exists(), "应写入 lib/sidecar-panel.html");
    assert!(paths::sidecar_json_path().exists(), "应写入 sidecars/slider_panel/sidecar.json");

    let plugin_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(paths::plugin_json_path()).unwrap()).unwrap();
    assert_eq!(plugin_json["logo"].as_str(), Some("assets/logo.svg"));

    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let cfg = Arc::new(crate::sidecar::SidecarConfig {
        token: Some("tok-150".to_string()),
    });
    thread::spawn(move || {
        for inc in listener.incoming().take(6) {
            if let Ok(s) = inc {
                let c = Arc::clone(&cfg);
                thread::spawn(move || crate::sidecar::handle_client_stream(s, c));
            }
        }
    });

    let send_http = |req: &str| -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(req.as_bytes()).unwrap();
        s.flush().unwrap();
        let mut resp = String::new();
        let _ = s.read_to_string(&mut resp);
        resp
    };

    // 1. 无 token 访问 /api/state -> 401
    let r1 = send_http("GET /api/state HTTP/1.1\r\nHost: localhost\r\n\r\n");
    assert!(r1.starts_with("HTTP/1.1 401"));

    // 2. 获取 /assets/logo.svg -> 200 & 拦截路径穿越 -> 400
    let r2 = send_http("GET /assets/logo.svg HTTP/1.1\r\nHost: localhost\r\n\r\n");
    assert!(r2.starts_with("HTTP/1.1 200"));
    assert!(r2.contains("<svg"));
    let r3 = send_http("GET /assets/..%2Fsecret HTTP/1.1\r\nHost: localhost\r\n\r\n");
    assert!(r3.starts_with("HTTP/1.1 400"));

    // 3. POST /api/settings 修改 motion 与 ticks 并持久化到 state.json
    let body = r#"{"motion":"fast","ticks":"dim"}"#;
    let r4 = send_http(&format!(
        "POST /api/settings HTTP/1.1\r\nHost: localhost\r\nX-Sidecar-Token: tok-150\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    ));
    assert!(r4.starts_with("HTTP/1.1 200"));
    assert!(r4.contains(r#""motion":"fast""#));
    assert_eq!(state::load_state().motion, "fast");
    assert_eq!(state::load_state().ticks, "dim");

    // 4. POST /api/uninstall 精准卸载并保留其他第三方插件
    let r5 = send_http(
        "POST /api/uninstall HTTP/1.1\r\nHost: localhost\r\nX-Sidecar-Token: tok-150\r\nContent-Length: 2\r\n\r\n{}",
    );
    assert!(r5.starts_with("HTTP/1.1 200"));
    assert!(r5.contains(r#""ok":true"#));
    assert!(other_dir.exists(), "卸载后必须保留其他第三方插件目录");
    assert!(!paths::plugin_json_path().exists(), "卸载后应移除本插件 plugin.json");

    env::remove_var("AG_SLIDER_PLUGIN_ROOT");
    env::remove_var("AG_SLIDER_GEMINI_CONFIG_DIR");
    env::remove_var("ANTIGRAVITY_ASAR_PATH");
    env::remove_var("ANTIGRAVITY_IDE_PATH");
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn test_ide_dynamic_namespace_and_content_based_entry_resolution() {
    let _guard = ENV_LOCK.lock().unwrap();

    // 1. 动态命名空间解析：兼容 2.6 (sv)、2.9 (Jx)、自定义标识符并忽略字符串/关键字干扰
    assert_eq!(
        loader::extract_ide_webview_delegate_namespace(
            r#"const msg="fake.BaseVsCodeWebviewDelegate";class A extends sv.BaseVsCodeWebviewDelegate{}sv.BaseVsCodeWebviewDelegate=class{};"#
        ),
        Some("sv".to_string())
    );
    assert_eq!(
        loader::extract_ide_webview_delegate_namespace(
            r#"Jx.BaseVsCodeWebviewDelegate=class{renderIframe(){}}"#
        ),
        Some("Jx".to_string())
    );
    assert_eq!(
        loader::extract_ide_webview_delegate_namespace(
            r#"const noop = "no delegate here";"#
        ),
        None
    );

    // 2. 缺失 BaseVsCodeWebviewDelegate 或 Closure 锚点时必须报错中止，绝不盲写
    let err_no_ns = loader::apply_ide_extension_patch(
        "function init(){}\n}.call(Object.assign(Object.create(globalThis), {}));",
        Path::new("C:/tmp/plugin"),
        "console.log(1);",
    );
    assert!(err_no_ns.is_err(), "缺少 BaseVsCodeWebviewDelegate 时应返回错误");

    let err_no_anchor = loader::apply_ide_extension_patch(
        "Jx.BaseVsCodeWebviewDelegate=class{renderIframe(){}};",
        Path::new("C:/tmp/plugin"),
        "console.log(1);",
    );
    assert!(err_no_anchor.is_err(), "缺少 Closure 锚点时应返回错误");

    // 3. 模拟 Antigravity IDE 2.8/2.9 真实布局：package.json.main 指向 dist/extension.js（Webpack 转发壳），
    //    真正的 BaseVsCodeWebviewDelegate（前缀 Jx）在 vscode/extension.js；同时假设 dist/extension.js 被历史误打过补丁
    let tmp = make_temp_dir("ide-290-layout");
    let plugin_dir = tmp.join("plugin-root");
    let desktop_asar = tmp.join("desktop").join("resources").join("app.asar");
    let ide_root = tmp.join("ide");
    let ide_app = ide_root.join("resources").join("app");
    let agy_dir = ide_app.join("extensions").join("agy");
    let dist_ext = agy_dir.join("dist").join("extension.js");
    let vscode_ext = agy_dir.join("vscode").join("extension.js");

    fs::create_dir_all(desktop_asar.parent().unwrap()).unwrap();
    fs::create_dir_all(dist_ext.parent().unwrap()).unwrap();
    fs::create_dir_all(vscode_ext.parent().unwrap()).unwrap();
    fs::write(&desktop_asar, build_mock_asar("const m=1;", "const p=1;", false)).unwrap();
    fs::write(ide_app.join("product.json"), r#"{"nameShort":"Antigravity IDE"}"#).unwrap();
    fs::write(agy_dir.join("package.json"), r#"{"name":"google-antigravity","version":"1.13.0","main":"./dist/extension.js"}"#).unwrap();
    fs::write(
        &dist_ext,
        format!(
            "(()=>{{module.exports=require('../vscode/extension.js');}})();\n{}\nconsole.log('stale');\n{}\n",
            loader::IDE_PATCH_START,
            loader::IDE_PATCH_END
        ),
    )
    .unwrap();
    fs::write(
        &vscode_ext,
        "var Jx={};Jx.BaseVsCodeWebviewDelegate=class{renderIframe(a,b,c){}};\n}.call(Object.assign(Object.create(globalThis), {}));",
    )
    .unwrap();

    env::set_var("AG_SLIDER_PLUGIN_ROOT", &plugin_dir);
    env::set_var("ANTIGRAVITY_ASAR_PATH", &desktop_asar);
    env::set_var("ANTIGRAVITY_IDE_PATH", &ide_root);
    env::set_var("AG_SLIDER_IDE_CACHED_DATA", tmp.join("CachedData"));

    let detected = paths::find_ide_extension_files();
    assert_eq!(detected.len(), 1);
    assert!(detected[0].ends_with(Path::new("vscode").join("extension.js")));

    let rep = patcher::install_all(None, None);
    assert!(rep.ok, "2.9.0 布局安装应成功: {:?}", rep.errors);

    let patched_vscode = fs::read_to_string(&vscode_ext).unwrap();
    assert!(patched_vscode.contains(loader::IDE_PATCH_START));
    assert!(patched_vscode.contains("Jx.BaseVsCodeWebviewDelegate.prototype.renderIframe"));
    let cleaned_dist = fs::read_to_string(&dist_ext).unwrap();
    assert!(!cleaned_dist.contains(loader::IDE_PATCH_START), "非目标 dist/extension.js 中残留的历史标记应被清理");

    // 4. 模拟未来版本将 BaseVsCodeWebviewDelegate 迁入 dist/extension.js（且 vscode/extension.js 为不含特征的残留壳）
    fs::write(&vscode_ext, "// legacy stub without webview delegate").unwrap();
    fs::write(
        &dist_ext,
        "var Kz={};Kz.BaseVsCodeWebviewDelegate=class{renderIframe(a,b,c){}};\n}.call(Object.assign(Object.create(globalThis), {}));",
    )
    .unwrap();

    let detected_future = paths::find_ide_extension_files();
    assert_eq!(detected_future.len(), 1);
    assert!(detected_future[0].ends_with(Path::new("dist").join("extension.js")));

    let rep_future = patcher::install_all(None, None);
    assert!(rep_future.ok, "未来 dist 主体布局安装应成功: {:?}", rep_future.errors);
    let patched_dist = fs::read_to_string(&dist_ext).unwrap();
    assert!(patched_dist.contains("Kz.BaseVsCodeWebviewDelegate.prototype.renderIframe"));

    // 5. 卸载应清理全部候选文件中的本插件标记
    let un = patcher::uninstall_all(None);
    assert!(un.ok, "卸载应成功: {:?}", un.errors);
    assert!(!fs::read_to_string(&dist_ext).unwrap().contains(loader::IDE_PATCH_START));
    assert!(!fs::read_to_string(&vscode_ext).unwrap().contains(loader::IDE_PATCH_START));

    env::remove_var("AG_SLIDER_PLUGIN_ROOT");
    env::remove_var("ANTIGRAVITY_ASAR_PATH");
    env::remove_var("ANTIGRAVITY_IDE_PATH");
    env::remove_var("AG_SLIDER_IDE_CACHED_DATA");
    let _ = fs::remove_dir_all(&tmp);
}
