import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { CARDS } from "../src/pro-cards/distinction-2.mjs";
import { CARDS as registry } from "../src/pro-cards/index.mjs";
import { CARDS as core } from "../src/pro-cards/core.mjs";
import { CARDS as distinctionPayoff } from "../src/pro-cards/distinction-payoff.mjs";
import { CARDS as procedureProof } from "../src/pro-cards/procedure-proof.mjs";
import { CARDS as conversation } from "../src/pro-cards/conversation.mjs";
import { CARDS as warningEmphasisFull } from "../src/pro-cards/warning-emphasis-full.mjs";
import { groundCard, groundProOverlay, proSize, proPrompt, proTextWidth, placeProOverlay, PRO_RECTS, PRO_MOTION } from "../src/pro.mjs";
import { renderProOverlay, proCSS, proTimeline } from "../src/pro-render.mjs";

const cases = {
  "versus-split": { weaker: "Pitch harder", better: "Listen first" },
  "scale-balance": { first: "More calls", second: "Better calls" },
  "toggle-switch": { old: "Talk until they agree", new: "Ask then pause" },
  spectrum: { left: "Pressure", right: "Permission", verdict: "Use permission", pick: "Right" },
  "you-say-they-hear": { youSay: "I can help you", theyHear: "You want my money" },
  "true-false": { statement: "More words win that is false", verdict: "False" },
  "verdict-stamp": { phrase: "Keep that question", verdict: "Keep" },
  "rookie-pro": { rookie: "Fills the silence", pro: "Lets them think" },
  "word-swap": { before: "You", word: "should", after: "try this", replacement: "could" },
  "either-or": { first: "Push again", second: "Let it go" },
};

function fixture(type, values = cases[type]) {
  const words = [], slots = {};
  for (const [name, def] of Object.entries(CARDS[type].slots)) {
    const value = values[name];
    if (value == null) continue;
    if (def.kind === "label") { slots[name] = value; continue; }
    const from = words.length;
    for (const text of value.split(" ")) {
      const start = +(3 + words.length * 0.31).toFixed(3);
      words.push({ text, start, end: +(start + 0.24).toFixed(3) });
    }
    slots[name] = { from, to: words.length - 1 };
  }
  const pick = { type, slots }, overlay = groundCard(pick, type, words);
  return { words, pick, overlay };
}

function placed(overlay) {
  assert.ok(overlay, "fixture must ground");
  return { ...overlay, id: "distinction-test", place: { x: 120, y: 288, scale: 1 } };
}

// Run emitted JavaScript, not a text approximation of GSAP calls.
function events(overlay) {
  const calls = [], enter = () => {}, state = () => {}, exit = () => {};
  const tl = {
    fromTo(target, from, to, at) { calls.push({ method: "fromTo", target, from, to, at }); return tl; },
    to(target, to, at) { calls.push({ method: "to", target, to, at }); return tl; },
    set(target, to, at) { calls.push({ method: "set", target, to, at }); return tl; },
  };
  vm.runInNewContext(renderProOverlay(placed(overlay)).timeline, { tl, proEnter: enter, proState: state, proExit: exit });
  return { calls, enter, state, exit };
}

