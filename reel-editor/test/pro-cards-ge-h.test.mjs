import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CARDS as batch } from "../src/pro-cards/ge-h.mjs";
import { CARDS, rootOf, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, PRO_MOTION, proPrompt, proSize, proTextLines } from "../src/pro.mjs";
import { proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const cases = {
  "topic-slab-rise": [{ headline: "Discovery questions" }, { headline: [".gh-copy"] }],
  "module-outline": [{ topics: ["Discovery", "Objections", "Follow up", "Pricing", "Closing"] },
    { topics: [0, 1, 2, 3, 4].map((i) => `.gh-module-${i} .gh-copy`) }],
  "off-track-reset": [{ heading: "Delivery", left: "Rush the question", right: "Pause before you ask" }, { left: [".gh-old .gh-copy"], right: [".gh-new"] }],
  "scrolling-read-list": [{ heading: "Call review", items: ["Listen back", "Find the objection", "Rewrite the question", "Practice again"] },
    { items: [0, 1, 2, 3].map((i) => `.gh-line-${i}`) }],
  "channel-signal-rows": [{ items: ["Email follow up", "Discovery calls", "Text messages", "Referrals"] },
    { items: [0, 1, 2, 3].map((i) => `.gh-tile-${i} .gh-copy`) }],
  "score-rollover": [{ leftTeam: "New setters", leftScore: "fourteen", rightTeam: "Closer team", rightScore: "twenty seven" },
    { leftTeam: [".gh-left .gh-copy"], leftScore: [".gh-left .gh-number"], rightTeam: [".gh-right .gh-copy"], rightScore: [".gh-right .gh-number"] }],
  "flap-state-change": [{ heading: "Delivery", left: "Keep talking", right: "Wait for the answer" }, { left: [".gh-old .gh-copy"], right: [".gh-new .gh-copy"] }],
  "fold-checklist": [{ heading: "Before the call", items: ["Check their goals", "Read your notes", "Pick a question", "Mute your phone"] },
    { items: [0, 1, 2, 3].map((i) => `.gh-row-${i} .gh-copy`) }],
  "actions-to-principle": [{ examples: ["Ask for a date", "Send the invite", "Confirm the agenda"], principle: "Own the next step" },
    { examples: [0, 1, 2].map((i) => `.gh-example-${i} .gh-copy`), principle: [".gh-rule .gh-copy"] }],
  "contracting-share": [{ before: "forty percent", after: "12.5%", label: "Leads we lost to follow up" }, { before: [".gh-before"], after: [".gh-after"], label: [".gh-metric"] }],
  "advice-imprint": [{ heading: "Discovery", quote: "Ask before you pitch" }, { quote: [".gh-copy"] }],
  "underlined-actions": [{ stages: ["Review the script", "Practice the question", "Book a follow up", "Send a quick recap"] },
    { stages: [0, 1, 2, 3].map((i) => `.gh-note-${i} .gh-copy`) }],
  "rising-stat": [{ value: "forty two", context: "Actual calls booked" }, { value: [".gh-number"], context: [".gh-copy"] }],
  "pinned-actions": [{ stages: ["Listen to the call", "Mark the objection", "Rewrite the response", "Practice the turn"] },
    { stages: [0, 1, 2, 3].map((i) => `.gh-pin-row-${i} .gh-copy`) }],
  "obstacle-reassurance": [{ obstacle: "Making the first cold call", reassurance: "You can handle the silence" },
    { obstacle: [".gh-obstacle"], reassurance: [".gh-stamp .gh-copy"] }],
  "pull-quote-unmask": [{ quote: "What would you need to hear before we can move forward" }, { quote: [".gh-row-0 .gh-copy"] }],
};

const inventory = {
  "swiss-grid": "signal-slab-overprint book-artifact-label knife-list-badges modules-programme ruled-rows bleeding-bar minute-grid idea-1 idea-2 idea-3 idea-4 idea-5 idea-6",
  "caption-news": "sting-bottom-band doc-book-cover lit-grid-apps ruled-list-basics idea-1 idea-2 idea-3 idea-4 idea-5",
  "news-package": "doc-cover-fly-stamp flap-board-on-off check-rows-off accent-cards-bracket threshold-schematic proportion-bar-cells idea-1 idea-2 idea-3 idea-4 idea-5",
  telestrator: "freeze-ghost-phone-in-hand board-book-cover-tactics stamp-simple-advice board-phone-notifications freeze-app-icon-future-path board-numbered-rows-icons split-dual-angle-freeze freeze-space-zone-behind idea-1 idea-2 idea-3 idea-4 idea-5 idea-6",
  "halftone-dossier": "scene-mugshot-phone-eyes frame-pinned-print-label prop-halftone-numeral scene-night-notifications scene-evidence-board scene-mountain-verdict scene-day-cells-bloom idea-1 idea-2 idea-3 idea-4 idea-5 idea-6",
};

function input(type, overrides = {}) {
  const values = { ...cases[type][0], ...overrides }, words = [], pick = { type };
  function range(phrase) {
    const from = words.length;
    for (const text of phrase.split(/\s+/)) {
      const start = Math.round((3 + words.length * 0.225) * 1000) / 1000;
      words.push({ text, start, end: start + 0.19 });
    }
    return { from, to: words.length - 1 };
  }
  for (const [name, slot] of Object.entries(batch[type].slots)) {
    const value = values[name];
    if (value == null) continue;
    pick[name] = slot.kind === "label" ? value : slot.repeat ? value.map(range) : range(value);
  }
  return { values, words, pick };
}

function ground(type, overrides) {
  const { words, pick } = input(type, overrides);
  return groundCard(pick, type, words);
}

function render(type, overrides) {
  const grounded = ground(type, overrides);
  assert.ok(grounded, `${type} ${JSON.stringify(overrides)}`);
  const o = { ...grounded, id: `test-${type}`, place: { x: 180, y: 200, scale: 1 } };
  const calls = [];
  const tl = Object.fromEntries(["fromTo", "to", "set"].map((method) => [method, (...args) => calls.push({ method, args })]));
  new Function("tl", proTimeline([o]))(tl);
  return { ...renderProOverlay(o), o, calls };
}

const callFor = ({ o, calls }, selector, at) => calls.find(({ args }) =>
  args[0] === `#${o.id} ${selector}` && (at === undefined || args.at(-1) === at));
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
const cardText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("triage accounts for all sixty source elements and matches each card's MIT provenance", () => {
  const ids = Object.entries(inventory).flatMap(([recipe, names]) => names.split(" ").map((name) => `${recipe}/${name}`));
  const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/ge-triage-h.json", import.meta.url)));
  assert.equal(ids.length, 60);
  assert.deepEqual(triage.map(({ id }) => id), ids);
  assert.equal(new Set(ids).size, 60);
  const license = fs.readFileSync(new URL("../src/pro-cards/GHOST-EDITOR-LICENSE.md", import.meta.url), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 kurbaitaev/);
  assert.match(license, /Copyright \(c\) 2026 LemoLab/);
  for (const { id, outcome, type, reason } of triage) {
    assert.ok(["new", "variant", "merged", "duplicate", "deferred", "unfit", "cut"].includes(outcome), id);
    assert.ok(reason.length > 20 && !reason.includes("\n"), id);
    if (outcome === "unfit") assert.equal(type, undefined, id);
    else if (outcome === "deferred") assert.ok(type && !CARDS[type], id);
    else if (outcome === "duplicate") assert.ok(CARDS[type] && !batch[type], id);
    // Cut at merge: the card was built here, then deliberately dropped from this lane. habits-to-cut survives
    // in CARDS (ge-c kept its own build of the same meaning), so check this lane's own batch, not the registry.
    else if (outcome === "cut") { assert.ok(type && !batch[type], id); assert.match(reason, /^cut at merge:/, id); }
    else assert.ok(batch[type]?.source.split(",").includes(`ghost-editor:${id}`), id);
  }
  assert.ok(triage.filter(({ outcome }) => outcome === "new").length <= 8);
  for (const [type, def] of Object.entries(batch)) {
    const sources = triage.filter((entry) => entry.type === type);
    assert.equal(sources.filter(({ outcome }) => outcome === (def.variantOf ? "variant" : "new")).length, 1, type);
    assert.deepEqual(def.source.split(",").sort(), sources.map(({ id }) => `ghost-editor:${id}`).sort(), type);
  }
});

test("all cards register, preserve root hints and slots, and fit safe placement", () => {
  assert.deepEqual(Object.keys(batch), Object.keys(cases));
  const frame = { measured: true, W: 1080, H: 1920, head: { x: 310, y: 870, w: 440, h: 440 } };
  const zone = zoneFor(), prompt = proPrompt(input("topic-slab-rise").words);
  for (const [type, def] of Object.entries(batch)) {
    assert.equal(CARDS[type], def);
    assert.ok(def.tags.length >= 1 && def.tags.length <= 3 && def.tags.every((tag) => TAG_WORDS.includes(tag)), type);
    const root = CARDS[rootOf(type)];
    const { values, words, pick } = input(type);
    const selected = groundProOverlay({ ...pick, type: rootOf(type), design: type }, words);
    assert.equal(selected?.type, type);
    assert.equal(def.hint, root.hint);
    assert.equal(prompt.split("\n").filter((line) => line.startsWith(`${type} `)).length, def.variantOf ? 0 : 1, type);
    for (const [name, slot] of Object.entries(def.slots)) {
      assert.deepEqual(
        [slot.kind, slot.repeat, slot.optional],
        [root.slots[name].kind, root.slots[name].repeat, root.slots[name].optional],
        `${type}/${name}`,
      );
      assert.deepEqual(selected.slots[name].map(({ text }) => text), slot.repeat ? values[name] : [values[name]], `${type}/${name}`);
    }
    assert.deepEqual(selected.reveals, selected.phrases.map(({ from }) => words[from].start));
    const place = placeProOverlay(selected, frame);
    assert.ok(place, type);
    if (def.fullscreen) {
      assert.deepEqual(proSize(selected), { w: 1080, h: 1920 });
      assert.match(def.css, /padding:200px 180px 320px/);
      continue;
    }
    const { x, y, w, h } = place;
    assert.ok(x >= zone.left && x + w <= rightLimit(zone, y, y + h), type);
    assert.ok(y >= zone.top && y + h <= zone.bottom && y + h < frame.head.y - 56, type);
    const slots = Object.fromEntries(Object.entries(def.slots).map(([name, slot]) => [name,
      Array.from({ length: slot.repeat?.[1] || 1 }, () => ({
        text: name === "total" ? "60 minutes" : selected.slots[name][0].text,
        lines: Array(slot.maxLines).fill("Word"),
      }))]));
    const worst = proSize({ ...selected, slots });
    assert.ok(worst.w <= 720 && worst.h <= 560, `${type} max ${worst.w}x${worst.h}`);
  }
});

test("all copy uses the authored size and rejects invented, over-wide and over-length ranges", () => {
  const twelveLetterWord = "Consultation";
  assert.equal(twelveLetterWord.length, 12);
  for (const [type, def] of Object.entries(batch)) {
    const { pick, words } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      const key = `${type}/${name}`;
      if (slot.kind === "label") {
        assert.ok(slot.size >= 28);
        assert.equal(ground(type, { [name]: "Stage 5" }), null, key);
        assert.equal(ground(type, { [name]: "These are five separate words" }), null, key);
        assert.ok(ground(type, { [name]: null }), key);
        continue;
      }
      assert.ok(slot.size >= 40, key);
      assert.deepEqual(proTextLines(slot.size >= 96 ? "Intelligible" : twelveLetterWord, slot),
        [slot.size >= 96 ? "Intelligible" : twelveLetterWord], key);
      const each = (text) => slot.repeat ? Array(slot.repeat[0]).fill(text) : text;
      if (!slot.validate) assert.ok(ground(type, { [name]: each(twelveLetterWord) }), key);
      else assert.equal(ground(type, { [name]: each(twelveLetterWord) }), null, key);
      assert.equal(ground(type, { [name]: each("W".repeat(slot.maxChars)) }), null, key);
      assert.equal(ground(type, { [name]: each("a".repeat(slot.maxChars + 1)) }), null, key);
      assert.equal(groundCard({ ...pick, [name]: slot.repeat ? Array(slot.repeat[0]).fill("Invented copy") : "Invented copy" }, type, words), null, key);
      const original = slot.repeat ? pick[name][0] : pick[name];
      const spoofed = { ...original, text: "Invented copy" };
      const spoofedSlot = slot.repeat ? [spoofed, ...pick[name].slice(1)] : spoofed;
      assert.equal(groundCard({ ...pick, [name]: spoofedSlot }, type, words)?.slots[name][0].text,
        words.slice(original.from, original.to + 1).map(({ text }) => text).join(" "), key);
    }
  }
});

