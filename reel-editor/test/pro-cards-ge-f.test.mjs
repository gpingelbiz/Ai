import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as batch } from "../src/pro-cards/ge-f.mjs";
import { CARDS, TAG_WORDS, tagsOf } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proPrompt, proSize, PRO_MOTION } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const recipes = {
  "kinetic-doc": `
    page-type-quote page-paper-term page-black-glow polaroid-slide window-steps archive-name-band
    counter-ticks red-label-sub erase-word swap-gag strike-red punch-picture punch-face-literal
    page-book-marginalia turn-wedding-portrait-phone frame-contact-sheet-grease page-balance-scale-tip
    prop-slot-drum-list page-plug-pulled-term stat-receipt-printout frame-quad-tiles print-side-taped-cover
    stamp-vykl-sources list-red-numerals-chest print-photo-corners-red print-lak-page-loupe
    timeline-then-now-line frame-print-pile page-lights-on-idea cta-five-stars-review
    idea-1 idea-2 idea-3 idea-4 idea-5`,
  "tactile-paper": `
    webgl-page-fold stepped-motion-12-8 page-unfurl-entrance gobo-shadow title-half-line-rise white-brush-arrow
    black-brush-arrow crimson-underline crimson-hand-ellipse charcoal-word-label rising-letters-word
    simmel-essay-page bw-city-print halftone-crowd-from-above notebook-speaker-line train-ticket-price
    sheet-unfurls-below-face archive-mount-print valley-print-below-face methods-list-struck-through
    clock-print-squats-rises count-strip-200-circled torn-cutout-beside-head grey-flip-failed-methods
    typed-labels-red-clock-scene typed-number-label-chest valley-print-paper-cut torn-paper-phone-own-recording
    torn-appstore-row-card own-recording-phone-print app-store-row-strip idea-1 idea-2 idea-3 idea-4
    idea-5 idea-6 idea-7 idea-8 idea-9 idea-10 idea-11 idea-12`,
};
const file = (name) => fs.readFileSync(new URL(`../src/pro-cards/${name}`, import.meta.url), "utf8");
const triage = JSON.parse(file("ge-triage-f.json"));

const methods = { attempts: ["Templates alone", "Daily check-ins", "Longer seminars"], outcome: "None of those stuck" };
const samples = {
  "quote-caret": { quote: "Give them room to decide" },
  "term-cursor": { word: "Discovery" },
  "word-lift": { word: "Discovery" },
  "count-tick-rail": { value: "eighty-eight", label: "Coaches booked in June" },
  "headline-double-wipe": { title: "Keep the pause", detail: "Let them finish thinking before you ask" },
  "habit-disconnect": { term: "Checking messages during discovery", detail: "You miss the first objection" },
  "topic-drum": { items: ["Discovery", "Follow-up", "Pricing"] },
  "ruled-out-methods": methods,
  "methods-reject-stamps": methods,
  "numbered-action-rows": { topics: ["First, ask why", "Step 2: wait", "Third, check what changed"] },
  "note-underline": { note: "A clear next step beats another pitch" },
  "offer-ticket": { price: "twelve dollars", offer: "Access to the group calls" },
  "metric-typed-slip": { metric: "Consults scheduled", value: "one thousand" },
  "before-after-overlay": { before: "30", after: "sixty-seven", label: "Consults booked" },
};

const reveals = {
  "quote-caret": { quote: ".gf-glyph" },
  "term-cursor": { word: ".gf-word" },
  "word-lift": { word: ".gf-glyph" },
  "count-tick-rail": { value: ".gf-value", label: ".gf-label" },
  "headline-double-wipe": { title: ".gf-title", detail: ".gf-detail" },
  "habit-disconnect": { term: ".gf-term", detail: ".gf-detail" },
  "topic-drum": { items: (i) => `.gf-frame-${i} .gf-topic` },
  "ruled-out-methods": { attempts: (i) => `.gf-row-${i} .gf-attempt`, outcome: ".gf-outcome" },
  "methods-reject-stamps": { attempts: (i) => `.gf-row-${i} .gf-attempt`, outcome: ".gf-outcome" },
  "numbered-action-rows": { topics: (i) => `.gf-action-${i}` },
  "note-underline": { note: ".gf-copy" },
  "offer-ticket": { price: ".gf-price", offer: ".gf-offer" },
  "metric-typed-slip": { metric: ".gf-metric", value: ".gf-value" },
  "before-after-overlay": { before: ".gf-before", after: ".gf-after .gf-text", label: ".gf-metric" },
};
const figureSlots = new Set(["value", "price", "before", "after"]);

