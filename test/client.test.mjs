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

  const mounted = slider.mountCodexEffortSlider({
    container,
    seat,
    document: doc,
    window: mockWin
  });

  const rootEl = container.children[0];
  const trackEl = rootEl.children[0];

  // 1. 在 Low (0%, clientX = 14) 处按下指针：尚未跨边界，不重复触发写入
  trackEl.dispatch("pointerdown", { clientX: 14 });
  assert.equal(dragCommits.length, 0);
  assert.equal(currentEffort, "low");

  // 2. 按住不松手（无 pointerup），向右拖动到 20% (clientX = 14 + 200 * 0.20 = 54)
  //    已越过 Low -> Medium 的 1/3 边界 (16.7%)，应当立即触发 selectEffort("medium", 1)！
  trackEl.dispatch("pointermove", { clientX: 54 });
  assert.equal(dragCommits.length, 1);
  assert.deepEqual(dragCommits[0], { effort: "medium", index: 1 });
  assert.equal(currentEffort, "medium");

  // 3. 继续按住不松手，向右拖动到 70% (clientX = 14 + 200 * 0.70 = 154)
  //    已越过 Medium -> High 的 1/3 边界 (66.7%)，应当立即触发 selectEffort("high", 2)！
  trackEl.dispatch("pointermove", { clientX: 154 });
  assert.equal(dragCommits.length, 2);
  assert.deepEqual(dragCommits[1], { effort: "high", index: 2 });
  assert.equal(currentEffort, "high");

  // 4. 依然按住不松手，向左回拖到 25% (clientX = 14 + 200 * 0.25 = 64)
  //    直接退回 Low 区间，立即触发 selectEffort("low", 0)！
  trackEl.dispatch("pointermove", { clientX: 64 });
  assert.equal(dragCommits.length, 3);
  assert.deepEqual(dragCommits[2], { effort: "low", index: 0 });
  assert.equal(currentEffort, "low");

  // 5. 最后在当前位置松手 pointerup，因为已经在拖动途中同步切到了 low，不会产生多余的重复提交
  trackEl.dispatch("pointerup", { clientX: 64 });
  assert.equal(dragCommits.length, 3);

  mounted.unmount();
});

console.log(`All ${passedCount} test suites passed!`);
