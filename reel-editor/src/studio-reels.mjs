import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { loadStudio, readPosts, logPost, studioLog, takeLock } from "./content-studio.mjs";
import { pickSlot, parseCaption, postText, coverMilliseconds, trialReel } from "./publish-folder.mjs";
import { scheduledPosts, postInput, createPost, metricoolCall } from "./studio-metricool.mjs";
import { hostFiles } from "./studio-host.mjs";
import { hasCodex } from "./codex.mjs";
import { zonedNow, addDays } from "./daily.mjs";
import { ensureDir, readJSON, writeJSON, PKG_ROOT, log } from "./util.mjs";

/**
 * Raw Reels: a clip dropped in Content Studio/Raw Reels is edited by the reel editor's own drop-folder job
 * (scripts/watch-reel.sh) with the client's reel look, word list, caption voice and music, then scheduled into the
 * client's Metricool on the first day with no reel yet, at the best hour that is 2 hours from every other post.
 * Codex b-roll only when the client has Codex (and ai.broll allows it); the caption uses Sandcastles only when the
 * client has the connector.
 */

const VIDEO = /\.(mov|mp4|m4v)$/i;

/** Clips waiting in Raw Reels: settled for a minute, not done before (by name, size and time). */
export function waitingClips(dir, seen = {}, { now = Date.now(), settle = 60000 } = {}) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => VIDEO.test(n) && !n.startsWith(".")).map((n) => {
    const file = path.join(dir, n);
    const st = fs.statSync(file);
    return { file, name: n, key: `${n}@${st.size}-${Math.round(st.mtimeMs)}`, mtimeMs: st.mtimeMs };
  }).filter((c) => !seen[c.key] && now - c.mtimeMs >= settle).sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/**
 * Publish: finished reels to post as they are (Greg's own Publish folder, for a client). A reel folder (the video and
 * its caption.txt, as the drop folders make it) or a loose video, settled for a minute, moves into the delivered
 * folder; the run then files and schedules it like an edited Raw Reels clip. A loose video's caption is a .txt with
 * the same name next to it; without one the reel goes in as a draft.
 */
export function takePublished(dir, delivered, { now = Date.now(), settle = 60000 } = {}) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => !n.startsWith(".")); } catch { return []; }
  const newest = (p) => {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.mtimeMs;
    return Math.max(st.mtimeMs, ...fs.readdirSync(p).map((f) => { try { return fs.statSync(path.join(p, f)).mtimeMs; } catch { return 0; } }));
  };
  const moved = [];
  for (const n of names) {
    const from = path.join(dir, n);
    let st;
    try { st = fs.statSync(from); } catch { continue; }
    const folder = st.isDirectory();
    if (folder ? !fs.readdirSync(from).some((f) => VIDEO.test(f)) : !VIDEO.test(n)) continue;
    if (now - newest(from) < settle) continue;
    const name = folder ? n : n.replace(VIDEO, "");
    let to = path.join(delivered, name);
    for (let k = 2; fs.existsSync(to); k++) to = path.join(delivered, `${name} ${k}`);
    ensureDir(delivered);
    if (folder) fs.renameSync(from, to);
    else {
      ensureDir(to);
      fs.renameSync(from, path.join(to, n));
      const cap = path.join(dir, `${name}.txt`);
      if (fs.existsSync(cap)) fs.renameSync(cap, path.join(to, "caption.txt"));
    }
    moved.push(to);
  }
  return moved;
}

/** The environment the reel job runs with: everything the client's, nothing from Greg's defaults. */
export function reelEnv(studio, { sandcastles = false } = {}) {
  const p = studio.paths;
  const root = ensureDir(p.reels);
  return {
    REEL_CLIENT: studio.config.client,
    REEL_PRESET: fs.existsSync(p.reelPreset) ? p.reelPreset : "clean",
    REEL_DICTIONARY: p.dictionary,
    REEL_CAPTION_VOICE: p.voice,
    REEL_CAPTION_WATCHLIST: "0",
    REEL_CAPTION_SANDCASTLES: sandcastles ? "1" : "0",
    REEL_WATCH_ROOT: root,
    REEL_WATCH_DONE: ensureDir(path.join(root, "delivered")),
    REEL_WATCH_MUSIC: path.join(p.root, "Music"),
    REEL_WATCH_CTA: String(studio.config.cta || studio.brand.cta || "").trim(),
    REEL_CACHE: ensureDir(path.join(root, "cache")),
  };
}

