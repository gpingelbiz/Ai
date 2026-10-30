import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { swiftTool } from "./photos.mjs";
import { ensureDir, run, warn } from "./util.mjs";

const GRADES = new Set(["none", "muted-editorial", "bw", "warm"]);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values) {
  const sorted = values.map(finite).filter((value) => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** One carousel target: the median face when available, otherwise the median frame, kept in its safe band. */
export function chooseTargetLuma(reports) {
  const faces = reports.map((report) => finite(report?.faceLuma)).filter((value) => value != null);
  if (faces.length) return Math.round(clamp(median(faces), 0.38, 0.62) * 10000) / 10000;
  const frames = reports.map((report) => finite(report?.medianLuma)).filter((value) => value != null);
  const value = median(frames);
  return value == null ? 0.45 : Math.round(clamp(value, 0.36, 0.54) * 10000) / 10000;
}

/** Brand grain is a design amount (0..1). 0.08 maps to 0.022 actual monochrome noise; output is capped at 0.03. */
export function grainStrength(brandGrain) {
  const mapped = Math.round(clamp(Number(brandGrain) || 0, 0, 1) * 0.275 * 10000) / 10000;
  return Math.min(0.03, mapped);
}

function numberOption(value, name, low, high, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < low || number > high) throw new Error(`${name} must be ${low} to ${high}`);
  return number;
}

/** Pure CLI parsing, shared by the command and its unit tests. */
export function parsePhotoFinishArgs(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      "out-dir": { type: "string" },
      grade: { type: "string" },
      intensity: { type: "string" },
      grain: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const grade = values.grade || "none";
  if (!GRADES.has(grade)) throw new Error("--grade is none, muted-editorial, bw or warm");
  return {
    files: positionals,
    outDir: values["out-dir"] || "",
    grade,
    intensity: numberOption(values.intensity, "--intensity", 0, 1, 1),
    grain: numberOption(values.grain, "--grain", 0, 0.03, 0),
    json: !!values.json,
    help: !!values.help,
  };
}

export function parsePhotoScoreArgs(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  return { files: positionals, json: !!values.json, help: !!values.help };
}

export function photoScoreRows(reports) {
  return reports.map((report) => ({
    file: report.file,
    overall: finite(report.aesthetic ?? report.overallScore),
    utility: !!(report.utility ?? report.isUtility),
    faceCount: Array.isArray(report.faces) ? report.faces.length : 0,
    sharpness: finite(report.sharp),
    luma: finite(report.light),
  }));
}

function reportStats(report) {
  return {
    medianLuma: finite(report?.medianLuma),
    faceLuma: finite(report?.faceLuma),
    saturation: finite(report?.saturation),
    clippedPercent: finite(report?.clippedPercent),
    faceBoxes: Array.isArray(report?.faceBoxes) ? report.faceBoxes : [],
  };
}

function parseReport(text) {
  const lines = String(text || "").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  throw new Error("photofinish did not return its analysis JSON");
}

function outputPaths(files, outDir, extension) {
  const seen = new Map();
  return files.map((file) => {
    const ext = path.extname(file);
    const stem = path.basename(file, ext) || "photo";
    const key = `${stem.toLowerCase()}${extension.toLowerCase()}`;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    let output = path.join(outDir, `${stem}${count > 1 ? `-${count}` : ""}${extension}`);
    if (path.resolve(output) === path.resolve(file)) output = path.join(outDir, `${stem}-finished${extension}`);
    return output;
  });
}

function originalOutputs(files, outDir) {
  const seen = new Map();
  return files.map((file) => {
    const ext = path.extname(file) || ".img";
    const stem = path.basename(file, path.extname(file)) || "photo";
    const key = `${stem.toLowerCase()}${ext.toLowerCase()}`;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    let output = path.join(outDir, `${stem}${count > 1 ? `-${count}` : ""}${ext}`);
    if (path.resolve(output) === path.resolve(file)) output = path.join(outDir, `${stem}-original${ext}`);
    return output;
  });
}

function copyThrough(files, outDir, reason) {
  const outputs = originalOutputs(files, outDir);
  outputs.forEach((output, index) => fs.copyFileSync(files[index], output));
  return {
    outputs,
    targetLuma: null,
    fallback: true,
    photos: files.map((input, index) => ({ input, output: outputs[index], before: null, after: null, rejected: false, reason })),
  };
}

/** Finish a carousel as one set. Any missing or failed Swift tool produces one warning and byte copies every source. */
export async function finishPhotoSet(files, {
  outDir,
  grade = "none",
  intensity = 1,
  grain = 0,
  targetLuma = null,
  resolveBinary = () => swiftTool("photofinish"),
  execute = run,
  warning = warn,
} = {}) {
  if (!files.length) return { outputs: [], targetLuma: null, fallback: false, photos: [] };
  if (!outDir) throw new Error("photo finishing needs an output directory");
  if (!GRADES.has(grade)) throw new Error("photo grade is none, muted-editorial, bw or warm");
  intensity = numberOption(intensity, "intensity", 0, 1, 1);
  grain = numberOption(grain, "grain", 0, 0.03, 0);
  ensureDir(outDir);
  let binary;
  try { binary = await resolveBinary(); } catch {}
  if (!binary) {
    const reason = "the photo finisher is unavailable; copied the originals";
    warning(reason);
    return copyThrough(files, outDir, reason);
  }

  const outputs = outputPaths(files, outDir, ".jpg");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "reel-photofinish-"));
  try {
    const before = [];
    for (let i = 0; i < files.length; i++) {
      const analyzed = path.join(scratch, `${i + 1}.jpg`);
      const { out } = await execute(binary, [files[i], analyzed, "--grade", "none", "--intensity", "0", "--grain", "0", "--analyze"], { capture: true });
      before.push(parseReport(out));
    }
    const sharedTarget = targetLuma == null ? chooseTargetLuma(before) : numberOption(targetLuma, "target luma", 0, 1, 0.45);
    const photos = [];
    for (let i = 0; i < files.length; i++) {
      const args = [files[i], outputs[i], "--grade", grade, "--intensity", String(intensity), "--grain", String(grain), "--target-luma", String(sharedTarget), "--analyze"];
      const { out } = await execute(binary, args, { capture: true });
      const report = parseReport(out);
      photos.push({
        input: files[i], output: outputs[i], before: reportStats(report), after: reportStats(report.after),
        rejected: !!report.rejected, reason: String(report.reason || ""),
      });
    }
    return { outputs, targetLuma: sharedTarget, fallback: false, photos };
  } catch (error) {
    for (const output of outputs) { try { fs.rmSync(output, { force: true }); } catch {} }
    const reason = `the photo finisher failed (${error.message}); copied the originals`;
    warning(reason);
    return copyThrough(files, outDir, reason);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
