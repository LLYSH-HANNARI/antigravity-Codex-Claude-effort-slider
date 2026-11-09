## [Ver.1.2.3] - 2026-11-09

### Fixed
- 修复 Antigravity IDE 中滑动或点击推理条至其他档位时弹窗菜单意外自动关闭的问题：
  - **根因分析**：Antigravity IDE (`agy.exe` 的 React 组件树) 中，外层组件 `hKc` 接收原始的 `setSelectedModel` (`b`)，但在渲染子组件 `XJc` 时将其包装为 `g = (m) => { b(m); c(!1); }`（其中 `c(!1)` 即 `setIsOpen(false)`）；此前 Fiber 向上遍历遇到首个包含 `setIsOpen` 的节点即中止，错误捕获了内层包装过的闭包 `g`，导致切档时直接触发闭合。
  - **向上遍历优化**：改进 `readAntigravityFiberContext` 算法，完整收集沿途所有匹配的 Popover 节点并提取最外层 `outerPopoverProps`（`hKc`），优先使用其未包装关菜单逻辑的纯净 `setSelectedModel`。
  - **输入框焦点屏蔽**：Antigravity 原生 `setSelectedModel` 尾部会同步调用 `getLexicalEditor()?.focus()` 抢夺输入框焦点，触发 Radix Popover (`DismissibleLayer`) 的失焦关闭动画；在 `commitAntigravityModelOption` 中动态屏蔽 Lexical editor 实例、原型及全局 DOM `focus()` 抢夺，并在提交后显式保证 `setIsOpen(true)`。
  - **事件隔离增强**：在 `.ces-ag-section` 根部增加 `pointerdown` 与 `mousedown` 的冒泡拦截（`stopPropagation`），彻底消除拖拽或点击空白内边距时触发 Radix Popover 外部指针关闭的可能性。

### Changed
- 完善 `test/client.test.mjs` 测试套件，新增多层嵌套 Fiber 闭包绕过验证及 Lexical Focus 屏蔽单元测试。
- 同步更新独立预览页面 `preview/panel.html` 中的 Fiber 提取与切档加固逻辑。
- 更新 `package.json` 版本至 1.2.3，并重新打包部署到 Antigravity IDE 扩展代理中。
