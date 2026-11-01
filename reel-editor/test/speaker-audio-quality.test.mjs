import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUDIO_QUALITY_VERSION, AUDIO_QUALITY_THRESHOLDS, qualityScore, speechPauseSpans, measurePassage, sourceQualityWindows, sourceQuality, cachedPassageQuality, measureSpeakerQuality, measurePlanAudio, audioQualityWarnings, audioQualityRank } from "../src/speaker-audio-quality.mjs";
import { preferredAudioCandidates, starterPlan } from "../src/speaker-plan.mjs";
import { indexSources, loadSourceIndex } from "../src/speaker-index.mjs";
import { parseSpeakerArgs, speakerMain, analyzeSpeaker } from "../src/speaker.mjs";
import { reviewRows, buildReview } from "../src/speaker-review.mjs";
import { speakerQC } from "../src/speaker-qc.mjs";
import { writeJSON, readJSON, run } from "../src/util.mjs";

function temp(t) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-audio-test-")); t.after(() => fs.rmSync(folder, { recursive: true, force: true })); return folder; }
const metrics = (contrastDb = 40, extra = {}) => ({ contrastDb, lufs: -18, truePeak: -3, speechDb: -20, pauseDb: -20 - contrastDb, channelDb: [-20, -20], channelImbalanceDb: 0, clippedPct: 0, dnsmos: null, method: "word-spans", ...extra });
const record = (label, score = 80, contrastDb = 15) => ({ label, score, metrics: metrics(contrastDb), version: AUDIO_QUALITY_VERSION });
const c = (id, label, score = 90, sourceId = id, kind = "story") => ({ id, sourceId, kind, in: 20, out: 80, score, audioQuality: label ? record(label) : undefined, alternates: [] });
const manifestFor = (ids) => ({ schemaVersion: 1, brand: { file: "brand.json" }, clientId: "avery", identity: { name: "Avery", bookingUrl: "https://example.test" }, sources: ids.map((id) => ({ id, kind: "stage", audio: "ok", path: `${id}.wav`, rights: "r" })), proof: [], rights: [{ id: "r", status: "approved" }], music: [] });

test("quality score is monotonic in contrast, clipping, imbalance and low loudness; boundaries are inclusive", () => {
  let previous = -1;
  for (let contrast = -30; contrast <= 80; contrast += 0.25) { const q = qualityScore(metrics(contrast)); assert.ok(q.score >= previous && q.score >= 0 && q.score <= 100); previous = q.score; }
  for (const [name, minimum] of Object.entries(AUDIO_QUALITY_THRESHOLDS)) {
    assert.equal(qualityScore(metrics(minimum / 2.5)).label, name);
    assert.notEqual(qualityScore(metrics((minimum - 0.02) / 2.5)).label, name);
  }
  for (const [key, values] of [["clippedPct", [0, 0.2, 1, 5, 30]], ["channelImbalanceDb", [0, 6, 10, 20, 43]], ["lufs", [-18, -35, -40, -50, -70]]]) {
    previous = 101;
    for (const value of values) { const { score } = qualityScore(metrics(15, { [key]: value })); assert.ok(score <= previous); previous = score; }
  }
  assert.equal(qualityScore(metrics(0, { lufs: -70 })).label, "reject");
  assert.deepEqual(qualityScore({}), { score: null, label: null });
  assert.equal(qualityScore(metrics(15, { dnsmos: { sig: 1, bak: 1, ovrl: 1 } })).score, qualityScore(metrics(15)).score);
  // Julee pilot floor contrasts (P90-P5, 2026-11-01): board feeds clean, Audacious phone clean, Florida phone weak.
  for (const [db, label] of [[58.7, "clean"], [43.1, "clean"], [30.9, "clean"], [13.1, "weak"], [4.4, "weak"], [2, "reject"]]) assert.equal(qualityScore(metrics(db)).label, label);
});

test("speech/pause spans merge overlaps, clamp to passage and trim only internal gaps >=250ms", () => {
  const words = [{ start: 9, end: 10.2 }, { start: 10.1, end: 10.5 }, { start: 10.75, end: 11 }, { start: 11.1, end: 11.5 }, { start: 12, end: 14 }, { start: NaN, end: 14 }];
  assert.deepEqual(speechPauseSpans(words, { start: 10, end: 13 }), { speech: [{ start: 10, end: 10.5 }, { start: 10.75, end: 11 }, { start: 11.1, end: 11.5 }, { start: 12, end: 13 }], pauses: [{ start: 10.56, end: 10.69 }, { start: 11.56, end: 11.94 }] });
  assert.deepEqual(speechPauseSpans([], { start: 0, end: 2 }), { speech: [], pauses: [] });
});

