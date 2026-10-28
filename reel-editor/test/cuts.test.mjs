import { test } from "node:test";
import assert from "node:assert/strict";
import { planCuts, findBadTakes, remapWords, findRoomTone, remapEnvelope } from "../src/cuts.mjs";
import { readFileSync } from "node:fs";

const sample = JSON.parse(readFileSync(new URL("../examples/sample-words.json", import.meta.url))).words;

test("findRoomTone prefers clean room outside the speech over a longer pause", () => {
  const step = 0.02;
  const db = new Array(250).fill(-24);
  for (let i = 0; i < 45; i++) db[i] = -58;
  for (let i = 80; i < 170; i++) db[i] = -58;
  for (let i = 205; i < 250; i++) db[i] = -58;
  const words = [{ start: 1, end: 1.5 }, { start: 3.5, end: 4 }];
  const room = findRoomTone({ step, db }, words, 5);
  assert.ok(room);
  assert.ok(room.end <= 0.92 || room.start >= 4.08, JSON.stringify(room));
  assert.equal(room.db, -58);
});

test("findRoomTone picks a quiet long pause and trims its edges", () => {
  const step = 0.02;
  const db = new Array(300).fill(-24);
  for (let i = 65; i < 145; i++) db[i] = -57;
  const words = [{ start: 0, end: 1.2 }, { start: 3, end: 6 }];
  const room = findRoomTone({ step, db }, words, 6);
  assert.deepEqual(room, { start: 1.35, end: 2.75, db: -57 });
});

test("findRoomTone rejects a quiet candidate with a spike", () => {
  const db = new Array(20).fill(-60);
  db[10] = -45;
  assert.equal(findRoomTone({ step: 0.02, db }, [], 0.4), null);
});

test("findRoomTone returns null when every word-free run is above the clip floor", () => {
  const db = new Array(100).fill(-30);
  for (let i = 0; i < 55; i++) db[i] = -60;
  const words = [{ start: 0, end: 1.08 }];
  assert.equal(findRoomTone({ step: 0.02, db }, words, 2), null);
});

test("findBadTakes drops the false start and keeps the restart", () => {
  const drop = findBadTakes(sample);
  const dropped = sample.filter((_, i) => drop[i] === "bad-take").map((w) => w.text);
  assert.deepEqual(dropped, ["the", "thing", "about"]);
  const stutters = sample.filter((_, i) => drop[i] === "stutter").map((w) => w.text);
  assert.deepEqual(stutters, ["I"]);
});

test("findBadTakes leaves deliberate repetition after a clause boundary", () => {
  const w = ["it's", "not", "about", "the", "money,", "it's", "not", "about", "the", "time."].map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  assert.ok(findBadTakes(w).every((d) => d === null));
});

test("planCuts removes long silences, fillers and bad takes, never the kept words", () => {
  const plan = planCuts(sample, 24, { silence: "fast", badTakes: true, fillers: true, pad: 0.12 });
  const reasons = plan.removed.map((r) => r.reason);
  assert.ok(reasons.includes("silence"));
  assert.ok(reasons.includes("filler"));
  assert.ok(reasons.includes("bad-take"));
  assert.ok(reasons.includes("stutter"));
  assert.ok(plan.keptDuration < 24 * 0.75, `kept ${plan.keptDuration}`);
  for (const w of plan.words.filter((w) => !w.drop)) {
    const mid = (w.start + w.end) / 2;
    assert.ok(plan.segments.some((s) => mid >= s.start && mid <= s.end), `${w.text} fell outside the kept segments`);
  }
  for (const w of plan.words.filter((w) => w.drop)) {
    const mid = (w.start + w.end) / 2;
    assert.ok(!plan.segments.some((s) => mid > s.start && mid < s.end), `${w.text} (${w.drop}) survived the cut`);
  }
  for (let i = 1; i < plan.segments.length; i++) assert.ok(plan.segments[i].start >= plan.segments[i - 1].end);
});

test("silence off keeps the whole clip when nothing else is dropped", () => {
  const w = [{ text: "hello", start: 1, end: 1.5 }, { text: "there.", start: 4, end: 4.5 }];
  const plan = planCuts(w, 10, { silence: "off", badTakes: false, fillers: false });
  assert.deepEqual(plan.segments, [{ start: 0.88, end: 4.62 }]);
});

