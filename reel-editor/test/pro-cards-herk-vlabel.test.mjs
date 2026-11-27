import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as batch } from "../src/pro-cards/herk-vlabel.mjs";
import { CARDS, CARD_GROUPS, tagsOf } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proPrompt, proSize, PRO_MOTION, PRO_RECTS } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const root = "term-explainer";
const rootSlots = ["term", "detail"];
const quoteSlots = ["quote", "context"];
const definition = { term: "Trust gap", detail: "You ask for commitment before they feel ready" };
const pullQuote = { quote: "Slow down to sell better", context: "The pause gives them room to think" };
const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/herk-triage-vlabel.json", import.meta.url), "utf8"));

function input(type, overrides = {}) {
  const values = { ...(type === "quote-with-context" ? pullQuote : definition), ...overrides };
  const words = [{ text: "Earlier", start: 3, end: 3.12 }], pick = { type, slots: {} };
  for (const name of Object.keys(batch[type].slots)) {
    const from = words.length;
    for (const text of values[name].split(" ")) {
      const start = 3 + words.length / 4;
      words.push({ text, start, end: start + 0.125 });
    }
    pick.slots[name] = { from, to: words.length - 1 };
  }
  return { values, words, pick };
}

function fixture(type, overrides) {
  const { values, words, pick } = input(type, overrides), grounded = groundCard(pick, type, words);
  assert.ok(grounded, type);
  const place = placeProOverlay(grounded, { measured: true, W: 1080, H: 1920, head: { x: 400, y: 740, w: 200, h: 200 } });
  assert.ok(place, type);
  return { values, words, pick, grounded, overlay: { ...grounded, id: `test-${type}`, place } };
}

function events(overlay) {
  const calls = [], tl = {};
  tl.fromTo = (target, from, to, at) => { calls.push({ target, from, to, at }); return tl; };
  tl.to = (target, to, at) => { calls.push({ target, to, at }); return tl; };
  new Function("tl", proTimeline([overlay]))(tl);
  return calls;
}

const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("triage accounts for every source and the kept designs carry all their source IDs", () => {
  const expected = {
    "lower-third": ["marker", "bar-slab", "index-tab", "stacked", "sticky", "rail", "badge", "clapper", "highlight", "bracket", "stamp", "ribbon", "type-card"],
    label: ["margin-note", "circle", "bracket", "sticky", "underline", "pin", "footnote", "tag", "caption", "definition", "spotlight", "pull-quote", "magnify"],
  };
  const ids = Object.entries(expected).flatMap(([group, designs]) => designs.map((d) => `vox-explainer.t2.${group}.${d}`));
  assert.deepEqual(triage.map(({ id }) => id).sort(), ids.sort());
  const totals = { new: 0, variant: 0, merged: 0, duplicate: 0, unfit: 0 };
  for (const entry of triage) {
    const { id, outcome, type, reason } = entry;
    assert.ok(Object.hasOwn(totals, outcome), id);
    totals[outcome]++;
    assert.ok(reason.length && !reason.includes("\n"), id);
    if (outcome === "unfit") assert.equal(type, undefined);
    else assert.ok(CARDS[type], id);
  }
  assert.deepEqual(totals, { new: 2, variant: 6, merged: 5, duplicate: 0, unfit: 13 });
  for (const [type, def] of Object.entries(batch)) {
    const entries = triage.filter((entry) => entry.type === type);
    assert.deepEqual(entries.filter((entry) => entry.outcome !== "merged").map((entry) => entry.outcome), [def.variantOf ? "variant" : "new"], type);
    assert.match(def.source, /^herk:/);
    assert.deepEqual(def.source.slice(5).split(",").sort(), entries.map(({ id }) => id).sort(), type);
  }
});

test("the designs ground their exact ranges and fit the registered placement and social safe zone", () => {
  const zone = zoneFor();
  for (const [type, def] of Object.entries(batch)) {
    const { values, words, pick, grounded, overlay } = fixture(type);
    assert.equal(CARDS[type], def);
    assert.equal(def.family, "payoff");
    assert.deepEqual(tagsOf(type), type === "quote-with-context" ? ["quote", "callout"] : ["definition", "callout"]);
    const names = type === "quote-with-context" ? quoteSlots : rootSlots;
    assert.deepEqual(Object.keys(def.slots), names);
    assert.deepEqual(groundProOverlay({ ...pick, type: def.variantOf || type, design: type }, words),
      type === "quote-with-context" ? grounded : { ...grounded, group: root });
    assert.deepEqual(grounded.reveals, names.map((name) => words[pick.slots[name].from].start));
    for (const name of names) {
      const item = grounded.slots[name][0], slot = def.slots[name];
      assert.equal(slot.kind, "spoken");
      assert.equal(item.text, values[name]);
      assert.equal(item.at, words[pick.slots[name].from].start);
      assert.equal(item.end, words[pick.slots[name].to].end);
      assert.ok(slot.size >= 40);
      assert.equal(item.fontSize, undefined);
    }
    assert.equal(grounded.fullscreen, undefined);
    assert.deepEqual(proSize(overlay), def.size);
    assert.ok(PRO_RECTS.some((rect) => def.size.w <= rect.w && def.size.h <= rect.h), type);
    const { x, y, w, h, scale } = overlay.place;
    assert.equal(scale, 1, type);
    assert.ok(x >= zone.left && x + w <= rightLimit(zone, y, y + h), type);
    assert.ok(y >= zone.top && y + h <= zone.bottom, type);
  }
});

