import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { filmingTime, reconcileOrder, orderSignature, stitchVideo, recordOrder, clipFiles, explicitOrder } from "../src/stitch-order.mjs";
import { repeatedTake, samePlace, placeGroups, keptRanges, midWord, planStitch, stitchScenes } from "../src/stitch-plan.mjs";
import { previewRows, orderText, writeStitchPreview } from "../src/stitch-preview.mjs";
import { backgroundFingerprint, indexStitch } from "../src/stitch-index.mjs";
import { compileStitch, stitchAudioFilter, stitchVideoFilter } from "../src/stitch-master.mjs";
import { runStitch, stitchInputs, deliverStitch, verifyStitchSnapshot } from "../src/stitch.mjs";
import { run, readJSON } from "../src/util.mjs";
import { runEdit } from "../src/pipeline.mjs";
import { sourceCacheKey, probeSource } from "../src/speaker-index.mjs";

const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stitch-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const fingerprints = (v = 0) => Array.from({ length: 3 }, () => ({ signature: Array(8).fill(v) }));
const FAR = 10;
const words = (text, start = 1, step = 0.4) => text.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.3 }));
const clip = (text, n = 1, extra = {}) => ({ file: `/clip${n}.mov`, name: `clip${n}.mov`, key: String(n), duration: 10, words: words(text), fingerprint: fingerprints(), ...extra });
const row = (id, filmed, name = `${id}.mov`) => ({ id, name, filmed, size: 10, mtimeMs: 1 });

test("filming dates prefer creation_time, QuickTime next, then birth time", () => {
  assert.equal(filmingTime({ format: { tags: { creation_time: "2026-01-02Z", "com.apple.quicktime.creationdate": "2026-01-01Z" } } }, 9), Date.parse("2026-01-02Z"));
  assert.equal(filmingTime({ streams: [{ tags: { "com.apple.quicktime.creationdate": "2026-01-03Z" } }] }, 9), Date.parse("2026-01-03Z"));
  assert.equal(filmingTime({}, 9), 9);
  assert.equal(filmingTime({ format: { tags: { creation_time: "invalid" } } }, 9), 9);
});

test("drop order appends later scans, sorts only a batch by filming time and tracks renames/removals", () => {
  let ledger = reconcileOrder(null, [row("b", 2), row("a", 1)], 100);
  assert.deepEqual(ledger.clips.map((c) => c.id), ["a", "b"]);
  ledger = reconcileOrder(ledger, [row("b", 2, "renamed.mov"), row("c", 0), row("a", 1)], 200);
  assert.deepEqual(ledger.clips.map((c) => c.id), ["a", "b", "c"]);
  assert.equal(ledger.clips[1].name, "renamed.mov");
  ledger = reconcileOrder(ledger, [row("b", 2, "renamed.mov"), row("c", 0)], 300);
  assert.deepEqual(ledger.clips.map((c) => c.id), ["b", "c"]);
  assert.equal(ledger.lastArrival, 200);
  assert.equal(reconcileOrder(ledger, ledger.clips, 400).lastArrival, 200);
  assert.equal(reconcileOrder(ledger, ledger.clips.map((c) => ({ ...c, size: 20 })), 500).lastArrival, 500);
});

