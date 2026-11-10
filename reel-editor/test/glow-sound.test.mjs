import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { glowSoundCues } from "../src/glow-sound.mjs";
import { restyleGlow } from "../src/glow.mjs";
import { composeProject } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { PKG_ROOT } from "../src/util.mjs";

const family = (cue) => cue.id.split("-")[1];
const times = (cues, kind) => cues.filter((c) => family(c) === kind).map((c) => c.start);

test("glow sounds: scene entrances whoosh and timed items, bars and the right side pop quietly", () => {
  const cues = glowSoundCues({ glowScenes: [
    { type: "list", start: 1, items: [{ at: 1.5 }, { at: 2 }] },
    { type: "steps", start: 4, items: [{ at: 4.5 }, { at: 5 }] },
    { type: "flow", start: 7, items: [{ at: 7.5 }, { at: 8 }] },
    { type: "bars", start: 10, bars: [{ at: 10.5 }, { at: 11 }] },
    { type: "versus", start: 13, left: { at: 13.5 }, right: { at: 14 } },
    { type: "future-scene", start: 16, items: [{ at: 17 }] },
  ] });
  assert.deepEqual(times(cues, "move"), [1, 4, 7, 10, 13, 16]);
  assert.deepEqual(times(cues, "card"), [1.5, 2, 4.5, 5, 7.5, 8, 10.5, 11, 14, 17]);
  assert.ok(cues.filter((c) => family(c) === "card").every((c) => c.volume === 0.135));
});

test("glow sounds: number and meter each pop once at their landing", () => {
  const cues = glowSoundCues({ glowScenes: [{ type: "number", start: 2 }, { type: "meter", start: 5 }] });
  assert.deepEqual(times(cues, "move"), [2, 5]);
  assert.deepEqual(times(cues, "card"), [2.43, 6.08]);
  assert.ok(cues.filter((c) => family(c) === "card").every((c) => c.volume === 0.18));
});

test("glow sounds: icons pop, stamps hit, notifications ding, the old look and hook stay silent", () => {
  const cues = glowSoundCues({
    icons: [{ t: 2 }], glowOverlays: [{ type: "stamp", start: 4 }, { type: "notify", start: 6 }],
    zooms: [{ t: 8, scale: 1.2 }], graphics: [{ start: 9 }], slams: [{ t: 10 }], hook: { start: 0 },
  });
  assert.deepEqual(cues.map((c) => [family(c), c.start, c.src]), [
    ["card", 2, "assets/sfx/card.wav"], ["slam", 4, "assets/sfx/slam.wav"], ["ding", 6, "assets/sfx/ding.wav"],
  ]);
  assert.equal(cues[2].duration, 0.42);
  assert.ok(cues.every((c) => c.track === 9));
  assert.deepEqual(glowSoundCues({}), []);
});

test("glow sounds: incoming bubbles ding and outgoing bubbles get a half second of typing beforehand", () => {
  const cues = glowSoundCues({ glowScenes: [{ type: "thread", start: 1, bubbles: [
    { side: "them", at: 2 }, { side: "me", at: 4 }, { side: "them", at: 6 }, { side: "me", at: 8 }, { side: "unknown", at: 9 },
  ] }] });
  assert.deepEqual(times(cues, "ding"), [2, 6]);
  assert.deepEqual(times(cues, "typing"), [3.5, 7.5]);
  assert.ok(cues.filter((c) => family(c) === "typing").every((c) => c.duration === 0.5));
  assert.deepEqual(times(glowSoundCues({ glowScenes: [{ bubbles: [{ side: "me", at: 0.2 }] }] }), "typing"), [0]);
});

