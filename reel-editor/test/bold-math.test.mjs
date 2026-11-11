import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { parseBoldNumber, computeBoldMath, validateMathPick, boldMathLines } from "../src/bold-math.mjs";
import { boldOverlayHandler, validateBoldOverlay, placeBoldOverlays, boldBoxesOverlap } from "../src/bold-overlays.mjs";
import { boldSettings } from "../src/bold.mjs";
import { renderHTML } from "../src/compose.mjs";
import { fixturePlan } from "../scripts/golden.mjs";
import { loadPreset } from "../src/presets.mjs";
import { eventClock } from "../src/event-clock.mjs";

const number = (text) => parseBoldNumber(text);
function fixture(text = "20 percent of ten thousand dollars is two thousand dollars") {
  const words = text.split(" ").map((text, i) => ({ text, start: 4 + i * 0.3, end: 4.25 + i * 0.3 }));
  const style = loadPreset("pingel-bold"), plan = { preset: style.name, style, words, canvas: { width: 1080, height: 1920 }, video: { duration: 20 } };
  const context = { plan, words, settings: boldSettings(style), env: {}, fps: 30, duration: 20, zones: { measured: true, safe: { x: 76, y: 200, w: 928, h: 1400 }, caption: { x: 76, y: 1100, w: 928, h: 160 }, headline: { x: 76, y: 200, w: 928, h: 100, end: 3 }, faces: [{ x: 580, y: 400, w: 300, h: 550, start: 0, end: 20 }] } };
  const pick = { kind: "math", from: 0, to: words.length - 1, reason: "Commission math", operation: "percent", numbers: [{ from: 0, to: 1 }, { from: 3, to: 5 }], result: { from: 7, to: 9 } };
  return { context, pick };
}

test("complete number parsing covers compact money, spoken scales, decimals, percent and qualifiers", () => {
  const cases = { "10K": 10000, "ten thousand": 10000, "$3,000": 3000, "40 percent": 40, "forty per cent": 40, "one hundred and twenty five": 125, "one million two hundred thousand": 1200000, "one point five million": 1500000, "twenty-five": 25, "zero": 0, "minus five": -5, "-1,000.25": -1000.25, "three thousand dollars": 3000, "about $3,000": 3000, "£10k": 10000, "€3 million": 3000000 };
  for (const [text, value] of Object.entries(cases)) assert.equal(number(text)?.value, value, text);
  assert.equal(number("forty percent").percent, true); assert.equal(number("$3,000").currency, "$");
  assert.equal(number("up to ten thousand dollars").qualifier, "up to");
  for (const text of ["", "blah", "ten clients", "one one", "ten twenty", "one thousand thousand", "one hundred one hundred", "and ten", "ten and", "ten and five", "$40 percent", "101 percent", "$3,00", "$3 euros", "1e6", "Infinity", "two billion"]) assert.equal(number(text), null, text);
});

test("math uses exact rational arithmetic and suppresses unsupported or misleading computed results", () => {
  const cases = [
    ["add", "$0.10", "$0.20", 0.3, true],
    ["subtract", "$10K", "$3,000", 7000, true],
    ["multiply", "20 percent", "$10K", 2000, true],
    ["percent", "20 percent", "$10K", 2000, true],
    ["percent", "16", "40", 40, true],
    ["per", "$1000", "4", 250, true],
    ["per", "10", "3", 10 / 3, false],
    ["multiply", "about 20", "10", 200, false],
  ];
  for (const [op, a, b, value, exact] of cases) {
    const result = computeBoldMath(op, [number(a), number(b)]);
    assert.equal(result.value, value); assert.equal(result.exact, exact);
  }
  for (const [op, a, b] of [["compare", "$3K", "$10K"], ["divide", "3", "4"], ["per", "10", "0"], ["multiply", "$3", "$4"], ["add", "$3", "€4"], ["percent", "$16", "$40"], ["multiply", "20%", "20%"]]) assert.equal(computeBoldMath(op, [number(a), number(b)]), null);
  assert.equal(computeBoldMath("add", []), null); assert.equal(computeBoldMath("add", [{ value: NaN }, number("1")]), null);
});

