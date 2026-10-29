import fs from "node:fs";
import path from "node:path";
import { runEdit } from "./pipeline.mjs";
import { descriptionText, srtText, v3Timeline, thumbnailFrames, endScreenPlan, fmt } from "./chapters.mjs";
import { personBinary } from "./cover.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, r3 } from "./util.mjs";

// Kept here as the long-form public surface; the scheduler itself is shared with reel credential planning.
export { youtubeReshowStarts } from "./credentials.mjs";

/**
 * A whole video for YouTube: the normal edit with the `youtube` preset (16:9, chapters with title cards, re-hooks,
 * sparse cards and b-roll, 112% punch-ins, no burned-in captions, a clean last 20 s), then the package: the
 * description with the chapter block, title options, captions.srt, three thumbnail frames, the end-screen plan,
 * a pinned comment, and auto-editor's v3 timeline so a human can finish in Resolve or Premiere.
 */
export async function makeYouTube(input, opts = {}) {
  // REEL_YOUTUBE_PRESET: a brand kit's own YouTube look (its name tag, colors and fonts on the youtube preset).
  const r = await runEdit(input, { ...opts, preset: opts.preset || process.env.REEL_YOUTUBE_PRESET || "youtube" });
  const { workDir, plan, output } = r;
  if (!output) return r;
  const pkg = await packageYouTube(workDir, plan, output);
  return { ...r, package: pkg };
}

export async function packageYouTube(workDir, plan, output) {
  const dir = ensureDir(path.join(workDir, "youtube"));
  const duration = plan.video.duration;
  const structure = plan.structure || { promise: "", chapters: [], rehooks: [], titles: [], description: "", hashtags: [], pinned: "" };
  const files = {};
  // Description with the chapter block (0:00 first, >= 3, >= 10 s) and the hashtags.
  files.description = path.join(dir, "description.txt");
  fs.writeFileSync(files.description, descriptionText(structure, { duration, booking: plan.style?.youtube?.booking || "" }));
  // Titles: the structure's three, else the hook.
  files.titles = path.join(dir, "titles.txt");
  const titles = structure.titles.length ? structure.titles : [plan.hook?.text || plan.name];
  fs.writeFileSync(files.titles, titles.map((t, i) => `${i + 1}. ${t}`).join("\n") + "\n");
  // Captions for the CC track, from the caption lines (burned in or not, the words are timed in the finished video).
  files.srt = path.join(dir, "captions.srt");
  fs.writeFileSync(files.srt, srtText(plan.lines || plan.captions || []));
  // Pinned comment.
  if (structure.pinned) { files.pinned = path.join(dir, "pinned_comment.txt"); fs.writeFileSync(files.pinned, structure.pinned + "\n"); }
  // End screen plan.
  files.endscreen = path.join(dir, "endscreen.json");
  writeJSON(files.endscreen, endScreenPlan(duration, { seconds: plan.style?.youtube?.endSafe || 20 }));
  // The cut list, for a human.
  try {
    const cuts = readJSON(path.join(workDir, "cuts.json"));
    files.v3 = path.join(dir, "edit.v3.json");
    writeJSON(files.v3, v3Timeline(cuts.segments || [], { source: plan.source, fps: plan.video.fps || 30, width: plan.canvas.width, height: plan.canvas.height }));
  } catch (e) { warn(`edit.v3.json skipped: ${String(e.message).split("\n")[0]}`); }
  // Thumbnails: three clean best frames.
  try {
    files.thumbnails = await thumbnailFrames(output, duration, path.join(dir, "thumbnails"), { count: 3, personBinary });
  } catch (e) { warn(`thumbnails skipped: ${String(e.message).split("\n")[0]}`); }
  // A one-page summary.
  files.summary = path.join(dir, "youtube.txt");
  fs.writeFileSync(files.summary, [
    `Length ${fmt(duration)} (${Math.round(duration)} s)`,
    `Hook on screen: ${plan.hook?.text || "(none)"}`,
    structure.chapters.length ? `Chapters: ${structure.chapters.length} (${structure.chapters.map((c) => `${fmt(c.start)} ${c.title}`).join(" | ")})` : "Chapters: none (fewer than 3 real topic changes)",
    `Re-hooks: ${structure.rehooks.length}${structure.rehooks.length ? " at " + structure.rehooks.map((h) => fmt(h.start)).join(", ") : ""}`,
    `Cards: ${(plan.graphics || []).length}, stills: ${(plan.broll || []).length}, callouts: ${(plan.slams || []).length}, punch-ins: ${(plan.zooms || []).filter((z) => z.scale > 1 && !z.cut).length}, jump cuts: ${(plan.zooms || []).filter((z) => z.cut).length}`,
    `End screen: last ${plan.style?.youtube?.endSafe || 20} s kept clean (set it in Studio from ${fmt(Math.max(0, duration - (plan.style?.youtube?.endSafe || 20)))})`,
    "Upload: description.txt (chapters inside), captions.srt as the CC track, one of thumbnails/, a title from titles.txt, pinned_comment.txt.",
    "",
  ].join("\n"));
  log(`youtube: package in ${dir} (${Object.keys(files).length} parts)`);
  return { dir, files };
}
