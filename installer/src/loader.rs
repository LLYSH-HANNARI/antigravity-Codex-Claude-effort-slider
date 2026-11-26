//! 动态引导器（Loader）代码生成与旧补丁剥离模块。
//! - Desktop `dist/main.js`：IPC 桥接、动态读取 <plugin_root>/lib/client.js、启动后台查更新、原生通知与 app.relaunch()
//! - Desktop `dist/preload.js`：暴露受控 `__agCodexSliderBridge` 并通过 webFrame.executeJavaScript 注入 Main World
//! - IDE `extension.js`：动态反向代理 + 同源状态/更新接口 + VS Code 原生通知与重载窗口

use std::path::Path;

use crate::state::{BUNDLED_VERSION, LOADER_VERSION};

pub const MAIN_PATCH_START: &str = "/* __AG_CODEX_EFFORT_SLIDER_MAIN_START__ */";
pub const MAIN_PATCH_END: &str = "/* __AG_CODEX_EFFORT_SLIDER_MAIN_END__ */";

pub const PRELOAD_PATCH_START: &str = "/* __AG_CODEX_EFFORT_SLIDER_START__ */";
pub const PRELOAD_PATCH_END: &str = "/* __AG_CODEX_EFFORT_SLIDER_END__ */";

pub const IDE_PATCH_START: &str = "/* __AG_CODEX_EFFORT_SLIDER_START__ */";
pub const IDE_PATCH_END: &str = "/* __AG_CODEX_EFFORT_SLIDER_END__ */";

pub const IDE_INSERT_ANCHOR: &str = "}.call(Object.assign(Object.create(globalThis)";
pub const IDE_WEBVIEW_DELEGATE_PROP: &str = ".BaseVsCodeWebviewDelegate";

fn is_js_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_' || b == b'$'
}