test("only complete spoken ranges earn rows; values and screen copy from Claude are ignored", () => {
  const { context: c, pick } = fixture();
  const valid = validateMathPick({ ...pick, value: 999999, text: "made up" }, c);
  assert.ok(valid); assert.equal(valid.value, undefined); assert.equal(valid.text, undefined);
  const lines = boldMathLines(pick, c);
  assert.deepEqual(lines.map((line) => line.text), ["20%", "$10000", "= $2000"]);
  assert.deepEqual(lines.map((line) => line.frame), [120, 147, 183]);
  for (const bad of [{ operation: "divide" }, { numbers: [pick.numbers[0]] }, { numbers: [pick.numbers[0], { from: 3, to: 3 }] }, { numbers: [{ from: 0, to: 0 }, pick.numbers[1]] }, { numbers: [pick.numbers[0], pick.numbers[0]] }, { numbers: [{ ...pick.numbers[0], label: { from: 0, to: 999 } }, pick.numbers[1]] }, { result: { from: 3, to: 5 } }]) assert.equal(validateMathPick({ ...pick, ...bad }, c), null, JSON.stringify(bad));
  assert.deepEqual(boldMathLines({ ...pick, operation: "unknown" }, c), []);
  const qualified = fixture("about 20 percent of ten thousand dollars is two thousand dollars");
  assert.equal(validateMathPick({ ...qualified.pick, numbers: [{ from: 1, to: 2 }, { from: 4, to: 6 }], result: { from: 8, to: 10 } }, qualified.context), null);
  for (const env of [{ REEL_CLIENT: "fixture" }, { REEL_CLIENT_MODE: "1" }]) assert.equal(validateMathPick(pick, { ...c, env }), null);
  assert.equal(validateMathPick(pick, { ...c, plan: { ...c.plan, preset: "brand-fixture" } }), null);
});

test("exact results may be derived, comparisons and repeating division show only spoken operands", () => {
  const { context: c, pick } = fixture();
  const derived = boldMathLines({ ...pick, result: undefined }, c);
  assert.equal(derived.at(-1).text, "= $2000"); assert.equal(derived.at(-1).frame, 151);
  assert.equal(boldMathLines({ ...pick, operation: "compare", result: undefined }, c).length, 2);
  const divide = fixture("ten per three");
  const per = { ...divide.pick, operation: "per", numbers: [{ from: 0, to: 0 }, { from: 2, to: 2 }], result: undefined };
  assert.equal(boldMathLines(per, divide.context).length, 2);
  const wrong = fixture("20 percent of ten thousand dollars is three thousand dollars");
  assert.equal(boldMathLines(wrong.pick, wrong.context).length, 2, "wrong spoken equation must not be endorsed");
  const rate = fixture("40 booked and 16 showed is 40 percent");
  const ratePick = { ...rate.pick, operation: "percent", numbers: [{ from: 3, to: 3, label: { from: 4, to: 4 } }, { from: 0, to: 0, label: { from: 1, to: 1 } }], result: { from: 6, to: 7 } };
  assert.deepEqual(boldMathLines(ratePick, rate.context).map((line) => [line.text, line.label]), [["40", "booked"], ["16", "showed"], ["= 40%", ""]]);
});

test("math stays beside the face, above captions, under 40% width and within hard budgets", () => {
  const { context: c, pick } = fixture();
  const validated = validateBoldOverlay(pick, c), event = placeBoldOverlays([validated], c)[0];
  assert.ok(event); assert.ok(event.box.w <= 432); assert.ok(event.box.x + event.box.w < c.zones.faces[0].x);
  assert.ok(event.box.y + event.box.h < c.zones.caption.y); assert.equal(boldBoxesOverlap(event.box, c.zones.faces[0]), false);
  const mirror = { ...c, zones: { ...c.zones, faces: [{ ...c.zones.faces[0], x: 120 }] } };
  assert.ok(placeBoldOverlays([validated], mirror)[0].box.x >= 452);
  const full = { ...c, zones: { ...c.zones, faces: [{ ...c.zones.faces[0], x: 76, w: 928 }] } };
  assert.deepEqual(placeBoldOverlays([validated], full), []);
  assert.deepEqual(placeBoldOverlays([validated], { ...c, zones: { ...c.zones, measured: false } }), []);
  assert.equal(placeBoldOverlays([validated, validated], c).length, 1);
  assert.deepEqual(placeBoldOverlays([validated], { ...c, settings: { ...c.settings, math: { ...c.settings.math, max: 0 } } }), []);
  const html = boldOverlayHandler("math").html(event, { esc: (text) => String(text).replace(/</g, "&lt;"), i: 0 });
  assert.match(html, /bold-math-result/); assert.match(html, /20%/);
  const sounds = boldOverlayHandler("math").sounds(event, c); assert.deepEqual(sounds, []);
  const audible = boldOverlayHandler("math").sounds(event, { ...c, settings: { ...c.settings, math: { ...c.settings.math, resultSound: true } } });
  assert.equal(audible.length, 1); assert.equal(audible[0].start, eventClock({ landAt: 183 / 30, sfx: "card.wav", fps: 30 }).start);
});

