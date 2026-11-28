import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CARDS as BATCH } from "../src/pro-cards/ge-e.mjs";
import { CARDS, CARD_GROUPS, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, PRO_MOTION, proSize, proTextLines } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const objection = { theySay: "I need to think about it", youSay: "What would make the choice easier?" };
const workBlock = { total: "six hours", blocks: ["two hours prospecting", "one hour following up", "three hours taking calls"] };
const fixtures = {
  "objection-shield": objection,
  "thought-bubbles": { term: "Discovery", detail: "Find out what they want to change" },
  "reply-return": objection,
  "role-handoff": { sender: "The setter", handoff: "passes along the discovery notes", receiver: "to the closer" },
  "rung-layers": { layers: ["Lead quality", "Fast follow-up", "Discovery", "Consistent closes"] },
  "focus-drains": { resource: "You burn your attention", drains: ["Checking notifications", "Refreshing your inbox", "Jumping between scripts", "Switching offers mid-call"] },
  "ingredient-pull": { parts: ["Lead quality", "Speed to lead", "Follow-up"], result: "A fuller pipeline" },
  "tracking-trend": { samples: ["35%", "forty percent", "20%", "70%"], context: "Show rate" },
  "bar-to-cells": { value: "42.5%", context: "of the calls actually showed up" },
  "work-block-split": workBlock,
  "alert-extract": { title1: "Discovery call", message1: "I can take the call now", title2: "The offer", message2: "Please send the details", title3: "Agreement", message3: "We are ready to sign" },
  "dock-checklist": { heading: "Before the call", items: ["Review their goals", "Check the handoff", "Prepare your opener", "Open the call notes"] },
  "scan-replace": { before: "35%", after: "49%", label: "Close rate" },
};

function fixture(type, values = fixtures[type]) {
  const words = [];
  const range = (text) => {
    const from = words.length;
    for (const token of text.split(/\s+/)) {
      const start = 4 + words.length * 0.25;
      words.push({ text: token, start, end: start + 0.2 });
    }
    return { from, to: words.length - 1 };
  };
  const pick = { type };
  for (const [name, slot] of Object.entries(BATCH[type].slots)) {
    const value = values[name];
    if (value == null) continue;
    pick[name] = slot.kind === "label" ? value : slot.repeat ? value.map(range) : range(value);
  }
  return { pick, words, overlay: groundCard(pick, type, words) };
}

function render(type, values) {
  const { overlay, words } = fixture(type, values);
  assert.ok(overlay, `${type} grounds`);
  const size = proSize(overlay);
  const placed = { ...overlay, id: "pro-ge-e", place: { x: 180, y: 700, ...size } };
  const { html } = renderProOverlay(placed);
  const timeline = proTimeline([placed]);
  const calls = [];
  const tl = Object.fromEntries(["fromTo", "to", "set"].map((method) => [method, (...args) => calls.push({ method, args })]));
  new Function("tl", timeline)(tl);
  return { html, timeline, overlay, words, size, calls };
}

const schema = (def) => Object.entries(def.slots).map(([name, slot]) => [name, slot.kind, slot.repeat, !!slot.optional]);
const textWrites = (calls) => calls.filter(({ method, args }) => method === "fromTo" && args[0].startsWith("#pro-ge-e ") &&
  args[1].opacity === 0 && args[2].opacity === 1 && args[2].clipPath === "inset(0 0% 0 0)" &&
  args[1].clipPath && !args[0].includes(".ge-segment-"));

