import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const clientJsPath = path.join(rootDir, "lib", "client.js");
const outHtmlPath = path.join(__dirname, "panel.html");

const clientCode = fs.readFileSync(clientJsPath, "utf8");

const html = `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Antigravity Codex 推理等级滑条 · 交互预览</title>
  <style>
    :root {
      --background: #131316;
      --foreground: #f4f4f6;
      --card: #1c1c21;
      --secondary: #2a2a32;
      --secondary-foreground: #b8b8c4;
      --muted-foreground: #7e7e8c;
      --border: rgba(255, 255, 255, 0.09);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 50% 18%, #231d38 0%, #111115 65%);
      color: var(--foreground);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      gap: 20px;
    }
    .preview-banner {
      max-width: 520px;
      text-align: center;
    }
    .preview-banner h1 {
      margin: 0 0 6px;
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .preview-banner p {
      margin: 0;
      font-size: 12.5px;
      color: var(--secondary-foreground);
      line-height: 1.5;
    }
    .ag-stage {
      width: 310px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ag-menu-popup {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 4px;
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.55);
    }
    [data-testid="model-selector-panel"] {
      display: flex;
      flex-direction: column;
      outline: none;
    }
    [data-testid="model-selector-header"] {
      font-size: 11.5px;
      padding: 4px 8px;
      color: var(--muted-foreground);
      font-weight: 500;
    }
    .ag-model-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding-bottom: 4px;
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
    .text-foreground { color: var(--foreground); font-weight: 500; }
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
      font-size: 10.5px;
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
      padding: 5px 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
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
    .ag-log-box {
      width: 310px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.32);
      border: 1px solid var(--border);
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      color: #a1a1aa;
    }
  </style>
</head>
<body>
  <div class="preview-banner">
    <h1>Antigravity Codex 风格推理等级滑条</h1>
    <p>点击上方模型行切换模型（菜单保持不关），拖动底部滑条跨过档位边界即刻切换真实档位；右键滑条打开设置面板。</p>
  </div>

  <div class="ag-stage">
    <div class="ag-menu-popup">
      <div data-testid="model-selector-panel" id="ag-panel">
        <div class="relative flex flex-col flex-grow min-h-0">
          <div data-testid="model-selector-header">Model</div>
          <div class="ag-model-list">
            <div role="menuitem" class="text-foreground">
              <span class="ag-row-left">
                <span data-testid="model-selector-effort-group" data-model-base="Gemini 4 Argon">Gemini 4 Argon</span>
                <span class="shrink-0 opacity-70 text-xs">High</span>
                <span class="ag-badge">New</span>
              </span>
              <span class="flex shrink-0 pl-1 opacity-50">›</span>
            </div>
            <div role="menuitem" class="text-secondary-foreground">
              <span class="ag-row-left">
                <span data-testid="model-selector-effort-group" data-model-base="Gemini 3.8 Flash">Gemini 3.8 Flash</span>
                <span class="shrink-0 opacity-70 text-xs">Medium</span>
              </span>
              <span class="flex shrink-0 pl-1 opacity-50">›</span>
            </div>
            <div role="menuitem" class="text-secondary-foreground">
              <span class="ag-row-left">
                <span data-testid="model-selector-effort-group" data-model-base="Claude Opus 5.5">Claude Opus 5.5</span>
                <span class="shrink-0 opacity-70 text-xs">Medium</span>
                <span class="ag-badge">New</span>
              </span>
              <span class="flex shrink-0 pl-1 opacity-50">›</span>
            </div>
            <div role="menuitem" class="text-secondary-foreground">
              <span class="ag-row-left">
                <span data-testid="model-selector-effort-group" data-model-base="Claude Sonnet 5.5">Claude Sonnet 5.5</span>
                <span class="shrink-0 opacity-70 text-xs">Medium</span>
                <span class="ag-badge">New</span>
              </span>
              <span class="flex shrink-0 pl-1 opacity-50">›</span>
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
      <button type="button" data-testid="model-selector-trigger" id="ag-trigger" aria-label="Select model, current: Gemini 4 Argon High">
        <span class="min-w-0">Gemini 4 Argon<span class="opacity-70"> High</span></span>
      </button>
      <span style="font-size:11px;color:var(--muted-foreground);">Composer 触发器实时同步</span>
    </div>

    <div class="ag-log-box" id="ag-log">官方当前模型: Gemini 4 Argon (High)</div>
  </div>

  <script>
    window.__agCodexEffortSliderDisableAutoBoot = true;
  </script>
  <script>
${clientCode}
  </script>
  <script>
    (function () {
      var modelOptions = [
        { label: "Gemini 4 Argon (Low)", value: 1419 },
        { label: "Gemini 4 Argon (Medium)", value: 1418 },
        { label: "Gemini 4 Argon (High)", value: 1417 },
        { label: "Gemini 3.8 Flash (Low)", value: 1320 },
        { label: "Gemini 3.8 Flash (Medium)", value: 1319 },
        { label: "Gemini 3.8 Flash (High)", value: 1318 },
        { label: "Claude Opus 5.5 (Low)", value: 1400 },
        { label: "Claude Opus 5.5 (Medium)", value: 1401 },
        { label: "Claude Opus 5.5 (High)", value: 1402 },
        { label: "Claude Sonnet 5.5 (Low)", value: 1403 },
        { label: "Claude Sonnet 5.5 (Medium)", value: 1404 },
        { label: "Claude Sonnet 5.5 (High)", value: 1405 },
        { label: "GPT-OSS 120B (Medium)", value: 342 }
      ];
      var logEl = document.getElementById("ag-log");
      var triggerEl = document.getElementById("ag-trigger");
      var panelEl = document.getElementById("ag-panel");

      var mockContextValue = {
        visibleModelConfigs: modelOptions,
        currentModelConfig: modelOptions[2],
        setModelConfigByLabelForConversation: function (label, convId, persist) {
          var found = modelOptions.find(function (m) { return m.label === label; });
          if (found) {
            mockContextValue.currentModelConfig = found;
            mockPopoverProps.selectedModel = found;
            logEl.textContent = "官方当前模型: " + found.label + " (即时同步)";
          }
        }
      };

      var mockPopoverProps = {
        open: true,
        setIsOpen: function () {},
        modelOptions: modelOptions,
        selectedModel: modelOptions[2],
        setSelectedModel: function (opt) {
          mockContextValue.setModelConfigByLabelForConversation(opt.label, "preview-conv", true);
        }
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

      triggerEl.__reactFiber$preview = popoverFiber;
      panelEl.__reactFiber$preview = popoverFiber;

      window.AntigravityCodexEffortSlider.installCodexEffortSlider({
        document: document,
        window: window
      });
    })();
  </script>
</body>
</html>
`;

fs.writeFileSync(outHtmlPath, html, "utf8");
console.log("Generated preview file:", outHtmlPath);
