// Restyled from ghost-editor (MIT), copyright 2026 kurbaitaev. See src/pro-cards/GHOST-EDITOR-LICENSE.md.
import { CARDS as payoff } from "./distinction-payoff.mjs";
import { CARDS as proof } from "./proof-2.mjs";
import { CARDS as emphasis } from "./warning-emphasis-full.mjs";
import { CARDS as labels } from "./herk-klabel.mjs";
import { CARDS as lower } from "./herk-klower.mjs";
import { CARDS as overview } from "./herk-voverview.mjs";

const source = (...ids) => ids.map((id) => `ghost-editor:${id}`).join(",");
// Older registry consumers require a hint on each definition. Designs inherit the root's wording.
const variant = (cards, type) => ({ variantOf: type, family: cards[type].family, hint: cards[type].hint });
const numeric = proof["kpi-tile"].slots.value.validate;
const wholeCount = proof.odometer.slots.value.validate;
const offerPrice = (text) => labels["offer-price-tag"].slots.price.validate(text) || proof["money-stack"].slots.value.validate(text);

// Match the planner's conservative measure and reject any run that would have to shrink.
function fits(text, width, size, maxLines, lineFits = () => true) {
  const measure = (run) => [...run].reduce((total, char) => total +
    (/\s/.test(char) ? 0.3 : /[ilI.,!'’]/.test(char) ? 0.32 : /[MW@]/.test(char) ? 0.95 : /[A-Z]/.test(char) ? 0.75 : 0.65) * size, 0);
  let line = "", lines = 1;
  for (const word of text.trim().split(/\s+/)) {
    if (measure(word) > width) return false;
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) line = next;
    else {
      if (!lineFits(line)) return false;
      line = word;
      lines++;
    }
  }
  return lines <= maxLines && lineFits(line);
}

function spoken(maxChars, width, size, maxLines = 2, check = () => true, lineFits) {
  return {
    kind: "spoken", maxChars, width, size, maxLines,
    validate: (text, slots) => !!text.trim() && !/[\p{Emoji_Presentation}\uFE0F]/u.test(text) &&
      check(text, slots) && fits(text, width, size, maxLines, lineFits),
  };
}

function figure(maxChars, width, check) {
  // The shared fitter estimates Inter. Validate its wrapped lines against Anton's advances.
  const withinAnton = (line) => 96 * [...line].reduce((sum, char) => sum +
    (char === "%" ? 1.06 : /[mwMW]/.test(char) ? 0.77 : /[ilI., !]/.test(char) ? 0.26 :
      /[fjt1–-]/.test(char) ? 0.34 : char === "r" ? 0.36 : /[syzv]/.test(char) ? 0.48 :
      char === "—" ? 0.57 : char === "€" ? 0.53 : 0.51), 0) <= width;
  return spoken(maxChars, Math.round(width * 1.4), 96, 2, check, withinAnton);
}
const singleWord = (text) => /^\S+$/u.test(text);
const closed = "inset(0 100% 0 0)";
const open = "inset(0 0% 0 0)";

function tween(h, selector, from, to, at, motion = "enter") {
  const ease = motion === "enter" ? "proEnter" : "proState";
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion[motion]},ease:${ease},immediateRender:false},${h.at(at)});`;
}

function write(h, selector, at, mask = closed) {
  return tween(h, selector, { opacity: 0, clipPath: mask }, { opacity: 1, clipPath: open }, at);
}

const draw = (h, selector, at) => tween(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at, "state");
const copy = (h, name, item) => `<div class="gf-copy gf-${name}">${h.copy(item)}</div>`;
const svg = (name, viewBox, paths) => `<svg class="gf-${name}" viewBox="${viewBox}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`;
const ink = (d, name = "ink") => `<path class="gf-${name}" pathLength="1" d="${d}" vector-effect="non-scaling-stroke"/>`;
const caret = (name = "caret") => svg(name, "0 0 1 1", '<path d="M0 0H1V1H0Z"/>');
const linesOf = (o, name) => o.slots[name][0].lines.length;

function base(type) {
  return `
    .pro-${type} .gf-copy { opacity:0;clip-path:inset(0 100% 0 0);white-space:nowrap; }
    .pro-${type} .gf-ink { fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1; }`;
}

