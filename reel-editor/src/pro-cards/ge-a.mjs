// Clean OS ideas from ghost-editor (MIT, copyright 2026 kurbaitaev). See src/pro-cards/GHOST-EDITOR-LICENSE.md.
import { CARDS as conversation } from "./conversation.mjs";
import { CARDS as conversation2 } from "./conversation-2.mjs";
import { CARDS as distinction } from "./distinction-2.mjs";
import { CARDS as payoff } from "./distinction-payoff.mjs";
import { CARDS as procedure } from "./procedure-proof.mjs";
import { CARDS as proof } from "./proof-2.mjs";
import { CARDS as emphasis } from "./warning-emphasis-full.mjs";
import { CARDS as warning } from "./warning-payoff-2.mjs";
import { CARDS as herkOverview } from "./herk-koverview.mjs";
import { CARDS as herkStats } from "./herk-vstat.mjs";

const roots = { ...conversation, ...conversation2, ...distinction, ...payoff, ...procedure, ...proof, ...emphasis, ...warning, ...herkOverview, ...herkStats };
const ink = "#0B0B0D", bone = "#F5F1E8", gold = "#C8A24B", grey = "#A8A49C", rule = "#343438";
const masked = "opacity:0;clip-path:inset(0 100% 0 0);";
const closed = "inset(0 100% 0 0)";
const open = "inset(0 0% 0 0)";
const spoken = (maxChars, width = 664, maxLines = 2, size = 40, validate) => ({
  kind: "spoken", maxChars, width, maxLines, size, ...(validate && { validate }),
});
const optional = (slot) => ({ ...slot, optional: true });
const repeat = (slot, min, max) => ({ ...slot, repeat: [min, max] });
const size = (h) => ({ w: 720, h });
const lineHeight = (item, px = 48) => item.lines.length * px;
const inter = (size = 40, line = 48, weight = 700) => `font:${weight} ${size}px/${line}px "Inter",sans-serif;`;
const anton = 'font:400 96px/104px "Anton",sans-serif;';
const copy = (h, cls, item) => `<div class="ga-copy ${cls}">${h.copy({ lines: item.lines })}</div>`;
const label = (text) => `<div class="ga-label">${text}</div>`;
const svg = (cls, box, content, stretch = false) =>
  `<svg class="${cls}" viewBox="${box}"${stretch ? ' preserveAspectRatio="none"' : ""} aria-hidden="true">${content}</svg>`;
const path = (d) => `<path pathLength="1" d="${d}"/>`;
const tick = (cls) => svg(cls, "0 0 36 36", path("m7 18 7 7L29 10"));
const list = (...chunks) => chunks.flat().filter(Boolean).join("\n");