const visible = (html) => html.replace(/<svg\b[\s\S]*?<\/svg>/g, "").replace(/<br>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const eventFor = (calls, selector) => calls.find((event) => event.target === `#distinction-test ${selector}`);
const body = (overlay) => renderProOverlay(placed(overlay)).html.replace(/^<div[^>]+>/, "").replace(/<\/div>$/, "");

test("exactly ten distinction cards register without replacing any existing definition", () => {
  assert.deepEqual(Object.keys(CARDS), Object.keys(cases));
  const previous = { ...core, ...distinctionPayoff, ...procedureProof, ...conversation, ...warningEmphasisFull };
  for (const [type, def] of Object.entries(previous)) assert.equal(registry[type], def);
  assert.ok(Object.keys(registry).length >= Object.keys(previous).length + 10, "the batch adds its ten cards (other batches may add more)");
  for (const [type, def] of Object.entries(CARDS)) {
    assert.equal(registry[type], def);
    assert.equal(def.family, "distinction");
    assert.ok(def.hint.length > 30 && !def.hint.includes("\n"));
    assert.ok(["bare", "bone", "obsidian"].includes(def.surface));
    assert.ok(PRO_RECTS.some((rect) => def.size.w <= rect.w && def.size.h <= rect.h));
    assert.equal(def.fullscreen, undefined);
    assert.ok(proCSS().includes(def.css));
    for (const rule of def.css.split("}").filter((rule) => rule.trim())) {
      for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) assert.ok(selector.trim().startsWith(`.pro-${type}`));
    }
    for (const hex of def.css.match(/#[a-f\d]{6}/gi) || []) assert.ok(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"].includes(hex));
    for (const font of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font[1]));
    assert.doesNotMatch(def.css, /glow|blur\(|box-shadow|text-shadow|url\(|@keyframes|animation:/i);
  }
});

for (const [type, values] of Object.entries(cases)) {
  test(`${type} grounds exact copy, fits placement and writes each spoken slot at its own time`, () => {
    const { overlay, words, pick } = fixture(type), def = CARDS[type];
    assert.ok(overlay);
    // Named design: since the 2026-11-28 ghost-editor import some of these types have more designs, and the planner's pick may land on one.
    const { group, ...designed } = groundProOverlay({ ...pick, design: pick.type }, words) || {};
    assert.deepEqual(designed, overlay);
    assert.deepEqual(proSize(overlay), def.size);
    assert.ok(placeProOverlay(overlay, { measured: true, W: 1080, H: 1920, head: { x: 0, y: 1500, w: 100, h: 100 } }));
    const r = renderProOverlay(placed(overlay)), { calls, enter, state, exit } = events(overlay);
    const writes = calls.filter((event) => event.target !== "#distinction-test" && event.to.clipPath != null);
    assert.equal(writes.length, overlay.phrases.length);
    for (const [i, phrase] of overlay.phrases.entries()) {
      assert.equal(phrase.text, words.slice(phrase.from, phrase.to + 1).map((w) => w.text).join(" "));
      assert.ok(visible(r.html).includes(phrase.text));
      const event = writes[i];
      assert.equal(event.at, phrase.at);
      assert.equal(event.at, overlay.reveals[i]);
      assert.equal(event.from.opacity, 0);
      assert.equal(event.to.opacity, 1);
      assert.equal(event.from.clipPath, "inset(0 100% 0 0)");
      assert.equal(event.to.clipPath, "inset(0 0% 0 0)");
      assert.equal(event.to.duration, PRO_MOTION.enter);
      assert.equal(event.to.ease, enter);
      const cls = event.target.split(" ").at(-1).slice(1);
      assert.match(r.html, new RegExp(`class="[^"]*\\b${cls}\\b`));
      const initial = def.css.split("}").find((rule) => new RegExp(`\\.${cls}(?:\\s|,)`).test(rule) && rule.includes("opacity:0"));
      assert.ok(initial, `${type}.${cls} starts hidden`);
    }
    for (const event of calls.filter((event) => event.target !== "#distinction-test" && event.method !== "set")) {
      assert.equal(event.to.immediateRender, false);
      assert.ok(Number.isFinite(event.at));
      assert.ok(event.at >= overlay.start && event.at + event.to.duration < overlay.end - PRO_MOTION.exit);
      assert.equal(event.to.duration, event.to.clipPath ? PRO_MOTION.enter : PRO_MOTION.state);
      assert.equal(event.to.ease, event.to.clipPath ? enter : state);
    }
    assert.equal(calls[0].at, overlay.start);
    assert.equal(calls[0].from.y, 16);
    assert.equal(calls.at(-1).to.ease, exit);
    assert.equal(calls.at(-1).to.duration, PRO_MOTION.exit);
    assert.equal(calls.at(-1).at, +(overlay.end - PRO_MOTION.exit).toFixed(3));
    assert.doesNotMatch(r.timeline, /rotation|repeat|yoyo|onComplete|onUpdate|Math\.random/);
    assert.doesNotMatch(r.html, /<img|<image|[\u{1F300}-\u{1FAFF}]/u);
    new vm.Script(proTimeline([placed(overlay)]));
    assert.deepEqual(renderProOverlay(placed(overlay)), r);
    assert.match(proPrompt(words), new RegExp(`${type}.*\\[distinction\\]`));
  });

  test(`${type} rejects missing, oversized and unordered required spoken ranges`, () => {
    const { words, pick } = fixture(type);
    const names = Object.keys(CARDS[type].slots).filter((name) => CARDS[type].slots[name].kind === "spoken" && !CARDS[type].slots[name].optional);
    for (const name of names) {
      const missing = structuredClone(pick);
      delete missing.slots[name];
      assert.equal(groundCard(missing, type, words), null);
    }
    const huge = structuredClone(words);
    huge[0].text = "W".repeat(200);
    assert.equal(groundCard(pick, type, huge), null);
    const outside = structuredClone(pick);
    outside.slots[names[0]].to = words.length;
    assert.equal(groundCard(outside, type, words), null);
    if (names.length > 1) {
      const reversed = structuredClone(pick);
      [reversed.slots[names[0]], reversed.slots[names[1]]] = [reversed.slots[names[1]], reversed.slots[names[0]]];
      assert.equal(groundCard(reversed, type, words), null);
    }
  });

  test(`${type} escapes spoken markup and displays numbers only from spoken slots`, () => {
    for (const text of ["<b>&", "2"]) {
      const copy = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, CARDS[type].slots[name].kind === "spoken" ? text : value]));
      const { overlay } = fixture(type, copy), r = renderProOverlay(placed(overlay));
      if (text === "<b>&") {
        assert.match(r.html, /&lt;b&gt;&amp;/);
        assert.doesNotMatch(r.html, /<b>/);
      }
      assert.deepEqual(visible(r.html).match(/\d+/g) || [], overlay.phrases.flatMap((p) => p.text.match(/\d+/g) || []));
    }
  });
}

