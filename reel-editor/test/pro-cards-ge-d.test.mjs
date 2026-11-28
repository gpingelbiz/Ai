import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARDS as lane } from "../src/pro-cards/ge-d.mjs";
import { CARDS, CARD_GROUPS, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proSize, proPrompt, PRO_MOTION } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const examples = {
  "comment-typed-slip": { comment: "That made the call so much easier" },
  "selection-rows": { items: ["Discovery", "Follow up", "Negotiation", "Accountability"] },
  "alert-drop": { subject: "Call confirmed", body: "I will be there at noon" },
  "alert-cascade": { messages: ["Call confirmed", "Ready to talk", "Send the invite"] },
  "count-print-window": { value: "one thousand", label: "Calls booked" },
  "rank-fill-strip": { heading: "Sales priorities", items: ["First coach the opener", "Then set the next step", "Then follow up"] },
  "fraction-breakaway": { value: "one out of twelve", context: "Booked a second call" },
  "versus-checkline": { weaker: "Send me an email", better: "Let's pick a time" },
  "word-index-slip": { word: "Consultation" },
  "headline-qualifier": { lines: ["What you need is", "Permission", "before the pitch"] },
  "lesson-understroke": { line: "Name the cost of waiting" },
  "question-ticket": { headline: "Why do prospects stop replying?" },
  "erasing-habit": { habit: "Chasing every lead" },
  "strike-recall": { habit: "Making promises you can't keep" },
  "pill-push-stack": { items: ["Read their last reply", "Confirm the problem", "Ask for a time", "Send the invite"] },
  "receipt-tally": { value1: "40%", context1: "Close rate", value2: "62%", context2: "Show rate", value3: "12", context3: "Booked calls", value4: "$900", context4: "Revenue" },
  "output-branches": { hub: "Call coaching", leaves: ["Better questions", "Clear next steps", "Good notes", "More practice"] },
  "role-example-tabs": {
    one: "Setter", oneDetail: "You qualify the prospect",
    two: "Closer", twoDetail: "You help them decide",
    three: "Coach", threeDetail: "You review the call",
  },
};

const numeric = {
  "count-print-window": { value: "one thousand" },
  "fraction-breakaway": { value: "two out of ten" },
  "receipt-tally": { value1: "five", value2: "200", value3: "$97", value4: "10%" },
};

function fixture(type, overrides = {}) {
  const slots = { ...examples[type], ...overrides };
  const words = [], pick = { type, slots: {} };
  const range = (phrase) => {
    const from = words.length;
    for (const text of phrase.split(" ")) {
      const start = 3 + words.length * 0.25;
      words.push({ text, start, end: start + 0.2 });
    }
    return { from, to: words.length - 1 };
  };
  for (const [name, slot] of Object.entries(lane[type].slots)) {
    const value = slots[name];
    if (value === undefined) continue;
    pick.slots[name] = slot.kind === "label" ? value : slot.repeat ? value.map(range) : range(value);
  }
  return { words, pick, slots, grounded: groundCard(pick, type, words) };
}

const head = { x: 360, y: 840, w: 360, h: 232 };
const zone = zoneFor();
const frame = { measured: true, W: zone.W, H: zone.H, head };

function placed(grounded) {
  assert.ok(grounded);
  const place = placeProOverlay(grounded, frame);
  assert.ok(place, grounded.type);
  return { ...grounded, place, id: "lane-d" };
}

function events(overlay) {
  const calls = [];
  const tl = {
    fromTo(target, from, to, at) { calls.push({ target, from, to, at }); },
    to(target, to, at) { calls.push({ target, to, at }); },
  };
  new Function("tl", proTimeline([overlay]))(tl);
  return calls;
}

