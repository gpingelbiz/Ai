import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { CARDS as batch } from "../src/pro-cards/ge-g.mjs";
import { CARDS, CARD_GROUPS, TAG_WORDS, tagsOf } from "../src/pro-cards/index.mjs";
import { PRO_MOTION, PRO_RECTS, groundCard, groundProOverlay, proSize, proTextWidth } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const fixtures = {
  "rising-sheets": { values: { items: ["Lead with the problem", "Ask what changed", "Book the next call", "Confirm the handoff"] }, selectors: [".ge-item-0", ".ge-item-1", ".ge-item-2", ".ge-item-3"] },
  "height-marks": { values: { steps: ["Find the friction", "Practice the opener", "Review the call", "Coach the feedback"] }, selectors: [".ge-step-0", ".ge-step-1", ".ge-step-2", ".ge-step-3"] },
  "draft-send": { values: { message: "Still open to a conversation this week?" }, selectors: [".ge-message"] },
  "voice-playback": { values: { transcript: "Call me back when you have time to talk about next steps." }, selectors: [".ge-transcript"] },
  "audience-focus": { values: { audience: "Everyone in the pipeline", focus: "The ones who already asked for help" }, selectors: [".ge-audience", ".ge-focus"] },
  "reply-selection": { values: { incoming: "I need to think about it.", replies: ["Sure, let me know.", "When can we talk?", "What is holding you back?"] }, selectors: [".ge-incoming", ".ge-option-0", ".ge-option-1", ".ge-option-2"] },
  "comment-keyword-offer": { values: { instruction: "Comment", keyword: "DISCOVERY", offer: "and I will send you my exact discovery script." }, selectors: [".ge-instruction", ".ge-keyword", ".ge-offer"] },
  "center-out-title": { values: { headline: "Opening the discovery call" }, selectors: [".ge-headline"] },
  "stacked-promise": { values: { lines: ["Ask the question", "that gets them", "to decide"] }, selectors: [".ge-tier-0", ".ge-tier-1", ".ge-tier-2"] },
  "count-settle": { values: { value: "one hundred twelve", label: "calls we reviewed" }, selectors: [".ge-value", ".ge-count-label"] },
  "quote-aperture": { values: { quote: "A better question will usually get you further than a louder pitch." }, selectors: [".ge-quote"] },
  "milestone-draw": { values: { pins: ["First conversation", "Discovery call", "Written offer", "Signed agreement"] }, selectors: [".ge-pin-0", ".ge-pin-1", ".ge-pin-2", ".ge-pin-3"] },
  "count-ring-pair": { values: { first: "eighteen", firstContext: "calls booked", second: "12", secondContext: "calls attended" }, selectors: [".ge-first-value", ".ge-first-context", ".ge-second-value", ".ge-second-context"] },
};

const numericSlots = { "count-settle": ["value"], "count-ring-pair": ["first", "second"] };

function input(type, overrides = {}) {
  const words = [];
  const pick = { type: batch[type].variantOf || type, design: type };
  const range = (value) => {
    const from = words.length;
    for (const text of value.split(" ")) {
      const start = (3000 + words.length * 370) / 1000;
      words.push({ text, start, end: (3270 + words.length * 370) / 1000 });
    }
    return { from, to: words.length - 1 };
  };
  for (const [name, value] of Object.entries({ ...fixtures[type].values, ...overrides })) {
    pick[name] = Array.isArray(value) ? value.map(range) : range(value);
  }
  return { words, pick };
}

function ground(type, overrides) {
  const { words, pick } = input(type, overrides);
  return groundCard(pick, type, words);
}

function render(type, overlay) {
  assert.ok(overlay, type);
  const o = { ...overlay, id: "lane-g", place: { x: 180, y: 288, scale: 1 } };
  const calls = [];
  // Evaluate the same seekable timeline the compositor injects while capturing the GSAP arguments.
  const tl = {
    fromTo: (...args) => calls.push(args),
    to: () => {},
  };
  new Function("tl", proTimeline([o]))(tl);
  return { ...renderProOverlay(o), calls };
}

function replaceFirst(values, name, text) {
  const value = values[name];
  return Array.isArray(value) ? [text, ...value.slice(1)] : text;
}