function motion(h, selector, from, to, at, phase) {
  const ease = phase === "enter" ? "proEnter" : "proState";
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion[phase]},ease:${ease},immediateRender:false},${h.at(at)});`;
}

const state = (h, selector, from, to, at) => motion(h, selector, from, to, at, "state");
const enter = (h, selector, from, to, at) => motion(h, selector, from, to, at, "enter");
const write = (h, selector, item, from = {}, to = {}) =>
  enter(h, selector, { opacity: 0, clipPath: closed, ...from }, { opacity: 1, clipPath: open, ...to }, item.at);
const draw = (h, selector, at) => state(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at);

// For numeric display, allow the narrower Anton glyphs the generic estimate would shrink.
// Return a fixed-size card or its regular alternative when the spoken copy exceeds its fit.
function fitsAnton(line, width) {
  const units = { m: .82, w: .76, M: .82, W: .80, "%": 1.08, "$": .66, "#": .62, " ": .27, i: .28, l: .29, t: .35, f: .32, r: .39, "1": .37, ".": .27, ",": .27 };
  return [...line].reduce((sum, char) => sum + (units[char] ?? .56) * 96, 0) <= width - 4;
}

function card(type, ids, def) {
  const { css, validate, ...data } = def;
  const scope = `.pro-${type}`;
  const ownCSS = css.trim().split("\n").map((line) => line.trim().replaceAll("&", scope)).join("\n");
  return {
    surface: "obsidian",
    ...(data.variantOf && { hint: roots[data.variantOf].hint }),
    ...data,
    source: ids.map((id) => `ghost-editor:clean-os/${id}`).join(","),
    validate(slots) {
      return Object.entries(slots).every(([name, items]) => {
        const { size, width } = def.slots[name];
        return items.every((item) => size === 96
          ? item.lines.every((line) => fitsAnton(line, width))
          : !item.fontSize);
      }) && (!validate || validate(slots));
    },
    css: `
      ${scope} { padding:24px 28px;background:${ink}; }
      ${scope} .ga-copy { ${inter()}${masked} }
      ${scope} .ga-label { color:${grey};${inter(28, 34, 800)}text-transform:uppercase; }
      ${ownCSS}`,
  };
}

const ones = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const tens = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const timeUnits = { second: 1, minute: 60, hour: 3600 };

function wholeNumber(text) {
  const raw = text.trim().toLowerCase().replace(/[.,!?]$/, "");
  if (/^\d{1,4}$/.test(raw)) return Number(raw);
  const hundred = raw.match(/^(one|two|three|four|five|six|seven|eight|nine) hundred(?: (?:and )?([a-z -]+))?$/);
  if (hundred) {
    const rest = hundred[2] ? wholeNumber(hundred[2]) : 0;
    return rest !== null && rest < 100 ? ones.indexOf(hundred[1]) * 100 + rest : null;
  }
  const [first, second, ...rest] = raw.split(/[ -]+/);
  if (!second && ones.includes(first)) return ones.indexOf(first);
  if (!rest.length && tens.includes(first) && (!second || ones.slice(1, 10).includes(second))) {
    return (2 + tens.indexOf(first)) * 10 + (second ? ones.indexOf(second) : 0);
  }
  return null;
}

function durationSeconds(text) {
  let remaining = text.toLowerCase().replace(/[.,!?]$/, "");
  if (!remaining) return null;
  let lastUnit = Infinity, total = 0;
  while (remaining) {
    const match = remaining.match(/^(.+?)\s+(second|minute|hour)s?(?:\s+(?:and\s+)?(.+))?$/);
    if (!match) return null;
    const [, count, unit, tail] = match;
    const number = wholeNumber(count);
    if (number === null || timeUnits[unit] >= lastUnit) return null;
    lastUnit = timeUnits[unit];
    total += number * lastUnit;
    remaining = tail ?? "";
  }
  return total;
}

const amount = spoken(36, 664, 2, 96, proof["money-stack"].slots.value.validate);
const interval = (width, font, maxLines) => spoken(32, width, maxLines, font, (text) => durationSeconds(text) !== null);
const distinct = (a, b) => a.toLowerCase().replace(/[.,!?]$/, "") !== b.toLowerCase().replace(/[.,!?]$/, "");
const oneWord = (text) => !/\s/.test(text);

export const CARDS = {
  "focus-shortlist": card("focus-shortlist", ["tasks-five-to-one", "app-switcher-flick"], {
    family: "distinction", tags: ["comparison", "list"],
    hint: "Greg names two to four competing sales tasks he explicitly sets aside, then names the single action the rep should focus on now",
    slots: { discard: repeat(spoken(28, 576, 1), 2, 4), keep: spoken(38, 576) },
    validate: ({ discard, keep: [keep] }) => discard.every((item) => distinct(item.text, keep.text)),
    size: ({ slots }) => size(48 + 58 * slots.discard.length + 28 + lineHeight(slots.keep[0])),
    render(o, h) {
      const { discard, keep: [keep] } = o.slots;
      const rows = discard.map((item, i) => `<div class="ga-dismiss ga-dismiss-${i}">${copy(h, "ga-task", item)}</div>`);
      const inner = rows.join("") + `<div class="ga-priority">${tick("ga-check")}${copy(h, "ga-keep", keep)}</div>`;
      const timeline = list(discard.map((item, i) => write(h, `.ga-dismiss-${i} .ga-task`, item)),
        state(h, ".ga-dismiss", { x: 0, opacity: 1 }, { x: -12, opacity: .54 }, keep.at),
        write(h, ".ga-keep", keep, { y: 12 }, { y: 0 }),
        state(h, ".ga-priority", { borderColor: rule }, { borderColor: gold }, keep.at),
        draw(h, ".ga-check path", keep.at));
      return { inner, timeline };
    },
    css: `
      & { display:flex;flex-direction:column; }
      & .ga-dismiss { min-height:58px;border-bottom:2px solid ${rule};padding-left:52px; }
      & .ga-task { color:${grey}; }
      & .ga-priority { min-height:60px;display:grid;grid-template-columns:36px minmax(0,1fr);align-items:center;gap:14px;padding:6px 12px;border:2px solid ${rule};border-radius:8px;margin-top:12px; }
      & .ga-check { width:36px;height:36px;fill:none;stroke:${gold};stroke-width:4;stroke-linecap:round;stroke-linejoin:round; }
      & .ga-check path { stroke-dasharray:1;stroke-dashoffset:1; }
      & .ga-keep { color:${gold}; }`,
  }),

  "lead-tagging": card("lead-tagging", ["contact-card-tags"], {
    family: "conversation", tags: ["callout", "list"],
    hint: "Greg names a prospect segment and explicitly says two or three short qualification tags the rep should apply to it; quote the segment and tags in the order he says them",
    slots: { segment: spoken(40, 664, 2, 46), tags: repeat(spoken(22, 598, 1), 2, 3) },
    size: ({ slots }) => size(70 + lineHeight(slots.segment[0], 54) + 58 * slots.tags.length),
    render(o, h) {
      const { segment: [segment], tags } = o.slots;
      const icon = svg("ga-tag-icon", "0 0 32 32", path("M4 5h13l11 11-12 12L4 16zM11 11h1"));
      const rows = tags.map((item, i) => `<div class="ga-tag ga-tag-${i}">${icon}${copy(h, "ga-tag-copy", item)}</div>`);
      return {
        inner: copy(h, "ga-segment", segment) + `<div class="ga-tags">${rows.join("")}</div>`,
        timeline: list(write(h, ".ga-segment", segment), tags.map((item, i) => list(
          write(h, `.ga-tag-${i} .ga-tag-copy`, item, { x: -12 }, { x: 0 }), draw(h, `.ga-tag-${i} path`, item.at)))),
      };
    },
    css: `
      & .ga-segment { ${inter(46, 54, 800)} }
      & .ga-tags { margin-top:10px;padding-top:10px;border-top:2px solid ${gold}; }
      & .ga-tag { display:grid;grid-template-columns:32px minmax(0,1fr);align-items:center;gap:14px;height:58px;color:${grey}; }
      & .ga-tag-icon { width:32px;height:32px;fill:none;stroke:${gold};stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round; }
      & .ga-tag-icon path { stroke-dasharray:1;stroke-dashoffset:1; }`,
  }),

  "query-caret": card("query-caret", ["search-bar-typing", "search-stalled-bar"], {
    variantOf: "search-bar", family: "conversation", tags: ["question"],
    slots: { query: spoken(48, 584, 2, 42) },
    size: ({ slots }) => size(80 + lineHeight(slots.query[0], 50)),
    render(o, h) {
      const [query] = o.slots.query;
      const search = svg("ga-search", "0 0 40 40", '<circle cx="16" cy="16" r="11"/><path d="m24 24 11 11"/>');
      const rows = query.lines.map((line, i) => {
        const glyphs = [...line];
        const duration = h.motion.enter / query.lines.length;
        const at = query.at + i * duration;
        const letters = glyphs.map((glyph, n) => `<span class="ga-glyph ga-glyph-${i}-${n}">${h.esc(glyph)}</span>`).join("");
        // The caret advances with the letters, then holds without a fabricated result or percent.
        const keyframes = glyphs.map((_, n) =>
          `tl.set(${h.sel(`.ga-glyph-${i}-${n}`)},{display:"inline"},${h.at(at + n * duration / glyphs.length)});`);
        return {
          html: `<div class="ga-query-line" aria-label="${h.esc(line)}"><span aria-hidden="true">${letters}<i class="ga-caret ga-caret-${i}"></i></span></div>`,
          timeline: list(
            i > 0 && `tl.set(${h.sel(`.ga-caret-${i - 1}`)},{opacity:0},${h.at(at)});`,
            `tl.set(${h.sel(`.ga-caret-${i}`)},{opacity:1},${h.at(at)});`,
            keyframes),
        };
      });
      const timeline = list(enter(h, ".ga-field", { opacity: 0, y: 6 }, { opacity: 1, y: 0 }, query.at), rows.map((row) => row.timeline));
      return { inner: search + `<div class="ga-field">${rows.map((row) => row.html).join("")}</div>`, timeline };
    },
    css: `
      & { display:grid;grid-template-columns:38px minmax(0,1fr);align-items:center;gap:14px; }
      & .ga-field { border-bottom:2px solid ${gold};padding-bottom:6px;opacity:0; }
      & .ga-query-line { ${inter(42, 50, 650)}height:50px;white-space:pre; }
      & .ga-glyph { display:none; }
      & .ga-search { width:38px;height:38px;fill:none;stroke:${gold};stroke-width:3;stroke-linecap:round; }
      & .ga-caret { display:inline-block;width:3px;height:36px;margin-left:5px;background:${gold};vertical-align:-6px;opacity:0; }`,
  }),

  "dictated-message": card("dictated-message", ["live-dictation"], {
    variantOf: "typing", family: "conversation", tags: ["message", "conversation"],
    slots: { message: spoken(48, 664, 2, 42) },
    size: ({ slots }) => size(106 + lineHeight(slots.message[0], 50)),
    render(o, h) {
      const [message] = o.slots.message;
      const mic = svg("ga-mic", "0 0 40 44", '<rect x="13" y="4" width="14" height="23" rx="7"/><path d="M8 21a12 12 0 0 0 24 0M20 33v7m-6 0h12"/>');
      const wave = svg("ga-dictation-wave", "0 0 160 40", path("M2 20h20l5-7 7 14 8-22 8 30 8-23 8 15 7-7h85"));
      return {
        inner: `<div class="ga-record">${mic}${wave}</div>` + copy(h, "ga-message", message),
        timeline: list(enter(h, ".ga-mic", { opacity: 0 }, { opacity: 1 }, message.at), draw(h, ".ga-dictation-wave path", message.at),
          write(h, ".ga-message", message)),
      };
    },
    css: `
      & { display:flex;flex-direction:column;gap:12px; }
      & .ga-record { display:flex;gap:12px;height:46px;border-bottom:2px solid ${rule};padding-bottom:6px;align-items:center; }
      & .ga-mic,& .ga-dictation-wave { height:36px;fill:none;stroke:${gold};stroke-width:3;stroke-linecap:round;stroke-linejoin:round; }
      & .ga-mic { width:32px;opacity:0; }
      & .ga-dictation-wave { width:148px; }
      & .ga-dictation-wave path { stroke-dasharray:1;stroke-dashoffset:1; }
      & .ga-message { ${inter(42, 50)} }`,
  }),

  "phrase-selection": card("phrase-selection", ["figma-selection-box", "ios-text-selection"], {
    variantOf: "marker-highlight", family: "payoff", tags: ["highlight"],
    slots: { line: spoken(52, 596, 3, 44) },
    size: ({ slots }) => size(104 + lineHeight(slots.line[0], 52)),
    render(o, h) {
      const [line] = o.slots.line;
      // A pair of editorial brackets selects the copy without covering the letterforms.
      const bracket = (cls, d) => svg(cls, "0 0 16 64", path(d), true);
      return {
        inner: `<div class="ga-select">${bracket("ga-left", "M14 2H3v60h11")}${copy(h, "ga-selected", line)}${bracket("ga-right", "M2 2h11v60H2")}</div>`,
        timeline: list(write(h, ".ga-selected", line), draw(h, ".ga-select path", line.at),
          enter(h, ".ga-right", { x: -12 }, { x: 0 }, line.at)),
      };
    },
    css: `
      & { display:grid;align-items:center; }
      & .ga-select { position:relative;padding:12px 30px; }
      & .ga-select svg { position:absolute;top:0;display:block;width:16px;height:100%;fill:none;stroke:${gold};stroke-width:3; }
      & .ga-left { left:0; }
      & .ga-right { right:0; }
      & .ga-select path { stroke-dasharray:1;stroke-dashoffset:1;vector-effect:non-scaling-stroke; }
      & .ga-selected { ${inter(44, 52, 800)} }`,
  }),

  "strike-selection": card("strike-selection", ["figma-reject-strike"], {
    variantOf: "crossed-out", family: "warning", tags: ["comparison", "warning"],
    slots: { habit: spoken(48, 616, 2, 44) },
    size: ({ slots }) => size(78 + lineHeight(slots.habit[0], 52)),
    render(o, h) {
      const [habit] = o.slots.habit;
      const inner = habit.lines.map((line) => `<div class="ga-struck-line">${copy(h, "ga-habit", { lines: [line] })}` +
        `${svg("ga-strike", "0 0 100 8", path("M0 4h100"), true)}</div>`).join("");
      const at = habit.at + h.motion.enter;
      return {
        inner,
        timeline: list(write(h, ".ga-habit", habit), draw(h, ".ga-strike path", at),
          state(h, ".ga-habit", { color: bone }, { color: grey }, at)),
      };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;align-items:flex-start;border-left:4px solid ${gold}; }
      & .ga-struck-line { position:relative;width:max-content;max-width:100%; }
      & .ga-habit { ${inter(44, 52, 800)} }
      & .ga-strike { position:absolute;width:100%;height:6px;left:0;top:50%;fill:none;stroke:${gold};stroke-width:4; }
      & .ga-strike path { stroke-dasharray:1;stroke-dashoffset:1;vector-effect:non-scaling-stroke; }`,
  }),

  "retype-word": card("retype-word", ["label-rename-retype", "figma-delete-backspace"], {
    variantOf: "word-swap", family: "distinction", tags: ["comparison", "highlight"],
    slots: {
      before: optional(spoken(22, 620, 1)),
      word: spoken(18, 620, 1, 48, oneWord),
      after: optional(spoken(22, 620, 1)),
      replacement: spoken(18, 620, 1, 48, oneWord),
    },
    validate({ before: [before], word: [word], after: [after], replacement: [replacement] }) {
      return distinct(word.text, replacement.text) && word.from === word.to && replacement.from === replacement.to
        && (!before || before.to + 1 === word.from) && (!after || word.to + 1 === after.from);
    },
    size: ({ slots }) => size(178 + 48 * (slots.before.length + slots.after.length)),
    render(o, h) {
      const { before: [before], word: [word], after: [after], replacement: [replacement] } = o.slots;
      const glyphs = [...word.text];
      const letters = glyphs.map((glyph, i) => `<span class="ga-letter-${i}">${h.esc(glyph)}</span>`).join("");
      const erase = glyphs.map((_, i) => {
        const at = replacement.at + h.motion.state * (i + 1) / glyphs.length;
        return `tl.set(${h.sel(`.ga-letter-${glyphs.length - 1 - i}`)},{display:"none"},${h.at(at)});`;
      });
      const inner = (before ? copy(h, "ga-before", before) : "") +
        `<div class="ga-edit"><div class="ga-copy ga-original" aria-label="${h.esc(word.text)}"><span aria-hidden="true">${letters}<i class="ga-caret"></i></span></div>${copy(h, "ga-replacement", replacement)}</div>` +
        (after ? copy(h, "ga-after", after) : "");
      const timeline = list(before && write(h, ".ga-before", before), write(h, ".ga-original", word),
        after && write(h, ".ga-after", after), write(h, ".ga-replacement", replacement), erase,
        state(h, ".ga-caret", { opacity: 1 }, { opacity: 0 }, replacement.at));
      return { inner, timeline };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center; }
      & .ga-edit { display:grid;align-items:center;border-block:2px solid ${rule};padding:4px 10px; }
      & .ga-original,& .ga-replacement { ${inter(48, 58, 800)} }
      & .ga-original { white-space:nowrap;color:${grey}; }
      & .ga-replacement { color:${gold}; }
      & .ga-caret { display:inline-block;width:3px;height:42px;margin-left:4px;background:${gold};vertical-align:-6px; }`,
  }),

  "decision-confirm": card("decision-confirm", ["two-button-alert-tapped"], {
    variantOf: "either-or", family: "distinction", tags: ["comparison", "question"],
    slots: { first: spoken(24, 588, 2, 42), second: spoken(24, 588, 2, 42) },
    size: ({ slots }) => size(90 + 50 * (slots.first[0].lines.length + slots.second[0].lines.length)),
    render(o, h) {
      const { first: [first], second: [second] } = o.slots;
      const reject = svg("ga-dismiss-icon", "0 0 36 36", path("M6 18h24"));
      return {
        inner: `<div class="ga-option ga-first">${reject}${copy(h, "ga-choice", first)}</div><div class="ga-option ga-second">${tick("ga-chosen")}${copy(h, "ga-choice", second)}</div>`,
        timeline: list(write(h, ".ga-first .ga-choice", first), write(h, ".ga-second .ga-choice", second),
          draw(h, ".ga-option path", second.at),
          state(h, ".ga-first", { color: bone }, { color: grey }, second.at),
          state(h, ".ga-second", { borderColor: rule, backgroundColor: ink, color: bone },
            { borderColor: gold, backgroundColor: rule, color: gold }, second.at)),
      };
    },
    css: `
      & { display:flex;flex-direction:column;gap:10px; }
      & .ga-option { display:grid;grid-template-columns:36px minmax(0,1fr);align-items:center;gap:12px;padding:6px 8px;border:2px solid ${rule};border-radius:8px; }
      & .ga-choice { ${inter(42, 50)} }
      & .ga-option svg { width:36px;height:36px;fill:none;stroke:currentColor;stroke-width:4;stroke-linecap:round;stroke-linejoin:round; }
      & .ga-option path { stroke-dasharray:1;stroke-dashoffset:1; }`,
  }),

  "route-choice": card("route-choice", ["maps-directions-options"], {
    variantOf: "signpost", family: "distinction", tags: ["comparison", "flow"],
    slots: { left: spoken(32, 542, 2, 42), right: spoken(32, 542, 2, 42) },
    size: ({ slots }) => size(96 + lineHeight(slots.left[0], 50) + lineHeight(slots.right[0], 50)),
    render(o, h) {
      const { left: [left], right: [right] } = o.slots;
      const fork = (cls, d) => svg(`ga-fork ${cls}`, "0 0 72 48", path(d), true);
      const inner = `<div class="ga-route">${fork("ga-upper", "M8 48V37a18 18 0 0 1 18-18h32m-8-8 8 8-8 8")}${copy(h, "ga-left", left)}</div>` +
        `<div class="ga-route">${fork("ga-lower", "M8 0v10a18 18 0 0 0 18 18h32m-8-8 8 8-8 8")}${copy(h, "ga-right", right)}</div>`;
      return {
        inner,
        timeline: list(write(h, ".ga-left", left), draw(h, ".ga-upper path", left.at), write(h, ".ga-right", right),
          draw(h, ".ga-lower path", right.at), state(h, ".ga-upper path", { stroke: bone }, { stroke: grey }, right.at),
          state(h, ".ga-left", { color: bone }, { color: grey }, right.at)),
      };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center; }
      & .ga-route { position:relative;display:flex;align-items:center;padding:4px 0 4px 90px;min-height:58px; }
      & .ga-fork { position:absolute;inset:0 auto 0 0;width:72px;height:100%;fill:none;stroke:${bone};stroke-width:3;stroke-linecap:round;stroke-linejoin:round; }
      & .ga-fork path { vector-effect:non-scaling-stroke; }
      & .ga-lower { stroke:${gold}; }
      & .ga-fork path { stroke-dasharray:1;stroke-dashoffset:1; }
      & .ga-left,& .ga-right { ${inter(42, 50)} }
      & .ga-right { color:${gold}; }`,
  }),

  "reply-promote": card("reply-promote", ["quicktype-tap-up"], {
    variantOf: "quick-replies", family: "conversation", tags: ["conversation", "list"],
    slots: { incoming: spoken(48, 620), replies: repeat(spoken(22, 590, 1), 2, 3) },
    size: ({ slots }) => size(74 + lineHeight(slots.incoming[0]) + 58 * slots.replies.length),
    render(o, h) {
      const { incoming: [incoming], replies } = o.slots;
      const chosen = replies.at(-1);
      const options = replies.map((reply, i) => `<div class="ga-reply ga-reply-${i}">${copy(h, "ga-response", reply)}</div>`);
      const up = svg("ga-up", "0 0 32 32", path("M16 28V4m-9 9 9-9 9 9"));
      return {
        inner: copy(h, "ga-incoming", incoming) + `<div class="ga-options">${options.join("")}${up}</div>`,
        timeline: list(write(h, ".ga-incoming", incoming),
          replies.map((reply, i) => write(h, `.ga-reply-${i} .ga-response`, reply)),
          state(h, ".ga-reply:last-of-type", { y: 12, backgroundColor: ink }, { y: 0, backgroundColor: rule }, chosen.at),
          draw(h, ".ga-up path", chosen.at)),
      };
    },
    css: `
      & { display:flex;flex-direction:column;gap:14px; }
      & .ga-incoming { border-left:3px solid ${gold};padding:0 12px; }
      & .ga-options { position:relative;display:flex;flex-direction:column;gap:4px;padding-top:4px;border-top:2px solid ${rule}; }
      & .ga-reply { min-height:54px;color:${grey};padding:2px 12px; }
      & .ga-reply:last-of-type { color:${gold};border-radius:8px;padding-right:58px; }
      & .ga-up { position:absolute;bottom:10px;right:12px;width:32px;height:32px;fill:none;stroke:${gold};stroke-width:3;stroke-linecap:round;stroke-linejoin:round; }
      & .ga-up path { stroke-dasharray:1;stroke-dashoffset:1; }`,
  }),

  "pen-write-word": card("pen-write-word", ["markup-pen-marck", "great-vibes-wipe", "marck-script-signature-word"], {
    variantOf: "big-word", family: "payoff", tags: ["highlight", "title"],
    slots: { word: spoken(18, 600, 1, 64, oneWord) },
    size: size(168),
    render(o, h) {
      const [word] = o.slots.word;
      const nib = svg("ga-nib", "0 0 40 40", '<path d="m4 35 5-15L28 2l10 10-19 19-15 4Zm0 0L17 22"/><circle cx="19" cy="20" r="2"/>');
      return {
        inner: `<div class="ga-word">${copy(h, "ga-written", word)}${nib}</div>`,
        timeline: list(write(h, ".ga-written", word),
          enter(h, ".ga-nib", { left: "0%", opacity: 1 }, { left: "100%", opacity: 1 }, word.at),
          state(h, ".ga-nib", { opacity: 1 }, { opacity: 0 }, word.at + h.motion.enter)),
      };
    },
    css: `
      & { display:grid;place-items:center; }
      & .ga-word { width:max-content;max-width:600px;position:relative;padding-right:1px; }
      & .ga-written { font:400 64px/80px "Anton",sans-serif;color:${gold}; }
      & .ga-nib { position:absolute;top:54px;left:0;width:30px;height:30px;fill:${ink};stroke:${bone};stroke-width:2;opacity:0; }`,
  }),

  "stat-shutter": card("stat-shutter", ["hero-number-card"], {
    variantOf: "stat-disc", family: "proof", tags: ["number", "callout"],
    // Reuse the quantity parser's accepted formats through the wider stat-leaders value slot.
    slots: { value: spoken(36, 656, 2, 96, herkStats["stat-leaders"].slots.value.validate), context: spoken(52, 664, 2, 42) },
    size: ({ slots }) => size(60 + lineHeight(slots.value[0], 104) + lineHeight(slots.context[0], 50)),
    render(o, h) {
      const { value: [value], context: [context] } = o.slots;
      return {
        inner: `<div class="ga-window">${copy(h, "ga-stat", value)}</div>` + copy(h, "ga-context", context),
        timeline: list(write(h, ".ga-stat", value, { y: 12, clipPath: "inset(100% 0 0 0)" }, { y: 0 }),
          write(h, ".ga-context", context)),
      };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;gap:8px; }
      & .ga-window { overflow:hidden;border-bottom:2px solid ${gold}; }
      & .ga-stat { ${anton}color:${gold}; }
      & .ga-context { font:italic 600 42px/50px "Inter",sans-serif; }`,
  }),

  "battery-readout": card("battery-readout", ["battery-low-alert"], {
    variantOf: "percent-ring", family: "proof", tags: ["percent", "progress", "chart"],
    slots: {
      value: spoken(24, 564, 2, 96, (text) => percentValue(text) !== null),
      context: spoken(48, 564, 2, 42, (text) => /\b(?:remaining|left|available)\b/i.test(text)),
    },
    size: ({ slots }) => size(56 + lineHeight(slots.value[0], 104) + lineHeight(slots.context[0], 50)),
    render(o, h) {
      const { value: [value], context: [context] } = o.slots;
      const outline = '<rect x="5" y="22" width="60" height="112" rx="10"/><path d="M25 12h20"/>';
      const battery = svg("ga-battery", "0 0 70 140", outline + '<rect class="ga-charge" x="13" y="30" width="44" height="96" rx="4"/>');
      return {
        inner: battery + `<div>${copy(h, "ga-value", value)}${copy(h, "ga-context", context)}</div>`,
        timeline: list(write(h, ".ga-value", value), write(h, ".ga-context", context),
          state(h, ".ga-battery", { opacity: 0 }, { opacity: 1 }, value.at),
          state(h, ".ga-charge", { scaleY: 1 }, { scaleY: percentValue(value.text) / 100 }, value.at)),
      };
    },
    css: `
      & { display:grid;grid-template-columns:72px minmax(0,1fr);gap:20px;align-items:center; }
      & .ga-battery { width:72px;height:144px;fill:none;stroke:${grey};stroke-width:4;stroke-linecap:round;opacity:0; }
      & .ga-charge { fill:${gold};stroke:none;transform-box:fill-box;transform-origin:center bottom; }
      & .ga-value { ${anton}color:${gold}; }
      & .ga-context { ${inter(42, 50)} }`,
  }),

  "share-shift": card("share-shift", ["storage-bar-free-space-grows"], {
    variantOf: "case-study", family: "proof", tags: ["before-after", "percent", "chart"],
    slots: {
      before: spoken(24, 656, 2, 96, (text) => percentValue(text) !== null),
      after: spoken(24, 656, 2, 96, (text) => percentValue(text) !== null),
      label: spoken(42, 656, 2, 42),
    },
    validate: ({ before, after }) => percentValue(before[0].text) !== percentValue(after[0].text),
    size: ({ slots }) => size(112 + Math.max(lineHeight(slots.before[0], 104), lineHeight(slots.after[0], 104)) + lineHeight(slots.label[0], 50)),
    render(o, h) {
      const { before: [before], after: [after], label: [metric] } = o.slots;
      const start = percentValue(before.text) / 100, end = percentValue(after.text) / 100;
      const value = (cls, caption, item) => `<div class="ga-reading ${cls}">${label(caption)}${copy(h, "ga-share", item)}</div>`;
      const rail = '<div class="ga-allocation" aria-hidden="true"><div class="ga-part"></div><div class="ga-rest"></div></div>';
      return {
        inner: `<div class="ga-readings">${value("ga-before", "Before", before)}${value("ga-after", "After", after)}</div>` + rail + copy(h, "ga-metric", metric),
        timeline: list(
          enter(h, ".ga-before", { opacity: 0 }, { opacity: 1 }, before.at),
          write(h, ".ga-before .ga-share", before),
          state(h, ".ga-part", { scaleX: 0 }, { scaleX: start }, before.at),
          state(h, ".ga-rest", { scaleX: 0 }, { scaleX: 1 - start }, before.at),
          enter(h, ".ga-after", { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, after.at),
          state(h, ".ga-before", { opacity: 1 }, { opacity: 0 }, after.at),
          write(h, ".ga-after .ga-share", after),
          state(h, ".ga-part", { scaleX: start }, { scaleX: end }, after.at),
          state(h, ".ga-rest", { scaleX: 1 - start }, { scaleX: 1 - end }, after.at),
          write(h, ".ga-metric", metric),
        ),
      };
    },
    css: `
      & { display:flex;flex-direction:column;gap:8px; }
      & .ga-readings { display:grid; }
      & .ga-reading { grid-area:1/1;background:${ink};opacity:0; }
      & .ga-share { ${anton} }
      & .ga-after .ga-share { color:${gold}; }
      & .ga-allocation { position:relative;height:14px;flex:none;border-radius:7px;overflow:hidden;background:${rule}; }
      & .ga-allocation>div { position:absolute;inset:0;transform:scaleX(0); }
      & .ga-part { transform-origin:left;background:${gold}; }
      & .ga-rest { transform-origin:right;background:${grey}; }
      & .ga-metric { ${inter(42, 50)} }`,
  }),

  "countdown-window": card("countdown-window", ["countdown-pill"], {
    variantOf: "countdown", family: "procedure", tags: ["number", "list"],
    slots: { counts: repeat(spoken(16, 614, 1, 96, (text) => wholeNumber(text) !== null), 2, 4) },
    validate: ({ counts }) => counts.every((item, i) => i === 0 || wholeNumber(item.text) < wholeNumber(counts[i - 1].text)),
    size: size(176),
    render(o, h) {
      const { counts } = o.slots;
      const inner = `<div class="ga-count-window">${counts.map((item, i) => copy(h, `ga-count ga-count-${i}`, item)).join("")}</div>`;
      const timeline = list(counts.map((item, i) => list(
        i > 0 && state(h, `.ga-count-${i - 1}`, { opacity: 1, y: 0 }, { opacity: 0, y: -12 }, item.at),
        write(h, `.ga-count-${i}`, item, { y: 12 }, { y: 0 }))));
      return { inner, timeline };
    },
    css: `
      & { display:grid;place-items:center; }
      & .ga-count-window { width:100%;display:grid;place-items:center;border-block:2px solid ${gold};overflow:hidden; }
      & .ga-count { grid-area:1/1;max-width:614px;${anton}color:${gold}; }`,
  }),

  "booking-stamp": card("booking-stamp", ["calendar-day-fills"], {
    variantOf: "calendar", family: "payoff", tags: ["time", "callout"],
    slots: { event: spoken(30, 586, 2, 46), date: optional(spoken(24, 586)), details: optional(spoken(40, 586)) },
    size: ({ slots }) => size(94 + slots.event[0].lines.length * 54 +
      [...slots.date, ...slots.details].reduce((total, item) => total + lineHeight(item) + 4, 0)),
    render(o, h) {
      const { event: [event], date: [date], details: [details] } = o.slots;
      const box = svg("ga-day", "0 0 52 52", '<rect class="ga-day-fill" x="4" y="9" width="44" height="39" rx="6"/><path d="M4 21h44M15 4v10M37 4v10"/>');
      const inner = `<div class="ga-date-icon">${box}${tick("ga-day-tick")}</div><div>${label("Booked")}${copy(h, "ga-event", event)}` +
        (date ? copy(h, "ga-date", date) : "") + (details ? copy(h, "ga-details", details) : "") + "</div>";
      const at = date?.at ?? event.at;
      const timeline = list(write(h, ".ga-event", event), date && write(h, ".ga-date", date),
        details && write(h, ".ga-details", details), state(h, ".ga-day-fill", { fill: ink }, { fill: gold }, at),
        draw(h, ".ga-day-tick path", at));
      return { inner, timeline };
    },
    css: `
      & { display:grid;grid-template-columns:52px minmax(0,1fr);gap:18px;align-items:start; }
      & .ga-date-icon { position:relative;margin-top:34px;height:52px; }
      & .ga-day { display:block;width:52px;height:52px;fill:${ink};stroke:${gold};stroke-width:3;stroke-linecap:round; }
      & .ga-day-tick { position:absolute;top:22px;left:12px;width:28px;height:28px;fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round; }
      & .ga-day-tick path { stroke-dasharray:1;stroke-dashoffset:1; }
      & .ga-event { ${inter(46, 54, 800)} }
      & .ga-date,& .ga-details { margin-top:4px;color:${grey}; }`,
  }),

  "layered-alerts": card("layered-alerts", ["ios-notification-banner"], {
    variantOf: "alert-stack", family: "conversation", tags: ["message", "conversation"],
    slots: Object.fromEntries([1, 2, 3].flatMap((i) => [[`title${i}`, spoken(28, 556)], [`message${i}`, spoken(38, 556)]])),
    size: ({ slots }) => size(104 + Math.max(...[1, 2, 3].map((i) => lineHeight(slots[`title${i}`][0]) + lineHeight(slots[`message${i}`][0])))),
    render(o, h) {
      const { slots } = o;
      const layers = [1, 2, 3].map((i) => {
        const [title] = slots[`title${i}`], [message] = slots[`message${i}`];
        const icon = svg("ga-notice", "0 0 40 40", path("M4 6h32v22H20l-9 7v-7H4zM11 14h18M11 21h10"));
        return {
          html: `<div class="ga-banner ga-banner-${i}">${icon}<div>${copy(h, "ga-title", title)}${copy(h, "ga-body", message)}</div></div>`,
          timeline: list(
            enter(h, `.ga-banner-${i}`, { y: -12, opacity: 0 }, { y: 0, opacity: 1 }, title.at),
            write(h, `.ga-banner-${i} .ga-title`, title), write(h, `.ga-banner-${i} .ga-body`, message),
            i > 1 && state(h, `.ga-banner-${i - 1}`, { y: 0, opacity: 1 }, { y: 8, opacity: 0 }, title.at),
            i > 1 && state(h, `.ga-layer-${i}`, { y: -8, opacity: 0 }, { y: 0, opacity: 1 }, title.at)),
        };
      });
      return {
        inner: '<div class="ga-layer ga-layer-3" aria-hidden="true"></div><div class="ga-layer ga-layer-2" aria-hidden="true"></div>' +
          layers.map(({ html }) => html).join(""),
        timeline: list(layers.map((layer) => layer.timeline)),
      };
    },
    css: `
      & { display:grid;padding-bottom:40px; }
      & .ga-banner { grid-area:1/1;display:grid;grid-template-columns:36px minmax(0,1fr);align-content:start;gap:14px;padding:12px 16px;border:2px solid ${gold};border-radius:10px;background:${ink};opacity:0; }
      & .ga-layer { position:absolute;bottom:32px;left:44px;right:44px;height:12px;border:2px solid ${rule};border-radius:8px;background:${ink};opacity:0; }
      & .ga-layer-3 { bottom:24px;left:60px;right:60px; }
      & .ga-notice { width:36px;height:36px;fill:none;stroke:${gold};stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round; }
      & .ga-title { color:${gold}; }
      & .ga-body { font-weight:600; }`,
  }),

  "thread-handoff": card("thread-handoff", ["messages-chat-thread"], {
    variantOf: "text-thread", family: "conversation", tags: ["message", "conversation"],
    slots: { messages: repeat(spoken(44, 556, 2, 42), 1, 3) },
    size: ({ slots }) => size(96 + slots.messages.reduce((h, item) => h + 20 + lineHeight(item, 50), 0)),
    render(o, h) {
      const { messages } = o.slots;
      const dots = svg("ga-dots", "0 0 64 16", '<circle cx="10" cy="8" r="5"/><circle cx="32" cy="8" r="5"/><circle cx="54" cy="8" r="5"/>');
      const inner = messages.map((item, i) => `<div class="ga-turn ga-turn-${i}">${i ? dots : ""}${copy(h, "ga-bubble", item)}</div>`).join("");
      const timeline = messages.map((item, i) => {
        const row = `.ga-turn-${i}`;
        return list(
          i > 0 && enter(h, `${row} .ga-dots`, { opacity: 0 }, { opacity: 1 }, Math.max(messages[i - 1].at, item.at - h.motion.enter)),
          i > 0 && state(h, `${row} .ga-dots`, { opacity: 1 }, { opacity: 0 }, item.at),
          enter(h, `${row} .ga-bubble`, { borderColor: rule, backgroundColor: ink }, { borderColor: grey, backgroundColor: rule }, item.at),
          write(h, `${row} .ga-bubble`, item, { y: 8 }, { y: 0 }));
      });
      return { inner, timeline: list(timeline) };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;gap:10px; }
      & .ga-turn { position:relative;display:flex;align-items:center; }
      & .ga-turn:nth-child(even) { justify-content:flex-end; }
      & .ga-bubble { width:max-content;max-width:578px;${inter(42, 50, 600)}padding:5px 10px;border:1px solid ${rule};border-radius:8px; }
      & .ga-dots { position:absolute;left:0;top:14px;width:64px;height:16px;fill:${gold};opacity:0; }
      & .ga-turn:nth-child(even) .ga-dots { left:auto;right:0; }`,
  }),

  "voicemail-playhead": card("voicemail-playhead", ["voice-memo-waveform"], {
    variantOf: "voicemail", family: "conversation", tags: ["conversation", "message"],
    slots: { transcript: spoken(64, 664, 2, 42) },
    size: ({ slots }) => size(116 + lineHeight(slots.transcript[0], 50)),
    render(o, h) {
      const [transcript] = o.slots.transcript;
      const bars = [20, 32, 14, 36, 26, 40, 18, 30, 24, 12, 34, 26, 14, 30, 16, 24, 36, 12].map((bar, i) =>
        `<path d="M${8 + i * 16} ${(48 - bar) / 2}v${bar}"/>`).join("");
      const wave = svg("ga-wave", "0 0 288 48", bars, true);
      return {
        inner: `<div class="ga-playback">${label("Voicemail")}<div class="ga-wave-strip">${wave}<i class="ga-playhead" aria-hidden="true"></i></div></div>` + copy(h, "ga-transcript", transcript),
        timeline: list(write(h, ".ga-transcript", transcript), state(h, ".ga-playhead", { left: "0%", opacity: 0 }, { left: "100%", opacity: 1 }, transcript.at)),
      };
    },
    css: `
      & { display:flex;flex-direction:column;gap:12px; }
      & .ga-playback { display:flex;align-items:center;gap:18px;border-bottom:2px solid ${rule};padding-bottom:4px; }
      & .ga-wave-strip { position:relative;flex:1;height:48px;overflow:hidden; }
      & .ga-wave { display:block;width:100%;height:48px;fill:none;stroke:${grey};stroke-width:3;stroke-linecap:round; }
      & .ga-wave path { vector-effect:non-scaling-stroke; }
      & .ga-playhead { position:absolute;top:0;left:0;width:3px;height:48px;background:${gold};opacity:0;transform:translateX(-3px); }
      & .ga-transcript { ${inter(42, 50)} }`,
  }),
};

function percentValue(text) {
  const match = text.match(/^(.+?)\s*(?:%|percent|per cent)[.,!?]?$/i);
  if (!match) return null;
  const raw = match[1].trim();
  const value = /^\d{1,3}\.\d+$/.test(raw) ? Number(raw) : wholeNumber(raw);
  return value !== null && value <= 100 ? value : null;
}
