import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyWindows, sliceWords, clipsPrompt } from "../src/clips.mjs";

const words = Array.from({ length: 200 }, (_, i) => ({ text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));

test("windows snap to words, respect length limits and never overlap; best score first", () => {
  const w = tidyWindows([
    { start: 10.2, end: 50.1, hook: "a", score: 70 },
    { start: 40, end: 80, hook: "overlaps", score: 99 },
    { start: 60, end: 70, hook: "too short", score: 95 },
    { start: 100, end: 160, hook: "b", score: 90 },
    { start: "x", end: 5 },
  ], words, 100.4);
  assert.deepEqual(w.map((c) => c.hook), ["a"]);
  assert.ok(w[0].start <= 10.2 && w[0].start >= 9.5 && w[0].end >= 50 && w[0].end <= 50.8, JSON.stringify(w[0]));
  const s = sliceWords(words, 10, 20);
  assert.equal(s[0].start, 0);
  assert.ok(s.every((x) => x.start >= 0 && x.end <= 10));
  const p = clipsPrompt({ words: words.slice(0, 20), duration: 100, count: 3 });
  assert.match(p, /^\[0\.0\] w0 w1/m);
  assert.match(p, /up to 3 windows of 30 to 90 seconds/);
});
