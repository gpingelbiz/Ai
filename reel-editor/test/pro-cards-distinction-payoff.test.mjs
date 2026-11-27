import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { CARDS } from "../src/pro-cards/distinction-payoff.mjs";
import { CARDS as registry } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, proSize, PRO_RECTS, PRO_MOTION, PRO_RULES, placeProOverlay, budgetProOverlays, proPrompt } from "../src/pro.mjs";
import { renderProOverlay, proCSS, proTimeline } from "../src/pro-render.mjs";

const cases = {
  "do-dont": { family: "distinction", slots: { dont: "Five sentences no pause", do: "One line then wait" } },
  "myth-truth": { family: "distinction", slots: { myth: "More words close more deals", truth: "One sentence then let them talk" } },
  "before-after": { family: "distinction", slots: { before: "Are you trying to level up", after: "Because you registered" } },
  thumbs: { family: "distinction", slots: { down: "Forcing it", up: "Calling back later" } },
  poll: { family: "distinction", slots: { first: "Ours has more modules", second: "What did you need instead" } },
  signpost: { family: "distinction", slots: { left: "Push harder", right: "Call back later" } },
  venn: { family: "distinction", slots: { left: "What you say", right: "What they hear" } },
  rule: { family: "payoff", slots: { rule: "Understand before you respond" } },
  "tip-badge": { family: "payoff", slots: { tip: "Two pushbacks let it go" } },
  quote: { family: "payoff", slots: { quote: "Slow down at the start to speed up at the end" } },
  "takeaway-banner": { family: "payoff", slots: { takeaway: "Write this down one sentence then pause" } },
};

function fixture(type, phrases = cases[type].slots) {
  const words = [], slots = {};
  for (const [name, phrase] of Object.entries(phrases)) {
    const from = words.length;
    for (const text of phrase.split(" ")) {
      const start = Math.round((3 + words.length * 0.19) * 1000) / 1000;
      words.push({ text, start, end: Math.round((start + 0.15) * 1000) / 1000 });
    }
    slots[name] = { from, to: words.length - 1 };
  }
  const pick = { type, slots }, overlay = groundCard(pick, type, words);
  return { words, pick, overlay };
}

// Execute the generated GSAP calls to check actual selectors, times and tween parameters.
function events(timeline) {
  const calls = [], enter = () => {}, state = () => {}, exit = () => {};
  const tl = {
    fromTo(target, from, to, at) { calls.push({ method: "fromTo", target, from, to, at }); return tl; },
    to(target, to, at) { calls.push({ method: "to", target, to, at }); return tl; },
  };
  vm.runInNewContext(timeline, { tl, proEnter: enter, proState: state, proExit: exit });
  return { calls, enter, state, exit };
}

test("the batch registers exactly the approved distinction and payoff types", () => {
  assert.deepEqual(Object.keys(CARDS).sort(), Object.keys(cases).sort());
  for (const [type, def] of Object.entries(CARDS)) {
    assert.equal(registry[type], def);
    assert.equal(def.family, cases[type].family);
    assert.equal(typeof def.hint, "string");
    assert.ok(def.hint.length && !def.hint.includes("\n"));
    assert.ok(["obsidian", "bone", "bare"].includes(def.surface));
    assert.ok(Object.values(def.slots).every((s) => s.kind === "spoken"));
    assert.deepEqual(Object.keys(def.slots), [...(type === "tip-badge" ? ["number"] : []), ...Object.keys(cases[type].slots)]);
    assert.equal(typeof def.render, "function");
    for (const rule of def.css.split("}").map((s) => s.trim()).filter(Boolean)) {
      for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) assert.ok(selector.trim().startsWith(`.pro-${type}`), selector);
    }
    assert.doesNotMatch(def.css, /glow|blur\(|text-shadow|Caveat|emoji/i);
    assert.ok(proCSS().includes(def.css));
  }
});