test("measurePassage obeys selected stream, seeks first and measures exact samples without channel cancellation", async () => {
  const calls = [];
  const fakeRun = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "ffprobe") return { out: JSON.stringify({ streams: [{ codec_type: "audio", index: 2, channels: 2, sample_rate: "1000" }] }) };
    const buffer = Buffer.alloc(2 * 4 * 2000);
    for (let i = 0; i < 2000; i++) {
      const speech = i < 400 || i >= 1000 && i < 1400;
      buffer.writeFloatLE(speech ? 0.2 : 0.01, i * 8); buffer.writeFloatLE(speech ? -0.002 : -0.0001, i * 8 + 4);
    }
    fs.writeFileSync(args.at(-1), buffer);
    return { err: "Summary:\n Integrated loudness:\n I: -17.1 LUFS\n True peak:\n Peak: -3.2 dBFS" };
  };
  const q = await measurePassage("fake.wav", { start: 10, end: 12, audioStream: 2, words: [{ start: 10, end: 10.4 }, { start: 11, end: 11.4 }], run: fakeRun });
  assert.equal(q.method, "word-spans"); assert.equal(q.lufs, -17.1); assert.equal(q.truePeak, -3.2);
  assert.ok(Math.abs(q.contrastDb - 26.02) < 0.03); assert.ok(Math.abs(q.channelImbalanceDb - 40) < 0.03); assert.equal(q.clippedPct, 0);
  const args = calls[1][1]; assert.ok(args.indexOf("-ss") < args.indexOf("-i")); assert.equal(args[args.indexOf("-map") + 1], "0:2");
  assert.ok(!fs.existsSync(args.at(-1)), "temporary PCM was removed");
  await assert.rejects(measurePassage("x", { start: 1, end: 1, run: fakeRun }), /invalid passage/);
  await assert.rejects(measurePassage("x", { start: 0, end: 1, audioStream: 3, run: fakeRun }), /stream missing/);
});

test("measurePassage fallback reports percentiles, exact clipping fraction and silence", async () => {
  const fakeRun = async (cmd, args) => {
    if (cmd === "ffprobe") return { out: JSON.stringify({ streams: [{ codec_type: "audio", index: 0, channels: 1, sample_rate: "1000" }] }) };
    const raw = Buffer.alloc(4000);
    for (let i = 0; i < 1000; i++) raw.writeFloatLE(i < 500 ? 1 : 0, i * 4);
    fs.writeFileSync(args.at(-1), raw); return { err: "Summary:\n I: -3 LUFS\n Peak: 0 dBFS" };
  };
  const q = await measurePassage("fake.wav", { start: 0, end: 1, run: fakeRun });
  assert.equal(q.clippedPct, 50); assert.equal(q.method, "rms-percentiles-50ms"); assert.equal(q.contrastDb, 120); assert.equal(q.channelImbalanceDb, 0);
});

test("tiny sine speech bursts over quiet versus loud seeded noise have clearly different word/pause contrast", async (t) => {
  const folder = temp(t), words = [{ start: 0.2, end: 0.7 }, { start: 1.2, end: 1.7 }], results = [];
  for (const [name, floor] of [["quiet", 0.0002], ["loud", 0.25]]) {
    const file = path.join(folder, `${name}.wav`);
    await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*440*t)*(between(t\\,0.2\\,0.7)+between(t\\,1.2\\,1.7)):s=16000:d=2", "-f", "lavfi", "-i", `anoisesrc=amplitude=${floor}:sample_rate=16000:duration=2:seed=123`, "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0", "-c:a", "pcm_f32le", file], { capture: true });
    results.push(await measurePassage(file, { start: 0, end: 2, words }));
  }
  assert.ok(results.every((r) => Number.isFinite(r.lufs) && Number.isFinite(r.truePeak) && r.method === "word-spans"));
  assert.ok(results[0].contrastDb > results[1].contrastDb + 25, JSON.stringify(results));
  assert.equal(qualityScore(results[0]).label, "clean"); assert.equal(qualityScore(results[1]).label, "weak");
});

