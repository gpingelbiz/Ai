import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { conformStockClip } from "./broll-stock.mjs";
import { checkRunwayVideo } from "./broll-runway.mjs";
import { validTimeline } from "./broll-qc.mjs";
import { subjectWords } from "./broll.mjs";
import { libraryClipPath, libraryActionWords, actionWordMatch, readLibrary, saveLibraryClip } from "./broll-library.mjs";
import { PKG_ROOT, VIDEO_EXTS, readJSON, run, log } from "./util.mjs";

export const BROLL_ADD_HELP = `Usage: reel broll-add <file|folder>... [--shows <subject>] [--action <action>] [--scene <scene>] [--dry-run] [--note]
  Folders are searched recursively for video files. Metadata comes from <name>.json
  beside the video, or from a filename such as "coconut - drops onto sand.mov".
  --shows/--action/--scene  override metadata for a single video only
  --note                  write an approved/rejected result beside each input
  --dry-run               list metadata without copying, conforming or checking
  Originals and working clips: REEL_BROLL_OWN (default: ~/Reels/B-roll library/own/)
  Import locates the subject/action; the exact used window is checked again per reel.
`;
export const BROLL_SHOTLIST_HELP = `Usage: reel broll-shotlist [--missing] [--client] [--html <file>]
  Print the starter shots grouped by world.
  --client   omit the house-only props group
  --html     save a printable shot list page
  --missing  only actions without an approved own clip present in the library
`;

export function ownClipMetadata(file, overrides = {}) {
  const name = path.basename(file, path.extname(file)), split = name.indexOf(" - ");
  const sidecar = path.join(path.dirname(file), `${name}.json`);
  const named = { shows: (split < 0 ? name : name.slice(0, split)).trim(), action: split < 0 ? "" : name.slice(split + 3).trim(), scene: "" };
  const supplied = fs.existsSync(sidecar) ? readJSON(sidecar) : {};
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("sidecar must be a metadata object");
  const metadata = { ...named, ...supplied, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) };
  for (const key of ["shows", "action", "scene"]) {
    if (typeof metadata[key] !== "string" || key === "shows" && !metadata[key].trim()) throw new Error(`metadata needs ${key} as ${key === "shows" ? "a nonempty string" : "a string"}`);
    metadata[key] = metadata[key].trim();
  }
  return { shows: metadata.shows, action: metadata.action, scene: metadata.scene };
}

export function ownVideoFiles(inputs) {
  const files = new Set();
  function visit(input) {
    const file = path.resolve(input), stat = fs.statSync(file);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(file, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() || entry.isFile()) visit(path.join(file, entry.name));
      }
    } else if (stat.isFile() && VIDEO_EXTS.has(path.extname(file).toLowerCase())) files.add(file);
  }
  inputs.forEach(visit);
  return [...files];
}

async function ownContentHash(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Approval happens in a temporary folder; neither a rejection nor a preview changes the bank. */
export async function addOwnBroll({ inputs = [], shows, action, scene, dryRun = false, note = false, deps = {} } = {}) {
  if (!inputs.length) throw new Error("broll-add needs at least one video file or folder");
  const files = ownVideoFiles(inputs), overrides = { shows, action, scene };
  if (!files.length) throw new Error("broll-add found no video files");
  if (files.length !== 1 && Object.values(overrides).some((v) => v !== undefined)) throw new Error("--shows, --action and --scene require a single video");
  const env = deps.env || process.env, logger = deps.logFn || log, approved = [], results = [];
  for (const file of files) {
    let dir, result;
    try {
      const metadata = ownClipMetadata(file, overrides);
      if (dryRun) result = { file, ...metadata, status: "dry-run", reason: "would import" };
      else {
        const contentHash = await ownContentHash(file);
        const existing = readLibrary(env).clips.find((c) => c.source === "own" && c.contentHash === contentHash);
        if (existing) result = { file, ...metadata, status: "duplicate", reason: `already imported (${existing.id})` };
        else {
          dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-broll-own-"));
          const working = path.join(dir, "working.mp4");
          await (deps.conformStockClip || conformStockClip)(file, working, { runFn: deps.runFn });
          const probe = await (deps.runFn || run)("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", working], { capture: true });
          const duration = Number(probe.out?.trim());
          if (!(duration > 0) || !Number.isFinite(duration)) throw new Error("clip duration unavailable");
          const pick = { ...metadata, kind: metadata.action ? "action" : "ambient", line: 0 };
          const shot = { ...metadata, line: 0, start: 0, duration, text: [metadata.shows, metadata.action].filter(Boolean).join(" ") };
          const inspected = await (deps.checkRunwayVideo || checkRunwayVideo)({ file: working, shot, pick, groups: [shot], dir, eventOnly: true, deps });
          if (inspected.unavailable || inspected.look !== "pass" || inspected.ok !== true || inspected.shows !== true || inspected.action !== true || !validTimeline(inspected, duration)) throw new Error(inspected.why || "full-source subject/action or timeline check failed");
          const sourceTimeline = Object.fromEntries(["eventType", "onset", "contact", "completion"].map((key) => [key, inspected[key]]));
          const clip = saveLibraryClip({ shot: { ...shot, file: working, video: true, moves: inspected, sourceTimeline }, pick, duration, originalFile: file, contentHash, source: "own", licence: { provider: "own", creator: "Clip owner" }, recordUse: false, env, now: (deps.now || Date.now)() });
          if (!clip) throw new Error("approved clip could not be saved");
          approved.push(clip);
          result = { file, ...metadata, status: "approved", id: clip.id, reason: "saved original and approved working clip" };
        }
      }
    } catch (e) { result = { file, status: "rejected", reason: String(e.message).split("\n")[0] }; }
    finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }); }
    results.push(result);
    if (note) fs.writeFileSync(`${file}.result.txt`, ownBrollResultNote(result));
    logger(`broll-add: ${file}: ${result.status}: ${result.reason}${result.shows ? `; shows=${JSON.stringify(result.shows)} action=${JSON.stringify(result.action)} scene=${JSON.stringify(result.scene)}` : ""}`);
  }
  return { approved, results };
}

