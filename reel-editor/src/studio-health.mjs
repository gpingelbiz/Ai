import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { studioPaths, withDefaults, readPosts, macZone } from "./content-studio.mjs";
import { detectConnectors, scheduledPosts } from "./studio-metricool.mjs";
import { claudeBinary } from "./claude.mjs";
import { zonedNow, addDays } from "./daily.mjs";
import { clientNotify, clientStatus } from "./client-status.mjs";
import { readJSON } from "./util.mjs";
import { watchFolders, treeReport, storageReport, GB } from "./storage.mjs";

const read = (file, fallback = {}) => { try { return readJSON(file); } catch { return fallback; } };
const video = (name) => /\.(mov|mp4|m4v)$/i.test(name);

export function watcherWorkName(file, mode = "reel") {
  let stem = path.basename(file, path.extname(file)).split("__")[0];
  stem = stem.replace(/#[a-z]+(:[A-Za-z0-9_-]+)?/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "reel";
  const suffix = { broll: "broll", carousel: "carousel", long: "clips", youtube: "youtube", runway: "runway" }[mode];
  return suffix ? `${stem}-${suffix}` : stem;
}

/** Use exactly the scanner's mode, byte size and whole second marker identity. */
export function watcherDrops(folders, { root, now = Date.now(), maxAge = 86400000, runningAge = 3 * 3600000, studioSeen = null } = {}) {
  const issues = [], seen = path.join(root, "videos/.seen");
  for (const { dir, mode = "reel" } of folders) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { if (e.code !== "ENOENT") issues.push(`Cannot read the Raw folder ${dir}. Check that this Mac can open it.`); continue; }
    for (const entry of entries.filter((e) => e.isFile() && !e.name.startsWith(".") && video(e.name))) {
      const file = path.join(dir, entry.name);
      try {
        const st = fs.statSync(file), base = mode === "reel" ? entry.name : `${mode}-${entry.name}`;
        const previous = studioSeen?.[`${entry.name}@${st.size}-${Math.round(st.mtimeMs)}`];
        if (previous?.status === "edited") continue;
        const names = [base, `${base}@${st.size}-${Math.floor(st.mtimeMs / 1000)}`];
        if (names.some((name) => fs.existsSync(path.join(seen, `${name}.done`)))) continue;
        const failed = previous?.status === "failed" || names.some((name) => fs.existsSync(path.join(seen, `${name}.failed`)));
        let note = "";
        try { note = fs.readFileSync(`${file} - why it failed.txt`, "utf8").trim(); } catch {}
        if (failed || note) {
          issues.push(`Editing needs attention: ${file}\n${note || previous?.why || "The edit stopped before it finished. Your original is safe. Read the editing log before trying again."}`);
          continue;
        }
        const working = (studioSeen ? ["reel", "broll"] : [mode]).some((kind) => {
          const work = treeReport(path.join(root, "videos", watcherWorkName(file, kind)));
          return work.newest && now - work.newest <= runningAge;
        });
        if (working) continue;
        if (now - st.mtimeMs > maxAge) issues.push(`Reel waiting more than a day: ${file}`);
      } catch { issues.push(`Cannot check ${file}. Check that this Mac can open it.`); }
    }
  }
  return issues;
}

/** A completed check, even with an empty queue, proves that a routine actually ran. */
export function routineIssues(heartbeat, { now = new Date(), tz = "UTC", expected = Object.keys(heartbeat || {}) } = {}) {
  const { day, minutes } = zonedNow(tz, now), since = minutes >= 9 * 60 ? day : addDays(day, -1);
  const out = [];
  const time = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  for (const task of expected) {
    const beat = heartbeat?.[task] || {}, done = time(beat.done), failed = time(beat.fail);
    const label = task === "reel-publish" ? "reel posting" : task === "daily-posts" ? "daily posts" : task;
    if (failed > done) out.push(`The ${label} routine needs attention. ${beat.reason || "Open the Claude app and check its tasks."}`);
    else if (!done || zonedNow(tz, new Date(done)).day < since) {
      const last = done ? zonedNow(tz, new Date(done)).day : since;
      out.push(`The ${label} routine has not finished since ${last}. Open the Claude app and check its tasks.`);
    }
  }
  return out;
}

