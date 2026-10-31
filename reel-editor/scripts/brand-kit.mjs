#!/usr/bin/env node
// Build a Reel Editor Kit zip for one person, with their brand built in:
//   node scripts/brand-kit.mjs <their-brand.json> [--out <folder>]     (default: reel-editor/dist)
// The zip holds the double-click installer, their Start Here page and a Brand folder (look, YouTube look, word list,
// caption voice, fonts). No code and no keys: the installer downloads the latest Reel Editor when it runs.
//   --studio <their brand-guide.md>   a Content Studio Kit instead: the same plus their Brand & Messaging Guide and the
//                                     Install Content Studio installer (photo folder, Claude, Metricool, daily posts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkBrand, brandPreset, youtubePreset, brandDictionary, brandVoice, fetchFont, personalizeStartHere } from "../src/brandkit.mjs";
import { PKG_ROOT } from "../src/util.mjs";
import { signupLinks } from "../src/signups.mjs";

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && !["--out", "--studio"].includes(args[i - 1]));
const outIdx = args.indexOf("--out");
const studioIdx = args.indexOf("--studio");
const GUIDE = studioIdx >= 0 ? args[studioIdx + 1] : "";
if (studioIdx >= 0 && !(GUIDE && fs.existsSync(GUIDE))) { console.error("--studio needs their brand guide: --studio <brand-guide.md>"); process.exit(2); }
const OUT = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.join(PKG_ROOT, "dist"));
if (!file) { console.error("usage: brand-kit.mjs <their-brand.json> [--out <folder>]   (template: kit/brand-template.json)"); process.exit(2); }

const strip = (o) => (Array.isArray(o) ? o.map(strip) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, strip(v)])) : o);
const brand = strip(JSON.parse(fs.readFileSync(file, "utf8")));
const problems = checkBrand(brand);
if (problems.length) { console.error(`Fix the brand file first:\n- ${problems.join("\n- ")}`); process.exit(1); }

const kitName = `${brand.name} ${GUIDE ? "Content Studio" : "Reel Editor"} Kit`;
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

const installer = GUIDE ? "Install Content Studio.command" : "Install Reel Editor.command";
fs.copyFileSync(path.join(PKG_ROOT, "kit", installer), path.join(kit, installer));
fs.chmodSync(path.join(kit, installer), 0o755);
fs.writeFileSync(path.join(kit, "Start Here.html"), personalizeStartHere(fs.readFileSync(path.join(PKG_ROOT, "kit", "Start Here.html"), "utf8"), brand, { studio: !!GUIDE }));
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