test("remapWords moves words onto the cut timeline and keeps order", () => {
  const plan = planCuts(sample, 24, { silence: "fast" });
  const words = remapWords(plan.words, plan.segments);
  assert.equal(words.length, sample.length - 5, "um + 3 bad-take + 1 stutter dropped; count = kept words");
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].start);
  assert.ok(words[words.length - 1].end <= plan.keptDuration + 0.001);
  assert.equal(words[0].text, "Most");
  assert.equal(words[0].start, 0.12);
});

test("remapEnvelope concatenates two kept source segments in reel time", () => {
  const env = { step: 0.1, db: Array.from({ length: 12 }, (_, i) => -60 + i) };
  const mapped = remapEnvelope(env, [{ start: 0.2, end: 0.5 }, { start: 0.8, end: 1 }]);
  assert.equal(mapped.step, 0.1);
  assert.deepEqual(mapped.db, [-58, -57, -56, -52, -51]);
});

test("a repeated word across a sentence break is not a stutter", async () => {
  const { findBadTakes } = await import("../src/cuts.mjs");
  const w = ["Your", "reps", "look", "at", "you.", "You", "can", "slam", "the", "desk"].map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  assert.ok(findBadTakes(w).every((d) => d === null), "\"you. You\" must survive");
  const st = ["I", "I", "think", "so"].map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  assert.equal(findBadTakes(st)[0], "stutter", "a real stutter is still cut");
});

test("guardSilenceCuts keeps sound the transcript timing would have cut", async () => {
  const { guardSilenceCuts } = await import("../src/cuts.mjs");
  const step = 0.02;
  const db = Array.from({ length: 300 }, (_, i) => (i * step >= 2.0 && i * step < 2.3 ? -25 : i * step < 1.0 || i * step > 4.0 ? -25 : -60));
  // Speech 0-1s, a word at 2.0-2.3s the transcript missed, speech from 4s. Planned cut: 1.1-3.9s.
  const cuts = { segments: [{ start: 0, end: 1.1 }, { start: 3.9, end: 6 }], removed: [{ start: 1.1, end: 3.9, reason: "silence" }], originalDuration: 6, keptDuration: 3.2 };
  const { cuts: g, restored } = guardSilenceCuts(cuts, { step, db }, 6);
  assert.equal(restored, 1);
  const inGap = (t) => !g.segments.some((s) => t >= s.start && t <= s.end);
  assert.ok(!inGap(2.1), "the missed word at 2.1s is kept");
  assert.ok(inGap(3.5), "the real pause after it is still cut");
  const quiet = guardSilenceCuts({ ...cuts }, { step, db: db.map((v, i) => (i * step >= 2.0 && i * step < 2.3 ? -60 : v)) }, 6);
  assert.equal(quiet.restored, 0, "a truly quiet gap is cut as planned");
});

test("short words are merged into a neighbour, never dropped", async () => {
  const { planCuts, remapWords } = await import("../src/cuts.mjs");
  const words = [{ text: "Own", start: 1, end: 1.4 }, { text: "it.", start: 1.45, end: 1.8 }, { text: "Go", start: 4, end: 4.04 }, { text: "Now", start: 7, end: 7.4 }];
  const cuts = planCuts(words, 9, { silence: "fast", badTakes: false, fillers: false });
  const kept = remapWords(cuts.words, cuts.segments).map((w) => w.text);
  assert.deepEqual(kept, ["Own", "it.", "Go", "Now"]);
});

test("segment edges snap to the frame grid", async () => {
  const { snapSegments } = await import("../src/cuts.mjs");
  const s = snapSegments([{ start: 0.017, end: 1.011 }, { start: 1.02, end: 2.345 }], 30, 10);
  assert.deepEqual(s, [{ start: 0.033, end: 1 }, { start: 1.033, end: 2.333 }]);
  for (const x of s) for (const v of [x.start, x.end]) assert.ok(Math.abs(v * 30 - Math.round(v * 30)) < 0.02);
});

