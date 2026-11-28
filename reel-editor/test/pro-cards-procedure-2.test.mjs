import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as BATCH } from "../src/pro-cards/procedure-2.mjs";
import { CARDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, proSize, PRO_RECTS, PRO_MOTION, proPrompt, proTextWidth } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { loadPreset } from "../src/presets.mjs";
import { renderHTML } from "../src/compose.mjs";
import { fixturePlan } from "../scripts/golden.mjs";

const fixtures = {
  "stack-fan": { items: ["Ask a question", "Leave some space", "Listen to the answer", "Ask for the next step"] },
  roadmap: { pins: ["Reach out", "Meet", "Follow up", "Book"] },
  branch: { condition: "If they need more time", outcomes: ["Push harder", "Ask when to call"] },
  funnel: { stages: ["New leads", "Real talks", "Booked"] },
  cycle: { nodes: ["Practice", "Listen back", "Adjust"] },
  staircase: { steps: ["Ask", "Listen", "Confirm", "Close"] },
  "pill-tracker": { pills: ["Ask", "Pause", "Listen", "Book"] },
  "first-then-finally": { actions: ["Ask a question", "Listen to the answer", "Agree on the next step"] },
  pyramid: { base: "Understand their problem", middle: "Earn their trust", top: "Ask" },
  recipe: { title: "A better conversation", ingredients: ["A real question", "Some silence", "Careful listening", "A clear next step"] },
};

function fixture(type, input = fixtures[type]) {
  const words = [], pick = { type };
  for (const [name, slot] of Object.entries(BATCH[type].slots)) {
    if (input[name] == null) continue;
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
  const grounded = groundCard(pick, type, words);
  assert.ok(grounded, `${type}: ${JSON.stringify(input)}`);
  return { words, pick, o: { ...grounded, id: `test-${type}`, place: { x: 120, y: 288, scale: 1 } } };
}

function render(type, input) {
  const { o } = fixture(type, input), calls = [], tl = {};
  for (const method of ["fromTo", "to", "set"]) tl[method] = (...args) => { calls.push({ method, args }); return tl; };
  new Function("tl", proTimeline([o]))(tl);
  return { ...renderProOverlay(o), o, calls };
}

const visible = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const motion = (r, selector) => r.calls.filter(({ args }) => args[0] === `#${r.o.id} ${selector}`);

test("ten distinct procedure cards register, ground exact words and fit a placement", () => {
  assert.deepEqual(Object.keys(BATCH), Object.keys(fixtures));
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(CARDS[type], def);
    assert.equal(def.family, "procedure");
    assert.ok(def.hint.length > 40 && !def.hint.includes("\n"));
    assert.ok(["obsidian", "bone", "bare"].includes(def.surface));
    assert.ok(!def.fullscreen);
    assert.ok(Object.values(def.slots).every((s) => s.kind === "spoken"));
    const { o, words, pick } = fixture(type), size = proSize(o);
    assert.ok(PRO_RECTS.some((rect) => size.w <= rect.w && size.h <= rect.h), type);
    // Named design: since the 2026-11-28 ghost-editor import some of these types have more designs, and the planner's pick may land on one.
    const { group, ...designed } = groundProOverlay({ ...pick, design: type }, words) || {};
    assert.deepEqual(designed, groundCard(pick, type, words));
    assert.deepEqual(o.phrases.map((p) => p.text), Object.values(fixtures[type]).flat());
    assert.deepEqual(o.reveals, o.phrases.map((p) => words[p.from].start));
    assert.match(proPrompt(words), new RegExp(`${type}.*\\[procedure\\]`));
  }
  assert.deepEqual(proSize(fixture("pill-tracker").o), { w: 720, h: 160 });
});

