import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cloudflaredBin } from "./publish-folder.mjs";
import { connectorPrefix, toolPrompt } from "./studio-metricool.mjs";
import { firstJSON } from "./claude.mjs";
import { ensureDir } from "./util.mjs";

/**
 * How a post's files reach Metricool. Metricool takes media as public links and copies each file onto its own
 * servers when the post is created, so the link only has to work for that minute. The client picks one route when
 * they install (studio.json "hosting"):
 *
 *   tunnel   this Mac serves the files at random addresses through a Cloudflare quick tunnel (the same route the
 *            Publish folder uses for reels), closed again as soon as the post is in Metricool. Nothing to sign up for.
 *   drive    the files are copied into a folder in Google Drive for desktop that the client shared once as "anyone with
 *            the link"; the link comes from the file id Drive writes on the synced file. Metricool takes Drive links.
 *   dropbox  the files are copied into the Dropbox folder; the share link comes from the Dropbox connector on the
 *            client's claude.ai. Metricool takes Dropbox links.
 *
 * Every route returns {urls, close()}; close() is safe to call twice.
 */

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v" };

/** A local server for exactly these files, each at a random path; anything else is a 404. */
export function fileServer(files) {
  const routes = new Map();
  for (const f of files) routes.set(`/${crypto.randomBytes(12).toString("hex")}${path.extname(f).toLowerCase()}`, f);
  const server = http.createServer((req, res) => {
    const file = routes.get(String(req.url).split("?")[0]);
    if (!file) { res.writeHead(404); return res.end(); }
    const size = fs.statSync(file).size;
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
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
  return { server, paths: [...routes.keys()] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function answers(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { method: "HEAD" }); if (r.ok) return true; } catch {}
    await sleep(2000);
  }
  return false;
}

/** tunnel: serve the files and open a Cloudflare quick tunnel to them. */
export async function tunnelHost(files, { timeoutMs = 120000 } = {}) {
  const bin = cloudflaredBin();
  if (!bin) throw new Error("cloudflared is not installed (run scripts/install-cloudflared.sh, or the installer again)");
  const { server, paths } = fileServer(files);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const cf = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${server.address().port}`], { stdio: ["ignore", "pipe", "pipe"] });
  let closed = false;
  const close = async () => { if (closed) return; closed = true; try { cf.kill("SIGTERM"); } catch {} await new Promise((r) => server.close(() => r())); };
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the temporary link did not come up within two minutes")), timeoutMs);
      const onData = (d) => { const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) { clearTimeout(timer); resolve(m[0]); } };
      cf.stdout.on("data", onData);
      cf.stderr.on("data", onData);
      cf.on("exit", (code) => { clearTimeout(timer); reject(new Error(`cloudflared stopped (${code})`)); });
    });
    // A brand-new trycloudflare name needs a few seconds in DNS; asking too early makes the Mac cache the miss.
    await sleep(10000);
    const urls = paths.map((p) => base + p);
    for (const u of urls) if (!(await answers(u))) throw new Error("the temporary link did not answer");
    return { urls, close };
  } catch (e) {
    await close();
    throw e;
  }
}

/* ---------- Google Drive for desktop ---------- */

/** Where Google Drive for desktop keeps My Drive, or null. */
export function driveRoot(home = os.homedir()) {
  const cloud = path.join(home, "Library", "CloudStorage");
  let dirs = [];
  try { dirs = fs.readdirSync(cloud).filter((d) => d.startsWith("GoogleDrive-")); } catch {}
  for (const d of dirs) for (const sub of ["My Drive", "Meine Ablage", "Mi unidad"]) if (fs.existsSync(path.join(cloud, d, sub))) return path.join(cloud, d, sub);
  return fs.existsSync(path.join(home, "Google Drive", "My Drive")) ? path.join(home, "Google Drive", "My Drive") : null;
}

/** The Drive file id Drive for desktop writes on a synced file (an extended attribute), or "". */
export function driveFileId(file) {
  for (const attr of ["com.google.drivefs.item-id#S", "com.google.drivefs.item-id"]) {
    const r = spawnSync("xattr", ["-p", attr, file], { encoding: "utf8" });
    const id = (r.stdout || "").trim();
    if (r.status === 0 && /^[\w-]{10,}$/.test(id)) return id;
  }
  return "";
}

/** A Drive file id as a link Metricool can download. */
export const driveLink = (id) => `https://drive.google.com/uc?export=download&id=${id}`;

/** drive: copy into the shared Drive folder, wait for each file to sync, link it by its id. */
export async function driveHost(files, { folder, postId, waitMs = 600000 }) {
  if (!folder || !fs.existsSync(folder)) throw new Error(`the Google Drive folder "${folder}" is not there (is Google Drive for desktop running and signed in?)`);
  const dir = ensureDir(path.join(folder, postId));
  const copies = files.map((f, i) => { const to = path.join(dir, `${String(i + 1).padStart(2, "0")}${path.extname(f).toLowerCase()}`); fs.copyFileSync(f, to); return to; });
  const t0 = Date.now();
  const ids = copies.map(() => "");
  while (ids.some((id) => !id) && Date.now() - t0 < waitMs) {
    copies.forEach((f, i) => { if (!ids[i]) ids[i] = driveFileId(f); });
    if (ids.some((id) => !id)) await sleep(5000);
  }
  if (ids.some((id) => !id)) throw new Error("Google Drive did not finish uploading the files within 10 minutes");
  const urls = ids.map(driveLink);
  // The folder must be shared as "anyone with the link": a private file answers with a sign-in page, not the image.
  for (const u of urls) {
    let ok = false;
    for (let i = 0; i < 12 && !ok; i++) {
      try { const r = await fetch(u, { redirect: "follow" }); ok = r.ok && !/text\/html/i.test(r.headers.get("content-type") || ""); } catch {}
      if (!ok) await sleep(5000);
    }
    if (!ok) throw new Error(`Google Drive will not hand the file out: share the folder "${path.basename(folder)}" as "Anyone with the link: Viewer" (Start Here, step 3)`);
  }
  return { urls, close: async () => {} };
}

/* ---------- Dropbox ---------- */

/** Where the Dropbox app keeps the Dropbox folder, or null. */
export function dropboxRoot(home = os.homedir()) {
  const cloud = path.join(home, "Library", "CloudStorage");
  try { const d = fs.readdirSync(cloud).find((x) => /^Dropbox/.test(x)); if (d) return path.join(cloud, d); } catch {}
  return fs.existsSync(path.join(home, "Dropbox")) ? path.join(home, "Dropbox") : null;
}

/** A Dropbox share link as a direct download. */
export function dropboxDirect(url) {
  const u = new URL(url);
  u.searchParams.delete("dl");
  u.searchParams.set("raw", "1");
  return u.toString();
}

/** dropbox: copy into the Dropbox folder, then have the Dropbox connector make a share link for each file. */
export async function dropboxHost(files, { folder, postId, connector, waitMs = 600000 }) {
  const root = dropboxRoot();
  if (!root) throw new Error("the Dropbox app is not on this Mac");
  if (!folder || !fs.existsSync(folder)) throw new Error(`the Dropbox folder "${folder}" is not there`);
  if (!connector) throw new Error("the Dropbox connector is not on this Claude login (claude.ai, Settings, Connectors)");
  const dir = ensureDir(path.join(folder, postId));
  const copies = files.map((f, i) => { const to = path.join(dir, `${String(i + 1).padStart(2, "0")}${path.extname(f).toLowerCase()}`); fs.copyFileSync(f, to); return to; });
  const tool = `${connectorPrefix(connector)}create_shared_link`;
  const urls = [];
  for (const f of copies) {
    const dbxPath = "/" + path.relative(root, f).split(path.sep).join("/");
    let url = "";
    const t0 = Date.now();
    // The app uploads in the background: ask again until Dropbox knows the file.
    while (!url && Date.now() - t0 < waitMs) {
      const reply = spawnSync(process.env.REEL_CLAUDE_BIN || "claude", ["-p", toolPrompt(tool, { path: dbxPath }), "--allowedTools", tool, "--disallowedTools", "Bash,Edit,Write,Read", "--output-format", "text"], { encoding: "utf8", cwd: os.tmpdir(), timeout: 240000 });
      try { url = JSON.stringify(firstJSON(reply.stdout)).match(/https:\/\/www\.dropbox\.com\/[^"\\\s]+/)?.[0] || ""; } catch {}
      if (!url) await sleep(15000);
    }
    if (!url) throw new Error(`Dropbox did not give a link for ${path.basename(f)}`);
    urls.push(dropboxDirect(url));
  }
  return { urls, close: async () => {} };
}

/** The route studio.json names, for these files. */
export async function hostFiles(files, { hosting = {}, postId, connectors = {} }) {
  const route = hosting.route || "tunnel";
  if (route === "drive") return driveHost(files, { folder: hosting.folder, postId });
  if (route === "dropbox") return dropboxHost(files, { folder: hosting.folder, postId, connector: connectors.dropbox });
  return tunnelHost(files);
}
