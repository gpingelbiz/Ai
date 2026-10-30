import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { loadPreset } from "../src/presets.mjs";
import {
  boxIntersection,
  contrastFromLuminances,
  differenceHash,
  expectedSlideText,
  faceOverlapRatio,
  hammingDistance,
  lintSlideCopy,
  matchExpectedText,
  preflightSlides,
  textTokens,
  verdictForProblems,
} from "../src/preflight.mjs";

const fixture = (name) => JSON.parse(fs.readFileSync(path.join("test", "fixtures", "preflight", name), "utf8"));
const brand = loadPreset("pingel-brand").brand;

test("slide preflight builds only painted spec and brand text, including the footer handle", () => {
  const legacy = expectedSlideText({ kind: "photosplit", label: "HIDDEN", headline: "A *real* headline", sub: "Supplied body" }, brand);
  assert.deepEqual(legacy.map((part) => [part.role, part.text]), [
    ["headline", "A real headline"], ["sub", "Supplied body"], ["handle", "@officialgregpingel"],
  ]);
  const compare = expectedSlideText({ kind: "compare", title: "Choose", left: { label: "Before", value: "Six calls" }, right: { label: "After", value: "15 calls", note: "Qualified" }, decisionLine: "Do the math" }, brand);
  assert.deepEqual(compare.map((part) => part.text), ["Choose", "Before", "Six calls", "After", "15 calls", "Qualified", "Do the math", "@officialgregpingel"]);
  assert.equal(expectedSlideText({ kind: "evidence", sourceLabel: "Supplied source" }, brand).some((part) => part.role === "handle"), false);
});

test("OCR matching normalizes punctuation, permits one long-word slip, but keeps numbers and handles critical", () => {
  assert.deepEqual(textTokens("A $3,000 result — today"), ["a", "3000", "result", "today"]);
  const parts = [
    { role: "headline", text: "Volume problem 15", critical: true },
    { role: "handle", text: "@officialgregpingel", critical: true },
  ];
  const pass = matchExpectedText(parts, { lines: [{ text: "VOLUME PROBLEN 15 @officialgregpingel", confidence: 0.91 }] });
  assert.equal(pass.coverage, 1);
  assert.equal(pass.meanConfidence, 0.91);
  const miss = matchExpectedText(parts, { lines: [{ text: "VOLUME PROBLEN 16", confidence: 0.9 }] });
  assert.deepEqual(miss.missing.map((item) => [item.role, item.token]), [["headline", "15"], ["handle", "officialgregpingel"]]);
});

test("slide verdict retries repairable copy, crop and photo issues and holds anything unrepairable", () => {
  assert.equal(verdictForProblems([]), "schedule");
  assert.equal(verdictForProblems([{ fix: "shorten" }, { fix: "recrop" }, { fix: "swap-photo" }]), "retry");
  assert.equal(verdictForProblems([{ fix: "shorten" }, { fix: "none" }]), "hold");
});

test("copy lint names counters, Unicode dashes, swipe, retired GHOST copy and brand never-say words", () => {
  const found = lintSlideCopy({
    kind: "body",
    headline: "Slide 3 — swipe",
    sub: "Comment GHOST. The Ghost P&L can unlock it.",
    items: ["01 / 07"],
  }, ["unlock"]);
  assert.deepEqual(new Set(found.map((item) => item.code)), new Set(["copy-dash", "copy-counter", "copy-swipe", "copy-ghost-cta", "copy-ghost-pl", "copy-never-say"]));
  assert.ok(lintSlideCopy({ kind: "cta", headline: "GHOST" }).some((item) => item.code === "copy-ghost-cta"));
});

function tinyGradient(reverse = false) {
  const png = new PNG({ width: 9, height: 8 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const value = reverse ? 255 - x * 28 : x * 28;
    const at = (y * png.width + x) * 4;
    png.data[at] = png.data[at + 1] = png.data[at + 2] = value;
    png.data[at + 3] = 255;
  }
  return png;
}

test("64-bit dHash is deterministic for tiny pngjs fixtures and Hamming distance counts changed bits", () => {
  const rising = differenceHash(tinyGradient());
  const falling = differenceHash(tinyGradient(true));
  assert.equal(rising, "0000000000000000");
  assert.equal(falling, "ffffffffffffffff");
  assert.equal(hammingDistance(rising, falling), 64);
  assert.equal(hammingDistance(rising, "0000000000000001"), 1);
  assert.equal(hammingDistance("bad", falling), Infinity);
});

test("contrast math uses luminance extremes and box overlap is measured against face area", () => {
  assert.equal(contrastFromLuminances(Array(90).fill(0).concat(Array(10).fill(1))), 21);
  assert.equal(contrastFromLuminances([0.2, 0.2]), 1);
  const text = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, face = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };
  assert.ok(Math.abs(boxIntersection(text, face) - 0.01) < 1e-12);
  assert.ok(Math.abs(faceOverlapRatio(text, face) - 0.25) < 1e-12);
  assert.equal(faceOverlapRatio(text, { x: 0, y: 0, w: 0, h: 0 }), 0);
});

