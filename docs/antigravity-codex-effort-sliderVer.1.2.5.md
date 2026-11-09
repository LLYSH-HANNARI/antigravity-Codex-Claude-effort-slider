## [Ver.1.2.5] - 2026-11-09

### Fixed
- **View Usage 鼠标移出再次移入后 0.3s 延迟失效问题修复**：
  - 修复 View Usage 子菜单在首次通过 0.3 秒停留展开后，鼠标移出再次移入时延迟失效、直接秒开的缺陷。
  - **DOM 规范根因修复**：根据 W3C DOM Events 规范，`pointerleave` / `mouseleave` 事件不冒泡且仅派发给被离开的元素。当鼠标在模型弹窗 `panel` 内部从 View Usage 移动到其他模型项或滑条时，`panel` 容器元素从未离开，因此挂载在 `panel` 上的 `pointerleave` 永远不会触发，导致旧版 `usageHoverAllowed` 状态永久保持为 `true`，再次移入时被直接放行。
  - **全链路多维离开状态监听**：
    1. 直接在 View Usage 目标元素上注册 `pointerleave` 与 `mouseleave` 专属监听；
    2. 在面板捕获层监听可冒泡的 `pointerout`，当 `!trigger.contains(ev.relatedTarget)` 时立刻判定移出；
    3. 在面板捕获层监听 `pointerover`，当鼠标移入其他模型项或空白区时即时重置 View Usage 悬停状态；
    4. 面板卸载（`unmountActiveSection`）与面板整体离开时挂载 `__cesAgResetUsageHover` 立即销毁未完成定时器与残留标记。
  - **合成事件瞬态隔离机制**：引入 `isDispatchingSynthetic` 瞬态锁，仅在 300ms 定时器回调执行派发合成事件的极短同步窗口内放行；派发完成后立即恢复未授权状态，确保后续每一次真正的鼠标移入均严格重新计算 0.3 秒停留延迟。
  - **多环境事件构造降级**：实现 `win.PointerEvent` -> `PointerEvent` -> `MouseEvent` -> `Event` 多层级安全降级派发，兼顾 IDE 真实 Webview、Electron 环境与自动化测试。

### Added
- **多轮移入/移出 0.3s 延迟回归单元测试**：
  - 新增测试套件 8（`8. View Usage 0.3s (300ms) 停留展开防误触及移出后再次移入重新计时验证`），涵盖首次移入拦截、100ms 快速划过移出自动取消定时器、停留满 300ms 触发合成展开、移出到其他模型项状态即时重置、再次移入 View Usage 强制重新等待 300ms 等全流程断言，全部 8 项测试套件 100% 通过。
