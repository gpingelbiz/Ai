import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CARDS as cleanOS } from "../src/pro-cards/ge-b.mjs";
import { CARDS, rootOf, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proSize, proTextLines, PRO_MOTION } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const moving = { fallingMetric: "Cancelled calls", decrease: "down 20%", risingMetric: "Booked calls", increase: "up 40%" };

const examples = {
  "counter-moving-results": moving,
  "marked-quote-page": { quote: "Let the silence do the work", explanation: "Give them time to answer" },
  "receipt-share-strip": { heading: "Lost revenue", items: ["Rework $20", "Late follow-up $80"], total: "$100" },
  "opposing-levels": moving,
  "rate-change-ring": { before: "40%", after: "18%", label: "Missed follow-ups" },
  "progress-status-rail": { heading: "Discovery practice", states: ["Read the script", "Rehearse with a coach", "Run live discovery"] },
  "first-place-rows": { heading: "What matters most", items: ["First, listen", "Second, clarify", "Third, ask again"] },
  "formula-chip-stack": { parts: ["Discovery", "A clear offer", "Follow-up"], result: "A repeatable sales process" },
  "clock-ring-capsule": { time: "15 minutes" },
  "streak-medallions": { count: "seven", label: "Booked calls in a row" },
  "selected-term-popover": { term: "Permission close", detail: "Ask if they want to continue" },
};

const copyNames = {
  states: "status",
  parts: "part",
  items: { "receipt-share-strip": "cost", "first-place-rows": "rank" },
  label: { "rate-change-ring": "metric", "streak-medallions": "context" },
};
const numberFields = {
  "counter-moving-results": ["decrease", "increase"],
  "receipt-share-strip": ["items", "total"],
  "opposing-levels": ["decrease", "increase"],
  "rate-change-ring": ["before", "after"],
  "clock-ring-capsule": ["time"],
  "streak-medallions": ["count"],
};

function input(type, overrides = {}) {
  const words = [], pick = { type }, values = { ...examples[type], ...overrides }, spoken = [];
  for (const [name, slot] of Object.entries(cleanOS[type].slots)) {
    const value = values[name];
    if (value == null) continue;
    if (slot.kind === "label") {
      pick[name] = value;
      continue;
    }
    const base = copyNames[name]?.[type] ?? copyNames[name] ?? name;
    const ranges = (slot.repeat ? value : [value]).map((phrase, i) => {
      const from = words.length;
      for (const text of phrase.split(/\s+/)) {
        const start = 4 + 0.375 * words.length;
        words.push({ text, start, end: start + 0.28 });
      }
      const to = words.length - 1;
      spoken.push({ from, to, text: phrase, at: words[from].start, selector: `.gb-${base}${slot.repeat ? `-${i}` : ""}` });
      return { from, to };
    });
    pick[name] = slot.repeat ? ranges : ranges[0];
  }
  return { words, pick, spoken };
}

function ground(type, overrides) {
  const { words, pick } = input(type, overrides);
  return groundCard(pick, type, words);
}

function render(type, overrides) {
  const o = ground(type, overrides);
  assert.ok(o, type);
  o.id = `ge-b-${type}`;
  o.place = { x: 150, y: 180, scale: 1 };
  const calls = [];
  const fakeTimeline = {
    fromTo(...args) { calls.push(args); },
    to() {},
  };
  new Function("tl", proTimeline([o]))(fakeTimeline);
  return { o, calls, ...renderProOverlay(o) };
}

const motion = ({ calls, o }, selector) => calls.filter(([target]) => target === `#${o.id} ${selector}`);
const withCopy = (type, name, value, index = 0) => {
  const fixture = examples[type][name];
  return Array.isArray(fixture) ? { [name]: fixture.with(index, value) } : { [name]: value };
};

