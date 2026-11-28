// Restyled from the iart.ai motion skill packs, MIT license, copyright 2026 iart.ai. See src/pro-cards/IART-LICENSE.md.
import { CARDS as overview } from "./herk-koverview.mjs";
import { CARDS as section } from "./herk-ksection.mjs";
import { CARDS as figures } from "./herk-kstat.mjs";
import { CARDS as extendedOverview } from "./herk-voverview.mjs";
import { CARDS as procedureProof } from "./procedure-proof.mjs";
import { CARDS as proof } from "./proof-2.mjs";
import { CARDS as emphasis } from "./warning-emphasis-full.mjs";

const existing = { ...overview, ...section, ...figures, ...extendedOverview, ...procedureProof, ...proof, ...emphasis };

const sources = (pack, skill, ...recipes) => recipes.map((recipe) => `iart:iart-${pack}-skills/${skill}#${recipe}`).join(",");
const all = (...groups) => groups.join(",");
const { entries, fromEntries } = Object;

// Use the fitter's conservative advances to ground at the authored size, before it tries smaller type.
function fitsAtSize(text, { width, size, maxLines }) {
  const measure = (line) => [...line].reduce((sum, char) =>
    sum + (/\s/.test(char) ? 0.3 : /[ilI.,!'’]/.test(char) ? 0.32 : /[MW@]/.test(char) ? 0.95 : /[A-Z]/.test(char) ? 0.75 : 0.65) * size, 0);
  let current = "", lines = 0;
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (measure(word) > width) return false;
    const extended = current ? `${current} ${word}` : word;
    if (current && measure(extended) <= width) current = extended;
    else {
      current = word;
      if (++lines > maxLines) return false;
    }
  }
  return lines > 0;
}

function spoken(maxChars, width = 656, size = 40, maxLines = 2, check) {
  const fit = { width, size, maxLines };
  return {
    kind: "spoken", maxChars, ...fit,
    validate: (text, slots) => !/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]/u.test(text) &&
      fitsAtSize(text, fit) && (!check || check(text, slots)),
  };
}

const repeat = (slot, min, max = min) => ({ ...slot, repeat: [min, max] });
const optional = (slot) => ({ ...slot, optional: true });
const card = (name, definition) => ({
  surface: "obsidian",
  ...(definition.variantOf ? { hint: existing[definition.variantOf].hint } : {}),
  ...definition,
  css: `
    & .ia-copy { opacity:0;white-space:nowrap;font:700 40px/48px "Inter",sans-serif; }
    & .ia-label { color:#C8A24B;font:700 28px/36px "Inter",sans-serif; }
    & .ia-hero { color:#C8A24B;font:400 96px/112px "Anton",sans-serif; }
    & .ia-draw { fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1; }
    ${definition.css}
  `.replaceAll("&", `.pro-${name}`),
});

const tween = (h, s, from, to, at, motion = "enter") =>
  `tl.fromTo(${h.sel(s)},${h.js(from)},{...${h.js(to)},duration:${h.motion[motion]},ease:${motion === "state" ? "proState" : "proEnter"},immediateRender:false},${h.at(at)});`;
const state = (h, s, from, to, at) => tween(h, s, from, to, at, "state");
const wipe = (h, s, p, clipPath = "inset(0 100% 0 0)") =>
  tween(h, s, { opacity: 0, clipPath }, { opacity: 1, clipPath: "inset(0 0% 0 0)" }, p.at);
const rise = (h, s, p, axis = { y: 12 }) =>
  tween(h, s, { opacity: 0, ...axis }, { opacity: 1, ...fromEntries(Object.keys(axis).map((key) => [key, 0])) }, p.at);
const draw = (h, s, at) => state(h, s, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at);
const copy = (h, name, p, style = "") => `<div class="ia-copy ia-${name} ${style}">${h.copy(p)}</div>`;
const path = (d, style = "ia-draw") => `<path class="${style}" pathLength="1" d="${d}"/>`;
const svg = (viewBox, inner, style = "") => `<svg class="${style}" viewBox="${viewBox}" aria-hidden="true">${inner}</svg>`;
const line = (text) => text.trim().toLowerCase().replace(/[.!?,;:]$/, "");
const onePhrase = (text) => !/\s/.test(text);
const sameWord = (a, b) => line(a) === line(b);

const small = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const tens = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");

function whole(text) {
  if (/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) {
    const number = Number(text.replaceAll(",", ""));
    return Number.isSafeInteger(number) ? number : null;
  }
  const words = text.replace(/(?<=[a-z])-(?=[a-z])/g, " ").split(/\s+/);
  let total = 0;
  // Require a descending scale and parse the entire phrase before it can drive geometry.
  for (const [scale, multiplier] of [["million", 1000000], ["thousand", 1000], ["hundred", 100]]) {
    const i = words.indexOf(scale);
    if (i < 0) continue;
    const head = whole(words.splice(0, i).join(" "));
    if (!head || head >= (scale === "hundred" ? 10 : 1000) || words.shift() !== scale) return null;
    total += head * multiplier;
    if (words[0] === "and") {
      words.shift();
      if (!words.length) return null;
    }
  }
  if (!words.length) return total || null;
  const digit = small.indexOf(words[0]);
  if (words.length === 1 && digit >= 0) return total + digit;
  const decade = tens.indexOf(words[0]), tail = small.indexOf(words[1]);
  if (decade >= 0 && (words.length === 1 || (words.length === 2 && tail > 0 && tail < 10))) {
    return total + (decade + 2) * 10 + Math.max(0, tail);
  }
  return null;
}

function quantity(text) {
  let raw = line(text);
  let unit = "count";
  if (/^\$|\bdollars?$/.test(raw)) {
    unit = "dollars";
    raw = raw.replace(/^\$\s*|\s+dollars?$/g, "");
  } else if (/%$|\bper\s?cent$/.test(raw)) {
    unit = "percent";
    raw = raw.replace(/\s*(?:%|per\s?cent)$/, "");
  }
  const decimal = /^(?:\d+|\d{1,3}(?:,\d{3})+)\.\d+$/.test(raw) ? Number(raw.replaceAll(",", "")) : null;
  const decimalWords = raw.match(/^(.+) point ([a-z]+(?: [a-z]+)*)$/);
  let value = decimal ?? whole(raw);
  if (decimalWords) {
    const integer = whole(decimalWords[1]);
    const digits = decimalWords[2].split(" ").map((word) => small.indexOf(word));
    if (integer === null || digits.some((digit) => digit < 0 || digit > 9)) return null;
    value = integer + Number(`0.${digits.join("")}`);
  }
  return value !== null && Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER &&
    (unit !== "percent" || value <= 100) ? { value, unit } : null;
}

const amount = (text) => quantity(text) !== null;
const count = (text) => {
  const q = quantity(text);
  return q?.unit === "count" && Number.isInteger(q.value);
};
const timeUnit = /\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)$/;
const durations = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 1, year: 12 };
function duration(text) {
  const raw = line(text);
  const match = raw.match(timeUnit);
  if (!match) return null;
  const unit = match[1].replace(/s$/, "");
  const phrase = raw.slice(0, match.index);
  const number = /^(?:a|an)$/.test(phrase) ? { value: 1, unit: "count" } : quantity(phrase);
  if (number?.unit !== "count") return null;
  return { value: number.value * durations[unit], unit: unit === "month" || unit === "year" ? "calendar" : "clock" };
}