test("source windows cover spread speech, deduplicate short clips, skip forbidden/no-word sources and aggregate medians", async () => {
  const row = { audio: "ok", duration: 200, audioStream: 2, words: Array.from({ length: 100 }, (_, i) => ({ start: i * 2, end: i * 2 + 1 })) };
  const windows = sourceQualityWindows(row);
  assert.equal(windows.length, 5); assert.ok(windows[0].start < 20 && windows.at(-1).start > 160); assert.ok(windows.every((w) => w.end - w.start === 20));
  assert.equal(sourceQualityWindows({ ...row, duration: 10, words: [{ start: 0, end: 10 }] }).length, 1);
  for (const variant of [{ ...row, audio: "bad" }, { ...row, words: [] }]) { assert.deepEqual(sourceQualityWindows(variant), []); assert.equal(await sourceQuality("x", variant), null); }
  assert.throws(() => sourceQualityWindows(row, { windows: 0 }), /positive integer/);
  const calls = [];
  const q = await sourceQuality("x", row, { passage: async (_file, range) => { calls.push(range); return { metrics: metrics(calls.length * 10, { channelDb: [-20, -21] }) }; } });
  assert.equal(calls.length, 5); assert.equal(q.metrics.contrastDb, 30); assert.equal(q.label, "clean"); assert.equal(q.metrics.method, "source-window-medians"); assert.ok(calls.every((r) => r.audioStream === 2));
});

test("cache reuses passages, invalidates version/timings/adapter, writes optional DNSMOS and fails open", async (t) => {
  const folder = temp(t), source = { id: "stage", path: "stage.wav", audio: "ok" }, row = { key: "content", audioStream: 0, words: [{ start: 0, end: 0.5 }, { start: 1, end: 2 }] };
  fs.writeFileSync(path.join(folder, "stage.wav"), "tiny fake media");
  let calls = 0;
  const measure = async () => { calls++; return metrics(); };
  const range = { start: 0, end: 2, measure, print: () => {} };
  await cachedPassageQuality(folder, source, row, range); await cachedPassageQuality(folder, source, row, range); assert.equal(calls, 1);
  row.words[0].end = 0.6; await cachedPassageQuality(folder, source, row, range); assert.equal(calls, 2);
  const file = path.join(folder, "work/index/content.quality.json"), old = readJSON(file); old.version = 0; writeJSON(file, old);
  await cachedPassageQuality(folder, source, row, range); assert.equal(calls, 3);
  const mos = async () => ({ sig: 4, bak: 3.5, ovrl: 3.9 }); mos.version = "hash-v1";
  const q = await cachedPassageQuality(folder, source, row, { ...range, scoreDnsmos: mos }); assert.equal(q.metrics.dnsmos.ovrl, 3.9); assert.equal(calls, 4);
  await cachedPassageQuality(folder, source, row, { ...range, scoreDnsmos: mos }); assert.equal(calls, 4);
  mos.version = "hash-v2"; await cachedPassageQuality(folder, source, row, { ...range, scoreDnsmos: mos }); assert.equal(calls, 5);
  const lines = [];
  const failed = await cachedPassageQuality(folder, source, row, { ...range, scoreDnsmos: async () => { throw new Error("no runtime"); }, print: (s) => lines.push(s) });
  assert.equal(failed.metrics.dnsmos, null); assert.equal(lines.length, 1); assert.match(lines[0], /DNSMOS unavailable/);
  assert.equal(await cachedPassageQuality(folder, { ...source, audio: "bad" }, row, range), null);
});

test("alternate preference preserves the ten-point editorial floor, ranks clean before weak and never selects rejects", () => {
  const weak = c("phone", "weak", 95), clean = c("board", "clean", 88); weak.alternates = [clean, c("awful", "reject", 100), c("low", "clean", 70)];
  assert.equal(preferredAudioCandidates([weak])[0].id, "board");
  assert.equal(preferredAudioCandidates([{ ...weak, alternates: [c("too-low", "clean", 84)] }])[0].id, "phone");
  assert.equal(preferredAudioCandidates([{ ...weak, alternates: [c("edge", "clean", 85)] }])[0].id, "edge");
  assert.deepEqual(preferredAudioCandidates([c("bad", "reject")]), []);
  assert.equal(preferredAudioCandidates([c("unknown", null)])[0].id, "unknown");
  assert.ok(audioQualityRank(record("clean")) > audioQualityRank(record("usable"))); assert.ok(audioQualityRank() > audioQualityRank(record("weak"))); assert.ok(audioQualityRank(record("weak")) > audioQualityRank(record("reject")));
  const manifest = manifestFor(["phone", "board", "awful", "low"]);
  assert.equal(starterPlan(manifest, [weak]).items.find((i) => i.role === "core").sourceId, "board");
  assert.ok(starterPlan(manifest, [c("phone", "weak")]).notes.some((n) => /weak audio/.test(n)));
  assert.ok(!starterPlan(manifest, [c("awful", "reject")]).items.some((i) => i.kind === "clip"));
  manifest.sources.find((s) => s.id === "board").audio = "bad";
  assert.equal(starterPlan(manifest, [weak]).items.find((i) => i.role === "core").sourceId, "phone");
});

