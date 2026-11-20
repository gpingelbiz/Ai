import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { loadPreset } from "../src/presets.mjs";
import { fixturePlan } from "../scripts/golden.mjs";
import { renderHTML } from "../src/compose.mjs";
import { groundProOverlay, attachProWordMarks, proSize } from "../src/pro.mjs";
import { proBezier, correction, compare, stepsRail, stat, wordMark, label, renderProOverlay, proTimeline, proCSS } from "../src/pro-render.mjs";

const words = "Are you because you're Ask Listen Close 30 calls Topic".split(" ").map((text, i) => ({ text, start: 3 + i * 0.7, end: 3.4 + i * 0.7 }));
const range = (from, to = from) => ({ from, to });
const picks = [
  { type: "correction", wrong: range(0, 1), right: range(2, 3) },
  { type: "compare", left: range(0, 1), right: range(2, 3) },
  { type: "steps", items: [range(4), range(5), range(6)] },
  { type: "stat", valueRange: range(7), labelRange: range(8) },
  { type: "wordMark", word: 5, mark: "underline" },
  { type: "label", from: 9, to: 9 },
];
const overlays = () => picks.map((p, i) => {
  const o = groundProOverlay(p, words);
  assert.ok(o, p.type);
  return { ...o, id: `pro-${i}`, place: { slot: "explanation", x: 120, y: 288, ...proSize(o), scale: 1 } };
});

test("CSS cubic eases keep the specified curves, exact endpoints and monotonic progress", () => {
  for (const curve of [[0.16, 1, 0.3, 1], [0.65, 0, 0.35, 1], [0.4, 0, 1, 1]]) {
    const ease = proBezier(...curve);
    assert.equal(ease(0), 0); assert.equal(ease(1), 1); assert.equal(ease(-1), 0); assert.equal(ease(2), 1);
    for (let i = 1; i <= 100; i++) assert.ok(ease(i / 100) >= ease((i - 1) / 100));
  }
  assert.ok(proBezier(0.16, 1, 0.3, 1)(0.5) > 0.9);
  assert.ok(Math.abs(proBezier(0.65, 0, 0.35, 1)(0.5) - 0.5) < 1e-6);
});

