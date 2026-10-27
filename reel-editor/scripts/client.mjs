#!/usr/bin/env node
// Clients on this Mac: edit a client's footage in the client's own brand from drop folders of their own.
//   node scripts/client.mjs add <their-brand.json> [--no-agent]   set up (or update) a client
//   node scripts/client.mjs list                                  the clients set up here
// Start from kit/brand-template.json (the same brand file a kit uses). `add` makes ~/Reels/clients/<slug> (drop
// folders, brand preset, YouTube look, word list, caption voice, fonts, music) and ~/Desktop/Reels/Clients/<Name>
// with the drop-folder shortcuts; finished reels land there. Re-running `add` updates the brand and keeps the reels.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkBrand, brandPreset, youtubePreset, brandDictionary, brandVoice, fetchFont } from "../src/brandkit.mjs";
import { clientPaths, clientEnv, clientsRoot, agentPlist } from "../src/clients.mjs";
import { PKG_ROOT } from "../src/util.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const json = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const strip = (o) => (Array.isArray(o) ? o.map(strip) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, strip(v)])) : o);

if (cmd === "list") {
  const root = clientsRoot();
  const rows = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "brand.json"))) : [];
  if (!rows.length) console.log(`no clients yet (add one: node scripts/client.mjs add their-brand.json)`);
  for (const d of rows) {
    const b = JSON.parse(fs.readFileSync(path.join(root, d, "brand.json"), "utf8"));
    const p = clientPaths(b);
    const agent = fs.existsSync(path.join(os.homedir(), "Library", "LaunchAgents", `${p.label}.plist`));
    console.log(`${b.name} (${d}): drop in ${p.desktop}, ${agent ? "watcher on" : "watcher OFF"}`);
  }
  process.exit(0);
}

if (cmd !== "add" || !args[1]) {
  console.error("usage: client.mjs add <their-brand.json> [--no-agent]\n       client.mjs list\n(template: kit/brand-template.json)");
  process.exit(2);
}

const brand = strip(JSON.parse(fs.readFileSync(args[1], "utf8")));
const problems = checkBrand(brand);
if (problems.length) { console.error(`Fix the brand file first:\n- ${problems.join("\n- ")}`); process.exit(1); }
const p = clientPaths(brand);
for (const d of [p.root, p.music, p.cache, p.fonts, path.join(p.root, "videos", ".seen"), p.desktop, ...p.drops.map((x) => x.dir)]) fs.mkdirSync(d, { recursive: true });

const fonts = {};
for (const [k, label] of [["display", "Display"], ["body", "Body"]]) {
  if (!brand.fonts?.[k]) continue;
  const ext = /\.otf$/i.test(brand.fonts[k]) ? ".otf" : ".ttf";
  const r = await fetchFont(brand.fonts[k], path.join(p.fonts, `${label}${ext}`));
  fonts[k] = `fonts/${label}${ext}`;
  console.log(`font ${k}: ${brand.fonts[k]} (${r.license})${r.note ? `, ${r.note}` : ""}`);
}
json(p.preset, brandPreset(brand, { fonts }));
json(p.youtube, youtubePreset(brand, { fonts }));
json(p.dictionary, brandDictionary(brand));
fs.writeFileSync(p.voice, brandVoice(brand));
json(p.brand, brand);
fs.writeFileSync(p.env, clientEnv(brand, p));

// Desktop: the drop-folder shortcuts and Music, next to where the finished reels land. Only shortcuts this script
// made are replaced; a real folder of the same name is left alone.
const link = (target, at) => {
  try { const st = fs.lstatSync(at); if (!st.isSymbolicLink()) { console.log(`left alone (not a shortcut): ${at}`); return; } fs.unlinkSync(at); } catch {}
  fs.symlinkSync(target, at);
};
for (const d of p.drops) link(d.dir, path.join(p.desktop, d.label));
link(p.music, path.join(p.desktop, "Music"));

if (!args.includes("--no-agent")) {
  // The client's agent wakes the shared watcher with Greg's own folder settings, read from his installed agent.
  const main = path.join(os.homedir(), "Library", "LaunchAgents", "com.pingel.reel-watch.plist");
  let env = {};
  const r = spawnSync("plutil", ["-extract", "EnvironmentVariables", "json", "-o", "-", main], { encoding: "utf8" });
  if (r.status === 0) env = JSON.parse(r.stdout);
  else console.log("note: the main watcher is not installed; the client agent uses the default folders");
  const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${p.label}.plist`);
  fs.writeFileSync(plist, agentPlist({ label: p.label, script: path.join(PKG_ROOT, "scripts", "watch-folder.sh"), env, watch: p.drops.map((d) => d.dir), log: path.join(p.root, "watch-launchd.log") }));
  const lint = spawnSync("plutil", ["-lint", plist], { encoding: "utf8" });
  if (lint.status !== 0) { console.error(lint.stdout || lint.stderr); process.exit(1); }
  const uid = os.userInfo().uid;
  spawnSync("launchctl", ["bootout", `gui/${uid}/${p.label}`]);
  const b = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, plist], { encoding: "utf8" });
  if (b.status !== 0) { console.error(`could not start the client watcher: ${b.stderr}`); process.exit(1); }
  console.log(`watcher on: ${p.label}`);
}
console.log(`${brand.name} is set up. Drop their clips in ${p.desktop}; finished reels land there too.`);
