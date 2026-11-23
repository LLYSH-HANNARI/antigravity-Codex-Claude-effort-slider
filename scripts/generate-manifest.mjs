#!/usr/bin/env node
/**
 * Release 清单生成脚本 (scripts/generate-manifest.mjs)
 *
 * 读取 package.json 版本号与 Release 产物目录，计算所有二进制与 client.js 的 SHA-256，
 * 输出标准 `manifest.json`（供自更新引擎与在线安装脚本直连拉取）与 `sha256sums.txt`。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
const version = getArg("--version", pkg.version).replace(/^v/i, "");
const tag = `v${version}`;
const repo = getArg("--repo", "LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider");
const distDir = path.resolve(getArg("--dir", path.join(ROOT_DIR, "release-assets")));
const minLoaderVersion = Number(getArg("--min-loader", "1"));

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function downloadUrl(fileName) {
  return `https://github.com/${repo}/releases/download/${tag}/${fileName}`;
}

const clientFile = path.join(distDir, "client.js");
if (!fs.existsSync(clientFile)) {
  throw new Error(`未找到 Release 产物: ${clientFile}`);
}

const binaryMap = {
  "windows-x86_64": "ag-effort-slider-windows-x86_64.exe",
  "macos-aarch64": "ag-effort-slider-macos-aarch64",
  "macos-x86_64": "ag-effort-slider-macos-x86_64",
  "linux-x86_64": "ag-effort-slider-linux-x86_64"
};

const binaries = {};
const sumLines = [];
const clientHash = sha256File(clientFile);
sumLines.push(`${clientHash}  client.js`);

for (const [plat, fileName] of Object.entries(binaryMap)) {
  const full = path.join(distDir, fileName);
  if (fs.existsSync(full)) {
    const hash = sha256File(full);
    binaries[plat] = {
      url: downloadUrl(fileName),
      sha256: hash
    };
    sumLines.push(`${hash}  ${fileName}`);
  }
}

for (const extra of fs.readdirSync(distDir)) {
  if (extra.endsWith(".zip") || extra === "install.ps1" || extra === "install.sh") {
    const full = path.join(distDir, extra);
    if (fs.statSync(full).isFile()) {
      sumLines.push(`${sha256File(full)}  ${extra}`);
    }
  }
}

const manifest = {
  version,
  minLoaderVersion,
  publishedAt: new Date().toISOString(),
  notes: `Antigravity Codex & Claude 推理等级滑条 ${tag}`,
  files: {
    client: {
      url: downloadUrl("client.js"),
      sha256: clientHash
    },
    binaries
  }
};

fs.writeFileSync(path.join(distDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(distDir, "sha256sums.txt"), sumLines.join("\n") + "\n", "utf8");
console.log(`[generate-manifest] 已生成 manifest.json (v${version}) 与 sha256sums.txt`);
