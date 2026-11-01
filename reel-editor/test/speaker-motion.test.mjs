import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { detectBeats, speakerBeats, sectionBeatTimes, snapFrame, layoutMontage, snapSpeakerPlan, motionProblems, validateKeywords } from "../src/speaker-beats.mjs";
import { licensedMusic, musicProblems, speakerMusicCues, speakerMusicLane, speechBedWarnings } from "../src/speaker-music.mjs";
import { speakerMotionHTML, speakerSfxCues, speakerHTML, composeSpeakerProject, measureSpeechBed } from "../src/speaker-compose.mjs";
import { validatePlan, resolvePlan } from "../src/speaker-compile.mjs";
import { resolveCard, keywordCard, cardDuration, speakerCardsHTML } from "../src/speaker-cards.mjs";
import { resolveBrandTokens } from "../src/brandtokens.mjs";
import { run, writeJSON } from "../src/util.mjs";

const canvas = { width: 1920, height: 1080, fps: 30 };
const manifest = { clientId: "example", identity: { name: "Avery Example", roleLine: "Speaker", bookingText: "Book Avery", bookingMode: "direct", bookingUrl: "https://example.com" }, sources: [{ id: "talk", path: "talk.mp4", kind: "stage", audio: "ok", rights: "r" }, { id: "shot", path: "shot.mp4", kind: "broll", audio: "none", rights: "r" }], rights: [{ id: "r", status: "approved" }], proof: [], music: [{ file: "a.wav", license: "Client licence" }, { file: "b.wav", license: "Client licence" }, { file: "hit.wav", kind: "sfx", license: "Client licence" }] };
const tokens = resolveBrandTokens({ brand: { name: "Avery Example", colors: { bg: "#102030", text: "#ffffff", accent: "#ffb27d" }, fonts: { display: "Example Display", body: "Example Body" } } });
const item = (id, start, end, extra = {}) => ({ id, kind: "clip", sourceId: "talk", in: start, out: end, role: "opening", audio: "source", start, end, outputStart: start, outputEnd: end, startFrame: Math.round(start * 30), endFrame: Math.round(end * 30), ...extra });
const plan = () => ({ schemaVersion: 1, clientId: "example", version: "full", revision: 1, canvas, duration: 12, items: [item("a", 0, 4), item("b", 4, 8), item("c", 8, 12, { role: "core", protect: true })], overlays: [], cutaways: [], music: { tracks: [{ id: "build", file: "a.wav" }, { id: "drive", file: "b.wav" }], sections: [{ from: "a", to: "a", track: "build", start: 3 }, { from: "b", to: "b", track: "drive", start: 1 }] } });
const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-motion-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const at = (cue, t) => cue.points[Math.round(t * 30)].v;
const words = [{ text: "Decide", start: 1, end: 1.3, sourceId: "talk", itemId: "a" }, { text: "Anyway!", start: 1.3, end: 1.8, sourceId: "talk", itemId: "a" }];
const index = { sources: { talk: { duration: 100, width: 1920, height: 1080, hasAudio: true, words }, shot: { duration: 100, width: 1920, height: 1080, hasAudio: false, words: [] } } };

test("multi-track cues: start offsets, 23-frame crossfade, -18 speech/-6 montage and protected silence", () => {
  const p = plan(), before = structuredClone(p), cues = speakerMusicCues(p, words);
  assert.deepEqual(p, before);
  assert.deepEqual(cues.map((c) => c.start), [3, 1]);
  assert.equal(cues[0].outputEnd, 4 + 23 / 30);
  assert.ok(at(cues[0], 4.3) > 0 && at(cues[1], 4.3) > 0);
  assert.ok(Math.abs(at(cues[0], 1.2) - 10 ** (-18 / 20)) < 1e-7);
  assert.ok(Math.abs(at(cues[1], 6) - 10 ** (-6 / 20)) < 1e-7);
  assert.ok(cues.every((c) => c.points.filter((x) => x.t >= 8).every((x) => x.v === 0)));
  assert.ok(cues.every((c) => c.points.every((x) => Math.abs(x.t * 30 - Math.round(x.t * 30)) < 1e-7)));
  assert.ok(speakerMusicLane(p, words).find((x) => x.t === 4.3).v > 0);
  p.music.sections.push({ from: "c", to: "c", track: "build" });
  const protectedCues = speakerMusicCues(p, [{ text: "story", start: 8.1, end: 11 }]);
  assert.ok(protectedCues[1].outputEnd <= 8.1);
  assert.ok(protectedCues[2].points.every((x) => x.v <= 10 ** (-18 / 20) + 1e-7));
});

