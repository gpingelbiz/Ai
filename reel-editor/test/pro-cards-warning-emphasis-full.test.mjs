import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as batch } from "../src/pro-cards/warning-emphasis-full.mjs";
import { CARDS } from "../src/pro-cards/index.mjs";
import { groundCard, proSize, PRO_RECTS, PRO_MOTION, PRO_RULES, budgetProOverlays } from "../src/pro.mjs";
import { renderProOverlay, proTimeline, proCSS } from "../src/pro-render.mjs";

const range = (from, to = from) => ({ from, to });
const words = "listen fast rebuttal 1 belief heard 0 lost deal slow down they hang up flat lift here flat chunk it down two sentences record it".split(" ").map((text, i) => ({ text, start: +(3 + i * 0.06).toFixed(3), end: +(3.05 + i * 0.06).toFixed(3) }));
const fixtures = {
  "red-flag": { family: "warning", pick: { mistake: range(1, 2) }, selectors: [".flag-copy"] },
  cost: { family: "warning", pick: { loss: range(7, 8), consequence: range(11, 13) }, selectors: [".cost-loss", ".cost-consequence"] },
  receipt: { family: "warning", pick: { items: [range(1, 3), range(4, 6)], total: range(7, 8) }, selectors: [".receipt-line-0", ".receipt-line-1", ".receipt-total"] },
  "pros-cons": { family: "warning", pick: { pros: [range(1)], cons: [range(11, 13)] }, selectors: [".pc-row-0", ".pc-row-1"] },
  "gold-frame": { family: "payoff", pick: { quote: range(9, 10) }, selectors: [".frame-copy"] },
  "big-word": { family: "payoff", pick: { word: range(0) }, selectors: [".big-copy"] },
  "sticky-note": { family: "payoff", pick: { note: range(9, 10) }, selectors: [".sticky-copy"] },
  arrow: { family: "emphasis", pick: { label: range(15, 16) }, selectors: [".arrow-copy"] },
  meter: { family: "distinction", pick: { left: range(1), right: range(9, 10) }, selectors: [".meter-left", ".meter-right"] },
  "voice-wave": { family: "proof", pick: { labels: [range(14), range(15, 16), range(17)] }, selectors: [".wave-label-0", ".wave-label-1", ".wave-label-2"] },
  "full-list": { family: "procedure", pick: { items: [range(18, 20), range(21, 22), range(23, 24)] }, selectors: [".full-item-0", ".full-item-1", ".full-item-2"] },
};

function overlay(type, pick = fixtures[type].pick, source = words) {
  const o = groundCard(pick, type, source);
  assert.ok(o, `${type} grounds`);
  return { ...o, id: `test-${type}`, place: { x: o.fullscreen ? 0 : 120, y: o.fullscreen ? 0 : 288, scale: 1 } };
}

function calls(o) {
  const recorded = [];
  const tl = {};
  for (const method of ["fromTo", "to"]) tl[method] = (...args) => { recorded.push({ method, args }); return tl; };
  new Function("tl", proTimeline([o]))(tl);
  return recorded;
}

