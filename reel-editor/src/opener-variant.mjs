import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { buildProject } from "./pipeline.mjs";
import { readJSON, run, writeJSON } from "./util.mjs";

const IMAGES = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic"]);
const VIDEOS = new Set([".mp4", ".mov"]);
const OLD_OUTPUTS = new Set([
  "renders", "gate.json", "gate.txt", "textcheck.json", "textcheck.txt",
  "preflight.json", "preflight.txt", "watch.json", "master-check.json", "master-check.txt",
]);

/** `file` is the path to the opener media, relative to the project or absolute. */
export function withProofOpener(plan, { file, duration = 2.0 }) {
  const ext = path.extname(file).toLowerCase();
  const kind = IMAGES.has(ext) ? "image" : VIDEOS.has(ext) ? "video" : null;
  if (!kind) throw new Error(`Unsupported proof opener file type (${ext || "no extension"}). Use PNG, JPG, JPEG, WebP, HEIC, MP4 or MOV.`);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Opener seconds must be a positive number.");
  return { ...structuredClone(plan), name: `${plan.name}-proof-first`, opener: { src: file, kind, duration } };
}

export async function makeProofFirst(workDir, file, { duration, deps = {} } = {}) {
  const source = path.resolve(workDir);
  const dest = `${source}-proof-first`;
  const plan = withProofOpener(readJSON(path.join(source, "plan.json")), { file, duration });
  const proof = path.resolve(file);
  if (!fs.statSync(proof, { throwIfNoEntry: false })?.isFile()) throw new Error(`Proof opener file not found: ${proof}`);
  const ext = path.extname(proof).toLowerCase();
  const mediaExt = plan.opener.kind === "video" ? ".mp4" : ext === ".heic" ? ".png" : ext;
  plan.opener.src = `assets/proof-opener/source${mediaExt}`;
  const staged = path.join(dest, "project", plan.opener.src);

  try {
    fs.mkdirSync(dest);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Proof-first job already exists: ${dest}`);
    throw error;
  }
  try {
    fs.cpSync(source, dest, { recursive: true, dereference: true, filter: (entry) => !OLD_OUTPUTS.has(path.relative(source, entry)) });
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    const runMedia = deps.run || run;
    if (plan.opener.kind === "video") {
      const seconds = String(plan.opener.duration);
      // Use a browser-compatible, silent clip. Hold the last frame when the source ends before the cut.
      await runMedia("ffmpeg", [
        "-y", "-v", "error", "-i", proof, "-map", "0:v:0", "-an",
        "-vf", `pad=ceil(iw/2)*2:ceil(ih/2)*2,tpad=stop_mode=clone:stop_duration=${seconds}`,
        "-t", seconds, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", staged,
      ], { capture: true });
    } else if (ext === ".heic") {
      await runMedia("sips", ["-s", "format", "png", proof, "--out", staged], { capture: true });
    } else {
      fs.copyFileSync(proof, staged);
    }
    writeJSON(path.join(dest, "plan.json"), plan);
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw error;
  }

  const result = await (deps.buildProject || buildProject)(dest, {}, deps);
  // The normal checks can repair a reel. A repair that changes the edit breaks the matched trial.
  const { masterOutput: _originalPath, ...expected } = plan;
  const { masterOutput: _variantPath, ...built } = readJSON(path.join(dest, "plan.json"));
  if (!isDeepStrictEqual(built, expected)) throw new Error(`Proof-first checks changed the matched edit. Review the reports in ${dest}.`);
  return result;
}
