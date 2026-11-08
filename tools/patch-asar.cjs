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

function findIdeTargetFiles() {
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

function findIdeJetskiMainPaths() {
  return findIdeTargetFiles();
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

function stripExistingPreloadPatch(source) {
  let cleaned = String(source || "").replace(LEGACY_REQUIRE_RE, "\n");
  const startIdx = cleaned.indexOf(PATCH_START_MARKER);
  const endIdx = cleaned.indexOf(PATCH_END_MARKER);
  if (startIdx >= 0 && endIdx > startIdx) {
    cleaned =
      cleaned.slice(0, startIdx).replace(/\s+$/, "") +
      "\n" +
      cleaned.slice(endIdx + PATCH_END_MARKER.length).replace(/^\s+/, "");
  }
  return cleaned;
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
    fs.copyFileSync(productBakPath, productJsonPath);
    console.log(`[CodexSlider IDE] 已还原 product.json 校验表: ${productJsonPath}`);
    return;
  }

  const rawText = fs.readFileSync(productJsonPath, "utf8");
  if (!isUninstall && !fs.existsSync(productBakPath)) {
    fs.writeFileSync(productBakPath, rawText, "utf8");
  }

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

function patchIdeJetskiFiles(clientCode, isUninstall) {
  const ideFiles = findIdeJetskiMainPaths();
  const touchedRoots = new Set();
  for (const mainJsPath of ideFiles) {
    const bakPath = mainJsPath + ".codex.bak";
    try {
      if (isUninstall) {
        if (fs.existsSync(bakPath)) {
          fs.copyFileSync(bakPath, mainJsPath);
          console.log(`[CodexSlider IDE] 已从备份还原: ${mainJsPath}`);
        } else {
          const cur = fs.readFileSync(mainJsPath, "utf8");
          const cleaned = stripExistingPreloadPatch(cur);
          if (cleaned !== cur) {
            fs.writeFileSync(mainJsPath, cleaned, "utf8");
            console.log(`[CodexSlider IDE] 已移除补丁: ${mainJsPath}`);
          }
        }
      } else {
        const cur = fs.readFileSync(mainJsPath, "utf8");
        const cleanBase = stripExistingPreloadPatch(cur);
        if (!fs.existsSync(bakPath)) {
          fs.writeFileSync(bakPath, cleanBase, "utf8");
        }
        const patched =
          cleanBase.replace(/\s+$/, "") +
          "\n" +
          PATCH_START_MARKER +
          "\n" +
          clientCode +
          "\n" +
          PATCH_END_MARKER +
          "\n";
        fs.writeFileSync(mainJsPath, patched, "utf8");
        console.log(`[CodexSlider IDE] 已为 Antigravity IDE 写入补丁: ${mainJsPath}`);
      }
      const appRoot = findAppRoot(mainJsPath);
      if (appRoot) touchedRoots.add(appRoot);
    } catch (err) {
      console.warn(`[CodexSlider IDE] 跳过 ${mainJsPath}: ${err.message}`);
    }
  }

  for (const root of touchedRoots) {
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
  const bakPath = asarPath + ".bak";
  const clientCode = fs.readFileSync(CLIENT_JS_PATH, "utf8");

  patchIdeJetskiFiles(clientCode, isUninstall);

  if (!fs.existsSync(asarPath)) {
    console.error(`[CodexSlider Asar] 未找到目标文件: ${asarPath}`);
    process.exitCode = 1;
    return;
  }

  if (isUninstall) {
    const sourceToRestore = fs.existsSync(bakPath) ? bakPath : asarPath;
    const rawAsar = fs.readFileSync(sourceToRestore);
    const { header, payload } = parseAsarArchive(rawAsar);
    const preloadEntry = header.files?.dist?.files?.["preload.js"];
    if (preloadEntry) {
      const off = Number(preloadEntry.offset);
      const curText = payload.subarray(off, off + preloadEntry.size).toString("utf8");
      const cleanBuf = Buffer.from(stripExistingPreloadPatch(curText), "utf8");
      const outChunks = [];
      repackAsarTree(
        header,
        payload,
        "",
        new Map([["dist/preload.js", cleanBuf]]),
        new Set(["dist/antigravity-codex-effort-slider.js"]),
        outChunks,
        { offset: 0 }
      );
      const restoredBuf = buildAsarArchive(header, outChunks);
      const res = tryWriteFileAtomically(asarPath, restoredBuf);
      if (res.written) {
        console.log(`[CodexSlider Asar] 已成功还原纯净包: ${asarPath}`);
      } else {
        console.log(
          `[CodexSlider Asar] 已生成还原包 ${res.stagedPath}，后台守护进程将在 Antigravity 关闭瞬间自动完成覆盖。`
        );
      }
    }
    return;
  }

  if (!fs.existsSync(bakPath)) {
    fs.copyFileSync(asarPath, bakPath);
    console.log(`[CodexSlider Asar] 已创建原始备份: ${bakPath}`);
  }

  const patchedBuffer = createPatchedAsarBuffer(bakPath, clientCode);
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