test("glow sounds: variants rotate per family after filtering with unique ids and measured durations", () => {
  const cues = glowSoundCues({
    glowScenes: [0, 3, 6, 9].map((start) => ({ start, items: [{ at: start + 0.5 }] })),
    glowOverlays: [1, 4, 7, 10].map((start) => ({ type: "stamp", start })),
  });
  for (const kind of ["move", "card", "slam"]) {
    const list = cues.filter((c) => family(c) === kind);
    assert.deepEqual(list.map((c) => path.basename(c.src)), [`${kind}.wav`, `${kind}-2.wav`, `${kind}-3.wav`, `${kind}.wav`]);
    assert.equal(list[0].duration, list[3].duration);
    assert.ok(list[1].duration < list[0].duration && list[2].duration > list[0].duration);
  }
  assert.equal(new Set(cues.map((c) => c.id)).size, cues.length);
  for (const cue of cues) {
    const file = fs.readFileSync(path.join(PKG_ROOT, cue.src));
    assert.equal(file.toString("ascii", 0, 4), "RIFF");
    // These mono PCM WAVs may have metadata chunks, so locate the data chunk rather than assume 44 bytes.
    let offset = 12, rate, bytes;
    while (offset + 8 <= file.length) {
      const size = file.readUInt32LE(offset + 4), chunk = file.toString("ascii", offset, offset + 4);
      if (chunk === "fmt ") rate = file.readUInt32LE(offset + 16);
      if (chunk === "data") bytes = size;
      offset += 8 + size + size % 2;
    }
    assert.ok(Math.abs(cue.duration - bytes / rate) < 0.000001, cue.src);
  }
});

test("glow sounds: a spoken word ducks only cues landing inside it", () => {
  const cues = glowSoundCues({ icons: [1, 2, 3, 4].map((t) => ({ t })), words: [{ start: 1, end: 2 }, { start: 2.8, end: 3.2 }] });
  assert.deepEqual(cues.map((c) => c.volume), [0.081, 0.135, 0.081, 0.135]);
});

test("glow sounds: spacing keeps the louder cue, including later and ducked competitors", () => {
  const cues = glowSoundCues({
    icons: [1, 1.12, 2, 4.05].map((t) => ({ t })),
    glowOverlays: [{ type: "stamp", start: 2.1 }, { type: "stamp", start: 4 }],
    glowScenes: [{ start: 4.08 }], words: [{ start: 4, end: 4.02 }],
  });
  assert.deepEqual(cues.map((c) => [family(c), c.start]), [["card", 1], ["card", 1.12], ["slam", 2.1], ["move", 4.08]]);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start - cues[i - 1].start >= 0.12 - 1e-9);
  const ties = glowSoundCues({ icons: [2.1, 2, 2.05].map((t) => ({ t })) });
  assert.deepEqual(ties.map((c) => c.start), [2], "equal levels keep the earliest cue, regardless of input order");
});

test("glow sounds: at most one whoosh per 1.5 seconds and dropped cues do not consume variants", () => {
  const cues = glowSoundCues({ glowScenes: [1, 1.1, 2, 2.5, 4].map((start) => ({ start })), icons: [{ t: 2 }] });
  assert.deepEqual(times(cues, "move"), [1, 2.5, 4]);
  assert.deepEqual(times(cues, "card"), [2], "a rate-limited whoosh does not suppress the item at that time");
  assert.deepEqual(cues.filter((c) => family(c) === "move").map((c) => path.basename(c.src)), ["move.wav", "move-2.wav", "move-3.wav"]);
});

test("glow sounds: audio settings control level and disabling sounds", () => {
  const plan = { icons: [{ t: 1 }] };
  assert.equal(glowSoundCues(plan, { level: 0.4 })[0].volume, 0.18);
  assert.equal(glowSoundCues({ ...plan, style: { audio: { soundsVolume: 0.2 } } }, { level: 0.4 })[0].volume, 0.09);
  for (const audio of [{ sounds: false }, { soundsVolume: 0 }]) assert.deepEqual(glowSoundCues({ ...plan, style: { audio } }), []);
});

test("glow sounds: missing or invalid event times are skipped and early typing stays nonnegative", () => {
  const plan = { video: { duration: 5 }, icons: [{}, { t: NaN }, { t: Infinity }, { t: 5 }, { t: 6 }, { t: 1.23456 }], glowScenes: [{ items: [{}, { at: Infinity }] }] };
  const before = structuredClone(plan);
  const cues = glowSoundCues(plan);
  assert.deepEqual(cues.map((c) => c.start), [1.235]);
  assert.deepEqual(plan, before, "cue generation is pure");
});

