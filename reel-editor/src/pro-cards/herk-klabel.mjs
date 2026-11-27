// Restyled from the Herk Edit Kit (MIT). See src/pro-cards/HERK-LICENSE.md.
import { CARDS as proof } from "./proof-2.mjs";
import { CARDS as payoff } from "./warning-emphasis-full.mjs";

const source = (...ids) => `herk:${ids.map((id) => `kallaway.t2.label.${id}`).join(",")}`;

// Match the shared fitter's width estimates without importing the module that loads this registry.
function estimatedWidth(text, size) {
  return [...text].reduce((total, glyph) => total +
    (/\s/.test(glyph) ? 0.3 : /[ilI.,!'’]/.test(glyph) ? 0.32 : /[MW@]/.test(glyph) ? 0.95 : /[A-Z]/.test(glyph) ? 0.75 : 0.65) * size, 0);
}

function fits(text, width, size, maxLines, lineFits) {
  const lines = [];
  for (const word of text.trim().split(/\s+/)) {
    const run = estimatedWidth(word, size);
    if (run > width) return false;
    const last = lines.at(-1);
    if (last && estimatedWidth(`${last} ${word}`, size) <= width) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines.length <= maxLines && lines.every(lineFits);
}

// Reject runs that would force the shared fitter below the size promised by this design.
function spoken(maxChars, width, size, maxLines = 2, check = () => true, lineFits = () => true) {
  return {
    kind: "spoken", maxChars, width, size, maxLines,
    validate: (text, slots) => !/\p{Extended_Pictographic}/u.test(text) && check(text, slots) &&
      fits(text, width, size, maxLines, lineFits),
  };
}

// The shared estimate assumes Inter. Numeric runs use a larger estimate budget and are
// checked against Anton's advances as well, including its unusually wide percent glyph.
function figure(maxChars, width, maxLines, check) {
  const withinAnton = (line) => {
    const em = [...line].reduce((total, glyph) => total +
      (glyph === "%" ? 1.07 : /[mwMW–—]/.test(glyph) ? 0.81 : /[ilI., ]/.test(glyph) ? 0.27 : /[fjt!]/.test(glyph) ? 0.33 :
        /[+×-]/.test(glyph) ? 0.37 : /[rsyz]/.test(glyph) ? 0.49 : 0.53), 0);
    return em * 96 <= width;
  };
  return spoken(maxChars, Math.round(width * 1.32), 96, maxLines, check, withinAnton);
}

function write(h, selector, at, closed = "inset(0 100% 0 0)") {
  return `tl.fromTo(${h.sel(selector)},{opacity:0,clipPath:${h.js(closed)}},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

function state(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${at});`;
}

const draw = (h, selector, at) => state(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at);
const copy = (h, name, item, extra = "") => `<div class="kl-${name} kl-copy${extra ? ` kl-${extra}` : ""}">${h.copy(item)}</div>`;
const label = (text) => `<div class="kl-label">${text}</div>`;
const svg = (name, viewBox, paths) => `<svg class="kl-${name}" viewBox="${viewBox}" aria-hidden="true">${paths}</svg>`;

function base(type) {
  return `
    .pro-${type} .kl-copy { opacity:0;clip-path:inset(0 100% 0 0); }
    .pro-${type} .kl-term { font:800 48px/56px "Inter",sans-serif; }
    .pro-${type} .kl-detail { font:500 40px/48px "Inter",sans-serif; }
    .pro-${type} .kl-label { color:#C8A24B;font:700 28px/34px "Inter",sans-serif;text-transform:uppercase; }
    .pro-${type} .kl-value { color:#C8A24B;font:400 96px/108px "Anton",sans-serif; }
    .pro-${type} .kl-ink { fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;stroke-linejoin:round; }
    .pro-${type} .kl-draw { stroke-dasharray:1;stroke-dashoffset:1; }`;
}

const twoSlots = (width, termLines = 1) => ({
  term: spoken(40, width, 48, termLines),
  detail: spoken(78, width, 40, 2),
});

function twoLines(o, h, term = "term", detail = "detail") {
  return [
    write(h, ".kl-term", o.slots[term][0].at),
    write(h, ".kl-detail", o.slots[detail][0].at),
  ].join("\n");
}

const definition = {
  family: "emphasis",
  hint: "Greg names a specific sales term and immediately defines what it means in his own words; use the term followed by the spoken definition",
  tags: ["definition", "callout"],
  surface: "obsidian",
};

const units = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const exactPercent = proof.gauge.slots.value.validate;

// The proof validator bounds the input to a single exact percent from zero to one hundred.
function percent(text) {
  if (!exactPercent(text)) return null;
  const number = text.toLowerCase().replace(/[.!?]$/, "").replace(/\s*(?:%|percent|per cent)$/, "").trim();
  if (/^\d/.test(number)) return Number(number.replaceAll(",", ""));
  if (number === "one hundred") return 100;
  const [first, last] = number.split(/[\s-]+/);
  const single = units.indexOf(first);
  return single >= 0 ? single : 10 * tens.indexOf(first) + (last ? units.indexOf(last) : 0);
}

const numeric = proof["kpi-tile"].slots.value.validate;
const moneyPrefix = /^[$£€]/;
const moneySuffix = /\b(dollar|euro|pound)s?[.!?]?$/i;
const currencies = { "$": "dollar", "£": "pound", "€": "euro" };

function currency(text) {
  const leading = text.match(moneyPrefix)?.[0];
  const trailing = text.match(moneySuffix)?.[1]?.toLowerCase();
  const unit = currencies[leading] ?? trailing;
  if (!unit || (leading && trailing && unit !== trailing)) return null;
  const normalized = text.replace(/^[£€]/, "$").replace(/\b(?:euros?|pounds?)(?=[.!?]?$)/i, "dollars");
  return proof["money-stack"].slots.value.validate(normalized) ? unit : null;
}

function benchmark(text) {
  const multiplier = text.match(/^(.+?)(?:\s*[x×]|\s+times)[.!?]?$/i);
  if (multiplier) return benchmark(multiplier[1]) === "number" ? "multiple" : null;
  if (moneyPrefix.test(text) || moneySuffix.test(text)) return currency(text);
  if (/%|\bpercent\b|\bper cent\b/i.test(text)) return exactPercent(text) ? "percent" : null;
  return numeric(text) ? "number" : null;
}

const timeUnit = /\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)[.!?]?$/i;
function duration(text) {
  if (!timeUnit.test(text)) return false;
  const limits = text.replace(timeUnit, "").split(/\s+(?:to|through)\s+|(?<=\d)[–-](?=\d)/i);
  if (limits.length > 2) return false;
  return limits.every((part) => benchmark(part.replace(timeUnit, "")) === "number");
}

function change(text) {
  const match = text.match(/^(?:[+−-]\s*|(?:up|down)\s+)(.+?)\s*(?:%|percent|per cent)[.!?]?$/i);
  return !!match && benchmark(match[1]) === "number";
}

// Long spoken numbers can wrap; the one-line versions fit more shots.
const valueHeight = (overlay, slot, maxLines = 2) => 108 * (overlay.slots?.[slot]?.[0]?.lines?.length ?? maxLines);
const ribbonHeadings = /^(?:Takeaway|Key insight|Say it like this)$/i;

export const CARDS = {
  "term-definition": {
    ...definition,
    source: source("definition", "badge", "category", "iconchip", "info", "infocard", "keyword"),
    slots: twoSlots(648, 2),
    size: { w: 704, h: 300 },
    render(o, h) {
      const inner = label("Definition") + copy(h, "term", o.slots.term[0]) + '<div class="kl-rule"></div>' +
        copy(h, "detail", o.slots.detail[0]);
      return {
        inner,
        timeline: twoLines(o, h) + "\n" + state(h, ".kl-rule", { scaleX: 0 }, { scaleX: 1 }, o.slots.detail[0].at),
      };
    },
    css: base("term-definition") + `
      .pro-term-definition { display:flex;flex-direction:column;justify-content:center;gap:6px;padding:18px 28px;background:#0B0B0D; }
      .pro-term-definition .kl-rule { height:3px;background:#C8A24B;transform:scaleX(0);transform-origin:left; }`,
  },
  "definition-brace": {
    ...definition,
    variantOf: "term-definition",
    source: source("brace"),
    slots: twoSlots(556, 2),
    size: { w: 680, h: 264 },
    render(o, h) {
      // The two halves meet in the middle and draw outward to group the title and its explanation.
      const brace = svg("brace kl-ink", "0 0 44 192",
        '<path class="kl-draw" pathLength="1" d="M6 96c13 0 17-12 17-25V23C23 10 29 4 39 4"/>' +
        '<path class="kl-draw" pathLength="1" d="M6 96c13 0 17 12 17 25v48c0 13 6 19 16 19"/>');
      return {
        inner: brace + `<div class="kl-body">${copy(h, "term", o.slots.term[0])}${copy(h, "detail", o.slots.detail[0])}</div>`,
        timeline: twoLines(o, h) + "\n" + draw(h, ".kl-brace path", o.start),
      };
    },
    css: base("definition-brace") + `
      .pro-definition-brace { display:grid;grid-template-columns:44px 1fr;align-items:center;gap:24px;padding:20px 28px;background:#0B0B0D; }
      .pro-definition-brace .kl-brace { width:44px;height:192px; }
      .pro-definition-brace .kl-body { display:grid;gap:12px; }`,
  },
  "definition-leader": {
    ...definition,
    variantOf: "term-definition",
    source: source("leader", "crosshair", "dashed", "flag", "node", "pointer", "pulse", "ringmark"),
    slots: twoSlots(504, 2),
    size: { w: 680, h: 276 },
    surface: "bare",
    render(o, h) {
      // The marker and leader live inside the placement rect, including the swept bounds.
      const leader = svg("leader kl-ink", "0 0 104 120",
        '<circle class="kl-anchor kl-copy" cx="16" cy="24" r="10"/>' +
        '<path class="kl-draw" pathLength="1" d="M29 24c36 0 36 72 75 72"/>');
      return {
        inner: leader + `<div class="kl-body">${copy(h, "term", o.slots.term[0])}${copy(h, "detail", o.slots.detail[0])}</div>`,
        timeline: [write(h, ".kl-anchor", o.start), draw(h, ".kl-leader path", o.start), twoLines(o, h)].join("\n"),
      };
    },
    css: base("definition-leader") + `
      .pro-definition-leader { display:grid;grid-template-columns:104px 1fr;align-items:center; }
      .pro-definition-leader .kl-leader { width:104px;height:120px; }
      .pro-definition-leader .kl-body { display:grid;align-content:center;gap:10px;min-height:240px;padding:18px 28px;background:#0B0B0D;border-radius:16px; }`,
  },
  "definition-tooltip": {
    ...definition,
    variantOf: "term-definition",
    source: source("tooltip", "bubble"),
    slots: twoSlots(572, 2),
    size: { w: 664, h: 260 },
    surface: "bare",
    render(o, h) {
      const tail = svg("tail", "0 0 32 36", '<path d="M32 0v36L0 18Z"/>');
      return {
        inner: tail + `<div class="kl-bubble">${copy(h, "term", o.slots.term[0])}${copy(h, "detail", o.slots.detail[0])}</div>`,
        timeline: `tl.fromTo(${h.sel(".kl-bubble")},{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${o.start});\n` +
          write(h, ".kl-tail", o.start) + "\n" + twoLines(o, h),
      };
    },
    css: base("definition-tooltip") + `
      .pro-definition-tooltip { display:grid;grid-template-columns:32px 1fr;align-items:center; }
      .pro-definition-tooltip .kl-tail { width:32px;height:36px;fill:#0B0B0D;opacity:0; }
      .pro-definition-tooltip .kl-bubble { display:grid;align-content:center;gap:10px;height:100%;padding:20px 30px;background:#0B0B0D;border-radius:16px;clip-path:inset(0 100% 0 0); }`,
  },
  "definition-tab": {
    ...definition,
    variantOf: "term-definition",
    source: source("tag", "hash"),
    slots: twoSlots(560),
    size: { w: 640, h: 214 },
    surface: "bare",
    render(o, h) {
      return {
        inner: `<div class="kl-tab">${copy(h, "term", o.slots.term[0])}</div><div class="kl-strip">${copy(h, "detail", o.slots.detail[0])}</div>`,
        timeline: [state(h, ".kl-tab", { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)" }, o.start), twoLines(o, h)].join("\n"),
      };
    },
    css: base("definition-tab") + `
      .pro-definition-tab { display:flex;flex-direction:column;align-items:flex-start;justify-content:center; }
      .pro-definition-tab .kl-tab { margin-left:20px;padding:8px 20px;background:#C8A24B;color:#0B0B0D;border-radius:12px 12px 0 0;clip-path:inset(100% 0 0 0); }
      .pro-definition-tab .kl-strip { display:grid;align-items:center;width:100%;min-height:128px;padding:16px 26px;background:#0B0B0D;border-radius:12px; }`,
  },
  "definition-underline": {
    ...definition,
    variantOf: "term-definition",
    source: source("underline", "bracket", "eyebrow", "highlightbox", "note"),
    slots: twoSlots(604),
    size: { w: 672, h: 224 },
    render(o, h) {
      return {
        inner: `<div class="kl-title">${copy(h, "term", o.slots.term[0])}<div class="kl-underline"></div></div>` +
          copy(h, "detail", o.slots.detail[0]),
        timeline: twoLines(o, h) + "\n" + state(h, ".kl-underline", { scaleX: 0 }, { scaleX: 1 }, o.start),
      };
    },
    css: base("definition-underline") + `
      .pro-definition-underline { display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:16px;padding:20px 34px;background:#0B0B0D; }
      .pro-definition-underline .kl-title { display:inline-grid;gap:5px; }
      .pro-definition-underline .kl-underline { height:5px;background:#C8A24B;transform:scaleX(0);transform-origin:left; }`,
  },
  "reason-callout": {
    family: "payoff",
    hint: "Greg states a specific sales principle then explains why it affects the outcome; use his claim and the exact reason he gives",
    tags: ["callout", "rule"],
    source: source("callout", "fact"),
    slots: twoSlots(640, 2),
    size: { w: 704, h: 328 },
    surface: "bone",
    render(o, h) {
      const inner = copy(h, "term", o.slots.term[0]) +
        `<div class="kl-reason">${label("Why it matters")}${copy(h, "detail", o.slots.detail[0])}</div>`;
      return {
        inner,
        timeline: twoLines(o, h) + "\n" + write(h, ".kl-reason .kl-label", o.slots.detail[0].at),
      };
    },
    css: base("reason-callout") + `
      .pro-reason-callout { display:flex;flex-direction:column;justify-content:center;gap:12px;padding:24px 32px; }
      .pro-reason-callout .kl-reason { display:grid;gap:8px;padding-top:10px;border-top:2px solid #343438; }
      .pro-reason-callout .kl-label { color:#343438;opacity:0; }`,
  },
  "result-check": {
    family: "proof",
    hint: "Greg names a specific favorable result already achieved and then says what confirms it; use the outcome and its spoken evidence",
    tags: ["callout"],
    source: source("checkmark"),
    slots: twoSlots(544, 2),
    size: { w: 680, h: 264 },
    surface: "obsidian",
    render(o, h) {
      const check = svg("check kl-ink", "0 0 56 56", '<path class="kl-draw" pathLength="1" d="m8 29 13 13L48 14"/>');
      const inner = check + `<div class="kl-body">${copy(h, "term", o.slots.term[0])}${copy(h, "detail", o.slots.detail[0])}</div>`;
      return { inner, timeline: twoLines(o, h) + "\n" + draw(h, ".kl-check path", o.slots.detail[0].at) };
    },
    css: base("result-check") + `
      .pro-result-check { display:grid;grid-template-columns:56px 1fr;align-items:center;gap:20px;padding:20px 30px;background:#0B0B0D; }
      .pro-result-check .kl-check { align-self:start;width:56px;height:56px;margin-top:3px; }
      .pro-result-check .kl-ink { stroke-width:6; }
      .pro-result-check .kl-body { display:grid;gap:12px; }
      .pro-result-check .kl-detail { color:#A8A49C; }`,
  },
  "risk-explainer": {
    family: "warning",
    hint: "Greg names a specific mistake or risk then explains the harm it causes; include both the warning sign and the spoken consequence",
    tags: ["warning", "callout"],
    source: source("warning"),
    slots: twoSlots(624, 2),
    size: { w: 688, h: 316 },
    surface: "obsidian",
    render(o, h) {
      const icon = svg("triangle kl-ink", "0 0 40 40",
        '<path class="kl-draw" pathLength="1" d="M20 4 37 35H3ZM20 15v8m0 5v1"/>');
      const inner = `<div class="kl-header">${icon}${label("Warning")}</div>` +
        copy(h, "term", o.slots.term[0]) + copy(h, "detail", o.slots.detail[0]);
      return { inner, timeline: twoLines(o, h) + "\n" + draw(h, ".kl-triangle path", o.start) };
    },
    css: base("risk-explainer") + `
      .pro-risk-explainer { display:grid;align-content:center;gap:8px;padding:18px 28px;border-left:4px solid #C8A24B;background:#0B0B0D; }
      .pro-risk-explainer .kl-header { display:flex;align-items:center;gap:12px; }
      .pro-risk-explainer .kl-triangle { width:40px;height:40px; }
      .pro-risk-explainer .kl-detail { padding-top:8px;border-top:2px solid #343438; }`,
  },
  "shortcut-key": {
    family: "procedure",
    hint: "Greg says a specific keyboard key or short chord followed by what it does; use his exact key names and spoken effect",
    tags: ["steps", "callout"],
    source: source("keycap"),
    slots: { keys: spoken(24, 536, 48, 1), effect: spoken(68, 608, 40) },
    size: { w: 664, h: 236 },
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="kl-key">${copy(h, "term", o.slots.keys[0])}</div>` + copy(h, "detail", o.slots.effect[0]);
      return {
        inner,
        timeline: [
          twoLines(o, h, "keys", "effect"),
          state(h, ".kl-key", { backgroundColor: "#343438", color: "#F5F1E8", boxShadow: "0 8px 0 #343438" },
            { backgroundColor: "#C8A24B", color: "#0B0B0D", boxShadow: "0 2px 0 #343438" }, o.slots.effect[0].at),
        ].join("\n"),
      };
    },
    css: base("shortcut-key") + `
      .pro-shortcut-key { display:flex;flex-direction:column;justify-content:center;align-items:center;gap:24px;padding:18px 28px;background:#0B0B0D; }
      .pro-shortcut-key .kl-key { padding:8px 22px;background:#343438;color:#F5F1E8;border:2px solid #A8A49C;border-radius:12px;box-shadow:0 8px 0 #343438; }
      .pro-shortcut-key .kl-detail { text-align:center; }`,
  },
  "search-explainer": {
    family: "conversation",
    hint: "Greg says the exact phrase a rep would search for and then explicitly explains what to look for in the results",
    tags: ["question", "callout"],
    source: source("search"),
    slots: { query: spoken(30, 510, 48, 2), context: spoken(70, 632, 40) },
    size: { w: 688, h: 288 },
    surface: "obsidian",
    render(o, h) {
      const search = svg("search kl-ink", "0 0 48 48", '<circle cx="20" cy="20" r="12"/><path d="m29 29 12 12"/>');
      const inner = `<div class="kl-field">${search}${copy(h, "term", o.slots.query[0])}<div class="kl-caret"></div></div>` +
        copy(h, "detail", o.slots.context[0]);
      return {
        inner,
        timeline: twoLines(o, h, "query", "context") + "\n" +
          state(h, ".kl-caret", { opacity: 1 }, { opacity: 0 }, o.slots.context[0].at),
      };
    },
    css: base("search-explainer") + `
      .pro-search-explainer { display:grid;align-content:center;gap:16px;padding:20px 28px;background:#0B0B0D; }
      .pro-search-explainer .kl-field { display:flex;align-items:center;gap:14px;padding:10px 18px;border:2px solid #343438;border-radius:42px; }
      .pro-search-explainer .kl-search { width:44px;height:44px;flex:none; }
      .pro-search-explainer .kl-caret { width:4px;height:40px;background:#C8A24B;flex:none; }`,
  },
  "quote-explained": {
    family: "payoff",
    hint: "Greg delivers a short quotable teaching line and immediately explains what it means; use his line and his explanation without attribution",
    tags: ["quote", "callout"],
    source: source("qmark"),
    slots: { quote: spoken(50, 520, 48), explanation: spoken(70, 520, 40) },
    size: { w: 656, h: 272 },
    surface: "obsidian",
    render(o, h) {
      const mark = svg("mark", "0 0 54 44", '<path d="M22 5C12 5 4 16 4 29v10h18V22H12c2-5 5-8 10-9ZM49 5c-10 0-18 11-18 24v10h18V22H39c2-5 5-8 10-9Z"/>');
      const inner = mark + `<div class="kl-body">${copy(h, "term", o.slots.quote[0])}${copy(h, "detail", o.slots.explanation[0])}</div>`;
      return { inner, timeline: twoLines(o, h, "quote", "explanation") };
    },
    css: base("quote-explained") + `
      .pro-quote-explained { display:grid;grid-template-columns:50px 1fr;align-items:center;gap:18px;padding:22px 34px;background:#0B0B0D; }
      .pro-quote-explained .kl-mark { align-self:start;width:50px;height:42px;fill:#C8A24B; }
      .pro-quote-explained .kl-body { display:grid;gap:14px; }
      .pro-quote-explained .kl-detail { color:#A8A49C; }`,
  },
  "live-status": {
    family: "payoff",
    hint: "Greg explicitly says a resource or offer is open now; use that statement first, then his words about who can use it or how",
    tags: ["callout"],
    source: source("status"),
    slots: { offer: spoken(38, 592, 48, 1), access: spoken(70, 592, 40) },
    size: { w: 648, h: 256 },
    surface: "obsidian",
    render(o, h) {
      const dot = svg("live-dot", "0 0 28 28", '<circle cx="14" cy="14" r="9"/>');
      const inner = `<div class="kl-status">${dot}${label("Live")}</div>` +
        copy(h, "term", o.slots.offer[0]) + copy(h, "detail", o.slots.access[0]);
      return {
        inner,
        timeline: twoLines(o, h, "offer", "access") + "\n" +
          state(h, ".kl-live-dot circle", { fill: "#343438" }, { fill: "#C8A24B" }, o.start),
      };
    },
    css: base("live-status") + `
      .pro-live-status { display:grid;align-content:center;gap:8px;padding:18px 28px;background:#0B0B0D; }
      .pro-live-status .kl-status { display:flex;align-items:center;gap:8px;justify-self:start;padding:4px 12px;border:2px solid #343438;border-radius:24px; }
      .pro-live-status .kl-live-dot { width:28px;height:28px;fill:#343438; }`,
  },
  "step-detail": {
    family: "procedure",
    hint: "Greg names one specific step in a method and immediately demonstrates how to do it; include an ordinal in the action only if he says it",
    tags: ["steps", "callout"],
    source: source("step"),
    slots: { action: spoken(40, 636, 48, 2), instruction: spoken(72, 636, 40) },
    size: { w: 696, h: 312 },
    surface: "obsidian",
    render(o, h) {
      const sign = svg("direction kl-ink", "0 0 36 30",
        '<path class="kl-draw" pathLength="1" d="M3 15h29m-10-9 10 9-10 9"/>');
      const inner = `<div class="kl-step">${sign}${label("Step")}</div>` +
        copy(h, "term", o.slots.action[0]) + copy(h, "detail", o.slots.instruction[0]);
      return { inner, timeline: twoLines(o, h, "action", "instruction") + "\n" + draw(h, ".kl-direction path", o.start) };
    },
    css: base("step-detail") + `
      .pro-step-detail { display:grid;align-content:center;gap:8px;padding:20px 30px;background:#0B0B0D; }
      .pro-step-detail .kl-step { display:flex;align-items:center;gap:10px; }
      .pro-step-detail .kl-direction { width:36px;height:30px; }
      .pro-step-detail .kl-detail { padding-top:8px;border-top:2px solid #343438; }`,
  },
  "alert-preview": {
    family: "conversation",
    hint: "Greg quotes both the subject and the message of a short alert someone receives; use the two exact lines in order",
    tags: ["message", "conversation"],
    source: source("toast"),
    slots: { subject: spoken(32, 532, 48, 2), body: spoken(64, 532, 40) },
    size: { w: 680, h: 268 },
    surface: "bone",
    render(o, h) {
      const bell = svg("bell", "0 0 54 54",
        '<path class="kl-ink kl-draw" pathLength="1" d="M10 39h34l-5-7V21a12 12 0 0 0-24 0v11Zm12 5a5 5 0 0 0 10 0"/>');
      const inner = `<div class="kl-icon">${bell}</div><div class="kl-body">` +
        copy(h, "term", o.slots.subject[0]) + copy(h, "detail", o.slots.body[0]) + "</div>";
      return { inner, timeline: twoLines(o, h, "subject", "body") + "\n" + draw(h, ".kl-bell path", o.start) };
    },
    css: base("alert-preview") + `
      .pro-alert-preview { display:grid;grid-template-columns:68px 1fr;align-items:center;gap:20px;padding:20px 30px; }
      .pro-alert-preview .kl-icon { align-self:start;display:grid;place-items:center;width:68px;height:68px;margin-top:4px;border-radius:14px;background:#0B0B0D; }
      .pro-alert-preview .kl-bell { width:50px;height:50px; }
      .pro-alert-preview .kl-body { display:grid;gap:10px; }`,
  },
  "spec-sheet": {
    family: "procedure",
    hint: "Greg introduces a resource or tool then names two specific fields and their values in order; take each property and value verbatim",
    tags: ["list", "callout"],
    source: source("spec"),
    slots: {
      title: spoken(40, 640, 48),
      firstField: spoken(24, 214, 40),
      firstValue: spoken(38, 388, 40),
      secondField: spoken(24, 214, 40),
      secondValue: spoken(38, 388, 40),
    },
    size: { w: 704, h: 408 },
    surface: "obsidian",
    render(o, h) {
      const rows = [["firstField", "firstValue"], ["secondField", "secondValue"]];
      const inner = copy(h, "term", o.slots.title[0]) + rows.map(([field, value], i) =>
        `<div class="kl-row kl-row-${i}">${copy(h, field, o.slots[field][0])}${copy(h, value, o.slots[value][0])}</div>`).join("");
      const timeline = [write(h, ".kl-term", o.start), ...rows.flatMap(([field, value], i) => [
        state(h, `.kl-row-${i}`, { borderTopColor: "#0B0B0D" }, { borderTopColor: "#343438" }, o.slots[field][0].at),
        write(h, `.kl-${field}`, o.slots[field][0].at),
        write(h, `.kl-${value}`, o.slots[value][0].at),
      ])].join("\n");
      return { inner, timeline };
    },
    css: base("spec-sheet") + `
      .pro-spec-sheet { display:grid;align-content:center;gap:12px;padding:24px 32px;background:#0B0B0D; }
      .pro-spec-sheet .kl-row { display:grid;grid-template-columns:214px 1fr;gap:24px;border-top:2px solid #0B0B0D;padding-top:10px;font:600 40px/48px "Inter",sans-serif; }
      .pro-spec-sheet .kl-row>div:first-child { color:#A8A49C; }`,
  },
  "split-benchmark": {
    family: "proof",
    hint: "Greg compares two explicit benchmarks in the same units and says the short context after each figure; use the two amounts and their spoken qualifiers",
    tags: ["number", "comparison"],
    source: source("comparemini"),
    slots: {
      firstValue: figure(24, 308, 2, (text) => !!benchmark(text)),
      firstContext: spoken(26, 308, 40),
      secondValue: figure(24, 308, 2, (text, slots) => {
        const first = benchmark(slots.firstValue[0].text);
        return !!first && first === benchmark(text);
      }),
      secondContext: spoken(26, 308, 40),
    },
    size: (o) => ({ w: 720, h: 156 + Math.max(valueHeight(o, "firstValue"), valueHeight(o, "secondValue")) }),
    surface: "obsidian",
    render(o, h) {
      const sides = [["firstValue", "firstContext"], ["secondValue", "secondContext"]];
      const height = Math.max(valueHeight(o, "firstValue"), valueHeight(o, "secondValue"));
      const inner = sides.map(([value, context]) =>
        `<div class="kl-side" style="--kl-value-height:${height}px">${copy(h, "value", o.slots[value][0], value)}${copy(h, "detail", o.slots[context][0], context)}</div>`).join("");
      const timeline = sides.flatMap(([value, context]) => [
        write(h, `.kl-${value}`, o.slots[value][0].at, "inset(100% 0 0 0)"),
        write(h, `.kl-${context}`, o.slots[context][0].at),
      ]).join("\n");
      return { inner, timeline };
    },
    css: base("split-benchmark") + `
      .pro-split-benchmark { display:grid;grid-template-columns:1fr 1fr;padding:20px 0;background:#0B0B0D; }
      .pro-split-benchmark .kl-side { display:grid;grid-template-rows:var(--kl-value-height) 96px;align-content:center;align-items:end;gap:12px;padding:0 24px;text-align:center; }
      .pro-split-benchmark .kl-side+.kl-side { border-left:2px solid #343438; }
      .pro-split-benchmark .kl-detail { align-self:start; }
      .pro-split-benchmark .kl-value { clip-path:inset(100% 0 0 0); }`,
  },
  "offer-price-tag": {
    family: "proof",
    hint: "Greg states one exact offer price with its currency and then says what's included; use his price and spoken coverage",
    tags: ["money", "number"],
    source: source("price"),
    slots: {
      price: figure(36, 552, 3, (text) => !!currency(text)),
      offer: spoken(68, 632, 40),
    },
    size: (o) => ({ w: 696, h: 168 + valueHeight(o, "price", 3) }),
    surface: "bare",
    render(o, h) {
      const inner = `<div class="kl-price"><div class="kl-tag"><div class="kl-hole"></div>${copy(h, "value", o.slots.price[0])}</div></div>` +
        `<div class="kl-offer">${copy(h, "detail", o.slots.offer[0])}</div>`;
      return {
        inner,
        timeline: [write(h, ".kl-price", o.start), write(h, ".kl-value", o.start),
          write(h, ".kl-detail", o.slots.offer[0].at)].join("\n"),
      };
    },
    css: base("offer-price-tag") + `
      .pro-offer-price-tag { display:grid;align-content:center;gap:8px; }
      .pro-offer-price-tag .kl-price { opacity:0; }
      .pro-offer-price-tag .kl-tag { display:grid;grid-template-columns:24px 1fr;align-items:center;gap:16px;min-height:132px;padding:12px 28px 12px 52px;background:#C8A24B;clip-path:polygon(0 50%,34px 0,100% 0,100% 100%,34px 100%); }
      .pro-offer-price-tag .kl-hole { width:18px;height:18px;background:#0B0B0D;border-radius:50%; }
      .pro-offer-price-tag .kl-value { color:#0B0B0D; }
      .pro-offer-price-tag .kl-offer { min-height:128px;padding:16px 32px;background:#0B0B0D;border-radius:14px; }`,
  },
  "count-stack-label": {
    family: "proof",
    hint: "Greg states a completed whole count, names what was counted, then separately qualifies it with a time window or population; use all three ranges",
    tags: ["number"],
    source: source("counter"),
    slots: {
      value: figure(30, 592, 2, proof.odometer.slots.value.validate),
      metric: spoken(26, 592, 48, 1),
      context: spoken(56, 592, 40),
    },
    size: (o) => ({ w: 656, h: 224 + valueHeight(o, "value") }),
    surface: "obsidian",
    render(o, h) {
      // A vertical mask rolls the spoken endpoint into view without showing intervening counts.
      const inner = copy(h, "value", o.slots.value[0]) + '<div class="kl-rule"></div>' +
        copy(h, "term", o.slots.metric[0]) + copy(h, "detail", o.slots.context[0]);
      return {
        inner,
        timeline: [
          write(h, ".kl-value", o.start, "inset(100% 0 0 0)"),
          state(h, ".kl-rule", { scaleX: 0 }, { scaleX: 1 }, o.slots.metric[0].at),
          twoLines(o, h, "metric", "context"),
        ].join("\n"),
      };
    },
    css: base("count-stack-label") + `
      .pro-count-stack-label { display:grid;align-content:center;gap:8px;padding:20px 32px;text-align:center;background:#0B0B0D; }
      .pro-count-stack-label .kl-value { clip-path:inset(100% 0 0 0); }
      .pro-count-stack-label .kl-rule { height:3px;background:#343438;transform:scaleX(0);transform-origin:center; }`,
  },
  "reported-change-chip": {
    family: "proof",
    hint: "Greg gives one exact signed percentage change, then names the metric and explicitly states its comparison baseline; keep up or down in the change range",
    tags: ["percent", "comparison"],
    source: source("deltachip"),
    slots: {
      change: figure(26, 600, 2, change),
      metric: spoken(30, 644, 48, 1),
      baseline: spoken(52, 644, 40),
    },
    size: (o) => ({ w: 700, h: 228 + valueHeight(o, "change") }),
    surface: "obsidian",
    render(o, h) {
      const inner = `<div class="kl-pill">${copy(h, "value", o.slots.change[0])}</div>` +
        copy(h, "term", o.slots.metric[0]) + copy(h, "detail", o.slots.baseline[0]);
      return {
        inner,
        timeline: [
          write(h, ".kl-pill", o.start, "inset(100% 0 0 0)"),
          write(h, ".kl-value", o.start, "inset(100% 0 0 0)"),
          twoLines(o, h, "metric", "baseline"),
        ].join("\n"),
      };
    },
    css: base("reported-change-chip") + `
      .pro-reported-change-chip { display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:10px;padding:18px 28px;background:#0B0B0D; }
      .pro-reported-change-chip .kl-pill { padding:4px 20px;background:#C8A24B;border-radius:40px;opacity:0; }
      .pro-reported-change-chip .kl-value { color:#0B0B0D;clip-path:inset(100% 0 0 0); }
      .pro-reported-change-chip .kl-detail { color:#A8A49C; }`,
  },
  "percent-label-bar": {
    family: "proof",
    hint: "Greg names a metric, states its exact percentage of a whole, then specifies the population it measures; use the title, amount and population in speaking order",
    tags: ["percent", "chart", "progress"],
    source: source("minibar", "meterchip"),
    slots: {
      metric: spoken(30, 612, 48, 1),
      value: figure(22, 612, 2, exactPercent),
      context: spoken(46, 612, 40),
    },
    size: (o) => ({ w: 676, h: 248 + valueHeight(o, "value") }),
    surface: "obsidian",
    render(o, h) {
      const value = o.slots.value[0], fraction = percent(value.text) / 100;
      const inner = copy(h, "term", o.slots.metric[0]) + copy(h, "value", value) +
        '<div class="kl-track" aria-hidden="true"><div class="kl-fill"></div></div>' +
        copy(h, "detail", o.slots.context[0]);
      return {
        inner,
        timeline: [
          write(h, ".kl-term", o.start),
          write(h, ".kl-value", value.at),
          write(h, ".kl-track", value.at),
          state(h, ".kl-fill", { scaleX: 0 }, { scaleX: fraction }, value.at),
          write(h, ".kl-detail", o.slots.context[0].at),
        ].join("\n"),
      };
    },
    css: base("percent-label-bar") + `
      .pro-percent-label-bar { display:grid;align-content:center;gap:12px;padding:18px 32px;background:#0B0B0D; }
      .pro-percent-label-bar .kl-track { height:20px;border-radius:10px;background:#343438;overflow:hidden;opacity:0; }
      .pro-percent-label-bar .kl-fill { height:100%;background:#C8A24B;transform:scaleX(0);transform-origin:left; }`,
  },
  "duration-bracket-label": {
    family: "proof",
    hint: "Greg states a duration with its units, then specifically says what that span measures or how to spend it; use both spoken ranges",
    tags: ["time", "number"],
    source: source("measure"),
    slots: { time: figure(30, 556, 2, duration), context: spoken(56, 556, 40) },
    size: (o) => ({ w: 620, h: 184 + valueHeight(o, "time") }),
    surface: "obsidian",
    render(o, h) {
      const measure = svg("measure kl-ink", "0 0 544 36", '<path class="kl-draw" pathLength="1" d="M272 18H4M4 4v28"/><path class="kl-draw" pathLength="1" d="M272 18h268m0-14v28"/>');
      return {
        inner: copy(h, "value", o.slots.time[0]) + measure + copy(h, "detail", o.slots.context[0]),
        timeline: [write(h, ".kl-value", o.start), draw(h, ".kl-measure path", o.start),
          write(h, ".kl-detail", o.slots.context[0].at)].join("\n"),
      };
    },
    css: base("duration-bracket-label") + `
      .pro-duration-bracket-label { display:grid;align-content:center;justify-items:center;gap:10px;padding:14px 32px;text-align:center;background:#0B0B0D; }
      .pro-duration-bracket-label .kl-measure { width:544px;height:36px; }`,
  },
  "lesson-ribbon": {
    variantOf: "gold-frame",
    family: payoff["gold-frame"].family,
    hint: payoff["gold-frame"].hint,
    tags: ["quote", "callout"],
    source: source("takeaway", "ribbon"),
    slots: {
      heading: { kind: "label", optional: true, maxChars: 26, width: 556, size: 28, maxLines: 1 },
      quote: spoken(64, 612, 48, 3, (_, slots) => !slots.heading.length || ribbonHeadings.test(slots.heading[0].text)),
    },
    size: { w: 676, h: 272 },
    surface: "bare",
    render(o, h) {
      const heading = o.slots.heading[0];
      const ribbon = label(heading ? h.copy(heading) : "Takeaway");
      return {
        inner: `<div class="kl-ribbon">${ribbon}</div><div class="kl-body">${copy(h, "term", o.slots.quote[0])}</div>`,
        timeline: write(h, ".kl-ribbon", o.start, "inset(0 0 100% 0)") + "\n" + write(h, ".kl-term", o.start),
      };
    },
    css: base("lesson-ribbon") + `
      .pro-lesson-ribbon { display:grid;align-content:center;justify-items:start; }
      .pro-lesson-ribbon .kl-ribbon { margin-left:20px;opacity:0; }
      .pro-lesson-ribbon .kl-label { padding:7px 42px 7px 20px;color:#0B0B0D;background:#C8A24B;clip-path:polygon(0 0,100% 0,calc(100% - 18px) 50%,100% 100%,0 100%); }
      .pro-lesson-ribbon .kl-body { width:100%;min-height:200px;display:grid;align-items:center;padding:16px 32px;background:#0B0B0D;border-radius:14px; }`,
  },
};
