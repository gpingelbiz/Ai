import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { eventClock, measureSfx, measureSfxFile, SFX_ONSETS, legacyLanding, glowLanding } from "../src/event-clock.mjs";
import { soundCues } from "../src/sounds.mjs";
import { glowSoundCues } from "../src/glow-sound.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { allowedFile } from "../scripts/release.mjs";
import { PKG_ROOT } from "../src/util.mjs";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

function wav(samples, channels = 1) {
  const fmt = Buffer.alloc(24);
  fmt.write("fmt "); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(channels, 10); fmt.writeUInt32LE(48000, 12);
  fmt.writeUInt32LE(48000 * channels * 2, 16); fmt.writeUInt16LE(channels * 2, 20); fmt.writeUInt16LE(16, 22);
  const data = Buffer.alloc(8 + samples.length * 2);
  data.write("data"); data.writeUInt32LE(samples.length * 2, 4);
  samples.forEach((n, i) => data.writeInt16LE(n, 8 + i * 2));
  const junk = Buffer.from([74, 85, 78, 75, 1, 0, 0, 0, 42, 0]); // Odd chunk padded to an even byte.
  const header = Buffer.alloc(12);
  header.write("RIFF"); header.writeUInt32LE(4 + fmt.length + junk.length + data.length, 4); header.write("WAVE", 8);
  return Buffer.concat([header, fmt, junk, data]);
}

test("SFX measurements: attack, first equal peak, stereo frame indexes and padded WAV chunks", () => {
  const m = measureSfx(wav([0, 0, 49, -100, 0, -1000, 1000, 0], 2));
  assert.equal(m.channels, 2); assert.equal(m.samples, 4); assert.equal(m.sampleRate, 48000);
  assert.equal(m.attackSample, 1); assert.equal(m.peakSample, 2);
  near(m.attack, 1 / 48000); near(m.peak, 2 / 48000);
  const opposite = measureSfx(wav([0, 0, -32768, 32767], 2));
  assert.equal(opposite.peakSample, 1, "opposite channels cannot cancel the transient");
});

test("SFX measurements reject missing, truncated, silent and unsupported WAV data", () => {
  assert.throws(() => measureSfx(Buffer.from("not a wav")), /RIFF/);
  assert.throws(() => measureSfx(wav([100]).subarray(0, -1)), /Truncated/);
  assert.throws(() => measureSfx(wav([0, 0])), /Silent/);
  const unsupported = wav([100]); unsupported.writeUInt16LE(32, 34);
  assert.throws(() => measureSfx(unsupported), /16-bit/);
  const missing = wav([100]).subarray(0, 12);
  assert.throws(() => measureSfx(missing), /fmt and data/);
  assert.throws(() => measureSfx(wav([])), /nonempty/);
  assert.throws(() => measureSfx(wav([100], 2)), /16-bit/);
});

test("SFX table matches every WAV byte and both remeasured transients, including all variants", () => {
  const dir = path.join(PKG_ROOT, "assets/sfx");
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".wav")).sort();
  assert.deepEqual(Object.keys(SFX_ONSETS).sort(), files, "a new WAV needs a measured entry");
  for (const file of files) assert.deepEqual(measureSfx(fs.readFileSync(path.join(dir, file))), SFX_ONSETS[file], `${file}: regenerate onsets.json`);
  near(SFX_ONSETS["slam.wav"].peak, 0.026020833333333333);
});

test("generated effects use the same clock with an injected PCM decoder and pipe WAV lengths", () => {
  const bytes = wav([0, 0, 0, 1000]);
  bytes.writeUInt32LE(0xffffffff, 50); // data chunk size, after the padded JUNK chunk.
  const calls = [];
  const measured = measureSfxFile("fake.mp3", { decode: (file) => { calls.push(file); return bytes; } });
  assert.deepEqual(calls, ["fake.mp3"]);
  assert.equal(measured.peakSample, 3);
  const clock = eventClock({ landAt: 1.234, sfx: measured });
  assert.equal(clock.landFrame, 37);
  assert.equal(clock.startFrame, 37);
  assert.deepEqual(measureSfxFile(path.join(PKG_ROOT, "assets/sfx/slam.wav")), SFX_ONSETS["slam.wav"]);
});