function input(type, overrides = {}) {
  const values = { ...samples[type], ...overrides };
  const words = [{ text: "Earlier", start: 3.75, end: 3.875 }];
  const slots = {};
  for (const [name, slot] of Object.entries(batch[type].slots)) {
    const range = (text) => {
      const from = words.length;
      for (const token of text.split(" ")) {
        const start = 3.75 + words.length / 4;
        words.push({ text: token, start, end: start + 0.125 });
      }
      return { from, to: words.length - 1 };
    };
    slots[name] = slot.repeat ? values[name].map(range) : range(values[name]);
  }
  return { values, words, pick: { type, slots } };
}

const frame = { measured: true, W: 1080, H: 1920, head: { x: 400, y: 740, w: 200, h: 200 } };

function fixture(type, overrides, shot = frame) {
  const { values, words, pick } = input(type, overrides);
  const grounded = groundCard(pick, type, words);
  assert.ok(grounded, `${type} grounds ${JSON.stringify(values)}`);
  const place = placeProOverlay(grounded, shot);
  assert.ok(place, type);
  return { words, pick, grounded, place, overlay: { ...grounded, place, id: `test-${type}` } };
}

function listValues(values) {
  return Array.isArray(values) ? values : [values];
}

function assertRejected(type, name, value) {
  const { pick, words } = input(type, { [name]: value });
  assert.equal(groundCard(pick, type, words), null, `${type}.${name} rejects ${JSON.stringify(value)}`);
}

function callsFor(overlay) {
  const events = [];
  const tl = {
    fromTo(target, from, to, at) { events.push({ target, from, to, at }); },
    to(target, to, at) { events.push({ target, to, at }); },
  };
  new Function("tl", proTimeline([overlay]))(tl);
  return events;
}

