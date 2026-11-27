// Adapted from the Herk Edit Kit (MIT, copyright 2026 Nate Herk). See src/pro-cards/HERK-LICENSE.md.

const ones = new Map("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ").map((word, i) => [word, i]));
const tens = new Map("twenty thirty forty fifty sixty seventy eighty ninety".split(" ").map((word, i) => [word, 20 + i * 10]));
const scales = [["billion", 1e9], ["million", 1e6], ["thousand", 1e3], ["hundred", 100]];
const id = (name) => `vox-explainer.t1.stat.${name}`;
const source = (...names) => `herk:${names.map(id).join(",")}`;

// Read the whole quantity. Chart geometry never uses the first number of a range.
function wholeWords(words, scaleIndex = 0) {
  for (let i = scaleIndex; i < scales.length; i++) {
    const [name, scale] = scales[i], split = words.indexOf(name);
    if (split < 0) continue;
    const head = wholeWords(words.slice(0, split), i + 1);
    const rest = words.slice(split + 1);
    const tail = rest[0] === "and" ? wholeWords(rest.slice(1), i + 1) : rest.length ? wholeWords(rest, i + 1) : 0;
    return head > 0 && head < (scale === 100 ? 10 : 1000) && tail !== null && tail < scale ? head * scale + tail : null;
  }
  const [first, second] = words;
  if (words.length === 1) return ones.get(first) ?? tens.get(first) ?? null;
  const unit = ones.get(second);
  return words.length === 2 && tens.has(first) && unit > 0 && unit < 10 ? tens.get(first) + unit : null;
}

const clean = (text) => String(text ?? "").trim().toLowerCase().replace(/[.!?,;:]$/, "");

function scalar(raw) {
  const text = raw.replace(/\s+/g, " ").trim();
  if (/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) {
    const value = Number(text.replaceAll(",", ""));
    return value <= Number.MAX_SAFE_INTEGER ? value : null;
  }
  const shorthand = text.match(/^(\d+(?:\.\d+)?)\s*([kmb]|thousand|million|billion)$/);
  if (shorthand) {
    const factor = { k: 1e3, m: 1e6, b: 1e9, thousand: 1e3, million: 1e6, billion: 1e9 };
    const value = Number(shorthand[1]) * factor[shorthand[2]];
    return value <= Number.MAX_SAFE_INTEGER ? value : null;
  }
  const words = text.replace(/(?<=[a-z])-(?=[a-z])/g, " ").split(/\s+/);
  const point = words.indexOf("point");
  if (point === -1) return wholeWords(words);
  const head = wholeWords(words.slice(0, point)), tail = words.slice(point + 1).map((word) => ones.get(word));
  return head !== null && tail.length && tail.every((digit) => digit >= 0 && digit < 10) ? Number(`${head}.${tail.join("")}`) : null;
}

function percent(text) {
  const match = clean(text).match(/^(.+?)(?:\s*%|\s+per ?cent)$/);
  const value = match ? scalar(match[1]) : null;
  return value !== null && value <= 100 ? value : null;
}

function count(text) {
  const value = scalar(clean(text));
  return Number.isSafeInteger(value) ? value : null;
}

function money(text) {
  const raw = clean(text).replace(/\s+(?:(?:a|per) (?:day|week|month|year)|(?:daily|weekly|monthly|annually))$|\/(?:day|wk|week|mo|month|yr|year)$/, "");
  const match = raw.match(/^\$\s*(.+)$|^(.+?)\s+dollars?$/);
  return match ? scalar(match[1] ?? match[2]) : null;
}

function duration(text) {
  const match = clean(text).match(/^(.+?)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|secs?|mins?|hrs?|s|h|d|w)$/);
  return match ? scalar(match[1]) : null;
}

function relativeTime(text) {
  const match = clean(text).match(/^(days?|weeks?|months?)\s+(.+)$|^(.+?)\s+(days?|weeks?|months?)$/);
  if (!match) return null;
  const unit = (match[1] ?? match[4]).replace(/s$/, "");
  const value = count(match[2] ?? match[3]);
  return value !== null ? { unit, value } : null;
}

function multiplier(text) {
  const match = clean(text).match(/^(.+?)(?:\s*[x×]|\s+times)$/);
  const value = match ? scalar(match[1]) : null;
  return value !== null && value >= 1 ? value : null;
}

function numeric(text) {
  const value = clean(text).replace(/^(?:[−-]|negative\s+)/, "");
  return [percent, money, duration, multiplier].some((read) => read(value) !== null) || scalar(value) !== null;
}
const isPercent = (text) => percent(text) !== null;

// The registry can shrink copy for older cards. Its smallest fit is 76% of the
// requested size, so budget at that step and render every accepted line at the house floor.
function spoken(width, { maxChars = 50, maxLines = 2, check, repeat } = {}) {
  return {
    kind: "spoken", width, size: 53, maxChars, maxLines,
    ...(repeat ? { repeat } : {}),
    ...(check ? { validate: check } : {}),
  };
}

// Anton is narrower than the registry's body-copy estimate. Measure numeric copy
// with conservative bounds from the bundled font and keep the authored size.
const antonAdvances = new Map([
  [" ", 0.25], ["m", 0.78], ["w", 0.72], ["M", 0.78], ["W", 0.74], ["%", 1.08],
  ["i", 0.26], ["l", 0.27], ["t", 0.33], ["f", 0.30], ["r", 0.37],
  ["1", 0.35], ["#", 0.57], ["−", 0.75], [".", 0.25], [",", 0.25],
]);

function heroLines(text, width) {
  const result = [];
  let lineWidth = 0;
  for (const word of text.trim().split(/\s+/)) {
    const wordWidth = [...word].reduce((sum, ch) => sum + 96 * (antonAdvances.get(ch) ?? 0.53), 0);
    if (wordWidth > width - 4) return null;
    if (result.length && lineWidth + 24 + wordWidth <= width - 4) {
      result[result.length - 1] += ` ${word}`;
      lineWidth += 24 + wordWidth;
    } else {
      result.push(word);
      lineWidth = wordWidth;
    }
  }
  return result;
}

