import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validatePlan, resolvePlan, timelineWords, captionFiles, planUsage, fitGeometry, safeMonoFilter, compileVersion, dialogueLevel } from "../src/speaker-compile.mjs";
import { probeSource } from "../src/speaker-index.mjs";
import { speakerPreset } from "../src/brandkit.mjs";
import { run, writeJSON } from "../src/util.mjs";
import { runSpeaker, speakerMain } from "../src/speaker.mjs";
import { measureLoudness } from "../src/preflight.mjs";

const brand = { name: "Jane Doe", fonts: { display: "Playfair Display", body: "Montserrat" }, colors: { text: "#FFFFFF", accent: "#FFB27D", bg: "#111111" } };
const manifest = {
  schemaVersion: 1, clientId: "jane", identity: { name: "Jane Doe", roleLine: "Speaker", bookingMode: "direct", bookingUrl: "https://example.test", bookingText: "Book Jane" },
  brand: { file: "brand.json" }, sources: [
    { id: "stage", path: "footage/stage.mp4", kind: "stage", audio: "ok", rights: "r1" },
    { id: "phone", path: "footage/phone.mp4", kind: "broll", audio: "none", rights: "r1" },
  ], proof: [{ id: "quote", kind: "quote", text: "A true recommendation.", attribution: { name: "Sam", title: "Organizer", org: "Event" }, rights: "r1" }], rights: [{ id: "r1", status: "approved" }], music: [],
};
const index = { sources: {
  stage: { duration: 20, width: 1280, height: 720, words: [{ text: "Before", start: 1, end: 1.5 }, { text: "Hello", start: 2, end: 2.2 }, { text: "room.", start: 2.3, end: 2.7 }, { text: "After", start: 5.1, end: 5.5 }] },
  phone: { duration: 10, width: 720, height: 1280, words: [] },
} };
const plan = {
  schemaVersion: 1, clientId: "jane", version: "full", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 },
  items: [
    { id: "a", kind: "clip", sourceId: "stage", in: 2, out: 5, role: "core", protect: true },
    { id: "b", kind: "card", duration: 1, role: "identity", card: { type: "title" } },
    { id: "c", kind: "clip", sourceId: "phone", in: 1, out: 3, role: "room", audio: "mute" },
  ], overlays: [{ id: "o1", at: "a", offset: 0.5, duration: 1, card: { type: "quote", proofId: "quote" } }],
  cutaways: [{ id: "x1", over: "a", offset: 1, sourceId: "phone", in: 3, out: 4 }],
};
const options = { manifest, index };

test("sourceCrop validates clip/cutaway geometry and resolves fit from the cropped region", () => {
  const p = structuredClone(plan);
  const crop = { x: 0, y: 0.25, w: 1, h: 0.3125 }; // 720x400 landscape region of a portrait source
  p.items[2].sourceCrop = crop; p.items[2].fit = "cover";
  p.cutaways[0].sourceCrop = crop; p.cutaways[0].fit = "cover";
  assert.deepEqual(validatePlan(p, options), []);
  const resolved = resolvePlan(p, options);
  assert.deepEqual(resolved.items[2].framing.sourceCrop, { x: 0, y: 320, width: 720, height: 400 });
  assert.equal(resolved.items[2].framing.fitScale, 2.7);
  assert.equal(resolved.cutaways[0].framing.fitScale, 2.7);
  assert.equal(resolved.items[2].in, plan.items[2].in);
  assert.equal(resolved.items[2].out, plan.items[2].out);
  assert.deepEqual(timelineWords(resolved, index), timelineWords(resolvePlan(plan, options), index));
  assert.equal(p.items[2].framing, undefined);
  delete p.items[2].fit;
  assert.equal(resolvePlan(p, options).items[2].fit, "wash", "small cropped sources keep wash default");
  const large = structuredClone(index); large.sources.phone.width = 2160; large.sources.phone.height = 3840;
  assert.equal(resolvePlan(p, { manifest, index: large }).items[2].fit, "contain", "large landscape regions default to contain");
  p.items[2].sourceCrop.h = 1;
  assert.ok(validatePlan(p, options).some((e) => e.id === "c" && /sourceCrop/.test(e.message)));
  p.items[2].sourceCrop = { x: 0, y: 0, w: 1, h: 1 }; p.items[2].fit = "cover";
  assert.ok(validatePlan(p, options).some((e) => e.id === "c" && /landscape/.test(e.message)));
  for (const target of [p.items[1], p.overlays[0]]) target.sourceCrop = crop;
  assert.deepEqual(validatePlan(p, options).filter((e) => /sourceCrop requires a clip/.test(e.message)).map((e) => e.id), ["b", "o1"]);
  p.items[2].sourceCrop = null; p.cutaways[0].sourceCrop = [];
  assert.deepEqual(validatePlan(p, options).filter((e) => /sourceCrop must be an object/.test(e.message)).map((e) => e.id), ["c", "x1"]);
});

