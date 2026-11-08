import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { studioPaths, readPosts } from "./content-studio.mjs";

export const GB = 1000 ** 3;
export const STORAGE_WARN_BYTES = 15 * GB;
export const STORAGE_STOP_BYTES = 8 * GB;
const DAY = 86400000;
const MODES = ["reel", "broll", "carousel", "long", "youtube", "runway", "own-broll"];
const SUFFIXES = ["", "_BROLL", "_CAROUSEL", "_LONG", "_YOUTUBE", "_RUNWAY", "_OWN_BROLL"];
const RAW = ["raw", "raw-broll", "raw-carousel", "raw-long", "raw-youtube", "raw-runway", "raw-own-broll"];
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const expand = (file, home) => path.resolve(String(file).replace(/^~(?=\/|$)/, home));

/** The saved installer list matters when a health agent has a bare environment. */
export function watchFolders({ home = os.homedir(), env = process.env, folders = null } = {}) {
  const saved = read(path.join(home, ".reel/maintenance/client.json"));
  const list = folders ?? saved?.dropFolders ?? RAW.map((name) => path.join(home, "Reels", name));
  if (!list.length) return [];
  const result = list.map((entry, i) => {
    const dir = typeof entry === "string" ? entry : entry.dir;
    const known = RAW.indexOf(path.basename(dir));
    return { dir: expand(dir, home), mode: entry.mode || MODES[known < 0 ? i : known] || "reel" };
  });
  let installed = "";
  try { installed = fs.readFileSync(path.join(home, "Library/LaunchAgents/com.pingel.reel-watch.plist"), "utf8").match(/<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/)?.[1] || ""; } catch {}
  SUFFIXES.forEach((suffix, i) => {
    const key = `REEL_WATCH_RAW${suffix}`;
    const fromAgent = installed.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
    const value = env[key] || fromAgent?.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
    if (!value) return;
    const previous = result.find((f) => f.mode === MODES[i]);
    if (previous) previous.dir = expand(value, home);
    else result.push({ mode: MODES[i], dir: expand(value, home) });
  });
  return result.filter((f, i) => result.findIndex((other) => other.dir === f.dir && other.mode === f.mode) === i);
}

/** Never follow links while measuring or selecting work to remove. */
export function treeReport(root) {
  const files = [], errors = [];
  let bytes = 0, newest = 0, links = false;
  const walk = (file) => {
    try {
      const st = fs.lstatSync(file);
      if (st.isSymbolicLink()) { links = true; return; }
      newest = Math.max(newest, st.mtimeMs);
      if (st.isDirectory()) for (const name of fs.readdirSync(file)) walk(path.join(file, name));
      else if (st.isFile()) { bytes += st.size; files.push(file); }
    } catch (e) { if (e.code !== "ENOENT") errors.push(file); }
  };
  walk(root);
  return { bytes, newest, files, errors, links };
}

function rootsOnly(roots) {
  return [...new Set(roots.map((r) => path.resolve(r)))].filter((r, i, all) => !all.some((other, j) => i !== j && r.startsWith(other + path.sep)));
}

function existingParent(file) {
  while (!fs.existsSync(file) && path.dirname(file) !== file) file = path.dirname(file);
  return file;
}

function hasJournal(tree) {
  return tree.files.some((file) => {
    if (/runway|journal/i.test(path.basename(file))) return true;
    if (!/\.json(?:\.tmp)?$/i.test(file)) return false;
    const value = read(file);
    // An unreadable record cannot prove that paid work is safe to discard.
    if (!value) return true;
    return Object.hasOwn(value, "tasks") || Object.hasOwn(value, "reservations");
  });
}

const video = (file) => /\.(mp4|mov|m4v)$/i.test(file);
function digest(file) {
  const hash = createHash("sha256"), fd = fs.openSync(file, "r"), buffer = Buffer.alloc(1024 * 1024);
  try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size)); }
  finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function cleanupCandidates(workRoots, paths, now) {
  const candidates = [];
  const posts = readPosts(paths);
  // A render alone proves editing finished, but never proves that the reel was posted.
  const posted = posts.filter((p) => ["scheduled", "posted"].includes(p.status) && !p.uncertain && (p.metricoolId || p.plannerUrl));
  const realRoots = workRoots.map((root) => { try { return fs.realpathSync(root); } catch { return root; } });
  const confirmed = posted.flatMap((p) => p.files || []).filter(video).filter((file) => {
    try {
      const real = fs.realpathSync(file);
      return path.isAbsolute(file) && fs.statSync(real).isFile() && !realRoots.some((root) => real.startsWith(root + path.sep));
    } catch { return false; }
  });
  const waiting = treeReport(paths.publish);
  if (waiting.errors.length || waiting.links) return [];
  const pending = waiting.files.filter(video).filter((f) => !path.relative(paths.publish, f).split(path.sep).includes("Scheduled"));
  const hashes = new Map();
  const hash = (file) => { if (!hashes.has(file)) hashes.set(file, digest(file)); return hashes.get(file); };
  for (const root of workRoots) {
    let entries;
    try { if (fs.lstatSync(root).isSymbolicLink()) continue; entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "delivered") continue;
      const dir = path.join(root, entry.name), tree = treeReport(dir);
      if (tree.errors.length || tree.links || now - tree.newest <= 30 * DAY || hasJournal(tree)) continue;
      const renders = tree.files.filter((f) => video(f) && path.relative(dir, f).split(path.sep).includes("renders"));
      if (!renders.length) continue;
      try {
        if (!renders.every((f) => !pending.some((p) => hash(p) === hash(f)) && confirmed.some((p) => hash(p) === hash(f)))) continue;
      } catch { continue; }
      candidates.push({ path: dir, bytes: tree.bytes });
    }
  }
  return candidates;
}

