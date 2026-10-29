import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

/**
 * The Publish folder (Desktop/Reels/Publish -> ~/Reels/publish): a reel dropped there posts to Instagram by itself.
 * Drop a finished reel folder (its video plus caption.txt, as the drop folders deliver it) or a loose video with a
 * caption file of the same name. The caption that posts is the one in the file, so edit it before dropping.
 *
 * The hourly Claude task (scheduled task "reel-publish") does the Metricool part with its connector: `scan` names the
 * next reel and what to post, `serve` gives that one video a temporary public link (a Cloudflare quick tunnel, closed
 * again by `stop`), and `done` / `fail` file the item under Scheduled/ or Not posted/ with a receipt.
 */

export const ROOT = process.env.REEL_PUBLISH_DIR || path.join(os.homedir(), "Reels", "publish");
export const SCHEDULED = "Scheduled";
export const FAILED = "Not posted";
const VIDEO = /\.(mp4|mov|m4v)$/i;
const SKIP_VIDEO = /^(b-roll \d+|clip \d+ - cover)/i;
const STATE = path.join(process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "publish-serve.json");

/** Caption text from a caption.txt the editor wrote (CAPTION / HASHTAGS sections) or a plain caption file. */
export function parseCaption(raw) {
  const s = String(raw || "").replace(/\r/g, "");
  const section = (name) => {
    const m = s.match(new RegExp(`^${name}\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\n[A-Z][A-Z' ]{3,}[^a-z\\n]*(?:\\n|$)|\\s*(?![\\s\\S]))`, "m"));
    return m ? m[1].trim() : "";
  };
  const caption = section("CAPTION");
  if (caption) {
    const tags = section("HASHTAGS");
    return { caption, hashtags: tags.split(/\s+/).filter((t) => t.startsWith("#")).slice(0, 5), source: "sections" };
  }
  // A plain file: the whole text is the caption; hashtags stay where Greg put them.
  const text = s.trim();
  return { caption: text, hashtags: [], source: text ? "plain" : "none" };
}

export const postText = (c) => [c.caption, c.hashtags.length ? "" : null, c.hashtags.join(" ") || null].filter((x) => x != null).join("\n").trim();

/** The watcher carries the Vision-scored frame time; old hand-made folders keep the historical 50 ms fallback. */
export function coverMilliseconds(meta = {}, fallback = 50) {
  return Number.isFinite(meta.coverMs) ? Math.max(0, Math.round(meta.coverMs)) : fallback;
}

/** One dropped item: a folder or a loose video. Returns null when it holds no usable video yet. */
export function readItem(entry, { root = ROOT, now = Date.now(), settle = 60000, sourceRoots = SOURCE_ROOTS } = {}) {
  const full = path.join(root, entry);
  let st;
  try { st = fs.statSync(full); } catch { return null; }
  let video = null, captionFile = null, dir = null, metaFrom = null, checkFrom = null;
  if (st.isDirectory()) {
    if (entry === SCHEDULED || entry === FAILED || entry.startsWith(".")) return null;
    dir = full;
    const files = fs.readdirSync(full).filter((f) => !f.startsWith("."));
    const vids = files.filter((f) => VIDEO.test(f) && !SKIP_VIDEO.test(f));
    // Several videos (a Clips folder): the first clip; the rest stay for the next runs.
    video = vids.sort()[0] ? path.join(full, vids.sort()[0]) : null;
    // A Clips folder pairs "Clip 2 - caption.txt" with "Clip 2 - <hook>.mp4"; a reel folder has caption.txt.
    const prefix = video ? path.basename(video).split(" - ")[0] : "";
    const cap = files.find((f) => prefix && f === `${prefix} - caption.txt`) || files.find((f) => /^caption\.txt$/i.test(f)) || files.find((f) => /caption.*\.txt$/i.test(f));
    captionFile = cap ? path.join(full, cap) : null;
  } else if (VIDEO.test(entry)) {
    video = full;
    const stem = entry.replace(VIDEO, "");
    const clip = stem.match(/^(Clip \d+) - /)?.[1];
    for (const c of [`${stem}.txt`, `${stem} - caption.txt`, `${stem} caption.txt`, clip ? `${clip} - caption.txt` : null].filter(Boolean)) if (!captionFile && fs.existsSync(path.join(root, c))) captionFile = path.join(root, c);
    // A video dragged in on its own: find the delivered folder it came from (same name and size) and take that
    // folder's caption and check results, so a clip dropped without its caption file still posts with its caption.
    if (!captionFile) {
      const home = findSource(entry, st.size, { roots: sourceRoots });
      if (home) { captionFile = home.captionFile; metaFrom = home.meta; checkFrom = home.check; }
    }
  } else return null;
  if (!video) return { entry, dir, video: null, problem: "no video in it" };
  // Still copying in: wait until the file has not changed for a minute.
  const vst = fs.statSync(video);
  if (now - vst.mtimeMs < settle) return { entry, dir, video, waiting: true };
  const caption = parseCaption(captionFile ? fs.readFileSync(captionFile, "utf8") : "");
  let meta = {};
  // The watcher leaves .reel.json in a reel folder and ".Clip 2.reel.json" per clip in a Clips folder.
  const prefix = path.basename(video).split(" - ")[0];
  for (const f of [dir && /^Clip \d+$/.test(prefix) ? `.${prefix}.reel.json` : null, ".reel.json"].filter(Boolean)) {
    try { meta = JSON.parse(fs.readFileSync(path.join(dir || root, f), "utf8")); break; } catch {}
  }
  if (metaFrom) { try { meta = JSON.parse(fs.readFileSync(metaFrom, "utf8")); } catch {} }
  const files = dir ? fs.readdirSync(dir) : [];
  const ai = meta.isAiGenerated ?? files.some((f) => /^b-roll \d+/i.test(f) || /runway usage/i.test(f));
  // The gate: a delivered check note with a failure means a draft for Greg to look at, not a post.
  let draft = false, why = "";
  const note = dir && files.find((f) => /check this reel\.txt$/i.test(f));
  const noteFile = note ? path.join(dir, note) : checkFrom;
  if (noteFile && /^FAIL\b/m.test(fs.readFileSync(noteFile, "utf8"))) { draft = true; why = "its check note shows a failure"; }
  if (meta.preflight === "fail") { draft = true; why = "its preflight failed"; }
  // The render reviewer's notes do not hold a reel back (Greg 2026-10-22: dropping it is the approval, and the
  // reviewer flags intended effects too); they go into the receipt to look at.
  const notes = meta.obvious ? [meta.obvious] : [];
  if (!caption.caption) { draft = true; why = "there is no caption"; }
  return { root, entry, dir, video, captionFile, caption, notes, text: postText(caption), isAiGenerated: !!ai, coverMs: coverMilliseconds(meta), draft, why, droppedAt: Math.round(st.mtimeMs) };
}