test("the balance tips toward the second pan, keeps text upright and uses only SVG geometry", () => {
  const { overlay } = fixture("scale-balance"), { calls } = events(overlay), html = body(overlay);
  const beam = eventFor(calls, ".d2-beam");
  assert.equal(beam.from.attr.y1, beam.from.attr.y2);
  assert.ok(beam.to.attr.y1 < beam.to.attr.y2);
  assert.equal(beam.at, overlay.reveals[1]);
  assert.equal(eventFor(calls, ".d2-first").to.y, -20);
  assert.equal(eventFor(calls, ".d2-second").to.y, 20);
  assert.equal((html.match(/<svg /g) || []).length, 3);
  const wrapped = fixture("scale-balance", { first: "More practice", second: "Better questions" }).overlay;
  assert.equal(wrapped.slots.first[0].lines.length, 2);
  assert.match(body(wrapped), /class="d2-copy"><span>More<br>practice<\/span>/, "line breaks stay inside one flex child");
});

test("toggle hides the old line exactly when the new line writes and the switch moves", () => {
  const { overlay } = fixture("toggle-switch"), { calls } = events(overlay);
  const hide = calls.find((event) => event.method === "set");
  assert.equal(hide.target, "#distinction-test .d2-old");
  assert.equal(hide.to.visibility, "hidden");
  assert.equal(hide.at, overlay.reveals[1]);
  assert.equal(eventFor(calls, ".d2-new").at, hide.at);
  assert.equal(eventFor(calls, ".d2-knob").at, hide.at);
  assert.equal(eventFor(calls, ".d2-knob").to.x, 44);
  assert.match(body(overlay), />Old way<.*>New way</);
});

test("spectrum can choose either end, with or without a third spoken verdict", () => {
  for (const pick of ["Left", "Right"]) {
    for (const verdict of [undefined, "Choose this"]) {
      const { overlay } = fixture("spectrum", { left: "Pressure", right: "Permission", pick, verdict });
      const { calls } = events(overlay), marker = eventFor(calls, ".d2-marker");
      assert.equal(marker.to.left, pick === "Left" ? "0%" : "100%");
      assert.equal(marker.at, overlay.reveals.at(-1));
      assert.equal(overlay.phrases.length, verdict ? 3 : 2);
      assert.equal(body(overlay).includes('class="d2-verdict'), !!verdict);
      if (verdict) assert.equal(eventFor(calls, ".d2-verdict").at, marker.at);
      assert.doesNotMatch(visible(body(overlay)), /Left|Right/);
      assert.match(body(overlay), /<linearGradient id="distinction-test-spectrum-gradient">/);
      assert.match(body(overlay), /fill="url\(#distinction-test-spectrum-gradient\)"/);
      const other = renderProOverlay({ ...placed(overlay), id: "another-card" });
      assert.match(other.html, /id="another-card-spectrum-gradient"/);
      assert.doesNotMatch(other.html, /distinction-test-spectrum-gradient/);
    }
  }
});

test("true/false lights only the declared verdict, after Greg completes the judgment", () => {
  for (const verdict of ["True", "False", "true", "FALSE"]) {
    const { overlay } = fixture("true-false", { statement: "That is true", verdict });
    const { calls } = events(overlay), changes = calls.filter((event) => event.to.backgroundColor);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].target, `#distinction-test .d2-${verdict.toLowerCase()}`);
    assert.equal(changes[0].at, overlay.slots.statement[0].end);
    assert.equal(changes[0].to.backgroundColor, "#C8A24B");
    assert.match(body(overlay), />TRUE<.*>FALSE</);
  }
});

