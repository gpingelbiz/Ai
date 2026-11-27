import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as BATCH } from "../src/pro-cards/herk-klower.mjs";
import { CARDS, CARD_GROUPS, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proSize, PRO_MOTION } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const fixtures = {
  "chapter-strip": { title: "The follow up call" },
  "quote-strip": { quote: "Slow down to speed up" },
  "metric-stat-chip": { metric: "Close rate", value: "87%" },
  "metric-count-strip": { metric: "Calls booked", value: "128,000" },
  "place-pin": { place: "San Francisco" },
  "topic-chip-grid": { items: ["Permission", "Timing", "Tone", "Follow up"] },
  "headline-ticker": { topic: "Follow ups", headline: "Fewer words win more calls" },
};

function input(type, overrides = {}) {
  const values = { ...fixtures[type], ...overrides };
  const pick = { type }, words = [];
  const span = (value) => {
    const from = words.length;
    for (const text of value.split(" ")) {
      const start = 3 + words.length * 0.4;
      words.push({ text, start, end: start + 0.3 });
    }
    return { from, to: words.length - 1 };
  };
  for (const [name, slot] of Object.entries(BATCH[type].slots)) {
    const value = values[name];
    if (value == null) continue;
    pick[name] = slot.repeat ? value.map(span) : span(value);
  }
  return { pick, words, values };
}

function render(type, overrides) {
  const { words, pick } = input(type, overrides);
  const grounded = groundCard(pick, type, words);
  assert.ok(grounded, type);
  const overlay = { ...grounded, id: type, place: { x: 180, y: 288, scale: 1 } };
  const calls = [];
  const timeline = {
    fromTo: (...args) => calls.push({ selector: args[0], from: args[1], to: args[2], at: args[3] }),
    to: (...args) => calls.push({ selector: args[0], to: args[1], at: args[2] }),
  };
  new Function("tl", proTimeline([overlay]))(timeline);
  return { ...renderProOverlay(overlay), overlay, calls };
}

test("the 60 lower thirds have exactly one triage decision and built designs carry their sources", () => {
  const ids = `avatar badgecard barslide bracket brandbar bug capsule chapterbar chip cinemastrip cite clockname
    coordbar corner cornerframe countbar dividername dotline doublecard dual edgebar flipcard geopin glasscard
    gradient gradientbar handlebar infochips lensbar live location logolock micname minicard minimal nameplate3d
    neonframe neonpill nowplaying orbitbadge pill portraitframe progressname quote ratingname ribbon sidebracket
    slidetab social spotlightname stacked statline tagrow thinstrip ticker titlebar trust typedname underbar waveband`
    .trim().split(/\s+/).map((name) => `kallaway.t2.lower-third.${name}`);
  const rows = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/herk-triage-klower.json", import.meta.url), "utf8"));
  assert.deepEqual(rows.map((row) => row.id).sort(), ids.sort());
  const counts = { new: 0, variant: 0, merged: 0, duplicate: 0, unfit: 0 };
  for (const { id, outcome, type, reason } of rows) {
    assert.ok(Object.hasOwn(counts, outcome));
    counts[outcome]++;
    assert.ok(reason.length > 15 && !reason.includes("\n"), id);
    if (outcome === "unfit") assert.equal(type, undefined, id);
    else assert.ok(CARDS[type], id);
    if (outcome === "new") assert.ok(!BATCH[type].variantOf, id);
    if (outcome === "variant") assert.ok(BATCH[type].variantOf, id);
  }
  assert.deepEqual(counts, { new: 5, variant: 2, merged: 3, duplicate: 0, unfit: 50 });
  for (const [type, def] of Object.entries(BATCH)) {
    assert.match(def.source, /^herk:/);
    const carried = rows.filter((row) => row.type === type).map((row) => row.id);
    assert.deepEqual(def.source.slice(5).split(",").sort(), carried.sort(), type);
  }
});

