import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const slider = require("../lib/client.js");

let passedCount = 0;
async function test(name, fn) {
  try {
    await fn();
    passedCount += 1;
    console.log("  ✓", name);
  } catch (err) {
    console.error("  ✗", name);
    throw err;
  }
}

console.log("Running antigravity-codex-effort-slider test suite...");

test("1. 刻度换算与 1/3 跨边界迟滞棘轮 (pctFromIndex / indexFromPct / detentTargetIndex)", () => {
  assert.equal(slider.pctFromIndex(0, 3), 0);
  assert.equal(slider.pctFromIndex(1, 3), 0.5);
  assert.equal(slider.pctFromIndex(2, 3), 1);

  assert.equal(slider.indexFromPct(0, 3), 0);
  assert.equal(slider.indexFromPct(0.49, 3), 1);
  assert.equal(slider.indexFromPct(0.9, 3), 2);

  // Antigravity 3 档模型 (step = 0.5)，从 0 (Low) 往右拖过 1/3 格宽 (0.5 / 3 = 0.1667) 即刻切到 1 (Medium)
  assert.equal(slider.detentTargetIndex(0, 0.15, 3), 0);
  assert.equal(slider.detentTargetIndex(0, 0.17, 3), 1);
  // 从 1 (Medium) 往回退，在 [0.17, 0.34] 迟滞带内保持 1 不抖动，退过 0.5 - 0.1667 = 0.3333 才回到 0
  assert.equal(slider.detentTargetIndex(1, 0.35, 3), 1);
  assert.equal(slider.detentTargetIndex(1, 0.32, 3), 0);
});

test("2. Antigravity 三档模型 (Low / Medium / High) 能量、色彩与 22 颗星尘映射", () => {
  const stops3 = slider.energyStopsFor(["low", "medium", "high"]);
  assert.equal(stops3.start, 0);
  assert.equal(stops3.end, 0.5);
  assert.equal(stops3.hasOffFirst, false);

  // Low (0%): 纯蓝 #4d93f8，0 能量，0 颗星尘点亮，蓝色文字 #4d93f8
  assert.equal(slider.energyForPct(0, stops3.start), 0);
  assert.equal(slider.fillColorFor(0, stops3.start, stops3.end), "#4d93f8");
  assert.equal(slider.fillBackgroundFor(0, stops3.start, stops3.end), "#4d93f8");
  assert.equal(slider.valueColorFor("Low", 0, 3, false, false), "#4d93f8");
  const litAtLow = slider.PARTICLES.filter((p) => slider.starBrightnessFor(p, 0) > 0).length;
  assert.equal(litAtLow, 0);

  // Medium (50%): 蓝紫过渡 #9333ea，0.5 能量，恰好 11 颗星尘点亮
  assert.equal(slider.energyForPct(0.5, stops3.start), 0.5);
  assert.equal(slider.fillColorFor(0.5, stops3.start, stops3.end), "#9333ea");
  assert.equal(
    slider.fillBackgroundFor(0.5, stops3.start, stops3.end),
    "linear-gradient(90deg, #4d93f8 0%, #9333ea 100%)"
  );
  const litAtMedium = slider.PARTICLES.filter((p) => slider.starBrightnessFor(p, 0.5) > 0).length;
  assert.equal(litAtMedium, 11);

  // High (100%): 深紫星云 #4c1d95，1.0 能量，22 颗星尘全亮，亮紫文字 #8b5cf6
  assert.equal(slider.energyForPct(1, stops3.start), 1);
  assert.equal(slider.fillColorFor(1, stops3.start, stops3.end), "#4c1d95");
  assert.equal(
    slider.fillBackgroundFor(1, stops3.start, stops3.end),
    "linear-gradient(90deg, #4d93f8 0%, #9333ea 50%, #4c1d95 100%)"
  );
  assert.equal(slider.valueColorFor("High", 2, 3, true, false), "#8b5cf6");
  const litAtHigh = slider.PARTICLES.filter((p) => slider.starBrightnessFor(p, 1.0) > 0).length;
  assert.equal(litAtHigh, 22);

  // 验证右向左横穿星空速率与相位：Medium (1x ≈ 3.0s) 比 High (2x ≈ 1.5s) 慢一倍，且负相位落在 (-duration, 0]
  assert.equal(slider.speedFor(0.5, stops3.start), 1);
  assert.equal(slider.speedFor(1.0, stops3.start), 2);
  assert.equal(slider.starLayerOpacityFor(0.5), 0.8);
  assert.equal(slider.starLayerOpacityFor(1.0), 1);
  const durMed0 = slider.starDurationFor(0, slider.speedFor(0.5, stops3.start));
  const durHigh0 = slider.starDurationFor(0, slider.speedFor(1.0, stops3.start));
  assert.ok(Math.abs(durMed0 / durHigh0 - 2) < 1e-6);
  const delay0 = slider.starDelayFor(0, durHigh0);
  assert.ok(delay0 <= 0 && delay0 > -durHigh0);

  // 兼容首档为 Off 的四档模型 (Off / Low / High / Max)
  const stops4 = slider.energyStopsFor(["off", "low", "high", "max"]);
  assert.ok(Math.abs(stops4.start - 1 / 3) < 1e-6);
  assert.ok(Math.abs(stops4.end - 2 / 3) < 1e-6);
  assert.equal(stops4.hasOffFirst, true);
  assert.equal(slider.valueColorFor("Off", 0, 4, false, true), "");
});

test("3. 圆钮几何内缩换算与连续物理引擎无过冲收敛 (knobOffsetOf / motionStep)", () => {
  assert.equal(slider.KNOB_SIZE, 28);
  assert.equal(slider.TRACK_HEIGHT, 28);
  assert.equal(slider.knobOffsetOf(0, 14), "calc(14px + (100% - 28px) * 0)");
  assert.equal(slider.knobOffsetOf(1, 14), "calc(14px + (100% - 28px) * 1)");

  const state = { x: 0, v: 0, a: 0, target: 1 };
  for (let i = 0; i < 60; i += 1) {
    slider.motionStep(state, 1 / 120, slider.MOTION_FAST);
    assert.ok(state.x >= 0 && state.x <= 1, "圆钮位置不得越界过冲");
  }
  assert.ok(slider.motionSettled(state, slider.MOTION_FAST));
  assert.equal(state.x, 1);
});

test("4. Antigravity 模型标签解析与 React Fiber 上下文提取 (parseModelLabel / readAntigravityFiberContext)", () => {
  const parsed = slider.parseModelLabel("Gemini 4 Argon (High)");
  assert.deepEqual(parsed, {
    base: "Gemini 4 Argon",
    effort: "high",
    effortLabel: "High"
  });

  const modelOptions = [
    { label: "Gemini 4 Argon (Low)", value: 1419 },
    { label: "Gemini 4 Argon (Medium)", value: 1418 },
    { label: "Gemini 4 Argon (High)", value: 1417 },
    { label: "Claude Opus 5.5 (Low)", value: 1400 },
    { label: "Claude Opus 5.5 (Medium)", value: 1401 },
    { label: "Claude Opus 5.5 (High)", value: 1402 },
    { label: "GPT-OSS 120B (Medium)", value: 342 }
  ];

  const committedCalls = [];
  const globalCtx = {
    visibleModelConfigs: modelOptions,
    currentModelConfig: modelOptions[2],
    setModelConfigByLabelForConversation(label, convId, persist) {
      committedCalls.push({ label, convId, persist });
    }
  };
  const rootFiber = { memoizedProps: { value: globalCtx }, return: null };
  let deepParent = rootFiber;
  for (let d = 0; d < 175; d += 1) {
    deepParent = { memoizedProps: {}, return: deepParent };
  }
  const convFiber = { memoizedProps: { conversationId: "conv-123", placement: "top-start" }, return: deepParent };
  const popoverFiber = {
    memoizedProps: {
      open: true,
      setIsOpen() {},
      setSelectedModel() {},
      modelOptions,
      selectedModel: modelOptions[2]
    },
    return: convFiber
  };

  const dummyButton = { __reactFiber$test: popoverFiber };
  const ctx = slider.readAntigravityFiberContext(dummyButton);
  assert.ok(ctx);
  assert.equal(ctx.conversationId, "conv-123");
  assert.equal(ctx.effortIndex.get("Gemini 4 Argon").size, 3);
  assert.equal(ctx.effortIndex.get("GPT-OSS 120B").size, 1);

  const profMulti = slider.resolveModelEffortProfile(ctx, ctx.selectedModel, new Map());
  assert.equal(profMulti.baseName, "Gemini 4 Argon");
  assert.equal(profMulti.locked, false);
  assert.equal(profMulti.levels.length, 3);
  assert.equal(profMulti.currentIndex, 2);
  assert.equal(profMulti.currentLabel, "High");

  const profSingle = slider.resolveModelEffortProfile(ctx, modelOptions[6], new Map());
  assert.equal(profSingle.locked, true);
  assert.equal(profSingle.levels.length, 1);

  slider.commitAntigravityModelOption(ctx, modelOptions[0]);
  assert.equal(committedCalls.length, 1);
  assert.deepEqual(committedCalls[0], {
    label: "Gemini 4 Argon (Low)",
    convId: "conv-123",
    persist: true
  });

  // 验证 React Fiber 双缓冲切换：当 HostRoot.stateNode.current 指向 alternate 树时自动读取最新树
  const stalePopoverFiber = {
    memoizedProps: {
      open: true,
      setIsOpen() {},
      setSelectedModel() {},
      modelOptions,
      selectedModel: modelOptions[2] // 旧树仍为 High
    }
  };
  const livePopoverFiber = {
    memoizedProps: {
      open: true,
      setIsOpen() {},
      setSelectedModel() {},
      modelOptions,
      selectedModel: modelOptions[0] // 新树已切为 Low
    }
  };
  const staleRoot = { stateNode: null, return: null };
  const liveRoot = { stateNode: null, return: null };
  const fiberRootNode = { current: liveRoot };
  staleRoot.stateNode = fiberRootNode;
  liveRoot.stateNode = fiberRootNode;
  stalePopoverFiber.return = staleRoot;
  livePopoverFiber.return = liveRoot;
  stalePopoverFiber.alternate = livePopoverFiber;
  livePopoverFiber.alternate = stalePopoverFiber;

  const doubleBufferedEl = { __reactFiber$test: stalePopoverFiber };
  const liveCtx = slider.readAntigravityFiberContext(doubleBufferedEl);
  assert.equal(liveCtx.selectedModel.label, "Gemini 4 Argon (Low)");

  // 验证 Antigravity IDE (agy.exe / VSCode) 双层 Popover 嵌套：
  // 内层子组件 XJc 的 setSelectedModel 被包装了 setIsOpen(false)；
  // 外层父组件 hKc 才是未被包装的纯净 setter。
  let setIsOpenCalls = [];
  let unwrappedCalls = [];
  const unwrappedSetter = (opt) => {
    unwrappedCalls.push(opt);
  };
  const setIsOpenFn = (open) => {
    setIsOpenCalls.push(open);
  };
  const wrappedCloser = (opt) => {
    unwrappedSetter(opt);
    setIsOpenFn(false);
  };

  const ideConvFiber = {
    memoizedProps: { conversationId: "ide-conv", placement: "top-start" },
    return: null
  };
  const outerHKcFiber = {
    memoizedProps: {
      open: true,
      setIsOpen: setIsOpenFn,
      setSelectedModel: unwrappedSetter,
      modelOptions,
      selectedModel: modelOptions[1]
    },
    return: ideConvFiber
  };
  const innerXJcFiber = {
    memoizedProps: {
      open: true,
      setIsOpen: setIsOpenFn,
      setSelectedModel: wrappedCloser,
      modelOptions,
      selectedModel: modelOptions[1]
    },
    return: outerHKcFiber
  };
  const panelChildFiber = {
    memoizedProps: {},
    return: innerXJcFiber
  };

  const idePanelEl = { __reactFiber$test: panelChildFiber };
  const ideCtx = slider.readAntigravityFiberContext(idePanelEl);
  assert.ok(ideCtx);
  assert.strictEqual(ideCtx.unwrappedSetSelectedModel, unwrappedSetter, "应当匹配外层未被包装的 setSelectedModel，而非内层的 wrappedCloser");

  slider.commitAntigravityModelOption(ideCtx, modelOptions[2]);
  assert.equal(unwrappedCalls.length, 1);
  assert.equal(unwrappedCalls[0].label, "Gemini 4 Argon (High)");
  assert.ok(!setIsOpenCalls.includes(false), "commit 不应调用 setIsOpen(false)，保证菜单常开");

  // 验证 Lexical focus 抢夺屏蔽保护
  let lexicalFocusCalled = false;
  const mockEditorProto = {
    focus() {
      lexicalFocusCalled = true;
    }
  };
  const mockEditorInst = Object.create(mockEditorProto);
  globalThis.document = {
    querySelector(sel) {
      if (sel === '[contenteditable="true"]') {
        return { __lexicalEditor: mockEditorInst };
      }
      return null;
    }
  };
  const unwrappedWithEditorFocus = (opt) => {
    unwrappedCalls.push(opt);
    mockEditorInst.focus();
  };
  const ideWithEditorCtx = {
    ...ideCtx,
    unwrappedSetSelectedModel: unwrappedWithEditorFocus
  };
  slider.commitAntigravityModelOption(ideWithEditorCtx, modelOptions[0]);
  assert.strictEqual(lexicalFocusCalled, false, "commit期间应暂时屏蔽 Lexical editor.focus()，防止抢夺焦点导致失焦关闭");
  delete globalThis.document;
});

test("5. 拖动滑条跨边界即时切档（pointerdown + pointermove 无需等待 pointerup 松手）", () => {
  function makeMockDoc() {
    function makeEl(tag) {
      const listeners = new Map();
      const styleProps = new Map();
      const attrs = new Map();
      const classes = new Set();
      const el = {
        tagName: String(tag || "div").toUpperCase(),
        className: "",
        children: [],
        parentElement: null,
        ownerDocument: null,
        style: {
          setProperty(k, v) {
            styleProps.set(k, String(v));
          },
          getPropertyValue(k) {
            return styleProps.get(k) || "";
          }
        },
        classList: {
          add(c) {
            classes.add(c);
          },
          remove(c) {
            classes.delete(c);
          },
          contains(c) {
            return classes.has(c);
          }
        },
        setAttribute(k, v) {
          attrs.set(k, String(v));
        },
        getAttribute(k) {
          return attrs.has(k) ? attrs.get(k) : null;
        },
        appendChild(child) {
          child.parentElement = el;
          el.children.push(child);
          return child;
        },
        addEventListener(type, fn) {
          if (!listeners.has(type)) listeners.set(type, []);
          listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
          const arr = listeners.get(type) || [];
          const idx = arr.indexOf(fn);
          if (idx >= 0) arr.splice(idx, 1);
        },
        dispatch(type, eventInit) {
          const arr = listeners.get(type) || [];
          for (const fn of arr) {
            fn({
              type,
              button: 0,
              buttons: 1,
              pointerId: 1,
              stopPropagation() {},
              preventDefault() {},
              ...eventInit
            });
          }
        },
        getBoundingClientRect() {
          // 轨道总宽 228px，扣除两端 KNOB_RADIUS=14px 后有效行程恰好 200px (left: 0 -> usable: 14..214)
          return { left: 0, top: 0, width: 228, height: 28 };
        }
      };
      Object.defineProperty(el, "innerHTML", {
        get() {
          return "";
        },
        set() {
          el.children = [];
        }
      });
      return el;
    }

    const doc = {
      head: makeEl("head"),
      body: makeEl("body"),
      createElement(tag) {
        const el = makeEl(tag);
        el.ownerDocument = doc;
        return el;
      },
      getElementById() {
        return null;
      }
    };
    return doc;
  }

  const doc = makeMockDoc();
  const container = doc.createElement("div");
  const mockWin = {
    localStorage: {
      getItem() {
        return JSON.stringify({ v: 1, motion: "fast", ticks: "highlight" });
      },
      setItem() {}
    },
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {}
  };
  doc.defaultView = mockWin;

  let currentEffort = "low";
  const dragCommits = [];
  const seat = {
    effortLevels: ["low", "medium", "high"],
    get currentEffort() {
      return currentEffort;
    },
    selectEffort(nextEffort, nextIdx) {
      currentEffort = nextEffort;
      dragCommits.push({ effort: nextEffort, index: nextIdx });
    }
  };

  const mockPanel = doc.createElement("div");
  mockPanel.setAttribute("data-testid", "model-selector-panel");
  const mockValueEl = doc.createElement("span");
  mockValueEl.className = "ces-ag-effort-value";

  const mounted = slider.mountCodexEffortSlider({
    container,
    panel: mockPanel,
    valueElement: mockValueEl,
    seat,
    document: doc,
    window: mockWin
  });

  const rootEl = container.children[0];
  const trackEl = rootEl.children[0];

  // 1. 在 Low (0%, clientX = 14) 处按下指针：尚未跨边界，不重复触发写入，不抖动
  trackEl.dispatch("pointerdown", { clientX: 14 });
  assert.equal(dragCommits.length, 0);
  assert.equal(currentEffort, "low");
  assert.equal(mockPanel.classList.contains("ces-panel-shaking"), false);
  assert.equal(mockValueEl.classList.contains("is-glowing"), false);

  // 2. 按住不松手（无 pointerup），向右拖动到 20% (clientX = 14 + 200 * 0.20 = 54)
  //    已越过 Low -> Medium 的 1/3 边界 (16.7%)，应当立即触发 selectEffort("medium", 1)！
  //    同时视觉位置必须 100% 顺滑跟手在 20% (0.2)，不得生硬卡死在 0% 或跳跃到 50%
  trackEl.dispatch("pointermove", { clientX: 54 });
  assert.equal(dragCommits.length, 1);
  assert.deepEqual(dragCommits[0], { effort: "medium", index: 1 });
  assert.equal(currentEffort, "medium");
  assert.equal(trackEl.style.getPropertyValue("--ces-fill"), slider.knobOffsetOf(0.2, 14));
  assert.equal(mockPanel.classList.contains("ces-panel-shaking"), false);
  assert.equal(mockValueEl.classList.contains("is-glowing"), false);
  assert.equal(mockValueEl.classList.contains("ces-text-rise"), true, "Codex/Argon 模型切换档位应触发文字向上翻转动效");

  // 3. 继续按住不松手，向右拖动到 70% (clientX = 14 + 200 * 0.70 = 154)
  //    已越过 Medium -> High 的 1/3 边界 (66.7%)，应当立即触发 selectEffort("high", 2)！
  //    视觉位置同样 1:1 跟手在 70% (0.7)
  //    ★ 触发最高档物理反馈：面板微震颤 (ces-panel-shaking) + High 模糊光斑爆散 (is-glowing)
  trackEl.dispatch("pointermove", { clientX: 154 });
  assert.equal(dragCommits.length, 2);
  assert.deepEqual(dragCommits[1], { effort: "high", index: 2 });
  assert.equal(currentEffort, "high");
  assert.equal(trackEl.style.getPropertyValue("--ces-fill"), slider.knobOffsetOf(0.7, 14));
  assert.equal(mockPanel.classList.contains("ces-panel-shaking"), true, "滑动至最高档面板应触发轻微震颤");
  assert.equal(mockValueEl.classList.contains("is-glowing"), true, "滑动至最高档 High 应闪出模糊光斑");
  assert.equal(mockValueEl.classList.contains("ces-text-rise"), true, "滑动至最高档 High 应触发文字向上翻转");
  assert.equal(mockValueEl.style.getPropertyValue("--ces-glow-color"), "rgba(168, 85, 247, 0.9)");

  // 3b. 在 High 区间继续向右微移到 85% (clientX = 14 + 200 * 0.85 = 184)：
  //     不得重复触发抖动或重复 commit
  trackEl.dispatch("pointermove", { clientX: 184 });
  assert.equal(dragCommits.length, 2, "在 High 区间内微移不重复触发 commit");

  // 4. 依然按住不松手，向左回拖到 25% (clientX = 14 + 200 * 0.25 = 64)
  //    直接退回 Low 区间，立即触发 selectEffort("low", 0) 并清理 is-glowing 与 ces-panel-shaking！
  trackEl.dispatch("pointermove", { clientX: 64 });
  assert.equal(dragCommits.length, 3);
  assert.deepEqual(dragCommits[2], { effort: "low", index: 0 });
  assert.equal(currentEffort, "low");
  assert.equal(trackEl.style.getPropertyValue("--ces-fill"), slider.knobOffsetOf(0.25, 14));
  assert.equal(mockValueEl.classList.contains("is-glowing"), false, "回退到低档位应清除光斑效果");
  assert.equal(mockPanel.classList.contains("ces-panel-shaking"), false, "回退到低档位应清除面板震颤状态");

  // 5. 最后在当前位置松手 pointerup，因为已经在拖动途中同步切到了 low，不会产生多余的重复提交
  trackEl.dispatch("pointerup", { clientX: 64 });
  assert.equal(dragCommits.length, 3);

  mounted.unmount();
});