test("role budget chooses a complete fitting alternate and label ranks before score across stories", () => {
  const story = c("long", "clean", 95); story.out = 220; story.alternates = [c("short", "usable", 90)];
  const manifest = manifestFor(["long", "short", "phone"]);
  assert.equal(starterPlan(manifest, [story, c("phone", "weak", 99)]).items.find((i) => i.role === "core").sourceId, "short");
});

function fixture(folder) {
  const manifest = manifestFor(["stage", "other", "bad"]); manifest.sources[2].audio = "bad";
  for (const source of manifest.sources) fs.writeFileSync(path.join(folder, source.path), "tiny fake media");
  const index = { clientId: "avery", sources: Object.fromEntries(manifest.sources.map((s) => [s.id, { audio: s.audio, key: `${s.id}-key`, duration: 4, audioStream: 0, words: [{ start: 0, end: 1 }, { start: 2, end: 3 }] }])) };
  writeJSON(path.join(folder, "work/index/sources.json"), index);
  const candidate = { ...c("stage-passage", null, 90, "stage"), in: 0, out: 3, alternates: [{ ...c("other-passage", null, 85, "other"), in: 0, out: 3 }, { ...c("forbidden", null, 95, "bad"), in: 0, out: 3 }] };
  writeJSON(path.join(folder, "work/candidates/all.json"), [candidate]); writeJSON(path.join(folder, "work/candidates/stage.json"), [candidate]);
  return { manifest, index };
}

test("quality sweep updates sources and every candidate copy/alternate, caches repeats and honors --source", async (t) => {
  const folder = temp(t), { manifest, index } = fixture(folder); let calls = 0;
  const measure = async () => { calls++; return metrics(); }, lines = [];
  await measureSpeakerQuality(folder, { manifest, index, measure, print: (s) => lines.push(s) });
  assert.equal(calls, 4, "one source window and one passage per permitted source");
  const saved = readJSON(path.join(folder, "work/index/sources.json")); assert.equal(saved.sources.stage.audioQuality.label, "clean"); assert.ok(!saved.sources.bad.audioQuality);
  for (const name of ["all", "stage"]) { const candidate = readJSON(path.join(folder, `work/candidates/${name}.json`))[0]; assert.equal(candidate.audioQuality.label, "clean"); assert.equal(candidate.alternates[0].audioQuality.label, "clean"); assert.ok(!candidate.alternates[1].audioQuality); }
  await measureSpeakerQuality(folder, { manifest, index, measure, print: () => {} }); assert.equal(calls, 4);
  assert.match(lines[0], /source\/candidate.*contrastDb.*LUFS/);
  await assert.rejects(measureSpeakerQuality(folder, { manifest, index, source: "missing" }), /unknown sourceId/);
  const second = temp(t), data = fixture(second);
  await measureSpeakerQuality(second, { ...data, source: "stage", measure, print: () => {} });
  assert.ok(!readJSON(path.join(second, "work/candidates/all.json"))[0].alternates[0].audioQuality);
});

test("quality sweep and exact review range measurements fail open without inventing a bad score", async (t) => {
  const folder = temp(t), { manifest, index } = fixture(folder), lines = [];
  await measureSpeakerQuality(folder, { manifest, index, measure: async () => { throw new Error("ffmpeg missing"); }, print: (s) => lines.push(s) });
  assert.ok(lines.some((s) => /unavailable/.test(s))); assert.ok(!index.sources.stage.audioQuality);
  const plan = { items: [{ id: "i1", kind: "clip", sourceId: "stage", audio: "source", in: 0.25, out: 2.75 }, { id: "bad", kind: "clip", sourceId: "bad", audio: "source", in: 0, out: 2 }] };
  const ranges = [];
  await measurePlanAudio(folder, plan, manifest, { index, measure: async (_file, range) => { ranges.push([range.start, range.end]); return metrics(); } });
  assert.deepEqual(ranges, [[0.25, 2.75]]); assert.equal(plan.items[0].audioQuality.label, "clean"); assert.ok(!plan.items[1].audioQuality);
  plan.items[0].out = 3;
  await measurePlanAudio(folder, plan, manifest, { index, measure: async () => { throw new Error("no decoder"); }, print: () => {} });
  assert.ok(!plan.items[0].audioQuality, "failed new range never retains stale quality");
});

