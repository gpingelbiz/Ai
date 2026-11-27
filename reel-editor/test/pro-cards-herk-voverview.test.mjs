import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as BATCH } from "../src/pro-cards/herk-voverview.mjs";
import { CARDS, CARD_GROUPS, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, PRO_MOTION, proSize, proTextLines } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { zoneFor, rightLimit } from "../src/safe-zone.mjs";

const note = { title: "Ask before you pitch", detail: "Find out what changed" };
const outline = { one: "Open", oneDetail: "Ask about their goals", two: "Listen", twoDetail: "Reflect what you heard", three: "Agree", threeDetail: "Confirm the next step" };
const milestones = { time1: "Week one", topic1: "Start outreach", time2: "Week two", topic2: "Book calls", time3: "Next month", topic3: "Review results" };
const fixtures = {
  "stacked-title": { lines: ["Plan the call", "then ask", "then listen", "before pitching"] },
  "chapter-screen": { headline: "Opening the sales call" },
  "tabbed-note": note,
  "headline-strap": note,
  "chapter-number": { number: "third", headline: "Check their goals" },
  "bracket-slate": { headline: "Better questions for the first call" },
  "location-pin": { place: "Austin", event: "We tested the opener with a team" },
  "phrase-sweep": { before: "You need to", focus: "ask permission", after: "before you pitch" },
  "agenda-bands": { topics: ["Lead quality", "Fast follow-up", "Better questions", "Clear next steps"] },
  "three-part-method": outline,
  "phase-bands": outline,
  "quadrant-notes": { ...outline, four: "Follow up", fourDetail: "Send a summary" },
  "six-topic-grid": { items: ["Prep the call", "Warm opener", "Listen closely", "Check their goal", "Share ideas", "Book next steps"] },
  "deck-draw": { topics: ["Find their goals", "Listen for friction", "Reflect what changed", "Agree on a next step"] },
  "milestone-timeline": milestones,
  "route-trace": milestones,
  "timed-agenda": { one: "Discovery", oneTime: "ten minutes", two: "Questions", twoTime: "2:30", three: "Practice", threeTime: "five minutes" },
  "comparison-columns": { left: "Cold calls", leftPoints: ["Fast feedback", "More rejection", "Train live"], right: "Warm calls", rightPoints: ["Known context", "More trust", "Ask early"] },
  "yes-no-matrix": { left: "Call", right: "Email", one: "Fast feedback", oneLeft: "Yes", oneRight: "No", two: "Written record", twoLeft: "No", twoRight: "Yes", three: "Follow-up", threeLeft: "Yes", threeRight: "Yes" },
};

function fixture(type, values = fixtures[type], spacing = 0.25) {
  const words = [];
  const range = (text) => {
    const from = words.length;
    for (const token of text.split(/\s+/)) {
      const start = 4 + words.length * spacing;
      words.push({ text: token, start, end: start + 0.8 * spacing });
    }
    return { from, to: words.length - 1 };
  };
  const pick = { type };
  for (const [name, slot] of Object.entries(BATCH[type].slots)) {
    if (values[name] == null) continue;
    pick[name] = slot.kind === "label" ? values[name] : slot.repeat ? values[name].map(range) : range(values[name]);
  }
  return { pick, words, overlay: groundCard(pick, type, words) };
}

function render(type, values) {
  const { words, overlay } = fixture(type, values);
  assert.ok(overlay, `${type} grounds`);
  const size = proSize(overlay);
  const placed = { ...overlay, id: "pro-vox", place: { x: 180, y: 700, ...size } };
  const { html } = renderProOverlay(placed);
  const calls = [];
  const timeline = proTimeline([placed]);
  const tl = Object.fromEntries(["fromTo", "to"].map((method) => [method, (...args) => calls.push({ method, args })]));
  new Function("tl", timeline)(tl);
  return { words, overlay, html, calls, timeline, size };
}

const plain = (html) => html.replaceAll("<br>", " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const textWrites = (calls) => calls.filter(({ method, args }) => method === "fromTo" && args[1].opacity === 0 &&
  ["inset(0 100% 0 0)", "inset(100% 0 0 0)"].includes(args[1].clipPath));

