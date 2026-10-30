import fs from "node:fs";
import { PNG } from "pngjs";
import { ocrBinary, parseOcrJSON } from "./evidence.mjs";
import { differenceHash, hammingDistance, relativeLuminance } from "./slide-preflight.mjs";
import { profileCrop } from "./profile-crop.mjs";
import { run } from "./util.mjs";

export { profileCrop } from "./profile-crop.mjs";

// These deliberately describe broad layout, not matching photographs. Calibration on Greg's Oct 26 to Nov 6
// repeated covers produced worst-case last-three deltas of .160 grid luminance, .265 dark share and 38 dHash bits.
// Requiring all four limits against all three newest tiles keeps one different photograph from hiding one template.
export const GRID_SIMILARITY_THRESHOLDS = Object.freeze({ gridMean: 0.16, darkRatio: 0.27, textArea: 0.055, dHash: 38 });

const verdict = (checks) => checks.some((check) => check.verdict === "hold") ? "hold" : checks.some((check) => check.verdict === "retry") ? "retry" : "schedule";
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const round = (value, places = 4) => { const scale = 10 ** places; return Math.round(value * scale) / scale; };

export function cropPng(png, crop = profileCrop(png.width, png.height)) {
  const out = new PNG({ width: crop.w, height: crop.h });
  for (let y = 0; y < crop.h; y++) {
    const from = ((crop.y + y) * png.width + crop.x) * 4;
    png.data.copy(out.data, y * crop.w * 4, from, from + crop.w * 4);
  }
  return out;
}

function linePixels(line, width, height) {
  return { x: line.box.x * width, y: line.box.y * height, w: line.box.w * width, h: line.box.h * height };
}

/** Every OCR line must clear all four visible crop edges by the requested padding. */
export function cropTextIssues(ocr, crop = profileCrop(ocr.width, ocr.height), padding = 12) {
  const issues = [];
  for (const line of ocr.lines || []) {
    const box = linePixels(line, ocr.width, ocr.height);
    const right = box.x + box.w, bottom = box.y + box.h;
    const edges = [];
    if (box.x <= crop.x + padding) edges.push("left");
    if (right >= crop.x + crop.w - padding) edges.push("right");
    if (box.y <= crop.y + padding) edges.push("top");
    if (bottom >= crop.y + crop.h - padding) edges.push("bottom");
    if (edges.length) issues.push({ text: line.text, edges, box });
  }
  return issues;
}

function cellLuminance(png, x0, y0, x1, y1) {
  let total = 0, count = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const at = (y * png.width + x) * 4;
    total += relativeLuminance({ r: png.data[at], g: png.data[at + 1], b: png.data[at + 2] });
    count++;
  }
  return count ? total / count : 0;
}

function textAreaRatio(ocr, crop) {
  if (!ocr) return null;
  let area = 0;
  for (const line of ocr.lines || []) {
    const box = linePixels(line, ocr.width, ocr.height);
    const w = Math.max(0, Math.min(box.x + box.w, crop.x + crop.w) - Math.max(box.x, crop.x));
    const h = Math.max(0, Math.min(box.y + box.h, crop.y + crop.h) - Math.max(box.y, crop.y));
    area += w * h;
  }
  return Math.min(1, area / (crop.w * crop.h));
}

/** Cheap layout signature over the exact 3:4 crop: 6x8 luminance, darkness, OCR area and dHash. */
export function layoutSignature(png, { ocr = null, crop = profileCrop(png.width, png.height) } = {}) {
  const clipped = cropPng(png, crop), luminance = [];
  for (let row = 0; row < 8; row++) for (let column = 0; column < 6; column++) {
    const x0 = Math.floor(column * clipped.width / 6), x1 = Math.floor((column + 1) * clipped.width / 6);
    const y0 = Math.floor(row * clipped.height / 8), y1 = Math.floor((row + 1) * clipped.height / 8);
    luminance.push(round(cellLuminance(clipped, x0, y0, x1, y1)));
  }
  let dark = 0;
  for (let at = 0; at < clipped.data.length; at += 4) {
    if (relativeLuminance({ r: clipped.data[at], g: clipped.data[at + 1], b: clipped.data[at + 2] }) < 0.22) dark++;
  }
  return {
    luminance,
    darkPixelRatio: round(dark / (clipped.width * clipped.height)),
    textAreaRatio: ocr ? round(textAreaRatio(ocr, crop)) : null,
    dHash: differenceHash(clipped),
  };
}

export function compareLayoutSignatures(candidate, recent, thresholds = GRID_SIMILARITY_THRESHOLDS) {
  const gridMean = mean(candidate.luminance.map((value, index) => Math.abs(value - recent.luminance[index])));
  const darkRatio = Math.abs(candidate.darkPixelRatio - recent.darkPixelRatio);
  const textArea = candidate.textAreaRatio == null || recent.textAreaRatio == null ? null : Math.abs(candidate.textAreaRatio - recent.textAreaRatio);
  const dHash = hammingDistance(candidate.dHash, recent.dHash);
  const near = gridMean <= thresholds.gridMean && darkRatio <= thresholds.darkRatio && dHash <= thresholds.dHash && (textArea == null || textArea <= thresholds.textArea);
  return { near, gridMean: round(gridMean), darkRatio: round(darkRatio), textArea: textArea == null ? null : round(textArea), dHash };
}