for (const type of Object.keys(cases)) {
  test(`${type} grounds exact ranges, fits its slot and reveals every spoken item`, () => {
    const { words, pick, overlay } = fixture(type), def = CARDS[type];
    assert.ok(overlay, `${type} must fit at the promised type size`);
    // The shared router still aliases "quote" to correction before consulting the registry.
    if (type !== "quote") assert.deepEqual(groundProOverlay(pick, words), overlay);
    assert.equal(overlay.card, true);
    assert.deepEqual(proSize(overlay), def.size);
    const frame = { measured: true, W: 1080, H: 1920, head: { x: 0, y: 1500, w: 100, h: 100 } };
    const place = placeProOverlay(overlay, frame);
    assert.ok(place);
    if (def.fullscreen) {
      assert.equal(type, "takeaway-banner");
      assert.equal(place.slot, "full");
      assert.equal(def.size.w, 1080);
    } else {
      assert.ok(PRO_RECTS.some((r) => def.size.w <= r.w && def.size.h <= r.h));
      assert.equal(overlay.fullscreen, undefined);
    }
    const placed = { ...overlay, id: "pro-fixture", place };
    const r = renderProOverlay(placed), { calls, enter, state, exit } = events(r.timeline);
    assert.match(r.html, new RegExp(`pro-overlay pro-${type}`));
    assert.ok(r.html.includes(`width:${def.size.w}px;height:${def.size.h}px`));
    const spoken = Object.entries(overlay.slots).flatMap(([name, items]) => items.map((item) => ({ name, ...item })));
    const writes = calls.filter((c) => c.method === "fromTo" && c.target !== "#pro-fixture");
    assert.equal(writes.length, spoken.length);
    for (let i = 0; i < spoken.length; i++) {
      const item = spoken[i], span = pick.slots[item.name];
      assert.equal(item.text, words.slice(span.from, span.to + 1).map((w) => w.text).join(" "));
      assert.equal(overlay.reveals[i], words[span.from].start);
      assert.ok(r.html.includes(item.lines.join("<br>")));
      assert.equal(writes[i].at, overlay.reveals[i]);
      assert.equal(writes[i].from.opacity, 0);
      assert.equal(writes[i].to.opacity, 1);
      assert.equal(writes[i].from.clipPath, "inset(0 100% 0 0)");
      assert.equal(writes[i].to.clipPath, "inset(0 0% 0 0)");
      assert.equal(writes[i].to.duration, PRO_MOTION.enter);
      assert.equal(writes[i].to.ease, enter);
      assert.equal(writes[i].to.immediateRender, false);
      assert.ok(writes[i].target.startsWith("#pro-fixture .dp-"));
      const cls = writes[i].target.split(" ").at(-1).slice(1);
      assert.match(r.html, new RegExp(`class="[^"]*\\b${cls}\\b`));
    }
    const changes = calls.filter((c) => c.method === "to" && c.target !== "#pro-fixture");
    for (const change of changes) {
      assert.equal(change.to.duration, PRO_MOTION.state);
      assert.equal(change.to.ease, state);
      assert.equal(change.at, overlay.reveals.at(-1));
    }
    assert.equal(calls[0].at, overlay.start);
    assert.equal(calls[0].from.y, 16);
    assert.equal(calls.at(-1).to.duration, PRO_MOTION.exit);
    assert.equal(calls.at(-1).to.ease, exit);
    assert.ok(Math.abs(calls.at(-1).at - overlay.complete - PRO_RULES.hold) < 0.001);
    assert.doesNotMatch(r.html.replace(/<[^>]*>/g, ""), /\d/);
    new vm.Script(proTimeline([placed]));
  });

  test(`${type} refuses missing, oversized and out-of-order spoken slots`, () => {
    const { pick, words } = fixture(type), names = Object.keys(cases[type].slots);
    const missing = structuredClone(pick);
    delete missing.slots[names[0]];
    assert.equal(groundCard(missing, type, words), null);
    const oversized = words.map((w) => ({ ...w }));
    oversized[0].text = "W".repeat(200);
    assert.equal(groundCard(pick, type, oversized), null);
    const outside = structuredClone(pick);
    outside.slots[names[0]].to = words.length;
    assert.equal(groundCard(outside, type, words), null);
    if (names.length > 1) {
      const reversed = structuredClone(pick);
      [reversed.slots[names[0]], reversed.slots[names[1]]] = [reversed.slots[names[1]], reversed.slots[names[0]]];
      assert.equal(groundCard(reversed, type, words), null);
    }
  });
}

