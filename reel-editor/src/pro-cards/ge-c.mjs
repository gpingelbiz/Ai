// Adapted from ghost-editor (MIT, copyright 2026 kurbaitaev). See src/pro-cards/GHOST-EDITOR-LICENSE.md.
import { CARDS as herk } from "./herk-vstat.mjs";

const source = (...ids) => ids.map((id) => `ghost-editor:result-podcast/${id}`).join(",");
const box = (h) => ({ w: 720, h });
const digitHeight = 104;
const linesIn = (o, slot) => o.slots[slot][0].lines.length;

// Match the registry's Inter estimates so grounding cannot shrink the body copy.
const interWidth = (text, size) => [...text].reduce((width, ch) => width +
  (/\s/.test(ch) ? 0.3 : /[ilI.,!'’]/.test(ch) ? 0.32 : /[MW@]/.test(ch) ? 0.95 : /[A-Z]/.test(ch) ? 0.75 : 0.65) * size, 0);

// Anton's narrower advances let long spoken numbers retain a 96 px headline.
const antonAdvances = { " ": 0.25, m: 0.78, w: 0.72, M: 0.78, W: 0.74, "%": 1.08,
  i: 0.26, l: 0.27, t: 0.32, f: 0.30, r: 0.37, v: 0.48, y: 0.48, e: 0.50, s: 0.49,
  1: 0.35, "-": 0.33, "−": 0.33, ".": 0.25, ",": 0.25 };
const antonWidth = (text) => [...text].reduce((width, ch) => width + 96 * (antonAdvances[ch] ?? 0.52), 0);

function wrap(text, width, maxLines, measure) {
  const lines = [];
  for (const word of text.trim().split(/\s+/)) {
    if (!word || measure(word) > width) return null;
    const last = lines.at(-1);
    const joined = `${last} ${word}`;
    if (last && measure(joined) <= width) lines[lines.length - 1] = joined;
    else lines.push(word);
  }
  return lines.length <= maxLines ? lines : null;
}

function spoken(maxChars, width, size = 40, maxLines = 2) {
  return {
    kind: "spoken", maxChars, width, size, maxLines,
    validate: (text) => !/[\p{Emoji_Presentation}\uFE0F]/u.test(text) &&
      !!wrap(text, width, maxLines, (line) => interWidth(line, size)),
  };
}

const repeated = (slot, min, max) => ({ ...slot, repeat: [min, max] });
const optional = (slot) => ({ ...slot, optional: true });
const heading = { kind: "label", optional: true, maxChars: 30, width: 624, size: 28, maxLines: 1 };
const fixedHeading = (title) => (slots) => !slots.heading[0] || slots.heading[0].text === title;

function numberSlot(width, validate, maxLines = 2) {
  return {
    // Give the generic Inter fitter room for long number words. The Anton check and renderer share the display width.
    kind: "spoken", width: Math.max(624, width), size: 96, maxChars: 32, maxLines,
    validate: (text, slots) => validate(text, slots) && !!wrap(text, width - 6, maxLines, antonWidth),
  };
}

const amount = herk["qualified-stat"].slots.value.validate;
const dollars = (text) => /^(?:\$)|\bdollars?[.,!?]?$/i.test(text) && amount(text);

function tween(h, selector, from, to, at, motion = "enter") {
  const ease = motion === "enter" ? "proEnter" : "proState";
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion[motion]},ease:${ease},immediateRender:false},${h.at(at)});`;
}

function write(h, name, item, clipPath = "inset(0 100% 0 0)", travel = {}) {
  const end = Object.fromEntries(Object.keys(travel).map((axis) => [axis, 0]));
  return tween(h, `.ge-${name}`, { opacity: 0, clipPath, ...travel },
    { opacity: 1, clipPath: "inset(0 0 0 0)", ...end }, item.at);
}

const enter = (h, selector, at, from = {}, to = {}) => tween(h, selector, { opacity: 0, ...from }, { opacity: 1, ...to }, at);
const state = (h, selector, from, to, at) => tween(h, selector, from, to, at, "state");
const draw = (h, selector, at) => state(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at);
const down = "inset(0 0 100% 0)";
const up = "inset(100% 0 0 0)";
const label = (text) => `<div class="ge-label">${text}</div>`;
const copy = (h, name, item) => `<div class="ge-copy ge-${name}">${h.copy(item)}</div>`;
const svg = (name, viewBox, markup) => `<svg class="ge-${name}" viewBox="${viewBox}" aria-hidden="true">${markup}</svg>`;
const path = (d) => `<path class="ge-draw" pathLength="1" d="${d}"/>`;
const mark = (name, d, viewBox = "0 0 48 48") =>
  `<svg class="ge-${name}" viewBox="${viewBox}" preserveAspectRatio="none" aria-hidden="true">${path(d)}</svg>`;
const arrow = mark("arrow", "M4 24Q19 21 43 24m-11-11 11 11-11 11");
const tick = mark("tick", "M8 25l11 11 21-24");
const quotes = svg("quotes", "0 0 60 42",
  '<path d="M4 23C4 12 10 6 23 3v8c-5 2-8 5-9 10h10v17H4Zm30 0c0-11 6-17 19-20v8c-5 2-8 5-9 10h10v17H34Z"/>');

function numberCopy(h, name, item, width, maxLines = 2) {
  const lines = wrap(item.text, width - 6, maxLines, antonWidth);
  return `<div class="ge-number ge-${name}">${h.copy({ lines })}</div>`;
}

function card(type, { css, ...definition }) {
  const scope = `.pro-${type}`;
  return {
    surface: "obsidian",
    // The registry completeness check expects a hint on every definition. The planner reads the root's cue.
    hint: "Use the root type's cue and exact spoken ranges.",
    ...definition,
    css: `
      ${scope} .ge-copy { font:650 40px/48px "Inter",sans-serif;opacity:0;white-space:nowrap; }
      ${scope} .ge-label { font:750 28px/34px "Inter",sans-serif; }
      ${scope} .ge-draw { fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1; }
      ${css.replaceAll("&", scope)}`,
  };
}

const pairs = [1, 2, 3];
const dealSlots = Object.fromEntries(pairs.flatMap((i) => ["initial", "revised"].map((side) => {
  const slot = spoken(34, 310);
  return [`${side}${i}`, i === 3 ? optional(slot) : slot];
})));

const phone = svg("phone", "0 0 52 52",
  '<path d="M12 5l8 10-5 6c4 8 8 12 16 16l6-5 10 8-3 7c-2 4-9 3-15 0C13 40 5 29 3 15c-1-5 2-8 9-10Z"/>');
const handsetCut = mark("cut", "M6 40 44 8", "0 0 52 52");

const hours = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
const minuteWords = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const minuteTens = new Map([["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50]]);

function clockMinutes(parts) {
  if (!parts.length) return 0;
  const [first, second] = parts;
  if (parts.length === 1) return minuteTens.get(first) ?? minuteWords.indexOf(first);
  const ones = minuteWords.indexOf(second);
  const tens = first === "oh" || first === "zero" ? 0 : minuteTens.get(first);
  return parts.length === 2 && ones > 0 && ones < 10 && tens !== undefined ? tens + ones : -1;
}

// Geometry uses the clock reading. The exact phrase, including any meridiem, remains the copy.
function clockReading(text) {
  const clean = text.toLowerCase().trim().replace(/[,!?]$/, "").replace(/\.$/, "");
  if (clean === "noon" || clean === "midnight") return { hour: 0, minute: 0 };
  const meridiem = /\s*[ap]\.?m\.?$/.exec(clean);
  const raw = clean.slice(0, meridiem?.index ?? clean.length).replace(/\s+o['’]clock$/, "");
  const numeric = /^(\d{1,2})(?::([0-5]\d))?$/.exec(raw);
  if (numeric) {
    const hour = Number(numeric[1]);
    const extendedClock = numeric[2] !== undefined && !meridiem;
    if (extendedClock ? hour > 23 : hour < 1 || hour > 12) return null;
    return { hour: hour % 12, minute: Number(numeric[2] ?? 0) };
  }
  const [hour, ...rest] = raw.split(/[\s-]+/);
  const index = hours.indexOf(hour);
  const minute = clockMinutes(rest);
  return index >= 0 && minute >= 0 ? { hour: index, minute } : null;
}

function clockTip(turn, length) {
  const radians = turn * 2 * Math.PI;
  return { x2: 38 + length * Math.sin(radians), y2: 38 - length * Math.cos(radians) };
}

export const CARDS = {
  "buyer-motive": card("buyer-motive", {
    family: "payoff",
    tags: ["callout", "flow"],
    hint: "Greg identifies a buyer's specific need or motive and then explicitly names the behavior it drives in that buyer",
    source: source("lined-index-card-columns"),
    slots: { motive: spoken(44, 310, 40, 3), behavior: spoken(44, 310, 40, 3) },
    size: (o) => box(100 + 48 * Math.max(linesIn(o, "motive"), linesIn(o, "behavior"))),
    surface: "bone",
    render(o, h) {
      const [motive] = o.slots.motive, [behavior] = o.slots.behavior;
      const inner = `<div class="ge-column">${label("Buyer motive")}${copy(h, "motive", motive)}</div>${arrow}<div class="ge-column ge-outcome">${label("Buyer behavior")}${copy(h, "behavior", behavior)}</div>`;
      return { inner, timeline: [
        write(h, "motive", motive), draw(h, ".ge-arrow path", behavior.at), write(h, "behavior", behavior),
      ].join("\n") };
    },
    css: `
      & { display:grid;grid-template-columns:310px 44px 310px;gap:6px;align-content:center;padding:20px; }
      & .ge-column { border-top:4px solid #A8A49C;padding-top:8px; }
      & .ge-outcome { border-color:#C8A24B; }
      & .ge-label { margin-bottom:8px;color:#343438; }
      & .ge-arrow { width:40px;height:40px;margin-top:55px; }`,
  }),

  "price-revision": card("price-revision", {
    family: "distinction",
    tags: ["money", "before-after", "comparison"],
    hint: "Greg says one exact asking price and then the different dollar price replacing it for the same offer",
    source: source("kraft-hang-tag"),
    slots: { original: numberSlot(608, dollars), revised: numberSlot(608, dollars) },
    validate: (slots) => slots.original[0].text.toLowerCase() !== slots.revised[0].text.toLowerCase(),
    size: (o) => box(128 + digitHeight * ["original", "revised"].reduce((n, name) =>
      n + wrap(o.slots[name][0].text, 602, 2, antonWidth).length, 0)),
    surface: "bone",
    render(o, h) {
      const [original] = o.slots.original, [revised] = o.slots.revised;
      const strike = mark("strike", "M4 13 Q305 19 604 6", "0 0 608 24");
      const lines = wrap(original.text, 602, 2, antonWidth).map((line) => `<span class="ge-price-line">${h.esc(line)}${strike}</span>`);
      const inner = `<div class="ge-tag ge-old-tag">${label("Original price")}<div class="ge-number ge-original">${lines.join("")}</div></div>
        <div class="ge-tag ge-new-tag">${label("Revised price")}${numberCopy(h, "revised", revised, 608)}</div>`;
      return { inner, timeline: [
        write(h, "original", original), draw(h, ".ge-strike path", revised.at),
        enter(h, ".ge-new-tag", revised.at, { y: -12 }, { y: 0 }), write(h, "revised", revised),
      ].join("\n") };
    },
    css: `
      & { display:grid;align-content:center;gap:8px;padding:12px 22px; }
      & .ge-tag { position:relative;padding:6px 18px 6px 48px; }
      & .ge-tag::before { content:"";position:absolute;left:16px;top:17px;width:12px;height:12px;border:3px solid #0B0B0D;border-radius:50%; }
      & .ge-old-tag { border-bottom:2px solid #A8A49C; }
      & .ge-price-line { position:relative;display:table; }
      & .ge-strike { position:absolute;left:0;top:calc(50% - 12px);width:100%;height:24px; }
      & .ge-new-tag { width:100%;background:#C8A24B;opacity:0; }
      & .ge-number { font:400 96px/104px "Anton",sans-serif;opacity:0;white-space:nowrap; }`,
  }),

  "habits-to-cut": card("habits-to-cut", {
    family: "warning",
    tags: ["warning", "list"],
    hint: "Greg explicitly tells reps to stop two to four distinct recurring sales habits, naming each behavior he wants cut",
    source: source("breaker-panel-tape-labels"),
    slots: { habits: repeated(spoken(43, 546), 2, 4) },
    size: (o) => box(70 + o.slots.habits.length * 108),
    render(o, h) {
      const items = o.slots.habits;
      const inner = label("Habits to cut") + items.map((item, i) => `<div class="ge-breaker ge-breaker-${i}">${copy(h, `habits-${i}`, item)}
        ${svg("breaker", "0 0 54 78", '<rect x="4" y="3" width="46" height="72" rx="6"/><path class="ge-lever" d="M12 17h30v15H12Z"/>')}</div>`).join("");
      return { inner, timeline: items.flatMap((item, i) => [
        write(h, `habits-${i}`, item),
        state(h, `.ge-breaker-${i} .ge-lever`, { y: 0, fill: "#A8A49C" }, { y: 30, fill: "#C8A24B" }, item.at),
      ]).join("\n") };
    },
    css: `
      & { padding:18px 26px; }
      & .ge-label { margin-bottom:8px;color:#C8A24B; }
      & .ge-breaker { min-height:108px;display:grid;grid-template-columns:1fr 54px;gap:16px;align-items:center;border-top:2px solid #343438; }
      & .ge-breaker svg { width:54px;height:78px; }
      & .ge-breaker rect { fill:#0B0B0D;stroke:#343438;stroke-width:3; }
      & .ge-lever { fill:#A8A49C; }`,
  }),

  "capacity-drain": card("capacity-drain", {
    family: "warning",
    tags: ["warning", "steps"],
    hint: "Greg describes two to four successive parts of a sales day or call that cumulatively drain the same named resource, such as focus, energy or time",
    source: source("sticky-battery-drain"),
    slots: { resource: spoken(34, 540, 44, 1), drains: repeated(spoken(40, 612, 40, 1), 2, 4) },
    size: (o) => box(78 + o.slots.drains.length * 58),
    render(o, h) {
      const [resource] = o.slots.resource, { drains } = o.slots;
      // The disappearing marks track the named events rather than measuring capacity.
      const battery = svg("battery", "0 0 104 46",
        '<path class="ge-shell" d="M2 4h90v38H2V4Zm90 11h10v16H92"/>' +
        drains.map((_, i) => `<rect class="ge-cell-${i}" x="${78 - i * 18}" y="12" width="10" height="22" rx="2"/>`).join(""));
      const inner = `<div class="ge-resource-row">${copy(h, "resource", resource)}${battery}</div>` +
        drains.map((item, i) => `<div class="ge-drain ge-drain-${i}">${mark("dash", "M9 24h28")}${copy(h, `drains-${i}`, item)}</div>`).join("");
      return { inner, timeline: [write(h, "resource", resource), ...drains.flatMap((item, i) => [
        write(h, `drains-${i}`, item), draw(h, `.ge-drain-${i} .ge-dash path`, item.at),
        state(h, `.ge-cell-${i}`, { opacity: 1 }, { opacity: 0 }, item.at),
      ])].join("\n") };
    },
    css: `
      & { padding:12px 20px; }
      & .ge-resource-row { display:flex;justify-content:space-between;align-items:center;height:54px; }
      & .ge-resource { font-size:44px;line-height:52px;color:#C8A24B; }
      & .ge-battery { width:104px;height:46px;flex:none; }
      & .ge-shell { fill:none;stroke:#A8A49C;stroke-width:3;stroke-linejoin:round; }
      & .ge-battery rect { fill:#C8A24B; }
      & .ge-drain { display:grid;grid-template-columns:44px 1fr;gap:12px;align-items:center;height:58px;border-top:2px solid #343438; }
      & .ge-dash { width:40px;height:40px; }`,
  }),

  "coaching-findings": card("coaching-findings", {
    family: "proof",
    tags: ["list", "callout"],
    hint: "Greg names a specific sales or coaching change his team tested, then reports two or three distinct things they actually observed in that test",
    source: source("ticket-stub-study"),
    slots: { test: spoken(38, 548, 44), findings: repeated(spoken(44, 548), 2, 3) },
    size: (o) => box(96 + 52 * linesIn(o, "test") + o.slots.findings.length * 112),
    surface: "bone",
    render(o, h) {
      const [test] = o.slots.test, { findings } = o.slots;
      const inner = `<div class="ge-ticket"><div class="ge-ticket-stub" aria-hidden="true"></div><div class="ge-findings">
        ${label("What we tested")}${copy(h, "test", test)}
        ${findings.map((item, i) => `<div class="ge-finding ge-finding-${i}">${tick}${copy(h, `findings-${i}`, item)}</div>`).join("")}</div></div>`;
      return { inner, timeline: [write(h, "test", test), ...findings.flatMap((item, i) => [
        write(h, `findings-${i}`, item), draw(h, `.ge-finding-${i} .ge-tick path`, item.at),
      ])].join("\n") };
    },
    css: `
      & { display:grid;align-content:center;padding:18px 20px; }
      & .ge-ticket { display:grid;grid-template-columns:46px 1fr;border:2px solid #0B0B0D; }
      & .ge-ticket-stub { background:#C8A24B;border-right:3px dashed #0B0B0D; }
      & .ge-findings { padding:8px 12px; }
      & .ge-label { margin:0 0 2px 48px;color:#343438; }
      & .ge-test { margin-left:48px;font-size:44px;line-height:52px; }
      & .ge-finding { display:grid;grid-template-columns:38px 1fr;gap:10px;align-items:center;min-height:112px;border-top:2px solid #A8A49C; }
      & .ge-tick { width:38px;height:38px; }`,
  }),

  "typed-pullquote": card("typed-pullquote", {
    variantOf: "quote",
    family: "payoff",
    tags: ["quote", "highlight"],
    source: source("typewriter-quote-cards-navy", "aged-letter-quote-words", "quote-word-by-word"),
    slots: { quote: spoken(92, 620, 48, 4) },
    size: (o) => box(90 + o.slots.quote[0].lines.length * 58),
    surface: "bone",
    render(o, h) {
      const [quote] = o.slots.quote;
      // The slot has one cue. Print its exact characters as a single 233 ms pass at the first word.
      const print = quote.lines.map((line) => [...line].map((char) =>
        char === " " ? char : `<span class="ge-glyph">${h.esc(char)}</span>`).join("")).join("<br>");
      const inner = `${quotes}<div class="ge-print"><div class="ge-copy ge-quote">${print}</div></div>`;
      return { inner, timeline: [
        write(h, "quote", quote),
        `tl.fromTo(${h.sel(".ge-glyph")},{opacity:0},{opacity:1,duration:0,ease:proEnter,stagger:{amount:${h.motion.enter},ease:proEnter},immediateRender:false},${h.at(quote.at)});`,
      ].join("\n") };
    },
    css: `
      & { padding:18px 28px;display:grid;align-content:center;gap:8px; }
      & .ge-quotes { width:44px;height:32px;fill:#0B0B0D; }
      & .ge-print { position:relative;padding:0 10px 0 16px;border-left:4px solid #C8A24B; }
      & .ge-quote { font-size:48px;line-height:58px; }
      & .ge-glyph { opacity:0; }`,
  }),

  "spoken-title-landing": card("spoken-title-landing", {
    variantOf: "stacked-title",
    family: "emphasis",
    tags: ["title", "highlight"],
    source: source("navy-quote-card-word-land", "navy-text-card"),
    slots: { lines: repeated(spoken(24, 648, 56, 1), 3, 4) },
    size: (o) => box(102 + o.slots.lines.length * 50),
    render(o, h) {
      const { lines } = o.slots;
      const inner = `${quotes}<div class="ge-title-stack">${lines.map((item, i) => copy(h, `lines-${i}`, item)).join("")}</div>`;
      return { inner, timeline: lines.map((item, i) =>
        write(h, `lines-${i}`, item, i === lines.length - 1 ? up : "inset(0 100% 0 0)", { y: 8 })).join("\n") };
    },
    css: `
      & { padding:18px 32px;display:grid;align-content:center;gap:12px; }
      & .ge-quotes { width:42px;height:30px;fill:#C8A24B; }
      & .ge-title-stack>.ge-copy { font:650 40px/50px "Inter",sans-serif; }
      & .ge-title-stack>.ge-copy:last-child { padding-top:6px;border-top:2px solid #343438;font:400 56px/66px "Anton",sans-serif;color:#C8A24B; }`,
  }),

  "ruled-checks": card("ruled-checks", {
    variantOf: "checklist",
    family: "procedure",
    tags: ["checklist", "list"],
    source: source("checklist-four-ticks", "notebook-todo"),
    slots: { heading, items: repeated(spoken(44, 580), 2, 4) },
    validate: fixedHeading("Checklist"),
    size: (o) => box(70 + o.slots.items.length * 108),
    surface: "bone",
    render(o, h) {
      const { items } = o.slots;
      const inner = label("Checklist") + items.map((item, i) => `<div class="ge-check-row ge-check-row-${i}">${copy(h, `items-${i}`, item)}<div class="ge-box">${tick}</div></div>`).join("");
      return { inner, timeline: items.flatMap((item, i) => [
        write(h, `items-${i}`, item), draw(h, `.ge-check-row-${i} .ge-tick path`, item.at),
      ]).join("\n") };
    },
    css: `
      & { padding:18px 24px 18px 34px;border-left:5px solid #C8A24B; }
      & .ge-label { margin-bottom:8px;color:#343438; }
      & .ge-check-row { display:grid;grid-template-columns:1fr 46px;gap:16px;align-items:center;min-height:108px;border-top:2px solid #A8A49C; }
      & .ge-box { width:44px;height:44px;border:2px solid #343438; }
      & .ge-tick { display:block;width:40px;height:40px; }
      & .ge-tick path { stroke:#343438; }`,
  }),

  "pinned-method-board": card("pinned-method-board", {
    variantOf: "topic-chip-grid",
    family: "emphasis",
    tags: ["list", "highlight"],
    source: source("cork-sticky-notes-fall"),
    slots: { items: repeated(spoken(34, 304), 2, 4) },
    size: (o) => box(32 + Math.ceil(o.slots.items.length / 2) * 160),
    render(o, h) {
      const { items } = o.slots;
      return {
        inner: items.map((item, i) => `<div class="ge-note ge-note-${i}"><div class="ge-pin" aria-hidden="true"></div>${copy(h, `items-${i}`, item)}</div>`).join(""),
        timeline: items.flatMap((item, i) => [
          enter(h, `.ge-note-${i}`, item.at, { y: -14 }, { y: 0 }),
          enter(h, `.ge-note-${i} .ge-pin`, item.at, { scale: 0.75 }, { scale: 1 }),
          write(h, `items-${i}`, item),
        ]).join("\n"),
      };
    },
    css: `
      & { display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:148px;gap:12px;align-content:center;padding:20px; }
      & .ge-note { position:relative;align-self:start;height:136px;opacity:0;padding:32px 12px 8px;background:#F5F1E8;color:#0B0B0D; }
      & .ge-note:nth-child(even) { align-self:end; }
      & .ge-pin { position:absolute;top:8px;left:calc(50% - 7px);width:14px;height:14px;background:#C8A24B;border:2px solid #0B0B0D;border-radius:50%;opacity:0; }`,
  }),

  "printed-tally": card("printed-tally", {
    variantOf: "receipt",
    family: "warning",
    tags: ["money", "number", "list"],
    source: source("thermal-receipt-print", "hire-ledger-total-zero-stamp"),
    slots: { heading, items: repeated(spoken(36, 596, 40, 1), 2, 3), total: numberSlot(598, amount) },
    validate: fixedHeading("Cost tally"),
    size: (o) => box(120 + 72 * o.slots.items.length +
      digitHeight * wrap(o.slots.total[0].text, 592, 2, antonWidth).length),
    render(o, h) {
      const { items, total: [total] } = o.slots;
      const inner = `${label("Cost tally")}<div class="ge-mouth" aria-hidden="true"></div><div class="ge-receipt">
        ${items.map((item, i) => `<div class="ge-receipt-row">${copy(h, `items-${i}`, item)}</div>`).join("")}
        <div class="ge-total-box">${label("Total")}${numberCopy(h, "total", total, 598)}</div></div>`;
      return { inner, timeline: [
        ...items.map((item, i) => write(h, `items-${i}`, item, down, { y: -12 })),
        enter(h, ".ge-total-box", total.at, { y: -12 }, { y: 0 }), write(h, "total", total, down),
      ].join("\n") };
    },
    css: `
      & { padding:16px 44px 20px;display:grid;align-content:center; }
      &>.ge-label { margin:0 0 8px 12px;color:#A8A49C; }
      & .ge-mouth { height:10px;background:#C8A24B; }
      & .ge-receipt { padding:0 16px 8px;background:#F5F1E8;color:#0B0B0D;overflow:hidden; }
      & .ge-receipt-row { min-height:58px;display:flex;align-items:center;padding:4px 0;border-bottom:2px solid #A8A49C; }
      & .ge-total-box { margin-top:8px;padding:2px 2px 4px;border:2px solid #0B0B0D;opacity:0; }
      & .ge-number { font:400 96px/104px "Anton",sans-serif;opacity:0;white-space:nowrap; }`,
  }),

  "phrase-translation": card("phrase-translation", {
    variantOf: "term-definition",
    family: "emphasis",
    tags: ["definition", "callout"],
    source: source("translation-sheets-lak-russian"),
    slots: { term: spoken(48, 572), detail: spoken(64, 572) },
    size: (o) => box(174 + 48 * (linesIn(o, "term") + linesIn(o, "detail"))),
    render(o, h) {
      const [term] = o.slots.term, [detail] = o.slots.detail;
      const link = mark("link", "M82 6Q82 34 42 34H20m11-9-11 9 11 9", "0 0 96 48");
      const inner = `<div class="ge-sheet ge-first">${label("The term")}${copy(h, "term", term)}</div>
        ${link}<div class="ge-sheet ge-second">${label("In plain language")}${copy(h, "detail", detail)}</div>`;
      return { inner, timeline: [
        enter(h, ".ge-first", term.at, { x: -12 }, { x: 0 }), write(h, "term", term),
        draw(h, ".ge-link path", detail.at),
        enter(h, ".ge-second", detail.at, { x: 12 }, { x: 0 }), write(h, "detail", detail, down),
      ].join("\n") };
    },
    css: `
      & { display:grid;align-content:center;padding:14px 26px; }
      & .ge-sheet { position:relative;width:608px;padding:8px 14px;border:2px solid #343438;opacity:0; }
      & .ge-sheet .ge-label { color:#A8A49C; }
      & .ge-first { background:#0B0B0D; }
      & .ge-second { justify-self:end;background:#F5F1E8;color:#0B0B0D; }
      & .ge-second .ge-label { color:#343438; }
      & .ge-link { display:block;width:96px;height:34px;justify-self:end;margin-right:18px; }`,
  }),

  "drawn-milestones": card("drawn-milestones", {
    variantOf: "handoff-rail",
    family: "procedure",
    tags: ["steps", "timeline"],
    source: source("hand-drawn-path-diagram", "kraft-map-route-stamp", "zigzag-career-card", "dashed-route-draw"),
    slots: { stages: repeated(spoken(24, 556, 42, 1), 3, 4) },
    size: (o) => box(42 + o.slots.stages.length * 64),
    render(o, h) {
      const { stages } = o.slots;
      const points = stages.map((_, i) => ({ x: i % 2 ? 50 : 24, y: 32 + i * 64 }));
      const connectors = points.slice(1).map(({ x, y }, i) => {
        const prev = points[i];
        const d = `M${prev.x} ${prev.y} Q${prev.x} ${y - 32} ${(prev.x + x) / 2} ${y - 32} T${x} ${y}`;
        return `<g class="ge-link-${i + 1}"><path class="ge-guide" d="${d}"/>${path(d)}</g>`;
      }).join("");
      const nodes = points.map(({ x, y }, i) => `<circle class="ge-node ge-node-${i}" cx="${x}" cy="${y}" r="8"/>`).join("");
      return {
        inner: `${svg("route", `0 0 74 ${stages.length * 64}`, connectors + nodes)}
          <div class="ge-stops">${stages.map((item, i) => copy(h, `stages-${i}`, item)).join("")}</div>`,
        timeline: stages.flatMap((item, i) => [
          ...(i ? [draw(h, `.ge-link-${i} .ge-draw`, item.at)] : []),
          enter(h, `.ge-node-${i}`, item.at), write(h, `stages-${i}`, item),
        ]).join("\n"),
      };
    },
    css: `
      & { display:grid;grid-template-columns:74px 1fr;gap:16px;align-items:center;padding:16px 26px; }
      & .ge-route { width:74px;display:block; }
      & .ge-guide { fill:none;stroke:#343438;stroke-width:3;stroke-dasharray:6 6; }
      & .ge-node { fill:#C8A24B;stroke:#0B0B0D;stroke-width:2;opacity:0; }
      & .ge-stops .ge-copy { font-size:42px;line-height:64px;border-bottom:1px solid #343438; }`,
  }),

  "milestone-leaves": card("milestone-leaves", {
    variantOf: "timeline",
    family: "procedure",
    tags: ["timeline", "steps", "time"],
    source: source("tear-off-calendar", "day-timeline-strip"),
    slots: { heading, items: repeated(spoken(24, 558, 44, 1), 2, 4) },
    validate: fixedHeading("Milestones"),
    size: (o) => box(72 + o.slots.items.length * 65),
    surface: "bone",
    render(o, h) {
      const { items } = o.slots;
      const inner = label("Milestones") + items.map((item, i) =>
        `<div class="ge-leaf ge-leaf-${i}"><div class="ge-tab" aria-hidden="true"></div>${copy(h, `items-${i}`, item)}</div>`).join("");
      return { inner, timeline: items.flatMap((item, i) => [
        enter(h, `.ge-leaf-${i}`, item.at, { y: -8 }, { y: 0 }), write(h, `items-${i}`, item, down),
        ...(i ? [state(h, `.ge-leaf-${i - 1} .ge-tab`, { opacity: 1, y: 0 }, { opacity: 0, y: 14 }, item.at)] : []),
      ]).join("\n") };
    },
    css: `
      & { display:grid;align-content:center;padding:14px 24px; }
      & .ge-label { margin-bottom:8px;color:#343438; }
      & .ge-leaf { height:65px;display:grid;grid-template-columns:44px 1fr;gap:16px;align-items:center;border-top:2px dashed #A8A49C;opacity:0; }
      & .ge-tab { background:#C8A24B;width:38px;height:26px; }
      & .ge-copy { font-size:44px;line-height:52px; }`,
  }),

  "topic-files": card("topic-files", {
    variantOf: "agenda-bands",
    family: "procedure",
    tags: ["list", "title"],
    source: source("folder-tabs-drop"),
    slots: { topics: repeated(spoken(26, 552, 42, 1), 3, 4) },
    size: (o) => box(42 + o.slots.topics.length * 76),
    render(o, h) {
      const { topics } = o.slots;
      const inner = topics.map((item, i) =>
        `<div class="ge-folder ge-folder-${i}"><div class="ge-tab" aria-hidden="true"></div>${copy(h, `topics-${i}`, item)}</div>`).join("");
      return { inner, timeline: topics.flatMap((item, i) => [
        enter(h, `.ge-folder-${i}`, item.at, { y: -14 }, { y: 0 }), write(h, `topics-${i}`, item),
      ]).join("\n") };
    },
    css: `
      & { display:grid;align-content:center;padding:20px 28px; }
      & .ge-folder { position:relative;height:76px;display:flex;align-items:center;padding-left:24px;background:#343438;border:2px solid #A8A49C;border-radius:0 8px 0 0;opacity:0; }
      & .ge-folder:nth-child(even) { margin-left:28px; }
      & .ge-folder:nth-child(odd) { margin-right:28px; }
      & .ge-tab { position:absolute;right:20px;top:-10px;width:92px;height:10px;border-radius:6px 6px 0 0;background:#C8A24B; }
      & .ge-folder:nth-child(even) .ge-tab { right:128px; }
      & .ge-copy { font-size:42px;line-height:50px; }`,
  }),

  "punch-list": card("punch-list", {
    variantOf: "full-list",
    family: "procedure",
    tags: ["list", "checklist"],
    source: source("punch-card-list"),
    slots: { heading, items: repeated(spoken(52, 584, 54), 3, 4) },
    validate: fixedHeading("Put it into practice"),
    fullscreen: true,
    size: { w: 1080, h: 1920 },
    render(o, h) {
      const { items } = o.slots;
      const punch = svg("punch", "0 0 60 60", '<circle class="ge-ring" cx="30" cy="30" r="23"/><circle class="ge-hole" cx="30" cy="30" r="21"/>');
      return {
        inner: `<div class="ge-ticket">${label("Put it into practice")}${items.map((item, i) =>
          `<div class="ge-punch-row ge-punch-row-${i}">${punch}${copy(h, `items-${i}`, item)}</div>`).join("")}</div>`,
        timeline: items.flatMap((item, i) => [
          write(h, `items-${i}`, item),
          enter(h, `.ge-punch-row-${i} .ge-hole`, item.at, { scale: 0.75 }, { scale: 1 }),
        ]).join("\n"),
      };
    },
    css: `
      & { padding:200px 180px 320px;display:grid;align-content:center; }
      & .ge-ticket { width:720px;background:#F5F1E8;color:#0B0B0D;border-top:10px solid #C8A24B;padding:36px 28px; }
      & .ge-label { margin:0 0 22px 80px;color:#343438; }
      & .ge-punch-row { min-height:150px;display:grid;grid-template-columns:60px 1fr;align-items:center;gap:20px;border-top:2px solid #A8A49C; }
      & .ge-punch { width:60px;height:60px;transform-origin:center; }
      & .ge-ring { fill:none;stroke:#A8A49C;stroke-width:2;stroke-dasharray:4 4; }
      & .ge-hole { fill:#0B0B0D;opacity:0;transform-box:fill-box;transform-origin:center; }
      & .ge-copy { font-size:54px;line-height:64px; }`,
  }),

  "habit-rocker": card("habit-rocker", {
    variantOf: "center-spotlight",
    family: "payoff",
    tags: ["comparison", "callout"],
    source: source("paper-light-switch"),
    slots: {
      left: spoken(22, 302, 40, 1), leftDetail: spoken(32, 302),
      right: spoken(22, 302, 40, 1), rightDetail: spoken(32, 302),
      focus: spoken(30, 500, 40, 1), focusDetail: spoken(50, 500),
    },
    size: box(410),
    render(o, h) {
      const fields = Object.fromEntries(Object.entries(o.slots).map(([name, [item]]) => [name, item]));
      const rocker = svg("rocker", "0 0 84 120", '<rect class="ge-plate" x="3" y="3" width="78" height="114" rx="12"/><path class="ge-travel" d="M42 35v50"/><rect class="ge-toggle" x="23" y="20" width="38" height="30" rx="6"/>');
      const bulb = svg("bulb", "0 0 44 48", '<path d="M14 33v-5C1 18 9 3 22 3s21 15 8 25v5Zm0 6h16m-13 5h10"/>');
      const field = (name) => copy(h, name, fields[name]);
      const inner = `<div class="ge-conditions"><div>${field("left")}${field("leftDetail")}</div>
        <div>${field("right")}${field("rightDetail")}</div></div>
        <div class="ge-changes">${rocker}<div>${field("focus")}${field("focusDetail")}</div>${bulb}</div>`;
      return { inner, timeline: [
        ...Object.entries(fields).map(([name, item]) => write(h, name, item)),
        state(h, ".ge-toggle", { y: 0, fill: "#A8A49C" }, { y: 48, fill: "#C8A24B" }, fields.focus.at),
        state(h, ".ge-bulb", { opacity: 0 }, { opacity: 1 }, fields.focusDetail.at),
      ].join("\n") };
    },
    css: `
      & { display:grid;gap:12px;align-content:center;padding:24px 32px; }
      & .ge-conditions { display:grid;grid-template-columns:1fr 1fr;gap:24px;min-height:168px; }
      & .ge-conditions>div { padding:8px 6px;border-top:2px solid #343438; }
      & .ge-left,& .ge-right { color:#A8A49C;padding-bottom:6px; }
      & .ge-changes { display:grid;grid-template-columns:84px 1fr 34px;gap:14px;align-items:center;min-height:160px;border-top:2px solid #343438; }
      & .ge-rocker { width:84px;height:120px; }
      & .ge-plate { fill:#343438;stroke:#A8A49C;stroke-width:3; }
      & .ge-travel { stroke:#0B0B0D;stroke-width:46;stroke-linecap:round; }
      & .ge-toggle { fill:#A8A49C; }
      & .ge-focus { color:#C8A24B; }
      & .ge-bulb { width:34px;height:37px;fill:none;stroke:#C8A24B;stroke-width:3;stroke-linecap:round;opacity:0; }`,
  }),

  "alert-tearaway": card("alert-tearaway", {
    variantOf: "alert-stack",
    family: "conversation",
    tags: ["message", "conversation"],
    source: source("torn-notification-slips"),
    slots: Object.fromEntries(pairs.flatMap((i) => [
      [`title${i}`, spoken(32, 536, 40, 1)], [`message${i}`, spoken(48, 536)],
    ])),
    size: box(536),
    render(o, h) {
      const alerts = pairs.map((i) => ({ i, title: o.slots[`title${i}`][0], message: o.slots[`message${i}`][0] }));
      const flap = svg("flap", "0 0 52 84", '<path d="M0 0h52v84H0l8-14-8-14 8-14-8-14 8-14Z"/>');
      const inner = label("Incoming alerts") + alerts.map(({ i, title, message }) => `<div class="ge-slip ge-slip-${i}">
        <div class="ge-message-body">${copy(h, `title${i}`, title)}${copy(h, `message${i}`, message)}</div>${flap}</div>`).join("");
      return { inner, timeline: alerts.flatMap(({ i, title, message }) => [
        enter(h, `.ge-slip-${i}`, title.at, { y: -12 }, { y: 0 }), write(h, `title${i}`, title),
        state(h, `.ge-slip-${i} .ge-flap`, { x: 0, y: 0, opacity: 1 }, { x: 8, y: 14, opacity: 0.36 }, message.at),
        write(h, `message${i}`, message),
      ]).join("\n") };
    },
    css: `
      & { display:grid;align-content:center;padding:18px 28px; }
      & .ge-label { color:#C8A24B;margin-bottom:8px; }
      & .ge-slip { display:grid;grid-template-columns:1fr 52px;align-items:center;height:152px;opacity:0; }
      & .ge-message-body { display:grid;align-content:center;min-height:112px;background:#F5F1E8;color:#0B0B0D;padding:0 40px 0 20px;clip-path:polygon(0 0,100% 0,calc(100% - 8px) 17%,100% 33%,calc(100% - 8px) 50%,100% 67%,calc(100% - 8px) 83%,100% 100%,0 100%); }
      & .ge-message-body>.ge-copy:first-child { font-weight:850; }
      & .ge-flap { width:52px;height:84px;fill:#C8A24B; }`,
  }),

  "clocked-results": card("clocked-results", {
    variantOf: "annotated-figure",
    family: "proof",
    tags: ["number", "callout"],
    source: source("time-card-clock-punch"),
    slots: { value: numberSlot(612, amount), note: repeated(spoken(36, 558), 1, 2) },
    size: (o) => box(106 + o.slots.note.length * 108 +
      digitHeight * wrap(o.slots.value[0].text, 606, 2, antonWidth).length),
    surface: "bone",
    render(o, h) {
      const { value: [value], note } = o.slots;
      const stamp = svg("press", "0 0 104 44", '<path d="M10 28h84v12H10Zm28-24h28v24H38Z"/>');
      const inner = `<div class="ge-machine">${stamp}<div class="ge-feed"></div></div>${numberCopy(h, "value", value, 612)}` +
        note.map((item, i) => `<div class="ge-result">${copy(h, `note-${i}`, item)}</div>`).join("");
      return { inner, timeline: [
        state(h, ".ge-press", { y: -14 }, { y: 0 }, value.at), write(h, "value", value, down),
        ...note.map((item, i) => write(h, `note-${i}`, item)),
      ].join("\n") };
    },
    css: `
      & { display:grid;align-content:center;padding:18px 38px; }
      & .ge-machine { position:relative;height:52px; }
      & .ge-feed { position:absolute;bottom:0;width:100%;height:9px;background:#0B0B0D; }
      & .ge-press { position:absolute;top:0;left:12px;width:104px;height:44px;fill:#C8A24B;transform:translateY(-14px); }
      & .ge-number { font:400 96px/104px "Anton",sans-serif;opacity:0;white-space:nowrap;padding-left:12px; }
      & .ge-result { min-height:108px;display:grid;align-content:center;padding:0 12px;border-top:2px dashed #A8A49C; }`,
  }),

  "slate-strike": card("slate-strike", {
    variantOf: "practice-pair",
    family: "distinction",
    tags: ["comparison", "list"],
    source: source("chalk-slate-versus", "envelopes-postmark", "marker-strike-through"),
    slots: { do: repeated(spoken(36, 304), 2, 4), avoid: repeated(spoken(36, 304), 2, 4) },
    size: (o) => box(90 + 108 * Math.max(o.slots.do.length, o.slots.avoid.length)),
    render(o, h) {
      const { do: keep, avoid } = o.slots;
      const strike = (line) => `<span class="ge-slate-line">${h.esc(line)}${mark("strike", "M2 10Q48 13 98 6", "0 0 100 18")}</span>`;
      const inner = `<div class="ge-slate-side ge-keep">${label("Do this")}${keep.map((item, i) =>
        `<div class="ge-slate-row">${copy(h, `do-${i}`, item)}</div>`).join("")}</div>
        <div class="ge-slate-side ge-reject">${label("Avoid")}${avoid.map((item, i) =>
        `<div class="ge-slate-row"><div class="ge-copy ge-avoid-${i}">${item.lines.map(strike).join("")}</div></div>`).join("")}</div>`;
      return { inner, timeline: [
        ...keep.map((item, i) => write(h, `do-${i}`, item, up)),
        ...avoid.flatMap((item, i) => [write(h, `avoid-${i}`, item), draw(h, `.ge-avoid-${i} .ge-strike path`, item.at)]),
      ].join("\n") };
    },
    css: `
      & { padding:18px 20px;display:grid;grid-template-columns:1fr 1fr;gap:20px;border:4px solid #343438; }
      & .ge-slate-side { padding:0 8px; }
      & .ge-slate-row { min-height:108px;display:grid;align-content:center;border-top:2px solid #343438; }
      & .ge-label { color:#A8A49C; }
      & .ge-keep .ge-label { color:#C8A24B; }
      & .ge-slate-line { position:relative;display:table; }
      & .ge-strike { position:absolute;left:0;top:calc(50% - 9px);width:100%;height:18px; }`,
  }),

  "stamped-quote": card("stamped-quote", {
    variantOf: "quote",
    family: "payoff",
    tags: ["quote", "highlight"],
    source: source("paper-speech-bubble"),
    slots: { quote: spoken(80, 590, 46, 3) },
    size: (o) => box(144 + linesIn(o, "quote") * 56),
    render(o, h) {
      const [quote] = o.slots.quote;
      const tail = svg("tail", "0 0 54 30", '<path d="M0 0h54L0 30Z"/>');
      const inner = `<div class="ge-bubble">${copy(h, "quote", quote)}${tail}</div><div class="ge-quote-stamp">${label("Pull quote")}</div>`;
      return { inner, timeline: [
        write(h, "quote", quote), enter(h, ".ge-quote-stamp", quote.at, { x: 10 }, { x: 0 }),
      ].join("\n") };
    },
    css: `
      & { padding:18px 32px;display:grid;align-content:center;gap:20px; }
      & .ge-bubble { position:relative;padding:12px 22px;background:#F5F1E8;color:#0B0B0D;border-radius:12px 12px 12px 0; }
      & .ge-tail { position:absolute;top:calc(100% - 1px);left:0;width:42px;height:24px;fill:#F5F1E8; }
      & .ge-quote-stamp { justify-self:end;border:2px solid #C8A24B;padding:4px 12px;color:#C8A24B;opacity:0; }
      & .ge-quote { font-size:46px;line-height:56px; }`,
  }),

  "detail-underlines": card("detail-underlines", {
    variantOf: "topic-chip-grid",
    family: "emphasis",
    tags: ["highlight", "list"],
    source: source("highlighted-details-strip"),
    slots: { items: repeated(spoken(32, 578, 44, 1), 2, 4) },
    size: (o) => box(42 + o.slots.items.length * 68),
    surface: "bone",
    render(o, h) {
      const { items } = o.slots;
      const inner = items.map((item, i) => `<div class="ge-band ge-band-${i}"><div>
        ${copy(h, `items-${i}`, item)}${mark("underline", "M2 7Q30 4 50 7T98 7", "0 0 100 14")}</div></div>`).join("");
      return { inner, timeline: items.flatMap((item, i) => [
        write(h, `items-${i}`, item), draw(h, `.ge-band-${i} .ge-underline path`, item.at),
      ]).join("\n") };
    },
    css: `
      & { display:grid;align-content:center;padding:18px 30px; }
      & .ge-band { height:68px;display:flex;align-items:center;padding-left:16px;border-top:2px solid #A8A49C; }
      & .ge-band>div { position:relative;width:max-content; }
      & .ge-copy { font-size:44px;line-height:52px; }
      & .ge-underline { display:block;width:100%;height:12px; }
      & .ge-underline path { stroke-width:5; }`,
  }),
};