test("6. Claude 模型识别、原生三档映射、Ultracode 像素点阵抖动引擎与跨边界即切", () => {
  // 1. 模型检测
  assert.equal(slider.isClaudeModel("Claude Opus 5.5"), true);
  assert.equal(slider.isClaudeModel("Claude Sonnet 5.5"), true);
  assert.equal(slider.isClaudeModel("claude 3.7 sonnet"), true);
  assert.equal(slider.isClaudeModel("Gemini 4 Argon"), false);
  assert.equal(slider.isClaudeModel("Gemini 3.8 Flash"), false);
  assert.equal(slider.isClaudeModel("GPT-OSS 120B"), false);

  // 2. Claude 色彩体系与原生 3 档（Low / Medium / High）
  assert.equal(slider.valueColorFor("High", 2, 3, true, false, true), "#c4b5fd");
  assert.equal(slider.valueColorFor("Medium", 1, 3, false, false, true), "#a78bfa");
  assert.equal(slider.valueColorFor("Low", 0, 3, false, false, true), "#94a3b8");
  // 保持 Argon / Flash 的 Codex 色彩不变
  assert.equal(slider.valueColorFor("High", 2, 3, true, false, false), "#8b5cf6");
  assert.equal(slider.valueColorFor("Low", 0, 3, false, false, false), "#4d93f8");

  // 3. Ultracode 6×60 点阵与噪声数学管道
  assert.ok(slider.hash01(10, 20, 30) >= 0 && slider.hash01(10, 20, 30) < 1);
  const a1 = slider.ditherAlphaAt(50, 280, 10, 2);
  assert.ok(a1 >= 0 && a1 <= 1);
  const n1 = slider.valueNoise(5, 3, 0.4, 1.5, 5);
  assert.ok(n1 >= 0 && n1 <= 1);

  // 4. Canvas paintDither 绘制流水线（深色模式 + 浅色模式）
  const canvasOps = [];
  const mockCtx = {
    globalAlpha: 1,
    fillStyle: "",
    clearRect(x, y, w, h) { canvasOps.push({ op: "clearRect", w, h }); },
    fillRect(x, y, w, h) { canvasOps.push({ op: "fillRect", w, h }); },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() { canvasOps.push({ op: "fill" }); }
  };

  // 深色：右至左 sweep 推进前沿 (progress = 0.5)
  slider.paintDither(mockCtx, 280, 28, true, 0.5, 0.8, 1);
  assert.ok(canvasOps.length > 20, "深色模式应产生底晕及点阵 fill 绘制指令");

  // 浅色：完全铺满待机脉冲 (progress = 1.0)
  canvasOps.length = 0;
  slider.paintDither(mockCtx, 280, 28, false, 1.0, 1.6, 1);
  assert.ok(canvasOps.length > 20, "浅色模式应产生马赛克网格及高光核心绘制指令");
  const fullFills = canvasOps.filter((o) => o.op === "fill").length;

  // 4b. 中档少量特效：强度 0.35 时点阵数明显少于最高档，但不为 0；强度 0 时只清屏不绘制
  canvasOps.length = 0;
  slider.paintDither(mockCtx, 280, 28, false, 1.0, 1.6, 0.35);
  const midFills = canvasOps.filter((o) => o.op === "fill").length;
  assert.ok(midFills > 0 && midFills < fullFills * 0.75, `中档点阵应为少量 (${midFills} vs ${fullFills})`);
  canvasOps.length = 0;
  slider.paintDither(mockCtx, 280, 28, true, 1.0, 1.6, 0);
  assert.deepEqual(canvasOps.map((o) => o.op), ["clearRect"]);

  // 4b-2. 中档点阵必须“流动”：相邻两帧（中档半速 → 相位推进 0.05s）每个点的高光 alpha 平均变化量
  //       应接近最高档（流光亮度不随强度衰减），防止中档退化为静止点阵
  function flowRatio(strength, dt) {
    const pixels = new Set();
    function snapshot(time) {
      const map = new Map();
      let alpha = 1, style = "", key = "";
      const ctx = {
        set globalAlpha(v) { alpha = v; }, get globalAlpha() { return alpha; },
        set fillStyle(v) { style = v; }, get fillStyle() { return style; },
        clearRect() {}, fillRect() {}, createLinearGradient() { return { addColorStop() {} }; },
        beginPath() {}, moveTo(x, y) { key = Math.round(x) + "," + Math.round(y); },
        lineTo() {}, quadraticCurveTo() {}, closePath() {},
        fill() {
          if (style === "rgb(220, 204, 255)") map.set(key, (map.get(key) || 0) + alpha);
          else pixels.add(key);
        }
      };
      slider.paintDither(ctx, 220, 28, true, 1, time, strength);
      return map;
    }
    const a = snapshot(3), b = snapshot(3 + dt);
    let d = 0;
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      d += Math.abs((a.get(k) || 0) - (b.get(k) || 0));
    }
    // 按实际绘制的点阵格数归一化 = 「每个点」的平均流光变化量（与点数多少无关）
    return d / Math.max(1, pixels.size);
  }
  const highFlow = flowRatio(1, 0.1);
  const midFlow = flowRatio(slider.claudeIntensityFor(0.5, 0), 0.1 * slider.claudeSpeedFor(0.5, 0));
  assert.ok(midFlow > highFlow * 0.5, `中档流光变化率过低 (${midFlow.toFixed(3)} vs High ${highFlow.toFixed(3)})`);

  // 4c. 强度 / 速度随位置连续变化：Low=0、Medium≈0.35 半速、High=1 全速，且单调递增无跳变
  assert.equal(slider.claudeIntensityFor(0, 0), 0);
  assert.ok(Math.abs(slider.claudeIntensityFor(0.5, 0) - 0.354) < 0.01);
  assert.equal(slider.claudeIntensityFor(1, 0), 1);
  assert.equal(slider.claudeSpeedFor(0.5, 0), 0.5);
  assert.equal(slider.claudeSpeedFor(1, 0), 1);
  let prevI = 0;
  for (let i = 1; i <= 100; i += 1) {
    const cur = slider.claudeIntensityFor(i / 100, 0);
    assert.ok(cur >= prevI && cur - prevI < 0.03, "强度曲线必须连续单调");
    prevI = cur;
  }

  // 5. DOM 挂载与跨边界即时切档测试（Claude 模式）
  function makeMockDoc() {
    function makeEl(tag) {
      const listeners = new Map();
      const styleProps = new Map();
      const attrs = new Map();
      const classes = new Set();
      const el = {
        tagName: String(tag || "div").toUpperCase(),
        className: "",
        children: [],
        parentElement: null,
        ownerDocument: null,
        width: 280,
        height: 28,
        getContext() { return mockCtx; },
        style: {
          setProperty(k, v) { styleProps.set(k, String(v)); },
          getPropertyValue(k) { return styleProps.get(k) || ""; },
          display: ""
        },
        classList: {
          add(c) { classes.add(c); },
          remove(c) { classes.delete(c); },
          contains(c) { return classes.has(c); }
        },
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
        appendChild(child) {
          child.parentElement = el;
          el.children.push(child);
          return child;
        },
        removeChild(child) {
          const idx = el.children.indexOf(child);
          if (idx >= 0) el.children.splice(idx, 1);
          return child;
        },
        addEventListener(type, fn) {
          if (!listeners.has(type)) listeners.set(type, []);
          listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
          if (!listeners.has(type)) return;
          const list = listeners.get(type);
          const i = list.indexOf(fn);
          if (i >= 0) list.splice(i, 1);
        },
        dispatch(type, ev) {
          const list = listeners.get(type) || [];
          for (let i = 0; i < list.length; i += 1) {
            list[i]({
              type,
              target: el,
              clientX: ev && typeof ev.clientX === "number" ? ev.clientX : 0,
              clientY: ev && typeof ev.clientY === "number" ? ev.clientY : 0,
              button: ev && typeof ev.button === "number" ? ev.button : 0,
              preventDefault() {},
              stopPropagation() {}
            });
          }
        },
        getBoundingClientRect() {
          return { left: 0, top: 0, right: 228, bottom: 28, width: 228, height: 28 };
        }
      };
      return el;
    }
    const doc = {
      createElement: makeEl,
      head: makeEl("head"),
      body: makeEl("body"),
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      removeEventListener() {}
    };
    doc.body.ownerDocument = doc;
    doc.head.ownerDocument = doc;
    return doc;
  }

  const mockDoc = makeMockDoc();
  const mockWin = {
    innerWidth: 800,
    innerHeight: 600,
    localStorage: {
      getItem() {
        return JSON.stringify({ v: 1, motion: "fast", ticks: "highlight" });
      },
      setItem() {}
    },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    performance: { now: () => 100 }
  };

  const claudeLevels = [
    { effort: "low", label: "Low" },
    { effort: "medium", label: "Medium" },
    { effort: "high", label: "High" }
  ];
  let claudeEffort = "low";
  const claudeCommits = [];
  const claudeSeat = {
    baseName: "Claude Opus 5.5",
    isClaude: true,
    theme: "claude",
    effortLevels: claudeLevels,
    get currentEffort() { return claudeEffort; },
    selectEffort(item, idx) {
      claudeEffort = item.effort || item;
      claudeCommits.push({ effort: claudeEffort, index: idx });
    }
  };

  const claudePanel = mockDoc.createElement("div");
  claudePanel.setAttribute("data-testid", "model-selector-panel");
  const claudeValueEl = mockDoc.createElement("span");
  claudeValueEl.className = "ces-ag-effort-value";

  const container = mockDoc.createElement("div");
  const mounted = slider.mountCodexEffortSlider({
    container,
    panel: claudePanel,
    valueElement: claudeValueEl,
    seat: claudeSeat,
    document: mockDoc,
    window: mockWin
  });

  const rootEl = container.children[0];
  const trackEl = rootEl.children[0];

  assert.equal(rootEl.getAttribute("data-theme"), "claude");
  assert.equal(trackEl.getAttribute("data-theme"), "claude");

  // 在 Low 处拖动越过 1/3 边界到 Medium
  trackEl.dispatch("pointerdown", { clientX: 14 });
  trackEl.dispatch("pointermove", { clientX: 54 });
  assert.equal(claudeCommits.length, 1);
  assert.deepEqual(claudeCommits[0], { effort: "medium", index: 1 });
  assert.equal(claudePanel.classList.contains("ces-panel-shaking"), false);
  assert.equal(claudeValueEl.classList.contains("is-glowing"), false);
  assert.equal(claudeValueEl.classList.contains("ces-text-rise"), true, "Claude 模型切换档位应触发文字向上翻转动效");
  assert.equal(claudeValueEl.classList.contains("is-claude-changing"), true, "应保持向后兼容 is-claude-changing 类");

  // 继续拖动到 High
  trackEl.dispatch("pointermove", { clientX: 160 });
  assert.equal(claudeCommits.length, 2);
  assert.deepEqual(claudeCommits[1], { effort: "high", index: 2 });
  assert.equal(claudePanel.classList.contains("ces-panel-shaking"), true, "Claude 模型滑到最高档面板应触发轻微震颤");
  assert.equal(claudeValueEl.classList.contains("is-glowing"), true, "Claude 模型滑到最高档 High 应闪烁光斑");
  assert.equal(claudeValueEl.classList.contains("ces-text-rise"), true, "Claude 模型滑到最高档 High 应触发文字向上翻转");
  assert.equal(claudeValueEl.style.getPropertyValue("--ces-glow-color"), "rgba(196, 181, 253, 0.9)");

  mounted.unmount();
});

test("7. 推理条无焦点框选（outline: none !important / tabindex='-1'）与 View Usage 0.3s 停留展开延迟", () => {
  // 1. 验证 CSS 中的 outline / user-select 屏蔽规则
  const testDoc = makeMockDoc();
  const styleEl = slider.installStyles(testDoc);
  assert.ok(styleEl.textContent.includes("outline: none !important;"));
  assert.ok(styleEl.textContent.includes("user-select: none !important;"));
  assert.ok(styleEl.textContent.includes(".ces-ag-section *"));

  // 2. 验证 rootEl 的 tabindex 为 -1，避免 Radix/Base UI FocusScope 自动聚焦
  const levels = [
    { effort: "low", label: "Low" },
    { effort: "medium", label: "Medium" },
    { effort: "high", label: "High" }
  ];
  let curEffort = "high";
  const seat = {
    effortLevels: levels,
    get currentEffort() { return curEffort; },
    selectEffort(item, idx) { curEffort = item.effort; }
  };
  function makeMockDoc() {
    function makeEl(tag) {
      const listeners = new Map();
      const styleProps = new Map();
      const attrs = new Map();
      const classes = new Set();
      const el = {
        tagName: String(tag || "div").toUpperCase(),
        className: "",
        children: [],
        parentElement: null,
        ownerDocument: null,
        style: {
          setProperty(k, v) { styleProps.set(k, String(v)); },
          getPropertyValue(k) { return styleProps.get(k) || ""; }
        },
        classList: {
          add(c) { classes.add(c); },
          remove(c) { classes.delete(c); },
          contains(c) { return classes.has(c); }
        },
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
        appendChild(child) {
          child.parentElement = el;
          el.children.push(child);
          return child;
        },
        insertBefore(child, before) {
          child.parentElement = el;
          const idx = el.children.indexOf(before);
          if (idx >= 0) el.children.splice(idx, 0, child);
          else el.children.push(child);
          return child;
        },
        removeChild(child) {
          const idx = el.children.indexOf(child);
          if (idx >= 0) el.children.splice(idx, 1);
          child.parentElement = null;
          return child;
        },
        addEventListener(type, fn) {
          if (!listeners.has(type)) listeners.set(type, []);
          listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
          const arr = listeners.get(type) || [];
          const idx = arr.indexOf(fn);
          if (idx >= 0) arr.splice(idx, 1);
        },
        dispatchEvent(ev) {
          const arr = (listeners.get(ev.type) || []).slice();
          for (const fn of arr) fn.call(el, ev);
          return true;
        },
        closest(sel) {
          let cur = el;
          while (cur) {
            if (sel.includes(".") && cur.classList && cur.classList.contains(sel.replace(".", ""))) return cur;
            if (sel.includes("ces-root") && cur.className && cur.className.includes("ces-root")) return cur;
            if (sel.includes("model-selector-panel") && cur.getAttribute && cur.getAttribute("data-testid") === "model-selector-panel") return cur;
            cur = cur.parentElement;
          }
          return null;
        },
        contains(child) {
          let cur = child;
          while (cur) {
            if (cur === el) return true;
            cur = cur.parentElement;
          }
          return false;
        }
      };
      return el;
    }
    const head = makeEl("head");
    const body = makeEl("body");
    return {
      head,
      body,
      createElement: makeEl,
      getElementById(id) { return null; },
      querySelector(sel) { return null; },
      querySelectorAll(sel) { return []; },
      activeElement: null
    };
  }

  const doc = makeMockDoc();
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const mounted = slider.mountCodexEffortSlider({
    container,
    seat,
    document: doc,
    window: { performance: { now: () => Date.now() }, matchMedia: () => ({ matches: false }) }
  });

  const rootEl = container.children[0];
  assert.strictEqual(rootEl.getAttribute("tabindex"), "-1", "rootEl tabindex 应为 -1，防止 FocusScope 自动聚焦框选");
  mounted.unmount();
});

test("8. View Usage 0.3s (300ms) 停留展开防误触及移出后再次移入重新计时验证", () => {
  const origSetTimeout = global.setTimeout;
  const origClearTimeout = global.clearTimeout;
  let pendingTimers = [];
  let timerIdSeq = 1;
  global.setTimeout = (fn, ms) => {
    const id = timerIdSeq++;
    pendingTimers.push({ id, fn, ms });
    return id;
  };
  global.clearTimeout = (id) => {
    pendingTimers = pendingTimers.filter((t) => t.id !== id);
  };
  function advanceTime(ms) {
    const ready = [];
    pendingTimers = pendingTimers.filter((t) => {
      t.ms -= ms;
      if (t.ms <= 0) {
        ready.push(t.fn);
        return false;
      }
      return true;
    });
    for (const fn of ready) fn();
  }

  try {
    const listeners = new Map();
    const panel = {
      classList: { add() {}, remove() {}, contains() { return false; } },
      addEventListener(type, fn, capture) {
        const key = type + (capture ? ":capture" : ":bubble");
        if (!listeners.has(key)) listeners.set(key, []);
        listeners.get(key).push(fn);
      },
      removeEventListener(type, fn, capture) {
        const key = type + (capture ? ":capture" : ":bubble");
        const arr = listeners.get(key) || [];
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      },
      contains(target) {
        let cur = target;
        while (cur) {
          if (cur === panel) return true;
          cur = cur.parentElement;
        }
        return false;
      }
    };

    const triggerListeners = new Map();
    const dispatchedToTrigger = [];
    const viewUsageItem = {
      parentElement: panel,
      textContent: "View Usage ›",
      closest(sel) {
        if (sel.includes('[role="menuitem"]') || sel.includes('button')) return viewUsageItem;
        return null;
      },
      contains(target) {
        return target === viewUsageItem;
      },
      addEventListener(type, fn, opts) {
        if (!triggerListeners.has(type)) triggerListeners.set(type, []);
        triggerListeners.get(type).push({ fn, once: opts && opts.once });
      },
      dispatchEvent(ev) {
        dispatchedToTrigger.push(ev);
        const arr = (triggerListeners.get(ev.type) || []).slice();
        for (const item of arr) {
          item.fn.call(viewUsageItem, ev);
          if (item.once) {
            const list = triggerListeners.get(ev.type) || [];
            const idx = list.indexOf(item);
            if (idx >= 0) list.splice(idx, 1);
          }
        }
        return true;
      }
    };

    const otherModelItem = {
      parentElement: panel,
      textContent: "Gemini 4 Argon (High)",
      closest(sel) {
        if (sel.includes('[role="menuitem"]') || sel.includes('button')) return otherModelItem;
        return null;
      },
      contains(target) {
        return target === otherModelItem;
      }
    };

    function simulateDispatch(type, target, relatedTarget) {
      let stopped = false;
      const ev = {
        type,
        target,
        relatedTarget,
        bubbles: type === "pointerover" || type === "pointerout" || type === "pointermove",
        cancelable: true,
        isPropagationStopped: false,
        isTestDispatch: true,
        stopPropagation() {
          stopped = true;
          this.isPropagationStopped = true;
        },
        stopImmediatePropagation() {
          stopped = true;
          this.isPropagationStopped = true;
        }
      };

      // 1. Capture on panel
      const capList = (listeners.get(type + ":capture") || []).slice();
      for (const fn of capList) {
        fn(ev);
        if (stopped) break;
      }

      // 2. Direct on target if not stopped
      if (!stopped && target && typeof target.dispatchEvent === "function") {
        target.dispatchEvent(ev);
      }
      return ev;
    }

    const mockDoc = {
      body: { appendChild() {}, removeChild() {} },
      head: { appendChild() {}, removeChild() {} },
      createElement(tag) {
        return {
          tagName: String(tag || "div").toUpperCase(),
          style: { setProperty() {}, getPropertyValue() { return ""; } },
          setAttribute() {},
          appendChild() {},
          textContent: ""
        };
      },
      getElementById() { return null; },
      querySelectorAll() { return []; },
      querySelector() { return null; }
    };
    const obs = slider.installAntigravityObserver({ document: mockDoc, window: { performance: { now: () => 0 } } });
    obs.bindPanelInteractions(panel);

    const getSyntheticEnters = () => dispatchedToTrigger.filter((e) => e.type === "pointerenter" && !e.isTestDispatch);

    // 1. 鼠标首次移入 View Usage: 应被拦截且启动 300ms 计时器
    const enter1 = simulateDispatch("pointerenter", viewUsageItem, otherModelItem);
    assert.strictEqual(enter1.isPropagationStopped, true, "首次移入 View Usage 必须阻止冒泡并延迟打开");
    assert.strictEqual(pendingTimers.length, 1, "应注册一个 300ms 定时器");
    assert.strictEqual(getSyntheticEnters().length, 0, "未达到 300ms 时不应触发任何展开事件");

    // 2. 若在 300ms 内离开（例如 100ms 划过），定时器应被取消，不触发展开
    advanceTime(100);
    simulateDispatch("pointerout", viewUsageItem, otherModelItem);
    assert.strictEqual(pendingTimers.length, 0, "鼠标在 300ms 内移出必须立即取消定时器");
    assert.strictEqual(getSyntheticEnters().length, 0, "快速划过绝不展开子菜单");

    // 3. 鼠标再次移入并有意停留满 300ms: 定时器执行，派发合成展开事件
    const enter2 = simulateDispatch("pointerenter", viewUsageItem, otherModelItem);
    assert.strictEqual(enter2.isPropagationStopped, true, "再次移入必须重新拦截并计时");
    assert.strictEqual(pendingTimers.length, 1, "应注册新的 300ms 定时器");
    advanceTime(300);
    assert.ok(dispatchedToTrigger.length >= 1, "停留满 300ms 后必须向触发项派发合成事件展开子菜单");
    dispatchedToTrigger.length = 0;

    // 4. 鼠标从 View Usage 移出至其他模型项（例如浏览 Gemini 模型）
    simulateDispatch("pointerout", viewUsageItem, otherModelItem);
    simulateDispatch("pointerover", otherModelItem, viewUsageItem);
    dispatchedToTrigger.length = 0;

    // 5. 关键回归测试：鼠标再次移入 View Usage 时，必须重新生效 0.3s 延迟，绝不能瞬间打开！
    const enter3 = simulateDispatch("pointerenter", viewUsageItem, otherModelItem);
    assert.strictEqual(enter3.isPropagationStopped, true, "移出再次移入后必须再次被拦截，绝不能立即放行展开！");
    assert.strictEqual(pendingTimers.length, 1, "必须重新启动 300ms 定时器");
    assert.strictEqual(getSyntheticEnters().length, 0, "再次移入在未满 300ms 前绝不应有合成事件派发");

    // 6. 再次停留满 300ms 后才顺利展开
    advanceTime(300);
    assert.ok(dispatchedToTrigger.length >= 1, "再次停留满 300ms 后顺利展开");
  } finally {
    global.setTimeout = origSetTimeout;
    global.clearTimeout = origClearTimeout;
  }
});