test("all 68 assigned Clean OS elements have one decision and every kept or merged source is credited", () => {
  const rows = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/ge-triage-b.json", import.meta.url), "utf8"));
  const ids = `
    quote-page-card today-vs-then-segment segmented-control-flip earned-zero-counter receipt-split-bar business-growth-chart
    reminders-checklist-ticks order-tracking-progress shop-place-card-open share-sheet-contacts notes-typing-empty-todo
    wisdom-ring-segment-flip incoming-call-too-close ios-toggle-flip app-icon-tap-open career-path-line viral-post-counters
    ranked-list-first-fills task-switcher-cards ai-badge-tiles role-combo-chips job-search-results cost-down-bars-up
    profile-roles-multiplier auto-reply-toggle-on focus-mode-on health-bars-fatigue-sleep health-stress-ecg workout-tiles-pick
    live-activity-workout-timer maps-crowd-people-nearby new-contact-chip notes-swipe-delete reminders-empty
    contact-no-shared-history maps-route-past-now photos-places-album win-streak-medals ig-message-requests safari-real-page-loads
    rich-link-preview community-sheet-rows join-button-tapped podcast-now-playing-card lookup-popover-definition
    control-center-two-sliders calendar-week-blocks-renamed handwriting-to-type-struck pinch-zoom-too-close mail-draft-recipients-to-self
    wifi-network-vanishes notification-stacks-swipe-mute home-apps-become-life-widgets today-view-free-hours-widget
    spotlight-question-no-results beach-photo-thought-wheel bluetooth-work-disconnect study-38k-two-bars battery-background-app
    photos-card-sport-flip slide-over-book-card day-view-phone-blocks-give-way idea-1 idea-2 idea-3 idea-4 idea-5 idea-6
  `.trim().split(/\s+/);
  assert.deepEqual(rows.map(({ id }) => id), ids.map((id) => `clean-os/${id}`));
  const counts = { new: 0, variant: 0, merged: 0, duplicate: 0, deferred: 0, unfit: 0, cut: 0 };
  for (const { id, outcome, type, reason } of rows) {
    assert.ok(Object.hasOwn(counts, outcome), id);
    assert.ok(reason?.length > 24 && !reason.includes("\n"), id);
    counts[outcome]++;
    if (outcome === "new") assert.ok(cleanOS[type] && !cleanOS[type].variantOf, id);
    if (outcome === "variant") assert.ok(cleanOS[type]?.variantOf, id);
    if (outcome === "merged") assert.ok(cleanOS[type], id);
    if (outcome === "duplicate") assert.ok(CARDS[type] && !cleanOS[type], id);
    if (outcome === "unfit") assert.equal(type, undefined, id);
    // Cut at merge: the card was built, then deliberately dropped, so it must not survive in the registry.
    if (outcome === "cut") { assert.ok(type && !CARDS[type], id); assert.match(reason, /^cut at merge:/, id); }
  }
  assert.deepEqual(counts, { new: 1, variant: 10, merged: 3, duplicate: 14, deferred: 0, unfit: 27, cut: 13 });
  for (const [type, def] of Object.entries(cleanOS)) {
    const expected = rows.filter((row) => row.type === type).map(({ id }) => `ghost-editor:${id}`);
    assert.deepEqual(def.source.split(",").sort(), expected.sort(), type);
  }
  assert.match(fs.readFileSync(new URL("../src/pro-cards/ge-b.mjs", import.meta.url), "utf8").split("\n")[0],
    /ghost-editor \(MIT, copyright 2026 kurbaitaev\).*GHOST-EDITOR-LICENSE\.md/);
});

