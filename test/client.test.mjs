import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const slider = require("../lib/client.js");

let passedCount = 0;
function test(name, fn) {
  try {
    fn();
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
        return JSON.stringify({ v: 1, anim: "fast", ticks: "highlight", height: "1x", debug: false });
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
  //    ★ 触发最高档物理反馈：面板快速抖动 (ces-panel-shaking) + High 模糊光斑爆散 (is-glowing)
  trackEl.dispatch("pointermove", { clientX: 154 });
  assert.equal(dragCommits.length, 2);
  assert.deepEqual(dragCommits[1], { effort: "high", index: 2 });
  assert.equal(currentEffort, "high");
  assert.equal(trackEl.style.getPropertyValue("--ces-fill"), slider.knobOffsetOf(0.7, 14));
  assert.equal(mockPanel.classList.contains("ces-panel-shaking"), true, "滑动至最高档面板应触发快速抖动");
  assert.equal(mockValueEl.classList.contains("is-glowing"), true, "滑动至最高档 High 应闪出模糊光斑");
  assert.equal(mockValueEl.classList.contains("ces-text-rise"), true, "滑动至最高档 High 应触发文字向上翻转");
  assert.equal(mockValueEl.style.getPropertyValue("--ces-glow-color"), "rgba(168, 85, 247, 0.9)");

  // 3b. 在 High 区间继续向右微移到 85% (clientX = 14 + 200 * 0.85 = 184)：
  //     不得重复触发抖动或重复 commit
  trackEl.dispatch("pointermove", { clientX: 184 });
  assert.equal(dragCommits.length, 2, "在 High 区间内微移不重复触发 commit");

  // 4. 依然按住不松手，向左回拖到 25% (clientX = 14 + 200 * 0.25 = 64)
  //    直接退回 Low 区间，立即触发 selectEffort("low", 0) 并清理 is-glowing！
  trackEl.dispatch("pointermove", { clientX: 64 });
  assert.equal(dragCommits.length, 3);
  assert.deepEqual(dragCommits[2], { effort: "low", index: 0 });
  assert.equal(currentEffort, "low");
  assert.equal(trackEl.style.getPropertyValue("--ces-fill"), slider.knobOffsetOf(0.25, 14));
  assert.equal(mockValueEl.classList.contains("is-glowing"), false, "回退到低档位应清除光斑效果");

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
  assert.equal(claudePanel.classList.contains("ces-panel-shaking"), true, "Claude 模型滑到最高档面板应抖动");
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

console.log(`All ${passedCount} test suites passed!`);
