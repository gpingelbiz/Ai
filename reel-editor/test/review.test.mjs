import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareTranscripts, rawToClean, writeReview, resolveEngine, secondEngine } from "../src/review.mjs";
import { normalizeWords } from "../src/transcribe.mjs";

const mk = (s, t0 = 0, prob) => s.split(" ").map((text, i) => ({ text, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.25, ...(prob != null ? { prob } : {}) }));

test("a word one engine heard and the other did not is flagged (the real 'ask' mis-hear)", () => {
  const items = compareTranscripts(mk("You can slam the desk, go cold, start looking", 23), mk("You can slam the desk, ask, go cold, start looking", 23));
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "differs");
  assert.match(items[0].alt, /\[ask,\]/);
  assert.match(items[0].heard, /\(nothing\)/);
});

test("punctuation, case, fillers and number words are not disagreements", () => {
  assert.equal(compareTranscripts(mk("That's the standard. So go set-"), mk("that's the standard so um go set")).length, 0);
  assert.equal(compareTranscripts(mk("for three minutes"), mk("for 3 minutes")).length, 0);
});

test("low-confidence words are flagged even when both engines agree", () => {
  const p = mk("who did we see on the calls");
  p[1].prob = 0.31; p[2].prob = 0.4;
  const items = compareTranscripts(p, mk("who did we see on the calls"));
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "unsure");
  assert.match(items[0].heard, /\[did we\]/);
});

test("review times are in the cut reel, and spots that were cut out are dropped", () => {
  const segs = [{ start: 0, end: 4 }, { start: 6, end: 30 }];
  assert.equal(rawToClean(25, segs), 23);
  assert.equal(rawToClean(5, segs), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-review-"));
  const spots = writeReview(dir, { items: [{ kind: "differs", start: 25, end: 25.3, heard: "a [b] c", alt: "a [x] c" }, { kind: "unsure", start: 5, end: 5.2, heard: "[gone]" }], segments: segs, primaryEngine: "elevenlabs", secondEngineName: "faster-whisper", title: "Test" });
  assert.equal(spots.length, 1);
  const txt = fs.readFileSync(path.join(dir, "review.txt"), "utf8");
  assert.match(txt, /Test: 1 spot to check/);
  assert.match(txt, /0:23  caption says:  a \[b\] c/);
  writeReview(dir, { items: [], segments: segs, primaryEngine: "elevenlabs", secondEngineName: "faster-whisper" });
  assert.ok(!fs.existsSync(path.join(dir, "review.txt")), "no note when there is nothing to check");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Scribe logprob becomes a 0-1 confidence; spacing tokens are dropped", () => {
  const w = normalizeWords({ words: [{ text: "Your", start: 0, end: 0.2, type: "word", logprob: -0.0002 }, { text: " ", start: 0.2, end: 0.21, type: "spacing" }, { text: "team", start: 0.21, end: 0.5, type: "word", logprob: Math.log(0.4) }] });
  assert.deepEqual(w.map((x) => x.text), ["Your", "team"]);
  assert.equal(w[0].prob, 1);
  assert.equal(w[1].prob, 0.4);
});

test("auto uses Scribe with a key and Whisper without; the second opinion is the other one", () => {
  assert.equal(resolveEngine("auto", { ELEVENLABS_API_KEY: "x" }), "elevenlabs");
  assert.equal(resolveEngine("auto", {}), "faster-whisper");
  assert.equal(resolveEngine("faster-whisper", { ELEVENLABS_API_KEY: "x" }), "faster-whisper");
  assert.equal(secondEngine("elevenlabs", {}), "faster-whisper");
  assert.equal(secondEngine("faster-whisper", { ELEVENLABS_API_KEY: "x" }), "elevenlabs");
  assert.equal(secondEngine("faster-whisper", {}), null);
});

test("spoken spellings like gonna / going to are the same words", () => {
  assert.equal(compareTranscripts(mk("I'm gonna respect the team"), mk("I'm going to respect the team")).length, 0);
  assert.equal(compareTranscripts(mk("Hey, Vin, I"), mk("hey Ben, I")).length, 1, "a real difference still counts");
});
