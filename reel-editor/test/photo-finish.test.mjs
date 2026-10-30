import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseTargetLuma, finishPhotoSet, grainStrength, parsePhotoFinishArgs, parsePhotoScoreArgs, photoScoreRows } from "../src/photo-finish.mjs";
import { photoScore } from "../src/photos.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "photo-finish-test-"));
const face = { x: 0.3, y: 0.2, w: 0.2, h: 0.2, quality: 0.6 };
const report = (over = {}) => ({ light: 0.5, sharp: 0.01, faces: [face], aesthetic: 0, utility: false, ...over });

test("photo finish: one shared target uses face medians and the documented safe bands", () => {
  assert.equal(chooseTargetLuma([{ faceLuma: 0.42 }, { faceLuma: 0.58 }, { faceLuma: 0.52 }]), 0.52);
  assert.equal(chooseTargetLuma([{ faceLuma: 0.20 }, { faceLuma: 0.30 }]), 0.38);
  assert.equal(chooseTargetLuma([{ faceLuma: null, medianLuma: 0.18 }, { medianLuma: 0.28 }]), 0.36);
  assert.equal(chooseTargetLuma([]), 0.45);
});

test("photo finish: brand grain maps to bounded image noise", () => {
  assert.equal(grainStrength(0), 0);
  assert.equal(grainStrength(0.08), 0.022);
  assert.equal(grainStrength(1), 0.03);
});

test("photo score: aesthetics add 1.25, utility subtracts 0.75, and a clear face still wins", () => {
  assert.ok(Math.abs((photoScore(report({ aesthetic: 1 })) - photoScore(report({ aesthetic: -1 }))) - 1.25) < 1e-9);
  assert.ok(Math.abs((photoScore(report()) - photoScore(report({ utility: true }))) - 0.75) < 1e-9);
  assert.ok(photoScore(report({ aesthetic: -1, utility: true })) > photoScore(report({ faces: [], aesthetic: 1 })));
  assert.deepEqual(photoScoreRows([{ file: "a.jpg", overallScore: 0.4, isUtility: true, faces: [face], sharp: 0.02, light: 0.48 }]), [
    { file: "a.jpg", overall: 0.4, utility: true, faceCount: 1, sharpness: 0.02, luma: 0.48 },
  ]);
});

test("photo finish: CLI options parse without changing file order", () => {
  assert.deepEqual(parsePhotoFinishArgs(["a.jpg", "b.heic", "--out-dir", "done", "--grade", "bw", "--intensity", "0.4", "--grain", "0.02", "--json"]), {
    files: ["a.jpg", "b.heic"], outDir: "done", grade: "bw", intensity: 0.4, grain: 0.02, json: true, help: false,
  });
  assert.deepEqual(parsePhotoScoreArgs(["a.jpg", "b.jpg", "--json"]), { files: ["a.jpg", "b.jpg"], json: true, help: false });
  assert.throws(() => parsePhotoFinishArgs(["a.jpg", "--out-dir", "done", "--grade", "orange-teal"]), /--grade/);
  assert.throws(() => parsePhotoFinishArgs(["a.jpg", "--out-dir", "done", "--grain", "0.2"]), /--grain/);
});

test("photo finish: a missing Swift binary warns once and copies every original through", async () => {
  const root = tmp(), outDir = path.join(root, "out");
  const jpg = path.join(root, "one.jpg"), heic = path.join(root, "two.heic");
  fs.writeFileSync(jpg, "jpeg bytes");
  fs.writeFileSync(heic, "heic bytes");
  const warnings = [];
  const result = await finishPhotoSet([jpg, heic], { outDir, resolveBinary: async () => null, warning: (message) => warnings.push(message) });
  assert.equal(result.fallback, true);
  assert.equal(warnings.length, 1);
  assert.deepEqual(result.outputs.map((file) => path.extname(file)), [".jpg", ".heic"]);
  assert.deepEqual(result.outputs.map((file) => fs.readFileSync(file, "utf8")), ["jpeg bytes", "heic bytes"]);
  assert.ok(result.photos.every((photo) => /copied the originals/.test(photo.reason)));
});

test("photo finish: JSON analysis stand-ins drive the shared target and per-photo result", async () => {
  const root = tmp(), outDir = path.join(root, "out");
  const files = [path.join(root, "a.jpg"), path.join(root, "b.jpg")];
  files.forEach((file) => fs.writeFileSync(file, "x"));
  let analyzes = 0;
  const execute = async (_binary, args) => {
    const finishing = args.includes("--target-luma");
    if (!finishing) {
      const faceLuma = analyzes++ ? 0.56 : 0.44;
      return { out: JSON.stringify({ medianLuma: 0.4, faceLuma, saturation: 0.2, clippedPercent: 0, faceBoxes: [] }) + "\n" };
    }
    fs.writeFileSync(args[1], "finished");
    return { out: JSON.stringify({ medianLuma: 0.4, faceLuma: 0.5, saturation: 0.2, clippedPercent: 0, faceBoxes: [], after: { medianLuma: 0.5, faceLuma: 0.5, saturation: 0.18, clippedPercent: 0, faceBoxes: [] }, rejected: false, reason: "" }) + "\n" };
  };
  const result = await finishPhotoSet(files, { outDir, resolveBinary: async () => "/fake/photofinish", execute, warning: () => {} });
  assert.equal(result.targetLuma, 0.5);
  assert.equal(result.fallback, false);
  assert.deepEqual(result.photos.map((photo) => photo.after.faceLuma), [0.5, 0.5]);
});