function renderedText(html) {
  return html.replace(/<\/(?:div|svg)>|<br>/g, " ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

test("all 78 assigned source IDs are triaged, and every built card carries the matching MIT provenance", () => {
  const expected = Object.entries(recipes).flatMap(([recipe, ids]) => ids.trim().split(/\s+/).map((id) => `${recipe}/${id}`));
  assert.equal(triage.length, 78);
  assert.deepEqual(triage.map(({ id }) => id).sort(), expected.sort());
  assert.match(file("GHOST-EDITOR-LICENSE.md"), /MIT License[\s\S]*Copyright \(c\) 2026 kurbaitaev/);
  const totals = { new: 0, variant: 0, merged: 0, duplicate: 0, deferred: 0, unfit: 0, cut: 0 };
  for (const { id, outcome, type, reason } of triage) {
    assert.ok(Object.hasOwn(totals, outcome), id);
    totals[outcome]++;
    assert.match(reason, /^[^\n]+$/, id);
    if (outcome === "unfit") assert.equal(type, undefined, id);
    else if (outcome === "deferred") assert.match(type, /^[a-z]+(?:-[a-z]+)*$/, id);
    else if (outcome === "duplicate") assert.ok(CARDS[type] && !batch[type], id);
    // Cut at merge: the card was built, then deliberately dropped, so it must not survive in the registry.
    else if (outcome === "cut") { assert.ok(type && !CARDS[type], id); assert.match(reason, /^cut at merge:/, id); }
    else assert.ok(batch[type], id);
  }
  assert.deepEqual(totals, { new: 1, variant: 13, merged: 5, duplicate: 8, deferred: 0, unfit: 48, cut: 3 });
  for (const [type, def] of Object.entries(batch)) {
    const matching = triage.filter((entry) => entry.type === type);
    assert.deepEqual(matching.filter((entry) => entry.outcome !== "merged").map((entry) => entry.outcome),
      [def.variantOf ? "variant" : "new"], type);
    assert.deepEqual(def.source.split(",").sort(), matching.map(({ id }) => `ghost-editor:${id}`).sort(), type);
  }
});

test("the registry grounds each card from its exact ranges, places it in the safe zone, and prompts only roots", () => {
  assert.deepEqual(Object.keys(batch).sort(), Object.keys(samples).sort());
  const schema = (slots) => Object.entries(slots).map(([name, s]) => [name, s.kind, s.repeat, !!s.optional]);
  const zone = zoneFor();
  for (const [type, def] of Object.entries(batch)) {
    const { words, pick, grounded, place, overlay } = fixture(type);
    assert.equal(CARDS[type], def);
    assert.ok(tagsOf(type).length >= 1 && tagsOf(type).length <= 3 && tagsOf(type).every((tag) => TAG_WORDS.includes(tag)), type);
    if (def.variantOf) {
      assert.equal(def.hint, CARDS[def.variantOf].hint, type);
      assert.deepEqual(schema(def.slots), schema(CARDS[def.variantOf].slots), type);
      assert.equal(def.family, CARDS[def.variantOf].family, type);
    } else assert.match(def.hint, /^[^\n]+$/, type);
    const requested = { ...pick, type: def.variantOf || type, design: type };
    const resolved = groundProOverlay(requested, words);
    assert.equal(resolved.type, type);
    assert.deepEqual(resolved.slots, grounded.slots);
    const times = [];
    for (const [name, slot] of Object.entries(def.slots)) {
      assert.equal(slot.kind, "spoken");
      assert.ok(slot.size >= 40);
      for (const [i, item] of grounded.slots[name].entries()) {
        const { from, to } = listValues(pick.slots[name])[i];
        assert.equal(item.text, words.slice(from, to + 1).map((word) => word.text).join(" "));
        assert.equal(item.at, words[from].start);
        assert.equal(item.end, words[to].end);
        assert.equal(item.fontSize, undefined);
        times.push(item.at);
      }
    }
    assert.deepEqual(grounded.reveals, times, type);
    assert.equal(grounded.fullscreen, undefined, type);
    const size = proSize(overlay);
    assert.ok(size.w <= 720 && size.h <= 560, type);
    assert.equal(place.scale, 1, type);
    assert.ok(place.x >= zone.left && place.x + size.w <= rightLimit(zone, place.y, place.y + size.h), type);
    assert.ok(place.y >= zone.top && place.y + size.h <= zone.bottom, type);
    assert.equal(proPrompt(words).split("\n").filter((line) => line.startsWith(`${type} `)).length, def.variantOf ? 0 : 1, type);
  }
});

test("every spoken range rejects fabricated and oversized input and fits phone-size copy", () => {
  const longWord = "Relationship";
  assert.equal(longWord.length, 12);
  for (const [type, def] of Object.entries(batch)) {
    const { pick, words } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      const count = listValues(samples[type][name]).length;
      const withShape = (value) => slot.repeat ? Array(count).fill(value) : value;
      for (const bad of ["invented", { text: "99" }, { from: -1 }, { from: words.length }]) {
        assert.equal(groundCard({ slots: { ...pick.slots, [name]: withShape(bad) } }, type, words), null, `${type}.${name}`);
      }
      assertRejected(type, name, withShape("x".repeat(slot.maxChars + 1)));
      assertRejected(type, name, withShape("W".repeat(Math.floor(slot.width / (slot.size * 0.95)) + 1)));
      assertRejected(type, name, withShape("🎉"));
      // Numeric-only ranges keep their semantic check. The spelled figure has 12 letters.
      const isFigure = figureSlots.has(name);
      const longFigure = "seventy-seven";
      const longCopy = name === "price" ? `${longFigure} dollars` : isFigure ? longFigure : name === "topics" ? `First, ${longWord}` : longWord;
      const valid = fixture(type, { [name]: withShape(longCopy) });
      for (const item of valid.grounded.slots[name]) {
        assert.equal(item.fontSize, undefined, `${type}.${name}`);
        assert.ok(item.lines.some((line) => line.includes(isFigure ? longFigure : longWord)), `${type}.${name}`);
      }
    }
  }
  for (const type of ["count-tick-rail", "metric-typed-slip"]) {
    for (const value of ["Trust", "12 to 14", "about forty"]) assertRejected(type, "value", value);
  }
  assertRejected("count-tick-rail", "value", "40 percent");
  assertRejected("offer-ticket", "price", "twelve");
  assertRejected("numbered-action-rows", "topics", ["Check first", "Ask next", "Then wait"]);
  assertRejected("before-after-overlay", "after", "40 percent");
  assertRejected("before-after-overlay", "after", "60");
  assertRejected("word-lift", "word", "Two words");
  assertRejected("term-cursor", "word", "Two words");
  assertRejected("ruled-out-methods", "attempts", ["Scripts"]);
});

test("every copy and SVG stroke starts at its grounded reveal with deterministic house timing", () => {
  for (const [type] of Object.entries(batch)) {
    const { grounded, overlay } = fixture(type);
    const events = callsFor(overlay);
    assert.deepEqual(events.map((event) => [event.target, event.at]), callsFor(overlay).map((event) => [event.target, event.at]), type);
    for (const [name, items] of Object.entries(grounded.slots)) {
      for (const [i, item] of items.entries()) {
        const selector = reveals[type][name];
        const target = typeof selector === "function" ? selector(i) : selector;
        const event = events.find((call) => call.target === `#test-${type} ${target}` && call.at === item.at);
        assert.ok(event, `${type}.${name}[${i}] writes at ${item.at}`);
        assert.equal(event.from.opacity, 0);
        assert.equal(event.to.opacity, 1);
        assert.equal(event.to.immediateRender, false);
        assert.equal(event.to.duration + (event.to.stagger?.amount ?? 0), PRO_MOTION.enter);
      }
    }
    for (const event of events.filter((entry) => entry.from?.strokeDashoffset !== undefined)) {
      assert.ok(event.at >= grounded.start && event.at <= grounded.reveals.at(-1) + PRO_MOTION.state);
      assert.equal(event.to.strokeDashoffset, 0);
      assert.equal(event.to.duration, PRO_MOTION.state);
    }
  }
  const at = (fixture, selector) => callsFor(fixture.overlay).find(({ target }) => target.endsWith(selector));
  for (const [type, mark] of [["ruled-out-methods", ".gf-ink"], ["methods-reject-stamps", ".gf-stamp"]]) {
    const scene = fixture(type);
    assert.equal(at(scene, mark).at, scene.grounded.slots.outcome[0].at);
  }
  // brush-arrow-callout (the shaft-then-head motion) was cut at merge (see ge-triage-f.json).
});

test("rendered panels carry escaped copy and scoped pro-only CSS", () => {
  const palette = ["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"];
  const special = "<b>&'Pitch'";
  const escaped = "&lt;b&gt;&amp;&#39;Pitch&#39;";
  for (const [type, def] of Object.entries(batch)) {
    const { grounded, overlay } = fixture(type);
    const normal = renderProOverlay(overlay).html;
    const text = renderedText(normal);
    for (const item of grounded.phrases) assert.ok(text.includes(item.text), `${type} displays ${item.text}`);
    const displayedNumbers = text.match(/\d[\d,.%]*/g) || [];
    const spokenNumbers = grounded.phrases.flatMap(({ text }) => text.match(/\d[\d,.%]*/g) || []);
    assert.deepEqual(displayedNumbers, spokenNumbers, type);
    const [name, slot] = Object.entries(def.slots).find(([key]) => !figureSlots.has(key));
    const values = name === "topics" ? ["First, " + special, "Second, wait", "Third, ask"] : slot.repeat ? [special, "Pause"] : special;
    const { overlay: unsafe } = fixture(type, { [name]: values });
    const html = renderProOverlay(unsafe).html;
    assert.ok(renderedText(html).includes(escaped), type);
    assert.doesNotMatch(html, /<b>|<img\b|<image\b|<use\b|<script\b|<canvas\b/i);
    assert.doesNotMatch(def.css, /gradient|blur\(|text-shadow|url\(/i);
    for (const color of def.css.match(/#[0-9a-f]{6}/gi) || []) assert.ok(palette.includes(color), type);
    for (const [, font] of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font), type);
    for (const rule of def.css.matchAll(/(?:^|\})([^{}]+)\{/g)) {
      for (const selector of rule[1].trim().split(",")) assert.ok(selector.trim().startsWith(`.pro-${type}`), type);
    }
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css), type);
  }
});

test("maximum row counts and multiline figures stay in an on-footage placement rect", () => {
  const cases = [
    ["quote-caret", { quote: "Relationship Relationship Relationship Relationship" }],
    ["count-tick-rail", { value: "seven hundred thousand", label: "Booked consultations and review calls" }],
    ["ruled-out-methods", { attempts: Array(4).fill("Relationship making without context"), outcome: "It never gave them room to decide before pricing" }],
    ["methods-reject-stamps", { attempts: Array(4).fill("Relationship making without context"), outcome: "It never gave them room to decide before pricing" }],
    ["offer-ticket", { price: "seven hundred dollars", offer: "Call feedback plus full discovery review" }],
    ["metric-typed-slip", { metric: "Booked consultations and review calls", value: "seven hundred thousand" }],
    ["topic-drum", { items: ["Discovery", "Follow-up", "Pricing", "Closing"] }],
    ["numbered-action-rows", { topics: ["First, Relationship building", "Second, Discovery questions", "Third, Practice objections", "Fourth, Follow-up messages"] }],
    ["before-after-overlay", { before: "one hundred thousand", after: "two hundred thousand", label: "Booked consultations and review calls" }],
  ];
  const wideShot = { ...frame, head: { ...frame.head, y: 940 } };
  for (const [type, values] of cases) {
    const { overlay } = fixture(type, values, wideShot);
    const size = proSize(overlay);
    assert.ok(size.w <= 720 && size.h <= 560 && overlay.place.scale === 1, type);
  }
});

test("vendored GSAP gives the same visible states when seeking forward, backward and out of order", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap;
  const timeline = gsap.timeline({ paused: true });
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const targets = new Map();
  const tl = {};
  for (const method of ["fromTo", "to"]) {
    tl[method] = (selector, ...args) => {
      if (!targets.has(selector)) {
        const fields = { opacity: 0, clipPath: "inset(0 100% 0 0)", strokeDashoffset: 1, x: 0, y: 0, scale: 1, scaleY: 1 };
        // Give the stagger and shared marks multiple targets, as they have in the rendered card.
        const count = /gf-glyph|gf-ink|gf-stamp/.test(selector) ? 3 : 1;
        targets.set(selector, Array.from({ length: count }, () => ({ ...fields })));
      }
      timeline[method](targets.get(selector), ...args);
      return tl;
    };
  }
  new Function("tl", proTimeline(Object.keys(batch).map((type) => fixture(type).overlay)))(tl);
  const sample = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...targets].flatMap(([selector, elements]) => {
      if (targets.get(selector.split(" ")[0])[0].opacity === 0) return [];
      return elements.map(({ opacity, clipPath, strokeDashoffset, x, y, scale, scaleY }) =>
        [opacity, clipPath, strokeDashoffset, x, y, scale, scaleY]);
    });
  };
  const frames = Array.from({ length: 421 }, (_, i) => i);
  const forward = frames.map(sample);
  for (const frame of frames.toReversed()) assert.deepEqual(sample(frame), forward[frame], `reverse frame ${frame}`);
  for (const i of frames) {
    const frame = i * 137 % frames.length;
    assert.deepEqual(sample(frame), forward[frame], `shuffled frame ${frame}`);
  }
});