const ids = (recipe, names) => names.trim().split(/\s+/).map((name) => `${recipe}/${name}`);
const ideas = (recipe, count) => Array.from({ length: count }, (_, i) => `${recipe}/idea-${i + 1}`);
const expectedIds = [
  ...ids("product-page", `
    signature-measured-push signature-zoom-for-title signature-hairline-line-art signature-music-dropout
    signature-rise-stack-pages emphasis-veil-before-title emphasis-three-voice-pivot scene-cover-rise-push-detail
    scene-ios-permission-alert scene-ios-settings-toggles-off prop-bell-icon-slash prop-art-exploded-phone prop-art-bed-moon
    prop-art-sneaker prop-art-mugs-teapot prop-art-staircase-bead prop-art-book scene-scan-page-highlight-push
    scene-split-loupe-strip prop-art-crowd-dots-one-alone scene-split-chat-typing-send prop-art-doorframe-height-marks
    scene-split-voice-message-plays scene-profile-grid-push-real-tile scene-corpus-window-translate-lines
    scene-ig-share-sheet-send-bubble scene-appstore-chip-home-reps-ring scene-methods-list-strike
    scene-real-alarm-shakes-until-squats prop-dots-200-half-lit scene-own-recording-phone-counts-to-dismissed prop-appstore-row-card`),
  ...ideas("product-page", 14),
  ...ids("step-deck", `
    emphasis-flicker-on emphasis-punch-in emphasis-blue-box-under-word scene-title-caps-rgb-split frame-paper-panel-replay
    scene-clip-panel-then-full scene-five-tables-rack-focus scene-tables-return scene-counter-1-to-10 scene-quote-box-word-reveal
    scene-dot-crowd-rack frame-still-ink-captions-window scene-hook-bar-callback scene-path-drawing-empty-spots`),
  ...ideas("step-deck", 16),
];

test("all 76 requested source ids have one decision and every built card has exact provenance", () => {
  const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/ge-triage-g.json", import.meta.url), "utf8"));
  const license = fs.readFileSync(new URL("../src/pro-cards/GHOST-EDITOR-LICENSE.md", import.meta.url), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 kurbaitaev/);
  assert.equal(new Set(expectedIds).size, 76);
  assert.deepEqual(triage.map(({ id }) => id), expectedIds);
  assert.ok(triage.filter(({ outcome }) => outcome === "new").length <= 8);
  for (const { id, outcome, type, reason } of triage) {
    assert.ok(reason?.trim() && !reason.includes("\n"), id);
    switch (outcome) {
      case "unfit":
        assert.equal(type, undefined, id);
        break;
      case "duplicate":
        assert.ok(CARDS[type] && !batch[type], id);
        break;
      case "deferred":
        assert.ok(type && !CARDS[type], id);
        break;
      // Cut at merge: the card was built, then deliberately dropped, so it must not survive in the registry.
      case "cut":
        assert.ok(type && !CARDS[type], id);
        assert.match(reason, /^cut at merge:/, id);
        break;
      case "new":
      case "variant":
      case "merged":
        assert.ok(batch[type]?.source.split(",").includes(`ghost-editor:${id}`), id);
        if (outcome !== "merged") assert.equal(Boolean(batch[type].variantOf), outcome === "variant", id);
        break;
      default:
        assert.fail(`${id}: ${outcome}`);
    }
  }
  for (const [type, def] of Object.entries(batch)) {
    const entries = triage.filter((entry) => entry.type === type);
    assert.equal(entries.filter(({ outcome }) => outcome === "new" || outcome === "variant").length, 1, type);
    assert.deepEqual(def.source.split(",").sort(), entries.map(({ id }) => `ghost-editor:${id}`).sort(), type);
  }
});