test("every Vox overview and section card has one triage entry and every built card records its sources", () => {
  const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/herk-triage-voverview.json", import.meta.url), "utf8"));
  const expected = {
    section: "circle markerbox cutout stacked correction classified crt collage fullbleed split stamp ticker indexcard tornstrip numeral bracket map highlight",
    overview: "timeline-3up numbered-list checklist toc agenda-bars big-type quad grid6 card-deck filmstrip index-cards vertical-timeline roadmap stepper phases board compare matrix map-legend outline dossier",
  };
  const ids = Object.entries(expected).flatMap(([group, names]) => names.split(" ").map((name) => `vox-explainer.t1.${group}.${name}`));
  assert.deepEqual(triage.map(({ id }) => id), ids);
  for (const { id, outcome, type, reason } of triage) {
    assert.ok(["new", "variant", "merged", "duplicate", "unfit"].includes(outcome), id);
    assert.ok(reason && !reason.includes("\n"), id);
    if (outcome === "unfit") assert.equal(type, undefined, id);
    else assert.ok(CARDS[type], id);
    if (outcome === "new") assert.ok(BATCH[type] && !BATCH[type].variantOf, id);
    if (outcome === "variant") assert.ok(BATCH[type]?.variantOf, id);
    if (outcome === "duplicate") assert.ok(!BATCH[type], id);
  }
  for (const [type, card] of Object.entries(BATCH)) {
    const related = triage.filter((row) => row.type === type);
    assert.equal(related.filter(({ outcome }) => outcome !== "merged").length, 1, type);
    assert.match(card.source, /^herk:/, type);
    assert.deepEqual(card.source.slice(5).split(",").sort(), related.map(({ id }) => id).sort(), type);
  }
});

test("cards register, fit the shared on-footage safe zone, and write exact spoken copy at every reveal", () => {
  assert.deepEqual(Object.keys(BATCH).sort(), Object.keys(fixtures).sort());
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(CARDS[type], def, type);
    assert.ok(def.tags.length >= 1 && def.tags.length <= 3 && def.tags.every((tag) => TAG_WORDS.includes(tag)), type);
    const { html, overlay, words, size, calls, timeline } = render(type);
    assert.equal(overlay.fullscreen, undefined, type);
    const zone = zoneFor();
    assert.ok(size.w > 0 && size.w <= 720 && size.h > 0 && size.h <= 560, type);
    assert.ok(180 >= zone.left && 700 >= zone.top && 700 + size.h <= zone.bottom, type);
    assert.ok(180 + size.w <= rightLimit(zone, 700, 700 + size.h), type);
    assert.deepEqual(overlay.reveals, overlay.phrases.map(({ from }) => words[from].start), type);
    for (const phrase of overlay.phrases) {
      assert.equal(phrase.text, words.slice(phrase.from, phrase.to + 1).map(({ text }) => text).join(" "), type);
      assert.ok(plain(html).includes(phrase.text), `${type}: ${phrase.text}`);
      assert.equal(phrase.fontSize, undefined, type);
    }

    const writes = textWrites(calls).filter(({ args }) => args[2].opacity === 1);
    assert.deepEqual(writes.map(({ args }) => args[3]), overlay.reveals, type);
    for (const { args } of writes) assert.equal(args[2].duration, PRO_MOTION.enter, type);
    for (const { args } of calls.filter(({ args }) => args[0].startsWith("#pro-vox "))) {
      const [, from, to, at] = args;
      assert.ok(overlay.reveals.includes(at), type);
      assert.ok([PRO_MOTION.enter, PRO_MOTION.state].includes(to.duration), type);
      assert.equal(to.immediateRender, false, type);
      assert.equal(typeof to.ease, "function", type);
      assert.ok([from.x, from.y, to.x, to.y].every((distance = 0) => Math.abs(distance) <= 16), type);
      assert.ok(!("rotation" in from || "rotation" in to), type);
      const classes = args[0].match(/\.[\w-]+/g) || [];
      for (const cls of classes) assert.match(html, new RegExp(`class="[^"]*\\b${cls.slice(1)}\\b`), type);
    }
    assert.equal(calls.filter(({ method }) => method === "to").length, 1, type);
    assert.deepEqual(calls.at(-1).args.slice(0, 1), ["#pro-vox"], type);
    assert.equal(calls.at(-1).args[1].duration, PRO_MOTION.exit, type);
    assert.doesNotMatch(timeline, /undefined|NaN|repeat:|yoyo:|Math\.random|new Date/, type);
    assert.equal(render(type).timeline, timeline, type);
  }
});

