import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, writeJSON, readJSON } from "../src/util.mjs";
import { prepareRepair, repairCacheKey, repairOptions, repairDryRanges, blendOriginalReactions, validateRepair, repairQC, loadRepairReactions } from "../src/speaker-enhance.mjs";
import { preparedAudio, compileVersion, validatePlan, resolvePlan } from "../src/speaker-compile.mjs";
import { reviewRows } from "../src/speaker-review.mjs";
import { measurePlanAudio } from "../src/speaker-audio-quality.mjs";
import { registerReview, approve, reviewState } from "../src/speaker-deliver.mjs";

const settings = { profile: "dfn3-6" };
const spec = { start: 0, samples: 48000, ranges: [{ start: 0.4, end: 0.6 }], rampMs: 150 };
const float = (samples, value) => { const b = Buffer.alloc(samples * 4); for (let n = 0; n < samples; n++) b.writeFloatLE(typeof value === "function" ? value(n) : value, n * 4); return b; };
async function decode(file, dir, channels = 1) {
  const raw = path.join(dir, `decode-${channels}.f32`);
  await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-ac", String(channels), "-f", "f32le", raw], { capture: true });
  return fs.readFileSync(raw);
}
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-enhance-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source.wav"), binary = path.join(dir, "fake-deep-filter");
  fs.writeFileSync(binary, "injected runner; no model execution");
  // A deterministic chirp, impulses and a quiet right channel expose shifts and channel mistakes.
  await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.12*sin(2*PI*(211*t+173*t*t))+if(eq(mod(n\\,3011)\\,0)\\,0.2\\,0)|0.02*sin(2*PI*773*t):s=48000:d=2", "-c:a", "pcm_f32le", source], { capture: true });
  const calls = [];
  const execute = async (cmd, args, opts) => {
    if (cmd !== binary) return run(cmd, args, opts);
    calls.push(args);
    const input = args.at(-1), out = path.join(args[args.indexOf("-o") + 1], "input.wav");
    // Native -D drops delay samples at the end; the adapter must supply padding, never stretch.
    return run("ffmpeg", ["-y", "-v", "error", "-i", input, "-af", "areverse,atrim=start_sample=1440,areverse,volume=0.5", "-c:a", "pcm_f32le", out], { capture: true });
  };
  const originalFile = path.join(dir, "original.wav");
  await run("ffmpeg", ["-y", "-v", "error", "-ss", "0.3", "-i", source, "-t", "1", "-af", "aresample=48000:async=1:first_pts=0,pan=mono|c0=c0,apad,atrim=end_sample=48000", "-c:a", "pcm_f32le", originalFile], { capture: true });
  const original = await decode(originalFile, dir);
  const options = { original, sourceKey: "fixture", sourceId: "stage", stream: 0, start: 0.3, out: 1.3, samples: 48000, sourceDuration: 2,
    mono: "pan=mono|c0=c0", settings, reactions: [{ kind: "laughter", start: 0.7, end: 0.9, confidence: "review" }], cacheDir: path.join(dir, "work/index/enhance"), binary, execute, print: () => {} };
  writeJSON(path.join(dir, "work/index/fixture.reactions.json"), { key: "fixture", sourceId: "stage", source, spans: options.reactions });
  return { dir, source, binary, calls, options };
}

test("reaction blend keeps indexed reactions bit-exact with smooth ramps outside their boundaries", () => {
  const x = float(48000, 0.25), e = float(48000, 0.125);
  const y = blendOriginalReactions(x, e, spec);
  assert.ok(y.subarray(19200 * 4, 28800 * 4).equals(x.subarray(19200 * 4, 28800 * 4)));
  assert.equal(y.readFloatLE(0), 0.125);
  assert.equal(y.readFloatLE(15600 * 4), 0.1875, "smoothstep halfway to original before a reaction");
  assert.equal(y.readFloatLE(32400 * 4), 0.1875, "smoothstep halfway to enhanced after a reaction");
  const checks = validateRepair(x, e, y, spec);
  assert.equal(checks.protectedSamples, 9600);
  assert.equal(checks.reactionNull, true);
  const ranges = repairDryRanges([{ kind: "applause", start: 0.1, end: 0.3 }, { kind: "cheering", start: 0.2, end: 0.4 }, { kind: "crowd", start: 0, end: 1 }], repairOptions({ ...settings, dryRanges: [{ start: 0.9, end: 1.2 }] }), 0, 48000);
  assert.deepEqual(ranges, [{ start: 0.1, end: 0.4 }, { start: 0.9, end: 1.2 }]);
});

