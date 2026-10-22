#!/usr/bin/env node
// Golden-frame tests: a fixed composition (hook, word captions with a marker, a headline card, a list card, a slam,
// a jump cut) is rendered at exact times with HyperFrames' deterministic software renderer and compared with stored
// frames by pixelmatch (ISC). A change to the composer, the fonts, GSAP, HyperFrames or Chrome that moves pixels
// shows up here with a diff image, before it shows up in a reel.
//   node scripts/golden.mjs            compare against test/golden/*.png (exit 1 on a difference)
//   node scripts/golden.mjs --update   write new golden frames after an intended look change
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { composeProject } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { run, PKG_ROOT } from "../src/util.mjs";
import { hyperframesBin, renderEnv } from "../src/render.mjs";

export const MOMENTS = [
  { at: 0.3, what: "hook headline on frame one" },
  { at: 1.5, what: "hook with the first caption line" },
  { at: 4.45, what: "caption with the gold word and its marker drawn" },
  { at: 5.3, what: "headline card in" },
  { at: 8.05, what: "list card with all three items in" },
  { at: 8.75, what: "slam word and a jump-cut frame" },
];
const GOLDEN = path.join(PKG_ROOT, "test", "golden");
const SIZE = { w: 540, h: 960 }; // compared at half size: small files, same failures

function words(text, start, step = 0.3) {
  return text.split(" ").map((t, i) => ({ text: t, start: +(start + i * step).toFixed(3), end: +(start + i * step + 0.25).toFixed(3) }));
}

export function fixturePlan(footage) {
  const style = loadPreset("pingel-brand");
  style.audio.sounds = false;
  const line = (text, start, key) => {
    const ws = words(text, start).map((w) => ({ ...w, key: key ? w.text.toLowerCase() === key : false }));
    return { words: ws, start: +(start - 0.05).toFixed(3), end: +(ws[ws.length - 1].end + 0.3).toFixed(3), text };
  };
  return {
    version: 1,
    name: "golden",
    preset: style.name,
    video: { src: footage, duration: 10, width: 1080, height: 1920, fps: 30, hasAudio: false },
    canvas: { width: 1080, height: 1920, mode: "portrait" },
    style,
    hook: { text: "The *10 minutes* after a bad number", start: 0, duration: 3, words: [{ text: "The" }, { text: "10", key: true }, { text: "minutes", key: true }, { text: "after" }, { text: "a" }, { text: "bad" }, { text: "number" }] },
    cta: null,
    captions: [line("your team doesn't", 1.2), line("remember the meeting", 2.4, null), line("they remember you", 3.7, "remember"), line("in the room after", 5.0), line("every single time", 8.2, "every")],
    zooms: [{ t: 8.6, scale: 1.08, snap: 0, cut: true, xPercent: 1.2 }],
    graphics: [
      { type: "headline", eyebrow: "WHAT THEY REMEMBER", text: "The *10 minutes after* a bad number", start: 4.9, duration: 1.6 },
      { type: "list", eyebrow: "TWO WAYS TO LEAD", title: "The month closes short", items: [{ text: "Slam the desk", state: "strike", icon: "x" }, { text: "Go cold", state: "strike", icon: "x" }, { text: "Breathe, lower your voice", state: "check", icon: "check" }], start: 6.6, duration: 1.6 },
    ],
    broll: [],
    slams: [{ t: 8.45, end: 9.4, text: "every" }],
    coldOpen: null,
    lowerThird: null,
    framing: { scale: 1, origin: "50% 40%", side: "right", face: null },
    reframe: null,
    behind: null,
    audio: { tracks: [] },
    words: [],
  };
}

async function snapshot(projectDir, outDir) {
  const bin = hyperframesBin();
  await run(bin[0], [...bin.slice(1), "snapshot", projectDir, "-o", outDir, "--at", MOMENTS.map((m) => m.at).join(","), "--no-end", "--keep", "--no-browser-gpu", "--describe", "false", "--timeout", "15000"], { capture: true, env: { ...renderEnv(), PRODUCER_BROWSER_GPU_MODE: "software" } });
  return MOMENTS.map((m) => path.join(outDir, `at-${String(m.at).replace(/\.?0+$/, "")}s.png`));
}

async function half(src, dst) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", `scale=${SIZE.w}:${SIZE.h}:flags=area`, dst]);
}

export async function golden({ update = false, threshold = 0.1, maxDiff = 0.002 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-golden-"));
  try {
    // A gradient from a fixed formula as the footage (lavfi "gradients" is random per run): every frame and every run
    // identical, so only the composition can move pixels.
    const footage = path.join(tmp, "footage.mp4");
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x2b3440:s=1080x1920:d=10:r=30,format=rgb24,geq=r='40+X/14+Y/40':g='48+Y/34':b='60+X/30'", "-c:v", "libx264", "-pix_fmt", "yuv420p", footage]);
    const projectDir = path.join(tmp, "project");
    composeProject(fixturePlan(footage), projectDir);
    let shots = await snapshot(projectDir, path.join(tmp, "shots"));
    fs.mkdirSync(GOLDEN, { recursive: true });
    const compare = async (i, file) => {
      const name = `frame-${String(i + 1).padStart(2, "0")}.png`;
      const got = path.join(tmp, `${i}-${name}`);
      if (!fs.existsSync(file)) throw new Error(`no snapshot at ${MOMENTS[i].at}s (${file})`);
      await half(file, got);
      const want = path.join(GOLDEN, name);
      if (update || !fs.existsSync(want)) { fs.copyFileSync(got, want); return { ...MOMENTS[i], name, status: "written" }; }
      const a = PNG.sync.read(fs.readFileSync(want)), b = PNG.sync.read(fs.readFileSync(got));
      if (a.width !== b.width || a.height !== b.height) return { ...MOMENTS[i], name, status: "size", share: 1, got };
      const diff = new PNG({ width: a.width, height: a.height });
      const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold });
      const share = n / (a.width * a.height);
      return { ...MOMENTS[i], name, status: share > maxDiff ? "changed" : "same", share, got, diff };
    };
    const results = [];
    for (let i = 0; i < MOMENTS.length; i++) results.push(await compare(i, shots[i]));
    // A changed frame is captured once more: a footage frame still loading in the browser is a flake, a change that
    // repeats is real.
    if (results.some((r) => r.status === "changed")) {
      shots = await snapshot(projectDir, path.join(tmp, "shots-again"));
      for (let i = 0; i < results.length; i++) if (results[i].status === "changed") results[i] = await compare(i, shots[i]);
    }
    for (const r of results) {
      if (r.status !== "changed" && r.status !== "size") continue;
      const dd = path.join(GOLDEN, "diff");
      fs.mkdirSync(dd, { recursive: true });
      if (r.diff) fs.writeFileSync(path.join(dd, r.name), PNG.sync.write(r.diff));
      fs.copyFileSync(r.got, path.join(dd, r.name.replace(".png", "-now.png")));
    }
    for (const r of results) { delete r.got; delete r.diff; }
    return results;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const update = process.argv.includes("--update");
  const res = await golden({ update });
  for (const r of res) console.log(`${r.status.padEnd(8)} ${r.name}  ${r.at}s  ${r.what}${r.share != null ? `  (${(r.share * 100).toFixed(3)}% of pixels differ)` : ""}`);
  const bad = res.filter((r) => r.status === "changed" || r.status === "size");
  if (bad.length) {
    console.log(`\n${bad.length} frame${bad.length === 1 ? "" : "s"} changed; diffs in test/golden/diff. Run with --update if the change is intended.`);
    process.exit(1);
  }
}