test("every card registers, grounds exact transcript ranges and fits the placement rectangle", () => {
  const zone = zoneFor();
  assert.deepEqual(Object.keys(batch).sort(), Object.keys(fixtures).sort());
  for (const [type, def] of Object.entries(batch)) {
    assert.equal(CARDS[type], def);
    const { words, pick } = input(type);
    const grounded = groundCard(pick, type, words);
    assert.ok(grounded, type);
    assert.ok(CARD_GROUPS[pick.type].includes(type), type);
    assert.deepEqual(groundProOverlay(pick, words), def.variantOf ? { ...grounded, group: def.variantOf } : grounded);
    const size = proSize(grounded);
    assert.ok(!def.fullscreen && PRO_RECTS.some((r) => r.w >= size.w && r.h >= size.h), type);
    for (const y of [288, 928]) {
      const x = 180;
      assert.ok(x >= zone.left && y >= zone.top && y + size.h <= zone.bottom, type);
      assert.ok(x + size.w <= rightLimit(zone, y, y + size.h), type);
    }
    assert.ok(tagsOf(type).length >= 1 && tagsOf(type).length <= 3 && tagsOf(type).every((tag) => TAG_WORDS.includes(tag)), type);
    assert.ok(def.hint && !def.hint.includes("\n"), type);
    if (def.variantOf) assert.equal(def.hint, CARDS[def.variantOf].hint, type);
    assert.deepEqual(grounded.reveals, grounded.phrases.map((item) => words[item.from].start), type);
    for (const [name, items] of Object.entries(grounded.slots)) {
      const slot = def.slots[name];
      assert.deepEqual(items.map(({ text }) => text), [fixtures[type].values[name]].flat(), `${type}.${name}`);
      for (const item of items) {
        assert.equal(item.fontSize, undefined, `${type}.${name} renders at design size`);
        assert.ok(item.lines.every((line) => proTextWidth(line, slot.size) <= slot.width), type);
      }
      assert.ok(slot.size >= (numericSlots[type]?.includes(name) ? 96 : 40), `${type}.${name}`);
    }
  }
});

test("spoken fields reject invented, reversed, oversized and width-breaking ranges", () => {
  for (const [type, def] of Object.entries(batch)) {
    const { words, pick } = input(type);
    const { values } = fixtures[type];
    for (const [name, slot] of Object.entries(def.slots)) {
      for (const invalid of ["Invented phrase", { text: "Invented phrase" }, { from: -1 }, { from: 2, to: 1 }, { from: words.length }]) {
        const raw = slot.repeat ? [invalid, ...pick[name].slice(1)] : invalid;
        assert.equal(groundCard({ ...pick, [name]: raw }, type, words), null, `${type}.${name} rejects invalid ranges`);
      }
      const oversized = replaceFirst(values, name, "x".repeat(slot.maxChars + 1));
      assert.equal(ground(type, { [name]: oversized }), null, `${type}.${name} rejects too many characters`);
      if (proTextWidth("W".repeat(slot.maxChars), slot.size) > slot.width) {
        const wide = replaceFirst(values, name, "W".repeat(slot.maxChars));
        assert.equal(ground(type, { [name]: wide }), null, `${type}.${name} rejects a word too wide at size`);
      }
    }
  }
});

test("every text field fits a twelve-letter word and escapes transcript markup", () => {
  const word = "Reservations";
  assert.equal(word.length, 12);
  for (const [type, { values }] of Object.entries(fixtures)) {
    for (const name of Object.keys(values)) {
      if (numericSlots[type]?.includes(name)) continue;
      const long = ground(type, { [name]: replaceFirst(values, name, word) });
      assert.ok(long, `${type}.${name} fits a twelve-letter word`);
      assert.deepEqual(long.slots[name][0].lines, [word]);
      assert.equal(long.slots[name][0].fontSize, undefined);
      const marked = ground(type, { [name]: replaceFirst(values, name, "<x>&") });
      const { html } = render(type, marked);
      assert.match(html, /&lt;x&gt;&amp;/);
      assert.doesNotMatch(html, /<x>/);
    }
  }
});