test("each design registers, grounds exact text through the planner entry point and fits the safe zone", () => {
  assert.deepEqual(Object.keys(BATCH), Object.keys(fixtures));
  for (const [type, def] of Object.entries(BATCH)) {
    const { words, pick, values } = input(type);
    const root = def.variantOf || type;
    assert.equal(CARDS[type], def);
    assert.ok(CARD_GROUPS[root].includes(type));
    assert.ok(def.tags.every((tag) => TAG_WORDS.includes(tag)));
    const overlay = groundProOverlay({ ...pick, type: root, design: type }, words);
    assert.ok(overlay, type);
    assert.equal(overlay.type, type);
    if (def.variantOf) assert.equal(overlay.group, root);
    assert.deepEqual(overlay.reveals, overlay.phrases.map((item) => words[item.from].start));
    const size = proSize(overlay);
    assert.ok(!overlay.fullscreen && size.w <= 720 && size.h <= 560, type);
    for (const [name, slot] of Object.entries(def.slots)) {
      assert.deepEqual(overlay.slots[name].map((item) => item.text), slot.repeat ? values[name] : [values[name]]);
      for (const item of overlay.slots[name]) {
        assert.ok(item.lines.length <= slot.maxLines);
        const minSize = name === "value" ? 96 : 40;
        assert.ok((item.fontSize || slot.size) >= minSize, `${type}.${name}`);
      }
    }
    const place = placeProOverlay(overlay, {
      W: 1080, H: 1920, measured: true,
      head: { x: 185, y: 180, w: 715, h: 650 },
      caption: { x: 0, y: 1080, w: 1080, h: 220 },
      mic: { x: 0, y: 900, w: 300, h: 440 },
    });
    assert.ok(place?.slot.startsWith("torso"), type);
    const zone = zoneFor();
    const bottom = place.y + place.h;
    assert.ok(place.x >= zone.left && place.y >= zone.top, type);
    assert.ok(bottom <= zone.bottom && place.x + place.w <= rightLimit(zone, place.y, bottom), type);
  }
});

test("the designs reject invented, missing, out-of-order and over-budget slots", () => {
  for (const [type, def] of Object.entries(BATCH)) {
    const { pick, words } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      const ground = (value) => groundCard({ ...pick, [name]: value }, type, words);
      assert.equal(ground(undefined), null, `${type}.${name}`);
      for (const invalid of [{ text: "invented" }, { from: words.length }, { from: 0, to: -1 }]) {
        assert.equal(ground(slot.repeat ? [invalid, ...pick[name].slice(1)] : invalid), null, type);
      }
      const long = "W".repeat(slot.maxChars + 1);
      const large = input(type, { [name]: slot.repeat ? [long, "Tone"] : long });
      assert.equal(groundCard(large.pick, type, large.words), null, `${type}.${name}`);
    }
  }
  const type = "topic-chip-grid";
  for (const items of [["Timing"], ["Timing", "Tone", "Empathy", "Listening", "Follow up"]]) {
    const { pick, words } = input(type, { items });
    assert.equal(groundCard(pick, type, words), null);
  }
  const { pick, words } = input(type);
  assert.equal(groundCard({ ...pick, items: pick.items.toReversed() }, type, words), null);
  assert.equal(groundCard({ ...pick, items: [pick.items[0], pick.items[0]] }, type, words), null);
  const pair = groundCard({ ...pick, items: pick.items.slice(0, 2) }, type, words);
  assert.deepEqual(proSize(pair), { w: 704, h: 120 });
});

test("metrics validate spoken quantities, preserve the exact value and switch designs for wider counts", () => {
  for (const type of ["metric-count-strip", "metric-stat-chip"]) {
    for (const value of ["many", "20 to 30", "1,2", "20/30", "-5", "Infinity", "one hundred and forty two"]) {
      const { pick, words } = input(type, { value });
      assert.equal(groundCard(pick, type, words), null, `${type}: ${value}`);
    }
    for (const value of type === "metric-count-strip" ? ["0", "twenty", "128,000"] : ["87%", "$2.40", "$2.4B", "3", "zero"]) {
      const { html, overlay } = render(type, { value });
      assert.equal(overlay.slots.value[0].text, value);
      assert.ok(html.includes(`class="kl-value">${value}</div>`), value);
      const text = html.replace(/<[^>]+>/g, "");
      assert.deepEqual(text.match(/\d+/g) || [], value.match(/\d+/g) || []);
    }
  }
  const { pick, words } = input("metric-stat-chip", { value: "128,000" });
  const fallback = groundProOverlay({ ...pick, design: "metric-stat-chip" }, words);
  assert.equal(fallback.type, "metric-count-strip");
  assert.equal(fallback.slots.value[0].text, "128,000");
});

