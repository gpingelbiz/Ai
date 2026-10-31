#!/usr/bin/env node
// Content Studio setup on a client's Mac, run by install.sh --studio (the "Install Content Studio" kit) after the reel
// editor is installed. Asks: where the photos are, signs in to Claude, picks the client's Metricool brand, explains and
// picks how images reach Metricool, the posting times; then writes studio.json and turns on the daily job and the
// Raw Reels watcher. Safe to run again: it keeps studio.json values it does not ask about.
//
//   node scripts/studio-setup.mjs --brand <kit Brand folder> [--dir "~/Content Studio"] [--yes]
//     scripted answers: --photos <dir> --route tunnel|drive|dropbox --folder <dir> --blog <id> --connector <name>
//                       --timezone <IANA> --networks instagram,facebook --no-agents --no-first-post
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { initStudio, studioPaths, studioDir, readPosts, withDefaults, macZone } from "../src/content-studio.mjs";
import { parseConnectors, metricoolBrands } from "../src/studio-metricool.mjs";
import { driveRoot, dropboxRoot } from "../src/studio-host.mjs";
import { installAgents } from "../src/studio-cli.mjs";
import { cloudflaredBin } from "../src/publish-folder.mjs";
import { PKG_ROOT, readJSON } from "../src/util.mjs";

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ""; };
const YES = flag("--yes");
const HOME = os.homedir();
const expand = (p) => path.resolve(String(p).trim().replace(/^['"]|['"]$/g, "").replace(/\\ /g, " ").replace(/^~(?=\/|$)/, HOME));

const bold = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const note = (s) => console.log(`  ${s}`);
const die = (s) => { console.error(`\n\x1b[31m${s}\x1b[0m`); process.exit(1); };

let tty = null;
const ask = (q, def = "") => new Promise((resolve) => {
  if (!tty) return resolve(def);
  tty.question(`${q} `, (a) => resolve(String(a || "").trim() || def));
});

/** Folders a background job cannot read on a Mac (privacy): Desktop, Documents, Downloads, iCloud Drive. */
export function protectedFolder(dir, home = HOME) {
  const rel = path.relative(home, dir);
  return !rel.startsWith("..") && /^(Desktop|Documents|Downloads|Library\/Mobile Documents)(\/|$)/.test(rel);
}

function claudeBin() {
  for (const c of [process.env.REEL_CLAUDE_BIN, path.join(HOME, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]) if (c && fs.existsSync(c)) return c;
  const r = spawnSync("/bin/bash", ["-lc", "command -v claude"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

const signedIn = (bin) => {
  const r = spawnSync(bin, ["-p", "Reply with the word OK and nothing else.", "--tools", "", "--strict-mcp-config", "--output-format", "text"], { encoding: "utf8", timeout: 120000, cwd: os.tmpdir() });
  return r.status === 0 && /\bOK\b/.test(r.stdout || "");
};

async function main() {
  try { if (!YES && fs.existsSync("/dev/tty")) tty = readline.createInterface({ input: fs.createReadStream("/dev/tty"), output: process.stdout }); } catch { tty = null; }
  const brandFrom = opt("--brand") ? expand(opt("--brand")) : "";
  if (!brandFrom || !fs.existsSync(path.join(brandFrom, "brand.json"))) die("This setup needs a Content Studio kit: its Brand folder (brand.json, voice.md, brand-guide.md) was not found.");
  const brand = readJSON(path.join(brandFrom, "brand.json"));
  if (!fs.existsSync(path.join(brandFrom, "brand-guide.md"))) note("No brand-guide.md in the kit: posts follow the voice notes and an even mix until one is added to Content Studio/brand.");
  const root = studioDir(opt("--dir") || path.join(HOME, "Content Studio"));
  const paths = studioPaths(root);
  const before = fs.existsSync(paths.config) ? withDefaults(readJSON(paths.config)) : withDefaults({});
  const config = { client: brand.name || before.client };

  bold(`Content Studio for ${config.client}`);
  note("It makes your carousels, statics and reels and schedules them into your Metricool by itself.");
  note("You only drop photos and clips. Nobody has to check the posts.");

  // ------------------------------------------------------------ 1. photos
  bold("1/6  Your photos");
  note("Pick the folder the posts take photos from. Each photo is used once and never again;");
  note("blurry, dark and badly cropped shots are skipped by themselves.");
  note("From the Photos app: select photos, File, Export, into the folder you pick here.");
  let photos = opt("--photos") ? expand(opt("--photos")) : "";
  if (!photos) {
    const a = await ask(`Drag your photo folder into this window and press Return, or press Return for Content Studio/Photos:`, "");
    photos = a ? expand(a) : "";
  }
  if (photos && protectedFolder(photos)) {
    note("");
    note(`That folder is inside ${path.relative(HOME, photos).split("/")[0]}. A Mac does not let background jobs read`);
    note("the Desktop, Documents, Downloads or iCloud Drive folders, so the daily run could not see it.");
    const c = await ask("Copy those photos into Content Studio/Photos now (you can keep adding there)? [Y/n]:", "y");
    if (/^n/i.test(c)) die("Move the photos to a folder outside Desktop, Documents and Downloads (Pictures works), then run the installer again.");
    fs.mkdirSync(paths.photos, { recursive: true });
    spawnSync("/bin/cp", ["-Rn", `${photos}/.`, paths.photos], { stdio: "inherit" });
    ok(`photos copied into ${paths.photos}`);
    photos = "";
  }
  config.photos = photos || before.photos || "Photos";
  ok(`photos: ${photos || path.join(root, "Photos")}`);

  // ------------------------------------------------------------ 2. Claude
  bold("2/6  Claude (writes the posts in your voice, and talks to Metricool)");
  let bin = claudeBin();
  if (!bin) {
    note("Installing Claude Code (Anthropic's official installer)…");
    spawnSync("/bin/bash", ["-c", "curl -fsSL https://claude.ai/install.sh | bash"], { stdio: "inherit" });
    bin = claudeBin();
    if (!bin) die("Claude Code did not install. Run  curl -fsSL https://claude.ai/install.sh | bash  in Terminal, then run this installer again.");
  }
  ok("Claude Code installed");
  if (!signedIn(bin)) {
    if (YES || !tty) die("Claude is not signed in. Open Terminal, type  claude  and sign in, then run this installer again.");
    note("Sign in with YOUR Claude account (a Pro or Max plan). Claude opens here: follow the sign-in,");
    note("then type  /exit  and press Return to come back.");
    await ask("Press Return to start:", "");
    spawnSync(bin, [], { stdio: "inherit" });
    if (!signedIn(bin)) die("Claude is still not signed in. Run the installer again after signing in with  claude  in Terminal.");
  }
  ok("Claude is signed in");

  // ------------------------------------------------------------ 3. Metricool
  bold("3/6  Metricool");
  let connectors = {};
  const listConnectors = () => { const r = spawnSync(bin, ["mcp", "list"], { encoding: "utf8", timeout: 120000 }); connectors = parseConnectors(r.stdout); return connectors; };
  listConnectors();
  for (let tries = 0; !connectors.metricool?.connected && tries < 3 && !opt("--connector"); tries++) {
    if (YES || !tty) break;
    note("Connect Metricool to your Claude account once: on claude.ai open Settings, Connectors, find Metricool,");
    note("click Connect and sign in with YOUR Metricool account. Opening the page now.");
    spawnSync("open", ["https://claude.ai/settings/connectors"]);
    await ask("Press Return when Metricool shows as connected:", "");
    listConnectors();
  }
  const connector = opt("--connector") || connectors.metricool?.name || before.metricool.connector;
  let metricool = { ...before.metricool, connector };
  let publishMode = before.publish.mode === "off" ? "schedule" : before.publish.mode;
  if (!connector) {
    note("Metricool is not connected, so posts are made into Content Studio/Made but not scheduled.");
    note("Run the installer again after connecting it to turn scheduling on.");
    publishMode = "off";
  } else {
    ok(`Metricool connector: ${connector}`);
    let blogId = opt("--blog");
    let brands = [];
    if (!blogId) {
      try { brands = await metricoolBrands(connector); } catch (e) { die(`Could not read your Metricool brands: ${e.message}`); }
      if (!brands.length) die("Your Metricool account has no brands. Add your Instagram in Metricool first.");
      brands.forEach((b, i) => note(`${i + 1}) ${b.label}${b.networks.length ? ` (${b.networks.join(", ")})` : ""}`));
      const def = Math.max(1, brands.findIndex((b) => b.id === String(before.metricool.blogId)) + 1);
      const a = await ask(`Which brand are your posts for? [${def}]:`, String(def));
      const b = brands[Math.min(brands.length, Math.max(1, Number(a) || def)) - 1];
      blogId = b.id;
      metricool = { ...metricool, brand: b.label, blogId: b.id };
      if (b.timezone && !opt("--timezone")) config.timezone = b.timezone;
      const nets = b.networks.filter((n) => ["instagram", "facebook", "linkedin", "threads", "tiktok"].includes(n));
      if (nets.length > 1 && tty) {
        note(`Posts go to Instagram. This brand also has: ${nets.filter((n) => n !== "instagram").join(", ")}.`);
        const more = await ask("Post there too? Type the names to add (like facebook linkedin), or press Return for Instagram only:", "");
        metricool.networks = ["instagram", ...more.toLowerCase().split(/[\s,]+/).filter((n) => nets.includes(n) && n !== "instagram")];
      }
    } else metricool = { ...metricool, blogId };
    if (opt("--networks")) metricool.networks = opt("--networks").split(",").map((s) => s.trim()).filter(Boolean);
    ok(`posts go to Metricool brand ${metricool.brand || metricool.blogId}: ${(metricool.networks || ["instagram"]).join(", ")}`);
  }
  config.metricool = metricool;
  config.publish = { mode: publishMode };

  // ------------------------------------------------------------ 4. how images reach Metricool
  bold("4/6  How your images reach Metricool");
  note("Metricool needs a link to each image or video for a moment, then keeps its own copy. Three ways:");
  note("");
  note("1) Straight from this Mac (recommended). While a post is being scheduled, this Mac shares just");
  note("   those files at a private, random address for about a minute, Metricool copies them, and the");
  note("   address closes. Nothing to sign up for. Your Mac only has to be on when the morning run goes.");
  note("2) Google Drive. Images are copied into a Drive folder you share once as \"anyone with the link\",");
  note("   and Metricool takes them from there. Needs the Google Drive app on this Mac and Google Drive");
  note("   linked in Metricool. Good if you want every image kept in Drive.");
  note("3) Dropbox. The same with a Dropbox folder. Needs the Dropbox app on this Mac and the Dropbox");
  note("   connector in Claude (claude.ai, Settings, Connectors).");
  const routeAnswer = opt("--route") || await ask(`Pick 1, 2 or 3 [${({ tunnel: 1, drive: 2, dropbox: 3 })[before.hosting.route] || 1}]:`, String(({ tunnel: 1, drive: 2, dropbox: 3 })[before.hosting.route] || 1));
  const route = ({ 1: "tunnel", 2: "drive", 3: "dropbox", tunnel: "tunnel", drive: "drive", dropbox: "dropbox" })[routeAnswer] || "tunnel";
  let folder = opt("--folder") ? expand(opt("--folder")) : before.hosting.folder;
  if (route === "tunnel") {
    if (!cloudflaredBin()) spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts", "install-cloudflared.sh")], { stdio: "inherit" });
    if (!cloudflaredBin()) die("The link tool (cloudflared) did not install. Run the installer again, or pick Google Drive or Dropbox.");
    ok("images go straight from this Mac");
    folder = "";
  } else if (route === "drive") {
    const rootDir = driveRoot();
    if (!rootDir) die("Google Drive for desktop is not on this Mac (or not signed in). Install it from google.com/drive/download, sign in, then run this installer again.");
    folder ||= path.join(rootDir, "Content Studio uploads");
    fs.mkdirSync(folder, { recursive: true });
    note(`Images go to the Drive folder "${path.basename(folder)}". Share it once: on drive.google.com right-click it,`);
    note("Share, General access: Anyone with the link, Viewer, Done. In Metricool, link Google Drive (Settings).");
    if (tty) { spawnSync("open", ["https://drive.google.com/drive/my-drive"]); await ask("Press Return when the folder is shared:", ""); }
    ok(`images go through Google Drive: ${folder}`);
  } else {
    const rootDir = dropboxRoot();
    if (!rootDir) die("The Dropbox app is not on this Mac. Install it from dropbox.com/install, sign in, then run this installer again.");
    if (!connectors.dropbox?.connected) note("Add the Dropbox connector on claude.ai (Settings, Connectors) so the studio can make share links.");
    folder ||= path.join(rootDir, "Content Studio uploads");
    fs.mkdirSync(folder, { recursive: true });
    ok(`images go through Dropbox: ${folder}`);
  }
  config.hosting = { route, folder };

  // ------------------------------------------------------------ 5. times
  bold("5/6  When posts go out");
  config.timezone = opt("--timezone") || config.timezone || before.timezone || macZone();
  const slots = before.slots;
  note(`Time zone: ${config.timezone}. Every day: ${slots.map((s) => `a ${s.format} at ${s.time}`).join(" and ")}. Reels you drop go out one a day at the best open hour.`);
  const keep = await ask("Keep these times? [Y/n]:", "y");
  if (/^n/i.test(keep)) {
    const next = [];
    for (const [format, def] of [["carousel", "10:00"], ["static", "18:00"]]) {
      const t = await ask(`Time for the daily ${format} (like 10:00 or 6:00 PM), or "none" [${slots.find((s) => s.format === format)?.time || def}]:`, slots.find((s) => s.format === format)?.time || def);
      if (!/^none$/i.test(t)) next.push({ time: t, format });
    }
    if (next.length) config.slots = next;
  }
  config.sandcastles = !!connectors.sandcastles?.connected;
  ok(`times set${config.sandcastles ? "; Sandcastles is connected, so hooks follow what is winning" : ""}`);

  // ------------------------------------------------------------ 6. write and turn on
  bold("6/6  Turning it on");
  initStudio(root, { brandFrom, config });
  const link = path.join(HOME, "Desktop", "Content Studio");
  // The shortcut is for the standard folder only; a studio set up somewhere else (a test, a second client) gets none.
  if (root === path.join(HOME, "Content Studio") && !fs.existsSync(link)) { try { fs.symlinkSync(root, link); ok("Desktop shortcut: Content Studio"); } catch {} }
  ok(`studio.json written in ${root}`);
  // Publish: drop a finished reel and it is scheduled as it is (Greg's Publish folder, for them), next to the Raw folders.
  const reelsDesk = path.join(HOME, "Desktop", "Reels");
  const pub = path.join(reelsDesk, "Publish");
  if (root === path.join(HOME, "Content Studio") && fs.existsSync(reelsDesk)) { try { fs.lstatSync(pub); } catch { try { fs.symlinkSync(studioPaths(root).publish, pub); ok("Desktop shortcut: Reels/Publish"); } catch {} } }
  if (!flag("--no-agents")) for (const line of installAgents(root)) ok(line);
  if (!flag("--no-first-post") && publishMode !== "off" && !readPosts(paths).length) {
    const go = await ask("Make the first post now, to see it work? [Y/n]:", "y");
    if (!/^n/i.test(go)) spawnSync(process.execPath, [path.join(PKG_ROOT, "bin", "reel.mjs"), "daily", "--studio", root, "--limit", "1"], { stdio: "inherit" });
  }
  bold("Done.");
  note("Drop photos into your photo folder and clips into Content Studio/Raw Reels. Every morning the studio");
  note("fills the next days; Made shows what it made. Run this installer again to change anything.");
  tty?.close();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => die(e.message));
