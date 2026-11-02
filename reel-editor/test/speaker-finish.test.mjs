import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { cardOptionProblems, resolveCard, keywordCard } from "../src/speaker-cards.mjs";
import { motionProblems, validateKeywords } from "../src/speaker-beats.mjs";
import { timelineWords, captionFiles, validatePlan, resolvePlan } from "../src/speaker-compile.mjs";
import { sliceWords } from "../src/clips.mjs";
import { wordBoundaryProblems, brightnessFlashes, frameIntegrityChecks, speakerQC, FRAME_INTEGRITY_FILTER } from "../src/speaker-qc.mjs";
import { resolveBrandTokens } from "../src/brandtokens.mjs";
import { run, writeJSON } from "../src/util.mjs";

const manifest = { clientId: "finish", identity: { name: "Avery", bookingMode: "direct", bookingUrl: "https://example.com" }, sources: [{ id: "s", path: "s.mp4", kind: "stage", audio: "ok", rights: "r" }], rights: [{ id: "r", status: "approved" }], proof: [] };
const tokens = resolveBrandTokens({ brand: { name: "Avery", colors: { bg: "#111111", text: "#ffffff", accent: "#ffb27d" }, fonts: { display: "Example Display", body: "Example Body" } } });
const phrase = { type: "keyword", layout: "cinematic", variant: "phrase", text: "What if I did?", motion: "rise" };
const sourceWords = "What if I did? then What if I did?".split(" ").map((text, n) => ({ text, start: 10 + n * 0.4, end: 10.3 + n * 0.4 }));
const index = { sources: { s: { width: 1920, height: 1080, duration: 20, words: sourceWords } } };
const plan = () => ({ schemaVersion: 1, clientId: "finish", version: "full", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 }, items: [
  { id: "talk", kind: "clip", role: "opening", sourceId: "s", in: 10, out: 14 },
  { id: "book", kind: "card", role: "booking", duration: 6, card: { type: "booking" } },
], overlays: [{ id: "k", at: "talk", offset: 2, duration: 2, card: phrase, sourceWordRange: { start: 5, end: 8 } }] });
const resolved = () => resolvePlan(plan(), { manifest, index });
const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-finish-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const calls = (timeline) => {
  const result = [];
  vm.runInNewContext(timeline, { tl: { set: (...args) => result.push(["set", ...args]), fromTo: (...args) => result.push(["fromTo", ...args]) } });
  return result;
};

test("phrase variant permits four verbatim words only on cinematic keyword overlays", () => {
  assert.deepEqual(cardOptionProblems(phrase, "overlay"), []);
  const result = resolveCard(phrase, { manifest, mode: "overlay" });
  assert.deepEqual(result.problems, []);
  assert.equal(result.card.variant, "phrase");
  assert.deepEqual(validatePlan(plan(), { manifest, index }), []);
  for (const card of [{ ...phrase, layout: "compact" }, { ...phrase, layout: "standard" }, { ...phrase, type: "topic" }, { ...phrase, variant: "other" }]) {
    assert.ok(cardOptionProblems(card, "overlay").length);
    assert.ok(resolveCard(card, { manifest, mode: "overlay" }).problems.length);
  }
  assert.ok(cardOptionProblems(phrase, "insert").length);
  for (const text of ["", "What if I did tomorrow"]) {
    const p = plan(); p.overlays[0].card = { ...phrase, text };
    assert.ok(resolveCard(p.overlays[0].card, { manifest, mode: "overlay" }).problems.length);
    assert.ok(motionProblems(p, manifest).some((c) => /one to four/.test(c.message)));
  }
  const p = plan(); p.overlays[0].card = { ...phrase, variant: undefined };
  assert.ok(motionProblems(p, manifest).some((c) => /one to three/.test(c.message)));
});

