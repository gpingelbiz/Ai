import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validatePlan, resolvePlan, timelineWords, captionFiles, planUsage, fitGeometry, safeMonoFilter, compileVersion } from "../src/speaker-compile.mjs";
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
