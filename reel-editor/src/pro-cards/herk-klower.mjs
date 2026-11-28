// Adapted from the Herk Edit Kit, copyright 2026 Nate Herk, MIT. See src/pro-cards/HERK-LICENSE.md.
import { CARDS as proof } from "./proof-2.mjs";

const spoken = (maxChars, width, maxLines = 1) => ({ kind: "spoken", maxChars, width, size: 52, maxLines });
const metricHint = "Greg first names a measurable sales metric and then gives a compact actual value; use the exact metric and value he says in that order";
const numeric = proof["kpi-tile"].slots.value.validate;
const compactValue = (text) => numeric(text) || /^\$?\d+(?:\.\d+)?[KMB][.!?]?$/i.test(text);

// Anton advances in em (the same table herk-klabel checks figures against), including its wide percent glyph.
const antonWidth = (text, size) => size * [...text].reduce((total, glyph) => total +
  (glyph === "%" ? 1.07 : /[mwMW–—]/.test(glyph) ? 0.81 : /[ilI., ]/.test(glyph) ? 0.27 : /[fjt!]/.test(glyph) ? 0.33 :
    /[+×-]/.test(glyph) ? 0.37 : /[rsyz]/.test(glyph) ? 0.49 : 0.53), 0);

// The planner sees the group's longest budget. Only use designs that can fit the value at 96 px.
// `limit` keeps a design's character cap (wider counts switch designs); the Anton check proves the value fits.
function metricValue(width, validate, limit = Math.floor(width / (96 * 0.95))) {
  const size = 96;
  return { kind: "spoken", maxChars: 7, width, size, maxLines: 1,
    validate: (text) => text.length <= limit && antonWidth(text, size) <= width && validate(text) };
}