fn is_js_ident_part(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

fn is_js_keyword(ident: &str) -> bool {
    matches!(
        ident,
        "break"
            | "case"
            | "catch"
            | "class"
            | "const"
            | "continue"
            | "debugger"
            | "default"
            | "delete"
            | "do"
            | "else"
            | "export"
            | "extends"
            | "finally"
            | "for"
            | "function"
            | "if"
            | "import"
            | "in"
            | "instanceof"
            | "new"
            | "return"
            | "super"
            | "switch"
            | "this"
            | "throw"
            | "try"
            | "typeof"
            | "var"
            | "void"
            | "while"
            | "with"
            | "yield"
            | "let"
            | "static"
            | "await"
            | "async"
    )
}

/// 从给定字节偏移 `dot_idx`（即 `.BaseVsCodeWebviewDelegate` 中 `.` 的索引）向前提取合法 JS 命名空间表达式。
/// 典型匹配：`sv.BaseVsCodeWebviewDelegate=class` -> `Some("sv")`，`Jx.BaseVsCodeWebviewDelegate=class` -> `Some("Jx")`。
/// 若支持多级命名空间（如 `a.b.BaseVsCodeWebviewDelegate`），则校验每一段均为合法标识符且首段非关键字。
fn extract_ident_chain_before_dot(bytes: &[u8], dot_idx: usize) -> Option<String> {
    if dot_idx == 0 || dot_idx > bytes.len() {
        return None;
    }
    let mut start = dot_idx;
    while start > 0 {
        let prev = bytes[start - 1];
        if is_js_ident_part(prev) || prev == b'.' {
            start -= 1;
        } else {
            break;
        }
    }
    if start == dot_idx {
        return None;
    }

    // 避免捕获字符串字面量内部的片段（如 "foo.BaseVsCodeWebviewDelegate"）
    if start > 0 && matches!(bytes[start - 1], b'\'' | b'"' | b'`') {
        return None;
    }

    let raw = std::str::from_utf8(&bytes[start..dot_idx]).ok()?;
    let segments: Vec<&str> = raw.split('.').collect();
    if segments.is_empty() {
        return None;
    }
    for (idx, seg) in segments.iter().enumerate() {
        let seg_bytes = seg.as_bytes();
        if seg_bytes.is_empty() || !is_js_ident_start(seg_bytes[0]) {
            return None;
        }
        if !seg_bytes.iter().all(|&b| is_js_ident_part(b)) {
            return None;
        }
        if idx == 0 && is_js_keyword(seg) {
            return None;
        }
    }
    Some(raw.to_string())
}

/// 从 Antigravity IDE `extension.js` 源码中动态提取 `BaseVsCodeWebviewDelegate` 所属的混淆命名空间前缀。
/// 原因：Google Closure Compiler 每次构建版本都会重新分配局部短名（如 2.6.0 为 `sv`，2.9.0 为 `Jx`）。
/// 优先匹配赋值定义处（`<ns>.BaseVsCodeWebviewDelegate = ...`），再兜底匹配有效属性访问处。
pub fn extract_ide_webview_delegate_namespace(source: &str) -> Option<String> {
    let clean = strip_marker_block(source, IDE_PATCH_START, IDE_PATCH_END);
    let bytes = clean.as_bytes();
    let prop_len = IDE_WEBVIEW_DELEGATE_PROP.len();
    let mut fallback_ident: Option<String> = None;

    let mut search_from = 0usize;
    while let Some(rel) = clean[search_from..].find(IDE_WEBVIEW_DELEGATE_PROP) {
        let dot_idx = search_from + rel;
        let after_idx = dot_idx + prop_len;
        search_from = after_idx;

        // 避免误命中更长的属性名（例如 BaseVsCodeWebviewDelegateHelper）
        if after_idx < bytes.len() && is_js_ident_part(bytes[after_idx]) {
            continue;
        }

        let Some(ns) = extract_ident_chain_before_dot(bytes, dot_idx) else {
            continue;
        };

        // 跳过空白后检查是否为赋值定义（`=` 且不是 `==`）
        let mut ws = after_idx;
        while ws < bytes.len() && bytes[ws].is_ascii_whitespace() {
            ws += 1;
        }
        if ws < bytes.len() && bytes[ws] == b'=' && bytes.get(ws + 1) != Some(&b'=') {
            return Some(ns);
        }

        if fallback_ident.is_none() {
            fallback_ident = Some(ns);
        }
    }

    fallback_ident
}

/// 剥离标记区间内的旧补丁文本（同时兼容 v1.2/v1.3 遗留的 require('./antigravity-codex-effort-slider.js')）
pub fn strip_marker_block(source: &str, start_marker: &str, end_marker: &str) -> String {
    let mut cleaned = strip_legacy_require(source);
    loop {
        let Some(start_idx) = cleaned.find(start_marker) else {
            break;
        };
        let Some(rel_end) = cleaned[start_idx..].find(end_marker) else {
            break;
        };
        let end_idx = start_idx + rel_end + end_marker.len();
        let left = cleaned[..start_idx].trim_end();
        let right = cleaned[end_idx..].trim_start();
        cleaned = if right.is_empty() {
            left.to_string()
        } else if left.is_empty() {
            right.to_string()
        } else {
            format!("{left}\n{right}")
        };
    }
    cleaned
}

fn strip_legacy_require(source: &str) -> String {
    // 清理早期版本遗留的 `try { require('./antigravity-codex-effort-slider.js'); } catch (...) { ... }`
    let needle = "antigravity-codex-effort-slider.js";
    if !source.contains(needle) {
        return source.to_string();
    }
    let mut out = Vec::new();
    for line in source.lines() {
        if line.contains(needle) && line.contains("require(") {
            continue;
        }
        out.push(line);
    }
    out.join("\n")
}

/// 快速检查文本中是否包含有效的新版 Loader 标记
pub fn has_loader_marker(source: &str, start_marker: &str) -> bool {
    source.contains(start_marker)
}

/// 解析补丁中嵌入的引导器版本号（`/* __AG_LOADER_VERSION=1__ */`）
pub fn parse_loader_version(source: &str) -> Option<u32> {
    let tag = "__AG_LOADER_VERSION=";
    let idx = source.find(tag)?;
    let rest = &source[idx + tag.len()..];
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u32>().ok()
}

/// 生成 Desktop `dist/main.js` 轻量引导器补丁
pub fn build_desktop_main_patch(plugin_root: &Path, fallback_client_js: &str) -> String {
    let root_lit = serde_json::to_string(&plugin_root.to_string_lossy().to_string())
        .unwrap_or_else(|_| "\"\"".to_string());
    let fallback_lit = serde_json::to_string(fallback_client_js).unwrap_or_else(|_| "\"\"".to_string());

    format!(
        r#"{start}
/* __AG_LOADER_VERSION={ver}__ */
(function () {{
  try {{
    if (global.__agCodexSliderMainBootstrapped) return;
    global.__agCodexSliderMainBootstrapped = true;

    const fs = require('node:fs');
    const path = require('node:path');
    const {{ execFile, spawn }} = require('node:child_process');
    const electronMod = require('electron');
    const {{ app, ipcMain, BrowserWindow, Notification }} = electronMod;

    const DEFAULT_PLUGIN_ROOT = {root_lit};
    const FALLBACK_CLIENT_CODE = {fallback_lit};

    function getPluginRoot() {{
      const envRoot = process.env.AG_SLIDER_PLUGIN_ROOT;
      return envRoot && envRoot.trim() ? envRoot.trim() : DEFAULT_PLUGIN_ROOT;
    }}

    function getBinaryPath() {{
      const binName = process.platform === 'win32' ? 'ag-effort-slider.exe' : 'ag-effort-slider';
      return path.join(getPluginRoot(), 'bin', binName);
    }}

    function getStatePath() {{
      return path.join(getPluginRoot(), 'state.json');
    }}

    function getClientPath() {{
      return path.join(getPluginRoot(), 'lib', 'client.js');
    }}

    function readStateSafe() {{
      try {{
        const raw = fs.readFileSync(getStatePath(), 'utf8');
        const parsed = JSON.parse(raw);
        const motion = (parsed.motion === 'fast' || parsed.motion === 'quick') ? parsed.motion : 'full';
        const ticks = (parsed.ticks === 'dim' || parsed.ticks === 'hidden') ? parsed.ticks : 'highlight';
        return {{
          version: parsed.version || '{pkg_ver}',
          loaderVersion: parsed.loaderVersion || {ver},
          motion,
          ticks,
          autoUpdate: parsed.autoUpdate !== false,
          checkIntervalHours: Number(parsed.checkIntervalHours || 12),
          mirrorPrefix: typeof parsed.mirrorPrefix === 'string' ? parsed.mirrorPrefix : '',
          lastCheckAt: Number(parsed.lastCheckAt || 0),
          pendingUpdateVersion: parsed.pendingUpdateVersion || null,
          pendingUpdateNotes: parsed.pendingUpdateNotes || null,
          pendingLoaderUpgrade: Boolean(parsed.pendingLoaderUpgrade),
          platform: 'desktop',
          canRelaunch: true
        }};
      }} catch {{
        return {{
          version: '{pkg_ver}',
          loaderVersion: {ver},
          motion: 'full',
          ticks: 'highlight',
          autoUpdate: true,
          checkIntervalHours: 12,
          mirrorPrefix: '',
          lastCheckAt: 0,
          pendingUpdateVersion: null,
          pendingUpdateNotes: null,
          pendingLoaderUpgrade: false,
          platform: 'desktop',
          canRelaunch: true
        }};
      }}
    }}

    let lastBroadcastStateJson = '';
    function broadcastToAllWindows(channel, payload) {{
      try {{
        for (const win of BrowserWindow.getAllWindows()) {{
          if (win && !win.isDestroyed() && win.webContents) {{
            win.webContents.send(channel, payload);
          }}
        }}
      }} catch {{}}
    }}

    function broadcastStateChanged(st) {{
      const s = st || readStateSafe();
      const fp = JSON.stringify({{ m: s.motion, t: s.ticks, a: s.autoUpdate, r: s.mirrorPrefix, l: s.lastCheckAt, p: s.pendingUpdateVersion, v: s.version }});
      if (fp === lastBroadcastStateJson) return;
      lastBroadcastStateJson = fp;
      broadcastToAllWindows('codex-slider:state-changed', s);
    }}

    function writeStatePatchSafe(cfg) {{
      try {{
        const statePath = getStatePath();
        const dir = path.dirname(statePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, {{ recursive: true }});
        let rawObj = {{}};
        try {{
          rawObj = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        }} catch {{
          rawObj = {{
            version: '{pkg_ver}',
            loaderVersion: {ver},
            motion: 'full',
            ticks: 'highlight',
            autoUpdate: true,
            checkIntervalHours: 12,
            mirrorPrefix: '',
            lastCheckAt: 0,
            pendingUpdateVersion: null,
            pendingUpdateNotes: null,
            pendingLoaderUpgrade: false
          }};
        }}
        if (cfg && typeof cfg === 'object') {{
          if (cfg.resetAppearance) {{
            rawObj.motion = 'full';
            rawObj.ticks = 'highlight';
          }}
          if (cfg.motion === 'full' || cfg.motion === 'fast' || cfg.motion === 'quick') {{
            rawObj.motion = cfg.motion;
          }}
          if (cfg.ticks === 'highlight' || cfg.ticks === 'dim' || cfg.ticks === 'hidden') {{
            rawObj.ticks = cfg.ticks;
          }}
          if (typeof cfg.autoUpdate === 'boolean') {{
            rawObj.autoUpdate = cfg.autoUpdate;
          }}
          if (typeof cfg.mirrorPrefix === 'string') {{
            rawObj.mirrorPrefix = cfg.mirrorPrefix.trim();
          }}
        }}
        const nextText = JSON.stringify(rawObj, null, 2) + '\n';
        const tmpPath = statePath + '.tmp';
        fs.writeFileSync(tmpPath, nextText, 'utf8');
        try {{
          fs.renameSync(tmpPath, statePath);
        }} catch {{
          fs.writeFileSync(statePath, nextText, 'utf8');
          try {{ fs.unlinkSync(tmpPath); }} catch {{}}
        }}
      }} catch (err) {{
        console.error('[CodexSlider] writeStatePatchSafe error:', err);
      }}
      const nextState = readStateSafe();
      broadcastStateChanged(nextState);
      return nextState;
    }}

    function runEngine(args) {{
      return new Promise((resolve) => {{
        const bin = getBinaryPath();
        if (!fs.existsSync(bin)) {{
          resolve({{ ok: false, error: '未找到本地更新引擎' }});
          return;
        }}
        execFile(bin, args, {{ windowsHide: true, timeout: 60000 }}, (err, stdout) => {{
          const text = String(stdout || '').trim();
          if (text) {{
            try {{
              resolve(JSON.parse(text));
              return;
            }} catch {{}}
          }}
          resolve({{ ok: false, error: err ? err.message : '更新引擎无返回' }});
        }});
      }});
    }}

    function broadcastUpdateReady(payload) {{
      broadcastToAllWindows('codex-slider:update-ready', payload);
    }}

    function showNativeUpdateNotification(version) {{
      try {{
        if (typeof Notification !== 'function' || (Notification.isSupported && !Notification.isSupported())) return;
        const notif = new Notification({{
          title: '推理等级滑条已更新至 v' + version,
          body: '新版本已校验就绪，点击立即重启 Antigravity 生效。'
        }});
        notif.on('click', () => {{
          triggerRelaunch();
        }});
        notif.show();
      }} catch {{}}
    }}

    function triggerRelaunch() {{
      try {{
        const resourcesDir = process.resourcesPath || '';
        const asarPath = resourcesDir ? path.join(resourcesDir, 'app.asar') : '';
        const stagedPath = asarPath ? asarPath + '.codex-staged' : '';
        if (stagedPath && fs.existsSync(stagedPath)) {{
          const bin = getBinaryPath();
          if (fs.existsSync(bin)) {{
            const child = spawn(bin, [
              'deferred-swap',
              '--staged', stagedPath,
              '--target', asarPath,
              '--relaunch', process.execPath
            ], {{ detached: true, stdio: 'ignore', windowsHide: true }});
            child.unref();
          }}
          app.exit(0);
          return;
        }}
        app.relaunch();
        app.exit(0);
      }} catch (err) {{
        console.error('[CodexSlider] relaunch error:', err);
      }}
    }}

    if (ipcMain && typeof ipcMain.handle === 'function') {{
      ipcMain.handle('codex-slider:load-client', () => {{
        try {{
          const p = getClientPath();
          if (fs.existsSync(p)) {{
            return fs.readFileSync(p, 'utf8');
          }}
        }} catch {{}}
        return FALLBACK_CLIENT_CODE;
      }});

      ipcMain.handle('codex-slider:get-state', () => readStateSafe());

      ipcMain.handle('codex-slider:save-config', (_ev, cfg) => {{
        return writeStatePatchSafe(cfg);
      }});

      ipcMain.handle('codex-slider:check-update', async () => {{
        const res = await runEngine(['update', '--force', '--json']);
        if (res && res.status === 'updated' && res.version) {{
          showNativeUpdateNotification(res.version);
          broadcastUpdateReady(res);
        }}
        const st = readStateSafe();
        broadcastStateChanged(st);
        return Object.assign({{}}, res, {{ state: st }});
      }});

      ipcMain.handle('codex-slider:uninstall', async () => {{
        const res = await runEngine(['uninstall', '--json']);
        if (res && res.ok) {{
          broadcastToAllWindows('codex-slider:uninstalled', res);
        }}
        return res;
      }});

      ipcMain.handle('codex-slider:relaunch', () => {{
        triggerRelaunch();
        return true;
      }});
    }}

    if (app && typeof app.whenReady === 'function') {{
      app.whenReady().then(() => {{
        const rootDir = getPluginRoot();
        let watchDebounce = null;
        const checkSignalsAndState = () => {{
          try {{
            const relaunchFile = path.join(rootDir, '.relaunch-request');
            if (fs.existsSync(relaunchFile)) {{
              try {{ fs.unlinkSync(relaunchFile); }} catch {{}}
              triggerRelaunch();
              return;
            }}
            const uninstallFile = path.join(rootDir, '.uninstall-request');
            if (fs.existsSync(uninstallFile)) {{
              try {{ fs.unlinkSync(uninstallFile); }} catch {{}}
              broadcastToAllWindows('codex-slider:uninstalled', {{ ok: true, fromSidecar: true }});
              return;
            }}
            broadcastStateChanged(readStateSafe());
          }} catch {{}}
        }};

        try {{
          if (fs.existsSync(rootDir)) {{
            fs.watch(rootDir, {{ persistent: false }}, () => {{
              if (watchDebounce) clearTimeout(watchDebounce);
              watchDebounce = setTimeout(checkSignalsAndState, 60);
            }});
          }}
        }} catch {{}}
        setInterval(checkSignalsAndState, 1500);

        setTimeout(async () => {{
          const st = readStateSafe();
          if (!st.autoUpdate) return;
          const res = await runEngine(['update', '--background', '--json']);
          if (res && res.status === 'updated' && res.version) {{
            showNativeUpdateNotification(res.version);
            broadcastUpdateReady(res);
          }}
        }}, 8000);
      }});
    }}
  }} catch (err) {{
    console.error('[CodexSlider Main] init error:', err);
  }}
}})();
{end}
"#,
        start = MAIN_PATCH_START,
        ver = LOADER_VERSION,
        pkg_ver = BUNDLED_VERSION,
        root_lit = root_lit,
        fallback_lit = fallback_lit,
        end = MAIN_PATCH_END,
    )
}

/// 将轻量引导器应用到 Desktop `dist/main.js`
pub fn apply_desktop_main_patch(
    original_main: &str,
    plugin_root: &Path,
    fallback_client_js: &str,
) -> String {
    let clean = strip_marker_block(original_main, MAIN_PATCH_START, MAIN_PATCH_END)
        .trim_end()
        .to_string();
    let snippet = build_desktop_main_patch(plugin_root, fallback_client_js);
    format!("{clean}\n\n{snippet}")
}

/// 生成 Desktop `dist/preload.js` 极简桥接与动态注入代码
pub fn build_desktop_preload_patch() -> String {
    format!(
        r#"{start}
/* __AG_LOADER_VERSION={ver}__ */
try {{
  const __agElectron = require('electron');
  if (__agElectron && __agElectron.contextBridge && __agElectron.ipcRenderer) {{
    try {{
      __agElectron.contextBridge.exposeInMainWorld('__agCodexSliderBridge', {{
        platform: 'desktop',
        getState: () => __agElectron.ipcRenderer.invoke('codex-slider:get-state'),
        saveConfig: (cfg) => __agElectron.ipcRenderer.invoke('codex-slider:save-config', cfg),
        checkUpdate: () => __agElectron.ipcRenderer.invoke('codex-slider:check-update'),
        uninstall: () => __agElectron.ipcRenderer.invoke('codex-slider:uninstall'),
        relaunch: () => __agElectron.ipcRenderer.invoke('codex-slider:relaunch'),
        onStateChanged: (callback) => {{
          if (typeof callback !== 'function') return () => {{}};
          const handler = (_ev, payload) => {{
            try {{ callback(payload); }} catch {{}}
          }};
          __agElectron.ipcRenderer.on('codex-slider:state-changed', handler);
          return () => {{
            try {{ __agElectron.ipcRenderer.removeListener('codex-slider:state-changed', handler); }} catch {{}}
          }};
        }},
        onUninstalled: (callback) => {{
          if (typeof callback !== 'function') return () => {{}};
          const handler = (_ev, payload) => {{
            try {{ callback(payload); }} catch {{}}
          }};
          __agElectron.ipcRenderer.on('codex-slider:uninstalled', handler);
          return () => {{
            try {{ __agElectron.ipcRenderer.removeListener('codex-slider:uninstalled', handler); }} catch {{}}
          }};
        }},
        onUpdateReady: (callback) => {{
          if (typeof callback !== 'function') return () => {{}};
          const handler = (_ev, payload) => {{
            try {{ callback(payload); }} catch {{}}
          }};
          __agElectron.ipcRenderer.on('codex-slider:update-ready', handler);
          return () => {{
            try {{ __agElectron.ipcRenderer.removeListener('codex-slider:update-ready', handler); }} catch {{}}
          }};
        }}
      }});
    }} catch {{}}
  }}

  const __agInjectMainWorld = async () => {{
    try {{
      if (!__agElectron || !__agElectron.webFrame || typeof __agElectron.webFrame.executeJavaScript !== 'function') return;
      const code = await __agElectron.ipcRenderer.invoke('codex-slider:load-client');
      if (typeof code === 'string' && code.length > 0) {{
        void __agElectron.webFrame.executeJavaScript(code);
      }}
    }} catch (err) {{
      console.error('[CodexSlider] preload dynamic inject error:', err);
    }}
  }};

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {{
    if (document.readyState === 'loading') {{
      window.addEventListener('DOMContentLoaded', () => {{ void __agInjectMainWorld(); }}, {{ once: true }});
    }} else {{
      void __agInjectMainWorld();
    }}
  }}
}} catch (err) {{
  console.error('[CodexSlider] Preload bootstrap error:', err);
}}
{end}
"#,
        start = PRELOAD_PATCH_START,
        ver = LOADER_VERSION,
        end = PRELOAD_PATCH_END,
    )
}

/// 将极简桥接注入到 Desktop `dist/preload.js`
pub fn apply_desktop_preload_patch(original_preload: &str) -> String {
    let clean = strip_marker_block(original_preload, PRELOAD_PATCH_START, PRELOAD_PATCH_END)
        .trim_end()
        .to_string();
    let snippet = build_desktop_preload_patch();
    format!("{clean}\n\n{snippet}")
}

/// 生成 Antigravity IDE `extension.js` 动态反向代理与原生通知引导器。
/// `delegate_namespace` 为从目标 `extension.js` 中实时解析出的混淆命名空间（如 `sv`、`Jx`）。
pub fn build_ide_extension_patch(
    plugin_root: &Path,
    fallback_client_js: &str,
    delegate_namespace: &str,
) -> String {
    let root_lit = serde_json::to_string(&plugin_root.to_string_lossy().to_string())
        .unwrap_or_else(|_| "\"\"".to_string());
    let fallback_lit = serde_json::to_string(fallback_client_js).unwrap_or_else(|_| "\"\"".to_string());
    let ns_root = delegate_namespace
        .split('.')
        .next()
        .unwrap_or(delegate_namespace);

    format!(
        r#"{start}
/* __AG_LOADER_VERSION={ver}__ */
(function () {{
  try {{
    const http = require('http');
    const net = require('net');
    const fs = require('fs');
    const path = require('path');
    const {{ execFile }} = require('child_process');

    const DEFAULT_PLUGIN_ROOT = {root_lit};
    const FALLBACK_CLIENT_CODE = {fallback_lit};
    let activeProxy = null;

    function getPluginRoot() {{
      const envRoot = process.env.AG_SLIDER_PLUGIN_ROOT;
      return envRoot && envRoot.trim() ? envRoot.trim() : DEFAULT_PLUGIN_ROOT;
    }}

    function getBinaryPath() {{
      const binName = process.platform === 'win32' ? 'ag-effort-slider.exe' : 'ag-effort-slider';
      return path.join(getPluginRoot(), 'bin', binName);
    }}

    function loadLatestClientCode() {{
      try {{
        const p = path.join(getPluginRoot(), 'lib', 'client.js');
        if (fs.existsSync(p)) {{
          return fs.readFileSync(p, 'utf8');
        }}
      }} catch {{}}
      return FALLBACK_CLIENT_CODE;
    }}

    function readStateSafe() {{
      try {{
        const p = path.join(getPluginRoot(), 'state.json');
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        const motion = (parsed.motion === 'fast' || parsed.motion === 'quick') ? parsed.motion : 'full';
        const ticks = (parsed.ticks === 'dim' || parsed.ticks === 'hidden') ? parsed.ticks : 'highlight';
        return {{
          version: parsed.version || '{pkg_ver}',
          loaderVersion: parsed.loaderVersion || {ver},
          motion,
          ticks,
          autoUpdate: parsed.autoUpdate !== false,
          checkIntervalHours: Number(parsed.checkIntervalHours || 12),
          mirrorPrefix: typeof parsed.mirrorPrefix === 'string' ? parsed.mirrorPrefix : '',
          lastCheckAt: Number(parsed.lastCheckAt || 0),
          pendingUpdateVersion: parsed.pendingUpdateVersion || null,
          pendingUpdateNotes: parsed.pendingUpdateNotes || null,
          platform: 'ide',
          canRelaunch: true
        }};
      }} catch {{
        return {{
          version: '{pkg_ver}',
          loaderVersion: {ver},
          motion: 'full',
          ticks: 'highlight',
          autoUpdate: true,
          checkIntervalHours: 12,
          mirrorPrefix: '',
          lastCheckAt: 0,
          pendingUpdateVersion: null,
          pendingUpdateNotes: null,
          platform: 'ide',
          canRelaunch: true
        }};
      }}
    }}

    const sseClients = new Set();
    let lastIdeStateFp = '';
    function pushIdeStateChanged(st) {{
      const s = st || readStateSafe();
      const fp = JSON.stringify({{ m: s.motion, t: s.ticks, a: s.autoUpdate, r: s.mirrorPrefix, l: s.lastCheckAt, p: s.pendingUpdateVersion, v: s.version }});
      if (fp === lastIdeStateFp) return;
      lastIdeStateFp = fp;
      const chunk = 'event: state-changed\ndata: ' + JSON.stringify(s) + '\n\n';
      for (const clientRes of Array.from(sseClients)) {{
        try {{
          clientRes.write(chunk);
        }} catch {{
          sseClients.delete(clientRes);
        }}
      }}
    }}

    function writeStatePatchSafe(cfg) {{
      try {{
        const statePath = path.join(getPluginRoot(), 'state.json');
        const dir = path.dirname(statePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, {{ recursive: true }});
        let rawObj = {{}};
        try {{
          rawObj = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        }} catch {{
          rawObj = {{
            version: '{pkg_ver}',
            loaderVersion: {ver},
            motion: 'full',
            ticks: 'highlight',
            autoUpdate: true,
            checkIntervalHours: 12,
            mirrorPrefix: '',
            lastCheckAt: 0,
            pendingUpdateVersion: null,
            pendingUpdateNotes: null
          }};
        }}
        if (cfg && typeof cfg === 'object') {{
          if (cfg.resetAppearance) {{
            rawObj.motion = 'full';
            rawObj.ticks = 'highlight';
          }}
          if (cfg.motion === 'full' || cfg.motion === 'fast' || cfg.motion === 'quick') {{
            rawObj.motion = cfg.motion;
          }}
          if (cfg.ticks === 'highlight' || cfg.ticks === 'dim' || cfg.ticks === 'hidden') {{
            rawObj.ticks = cfg.ticks;
          }}
          if (typeof cfg.autoUpdate === 'boolean') {{
            rawObj.autoUpdate = cfg.autoUpdate;
          }}
          if (typeof cfg.mirrorPrefix === 'string') {{
            rawObj.mirrorPrefix = cfg.mirrorPrefix.trim();
          }}
        }}
        const nextText = JSON.stringify(rawObj, null, 2) + '\n';
        const tmpPath = statePath + '.tmp';
        fs.writeFileSync(tmpPath, nextText, 'utf8');
        try {{
          fs.renameSync(tmpPath, statePath);
        }} catch {{
          fs.writeFileSync(statePath, nextText, 'utf8');
          try {{ fs.unlinkSync(tmpPath); }} catch {{}}
        }}
      }} catch (err) {{
        console.error('[CodexSlider IDE] writeStatePatchSafe error:', err);
      }}
      const nextState = readStateSafe();
      pushIdeStateChanged(nextState);
      return nextState;
    }}

    function runEngine(args) {{
      return new Promise((resolve) => {{
        const bin = getBinaryPath();
        if (!fs.existsSync(bin)) {{
          resolve({{ ok: false, error: '未找到本地更新引擎' }});
          return;
        }}
        execFile(bin, args, {{ windowsHide: true, timeout: 60000 }}, (err, stdout) => {{
          const text = String(stdout || '').trim();
          if (text) {{
            try {{
              resolve(JSON.parse(text));
              return;
            }} catch {{}}
          }}
          resolve({{ ok: false, error: err ? err.message : '更新引擎无返回' }});
        }});
      }});
    }}

    function notifyIdeUpdateReady(version) {{
      try {{
        const vscodeMod = require('vscode');
        if (vscodeMod && vscodeMod.window && typeof vscodeMod.window.showInformationMessage === 'function') {{
          vscodeMod.window
            .showInformationMessage(
              '推理等级滑条已更新至 v' + version + '，是否立即重新加载窗口生效？',
              '立即重载',
              '稍后'
            )
            .then((choice) => {{
              if (choice === '立即重载' && vscodeMod.commands) {{
                vscodeMod.commands.executeCommand('workbench.action.reloadWindow');
              }}
            }});
        }}
      }} catch {{}}
    }}

    function sendJson(res, statusCode, data) {{
      const payload = JSON.stringify(data);
      res.writeHead(statusCode, {{
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
      }});
      res.end(payload);
    }}

    function readJsonBody(req) {{
      return new Promise((resolve) => {{
        let raw = '';
        req.on('data', (chunk) => {{
          raw += chunk;
          if (raw.length > 65536) raw = raw.slice(0, 65536);
        }});
        req.on('end', () => {{
          try {{
            resolve(raw ? JSON.parse(raw) : {{}});
          }} catch {{
            resolve({{}});
          }}
        }});
      }});
    }}

    function ensureProxy(targetUrlStr) {{
      return new Promise((resolve, reject) => {{
        try {{
          const targetUrl = new URL(targetUrlStr);
          const targetPort = parseInt(targetUrl.port, 10);
          const targetHost = targetUrl.hostname || '127.0.0.1';

          if (
            activeProxy &&
            activeProxy.targetPort === targetPort &&
            activeProxy.targetHost === targetHost &&
            activeProxy.server.listening
          ) {{
            resolve(activeProxy.proxyUrl);
            return;
          }}

          if (activeProxy) {{
            try {{ activeProxy.server.close(); }} catch (e) {{}}
            activeProxy = null;
          }}

          const server = http.createServer(async (req, res) => {{
            const reqUrl = (req.url || '').split('?')[0];

            if (reqUrl === '/__ag_codex_effort_slider.js') {{
              res.writeHead(200, {{
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache'
              }});
              res.end(loadLatestClientCode());
              return;
            }}

            if (reqUrl === '/__ag_codex_slider/state' && req.method === 'GET') {{
              sendJson(res, 200, readStateSafe());
              return;
            }}

            if (reqUrl === '/__ag_codex_slider/events' && req.method === 'GET') {{
              res.writeHead(200, {{
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive'
              }});
              res.write('event: state-changed\ndata: ' + JSON.stringify(readStateSafe()) + '\n\n');
              sseClients.add(res);
              const timer = setInterval(() => {{
                pushIdeStateChanged(readStateSafe());
                try {{ res.write(': ping\n\n'); }} catch {{}}
              }}, 1500);
              req.on('close', () => {{
                clearInterval(timer);
                sseClients.delete(res);
              }});
              return;
            }}

            if (reqUrl === '/__ag_codex_slider/config' && req.method === 'POST') {{
              const body = await readJsonBody(req);
              sendJson(res, 200, writeStatePatchSafe(body));
              return;
            }}

            if (reqUrl === '/__ag_codex_slider/check-update' && req.method === 'POST') {{
              const result = await runEngine(['update', '--force', '--json']);
              if (result && result.status === 'updated' && result.version) {{
                notifyIdeUpdateReady(result.version);
              }}
              const st = readStateSafe();
              pushIdeStateChanged(st);
              sendJson(res, 200, Object.assign({{}}, result, {{ state: st }}));
              return;
            }}

            if (reqUrl === '/__ag_codex_slider/uninstall' && req.method === 'POST') {{
              const result = await runEngine(['uninstall', '--json']);
              sendJson(res, 200, result);
              return;
            }}

            if (reqUrl === '/__ag_codex_slider/reload' && req.method === 'POST') {{
              try {{
                const vscodeMod = require('vscode');
                if (vscodeMod && vscodeMod.commands) {{
                  vscodeMod.commands.executeCommand('workbench.action.reloadWindow');
                }}
              }} catch {{}}
              sendJson(res, 200, {{ ok: true }});
              return;
            }}

            const options = {{
              hostname: targetHost,
              port: targetPort,
              path: req.url,
              method: req.method,
              headers: {{ ...req.headers, host: targetHost + ':' + targetPort }},
              insecureHTTPParser: true
            }};
            delete options.headers['accept-encoding'];

            const proxyReq = http.request(options, (proxyRes) => {{
              const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
              const isHtml = contentType.includes('text/html');
              const isJs = req.url && (req.url === '/main.js' || req.url.startsWith('/main.js?'));

              if (isHtml) {{
                let body = '';
                proxyRes.on('data', (chunk) => (body += chunk));
                proxyRes.on('end', () => {{
                  let modified = body;
                  const scriptTag = '<script src="/__ag_codex_effort_slider.js"></script>';
                  if (body.includes('</body>')) {{
                    modified = body.replace('</body>', scriptTag + '</body>');
                  }} else {{
                    modified = body + scriptTag;
                  }}

                  const headers = {{ ...proxyRes.headers }};
                  delete headers['content-length'];
                  delete headers['transfer-encoding'];
                  headers['content-length'] = Buffer.byteLength(modified, 'utf8');
                  res.writeHead(proxyRes.statusCode, headers);
                  res.end(modified);
                }});
              }} else if (isJs) {{
                let body = '';
                proxyRes.on('data', (chunk) => (body += chunk));
                proxyRes.on('end', () => {{
                  let modified = body;
                  // 为模型选择面板中的 View Usage 添加 0.3s (300ms) 停留展开延迟
                  modified = modified.replace(
                    /(B\.createElement\(fT,\s*\{{\s*title:\s*"Usage"\s*\}}\s*,\s*B\.createElement\(gT,)\s*null/g,
                    '$1{{delay:300}}'
                  );

                  const headers = {{ ...proxyRes.headers }};
                  delete headers['content-length'];
                  delete headers['transfer-encoding'];
                  headers['content-length'] = Buffer.byteLength(modified, 'utf8');
                  res.writeHead(proxyRes.statusCode, headers);
                  res.end(modified);
                }});
              }} else {{
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res);
              }}
            }});

            proxyReq.on('error', (err) => {{
              try {{
                res.writeHead(502);
                res.end('CodexSlider Proxy Error: ' + err.message);
              }} catch (e) {{}}
            }});

            req.pipe(proxyReq);
          }});

          server.on('upgrade', (req, clientSocket, head) => {{
            const serverSocket = net.connect(targetPort, targetHost, () => {{
              let rawReq = req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n';
              for (let i = 0; i < req.rawHeaders.length; i += 2) {{
                let key = req.rawHeaders[i];
                let val = req.rawHeaders[i + 1];
                if (key.toLowerCase() === 'host') val = targetHost + ':' + targetPort;
                rawReq += key + ': ' + val + '\r\n';
              }}
              rawReq += '\r\n';
              serverSocket.write(rawReq);
              if (head && head.length > 0) {{
                serverSocket.write(head);
              }}
              serverSocket.pipe(clientSocket);
              clientSocket.pipe(serverSocket);
            }});

            serverSocket.on('error', () => {{
              try {{ clientSocket.destroy(); }} catch (e) {{}}
            }});
            clientSocket.on('error', () => {{
              try {{ serverSocket.destroy(); }} catch (e) {{}}
            }});
          }});

          server.listen(0, '127.0.0.1', () => {{
            const proxyPort = server.address().port;
            const proxyUrl = 'http://127.0.0.1:' + proxyPort + '/';
            activeProxy = {{
              server,
              proxyUrl,
              targetPort,
              targetHost
            }};
            console.log('[CodexSlider] Reverse proxy listening on port', proxyPort, '->', targetHost + ':' + targetPort);
            resolve(proxyUrl);
          }});

          server.on('error', (err) => {{
            console.error('[CodexSlider] Proxy server error:', err);
            reject(err);
          }});
        }} catch (err) {{
          reject(err);
        }}
      }});
    }}

    if (typeof {ns_root} !== 'undefined' && {ns} && {ns}.BaseVsCodeWebviewDelegate) {{
      const origRenderIframe = {ns}.BaseVsCodeWebviewDelegate.prototype.renderIframe;
      {ns}.BaseVsCodeWebviewDelegate.prototype.renderIframe = async function (a, b, c) {{
        try {{
          const proxiedUrl = await ensureProxy(b);
          return origRenderIframe.call(this, a, proxiedUrl, c);
        }} catch (err) {{
          console.error('[CodexSlider] Failed to proxy iframe, falling back to original:', err);
          return origRenderIframe.call(this, a, b, c);
        }}
      }};
      console.log('[CodexSlider] Antigravity IDE webview delegate ({ns}) successfully hooked!');
    }} else {{
      console.warn('[CodexSlider] {ns}.BaseVsCodeWebviewDelegate not found in extension scope.');
    }}

    setTimeout(async () => {{
      const st = readStateSafe();
      if (!st.autoUpdate) return;
      const res = await runEngine(['update', '--background', '--json']);
      if (res && res.status === 'updated' && res.version) {{
        notifyIdeUpdateReady(res.version);
      }}
    }}, 8000);
  }} catch (err) {{
    console.error('[CodexSlider] Error initializing IDE extension patch:', err);
  }}
}})();
{end}"#,
        start = IDE_PATCH_START,
        ver = LOADER_VERSION,
        pkg_ver = BUNDLED_VERSION,
        ns_root = ns_root,
        ns = delegate_namespace,
        root_lit = root_lit,
        fallback_lit = fallback_lit,
        end = IDE_PATCH_END,
    )
}

/// 将动态代理引导器注入到 IDE `extension.js`（动态解析混淆命名空间并插入在 Closure 闭合前）。
/// 若目标文件中缺失 `BaseVsCodeWebviewDelegate` 定义或 Closure 闭合锚点，直接返回错误并中止写入，避免静默假成功。
pub fn apply_ide_extension_patch(
    original_ext: &str,
    plugin_root: &Path,
    fallback_client_js: &str,
) -> Result<String, String> {
    let clean = strip_marker_block(original_ext, IDE_PATCH_START, IDE_PATCH_END);
    let Some(delegate_ns) = extract_ide_webview_delegate_namespace(&clean) else {
        return Err(
            "未在 IDE 扩展源码中定位到 BaseVsCodeWebviewDelegate 命名空间，当前 IDE 版本可能已变更 Webview 架构，已中止写入"
                .to_string(),
        );
    };
    let Some(idx) = clean.rfind(IDE_INSERT_ANCHOR) else {
        return Err(
            "未在 IDE 扩展源码中定位到 Closure 闭合锚点，当前 IDE 版本打包格式可能已变更，已中止写入"
                .to_string(),
        );
    };
    let snippet = build_ide_extension_patch(plugin_root, fallback_client_js, &delegate_ns);
    let before = &clean[..idx];
    let after = &clean[idx..];
    Ok(format!("{before}\n{snippet}\n\n{after}"))
}
