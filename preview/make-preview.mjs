import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const clientJsPath = path.join(rootDir, "lib", "client.js");
const previewHtmlPath = path.join(__dirname, "panel.html");
const distDir = path.join(rootDir, "dist");
const distHtmlPath = path.join(distDir, "index.html");

const rawClientCode = fs.readFileSync(clientJsPath, "utf8");
const clientCode = rawClientCode
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/\n\s*\n\s*\n/g, "\n\n");

const html = `<!DOCTYPE html>
<html lang="zh-CN" class="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Antigravity Codex & Claude 推理滑条 · 在线交互演示</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>✨</text></svg>">
  <style>
    :root, html.light {
      --background: #f7f7f9;
      --bg-gradient: radial-gradient(circle at 50% 20%, #ebe6f9 0%, #f4f4f7 68%);
      --foreground: #18181b;
      --card: #ffffff;
      --card-border: rgba(0, 0, 0, 0.08);
      --secondary: #f4f4f6;
      --secondary-foreground: #52525c;
      --muted-foreground: #9ca3af;
      --border: rgba(0, 0, 0, 0.08);
      --header-bg: rgba(255, 255, 255, 0.82);
      --badge-bg: #e5e7eb;
      --log-bg: rgba(255, 255, 255, 0.85);
      --btn-bg: #e5e7eb;
      --btn-hover: #d1d5db;
      --btn-text: #18181b;
      --btn-active-border: #7c3aed;
    }
    html.dark {
      --background: #111114;
      --bg-gradient: radial-gradient(circle at 50% 20%, #241d3b 0%, #111115 68%);
      --foreground: #f4f4f6;
      --card: #1c1c22;
      --card-border: rgba(255, 255, 255, 0.08);
      --secondary: #282832;
      --secondary-foreground: #b8b8c6;
      --muted-foreground: #7e7e8e;
      --border: rgba(255, 255, 255, 0.09);
      --header-bg: rgba(28, 28, 34, 0.75);
      --badge-bg: #282834;
      --log-bg: rgba(18, 18, 23, 0.75);
      --btn-bg: #2a2a36;
      --btn-hover: #353544;
      --btn-text: #f4f4f6;
      --btn-active-border: #8b5cf6;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      background: var(--bg-gradient);
      background-color: var(--background);
      color: var(--foreground);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      overflow-x: hidden;
      transition: background-color 0.25s ease, color 0.25s ease;
    }
    .ag-demo-wrapper {
      width: 100%;
      max-width: 580px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      margin: auto 0;
    }
    .ag-header-toolbar {
      width: 100%;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: var(--header-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 10px 14px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
    }
    .ag-toolbar-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ag-logo-tag {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--foreground);
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .ag-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ag-action-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--btn-bg);
      color: var(--btn-text);
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
    }
    .ag-action-btn:hover {
      background: var(--btn-hover);
      transform: translateY(-1px);
    }
    .ag-action-btn:active {
      transform: translateY(0);
    }
    .ag-style-pills {
      display: flex;
      gap: 6px;
      width: 100%;
      justify-content: center;
      flex-wrap: wrap;
    }
    .ag-pill {
      font-size: 11.5px;
      padding: 5px 12px;
      border-radius: 9999px;
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--secondary-foreground);
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .ag-pill:hover, .ag-pill.active {
      color: var(--foreground);
      border-color: var(--btn-active-border);
      background: var(--secondary);
    }
    .ag-pill.is-fading {
      transition: color 0.8s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.8s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.8s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .ag-stage {
      position: relative;
      width: 320px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .ag-orch-submenu {
      position: fixed;
      z-index: 6000;
      min-width: 224px;
      padding: 4px;
      border-radius: 10px;
      background: var(--card);
      border: 1px solid var(--card-border);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.16);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    html.dark .ag-orch-submenu {
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
    }
    .ag-orch-row {
      position: relative;
      border-radius: 9px;
    }
    .ag-orch-row::after {
      content: "";
      position: absolute;
      inset: -1px;
      border-radius: 9px;
      pointer-events: none;
      opacity: 0;
      border: 1.5px solid rgba(139, 92, 246, 0.72);
      background: rgba(139, 92, 246, 0.05);
      box-shadow: 0 0 12px rgba(139, 92, 246, 0.16);
      transition: none;
    }
    .ag-orch-row.is-highlighted::after {
      opacity: 1;
      transition: none;
    }
    .ag-orch-row.is-fading::after {
      opacity: 0;
      transition: opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .ag-menu-popup {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 4px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
      transition: background-color 0.2s ease, border-color 0.2s ease;
    }
    html.dark .ag-menu-popup {
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
    }
    [data-testid="model-selector-panel"] {
      display: flex;
      flex-direction: column;
      outline: none;
    }
    [data-testid="model-selector-header"] {
      font-size: 11.5px;
      padding: 6px 8px 4px;
      color: var(--muted-foreground);
      font-weight: 500;
      user-select: none;
    }
    .ag-model-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-bottom: 2px;
    }
    .ag-model-group {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border-radius: 9px;
    }
    .ag-model-group::after {
      content: "";
      position: absolute;
      inset: -1px;
      border-radius: 9px;
      pointer-events: none;
      opacity: 0;
      border: 1.5px solid rgba(139, 92, 246, 0.72);
      background: rgba(139, 92, 246, 0.05);
      box-shadow: 0 0 12px rgba(139, 92, 246, 0.16);
      transition: none;
    }
    html.dark .ag-model-group::after {
      border-color: rgba(167, 139, 250, 0.78);
      background: rgba(139, 92, 246, 0.08);
      box-shadow: 0 0 14px rgba(167, 139, 250, 0.22);
    }
    .ag-model-group.is-highlighted::after {
      opacity: 1;
      transition: none;
    }
    .ag-model-group.is-fading::after {
      opacity: 0;
      transition: opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1);
    }
    [role="menuitem"] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 12.5px;
      cursor: pointer;
      user-select: none;
      transition: background-color 0.12s ease, color 0.12s ease;
    }
    [role="menuitem"]:hover {
      background: var(--secondary);
      color: var(--foreground);
    }
    .text-foreground { color: var(--foreground) !important; font-weight: 500; }
    .text-secondary-foreground { color: var(--secondary-foreground); }
    .ag-row-left {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }
    .ag-badge {
      background: var(--secondary);
      border-radius: 9999px;
      padding: 1px 6px;
      font-size: 10px;
      color: var(--secondary-foreground);
    }
    .h-px { height: 1px; }
    .bg-border { background: var(--border); }
    .my-1 { margin-top: 4px; margin-bottom: 4px; }
    .-mx-1 { margin-left: -4px; margin-right: -4px; }
    .opacity-70 { opacity: 0.7; }
    .shrink-0 { flex-shrink: 0; }
    .text-xs { font-size: 12px; }
    .ag-composer-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 9999px;
      padding: 5px 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    }
    html.dark .ag-composer-bar {
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    }
    [data-testid="model-selector-trigger"] {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 28px;
      padding: 0 8px;
      border-radius: 9999px;
      border: none;
      background: transparent;
      color: var(--secondary-foreground);
      font-size: 12px;
      cursor: pointer;
    }
    [data-testid="model-selector-trigger"]:hover {
      background: var(--secondary);
      color: var(--foreground);
    }
    ::view-transition-old(root),
    ::view-transition-new(root) {
      animation: none;
      mix-blend-mode: normal;
    }
    ::view-transition-old(root) {
      z-index: 1;
    }
    ::view-transition-new(root) {
      z-index: 9999;
    }
  </style>
</head>
<body>
  <div class="ag-demo-wrapper">
    <header class="ag-header-toolbar">
      <div class="ag-toolbar-left">
        <div class="ag-logo-tag" id="ag-app-title">
          Antigravity 推理滑条演示
        </div>
      </div>
      <div class="ag-toolbar-actions">
        <button type="button" class="ag-action-btn" id="theme-toggle-btn" title="切换亮色/暗色主题">
          <span id="theme-icon">🌙</span> <span id="theme-text">切换暗色</span>
        </button>
        <a href="https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider" target="_blank" rel="noopener noreferrer" class="ag-action-btn" id="github-link" title="查看 GitHub 开源仓库">
          <span>GitHub</span> ↗
        </a>
      </div>
    </header>

    <div class="ag-style-pills">
      <button type="button" class="ag-pill" id="pill-orchestrator" data-style-group="orchestrator" data-target-base="Orchestrator">
        Orchestrator
      </button>
      <button type="button" class="ag-pill" id="pill-codex" data-style-group="codex" data-target-base="Gemini 4 Neon">
        Codex 样式
      </button>
      <button type="button" class="ag-pill" id="pill-claude" data-style-group="claude" data-target-base="Claude Sonnet 5.5">
        Claude Code 样式
      </button>
    </div>

    <main class="ag-stage">
      <div class="ag-menu-popup">
        <div data-testid="model-selector-panel" id="ag-panel">
          <div class="relative flex flex-col flex-grow min-h-0">
            <div data-testid="model-selector-header">Model</div>
            <div class="ag-model-list">
              <div class="ag-orch-row" data-style-group="orchestrator">
                <div role="menuitem" class="text-foreground" data-testid="model-selector-orchestrator" data-model-label="Orchestrator" id="ag-orch-row">
                  <span class="ag-row-left">
                    <span class="shrink-0">Orchestrator</span>
                    <span data-testid="model-selector-orchestrator-model" class="opacity-70 text-xs" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Gemini 4 Neon Extra High</span>
                    <span class="ag-badge">New</span>
                  </span>
                  <span class="flex shrink-0 pl-1 opacity-50">›</span>
                </div>
              </div>
              <div class="ag-model-group" data-style-group="codex">
                <div role="menuitem" class="text-secondary-foreground" data-model-row="Gemini 4 Neon">
                  <span class="ag-row-left">
                    <span data-testid="model-selector-effort-group" data-model-base="Gemini 4 Neon">Gemini 4 Neon</span>
                    <span class="shrink-0 opacity-70 text-xs">Medium</span>
                    <span class="ag-badge">New</span>
                  </span>
                  <span class="flex shrink-0 pl-1 opacity-50">›</span>
                </div>
                <div role="menuitem" class="text-secondary-foreground" data-model-row="Gemini 4 Argon">
                  <span class="ag-row-left">
                    <span data-testid="model-selector-effort-group" data-model-base="Gemini 4 Argon">Gemini 4 Argon</span>
                    <span class="shrink-0 opacity-70 text-xs">Medium</span>
                    <span class="ag-badge">New</span>
                  </span>
                  <span class="flex shrink-0 pl-1 opacity-50">›</span>
                </div>
                <div role="menuitem" class="text-secondary-foreground" data-model-row="Gemini 4 Hydrogen">
                  <span class="ag-row-left">
                    <span data-testid="model-selector-effort-group" data-model-base="Gemini 4 Hydrogen">Gemini 4 Hydrogen</span>
                    <span class="shrink-0 opacity-70 text-xs">Medium</span>
                    <span class="ag-badge">New</span>
                  </span>
                  <span class="flex shrink-0 pl-1 opacity-50">›</span>
                </div>
                <div role="menuitem" class="text-secondary-foreground" data-model-row="Gemini 3.8 Flash">
                  <span class="ag-row-left">
                    <span data-testid="model-selector-effort-group" data-model-base="Gemini 3.8 Flash">Gemini 3.8 Flash</span>
                    <span class="shrink-0 opacity-70 text-xs">Medium</span>
                    <span class="ag-badge">Fast</span>
                  </span>
                  <span class="flex shrink-0 pl-1 opacity-50">›</span>
                </div>
              </div>
              <div class="ag-model-group" data-style-group="claude">
                <div role="menuitem" class="text-secondary-foreground" data-model-row="Claude Opus 5.5">
                  <span class="ag-row-left">
                    <span data-testid="model-selector-effort-group" data-model-base="Claude Opus 5.5">Claude Opus 5.5</span>
                    <span class="shrink-0 opacity-70 text-xs">Medium</span>
                    <span class="ag-badge">New</span>
                  </span>
                  <span class="flex shrink-0 pl-1 opacity-50">›</span>
                </div>
                <div role="menuitem" class="text-secondary-foreground" data-model-row="Claude Sonnet 5.5">
                  <span class="ag-row-left">
                    <span data-testid="model-selector-effort-group" data-model-base="Claude Sonnet 5.5">Claude Sonnet 5.5</span>
                    <span class="shrink-0 opacity-70 text-xs">Medium</span>
                    <span class="ag-badge">New</span>
                  </span>
                  <span class="flex shrink-0 pl-1 opacity-50">›</span>
                </div>
              </div>
              <div role="menuitem" data-testid="model-selector-item" data-model-label="GPT-OSS 120B (Medium)" class="text-secondary-foreground">
                <span class="ag-row-left">
                  <span>GPT-OSS 120B (Medium)</span>
                  <span class="ag-badge">Locked</span>
                </span>
              </div>
            </div>
          </div>
          <div role="separator" aria-orientation="horizontal" class="h-px bg-border my-1 -mx-1"></div>
          <div class="flex flex-col gap-0.5">
            <div role="menuitem" class="text-secondary-foreground">
              <span class="ag-row-left"><span>View Usage</span></span>
              <span class="shrink-0 opacity-70 text-xs">›</span>
            </div>
          </div>
        </div>
      </div>

      <div class="ag-composer-bar">
        <button type="button" data-testid="model-selector-trigger" id="ag-trigger" aria-label="Select model">
          <span class="min-w-0">Orchestrator<span class="opacity-70"> Gemini 4 Neon Extra High</span></span>
        </button>
      </div>
    </main>
  </div>

  <script>
    window.__agCodexEffortSliderDisableAutoBoot = true;
  </script>
  <script>
${clientCode}
  </script>
  <script>
    (function () {
      var I18N = {
        "zh-CN": {
          title: "Antigravity Codex & Claude 推理滑条 · 在线交互演示",
          logo: "Antigravity 推理滑条演示",
          themeDark: "切换暗色",
          themeLight: "切换亮色",
          themeTitle: "切换亮色/暗色主题",
          githubTitle: "查看 GitHub 开源仓库",
          codexPill: "Codex 样式",
          claudePill: "Claude Code 样式"
        },
        "zh-TW": {
          title: "Antigravity Codex & Claude 推理滑條 · 線上互動展示",
          logo: "Antigravity 推理滑條展示",
          themeDark: "切換暗色",
          themeLight: "切換亮色",
          themeTitle: "切換亮色/暗色主題",
          githubTitle: "查看 GitHub 開源倉庫",
          codexPill: "Codex 樣式",
          claudePill: "Claude Code 樣式"
        },
        "en": {
          title: "Antigravity Codex & Claude Effort Slider · Live Interactive Demo",
          logo: "Antigravity Effort Slider Demo",
          themeDark: "Dark Mode",
          themeLight: "Light Mode",
          themeTitle: "Toggle light/dark theme",
          githubTitle: "View GitHub repository",
          codexPill: "Codex Style",
          claudePill: "Claude Code Style"
        },
        "ru": {
          title: "Ползунок рассуждений Antigravity Codex и Claude · Демо",
          logo: "Демо ползунка Antigravity",
          themeDark: "Темная тема",
          themeLight: "Светлая тема",
          themeTitle: "Переключить тему",
          githubTitle: "Открыть репозиторий GitHub",
          codexPill: "Стиль Codex",
          claudePill: "Стиль Claude Code"
        },
        "ja": {
          title: "Antigravity Codex & Claude 推論スライダー · オンラインデモ",
          logo: "Antigravity 推論スライダー デモ",
          themeDark: "ダークモード",
          themeLight: "ライトモード",
          themeTitle: "ライト/ダークテーマ切り替え",
          githubTitle: "GitHub リポジトリを表示",
          codexPill: "Codex スタイル",
          claudePill: "Claude Code スタイル"
        },
        "ko": {
          title: "Antigravity Codex & Claude 추론 슬라이더 · 온라인 데모",
          logo: "Antigravity 추론 슬라이더 데모",
          themeDark: "다크 모드",
          themeLight: "라이트 모드",
          themeTitle: "라이트/다크 테마 전환",
          githubTitle: "GitHub 저장소 보기",
          codexPill: "Codex 스타일",
          claudePill: "Claude Code 스타일"
        },
        "fr": {
          title: "Curseur de raisonnement Antigravity Codex & Claude · Démo",
          logo: "Démo du curseur Antigravity",
          themeDark: "Mode sombre",
          themeLight: "Mode clair",
          themeTitle: "Basculer entre thème clair et sombre",
          githubTitle: "Voir le dépôt GitHub",
          codexPill: "Style Codex",
          claudePill: "Style Claude Code"
        }
      };

      function detectLocale() {
        var langs = (navigator.languages && navigator.languages.length)
          ? navigator.languages
          : [navigator.language || navigator.userLanguage || "en"];

        for (var i = 0; i < langs.length; i += 1) {
          var lang = String(langs[i] || "").toLowerCase().trim();
          if (lang.indexOf("zh-tw") === 0 || lang.indexOf("zh-hk") === 0 || lang.indexOf("zh-mo") === 0 || lang.indexOf("zh-hant") === 0) {
            return "zh-TW";
          }
          if (lang.indexOf("zh") === 0) {
            return "zh-CN";
          }
          if (lang.indexOf("ru") === 0) {
            return "ru";
          }
          if (lang.indexOf("ja") === 0) {
            return "ja";
          }
          if (lang.indexOf("ko") === 0) {
            return "ko";
          }
          if (lang.indexOf("fr") === 0) {
            return "fr";
          }
          if (lang.indexOf("en") === 0) {
            return "en";
          }
        }
        return "en";
      }

      var currentLocale = detectLocale();
      var t = I18N[currentLocale] || I18N["en"];
      document.documentElement.lang = currentLocale;
      document.title = t.title;

      var logoEl = document.getElementById("ag-app-title");
      if (logoEl) logoEl.textContent = t.logo;

      var ghLink = document.getElementById("github-link");
      if (ghLink) ghLink.setAttribute("title", t.githubTitle);

      var pillCodexEl = document.getElementById("pill-codex");
      if (pillCodexEl) pillCodexEl.textContent = t.codexPill;

      var pillClaudeEl = document.getElementById("pill-claude");
      if (pillClaudeEl) pillClaudeEl.textContent = t.claudePill;

      var themeToggleBtn = document.getElementById("theme-toggle-btn");
      var themeIcon = document.getElementById("theme-icon");
      var themeText = document.getElementById("theme-text");
      if (themeToggleBtn) themeToggleBtn.setAttribute("title", t.themeTitle);
      if (themeText) themeText.textContent = t.themeDark;

      var modelOptions = [
        { label: "Orchestrator", modelId: "gemini-pro-orchestrator", value: 1600 },
        { label: "Gemini 4 Neon (Low)", modelId: "gemini-4-neon-low", value: 1450 },
        { label: "Gemini 4 Neon (Medium)", modelId: "gemini-4-neon-medium", value: 1451 },
        { label: "Gemini 4 Neon (High)", modelId: "gemini-4-neon-high", value: 1452 },
        { label: "Gemini 4 Neon (Extra High)", modelId: "gemini-4-neon-xhigh", value: 1453 },
        { label: "Gemini 4 Argon (Low)", modelId: "gemini-4-argon-low", value: 1419 },
        { label: "Gemini 4 Argon (Medium)", modelId: "gemini-4-argon-medium", value: 1418 },
        { label: "Gemini 4 Argon (High)", modelId: "gemini-4-argon-high", value: 1417 },
        { label: "Gemini 4 Hydrogen (Low)", modelId: "gemini-4-hydrogen-low", value: 1439 },
        { label: "Gemini 4 Hydrogen (Medium)", modelId: "gemini-4-hydrogen-medium", value: 1438 },
        { label: "Gemini 4 Hydrogen (High)", modelId: "gemini-4-hydrogen-high", value: 1437 },
        { label: "Gemini 4 Hydrogen (Extra)", modelId: "gemini-4-hydrogen-xhigh", value: 1436 },
        { label: "Gemini 3.8 Flash (Low)", modelId: "gemini-3.8-flash-low", value: 1320 },
        { label: "Gemini 3.8 Flash (Medium)", modelId: "gemini-3.8-flash-medium", value: 1319 },
        { label: "Gemini 3.8 Flash (High)", modelId: "gemini-3.8-flash-high", value: 1318 },
        { label: "Claude Opus 5.5 (Low)", modelId: "claude-opus-5-5-low", value: 1400 },
        { label: "Claude Opus 5.5 (Medium)", modelId: "claude-opus-5-5-medium", value: 1401 },
        { label: "Claude Opus 5.5 (High)", modelId: "claude-opus-5-5-high", value: 1402 },
        { label: "Claude Sonnet 5.5 (Low)", modelId: "claude-sonnet-5-5-low", value: 1403 },
        { label: "Claude Sonnet 5.5 (Medium)", modelId: "claude-sonnet-5-5-medium", value: 1404 },
        { label: "Claude Sonnet 5.5 (High)", modelId: "claude-sonnet-5-5-high", value: 1405 },
        { label: "GPT-OSS 120B (Medium)", value: 342 }
      ];

      var orchestratorPlanners = [
        modelOptions[1], modelOptions[2], modelOptions[3], modelOptions[4],
        modelOptions[5], modelOptions[6], modelOptions[7],
        modelOptions[15], modelOptions[16], modelOptions[17]
      ];
      var orchestratorPlannerIndex = new Map([
        ["gemini-4-neon", new Map([
          ["low", modelOptions[1]],
          ["medium", modelOptions[2]],
          ["high", modelOptions[3]],
          ["xhigh", modelOptions[4]]
        ])],
        ["gemini-4-argon", new Map([
          ["low", modelOptions[5]],
          ["medium", modelOptions[6]],
          ["high", modelOptions[7]]
        ])],
        ["claude-opus-5-5", new Map([
          ["low", modelOptions[15]],
          ["medium", modelOptions[16]],
          ["high", modelOptions[17]]
        ])]
      ]);
      var orchestratorPick = {
        model: modelOptions[4].value,
        select: function (nextVal) {
          orchestratorPick.model = nextVal;
        }
      };

      var triggerEl = document.getElementById("ag-trigger");
      var panelEl = document.getElementById("ag-panel");
      var orchRowEl = document.getElementById("ag-orch-row");
      var pills = document.querySelectorAll(".ag-pill");
      var styleGroups = document.querySelectorAll(".ag-model-group[data-style-group], .ag-orch-row[data-style-group]");
      var flashHoldTimer = null;
      var flashFadeTimer = null;

      function getStyleGroupForLabel(modelLabel) {
        if (/^orchestrator/i.test(String(modelLabel || "").trim())) return "orchestrator";
        var match = String(modelLabel || "").match(/^(.*?)\\s*\\((Off|Low|Medium|High|Extra\\s+High|Extra|xhigh|Max)\\)$/i);
        var base = match ? match[1] : String(modelLabel || "");
        if (/claude/i.test(base)) return "claude";
        if (/gemini/i.test(base)) return "codex";
        return "";
      }

      function clearStyleFlash() {
        if (flashHoldTimer) {
          clearTimeout(flashHoldTimer);
          flashHoldTimer = null;
        }
        if (flashFadeTimer) {
          clearTimeout(flashFadeTimer);
          flashFadeTimer = null;
        }
        pills.forEach(function (pill) {
          pill.classList.remove("active");
          pill.classList.remove("is-fading");
        });
        styleGroups.forEach(function (groupEl) {
          groupEl.classList.remove("is-highlighted");
          groupEl.classList.remove("is-fading");
        });
      }

      function triggerStyleFlash(targetGroup) {
        clearStyleFlash();
        if (!targetGroup) return;

        void panelEl.offsetWidth;

        var targetPills = [];
        var targetGroupEls = [];

        pills.forEach(function (pill) {
          if (pill.getAttribute("data-style-group") === targetGroup) {
            pill.classList.add("active");
            targetPills.push(pill);
          }
        });
        styleGroups.forEach(function (groupEl) {
          if (groupEl.getAttribute("data-style-group") === targetGroup) {
            groupEl.classList.add("is-highlighted");
            targetGroupEls.push(groupEl);
          }
        });

        flashHoldTimer = setTimeout(function () {
          flashHoldTimer = null;
          targetPills.forEach(function (pill) {
            pill.classList.add("is-fading");
            pill.classList.remove("active");
          });
          targetGroupEls.forEach(function (groupEl) {
            groupEl.classList.remove("is-highlighted");
            groupEl.classList.add("is-fading");
          });

          flashFadeTimer = setTimeout(function () {
            flashFadeTimer = null;
            targetPills.forEach(function (pill) {
              pill.classList.remove("is-fading");
            });
            targetGroupEls.forEach(function (groupEl) {
              groupEl.classList.remove("is-fading");
            });
          }, 850);
        }, 500);
      }

      var mockContextValue = {
        visibleModelConfigs: modelOptions,
        currentModelConfig: modelOptions[0],
        setModelConfigByLabelForConversation: function (label, convId, persist) {
          var found = modelOptions.find(function (m) { return m.label === label; });
          if (found) {
            mockContextValue.currentModelConfig = found;
            mockPopoverProps.selectedModel = found;
            mockProviderValue.selectedModel = found;
          }
        }
      };

      var mockPopoverProps = {
        open: true,
        setIsOpen: function () {},
        modelOptions: modelOptions,
        selectedModel: modelOptions[0],
        orchestratorPick: orchestratorPick,
        setSelectedModel: function (opt) {
          if (opt && opt.label) {
            mockContextValue.setModelConfigByLabelForConversation(opt.label, "preview-conv", true);
          }
        }
      };

      var mockProviderValue = {
        effortIndex: new Map(),
        modelOptions: modelOptions,
        selectedModel: modelOptions[0],
        groups: [],
        orchestratorPlanners: orchestratorPlanners,
        orchestratorPlannerIndex: orchestratorPlannerIndex,
        orchestratorDefaultPlanner: modelOptions[4],
        orchestratorPick: orchestratorPick
      };

      var rootFiber = {
        memoizedProps: { value: mockContextValue },
        return: null
      };
      var convFiber = {
        memoizedProps: { conversationId: "preview-conv", placement: "top-start" },
        return: rootFiber
      };
      var popoverFiber = {
        memoizedProps: mockPopoverProps,
        return: convFiber
      };
      var providerFiber = {
        memoizedProps: { value: mockProviderValue },
        return: popoverFiber
      };

      triggerEl.__reactFiber$preview = providerFiber;
      panelEl.__reactFiber$preview = providerFiber;

      var orchSubmenuEl = null;
      var orchCloseTimer = null;

      function positionOrchSubmenu() {
        if (!orchSubmenuEl || !orchRowEl) return;
        var rect = orchRowEl.getBoundingClientRect();
        var vw = window.innerWidth || 800;
        var menuWidth = 228;
        if (rect.right + 6 + menuWidth <= vw - 8) {
          orchSubmenuEl.style.left = (rect.right + 6) + "px";
          orchSubmenuEl.style.top = rect.top + "px";
        } else {
          orchSubmenuEl.style.left = Math.max(8, vw - menuWidth - 8) + "px";
          orchSubmenuEl.style.top = (rect.bottom + 4) + "px";
        }
      }

      function buildOrchSubmenu() {
        var menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        menu.className = "ag-orch-submenu";
        var items = [
          { base: "Gemini 4 Neon", label: "Extra" },
          { base: "Gemini 4 Argon", label: "Medium" },
          { base: "Claude Opus 5.5", label: "Medium" }
        ];
        items.forEach(function (it) {
          var row = document.createElement("div");
          row.setAttribute("role", "menuitem");
          row.setAttribute("data-testid", "orchestrator-picker-row");
          row.setAttribute("data-model-base", it.base);
          row.className = "text-secondary-foreground";
          var left = document.createElement("span");
          left.className = "ag-row-left";
          var nameS = document.createElement("span");
          nameS.textContent = it.base;
          var effS = document.createElement("span");
          effS.className = "shrink-0 opacity-70 text-xs";
          effS.textContent = it.label;
          left.appendChild(nameS);
          left.appendChild(effS);
          var arrowS = document.createElement("span");
          arrowS.className = "flex shrink-0 pl-1 opacity-50";
          arrowS.textContent = "›";
          row.appendChild(left);
          row.appendChild(arrowS);
          menu.appendChild(row);
        });
        menu.__reactFiber$preview = providerFiber;
        menu.addEventListener("pointerenter", cancelOrchClose);
        menu.addEventListener("pointerleave", scheduleOrchClose);
        return menu;
      }

      function openOrchSubmenu() {
        cancelOrchClose();
        if (!orchSubmenuEl) {
          orchSubmenuEl = buildOrchSubmenu();
          document.body.appendChild(orchSubmenuEl);
        }
        positionOrchSubmenu();
      }

      function closeOrchSubmenu() {
        cancelOrchClose();
        if (orchSubmenuEl && orchSubmenuEl.parentNode) {
          orchSubmenuEl.parentNode.removeChild(orchSubmenuEl);
        }
        orchSubmenuEl = null;
      }

      function cancelOrchClose() {
        if (orchCloseTimer) {
          clearTimeout(orchCloseTimer);
          orchCloseTimer = null;
        }
      }

      function scheduleOrchClose() {
        cancelOrchClose();
        orchCloseTimer = setTimeout(function () {
          orchCloseTimer = null;
          closeOrchSubmenu();
        }, 160);
      }

      if (orchRowEl) {
        orchRowEl.addEventListener("pointerenter", openOrchSubmenu);
        orchRowEl.addEventListener("pointerleave", scheduleOrchClose);
        orchRowEl.addEventListener("pointerdown", openOrchSubmenu);
      }
      document.addEventListener("pointerdown", function (ev) {
        if (!orchSubmenuEl) return;
        var t = ev.target;
        if (
          (orchRowEl && orchRowEl.contains(t)) ||
          (orchSubmenuEl && orchSubmenuEl.contains(t)) ||
          (t && t.closest && (t.closest(".ces-ag-section") || t.closest("#pill-orchestrator")))
        ) {
          return;
        }
        closeOrchSubmenu();
      });
      window.addEventListener("resize", positionOrchSubmenu);

      window.AntigravityCodexEffortSlider.installCodexEffortSlider({
        document: document,
        window: window
      });

      var isDark = false;
      document.body.style.backgroundColor = "#f7f7f9";

      function applyTheme(nextIsDark) {
        isDark = nextIsDark;
        var htmlEl = document.documentElement;
        if (isDark) {
          htmlEl.classList.remove("light");
          htmlEl.classList.add("dark");
          themeIcon.textContent = "☀️";
          themeText.textContent = t.themeLight;
          document.body.style.backgroundColor = "#111114";
        } else {
          htmlEl.classList.remove("dark");
          htmlEl.classList.add("light");
          themeIcon.textContent = "🌙";
          themeText.textContent = t.themeDark;
          document.body.style.backgroundColor = "#f7f7f9";
        }
        window.dispatchEvent(new Event("resize"));
      }

      themeToggleBtn.addEventListener("click", function (event) {
        var nextIsDark = !isDark;
        if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          applyTheme(nextIsDark);
          return;
        }

        var rect = themeToggleBtn.getBoundingClientRect();
        var x = event && typeof event.clientX === "number" ? event.clientX : (rect.left + rect.width / 2);
        var y = event && typeof event.clientY === "number" ? event.clientY : (rect.top + rect.height / 2);
        var endRadius = Math.hypot(
          Math.max(x, window.innerWidth - x),
          Math.max(y, window.innerHeight - y)
        );

        var transition = document.startViewTransition(function () {
          applyTheme(nextIsDark);
        });

        transition.ready.then(function () {
          document.documentElement.animate(
            {
              clipPath: [
                "circle(0px at " + x + "px " + y + "px)",
                "circle(" + endRadius + "px at " + x + "px " + y + "px)"
              ]
            },
            {
              duration: 480,
              easing: "cubic-bezier(0.32, 0.72, 0, 1)",
              pseudoElement: "::view-transition-new(root)"
            }
          );
        });
      });

      pills.forEach(function (pill) {
        pill.addEventListener("click", function () {
          var targetGroup = pill.getAttribute("data-style-group");
          var targetBase = pill.getAttribute("data-target-base");
          var currentGroup = getStyleGroupForLabel(mockContextValue.currentModelConfig.label);
          triggerStyleFlash(targetGroup);
          if (targetGroup === "orchestrator") {
            if (orchRowEl) {
              orchRowEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            }
            openOrchSubmenu();
            return;
          }
          closeOrchSubmenu();
          if (currentGroup !== targetGroup) {
            var row = document.querySelector('[data-model-row="' + targetBase + '"]');
            if (row) {
              row.click();
            }
          }
        });
      });
    })();
  </script>
</body>
</html>
`;

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(previewHtmlPath, html, "utf8");
console.log("Generated preview file:", previewHtmlPath);

fs.writeFileSync(distHtmlPath, html, "utf8");
console.log("Generated dist demo file:", distHtmlPath);