test("tip badge defaults to TIP and only reveals a supplied spoken number", () => {
  for (const number of [null, "2", "two"]) {
    const phrases = { ...(number ? { number } : {}), tip: "Let it go" };
    const { overlay, words } = fixture("tip-badge", phrases);
    assert.ok(overlay);
    const r = renderProOverlay({ ...overlay, id: "tip", place: { x: 120, y: 288 } });
    assert.match(r.html, />TIP</);
    assert.equal(r.html.includes('class="dp-number"'), !!number);
    const writes = events(r.timeline).calls.filter((c) => c.target !== "#tip");
    assert.equal(writes.length, number ? 2 : 1);
    assert.deepEqual(writes.map((c) => c.at), overlay.reveals);
    assert.equal(overlay.slots.tip[0].at, words[number ? 1 : 0].start);
    if (number) assert.ok(r.html.includes(`>${number}</div>`));
    else assert.doesNotMatch(r.html.replace(/<[^>]*>/g, ""), /\d/);
  }
});

test("numbers in spoken copy stay verbatim; headings and attribution stay fixed", () => {
  for (const type of ["rule", "quote", "takeaway-banner"]) {
    const name = Object.keys(cases[type].slots)[0];
    const { overlay } = fixture(type, { [name]: "Wait 2 minutes" });
    const r = renderProOverlay({ ...overlay, id: "spoken", place: { x: 0, y: 0 } });
    assert.match(r.html, /Wait 2 minutes/);
    if (type === "rule") assert.match(r.html, />Rule</);
    if (type === "quote") assert.match(r.html, />Greg Pingel</);
    assert.equal((r.html.replace(/<[^>]*>/g, "").match(/2/g) || []).length, 1);
  }
});

test("all renderers escape spoken HTML and thumbs use SVG paths", () => {
  for (const type of Object.keys(cases)) {
    const phrases = Object.fromEntries(Object.keys(cases[type].slots).map((name) => [name, "<b>&"]));
    const { overlay } = fixture(type, phrases);
    assert.ok(overlay);
    const r = renderProOverlay({ ...overlay, id: "escaped", place: { x: 120, y: 288 } });
    assert.match(r.html, /&lt;b&gt;&amp;/);
    assert.doesNotMatch(r.html, /<b>/);
    if (type === "thumbs") {
      assert.equal((r.html.match(/<svg /g) || []).length, 2);
      assert.match(r.html, /rotate\(180 32 32\)/);
      assert.match(r.html, /<path d=/);
      assert.doesNotMatch(r.html, /👍|👎/);
    }
  }
});

test("the full-width strip uses bare fullscreen placement and obeys its reading budget", () => {
  const { overlay } = fixture("takeaway-banner", { takeaway: "Then pause" });
  assert.equal(CARDS["takeaway-banner"].surface, "bare");
  const r = renderProOverlay({ ...overlay, id: "banner", place: { x: 0, y: 0 } });
  assert.match(r.html, /pro-bare pro-full/);
  assert.match(CARDS["takeaway-banner"].css, /left:150px;top:170px;width:780px/, "inside the 150 px side strips (the shared safe zone)");
  assert.match(CARDS["takeaway-banner"].css, /\.pro-takeaway-banner\.pro-full \{ padding:0;background:none;box-shadow:none/);
  assert.equal(budgetProOverlays([overlay], { duration: 30 }).length, 1);
  assert.equal(budgetProOverlays([{ ...overlay, end: overlay.start + 4.501 }], { duration: 30 }).length, 0);
  assert.match(proPrompt(fixture("rule").words), /takeaway-banner.*FULL SCREEN/);
});
