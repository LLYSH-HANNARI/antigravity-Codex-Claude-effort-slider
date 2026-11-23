"use strict";

/**
 * Antigravity app.asar 持久补丁与还原工具 (tools/patch-asar.cjs)
 *
 * 解决痛点：
 * 1. Antigravity Desktop 开启了 Electron `--enable-sandbox` 与 `contextIsolation: true`。
 *    在沙箱 preload.js 中直接 `require('./xxx.js')` 会报 `Error: module not found`；
 *    且在 preload 隔离世界直接操作 DOM 无法读取主世界的 `__reactFiber$` 属性。
 * 2. 本工具将 `lib/client.js` 内联进 `dist/preload.js`，并通过
 *    `electron_1.webFrame.executeJavaScript(...)` 直接注入到渲染器主世界 (Main World)，
 *    同时完整重算 asar 偏移量与 SHA-256 integrity 校验块。
 * 3. 若当前 Antigravity 正在运行并锁定了 `app.asar`，除了生成 `.codex-staged` 待替换包外，
 *    会自动启动静默后台守护进程，在 Antigravity 退出释放文件锁的瞬间自动完成原子替换。
 * 4. 同时支持检测并为 unpacked 结构的 Antigravity IDE (`out/jetskiAgent/main.js`) 安装/还原补丁。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const CLIENT_JS_PATH = path.join(ROOT_DIR, "lib", "client.js");

const PATCH_START_MARKER = "/* __AG_CODEX_EFFORT_SLIDER_START__ */";
const PATCH_END_MARKER = "/* __AG_CODEX_EFFORT_SLIDER_END__ */";
const MAIN_PATCH_START_MARKER = "/* __AG_CODEX_EFFORT_SLIDER_MAIN_START__ */";
const MAIN_PATCH_END_MARKER = "/* __AG_CODEX_EFFORT_SLIDER_MAIN_END__ */";
const LEGACY_REQUIRE_RE = /\r?\ntry\s*\{\s*require\(['"]\.\/antigravity-codex-effort-slider\.js['"]\);\s*\}\s*catch\s*\([^)]*\)\s*\{[^\r\n]*\}\s*/g;

function findDefaultAsarPath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const candidates = [
    path.join(localAppData, "Programs", "antigravity", "resources", "app.asar"),
    path.join(localAppData, "antigravity", "resources", "app.asar"),
    "/Applications/Antigravity.app/Contents/Resources/app.asar"
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function findIdeRoots() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const candidateRoots = [
    process.env.ANTIGRAVITY_IDE_PATH,
    "D:\\Antigravity IDE",
    path.join(localAppData, "Programs", "antigravity IDE"),
    path.join(localAppData, "Programs", "Antigravity IDE"),
    path.join(programFiles, "Antigravity IDE"),
    path.join(programFilesX86, "Antigravity IDE"),
    "/Applications/Antigravity IDE.app/Contents"
  ].filter(Boolean);

  const roots = [];
  const seen = new Set();
  for (const r of candidateRoots) {
    const appDir = path.join(r, "resources", "app");
    if (fs.existsSync(appDir) && fs.existsSync(path.join(appDir, "product.json"))) {
      try {
        const real = fs.realpathSync(appDir).toLowerCase();
        if (seen.has(real)) continue;
        seen.add(real);
        roots.push(appDir);
      } catch {
        roots.push(appDir);
      }
    }
  }
  return roots;
}

function findIdeExtensionFiles() {
  const roots = findIdeRoots();
  const targets = [];
  for (const appDir of roots) {
    const extVscode = path.join(appDir, "extensions", "agy", "vscode", "extension.js");
    const extDist = path.join(appDir, "extensions", "agy", "dist", "extension.js");
    if (fs.existsSync(extVscode)) targets.push(extVscode);
    else if (fs.existsSync(extDist)) targets.push(extDist);
  }
  return targets;
}

function findIdeLegacyFiles() {
  const roots = findIdeRoots();
  const targets = [];
  for (const appDir of roots) {
    const mainWorkbench = path.join(appDir, "out", "vs", "code", "electron-browser", "workbench", "workbench.js");
    const jetskiMain = path.join(appDir, "out", "jetskiAgent", "main.js");
    if (fs.existsSync(mainWorkbench)) targets.push(mainWorkbench);
    if (fs.existsSync(jetskiMain)) targets.push(jetskiMain);
  }
  return targets;
}

function computeIntegrity(buffer, blockSize = 4194304) {
  const fullHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const blocks = [];
  for (let offset = 0; offset < buffer.length; offset += blockSize) {
    const slice = buffer.subarray(offset, Math.min(offset + blockSize, buffer.length));
    blocks.push(crypto.createHash("sha256").update(slice).digest("hex"));
  }
  if (blocks.length === 0) {
    blocks.push(crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  }
  return {
    algorithm: "SHA256",
    hash: fullHash,
    blockSize,
    blocks
  };
}

function parseAsarArchive(asarBuffer) {
  const headerSize = asarBuffer.readUInt32LE(4);
  const jsonLen = asarBuffer.readUInt32LE(12);
  const dataStart = 8 + headerSize;
  const headerJson = asarBuffer.subarray(16, 16 + jsonLen).toString("utf8");
  const header = JSON.parse(headerJson);
  const payload = asarBuffer.subarray(dataStart);
  return { header, payload };
}

function buildAsarArchive(header, payloadBuffers) {
  const headerJsonBuf = Buffer.from(JSON.stringify(header), "utf8");
  const jsonLen = headerJsonBuf.length;
  const alignedJsonLen = Math.ceil(jsonLen / 4) * 4;
  const headerSize = alignedJsonLen + 8;
  const pickleHeader = Buffer.alloc(16 + alignedJsonLen);
  pickleHeader.writeUInt32LE(4, 0);
  pickleHeader.writeUInt32LE(headerSize, 4);
  pickleHeader.writeUInt32LE(headerSize - 4, 8);
  pickleHeader.writeUInt32LE(jsonLen, 12);
  headerJsonBuf.copy(pickleHeader, 16);
  return Buffer.concat([pickleHeader, ...payloadBuffers]);
}

function stripMarkerBlock(source, startMarker, endMarker) {
  let cleaned = String(source || "").replace(LEGACY_REQUIRE_RE, "\n");
  while (true) {
    const startIdx = cleaned.indexOf(startMarker);
    const endIdx = startIdx >= 0 ? cleaned.indexOf(endMarker, startIdx + startMarker.length) : -1;
    if (startIdx < 0 || endIdx <= startIdx) break;
    cleaned =
      cleaned.slice(0, startIdx).replace(/\s+$/, "") +
      "\n" +
      cleaned.slice(endIdx + endMarker.length).replace(/^\s+/, "");
  }
  return cleaned;
}

function stripExistingPreloadPatch(source) {
  return stripMarkerBlock(source, PATCH_START_MARKER, PATCH_END_MARKER);
}

function stripExistingMainPatch(source) {
  return stripMarkerBlock(source, MAIN_PATCH_START_MARKER, MAIN_PATCH_END_MARKER);
}

function verifyAsarBuffer(asarBuffer, requiredEntries = ["dist/preload.js"]) {
  const { header, payload } = parseAsarArchive(asarBuffer);
  for (const relPath of requiredEntries) {
    let cur = header;
    for (const seg of relPath.split("/")) {
      cur = cur && cur.files ? cur.files[seg] : null;
    }
    if (!cur || cur.offset === undefined || typeof cur.size !== "number") {
      throw new Error(`ASAR 写前自检失败：缺少条目 ${relPath}`);
    }
    const off = Number(cur.offset);
    if (off + cur.size > payload.length) {
      throw new Error(`ASAR 写前自检失败：条目 ${relPath} 越界`);
    }
    const slice = payload.subarray(off, off + cur.size);
    if (cur.integrity && cur.integrity.hash) {
      const actual = crypto.createHash("sha256").update(slice).digest("hex");
      if (actual.toLowerCase() !== String(cur.integrity.hash).toLowerCase()) {
        throw new Error(`ASAR 写前自检失败：${relPath} SHA-256 不匹配`);
      }
    }
  }
}

function buildPatchedPreloadSource(originalPreload, clientCode) {
  const cleanBase = stripExistingPreloadPatch(originalPreload).replace(/\s+$/, "");
  const inlinedClientLiteral = JSON.stringify(clientCode);
  const snippet = [
    "",
    PATCH_START_MARKER,
    "try {",
    "  const __agCodexSliderCode = " + inlinedClientLiteral + ";",
    "  const __agInjectMainWorld = () => {",
    "    try {",
    "      if (electron_1 && electron_1.webFrame && typeof electron_1.webFrame.executeJavaScript === 'function') {",
    "        void electron_1.webFrame.executeJavaScript(__agCodexSliderCode);",
    "      }",
    "    } catch (err) {",
    "      console.error('[CodexSlider] webFrame executeJavaScript error:', err);",
    "    }",
    "  };",
    "  if (typeof window !== 'undefined' && typeof document !== 'undefined') {",
    "    if (document.readyState === 'loading') {",
    "      window.addEventListener('DOMContentLoaded', __agInjectMainWorld, { once: true });",
    "    } else {",
    "      __agInjectMainWorld();",
    "    }",
    "  }",
    "} catch (err) {",
    "  console.error('[CodexSlider] Preload bootstrap error:', err);",
    "}",
    PATCH_END_MARKER,
    ""
  ].join("\n");
  return cleanBase + "\n" + snippet;
}

function repackAsarTree(node, origPayload, currentPath, replacements, removedPaths, outChunks, state) {
  if (!node || typeof node !== "object" || !node.files) return;
  const keys = Object.keys(node.files);
  for (const name of keys) {
    const relPath = currentPath ? `${currentPath}/${name}` : name;
    if (removedPaths.has(relPath)) {
      delete node.files[name];
      continue;
    }
    const child = node.files[name];
    if (child && child.files) {
      repackAsarTree(child, origPayload, relPath, replacements, removedPaths, outChunks, state);
    } else if (child && !child.unpacked && child.offset !== undefined && typeof child.size === "number") {
      let fileBuf;
      if (replacements.has(relPath)) {
        fileBuf = replacements.get(relPath);
      } else {
        const oldOffset = Number(child.offset);
        fileBuf = origPayload.subarray(oldOffset, oldOffset + child.size);
      }
      child.offset = String(state.offset);
      child.size = fileBuf.length;
      if (child.integrity) {
        child.integrity = computeIntegrity(fileBuf, child.integrity.blockSize || 4194304);
      }
      outChunks.push(fileBuf);
      state.offset += fileBuf.length;
    }
  }
}

function createPatchedAsarBuffer(sourceAsarPath, clientCode) {
  const rawAsar = fs.readFileSync(sourceAsarPath);
  const { header, payload } = parseAsarArchive(rawAsar);

  const preloadEntry =
    header.files &&
    header.files.dist &&
    header.files.dist.files &&
    header.files.dist.files["preload.js"];

  if (!preloadEntry || preloadEntry.offset === undefined) {
    throw new Error("未在 app.asar 中找到 dist/preload.js 条目");
  }

  const preloadOffset = Number(preloadEntry.offset);
  const origPreloadText = payload
    .subarray(preloadOffset, preloadOffset + preloadEntry.size)
    .toString("utf8");

  const patchedPreloadText = buildPatchedPreloadSource(originalPreloadOrClean(origPreloadText), clientCode);
  const patchedPreloadBuf = Buffer.from(patchedPreloadText, "utf8");

  const replacements = new Map([["dist/preload.js", patchedPreloadBuf]]);
  const removedPaths = new Set(["dist/antigravity-codex-effort-slider.js"]);

  const outChunks = [];
  const state = { offset: 0 };
  repackAsarTree(header, payload, "", replacements, removedPaths, outChunks, state);

  return buildAsarArchive(header, outChunks);
}

function originalPreloadOrClean(text) {
  return stripExistingPreloadPatch(text);
}

function spawnDeferredFileSwap(stagedPath, targetPath) {
  const watcherScript = `
    const fs = require('node:fs');
    const staged = ${JSON.stringify(stagedPath)};
    const target = ${JSON.stringify(targetPath)};
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (!fs.existsSync(staged) || attempts > 7200) {
        clearInterval(timer);
        process.exit(0);
      }
      try {
        fs.copyFileSync(staged, target);
        fs.unlinkSync(staged);
        clearInterval(timer);
        process.exit(0);
      } catch {}
    }, 1000);
  `;
  try {
    const child = spawn(process.execPath, ["-e", watcherScript], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function tryWriteFileAtomically(targetPath, buffer) {
  const stagedPath = targetPath + ".codex-staged";
  fs.writeFileSync(stagedPath, buffer);
  try {
    fs.copyFileSync(stagedPath, targetPath);
    fs.unlinkSync(stagedPath);
    return { written: true, stagedPath: null };
  } catch (copyErr) {
    const deferred = spawnDeferredFileSwap(stagedPath, targetPath);
    return { written: false, stagedPath, deferred, error: copyErr };
  }
}

function computeVsCodeChecksum(filePath) {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "");
}

function findAppRoot(filePath) {
  let cur = path.dirname(path.resolve(filePath));
  while (cur && cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, "product.json")) && fs.existsSync(path.join(cur, "out"))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return null;
}

function clearIdeCodeCache() {
  try {
    const appData = process.env.APPDATA;
    if (!appData) return;
    const cachedDataDir = path.join(appData, "Antigravity IDE", "CachedData");
    if (fs.existsSync(cachedDataDir)) {
      fs.rmSync(cachedDataDir, { recursive: true, force: true });
      console.log(`[CodexSlider IDE] 已清除 V8 缓存 (CachedData)，确保立即加载最新修改`);
    }
  } catch (err) {
    // 忽略清除异常
  }
}

function syncIdeProductChecksums(targetFilePath, isUninstall) {
  const appRoot = findAppRoot(targetFilePath);
  if (!appRoot) return;
  const productJsonPath = path.join(appRoot, "product.json");
  if (!fs.existsSync(productJsonPath)) return;

  const productBakPath = productJsonPath + ".codex.bak";
  if (isUninstall && fs.existsSync(productBakPath)) {
    try { fs.unlinkSync(productBakPath); } catch {}
  }

  const rawText = fs.readFileSync(productJsonPath, "utf8");
  const product = JSON.parse(rawText);
  if (!product || !product.checksums || typeof product.checksums !== "object") return;

  let updatedCount = 0;
  for (const relKey of Object.keys(product.checksums)) {
    const diskFile = path.join(appRoot, "out", ...relKey.split("/"));
    if (!fs.existsSync(diskFile)) continue;
    const actualHash = computeVsCodeChecksum(diskFile);
    if (product.checksums[relKey] !== actualHash) {
      product.checksums[relKey] = actualHash;
      updatedCount += 1;
    }
  }

  if (updatedCount > 0) {
    fs.writeFileSync(productJsonPath, JSON.stringify(product, null, "\t") + "\n", "utf8");
    console.log(
      `[CodexSlider IDE] 已同步更新 product.json 中 ${updatedCount} 项 SHA-256 校验值（消除「安装似乎损坏」提示）: ${productJsonPath}`
    );
  }
}

function buildIdeExtensionPatch(clientCode) {
  const inlinedClientLiteral = JSON.stringify(clientCode);
  return [
    PATCH_START_MARKER,
    "(function () {",
    "  try {",
    "    const http = require('http');",
    "    const net = require('net');",
    "",
    "    let activeProxy = null;",
    "    const clientCode = " + inlinedClientLiteral + ";",
    "",
    "    function ensureProxy(targetUrlStr) {",
    "      return new Promise((resolve, reject) => {",
    "        try {",
    "          const targetUrl = new URL(targetUrlStr);",
    "          const targetPort = parseInt(targetUrl.port, 10);",
    "          const targetHost = targetUrl.hostname || '127.0.0.1';",
    "",
    "          if (",
    "            activeProxy &&",
    "            activeProxy.targetPort === targetPort &&",
    "            activeProxy.targetHost === targetHost &&",
    "            activeProxy.server.listening",
    "          ) {",
    "            resolve(activeProxy.proxyUrl);",
    "            return;",
    "          }",
    "",
    "          if (activeProxy) {",
    "            try {",
    "              activeProxy.server.close();",
    "            } catch (e) {}",
    "            activeProxy = null;",
    "          }",
    "",
    "          const server = http.createServer((req, res) => {",
    "            if (req.url === '/__ag_codex_effort_slider.js') {",
    "              res.writeHead(200, {",
    "                'Content-Type': 'application/javascript; charset=utf-8',",
    "                'Cache-Control': 'no-cache'",
    "              });",
    "              res.end(clientCode);",
    "              return;",
    "            }",
    "",
    "            const options = {",
    "              hostname: targetHost,",
    "              port: targetPort,",
    "              path: req.url,",
    "              method: req.method,",
    "              headers: { ...req.headers, host: targetHost + ':' + targetPort },",
    "              insecureHTTPParser: true",
    "            };",
    "            delete options.headers['accept-encoding'];",
    "",
    "            const proxyReq = http.request(options, (proxyRes) => {",
    "              const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();",
    "              const isHtml = contentType.includes('text/html');",
    "              const isJs = req.url && (req.url === '/main.js' || req.url.startsWith('/main.js?'));",
    "",
    "              if (isHtml) {",
    "                let body = '';",
    "                proxyRes.on('data', (chunk) => (body += chunk));",
    "                proxyRes.on('end', () => {",
    "                  let modified = body;",
    "                  const scriptTag = '<script src=\"/__ag_codex_effort_slider.js\"></script>';",
    "                  if (body.includes('</body>')) {",
    "                    modified = body.replace('</body>', scriptTag + '</body>');",
    "                  } else {",
    "                    modified = body + scriptTag;",
    "                  }",
    "",
    "                  const headers = { ...proxyRes.headers };",
    "                  delete headers['content-length'];",
    "                  delete headers['transfer-encoding'];",
    "                  headers['content-length'] = Buffer.byteLength(modified, 'utf8');",
    "                  res.writeHead(proxyRes.statusCode, headers);",
    "                  res.end(modified);",
    "                });",
    "              } else if (isJs) {",
    "                let body = '';",
    "                proxyRes.on('data', (chunk) => (body += chunk));",
    "                proxyRes.on('end', () => {",
    "                  let modified = body;",
    "                  // 为模型选择面板中的 View Usage 添加 0.3s (300ms) 停留展开延迟",
    "                  modified = modified.replace(",
    "                    /(B\\.createElement\\(fT,\\s*\\{\\s*title:\\s*\"Usage\"\\s*\\}\\s*,\\s*B\\.createElement\\(gT,)\\s*null/g,",
    "                    '$1{delay:300}'",
    "                  );",
    "",
    "                  const headers = { ...proxyRes.headers };",
    "                  delete headers['content-length'];",
    "                  delete headers['transfer-encoding'];",
    "                  headers['content-length'] = Buffer.byteLength(modified, 'utf8');",
    "                  res.writeHead(proxyRes.statusCode, headers);",
    "                  res.end(modified);",
    "                });",
    "              } else {",
    "                res.writeHead(proxyRes.statusCode, proxyRes.headers);",
    "                proxyRes.pipe(res);",
    "              }",
    "            });",
    "",
    "            proxyReq.on('error', (err) => {",
    "              try {",
    "                res.writeHead(502);",
    "                res.end('CodexSlider Proxy Error: ' + err.message);",
    "              } catch (e) {}",
    "            });",
    "",
    "            req.pipe(proxyReq);",
    "          });",
    "",
    "          server.on('upgrade', (req, clientSocket, head) => {",
    "            const serverSocket = net.connect(targetPort, targetHost, () => {",
    "              let rawReq = req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\\r\\n';",
    "              for (let i = 0; i < req.rawHeaders.length; i += 2) {",
    "                let key = req.rawHeaders[i];",
    "                let val = req.rawHeaders[i + 1];",
    "                if (key.toLowerCase() === 'host') val = targetHost + ':' + targetPort;",
    "                rawReq += key + ': ' + val + '\\r\\n';",
    "              }",
    "              rawReq += '\\r\\n';",
    "              serverSocket.write(rawReq);",
    "              if (head && head.length > 0) {",
    "                serverSocket.write(head);",
    "              }",
    "              serverSocket.pipe(clientSocket);",
    "              clientSocket.pipe(serverSocket);",
    "            });",
    "",
    "            serverSocket.on('error', () => {",
    "              try {",
    "                clientSocket.destroy();",
    "              } catch (e) {}",
    "            });",
    "            clientSocket.on('error', () => {",
    "              try {",
    "                serverSocket.destroy();",
    "              } catch (e) {}",
    "            });",
    "          });",
    "",
    "          server.listen(0, '127.0.0.1', () => {",
    "            const proxyPort = server.address().port;",
    "            const proxyUrl = 'http://127.0.0.1:' + proxyPort + '/';",
    "            activeProxy = {",
    "              server,",
    "              proxyUrl,",
    "              targetPort,",
    "              targetHost",
    "            };",
    "            console.log('[CodexSlider] Reverse proxy listening on port', proxyPort, '->', targetHost + ':' + targetPort);",
    "            resolve(proxyUrl);",
    "          });",
    "",
    "          server.on('error', (err) => {",
    "            console.error('[CodexSlider] Proxy server error:', err);",
    "            reject(err);",
    "          });",
    "        } catch (err) {",
    "          reject(err);",
    "        }",
    "      });",
    "    }",
    "",
    "    if (typeof sv !== 'undefined' && sv.BaseVsCodeWebviewDelegate) {",
    "      const origRenderIframe = sv.BaseVsCodeWebviewDelegate.prototype.renderIframe;",
    "      sv.BaseVsCodeWebviewDelegate.prototype.renderIframe = async function (a, b, c) {",
    "        try {",
    "          const proxiedUrl = await ensureProxy(b);",
    "          return origRenderIframe.call(this, a, proxiedUrl, c);",
    "        } catch (err) {",
    "          console.error('[CodexSlider] Failed to proxy iframe, falling back to original:', err);",
    "          return origRenderIframe.call(this, a, b, c);",
    "        }",
    "      };",
    "      console.log('[CodexSlider] Antigravity IDE webview delegate successfully hooked!');",
    "    } else {",
    "      console.warn('[CodexSlider] sv.BaseVsCodeWebviewDelegate not found in extension scope.');",
    "    }",
    "  } catch (err) {",
    "    console.error('[CodexSlider] Error initializing IDE extension patch:', err);",
    "  }",
    "})();",
    PATCH_END_MARKER
  ].join("\n");
}

function applyIdeExtensionPatch(source, clientCode) {
  const cleanBase = stripExistingPreloadPatch(source);
  const targetStr = "}.call(Object.assign(Object.create(globalThis)";
  const insertIdx = cleanBase.lastIndexOf(targetStr);
  const snippet = buildIdeExtensionPatch(clientCode);

  if (insertIdx >= 0) {
    return cleanBase.slice(0, insertIdx) + "\n" + snippet + "\n\n" + cleanBase.slice(insertIdx);
  }
  return cleanBase + "\n\n" + snippet + "\n";
}

function patchIdeFiles(clientCode, isUninstall) {
  // 1. 清理历史遗留的注入文件（workbench.js / jetskiAgent/main.js），原地剥离本插件标记而不覆盖其他插件
  const legacyFiles = findIdeLegacyFiles();
  for (const legacyPath of legacyFiles) {
    const bakPath = legacyPath + ".codex.bak";
    try {
      const cur = fs.readFileSync(legacyPath, "utf8");
      const cleaned = stripExistingPreloadPatch(cur);
      if (cleaned !== cur) {
        fs.writeFileSync(legacyPath, cleaned, "utf8");
        console.log(`[CodexSlider IDE] 已精准清除历史补丁标记: ${legacyPath}`);
      }
      if (fs.existsSync(bakPath)) {
        try { fs.unlinkSync(bakPath); } catch {}
      }
    } catch (err) {
      // 忽略清理异常
    }
  }

  // 2. 注入或精准移除 Antigravity IDE 扩展端反向代理与 Webview 挂钩（保留其他插件）
  const extFiles = findIdeExtensionFiles();
  for (const extPath of extFiles) {
    const bakPath = extPath + ".codex.bak";
    try {
      if (isUninstall) {
        const cur = fs.readFileSync(extPath, "utf8");
        const cleaned = stripExistingPreloadPatch(cur);
        if (cleaned !== cur) {
          fs.writeFileSync(extPath, cleaned, "utf8");
          console.log(`[CodexSlider IDE] 已精准移除扩展补丁（保留其他插件）: ${extPath}`);
        }
        if (fs.existsSync(bakPath)) {
          try { fs.unlinkSync(bakPath); } catch {}
        }
      } else {
        const cur = fs.readFileSync(extPath, "utf8");
        const patched = applyIdeExtensionPatch(cur, clientCode);
        fs.writeFileSync(extPath, patched, "utf8");
        console.log(`[CodexSlider IDE] 已为 Antigravity IDE 原地写入代理注入补丁: ${extPath}`);
      }
    } catch (err) {
      console.warn(`[CodexSlider IDE] 处理 ${extPath} 失败: ${err.message}`);
    }
  }

  const roots = findIdeRoots();
  for (const root of roots) {
    syncIdeProductChecksums(path.join(root, "product.json"), isUninstall);
  }
  clearIdeCodeCache();
}

function runCli() {
  const args = process.argv.slice(2);
  const isUninstall = args.includes("--uninstall") || args.includes("-u");
  const customAsarIdx = args.indexOf("--asar");
  const asarPath =
    customAsarIdx >= 0 && args[customAsarIdx + 1]
      ? path.resolve(args[customAsarIdx + 1])
      : findDefaultAsarPath();
  const clientCode = fs.readFileSync(CLIENT_JS_PATH, "utf8");

  patchIdeFiles(clientCode, isUninstall);

  if (!fs.existsSync(asarPath)) {
    console.error(`[CodexSlider Asar] 未找到目标文件: ${asarPath}`);
    process.exitCode = 1;
    return;
  }

  if (isUninstall) {
    const rawAsar = fs.readFileSync(asarPath);
    const { header, payload } = parseAsarArchive(rawAsar);
    const replacements = new Map();
    let changed = Boolean(header.files?.dist?.files?.["antigravity-codex-effort-slider.js"]);

    const mainEntry = header.files?.dist?.files?.["main.js"];
    if (mainEntry) {
      const off = Number(mainEntry.offset);
      const curMain = payload.subarray(off, off + mainEntry.size).toString("utf8");
      const cleanMain = stripExistingMainPatch(curMain);
      if (cleanMain !== curMain) {
        changed = true;
        replacements.set("dist/main.js", Buffer.from(cleanMain, "utf8"));
      }
    }

    const preloadEntry = header.files?.dist?.files?.["preload.js"];
    if (preloadEntry) {
      const off = Number(preloadEntry.offset);
      const curText = payload.subarray(off, off + preloadEntry.size).toString("utf8");
      const cleanText = stripExistingPreloadPatch(curText);
      if (cleanText !== curText) {
        changed = true;
        replacements.set("dist/preload.js", Buffer.from(cleanText, "utf8"));
      }
    }

    if (!changed) {
      console.log(`[CodexSlider Asar] 未检测到本插件补丁，跳过修改: ${asarPath}`);
      return;
    }

    const outChunks = [];
    repackAsarTree(
      header,
      payload,
      "",
      replacements,
      new Set(["dist/antigravity-codex-effort-slider.js"]),
      outChunks,
      { offset: 0 }
    );
    const restoredBuf = buildAsarArchive(header, outChunks);
    verifyAsarBuffer(restoredBuf, ["dist/preload.js"]);
    const res = tryWriteFileAtomically(asarPath, restoredBuf);
    if (res.written) {
      console.log(`[CodexSlider Asar] 已精准移除本插件补丁（保留其他插件）: ${asarPath}`);
    } else {
      console.log(
        `[CodexSlider Asar] 已生成卸载包 ${res.stagedPath}，后台守护进程将在 Antigravity 关闭瞬间自动完成移除。`
      );
    }
    return;
  }

  const patchedBuffer = createPatchedAsarBuffer(asarPath, clientCode);
  verifyAsarBuffer(patchedBuffer, ["dist/preload.js"]);
  const writeResult = tryWriteFileAtomically(asarPath, patchedBuffer);

  if (writeResult.written) {
    console.log(`[CodexSlider Asar] 已成功将滑条补丁写入: ${asarPath} (${patchedBuffer.length} bytes)`);
  } else {
    console.log(
      `[CodexSlider Asar] 已生成持久补丁包: ${writeResult.stagedPath} (${patchedBuffer.length} bytes)`
    );
    if (writeResult.deferred) {
      console.log(
        `[CodexSlider Asar] 已启动静默后台替换守护进程：当 Antigravity 关闭释放文件锁时将自动完成 app.asar 持久替换。`
      );
    }
  }
}

if (require.main === module) {
  try {
    runCli();
  } catch (err) {
    console.error("[CodexSlider Asar] 处理失败:", err.message || err);
    process.exitCode = 1;
  }
}

module.exports = {
  parseAsarArchive,
  createPatchedAsarBuffer,
  buildPatchedPreloadSource,
  stripExistingPreloadPatch
};
