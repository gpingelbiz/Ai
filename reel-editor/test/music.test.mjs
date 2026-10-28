import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTracks, moodsOf, pickTrack, duckingLane, duckingLaneFromEnvelope, moodPrompt, seeded } from "../src/music.mjs";

test("tracks: mood from the file name, Signature weighs more, Bench is parked", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "music-"));
  for (const f of ["Tense - A - X.mp3", "Signature Tense - B - Y.mp3", "Lofi - C - Z.wav", "notes.txt", ".hidden.mp3"]) fs.writeFileSync(path.join(d, f), "");
  fs.mkdirSync(path.join(d, "Bench")); fs.writeFileSync(path.join(d, "Bench", "Rock - D - W.mp3"), "");
  const t = listTracks(d);
  assert.deepEqual(t.map((x) => x.name), ["Lofi - C - Z.wav", "Signature Tense - B - Y.mp3", "Tense - A - X.mp3"]);
  assert.deepEqual(moodsOf(t), ["Lofi", "Tense"]);
  assert.equal(t.find((x) => x.signature).mood, "Tense");
  assert.equal(pickTrack(t, { want: "c - z" }).name, "Lofi - C - Z.wav");
  assert.equal(pickTrack(t, { moods: ["lofi"] }).name, "Lofi - C - Z.wav");
  let sig = 0;
  for (let i = 0; i < 200; i++) if (pickTrack(t, { moods: ["tense"], seed: "s" + i }).signature) sig++;
  assert.ok(sig > 110 && sig < 190, `signature picked ${sig}/200, expected about 150`);
  assert.equal(pickTrack(t, { moods: ["nope"], seed: "x" }).name, pickTrack(t, { moods: ["nope"], seed: "x" }).name, "same seed, same pick");
  assert.equal(pickTrack([], {}), null);
});

test("ducking lane: fade in, swell only in long pauses, fade out, monotonic", () => {
  const words = [{ start: 1, end: 1.5 }, { start: 1.7, end: 2 }, { start: 4, end: 4.5 }, { start: 9, end: 9.5 }];
  const lane = duckingLane(words, { duration: 12, level: 0.1, start: 0.5 });
  assert.deepEqual(lane[0], { t: 0.5, v: 0 });
  assert.deepEqual(lane[1], { t: 1.5, v: 0.1 });
  const hi = lane.filter((p) => p.v > 0.1);
  assert.ok(hi.length >= 4, "two long pauses swell");
  assert.ok(hi.every((p) => p.v <= 0.22 + 1e-9));
  assert.ok(!lane.some((p) => p.t > 1.5 && p.t < 1.7 && p.v > 0.1), "a 0.2 s gap does not swell");
  for (let i = 1; i < lane.length; i++) assert.ok(lane[i].t > lane[i - 1].t);
  assert.deepEqual(lane[lane.length - 1], { t: 12, v: 0 });
});

test("voice ducking follows breaths and untranscribed sound, but only swells in real gaps", () => {
  const step = 0.02, duration = 11;
  const db = new Array(Math.ceil(duration / step)).fill(-60);
  const loud = (a, b, level = -20) => { for (let i = Math.floor(a / step); i < Math.ceil(b / step); i++) db[i] = level; };
  loud(1, 1.5); loud(2, 2.12, -28); loud(5, 5.5); loud(7, 7.2, -18); loud(9, 9.5);
  const words = [
    { start: 1, end: 1.5 }, { start: 4, end: 4.5 },
    { start: 5, end: 5.5 }, { start: 9, end: 9.5 },
  ];
  const lane = duckingLaneFromEnvelope({ step, db }, { duration, words, level: 0.1, minGap: 0.9 });
  const at = (t) => {
    let i = 1;
    while (i < lane.length && lane[i].t < t) i++;
    if (i >= lane.length) return lane[lane.length - 1].v;
    const a = lane[i - 1], b = lane[i];
    return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t));
  };
  assert.equal(at(2.08), 0.1, "the 120 ms breath ducks");
  assert.equal(at(2.3), 0.1, "release holds after the breath");
  assert.ok(at(3.2) > 0.2, "the rest of the long gap still swells");
  assert.equal(at(4.1), 0.1, "a transcript word ducks even when its envelope blocks are quiet");
  assert.equal(at(4.8), 0.1, "a 0.5 s gap never swells");
  assert.ok(at(6.5) > 0.2, "music swells before an untranscribed burst");
  assert.equal(at(7.04), 0.1, "the untranscribed burst ducks within the attack");
  assert.ok(at(8.2) > 0.2, "music releases smoothly and swells again");
  for (let i = 1; i < lane.length; i++) assert.ok(lane[i].t > lane[i - 1].t);
});

test("voice ducking stays sparse for a 60 second reel", () => {
  const step = 0.02, duration = 60;
  const db = new Array(duration / step).fill(-60);
  for (let second = 0; second < duration; second += 4) {
    for (let i = second / step; i < (second + 2.4) / step; i++) db[i] = -20;
  }
  const lane = duckingLaneFromEnvelope({ step, db }, { duration, level: 0.1 });
  assert.ok(lane.length < 200, `${lane.length} points`);
});

test("mood prompt lists the moods on disk and allows none", () => {
  const p = moodPrompt({ transcript: "t", hook: "h", moods: ["Tense", "Lofi"] });
  assert.match(p, /use these names exactly\): Tense, Lofi/);
  assert.match(p, /"none":false/);
  const r = seeded("abc"); assert.ok(r() >= 0 && r() < 1);
});
