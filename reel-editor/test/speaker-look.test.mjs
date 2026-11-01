import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lookOptions, activeBox, defaultFit, fitGraph, pushScale, pushFilter, neutralStats, skinWeight, gradeSettings, gradePixel, gradeCube, prepareGrade, stabilizationKey, stabilizeRange, lookReviewFrames, letterboxCards, filterPath } from "../src/speaker-look.mjs";
import { fitGeometry, resolvePlan, compileVersion } from "../src/speaker-compile.mjs";
import { speakerHTML, composeSpeakerProject } from "../src/speaker-compose.mjs";
import { speakerCardsHTML } from "../src/speaker-cards.mjs";
import { resolveBrandTokens } from "../src/brandtokens.mjs";
import { probeSource } from "../src/speaker-index.mjs";
import { run, writeJSON } from "../src/util.mjs";

const brand = { name: "Jane Doe", fonts: { display: "Georgia", body: "Arial" }, colors: { text: "#FFFFFF", accent: "#FFB27D", bg: "#111111" } };
const tokens = resolveBrandTokens({ brand, preset: {} });
const manifest = { schemaVersion: 1, clientId: "jane", identity: { name: "Jane Doe", roleLine: "Speaker", bookingMode: "direct", bookingUrl: "https://example.test", bookingText: "Book Jane" }, brand: { file: "brand.json" }, sources: [{ id: "phone", path: "phone.mp4", kind: "broll", audio: "none", handheld: true, rights: "r1" }], proof: [], rights: [{ id: "r1", status: "approved" }] };
const plan = { schemaVersion: 1, clientId: "jane", version: "full", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 }, items: [{ id: "a", kind: "clip", sourceId: "phone", in: 0, out: 2, audio: "mute", role: "room" }], cutaways: [], overlays: [] };
const index = { sources: { phone: { width: 360, height: 640, duration: 3 } } };
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-look-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

// Frame metadata and graphs are checked as well as real pixels: no browser or network involved.
test("look defaults, automatic fit and explicit per-item choices resolve without mutating plans", () => {
  assert.deepEqual(lookOptions(), { grade: "auto", letterbox: null });
  for (const look of [{ grade: "wild" }, { letterbox: 2 }, null, []]) assert.throws(() => lookOptions(look), /look/);
  assert.equal(defaultFit({ width: 720, height: 1280 }), "blur");
  assert.equal(defaultFit({ width: 320, height: 180 }), "blur");
  assert.equal(defaultFit({ width: 1920, height: 1080 }), "contain");
  assert.equal(defaultFit({ width: 1152, height: 648 }), "contain");
  const resolved = resolvePlan(plan, { manifest, index });
  assert.equal(resolved.items[0].fit, "blur"); assert.equal(resolved.items[0].stabilize, true);
  assert.equal(resolved.items[0].push, 1); assert.equal(plan.items[0].fit, undefined);
  const p = structuredClone(plan); p.items[0].fit = "contain"; p.items[0].stabilize = false; p.items[0].look = { grade: "off" };
  p.cutaways = [{ id: "x", over: "a", offset: 0, sourceId: "phone", in: 0, out: 1.6, fit: "blur" }];
  const r = resolvePlan(p, { manifest, index }); assert.equal(r.items[0].fit, "contain"); assert.equal(r.items[0].stabilize, false); assert.equal(r.cutaways[0].push, 1.06);
  p.cutaways[0].out = 1.5; assert.equal(resolvePlan(p, { manifest, index }).cutaways[0].push, 1);
  for (const [key, value] of [["push", 0.5], ["push", 2], ["stabilize", "yes"], ["look", { grade: "bad" }]]) { const bad = structuredClone(plan); bad.items[0][key] = value; assert.throws(() => resolvePlan(bad, { manifest, index }), /a:/); }
});