function fixture() {
  return {
    name: "glow-sound-fixture", preset: "pingel-brand", style: loadPreset("pingel-brand"),
    canvas: { width: 1080, height: 1920 }, video: { src: path.join(PKG_ROOT, "package.json"), duration: 40, hasAudio: true },
    words: Array.from({ length: 60 }, (_, i) => ({ text: i === 10 ? "50" : "listening", start: 3 + i * 0.5, end: 3.4 + i * 0.5 })),
    graphics: [{ start: 5 }], slams: [{ t: 6 }], zooms: [{ t: 3, scale: 1.2 }],
    audio: { replaceAudio: false, tracks: [
      { id: "music", src: "assets/music.m4a", volume: 0.1 },
      { id: "voice", src: "assets/voice.wav", track: 8 },
      { id: "sfx-card-1", src: "assets/sfx/card.wav", start: 2 },
      { id: "sfx-broll-1", src: "assets/broll-1.sfx.wav", start: 3 },
    ] },
  };
}
const library = [{ name: "ear", file: "/fixture/icon-ear.png" }];
const picks = { scenes: [{ type: "number", from: 10, to: 12, value: "50" }], overlays: [{ type: "stamp", word: 30 }, { type: "notify", from: 35, to: 36 }], icons: [{ word: 45, icon: "ear" }] };
const restyle = (plan, saved = picks) => restyleGlow(plan, { library, picks: saved, ask: () => { throw new Error("saved fixture must not call Claude"); } });

test("glow restyle: replaces every old cut cue, preserves music, voice and B-roll sound and regenerates idempotently", async () => {
  const plan = fixture(), music = plan.audio.tracks[0], voice = plan.audio.tracks[1], broll = plan.audio.tracks[3];
  await restyle(plan);
  assert.equal(plan.audio.tracks[0], music);
  assert.equal(plan.audio.tracks[1], voice);
  // A B-roll shot's own generated sound plays with the shot, which the glow look keeps.
  assert.equal(plan.audio.tracks[2], broll);
  assert.equal(plan.audio.replaceAudio, false);
  assert.deepEqual(plan.audio.tracks.slice(3), glowSoundCues(plan));
  assert.deepEqual(plan.audio.tracks.slice(3).map(family), ["move", "card", "slam", "ding", "card"]);
  assert.ok(!plan.audio.tracks.some((c) => c.start === 2));
  const tracks = structuredClone(plan.audio.tracks);
  await restyle(plan);
  assert.deepEqual(plan.audio.tracks, tracks);
});

test("glow restyle: no final elements removes stale sounds, disabled sounds keep music, missing audio is created", async () => {
  const empty = { scenes: [], overlays: [], icons: [], features: [] };
  const plan = fixture();
  await restyle(plan, empty);
  assert.deepEqual(plan.audio.tracks.map((c) => c.id), ["music", "voice", "sfx-broll-1"]);
  plan.style.audio.sounds = false;
  await restyle(plan);
  assert.deepEqual(plan.audio.tracks.map((c) => c.id), ["music", "voice", "sfx-broll-1"]);
  const missing = fixture();
  delete missing.audio;
  await restyle(missing);
  assert.deepEqual(missing.audio.tracks, glowSoundCues(missing));
});

test("glow compose: the final fixture page embeds the regenerated audio and copies only used sfx assets", async (t) => {
  const plan = fixture();
  plan.audio.tracks = plan.audio.tracks.filter((c) => c.id.startsWith("sfx-") && !c.id.startsWith("sfx-broll-"));
  await restyle(plan);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glow-sound-compose-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  composeProject(plan, dir);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  for (const cue of plan.audio.tracks) {
    assert.ok(html.includes(`<audio id="${cue.id}" src="${cue.src}" data-start="${cue.start}" data-duration="${cue.duration}" data-track-index="9" data-volume="${cue.volume}">`));
    assert.deepEqual(fs.readFileSync(path.join(dir, cue.src)), fs.readFileSync(path.join(PKG_ROOT, cue.src)));
  }
  assert.equal((html.match(/<audio id="sfx-/g) || []).length, plan.audio.tracks.length);
  assert.ok(!html.includes("sfx-broll-1"));
  assert.ok(!fs.existsSync(path.join(dir, "assets/sfx/flash.wav")));
  assert.match(html, /"glow":true/);
});