test("every spoken slot writes on its own cue and renderers escape exact copy", () => {
  for (const [type, def] of Object.entries(batch)) {
    const r = render(type), visible = cardText(r.html);
    assert.deepEqual(render(type).calls.map(({ args }) => [args[0], args.at(-1)]),
      r.calls.map(({ args }) => [args[0], args.at(-1)]), type);
    for (const [name, selectors] of Object.entries(cases[type][1])) {
      const items = r.o.slots[name];
      assert.equal(items.length, selectors.length, name);
      for (const [i, item] of items.entries()) {
        assert.ok(visible.includes(escape(item.text)), `${type} lost ${item.text}`);
        const cue = callFor(r, selectors[i], item.at);
        assert.equal(cue?.method, "fromTo", `${type}/${name} cue`);
        const [, from, to] = cue.args;
        assert.equal(from.opacity, 0, `${type}/${name} starts hidden`);
        assert.equal(to.opacity, 1);
        assert.equal(to.duration, PRO_MOTION.enter);
        assert.equal(to.immediateRender, false);
      }
    }
    for (const [name, slot] of Object.entries(def.slots).filter(([, slot]) => !slot.validate)) {
      const value = "<&>'";
      const escaped = render(type, { [name]: slot.repeat ? Array(slot.repeat[0]).fill(value) : value });
      assert.ok(escaped.html.includes("&lt;&amp;&gt;&#39;"), `${type}/${name}`);
      assert.ok(!escaped.html.includes(value), `${type}/${name}`);
    }
    assert.deepEqual((visible.match(/\d+(?:\.\d+)?/g) || []).sort(),
      (r.o.phrases.map(({ text }) => text).join(" ").match(/\d+(?:\.\d+)?/g) || []).sort(), type);
  }
});

