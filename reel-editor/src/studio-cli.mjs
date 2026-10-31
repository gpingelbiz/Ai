import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { loadStudio, studioPaths, studioDir, initStudio, readPosts, withDefaults, checkStudio, photosDir } from "./content-studio.mjs";
import { photoPool, pickPhotos, contactSheet, markUsed, photoKey, skipSummary } from "./photos.mjs";
import { readJSON, PKG_ROOT, ensureDir } from "./util.mjs";

/** `reel photos`, `reel daily` and `reel studio`: the Content Studio commands. */

export const STUDIO_USAGE = `Content Studio (a client's folder that makes and schedules their posts; never Greg's own setup)
  reel photos [status|check|sheet|pick <n>|use <file>...] [--studio <dir>] [--limit 36]
                                    the photo folder: what is usable, what was skipped and why, a contact sheet,
                                    the next picks; "use" marks photos as spent (they are never offered again)
  reel daily [--studio <dir>] [--dry-run] [--no-publish] [--only carousel|static] [--limit <n>] [--day YYYY-MM-DD]
                                    fill every open posting slot in the next days: job from the brand guide's mix,
                                    copy in the client's voice (Claude), unused photos, slides in their brand,
                                    a copy in Made/, scheduled into their Metricool
  reel studio init <dir> [--brand <Brand folder>] [--client "<name>"]   make a studio folder
  reel studio status [--studio <dir>]                                    settings check, last posts, photo pool
  reel studio reels [--studio <dir>]                                     edit and schedule the clips in Raw Reels
  reel studio agents [--studio <dir>] [--uninstall]                      the daily job and the Raw Reels watcher (launchd)
  The studio is --studio, else $REEL_STUDIO, else ~/Content Studio.`;

const opt = (args, options) => parseArgs({ args, options: { studio: { type: "string" }, help: { type: "boolean", short: "h" }, ...options }, allowPositionals: true, strict: true });

export async function photosCommand(args) {
  const { values, positionals } = opt(args, { limit: { type: "string" }, out: { type: "string" }, post: { type: "string" }, folder: { type: "string" } });
  if (values.help) return console.log(STUDIO_USAGE);
  const paths = studioPaths(values.studio);
  const config = fs.existsSync(paths.config) ? withDefaults(readJSON(paths.config)) : withDefaults({});
  const dir = values.folder ? path.resolve(values.folder) : photosDir(config, paths);
  const pool = await photoPool(dir, { checksFile: paths.checks, ledgerFile: paths.used });
  const [cmd = "status", ...rest] = positionals;
  if (cmd === "status") {
    console.log(`photos in ${dir}: ${pool.all.length}`);
    console.log(`  ready to post: ${pool.usable.length}`);
    console.log(`  already used: ${pool.used.length}`);
    console.log(`  skipped: ${pool.skipped.length}${pool.skipped.length ? ` (${skipSummary(pool.skipped)})` : ""}`);
    return;
  }
  if (cmd === "check") {
    for (const p of pool.all) console.log(`${p.used ? "USED " : p.why ? "SKIP " : "OK   "} ${p.rel}${p.why ? `  (${p.why})` : `  score ${p.score}${(p.faces || []).length ? `, ${p.faces.length} face${p.faces.length > 1 ? "s" : ""}` : ", no face"}`}`);
    return;
  }
  if (cmd === "sheet") {
    const list = pool.usable.slice(0, Number(values.limit || 36));
    if (!list.length) return console.log("no unused photos to show");
    const out = path.resolve(values.out || path.join(ensureDir(paths.work), "photo-sheet.jpg"));
    await contactSheet(list.map((p) => p.file), out);
    list.forEach((p, i) => console.log(`${i + 1}. ${p.rel}`));
    return console.log(out);
  }
  if (cmd === "pick") {
    for (const p of pickPhotos(pool.usable, Number(rest[0] || 1))) console.log(p.file);
    return;
  }
  if (cmd === "use") {
    const files = rest.map((f) => path.resolve(f));
    if (!files.length) throw new Error("reel photos use <file> [<file> ...]");
    markUsed(paths.used, files.map((file) => ({ file, key: photoKey(file) })), { post: values.post || "by hand", date: new Date().toISOString().slice(0, 10) });
    return console.log(`marked ${files.length} photo${files.length > 1 ? "s" : ""} as used`);
  }
  throw new Error(`unknown photos command: ${cmd}`);
}

export async function dailyCommand(args) {
  const { values } = opt(args, { "dry-run": { type: "boolean" }, "no-publish": { type: "boolean" }, only: { type: "string" }, limit: { type: "string" }, day: { type: "string" } });
  if (values.help) return console.log(STUDIO_USAGE);
  if (values.only && !["carousel", "static"].includes(values.only)) throw new Error("--only is carousel or static");
  if (values.day && !/^\d{4}-\d{2}-\d{2}$/.test(values.day)) throw new Error("--day is a date like 2026-11-02");
  const { runDaily, dailySummary } = await import("./daily.mjs");
  const r = await runDaily(values.studio, { dryRun: values["dry-run"], noPublish: values["no-publish"], only: values.only || null, limit: values.limit ? Number(values.limit) : null, day: values.day || null });
  console.log(dailySummary(r));
  if (r.made?.some((x) => x.status === "failed" || x.status === "not-posted")) process.exitCode = 1;
}