test("event clock aligns every asset and variant to frames at multiple plan frame rates", () => {
  for (const fps of [24, 25, 30, 60, 30000 / 1001]) for (const sfx of Object.keys(SFX_ONSETS)) {
    for (const landAt of [0, 0.01, 1.23456, 20.42]) for (const anchor of ["attack", "peak"]) {
      const clock = eventClock({ landAt, sfx: `assets/sfx/${sfx}`, fps, anchor });
      assert.equal(clock.start, clock.startFrame / fps);
      assert.equal(clock.landAt, clock.landFrame / fps);
      assert.ok(clock.start >= 0);
      if (!clock.clipped) {
        assert.ok(Math.abs(clock.transientAt - clock.landAt) <= 0.5 / fps + 1e-9);
        assert.ok(Math.abs(clock.transientAt - landAt) <= 1 / fps + 1e-9);
      }
    }
  }
  assert.equal(eventClock({ landAt: 0, sfx: "typing.wav", anchor: "attack" }).clipped, false);
  assert.equal(eventClock({ landAt: 0, sfx: "move.wav" }).clipped, true);
  for (const args of [{ landAt: NaN }, { landAt: -1 }, { landAt: 1, fps: 0 }, { landAt: 1, fps: Infinity }]) assert.throws(() => eventClock({ sfx: "slam.wav", ...args }), /clock/);
  assert.throws(() => eventClock({ landAt: 1, sfx: "unknown.wav" }), /Unknown/);
  assert.throws(() => eventClock({ landAt: 1, sfx: "slam.wav", anchor: "typo" }), /Unknown/);
});

test("legacy landing declarations follow the unchanged entrance tweens and whip blur peaks", () => {
  const at = (kind, event, opts) => legacyLanding(kind, event, opts);
  near(at("slam", { t: 1 }), 1.42);
  near(at("move", { t: 1, snap: 0.12 }), 1.12);
  near(at("move", { t: 1 }, { zoomStyle: "camera" }), 1.55);
  near(at("move", { t: 1, snap: 0.12, onKey: true }, { zoomStyle: "camera" }), 1.12);
  near(at("move", { t: 1, cut: true }, { zoomStyle: "camera" }), 1);
  near(at("icon", { t: 1 }, { fps: 60 }), 1 + 7 / 60);
  near(at("flash", { duration: 0.6 }), 0.6);
  near(at("hook", { start: 1 }), 1.39);
  near(at("hook", { start: 1, text: "Listen to the words" }, { hookStyle: "headline" }), 1.39);
  near(at("marker", { start: 1, wordStart: 1.2 }), 1.62);
  near(at("whip-in", { start: 1 }, { fps: 60 }), 1.05);
  near(at("whip-out", { start: 1, duration: 3 }), 4 - 4 / 30);
  for (const [skin, enter] of [["glass", 0.3], ["note", 0.01], ["atelier", 0.45], ["serifonlife", 0.6], ["notify", 0.55]]) near(at("card", { start: 1, skin }), 1 + enter);
  near(at("card", { start: 1 }, { graphicsMode: "band" }), 1.32);
  near(at("card", { start: 1 }, { graphicsMode: "full" }), 1.16);
  for (const type of ["list", "steps", "ladder"]) near(at("card", { start: 1, type, items: [{ at: 0 }], rungs: [{ at: 0 }] }), 1 + 8 / 30);
  near(at("card", { start: 1, type: "list", items: [{ text: "untimed" }] }), 1.3);
  near(at("card", { start: 1, mode: "proof" }), 1 + 8 / 30);
  assert.throws(() => at("typo", {}), /Unknown legacy/);
});