test("9. Extra 档位兼容解析与 Gemini 4 Hydrogen 四档模型配置", () => {
  const parsedExtra = slider.parseModelLabel("Gemini 4 Hydrogen (Extra)");
  assert.deepEqual(parsedExtra, {
    base: "Gemini 4 Hydrogen",
    effort: "xhigh",
    effortLabel: "Extra"
  });

  const parsedXhigh = slider.parseModelLabel("Gemini 4 Hydrogen (xhigh)");
  assert.deepEqual(parsedXhigh, {
    base: "Gemini 4 Hydrogen",
    effort: "xhigh",
    effortLabel: "Extra"
  });

  const hydrogenOptions = [
    { label: "Gemini 4 Carbon (Low)", value: 1429 },
    { label: "Gemini 4 Carbon (Medium)", value: 1428 },
    { label: "Gemini 4 Carbon (High)", value: 1427 },
    { label: "Gemini 4 Hydrogen (Low)", value: 1439 },
    { label: "Gemini 4 Hydrogen (Medium)", value: 1438 },
    { label: "Gemini 4 Hydrogen (High)", value: 1437 },
    { label: "Gemini 4 Hydrogen (Extra)", value: 1436 }
  ];

  const popoverFiber = {
    memoizedProps: {
      open: true,
      setIsOpen() {},
      setSelectedModel() {},
      modelOptions: hydrogenOptions,
      selectedModel: hydrogenOptions[6]
    },
    return: null
  };
  const ctx = slider.readAntigravityFiberContext({ __reactFiber$extra: popoverFiber });
  assert.ok(ctx);
  assert.equal(ctx.effortIndex.get("Gemini 4 Hydrogen").size, 4);

  const profHydrogen = slider.resolveModelEffortProfile(ctx, "Gemini 4 Hydrogen", new Map());
  assert.equal(profHydrogen.baseName, "Gemini 4 Hydrogen");
  assert.equal(profHydrogen.locked, false);
  assert.deepEqual(
    profHydrogen.levels.map((l) => l.label),
    ["Low", "Medium", "High", "Extra"]
  );
  assert.equal(profHydrogen.currentIndex, 3);
  assert.equal(profHydrogen.currentLabel, "Extra");
});

test("10. 模型行 √ 稳态显示、未选中行等宽占位及面板防收缩宽度锁定", () => {
  function makeMockNode(tag) {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const styleProps = new Map();
    const node = {
      tagName: String(tag || "div").toUpperCase(),
      id: "",
      textContent: "",
      children: [],
      parentNode: null,
      parentElement: null,
      offsetWidth: 0,
      style: {
        setProperty(k, v) { styleProps.set(k, String(v)); },
        getPropertyValue(k) { return styleProps.get(k) || ""; }
      },
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); }
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(child) {
        child.parentNode = node;
        child.parentElement = node;
        node.children.push(child);
        return child;
      },
      insertBefore(child, before) {
        child.parentNode = node;
        child.parentElement = node;
        const idx = node.children.indexOf(before);
        if (idx >= 0) node.children.splice(idx, 0, child);
        else node.children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = node.children.indexOf(child);
        if (idx >= 0) node.children.splice(idx, 1);
        child.parentNode = null;
        child.parentElement = null;
        return child;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type) || [];
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      },
      querySelector(sel) {
        for (const ch of node.children) {
          if (sel === '[data-testid="model-selector-panel"]' && ch.getAttribute("data-testid") === "model-selector-panel") return ch;
          const nested = ch.querySelector ? ch.querySelector(sel) : null;
          if (nested) return nested;
        }
        return null;
      },
      querySelectorAll() { return []; },
      closest(sel) {
        let cur = node;
        while (cur) {
          if (sel === '[role="menu"]' && cur.getAttribute("role") === "menu") return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      contains(target) {
        let cur = target;
        while (cur) {
          if (cur === node) return true;
          cur = cur.parentElement;
        }
        return false;
      }
    };
    Object.defineProperty(node, "firstElementChild", {
      get() { return node.children[0] || null; }
    });
    Object.defineProperty(node, "nextSibling", {
      get() {
        if (!node.parentNode) return null;
        const idx = node.parentNode.children.indexOf(node);
        return idx >= 0 ? node.parentNode.children[idx + 1] || null : null;
      }
    });
    return node;
  }

  const head = makeMockNode("head");
  const body = makeMockNode("body");
  const popup = makeMockNode("div");
  popup.setAttribute("role", "menu");
  popup.offsetWidth = 288;

  const panel = makeMockNode("div");
  panel.setAttribute("data-testid", "model-selector-panel");
  const listWrap = makeMockNode("div");
  panel.appendChild(listWrap);
  popup.appendChild(panel);
  body.appendChild(popup);

  const opts = [
    { label: "Gemini 4 Hydrogen (Low)", value: 1439 },
    { label: "Gemini 4 Hydrogen (Medium)", value: 1438 },
    { label: "Gemini 4 Hydrogen (High)", value: 1437 }
  ];
  panel.__reactFiber$width = {
    memoizedProps: {
      open: true,
      setIsOpen() {},
      setSelectedModel() {},
      modelOptions: opts,
      selectedModel: opts[2]
    },
    return: null
  };

  const mockDoc = {
    head,
    body,
    activeElement: null,
    createElement: makeMockNode,
    getElementById(id) {
      for (const ch of head.children) {
        if (ch.id === id) return ch;
      }
      return null;
    },
    querySelector(sel) {
      return body.querySelector(sel);
    },
    querySelectorAll() { return []; }
  };

  const mockWin = {
    performance: { now: () => 1000 },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (cb) => { cb(); return 1; }
  };

  // 1. 验证注入 CSS 包含 √ 稳态显示与未选中行等宽占位规则
  const styleEl = slider.installStyles(mockDoc);
  const css = styleEl.textContent;
  assert.ok(css.includes(".group-focus\\:hidden"), "必须覆盖 group-focus:hidden 防止失焦/聚焦切换导致 √ 显隐跳动");
  assert.ok(css.includes("span:not(:first-child):not(:last-child)"), "必须按结构兜底选中行中间 √ 节点始终稳态可见");
  assert.ok(css.includes("visibility: visible !important;"), "必须强制选中行 √ 保持 visibility: visible");
  assert.ok(css.includes("span:first-child + span.shrink-0:last-child"), "未选中行末尾 › 必须使用 visibility: hidden 保留等宽占位");
  assert.ok(css.includes("visibility: hidden !important;"), "未选中行占位不可使用 display: none 塌缩宽度");

  // 2. 验证面板宽度锁定：初始 288px -> 尝试收缩到 270px 仍锁定 288px -> 增宽至 296px 单调更新
  const obs = slider.installAntigravityObserver({ document: mockDoc, window: mockWin });
  assert.equal(popup.getAttribute("data-ces-locked-width"), "288");
  assert.equal(popup.style.minWidth, "288px");
  assert.equal(panel.style.minWidth, "100%");

  popup.offsetWidth = 270;
  obs.rescan();
  assert.equal(popup.getAttribute("data-ces-locked-width"), "288", "面板宽度锁绝不应向回收缩");
  assert.equal(popup.style.minWidth, "288px");

  popup.offsetWidth = 296;
  obs.rescan();
  assert.equal(popup.getAttribute("data-ces-locked-width"), "296");
  assert.equal(popup.style.minWidth, "296px");

  // 3. 面板关闭卸载时清理宽度锁
  body.removeChild(popup);
  obs.rescan();
  assert.equal(popup.getAttribute("data-ces-locked-width"), null);
  assert.equal(popup.style.minWidth, "");
  assert.equal(panel.style.minWidth, "");
  obs.stop();
});

function createPerfTestEnv(opts = {}) {
  const attrsMap = new WeakMap();
  function matchSimpleSelector(el, sel) {
    if (!el || el.nodeType !== 1) return false;
    const s = sel.trim();
    if (!s) return false;
    if (s.startsWith("#")) return el.id === s.slice(1);
    if (s.startsWith(".")) return el.classList.contains(s.slice(1));
    const tagClassMatch = /^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/.exec(s);
    if (tagClassMatch) {
      return el.tagName === tagClassMatch[1].toUpperCase() && el.classList.contains(tagClassMatch[2]);
    }
    const attrMatch = /^([a-zA-Z0-9_-]*)\[([a-zA-Z0-9_-]+)(?:(\^?=)["']([^"']*)["'])?\]$/.exec(s);
    if (attrMatch) {
      const tag = attrMatch[1];
      const attrName = attrMatch[2];
      const op = attrMatch[3];
      const expected = attrMatch[4];
      if (tag && el.tagName !== tag.toUpperCase()) return false;
      const val = el.getAttribute(attrName);
      if (val === null) return false;
      if (!op) return true;
      if (op === "=") return val === expected;
      if (op === "^=") return val.startsWith(expected);
    }
    return el.tagName === s.toUpperCase();
  }

  function matchesSelectorList(el, selectorList) {
    const parts = selectorList.split(",");
    for (const part of parts) {
      if (matchSimpleSelector(el, part)) return true;
    }
    return false;
  }

  function makeNode(tag) {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const styleProps = new Map();
    let connected = false;
    const node = {
      nodeType: 1,
      tagName: String(tag || "div").toUpperCase(),
      id: "",
      textContent: "",
      children: [],
      parentNode: null,
      parentElement: null,
      ownerDocument: null,
      width: 280,
      height: 28,
      get isConnected() {
        return connected;
      },
      set isConnected(v) {
        connected = Boolean(v);
        for (const ch of node.children) ch.isConnected = connected;
      },
      style: {
        setProperty(k, v) { styleProps.set(k, String(v)); },
        getPropertyValue(k) { return styleProps.get(k) || ""; },
        color: "",
        opacity: "",
        fontWeight: "",
        display: "",
        minWidth: "",
        width: "",
        left: "",
        top: "",
        background: "",
        animationDuration: "",
        animationDelay: ""
      },
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); }
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(child) {
        child.parentNode = node;
        child.parentElement = node;
        node.children.push(child);
        if (connected) child.isConnected = true;
        return child;
      },
      insertBefore(child, before) {
        child.parentNode = node;
        child.parentElement = node;
        const idx = node.children.indexOf(before);
        if (idx >= 0) node.children.splice(idx, 0, child);
        else node.children.push(child);
        if (connected) child.isConnected = true;
        return child;
      },
      removeChild(child) {
        const idx = node.children.indexOf(child);
        if (idx >= 0) node.children.splice(idx, 1);
        child.parentNode = null;
        child.parentElement = null;
        child.isConnected = false;
        return child;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type) || [];
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      },
      dispatch(type, eventInit = {}) {
        const arr = (listeners.get(type) || []).slice();
        for (const fn of arr) {
          fn({
            type,
            target: node,
            button: 0,
            buttons: 1,
            pointerId: 1,
            stopPropagation() {},
            stopImmediatePropagation() {},
            preventDefault() {},
            ...eventInit
          });
        }
      },
      querySelector(sel) {
        for (const ch of node.children) {
          if (matchesSelectorList(ch, sel)) return ch;
          const nested = ch.querySelector(sel);
          if (nested) return nested;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        for (const ch of node.children) {
          if (matchesSelectorList(ch, sel)) out.push(ch);
          out.push(...ch.querySelectorAll(sel));
        }
        return out;
      },
      closest(sel) {
        let cur = node;
        while (cur) {
          if (matchesSelectorList(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      contains(target) {
        let cur = target;
        while (cur) {
          if (cur === node) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 228, bottom: 28, width: 228, height: 28 };
      }
    };
    Object.defineProperty(node, "className", {
      get() { return Array.from(classes).join(" "); },
      set(val) {
        classes.clear();
        String(val || "").split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      }
    });
    Object.defineProperty(node, "firstElementChild", {
      get() { return node.children[0] || null; }
    });
    Object.defineProperty(node, "nextSibling", {
      get() {
        if (!node.parentNode) return null;
        const idx = node.parentNode.children.indexOf(node);
        return idx >= 0 ? node.parentNode.children[idx + 1] || null : null;
      }
    });
    Object.defineProperty(node, "nextElementSibling", {
      get() {
        return node.nextSibling;
      }
    });
    Object.defineProperty(node, "innerHTML", {
      get() { return ""; },
      set() {
        for (const ch of node.children) ch.isConnected = false;
        node.children = [];
      }
    });
    attrsMap.set(node, attrs);
    return node;
  }

  const head = makeNode("head");
  const body = makeNode("body");
  const documentElement = makeNode("html");
  documentElement.appendChild(head);
  documentElement.appendChild(body);
  documentElement.isConnected = true;

  const docListeners = new Map();
  const doc = {
    head,
    body,
    documentElement,
    activeElement: null,
    createElement(tag) {
      const el = makeNode(tag);
      el.ownerDocument = doc;
      return el;
    },
    getElementById(id) {
      return head.querySelector("#" + id) || body.querySelector("#" + id);
    },
    querySelector(sel) {
      return body.querySelector(sel);
    },
    querySelectorAll(sel) {
      return body.querySelectorAll(sel);
    },
    addEventListener(type, fn, capture) {
      const key = type + (capture ? ":c" : ":b");
      if (!docListeners.has(key)) docListeners.set(key, []);
      docListeners.get(key).push(fn);
    },
    removeEventListener(type, fn, capture) {
      const key = type + (capture ? ":c" : ":b");
      const arr = docListeners.get(key) || [];
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(ev) {
      const cap = (docListeners.get(ev.type + ":c") || []).slice();
      for (const fn of cap) fn(ev);
      const bub = (docListeners.get(ev.type + ":b") || []).slice();
      for (const fn of bub) fn(ev);
      return true;
    }
  };

  let rafSeq = 1;
  let rafQueue = [];
  const winListeners = new Map();
  const moInstances = [];
  const roInstances = [];
  let settingsJson = opts.settingsJson || JSON.stringify({ v: 1, motion: "fast", ticks: "highlight" });
  let nowTick = 100;

  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.target = null;
      this.options = null;
      this.disconnected = false;
      this.takeRecordsCount = 0;
      moInstances.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
      this.disconnected = false;
    }
    disconnect() {
      this.disconnected = true;
    }
    takeRecords() {
      this.takeRecordsCount += 1;
      return [];
    }
    trigger(records) {
      if (!this.disconnected) this.cb(records);
    }
  }

  class MockResizeObserver {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
      this.disconnected = false;
      roInstances.push(this);
    }
    observe(target) {
      this.targets.push(target);
    }
    disconnect() {
      this.disconnected = true;
    }
    trigger(target, width, height = 28) {
      if (!this.disconnected) {
        this.cb([{
          target,
          borderBoxSize: [{ inlineSize: width, blockSize: height }],
          contentRect: { width, height }
        }]);
      }
    }
  }

  const win = {
    innerWidth: 1200,
    innerHeight: 800,
    performance: { now: () => (nowTick += 16) },
    Event: function (type) { this.type = type; },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    MutationObserver: opts.withMO ? MockMutationObserver : undefined,
    ResizeObserver: opts.withRO ? MockResizeObserver : undefined,
    matchMedia: () => ({ matches: Boolean(opts.reducedMotion), addEventListener() {}, removeEventListener() {} }),
    localStorage: {
      getItem() { return settingsJson; },
      setItem(_k, v) { settingsJson = v; }
    },
    requestAnimationFrame(cb) {
      const id = rafSeq++;
      rafQueue.push({ id, cb });
      return id;
    },
    cancelAnimationFrame(id) {
      rafQueue = rafQueue.filter((item) => item.id !== id);
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = winListeners.get(type) || [];
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(ev) {
      const arr = (winListeners.get(ev.type) || []).slice();
      for (const fn of arr) fn(ev);
      return true;
    }
  };
  doc.defaultView = win;

  function flushRaf() {
    let guard = 0;
    while (rafQueue.length > 0 && guard < 10) {
      guard += 1;
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const item of batch) {
        item.cb(nowTick += 16);
      }
    }
  }

  return { doc, win, body, head, makeNode, moInstances, roInstances, flushRaf, setSettingsJson(v) { settingsJson = v; } };
}

test("11. 最高档面板微震颤：独立 translate 属性、四档 Extra、简洁模式与减弱动画静默", () => {
  // 1. CSS 使用独立 translate 属性（@keyframes ces-panel-shake 内不写 transform: translateX）
  const env = createPerfTestEnv();
  const styleEl = slider.installStyles(env.doc);
  const shakeBlockMatch = /@keyframes ces-panel-shake\s*\{[\s\S]*?\n\}/.exec(styleEl.textContent);
  assert.ok(shakeBlockMatch, "应包含 ces-panel-shake 关键帧");
  assert.ok(shakeBlockMatch[0].includes("translate: 2.5px 0;"), "微震颤应使用独立 CSS translate 属性");
  assert.ok(!shakeBlockMatch[0].includes("transform: translateX"), "ces-panel-shake 不应使用 transform: translateX 覆盖弹层定位");

  // 2. 四档模型 (Gemini 4 Hydrogen: Low / Medium / High / Extra)，仅到达 Extra 时震颤
  const levels4 = [
    { effort: "low", label: "Low" },
    { effort: "medium", label: "Medium" },
    { effort: "high", label: "High" },
    { effort: "xhigh", label: "Extra" }
  ];
  let cur4 = "low";
  const seat4 = {
    effortLevels: levels4,
    get currentEffort() { return cur4; },
    selectEffort(item) { cur4 = item.effort; }
  };
  const panel4 = env.makeNode("div");
  panel4.setAttribute("data-testid", "model-selector-panel");
  const val4 = env.makeNode("span");
  val4.className = "ces-ag-effort-value";
  const container4 = env.makeNode("div");

  const mounted4 = slider.mountCodexEffortSlider({
    container: container4,
    panel: panel4,
    valueElement: val4,
    seat: seat4,
    document: env.doc,
    window: env.win
  });
  const track4 = container4.children[0].children[0];

  track4.dispatch("pointerdown", { clientX: 14 });
  // 移动到 High (66.7% -> clientX = 14 + 200 * 0.67 = 148)：非最高档不震颤
  track4.dispatch("pointermove", { clientX: 148 });
  assert.equal(cur4, "high");
  assert.equal(panel4.classList.contains("ces-panel-shaking"), false, "四档模型到达 High 不应提前震颤");
  // 移动到 Extra (90% -> clientX = 14 + 200 * 0.9 = 194)：最高档触发震颤
  track4.dispatch("pointermove", { clientX: 194 });
  assert.equal(cur4, "xhigh");
  assert.equal(panel4.classList.contains("ces-panel-shaking"), true, "四档模型到达 Extra 应触发面板微震颤");
  // 回退到 High：立即清理震颤类名
  track4.dispatch("pointermove", { clientX: 148 });
  assert.equal(cur4, "high");
  assert.equal(panel4.classList.contains("ces-panel-shaking"), false, "回退低档应立即清除面板震颤");
  mounted4.unmount();

  // 3. 简洁动画模式 (motion: "quick") 下不触发面板微震颤
  const quickEnv = createPerfTestEnv({ settingsJson: JSON.stringify({ v: 1, motion: "quick", ticks: "highlight" }) });
  let cur3 = "low";
  const seat3 = {
    effortLevels: [{ effort: "low", label: "Low" }, { effort: "medium", label: "Medium" }, { effort: "high", label: "High" }],
    get currentEffort() { return cur3; },
    selectEffort(item) { cur3 = item.effort; }
  };
  const panelQ = quickEnv.makeNode("div");
  const containerQ = quickEnv.makeNode("div");
  const mountedQ = slider.mountCodexEffortSlider({
    container: containerQ,
    panel: panelQ,
    seat: seat3,
    document: quickEnv.doc,
    window: quickEnv.win
  });
  const trackQ = containerQ.children[0].children[0];
  trackQ.dispatch("pointerdown", { clientX: 14 });
  trackQ.dispatch("pointermove", { clientX: 180 });
  assert.equal(cur3, "high");
  assert.equal(panelQ.classList.contains("ces-panel-shaking"), false, "简洁动画模式下最高档应静默不震颤");
  mountedQ.unmount();

  // 4. prefers-reduced-motion 下不触发微震颤与光斑；已在最高档时按 ArrowRight 不震颤
  const rmEnv = createPerfTestEnv({ reducedMotion: true });
  let curRm = "low";
  const seatRm = {
    effortLevels: [{ effort: "low", label: "Low" }, { effort: "medium", label: "Medium" }, { effort: "high", label: "High" }],
    get currentEffort() { return curRm; },
    selectEffort(item) { curRm = item.effort; }
  };
  const panelRm = rmEnv.makeNode("div");
  const valRm = rmEnv.makeNode("span");
  const containerRm = rmEnv.makeNode("div");
  const mountedRm = slider.mountCodexEffortSlider({
    container: containerRm,
    panel: panelRm,
    valueElement: valRm,
    seat: seatRm,
    document: rmEnv.doc,
    window: rmEnv.win
  });
  const trackRm = containerRm.children[0].children[0];
  trackRm.dispatch("pointerdown", { clientX: 14 });
  trackRm.dispatch("pointermove", { clientX: 180 });
  assert.equal(panelRm.classList.contains("ces-panel-shaking"), false, "系统减弱动画模式下不应震颤");
  assert.equal(valRm.classList.contains("is-glowing"), false, "系统减弱动画模式下不应闪烁光斑");
  mountedRm.unmount();

  // 已在最高档按 ArrowRight 不误触震颤
  let curKey = "high";
  const panelKey = env.makeNode("div");
  const containerKey = env.makeNode("div");
  const mountedKey = slider.mountCodexEffortSlider({
    container: containerKey,
    panel: panelKey,
    seat: {
      effortLevels: [{ effort: "low", label: "Low" }, { effort: "medium", label: "Medium" }, { effort: "high", label: "High" }],
      get currentEffort() { return curKey; },
      selectEffort(item) { curKey = item.effort; }
    },
    document: env.doc,
    window: env.win
  });
  containerKey.children[0].dispatch("keydown", { key: "ArrowRight" });
  assert.equal(panelKey.classList.contains("ces-panel-shaking"), false, "已在最高档按右方向键不应误触发震颤");
  mountedKey.unmount();
});

