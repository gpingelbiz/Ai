#!/usr/bin/env node
// Build a Reel Editor Kit zip for one person, with their brand built in:
//   node scripts/brand-kit.mjs <their-brand.json> [--out <folder>]     (default: reel-editor/dist)
// The zip holds the double-click installer, their Start Here page and a Brand folder (look, YouTube look, word list,
// caption voice, fonts). --release pins it to a tested build; --dev is for local previews only.
//   --studio <their brand-guide.md>   a Content Studio Kit instead: the same plus their Brand & Messaging Guide and the
//                                     Install Content Studio installer (photo folder, Claude, Metricool, daily posts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkBrand, brandPreset, youtubePreset, brandDictionary, brandVoice, fetchFont, personalizeStartHere, personalizeSetupGuide, kitSendOutMessage } from "../src/brandkit.mjs";
import { PKG_ROOT } from "../src/util.mjs";
import { signupLinks } from "../src/signups.mjs";
import { verifyRelease, sameRelease, readReleaseManifest } from "../src/release.mjs";
import { command, withReleaseApp } from "./release.mjs";

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && !["--out", "--studio", "--release"].includes(args[i - 1]));
const outIdx = args.indexOf("--out");
const studioIdx = args.indexOf("--studio");
const releaseIdx = args.indexOf("--release");
const dev = args.includes("--dev");
if ((releaseIdx < 0 && !dev) || (releaseIdx >= 0 && dev)) { console.error("Choose --release <release.json> for a client kit, or --dev for a local preview."); process.exit(2); }
if (releaseIdx >= 0 && (!args[releaseIdx + 1] || !fs.existsSync(args[releaseIdx + 1]))) { console.error("--release needs the saved release.json file."); process.exit(2); }
const releaseFile = releaseIdx >= 0 ? path.resolve(args[releaseIdx + 1]) : null;
const release = releaseFile ? readReleaseManifest(releaseFile) : null;
const GUIDE = studioIdx >= 0 ? args[studioIdx + 1] : "";
if (studioIdx >= 0 && !(GUIDE && fs.existsSync(GUIDE))) { console.error("--studio needs their brand guide: --studio <brand-guide.md>"); process.exit(2); }
const OUT = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join(PKG_ROOT, "dist"));
if (!file) { console.error("usage: brand-kit.mjs <their-brand.json> --release <release.json> [--out <folder>]   (template: kit/brand-template.json)"); process.exit(2); }

if (release) {
  const embeddedFile = path.join(PKG_ROOT, "release.json");
  const embedded = fs.existsSync(embeddedFile) ? JSON.parse(fs.readFileSync(embeddedFile, "utf8")) : null;
  if (!embedded || !sameRelease(embedded, release)) {
    withReleaseApp({ id: release.id, manifestFile: releaseFile }, ({ source }) => {
      command(process.execPath, [path.join(source, "scripts/brand-kit.mjs"), path.resolve(file), "--release", releaseFile, "--out", OUT, ...(GUIDE ? ["--studio", path.resolve(GUIDE)] : [])], { cwd: source });
    });
    process.exit(0);
  }
  const bad = verifyRelease({ app: PKG_ROOT });
  if (bad.length) { console.error(`The release files have changed: ${bad.join(", ")}`); process.exit(1); }
}
if (dev) console.warn("WARNING: Development kit. Do not send this kit to a client.");

const strip = (o) => (Array.isArray(o) ? o.map(strip) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, strip(v)])) : o);
const brand = strip(JSON.parse(fs.readFileSync(file, "utf8")));
const problems = checkBrand(brand);
if (problems.length) { console.error(`Fix the brand file first:\n- ${problems.join("\n- ")}`); process.exit(1); }

if (/[\x00-\x1f/\\]/.test(brand.name) || [".", ".."].includes(brand.name)) { console.error("Use a brand name without slashes or control characters."); process.exit(2); }
const kitName = `${brand.name} ${GUIDE ? "Reels and Posts" : "Reel Editor"} Kit`;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "reel-kit-"));
const kit = path.join(stage, kitName);
const B = path.join(kit, "Brand");
fs.mkdirSync(path.join(B, "fonts"), { recursive: true });

