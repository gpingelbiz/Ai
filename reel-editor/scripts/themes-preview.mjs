#!/usr/bin/env node
// A preview sheet of every look's whole theme: the hook on frame one, a caption with its gold-word marker, a climax
// slam, and a b-roll still in the look's grade and cut. One row per look.
//   node scripts/themes-preview.mjs --footage <video> --still <broll.png> [--out <sheet.png>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeProject } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { LOOK_IDS, applyTheme } from "../src/looks.mjs";
import { run, PKG_ROOT } from "../src/util.mjs";
import { hyperframesBin, renderEnv } from "../src/render.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt("--out", path.join(PKG_ROOT, "dist", "themes-preview.png")));
const FOOT = opt("--footage", "");
const STILL = opt("--still", "");
if (!FOOT || !STILL) { console.error("usage: themes-preview.mjs --footage <video> --still <broll.png> [--out <sheet.png>]"); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-themes-"));
const footage = path.join(tmp, "footage.mp4");
await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "8", "-i", FOOT, "-frames:v", "1", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", path.join(tmp, "still.png")]);
await run("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", path.join(tmp, "still.png"), "-t", "10", "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", footage]);
const words = (text, start, key) => text.split(" ").map((t, i) => ({ text: t, start: +(start + i * 0.3).toFixed(3), end: +(start + i * 0.3 + 0.25).toFixed(3), key: t.toLowerCase() === key }));
const line = (text, start, key) => { const w = words(text, start, key); return { words: w, start: +(start - 0.05).toFixed(3), end: +(w[w.length - 1].end + 0.4).toFixed(3), text }; };
const AT = [0.3, 3.2, 5.0, 7.6];

const rows = [];
for (const look of LOOK_IDS) {
  const base = loadPreset("pingel-brand");
  base.audio.sounds = false;
  const style = applyTheme(base, look);
  const plan = {
    version: 1, name: `theme-${look}`, preset: style.name, style,
    video: { src: footage, duration: 10, width: 1080, height: 1920, fps: 30, hasAudio: false },
    canvas: { width: 1080, height: 1920, mode: "portrait" },
    hook: { text: "The *10 minutes* after a bad number", start: 0, duration: 2.6, words: [{ text: "The" }, { text: "10", key: true }, { text: "minutes", key: true }, { text: "after" }, { text: "a" }, { text: "bad" }, { text: "number" }] },
    cta: null,
    captions: [line("they remember how you react", 2.7, "react"), line("every single time", 4.6, "every")],
    zooms: [], graphics: [],
    broll: [{ file: STILL, start: 7.0, duration: 2.2, motion: "in" }],
    slams: [{ t: 4.62, end: 5.8, text: "every" }],
    coldOpen: null, lowerThird: null, reframe: null, behind: null,
    framing: { scale: 1, origin: "50% 40%", side: "right", face: null }, audio: { tracks: [] }, words: [],
  };
  const dir = path.join(tmp, look);
  composeProject(plan, dir);
  const shots = path.join(dir, "shots");
  const bin = hyperframesBin();
  // GPU capture: the b-roll color grades are WebGL and the software renderer skips them. The b-roll frame is
  // captured in its own run: in a multi-time snapshot the grade is not reapplied after the earlier seeks.
  await run(bin[0], [...bin.slice(1), "snapshot", dir, "-o", shots, "--at", AT.slice(0, -1).join(","), "--no-end", "--keep", "--describe", "false", "--timeout", "15000"], { capture: true, env: renderEnv() });
  await run(bin[0], [...bin.slice(1), "snapshot", dir, "-o", shots, "--at", String(AT[AT.length - 1]), "--no-end", "--keep", "--describe", "false", "--timeout", "15000"], { capture: true, env: renderEnv() });
  const files = AT.map((t) => path.join(shots, `at-${String(t).replace(/\.?0+$/, "")}s.png`));
  const row = path.join(tmp, `row-${look}.png`);
  await run("ffmpeg", ["-y", "-loglevel", "error", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, k) => `[${k}]scale=360:-2[s${k}]`).join(";")};${files.map((_, k) => `[s${k}]`).join("")}hstack=${files.length}`, row]);
  rows.push(row);
  console.log(look);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await run("ffmpeg", ["-y", "-loglevel", "error", ...rows.flatMap((f) => ["-i", f]), "-filter_complex", `vstack=${rows.length}`, OUT]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(OUT);