test("blur graph preserves sharp portrait and small foregrounds with a blurred, darker frame", () => {
  for (const meta of [{ width: 720, height: 1280 }, { width: 320, height: 180 }, { width: 1920, height: 1080 }]) {
    const g = fitGeometry(meta, "blur"), graph = fitGraph("0:v", "picture", g, { fit: "blur", frames: 30 }).join(";");
    assert.ok(g.scale <= 1.5); assert.match(graph, /split=2/); assert.match(graph, /gblur=sigma=40/); assert.match(graph, /saturation=0.8/); assert.match(graph, /0.65/);
    assert.match(graph, /format=yuva420p,pad=/); assert.match(graph, /overlay=0:0/);
  }
  const cover = fitGraph("0:v", "pic", fitGeometry({ width: 1920, height: 1080 }, "cover"), { fit: "cover", frames: 30 }).join(";");
  assert.match(cover, /crop=1920:1080/); assert.doesNotMatch(cover, /gblur/);
  const contain = fitGraph("0:v", "pic", fitGeometry({ width: 320, height: 180 }), { frames: 30, push: 1.06 }).join(";");
  assert.match(contain, /scale=452:254/); // End enlargement stays below 1.5x.
});

test("grade limits exposure, ignores coloured stages and preserves skin hue across complexions", () => {
  for (const luma of [0.001, 0.1, 0.42, 0.8, 1]) assert.ok(Math.abs(gradeSettings({ luma }).ev) <= 0.3);
  assert.equal(gradeSettings({ luma: 0.001 }).ev, 0.3); assert.equal(gradeSettings({ luma: 1 }).ev, -0.3);
  const neutral = { r: 0.5, g: 0.6, b: 0.4, fraction: 0.5 };
  assert.deepEqual(gradeSettings({ saturation: 0.8 }, neutral).balance, [0, 0, 0]);
  const settings = gradeSettings({ luma: 0.35, saturation: 0.3 }, neutral);
  assert.ok(settings.balance.every((v) => Math.abs(v) <= 0.015)); assert.ok(settings.balance[1] < 0 && settings.balance[2] > 0);
  const hue = ([r, g, b]) => 60 * (g - b) / (Math.max(r, g, b) - Math.min(r, g, b));
  for (const skin of [[0.76, 0.5, 0.36], [0.42, 0.27, 0.18], [0.9, 0.73, 0.64]]) {
    assert.equal(skinWeight(skin), 1); assert.ok(Math.abs(hue(skin) - hue(gradePixel(skin, settings))) < 0.0001);
  }
  assert.equal(skinWeight([0.4, 0.4, 0.4]), 0); assert.equal(skinWeight([0.2, 0.5, 0.8]), 0);
  assert.equal(neutralStats(Buffer.from([0, 0, 0, 255, 0, 0])), null);
  const measured = neutralStats(Buffer.from([128, 140, 128, 128, 140, 128])); assert.equal(measured.count, 2); assert.ok(measured.g > measured.r);
  assert.match(gradeCube(settings, 3), /LUT_3D_SIZE 3/); assert.equal(gradeCube(settings, 3).trim().split("\n").length, 31);
  assert.throws(() => gradeCube(settings, 1), /LUT size/);
});

test("push is frame-driven, smooth, monotonic and reaches exact endpoints", () => {
  const values = Array.from({ length: 60 }, (_, n) => pushScale(n, 60, 1.06));
  assert.equal(values[0], 1); assert.equal(values.at(-1), 1.06);
  assert.ok(values.every((v, n) => !n || v >= values[n - 1]));
  assert.equal(pushScale(100, 60, 1.06), 1.06); assert.equal(pushScale(0, 1, 1.06), 1);
  assert.match(pushFilter(60, 1.06), /scale=7680:4320.*on\/59/);
  assert.equal(pushFilter(60, 1), ""); assert.throws(() => pushScale(1, 30, NaN), /push/);
});