test("all cards ground exact copy, render through pro and fit the shared safe zone", () => {
  assert.deepEqual(Object.keys(cleanOS).sort(), Object.keys(examples).sort());
  const frame = {
    W: 1080, H: 1920, measured: true,
    head: { x: 425, y: 830, w: 230, h: 272 },
    mic: { x: 150, y: 1100, w: 200, h: 120 },
    caption: { x: 180, y: 1140, w: 720, h: 120 },
  };
  const zone = zoneFor();
  for (const [type, def] of Object.entries(cleanOS)) {
    assert.equal(CARDS[type], def);
    assert.ok(def.tags.length >= 1 && def.tags.length <= 3 && def.tags.every((tag) => TAG_WORDS.includes(tag)), type);
    assert.ok(!def.fullscreen, type);
    const { words, pick, spoken } = input(type);
    const o = groundProOverlay({ ...pick, type: rootOf(type), design: type }, words);
    assert.equal(o?.type, type);
    assert.deepEqual(o.reveals, spoken.map(({ at }) => at), type);
    assert.deepEqual(o.phrases.map(({ from, to, text }) => ({ from, to, text })),
      spoken.map(({ from, to, text }) => ({ from, to, text })), type);
    const { w, h } = proSize(o);
    assert.ok(w > 0 && w <= 720 && h > 0 && h <= 560, type);
    const place = placeProOverlay(o, frame);
    assert.ok(place && place.x >= zone.left && place.y - 8 >= zone.top && place.y + place.h + 16 <= zone.bottom, type);
    assert.ok(place.x + place.w <= rightLimit(zone, place.y - 8, place.y + place.h + 16), type);
    assert.ok(place.y + place.h + 16 < frame.head.y - 56, type);
    const r = render(type);
    const repeated = render(type);
    assert.equal(r.html, repeated.html, type);
    assert.equal(r.timeline, repeated.timeline, type);
    for (const { selector, at, text } of spoken) {
      assert.ok(r.html.includes(selector.slice(1)), `${type}: ${text}`);
      const reveal = motion(r, selector).find(([, from, to, start]) => from.opacity === 0 && to.opacity === 1 && start === at);
      assert.equal(reveal?.[2].duration, PRO_MOTION.enter, `${type}: ${text}`);
      assert.equal(reveal?.[2].immediateRender, false, type);
    }
    assert.match(r.html, new RegExp(`pro-overlay pro-${type}\\b`));
    assert.ok(o.phrases.every((phrase) => phrase.fontSize === undefined), type);
  }
});

test("spoken fields reject invented, overlapping and oversized copy and allow a twelve-letter word where they take text", () => {
  const word = "Conversation";
  assert.equal(word.length, 12);
  for (const [type, def] of Object.entries(cleanOS)) {
    const { words, pick } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      const where = `${type}.${name}`;
      assert.ok(slot.size >= (slot.kind === "spoken" ? 40 : 28), where);
      if (slot.kind === "label") {
        for (const heading of ["Costs 2", "Hours ٤", "Four calls", "One task after the other", "👍"]) {
          assert.equal(ground(type, { [name]: heading }), null, where);
        }
        assert.ok(ground(type, { [name]: undefined }), where);
        continue;
      }
      const invalidRanges = ["Invented copy", { text: "Invented copy" }, { from: -1 }, { from: 0, to: words.length }];
      for (const invalid of invalidRanges) {
        const field = slot.repeat ? pick[name].with(0, invalid) : invalid;
        assert.equal(groundCard({ ...pick, [name]: field }, type, words), null, where);
      }
      assert.equal(ground(type, withCopy(type, name, "W".repeat(slot.maxChars + 1))), null, where);
      const widestInBudget = "W".repeat(slot.maxChars);
      if (!proTextLines(widestInBudget, slot)) assert.equal(ground(type, withCopy(type, name, widestInBudget)), null, where);
      if (numberFields[type]?.includes(name)) {
        assert.equal(ground(type, withCopy(type, name, word)), null, where);
        if (name !== "items") assert.equal(slot.size, 96, where);
        continue;
      }
      const n = slot.repeat ? pick[name].length : 1;
      for (let i = 0; i < n; i++) {
        const o = ground(type, withCopy(type, name, word, i));
        assert.deepEqual(o?.slots[name][i].lines, [word], where);
        assert.equal(o.slots[name][i].fontSize, undefined, where);
      }
    }
  }
});