test("repair validation rejects lost tails, non-finite samples, changed reactions and displaced speech", () => {
  const x = float(48000, (n) => 0.2 * Math.sin(2 * Math.PI * (197 * n / 48000 + 431 * (n / 48000) ** 2)));
  const e = float(48000, (n) => x.readFloatLE(n * 4) * 0.5), y = blendOriginalReactions(x, e, spec);
  assert.throws(() => validateRepair(x, e, y.subarray(4), spec), /count/);
  const bad = Buffer.from(y); bad.writeFloatLE(1, 20000 * 4);
  assert.throws(() => validateRepair(x, e, bad, spec), /reaction null/);
  const nan = Buffer.from(e); nan.writeFloatLE(NaN, 12);
  assert.throws(() => blendOriginalReactions(x, nan, spec), /non-finite/);
  const shifted = Buffer.alloc(e.length); e.copy(shifted, 240 * 4, 0, e.length - 240 * 4);
  assert.throws(() => validateRepair(x, shifted, blendOriginalReactions(x, shifted, spec), spec), /timing shift/);
});

test("native adapter compensates delay, restores tail and caches source/range/settings/binary/reactions", async (t) => {
  const { dir, source, binary, calls, options } = await fixture(t);
  const result = await prepareRepair(source, options);
  assert.equal(result.status, "repaired");
  assert.deepEqual(calls[0].slice(0, 3), ["-D", "--atten-lim-db", "6"]);
  assert.ok(!calls[0].includes("--pf"));
  const provenance = readJSON(result.sidecar), repaired = await decode(result.file, dir);
  assert.equal(repaired.length, 48000 * 4);
  assert.equal(provenance.evidence.contextStart, 0);
  assert.equal(provenance.evidence.contextEnd, 1.8);
  assert.match(provenance.graph, /atrim=end_sample=86400,apad=pad_len=24000,atrim=end_sample=110400$/);
  let tailError = 0;
  for (let n = 47000; n < 48000; n++) tailError = Math.max(tailError, Math.abs(repaired.readFloatLE(n * 4) - options.original.readFloatLE(n * 4) * 0.5));
  assert.ok(tailError < 1e-6, `tail error ${tailError}`);
  assert.equal(result.checks.protectedSamples, 9600);
  const hit = await prepareRepair(source, options); assert.equal(hit.key, result.key); assert.equal(calls.length, 1);
  // Altered cached bytes must be rebuilt rather than silently reused.
  fs.appendFileSync(result.file, "changed");
  assert.equal((await prepareRepair(source, options)).status, "repaired"); assert.equal(calls.length, 2);
  const dfn9 = await prepareRepair(source, { ...options, settings: { profile: "dfn3-9" } });
  assert.notEqual(dfn9.key, result.key); assert.equal(calls.at(-1)[2], "9");
  const reaction = await prepareRepair(source, { ...options, reactions: [{ kind: "applause", start: 0.5, end: 0.6 }] });
  assert.notEqual(reaction.key, result.key);
  fs.appendFileSync(binary, "new model bytes");
  assert.notEqual((await prepareRepair(source, options)).key, result.key);
  const stat = fs.statSync(source), bytes = fs.readFileSync(source); bytes[bytes.length - 10] ^= 1; fs.writeFileSync(source, bytes); fs.utimesSync(source, stat.atime, stat.mtime);
  assert.notEqual((await prepareRepair(source, options)).key, result.key, "full source hash catches same-size content changes");
  t.diagnostic(`48000/48000 samples; reaction null 9600 samples exactly; final 1000 samples max error ${tailError}; simulated native delay loss 1440 samples recovered by 24000-sample padding`);
});