function rating(text) {
  const parts = line(text).split(/\s*(?:\/|\bout of\b)\s*/);
  if (parts.length !== 2) return null;
  const [score, scale] = parts.map(quantity);
  return score?.unit === "count" && scale?.unit === "count" && Number.isInteger(scale.value) &&
    scale.value >= 2 && scale.value <= 10 && score.value <= scale.value ? { score: score.value, scale: scale.value } : null;
}

const readStatus = (text) => /^(?:(?:they|he|she|the prospect) (?:read it|saw it|opened it|left (?:it|me|us) on read)|(?:it was |it said )?(?:delivered|read|seen|unread|opened|left on read))$/i.test(line(text));
const reaction = (text) => /^(?:(?:a|an|one|with a) )?(?:thumbs[- ]up|thumbs[- ]down|heart|like|dislike|laugh)(?: reaction| emoji)?$|^(?:(?:they|he|she|the prospect) )?(?:hearted|liked|disliked) (?:it|the message)$/i.test(line(text));
const comparison = (a, b) => a && b && a.unit === b.unit;
const containsQuantity = (text) => line(text).split(/\s+/).some((word) => amount(word.replace(/^[("]|[)";:,]$/g, "")));

export const CARDS = {
  "handoff-duration": card("handoff-duration", {
    family: "procedure",
    tags: ["flow", "time"],
    hint: "Greg explicitly names where a lead, task or sale starts and where it is handed off, then states the exact time the move takes",
    source: sources("b-roll", "talking-head-b-roll", "travel-endpoints"),
    slots: { origin: spoken(24, 314), destination: spoken(24, 314), duration: spoken(34, 656, 96, 3, (text) => duration(text) !== null) },
    validate: (s) => !sameWord(s.origin[0].text, s.destination[0].text),
    size: (o) => ({ w: 720, h: 204 + o.slots.duration[0].lines.length * 112 }),
    render(o, h) {
      const { origin: [a], destination: [b], duration: [time] } = o.slots;
      const rail = svg("0 0 656 28", path("M16 14H640", "ia-track") + path("M16 14H640") +
        '<circle class="ia-packet" cx="16" cy="14" r="8"/>', "ia-rail");
      return {
        inner: `<div class="ia-ends">${copy(h, "origin", a)}${copy(h, "destination", b)}</div>${rail}${copy(h, "duration", time, "ia-hero")}`,
        timeline: [wipe(h, ".ia-origin", a), wipe(h, ".ia-destination", b), draw(h, ".ia-rail .ia-draw", b.at),
          wipe(h, ".ia-duration", time), state(h, ".ia-packet", { opacity: 1, attr: { cx: 16 } }, { opacity: 1, attr: { cx: 640 } }, time.at)].join("\n"),
      };
    },
    css: `
      & { display:grid;align-content:center;gap:10px;padding:24px 32px; }
      & .ia-ends { display:grid;grid-template-columns:314px 314px;justify-content:space-between; }
      & .ia-destination { text-align:right; }
      & .ia-rail { width:656px;height:28px; }
      & .ia-track { fill:none;stroke:#343438;stroke-width:3; }
      & .ia-packet { opacity:0;fill:#C8A24B; }
      & .ia-duration { text-align:center; }
    `,
  }),

  "message-read-state": card("message-read-state", {
    family: "conversation",
    tags: ["message", "conversation"],
    hint: "Greg quotes the outreach message he sent and explicitly says whether it was read, seen, opened or delivered, or that he was left on read",
    source: sources("text-message-video", "text-message-animation", "read-receipt"),
    slots: { message: spoken(66, 582, 42, 3), status: spoken(35, 562, 40, 2, readStatus) },
    size: (o) => ({ w: 720, h: 110 + 52 * o.slots.message[0].lines.length + 48 * o.slots.status[0].lines.length }),
    render(o, h) {
      const { message: [message], status: [status] } = o.slots;
      const statusText = line(status.text);
      const mark = statusText === "unread" ? "M22 4a10 10 0 1 1 0 20 10 10 0 1 1 0-20" :
        statusText.endsWith("delivered") ? "M11 15l7 7L35 5" : "M4 15l7 7L28 5M18 22L37 5";
      const checks = svg("0 0 44 28", path(mark), "ia-checks");
      return {
        inner: `<div class="ia-bubble">${copy(h, "message", message)}</div><div class="ia-receipt">${checks}${copy(h, "status", status)}</div>`,
        timeline: wipe(h, ".ia-message", message) + "\n" + wipe(h, ".ia-status", status) + "\n" + draw(h, ".ia-checks path", status.at),
      };
    },
    css: `
      & { display:grid;justify-items:end;align-content:center;gap:10px;padding:24px 32px; }
      & .ia-bubble { width:622px;padding:12px 20px;background:#343438;border-radius:12px 12px 0 12px; }
      & .ia-message { font:700 42px/52px "Inter",sans-serif; }
      & .ia-receipt { display:flex;justify-content:end;align-items:center;gap:12px; }
      & .ia-checks { width:44px;height:28px;flex:none; }
      & .ia-status { color:#A8A49C;text-align:right; }
    `,
  }),

  "masked-topic": card("masked-topic", {
    variantOf: "section-divider",
    family: "emphasis",
    tags: ["title"],
    source: all(sources("kinetic-typography", "kinetic-typography", "mask-up", "gsap-line-mask"),
      sources("tiktok-video", "lower-thirds", "wipe-bar")),
    slots: { headline: spoken(76, 624, 48, 3) },
    size: (o) => ({ w: 720, h: 72 + o.slots.headline[0].lines.length * 58 }),
    render(o, h) {
      const p = o.slots.headline[0];
      const inner = `<div class="ia-baselines" aria-label="${h.esc(p.text)}">${p.lines.map((text) =>
        `<div class="ia-baseline" aria-hidden="true">${copy(h, "line", { text })}</div>`).join("")}</div>`;
      // Move ink within the line masks while the slot starts on its original spoken word.
      return { inner, timeline: rise(h, ".ia-line", p, { y: 16 }) + "\n" +
        state(h, ".ia-baseline", { borderColor: "#343438" }, { borderColor: "#C8A24B" }, p.at) };
    },
    css: `
      & { display:grid;align-content:center;padding:24px 48px; }
      & .ia-baseline { width:max-content;max-width:100%;overflow:hidden;border-bottom:2px solid #343438; }
      & .ia-line { font:800 48px/56px "Inter",sans-serif; }
    `,
  }),

  "spelled-emphasis": card("spelled-emphasis", {
    variantOf: "big-word",
    family: "payoff",
    tags: ["highlight", "title"],
    source: sources("kinetic-typography", "kinetic-typography", "character-stagger", "gsap-character-stagger",
      "framer-character-stagger", "remotion-character-stagger", "after-effects-character-stagger"),
    slots: { word: spoken(18, 656, 60, 1, onePhrase) },
    size: { w: 720, h: 160 },
    render(o, h) {
      const p = o.slots.word[0];
      const letters = [...p.text];
      return {
        inner: `<div class="ia-letters" aria-label="${h.esc(p.text)}">${letters.map((letter, i) =>
          `<span class="ia-letter ia-letter-${i}" aria-hidden="true">${h.esc(letter)}</span>`).join("")}</div>`,
        timeline: letters.map((_, i) => rise(h, `.ia-letter-${i}`, { at: p.at + i * 0.006 })).join("\n"),
      };
    },
    css: `
      & { display:grid;place-items:center; }
      & .ia-letters { color:#C8A24B;white-space:nowrap;font:400 60px/74px "Anton",sans-serif; }
      & .ia-letter { display:inline-block;opacity:0; }
    `,
  }),

  "weight-emphasis": card("weight-emphasis", {
    variantOf: "big-word",
    family: "payoff",
    tags: ["highlight"],
    source: sources("kinetic-typography", "kinetic-typography", "variable-weight"),
    slots: { word: spoken(18, 656, 60, 1, onePhrase) },
    size: { w: 720, h: 160 },
    render(o, h) {
      const p = o.slots.word[0];
      return { inner: copy(h, "word", p), timeline: wipe(h, ".ia-word", p) + "\n" +
        state(h, ".ia-word", { fontWeight: 400, color: "#F5F1E8" }, { fontWeight: 850, color: "#C8A24B" }, p.at) };
    },
    css: `
      & { display:grid;place-items:center; }
      & .ia-word { font:400 60px/74px "Inter",sans-serif; }
    `,
  }),

  "outline-emphasis": card("outline-emphasis", {
    variantOf: "big-word",
    family: "payoff",
    tags: ["highlight", "title"],
    source: all(sources("kinetic-typography", "kinetic-typography", "outline-text-draw"),
      sources("explainer-video", "whiteboard-animation", "handwriting")),
    slots: { word: spoken(18, 656, 60, 1, onePhrase) },
    size: { w: 720, h: 160 },
    render(o, h) {
      const p = o.slots.word[0];
      const inner = `<div class="ia-ink">${copy(h, "fill", p)}<div class="ia-outline" aria-hidden="true">${h.copy(p)}</div></div>`;
      return { inner, timeline: wipe(h, ".ia-outline", p) + "\n" +
        state(h, ".ia-fill", { clipPath: "inset(100% 0 0 0)", opacity: 0 }, { clipPath: "inset(0 0 0 0)", opacity: 1 }, p.at) };
    },
    css: `
      & { display:grid;place-items:center; }
      & .ia-ink { position:relative; }
      & .ia-fill, & .ia-outline { white-space:nowrap;font:400 60px/74px "Anton",sans-serif; }
      & .ia-fill { color:#C8A24B; }
      & .ia-outline { position:absolute;inset:0;color:#0B0B0D;-webkit-text-fill-color:transparent;-webkit-text-stroke:2px #C8A24B;opacity:0; }
    `,
  }),

  "alert-scroll-tray": card("alert-scroll-tray", {
    variantOf: "alert-stack",
    family: "conversation",
    tags: ["message", "conversation"],
    source: sources("text-message-video", "text-message-animation", "thread-auto-scroll"),
    slots: fromEntries([1, 2, 3].flatMap((i) => [
      [`title${i}`, spoken(32, 560, 40, 1)], [`message${i}`, spoken(54, 560)],
    ])),
    size: { w: 720, h: 364 },
    render(o, h) {
      const timeline = [];
      const alerts = [1, 2, 3].map((i) => {
        const title = o.slots[`title${i}`][0], message = o.slots[`message${i}`][0];
        timeline.push(rise(h, `.ia-alert-${i}`, title), wipe(h, `.ia-title-${i}`, title), wipe(h, `.ia-message-${i}`, message));
        return `<div class="ia-row"><div class="ia-alert ia-alert-${i}">${copy(h, `title-${i}`, title, "ia-title")}${copy(h, `message-${i}`, message)}</div></div>`;
      });
      timeline.push(state(h, ".ia-tray", { y: 0 }, { y: -164 }, o.slots.title3[0].at));
      return { inner: `<div class="ia-window"><div class="ia-tray">${alerts.join("")}</div></div>`, timeline: timeline.join("\n") };
    },
    css: `
      & { padding:18px 32px; }
      & .ia-window { overflow:hidden;height:328px; }
      & .ia-row { display:grid;align-items:center;height:164px; }
      & .ia-alert { padding:4px 24px;border-left:4px solid #C8A24B;background:#343438;border-radius:0 12px 12px 0;opacity:0; }
      & .ia-title { color:#C8A24B; }
    `,
  }),

  "client-quote-mask": card("client-quote-mask", {
    variantOf: "testimonial",
    family: "proof",
    tags: ["quote"],
    source: sources("ad-video", "testimonial-video", "quote-line-reveal"),
    slots: { name: optional(spoken(26, 632, 40, 1)), quote: spoken(100, 608, 44, 4) },
    size: (o) => ({ w: 720, h: 106 + (o.slots.name.length ? 48 : 0) + o.slots.quote[0].lines.length * 56 }),
    surface: "bone",
    render(o, h) {
      const { name: [name], quote: [quote] } = o.slots;
      const lines = quote.lines.map((text, i) =>
        `<div class="ia-mask" aria-hidden="true">${copy(h, `line-${i}`, { text })}</div>`);
      const mark = svg("0 0 36 28", '<path d="M2 25V14L11 3h6l-6 11h7v11ZM20 25V14L29 3h6l-6 11h7v11Z"/>', "ia-mark");
      const inner = `<div class="ia-credit"><div class="ia-label">Client</div>${name ? copy(h, "name", name) : ""}</div><div class="ia-quote" aria-label="${h.esc(quote.text)}">${mark}${lines.join("")}</div>`;
      const timeline = [...(name ? [wipe(h, ".ia-name", name)] : []),
        ...quote.lines.map((_, i) => rise(h, `.ia-line-${i}`, { at: quote.at + i * 0.021 })),
        state(h, ".ia-mark", { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1 }, quote.at)].join("\n");
      return { inner, timeline };
    },
    css: `
      & { display:grid;align-content:center;gap:8px;padding:20px 24px; }
      & .ia-label { color:#343438; }
      & .ia-quote { position:relative;padding-left:56px; }
      & .ia-mark { position:absolute;top:12px;left:0;width:36px;height:28px;fill:#C8A24B;opacity:0; }
      & .ia-mask { overflow:hidden; }
      & .ia-mask .ia-copy { font:700 44px/56px "Inter",sans-serif; }
    `,
  }),

  "count-hinge": card("count-hinge", {
    variantOf: "countdown",
    family: "procedure",
    tags: ["number", "list"],
    source: sources("tiktok-video", "countdown-video", "digit-flip"),
    slots: { counts: repeat(spoken(26, 656, 96, 1, count), 2, 4) },
    validate: ({ counts }) => counts.every((p, i) => !i || quantity(counts[i - 1].text).value > quantity(p.text).value),
    size: { w: 720, h: 196 },
    render(o, h) {
      const { counts } = o.slots;
      const faces = counts.map((p, i) => copy(h, `count-${i}`, p, "ia-hero"));
      const timeline = counts.flatMap((p, i) => [
        ...(i ? [state(h, `.ia-count-${i - 1}`, { opacity: 1, clipPath: "inset(0 0 0 0)" }, { opacity: 0, clipPath: "inset(50% 0 50% 0)" }, p.at)] : []),
        tween(h, `.ia-count-${i}`, { opacity: 0, clipPath: "inset(50% 0 50% 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }, p.at, i ? "state" : "enter"),
      ]).join("\n");
      return { inner: `<div class="ia-flaps">${faces.join("")}</div>`, timeline };
    },
    css: `
      & { display:grid;align-items:center;padding:24px 32px; }
      & .ia-flaps { position:relative;display:grid;height:144px;place-items:center;border-top:2px solid #343438;border-bottom:2px solid #343438; }
      & .ia-hero { position:absolute; }
      & .ia-flaps::after { content:"";position:absolute;left:0;right:0;top:50%;border-top:2px solid #0B0B0D; }
    `,
  }),

  "tall-figure-wipe": card("tall-figure-wipe", {
    variantOf: "rising-figure",
    family: "proof",
    tags: ["number", "callout"],
    source: sources("b-roll", "talking-head-b-roll", "synchronized-big-number"),
    slots: { value: spoken(28, 656, 96, 3, amount), context: spoken(55) },
    size: (o) => ({ w: 720, h: 86 + o.slots.value[0].lines.length * 112 + o.slots.context[0].lines.length * 48 }),
    render(o, h) {
      const { value: [value], context: [context] } = o.slots;
      return {
        inner: `<div class="ia-field">${copy(h, "value", value, "ia-hero")}</div>${copy(h, "context", context)}`,
        timeline: [tween(h, ".ia-field", { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0 0 0 0)" }, value.at),
          tween(h, ".ia-value", { opacity: 0 }, { opacity: 1 }, value.at), wipe(h, ".ia-context", context)].join("\n"),
      };
    },
    css: `
      & { display:grid;align-content:center;gap:10px;padding:20px 32px;text-align:center; }
      & .ia-field { clip-path:inset(100% 0 0 0);background:#C8A24B;padding:8px 0; }
      & .ia-value { color:#0B0B0D; }
    `,
  }),

  "packet-handoff": card("packet-handoff", {
    variantOf: "handoff-rail",
    family: "procedure",
    tags: ["flow", "steps"],
    source: all(sources("explainer-video", "diagram-animation", "flowing-connector"),
      sources("b-roll", "talking-head-b-roll", "travel-route-trace")),
    slots: { stages: repeat(spoken(32, 550), 3, 4) },
    size: (o) => ({ w: 720, h: 48 + o.slots.stages.length * 104 }),
    render(o, h) {
      const { stages } = o.slots;
      const marks = stages.map((_, i) => `<circle class="ia-node" cx="28" cy="${52 + 104 * i}" r="10"/>`);
      const rail = svg(`0 0 56 ${stages.length * 104}`, path(`M28 52V${52 + (stages.length - 1) * 104}`, "ia-track") +
        marks.join("") + '<circle class="ia-packet" cx="28" cy="52" r="8"/>', "ia-rail");
      const timeline = stages.flatMap((p, i) => [
        wipe(h, `.ia-stage-${i}`, p),
        i ? state(h, ".ia-packet", { attr: { cy: 52 + 104 * (i - 1) } }, { attr: { cy: 52 + 104 * i } }, p.at) :
          tween(h, ".ia-packet", { opacity: 0 }, { opacity: 1 }, p.at),
      ]).join("\n");
      return { inner: rail + `<div class="ia-lanes">${stages.map((p, i) => copy(h, `stage-${i}`, p)).join("")}</div>`, timeline };
    },
    css: `
      & { display:grid;grid-template-columns:56px 1fr;gap:16px;padding:24px 32px; }
      & .ia-rail { width:56px;height:100%; }
      & .ia-track { fill:none;stroke:#A8A49C;stroke-width:3;stroke-dasharray:.03 .045; }
      & .ia-node { fill:#0B0B0D;stroke:#343438;stroke-width:4; }
      & .ia-packet { opacity:0;fill:#C8A24B; }
      & .ia-lanes { display:grid;grid-auto-rows:104px;align-items:center; }
    `,
  }),

  "sketched-outcomes": card("sketched-outcomes", {
    variantOf: "outcome-tree",
    family: "procedure",
    tags: ["flow", "list"],
    source: all(sources("explainer-video", "whiteboard-animation", "dashoffset-draw-on", "multi-stroke-draw", "gsap-draw-on", "fill-after-outline",
      "frame-driven-draw", "board-build-sequence"), sources("explainer-video", "diagram-animation", "progressive-nodes")),
    slots: { root: spoken(47, 608), outcomes: repeat(spoken(36, 528), 3) },
    size: { w: 720, h: 500 },
    surface: "bone",
    render(o, h) {
      const { root: [root], outcomes } = o.slots;
      const strokes = ["M548 0Q552 49 483 53H599", "M548 0Q569 161 486 163H599", "M548 0Q558 264 488 273H599"];
      const connectors = svg("0 0 656 330", strokes.map((d, i) => path(d, `ia-draw ia-branch-${i}`)).join(""), "ia-connectors");
      const rows = outcomes.map((p, i) => `<div class="ia-limb">${copy(h, `outcome-${i}`, p)}${svg("0 0 32 32", path("M16 2Q31 3 30 17Q29 31 15 29Q1 26 2 14Q4 3 16 2", `ia-draw ia-node-${i}`))}</div>`).join("");
      return {
        inner: copy(h, "root", root) + `<div class="ia-branches">${connectors}${rows}</div>`,
        timeline: [wipe(h, ".ia-root", root), ...outcomes.flatMap((p, i) => [
          draw(h, `.ia-branch-${i}`, p.at), draw(h, `.ia-node-${i}`, p.at),
          state(h, `.ia-node-${i}`, { fillOpacity: 0 }, { fillOpacity: 1 }, p.at),
          wipe(h, `.ia-outcome-${i}`, p, "inset(0 0 0 100%)"),
        ])].join("\n"),
      };
    },
    css: `
      & { display:grid;align-content:center;gap:14px;padding:24px 32px; }
      & .ia-root { color:#0B0B0D;text-align:right;padding:4px 24px; }
      & .ia-branches { position:relative;display:grid;grid-auto-rows:110px; }
      & .ia-connectors { position:absolute;inset:0;width:656px;height:330px; }
      & .ia-draw { stroke:#343438; }
      & .ia-limb { display:grid;grid-template-columns:528px 32px;gap:64px;align-items:center; }
      & .ia-limb svg { width:32px;height:32px; }
      & .ia-limb path { fill:#C8A24B;fill-opacity:0; }
      & .ia-limb .ia-copy { width:528px;text-align:right;background:#F5F1E8;position:relative;padding-right:0; }
    `,
  }),

  "stacked-system-deck": card("stacked-system-deck", {
    variantOf: "system-layers",
    family: "procedure",
    tags: ["flow", "list"],
    source: sources("explainer-video", "isometric-animation", "stacked-z-layers", "extruded-block",
      "isometric-plane", "exploded-view", "orthographic-block-scene"),
    slots: { layers: repeat(spoken(34, 546, 40, 1), 3, 4) },
    size: (o) => ({ w: 720, h: 72 + o.slots.layers.length * 68 }),
    render(o, h) {
      const { layers } = o.slots;
      const rows = layers.map((p, i) => `<div class="ia-slab ia-slab-${i}"><div class="ia-slab-face">${svg("0 0 620 68",
        '<path class="ia-top" d="M0 16L26 0H618L594 16Z"/><path class="ia-side" d="M594 16L618 0V50L594 66Z"/><path class="ia-front" d="M0 16H594V66H0Z"/>')}${copy(h, `layer-${i}`, p)}</div></div>`);
      return {
        inner: `<div class="ia-stack">${rows.join("")}</div>`,
        timeline: layers.flatMap((p, i) => [
          rise(h, `.ia-slab-${i}`, p, { y: -14 }), wipe(h, `.ia-layer-${i}`, p),
          state(h, `.ia-slab-${i} .ia-slab-face`, { y: -i * 7 }, { y: 0 }, layers.at(-1).at),
        ]).join("\n"),
      };
    },
    css: `
      & { display:grid;align-content:end;padding:24px 32px; }
      & .ia-stack { display:flex;flex-direction:column-reverse;gap:0;padding-left:16px; }
      & .ia-slab { position:relative;width:620px;height:68px;opacity:0; }
      & .ia-slab-face { position:relative;height:100%;transform:translateY(var(--ia-gap,0)); }
      & .ia-slab:nth-child(2) .ia-slab-face { --ia-gap:-7px; }
      & .ia-slab:nth-child(3) .ia-slab-face { --ia-gap:-14px; }
      & .ia-slab:nth-child(4) .ia-slab-face { --ia-gap:-21px; }
      & .ia-slab svg { position:absolute;inset:0;width:620px;height:68px; }
      & .ia-slab .ia-copy { position:absolute;left:24px;top:16px; }
      & .ia-top { fill:#C8A24B; }
      & .ia-side { fill:#A8A49C; }
      & .ia-front { fill:#343438; }
    `,
  }),

  "chapter-bullets": card("chapter-bullets", {
    variantOf: "chapter-index",
    family: "procedure",
    tags: ["list", "title"],
    source: sources("data-animation", "presentation-video", "staggered-bullets"),
    slots: { topics: repeat(spoken(34, 592, 40, 1), 3, 5) },
    size: (o) => ({ w: 720, h: 56 + 52 * o.slots.topics.length }),
    render(o, h) {
      const { topics } = o.slots;
      const rows = topics.map((p, i) => `<div class="ia-row ia-row-${i}">${svg("0 0 24 24", '<path d="M12 2l10 10-10 10L2 12Z"/>')}${copy(h, `topic-${i}`, p)}</div>`);
      return { inner: rows.join(""), timeline: topics.flatMap((p, i) => [
        rise(h, `.ia-row-${i} svg`, p), rise(h, `.ia-topic-${i}`, p),
      ]).join("\n") };
    },
    css: `
      & { display:grid;align-content:center;grid-auto-rows:52px;padding:24px 36px; }
      & .ia-row { display:grid;grid-template-columns:24px 592px;gap:24px;align-items:center; }
      & .ia-row svg { width:24px;height:24px;fill:#C8A24B;opacity:0; }
    `,
  }),

  "headline-word-build": card("headline-word-build", {
    variantOf: "stacked-title",
    family: "emphasis",
    tags: ["title", "highlight"],
    source: all(sources("explainer-video", "explainer-video", "kinetic-keyword-stagger"),
      sources("kinetic-typography", "kinetic-typography", "framer-word-stagger")),
    slots: { lines: repeat(spoken(32, 628, 48, 1), 3, 4) },
    size: (o) => ({ w: 720, h: 48 + 58 * o.slots.lines.length }),
    render(o, h) {
      const { lines } = o.slots;
      const timeline = [];
      const rows = lines.map((p, i) => {
        const words = p.lines[0].split(" ");
        const ink = words.map((word, j) => {
          const selector = `ia-word-${i}-${j}`;
          timeline.push(rise(h, `.${selector}`, { at: p.at + j * 0.014 }));
          return `<span class="ia-word ${selector}">${h.esc(word)}</span>`;
        });
        return `<div class="ia-line" aria-label="${h.esc(p.text)}"><span aria-hidden="true">${ink.join(" ")}</span></div>`;
      });
      return { inner: rows.join(""), timeline: timeline.join("\n") };
    },
    css: `
      & { display:grid;align-content:center;grid-auto-rows:58px;padding:24px 32px; }
      & .ia-line { white-space:nowrap;font:400 48px/58px "Anton",sans-serif; }
      & .ia-line:nth-child(even) { text-align:right; }
      & .ia-line:last-child { text-align:left;color:#C8A24B; }
      & .ia-word { display:inline-block;opacity:0; }
    `,
  }),

  "duration-benchmark-rail": card("duration-benchmark-rail", {
    variantOf: "bars",
    family: "proof",
    tags: ["time", "comparison", "chart"],
    source: sources("b-roll", "talking-head-b-roll", "travel-time-bars"),
    slots: {
      heading: { kind: "label", optional: true, maxChars: 24, width: 656, size: 28, maxLines: 1 },
      items: repeat(spoken(48, 656, 40, 2, (text, s) => {
        const q = durationReading(text), first = s.items[0];
        return q && (!first || comparison(q, durationReading(first.text)));
      }), 2, 4),
    },
    size: (o) => ({ w: 720, h: 40 + (o.slots.heading.length ? 44 : 0) +
      o.slots.items.reduce((total, p) => total + 48 * p.lines.length + 22, 0) }),
    render(o, h) {
      const { items, heading: [heading] } = o.slots;
      const values = items.map((p) => durationReading(p.text).value);
      const max = Math.max(1, ...values);
      const rows = items.map((p, i) => {
        const x = h.at(12 + 632 * values[i] / max);
        const rail = svg("0 0 656 18", path("M12 9H644", "ia-track") + path(`M12 9H${x}`, "ia-draw") +
          '<circle class="ia-dot" r="6" cx="12" cy="9"/>');
        return `<div class="ia-reading ia-reading-${i}">${copy(h, "time", p)}${rail}</div>`;
      });
      const timeline = items.flatMap((p, i) => {
        const row = `.ia-reading-${i}`;
        return [wipe(h, `${row} .ia-time`, p), draw(h, `${row} .ia-draw`, p.at),
          state(h, `${row} .ia-dot`, { opacity: 0, attr: { cx: 12 } },
            { opacity: 1, attr: { cx: h.at(12 + 632 * values[i] / max) } }, p.at)];
      });
      return { inner: (heading ? `<div class="ia-label">${h.copy(heading)}</div>` : "") + rows.join(""), timeline: timeline.join("\n") };
    },
    css: `
      & { display:grid;align-content:center;gap:4px;padding:20px 32px; }
      & .ia-reading svg { display:block;width:656px;height:18px; }
      & .ia-track { fill:none;stroke:#343438;stroke-width:2;stroke-dasharray:.02 .015; }
      & .ia-dot { opacity:0;fill:#C8A24B; }
    `,
  }),
};

function durationReading(text) {
  const words = line(text).split(/\s+/);
  const end = words.findIndex((word) => timeUnit.test(` ${word}`));
  if (end < 1 || words.slice(end + 1).some((word) => timeUnit.test(` ${word}`))) return null;
  // A track needs a category in its exact quote and a single unambiguous measured duration.
  const anchors = words.slice(0, end + 1);
  while (anchors.length > 1 && duration(anchors.join(" ")) === null) {
    if (/\d|^(?:to|or|and|about|over|under|around|roughly|nearly|approximately)$/.test(anchors[0]) ||
        quantity(anchors[0]) || anchors[0].includes("–")) return null;
    anchors.shift();
  }
  return anchors.length < words.length ? duration(anchors.join(" ")) : null;
}
