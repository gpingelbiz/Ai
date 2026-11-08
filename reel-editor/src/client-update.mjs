import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { clientNotify, clientStatus } from "./client-status.mjs";
import { ensureDir, readJSON, writeJSON } from "./util.mjs";
import { stableRelease, releaseManifest, releaseId, newerRelease, validateManifest, verifyFiles, downloadArtifact, checkArchive } from "./release-feed.mjs";

export function command(cmd, args, cwd, env = process.env) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: args[0]?.endsWith("bootstrap-runtime.sh") ? 1800000 : 300000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]}: ${(r.stderr || r.error?.message || r.stdout || `exit ${r.status}`).trim().slice(-1500)}`);
  return (r.stdout || "").trim();
}

/** Only client installers opt in. No settings are copied, regenerated or read by this job. */
async function updateGitClient({ app, state, run = command, notify = clientNotify }) {
  ensureDir(state);
  const log = (line) => fs.appendFileSync(path.join(state, "updates.log"), `${new Date().toISOString()} ${line}\n`);
  const lock = path.join(state, "update.lock");
  try { fs.mkdirSync(lock); } catch {
    if (Date.now() - fs.statSync(lock).mtimeMs < 6 * 3600000) return { status: "locked" };
    fs.rmSync(lock, { recursive: true, force: true });
    try { fs.mkdirSync(lock); } catch { return { status: "locked" }; }
  }
  let before, changed = false, packages = false, repo;
  const git = (...args) => run("git", args, repo || app);
  const dirty = () => git("status", "--porcelain", "--untracked-files=all");
  const deps = () => run("npm", [fs.existsSync(path.join(app, "package-lock.json")) ? "ci" : "install", "--no-audit", "--no-fund", "--package-lock=false"], app);
  try {
    repo = git("rev-parse", "--show-toplevel");
    if (dirty()) {
      const message = "Update skipped: your code folder has uncommitted changes. Keep or commit them, then run the installer again.";
      log(message); notify("Reel Editor update skipped", message);
      return { status: "dirty" };
    }
    before = git("rev-parse", "HEAD");
    git("pull", "--ff-only");
    const after = git("rev-parse", "HEAD");
    changed = after !== before;
    if (!changed) { log("Already up to date."); return { status: "unchanged" }; }
    const rel = path.relative(repo, app);
    packages = Boolean(git("diff", "--name-only", before, after, "--", path.join(rel, "package.json"), path.join(rel, "package-lock.json")));
    if (packages) deps();
    run(process.execPath, [path.join(app, "scripts", "client-smoke.mjs")], app);
    fs.rmSync(path.join(state, "Update needs attention.txt"), { force: true });
    log(`Updated ${before} -> ${after}; self-check passed.`);
    notify("Reel Editor updated", "This week's fixes are installed. Your settings and brand files are kept.");
    return { status: "updated", before, after, packages };
  } catch (error) {
    let rollback = "No code was changed.";
    if (changed) {
      try {
        if (dirty()) throw new Error("new local changes appeared; code left untouched");
        // --keep refuses to overwrite work made since our first dirty-tree check.
        git("reset", "--keep", before);
        if (packages) deps();
        rollback = `Returned to ${before}.`;
      } catch (e) { rollback = `Automatic return stopped: ${e.message}. Please run the installer again after checking your code folder.`; }
    }
    const message = `Update failed: ${error.message}. ${rollback} See ${path.join(state, "updates.log")}`;
    log(message); fs.writeFileSync(path.join(state, "Update needs attention.txt"), message + "\n");
    notify("Reel Editor update needs attention", message);
    return { status: "failed", why: message };
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const read = (p) => { try { return readJSON(p); } catch { return null; } };
const linked = (p) => { try { return path.resolve(path.dirname(p), fs.readlinkSync(p)); } catch { return null; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function takeLock(lock) {
  ensureDir(path.dirname(lock));
  const tmp = `${lock}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid }));
  const claim = () => fs.linkSync(tmp, lock);
  try { claim(); } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (e.code !== "EEXIST") throw e;
    const owner = read(lock) || read(path.join(lock, "owner.json"));
    // Age alone cannot establish that a long-running updater has died.
    if (!Number.isInteger(owner?.pid) || owner.pid < 1) return null;
    try { process.kill(owner.pid, 0); return null; } catch (e) { if (e.code !== "ESRCH") return null; }
    fs.rmSync(lock, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid }));
    try { claim(); } catch { fs.rmSync(tmp, { force: true }); return null; }
  }
  fs.rmSync(tmp, { force: true });
  return () => fs.rmSync(lock, { recursive: true, force: true });
}