test("each spoken item has a house write-in at its own reveal and no hidden media dependency", () => {
  for (const type of Object.keys(batch)) {
    const o = ground(type);
    const { html, timeline, calls } = render(type, o);
    const { selectors } = fixtures[type];
    assert.equal(selectors.length, o.phrases.length, type);
    for (const [i, selector] of selectors.entries()) {
      const [target, from, to, time] = calls.find(([target]) => target === `#lane-g ${selector}`) || [];
      assert.ok(target, `${type} writes ${selector}`);
      assert.equal(time, o.reveals[i], type);
      assert.equal(from.opacity, 0, type);
      assert.match(from.clipPath, /^inset\(/, type);
      assert.equal(to.opacity, 1, type);
      assert.equal(to.duration, PRO_MOTION.enter, type);
      assert.equal(to.immediateRender, false, type);
    }
    assert.ok(calls.every(([, , to]) => [PRO_MOTION.enter, PRO_MOTION.state].includes(to.duration)), type);
    assert.equal(render(type, o).timeline, timeline, type);
    assert.doesNotMatch(timeline, /Math\.random|\bDate\b|onUpdate|onComplete|repeat:/);
    assert.doesNotMatch(html, /<(?:img|video|audio|image|iframe)\b|\bsrc=|<use\b/i);
  }
});

test("every card's styles are scoped and limited to the house palette and fonts", () => {
  const palette = new Set(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"]);
  for (const [type, { css }] of Object.entries(batch)) {
    assert.ok(proCSS({ types: new Set([type]) }).includes(css));
    for (const selector of css.matchAll(/(?:^|\})([^{}]+)\{/g)) {
      for (const scope of selector[1].trim().split(",")) {
        assert.ok(scope.trim().startsWith(`.pro-${type}`), `${type} scopes ${scope}`);
      }
    }
    const { html, timeline } = render(type, ground(type));
    const colors = `${css}\n${html}\n${timeline}`.match(/#[\da-f]{3,8}\b/gi) || [];
    assert.ok(colors.length > 0 && colors.every((color) => palette.has(color)), type);
    const fonts = [...css.matchAll(/font[^:;]*:[^;]*?"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(fonts.length && fonts.every((name) => name === "Inter" || name === "Anton"), type);
    assert.doesNotMatch(css, /gradient\(|filter:|text-shadow:|box-shadow:|url\(/, type);
  }
});

test("the card states land on the spoken verdict, target, completion, or message boundary", () => {
  const stateTime = (type, selector) => render(type, ground(type)).calls.find(([s]) => s === `#lane-g ${selector}`);
  for (const [type, selector, cue] of [
    // method-elimination and finish-one-first were cut at merge (see ge-triage-g.json).
    ["audience-focus", ".ge-target", "focus"],
    ["voice-playback", ".ge-pause", "transcript"],
    ["draft-send", ".ge-sent", "message"],
  ]) {
    const args = stateTime(type, selector);
    assert.ok(args, type);
    const [item] = ground(type).slots[cue];
    assert.equal(args[3], type === "draft-send" ? item.end : item.at, type);
    assert.equal(args[2].duration, PRO_MOTION.state, type);
  }
});

test("count designs validate a single whole count and show the literal spoken form only", () => {
  for (const [type, slots] of Object.entries(numericSlots)) {
    for (const name of slots) {
      for (const value of ["forty percent", "two or three", "12.5", "-1", "ten per week", "Reservations"]) {
        assert.equal(ground(type, { [name]: value }), null, `${type}.${name} rejects ${value}`);
      }
      const spoken = "twenty-three";
      const r = render(type, ground(type, { [name]: spoken }));
      assert.match(r.html, />twenty-three</);
      assert.doesNotMatch(r.html, />\s*23\s*</);
    }
  }
});

// cohort-outcome-share (the cohort/share geometry) was cut at merge (see ge-triage-g.json), taking its test with it.

test("vendored GSAP reproduces the card states on forward, reverse and shuffled seeks", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap;
  const timeline = gsap.timeline({ paused: true });
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });

  const targets = new Map();
  const overlays = ["height-marks", "draft-send", "audience-focus"].map((type) =>
    ({ ...ground(type), id: type, place: { x: 180, y: 288, scale: 1 } }));
  const target = (selector) => {
    if (!targets.has(selector)) targets.set(selector, {});
    return targets.get(selector);
  };
  const tl = {
    fromTo(selector, from, ...args) {
      const element = target(selector);
      for (const [prop, value] of Object.entries(from)) if (!(prop in element)) element[prop] = value;
      timeline.fromTo(element, from, ...args);
    },
    to(selector, ...args) { timeline.to(target(selector), ...args); },
  };
  new Function("tl", proTimeline(overlays))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30);
    return [...targets.values()].map(({ _gsap, ...state }) => state);
  };
  const frames = Array.from({ length: 499 }, (_, i) => i);
  const forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse frame ${frame}`);
  for (const i of frames) {
    const frame = i * 137 % frames.length;
    assert.deepEqual(snapshot(frame), forward[frame], `shuffled frame ${frame}`);
  }
});