test("all 81 requested sources have one disposition and every imported design keeps its MIT provenance", () => {
  const expected = {
    whiteboard: "stick arrow check cross underline grid line crown clock bulb bubble shield cloud books eye boomerang robot barbell trophy phone envelope bridge laptop tag form camera heart sun rings calendar coffee people hourglass polaroid pin link wrench phone-apps badge book key bell plane social-card wheel flag bed runner house mountain day-box zz",
    "data-story": "book-print-ring category-bars-sourced day-unit-chart",
    "hologram-hud": "phone-scan-in book-keep-cover notifications-pull-out basics-turntable erase-and-fill",
  };
  const ideas = { whiteboard: 8, "data-story": 5, "hologram-hud": 8 };
  const ids = Object.entries(expected).flatMap(([recipe, names]) => [...names.split(" "),
    ...Array.from({ length: ideas[recipe] }, (_, i) => `idea-${i + 1}`)].map((name) => `${recipe}/${name}`));
  const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/ge-triage-e.json", import.meta.url), "utf8"));
  assert.deepEqual(triage.map(({ id }) => id), ids);
  assert.equal(ids.length, 81);
  for (const { id, outcome, type, reason } of triage) {
    assert.ok(["new", "variant", "merged", "duplicate", "deferred", "unfit", "cut"].includes(outcome), id);
    assert.ok(reason && !reason.includes("\n"), id);
    if (outcome === "unfit") assert.equal(type, undefined, id);
    else if (outcome === "deferred") assert.ok(type && !CARDS[type], id);
    // Cut at merge: the card was built, then deliberately dropped, so it must not survive in the registry.
    else if (outcome === "cut") { assert.ok(type && !CARDS[type], id); assert.match(reason, /^cut at merge:/, id); }
    else assert.ok(CARDS[type], id);
    if (outcome === "duplicate") assert.ok(!BATCH[type], id);
    if (outcome === "merged") assert.ok(BATCH[type], id);
    if (outcome === "new") assert.ok(BATCH[type] && !BATCH[type].variantOf, id);
    if (outcome === "variant") assert.ok(BATCH[type]?.variantOf, id);
  }
  assert.ok(triage.filter(({ outcome }) => outcome === "new").length <= 8);
  for (const [type, def] of Object.entries(BATCH)) {
    const uses = triage.filter((row) => row.type === type);
    assert.equal(uses.filter(({ outcome }) => outcome === "new" || outcome === "variant").length, 1, type);
    assert.deepEqual(def.source.split(",").sort(), uses.map(({ id }) => `ghost-editor:${id}`).sort(), type);
  }
  const license = fs.readFileSync(new URL("../src/pro-cards/GHOST-EDITOR-LICENSE.md", import.meta.url), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 kurbaitaev/);
  assert.match(license, /Copyright \(c\) 2026 LemoLab/);
});

test("every card registers and variants select through their root with identical slot schemas", () => {
  assert.deepEqual(Object.keys(BATCH).sort(), Object.keys(fixtures).sort());
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(CARDS[type], def, type);
    assert.ok(def.tags.length >= 1 && def.tags.length <= 3 && def.tags.every((tag) => TAG_WORDS.includes(tag)), type);
    const { pick, words } = fixture(type);
    if (!def.variantOf) {
      assert.ok(def.hint && !def.hint.includes("\n"), type);
      assert.equal(groundProOverlay(pick, words)?.type, type);
      continue;
    }
    const root = CARDS[def.variantOf];
    assert.ok(root && !root.variantOf && CARD_GROUPS[def.variantOf].includes(type), type);
    assert.equal(def.family, root.family, type);
    assert.deepEqual(schema(def), schema(root), type);
    const selected = groundProOverlay({ ...pick, type: def.variantOf, design: type }, words);
    assert.equal(selected?.type, type);
    assert.equal(selected?.group, def.variantOf);
  }
});

test("renders exact escaped spoken phrases with deterministic house timing and safe-zone bounds", () => {
  const zone = zoneFor();
  for (const type of Object.keys(BATCH)) {
    const { html, overlay, words, size, calls, timeline } = render(type);
    assert.ok(size.w > 0 && size.h > 0 && size.w <= 720 && size.h <= 560, type);
    assert.ok(180 >= zone.left && 700 >= zone.top && 700 + size.h <= zone.bottom, type);
    assert.ok(180 + size.w <= rightLimit(zone, 700, 700 + size.h), type);
    assert.ok(!overlay.fullscreen, type);
    assert.deepEqual(overlay.reveals, overlay.phrases.map(({ from }) => words[from].start), type);
    const visible = html.replaceAll("<br>", " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const phrase of overlay.phrases) {
      assert.equal(phrase.text, words.slice(phrase.from, phrase.to + 1).map(({ text }) => text).join(" "), type);
      assert.ok(visible.includes(phrase.text), `${type}: ${phrase.text}`);
      assert.equal(phrase.fontSize, undefined, type);
    }
    const writes = textWrites(calls);
    assert.deepEqual(writes.map(({ args }) => args[3]), overlay.reveals, type);
    assert.ok(writes.every(({ args }) => args[2].duration === PRO_MOTION.enter), type);
    for (const { method, args } of calls.filter(({ args }) => args[0].startsWith("#pro-ge-e "))) {
      const classes = args[0].match(/\.[\w-]+/g) || [];
      for (const cls of classes) assert.match(html, new RegExp(`class="[^"]*\\b${cls.slice(1)}\\b`), type);
      if (method === "set") {
        assert.ok(overlay.reveals.includes(args[2]), type);
        continue;
      }
      const [, from, to, at] = args;
      assert.ok(overlay.reveals.includes(at), type);
      assert.ok([PRO_MOTION.enter, PRO_MOTION.state].includes(to.duration), type);
      assert.equal(to.immediateRender, false, type);
      assert.equal(typeof to.ease, "function", type);
      assert.ok([from.x, from.y, to.x, to.y].every((distance = 0) => Math.abs(distance) <= 16), type);
      assert.ok(!("rotation" in from || "rotation" in to), type);
    }
    assert.equal(calls.filter(({ method }) => method === "to").length, 1, type);
    assert.equal(calls.at(-1).args[0], "#pro-ge-e", type);
    assert.equal(calls.at(-1).args[1].duration, PRO_MOTION.exit, type);
    assert.doesNotMatch(timeline, /undefined|NaN|Math\.random|new Date|yoyo:/, type);
    assert.doesNotMatch(html, /<(?:img|canvas|video|image|foreignObject)\b|\b(?:href|src)=|(?:https?|data):/i, type);
    assert.equal(render(type).timeline, timeline, type);
  }
});

