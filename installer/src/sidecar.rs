//! Antigravity 原生 Sidecar HTTP 服务模块（零 Node.js 依赖）。
//!
//! 为右侧 Overview -> Plugins 辅助面板提供本地 Web UI 与双向配置同步 API：
//! - `GET /` / `/index.html`: 控制面板页面
//! - `GET /preload.js`: Antigravity sidecar_sdk 主题与鉴权桥接（缺失时自动兜底）
//! - `GET /assets/<name>`: 插件静态资源（如 logo.svg，带路径穿越拦截）
//! - `GET /api/state`: 读取当前 state.json、补丁状态与宿主亮/暗色主题
//! - `POST /api/settings`: 修改 motion / ticks 或恢复默认（实时热同步到 Desktop/IDE）
//! - `POST /api/update/config`: 修改 autoUpdate / mirrorPrefix
//! - `POST /api/update/check`: 立即检查并拉取 GitHub Release 更新
//! - `POST /api/repair`: 一键修复引导器（保留共存插件）
//! - `POST /api/relaunch`: 触发 Antigravity 重启生效
//! - `POST /api/uninstall`: 执行与安装包一致的精准卸载（保留其他插件）

use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::patcher;
use crate::paths;
use crate::state;
use crate::updater;

const MAX_BODY_BYTES: usize = 256 * 1024;

#[derive(Clone)]
pub struct SidecarConfig {
    pub token: Option<String>,
}

/// 读取 Antigravity 全局 config.json 中的主题模式，用于 Sidecar 首屏亮/暗色判定
pub fn detect_host_is_dark() -> bool {
    let path = paths::gemini_config_dir().join("config.json");
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(val) = serde_json::from_str::<Value>(&raw) {
            let mode = val
                .get("userSettings")
                .and_then(|u| u.get("themeMode"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if mode.contains("LIGHT") {
                return false;
            }
            if mode.contains("DARK") {
                return true;
            }
        }
    }
    true
}

fn resolve_sidecar_html() -> Vec<u8> {
    let path = paths::sidecar_html_path();
    if let Ok(bytes) = fs::read(path) {
        return bytes;
    }
    patcher::BUNDLED_SIDECAR_HTML.as_bytes().to_vec()
}

fn resolve_preload_js() -> Vec<u8> {
    let sdk_preload = paths::gemini_config_dir()
        .join("node_modules")
        .join("sidecar_sdk")
        .join("preload.js");
    if let Ok(bytes) = fs::read(sdk_preload) {
        return bytes;
    }
    br#"(function(){var t=new URLSearchParams(window.location.search).get('token');window.sidecar={fetch:function(u,o){o=o||{};var h=new Headers(o.headers||{});if(!h.has('Content-Type'))h.set('Content-Type','application/json');if(t)h.set('X-Sidecar-Token',t);return fetch(u,Object.assign({},o,{headers:h}));}};})();"#.to_vec()
}

fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("非法 URL 编码".to_string());
            }
            let hex_str = std::str::from_utf8(&bytes[i + 1..i + 3])
                .map_err(|_| "非法 UTF-8 编码".to_string())?;
            let val = u8::from_str_radix(hex_str, 16)
                .map_err(|_| "非法十六进制编码".to_string())?;
            out.push(val);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "文件名不是合法 UTF-8".to_string())
}