function hero(width, check = numeric, maxLines = 2) {
  return {
    kind: "spoken", width, size: 96, maxChars: 38, maxLines,
    validate(text, slots) {
      if (!check(text, slots)) return false;
      const wrapped = heroLines(text, width);
      return !!wrapped && wrapped.length <= maxLines;
    },
  };
}

const heading = { kind: "label", optional: true, maxChars: 24, width: 656, size: 28, maxLines: 1 };

const cardSize = (h) => ({ w: 720, h });
const lines = (o, name) => o.slots[name][0]?.lines?.length ?? o.slots[name].length;
const bodyHeight = (o, name) => 48 * lines(o, name);
function heroHeight(o, name = "value") {
  const [item] = o.slots[name];
  const wrapped = heroLines(item.text, CARDS[o.type].slots[name].width);
  return 104 * (wrapped?.length ?? lines(o, name));
}

function part(h, name, item, style = "vs-copy") {
  return `<div class="vs-${name} vs-hidden ${style}">${h.copy({ text: item.text, lines: item.lines })}</div>`;
}

function heroPart(o, h, name, item) {
  const width = CARDS[o.type].slots[name].width;
  return part(h, name, { ...item, lines: heroLines(item.text, width) }, "vs-hero");
}

function title(h, item) {
  return item ? `<div class="vs-heading">${h.copy(item)}</div>` : "";
}

function write(h, name, item, from = {}, to = {}) {
  return tween(h, `.vs-${name}`, { opacity: 0, clipPath: "inset(0 100% 0 0)", ...from },
    { opacity: 1, clipPath: "inset(0 0% 0 0)", ...to }, item.at, false);
}

function tween(h, selector, from, to, at, state = true) {
  const duration = state ? h.motion.state : h.motion.enter;
  const ease = state ? "proState" : "proEnter";
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${duration},ease:${ease},immediateRender:false},${h.at(at)});`;
}

function revealParts(h, fields) {
  return Object.entries(fields).map(([name, item]) => write(h, name, item)).join("\n");
}

function stroke(h, selector, at, end = 0) {
  return tween(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: end }, at);
}

function sweep(h, selector, at, fill = 1) {
  return tween(h, selector, { scaleX: 0 }, { scaleX: fill }, at);
}

function base(type) {
  return `
    .pro-${type} .vs-hidden { opacity:0;clip-path:inset(0 100% 0 0); }
    .pro-${type} .vs-copy { font:700 40px/48px "Inter",sans-serif; }
    .pro-${type} .vs-hero { font:400 96px/104px "Anton",sans-serif;white-space:nowrap; }
    .pro-${type} .vs-heading { margin:0;font:700 28px/34px "Inter",sans-serif; }
    .pro-${type} .vs-line { fill:none;stroke:#C8A24B;stroke-width:4;stroke-dasharray:1;stroke-dashoffset:1; }
    .pro-${type} .vs-sweep { transform-origin:left center;transform:scaleX(0); }`;
}

function percentSlots(width = 656, contextWidth = 656, check = isPercent) {
  return { value: hero(width, check), context: spoken(contextWidth) };
}

function ratioSlots(limit, width, { contextWidth = 656, maxLines = 2, check } = {}) {
  return {
    share: hero(width, (text) => { const value = count(text); return value !== null && value <= limit; }, maxLines),
    total: hero(width, (text, slots) => {
      const total = count(text), share = count(slots.share[0].text);
      return total > 0 && total >= share && total <= limit;
    }, maxLines),
    context: spoken(contextWidth, { check, maxLines: 3 }),
  };
}

const person = '<circle cx="20" cy="9" r="7"/><path d="M5 27a7 7 0 0 1 7-7h16a7 7 0 0 1 7 7l-5 15H10Z"/>';

// The denominator is spoken, so every mark corresponds to an actual member of the group.
function ratioMarks(type, figures) {
  return {
    variantOf: "ratio-stack",
    family: "proof",
    tags: figures ? ["number", "chart"] : ["number", "progress"],
    hint: figures
      ? "Greg gives a whole count of people, the total group count and the reason those people are counted"
      : "Greg gives a whole count of completed steps, the total number of steps and the process they belong to",
    source: source(figures ? "isotype" : "progress-steps"),
    slots: ratioSlots(10, 320, { check: figures
      ? (text) => /\b(?:reps?|clients?|people|callers?|leads?|coaches|participants?|prospects?|buyers?|members?)\b/i.test(text)
      : (text) => /\b(?:steps?|stages?|lessons?|modules?|tasks?|milestones?|checkpoints?)\b/i.test(text) }),
    size: (o) => cardSize(136 + Math.max(heroHeight(o, "share"), heroHeight(o, "total")) + bodyHeight(o, "context")),
    surface: "obsidian",
    render(o, h) {
      const [share] = o.slots.share, [total] = o.slots.total, [context] = o.slots.context;
      const n = count(share.text), d = count(total.text), spacing = 656 / d;
      const marks = Array.from({ length: d }, (_, i) => {
        const drawing = figures ? person : '<rect x="2" y="13" width="36" height="28" rx="3"/>';
        return `<g class="vs-mark vs-mark-${i}" transform="translate(${h.at(spacing * (i + 0.5) - 20)} 0)">${drawing}</g>`;
      }).join("");
      const plot = `<svg class="vs-plot" viewBox="0 0 656 48" aria-hidden="true">${marks}</svg>`;
      const figuresIn = tween(h, ".vs-plot", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }, total.at);
      const fill = n ? tween(h, `.vs-mark:nth-child(-n+${n})`, { fill: "#0B0B0D" }, { fill: "#C8A24B" }, total.at) : "";
      const inner = `<div class="vs-ratio">${heroPart(o, h, "share", share)}${heroPart(o, h, "total", total)}</div>${plot}${part(h, "context", context)}`;
      return { inner, timeline: [revealParts(h, { share, total, context }), figuresIn, fill].join("\n") };
    },
    css: base(type) + `
      .pro-${type} { display:flex;flex-direction:column;justify-content:center;gap:10px; }
      .pro-${type} .vs-ratio { display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:center;min-height:104px;text-align:center; }
      .pro-${type} .vs-share { color:#C8A24B;border-right:4px solid #343438; }
      .pro-${type} .vs-plot { width:656px;height:48px;clip-path:inset(0 100% 0 0); }
      .pro-${type} .vs-mark { fill:#0B0B0D;stroke:#A8A49C;stroke-width:2; }`,
  };
}

function rankedRow(text) {
  const parts = clean(text).split(/\s+/);
  const isLabel = (label) => /[a-z]/.test(label) && !/[%\d]|\b(?:percent|to|versus|vs|through|or)\b/.test(label);
  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).join(" "), right = parts.slice(i).join(" ");
    const tail = percent(right), head = percent(left);
    if (tail !== null && isLabel(left)) return tail;
    if (head !== null && isLabel(right)) return head;
  }
  return null;
}

