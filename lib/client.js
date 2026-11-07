"use strict";

/**
 * Antigravity Codex 风格推理等级滑条 (antigravity-codex-effort-slider)
 *
 * 设计目标与核心约束：
 * 1. 深度适配 Google Antigravity 原生架构（基于 @exa/agent-ui-toolkit 与 React Fiber 状态树），
 *    而非盲目照搬 DeepSeek Harness 的 DOM 假设。
 * 2. 在原生模型菜单 ([data-testid="model-selector-panel"]) 底部（模型列表与 View Usage 之间）
 *    挂载专属「推理等级」滑条行；屏蔽模型行冗余的右侧悬停档位子菜单，保留模型行右侧档位文字并随档位着色。
 * 3. 在菜单内点击上方模型行切换模型时不自动关闭菜单，下方滑条即时联动该模型的可用档位
 *    （单档位模型如 GPT-OSS 120B 自动置灰锁定）。
 * 4. 拖动滑条过程中，圆钮连续跟随指针；一旦滑过档位边界（无需等松手），立即通过 React Fiber
 *    调用官方 setModelConfigByLabelForConversation 切换真实档位，菜单保持常开。
 * 5. 针对 Antigravity 的三档模型 (Low / Medium / High) 采用 0 -> 0.5 -> 1.0 满配能量映射：
 *    - Low (0%)    : 纯蓝 (#4d93f8) 轨道 + 0 能量 + 0 星尘 + 蓝色文字
 *    - Medium (50%): 蓝紫过渡 (#9333ea) + 0.5 能量 + 11 颗星尘 (1x 闪烁速度) + 蓝紫文字
 *    - High (100%) : 深紫星云 (#4c1d95) + 流光扫掠 + 22 颗星尘全开 (2x 速度) + 紫色边框光晕 + 亮紫文字
 */