/** A short import result beside a drop, including a duplicate that is already approved. */
export function ownBrollResultNote(result) {
  if (result.status === "approved") return "Approved: added to your B-roll library. Your original stays here.\n";
  if (result.status === "duplicate") return "Approved: this clip is already in your B-roll library. Your original stays here.\n";
  if (result.status === "dry-run") return "Preview only: nothing was added. Your original stays here.\n";
  return `Rejected: ${result.reason}. Your original stays here. Rename it to try again.\n`;
}

/** Printable on ordinary paper; every shot is a checkbox with its filming instructions. */
export function brollShotlistPage(worlds) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>B-roll shot list</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 20px;color:#111}h2{margin-top:28px}li{margin:12px 0;break-inside:avoid;list-style:none}ul{padding:0}.box{font-size:22px}@media print{body{margin:0;max-width:none}h2{break-after:avoid}}</style>
<h1>B-roll shot list</h1>
<p>Film each clip for 6 to 10 seconds, with the action in the middle. Keep faces out of the frame. Name each file <b>subject - action.mov</b> and drop it in <b>Desktop/Reels/Raw - My B-roll clips</b>. A result note appears beside it; your original stays there.</p>
${worlds.map((w) => `<section><h2>${esc(w.world)}</h2><ul>${w.shots.map((s) => `<li><span class="box">☐</span> <b>${esc(s.shows)} - ${esc(s.action)}</b><br>${esc(s.scene)}. ${esc(s.framing)}.<br>${esc(s.exclusion)}</li>`).join("\n")}</ul></section>`).join("\n")}
</html>\n`;
}

export function ownClipCovers(clip, shot) {
  const subject = subjectWords(shot.shows, shot.scene), action = libraryActionWords(shot.action), held = libraryActionWords(clip.action ?? clip.description);
  return clip.source === "own" && !!clip.approvedAt && subject.length > 0 && subject.every((w) => (clip.subjectWords || []).includes(w)) &&
    action.length > 0 && action.every((w) => held.some((t) => actionWordMatch(w, t)));
}

export function brollShotlist({ missing = false, client = false, html, deps = {} } = {}) {
  const env = deps.env || process.env, logger = deps.logFn || log;
  const worlds = readJSON(path.join(PKG_ROOT, "presets", "broll-shotlist.json"));
  const clips = missing ? readLibrary(env).clips.filter((c) => libraryClipPath(c, env) && fs.existsSync(libraryClipPath(c, env))) : [];
  // The jungle-reel props are house-specific and never appear on a client shot list.
  const result = worlds.filter((world) => !client || world.world !== "jungle-reel props").map((world) => ({ ...world, shots: world.shots.filter((shot) => !missing || !clips.some((clip) => ownClipCovers(clip, shot))) })).filter((world) => world.shots.length);
  if (html) fs.writeFileSync(html, brollShotlistPage(result));
  for (const world of result) {
    logger(`${world.world}:`);
    for (const shot of world.shots) logger(`  ${shot.shows} — ${shot.action}; ${shot.scene}; ${shot.framing}; Exclude: ${shot.exclusion}`);
  }
  if (!result.length) logger("broll-shotlist: all starter actions have an approved own clip");
  return result;
}
