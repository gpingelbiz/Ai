#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { updateClient } from "../src/client-update.mjs";
import { studioHealth } from "../src/studio-health.mjs";
import { ensureDir, readJSON, writeJSON, PKG_ROOT } from "../src/util.mjs";

const xml = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function maintenanceAgents({ app = PKG_ROOT, home = os.homedir(), state = path.join(home, ".reel", "maintenance"), studio = false, node = process.execPath } = {}) {
  const suffix = createHash("sha256").update(path.resolve(app)).digest("hex").slice(0, 12);
  return ["update", ...studio ? [] : ["health"]].map((job) => {
    const label = `com.pingel.reel-client.${job}.${suffix}`;
    const args = [node, path.join(app, "scripts", "client-maintenance.mjs"), job, "--state", state];
    const schedule = job === "update" ? "<dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>5</integer><key>Minute</key><integer>17</integer></dict>" : [9, 13, 18].map((h) => `<dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>23</integer></dict>`).join("");
    return { label, plist: `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml([path.dirname(node), path.join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":"))}</string></dict><key>StartCalendarInterval</key><array>${schedule}</array><key>StandardOutPath</key><string>${xml(path.join(state, `${job}.log`))}</string><key>StandardErrorPath</key><string>${xml(path.join(state, `${job}.log`))}</string></dict></plist>\n` };
  });
}

export function installMaintenance({ app = PKG_ROOT, home = os.homedir(), state = path.join(home, ".reel", "maintenance"), studio = false, watch = true, run = spawnSync } = {}) {
  ensureDir(state);
  let previous = null;
  try { previous = readJSON(path.join(state, "client.json")); } catch {}
  writeJSON(path.join(state, "client.json"), { app, dropFolders: watch ? ["raw", "raw-broll", "raw-carousel", "raw-long", "raw-youtube", "raw-runway"].map((d) => path.join(home, "Reels", d)) : [] });
  const agents = maintenanceAgents({ app, home, state, studio });
  const all = [...new Map([
    ...maintenanceAgents({ app, home, state }),
    ...previous?.app && previous.app !== app ? maintenanceAgents({ app: previous.app, home, state }) : [],
  ].map((a) => [a.label, a])).values()];
  const dir = ensureDir(path.join(home, "Library", "LaunchAgents"));
  for (const a of all) {
    const file = path.join(dir, `${a.label}.plist`);
    run("launchctl", ["bootout", `gui/${process.getuid()}/${a.label}`], { stdio: "ignore" });
    if (!agents.some((x) => x.label === a.label)) { fs.rmSync(file, { force: true }); continue; }
    fs.writeFileSync(file, a.plist);
    const r = run("launchctl", ["bootstrap", `gui/${process.getuid()}`, file], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`Could not start ${a.label}: ${r.stderr || r.error?.message || r.status}`);
  }
  return agents;
}

async function main() {
  const [job, ...args] = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const state = option("--state") || path.join(os.homedir(), ".reel", "maintenance");
  if (job === "install") { installMaintenance({ app: option("--app") || PKG_ROOT, state, studio: args.includes("--studio"), watch: !args.includes("--no-watch") }); return; }
  const config = readJSON(path.join(state, "client.json"));
  if (job === "update") { const result = await updateClient({ app: config.app, state }); if (result.status === "failed") process.exitCode = 1; return; }
  if (job === "health") { const r = await studioHealth(state, { dropFolders: config.dropFolders }); if (r.issues.length) process.exitCode = 1; return; }
  throw new Error("client-maintenance: install, update or health");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