fn resolve_asset_bytes(encoded_name: &str) -> Result<Option<(Vec<u8>, &'static str)>, String> {
    let name = percent_decode(encoded_name)?;
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains('\0')
    {
        return Err("非法素材路径".to_string());
    }

    let lower = name.to_ascii_lowercase();
    let mime = if lower.ends_with(".svg") {
        "image/svg+xml; charset=utf-8"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else {
        "image/png"
    };

    let disk_path = paths::plugin_root().join("assets").join(&name);
    if disk_path.exists() && disk_path.is_file() {
        if let Ok(bytes) = fs::read(&disk_path) {
            return Ok(Some((bytes, mime)));
        }
    }

    if name == "logo.svg" {
        return Ok(Some((patcher::BUNDLED_LOGO_SVG.as_bytes().to_vec(), mime)));
    }
    Ok(None)
}

fn send_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn send_json(stream: &mut TcpStream, status: &str, val: &Value) {
    let body = serde_json::to_vec(val).unwrap_or_else(|_| b"{}".to_vec());
    send_response(stream, status, "application/json; charset=utf-8", &body);
}

fn parse_query_params(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut kv = pair.splitn(2, '=');
        let k = kv.next().unwrap_or("");
        let v = kv.next().unwrap_or("");
        if let (Ok(dk), Ok(dv)) = (percent_decode(k), percent_decode(v)) {
            map.insert(dk.to_ascii_lowercase(), dv);
        }
    }
    map
}

