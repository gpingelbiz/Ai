import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkRunwayVideo, trimRunwayClip } from "./broll-runway.mjs";
import { checkPick, subjectWords, brollTestCache } from "./broll.mjs";
import { eventInPoint } from "./broll-qc.mjs";
import { ensureDir, readJSON, writeJSON, sha1, warn } from "./util.mjs";

export const libraryDir = (env = process.env) => env.REEL_BROLL_LIBRARY || path.join(env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT ? brollTestCache() : env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "broll-library");
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
export function saveLibraryClip({ shot, pick, workDir, licence, source = shot.source || "runway", duration, env = process.env, now = Date.now() }) {
  if (!shot.video || shot.moves?.ok !== true || shot.moves.look !== "pass") return null;
  const original = shot.full || shot.file;
  if (!original || !fs.existsSync(original)) return null;
  const index = readLibrary(env), reel = registerReel(index, workDir), date = new Date(now).toISOString();
  const id = licence?.provider && licence.id != null ? sha1(`${licence.provider}:${licence.id}`) : sha1(fs.readFileSync(original));
  let clip = index.clips.find((c) => c.id === id);
  if (!clip) {
    const file = path.join(ensureDir(libraryDir(env)), `${id}.mp4`);
    fs.copyFileSync(original, file);
    clip = { id, shows: pick.shows, subjectWords: subjectWords(pick.shows, pick.scene), stockQuery: pick.stockQuery || "", scene: pick.scene, description: pick.action || shot.seen || "", source, licence, file, duration: duration ?? shot.sourceDuration ?? shot.duration, approvedAt: date, usedIn: [] };
    index.clips.push(clip);
  }
  if (!clip.usedIn.some((use) => use.reel === reel)) clip.usedIn.push({ reel, date });
  writeJSON(indexFile(env), index);
  return clip;
}

/** Inspect the full source, select an event in-point, then inspect the exact interval the renderer will use. */
export async function reviewMovingClip({ file, duration, pick, shot, groups, dir, deps = {} }) {
  const check = deps.checkRunwayVideo || checkRunwayVideo;
  const inspected = await check({ file, pick, shot: { ...shot, duration }, groups, dir, deps });
  if (!inspected.ok || inspected.look !== "pass") return null;
  const timeline = pick.kind === "ambient" ? undefined : inspected;
  if (timeline && eventInPoint(timeline, shot.duration, duration) === null) return null;
  const trimmed = await (deps.trimRunwayClip || trimRunwayClip)(file, shot.duration, { dir, runFn: deps.runFn, timeline });
  const moves = await check({ file, pick, shot, groups, dir, inPoint: trimmed.inPoint, deps });
  if (!moves.ok || moves.look !== "pass" || timeline && eventInPoint(moves, shot.duration, shot.duration) === null) return null;
  return { ...shot, ...trimmed, file, sourceDuration: duration, video: true, move: "none", motion: "none", kind: pick.kind, action: pick.action, moves };
}

export async function findLibraryClip({ pick, shot, groups, workDir, dir, deps = {} }) {
  if (checkPick(pick, shot, groups, { len: shot.duration })) return null;
  const env = deps.env || process.env, index = readLibrary(env), reel = registerReel(index, workDir);
  // Count distinct reels, including ones that searched the bank but had no suitable clip.
  const recent = recentLibraryReels(index, workDir);
  try { writeJSON(indexFile(env), index); } catch { warn("b-roll: library unavailable; trying another source"); return null; }
  const subject = subjectWords(pick.shows, pick.scene);
  const candidates = index.clips.filter((c) => subject.length && subject.every((w) => (c.subjectWords || []).includes(w)) && c.duration >= shot.duration && fs.existsSync(c.file) && !(c.usedIn || []).some((use) => recent.has(use.reel))).slice(0, 2);
  for (const clip of candidates) {
    try {
      const file = path.join(dir, `library-${shot.line}-${clip.id}.mp4`);
      fs.copyFileSync(clip.file, file);
      const accepted = await reviewMovingClip({ file, duration: clip.duration, pick, shot, groups, dir, deps });
      if (!accepted) continue;
      const latest = readLibrary(env), stored = latest.clips.find((c) => c.id === clip.id);
      if (!stored) continue;
      registerReel(latest, workDir);
      stored.usedIn.push({ reel, date: new Date((deps.now || Date.now)()).toISOString() });
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
