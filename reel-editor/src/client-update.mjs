import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { clientNotify } from "./client-status.mjs";
import { ensureDir } from "./util.mjs";

export function command(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 300000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]}: ${(r.stderr || r.error?.message || r.stdout || `exit ${r.status}`).trim().slice(-1500)}`);
  return (r.stdout || "").trim();
}

/** Only client installers opt in. No settings are copied, regenerated or read by this job. */
export async function updateClient({ app, state, run = command, notify = clientNotify }) {
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