test("multi-track validation rejects malformed tracks, overlaps and unsafe offsets; licenses gate every track and SFX", (t) => {
  const folder = temp(t), p = plan();
  for (const name of ["a.wav", "b.wav", "hit.wav"]) fs.writeFileSync(path.join(folder, name), "fixture");
  assert.deepEqual(musicProblems(p, manifest), []);
  assert.deepEqual(Object.keys(licensedMusic(folder, p, manifest, { final: true })), ["build", "drive"]);
  const unlicensed = { ...manifest, music: manifest.music.filter((m) => m.file !== "b.wav") }, messages = [];
  assert.throws(() => licensedMusic(folder, p, unlicensed, { final: true }), /b.wav.*licence/);
  assert.ok(!licensedMusic(folder, p, unlicensed, { print: (m) => messages.push(m) }).drive);
  assert.equal(messages.length, 1);
  for (const change of [(p) => p.music.tracks.push({ id: "build", file: "x.wav" }), (p) => p.music.sections[0].start = -1, (p) => p.music.sections[0].fadeIn = NaN, (p) => p.music.sections[0].track = "unknown", (p) => p.music.sections[0].to = "b"]) {
    const bad = plan(); change(bad);
    assert.ok(musicProblems(bad, manifest).length);
    assert.ok(validatePlan(bad, { manifest, index }).some((x) => x.id === "music" && x.level === "error"));
  }
  p.sfx = [{ id: "hit", at: "b", file: "hit.wav", gainDb: -18 }];
  assert.ok(licensedMusic(folder, p, manifest, { final: true })["sfx:hit"]);
  const wrongKind = { ...manifest, music: manifest.music.map((m) => ({ ...m, kind: undefined })) };
  assert.throws(() => licensedMusic(folder, p, wrongKind, { final: true }), /hit.wav.*licence/);
  assert.ok(musicProblems(p, wrongKind).some((x) => /SFX/.test(x.message)));
});

test("120 BPM click detector and hash cache use real ffmpeg PCM, with no network or Python", async (t) => {
  const folder = temp(t), file = path.join(folder, "click.wav"), sampleRate = 22050;
  const samples = new Float32Array(sampleRate * 3);
  for (let n = 0; n < 6; n++) for (let i = 0; i < 150; i++) samples[Math.round(n * sampleRate / 2) + i] = Math.sin(i * 0.7) * (1 - i / 150);
  const beats = detectBeats(samples);
  assert.equal(beats.length, 6);
  beats.forEach((b, n) => assert.ok(Math.abs(b - n * 0.5) < 0.015, `${b} vs ${n * 0.5}`));
  assert.deepEqual(detectBeats(new Float32Array(1000)), []);
  assert.throws(() => detectBeats(samples, { sampleRate: 0 }), /sampleRate/);
  const raw = path.join(folder, "click.f32");
  fs.writeFileSync(raw, Buffer.from(samples.buffer));
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "f32le", "-ar", String(sampleRate), "-ac", "1", "-i", raw, file], { capture: true });
  const indexDir = path.join(folder, "work/index"), cached = await speakerBeats(file, { indexDir });
  assert.equal(cached.length, 6);
  assert.deepEqual(await speakerBeats(file, { indexDir, runImpl: () => { throw new Error("cache missed"); } }), cached);
  fs.appendFileSync(file, Buffer.from([0, 0]));
  let calls = 0;
  await speakerBeats(file, { indexDir, runImpl: (...args) => { calls++; return run(...args); } });
  assert.equal(calls, 1, "full-content hash invalidates changed bytes");
});