test("12. 窄观察器作用域、防异步微任务自激与原生 AGY 停用 installMenuObserver", () => {
  const env = createPerfTestEnv({ withMO: true, withRO: true });
  const triggerBtn = env.makeNode("button");
  triggerBtn.setAttribute("data-testid", "model-selector-trigger");
  const outerSpan = env.makeNode("span");
  outerSpan.classList.add("min-w-0");
  const effortSpan = env.makeNode("span");
  effortSpan.classList.add("opacity-70");
  effortSpan.textContent = " Medium";
  outerSpan.appendChild(effortSpan);
  triggerBtn.appendChild(outerSpan);
  env.body.appendChild(triggerBtn);

  // 同时放入一个通用「推理等级」DOM 行，验证原生 AGY 环境下不会误启 installMenuObserver
  const genericRow = env.makeNode("div");
  genericRow.textContent = "推理等级";
  env.body.appendChild(genericRow);

  const optsList = [
    { label: "Gemini 4 Argon (Low)", value: 1 },
    { label: "Gemini 4 Argon (Medium)", value: 2 },
    { label: "Gemini 4 Argon (High)", value: 3 }
  ];
  let fiberReads = 0;
  const popoverFiber = { return: null };
  const rawProps = {
    open: false,
    setIsOpen() {},
    setSelectedModel() {},
    modelOptions: optsList,
    selectedModel: optsList[1]
  };
  Object.defineProperty(popoverFiber, "memoizedProps", {
    get() {
      fiberReads += 1;
      return rawProps;
    }
  });
  triggerBtn.__reactFiber$perf = popoverFiber;

  const inst = slider.installCodexEffortSlider({ document: env.doc, window: env.win });

  const bodyObservers = env.moInstances.filter((o) => o.target === env.body);
  assert.equal(bodyObservers.length, 1, "原生 AGY 下 doc.body 只能挂 1 个 portal 观察器（绝不启用通用 installMenuObserver）");
  assert.deepEqual(
    bodyObservers[0].options,
    { childList: true, subtree: false },
    "doc.body 必须仅监听浅层 childList（subtree: false）"
  );
  const triggerObservers = env.moInstances.filter((o) => o.target === triggerBtn);
  assert.equal(triggerObservers.length, 1, "应绑定专门的 trigger 窄观察器");
  assert.ok(triggerObservers[0].takeRecordsCount >= 1, "同步初始化修改后必须调用 triggerObserver.takeRecords");
  assert.equal(genericRow.querySelector(".ces-inline"), null, "原生 AGY 下不得再运行通用 installMenuObserver");

  // 1. 菜单关闭时注入无关顶层 DOM（如 agy-capsule 浮窗），0 次触发 Fiber 读取
  fiberReads = 0;
  const capsulePill = env.makeNode("div");
  capsulePill.classList.add("agy-capsule-pill");
  env.body.appendChild(capsulePill);
  bodyObservers[0].trigger([{ type: "childList", target: env.body, addedNodes: [capsulePill], removedNodes: [] }]);
  env.flushRaf();
  assert.equal(fiberReads, 0, "菜单关闭态下无关 DOM 变更绝不应触发 Fiber 遍历");

  // 2. 打开菜单：插入包含 model-selector-panel 的 popup
  const popup = env.makeNode("div");
  popup.setAttribute("role", "menu");
  const panel = env.makeNode("div");
  panel.setAttribute("data-testid", "model-selector-panel");
  panel.appendChild(env.makeNode("div"));
  panel.__reactFiber$perf = popoverFiber;
  popup.appendChild(panel);
  env.body.appendChild(popup);
  bodyObservers[0].trigger([{ type: "childList", target: env.body, addedNodes: [popup], removedNodes: [] }]);
  env.flushRaf();

  const panelObservers = env.moInstances.filter((o) => o.target === popup || o.target === panel);
  assert.equal(panelObservers.length, 1, "打开菜单后应挂载 panel 局部观察器");
  assert.ok(bodyObservers[0].takeRecordsCount >= 1, "面板同步挂载后必须调用 bodyObserver.takeRecords");
  assert.ok(panelObservers[0].takeRecordsCount >= 1, "面板同步挂载后必须调用 panelObserver.takeRecords");

  // 3. 滑块自身 .ces-ag-section 内变更直接忽略，0 次触发 scan/Fiber
  fiberReads = 0;
  const ownSection = panel.querySelector(".ces-ag-section");
  panelObservers[0].trigger([{ type: "childList", target: ownSection, addedNodes: [env.makeNode("span")], removedNodes: [] }]);
  env.flushRaf();
  assert.equal(fiberReads, 0, "自身 .ces-ag-section 内部 DOM 变化应被直接忽略");

  // 4. 同帧连发 20 次非自身面板变更回调：经 rAF 合并为 1 次 scan()
  fiberReads = 0;
  const foreignRow = env.makeNode("div");
  for (let i = 0; i < 20; i += 1) {
    panelObservers[0].trigger([{ type: "childList", target: panel, addedNodes: [foreignRow], removedNodes: [] }]);
  }
  assert.equal(fiberReads, 0, "回调当帧不应同步连跑 20 次 scan");
  env.flushRaf();
  const readsPerSingleScan = fiberReads;
  assert.ok(readsPerSingleScan > 0 && readsPerSingleScan <= 4, `20 次变更应合并为单次 scan (reads=${readsPerSingleScan})`);

  // 5. 关闭菜单：panel 观察器必须立刻断开
  env.body.removeChild(popup);
  bodyObservers[0].trigger([{ type: "childList", target: env.body, addedNodes: [], removedNodes: [popup] }]);
  env.flushRaf();
  assert.equal(panelObservers[0].disconnected, true, "关闭菜单后必须立刻断开 panel 观察器");

  inst.stop();
});

test("13. 高频拖动零强制回流、零设置读取与 1× Fiber 快照", () => {
  const env = createPerfTestEnv({ withMO: true, withRO: true });
  let offsetWidthReads = 0;
  let valOffsetWidthReads = 0;
  let rectReads = 0;
  let storageReads = 0;
  let animPlayCount = 0;

  const origCreateElement = env.doc.createElement.bind(env.doc);
  env.doc.createElement = function (tag) {
    const el = origCreateElement(tag);
    if (String(tag).toLowerCase() === "span") {
      Object.defineProperty(el, "offsetWidth", {
        get() {
          if (el.classList.contains("ces-ag-effort-value")) valOffsetWidthReads += 1;
          return 48;
        }
      });
      el.getAnimations = () => [{
        animationName: "ces-text-rise",
        cancel() {},
        play() { animPlayCount += 1; }
      }];
    }
    return el;
  };

  const origGetItem = env.win.localStorage.getItem;
  env.win.localStorage.getItem = function (...args) {
    storageReads += 1;
    return origGetItem.apply(this, args);
  };

  const popup = env.makeNode("div");
  popup.setAttribute("role", "menu");
  Object.defineProperty(popup, "offsetWidth", {
    get() {
      offsetWidthReads += 1;
      return 288;
    }
  });
  const panel = env.makeNode("div");
  panel.setAttribute("data-testid", "model-selector-panel");
  const listWrap = env.makeNode("div");
  const rowDiv = env.makeNode("div");
  rowDiv.setAttribute("role", "menuitem");
  const gSpan = env.makeNode("span");
  gSpan.setAttribute("data-testid", "model-selector-effort-group");
  gSpan.setAttribute("data-model-base", "Gemini 4 Argon");
  const sibSpan = env.makeNode("span");
  sibSpan.textContent = "Low";
  let rowDecorWrites = 0;
  const origSetAttr = rowDiv.setAttribute.bind(rowDiv);
  rowDiv.setAttribute = function (k, v) {
    if (k === "data-ces-model-selected") rowDecorWrites += 1;
    return origSetAttr(k, v);
  };
  rowDiv.appendChild(gSpan);
  rowDiv.appendChild(sibSpan);
  listWrap.appendChild(rowDiv);
  panel.appendChild(listWrap);
  popup.appendChild(panel);
  env.body.appendChild(popup);

  const optsList = [
    { label: "Gemini 4 Argon (Low)", value: 1 },
    { label: "Gemini 4 Argon (Medium)", value: 2 },
    { label: "Gemini 4 Argon (High)", value: 3 }
  ];
  let currentModel = optsList[0];
  let fiberReads = 0;
  const fiberNode = { return: null };
  Object.defineProperty(fiberNode, "memoizedProps", {
    get() {
      fiberReads += 1;
      return {
        open: true,
        setIsOpen() {},
        setSelectedModel(opt) { currentModel = opt; },
        modelOptions: optsList,
        selectedModel: currentModel
      };
    }
  });
  panel.__reactFiber$drag = fiberNode;

  const obs = slider.installAntigravityObserver({ document: env.doc, window: env.win });
  env.roInstances[0]?.trigger(popup, 288, 260);
  env.flushRaf();

  const trackEl = panel.querySelector('[data-ces-part="track"]');
  trackEl.getBoundingClientRect = function () {
    rectReads += 1;
    return { left: 0, top: 0, right: 228, bottom: 28, width: 228, height: 28 };
  };

  // 清零探针，测试完整拖动过程：pointerdown + 30 次 pointermove + pointerup
  offsetWidthReads = 0;
  valOffsetWidthReads = 0;
  rectReads = 0;
  storageReads = 0;
  rowDecorWrites = 0;

  trackEl.dispatch("pointerdown", { clientX: 14 });
  assert.equal(rectReads, 1, "仅 pointerdown 读取一次轨道 getBoundingClientRect");

  // 统计同档位单次 pointermove 的 Fiber 遍历次数（拖动期快照缓存生效后应为 0×）
  fiberReads = 0;
  trackEl.dispatch("pointermove", { clientX: 20 });
  assert.equal(fiberReads, 0, "同档位 pointermove 拖动期快照缓存应 0 次遍历 Fiber");
  assert.equal(rowDecorWrites, 0, "同档位移动不应重复写入面板模型行");

  // 重置 storage 计数器，继续拖动 29 次跨过 Medium -> High -> Low 再松手
  storageReads = 0;
  for (let i = 1; i <= 29; i += 1) {
    const x = i < 15 ? 14 + i * 13 : 200 - (i - 15) * 12;
    trackEl.dispatch("pointermove", { clientX: x });
  }
  trackEl.dispatch("pointerup", { clientX: 24 });
  env.flushRaf();

  assert.equal(offsetWidthReads, 0, "拖动全过程 popup.offsetWidth 强制回流读取必须为 0 次");
  assert.equal(valOffsetWidthReads, 0, "切档文本动效重播 valEl.offsetWidth 读取必须为 0 次");
  assert.equal(rectReads, 1, "30 次 pointermove 与 pointerup 期间不得重复读取 track getBoundingClientRect");
  assert.equal(storageReads, 0, "pointermove 与 pointerup 期间 localStorage.getItem 必须为 0 次");
  assert.ok(animPlayCount >= 1, "重复切档时应通过 Web Animations API 无回流重播动画");

  obs.stop();
});

test("14. 异步 ResizeObserver 单调锁宽与开菜单按需越界 resize", () => {
  // 1. 正常视口内：0 次 offsetWidth 读取、0 次全局 window.resize、ResizeObserver 单调锁宽 288 -> 270 -> 304
  const env = createPerfTestEnv({ withMO: true, withRO: true });
  let resizeDispatches = 0;
  env.win.addEventListener("resize", () => { resizeDispatches += 1; });

  let offsetWidthReads = 0;
  const popup = env.makeNode("div");
  popup.setAttribute("role", "menu");
  Object.defineProperty(popup, "offsetWidth", {
    get() {
      offsetWidthReads += 1;
      return 288;
    }
  });
  popup.getBoundingClientRect = () => ({ left: 20, top: 100, right: 308, bottom: 380, width: 288, height: 280 });

  const panel = env.makeNode("div");
  panel.setAttribute("data-testid", "model-selector-panel");
  panel.appendChild(env.makeNode("div"));
  popup.appendChild(panel);
  env.body.appendChild(popup);

  const optsList = [
    { label: "Gemini 4 Argon (Low)", value: 1 },
    { label: "Gemini 4 Argon (Medium)", value: 2 },
    { label: "Gemini 4 Argon (High)", value: 3 }
  ];
  panel.__reactFiber$ro = {
    memoizedProps: { open: true, setIsOpen() {}, setSelectedModel() {}, modelOptions: optsList, selectedModel: optsList[1] },
    return: null
  };

  const obs = slider.installAntigravityObserver({ document: env.doc, window: env.win });
  env.flushRaf();

  assert.equal(resizeDispatches, 0, "弹窗位于视口安全区内时不得派发全局 window.resize");
  assert.equal(offsetWidthReads, 0, "支持 ResizeObserver 时挂载首帧不得读取 popup.offsetWidth");

  const panelRO = env.roInstances.find((r) => r.targets.includes(popup));
  assert.ok(panelRO, "应对外层容器注册 ResizeObserver");
  panelRO.trigger(popup, 288, 280);
  assert.equal(popup.style.minWidth, "288px");
  panelRO.trigger(popup, 270, 280);
  assert.equal(popup.style.minWidth, "288px", "ResizeObserver 回调中宽度锁应单调不收缩");
  panelRO.trigger(popup, 304, 280);
  assert.equal(popup.style.minWidth, "304px", "出现更宽测量值时应单调扩大锁定");
  assert.equal(offsetWidthReads, 0, "ResizeObserver 单调锁宽全程不得读取 offsetWidth");
  obs.stop();

  // 2. 弹窗超出视口顶边 (top: -12)：首帧 rAF 仅按需派发 1 次 resize 兜底
  const oobEnv = createPerfTestEnv({ withMO: true, withRO: true });
  let oobResizeCount = 0;
  oobEnv.win.addEventListener("resize", () => { oobResizeCount += 1; });

  const oobPopup = oobEnv.makeNode("div");
  oobPopup.setAttribute("role", "menu");
  oobPopup.getBoundingClientRect = () => ({ left: 20, top: -12, right: 308, bottom: 268, width: 288, height: 280 });
  const oobPanel = oobEnv.makeNode("div");
  oobPanel.setAttribute("data-testid", "model-selector-panel");
  oobPanel.appendChild(oobEnv.makeNode("div"));
  oobPanel.__reactFiber$oob = {
    memoizedProps: { open: true, setIsOpen() {}, setSelectedModel() {}, modelOptions: optsList, selectedModel: optsList[1] },
    return: null
  };
  oobPopup.appendChild(oobPanel);
  oobEnv.body.appendChild(oobPopup);

  const oobObs = slider.installAntigravityObserver({ document: oobEnv.doc, window: oobEnv.win });
  assert.equal(oobResizeCount, 0, "挂载同步阶段不应直接派发 resize");
  oobEnv.flushRaf();
  assert.equal(oobResizeCount, 1, "视口越界时应在首帧 rAF 按需派发 1 次 resize 兜底");
  oobObs.stop();
});

test("15. CSS :has() 限定作用域与 Claude Canvas 60fps 零 Fiber/布局/样式读取", () => {
  // 1. CSS :has() 收窄校验
  const env = createPerfTestEnv({ withRO: true });
  const styleEl = slider.installStyles(env.doc);
  const groupMatches = styleEl.textContent.match(/^.*\[role='menuitem'\]:has\(\[data-testid='model-selector-effort-group'\]\).*$/gm) || [];
  assert.ok(groupMatches.length >= 3, "应包含模型行 :has() 稳态规则");
  for (const line of groupMatches) {
    assert.ok(line.includes(".ces-ag-panel-enhanced "), `模型行 :has() 规则必须限定在 .ces-ag-panel-enhanced 内: ${line}`);
  }

  // 2. Claude stepClaudeCanvas 60fps 帧循环解耦验证
  let snapshotReads = 0;
  let rectReads = 0;
  let computedStyleCalls = 0;
  let canvasDraws = 0;

  env.win.getComputedStyle = () => {
    computedStyleCalls += 1;
    return { backgroundColor: "rgb(20, 20, 24)" };
  };

  let claudeRafCb = null;
  env.win.requestAnimationFrame = (cb) => {
    claudeRafCb = cb;
    return 1;
  };
  env.win.cancelAnimationFrame = () => {
    claudeRafCb = null;
  };

  const origCreateElement = env.doc.createElement.bind(env.doc);
  env.doc.createElement = function (tag) {
    const el = origCreateElement(tag);
    if (String(tag).toLowerCase() === "canvas") {
      el.getContext = () => ({
        globalAlpha: 1,
        fillStyle: "",
        clearRect() {},
        fillRect() { canvasDraws += 1; },
        createLinearGradient() { return { addColorStop() {} }; },
        beginPath() {},
        moveTo() {},
        lineTo() {},
        quadraticCurveTo() {},
        closePath() {},
        fill() {}
      });
    }
    return el;
  };

  const container = env.makeNode("div");
  const seat = {
    getSnapshot() {
      snapshotReads += 1;
      return {
        baseName: "Claude Opus 5.5",
        isClaude: true,
        theme: "claude",
        locked: false,
        effortLevels: [
          { effort: "low", label: "Low" },
          { effort: "medium", label: "Medium" },
          { effort: "high", label: "High" }
        ],
        currentEffort: "high"
      };
    }
  };

  const mounted = slider.mountCodexEffortSlider({
    container,
    seat,
    document: env.doc,
    window: env.win
  });

  const trackEl = container.children[0].children[0];
  trackEl.getBoundingClientRect = () => {
    rectReads += 1;
    return { left: 0, top: 0, width: 228, height: 28 };
  };
  env.roInstances[0]?.trigger(trackEl, 228, 28);

  // 先推进首帧完成初始化样式缓存，再清零探针验证后续连续 10 帧零读取
  assert.ok(typeof claudeRafCb === "function", "应注册 Claude Canvas 首帧 rAF");
  const warmFn = claudeRafCb;
  claudeRafCb = null;
  warmFn(100);
  assert.equal(computedStyleCalls, 1, "无 dark/light 类时仅首帧懒读一次 getComputedStyle 并缓存");

  snapshotReads = 0;
  rectReads = 0;
  computedStyleCalls = 0;
  canvasDraws = 0;

  for (let frame = 1; frame <= 10; frame += 1) {
    assert.ok(typeof claudeRafCb === "function", `第 ${frame} 帧应注册下一帧 Claude Canvas rAF`);
    const fn = claudeRafCb;
    claudeRafCb = null;
    fn(100 + frame * 16);
  }

  assert.equal(snapshotReads, 0, "stepClaudeCanvas 60fps 循环期间绝不应读取 seat/Fiber 快照");
  assert.equal(rectReads, 0, "stepClaudeCanvas 60fps 循环期间绝不应重复读取 getBoundingClientRect");
  assert.equal(computedStyleCalls, 0, "stepClaudeCanvas 60fps 循环期间绝不应每帧调用 getComputedStyle");
  assert.equal(canvasDraws, 10, "10 帧动画应正常持续绘制 Claude 点阵");

  // 切换到 .dark 类后，即使跨过 500ms 缓存窗口也完全不调用 getComputedStyle
  env.doc.documentElement.classList.add("dark");
  const darkFn = claudeRafCb;
  claudeRafCb = null;
  darkFn(1000);
  assert.equal(computedStyleCalls, 0, "存在 dark 类时绝不应调用 getComputedStyle");

  mounted.unmount();
});

