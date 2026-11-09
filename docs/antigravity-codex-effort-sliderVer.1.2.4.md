## [Ver.1.2.4] - 2026-11-09

### Fixed
- **推理条被框选高亮问题**：
  - 修复滑动推理条关闭模型面板后，重新打开面板时推理条被浏览器/VSCode 默认焦点框（Focus Ring）框选选中的问题。
  - 将推理条 `rootEl` 的 `tabindex` 设为 `-1`，彻底阻断 Radix Popover / Base UI `FocusScope` 在弹窗展开时自动寻找 Tabbable 元素聚焦到滑条的行为。
  - 为 `.ces-root`、`.ces-ag-section` 及其全部子元素在 `:focus`、`:focus-visible`、`:focus-within` 伪类下强制注入 `outline: none !important; outline-width: 0 !important;` 以及 `user-select: none !important;`，杜绝任何默认描边与文本高亮矩形框选，并保留到达 High 档位时的紫色霓虹微光。
  - 在面板卸载（`unmountActiveSection`）时主动清理活动聚焦元素（`blur()`），确保下次开窗时状态完全干净。

### Added
- **View Usage 0.3s (300ms) 停留防误触展开延迟**：
  - 在扩展反向代理中，对 Antigravity IDE 的 Webview `main.js` 中 `View Usage` 组件注入 `{delay: 300}` 属性，将底层 Base UI / Floating UI 的子菜单停留悬停阈值（`restMs` / `delay.open`）从默认 100ms 调整为 300ms。
  - 在 `client.js` 的 `bindPanelInteractions` 中加入双重 DOM 事件捕获防御（`pointerenter`、`pointermove`、`pointerleave`），鼠标划过 "View Usage" 行时若停留未满 0.3s 则拦截弹出展开，仅当鼠标有意悬停停留达 0.3s 时才平滑展开 Usage 子面板，彻底告别浏览模型或移动鼠标时的遮挡误触。