test("snapping stays within four frames, preserves protected speech and minimum cutaway length", () => {
  assert.equal(snapFrame(31, [1, 1.5]), 30);
  assert.equal(snapFrame(34, [1]), 30);
  assert.equal(snapFrame(35, [1]), 35);
  assert.equal(snapFrame(31, []), 31);
  const p = plan(); p.music.sections[0].snap = "beats";
  p.cutaways = [{ id: "x", over: "a", sourceId: "shot", offset: 1.1, in: 0, out: 1 }];
  const before = structuredClone(p), grids = [{ section: p.music.sections[0], beats: [1, 2] }];
  const snapped = snapSpeakerPlan(p, grids);
  assert.deepEqual(p, before); assert.equal(snapped.cutaways[0].offset, 1);
  assert.ok(snapped.cutaways[0].out - snapped.cutaways[0].in >= 0.8);
  const handles = structuredClone(p);
  handles.cutaways[0] = { id: "x", over: "a", sourceId: "shot", offset: 1.1, in: 0, out: 1.8 };
  const extended = snapSpeakerPlan(handles, [{ section: handles.music.sections[0], beats: [1, 3] }], { index });
  assert.equal(extended.cutaways[0].offset, 1); assert.equal(extended.cutaways[0].out, 2);
  const limited = snapSpeakerPlan(handles, [{ section: handles.music.sections[0], beats: [1, 3] }], { index: { sources: { shot: { duration: 1.8 } } } });
  assert.ok(limited.cutaways[0].out <= 1.8);
  p.items[0].protect = true;
  assert.equal(snapSpeakerPlan(p, grids).cutaways[0].offset, 1.1);
  p.items[0].protect = false; p.cutaways[0].out = 0.76;
  assert.equal(snapSpeakerPlan(p, grids).cutaways[0].offset, 1.1);
  p.cutaways = [];
  p.items[0] = item("a", 0, 4.1, { audio: "mute", role: "montage" });
  p.items[1] = item("b", 4.1, 8, { audio: "mute", role: "montage", snap: true });
  const section = { from: "a", to: "b", snap: "beats" };
  const moved = snapSpeakerPlan(p, [{ section, beats: [4] }]);
  assert.equal(moved.items[0].out, 4); assert.equal(moved.items[1].in, 4);
  assert.equal(moved.items[0].out - moved.items[0].in + moved.items[1].out - moved.items[1].in, 8);
  p.items[1].audio = "source";
  assert.equal(snapSpeakerPlan(p, [{ section, beats: [4] }]).items[1].in, 4.1);
});

test("montage uses real picture-only shot ranges back to back, combining sub-0.8-second beats", () => {
  const m = { id: "montage", over: "a", offset: 0, duration: 4, every: 1, shots: Array.from({ length: 4 }, () => ({ sourceId: "shot", in: 10, out: 12, fit: "contain" })) };
  const beats = Array.from({ length: 9 }, (_, n) => n * 0.5);
  const cuts = layoutMontage(m, item("a", 0, 4), beats);
  assert.deepEqual(cuts.map((c) => c.offset), [0, 1, 2, 3]);
  assert.ok(cuts.every((c) => c.in === 10 && c.out === 11));
  assert.equal(layoutMontage({ ...m, every: 2 }, item("a", 0, 4), beats).length, 4);
  assert.throws(() => layoutMontage(m, item("a", 0, 4, { protect: true }), beats), /protected/);
  assert.throws(() => layoutMontage({ ...m, shots: [] }, item("a", 0, 4), beats), /shots/);
  assert.throws(() => layoutMontage({ ...m, duration: 5 }, item("a", 0, 4), beats), /span/);
  assert.throws(() => layoutMontage({ ...m, every: 3 }, item("a", 0, 4), beats), /every/);
  assert.throws(() => layoutMontage({ ...m, shots: m.shots.map((s) => ({ ...s, out: 10.9 })) }, item("a", 0, 4), beats), /too short/);
  const p = plan(); p.music.sections[0].snap = "beats"; p.montage = [m];
  assert.deepEqual(motionProblems(p, manifest), []);
  assert.equal(validatePlan(p, { manifest, index }).length, 0);
  p.montage[0].shots[0].sourceId = "talk";
  assert.ok(motionProblems(p, manifest).some((x) => /picture|broll/.test(x.message)));
});