function paintContrastPng(file, lines) {
  const png = new PNG({ width: 1080, height: 1350, colorType: 2, inputColorType: 2, inputHasAlpha: false });
  png.data.fill(96);
  for (let at = 3; at < png.data.length; at += 4) png.data[at] = 255;
  for (const { box } of lines) {
    const x0 = Math.floor(box.x * png.width), x1 = Math.ceil((box.x + box.w) * png.width);
    const y0 = Math.floor(box.y * png.height), y1 = Math.ceil((box.y + box.h) * png.height);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const value = x < (x0 + x1) / 2 ? 0 : 255, at = (y * png.width + x) * 4;
      png.data[at] = png.data[at + 1] = png.data[at + 2] = value;
      png.data[at + 3] = 255;
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 2, inputColorType: 6, inputHasAlpha: true }));
}

test("the November 2 seven-slide fixture passes, and losing slide 4's handle returns retry naming slide 4", async (t) => {
  const spec = fixture("greg-2026-11-02.json"), ocrResults = fixture("greg-2026-11-02-ocr.json");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-slide-preflight-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = ocrResults.map((ocr, index) => {
    const file = path.join(dir, `${String(index + 1).padStart(2, "0")}.png`);
    paintContrastPng(file, ocr.lines);
    return file;
  });
  let photo = 0;
  const options = { ocrResults, hashPhoto: async () => (++photo).toString(16).padStart(16, "0") };
  const pass = await preflightSlides({ spec, files, brand, options });
  assert.equal(pass.verdict, "schedule", JSON.stringify(pass.slides, null, 2));
  assert.equal(pass.photoHashes.length, 7);
  assert.ok(pass.slides.every((slide) => slide.problems.length === 0));

  const missing = structuredClone(ocrResults);
  missing[3].lines = missing[3].lines.filter((line) => !line.text.includes("officialgregpingel"));
  photo = 0;
  const failed = await preflightSlides({ spec, files, brand, options: { ...options, ocrResults: missing } });
  assert.equal(failed.verdict, "retry");
  assert.deepEqual(failed.slides.filter((slide) => slide.problems.some((item) => item.code === "ocr-handle")).map((slide) => slide.index), [4]);
});

import { slideCopyLines, faceCore, faceOverlapRatio as overlapRatio, expectedSlideText as expectedText } from "../src/slide-preflight.mjs";

test("contrast and face checks look only at the slide's own words, never text inside the photo", () => {
  const parts = [{ role: "headline", text: "Volume first. Then the closer.", critical: true }];
  const lines = [{ text: "VOLUME FIRST.", box: { x: 0, y: 0, w: 1, h: 1 } }, { text: "ELLIOTT", box: { x: 0, y: 0, w: 1, h: 1 } }, { text: "MR. OLYMPIA 1976", box: { x: 0, y: 0, w: 1, h: 1 } }];
  assert.deepEqual(slideCopyLines(lines, parts).map((line) => line.text), ["VOLUME FIRST."]);
});

test("text just under the chin is not a face collision; text across the face is", () => {
  const face = { x: 0.27, y: 0.24, w: 0.39, h: 0.31 };
  const underChin = { x: 0.08, y: 0.525, w: 0.37, h: 0.08 };
  const acrossEyes = { x: 0.08, y: 0.30, w: 0.8, h: 0.08 };
  assert.ok(overlapRatio(underChin, faceCore(face)) <= 0.05);
  assert.ok(overlapRatio(acrossEyes, faceCore(face)) > 0.05);
});

test("stat, steps and quote slides list the text they paint, and skip the big stat number", () => {
  const brand = { identity: { handle: "@officialgregpingel" } };
  const stat = expectedText({ kind: "stat", label: "THE NUMBER", number: "3%", headline: "OF BUSINESSES TEXT BACK IN 5 MINUTES.", source: "NP Digital, Feb 2026" }, brand);
  assert.ok(!stat.some((part) => part.text === "3%"));
  assert.ok(stat.some((part) => part.role === "headline" && part.critical));
  const steps = expectedText({ kind: "steps", headline: "WHAT HAPPENS", steps: ["Reply in 15 minutes.", "Book from real times."] }, brand);
  assert.equal(steps.filter((part) => part.role === "item").length, 2);
  const quote = expectedText({ kind: "quote", quote: "I'd rather lose the sale.", by: "Greg Pingel" }, brand);
  assert.ok(quote.some((part) => part.role === "headline" && part.text === "I'd rather lose the sale."));
  assert.ok(quote.some((part) => part.role === "handle"));
});

import { matchExpectedText as matchText } from "../src/slide-preflight.mjs";

test("two short words OCR ran together still count as found", () => {
  const result = matchText([{ role: "headline", text: "MY KIDS DON'T CARE WHAT I CLOSED TODAY.", critical: true }],
    { lines: [{ text: "MY KIDS DON'T", confidence: 1 }, { text: "CARE WHATI", confidence: 1 }, { text: "CLOSED TODAY.", confidence: 1 }] });
  assert.equal(result.missing.length, 0);
  assert.equal(result.coverage, 1);
});