test("stabilisation cache includes source identity, range and settings and fails open once", async (t) => {
  const dir = temp(t), range = { in: 2, out: 3, duration: 10 }, key = stabilizationKey("source", range);
  assert.equal(key, stabilizationKey("source", { ...range }));
  assert.notEqual(key, stabilizationKey("other", range)); assert.notEqual(key, stabilizationKey("source", { ...range, out: 4 }));
  assert.notEqual(key, stabilizationKey("source", range, { zoom: 4 })); assert.notEqual(key, stabilizationKey("source", range, { preFilter: "transpose=clock" }));
  const logs = [], calls = [];
  const failed = await stabilizeRange("original.mp4", range, { sourceKey: "source", cacheDir: dir, execute: async () => { throw new Error("no vidstab"); }, print: (s) => logs.push(s) });
  assert.equal(failed.file, "original.mp4"); assert.equal(failed.in, 2); assert.equal(failed.stabilized, false); assert.equal(logs.length, 1);
  const transformLogs = [];
  const badTransform = await stabilizeRange("original.mp4", range, { sourceKey: "bad-transform", cacheDir: dir, execute: async () => {}, encodeVideo: async (_, tail) => { fs.writeFileSync(tail.at(-1), "partial"); throw new Error("bad transform"); }, print: (s) => transformLogs.push(s) });
  assert.equal(badTransform.stabilized, false); assert.equal(transformLogs.length, 1); assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith(".pending.mov")));
  const good = await stabilizeRange("original.mp4", range, { sourceKey: "source", cacheDir: dir, execute: async (_, args) => calls.push(args), encodeVideo: async (args, tail) => { calls.push(args); fs.writeFileSync(tail.at(-1), "cached picture"); } });
  assert.equal(good.in, 1); assert.equal(good.stabilized, true); assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("1") && calls[0].includes("3")); assert.match(calls[1].join(" "), /vidstabtransform.*zoom=3/);
  const cached = await stabilizeRange("original.mp4", range, { sourceKey: "source", cacheDir: dir, execute: async () => assert.fail("cache miss") }); assert.equal(cached.file, good.file);
});

test("source measurements are cached and optional review extraction fails open", async (t) => {
  const dir = temp(t); let measures = 0, samples = 0;
  const seeks = [], measureOptions = [];
  const options = { sourceKey: "stable", meta: { duration: 24 }, cacheDir: dir, measure: async (_, opts) => { measures++; measureOptions.push(opts); return { luma: 0.4 }; }, execute: async (_, args) => { samples++; seeks.push(Number(args[args.indexOf("-ss") + 1])); fs.writeFileSync(args.at(-1), Buffer.from([128, 140, 128])); } };
  const first = await prepareGrade("source.mp4", options), second = await prepareGrade("source.mp4", options);
  assert.equal(first.filter, second.filter); assert.equal(measures, 1); assert.ok(fs.existsSync(first.lut));
  // A keynote is sampled by twelve seeks, never a full decode, and the cache means no second pass.
  assert.equal(samples, 12); assert.deepEqual(seeks, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]); assert.equal(measureOptions[0].seek, true);
  const logs = [], fallback = await prepareGrade("source.mp4", { ...options, sourceKey: "broken", measure: async () => { throw new Error("bad"); }, print: (s) => logs.push(s) });
  assert.equal(fallback.fallback, true); assert.equal(logs.length, 1);
  assert.equal(await lookReviewFrames("source.mp4", { dir, name: "source", execute: async () => { throw new Error("bad"); }, print: (s) => logs.push(s) }), false); assert.equal(logs.length, 2);
  const calls = []; assert.equal(await lookReviewFrames("source.mp4", { dir, name: "source", execute: async (_, args) => { calls.push(args); fs.writeFileSync(args.at(-1), "review frame"); } }), true); assert.equal(calls.length, 2);
  assert.match(filterPath("/tmp/a:b.cube"), /\\\\:/);
});