test("adapter clamps handles at source EOF, preserving the last required samples", async (t) => {
  const { dir, source, options } = await fixture(t);
  const file = path.join(dir, "end.wav");
  await run("ffmpeg", ["-y", "-v", "error", "-ss", "1.5", "-i", source, "-af", "pan=mono|c0=c0", "-c:a", "pcm_f32le", file], { capture: true });
  const original = await decode(file, dir);
  const result = await prepareRepair(source, { ...options, start: 1.5, out: 2, samples: 24000, original });
  assert.equal(result.status, "repaired");
  const repaired = await decode(result.file, dir);
  assert.equal(repaired.length, 24000 * 4);
  assert.ok(Math.abs(repaired.readFloatLE(repaired.length - 4) - original.readFloatLE(original.length - 4) * 0.5) < 1e-6);
  assert.equal(readJSON(result.sidecar).evidence.contextEnd, 2);
});

test("missing binary, missing reactions, runner failure and truncated output each fail open with one line", async (t) => {
  const { source, options } = await fixture(t);
  for (const patch of [{ binary: null }, { reactions: null }, { execute: async () => { throw new Error("runner failure\nextra"); } },
    { execute: async (cmd, args, opts) => cmd === options.binary ? run("ffmpeg", ["-y", "-v", "error", "-i", args.at(-1), "-t", "0.01", "-c:a", "pcm_f32le", path.join(args[args.indexOf("-o") + 1], "short.wav")], opts) : run(cmd, args, opts) }]) {
    const lines = [];
    const result = await prepareRepair(source, { ...options, ...patch, sourceKey: repairCacheKey(patch.binary ?? String(Object.keys(patch))), print: (line) => lines.push(line) });
    assert.equal(result.status, "fallback"); assert.equal(lines.length, 1); assert.match(lines[0], /using original audio/); assert.ok(!lines[0].includes("\n"));
  }
});

test("repair keys are stable and invalidate range, stream, channel, settings and source keys", () => {
  const input = { sourceKey: "a", start: 1.6, out: 10.95, samples: 449600, stream: 1, settings };
  assert.equal(repairCacheKey(input), repairCacheKey({ settings, stream: 1, samples: 449600, out: 10.95, start: 1.6, sourceKey: "a" }));
  for (const patch of [{ sourceKey: "b" }, { start: 1.61 }, { out: 10.96 }, { stream: 2 }, { channel: "left" }, { settings: { profile: "dfn3-9" } }]) assert.notEqual(repairCacheKey({ ...input, ...patch }), repairCacheKey(input));
  assert.equal(Math.round((10.95 - 1.6) * 30) * 1600, 449600);
});

function planFixture() {
  const manifest = { clientId: "client", identity: { name: "Client" }, sources: [{ id: "stage", kind: "stage", audio: "ok", rights: "r" }], rights: [{ id: "r", status: "approved" }] };
  const index = { sources: { stage: { duration: 20, hasAudio: true } } };
  const item = { id: "t2", kind: "clip", role: "testimonial", sourceId: "stage", in: 1.6, out: 10.95, audioRepair: settings };
  const plan = { schemaVersion: 1, clientId: "client", version: "full", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 }, items: [item] };
  return { plan, manifest, index, item };
}

test("plan repair is opt-in dialogue only and protected clips require an explicit repair allowance", () => {
  const { plan, manifest, index, item } = planFixture(), options = { manifest, index };
  assert.deepEqual(validatePlan(plan, options), []);
  item.protect = true;
  assert.ok(validatePlan(plan, options).some((p) => /allowProtected/.test(p.message)));
  item.audioRepair = { ...settings, allowProtected: true, channel: "left", auditioned: true };
  assert.deepEqual(validatePlan(plan, options), []);
  const resolved = resolvePlan(plan, options).items[0];
  assert.deepEqual([resolved.in, resolved.out, resolved.frames, resolved.protect], [1.6, 10.95, 281, true]);
  for (const value of [null, [], {}, { profile: "unknown" }, { ...settings, channel: "all" }, { ...settings, rampMs: 0 }, { ...settings, dryRanges: [{ start: 3, end: 2 }] }, { ...settings, auditioned: "yes" }, { ...settings, postfilter: true }]) {
    item.audioRepair = value; assert.ok(validatePlan(plan, options).some((p) => /audioRepair/.test(p.message)));
  }
  item.audioRepair = settings; item.protect = false;
  for (const audio of ["bad", "none"]) { manifest.sources[0].audio = audio; assert.ok(validatePlan(plan, options).some((p) => /audioRepair needs/.test(p.message))); }
  manifest.sources[0].audio = "ok"; index.sources.stage.hasAudio = false;
  assert.ok(validatePlan(plan, options).some((p) => /audioRepair needs/.test(p.message)));
  index.sources.stage.hasAudio = true; item.audio = "mute";
  assert.ok(validatePlan(plan, options).some((p) => /audioRepair needs/.test(p.message)));
  delete item.audio; item.kind = "card"; item.duration = 1; item.card = { type: "title" };
  assert.ok(validatePlan(plan, options).some((p) => /dialogue clip/.test(p.message)));
  item.kind = "clip"; plan.cutaways = [{ ...item, id: "cut", over: "t2", offset: 0 }];
  assert.ok(validatePlan(plan, options).some((p) => p.id === "cut" && /dialogue clip/.test(p.message)));
  delete plan.cutaways; manifest.sources[0].kind = "broll";
  assert.ok(validatePlan(plan, options).some((p) => /only for dialogue/.test(p.message)));
});