export function storageSummary(report) {
  const size = (bytes) => `${(bytes / GB).toFixed(1)} GB`;
  const lines = [report.freeBytes === null ? "Free space could not be checked." : `Free space: ${size(report.freeBytes)}`,
    `Originals: ${size(report.originalsBytes)}`, `Finished reels: ${size(report.finishedBytes)}`, `Work folders: ${size(report.workBytes)}`];
  if (report.blocked) lines.push("Editing is paused because this Mac is nearly full. Your original is safe.");
  else if (report.warning) lines.push("This Mac is nearly full. Free some space before editing more videos.");
  if (report.errors.length) lines.push("Some folders could not be checked. Open them in Finder and check their access.");
  if (report.removed?.length) lines.push(`Removed ${report.removed.length} finished work folders.`);
  else {
    lines.push(`Cleanup preview: ${size(report.cleanupBytes)} in ${report.cleanup.length} finished work folders.`);
    for (const item of report.cleanup) lines.push(`${item.path} (${size(item.bytes)})`);
    lines.push("Nothing has been deleted. Add --yes to remove only the finished work folders listed above.");
  }
  return lines.join("\n");
}

export function storageReport({ home = os.homedir(), env = process.env, reelsRoot = env.REEL_WATCH_ROOT || path.join(home, "Reels"),
  studio = env.REEL_STUDIO || path.join(home, "Content Studio"), rawFolders = null, now = Date.now(), statfs = fs.statfsSync, includeCleanup = true } = {}) {
  const paths = studioPaths(studio);
  const originals = rootsOnly([...(rawFolders ?? watchFolders({ home, env })).map((f) => typeof f === "string" ? f : f.dir), paths.rawReels]);
  const finished = rootsOnly([env.REEL_WATCH_DONE || path.join(reelsRoot, "done"), paths.made, paths.publish, path.join(paths.reels, "delivered")]);
  const workRoots = rootsOnly([path.join(reelsRoot, "videos"), paths.work, paths.reels]);
  const errors = [];
  const total = (roots) => roots.reduce((sum, root) => { const tree = treeReport(root); errors.push(...tree.errors); return sum + tree.bytes; }, 0);
  let freeBytes = null;
  const volumePath = existingParent(path.resolve(reelsRoot));
  try { const st = statfs(volumePath); freeBytes = Number(st.bavail) * Number(st.bsize); if (!Number.isFinite(freeBytes) || freeBytes < 0) freeBytes = null; }
  catch { errors.push(volumePath); }
  const originalsBytes = total(originals), finishedBytes = total(finished);
  // Delivered reels belong to finished storage even though the studio keeps them under its work tree.
  const workBytes = total(workRoots) - treeReport(path.join(paths.reels, "delivered")).bytes;
  const cleanupRoots = rootsOnly([path.join(reelsRoot, "videos"), paths.work, path.join(paths.reels, "videos")]);
  const cleanup = includeCleanup ? cleanupCandidates(cleanupRoots, paths, Number(now)) : [];
  return { reelsRoot: path.resolve(reelsRoot), volumePath, freeBytes, originalsBytes, finishedBytes, workBytes,
    warning: freeBytes !== null && freeBytes < STORAGE_WARN_BYTES, blocked: freeBytes !== null && freeBytes < STORAGE_STOP_BYTES,
    cleanup, cleanupBytes: cleanup.reduce((sum, item) => sum + item.bytes, 0), errors: [...new Set(errors)] };
}

/** Recheck under the scanner's lock; a preview is never authority to delete later. */
export function cleanupStorage({ yes = false, ...options } = {}) {
  if (!yes) return { ...storageReport(options), removed: [] };
  const home = options.home || os.homedir(), env = options.env || process.env;
  const reels = options.reelsRoot || env.REEL_WATCH_ROOT || path.join(home, "Reels");
  const studio = options.studio || env.REEL_STUDIO || path.join(home, "Content Studio");
  const lock = path.join(reels, "videos/.seen/.lock"), studioLock = path.join(studio, ".studio/run.lock");
  const updateLock = path.join(home, ".reel/maintenance/update.lock");
  if (fs.existsSync(updateLock) || fs.existsSync(studioLock)) throw new Error("Cleanup is waiting for the current work to finish.");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  try { fs.mkdirSync(lock); } catch { throw new Error("Cleanup is waiting for editing to finish."); }
  let studioLocked = false;
  try {
    fs.mkdirSync(path.dirname(studioLock), { recursive: true });
    try { fs.mkdirSync(studioLock); studioLocked = true; } catch { throw new Error("Cleanup is waiting for the current work to finish."); }
    fs.writeFileSync(path.join(studioLock, "who"), `storage ${process.pid}\n`);
    if (fs.existsSync(updateLock)) throw new Error("Cleanup is waiting for the update to finish.");
    const report = storageReport({ ...options, includeCleanup: true }), removed = [];
    for (const item of report.cleanup) {
      fs.rmSync(item.path, { recursive: true });
      removed.push(item.path);
    }
    return { ...report, removed };
  } finally {
    if (studioLocked) fs.rmSync(studioLock, { recursive: true });
    fs.rmdirSync(lock);
  }
}