test("every spoken field writes in at its own word and the panel owns the exit", () => {
  const selectors = {
    "chapter-strip": [".kl-title"],
    "quote-strip": [".kl-quote"],
    "metric-count-strip": [".kl-metric", ".kl-value"],
    "metric-stat-chip": [".kl-metric", ".kl-value"],
    "place-pin": [".kl-place"],
    "topic-chip-grid": [".kl-chip-0", ".kl-chip-1", ".kl-chip-2", ".kl-chip-3"],
    "headline-ticker": [".kl-topic", ".kl-headline"],
  };
  for (const [type, fields] of Object.entries(selectors)) {
    const { html, timeline, calls, overlay } = render(type);
    assert.match(html, new RegExp(`class="pro-overlay pro-${type}`));
    assert.equal(fields.length, overlay.phrases.length);
    fields.forEach((selector, i) => {
      const item = overlay.phrases[i];
      assert.ok(html.includes(item.lines.join("<br>")), type);
      const call = calls.find((call) => call.selector === `#${type} ${selector}`);
      assert.equal(call.at, item.at, selector);
      assert.equal(call.from.opacity, 0, selector);
      assert.equal(call.to.opacity, 1, selector);
      assert.equal(call.to.duration, PRO_MOTION.enter);
    });
    for (const call of calls.slice(1, -1)) {
      assert.equal(call.to.immediateRender, false);
      assert.ok([PRO_MOTION.enter, PRO_MOTION.state].includes(call.to.duration));
      assert.equal(typeof call.to.ease, "function");
      assert.ok(Math.abs(call.from.x || 0) <= 16 && Math.abs(call.from.y || 0) <= 16);
    }
    assert.equal(calls.at(-1).selector, `#${type}`);
    assert.equal(calls.at(-1).to.duration, PRO_MOTION.exit);
    assert.doesNotMatch(timeline, /Math\.random|Date|rotation|repeat:|onUpdate|NaN|undefined/);
  }
  const chapter = render("chapter-strip").calls.find((call) => call.selector.endsWith(".kl-edge"));
  assert.equal(chapter.from.scaleX, 0);
  assert.equal(chapter.to.scaleX, 1);
  assert.equal(chapter.to.duration, PRO_MOTION.state);
  const ticker = render("headline-ticker").calls.find((call) => call.selector.endsWith(".kl-headline"));
  assert.equal(ticker.from.clipPath, "inset(0 0 0 100%)");
  assert.equal(ticker.from.x, 16);
  const pin = render("place-pin").calls.find((call) => call.selector.endsWith(".kl-pin"));
  assert.equal(pin.from.y, -12);
});

test("all card copy is escaped and styles stay within the pro type, palette and fonts", () => {
  const text = "<b> & 'x'";
  for (const [type, def] of Object.entries(BATCH)) {
    const [name, slot] = Object.entries(def.slots)[0];
    const { html } = render(type, { [name]: slot.repeat ? [text, "Tone"] : text });
    assert.match(html.replaceAll("<br>", " "), /&lt;b&gt; &amp; &#39;x&#39;/);
    assert.doesNotMatch(html, /<b>|<img|<image/);
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css), type);
    assert.doesNotMatch(proCSS({ types: new Set(["objection"]) }), new RegExp(`\\.pro-${type}(?![a-z-])`));
    for (const [, selector] of def.css.matchAll(/([^{}]+)\{/g)) {
      assert.ok(selector.trim() === `.pro-${type}` || selector.trim().startsWith(`.pro-${type} `), selector);
    }
    for (const [color] of def.css.matchAll(/#[\da-f]+/gi)) {
      assert.ok(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"].includes(color), color);
    }
    for (const [, font] of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font));
    assert.doesNotMatch(def.css, /blur|gradient|glow|animation:|@keyframes/i);
  }
});

test("vendored GSAP reproduces the lower thirds on forward, reverse and shuffled seeks", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap;
  const timeline = gsap.timeline({ paused: true });
  const elements = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });

  const overlays = Object.keys(BATCH).map((type) => render(type).overlay);
  const tl = {};
  for (const method of ["fromTo", "to"]) {
    tl[method] = (selector, ...args) => {
      if (!elements.has(selector)) {
        const isRule = /\.kl-(?:edge|divider)$/.test(selector);
        elements.set(selector, { opacity: isRule ? 1 : 0, x: 0, y: 0, scaleX: 0, scaleY: 0, clipPath: "inset(0 0 0 0)" });
      }
      return timeline[method](elements.get(selector), ...args);
    };
  }
  new Function("tl", proTimeline(overlays))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...elements].map(([selector, el]) => {
      const panel = elements.get(selector.split(" ")[0]);
      if (!panel.opacity || !el.opacity) return null;
      return [el.opacity, el.x, el.y, el.scaleX, el.scaleY, el.clipPath];
    });
  };
  const frames = Array.from({ length: 240 }, (_, i) => i);
  const forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (const index of frames) {
    const frame = index * 137 % frames.length;
    assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`);
  }
});