test("math rows cut on exact frames and survive forward, reverse and shuffled GSAP seeks", (t) => {
  const { context: c, pick } = fixture(), handler = boldOverlayHandler("math");
  const event = placeBoldOverlays([validateBoldOverlay(pick, c)], c)[0];
  const sandbox = { console, setTimeout, clearTimeout }; sandbox.window = sandbox; sandbox.global = sandbox;
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), sandbox);
  const gsap = sandbox.gsap, timeline = gsap.timeline({ paused: true }), targets = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const target = (id) => { if (!targets.has(id)) targets.set(id, { opacity: 0 }); return targets.get(id); };
  const tl = { set: (id, ...args) => { timeline.set(target(id), ...args); return tl; } };
  const code = handler.timeline(event, { i: 0, plan: c.plan }); new Function("tl", code)(tl);
  assert.doesNotMatch(code, /onUpdate|onComplete|Math.random|Date.now/);
  const sample = (frame) => { timeline.totalTime(frame / 30, false); return [...targets.values()].map((item) => item.opacity); };
  const frames = Array.from({ length: 600 }, (_, i) => i), forward = frames.map(sample);
  for (const frame of [...frames].reverse()) assert.deepEqual(sample(frame), forward[frame], `reverse ${frame}`);
  for (const frame of frames.map((i) => i * 137 % 600)) assert.deepEqual(sample(frame), forward[frame], `shuffle ${frame}`);
  for (let i = 0; i < event.data.lines.length; i++) {
    const frame = event.data.lines[i].frame;
    assert.equal(forward[frame - 1][i + 1], 0); assert.equal(forward[frame][i + 1], 1);
  }
});

test("registered evidence overlays preserve byte-identical HTML for every existing preset and client look", () => {
  const expected = { clean: "ad9cc68d543e4107981dede25e654040ecb03a202e098fd6b867c5237770bc85", "pingel-brand": "4eb4d6a574f49395fd8c951946f3ce715d4302693118df5b502bf1c6715ecad3", "pingel-runway": "4eb4d6a574f49395fd8c951946f3ce715d4302693118df5b502bf1c6715ecad3", "pingel-v2": "307483b2092fa537163dda7739cd3fb2e6936ca8296122943ce647629b773830", speaker: "9b2e4191af94d57d2629fac3458cf4130fc6ba020162ef2b0b08ef1079e9f044", vsl: "91efe2ca41328efea454a587b14623b047ab1ecacb4b19a0d8bbb8f6b3b756d6", youtube: "5f816a16952920dc71c1466176e7668d52561baca99c025e70facade0df6b621" };
  const digest = (plan) => createHash("sha256").update(renderHTML(plan, "assets/footage.mp4")).digest("hex");
  for (const [preset, hash] of Object.entries(expected)) {
    const plan = fixturePlan("/fixture.mp4"); plan.style = loadPreset(preset); plan.preset = preset;
    assert.equal(digest(plan), hash, preset); assert.doesNotMatch(renderHTML(plan, "assets/footage.mp4"), /bold-proof|bold-definition|bold-math/);
  }
  const client = fixturePlan("/fixture.mp4"); client.style.captions.style = "glow"; client.glowScenes = []; client.glowOverlays = [];
  assert.equal(digest(client), "1f352cb80d58644128375a2442b41591a500cf81e7b2d45ef739338e7c2b0f14");
  client.preset = "brand-fixture"; client.style.name = "brand-fixture"; client.style.colors = { text: "#fafafa", accent: "#b1bbcc", stroke: "#141424", bg: "#1a1b2a" };
  Object.assign(client.style.captions, { style: "reveal", uppercase: false, animation: "cut", dimFuture: false });
  assert.equal(digest(client), "1653bbb274e2dd1a2ee9fdcaa51283d65d9b012fd7f773a2b8e2375c67b013ab");
});
