# Antigravity Codex 风格推理等级滑条 (`antigravity-codex-effort-slider`)

参照 [Microqian2th/dsh-codex-effort-slider](https://github.com/Microqian2th/dsh-codex-effort-slider) 的轨道视觉与连续物理运动学设计，结合 **Google Antigravity** 真实前端架构（React 19 + Floating UI + `ModelSelectorProvider` / `ConversationModelConfig`）深度定制的 **Codex 风格推理等级滑条**。

---

## 核心特性

1. **拖到哪一档就即时变成哪一档（滑过边界立即切档，无需等松手）**
   - 拖拽途中指针一旦越过档位边界（默认「快速动画」模式下为 **1/3 格宽迟滞棘轮**），**在 `pointermove` 阶段即刻同步调用 Antigravity 底层会话状态接口 `setModelConfigByLabelForConversation`** 切换官方真实档位。
   - 直接更新当前对话与全局默认模型配置，**不会触发官方菜单的 `setIsOpen(false)` 自动关闭**，也不会被输入框抢走焦点，可按住滑块在 `Low ↔ Medium ↔ High` 之间连续往返实时预览与切档。

2. **根据 Antigravity 原生模型菜单结构量身定制**
   - **底部常驻滑条区**：在 Antigravity 模型选择菜单（`[data-testid="model-selector-panel"]`）底部、`View Usage` 分割线上方挂载专属「推理等级」滑条行（`.ces-ag-section`），右上角醒目展示当前档位（`Low` / `Medium` / `High`）。
   - **点选模型不关菜单 + 上下联动**：在上方模型列表点击任意模型（如从 `Gemini 4 Argon` 切到 `Claude Opus 5.5`）时，自动拦截外层关闭菜单动作，立即切换选中模型并将底部滑条同步到该模型的可用推理档位。
   - **屏蔽冗余悬停子菜单**：自动隐藏模型行右侧原本的 `Low / Medium / High` 悬停级联子菜单浮层，同时保留每个模型行右侧及底部触发器胶囊上的当前档位文字并实时同步着色。
   - **单档位模型自动置灰锁定**：当选中仅支持单一固定档位的模型（如 `GPT-OSS 120B (Medium)`）时，滑条自动进入置灰锁定态（`.is-locked` / `aria-disabled="true"`）。

3. **专为 Antigravity 三档模型（`Low / Medium / High`）重映射的全行程星云与星尘**
   | 档位 | 轨道位置 | 轨道色彩与渐变 | 能量值 | 点亮星尘数 | 闪烁速率 | 档位文字颜色 |
   | :--- | :---: | :--- | :---: | :---: | :---: | :---: |
   | **Low** | `0%` | 纯蓝 `#4d93f8` | `0.0` | `0 / 22` | — | 亮蓝 `#4d93f8` |
   | **Medium** | `50%` | 蓝紫过渡 `#4d93f8 → #9333ea` | `0.5` | `11 / 22` | `1×` | 蓝紫 `#6c78f7` |
   | **High** | `100%` | 深紫星云 `#4d93f8 → #9333ea → #4c1d95` + 流光扫掠 + 外框紫光光晕 | `1.0` | `22 / 22` | `2×` | 亮紫 `#8b5cf6` |

3. **双风格自适应引擎：Codex 星空流光 (Argon / Flash) 与 Claude Code 胶囊点阵 (Opus / Sonnet 5.5)**
   - **Codex 风格**（`Gemini 4 Argon`、`Gemini 3.8 Flash`）：圆形光晕滑块，22 颗黄金分割星尘从右向左横穿已填充轨道，High 档深紫星云渐变与扫掠流光。
   - **Claude Code 风格**（`Claude Opus 5.5`、`Claude Sonnet 5.5`，参照 [youqisibun/dsh-claude-effort-slider](https://github.com/youqisibun/dsh-claude-effort-slider)）：
     - 矩形圆角 Capsule 胶囊滑块（24×30px）带中心垂直凹槽。
     - 原生 3 档（`Low / Medium / High`），切到 `High` 时立即激活专属 **6×60 Canvas 像素点阵抖动扫掠波**（1600ms 从右向左入场波前 + 待机脉冲，离开 High 档或切换模型时自动挂起 RAF 节约性能）。
     - 调色板自适应明暗模式：暗色采用紫罗兰底晕与亮紫点阵（`#c4b5fd` / `#a78bfa`）；浅色采用平滑底晕与马赛克方块。

4. **右键 / 长按设置面板**
   - 在滑条区域 **右键单击**（或触屏长按 500ms）即可呼出设置面板（`.ces-set`），所有配置实时写入 `localStorage["antigravity-codex-effort-slider:v1"]` 并跨窗口同步：
     - **动画效果**：`快速动画`（默认，拨过 1/3 即切档 · ~70ms 快速吸附）/ `简洁动画`（无过渡直接跳档）/ `完整动画`（匀变速追赶 + 星尘渐亮）
     - **已到达档位的刻度点**：`亮白显示`（默认）/ `与未到达同色` / `隐藏`
     - **诊断与重置**：支持一键复制最近 80 条交互诊断轨迹（JSON）与恢复默认设置。

---

## 快速安装与使用

### 方式一：双击一键持久安装（推荐）
直接双击项目根目录下的 **[`install.cmd`](./install.cmd)**（或在终端运行 `npm run install-patch`）：
1. **持久启动补丁**：自动备份并修补 Antigravity 桌面端 `resources/app.asar`（通过 `electron.webFrame.executeJavaScript` 将滑条注入渲染进程 Main World，并自动更新 PE Integrity SHA-256 校验值）及 Antigravity IDE（`resources/app/out/jetskiAgent/main.js`），今后每次启动 Antigravity 自动生效。
2. **运行中窗口实时热生效**：若当前 Antigravity 正在运行，安装脚本会同时通过本地 CDP 端口自动热注入到所有已打开窗口，无需重启即可立即体验。

> 如需卸载并恢复官方原版文件，双击 **[`uninstall.cmd`](./uninstall.cmd)**（或运行 `npm run uninstall-patch`）即可一键还原备份并清理运行中窗口的滑条实例。

### 方式二：仅运行期 CDP 热注入（零文件修改）
如果不希望修改磁盘上的 `app.asar`，可在 Antigravity 运行时执行：
```bash
npm run inject
```
卸载运行期注入：
```bash
npm run eject
```

---

## 开发、预览与测试

- **运行单元测试**（覆盖刻度换算、1/3 迟滞棘轮、三档能量星尘映射、连续物理收敛、React Fiber 双缓冲解析与免松手拖拽跨界切档）：
  ```bash
  npm test
  ```
- **生成离线交互式预览页**（可在任意浏览器直接打开 `preview/panel.html` 体验完整交互）：
  ```bash
  npm run preview
  ```

---

## 目录结构

```text
antigravity-codex-effort-slider/
├─ lib/
│  └─ client.js              # 核心实现（连续物理引擎 + 22 颗星尘色彩引擎 + Antigravity React Fiber 桥接 + 右键设置面板）
├─ tools/
│  ├─ patch-asar.cjs         # app.asar 二进制解包/重打包、PE Header SHA-256 完整性重算与 Antigravity IDE 补丁器
│  ├─ inject-cdp.cjs         # 基于 DevToolsActivePort 的运行期 WebSocket CDP 实时热注入与卸载工具
│  └─ cli-install.cjs        # 统一命令行安装/卸载入口
├─ preview/
│  ├─ make-preview.mjs       # 离线预览页生成脚本
│  └─ panel.html             # 生成的独立可交互预览页面
├─ test/
│  └─ client.test.mjs        # 核心算法、Fiber 双缓冲与免松手跨边界切档自动化测试套件
├─ docs/
│  └─ antigravity-codex-effort-sliderVer.1.0.0.md  # 版本变更日志
├─ install.cmd               # Windows 双击一键安装脚本
├─ uninstall.cmd             # Windows 双击一键卸载还原脚本
├─ install-asar.ps1          # PowerShell 安装引导脚本
└─ package.json
```