test("compiled rotated crops preserve same-moment cutaway frames, cap/warn and review evidence", { timeout: 120000 }, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-source-crop-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, "footage")); writeJSON(path.join(folder, "brand.json"), brand);
  const source = path.join(folder, "unrotated.mp4"), file = path.join(folder, "footage/phone.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "nullsrc=s=384x216:r=30:d=0.6,geq=lum='40+N*6+X/8+Y/8':cb=128:cr=128", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", source], { capture: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-display_rotation", "90", "-i", source, "-c", "copy", file], { capture: true });
  const meta = await probeSource(file);
  assert.deepEqual([meta.width, meta.height], [216, 384]); assert.ok(meta.rotationCw % 180 === 90);
  const m = structuredClone(manifest); m.sources = [m.sources[1]];
  const idx = { sources: { phone: { ...meta, words: [] } } };
  const crop = { x: 40 / 216, y: 154 / 384, w: 160 / 216, h: 90 / 384 };
  const p = { ...structuredClone(plan), look: { grade: "off" }, overlays: [], items: [
    { id: "a", kind: "clip", sourceId: "phone", in: 0, out: 0.6, role: "room", audio: "mute", fit: "contain", sourceCrop: crop, push: 1, stabilize: false },
  ], cutaways: [{ id: "same", over: "a", offset: 0.1, sourceId: "phone", in: 0.1, out: 0.3, fit: "cover", sourceCrop: crop, push: 1, stabilize: false }] };
  const messages = [];
  const result = await compileVersion(folder, p, { manifest: m, index: idx, encoder: "libx264", print: (message) => messages.push(message) });
  assert.ok(messages.some((s) => /a: requested 12.00x enlargement; limited to 1.5x/.test(s)));
  assert.ok(messages.some((s) => /same: requested 12.00x enlargement; review the landscape crop/.test(s)));
  const cut = result.resolvedPlan.cutaways[0];
  assert.deepEqual([cut.startFrame, cut.endFrame], [3, 9]);
  assert.deepEqual(result.resolvedPlan.items[0].framing.foreground, { width: 240, height: 136, scaleX: 1.5, scaleY: 136 / 90, endScaleX: 1.5, endScaleY: 136 / 90 });
  assert.deepEqual(result.map.find((row) => row.kind === "cutaway").framing, cut.framing);
  for (const entry of [result.resolvedPlan.items[0], cut]) {
    assert.equal(entry.framing.reviewFrames.length, 2);
    for (const name of entry.framing.reviewFrames) assert.ok(fs.statSync(path.join(result.workDir, name)).size > 0);
  }
  // Compare the centre against the manually rotated/cropped source on the original clock.
  const actual = path.join(folder, "actual.rgb"), reference = path.join(folder, "reference.rgb");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", result.base, "-vf", "crop=2:2:960:540,format=rgb24", "-f", "rawvideo", actual], { capture: true });
  const { rotateFilters } = await import("../src/hdr.mjs");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-noautorotate", "-i", file, "-vf", [...rotateFilters(meta.rotationCw), "crop=160:90:40:154", "crop=2:2:80:44", "format=rgb24"].join(","), "-f", "rawvideo", reference], { capture: true });
  const pixels = fs.readFileSync(actual), expected = fs.readFileSync(reference);
  assert.equal(pixels.length, 18 * 12); assert.equal(expected.length, pixels.length);
  let maxError = 0;
  for (let n = 0; n < pixels.length; n++) maxError = Math.max(maxError, Math.abs(pixels[n] - expected[n]));
  assert.ok(maxError <= 4, `source-clock centre maximum RGB error ${maxError}`);
  // On both sides of the half-open cutaway, the corner returns to the contain pad.
  const edges = path.join(folder, "edges.rgb");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", result.base, "-vf", "crop=2:2:0:0,format=rgb24", "-f", "rawvideo", edges], { capture: true });
  const edgePixels = fs.readFileSync(edges);
  for (let frame = 0; frame < 18; frame++) assert.equal(edgePixels[frame * 12] > 35, frame >= 3 && frame < 9, `cutaway visible at frame ${frame}`);
  const output = await probeSource(result.base);
  assert.ok(Math.abs(output.videoDuration - 0.6) < 1 / 30);
  assert.ok(Math.abs(output.videoDuration - output.audioStreams[0].duration) <= 1 / 30);
  t.diagnostic(`18/18 source-clock centres aligned (max RGB error ${maxError}); cutaway visible exactly at frames 3–8; 4 fitted JPEGs; contain 1.5x, cover 12x warns`);
  // Cover can begin below the ceiling and cross it only during the reviewed push.
  const coverFile = path.join(folder, "cover.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=red:s=1500x900:r=30:d=0.1", "-c:v", "libx264", "-preset", "ultrafast", coverFile], { capture: true });
  const coverManifest = structuredClone(m); coverManifest.sources[0].path = "cover.mp4";
  const coverPlan = { ...p, version: "cover-push", cutaways: [], items: [{ ...p.items[0], out: 0.1, fit: "cover", push: 1.2, sourceCrop: { x: 0, y: 0, w: 1440 / 1500, h: 810 / 900 } }] };
  const pushed = await compileVersion(folder, coverPlan, { manifest: coverManifest, index: { sources: { phone: await probeSource(coverFile) } }, encoder: "libx264", print: () => {} });
  assert.equal(pushed.resolvedPlan.items[0].framing.fitScale, 4 / 3);
  assert.ok(pushed.resolvedPlan.problems.some((problem) => /1.60x enlargement at end of push/.test(problem.message)));
});

