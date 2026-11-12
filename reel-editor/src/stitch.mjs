import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runEdit } from "./pipeline.mjs";
import { loadPreset, mergeOverrides, loadDictionary } from "./presets.mjs";
import { recordOrder, clipFiles, explicitOrder, stitchVideo } from "./stitch-order.mjs";
import { sourceCacheKey } from "./speaker-index.mjs";
import { indexStitch } from "./stitch-index.mjs";
import { planStitch, stitchScenes } from "./stitch-plan.mjs";
import { compileStitch } from "./stitch-master.mjs";
import { writeStitchPreview } from "./stitch-preview.mjs";
import { ensureDir, writeJSON, readJSON, slug, log } from "./util.mjs";

export async function stitchInputs(inputs, opts = {}) {
  if (!inputs.length) throw new Error("Choose a reel folder or the clips to stitch.");
  inputs = inputs.map((f) => path.resolve(f));
  const isFolder = inputs.length === 1 && fs.statSync(inputs[0]).isDirectory();
  const folder = isFolder ? inputs[0] : path.dirname(inputs[0]);
  let files = isFolder ? clipFiles(folder) : inputs;
  if (!files.length || files.some((f) => !stitchVideo(f) || !fs.statSync(f).isFile()) || new Set(files).size !== files.length) throw new Error("Choose readable video clips, each listed once.");
  if (opts.order) {
    const order = path.resolve(opts.order);
    files = explicitOrder(files, readJSON(order), path.dirname(order));
  } else if (isFolder) {
    const ledger = await recordOrder(folder, opts.orderDeps);
    files = ledger.clips.map((c) => path.join(folder, c.name));
  }
  return { folder, files, name: isFolder ? path.basename(folder) : path.basename(files[0], path.extname(files[0])) };
}

/** A watched job may only use the exact settled copy the scanner admitted. */
export function verifyStitchSnapshot(files, manifest) {
  if (!manifest) return;
  const ready = readJSON(manifest);
  const matches = ready.clips.length === files.length && ready.clips.every((c, i) => {
    if (c.file !== files[i] || !fs.existsSync(c.file)) return false;
    const st = fs.statSync(c.file);
    return st.size === c.size && st.mtimeMs === c.mtimeMs && sourceCacheKey(c.file) === c.key;
  });
  if (!matches) { const error = new Error("The clips changed while this reel was being prepared. Editing will start after they settle."); error.code = "STITCH_CHANGED"; throw error; }
}

/** The CLI delivers too; watcher jobs use their established caption and delivery pass with noDeliver. */
export function deliverStitch(result, folder, { root = process.env.REEL_WATCH_ROOT || path.join(os.homedir(), "Reels"), done = process.env.REEL_WATCH_DONE || path.join(os.homedir(), "Desktop/Reels"), day = new Date().toLocaleDateString("en-CA") } = {}) {
  ensureDir(done); ensureDir(path.join(root, "videos"));
  const count = path.join(root, "videos", `stitch-count-${day}`);
  let n = fs.existsSync(count) ? Number(fs.readFileSync(count, "utf8")) + 1 : 1;
  let dest;
  for (;;) {
    dest = path.join(done, `${day} Stitch ${n}`);
    try { fs.mkdirSync(dest); break; } catch (e) { if (e.code !== "EEXIST") throw e; n++; }
  }
  fs.writeFileSync(count, String(n));
  fs.copyFileSync(result.output, path.join(dest, `${result.plan?.name || "Stitch"}.mp4`));
  for (const name of ["Order.txt", "Order - check this.jpg"]) fs.copyFileSync(path.join(folder, name), path.join(dest, name));
  if (fs.existsSync(path.join(result.workDir, "caption.txt"))) fs.copyFileSync(path.join(result.workDir, "caption.txt"), path.join(dest, "caption.txt"));
  return dest;
}

export async function runStitch(inputs, opts = {}, deps = {}) {
  if (process.env.REEL_CLIENT_MODE === "1") throw new Error("Stitch clips is available on the editing Mac.");
  const intake = await stitchInputs(Array.isArray(inputs) ? inputs : [inputs], opts);
  const snapshot = process.env.REEL_WATCH_STITCH_READY;
  verifyStitchSnapshot(intake.files, snapshot);
  const name = slug(opts.title || `${intake.name}-stitch`), root = process.env.REEL_WATCH_ROOT || path.join(os.homedir(), "Reels");
  const workDir = ensureDir(path.resolve(opts.out || path.join(root, "videos", name))), dir = ensureDir(path.join(workDir, "stitch"));
  const preset = mergeOverrides(loadPreset(opts.preset), opts), dict = loadDictionary(opts.dictionary);
  const settings = { ...preset.transcribe, prompt: (dict.terms || []).slice(0, 40).join(", ") };
  const hold = (messages) => {
    fs.writeFileSync(path.join(intake.folder, "why it's held.txt"), messages.join("\n") + "\n");
    const error = new Error(messages.join(" ")); error.code = "STITCH_HELD"; throw error;
  };
  let index;
  try { index = await (deps.index || indexStitch)(intake.files, dir, settings, deps); }
  catch (error) { writeJSON(path.join(dir, "index-error.json"), { clip: error.clip, message: error.message }); hold([`${error.clip ? path.basename(error.clip) : "A clip"} could not be read or checked. Check that it plays on this Mac. See the stitch work folder for details.`]); }
  verifyStitchSnapshot(intake.files, snapshot);
  const timeline = planStitch(index);
  writeJSON(path.join(dir, "timeline.json"), timeline);
  if (timeline.held.length) hold(timeline.held);
  fs.rmSync(path.join(intake.folder, "why it's held.txt"), { force: true });
  await (deps.preview || writeStitchPreview)(index, timeline, intake.folder, dir, deps);
  log(`stitch: ${intake.files.length} clips, ${timeline.segments.length} segments, ${timeline.frames} frames`);
  const master = await (deps.compile || compileStitch)(timeline, index, dir, deps);
  verifyStitchSnapshot(intake.files, snapshot);
  const scenes = path.join(dir, "scenes.json");
  writeJSON(scenes, stitchScenes(timeline));
  // This is a fresh transcript of the master. Per-clip words only decide source trims and the order sheet.
  const result = await (deps.edit || runEdit)(master, { ...opts, title: name, out: workDir, fps: 30, scenes });
  if (result.output && !opts.noDeliver) result.delivery = (deps.deliver || deliverStitch)(result, intake.folder);
  return { ...result, timeline, scenes, master };
}