function point(link, target) {
  const tmp = `${link}.${process.pid}.tmp`;
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(target, tmp);
  fs.renameSync(tmp, link);
}

export function releaseEnvironment(manifest, { home = os.homedir(), env = process.env } = {}) {
  const runtime = path.join(home, ".local/share/reel-editor/runtime", manifest.runtime.id);
  return { ...env, HOME: home, REEL_RUNTIME: runtime, REEL_RELEASE: manifest.id, REEL_CLIENT_MODE: "1",
    REEL_PYTHON: path.join(runtime, "venv/bin/python"),
    PATH: [path.join(runtime, "bin"), path.join(home, ".local/bin"), env.PATH || "/usr/bin:/bin"].join(":"),
    HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" };
}

function releaseInUse(dir) {
  const r = spawnSync("/usr/sbin/lsof", ["-t", "+D", dir], { encoding: "utf8", timeout: 30000 });
  // If the open-file check cannot run, keep the old copy.
  return !(r.status === 1 && !r.stdout && !r.stderr && !r.error);
}

export async function updateRelease({ app, state, home = os.homedir(), env = process.env, run = command,
  notify = clientNotify, feed, fetcher, wait = sleep, lockWaitMs = 30 * 60 * 1000, inUse = releaseInUse } = {}) {
  ensureDir(state);
  const base = path.join(home, ".local/share/reel-editor"), releases = ensureDir(path.join(base, "releases"));
  const current = path.join(base, "current"), previous = path.join(base, "previous");
  const transaction = path.join(state, "update-transaction.json"), failedFile = path.join(state, "failed-release.json");
  const barrier = path.join(home, ".reel/maintenance/update.lock");
  const log = (line) => fs.appendFileSync(path.join(state, "updates.log"), `${new Date().toISOString()} ${line}\n`);
  const status = (message) => {
    clientStatus({ state, root: state }, "update", message);
    const studio = env.REEL_STUDIO || path.join(home, "Content Studio");
    if (exists(path.join(studio, "studio.json"))) clientStatus({ state: path.join(studio, ".studio"), root: studio }, "update", message);
    log(message);
  };
  const unlock = takeLock(path.join(state, "updater.lock"));
  if (!unlock) return { status: "locked" };
  let releaseBarrier, tx, candidate, swapped = false, txSafe = false;
  const folder = (id) => {
    if (!releaseId(id) && !/^legacy-[A-Za-z0-9._-]+$/.test(id || "")) throw new Error("The saved update information needs checking. Run the installer again.");
    return path.join(releases, id);
  };
  const activeId = () => {
    const target = linked(current);
    if (!target || path.dirname(target) !== releases) throw new Error("The active editor folder needs checking. Run the installer again.");
    folder(path.basename(target)); return path.basename(target);
  };
  const jobsBusy = () => [path.join(env.REEL_WATCH_ROOT || path.join(home, "Reels"), "videos/.seen/.lock"),
    path.join(env.REEL_STUDIO || path.join(home, "Content Studio"), ".studio/run.lock")].some(exists);
  const idleBarrier = async () => {
    const start = Date.now();
    while (true) {
      if (!jobsBusy()) {
        releaseBarrier ||= takeLock(barrier);
        if (!releaseBarrier) return false;
        // Jobs check the barrier after taking their own lock, closing the admission race.
        if (!jobsBusy()) return true;
      }
      if (Date.now() - start >= lockWaitMs) return false;
      await wait(Math.min(1000, Math.max(1, lockWaitMs - (Date.now() - start))));
    }
  };
  const save = (phase) => { tx.phase = phase; writeJSON(transaction, tx); };
  const smoke = (dir, m) => {
    const e = releaseEnvironment(m, { home, env });
    if (!exists(path.join(e.REEL_RUNTIME, ".complete"))) throw new Error("The tools for this update are not ready.");
    run(path.join(e.REEL_RUNTIME, "bin/node"), [path.join(dir, "scripts/client-smoke.mjs")], dir, e);
  };
  const activate = (dir, m) => {
    const e = releaseEnvironment(m, { home, env });
    // This doctor mode checks only local release/runtime rows and must fail on a bad row.
    run(path.join(e.REEL_RUNTIME, "bin/node"), [path.join(dir, "bin/reel.mjs"), "doctor", "--release-only"], dir, e);
    smoke(dir, m);
  };
  const rollback = () => {
    if (!exists(path.join(folder(tx.from), ".complete"))) throw new Error("The previous editor is missing. Run the installer again.");
    point(current, folder(tx.from));
    if (tx.oldPrevious) point(previous, folder(tx.oldPrevious)); else fs.rmSync(previous, { force: true });
    swapped = false;
  };
  const rememberFailure = () => writeJSON(failedFile, { id: tx.to, at: new Date().toISOString() });
  const prune = () => {
    if (jobsBusy()) return;
    const keep = new Set([linked(current), linked(previous)]);
    for (const name of fs.readdirSync(releases)) {
      const dir = path.join(releases, name);
      // Old git folders are archives of the client's work; they are never disposable releases.
      if (releaseId(name) && !keep.has(dir) && fs.lstatSync(dir).isDirectory() && exists(path.join(dir, ".complete")) && !inUse(dir)) {
        try { fs.rmSync(dir, { recursive: true }); } catch { log(`Old release ${name} was kept because it could not be removed.`); }
      }
    }
  };
  try {
    tx = read(transaction);
    if (exists(transaction) && !tx) throw new Error("The saved update information needs checking. Run the installer again.");
    if (tx) {
      folder(tx.from); folder(tx.to); if (tx.oldPrevious) folder(tx.oldPrevious);
      if (!releaseId(tx.to)) throw new Error("The saved update information needs checking. Run the installer again.");
      if (!["preparing", "ready", "switching", "switched", "committed"].includes(tx.phase)) throw new Error("The saved update information needs checking. Run the installer again.");
      const active = activeId();
      if (![tx.from, tx.to].includes(active)) throw new Error("The active editor changed during an update. Run the installer again.");
      if (["preparing", "ready"].includes(tx.phase) && active !== tx.from || tx.phase === "committed" && active !== tx.to) throw new Error("The active editor changed during an update. Run the installer again.");
      txSafe = true;
      if (["switching", "switched"].includes(tx.phase)) {
        if (!await idleBarrier()) { status("Update waiting for editing to finish."); return { status: "busy" }; }
        swapped = true;
        rollback(); rememberFailure(); fs.rmSync(transaction);
        status("The last update did not finish. Your previous editor has been restored.");
        return { status: "recovered", before: tx.to, after: tx.from };
      }
      if (tx.phase === "committed") {
        if (active !== tx.to) throw new Error("The active editor changed after an update. Run the installer again.");
        if (!await idleBarrier()) return { status: "busy" };
        prune(); fs.rmSync(transaction); status(`Editing ready (release ${tx.to}).`);
        return { status: "recovered", after: tx.to };
      }
      if (active !== tx.from) throw new Error("The active editor changed before the update was ready.");
      if (tx.phase === "preparing") {
        fs.rmSync(path.join(releases, `.update-${tx.to}`), { recursive: true, force: true });
        const unfinished = folder(tx.to);
        if (exists(unfinished) && !exists(path.join(unfinished, ".complete"))) fs.rmSync(unfinished, { recursive: true, force: true });
        fs.rmSync(transaction); tx = null;
      }
    }
    if (!tx) {
      const from = activeId(), stable = await stableRelease({ feed, fetcher });
      if (!newerRelease(stable.id, from)) { log("Already up to date."); return { status: "unchanged" }; }
      const failed = read(failedFile);
      if (failed?.id && !newerRelease(stable.id, failed.id)) return { status: "failed-id", id: stable.id };
      const { manifest, bytes } = await releaseManifest(stable, { fetcher });
      tx = { phase: "preparing", from, to: manifest.id, manifestSha256: stable.sha256, oldPrevious: linked(previous) ? path.basename(linked(previous)) : null };
      if (tx.oldPrevious) folder(tx.oldPrevious);
      txSafe = true;
      save("preparing");
      const stage = path.join(releases, `.update-${tx.to}`), dest = folder(tx.to);
      fs.rmSync(stage, { recursive: true, force: true }); ensureDir(stage);
      if (!exists(path.join(dest, ".complete"))) {
        if (exists(dest)) throw new Error("An unfinished editor folder needs checking. Run the installer again.");
        const archive = path.join(stage, manifest.artifact.name);
        await downloadArtifact(manifest, archive, { fetcher });
        await checkArchive(archive);
        run("/usr/bin/tar", ["-xzf", archive, "-C", stage], stage);
        const unpacked = path.join(stage, "reel-editor");
        verifyFiles(unpacked, manifest);
        fs.writeFileSync(path.join(unpacked, "release.json"), bytes);
        fs.renameSync(unpacked, dest);
      } else verifyFiles(dest, manifest);
      // The bootstrap verifies every tool itself and writes its marker only after all tools are ready.
      const e = releaseEnvironment(manifest, { home, env });
      if (!exists(path.join(e.REEL_RUNTIME, ".complete"))) {
        const bootstrapEnv = { ...e }; delete bootstrapEnv.HF_HUB_OFFLINE; delete bootstrapEnv.TRANSFORMERS_OFFLINE;
        run("/bin/bash", [path.join(dest, "scripts/bootstrap-runtime.sh"), "--app", dest, "--home", home], dest, bootstrapEnv);
      }
      smoke(dest, manifest);
      fs.writeFileSync(path.join(dest, ".complete"), `${manifest.id}\n`);
      fs.rmSync(stage, { recursive: true, force: true }); save("ready");
    }
    candidate = folder(tx.to);
    if (tx.manifestSha256 && createHash("sha256").update(fs.readFileSync(path.join(candidate, "release.json"))).digest("hex") !== tx.manifestSha256.toLowerCase()) throw new Error("The prepared update information no longer matches its safety check.");
    const manifest = readJSON(path.join(candidate, "release.json"));
    validateManifest(manifest);
    if (manifest.id !== tx.to || !exists(path.join(candidate, ".complete"))) throw new Error("The prepared update is incomplete.");
    verifyFiles(candidate, manifest); smoke(candidate, manifest);
    if (!await idleBarrier()) { status("Update waiting for editing to finish."); return { status: "busy", id: tx.to }; }
    if (activeId() !== tx.from) throw new Error("The active editor changed while the update was waiting.");
    save("switching");
    point(previous, folder(tx.from)); point(current, candidate); swapped = true; save("switched");
    activate(candidate, manifest);
    save("committed"); prune(); fs.rmSync(transaction);
    fs.rmSync(path.join(state, "Update needs attention.txt"), { force: true });
    status(`Editing ready (release ${tx.to}).`);
    notify("Reel Editor updated", "This week's fixes are installed. Your settings and brand files are kept.");
    return { status: "updated", before: tx.from, after: tx.to };
  } catch (error) {
    if (txSafe && tx?.phase === "committed") {
      log(`Release ${tx.to} passed activation; cleanup will resume: ${error.message}`);
      return { status: "updated", before: tx.from, after: tx.to };
    }
    let restored = !swapped;
    if (txSafe && (swapped || releaseBarrier && ["switching", "switched"].includes(tx?.phase))) {
      try { rollback(); restored = true; } catch { restored = false; }
    }
    if (txSafe && tx && restored) {
      rememberFailure(); fs.rmSync(transaction, { force: true });
      fs.rmSync(path.join(releases, `.update-${tx.to}`), { recursive: true, force: true });
      const unfinished = folder(tx.to);
      if (activeId() !== tx.to && exists(unfinished) && !exists(path.join(unfinished, ".complete"))) fs.rmSync(unfinished, { recursive: true, force: true });
      if (releaseBarrier) prune();
    }
    const message = restored ? "This update could not be installed. Your previous editor is kept. Ask Greg if this message returns." : "This update needs help. Run your installer again before editing.";
    log(`Update failed: ${error.message}`); status(message);
    fs.writeFileSync(path.join(state, "Update needs attention.txt"), message + "\n");
    notify("Reel Editor update needs attention", message);
    return { status: "failed", why: message };
  } finally { releaseBarrier?.(); unlock(); }
}

/** Release clients never run git or npm; older installs keep their existing update path. */
export async function updateClient(options) {
  const home = options.home || os.homedir(), env = options.env || process.env;
  if (exists(path.join(home, ".local/share/reel-editor/current")) && env.REEL_RELEASE !== "dev") return updateRelease({ ...options, home, env });
  if (env.REEL_CLIENT_MODE === "1" || env.REEL_CLIENT || exists(path.join(options.state, "client.json"))) {
    try {
      const stable = await stableRelease({ feed: options.feed, fetcher: options.fetcher });
      if (newerRelease(stable.id, env.REEL_RELEASE)) {
        ensureDir(options.state);
        const message = "A new installer is ready, ask Greg for your updated kit";
        clientStatus({ state: options.state, root: options.state }, "update", message);
        const studio = env.REEL_STUDIO || path.join(home, "Content Studio");
        if (exists(path.join(studio, "studio.json"))) clientStatus({ state: path.join(studio, ".studio"), root: studio }, "update", message);
      }
    } catch {} // An offline feed must not change the legacy git behavior.
  }
  return updateGitClient(options);
}
