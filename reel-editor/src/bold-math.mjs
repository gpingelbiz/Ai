import { registerBoldOverlay } from "./bold-overlays.mjs";
import { boldEvidenceEnabled, placeBoldCard } from "./bold-proof.mjs";
import { boldText, fitBoldText } from "./bold-render.mjs";
import { splitStat } from "./graphics.mjs";
import { eventClock } from "./event-clock.mjs";

const SMALL = Object.fromEntries("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ").map((word, i) => [word, i]));
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { thousand: 1000, million: 1000000, billion: 1000000000 };
const DEFAULTS = { enabled: true, max: 2, widthFraction: 0.4, size: 96, resultSound: false, soundVolume: 0.1 };
const settingsFor = (context) => ({ ...DEFAULTS, ...context.settings?.math });
const rangeOK = (range, words) => Number.isInteger(range?.from) && Number.isInteger(range?.to) && range.from >= 0 && range.to >= range.from && range.to < words.length;
const said = (range, words) => boldText(words.slice(range.from, range.to + 1).map((word) => word.text).join(" "));

/** Strict complete-number parser. Literal numerals use the engine's existing splitStat parser. */
export function parseBoldNumber(text) {
  let raw = String(text ?? "").trim().toLowerCase().replace(/[.!?,;:]+$/, "");
  const qualifier = raw.match(/^(about|around|approximately|nearly|almost|over|under|at least|up to|more than|less than)\s+/)?.[1] || "";
  if (qualifier) raw = raw.slice(qualifier.length).trim();
  let currency = "", percent = false;
  const prefix = raw.match(/^([$£€])\s*/);
  if (prefix) { currency = prefix[1]; raw = raw.slice(prefix[0].length); }
  const money = raw.match(/\s+(dollars?|bucks?|pounds?|euros?)$/);
  if (money) {
    const unit = /^pound/.test(money[1]) ? "£" : /^euro/.test(money[1]) ? "€" : "$";
    if (currency && currency !== unit) return null;
    currency = unit; raw = raw.slice(0, money.index);
  }
  const pct = raw.match(/\s*(%|percent|percentage|per cent)$/);
  if (pct) { percent = true; raw = raw.slice(0, pct.index); }
  if (currency && percent) return null;
  let value = null;
  const literal = raw.match(/^(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?$/);
  if (literal) {
    const part = splitStat(literal[1]);
    value = part && part.to * ({ k: 1000, m: 1e6, b: 1e9, ...SCALES }[literal[2]] || 1);
  } else {
    const parts = raw.split(/[\s-]+/);
    let sign = 1;
    if (parts[0] === "minus" || parts[0] === "negative") { sign = -1; parts.shift(); }
    const point = parts.indexOf("point");
    let decimal = 0, scale = 1;
    if (point >= 0) {
      const tail = parts.splice(point);
      tail.shift();
      if (SCALES[tail.at(-1)]) scale = SCALES[tail.pop()];
      if (!tail.length || tail.some((word) => SMALL[word] == null || SMALL[word] > 9)) return null;
      decimal = Number(`0.${tail.map((word) => SMALL[word]).join("")}`);
    }
    if (!parts.length) return null;
    let total = 0, group = 0, lastScale = Infinity, previous = "", seen = false;
    for (let i = 0; i < parts.length; i++) {
      const word = parts[i];
      if (word === "and") { if (!seen || i === parts.length - 1 || previous === "and" || !(parts.slice(0, i).includes("hundred") || total)) return null; previous = word; continue; }
      if (SMALL[word] != null) {
        if (previous && (SMALL[previous] != null || TENS[previous] && SMALL[word] >= 10)) return null;
        group += SMALL[word]; seen = true;
      } else if (TENS[word]) {
        if (SMALL[previous] != null || TENS[previous]) return null;
        group += TENS[word]; seen = true;
      } else if (word === "hundred") {
        if (!seen || group < 1 || group > 9 || previous === "hundred") return null;
        group *= 100;
      } else if (SCALES[word]) {
        if (!seen || group <= 0 || SCALES[word] >= lastScale) return null;
        total += group * SCALES[word]; group = 0; lastScale = SCALES[word];
      } else return null;
      previous = word;
    }
    value = sign * (total + group + decimal) * scale;
  }
  if (!Number.isFinite(value) || Math.abs(value) > 1e9 || percent && (value < 0 || value > 100)) return null;
  return { value, currency, percent, qualifier };
}

function formatNumber(number) {
  const amount = Number.isInteger(number.value) ? String(number.value) : String(Number(number.value.toFixed(8)));
  return `${number.qualifier ? number.qualifier + " " : ""}${number.currency}${amount}${number.percent ? "%" : ""}`;
}

/** Rational arithmetic avoids rounded totals masquerading as exact calculations. */
export function computeBoldMath(operation, numbers) {
  if (!["add", "subtract", "multiply", "percent", "compare", "per"].includes(operation) || !Array.isArray(numbers) || numbers.length !== 2 || numbers.some((number) => !Number.isFinite(number?.value))) return null;
  const [a, b] = numbers;
  if (operation === "compare") return null;
  if (["add", "subtract"].includes(operation) && (a.currency !== b.currency || a.percent !== b.percent)) return null;
  if (["multiply", "percent"].includes(operation) && (a.currency && b.currency || a.percent && b.percent)) return null;
  if (operation === "percent" && !a.percent && !b.percent && (a.currency || b.currency)) return null;
  if (operation === "per" && (a.percent || b.percent || b.currency && a.currency !== b.currency)) return null;
  // Operands and unspoken totals are bounded to cents and a billion units.
  if (numbers.some((number) => Math.abs(number.value) > 1e9 || !Number.isSafeInteger(Math.round(number.value * 100)) || Math.abs(Math.round(number.value * 100) / 100 - number.value) > 1e-10)) return null;
  const fraction = (number) => ({ n: BigInt(Math.round(number.value * 100)), d: BigInt(number.percent ? 10000 : 100) });
  const x = fraction(a), y = fraction(b);
  let n, d, currency = "", percent = false;
  if (operation === "add" || operation === "subtract") {
    n = x.n * y.d + (operation === "add" ? 1n : -1n) * y.n * x.d; d = x.d * y.d;
    currency = a.currency; percent = a.percent;
    if (percent) n *= 100n;
  } else if (operation === "multiply" || operation === "percent" && (a.percent || b.percent)) {
    n = x.n * y.n; d = x.d * y.d; currency = a.currency || b.currency;
  } else {
    if (y.n === 0n) return null;
    n = x.n * y.d; d = x.d * y.n;
    percent = operation === "percent";
    if (percent) n *= 100n;
    currency = operation === "per" && !b.currency ? a.currency : "";
  }
  if (!d) return null;
  const value = Number(n) / Number(d);
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) return null;
  const exact = (n * 100n) % d === 0n && !a.qualifier && !b.qualifier;
  return { value, currency, percent, qualifier: "", exact };
}

