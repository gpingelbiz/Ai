/**
 * Where the tool keeps its files on the Mac, and how it reads and writes them.
 *
 *   ~/Library/Application Support/Opus Dropbox/
 *     config.json   Opus key, Dropbox sign-in, the two folders, options (mode 600: it holds the keys)
 *     state.json    every video the tool has seen and where it is (mode 600: it holds the share links)
 *     run.log       one JSON line per thing that happened
 *     app/          the tool itself (the installer copies it here)
 *
 * OPUS_DROPBOX_HOME moves all of it (the tests use a temp folder).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const home = () => process.env.OPUS_DROPBOX_HOME || path.join(os.homedir(), "Library", "Application Support", "Opus Dropbox");
export const configPath = () => path.join(home(), "config.json");
export const statePath = () => path.join(home(), "state.json");
export const logPath = () => path.join(home(), "run.log");

export const DEFAULTS = {
  folders: { drop: "", finished: "", done: "Done", needsLook: "Needs a look" },
  opus: { apiKey: "", orgId: "", project: {} },
  dropbox: { appKey: "", refreshToken: "", pathRoot: "", account: "" },
  maxInFlight: 3,
  stuckHours: 24,
  notify: true,
};

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
}

/** Write through a temp file and a rename, so a crash or a second run never leaves half a file. */
export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function loadConfig() {
  const c = readJSON(configPath(), {});
  return {
    ...DEFAULTS, ...c,
    folders: { ...DEFAULTS.folders, ...c.folders },
    opus: { ...DEFAULTS.opus, ...c.opus },
    dropbox: { ...DEFAULTS.dropbox, ...c.dropbox },
  };
}
export const saveConfig = (c) => writeJSON(configPath(), c);

export const loadState = () => readJSON(statePath(), { items: {} });
export const saveState = (s) => writeJSON(statePath(), s);

/** What is missing before the tool can run, in plain words ([] = ready). */
export function missing(c) {
  const out = [];
  if (!c.opus.apiKey) out.push("the Opus API key");
  if (!c.dropbox.appKey || !c.dropbox.refreshToken) out.push("the Dropbox sign-in");
  if (!c.folders.drop) out.push("the Dropbox folder videos are dropped in");
  if (!c.folders.finished) out.push("the Dropbox folder finished clips go to");
  return out;
}

/** One run at a time: launchd fires every few minutes and a hand run must not race it. A lock older than 2 hours is a crash. */
export function lock() {
  const dir = path.join(home(), ".lock");
  fs.mkdirSync(home(), { recursive: true });
  try { fs.mkdirSync(dir); }
  catch {
    let age = 0;
    try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch {}
    if (age < 2 * 3600 * 1000) return null;
    fs.rmSync(dir, { recursive: true, force: true });
    try { fs.mkdirSync(dir); } catch { return null; }
  }
  return () => fs.rmSync(dir, { recursive: true, force: true });
}

/** Append one line to run.log (trimmed to its last half once it passes 2 MB). */
export function log(event, fields = {}) {
  const file = logPath();
  fs.mkdirSync(home(), { recursive: true });
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) {
      const text = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, text.slice(text.indexOf("\n", text.length / 2) + 1));
    }
  } catch {}
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, ...fields }) + "\n");
}

/** A Mac notification. Text goes in as osascript arguments, never pasted into the script. */
export function notify(c, title, message) {
  if (!c.notify || process.env.OPUS_DROPBOX_NOTIFY === "0" || process.platform !== "darwin") return;
  spawnSync("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, message], { timeout: 10000 });
}