function glyphs(h, line) {
  return [...line].map((char) => `<span class="gf-glyph">${h.esc(char)}</span>`).join("");
}

// The planner grounds a quote as one range. Its glyph effect starts at that range's first word,
// and the entire entry takes one house beat without guessing timings for the remaining words.
function staggerGlyphs(h, from, to, at) {
  const duration = h.motion.enter / 2;
  return `tl.fromTo(${h.sel(".gf-glyph")},${h.js(from)},{...${h.js(to)},duration:${duration},stagger:{amount:${duration}},ease:proEnter,immediateRender:false},${h.at(at)});`;
}

const methods = {
  family: "warning",
  hint: "Greg names two to four distinct sales or coaching tactics, then explicitly says why they failed together or makes one clear decision to drop them all",
  tags: ["warning", "list"],
  slots: {
    attempts: { ...spoken(38, 566, 40), repeat: [2, 4] },
    outcome: spoken(52, 648, 44),
  },
  size(o) {
    const rows = o.slots.attempts.reduce((sum, item) => sum + Math.max(48, item.lines.length * 46) + 7, 0);
    return { w: 720, h: 52 + rows + linesOf(o, "outcome") * 52 };
  },
};

function methodRows(o, h, mark) {
  return o.slots.attempts.map((item, i) => `<div class="gf-row gf-row-${i}">${mark(item, i)}</div>`).join("");
}

function methodWrites(o, h) {
  return o.slots.attempts.map((item, i) => write(h, `.gf-row-${i} .gf-attempt`, item.at));
}

const ordinal = "(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -])?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|[1-9]\\d*(?:st|nd|rd|th)";
const numbered = new RegExp(`^((?:(?:step|number) (?:[1-9]\\d*|one|two|three|four|five|six|seven|eight|nine|ten)|(?:${ordinal}))[.,:)\\-]?) (.+)$`, "iu");

function exactIndex(text) {
  const match = text.match(numbered);
  return !!match && fits(match[1], 304, 40, 1) && fits(match[2], 328, 40, 2);
}

