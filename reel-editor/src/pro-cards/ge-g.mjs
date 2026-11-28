// Layout and motion ideas adapted from ghost-editor (MIT, copyright 2026 kurbaitaev).
// See src/pro-cards/GHOST-EDITOR-LICENSE.md.
import { CARDS as conversation } from "./conversation-2.mjs";
import { CARDS as payoff } from "./distinction-payoff.mjs";
import { CARDS as section } from "./herk-ksection.mjs";
import { CARDS as stats } from "./herk-kstat.mjs";
import { CARDS as overview } from "./herk-voverview.mjs";
import { CARDS as procedure } from "./procedure-2.mjs";
import { CARDS as proof } from "./proof-2.mjs";

const roots = { ...conversation, ...payoff, ...section, ...stats, ...overview, ...procedure, ...proof };
const ink = "#0B0B0D", bone = "#F5F1E8", gold = "#C8A24B", grey = "#A8A49C", rule = "#343438";
const source = (...ids) => ids.map((id) => `ghost-editor:${id}`).join(",");

// Use the planner's width estimate at the drawn size. The planner normally tries a smaller font if a line overflows.
function spoken(maxChars, width, size = 40, maxLines = 2, fits = () => true) {
  const measure = (text) => [...text].reduce((sum, c) => sum +
    (/\s/.test(c) ? 0.3 : /[ilI.,!'’]/.test(c) ? 0.32 : /[MW@]/.test(c) ? 0.95 : /[A-Z]/.test(c) ? 0.75 : 0.65) * size, 0);
  return { kind: "spoken", maxChars, width, size, maxLines, validate(text) {
    if (!text.trim() || /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u20E3]/u.test(text)) return false;
    const lines = [];
    for (const word of text.trim().split(/\s+/)) {
      if (measure(word) > width) return false;
      const last = lines.at(-1);
      if (last && measure(`${last} ${word}`) <= width) lines[lines.length - 1] += ` ${word}`;
      else lines.push(word);
    }
    return lines.length <= maxLines && fits(text, lines);
  } };
}

const repeat = (slot, min, max) => ({ ...slot, repeat: [min, max] });
const count = proof.odometer.slots.value.validate;

// Check the exact wrapped count at Anton's advances, including the hyphens of written-out numbers.
function figure(maxChars, width, maxLines = 1, check = count) {
  const advance = (line) => [...line].reduce((sum, c) => sum +
    (c === "%" ? 1.07 : /[., iIl!]/.test(c) ? 0.25 : /[fjt1]/.test(c) ? 0.34 :
      /[-r]/.test(c) ? 0.35 : /[mM]/.test(c) ? 0.76 : /[wW]/.test(c) ? 0.72 : 0.51), 0);
  return spoken(maxChars, Math.round(width * 1.43), 96, maxLines,
    (text, lines) => check(text) && lines.every((line) => advance(line) * 96 <= width));
}

const ones = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const tens = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const shareWords = new Map([
  ["half", 50], ["a half", 50], ["one half", 50], ["a quarter", 25], ["one quarter", 25], ["three quarters", 75],
]);

// The grid represents the whole at one dot per percentage point, independent of the stated group size.
function wholeShare(text) {
  const phrase = text.trim().toLowerCase().replace(/[.!?,]$/, "").replace(/(?<=[a-z])-(?=[a-z])/g, " ");
  if (shareWords.has(phrase)) return shareWords.get(phrase);
  const value = phrase.match(/^(.+?)\s*(?:%|per ?cent)$/)?.[1];
  if (!value) return null;
  if (/^\d{1,3}$/.test(value)) return +value <= 100 ? +value : null;
  if (value === "one hundred") return 100;
  const small = ones.indexOf(value);
  if (small !== -1) return small;
  const [ten, one, extra] = value.split(/\s+/);
  const decade = tens.indexOf(ten);
  const unit = one ? ones.indexOf(one) : 0;
  return decade >= 0 && !extra && unit >= (one ? 1 : 0) && unit < 10 ? (decade + 2) * 10 + unit : null;
}
const closed = "inset(0 100% 0 0)", open = "inset(0 0 0 0)";
const hidden = `min-width:0;opacity:0;clip-path:${closed};`;
const flow = `display:flex;flex-direction:column;justify-content:center;padding:24px 32px;background:${ink};color:${bone};font:700 40px/48px "Inter",sans-serif;`;
const pen = `fill:none;stroke:${gold};stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;`;

function panel(type, def, rules) {
  const css = Object.entries({ "": flow, ".ge-copy": hidden, ...rules }).map(([selector, styles]) =>
    `  .pro-${type}${selector ? " " + selector : ""} { ${styles} }`).join("\n");
  const hint = def.variantOf ? roots[def.variantOf].hint : def.hint;
  return { surface: "obsidian", ...def, hint, css };
}

function tween(h, selector, from, to, at, motion = "enter") {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion[motion]},ease:${motion === "enter" ? "proEnter" : "proState"},immediateRender:false},${h.at(at)});`;
}

const state = (h, selector, from, to, at) => tween(h, selector, from, to, at, "state");
const write = (h, selector, at, clipPath = closed) =>
  tween(h, selector, { opacity: 0, clipPath }, { opacity: 1, clipPath: open }, at);
const rise = (h, selector, at) => tween(h, selector, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, at);
const draw = (h, selector, at) => state(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at);
const fillBox = (h, selector, at) => tween(h, selector, { scaleX: 0 }, { scaleX: 1 }, at);
const copy = (h, item, cls) => `<div class="ge-copy ${cls}">${h.copy(item)}</div>`;

const send = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m7 24 33-15-13 31-5-14Z M22 26 40 9"/><path class="ge-check" pathLength="1" d="m11 26 8 8 18-19"/></svg>`;
const quoteMark = `<svg class="ge-quote-mark" viewBox="0 0 40 32" aria-hidden="true"><path d="M2 28V16C2 8 7 3 17 2v5c-5 2-7 4-7 8h7v13Zm21 0V16c0-8 5-13 15-14v5c-5 2-7 4-7 8h7v13Z"/></svg>`;