test("numbers win only when every name starts with a number, with stable ties", () => {
  const all = [row("c", 0, "10 gym.mov"), row("b", 2, "2 office.mov"), row("a", 1, "01 gym.mov")];
  assert.deepEqual(reconcileOrder(null, all).clips.map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(reconcileOrder(null, [all[0], row("d", 3, "IMG_1.mov"), all[1]]).clips.map((c) => c.id), ["c", "b", "d"]);
  assert.notEqual(orderSignature([{ id: "a", key: "x" }, { id: "b", key: "y" }]), orderSignature([{ id: "b", key: "y" }, { id: "a", key: "x" }]));
  assert.notEqual(orderSignature([{ id: "a", key: "x" }]), orderSignature([{ id: "a", key: "changed" }]));
});

test("folder intake persists identities through renames and accepts an exact explicit order", async (t) => {
  const dir = temp(t); fs.writeFileSync(path.join(dir, "a.MOV"), "one"); fs.writeFileSync(path.join(dir, "b.mp4"), "two"); fs.writeFileSync(path.join(dir, "notes.txt"), "notes");
  fs.mkdirSync(path.join(dir, "ignored.mov"));
  assert.equal(stitchVideo("file.MOV"), true); assert.equal(stitchVideo("file.txt"), false);
  assert.equal(clipFiles(dir).length, 2);
  const before = await recordOrder(dir, { creationTime: async (f) => f.endsWith("a.MOV") ? 2 : 1 });
  fs.renameSync(path.join(dir, "b.mp4"), path.join(dir, "renamed.mp4"));
  const after = await recordOrder(dir, { creationTime: async () => 100 });
  assert.equal(before.clips[0].id, after.clips[0].id); assert.equal(after.clips[0].name, "renamed.mp4");
  const files = clipFiles(dir), names = files.map((f) => path.basename(f)).reverse();
  assert.deepEqual(explicitOrder(files, names, dir), names.map((n) => path.join(dir, n)));
  assert.throws(() => explicitOrder(files, [names[0], names[0]], dir));
  assert.throws(() => explicitOrder(files, ["../wrong.mov"], dir));
  const order = path.join(dir, "order.json"); fs.writeFileSync(order, JSON.stringify(names));
  assert.deepEqual((await stitchInputs([dir], { order })).files, explicitOrder(files, names, dir));
  assert.deepEqual((await stitchInputs(files)).files, files);
});

test("background votes require two of three matching border hashes and colors", () => {
  const a = fingerprints(), b = fingerprints(); b[0] = { signature: Array(8).fill(FAR) };
  assert.equal(samePlace(a, b), true);
  assert.equal(samePlace(a, fingerprints(FAR)), false);
  assert.equal(samePlace(a, fingerprints(5)), true);
  assert.equal(samePlace([], []), false);
  assert.equal(samePlace([{ signature: [] }], [{ signature: [] }]), false);
  assert.deepEqual(placeGroups([clip("a"), clip("b", 2, { fingerprint: fingerprints(FAR) }), clip("c", 3)]).map((c) => c.place), ["A", "B", "A"]);
});

test("trims pad outward to whole frames and remove filler heads without removing deliberate go", () => {
  const c = clip("Okay, make better calls."); c.words[1].start = 1.6; c.words[1].end = 1.8;
  const range = keptRanges(c).ranges[0];
  assert.equal(range.words[0].text, "make");
  assert.ok(range.in <= 1.6 - 0.15 + 1 / 30); assert.ok(range.out >= range.words.at(-1).end + 0.35 - 1e-8);
  assert.equal(Math.round(range.in * 30), range.in * 30);
  const edge = keptRanges(clip("word", 1, { duration: 1.01, words: [{ text: "word", start: 0.5, end: 1.01 }] })).ranges[0];
  assert.ok(edge.out >= 1.01);
  assert.equal(keptRanges(clip("go make better calls")).ranges[0].words[0].text, "go");
  const restart = keptRanges(clip("I want to I want to help you"));
  assert.deepEqual(restart.ranges.flatMap((s) => s.words).map((w) => w.text), "I want to help you".split(" "));
  assert.ok(restart.restarts >= 3);
  const cutWords = words("Here is the point. I know it's-", 1, 0.3);
  const cutClip = keptRanges(clip("", 1, { duration: 3, words: cutWords }));
  assert.deepEqual(cutClip.ranges.flatMap((r) => r.words).map((w) => w.text), ["Here", "is", "the", "point."]);
  const cut = keptRanges(clip("so here is the point so ex-", 1, { duration: 3 }));
  assert.ok(cut.ranges.flatMap((r) => r.words).every((w) => !w.text.endsWith("-")));
  assert.equal(midWord({ in: 1.1, out: 2, words: [{ text: "hello", start: 1, end: 1.5 }] }), true);
});

test("neighbouring duplicate takes keep later unless earlier is clearly cleaner, unique words stay", () => {
  assert.equal(repeatedTake({ ...clip("make better calls today"), place: "A" }, { ...clip("make better calls today"), place: "B" }), false);
  let plan = planStitch([clip("make better calls today"), clip("make better calls today", 2)]);
  assert.equal(plan.segments.length, 1); assert.equal(plan.segments[0].clip, "/clip2.mov"); assert.match(plan.notes[0], /retake/);
  plan = planStitch([clip("make better calls today"), clip("make better calls today plus", 2)]);
  assert.equal(plan.segments.length, 2);
  plan = planStitch([clip("so here is how you make better sales calls today"), clip("okay so here is how you make way better sales calls", 2)]);
  assert.equal(plan.segments.length, 1); assert.equal(plan.segments[0].clip, "/clip2.mov"); assert.match(plan.notes[0], /retake/);
  plan = planStitch([clip("you need to call 10 new people every single day"), clip("you need to call 20 new people every single day", 2)]);
  assert.equal(plan.segments.length, 1); assert.equal(plan.segments[0].clip, "/clip2.mov"); assert.match(plan.notes[0], /number or a no/);
  assert.equal(planStitch([clip("first I talk about your offer and price"), clip("then we go over how to hire closers", 2)]).segments.length, 2);
  plan = planStitch([clip("I want to help you"), clip("I I I want to help you", 2)]);
  assert.equal(plan.segments.length, 1); assert.equal(plan.segments[0].clip, "/clip1.mov");
  assert.equal(planStitch([clip("Joe owes Jane money"), clip("Jane owes Joe money", 2)]).segments.length, 2);
  assert.equal(planStitch([clip("call 10 people today"), clip("call 20 people today", 2)]).segments.length, 2);
});

test("silent shots cap at four seconds, low resolution warns and holds cover silence, duration and cut words", () => {
  const silent = clip("", 2, { words: [], duration: 10, lowResolution: true });
  const plan = planStitch([clip("say this clearly."), silent, clip("another place here", 3, { fingerprint: fingerprints(FAR) })]);
  assert.equal(plan.segments[1].frames, 120); assert.deepEqual(plan.segments.map((s) => s.join), ["start", "take", "place"]);
  assert.ok(plan.notes.some((n) => n.includes("720"))); assert.deepEqual(plan.held, []);
  assert.equal(stitchScenes(plan)[1].silent, true);
  assert.match(planStitch([silent]).held[0], /None of these clips has speech/);
  assert.match(planStitch([clip("one", 1, { duration: 200, words: [{ text: "one", start: 0, end: 190 }] })]).held.join(" "), /over 180/);
  assert.match(planStitch([clip("I start-"), clip("a different point", 2)]).held.join(" "), /cuts through a word/);
});

test("order sheet lists all input clips, retained words and repeat notes in plain English", () => {
  const index = [clip("make better calls today"), clip("make better calls today", 2)];
  const plan = planStitch(index), rows = previewRows(index, plan), text = orderText(rows, plan.notes);
  assert.equal(rows.length, 2); assert.equal(rows[0].duration, 0); assert.equal(rows[1].number, 2); assert.equal(rows[1].place, "A");
  assert.match(text, /Wrong order\? Rename the clips 1, 2, 3 and it redoes the reel\./);
  assert.match(text, /Repeated take left out/); assert.match(text, /make better calls today/);
});

test("index caches by content, renames reuse work and only changed clips are reanalysed", async (t) => {
  const dir = temp(t), a = path.join(dir, "a.mov"), b = path.join(dir, "b.mov"); fs.writeFileSync(a, "a"); fs.writeFileSync(b, "b");
  const calls = { probe: 0, hear: 0, level: 0, background: 0 };
  const deps = { probe: async () => { calls.probe++; return { hasVideo: true, hasAudio: true, duration: 10, width: 1080, height: 1920 }; }, transcribe: async () => { calls.hear++; return words("real words here"); }, loudness: async () => { calls.level++; return { input_i: "-16" }; }, fingerprint: async () => { calls.background++; return fingerprints(); }, creationTime: async () => 10 };
  await indexStitch([a, b], dir, { engine: "fake" }, deps);
  fs.renameSync(a, path.join(dir, "rename.mov"));
  await indexStitch([path.join(dir, "rename.mov"), b], dir, { engine: "fake" }, deps);
  assert.deepEqual(Object.values(calls), [2, 2, 2, 2]);
  fs.writeFileSync(b, "changed bytes");
  await indexStitch([path.join(dir, "rename.mov"), b], dir, { engine: "fake" }, deps);
  assert.deepEqual(Object.values(calls), [3, 3, 3, 3]);
});

test("master filters lock samples and frames, rotate upright and never dissolve faces", () => {
  assert.match(stitchAudioFilter({ input_i: "-20", input_tp: "-5", input_lra: "1", input_thresh: "-30", target_offset: "0" }, 60), /end_sample=96000/);
  assert.match(stitchAudioFilter(null, 30), /d=0.015/);
  const vf = stitchVideoFilter({ rotationCw: 90 }, 60, "colorspace=iall=bt2020:all=bt709");
  assert.match(vf, /transpose=clock/); assert.match(vf, /trim=end_frame=60/); assert.match(vf, /crop=1080:1920/); assert.doesNotMatch(vf, /xfade/);
});

test("the complete stitch path writes preview before edit, compiles real mixed clips and caches the master", async (t) => {
  const dir = temp(t), inputs = path.join(dir, "input"), work = path.join(dir, "work"); fs.mkdirSync(inputs);
  const a = path.join(inputs, "1 red.mov"), b = path.join(inputs, "2 blue.mov"), c = path.join(inputs, "3 silent.mov");
  for (const [file, color, size, fps, volume] of [[a, "red", "90x160", 24, "0.2"], [b, "blue", "180x320", 60, "0.8"], [c, "green", "90x160", 30, null]]) {
    await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=${color}:s=${size}:r=${fps}:d=1.2`, ...(volume ? ["-f", "lavfi", "-i", `sine=frequency=440:duration=1.2:sample_rate=44100,volume=${volume}`] : []), "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(volume ? ["-c:a", "pcm_s16le"] : []), file], { capture: true });
  }
  let edits = 0;
  const deps = {
    transcribe: async (file) => words(file === a ? "hello from here" : "next place now", 0.2, 0.2),
    fingerprint: async (file) => fingerprints(file === a ? 0 : FAR),
    edit: async (master, opts) => {
      edits++; assert.ok(fs.statSync(path.join(inputs, "Order - check this.jpg")).size > 100);
      assert.ok(fs.existsSync(path.join(inputs, "Order.txt")));
      assert.equal(opts.transcript, undefined); assert.equal(opts.fps, 30);
      const scenes = readJSON(opts.scenes); assert.equal(scenes.length, 3); assert.equal(scenes[1].join, "place"); assert.equal(scenes[2].silent, true);
      const meta = await probeSource(master); assert.equal(meta.width, 1080); assert.equal(meta.height, 1920); assert.equal(meta.fps, 30); assert.equal(meta.hdr, false);
      assert.ok(Math.abs(meta.duration - scenes.at(-1).end) < 1 / 30);
      return { workDir: work, plan: { name: "test" }, output: master };
    },
  };
  const first = await runStitch([inputs], { out: work, noDeliver: true, preset: "clean" }, deps);
  const mtime = fs.statSync(first.master).mtimeMs;
  await runStitch([inputs], { out: work, noDeliver: true, preset: "clean" }, deps);
  assert.equal(edits, 2); assert.equal(fs.statSync(first.master).mtimeMs, mtime);
  const levels = readJSON(path.join(work, "stitch/loudness.json")).filter((r) => r.output);
  assert.ok(Math.abs(Number(levels[0].output.input_i) - Number(levels[1].output.input_i)) <= 1);
  const transcript = path.join(dir, "master-words.json");
  fs.writeFileSync(transcript, JSON.stringify({ words: [{ text: "hello", start: 0.2, end: 0.4 }, { text: "next", start: 1.3, end: 1.5 }, { text: "hallucinated", start: 2.8, end: 3 }] }));
  const edited = await runEdit(first.master, { out: path.join(dir, "editor"), preset: "clean", transcript, scenes: first.scenes, noRender: true, noCuts: true, noSounds: true }, { detectFaces: async (_, times) => ({ frames: times.map((t) => ({ t, faces: [] })) }) });
  assert.equal(edited.plan.stitchScenes.length, 3);
  assert.equal(edited.plan.words.some((w) => w.text === "hallucinated"), false);
  assert.ok(edited.plan.zooms.some((z) => z.stitch));
  assert.ok(fs.existsSync(path.join(edited.workDir, "project/index.html")));
  const delivery = deliverStitch(first, inputs, { root: dir, done: path.join(dir, "Desktop"), day: "2026-11-12" });
  assert.equal(path.basename(delivery), "2026-11-12 Stitch 1"); assert.ok(fs.existsSync(path.join(delivery, "Order - check this.jpg")));
});

test("unreadable clips and all silent clips hold before preview, compilation or rendering", async (t) => {
  const dir = temp(t); fs.writeFileSync(path.join(dir, "clip.mov"), "bad");
  const never = () => assert.fail("held reel must not continue");
  await assert.rejects(runStitch([dir], { out: path.join(dir, "work"), preset: "clean" }, { probe: async () => { throw new Error("unreadable"); }, preview: never, compile: never, edit: never }), { code: "STITCH_HELD" });
  assert.match(fs.readFileSync(path.join(dir, "why it's held.txt"), "utf8"), /could not be read/);
  await assert.rejects(runStitch([dir], { out: path.join(dir, "work"), preset: "clean" }, { index: async () => [clip("", 1, { words: [] })], preview: never, compile: never, edit: never }), { code: "STITCH_HELD" });
});

test("settled snapshot verification rejects a source changed after admission", (t) => {
  const dir = temp(t), file = path.join(dir, "one.mov"), manifest = path.join(dir, "ready.json"); fs.writeFileSync(file, "content");
  const st = fs.statSync(file); fs.writeFileSync(manifest, JSON.stringify({ clips: [{ file, size: st.size, mtimeMs: st.mtimeMs, key: sourceCacheKey(file) }] }));
  verifyStitchSnapshot([file], manifest); verifyStitchSnapshot([file], null);
  fs.writeFileSync(file, "changed content");
  assert.throws(() => verifyStitchSnapshot([file], manifest), { code: "STITCH_CHANGED" });
});

test("background extraction asks the scene checker for three frames and keeps their prints", async (t) => {
  const dir = temp(t), file = path.join(dir, "clip.mov");
  let args = null;
  const result = await backgroundFingerprint(file, { duration: 4 }, dir, { binary: async () => "fake-helper", execute: async (cmd, a) => { assert.equal(cmd, "fake-helper"); args = a; return { out: JSON.stringify({ frames: [1, 2, 3].map((n) => ({ t: n, signature: [n, n] })) }) }; } });
  assert.deepEqual(args, [file, "1.000", "2.000", "3.000"]); assert.equal(result.length, 3); assert.deepEqual(result[2].signature, [3, 3]);
  await assert.rejects(backgroundFingerprint(file, { duration: 4 }, dir, { binary: async () => "fake-helper", execute: async () => ({ out: '{"frames":[]}' }) }));
});