/** Edit one clip with watch-reel.sh. Returns {output (the video), folder, hook}. */
export function editClip(file, mode, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", [path.join(PKG_ROOT, "scripts", "watch-reel.sh"), file, mode], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const line = out.trim().split("\n").reverse().find((l) => l.startsWith("{"));
      let j = null;
      try { j = JSON.parse(line); } catch {}
      if (code === 0 && j?.ok && j.output) return resolve({ output: j.output, folder: fs.statSync(j.output).isDirectory() ? j.output : path.dirname(j.output), hook: j.hook || "" });
      reject(new Error(j?.error || `the reel edit failed (${code}): ${(err || out).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`));
    });
  });
}

/** Best Instagram hours per day from Metricool: {day: [hours, best first]}. */
export function normalizeBestTimes(r, tz) {
  const list = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [];
  const byDay = {};
  for (const x of list) {
    const dt = String(x.dateTime || x.date || x.time || x.publicationDate?.dateTime || "");
    const m = dt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})/);
    const value = Number(x.value ?? x.score ?? 0);
    if (!m) continue;
    (byDay[m[1]] ||= []).push({ h: Number(m[2]), value });
  }
  return Object.fromEntries(Object.entries(byDay).map(([d, hs]) => [d, hs.sort((a, b) => b.value - a.value).map((x) => x.h)]));
}

/** The reel's day and hour: the first day without a reel, the best clear hour inside the studio's reel hours. */
export function reelSlot({ now, tz, scheduled = [], posts = [], best = {}, reels = {} }) {
  const taken = [...new Set([...scheduled.filter((p) => /REEL/.test(p.type)).map((p) => p.day), ...posts.filter((p) => p.format === "reel" && p.status !== "failed").map((p) => p.day)])];
  const busy = {};
  for (const p of scheduled.filter((x) => !/REEL/.test(x.type))) (busy[p.day] ||= []).push(p.hour + p.minute / 60);
  for (const p of posts.filter((x) => x.format !== "reel" && x.status !== "failed")) (busy[p.day] ||= []).push(Number(p.time.slice(0, 2)) + Number(p.time.slice(3, 5)) / 60);
  const lo = Number(reels.earliest ?? 8), hi = Number(reels.latest ?? 20);
  const bestByDay = Object.fromEntries(Object.entries(best).map(([d, hs]) => [d, hs.filter((h) => h >= lo && h <= hi)]).filter(([, hs]) => hs.length));
  return pickSlot({ now, taken, bestByDay, busy, tz, minLead: 2, minGap: Number(reels.gapHours ?? 2), fallbackHour: Number(reels.fallbackHour ?? 12), dayHours: [lo, hi] });
}

const notify = (title, msg) => { try { spawnSync("osascript", ["-e", `display notification ${JSON.stringify(msg)} with title ${JSON.stringify(title)}`]); } catch {} };

function uniqueDir(p) {
  if (!fs.existsSync(p)) return p;
  for (let i = 2; ; i++) if (!fs.existsSync(`${p} (${i})`)) return `${p} (${i})`;
}

