## [Ver.1.0.0] - 2026-11-07

### Added
- 新增针对 Google Antigravity 架构定制的 Codex 风格推理等级滑条核心引擎（`lib/client.js`）
- 新增跨档位边界即时切换机制：按住滑条拖动越过 1/3 档位边界（`detentTargetIndex`）时，无需等待 `pointerup` 松手即可同步调用 Antigravity 底层会话模型状态接口（`setModelConfigByLabelForConversation`）即时切换官方真实档位
- 新增 Antigravity 原生模型菜单（`[data-testid="model-selector-panel"]`）底部专属「推理等级」滑条区（`.ces-ag-section`），与上方模型列表双向联动
- 新增 Antigravity 三档模型（`Low / Medium / High`）全行程色彩与 22 颗黄金分割低差异星尘映射：
  - `Low (0%)`：纯蓝轨道（`#4d93f8`），0 能量，0 颗星尘点亮，档位文字纯蓝（`#4d93f8`）
  - `Medium (50%)`：蓝紫渐变过渡（`#4d93f8 → #9333ea`），0.5 能量，11 颗星尘点亮（1× 闪烁基准速率），档位文字蓝紫（`#6c78f7`）
  - `High (100%)`：深紫星云全满（`#4d93f8 → #9333ea → #4c1d95`）+ 流光扫掠 + 22 颗星尘全亮（2× 闪烁加速）+ 滑条外框紫光呼吸光晕（`data-ces-max="true"`），档位文字亮紫（`#8b5cf6`）
- 新增单档位模型（如 `GPT-OSS 120B (Medium)`）自动识别与锁定置灰状态（`.is-locked` / `aria-disabled="true"`）
- 新增列表项防关菜单与右侧级联子菜单屏蔽：点击上方模型列表切换模型时保持菜单常驻不关闭，隐藏冗余的右侧悬停 `Low / Medium / High` 子菜单浮层，并为每个模型行右侧及底部触发器胶囊的当前档位文字实时着色
- 新增 React Fiber 双缓冲（`HostRoot.stateNode.current` 与 `alternate`）自适应读取机制，确保连续切档重绘后始终读取最新 Fiber 状态树
- 新增右键 / 触屏长按 500ms 呼出滑条设置面板（`.ces-set`），支持切换三档动画模式（快速动画 / 简洁动画 / 完整动画）、三档刻度点显示（亮白显示 / 与未到达同色 / 隐藏）、复制诊断信息与一键恢复默认
- 新增双模式安装与热注入工具链：
  - 持久启动补丁（`tools/patch-asar.cjs`、`install.cmd`、`uninstall.cmd`）：支持自动重打包 Antigravity 桌面端 `resources/app.asar`（通过 `electron.webFrame.executeJavaScript` 注入渲染进程主世界并自动重算 PE Header SHA-256 哈希）与 Antigravity IDE（`jetskiAgent/main.js`），自动备份原包并支持一键卸载还原
  - CDP 实时热注入（`tools/inject-cdp.cjs`）：自动扫描 `%APPDATA%\Antigravity\DevToolsActivePort` 将滑条实时注入或卸载于正在运行的 Antigravity 窗口，无需重启客户端
- 新增离线多场景交互式预览生成器（`preview/make-preview.mjs` → `preview/panel.html`）与 5 组核心单元与拖拽跨界测试套件（`test/client.test.mjs`）

### Fixed
- 修复 Antigravity IDE 修改 `jetskiAgent/main.js` 后弹出「Antigravity IDE 安装似乎损坏，请重新安装」提示的问题：在 `tools/patch-asar.cjs` 中新增 `syncIdeProductChecksums`，自动备份 `resources/app/product.json` 并重算 `checksums` 中文件的 SHA-256 Base64 校验值，卸载时同步还原
- 修复拖动滑条切向其他档位时模型面板自动消失的问题：将 `readAntigravityFiberContext` 向上遍历深度从 45 层扩展至 500 层以命中位于约 170 层的全局 `ModelConfigProvider`（`setModelConfigByLabelForConversation`），并在 `unwrappedSetSelectedModel` 兜底路径增加同步 `focus` 抢夺屏蔽，防止 `getLexicalEditor()?.focus()` 将焦点移出菜单触发 `@base-ui/react` 失焦关闭动画
- 修复 `detentTargetIndex` 在快速模式下跨越 1/3 边界进入相邻档位过渡区时，因锚点过早跳变导致的死区边界往复抖动问题
- 修复从单档位模型（`GPT-OSS 120B (Medium)`）切回多档位模型时，底部触发器因 React 重新挂载 `<span class="opacity-70">` 导致的档位标签重复显示问题
- 修复 Windows PowerShell 5.1 无 BOM UTF-8 脚本解析兼容问题，通过纯 ASCII 包装脚本（`install-asar.ps1`）转调 Node 统一安装器（`tools/cli-install.cjs`）

### Minor Changes
- **feat**: 面向 Google Antigravity 的 Codex 风格推理等级滑条首版发布 (Ver.1.0.0)
  - 零外部运行时依赖，纯原生 DOM + 连续力律物理引擎（无过冲刹车距离模型）+ React Fiber 状态桥接
  - 完整覆盖 Antigravity Desktop (`app.asar`)、Antigravity IDE (`jetskiAgent/main.js`) 与 CDP 实时热注入三种运行环境
