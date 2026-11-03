import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkRunwayVideo, trimRunwayClip } from "./broll-runway.mjs";
import { checkPick, subjectWords, brollTestCache } from "./broll.mjs";
import { eventInPoint, momentInPoint, validTimeline } from "./broll-qc.mjs";
import { ensureDir, readJSON, writeJSON, sha1, warn } from "./util.mjs";

export const libraryDir = (env = process.env) => env.REEL_BROLL_LIBRARY || path.join(env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT ? brollTestCache() : env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "broll-library");
export const ownLibraryDir = (env = process.env) => env.REEL_BROLL_OWN || path.join(os.homedir(), "Reels", "B-roll library", "own");
export const libraryClipPath = (clip, env = process.env, field = "file") => clip[field] && (path.isAbsolute(clip[field]) ? clip[field] : path.join(clip.source === "own" ? ownLibraryDir(env) : libraryDir(env), clip[field]));
const indexFile = (env) => path.join(libraryDir(env), "index.json");
export function readLibrary(env = process.env) {
  try { const index = readJSON(indexFile(env)); if (!Array.isArray(index.clips) || !Array.isArray(index.reels)) throw new Error("invalid clip library"); return index; } catch { return { clips: [], reels: [] }; }
}
const reelId = (workDir) => path.resolve(workDir);
export const recentLibraryReels = (index, workDir) => new Set([...index.reels.filter((r) => r !== reelId(workDir)).slice(-10), reelId(workDir)]);
function registerReel(index, workDir) {
  const reel = reelId(workDir);
  if (!index.reels.includes(reel)) index.reels.push(reel);
  return reel;
}

/** Only approved moving sources enter the bank; a still is never a substitute for an approved clip. */
export function saveLibraryClip({ shot, pick, workDir, licence, source = shot.source || "runway", duration, originalFile, contentHash, recordUse = true, env = process.env, now = Date.now() }) {
  if (!shot.video || shot.moves?.ok !== true || shot.moves.look !== "pass") return null;
  const original = shot.full || shot.file;
  if (!original || !fs.existsSync(original)) return null;
  const index = readLibrary(env), reel = recordUse ? registerReel(index, workDir) : null, date = new Date(now).toISOString();
  const id = source === "own" && contentHash ? contentHash : licence?.provider && licence.id != null ? sha1(`${licence.provider}:${licence.id}`) : sha1(fs.readFileSync(original));
  const copied = [];
  try {
    let clip = index.clips.find((c) => c.id === id);
    if (!clip) {
      const own = source === "own", root = own ? ownLibraryDir(env) : libraryDir(env);
      const file = own ? path.join("clips", `${id}.mp4`) : path.join(root, `${id}.mp4`);
      const preserved = own && originalFile ? path.join("originals", `${id}${path.extname(originalFile).toLowerCase()}`) : undefined;
      const copy = (input, target) => {
        ensureDir(path.dirname(target));
        fs.copyFileSync(input, target, own ? fs.constants.COPYFILE_EXCL : 0);
        if (own) copied.push(target);
      };
      copy(original, own ? path.join(root, file) : file);
      if (preserved) copy(originalFile, path.join(root, preserved));
      clip = { id, shows: pick.shows, subjectWords: subjectWords(pick.shows, pick.scene), stockQuery: pick.stockQuery || "", scene: pick.scene, description: pick.action || shot.seen || "", source, licence, file, ...(own ? { originalFile: preserved, contentHash, action: pick.action } : {}), duration: duration ?? shot.sourceDuration ?? shot.duration, timeline: shot.sourceTimeline, approvedAt: date, usedIn: [] };
      index.clips.push(clip);
    }
    if (recordUse && !clip.usedIn.some((use) => use.reel === reel)) clip.usedIn.push({ reel, date });
    writeJSON(indexFile(env), index);
    return clip;
  } catch (e) {
    // A failed index write must not strand half an own import or prevent retrying it.
    for (const file of copied) fs.rmSync(file, { force: true });
    throw e;
  }
}

const actionStop = new Set("the and with from into onto that this some then gently visible movement are was has for its".split(" "));
export const libraryActionWords = (text) => [...new Set(String(text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !actionStop.has(w)))];
export const actionWordMatch = (a, b) => a.slice(0, Math.min(4, a.length, b.length)) === b.slice(0, Math.min(4, a.length, b.length));
/** Subject eligibility stays strict; action words only rank clips for the authoritative video check. */
export function rankLibraryClips(clips, pick) {
  const subject = subjectWords(pick.shows, pick.scene);
  const words = libraryActionWords(pick.action).filter((w) => !subject.some((s) => w.startsWith(s) || s.startsWith(w)));
  const matches = (clip) => words.filter((w) => libraryActionWords(clip.action ?? clip.description).some((t) => actionWordMatch(w, t))).length;
  const lastUse = (clip) => Math.max(0, ...(clip.usedIn || []).map((use) => Date.parse(use.date) || 0));
  return [...clips].sort((a, b) => Number(b.source === "own") - Number(a.source === "own") || matches(b) - matches(a) || lastUse(a) - lastUse(b));
}

