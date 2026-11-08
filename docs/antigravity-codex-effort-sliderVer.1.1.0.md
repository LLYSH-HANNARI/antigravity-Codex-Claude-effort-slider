## [Ver.1.1.0] - 2026-11-08

### Added
- 新增对 Antigravity 官方两个 Claude 模型（`Claude Opus 5.5` 与 `Claude Sonnet 5.5`）的专属 Claude Code 风格推理等级滑条支持（仿照 `youqisibun/dsh-claude-effort-slider` 视觉标准）
- 新增双风格智能自适应引擎：
  - 当选中 `Gemini 4 Argon` 或 `Gemini 3.8 Flash` 时，自动呈现经典 Codex 星空流光风格（圆形光晕滑块 + 22 颗黄金分割星尘圆点从右向左横穿已填充轨道 + 深紫渐变星云扫光）
  - 当选中 `Claude Opus 5.5` 或 `Claude Sonnet 5.5` 时，即时无缝变形为 Claude Code 风格（矩形圆角 Capsule 胶囊滑块 24×30px + 中心垂直凹槽 + 紫罗兰/淡紫调色板 + High 档 6×60 Canvas 像素点阵扫掠动画）
  - 当选中 `GPT-OSS 120B (Medium)` 或单档位模型时，保持锁定置灰态（`.is-locked` / `aria-disabled="true"`）
- 新增 Claude Ultracode 核心 6×60 Canvas 像素点阵抖动引擎（`lib/client.js`）：
  - 6 行网格设计（单元格高度约 4.67px），360 个离散圆角像素方块
  - 4 阶连续噪声（`valueNoise` + `hash01`）与双相速度刚性向左平移双脉冲波（`rowWaves` 与 `rowWaves2`，恒定从右向左推进）
  - 1600ms 入场扫掠（`progress` 从右向左推进波前，边缘 ±2.5% 参差）+ 待机脉冲（铺满后每行独立向左流动），离开 High 档或切换为 Codex 模型时自动挂起 Canvas RAF 循环以保持零冗余开销
  - 完整自适应 Antigravity 明暗主题：深色模式采用暗紫底晕（`rgba(112,78,162,0.75)`）与亮紫点阵（`#c4b5fd` / `#ddd6fe`）；浅色模式采用饱和平滑底晕与马赛克合并块高光
- 新增 Claude 档位切换视觉微动效：
  - 切档文字上浮动画（`@keyframes ces-claude-rise`，300ms 上浮与微缩放弹性反馈）
  - 档位标签与触发器按钮后缀实时采用 Claude 专属色调（Low: `#94a3b8`、Medium: `#a78bfa`、High: `#c4b5fd`）
- 新增单元测试套件 Test 6（`test/client.test.mjs`）：
  - 覆盖 Claude 模型自动识别检测（`isClaudeModel`）
  - 覆盖 Claude 专属三档色彩体系与点阵数学管道（`valueColorFor`、`hash01`、`ditherAlphaAt`、`valueNoise`）
  - 覆盖深色与浅色双模式 Canvas `paintDither` 绘制指令验证
  - 覆盖 Claude 模式下按住滑条拖动跨越 1/3 边界即时触发会话切档行为

### Changed
- 扩展 `resolveModelEffortProfile` 返回结构，新增 `isClaude` 与 `theme`（`"claude" | "codex"`）属性
- 扩展 `syncTriggerColor`、`fillColorFor`、`fillBackgroundFor`，无缝支持根据当前模型风格动态输出 Claude 色彩与渐变
- 扩展 `agSeatAdapter` 属性，添加 `baseName`、`isClaude` 与 `theme` 响应式 Getter
- 更新离线预览脚本（`preview/make-preview.mjs`）与交互预览页（`preview/panel.html`），支持在面板内点击切换 Argon、3.8 Flash、Claude Opus、Claude Sonnet 与 GPT-OSS，直观对比双风格即时变形与切档联动

### Minor Changes
- **feat**: 发布双风格自适应推理等级滑条 (Ver.1.1.0)
  - 保留 Gemini 4 Argon / 3.8 Flash 原有 Codex 星空流光风格
  - 为 Claude Opus 5.5 / Sonnet 5.5 引入全新 Claude Ultracode 胶囊点阵与即时切档体验