export const CARDS = {
  "quote-caret": {
    ...variant(payoff, "quote"),
    tags: ["quote"],
    source: source("kinetic-doc/page-type-quote"),
    slots: { quote: spoken(92, 612, 48, 4) },
    size: (o) => ({ w: 720, h: 72 + linesOf(o, "quote") * 60 }),
    surface: "bone",
    render(o, h) {
      const [quote] = o.slots.quote;
      const lines = quote.lines.map((line, i) =>
        `<div class="gf-line">${glyphs(h, line)}${i === quote.lines.length - 1 ? caret() : ""}</div>`).join("");
      const inner = `<div class="gf-lines" aria-label="${h.esc(quote.text)}">${lines}</div>`;
      const timeline = [staggerGlyphs(h, { opacity: 0 }, { opacity: 1 }, quote.at),
        tween(h, ".gf-caret", { opacity: 0 }, { opacity: 1 }, quote.at + h.motion.enter / 2)].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-quote-caret { display:grid;align-content:center;padding:28px 48px;border-left:6px solid #C8A24B; }
      .pro-quote-caret .gf-lines { font:700 48px/60px "Inter",sans-serif; }
      .pro-quote-caret .gf-line { white-space:pre; }
      .pro-quote-caret .gf-glyph { opacity:0; }
      .pro-quote-caret .gf-caret { display:inline-block;width:5px;height:40px;margin-left:8px;vertical-align:-4px;fill:#0B0B0D;opacity:0; }`,
  },
  "term-cursor": {
    ...variant(emphasis, "big-word"),
    tags: ["highlight", "title"],
    source: source("kinetic-doc/page-paper-term"),
    slots: { word: spoken(16, 632, 72, 1, singleWord) },
    size: { w: 720, h: 160 },
    surface: "bone",
    render(o, h) {
      const [word] = o.slots.word;
      const inner = `<div class="gf-term">${copy(h, "word", word)}${caret("cursor")}</div>`;
      const timeline = [write(h, ".gf-word", word.at),
        tween(h, ".gf-cursor", { opacity: 1, scaleY: 1 }, { opacity: 1, scaleY: 0.15 }, word.at, "state")].join("\n");
      return { inner, timeline };
    },
    css: base("term-cursor") + `
      .pro-term-cursor { display:grid;align-content:center;justify-content:start;padding:24px 32px; }
      .pro-term-cursor .gf-term { display:flex;align-items:center;gap:12px; }
      .pro-term-cursor .gf-word { font:400 72px/88px "Anton",sans-serif; }
      .pro-term-cursor .gf-cursor { width:8px;height:66px;flex:none;fill:#C8A24B;opacity:0;transform-origin:bottom; }`,
  },
  "word-lift": {
    ...variant(emphasis, "big-word"),
    tags: ["highlight", "title"],
    source: source("tactile-paper/rising-letters-word"),
    slots: { word: spoken(16, 632, 72, 1, singleWord) },
    size: { w: 720, h: 160 },
    surface: "obsidian",
    render(o, h) {
      const [word] = o.slots.word;
      const inner = `<div class="gf-edge" aria-label="${h.esc(word.text)}">${glyphs(h, word.text)}</div>`;
      return { inner, timeline: staggerGlyphs(h, { opacity: 0, y: 16 }, { opacity: 1, y: 0 }, word.at) };
    },
    css: `
      .pro-word-lift { display:grid;align-content:center;padding:24px 44px; }
      .pro-word-lift .gf-edge { overflow:hidden;border-bottom:4px solid #C8A24B;white-space:nowrap;font:400 72px/82px "Anton",sans-serif; }
      .pro-word-lift .gf-glyph { display:inline-block;opacity:0; }`,
  },
  "count-tick-rail": {
    ...variant(proof, "odometer"),
    tags: ["number"],
    source: source("kinetic-doc/counter-ticks", "tactile-paper/count-strip-200-circled"),
    slots: { value: figure(30, 648, wholeCount), label: spoken(40, 648, 42) },
    size: (o) => ({ w: 720, h: 84 + linesOf(o, "value") * 108 + linesOf(o, "label") * 50 }),
    surface: "bone",
    render(o, h) {
      const { value: [value], label: [label] } = o.slots;
      // The tally rail is decorative. Its strokes move without adding a second readout or intermediate figures.
      const marks = Array.from({ length: 24 }, (_, i) => `M${2 + i * 12} 10V${i % 4 ? 4 : 1}`).join(" ");
      const rail = svg("rail", "0 0 280 12", `<path d="${marks}"/><path class="gf-ticks" d="${marks}"/>`);
      const inner = copy(h, "value", value) + rail + copy(h, "label", label);
      const timeline = [write(h, ".gf-value", value.at),
        tween(h, ".gf-ticks", { clipPath: closed }, { clipPath: open }, value.at, "state"),
        write(h, ".gf-label", label.at)].join("\n");
      return { inner, timeline };
    },
    css: base("count-tick-rail") + `
      .pro-count-tick-rail { display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:8px;padding:24px 36px; }
      .pro-count-tick-rail .gf-value { font:400 96px/108px "Anton",sans-serif; }
      .pro-count-tick-rail .gf-label { font:650 42px/50px "Inter",sans-serif; }
      .pro-count-tick-rail .gf-rail { width:240px;height:16px;fill:none;stroke:#343438;stroke-width:2; }
      .pro-count-tick-rail .gf-ticks { stroke:#C8A24B;stroke-width:3;clip-path:inset(0 100% 0 0); }`,
  },
  "headline-double-wipe": {
    ...variant(overview, "tabbed-note"),
    tags: ["title", "callout"],
    source: source("kinetic-doc/red-label-sub"),
    slots: { title: spoken(44, 600, 50), detail: spoken(60, 576, 40) },
    size: { w: 720, h: 288 },
    surface: "bare",
    render(o, h) {
      const { title: [title], detail: [detail] } = o.slots;
      const inner = `<div class="gf-band gf-title">${h.copy(title)}</div><div class="gf-band gf-detail">${h.copy(detail)}</div>`;
      return { inner, timeline: [write(h, ".gf-title", title.at), write(h, ".gf-detail", detail.at)].join("\n") };
    },
    css: `
      .pro-headline-double-wipe { display:grid;align-content:center;justify-items:start;gap:8px;padding:16px 24px; }
      .pro-headline-double-wipe .gf-band { padding:10px 18px;opacity:0;clip-path:inset(0 100% 0 0);white-space:nowrap;color:#0B0B0D; }
      .pro-headline-double-wipe .gf-title { min-width:280px;background:#C8A24B;font:400 50px/58px "Anton",sans-serif; }
      .pro-headline-double-wipe .gf-detail { margin-left:24px;background:#F5F1E8;font:650 40px/48px "Inter",sans-serif; }`,
  },
  "habit-disconnect": {
    ...variant(labels, "risk-explainer"),
    tags: ["warning", "callout"],
    source: source("kinetic-doc/page-plug-pulled-term"),
    slots: { term: spoken(48, 504, 44), detail: spoken(56, 504, 40) },
    size: { w: 720, h: 264 },
    surface: "obsidian",
    render(o, h) {
      const { term: [term], detail: [detail] } = o.slots;
      const plug = svg("plug", "0 0 128 96", '<path class="gf-socket" d="M89 24h30v48H89zM98 38h10M98 57h10"/><g class="gf-cord"><path d="M7 48h27m0-15h34v30H34zm34 6h21m-21 18h21"/></g>');
      return {
        inner: plug + `<div class="gf-body">${copy(h, "term", term)}${copy(h, "detail", detail)}</div>`,
        timeline: [write(h, ".gf-term", term.at), write(h, ".gf-detail", detail.at),
          tween(h, ".gf-cord", { x: 0 }, { x: -16 }, term.at, "state")].join("\n"),
      };
    },
    css: base("habit-disconnect") + `
      .pro-habit-disconnect { display:flex;align-items:center;gap:20px;padding:20px 32px; }
      .pro-habit-disconnect .gf-body { display:grid;gap:8px; }
      .pro-habit-disconnect .gf-term { font:700 44px/52px "Inter",sans-serif; }
      .pro-habit-disconnect .gf-detail { font:600 40px/48px "Inter",sans-serif;color:#A8A49C; }
      .pro-habit-disconnect .gf-plug { flex:none;width:128px;height:96px;fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;overflow:visible; }
      .pro-habit-disconnect .gf-socket { stroke:#A8A49C; }`,
  },
  "topic-drum": {
    ...variant(lower, "topic-chip-grid"),
    tags: ["list", "highlight"],
    source: source("kinetic-doc/prop-slot-drum-list"),
    slots: { items: { ...spoken(30, 582, 48), repeat: [2, 4] } },
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const { items } = o.slots;
      const inner = `<div class="gf-window">${items.map((item, i) => `<div class="gf-frame gf-frame-${i}">${copy(h, "topic", item)}</div>`).join("")}</div>`;
      const timeline = items.flatMap((item, i) => {
        const row = `.gf-frame-${i}`;
        const enter = tween(h, `${row} .gf-topic`, { opacity: 0, y: 16, clipPath: "inset(100% 0 0 0)" },
          { opacity: 1, y: 0, clipPath: open }, item.at);
        if (!i) return [enter];
        return [tween(h, `.gf-frame-${i - 1}`, { opacity: 1, y: 0 }, { opacity: 0, y: -16 }, item.at, "state"), enter];
      }).join("\n");
      return { inner, timeline };
    },
    css: base("topic-drum") + `
      .pro-topic-drum { padding:18px 34px; }
      .pro-topic-drum .gf-window { position:relative;height:140px;border-block:3px solid #C8A24B;overflow:hidden; }
      .pro-topic-drum .gf-frame { position:absolute;inset:0;display:grid;place-items:center; }
      .pro-topic-drum .gf-topic { color:#F5F1E8;text-align:center;font:400 48px/56px "Anton",sans-serif; }`,
  },
  "ruled-out-methods": {
    ...methods,
    source: source("tactile-paper/methods-list-struck-through", "tactile-paper/grey-flip-failed-methods",
      "tactile-paper/idea-5", "kinetic-doc/strike-red"),
    surface: "bone",
    render(o, h) {
      const [outcome] = o.slots.outcome;
      const rows = methodRows(o, h, (item) => `<div class="gf-copy gf-attempt">${item.lines.map((line) =>
        `<div class="gf-line">${h.esc(line)}${svg("strike", "0 0 200 10", ink("M2 8 43 3 83 7 121 3 157 6 198 3"))}</div>`).join("")}</div>`);
      const timeline = [...methodWrites(o, h), write(h, ".gf-outcome", outcome.at), draw(h, ".gf-ink", outcome.at),
        tween(h, ".gf-attempt", { color: "#0B0B0D" }, { color: "#343438" }, outcome.at, "state")].join("\n");
      return { inner: `<div class="gf-list">${rows}</div>${copy(h, "outcome", outcome)}`, timeline };
    },
    css: base("ruled-out-methods") + `
      .pro-ruled-out-methods { display:grid;align-content:center;gap:12px;padding:20px 36px; }
      .pro-ruled-out-methods .gf-row { padding:3px 0;border-bottom:1px solid #A8A49C;font:650 40px/46px "Inter",sans-serif; }
      .pro-ruled-out-methods .gf-line { position:relative;width:max-content; }
      .pro-ruled-out-methods .gf-strike { position:absolute;top:18px;left:0;width:100%;height:10px; }
      .pro-ruled-out-methods .gf-outcome { font:750 44px/52px "Inter",sans-serif; }`,
  },
  "methods-reject-stamps": {
    ...methods,
    variantOf: "ruled-out-methods",
    source: source("kinetic-doc/stamp-vykl-sources"),
    surface: "obsidian",
    render(o, h) {
      const [outcome] = o.slots.outcome;
      const stamp = svg("stamp", "0 0 48 48", '<rect x="2" y="2" width="44" height="44" rx="4"/><path d="m15 15 18 18m0-18-18 18"/>');
      const rows = methodRows(o, h, (item) => copy(h, "attempt", item) + stamp);
      const timeline = [...methodWrites(o, h), write(h, ".gf-outcome", outcome.at),
        tween(h, ".gf-stamp", { opacity: 0, y: -12, scale: 1.12 }, { opacity: 1, y: 0, scale: 1 }, outcome.at, "state")].join("\n");
      return { inner: `<div class="gf-list">${rows}</div>${copy(h, "outcome", outcome)}`, timeline };
    },
    css: base("methods-reject-stamps") + `
      .pro-methods-reject-stamps { display:grid;align-content:center;gap:12px;padding:20px 36px; }
      .pro-methods-reject-stamps .gf-row { display:grid;grid-template-columns:566px 48px;align-items:center;gap:16px;padding:3px 0;border-bottom:1px solid #343438;font:650 40px/46px "Inter",sans-serif; }
      .pro-methods-reject-stamps .gf-stamp { width:48px;height:48px;fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;opacity:0; }
      .pro-methods-reject-stamps .gf-outcome { color:#C8A24B;font:750 44px/52px "Inter",sans-serif; }`,
  },
  "numbered-action-rows": {
    ...variant(overview, "agenda-bands"),
    tags: ["steps", "list", "number"],
    source: source("kinetic-doc/list-red-numerals-chest"),
    slots: { topics: { ...spoken(60, 656, 40, 3, exactIndex), repeat: [3, 4] } },
    size(o) {
      const { topics } = o.slots;
      const height = topics.reduce((sum, { text }) => sum + (fits(text.match(numbered)[2], 328, 40, 1) ? 78 : 106), 0);
      return { w: 720, h: 40 + 8 * (topics.length - 1) + height };
    },
    surface: "obsidian",
    render(o, h) {
      const inner = o.slots.topics.map((item, i) => {
        const [, index, action] = item.text.match(numbered);
        return `<div class="gf-action gf-action-${i}"><div class="gf-index">${h.esc(index)}</div><div class="gf-detail">${h.esc(action)}</div></div>`;
      }).join("");
      const timeline = o.slots.topics.map((item, i) => write(h, `.gf-action-${i}`, item.at)).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-numbered-action-rows { display:grid;align-content:center;gap:8px;padding:20px 32px; }
      .pro-numbered-action-rows .gf-action { display:grid;grid-template-columns:320px 328px;align-items:center;gap:8px;min-height:78px;padding:4px 0;border-bottom:2px solid #343438;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-numbered-action-rows .gf-index { justify-self:start;padding:4px 8px;background:#C8A24B;color:#0B0B0D;white-space:nowrap;font:700 40px/48px "Inter",sans-serif; }
      .pro-numbered-action-rows .gf-detail { font:650 40px/48px "Inter",sans-serif; }`,
  },
  "note-underline": {
    ...variant(emphasis, "sticky-note"),
    tags: ["highlight"],
    source: source("tactile-paper/crimson-underline", "tactile-paper/notebook-speaker-line"),
    slots: { note: spoken(56, 648, 44) },
    size: { w: 720, h: 188 },
    surface: "bone",
    render(o, h) {
      const [note] = o.slots.note;
      const inner = note.lines.map((line) => `<div class="gf-line"><div class="gf-copy">${h.esc(line)}</div>${svg("underline", "0 0 200 10", ink("M2 7Q36 2 74 5T145 4 198 3"))}</div>`).join("");
      const timeline = [write(h, ".gf-copy", note.at),
        tween(h, ".gf-ink", { strokeDashoffset: 0.2 }, { strokeDashoffset: 0 }, note.at, "state")].join("\n");
      return { inner, timeline };
    },
    css: base("note-underline") + `
      .pro-note-underline { display:grid;justify-content:start;align-content:center;gap:8px;padding:22px 36px; }
      .pro-note-underline .gf-line { width:max-content;max-width:100%; }
      .pro-note-underline .gf-copy { font:700 44px/54px "Inter",sans-serif; }
      .pro-note-underline .gf-underline { display:block;width:100%;height:8px; }`,
  },
  "offer-ticket": {
    ...variant(labels, "offer-price-tag"),
    tags: ["money", "number"],
    source: source("tactile-paper/train-ticket-price"),
    slots: { price: figure(36, 608, offerPrice), offer: spoken(60, 608, 40) },
    size: (o) => ({ w: 720, h: 56 + linesOf(o, "price") * 108 + linesOf(o, "offer") * 48 }),
    surface: "bone",
    render(o, h) {
      const { price: [price], offer: [offer] } = o.slots;
      const hole = svg("hole", "0 0 16 16", '<circle cx="8" cy="8" r="5.5"/>');
      const inner = `<div class="gf-stub">${hole}</div>` +
        `<div class="gf-body">${copy(h, "price", price)}${svg("rule", "0 0 200 8", ink("M2 5Q98 2 198 4"))}${copy(h, "offer", offer)}</div>`;
      const timeline = [tween(h, ".gf-body", { clipPath: "polygon(0 0,0 0,14% 100%,0 100%)", x: -12 },
        { clipPath: "polygon(0 0,100% 0,100% 100%,0 100%)", x: 0 }, price.at),
        write(h, ".gf-price", price.at), draw(h, ".gf-ink", price.at), write(h, ".gf-offer", offer.at)].join("\n");
      return { inner, timeline };
    },
    css: base("offer-ticket") + `
      .pro-offer-ticket { display:grid;grid-template-columns:44px 608px;align-items:stretch;gap:14px;padding:16px 27px; }
      .pro-offer-ticket .gf-stub { border-right:3px dashed #343438; }
      .pro-offer-ticket .gf-hole { display:block;width:16px;height:16px;margin:22px 0 0 4px;fill:none;stroke:#343438;stroke-width:3; }
      .pro-offer-ticket .gf-body { display:grid;align-content:center;gap:8px;clip-path:inset(0 100% 0 0); }
      .pro-offer-ticket .gf-price { font:400 96px/108px "Anton",sans-serif; }
      .pro-offer-ticket .gf-rule { width:208px;height:8px; }
      .pro-offer-ticket .gf-offer { font:650 40px/48px "Inter",sans-serif; }`,
  },
  "metric-typed-slip": {
    ...variant(lower, "metric-stat-chip"),
    tags: ["number"],
    source: source("tactile-paper/typed-number-label-chest"),
    slots: {
      metric: spoken(38, 636, 42),
      value: figure(30, 600, (text) => numeric(text) || /^\$?\d+(?:\.\d+)?[KMB][.!?]?$/i.test(text)),
    },
    size: (o) => ({ w: 720, h: 76 + linesOf(o, "metric") * 50 + linesOf(o, "value") * 108 }),
    surface: "bare",
    render(o, h) {
      const { metric: [metric], value: [value] } = o.slots;
      const inner = `<div class="gf-slip gf-metric">${h.copy(metric)}</div><div class="gf-slip gf-value">${h.copy(value)}${caret()}</div>`;
      const timeline = [write(h, ".gf-metric", metric.at), write(h, ".gf-value", value.at),
        tween(h, ".gf-caret", { opacity: 0 }, { opacity: 1 }, value.at + h.motion.enter / 2)].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-metric-typed-slip { display:grid;align-content:center;justify-items:start;gap:8px;padding:14px 24px; }
      .pro-metric-typed-slip .gf-slip { opacity:0;clip-path:inset(0 100% 0 0);padding:10px 18px;white-space:nowrap; }
      .pro-metric-typed-slip .gf-metric { background:#0B0B0D;color:#F5F1E8;font:650 42px/50px "Inter",sans-serif; }
      .pro-metric-typed-slip .gf-value { margin-left:20px;background:#F5F1E8;color:#0B0B0D;font:400 96px/108px "Anton",sans-serif; }
      .pro-metric-typed-slip .gf-caret { display:inline-block;width:6px;height:72px;margin-left:10px;fill:#C8A24B;opacity:0; }`,
  },
  "before-after-overlay": {
    ...variant(proof, "case-study"),
    tags: ["before-after", "comparison", "number"],
    source: source("tactile-paper/idea-1"),
    slots: {
      before: figure(30, 648, numeric),
      after: figure(30, 648, proof["case-study"].slots.after.validate),
      label: spoken(44, 648, 40),
    },
    // Use the shared footprint when a figure needs more room than half of the card.
    validate: ({ before: [before], after: [after] }) => [before, after].some(({ text }) => !fits(text, 272, 96, 1)),
    size: (o) => ({ w: 720, h: 100 + 108 * Math.max(linesOf(o, "before"), linesOf(o, "after")) + 48 * linesOf(o, "label") }),
    surface: "obsidian",
    render(o, h) {
      const { before: [before], after: [after], label: [label] } = o.slots;
      const inner = `<div class="gf-stage"><div class="gf-panel gf-before"><div class="gf-heading">Before</div><div class="gf-text">${h.copy(before)}</div></div><div class="gf-panel gf-after"><div class="gf-heading">After</div><div class="gf-text">${h.copy(after)}</div></div></div>${copy(h, "metric", label)}`;
      const timeline = [write(h, ".gf-before", before.at),
        tween(h, ".gf-after", { clipPath: closed }, { clipPath: open }, after.at, "state"),
        tween(h, ".gf-after .gf-text", { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, after.at),
        write(h, ".gf-metric", label.at)].join("\n");
      return { inner, timeline };
    },
    css: base("before-after-overlay") + `
      .pro-before-after-overlay { display:grid;grid-template-rows:1fr auto;padding:0;background:#0B0B0D; }
      .pro-before-after-overlay .gf-stage { position:relative; }
      .pro-before-after-overlay .gf-panel { position:absolute;inset:0;display:grid;align-content:center;gap:8px;padding:20px 36px;clip-path:inset(0 100% 0 0); }
      .pro-before-after-overlay .gf-before { opacity:0;color:#F5F1E8; }
      .pro-before-after-overlay .gf-after { background:#C8A24B;color:#0B0B0D; }
      .pro-before-after-overlay .gf-heading { font:750 28px/34px "Inter",sans-serif;text-transform:uppercase;letter-spacing:2px; }
      .pro-before-after-overlay .gf-text { font:400 96px/108px "Anton",sans-serif;white-space:nowrap; }
      .pro-before-after-overlay .gf-after .gf-text { opacity:0; }
      .pro-before-after-overlay .gf-metric { padding:9px 36px;font:650 40px/48px "Inter",sans-serif; }`,
  },
};