test("16. 复审三处修正：trigger-effort 外界改名可响应、Ctrl+C 闭菜单零 Fiber 扫描、面板重播不波及星尘", () => {
  // 1 & 2. 菜单关闭态：trigger-effort 外部变更应触发重着色，Ctrl+C 兜底快捷键应 0 次遍历 Fiber
  const env = createPerfTestEnv({ withMO: true, withRO: true });
  const triggerBtn = env.makeNode("button");
  triggerBtn.setAttribute("data-testid", "model-selector-trigger");
  const outerSpan = env.makeNode("span");
  outerSpan.classList.add("min-w-0");
  const effortSpan = env.makeNode("span");
  effortSpan.classList.add("opacity-70");
  effortSpan.textContent = " Medium";
  outerSpan.appendChild(effortSpan);
  triggerBtn.appendChild(outerSpan);
  env.body.appendChild(triggerBtn);

  const optsList = [
    { label: "Gemini 4 Argon (Low)", value: 1 },
    { label: "Gemini 4 Argon (Medium)", value: 2 },
    { label: "Gemini 4 Argon (High)", value: 3 }
  ];
  let selected = optsList[1];
  let fiberReads = 0;
  const triggerFiber = { return: null };
  Object.defineProperty(triggerFiber, "memoizedProps", {
    get() {
      fiberReads += 1;
      return {
        open: false,
        setIsOpen() {},
        setSelectedModel(opt) { selected = opt; },
        modelOptions: optsList,
        selectedModel: selected
      };
    }
  });
  triggerBtn.__reactFiber$fix = triggerFiber;

  const obs = slider.installAntigravityObserver({ document: env.doc, window: env.win });
  assert.equal(effortSpan.getAttribute("data-ces-part"), "trigger-effort");

  // 菜单关闭时按 Ctrl+C（未触碰 trigger），应 0 次触发 Fiber 遍历
  fiberReads = 0;
  env.doc.dispatchEvent({ type: "keydown", key: "c", ctrlKey: true, target: env.body });
  env.flushRaf();
  assert.equal(fiberReads, 0, "菜单关闭态按 Ctrl+C 等快捷组合键不应触发冗余 Fiber 遍历");

  // React 外部切会话导致 trigger-effort 内部文本变为 High，triggerObserver 必须不能误吞该变更
  selected = optsList[2];
  effortSpan.textContent = " High";
  const triggerMO = env.moInstances.find((o) => o.target === triggerBtn);
  assert.ok(triggerMO, "应存在 triggerObserver");
  triggerMO.trigger([{ type: "characterData", target: effortSpan }]);
  env.flushRaf();
  assert.equal(effortSpan.style.color, "#8b5cf6", "trigger-effort 外部变更应被捕获并重着色为 High 亮紫");
  obs.stop();

  // 3. 面板重播 ces-panel-shaking 不传 subtree: true 且绝不重启 22 颗星尘动画
  const shakeEnv = createPerfTestEnv();
  const panelEl = shakeEnv.makeNode("div");
  panelEl.setAttribute("data-testid", "model-selector-panel");
  const getAnimCalls = [];
  let shakeReplayed = 0;
  let starReplayed = 0;
  panelEl.getAnimations = (optsArg) => {
    getAnimCalls.push(optsArg);
    return [
      {
        animationName: "ces-panel-shake",
        cancel() {},
        play() { shakeReplayed += 1; }
      },
      {
        animationName: "ces-star-sweep",
        cancel() {},
        play() { starReplayed += 1; }
      },
      {
        animationName: "ces-sweep",
        cancel() {},
        play() { starReplayed += 1; }
      }
    ];
  };

  let effort = "medium";
  const container = shakeEnv.makeNode("div");
  const mounted = slider.mountCodexEffortSlider({
    container,
    panel: panelEl,
    seat: {
      effortLevels: [{ effort: "low", label: "Low" }, { effort: "medium", label: "Medium" }, { effort: "high", label: "High" }],
      get currentEffort() { return effort; },
      selectEffort(item) { effort = item.effort; }
    },
    document: shakeEnv.doc,
    window: shakeEnv.win
  });
  const trackEl = container.children[0].children[0];

  // 首次进 High -> 回退 Low -> 再次迅速进 High（验证 panelEl 重播路径）
  trackEl.dispatch("pointerdown", { clientX: 114 });
  trackEl.dispatch("pointermove", { clientX: 180 });
  assert.equal(panelEl.classList.contains("ces-panel-shaking"), true);
  // 模拟在 220ms 定时器清理前直接由外部状态重入或残留类名再触发
  panelEl.classList.add("ces-panel-shaking");
  trackEl.dispatch("pointermove", { clientX: 20 });
  panelEl.classList.add("ces-panel-shaking");
  trackEl.dispatch("pointermove", { clientX: 180 });

  assert.ok(getAnimCalls.length >= 1, "重复震颤时应调用 panelEl.getAnimations()");
  assert.equal(getAnimCalls[0], undefined, "panelEl.getAnimations() 不得传入 { subtree: true }");
  assert.equal(shakeReplayed, 1, "仅应重播 ces-panel-shake 动画");
  assert.equal(starReplayed, 0, "绝不应误重启面板内星尘与扫光动画");

  mounted.unmount();
});

test("17. 适配 Antigravity IDE 新版 slug 键 effortIndex（含 WeakMap 缓存、4档/3档解析、slug 兜底与点击切模型解锁）", () => {
  // 1. 构造贴合真实 IDE 探针的 slug 键 effortIndex 与 modelOptions（初始选中单档模型 GPT-OSS 120B (Medium)）
  const neonOpts = [
    { label: "Gemini 4 Neon (Low)", value: 101 },
    { label: "Gemini 4 Neon (Medium)", value: 102 },
    { label: "Gemini 4 Neon (High)", value: 103 },
    { label: "Gemini 4 Neon (XHigh)", value: 104 }
  ];
  const flashOpts = [
    { label: "Gemini 3.8 Flash (Low)", value: 201 },
    { label: "Gemini 3.8 Flash (Medium)", value: 202 },
    { label: "Gemini 3.8 Flash (High)", value: 203 }
  ];
  const claudeOpts = [
    { label: "Claude Opus 5.5 (Low)", value: 301 },
    { label: "Claude Opus 5.5 (Medium)", value: 302 },
    { label: "Claude Opus 5.5 (High)", value: 303 }
  ];
  const singleGpt = { label: "GPT-OSS 120B (Medium)", value: 401 };
  const orchestrator = { label: "Orchestrator (Neon)", value: 501 };

  const modelOptions = [...neonOpts, ...flashOpts, ...claudeOpts, singleGpt, orchestrator];
  const rawSlugEffortIndex = new Map([
    ["gemini-4-neon", new Map([
      ["low", neonOpts[0]],
      ["medium", neonOpts[1]],
      ["high", neonOpts[2]],
      ["xhigh", neonOpts[3]]
    ])],
    ["gemini-3.8-flash", new Map([
      ["low", flashOpts[0]],
      ["medium", flashOpts[1]],
      ["high", flashOpts[2]]
    ])],
    ["claude-opus-5-5", new Map([
      ["low", claudeOpts[0]],
      ["medium", claudeOpts[1]],
      ["high", claudeOpts[2]]
    ])]
  ]);

  let selectedModel = singleGpt;
  const commitCalls = [];
  const providerValue = {
    effortIndex: rawSlugEffortIndex,
    modelOptions,
    selectedModel,
    groups: [],
    open: true,
    setIsOpen() {},
    setSelectedModel(opt) { selectedModel = opt; }
  };
  const globalCtx = {
    visibleModelConfigs: modelOptions,
    currentModelConfig: selectedModel,
    setModelConfigByLabelForConversation(label, convId, persist) {
      commitCalls.push({ label, convId, persist });
      const hit = modelOptions.find((o) => o.label === label);
      if (hit) {
        selectedModel = hit;
        providerValue.selectedModel = hit;
        popoverFiber.memoizedProps.selectedModel = hit;
        globalCtx.currentModelConfig = hit;
      }
    }
  };
  const globalFiber = { memoizedProps: { value: globalCtx }, return: null };
  const convFiber = { memoizedProps: { conversationId: "conv-slug-test", placement: "top-start" }, return: globalFiber };
  const popoverFiber = {
    memoizedProps: {
      open: true,
      setIsOpen() {},
      setSelectedModel(opt) { selectedModel = opt; },
      modelOptions,
      selectedModel
    },
    return: convFiber
  };
  const providerFiber = { memoizedProps: { value: providerValue }, return: popoverFiber };

  const probeBtn = { __reactFiber$slug: providerFiber };
  const ctx1 = slider.readAntigravityFiberContext(probeBtn);
  const ctx2 = slider.readAntigravityFiberContext(probeBtn);
  assert.ok(ctx1 && ctx2);
  assert.equal(ctx1.effortIndex, ctx2.effortIndex, "相同 rawEffortIndex 与 modelOptions 应命中 WeakMap 返回同一引用");
  assert.equal(ctx1.effortIndex.get("Gemini 4 Neon").size, 4);
  assert.equal(ctx1.effortIndex.get("gemini-4-neon").size, 4);
  assert.equal(ctx1.effortIndex.get("Gemini 3.8 Flash").size, 3);
  assert.equal(ctx1.effortIndex.get("Claude Opus 5.5").size, 3);
  assert.equal(ctx1.effortIndex.get("GPT-OSS 120B").size, 1);

  const profNeon = slider.resolveModelEffortProfile(ctx1, "Gemini 4 Neon", new Map());
  assert.equal(profNeon.locked, false, "Gemini 4 Neon 不得被判定为锁定");
  assert.notEqual(profNeon.currentLabel, "固定");
  assert.deepEqual(profNeon.levels.map((l) => l.label), ["Low", "Medium", "High", "Extra"]);

  const profFlash = slider.resolveModelEffortProfile(ctx1, "Gemini 3.8 Flash", new Map());
  assert.equal(profFlash.locked, false);
  assert.equal(profFlash.levels.length, 3);

  const profClaude = slider.resolveModelEffortProfile(ctx1, "Claude Opus 5.5", new Map());
  assert.equal(profClaude.locked, false);
  assert.equal(profClaude.isClaude, true);
  assert.equal(profClaude.levels.length, 3);

  const profSingle = slider.resolveModelEffortProfile(ctx1, singleGpt, new Map());
  assert.equal(profSingle.locked, true, "单档模型 GPT-OSS 120B (Medium) 仍应锁定");
  assert.equal(profSingle.currentLabel, "Medium");

  // 2. 验证内层 opt.label 不含括号后缀时的末级 slug 兜底（保留小数点与全横杠双路径）
  const slugOnlyRaw = new Map([
    ["gemini-3.8-flash", new Map([
      ["low", { label: "Gemini 3.8 Flash", value: 21 }],
      ["medium", { label: "Gemini 3.8 Flash", value: 22 }],
      ["high", { label: "Gemini 3.8 Flash", value: 23 }]
    ])],
    ["claude-opus-5-5", new Map([
      ["low", { label: "Claude Opus 5.5", value: 31 }],
      ["medium", { label: "Claude Opus 5.5", value: 32 }],
      ["high", { label: "Claude Opus 5.5", value: 33 }]
    ])]
  ]);
  const fallbackCtx = {
    effortIndex: slugOnlyRaw,
    modelOptions: [],
    selectedModel: { label: "Claude Opus 5.5", value: 32 }
  };
  const fbFlash = slider.resolveModelEffortProfile(fallbackCtx, "Gemini 3.8 Flash", new Map());
  assert.equal(fbFlash.locked, false, "保留小数点 slug 兜底应命中 gemini-3.8-flash");
  assert.equal(fbFlash.levels.length, 3);
  const fbClaude = slider.resolveModelEffortProfile(fallbackCtx, "Claude Opus 5.5", new Map());
  assert.equal(fbClaude.locked, false, "全横杠 slug 兜底应命中 claude-opus-5-5");
  assert.equal(fbClaude.isClaude, true);
  assert.equal(fbClaude.levels.length, 3);

  // 3. 验证实际面板 DOM 同步与点击模型行切换解锁滑条
  const env = createPerfTestEnv({ withMO: true, withRO: true });
  const triggerBtn = env.makeNode("button");
  triggerBtn.setAttribute("data-testid", "model-selector-trigger");
  const outerSpan = env.makeNode("span");
  outerSpan.classList.add("min-w-0");
  const effortSpan = env.makeNode("span");
  effortSpan.classList.add("opacity-70");
  effortSpan.textContent = " Medium";
  outerSpan.appendChild(effortSpan);
  triggerBtn.appendChild(outerSpan);
  triggerBtn.__reactFiber$slug = providerFiber;
  env.body.appendChild(triggerBtn);

  const popup = env.makeNode("div");
  popup.setAttribute("role", "menu");
  const panel = env.makeNode("div");
  panel.setAttribute("data-testid", "model-selector-panel");
  panel.__reactFiber$slug = providerFiber;
  const listWrap = env.makeNode("div");

  function addGroupRow(base) {
    const item = env.makeNode("div");
    item.setAttribute("role", "menuitem");
    const gSpan = env.makeNode("span");
    gSpan.setAttribute("data-testid", "model-selector-effort-group");
    gSpan.setAttribute("data-model-base", base);
    gSpan.textContent = base;
    const sib = env.makeNode("span");
    sib.className = "shrink-0 opacity-70 text-xs";
    item.appendChild(gSpan);
    item.appendChild(sib);
    listWrap.appendChild(item);
    return { item, gSpan, sib };
  }

  const neonRow = addGroupRow("Gemini 4 Neon");
  const flashRow = addGroupRow("Gemini 3.8 Flash");
  const claudeRow = addGroupRow("Claude Opus 5.5");

  const gptItem = env.makeNode("div");
  gptItem.setAttribute("role", "menuitem");
  gptItem.setAttribute("data-testid", "model-selector-item");
  gptItem.setAttribute("data-model-label", "GPT-OSS 120B (Medium)");
  listWrap.appendChild(gptItem);

  panel.appendChild(listWrap);
  popup.appendChild(panel);
  env.body.appendChild(popup);

  const obs = slider.installAntigravityObserver({ document: env.doc, window: env.win });
  assert.equal(neonRow.sib.textContent, "Medium", "Gemini 4 Neon 不应显示「固定」");
  assert.equal(flashRow.sib.textContent, "Medium", "Gemini 3.8 Flash 不应显示「固定」");
  assert.equal(claudeRow.sib.textContent, "Medium", "Claude Opus 5.5 不应显示「固定」");

  const trackEl = panel.querySelector('[data-ces-part="track"]');
  const rootEl = panel.querySelector('[role="slider"]');
  assert.ok(trackEl && rootEl, "应成功挂载推理等级滑条");
  assert.equal(rootEl.getAttribute("aria-disabled"), "true", "初始选中单档 GPT-OSS 时滑条应为锁定状态");
  assert.equal(trackEl.classList.contains("is-locked"), true);

  // 点击 Gemini 4 Neon 列表行：应调用 setModelConfigByLabelForConversation 并立即解锁 4 档滑条
  panel.dispatch("click", { target: neonRow.gSpan });
  assert.equal(commitCalls.length, 1, "点击 Gemini 4 Neon 应触发模型切换提交");
  assert.deepEqual(commitCalls[0], {
    label: "Gemini 4 Neon (Medium)",
    convId: "conv-slug-test",
    persist: true
  });
  assert.equal(rootEl.getAttribute("aria-disabled"), "false", "切换到多档模型后滑条应立即解锁");
  assert.equal(trackEl.classList.contains("is-locked"), false);
  assert.equal(rootEl.getAttribute("aria-valuemax"), "3", "Gemini 4 Neon 应展示 4 档刻度 (0..3)");
  assert.equal(panel.querySelectorAll('[data-ces-part="tick"]').length, 4);

  obs.stop();
});

test("18. 2.34.0 Extra High 统一缩写解析、Orchestrator Fiber 上下文提取与规划器档位解析/提交", () => {
  // 1. Extra High 括号与无括号展示文案统一归并为 xhigh -> "Extra"
  assert.deepEqual(slider.parseModelLabel("Gemini 4 Neon (Extra High)"), {
    base: "Gemini 4 Neon",
    effort: "xhigh",
    effortLabel: "Extra"
  });
  assert.deepEqual(slider.parseModelDisplayText("Gemini 4 Neon Extra High"), {
    base: "Gemini 4 Neon",
    effort: "xhigh",
    effortLabel: "Extra"
  });
  assert.deepEqual(slider.parseModelDisplayText("Claude Opus 5.5 Medium"), {
    base: "Claude Opus 5.5",
    effort: "medium",
    effortLabel: "Medium"
  });

  // 2. Orchestrator 选项识别
  assert.equal(slider.isOrchestratorOption({ label: "Orchestrator", modelId: "gemini-pro-orchestrator", value: 1600 }), true);
  assert.equal(slider.isOrchestratorOption({ label: "Orchestrator", modelId: "gemini-pro-coordinator", value: 1601 }), true);
  assert.equal(slider.isOrchestratorOption({ label: "Gemini 4 Neon (High)", modelId: "gemini-4-neon-high", value: 1452 }), false);

  // 3. 构造 Antigravity 2.34.0 真实 Fiber 上下文（orchestratorPlanners / orchestratorPlannerIndex / orchestratorPick）
  const neonPlanners = [
    { label: "Gemini 4 Neon (Low)", modelId: "gemini-4-neon-low", value: 1450 },
    { label: "Gemini 4 Neon (Medium)", modelId: "gemini-4-neon-medium", value: 1451 },
    { label: "Gemini 4 Neon (High)", modelId: "gemini-4-neon-high", value: 1452 },
    { label: "Gemini 4 Neon (Extra High)", modelId: "gemini-4-neon-xhigh", value: 1453 }
  ];
  const argonPlanners = [
    { label: "Gemini 4 Argon (Low)", modelId: "gemini-4-argon-low", value: 1460 },
    { label: "Gemini 4 Argon (Medium)", modelId: "gemini-4-argon-medium", value: 1461 },
    { label: "Gemini 4 Argon (High)", modelId: "gemini-4-argon-high", value: 1462 }
  ];
  const claudePlanners = [
    { label: "Claude Opus 5.5 (Low)", modelId: "claude-opus-5-5-low", value: 1470 },
    { label: "Claude Opus 5.5 (Medium)", modelId: "claude-opus-5-5-medium", value: 1471 },
    { label: "Claude Opus 5.5 (High)", modelId: "claude-opus-5-5-high", value: 1472 }
  ];
  const orchOpt = { label: "Orchestrator", modelId: "gemini-pro-orchestrator", value: 1600 };
  const flashOpt = { label: "Gemini 3.8 Flash (Medium)", modelId: "gemini-3.8-flash-medium", value: 1321 };

  const orchestratorPlanners = [...neonPlanners, ...argonPlanners, ...claudePlanners];
  const orchestratorPlannerIndex = new Map([
    ["gemini-4-neon", new Map([
      ["low", neonPlanners[0]],
      ["medium", neonPlanners[1]],
      ["high", neonPlanners[2]],
      ["xhigh", neonPlanners[3]]
    ])],
    ["gemini-4-argon", new Map([
      ["low", argonPlanners[0]],
      ["medium", argonPlanners[1]],
      ["high", argonPlanners[2]]
    ])],
    ["claude-opus-5-5", new Map([
      ["low", claudePlanners[0]],
      ["medium", claudePlanners[1]],
      ["high", claudePlanners[2]]
    ])]
  ]);

  const orchPickCalls = [];
  const modelSelectCalls = [];
  const setIsOpenCalls = [];
  let currentOrchVal = 1453; // Neon Extra High
  const orchestratorPick = {
    get model() { return currentOrchVal; },
    select(val) {
      orchPickCalls.push(val);
      currentOrchVal = val;
    }
  };

  const modelOptions = [orchOpt, ...neonPlanners, flashOpt, ...claudePlanners];
  const effortIndex = new Map([
    ["gemini-4-neon", new Map([
      ["low", neonPlanners[0]],
      ["medium", neonPlanners[1]],
      ["high", neonPlanners[2]],
      ["xhigh", neonPlanners[3]]
    ])],
    ["claude-opus-5-5", new Map([
      ["low", claudePlanners[0]],
      ["medium", claudePlanners[1]],
      ["high", claudePlanners[2]]
    ])]
  ]);

  const providerValue = {
    effortIndex,
    modelOptions,
    selectedModel: orchOpt,
    groups: [],
    orchestratorPlanners,
    orchestratorPlannerIndex,
    orchestratorDefaultPlanner: neonPlanners[3],
    orchestratorPick
  };
  const outerPopoverFiber = {
    memoizedProps: {
      open: true,
      setIsOpen(v) { setIsOpenCalls.push(v); },
      setSelectedModel(opt) { modelSelectCalls.push(opt); },
      modelOptions,
      selectedModel: orchOpt,
      orchestratorPick
    },
    return: { memoizedProps: { conversationId: "conv-orch-234", placement: "top-start" }, return: null }
  };
  const innerPopoverFiber = {
    memoizedProps: {
      open: true,
      setIsOpen(v) { setIsOpenCalls.push(v); },
      setSelectedModel(opt) { modelSelectCalls.push(opt); setIsOpenCalls.push(false); },
      modelOptions,
      selectedModel: orchOpt
    },
    return: outerPopoverFiber
  };
  const providerFiber = { memoizedProps: { value: providerValue }, return: innerPopoverFiber };

  const ctx = slider.readAntigravityFiberContext({ __reactFiber$orch: providerFiber });
  assert.ok(ctx);
  assert.equal(ctx.hasOrchestratorPlanners, true);
  assert.equal(ctx.isOrchestratorSelected, true);
  assert.equal(ctx.orchestratorPlanners.length, 10);
  assert.equal(ctx.orchestratorModelOption.value, 1600);
  assert.equal(ctx.orchestratorPlannerIndex.get("Gemini 4 Neon").size, 4);

  // 通过 resolveModelEffortProfile 统一解析当前选中的 Orchestrator 规划器
  const profActive = slider.resolveModelEffortProfile(ctx, orchOpt, new Map(), new Map());
  assert.equal(profActive.isOrchestrator, true);
  assert.equal(profActive.baseName, "Gemini 4 Neon");
  assert.equal(profActive.locked, false);
  assert.equal(profActive.isClaude, false);
  assert.equal(profActive.theme, "codex");
  assert.deepEqual(profActive.levels.map((l) => l.label), ["Low", "Medium", "High", "Extra"]);
  assert.equal(profActive.currentIndex, 3);
  assert.equal(profActive.currentLabel, "Extra");

  // 切到 Claude Opus 5.5 规划器应自动使用 claude 主题
  const profClaudeOrch = slider.resolveOrchestratorPlannerProfile(ctx, "Claude Opus 5.5", new Map());
  assert.equal(profClaudeOrch.isOrchestrator, true);
  assert.equal(profClaudeOrch.isClaude, true);
  assert.equal(profClaudeOrch.theme, "claude");
  assert.equal(profClaudeOrch.levels.length, 3);
  assert.equal(profClaudeOrch.currentLabel, "Medium");

  // 当 orchestratorPick.model 为 0 (UNSPECIFIED) 时，应能从 DOM 兜底反查用户在全局 Settings 修改的默认规划器
  currentOrchVal = 0;
  const env = createPerfTestEnv();
  const orchModelEl = env.makeNode("span");
  orchModelEl.setAttribute("data-testid", "model-selector-orchestrator-model");
  orchModelEl.textContent = "Claude Opus 5.5 High";
  env.body.appendChild(orchModelEl);
  const resolvedDomPlanner = slider.resolveCurrentOrchestratorPlanner(ctx, env.doc);
  assert.equal(resolvedDomPlanner.value, 1472, "UNSPECIFIED 时应能从 DOM 反查全局设定的 Claude Opus 5.5 High");

  // 提交规划器：已选中 Orchestrator 时仅调用 orchestratorPick.select，不重复触发 setSelectedModel
  slider.commitOrchestratorPlannerOption(ctx, argonPlanners[2], false);
  assert.deepEqual(orchPickCalls, [1462]);
  assert.equal(modelSelectCalls.length, 0);

  // 未选中 Orchestrator 时传入 ensureOrchestratorSelected = true，同时切换到 Orchestrator 且不关菜单
  slider.commitOrchestratorPlannerOption(ctx, claudePlanners[1], true);
  assert.deepEqual(orchPickCalls, [1462, 1471]);
  assert.equal(modelSelectCalls.length, 1);
  assert.equal(modelSelectCalls[0].value, 1600);
  assert.ok(!setIsOpenCalls.includes(false), "提交 Orchestrator 不得关闭菜单");
});