test("review keeps selected-channel repair measurements separate from original quality labels", async (t) => {
  const { dir, source, options } = await fixture(t), result = await prepareRepair(source, options);
  const { plan, manifest, index, item } = planFixture();
  manifest.sources[0].path = "source.wav";
  Object.assign(index.sources.stage, { key: "fixture", audioStream: 0, words: [] });
  Object.assign(item, { in: 0.3, out: 1.3, frames: 30, start: 0, end: 1, audioQuality: { label: "weak" },
    audioRepairResult: { status: "repaired", sidecar: path.relative(dir, result.sidecar), file: path.relative(dir, result.file), original: path.relative(dir, result.original), ranges: result.evidence.ranges } });
  let calls = 0;
  await measurePlanAudio(dir, plan, manifest, { index, measure: async () => ({ contrastDb: 13, lufs: -31 + calls++ }) });
  assert.ok(item.audioQuality);
  assert.equal(item.audioQuality.label, "weak");
  assert.equal(item.audioRepairResult.measurements.selectedOriginal.lufs, -31);
  assert.equal(item.audioRepairResult.measurements.repaired.lufs, -30);
  assert.equal(index.sources.stage.audioQuality, undefined, "repair never promotes source quality");
  const row = reviewRows(plan, manifest)[0];
  assert.equal(row.audioQuality.label, "weak");
  assert.equal(row.audioRepair.profile, "dfn3-6");
  assert.deepEqual(row.audioRepair.result.ranges, [{ start: 0.7, end: 0.9 }]);
  assert.equal(row.audioRepair.result.measurements.repaired.lufs, -30);
});

test("review input hashes guard repair WAVs, provenance, reaction index and original source", async (t) => {
  const { dir, source, options } = await fixture(t), result = await prepareRepair(source, options);
  const { plan, manifest, item } = planFixture();
  manifest.sources[0].path = "source.wav";
  Object.assign(item, { in: 0.3, out: 1.3, frames: 30, audioRepairResult: { status: "repaired", key: result.key,
    ...Object.fromEntries(["sidecar", "file", "original", "enhanced"].map((key) => [key, path.relative(dir, result[key])])) } });
  writeJSON(path.join(dir, "speaker-manifest.json"), manifest);
  const planPath = path.join(dir, "work/full/plan.resolved.json"); writeJSON(planPath, plan);
  const files = ["video", "srt", "vtt", "poster"].map((kind) => {
    const relative = `review/${kind}`; fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true }); fs.writeFileSync(path.join(dir, relative), kind);
    return { kind, path: relative, delivery: true };
  });
  const review = registerReview(dir, "full", { planPath, revision: 1, files });
  for (const file of [result.file, result.original, result.enhanced, result.sidecar, path.join(dir, "work/index/fixture.reactions.json"), source]) assert.ok(review.reviewInputHashes[path.relative(dir, file)]);
  const qc = async () => ({ ok: true, checks: [] });
  await approve(dir, "full", { by: "Client", at: "2026-11-01T12:00:00Z", qc });
  fs.appendFileSync(result.sidecar, " ");
  assert.equal(reviewState(dir, "full").state, "revised", "changed repair provenance invalidates approval");
});