function fullNumber(range, words) {
  const value = parseBoldNumber(said(range, words));
  if (!value) return null;
  // Indexes cannot clip ten out of ten thousand, or erase a nearby spoken qualifier/unit.
  const before = words[range.from - 1]?.text || "", after = words[range.to + 1]?.text || "";
  if (before && !/[.!?,;:]$/.test(before) && parseBoldNumber(`${before} ${said(range, words)}`)) return null;
  if (after && !/[.!?,;:]$/.test(words[range.to].text) && parseBoldNumber(`${said(range, words)} ${after}`)) return null;
  if (/^(?:to|than)$/i.test(before) && /^(?:up|more|less)$/i.test(words[range.from - 2]?.text || "")) return null;
  return value;
}

export function validateMathPick(pick, context) {
  const { words = [] } = context;
  if (!boldEvidenceEnabled(context) || !settingsFor(context).enabled || !rangeOK(pick, words) || !["add", "subtract", "multiply", "percent", "compare", "per"].includes(pick.operation) || !Array.isArray(pick.numbers) || pick.numbers.length !== 2) return null;
  const selected = [];
  for (const range of pick.numbers) {
    if (!rangeOK(range, words) || range.from < pick.from || range.to > pick.to || range.to - range.from > 10 || !fullNumber(range, words)) return null;
    if (selected.some((other) => range.from <= other.to && range.to >= other.from)) return null;
    let label;
    if (range.label) {
      if (!rangeOK(range.label, words) || range.label.from < pick.from || range.label.to > pick.to || range.label.to - range.label.from > 3) return null;
      label = { from: range.label.from, to: range.label.to };
    }
    selected.push({ from: range.from, to: range.to, ...(label ? { label } : {}) });
  }
  let result;
  if (pick.result) {
    if (!rangeOK(pick.result, words) || pick.result.from < pick.from || pick.result.to > pick.to || !fullNumber(pick.result, words) || selected.some((range) => pick.result.from <= range.to && pick.result.to >= range.from)) return null;
    result = { from: pick.result.from, to: pick.result.to };
  }
  return { operation: pick.operation, numbers: selected, ...(result ? { result } : {}), holdSeconds: 3.5 };
}

