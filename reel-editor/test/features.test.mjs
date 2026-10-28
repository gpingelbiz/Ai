import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeFeatures, writeFeatures } from "../src/features.mjs";

const W = (text, start, end) => ({ text, start, end });

test("analytics features records the experiment, hook, frame zero, graphics, derived measures and empty performance", () => {
  const hookText = "Your bad day shows in 10 minutes";
  const spoken = hookText.split(" ").map((text, i) => W(text, 8 + i * 0.2, 8.15 + i * 0.2));
  const plan = {
    preset: "pingel-brand",
    scenes: { schema: 2 },
    video: { duration: 20 },
    canvas: { width: 1080, height: 1920 },
    style: { name: "pingel-brand", look: "receipts", hook: { fontSizeFrac: 0.052, style: "headline" } },
    hook: { text: hookText, start: 0, duration: 3 },
    coldOpen: { file: "/tmp/laptop.png", duration: 0.6 },
    words: spoken,
    captions: [
      { start: 4, end: 7, text: "about 10 minutes" },
      { start: 9, end: 13, text: "first call then ask why" },
    ],
    graphics: [
      { type: "stat", start: 4, duration: 3, eyebrow: "THE DELAY", value: "About 10 minutes", sub: "before they notice" },
      { type: "steps", start: 9, duration: 4, title: "THE ROUTE", items: [{ text: "First call" }, { text: "Ask why" }] },
    ],
    broll: [{ start: 6, duration: 2, file: "/tmp/laptop.png" }],
  };
  const got = makeFeatures(plan, { gitSha: "abc123" });
  assert.deepEqual(got.experiment.graphics, [{ type: "stat", version: 2 }, { type: "steps", version: 2 }]);
  assert.equal(got.experiment.graphicsEnabled, true);
  assert.equal(got.experiment.graphicsSchema, 2);
  assert.equal(got.experiment.preset, "pingel-brand");
  assert.equal(got.experiment.look, "receipts");
  assert.equal(got.experiment.editorGitSha, "abc123");
  assert.deepEqual(got.hook, { text: hookText, wordCount: 7, lineCount: 2, hasNumber: true, hasTime: true, hasQuote: false, promisedPhraseAt: 8 });
  assert.deepEqual(got.frameZero, { source: "cold-open", brollAsset: "/tmp/laptop.png", visibleWordCount: 7 });
  assert.equal(got.graphics[0].informationRole, "proof");
  assert.equal(got.graphics[1].informationRole, "orient");
  assert.ok(got.graphics[0].captionOverlap > 0);
  assert.ok(got.graphics[0].wordsPerSecondBudgetUsed > 0);
  assert.deepEqual(got.derived, { firstCardDelay: 4, cardCount: 2, occupancyPct: 35, majorEventsPer10s: 4 });
  assert.deepEqual(got.performance, {});

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-features-"));
  const file = writeFeatures(dir, plan, { gitSha: "abc123" });
  assert.equal(path.basename(file), "analytics-features.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), got);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("analytics features keeps a stable empty shape for a reel without cards", () => {
  const got = makeFeatures({ video: { duration: 10 }, style: {}, graphics: [], broll: [], captions: [] }, { gitSha: null });
  assert.deepEqual(got.experiment.graphics, []);
  assert.deepEqual(got.graphics, []);
  assert.deepEqual(got.derived, { firstCardDelay: null, cardCount: 0, occupancyPct: 0, majorEventsPer10s: 0 });
  assert.deepEqual(got.performance, {});
});