export const CARDS = {
  "rising-sheets": panel("rising-sheets", {
    variantOf: "stack-fan",
    family: "procedure",
    tags: ["list", "steps"],
    source: source("product-page/signature-rise-stack-pages"),
    slots: { items: repeat(spoken(40, 552), 2, 4) },
    size: (o) => ({ w: 720, h: 56 + o.slots.items.length * 110 }),
    render(o, h) {
      const items = o.slots.items;
      const inner = items.map((item, i) => `<div class="ge-sheet ge-sheet-${i}" style="margin-left:${i * 16}px">${copy(h, item, `ge-item-${i}`)}</div>`).join("");
      const timeline = items.flatMap(({ at }, i) => [
        rise(h, `.ge-sheet-${i}`, at),
        write(h, `.ge-item-${i}`, at),
        ...(i ? [state(h, `.ge-sheet-${i - 1}`, { borderTopColor: gold }, { borderTopColor: grey }, at)] : []),
      ]);
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    "": flow + "gap:6px;line-height:44px;",
    ".ge-sheet": `width:608px;min-height:104px;display:grid;align-items:center;padding:6px 24px;border:2px solid ${rule};border-top:4px solid ${gold};border-radius:8px;opacity:0;`,
  }),

  "height-marks": panel("height-marks", {
    variantOf: "staircase",
    family: "procedure",
    tags: ["steps", "progress"],
    source: source("product-page/prop-art-doorframe-height-marks"),
    slots: { steps: repeat(spoken(30, 544, 40, 1), 2, 4) },
    size: (o) => ({ w: 720, h: 64 + o.slots.steps.length * 60 }),
    render(o, h) {
      const inner = `<div class="ge-ruler">${o.slots.steps.map((item, i) =>
        `<div class="ge-mark-row"><svg viewBox="0 0 56 24" aria-hidden="true"><path class="ge-mark-${i}" pathLength="1" d="M3 12H${i === o.slots.steps.length - 1 ? 53 : 34}"/></svg>${copy(h, item, `ge-step-${i}`)}</div>`).join("")}</div>`;
      const timeline = o.slots.steps.flatMap(({ at }, i) => [
        draw(h, `.ge-mark-${i}`, at), write(h, `.ge-step-${i}`, at),
        ...(i ? [state(h, `.ge-mark-${i - 1}`, { stroke: gold }, { stroke: grey }, at)] : []),
      ]);
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    ".ge-ruler": `display:flex;flex-direction:column-reverse;margin-left:24px;border-left:3px solid ${rule};border-top:3px solid ${rule};`,
    ".ge-mark-row": "height:60px;display:grid;grid-template-columns:56px 1fr;gap:16px;align-items:center;",
    ".ge-mark-row svg": "width:56px;height:24px;",
    ".ge-mark-row path": pen,
  }),

  "draft-send": panel("draft-send", {
    variantOf: "typing",
    family: "conversation",
    tags: ["message", "conversation"],
    source: source("product-page/scene-split-chat-typing-send"),
    slots: { message: spoken(48, 592) },
    size: { w: 720, h: 224 },
    render(o, h) {
      const [message] = o.slots.message;
      const inner = `<div class="ge-draft"><div class="ge-status"><span>Draft</span><span class="ge-sent">Sent</span></div>${send}${copy(h, message, "ge-message")}</div>`;
      // The slot provides its opening onset and closing boundary. Commit when the speaker finishes the line.
      const commit = Math.max(message.end, message.at + h.motion.enter);
      const timeline = [
        write(h, ".ge-message", message.at),
        state(h, ".ge-draft", { x: 0, borderColor: rule }, { x: 16, borderColor: gold }, commit),
        state(h, ".ge-status span:first-child", { opacity: 1 }, { opacity: 0 }, commit),
        state(h, ".ge-sent", { opacity: 0 }, { opacity: 1 }, commit),
        state(h, ".ge-draft svg path:first-child", { opacity: 1 }, { opacity: 0 }, commit),
        draw(h, ".ge-check", commit),
      ];
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    ".ge-draft": `position:relative;width:636px;padding:16px 20px;border:2px solid ${rule};border-radius:14px 14px 3px 14px;`,
    ".ge-status": `display:grid;margin-bottom:6px;font:700 28px/34px "Inter",sans-serif;color:${grey};`,
    ".ge-status span": "grid-area:1/1;",
    ".ge-status .ge-sent": `opacity:0;color:${gold};`,
    ".ge-draft svg": `position:absolute;right:16px;top:8px;width:38px;height:38px;fill:none;stroke:${grey};stroke-width:3;stroke-linecap:round;stroke-linejoin:round;`,
    ".ge-check": pen,
  }),

  "voice-playback": panel("voice-playback", {
    variantOf: "voicemail",
    family: "conversation",
    tags: ["message", "conversation"],
    source: source("product-page/scene-split-voice-message-plays"),
    slots: { transcript: spoken(64, 648, 40, 3) },
    size: (o) => ({ w: 720, h: 124 + o.slots.transcript[0].lines.length * 48 }),
    render(o, h) {
      const [transcript] = o.slots.transcript;
      // This fixed waveform is ornament, with no elapsed-time label or claimed audio measurements.
      const bars = [12, 26, 20, 38, 28, 20, 34, 42, 24, 32, 40, 18, 26, 36, 24, 10]
        .map((height, i) => `<path d="M${4 + i * 12} ${(48 - height) / 2}v${height}"/>`).join("");
      const wave = `<svg viewBox="0 0 188 48" aria-hidden="true">${bars}</svg>`;
      const control = `<svg class="ge-control" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22"/><path class="ge-play" d="m19 14 15 10-15 10Z"/><path class="ge-pause" d="M19 15v18m10-18v18"/></svg>`;
      const inner = `<div class="ge-player">${control}<div class="ge-player-label">Voicemail</div><div class="ge-wave">${wave}<div class="ge-wave-active">${wave}</div></div></div>${copy(h, transcript, "ge-transcript")}`;
      const timeline = [
        write(h, ".ge-transcript", transcript.at),
        state(h, ".ge-play", { opacity: 1 }, { opacity: 0 }, transcript.at),
        state(h, ".ge-pause", { opacity: 0 }, { opacity: 1 }, transcript.at),
        state(h, ".ge-wave-active", { clipPath: closed }, { clipPath: open }, transcript.at),
      ];
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    ".ge-player": `display:flex;align-items:center;gap:18px;margin-bottom:14px;padding-bottom:12px;border-bottom:2px solid ${rule};`,
    ".ge-player-label": `font:700 28px/34px "Inter",sans-serif;color:${grey};`,
    ".ge-control": `width:48px;height:48px;fill:none;stroke:${grey};stroke-width:3;`,
    ".ge-control .ge-play": `fill:${grey};stroke:none;`,
    ".ge-control .ge-pause": `stroke:${gold};stroke-width:4;stroke-linecap:round;opacity:0;`,
    ".ge-wave": `position:relative;flex:1;height:48px;fill:none;stroke:${grey};stroke-width:3;stroke-linecap:round;`,
    ".ge-wave svg": "display:block;width:100%;height:48px;",
    ".ge-wave-active": `position:absolute;inset:0;stroke:${gold};clip-path:${closed};`,
  }),

  "audience-focus": panel("audience-focus", {
    family: "distinction",
    tags: ["comparison", "highlight"],
    hint: "Greg first names a broad audience or lead pool, then explicitly names the narrower segment or lead to prioritize inside it",
    source: source("product-page/prop-art-crowd-dots-one-alone", "step-deck/scene-dot-crowd-rack"),
    slots: { audience: spoken(38, 480), focus: spoken(42, 480, 42, 3) },
    size: (o) => ({ w: 720, h: 48 + Math.max(170, 20 + o.slots.audience[0].lines.length * 48 + o.slots.focus[0].lines.length * 50) }),
    render(o, h) {
      const { audience: [audience], focus: [focus] } = o.slots;
      // The field is qualitative and does not represent a headcount. Leave a clearing for the target.
      const dots = ["15,30", "43,24", "75,20", "108,17", "139,40", "27,57", "58,54", "122,67", "9,86",
        "44,83", "132,98", "16,119", "54,111", "111,126", "138,130", "29,147", "64,139", "87,149"].map((point) => {
        const [cx, cy] = point.split(",");
        return `<circle cx="${cx}" cy="${cy}" r="4"/>`;
      }).join("");
      const field = `<svg class="ge-field" viewBox="0 0 150 170" aria-hidden="true"><g class="ge-neighbors">${dots}</g><circle class="ge-clearing" cx="86" cy="85" r="26"/><circle class="ge-target" cx="86" cy="85" r="9"/></svg>`;
      const inner = field + `<div class="ge-audience-lines">${copy(h, audience, "ge-audience")}${copy(h, focus, "ge-focus")}</div>`;
      const timeline = [
        rise(h, ".ge-field", audience.at), write(h, ".ge-audience", audience.at),
        write(h, ".ge-focus", focus.at),
        state(h, ".ge-neighbors", { opacity: 0.9 }, { opacity: 0.36 }, focus.at),
        state(h, ".ge-clearing", { opacity: 0 }, { opacity: 1 }, focus.at),
        state(h, ".ge-target", { fill: grey }, { fill: gold }, focus.at),
      ];
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    "": flow + "flex-direction:row;justify-content:space-between;align-items:center;gap:20px;",
    ".ge-field": "width:150px;height:170px;flex:none;opacity:0;",
    ".ge-neighbors": `fill:${grey};opacity:.9;`,
    ".ge-clearing": `fill:none;stroke:${gold};stroke-width:2;stroke-dasharray:3 5;opacity:0;`,
    ".ge-target": `fill:${grey};`,
    ".ge-audience-lines": "width:480px;min-width:0;display:grid;gap:10px;",
    ".ge-audience": `color:${grey};`,
    ".ge-focus": `padding-top:8px;border-top:2px solid ${rule};color:${gold};font:800 42px/50px "Inter",sans-serif;`,
  }),

  "reply-selection": panel("reply-selection", {
    variantOf: "quick-replies",
    family: "conversation",
    tags: ["conversation", "list"],
    source: source("product-page/idea-9"),
    slots: { incoming: spoken(48, 604), replies: repeat(spoken(26, 524), 2, 3) },
    size: (o) => ({
      w: 720,
      h: 72 + o.slots.incoming[0].lines.length * 48 +
        o.slots.replies.reduce((height, reply) => height + 6 + Math.max(56, reply.lines.length * 48 + 8), 0),
    }),
    render(o, h) {
      const { incoming: [incoming], replies } = o.slots;
      const rows = replies.map((reply, i) =>
        `<div class="ge-reply ge-reply-${i}">${copy(h, reply, `ge-option-${i}`)}${i === replies.length - 1 ? send : ""}</div>`);
      const last = replies.length - 1;
      const at = replies[last].at;
      const timeline = [
        write(h, ".ge-incoming", incoming.at),
        ...replies.flatMap((item, i) => [rise(h, `.ge-reply-${i}`, item.at), write(h, `.ge-option-${i}`, item.at)]),
        state(h, `.ge-reply-${last}`, { x: 16, borderColor: rule, color: bone }, { x: 0, borderColor: gold, color: gold }, at),
      ];
      return { inner: copy(h, incoming, "ge-incoming") + rows.join(""), timeline: timeline.join("\n") };
    },
  }, {
    "": flow + "gap:6px;",
    ".ge-incoming": `padding:6px 20px;margin:0 0 6px;background:${rule};border-radius:8px;`,
    ".ge-reply": `position:relative;width:640px;min-height:56px;display:grid;align-items:center;padding:2px 16px;border:2px solid ${rule};border-radius:8px;opacity:0;`,
    ".ge-reply svg": `position:absolute;right:12px;top:8px;width:36px;height:36px;fill:none;stroke:${gold};stroke-width:3;stroke-linecap:round;stroke-linejoin:round;`,
    ".ge-reply .ge-check": "display:none;",
  }),

  "comment-keyword-offer": panel("comment-keyword-offer", {
    family: "payoff",
    tags: ["callout", "highlight"],
    hint: "Greg explicitly asks viewers to comment a specific keyword and then says what they get from his real offer; use his exact instruction, keyword and offer",
    source: source("product-page/idea-14"),
    slots: { instruction: spoken(27, 640, 40, 1), keyword: spoken(26, 598, 56, 1), offer: spoken(58, 640) },
    size: { w: 720, h: 308 },
    validate({ instruction, keyword }) {
      return keyword[0].from === instruction[0].to + 1;
    },
    render(o, h) {
      const { instruction: [instruction], keyword: [keyword], offer: [offer] } = o.slots;
      const inner = copy(h, instruction, "ge-instruction") +
        `<div class="ge-keyword-box"><div class="ge-fill" aria-hidden="true"></div>${copy(h, keyword, "ge-keyword")}</div>` +
        copy(h, offer, "ge-offer");
      const timeline = [
        write(h, ".ge-instruction", instruction.at),
        fillBox(h, ".ge-fill", keyword.at),
        write(h, ".ge-keyword", keyword.at),
        write(h, ".ge-offer", offer.at),
      ];
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    "": flow + "align-items:flex-start;gap:10px;",
    ".ge-keyword-box": "position:relative;max-width:100%;",
    ".ge-fill": `position:absolute;inset:0;background:${gold};border-radius:4px;transform:scaleX(0);transform-origin:left;`,
    ".ge-keyword": `position:relative;padding:4px 20px;color:${ink};font:400 56px/68px "Anton",sans-serif;`,
  }),

  "center-out-title": panel("center-out-title", {
    variantOf: "chapter-screen",
    family: "emphasis",
    tags: ["title", "highlight"],
    source: source("step-deck/idea-2"),
    slots: { headline: spoken(46, 568, 52) },
    size: { w: 720, h: 196 },
    render(o, h) {
      const [headline] = o.slots.headline;
      const inner = `<div class="ge-title-band">${copy(h, headline, "ge-headline")}</div>`;
      const timeline = [
        tween(h, ".ge-title-band", { clipPath: "inset(0 50% 0 50%)" }, { clipPath: open }, headline.at),
        write(h, ".ge-headline", headline.at, "inset(0 50% 0 50%)"),
      ];
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    "": flow + "padding:22px 32px;",
    ".ge-title-band": `display:grid;place-items:center;min-height:110px;padding:12px 34px;background:${gold};color:${ink};clip-path:inset(0 50% 0 50%);`,
    ".ge-headline": 'font:800 52px/60px "Inter",sans-serif;text-align:center;',
  }),

  "stacked-promise": panel("stacked-promise", {
    variantOf: "section-title-strips",
    family: "emphasis",
    tags: ["title", "highlight"],
    source: source("step-deck/scene-title-caps-rgb-split"),
    slots: { lines: repeat(spoken(26, 620, 64, 1), 2, 3) },
    size: (o) => ({ w: 720, h: o.slots.lines.length === 2 ? 212 : 264 }),
    render(o, h) {
      const lines = o.slots.lines;
      const inner = `<div class="ge-title">${lines.map((item, i) => copy(h, item, `ge-tier-${i}`)).join("")}</div>`;
      const timeline = [
        tween(h, ".ge-title", { scale: 1.04 }, { scale: 1 }, lines[0].at),
        ...lines.map(({ at }, i) => write(h, `.ge-tier-${i}`, at)),
      ];
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    ".ge-title": 'width:620px;align-self:center;display:grid;gap:6px;text-align:center;font:700 44px/52px "Inter",sans-serif;',
    ".ge-title .ge-copy:last-child": `color:${gold};font:400 64px/76px "Anton",sans-serif;`,
  }),

  "count-settle": panel("count-settle", {
    variantOf: "odometer",
    family: "proof",
    tags: ["number"],
    source: source("step-deck/scene-counter-1-to-10"),
    slots: { value: figure(30, 640, 2), label: spoken(32, 640, 40, 1) },
    size: (o) => ({ w: 720, h: 122 + o.slots.value[0].lines.length * 106 }),
    render(o, h) {
      const { value: [value], label: [label] } = o.slots;
      // Give the exact count a rolling entrance. No intermediate count was spoken.
      const timeline = [
        tween(h, ".ge-value", { opacity: 0, clipPath: "inset(100% 0 0 0)", y: 12 }, { opacity: 1, clipPath: open, y: 0 }, value.at),
        write(h, ".ge-count-label", label.at),
      ];
      return { inner: copy(h, value, "ge-value") + copy(h, label, "ge-count-label"), timeline: timeline.join("\n") };
    },
  }, {
    "": flow + "gap:8px;text-align:center;",
    ".ge-value": `color:${gold};font:400 96px/106px "Anton",sans-serif;`,
    ".ge-count-label": `padding-top:8px;border-top:2px solid ${rule};`,
  }),

  "quote-aperture": panel("quote-aperture", {
    variantOf: "quote",
    family: "payoff",
    tags: ["quote", "highlight"],
    source: source("step-deck/scene-quote-box-word-reveal", "step-deck/idea-7"),
    slots: { quote: spoken(92, 556, 46, 4) },
    size: (o) => ({ w: 720, h: 102 + o.slots.quote[0].lines.length * 54 }),
    render(o, h) {
      const [quote] = o.slots.quote;
      const inner = `<div class="ge-quote-box">${quoteMark}${copy(h, quote, "ge-quote")}</div>`;
      const timeline = [
        tween(h, ".ge-quote-box", { clipPath: "inset(0 50% 0 50%)" }, { clipPath: open }, quote.at),
        write(h, ".ge-quote", quote.at),
      ];
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    "": flow + "padding:18px 24px;",
    ".ge-quote-box": `display:grid;grid-template-columns:40px 1fr;gap:16px;align-items:start;padding:20px 24px;background:${bone};color:${ink};border-bottom:5px solid ${gold};clip-path:inset(0 50% 0 50%);`,
    ".ge-quote-mark": `width:40px;height:32px;margin-top:7px;fill:${gold};`,
    ".ge-quote": 'font:800 46px/54px "Inter",sans-serif;',
  }),

  "milestone-draw": panel("milestone-draw", {
    variantOf: "roadmap",
    family: "procedure",
    tags: ["steps", "timeline", "flow"],
    source: source("step-deck/scene-path-drawing-empty-spots"),
    slots: { pins: repeat(spoken(28, 514, 40, 1), 2, 4) },
    size: (o) => ({ w: 720, h: 56 + o.slots.pins.length * 60 }),
    render(o, h) {
      const pins = o.slots.pins;
      const x = (i) => i % 2 ? 76 : 24;
      const y = (i) => 30 + i * 60;
      const tracks = pins.slice(1).map((_, j) => {
        const i = j + 1, d = `M${x(j)} ${y(j)}C${x(j)} ${y(j) + 30} ${x(i)} ${y(i) - 30} ${x(i)} ${y(i)}`;
        return `<path class="ge-track" d="${d}"/><path class="ge-trace ge-trace-${i}" pathLength="1" d="${d}"/>`;
      }).join("");
      const nodes = pins.map((_, i) =>
        `<circle class="ge-node ge-node-${i}" cx="${x(i)}" cy="${y(i)}" r="${i === pins.length - 1 ? 11 : 7}"/>`).join("");
      const route = `<svg class="ge-route" viewBox="0 0 100 ${pins.length * 60}" aria-hidden="true">${tracks}${nodes}</svg>`;
      const inner = route + `<div>${pins.map((item, i) => copy(h, item, `ge-pin ge-pin-${i}`)).join("")}</div>`;
      const timeline = pins.flatMap(({ at }, i) => [
        write(h, `.ge-pin-${i}`, at),
        state(h, `.ge-node-${i}`, { fill: ink, stroke: grey }, { fill: gold, stroke: gold }, at),
        ...(i ? [draw(h, `.ge-trace-${i}`, at)] : []),
      ]);
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    "": flow + "display:grid;grid-template-columns:100px 1fr;gap:18px;align-content:center;",
    ".ge-route": "display:block;width:100px;",
    ".ge-track": `fill:none;stroke:${rule};stroke-width:3;stroke-dasharray:3 5;`,
    ".ge-trace": pen,
    ".ge-node": `fill:${ink};stroke:${grey};stroke-width:3;`,
    ".ge-pin": "display:grid;align-content:center;height:60px;",
    ".ge-pin:last-child": `color:${gold};`,
  }),

  "count-ring-pair": panel("count-ring-pair", {
    variantOf: "side-by-side-metrics",
    family: "proof",
    tags: ["number", "comparison"],
    source: source("step-deck/idea-6"),
    slots: {
      first: figure(14, 580), firstContext: spoken(25, 550, 40, 1),
      second: figure(14, 580), secondContext: spoken(25, 550, 40, 1),
    },
    size: { w: 720, h: 384 },
    render(o, h) {
      // The ring is a reveal border. Its length does not encode a percentage or compare the two counts.
      const ring = `<svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="30"/><circle class="ge-ring-stroke" cx="36" cy="36" r="30" pathLength="1" transform="rotate(-90 36 36)"/></svg>`;
      const rows = ["first", "second"];
      const inner = rows.map((name) => `<div class="ge-metric ge-${name}">${ring}<div>${copy(h, o.slots[name][0], `ge-${name}-value ge-count`)}${copy(h, o.slots[`${name}Context`][0], `ge-${name}-context`)}</div></div>`).join("");
      const timeline = rows.flatMap((name) => [
        write(h, `.ge-${name}-value`, o.slots[name][0].at, "inset(100% 0 0 0)"),
        draw(h, `.ge-${name} .ge-ring-stroke`, o.slots[name][0].at),
        write(h, `.ge-${name}-context`, o.slots[`${name}Context`][0].at),
      ]);
      return { inner, timeline: timeline.join("\n") };
    },
  }, {
    "": flow + "gap:8px;padding:24px 32px;",
    ".ge-metric": "display:grid;grid-template-columns:60px 1fr;gap:16px;align-items:center;",
    ".ge-metric + .ge-metric": `padding-top:6px;border-top:2px solid ${rule};`,
    ".ge-metric svg": `width:60px;height:60px;fill:none;stroke:${rule};stroke-width:4;`,
    ".ge-metric .ge-ring-stroke": pen,
    ".ge-count": `font:400 96px/106px "Anton",sans-serif;color:${gold};`,
  }),
};