function ratioScore(text) {
  const pair = clean(text).split(/\s*(?:\/|\bout of\b|\bin\b|\bof\b)\s*/);
  if (pair.length !== 2) return null;
  const value = count(pair[0]), total = count(pair[1]);
  return value !== null && total > 0 && total <= 10 && value <= total ? { value, total } : null;
}

const rank = (text) => /^(?:#\s*[1-9]\d{0,2}|[1-9]\d{0,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)$/.test(clean(text))
  || (/^number\s+/.test(clean(text)) && count(clean(text).replace(/^number\s+/, "")) > 0);

export const CARDS = {
  "stat-disc": {
    family: "proof",
    tags: ["number", "callout"],
    hint: "Greg states one exact value, then explains what it measures; use for a standalone count, amount, multiplier or percentage without a comparison",
    source: source("circle", "spotlight", "magnifier"),
    slots: { value: hero(416, numeric, 2), context: spoken(656) },
    size: (o) => cardSize(80 + Math.max(176, heroHeight(o)) + bodyHeight(o, "context")),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context;
      const disc = '<svg class="vs-disc" viewBox="0 0 420 204" aria-hidden="true"><circle cx="210" cy="102" r="98"/></svg>';
      const inner = `<div class="vs-focus">${disc}${heroPart(o, h, "value", value)}</div>${part(h, "context", context)}`;
      const timeline = [tween(h, ".vs-disc", { opacity: 0, scale: 0.88 }, { opacity: 1, scale: 1 }, value.at), revealParts(h, { value, context })].join("\n");
      return { inner, timeline };
    },
    css: base("stat-disc") + `
      .pro-stat-disc { display:flex;flex-direction:column;justify-content:center;gap:10px;text-align:center; }
      .pro-stat-disc .vs-focus { position:relative;display:grid;place-items:center;min-height:176px; }
      .pro-stat-disc .vs-disc { position:absolute;width:362px;height:176px;fill:#C8A24B;opacity:0; }
      .pro-stat-disc .vs-value { position:relative;max-width:416px;color:#F5F1E8;paint-order:stroke fill;-webkit-text-stroke:6px #0B0B0D; }`,
  },
  "stat-unit-slab": {
    family: "proof",
    tags: ["number", "highlight"],
    hint: "Greg says an exact number followed immediately by its spoken unit or short scale phrase, then says what it measures; give the number and unit separate ranges",
    source: source("giant-left", "callout"),
    slots: { value: hero(296, numeric, 1), unit: spoken(312, { maxChars: 24 }), context: spoken(656) },
    size: { w: 720, h: 280 },
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [unit] = o.slots.unit, [context] = o.slots.context;
      const inner = `<div class="vs-pair">${heroPart(o, h, "value", value)}<div class="vs-unit-block">${part(h, "unit", unit)}<div class="vs-underline vs-sweep" aria-hidden="true"></div></div></div>${part(h, "context", context)}`;
      const timeline = [write(h, "value", value, { clipPath: "inset(0 0 100% 0)", y: 16 }, { y: 0 }),
        write(h, "unit", unit), sweep(h, ".vs-underline", unit.at), write(h, "context", context)].join("\n");
      return { inner, timeline };
    },
    css: base("stat-unit-slab") + `
      .pro-stat-unit-slab { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-stat-unit-slab .vs-pair { display:grid;grid-template-columns:296px 312px;gap:24px;align-items:end; }
      .pro-stat-unit-slab .vs-value { color:#C8A24B; }
      .pro-stat-unit-slab .vs-unit-block { padding-bottom:4px; }
      .pro-stat-unit-slab .vs-underline { height:4px;background:#C8A24B; }`,
  },
  "percent-bar": {
    variantOf: "percent-ring",
    family: "proof",
    tags: ["number", "percent", "chart"],
    hint: "Greg states one explicit percentage and what it measures; fill the track to the exact spoken share",
    source: source("bar", "linear-meter"),
    slots: percentSlots(),
    size: (o) => cardSize(108 + heroHeight(o) + bodyHeight(o, "context")),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context, fill = percent(value.text) / 100;
      const meter = '<div class="vs-track" aria-hidden="true"><div class="vs-fill vs-sweep"></div><div class="vs-notch"></div></div>';
      const inner = heroPart(o, h, "value", value) + meter + part(h, "context", context);
      const travel = tween(h, ".vs-notch", { x: 0, opacity: 0 }, { x: h.at(646 * fill), opacity: 1 }, value.at);
      return { inner, timeline: [revealParts(h, { value, context }), sweep(h, ".vs-fill", value.at, fill), travel].join("\n") };
    },
    css: base("percent-bar") + `
      .pro-percent-bar { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-percent-bar .vs-value { color:#C8A24B; }
      .pro-percent-bar .vs-track { position:relative;height:20px;background:#343438;border-radius:4px; }
      .pro-percent-bar .vs-fill { height:100%;background:#C8A24B;border-radius:4px; }
      .pro-percent-bar .vs-notch { position:absolute;left:0;top:-4px;width:10px;height:28px;background:#F5F1E8;opacity:0; }`,
  },
  "ratio-stack": {
    family: "proof",
    tags: ["number", "chart"],
    hint: "Greg gives a whole part count followed by its whole total, then says who or what the fraction describes; both quantities must be explicitly spoken",
    source: source("fraction"),
    slots: ratioSlots(9999, 388, { contextWidth: 244 }),
    size: (o) => cardSize(76 + heroHeight(o, "share") + heroHeight(o, "total")),
    surface: "obsidian",
    render(o, h) {
      const [share] = o.slots.share, [total] = o.slots.total, [context] = o.slots.context;
      const inner = `<div class="vs-stack">${heroPart(o, h, "share", share)}<div class="vs-divider vs-sweep" aria-hidden="true"></div>${heroPart(o, h, "total", total)}</div>${part(h, "context", context)}`;
      return { inner, timeline: [revealParts(h, { share, total, context }), sweep(h, ".vs-divider", total.at)].join("\n") };
    },
    // The stack keeps a full-size digit or short spoken word on each side of the rule.
    css: base("ratio-stack") + `
      .pro-ratio-stack { display:grid;grid-template-columns:388px 244px;gap:24px;align-items:center; }
      .pro-ratio-stack .vs-stack { display:grid;grid-template-rows:auto 4px auto;gap:4px;text-align:center; }
      .pro-ratio-stack .vs-share { color:#C8A24B; }
      .pro-ratio-stack .vs-divider { background:#C8A24B; }`,
  },
  "percent-waffle": {
    variantOf: "percent-ring",
    family: "proof",
    tags: ["number", "percent", "chart"],
    hint: "Greg states a whole percentage and what it measures; fill one dot per percentage point",
    source: source("dot-grid"),
    slots: percentSlots(440, 656, (text) => Number.isInteger(percent(text))),
    size: (o) => cardSize(80 + Math.max(176, heroHeight(o)) + bodyHeight(o, "context")),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context, filled = percent(value.text);
      const dots = Array.from({ length: 100 }, (_, i) => `<circle cx="${10 + i % 10 * 20}" cy="${10 + Math.floor(i / 10) * 20}" r="6"/>`).join("");
      const plot = `<svg class="vs-dots" viewBox="0 0 200 200" aria-hidden="true">${dots}</svg>`;
      const rows = Array.from({ length: Math.ceil(filled / 10) }, (_, i) => {
        const first = i * 10 + 1, last = Math.min(filled, first + 9);
        return tween(h, `.vs-dots circle:nth-child(n+${first}):nth-child(-n+${last})`,
          { fill: "#0B0B0D" }, { fill: "#C8A24B" }, value.at + i * 0.02);
      });
      const inner = `<div class="vs-top">${heroPart(o, h, "value", value)}${plot}</div>${part(h, "context", context)}`;
      return { inner, timeline: [revealParts(h, { value, context }), ...rows].join("\n") };
    },
    css: base("percent-waffle") + `
      .pro-percent-waffle { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-percent-waffle .vs-top { display:grid;grid-template-columns:440px 176px;gap:24px;align-items:center; }
      .pro-percent-waffle .vs-value { color:#C8A24B; }
      .pro-percent-waffle .vs-dots { width:176px;height:176px;fill:#0B0B0D;stroke:#A8A49C;stroke-width:1.5; }`,
  },
  "ranked-bar-rows": {
    variantOf: "bars",
    family: "proof",
    tags: ["ranking", "chart", "percent"],
    hint: "Greg names two to four comparable categories and gives one explicit percentage for each in speaking order",
    source: source("stacked-bars"),
    slots: {
      heading,
      items: spoken(656, { maxChars: 44, maxLines: 1, repeat: [2, 4], check: (text) => rankedRow(text) !== null }),
    },
    size: (o) => ({ w: 720, h: 108 + 72 * o.slots.items.length + (o.slots.heading.length ? 40 : 0) }),
    surface: "obsidian",
    render(o, h) {
      const items = o.slots.items;
      const values = items.map((item) => rankedRow(item.text));
      const high = Math.max(...values);
      const rows = items.map((item, i) => `<div class="vs-row">${part(h, `items-${i}`, item)}<div class="vs-track" aria-hidden="true"><div class="vs-fill-${i} vs-sweep${values[i] === high ? " vs-high" : ""}"></div></div></div>`).join("");
      const timeline = items.flatMap((item, i) => [write(h, `items-${i}`, item), sweep(h, `.vs-fill-${i}`, item.at, values[i] / 100)]).join("\n");
      return { inner: title(h, o.slots.heading[0]) + rows, timeline };
    },
    css: base("ranked-bar-rows") + `
      .pro-ranked-bar-rows { display:flex;flex-direction:column;justify-content:center;gap:8px; }
      .pro-ranked-bar-rows .vs-heading { color:#C8A24B; }
      .pro-ranked-bar-rows .vs-row { display:grid;gap:4px; }
      .pro-ranked-bar-rows .vs-track { height:12px;border-radius:3px;background:#343438; }
      .pro-ranked-bar-rows .vs-sweep { width:100%;height:100%;border-radius:3px;background:#A8A49C; }
      .pro-ranked-bar-rows .vs-high { background:#C8A24B; }`,
  },
  "filled-arc-gauge": {
    variantOf: "gauge",
    family: "proof",
    tags: ["percent", "chart"],
    hint: "Greg explicitly says one percentage and its context; sweep the arc to the exact spoken share",
    source: source("semi-gauge"),
    slots: percentSlots(),
    size: (o) => cardSize(152 + heroHeight(o) + bodyHeight(o, "context")),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context;
      const arc = '<svg class="vs-arc" viewBox="0 0 256 122" aria-hidden="true"><path class="vs-track" d="M16 116a112 106 0 0 1 224 0"/><path class="vs-line" pathLength="1" d="M16 116a112 106 0 0 1 224 0"/></svg>';
      const inner = `<div class="vs-dial">${arc}${heroPart(o, h, "value", value)}</div>${part(h, "context", context)}`;
      return { inner, timeline: [revealParts(h, { value, context }), stroke(h, ".vs-line", value.at, h.at(1 - percent(value.text) / 100))].join("\n") };
    },
    css: base("filled-arc-gauge") + `
      .pro-filled-arc-gauge { display:flex;flex-direction:column;justify-content:center;gap:10px;text-align:center; }
      .pro-filled-arc-gauge .vs-dial { display:grid;justify-items:center;gap:4px; }
      .pro-filled-arc-gauge .vs-arc { display:block;width:148px;height:71px;overflow:visible; }
      .pro-filled-arc-gauge .vs-track { fill:none;stroke:#343438;stroke-width:12; }
      .pro-filled-arc-gauge .vs-line { stroke-width:12; }
      .pro-filled-arc-gauge .vs-value { width:656px;color:#F5F1E8; }`,
  },
  "percent-wedge": {
    variantOf: "percent-ring",
    family: "proof",
    tags: ["number", "percent", "chart"],
    hint: "Greg states a percentage of a whole and names what it represents; show that share as a solid sector",
    source: source("pie-slice"),
    slots: percentSlots(440),
    size: (o) => cardSize(80 + Math.max(176, heroHeight(o)) + bodyHeight(o, "context")),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context, pct = percent(value.text);
      const angle = 2 * Math.PI * pct / 100;
      const wedge = pct === 100 ? '<circle class="vs-sector" cx="100" cy="100" r="92"/>' : pct === 0 ? "" :
        `<path class="vs-sector" d="M100 100V8A92 92 0 ${pct > 50 ? 1 : 0} 1 ${h.at(100 + 92 * Math.sin(angle))} ${h.at(100 - 92 * Math.cos(angle))}Z"/>`;
      const plot = `<svg class="vs-pie" viewBox="0 0 200 200" aria-hidden="true"><circle class="vs-track" cx="100" cy="100" r="92"/>${wedge}</svg>`;
      const inner = `<div class="vs-top">${plot}${heroPart(o, h, "value", value)}</div>${part(h, "context", context)}`;
      const expand = wedge ? tween(h, ".vs-sector", { scale: 0 }, { scale: 1 }, value.at) : "";
      return { inner, timeline: [revealParts(h, { value, context }), expand].join("\n") };
    },
    css: base("percent-wedge") + `
      .pro-percent-wedge { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-percent-wedge .vs-top { display:grid;grid-template-columns:176px 440px;gap:24px;align-items:center; }
      .pro-percent-wedge .vs-pie { width:176px;height:176px; }
      .pro-percent-wedge .vs-track { fill:#343438;stroke:#A8A49C;stroke-width:2; }
      .pro-percent-wedge .vs-sector { fill:#C8A24B;transform-box:view-box;transform-origin:50% 50%;transform:scale(0); }`,
  },
  "multiplier-discs": {
    family: "proof",
    tags: ["comparison", "number", "chart"],
    hint: "Greg explicitly states a multiplier, then names the group it applies to and the group it is compared with; name both groups in speaking order",
    source: source("circle-pack", "multiplier"),
    slots: { value: hero(656, (text) => multiplier(text) !== null), group: spoken(312, { maxChars: 26 }), baseline: spoken(312, { maxChars: 26 }) },
    size: (o) => cardSize(212 + heroHeight(o) + Math.max(bodyHeight(o, "group"), bodyHeight(o, "baseline"))),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [group] = o.slots.group, [baseline] = o.slots.baseline;
      // Area encodes the multiplier. Both discs share a baseline and use the same scale.
      const small = h.at(59 / Math.sqrt(multiplier(value.text)));
      const disc = (kind, radius) => `<svg class="vs-disc-${kind}" viewBox="0 0 132 124" aria-hidden="true"><circle cx="66" cy="${h.at(121 - radius)}" r="${radius}"/></svg>`;
      const inner = heroPart(o, h, "value", value) + `<div class="vs-groups"><div class="vs-column">${disc("group", 59)}${part(h, "group", group)}</div><div class="vs-column">${disc("baseline", small)}${part(h, "baseline", baseline)}</div></div>`;
      const timeline = [revealParts(h, { value, group, baseline }), ...[["group", group], ["baseline", baseline]].map(([name, item]) =>
        tween(h, `.vs-disc-${name}`, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1 }, item.at))].join("\n");
      return { inner, timeline };
    },
    css: base("multiplier-discs") + `
      .pro-multiplier-discs { display:flex;flex-direction:column;justify-content:center;gap:12px;text-align:center; }
      .pro-multiplier-discs .vs-value { color:#C8A24B; }
      .pro-multiplier-discs .vs-groups { display:grid;grid-template-columns:312px 312px;gap:32px; }
      .pro-multiplier-discs .vs-column { display:grid;justify-items:center;gap:8px;align-content:start; }
      .pro-multiplier-discs .vs-column svg { width:132px;height:124px;transform-origin:50% 100%;opacity:0; }
      .pro-multiplier-discs .vs-disc-group { fill:#C8A24B; }
      .pro-multiplier-discs .vs-disc-baseline { fill:#343438; }`,
  },
  "measured-stamp": {
    family: "proof",
    tags: ["number", "callout"],
    hint: "Greg explicitly says a result he measured, then states what he measured; use the measured stamp only for observed results",
    source: source("stamp", "postage"),
    slots: { value: hero(568), context: spoken(656) },
    size: (o) => cardSize(160 + heroHeight(o) + bodyHeight(o, "context")),
    surface: "bone",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context;
      const inner = `<div class="vs-stamp-wrap"><div class="vs-stamp"><div class="vs-heading">Measured</div>${heroPart(o, h, "value", value)}</div></div>${part(h, "context", context)}`;
      const land = tween(h, ".vs-stamp", { y: -16, opacity: 0 }, { y: 0, opacity: 1 }, value.at);
      return { inner, timeline: [land, revealParts(h, { value, context })].join("\n") };
    },
    css: base("measured-stamp") + `
      .pro-measured-stamp { display:flex;flex-direction:column;justify-content:center;gap:24px;text-align:center; }
      .pro-measured-stamp .vs-stamp-wrap { align-self:center;transform:rotate(-2deg); }
      .pro-measured-stamp .vs-stamp { width:600px;border:4px double #0B0B0D;padding:10px 12px;opacity:0; }
      .pro-measured-stamp .vs-heading { margin-bottom:6px;color:#343438; }
      .pro-measured-stamp .vs-value { background:#C8A24B; }`,
  },
  "price-tag-cost": {
    variantOf: "cost",
    family: "warning",
    tags: ["money", "number"],
    hint: "Greg says a monetary cost and the consequence; use a spoken dollar amount with its billing unit if given",
    source: source("price-tag"),
    slots: { heading, loss: hero(564, (text) => money(text) !== null), consequence: spoken(656) },
    size: (o) => cardSize(80 + Math.max(128, heroHeight(o, "loss") + 24) + bodyHeight(o, "consequence") + (o.slots.heading.length ? 44 : 0)),
    surface: "obsidian",
    render(o, h) {
      const [loss] = o.slots.loss, [consequence] = o.slots.consequence;
      const tag = '<svg class="vs-tag-face" viewBox="0 0 656 238" preserveAspectRatio="none" aria-hidden="true"><path d="M64 2H646Q654 2 654 10V228Q654 236 646 236H64L2 119Z"/><circle cx="45" cy="119" r="10"/></svg>';
      const inner = title(h, o.slots.heading[0]) + `<div class="vs-tag">${tag}${heroPart(o, h, "loss", loss)}</div>` + part(h, "consequence", consequence);
      const enter = tween(h, ".vs-tag", { x: 16, opacity: 0 }, { x: 0, opacity: 1 }, loss.at);
      return { inner, timeline: [enter, revealParts(h, { loss, consequence })].join("\n") };
    },
    css: base("price-tag-cost") + `
      .pro-price-tag-cost { display:flex;flex-direction:column;justify-content:center;gap:10px; }
      .pro-price-tag-cost .vs-heading { color:#C8A24B; }
      .pro-price-tag-cost .vs-tag { position:relative;min-height:128px;opacity:0;display:grid;align-items:center;padding:12px 12px 12px 80px; }
      .pro-price-tag-cost .vs-tag-face { position:absolute;inset:0;width:100%;height:100%; }
      .pro-price-tag-cost .vs-tag-face path { fill:#C8A24B; }
      .pro-price-tag-cost .vs-tag-face circle { fill:#0B0B0D; }
      .pro-price-tag-cost .vs-loss { position:relative;text-align:center;color:#0B0B0D; }`,
  },
  "turnaround-page": {
    family: "proof",
    tags: ["time", "number"],
    hint: "Greg states how long a task or result takes, with an exact duration and unit, then says what gets done in that time; use for measured turnaround",
    source: source("calendar"),
    slots: { value: hero(556, (text) => duration(text) !== null), context: spoken(656) },
    size: (o) => cardSize(158 + heroHeight(o) + bodyHeight(o, "context")),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context;
      const loops = '<svg class="vs-loops" viewBox="0 0 556 24" aria-hidden="true"><path d="M116 21V8h66v13M374 21V8h66v13"/></svg>';
      const inner = `<div class="vs-calendar">${loops}<div class="vs-page"><div class="vs-heading">Turnaround</div>${heroPart(o, h, "value", value)}</div></div>${part(h, "context", context)}`;
      const turn = tween(h, ".vs-page", { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)" }, value.at);
      return { inner, timeline: [turn, revealParts(h, { value, context })].join("\n") };
    },
    css: base("turnaround-page") + `
      .pro-turnaround-page { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center; }
      .pro-turnaround-page .vs-calendar { width:580px; }
      .pro-turnaround-page .vs-loops { display:block;width:100%;height:24px;fill:none;stroke:#C8A24B;stroke-width:4; }
      .pro-turnaround-page .vs-page { background:#F5F1E8;color:#0B0B0D;padding:0 12px 8px;clip-path:inset(0 0 100% 0); }
      .pro-turnaround-page .vs-heading { margin:0 -12px 4px;padding:4px;background:#C8A24B; }`,
  },
  "qualified-stat": {
    family: "proof",
    tags: ["number", "callout"],
    hint: "Greg states a measured value and what it describes, then explicitly gives a caveat that limits the claim; quote the caveat itself",
    source: source("footnote"),
    slots: { value: hero(656), context: spoken(656), caveat: spoken(610) },
    size: (o) => cardSize(102 + heroHeight(o) + bodyHeight(o, "context") + bodyHeight(o, "caveat")),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context, [caveat] = o.slots.caveat;
      const leader = '<svg class="vs-caveat-leader" viewBox="0 0 32 40" aria-hidden="true"><path class="vs-line" pathLength="1" d="M3 2v30h24"/></svg>';
      const inner = heroPart(o, h, "value", value) + part(h, "context", context) +
        `<div class="vs-detail">${leader}${part(h, "caveat", caveat)}</div>`;
      return { inner, timeline: [revealParts(h, { value, context, caveat }), stroke(h, ".vs-line", caveat.at)].join("\n") };
    },
    css: base("qualified-stat") + `
      .pro-qualified-stat { display:flex;flex-direction:column;justify-content:center;gap:10px; }
      .pro-qualified-stat .vs-value { color:#C8A24B; }
      .pro-qualified-stat .vs-detail { display:grid;grid-template-columns:32px 1fr;gap:12px;padding-top:12px;border-top:2px solid #343438; }
      .pro-qualified-stat .vs-caveat-leader { width:32px;height:40px; }
      .pro-qualified-stat .vs-caveat { color:#A8A49C; }`,
  },
  "stat-window": {
    variantOf: "stat-disc",
    family: "proof",
    tags: ["number", "callout"],
    hint: "Greg states one exact value and then explains what it measures; use for a standalone quantified result",
    source: source("window", "bracket", "torn"),
    slots: { value: hero(540), context: spoken(656) },
    size: (o) => cardSize(80 + Math.max(112, heroHeight(o)) + bodyHeight(o, "context")),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context;
      const inner = `<div class="vs-window"><div class="vs-rail-left" aria-hidden="true"></div>${heroPart(o, h, "value", value)}<div class="vs-rail-right" aria-hidden="true"></div></div>${part(h, "context", context)}`;
      const close = (side, x) => tween(h, `.vs-rail-${side}`, { x, opacity: 0 }, { x: 0, opacity: 1 }, value.at);
      const slide = write(h, "value", value, { y: 16, clipPath: "inset(100% 0 0 0)" }, { y: 0 });
      return { inner, timeline: [close("left", -16), close("right", 16), slide, write(h, "context", context)].join("\n") };
    },
    css: base("stat-window") + `
      .pro-stat-window { display:flex;flex-direction:column;justify-content:center;gap:14px;text-align:center; }
      .pro-stat-window .vs-window { display:grid;grid-template-columns:18px 540px 18px;justify-content:center;gap:8px;min-height:112px; }
      .pro-stat-window .vs-value { color:#C8A24B; }
      .pro-stat-window .vs-rail-left,.pro-stat-window .vs-rail-right { border:4px solid #A8A49C;opacity:0; }
      .pro-stat-window .vs-rail-left { border-right:0; }
      .pro-stat-window .vs-rail-right { border-left:0; }`,
  },
  "metric-delta-chip": {
    variantOf: "case-study",
    family: "proof",
    tags: ["before-after", "percent", "number"],
    hint: "Greg gives a real client’s before rate, different after rate and spoken label for the same metric",
    source: source("trend-delta"),
    slots: {
      before: spoken(616, { check: isPercent, maxChars: 28 }),
      after: hero(532, (text, slots) => isPercent(text) && percent(text) !== percent(slots.before[0].text)),
      label: spoken(656),
    },
    size: (o) => cardSize(100 + bodyHeight(o, "before") + heroHeight(o, "after") + bodyHeight(o, "label")),
    surface: "obsidian",
    render(o, h) {
      const [before] = o.slots.before, [after] = o.slots.after, [label] = o.slots.label;
      const up = percent(after.text) > percent(before.text);
      const arrow = `<svg class="vs-direction" viewBox="0 0 56 56" aria-hidden="true"><path class="vs-line" pathLength="1" d="${up ? "M12 35 28 19l16 16" : "M12 21 28 37l16-16"}"/></svg>`;
      const inner = `<div class="vs-baseline">${part(h, "before", before)}</div><div class="vs-current">${arrow}${heroPart(o, h, "after", after)}</div>${part(h, "label", label)}`;
      return { inner, timeline: [revealParts(h, { before, after, label }), stroke(h, ".vs-line", after.at)].join("\n") };
    },
    css: base("metric-delta-chip") + `
      .pro-metric-delta-chip { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-metric-delta-chip .vs-baseline { width:100%;padding:4px 16px;border-left:4px solid #343438;color:#A8A49C; }
      .pro-metric-delta-chip .vs-current { display:grid;grid-template-columns:72px 1fr;gap:12px;align-items:center; }
      .pro-metric-delta-chip .vs-direction { width:56px;height:56px;border:2px solid #343438;border-radius:8px; }
      .pro-metric-delta-chip .vs-line { stroke-linecap:round;stroke-linejoin:round; }
      .pro-metric-delta-chip .vs-after { color:#C8A24B; }`,
  },
  "rating-cell-strip": {
    variantOf: "rating",
    family: "proof",
    tags: ["rating", "chart"],
    hint: "Greg gives an exact score and its explicit whole scale up to ten in the same spoken range",
    source: source("heat-strip"),
    slots: { heading, score: hero(656, (text) => ratioScore(text) !== null) },
    size: (o) => cardSize(132 + heroHeight(o, "score") + (o.slots.heading.length ? 42 : 0)),
    surface: "obsidian",
    render(o, h) {
      const [score] = o.slots.score, { value, total } = ratioScore(score.text), cellWidth = 656 / total;
      const cells = Array.from({ length: total }, (_, i) => `<rect class="vs-cell" x="${h.at(i * cellWidth + 2)}" y="12" width="${h.at(cellWidth - 8)}" height="34" rx="3"/>`).join("");
      const markX = h.at(value ? (value - 0.5) * cellWidth : 4);
      const marker = `<path class="vs-marker vs-line" pathLength="1" d="M${markX} 2v51"/>`;
      const strip = `<svg class="vs-scale" viewBox="0 0 656 56" aria-hidden="true">${cells}${marker}</svg>`;
      const wipe = tween(h, ".vs-scale", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }, score.at);
      const highlight = value ? tween(h, `.vs-cell:nth-child(${value})`, { fill: "#343438" }, { fill: "#C8A24B" }, score.at) : "";
      return { inner: title(h, o.slots.heading[0]) + heroPart(o, h, "score", score) + strip,
        timeline: [write(h, "score", score), wipe, highlight, stroke(h, ".vs-marker", score.at)].join("\n") };
    },
    css: base("rating-cell-strip") + `
      .pro-rating-cell-strip { display:flex;flex-direction:column;justify-content:center;gap:8px; }
      .pro-rating-cell-strip .vs-heading,.pro-rating-cell-strip .vs-score { color:#C8A24B; }
      .pro-rating-cell-strip .vs-scale { width:656px;height:56px;clip-path:inset(0 100% 0 0); }
      .pro-rating-cell-strip .vs-cell { fill:#343438; }
      .pro-rating-cell-strip .vs-marker { stroke:#F5F1E8;stroke-width:3; }`,
  },
  "ratio-step-blocks": ratioMarks("ratio-step-blocks", false),
  "ratio-people-icons": ratioMarks("ratio-people-icons", true),
  "rank-ribbon": {
    family: "proof",
    tags: ["ranking", "number"],
    hint: "Greg states an explicit ordinal placement such as first or number one, then names the competition or ranking; quote the placement exactly",
    source: source("rank-banner"),
    slots: { value: hero(656, rank), context: spoken(604) },
    size: (o) => cardSize(76 + heroHeight(o) + 112),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context;
      const banner = '<svg class="vs-ribbon vs-sweep" viewBox="0 0 656 112" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0h656l-22 56 22 56H0l22-56Z"/></svg>';
      const inner = heroPart(o, h, "value", value) + `<div class="vs-banner">${banner}${part(h, "context", context)}</div>`;
      return { inner, timeline: [revealParts(h, { value, context }), sweep(h, ".vs-ribbon", context.at)].join("\n") };
    },
    css: base("rank-ribbon") + `
      .pro-rank-ribbon { display:flex;flex-direction:column;justify-content:center;gap:8px;text-align:center; }
      .pro-rank-ribbon .vs-value { color:#C8A24B; }
      .pro-rank-ribbon .vs-banner { position:relative;display:grid;place-items:center;min-height:112px;padding:8px 24px; }
      .pro-rank-ribbon .vs-ribbon { position:absolute;inset:0;width:100%;height:100%;transform-origin:center;fill:#C8A24B; }
      .pro-rank-ribbon .vs-context { position:relative;color:#0B0B0D; }`,
  },
  "metric-faceoff": {
    variantOf: "case-study",
    family: "proof",
    tags: ["comparison", "before-after", "time"],
    hint: "Greg gives a real client’s before and after durations for the same task and says what was timed",
    source: source("versus"),
    slots: {
      before: hero(500, (text) => duration(text) !== null),
      after: hero(500, (text) => duration(text) !== null),
      label: spoken(656, { maxLines: 1 }),
    },
    size: (o) => cardSize(96 + heroHeight(o, "before") + heroHeight(o, "after") + bodyHeight(o, "label")),
    surface: "obsidian",
    render(o, h) {
      const [before] = o.slots.before, [after] = o.slots.after, [label] = o.slots.label;
      const row = (name, item, heading) =>
        `<div class="vs-row vs-row-${name}"><div class="vs-heading">${heading}</div>${heroPart(o, h, name, item)}</div>`;
      const inner = row("before", before, "Before") + row("after", after, "After") + part(h, "label", label);
      const panel = (name, item, x) => tween(h, `.vs-row-${name}`, { x, opacity: 0 }, { x: 0, opacity: 1 }, item.at, false);
      const timeline = [panel("before", before, -16), panel("after", after, 16), revealParts(h, { before, after, label })].join("\n");
      return { inner, timeline };
    },
    css: base("metric-faceoff") + `
      .pro-metric-faceoff { display:flex;flex-direction:column;justify-content:center;gap:8px; }
      .pro-metric-faceoff .vs-row { display:grid;grid-template-columns:108px 500px;gap:12px;align-items:center;padding:4px 16px;opacity:0; }
      .pro-metric-faceoff .vs-row-before { background:#343438; }
      .pro-metric-faceoff .vs-row-after { background:#C8A24B;color:#0B0B0D; }
      .pro-metric-faceoff .vs-heading { text-align:center; }`,
  },
  "relative-time-pin": {
    family: "proof",
    tags: ["timeline", "time", "number"],
    hint: "Greg explicitly states a relative start, a later end, and a point within that span, all in the same day, week or month unit, then names what happens at that point",
    source: source("timeline-point"),
    slots: {
      start: spoken(312, { maxChars: 26, check: (text) => relativeTime(text) !== null }),
      end: spoken(312, { maxChars: 26, check: (text, slots) => {
        const a = relativeTime(slots.start[0].text), b = relativeTime(text);
        return b?.unit === a.unit && b.value > a.value;
      } }),
      point: hero(656, (text, slots) => {
        const a = relativeTime(slots.start[0].text), b = relativeTime(slots.end[0].text), p = relativeTime(text);
        return p?.unit === a.unit && a.value <= p.value && p.value <= b.value;
      }),
      context: spoken(656),
    },
    size: (o) => cardSize(128 + heroHeight(o, "point") + Math.max(bodyHeight(o, "start"), bodyHeight(o, "end")) + bodyHeight(o, "context")),
    surface: "obsidian",
    render(o, h) {
      const [start] = o.slots.start, [end] = o.slots.end, [point] = o.slots.point, [context] = o.slots.context;
      const a = relativeTime(start.text).value, b = relativeTime(end.text).value, p = relativeTime(point.text).value;
      const x = h.at(10 + 636 * (p - a) / (b - a));
      const axis = `<svg class="vs-axis" viewBox="0 0 656 34" aria-hidden="true"><path class="vs-track vs-sweep" d="M10 11v14m0-7h636m0-7v14"/><circle class="vs-pin" cx="${x}" cy="18" r="8"/></svg>`;
      const inner = heroPart(o, h, "point", point) + axis + `<div class="vs-endpoints">${part(h, "start", start)}${part(h, "end", end)}</div>` + part(h, "context", context);
      const pin = tween(h, ".vs-pin", { opacity: 0, y: -12 }, { opacity: 1, y: 0 }, point.at);
      return { inner, timeline: [revealParts(h, { start, end, point, context }), sweep(h, ".vs-track", end.at), pin].join("\n") };
    },
    css: base("relative-time-pin") + `
      .pro-relative-time-pin { display:flex;flex-direction:column;justify-content:center;gap:8px; }
      .pro-relative-time-pin .vs-point { color:#C8A24B; }
      .pro-relative-time-pin .vs-axis { width:656px;height:34px;overflow:visible; }
      .pro-relative-time-pin .vs-track { fill:none;stroke:#A8A49C;stroke-width:3; }
      .pro-relative-time-pin .vs-pin { fill:#C8A24B;stroke:#0B0B0D;stroke-width:2;opacity:0; }
      .pro-relative-time-pin .vs-endpoints { display:grid;grid-template-columns:312px 312px;gap:32px;color:#A8A49C; }
      .pro-relative-time-pin .vs-end { text-align:right; }`,
  },
  "stat-leaders": {
    family: "proof",
    tags: ["number", "definition"],
    hint: "Greg states one measure then separately defines two or three specific parts of that measure; use his exact short explanations in speaking order",
    source: source("annotated"),
    slots: { value: hero(656), notes: spoken(568, { repeat: [2, 3], maxChars: 38, maxLines: 1 }) },
    size: (o) => cardSize(80 + heroHeight(o) + 48 * o.slots.notes.length),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, notes = o.slots.notes;
      const rows = notes.map((note, i) => `<div class="vs-note"><svg viewBox="0 0 64 48" aria-hidden="true"><path class="vs-line vs-leader-${i}" pathLength="1" d="M3 0v24h56"/></svg>${part(h, `notes-${i}`, note)}</div>`).join("");
      const inner = heroPart(o, h, "value", value) + `<div class="vs-notes">${rows}</div>`;
      const timeline = [write(h, "value", value), ...notes.flatMap((note, i) =>
        [write(h, `notes-${i}`, note), stroke(h, `.vs-leader-${i}`, note.at)])].join("\n");
      return { inner, timeline };
    },
    css: base("stat-leaders") + `
      .pro-stat-leaders { display:flex;flex-direction:column;justify-content:center;gap:10px; }
      .pro-stat-leaders .vs-value { color:#C8A24B; }
      .pro-stat-leaders .vs-notes { border-left:2px solid #343438; }
      .pro-stat-leaders .vs-note { display:grid;grid-template-columns:64px 1fr;gap:16px;align-items:center; }
      .pro-stat-leaders .vs-note svg { width:64px;height:48px; }`,
  },
};
