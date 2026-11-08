## [Ver.1.2.1] - 2026-11-08

### Fixed
- 修复从 Argon/Flash 切换至 Claude 模型并选择 High 档位时，文字出现二次向上翻转显示的 BUG：
  - **根因分析**：进入 High 档位时文字被赋予向上翻转类名（`is-claude-changing` / `ces-text-rise`，0.3s），同时触发最高档光斑（`is-glowing`，0.4s）。因 CSS 中 `.is-glowing` 声明顺序在后且直接定义了 `animation: ces-text-bloom`，覆盖了正在进行的文字向上位移动画；当 450ms 后光斑定时器移除 `is-glowing` 时，浏览器因样式回退重新执行未清理的翻转动画，产生约半秒后的延迟“二次翻转”。
  - **解决方案**：引入 CSS 复合动画多重声明（`animation: ces-claude-rise, ces-text-bloom`），使文字位移与光晕绽放在 CSS 层并发独立渲染互不打扰；同时增加 320ms 生命周期清理定时器（`__cesRiseTimer`），在翻转完成后即时清理 class，彻底阻断动画样式回退重播隐患。
- 修复初次挂载/打开面板时可能出现的突兀文字翻转：
  - 在创建 `valueEl` 时预置当前模型档位标签初始文本，避免从空字符串 `""` 变更为实际档位标签导致触发入场翻转。

### Added
- 支持 Codex 模型（Gemini 4 Argon / Gemini 3.8 Flash）档位切换顺滑向上翻转动效：
  - 扩展原有仅限 Claude 的文字切换动画，解耦抽象为全模型通用的 `.ces-text-rise` 动效体系（同时保留 `.is-claude-changing` 兼容别名）。
  - 无论是拖动、点击滑条还是切换模型，Argon 和 3.8 Flash 均拥有与 Claude 完全一致的 0.3s 轻快弹性向上翻转（`translateY(85%) → translateY(0)`）动效。
- 新增单元测试断言（`test/client.test.mjs`）：
  - 覆盖 Codex/Argon 档位切换时 `.ces-text-rise` 触发断言。
  - 覆盖 Claude 档位切换时 `.ces-text-rise` 与 `.is-claude-changing` 双兼容类断言。
  - 覆盖 High 档位翻转动效与光斑动效并发执行验证。

### Minor Changes
- **fix**: 修复 Claude 模型切入 High 档位时光斑与位移动画样式覆盖导致的二次翻转 BUG
- **feat**: 为 Gemini 4 Argon 和 Gemini 3.8 Flash 推理滑条启用顺滑文字向上翻转动效 (Ver.1.2.1)