test("all cards escape their rendered spoken markup and only ship their own scoped house CSS", () => {
  const palette = new Set(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"]);
  for (const [type, def] of Object.entries(cleanOS)) {
    if (type === "clock-ring-capsule") {
      assert.equal(ground(type, { time: "15 minutes<script>" }), null);
    } else {
      const name = Object.keys(def.slots).find((key) => def.slots[key].kind === "spoken" &&
        (!numberFields[type]?.includes(key) || key === "items"));
      const value = type === "receipt-share-strip" ? "<x> & $20" : "<x> & why?";
      const { html } = render(type, withCopy(type, name, value));
      assert.doesNotMatch(html, /<x>/);
      assert.match(html, /&lt;x&gt; &amp;/, type);
      assert.doesNotMatch(html, /<(?:img|video|audio)\b|url\(/i, type);
    }
    const selectors = [...def.css.matchAll(/(?:^|\})\s*([^{}]+)\{/g)];
    assert.ok(selectors.length > 1, type);
    for (const [, selector] of selectors) assert.match(selector, new RegExp(`^\\.pro-${type}(?:\\s|$)`), type);
    for (const color of def.css.match(/#[\da-f]{3,8}\b/gi) ?? []) assert.ok(palette.has(color), `${type}: ${color}`);
    for (const [, family] of def.css.matchAll(/"([^"]+)"/g)) assert.ok(["Anton", "Inter"].includes(family), type);
    assert.doesNotMatch(def.css, /url\(|filter:|rgba?\(|gradient|@keyframes|animation:|transition:|text-shadow|box-shadow|rotate\(/i, type);
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css), type);
  }
});

test("data graphics use exact earned numbers and stay deterministic at state changes", () => {
  for (const decrease of ["20%", "up 20%", "down 0%", "down 10 to 20%"]) {
    assert.equal(ground("counter-moving-results", { decrease }), null, decrease);
  }
  assert.ok(ground("counter-moving-results", { decrease: "down ten percent", increase: "up 125%" }));
  assert.equal(ground("opposing-levels", { increase: "up 125%" }), null);
  const sliders = render("opposing-levels");
  assert.deepEqual(motion(sliders, ".gb-drain")[0].slice(1).map((part) => part?.scaleY ?? part), [1, 0.8, sliders.o.slots.decrease[0].at]);
  assert.equal(motion(sliders, ".gb-fill")[0][2].scaleY, 0.4);

  const ring = render("rate-change-ring");
  const [, from, to, at] = motion(ring, ".gb-ring path")[1];
  assert.equal(from.strokeDashoffset, 0.6);
  assert.equal(to.strokeDashoffset, 0.82);
  assert.equal(to.duration, PRO_MOTION.state);
  assert.equal(at, ring.o.slots.after[0].at);
  assert.equal(ground("rate-change-ring", { after: "40%" }), null);
  assert.equal(ground("rate-change-ring", { after: "101%" }), null);
  const { pick, words } = input("rate-change-ring", { after: "25 percentage points" });
  assert.notEqual(groundProOverlay({ ...pick, type: "case-study", design: "rate-change-ring" }, words)?.type, "rate-change-ring");
  const fallback = input("rate-change-ring", { before: "90 days", after: "45 days", label: "Time to book" });
  assert.equal(groundProOverlay({ ...fallback.pick, type: "case-study", design: "rate-change-ring" }, fallback.words)?.type, "metric-faceoff");

  assert.equal(ground("receipt-share-strip", { total: "$400" }), null);
  assert.equal(ground("receipt-share-strip", { items: ["Rework $10 to $20", "Late follow-up $80"] }), null);
  const receipt = render("receipt-share-strip", { items: ["Rework $0.1", "Late follow-up $0.2"], total: "$0.30" });
  assert.match(receipt.html, /flex-basis:33\.333/);
  assert.match(receipt.html, /flex-basis:66\.666/);
  assert.equal(motion(receipt, ".gb-strip")[0][3], receipt.o.slots.total[0].at);

  assert.equal(ground("streak-medallions", { count: "eight" }), null);
  const earned = [0, 1, 7].map((count) => render("streak-medallions", { count: String(count) }).html.match(/gb-medal-\d/g)?.length || 0);
  assert.deepEqual(earned, [0, 1, 7]);
  assert.equal(ground("clock-ring-capsule", { time: "two to three" }), null);
  assert.ok(ground("clock-ring-capsule", { time: "two to three minutes" }));
});

test("maximum lists fit", () => {
  // priority-focus, priority-tiles, calendar-reallocation, queue-cleared, empty-search, discarded-draft and
  // ink-struck-note were cut at merge (see ge-triage-b.json); progress-status-rail is the surviving max-list card.
  const highest = render("progress-status-rail", { states: ["Learn the discovery script", "Practice asking your questions", "Review how you handle silence", "Run discovery without the script"] });
  assert.ok(proSize(highest.o).h <= 560);
});