function enter(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js({ opacity: 0, ...from })},{...${h.js({ opacity: 1, ...to })},duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

function wipe(h, selector, at, from = {}, to = {}) {
  return enter(h, selector, { clipPath: "inset(0 100% 0 0)", ...from }, { clipPath: "inset(0 0% 0 0)", ...to }, at);
}

function draw(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${at});`;
}

// The value rises into its window as one piece. Intermediate numbers would add words Greg never said.
function riseValue(h, at) {
  return enter(h, ".kl-value", { y: 12, clipPath: "inset(100% 0 0 0)" }, { y: 0, clipPath: "inset(0 0 0 0)" }, at);
}

export const CARDS = {
  "chapter-strip": {
    family: "emphasis",
    tags: ["title"],
    hint: "Greg explicitly introduces the next distinct teaching topic by saying its short title; use the title words only",
    source: "herk:kallaway.t2.lower-third.chapterbar,kallaway.t2.lower-third.doublecard",
    slots: { title: spoken(48, 640, 2) },
    size: { w: 704, h: 192 },
    surface: "bare",
    render(o, h) {
      const title = o.slots.title[0];
      const inner = `<div class="kl-kicker">Topic</div><div class="kl-title-bar"><div class="kl-edge"></div><div class="kl-title">${h.copy(title)}</div></div>`;
      const timeline = [
        enter(h, ".kl-kicker", { x: -12 }, { x: 0 }, title.at),
        draw(h, ".kl-edge", { scaleX: 0 }, { scaleX: 1 }, title.at),
        wipe(h, ".kl-title", title.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-chapter-strip { display:flex;flex-direction:column;align-items:flex-start;gap:8px;overflow:hidden; }
      .pro-chapter-strip .kl-kicker { padding:4px 24px;border-radius:22px;background:#C8A24B;color:#0B0B0D;font:800 30px/36px "Inter",sans-serif;opacity:0; }
      .pro-chapter-strip .kl-title-bar { width:100%;overflow:hidden;border-radius:0 12px 12px 12px;background:#0B0B0D; }
      .pro-chapter-strip .kl-edge { height:4px;background:#C8A24B;transform:scaleX(0);transform-origin:left center; }
      .pro-chapter-strip .kl-title { padding:10px 32px;font:750 52px/58px "Inter",sans-serif;opacity:0; }`,
  },
  "quote-strip": {
    variantOf: "quote",
    family: "payoff",
    tags: ["quote"],
    hint: "Greg delivers a memorable self-contained line worth holding as his pull quote",
    source: "herk:kallaway.t2.lower-third.quote,kallaway.t2.lower-third.cite",
    slots: { quote: spoken(78, 576, 3) },
    size: { w: 704, h: 228 },
    surface: "obsidian",
    render(o, h) {
      const quote = o.slots.quote[0];
      const mark = `<svg class="kl-mark" viewBox="0 0 64 58" aria-hidden="true"><path d="M27 4C12 9 4 19 4 32v18h23V27H15c2-6 6-10 12-13Zm31 0C43 9 35 19 35 32v18h23V27H46c2-6 6-10 12-13Z"/></svg>`;
      const inner = `${mark}<div class="kl-quote">${h.copy(quote)}</div>`;
      const timeline = [
        enter(h, ".kl-mark", { y: -12 }, { y: 0 }, quote.at),
        wipe(h, ".kl-quote", quote.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-quote-strip { display:grid;grid-template-columns:64px 576px;gap:16px;align-content:center;align-items:start;padding:24px;background:#0B0B0D; }
      .pro-quote-strip .kl-mark { display:block;width:64px;height:58px;fill:#C8A24B;opacity:0; }
      .pro-quote-strip .kl-quote { font:750 52px/60px "Inter",sans-serif;opacity:0; }`,
  },
  "metric-stat-chip": {
    family: "proof",
    tags: ["number"],
    hint: metricHint,
    source: "herk:kallaway.t2.lower-third.statline",
    slots: { metric: spoken(26, 260, 2), value: metricValue(388, compactValue, 5) }, // metric room for "Objections"; values keep the old 5-character cap (Nov 27)
    size: { w: 720, h: 176 },
    surface: "obsidian",
    render(o, h) {
      const metric = o.slots.metric[0], value = o.slots.value[0];
      const inner = `<div class="kl-metric">${h.copy(metric)}</div><div class="kl-divider"></div><div class="kl-chip"><div class="kl-value">${h.copy(value)}</div></div>`;
      const timeline = [
        wipe(h, ".kl-metric", metric.at),
        draw(h, ".kl-divider", { scaleY: 0 }, { scaleY: 1 }, value.at),
        wipe(h, ".kl-chip", value.at, { x: 12, clipPath: "inset(0 0 0 100%)" }, { x: 0 }),
        riseValue(h, value.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-metric-stat-chip { display:grid;grid-template-columns:260px 2px 400px;gap:10px;align-items:center;padding:20px 19px;background:#0B0B0D; }
      .pro-metric-stat-chip .kl-metric { color:#F5F1E8;font:700 52px/56px "Inter",sans-serif;opacity:0; }
      .pro-metric-stat-chip .kl-divider { height:80px;background:#C8A24B;transform:scaleY(0);transform-origin:center top; }
      .pro-metric-stat-chip .kl-chip { padding:4px 6px;border-radius:52px;background:#C8A24B;color:#0B0B0D;text-align:center;opacity:0; }
      .pro-metric-stat-chip .kl-value { font:400 96px/108px "Anton",sans-serif;opacity:0; }`,
  },
  "metric-count-strip": {
    variantOf: "metric-stat-chip",
    family: "proof",
    tags: ["number"],
    hint: metricHint,
    source: "herk:kallaway.t2.lower-third.countbar",
    slots: { metric: spoken(26, 656), value: metricValue(656, proof.odometer.slots.value.validate) },
    size: { w: 720, h: 192 },
    surface: "obsidian",
    render(o, h) {
      const metric = o.slots.metric[0], value = o.slots.value[0];
      const inner = `<div class="kl-metric">${h.copy(metric)}</div><div class="kl-divider"></div><div class="kl-value">${h.copy(value)}</div>`;
      const timeline = [
        wipe(h, ".kl-metric", metric.at),
        draw(h, ".kl-divider", { scaleX: 0 }, { scaleX: 1 }, value.at),
        riseValue(h, value.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-metric-count-strip { display:flex;flex-direction:column;justify-content:center;gap:4px;padding:8px 32px;background:#0B0B0D; }
      .pro-metric-count-strip .kl-metric { color:#F5F1E8;font:700 52px/54px "Inter",sans-serif;opacity:0; }
      .pro-metric-count-strip .kl-divider { height:3px;background:#C8A24B;transform:scaleX(0);transform-origin:left center; }
      .pro-metric-count-strip .kl-value { color:#C8A24B;font:400 96px/108px "Anton",sans-serif;opacity:0; }`,
  },
  "place-pin": {
    family: "emphasis",
    tags: ["callout"],
    hint: "Greg explicitly names the city, venue or market where a sales example happened and that location matters to the point; use only the spoken place name",
    source: "herk:kallaway.t2.lower-third.geopin,kallaway.t2.lower-third.location",
    slots: { place: spoken(32, 592) },
    size: { w: 640, h: 160 },
    surface: "bare",
    render(o, h) {
      const place = o.slots.place[0];
      const pin = `<svg class="kl-pin" viewBox="0 0 56 64" aria-hidden="true"><path d="M28 60C24 55 5 37 5 25a23 23 0 1 1 46 0c0 12-19 30-23 35Z"/><circle cx="28" cy="25" r="8"/></svg>`;
      const inner = `${pin}<div class="kl-place">${h.copy(place)}</div>`;
      const timeline = [
        enter(h, ".kl-pin", { y: -12 }, { y: 0 }, place.at),
        wipe(h, ".kl-place", place.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-place-pin { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;overflow:hidden; }
      .pro-place-pin .kl-pin { display:block;width:56px;height:64px;fill:#0B0B0D;stroke:#C8A24B;stroke-width:4;opacity:0; }
      .pro-place-pin .kl-place { width:100%;padding:6px 24px;border-radius:36px;background:#0B0B0D;text-align:center;font:750 52px/60px "Inter",sans-serif;opacity:0; }`,
  },
  "topic-chip-grid": {
    family: "emphasis",
    tags: ["list", "highlight"],
    hint: "Greg names two to four short peer topics or skills in a single teaching beat; each chip is one spoken name in order",
    source: "herk:kallaway.t2.lower-third.tagrow",
    slots: { items: { ...spoken(22, 300, 2), repeat: [2, 4] } },
    size: (o) => ({ w: 704, h: o.slots.items.length > 2 ? 252 : 120 }),
    surface: "bare",
    render(o, h) {
      const inner = o.slots.items.map((item, i) => `<div class="kl-chip kl-chip-${i}"><span>${h.copy(item)}</span></div>`).join("");
      const timeline = o.slots.items.map((item, i) =>
        wipe(h, `.kl-chip-${i}`, item.at, { y: 12 }, { y: 0 })).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-topic-chip-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:120px;gap:12px;overflow:hidden; }
      .pro-topic-chip-grid .kl-chip { display:flex;align-items:center;justify-content:center;padding:4px 20px;border:2px solid #C8A24B;border-radius:28px;background:#0B0B0D;text-align:center;font:700 52px/54px "Inter",sans-serif;opacity:0; }`,
  },
  "headline-ticker": {
    family: "payoff",
    tags: ["title", "quote"],
    hint: "Greg names a short sales topic and immediately makes a self-contained headline-worthy claim about it; use the spoken topic and claim in that order",
    source: "herk:kallaway.t2.lower-third.ticker",
    slots: { topic: spoken(18, 260, 2), headline: spoken(52, 388, 3) }, // topic room for a word like "Objections" (Nov 27)
    size: { w: 720, h: 216 },
    surface: "obsidian",
    render(o, h) {
      const topic = o.slots.topic[0], headline = o.slots.headline[0];
      const inner = `<div class="kl-flag"><div class="kl-topic">${h.copy(topic)}</div></div><div class="kl-track"><div class="kl-headline">${h.copy(headline)}</div></div>`;
      const timeline = [
        wipe(h, ".kl-topic", topic.at),
        wipe(h, ".kl-headline", headline.at, { x: 16, clipPath: "inset(0 0 0 100%)" }, { x: 0 }),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-headline-ticker { display:grid;grid-template-columns:284px 1fr;padding:0;background:#0B0B0D; }
      .pro-headline-ticker .kl-flag { display:grid;place-items:center;padding:12px;background:#C8A24B;color:#0B0B0D; }
      .pro-headline-ticker .kl-topic { text-align:center;font:800 52px/58px "Inter",sans-serif;opacity:0; }
      .pro-headline-ticker .kl-track { display:flex;align-items:center;padding:12px 24px;overflow:hidden; }
      .pro-headline-ticker .kl-headline { width:388px;font:400 52px/60px "Anton",sans-serif;opacity:0; }`,
  },
};
