import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as batch } from "../src/pro-cards/ge-c.mjs";
import { CARDS, CARD_GROUPS, rootOf, tagsOf, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proSize, PRO_MOTION, PRO_RECTS } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/ge-triage-c.json", import.meta.url), "utf8"));
const assigned = `
polaroid paper-stack-swap navy-text-card rec-frame incoming-call-decline cursor-dialog chat-bubble-card
yellow-wash-photo notebook-todo cork-sticky-notes-fall boarding-pass-stamp thermal-receipt-print
envelopes-postmark business-card newspaper-clipping-circled tear-off-calendar translation-sheets-lak-russian
kraft-map-route-stamp typewriter-quote-cards-navy hire-ledger-total-zero-stamp merchant-notebook-deal-lines
kraft-map-routes-out checklist-four-ticks notice-pinned-postmarks polaroids-on-wood name-tag-beside-head
polaroid-beside-face polaroid-over-head polaroid-trio-per-word polaroid-live-video photo-ken-burns
navy-quote-card-word-land hand-drawn-path-diagram printed-post-headline-highlight lined-index-card-columns
lined-notebook-slip highlighted-details-strip navy-number-card-side aged-letter-quote-words term-index-card
sticky-note-slap book-cover-side torn-notification-slips day-timeline-strip zigzag-career-card numbered-list-scribbles
folder-tabs-drop kraft-hang-tag study-stat-card-counter kraft-city-map-pin paper-speech-bubble recurring-motif-prop
handwriting-wipe rubber-stamp-slam snap-punch-in marker-circle-draw highlighter-swipe marker-strike-through
hand-drawn-arrow ink-doodle-icon quote-word-by-word dashed-route-draw pop-in-accent marker-underline-swipe
number-count-up prop-shake sticky-battery-drain dictionary-clipping ticket-stub-study gauge-needle-red gauge-fullscreen
punch-card-list paper-light-switch breaker-panel-tape-labels open-at-clock-sign rx-pad-basics phone-jar-empties
telegram-tape-strips time-card-clock-punch chalk-slate-versus film-strip-four-frames
`.trim().split(/\s+/).map((id) => `result-podcast/${id}`);

const examples = {
  "buyer-motive": { motive: "Avoid another bad hire", behavior: "They ask for references" },
  "price-revision": { original: "$3k", revised: "two thousand dollars" },
  "habits-to-cut": { habits: ["Pitch before discovery", "Argue about price", "Overpromise results", "Skip the follow-up"] },
  "capacity-drain": { resource: "Focus", drains: ["Switch chats", "Check the inbox", "Restart the pitch", "Rewrite the notes"] },
  "coaching-findings": { test: "We tried a shorter opener", findings: ["Prospects asked more questions", "Calls felt calmer", "We booked sooner"] },
  "typed-pullquote": { quote: "The sooner you listen the less you have to pitch" },
  "spoken-title-landing": { lines: ["The real cost", "of skipping", "buyer discovery", "is lost trust"] },
  "ruled-checks": { items: ["Read the notes", "Ask what changed", "Repeat their goal", "Agree on a next step"] },
  "pinned-method-board": { items: ["Call prep", "Buyer intent", "Tradeoffs", "Next steps"] },
  "printed-tally": { items: ["$20 for the lead", "$30 for the demo", "$50 in follow-up"], total: "one hundred dollars" },
  "phrase-translation": { term: "Pipeline velocity", detail: "How fast deals move toward a close" },
  "drawn-milestones": { stages: ["New lead", "First reply", "Discovery booked", "Offer sent"] },
  "milestone-leaves": { items: ["Day one", "Week two", "Next month", "Next quarter"] },
  "topic-files": { topics: ["Better openers", "Buyer intent", "Price objections", "Follow-up"] },
  "punch-list": { items: ["Review notes", "Call back", "Log the outcome", "Set reminders"] },
  "habit-rocker": { left: "Rushing", leftDetail: "They get defensive", right: "Listening", rightDetail: "They open up",
    focus: "Take a pause", focusDetail: "It gives them room to think" },
  "alert-tearaway": { title1: "Missed call", message1: "Can you call back", title2: "New reply", message2: "We need more time",
    title3: "Confirmed", message3: "Let's talk tomorrow" },
  "clocked-results": { value: "one hundred", note: ["Qualified leads this month", "From outbound outreach"] },
  "slate-strike": { do: ["Ask what changed", "Let them answer"], avoid: ["Force the close", "Fill the silence"] },
  "stamped-quote": { quote: "Give people room to tell you what matters" },
  "detail-underlines": { items: ["Active listening", "Good follow-up", "Offer clarity", "Buyer intent"] },
};

