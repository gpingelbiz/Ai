import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import {
  compareLayoutSignatures,
  cropPng,
  cropTextIssues,
  gridCheck,
  layoutSignature,
  profileCrop,
  repeatedLayout,
} from "../src/grid-check.mjs";

function tile({ width = 60, height = 80, split = 40, top = 190, bottom = 24 } = {}) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = y < split ? Math.max(0, Math.min(255, top + Math.round(20 * x / width))) : bottom;
    const at = (y * width + x) * 4;
    png.data[at] = png.data[at + 1] = png.data[at + 2] = value;
    png.data[at + 3] = 255;
  }
  return png;
}

function writePng(file, png) { fs.writeFileSync(file, PNG.sync.write(png)); }

test("profile crop matches Instagram's feed and reel geometry", () => {
  assert.deepEqual(profileCrop(1080, 1350), { x: 34, y: 0, w: 1012, h: 1350 });
  assert.deepEqual(profileCrop(1080, 1920), { x: 0, y: 240, w: 1080, h: 1440 });
  const clipped = cropPng(tile({ width: 80, height: 100 }));
  assert.deepEqual([clipped.width, clipped.height], [75, 100]);
});

test("OCR crop check catches a line crossing or sitting within 12 pixels of an edge", () => {
  const ocr = { width: 1080, height: 1920, lines: [
    { text: "Safe", box: { x: 0.2, y: 0.25, w: 0.3, h: 0.05 } },
    { text: "Too high", box: { x: 0.2, y: 0.12, w: 0.3, h: 0.02 } },
  ] };
  const issues = cropTextIssues(ocr, profileCrop(ocr.width, ocr.height));
  assert.deepEqual(issues.map((item) => [item.text, item.edges]), [["Too high", ["top"]]]);
});

test("layout signature combines luminance grid, darkness, OCR area, and dHash", () => {
  const ocr = { width: 60, height: 80, lines: [{ text: "Title", box: { x: 0.2, y: 0.6, w: 0.5, h: 0.1 } }] };
  const first = layoutSignature(tile(), { ocr });
  const same = layoutSignature(tile(), { ocr });
  const different = layoutSignature(tile({ split: 15, top: 20, bottom: 220 }), { ocr: { ...ocr, lines: [] } });
  assert.equal(first.luminance.length, 48);
  assert.ok(first.darkPixelRatio > 0 && first.textAreaRatio > 0);
  assert.equal(first.dHash.length, 16);
  assert.equal(compareLayoutSignatures(first, same).near, true);
  assert.equal(compareLayoutSignatures(first, different).near, false);
  assert.equal(repeatedLayout(first, [same, same, same]).repeated, true);
  assert.equal(repeatedLayout(first, [same, same]).repeated, false);
});

test("grid gate retries a fourth repeated tile and holds an unreadable image", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-grid-check-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = Array.from({ length: 4 }, (_, index) => path.join(dir, `${index}.png`));
  files.forEach((file) => writePng(file, tile()));
  const ocr = files.map(() => ({ width: 60, height: 80, lines: [{ text: "Title", confidence: 0.99, box: { x: 0.25, y: 0.55, w: 0.4, h: 0.1 } }] }));
  const repeated = await gridCheck({ newFile: files[0], recentFiles: files.slice(1), options: { allowFixtureSizes: true, ocrResults: ocr } });
  assert.equal(repeated.verdict, "retry");
  assert.equal(repeated.checks.find((check) => check.code === "sameness")?.fix, "relayout");
  assert.equal(repeated.checks.find((check) => check.code === "crop")?.verdict, "schedule");

  const missing = await gridCheck({ newFile: path.join(dir, "missing.png"), options: { allowFixtureSizes: true, ocrResults: [] } });
  assert.equal(missing.verdict, "hold");
  assert.equal(missing.checks[0].code, "images");
});

test("cropTextIssues ignores the uncut top and bottom of a 4:5 post", async () => {
  const { cropTextIssues } = await import("../src/grid-check.mjs");
  const ocr = { width: 1080, height: 1350, lines: [
    { text: "ELLIOTT ARMY", box: { x: 0.3, y: 0.0, w: 0.4, h: 0.05 } },
    { text: "edge words", box: { x: 0.01, y: 0.5, w: 0.3, h: 0.05 } },
  ] };
  const issues = cropTextIssues(ocr);
  assert.deepEqual(issues.map((item) => item.text), ["edge words"]);
});
