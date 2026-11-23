#!/usr/bin/env sh
# Antigravity Codex & Claude 推理等级滑条 macOS / Linux 一行在线安装脚本
set -eu

MIRROR="${AG_SLIDER_MIRROR:-}"
MANIFEST_URL="https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider/releases/latest/download/manifest.json"

resolve_url() {
  if [ -n "$MIRROR" ]; then
    printf "%s/%s" "${MIRROR%/}" "$1"
  else
    printf "%s" "$1"
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print tolower($1)}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print tolower($1)}'
  else
    echo "错误: 未找到 sha256sum 或 shasum 命令" >&2
    exit 1
  fi
}

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Darwin-arm64|Darwin-aarch64) PLAT="macos-aarch64" ;;
  Darwin-x86_64) PLAT="macos-x86_64" ;;
  Linux-x86_64) PLAT="linux-x86_64" ;;
  *)
    echo "暂不支持的平台: $OS ($ARCH)" >&2
    exit 1
    ;;
esac

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "[1/4] 正在获取最新版本清单..."
MANIFEST_FILE="$TMP_DIR/manifest.json"
curl -fsSL "$(resolve_url "$MANIFEST_URL")" -o "$MANIFEST_FILE"

if command -v python3 >/dev/null 2>&1; then
  PARSED="$(python3 - "$MANIFEST_FILE" "$PLAT" <<'PY'
import json, sys
m = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
p = sys.argv[2]
print(m['version'])
print(m['files']['client']['url'])
print(m['files']['client']['sha256'])
print(m['files']['binaries'][p]['url'])
print(m['files']['binaries'][p]['sha256'])
PY
)"
elif command -v node >/dev/null 2>&1; then
  PARSED="$(node -e "const m=require(process.argv[1]);const p=process.argv[2];console.log([m.version,m.files.client.url,m.files.client.sha256,m.files.binaries[p].url,m.files.binaries[p].sha256].join('\n'));" "$MANIFEST_FILE" "$PLAT")"
else
  echo "错误: 需要 python3 或 node 来解析 manifest.json" >&2
  exit 1
fi

VERSION="$(printf "%s\n" "$PARSED" | sed -n '1p')"
CLIENT_URL="$(printf "%s\n" "$PARSED" | sed -n '2p')"
CLIENT_SHA="$(printf "%s\n" "$PARSED" | sed -n '3p' | tr '[:upper:]' '[:lower:]')"
BIN_URL="$(printf "%s\n" "$PARSED" | sed -n '4p')"
BIN_SHA="$(printf "%s\n" "$PARSED" | sed -n '5p' | tr '[:upper:]' '[:lower:]')"

BIN_PATH="$TMP_DIR/ag-effort-slider"
CLIENT_PATH="$TMP_DIR/client.js"

echo "[2/4] 正在下载原生安装引擎 (v$VERSION / $PLAT)..."
curl -fsSL "$(resolve_url "$BIN_URL")" -o "$BIN_PATH"
ACTUAL_BIN_SHA="$(sha256_file "$BIN_PATH")"
if [ "$ACTUAL_BIN_SHA" != "$BIN_SHA" ]; then
  echo "错误: 二进制 SHA-256 校验失败" >&2
  exit 1
fi
chmod +x "$BIN_PATH"

echo "[3/4] 正在下载并校验客户端脚本..."
curl -fsSL "$(resolve_url "$CLIENT_URL")" -o "$CLIENT_PATH"
ACTUAL_CLIENT_SHA="$(sha256_file "$CLIENT_PATH")"
if [ "$ACTUAL_CLIENT_SHA" != "$CLIENT_SHA" ]; then
  echo "错误: client.js SHA-256 校验失败" >&2
  exit 1
fi

echo "[4/4] 正在部署至原生插件目录并注入引导器..."
"$BIN_PATH" install --client "$CLIENT_PATH"
if [ -n "$MIRROR" ]; then
  "$BIN_PATH" config --mirror "$MIRROR" >/dev/null
fi

echo "安装完成！若 Antigravity 正在运行，请重启或重载窗口生效。"