const fixedLabels = {
  "buyer-motive": ["Buyer motive", "Buyer behavior"],
  "price-revision": ["Original price", "Revised price"],
  "habits-to-cut": ["Habits to cut"],
  "coaching-findings": ["What we tested"],
  "ruled-checks": ["Checklist"],
  "printed-tally": ["Cost tally", "Total"],
  "phrase-translation": ["The term", "In plain language"],
  "milestone-leaves": ["Milestones"],
  "punch-list": ["Put it into practice"],
  "alert-tearaway": ["Incoming alerts"],
  "slate-strike": ["Do this", "Avoid"],
  "stamped-quote": ["Pull quote"],
};

const numerical = {
  "price-revision": { original: "seventy-seven dollars", revised: "seventy-three dollars" },
  "printed-tally": { total: "seventy-seven dollars" },
  "clocked-results": { value: "seventy-seven" },
};

const viewport = { measured: true, W: 1080, H: 1920, head: { x: 400, y: 820, w: 200, h: 200 } };
const longWord = "Negotiations";

function input(type, overrides = {}) {
  const values = { ...examples[type], ...overrides };
  const words = [{ text: "Earlier", start: 2.9, end: 2.99 }], pick = { type, slots: {} };
  const range = (phrase) => {
    const from = words.length;
    for (const text of phrase.split(" ")) {
      const start = 3 + words.length / 10;
      words.push({ text, start, end: start + 0.08 });
    }
    return { from, to: words.length - 1 };
  };
  for (const [name, slot] of Object.entries(batch[type].slots)) {
    const value = values[name];
    if (value == null) continue;
    pick.slots[name] = slot.kind === "label" ? value : slot.repeat ? value.map(range) : range(value);
  }
  return { values, words, pick };
}

function fixture(type, overrides) {
  const { values, words, pick } = input(type, overrides);
  const grounded = groundCard(pick, type, words);
  assert.ok(grounded, `${type} grounds ${JSON.stringify(values)}`);
  const place = placeProOverlay(grounded, viewport);
  assert.ok(place, `${type} fits the frame`);
  return { values, words, pick, grounded, overlay: { ...grounded, id: `test-${type}`, place } };
}

function callsFor(overlay) {
  const calls = [];
  const timeline = { fromTo(target, from, to, at) { calls.push({ target, from, to, at }); },
    to(target, to, at) { calls.push({ target, to, at }); } };
  new Function("tl", proTimeline([overlay]))(timeline);
  return calls;
}