test("prepared dialogue repairs before gain and audioCarry stays original with inherited channel/gain", async (t) => {
  const { dir, source, options, calls } = await fixture(t);
  const scratch = path.join(dir, "compile"); fs.mkdirSync(scratch);
  const meta = { key: "fixture", duration: 2, hasAudio: true, audioStream: 0 }, src = { id: "stage", audio: "ok" };
  const item = { id: "speech", kind: "clip", in: 0.3, out: 1.3, frames: 30, audioRepair: { ...settings, channel: "left" } };
  let preparation;
  const speech = await preparedAudio(source, src, meta, item, scratch, { continues: true, workDir: path.join(dir, "work"), repairDeps: { binary: options.binary, execute: options.execute }, savePreparation: (p) => preparation = p });
  assert.equal(item.audioRepairResult.status, "repaired"); assert.equal(preparation.mono, "pan=mono|c0=c0");
  const carryItem = { id: "carry", frames: 21, in: 1.3, audioCarry: { frames: 15 } };
  const carry = await preparedAudio(source, src, meta, carryItem, scratch, { carry: true, preparation });
  assert.equal(calls.length, 1, "audioCarry never invokes enhancement");
  const dry = path.join(dir, "carry-original.wav");
  await run("ffmpeg", ["-y", "-v", "error", "-ss", "1.3", "-t", "0.5", "-i", source, "-af", `aresample=48000:async=1:first_pts=0,pan=mono|c0=c0,volume=${preparation.gain}dB,pan=stereo|c0=c0|c1=c0,atrim=end_sample=24000,afade=t=out:st=0.25:d=0.25,apad,atrim=end_sample=33600`, "-c:a", "pcm_s16le", dry], { capture: true });
  assert.ok((await decode(carry, dir, 2)).equals(await decode(dry, dir, 2)), "carry equals selected original with exactly the inherited fixed gain and final fade");
  assert.equal((await decode(speech, dir)).length, 48000 * 4);
  // Silent cards cannot reach the adapter, even if called directly with an accidental repair field.
  await preparedAudio(null, { audio: "none" }, {}, { ...item, id: "silent" }, scratch, { repair: () => { throw new Error("must not repair silence"); } });
});

test("QC rechecks PCM, reaction changes, provenance, audition status and final failure policy", async (t) => {
  const { dir, source, options } = await fixture(t);
  const result = await prepareRepair(source, options);
  const item = { id: "speech", sourceId: "stage", in: 0.3, out: 1.3, frames: 30, audioRepair: settings,
    audioRepairResult: { status: "repaired", key: result.key, sidecar: path.relative(dir, result.sidecar) } };
  assert.ok((await repairQC(dir, item)).some((c) => c.level === "warn" && /listening/.test(c.message)));
  assert.ok((await repairQC(dir, item, { final: true })).some((c) => c.level === "fail"));
  item.audioRepair = { ...settings, auditioned: true };
  assert.ok((await repairQC(dir, item, { final: true })).every((c) => c.level === "pass"));
  fs.writeFileSync(path.join(dir, "changed-source.wav"), "changed source content");
  assert.match((await repairQC(dir, item, { final: true, source: { path: "changed-source.wav" } }))[0].message, /source content changed/);
  assert.match((await repairQC(dir, item, { final: true, source: { path: "source.wav", audioStream: 1 } }))[0].message, /source stream changed/);
  const missing = { ...item, audioRepairResult: { status: "fallback" } };
  assert.equal((await repairQC(dir, missing))[0].level, "warn");
  assert.equal((await repairQC(dir, missing, { final: true }))[0].level, "fail");
  fs.appendFileSync(result.file, "altered");
  assert.match((await repairQC(dir, item))[0].message, /WAV changed/);
  const next = await prepareRepair(source, options);
  assert.equal(next.status, "repaired");
  writeJSON(path.join(dir, "work/index/fixture.reactions.json"), { key: "fixture", sourceId: "stage", spans: [{ kind: "applause", start: 0.5, end: 1 }] });
  assert.match((await repairQC(dir, item))[0].message, /ranges changed/);
  item.in = 0.4; assert.match((await repairQC(dir, item))[0].message, /provenance/);
  assert.throws(() => loadRepairReactions(path.join(dir, "work"), "fixture", "other"), /identity mismatch/);
});