(function (root, factory) {
  var exportsObj = factory(root);
  if (typeof module === "object" && module && typeof module.exports === "object") {
    module.exports = exportsObj;
  }
  if (root && typeof root === "object") {
    root.AntigravityCodexEffortSlider = exportsObj;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this, function (globalRoot) {

  // ── 常量与默认几何参数 ──────────────────────────────────────────────────────
  var STYLE_ELEMENT_ID = "ag-codex-effort-slider-styles";
  var TRACK_HEIGHT = 28;
  var KNOB_SIZE = 28;
  var KNOB_RADIUS = KNOB_SIZE / 2;
  var BASE_SPEEDUP = 4;

  // Antigravity 默认三档模型 (Low / Medium / High) 无 Off 档，因此能量起点为 0、中点为 0.5；
  // 若遇到首档为 Off 的四档模型 (Off / Low / High / Max)，energyStopsFor 会自动返回 { start: 1/3, end: 2/3 }。
  var ENERGY_START = 0;
  var ENERGY_END = 0.5;
  var MIN_HEIGHT_SLOTS = 2;

  // Antigravity 官方推理档位枚举与展示名映射（对应 main.js 中的 DXb / EXb / GXb）
  var AG_EFFORT_ORDER = ["off", "low", "medium", "high", "xhigh", "max"];
  var AG_EFFORT_LABELS = {
    off: "Off",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra",
    max: "Max"
  };
  var AG_MODEL_LABEL_RE = /^(.*?)\s*\((off|low|medium|high|xhigh|max)(?:\s+thinking)?\)\s*$/i;

  // ── 连续物理运动参数 ────────────────────────────────────────────────────────
  // full: 完整星云阻尼变速动画；fast: 快速 ~70ms 跟手吸附（默认）；quick: 0 动画直接跳格
  var MOTION = Object.freeze({
    maxSpeed: 3.2,
    accel: 28,
    decel: 18,
    snapEps: 0.0015,
    velEps: 0.01
  });

  var MOTION_REDUCED = Object.freeze({
    maxSpeed: 1e6,
    accel: 1e9,
    decel: 1e9,
    snapEps: 1e-4,
    velEps: 1e6
  });

  var MOTION_FAST = Object.freeze({
    maxSpeed: 18,
    accel: 260,
    decel: 180,
    snapEps: 0.002,
    velEps: 0.04
  });

  var RELEASE_PROJECT_S = 0.09;
  var POINTER_SPEED_EMA = 0.45;
  var POINTER_STALE_S = 0.05;
  var POINTER_SPEED_TAU = 0.035;

  // ── 用户设置 Schema 与持久化 ────────────────────────────────────────────────
  var SETTINGS_KEY = "ag.codexEffortSlider.settings.v1";
  var LEGACY_SETTINGS_KEY = "dsh.codexEffortSlider.settings.v1";
  var SETTINGS_EVENT = "ag:codex-effort-slider:settings";
  var SETTINGS_VERSION = 1;

  var SETTINGS_SCHEMA = Object.freeze([
    Object.freeze({
      key: "motion",
      label: "动画效果",
      defaultValue: "fast",
      options: Object.freeze([
        Object.freeze({ value: "fast", label: "快速动画", hint: "拨过 1/3 即切档 · ~70ms 快速吸附" }),
        Object.freeze({ value: "quick", label: "简洁动画", hint: "无过渡 · 直接跳档" }),
        Object.freeze({ value: "full", label: "完整动画", hint: "匀变速追赶 + 星尘渐亮" })
      ])
    }),
    Object.freeze({
      key: "ticks",
      label: "已到达档位的刻度点",
      defaultValue: "highlight",
      options: Object.freeze([
        Object.freeze({ value: "highlight", label: "亮白显示", hint: "默认 · 已滑过档位高亮" }),
        Object.freeze({ value: "dim", label: "与未到达同色", hint: "所有刻度点保持柔和半透明" }),
        Object.freeze({ value: "hidden", label: "隐藏", hint: "不显示任何刻度点" })
      ])
    })
  ]);

  function schemaDefaults() {
    var out = { v: SETTINGS_VERSION };
    for (var i = 0; i < SETTINGS_SCHEMA.length; i += 1) {
      var item = SETTINGS_SCHEMA[i];
      out[item.key] = item.defaultValue;
    }
    return out;
  }

  function normalizeSettings(raw) {
    var base = schemaDefaults();
    if (!raw || typeof raw !== "object") return base;
    for (var i = 0; i < SETTINGS_SCHEMA.length; i += 1) {
      var item = SETTINGS_SCHEMA[i];
      var candidate = raw[item.key];
      var matched = false;
      for (var j = 0; j < item.options.length; j += 1) {
        if (item.options[j].value === candidate) {
          matched = true;
          break;
        }
      }
      if (matched) base[item.key] = candidate;
    }
    if (!raw.motion && raw.reducedMotion === true) {
      base.motion = "quick";
    }
    return base;
  }

  function resolveStorage(win) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    try {
      if (w && w.localStorage) return w.localStorage;
    } catch (err) {
      // 沙箱或隐私上下文禁用 localStorage 时降级为内存模式
    }
    return null;
  }

  function readSettings(win) {
    var store = resolveStorage(win);
    if (!store) return schemaDefaults();
    try {
      var text = store.getItem(SETTINGS_KEY) || store.getItem(LEGACY_SETTINGS_KEY);
      if (!text) return schemaDefaults();
      return normalizeSettings(JSON.parse(text));
    } catch (err) {
      return schemaDefaults();
    }
  }

  function writeSettings(patch, win) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    var current = readSettings(w);
    var merged = Object.assign({}, current, patch || {});
    var next = normalizeSettings(merged);
    var store = resolveStorage(w);
    if (store) {
      try {
        store.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch (err) {
        // 忽略配额或权限异常
      }
    }
    try {
      if (w && typeof w.dispatchEvent === "function" && typeof w.CustomEvent === "function") {
        w.dispatchEvent(new w.CustomEvent(SETTINGS_EVENT, { detail: next }));
      }
    } catch (err) {
      // 忽略无 CustomEvent 构造器的测试环境
    }
    return next;
  }

  function resetSettings(win) {
    return writeSettings(schemaDefaults(), win);
  }

  function onSettingsChange(listener, win) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    if (!w || typeof w.addEventListener !== "function") return function () {};
    function handleCustom(ev) {
      listener(ev && ev.detail ? normalizeSettings(ev.detail) : readSettings(w));
    }
    function handleStorage(ev) {
      if (!ev || (ev.key !== SETTINGS_KEY && ev.key !== LEGACY_SETTINGS_KEY)) return;
      listener(readSettings(w));
    }
    w.addEventListener(SETTINGS_EVENT, handleCustom);
    w.addEventListener("storage", handleStorage);
    return function () {
      w.removeEventListener(SETTINGS_EVENT, handleCustom);
      w.removeEventListener("storage", handleStorage);
    };
  }

  function prefersReducedMotion(win) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    try {
      if (w && typeof w.matchMedia === "function") {
        var mq = w.matchMedia("(prefers-reduced-motion: reduce)");
        if (mq && mq.matches) return true;
      }
    } catch (err) {
      // 忽略不支持 matchMedia 的环境
    }
    return false;
  }

  function motionMode(win, explicitSettings) {
    if (prefersReducedMotion(win)) return "quick";
    var s = explicitSettings ? normalizeSettings(explicitSettings) : readSettings(win);
    return s.motion || "fast";
  }

  function motionParamsForMode(mode) {
    if (mode === "quick") return MOTION_REDUCED;
    if (mode === "full") return MOTION;
    return MOTION_FAST;
  }

  // ── 诊断环形缓冲区 ──────────────────────────────────────────────────────────
  var TRACE_CAPACITY = 200;
  var traceRingBuffer = [];

  function tracePush(type, detail) {
    var entry = { t: Date.now(), type: String(type || "event") };
    if (detail && typeof detail === "object") {
      var keys = Object.keys(detail);
      for (var i = 0; i < keys.length; i += 1) {
        entry[keys[i]] = detail[keys[i]];
      }
    }
    traceRingBuffer.push(entry);
    if (traceRingBuffer.length > TRACE_CAPACITY) {
      traceRingBuffer.splice(0, traceRingBuffer.length - TRACE_CAPACITY);
    }
  }

  function dumpTrace(win) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    return {
      plugin: "antigravity-codex-effort-slider@1.0.0",
      time: new Date().toISOString(),
      ua: w && w.navigator ? w.navigator.userAgent : "node",
      settings: readSettings(w),
      events: traceRingBuffer.slice()
    };
  }

  function traceClear() {
    traceRingBuffer.length = 0;
  }

  // ── 数学、物理与刻度换算 ────────────────────────────────────────────────────
  function clamp01(value) {
    var num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    if (num >= 1) return 1;
    return num;
  }

  function clampAbs(value, limit) {
    var lim = Math.max(0, Number(limit) || 0);
    var num = Number(value) || 0;
    if (num > lim) return lim;
    if (num < -lim) return -lim;
    return num;
  }

  function pctFromIndex(index, count) {
    var n = Number(count) || 0;
    if (n <= 1) return 0;
    var idx = Math.max(0, Math.min(n - 1, Math.round(Number(index) || 0)));
    return idx / (n - 1);
  }

  function indexFromPct(pct, count) {
    var n = Number(count) || 0;
    if (n <= 1) return 0;
    var p = clamp01(pct);
    return Math.max(0, Math.min(n - 1, Math.round(p * (n - 1))));
  }

  /**
   * 迟滞棘轮分档器（Hysteresis Detent）：
   * - 向新档位方向推进过 1/3 格宽即刻触发跳档，保证「拖过边界立即切档」的轻快手感；
   * - 往回退则需要退过 2/3 格宽（留出 [1/3, 2/3] 迟滞带），防止手指停在边界附近时左右抖动。
   */
  function detentTargetIndex(currentIndex, ptrPct, count) {
    var n = Number(count) || 0;
    if (n <= 1) return 0;
    var p = clamp01(ptrPct);
    if (typeof currentIndex !== "number" || currentIndex < 0 || currentIndex >= n) {
      return indexFromPct(p, n);
    }
    var step = 1 / (n - 1);
    var forwardThreshold = 1 / 3;
    var idx = currentIndex;
    var curCenter = idx * step;
    if (p >= curCenter) {
      while (idx < n - 1 && p >= (idx + forwardThreshold) * step - 1e-9) {
        idx += 1;
      }
    } else {
      while (idx > 0 && p <= (idx - forwardThreshold) * step + 1e-9) {
        idx -= 1;
      }
    }
    return idx;
  }

  function knobOffsetOf(pct, radiusPx) {
    var p = clamp01(pct);
    var r = typeof radiusPx === "number" && Number.isFinite(radiusPx) ? radiusPx : KNOB_RADIUS;
    return "calc(" + r + "px + (100% - " + (r * 2) + "px) * " + p + ")";
  }

  function motionSettled(state, params) {
    if (!state) return true;
    var cfg = params || MOTION;
    var dist = Math.abs((Number(state.target) || 0) - (Number(state.x) || 0));
    var vel = Math.abs(Number(state.v) || 0);
    return dist <= cfg.snapEps && vel <= cfg.velEps;
  }

  /**
   * 连续物理步进器：基于刹车距离 v^2 / (2 * decel) 平滑追赶 target，无过冲回弹
   */
  function motionStep(state, dtSeconds, params) {
    if (!state) return;
    var cfg = params || MOTION;
    var dt = Number(dtSeconds);
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (dt > 0.05) dt = 0.05;

    var target = clamp01(state.target);
    var x = clamp01(state.x);
    var v = Number(state.v) || 0;
    var diff = target - x;
    var dist = Math.abs(diff);

    if (dist <= cfg.snapEps && Math.abs(v) <= cfg.velEps) {
      state.x = target;
      state.v = 0;
      state.a = 0;
      return;
    }

    var dir = diff >= 0 ? 1 : -1;
    var movingTowards = v * dir >= 0;
    var stopDist = (v * v) / (2 * cfg.decel);
    var a = 0;

    if (!movingTowards) {
      a = dir * cfg.accel;
    } else if (stopDist >= dist) {
      a = -dir * cfg.decel;
    } else {
      a = dir * cfg.accel;
    }

    var nextV = clampAbs(v + a * dt, cfg.maxSpeed);
    var nextX = x + nextV * dt;

    // 防止单步跨越目标造成振荡
    if ((target - x) * (target - nextX) <= 0 && Math.abs(nextV) <= cfg.maxSpeed) {
      state.x = target;
      state.v = 0;
      state.a = 0;
      return;
    }

    if (nextX <= 0) {
      state.x = 0;
      state.v = Math.max(0, nextV);
      state.a = a;
      return;
    }
    if (nextX >= 1) {
      state.x = 1;
      state.v = Math.min(0, nextV);
      state.a = a;
      return;
    }

    state.x = nextX;
    state.v = nextV;
    state.a = a;
  }

  function decayPointerSpeed(rawSpeed, idleSeconds) {
    var v = Number(rawSpeed) || 0;
    var idle = Number(idleSeconds) || 0;
    if (idle <= POINTER_STALE_S) return v;
    var decay = Math.exp(-(idle - POINTER_STALE_S) / POINTER_SPEED_TAU);
    var out = v * decay;
    return Math.abs(out) < 1e-4 ? 0 : out;
  }

  function releaseIndexFor(ptrPct, rawSpeed, idleSeconds, count) {
    var v = decayPointerSpeed(rawSpeed, idleSeconds);
    var projected = clamp01((Number(ptrPct) || 0) + v * RELEASE_PROJECT_S);
    return indexFromPct(projected, count);
  }

  // ── 22 颗黄金分割确定性星尘与色彩引擎 ───────────────────────────────────────
  var PARTICLE_COUNT = 22;

  function starHash01(index, salt) {
    var seed = ((index + 1) * 1103515245 + (salt || 1) * 12345 + 0x9e3779b9) >>> 0;
    seed = ((seed >>> 16) ^ seed) * 0x45d9f3b >>> 0;
    seed = ((seed >>> 16) ^ seed) * 0x45d9f3b >>> 0;
    seed = (seed >>> 16) ^ seed;
    return (seed >>> 0) / 4294967295;
  }

  var PARTICLES = Object.freeze(
    Array.from({ length: PARTICLE_COUNT }, function (_, i) {
      // X 轴分层均匀排布，Y 轴采用黄金分割低差异序列彻底消除团簇
      var xRatio = (i + 0.5) / PARTICLE_COUNT;
      var phi = 0.6180339887498949;
      var yRaw = (0.5 + (i + 1) * phi) % 1;
      var yPct = 14 + yRaw * 72;
      var sizeRand = starHash01(i, 3);
      var size = sizeRand > 0.72 ? 2.6 : sizeRand > 0.32 ? 2.1 : 1.6;
      // 激活阈值同样采用质数步长置换，保证能量推高时全轨道均匀点亮而非从左往右点亮
      var thresholdSlot = ((i * 7 + 3) % PARTICLE_COUNT) / PARTICLE_COUNT;
      var durationBase = 2.0 + starHash01(i, 7) * 2.2;
      var delayBase = -starHash01(i, 13) * 4.2;
      var peakAlpha = 0.62 + starHash01(i, 19) * 0.38;
      return Object.freeze({
        id: i,
        x: Math.round(xRatio * 10000) / 100,
        y: Math.round(yPct * 100) / 100,
        size: size,
        threshold: Math.round(thresholdSlot * 10000) / 10000,
        duration: Math.round(durationBase * 1000) / 1000,
        delay: Math.round(delayBase * 1000) / 1000,
        peakAlpha: Math.round(peakAlpha * 1000) / 1000
      });
    })
  );

  function isOffLevel(text) {
    if (text === null || text === undefined) return false;
    var s = String(text).trim().toLowerCase();
    if (!s) return false;
    return (
      s === "off" ||
      s === "none" ||
      s === "disabled" ||
      s === "0" ||
      s === "关闭" ||
      s === "关" ||
      s === "不推理" ||
      s === "无"
    );
  }

  /**
   * 根据档位列表自动推导能量起点与中点：
   * - 若首档为 Off（如 4 档 Off / Low / High / Max），则第 1 档 (Low) 为纯蓝无星尘起点：
   *   start = 1 / (count - 1), end = (start + 1) / 2
   * - 若首档不是 Off（如 Antigravity 的 3 档 Low / Medium / High），则第 0 档 (Low) 为纯蓝起点：
   *   start = 0, end = 0.5
   */
  function energyStopsFor(levels) {
    var list = Array.isArray(levels) ? levels : [];
    var n = list.length;
    if (n <= 1) return { start: 0, end: 0.5, hasOffFirst: false };
    var first = list[0];
    var firstLabel = first && typeof first === "object" ? (first.effort || first.label || first.id || "") : String(first || "");
    var hasOffFirst = isOffLevel(firstLabel);
    var start = hasOffFirst ? 1 / (n - 1) : 0;
    var end = (start + 1) / 2;
    return { start: start, end: end, hasOffFirst: hasOffFirst };
  }

  function energyForPct(pct, startOverride) {
    var p = clamp01(pct);
    var start = typeof startOverride === "number" && Number.isFinite(startOverride) ? clamp01(startOverride) : ENERGY_START;
    if (p <= start || start >= 1) return 0;
    return clamp01((p - start) / (1 - start));
  }

  function starBrightnessFor(star, energy) {
    var e = clamp01(energy);
    if (e <= 0 || !star) return 0;
    var thresh = Number(star.threshold) || 0;
    if (e <= thresh) return 0;
    var ramp = Math.min(1, (e - thresh) / 0.12);
    return Math.round(ramp * (star.peakAlpha || 0.85) * 1000) / 1000;
  }

  function starDurationFor(star) {
    var d = star && typeof star.duration === "number" ? star.duration : 2.6;
    return (Math.round((d / BASE_SPEEDUP) * 1000) / 1000) + "s";
  }

  function starDelayFor(star) {
    var delay = star && typeof star.delay === "number" ? star.delay : -1.2;
    return (Math.round((delay / BASE_SPEEDUP) * 1000) / 1000) + "s";
  }

  function starLayerOpacityFor(energy) {
    var e = clamp01(energy);
    if (e <= 0) return 0;
    return Math.round(Math.min(1, 0.35 + e * 0.65) * 1000) / 1000;
  }

  function parseHexRgb(hex) {
    var clean = String(hex || "").replace(/^#/, "");
    var num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function mixHex(hexA, hexB, t) {
    var ratio = clamp01(t);
    var a = parseHexRgb(hexA);
    var b = parseHexRgb(hexB);
    var r = Math.round(a[0] + (b[0] - a[0]) * ratio);
    var g = Math.round(a[1] + (b[1] - a[1]) * ratio);
    var bl = Math.round(a[2] + (b[2] - a[2]) * ratio);
    return (
      "#" +
      ((1 << 24) | (r << 16) | (g << 8) | bl)
        .toString(16)
        .slice(1)
    );
  }

  /**
   * 填充区末端主色：
   * - pct <= start          : #4d93f8 (Codex 纯蓝)
   * - start < pct <= end    : #4d93f8 -> #9333ea (蓝紫过渡)
   * - end < pct <= 1        : #9333ea -> #4c1d95 (深紫星云)
   */
  function fillColorFor(pct, startOverride, endOverride) {
    var p = clamp01(pct);
    var start = typeof startOverride === "number" && Number.isFinite(startOverride) ? startOverride : ENERGY_START;
    var end = typeof endOverride === "number" && Number.isFinite(endOverride) ? endOverride : ENERGY_END;
    if (p <= start + 1e-6) return "#4d93f8";
    if (p <= end + 1e-6) {
      var span1 = Math.max(1e-6, end - start);
      return mixHex("#4d93f8", "#9333ea", (p - start) / span1);
    }
    var span2 = Math.max(1e-6, 1 - end);
    return mixHex("#9333ea", "#4c1d95", (p - end) / span2);
  }

  /**
   * 填充区线性渐变背景：
   * 让轨道左侧始终保留蓝色起点，随滑块向右推进依次展开蓝紫过渡与深紫星云
   */
  function fillBackgroundFor(pct, startOverride, endOverride) {
    var p = clamp01(pct);
    var start = typeof startOverride === "number" && Number.isFinite(startOverride) ? startOverride : ENERGY_START;
    var end = typeof endOverride === "number" && Number.isFinite(endOverride) ? endOverride : ENERGY_END;
    if (p <= start + 1e-6) return "#4d93f8";
    var endColor = fillColorFor(p, start, end);
    if (p <= end + 1e-6) {
      var stopBlue = start > 0 ? Math.round((start / p) * 100) : 0;
      if (stopBlue <= 0) {
        return "linear-gradient(90deg, #4d93f8 0%, " + endColor + " 100%)";
      }
      return "linear-gradient(90deg, #4d93f8 0%, #4d93f8 " + stopBlue + "%, " + endColor + " 100%)";
    }
    var stopStart = start > 0 ? Math.round((start / p) * 100) : 0;
    var stopMid = Math.round((end / p) * 100);
    if (stopStart <= 0) {
      return "linear-gradient(90deg, #4d93f8 0%, #9333ea " + stopMid + "%, " + endColor + " 100%)";
    }
    return (
      "linear-gradient(90deg, #4d93f8 0%, #4d93f8 " +
      stopStart +
      "%, #9333ea " +
      stopMid +
      "%, " +
      endColor +
      " 100%)"
    );
  }

  /**
   * 档位文字着色：
   * - 单档位锁定模型或 Off 档位保持官方默认灰（返回 ""）
   * - 最高档（High / Max）返回亮紫 #8b5cf6
   * - 首档有效档位（Low）返回亮蓝 #4d93f8，中间档位（Medium）按比例平滑插值 (#6c78f7)
   */
  function valueColorFor(label, index, count, isMax, hasOffFirst) {
    if (isOffLevel(label)) return "";
    var n = Number(count) || 0;
    if (n <= 1) return "";
    if (isMax || index === n - 1) return "#8b5cf6";
    var idx = typeof index === "number" && index >= 0 ? index : 0;
    var firstActive = hasOffFirst ? 1 : 0;
    if (idx <= firstActive) return "#4d93f8";
    var denom = Math.max(1, n - 1 - firstActive);
    var t = clamp01((idx - firstActive) / denom);
    return mixHex("#4d93f8", "#8b5cf6", t);
  }

  // ── 样式表注入（含 Codex 轨道特效、Antigravity 底部滑条区与子菜单屏蔽、右键设置面板） ──
  var SLIDER_CSS = [
    "@keyframes ces-sweep-slide {",
    "  0% { transform: translateX(-120%) skewX(-18deg); }",
    "  100% { transform: translateX(220%) skewX(-18deg); }",
    "}",
    "@keyframes ces-star-twinkle {",
    "  0%, 100% { opacity: calc(var(--ces-star-b, 0) * 0.28); transform: scale(0.75); }",
    "  50% { opacity: var(--ces-star-b, 0); transform: scale(1.22); }",
    "}",
    ".ces-inline {",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "  padding-top: 6px;",
    "  user-select: none;",
    "  -webkit-user-select: none;",
    "}",
    ".ces-root {",
    "  position: relative;",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "  outline: none;",
    "}",
    ".ces-track {",
    "  position: relative;",
    "  width: 100%;",
    "  height: " + TRACK_HEIGHT + "px;",
    "  border-radius: 9999px;",
    "  background: rgba(128, 128, 145, 0.18);",
    "  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.24), inset 0 0 0 1px rgba(255, 255, 255, 0.06);",
    "  overflow: hidden;",
    "  cursor: pointer;",
    "  touch-action: none;",
    "  box-sizing: border-box;",
    "  transition: opacity 0.15s ease;",
    "}",
    ".ces-track.is-locked {",
    "  opacity: 0.45;",
    "  cursor: not-allowed;",
    "  filter: saturate(0.25);",
    "}",
    ".ces-fill {",
    "  position: absolute;",
    "  top: 0;",
    "  left: 0;",
    "  bottom: 0;",
    "  width: var(--ces-fill, 14px);",
    "  min-width: " + KNOB_SIZE + "px;",
    "  max-width: 100%;",
    "  border-radius: 9999px;",
    "  background: var(--ces-fill-bg, #4d93f8);",
    "  overflow: hidden;",
    "  pointer-events: none;",
    "  will-change: width, background;",
    "}",
    ".ces-sweep {",
    "  position: absolute;",
    "  inset: 0;",
    "  opacity: var(--ces-sweep-opacity, 0);",
    "  background: linear-gradient(90deg, transparent 0%, rgba(216, 180, 254, 0.36) 48%, rgba(255, 255, 255, 0.52) 52%, transparent 100%);",
    "  animation: ces-sweep-slide 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;",
    "  pointer-events: none;",
    "}",
    ".ces-stars {",
    "  position: absolute;",
    "  inset: 0;",
    "  opacity: var(--ces-star-opacity, 0);",
    "  pointer-events: none;",
    "  overflow: hidden;",
    "}",
    ".ces-star {",
    "  position: absolute;",
    "  border-radius: 9999px;",
    "  background: #ffffff;",
    "  box-shadow: 0 0 4px 1px rgba(233, 213, 255, 0.9);",
    "  opacity: var(--ces-star-b, 0);",
    "  animation-name: ces-star-twinkle;",
    "  animation-timing-function: ease-in-out;",
    "  animation-iteration-count: infinite;",
    "  pointer-events: none;",
    "  will-change: opacity, transform;",
    "}",
    ".ces-ticks {",
    "  position: absolute;",
    "  inset: 0;",
    "  pointer-events: none;",
    "}",
    ".ces-tick {",
    "  position: absolute;",
    "  top: 50%;",
    "  width: 4px;",
    "  height: 4px;",
    "  border-radius: 9999px;",
    "  transform: translate(-50%, -50%);",
    "  background: rgba(255, 255, 255, 0.26);",
    "  transition: background-color 0.12s ease, transform 0.12s ease;",
    "}",
    ".ces-tick.is-on {",
    "  background: rgba(255, 255, 255, 0.88);",
    "  box-shadow: 0 0 4px rgba(255, 255, 255, 0.55);",
    "}",
    ".ces-tick.is-dim {",
    "  background: rgba(255, 255, 255, 0.28);",
    "  box-shadow: none;",
    "}",
    ".ces-knob {",
    "  position: absolute;",
    "  top: 50%;",
    "  left: var(--ces-fill, 14px);",
    "  width: " + KNOB_SIZE + "px;",
    "  height: " + KNOB_SIZE + "px;",
    "  border-radius: 9999px;",
    "  transform: translate(-50%, -50%);",
    "  background: #ffffff;",
    "  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(0, 0, 0, 0.08);",
    "  pointer-events: none;",
    "  will-change: left;",
    "}",
    "/* Antigravity 原生模型菜单底部专属「推理等级」区域 */",
    "[data-testid='model-selector-panel'].ces-ag-panel-enhanced {",
    "  max-height: 26rem !important;",
    "}",
    ".ces-ag-section {",
    "  display: flex;",
    "  flex-direction: column;",
    "  flex-shrink: 0;",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "}",
    ".ces-ag-effort-row {",
    "  display: flex;",
    "  flex-direction: column;",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "  padding: 6px 8px 8px 8px;",
    "  border-radius: 6px;",
    "  transition: box-shadow 0.2s ease, background-color 0.2s ease;",
    "}",
    ".ces-ag-effort-row:hover {",
    "  background-color: rgba(128, 128, 145, 0.08);",
    "}",
    ".ces-ag-effort-row[data-ces-max='true'], [data-ces-effort-row='true'][data-ces-max='true'] {",
    "  box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.42), 0 0 14px -4px rgba(139, 92, 246, 0.45);",
    "  background-color: rgba(139, 92, 246, 0.06);",
    "}",
    ".ces-ag-effort-head {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  width: 100%;",
    "  font-size: 12px;",
    "  line-height: 16px;",
    "}",
    ".ces-ag-effort-title {",
    "  display: inline-flex;",
    "  align-items: center;",
    "  gap: 6px;",
    "  color: inherit;",
    "  font-weight: 500;",
    "  opacity: 0.9;",
    "}",
    ".ces-ag-effort-value {",
    "  font-size: 12px;",
    "  font-weight: 600;",
    "  transition: color 0.15s ease;",
    "}",
    "/* 屏蔽模型行悬停弹出的冗余右侧二级档位子菜单（不影响 View Usage 配额弹窗） */",
    "[role='menu']:has([data-testid='model-selector-effort-option']),",
    "div[data-floating-ui-portal]:has([data-testid='model-selector-effort-option']),",
    "div:has(> [role='menu'] [data-testid='model-selector-effort-option']) {",
    "  display: none !important;",
    "  visibility: hidden !important;",
    "  pointer-events: none !important;",
    "  opacity: 0 !important;",
    "}",
    "[role='menuitem']:has([data-testid='model-selector-effort-group']) > span.shrink-0:last-child {",
    "  display: none !important;",
    "}",
    "[role='menuitem'][data-ces-model-selected='true'] {",
    "  background-color: rgba(128, 128, 145, 0.14);",
    "}",
    "/* 右键 / 长按 设置浮层 */",
    ".ces-set {",
    "  position: fixed;",
    "  z-index: 2147483646;",
    "  width: 268px;",
    "  padding: 12px;",
    "  border-radius: 10px;",
    "  background: rgba(24, 24, 28, 0.96);",
    "  color: #f4f4f6;",
    "  border: 1px solid rgba(255, 255, 255, 0.12);",
    "  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);",
    "  backdrop-filter: blur(12px);",
    "  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
    "  font-size: 12px;",
    "  box-sizing: border-box;",
    "  user-select: none;",
    "}",
    ".ces-set-head {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  margin-bottom: 10px;",
    "  padding-bottom: 6px;",
    "  border-bottom: 1px solid rgba(255, 255, 255, 0.08);",
    "  font-weight: 600;",
    "  font-size: 12.5px;",
    "}",
    ".ces-set-ver {",
    "  font-size: 11px;",
    "  font-weight: 400;",
    "  opacity: 0.55;",
    "}",
    ".ces-set-group {",
    "  margin-bottom: 10px;",
    "}",
    ".ces-set-label {",
    "  margin-bottom: 5px;",
    "  font-size: 11px;",
    "  opacity: 0.72;",
    "}",
    ".ces-set-opts {",
    "  display: flex;",
    "  gap: 4px;",
    "}",
    ".ces-set-opt {",
    "  flex: 1;",
    "  padding: 5px 6px;",
    "  border-radius: 6px;",
    "  border: 1px solid rgba(255, 255, 255, 0.1);",
    "  background: rgba(255, 255, 255, 0.04);",
    "  color: #d4d4d8;",
    "  font-size: 11.5px;",
    "  cursor: pointer;",
    "  text-align: center;",
    "  transition: all 0.12s ease;",
    "}",
    ".ces-set-opt:hover {",
    "  background: rgba(255, 255, 255, 0.1);",
    "  color: #ffffff;",
    "}",
    ".ces-set-opt.is-on {",
    "  background: rgba(139, 92, 246, 0.28);",
    "  border-color: rgba(139, 92, 246, 0.75);",
    "  color: #ffffff;",
    "  font-weight: 600;",
    "}",
    ".ces-set-actions {",
    "  display: flex;",
    "  gap: 6px;",
    "  margin-top: 8px;",
    "  padding-top: 8px;",
    "  border-top: 1px solid rgba(255, 255, 255, 0.08);",
    "}",
    ".ces-set-btn {",
    "  flex: 1;",
    "  padding: 5px 8px;",
    "  border-radius: 6px;",
    "  border: 1px solid rgba(255, 255, 255, 0.12);",
    "  background: rgba(255, 255, 255, 0.06);",
    "  color: #e4e4e7;",
    "  font-size: 11px;",
    "  cursor: pointer;",
    "}",
    ".ces-set-btn:hover {",
    "  background: rgba(255, 255, 255, 0.14);",
    "}"
  ].join("\n");

  function installStyles(doc) {
    var d = doc || (typeof document !== "undefined" ? document : null);
    if (!d || !d.head) return null;
    var existing = d.getElementById(STYLE_ELEMENT_ID);
    if (existing) return existing;
    var style = d.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = SLIDER_CSS;
    d.head.appendChild(style);
    return style;
  }

  // ── 右键设置面板 ────────────────────────────────────────────────────────────
  function openSettingsPanel(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (doc && doc.defaultView) || (typeof window !== "undefined" ? window : globalRoot);
    if (!doc || !doc.body) return function () {};
    installStyles(doc);

    var prev = doc.querySelector(".ces-set");
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

    var panel = doc.createElement("div");
    panel.className = "ces-set";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "推理等级滑条设置");

    var x = typeof opts.x === "number" ? opts.x : 120;
    var y = typeof opts.y === "number" ? opts.y : 120;
    var vw = (win && win.innerWidth) || 800;
    var vh = (win && win.innerHeight) || 600;
    var clampedLeft = Math.max(8, Math.min(vw - 276, x));
    var clampedTop = Math.max(8, Math.min(vh - 230, y));
    panel.style.left = clampedLeft + "px";
    panel.style.top = clampedTop + "px";

    var head = doc.createElement("div");
    head.className = "ces-set-head";
    var titleSpan = doc.createElement("span");
    titleSpan.textContent = "推理等级滑条";
    var verSpan = doc.createElement("span");
    verSpan.className = "ces-set-ver";
    verSpan.textContent = "v1.0.0";
    head.appendChild(titleSpan);
    head.appendChild(verSpan);
    panel.appendChild(head);

    var optButtons = [];
    function refreshActiveButtons() {
      var cur = readSettings(win);
      for (var i = 0; i < optButtons.length; i += 1) {
        var item = optButtons[i];
        var isOn = cur[item.key] === item.value;
        if (isOn) item.btn.classList.add("is-on");
        else item.btn.classList.remove("is-on");
        item.btn.setAttribute("aria-pressed", isOn ? "true" : "false");
      }
    }

    for (var sIdx = 0; sIdx < SETTINGS_SCHEMA.length; sIdx += 1) {
      (function (schemaItem) {
        var group = doc.createElement("div");
        group.className = "ces-set-group";
        var label = doc.createElement("div");
        label.className = "ces-set-label";
        label.textContent = schemaItem.label;
        group.appendChild(label);

        var row = doc.createElement("div");
        row.className = "ces-set-opts";
        for (var oIdx = 0; oIdx < schemaItem.options.length; oIdx += 1) {
          (function (optionItem) {
            var btn = doc.createElement("button");
            btn.type = "button";
            btn.className = "ces-set-opt";
            btn.textContent = optionItem.label;
            if (optionItem.hint) btn.title = optionItem.hint;
            btn.addEventListener("click", function (ev) {
              ev.stopPropagation();
              var patch = {};
              patch[schemaItem.key] = optionItem.value;
              writeSettings(patch, win);
              refreshActiveButtons();
            });
            optButtons.push({ key: schemaItem.key, value: optionItem.value, btn: btn });
            row.appendChild(btn);
          })(schemaItem.options[oIdx]);
        }
        group.appendChild(row);
        panel.appendChild(group);
      })(SETTINGS_SCHEMA[sIdx]);
    }

    var actions = doc.createElement("div");
    actions.className = "ces-set-actions";

    var copyBtn = doc.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ces-set-btn";
    copyBtn.textContent = "复制诊断";
    copyBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var payload = JSON.stringify(dumpTrace(win), null, 2);
      try {
        if (win && win.navigator && win.navigator.clipboard && typeof win.navigator.clipboard.writeText === "function") {
          win.navigator.clipboard.writeText(payload);
        }
      } catch (err) {
        // 忽略剪贴板权限错误
      }
      copyBtn.textContent = "已复制";
    });

    var resetBtn = doc.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "ces-set-btn";
    resetBtn.textContent = "恢复默认";
    resetBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      resetSettings(win);
      refreshActiveButtons();
    });

    var closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ces-set-btn";
    closeBtn.textContent = "关闭";

    actions.appendChild(copyBtn);
    actions.appendChild(resetBtn);
    actions.appendChild(closeBtn);
    panel.appendChild(actions);

    refreshActiveButtons();
    var offSettings = onSettingsChange(function () {
      refreshActiveButtons();
    }, win);

    function closePanel() {
      offSettings();
      doc.removeEventListener("pointerdown", onDocPointerDown, true);
      doc.removeEventListener("keydown", onDocKeyDown, true);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    }

    closeBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      closePanel();
    });

    function onDocPointerDown(ev) {
      if (!panel.contains(ev.target)) {
        closePanel();
      }
    }
    function onDocKeyDown(ev) {
      if (ev && ev.key === "Escape") {
        ev.stopPropagation();
        closePanel();
      }
    }

    doc.addEventListener("pointerdown", onDocPointerDown, true);
    doc.addEventListener("keydown", onDocKeyDown, true);
    doc.body.appendChild(panel);
    return closePanel;
  }

  function installSettingsUi(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (doc && doc.defaultView) || (typeof window !== "undefined" ? window : globalRoot);
    if (!doc) return { stop: function () {} };

    var activeClose = null;
    var longPressTimer = null;
    var pressStartPos = null;

    function isInsideSlider(target) {
      if (!target || typeof target.closest !== "function") return null;
      return target.closest(".ces-inline, .ces-root, .ces-ag-effort-row");
    }

    function clearLongPress() {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      pressStartPos = null;
    }

    function onContextMenu(ev) {
      var host = isInsideSlider(ev.target);
      if (!host) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (activeClose) activeClose();
      activeClose = openSettingsPanel({
        document: doc,
        window: win,
        x: ev.clientX || 120,
        y: ev.clientY || 120
      });
    }

    function onKeyDown(ev) {
      var host = isInsideSlider(ev.target);
      if (!host) return;
      if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) {
        ev.preventDefault();
        ev.stopPropagation();
        var rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 120, bottom: 120 };
        if (activeClose) activeClose();
        activeClose = openSettingsPanel({
          document: doc,
          window: win,
          x: rect.left,
          y: rect.bottom + 4
        });
      }
    }

    function onPointerDown(ev) {
      var host = isInsideSlider(ev.target);
      if (!host || ev.button === 2) return;
      clearLongPress();
      pressStartPos = { x: ev.clientX || 0, y: ev.clientY || 0 };
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        if (activeClose) activeClose();
        activeClose = openSettingsPanel({
          document: doc,
          window: win,
          x: (pressStartPos && pressStartPos.x) || 120,
          y: (pressStartPos && pressStartPos.y) || 120
        });
      }, 500);
    }

    function onPointerMove(ev) {
      if (!pressStartPos || longPressTimer === null) return;
      var dx = (ev.clientX || 0) - pressStartPos.x;
      var dy = (ev.clientY || 0) - pressStartPos.y;
      if (dx * dx + dy * dy > 36) {
        clearLongPress();
      }
    }

    function onPointerUp() {
      clearLongPress();
    }

    doc.addEventListener("contextmenu", onContextMenu, true);
    doc.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("pointermove", onPointerMove, true);
    doc.addEventListener("pointerup", onPointerUp, true);
    doc.addEventListener("pointercancel", onPointerUp, true);

    return {
      stop: function () {
        clearLongPress();
        if (activeClose) {
          activeClose();
          activeClose = null;
        }
        doc.removeEventListener("contextmenu", onContextMenu, true);
        doc.removeEventListener("keydown", onKeyDown, true);
        doc.removeEventListener("pointerdown", onPointerDown, true);
        doc.removeEventListener("pointermove", onPointerMove, true);
        doc.removeEventListener("pointerup", onPointerUp, true);
        doc.removeEventListener("pointercancel", onPointerUp, true);
      }
    };
  }

  // ── DOM 与 Antigravity React Fiber 解析辅助函数 ─────────────────────────────
  var INFERENCE_LABELS = ["推理等级", "Reasoning effort", "Reasoning Effort", "Thinking effort", "推理强度"];

  function parseModelLabel(label) {
    if (!label || typeof label !== "string") return null;
    var match = AG_MODEL_LABEL_RE.exec(label.trim());
    if (!match) return null;
    var base = match[1].trim();
    var effort = match[2].toLowerCase();
    return {
      base: base,
      effort: effort,
      effortLabel: AG_EFFORT_LABELS[effort] || match[2]
    };
  }

  function findAntigravityTrigger(doc) {
    var d = doc || (typeof document !== "undefined" ? document : null);
    if (!d || typeof d.querySelector !== "function") return null;
    return (
      d.querySelector('[data-testid="model-selector-trigger"]') ||
      d.querySelector('button[aria-label^="Select model"]')
    );
  }

  function findAntigravityPanel(doc) {
    var d = doc || (typeof document !== "undefined" ? document : null);
    if (!d || typeof d.querySelector !== "function") return null;
    return d.querySelector('[data-testid="model-selector-panel"]');
  }

  function findInferenceRow(doc) {
    var d = doc || (typeof document !== "undefined" ? document : null);
    if (!d || typeof d.querySelectorAll !== "function") return null;
    var explicit = d.querySelector('[data-ces-effort-row="true"]');
    if (explicit) return explicit;

    var menus = d.querySelectorAll('[role="menu"], .surface-menu, [data-testid="model-selector-panel"]');
    for (var mIdx = 0; mIdx < menus.length; mIdx += 1) {
      var menu = menus[mIdx];
      var items = menu.querySelectorAll('[role="menuitem"], .ces-ag-effort-row, div, button');
      for (var i = 0; i < items.length; i += 1) {
        var el = items[i];
        var txt = (el.textContent || "").trim();
        for (var k = 0; k < INFERENCE_LABELS.length; k += 1) {
          var kw = INFERENCE_LABELS[k];
          if (txt === kw || txt.indexOf(kw) === 0) {
            return el.closest('[role="menuitem"]') || el;
          }
        }
      }
    }
    return null;
  }

  function findValueElement(row) {
    if (!row || typeof row.querySelector !== "function") return null;
    var explicit = row.querySelector('[data-ces-part="value"], .ces-ag-effort-value');
    if (explicit) return explicit;

    var children = row.querySelectorAll("span, div");
    var candidate = null;
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (child.closest && child.closest(".ces-inline")) continue;
      if (child.children && child.children.length > 0) continue;
      var t = (child.textContent || "").trim();
      if (!t) continue;
      var isHeaderLabel = false;
      for (var k = 0; k < INFERENCE_LABELS.length; k += 1) {
        if (t === INFERENCE_LABELS[k]) {
          isHeaderLabel = true;
          break;
        }
      }
      if (!isHeaderLabel) candidate = child;
    }
    return candidate;
  }

  function findEffortTrigger(doc) {
    var d = doc || (typeof document !== "undefined" ? document : null);
    if (!d || typeof d.querySelectorAll !== "function") return null;

    // 1. 优先匹配 Antigravity 原生模型选择器按钮中的档位 span (<span class="opacity-70"> High</span>)
    var agTrigger = findAntigravityTrigger(d);
    if (agTrigger) {
      var effortSpan = agTrigger.querySelector("span.opacity-70, [data-ces-part='trigger-effort']");
      if (effortSpan) return effortSpan;
      return agTrigger;
    }

    // 2. 兼容通用 composer 触发器（如包含 " · " 的按钮）
    var composers = d.querySelectorAll(".surface-composer, .surface-composer-card, form, body");
    for (var cIdx = 0; cIdx < composers.length; cIdx += 1) {
      var buttons = composers[cIdx].querySelectorAll('button[aria-haspopup="menu"]');
      for (var bIdx = 0; bIdx < buttons.length; bIdx += 1) {
        var btn = buttons[bIdx];
        if ((btn.textContent || "").indexOf(" · ") >= 0) return btn;
      }
    }
    return null;
  }

  function syncTriggerColor(doc, label, index, count, isMax, hasOffFirst) {
    var d = doc || (typeof document !== "undefined" ? document : null);
    if (!d) return;
    var color = valueColorFor(label, index, count, isMax, hasOffFirst);

    // 1. Antigravity 原生触发按钮：只给档位后缀 span 着色，保持模型名称本身清晰易读
    var agTrigger = findAntigravityTrigger(d);
    if (agTrigger) {
      var effortSpan = agTrigger.querySelector("span.opacity-70, [data-ces-part='trigger-effort']");
      if (effortSpan) {
        effortSpan.setAttribute("data-ces-part", "trigger-effort");
        effortSpan.style.color = color || "";
        effortSpan.style.opacity = color ? "1" : "";
        effortSpan.style.fontWeight = color ? "600" : "";
      }
      return;
    }

    // 2. 兼容通用触发按钮
    var trigger = findEffortTrigger(d);
    if (!trigger) return;
    var spans = trigger.querySelectorAll("span");
    var target = spans.length > 0 ? spans[spans.length - 1] : trigger;
    target.style.color = color || "";
  }

  function findSeatEffort(win) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    var map = w && w.__dshSeats;
    if (!map || typeof map.forEach !== "function") return null;
    var found = null;
    map.forEach(function (seat) {
      if (found) return;
      if (seat && Array.isArray(seat.effortLevels)) {
        found = seat;
      }
    });
    return found;
  }

  function getReactFiber(el) {
    if (!el || typeof el !== "object") return null;
    var raw = null;
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i += 1) {
      var k = keys[i];
      if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0) {
        raw = el[k];
        break;
      }
    }
    if (!raw) return null;
    if (raw.alternate) {
      var root = raw;
      var guard = 0;
      while (root.return && guard < 80) {
        root = root.return;
        guard += 1;
      }
      if (root && root.stateNode && root.stateNode.current && root.stateNode.current !== root) {
        return raw.alternate;
      }
    }
    return raw;
  }

  function buildEffortIndexFromOptions(modelOptions) {
    var indexMap = new Map();
    var list = Array.isArray(modelOptions) ? modelOptions : [];
    for (var i = 0; i < list.length; i += 1) {
      var opt = list[i];
      if (!opt || opt.isCustom || typeof opt.label !== "string") continue;
      var parsed = parseModelLabel(opt.label);
      if (!parsed) continue;
      var byEffort = indexMap.get(parsed.base);
      if (!byEffort) {
        byEffort = new Map();
        indexMap.set(parsed.base, byEffort);
      }
      if (!byEffort.has(parsed.effort)) {
        byEffort.set(parsed.effort, opt);
      }
    }
    return indexMap;
  }

  /**
   * 从 Antigravity 的 DOM 节点向上遍历 React Fiber 树，提取：
   * - OXb.Provider: effortIndex, modelOptions, selectedModel, groups
   * - $Xb         : 未包装 setIsOpen(false) 的 setSelectedModel, open, setIsOpen
   * - cYb         : conversationId
   * - eKa.Provider: setModelConfigByLabelForConversation（直接切档不关菜单、不抢焦点）
   */
  function readAntigravityFiberContext(el) {
    var startFiber = getReactFiber(el);
    if (!startFiber) return null;

    var selectorCtx = null;
    var innerPopoverProps = null;
    var conversationId = undefined;
    var hasConversationSelector = false;
    var globalModelCtx = null;

    var cur = startFiber;
    for (var step = 0; cur && step < 500; step += 1, cur = cur.return) {
      var props = cur.memoizedProps;
      if (!props || typeof props !== "object") continue;

      // 1. OXb.Provider (ModelSelectorProvider)
      if (!selectorCtx && props.value && typeof props.value === "object") {
        var val = props.value;
        if (val.effortIndex instanceof Map && Array.isArray(val.modelOptions)) {
          selectorCtx = val;
        }
      }

      // 2. $Xb (ModelSelectorPopover)
      if (
        !innerPopoverProps &&
        typeof props.setIsOpen === "function" &&
        typeof props.setSelectedModel === "function" &&
        Array.isArray(props.modelOptions)
      ) {
        innerPopoverProps = props;
      }

      // 3. cYb (ConversationModelSelector)
      if (!hasConversationSelector && ("conversationId" in props) && ("placement" in props)) {
        hasConversationSelector = true;
        conversationId = props.conversationId;
      }

      // 4. eKa.Provider (Global Model Context，在 Antigravity 应用中通常位于 ~170 层 Fiber 高度)
      if (
        !globalModelCtx &&
        props.value &&
        typeof props.value === "object" &&
        typeof props.value.setModelConfigByLabelForConversation === "function"
      ) {
        globalModelCtx = props.value;
      }

      if (selectorCtx && innerPopoverProps && hasConversationSelector && globalModelCtx) {
        break;
      }
    }

    if (!selectorCtx && !innerPopoverProps && !globalModelCtx) return null;

    var modelOptions =
      (selectorCtx && selectorCtx.modelOptions) ||
      (innerPopoverProps && innerPopoverProps.modelOptions) ||
      (globalModelCtx && globalModelCtx.visibleModelConfigs) ||
      [];

    var selectedModel =
      (selectorCtx && selectorCtx.selectedModel) ||
      (innerPopoverProps && innerPopoverProps.selectedModel) ||
      (globalModelCtx &&
        (hasConversationSelector && typeof globalModelCtx.getModelConfigForConversation === "function"
          ? globalModelCtx.getModelConfigForConversation(conversationId)
          : globalModelCtx.currentModelConfig)) ||
      null;

    var effortIndex =
      selectorCtx && selectorCtx.effortIndex instanceof Map
        ? selectorCtx.effortIndex
        : buildEffortIndexFromOptions(modelOptions);

    return {
      effortIndex: effortIndex,
      modelOptions: modelOptions,
      selectedModel: selectedModel,
      groups: (selectorCtx && selectorCtx.groups) || [],
      conversationId: conversationId,
      hasConversationSelector: hasConversationSelector,
      setModelConfigByLabelForConversation:
        globalModelCtx && typeof globalModelCtx.setModelConfigByLabelForConversation === "function"
          ? globalModelCtx.setModelConfigByLabelForConversation
          : null,
      setCurrentModelConfigByLabel:
        globalModelCtx && typeof globalModelCtx.setCurrentModelConfigByLabel === "function"
          ? globalModelCtx.setCurrentModelConfigByLabel
          : null,
      unwrappedSetSelectedModel:
        innerPopoverProps && typeof innerPopoverProps.setSelectedModel === "function"
          ? innerPopoverProps.setSelectedModel
          : selectorCtx && typeof selectorCtx.setSelectedModel === "function"
          ? selectorCtx.setSelectedModel
          : null,
      setIsOpen:
        innerPopoverProps && typeof innerPopoverProps.setIsOpen === "function"
          ? innerPopoverProps.setIsOpen
          : null,
      isOpen: innerPopoverProps ? Boolean(innerPopoverProps.open) : false
    };
  }

  /**
   * 剖析当前选中模型（或指定 baseName 模型）在 Antigravity 中的可用推理档位列表
   */
  function resolveModelEffortProfile(ctx, targetModelOrBase, perModelEffortMap) {
    if (!ctx) return null;
    var selected = ctx.selectedModel;
    var modelObj = null;
    var baseName = "";
    var activeEffort = "";

    if (typeof targetModelOrBase === "string" && targetModelOrBase) {
      baseName = targetModelOrBase;
    } else if (targetModelOrBase && typeof targetModelOrBase === "object") {
      modelObj = targetModelOrBase;
    } else {
      modelObj = selected;
    }

    if (modelObj && typeof modelObj.label === "string") {
      var parsed = parseModelLabel(modelObj.label);
      if (parsed) {
        baseName = parsed.base;
        activeEffort = parsed.effort;
      } else {
        baseName = modelObj.label;
      }
    }

    var byEffort = baseName && ctx.effortIndex instanceof Map ? ctx.effortIndex.get(baseName) : null;
    if (byEffort && byEffort.size >= 2) {
      var sortedKeys = [];
      for (var i = 0; i < AG_EFFORT_ORDER.length; i += 1) {
        var key = AG_EFFORT_ORDER[i];
        if (byEffort.has(key)) sortedKeys.push(key);
      }
      if (!activeEffort) {
        if (perModelEffortMap && perModelEffortMap.has(baseName)) {
          var remembered = perModelEffortMap.get(baseName);
          if (byEffort.has(remembered)) activeEffort = remembered;
        }
        if (!activeEffort) {
          var selParsed = selected && parseModelLabel(selected.label);
          if (selParsed && selParsed.base === baseName && byEffort.has(selParsed.effort)) {
            activeEffort = selParsed.effort;
          } else if (byEffort.has("medium")) {
            activeEffort = "medium";
          } else {
            activeEffort = sortedKeys[0] || "";
          }
        }
      }
      var levels = sortedKeys.map(function (k) {
        var opt = byEffort.get(k);
        return {
          effort: k,
          label: AG_EFFORT_LABELS[k] || k,
          modelOption: opt
        };
      });
      var currentIndex = Math.max(0, sortedKeys.indexOf(activeEffort));
      return {
        baseName: baseName,
        locked: false,
        levels: levels,
        currentIndex: currentIndex,
        currentEffort: sortedKeys[currentIndex] || activeEffort,
        currentLabel: AG_EFFORT_LABELS[sortedKeys[currentIndex]] || activeEffort,
        modelOption: byEffort.get(sortedKeys[currentIndex]) || modelObj
      };
    }

    // 单档位模型（如 GPT-OSS 120B (Medium)）或自定义模型：锁定不可拖动
    var singleParsed = modelObj && parseModelLabel(modelObj.label);
    var singleEffort = singleParsed ? singleParsed.effort : "medium";
    var singleLabel = singleParsed ? singleParsed.effortLabel : "固定";
    return {
      baseName: baseName || (modelObj && modelObj.label) || "",
      locked: true,
      levels: [
        {
          effort: singleEffort,
          label: singleLabel,
          modelOption: modelObj
        }
      ],
      currentIndex: 0,
      currentEffort: singleEffort,
      currentLabel: singleLabel,
      modelOption: modelObj
    };
  }

  function commitAntigravityModelOption(ctx, targetOption) {
    if (!ctx || !targetOption || !targetOption.label) return false;
    try {
      // 优先调用 eKa.Provider 的 setModelConfigByLabelForConversation：
      // 直接更新当前会话与全局默认模型，不触发 $Xb 的 setIsOpen(false) 关菜单，也不触发编辑器抢焦点
      if (typeof ctx.setModelConfigByLabelForConversation === "function") {
        ctx.setModelConfigByLabelForConversation(targetOption.label, ctx.conversationId, true);
        return true;
      }
      if (typeof ctx.unwrappedSetSelectedModel === "function") {
        // 兜底保护：cYb 的 setSelectedModel 内部会同步调用 getLexicalEditor()?.focus() 抢夺焦点，
        // 导致 @base-ui/react 菜单因失焦而触发关闭动画；此处在同步调用期间临时屏蔽外部 focus 抢夺
        var origFocus = typeof HTMLElement !== "undefined" && HTMLElement.prototype ? HTMLElement.prototype.focus : null;
        if (origFocus) {
          HTMLElement.prototype.focus = function () {};
        }
        try {
          ctx.unwrappedSetSelectedModel(targetOption);
        } finally {
          if (origFocus) {
            HTMLElement.prototype.focus = origFocus;
          }
        }
        return true;
      }
      if (typeof ctx.setCurrentModelConfigByLabel === "function") {
        ctx.setCurrentModelConfigByLabel(targetOption.label);
        return true;
      }
    } catch (err) {
      tracePush("ag-commit-error", { message: String(err && err.message ? err.message : err) });
    }
    return false;
  }

  // ── 核心滑条挂载器（零外部框架依赖，纯 DOM + 连续物理帧循环） ─────────────────
  function extractEffortKey(item) {
    if (item === null || item === undefined) return "";
    if (typeof item === "string") return item;
    if (typeof item === "object") {
      return String(item.effort || item.id || item.value || item.key || item.label || "");
    }
    return String(item);
  }

  function extractEffortDisplayLabel(item, effortKey, seat) {
    if (item && typeof item === "object" && typeof item.label === "string" && item.label) {
      return item.label;
    }
    if (seat && typeof seat.formatEffortLabel === "function") {
      try {
        var formatted = seat.formatEffortLabel(effortKey);
        if (formatted) return String(formatted);
      } catch (err) {
        // 忽略格式化异常
      }
    }
    var lower = String(effortKey || "").toLowerCase();
    if (AG_EFFORT_LABELS[lower]) return AG_EFFORT_LABELS[lower];
    return String(effortKey || "");
  }

  function mountCodexEffortSlider(options) {
    var opts = options || {};
    var container = opts.container;
    var seat = opts.seat;
    var doc = opts.document || (container && container.ownerDocument) || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (doc && doc.defaultView) || (typeof window !== "undefined" ? window : globalRoot);

    if (!container || !doc) {
      return { unmount: function () {}, refresh: function () {} };
    }

    installStyles(doc);

    // 清空宿主容器并构建 DOM 树
    container.innerHTML = "";
    var rootEl = doc.createElement("div");
    rootEl.className = "ces-root";
    rootEl.setAttribute("role", "slider");
    rootEl.setAttribute("aria-label", "推理等级");

    var trackEl = doc.createElement("div");
    trackEl.className = "ces-track";
    trackEl.setAttribute("data-ces-part", "track");

    var fillEl = doc.createElement("div");
    fillEl.className = "ces-fill";
    fillEl.setAttribute("data-ces-part", "fill");

    var sweepEl = doc.createElement("div");
    sweepEl.className = "ces-sweep";
    sweepEl.setAttribute("data-ces-part", "sweep");
    fillEl.appendChild(sweepEl);

    var starsEl = doc.createElement("div");
    starsEl.className = "ces-stars";
    starsEl.setAttribute("data-ces-part", "stars");

    var starNodes = [];
    for (var sIdx = 0; sIdx < PARTICLES.length; sIdx += 1) {
      var p = PARTICLES[sIdx];
      var starEl = doc.createElement("span");
      starEl.className = "ces-star";
      starEl.setAttribute("data-ces-part", "star");
      starEl.style.left = p.x + "%";
      starEl.style.top = p.y + "%";
      starEl.style.width = p.size + "px";
      starEl.style.height = p.size + "px";
      starEl.style.animationDuration = starDurationFor(p);
      starEl.style.animationDelay = starDelayFor(p);
      starEl.style.setProperty("--ces-star-b", "0");
      starsEl.appendChild(starEl);
      starNodes.push({ el: starEl, meta: p });
    }
    fillEl.appendChild(starsEl);
    trackEl.appendChild(fillEl);

    var ticksEl = doc.createElement("div");
    ticksEl.className = "ces-ticks";
    ticksEl.setAttribute("data-ces-part", "ticks");
    trackEl.appendChild(ticksEl);

    var knobEl = doc.createElement("div");
    knobEl.className = "ces-knob";
    knobEl.setAttribute("data-ces-part", "knob");
    trackEl.appendChild(knobEl);

    rootEl.appendChild(trackEl);
    container.appendChild(rootEl);

    // ── 内部状态机 ──────────────────────────────────────────────────────────
    var destroyed = false;
    var rafId = null;
    var lastFrameMs = 0;

    var dragging = false;
    var buttonDown = false;
    var draftPct = null;
    var draftIndex = null;
    var snapIndex = null;
    var detentIndex = -1;
    var lastCommittedIndex = -1;

    var lastPtrPct = null;
    var lastPtrMs = 0;
    var ptrSpeed = 0;

    var motionState = null;
    var tickNodes = [];
    var lastRenderedTickCount = -1;

    function nowMs() {
      if (win && win.performance && typeof win.performance.now === "function") {
        return win.performance.now();
      }
      return Date.now();
    }

    function readSeatSnapshot() {
      var rawLevels = (seat && Array.isArray(seat.effortLevels) ? seat.effortLevels : []).slice();
      var levels = rawLevels.map(function (item) {
        var key = extractEffortKey(item);
        return {
          raw: item,
          effort: key,
          label: extractEffortDisplayLabel(item, key, seat)
        };
      });
      var count = levels.length;
      var curEffort = extractEffortKey(seat && seat.currentEffort);
      var officialIndex = 0;
      for (var i = 0; i < count; i += 1) {
        if (String(levels[i].effort).toLowerCase() === String(curEffort).toLowerCase()) {
          officialIndex = i;
          break;
        }
      }
      var locked = Boolean((seat && seat.locked) || count <= 1);
      var stops = energyStopsFor(levels);
      return {
        levels: levels,
        count: count,
        officialIndex: officialIndex,
        locked: locked,
        energyStart: stops.start,
        energyEnd: stops.end,
        hasOffFirst: stops.hasOffFirst
      };
    }

    function currentShownIndex(snap) {
      if (dragging && draftIndex !== null) return draftIndex;
      if (snapIndex !== null) return snapIndex;
      return snap.officialIndex;
    }

    function ensureMotion(snap) {
      if (!motionState) {
        var initPct = pctFromIndex(currentShownIndex(snap), snap.count);
        motionState = {
          x: initPct,
          v: 0,
          a: 0,
          target: initPct
        };
      }
      return motionState;
    }

    function syncHeaderAndTrigger(snap, showIdx) {
      var count = snap.count;
      var safeIdx = Math.max(0, Math.min(Math.max(0, count - 1), showIdx));
      var levelItem = snap.levels[safeIdx];
      var label = levelItem ? levelItem.label : "";
      var isMax = !snap.locked && count > 1 && safeIdx === count - 1 && !isOffLevel(label);

      var rowEl =
        opts.row ||
        (container.closest &&
          (container.closest(".ces-ag-effort-row") ||
            container.closest('[data-ces-effort-row="true"]') ||
            container.closest('[role="menuitem"]')));

      if (rowEl) {
        rowEl.setAttribute("data-ces-effort-row", "true");
        if (isMax) {
          rowEl.setAttribute("data-ces-max", "true");
        } else {
          rowEl.removeAttribute("data-ces-max");
        }
        var valEl = opts.valueElement || findValueElement(rowEl);
        if (valEl) {
          if (label && valEl.textContent !== label) {
            valEl.textContent = label;
          }
          var vColor = snap.locked ? "" : valueColorFor(label, safeIdx, count, isMax, snap.hasOffFirst);
          valEl.style.color = vColor || "";
        }
      }

      syncTriggerColor(doc, label, safeIdx, count, isMax, snap.hasOffFirst);
      if (typeof opts.onVisualChange === "function") {
        try {
          opts.onVisualChange({
            index: safeIdx,
            count: count,
            label: label,
            effort: levelItem ? levelItem.effort : "",
            isMax: isMax,
            locked: snap.locked
          });
        } catch (err) {
          // 忽略外部视觉回调错误
        }
      }
    }

    function renderTicks(snap, effectivePct) {
      var settings = readSettings(win);
      var tickMode = settings.ticks || "highlight";
      var count = snap.count;

      if (tickMode === "hidden" || count <= 1) {
        ticksEl.style.display = "none";
        return;
      }
      ticksEl.style.display = "";

      if (lastRenderedTickCount !== count) {
        ticksEl.innerHTML = "";
        tickNodes = [];
        for (var i = 0; i < count; i += 1) {
          var tick = doc.createElement("span");
          tick.className = "ces-tick";
          tick.setAttribute("data-ces-part", "tick");
          var tickPct = pctFromIndex(i, count);
          tick.style.left = knobOffsetOf(tickPct, KNOB_RADIUS);
          ticksEl.appendChild(tick);
          tickNodes.push({ el: tick, pct: tickPct });
        }
        lastRenderedTickCount = count;
      }

      for (var j = 0; j < tickNodes.length; j += 1) {
        var node = tickNodes[j];
        var reached = effectivePct + 1e-4 >= node.pct;
        if (tickMode === "dim") {
          node.el.className = "ces-tick is-dim";
        } else {
          node.el.className = reached ? "ces-tick is-on" : "ces-tick";
        }
      }
    }

    function applyVisualPct(snap, effectivePct, showIdx) {
      var p = clamp01(effectivePct);
      var count = snap.count;
      var safeIdx = Math.max(0, Math.min(Math.max(0, count - 1), showIdx));
      var levelItem = snap.levels[safeIdx];
      var label = levelItem ? levelItem.label : "";

      rootEl.setAttribute("tabindex", snap.locked ? "-1" : "0");
      rootEl.setAttribute("aria-valuemin", "0");
      rootEl.setAttribute("aria-valuemax", String(Math.max(0, count - 1)));
      rootEl.setAttribute("aria-valuenow", String(safeIdx));
      rootEl.setAttribute("aria-valuetext", label);
      rootEl.setAttribute("aria-disabled", snap.locked ? "true" : "false");

      if (snap.locked) {
        trackEl.classList.add("is-locked");
      } else {
        trackEl.classList.remove("is-locked");
      }

      var offsetCss = knobOffsetOf(p, KNOB_RADIUS);
      trackEl.style.setProperty("--ces-fill", offsetCss);
      trackEl.style.setProperty("--ces-fill-bg", fillBackgroundFor(p, snap.energyStart, snap.energyEnd));

      var energy = snap.locked ? 0 : energyForPct(p, snap.energyStart);
      var sweepOpacity = Math.round(energy * energy * 1000) / 1000;
      var starLayerOpacity = starLayerOpacityFor(energy);
      trackEl.style.setProperty("--ces-sweep-opacity", String(sweepOpacity));
      trackEl.style.setProperty("--ces-star-opacity", String(starLayerOpacity));

      // 星尘闪烁速度随能量加速：energy=0.5 (Medium) -> scale=1.0 (1x)；energy=1.0 (High) -> scale=0.5 (2x)
      var speedScale = 0.5 / (0.5 * energy + 0.25);
      for (var i = 0; i < starNodes.length; i += 1) {
        var sNode = starNodes[i];
        var b = starBrightnessFor(sNode.meta, energy);
        sNode.el.style.setProperty("--ces-star-b", String(b));
        var scaledDur = Math.round(((sNode.meta.duration / BASE_SPEEDUP) * speedScale) * 1000) / 1000;
        sNode.el.style.animationDuration = scaledDur + "s";
      }

      renderTicks(snap, p);
      syncHeaderAndTrigger(snap, safeIdx);
    }

    function stopFrames() {
      if (rafId !== null && win && typeof win.cancelAnimationFrame === "function") {
        win.cancelAnimationFrame(rafId);
      }
      rafId = null;
      lastFrameMs = 0;
    }

    function stepFrame(ts) {
      rafId = null;
      if (destroyed) return;
      var snap = readSeatSnapshot();
      var m = ensureMotion(snap);
      var mode = motionMode(win);
      var params = motionParamsForMode(mode);

      var now = typeof ts === "number" && ts > 0 ? ts : nowMs();
      var dt = lastFrameMs > 0 ? (now - lastFrameMs) / 1000 : 1 / 60;
      lastFrameMs = now;

      motionStep(m, dt, params);
      var showIdx = currentShownIndex(snap);
      applyVisualPct(snap, m.x, showIdx);

      if (!motionSettled(m, params)) {
        startFrames();
      } else {
        m.x = clamp01(m.target);
        m.v = 0;
        m.a = 0;
        if (!dragging) {
          snapIndex = null;
        }
        applyVisualPct(snap, m.x, currentShownIndex(snap));
      }
    }

    function startFrames() {
      if (destroyed || rafId !== null) return;
      if (win && typeof win.requestAnimationFrame === "function") {
        rafId = win.requestAnimationFrame(stepFrame);
      } else {
        stepFrame(nowMs());
      }
    }

    /**
     * 立即把目标档位写回宿主（Antigravity React Fiber 或 Seat）：
     * 拖过档位边界时同步触发，无需等待 pointerup 松手。
     */
    function commitAtIndex(targetIndex, reason) {
      var snap = readSeatSnapshot();
      if (snap.locked || snap.count <= 1) return;
      var clampedIdx = Math.max(0, Math.min(snap.count - 1, targetIndex));
      var item = snap.levels[clampedIdx];
      if (!item) return;

      lastCommittedIndex = clampedIdx;
      tracePush("commit", {
        reason: reason || "drag",
        index: clampedIdx,
        effort: item.effort,
        label: item.label
      });

      if (seat && typeof seat.selectEffort === "function") {
        try {
          seat.selectEffort(item.raw !== undefined ? item.raw : item.effort, clampedIdx);
        } catch (err) {
          tracePush("commit-error", { message: String(err && err.message ? err.message : err) });
        }
      }
      if (typeof opts.onCommit === "function") {
        try {
          opts.onCommit(item, clampedIdx, reason || "drag");
        } catch (err) {
          // 忽略外部回调异常
        }
      }
    }

    function pctAtClientX(clientX) {
      var rect = trackEl.getBoundingClientRect ? trackEl.getBoundingClientRect() : null;
      if (!rect || !(rect.width > 0)) return null;
      var usable = Math.max(1, rect.width - KNOB_RADIUS * 2);
      var raw = (clientX - rect.left - KNOB_RADIUS) / usable;
      return clamp01(raw);
    }

    function moveToClientX(clientX, isInitialDown) {
      var snap = readSeatSnapshot();
      if (snap.locked || snap.count <= 0) return;

      var ptrPct = pctAtClientX(clientX);
      if (ptrPct === null) ptrPct = pctFromIndex(snap.officialIndex, snap.count);

      var now = nowMs();
      if (lastPtrPct !== null && lastPtrMs > 0) {
        var dt = (now - lastPtrMs) / 1000;
        if (dt > 1e-4 && dt < 0.25) {
          var instSpeed = (ptrPct - lastPtrPct) / dt;
          ptrSpeed = ptrSpeed * (1 - POINTER_SPEED_EMA) + instSpeed * POINTER_SPEED_EMA;
        }
      } else {
        ptrSpeed = 0;
      }
      lastPtrPct = ptrPct;
      lastPtrMs = now;

      var mode = motionMode(win);
      var nowIndex;
      var targetPct;

      if (mode === "fast") {
        if (isInitialDown || detentIndex < 0 || detentIndex >= snap.count) {
          // 按下时若点击位置跨格，直接按最近格响应；随后的拖动按 1/3 边界迟滞棘轮触发
          nowIndex = isInitialDown
            ? indexFromPct(ptrPct, snap.count)
            : detentTargetIndex(snap.officialIndex, ptrPct, snap.count);
        } else {
          nowIndex = detentTargetIndex(detentIndex, ptrPct, snap.count);
        }
        // 仅当指针已进入 nowIndex 自身的稳定死区时才把棘轮锚点推进到 nowIndex，
        // 否则保持在过渡区来源侧相邻格，防止在 [1/3, 2/3] 区间连续微移或松手时来回翻转
        if (detentTargetIndex(nowIndex, ptrPct, snap.count) === nowIndex) {
          detentIndex = nowIndex;
        } else if (ptrPct < pctFromIndex(nowIndex, snap.count)) {
          detentIndex = Math.max(0, nowIndex - 1);
        } else {
          detentIndex = Math.min(snap.count - 1, nowIndex + 1);
        }
        targetPct = pctFromIndex(nowIndex, snap.count);
      } else {
        nowIndex = indexFromPct(ptrPct, snap.count);
        targetPct = ptrPct;
      }

      draftPct = ptrPct;
      draftIndex = nowIndex;

      var m = ensureMotion(snap);
      m.target = targetPct;

      // ★ 核心交互：只要滑过档位边界（或者点击了另一档位），不用等松手，立即切换官方真实档位 ★
      if (nowIndex !== lastCommittedIndex) {
        commitAtIndex(nowIndex, isInitialDown ? "down" : "drag");
      }

      if (mode === "quick") {
        m.x = targetPct;
        m.v = 0;
        m.a = 0;
        stopFrames();
        applyVisualPct(readSeatSnapshot(), m.x, nowIndex);
      } else {
        applyVisualPct(readSeatSnapshot(), m.x, nowIndex);
        startFrames();
      }
    }

    function endDrag(clientX) {
      if (!dragging) return;
      var snap = readSeatSnapshot();
      var ptrPct = draftPct !== null ? draftPct : pctFromIndex(snap.officialIndex, snap.count);
      if (typeof clientX === "number") {
        var p = pctAtClientX(clientX);
        if (p !== null) ptrPct = p;
      }

      var mode = motionMode(win);
      var finalIndex;
      if (mode === "fast") {
        var baseDetent = detentIndex >= 0 && detentIndex < snap.count ? detentIndex : snap.officialIndex;
        finalIndex = detentTargetIndex(baseDetent, ptrPct, snap.count);
      } else if (mode === "quick") {
        finalIndex = indexFromPct(ptrPct, snap.count);
      } else {
        var idleS = lastPtrMs > 0 ? Math.max(0, (nowMs() - lastPtrMs) / 1000) : 1;
        finalIndex = releaseIndexFor(ptrPct, ptrSpeed, idleS, snap.count);
      }

      dragging = false;
      buttonDown = false;
      draftPct = null;
      draftIndex = null;
      detentIndex = -1;
      lastPtrPct = null;
      ptrSpeed = 0;
      snapIndex = finalIndex;

      if (finalIndex !== lastCommittedIndex) {
        commitAtIndex(finalIndex, "release");
      }

      var m = ensureMotion(snap);
      m.target = pctFromIndex(finalIndex, snap.count);

      if (mode === "quick") {
        m.x = m.target;
        m.v = 0;
        m.a = 0;
        snapIndex = null;
        stopFrames();
        applyVisualPct(readSeatSnapshot(), m.x, finalIndex);
      } else {
        applyVisualPct(readSeatSnapshot(), m.x, finalIndex);
        startFrames();
      }
    }

    function swallowEvent(ev) {
      if (!ev) return;
      if (typeof ev.stopPropagation === "function") ev.stopPropagation();
    }

    function onPointerDown(ev) {
      if (ev && typeof ev.button === "number" && ev.button !== 0) return;
      var snap = readSeatSnapshot();
      if (snap.locked || snap.count <= 1) return;
      swallowEvent(ev);
      if (typeof ev.preventDefault === "function") ev.preventDefault();

      dragging = true;
      buttonDown = true;
      // 起手时对齐当前官方档位，若起手点就在当前档位则不重复触发无意义的写入；若点在其他档位则立即切过去
      lastCommittedIndex = snap.officialIndex;
      detentIndex = snap.officialIndex;
      snapIndex = null;
      lastPtrPct = null;

      try {
        if (trackEl.setPointerCapture && ev.pointerId !== undefined) {
          trackEl.setPointerCapture(ev.pointerId);
        }
      } catch (err) {
        // 忽略不支持 pointerCapture 的环境
      }

      moveToClientX(ev.clientX, true);
    }

    function onPointerMove(ev) {
      if (!dragging) return;
      if (ev && ev.buttons === 0 && !buttonDown) return;
      swallowEvent(ev);
      moveToClientX(ev.clientX, false);
    }

    function onPointerUp(ev) {
      if (!dragging) return;
      swallowEvent(ev);
      buttonDown = false;
      try {
        if (trackEl.releasePointerCapture && ev && ev.pointerId !== undefined) {
          trackEl.releasePointerCapture(ev.pointerId);
        }
      } catch (err) {
        // 忽略释放失败
      }
      endDrag(ev && typeof ev.clientX === "number" ? ev.clientX : undefined);
    }

    function onPointerCancel(ev) {
      if (!dragging) return;
      swallowEvent(ev);
      buttonDown = false;
      endDrag(undefined);
    }

    function onKeyDown(ev) {
      var snap = readSeatSnapshot();
      if (snap.locked || snap.count <= 1) return;
      var key = ev && ev.key;
      var curIdx = currentShownIndex(snap);
      var nextIdx = null;
      if (key === "ArrowLeft" || key === "ArrowDown") {
        nextIdx = Math.max(0, curIdx - 1);
      } else if (key === "ArrowRight" || key === "ArrowUp") {
        nextIdx = Math.min(snap.count - 1, curIdx + 1);
      } else if (key === "Home") {
        nextIdx = 0;
      } else if (key === "End") {
        nextIdx = snap.count - 1;
      } else {
        return;
      }
      swallowEvent(ev);
      if (typeof ev.preventDefault === "function") ev.preventDefault();

      snapIndex = nextIdx;
      commitAtIndex(nextIdx, "key");
      var m = ensureMotion(snap);
      m.target = pctFromIndex(nextIdx, snap.count);

      if (motionMode(win) === "quick") {
        m.x = m.target;
        m.v = 0;
        m.a = 0;
        snapIndex = null;
        stopFrames();
        applyVisualPct(readSeatSnapshot(), m.x, nextIdx);
      } else {
        applyVisualPct(readSeatSnapshot(), m.x, nextIdx);
        startFrames();
      }
    }

    // 阻断 click / mouseup 冒泡到外层 MenuItem，防止拖动松手时意外关闭官方菜单
    function onBlockMenuClose(ev) {
      swallowEvent(ev);
    }

    trackEl.addEventListener("pointerdown", onPointerDown);
    trackEl.addEventListener("pointermove", onPointerMove);
    trackEl.addEventListener("pointerup", onPointerUp);
    trackEl.addEventListener("pointercancel", onPointerCancel);
    trackEl.addEventListener("lostpointercapture", onPointerCancel);
    trackEl.addEventListener("click", onBlockMenuClose);
    trackEl.addEventListener("mouseup", onBlockMenuClose);
    rootEl.addEventListener("keydown", onKeyDown);

    function syncFromExternal() {
      if (destroyed || dragging) return;
      var snap = readSeatSnapshot();
      var m = ensureMotion(snap);
      var targetIdx = snap.officialIndex;
      var targetPct = pctFromIndex(targetIdx, snap.count);
      m.target = targetPct;

      if (
        snap.locked ||
        motionMode(win) === "quick" ||
        motionSettled(m, motionParamsForMode(motionMode(win)))
      ) {
        m.x = targetPct;
        m.v = 0;
        m.a = 0;
        snapIndex = null;
        stopFrames();
        applyVisualPct(snap, m.x, targetIdx);
      } else {
        applyVisualPct(snap, m.x, targetIdx);
        startFrames();
      }
    }

    var offSeat =
      seat && typeof seat.subscribe === "function"
        ? seat.subscribe(function () {
            syncFromExternal();
          })
        : function () {};

    var offSettings = onSettingsChange(function () {
      var snap = readSeatSnapshot();
      var m = ensureMotion(snap);
      applyVisualPct(snap, m.x, currentShownIndex(snap));
    }, win);

    // 首次同步渲染
    var initSnap = readSeatSnapshot();
    var initMotion = ensureMotion(initSnap);
    initMotion.x = pctFromIndex(initSnap.officialIndex, initSnap.count);
    initMotion.target = initMotion.x;
    applyVisualPct(initSnap, initMotion.x, initSnap.officialIndex);

    return {
      unmount: function () {
        destroyed = true;
        stopFrames();
        if (typeof offSeat === "function") offSeat();
        if (typeof offSettings === "function") offSettings();
        trackEl.removeEventListener("pointerdown", onPointerDown);
        trackEl.removeEventListener("pointermove", onPointerMove);
        trackEl.removeEventListener("pointerup", onPointerUp);
        trackEl.removeEventListener("pointercancel", onPointerCancel);
        trackEl.removeEventListener("lostpointercapture", onPointerCancel);
        trackEl.removeEventListener("click", onBlockMenuClose);
        trackEl.removeEventListener("mouseup", onBlockMenuClose);
        rootEl.removeEventListener("keydown", onKeyDown);
        if (rootEl.parentNode === container) {
          container.removeChild(rootEl);
        }
      },
      refresh: function () {
        syncFromExternal();
      }
    };
  }

  // ── 通用菜单观察器（兼容预置「推理等级」行的 DOM 结构与独立预览页） ────────────
  function installMenuObserver(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (doc && doc.defaultView) || (typeof window !== "undefined" ? window : globalRoot);
    var onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};
    if (!doc || !doc.body) {
      return { stop: function () {}, rescan: function () {}, getCurrent: function () { return null; } };
    }

    var current = null;
    var observer = null;

    function detach() {
      if (!current) return;
      var prev = current;
      current = null;
      try {
        if (prev.container && prev.container.parentNode) {
          prev.container.parentNode.removeChild(prev.container);
        }
        if (prev.row && prev.previousStyle) {
          prev.row.style.height = prev.previousStyle.height;
          prev.row.style.flexWrap = prev.previousStyle.flexWrap;
          prev.row.style.paddingTop = prev.previousStyle.paddingTop;
          prev.row.style.paddingBottom = prev.previousStyle.paddingBottom;
        }
      } catch (err) {
        // 忽略清理异常
      }
      onChange(null);
    }

    function scan() {
      // 若页面存在 Antigravity 原生模型面板，交由 installAntigravityObserver 接管
      if (findAntigravityPanel(doc) || findAntigravityTrigger(doc)) return;

      var row = findInferenceRow(doc);
      if (!row) {
        if (current) detach();
        return;
      }
      if (current && current.row === row && current.container && row.contains(current.container)) {
        return;
      }
      if (current) detach();

      var previousStyle = {
        height: row.style.height || "",
        flexWrap: row.style.flexWrap || "",
        paddingTop: row.style.paddingTop || "",
        paddingBottom: row.style.paddingBottom || ""
      };

      row.setAttribute("data-ces-effort-row", "true");
      row.style.height = "auto";
      row.style.flexWrap = "wrap";
      row.style.paddingTop = "8px";
      row.style.paddingBottom = "8px";

      var valEl = findValueElement(row);
      var host = doc.createElement("div");
      host.className = "ces-inline";
      host.setAttribute("data-ces-part", "host");
      row.appendChild(host);

      current = {
        row: row,
        container: host,
        value: valEl ? (valEl.textContent || "").trim() : "",
        previousStyle: previousStyle
      };
      onChange(current);
    }

    scan();
    var MO = (win && win.MutationObserver) || (typeof MutationObserver === "function" ? MutationObserver : null);
    if (typeof MO === "function") {
      observer = new MO(function () {
        scan();
      });
      observer.observe(doc.body, { childList: true, subtree: true });
    }

    return {
      stop: function () {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        detach();
      },
      rescan: scan,
      getCurrent: function () {
        return current;
      }
    };
  }

  // ── Antigravity 原生模型选择器深度桥接器 ───────────────────────────────────
  function installAntigravityObserver(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (doc && doc.defaultView) || (typeof window !== "undefined" ? window : globalRoot);
    if (!doc || !doc.body) {
      return { stop: function () {}, rescan: function () {} };
    }

    installStyles(doc);

    // 记录每个基础模型在当前会话最后选定的推理档位（默认跟随 selectedModel 或 medium）
    var perModelEffortMap = new Map();
    var activeMount = null;
    var activePanel = null;
    var activeSection = null;
    var activeRow = null;
    var activeValueEl = null;
    var activeHostEl = null;
    var activeSeatListeners = new Set();
    var activeBaseOverride = null;
    var activeModelOptionOverride = null;
    var observer = null;
    var isInternalMutating = false;

    function notifySeatListeners() {
      activeSeatListeners.forEach(function (fn) {
        try {
          fn();
        } catch (err) {
          // 忽略订阅者异常
        }
      });
    }

    function getLiveContext() {
      var trigger = findAntigravityTrigger(doc);
      var panel = findAntigravityPanel(doc);
      return readAntigravityFiberContext(trigger || panel);
    }

    function getActiveProfile(ctx) {
      if (!ctx) return null;
      var target = activeModelOptionOverride || activeBaseOverride || ctx.selectedModel;
      return resolveModelEffortProfile(ctx, target, perModelEffortMap);
    }

    /**
     * 立即同步更新：
     * 1. 底部 Composer 折叠触发按钮的模型名与档位颜色
     * 2. 展开菜单中每一行模型右侧的档位文字与颜色、以及选中态高亮
     */
    function syncAntigravityDomDecorations(ctx, activeProfile) {
      if (!ctx) return;
      var profile = activeProfile || getActiveProfile(ctx);
      if (!profile) return;

      if (!profile.locked && profile.baseName && profile.currentEffort) {
        perModelEffortMap.set(profile.baseName, profile.currentEffort);
      }

      var count = profile.levels.length;
      var idx = profile.currentIndex;
      var isMax = !profile.locked && count > 1 && idx === count - 1 && !isOffLevel(profile.currentLabel);

      // 1. 同步底部折叠按钮 (button[data-testid="model-selector-trigger"])
      var triggerBtn = findAntigravityTrigger(doc);
      if (triggerBtn) {
        var outerSpan = triggerBtn.querySelector("span.min-w-0");
        if (outerSpan) {
          var allSpans = outerSpan.querySelectorAll("span");
          for (var sIdx = 1; sIdx < allSpans.length; sIdx += 1) {
            if (allSpans[sIdx].parentNode === outerSpan) {
              outerSpan.removeChild(allSpans[sIdx]);
            }
          }
          var effortSpan = outerSpan.querySelector("span.opacity-70, [data-ces-part='trigger-effort']");
          if (!profile.locked && profile.baseName) {
            var firstNode = outerSpan.firstChild;
            if (firstNode && firstNode.nodeType === 3 && firstNode.nodeValue !== profile.baseName) {
              firstNode.nodeValue = profile.baseName;
            }
            if (effortSpan) {
              var nextEffortText = " " + profile.currentLabel;
              if (effortSpan.textContent !== nextEffortText) {
                effortSpan.textContent = nextEffortText;
              }
            }
          }
        }
      }
      syncTriggerColor(doc, profile.currentLabel, idx, count, isMax, false);

      // 2. 同步展开菜单中的各模型行
      var panel = findAntigravityPanel(doc);
      if (!panel) return;

      var groupSpans = panel.querySelectorAll('[data-testid="model-selector-effort-group"]');
      for (var i = 0; i < groupSpans.length; i += 1) {
        var gSpan = groupSpans[i];
        var base = gSpan.getAttribute("data-model-base") || (gSpan.textContent || "").trim();
        var menuItem = gSpan.closest('[role="menuitem"]');
        var rowProf = resolveModelEffortProfile(ctx, base, perModelEffortMap);
        if (!rowProf) continue;

        var isSelectedModel = profile.baseName === base;
        if (menuItem) {
          menuItem.setAttribute("data-ces-model-selected", isSelectedModel ? "true" : "false");
          if (isSelectedModel) {
            menuItem.classList.remove("text-secondary-foreground");
            menuItem.classList.add("text-foreground");
          } else {
            menuItem.classList.remove("text-foreground");
            menuItem.classList.add("text-secondary-foreground");
          }
        }

        // 模型名右侧的档位标签 (<span class="shrink-0 opacity-70 text-xs">)
        var sib = gSpan.nextElementSibling;
        if (sib && sib.tagName === "SPAN") {
          var displayEffort = isSelectedModel ? profile.currentLabel : rowProf.currentLabel;
          var displayIdx = isSelectedModel ? profile.currentIndex : rowProf.currentIndex;
          var displayCount = rowProf.levels.length;
          var displayMax = displayCount > 1 && displayIdx === displayCount - 1;
          if (sib.textContent !== displayEffort) {
            sib.textContent = displayEffort;
          }
          var rowColor = valueColorFor(displayEffort, displayIdx, displayCount, displayMax, false);
          sib.style.color = rowColor || "";
          sib.style.opacity = rowColor ? "1" : "";
          sib.style.fontWeight = rowColor ? "600" : "";
        }
      }

      var singleItems = panel.querySelectorAll('[data-testid="model-selector-item"]');
      for (var j = 0; j < singleItems.length; j += 1) {
        var sItem = singleItems[j];
        var sLabel = sItem.getAttribute("data-model-label") || "";
        var isSingleSelected =
          (profile.modelOption && profile.modelOption.label === sLabel) ||
          profile.baseName === sLabel;
        sItem.setAttribute("data-ces-model-selected", isSingleSelected ? "true" : "false");
        if (isSingleSelected) {
          sItem.classList.remove("text-secondary-foreground");
          sItem.classList.add("text-foreground");
        } else {
          sItem.classList.remove("text-foreground");
          sItem.classList.add("text-secondary-foreground");
        }
      }
    }

    var agSeatAdapter = {
      get effortLevels() {
        var ctx = getLiveContext();
        var prof = getActiveProfile(ctx);
        return prof ? prof.levels : [];
      },
      get currentEffort() {
        var ctx = getLiveContext();
        var prof = getActiveProfile(ctx);
        return prof ? prof.currentEffort : "";
      },
      get locked() {
        var ctx = getLiveContext();
        var prof = getActiveProfile(ctx);
        return prof ? prof.locked : true;
      },
      selectEffort: function (levelItem) {
        var ctx = getLiveContext();
        if (!ctx || !levelItem) return;
        var targetOpt = levelItem.modelOption || (levelItem.raw && levelItem.raw.modelOption);
        var effortKey = levelItem.effort || (levelItem.raw && levelItem.raw.effort);
        if (!targetOpt) return;

        var parsed = parseModelLabel(targetOpt.label);
        if (parsed) {
          perModelEffortMap.set(parsed.base, parsed.effort);
          activeBaseOverride = parsed.base;
        }
        activeModelOptionOverride = targetOpt;

        commitAntigravityModelOption(ctx, targetOpt);

        isInternalMutating = true;
        try {
          var updatedProfile = resolveModelEffortProfile(ctx, targetOpt, perModelEffortMap);
          syncAntigravityDomDecorations(ctx, updatedProfile);
        } finally {
          isInternalMutating = false;
        }
      },
      subscribe: function (fn) {
        activeSeatListeners.add(fn);
        return function () {
          activeSeatListeners.delete(fn);
        };
      }
    };

    function bindPanelInteractions(panel) {
      if (!panel || panel.__cesAgBound) return;
      panel.__cesAgBound = true;

      function findClickedModelRow(target) {
        if (!target || typeof target.closest !== "function") return null;
        if (target.closest(".ces-ag-section, .ces-set")) return null;
        if (target.closest('button[aria-label="Edit Model"]')) return null;

        var singleRow = target.closest('[data-testid="model-selector-item"]');
        if (singleRow && panel.contains(singleRow)) {
          return { type: "single", row: singleRow, label: singleRow.getAttribute("data-model-label") || "" };
        }

        var menuItem = target.closest('[role="menuitem"]');
        if (!menuItem || !panel.contains(menuItem)) return null;
        var groupSpan = menuItem.querySelector('[data-testid="model-selector-effort-group"]');
        if (groupSpan) {
          var base = groupSpan.getAttribute("data-model-base") || (groupSpan.textContent || "").trim();
          return { type: "group", row: menuItem, base: base };
        }
        return null;
      }

      // 捕获阶段拦截模型行 pointerup / mouseup，阻止 @base-ui/react 菜单因抬起指针而自动关闭
      function onPointerOrMouseUpCapture(ev) {
        if (ev.target && typeof ev.target.closest === "function" && ev.target.closest(".ces-ag-section")) {
          ev.stopPropagation();
          return;
        }
        var hit = findClickedModelRow(ev.target);
        if (!hit) return;
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
      }

      // 捕获阶段拦截模型行 click：切换选中模型但保持菜单常开，下方滑条即时联动该模型的档位
      function onClickCapture(ev) {
        if (ev.target && typeof ev.target.closest === "function" && ev.target.closest(".ces-ag-section")) {
          ev.stopPropagation();
          return;
        }
        var hit = findClickedModelRow(ev.target);
        if (!hit) return;

        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();

        var ctx = getLiveContext();
        if (!ctx) return;

        var targetOption = null;
        if (hit.type === "group" && hit.base) {
          var prof = resolveModelEffortProfile(ctx, hit.base, perModelEffortMap);
          if (prof && prof.modelOption) {
            targetOption = prof.modelOption;
            activeBaseOverride = hit.base;
            activeModelOptionOverride = targetOption;
          }
        } else if (hit.type === "single" && hit.label) {
          var optsList = Array.isArray(ctx.modelOptions) ? ctx.modelOptions : [];
          for (var i = 0; i < optsList.length; i += 1) {
            if (optsList[i] && optsList[i].label === hit.label) {
              targetOption = optsList[i];
              break;
            }
          }
          if (targetOption) {
            activeBaseOverride = hit.label;
            activeModelOptionOverride = targetOption;
          }
        }

        if (targetOption) {
          tracePush("ag-select-model-in-menu", { label: targetOption.label });
          commitAntigravityModelOption(ctx, targetOption);
          isInternalMutating = true;
          try {
            var nextProf = resolveModelEffortProfile(ctx, targetOption, perModelEffortMap);
            syncAntigravityDomDecorations(ctx, nextProf);
            notifySeatListeners();
          } finally {
            isInternalMutating = false;
          }
        }
      }

      panel.addEventListener("pointerup", onPointerOrMouseUpCapture, true);
      panel.addEventListener("mouseup", onPointerOrMouseUpCapture, true);
      panel.addEventListener("click", onClickCapture, true);
    }

    function unmountActiveSection() {
      if (activeMount) {
        activeMount.unmount();
        activeMount = null;
      }
      if (activeSection && activeSection.parentNode) {
        activeSection.parentNode.removeChild(activeSection);
      }
      activeSection = null;
      activeRow = null;
      activeValueEl = null;
      activeHostEl = null;
      activePanel = null;
      activeBaseOverride = null;
      activeModelOptionOverride = null;
    }

    function mountSectionIntoPanel(panel, ctx) {
      panel.classList.add("ces-ag-panel-enhanced");
      bindPanelInteractions(panel);

      var section = doc.createElement("div");
      section.className = "ces-ag-section";
      section.setAttribute("data-ces-part", "ag-section");

      var sep = doc.createElement("div");
      sep.setAttribute("role", "separator");
      sep.setAttribute("aria-orientation", "horizontal");
      sep.className = "h-px bg-border my-1 -mx-1";
      section.appendChild(sep);

      var row = doc.createElement("div");
      row.className = "ces-ag-effort-row text-foreground";
      row.setAttribute("data-ces-effort-row", "true");

      var head = doc.createElement("div");
      head.className = "ces-ag-effort-head";

      var title = doc.createElement("span");
      title.className = "ces-ag-effort-title";
      title.textContent = "推理等级";

      var valueEl = doc.createElement("span");
      valueEl.className = "ces-ag-effort-value";
      valueEl.setAttribute("data-ces-part", "value");

      head.appendChild(title);
      head.appendChild(valueEl);
      row.appendChild(head);

      var hostEl = doc.createElement("div");
      hostEl.className = "ces-inline";
      hostEl.setAttribute("data-ces-part", "host");
      row.appendChild(hostEl);

      section.appendChild(row);

      // 挂载位置：模型列表容器 (panel.firstElementChild) 之后、View Usage 分隔线之前
      var modelListWrapper = panel.firstElementChild;
      if (modelListWrapper && modelListWrapper.nextSibling) {
        panel.insertBefore(section, modelListWrapper.nextSibling);
      } else {
        panel.appendChild(section);
      }

      activePanel = panel;
      activeSection = section;
      activeRow = row;
      activeValueEl = valueEl;
      activeHostEl = hostEl;

      activeMount = mountCodexEffortSlider({
        container: hostEl,
        row: row,
        valueElement: valueEl,
        seat: agSeatAdapter,
        document: doc,
        window: win,
        onVisualChange: function (vState) {
          isInternalMutating = true;
          try {
            var liveCtx = getLiveContext();
            if (liveCtx) {
              syncAntigravityDomDecorations(liveCtx, getActiveProfile(liveCtx));
            } else {
              syncTriggerColor(doc, vState.label, vState.index, vState.count, vState.isMax, false);
            }
          } finally {
            isInternalMutating = false;
          }
        }
      });

      try {
        if (win && typeof win.dispatchEvent === "function" && typeof win.Event === "function") {
          win.dispatchEvent(new win.Event("resize"));
        }
      } catch (err) {
        // 忽略 resize 触发失败
      }
    }

    function scan() {
      if (isInternalMutating) return;
      isInternalMutating = true;
      try {
        var ctx = getLiveContext();
        var panel = findAntigravityPanel(doc);

        if (!panel) {
          if (activeSection) {
            unmountActiveSection();
          }
          if (ctx) {
            syncAntigravityDomDecorations(ctx, resolveModelEffortProfile(ctx, ctx.selectedModel, perModelEffortMap));
          }
          return;
        }

        // 若外部修改了 selectedModel，清除临时 override 对齐最新模型
        if (ctx && ctx.selectedModel && activeModelOptionOverride) {
          if (ctx.selectedModel.label === activeModelOptionOverride.label) {
            activeModelOptionOverride = null;
            activeBaseOverride = null;
          }
        }

        if (activePanel !== panel || !activeSection || !panel.contains(activeSection)) {
          unmountActiveSection();
          mountSectionIntoPanel(panel, ctx);
        }

        if (ctx) {
          syncAntigravityDomDecorations(ctx, getActiveProfile(ctx));
        }
        notifySeatListeners();
      } finally {
        isInternalMutating = false;
      }
    }

    scan();
    var MO = (win && win.MutationObserver) || (typeof MutationObserver === "function" ? MutationObserver : null);
    if (typeof MO === "function") {
      observer = new MO(function () {
        scan();
      });
      observer.observe(doc.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    return {
      stop: function () {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        unmountActiveSection();
      },
      rescan: scan
    };
  }

  // ── 一键安装到当前窗口（同时兼容 Antigravity 原生环境与 Seat 预览环境） ────────
  function installCodexEffortSlider(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (doc && doc.defaultView) || (typeof window !== "undefined" ? window : globalRoot);
    if (!doc || !doc.body) return null;

    if (win && win.__agCodexEffortSliderInstance && typeof win.__agCodexEffortSliderInstance.stop === "function") {
      try {
        win.__agCodexEffortSliderInstance.stop();
      } catch (err) {
        // 忽略旧实例卸载错误
      }
    }

    installStyles(doc);
    var settingsUi = installSettingsUi({ document: doc, window: win });
    var agObs = installAntigravityObserver({ document: doc, window: win });

    var activeGenericMount = null;
    var menuObs = installMenuObserver({
      document: doc,
      window: win,
      onChange: function (current) {
        if (activeGenericMount) {
          activeGenericMount.unmount();
          activeGenericMount = null;
        }
        if (!current || !current.container) return;
        var seat = opts.seat || findSeatEffort(win);
        if (!seat) return;
        activeGenericMount = mountCodexEffortSlider({
          container: current.container,
          row: current.row,
          seat: seat,
          document: doc,
          window: win
        });
      }
    });

    var instance = {
      stop: function () {
        if (activeGenericMount) {
          activeGenericMount.unmount();
          activeGenericMount = null;
        }
        menuObs.stop();
        agObs.stop();
        settingsUi.stop();
        if (win && win.__agCodexEffortSliderInstance === instance) {
          delete win.__agCodexEffortSliderInstance;
        }
      },
      rescan: function () {
        agObs.rescan();
        menuObs.rescan();
      }
    };

    if (win) {
      win.__agCodexEffortSliderInstance = instance;
    }
    return instance;
  }

  // 在浏览器主世界（非 Node 测试环境且非禁用自动启动）下自动挂载
  if (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    !window.__agCodexEffortSliderDisableAutoBoot
  ) {
    var boot = function () {
      if (document.body && (findAntigravityTrigger(document) || window.__agCodexEffortSliderForceBoot)) {
        installCodexEffortSlider({ document: document, window: window });
      } else if (document.body) {
        // 页面还在异步挂载 React 根节点时，启动守护观察器
        installCodexEffortSlider({ document: document, window: window });
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }

  return {
    mountCodexEffortSlider: mountCodexEffortSlider,
    installMenuObserver: installMenuObserver,
    installAntigravityObserver: installAntigravityObserver,
    installCodexEffortSlider: installCodexEffortSlider,
    findInferenceRow: findInferenceRow,
    findEffortTrigger: findEffortTrigger,
    findAntigravityTrigger: findAntigravityTrigger,
    findAntigravityPanel: findAntigravityPanel,
    readAntigravityFiberContext: readAntigravityFiberContext,
    resolveModelEffortProfile: resolveModelEffortProfile,
    commitAntigravityModelOption: commitAntigravityModelOption,
    parseModelLabel: parseModelLabel,
    syncTriggerColor: syncTriggerColor,
    pctFromIndex: pctFromIndex,
    indexFromPct: indexFromPct,
    detentTargetIndex: detentTargetIndex,
    energyForPct: energyForPct,
    energyStopsFor: energyStopsFor,
    PARTICLES: PARTICLES,
    starBrightnessFor: starBrightnessFor,
    starDurationFor: starDurationFor,
    starDelayFor: starDelayFor,
    starLayerOpacityFor: starLayerOpacityFor,
    starHash01: starHash01,
    readSettings: readSettings,
    writeSettings: writeSettings,
    resetSettings: resetSettings,
    onSettingsChange: onSettingsChange,
    normalizeSettings: normalizeSettings,
    schemaDefaults: schemaDefaults,
    motionMode: motionMode,
    motionParamsForMode: motionParamsForMode,
    tracePush: tracePush,
    dumpTrace: dumpTrace,
    traceClear: traceClear,
    installSettingsUi: installSettingsUi,
    openSettingsPanel: openSettingsPanel,
    SETTINGS_SCHEMA: SETTINGS_SCHEMA,
    SETTINGS_VERSION: SETTINGS_VERSION,
    SETTINGS_KEY: SETTINGS_KEY,
    SETTINGS_EVENT: SETTINGS_EVENT,
    MIN_HEIGHT_SLOTS: MIN_HEIGHT_SLOTS,
    fillColorFor: fillColorFor,
    fillBackgroundFor: fillBackgroundFor,
    valueColorFor: valueColorFor,
    isOffLevel: isOffLevel,
    findValueElement: findValueElement,
    findSeatEffort: findSeatEffort,
    knobOffsetOf: knobOffsetOf,
    KNOB_RADIUS: KNOB_RADIUS,
    KNOB_SIZE: KNOB_SIZE,
    TRACK_HEIGHT: TRACK_HEIGHT,
    BASE_SPEEDUP: BASE_SPEEDUP,
    ENERGY_START: ENERGY_START,
    ENERGY_END: ENERGY_END,
    clamp01: clamp01,
    clampAbs: clampAbs,
    installStyles: installStyles,
    MOTION: MOTION,
    MOTION_REDUCED: MOTION_REDUCED,
    MOTION_FAST: MOTION_FAST,
    RELEASE_PROJECT_S: RELEASE_PROJECT_S,
    POINTER_SPEED_EMA: POINTER_SPEED_EMA,
    POINTER_STALE_S: POINTER_STALE_S,
    POINTER_SPEED_TAU: POINTER_SPEED_TAU,
    motionStep: motionStep,
    motionSettled: motionSettled,
    decayPointerSpeed: decayPointerSpeed,
    releaseIndexFor: releaseIndexFor
  };
});