test("prompt and selection keep one definition type and skip a lens that cannot fit the term", () => {
  assert.deepEqual(CARD_GROUPS[root], Object.keys(batch).filter((type) => type !== "quote-with-context"));
  const { words, pick } = input("term-lens", { term: "Confirmation bias" });
  assert.equal(groundCard(pick, "term-lens", words), null);
  const requested = { ...pick, type: root, design: "term-lens" };
  const selected = groundProOverlay(requested, words);
  assert.ok(selected);
  assert.notEqual(selected.type, "term-lens");
  assert.equal(selected.group, root);
  assert.deepEqual(groundProOverlay(requested, words), selected);
  const prompt = proPrompt(words);
  for (const [type, def] of Object.entries(batch)) {
    const lines = prompt.split("\n").filter((line) => line.startsWith(`${type} `));
    assert.equal(lines.length, def.variantOf ? 0 : 1, type);
  }
});

test("all slots reject invented, overlapping, oversized and unreadably wide copy", () => {
  for (const [type, def] of Object.entries(batch)) {
    const { words, pick } = input(type);
    const [first, second] = Object.keys(def.slots);
    assert.equal(groundCard({ ...pick, [second]: pick.slots[first] }, type, words), null);
    for (const [name, slot] of Object.entries(def.slots)) {
      for (const value of [undefined, "invented", { text: "99" }, { from: -1 }, { from: words.length }, { from: 1, to: 0 }]) {
        assert.equal(groundCard({ slots: { ...pick.slots, [name]: value } }, type, words), null, `${type}.${name}`);
      }
      const long = input(type, { [name]: "x".repeat(slot.maxChars + 1) });
      assert.equal(groundCard(long.pick, type, long.words), null, `${type}.${name} character limit`);
      // This token would fit if the shared fitter shrank the font, but may not fit at the card's phone size.
      const wide = input(type, { [name]: "W".repeat(Math.floor(slot.width / (slot.size * 0.95)) + 1) });
      assert.equal(groundCard(wide.pick, type, wide.words), null, `${type}.${name} width limit`);
      const emoji = input(type, { [name]: "🎉" });
      assert.equal(groundCard(emoji.pick, type, emoji.words), null, `${type}.${name} emoji`);
    }
  }
});

test("the markup displays only escaped spoken copy, with no added numbers or attribution", () => {
  for (const type of Object.keys(batch)) {
    const [first, second] = Object.keys(batch[type].slots);
    const { overlay } = fixture(type, { [first]: "<b>&", [second]: "'Wait' 2 minutes" });
    const html = renderProOverlay(overlay).html;
    assert.equal(visible(html), "&lt;b&gt;&amp; &#39;Wait&#39; 2 minutes", type);
    assert.doesNotMatch(html, /<b>|<img\b|<image\b|<use\b|<script\b/);
  }
  const { words, pick, overlay } = fixture("quote-with-context");
  const grounded = groundCard({ ...pick, slots: { ...pick.slots, note: "Author, 2024" } }, "quote-with-context", words);
  assert.equal(renderProOverlay({ ...overlay, ...grounded }).html, renderProOverlay(overlay).html);
  assert.match(renderProOverlay(fixture("term-lens").overlay).html, /Trust<br>gap/);
});