test("every teaching component returns escaped HTML and a seekable GSAP timeline with exact durations", () => {
  const list = overlays(), functions = [correction, compare, stepsRail, stat, wordMark, label];
  for (let i = 0; i < list.length; i++) {
    const result = functions[i](list[i]);
    assert.ok(result.html.includes(`id="pro-${i}"`)); assert.match(result.timeline, /tl\./);
    assert.deepEqual(renderProOverlay(list[i]), result);
    assert.doesNotThrow(() => new vm.Script(proTimeline([list[i]])));
    assert.match(result.timeline, /duration:0\.167/);
    assert.doesNotMatch(result.timeline, /repeat|yoyo|onComplete|onUpdate|Math\.random|#footage|#video-wrap/);
  }
  const corrected = correction(list[0]);
  assert.match(corrected.html, /pro-wrong/); assert.match(corrected.html, /pro-right/); assert.match(corrected.html, /pro-strike/);
  assert.match(corrected.timeline, /duration:0\.2/); assert.match(corrected.timeline, /duration:0\.233/);
  assert.match(compare(list[1]).timeline, new RegExp(String(list[1].reveals[1])));
  assert.match(stepsRail(list[2]).html, /pro-node/); assert.match(stepsRail(list[2]).timeline, /duration:0\.3/);
  assert.equal((stepsRail(list[2]).html.match(/pathLength="1"/g) || []).length, 2);
  assert.match(stat(list[3]).html, /pro-value pro-decisive">30/); assert.doesNotMatch(stat(list[3]).timeline, /innerHTML|textContent|count/);
  assert.match(wordMark(list[4]).html, /stroke-width="7"/); assert.match(wordMark(list[4]).timeline, /duration:0\.267/);
  const circle = wordMark({ ...list[4], mark: "circle" });
  assert.match(circle.html, /stroke-width="6"/); assert.match(circle.timeline, /duration:0\.367/);
  assert.ok(list[5].duration <= 2.5);
  const unsafe = structuredClone(list[0]); unsafe.phrases[0].lines = ['<script>&"'];
  assert.match(correction(unsafe).html, /&lt;script&gt;&amp;&quot;/); assert.doesNotMatch(correction(unsafe).html, /<script>/);
  assert.deepEqual(renderProOverlay({ type: "other" }), { html: "", timeline: "" });
  assert.equal(correction({ ...list[0], place: null }).html, "");
  assert.equal(proTimeline([]), "");
});

test("surfaces and type use the specified palette, flat panels, columns and fixed reading sizes", () => {
  const css = proCSS();
  for (const pattern of [/padding:32px/, /border-radius:16px/, /rgba\(11,11,13,\.92\)/, /0 12px 32px rgba\(0,0,0,\.22\)/, /340px 340px;gap:40px/, /border-left:2px solid #343438/, /font-size:52px;font-weight:600/, /font-weight:750;font-size:64px/, /400 128px\/144px "Anton"/, /font-size:40px/, /width:48px;height:48px/]) assert.match(css, pattern);
  assert.doesNotMatch(css, /glow|bevel|backdrop-filter|linear-gradient|animation:|@keyframes/);
  assert.match(correction({ ...overlays()[0], surface: "bone" }).html, /pro-bone/);
});

test("composer gates pro on Greg's preset and embeds word marks in their caption span", () => {
  const p = fixturePlan("/fixture.mp4"); p.style = loadPreset("pingel-pro"); p.preset = "pingel-pro";
  p.graphics = []; p.slams = []; p.icons = []; p.zooms = []; p.video.duration = 30; p.words = words;
  p.captions = [{ start: 3, end: 14, words, text: words.map((w) => w.text).join(" ") }];
  p.proGraphics = attachProWordMarks(overlays(), p.captions);
  const html = renderHTML(p, "assets/footage.mp4");
  assert.match(html, /class="pro-overlay pro-correction/); assert.match(html, /const proEnter=proEase\(\.16,1,\.3,1\)/);
  assert.match(html, /id="cap-0-w5">Listen<svg id="pro-4"/);
  assert.equal((html.match(/id="pro-4"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="gfx clip|class="icon-pop|glowLights|glowScene-|bold-headline/);
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]));
  for (const preset of ["pingel-brand", "pingel-bold", "clean", "vsl"]) {
    const q = { ...p, preset, style: loadPreset(preset) };
    assert.doesNotMatch(renderHTML(q, "assets/footage.mp4"), /pro-overlay|const proEnter|id="pro-4"/, preset);
  }
  assert.doesNotMatch(renderHTML({ ...p, canvas: { width: 1920, height: 1080 } }, "x.mp4"), /pro-overlay|const proEnter/);
  const oldClient = process.env.REEL_CLIENT;
  try { process.env.REEL_CLIENT = "fixture"; assert.doesNotMatch(renderHTML(p, "x.mp4"), /pro-overlay|const proEnter/); }
  finally { if (oldClient === undefined) delete process.env.REEL_CLIENT; else process.env.REEL_CLIENT = oldClient; }
});

test("real vendored GSAP produces identical visible pro states under forward, reverse and shuffled seeks", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true });
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const list = overlays(), elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, { opacity: /pro-node|pro-connectors|pro-strike/.test(selector) ? 1 : 0, y: 0, strokeDashoffset: 1, clipPath: "inset(0 100% 0 0)", backgroundColor: "#343438", color: "#F5F1E8" });
    return elements.get(selector);
  };
  const tl = {};
  for (const method of ["fromTo", "to"]) tl[method] = (selector, ...args) => { timeline[method](element(selector), ...args); return tl; };
  new Function("tl", proTimeline(list))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...elements.entries()].map(([selector, el]) => {
      const id = selector.split(" ")[0], parent = elements.get(id);
      if (parent && parent.opacity === 0 || el.opacity === 0) return null;
      return [selector, el.opacity, el.y, el.strokeDashoffset, el.clipPath, el.backgroundColor, el.color];
    });
  };
  const frames = Array.from({ length: 480 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) { const frame = i * 137 % 480; assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`); }
});