function shownCopy(html) {
  return html.replace(/<svg\b[\s\S]*?<\/svg>/g, "")
    .replace(/<br>|<\/div>|<\/span><span class="ge-price-line">/g, " ")
    .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

test("all assigned sources are triaged once and each built card has its MIT provenance", () => {
  assert.deepEqual(triage.map(({ id }) => id), assigned);
  const counts = { new: 0, variant: 0, merged: 0, duplicate: 0, deferred: 0, unfit: 0, cut: 0 };
  for (const { id, outcome, type, reason } of triage) {
    assert.ok(Object.hasOwn(counts, outcome), id);
    counts[outcome]++;
    assert.match(reason, /^.+$/, id);
    if (outcome === "unfit") assert.equal(type, undefined, id);
    else if (outcome === "duplicate") assert.ok(CARDS[type] && !batch[type], id);
    else if (outcome === "deferred") assert.ok(type && !CARDS[type], id);
    // Cut at merge: the card was built, then deliberately dropped, so it must not survive in the registry.
    else if (outcome === "cut") { assert.ok(type && !CARDS[type], id); assert.match(reason, /^cut at merge:/, id); }
    else assert.ok(batch[type], id);
  }
  assert.deepEqual(counts, { new: 5, variant: 16, merged: 11, duplicate: 14, deferred: 0, unfit: 32, cut: 3 });
  const notice = fs.readFileSync(new URL("../src/pro-cards/GHOST-EDITOR-LICENSE.md", import.meta.url), "utf8");
  assert.match(notice, /MIT License/);
  assert.match(notice, /Copyright \(c\) 2026 kurbaitaev/);
  for (const [type, definition] of Object.entries(batch)) {
    const entries = triage.filter((row) => row.type === type);
    assert.deepEqual(entries.filter((row) => row.outcome !== "merged").map((row) => row.outcome),
      [definition.variantOf ? "variant" : "new"], type);
    assert.deepEqual(definition.source.split(",").sort(), entries.map(({ id }) => `ghost-editor:${id}`).sort(), type);
  }
});

test("all designs register and ground exact copy through the ordinary planner entry point", () => {
  assert.deepEqual(Object.keys(examples).sort(), Object.keys(batch).sort());
  const zone = zoneFor(viewport.W, viewport.H);
  for (const [type, def] of Object.entries(batch)) {
    const { values, words, pick, grounded, overlay } = fixture(type);
    assert.equal(CARDS[type], def);
    assert.ok(tagsOf(type).length >= 1 && tagsOf(type).length <= 3);
    assert.ok(tagsOf(type).every((tag) => TAG_WORDS.includes(tag)));
    // Named design: a root with more than one design (since the 2026-11-28 ghost-editor import) also records its group.
    const root = rootOf(type);
    assert.deepEqual(groundProOverlay({ ...pick, type: root, design: type }, words),
      CARD_GROUPS[root].length > 1 ? { ...grounded, group: root } : grounded, type);
    assert.deepEqual(grounded.phrases.map(({ at }) => at), grounded.reveals);
    for (const [name, items] of Object.entries(grounded.slots)) {
      const slot = def.slots[name];
      if (slot.kind !== "spoken") continue;
      assert.ok(slot.size >= (numerical[type]?.[name] ? 96 : 40), `${type}.${name}`);
      const expected = slot.repeat ? values[name] : values[name] == null ? [] : [values[name]];
      assert.deepEqual(items.map(({ text }) => text), expected, `${type}.${name}`);
      for (const item of items) {
        assert.equal(item.at, words[item.from].start);
        assert.equal(item.end, words[item.to].end);
        assert.ok(!item.fontSize || numerical[type]?.[name], `${type}.${name} preserves the pro font size`);
      }
    }
    const size = proSize(overlay);
    if (def.fullscreen) {
      assert.deepEqual(size, { w: 1080, h: 1920 });
      assert.equal(overlay.place.slot, "full");
      assert.match(def.css, /padding:200px 180px 320px/);
      assert.match(def.css, /width:720px/);
      assert.ok(overlay.duration <= 4.5);
    } else {
      assert.ok(PRO_RECTS.some(({ w, h }) => size.w <= w && size.h <= h), type);
      const { x, y, w, h, scale } = overlay.place;
      assert.equal(scale, 1, type);
      assert.ok(x >= zone.left && x + w <= rightLimit(zone, y, y + h), type);
      assert.ok(y >= zone.top && y + h <= zone.bottom && y + h <= viewport.head.y - 56, type);
    }
  }
});

test("all spoken fields accept a twelve-letter word and reject invented and oversized copy", () => {
  assert.equal(longWord.length, 12);
  for (const [type, def] of Object.entries(batch)) {
    const { pick, words } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      if (slot.kind !== "spoken") continue;
      const value = numerical[type]?.[name] ?? longWord;
      assert.ok(value.split(" ").some((word) => word.replace(/[^a-z]/gi, "").length === 12));
      const override = (text) => ({ [name]: slot.repeat ? Array(slot.repeat[1]).fill(text) : text });
      const { overlay } = fixture(type, override(value));
      const html = renderProOverlay(overlay).html;
      assert.ok(shownCopy(html).includes(value), `${type}.${name}`);
      assert.doesNotMatch(html, /style="font-size:(36|3[7-9]|7[3-9]|8[0-9])px/);
      const firstRange = slot.repeat ? pick.slots[name][0] : pick.slots[name];
      for (const fake of ["Invented copy", { text: "Invented copy" }, { from: -1 }, { from: words.length }]) {
        const candidate = { ...pick, slots: { ...pick.slots, ...override(fake) } };
        assert.equal(groundCard(candidate, type, words), null, `${type}.${name}`);
      }
      const forged = { ...firstRange, text: "UNSPOKEN" };
      const ranges = slot.repeat ? [forged, ...pick.slots[name].slice(1)] : forged;
      const regrounded = groundCard({ ...pick, slots: { ...pick.slots, [name]: ranges } }, type, words);
      assert.equal(regrounded.slots[name][0].text, words.slice(firstRange.from, firstRange.to + 1).map((word) => word.text).join(" "));
      for (const invalid of ["x".repeat(slot.maxChars + 1), "W".repeat(Math.floor(slot.width / (slot.size * 0.95)) + 1), "🎉", ...(numerical[type]?.[name] ? ["three to five", "more"] : [])]) {
        const bad = input(type, override(invalid));
        assert.equal(groundCard(bad.pick, type, bad.words), null, `${type}.${name} rejects ${invalid}`);
      }
    }
  }
});

test("the new formats enforce repeat bounds, optional pairs and fixed number-free headings", () => {
  // revised-deal-terms (the optional-pair format) was cut at merge (see ge-triage-c.json).
  for (const type of ["ruled-checks", "printed-tally", "milestone-leaves", "punch-list"]) {
    const heading = fixedLabels[type][0];
    fixture(type, { heading });
    for (const invalid of ["Another heading", "Made up 42"]) {
      const bad = input(type, { heading: invalid });
      assert.equal(groundCard(bad.pick, type, bad.words), null, type);
    }
  }
  for (const [type, def] of Object.entries(batch)) {
    for (const [name, slot] of Object.entries(def.slots)) {
      if (!slot.repeat) continue;
      const [min, max] = slot.repeat;
      const template = examples[type][name][0];
      for (const count of [min - 1, max + 1]) {
        const bad = input(type, { [name]: Array(count).fill(template) });
        assert.equal(groundCard(bad.pick, type, bad.words), null, type);
      }
      for (const count of [min, max]) fixture(type, { [name]: Array(count).fill(template) });
    }
  }
});

test("two-line headlines and notes keep the densest cards inside the placement rectangle", () => {
  assert.deepEqual(proSize(fixture("price-revision", numerical["price-revision"]).overlay), { w: 720, h: 544 });
  assert.deepEqual(proSize(fixture("printed-tally", numerical["printed-tally"]).overlay), { w: 720, h: 544 });
  const { overlay } = fixture("coaching-findings", { test: "A much shorter discovery call opener" });
  assert.equal(overlay.slots.test[0].lines.length, 2);
  assert.deepEqual(proSize(overlay), { w: 720, h: 536 });
});

// availability-clock was cut at merge (see ge-triage-c.json), so the clock-hands test it needed is gone with it.

test("the render keeps exact escaped copy, authored labels, and the house palette", () => {
  const palette = new Set(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"]);
  for (const [type, def] of Object.entries(batch)) {
    const textSlot = Object.keys(def.slots).find((name) => def.slots[name].kind === "spoken" && !numerical[type]?.[name]);
    const text = "<b>& 'quoted'";
    const overrides = textSlot ? { [textSlot]: def.slots[textSlot].repeat
      ? examples[type][textSlot].map((item, i) => i ? item : text) : text } : {};
    const { overlay } = fixture(type, overrides);
    const { html, timeline } = renderProOverlay(overlay);
    const visible = shownCopy(html);
    if (textSlot) assert.ok(visible.includes("&lt;b&gt;&amp; &#39;quoted&#39;"), type);
    assert.doesNotMatch(html, /<b>|<img\b|<image\b|<script\b|<video\b|<use\b/);
    for (const label of fixedLabels[type] || []) {
      assert.ok(label.split(" ").length <= 4 && !/\d/.test(label));
      assert.ok(visible.includes(label), type);
    }
    const labels = [...html.matchAll(/class="ge-label">([^<]+)</g)].map(([, label]) => label);
    assert.deepEqual(labels, fixedLabels[type] || [], type);
    const digits = (text) => [...text.replace(/&#39;/g, "").matchAll(/\d+/g)].map(([n]) => n);
    assert.deepEqual(digits(visible), digits(overlay.phrases.map((item) => item.text).join(" ")), type);
    assert.doesNotMatch(def.css, /url\(|gradient\(|blur\(|glow|@keyframes/i);
    assert.doesNotMatch(timeline, /Math\.random|\bDate\b|back\.out|bounce|rotation|repeat:|yoyo/);
    for (const rule of def.css.split("}").filter((rule) => rule.trim())) {
      for (const selector of rule.split("{")[0].split(",")) {
        assert.match(selector.trim(), new RegExp(`^\\.pro-${type}(?:[ .:>]|$)`));
      }
    }
    for (const color of (def.css + timeline + html).match(/#[\da-f]{6}\b/gi) || []) assert.ok(palette.has(color), color);
    for (const [, font] of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font), font);
    const css = proCSS({ types: new Set([type]) });
    assert.ok(css.includes(def.css));
    for (const [other, spec] of Object.entries(batch)) if (other !== type) assert.ok(!css.includes(spec.css));
  }
});

test("each spoken slot and each source-inspired move starts at its recorded reveal", () => {
  const accents = {
    "buyer-motive": [".ge-arrow path", "behavior", "state"],
    "price-revision": [".ge-strike path", "revised", "state"],
    "habits-to-cut": [".ge-breaker-0 .ge-lever", "habits-0", "state"],
    "capacity-drain": [".ge-cell-0", "drains-0", "state"],
    "coaching-findings": [".ge-finding-0 .ge-tick path", "findings-0", "state"],
    "typed-pullquote": [".ge-glyph", "quote", "print"],
    "spoken-title-landing": [".ge-lines-3", "lines-3", "enter"],
    "ruled-checks": [".ge-check-row-0 .ge-tick path", "items-0", "state"],
    "pinned-method-board": [".ge-note-0", "items-0", "enter"],
    "printed-tally": [".ge-total-box", "total", "enter"],
    "phrase-translation": [".ge-link path", "detail", "state"],
    "drawn-milestones": [".ge-link-1 .ge-draw", "stages-1", "state"],
    "milestone-leaves": [".ge-leaf-0 .ge-tab", "items-1", "state"],
    "topic-files": [".ge-folder-0", "topics-0", "enter"],
    "punch-list": [".ge-punch-row-0 .ge-hole", "items-0", "enter"],
    "habit-rocker": [".ge-toggle", "focus", "state"],
    "alert-tearaway": [".ge-slip-1 .ge-flap", "message1", "state"],
    "clocked-results": [".ge-press", "value", "state"],
    "slate-strike": [".ge-avoid-0 .ge-strike path", "avoid-0", "state"],
    "stamped-quote": [".ge-quote-stamp", "quote", "enter"],
    "detail-underlines": [".ge-band-0 .ge-underline path", "items-0", "state"],
  };
  for (const [type, def] of Object.entries(batch)) {
    const { overlay } = fixture(type);
    const calls = callsFor(overlay);
    assert.deepEqual(renderProOverlay(overlay), renderProOverlay(overlay), type);
    assert.equal(calls[0].at, overlay.start);
    assert.equal(calls[0].to.duration, PRO_MOTION.enter);
    const cueTimes = {};
    for (const [name, items] of Object.entries(overlay.slots)) {
      if (def.slots[name].kind !== "spoken") continue;
      for (const [i, item] of items.entries()) {
        const key = def.slots[name].repeat ? `${name}-${i}` : name;
        const write = calls.find(({ target }) => target === `#${overlay.id} .ge-${key}`);
        assert.ok(write, `${type}.${key}`);
        assert.equal(write.at, item.at);
        assert.equal(write.from.opacity, 0);
        assert.equal(write.to.opacity, 1);
        assert.equal(write.to.duration, PRO_MOTION.enter);
        assert.equal(write.to.clipPath, "inset(0 0 0 0)");
        cueTimes[key] = item.at;
      }
    }
    const [selector, key, motion] = accents[type];
    const accent = calls.find(({ target }) => target === `#${overlay.id} ${selector}`);
    assert.ok(accent, type);
    assert.equal(accent.at, cueTimes[key], type);
    assert.equal(motion === "print" ? accent.to.stagger.amount : accent.to.duration,
      PRO_MOTION[motion === "print" ? "enter" : motion], type);
    for (const call of calls.slice(0, -1)) {
      assert.equal(call.to.immediateRender, false);
      assert.equal(typeof call.to.ease, "function");
    }
    assert.equal(calls.at(-1).target, `#${overlay.id}`);
    assert.equal(calls.at(-1).to.duration, PRO_MOTION.exit);
    assert.equal(calls.at(-1).at, +(overlay.end - PRO_MOTION.exit).toFixed(3));
  }
});

test("the typed quote seeks cleanly through the character reveal with vendored GSAP", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true });
  const { overlay } = fixture("typed-pullquote", { quote: "Listen" });
  const glyphs = Array.from("Listen", () => ({ opacity: 0 }));
  const tl = {
    fromTo(selector, ...args) { if (selector.endsWith(".ge-glyph")) timeline.fromTo(glyphs, ...args); },
    to() {},
  };
  new Function("tl", proTimeline([overlay]))(tl);
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const sample = (offset) => {
    timeline.seek(overlay.start + offset);
    return glyphs.map(({ opacity }) => opacity);
  };
  assert.deepEqual(sample(-0.02), [0, 0, 0, 0, 0, 0]);
  const mid = sample(0.06);
  assert.ok(mid.some((value) => value === 1) && mid.some((value) => value === 0));
  assert.deepEqual(sample(0.25), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(sample(0.06), mid);
  assert.deepEqual(sample(-0.02), [0, 0, 0, 0, 0, 0]);
});