/** The Made/ folder for a reel: "2026-11-02 12.00 Reel - <hook>". */
const reelMadeName = (slot, hook) => `${slot.day} ${String(slot.hour).padStart(2, "0")}.00 Reel${hook ? ` - ${String(hook).replace(/\*/g, "").replace(/[/:\\*?"<>|]+/g, " ").trim().slice(0, 48)}` : ""}`;

/**
 * Every waiting clip: edit it, then file and schedule every edited reel still in the delivered folder (a reel whose
 * filing or scheduling broke last time is picked up again here). Returns one result per clip or reel.
 */
export async function runReels(dir, { now = new Date(), deps = {} } = {}) {
  const studio = loadStudio(dir);
  const c = studio.config;
  if (c.reels?.enabled === false) return [];
  const seenFile = path.join(studio.paths.reels, "seen.json");
  let seen = {};
  try { seen = readJSON(seenFile); } catch {}
  const clips = waitingClips(studio.paths.rawReels, seen, { now: now.getTime() });
  const delivered = path.join(studio.paths.reels, "delivered");
  // Only folders with a video are reels: the editor also keeps its cover history (covers/history.json) here.
  const hasVideo = (d) => { try { return fs.statSync(d).isDirectory() && fs.readdirSync(d).some((f) => VIDEO.test(f)); } catch { return false; } };
  const waitingReels = () => { try { return fs.readdirSync(delivered).filter((d) => !d.startsWith(".")).map((d) => path.join(delivered, d)).filter(hasVideo); } catch { return []; } };
  // Finished reels dropped in Publish join the edited ones waiting to be filed and scheduled.
  // A studio made before Publish existed gets the folder on its next run.
  if (studio.paths.publish) ensureDir(studio.paths.publish);
  const published = studio.paths.publish ? takePublished(studio.paths.publish, delivered, { now: now.getTime() }) : [];
  if (published.length) studioLog(studio.paths, `publish: ${published.map((p) => path.basename(p)).join(", ")}`);
  if (!clips.length && !waitingReels().length) return [];
  const release = takeLock(studio.paths, "reels");
  if (!release) { log("studio: another run is going; the reel waits for the next one"); return []; }
  const results = [];
  try {
    for (const clip of clips) {
      const mode = c.ai?.broll !== false && hasCodex() ? "broll" : "reel";
      try {
        const edited = await (deps.editClip || editClip)(clip.file, mode, reelEnv(studio, { sandcastles: !!c.sandcastles }));
        seen[clip.key] = { status: "edited", folder: edited.folder, at: new Date().toISOString() };
        // The raw clip moves out of the way so the folder only shows what is still to do.
        try { fs.renameSync(clip.file, path.join(ensureDir(path.join(studio.paths.rawReels, "Done")), clip.name)); } catch {}
      } catch (e) {
        seen[clip.key] = { status: "failed", why: e.message, at: new Date().toISOString() };
        studioLog(studio.paths, `REEL FAILED ${clip.name}: ${e.message}`);
        notify(`${c.client}: reel failed`, `${clip.name}: ${String(e.message).split("\n")[0]}. Rename the clip to try again.`);
        results.push({ clip: clip.name, status: "failed", why: e.message });
      }
      writeJSON(seenFile, seen);
    }
    for (const folder of waitingReels()) {
      try {
        results.push(await scheduleReel(studio, { folder }, { now, deps }));
      } catch (e) {
        studioLog(studio.paths, `REEL NOT FILED ${path.basename(folder)}: ${e.message}`);
        results.push({ clip: path.basename(folder), status: "failed", why: e.message });
      }
    }
  } finally {
    release();
  }
  return results;
}

/** Schedule one edited reel (its delivered folder) and file it in Made/. */
export async function scheduleReel(studio, edited, { now = new Date(), deps = {} } = {}) {
  const c = studio.config;
  const folder = edited.folder;
  const video = fs.readdirSync(folder).filter((f) => VIDEO.test(f)).map((f) => path.join(folder, f))[0];
  if (!video) throw new Error(`no video in ${folder}`);
  // The editor names the reel after its hook.
  const hook = edited.hook || path.basename(video).replace(VIDEO, "");
  const capFile = path.join(folder, "caption.txt");
  const captionRaw = fs.existsSync(capFile) ? fs.readFileSync(capFile, "utf8") : "";
  const caption = parseCaption(captionRaw);
  let meta = {};
  try { meta = readJSON(path.join(folder, ".reel.json")); } catch {}
  const prefix = String(c.publish?.captionPrefix || "").trim();
  const text = [prefix, postText(caption)].filter(Boolean).join("\n\n");
  const textcheck = meta.textcheck;
  const textHold = (typeof textcheck === "string" ? textcheck : textcheck?.verdict) === "hold";
  const why = !postText(caption) ? "there is no caption" : textHold ? `its text check is on hold: ${textcheck?.notes?.[0] || "text check reported a hold"}` : meta.preflight === "fail" ? "its check failed" : "";
  const ai = c.ai?.label === "always" || !!meta.isAiGenerated;
  // reels.trial: every reel goes out as a Trial Reel (a client who allows Trial Reels only); otherwise #trial or trial: true.
  const trial = c.reels?.trial === true || trialReel({ entry: path.basename(folder), dir: folder, video, captionRaw, meta, root: path.dirname(folder) });
  const posts = readPosts(studio.paths);
  const { day: today } = zonedNow(c.timezone, now);
  let scheduled = [], best = {};
  if (c.publish.mode !== "off") {
    try { scheduled = await (deps.scheduledPosts || scheduledPosts)(c.metricool.connector, { blogId: c.metricool.blogId, from: today, to: addDays(today, 14), tz: c.timezone }); } catch {}
    try {
      const r = await (deps.bestTimes || ((conn, input) => metricoolCall(conn, "getBestTimeToPostByNetwork", input)))(c.metricool.connector, { brandId: String(c.metricool.blogId), fromDate: `${today}T00:00:00`, toDate: `${addDays(today, 7)}T23:59:59`, timezone: c.timezone, socialNetwork: "instagram" });
      best = normalizeBestTimes(r, c.timezone);
    } catch {}
  }
  const slot = reelSlot({ now, tz: c.timezone, scheduled, posts, best, reels: c.reels }) || { day: addDays(today, 1), hour: Number(c.reels?.fallbackHour ?? 12) };
  const time = `${String(slot.hour).padStart(2, "0")}:00`;
  const made = uniqueDir(path.join(studio.paths.made, reelMadeName(slot, hook)));
  fs.renameSync(folder, made);
  const madeVideo = path.join(made, path.basename(video));
  const id = `${slot.day}-${time.replace(":", "")}-reel`;
  const record = { id, day: slot.day, time, format: "reel", hook, made, files: [madeVideo], text, ai, trial, coverMs: coverMilliseconds(meta), draftWhy: why, status: "made" };
  logPost(studio.paths, record);
  if (c.publish.mode === "off") return record;
  const draft = c.publish.mode === "draft" || !!why;
  let host;
  try {
    host = await (deps.hostFiles || hostFiles)([madeVideo], { hosting: c.hosting, postId: id });
    const input = postInput({ blogId: c.metricool.blogId, day: slot.day, time, tz: c.timezone, text, media: host.urls, kind: "reel", ai, draft, trial, networks: c.metricool.networks, coverMs: record.coverMs });
    const r = await (deps.createPost || createPost)(c.metricool.connector, input);
    const next = { ...record, status: draft ? "draft" : "scheduled", plannerUrl: r.plannerUrl, metricoolId: r.id, why: why || (draft ? "the studio is set to drafts" : "") };
    fs.writeFileSync(path.join(made, "Scheduled.txt"), `${draft ? `Saved as a DRAFT in Metricool (${next.why}).` : `Scheduled to post ${slot.day} at ${time} (${c.timezone}).`}\n${trial ? "Trial Reel: yes, manual graduation.\n" : ""}Metricool: ${r.plannerUrl || "(no link returned)"}\n${ai ? "Marked as made with AI (Instagram's AI label).\n" : ""}`);
    logPost(studio.paths, next);
    studioLog(studio.paths, `reel ${next.status} ${id} ${r.plannerUrl || ""}`);
    notify(`${c.client}: reel ${draft ? "saved as a draft" : "scheduled"}`, `${hook}: ${slot.day} ${time}`);
    return next;
  } catch (e) {
    const next = { ...record, status: "not-posted", why: String(e.message).split("\n")[0] };
    fs.writeFileSync(path.join(made, "Not posted.txt"), `Not in Metricool yet: ${next.why}\nThe next run tries again.\n`);
    logPost(studio.paths, next);
    studioLog(studio.paths, `REEL NOT POSTED ${id}: ${next.why}`);
    notify(`${c.client}: reel not scheduled`, next.why);
    return next;
  } finally {
    await host?.close();
  }
}