test("19. Orchestrator 全链路交互：主行与二级子菜单拦截、第 3 级屏蔽、副标题、仅末尾着色及独立档位记忆", () => {
  const env = createPerfTestEnv({ withMO: true, withRO: true });

  // 1. 样式规则校验：屏蔽第 3 级档位菜单，保留第 2 级，不隐藏主行箭头
  const styleEl = slider.installStyles(env.doc);
  const css = styleEl.textContent;
  assert.ok(
    css.includes("[role='menu']:has([data-testid='orchestrator-picker-effort']):not(:has([data-testid='model-selector-panel'])):not(:has([data-testid='orchestrator-picker-row']))"),
    "CSS 必须屏蔽第 3 级 orchestrator-picker-effort 子菜单并保护主面板及第 2 级子菜单"
  );
  assert.ok(css.includes(".ces-ag-orch-submenu [data-testid='orchestrator-picker-row']"), "CSS 应接管第 2 级子菜单稳态 √ 与等宽占位");
  assert.ok(!css.includes("model-selector-orchestrator'] > span:first-child + span.shrink-0"), "不得隐藏 Orchestrator 主行右侧 › 箭头");

  // 2. 构造完整 2.34.0 DOM（触发按钮 + 主面板 + 独立 Portal 二级子菜单）
  const neonPlanners = [
    { label: "Gemini 4 Neon (Low)", modelId: "gemini-4-neon-low", value: 1450 },
    { label: "Gemini 4 Neon (Medium)", modelId: "gemini-4-neon-medium", value: 1451 },
    { label: "Gemini 4 Neon (High)", modelId: "gemini-4-neon-high", value: 1452 },
    { label: "Gemini 4 Neon (Extra High)", modelId: "gemini-4-neon-xhigh", value: 1453 }
  ];
  const argonPlanners = [
    { label: "Gemini 4 Argon (Low)", modelId: "gemini-4-argon-low", value: 1460 },
    { label: "Gemini 4 Argon (Medium)", modelId: "gemini-4-argon-medium", value: 1461 },
    { label: "Gemini 4 Argon (High)", modelId: "gemini-4-argon-high", value: 1462 }
  ];
  const claudePlanners = [
    { label: "Claude Opus 5.5 (Low)", modelId: "claude-opus-5-5-low", value: 1470 },
    { label: "Claude Opus 5.5 (Medium)", modelId: "claude-opus-5-5-medium", value: 1471 },
    { label: "Claude Opus 5.5 (High)", modelId: "claude-opus-5-5-high", value: 1472 }
  ];
  const flashOpts = [
    { label: "Gemini 3.8 Flash (Low)", modelId: "gemini-3.8-flash-low", value: 1320 },
    { label: "Gemini 3.8 Flash (Medium)", modelId: "gemini-3.8-flash-medium", value: 1321 },
    { label: "Gemini 3.8 Flash (High)", modelId: "gemini-3.8-flash-high", value: 1322 }
  ];
  const orchOpt = { label: "Orchestrator", modelId: "gemini-pro-orchestrator", value: 1600 };

  const modelOptions = [orchOpt, ...neonPlanners, ...flashOpts, ...claudePlanners];
  const orchestratorPlanners = [...neonPlanners, ...argonPlanners, ...claudePlanners];
  const effortIndex = new Map([
    ["gemini-4-neon", new Map([["low", neonPlanners[0]], ["medium", neonPlanners[1]], ["high", neonPlanners[2]], ["xhigh", neonPlanners[3]]])],
    ["gemini-3.8-flash", new Map([["low", flashOpts[0]], ["medium", flashOpts[1]], ["high", flashOpts[2]]])],
    ["claude-opus-5-5", new Map([["low", claudePlanners[0]], ["medium", claudePlanners[1]], ["high", claudePlanners[2]]])]
  ]);
  const orchestratorPlannerIndex = new Map([
    ["gemini-4-neon", new Map([["low", neonPlanners[0]], ["medium", neonPlanners[1]], ["high", neonPlanners[2]], ["xhigh", neonPlanners[3]]])],
    ["gemini-4-argon", new Map([["low", argonPlanners[0]], ["medium", argonPlanners[1]], ["high", argonPlanners[2]]])],
    ["claude-opus-5-5", new Map([["low", claudePlanners[0]], ["medium", claudePlanners[1]], ["high", claudePlanners[2]]])]
  ]);

  let isMenuOpen = true;
  let selectedModel = flashOpts[1]; // 初始选中普通模型 Gemini 3.8 Flash (Medium)
  let orchModelVal = 0; // UNSPECIFIED -> 默认 Neon Extra High
  const orchSelectCalls = [];
  const modelSelectCalls = [];

  const orchestratorPick = {
    get model() { return orchModelVal; },
    select(val) {
      orchSelectCalls.push(val);
      orchModelVal = val;
    }
  };
  const providerValue = {
    effortIndex,
    modelOptions,
    get selectedModel() { return selectedModel; },
    groups: [],
    orchestratorPlanners,
    orchestratorPlannerIndex,
    orchestratorDefaultPlanner: neonPlanners[3],
    orchestratorPick
  };
  const popoverFiber = {
    memoizedProps: {
      get open() { return isMenuOpen; },
      setIsOpen(v) { isMenuOpen = v; },
      setSelectedModel(opt) {
        modelSelectCalls.push(opt.label);
        selectedModel = opt;
      },
      modelOptions,
      get selectedModel() { return selectedModel; },
      orchestratorPick
    },
    return: { memoizedProps: { conversationId: "conv-orch-ui", placement: "top-start" }, return: null }
  };
  const providerFiber = { memoizedProps: { value: providerValue }, return: popoverFiber };

  const triggerBtn = env.makeNode("button");
  triggerBtn.setAttribute("data-testid", "model-selector-trigger");
  const trigOuterSpan = env.makeNode("span");
  trigOuterSpan.classList.add("min-w-0");
  const trigMainText = { nodeType: 3, nodeValue: "Gemini 3.8 Flash" };
  Object.defineProperty(trigOuterSpan, "firstChild", { get() { return trigMainText; } });
  const trigEffSpan = env.makeNode("span");
  trigEffSpan.classList.add("opacity-70");
  trigEffSpan.textContent = " Medium";
  trigOuterSpan.appendChild(trigEffSpan);
  triggerBtn.appendChild(trigOuterSpan);
  triggerBtn.__reactFiber$orch = providerFiber;
  env.body.appendChild(triggerBtn);

  const popup = env.makeNode("div");
  popup.setAttribute("role", "menu");
  const panel = env.makeNode("div");
  panel.setAttribute("data-testid", "model-selector-panel");
  panel.__reactFiber$orch = providerFiber;
  const listWrap = env.makeNode("div");

  // 主菜单 Orchestrator 行
  const orchRow = env.makeNode("div");
  orchRow.setAttribute("role", "menuitem");
  orchRow.setAttribute("data-testid", "model-selector-orchestrator");
  orchRow.setAttribute("data-model-label", "Orchestrator");
  const orchRowLeft = env.makeNode("span");
  const orchNameLabel = env.makeNode("span");
  orchNameLabel.textContent = "Orchestrator";
  const orchModelSpan = env.makeNode("span");
  orchModelSpan.setAttribute("data-testid", "model-selector-orchestrator-model");
  orchModelSpan.className = "min-w-0 truncate opacity-70 text-sm";
  orchModelSpan.textContent = "Gemini 4 Neon Extra High";
  orchRowLeft.appendChild(orchNameLabel);
  orchRowLeft.appendChild(orchModelSpan);
  orchRow.appendChild(orchRowLeft);
  listWrap.appendChild(orchRow);

  function addGroupRow(base) {
    const item = env.makeNode("div");
    item.setAttribute("role", "menuitem");
    const gSpan = env.makeNode("span");
    gSpan.setAttribute("data-testid", "model-selector-effort-group");
    gSpan.setAttribute("data-model-base", base);
    gSpan.textContent = base;
    const sib = env.makeNode("span");
    sib.className = "shrink-0 opacity-70 text-xs";
    item.appendChild(gSpan);
    item.appendChild(sib);
    listWrap.appendChild(item);
    return { item, gSpan, sib };
  }
  const neonRow = addGroupRow("Gemini 4 Neon");
  const flashRow = addGroupRow("Gemini 3.8 Flash");
  const claudeRow = addGroupRow("Claude Opus 5.5");

  panel.appendChild(listWrap);
  popup.appendChild(panel);
  env.body.appendChild(popup);

  const obs = slider.installAntigravityObserver({ document: env.doc, window: env.win });

  // 验证初始渲染：Orchestrator 主行已拆分为柔和名 + 亮紫 Extra；主列表选中 Flash
  assert.equal(orchRow.getAttribute("data-ces-model-selected"), "false");
  assert.equal(flashRow.item.getAttribute("data-ces-model-selected"), "true");
  const initOrchNamePart = orchModelSpan.querySelector('[data-ces-part="orch-model-name"]');
  const initOrchEffPart = orchModelSpan.querySelector('[data-ces-part="orch-effort"]');
  assert.equal(initOrchNamePart.textContent, "Gemini 4 Neon ");
  assert.equal(initOrchNamePart.style.opacity, "0.7");
  assert.equal(initOrchEffPart.textContent, "Extra");
  assert.equal(initOrchEffPart.style.color, "#8b5cf6");

  const rootEl = panel.querySelector('[role="slider"]');
  const subtitleEl = panel.querySelector('[data-ces-part="subtitle"]');
  assert.equal(subtitleEl.style.display, "none", "普通模型下副标题应隐藏");

  // 3. 点击主菜单 Orchestrator 行：保持菜单常开，切换为 Orchestrator (Neon Extra)，仅末尾 Extra 着色，普通 Neon 行不高亮
  panel.dispatch("click", { target: orchRow });
  assert.equal(isMenuOpen, true, "点击 Orchestrator 不得关闭菜单");
  assert.deepEqual(modelSelectCalls, ["Orchestrator"]);
  assert.equal(orchRow.getAttribute("data-ces-model-selected"), "true");
  assert.equal(neonRow.item.getAttribute("data-ces-model-selected"), "false", "主列表同名 Gemini 4 Neon 不得与 Orchestrator 同时高亮");
  assert.equal(subtitleEl.textContent, "· Gemini 4 Neon");
  assert.equal(subtitleEl.style.display, "");
  assert.equal(rootEl.getAttribute("data-theme"), "codex");
  assert.equal(rootEl.getAttribute("aria-valuemax"), "3", "Neon 规划器应具备 4 档刻度 (0..3)");
  assert.equal(trigMainText.nodeValue, "Orchestrator");
  assert.equal(trigEffSpan.querySelector('[data-ces-part="trigger-orch-name"]').textContent, " Gemini 4 Neon ");
  assert.equal(trigEffSpan.querySelector('[data-ces-part="trigger-orch-name"]').style.opacity, "0.7");
  assert.equal(trigEffSpan.querySelector('[data-ces-part="trigger-orch-effort"]').textContent, "Extra");
  assert.equal(trigEffSpan.querySelector('[data-ces-part="trigger-orch-effort"]').style.color, "#8b5cf6");

  // 4. 打开右侧二级子菜单（模拟 Portal 挂载到 body），验证装扮与点击切换 Claude Opus 5.5
  const orchSubmenu = env.makeNode("div");
  orchSubmenu.setAttribute("role", "menu");
  function addOrchPickerRow(base, rawText) {
    const r = env.makeNode("div");
    r.setAttribute("role", "menuitem");
    r.setAttribute("data-testid", "orchestrator-picker-row");
    r.setAttribute("data-model-base", base);
    const wrap = env.makeNode("span");
    const nameS = env.makeNode("span");
    nameS.textContent = base;
    const effS = env.makeNode("span");
    effS.className = "shrink-0 opacity-70";
    effS.textContent = rawText;
    wrap.appendChild(nameS);
    wrap.appendChild(effS);
    r.appendChild(wrap);
    orchSubmenu.appendChild(r);
    return { row: r, effS };
  }
  const subNeon = addOrchPickerRow("Gemini 4 Neon", "Extra High");
  const subArgon = addOrchPickerRow("Gemini 4 Argon", "Medium");
  const subClaude = addOrchPickerRow("Claude Opus 5.5", "Medium");
  env.body.appendChild(orchSubmenu);

  const bodyMO = env.moInstances.find((o) => o.target === env.body);
  bodyMO.trigger([{ type: "childList", target: env.body, addedNodes: [orchSubmenu], removedNodes: [] }]);
  env.flushRaf();

  assert.equal(orchSubmenu.classList.contains("ces-ag-orch-submenu"), true);
  assert.equal(subNeon.row.getAttribute("data-ces-model-selected"), "true");
  assert.equal(subNeon.effS.textContent, "Extra", "二级子菜单中 Extra High 应统一显示为 Extra");
  assert.equal(subNeon.effS.style.color, "#8b5cf6");
  assert.equal(subClaude.effS.style.color, "#a78bfa");

  // 点击二级子菜单中的 Claude Opus 5.5：不关菜单、切换主题为 claude、副标题切为 · Claude Opus 5.5
  orchSubmenu.dispatch("pointerup", { target: subClaude.effS });
  orchSubmenu.dispatch("click", { target: subClaude.effS });
  assert.equal(isMenuOpen, true, "点击二级子菜单规划器不得关闭菜单");
  assert.deepEqual(orchSelectCalls, [1471]);
  assert.equal(rootEl.getAttribute("data-theme"), "claude");
  assert.equal(rootEl.getAttribute("aria-valuemax"), "2", "Claude Opus 5.5 规划器应具备 3 档刻度 (0..2)");
  assert.equal(subtitleEl.textContent, "· Claude Opus 5.5");
  assert.equal(subClaude.row.getAttribute("data-ces-model-selected"), "true");
  assert.equal(subNeon.row.getAttribute("data-ces-model-selected"), "false");
  assert.equal(orchModelSpan.querySelector('[data-ces-part="orch-model-name"]').textContent, "Claude Opus 5.5 ");
  assert.equal(orchModelSpan.querySelector('[data-ces-part="orch-effort"]').textContent, "Medium");
  assert.equal(orchModelSpan.querySelector('[data-ces-part="orch-effort"]').style.color, "#a78bfa");
  assert.equal(trigEffSpan.querySelector('[data-ces-part="trigger-orch-effort"]').style.color, "#a78bfa");

  // 5. 在 Orchestrator -> Claude Opus 5.5 下拖动滑条到 High，验证只调 orchestratorPick.select，且与主列表普通 Claude Opus 5.5 记忆独立
  const trackEl = panel.querySelector('[data-ces-part="track"]');
  trackEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 228, bottom: 28, width: 228, height: 28 });
  const prevModelCalls = modelSelectCalls.length;
  trackEl.dispatch("pointerdown", { clientX: 114 });
  trackEl.dispatch("pointermove", { clientX: 200 });
  trackEl.dispatch("pointerup", { clientX: 200 });
  assert.equal(orchSelectCalls[orchSelectCalls.length - 1], 1472, "拖动 Orchestrator 滑条应提交 Claude Opus 5.5 (High)");
  assert.equal(modelSelectCalls.length, prevModelCalls, "已在 Orchestrator 模式下调档不应重复调用 setSelectedModel");
  assert.equal(orchModelSpan.querySelector('[data-ces-part="orch-effort"]').textContent, "High");
  assert.equal(orchModelSpan.querySelector('[data-ces-part="orch-effort"]').style.color, "#c4b5fd");

  // 切换到主列表普通 Claude Opus 5.5：验证普通模型保持独立记忆 (Medium)，且副标题隐藏
  panel.dispatch("click", { target: claudeRow.gSpan });
  assert.equal(selectedModel.label, "Claude Opus 5.5 (Medium)", "主列表普通 Claude Opus 5.5 应保持独立记忆 Medium，不受 Orchestrator High 污染");
  assert.equal(subtitleEl.style.display, "none", "切回普通模型后副标题应隐藏");
  assert.equal(claudeRow.item.getAttribute("data-ces-model-selected"), "true");
  assert.equal(orchRow.getAttribute("data-ces-model-selected"), "false");
  assert.equal(trigMainText.nodeValue, "Claude Opus 5.5");

  // 再次点回 Orchestrator：验证恢复独立记忆的 Claude Opus 5.5 High 与副标题
  panel.dispatch("click", { target: orchRow });
  assert.equal(subtitleEl.textContent, "· Claude Opus 5.5");
  assert.equal(orchModelSpan.querySelector('[data-ces-part="orch-effort"]').textContent, "High");
  assert.equal(orchRow.getAttribute("data-ces-model-selected"), "true");
  assert.equal(claudeRow.item.getAttribute("data-ces-model-selected"), "false");

  // 关闭二级子菜单与主面板：观察器全部断开，bodyPortalObserver 始终保持 1 个
  assert.equal(env.moInstances.filter((o) => o.target === env.body).length, 1);
  const subMO = env.moInstances.find((o) => o.target === orchSubmenu);
  assert.ok(subMO && !subMO.disconnected);
  env.body.removeChild(orchSubmenu);
  bodyMO.trigger([{ type: "childList", target: env.body, addedNodes: [], removedNodes: [orchSubmenu] }]);
  env.flushRaf();
  assert.equal(subMO.disconnected, true, "关闭二级子菜单后应立刻断开 orchSubmenuObserver");

  obs.stop();
});