const fonts = {}, credits = [];
for (const [k, label] of [["display", "Display"], ["body", "Body"]]) {
  if (!brand.fonts?.[k]) continue;
  const ext = /\.otf$/i.test(brand.fonts[k]) ? ".otf" : ".ttf";
  const r = await fetchFont(brand.fonts[k], path.join(B, "fonts", `${label}${ext}`));
  fonts[k] = `fonts/${label}${ext}`;
  credits.push(`${label} font: ${brand.fonts[k]} (${r.license})${r.note ? `; ${r.note}` : ""}\n  ${r.source}`);
  console.log(`font ${k}: ${brand.fonts[k]} (${r.license})${r.note ? `, ${r.note}` : ""}`);
}
// The display font's italic, for the keyword in the brand looks (Google Fonts families only; optional).
if (fonts.display) {
  const r = await fetchFont(brand.fonts.display, path.join(B, "fonts", "DisplayItalic.ttf"), { italic: true }).catch(() => null);
  if (r) { fonts.displayItalic = "fonts/DisplayItalic.ttf"; credits.push(`Display italic: ${brand.fonts.display} (${r.license})\n  ${r.source}`); }
}
const json = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
json(path.join(B, "my-brand.json"), brandPreset(brand, { fonts }));
json(path.join(B, "my-youtube.json"), youtubePreset(brand, { fonts }));
json(path.join(B, "dictionary.json"), brandDictionary(brand));
fs.writeFileSync(path.join(B, "voice.md"), brandVoice(brand));
json(path.join(B, "brand.json"), brand);
if (GUIDE) fs.copyFileSync(GUIDE, path.join(B, "brand-guide.md"));
if (credits.length) fs.writeFileSync(path.join(B, "fonts", "FONTS.txt"), credits.join("\n\n") + "\n");

const installer = GUIDE ? "Install Reels.command" : "Install Reel Editor.command";
fs.copyFileSync(path.join(PKG_ROOT, "kit", installer), path.join(kit, installer));
fs.chmodSync(path.join(kit, installer), 0o755);
if (release) {
  fs.copyFileSync(releaseFile, path.join(kit, "release.json"));
  fs.copyFileSync(path.join(PKG_ROOT, "install.sh"), path.join(kit, "install.sh"));
}
fs.writeFileSync(path.join(kit, "Start Here.html"), personalizeStartHere(fs.readFileSync(path.join(PKG_ROOT, "kit", "Start Here.html"), "utf8"), brand, { studio: !!GUIDE }));
fs.writeFileSync(path.join(kit, "Setup Guide.html"), personalizeSetupGuide(fs.readFileSync(path.join(PKG_ROOT, "kit", "Setup Guide.html"), "utf8"), brand, { studio: !!GUIDE }));
// "Sign up here": a double-click link to each service's plans, the same list as Start Here's table.
fs.mkdirSync(path.join(kit, "Sign up here"), { recursive: true });
for (const [name, body] of Object.entries(signupLinks({ studio: !!GUIDE }))) fs.writeFileSync(path.join(kit, "Sign up here", name), body);

fs.mkdirSync(OUT, { recursive: true });
const zip = path.join(OUT, `${kitName}.zip`);
fs.rmSync(zip, { force: true });
spawnSync("xattr", ["-cr", kit]);
// ditto keeps the executable bit, so the installer still double-clicks after unzipping.
const z = spawnSync("ditto", ["-c", "-k", "--norsrc", "--noextattr", "--keepParent", kit, zip], { stdio: "inherit" });
fs.rmSync(stage, { recursive: true, force: true });
if (z.status !== 0) { console.error("zip failed"); process.exit(1); }
console.log(zip);

const message = path.join(OUT, `${kitName} - send-out message.txt`);
fs.writeFileSync(message, kitSendOutMessage(brand, { studio: !!GUIDE, release, dev }));
console.log(message);