test("a noisy room: short bursts do not count as sound; most cuts kept raises the noisy flag", async () => {
  const { guardSilenceCuts } = await import("../src/cuts.mjs");
  const step = 0.02;
  const db = new Array(500).fill(-55); // 10 s of quiet room
  for (let i = 50; i < 100; i++) db[i] = -20; // speech 1-2 s
  for (let i = 150; i < 200; i++) db[i] = -20; // speech 3-4 s
  db[125] = -20; // one click in the gap
  const cuts = { segments: [{ start: 1, end: 2 }, { start: 3, end: 4 }], removed: [{ start: 0, end: 1, reason: "silence" }, { start: 2, end: 3, reason: "silence" }, { start: 4, end: 10, reason: "silence" }], keptDuration: 2 };
  const g = guardSilenceCuts(cuts, { step, db }, 10);
  assert.equal(g.restored, 0, "a single loud frame is not a sound");
  for (let i = 110; i < 140; i++) db[i] = -20; // a real word in the gap
  const g2 = guardSilenceCuts(cuts, { step, db }, 10);
  assert.equal(g2.restored, 1);
  assert.ok(g2.cuts.segments.some((s) => s.start <= 2.2 && s.end >= 2.8), "the word in the gap is inside a kept segment");
  const big = { segments: [{ start: 1, end: 2 }, { start: 3, end: 4 }, { start: 5, end: 6 }, { start: 7, end: 8 }], removed: [0, 2, 4, 6, 8].map((t) => ({ start: t, end: t + 1, reason: "silence" })), keptDuration: 4 };
  const hum = new Array(500).fill(-40); // loud room: every gap sounds like something
  const g3 = guardSilenceCuts(big, { step, db: hum.map((v, i) => ([50, 150, 250, 350].some((s) => i >= s && i < s + 50) ? -20 : v)) }, 10);
  assert.equal(g3.noisy, false, "a steady floor measured in the gaps is not noise");
});

test("a sign-off in the last seconds is dropped; the same words earlier are kept", async () => {
  const { planCuts, findSignOff } = await import("../src/cuts.mjs");
  const words = [{ text: "Own", start: 1, end: 1.4 }, { text: "it.", start: 1.5, end: 1.8 }, { text: "Thanks", start: 20, end: 20.3 }, { text: "for", start: 20.3, end: 20.5 }, { text: "watching", start: 20.5, end: 20.9 }];
  assert.equal(findSignOff(words, 22), 2);
  assert.equal(findSignOff(words, 60), -1);
  const cuts = planCuts(words, 22, { badTakes: false, fillers: false });
  assert.deepEqual(cuts.words.filter((w) => w.drop).map((w) => w.text), ["Thanks", "for", "watching"]);
  assert.ok(cuts.removed.some((r) => r.reason === "sign-off"));
});

test("tight pacing: dead air between phrases goes, the beat after a comma stays", async () => {
  const { planCuts } = await import("../src/cuts.mjs");
  const w = (text, start, end) => ({ text, start, end });
  const words = [w("First,", 0, 0.4), w("you", 0.75, 0.9), w("call.", 0.95, 1.3), w("Then", 1.8, 2.0), w("close.", 2.05, 2.5)];
  const tight = planCuts(words, 3, { silence: "tight", pad: 0.08, beats: 0.4, badTakes: false, fillers: false, signOff: false });
  // 0.35 s after "First," is a beat and stays; the 0.5 s gap after "call." is dead air and is cut.
  assert.ok(tight.segments.some((s) => s.start <= 0.05 && s.end >= 1.3), JSON.stringify(tight.segments));
  assert.equal(tight.segments.length, 2);
  const noBeats = planCuts(words, 3, { silence: "tight", pad: 0.08, badTakes: false, fillers: false, signOff: false });
  assert.equal(noBeats.segments.length, 3, "without beats the comma pause is cut too");
});

test("a recording that stops mid-word ends on its last finished sentence nearby", async () => {
  const { planCuts } = await import("../src/cuts.mjs");
  const w = (text, start, end) => ({ text, start, end });
  const words = [w("That's", 0, 0.3), w("the", 0.35, 0.5), w("standard,", 0.55, 1.0), w("so", 1.6, 1.7), w("go", 1.75, 1.85), w("set-", 2.0, 2.1)];
  const r = planCuts(words, 2.2, { badTakes: false, fillers: false });
  assert.ok(r.removed.some((x) => x.reason === "cut-off"), JSON.stringify(r.removed));
  assert.ok(r.segments[r.segments.length - 1].end < 1.6, "ends after 'standard,'");
});
