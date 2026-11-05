/**
 * The LaunchAgent that runs one pass every 5 minutes while the Mac is awake (a closed laptop catches up when it
 * wakes). It only touches the tool's own folder in Application Support, so macOS never asks for Desktop or
 * Documents access.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const LABEL = "com.pingel.opus-dropbox";
export const plistPath = () => path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const domain = () => `gui/${process.getuid()}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function plist({ node, script, home, interval = 300 }) {
  const env = process.env.OPUS_DROPBOX_HOME ? `
  <key>EnvironmentVariables</key>
  <dict><key>OPUS_DROPBOX_HOME</key><string>${esc(process.env.OPUS_DROPBOX_HOME)}</string></dict>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${esc(node)}</string><string>${esc(script)}</string><string>run</string></array>
  <key>StartInterval</key><integer>${interval}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(path.join(home, "launchd.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(home, "launchd.log"))}</string>${env}
</dict>
</plist>
`;
}

export function install(opts) {
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  fs.writeFileSync(plistPath(), plist(opts));
  start();
}

export function stop() {
  spawnSync("launchctl", ["bootout", `${domain()}/${LABEL}`]);
}

/** (Re)load the job. Right after a bootout launchd can still be unloading it and answer error 5, so try a few times. */
export function start() {
  if (!fs.existsSync(plistPath())) throw new Error("the background job is not set up yet: run setup first");
  stop();
  let r;
  for (let i = 0; i < 4; i++) {
    r = spawnSync("launchctl", ["bootstrap", domain(), plistPath()], { encoding: "utf8" });
    if (r.status === 0) return;
    spawnSync("sleep", ["1"]);
  }
  throw new Error(`launchctl bootstrap failed: ${(r.stderr || r.stdout || "").trim()}`);
}

export const loaded = () => spawnSync("launchctl", ["print", `${domain()}/${LABEL}`], { encoding: "utf8" }).status === 0;


// The page has its own agent. Pausing the run job leaves the page available.
export const PANEL_LABEL = "com.pingel.opus-dropbox-panel";
export const panelPlistPath = () => path.join(process.env.HOME || os.homedir(), "Library", "LaunchAgents", `${PANEL_LABEL}.plist`);
export const shortcutPath = () => path.join(process.env.HOME || os.homedir(), "Desktop", "Opus Command Center.webloc");
export function panelPlist(opts) {
  return plist(opts).replaceAll(LABEL, PANEL_LABEL).replace("<string>run</string>", "<string>panel</string>")
    .replace(/<key>StartInterval<\/key><integer>\d+<\/integer>/, "<key>KeepAlive</key><true/>")
    .replaceAll("launchd.log", "panel.log");
}
export function installPanel(opts, { launch = spawnSync } = {}) {
  fs.mkdirSync(opts.home, { recursive: true });
  const file = panelPlistPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, panelPlist(opts));
  fs.mkdirSync(path.dirname(shortcutPath()), { recursive: true });
  fs.writeFileSync(shortcutPath(), '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>URL</key><string>http://127.0.0.1:53690</string></dict></plist>\n');
  launch("launchctl", ["bootout", `${domain()}/${PANEL_LABEL}`]);
  let r;
  for (let i = 0; i < 4; i++) {
    r = launch("launchctl", ["bootstrap", domain(), file], { encoding: "utf8" });
    if (r.status === 0) return;
    if (i < 3) launch("sleep", ["1"]);
  }
  throw new Error(`Could not start the command center: ${r.stderr || r.error?.message || "launchctl failed"}`);
}
export function uninstallPanel({ launch = spawnSync } = {}) {
  launch("launchctl", ["bootout", `${domain()}/${PANEL_LABEL}`]);
  fs.rmSync(panelPlistPath(), { force: true });
  fs.rmSync(shortcutPath(), { force: true });
}