test("all four stamp labels land after the phrase at a fixed CSS tilt", () => {
  for (const verdict of ["Approved", "Rejected", "Keep", "Cut"]) {
    const { overlay } = fixture("verdict-stamp", { phrase: "Keep that", verdict });
    const stamp = eventFor(events(overlay).calls, ".d2-stamp");
    assert.equal(stamp.at, overlay.slots.phrase[0].end);
    assert.equal(stamp.from.y, -12);
    assert.equal(stamp.to.y, 0);
    assert.equal(stamp.from.scale, 1.04);
    assert.equal(stamp.to.scale, 1);
    assert.match(body(overlay), new RegExp(`>${verdict}<`));
    assert.match(CARDS["verdict-stamp"].css, /transform:rotate\(-7deg\)/);
  }
});

test("restricted labels never print unknown words, digits or injected markup", () => {
  for (const [type, name] of [["spectrum", "pick"], ["true-false", "verdict"], ["verdict-stamp", "verdict"]]) {
    for (const value of ["Maybe", "<b>", "2", "one two three four five"]) {
      const { overlay } = fixture(type, { ...cases[type], [name]: value });
      if (overlay) {
        assert.equal(body(overlay), "");
        assert.equal(events(overlay).calls.length, 2, "only the shared panel timeline remains");
      } else assert.ok(/\d/.test(value) || value.length > CARDS[type].slots[name].maxChars);
    }
  }
});

test("word swap keeps before/after optional and targets only the original word", () => {
  for (const before of [undefined, "You"]) {
    for (const after of [undefined, "try this"]) {
      const { overlay } = fixture("word-swap", { before, word: "should", after, replacement: "could" });
      const { calls } = events(overlay), replacement = eventFor(calls, ".d2-replacement"), strike = eventFor(calls, ".d2-strike path");
      assert.equal(replacement.at, overlay.slots.replacement[0].at);
      assert.equal(replacement.from.y, -12);
      assert.equal(replacement.to.y, 0);
      assert.equal(strike.at, replacement.at);
      assert.equal(strike.from.strokeDashoffset, 1);
      assert.equal(strike.to.strokeDashoffset, 0);
      assert.equal(calls.filter((event) => event.to.clipPath).length, 2 + Number(!!before) + Number(!!after));
      assert.equal(body(overlay).includes('class="d2-before"'), !!before);
      assert.equal(body(overlay).includes('class="d2-after"'), !!after);
      assert.match(body(overlay), /class="d2-target"><span class="d2-word">should<\/span><svg/);
    }
  }
});

test("word swap suppresses multi-word targets or replacements and disjoint original ranges", () => {
  for (const values of [{ word: "do not", replacement: "try" }, { word: "try", replacement: "do not" }]) {
    const { overlay } = fixture("word-swap", values);
    assert.ok(overlay);
    assert.equal(body(overlay), "");
  }
  const { words, pick } = fixture("word-swap");
  const disjoint = structuredClone(pick);
  disjoint.slots.after.from += 1;
  assert.equal(body(groundCard(disjoint, "word-swap", words)), "");
  const overlapping = structuredClone(pick);
  overlapping.slots.word.from = overlapping.slots.before.from;
  assert.equal(groundCard(overlapping, "word-swap", words), null);
});

test("either/or cursor arrives at the second pill before pressing it", () => {
  const { overlay } = fixture("either-or"), { calls } = events(overlay);
  const cursor = calls.filter((event) => event.target.endsWith(" .d2-cursor"));
  assert.equal(cursor.length, 2);
  assert.equal(cursor[0].at, overlay.reveals[1]);
  assert.equal(cursor[0].to.x, 356);
  assert.equal(cursor[1].at, +(cursor[0].at + PRO_MOTION.state).toFixed(3));
  assert.equal(cursor[1].to.scale, 0.9);
  assert.equal(eventFor(calls, ".d2-second").at, cursor[1].at);
  assert.equal(eventFor(calls, ".d2-second").to.backgroundColor, "#C8A24B");
  assert.match(body(overlay), /<svg class="d2-cursor"/);
});

test("grounded multi-line and long-word copy remains within each slot's declared text box", () => {
  for (const [type, def] of Object.entries(CARDS)) {
    for (const [name, slot] of Object.entries(def.slots)) {
      if (slot.kind !== "spoken") continue;
      const samples = ["W".repeat(Math.min(slot.maxChars, 8)), "no ".repeat(Math.floor(slot.maxChars / 3)).trim()];
      for (const sample of samples) {
        // The word-swap semantic guard rightly rejects multiple words in these two slots.
        if (type === "word-swap" && ["word", "replacement"].includes(name) && sample.includes(" ")) continue;
        const { overlay } = fixture(type, { ...cases[type], [name]: sample });
        if (!overlay) continue;
        const item = overlay.slots[name][0];
        assert.ok(item.lines.length <= slot.maxLines);
        for (const line of item.lines) assert.ok(proTextWidth(line, item.fontSize || slot.size) <= slot.width);
        assert.ok(body(overlay).length > 0);
      }
    }
  }
});