const numericFields = {
  "tracking-trend": new Set(["samples"]),
  "bar-to-cells": new Set(["value"]),
  "work-block-split": new Set(["total", "blocks"]),
  "scan-replace": new Set(["before", "after"]),
};
const longWord = "Negotiations";
const widthProbe = "Intelligible";
const withFirst = (values, name, word) => ({ ...values, [name]: Array.isArray(values[name]) ? [word, ...values[name].slice(1)] : word });

test("every slot rejects invented ranges and overflow, and prose fits and escapes at its own size", () => {
  assert.equal(longWord.length, 12);
  assert.equal(widthProbe.length, 12);
  for (const [type, def] of Object.entries(BATCH)) {
    const { pick, words } = fixture(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      const field = `${type}.${name}`;
      if (slot.kind === "label") {
        assert.ok(slot.size >= 28, field);
        assert.equal(groundCard({ ...pick, [name]: "Week 2" }, type, words), null, field);
        assert.equal(groundCard({ ...pick, [name]: "One two three four five" }, type, words), null, field);
        assert.match(render(type, { ...fixtures[type], [name]: "<A&B>'" }).html, /&lt;A&amp;B&gt;&#39;/, field);
        continue;
      }
      assert.ok(slot.size >= 40, field);
      assert.deepEqual(proTextLines(widthProbe, { ...slot, maxLines: 1 }), [widthProbe], field);
      assert.equal(groundCard({ ...pick, [name]: slot.repeat ? ["Invented copy"] : "Invented copy" }, type, words), null, field);
      if (slot.optional) assert.ok(fixture(type, { ...fixtures[type], [name]: undefined }).overlay, field);
      else assert.equal(groundCard({ ...pick, [name]: undefined }, type, words), null, field);
      const range = slot.repeat ? pick[name][0] : pick[name];
      for (const text of ["W".repeat(slot.maxChars + 1), "W".repeat(slot.maxChars)]) {
        const oversized = words.map((word, i) => i === range.from ? { ...word, text } : word);
        assert.equal(groundCard(pick, type, oversized), null, field);
      }
      if (slot.repeat) {
        assert.equal(groundCard({ ...pick, [name]: pick[name].slice(0, slot.repeat[0] - 1) }, type, words), null, field);
        assert.equal(groundCard({ ...pick, [name]: Array(slot.repeat[1] + 1).fill(range) }, type, words), null, field);
        if (pick[name].length > 1) assert.equal(groundCard({ ...pick, [name]: [...pick[name]].reverse() }, type, words), null, field);
      }
      if (numericFields[type]?.has(name)) {
        assert.equal(fixture(type, withFirst(fixtures[type], name, longWord)).overlay, null, field);
        assert.ok(slot.validate, field);
        continue;
      }
      assert.deepEqual(proTextLines(longWord, { ...slot, maxLines: 1 }), [longWord], field);
      const long = fixture(type, withFirst(fixtures[type], name, longWord)).overlay;
      assert.deepEqual(long?.slots[name][0].lines, [longWord], field);
      assert.equal(long?.slots[name][0].fontSize, undefined, field);
      const { html } = render(type, withFirst(fixtures[type], name, "<A&B>'"));
      assert.match(html, /&lt;A&amp;B&gt;&#39;/, field);
      assert.doesNotMatch(html, /<A&B>/, field);
    }
  }
  // Time allocations still have room for a long activity word after an exact duration.
  assert.ok(fixture("work-block-split", { ...workBlock, blocks: ["two hours Negotiations", ...workBlock.blocks.slice(1)] }).overlay);
});

test("geometry is based on validated spoken amounts and keeps zero, ties and fractional cells accurate", () => {
  const chart = render("tracking-trend");
  assert.deepEqual(Array.from(chart.html.matchAll(/class="ge-point ge-point-\d+" cx="[^"]+" cy="([^"]+)"/g), (match) => Number(match[1])),
    [76, 68.286, 99.143, 22]);
  const zero = render("tracking-trend", { samples: ["zero", "0", "zero"] });
  assert.equal((zero.html.match(/cy="130"/g) || []).length, 3);
  for (const samples of [["30%", "40", "50%"], ["15 or 20", "30", "40"], ["-10", "0", "20"], ["thirty calls", "forty calls", "fifty calls"]]) {
    assert.equal(fixture("tracking-trend", { samples }).overlay, null, samples.join(", "));
  }
  const decimal = render("bar-to-cells").calls.find(({ args }) => args[0] === "#pro-ge-e .ge-unit-42-fill");
  assert.equal(decimal.args[1].attr.width, 3.2);
  assert.equal(decimal.args[2].attr.width, 28.5);
  assert.equal(decimal.args[3], render("bar-to-cells").overlay.slots.context[0].at);
  for (const value of ["0%", "100%"]) {
    const { html } = render("bar-to-cells", { value, context: "of those prospects booked" });
    assert.equal((html.match(/<rect /g) || []).length, 100, value);
    assert.equal((html.match(/ge-cell-fill/g) || []).length, value === "0%" ? 0 : 100, value);
  }
  for (const value of ["101%", "40", "40% or 60%", "-10%", "$40%", "roughly forty percent", "more than half"]) {
    assert.equal(fixture("bar-to-cells", { value, context: "of those prospects booked" }).overlay, null, value);
  }

  const allocated = render("work-block-split").html;
  assert.deepEqual(Array.from(allocated.matchAll(/<g class="ge-units-\d+">(.*?)<\/g>/g), ([, group]) => (group.match(/<rect /g) || []).length), [2, 1, 3]);
  assert.equal((render("work-block-split", { total: "two hours", blocks: ["ninety minutes on calls", "thirty minutes reviewing"] }).html.match(/<rect /g) || []).length, 4);
  for (const blocks of [
    ["two hours prospecting", "one hour reviewing"],
    ["four hours prospecting", "three hours following up"],
    ["two hours or three outreach", "four hours reviewing"],
    ["two hours plus one hour reviewing", "four hours calling"],
    ["two hours 30 minutes calling", "four hours reviewing"],
    ["2.5 hours prospecting", "3.5 hours following up"],
    ["zero minutes prospecting", "six hours following up"],
    ["one minute prospecting", "359 minutes following up"],
    ["six hours", "one hour following up"],
  ]) assert.equal(fixture("work-block-split", { ...workBlock, blocks }).overlay, null, blocks.join(", "));
});

test("all CSS selectors are card-scoped with house type and palette, and labels stay short and digit-free", () => {
  const allowed = new Set(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"]);
  for (const [type, def] of Object.entries(BATCH)) {
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css.trim()), type);
    for (const [, group] of def.css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of group.trim().split(",")) assert.match(selector.trim(), new RegExp(`^\\.pro-${type}(?:$|[ .:#>+~\\[])`), type);
    }
    for (const [color] of def.css.matchAll(/#[0-9a-f]{3,8}\b/gi)) assert.ok(allowed.has(color.toUpperCase()), `${type}: ${color}`);
    for (const [, font] of def.css.matchAll(/"([^"]+)"/g)) assert.ok(["Inter", "Anton"].includes(font), `${type}: ${font}`);
    assert.doesNotMatch(def.css, /blur\(|gradient\(|url\(|@font-face|text-shadow|rgba?\(/i, type);
    const { html } = render(type);
    for (const [, title] of html.matchAll(/class="ge-label">([^<]+)</g)) {
      assert.ok(title.split(/\s+/).length <= 4 && !/\d/.test(title), `${type}: ${title}`);
    }
  }
});

test("repeat and optional size extremes fit without clipping multiline copy", () => {
  const options = [
    ["rung-layers", { layers: ["Lead quality", "Discovery", "Closing"] }, 346],
    ["focus-drains", { resource: "You lose concentration", drains: ["Talking too quickly", "Checking your phone"] }, 320],
    ["ingredient-pull", { parts: ["Good questions", "Deep listening"], result: "Clear goals" }, 310],
    ["dock-checklist", { items: ["Review their goals", "Open the call notes"] }, 268],
    ["work-block-split", { total: "four hours", blocks: ["one hour prospecting", "one hour on calls", "one hour following up", "one hour training"] }, 444],
  ];
  for (const [type, values, height] of options) {
    const { size } = render(type, values);
    assert.equal(size.h, height, type);
  }
});
