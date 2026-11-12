import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { recordOrder, clipFiles, orderSignature } from "./stitch-order.mjs";
import { sourceCacheKey } from "./speaker-index.mjs";
import { run, writeJSON, ensureDir } from "./util.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same admission as wait_clip: two matching stat checks, minimum age and a readable positive duration. */
export async function waitStitchClip(file, { env = process.env, execute = run, sleep = pause, now = Date.now } = {}) {
  if (env.REEL_WATCH_FAST === "1") return true;
  let last = "", good = 0;
  for (let i = 0; i < Number(env.REEL_WATCH_WAIT_CHECKS || 150); i++) {
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    const identity = `${st.size}:${st.mtimeMs}`;
    if (identity === last && st.size > 0 && now() - st.mtimeMs >= Number(env.REEL_WATCH_SETTLE_SECONDS ?? 5) * 1000) good++; else good = 0;
    if (good >= 2) {
      try {
        const { out } = await execute("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { capture: true });
        const after = fs.statSync(file);
        if (Number(out.trim()) > 0 && `${after.size}:${after.mtimeMs}` === identity) return true;
      } catch { /* a paused copy can have a stable size and still be truncated */ }
      good = 0;
    }
    last = identity;
    if (i + 1 < Number(env.REEL_WATCH_WAIT_CHECKS || 150)) await sleep(Number(env.REEL_WATCH_WAIT_SECONDS ?? 2) * 1000);
  }
  return false;
}

export async function scanStitch(root, { seen, job, envFile = "", env = process.env, now = Date.now, record = recordOrder, ready = waitStitchClip, execute = run } = {}) {
  ensureDir(root); ensureDir(seen);
  const folders = [root, ...fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "Used" && !d.name.startsWith(".")).map((d) => path.join(root, d.name))];
  let completed = 0;
  for (const folder of folders) {
    const ledger = await record(folder, { now: now() });
    if (!ledger.clips.length) continue;
    if (now() - ledger.lastArrival < Number(env.REEL_STITCH_QUIET ?? 90) * 1000) continue;
    const folderKey = crypto.createHash("sha256").update(folder).digest("hex").slice(0, 16);
    const finished = (signature) => ["done", "failed", "held"].some((s) => fs.existsSync(path.join(seen, `stitch-${folderKey}@${signature}.${s}`)));
    // Unchanged clips already passed the settle checks. Finished folders cost only a stat scan each minute.
    if (ledger.clips.every((c) => c.key) && finished(orderSignature(ledger.clips))) continue;
    const snapshot = [];
    let settled = true;
    for (const clip of ledger.clips) {
      const file = path.join(folder, clip.name);
      if (!clip.key && !await ready(file, { env, execute })) {
        const st = fs.existsSync(file) ? fs.statSync(file) : null;
        if (st && st.size === clip.size && st.mtimeMs === clip.mtimeMs) fs.writeFileSync(path.join(folder, "why it's held.txt"), "A clip could not be read yet. It may still be copying. Wait for copying to finish. If it has finished, check that every clip plays on this Mac.\n");
        settled = false; break;
      }
      snapshot.push({ ...clip, file, key: clip.key || sourceCacheKey(file) });
    }
    if (!settled) continue;
    // A new arrival while other clips were settling resets the quiet window before any job or marker.
    const current = await record(folder, { now: now() });
    if (JSON.stringify(current) !== JSON.stringify(ledger)) continue;
    const signature = orderSignature(snapshot);
    if (snapshot.some((c, i) => c.key !== ledger.clips[i].key)) writeJSON(path.join(folder, ".stitch-order.json"), { ...ledger, clips: snapshot.map(({ file, ...clip }) => clip) });
    const marker = path.join(seen, `stitch-${folderKey}@${signature}`);
    if (finished(signature)) continue;
    const manifest = path.join(folder, ".stitch-ready.json");
    writeJSON(manifest, { signature, clips: snapshot, loose: folder === root });
    const args = envFile
      ? ["-c", 'set -a; . "$1"; set +a; exec "$2" "$3" stitch', "stitch", envFile, job, folder]
      : [job, folder, "stitch"];
    const result = await execute("/bin/bash", args, { env: { ...env, REEL_WATCH_STITCH_READY: manifest, ...(envFile ? { REEL_WATCH_CLIENT_ENV: envFile } : {}) }, allowFail: true });
    if (result.code === 75) continue;
    // Marker and archive only the exact input snapshot that was rendered.
    const after = await record(folder, { now: now() });
    const stable = after.clips.length === snapshot.length && after.clips.every((c, i) => c.id === snapshot[i].id && c.name === snapshot[i].name && c.size === snapshot[i].size && c.mtimeMs === snapshot[i].mtimeMs && sourceCacheKey(path.join(folder, c.name)) === snapshot[i].key);
    if (!stable) continue;
    const status = result.code === 0 ? "done" : result.code === 76 || fs.existsSync(path.join(folder, "why it's held.txt")) ? "held" : "failed";
    if (status === "failed") fs.writeFileSync(path.join(folder, "why it failed.txt"), "The edit stopped before it finished. Your original clips are safe. See watch.log in your Reels folder.\n");
    else fs.rmSync(path.join(folder, "why it failed.txt"), { force: true });
    if (status === "done" && folder === root) {
      const used = ensureDir(path.join(root, "Used", `Loose reel ${Math.floor(ledger.lastArrival)} ${signature.slice(0, 8)}`));
      for (const c of snapshot) fs.renameSync(c.file, path.join(used, c.name));
      for (const name of ["Order.txt", "Order - check this.jpg", ".stitch-order.json"]) if (fs.existsSync(path.join(folder, name))) fs.renameSync(path.join(folder, name), path.join(used, name));
      fs.rmSync(manifest, { force: true });
    }
    fs.writeFileSync(`${marker}.${status}`, ""); completed++;
  }
  return completed;
}