const replaceEach = (value, phrase) => Array.isArray(value) ? value.map(() => phrase) : phrase;
const palette = new Set(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"]);

test("all lane D cards carry reviewed ghost-editor provenance and the existing MIT notice", () => {
  const notice = readFileSync(new URL("../src/pro-cards/GHOST-EDITOR-LICENSE.md", import.meta.url), "utf8");
  assert.match(notice, /MIT License/);
  assert.match(notice, /Copyright \(c\) 2026 kurbaitaev/);
  const triage = JSON.parse(readFileSync(new URL("../src/pro-cards/ge-triage-d.json", import.meta.url), "utf8"));
  assert.equal(triage.length, 59);
  assert.equal(new Set(triage.map((row) => row.id)).size, 59);
  const outcomes = Object.groupBy(triage, (row) => row.outcome);
  assert.deepEqual(Object.fromEntries(Object.entries(outcomes).map(([key, list]) => [key, list.length])),
    { variant: 18, unfit: 27, duplicate: 8, cut: 6 });
  for (const row of triage) {
    assert.ok(row.reason && !row.reason.includes("\n"), row.id);
    // Cut at merge: the card was built, then deliberately dropped, so it must not survive in the registry.
    if (row.outcome === "cut") { assert.ok(row.type && !CARDS[row.type], row.id); assert.match(row.reason, /^cut at merge:/, row.id); continue; }
    if (row.outcome !== "unfit") assert.ok(CARDS[row.type], row.id);
    if (["new", "variant", "merged"].includes(row.outcome)) {
      assert.ok(lane[row.type].source.split(", ").includes(`ghost-editor:${row.id}`), row.id);
    }
  }
  const built = triage.filter((row) => ["new", "variant"].includes(row.outcome));
  assert.deepEqual(built.map((row) => row.type).sort(), Object.keys(lane).sort());
  assert.deepEqual(Object.keys(examples).sort(), Object.keys(lane).sort());
});

for (const [type, def] of Object.entries(lane)) {
  test(`${type} grounds exact copy, writes on cue and places inside the safe zone`, () => {
    const { pick, words, slots, grounded } = fixture(type);
    assert.equal(CARDS[type], def);
    assert.ok(def.tags.length >= 1 && def.tags.length <= 3 && def.tags.every((tag) => TAG_WORDS.includes(tag)));
    assert.ok(CARD_GROUPS[def.variantOf || type].includes(type));
    const planned = groundProOverlay({ ...pick, type: def.variantOf || type, design: type }, words);
    assert.equal(planned?.type, type);
    if (def.variantOf) {
      const root = def.variantOf;
      assert.equal(def.hint, CARDS[root].hint);
      const saved = groundCard(pick, root, words);
      if (saved) {
        const { group, ...original } = groundProOverlay({ ...pick, type: root, design: root }, words);
        assert.equal(group, root);
        assert.deepEqual(original, saved);
        assert.deepEqual(renderProOverlay(placed(original)), renderProOverlay(placed(saved)));
      }
    }

    const overlay = placed(grounded), size = proSize(overlay);
    assert.ok(size.w > 0 && size.w <= 720 && size.h > 0 && size.h <= 560);
    assert.equal(overlay.fullscreen, undefined);
    assert.ok(overlay.place.x >= zone.left);
    assert.ok(overlay.place.y >= zone.top);
    assert.ok(overlay.place.y + overlay.place.h <= zone.bottom);
    assert.ok(overlay.place.x + overlay.place.w <= rightLimit(zone, overlay.place.y, overlay.place.y + overlay.place.h));
    assert.ok(overlay.place.y + overlay.place.h <= head.y - 56);

    const render = renderProOverlay(overlay);
    const motion = events(overlay);
    assert.deepEqual(renderProOverlay(overlay), render);
    assert.ok(render.html.includes(`pro-${type}`));
    assert.doesNotMatch(render.html, /<img|<video|font-size:/);
    const seen = [];
    for (const [name, slot] of Object.entries(def.slots)) {
      if (slot.kind !== "spoken") continue;
      assert.ok(slot.size >= 40, name);
      const expected = [].concat(slots[name]);
      assert.deepEqual(overlay.slots[name].map((item) => item.text), expected);
      for (const item of overlay.slots[name]) {
        assert.equal(item.at, words[item.from].start);
        assert.equal(item.fontSize, undefined);
        seen.push(item.at);
        const write = motion.find(({ target, at, from, to }) =>
          target.startsWith("#lane-d .") && at === item.at && from?.clipPath && to.clipPath === "inset(0 0 0 0)");
        assert.ok(write, `${name} writes at ${item.at}`);
        assert.equal(write.to.duration, PRO_MOTION.enter);
      }
    }
    assert.deepEqual(overlay.reveals, seen);
    const css = def.css;
    for (const block of css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of block[1].trim().split(",")) assert.ok(selector.trim().startsWith(`.pro-${type}`), selector);
    }
    for (const color of `${css}\n${render.timeline}`.match(/#[\da-f]{6}\b/gi) || []) assert.ok(palette.has(color), color);
    for (const font of css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font[1]), font[1]);
    assert.doesNotMatch(css, /gradient\(|blur\(|url\(|text-shadow/);
    assert.ok(proCSS({ types: new Set([type]) }).includes(css));
  });

  test(`${type} fits long words and rejects invented, oversized or unearned quantity slots`, () => {
    const { words, pick, slots, grounded } = fixture(type);
    assert.ok(grounded);
    for (const [name, slot] of Object.entries(def.slots)) {
      if (slot.kind === "label") {
        for (const heading of ["Top 3 priorities", "More than four label words"]) {
          assert.equal(fixture(type, { [name]: heading }).grounded, null);
        }
        continue;
      }
      const eligible = numeric[type]?.[name] ?? "Consultation";
      const long = fixture(type, { [name]: replaceEach(slots[name], eligible) });
      assert.ok(long.grounded, `${name} fits "${eligible}"`);
      assert.ok(long.grounded.slots[name].every((item) => !item.fontSize));
      assert.ok(long.grounded.slots[name].every((item) => item.lines.length === 1 || numeric[type]?.[name]), name);
      assert.equal(fixture(type, { [name]: replaceEach(slots[name], "W".repeat(slot.maxChars + 1)) }).grounded, null);
      const invented = { text: "Invented copy" };
      assert.equal(groundCard({ ...pick, slots: { ...pick.slots, [name]: slot.repeat ? slots[name].map(() => invented) : invented } }, type, words), null);
      if (numeric[type]?.[name]) {
        assert.equal(fixture(type, { [name]: "more than ten" }).grounded, null);
        continue;
      }
      const escaped = fixture(type, { [name]: replaceEach(slots[name], "A<&>'") });
      const { html } = renderProOverlay(placed(escaped.grounded));
      assert.doesNotMatch(html, /A<&>'/);
      assert.match(html, /&lt;/);
      assert.match(html, /&amp;/);
      assert.match(html, /&gt;/);
      assert.match(html, /&#39;/);
    }
  });
}

// countertrend-pair (the two-series endpoint chart) was cut at merge (see ge-triage-d.json), taking its test with it.

test("a count and an ungrouped subgroup never invent observations", () => {
  const count = renderProOverlay(placed(fixture("count-print-window", { value: "539" }).grounded));
  assert.match(count.html, />539<\/div>/);
  assert.doesNotMatch(count.html, />\d{1,2}<\/div>/);
  const share = fixture("fraction-breakaway");
  const { html } = renderProOverlay(placed(share.grounded));
  assert.equal(html.match(/<circle/g).length, 12);
  assert.equal(html.match(/class="gd-part"/g).length, 1);
  assert.equal(fixture("fraction-breakaway", { value: "one out of thirteen" }).grounded, null);
  assert.equal(fixture("fraction-breakaway", { value: "two out of two" }).grounded, null);
});

test("optional fields and smaller repeat counts hold the same card contract", () => {
  assert.ok(fixture("rank-fill-strip", { heading: undefined }).grounded);
  const tally = fixture("receipt-tally", { value4: undefined, context4: undefined });
  assert.ok(tally.grounded);
  assert.equal(fixture("receipt-tally", { context4: undefined }).grounded, null);
  assert.equal(fixture("receipt-tally", { value4: undefined }).grounded, null);
  assert.doesNotMatch(renderProOverlay(placed(tally.grounded)).html, /gd-tally-4/);
  assert.ok(fixture("alert-cascade", { messages: ["Confirmed"] }).grounded);
});

test("no lane D meaning adds its own planner line now that every lane D card is a design of an existing type", () => {
  // countertrend-pair, inbound-replies, failed-attempts and input-convergence were lane D's 4 own root
  // meanings; all 4 were cut at merge (see ge-triage-d.json), leaving only designs of other lanes' types.
  const roots = Object.entries(lane).filter(([, def]) => !def.variantOf);
  assert.equal(roots.length, 0);
  const prompt = proPrompt(fixture("alert-cascade").words);
  for (const [type, def] of Object.entries(lane)) {
    const lines = prompt.split("\n").filter((line) => line.startsWith(`${type} `));
    assert.equal(lines.length, def.variantOf ? 0 : 1);
  }
});