function keywordPlan() {
  const p = plan(); p.items[0] = item("a", 0, 40); p.duration = 48;
  p.items[1] = item("b", 40, 44); p.items[2] = item("c", 44, 48, { protect: true, role: "core" });
  p.overlays = [{ id: "k", at: "a", offset: 1, duration: 1.5, start: 1, end: 2.5, card: { type: "keyword", text: "Decide Anyway" } }];
  return p;
}

test("keywords require ordered transcript words, matching item/source, no testimonials and 20s spacing", () => {
  const p = keywordPlan();
  assert.deepEqual(validateKeywords(p, words, manifest), []);
  assert.deepEqual(validatePlan(p, { manifest, index }), []);
  p.overlays[0].card.text = "Anyway Decide";
  assert.match(validateKeywords(p, words, manifest)[0].message, /in order/);
  p.overlays[0].card.text = "Invented";
  assert.ok(validateKeywords(p, words, manifest).length);
  p.overlays[0].card.text = "Decide Anyway";
  assert.ok(validateKeywords(p, words.map((w) => ({ ...w, itemId: "b" })), manifest).length);
  assert.ok(validateKeywords(p, words.map((w) => ({ ...w, sourceId: "other" })), manifest).length);
  p.items[0].role = "testimonial";
  assert.ok(validateKeywords(p, words, manifest).some((x) => /testimonial/.test(x.message)));
  p.items[0].role = "opening";
  const testimonialManifest = { ...manifest, sources: manifest.sources.map((s) => ({ ...s, kind: "testimonial" })) };
  assert.ok(validateKeywords(p, words, testimonialManifest).some((x) => /testimonial/.test(x.message)));
  p.overlays.push({ ...p.overlays[0], id: "k2", start: 20, offset: 20, end: 21.5 });
  assert.ok(validateKeywords(p, words, manifest).some((x) => /20 seconds/.test(x.message)));
  p.overlays[1].start = 21; p.overlays[1].offset = 21;
  assert.deepEqual(validateKeywords(p, words, manifest), []);
  p.overlays[0].duration = 1;
  assert.ok(validateKeywords(p, words, manifest).some((x) => /duration/.test(x.message)));
});

test("keyword renderer uses only client tokens, escapes copy and builds absolute six-frame motion", () => {
  const resolved = resolveCard({ type: "keyword", text: "Decide Anyway", position: "lower-third", motion: "slide" }, { mode: "overlay", manifest });
  assert.deepEqual(resolved.problems, []);
  assert.equal(cardDuration(resolved.card), 2);
  assert.ok(resolveCard(resolved.card, { manifest }).problems.some((x) => x.code === "card-mode"));
  const result = keywordCard(resolved.card, { tokens, canvas, start: 1, end: 2.5 });
  assert.match(result.html, /Decide Anyway/); assert.match(result.css, /Example Display/);
  assert.match(result.timeline, /duration:0.2/); assert.match(result.timeline, /y:48/);
  assert.ok(result.layout.fits); assert.ok(result.layout.y >= 0.7 * 1080);
  const escaped = keywordCard({ text: "<safe>", position: "center", motion: "scale" }, { tokens, start: 0, end: 2 });
  assert.match(escaped.html, /&lt;safe&gt;/);
  const p = keywordPlan();
  assert.ok(speakerCardsHTML(p, { manifest, tokens, log: () => {} }).html.includes("Decide Anyway"));
});