function wholeEventInPoint(timeline, duration, clipDuration) {
  const start = eventInPoint(timeline, duration, clipDuration);
  const end = timeline.completion ?? timeline.contact;
  // Found drops that outlast the cut need the contact window, rather than an onset-only window.
  if (start !== null && timeline.eventType === "drop-land" && Number.isFinite(end) &&
      (start > timeline.onset || end + 0.2 > start + duration + 0.000001)) return null;
  return start;
}

/** Inspect the full source, select an event in-point, then inspect the exact interval the renderer will use. */
export async function reviewMovingClip({ file, duration, pick, shot, groups, dir, deps = {} }) {
  const check = deps.checkRunwayVideo || checkRunwayVideo;
  const inspected = await check({ file, pick, shot: { ...shot, duration }, groups, dir, eventOnly: true, deps });
  if (inspected.unavailable || inspected.look !== "pass" || inspected.shows !== true || inspected.action !== true || !validTimeline(inspected, duration)) return null;
  const timeline = pick.kind === "ambient" ? undefined : inspected;
  // Found footage rarely fits its whole event into a short cutaway; then the cut holds the key moment instead.
  const whole = timeline ? wholeEventInPoint(timeline, shot.duration, duration) : null;
  const inPoint = timeline ? whole ?? momentInPoint(timeline, shot.duration, duration) : undefined;
  if (timeline && inPoint === null) return null;
  const trimmed = await (deps.trimRunwayClip || trimRunwayClip)(file, shot.duration, { dir, runFn: deps.runFn, timeline, inPoint });
  const moves = await check({ file, pick, shot, groups, dir, inPoint: trimmed.inPoint, deps });
  const landed = !timeline || (whole !== null ? wholeEventInPoint(moves, shot.duration, shot.duration) !== null : timeline.contact == null || moves.contact !== null);
  if (!moves.ok || moves.look !== "pass" || !landed) return null;
  return { ...shot, ...trimmed, file, sourceDuration: duration, sourceTimeline: { onset: inspected.onset, contact: inspected.contact, completion: inspected.completion }, video: true, move: "none", motion: "none", kind: pick.kind, action: pick.action, moves };
}

export async function findLibraryClip({ pick, shot, groups, workDir, dir, deps = {} }) {
  if (checkPick(pick, shot, groups, { len: shot.duration })) return null;
  const env = deps.env || process.env, index = readLibrary(env), reel = registerReel(index, workDir);
  // Count distinct reels, including ones that searched the bank but had no suitable clip.
  const recent = recentLibraryReels(index, workDir);
  try { writeJSON(indexFile(env), index); } catch { warn("b-roll: library unavailable; trying another source"); return null; }
  const subject = subjectWords(pick.shows, pick.scene);
  const candidates = rankLibraryClips(index.clips.filter((c) => subject.length && subject.every((w) => (c.subjectWords || []).includes(w)) && c.duration >= shot.duration && libraryClipPath(c, env) && fs.existsSync(libraryClipPath(c, env)) && !(c.usedIn || []).some((use) => recent.has(use.reel))), pick).slice(0, 12);
  for (const clip of candidates) {
    try {
      const file = path.join(dir, `library-${shot.line}-${clip.id}.mp4`);
      fs.copyFileSync(libraryClipPath(clip, env), file);
      const accepted = await reviewMovingClip({ file, duration: clip.duration, pick, shot, groups, dir, deps });
      if (!accepted) continue;
      const latest = readLibrary(env), stored = latest.clips.find((c) => c.id === clip.id);
      if (!stored) continue;
      registerReel(latest, workDir);
      (stored.usedIn ||= []).push({ reel, date: new Date((deps.now || Date.now)()).toISOString() });
      writeJSON(indexFile(env), latest);
      return { ...accepted, source: "library", libraryId: clip.id, licence: clip.licence };
    } catch { warn("b-roll: library clip could not be checked; trying another source"); }
  }
  return null;
}

export function writeBrollCredits(workDir, shots) {
  const lines = shots.filter((s) => s.licence).map((s) => {
    const l = s.licence;
    return [`${s.start}s: ${l.provider || s.source}`, `ID: ${l.id ?? (l.taskIds || []).join(", ")}`, `Page: ${l.pageUrl || ""}`, `Creator: ${l.creator || ""}`, `Downloaded: ${l.downloadedAt || ""}`].join("\n");
  });
  fs.writeFileSync(path.join(workDir, "broll credits.txt"), lines.length ? `${lines.join("\n\n")}\n` : "No stock or library clips used.\n");
}