test("glow landing declarations cover collections, count-ups, bubbles, overlays and acting icons", () => {
  const at = (kind, event, opts) => glowLanding(kind, event, opts);
  near(at("scene", { start: 1 }), 1.22);
  near(at("number", { start: 1 }), 1.3);
  near(at("number", { start: 1, end: 4, from: "10" }), 1.9);
  near(at("number", { start: 1, end: 1.9, from: "10" }), 1.4);
  near(at("meter", { start: 1 }), 2.08);
  for (const type of ["list", "steps"]) {
    near(at("item", { type, start: 1 }, { index: 0, at: 5 }), 1.36);
    near(at("item", { type, start: 1 }, { index: 1, at: 2 }), 2.23);
    near(at("item", { type, start: 1 }, { index: 2, at: 1 }), 1.6);
  }
  near(at("item", { type: "flow", start: 1 }, { index: 0, at: 5 }), 1.2);
  near(at("item", { type: "flow", start: 1 }, { index: 1, at: 2 }), 2.2);
  near(at("item", { type: "bars", start: 1 }, { index: 0, at: 5 }), 1.65);
  near(at("item", { type: "bars", start: 1 }, { index: 1, at: 5 }), 5.65);
  near(at("branch", { start: 1 }, { at: 0 }), 1.2);
  near(at("right", { type: "bars", start: 1 }, { at: 2 }), 2.65);
  near(at("right", { type: "versus", start: 1 }, { at: 2 }), 2.2);
  near(at("right", { type: "versus", start: 1 }, { at: 1 }), 1.68);
  near(at("item", { start: 1 }, { at: 2 }), 2.32);
  near(at("bubble", {}, { at: 2 }), 2.2);
  near(at("typing", {}, { at: 2 }), 1.6);
  near(at("stamp", { start: 1 }), 1.22);
  near(at("notify", { start: 1 }), 1.28);
  near(at("swap", { start: 1 }, { at: 2 }), 2.22);
  near(at("icon", { t: 1 }), 1 + 7 / 30);
  for (const action of ["drop", "spin"]) near(at("icon", { t: 1, end: 2, action }), 1.32);
  for (const action of ["stack", "float", "hit", "ping"]) near(at("icon", { t: 1, end: 2, action }), 1.16);
  near(at("hit", { t: 1, end: 2, action: "hit" }), 1.24);
  near(at("ping", { t: 1, end: 2, action: "ping" }), 1.32);
  near(at("icon", { t: 1, end: 2, action: "drop" }, { index: 0, scenes: [{ start: 1.2, bridge: 0 }] }), 1.14);
  assert.throws(() => at("typo", {}), /Unknown glow/);
});

function fixture() {
  return {
    name: "clock", preset: "pingel-brand", style: loadPreset("pingel-brand"),
    canvas: { width: 1080, height: 1920 }, video: { duration: 15, hasAudio: true },
    words: [], captions: [], graphics: [{ type: "headline", text: "Listen", start: 3, duration: 2 }],
    slams: [{ t: 6, end: 7.2, text: "Listen" }], zooms: [{ t: 1, scale: 1.14, snap: 0.12 }], icons: [], broll: [],
  };
}

test("composed legacy cues correct the measured 114 ms error and land within one frame", () => {
  const plan = fixture();
  plan.style.zooms.style = "snap";
  const cues = soundCues({ ...plan, fps: 30, audit: true });
  const expected = [1.12, 3.3, 6.42];
  cues.forEach((cue, i) => {
    near(cue.sync.landAt, Math.round(expected[i] * 30) / 30);
    assert.ok(Math.abs(cue.start + SFX_ONSETS[path.basename(cue.src)].peak - expected[i]) < 1 / 30);
  });
  near(6.42 - (6.28 + SFX_ONSETS["slam.wav"].peak), 0.11397916666666667);
  plan.audio = { tracks: cues };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /const land = 0\.42/);
  for (const cue of cues) assert.ok(html.includes(`src="${cue.src}" data-start="${cue.start}"`));
});

test("composed glow cues align to actual scene and overlay endpoints, including variants", () => {
  const plan = fixture();
  plan.style.captions.style = "glow";
  plan.graphics = []; plan.slams = []; plan.zooms = [];
  plan.glowScenes = [{ type: "number", start: 1, end: 3, value: "10", words: [], labelWords: [] }, { type: "meter", start: 4, end: 7, value: "50", percent: 50, words: [], labelWords: [] }];
  plan.glowOverlays = [{ type: "stamp", start: 9, end: 11, text: "Listen", place: { x: 76, y: 1100, w: 700, h: 180 } }];
  const cues = glowSoundCues(plan, { audit: true });
  const expected = [1.22, 1.3, 4.22, 5.08, 9.22];
  cues.forEach((cue, i) => assert.ok(Math.abs(cue.sync.transientAt - expected[i]) <= 1 / 30, cue.id));
  plan.audio = { tracks: cues };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /duration: 0\.22, ease: "power3.out"/);
  for (const cue of cues) assert.ok(html.includes(`src="${cue.src}" data-start="${cue.start}"`));
});

