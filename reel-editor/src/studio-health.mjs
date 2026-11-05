import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { studioPaths, withDefaults, readPosts, macZone } from "./content-studio.mjs";
import { detectConnectors, scheduledPosts } from "./studio-metricool.mjs";
import { claudeBinary } from "./claude.mjs";
import { zonedNow, addDays } from "./daily.mjs";
import { clientNotify, clientStatus } from "./client-status.mjs";
import { readJSON } from "./util.mjs";

/** Only waiting videos, never Done/, Music/, or an old caption beside a completed reel. */
export function stuckDrops(folders, { now = Date.now(), maxAge = 86400000, message = null, skip = [], byArrival = false } = {}) {
  const out = [];
  for (const dir of folders) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code !== "ENOENT") out.push(`Cannot read ${dir}: ${e.message}`); }
    for (const e of entries.filter((x) => !x.name.startsWith(".") && !["Done", "Failed", "Music"].includes(x.name))) {
      const file = path.join(dir, e.name);
      let videos = [];
      if (e.isFile() && /\.(mov|mp4|m4v)$/i.test(e.name)) videos = [file];
      if (e.isDirectory()) videos = fs.readdirSync(file).filter((f) => /\.(mov|mp4|m4v)$/i.test(f)).map((f) => path.join(file, f));
      if (skip.includes(e.name)) continue;
      // Dragging a reel in keeps the video's old mtime; the top entry's ctime is when it arrived.
      if (videos.length && (byArrival ? now - fs.statSync(file).ctimeMs > maxAge : videos.some((f) => now - fs.statSync(f).mtimeMs > maxAge))) out.push(message || `Reel waiting more than a day: ${file}`);
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

export async function studioHealth(dir, { now = new Date(), dropFolders = null, deps = {} } = {}) {
  const paths = studioPaths(dir);
  const issues = [];
  let config = withDefaults({});
  const editorOnly = dropFolders !== null;
  if (!editorOnly) {
    try { config = withDefaults(readJSON(paths.config)); } catch (e) { issues.push(`Cannot read studio.json: ${e.message}`); }
    let tz = config.timezone || macZone();
    try { zonedNow(tz, now); } catch { issues.push(`Invalid studio time zone: ${tz}`); tz = macZone(); }
    const { day, minutes } = zonedNow(tz, now);
    let daily = {};
    try { daily = readJSON(path.join(paths.state, "daily.json")); } catch {}
    if (minutes >= 9 * 60 && (daily.day !== day || (config.daily.publisher === "claude" && !daily.completed))) issues.push(config.daily.publisher === "claude" ? "Open the Claude app; it has to be open for your carousels and static posts to be made." : "The daily run has not finished today. Keep this Mac awake and check the daily log.");
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
  issues.push(...stuckDrops(dropFolders || [...(config.reels.rawIntake === false ? [] : [paths.rawReels]), ...(config.reels.publisher === "claude" ? [] : [paths.publish]), path.join(paths.reels, "delivered")], { now: now.getTime() }));
  if (config.reels.publisher === "claude" && !dropFolders && stuckDrops([paths.publish], { now: now.getTime(), maxAge: 3 * 3600000, skip: ["Not posted"], byArrival: true }).length) issues.push("Open the Claude app; it has to be open for reels to post");
  if (!editorOnly && config.health?.pingUrl) {
    try { await (deps.healthPing || healthPing)(config.health.pingUrl, issues.length > 0); }
    catch (e) { issues.push(`Health ping failed: ${e.message}`); }
  }
  const message = issues.length ? issues.join("\n") : "OK. All checks passed.";
  clientStatus(paths, "health", message, now);
  if (issues.length) (deps.notify || clientNotify)(editorOnly ? "Reel Editor needs attention" : "Your reels and posts need attention", message);
  return { issues, message };
}