pub fn handle_client_stream(mut stream: TcpStream, cfg: Arc<SidecarConfig>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));

    let mut raw = Vec::new();
    let mut buf = [0u8; 4096];
    let mut header_end = None;

    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                if raw.len() > MAX_BODY_BYTES + 16 * 1024 {
                    send_json(&mut stream, "413 Payload Too Large", &json!({"error": "too large"}));
                    return;
                }
                if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    header_end = Some(pos + 4);
                    break;
                }
            }
            Err(_) => return,
        }
    }

    let Some(hdr_end) = header_end else {
        return;
    };
    let hdr_text = String::from_utf8_lossy(&raw[..hdr_end]).into_owned();
    let mut lines = hdr_text.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut req_parts = request_line.split_whitespace();
    let method = req_parts.next().unwrap_or("GET").to_ascii_uppercase();
    let target = req_parts.next().unwrap_or("/").to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let content_len = headers
        .get("content-length")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0)
        .min(MAX_BODY_BYTES);

    while raw.len() < hdr_end + content_len {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => raw.extend_from_slice(&buf[..n]),
        }
    }
    let body_slice = &raw[hdr_end..raw.len().min(hdr_end + content_len)];

    let (path_only, query_str) = target.split_once('?').unwrap_or((&target, ""));
    let query_params = parse_query_params(query_str);

    // 校验 X-Sidecar-Token（所有非 GET 请求和 /api/* 请求均强制鉴权）
    if let Some(expected) = cfg.token.as_deref() {
        if !expected.is_empty() && (method != "GET" || path_only.starts_with("/api/")) {
            let provided = headers
                .get("x-sidecar-token")
                .map(|s| s.as_str())
                .or_else(|| query_params.get("token").map(|s| s.as_str()))
                .unwrap_or("");
            if provided != expected {
                send_json(&mut stream, "401 Unauthorized", &json!({"error": "unauthorized"}));
                return;
            }
        }
    }

    match (method.as_str(), path_only) {
        ("GET", "/") | ("GET", "/index.html") => {
            let html = resolve_sidecar_html();
            send_response(&mut stream, "200 OK", "text/html; charset=utf-8", &html);
        }
        ("GET", "/preload.js") => {
            let js = resolve_preload_js();
            send_response(&mut stream, "200 OK", "application/javascript; charset=utf-8", &js);
        }
        ("GET", p) if p.starts_with("/assets/") => {
            let name = &p["/assets/".len()..];
            match resolve_asset_bytes(name) {
                Ok(Some((bytes, mime))) => send_response(&mut stream, "200 OK", mime, &bytes),
                Ok(None) => send_response(&mut stream, "404 Not Found", "text/plain", b"Not found"),
                Err(_) => send_response(&mut stream, "400 Bad Request", "text/plain", b"Bad request"),
            }
        }
        ("GET", "/api/state") => {
            let st = state::load_state();
            let status = patcher::inspect_status(None);
            send_json(
                &mut stream,
                "200 OK",
                &json!({
                    "ok": true,
                    "state": st,
                    "status": status,
                    "hostIsDark": detect_host_is_dark(),
                }),
            );
        }
        ("POST", "/api/settings") => {
            let parsed: Value = serde_json::from_slice(body_slice).unwrap_or_else(|_| json!({}));
            let mut st = state::load_state();
            if parsed.get("reset").and_then(|v| v.as_bool()) == Some(true) {
                st.motion = state::default_motion();
                st.ticks = state::default_ticks();
            } else {
                if let Some(m) = parsed.get("motion").and_then(|v| v.as_str()) {
                    st.motion = state::normalize_motion(m).to_string();
                }
                if let Some(t) = parsed.get("ticks").and_then(|v| v.as_str()) {
                    st.ticks = state::normalize_ticks(t).to_string();
                }
            }
            match state::save_state(&st) {
                Ok(()) => send_json(&mut stream, "200 OK", &json!({ "ok": true, "state": st })),
                Err(e) => send_json(&mut stream, "500 Internal Server Error", &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/update/config") => {
            let parsed: Value = serde_json::from_slice(body_slice).unwrap_or_else(|_| json!({}));
            let mut st = state::load_state();
            if let Some(v) = parsed.get("autoUpdate").and_then(|b| b.as_bool()) {
                st.auto_update = v;
            }
            if let Some(m) = parsed.get("mirrorPrefix").and_then(|s| s.as_str()) {
                st.mirror_prefix = m.trim().to_string();
            }
            match state::save_state(&st) {
                Ok(()) => send_json(&mut stream, "200 OK", &json!({ "ok": true, "state": st })),
                Err(e) => send_json(&mut stream, "500 Internal Server Error", &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/update/check") => {
            let res = updater::check_and_apply_update(true, false);
            let st = state::load_state();
            send_json(
                &mut stream,
                "200 OK",
                &json!({ "ok": res.ok, "result": res, "state": st }),
            );
        }
        ("POST", "/api/repair") => {
            let rep = patcher::repair_loaders_only(None);
            let st = state::load_state();
            let status = patcher::inspect_status(None);
            send_json(
                &mut stream,
                "200 OK",
                &json!({ "ok": rep.ok, "report": rep, "status": status, "state": st }),
            );
        }
        ("POST", "/api/relaunch") => {
            let req_path = paths::relaunch_request_path();
            if let Some(parent) = req_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(&req_path, state::now_unix_secs().to_string());
            send_json(&mut stream, "200 OK", &json!({ "ok": true }));
        }
        ("POST", "/api/uninstall") => {
            // 先写入卸载信号让正在运行的 Desktop 主进程即时卸载当前页面滑条 DOM
            let req_path = paths::uninstall_request_path();
            if let Some(parent) = req_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(&req_path, state::now_unix_secs().to_string());
            let rep = patcher::uninstall_all(None);
            send_json(&mut stream, "200 OK", &json!({ "ok": rep.ok, "report": rep }));
        }
        _ => send_response(&mut stream, "404 Not Found", "text/plain", b"Not found"),
    }
}

/// 启动 Sidecar 本地 HTTP 服务器（由 Antigravity 宿主通过 sidecar.json 托管）
pub fn run_sidecar_server(port_override: Option<u16>, token_override: Option<String>) -> Result<(), String> {
    let port = port_override
        .or_else(|| {
            env::var("ANTIGRAVITY_SIDECAR_WEB_PORT")
                .ok()
                .and_then(|s| s.trim().parse::<u16>().ok())
        })
        .unwrap_or(0);
    let token = token_override
        .or_else(|| env::var("ANTIGRAVITY_SIDECAR_UI_TOKEN").ok())
        .filter(|s| !s.trim().is_empty());

    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("Sidecar 监听 127.0.0.1:{port} 失败: {e}"))?;
    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("获取 Sidecar 本地端口失败: {e}"))?;
    println!("[sidecar] listening on 127.0.0.1:{}", local_addr.port());
    let _ = std::io::stdout().flush();

    let cfg = Arc::new(SidecarConfig { token });
    for incoming in listener.incoming() {
        if let Ok(stream) = incoming {
            let cfg_clone = Arc::clone(&cfg);
            thread::spawn(move || handle_client_stream(stream, cfg_clone));
        }
    }
    Ok(())
}
