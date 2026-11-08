import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureDir } from "./util.mjs";
import { currentRelease } from "./release.mjs";

export const guideReady = (guide) => Boolean(String(guide || "").trim()) && !/NOT FILLED IN YET/i.test(guide);
export const clientNotify = (title, message) => {
  try { spawnSync("osascript", ["-e", `display notification ${JSON.stringify(String(message).slice(0, 700))} with title ${JSON.stringify(title)}`], { timeout: 10000 }); } catch {}
};

const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const atomic = (file, text) => {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, text); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
};
const PARTS = ["storage", "editing", "posting", "updates"];
const partFor = (job) => /update/.test(job) ? "updates" : job === "storage" ? job : /publish|post|daily|filming|routine|stor(?:y|ies)/.test(job) ? "posting" : "editing";

function composeLock(dir) {
  const lock = path.join(dir, ".compose.lock"), reaper = path.join(dir, ".recover.lock");
  const started = Date.now(), pause = new Int32Array(new SharedArrayBuffer(4));
  const dead = () => {
    const pid = read(path.join(lock, "owner.json"), {}).pid;
    if (!Number.isInteger(pid) || pid < 1) return false;
    try { process.kill(pid, 0); return false; } catch (e) { return e.code === "ESRCH"; }
  };
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
      return () => fs.rmSync(lock, { recursive: true, force: true });
    } catch (e) { if (e.code !== "EEXIST") throw e; }
    if (dead()) {
      let claimed = false;
      try {
        fs.mkdirSync(reaper); claimed = true;
        if (dead()) fs.rmSync(lock, { recursive: true, force: true });
      } catch (e) { if (e.code !== "EEXIST") throw e; }
      finally { if (claimed) fs.rmdirSync(reaper); }
    }
    if (Date.now() - started > 10000) throw new Error("The status check is busy. Please try again.");
    Atomics.wait(pause, 0, 0, 10);
  }
}

/** Separate parts and one short compose lock keep simultaneous writers from losing a line. */
export function clientStatus(paths, job, message, now = new Date(), { home = paths.home, action, part = partFor(job) } = {}) {
  if (!PARTS.includes(part)) throw new Error("Unknown status part");
  if (!home && process.env.REEL_CLIENT_MODE === "1") home = os.homedir();
  // Standalone studios outside the home folder keep their status beside their own state.
  const dir = ensureDir(paths.statusDir || (home ? path.join(home, ".reel/maintenance/status") : path.join(paths.state, "status")));
  const unlock = composeLock(dir);
  try {
    const file = path.join(dir, `${part}.json`), entries = read(file, {});
    const needsAction = /wait|fail|needs|held|hold|not.posted|unknown|missing|skipped|disconnect|paused|check|open|not finished|cannot|nearly full|interrupt|uncertain|attention|draft|blocked|unfinished|unavailable|not ready|stopped/i.test(String(message)) && !/^OK\. All checks passed\.$/i.test(String(message));
    const label = part === "updates" ? "update" : part;
    const nextAction = action ?? (needsAction ? `Read the ${label} note below.` : "All good");
    entries[job] = { job, checked: now.toISOString(), message: String(message), action: String(nextAction).split("\n")[0] };
    atomic(file, JSON.stringify(entries, null, 2) + "\n");
    const status = PARTS.flatMap((name) => Object.values(read(path.join(dir, `${name}.json`), {})));
    const next = status.find((entry) => entry.action !== "All good")?.action || "All good";
    let release = "unknown";
    try { release = currentRelease().id; } catch {}
    const checked = status.map((entry) => entry.checked).sort().at(-1) || now.toISOString();
    const content = `${checked} Reel Editor (release ${release}) ${next}\n` + status.map((entry) => `${entry.checked} ${entry.job}: ${entry.message}`).join("\n") + "\n";
    const targetsFile = path.join(dir, ".targets.json");
    const targets = [...new Set([...read(targetsFile, []), path.join(paths.root, "STATUS.txt"), path.join(path.dirname(dir), "STATUS.txt")])];
    atomic(targetsFile, JSON.stringify(targets) + "\n");
    for (const target of targets) atomic(target, content);
    return { file, action: next };
  } finally { unlock(); }
}