test("letterbox boxes and client card placements stay inside the active picture at full readable type sizes", () => {
  assert.deepEqual(activeBox(), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(activeBox(2.35), { x: 0, y: 131, width: 1920, height: 818 }); assert.equal(activeBox(2.39).height, 804);
  assert.throws(() => activeBox(2), /letterbox/);
  const p = { ...plan, duration: 8, look: { letterbox: 2.35 }, items: [{ id: "title", kind: "card", start: 0, end: 4, card: { type: "title" } }, { id: "book", kind: "card", start: 4, end: 10, card: { type: "booking" } }], overlays: [{ id: "name", at: "title", start: 0, end: 4, card: { type: "testimonial-name", name: "Sam" } }] };
  const m = { ...manifest, proof: [{ id: "sam", kind: "testimonial-video", attribution: { name: "Sam" }, rights: "r1" }] };
  const raw = speakerCardsHTML(p, { manifest: m, tokens, log: () => {} }); const boxed = letterboxCards(raw, activeBox(2.35), p);
  assert.equal(letterboxCards(raw, activeBox()), raw);
  boxed.review.forEach((row, i) => { assert.ok(row.layout.y >= 131); assert.ok(row.layout.y + row.layout.h <= 949); assert.equal(row.layout.name.fontSize, raw.review[i].layout.name.fontSize); });
  const html = speakerHTML(p, { manifest: m, cards: boxed }); assert.match(html, /speaker-letterbox top/); assert.match(html, /height:131px/); assert.match(boxed.css, /inset:131px 0 131px/);
  assert.throws(() => letterboxCards({ ...raw, review: [{ ...raw.review[0], layout: { ...raw.review[0].layout, h: 1000 } }] }, activeBox(2.35), p), /cannot fit/);
});

test("lavfi: blur keeps portrait sharp over visible background; small source, push, LUT and two-pass stabilisation run", { timeout: 120000 }, async (t) => {
  const dir = temp(t), file = path.join(dir, "phone.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x668899:s=160x240:r=30:d=2", "-vf", "drawbox=x=40:y=40:w=80:h=160:color=0xC28262:t=fill", "-c:v", "libx264", "-preset", "ultrafast", file], { capture: true });
  const meta = await probeSource(file), grade = await prepareGrade(file, { sourceKey: "lavfi", meta, cacheDir: dir });
  assert.equal(grade.fallback, undefined); assert.ok(Math.abs(grade.settings.ev) <= 0.3);
  const graph = [`[0:v]${grade.filter}[graded]`, ...fitGraph("graded", "pic", fitGeometry(meta, "blur", { width: 320, height: 180 }), { fit: "blur", frames: 3, width: 320, height: 180, push: 1.06 })].join(";");
  const raw = path.join(dir, "frame.rgb");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-filter_complex_threads", "1", "-i", file, "-filter_complex", graph, "-map", "[pic]", "-frames:v", "3", "-pix_fmt", "rgb24", "-f", "rawvideo", raw], { capture: true });
  const pixels = fs.readFileSync(raw); assert.equal(pixels.length, 320 * 180 * 3 * 3);
  const edge = [...pixels.subarray(0, 3)], center = [...pixels.subarray((90 * 320 + 160) * 3, (90 * 320 + 160) * 3 + 3)];
  assert.ok(edge.some((v) => v > 20), `blur background visible: ${edge}`); assert.ok(center[0] > edge[0] + 35, `foreground opaque and sharp: ${center}, ${edge}`);
  const stabDir = path.join(dir, "Jane's : [stable], picture");
  const logs = [], stable = await stabilizeRange(file, { in: 0.2, out: 0.6, duration: 2 }, { sourceKey: "lavfi", cacheDir: stabDir, print: (s) => logs.push(s) });
  // Homebrew's ffmpeg ships without libvidstab (the Mini's does); there the fallback keeps the original picture.
  const vidstab = /vidstabdetect/.test((await run("ffmpeg", ["-hide_banner", "-filters"], { capture: true })).out);
  if (vidstab) { assert.equal(stable.stabilized, true, logs.join("\n")); assert.ok((await probeSource(stable.file)).duration >= 1.5); }
  else { assert.equal(stable.stabilized, false); assert.equal(stable.file, file); assert.match(logs.join("\n"), /stabilisation unavailable/); }
  assert.equal(await lookReviewFrames(file, { at: 0.2, afterFilter: grade.filter, dir, name: "test" }), true); assert.ok(fs.existsSync(path.join(dir, "test-after.jpg")));
});

test("lavfi colour bars and skin patch retain hue through the actual ffmpeg LUT", async (t) => {
  const dir = path.join(temp(t), "Jane's : [look], colour"); fs.mkdirSync(dir);
  const lut = path.join(dir, "grade.cube"), raw = path.join(dir, "patch.rgb");
  fs.writeFileSync(lut, gradeCube(gradeSettings({ luma: 0.25 }, { r: 0.5, g: 0.6, b: 0.4, fraction: 1 })));
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "smptebars=s=320x180:d=0.1", "-vf", `drawbox=x=0:y=0:w=32:h=32:color=0xC28262:t=fill,format=rgb24,split[a][b];[b]lut3d=file=${filterPath(lut)}:interp=tetrahedral[c];[a][c]hstack`, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", raw], { capture: true });
  const data = fs.readFileSync(raw), a = [...data.subarray((10 * 640 + 10) * 3, (10 * 640 + 10) * 3 + 3)], b = [...data.subarray((10 * 640 + 330) * 3, (10 * 640 + 330) * 3 + 3)];
  const hue = ([r, g, b]) => 60 * (g - b) / (r - b);
  assert.ok(Math.abs(hue(a) - hue(b)) < 2, `${a} -> ${b}`); assert.ok(b[0] >= a[0]);
});