test("each write starts on its own word and the accents preserve each design's motion", () => {
  const accents = {
    "term-explainer": [".vl-marker", "scaleX", 0, 1, 0, "enter"],
    "term-brackets": [".vl-right", "x", 8, 0, 0, "enter"],
    "term-sticky": [".vl-drop", "y", -10, 0, 0, "enter"],
    "term-underline": [".vl-line path", "strokeDashoffset", 1, 0, 0, "state"],
    "term-pin": [".vl-rail path", "strokeDashoffset", 1, 0, 1, "state"],
    "term-caption": [".vl-dash path", "strokeDashoffset", 1, 0, 1, "state"],
    "term-lens": [".vl-lens", "scale", 0.9, 1, 0, "enter"],
    "quote-with-context": [".vl-mark", "y", -10, 0, 0, "enter"],
  };
  for (const type of Object.keys(batch)) {
    const { overlay } = fixture(type);
    const calls = events(overlay);
    assert.equal(calls[0].at, overlay.start);
    assert.equal(calls[0].to.duration, PRO_MOTION.enter);
    for (const [slot, [item]] of Object.entries(overlay.slots)) {
      const write = calls.find((call) => call.target === `#${overlay.id} .vl-${slot}`);
      assert.equal(write.from.opacity, 0, `${type}.${slot}`);
      assert.equal(write.to.opacity, 1);
      assert.equal(write.from.clipPath, type === "term-brackets" && slot === "term" ? "inset(0 50% 0 50%)" : "inset(0 100% 0 0)");
      assert.equal(write.to.clipPath, "inset(0 0% 0 0)");
      assert.equal(write.to.duration, PRO_MOTION.enter);
      assert.equal(write.at, item.at);
    }
    const [selector, prop, from, to, reveal, motion] = accents[type];
    const accent = calls.find((call) => call.target === `#${overlay.id} ${selector}`);
    assert.equal(accent.from[prop], from, type);
    assert.equal(accent.to[prop], to, type);
    assert.equal(accent.at, overlay.reveals[reveal]);
    assert.equal(accent.to.duration, PRO_MOTION[motion]);
    for (const call of calls.slice(0, -1)) {
      assert.equal(call.to.immediateRender, false);
      assert.equal(typeof call.to.ease, "function");
      for (const axis of ["x", "y"]) assert.ok(Math.abs(call.from[axis] || 0) <= 16);
      assert.ok(!("rotation" in call.from || "rotation" in call.to));
    }
    assert.equal(calls.at(-1).target, `#${overlay.id}`);
    assert.equal(calls.at(-1).to.duration, PRO_MOTION.exit);
    assert.equal(calls.at(-1).at, +(overlay.end - PRO_MOTION.exit).toFixed(3));
  }
});

test("all styling stays scoped and uses house colors and fonts", () => {
  const palette = ["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"];
  for (const [type, def] of Object.entries(batch)) {
    const { overlay } = fixture(type);
    const { html, timeline } = renderProOverlay(overlay);
    assert.doesNotMatch(def.css, /gradient\(|blur\(|glow|@keyframes|url\(/i);
    assert.doesNotMatch(timeline, /Date|Math\.random|bounce|back\.out|rotation|onUpdate|onComplete/);
    assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}]/u);
    for (const rule of def.css.split("}").filter((rule) => rule.trim())) {
      for (const selector of rule.split("{")[0].split(",")) {
        assert.match(selector.trim(), new RegExp(`^\\.pro-${type}(?:[ .:]|$)`));
      }
    }
    for (const color of (def.css + html + timeline).match(/#[\da-f]{6}\b/gi) || []) assert.ok(palette.includes(color), color);
    for (const [, font] of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font), font);
    const css = proCSS({ types: new Set([type]) });
    assert.ok(css.includes(def.css));
    for (const [other, spec] of Object.entries(batch)) if (other !== type) assert.ok(!css.includes(spec.css));
  }
});

test("the vendored GSAP timeline seeks to the same state in any order", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true });
  const targets = new Map(), tl = {};
  const properties = ["opacity", "clipPath", "scale", "scaleX", "strokeDashoffset", "x", "y"];
  const initial = { opacity: 0, clipPath: "inset(0 100% 0 0)", scale: 1, scaleX: 0, strokeDashoffset: 1, x: 0, y: 0 };
  for (const method of ["fromTo", "to"]) tl[method] = (selector, ...args) => {
    if (!targets.has(selector)) targets.set(selector, { ...initial });
    timeline[method](targets.get(selector), ...args);
    return tl;
  };
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  new Function("tl", proTimeline(Object.keys(batch).map((type) => fixture(type).overlay)))(tl);
  const sample = (n) => {
    timeline.totalTime(n / 30, false);
    return [...targets.values()].map((target) => properties.map((key) => target[key]));
  };
  const frames = Array.from({ length: 241 }, (_, i) => i);
  const forward = frames.map(sample);
  for (const frame of frames.toReversed()) assert.deepEqual(sample(frame), forward[frame], `reverse frame ${frame}`);
  for (const i of frames) {
    const frame = i * 137 % frames.length;
    assert.deepEqual(sample(frame), forward[frame], `shuffled frame ${frame}`);
  }
});