export function repeatedLayout(candidate, recent = [], thresholds = GRID_SIMILARITY_THRESHOLDS) {
  const comparisons = recent.slice(0, 3).map((signature) => compareLayoutSignatures(candidate, signature, thresholds));
  return { repeated: comparisons.length === 3 && comparisons.every((item) => item.near), comparisons };
}

function decodePng(file, { allowFixtureSizes = false } = {}) {
  if (!file || !fs.existsSync(file)) throw new Error(`image not found: ${file || "(missing path)"}`);
  const png = PNG.sync.read(fs.readFileSync(file));
  if (!allowFixtureSizes && (png.width !== 1080 || ![1350, 1920].includes(png.height))) throw new Error(`${file} is ${png.width}x${png.height}; expected 1080x1350 or 1080x1920`);
  return png;
}

async function readOcr(file, index, binary, options) {
  if (Array.isArray(options.ocrResults) && index < options.ocrResults.length) {
    const supplied = options.ocrResults[index];
    if (supplied == null) return null;
    if (supplied instanceof Error) throw supplied;
    return parseOcrJSON(supplied);
  }
  if (typeof options.analyzeImage === "function") return parseOcrJSON(await options.analyzeImage(file, index));
  if (!binary) return null;
  const result = await run(binary, [file], { capture: true });
  return parseOcrJSON(result.out);
}

/** Fail-closed grid gate. OCR stand-ins and small pure signatures keep unit tests independent of Apple Vision. */
export async function gridCheck({ newFile, recentFiles = [], options = {} }) {
  const files = [newFile, ...recentFiles.slice(0, 11)], notes = [], checks = [];
  const decoded = [];
  for (const file of files) {
    try { decoded.push(decodePng(file, options)); }
    catch (error) { checks.push({ code: "images", verdict: "hold", notes: [error.message] }); return { verdict: "hold", checks, notes }; }
  }
  checks.push({ code: "images", verdict: "schedule", notes: [`read ${decoded.length} tile${decoded.length === 1 ? "" : "s"}`] });

  const injected = Array.isArray(options.ocrResults) || typeof options.analyzeImage === "function";
  const binary = injected ? null : await ocrBinary();
  if (!injected && !binary) {
    checks.push({ code: "ocr", verdict: "hold", notes: ["Apple Vision OCR is unavailable"] });
    return { verdict: "hold", checks, notes };
  }

  const ocr = [];
  try {
    ocr[0] = await readOcr(newFile, 0, binary, options);
    if (!ocr[0]) throw new Error("OCR returned no result for the new tile");
    if (ocr[0].width !== decoded[0].width || ocr[0].height !== decoded[0].height) throw new Error(`OCR image size is ${ocr[0].width}x${ocr[0].height}; PNG is ${decoded[0].width}x${decoded[0].height}`);
  } catch (error) {
    checks.push({ code: "ocr", verdict: "hold", notes: [`new tile OCR could not run: ${error.message}`] });
    return { verdict: "hold", checks, notes };
  }
  for (let index = 1; index < files.length; index++) {
    try { ocr[index] = await readOcr(files[index], index, binary, options); }
    catch (error) { ocr[index] = null; notes.push(`recent tile ${index} OCR unavailable; sameness used image structure only: ${error.message}`); }
  }
  checks.push({ code: "ocr", verdict: "schedule", notes: ["new tile OCR completed"] });

  const crop = profileCrop(decoded[0].width, decoded[0].height), cropIssues = cropTextIssues(ocr[0], crop);
  checks.push(cropIssues.length
    ? { code: "crop", verdict: "retry", fix: "recrop", notes: cropIssues.map((item) => `text "${item.text}" reaches the ${item.edges.join("/")} crop edge`) }
    : { code: "crop", verdict: "schedule", notes: [`text clears the 3:4 crop (${crop.x},${crop.y} ${crop.w}x${crop.h})`] });

  const signatures = decoded.map((png, index) => layoutSignature(png, { ocr: ocr[index] || null }));
  const repeat = repeatedLayout(signatures[0], signatures.slice(1));
  checks.push(repeat.repeated
    ? { code: "sameness", verdict: "retry", fix: "relayout", notes: ["new tile is near-identical to each of the three most recent tiles"], comparisons: repeat.comparisons }
    : { code: "sameness", verdict: "schedule", notes: [recentFiles.length < 3 ? "fewer than three recent tiles; no repeated run" : "new tile differs from at least one of the three most recent tiles"], comparisons: repeat.comparisons });

  return { verdict: verdict(checks), checks, notes };
}
