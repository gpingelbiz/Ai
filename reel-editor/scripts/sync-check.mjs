#!/usr/bin/env node
// Read-only diagnostic, no Chromium: node scripts/sync-check.mjs render.mp4 plan.json [--boxes boxes.json]
// boxes.json optionally maps cue IDs to {x,y,w,h} in canvas pixels. Use tight boxes that exclude the speaker.
// Audio uses waveform correlation against the actual SFX, so a loud spoken syllable is not mistaken for the hit.
// Picture uses frame differences against the settled crop. It is a candidate for human inspection, not a QC gate:
// speaker motion, another graphic, a shake or a count-up can make the visual result uncertain.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { soundCues } from "../src/sounds.mjs";
import { glowSoundCues } from "../src/glow-sound.mjs";
import { isMain, PKG_ROOT } from "../src/util.mjs";

/** Normalized template correlation; return the source-file start, not its internal transient. */
export function matchAudio(samples, template, { rate = 8000, from = 0, expectedStart = 0, search = 0.2 } = {}) {
  if (!template.length || samples.length < template.length) return null;
  let templateEnergy = 0;
  for (const value of template) templateEnergy += value * value;
  if (!templateEnergy) return null;
  const lo = Math.max(0, Math.ceil((expectedStart - search - from) * rate));
  const hi = Math.min(samples.length - template.length, Math.floor((expectedStart + search - from) * rate));
  let best = null;
  for (let lag = lo; lag <= hi; lag++) {
    let dot = 0, energy = 0;
    for (let j = 0; j < template.length; j++) {
      const value = samples[lag + j];
      dot += value * template[j]; energy += value * value;
    }
    const score = energy ? Math.abs(dot) / Math.sqrt(energy * templateEnergy) : 0;
    if (!best || score > best.score) best = { start: from + lag / rate, score };
  }
  return best;
}

/** First frame within 5% of the settled reference, held for two frames. Gray crops share one pixel count. */
export function findVisualLanding(frames, { fps = 30, firstFrame = 0 } = {}) {
  if (frames.length < 4 || !frames[0].length || frames.some((frame) => frame.length !== frames[0].length)) return null;
  const reference = frames.at(-1);
  const differences = frames.map((frame) => frame.reduce((sum, value, i) => sum + Math.abs(value - reference[i]), 0) / frame.length);
  const peak = Math.max(...differences), noise = Math.max(...differences.slice(-3));
  if (peak < 3 || noise >= peak * 0.5) return null;
  const threshold = Math.max(1, noise + (peak - noise) * 0.05);
  const peakFrame = differences.indexOf(peak);
  const at = differences.findIndex((difference, i) => i > peakFrame && i < differences.length - 2 && difference <= threshold && differences[i + 1] <= threshold);
  return at < 0 ? null : { at: (firstFrame + at) / fps, contrast: peak, noise, method: "95% settled crop difference" };
}

function ffmpeg(args) {
  return execFileSync("ffmpeg", ["-v", "error", ...args], { maxBuffer: 16 * 1024 * 1024 });
}

function mono(file, { from, duration } = {}) {
  const bytes = ffmpeg([...(from == null ? [] : ["-ss", String(from)]), "-i", file, ...(duration == null ? [] : ["-t", String(duration)]), "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"]);
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
}

export function checkSync(render, plan, { planFile, boxes = {} } = {}) {
  const fps = plan.style?.render?.fps || 30;
  const W = plan.canvas.width, H = plan.canvas.height;
  const glow = plan.style?.captions?.style === "glow";
  const declared = glow ? glowSoundCues(plan, { audit: true }) : soundCues({ ...plan, fps, zoomStyle: plan.style?.zooms?.style, graphicsMode: plan.style?.graphics?.mode, duration: plan.video?.duration, audit: true });
  const byID = new Map(declared.map((cue) => [cue.id, cue.sync]));
  const results = [];
  for (const cue of plan.audio?.tracks || []) {
    if (!cue.id?.startsWith("sfx-")) continue;
    const sync = cue.sync || byID.get(cue.id);
    if (!sync) { results.push({ id: cue.id, status: "unmeasured", reason: "No declared landing for this track" }); continue; }
    const local = planFile && path.resolve(path.dirname(planFile), "project", cue.src);
    const asset = local && fs.existsSync(local) ? local : path.join(PKG_ROOT, cue.src);
    const template = mono(asset);
    const from = Math.max(0, cue.start - 0.2);
    const audio = matchAudio(mono(render, { from, duration: template.length / 8000 + 0.4 }), template, { from, expectedStart: cue.start });
    const rawBox = boxes[cue.id] || sync.box;
    const validBox = rawBox && [rawBox.x, rawBox.y, rawBox.w, rawBox.h].every(Number.isFinite) && rawBox.w > 0 && rawBox.h > 0;
    const x = validBox ? Math.max(0, Math.min(W - 1, Math.round(rawBox.x))) : 0;
    const y = validBox ? Math.max(0, Math.min(H - 1, Math.round(rawBox.y))) : 0;
    const w = validBox ? Math.max(1, Math.min(W - x, Math.round(rawBox.w))) : W;
    const h = validBox ? Math.max(1, Math.min(H - y, Math.round(rawBox.h))) : H;
    const firstFrame = Math.max(0, sync.landFrame - Math.ceil(0.4 * fps));
    const bytes = ffmpeg(["-ss", String(firstFrame / fps), "-i", render, "-an", "-vf", `fps=${fps},crop=${w}:${h}:${x}:${y},scale=64:64,format=gray`, "-frames:v", String(Math.ceil(0.65 * fps) + 1), "-f", "rawvideo", "pipe:1"]);
    const frames = Array.from({ length: Math.floor(bytes.length / 4096) }, (_, i) => bytes.subarray(i * 4096, (i + 1) * 4096));
    const visual = findVisualLanding(frames, { fps, firstFrame });
    const transient = audio ? audio.start + sync.offset : null;
    results.push({ id: cue.id, status: audio?.score >= 0.35 && visual && validBox ? "candidate" : "uncertain", scheduledStart: cue.start, declaredLanding: sync.landAt, audioTransient: transient, audioCorrelation: audio?.score ?? null, visualLanding: visual?.at ?? null, deltaMs: transient != null && visual ? (transient - visual.at) * 1000 : null, declaredDeltaMs: transient == null ? null : (transient - sync.landAt) * 1000, box: { x, y, w, h }, fullFrameFallback: !validBox, clipped: sync.clipped, visual });
  }
  return { fps, note: "Positive delta means audio is late. Visual results are frame-difference candidates; inspect the crop around the reported frame.", cues: results };
}

if (isMain(import.meta.url)) {
  try {
    const [render, planFile, flag, boxesFile] = process.argv.slice(2);
    if (!render || !planFile || (flag && (flag !== "--boxes" || !boxesFile))) throw new Error("Usage: node scripts/sync-check.mjs render.mp4 plan.json [--boxes boxes.json]");
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    const boxes = boxesFile ? JSON.parse(fs.readFileSync(boxesFile, "utf8")) : {};
    console.log(JSON.stringify(checkSync(render, plan, { planFile, boxes }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