test("plan validation and resolution leave protected source ranges intact and add no overlay time", () => {
  assert.deepEqual(validatePlan(plan, options), []);
  const resolved = resolvePlan(plan, options);
  assert.equal(resolved.duration, 6); assert.equal(resolved.frames, 180);
  assert.deepEqual(resolved.items.map((i) => [i.start, i.end]), [[0, 3], [3, 4], [4, 6]]);
  assert.deepEqual([resolved.overlays[0].start, resolved.overlays[0].end], [0.5, 1.5]);
  assert.deepEqual([resolved.cutaways[0].start, resolved.cutaways[0].end], [1, 2]);
  assert.equal(resolved.items[0].in, 2); assert.equal(resolved.items[0].out, 5);
  assert.equal(resolved.items[0].protect, true); assert.equal(resolved.items[0].fit, "contain");
  assert.equal(plan.items[0].start, undefined, "manual plan is not mutated");
  const fractional = structuredClone(plan); fractional.items[1].duration = 0.351;
  assert.equal(resolvePlan(fractional, options).items[1].frames, 11);
});

test("plan errors name missing sources, reversed/past-end ranges and invalid targets", () => {
  const cases = [
    [(p) => p.items[0].sourceId = "ghost", /a: unknown sourceId/],
    [(p) => p.items[0].in = p.items[0].out, /a: source range/],
    [(p) => p.items[0].out = 21, /a: out 21 is past/],
    [(p) => p.overlays[0].at = "gone", /o1: unknown overlay target/],
    [(p) => p.cutaways[0].over = "gone", /x1: cutaway target/],
    [(p) => p.items[2].fit = "cover", /c: cover requires a landscape/],
    [(p) => p.items[0].speed = 1.1, /a: speaker clips must stay/],
    [(p) => p.overlays[0].duration = 10, /o1: overlay extends/],
    [(p) => p.items[2].audio = "source", /c: source phone has no usable audio/],
    [(p) => p.version = "../escape", /version must be a safe/],
    [(p) => p.canvas.fps = 24, /1920x1080 at 30/],
    [(p) => p.items[1].card.name = "Invented Person", /must match supplied/],
  ];
  for (const [change, re] of cases) { const bad = structuredClone(plan); change(bad); assert.throws(() => resolvePlan(bad, options), re); }
});

test("cutaway overlap is rejected at output-frame precision; abutting cutaways work", () => {
  const bad = structuredClone(plan);
  bad.cutaways.push({ ...bad.cutaways[0], id: "x2", offset: 1.5 });
  assert.ok(validatePlan(bad, options).some((p) => /overlaps x1/.test(p.message)));
  bad.cutaways[1].offset = 2;
  assert.deepEqual(validatePlan(bad, options), []);
  bad.cutaways[1].offset = 2.1;
  assert.ok(validatePlan(bad, options).some((p) => /extends past/.test(p.message)));
});

test("rights apply only to used sources and proof; draft warnings remain on resolved plan", () => {
  const m = structuredClone(manifest); m.rights[0].status = "pending";
  assert.throws(() => resolvePlan(plan, { manifest: m, index }), /approved rights required/);
  const draft = resolvePlan(plan, { manifest: m, index, draft: true });
  assert.equal(draft.problems.length, 3); assert.ok(draft.problems.every((p) => p.level === "warn"));
  m.sources.push({ id: "unused", rights: "missing" });
  m.rights[0].status = "approved";
  assert.deepEqual(validatePlan(plan, { manifest: m, index }), []);
  assert.deepEqual(planUsage(plan, manifest), { sourceIds: ["stage", "phone"], proofIds: ["quote"] });
});

test("inline proof cards and testimonial cutaways retain their permission provenance", () => {
  const p = structuredClone(plan), m = structuredClone(manifest);
  m.proof.push({ id: "t1", kind: "testimonial-video", sourceId: "phone", in: 0, out: 10, attribution: { name: "Sam", title: "Planner", org: "Event" }, rights: "pending" });
  m.rights.push({ id: "pending", status: "pending" });
  p.overlays[0].card = { type: "testimonial-name", name: "Sam", title: "Planner", org: "Event" };
  assert.deepEqual(planUsage(p, m).proofIds, ["t1"]);
  assert.throws(() => resolvePlan(p, { manifest: m, index }), /t1: rights pending/);
  p.overlays[0].card = { type: "topic", text: m.proof[0].text };
  assert.ok(planUsage(p, m).proofIds.includes("quote"));
});

test("quotes and logo walls cannot invent text or mix logo relationships", () => {
  const bad = structuredClone(plan); bad.overlays[0].card.text = "Words never supplied";
  assert.ok(validatePlan(bad, options).some((p) => /must match supplied/.test(p.message)));
  const m = structuredClone(manifest);
  m.proof[0].text = Array.from({ length: 26 }, () => "word").join(" ");
  assert.ok(validatePlan(plan, { manifest: m, index }).some((p) => /25 words/.test(p.message)));
  const wall = structuredClone(plan);
  wall.overlays[0].card = { type: "logo-wall", heading: "Spoke at", relationship: "spoke-at", logos: ["l1", "l2", "l3"] };
  for (const id of ["l1", "l2", "l3"]) m.proof.push({ id, kind: "logo", relationship: "spoke-at", rights: "r1" });
  assert.deepEqual(validatePlan(wall, { manifest: m, index }), []);
  m.proof.at(-1).relationship = "featured-in";
  assert.ok(validatePlan(wall, { manifest: m, index }).some((p) => /same relationship/.test(p.message)));
});