test("transition count and core placement rules; title/booking reveal finishes by 0.6s", () => {
  const p = plan(); delete p.music;
  p.items[1].transition = "dip";
  assert.deepEqual(motionProblems(p, manifest), []);
  const dip = speakerMotionHTML(p);
  assert.match(dip.html, /var\(--brand-surface\)/); assert.match(dip.timeline, /duration:0.133333/);
  p.items[1].transition = "flash";
  assert.match(speakerMotionHTML(p).timeline, /autoAlpha:0.6/);
  p.items[1].transition = "whip";
  assert.match(speakerMotionHTML(p).timeline, /blur\(18px\)/);
  p.items[2].transition = "dip";
  assert.ok(motionProblems(p, manifest).some((x) => /protected|core/.test(x.message)));
  p.items = Array.from({ length: 6 }, (_, n) => item(`i${n}`, n * 2, n * 2 + 2, { transition: n ? "dip" : "cut" }));
  assert.ok(motionProblems(p, manifest).some((x) => /four/.test(x.message)));
  p.items = [{ ...item("title", 0, 4), kind: "card", card: { type: "title" } }, { ...item("booking", 4, 11), kind: "card", card: { type: "booking" } }];
  const motion = speakerMotionHTML(p), calls = [], tl = { fromTo: (...a) => calls.push(a) };
  vm.runInNewContext(motion.timeline, { tl });
  assert.deepEqual(calls.map((c) => [c[2].duration, c[3]]), [[0.6, 0], [0.6, 4]]);
  const html = speakerHTML(p, { manifest, cards: { css: "", html: "", timeline: "" } });
  assert.match(html, /clipPath/); assert.ok(!html.includes("undefined"));
  // The finished mask extends past the line box top and bottom, so descenders are never clipped.
  assert.match(html, /clipPath:"inset\(-0\.35em -0\.1em -0\.45em 0\)"/);
});

test("SFX entry timing, full-span protection and licence validation", () => {
  const p = plan(); p.items[1].transition = "dip";
  p.sfx = [{ id: "whoosh", at: "b", file: "hit.wav", gainDb: -18, start: 0.1, duration: 0.5 }];
  assert.deepEqual(motionProblems(p, manifest), []);
  const cues = speakerSfxCues(p);
  assert.equal(cues[0].outputStart, 4); assert.equal(cues[0].duration, 0.5);
  assert.equal(cues[0].points[0].v, 10 ** (-18 / 20));
  p.sfx[0].duration = 5;
  assert.throws(() => speakerSfxCues(p), /protected/);
  p.sfx[0].at = "a";
  assert.ok(motionProblems(p, manifest).some((x) => /transition/.test(x.message)));
  p.sfx[0].at = "c";
  assert.ok(motionProblems(p, manifest).some((x) => /protected/.test(x.message)));
});

test("speech/music QC warns only below 8 LU; missing stem measurements do not invent results", () => {
  assert.deepEqual(speechBedWarnings([{ start: 1, end: 3, speechLUFS: -16, bedLUFS: -24 }]), []);
  assert.match(speechBedWarnings([{ start: 1, end: 3, speechLUFS: -16, bedLUFS: -20 }])[0].message, /4.0 LU/);
  assert.deepEqual(speechBedWarnings([{ start: 1, end: 3, speechLUFS: null, bedLUFS: -20 }]), []);
});