/* ---------- launchd ---------- */

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const slugOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The agents' name for a studio: its folder, or, for a folder called "Content Studio" inside a client folder (Greg's
 * Mac, ~/Reels/clients/<client>/Content Studio), the client folder, so two clients' studios never share a label.
 * A studio in the home folder (a client's own Mac) keeps "content-studio".
 */
export function agentSlug(root, home = os.homedir()) {
  const base = slugOf(path.basename(root)) || "content-studio";
  const parent = path.dirname(path.resolve(root));
  return base === "content-studio" && parent !== path.resolve(home) && slugOf(path.basename(parent)) ? slugOf(path.basename(parent)) : base;
}

/** The two launchd agents: the daily run (every morning) and the Raw Reels and Publish watcher (on every drop, and hourly). */
export function studioAgents(root, { node = process.execPath, hour = 6, minute = 7, home = os.homedir() } = {}) {
  const slugged = agentSlug(root, home);
  const bin = path.join(PKG_ROOT, "bin", "reel.mjs");
  const log = path.join(root, ".studio", "launchd.log");
  // launchd starts with a bare PATH: node, claude (~/.local/bin), ffmpeg and cloudflared have to be findable.
  const env = { PATH: [path.dirname(node), path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"), REEL_STUDIO: root, PRODUCER_BROWSER_GPU_MODE: "hardware" };
  const plist = ({ label, args, extra }) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`).join("\n")}
  </dict>
${extra}
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
  return [
    { label: `com.pingel.content-studio.daily.${slugged}`, plist: plist({ label: `com.pingel.content-studio.daily.${slugged}`, args: [node, bin, "daily", "--studio", root], extra: `  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>\n  <key>RunAtLoad</key><false/>` }) },
    { label: `com.pingel.content-studio.reels.${slugged}`, plist: plist({ label: `com.pingel.content-studio.reels.${slugged}`, args: [node, bin, "studio", "reels", "--studio", root], extra: `  <key>WatchPaths</key><array><string>${xml(path.join(root, "Raw Reels"))}</string><string>${xml(path.join(root, "Publish"))}</string></array>\n  <key>StartInterval</key><integer>3600</integer>\n  <key>ThrottleInterval</key><integer>60</integer>\n  <key>RunAtLoad</key><false/>` }) },
  ];
}

export function installAgents(root, { uninstall = false } = {}) {
  const dir = path.join(os.homedir(), "Library", "LaunchAgents");
  const uid = process.getuid();
  const out = [];
  // Agents installed before agentSlug under the generic "content-studio" name for THIS studio: removed, so the
  // folder never has two watchers.
  for (const kind of ["daily", "reels"]) {
    const label = `com.pingel.content-studio.${kind}.content-studio`;
    const file = path.join(dir, `${label}.plist`);
    if (studioAgents(root)[0].label.endsWith(".content-studio") || !fs.existsSync(file)) continue;
    if (!fs.readFileSync(file, "utf8").includes(`<string>${xml(root)}</string>`)) continue;
    spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "ignore" });
    fs.rmSync(file, { force: true });
    out.push(`removed the old ${label}`);
  }
  for (const a of studioAgents(root)) {
    const file = path.join(dir, `${a.label}.plist`);
    spawnSync("launchctl", ["bootout", `gui/${uid}/${a.label}`], { stdio: "ignore" });
    if (uninstall) { fs.rmSync(file, { force: true }); out.push(`removed ${a.label}`); continue; }
    ensureDir(dir);
    fs.writeFileSync(file, a.plist);
    const r = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, file], { encoding: "utf8" });
    out.push(r.status === 0 ? `on: ${a.label}` : `could not start ${a.label}: ${(r.stderr || "").trim()}`);
  }
  return out;
}

export async function studioCommand(args) {
  const [cmd, ...rest] = args;
  if (!cmd || cmd === "help" || cmd === "--help") return console.log(STUDIO_USAGE);
  if (cmd === "init") {
    const { values, positionals } = opt(rest, { brand: { type: "string" }, client: { type: "string" } });
    const dir = studioDir(positionals[0] || values.studio);
    const paths = initStudio(dir, { brandFrom: values.brand ? path.resolve(values.brand) : null, config: values.client ? { client: values.client } : {} });
    return console.log(paths.root);
  }
  if (cmd === "status") {
    const { values } = opt(rest, {});
    const paths = studioPaths(values.studio);
    if (!fs.existsSync(paths.config)) return console.log(`no studio at ${paths.root}`);
    const problems = checkStudio(readJSON(paths.config));
    console.log(problems.length ? `studio.json needs fixing:\n- ${problems.join("\n- ")}` : `studio.json: OK (${paths.root})`);
    const posts = readPosts(paths).sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`)).slice(-10);
    for (const p of posts) console.log(`  ${p.day} ${p.time} ${p.format.padEnd(8)} ${p.status.padEnd(10)} ${p.hook || ""}${p.why ? ` (${p.why})` : ""}`);
    await photosCommand(["status", "--studio", paths.root]);
    return;
  }
  if (cmd === "reels") {
    const { values } = opt(rest, {});
    const { runReels } = await import("./studio-reels.mjs");
    const results = await runReels(values.studio);
    for (const r of results) console.log(`${r.clip || r.hook || r.id}: ${r.status}${r.plannerUrl ? ` ${r.plannerUrl}` : ""}${r.why ? ` (${r.why})` : ""}`);
    return;
  }
  if (cmd === "agents") {
    const { values } = opt(rest, { uninstall: { type: "boolean" } });
    const root = loadStudio(values.studio).paths.root;
    for (const line of installAgents(root, { uninstall: values.uninstall })) console.log(line);
    return;
  }
  throw new Error(`unknown studio command: ${cmd}`);
}
