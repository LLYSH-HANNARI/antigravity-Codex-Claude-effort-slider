## [Ver.1.2.2] - 2026-11-09

### Added
- 全面适配 **Antigravity IDE**（基于 VS Code 架构的 IDE 编辑器环境）：
  - **架构深度逆向**：排查并厘清了 Antigravity IDE 与独立客户端（Desktop）的核心差异 —— IDE 端的 Cascade 聊天界面并非运行于外层 VS Code 主窗口（`workbench.html`），而是由后端核心进程 `agy.exe` 动态分配端口（例如 `http://127.0.0.1:<port>`）并在内置 Webview 内通过沙箱 `<iframe>` 渲染。外层注入脚本受跨源策略（Same-Origin Policy）隔离无法直接探测和触达内部 React Fiber 节点。
  - **零侵入反向代理注入引擎**：在 Antigravity IDE 扩展端（`extensions/agy/vscode/extension.js`）的 `sv.BaseVsCodeWebviewDelegate.prototype.renderIframe` 生命周期注入微型反向代理。在保持 100% 原生双向 WebSocket 与 HTTP 链路透明流转的同时，自动在 Webview 加载核心界面 HTML 时注入 `lib/client.js`，实现内外部架构的完美统一。
  - **自适应热重载与容错机制**：代理层搭载 `insecureHTTPParser` 容错处理与双向 Socket 管道保护，无论 IDE 启动、窗口重载还是后台服务重启，滑条均即时生效且无任何卡顿。

### Changed
- 升级 `tools/patch-asar.cjs` 补丁工具：
  - 自动识别并同时支持 **Antigravity Desktop**（`resources/app.asar` 内联与 WebFrame 注入）与 **Antigravity IDE**（`extensions/agy/vscode/extension.js` 扩展反向代理注入）。
  - 新增历史注入遗留文件（`out/vs/code/electron-browser/workbench/workbench.js`、`out/jetskiAgent/main.js`）的自动检测与无损备份还原机制，恢复主程序代码整洁性。
  - 自动维护 `product.json` 校验和并自动清除 V8 字节码缓存（`CachedData`）。

### Fixed
- 修复在 Antigravity IDE 重启后滑条无法显示的问题（通过内联代理在 Chat Iframe 内成功挂载并读取 React Fiber 上下文）。

### Minor Changes
- **feat**: 完美适配 Antigravity IDE 编辑器环境，实现与桌面版一致的 Codex/Claude 双引擎平滑推理滑条 (Ver.1.2.2)
- **refactor**: 重构 `tools/patch-asar.cjs` 支持桌面版 app.asar 与 IDE 扩展双向自动化安装与还原
