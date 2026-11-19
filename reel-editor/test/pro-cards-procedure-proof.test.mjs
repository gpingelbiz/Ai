import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as BATCH } from "../src/pro-cards/procedure-proof.mjs";
import { CARDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, proSize, PRO_RECTS, PRO_RULES, PRO_MOTION, proPrompt } from "../src/pro.mjs";
import { renderProOverlay, proCSS, proTimeline } from "../src/pro-render.mjs";
import { loadPreset } from "../src/presets.mjs";
import { renderHTML } from "../src/compose.mjs";
import { fixturePlan } from "../scripts/golden.mjs";

const fixtures = {
  checklist: { heading: "Before your call", items: ["Record the role play", "Listen back once", "Slow your opener", "Run it again"] },
  timeline: { heading: "Where you should be", items: ["week three", "week eight"] },
  formula: { parts: ["Question", "Pause", "Listen"], result: "Permission" },
  countdown: { counts: ["three", "two", "one"] },
  ranking: { heading: "What closes the deal", items: ["First understand the belief", "Second ask the question", "Third give the rebuttal"] },
  "percent-ring": { value: "eighty percent", context: "of the call is them talking" },
  bars: { heading: "Reps to get good", items: ["10 calls", "20 calls", "40 calls", "80 calls"] },
  rating: { heading: "Rate your opener", score: "four out of ten" },
  "progress-ring": { instruction: "Two sentences every day", value: "day five", total: "out of eight days" },
  stopwatch: { time: "two to three minutes" },
  "loading-bar": { heading: "Skill loading", states: ["Learn the script", "Do the reps", "eight weeks in"] },
};

function fixture(type, input = fixtures[type]) {
  const words = [], pick = { type };
  for (const [name, slot] of Object.entries(BATCH[type].slots)) {
    if (input[name] == null) continue;
    if (slot.kind === "label") { pick[name] = input[name]; continue; }
    const ranges = (slot.repeat ? input[name] : [input[name]]).map((text) => {
      const from = words.length;
      for (const word of text.split(" ")) {
        const start = 3 + words.length * 0.4;
        words.push({ text: word, start, end: start + 0.3 });
      }
      return { from, to: words.length - 1 };
    });
    pick[name] = slot.repeat ? ranges : ranges[0];
  }
  const o = groundCard(pick, type, words);
  assert.ok(o, `${type}: ${JSON.stringify(input)}`);
  return { words, pick, o: { ...o, id: `test-${type}`, place: { x: 120, y: 288, scale: 1 } } };
}

function render(type, input) {
  const { o } = fixture(type, input);
  const calls = [];
  const tl = {};
  for (const method of ["fromTo", "to", "set"]) tl[method] = (...args) => { calls.push({ method, args }); return tl; };
  new Function("tl", proTimeline([o]))(tl);
  return { ...renderProOverlay(o), calls, o };
}

function visible(html) { return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }

test("batch registers eleven complete procedure and proof cards and grounds their spoken ranges", () => {
  assert.deepEqual(Object.keys(BATCH), Object.keys(fixtures));
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(CARDS[type], def);
    assert.equal(def.family, ["checklist", "timeline", "formula", "countdown", "ranking"].includes(type) ? "procedure" : "proof");
    assert.ok(def.hint.length > 20 && !def.hint.includes("\n"));
    assert.ok(["obsidian", "bone", "bare"].includes(def.surface));
    const { words, pick, o } = fixture(type);
    assert.deepEqual(groundProOverlay(pick, words), groundCard(pick, type, words));
    assert.ok(PRO_RECTS.some((r) => def.size.w <= r.w && def.size.h <= r.h), type);
    assert.deepEqual(proSize(o), def.size);
    assert.deepEqual(o.reveals, o.phrases.map((p) => words[p.from].start));
    assert.equal(o.end, Math.round((o.complete + PRO_RULES.hold + PRO_MOTION.exit) * 1000) / 1000);
    assert.deepEqual(o.phrases.map((p) => p.text), Object.entries(def.slots).filter(([, s]) => s.kind === "spoken").flatMap(([name, s]) => s.repeat ? fixtures[type][name] : fixtures[type][name] == null ? [] : [fixtures[type][name]]));
    for (const slot of Object.values(def.slots)) assert.ok(["label", "spoken"].includes(slot.kind));
  }
});

