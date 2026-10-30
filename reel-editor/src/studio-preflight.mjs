import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeJSON } from "./util.mjs";

const unavailable = (message, files = []) => ({
  verdict: "hold",
  slides: [{ index: -1, file: files[0] || "", problems: [{ code: "preflight-unavailable", message, fix: "none" }] }],
  photoHashes: [],
});

async function sharedPreflight(args) {
  const module = await import("./preflight.mjs");
  if (typeof module.preflightSlides !== "function") throw new Error("the shared slide preflight is not available");
  return module.preflightSlides(args);
}

/** The shared gate, injectable in tests. Any missing or malformed check fails closed as a local hold. */
export async function runStudioPreflight(args, preflight = sharedPreflight) {
  try {
    const result = await preflight(args);
    if (!["schedule", "retry", "hold"].includes(result?.verdict) || !Array.isArray(result?.slides) || !Array.isArray(result?.photoHashes)) {
      throw new Error("the shared slide preflight returned an invalid result");
    }
    return result;
  } catch (error) {
    return unavailable(`Preflight could not run: ${String(error?.message || error)}`, args.files);
  }
}

export const preflightProblems = (result) => (result?.slides || []).flatMap((slide) => (slide.problems || []).map((problem) => ({
  index: Number(slide.index),
  file: slide.file || "",
  code: problem.code || "preflight",
  message: problem.message || "The rendered slide did not pass preflight.",
  fix: problem.fix || "none",
})));

export function readPhotoHistory(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return { photos: Array.isArray(value?.photos) ? value.photos : [] };
  } catch {
    return { photos: [] };
  }
}

/** Append only hashes returned by a scheduled gate result. */
export function appendPhotoHistory(file, hashes, date) {
  const history = readPhotoHistory(file);
  for (const item of hashes || []) {
    if (!item?.file || !item?.hash) continue;
    history.photos.push({ hash: item.hash, file: item.file, date });
  }
  writeJSON(file, history);
  return history;
}

/** The local report is the only Made artifact for a held slot, so the next run still sees the slot as open. */
export function writeHeldReport(madeDir, slot, result) {
  ensureDir(madeDir);
  const file = path.join(madeDir, `${slot.day}-${slot.time.replace(/:/g, ".")}-HELD.md`);
  const problems = preflightProblems(result);
  const lines = [
    `# Held: ${slot.day} ${slot.time} ${slot.format}`,
    "",
    ...problems.map((problem) => `${problem.index >= 0 ? `Slide ${problem.index + 1}: ` : ""}${problem.message}`),
  ];
  fs.writeFileSync(file, `${lines.join("\n").trim()}\n`);
  return file;
}
