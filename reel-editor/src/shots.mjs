import fs from "node:fs";
import { detectFaces } from "./placement.mjs";
import { probe } from "./probe.mjs";
import { r3, warn } from "./util.mjs";

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2 : 0; };
const boxes = (xs, floor) => (xs || []).filter((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1.001 && b.y + b.h <= 1.001 && (b.confidence == null || b.confidence > floor));

/** Labels are geometric observations, never evidence that a crowd belongs to this speaker or moment. */
export function classifyShot(sample) {
  if (sample.width != null && sample.height != null && sample.width <= sample.height) return "unknown";
  const faces = boxes(sample.faces, 0.5), bodies = boxes(sample.bodies, 0.3);
  // Two rows must each contain at least two faces, separated by a typical small face's height.
  const ys = faces.map((f) => f.y + f.h / 2).sort((a, b) => a - b);
  const height = median(faces.map((f) => f.h));
  const twoRows = ys.some((y, i) => i >= 1 && i < ys.length - 2 && ys[i + 1] - y >= Math.max(0.04, height * 0.6));
  if ((faces.length >= 6 && height < 0.12 && twoRows) || bodies.length >= 8) return "audience-candidate";
  if (!faces.length) return "unknown";
  const largest = faces.reduce((a, b) => a.h >= b.h ? a : b);
  // Prefer a confirmed track when supplied; otherwise a single face/body pair is only a wide observation.
  const face = sample.speaker?.face || (faces.length === 1 ? largest : null);
  const body = sample.speaker?.body || (faces.length === 1 && bodies.length === 1 ? bodies[0] : null);
  if (face && body && boxes([face], 0.5).length && boxes([body], 0.3).length && face.h < 0.10 && body.h < 0.50) return "wide";
  if (largest.h >= 0.25) return "close";
  if (largest.h >= 0.10) return "medium";
  return "unknown";
}

/** Adjacent samples at fps are grouped; audience/wide observations need at least two consecutive samples. */
export function groupShots(samples, { fps = 2, minSamples = 2, duration = Infinity } = {}) {
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isInteger(minSamples) || minSamples < 2 || !(duration > 0)) throw new Error("invalid shot sampling settings");
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const groups = [];
  sorted.forEach((s, i) => {
    if (!Number.isFinite(s.t) || s.t < 0 || s.t >= duration || (i && s.t === sorted[i - 1].t)) throw new Error(`invalid shot sample time ${s.t}`);
    const kind = classifyShot(s);
    const prev = groups.at(-1);
    if (prev && prev.kind === kind && s.t - prev.samples.at(-1).t <= 1.5 / fps + 1e-6) {
      prev.samples.push(s);
      prev.end = r3(Math.min(duration, s.t + 1 / fps));
    } else groups.push({ kind, start: r3(s.t), end: r3(Math.min(duration, s.t + 1 / fps)), samples: [s], observation: true });
  });
  const out = [];
  for (const group of groups) {
    if (["wide", "audience-candidate"].includes(group.kind) && group.samples.length < minSamples) group.kind = "unknown";
    const prev = out.at(-1);
    if (prev?.kind === group.kind && group.start <= prev.end + 1e-6) {
      prev.end = group.end;
      prev.samples.push(...group.samples);
    } else out.push(group);
  }
  return out;
}

/**
 * Sample ORIGINAL landscape frames with the existing faces.swift adapter, without reframing.
 * run(video, times) returns {width,height,frames:[{t,faces,bodies}]} like detectFaces; meta avoids a probe in tests.
 * The runner is batched to bound Vision memory and argument size on hour-long recordings.
 */
export async function shotCandidates(file, { fps = 2, run = detectFaces, meta, log = warn } = {}) {
  if (!fs.existsSync(file)) throw new Error(`shots: no such source file: ${file}`);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 30) throw new Error("shots: fps must be >0 and <=30");
  const info = meta || await probe(file);
  if (!Number.isFinite(info.duration) || info.duration <= 0) throw new Error(`shots: invalid source duration: ${file}`);
  if (![info.width, info.height].every((v) => Number.isFinite(v) && v > 0)) throw new Error(`shots: invalid source geometry: ${file}`);
  if (info.width <= info.height) return [];
  try {
    const samples = [];
    const count = Math.ceil(info.duration * fps);
    for (let i = 0; i < count; i += 120) {
      const times = Array.from({ length: Math.min(120, count - i) }, (_, j) => r3((i + j) / fps));
      const result = await run(file, times);
      if (!result || !Array.isArray(result.frames)) throw new Error("Vision face/body helper unavailable");
      if (![result.width, result.height].every((v) => Number.isFinite(v) && v > 0)) throw new Error("Vision returned no landscape geometry");
      if (result.width <= result.height) return [];
      const frames = new Map(result.frames.map((s) => [r3(s.t), s]));
      // Keep failed decodes as unknown samples, so they cannot bridge two separate shots.
      for (const t of times) samples.push({ ...(frames.get(t) || { t, faces: [], bodies: [] }), width: result.width, height: result.height });
    }
    return groupShots(samples, { fps, duration: info.duration });
  } catch (error) {
    log(`shots: unavailable (${String(error.message).split("\n")[0]}); continuing without shot suggestions`);
    return [];
  }
}