test("20. 鼠标直接点击轨道平滑滑行与星尘渐亮、3px 防抖、拖动 1:1 衔接及简洁模式直跳 (Issue #3)", () => {
  assert.equal(slider.DRAG_THRESHOLD_PX, 3);

  function setupClickEnv(motionSetting) {
    const env = createPerfTestEnv({
      settingsJson: JSON.stringify({ v: 1, motion: motionSetting, ticks: "highlight" })
    });
    let frameTime = 1000;
    let rafId = 1;
    let pendingRafs = [];
    env.win.performance = { now: () => frameTime };
    env.win.requestAnimationFrame = (cb) => {
      const id = rafId++;
      pendingRafs.push({ id, cb });
      return id;
    };
    env.win.cancelAnimationFrame = (id) => {
      pendingRafs = pendingRafs.filter((item) => item.id !== id);
    };
    function stepOneFrame(dtMs = 16) {
      if (pendingRafs.length === 0) return false;
      frameTime += dtMs;
      const batch = pendingRafs.splice(0, pendingRafs.length);
      for (const item of batch) item.cb(frameTime);
      return true;
    }

    let currentEffort = "low";
    const commits = [];
    const seat = {
      effortLevels: [
        { effort: "low", label: "Low" },
        { effort: "medium", label: "Medium" },
        { effort: "high", label: "High" }
      ],
      get currentEffort() { return currentEffort; },
      selectEffort(item, idx) {
        currentEffort = item.effort;
        commits.push({ effort: currentEffort, index: idx });
      }
    };
    const panel = env.makeNode("div");
    panel.setAttribute("data-testid", "model-selector-panel");
    const valEl = env.makeNode("span");
    valEl.className = "ces-ag-effort-value";
    const container = env.makeNode("div");

    const mounted = slider.mountCodexEffortSlider({
      container,
      panel,
      valueElement: valEl,
      seat,
      document: env.doc,
      window: env.win
    });
    const trackEl = container.children[0].children[0];
    const starsEl = trackEl.querySelector('[data-ces-part="stars"]');
    // track width=228, KNOB_RADIUS=14 => usable 14..214 (Low=14, Medium=114, High=214)
    return {
      env,
      trackEl,
      starsEl,
      commits,
      mounted,
      getCurrentEffort: () => currentEffort,
      getFill: () => trackEl.style.getPropertyValue("--ces-fill"),
      getStarCount: () => Number(starsEl.getAttribute("data-count") || "0"),
      pendingCount: () => pendingRafs.length,
      stepOneFrame
    };
  }

  // 1. full 完整动画模式：直接点击 High (clientX=214)，不瞬移，经 2px 微抖与松手后仍平滑滑行并伴随星尘渐亮
  const full = setupClickEnv("full");
  assert.equal(full.getFill(), slider.knobOffsetOf(0, 14));
  assert.equal(full.getStarCount(), 0);

  full.trackEl.dispatch("pointerdown", { clientX: 214 });
  assert.equal(full.commits.length, 1);
  assert.equal(full.getCurrentEffort(), "high", "按下时立即提交真实档位 high");
  assert.equal(full.getFill(), slider.knobOffsetOf(0, 14), "full 模式点击按下不得瞬间跳到 100%");
  assert.equal(full.getStarCount(), 0, "星尘不得在按下瞬间直接点亮 22 颗");
  assert.ok(full.pendingCount() > 0, "应启动 rAF 物理滑行循环");

  // 2px 轻微手抖 (< 3px 阈值)：不应切入拖动瞬移，不打断滑行
  full.trackEl.dispatch("pointermove", { clientX: 212 });
  assert.equal(full.getFill(), slider.knobOffsetOf(0, 14), "小于 3px 的抖动不得触发 1:1 瞬移");

  // 松手：endDrag 不得把圆钮瞬移到 100%
  full.trackEl.dispatch("pointerup", { clientX: 212 });
  assert.equal(full.getFill(), slider.knobOffsetOf(0, 14), "纯点击松手不得覆写 m.x 为 ptrPct");

  const fillTrace = [];
  const starTrace = [];
  for (let i = 0; i < 60 && full.pendingCount() > 0; i += 1) {
    full.stepOneFrame(16);
    fillTrace.push(full.getFill());
    starTrace.push(full.getStarCount());
  }
  assert.ok(fillTrace.length >= 5, `full 模式应经历多帧平滑滑行 (实际 ${fillTrace.length} 帧)`);
  assert.equal(fillTrace[fillTrace.length - 1], slider.knobOffsetOf(1, 14), "最终应收敛到 100%");
  assert.ok(
    starTrace.some((c) => c > 0 && c < 22),
    `星尘数量应随滑行过程渐亮 (轨迹: ${starTrace.join(",")})`
  );
  assert.equal(starTrace[starTrace.length - 1], 22, "到达 High 时 22 颗星尘全部点亮");

  // 2. 滑行中途反向点击：从 Low 点 High 滑到一半直接点回 Low，应从中间位置平滑折返
  full.trackEl.dispatch("pointerdown", { clientX: 14 });
  full.trackEl.dispatch("pointerup", { clientX: 14 });
  for (let i = 0; i < 60 && full.pendingCount() > 0; i += 1) full.stepOneFrame(16);
  assert.equal(full.getFill(), slider.knobOffsetOf(0, 14));

  full.trackEl.dispatch("pointerdown", { clientX: 214 });
  full.trackEl.dispatch("pointerup", { clientX: 214 });
  for (let i = 0; i < 8; i += 1) full.stepOneFrame(16);
  const midFill = full.getFill();
  assert.notEqual(midFill, slider.knobOffsetOf(0, 14));
  assert.notEqual(midFill, slider.knobOffsetOf(1, 14));
  // 途中点回 Low：不瞬移回 0，从 midFill 继续平滑折返
  full.trackEl.dispatch("pointerdown", { clientX: 14 });
  assert.equal(full.getCurrentEffort(), "low");
  assert.equal(full.getFill(), midFill, "途中反向点击应从当前位置折返而非瞬移");
  full.trackEl.dispatch("pointerup", { clientX: 14 });
  for (let i = 0; i < 60 && full.pendingCount() > 0; i += 1) full.stepOneFrame(16);
  assert.equal(full.getFill(), slider.knobOffsetOf(0, 14));
  full.mounted.unmount();

  // 3. fast 快速动画模式：直接点击 High，同样触发平滑滑行并在短帧内收敛
  const fast = setupClickEnv("fast");
  fast.trackEl.dispatch("pointerdown", { clientX: 214 });
  assert.equal(fast.getCurrentEffort(), "high");
  assert.equal(fast.getFill(), slider.knobOffsetOf(0, 14), "fast 模式点击同样从原位启动滑行而非瞬跳");
  fast.trackEl.dispatch("pointerup", { clientX: 214 });
  let fastFrames = 0;
  while (fast.pendingCount() > 0 && fastFrames < 30) {
    fast.stepOneFrame(16);
    fastFrames += 1;
  }
  assert.ok(fastFrames >= 2 && fastFrames <= 15, `fast 模式应在短帧内平滑收敛 (frames=${fastFrames})`);
  assert.equal(fast.getFill(), slider.knobOffsetOf(1, 14));
  fast.mounted.unmount();

  // 4. quick 简洁动画模式：直接点击 High 应立即无过渡瞬跳
  const quick = setupClickEnv("quick");
  quick.trackEl.dispatch("pointerdown", { clientX: 214 });
  assert.equal(quick.getCurrentEffort(), "high");
  assert.equal(quick.getFill(), slider.knobOffsetOf(1, 14), "quick 简洁模式点击应立即跳至目标档位");
  assert.equal(quick.pendingCount(), 0, "quick 模式不应启动动画帧循环");
  quick.trackEl.dispatch("pointerup", { clientX: 214 });
  quick.mounted.unmount();

  // 5. 按下后真实拖动 (>= 3px)：立刻切入 1:1 实时跟手，松手后磁吸至档位圆心
  const dragCase = setupClickEnv("full");
  dragCase.trackEl.dispatch("pointerdown", { clientX: 14 });
  dragCase.trackEl.dispatch("pointermove", { clientX: 134 }); // 60% 位置 (14 + 120)
  assert.equal(dragCase.getCurrentEffort(), "medium");
  assert.equal(dragCase.getFill(), slider.knobOffsetOf(0.6, 14), "位移 >= 3px 后应立刻 1:1 跟随指针");
  dragCase.trackEl.dispatch("pointerup", { clientX: 134 });
  for (let i = 0; i < 60 && dragCase.pendingCount() > 0; i += 1) dragCase.stepOneFrame(16);
  assert.equal(dragCase.getFill(), slider.knobOffsetOf(0.5, 14), "松手后磁吸回 Medium 圆心");
  dragCase.mounted.unmount();
});

test("21. 默认完整动画、Issue #1 收尾（Fiber 截断/拖动快照缓存/星尘零重排）与废弃代码清理验证", () => {
  // 1. 默认动画为 full 且位于设置面板首位；老用户已存 fast 保持不被覆写
  assert.equal(slider.SETTINGS_SCHEMA[0].defaultValue, "full");
  assert.equal(slider.SETTINGS_SCHEMA[0].options[0].value, "full");
  assert.deepEqual(slider.schemaDefaults(), { v: 1, motion: "full", ticks: "highlight" });
  assert.equal(slider.motionMode({ localStorage: { getItem: () => null } }), "full");

  const legacyStore = new Map([
    ["dsh.codexEffortSlider.settings.v1", JSON.stringify({ v: 1, motion: "quick", ticks: "hidden" })]
  ]);
  const legacyWin = {
    localStorage: {
      getItem: (k) => (legacyStore.has(k) ? legacyStore.get(k) : null),
      setItem: (k, v) => legacyStore.set(k, v)
    }
  };
  assert.equal(slider.readSettings(legacyWin).motion, "full", "不再回退读取已弃用的 dsh 存储键");
  assert.equal(slider.normalizeSettings({ reducedMotion: true }).motion, "full", "不再兼容已弃用的 reducedMotion 字段");

  const existingFastStore = new Map([
    [slider.SETTINGS_KEY, JSON.stringify({ v: 1, motion: "fast", ticks: "dim" })]
  ]);
  const existingFastWin = {
    localStorage: {
      getItem: (k) => (existingFastStore.has(k) ? existingFastStore.get(k) : null),
      setItem: (k, v) => existingFastStore.set(k, v)
    }
  };
  assert.equal(slider.readSettings(existingFastWin).motion, "fast", "老用户已有 fast 配置应保持不变");
  assert.equal(slider.resetSettings(existingFastWin).motion, "full", "恢复默认后应重置为 full");

  // 默认无存储挂载时点击轨道直接走 full 平滑滑行
  const defaultEnv = createPerfTestEnv({ settingsJson: "" });
  defaultEnv.win.localStorage.getItem = () => null;
  let defEffort = "low";
  const defContainer = defaultEnv.makeNode("div");
  const defMounted = slider.mountCodexEffortSlider({
    container: defContainer,
    seat: {
      effortLevels: [{ effort: "low", label: "Low" }, { effort: "medium", label: "Medium" }, { effort: "high", label: "High" }],
      get currentEffort() { return defEffort; },
      selectEffort(item) { defEffort = item.effort; }
    },
    document: defaultEnv.doc,
    window: defaultEnv.win
  });
  const defTrack = defContainer.children[0].children[0];
  let defRafCount = 0;
  const origDefRaf = defaultEnv.win.requestAnimationFrame;
  defaultEnv.win.requestAnimationFrame = function (cb) {
    defRafCount += 1;
    return origDefRaf(cb);
  };
  defTrack.dispatch("pointerdown", { clientX: 214 });
  assert.equal(defEffort, "high");
  assert.equal(defTrack.style.getPropertyValue("--ces-fill"), slider.knobOffsetOf(0, 14), "默认 full 模式下点击应从原位平滑滑行");
  assert.ok(defRafCount > 0, "默认 full 模式下点击应启动物理帧循环");
  defTrack.dispatch("pointerup", { clientX: 214 });
  defaultEnv.flushRaf();
  assert.notEqual(defTrack.style.getPropertyValue("--ces-fill"), slider.knobOffsetOf(0, 14), "默认 full 模式松手后帧循环应推进位置");
  defMounted.unmount();

  // 2. 废弃常量与函数清理检查 + 保留导出检查
  assert.equal(slider.findSeatEffort, undefined);
  assert.equal(slider.BASE_SPEEDUP, undefined);
  assert.equal(slider.MIN_HEIGHT_SLOTS, 3);
  assert.equal(slider.CLAUDE_ROWS, 6);
  assert.equal(slider.CLAUDE_KNOB_W, 24);
  assert.equal(typeof slider.starCountFor, "function");
  assert.equal(typeof slider.motionMode, "function");
  assert.equal(typeof slider.traceClear, "function");

  // 3. Antigravity 2.34.0 无 globalModelCtx 200 层 Fiber 树提前截断验证
  let fiberStepReads = 0;
  let head = { memoizedProps: {}, return: null };
  for (let depth = 1; depth <= 200; depth += 1) {
    const node = { return: head };
    Object.defineProperty(node, "memoizedProps", {
      get() {
        fiberStepReads += 1;
        if (depth === 190) {
          return {
            value: {
              effortIndex: new Map(),
              modelOptions: [{ label: "Gemini 4 Argon (Low)", value: 1 }, { label: "Gemini 4 Argon (High)", value: 2 }],
              selectedModel: { label: "Gemini 4 Argon (Low)", value: 1 }
            }
          };
        }
        if (depth === 180) {
          return {
            open: true,
            setIsOpen() {},
            setSelectedModel() {},
            modelOptions: [{ label: "Gemini 4 Argon (Low)", value: 1 }, { label: "Gemini 4 Argon (High)", value: 2 }],
            selectedModel: { label: "Gemini 4 Argon (Low)", value: 1 }
          };
        }
        if (depth === 170) {
          return { conversationId: "conv-234", placement: "top-start" };
        }
        return {};
      }
    });
    head = node;
  }
  const docOwner = { nodeType: 9 };
  const fakeFiberEl = { ownerDocument: docOwner, __reactFiber$trunc: head };
  fiberStepReads = 0;
  const ctx1 = slider.readAntigravityFiberContext(fakeFiberEl);
  assert.ok(ctx1 && ctx1.conversationId === "conv-234");
  const firstPassReads = fiberStepReads;
  assert.equal(firstPassReads, 200, "首次探测需爬完树确认不存在旧版 GlobalModelContext");

  fiberStepReads = 0;
  const ctx2 = slider.readAntigravityFiberContext(fakeFiberEl);
  assert.ok(ctx2 && ctx2.conversationId === "conv-234");
  assert.ok(fiberStepReads <= 40, `二次读取应在拿齐上下文后提前截断，实际=${fiberStepReads}`);

  // 4. Gemini 四档拖动：星尘 .is-hidden 零重排显隐 + contain 隔离 + 0 次 Orchestrator 子菜单全文档查询
  const env = createPerfTestEnv({ withMO: true, withRO: true });
  const styleEl = slider.installStyles(env.doc);
  assert.ok(styleEl.textContent.includes(".ces-star.is-hidden"), "应使用 .ces-star.is-hidden 类控制显隐");
  assert.ok(styleEl.textContent.includes("contain: layout style;"), ".ces-track 应启用 contain: layout style");
  assert.ok(styleEl.textContent.includes("contain: layout style paint;"), "子层应启用 contain: layout style paint");

  let orchSelectorQueries = 0;
  const origQS = env.doc.querySelector.bind(env.doc);
  env.doc.querySelector = function (sel) {
    if (String(sel).includes("orchestrator-picker-row")) {
      orchSelectorQueries += 1;
    }
    return origQS(sel);
  };

  const triggerBtn = env.makeNode("button");
  triggerBtn.setAttribute("data-testid", "model-selector-trigger");
  const trigOuter = env.makeNode("span");
  trigOuter.classList.add("min-w-0");
  const trigEffort = env.makeNode("span");
  trigEffort.classList.add("opacity-70");
  trigEffort.textContent = " Low";
  trigOuter.appendChild(trigEffort);
  triggerBtn.appendChild(trigOuter);
  env.body.appendChild(triggerBtn);

  const popup = env.makeNode("div");
  popup.setAttribute("role", "menu");
  const panel = env.makeNode("div");
  panel.setAttribute("data-testid", "model-selector-panel");
  panel.appendChild(env.makeNode("div"));
  popup.appendChild(panel);
  env.body.appendChild(popup);

  const hydroOpts = [
    { label: "Gemini 4 Hydrogen (Low)", value: 1 },
    { label: "Gemini 4 Hydrogen (Medium)", value: 2 },
    { label: "Gemini 4 Hydrogen (High)", value: 3 },
    { label: "Gemini 4 Hydrogen (Extra High)", value: 4 }
  ];
  let currentHydro = hydroOpts[0];
  let panelFiberReads = 0;
  const hydroFiber = { return: null };
  Object.defineProperty(hydroFiber, "memoizedProps", {
    get() {
      panelFiberReads += 1;
      return {
        open: true,
        setIsOpen() {},
        setSelectedModel(opt) { currentHydro = opt; },
        modelOptions: hydroOpts,
        selectedModel: currentHydro
      };
    }
  });
  panel.__reactFiber$perf = hydroFiber;
  triggerBtn.__reactFiber$perf = hydroFiber;

  const obs = slider.installAntigravityObserver({ document: env.doc, window: env.win });
  env.flushRaf();

  const trackEl = panel.querySelector('[data-ces-part="track"]');
  const starEls = trackEl.querySelectorAll('[data-ces-part="star"]');
  assert.equal(starEls.length, 22);
  assert.equal(starEls[0].style.display || "", "", "星尘初始不应设置内联 style.display");
  assert.equal(starEls[0].classList.contains("is-hidden"), true, "Low 档星尘应通过 .is-hidden 类隐藏");

  orchSelectorQueries = 0;
  panelFiberReads = 0;
  trackEl.dispatch("pointerdown", { clientX: 14 });
  trackEl.dispatch("pointermove", { clientX: 22 }); // 同档位
  assert.equal(panelFiberReads, 1, "按下加同档位微拖应共享拖动期快照缓存，仅爬 1 次 Fiber");

  // 跨过 4 档边界提交到 Extra
  trackEl.dispatch("pointermove", { clientX: 214 });
  env.flushRaf();
  assert.equal(currentHydro.label, "Gemini 4 Hydrogen (Extra High)");
  assert.equal(orchSelectorQueries, 0, "非 Orchestrator 拖动切档不得全文档查询 orchestrator-picker-row");
  assert.equal(starEls[0].style.display || "", "", "星尘显隐切换应始终零内联 style.display");
  assert.equal(starEls[0].classList.contains("is-hidden"), false, "高档位星尘应移除 .is-hidden 显示");

  trackEl.dispatch("pointerup", { clientX: 214 });
  obs.stop();
});

