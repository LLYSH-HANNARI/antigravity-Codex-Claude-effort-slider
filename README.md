# Antigravity Codex 风格推理等级滑条 (`antigravity-codex-effort-slider`)

[![Version](https://img.shields.io/badge/version-1.2.5-blue.svg)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-8%20passed-success.svg)](./test/client.test.mjs)
[![Platform](https://img.shields.io/badge/platform-Antigravity%20Desktop%20%7C%20Antigravity%20IDE-purple.svg)](https://antigravity.google/)

专为 **Google Antigravity** 量身打造的 Codex 风格物理推理等级（Reasoning Effort）交互滑条扩展。深度适配 **Antigravity 桌面客户端** 与 **Antigravity IDE (VSCode 编辑器)** 双环境，实现免松手跨边界即时切档、22 颗黄金分割星尘与深紫星云、Claude 胶囊点阵抖动引擎、View Usage 0.3 秒停留防误触与无焦点框选纯净体验。

---

## 核心特性矩阵

### 1. 拖拽即切 · 免松手实时响应
- **`pointermove` 阶段穿透即切**：拖拽滑块途中一旦跨过档位边界，**在滑动事件阶段即刻同步调用 Antigravity 底层会话状态接口 `setModelConfigByLabelForConversation`**，无需等待松开鼠标或抬起指针即可在 `Low ↔ Medium ↔ High` 之间无级切换。
- **1/3 格宽迟滞棘轮（Hysteresis Detent）**：在各档位交界处设置 1/3 格宽迟滞缓冲区，快速拨动时 ~70ms 顺滑吸附，拖拽往返时杜绝临界跳闪。
- **保持菜单常开**：完全阻断外层 Radix Popover / Base UI 触发的 `setIsOpen(false)` 自动关闭，也不被输入框抢夺焦点。

### 2. 模型面板深度联动与无缝常驻
- **底部常驻滑条区**：在 Antigravity 模型选择菜单（`[data-testid="model-selector-panel"]`）底部、`View Usage` 分割线上方无缝挂载专属「推理等级」滑条行（`.ces-ag-section`），右上角醒目同步当前档位（`Low` / `Medium` / `High`）。
- **点击模型不关弹窗 + 上下联动**：在上方模型列表点击切换任意模型（如 `Gemini 4 Argon` ↔ `Claude Sonnet 5.5`）时，自动拦截外层菜单关闭，即时更新当前选中模型并将底部滑条同步到该模型支持的可用推理档位。
- **单档位模型自动置灰锁定**：当选中仅支持单一固定档位的模型（如 `GPT-OSS 120B (Medium)`）时，滑条自动进入置灰锁定态（`.is-locked` / `aria-disabled="true"`）。

### 3. View Usage 0.3s (300ms) 停留防误触与多轮状态隔离
- **防误触展开延迟**：在扩展反向代理中，对 Antigravity IDE 的 Webview `main.js` 中 `View Usage` 组件注入 `{delay: 300}` 属性，将底层 Base UI / Floating UI 的子菜单停留悬停阈值（`restMs` / `delay.open`）从默认 100ms 调整为 300ms。
- **全链路多维离开状态监听**：依据 W3C DOM Events 规范，在 View Usage 目标元素上直接注册目标级 `pointerleave` 监听，并在面板捕获层监听冒泡的 `pointerout`（`!trigger.contains(ev.relatedTarget)`）与 `pointerover`（移向非 View Usage 元素时即时重置），彻底解决由于 `pointerleave` 不冒泡导致的状态驻留缺陷。
- **移出再次移入严格重置**：引入 `isDispatchingSynthetic` 瞬态锁，仅在 300ms 定时器回调执行派发合成事件的毫秒级同步窗口内放行；派发完成后立即恢复未授权状态，确保后续每一次真正的鼠标移入均严格重新计算 0.3 秒停留延迟，杜绝秒开。

### 4. 彻底消除 Radix / Base UI 焦点框选
- **阻断自动聚焦**：将推理条 `rootEl` 的 `tabindex` 设为 `-1`，阻断 Radix Popover / Base UI `FocusScope` 在弹窗打开时自动寻找 Tabbable 元素聚焦到滑条的行为。
- **纯净无框选样式**：为 `.ces-root`、`.ces-ag-section` 及其全部子元素在 `:focus`、`:focus-visible`、`:focus-within` 伪类下强制注入 `outline: none !important; outline-width: 0 !important;` 以及 `user-select: none !important;`，彻底消除任何矩形外框高亮与文本选中，仅保留 High 档尊贵紫色微光。
- **卸载主动脱焦**：在面板卸载（`unmountActiveSection`）时主动清理活动聚焦元素（`blur()`），确保下次开窗时状态完全干净。

### 5. 双风格物理自适应渲染引擎
- **Codex 宇宙星空风格**（`Gemini 4 Argon`、`Gemini 3.8 Flash`）：
  - 圆纽光晕滑块，22 颗黄金分割星尘从右向左横穿已填充轨道。
  - High 档激活深紫星云渐变与扫掠流光，外框呈现紫色霓虹微光。
- **Claude Code 风格**（`Claude Opus 5.5`、`Claude Sonnet 5.5`）：
  - 24×30px Capsule 胶囊滑块带中心垂直凹槽。
  - 原生 3 档（`Low / Medium / High`），切到 `High` 档时立即激活专属 **6×60 Canvas 像素点阵抖动扫掠波**（1600ms 从右向左入场波前 + 待机脉冲，离开 High 档或切换模型时自动挂起 RAF 节约性能）。
  - 调色板自适应明暗模式：暗色采用紫罗兰底晕与亮紫点阵（`#c4b5fd` / `#a78bfa`）；浅色采用平滑底晕与马赛克方块。
- **滑至最右面板抖动反馈**：滑条拖动至最右侧 High 档边界时，模型面板产生细腻的物理轻微抖动反馈。
- **High 档微光光斑淡出**：滑动至最高档后，档位文字闪烁出一个柔和的半透明紫色微光光斑并平滑淡出（约 0.4 秒）。
- **全模型立体文字翻转动效**：Argon / Flash / Claude 在档位切换时均具备统一的向上翻转立体文字动效，视觉体验丝滑一致。

### 6. 右键 / 长按独立配置面板
- 在滑条区域 **右键单击**（或触屏长按 500ms）即可呼出设置面板（`.ces-set`），所有配置实时写入 `localStorage["antigravity-codex-effort-slider:v1"]` 并跨窗口同步：
  - **动画效果**：`快速动画`（默认，拨过 1/3 即切档 · ~70ms 快速吸附）/ `简洁动画`（无过渡直接跳档）/ `完整动画`（匀变速追赶 + 星尘渐亮）。
  - **已到达档位的刻度点**：`亮白显示`（默认）/ `与未到达同色` / `隐藏`。
  - **诊断与重置**：支持一键复制最近 80 条交互诊断轨迹（JSON）与恢复默认设置。

---

## 档位与视觉映射速查

| 档位 | 轨道位置 | 能量值 | Codex 视觉特征 (Argon / Flash) | Claude 视觉特征 (Opus / Sonnet) | 档位色彩 |
| :--- | :---: | :---: | :--- | :--- | :---: |
| **Low** | `0%` | `0.0` | 纯蓝 `#4d93f8`，0 颗星尘点亮 | Capsule 胶囊左位，无点阵 | `#4d93f8` (纯蓝) |
| **Medium** | `50%` | `0.5` | 蓝紫过渡 `#4d93f8 → #9333ea`，恰好 11 颗星尘点亮 | Capsule 胶囊中位，无点阵 | `#6c78f7` (蓝紫) |
| **High** | `100%` | `1.0` | 深紫星云 `#4d93f8 → #9333ea → #4c1d95` + 22 颗星尘 + 流光扫掠 + 紫色微光 | Capsule 胶囊右位 + 6×60 Canvas 像素点阵抖动波 (1600ms 波前) | `#8b5cf6` (亮紫) |

---

## 适配环境与安装使用

本项目针对两种不同的 Antigravity 运行载体提供完善的原生支持：

```
                    ┌────────────────────────────────────────────────────────┐
                    │      Antigravity Codex 推理等级滑条 (Ver.1.2.5)         │
                    └────────────────────────────────────────────────────────┘
                                      │                      │
                   ┌──────────────────┴──┐                ┌──┴──────────────────┐
                   ▼                     ▼                ▼                     ▼
          【Antigravity IDE 编辑器】              【Antigravity 桌面客户端】
          (VSCode 分支环境，如 D:\...)            (Electron 架构环境，如 AppData)
                   │                                         │
                   ▼                                         ▼
         tools/patch-asar.cjs                      tools/patch-asar.cjs / CDP
         注入 agy/vscode/extension.js               修补 resources/app.asar (SHA-256)
         建立 Webview 反向代理注入                   或通过 inject-cdp.cjs 实时热注入
```

### 1. Antigravity IDE (VSCode 编辑器) 适配安装
在 Antigravity IDE 环境下，由于 Chat 界面运行于沙箱 Webview（由 `agy.exe` 动态分发），无需篡改核心 workbench 文件，直接运行补丁器：
```bash
node tools/patch-asar.cjs
```
- 脚本会自动检测 `resources/app/extensions/agy/vscode/extension.js` 并注入内置反向代理补丁；
- 启动 IDE 后，代理服务器会自动将客户端代码注入到 Chat Webview，并同步生效 View Usage 0.3s 停留防误触机制；
- 脚本同时自动清理历史遗留注入文件并刷新 V8 字节码缓存（CachedData），确保修改即刻生效。

### 2. Antigravity 桌面应用安装
#### 方式 A：双击一键持久安装（推荐）
直接双击项目根目录下的 **[`install.cmd`](./install.cmd)**（或执行 `npm run install-patch`）：
1. **持久启动补丁**：自动备份并修补 `resources/app.asar`（通过 `electron.webFrame.executeJavaScript` 注入渲染进程，并自动更新 PE Integrity SHA-256 校验值杜绝“安装似乎损坏”提示），今后每次启动 Antigravity 自动生效。
2. **运行中窗口实时热生效**：若当前客户端正在运行，安装脚本会同时通过本地 CDP 端口自动热注入到所有已打开窗口，无需重启即可立即体验。

> 如需卸载并还原官方纯净文件，双击 **[`uninstall.cmd`](./uninstall.cmd)**（或执行 `npm run uninstall-patch`）即可一键还原备份并清理所有热注入实例。

#### 方式 B：仅运行期 CDP 热注入（零文件修改）
如果不希望修改磁盘上的任何 `.asar` 或 `.js` 文件，可在 Antigravity 运行时执行：
```bash
npm run inject
```
卸载运行期注入：
```bash
npm run eject
```

---

## 本地开发、离线预览与单元测试

### 1. 运行自动化测试套件
项目配备了完整的自动化单元测试，全面覆盖算法、物理引擎、双缓冲解析与交互防御：
```bash
npm test
```
**8 大测试套件覆盖范围**：
- `✓ 1.` 刻度换算与 1/3 跨边界迟滞棘轮 (`pctFromIndex` / `indexFromPct` / `detentTargetIndex`)
- `✓ 2.` Antigravity 三档模型 (`Low / Medium / High`) 能量、色彩与 22 颗星尘映射
- `✓ 3.` 圆纽几何内缩换算与连续物理引擎无过冲收敛 (`knobOffsetOf` / `motionStep`)
- `✓ 4.` Antigravity 模型标签解析与 React Fiber 上下文提取 (`parseModelLabel` / `readAntigravityFiberContext`)
- `✓ 5.` 拖动滑条跨边界即时切档（`pointerdown` + `pointermove` 无需等待 `pointerup` 松手）
- `✓ 6.` Claude 模型识别、原生三档映射、Ultracode 像素点阵抖动引擎与跨边界即切
- `✓ 7.` 推理条无焦点框选（`outline: none !important` / `tabindex='-1'`）与 View Usage 0.3s 停留展开延迟
- `✓ 8.` View Usage 0.3s (300ms) 停留展开防误触及移出后再次移入重新计时验证

### 2. 生成并查看独立离线预览页面
无需打开 Antigravity，即可在任意现代浏览器中体验与真实客户端完全一致的交互与特效：
```bash
npm run preview
```
执行后在浏览器中直接打开 **`preview/panel.html`** 即可。

---

## 目录结构说明

```text
antigravity-codex-effort-slider/
├─ lib/
│  └─ client.js              # 核心实现（物理引擎 + 22 颗星尘 + Claude 点阵波 + Fiber 桥接 + 0.3s 防误触）
├─ tools/
│  ├─ patch-asar.cjs         # app.asar 解包/重打包、PE SHA-256 完整性重算与 Antigravity IDE 扩展代理注入器
│  ├─ inject-cdp.cjs         # 基于 DevToolsActivePort 的运行期 WebSocket CDP 实时热注入与卸载工具
│  └─ cli-install.cjs        # 统一命令行安装/卸载入口
├─ preview/
│  ├─ make-preview.mjs       # 离线预览页生成脚本
│  └─ panel.html             # 生成的独立可交互预览页面
├─ test/
│  └─ client.test.mjs        # 8 套核心算法、Fiber 双缓冲、防误触与免松手切档自动化测试套件
├─ .gitignore                # Git 忽略配置（忽略 docs/、docx/ 及系统临时文件）
├─ install.cmd               # Windows 双击一键安装脚本
├─ uninstall.cmd             # Windows 双击一键卸载还原脚本
├─ install-asar.ps1          # PowerShell 安装引导脚本
├─ package.json              # 项目配置与 NPM 指令入口
└─ README.md                 # 项目完整使用与架构文档
```

---

## 开源许可

本项目基于 [MIT License](./LICENSE) 开源。