test("every spoken range writes at its word time and the panel owns the exit", () => {
  for (const type of Object.keys(BATCH)) {
    const r = render(type);
    const writes = r.calls.filter(({ args }) => args[1]?.clipPath === "inset(0 100% 0 0)");
    assert.equal(writes.length, r.o.phrases.length, type);
    assert.deepEqual(writes.map(({ args }) => args[3]), r.o.reveals, type);
    for (const { args } of writes) {
      assert.equal(args[1].opacity, 0);
      assert.equal(args[2].opacity, 1);
      assert.equal(args[2].duration, PRO_MOTION.enter);
      assert.equal(typeof args[2].ease, "function");
    }
    for (const { method, args } of r.calls) {
      if (method === "fromTo") assert.equal(args[2].immediateRender, false);
      if (args[0].includes(" ")) {
        assert.equal(method, "fromTo");
        assert.ok([PRO_MOTION.enter, PRO_MOTION.state].includes(args[2].duration));
        assert.ok(r.o.reveals.includes(args[3]));
        assert.ok(!("rotation" in args[1]) && !("rotation" in args[2]));
        if (args[2].duration === PRO_MOTION.enter) {
          assert.ok(Math.abs(args[1].x || 0) <= 16);
          assert.ok(Math.abs(args[1].y || 0) <= 16);
        }
      }
    }
    assert.equal(r.calls.filter(({ method }) => method === "to").length, 1);
    assert.equal(r.calls.at(-1).args[1].duration, PRO_MOTION.exit);
    assert.doesNotMatch(r.timeline, /undefined|NaN|repeat:|yoyo:|onUpdate|onComplete|Math\.random/);
    for (const p of r.o.phrases) assert.ok(visible(r.html).includes(p.text), `${type}: ${p.text}`);
  }
});

test("repeat counts, missing ranges, copy limits and spoken order are enforced", () => {
  for (const [type, def] of Object.entries(BATCH)) {
    const { pick, words } = fixture(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      assert.equal(groundCard({ ...pick, [name]: undefined }, type, words), null);
      if (slot.repeat) {
        assert.equal(groundCard({ ...pick, [name]: pick[name].slice(0, slot.repeat[0] - 1) }, type, words), null);
        assert.equal(groundCard({ ...pick, [name]: Array(slot.repeat[1] + 1).fill(pick[name][0]) }, type, words), null);
        assert.equal(groundCard({ ...pick, [name]: [...pick[name]].reverse() }, type, words), null);
        for (let count = slot.repeat[0]; count <= slot.repeat[1]; count++) {
          const r = render(type, { ...fixtures[type], [name]: fixtures[type][name].slice(0, count) });
          const size = proSize(r.o);
          assert.ok(size.w <= 720 && size.h <= 560);
          assert.equal(r.o.slots[name].length, count);
        }
      }
      const range = slot.repeat ? pick[name][0] : pick[name];
      const tooLong = words.map((word, i) => i === range.from ? { ...word, text: "W".repeat(slot.maxChars + 1) } : word);
      assert.equal(groundCard(pick, type, tooLong), null, `${type}.${name}`);
    }
    const names = Object.keys(def.slots);
    if (names.length > 1) {
      const name = names.at(-1), slot = def.slots[name];
      assert.equal(groundCard({ ...pick, [name]: slot.repeat ? [{ from: 0 }, { from: 1 }] : { from: 0 } }, type, words), null);
    }
  }
});