test("22. v1.3.1 解法一/二/四：零 Layout GPU 定位、拖动回响节流、scan 防泄漏与 lostpointercapture 窗口兜底", () => {
  // 1. 版本号与解法二 CSS 零 Layout 定位断言
  assert.equal(slider.dumpTrace().plugin, `antigravity-codex-effort-slider@${slider.PLUGIN_VERSION}`);
  const gpuEnv = createPerfTestEnv({ withRO: true });
  const styleEl = slider.installStyles(gpuEnv.doc);
  assert.ok(styleEl.textContent.includes(".ces-track::after"), "外发光应改用静态伪元素 .ces-track::after");
  assert.ok(!styleEl.textContent.includes("calc(var(--ces-energy, 0) * 16px)"), "不得保留逐帧重算阴影模糊半径的 calc()");
  assert.ok(styleEl.textContent.includes("clip-path: inset(0 calc(100% - var(--ces-fill, 14px)) 0 0);"), "填充与动效层应固定全宽并用 clip-path 裁切");
  assert.ok(styleEl.textContent.includes(".ces-stars__stage"), "应通过 .ces-stars__stage 舞台位移避免 22 颗星尘随容器缩宽重排");
  assert.ok(styleEl.textContent.includes("translate3d(calc(var(--ces-p, 0) * 100%), 0, 0)"), "圆钮应通过 .ces-knob-carrier GPU transform 平移");
  assert.ok(!styleEl.textContent.includes("will-change: left;"), "不得再以 left 定位驱动圆钮");

  // 2. 解法四：提前触发 lostpointercapture 时应无缝切入 window 兜底继续拖动而不中断
  let gpuEffort = "low";
  const gpuCommits = [];
  const gpuContainer = gpuEnv.makeNode("div");
  const gpuMounted = slider.mountCodexEffortSlider({
    container: gpuContainer,
    seat: {
      effortLevels: [
        { effort: "low", label: "Low" },
        { effort: "medium", label: "Medium" },
        { effort: "high", label: "High" }
      ],
      get currentEffort() { return gpuEffort; },
      selectEffort(item) {
        gpuEffort = item.effort;
        gpuCommits.push(item.effort);
      }
    },
    document: gpuEnv.doc,
    window: gpuEnv.win
  });

  const gpuTrack = gpuContainer.children[0].children[0];
  const fillEl = gpuTrack.querySelector('[data-ces-part="fill"]');
  const energyEl = gpuTrack.querySelector('[data-ces-part="energy"]');
  const starsEl = gpuTrack.querySelector('[data-ces-part="stars"]');
  const stageEl = gpuTrack.querySelector('[data-ces-part="stars-stage"]');
  const knobEl = gpuTrack.querySelector('[data-ces-part="knob"]');
  assert.ok(stageEl, "星尘舞台容器应当存在");
  assert.equal(stageEl.querySelectorAll('[data-ces-part="star"]').length, 22);

  gpuTrack.dispatch("pointerdown", { clientX: 14, button: 0, pointerId: 7, buttons: 1 });
  // 模拟 4ms 后提前丢捕获（左键仍按住 buttons=1）
  gpuTrack.dispatch("lostpointercapture", { pointerId: 7, buttons: 1 });
  // 通过 window 级兜底监听继续跨越 Medium 和 High
  gpuEnv.win.dispatchEvent({ type: "pointermove", clientX: 114, pointerId: 7, buttons: 1 });
  gpuEnv.win.dispatchEvent({ type: "pointermove", clientX: 214, pointerId: 7, buttons: 1 });

  assert.deepEqual(gpuCommits, ["medium", "high"], "提前丢失 pointercapture 后按住鼠标拖动仍应连续跨两档");
  assert.equal(gpuTrack.style.getPropertyValue("--ces-p"), "1");
  assert.equal(gpuTrack.style.getPropertyValue("--ces-fill"), slider.knobOffsetOf(1, 14));
  assert.equal(fillEl.style.width || "", "", "拖动过程中 fillEl 不得写内联 width");
  assert.equal(energyEl.style.width || "", "", "拖动过程中 energyEl 不得写内联 width");
  assert.equal(starsEl.style.width || "", "", "拖动过程中 starsEl 不得写内联 width");
  assert.equal(knobEl.style.left || "", "", "拖动过程中 knobEl 不得写内联 left");

  // 确认松手正常收尾，且之后 window 上移动不会再触发滑条变动
  gpuEnv.win.dispatchEvent({ type: "pointerup", clientX: 214, pointerId: 7, buttons: 0 });
  gpuEnv.win.dispatchEvent({ type: "pointermove", clientX: 14, pointerId: 7, buttons: 1 });
  assert.equal(gpuEffort, "high", "松手后已卸除 window 兜底监听，后续移动不应误改档位");
  gpuMounted.unmount();

  // 3. Claude 画布缓冲固定全宽验证（拖动降档回退时缓冲区宽度保持 trackW 不重建）
  let claudeRaf = null;
  const claudeEnv = createPerfTestEnv({ withRO: true });
  claudeEnv.win.requestAnimationFrame = (cb) => { claudeRaf = cb; return 1; };
  claudeEnv.win.cancelAnimationFrame = () => { claudeRaf = null; };
  const clearRectCalls = [];
  const origCE = claudeEnv.doc.createElement.bind(claudeEnv.doc);
  claudeEnv.doc.createElement = (tag) => {
    const el = origCE(tag);
    if (String(tag).toLowerCase() === "canvas") {
      el.getContext = () => ({
        globalAlpha: 1,
        fillStyle: "",
        clearRect(x, y, w, h) { clearRectCalls.push({ x, y, w, h }); },
        fillRect() {},
        createLinearGradient() { return { addColorStop() {} }; },
        beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}
      });
    }
    return el;
  };
  let clEff = "high";
  const clCont = claudeEnv.makeNode("div");
  const clMounted = slider.mountCodexEffortSlider({
    container: clCont,
    seat: {
      baseName: "Claude Opus 5.5",
      isClaude: true,
      theme: "claude",
      effortLevels: [{ effort: "low", label: "Low" }, { effort: "medium", label: "Medium" }, { effort: "high", label: "High" }],
      get currentEffort() { return clEff; },
      selectEffort(item) { clEff = item.effort; }
    },
    document: claudeEnv.doc,
    window: claudeEnv.win
  });
  const clTrack = clCont.children[0].children[0];
  clTrack.getBoundingClientRect = () => ({ left: 0, top: 0, right: 240, bottom: 28, width: 240, height: 28 });
  const clCanvas = clTrack.querySelector('[data-ces-part="claude-canvas"]');
  claudeEnv.roInstances[0]?.trigger(clTrack, 240, 28);
  claudeRaf(100);
  assert.equal(clCanvas.width, 240, "Claude 画布缓冲区应固定为完整轨道宽");
  clTrack.dispatch("pointerdown", { clientX: 226, pointerId: 1 });
  clTrack.dispatch("pointermove", { clientX: 120, pointerId: 1 });
  claudeRaf(116);
  assert.equal(clCanvas.width, 240, "拖动期间 Claude 画布缓冲区宽应维持 240 不变，仅清全画布再绘制左侧裁剪区");
  assert.ok(clearRectCalls.some((c) => c.w === 240), "左侧部分绘制时应先清完整 240px 画布防止右端残留");
  clTrack.dispatch("pointerup", { clientX: 120, pointerId: 1 });
  clMounted.unmount();

  // 4. 解法一：重开 Hydrogen 后拖动期间 0 次 scan() 无条件子菜单查询与宿主异步回响节流
  const scanEnv = createPerfTestEnv({ withMO: true, withRO: true });
  let orchQueries = 0;
  const origScanQS = scanEnv.doc.querySelector.bind(scanEnv.doc);
  scanEnv.doc.querySelector = function (sel) {
    if (String(sel).includes("orchestrator-picker-row")) {
      orchQueries += 1;
    }
    return origScanQS(sel);
  };

  const trigBtn = scanEnv.makeNode("button");
  trigBtn.setAttribute("data-testid", "model-selector-trigger");
  const trigSpan = scanEnv.makeNode("span");
  trigSpan.classList.add("min-w-0");
  const trigEff = scanEnv.makeNode("span");
  trigEff.classList.add("opacity-70");
  trigEff.textContent = " Low";
  trigSpan.appendChild(trigEff);
  trigBtn.appendChild(trigSpan);
  scanEnv.body.appendChild(trigBtn);

  const popupEl = scanEnv.makeNode("div");
  popupEl.setAttribute("role", "menu");
  const panelEl = scanEnv.makeNode("div");
  panelEl.setAttribute("data-testid", "model-selector-panel");
  panelEl.appendChild(scanEnv.makeNode("div"));
  popupEl.appendChild(panelEl);
  scanEnv.body.appendChild(popupEl);

  const hOpts = [
    { label: "Gemini 4 Hydrogen (Low)", value: 1 },
    { label: "Gemini 4 Hydrogen (Medium)", value: 2 },
    { label: "Gemini 4 Hydrogen (High)", value: 3 },
    { label: "Gemini 4 Hydrogen (Extra High)", value: 4 }
  ];
  let curH = hOpts[0];
  let scanFiberReads = 0;
  const hFiber = { return: null };
  Object.defineProperty(hFiber, "memoizedProps", {
    get() {
      scanFiberReads += 1;
      return {
        open: true,
        setIsOpen() {},
        setSelectedModel(opt) { curH = opt; },
        modelOptions: hOpts,
        selectedModel: curH
      };
    }
  });
  panelEl.__reactFiber$scan = hFiber;
  trigBtn.__reactFiber$scan = hFiber;

  const obs = slider.installAntigravityObserver({ document: scanEnv.doc, window: scanEnv.win });
  scanEnv.flushRaf();
  assert.ok(orchQueries <= 1, "首次挂载最多探测 1 次子菜单");

  const scanTrack = panelEl.querySelector('[data-ces-part="track"]');
  const panelMO = scanEnv.moInstances.find((o) => o.target === popupEl || o.target === panelEl);
  const triggerMO = scanEnv.moInstances.find((o) => o.target === trigBtn);
  assert.ok(panelMO && triggerMO);

  orchQueries = 0;
  scanTrack.dispatch("pointerdown", { clientX: 14, button: 0, pointerId: 3, buttons: 1 });
  // 跨过边界到 Medium
  scanTrack.dispatch("pointermove", { clientX: 85, pointerId: 3, buttons: 1 });
  assert.equal(curH.label, "Gemini 4 Hydrogen (Medium)");

  // 清零 Fiber 计数，模拟宿主 React 异步更新面板文本、触发按钮文本及文档捕获键盘/点击事件
  scanFiberReads = 0;
  panelMO.trigger([{ type: "characterData", target: panelEl }]);
  triggerMO.trigger([{ type: "characterData", target: trigEff }]);
  scanEnv.doc.dispatchEvent({ type: "keydown", key: "a", target: scanEnv.body });
  scanEnv.doc.dispatchEvent({ type: "pointerdown", target: trigBtn });
  scanEnv.flushRaf();

  assert.equal(scanFiberReads, 0, "拖动期间宿主 MO 与文档捕获事件不得在拖动帧插队重跑 scan()/Fiber 遍历");
  assert.equal(orchQueries, 0, "拖动期间及普通 Hydrogen 下不得全文档查询 orchestrator-picker-row");

  // 松手后：延迟积攒的脏状态自动补齐一次同步，但普通模式下依然 0 次全文档子菜单查询
  scanTrack.dispatch("pointerup", { clientX: 85, pointerId: 3, buttons: 0 });
  scanEnv.flushRaf();
  assert.ok(scanFiberReads >= 1, "松手后应补齐一次被延迟的宿主状态同步");
  assert.equal(orchQueries, 0, "非 Orchestrator 松手补同步同样不得无条件查询 orchestrator-picker-row");

  obs.stop();
});

await test("23. v1.5.1 单页右键菜单（外观 + 图二更新区 + 底部红色二次确认卸载）与双向热同步", async () => {
  assert.equal(slider.PLUGIN_VERSION, "1.5.1");
  const env = createPerfTestEnv();
  env.win.navigator = { language: "zh-CN", languages: ["zh-CN"] };
  assert.equal(slider.resolveHostBridge(env.win), null, "无桥接环境下应返回 null 静默降级");

  // 1. 构造模拟 Desktop 宿主桥接（含双向热同步与卸载回调）
  let hostState = {
    version: "1.5.1",
    motion: "full",
    ticks: "highlight",
    autoUpdate: true,
    checkIntervalHours: 12,
    mirrorPrefix: "",
    lastCheckAt: 0,
    pendingUpdateVersion: null
  };
  let relaunchCalls = 0;
  let uninstallCalls = 0;
  let updateReadyListener = null;
  let stateChangedListener = null;
  let uninstalledListener = null;

  const mockBridge = {
    platform: "desktop",
    async getState() {
      return { ...hostState };
    },
    async saveConfig(cfg) {
      if (typeof cfg.motion === "string") hostState.motion = cfg.motion;
      if (typeof cfg.ticks === "string") hostState.ticks = cfg.ticks;
      if (typeof cfg.autoUpdate === "boolean") hostState.autoUpdate = cfg.autoUpdate;
      if (typeof cfg.mirrorPrefix === "string") hostState.mirrorPrefix = cfg.mirrorPrefix;
      return { ...hostState };
    },
    async checkUpdate() {
      hostState.pendingUpdateVersion = "1.5.2";
      hostState.lastCheckAt = Math.floor(Date.now() / 1000);
      return {
        ok: true,
        status: "updated",
        version: "1.5.2",
        state: { ...hostState }
      };
    },
    async uninstall() {
      uninstallCalls += 1;
      return { ok: true, messages: ["已精准卸载本插件"] };
    },
    async relaunch() {
      relaunchCalls += 1;
      return true;
    },
    onStateChanged(cb) {
      stateChangedListener = cb;
      return () => {
        if (stateChangedListener === cb) stateChangedListener = null;
      };
    },
    onUninstalled(cb) {
      uninstalledListener = cb;
      return () => {
        if (uninstalledListener === cb) uninstalledListener = null;
      };
    },
    onUpdateReady(cb) {
      updateReadyListener = cb;
      return () => {
        if (updateReadyListener === cb) updateReadyListener = null;
      };
    }
  };

  // 2. 单页右键设置面板渲染（无 Tab 栏，外观 + 图二更新区 + 底部红色二次确认卸载）
  const closeSettings = slider.openSettingsPanel({
    document: env.doc,
    window: env.win,
    bridge: mockBridge,
    x: 20,
    y: 20
  });
  await Promise.resolve();
  await Promise.resolve();

  const panel = env.doc.querySelector(".ces-set");
  assert.ok(panel, "设置面板应当渲染");
  assert.equal(panel.querySelector(".ces-set-tabs"), null, "单页布局不应渲染旧版双 Tab 栏");
  assert.ok(panel.querySelector(".ces-set-logo"), "头部应渲染品牌 SVG 图标");
  assert.equal(panel.querySelector(".ces-set-ver").textContent, "v1.5.1");

  const updateSec = panel.querySelector('[data-ces-section="update"]');
  const dangerSec = panel.querySelector('[data-ces-section="danger"]');
  assert.ok(updateSec && dangerSec, "存在 bridge 时应同时渲染更新设置区与底部危险卸载区");

  const autoToggleBtn = panel.querySelector('[data-ces-action="toggle-auto-update"]');
  assert.equal(autoToggleBtn.textContent, "已启用");
  autoToggleBtn.dispatch("click", {});
  await Promise.resolve();
  assert.equal(hostState.autoUpdate, false, "点击已启用应切换为仅手动并保存");
  assert.equal(autoToggleBtn.textContent, "已禁用");

  const mirrorInput = panel.querySelector(".ces-set-input");
  const saveMirrorBtn = panel.querySelector('[data-ces-action="save-mirror"]');
  mirrorInput.value = "https://gh-proxy.com/";
  saveMirrorBtn.dispatch("click", {});
  await Promise.resolve();
  assert.equal(hostState.mirrorPrefix, "https://gh-proxy.com/", "点击保存按钮应同步镜像前缀");

  const checkBtn = panel.querySelectorAll(".ces-set-primary-btn").find((b) => b.textContent === "检查更新");
  assert.ok(checkBtn, "应存在检查更新按钮");
  checkBtn.dispatch("click", {});
  await Promise.resolve();
  await Promise.resolve();

  const pendingBanner = panel.querySelector('[data-ces-part="pending-banner"]');
  assert.ok(pendingBanner && pendingBanner.classList.contains("is-visible"), "存在待重启新版时应显示待重启横幅");

  const toastAfterCheck = env.doc.querySelector(".ces-update-toast");
  assert.ok(toastAfterCheck, "检查到新版本后应弹出更新就绪 Toast");
  assert.ok(toastAfterCheck.querySelector(".ces-update-toast-title").textContent.includes("1.5.2"));
  const restartBtn = toastAfterCheck.querySelectorAll(".ces-update-toast-btn").find((b) => b.classList.contains("is-primary"));
  assert.equal(restartBtn.textContent, "立即重启");
  restartBtn.dispatch("click", {});
  await Promise.resolve();
  assert.equal(relaunchCalls, 1, "点击立即重启应调用 bridge.relaunch()");
  if (toastAfterCheck.parentNode) toastAfterCheck.parentNode.removeChild(toastAfterCheck);

  // 2.2 远端 Sidecar 推送 state-changed 实时热同步到已打开的右键面板与 localStorage
  assert.ok(typeof stateChangedListener === "function", "面板打开期间应监听 onStateChanged");
  stateChangedListener({ ...hostState, motion: "fast", ticks: "dim" });
  assert.equal(slider.readSettings(env.win).motion, "fast", "远端变更应热同步至 localStorage");
  assert.equal(slider.readSettings(env.win).ticks, "dim");
  const fastOpt = panel.querySelectorAll(".ces-set-opt").find((b) => b.textContent === "快速动画");
  assert.ok(fastOpt && fastOpt.classList.contains("is-on"), "面板按钮应同步高亮快速动画");

  // 2.3 底部红色卸载按钮二次确认（取消 -> 再打开 -> 确认卸载）
  const uninstallOpenBtn = panel.querySelector('[data-ces-action="uninstall-open"]');
  const confirmBox = panel.querySelector('[data-ces-part="uninstall-confirm"]');
  const cancelBtn = panel.querySelector('[data-ces-action="uninstall-cancel"]');
  const confirmBtn = panel.querySelector('[data-ces-action="uninstall-confirm"]');
  assert.equal(confirmBox.hidden, true, "二次确认区默认应折叠");
  uninstallOpenBtn.dispatch("click", {});
  assert.equal(confirmBox.hidden, false, "点击卸载本插件应展开二次确认区");
  cancelBtn.dispatch("click", {});
  assert.equal(confirmBox.hidden, true, "点击取消应收起二次确认区");
  assert.equal(uninstallCalls, 0);

  uninstallOpenBtn.dispatch("click", {});
  confirmBtn.dispatch("click", {});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(uninstallCalls, 1, "点击确认卸载应调用 bridge.uninstall()");
  const uninstallToast = env.doc.querySelector(".ces-update-toast");
  assert.ok(uninstallToast && uninstallToast.querySelector(".ces-update-toast-title").textContent.includes("已卸载"));
  if (uninstallToast.parentNode) uninstallToast.parentNode.removeChild(uninstallToast);
  closeSettings();

  // 2.5 底部右键智能向上翻转防溢出 + 亮色主题自适应 + 无 bridge 单页兼容
  env.win.innerHeight = 600;
  env.win.innerWidth = 800;
  env.win.getComputedStyle = () => ({ backgroundColor: "rgb(255, 255, 255)", color: "rgb(24, 24, 27)" });
  const origCE = env.doc.createElement.bind(env.doc);
  env.doc.createElement = (tag) => {
    const el = origCE(tag);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 316, height: 320 });
    return el;
  };
  const closeFlip = slider.openSettingsPanel({
    document: env.doc,
    window: env.win,
    bridge: mockBridge,
    x: 700,
    y: 560
  });
  const flipPanel = env.doc.querySelector(".ces-set");
  assert.ok(flipPanel.classList.contains("is-light"), "亮色背景下设置面板应自动添加 .is-light");
  const topPx = parseFloat(flipPanel.style.top);
  const leftPx = parseFloat(flipPanel.style.left);
  assert.ok(topPx + 320 <= 590, "弹窗底部不得超出视口下边界");
  assert.ok(topPx <= 560 - 320, "底部右键空间不足时应智能向上翻转至鼠标上方");
  assert.ok(leftPx + 316 <= 790, "右侧空间不足时应自动左移防溢出");
  closeFlip();

  env.doc.createElement = origCE;
  const closeOffline = slider.openSettingsPanel({
    document: env.doc,
    window: env.win,
    bridge: null,
    x: 20,
    y: 20
  });
  const offlinePanel = env.doc.querySelector(".ces-set");
  assert.equal(offlinePanel.querySelector('[data-ces-section="update"]'), null, "无 bridge 离线模式下不得渲染更新区");
  assert.equal(offlinePanel.querySelector('[data-ces-section="danger"]'), null, "无 bridge 离线模式下不得渲染卸载区");
  closeOffline();

  // 3. installCodexEffortSlider 双向同步 + 卸载信号 + stop() 清理
  env.win.__agCodexSliderBridge = mockBridge;
  hostState.pendingUpdateVersion = null;
  hostState.motion = "quick";
  const inst = slider.installCodexEffortSlider({ document: env.doc, window: env.win });
  await Promise.resolve();
  assert.ok(typeof updateReadyListener === "function", "应订阅 onUpdateReady 事件");
  assert.equal(slider.readSettings(env.win).motion, "quick", "启动时应从宿主 state.json 同步外观设置");

  // 3.1 本地修改外观应自动调用 bridge.saveConfig 同步给 Sidecar
  slider.writeSettings({ motion: "full", ticks: "highlight" }, env.win);
  await Promise.resolve();
  assert.equal(hostState.motion, "full");
  assert.equal(hostState.ticks, "highlight");

  updateReadyListener({ version: "1.5.2" });
  const liveToast = env.doc.querySelector(".ces-update-toast");
  assert.ok(liveToast && liveToast.querySelector(".ces-update-toast-title").textContent.includes("1.5.2"), "收到推送事件后应弹出 Toast");

  inst.stop();
  assert.equal(updateReadyListener, null, "stop() 后应注销 onUpdateReady 监听");
  assert.equal(env.doc.querySelector(".ces-update-toast"), null, "stop() 后应清理残留 Toast DOM");
});

await test("24. 7 语自动多语言识别、词典完整性与非支持语言回退英语验证", async () => {
  assert.equal(slider.resolveUiLocale("zh-CN"), "zh-CN");
  assert.equal(slider.resolveUiLocale("zh-SG"), "zh-CN");
  assert.equal(slider.resolveUiLocale("zh"), "zh-CN");
  assert.equal(slider.resolveUiLocale("zh-TW"), "zh-TW");
  assert.equal(slider.resolveUiLocale("zh-HK"), "zh-TW");
  assert.equal(slider.resolveUiLocale("zh-Hant-MO"), "zh-TW");
  assert.equal(slider.resolveUiLocale("ja-JP"), "ja");
  assert.equal(slider.resolveUiLocale("ko-KR"), "ko");
  assert.equal(slider.resolveUiLocale("fr-FR"), "fr");
  assert.equal(slider.resolveUiLocale("ru-RU"), "ru");
  assert.equal(slider.resolveUiLocale("en-US"), "en");
  assert.equal(slider.resolveUiLocale("de-DE"), "en");
  assert.equal(slider.resolveUiLocale("es-ES"), "en");
  assert.equal(slider.resolveUiLocale(""), "en");

  const langs = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "ru"];
  const baseKeys = Object.keys(slider.I18N_MESSAGES["zh-CN"]).sort();
  for (const lang of langs) {
    assert.deepEqual(
      Object.keys(slider.I18N_MESSAGES[lang]).sort(),
      baseKeys,
      `${lang} 词典键集合应与基准语言完全一致`
    );
  }

  const cases = [
    { navLang: "en-US", title: "Effort Slider", checkBtn: "Check Updates", uninstallBtn: "Uninstall Plugin", toastTitle: "Ready" },
    { navLang: "de-DE", title: "Effort Slider", checkBtn: "Check Updates", uninstallBtn: "Uninstall Plugin", toastTitle: "Ready" },
    { navLang: "ja-JP", title: "推論スライダー", checkBtn: "更新を確認", uninstallBtn: "プラグインを削除", toastTitle: "準備完了" },
    { navLang: "fr-FR", title: "Curseur d'effort", checkBtn: "Vérifier", uninstallBtn: "Désinstaller le plugin", toastTitle: "prêt" }
  ];

  for (const c of cases) {
    const env = createPerfTestEnv();
    env.win.navigator = { language: c.navLang, languages: [c.navLang] };
    assert.equal(slider.detectUiLocale(env.win), slider.resolveUiLocale(c.navLang));

    const closePanel = slider.openSettingsPanel({
      document: env.doc,
      window: env.win,
      bridge: {
        platform: "desktop",
        async getState() { return { version: "1.5.1", autoUpdate: true, mirrorPrefix: "" }; }
      },
      x: 20,
      y: 20
    });
    await Promise.resolve();
    const panel = env.doc.querySelector(".ces-set");
    assert.ok(
      panel.querySelectorAll("span").some((s) => s.textContent === c.title),
      `${c.navLang} 面板标题应为 ${c.title}`
    );
    assert.ok(
      panel.querySelectorAll(".ces-set-primary-btn").some((b) => b.textContent === c.checkBtn),
      `${c.navLang} 检查更新按钮应为 ${c.checkBtn}`
    );
    assert.equal(
      panel.querySelector('[data-ces-action="uninstall-open"]').textContent,
      c.uninstallBtn,
      `${c.navLang} 卸载按钮应为 ${c.uninstallBtn}`
    );
    closePanel();

    const closeToast = slider.showUpdateReadyToast({
      document: env.doc,
      window: env.win,
      version: "1.5.1",
      platform: "desktop"
    });
    const toast = env.doc.querySelector(".ces-update-toast");
    assert.ok(
      toast.querySelector(".ces-update-toast-title").textContent.includes(c.toastTitle),
      `${c.navLang} 更新 Toast 标题应包含 ${c.toastTitle}`
    );
    closeToast();
  }
});

console.log(`All ${passedCount} test suites passed!`);