test("words slice and shift per dialogue item, preserve source provenance and ignore picture replacements", () => {
  const p = structuredClone(plan);
  p.items.push({ ...p.items[0], id: "d" });
  const words = timelineWords(resolvePlan(p, options), index);
  assert.deepEqual(words.map((w) => [w.text, w.start, w.end, w.sourceId, w.itemId]), [
    ["Hello", 0, 0.2, "stage", "a"], ["room.", 0.3, 0.7, "stage", "a"],
    ["Hello", 6, 6.2, "stage", "d"], ["room.", 6.3, 6.7, "stage", "d"],
  ]);
});

test("caption exports have SRT/VTT timecodes, readable two-line cues and no invented words", () => {
  const tokens = "Every real speaker deserves a clear and truthful reel that shows what the audience experienced.".split(" ");
  const words = tokens.map((text, i) => ({ text, start: 61 + i * 0.5, end: 61.4 + i * 0.5, sourceId: "stage", itemId: "a" }));
  const files = captionFiles(words, 72);
  assert.match(files.srt, /00:01:01,000 -->/);
  assert.match(files.vtt, /^WEBVTT\n\n1\n00:01:01\.000 -->/);
  assert.equal(files.cues.map((c) => c.text.replace(/\n/g, " ")).join(" "), tokens.join(" "));
  assert.ok(files.cues.every((c) => c.lines.length <= 2 && c.lines.every((l) => l.length <= 32)));
  assert.ok(files.cues.every((c) => c.cps <= 17.5));
  assert.equal(captionFiles([], 1).vtt, "WEBVTT\n\n\n");
  const short = captionFiles([{ text: "A very long real phrase", start: 0, end: 0.5, itemId: "short", itemEnd: 1 }], 5);
  assert.equal(short.cues[0].end, 1, "caption holds cannot spill onto a subsequent silent card");
});

test("fitGeometry preserves portrait and weak footage, warns above 1.5x and permits reviewed landscape cover", () => {
  const portrait = fitGeometry({ width: 720, height: 1280 });
  assert.equal(portrait.height, 1080); assert.equal(portrait.width, 608);
  const small = fitGeometry({ width: 320, height: 180 });
  assert.equal(small.scale, 1.5); assert.equal(small.width, 480); assert.match(small.warning, /limited/);
  const cover = fitGeometry({ width: 1280, height: 720 }, "cover");
  assert.equal(cover.width, 1920); assert.equal(cover.height, 1080);
  assert.throws(() => fitGeometry({ width: 720, height: 1280 }, "cover"), /landscape/);
  assert.equal(fitGeometry({ width: 0, height: 0 }).width, 1920);
  assert.deepEqual(fitGeometry({ width: 720, height: 1280 }, "wash"), fitGeometry({ width: 720, height: 1280 }, "blur"));
  assert.equal(fitGeometry({ width: 320, height: 180 }, "wash").scale, 1.5);
});

test("wash is accepted for items and cutaways; unknown fits still fail", () => {
  const p = structuredClone(plan); p.items[2].fit = "wash"; p.cutaways[0].fit = "wash";
  assert.deepEqual(validatePlan(p, options), []);
  const resolved = resolvePlan(p, options);
  assert.equal(resolved.items[2].fit, "wash"); assert.equal(resolved.cutaways[0].fit, "wash");
  p.items[2].fit = "unknown"; p.cutaways[0].fit = "unknown";
  assert.deepEqual(validatePlan(p, options).filter((p) => /invalid fit/.test(p.message)).map((p) => p.id), ["c", "x1"]);
});

test("mono channel selection protects cancelling microphones and keeps healthy stereo averaging", () => {
  assert.equal(safeMonoFilter({ leftDb: -12, rightDb: -13, mixDb: -90 }), "pan=mono|c0=c0");
  assert.equal(safeMonoFilter({ leftDb: -13, rightDb: -12, mixDb: -90 }), "pan=mono|c0=c1");
  assert.match(safeMonoFilter({ leftDb: -12, rightDb: -12, mixDb: -12 }), /0.5\*c0\+0.5\*c1/);
});