test("real cue preparation honors offsets and delayed starts; matching automated stems surface masking", async (t) => {
  const folder = temp(t), work = path.join(folder, "work/full"); fs.mkdirSync(work, { recursive: true });
  // Two tones make seeking observable: offset 0.6 must start in the 880 Hz half.
  const pcm = Buffer.alloc(48000 * 2 * 2);
  for (let n = 0; n < 48000 * 2; n++) pcm.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * (n < 24000 ? 220 : 880) * n / 48000)), n * 2);
  const raw = path.join(folder, "tone.s16"); fs.writeFileSync(raw, pcm);
  for (const name of ["a.wav", "b.wav", "hit.wav"]) await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "s16le", "-ar", "48000", "-ac", "1", "-i", raw, path.join(folder, name)], { capture: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=16x16:r=30:d=2.8", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2.8", "-c:v", "libx264", "-c:a", "aac", "-shortest", path.join(work, "base.mp4")], { capture: true });
  const p = plan(); p.duration = 2.8;
  p.items = [item("a", 0, 1.4), item("b", 1.4, 2.8, { transition: "dip" })];
  p.music.sections = [{ from: "a", to: "a", track: "build", start: 0.6, gainDb: -1 }, { from: "b", to: "b", track: "drive", gainDb: -1 }];
  p.sfx = [{ id: "hit", at: "b", file: "hit.wav", gainDb: -24, duration: 0.3 }];
  writeJSON(path.join(work, "words.json"), [
    { text: "Test", sourceId: "talk", itemId: "a", start: 0.2, end: 1.1 },
    { text: "Speech", sourceId: "talk", itemId: "b", start: 1.6, end: 2.6 },
  ]);
  const result = await composeSpeakerProject(work, p, { manifest, tokens, print: () => {} });
  const html = fs.readFileSync(result.html, "utf8"), composition = JSON.parse(fs.readFileSync(path.join(work, "composition.json")));
  assert.equal(composition.music.length, 3);
  // One baked stem reaches HyperFrames: no per-cue elements and no renderer-side automation.
  assert.match(html, /<audio id="speaker-bed" src="assets\/music-bed.wav"/); assert.doesNotMatch(html, /speaker-cue-|data-automation/);
  const stereo = async (asset) => { const out = path.join(folder, `${path.basename(asset)}.f32`); await run("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(result.projectDir, asset), "-ac", "2", "-ar", "48000", "-f", "f32le", out], { capture: true }); return fs.readFileSync(out); };
  const bedPCM = await stereo("assets/music-bed.wav"), cuePCM = await Promise.all(composition.music.map((c) => stereo(c.asset)));
  assert.equal(bedPCM.length / 8, 2.8 * 48000);
  for (let n = 0; n < 2.8 * 48000; n += 4801) {
    const time = n / 48000;
    const gain = (points) => { const k = points.findLastIndex((p) => p.t <= time), a = points[k], b = points[k + 1] || a; return b.t > a.t ? a.v + (b.v - a.v) * (time - a.t) / (b.t - a.t) : a.v; };
    const expected = composition.music.reduce((sum, c, i) => sum + cuePCM[i].readFloatLE(n * 8) * gain(c.points), 0);
    assert.ok(Math.abs(bedPCM.readFloatLE(n * 8) - expected) < 1e-4, `bed sample ${n}: ${bedPCM.readFloatLE(n * 8)} vs ${expected}`);
  }
  assert.ok(result.warnings.some((w) => w.id === "music-masking"), JSON.stringify(result.warnings));
  const qc = JSON.parse(fs.readFileSync(path.join(work, "music-qc.json")));
  assert.equal(qc.windows.length, 2); assert.ok(qc.windows.every((w) => Number.isFinite(w.speechLUFS) && Number.isFinite(w.bedLUFS)));
  const firstPCM = path.join(folder, "first.f32"), secondPCM = path.join(folder, "second.f32");
  for (const [n, output] of [[0, firstPCM], [1, secondPCM]]) await run("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(result.projectDir, `assets/music-${n}.wav`), "-ac", "1", "-ar", "48000", "-f", "f32le", output], { capture: true });
  const a = fs.readFileSync(firstPCM), b = fs.readFileSync(secondPCM);
  let crossings = 0;
  for (let n = 1; n < 4800; n++) if (a.readFloatLE(n * 4) >= 0 && a.readFloatLE((n - 1) * 4) < 0) crossings++;
  assert.ok(crossings >= 85 && crossings <= 90, `seeked tone should be 880Hz, got ${crossings} cycles/0.1s`);
  let beforeStart = 0, firstAudible = -1;
  for (let n = 0; n < Math.round(1.4 * 48000); n++) { const value = Math.abs(b.readFloatLE(n * 4)); beforeStart = Math.max(beforeStart, value); if (value > 0.0001 && firstAudible < 0) firstAudible = n; }
  assert.ok(beforeStart < 0.0001, `incoming bed must be silent until its output start; peak ${beforeStart}, first sample ${firstAudible} (${firstAudible / 48000}s)`);
  assert.equal(a.length / 4, 2.8 * 48000);
});

test("composition materializes snapped montages through the existing compiler and preserves resolved review timings", async (t) => {
  const folder = temp(t), work = path.join(folder, "work/full"); fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "base.mp4"), "fixture"); fs.writeFileSync(path.join(folder, "a.wav"), "licensed"); fs.writeFileSync(path.join(folder, "b.wav"), "licensed");
  writeJSON(path.join(work, "words.json"), []); writeJSON(path.join(folder, "work/index/sources.json"), index);
  const p = plan(); p.music.sections[0].snap = "beats"; p.music.sections[0].start = 0.5;
  p.montage = [{ id: "m", over: "a", offset: 0, duration: 4, every: 2, shots: Array.from({ length: 4 }, () => ({ sourceId: "shot", in: 0, out: 2 })) }];
  let called = 0;
  const result = await composeSpeakerProject(work, p, { manifest, tokens, print: () => {}, probeAudio: async () => ({ hasAudio: true, duration: 100 }), beatsImpl: async () => Array.from({ length: 12 }, (_, n) => n * 0.5), compileImpl: async (folder, adjusted, options) => {
    called++; assert.equal(adjusted.cutaways.length, 4);
    assert.ok(adjusted.cutaways.every((x) => x.out - x.in >= 0.8));
    return { resolvedPlan: resolvePlan(adjusted, options) };
  }, prepareMusic: async (_, args) => { fs.writeFileSync(args.at(-1), "prepared"); } });
  assert.equal(called, 1); assert.equal(p.cutaways.length, 4);
  assert.equal(p.cutaways[1].startFrame, p.cutaways[0].endFrame);
  assert.equal(p.cutaways.at(-1).endFrame, 120);
  assert.ok(result.projectDir);
});