test("every spoken item writes at its exact reveal, with restrained seekable motion", () => {
  for (const type of Object.keys(BATCH)) {
    const { html, timeline, calls, o } = render(type);
    assert.match(html, new RegExp(`pro-overlay pro-${type}`));
    for (const [name, slot] of Object.entries(BATCH[type].slots)) {
      for (const item of o.slots[name]) {
        assert.ok(visible(html).includes(item.text), `${type}.${name}`);
        if (slot.kind === "spoken") assert.ok(calls.some(({ method, args }) => method === "fromTo" && args[1].opacity === 0 && args[2].opacity === 1 && args[2].duration === 0.233 && typeof args[2].ease === "function" && args[3] === item.at), `${type}.${name} reveal at ${item.at}`);
      }
    }
    assert.doesNotMatch(timeline, /NaN|undefined|repeat:|yoyo:|onUpdate|onComplete|Math\.random|textContent|innerHTML/);
    assert.match(timeline, /duration:0\.167/);
    assert.deepEqual(visible(html).match(/\d+(?:\.\d+)?/g) || [], o.phrases.flatMap((p) => p.text.match(/\d+(?:\.\d+)?/g) || []), `${type} invents no visible digits`);
    assert.ok(calls.filter(({ method }) => method === "fromTo").every(({ args }) => args[2].immediateRender === false));
  }
});

test("repeat limits, label restrictions, missing slots and spoken order are enforced", () => {
  for (const type of Object.keys(BATCH)) {
    const { words, pick } = fixture(type);
    const def = BATCH[type];
    for (const [name, slot] of Object.entries(def.slots)) {
      if (slot.repeat) {
        assert.equal(groundCard({ ...pick, [name]: pick[name].slice(0, slot.repeat[0] - 1) }, type, words), null, `${type}.${name} minimum`);
        assert.equal(groundCard({ ...pick, [name]: Array(slot.repeat[1] + 1).fill(pick[name][0]) }, type, words), null, `${type}.${name} maximum`);
      } else if (!slot.optional) assert.equal(groundCard({ ...pick, [name]: undefined }, type, words), null, `${type}.${name} required`);
      if (slot.kind === "label") {
        for (const text of ["Week 8", "one two three four five"]) assert.equal(groundCard({ ...pick, [name]: text }, type, words), null);
        assert.ok(groundCard({ ...pick, [name]: undefined }, type, words));
      }
    }
    const spoken = Object.entries(def.slots).filter(([, s]) => s.kind === "spoken");
    if (spoken.length > 1) {
      const [name] = spoken.at(-1);
      assert.equal(groundCard({ ...pick, [name]: { from: 0 } }, type, words), null);
    }
  }
  for (const [type, name, text] of [["checklist", "items", "x".repeat(45)], ["stopwatch", "time", "x".repeat(31)]]) {
    const { words, pick } = fixture(type);
    const tooLong = words.map((w) => ({ ...w, text }));
    assert.equal(groundCard(pick, type, tooLong), null, name);
  }
});

test("checklist ticks at each action; timeline progresses without unspoken milestone numbers", () => {
  const checklist = render("checklist");
  assert.equal((checklist.html.match(/class="pp-tick"/g) || []).length, 4);
  assert.match(checklist.html, /<svg[^>]*viewBox="0 0 24 24"/);
  for (let i = 0; i < 4; i++) assert.ok(checklist.calls.some(({ args }) => args[0].endsWith(`.pp-item-${i} .pp-tick`) && args[2].opacity === 1 && args[3] === checklist.o.reveals[i]));
  const rail = render("timeline", { items: ["Now", "Reps", "Listen", "Master"] });
  assert.equal((rail.html.match(/class="pp-node"/g) || []).length, 4);
  assert.equal((rail.html.match(/class="pp-link"/g) || []).length, 3);
  assert.doesNotMatch(visible(rail.html), /\d/);
  assert.ok(rail.calls.some(({ args }) => args[0].endsWith(".pp-item-3 .pp-link") && args[2].scaleX === 1 && args[3] === rail.o.reveals[3]));
});

