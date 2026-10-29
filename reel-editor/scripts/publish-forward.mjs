#!/usr/bin/env node
/**
 * Publish forwarder: a Publish folder on a Mac that does not run the posting task sends what is dropped in it to the
 * Mac that does (Greg's MacBook -> the Mac mini). The Mini's hourly `reel-publish` task stays the only thing that posts,
 * so "one reel a day" is counted in one place.
 *
 *   node scripts/publish-forward.mjs run      send every settled drop, then file it under "Sent to the Mini"
 *   node scripts/publish-forward.mjs scan     show what is waiting and what would go (sends nothing)
 *   node scripts/publish-forward.mjs status   the same, plus whether the Mini answers
 *
 * A loose video is bundled with its caption, check note and .reel.json (found the same way the Mini's scan would,
 * from the delivered folder on THIS Mac) into one reel folder, because the Mini has no delivered folders to look in.
 * Each drop goes into `<dest>/.incoming/<token>` first and is renamed to its real name only when it is complete and
 * verified byte for byte, so the Mini's scan can never see half a reel. A name already waiting on the Mini is never
 * overwritten (the drop stays here and the log says why).
 *
 * Env: REEL_PUBLISH_DIR (local folder, default ~/Reels/publish), REEL_FORWARD_HOST (default gregs-mac-mini; empty = copy
 * to a local folder, used by the tests), REEL_FORWARD_KEY (ssh key), REEL_FORWARD_DEST (folder on the Mini relative to
 * its home, default Reels/publish), REEL_FORWARD_NOTIFY=0 to silence Mac notifications.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readItem, SCHEDULED, FAILED } from "../src/publish-folder.mjs";

export const SENT = "Sent to the Mini";
const SKIP = new Set([SENT, SCHEDULED, FAILED]);
const home = os.homedir();
const cacheDir = () => process.env.REEL_CACHE || path.join(home, ".cache", "reel-editor");
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // POSIX single-quote for the remote shell

function cfg(over = {}) {
  return {
    root: over.root || process.env.REEL_PUBLISH_DIR || path.join(home, "Reels", "publish"),
    host: over.host ?? process.env.REEL_FORWARD_HOST ?? "gregs-mac-mini",
    key: over.key || process.env.REEL_FORWARD_KEY || path.join(home, ".ssh", "id_triage_mirror"),
    dest: over.dest || process.env.REEL_FORWARD_DEST || "Reels/publish",
    notify: over.notify ?? process.env.REEL_FORWARD_NOTIFY !== "0",
    now: over.now ?? Date.now(),
    sourceRoots: over.sourceRoots,
  };
}

const sshArgs = (c) => ["-i", c.key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15"];
function ssh(c, remoteCmd) {
  return spawnSync("ssh", [...sshArgs(c), c.host, remoteCmd], { encoding: "utf8", timeout: 60000 });
}

/** What is waiting in the local Publish folder: each entry with its readItem result and whether it can go now. */
export function plan(over = {}) {
  const c = cfg(over);
  if (!fs.existsSync(c.root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(c.root).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (entry.startsWith(".") || SKIP.has(entry)) continue;
    const item = readItem(entry, { root: c.root, now: c.now, ...(c.sourceRoots ? { sourceRoots: c.sourceRoots } : {}) });
    if (!item) continue;
    if (item.waiting) out.push({ entry, ready: false, why: "still copying" });
    else if (!item.video) out.push({ entry, ready: false, why: item.problem || "no video in it" });
    else out.push({ entry, item, ready: true });
  }
  return out;
}

/** The folder to send: a dropped folder as it is, or a loose video bundled with its caption, meta and check note. */
export function stageItem(item) {
  if (item.dir) return { dir: item.dir, name: path.basename(item.dir), temp: null };
  const stem = path.basename(item.video).replace(/\.(mp4|mov|m4v)$/i, "");
  const temp = path.join(cacheDir(), "forward-stage", stem);
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });
  const put = (src, name) => { if (src && fs.existsSync(src)) fs.copyFileSync(src, path.join(temp, name)); };
  try { fs.linkSync(item.video, path.join(temp, path.basename(item.video))); } catch { put(item.video, path.basename(item.video)); }
  put(item.captionFile, "caption.txt");
  put(item.metaFile, ".reel.json");
  put(item.checkFile, "check this reel.txt");
  return { dir: temp, name: stem, temp };
}