test("optional beat analysis fails open once; invalid keyword copy still refuses composition", async (t) => {
  const folder = temp(t), work = path.join(folder, "work/full"); fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "base.mp4"), "fixture"); fs.writeFileSync(path.join(folder, "a.wav"), "licensed"); fs.writeFileSync(path.join(folder, "b.wav"), "licensed");
  const p = plan(); p.music.sections[0].snap = "beats";
  writeJSON(path.join(work, "words.json"), []);
  const result = await composeSpeakerProject(work, p, { manifest, tokens, print: () => {}, probeAudio: async () => ({ hasAudio: true, duration: 100 }), beatsImpl: async () => { throw new Error("unavailable"); }, prepareMusic: async (_, args) => fs.writeFileSync(args.at(-1), "prepared") });
  assert.equal(result.warnings.filter((w) => /beats/.test(w.message)).length, 1);
  p.overlays = [{ id: "k", at: "a", offset: 0, start: 0, end: 2, duration: 2, card: { type: "keyword", text: "Invented" } }];
  await assert.rejects(() => composeSpeakerProject(work, p, { manifest, tokens, print: () => {}, beatsImpl: async () => [] }), /k:.*output transcript/);
});

test("source beat offsets repeat across looped tracks and stay within section bounds", () => {
  assert.deepEqual(sectionBeatTimes([0, 0.5, 1, 1.5], { sourceStart: 1, outputStart: 3, outputEnd: 6, trackDuration: 2 }), [3, 3.5, 4, 4.5, 5, 5.5, 6]);
  assert.throws(() => sectionBeatTimes([0], { sourceStart: 2, outputStart: 0, outputEnd: 4, trackDuration: 2 }), /offset/);
});
