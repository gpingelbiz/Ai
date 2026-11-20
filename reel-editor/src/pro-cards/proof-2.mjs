const small = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const tens = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Parse a single quantity, never the first number in a range, fraction or claim.
function underHundred(words) {
  if (words.length === 1) return small[words[0]] ?? tens[words[0]] ?? null;
  if (words.length === 2 && tens[words[0]] && small[words[1]] > 0 && small[words[1]] < 10) return tens[words[0]] + small[words[1]];
  return null;
}

function underThousand(words) {
  if (words[1] !== "hundred") return underHundred(words);
  if (!(small[words[0]] > 0 && small[words[0]] < 10)) return null;
  const rest = words.slice(words[2] === "and" ? 3 : 2);
  if (!rest.length) return words[2] === "and" ? null : small[words[0]] * 100;
  const tail = underHundred(rest);
  return tail > 0 ? small[words[0]] * 100 + tail : null;
}

function quantity(text) {
  let raw = String(text).trim().toLowerCase().replace(/[.!?]$/, "");
  const unit = /^\$/.test(raw) || /\bdollars?$/.test(raw) ? "dollar" : /%$|\bpercent$|\bper cent$/.test(raw) ? "percent" : "number";
  raw = (unit === "dollar" ? raw.replace(/^\$\s*/, "").replace(/\s*dollars?$/, "") : unit === "percent" ? raw.replace(/\s*(?:%|percent|per cent)$/, "") : raw).trim();
  let value = null;
  if (/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) value = Number(raw.replaceAll(",", ""));
  else {
    const words = raw.replace(/(?<=[a-z])-(?=[a-z])/g, " ").split(/\s+/);
    const k = words.indexOf("thousand");
    if (k >= 0) {
      const head = underThousand(words.slice(0, k));
      const rest = words.slice(k + 1);
      if (rest[0] === "and") rest.shift();
      const tail = rest.length ? underThousand(rest) : 0;
      if (head > 0 && tail !== null && words.at(-1) !== "and") value = head * 1000 + tail;
    } else value = underThousand(words);
  }
  return value !== null && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? { value, unit } : null;
}

const spoken = (maxChars, width, size, maxLines = 1, validate) => ({ kind: "spoken", maxChars, width, size, maxLines, ...(validate ? { validate } : {}) });
const numeric = (text) => quantity(text) !== null;
const count = (text) => { const q = quantity(text); return q?.unit === "number" && Number.isInteger(q.value); };
const percent = (text) => { const q = quantity(text); return q?.unit === "percent" && q.value <= 100; };
const dollars = (text) => quantity(text)?.unit === "dollar";
const streakCount = (text) => count(text) && quantity(text).value <= 7;
const odometerCount = (text) => count(text) && quantity(text).value <= 999999;

// Every spoken item starts hidden, including optional attribution and SVG initials.
function write(h, selector, at) {
  return `tl.fromTo(${h.sel(selector)},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

function state(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${h.at(at)});`;
}

function base(type) {
  return `
    .pro-${type} .p2-hidden { opacity:0;clip-path:inset(0 100% 0 0); }
    .pro-${type} .p2-label { font:600 32px/38px "Inter",sans-serif;color:#A8A49C; }
    .pro-${type} .p2-value { font:400 64px/72px "Anton",sans-serif; }
    .pro-${type} .p2-draw { fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1; }`;
}

const arrow = `<svg class="p2-arrow" viewBox="0 0 64 32" aria-hidden="true"><path pathLength="1" class="p2-draw" d="M4 16H58M44 3l14 13-14 13"/></svg>`;