test("compiled look keeps cutaway and audio clocks exact, writes review evidence and composes active-area cards", { timeout: 120000 }, async (t) => {
  const dir = temp(t), file = path.join(dir, "phone.mp4");
  writeJSON(path.join(dir, "brand.json"), brand);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=160x240:r=30:d=1", "-c:v", "libx264", "-preset", "ultrafast", file], { capture: true });
  const meta = await probeSource(file), p = structuredClone(plan), m = structuredClone(manifest);
  p.look = { grade: "auto", letterbox: 2.35 }; p.items[0].out = 0.4; p.items[0].stabilize = true;
  p.items.push({ id: "booking", kind: "card", duration: 6, role: "booking", card: { type: "booking" } });
  p.cutaways = [{ id: "x", over: "a", offset: 0.1, sourceId: "phone", in: 0.2, out: 0.4, push: 1.06, look: { grade: "off" } }];
  const compiled = await compileVersion(dir, p, { manifest: m, index: { sources: { phone: { ...meta, words: [] } } }, tokens, encoder: "libx264", print: () => {} });
  const out = await probeSource(compiled.base); assert.ok(Math.abs(out.videoDuration - 6.4) < 1 / 30); assert.ok(Math.abs(out.videoDuration - out.audioStreams[0].duration) <= 1 / 30);
  assert.equal(compiled.resolvedPlan.cutaways[0].startFrame, 3); assert.equal(compiled.resolvedPlan.cutaways[0].endFrame, 9);
  const evidence = fs.readdirSync(path.join(compiled.workDir, "look")); assert.equal(evidence.filter((f) => f.endsWith(".jpg")).length, 4);
  assert.equal(JSON.parse(fs.readFileSync(path.join(compiled.workDir, "look", "look.json"))).sources.phone.fallback, false);
  assert.ok(compiled.resolvedPlan.problems.some((p) => /active image 1920x818/.test(p.message)));
  const project = await composeSpeakerProject(compiled.workDir, compiled.resolvedPlan, { manifest: m, tokens, print: () => {} });
  assert.match(fs.readFileSync(project.html, "utf8"), /speaker-letterbox top/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(compiled.workDir, "composition.json"))).activeBox.height, 818);
  const joins = { ...p, version: "joins", look: { grade: "off" }, items: Array.from({ length: 11 }, (_, n) => ({ ...p.items[0], id: `join${n}`, in: 0, out: 0.1, stabilize: false })), cutaways: [], overlays: [] };
  const joined = await compileVersion(dir, joins, { manifest: m, index: { sources: { phone: { ...meta, words: [] } } }, tokens, encoder: "libx264", print: () => {} });
  const joinedMeta = await probeSource(joined.base); assert.equal(joined.resolvedPlan.frames, 33); assert.ok(Math.abs(joinedMeta.videoDuration - 1.1) <= 1 / 30); assert.ok(Math.abs(joinedMeta.videoDuration - joinedMeta.audioStreams[0].duration) <= 1 / 30);

});

test("letterbox keeps a keyword card where it was placed and checks insert content against the reduced box", async () => {
  const { letterboxCards } = await import("../src/speaker-look.mjs");
  const box = { y: 131, height: 818 };
  const plan = { items: [{ id: "q1", kind: "card" }], overlays: [{ id: "k1" }, { id: "k2" }] };
  const fragment = { css: "", review: [
    { id: "q1", type: "quote", mode: "insert", layout: { x: 96, inset: 96, h: 888, contentHeight: 400 } },
    { id: "k1", type: "keyword", mode: "overlay", position: "center", layout: { x: 192, h: 146 } },
    { id: "k2", type: "keyword", mode: "overlay", position: "lower-third", layout: { x: 192, h: 146 } }] };
  const out = letterboxCards(fragment, box, plan);
  const y = (id) => out.review.find((r) => r.id === id).layout.y - box.y;
  assert.ok(Math.abs(y("k1") - (818 - 146) / 2) < 1, "centred keyword stays centred in the active box");
  assert.ok(y("k2") > 818 * 0.6, "lower-third keyword stays low");
  const tall = { css: "", review: [{ id: "q1", type: "quote", mode: "insert", layout: { x: 96, inset: 96, h: 888, contentHeight: 700 } }] };
  assert.throws(() => letterboxCards(tall, box, { items: [{ id: "q1", kind: "card" }], overlays: [] }), /cannot fit inside letterbox/);
});