test("CSS and inline graphics use only scoped selectors, house palette, and house fonts", () => {
  const palette = ["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"];
  for (const [type, { css }] of Object.entries(batch)) {
    const { html, calls } = render(type);
    const text = css + html + JSON.stringify(calls.slice(1, -1));
    assert.doesNotMatch(css + html, /(?:<img|url\(|gradient\(|blur\(|@font-face|<script)/i, type);
    assert.doesNotMatch(css, /(?:^|[};])\s*[^{}]*\b(?:animation|transition)\s*:/m, type);
    for (const color of text.match(/#[0-9A-F]{6}\b/g) || []) assert.ok(palette.includes(color), `${type} ${color}`);
    for (const rule of css.matchAll(/(?:^|})\s*([^}]+?)\s*\{/g)) {
      for (const selector of rule[1].split(",")) assert.match(selector.trim(), new RegExp(`^\\.pro-${type}(?:$| )`));
    }
    const fonts = [...css.matchAll(/font:\s*[^;]+?"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(fonts.length && fonts.every((font) => ["Inter", "Anton"].includes(font)), type);
    for (const { method, args } of calls.slice(1, -1)) {
      const props = method === "fromTo" ? args[2] : args[1];
      if (method !== "set") assert.ok([PRO_MOTION.enter, PRO_MOTION.state].includes(props.duration), type);
      assert.ok(!("rotation" in props), type);
    }
  }
});

test("measured graphics reject invalid quantities and only draw the earned measurements", () => {
  for (const bad of ["10 to 12%", "-4%", "9 or 10 percent", "101%", "forty and five percent"]) {
    assert.equal(ground("contracting-share", { before: bad }), null);
  }
  assert.equal(ground("contracting-share", { after: "forty percent" }), null);
  assert.equal(ground("contracting-share", { after: "41%" }), null);
  assert.equal(ground("score-rollover", { leftScore: "50%" }), null);
  assert.equal(ground("rising-stat", { value: "eleven or twelve" }), null);

  const share = render("contracting-share");
  assert.equal(callFor(share, ".gh-fill").args[2].scaleX, 0.4);
  assert.equal(callFor(share, ".gh-fill", share.o.slots.after[0].at).args[2].scaleX, 0.125);
  // capacity-reclaim was cut at merge (see ge-triage-h.json), taking its measurement checks with it.
});

test("state changes wait for the trigger and the cut list releases its wells in order", () => {
  // habits-to-cut (lane h's own build) and target-crossing were cut at merge (see ge-triage-h.json).
  const synthesis = render("actions-to-principle");
  assert.equal(callFor(synthesis, ".gh-draw").args.at(-1), synthesis.o.slots.principle[0].at);
  const fold = render("fold-checklist");
  assert.equal(callFor(fold, ".gh-row-1 .gh-draw").args.at(-1), fold.o.slots.items[1].at);
});