test("variant designs can be selected through their root and reject copy outside their own limits", () => {
  for (const [type, def] of Object.entries(BATCH)) {
    if (!def.variantOf) continue;
    const { pick, words } = fixture(type);
    assert.ok(CARDS[def.variantOf] && !CARDS[def.variantOf].variantOf, `${type} is a design of a root type`);
    assert.ok(CARD_GROUPS[def.variantOf].includes(type), type);
    const overlay = groundProOverlay({ ...pick, type: def.variantOf, design: type }, words);
    assert.equal(overlay.type, type);
    assert.equal(overlay.group, def.variantOf);
  }
  const { pick, words } = fixture("bracket-slate", { headline: "MMMMMMMMMMMM" });
  const fallback = groundProOverlay({ ...pick, type: "chapter-screen", design: "bracket-slate" }, words);
  assert.equal(fallback.type, "chapter-screen");
});

test("every card rejects invented ranges and oversized copy, and escapes spoken markup", () => {
  for (const [type, def] of Object.entries(BATCH)) {
    const { pick, words } = fixture(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      if (slot.kind === "label") {
        assert.equal(groundCard({ ...pick, [name]: "Week 2" }, type, words), null, type);
        assert.equal(groundCard({ ...pick, [name]: "One two a b c" }, type, words), null, type);
        continue;
      }
      const prop = `${type}.${name}`;
      if (!slot.optional) assert.equal(groundCard({ ...pick, [name]: undefined }, type, words), null, prop);
      assert.equal(groundCard({ ...pick, [name]: slot.repeat ? ["Invented copy"] : "Invented copy" }, type, words), null, prop);
      const range = slot.repeat ? pick[name][0] : pick[name];
      const oversized = words.map((word, i) => i === range.from ? { ...word, text: "W".repeat(slot.maxChars + 1) } : word);
      assert.equal(groundCard(pick, type, oversized), null, prop);
      if (slot.repeat) {
        assert.equal(groundCard({ ...pick, [name]: pick[name].slice(0, slot.repeat[0] - 1) }, type, words), null, prop);
        assert.equal(groundCard({ ...pick, [name]: Array(slot.repeat[1] + 1).fill(range) }, type, words), null, prop);
        assert.equal(groundCard({ ...pick, [name]: [...pick[name]].reverse() }, type, words), null, prop);
        for (let n = slot.repeat[0]; n <= slot.repeat[1]; n++) {
          const { size } = render(type, { ...fixtures[type], [name]: fixtures[type][name].slice(0, n) });
          assert.ok(size.w <= 720 && size.h <= 560, prop);
        }
      }
    }
    const [name, slot] = Object.entries(def.slots).find(([name, slot]) => slot.kind === "spoken" && name !== "number" && !name.endsWith("Time") && !/^time\d$/.test(name));
    const escaped = "<A&B>'";
    const values = { ...fixtures[type], [name]: slot.repeat ? [escaped, ...fixtures[type][name].slice(1)] : escaped };
    const { html } = render(type, values);
    assert.match(html, /&lt;A&amp;B&gt;&#39;/, type);
    assert.doesNotMatch(html, /<A&B>/, type);
  }
});

test("chapter counts, timestamps and comparison marks require their own exact spoken values", () => {
  for (const number of ["third", "7", "8th"]) {
    const { html } = render("chapter-number", { ...fixtures["chapter-number"], number });
    assert.match(html, new RegExp(`vo-number">${number}<`));
  }
  for (const number of ["more", "two or three", "three calls", "11st", "2026", "0.5"]) {
    assert.equal(fixture("chapter-number", { ...fixtures["chapter-number"], number }).overlay, null, number);
  }
  for (const oneTime of ["twenty five minutes", "half an hour", "1:02:30"]) {
    assert.ok(fixture("timed-agenda", { ...fixtures["timed-agenda"], oneTime }).overlay, oneTime);
  }
  for (const oneTime of ["soon", "1:67", "1:99:00", "suggestions", "the next day"]) {
    assert.equal(fixture("timed-agenda", { ...fixtures["timed-agenda"], oneTime }).overlay, null, oneTime);
  }
  for (const type of ["milestone-timeline", "route-trace"]) {
    for (const oneTime of ["January first", "year 2026", "week later", "call day"]) {
      assert.equal(fixture(type, { ...milestones, time1: oneTime }).overlay, null, oneTime);
    }
  }
  for (const oneLeft of ["maybe", "true", "1"]) {
    assert.equal(fixture("yes-no-matrix", { ...fixtures["yes-no-matrix"], oneLeft }).overlay, null, oneLeft);
  }
  const { html } = render("yes-no-matrix");
  assert.equal((html.match(/m4 12 5 5L20 6/g) || []).length, 4);
  assert.equal((html.match(/m6 6 12 12M18 6 6 18/g) || []).length, 2);
});

test("oversized words cannot trigger the smaller fallback and optional copy works with or without it", () => {
  const spec = BATCH["bracket-slate"].slots.headline;
  const text = "MMMMMMMMMMMM";
  assert.equal(proTextLines(text, spec), null);
  assert.ok(proTextLines(text, { ...spec, size: 42 }));
  assert.equal(fixture("bracket-slate", { headline: text }).overlay, null);
  const type = "phrase-sweep";
  const full = render(type);
  const partial = render(type, { ...fixtures[type], after: undefined });
  assert.equal(partial.overlay.slots.after.length, 0);
  assert.ok(partial.size.h < full.size.h);
  assert.equal(textWrites(partial.calls).filter(({ args }) => args[2].opacity === 1).length, partial.overlay.phrases.length);
});

test("card CSS stays scoped and uses only the pro palette, fonts, and type floors", () => {
  const palette = ["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"];
  for (const [type, def] of Object.entries(BATCH)) {
    const { html, timeline } = render(type);
    const css = proCSS({ types: new Set([type]) });
    assert.ok(css.includes(def.css), type);
    for (const other of Object.keys(BATCH).filter((other) => other !== type)) {
      assert.ok(!css.includes(BATCH[other].css), `${type} does not include ${other}`);
    }
    assert.doesNotMatch(`${def.css}\n${html}`, /gradient|blur\(|<img\b|emoji|@import|https?:/i, type);
    for (const color of `${def.css}\n${timeline}`.match(/#[0-9a-f]{6}\b/gi) || []) assert.ok(palette.includes(color), `${type}: ${color}`);
    for (const font of def.css.matchAll(/"([\w ]+)"\s*,\s*sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font[1]), `${type}: ${font[1]}`);
    for (const rule of def.css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of rule[1].trim().split(",")) assert.match(selector.trim(), new RegExp(`^\\.pro-${type}(?=[.:\\s]|$)`), type);
    }
    for (const [name, slot] of Object.entries(def.slots)) {
      const minSize = slot.kind === "label" ? 28 : name === "number" ? 96 : 40;
      assert.ok(slot.size >= minSize, `${type}.${name}`);
    }
  }
});

test("vendored GSAP produces the same card states when seeking forward, backward, or out of order", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap;
  const timeline = gsap.timeline({ paused: true });
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const elements = new Map();
  const overlays = [0.25, 0.1].flatMap((spacing, pass) => Object.keys(BATCH).map((type, index) => ({
    ...fixture(type, fixtures[type], spacing).overlay, id: `vox-${pass}-${index}`, place: { x: 180, y: 700 },
  })));
  const tl = Object.fromEntries(["fromTo", "to"].map((method) => [method, (selector, ...args) => {
    if (!elements.has(selector)) elements.set(selector, {});
    const element = elements.get(selector);
    if (method === "fromTo") {
      for (const [property, value] of Object.entries(args[0])) {
        if (!(property in element)) element[property] = value;
      }
    }
    timeline[method](element, ...args);
  }]));
  new Function("tl", proTimeline(overlays))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return Object.fromEntries([...elements].map(([selector, { _gsap, ...properties }]) => [selector, properties]));
  };
  const frames = Array.from({ length: 499 }, (_, i) => i);
  const forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse frame ${frame}`);
  for (const i of frames) {
    const frame = i * 137 % frames.length;
    assert.deepEqual(snapshot(frame), forward[frame], `shuffled frame ${frame}`);
  }
});
