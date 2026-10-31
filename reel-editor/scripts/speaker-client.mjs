#!/usr/bin/env node
// Speaker intake lives beside daily reels, with its own draft-only watcher.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { identityLeaks } from "../src/speaker-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export function speakerConfig(env = process.env) {
  const home = path.resolve(env.SPEAKER_HOME || env.HOME || os.homedir());
  return {
    home,
    root: path.resolve(env.SPEAKER_CLIENTS_ROOT || path.join(home, "Reels/speaker-clients")),
    desktop: path.resolve(env.SPEAKER_DESKTOP_ROOT || path.join(home, "Desktop/Reels/Speaker Reels")),
    agents: path.resolve(env.SPEAKER_AGENT_DIR || path.join(home, "Library/LaunchAgents")),
    reel: env.SPEAKER_REEL || "reel",
  };
}
export function speakerSlug(name) {
  const slug = String(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Client name needs letters or numbers (or supply --slug).");
  return slug;
}
export function safeName(name) {
  if (!name?.trim() || /[\/\\\x00-\x1f]/.test(name) || [".", ".."].includes(name)) throw new Error("Client name must be one folder name.");
  return name.trim();
}
export function assertSpeakerBrand(brand) {
  if (!brand || typeof brand !== "object" || Array.isArray(brand)) throw new Error("Brand file must contain a JSON object.");
  if (identityLeaks(brand).length) throw new Error("Refusing speaker brand: it contains Greg Pingel's identity (pingel). Supply the client's brand.");
  return brand;
}
export function manifestSkeleton(name, slug, brandFile) {
  return { schemaVersion: 1, clientId: slug,
    identity: { name, roleLine: "", tagline: "", bookingMode: "direct", bookingUrl: "", bookingText: "", email: "", phone: "", bureau: null },
    brand: { file: brandFile }, brief: { buyer: "event planners", audience: "", topics: [] }, sources: [], proof: [], rights: [], music: [] };
}
export function speakerClients(config = speakerConfig(), { activeOnly = false } = {}) {
  if (!fs.existsSync(config.root)) return [];
  return fs.readdirSync(config.root, { withFileTypes: true }).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap((d) => {
    const folder = path.join(config.root, d.name);
    if (!fs.existsSync(path.join(folder, "speaker-manifest.json"))) return [];
    if (activeOnly && fs.existsSync(path.join(folder, "work/.speaker-watch-disabled"))) return [];
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(folder, "speaker-manifest.json"), "utf8")); }
    catch (e) { console.warn(`[speaker] skipped ${d.name}: speaker-manifest.json is not valid JSON (${e.message})`); return []; }
    return [{ folder, slug: d.name, name: safeName(manifest.identity?.name || d.name), manifest }];
  });
}
export function speakerHelp(config = speakerConfig()) {
  const r = spawnSync(config.reel, ["speaker", "--help"], { encoding: "utf8", timeout: 15000 });
  return r.status === 0 && /\bspeaker\b/i.test(r.stdout || "") ? r.stdout : "";
}
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function speakerPlist(config = speakerConfig(), folders = speakerClients(config, { activeOnly: true }).map((c) => c.folder), env = process.env) {
  const entries = { HOME: config.home, SPEAKER_HOME: config.home, SPEAKER_CLIENTS_ROOT: config.root, SPEAKER_DESKTOP_ROOT: config.desktop,
    SPEAKER_REEL: config.reel, PATH: `${config.home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` };
  for (const key of ["SPEAKER_LOCK", "SPEAKER_STABLE_SECONDS", "SPEAKER_STABLE_ATTEMPTS"]) if (env[key]) entries[key] = env[key];
  const log = env.SPEAKER_LAUNCH_LOG || path.join(config.root, "watch-launchd.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.pingel.speaker-watch</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>${xml(path.join(here, "speaker-watch.sh"))}</string></array>
<key>EnvironmentVariables</key><dict>${Object.entries(entries).map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`).join("")}</dict>
<key>WatchPaths</key><array>${folders.flatMap((f) => ["footage", "proof", "work/plans"].map((d) => `<string>${xml(path.join(f, d))}</string>`)).join("")}</array>
<key>StartInterval</key><integer>900</integer>
<key>ThrottleInterval</key><integer>30</integer>
<key>RunAtLoad</key><false/>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>\n`;
}
const intro = `Speaker reels: drop original talks, phone footage, podcasts and B-roll into 1 Drop footage here. Keep event names and dates in folder names. Put real testimonials, logos, press and photos into the matching subfolders of 2 Drop proof here. Put only licensed tracks in 3 Music; record the licence in the manifest.

The watcher waits for copying to stop, adds new files and indexes/transcribes new footage once. An operator selects clips and edits work/plans/<version>.json; saving a plan requests a draft. Review drafts in 4 Drafts to review and give one combined list of changes with timecodes. Status.txt explains the next step; watch.log in the client folder records failures.

Use only real footage, real words, real testimonials and honest logo relationships. Never fake a crowd, applause, a face, a voice, a quote or a number. Keep reactions with their actual moment. Record permission for every source and proof item. Unknown or pending permission must be visible during review; final delivery needs approved permissions and the client's approval of the exact file. The client's approved brand is required.

5 Final holds approved deliverables only. Nothing is ever posted automatically. Originals are never moved or deleted. Complete booking details, source kinds, events and permissions in speaker-manifest.json before editing.
`;
function writeJSON(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function install(dryRun) {
  const r = spawnSync("/bin/bash", [path.join(here, "install-speaker-watch.sh"), ...(dryRun ? ["--dry-run"] : [])], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("Speaker watcher installation failed; intake files were kept. See the installer output.");
}
export async function speakerClientMain(args = process.argv.slice(2), config = speakerConfig()) {
  const dry = args.includes("--dry-run");
  const cmd = args[0];
  if (cmd === "--plist") { console.log(speakerPlist(config)); return; }
  if (cmd === "list") {
    const rows = speakerClients(config);
    if (!rows.length) console.log("No speaker clients yet.");
    for (const c of rows) {
      const { speakerStatus } = await import("./speaker-status.mjs");
      console.log(speakerStatus(c.folder).split("\n").slice(0, 2).join(" — ") + (fs.existsSync(path.join(c.folder, "work/.speaker-watch-disabled")) ? " (watcher off)" : ""));
    }
    return;
  }
  if (!["add", "remove"].includes(cmd) || !args[1]) throw new Error('usage: speaker-client.mjs add "Client Name" --brand brand.json [--slug slug] [--dry-run] | list | remove "Client Name" [--dry-run]');
  const name = safeName(args[1]);
  const option = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${flag} needs a value`); return args[i + 1]; };
  const existing = speakerClients(config).find((c) => c.name === name);
  const slug = option("--slug") || existing?.slug || speakerSlug(name);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("--slug must contain lowercase letters, numbers and single hyphens.");
  if (existing && existing.slug !== slug) throw new Error(`${name} is already set up as ${existing.slug}; reuse that slug.`);
  const folder = path.join(config.root, slug), desktop = path.join(config.desktop, name);
  if (cmd === "remove") {
    if (!existing) throw new Error(`No speaker client named ${name}.`);
    if (dry) { console.log(`Would remove Desktop shortcuts: ${desktop}\nWould disable watcher for ${existing.folder}; keep all footage and work.\nWould refresh com.pingel.speaker-watch.`); return; }
    fs.mkdirSync(path.join(existing.folder, "work"), { recursive: true });
    fs.writeFileSync(path.join(existing.folder, "work/.speaker-watch-disabled"), "Removed from Desktop watcher. Re-run add to enable.\n");
    if (fs.existsSync(desktop)) {
      if (fs.lstatSync(desktop).isSymbolicLink()) throw new Error(`Refusing to remove symlinked Desktop client folder: ${desktop}`);
      for (const entry of fs.readdirSync(desktop)) {
        const f = path.join(desktop, entry);
        if (fs.lstatSync(f).isSymbolicLink() || ["Status.txt", "START HERE.txt"].includes(entry) && fs.lstatSync(f).isFile()) fs.unlinkSync(f);
      }
      try { fs.rmdirSync(desktop); } catch { console.log(`Kept extra files in ${desktop}.`); }
    }
    install(false); console.log(`Removed ${name} from the watcher; original files kept at ${existing.folder}.`); return;
  }
  const brandArg = option("--brand");
  if (!brandArg) throw new Error("add requires --brand <brand.json>");
  const brandFile = path.resolve(brandArg);
  assertSpeakerBrand(JSON.parse(fs.readFileSync(brandFile, "utf8")));
  assertSpeakerBrand({ name });
  const mf = path.join(folder, "speaker-manifest.json");
  if (fs.existsSync(mf) && JSON.parse(fs.readFileSync(mf, "utf8")).identity?.name !== name) throw new Error(`Slug ${slug} already belongs to another client.`);
  const dirs = ["footage", "proof/testimonials", "proof/logos", "proof/press", "proof/photos", "music", "work/plans", "review", "final"];
  const links = [["1 Drop footage here", "footage"], ["2 Drop proof here", "proof"], ["3 Music", "music"], ["4 Drafts to review", "review"], ["5 Final", "final"]];
  if (dry) {
    console.log(`Would set up ${name}: ${folder}\nWould create ${dirs.join(", ")}\nWould write ${mf} (preserve existing sources, proof and permissions).\nWould create ${desktop}/START HERE.txt and Status.txt`);
    for (const [label, target] of links) console.log(`Would link ${label} -> ${path.join(folder, target)}`);
    console.log(`Would run ${config.reel} speaker init ${folder} if available, otherwise write a manifest skeleton.\nWould install/refresh com.pingel.speaker-watch with WatchPaths:`);
    console.log(speakerPlist(config, [...new Set([...speakerClients(config, { activeOnly: true }).map((c) => c.folder), folder])])); return;
  }
  if (fs.existsSync(desktop) && fs.lstatSync(desktop).isSymbolicLink()) throw new Error(`Desktop client folder must be a real folder: ${desktop}`);
  for (const file of [path.join(desktop, "START HERE.txt"), path.join(desktop, "Status.txt"), path.join(config.desktop, "How to make a speaker reel.txt")]) {
    try { if (!fs.lstatSync(file).isFile()) throw new Error(`Desktop instructions and status must be real files: ${file}`); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  for (const dir of [...dirs.map((d) => path.join(folder, d)), desktop]) fs.mkdirSync(dir, { recursive: true });
  const manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, "utf8")) : manifestSkeleton(name, slug, brandFile);
  manifest.brand = { ...manifest.brand, file: brandFile };
  writeJSON(mf, manifest);
  fs.rmSync(path.join(folder, "work/.speaker-watch-disabled"), { force: true });
  for (const [label, target] of links) {
    const at = path.join(desktop, label);
    try { if (!fs.lstatSync(at).isSymbolicLink()) throw new Error(`Refusing to replace a real file/folder: ${at}`); fs.unlinkSync(at); } catch (e) { if (e.code !== "ENOENT") throw e; }
    fs.symlinkSync(path.join(folder, target), at);
  }
  fs.writeFileSync(path.join(desktop, "START HERE.txt"), `${name}\n\n${intro}`);
  fs.writeFileSync(path.join(config.desktop, "How to make a speaker reel.txt"), `Add a client with node scripts/speaker-client.mjs add "Client Name" --brand /path/to/brand.json.\n\n${intro}`);
  const { writeSpeakerStatus } = await import("./speaker-status.mjs");
  writeSpeakerStatus(folder, { config });
  if (/\binit\b/.test(speakerHelp(config))) {
    const r = spawnSync(config.reel, ["speaker", "init", folder], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`Speaker init failed for ${name}; intake was kept at ${folder}.`);
  } else console.log("speaker init not available yet; wrote the manifest skeleton.");
  writeSpeakerStatus(folder, { config });
  install(false);
  console.log(`${name} is ready: ${desktop}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  speakerClientMain().catch((e) => { console.error(`speaker-client: ${e.message}`); process.exitCode = 1; });
}
