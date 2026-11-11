import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fitBoldText, boldHTML, boldCSS, boldRuntime, boldOverlayTimeline, BOLD_JS } from "../src/bold-render.mjs";
import { boldSettings, restyleBold, fallbackBoldDirection } from "../src/bold.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { fixturePlan } from "../scripts/golden.mjs";

async function fixture() {
  const style = loadPreset("pingel-bold");
  const words = "You can change the way you sell. Ask better questions and listen to every answer.".split(" ").map((text, i) => ({ text, start: i * 0.35, end: i * 0.35 + 0.3 }));
  return (await restyleBold({ ...fixturePlan("/fixture.mp4"), style, preset: style.name, words }, { env: {}, picks: fallbackBoldDirection(words) })).plan;
}

test("text fitting keeps one line when possible, shrinks long words and preserves two-line protected amounts", () => {
  const short = fitBoldText(["Ask", "better", "questions"]);
  assert.equal(short.lines.length, 1); assert.equal(short.size, 84);
  const longWord = "W".repeat(70), long = fitBoldText([longWord], { size: 104, width: 928 });
  assert.equal(long.lines.length, 1); assert.ok(long.size * longWord.length * 0.95 <= 928);
  const split = fitBoldText(["This", "unusually", "long", "spoken", "phrase"], { size: 104, width: 600 });
  assert.equal(split.lines.length, 2);
  const payoff = fitBoldText(["Only", "100", "dollars"], { size: 104, width: 650, payoff: 1, blockedBreaks: [2], maxHeight: 250 });
  assert.equal(payoff.payoffScale, 1.9); assert.ok(payoff.h <= 250);
  assert.ok(payoff.lines.every((line, i) => i === 0 || line.from !== 2));
  assert.deepEqual(fitBoldText([]).lines, []);
  assert.throws(() => fitBoldText(["a"], { width: 0 }), /rectangle/);
});

test("bold markup escapes source text, separates headline from captions and emits only scoped rules", async () => {
  const plan = await fixture(), settings = boldSettings(plan.style);
  plan.words[0].text = "<script>&";
  const html = boldHTML(plan, { settings });
  assert.match(html, /&lt;script&gt;&amp;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /id="bold-headline"/); assert.match(html, /id="bold-caption-0"/);
  const captionPart = html.slice(html.indexOf('id="bold-caption-0"'));
  for (let i = 0; i < plan.words.length; i++) assert.equal((captionPart.match(new RegExp(`data-word-index="${i}"`, "g")) || []).length, 1);
  const css = boldCSS(settings, plan);
  for (const rule of css.split("}").map((rule) => rule.trim()).filter(Boolean)) for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) assert.ok(selector.trim().startsWith(".bold-root "), selector);
  assert.match(css, /font-weight:650/); assert.match(css, /font-weight:900/); assert.match(css, /-webkit-text-stroke:12px/);
  assert.match(css, /paint-order:stroke fill/); assert.match(css, /#C8A24B/);
  assert.equal(boldHTML({}), ""); assert.deepEqual(boldRuntime({}, settings), { headline: null, groups: [] });
  assert.equal(boldOverlayTimeline(plan, settings), "");
});

test("composition gates the entire bold runtime and keeps glow out even when both modes are requested", async () => {
  const p = await fixture(); p.style.glow.enabled = true; p.style.captions.style = "glow";
  const html = renderHTML(p, "assets/footage.mp4");
  assert.match(html, /id="root" class="bold-root"/);
  assert.match(html, /const boldFit/); assert.match(html, /id="bold-headline"/);
  assert.doesNotMatch(html, /id="hook"|id="cap-0"|glowLights|const glSweep|glowScenes/);
  const runtime = JSON.parse(html.match(/const PLAN = (.+);/)[1]);
  assert.ok(runtime.bold); assert.equal(runtime.glow, undefined); assert.equal(runtime.hook, null); assert.deepEqual(runtime.captions, []);
  const code = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]; new vm.Script(code);
  for (const canvas of [{ width: 1920, height: 1080 }, { width: 1080, height: 1080 }]) {
    const wide = renderHTML({ ...p, canvas }, "assets/footage.mp4");
    assert.doesNotMatch(wide, /bold-root|const boldFit|id="bold-caption/);
  }
});