test("formula supports two or three parts, countdown uses only spoken counts, ranking adds no ranks", () => {
  for (const parts of [["Question", "Pause"], ["Question", "Pause", "Listen"]]) {
    const r = render("formula", { parts, result: "Permission" });
    assert.equal((r.html.match(/class="pp-operator"/g) || []).length, parts.length);
    assert.ok(r.calls.some(({ args }) => args[0].endsWith(".pp-result") && args[3] === r.o.reveals.at(-1)));
  }
  const count = render("countdown", { counts: ["3", "2", "1"] });
  assert.equal(visible(count.html), "3 2 1");
  const ranks = render("ranking", { items: ["Understand the belief", "Ask the question", "Give the rebuttal"] });
  assert.doesNotMatch(visible(ranks.html), /\d/);
  assert.doesNotMatch(ranks.html, /class="pp-ordinal/);
  assert.equal((render("ranking").html.match(/class="pp-ordinal"/g) || []).length, 3);
  assert.match(render("ranking", { items: ["1 Listen", "2 Ask", "3 Pause"] }).html, /pp-ordinal pp-digit">1/);
});

test("percent ring reads numeric and word percentages and declines ambiguous or invalid amounts", () => {
  for (const [value, expected] of [["80%", 0.8], ["eighty percent", 0.8], ["twenty five", 0.25], ["12.5%", 0.125], ["zero percent", 0], ["one hundred", 1], ["4/10", 0.4], ["120%", null], ["-5%", null], ["ten to twenty", null], ["many", null], ["1 million", null], ["one million", null]]) {
    const r = render("percent-ring", { value, context: "of the call" });
    const fill = r.calls.find(({ args }) => args[0].endsWith(".pp-fill"));
    if (expected === null) assert.equal(fill, undefined, value);
    else { assert.equal(fill.args[2].strokeDashoffset, 1 - expected, value); assert.equal(fill.args[3], r.o.reveals[0]); }
    assert.ok(visible(r.html).startsWith(value));
  }
});

test("bars scale only spoken amounts and otherwise use explicitly qualitative equal steps", () => {
  for (const [items, heights, qualitative] of [
    [["10 calls", "20 calls"], [88, 176], false],
    [["twenty five calls", "fifty calls"], [88, 176], false],
    [["one hundred calls", "two hundred calls"], [88, 176], false],
    [["1,000 calls", "2,000 calls"], [88, 176], false],
    [["0 calls", "20 calls"], [0, 176], false],
    [["record", "listen", "reps", "repeat"], [44, 88, 132, 176], true],
    [["10 calls", "reps", "20 calls"], [58.667, 117.333, 176], true],
    [["ten to twenty", "thirty calls"], [88, 176], true],
    [["-5 calls", "10 calls"], [88, 176], true],
    [["zero calls", "zero calls"], [0, 0], false],
  ]) {
    const r = render("bars", { items });
    assert.deepEqual([...r.html.matchAll(/style="height:([\d.]+)px"/g)].map((m) => +m[1]), heights);
    assert.equal(r.html.includes("Practice steps"), qualitative);
  }
});

test("ratings use their spoken denominator and never invent a numbered scale", () => {
  for (const [score, count, filled] of [["four out of ten", 10, 4], ["3/5", 5, 3], ["zero out of five", 5, 0], ["four", 0, 0], ["fifty percent", 0, 0], ["six out of five", 0, 0], ["four out of zero", 0, 0], ["twenty out of fifty", 0, 0], ["4.5 out of ten", 0, 0]]) {
    const r = render("rating", { score });
    assert.equal((r.html.match(/class="pp-dot pp-dot-/g) || []).length, count, score);
    assert.equal(r.calls.filter(({ args }) => /\.pp-dot-\d+$/.test(args[0])).length, filled, score);
    assert.equal(visible(r.html), score);
  }
});

test("progress ring waits for a spoken total; stopwatch preserves ranges and units without counting", () => {
  const progress = render("progress-ring");
  const fill = progress.calls.find(({ args }) => args[0].endsWith(".pp-fill"));
  assert.equal(fill.args[2].strokeDashoffset, 1 - 5 / 8);
  assert.equal(fill.args[3], progress.o.reveals[2]);
  const unknown = render("progress-ring", { instruction: "Practice every day", value: "day five" });
  assert.ok(!unknown.calls.some(({ args }) => args[0].endsWith(".pp-fill")));
  assert.doesNotMatch(unknown.html, /pp-detail/);
  const watch = render("stopwatch");
  assert.equal(visible(watch.html), "two to three minutes");
  assert.ok(watch.calls.some(({ args }) => args[0].endsWith(".pp-hand") && args[2].rotation === 54 && args[2].duration === 0.3));
});

test("loading states replace in place and percentage fills require an explicit spoken percentage", () => {
  for (const states of [["keep practicing"], ["ten reps", "twenty reps"], ["20% ready", "80% ready"], ["one out of four", "three out of four"]]) {
    const r = render("loading-bar", { states });
    const fills = r.calls.filter(({ args }) => args[0].endsWith(".pp-fill"));
    const expected = states[0].includes("%") ? [0.2, 0.8] : states[0].includes("out of") ? [0.25, 0.75] : states.map((_, i) => (i + 1) / (states.length + 1));
    assert.deepEqual(fills.map(({ args }) => args[2].scaleX), expected);
    assert.deepEqual(fills.map(({ args }) => args[1].scaleX), [0, ...expected.slice(0, -1)]);
    assert.equal(r.calls.filter(({ method }) => method === "set").length, states.length - 1);
    if (!states.some((s) => s.includes("%"))) assert.doesNotMatch(visible(r.html), /%/);
  }
  for (const [state, expected] of [["twenty-five percent", 0.25], ["one thousand out of two thousand", 0.5], ["one hundred and five out of two hundred", 0.525]]) {
    const r = render("loading-bar", { states: [state] });
    assert.equal(r.calls.find(({ args }) => args[0].endsWith(".pp-fill")).args[2].scaleX, expected);
  }
});

test("all copy is escaped, all CSS is scoped and legacy looks do not receive the new cards", () => {
  const unsafe = render("ranking", { heading: "<b> & 'x'", items: ["<img> & 'x'", "Listen", "Pause"] });
  assert.doesNotMatch(unsafe.html, /<img>|<b>/);
  assert.match(unsafe.html, /&lt;img&gt; &amp; &#39;x&#39;/);
  assert.match(unsafe.html, /&lt;b&gt; &amp;/);
  for (const [type, def] of Object.entries(BATCH)) {
    for (const selectors of def.css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of selectors[1].trim().split(",")) assert.ok(selector.trim() === `.pro-${type}` || selector.trim().startsWith(`.pro-${type} `), selector);
    }
    assert.ok(proCSS().includes(def.css));
    assert.doesNotMatch(def.css, /glow|gradient|animation:|@keyframes|Caveat|emoji/i);
    for (const color of def.css.matchAll(/#[\da-f]+/gi)) assert.ok(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"].includes(color[0]), color[0]);
  }
  assert.match(proPrompt(fixture("checklist").words), /loading-bar.*\[proof\]/);
  for (const preset of ["pingel-brand", "pingel-bold", "clean", "vsl"]) {
    const plan = fixturePlan("/fixture.mp4"); plan.preset = preset; plan.style = loadPreset(preset);
    plan.proGraphics = Object.keys(BATCH).map((type) => fixture(type).o);
    assert.doesNotMatch(renderHTML(plan, "fixture.mp4"), /pro-checklist|pro-percent-ring|pp-ring|pp-tick|test-loading-bar/);
  }
});

test("vendored GSAP gives identical batch states when seeking forward, backward and out of order", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true }), elements = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, { opacity: /pp-node|pp-link|pp-bar$|pp-fill|pp-hand|pp-box/.test(selector) ? 1 : 0, visibility: "visible", y: 0, rotation: 0, scaleX: 0, scaleY: 0, strokeDashoffset: 1, clipPath: "inset(0 100% 0 0)", backgroundColor: "#343438", borderColor: "#343438" });
    return elements.get(selector);
  };
  const tl = {};
  for (const method of ["fromTo", "to", "set"]) tl[method] = (selector, ...args) => { timeline[method](element(selector), ...args); return tl; };
  new Function("tl", proTimeline(Object.keys(BATCH).map((type) => fixture(type).o)))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...elements].map(([selector, el]) => {
      const parent = elements.get(selector.split(" ")[0]);
      if (parent?.opacity === 0 || el.opacity === 0 || el.visibility === "hidden") return null;
      return [selector, ...["opacity", "visibility", "y", "rotation", "scaleX", "scaleY", "strokeDashoffset", "clipPath", "backgroundColor", "borderColor"].map((key) => el[key])];
    });
  };
  const frames = Array.from({ length: 360 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) { const frame = i * 137 % frames.length; assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`); }
});