test("CLI accepts quality --source and routes it without transcription or rendering", async () => {
  assert.equal(parseSpeakerArgs(["quality", "/tmp/client", "--source", "stage"]).command, "quality");
  let supplied;
  await speakerMain(["quality", "/tmp/client", "--source", "stage"], { quality: async (folder, opts) => { supplied = { folder, ...opts }; }, print: () => {} });
  assert.equal(supplied.source, "stage"); assert.equal(supplied.folder, "/tmp/client");
});

test("QC warns for each weak speech role, names a permitted cleaner alternate, and review rows keep measurements", () => {
  const manifest = manifestFor(["phone", "board"]), weak = c("phone", "weak"), board = c("board", "clean", 85); weak.alternates = [board];
  const plan = { version: "full", items: ["core", "room", "testimonial", "opening"].map((role, i) => ({ ...weak, id: `i${i}`, kind: "clip", role, audio: "source", start: i * 60, end: (i + 1) * 60 })) };
  const checks = audioQualityWarnings(plan, [weak], manifest); assert.equal(checks.length, 3); assert.ok(checks.every((w) => w.level === "warn" && /cleaner alternate board/.test(w.message)));
  manifest.sources[1].audio = "bad"; assert.ok(!audioQualityWarnings(plan, [weak], manifest)[0].message.includes("cleaner alternate board"));
  const broad = { ...weak, in: 0, out: 90, audioQuality: record("clean") };
  assert.ok(!audioQualityWarnings(plan, [broad], manifest)[0].message.includes("cleaner alternate"), "a cleaner average of the same passage is not an alternate performance");
  assert.equal(audioQualityWarnings(plan, {}, manifest).length, 3, "malformed optional candidate evidence cannot block QC");
  plan.items[1].audio = "mute"; assert.equal(audioQualityWarnings(plan, [weak], manifest).length, 2);
  const row = reviewRows(plan, manifest)[0]; assert.equal(row.audioQuality.label, "weak"); assert.equal(row.audioQuality.metrics.contrastDb, 15);
});

test("normal indexing and loadSourceIndex retain measured source quality without ASR cache changes", async (t) => {
  const folder = temp(t), manifest = manifestFor(["stage"]); fs.writeFileSync(path.join(folder, "stage.wav"), "tiny fake media");
  let transcriptions = 0;
  const deps = { transcribe: async () => { transcriptions++; return [{ start: 0, end: 1, text: "Hello." }]; }, probe: async () => ({ duration: 2, audioStreams: [{ index: 0 }], hasAudio: true }), audioEnvelope: async () => ({ step: 0.02, db: [] }), print: () => {} };
  const first = await indexSources(folder, manifest, deps); first.sources.stage.audioQuality = record("clean"); writeJSON(path.join(folder, "work/index/sources.json"), first);
  const transcript = fs.readFileSync(path.join(folder, `work/index/${first.sources.stage.key}.words.json`), "utf8");
  const second = await indexSources(folder, manifest, deps); assert.equal(second.sources.stage.audioQuality.label, "clean"); assert.equal(transcriptions, 1);
  assert.equal(loadSourceIndex(folder, manifest).sources.stage.audioQuality.label, "clean"); assert.equal(fs.readFileSync(path.join(folder, `work/index/${first.sources.stage.key}.words.json`), "utf8"), transcript);
});

test("candidates runs quality after saving, fails open on analysis failure, and reactions-only skips it", async (t) => {
  const folder = temp(t), manifest = manifestFor(["stage"]);
  fs.writeFileSync(path.join(folder, "stage.wav"), "tiny fake media");
  writeJSON(path.join(folder, "brand.json"), { name: "Avery" }); writeJSON(path.join(folder, "speaker-manifest.json"), manifest);
  await indexSources(folder, manifest, { transcribe: async () => [{ start: 0, end: 1, text: "Hello." }], probe: async () => ({ duration: 2, audioStreams: [{ index: 0 }], hasAudio: true }), audioEnvelope: async () => ({ step: 0.02, db: [] }), print: () => {} });
  let calls = 0; const lines = [];
  const deps = { reactions: async () => [], shots: async () => [], candidates: async () => [], quality: async (_folder, options) => { calls++; assert.equal(options.source, "stage"); assert.ok(fs.existsSync(path.join(folder, "work/candidates/all.json"))); throw new Error("unavailable"); }, print: (s) => lines.push(s) };
  assert.deepEqual(await analyzeSpeaker(folder, { source: "stage" }, deps), []);
  assert.equal(calls, 1); assert.ok(lines.some((s) => /audio quality unavailable/.test(s)));
  await analyzeSpeaker(folder, { source: "stage", reactionsOnly: true }, deps); assert.equal(calls, 1);
});