test("real speaker compile joins landscape, a one-second card, portrait and picture-only cutaway in sync", { timeout: 120000 }, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-compile-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, "footage"));
  writeJSON(path.join(folder, "brand.json"), brand);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=1", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-af", "pan=stereo|c0=c0|c1=-1*c0", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", path.join(folder, "footage", "stage.mp4")], { capture: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=25:d=1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(folder, "footage", "phone.mp4")], { capture: true });
  const m = structuredClone(manifest);
  writeJSON(path.join(folder, "speaker-manifest.json"), m);
  const idx = { sources: {} };
  for (const s of m.sources) idx.sources[s.id] = { ...await probeSource(path.join(folder, s.path)), words: [{ text: "Real", start: 0.1, end: 0.3 }, { text: "speech.", start: 0.4, end: 0.8 }] };
  const p = structuredClone(plan);
  p.items[0].in = 0; p.items[0].out = 1;
  p.items[2].in = 0; p.items[2].out = 1;
  // The portrait default is wash; this test checks the flat brand pad of "contain".
  p.items[2].fit = "contain";
  p.overlays[0].offset = 0; p.overlays[0].duration = 1;
  p.cutaways[0].offset = 0.5; p.cutaways[0].in = 0; p.cutaways[0].out = 0.5;
  const messages = [];
  const result = await compileVersion(folder, p, { manifest: m, index: idx, preset: speakerPreset(brand), tokens: speakerPreset(brand).brand, encoder: "libx264", print: (s) => messages.push(s) });
  const output = await probeSource(result.base);
  assert.equal(output.width, 1920); assert.equal(output.height, 1080); assert.equal(output.fps, 30);
  assert.equal(output.pixFmt, "yuv420p"); assert.equal(output.colorPrimaries, "bt709");
  assert.ok(Math.abs(output.duration - 3) <= 1 / 30);
  assert.ok(Math.abs(output.videoDuration - output.audioStreams[0].duration) <= 1 / 30);
  assert.equal(output.audioStreams[0].sampleRate, 48000); assert.equal(output.audioStreams[0].channels, 2);
  assert.ok((await measureLoudness(result.base)).i > -35, "opposite-phase input retains audible dialogue");
  assert.equal(result.map.filter((s) => s.kind === "cutaway").length, 1);
  assert.equal(result.words[0].sourceId, "stage");
  for (const name of ["map.json", "words.json", "plan.resolved.json", "captions.srt", "captions.vtt"]) assert.ok(fs.existsSync(path.join(result.workDir, name)), name);
  // Check the brand frame at a portrait edge without invoking Chrome.
  const raw = path.join(folder, "edge.rgb");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "2.2", "-i", result.base, "-vf", "crop=2:2:0:0,format=rgb24", "-frames:v", "1", "-f", "rawvideo", raw], { capture: true });
  assert.ok([...fs.readFileSync(raw)].every((v) => Math.abs(v - 17) <= 6));
  // Plan-only probes but never invokes injected transcription/compilation/composition.
  writeJSON(path.join(folder, "work", "plans", "full.json"), p);
  const summaries = await runSpeaker(folder, { planOnly: true }, { index: () => { throw new Error("ASR must not run"); }, compile: () => { throw new Error("compile must not run"); }, print: () => {} });
  assert.equal(summaries[0].summary.duration, 3);
  await assert.rejects(speakerMain([folder, "--plan-only", "--render-only"]), /choose either/);
  await t.test("eleven short joins retain the exact frame count and do not accumulate AAC delay", async () => {
    const joins = { ...p, version: "joins", items: Array.from({ length: 11 }, (_, n) => ({ ...p.items[0], id: `j${n}`, in: 0, out: 0.1 })), overlays: [], cutaways: [] };
    const compiled = await compileVersion(folder, joins, { manifest: m, index: idx, tokens: speakerPreset(brand).brand, encoder: "libx264", print: () => {} });
    const meta = await probeSource(compiled.base);
    assert.ok(Math.abs(meta.videoDuration - 1.1) <= 1 / 30);
    assert.ok(Math.abs(meta.videoDuration - meta.audioStreams[0].duration) <= 1 / 30);
  });
});

test("dialogue level: true-peak cap by default; opt-in limit takes full gain behind a -2 dBFS lookahead limiter", async (t) => {
  assert.equal(dialogueLevel({ i: -21.8, tp: -2.9 }).limiter, "");
  assert.equal(dialogueLevel({ i: -21.8, tp: -2.9 }).gain.toFixed(2), "1.40");
  const limited = dialogueLevel({ i: -21.8, tp: -2.9 }, { limit: true });
  assert.equal(limited.gain.toFixed(2), "5.80"); assert.match(limited.limiter, /^alimiter=limit=0.794:.*level=false:latency=true$/);
  assert.deepEqual(dialogueLevel({ i: -12, tp: -0.5 }, { limit: true }), { gain: -4, limiter: "" });
  assert.deepEqual(dialogueLevel({ i: -80, tp: -60 }, { limit: true }), { gain: 0, limiter: "" });
  const bad = structuredClone(plan); bad.items[0].limit = "yes"; bad.items[2].limit = true;
  const messages = validatePlan(bad, options).map((p) => `${p.id}: ${p.message}`);
  assert.ok(messages.includes("a: limit must be true or false") && messages.includes("c: limit needs source audio"), messages.join("\n"));
  // Real ffmpeg: a quiet tone with sharp spikes keeps its exact length and stays under the limit after +12 dB.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-limit-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pcm = Buffer.alloc(48000 * 4);
  for (let n = 0; n < 48000; n++) pcm.writeFloatLE(0.05 * Math.sin(2 * Math.PI * 300 * n / 48000) + (n % 4800 === 100 ? 0.25 : 0), n * 4);
  fs.writeFileSync(path.join(dir, "in.f32"), pcm);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", path.join(dir, "in.f32"), "-af", `volume=12dB,${limited.limiter}`, "-f", "f32le", path.join(dir, "out.f32")], { capture: true });
  const out = fs.readFileSync(path.join(dir, "out.f32"));
  assert.equal(out.length, pcm.length);
  let peak = 0; for (let n = 0; n < 48000; n++) peak = Math.max(peak, Math.abs(out.readFloatLE(n * 4)));
  assert.ok(peak <= 0.795, `limited peak ${peak}`);
  // Delay compensation keeps the tone where it was: the steady part matches the gained input within the limiter's margin.
  const at = 24000 + 2400, ratio = out.readFloatLE(at * 4) / (pcm.readFloatLE(at * 4) * 10 ** (12 / 20));
  assert.ok(Math.abs(ratio - 1) < 0.05, `aligned gain ratio ${ratio}`);
});

