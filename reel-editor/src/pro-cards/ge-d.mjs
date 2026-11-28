// Restyled from ghost-editor (MIT License, copyright 2026 kurbaitaev). See src/pro-cards/GHOST-EDITOR-LICENSE.md.
import { CARDS as conversation } from "./conversation-2.mjs";
import { CARDS as distinction } from "./distinction-2.mjs";
import { CARDS as lower } from "./herk-klower.mjs";
import { CARDS as lowerLabels } from "./herk-klabel.mjs";
import { CARDS as methods } from "./herk-voverview.mjs";
import { CARDS as numbers } from "./herk-kstat.mjs";
import { CARDS as overview } from "./herk-koverview.mjs";
import { CARDS as payoff } from "./warning-emphasis-full.mjs";
import { CARDS as procedure } from "./procedure-2.mjs";
import { CARDS as proof } from "./proof-2.mjs";
import { CARDS as ranking } from "./procedure-proof.mjs";
import { CARDS as sections } from "./herk-ksection.mjs";
import { CARDS as warning } from "./warning-payoff-2.mjs";

const seoul = (...ids) => ids.map((id) => `ghost-editor:seoul-list/${id}`).join(", ");
const stan = (id) => `ghost-editor:stan-style/${id}`;

// Use the planner's width estimate at the authored size so its smaller fallback never changes these layouts.
function fits(text, width, size, maxLines) {
  const measure = (line) => [...line].reduce((sum, c) => sum +
    (/\s/.test(c) ? 0.3 : /[ilI.,!'’]/.test(c) ? 0.32 : /[MW@]/.test(c) ? 0.95 : /[A-Z]/.test(c) ? 0.75 : 0.65) * size, 0);
  let count = 0, line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (measure(word) > width) return false;
    const joined = line ? `${line} ${word}` : word;
    if (line && measure(joined) <= width) line = joined;
    else { count++; line = word; }
  }
  return Boolean(line) && count <= maxLines;
}

function spoken(maxChars, width, size = 40, maxLines = 2, check = () => true) {
  return { kind: "spoken", maxChars, width, size, maxLines, validate: (text, slots) => fits(text, width, size, maxLines) && check(text, slots) };
}

const repeated = (slot, min, max = min) => ({ ...slot, repeat: [min, max] });
const optional = (slot) => ({ ...slot, optional: true });
const heading = { kind: "label", optional: true, maxChars: 24, width: 656, size: 28, maxLines: 1 };

function tween(h, selector, from, to, at, state = false) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${state ? h.motion.state : h.motion.enter},ease:${state ? "proState" : "proEnter"},immediateRender:false},${at});`;
}

function write(h, selector, at, from = {}) {
  return tween(h, selector,
    { opacity: 0, clipPath: "inset(0 100% 0 0)", ...from },
    { opacity: 1, clipPath: "inset(0 0 0 0)", ...("x" in from ? { x: 0 } : {}), ...("y" in from ? { y: 0 } : {}) }, at);
}

const draw = (h, selector, at) => tween(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at, true);
const copy = (h, cls, item) => `<div class="gd-copy ${cls}">${h.copy(item)}</div>`;
const label = (text) => `<div class="gd-label">${text}</div>`;
const path = (d, cls = "gd-mark") => `<path class="${cls}" d="${d}" pathLength="1"/>`;
const svg = (viewBox, inner, cls = "") => `<svg class="${cls}" viewBox="${viewBox}" aria-hidden="true" preserveAspectRatio="none">${inner}</svg>`;
const bell = svg("0 0 48 48", path("M8 35h32l-5-7v-9a11 11 0 0 0-22 0v9Zm12 5a4 4 0 0 0 8 0"), "gd-icon");

const base = (type, size = 40, line = 48) => `
    .pro-${type} .gd-copy { min-width:0;font:700 ${size}px/${line}px "Inter",sans-serif;opacity:0;clip-path:inset(0 100% 0 0); }
    .pro-${type} .gd-label { color:#A8A49C;font:700 28px/34px "Inter",sans-serif; }
    .pro-${type} .gd-mark { fill:none;stroke:#C8A24B;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1; }`;

const chartWords = new Map("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ").map((word, i) => [word, i]));
const chartTens = new Map("twenty thirty forty fifty sixty seventy eighty ninety".split(" ").map((word, i) => [word, 20 + 10 * i]));

// Read a complete endpoint. Ambiguous values and ranges never contribute to chart geometry.
function chartValue(text) {
  const match = text.toLowerCase().trim().replace(/[.,!?]$/, "").match(/^(.+?)(?:\s*(%)|\s+(per ?cent))?$/);
  if (!match) return null;
  const unit = match[2] || match[3] ? "percent" : "count";
  const raw = match[1];
  let value;
  if (/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) value = Number(raw.replaceAll(",", ""));
  else if (raw === "one hundred") value = 100;
  else {
    const parts = raw.split(/[- ]+/);
    const tens = chartTens.get(parts[0]), ones = chartWords.get(parts[1]);
    if (parts.length === 1) value = chartWords.get(raw) ?? tens;
    if (parts.length === 2 && tens && ones > 0 && ones < 10) value = tens + ones;
  }
  return Number.isFinite(value) && (unit === "percent" ? value <= 100 : Number.isSafeInteger(value)) ? { unit, value } : null;
}

const series = [
  { label: "firstMetric", from: "firstFrom", to: "firstTo" },
  { label: "secondMetric", from: "secondFrom", to: "secondTo" },
];
const endpoint = spoken(24, 316, 40, 2, (text) => chartValue(text) !== null);

function endpoints(slots) {
  return series.map(({ from, to }) => [chartValue(slots[from][0].text), chartValue(slots[to][0].text)]);
}

function opposing(slots) {
  const pairs = endpoints(slots);
  const unit = pairs[0][0].unit;
  const [first, second] = pairs.map(([from, to]) => Math.sign(to.value - from.value));
  return first !== 0 && first === -second && pairs.flat().every((point) => point.unit === unit);
}

function peopleShare(text) {
  const terms = text.split(/\s+out of\s+|\s*\/\s*/i);
  const [part, total] = terms.map(chartValue);
  return terms.length === 2 && part?.unit === "count" && total?.unit === "count" &&
    part.value > 0 && part.value < total.value && total.value <= 12 ? [part.value, total.value] : null;
}

const cellWidth = 48;
const cellsPerLine = 14;

// Use whole words on each row. Fit is measured in cells here, including the gap at a space.
function cellLines(text) {
  const lines = [];
  for (const word of text.trim().split(/\s+/)) {
    if ([...word].length > cellsPerLine) return [];
    const previous = lines.at(-1);
    if (previous && [...`${previous} ${word}`].length <= cellsPerLine) lines[lines.length - 1] = `${previous} ${word}`;
    else lines.push(word);
  }
  return lines;
}

const tallyValue = spoken(14, 300, 96, 1, overview["metric-tiles"].slots.value1.validate);
const tallyContext = spoken(26, 332);

export const CARDS = {
  "comment-typed-slip": {
    variantOf: "comment",
    hint: conversation.comment.hint,
    family: "conversation",
    tags: ["message"],
    source: seoul("ig-comment-card"),
    slots: { comment: spoken(54, 628) },
    size: { w: 720, h: 190 },
    surface: "bone",
    render(o, h) {
      const item = o.slots.comment[0];
      const speech = svg("0 0 32 30", path("M3 3h26v18H14l-7 6v-6H3Z"), "gd-icon");
      return {
        inner: `<div class="gd-header">${speech}${label("Comment")}</div>${copy(h, "gd-text", item)}`,
        timeline: [draw(h, ".gd-mark", item.at), write(h, ".gd-text", item.at)].join("\n"),
      };
    },
    css: base("comment-typed-slip") + `
      .pro-comment-typed-slip { display:grid;align-content:center;gap:10px;padding:18px 32px; }
      .pro-comment-typed-slip .gd-header { display:flex;align-items:center;gap:12px;border-bottom:2px solid #343438;padding-bottom:8px; }
      .pro-comment-typed-slip .gd-label { color:#343438; }
      .pro-comment-typed-slip .gd-icon { width:32px;height:30px; }
      .pro-comment-typed-slip .gd-mark { stroke:#0B0B0D; }`,
  },

  "selection-rows": {
    variantOf: "topic-chip-grid",
    hint: lower["topic-chip-grid"].hint,
    family: "emphasis",
    tags: ["list", "highlight"],
    source: seoul("blue-text-selection"),
    slots: { items: repeated(spoken(32, 620, 44, 1), 2, 4) },
    size: (o) => ({ w: 720, h: 40 + 72 * o.slots.items.length }),
    surface: "obsidian",
    render(o, h) {
      return {
        inner: o.slots.items.map((item, i) => copy(h, `gd-selection gd-selection-${i}`, item)).join(""),
        timeline: o.slots.items.map((item, i) => write(h, `.gd-selection-${i}`, item.at)).join("\n"),
      };
    },
    css: base("selection-rows", 44, 52) + `
      .pro-selection-rows { display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:8px;padding:20px 24px; }
      .pro-selection-rows .gd-selection { width:max-content;max-width:100%;padding:6px 16px;background:#C8A24B;color:#0B0B0D; }`,
  },

  "alert-drop": {
    variantOf: "alert-preview",
    hint: lowerLabels["alert-preview"].hint,
    family: "conversation",
    tags: ["message", "conversation"],
    source: seoul("ios-notification-banner-typed"),
    slots: { subject: spoken(34, 584, 46, 1), body: spoken(56, 584) },
    size: { w: 720, h: 236 },
    surface: "obsidian",
    render(o, h) {
      const { subject: [subject], body: [body] } = o.slots;
      return {
        inner: `<div class="gd-banner">${bell}${copy(h, "gd-subject", subject)}</div>${copy(h, "gd-body", body)}`,
        timeline: [
          tween(h, ".gd-banner", { opacity: 0, y: -14 }, { opacity: 1, y: 0 }, subject.at),
          draw(h, ".gd-icon path", subject.at), write(h, ".gd-subject", subject.at),
          write(h, ".gd-body", body.at),
        ].join("\n"),
      };
    },
    css: base("alert-drop") + `
      .pro-alert-drop { padding:20px 24px;display:grid;align-content:center;gap:12px; }
      .pro-alert-drop .gd-banner { display:grid;grid-template-columns:44px 1fr;gap:12px;align-items:center;padding:6px 12px;background:#343438;opacity:0; }
      .pro-alert-drop .gd-subject { font-size:46px;line-height:54px; }
      .pro-alert-drop .gd-body { width:584px;margin-left:68px; }
      .pro-alert-drop .gd-icon { width:44px;height:44px; }`,
  },

  "alert-cascade": {
    variantOf: "lock-screen",
    hint: conversation["lock-screen"].hint,
    family: "conversation",
    tags: ["message"],
    source: seoul("lockscreen-notification-stack"),
    slots: { messages: repeated(spoken(52, 560), 1, 3) },
    size: (o) => ({ w: 720, h: 66 + 122 * o.slots.messages.length }),
    surface: "obsidian",
    render(o, h) {
      return {
        inner: `<div class="gd-header">${bell}${label("Notifications")}</div><div class="gd-cascade">${o.slots.messages.map((item, i) =>
          `<div class="gd-toast gd-toast-${i}" style="margin-left:${i * 18}px">${copy(h, "gd-message", item)}</div>`).join("")}</div>`,
        timeline: o.slots.messages.flatMap((item, i) => [
          tween(h, `.gd-toast-${i}`, { opacity: 0, y: -16 }, { opacity: 1, y: 0 }, item.at),
          write(h, `.gd-toast-${i} .gd-message`, item.at),
          ...(i === 0 ? [draw(h, ".gd-header path", item.at)] : [
            tween(h, `.gd-toast-${i - 1} .gd-message`, { color: "#F5F1E8" }, { color: "#A8A49C" }, item.at, true),
          ]),
        ]).join("\n"),
      };
    },
    css: base("alert-cascade") + `
      .pro-alert-cascade { display:grid;align-content:center;gap:10px;padding:16px 24px; }
      .pro-alert-cascade .gd-header { display:flex;align-items:center;gap:10px; }
      .pro-alert-cascade .gd-icon { width:36px;height:36px; }
      .pro-alert-cascade .gd-cascade { display:grid;gap:8px; }
      .pro-alert-cascade .gd-toast { display:grid;align-content:center;width:632px;min-height:110px;padding:4px 18px;background:#343438;border-top:2px solid #C8A24B;border-radius:12px;opacity:0; }`,
  },

  "count-print-window": {
    variantOf: "odometer",
    hint: proof.odometer.hint,
    family: "proof",
    tags: ["number"],
    source: seoul("count-up-number-page"),
    slots: { value: spoken(30, 664, 96, 2, proof.odometer.slots.value.validate), label: spoken(38, 664, 40, 1) },
    size: (o) => ({ w: 720, h: 126 + 104 * o.slots.value[0].lines.length }),
    surface: "bone",
    render(o, h) {
      const { value: [value], label: [context] } = o.slots;
      const ruled = svg("0 0 664 10", path("M2 5H662"), "gd-rule");
      return {
        inner: `<div class="gd-window">${copy(h, "gd-count", value)}</div>${ruled}${copy(h, "gd-context", context)}`,
        // Feed the earned count through a window. A simulated count-up would display unspoken values.
        timeline: [
          write(h, ".gd-count", value.at, { y: 16, clipPath: "inset(100% 0 0 0)" }),
          draw(h, ".gd-rule path", value.at),
          write(h, ".gd-context", context.at),
        ].join("\n"),
      };
    },
    css: base("count-print-window") + `
      .pro-count-print-window { display:grid;align-content:center;gap:12px;padding:24px 28px; }
      .pro-count-print-window .gd-window { overflow:hidden; }
      .pro-count-print-window .gd-count { width:664px;font:400 96px/104px "Anton",sans-serif; }
      .pro-count-print-window .gd-rule { width:664px;height:10px;display:block; }
      .pro-count-print-window .gd-rule path { stroke:#343438; }`,
  },

  "rank-fill-strip": {
    variantOf: "ranking",
    hint: ranking.ranking.hint,
    family: "procedure",
    tags: ["ranking", "list"],
    source: seoul("ranked-list-top-fill"),
    slots: { heading, items: repeated(spoken(44, 628), 3) },
    size: { w: 720, h: 436 },
    surface: "bone",
    render(o, h) {
      const title = o.slots.heading[0];
      const inner = (title ? label(h.copy(title)) : "") + `<div class="gd-ranks">${o.slots.items.map((item, i) =>
        `<div class="gd-rank gd-rank-${i}">${i === 0 ? '<span class="gd-fill" aria-hidden="true"></span>' : ""}${copy(h, "gd-item", item)}</div>`).join("")}</div>`;
      const timeline = o.slots.items.flatMap((item, i) => [
        ...(i === 0 ? [tween(h, ".gd-fill", { scaleX: 0 }, { scaleX: 1 }, item.at, true)] : []),
        write(h, `.gd-rank-${i} .gd-item`, item.at, { x: 12 }),
      ]).join("\n");
      return { inner, timeline };
    },
    css: base("rank-fill-strip") + `
      .pro-rank-fill-strip { display:grid;align-content:center;gap:10px;padding:24px; }
      .pro-rank-fill-strip .gd-label { color:#343438; }
      .pro-rank-fill-strip .gd-ranks { display:grid;gap:8px; }
      .pro-rank-fill-strip .gd-rank { min-height:102px;position:relative;display:grid;align-items:center;padding:3px 20px;border:2px solid #343438; }
      .pro-rank-fill-strip .gd-item { position:relative; }
      .pro-rank-fill-strip .gd-fill { position:absolute;inset:0;background:#C8A24B;transform-origin:left;transform:scaleX(0); }`,
  },

  "fraction-breakaway": {
    variantOf: "people-fraction",
    hint: numbers["people-fraction"].hint,
    family: "proof",
    tags: ["number", "chart"],
    source: seoul("dots-crowd-one-alone"),
    slots: { value: spoken(28, 664, 96, 2, (text) => peopleShare(text) !== null), context: spoken(48, 664) },
    size: (o) => ({ w: 720, h: 268 + 104 * o.slots.value[0].lines.length }),
    surface: "obsidian",
    render(o, h) {
      const { value: [value], context: [context] } = o.slots;
      const [part, total] = peopleShare(value.text);
      const dots = Array.from({ length: total }, (_, i) =>
        `<circle class="${i < part ? "gd-part" : "gd-rest"}" cx="${178 + (i % 6) * 60}" cy="${28 + 44 * Math.floor(i / 6)}" r="14"/>`).join("");
      const inner = copy(h, "gd-fraction", value) + svg("0 0 664 104", dots, "gd-group") + copy(h, "gd-context", context);
      return {
        inner,
        timeline: [
          write(h, ".gd-fraction", value.at),
          tween(h, ".gd-group", { opacity: 0 }, { opacity: 1 }, value.at),
          write(h, ".gd-context", context.at),
          tween(h, ".gd-part", { x: 0, y: 0, fill: "#A8A49C" }, { x: -16, y: -8, fill: "#C8A24B" }, context.at, true),
        ].join("\n"),
      };
    },
    css: base("fraction-breakaway") + `
      .pro-fraction-breakaway { display:grid;align-content:center;gap:10px;padding:24px 28px; }
      .pro-fraction-breakaway .gd-fraction { font:400 96px/104px "Anton",sans-serif;color:#C8A24B; }
      .pro-fraction-breakaway .gd-group { display:block;width:664px;height:104px;fill:#A8A49C;opacity:0; }`,
  },

  "versus-checkline": {
    variantOf: "versus-split",
    hint: distinction["versus-split"].hint,
    family: "distinction",
    tags: ["comparison"],
    source: seoul("versus-2up-check-cross"),
    slots: { weaker: spoken(34, 570), better: spoken(34, 570) },
    size: { w: 720, h: 296 },
    surface: "obsidian",
    render(o, h) {
      const { weaker: [weaker], better: [better] } = o.slots;
      const cross = svg("0 0 44 44", path("M7 7 37 37M37 7 7 37"), "gd-icon");
      const check = svg("0 0 44 44", path("M7 22 17 34 37 9"), "gd-icon");
      const stroke = svg("0 0 570 14", path("M3 9Q278 1 567 7"), "gd-strike");
      return {
        inner: `<div class="gd-choice gd-weak">${cross}<div class="gd-text">${copy(h, "gd-weaker", weaker)}${stroke}</div></div><div class="gd-choice gd-strong">${check}${copy(h, "gd-better", better)}</div>`,
        timeline: [
          write(h, ".gd-weaker", weaker.at, { x: -12 }),
          write(h, ".gd-better", better.at, { x: 12 }),
          draw(h, ".gd-weak .gd-mark", better.at),
          draw(h, ".gd-strong .gd-mark", better.at),
        ].join("\n"),
      };
    },
    css: base("versus-checkline") + `
      .pro-versus-checkline { display:grid;align-content:center;gap:8px;padding:16px 24px; }
      .pro-versus-checkline .gd-choice { display:grid;grid-template-columns:44px 1fr;align-items:center;gap:12px;min-height:118px;padding:6px 16px;border:2px solid #343438; }
      .pro-versus-checkline .gd-icon { width:44px;height:44px; }
      .pro-versus-checkline .gd-text { position:relative;width:max-content;max-width:100%; }
      .pro-versus-checkline .gd-weaker { color:#A8A49C; }
      .pro-versus-checkline .gd-strike { position:absolute;width:100%;height:14px;left:0;top:calc(50% - 7px); }
      .pro-versus-checkline .gd-strike .gd-mark { opacity:.8; }`,
  },

  "word-index-slip": {
    variantOf: "big-word",
    hint: payoff["big-word"].hint,
    family: "payoff",
    tags: ["highlight", "title"],
    source: seoul("index-card-typewriter-term"),
    slots: { word: spoken(18, 640, 66, 1, (text) => !/\s/.test(text)) },
    size: { w: 720, h: 184 },
    surface: "obsidian",
    render(o, h) {
      const item = o.slots.word[0];
      const rules = svg("0 0 640 36", '<path d="M0 4H640M0 32H640"/>', "gd-rules");
      return {
        inner: `<div class="gd-slip">${copy(h, "gd-word", item)}${rules}</div>`,
        timeline: [
          tween(h, ".gd-slip", { opacity: 0, x: -14 }, { opacity: 1, x: 0 }, item.at),
          write(h, ".gd-word", item.at),
        ].join("\n"),
      };
    },
    css: base("word-index-slip") + `
      .pro-word-index-slip { display:grid;place-items:center;padding:20px; }
      .pro-word-index-slip .gd-slip { width:676px;padding:12px 16px;background:#F5F1E8;color:#0B0B0D;border-left:4px solid #C8A24B;transform:rotate(-1deg);opacity:0; }
      .pro-word-index-slip .gd-word { font:400 66px/76px "Anton",sans-serif; }
      .pro-word-index-slip .gd-rules { width:100%;height:36px;display:block;fill:none;stroke:#343438;stroke-width:1; }`,
  },

  "headline-qualifier": {
    variantOf: "section-title-strips",
    hint: sections["section-title-strips"].hint,
    family: "emphasis",
    tags: ["title"],
    source: seoul("flash-with-subword"),
    slots: { lines: repeated(spoken(30, 640, 60, 1), 2, 3) },
    size: (o) => ({ w: 720, h: o.slots.lines.length === 3 ? 244 : 184 }),
    surface: "bone",
    render(o, h) {
      return {
        inner: o.slots.lines.map((item, i) => copy(h, `gd-fragment gd-fragment-${i}`, item)).join(""),
        timeline: o.slots.lines.map((item, i) => write(h, `.gd-fragment-${i}`, item.at, { y: i === 1 ? 12 : 0 })).join("\n"),
      };
    },
    css: base("headline-qualifier", 40, 48) + `
      .pro-headline-qualifier { display:grid;align-content:center;gap:10px;padding:20px 32px; }
      .pro-headline-qualifier .gd-fragment-0 { color:#343438; }
      .pro-headline-qualifier .gd-fragment-1 { padding-left:10px;border-left:6px solid #C8A24B;font:400 60px/68px "Anton",sans-serif; }
      .pro-headline-qualifier .gd-fragment-2 { text-align:right; }`,
  },

  "lesson-understroke": {
    variantOf: "marker-highlight",
    hint: warning["marker-highlight"].hint,
    family: "payoff",
    tags: ["highlight"],
    source: seoul("squiggle-zigzag-on-chest"),
    slots: { line: spoken(52, 648, 44) },
    size: { w: 720, h: 190 },
    surface: "obsidian",
    render(o, h) {
      const item = o.slots.line[0];
      const underline = svg("0 0 656 22", path("M4 12 115 7 166 15 287 6 351 14 502 7 638 11") + '<circle cx="649" cy="11" r="4"/>', "gd-underline");
      return {
        inner: copy(h, "gd-line", item) + underline,
        timeline: [
          write(h, ".gd-line", item.at),
          draw(h, ".gd-underline path", item.at),
          tween(h, ".gd-underline circle", { opacity: 0 }, { opacity: 1 }, h.at(item.at + h.motion.state), true),
        ].join("\n"),
      };
    },
    css: base("lesson-understroke", 44, 52) + `
      .pro-lesson-understroke { display:grid;align-content:center;gap:8px;padding:20px 32px; }
      .pro-lesson-understroke .gd-underline { width:656px;height:22px; }
      .pro-lesson-understroke .gd-underline circle { fill:#C8A24B;opacity:0; }`,
  },

  "question-ticket": {
    variantOf: "lesson-question",
    hint: sections["lesson-question"].hint,
    family: "emphasis",
    tags: ["title", "question"],
    source: seoul("ig-story-question-sticker"),
    slots: { headline: spoken(48, 600, 44, 2) },
    size: { w: 700, h: 218 },
    surface: "obsidian",
    render(o, h) {
      const item = o.slots.headline[0];
      return {
        inner: `<div class="gd-ticket">${label("Key question")}${copy(h, "gd-question", item)}</div>`,
        timeline: [tween(h, ".gd-ticket", { opacity: 0, y: 14 }, { opacity: 1, y: 0 }, item.at), write(h, ".gd-question", item.at)].join("\n"),
      };
    },
    css: base("question-ticket", 44, 52) + `
      .pro-question-ticket { padding:16px 24px;display:grid;align-items:center; }
      .pro-question-ticket .gd-ticket { border-radius:12px;overflow:hidden;background:#F5F1E8;color:#0B0B0D;opacity:0; }
      .pro-question-ticket .gd-label { background:#C8A24B;color:#0B0B0D;padding:5px 18px; }
      .pro-question-ticket .gd-question { padding:10px 18px; }`,
  },

  "erasing-habit": {
    variantOf: "crossed-out",
    hint: warning["crossed-out"].hint,
    family: "warning",
    tags: ["comparison", "warning"],
    source: seoul("word-letters-fall-away"),
    slots: { habit: spoken(46, 642, 44) },
    size: { w: 720, h: 188 },
    surface: "obsidian",
    render(o, h) {
      const item = o.slots.habit[0];
      const letters = item.lines.map((line) => `<div class="gd-line">${[...line].map((char) =>
        char === " " ? " " : `<span class="gd-letter">${h.esc(char)}</span>`).join("")}</div>`).join("");
      const inner = `<div class="gd-copy gd-word" role="group" aria-label="${h.esc(item.text)}"><div aria-hidden="true">${letters}</div><div class="gd-face" aria-hidden="true">${letters}</div></div>`;
      // Keep the rejected words readable in grey after the gold letters drop away.
      const timeline = [
        write(h, ".gd-word", item.at),
        tween(h, ".gd-face .gd-letter", { opacity: 1, y: 0 }, { opacity: 0, y: 14, stagger: { amount: 0.16 } },
          h.at(item.at + h.motion.enter), true),
      ].join("\n");
      return { inner, timeline };
    },
    css: base("erasing-habit", 44, 52) + `
      .pro-erasing-habit { display:flex;align-items:center;padding:24px 32px; }
      .pro-erasing-habit .gd-word { position:relative;color:#A8A49C;font-kerning:none;font-variant-ligatures:none; }
      .pro-erasing-habit .gd-face { position:absolute;inset:0;color:#C8A24B; }
      .pro-erasing-habit .gd-letter { display:inline-block; }`,
  },

  "strike-recall": {
    variantOf: "crossed-out",
    hint: warning["crossed-out"].hint,
    family: "warning",
    tags: ["comparison", "warning"],
    source: seoul("divan-strike-callback"),
    slots: { habit: spoken(46, 642, 44) },
    size: { w: 720, h: 188 },
    surface: "obsidian",
    render(o, h) {
      const item = o.slots.habit[0];
      const inner = `<div class="gd-copy gd-habit">${item.lines.map((line) => `<div class="gd-line">${h.esc(line)}${svg("0 0 650 14", path("M3 11Q97 4 301 7T647 4"), "gd-strike")}</div>`).join("")}</div>`;
      return {
        inner,
        timeline: [
          write(h, ".gd-habit", item.at),
          draw(h, ".gd-strike path", h.at(item.at + h.motion.enter)),
        ].join("\n"),
      };
    },
    css: base("strike-recall", 44, 52) + `
      .pro-strike-recall { display:flex;align-items:center;padding:24px 32px; }
      .pro-strike-recall .gd-habit { color:#A8A49C; }
      .pro-strike-recall .gd-line { position:relative;width:max-content;max-width:100%; }
      .pro-strike-recall .gd-strike { position:absolute;left:0;top:calc(50% - 7px);width:100%;height:14px; }`,
  },

  "pill-push-stack": {
    variantOf: "stack-fan",
    hint: procedure["stack-fan"].hint,
    family: "procedure",
    tags: ["list", "steps"],
    source: seoul("list-chips-stack-numbered"),
    slots: { items: repeated(spoken(32, 618, 40, 1), 2, 4) },
    size: (o) => ({ w: 720, h: 44 + 72 * o.slots.items.length }),
    surface: "obsidian",
    render(o, h) {
      const inner = o.slots.items.map((item, i) =>
        `<div class="gd-pill gd-pill-${i}">${copy(h, "gd-item", item)}</div>`).join("");
      const timeline = o.slots.items.flatMap((item, i, items) => [
        tween(h, `.gd-pill-${i}`, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, item.at),
        write(h, `.gd-pill-${i} .gd-item`, item.at),
        ...items.slice(0, i).map((_, j) =>
          `tl.to(${h.sel(`.gd-pill-${j}`)},{y:${-72 * (i - j)},color:"#A8A49C",borderColor:"#343438",duration:${h.motion.state},ease:proState},${item.at});`),
      ]).join("\n");
      return { inner, timeline };
    },
    css: base("pill-push-stack") + `
      .pro-pill-push-stack .gd-pill { position:absolute;left:24px;right:24px;bottom:22px;height:64px;display:grid;align-items:center;padding:0 24px;border:2px solid #C8A24B;border-radius:32px;background:#0B0B0D;opacity:0; }`,
  },

  "receipt-tally": {
    variantOf: "metric-tiles",
    hint: overview["metric-tiles"].hint,
    family: "proof",
    tags: ["number", "chart"],
    source: seoul("receipt-print-stat"),
    slots: {
      value1: tallyValue, context1: tallyContext,
      value2: tallyValue, context2: tallyContext,
      value3: tallyValue, context3: tallyContext,
      value4: optional(tallyValue), context4: optional(tallyContext),
    },
    validate: (slots) => slots.value4.length === slots.context4.length,
    size: (o) => ({ w: 720, h: 40 + 118 * (o.slots.value4.length ? 4 : 3) }),
    surface: "bone",
    render(o, h) {
      const indices = o.slots.value4.length ? [1, 2, 3, 4] : [1, 2, 3];
      const inner = indices.map((i) => `<div class="gd-tally gd-tally-${i}">${copy(h, "gd-value", o.slots[`value${i}`][0])}${copy(h, "gd-context", o.slots[`context${i}`][0])}</div>`).join("");
      const timeline = indices.flatMap((i) => {
        const valueAt = o.slots[`value${i}`][0].at, contextAt = o.slots[`context${i}`][0].at;
        return [
          tween(h, `.gd-tally-${i}`, { opacity: 0, y: 14 }, { opacity: 1, y: 0 }, valueAt),
          write(h, `.gd-tally-${i} .gd-value`, valueAt, { clipPath: "inset(100% 0 0 0)" }),
          write(h, `.gd-tally-${i} .gd-context`, contextAt),
        ];
      }).join("\n");
      return { inner, timeline };
    },
    css: base("receipt-tally") + `
      .pro-receipt-tally { padding:20px 24px;display:grid;grid-auto-rows:118px; }
      .pro-receipt-tally .gd-tally { display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:center;padding:0 10px;border-bottom:2px dashed #343438;opacity:0; }
      .pro-receipt-tally .gd-value { font:400 96px/106px "Anton",sans-serif; }
      .pro-receipt-tally .gd-context { color:#343438; }`,
  },

  "output-branches": {
    variantOf: "idea-hub",
    hint: overview["idea-hub"].hint,
    family: "payoff",
    tags: ["definition", "flow"],
    source: stan("diagram-fan-out-ai-to-four-numbers"),
    slots: { hub: spoken(30, 624, 46, 1), leaves: repeated(spoken(26, 564, 40, 1), 4) },
    size: { w: 720, h: 396 },
    surface: "obsidian",
    render(o, h) {
      const { hub: [hub], leaves } = o.slots;
      const links = leaves.map((_, i) => {
        const y = 101 + 64 * i, above = i ? y - 64 : 56;
        const branch = `M24 ${above}V${y - 12}Q24 ${y} 36 ${y}H77`;
        return path(branch, `gd-mark gd-link-${i}`) + `<circle class="gd-dot gd-dot-${i}" cx="80" cy="${y}" r="4"/>`;
      }).join("");
      const inner = `<div class="gd-diagram">${svg("0 0 672 348", links, "gd-lines")}${copy(h, "gd-hub", hub)}<div class="gd-leaves">${leaves.map((item, i) => copy(h, `gd-leaf gd-leaf-${i}`, item)).join("")}</div></div>`;
      const timeline = [
        write(h, ".gd-hub", hub.at),
        ...leaves.flatMap((item, i) => [
          draw(h, `.gd-link-${i}`, item.at),
          write(h, `.gd-leaf-${i}`, item.at, { x: -12 }),
          tween(h, `.gd-dot-${i}`, { opacity: 0 }, { opacity: 1 }, h.at(item.at + h.motion.state), true),
        ]),
      ].join("\n");
      return { inner, timeline };
    },
    css: base("output-branches") + `
      .pro-output-branches { padding:24px; }
      .pro-output-branches .gd-diagram { position:relative;height:348px; }
      .pro-output-branches .gd-lines { position:absolute;inset:0;width:100%;height:100%; }
      .pro-output-branches .gd-hub { height:56px;padding:0 16px;background:#C8A24B;color:#0B0B0D;font-size:46px;line-height:56px; }
      .pro-output-branches .gd-leaves { position:absolute;top:73px;left:88px;right:0;display:grid;gap:8px; }
      .pro-output-branches .gd-leaf { height:56px;padding:4px 8px;background:#343438; }
      .pro-output-branches .gd-dot { fill:#C8A24B;opacity:0; }`,
  },

  "role-example-tabs": {
    variantOf: "three-part-method",
    hint: methods["three-part-method"].hint,
    family: "procedure",
    tags: ["list", "steps"],
    source: stan("steps-roles-label-rol-plus-example"),
    slots: {
      one: spoken(28, 624, 46, 1), oneDetail: spoken(52, 624),
      two: spoken(28, 624, 46, 1), twoDetail: spoken(52, 624),
      three: spoken(28, 624, 46, 1), threeDetail: spoken(52, 624),
    },
    size: { w: 720, h: 214 },
    surface: "obsidian",
    render(o, h) {
      const parts = ["one", "two", "three"].map((name) => [o.slots[name][0], o.slots[`${name}Detail`][0]]);
      const inner = parts.map(([term, detail], i) =>
        `<div class="gd-pane gd-pane-${i}">${copy(h, "gd-tab", term)}${copy(h, "gd-detail", detail)}</div>`).join("");
      const timeline = parts.flatMap(([term, detail], i) => [
        ...(i ? [`tl.to(${h.sel(`.gd-pane-${i - 1}`)},{opacity:0,y:-12,duration:${h.motion.state},ease:proState},${term.at});`] : []),
        tween(h, `.gd-pane-${i}`, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, term.at),
        write(h, `.gd-pane-${i} .gd-tab`, term.at),
        write(h, `.gd-pane-${i} .gd-detail`, detail.at),
      ]).join("\n");
      return { inner, timeline };
    },
    css: base("role-example-tabs") + `
      .pro-role-example-tabs .gd-pane { position:absolute;inset:20px 24px;display:grid;align-content:center;gap:10px;padding:8px 16px;background:#0B0B0D;opacity:0; }
      .pro-role-example-tabs .gd-tab { width:max-content;max-width:100%;padding:0 12px;color:#0B0B0D;background:#C8A24B;font-size:46px;line-height:56px; }
      .pro-role-example-tabs .gd-detail { border-top:2px solid #343438;padding-top:4px; }`,
  },
};