/** Rows reveal on their selected number, regardless of operand order (e.g. showed / booked). */
export function boldMathLines(pick, context) {
  const valid = validateMathPick(pick, context);
  if (!valid) return [];
  const { words, fps } = context;
  const numbers = valid.numbers.map((range) => fullNumber(range, words));
  const rows = valid.numbers.map((range, i) => ({ from: range.from, frame: Math.round(words[range.from].start * fps), text: formatNumber(numbers[i]), label: range.label ? said(range.label, words) : "", result: false }));
  const computed = computeBoldMath(valid.operation, numbers);
  const spoken = valid.result && fullNumber(valid.result, words);
  const lastFrame = Math.max(...rows.map((row) => row.frame));
  if (computed) {
    const same = spoken && spoken.currency === computed.currency && spoken.percent === computed.percent && Math.abs(spoken.value - computed.value) < 1e-8;
    if (same || computed.exact && !valid.result) {
      const frame = valid.result ? Math.round(words[valid.result.from].start * fps) : lastFrame + 4;
      if (frame >= lastFrame) rows.push({ from: valid.result?.from ?? valid.numbers.at(-1).from, frame, text: `= ${formatNumber(same ? spoken : computed)}`, label: "", result: true });
    }
  }
  return rows.sort((a, b) => a.frame - b.frame || Number(a.result) - Number(b.result));
}

function placeMath(event, context) {
  if (!boldEvidenceEnabled(context)) return null;
  const cfg = settingsFor(context), max = Math.min(2, Math.max(0, Math.floor(Number(cfg.max) || 0)), context.duration <= 30 ? 1 : 2);
  if ((context.overlays || []).filter((other) => other.kind === "math").length >= max) return null;
  const lines = boldMathLines(event, context);
  if (!lines.length || lines[0].frame !== event.startFrame) return null;
  // Numbers said back to back ("$9.99, $19.99") end with their last word: hold the finished panel about 2.5 s after
  // its last line (found on the first real render, 2026-11-11), within 8 s and the reel.
  const endFrame = Math.min(Math.round(context.duration * context.fps), event.startFrame + 8 * context.fps, Math.max(event.endFrame, lines.at(-1).frame + Math.round(2.5 * context.fps)));
  if (lines.at(-1).frame >= endFrame - Math.ceil(0.75 * context.fps)) return null;
  event = { ...event, endFrame, end: endFrame / context.fps };
  const W = context.plan.canvas.width, scale = W / 1080;
  const maxW = W * Math.min(0.4, Math.max(0.1, Number(cfg.widthFraction) || 0.4));
  // Beside the face first; a centered talking head leaves about 170 px a side, so then above the head or between the
  // chin and the captions (never on the face, captions or headline: placeBoldCard checks).
  for (const beside of [true, false]) for (let w = maxW; w >= 200 * scale; w -= 24 * scale) {
    const padding = 16 * scale;
    const size = Math.min(...lines.map((line) => fitBoldText([line.text], { size: Math.min(128, Number(cfg.size) || 96) * scale, width: w - 2 * padding }).size));
    const labelSize = Math.min(36 * scale, ...lines.filter((line) => line.label).map((line) => fitBoldText([line.label], { size: 36 * scale, width: w - 2 * padding }).size));
    if (size < 32 || labelSize < 32) continue;
    const rowHeight = size * 1.12 + (lines.some((line) => line.label) ? labelSize * 1.2 : 0) + 12 * scale;
    const box = placeBoldCard({ w, h: lines.length * rowHeight + padding * 2 }, event, context, { beside });
    if (box) return { box, endFrame, landingFrame: lines[0].frame, data: { lines, padding, size, labelSize, rowHeight } };
  }
  return null;
}