test("adjacent cutaways use one frame clock at 31, 47, 62 and 124 with no base flashes", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cutaway-frames-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const { cutawayGraph } = await import("../src/speaker-compile.mjs");
  const bounds = [31, 47, 62, 124, 140], colors = ["red", "lime", "blue", "white", "yellow"];
  const args = ["-y", "-loglevel", "error", "-filter_complex_threads", "1"];
  colors.forEach((color, n) => args.push("-f", "lavfi", "-i", `color=c=${color}:s=16x16:r=30:d=${n ? (bounds[n] - bounds[n - 1]) / 30 : 5}`));
  const graph = ["[0:v]null[base]"];
  let base = "base";
  for (let n = 0; n < 4; n++) {
    graph.push(`[${n + 1}:v]null[cut${n}]`, ...cutawayGraph(base, `cut${n}`, `pic${n}`, bounds[n], bounds[n + 1], `shift${n}`));
    base = `pic${n}`;
  }
  const raw = path.join(folder, "frames.rgb");
  await run("ffmpeg", [...args, "-filter_complex", graph.join(";"), "-map", `[${base}]`, "-frames:v", "150", "-pix_fmt", "rgb24", "-f", "rawvideo", raw], { capture: true });
  const pixels = fs.readFileSync(raw), expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [255, 255, 0]];
  assert.equal(pixels.length, 150 * 16 * 16 * 3);
  let maxError = 0;
  for (let frame = 0; frame < 150; frame++) {
    const cut = bounds.findIndex((start, n) => n < 4 && frame >= start && frame < bounds[n + 1]);
    const color = expected[cut < 0 ? 0 : cut + 1];
    for (let pixel = 0; pixel < 768; pixel++) {
      const error = Math.abs(pixels[frame * 768 + pixel] - color[pixel % 3]);
      maxError = Math.max(maxError, error);
      assert.ok(error <= 3, `frame ${frame}, component ${pixel}: ${pixels[frame * 768 + pixel]}`);
    }
  }
  t.diagnostic(`150/150 frames match; all 109 covered frames match their cutaway, zero base leaks; maximum RGB component error ${maxError}`);
});

test("audioCarry validates chronology, source audio, range, card length and immediate predecessor", () => {
  const p = structuredClone(plan); p.overlays = []; p.cutaways = [];
  p.items = [p.items[0], { ...p.items[1], audioCarry: { preceding: "a", sourceId: "stage", in: 5, out: 5.6 } }];
  assert.deepEqual(validatePlan(p, options), []);
  assert.deepEqual(planUsage(p, manifest).sourceIds, ["stage"]);
  assert.equal(timelineWords(resolvePlan(p, options), index).some((w) => w.text === "After"), false, "carry never adds caption words");
  const cases = [
    [(p) => p.items[1].audioCarry = [], /object/],
    [(p) => p.items[1].audioCarry.preceding = "other", /immediately preceding/],
    [(p) => p.items[1].audioCarry.sourceId = "phone", /same source|usable/],
    [(p) => p.items[1].audioCarry.in = 4.9, /contiguous/],
    [(p) => p.items[1].audioCarry.out = 6.5, /fit inside/],
    [(p) => p.items[1].audioCarry.out = 21, /past source/],
    [(p) => p.items[1].audioCarry.out = NaN, /source range/],
    [(p) => p.items[0].audio = "mute", /audible preceding/],
    [(p) => p.items[0].audioCarry = p.items[1].audioCarry, /card item/],
  ];
  for (const [change, message] of cases) {
    const bad = structuredClone(p); change(bad);
    assert.ok(validatePlan(bad, options).some((e) => message.test(e.message)), String(message));
  }
  for (const audio of ["bad", "none"]) {
    const m = structuredClone(manifest); m.sources[0].audio = audio;
    assert.ok(validatePlan(p, { manifest: m, index }).some((e) => e.id === "b" && /usable/.test(e.message)));
  }
  const noAudio = structuredClone(index); noAudio.sources.stage.hasAudio = false;
  assert.ok(validatePlan(p, { manifest, index: noAudio }).some((e) => e.id === "b" && /usable/.test(e.message)));
  p.items[1].audioCarry.in = 5 + 1 / 30;
  assert.equal(resolvePlan(p, options).items[1].audioCarry.in, 5, "within-frame authoring tolerance snaps to the source boundary");
  p.items[0].out = 5.01; p.items[1].audioCarry.in = 5.01;
  assert.equal(resolvePlan(p, options).items[1].audioCarry.in, 5, "carry follows the actual frame-rounded source end");
});