test("sourceWordRange selects the intended repeated utterance at compile and composition preflight", () => {
  const p = resolved(), words = timelineWords(p, index);
  assert.deepEqual(words.map((w) => w.sourceWordIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(validateKeywords(p, words, manifest), []);
  p.overlays[0].sourceWordRange = { start: 0, end: 3 };
  assert.ok(validateKeywords(p, words, manifest).some((c) => /overlap/.test(c.message)));
  const raw = plan(); raw.overlays[0].sourceWordRange = { start: 0, end: 3 };
  assert.ok(validatePlan(raw, { manifest, index }).some((c) => /overlap/.test(c.message)));
  delete p.overlays[0].sourceWordRange;
  assert.deepEqual(validateKeywords(p, words, manifest), [], "unanchored legacy matching stays valid");
});

test("keyword anchors reject invalid, missing, reversed, cross-item, partial and inexact ranges", () => {
  for (const range of [[], { start: -1, end: 3 }, { start: 8, end: 5 }, { start: 5.5, end: 8 }, { start: 5 }, "5-8", { start: 4, end: 8 }, { start: 5, end: 9 }]) {
    const p = resolved(); p.overlays[0].sourceWordRange = range;
    assert.ok(validateKeywords(p, timelineWords(p, index), manifest).length, JSON.stringify(range));
  }
  const p = resolved(), words = timelineWords(p, index);
  assert.ok(validateKeywords(p, words.map((w) => ({ ...w, itemId: "elsewhere" })), manifest).length);
  assert.ok(validateKeywords(p, words.map((w) => ({ ...w, sourceId: "elsewhere" })), manifest).length);
  words[5].sourceStart = p.items[0].in - 0.1;
  assert.ok(validateKeywords(p, words, manifest).length, "partially retained words cannot anchor a complete phrase");
  const raw = plan(); raw.items[0].in = 12.05;
  assert.ok(validatePlan(raw, { manifest, index }).some((c) => /sourceWordRange/.test(c.message)));
});

test("phrase keywords retain duration, spacing, order and testimonial restrictions", () => {
  for (const duration of [1.1, 2.6]) {
    const p = plan(); p.overlays[0].duration = duration;
    assert.ok(motionProblems(p, manifest).some((c) => /duration/.test(c.message)));
  }
  const p = plan(); p.overlays.push({ ...p.overlays[0], id: "k2", offset: 0 });
  assert.ok(motionProblems(p, manifest).some((c) => /20 seconds/.test(c.message)));
  p.items[0].role = "testimonial";
  assert.ok(motionProblems(p, manifest).some((c) => /testimonial/.test(c.message)));
  const r = resolved(); r.overlays[0].card = { ...phrase, text: "did I if What" };
  assert.ok(validateKeywords(r, timelineWords(r, index), manifest).length);
});

test("cinematic keyword rise uses 24px, six frames, fixed scale and a four-frame exit", () => {
  const card = resolveCard(phrase, { manifest, mode: "overlay" }).card;
  const r = keywordCard(card, { tokens, start: 31 / 30, end: 91 / 30 });
  const c = calls(r.timeline);
  assert.equal(c[1][1], "#speaker-card .sc-cinematic-copy");
  assert.deepEqual({ ...c[1][2] }, { autoAlpha: 0, y: 24, scale: 1 });
  assert.equal(c[1][3].scale, 1); assert.equal(c[1][3].duration, 6 / 30);
  assert.equal(c[1][4], 31 / 30); assert.equal(c[2][4], 87 / 30);
  assert.equal(c[2][3].duration, 4 / 30); assert.equal(c[3][3], 91 / 30);
  assert.equal(r.durationHints.fullyLegible, 50 / 30);
  assert.ok(!r.timeline.includes("0.82"));
  const legacy = keywordCard({ text: "Act", motion: "scale", position: "center" }, { tokens, start: 1, end: 3 });
  assert.ok(legacy.timeline.includes("scale:0.82"));
});

test("bundled GSAP keeps cinematic keyword scale at one on forward and backward frame seeks", () => {
  const r = keywordCard({ ...phrase }, { tokens, start: 1, end: 3 });
  const context = { setTimeout: () => 0, clearTimeout: () => {} }; vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const tl = context.window.gsap.timeline({ paused: true }), root = { autoAlpha: 0 }, copy = { autoAlpha: 0, y: 0, scale: 1 };
  const target = (s) => s.endsWith(".sc-cinematic-copy") ? copy : root;
  vm.runInNewContext(r.timeline, { tl: { set: (s, ...args) => tl.set(target(s), ...args), fromTo: (s, ...args) => tl.fromTo(target(s), ...args) } });
  for (const frame of [29, 30, 31, 33, 36, 60, 86, 88, 89, 90, 33, 60, 30, 90]) {
    tl.seek(frame / 30);
    assert.equal(copy.scale, 1);
    if (frame < 30 || frame >= 90) assert.equal(root.autoAlpha, 0);
    else {
      assert.ok(Math.abs(root.autoAlpha - (frame <= 86 ? 1 : (90 - frame) / 4)) < 1e-5);
      const progress = Math.min(1, (frame - 30) / 6), eased = 1 - (1 - progress) ** 3;
      assert.ok(Math.abs(copy.y - 24 * (1 - eased)) < 1e-4);
      assert.ok(Math.abs(copy.autoAlpha - eased) < 1e-5);
    }
  }
});

test("speaker captions include majority-retained words at either boundary, clamp cues and preserve literal copy", () => {
  const words = [{ text: "yourself,", start: 10, end: 11 }, { text: "create!", start: 11, end: 12 }, { text: "unheard", start: 13, end: 14 }];
  const p = { canvas: { fps: 30 }, items: [{ id: "a", kind: "clip", sourceId: "s", in: 10.2, out: 11.7, start: 0, end: 1.5 }] };
  const kept = timelineWords(p, { sources: { s: { words } } });
  assert.deepEqual(kept.map((w) => [w.text, w.start, w.end]), [["yourself,", 0, 0.8], ["create!", 0.8, 1.5]]);
  assert.equal(kept[1].sourceWordIndex, 1);
  const captions = captionFiles(kept, 1.5);
  assert.match(captions.srt, /yourself, create!/); assert.match(captions.vtt, /yourself, create!/);
  assert.ok(!captions.srt.includes("unheard"));
  assert.deepEqual(sliceWords(words, 10.2, 11.7), [], "daily-reel slicing remains unchanged");
});

test("speaker captions omit half-or-less, zero-length, muted and words lost to frame rounding", () => {
  const words = [{ text: "half", start: 10, end: 11 }, { text: "zero", start: 11, end: 11 }];
  const p = { items: [{ id: "a", kind: "clip", sourceId: "s", in: 10.5, out: 11.5, start: 0, end: 1 }] };
  const idx = { s: { words } };
  assert.deepEqual(timelineWords(p, idx), []);
  p.items[0].in = 10.6; assert.deepEqual(timelineWords(p, idx), []);
  p.items[0].in = 10; p.items[0].out = 10.51; p.items[0].end = 0.5;
  assert.deepEqual(timelineWords(p, idx), [], "actual retained frame span decides majority");
  p.items[0].end = 0.51; assert.equal(timelineWords(p, idx).length, 1);
  p.items[0].audio = "mute"; assert.deepEqual(timelineWords(p, idx), []);
});

test("boundary QC names in/out cuts, indexed spans and safe endpoints, with 50ms tolerance", () => {
  const words = [{ text: "yourself", start: 14.72, end: 15.22 }];
  const clip = { id: "v1", kind: "clip", sourceId: "s", in: 14.8, out: 15.09 };
  const checks = wordBoundaryProblems(clip, words);
  assert.deepEqual(checks.map((c) => c.boundary), ["in", "out"]);
  assert.ok(checks.every((c) => c.level === "warn" && c.word === "yourself" && c.safeOut >= 15.22 && c.safeIn <= 14.72));
  assert.match(checks[1].message, /v1.*yourself.*safe out/);
  assert.deepEqual(wordBoundaryProblems({ ...clip, in: 14.72, out: 15.22 }, words), []);
  assert.deepEqual(wordBoundaryProblems({ ...clip, in: 14.77, out: 15.17 }, words), []);
  assert.deepEqual(wordBoundaryProblems({ ...clip, audio: "mute" }, words), []);
  assert.deepEqual(wordBoundaryProblems({ ...clip, kind: "card" }, words), []);
  const touching = [...words, { text: "next", start: 15.22, end: 15.4 }];
  assert.equal(wordBoundaryProblems(clip, touching)[1].safeOut, 15.22, "safe out never crosses into the next word");
});

const frames = (values) => values.map((luma, frame) => ({ frame, time: frame / 30, luma }));
test("brightness QC detects isolated bright/dark excursions and rejects cuts, fades and multi-frame changes", () => {
  assert.equal(brightnessFlashes(frames([80, 120, 80]))[0].frame, 1);
  assert.equal(brightnessFlashes(frames([80, 40, 80]))[0].time, 1 / 30);
  for (const values of [[80, 80, 120, 120], [80, 100, 120], [80, 120, 120, 80], [80, 90, 80], [80, 120, 95]]) assert.deepEqual(brightnessFlashes(frames(values)), []);
  assert.deepEqual(brightnessFlashes(frames([80, 120, 80]), { ignoreFrameRanges: [{ start: 1, end: 2 }] }), []);
  assert.equal(brightnessFlashes(frames([80, 120, 80]), { ignoreFrameRanges: [{ start: 0, end: 1 }] }).length, 1, "exclusions are half-open");
  const gap = frames([80, 120, 80]); gap[2].frame = 3;
  assert.deepEqual(brightnessFlashes(gap), []);
  assert.deepEqual(brightnessFlashes(frames([120, 80])), [], "end frames have no two-sided evidence");
});

const mediaDeps = { probe: async () => ({ duration: 10, width: 1920, height: 1080, fps: 30, pixFmt: "yuv420p", codec: "h264" }), encoding: async () => ({ video: { avg_frame_rate: "30/1" }, audio: { codec_name: "aac", sample_rate: "48000", channels: 2 } }), measureLoudness: async () => ({ i: -14, tp: -1 }), silences: async () => [], blackGaps: async () => [] };
test("speaker QC loads indexed words, scans cards, and keeps flash and cut-word findings advisory at final", async (t) => {
  const dir = temp(t), p = resolved(); p.items[0].out = 13.3;
  writeJSON(path.join(dir, "work/index/sources.json"), index);
  const captions = { srt: path.join(dir, "captions.srt"), vtt: path.join(dir, "captions.vtt") };
  for (const file of Object.values(captions)) fs.writeFileSync(file, "");
  let exclusions;
  const qc = await speakerQC("unused.mp4", { folder: dir, resolvedPlan: p, manifest, final: true, captionFiles: captions, frameIntegrityExclusions: [{ start: 40, end: 41 }], deps: { ...mediaDeps,
    frameIntegrityChecks: async (_, options) => { exclusions = options.ignoreFrameRanges; return brightnessFlashes([{ frame: 179, time: 179 / 30, luma: 80 }, { frame: 180, time: 6, luma: 120 }, { frame: 181, time: 181 / 30, luma: 80 }]); },
  } });
  assert.deepEqual(exclusions, [{ start: 40, end: 41 }]);
  assert.equal(qc.ok, true);
  assert.ok(qc.checks.some((c) => c.code === "word-boundary" && c.word === "did?"));
  assert.ok(qc.checks.some((c) => c.code === "brightness-flash" && c.time === 6 && c.level === "warn"), "card spans get scanned too");
});

test("missing index and failed frame scan produce explicit advisory warnings", async (t) => {
  const dir = temp(t), captions = { srt: path.join(dir, "empty.srt"), vtt: path.join(dir, "empty.vtt") };
  for (const file of Object.values(captions)) fs.writeFileSync(file, "");
  const qc = await speakerQC("unused.mp4", { folder: dir, resolvedPlan: resolved(), manifest, captionFiles: captions, deps: { ...mediaDeps, frameIntegrityChecks: async () => { throw new Error("decode unavailable"); } } });
  assert.equal(qc.ok, true);
  assert.ok(qc.checks.some((c) => c.code === "brightness-flash" && c.level === "warn" && /unavailable/.test(c.message)));
  assert.ok(qc.checks.some((c) => c.code === "word-boundary" && c.level === "warn" && /unavailable/.test(c.message)));
});

test("lavfi scan finds exact single-frame bright/dark timestamps and leaves cuts and two-frame flashes alone", async (t) => {
  const dir = temp(t), file = path.join(dir, "flashes.mkv");
  const graph = "color=c=0x808080:s=160x90:r=30:d=1,drawbox=color=white:t=fill:enable='eq(n,5)',drawbox=color=black:t=fill:enable='eq(n,12)',drawbox=color=white:t=fill:enable='between(n,20,21)'";
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", graph, "-c:v", "ffv1", file], { capture: true });
  const flashes = await frameIntegrityChecks(file);
  assert.deepEqual(flashes.map((c) => c.frame), [5, 12]);
  assert.ok(Math.abs(flashes[0].time - 5 / 30) < 0.001);
  assert.ok(Math.abs(flashes[1].time - 12 / 30) < 0.001);
  assert.equal(flashes[0].luma, 235); assert.equal(flashes[1].luma, 16);
  assert.deepEqual((await frameIntegrityChecks(file, { ignoreFrameRanges: [{ start: 5, end: 6 }] })).map((c) => c.frame), [12]);
  const cut = path.join(dir, "cut.mkv");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x808080:s=160x90:r=30:d=1,drawbox=color=white:t=fill:enable='gte(n,15)'", "-c:v", "ffv1", cut], { capture: true });
  assert.deepEqual(await frameIntegrityChecks(cut), []);
  t.diagnostic(`30 frames, 160x90/30fps: bright frame ${flashes[0].frame} at ${flashes[0].time}s YAVG=${flashes[0].luma}; dark frame ${flashes[1].frame} at ${flashes[1].time}s YAVG=${flashes[1].luma}; two-frame flash and hard cut: 0 candidates`);
  t.diagnostic(`analysis filter: ${FRAME_INTEGRITY_FILTER}`);
});