export const CARDS = {
  odometer: {
    family: "proof",
    hint: "Greg states one nonnegative whole count up to six digits, then its spoken label; use a total achieved, never an estimate or range",
    slots: { value: spoken(30, 320, 28, 1, odometerCount), label: spoken(32, 300, 36, 2) },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const value = o.slots.value[0], label = o.slots.label[0], q = quantity(value.text);
      if (!odometerCount(value.text)) return { inner: "", timeline: "" };
      const digits = String(q.value);
      // Only the earned digit repeats on each reel; intermediate counts would invent copy.
      const reels = [...digits].map((digit, i) => `<span class="odo-window"><span class="odo-reel odo-reel-${i}"><span aria-hidden="true">${digit}</span><span>${digit}</span></span></span>`).join("");
      const exact = value.text !== digits ? `<div class="odo-exact">${h.copy(value)}</div>` : "";
      const inner = `<div class="odo-value p2-hidden"><div class="odo-digits" aria-label="${h.esc(value.text)}">${reels}</div>${exact}</div><div class="odo-label p2-hidden">${h.copy(label)}</div>`;
      const timeline = [write(h, ".odo-value", value.at), ...[...digits].map((_, i) => state(h, `.odo-reel-${i}`, { y: 0 }, { y: -64 }, value.at + i * 0.012)), write(h, ".odo-label", label.at)].join("\n");
      return { inner, timeline };
    },
    css: base("odometer") + `
      .pro-odometer { display:grid;grid-template-columns:336px 300px;gap:20px;align-items:center;padding:24px 32px; }
      .pro-odometer .odo-digits { display:flex;gap:4px; }
      .pro-odometer .odo-window { width:48px;height:64px;overflow:hidden;border:1px solid #343438;border-radius:6px;background:#0B0B0D; }
      .pro-odometer .odo-reel { display:block;color:#C8A24B;font:400 56px/64px "Anton",sans-serif;text-align:center; }
      .pro-odometer .odo-reel>span { display:block;height:64px; }
      .pro-odometer .odo-exact { margin-top:8px;font:500 28px/34px "Inter",sans-serif;color:#A8A49C; }
      .pro-odometer .odo-label { font:700 36px/44px "Inter",sans-serif; }`,
  },
  scoreboard: {
    family: "proof",
    hint: "Greg names a team and its whole score, then another team and its whole score in the same contest; never invent competitors or scores",
    slots: { leftTeam: spoken(22, 300, 30), leftScore: spoken(20, 300, 56, 1, count), rightTeam: spoken(22, 300, 30), rightScore: spoken(20, 300, 56, 1, count) },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const left = o.slots.leftScore[0], right = o.slots.rightScore[0];
      if (!count(left.text) || !count(right.text)) return { inner: "", timeline: "" };
      const a = quantity(left.text).value, b = quantity(right.text).value;
      const inner = ["left", "right"].map((side) => `<div class="score-side score-${side}"><div class="score-team p2-hidden">${h.copy(o.slots[`${side}Team`][0])}</div><div class="score-led"><div class="score-number p2-hidden">${h.copy(o.slots[`${side}Score`][0])}</div></div></div>`).join("");
      const timeline = [write(h, ".score-left .score-team", o.slots.leftTeam[0].at), write(h, ".score-left .score-number", left.at), write(h, ".score-right .score-team", o.slots.rightTeam[0].at), write(h, ".score-right .score-number", right.at), ...(a === b ? [] : [state(h, `.score-${a > b ? "left" : "right"} .score-led`, { color: "#F5F1E8", borderColor: "#343438" }, { color: "#C8A24B", borderColor: "#C8A24B" }, right.at)])].join("\n");
      return { inner, timeline };
    },
    css: base("scoreboard") + `
      .pro-scoreboard { display:grid;grid-template-columns:1fr 1fr;gap:32px;padding:16px 32px;border-top:4px solid #343438; }
      .pro-scoreboard .score-side { min-width:0;text-align:center; }
      .pro-scoreboard .score-team { font:700 30px/36px "Inter",sans-serif;color:#A8A49C;margin-bottom:8px; }
      .pro-scoreboard .score-led { border:2px solid #343438;border-radius:4px;background:#0B0B0D;color:#F5F1E8; }
      .pro-scoreboard .score-number { font:400 56px/68px "Anton",sans-serif;font-variant-numeric:tabular-nums;letter-spacing:2px; }`,
  },
  "line-chart": {
    family: "proof",
    hint: "Greg gives a start amount and spoken label then a larger comparable end amount and label; only a two-endpoint increase, no invented intermediate data",
    slots: {
      start: spoken(24, 300, 44, 2, numeric), startLabel: spoken(24, 300, 30),
      end: spoken(24, 300, 44, 2, (text, slots) => { const a = quantity(slots.start?.[0]?.text), b = quantity(text); return !!a && !!b && a.unit === b.unit && b.value > a.value; }),
      endLabel: spoken(24, 300, 30),
    },
    size: { w: 720, h: 376 },
    surface: "obsidian",
    render(o, h) {
      const a = o.slots.start[0], b = o.slots.end[0];
      const first = quantity(a.text), last = quantity(b.text);
      if (!first || !last || first.unit !== last.unit || last.value <= first.value) return { inner: "", timeline: "" };
      const inner = `<div class="chart-values"><div class="chart-start p2-hidden">${h.copy(a)}</div><div class="chart-end p2-hidden">${h.copy(b)}</div></div><svg class="chart-plot" viewBox="0 0 656 140" aria-hidden="true"><path class="chart-axis" d="M12 8V128H644"/><path class="chart-line p2-draw" pathLength="1" d="M24 116L632 20"/><circle class="chart-first p2-hidden" cx="24" cy="116" r="7"/><circle class="chart-last p2-hidden" cx="632" cy="20" r="7"/></svg><div class="chart-labels"><div class="chart-start-label p2-label p2-hidden">${h.copy(o.slots.startLabel[0])}</div><div class="chart-end-label p2-label p2-hidden">${h.copy(o.slots.endLabel[0])}</div></div>`;
      return { inner, timeline: [write(h, ".chart-start", a.at), write(h, ".chart-first", a.at), write(h, ".chart-start-label", o.slots.startLabel[0].at), write(h, ".chart-end", b.at), state(h, ".chart-line", { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, b.at), write(h, ".chart-last", b.at), write(h, ".chart-end-label", o.slots.endLabel[0].at)].join("\n") };
    },
    css: base("line-chart") + `
      .pro-line-chart { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-line-chart .chart-values { display:grid;grid-template-columns:300px 300px;justify-content:space-between;font:400 44px/52px "Anton",sans-serif;min-height:104px; }
      .pro-line-chart .chart-end { text-align:right;color:#C8A24B; }
      .pro-line-chart .chart-plot { display:block;width:656px;height:140px;flex:none; }
      .pro-line-chart .chart-axis { fill:none;stroke:#343438;stroke-width:2; }
      .pro-line-chart .chart-first { fill:#A8A49C; }
      .pro-line-chart .chart-last { fill:#C8A24B; }
      .pro-line-chart .chart-labels { display:flex;justify-content:space-between; }
      .pro-line-chart .chart-labels>div { width:300px;font-size:30px;line-height:36px; }
      .pro-line-chart .chart-end-label { text-align:right; }`,
  },
  gauge: {
    family: "proof",
    hint: "Greg explicitly says a percentage from zero through one hundred and then its context; no bare count, ratio, range or implied percentage",
    slots: { value: spoken(26, 360, 44, 2, percent), context: spoken(48, 656, 36, 2) },
    size: { w: 720, h: 432 },
    surface: "obsidian",
    render(o, h) {
      const value = o.slots.value[0];
      if (!percent(value.text)) return { inner: "", timeline: "" };
      const angle = Math.PI * (1 - quantity(value.text).value / 100);
      // Move the SVG endpoint: the instrument swings without rotating the card or its copy.
      const tip = { x2: h.at(180 + 120 * Math.cos(angle)), y2: h.at(164 - 120 * Math.sin(angle)) };
      const inner = `<svg class="gauge-dial" viewBox="0 0 360 184" aria-hidden="true"><path class="gauge-track" d="M20 164a160 160 0 0 1 320 0"/><path class="gauge-ticks" d="M20 164h14M67 51l10 10M180 4v14M293 51l-10 10M340 164h-14"/><g class="gauge-hand p2-hidden"><line class="gauge-needle" x1="180" y1="164" x2="180" y2="44"/><circle cx="180" cy="164" r="9"/></g></svg><div class="gauge-value p2-hidden">${h.copy(value)}</div><div class="gauge-context p2-hidden">${h.copy(o.slots.context[0])}</div>`;
      return { inner, timeline: [write(h, ".gauge-value", value.at), write(h, ".gauge-hand", value.at), state(h, ".gauge-needle", { attr: { x2: 180, y2: 44 } }, { attr: tip }, value.at), write(h, ".gauge-context", o.slots.context[0].at)].join("\n") };
    },
    css: base("gauge") + `
      .pro-gauge { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px 32px; }
      .pro-gauge .gauge-dial { width:300px;height:154px;flex:none; }
      .pro-gauge .gauge-track { fill:none;stroke:#343438;stroke-width:12; }
      .pro-gauge .gauge-ticks { fill:none;stroke:#A8A49C;stroke-width:3; }
      .pro-gauge .gauge-needle { stroke:#C8A24B;stroke-width:6;stroke-linecap:round; }
      .pro-gauge .gauge-hand circle { fill:#C8A24B; }
      .pro-gauge .gauge-value { width:360px;text-align:center;font:400 44px/52px "Anton",sans-serif;color:#C8A24B; }
      .pro-gauge .gauge-context { width:656px;text-align:center;font:600 36px/44px "Inter",sans-serif; }`,
  },
  "money-stack": {
    family: "proof",
    hint: "Greg states an actual nonnegative dollar amount, including dollars or a dollar sign in the spoken range; not a target he never quantifies",
    slots: { value: spoken(32, 492, 56, 2, dollars) },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const value = o.slots.value[0];
      if (!dollars(value.text)) return { inner: "", timeline: "" };
      // The unnumbered bills are an icon, not one bill per dollar or a second scale.
      const bills = [28, 16, 4].map((y, i) => `<g transform="translate(0 ${y})"><g class="money-bill money-bill-${i}"><rect x="5" y="4" width="118" height="58" rx="5"/><path d="M17 17h16M95 49h16"/><ellipse cx="64" cy="33" rx="15" ry="19"/></g></g>`).join("");
      return { inner: `<svg class="money-icon" viewBox="0 0 128 96" aria-hidden="true">${bills}</svg><div class="money-value p2-hidden">${h.copy(value)}</div>`, timeline: [write(h, ".money-value", value.at), ...[0, 1, 2].map((i) => state(h, `.money-bill-${i}`, { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, value.at + i * 0.04))].join("\n") };
    },
    css: base("money-stack") + `
      .pro-money-stack { display:flex;align-items:center;gap:28px;padding:16px 32px; }
      .pro-money-stack .money-icon { width:128px;height:96px;flex:none; }
      .pro-money-stack .money-bill { opacity:0;fill:#0B0B0D;stroke:#C8A24B;stroke-width:3; }
      .pro-money-stack .money-bill path { fill:none; }
      .pro-money-stack .money-value { width:492px;font:400 56px/64px "Anton",sans-serif;color:#C8A24B; }`,
  },
  trophy: {
    family: "proof",
    hint: "Greg names a specific achieved win, award or milestone; not encouragement, a hypothetical win or an unearned success claim",
    slots: { achievement: spoken(48, 512, 40, 2) },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const at = o.slots.achievement[0].at;
      const inner = `<svg class="trophy-icon" viewBox="0 0 112 112" aria-hidden="true"><path class="trophy-outline p2-draw" pathLength="1" d="M29 8h54v28c0 37-54 37-54 0ZM29 18H9v15c0 20 15 26 29 26M83 18h20v15c0 20-15 26-29 26M56 64v29M35 94h42v10H35Z"/><path class="trophy-shine" d="M40 20v19c0 9 5 13 10 15"/></svg><div class="trophy-achievement p2-hidden">${h.copy(o.slots.achievement[0])}</div>`;
      return { inner, timeline: write(h, ".trophy-achievement", at) + "\n" + state(h, ".trophy-outline", { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at) };
    },
    css: base("trophy") + `
      .pro-trophy { display:flex;align-items:center;gap:32px;padding:24px 32px;border-bottom:4px solid #C8A24B; }
      .pro-trophy .trophy-icon { width:112px;height:104px;flex:none; }
      .pro-trophy .trophy-shine { fill:none;stroke:#343438;stroke-width:3;stroke-linecap:round; }
      .pro-trophy .trophy-achievement { width:512px;font:700 40px/48px "Inter",sans-serif; }`,
  },
  streak: {
    family: "proof",
    hint: "Greg explicitly states a consecutive streak as a whole count from zero through seven, followed by its spoken label; larger counts and fractions are ineligible",
    slots: { count: spoken(5, 120, 44, 1, streakCount), label: spoken(28, 504, 32) },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const count = o.slots.count[0], label = o.slots.label[0];
      if (!streakCount(count.text)) return { inner: "", timeline: "" };
      const n = quantity(count.text).value;
      const inner = `<div class="streak-header"><div class="streak-count p2-hidden">${h.copy(count)}</div><div class="streak-label p2-label p2-hidden">${h.copy(label)}</div></div><svg class="streak-dots" viewBox="0 0 656 40" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<circle class="streak-dot streak-dot-${i}" cx="${22 + i * 102}" cy="20" r="16"/>`).join("")}</svg>`;
      return { inner, timeline: [write(h, ".streak-count", count.at), write(h, ".streak-label", label.at), ...Array.from({ length: n }, (_, i) => state(h, `.streak-dot-${i}`, { fill: "#343438" }, { fill: "#C8A24B" }, count.at + i * 0.04))].join("\n") };
    },
    css: base("streak") + `
      .pro-streak { display:flex;flex-direction:column;justify-content:center;gap:12px;padding:24px 32px; }
      .pro-streak .streak-header { display:flex;align-items:center;gap:32px; }
      .pro-streak .streak-count { width:120px;flex:none;font:400 44px/52px "Anton",sans-serif;color:#C8A24B; }
      .pro-streak .streak-label { width:504px; }
      .pro-streak .streak-dots { display:block;width:656px;height:40px;flex:none; }
      .pro-streak .streak-dot { fill:#343438; }`,
  },
  "case-study": {
    family: "proof",
    hint: "Greg gives a real client's before value, comparable after value and spoken metric label; not hypothetical results or a wording correction",
    slots: { before: spoken(24, 268, 36, 2, numeric), after: spoken(24, 268, 36, 2, (text, slots) => { const a = quantity(slots.before?.[0]?.text), b = quantity(text); return !!a && !!b && a.unit === b.unit; }), label: spoken(32, 656, 30) },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const before = o.slots.before[0], after = o.slots.after[0];
      const a = quantity(before.text), b = quantity(after.text);
      if (!a || !b || a.unit !== b.unit) return { inner: "", timeline: "" };
      const inner = `<div class="case-flow"><div class="case-before p2-hidden">${h.copy(before)}</div>${arrow}<div class="case-after p2-hidden">${h.copy(after)}</div></div><div class="case-label p2-label p2-hidden">${h.copy(o.slots.label[0])}</div>`;
      return { inner, timeline: [write(h, ".case-before", before.at), state(h, ".p2-arrow path", { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, after.at), write(h, ".case-after", after.at), write(h, ".case-label", o.slots.label[0].at)].join("\n") };
    },
    css: base("case-study") + `
      .pro-case-study { display:flex;flex-direction:column;justify-content:center;gap:8px;padding:20px 32px; }
      .pro-case-study .case-flow { display:grid;grid-template-columns:268px 64px 268px;gap:28px;align-items:center;font:400 36px/42px "Anton",sans-serif; }
      .pro-case-study .case-before { color:#A8A49C;text-align:right; }
      .pro-case-study .case-after { color:#C8A24B; }
      .pro-case-study .p2-arrow { width:64px;height:32px; }
      .pro-case-study .case-label { font-size:30px;line-height:36px;text-align:center; }`,
  },
  "kpi-tile": {
    family: "proof",
    hint: "Greg states one numeric business metric that earns a dashboard tile; label is a short number-free heading, sparkline is decorative rather than measured history",
    slots: { label: { kind: "label", maxChars: 26, width: 460, size: 28, maxLines: 1 }, value: spoken(24, 460, 52, 1, numeric) },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const value = o.slots.value[0];
      if (!numeric(value.text)) return { inner: "", timeline: "" };
      const inner = `<div class="kpi-copy"><div class="kpi-label">${h.copy(o.slots.label[0])}</div><div class="kpi-value p2-hidden">${h.copy(value)}</div></div><svg class="kpi-spark" viewBox="0 0 140 64" aria-hidden="true"><path class="p2-draw" pathLength="1" d="M4 40l20-16 20 26 24-34 24 24 22-16 22 12"/></svg>`;
      return { inner, timeline: write(h, ".kpi-value", value.at) + "\n" + state(h, ".kpi-spark path", { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, value.at) };
    },
    css: base("kpi-tile") + `
      .pro-kpi-tile { display:flex;align-items:center;gap:24px;padding:24px 32px;border-left:8px solid #C8A24B; }
      .pro-kpi-tile .kpi-copy { width:460px;flex:none; }
      .pro-kpi-tile .kpi-label { font:600 28px/34px "Inter",sans-serif;color:#A8A49C;margin-bottom:6px; }
      .pro-kpi-tile .kpi-value { font:400 52px/62px "Anton",sans-serif; }
      .pro-kpi-tile .kpi-spark { width:140px;height:64px;flex:none; }`,
  },
  testimonial: {
    family: "proof",
    hint: "Greg explicitly quotes what a client said; optional name must be spoken before the quote, otherwise the avatar uses only the Client label's initial",
    slots: { name: { ...spoken(26, 524, 30), optional: true }, quote: spoken(100, 640, 44, 4) },
    size: { w: 720, h: 432 },
    surface: "bone",
    render(o, h) {
      const name = o.slots.name[0], quote = o.slots.quote[0];
      const initials = name ? (name.text.match(/\p{L}[\p{L}'’-]*/gu) || []).slice(0, 2).map((word) => [...word][0].toUpperCase()).join("") : "C";
      const inner = `<div class="test-person"><svg class="test-avatar" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="36"/><text class="test-initials${name ? " p2-hidden" : ""}" x="38" y="49" text-anchor="middle">${h.esc(initials)}</text></svg><div><div class="test-label">Client</div>${name ? `<div class="test-name p2-hidden">${h.copy(name)}</div>` : ""}</div></div><div class="test-quote p2-hidden">${h.copy(quote)}</div><svg class="test-tail" viewBox="0 0 40 20" aria-hidden="true"><path d="M0 0h40L0 20Z"/></svg>`;
      return { inner, timeline: [...(name ? [write(h, ".test-name", name.at), write(h, ".test-initials", name.at)] : []), write(h, ".test-quote", quote.at)].join("\n") };
    },
    css: base("testimonial") + `
      .pro-testimonial { display:flex;flex-direction:column;justify-content:center;gap:24px;padding:32px 40px;border-radius:24px 24px 24px 0; }
      .pro-testimonial .test-person { display:flex;align-items:center;gap:24px; }
      .pro-testimonial .test-avatar { width:76px;height:76px;flex:none; }
      .pro-testimonial .test-avatar circle { fill:#0B0B0D; }
      .pro-testimonial .test-initials { fill:#C8A24B;font:700 30px "Inter",sans-serif; }
      .pro-testimonial .test-label { font:700 28px/34px "Inter",sans-serif;color:#343438; }
      .pro-testimonial .test-name { font:600 30px/36px "Inter",sans-serif;margin-top:4px; }
      .pro-testimonial .test-quote { font:600 44px/54px "Inter",sans-serif; }
      .pro-testimonial .test-tail { width:40px;height:20px;fill:#C8A24B;flex:none; }`,
  },
};
