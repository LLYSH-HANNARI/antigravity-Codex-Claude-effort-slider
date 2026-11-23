//! 动态引导器（Loader）代码生成与旧补丁剥离模块。
//! - Desktop `dist/main.js`：IPC 桥接、动态读取 <plugin_root>/lib/client.js、启动后台查更新、原生通知与 app.relaunch()
//! - Desktop `dist/preload.js`：暴露受控 `__agCodexSliderBridge` 并通过 webFrame.executeJavaScript 注入 Main World
//! - IDE `extension.js`：动态反向代理 + 同源状态/更新接口 + VS Code 原生通知与重载窗口

use std::path::Path;

use crate::state::LOADER_VERSION;

pub const MAIN_PATCH_START: &str = "/* __AG_CODEX_EFFORT_SLIDER_MAIN_START__ */";
pub const MAIN_PATCH_END: &str = "/* __AG_CODEX_EFFORT_SLIDER_MAIN_END__ */";

pub const PRELOAD_PATCH_START: &str = "/* __AG_CODEX_EFFORT_SLIDER_START__ */";
pub const PRELOAD_PATCH_END: &str = "/* __AG_CODEX_EFFORT_SLIDER_END__ */";

pub const IDE_PATCH_START: &str = "/* __AG_CODEX_EFFORT_SLIDER_START__ */";
pub const IDE_PATCH_END: &str = "/* __AG_CODEX_EFFORT_SLIDER_END__ */";

pub const IDE_INSERT_ANCHOR: &str = "}.call(Object.assign(Object.create(globalThis)";

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
        return {{
          version: parsed.version || '1.4.0',
          loaderVersion: parsed.loaderVersion || {ver},
          autoUpdate: parsed.autoUpdate !== false,
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
          version: '1.4.0',
          loaderVersion: {ver},
          autoUpdate: true,
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
      try {{
        for (const win of BrowserWindow.getAllWindows()) {{
          if (win && !win.isDestroyed() && win.webContents) {{
            win.webContents.send('codex-slider:update-ready', payload);
          }}
        }}
      }} catch {{}}
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

      ipcMain.handle('codex-slider:save-config', async (_ev, cfg) => {{
        const args = ['config', '--json'];
        if (cfg && typeof cfg.autoUpdate === 'boolean') {{
          args.push('--auto-update', cfg.autoUpdate ? 'true' : 'false');
        }}
        if (cfg && typeof cfg.mirrorPrefix === 'string') {{
          args.push('--mirror', cfg.mirrorPrefix);
        }}
        await runEngine(args);
        return readStateSafe();
      }});

      ipcMain.handle('codex-slider:check-update', async () => {{
        const res = await runEngine(['update', '--force', '--json']);
        if (res && res.status === 'updated' && res.version) {{
          showNativeUpdateNotification(res.version);
          broadcastUpdateReady(res);
        }}
        return Object.assign({{}}, res, {{ state: readStateSafe() }});
      }});

      ipcMain.handle('codex-slider:relaunch', () => {{
        triggerRelaunch();
        return true;
      }});
    }}

    if (app && typeof app.whenReady === 'function') {{
      app.whenReady().then(() => {{
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
        relaunch: () => __agElectron.ipcRenderer.invoke('codex-slider:relaunch'),
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

/// 生成 Antigravity IDE `extension.js` 动态反向代理与原生通知引导器
pub fn build_ide_extension_patch(plugin_root: &Path, fallback_client_js: &str) -> String {
    let root_lit = serde_json::to_string(&plugin_root.to_string_lossy().to_string())
        .unwrap_or_else(|_| "\"\"".to_string());
    let fallback_lit = serde_json::to_string(fallback_client_js).unwrap_or_else(|_| "\"\"".to_string());

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
        return {{
          version: parsed.version || '1.4.0',
          loaderVersion: parsed.loaderVersion || {ver},
          autoUpdate: parsed.autoUpdate !== false,
          mirrorPrefix: typeof parsed.mirrorPrefix === 'string' ? parsed.mirrorPrefix : '',
          lastCheckAt: Number(parsed.lastCheckAt || 0),
          pendingUpdateVersion: parsed.pendingUpdateVersion || null,
          pendingUpdateNotes: parsed.pendingUpdateNotes || null,
          platform: 'ide',
          canRelaunch: true
        }};
      }} catch {{
        return {{
          version: '1.4.0',
          loaderVersion: {ver},
          autoUpdate: true,
          mirrorPrefix: '',
          lastCheckAt: 0,
          pendingUpdateVersion: null,
          pendingUpdateNotes: null,
          platform: 'ide',
          canRelaunch: true
        }};
      }}
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

            if (reqUrl === '/__ag_codex_slider/config' && req.method === 'POST') {{
              const body = await readJsonBody(req);
              const args = ['config', '--json'];
              if (typeof body.autoUpdate === 'boolean') {{
                args.push('--auto-update', body.autoUpdate ? 'true' : 'false');
              }}
              if (typeof body.mirrorPrefix === 'string') {{
                args.push('--mirror', body.mirrorPrefix);
              }}
              await runEngine(args);
              sendJson(res, 200, readStateSafe());
              return;
            }}

            if (reqUrl === '/__ag_codex_slider/check-update' && req.method === 'POST') {{
              const result = await runEngine(['update', '--force', '--json']);
              if (result && result.status === 'updated' && result.version) {{
                notifyIdeUpdateReady(result.version);
              }}
              sendJson(res, 200, Object.assign({{}}, result, {{ state: readStateSafe() }}));
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

    if (typeof sv !== 'undefined' && sv.BaseVsCodeWebviewDelegate) {{
      const origRenderIframe = sv.BaseVsCodeWebviewDelegate.prototype.renderIframe;
      sv.BaseVsCodeWebviewDelegate.prototype.renderIframe = async function (a, b, c) {{
        try {{
          const proxiedUrl = await ensureProxy(b);
          const d = this.buildIframeUrl(proxiedUrl, c);
          this.renderWebviewHtml(a, proxiedUrl, d, c);
        }} catch (err) {{
          console.error('[CodexSlider] Failed to proxy iframe, falling back to original:', err);
          origRenderIframe.call(this, a, b, c);
        }}
      }};
      console.log('[CodexSlider] Antigravity IDE webview delegate successfully hooked!');
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
        root_lit = root_lit,
        fallback_lit = fallback_lit,
        end = IDE_PATCH_END,
    )
}

/// 将动态代理引导器注入到 IDE `extension.js`（插入在 Closure 闭合前）
pub fn apply_ide_extension_patch(
    original_ext: &str,
    plugin_root: &Path,
    fallback_client_js: &str,
) -> String {
    let clean = strip_marker_block(original_ext, IDE_PATCH_START, IDE_PATCH_END);
    let snippet = build_ide_extension_patch(plugin_root, fallback_client_js);
    if let Some(idx) = clean.rfind(IDE_INSERT_ANCHOR) {
        let before = &clean[..idx];
        let after = &clean[idx..];
        format!("{before}\n{snippet}\n\n{after}")
    } else {
        format!("{clean}\n\n{snippet}\n")
    }
}