test("compiled card carries contiguous source audio with preceding gain, final 0.25s fade and silent padding", { timeout: 120000 }, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-carry-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, "footage")); writeJSON(path.join(folder, "brand.json"), brand);
  const pcm = Buffer.alloc(48000 * 2 * 2);
  for (let n = 0; n < 96000; n++) pcm.writeInt16LE(Math.round((n < 24000 ? 6000 : 1000) * Math.sin(2 * Math.PI * (n < 24000 ? 220 : 880) * n / 48000)), n * 2);
  const raw = path.join(folder, "source.s16"); fs.writeFileSync(raw, pcm);
  const file = path.join(folder, "footage/stage.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=32x18:r=30:d=2", "-f", "s16le", "-ar", "48000", "-ac", "1", "-i", raw, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "pcm_s16le", "-f", "mov", file], { capture: true });
  const m = structuredClone(manifest); m.sources = [m.sources[0]];
  const idx = { sources: { stage: { ...await probeSource(file), words: [{ text: "Close", start: 0.1, end: 0.3 }, { text: "Applause", start: 0.6, end: 0.9 }] } } };
  const p = { ...structuredClone(plan), look: { grade: "off" }, overlays: [], cutaways: [], items: [
    { id: "close", kind: "clip", sourceId: "stage", in: 0, out: 0.5, role: "close" },
    { id: "book", kind: "card", duration: 1, role: "booking", card: { type: "booking" }, audioCarry: { preceding: "close", sourceId: "stage", in: 0.5, out: 1.1 } },
  ] };
  const result = await compileVersion(folder, p, { manifest: m, index: idx, encoder: "libx264", print: () => {} });
  const read = async (name) => {
    const out = path.join(folder, `${name}.f32`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(result.workDir, `compile/${name}.wav`), "-ac", "1", "-f", "f32le", out], { capture: true });
    return fs.readFileSync(out);
  };
  assert.deepEqual(result.map.find((row) => row.itemId === "book").audioCarry, result.resolvedPlan.items[1].audioCarry);
  const clip = await read("close"), carry = await read("book");
  const rms = (b, start, end) => { let sum = 0; for (let n = Math.round(start * 48000); n < Math.round(end * 48000); n++) sum += b.readFloatLE(n * 4) ** 2; return Math.sqrt(sum / Math.round((end - start) * 48000)); };
  assert.ok(Math.abs(rms(carry, 0.1, 0.2) / rms(clip, 0.1, 0.2) - 1 / 6) < 0.002, "same dialogue gain rather than renormalized tail");
  let crossings = 0;
  for (let n = 4801; n < 9600; n++) if (carry.readFloatLE(n * 4) >= 0 && carry.readFloatLE((n - 1) * 4) < 0) crossings++;
  assert.ok(crossings >= 87 && crossings <= 88, "card starts in the contiguous 880 Hz source range");
  const gain = rms(clip, 0.1, 0.2) / (6000 / 32768 / Math.sqrt(2));
  let maxError = 0;
  for (let n = 0; n < 16000; n++) maxError = Math.max(maxError, Math.abs(carry.readFloatLE(n * 4) - pcm.readInt16LE((24000 + n) * 2) / 32768 * gain));
  assert.ok(maxError < 0.0001, `contiguous source samples differ by ${maxError}`);
  assert.ok(rms(clip, 0.48, 0.5) / rms(clip, 0.1, 0.12) > 0.95, "no outgoing fade before a carry");
  assert.ok(rms(carry, 0.58, 0.6) / rms(carry, 0.1, 0.12) < 0.06, "last 0.25s fades away");
  assert.equal(rms(carry, 0.6, 1), 0);
  assert.deepEqual(result.words.map((w) => w.text), ["Close"]);
  t.diagnostic(`carry: ${crossings} cycles/0.1s; RMS ratio ${(rms(carry, 0.1, 0.2) / rms(clip, 0.1, 0.2)).toFixed(5)}; padding RMS 0`);
});


