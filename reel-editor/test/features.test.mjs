import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addCaptionToFeatures, makeFeatures, writeFeatures } from "../src/features.mjs";

const W = (text, start, end) => ({ text, start, end });
const createdAt = "2026-11-08T12:00:00.000Z";

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
  const got = makeFeatures(plan, { gitSha: "abc123", createdAt });
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
  const file = writeFeatures(dir, plan, { gitSha: "abc123", createdAt });
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
  assert.equal(got.record.sourceDuration, null);
  assert.equal(got.record.finishedDuration, 10);
  assert.deepEqual(got.record.opening, { firstWordAt: null, firstCaption: null });
  assert.deepEqual(got.record.ending, { lastWordEnd: null });
  assert.equal(got.record.coldOpen, false);
  assert.deepEqual(got.record.broll, { count: 0, seconds: 0 });
});

test("the record reports the resolved plan and cuts without counting zoom releases or cadence as punch ins", () => {
  const ending = { lastPointEnd: 15, tailSeconds: 4, tailText: "Have a great day.", trimmed: true, endAt: 15.2 };
  const plan = {
    source: "/recordings/discount.mov", preset: "quiet", style: { name: "quiet-style", look: "receipts" },
    video: { duration: 15.3 }, hook: { text: "Stop *approving* discounts" },
    words: [W("discounts.", 14, 15), W("Stop", 0.15, 0.4)],
    captions: [{ start: 14, end: 15, text: "discounts." }, { start: 0.1, end: 0.4, text: "Stop approving" }],
    zooms: [{ t: 3, scale: 1.1 }, { t: 4, scale: 1 }, { t: 5, scale: 1.08, cut: true }, { t: 8, scale: 1.2 }],
    broll: [{ start: 5, duration: 2.4 }, { start: 10, duration: 1.2 }], coldOpen: { duration: 0.6 }, ending,
  };
  const cuts = { originalDuration: 21, keptDuration: 15.2, removed: [
    { start: 1, end: 1.4, reason: "silence" }, { start: 3, end: 3.2, reason: "silence" },
    { start: 6, end: 7, reason: "filler" }, { start: 16.8, end: 21, reason: "ending" },
  ] };
  const got = makeFeatures(plan, { cuts, gitSha: null, createdAt });
  assert.equal(got.recordSchema, 1);
  assert.deepEqual(got.record, {
    source: { path: "/recordings/discount.mov", basename: "discount.mov" }, preset: "quiet", look: "receipts", style: "quiet-style",
    sourceDuration: 21, finishedDuration: 15.2,
    cutsByReason: { silence: { count: 2, seconds: 0.6 }, filler: { count: 1, seconds: 1 }, ending: { count: 1, seconds: 4.2 } },
    zoomCount: 2, broll: { count: 2, seconds: 3.6 }, coldOpen: true, hookText: "Stop approving discounts",
    opening: { firstWordAt: 0.15, firstCaption: "Stop approving" }, ending,
    captionEnding: null, captionAsks: [], createdAt,
  });
  got.record.ending.trimmed = false;
  assert.equal(plan.ending.trimmed, true);
  const other = makeFeatures({ ...plan, preset: "plain", style: { name: "plain" }, coldOpen: null, broll: [], zooms: [], ending: undefined }, { gitSha: null, createdAt });
  assert.equal(other.record.preset, "plain");
  assert.equal(other.record.look, "plain");
  assert.equal(other.record.sourceDuration, null);
  assert.equal(other.record.finishedDuration, 15.3);
  assert.equal(other.record.zoomCount, 0);
  assert.deepEqual(other.record.ending, { lastWordEnd: 15 });
});

test("img-3058 minimal saved plan and cuts preserve source versus finished timeline facts", (t) => {
  // Selected fields copied verbatim from the read-only img-3058 plan.json and cuts.json on 2026-11-08.
  // Kept segments are frame snapped, so removed[] seconds are not originalDuration minus keptDuration.
  const plan = {
    source: "/Users/gregpingel/Reels/raw/IMG_3058.mov", preset: "pingel-brand", style: { name: "pingel-brand" },
    video: { duration: 93.5 }, hook: { text: "Going to work feels like entering a jungle" },
    words: [W("Want", 0.08, 0.16), W("it.", 86.866, 86.926), W("plate?", 93.006, 93.266)],
    captions: [{ start: 0.03, end: 0.57, text: "Want to hear about" }],
    zooms: [{ t: 15.976, scale: 1.07, snap: 0.12 }, { t: 18.656, scale: 1, snap: 0.3 }, { t: 51.123, scale: 1.1, snap: 0.12 }, { t: 53.99, scale: 1, snap: 0.3 }],
    coldOpen: null, broll: [], graphics: [],
  };
  const cuts = { originalDuration: 104.372, keptDuration: 93.399, removed: [
    [1.42, 1.84], [4.74, 5.46], [13.68, 14.16], [20.54, 21.12], [27.22, 28.98], [34.52, 35],
    [41, 41.82], [44.26, 44.8], [48.96, 49.34], [57.74, 58.4], [59.2, 60.2], [61.08, 61.52],
    [63.34, 63.78], [75.14, 75.84], [85.06, 85.48], [103.22, 104.372],
  ].map(([start, end]) => ({ start, end, reason: "silence" })) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-real-features-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "cuts.json"), JSON.stringify(cuts));
  const got = JSON.parse(fs.readFileSync(writeFeatures(dir, plan, { gitSha: null, createdAt }), "utf8"));
  assert.equal(got.record.sourceDuration, 104.372);
  assert.equal(got.record.finishedDuration, 93.399);
  assert.deepEqual(got.record.cutsByReason, { silence: { count: 16, seconds: 10.992 } });
  assert.equal(got.record.zoomCount, 2);
  assert.deepEqual(got.record.opening, { firstWordAt: 0.08, firstCaption: "Want to hear about" });
  assert.deepEqual(got.record.ending, { lastWordEnd: 93.266 });
  assert.equal(got.record.coldOpen, false);
});

test("caption metadata preserves every existing field, handles legacy sidecars, and is a no-op without one", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-caption-features-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addCaptionToFeatures(dir, "Send this to the owner who approves every discount.");
  assert.deepEqual(fs.readdirSync(dir), []);
  const file = path.join(dir, "analytics-features.json");
  const existing = { experiment: { preset: "plain" }, performance: { shares: 2 }, record: { createdAt } };
  fs.writeFileSync(file, JSON.stringify(existing));
  addCaptionToFeatures(dir, "Save this.\r\nSend this to the owner who approves every discount.\r\n\r\n#a #b #c\r\n");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    ...existing, recordSchema: 1,
    record: { createdAt, captionEnding: "Send this to the owner who approves every discount.", captionAsks: ["save", "send"] },
  });
  fs.writeFileSync(file, JSON.stringify({ performance: { saves: 1 } }));
  addCaptionToFeatures(dir, "#onlytags\n");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { performance: { saves: 1 }, recordSchema: 1, record: { captionEnding: null, captionAsks: [] } });
});

test("rebuilding features restores the already written caption ending", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-rebuilt-features-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "caption.txt"), "Want the exact words? DM me DISCOUNT and I'll send them.\n\n#a #b #c\n");
  const file = writeFeatures(dir, { video: { duration: 12 } }, { gitSha: null, createdAt });
  const got = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(got.record.captionEnding, "Want the exact words? DM me DISCOUNT and I'll send them.");
  assert.deepEqual(got.record.captionAsks, ["dm"]);
});
