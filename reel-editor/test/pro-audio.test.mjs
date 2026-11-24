import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { musicHistoryPath, readMusicHistory, recordProMusic, pickProTrack, proMoodChoice, proSpeechRegions, proDuckDbAt, proMusicGain, proDuckingLane, limitProSfx, proLoudnessFilter, normalizeProDelivery, measureProLoudness } from "../src/pro-audio.mjs";
import { prepareAudio, runEdit, renderHookVariants } from "../src/pipeline.mjs";
import { norm } from "../src/text.mjs";
import { PKG_ROOT } from "../src/util.mjs";
import { loadPreset } from "../src/presets.mjs";

const scratch = (t) => { const dir = fs.mkdtempSync(path.join(PKG_ROOT, ".pro-audio-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const library = Array.from({ length: 6 }, (_, i) => ({ name: `track-${i}`, file: `/music/track-${i}.wav`, mood: i < 4 ? "Lofi" : "Dark Beat", signature: i === 0 }));
const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≠ ${expected}`);

test("pro music history picker enforces mood, last three, and two uses in every seven completed reels", () => {
  const history = [];
  for (let i = 0; i < 30; i++) {
    const picked = pickProTrack(library, { history, moods: ["Lofi"], reel: `reel-${i}`, seed: `reel-${i}` });
    assert.equal(picked.mood, "Lofi");
    assert.ok(!history.slice(-3).some((h) => h.track === picked.name));
    history.push({ reel: `reel-${i}`, track: picked.name });
    assert.ok(history.slice(-7).filter((h) => h.track === picked.name).length <= 2);
  }
  assert.equal(pickProTrack(library, { moods: ["missing"] }), null);
  assert.equal(pickProTrack([], {}), null);
  const blocked = library.slice(0, 3).map((t, i) => ({ reel: String(i), track: t.name }));
  assert.equal(pickProTrack(library.slice(0, 3), { history: blocked }), null);
  assert.equal(pickProTrack(library, { history: blocked, want: "track-0" }), null, "manual choice cannot bypass rotation");
  // A track named by a person skips the mood filter (rotation still applies).
  assert.equal(pickProTrack(library, { want: "track-0", moods: ["Dark Beat"] })?.name, library.find((t) => t.name.includes("track-0")).name, "manual choice skips mood");
  assert.equal(pickProTrack(library, { history: blocked, reel: "0", want: "track-0" }).name, "track-0", "same reel can rebuild");
});

test("pro track picks are deterministic and Signature receives no extra weighting", () => {
  const counts = new Map(library.map((t) => [t.name, 0]));
  for (let i = 0; i < 3000; i++) {
    const pick = pickProTrack(library, { seed: `sample-${i}` });
    counts.set(pick.name, counts.get(pick.name) + 1);
  }
  assert.ok(counts.get("track-0") < 650, JSON.stringify([...counts]));
  assert.equal(pickProTrack(library, { seed: "stable" }).name, pickProTrack(library, { seed: "stable" }).name);
  assert.deepEqual(pickProTrack(library), pickProTrack(library));
});

test("pro history uses the environment override, persists atomically and does not double-count a rebuild", (t) => {
  const dir = scratch(t), file = path.join(dir, "history.json");
  assert.equal(musicHistoryPath({ REEL_MUSIC_HISTORY: file }), file);
  assert.ok(musicHistoryPath({}).endsWith(path.join("Reels", ".music-history.json")));
  assert.deepEqual(readMusicHistory(file), []);
  recordProMusic({ reel: "one", track: "A", at: "date" }, file);
  recordProMusic({ reel: "two", track: "B", at: "date" }, file);
  recordProMusic({ reel: "one", track: "C", at: "date" }, file);
  assert.deepEqual(readMusicHistory(file), [{ reel: "one", track: "C", at: "date" }, { reel: "two", track: "B", at: "date" }]);
  recordProMusic({ reel: "one", track: "C", at: "later date" }, file);
  assert.equal(readMusicHistory(file).length, 2);
  assert.equal(pickProTrack(library, { reel: "one", history: [{ reel: "one", track: "track-0" }, { reel: "two", track: "track-1" }], moods: ["Lofi"] }).name, "track-0");
  assert.throws(() => recordProMusic({ reel: "three", track: "C" }, file), /history changed/);
  assert.equal(readMusicHistory(file).length, 2);
  assert.deepEqual(fs.readdirSync(dir), ["history.json"]);
  fs.writeFileSync(file, "{broken");
  assert.throws(() => readMusicHistory(file));
  fs.writeFileSync(file, '[{"track":"A"}]');
  assert.throws(() => readMusicHistory(file), /invalid pro music history/);
});

test("local pro mood fallback distinguishes correction, encouragement, procedures and vocal demos", () => {
  const moods = ["Dark Beat", "Warm Motivation", "Lofi", "Boom Bap"];
  assert.deepEqual(proMoodChoice("Stop making that mistake", moods).moods, ["Dark Beat"]);
  assert.deepEqual(proMoodChoice("You can do better", moods).moods, ["Warm Motivation"]);
  assert.ok(proMoodChoice("First write it then record it", moods).moods.includes("Boom Bap"));
  assert.deepEqual(proMoodChoice("A calm explanation", moods).moods, ["Warm Motivation", "Lofi"]);
  assert.equal(proMoodChoice("Listen to how my tonality changes", moods).none, true);
  assert.equal(proMoodChoice("An explanation", ["Rock"]).none, true);
});

test("pro speech regions merge gaps through 650 ms and include audible untranscribed speech", () => {
  const input = [{ start: 2, end: 3 }, { start: 0, end: 1 }, { start: 1.65, end: 1.7 }];
  const before = structuredClone(input);
  assert.deepEqual(proSpeechRegions(input, { duration: 5 }), [{ start: 0, end: 3 }]);
  assert.deepEqual(proSpeechRegions([{ start: 0, end: 1 }, { start: 1.651, end: 2 }], { duration: 5 }), [{ start: 0, end: 1 }, { start: 1.651, end: 2 }]);
  const envelope = { step: 0.1, db: Array(50).fill(-60) };
  envelope.db[40] = -20;
  const regions = proSpeechRegions(input, { duration: 5, envelope });
  assert.equal(regions.at(-1).start, 4);
  close(regions.at(-1).end, 4.1);
  assert.deepEqual(input, before);
  assert.deepEqual(proSpeechRegions([{ start: -1, end: 0.2 }, { start: 5, end: 6 }], { duration: 4 }), [{ start: 0, end: 0.2 }]);
});

test("pro duck envelope uses 120 ms pre-roll, 100 ms smoothstep dB attack, 250 ms hold, 450 ms release", () => {
  const regions = [{ start: 1, end: 2 }];
  close(proDuckDbAt(0.88, regions), 0);
  close(proDuckDbAt(0.93, regions), -3);
  close(proDuckDbAt(0.98, regions), -6);
  close(proDuckDbAt(1.5, regions), -6);
  close(proDuckDbAt(2.25, regions), -6);
  close(proDuckDbAt(2.475, regions), -3);
  close(proDuckDbAt(2.7, regions), 0);
  close(proDuckDbAt(5, regions), 0);
  assert.equal(proDuckDbAt(1, []), 0);
  assert.equal(proDuckDbAt(2.3, [...regions, { start: 2.75, end: 3 }]), -6, "cancel a rise when the next pre-roll overlaps release");
});

test("pro gain and lane calibrate music 18 LU beneath speech with a 240 ms tail fade", () => {
  close(20 * Math.log10(proMusicGain()), -8);
  close(20 * Math.log10(proMusicGain(-20)), -12);
  assert.equal(proMusicGain(NaN), proMusicGain());
  const words = [{ start: 1, end: 2 }, { start: 4, end: 5 }];
  const lane = proDuckingLane(words, { duration: 5 });
  assert.deepEqual(lane[0], { t: 0, v: 0 });
  assert.deepEqual(lane.at(-1), { t: 5, v: 0 });
  const at = (t) => {
    const index = lane.findIndex((point) => point.t >= t);
    const a = lane[Math.max(0, index - 1)], b = lane[index];
    return b.t === a.t ? a.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
  };
  close(20 * Math.log10(at(1)), -14);
  close(20 * Math.log10(at(3)), -8);
  close(20 * Math.log10(at(4.76)), -14);
  assert.ok(at(4.88) > 0 && at(4.88) < at(4.76));
  for (let i = 1; i < lane.length; i++) assert.ok(lane[i].t > lane[i - 1].t);
  assert.deepEqual(proDuckingLane([], { duration: 0 }), []);
});

test("all pro SFX share the budget, 1.5 second spacing and calibrated type-specific peaks", () => {
  const music = { id: "music", src: "music", volume: 1 };
  const effects = ["whoosh", "tick", "pop", "icon", "marker", "move"].map((kind, i) => ({ id: `sfx-${kind}-${i}`, src: `${kind}.wav`, start: i * 2, duration: 0.2, volume: 1 }));
  const peaks = Object.fromEntries(effects.map((t) => [t.src, -6]));
  const tracks = limitProSfx([music, ...effects], 30, peaks);
  assert.equal(tracks[0], music);
  assert.equal(tracks.length, 4);
  assert.deepEqual(tracks.slice(1).map((t) => t.peakTargetDb), [-23, -27, -25]);
  tracks.slice(1).forEach((track) => close(20 * Math.log10(track.volume) - 6, track.peakTargetDb));
  const crowded = effects.map((t, i) => ({ ...t, start: i * 0.4 }));
  const sparse = limitProSfx(crowded, 30, peaks);
  for (let i = 1; i < sparse.length; i++) assert.ok(sparse[i].start - sparse[i - 1].start >= 1.5);
  assert.ok(limitProSfx(effects, 100, peaks).length <= 5);
  assert.deepEqual(limitProSfx(effects, 30), [], "unmeasured effects are not guessed");
});

test("pro loudness filter preserves measured two-pass values and does not enable limiter auto-gain", () => {
  const measured = { input_i: "-20", input_tp: "-6", input_lra: "3", input_thresh: "-30", target_offset: "0.2" };
  const filter = proLoudnessFilter(measured);
  assert.match(filter, /I=-16:TP=-2/);
  assert.match(filter, /measured_I=-20/);
  assert.match(filter, /linear=true/);
  assert.match(filter, /level=disabled/);
  assert.throws(() => proLoudnessFilter({ ...measured, input_i: "-inf" }), /invalid input_i/);
});

test("pro master retries AAC overshoot and rejects out-of-target encodes without replacing the input", async (t) => {
  const dir = scratch(t), file = path.join(dir, "master.mp4");
  fs.writeFileSync(file, "original");
  const values = { input_i: "-20", input_tp: "-5", input_lra: "3", input_thresh: "-30", target_offset: "0" };
  let calls = 0;
  const runImpl = async (_, args) => { calls++; fs.writeFileSync(args.at(-1), `encoded-${calls}`); return {}; };
  let meters = 0;
  await normalizeProDelivery(file, { runImpl, measure: async () => ++meters === 1 ? values : { ...values, input_i: "-16", input_tp: meters === 2 ? "-1" : "-1.8" } });
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(file, "utf8"), "encoded-2");
  fs.writeFileSync(file, "original");
  await assert.rejects(normalizeProDelivery(file, { runImpl, measure: async () => values }), /outside target/);
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(dir), ["master.mp4"]);
});

let ffmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ffmpeg = false; }
test("pro audio integration: normalized bed, real SFX peaks, and final encoded -16 LUFS / -1.5 dBTP master", { skip: !ffmpeg }, async (t) => {
  const dir = scratch(t), voice = path.join(dir, "voice.mp4"), music = path.join(dir, "music.wav");
  const ff = (args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "pipe" });
  ff(["-f", "lavfi", "-i", "color=black:s=64x64:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=450:duration=4:sample_rate=48000", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", voice]);
  ff(["-f", "lavfi", "-i", "sine=frequency=110:duration=4:sample_rate=48000", music]);
  const old = process.env.REEL_MUSIC_HISTORY;
  process.env.REEL_MUSIC_HISTORY = path.join(dir, "history.json");
  t.after(() => { if (old === undefined) delete process.env.REEL_MUSIC_HISTORY; else process.env.REEL_MUSIC_HISTORY = old; });
  const preset = loadPreset("clean");
  preset.audio = { ...preset.audio, pro: true, music, sounds: true, sfx: false };
  const audio = await prepareAudio({ workDir: dir, projectDir: path.join(dir, "project"), preset, opts: {}, duration: 4, hook: null, zooms: [], voiceFile: voice, words: [{ start: 0, end: 4 }], cues: { graphics: [{ type: "headline", start: 1, duration: 1 }] } });
  assert.equal(audio.musicPick.track, "music.wav");
  assert.equal(audio.tracks.find((t) => t.id === "music").start, 0);
  assert.equal(audio.tracks.find((t) => t.id === "music").fadeOut, 0.24);
  assert.ok(audio.tracks.find((t) => t.id.startsWith("sfx-")).volume < 0.2);
  assert.equal(fs.existsSync(process.env.REEL_MUSIC_HISTORY), false, "planning does not record a completed reel");
  const bed = audio.tracks.find((t) => t.id === "music");
  const bedFile = path.join(dir, "project", "assets", "music.m4a");
  const bedMeter = await measureProLoudness(bedFile);
  assert.ok(Math.abs(Number(bedMeter.input_i) + 20) < 0.5);
  const mix = path.join(dir, "mixed.mp4");
  ff(["-i", voice, "-i", bedFile, "-filter_complex", `[1:a]volume=${bed.volume * 10 ** (-6 / 20)},afade=t=in:st=0:d=0.03,afade=t=out:st=3.76:d=0.24[bed];[0:a][bed]amix=inputs=2:normalize=0[a]`, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", mix]);
  const result = await normalizeProDelivery(mix);
  assert.ok(Math.abs(Number(result.input_i) + 16) <= 1);
  assert.ok(Number(result.input_tp) <= -1.5);
  const measured = await measureProLoudness(mix);
  assert.ok(Math.abs(Number(measured.input_i) + 16) <= 1);
  assert.ok(Number(measured.input_tp) <= -1.5);
});

test("pro pipeline writes a complete project without browser, models, or a new preset file", { skip: !ffmpeg }, async (t) => {
  const dir = scratch(t), footage = path.join(dir, "source.mp4"), transcript = path.join(dir, "transcript.json"), presetFile = path.join(dir, "options.json");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=white:s=108x192:r=30:d=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", footage]);
  const words = "When you talk fast, you lose your tonality. Practice the opener slowly until the words are natural.".split(" ").map((text, i) => ({ text, start: i * 0.27, end: i * 0.27 + 0.25 }));
  fs.writeFileSync(transcript, JSON.stringify({ words }));
  fs.writeFileSync(presetFile, JSON.stringify({
    extends: "pingel-brand", name: "pro-test", canvas: "portrait",
    captions: { pro: true }, hook: { pro: true, duration: 2.4 }, zooms: { pro: true },
    framing: { enabled: false }, graphics: { enabled: false }, broll: { enabled: false }, slams: { enabled: false }, icons: { enabled: false }, evidence: { enabled: false }, finish: { enabled: false }, signature: { enabled: false },
    motion: { impact: { enabled: false }, drift: { enabled: false } },
    audio: { pro: true, music: null, musicDir: null, sounds: false, sfx: false, cleanAudio: false },
    premise: { mode: "off" }, timeLabels: { enabled: false },
  }));
  const old = process.env.REEL_MUSIC_HISTORY;
  process.env.REEL_MUSIC_HISTORY = path.join(dir, "history.json");
  t.after(() => { if (old === undefined) delete process.env.REEL_MUSIC_HISTORY; else process.env.REEL_MUSIC_HISTORY = old; });
  const result = await runEdit(footage, { out: path.join(dir, "project-output"), preset: presetFile, transcript, noRender: true, noCuts: true }, { detectFaces: async (_, times) => ({ frames: times.map((t) => ({ t, faces: [{ x: 0.3, y: 0.5, w: 0.3, h: 0.18 }] })) }) });
  const { plan } = result;
  assert.equal(plan.hook.start, 0);
  assert.equal(plan.hook.duration, 2.4);
  assert.ok(plan.captions.every((g) => g.y + g.lines.length * 92 + 24 <= 1720 && g.lines.length <= 2 && g.words.length <= 6));
  assert.ok(plan.captions.some((g) => g.y !== 1248), "chin measurement reaches the saved pro anchor (11-24: a low face moves captions below the chin, never onto it)");
  const captioned = new Set(plan.captions.flatMap((g) => g.words.map((w) => w.start)));
  const titled = new Set(plan.hook.words.map((w) => norm(w.text)));
  for (const word of plan.words) assert.ok(captioned.has(word.start) || (word.start < plan.hook.duration && titled.has(norm(word.text))), `uncovered word: ${word.text}`);
  assert.match(fs.readFileSync(path.join(result.workDir, "project", "index.html"), "utf8"), /class="cap cap-pro"/);
  assert.equal(fs.existsSync(process.env.REEL_MUSIC_HISTORY), false);
  let rendered = false, normalized = false;
  // Exercise the variant composition with a render stub; no browser is launched by this test.
  const saved = JSON.parse(fs.readFileSync(path.join(result.workDir, "plan.json"), "utf8"));
  saved.video.hasAudio = true;
  fs.writeFileSync(path.join(result.workDir, "plan.json"), JSON.stringify(saved));
  await renderHookVariants(result.workDir, ["Practice the opener"], { seconds: 4 }, {
    render: async (project) => {
      rendered = true;
      const html = fs.readFileSync(path.join(project, "index.html"), "utf8");
      assert.match(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), /Practice the opener/);
      assert.match(html, /When/);
      assert.match(html, /class="hook-pro"|class="clip hook-pro"/);
      const runtime = JSON.parse(html.match(/const PLAN = (.+);/)[1]);
      assert.ok(runtime.zooms.every((z) => z.t + z.snap <= 2));
      assert.equal(runtime.hook.style, "pro");
    },
    normalizeProDelivery: async () => { normalized = true; },
  });
  assert.equal(rendered, true);
  assert.equal(normalized, true);
});