test("a hand-edited saved client plan renders without any bold markup or JS and logs once", async () => {
  const p = await fixture(), saved = process.env.REEL_CLIENT;
  const writes = [], original = process.stderr.write;
  try {
    process.env.REEL_CLIENT = "fixture";
    process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
    const html = renderHTML(p, "assets/footage.mp4");
    assert.doesNotMatch(html, /bold-root|boldFit|id="bold-headline"|"bold":/);
    assert.equal(writes.filter((line) => line.includes("bold look disabled")).length, 1);
  } finally {
    process.stderr.write = original;
    if (saved === undefined) delete process.env.REEL_CLIENT; else process.env.REEL_CLIENT = saved;
  }
});

test("all existing presets retain their exact pre-change HTML, including glow and a client look", () => {
  const expected = {
    clean: "ad9cc68d543e4107981dede25e654040ecb03a202e098fd6b867c5237770bc85",
    "pingel-brand": "4eb4d6a574f49395fd8c951946f3ce715d4302693118df5b502bf1c6715ecad3",
    "pingel-runway": "4eb4d6a574f49395fd8c951946f3ce715d4302693118df5b502bf1c6715ecad3",
    "pingel-v2": "307483b2092fa537163dda7739cd3fb2e6936ca8296122943ce647629b773830",
    speaker: "9b2e4191af94d57d2629fac3458cf4130fc6ba020162ef2b0b08ef1079e9f044",
    vsl: "91efe2ca41328efea454a587b14623b047ab1ecacb4b19a0d8bbb8f6b3b756d6",
    youtube: "5f816a16952920dc71c1466176e7668d52561baca99c025e70facade0df6b621",
  };
  const digest = (p) => createHash("sha256").update(renderHTML(p, "assets/footage.mp4")).digest("hex");
  for (const [name, hash] of Object.entries(expected)) {
    const p = fixturePlan("/fixture.mp4"); p.style = loadPreset(name); p.preset = name;
    assert.equal(digest(p), hash, name);
    assert.doesNotMatch(renderHTML(p, "assets/footage.mp4"), /bold-root|boldFit|"bold":/);
  }
  const p = fixturePlan("/fixture.mp4"); p.style.captions.style = "glow"; p.glowScenes = []; p.glowOverlays = [];
  assert.equal(digest(p), "1f352cb80d58644128375a2442b41591a500cf81e7b2d45ef739338e7c2b0f14");
  p.preset = "brand-fixture"; p.style.name = "brand-fixture"; p.style.colors = { text: "#fafafa", accent: "#b1bbcc", stroke: "#141424", bg: "#1a1b2a" };
  Object.assign(p.style.captions, { style: "reveal", uppercase: false, animation: "cut", dimFuture: false });
  assert.equal(digest(p), "1653bbb274e2dd1a2ee9fdcaa51283d65d9b012fd7f773a2b8e2375c67b013ab");
});

test("real vendored GSAP gives identical hard caption swaps under forward, reverse and shuffled seeks", async (t) => {
  const plan = await fixture(), settings = boldSettings(plan.style), runtime = boldRuntime(plan, settings);
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true });
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const elements = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, { opacity: id === "bold-headline" || id === "bold-caption-0" ? 1 : 0, firstElementChild: { scale: 1 }, style: {} }); return elements.get(id); };
  const tl = {};
  for (const method of ["set", "fromTo"]) tl[method] = (target, ...args) => { timeline[method](typeof target === "string" ? element(target.slice(1)) : target, ...args); return tl; };
  const document = { getElementById: element, querySelectorAll: () => [] };
  new Function("PLAN", "document", "tl", BOLD_JS)({ bold: runtime, fps: 30 }, document, tl);
  const frames = Array.from({ length: 300 }, (_, i) => i);
  const snapshot = (frame) => { timeline.totalTime(frame / 30, false); return [element("bold-headline").opacity, ...runtime.groups.map((_, i) => element(`bold-caption-${i}`).opacity)]; };
  const forward = frames.map(snapshot);
  assert.equal(forward[0][0], 1); assert.equal(forward[0][1], 1);
  for (const frame of [...frames].reverse()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) { const frame = i * 137 % 300; assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`); }
  for (let frame = 0; frame < 300; frame++) assert.ok(forward[frame].slice(1).filter((opacity) => opacity === 1).length <= 1, `two captions on frame ${frame}`);
  for (const g of runtime.groups) { assert.equal(forward[g.startFrame][runtime.groups.indexOf(g) + 1], 1); if (g.endFrame < 300) assert.equal(forward[g.endFrame][runtime.groups.indexOf(g) + 1], 0); }
  assert.doesNotMatch(BOLD_JS, /onUpdate|onComplete|Math\.random|Date\.now|blur|sweep/);
});
