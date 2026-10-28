import { test } from "node:test";
import assert from "node:assert/strict";
import { balancedSplit, groupWords, phraseSplit } from "../src/captions.mjs";
import { loadPreset } from "../src/presets.mjs";

const timed = (text, { gapAfter = -1, gap = 0 } = {}) => {
  let shift = 0;
  return text.split(" ").map((word, i) => {
    if (i === gapAfter + 1) shift += gap - 0.1;
    return { text: word, start: i * 0.3 + shift, end: i * 0.3 + shift + 0.2 };
  });
};

const textLines = (lines) => lines.map((line) => line.map((w) => w.text).join(" "));

test("phraseSplit breaks the coaching thought after its comma", () => {
  const run = timed("If you want more clients, stop chasing them.");
  const lines = textLines(phraseSplit(run, 3));
  assert.ok(lines.some((line) => line.endsWith("clients,")), lines.join(" | "));
  assert.ok(lines.some((line) => line === "stop chasing them."), lines.join(" | "));
});

test("phraseSplit prefers a measured 0.4 second pause", () => {
  const run = timed("Build the system before you chase another lead", { gapAfter: 3, gap: 0.4 });
  assert.deepEqual(textLines(phraseSplit(run, 4)), ["Build the system before", "you chase another lead"]);
});

test("phraseSplit does not leave the article at the end of a line", () => {
  const lines = textLines(phraseSplit(timed("Most coaches lose the sale on the first call"), 3));
  assert.ok(lines.every((line) => !/\bthe$/i.test(line)), lines.join(" | "));
});

test("phraseSplit never cuts a protected multi-word name", () => {
  const run = timed("We use Built To Close every day");
  const lines = textLines(phraseSplit(run, 3, { protectedPhrases: new Set(["Built To Close"]) }));
  assert.ok(lines.includes("Built To Close"), lines.join(" | "));
});

test("phraseSplit without boundary signals falls back to balanced sizes", () => {
  const run = timed("One two three four five six seven");
  assert.deepEqual(phraseSplit(run, 3).map((line) => line.length), [3, 2, 2]);
  assert.deepEqual(textLines(phraseSplit(run, 3)), textLines(balancedSplit(run, 3)));
});

test("groupWords switches phrase breaks from the caption preset and keeps the old splitter available", () => {
  const run = timed("If you want more clients, stop chasing them.");
  const oldLines = groupWords(run, 5, { wordsPerLine: 3, phraseBreaks: false }).map((line) => line.text);
  const newLines = groupWords(run, 5, { wordsPerLine: 3, phraseBreaks: true }).map((line) => line.text);
  assert.deepEqual(oldLines, ["If you want", "more clients stop", "chasing them"]);
  assert.ok(newLines.includes("want more clients"), newLines.join(" | "));
  assert.ok(newLines.includes("stop chasing them"), newLines.join(" | "));
  assert.equal(loadPreset("pingel-brand").captions.phraseBreaks, true);
});