test("review uses exact cached range in HTML and saved plan; QC emits advisory WARN and a cleaner alternate", async (t) => {
  const folder = temp(t), manifest = manifestFor(["stage", "board"]);
  fs.writeFileSync(path.join(folder, "stage.wav"), "tiny fake media");
  writeJSON(path.join(folder, "brand.json"), { name: "Avery", fonts: { display: "Arial", body: "Arial" }, colors: { text: "#fff", bg: "#111", accent: "#f90" } });
  writeJSON(path.join(folder, "speaker-manifest.json"), manifest);
  const row = { key: "stage", audio: "ok", words: [{ start: 0.5, end: 1 }, { start: 2, end: 2.5 }], audioStream: 0 };
  writeJSON(path.join(folder, "work/index/sources.json"), { sources: { stage: row } });
  await cachedPassageQuality(folder, manifest.sources[0], row, { start: 0.25, end: 2.75, measure: async () => metrics(3) });
  const item = { id: "i1", kind: "clip", role: "core", sourceId: "stage", in: 0.25, out: 2.75, start: 0, end: 2.5, audio: "source", audioQuality: record("clean") };
  const plan = { schemaVersion: 1, clientId: "avery", version: "full", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 }, items: [item, { id: "booking", kind: "card", role: "booking", card: { type: "booking" }, start: 2.5, end: 8.5, duration: 6 }] };
  const video = path.join(folder, "work/full/draft.mp4"); fs.mkdirSync(path.dirname(video), { recursive: true }); fs.writeFileSync(video, "fake rendered bytes");
  const result = await buildReview(folder, { version: "full", video, manifest, resolvedPlan: plan, frameGrab: async ({ file }) => fs.writeFileSync(file, "frame"), qc: async () => ({ ok: true, checks: [] }) });
  assert.match(fs.readFileSync(result.index, "utf8"), /Audio: weak · contrast 3 dB/); assert.equal(readJSON(path.join(folder, "work/full/plan.resolved.json")).items[0].audioQuality.label, "weak");
  const candidate = { ...c("stage-c", "weak", 90, "stage"), in: 0, out: 3, alternates: [{ ...c("board-c", "clean", 85, "board"), in: 1, out: 4 }] };
  writeJSON(path.join(folder, "work/candidates/all.json"), [candidate]);
  const qc = await speakerQC(video, { resolvedPlan: plan, manifest, captionFiles: { srt: path.join(result.dir, "captions.srt"), vtt: path.join(result.dir, "captions.vtt") }, deps: { probe: async () => ({ duration: 8.5, width: 1920, height: 1080, fps: 30, pixFmt: "yuv420p", codec: "h264" }), encoding: async () => ({ video: { avg_frame_rate: "30/1" }, audio: { codec_name: "aac", sample_rate: "48000", channels: 2 } }), measureLoudness: async () => ({ i: -14, tp: -1 }), silences: async () => [], blackGaps: async () => [] } });
  assert.equal(qc.ok, true); assert.match(qc.checks.find((c) => c.code === "audio-quality").message, /i1: weak core audio.*cleaner alternate board-c/);
});

test("manifest video proof cannot bypass an exact candidate reject and weak proof receives a plan note", () => {
  const manifest = manifestFor(["stage"]), rejected = { ...c("testimony", "reject", 90, "stage", "testimonial"), in: 0, out: 5 };
  manifest.proof = [{ id: "proof", kind: "testimonial-video", sourceId: "stage", in: 0, out: 5, rights: "r", attribution: { name: "Organizer" } }];
  assert.ok(!starterPlan(manifest, [rejected]).items.some((i) => i.role === "testimonial"));
  rejected.audioQuality = record("weak"); assert.ok(starterPlan(manifest, [rejected]).notes.some((n) => /testimonial: weak audio/.test(n)));
});