test("stack sheets arrive above their predecessors; roadmap pins drop at each milestone", () => {
  const stack = render("stack-fan");
  assert.deepEqual([...stack.html.matchAll(/z-index:(\d+)/g)].map((m) => +m[1]), [1, 2, 3, 4]);
  assert.equal((stack.html.match(/transform:rotate\(/g) || []).length, 4);
  for (let i = 0; i < 4; i++) {
    const entry = motion(stack, `.p2-item-${i}`)[0];
    assert.equal(entry.args[1].x, i ? 16 : 0);
    assert.equal(entry.args[3], stack.o.reveals[i]);
  }
  const road = render("roadmap");
  assert.match(road.html, /class="p2-asphalt" d="M[^\"]+ C/);
  for (let i = 0; i < 4; i++) {
    const drop = motion(road, `.p2-item-${i}`)[0];
    assert.equal(drop.args[1].y, -16);
    assert.equal(drop.args[2].y, 0);
    assert.equal(drop.args[3], road.o.reveals[i]);
  }
});

test("branch highlights the second outcome; funnel narrows; cycle draws each third of the ring", () => {
  const branch = render("branch");
  const chosen = motion(branch, ".p2-item-1")[0];
  assert.equal(chosen.args[2].backgroundColor, "#C8A24B");
  assert.equal(chosen.args[3], branch.o.reveals[2]);
  assert.equal(motion(branch, ".p2-path-0")[0].args[3], branch.o.reveals[1]);
  assert.equal(motion(branch, ".p2-path-1")[0].args[3], branch.o.reveals[2]);
  const funnel = render("funnel");
  const widths = [...funnel.html.matchAll(/class="p2-tier-\d" d="M(\d+) \d+H(\d+)/g)].map((m) => +m[2] - +m[1]);
  assert.equal(widths.length, 3);
  assert.ok(widths[0] > widths[1] && widths[1] > widths[2]);
  const cycle = render("cycle");
  for (let i = 0; i < 3; i++) {
    const arc = motion(cycle, `.p2-arc-${i}`)[0];
    assert.equal(arc.args[1].strokeDashoffset, 1);
    assert.equal(arc.args[2].strokeDashoffset, 0);
    assert.equal(arc.args[3], cycle.o.reveals[i]);
    assert.equal(motion(cycle, `.p2-arrow-${i}`)[0].args[3], cycle.o.reveals[i]);
  }
});

test("staircase dot climbs on speech; pills mark only previous phases done", () => {
  for (const count of [2, 3, 4]) {
    const stair = render("staircase", { steps: fixtures.staircase.steps.slice(0, count) });
    const dots = motion(stair, ".p2-dot");
    assert.equal(dots.length, count);
    for (let i = 1; i < count; i++) {
      assert.equal(dots[i].args[1].x, (i - 1) * 656 / count);
      assert.equal(dots[i].args[2].x, i * 656 / count);
      assert.equal(dots[i].args[2].y, -i * 48);
      assert.equal(dots[i].args[3], stair.o.reveals[i]);
    }
    const pills = render("pill-tracker", { pills: fixtures["pill-tracker"].pills.slice(0, count) });
    for (let i = 0; i < count; i++) {
      const phases = motion(pills, `.p2-item-${i}`);
      assert.equal(phases[0].args[2].backgroundColor, "#C8A24B");
      assert.equal(phases[0].args[3], pills.o.reveals[i]);
      const check = motion(pills, `.p2-item-${i} .p2-check path`);
      if (i === count - 1) { assert.equal(phases.length, 1); assert.equal(check.length, 0); }
      else {
        assert.equal(phases[1].args[2].color, "#A8A49C");
        assert.equal(phases[1].args[3], pills.o.reveals[i + 1]);
        assert.equal(check[0].args[3], pills.o.reveals[i + 1]);
      }
    }
  }
});

test("fixed row headings, base-first pyramid and titled recipe preserve spoken order", () => {
  const rows = render("first-then-finally");
  assert.deepEqual([...rows.html.matchAll(/class="p2-label">([^<]+)/g)].map((m) => m[1]), ["First", "Then", "Finally"]);
  const pyramid = render("pyramid");
  for (const [i, name] of ["base", "middle", "top"].entries()) {
    assert.equal(motion(pyramid, `.p2-${name}`)[0].args[3], pyramid.o.reveals[i]);
    assert.equal(motion(pyramid, `.p2-tier-${i}`)[0].args[3], pyramid.o.reveals[i]);
  }
  assert.match(BATCH.pyramid.css, /\.p2-tier-2 \{ fill:#C8A24B/);
  const recipe = render("recipe");
  assert.match(recipe.html, /pro-bone/);
  assert.match(recipe.html, /class="p2-label">Recipe</);
  assert.equal(motion(recipe, ".p2-title")[0].args[3], recipe.o.reveals[0]);
  for (let i = 0; i < 4; i++) assert.equal(motion(recipe, `.p2-item-${i} .p2-check path`)[0].args[3], recipe.o.reveals[i + 1]);
});

test("copy fits its contract, escapes markup and never adds numbers or unearned words", () => {
  for (const [type, def] of Object.entries(BATCH)) {
    const r = render(type);
    const expected = r.o.phrases.map((p) => p.text);
    let text = visible(r.html);
    for (const phrase of expected) text = text.replace(phrase, "");
    assert.equal(text.replace(/\s+/g, " ").trim(), type === "recipe" ? "Recipe" : type === "first-then-finally" ? "First Then Finally" : "");
    for (const [name, slot] of Object.entries(def.slots)) {
      for (const item of r.o.slots[name]) {
        assert.ok(item.lines.length <= slot.maxLines);
        assert.ok(item.lines.every((line) => proTextWidth(line, item.fontSize || slot.size) <= slot.width));
      }
      const input = { ...fixtures[type], [name]: slot.repeat ? fixtures[type][name].map(() => "7") : "7" };
      const numbers = render(type, input);
      assert.deepEqual(visible(numbers.html).match(/\d+/g), numbers.o.phrases.flatMap((p) => p.text.match(/\d+/g) || []));
      const escaped = render(type, { ...fixtures[type], [name]: slot.repeat ? fixtures[type][name].map(() => "<b>") : "<b>" });
      assert.doesNotMatch(escaped.html, /<b>/);
      assert.match(escaped.html, /&lt;b&gt;/);
    }
  }
});

test("CSS is scoped, uses the brand palette and leaves existing looks isolated", () => {
  for (const [type, def] of Object.entries(BATCH)) {
    for (const selectors of def.css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of selectors[1].trim().split(",")) assert.ok(selector.trim() === `.pro-${type}` || selector.trim().startsWith(`.pro-${type} `) || selector.trim().startsWith(`.pro-${type}::`), selector);
    }
    assert.ok(proCSS().includes(def.css));
    assert.doesNotMatch(def.css, /glow|gradient|animation:|@keyframes|url\(/i);
    for (const color of def.css.matchAll(/#[\da-f]+/gi)) assert.ok(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"].includes(color[0]));
    for (const font of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font[1]));
  }
  for (const preset of ["pingel-brand", "pingel-bold", "clean", "vsl"]) {
    const plan = fixturePlan("/fixture.mp4"); plan.preset = preset; plan.style = loadPreset(preset);
    const baseline = renderHTML(plan, "fixture.mp4");
    plan.proGraphics = Object.keys(BATCH).map((type) => fixture(type).o);
    assert.equal(renderHTML(plan, "fixture.mp4"), baseline, preset);
  }
});

test("vendored GSAP produces identical visible states on forward, backward and shuffled seeks", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true }), elements = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const tl = {};
  for (const method of ["fromTo", "to", "set"]) tl[method] = (selector, ...args) => {
    if (!elements.has(selector)) elements.set(selector, { opacity: 1, x: 0, y: 0, strokeDashoffset: 1, clipPath: "inset(0 100% 0 0)", backgroundColor: "#0B0B0D", borderColor: "#343438", color: "#F5F1E8", stroke: "#343438", ...(method === "fromTo" ? args[0] : {}) });
    timeline[method](elements.get(selector), ...args);
    return tl;
  };
  new Function("tl", proTimeline(Object.keys(BATCH).map((type) => fixture(type).o)))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...elements].map(([selector, el]) => {
      const parent = elements.get(selector.split(" ")[0]);
      if (parent?.opacity === 0 || el.opacity === 0) return null;
      return [selector, ...["opacity", "x", "y", "strokeDashoffset", "clipPath", "backgroundColor", "borderColor", "color", "stroke"].map((key) => el[key])];
    });
  };
  const frames = Array.from({ length: 600 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) { const frame = i * 137 % frames.length; assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`); }
});