registerBoldOverlay("math", {
  prompt: (context) => !boldEvidenceEnabled(context) || !settingsFor(context).enabled ? "Disabled." : 'Optional small business math beside the face, zero is fine. Pick {kind:"math",from,to,reason,operation:"add"|"subtract"|"multiply"|"percent"|"compare"|"per",numbers:[{from,to,label?:{from,to}},{from,to,label?:{from,to}}],result?:{from,to}}. Two COMPLETE spoken number ranges including qualifiers and money/percent units; labels at most four exact transcript words. from is the earliest operand word; to includes any spoken result. For percent of an amount choose the percent operand and amount; for show rate choose attended as operand 1 and booked as operand 2 (division), even if spoken in reverse order. per is operand 1 divided by operand 2. Never supply numeric values or screen copy. Code computes, and suppresses nonexact, unsafe or unsupported results. Compare shows spoken values only. Lines cut on each number, no counter. At most one panel through 30 seconds, two on longer reels; never a full-screen scene.',
  validate: validateMathPick,
  place: placeMath,
  html: (event, { esc, i }) => `<div id="bold-math-${i}" class="bold-math" style="left:${event.box.x}px;top:${event.box.y}px;width:${event.box.w}px;height:${event.box.h}px;padding:${event.data.padding}px${event.startFrame === 0 ? ";opacity:1" : ""}" data-start="${event.start}" data-duration="${event.end - event.start}">${event.data.lines.map((line, j) => `<div id="bold-math-${i}-${j}" class="bold-math-line${line.result ? " bold-math-result" : ""}" style="height:${event.data.rowHeight}px;font-size:${event.data.size}px${line.frame === 0 ? ";opacity:1" : ""}">${esc(line.text)}${line.label ? `<span class="bold-math-label" style="font-size:${event.data.labelSize}px">${esc(line.label)}</span>` : ""}</div>`).join("")}</div>`,
  css: ({ settings }) => `.bold-root .bold-math { position:absolute; box-sizing:border-box; opacity:0; pointer-events:none; z-index:18; border-radius:12px; background:${settings.colors.black}; color:${settings.colors.bone}; }
    .bold-root .bold-math-line { opacity:0; font-family:"Inter",sans-serif; font-weight:900; font-variant-numeric:tabular-nums; line-height:1.12; white-space:nowrap; }
    .bold-root .bold-math-result { color:${settings.colors.gold}; }
    .bold-root .bold-math-label { display:block; font-family:"Inter",sans-serif; font-weight:650; line-height:1.2; }`,
  timeline: (event, { i, plan }) => {
    const fps = plan.style.render?.fps || 30;
    return `tl.set("#bold-math-${i}", {opacity:0}, 0);\ntl.set("#bold-math-${i}", {opacity:1}, ${event.start});\n${event.data.lines.map((line, j) => `tl.set("#bold-math-${i}-${j}", {opacity:0}, 0);\ntl.set("#bold-math-${i}-${j}", {opacity:1}, ${line.frame / fps});`).join("\n")}\ntl.set("#bold-math-${i}", {opacity:0}, ${event.end});`;
  },
  sounds: (event, context) => {
    if (!boldEvidenceEnabled(context)) return [];
    const cfg = settingsFor(context), result = event.data.lines.find((line) => line.result);
    if (!cfg.resultSound || !result) return [];
    const volume = Math.min(0.2, Math.max(0, Number(cfg.soundVolume) || 0));
    if (!volume) return [];
    const sync = eventClock({ landAt: result.frame / context.fps, sfx: "card.wav", fps: context.fps });
    return [{ id: `sfx-bold-math-${event.startFrame}`, src: "assets/sfx/card.wav", start: sync.start, duration: 0.3, volume, track: 9 }];
  },
});