/** Send one folder to the Mini (or to a local folder when host is empty). Returns { ok, why }. */
export function sendFolder(c, dir, name) {
  const token = crypto.randomBytes(5).toString("hex");
  if (!c.host) { // local copy, for the tests
    const dest = path.resolve(c.dest);
    if (fs.existsSync(path.join(dest, name))) return { ok: false, why: "a reel with that name is already waiting there" };
    const tmp = path.join(dest, ".incoming", token);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.cpSync(dir, tmp, { recursive: true });
    fs.renameSync(tmp, path.join(dest, name));
    return { ok: true };
  }
  const exists = ssh(c, `cd ${q(c.dest)} 2>/dev/null && [ -e ${q(name)} ] && echo EXISTS || echo FREE`);
  if (exists.status !== 0) return { ok: false, why: `the Mini did not answer (${(exists.stderr || "").trim().slice(-120) || "ssh failed"})` };
  if (/EXISTS/.test(exists.stdout)) return { ok: false, why: "a reel with that name is already waiting on the Mini" };
  const mk = ssh(c, `mkdir -p ${q(c.dest + "/.incoming/" + token)}`);
  if (mk.status !== 0) return { ok: false, why: "could not make the incoming folder on the Mini" };
  const e = `ssh ${sshArgs(c).map((a) => (a.includes(" ") ? q(a) : a)).join(" ")}`;
  const remote = `${c.host}:${c.dest}/.incoming/${token}/`; // token is hex: no quoting needed
  const rs = spawnSync("rsync", ["-a", "--partial", "-e", e, dir + "/", remote], { encoding: "utf8", timeout: 3600000 });
  if (rs.status !== 0) return { ok: false, why: `rsync failed (${(rs.stderr || "").trim().slice(-160)})` };
  // Verify by checksum: a dry run that would still change something means the copy is not identical.
  const vr = spawnSync("rsync", ["-a", "-c", "-n", "-i", "-e", e, dir + "/", remote], { encoding: "utf8", timeout: 3600000 });
  if (vr.status !== 0 || vr.stdout.trim()) return { ok: false, why: "the copy on the Mini did not match, it will retry" };
  const fin = ssh(c, `cd ${q(c.dest)} && if [ -e ${q(name)} ]; then echo EXISTS; else mv ${q(".incoming/" + token)} ${q(name)} && echo MOVED; fi`);
  if (!/MOVED/.test(fin.stdout || "")) return { ok: false, why: /EXISTS/.test(fin.stdout || "") ? "a reel with that name is already waiting on the Mini" : "could not finish the move on the Mini" };
  return { ok: true };
}

/** File what was sent under "Sent to the Mini/<date>/" so nothing is lost and nothing is sent twice. */
function fileSent(c, entry, item) {
  const day = new Date(c.now).toLocaleDateString("en-CA");
  const dir = path.join(c.root, SENT, day);
  fs.mkdirSync(dir, { recursive: true });
  const move = (src) => { if (!src || !fs.existsSync(src)) return; let dst = path.join(dir, path.basename(src)); if (fs.existsSync(dst)) dst += `-${Date.now()}`; fs.renameSync(src, dst); };
  if (item.dir) move(item.dir);
  else { move(item.video); if (item.captionFile && path.dirname(item.captionFile) === c.root) move(item.captionFile); }
}

const log = (c, rec) => {
  try { fs.appendFileSync(path.join(path.dirname(c.root), "publish-forward.log"), JSON.stringify({ at: new Date(c.now).toISOString(), ...rec }) + "\n"); } catch {}
};
function notify(c, msg) {
  if (!c.notify) return;
  spawnSync("osascript", ["-e", `display notification ${JSON.stringify(msg)} with title "Publish folder"`]);
}

function withLock(fn) {
  const lock = path.join(cacheDir(), "publish-forward.lock");
  fs.mkdirSync(cacheDir(), { recursive: true });
  try { if (Date.now() - fs.statSync(lock).mtimeMs > 3 * 3600000) fs.rmSync(lock, { recursive: true, force: true }); } catch {}
  try { fs.mkdirSync(lock); } catch { return { busy: true }; }
  try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

/** Send everything that is ready. Returns [{ entry, ok, why }]. */
export function runForward(over = {}) {
  const c = cfg(over);
  const locked = withLock(() => {
    const results = [];
    const stateFile = path.join(cacheDir(), "forward-state.json");
    let state = {}; try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
    for (const p of plan(over)) {
      if (!p.ready) { results.push({ entry: p.entry, ok: false, why: p.why, waiting: true }); continue; }
      const st = stageItem(p.item);
      let r;
      try { r = sendFolder(c, st.dir, st.name); } catch (e) { r = { ok: false, why: String(e.message || e) }; }
      if (st.temp) fs.rmSync(st.temp, { recursive: true, force: true });
      if (r.ok) {
        fileSent(c, p.entry, p.item);
        delete state[p.entry];
        notify(c, `Sent to the Mini: ${p.entry}. It posts at the next :45 check.`);
        log(c, { entry: p.entry, sent: true });
      } else {
        state[p.entry] = state[p.entry] || { firstFail: c.now };
        if (!state[p.entry].told && c.now - state[p.entry].firstFail > 15 * 60000) {
          state[p.entry].told = true;
          notify(c, `${p.entry} has not reached the Mini yet: ${r.why}`);
        }
        log(c, { entry: p.entry, sent: false, why: r.why });
      }
      results.push({ entry: p.entry, ...r });
    }
    try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}
    return results;
  });
  return locked.busy ? [{ entry: "(another run is sending)", ok: false, why: "busy", waiting: true }] : locked;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const cmd = process.argv[2] || "run";
  const c = cfg();
  if (cmd === "scan" || cmd === "status") {
    const items = plan();
    if (cmd === "status") {
      const r = c.host ? ssh(c, "echo up") : { status: 0, stdout: "local" };
      console.log(`Mini: ${r.status === 0 ? "answers" : "NOT answering"}  (${c.host || "local"}:${c.dest})`);
    }
    if (!items.length) console.log("Nothing waiting in", c.root);
    for (const p of items) console.log(`${p.ready ? "ready  " : "waiting"}  ${p.entry}${p.why ? `  (${p.why})` : ""}`);
  } else if (cmd === "run") {
    const res = runForward();
    for (const r of res) if (!r.waiting || r.why !== "busy") console.log(`${r.ok ? "sent   " : r.waiting ? "waiting" : "FAILED "}  ${r.entry}${r.why ? `  (${r.why})` : ""}`);
  } else { console.error("usage: publish-forward.mjs run|scan|status"); process.exit(2); }
}
