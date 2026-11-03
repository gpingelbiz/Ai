import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkRunwayVideo } from "./broll-runway.mjs";
import { saveLibraryClip } from "./broll-library.mjs";
import { PKG_ROOT, readJSON, writeJSON, run, log, warn, ensureDir } from "./util.mjs";

export const LOCALGEN_LICENCE = { provider: "localgen", model: "FastMetal-5B", licence: "Apache-2.0" };
export const BROLL_GENERATE_HELP = `Usage: reel broll-generate --prompts <file> [--dry-run]
  --prompts <file>  JSON array of { id, prompt, shows, scene, action, seed }
  --dry-run         validate and print the local queue; no processes or writes
  REEL_LOCALGEN_HOME defaults to ~/localgen; run this command ON the Mini.
  Installation requires separate download approval; see tools/localgen/PLAN.md.
`;

export function localgenPrompts(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("prompts must be a nonempty JSON array");
  const ids = new Set();
  return value.map((p) => {
    if (!p || ["id", "prompt", "shows", "scene", "action"].some((k) => typeof p[k] !== "string" || !p[k].trim())) throw new Error("each prompt needs id, prompt, shows, scene and action");
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.id) || ids.has(p.id)) throw new Error("prompt ids must be unique lowercase slugs");
    if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 0xffffffff) throw new Error("each prompt needs a uint32 seed");
    ids.add(p.id);
    return { id: p.id, prompt: p.prompt, shows: p.shows, scene: p.scene, action: p.action, seed: p.seed };
  });
}

/** Generate serially on this machine, then admit only inspected full clips. Keep failed candidates for review. */
export async function generateBrollLibrary({ promptsFile, dryRun = false, deps = {} } = {}) {
  if (!promptsFile) throw new Error("broll-generate needs --prompts <file>");
  const prompts = localgenPrompts(readJSON(promptsFile)), env = deps.env || process.env;
  const logger = deps.logFn || log, warning = deps.warnFn || warn, runner = deps.runFn || run;
  const home = path.resolve(env.REEL_LOCALGEN_HOME || path.join(os.homedir(), "localgen"));
  for (const p of prompts) logger(`broll-generate: ${p.id}: seed ${p.seed}: ${p.prompt}`);
  if (dryRun) return { dryRun: true, prompts, approved: [] };
  const dir = fs.mkdtempSync(path.join(ensureDir(path.join(home, "outputs")), "batch-"));
  const queue = path.join(dir, "prompts.json");
  writeJSON(queue, prompts);
  await runner(path.join(home, ".venv", "bin", "python"), [path.join(PKG_ROOT, "tools", "localgen", "generate.py"), "--prompts", queue, "--out", dir, "--home", home], { env });
  const generated = readJSON(path.join(dir, "results.json"));
  if (!Array.isArray(generated) || generated.length !== prompts.length || new Set(generated.map((r) => r.id)).size !== prompts.length || generated.some((r) => !prompts.some((p) => p.id === r.id))) throw new Error("invalid local generation results");
  const approved = [], results = [];
  for (const p of prompts) {
    const result = generated.find((r) => r.id === p.id), file = path.join(dir, `${p.id}.mp4`);
    try {
      if (result.ok !== true || result.file !== file || !fs.statSync(file).size) throw new Error("generation failed or output missing");
      const probe = await runner("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { capture: true, env });
      const info = JSON.parse(probe.out), duration = Number(info.format?.duration), stream = info.streams?.[0];
      if (!Number.isFinite(duration) || duration < 2 || duration > 3.5 || !(stream?.height > stream?.width) || stream.width < 704) throw new Error("output must be a 2–3.5 second portrait video at least 704 pixels wide");
      const text = `${p.shows}. ${p.action}`, pick = { ...p, kind: "action", line: 0 };
      const shot = { line: 0, start: 0, duration, text, shows: p.shows, scene: p.scene };
      const moves = await (deps.checkRunwayVideo || checkRunwayVideo)({ file, shot, pick, groups: [{ start: 0, text }], dir, deps });
      if (moves?.ok !== true || moves.look !== "pass" || moves.shows !== true || moves.action !== true || moves.unavailable) throw new Error(moves?.why || "clip inspection rejected or unavailable");
      const clip = (deps.saveLibraryClip || saveLibraryClip)({ shot: { ...shot, file, video: true, moves }, pick, duration, workDir: dir, source: "localgen", licence: { ...LOCALGEN_LICENCE }, recordUse: false, env });
      if (!clip) throw new Error("library did not accept the clip");
      approved.push(clip);
      results.push({ id: p.id, approved: true, libraryId: clip.id });
      logger(`broll-generate: ${p.id}: approved and saved`);
    } catch (e) {
      const reason = String(e.message).split("\n")[0];
      results.push({ id: p.id, approved: false, reason });
      warning(`broll-generate: ${p.id}: ${reason}`);
    }
  }
  writeJSON(path.join(dir, "admission.json"), results);
  logger(`broll-generate: ${approved.length}/${prompts.length} approved; evidence: ${dir}`);
  return { approved, results, dir };
}