/** Only waiting videos, never Done/, Music/, or an old caption beside a completed reel. */
export function stuckDrops(folders, { now = Date.now(), maxAge = 86400000, message = null, skip = [], byArrival = false } = {}) {
  const out = [];
  for (const dir of folders) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code !== "ENOENT") out.push(`Cannot read ${dir}: ${e.message}`); }
    for (const e of entries.filter((x) => !x.name.startsWith(".") && !["Done", "Failed", "Music", "Scheduled", "Not posted"].includes(x.name))) {
      if (skip.includes(e.name)) continue;
      const file = path.join(dir, e.name);
      try {
      let videos = [];
      if (e.isFile() && /\.(mov|mp4|m4v)$/i.test(e.name)) videos = [file];
      if (e.isDirectory()) videos = fs.readdirSync(file).filter((f) => /\.(mov|mp4|m4v)$/i.test(f)).map((f) => path.join(file, f));
      // Dragging a reel in keeps the video's old mtime; the top entry's ctime is when it arrived.
      if (videos.length && (byArrival ? now - fs.statSync(file).ctimeMs > maxAge : videos.some((f) => now - fs.statSync(f).mtimeMs > maxAge))) out.push(message || `Reel waiting more than a day: ${file}`);
      } catch { out.push(`Cannot check ${file}. Check that this Mac can open it.`); }
    }
  }
  return out;
}

export function validPingURL(value) {
  if (!value) return true;
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.hash; } catch { return false; }
}

export function claudeConnected() {
  const r = spawnSync(claudeBinary(), ["auth", "status", "--json"], { encoding: "utf8", timeout: 20000 });
  try { return r.status === 0 && JSON.parse(r.stdout).loggedIn === true; } catch { return false; }
}