// Where delivered reels live: the Desktop Reels folder (where the drop folders deliver).
export const SOURCE_ROOTS = [process.env.REEL_WATCH_DONE || path.join(os.homedir(), "Desktop", "Reels")];

/** The delivered folder a loose video came from: same file name and size. Returns its caption, meta and note. */
export function findSource(name, size, { roots = SOURCE_ROOTS } = {}) {
  for (const r of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(r, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("Raw - ") && d.name !== "Publish" && d.name !== "Music").map((d) => path.join(r, d.name)); } catch { continue; }
    for (const d of dirs) {
      const f = path.join(d, name);
      try { if (fs.statSync(f).size !== size) continue; } catch { continue; }
      const clip = name.match(/^(Clip \d+) - /)?.[1];
      const pick = (...c) => c.map((x) => x && path.join(d, x)).find((x) => x && fs.existsSync(x)) || null;
      return { dir: d, captionFile: pick(clip ? `${clip} - caption.txt` : null, "caption.txt"), meta: pick(clip ? `.${clip}.reel.json` : null, ".reel.json"), check: pick(clip ? `${clip} - check this reel.txt` : null, "check this reel.txt") };
    }
  }
  return null;
}

/** Everything waiting in the folder, oldest drop first. */
export function scan({ root = ROOT, now = Date.now() } = {}) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).map((e) => readItem(e, { root, now })).filter(Boolean)
    // Oldest drop first; things dropped in the same few minutes go in name order (Clip 1 before Clip 2).
    .sort((a, b) => Math.floor((a.droppedAt || 0) / 300000) - Math.floor((b.droppedAt || 0) / 300000) || a.entry.localeCompare(b.entry, undefined, { numeric: true }));
}

