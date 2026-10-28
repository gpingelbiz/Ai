#!/usr/bin/env node
// A preview sheet of every card look: the same five cards (stat, list, quote, compare, message) rendered in each
// look over a still of a real reel, one row per look.
//   node scripts/looks-preview.mjs [--footage <video>] [--out <sheet.png>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeProject } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { LOOKS, LOOK_IDS, skinFor, lookExclusions } from "../src/looks.mjs";
import { run, PKG_ROOT } from "../src/util.mjs";
import { hyperframesBin, renderEnv } from "../src/render.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt("--out", path.join(PKG_ROOT, "dist", "looks-preview.png")));
const FOOT = opt("--footage", "");
const preset = opt("--preset", "pingel-brand");

// --cards <file.json>: the five sample cards in someone else's words (a client's sheet), same shape as below.
const CARDS = opt("--cards", "") ? JSON.parse(fs.readFileSync(opt("--cards", ""), "utf8")) : [
  { type: "stat", eyebrow: "WHAT IT COST", value: "$10,000", sub: "one missed follow-up" },
  { type: "list", eyebrow: "AFTER A BAD NUMBER", title: "The first 10 minutes", items: [{ text: "Slam the desk", state: "strike" }, { text: "Blame the leads", state: "strike" }, { text: "Own it first", state: "check" }] },
  { type: "quote", eyebrow: "THE STANDARD", text: "Your team copies *how you react*, not what you say." },
  { type: "compare", eyebrow: "TWO WAYS TO LEAD", a: { label: "Slam the desk", note: "they go quiet" }, b: { label: "Lower your voice", note: "they own it" } },
  { type: "message", eyebrow: "THE TEXT", contact: "Mike", items: [{ from: "them", text: "Numbers are down again" }, { from: "me", text: "What happened first?" }] },
];
const SLOT = 2.4;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-looks-"));
const footage = path.join(tmp, "footage.mp4");
if (FOOT) await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "8", "-i", FOOT, "-frames:v", "1", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", path.join(tmp, "still.png")]);
if (FOOT) await run("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", path.join(tmp, "still.png"), "-t", String(CARDS.length * SLOT + 1), "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", footage]);
else await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x2b3440:s=1080x1920:d=${CARDS.length * SLOT + 1}:r=30,format=rgb24,geq=r='40+X/14+Y/40':g='48+Y/34':b='60+X/30'`, "-c:v", "libx264", "-pix_fmt", "yuv420p", footage]);

const style = loadPreset(preset);
style.audio.sounds = false;
const rows = [];
// One row per look this preset can use (a brand's looks.only, or every house look).
const off = lookExclusions(style.graphics);
for (const look of LOOK_IDS.filter((id) => !off.includes(id))) {
  const plan = {
    version: 1, name: `look-${look}`, preset: style.name, style,
    video: { src: footage, duration: CARDS.length * SLOT + 1, width: 1080, height: 1920, fps: 30, hasAudio: false },
    canvas: { width: 1080, height: 1920, mode: "portrait" },
    hook: null, cta: null, captions: [], zooms: [], broll: [], slams: [], coldOpen: null, lowerThird: null, reframe: null, behind: null,
    framing: { scale: 1, origin: "50% 40%", side: "right", face: null }, audio: { tracks: [] }, words: [],
    graphics: CARDS.map((c, k) => ({ ...c, start: 0.2 + k * SLOT, duration: SLOT - 0.2, skin: skinFor(look, c.type) })),
  };
  const dir = path.join(tmp, look);
  composeProject(plan, dir);
  const shots = path.join(dir, "shots");
  const at = CARDS.map((_, k) => +(0.2 + k * SLOT + 1.9).toFixed(2));
  const bin = hyperframesBin();
  await run(bin[0], [...bin.slice(1), "snapshot", dir, "-o", shots, "--at", at.join(","), "--no-end", "--keep", "--no-browser-gpu", "--describe", "false", "--timeout", "15000"], { capture: true, env: { ...renderEnv(), PRODUCER_BROWSER_GPU_MODE: "software" } });
  const files = at.map((t) => path.join(shots, `at-${String(t).replace(/\.?0+$/, "")}s.png`));
  const row = path.join(tmp, `row-${look}.png`);
  await run("ffmpeg", ["-y", "-loglevel", "error", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, k) => `[${k}]scale=300:-2[s${k}]`).join(";")};${files.map((_, k) => `[s${k}]`).join("")}hstack=${files.length}`, row]);
  rows.push(row);
  console.log(`${look}: ${LOOKS[look].label}`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await run("ffmpeg", ["-y", "-loglevel", "error", ...rows.flatMap((f) => ["-i", f]), "-filter_complex", `vstack=${rows.length}`, OUT]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(OUT);