test("audio-only correction leaves every existing preset's picture HTML byte identical", () => {
  // Captured from the unchanged composer and presets. Only audio data-start values are normalized.
  const baselines = {
    "_defaults.json": "bd7c6c985af1110b15a46d62d03b45e51b311af0df705370a63b51fe1a0b95f4",
    "clean.json": "99be4a953cd99f9d43b333f6e0ae52ef7bd04766251b20e20bef1d443f328b27",
    "pace-fast.json": "bdddb605d636b0d774990349b693127d77f11c7ebbe51ae355287d35b9c43dc0",
    "pingel-brand.json": "4eaead4a87da7bcde22aab93f226ba5f747f111bfb7af1c814852257cdbe87f4",
    "pingel-runway.json": "4eaead4a87da7bcde22aab93f226ba5f747f111bfb7af1c814852257cdbe87f4",
    "pingel-v2.json": "831efee6cbce9bfeeb082af7c5c41abccd80d07a0e52f8befb8f5f52e87baaa1",
    "speaker.json": "15c39838d8b35e09084ab95548d603b6f0309667b433c763aeedaed8f4d3f795",
    "vsl.json": "dcb8971978ec67a698d23f1ad8527ab91c8f1e2c232472b1fae395fed7339b4c",
    "youtube.json": "4b0a9797a4f2a72f98cb0ad0615f2ecf96cc1d74ece48ae996105c57b70320d0",
  };
  const names = fs.readdirSync(path.join(PKG_ROOT, "presets")).filter((name) => name.endsWith(".json") && !["pingel-bold.json", "broll-shotlist.json"].includes(name));
  for (const name of names) {
    const plan = fixture(); plan.preset = name.slice(0, -5); plan.style = loadPreset(plan.preset);
    const cues = soundCues({ ...plan, fps: plan.style.render.fps, zoomStyle: plan.style.zooms.style, graphicsMode: plan.style.graphics.mode });
    const old = cues.map((cue, i) => ({ ...cue, start: [0.94, 3.1, 6.28][i] }));
    const page = (tracks) => renderHTML({ ...plan, audio: { tracks } }, "assets/footage.mp4");
    const picture = (html) => html.replace(/(<audio\b[^>]*\bdata-start=")[^"]*(")/g, "$1CLOCK$2");
    assert.equal(picture(page(cues)), picture(page(old)), name);
    assert.equal(createHash("sha256").update(picture(page(cues))).digest("hex"), baselines[name], name);
  }
  assert.equal(allowedFile("presets/pingel-bold.json"), false);
  assert.equal(allowedFile("assets/sfx/onsets.json"), true);
});

test("selection, order, ducking and variant choice stay fixed even when corrected starts cross", () => {
  const cues = glowSoundCues({
    glowScenes: [{ type: "bars", start: 1, end: 4, left: { at: 1 }, right: { at: 1.5 } }],
    glowOverlays: [{ type: "stamp", start: 1.7, end: 3 }],
    icons: [{ t: 5, end: 6, action: "hit" }, { t: 8, end: 9, action: "ping" }],
  }, { audit: true });
  assert.deepEqual(cues.map((cue) => path.basename(cue.src)), ["move.wav", "card.wav", "slam.wav", "card-2.wav", "slam-2.wav", "card-3.wav", "ding.wav"]);
  assert.ok(cues[1].start > cues[2].start, "a corrected count completion cannot reorder the cue list or its variants");
  const tail = soundCues({ slams: [{ t: 9.5 }], duration: 10 });
  assert.equal(tail.length, 1, "selection keeps its former tail rule even though the corrected start is later");
  assert.deepEqual(Object.keys(tail[0]), ["id", "src", "start", "duration", "volume", "track"], "normal plans keep their schema");
});