/** File an item under Scheduled/ or Not posted/ with a receipt next to it. */
export function fileItem(item, { status, receipt, root = item.root || ROOT }) {
  const destDir = path.join(root, status === "failed" ? FAILED : SCHEDULED);
  fs.mkdirSync(destDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
  if (item.dir) {
    // A Clips folder with more videos left: move only the posted clip (and its own files) out.
    const rest = fs.readdirSync(item.dir).filter((f) => VIDEO.test(f) && !SKIP_VIDEO.test(f) && path.join(item.dir, f) !== item.video);
    if (rest.length) {
      const sub = path.join(destDir, `${path.basename(item.dir)} - ${path.basename(item.video).replace(VIDEO, "")}`);
      fs.mkdirSync(sub, { recursive: true });
      const prefix = path.basename(item.video).split(" - ")[0];
      for (const f of fs.readdirSync(item.dir)) if (f === path.basename(item.video) || (prefix && f.startsWith(prefix + " "))) fs.renameSync(path.join(item.dir, f), path.join(sub, f));
      fs.writeFileSync(path.join(sub, status === "failed" ? "Why it did not post.txt" : "Scheduled.txt"), receipt);
      return sub;
    }
    const dest = uniquePath(path.join(destDir, path.basename(item.dir)));
    fs.renameSync(item.dir, dest);
    fs.writeFileSync(path.join(dest, status === "failed" ? "Why it did not post.txt" : "Scheduled.txt"), receipt);
    return dest;
  }
  const sub = uniquePath(path.join(destDir, `${path.basename(item.video).replace(VIDEO, "")} (${stamp})`));
  fs.mkdirSync(sub, { recursive: true });
  fs.renameSync(item.video, path.join(sub, path.basename(item.video)));
  if (item.captionFile && fs.existsSync(item.captionFile)) fs.renameSync(item.captionFile, path.join(sub, path.basename(item.captionFile)));
  fs.writeFileSync(path.join(sub, status === "failed" ? "Why it did not post.txt" : "Scheduled.txt"), receipt);
  return sub;
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  for (let i = 2; ; i++) if (!fs.existsSync(`${p} (${i})`)) return `${p} (${i})`;
}

/**
 * The posting day: the first day from today with no Instagram reel scheduled yet (`taken` = ["YYYY-MM-DD"]), and
 * today only when its best hour is still 2 h out. `bestByDay` = {day: [hours, best first]} from Metricool.
 * `busy` = {day: [hours]} of every other post that day (carousels, statics, drafts): a reel never goes within
 * `minGap` hours of one (Greg 2026-10-22: "dont post them at the same time as other posts").
 */
export function pickSlot({ now, taken = [], bestByDay = {}, busy = {}, tz = "America/Phoenix", minLead = 2, minGap = 2, fallbackHour = 18, dayHours = [8, 21] }) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const parts = (d) => Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const p = parts(now);
  const today = `${p.year}-${p.month}-${p.day}`, hourNow = Number(p.hour);
  for (let k = 0; k < 14; k++) {
    const d = new Date(now.getTime() + k * 86400000);
    const q = parts(d);
    const day = `${q.year}-${q.month}-${q.day}`;
    if (taken.includes(day)) continue;
    const clear = (h) => (busy[day] || []).every((b) => Math.abs(b - h) >= minGap) && (day !== today || h >= hourNow + minLead);
    // The best hours first; when every best hour is next to another post, any clear daytime hour nearest the best one.
    const best = bestByDay[day] || [fallbackHour];
    let hour = best.find(clear);
    if (hour == null) {
      const all = []; for (let h = dayHours[0]; h <= dayHours[1]; h++) all.push(h);
      hour = all.filter(clear).sort((a, b) => Math.abs(a - best[0]) - Math.abs(b - best[0]))[0];
    }
    if (hour == null) continue;
    return { day, hour };
  }
  return null;
}

/* ---------- the temporary public link ---------- */

export function cloudflaredBin(env = process.env) {
  for (const c of [env.REEL_CLOUDFLARED, path.join(env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "bin", "cloudflared")].filter(Boolean)) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {}
  }
  return null;
}

/** Child process body: serve one file at a random path and open a quick tunnel to it. */
export async function serveChild(file, { maxMinutes = 20 } = {}) {
  const token = crypto.randomBytes(12).toString("hex");
  const name = `${token}${path.extname(file).toLowerCase() || ".mp4"}`;
  const server = http.createServer((req, res) => {
    if (req.url !== `/${name}`) { res.writeHead(404); return res.end(); }
    const size = fs.statSync(file).size;
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    const type = { ".mov": "video/quicktime", ".m4v": "video/x-m4v" }[path.extname(file).toLowerCase()] || "video/mp4";
    if (range) {
      const a = range[1] ? Number(range[1]) : 0, b = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Length": b - a + 1, "Content-Range": `bytes ${a}-${b}/${size}`, "Accept-Ranges": "bytes" });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const cf = spawn(cloudflaredBin(), ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  let url = null;
  const onData = (d) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !url) { url = `${m[0]}/${name}`; fs.writeFileSync(STATE, JSON.stringify({ url, pid: process.pid, cf: cf.pid, file, started: Date.now() })); }
  };
  cf.stdout.on("data", onData);
  cf.stderr.on("data", onData);
  const quit = () => { try { cf.kill("SIGTERM"); } catch {} server.close(); try { fs.rmSync(STATE, { force: true }); } catch {} process.exit(0); };
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
  setTimeout(quit, maxMinutes * 60000);
}

/** Start serving `file` in the background and wait until its public link answers. Returns the link. */
export async function serve(file, { timeoutMs = 120000, script } = {}) {
  if (!cloudflaredBin()) throw new Error("cloudflared is not installed (scripts/install-cloudflared.sh)");
  await stop();
  const child = spawn(process.execPath, [script, "serve-child", file], { detached: true, stdio: "ignore" });
  child.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1000));
    let st = null;
    try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {}
    if (!st?.url) continue;
    // A brand-new trycloudflare name needs a few seconds in DNS; asking too early makes the Mac cache the miss.
    if (!st.ready) { await new Promise((r) => setTimeout(r, 10000)); st.ready = true; fs.writeFileSync(STATE, JSON.stringify(st)); }
    try {
      const res = await fetch(st.url, { method: "HEAD" });
      if (res.ok) return st.url;
    } catch {}
  }
  await stop();
  throw new Error("the temporary link did not come up within two minutes");
}

/** Close the temporary link. */
export async function stop() {
  let st = null;
  try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return false; }
  for (const pid of [st.cf, st.pid]) { try { process.kill(pid, "SIGTERM"); } catch {} }
  try { fs.rmSync(STATE, { force: true }); } catch {}
  return true;
}