test("mono sources use the compiler's same stereo representation before cleanup", async (t) => {
  const { dir, source, options } = await fixture(t);
  const mono = path.join(dir, "mono.wav"), dry = path.join(dir, "mono-original.f32");
  await run("ffmpeg", ["-y", "-v", "error", "-i", source, "-af", "pan=mono|c0=c0", "-c:a", "pcm_f32le", mono], { capture: true });
  await run("ffmpeg", ["-y", "-v", "error", "-ss", "0.3", "-i", mono, "-t", "1", "-ac", "2", "-f", "f32le", dry], { capture: true });
  const stereo = fs.readFileSync(dry), original = Buffer.alloc(48000 * 4);
  for (let n = 0; n < 48000; n++) original.writeFloatLE(stereo.readFloatLE(n * 8), n * 4);
  const result = await prepareRepair(mono, { ...options, original, sourceKey: "mono", sourceId: "mono", reactions: [] });
  assert.equal(result.status, "repaired");
  const enhanced = await decode(result.file, dir);
  let max = 0;
  for (let n = 0; n < 48000; n++) max = Math.max(max, Math.abs(enhanced.readFloatLE(n * 4) - original.readFloatLE(n * 4) * 0.5));
  assert.ok(max < 1e-6, `mono channel preparation error ${max}`);
});


test("compiler forwards the injected repair runner and keeps frame-locked dialogue", async (t) => {
  const { dir, source, options, calls } = await fixture(t);
  const { plan, manifest, index, item } = planFixture();
  manifest.brand = { file: "brand.json" }; manifest.sources[0].path = "source.wav";
  writeJSON(path.join(dir, "brand.json"), { name: "Client", fonts: { display: "Georgia", body: "Arial" }, colors: { bg: "#111111", text: "#FFFFFF", accent: "#FFB27D" } });
  Object.assign(index.sources.stage, { key: "fixture", audioStream: 0, hasVideo: false, width: 0, height: 0, duration: 2, words: [] });
  Object.assign(item, { in: 0.3, out: 1.3, audioRepair: { ...settings, channel: "left" } });
  const result = await compileVersion(dir, plan, { manifest, index, encoder: "libx264", tokens: { colors: { surface: "#111111" } }, repairDeps: { binary: options.binary, execute: options.execute }, print: () => {} });
  assert.equal(calls.length, 1, JSON.stringify(result.resolvedPlan.items[0]));
  assert.equal(result.resolvedPlan.items[0].audioRepairResult.status, "repaired");
  assert.equal(result.resolvedPlan.frames, 30);
  assert.equal((await decode(path.join(dir, "work/full/compile/t2.wav"), dir)).length, 48000 * 4);
});

test("selected audio stream and source packet offsets survive the context pass", async (t) => {
  const { dir, source, options } = await fixture(t);
  const multi = path.join(dir, "streams.mkv"), scratch = path.join(dir, "compile"); fs.mkdirSync(scratch);
  await run("ffmpeg", ["-y", "-v", "error", "-i", source, "-itsoffset", "0.125", "-i", source, "-map", "0:a:0", "-map", "1:a:0", "-c:a", "pcm_f32le", multi], { capture: true });
  const item = { id: "offset", kind: "clip", in: 0.3, out: 1.3, frames: 30, audioRepair: { ...settings, channel: "right" } };
  writeJSON(path.join(dir, "work/index/offset.reactions.json"), { key: "offset", sourceId: "stage", source: multi, spans: [] });
  await preparedAudio(multi, { id: "stage", audio: "ok", audioStream: 1 }, { key: "offset", duration: 2.125, hasAudio: true, audioStream: 0 }, item, scratch,
    { workDir: path.join(dir, "work"), repairDeps: { binary: options.binary, execute: options.execute }, print: () => {} });
  assert.equal(item.audioRepairResult.status, "repaired");
  const record = readJSON(path.resolve(dir, item.audioRepairResult.sidecar));
  assert.equal(record.evidence.stream, 1);
  const original = await decode(path.resolve(dir, item.audioRepairResult.original), dir), repaired = await decode(path.resolve(dir, item.audioRepairResult.file), dir);
  let max = 0;
  for (let n = 0; n < 48000; n++) max = Math.max(max, Math.abs(repaired.readFloatLE(n * 4) - original.readFloatLE(n * 4) * 0.5));
  assert.ok(max < 1e-6, `selected stream alignment error ${max}`);
  t.diagnostic(`nondefault audio stream 1, 125 ms packet offset: max aligned sample error ${max}`);
});
