// Restyled from ghost-editor (MIT, copyright 2026 kurbaitaev), including its lemo-opuscar ports
// (MIT, copyright 2026 LemoLab). See src/pro-cards/GHOST-EDITOR-LICENSE.md.
import { CARDS as core } from "./core.mjs";
import { CARDS as procedure } from "./procedure-proof.mjs";
import { CARDS as proofBase } from "./proof-2.mjs";
import { CARDS as proof } from "./herk-kstat.mjs";
import { CARDS as overview } from "./herk-koverview.mjs";
import { CARDS as callouts } from "./herk-klabel.mjs";

const ink = "#0B0B0D", bone = "#F5F1E8", gold = "#C8A24B", grey = "#A8A49C", rule = "#343438";
const panel = (h) => ({ w: 720, h });
const source = (...ids) => ids.map((id) => `ghost-editor:${id}`).join(",");

// Keep the displayed size when the shared fitter would offer to shrink long words.
function fits(text, { width, size, maxLines }) {
  const measure = (line) => [...line].reduce((sum, c) => sum +
    (/\s/.test(c) ? 0.3 : /[ilI.,!'’]/.test(c) ? 0.32 : /[MW@]/.test(c) ? 0.95 : /[A-Z]/.test(c) ? 0.75 : 0.65) * size, 0);
  if (!text.trim() || /[\p{Emoji_Presentation}\uFE0F]/u.test(text)) return false;
  let lines = 1, line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (measure(word) > width) return false;
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) line = next;
    else {
      if (++lines > maxLines) return false;
      line = word;
    }
  }
  return true;
}

function spoken(maxChars, width, size = 40, maxLines = 2, check) {
  const box = { width, size, maxLines };
  return { kind: "spoken", maxChars, ...box, validate: (text, slots) => fits(text, box) && (!check || check(text, slots)) };
}

const repeated = (slot, min, max) => ({ ...slot, repeat: [min, max] });
const optional = (slot) => ({ ...slot, optional: true });
const heading = { kind: "label", optional: true, maxChars: 22, width: 656, size: 30, maxLines: 1 };
const label = (text) => `<div class="ge-label">${text}</div>`;
const copy = (h, name, item) => `<div class="ge-copy ge-${name}">${h.copy(item)}</div>`;
const svg = (name, w, h, inner) => `<svg class="ge-art ge-${name}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${inner}</svg>`;
const path = (name, d) => `<path class="ge-draw ge-${name}" pathLength="1" d="${d}"/>`;
const lines = (item, px = 48) => item.lines.length * px;

function tween(h, selector, from, to, at, state = false) {
  const duration = state ? h.motion.state : h.motion.enter;
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${duration},ease:${state ? "proState" : "proEnter"},immediateRender:false},${at});`;
}

const state = (h, selector, from, to, at) => tween(h, selector, from, to, at, true);
const draw = (h, selector, at) => state(h, selector, { strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0, opacity: 1 }, at);
const appear = (h, selector, at, from = {}, to = {}) =>
  tween(h, selector, { opacity: 0, ...from }, { opacity: 1, ...to }, at);
const wipe = "inset(0 100% 0 0)";
const open = "inset(0 0% 0 0)";
const write = (h, name, { at }, clipPath = wipe) => appear(h, `.ge-${name}`, at, { clipPath }, { clipPath: open });

function base(type) {
  return `
    .pro-${type} { background:${ink};padding:24px 32px; }
    .pro-${type} .ge-copy { font:700 40px/48px "Inter",sans-serif;opacity:0;clip-path:${wipe}; }
    .pro-${type} .ge-label { font:700 30px/36px "Inter",sans-serif;color:${grey}; }
    .pro-${type} .ge-art { display:block;fill:none;stroke:${gold};stroke-width:3;stroke-linecap:round;stroke-linejoin:round; }
    .pro-${type} .ge-draw { stroke-dasharray:1;stroke-dashoffset:1;opacity:0; }`;
}

// Only a single clean reading moves a plotted mark. The root validator handles shared units and scope;
// this design takes compact digits or number words under one hundred and falls back for other forms.
const small = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const tens = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
function amount(text) {
  const clean = text.toLowerCase().replace(/[.!?,;]+$/, "").trim();
  const dollar = clean.startsWith("$") || /\s+dollars?$/.test(clean);
  const percent = /%$|\s+per\s?cent$/.test(clean);
  if (dollar && percent) return null;
  const raw = clean.replace(/^\$\s*|\s+dollars?$|\s*%$|\s+per\s?cent$/g, "");
  const words = raw.split(/[\s-]+/);
  const ones = small.indexOf(words[0]);
  const decades = tens.indexOf(words[0]);
  const last = small.indexOf(words[1]);
  let value = null;
  if (/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) value = Number(raw.replaceAll(",", ""));
  else if (ones >= 0 && words.length === 1) value = ones;
  else if (decades >= 0 && words.length === 1) value = 20 + decades * 10;
  else if (decades >= 0 && words.length === 2 && last > 0 && last < 10) value = 20 + decades * 10 + last;
  return value !== null && value <= Number.MAX_SAFE_INTEGER && (!percent || value <= 100)
    ? { value, unit: percent ? "percent" : dollar ? "dollar" : "count" } : null;
}

function minutes(text, hasActivity = false) {
  const duration = /^(.+?)\s+(hours?|minutes?)(?:\s+(.+))?$/i.exec(text.trim().replace(/[.!?,;]+$/, ""));
  if (!duration) return null;
  const [, reading, unit, activity] = duration;
  if (Boolean(activity) !== hasActivity) return null;
  if (activity) {
    const extra = /^(.+?)\s+(?:hours?|minutes?|seconds?)\b/i.exec(activity);
    if (/^(?:and|or|to|through|point|plus|minus|more|less)\b/i.test(activity) || (extra && amount(extra[1]))) return null;
  }
  const measured = amount(reading);
  if (measured?.unit !== "count" || !Number.isInteger(measured.value) || measured.value < 1) return null;
  const value = measured.value * (/^hour/i.test(unit) ? 60 : 1);
  return value <= 1440 ? value : null;
}

function commonUnit(a, b) {
  return b ? commonUnit(b, a % b) : a;
}

const caseValue = proofBase["case-study"].slots;
const hasMetricUnit = (text) => /[%$]|\b(?:percent|per cent|dollars?)\b/i.test(text);

export const CARDS = {
  "objection-shield": {
    variantOf: "objection",
    hint: core.objection.hint,
    family: "conversation",
    tags: ["conversation", "quote"],
    source: source("whiteboard/shield"),
    slots: { theySay: spoken(44, 540), youSay: spoken(52, 608) },
    size: panel(396),
    surface: "obsidian",
    render(o, h) {
      const [they] = o.slots.theySay, [you] = o.slots.youSay;
      // The outline goes around the objection so the shield never crosses the quote.
      const shield = path("shield-outline", "M320 5Q406 14 626 22V126Q618 154 320 175Q22 154 14 126V22Q234 14 320 5Z");
      const inner = `<div class="ge-shield-row">${svg("shield", 640, 184, shield)}${label("Prospect says")}${copy(h, "they", they)}</div>
        <div class="ge-answer">${label("You say")}${copy(h, "you", you)}</div>`;
      return { inner, timeline: [
        write(h, "they", they), draw(h, ".ge-shield-outline", they.at),
        write(h, "you", you),
        state(h, ".ge-shield", { stroke: gold }, { stroke: grey }, you.at),
        state(h, ".ge-answer", { borderColor: rule }, { borderColor: gold }, you.at),
      ].join("\n") };
    },
    css: base("objection-shield") + `
      .pro-objection-shield { display:grid;grid-template-rows:184px 148px;gap:16px; }
      .pro-objection-shield .ge-shield-row { position:relative;display:grid;align-content:center;justify-items:center;gap:4px;padding-bottom:22px;text-align:center; }
      .pro-objection-shield .ge-shield { position:absolute;inset:0;width:656px;height:184px; }
      .pro-objection-shield .ge-they { max-width:540px; }
      .pro-objection-shield .ge-answer { display:grid;align-content:center;gap:4px;padding:0 22px;border-left:4px solid ${rule}; }
      .pro-objection-shield .ge-answer .ge-label { color:${gold}; }`,
  },

  "thought-bubbles": {
    variantOf: "term-definition",
    hint: callouts["term-definition"].hint,
    family: "emphasis",
    tags: ["definition", "callout"],
    source: source("whiteboard/cloud", "whiteboard/bubble"),
    slots: { term: spoken(30, 528), detail: spoken(52, 528) },
    size: panel(424),
    surface: "obsidian",
    render(o, h) {
      const [say] = o.slots.term, [hear] = o.slots.detail;
      const bubble = path("speak-outline", "M26 4H574Q596 4 596 26V126Q596 148 574 148H82L50 169V148H26Q4 148 4 126V26Q4 4 26 4Z");
      const cloud = path("think-outline", "M43 157Q18 156 18 133Q1 129 4 107Q4 91 21 82Q4 61 16 46Q22 31 42 31Q39 12 69 9Q84 8 96 18Q110 1 133 4H534Q564 5 567 25Q590 23 595 43Q602 62 589 75Q603 88 596 113Q590 133 569 136Q568 158 541 157Z M542 167h2m15 8h2");
      const row = (name, shape, title, item) =>
        `<div class="ge-bubble ge-${name}-row">${svg(name + "-art", 600, 180, shape)}${label(title)}${copy(h, name, item)}</div>`;
      return {
        inner: row("speak", bubble, "Sales term", say) + row("think", cloud, "Meaning", hear),
        timeline: [write(h, "speak", say), draw(h, ".ge-speak-outline", say.at),
          write(h, "think", hear), draw(h, ".ge-think-outline", hear.at)].join("\n"),
      };
    },
    css: base("thought-bubbles") + `
      .pro-thought-bubbles { display:grid;gap:12px; }
      .pro-thought-bubbles .ge-bubble { position:relative;width:600px;height:180px;display:grid;align-content:start;gap:3px;padding:10px 36px; }
      .pro-thought-bubbles .ge-art { position:absolute;inset:0;width:600px;height:180px; }
      .pro-thought-bubbles .ge-speak-art { stroke:${grey}; }
      .pro-thought-bubbles .ge-think-row { margin-left:auto; }
      .pro-thought-bubbles .ge-think-row .ge-label { color:${gold}; }
      .pro-thought-bubbles .ge-think-row .ge-label { padding-left:14px; }`,
  },

  "reply-return": {
    variantOf: "objection",
    hint: core.objection.hint,
    family: "conversation",
    tags: ["conversation", "flow"],
    source: source("whiteboard/boomerang"),
    slots: { theySay: spoken(44, 536), youSay: spoken(52, 536) },
    size: panel(368),
    surface: "obsidian",
    render(o, h) {
      const [they] = o.slots.theySay, [you] = o.slots.youSay;
      const route = path("return-route", "M5 20C101 16 100 148 6 146m14-11-14 11 14 11");
      return {
        inner: `<div class="ge-turn ge-out">${label("Prospect says")}${copy(h, "they", they)}</div>
          ${svg("return", 108, 176, route)}<div class="ge-turn ge-back">${label("You say")}${copy(h, "you", you)}</div>`,
        timeline: [write(h, "they", they), draw(h, ".ge-return-route", you.at), write(h, "you", you)].join("\n"),
      };
    },
    css: base("reply-return") + `
      .pro-reply-return { display:grid;grid-template-rows:148px 148px;gap:16px; }
      .pro-reply-return .ge-turn { width:568px;padding:6px 16px;display:grid;align-content:center;gap:4px; }
      .pro-reply-return .ge-out { border-top:2px solid ${rule}; }
      .pro-reply-return .ge-back { border-bottom:2px solid ${gold}; }
      .pro-reply-return .ge-back .ge-label { color:${gold}; }
      .pro-reply-return .ge-return { position:absolute;right:26px;top:99px;width:108px;height:176px; }`,
  },

  "role-handoff": {
    family: "procedure",
    tags: ["flow", "steps"],
    hint: "Greg names the sales role passing work, explicitly says what that role hands over, and then names the receiving role, in that order",
    source: source("whiteboard/bridge"),
    slots: { sender: spoken(28, 624, 40, 1), handoff: spoken(48, 568), receiver: spoken(28, 624, 40, 1) },
    size: panel(320),
    surface: "obsidian",
    render(o, h) {
      const [sender] = o.slots.sender, [handoff] = o.slots.handoff, [receiver] = o.slots.receiver;
      const bridge = path("bridge-out", "M12 5V34Q12 57 35 58M8 38h16m-16 12h16") +
        path("bridge-in", "M35 58Q56 59 56 90V113m-12-12 12 12 10-12");
      return {
        inner: `<div class="ge-role ge-from">${copy(h, "sender", sender)}</div><div class="ge-transfer">${label("Handoff")}${copy(h, "handoff", handoff)}</div>
          <div class="ge-role ge-to">${copy(h, "receiver", receiver)}</div>${svg("bridge", 72, 120, bridge)}`,
        timeline: [write(h, "sender", sender), write(h, "handoff", handoff), draw(h, ".ge-bridge-out", handoff.at),
          write(h, "receiver", receiver), draw(h, ".ge-bridge-in", receiver.at)].join("\n"),
      };
    },
    css: base("role-handoff") + `
      .pro-role-handoff { display:grid;grid-template-rows:54px 148px 54px;gap:8px; }
      .pro-role-handoff .ge-role { display:grid;align-content:center;border:2px solid ${rule};border-radius:8px;padding:0 14px; }
      .pro-role-handoff .ge-to { border-color:${gold}; }
      .pro-role-handoff .ge-transfer { margin-left:72px;display:grid;align-content:center;padding-left:16px;border-top:2px solid ${rule};border-bottom:2px solid ${rule}; }
      .pro-role-handoff .ge-label { color:${gold}; }
      .pro-role-handoff .ge-bridge { position:absolute;left:36px;top:98px;width:72px;height:120px; }`,
  },

  "rung-layers": {
    variantOf: "system-layers",
    hint: overview["system-layers"].hint,
    family: "procedure",
    tags: ["list", "flow"],
    source: source("whiteboard/idea-2"),
    slots: { layers: repeated(spoken(30, 524), 3, 4) },
    size: (o) => panel(o.slots.layers.length * 102 + 40),
    surface: "obsidian",
    render(o, h) {
      const { layers } = o.slots;
      // Each spoken layer adds one rung above the last and keeps the foundation in view.
      const rungs = layers.map((item, i) => `<div class="ge-rung">${svg("rung-art", 82, 102,
        path(`rung-line-${i}`, "M8 101V1M70 101V1M8 50H70"))}${copy(h, `step-${i}`, item)}</div>`).join("");
      return { inner: rungs, timeline: layers.flatMap((item, i) => [
        draw(h, `.ge-rung-line-${i}`, item.at), write(h, `step-${i}`, item),
      ]).join("\n") };
    },
    css: base("rung-layers") + `
      .pro-rung-layers { display:flex;flex-direction:column-reverse;justify-content:center;padding-block:20px; }
      .pro-rung-layers .ge-rung { display:grid;flex:none;height:102px;grid-template-columns:82px 524px;gap:24px;align-items:center; }
      .pro-rung-layers .ge-rung-art { width:82px;height:102px; }`,
  },

  "focus-drains": {
    variantOf: "capacity-drain",
    family: "warning",
    tags: ["warning", "list"],
    source: source("whiteboard/idea-5"),
    slots: { resource: spoken(30, 656, 40, 1), drains: repeated(spoken(38, 584), 2, 4) },
    size: (o) => panel(112 + o.slots.drains.length * 104),
    surface: "obsidian",
    render(o, h) {
      const [resource] = o.slots.resource, { drains } = o.slots;
      const outline = path("battery-outline", "M4 6H626V16H652V36H626V46H4Z");
      // A block stands for each named drain. They are unnumbered markers for the list, with no measured scale.
      const cells = drains.map((_, i) => `<rect class="ge-cell ge-cell-${i}" x="${14 + i * (602 / drains.length)}" y="15" width="${602 / drains.length - 10}" height="22" rx="3"/>`).join("");
      const rows = drains.map((item, i) => `<div class="ge-drain-row">${svg("drain-art", 40, 28, path(`drain-mark-${i}`, "M4 6H36M16 12l4 10 4-10"))}${copy(h, `drain-${i}`, item)}</div>`).join("");
      const inner = copy(h, "resource", resource) + svg("battery", 656, 52, outline + cells) + rows;
      return {
        inner, timeline: [write(h, "resource", resource), draw(h, ".ge-battery-outline", resource.at),
          appear(h, ".ge-cell", resource.at), ...drains.flatMap((item, i) => [
            write(h, `drain-${i}`, item), draw(h, `.ge-drain-mark-${i}`, item.at),
            state(h, `.ge-cell-${drains.length - 1 - i}`, { fill: gold }, { fill: rule }, item.at),
          ])].join("\n"),
      };
    },
    css: base("focus-drains") + `
      .pro-focus-drains { display:grid;align-content:start;padding-block:6px; }
      .pro-focus-drains .ge-resource { color:${gold}; }
      .pro-focus-drains .ge-battery { width:656px;height:52px; }
      .pro-focus-drains .ge-cell { opacity:0;fill:${gold};stroke:none; }
      .pro-focus-drains .ge-drain-row { display:grid;grid-template-columns:40px 584px;gap:16px;align-items:center;min-height:104px;border-top:2px solid ${rule}; }
      .pro-focus-drains .ge-drain-art { width:40px;height:28px; }`,
  },

  "ingredient-pull": {
    variantOf: "formula",
    hint: procedure.formula.hint,
    family: "procedure",
    tags: ["rule", "flow"],
    source: source("whiteboard/idea-8"),
    slots: { parts: repeated(spoken(28, 504, 40, 1), 2, 3), result: spoken(44, 584) },
    size: (o) => panel(190 + o.slots.parts.length * 60),
    surface: "obsidian",
    render(o, h) {
      const { parts, result: [result] } = o.slots;
      const height = parts.length * 60 + 32;
      const field = parts.map((_, i) => path("pull-ray", `M6 ${i * 60 + 30}Q112 ${i * 60 + 30} 121 ${height - 9}`)).join("") +
        path("pull-tip", `M108 ${height - 20}l13 13 12-13`);
      const inner = `<div class="ge-parts">${parts.map((item, i) => copy(h, `part-${i}`, item)).join("")}
        ${svg("field", 144, height, field)}</div><div class="ge-result-box">${copy(h, "result", result)}</div>`;
      return { inner, timeline: [
        ...parts.map((item, i) => write(h, `part-${i}`, item)),
        draw(h, ".ge-field path", result.at), write(h, "result", result),
        state(h, ".ge-result-box", { borderColor: rule }, { borderColor: gold }, result.at),
      ].join("\n") };
    },
    css: base("ingredient-pull") + `
      .pro-ingredient-pull .ge-parts { position:relative;padding-bottom:32px; }
      .pro-ingredient-pull .ge-parts .ge-copy { width:504px;height:60px;display:grid;align-content:center;border-bottom:2px solid ${rule}; }
      .pro-ingredient-pull .ge-field { position:absolute;right:0;top:0;width:144px;height:100%; }
      .pro-ingredient-pull .ge-result-box { border:2px solid ${rule};border-radius:8px;color:${gold};padding:9px 34px; }`,
  },

  "tracking-trend": {
    variantOf: "trend-points",
    hint: proof["trend-points"].hint,
    family: "proof",
    tags: ["chart", "number"],
    source: source("data-story/idea-2"),
    slots: {
      samples: repeated(spoken(24, 656, 96, 2,
        (text, slots) => !!amount(text) && proof["trend-points"].slots.samples.validate(text, slots)), 3, 4),
      context: optional(spoken(32, 656, 40, 1)),
    },
    size: (o) => panel(200 + Math.max(...o.slots.samples.map((item) => lines(item, 106))) + (o.slots.context.length ? 56 : 0)),
    surface: "obsidian",
    render(o, h) {
      const { samples, context: [context] } = o.slots;
      const values = samples.map(({ text }) => amount(text).value);
      const maximum = Math.max(...values) || 1;
      const points = values.map((value, i) => [h.at(26 + i * 604 / (values.length - 1)), h.at(130 - 108 * value / maximum)]);
      const segments = points.slice(1).map(([x, y], i) => path(`segment-${i + 1}`, `M${points[i].join(" ")}L${x} ${y}`));
      const dots = points.map(([x, y], i) => `<circle class="ge-point ge-point-${i}" cx="${x}" cy="${y}" r="8"/>`);
      const plot = svg("trend", 656, 146, '<path class="ge-axis" d="M12 10V130H644"/>' + segments.join("") + dots.join(""));
      const ledger = samples.map((item, i) => `<div class="ge-reading ge-reading-${i}">${copy(h, `sample-${i}`, item)}</div>`).join("");
      const inner = `<div class="ge-readings" style="height:${Math.max(...samples.map((item) => lines(item, 106)))}px">${ledger}</div>` + plot +
        (context ? copy(h, "context", context) : "");
      const timeline = samples.flatMap((item, i) => [
        ...(i ? [`tl.set(${h.sel(`.ge-reading-${i - 1}`)},{visibility:"hidden"},${item.at});`,
          draw(h, `.ge-segment-${i}`, item.at),
          state(h, `.ge-point-${i - 1}`, { fill: gold }, { fill: grey }, item.at)] : []),
        write(h, `sample-${i}`, item),
        appear(h, `.ge-point-${i}`, item.at),
      ]);
      if (context) timeline.push(write(h, "context", context));
      return { inner, timeline: timeline.join("\n") };
    },
    css: base("tracking-trend") + `
      .pro-tracking-trend { display:grid;align-content:start;gap:8px;padding-block:19px; }
      .pro-tracking-trend .ge-readings { display:grid;grid-template-columns:minmax(0,1fr);align-items:end; }
      .pro-tracking-trend .ge-reading { grid-area:1/1; }
      .pro-tracking-trend .ge-reading .ge-copy { font:400 96px/106px "Anton",sans-serif;color:${gold}; }
      .pro-tracking-trend .ge-trend { width:656px;height:146px; }
      .pro-tracking-trend .ge-axis { stroke:${rule}; }
      .pro-tracking-trend .ge-point { fill:${gold};stroke:${ink};opacity:0; }`,
  },

  "bar-to-cells": {
    variantOf: "percent-ring",
    hint: procedure["percent-ring"].hint,
    family: "proof",
    tags: ["percent", "chart"],
    source: source("data-story/idea-3"),
    slots: {
      value: spoken(26, 656, 96, 2, (text) => amount(text)?.unit === "percent"),
      context: spoken(46, 656),
    },
    size: (o) => panel(210 + lines(o.slots.value[0], 106) + lines(o.slots.context[0])),
    surface: "obsidian",
    render(o, h) {
      const [value] = o.slots.value, [context] = o.slots.context, share = amount(value.text).value;
      const art = [], moves = [];
      // The same geometry forms the bar and the grid. The fractional cell keeps decimals exact.
      function cell(i, fill, role) {
        const name = `ge-unit-${i}-${role}`;
        const from = { x: h.at(8 + i * 6.4), y: 56, width: h.at(6.4 * fill), height: 30 };
        const to = { x: 8 + (i % 10) * 64, y: Math.floor(i / 10) * 14 + 2, width: h.at(57 * fill), height: 10 };
        art.push(`<rect class="${name} ge-cell-${role}" x="${from.x}" y="${from.y}" width="${from.width}" height="${from.height}"/>`);
        moves.push(state(h, `.${name}`, { attr: from }, { attr: to }, context.at));
      }
      for (let i = 0; i < 100; i++) {
        const portion = Math.max(0, Math.min(1, share - i));
        if (portion < 1) cell(i, 1, "track");
        if (portion > 0) cell(i, portion, "fill");
      }
      const inner = copy(h, "value", value) + svg("units", 656, 144, art.join("")) + copy(h, "context", context);
      return { inner, timeline: [
        write(h, "value", value), appear(h, ".ge-units", value.at), write(h, "context", context), ...moves,
      ].join("\n") };
    },
    css: base("bar-to-cells") + `
      .pro-bar-to-cells { display:grid;align-content:center;gap:9px; }
      .pro-bar-to-cells .ge-value { font:400 96px/106px "Anton",sans-serif;color:${gold}; }
      .pro-bar-to-cells .ge-units { width:656px;height:144px;opacity:0;stroke:none; }
      .pro-bar-to-cells .ge-cell-track { fill:${rule}; }
      .pro-bar-to-cells .ge-cell-fill { fill:${gold}; }`,
  },

  "work-block-split": {
    family: "proof",
    tags: ["time", "chart", "list"],
    hint: "Greg states the total duration of a sales work block, then divides all of it into two to four activities, saying each whole-minute or whole-hour duration before the activity in the same spoken range",
    source: source("data-story/day-unit-chart", "whiteboard/day-box"),
    slots: {
      total: spoken(24, 656, 96, 2, (text) => minutes(text) !== null),
      blocks: repeated(spoken(38, 620, 40, 1, (text, slots) => {
        const value = minutes(text, true);
        const used = slots.blocks.reduce((sum, item) => sum + minutes(item.text, true), 0);
        return value !== null && used + value <= minutes(slots.total[0].text);
      }), 2, 4),
    },
    validate({ total: [total], blocks }) {
      const available = minutes(total.text);
      const values = blocks.map((item) => minutes(item.text, true));
      return values.reduce((sum, value) => sum + value, 0) === available && available / values.reduce(commonUnit) <= 30;
    },
    size: (o) => panel(122 + lines(o.slots.total[0], 106) + 54 * o.slots.blocks.length),
    surface: "obsidian",
    render(o, h) {
      const { total: [total], blocks } = o.slots;
      const values = blocks.map((item) => minutes(item.text, true));
      const unit = values.reduce(commonUnit);
      const totalCells = minutes(total.text) / unit;
      const cellWidth = (652 - (totalCells - 1) * 4 - (blocks.length - 1) * 12) / totalCells;
      let x = 2;
      // The largest shared unit keeps the grid exact even when the time ranges use different units.
      const cellGroups = values.map((value, i) => {
        const cells = Array.from({ length: value / unit }, () => {
          const rect = `<rect x="${h.at(x)}" y="3" width="${h.at(cellWidth)}" height="40" rx="2"/>`;
          x += cellWidth + 4;
          return rect;
        }).join("");
        x += 12;
        return `<g class="ge-units-${i}">${cells}</g>`;
      });
      const chart = svg("allocation", 656, 46, cellGroups.join(""));
      const rows = blocks.map((item, i) => `<div class="ge-block ge-block-${i}">${copy(h, `block-copy-${i}`, item)}</div>`).join("");
      return {
        inner: copy(h, "total", total) + chart + rows,
        timeline: [write(h, "total", total), appear(h, ".ge-allocation", total.at),
          ...blocks.flatMap((item, i) => [
            write(h, `block-copy-${i}`, item),
            state(h, `.ge-units-${i} rect`, { fill: rule }, { fill: gold }, item.at),
            state(h, `.ge-block-${i}`, { borderColor: rule }, { borderColor: gold }, item.at),
          ])].join("\n"),
      };
    },
    css: base("work-block-split") + `
      .pro-work-block-split { display:grid;align-content:center; }
      .pro-work-block-split .ge-total { font:400 96px/106px "Anton",sans-serif;color:${gold}; }
      .pro-work-block-split .ge-allocation { opacity:0;stroke:none;fill:${rule};width:656px;height:46px;margin-block:8px 12px; }
      .pro-work-block-split .ge-block { height:54px;display:flex;align-items:center;padding-left:14px;border-left:4px solid ${rule}; }`,
  },

  "alert-extract": {
    variantOf: "alert-stack",
    hint: overview["alert-stack"].hint,
    family: "conversation",
    tags: ["message", "conversation"],
    source: source("hologram-hud/notifications-pull-out"),
    slots: Object.fromEntries([1, 2, 3].flatMap((i) => [
      [`title${i}`, spoken(25, 548, 40, 1)], [`message${i}`, spoken(30, 548, 40, 1)],
    ])),
    size: panel(425),
    surface: "obsidian",
    render(o, h) {
      const sketch = path("socket", "M38 3H4V75H38m-14-53h14m-14 35h14");
      const alerts = [1, 2, 3].map((i) => ({ i, title: o.slots[`title${i}`][0], body: o.slots[`message${i}`][0] }));
      const rows = alerts.map(({ i, title, body }) =>
        `<div class="ge-alert-row">${svg(`socket-${i}`, 48, 78, sketch)}
          <div class="ge-alert ge-alert-${i}">${copy(h, `title-${i}`, title)}${copy(h, `message-${i}`, body)}</div></div>`).join("");
      return { inner: label("Notifications") + rows, timeline: alerts.flatMap(({ i, title, body }) => [
        draw(h, `.ge-socket-${i} path`, title.at),
        appear(h, `.ge-alert-${i}`, title.at, { x: -14 }, { x: 0 }),
        write(h, `title-${i}`, title), write(h, `message-${i}`, body),
      ]).join("\n") };
    },
    css: base("alert-extract") + `
      .pro-alert-extract .ge-label { color:${gold};margin-bottom:5px; }
      .pro-alert-extract .ge-alert-row { display:grid;grid-template-columns:48px 588px;gap:16px;align-items:center;height:112px; }
      .pro-alert-extract .ge-alert-row .ge-art { width:48px;height:78px; }
      .pro-alert-extract .ge-alert { opacity:0;border:2px solid ${rule};border-left:4px solid ${gold};border-radius:8px;padding:3px 16px; }
      .pro-alert-extract .ge-alert .ge-copy:first-child { color:${gold}; }`,
  },

  "dock-checklist": {
    variantOf: "checklist",
    hint: procedure.checklist.hint,
    family: "procedure",
    tags: ["checklist", "list"],
    source: source("hologram-hud/basics-turntable"),
    slots: { heading, items: repeated(spoken(44, 516), 2, 4) },
    size: (o) => panel(36 + (o.slots.heading.length ? 42 : 0) + 116 * o.slots.items.length),
    surface: "obsidian",
    render(o, h) {
      const { items, heading: [title] } = o.slots;
      const row = (item, i) => `<div class="ge-dock-row ge-dock-${i}">${copy(h, `item-${i}`, item)}${svg(`control-${i}`, 96, 42,
        '<rect class="ge-track" x="3" y="4" width="90" height="34" rx="17"/><circle class="ge-knob" cx="42" cy="21" r="13"/>' +
        path("lock-corners", "M3 13V4H17m62 0h14v9m0 16v9H79m-62 0H3v-9"))}</div>`;
      const inner = (title ? label(h.copy(title)) : "") + items.map(row).join("");
      const timeline = items.flatMap((item, i) => [
        appear(h, `.ge-dock-${i}`, item.at, { y: 12 }, { y: 0 }),
        write(h, `item-${i}`, item),
        draw(h, `.ge-control-${i} .ge-lock-corners`, item.at),
        state(h, `.ge-control-${i} .ge-knob`, { attr: { cx: 42 }, fill: grey }, { attr: { cx: 56 }, fill: gold }, item.at),
      ]);
      return { inner, timeline: timeline.join("\n") };
    },
    css: base("dock-checklist") + `
      .pro-dock-checklist { padding-block:18px; }
      .pro-dock-checklist .ge-label { margin-bottom:6px;color:${gold}; }
      .pro-dock-checklist .ge-dock-row { height:116px;display:grid;grid-template-columns:516px 96px;gap:12px;align-items:center;padding:0 14px;border:2px solid ${rule};border-bottom:0;opacity:0; }
      .pro-dock-checklist .ge-dock-row:last-child { border-bottom:2px solid ${rule}; }
      .pro-dock-checklist .ge-dock-row .ge-art { width:96px;height:42px; }
      .pro-dock-checklist .ge-track { fill:${rule};stroke:none; }
      .pro-dock-checklist .ge-knob { fill:${grey};stroke:none; }`,
  },

  "scan-replace": {
    variantOf: "case-study",
    hint: proofBase["case-study"].hint,
    family: "proof",
    tags: ["before-after", "number"],
    source: source("hologram-hud/erase-and-fill", "hologram-hud/idea-7"),
    slots: {
      // The readings stand alone until the later spoken metric name, so require a unit in both.
      before: spoken(24, 604, 96, 1, (text) => hasMetricUnit(text) && caseValue.before.validate(text)),
      after: spoken(24, 604, 96, 1, (text, slots) => hasMetricUnit(text) && caseValue.after.validate(text, slots)),
      label: spoken(32, 656, 40, 1),
    },
    size: panel(440),
    surface: "obsidian",
    render(o, h) {
      const [before] = o.slots.before, [after] = o.slots.after;
      const [metric] = o.slots.label;
      const scan = '<rect class="ge-scan-frame" x="4" y="4" width="644" height="152" rx="8"/><path class="ge-scan-beam" d="M4 5H648"/>';
      const inner = `<div class="ge-version ge-prior">${label("Before")}${copy(h, "before", before)}${svg("frame", 652, 160, scan)}</div>
        <div class="ge-version ge-revision">${label("After")}${copy(h, "after", after)}${svg("frame", 652, 160, scan)}</div>${copy(h, "metric", metric)}`;
      return { inner, timeline: [
        write(h, "before", before),
        state(h, ".ge-prior .ge-scan-frame", { clipPath: open }, { clipPath: "inset(100% 0 0 0)" }, after.at),
        state(h, ".ge-before", { color: bone }, { color: grey }, after.at),
        write(h, "after", after, "inset(0 0 100% 0)"),
        state(h, ".ge-revision .ge-scan-frame", { clipPath: "inset(0 0 100% 0)" }, { clipPath: open }, after.at),
        state(h, ".ge-scan-beam", { opacity: 1, attr: { d: "M4 5H648" } },
          { opacity: 0, attr: { d: "M4 155H648" } }, after.at),
        write(h, "metric", metric),
      ].join("\n") };
    },
    css: base("scan-replace") + `
      .pro-scan-replace { display:grid;grid-template-rows:160px 160px 48px;gap:12px; }
      .pro-scan-replace .ge-version { position:relative;padding:4px 26px;display:grid;align-content:center;gap:2px; }
      .pro-scan-replace .ge-version .ge-copy { font:400 96px/106px "Anton",sans-serif; }
      .pro-scan-replace .ge-frame { position:absolute;top:0;left:2px;width:652px;height:160px; }
      .pro-scan-replace .ge-prior .ge-scan-frame { stroke:${grey}; }
      .pro-scan-replace .ge-revision .ge-scan-frame { clip-path:inset(0 0 100% 0); }
      .pro-scan-replace .ge-scan-beam { opacity:0; }
      .pro-scan-replace .ge-after,.pro-scan-replace .ge-revision .ge-label { color:${gold}; }`,
  },
};
