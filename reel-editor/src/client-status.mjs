import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, readJSON, writeJSON } from "./util.mjs";
import { currentRelease } from "./release.mjs";

export const guideReady = (guide) => Boolean(String(guide || "").trim()) && !/NOT FILLED IN YET/i.test(guide);
export const clientNotify = (title, message) => {
  try { spawnSync("osascript", ["-e", `display notification ${JSON.stringify(String(message).slice(0, 700))} with title ${JSON.stringify(title)}`], { timeout: 10000 }); } catch {}
};

/** Each job owns one status line, so a health sweep cannot erase a filming-pack hold. */
export function clientStatus(paths, job, message, now = new Date()) {
  ensureDir(paths.state);
  const file = path.join(paths.state, "status.json");
  let status = {};
  try { status = readJSON(file); } catch {}
  status[job] = `${now.toISOString()} ${job}: ${message}`;
  writeJSON(file, status);
  let release = "unknown";
  try { release = currentRelease().id; } catch {}
  fs.writeFileSync(path.join(paths.root, "STATUS.txt"), `Reel Editor (release ${release})\n` + Object.values(status).join("\n") + "\n");
}