function visibleCopy(html) {
  return html.replace(/<svg\b[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("the batch registers exactly the eleven requested cards with grounded slots and fitting sizes", () => {
  assert.deepEqual(Object.keys(batch), Object.keys(fixtures));
  for (const [type, def] of Object.entries(batch)) {
    const o = overlay(type), size = proSize(o);
    assert.equal(CARDS[type], def);
    assert.equal(def.family, fixtures[type].family);
    assert.ok(def.hint.length > 20 && !def.hint.includes("\n"));
    assert.ok(Object.values(def.slots).some((s) => s.kind === "spoken"));
    for (const slot of Object.values(def.slots)) {
      assert.ok(["spoken", "label"].includes(slot.kind));
      assert.ok(slot.maxChars > 0 && slot.width > 0 && slot.size > 0 && slot.maxLines > 0);
    }
    assert.ok(["obsidian", "bone", "bare"].includes(def.surface));
    assert.equal(o.fullscreen === true, type === "full-list");
    if (o.fullscreen) assert.deepEqual(size, { w: 1080, h: 1920 });
    else assert.ok(PRO_RECTS.some((r) => size.w <= r.w && size.h <= r.h), `${type} fits a placement rectangle`);
    const rendered = renderProOverlay(o);
    assert.match(rendered.html, new RegExp(`pro-overlay pro-${type}`));
    assert.match(def.css, new RegExp(`\\.pro-${type} `));
    for (const rule of def.css.split("}").filter((s) => s.trim())) assert.ok(rule.trim().startsWith(`.pro-${type}`), `${type} CSS is scoped`);
    for (const phrase of o.phrases) assert.ok(visibleCopy(rendered.html).includes(phrase.text), `${type}: ${phrase.text}`);
    assert.equal(o.end, +(o.complete + PRO_RULES.hold + PRO_MOTION.exit).toFixed(3));
    assert.doesNotThrow(() => new vm.Script(proTimeline([o])));
    assert.equal(renderProOverlay(o).html, rendered.html);
    assert.equal(renderProOverlay(o).timeline, rendered.timeline);
  }
});

test("every spoken item writes in at its own reveal with the house timing, plus panel entrance and exit", () => {
  for (const [type, fixture] of Object.entries(fixtures)) {
    const o = overlay(type), events = calls(o);
    assert.equal(fixture.selectors.length, o.reveals.length);
    for (const [i, selector] of fixture.selectors.entries()) {
      const event = events.find((c) => c.method === "fromTo" && c.args[0] === `#${o.id} ${selector}`);
      assert.ok(event, `${type} animates ${selector}`);
      const [, from, to, at] = event.args;
      assert.equal(at, o.reveals[i]);
      assert.equal(from.opacity, 0);
      assert.equal(to.opacity, 1);
      assert.match(from.clipPath, /100%/);
      assert.equal(to.clipPath, "inset(0 0% 0 0)");
      assert.equal(to.duration, PRO_MOTION.enter);
      assert.equal(to.immediateRender, false);
      assert.equal(typeof to.ease, "function");
      assert.equal(to.ease(0), 0); assert.equal(to.ease(1), 1);
    }
    const enter = events[0], exit = events.at(-1);
    assert.equal(enter.args[0], `#${o.id}`); assert.equal(enter.args[1].y, 16);
    assert.equal(exit.args[0], `#${o.id}`); assert.equal(exit.args[1].duration, PRO_MOTION.exit);
    assert.equal(exit.args[2], +(o.end - PRO_MOTION.exit).toFixed(3));
    assert.doesNotMatch(renderProOverlay(o).timeline, /repeat|yoyo|onUpdate|onComplete|Math\.random|innerHTML|textContent/);
  }
});

test("approved surfaces, SVG accents and state changes are present without extra numeric claims", () => {
  for (const type of Object.keys(fixtures)) {
    const o = overlay(type), r = renderProOverlay(o), text = visibleCopy(r.html);
    assert.deepEqual(text.match(/\d+/g) || [], o.phrases.flatMap((p) => p.text.match(/\d+/g) || []), type);
    assert.doesNotMatch(r.html, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(batch[type].css, /glow|bevel|linear-gradient|animation:|@keyframes/);
    for (const color of batch[type].css.match(/#[\da-f]{6}/gi) || []) assert.ok(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"].includes(color));
    for (const font of batch[type].css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font[1]));
    assert.ok(proCSS().includes(batch[type].css));
  }
  assert.match(renderProOverlay(overlay("red-flag")).html, /<svg class="flag-icon"/);
  assert.match(renderProOverlay(overlay("receipt")).html, /pro-bone/);
  assert.match(renderProOverlay(overlay("receipt")).timeline, /inset\(0 0 100% 0\)/);
  assert.match(renderProOverlay(overlay("sticky-note")).html, /pro-bone/);
  assert.match(batch["sticky-note"].css, /rotate\(-2deg\)/);
  assert.match(batch["sticky-note"].css, /italic.*"Inter"/);
  for (const type of ["arrow", "big-word"]) assert.match(renderProOverlay(overlay(type)).html, /pro-bare/);
  for (const [type, selector] of [["arrow", ".arrow-mark path"], ["gold-frame", ".frame-border rect"]]) {
    const o = overlay(type), event = calls(o).find((c) => c.args[0] === `#${o.id} ${selector}`);
    assert.match(renderProOverlay(o).html, /pathLength="1"/);
    assert.equal(event.args[1].strokeDashoffset, 1);
    assert.equal(event.args[2].strokeDashoffset, 0);
    assert.equal(event.args[2].duration, PRO_MOTION.state);
    assert.equal(event.args[3], o.reveals[0]);
  }
  const meter = overlay("meter"), needle = calls(meter).find((c) => c.args[0].endsWith(" .meter-needle"));
  assert.equal(needle.args[1].left, "0%"); assert.equal(needle.args[2].left, "78%");
  assert.equal(needle.args[2].duration, PRO_MOTION.state); assert.equal(needle.args[3], meter.reveals[1]);
  const wave = renderProOverlay(overlay("voice-wave"));
  assert.equal((wave.html.match(/<rect/g) || []).length, 60);
  assert.doesNotMatch(visibleCopy(wave.html), /\d/);
});

test("all repeated slots support their minimum and maximum counts and reject out-of-range counts", () => {
  for (const [type, def] of Object.entries(batch)) {
    for (const [name, slot] of Object.entries(def.slots)) {
      if (!slot.repeat) continue;
      const [min, max] = slot.repeat;
      for (const count of [min - 1, min, max, max + 1]) {
        const pick = {}, source = [];
        for (const [n, s] of Object.entries(def.slots)) {
          if (s.kind === "label") continue;
          const ranges = Array.from({ length: n === name ? count : s.repeat?.[0] || 1 }, () => {
            const i = source.length;
            source.push({ text: "listen", start: 3 + i * 0.1, end: 3.08 + i * 0.1 });
            return range(i);
          });
          pick[n] = s.repeat ? ranges : ranges[0];
        }
        const o = groundCard(pick, type, source);
        assert.equal(Boolean(o), count >= min && count <= max, `${type}.${name}: ${count}`);
        if (o) {
          const placed = overlay(type, pick, source), events = calls(placed);
          assert.equal(placed.slots[name].length, count);
          const textReveals = events.filter((c) => c.method === "fromTo" && c.args[1].opacity === 0 && c.args[0] !== `#${placed.id}` && !c.args[0].endsWith(" .wave-bars"));
          assert.equal(textReveals.length, placed.reveals.length);
          assert.deepEqual(textReveals.map((c) => c.args[3]), placed.reveals);
        }
      }
    }
  }
});

test("labels are optional short headings, reject digits and long copy, and all slots escape markup", () => {
  for (const [type, def] of Object.entries(batch)) {
    for (const [name, slot] of Object.entries(def.slots)) {
      if (slot.kind !== "label") continue;
      assert.ok(slot.optional);
      for (const text of ["Rule 3", "one two three four five", "x".repeat(slot.maxChars + 1)]) assert.equal(groundCard({ ...fixtures[type].pick, [name]: text }, type, words), null);
      const o = overlay(type, { ...fixtures[type].pick, [name]: "Keep it simple" });
      assert.ok(visibleCopy(renderProOverlay(o).html).includes("Keep it simple"));
      assert.deepEqual(o.reveals, overlay(type).reveals);
    }
    const o = overlay(type);
    for (const items of Object.values(o.slots)) for (const item of items) { item.text = '<b>&"'; item.lines = ['<b>&"']; }
    if (type === "big-word") { o.slots.word[0].text = '<b>&"'; }
    const r = renderProOverlay(o);
    assert.match(r.html, /&lt;b&gt;&amp;&quot;/, type);
    assert.doesNotMatch(r.html, /<b>/, type);
    assert.equal(groundCard({}, type, words), null);
    const bad = structuredClone(fixtures[type].pick);
    const name = Object.keys(def.slots).find((n) => def.slots[n].kind === "spoken");
    bad[name] = def.slots[name].repeat ? [range(999)] : range(999);
    assert.equal(groundCard(bad, type, words), null);
  }
});

test("big-word refuses phrases and the full-list remains subject to the full-screen budget", () => {
  const source = ["go", "up"].map((text, i) => ({ text, start: 3 + i * 0.1, end: 3.08 + i * 0.1 }));
  const o = overlay("big-word", { word: range(0, 1) }, source);
  const helpers = { copy: () => { throw new Error("phrases must not render"); } };
  assert.deepEqual(batch["big-word"].render(o, helpers), { inner: "", timeline: "" });
  const full = overlay("full-list");
  assert.ok(full.duration <= PRO_RULES.fullMax);
  const admitted = { ...full, id: "pro-0" };
  assert.deepEqual(budgetProOverlays([full], { duration: 20 }), [admitted]);
  const second = { ...full, start: 11, complete: 12, end: 14, duration: 3 };
  assert.deepEqual(budgetProOverlays([full, second], { duration: 20 }), [admitted]);
  const long = { ...full, duration: 5, end: full.start + 5 };
  assert.deepEqual(budgetProOverlays([long], { duration: 20 }), []);
});

test("vendored GSAP reproduces all batch states when seeking forward, backward or out of order", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true }), elements = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const tl = {};
  for (const method of ["fromTo", "to"]) tl[method] = (selector, ...args) => {
    if (!elements.has(selector)) elements.set(selector, { opacity: 0, clipPath: "inset(0 100% 0 0)", strokeDashoffset: 1, scale: 1, scaleX: 1, y: 0, left: "0%", fill: "#A8A49C" });
    timeline[method](elements.get(selector), ...args);
    return tl;
  };
  new Function("tl", proTimeline(Object.keys(fixtures).map((type) => overlay(type))))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...elements].map(([selector, el]) => [selector, ...["opacity", "clipPath", "strokeDashoffset", "scale", "scaleX", "y", "left", "fill"].map((k) => el[k])]);
  };
  const frames = Array.from({ length: 210 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) { const frame = i * 137 % frames.length; assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`); }
});