test("lavfi: upright sourceCrop keeps the same-moment cutaway on exact first/last source frames", { timeout: 120000 }, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-source-crop-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  writeJSON(path.join(folder, "brand.json"), brand);
  const original = path.join(folder, "original.mp4"), file = path.join(folder, "rotated.mp4");
  const source = "nullsrc=s=160x240:r=30:d=1,geq=lum='if(between(X,16,143)*between(Y,80,151),32+N*4,200)':cb=128:cr=128,transpose=clock";
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", source, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", original], { capture: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-display_rotation:v:0", "90", "-i", original, "-c", "copy", file], { capture: true });
  const meta = await probeSource(file);
  assert.deepEqual([meta.width, meta.height, meta.rotationCw], [160, 240, 270]);
  const m = { ...manifest, sources: [{ id: "phone", path: "rotated.mp4", kind: "stage", audio: "none", rights: "r1" }], proof: [] };
  const p = { ...plan, look: { grade: "off" }, items: [{ id: "s7", kind: "clip", sourceId: "phone", in: 0, out: 1, role: "core", audio: "mute", fit: "contain", push: 1, stabilize: false }], overlays: [], cutaways: [{ id: "payoff", over: "s7", offset: 8 / 30, sourceId: "phone", in: 8 / 30, out: 18 / 30, fit: "cover", push: 1, stabilize: false, sourceCrop: { x: 16 / 160, y: 80 / 240, w: 128 / 160, h: 72 / 240 } }] };
  const messages = [], result = await compileVersion(folder, p, { manifest: m, index: { sources: { phone: meta } }, encoder: "libx264", print: (message) => messages.push(message) });
  assert.ok(messages.some((message) => /payoff: requested 15.00x enlargement/.test(message)), messages.join("\n"));
  const cut = result.resolvedPlan.cutaways[0];
  assert.equal(cut.framing.fitScale, 15);
  assert.deepEqual(cut.framing.sourceCrop, { x: 16, y: 80, width: 128, height: 72 });
  assert.deepEqual(cut.framing.reviewFrames, ["look/crop-payoff-first.jpg", "look/crop-payoff-last.jpg"]);
  for (const frame of cut.framing.reviewFrames) assert.ok(fs.statSync(path.join(result.workDir, frame)).size > 0);
  assert.equal(result.map.find((row) => row.kind === "cutaway").framing.fitScale, 15);
  const raw = path.join(folder, "frames.rgb");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", result.base, "-vf", "scale=192:108,format=rgb24", "-f", "rawvideo", raw], { capture: true });
  const data = fs.readFileSync(raw), frameSize = 192 * 108 * 3;
  assert.equal(data.length, frameSize * 30);
  const red = (n, x, y) => data[n * frameSize + (y * 192 + x) * 3];
  let maxError = 0;
  for (let n = 0; n < 30; n++) {
    const expected = (32 + n * 4 - 16) * 255 / 219;
    maxError = Math.max(maxError, Math.abs(red(n, 96, 54) - expected));
    assert.ok(Math.abs(red(n, 96, 54) - expected) <= 4, `source frame ${n}: ${red(n, 96, 54)} vs ${expected}`);
    if (n >= 8 && n < 18) assert.ok(Math.abs(red(n, 4, 4) - expected) <= 4, `crop visible exactly on frame ${n}`);
    else assert.ok(Math.abs(red(n, 4, 4) - 17) <= 4, `brand edge outside cutaway on frame ${n}`);
  }
  t.diagnostic(`rotated 160x240 source; crop 128x72 at 16,80; 30/30 source-frame centers match, cutaway visible on frames 8–17 only; maximum gray error ${maxError.toFixed(3)}`);
});


test("cropped foreground evidence includes wash margins, active area and actual push endpoints", () => {
  const p = structuredClone(plan), idx = structuredClone(index);
  p.look = { letterbox: 2.35 };
  idx.sources.phone = { ...idx.sources.phone, width: 2160, height: 3840 };
  p.items[2].sourceCrop = { x: 0, y: 650 / 3840, w: 1, h: 2400 / 3840 };
  p.items[2].fit = "wash"; p.items[2].push = 1.2;
  let r = resolvePlan(p, { manifest, index: idx }), f = r.items[2].framing.foreground;
  assert.ok(f.height * 1.2 <= 818 * 0.9);
  assert.ok(f.width * 1.2 <= 1920 * 0.9);
  assert.equal(f.endScaleY, f.scaleY * 1.2);
  assert.ok(f.endScaleX <= 1.5 && f.endScaleY <= 1.5);
  p.items[2].out = p.items[2].in + 1 / 30;
  r = resolvePlan(p, { manifest, index: idx }); f = r.items[2].framing.foreground;
  assert.equal(f.endScaleX, f.scaleX); assert.equal(f.endScaleY, f.scaleY);
});


test("cropped cover warns when push alone exceeds 1.5x, while a single frame has no push", { timeout: 120000 }, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-crop-push-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  writeJSON(path.join(folder, "brand.json"), brand);
  const file = path.join(folder, "source.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=red:s=1280x720:r=30:d=0.1", "-c:v", "libx264", "-preset", "ultrafast", file], { capture: true });
  const m = { ...manifest, sources: [{ id: "phone", path: "source.mp4", kind: "broll", audio: "none", rights: "r1" }], proof: [] };
  const idx = { sources: { phone: await probeSource(file) } };
  const p = { ...plan, look: { grade: "off" }, overlays: [], cutaways: [], items: [{ id: "push", kind: "clip", sourceId: "phone", in: 0, out: 0.1, role: "room", audio: "mute", fit: "cover", push: 1.06, sourceCrop: { x: 0, y: 0, w: 1, h: 1 } }] };
  const messages = [];
  let result = await compileVersion(folder, p, { manifest: m, index: idx, encoder: "libx264", print: (message) => messages.push(message) });
  assert.ok(messages.some((message) => /requested 1.59x enlargement at end of push/.test(message)));
  assert.equal(result.resolvedPlan.items[0].framing.foreground.endScaleX, 1.59);
  p.items[0].out = 1 / 30; messages.length = 0;
  result = await compileVersion(folder, p, { manifest: m, index: idx, encoder: "libx264", print: (message) => messages.push(message) });
  assert.equal(messages.some((message) => /enlargement/.test(message)), false);
  assert.equal(result.resolvedPlan.items[0].framing.foreground.endScaleX, 1.5);
});