/** No telemetry: the optional client-supplied URL receives only a GET (or /fail), never content or account details. */
export async function healthPing(url, failed, fetcher = fetch) {
  if (!url) return;
  if (!validPingURL(url)) throw new Error("health.pingUrl must be an https URL without a login or fragment");
  const u = new URL(url);
  if (failed) u.pathname = u.pathname.replace(/\/$/, "") + "/fail";
  const r = await fetcher(u.toString(), { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`health ping returned ${r.status}`);
}

export async function studioHealth(dir, { now = new Date(), dropFolders = null, home: suppliedHome, env = process.env, deps = {} } = {}) {
  const paths = studioPaths(dir);
  const home = suppliedHome || (env.REEL_CLIENT_MODE === "1" || paths.root.startsWith(os.homedir() + path.sep) ? os.homedir() : paths.root);
  const statusPaths = suppliedHome || env.REEL_CLIENT_MODE === "1" ? { ...paths, home } : paths;
  const root = env.REEL_WATCH_ROOT || path.join(home, "Reels");
  const issues = [];
  let config = withDefaults({});
  const editorOnly = dropFolders !== null;
  if (!editorOnly) {
    try { config = withDefaults(readJSON(paths.config)); } catch (e) { issues.push(`Cannot read studio.json: ${e.message}`); }
    let tz = config.timezone || macZone();
    try { zonedNow(tz, now); } catch { issues.push(`Invalid studio time zone: ${tz}`); tz = macZone(); }
    const { day, minutes } = zonedNow(tz, now);
    const heartbeatFile = path.join(paths.root, "heartbeat.json");
    const usesHeartbeat = fs.existsSync(heartbeatFile) || env.REEL_CLIENT_MODE === "1";
    if (usesHeartbeat) {
      const expected = [...config.daily.publisher === "claude" ? ["daily-posts"] : [], ...config.reels.publisher === "claude" ? ["reel-publish"] : []];
      issues.push(...routineIssues(read(heartbeatFile), { now, tz, expected }));
    }
    let daily = {};
    try { daily = readJSON(path.join(paths.state, "daily.json")); } catch {}
    if ((!usesHeartbeat || config.daily.publisher !== "claude") && minutes >= 9 * 60 && (daily.day !== day || (config.daily.publisher === "claude" && !daily.completed))) issues.push(config.daily.publisher === "claude" ? "Open the Claude app; it has to be open for your carousels and static posts to be made." : "The daily run has not finished today. Keep this Mac awake and check the daily log.");
    if (daily.error) issues.push(`Daily run needs attention: ${daily.error}`);
    try {
      if (!await (deps.claudeConnected || claudeConnected)()) issues.push("Claude is disconnected. Open Terminal, run claude and sign in.");
    } catch (e) { issues.push(`Claude connection check failed: ${e.message}`); }
    if (config.publish.mode !== "off") {
      try {
        const connectors = await (deps.detectConnectors || detectConnectors)();
        if (!connectors.metricool?.connected || (config.metricool.connector && connectors.metricool.name !== config.metricool.connector)) issues.push("Metricool is disconnected or renamed. Reconnect it in Claude, then re-run the installer.");
        else {
          const posts = await (deps.scheduledPosts || scheduledPosts)(config.metricool.connector, { blogId: config.metricool.blogId, from: addDays(day, -7), to: addDays(day, 3), tz });
          for (const p of posts.filter((p) => p.error || /error|fail/i.test(p.status || ""))) issues.push(`Metricool post failed (${p.day}): ${p.error || p.status}`);
        }
      } catch (e) { issues.push(`Metricool health check failed: ${String(e.message).split("\n")[0]}`); }
    }
    // A routine post on hold is never resent, so it would alert forever; it stops alerting a week after its date.
    for (const p of readPosts(paths).filter((p) => ["failed", "not-posted", "held"].includes(p.status) && (config.daily.publisher !== "claude" || p.day >= addDays(day, -7)))) issues.push(`Post needs attention (${p.day} ${p.time}): ${p.why || p.status}`);
  }
  const postingIssues = issues;
  const folders = watchFolders({ home, env, folders: dropFolders });
  const editingIssues = watcherDrops(folders, { root, now: now.getTime() });
  if (!editorOnly && config.reels.rawIntake !== false) editingIssues.push(...watcherDrops([{ dir: paths.rawReels }], { root: paths.reels, now: now.getTime(), studioSeen: read(path.join(paths.reels, "seen.json")) }));
  if (!editorOnly) postingIssues.push(...stuckDrops([...(config.reels.publisher === "claude" ? [] : [paths.publish]), path.join(paths.reels, "delivered")], { now: now.getTime() }));
  if (config.reels.publisher === "claude" && !dropFolders && stuckDrops([paths.publish], { now: now.getTime(), maxAge: 3 * 3600000, skip: ["Not posted"], byArrival: true }).length) issues.push("Open the Claude app; it has to be open for reels to post");
  const storageIssues = [];
  let storage;
  try {
    storage = (deps.storageReport || storageReport)({ home, env, reelsRoot: root, studio: editorOnly ? env.REEL_STUDIO || path.join(home, "Content Studio") : paths.root, rawFolders: folders, now: now.getTime(), includeCleanup: false });
    if (storage.freeBytes === null) storageIssues.push("Free space could not be checked. Check storage in System Settings.");
    else if (storage.warning) storageIssues.push(`${storage.blocked ? "Editing is paused because this Mac is nearly full. Your original is safe." : "This Mac is nearly full."} Free space: ${(storage.freeBytes / GB).toFixed(1)} GB. Free some space before editing more videos.`);
    if (storage.errors.length) storageIssues.push("Some folders could not be checked. Open them in Finder and check their access.");
  } catch { storageIssues.push("Storage could not be checked. Check storage in System Settings."); }
  if (!editorOnly && config.health?.pingUrl) {
    try { await (deps.healthPing || healthPing)(config.health.pingUrl, issues.length + editingIssues.length + storageIssues.length > 0); }
    catch { postingIssues.push("The optional check in could not be reached. Check this Mac's internet connection."); }
  }
  const action = (list, fallback) => list.length ? fallback : "All good";
  clientStatus(statusPaths, "editing", editingIssues.join("\n") || "All good", now, { action: action(editingIssues, "Read the note beside the waiting clip or check the editing log.") });
  if (!editorOnly) clientStatus(statusPaths, "posting", postingIssues.join("\n") || "All good", now, { action: action(postingIssues, "Open the Claude app and check your posts and tasks.") });
  clientStatus(statusPaths, "storage", storageIssues.join("\n") || `All good. Free space: ${(storage.freeBytes / GB).toFixed(1)} GB.`, now, { action: action(storageIssues, storage?.warning ? "Free some space on this Mac." : "Check storage in System Settings.") });
  issues.push(...editingIssues, ...storageIssues);
  const message = issues.length ? issues.join("\n") : "OK. All checks passed.";
  if (issues.length) (deps.notify || clientNotify)(editorOnly ? "Reel Editor needs attention" : "Your reels and posts need attention", message);
  return { issues, message, storage };
}
