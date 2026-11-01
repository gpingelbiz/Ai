import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probe } from "./probe.mjs";
import { run as execute, readJSON, writeJSON, PKG_ROOT, r3, warn, log as statusLog } from "./util.mjs";

export const INSERT_VERSION = 1;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const safeKey = (key) => typeof key === "string" && /^[a-zA-Z0-9_-]+$/.test(key);
const validFlags = (flags) => Array.isArray(flags) && flags.every((f) => f && Number.isFinite(f.start) && Number.isFinite(f.end) && f.start >= 0 && f.end > f.start && ["insert", "slide", "title-card"].includes(f.kind) && Number.isFinite(f.confidence) && f.confidence >= 0 && f.confidence <= 1 && typeof f.reason === "string");

/** Original-source seconds, including the first/last scene. -ss precedes -i even for calibration slices. */
export async function sceneSegments(file, { start = 0, end, threshold = 0.25, run = execute } = {}) {
  if (end == null) end = (await probe(file)).duration;
  if (![start, end, threshold].every(Number.isFinite) || start < 0 || end <= start || threshold <= 0 || threshold >= 1) throw new Error("inserts: invalid scene range or threshold");
  const { err = "", out = "" } = await run("ffmpeg", ["-hide_banner", "-nostats", "-ss", String(start), "-i", file, "-t", String(end - start), "-an", "-vf", `scale=320:-2,setpts=PTS-STARTPTS,select='gt(scene,${threshold})',showinfo`, "-fps_mode", "vfr", "-f", "null", "-"], { capture: true });
  const cuts = [...`${err}\n${out}`.matchAll(/pts_time:([\d.e+-]+)/g)].map((m) => r3(start + Number(m[1]))).filter((t) => t > start && t < end);
  const times = [start, ...new Set(cuts.sort((a, b) => a - b)), end];
  return times.slice(0, -1).map((t, i) => ({ start: t, end: times[i + 1] }));
}

/** 16x9 RGB signature plus a local edge/flat-colour measure; no semantic/identity claims. */
export function thumbnailFeatures(bytes) {
  if (bytes.length !== 16 * 9 * 3 || [...bytes].some((x) => !Number.isFinite(x) || x < 0 || x > 255)) throw new Error("inserts: expected a 16x9 RGB thumbnail");
  const signature = Array.from(bytes, (n) => n / 255), grey = [];
  for (let i = 0; i < bytes.length; i += 3) grey.push((bytes[i] + bytes[i + 1] + bytes[i + 2]) / (3 * 255));
  let flat = 0, edges = 0, count = 0;
  for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) {
    const k = y * 16 + x;
    for (const j of [x < 15 ? k + 1 : null, y < 8 ? k + 16 : null].filter((v) => v != null)) {
      const delta = Math.abs(grey[k] - grey[j]);
      flat += delta < 0.035 ? 1 : 0; edges += delta; count++;
    }
  }
  return { signature, method: "thumbnail", flatness: flat / count, edge: edges / count, textArea: 0 };
}

/** A rare scene must differ from OTHER parts of the talk, not just its immediate neighbours. */
export function classifySegments(segments, features) {
  if (segments.length !== features.length) throw new Error("inserts: one feature record per segment required");
  if (segments.length < 4) return []; // Too little recurring-room evidence to make a useful comparison.
  // Colour distribution makes the fallback less sensitive to camera pans and zooms than pixel position alone.
  const histograms = features.map((f) => {
    if (f?.method !== "thumbnail" || f.signature?.length !== 432) return null;
    const h = Array(64).fill(0);
    for (let k = 0; k < 432; k += 3) {
      const bin = (v) => Math.max(0, Math.min(3, Math.floor(v * 4)));
      h[bin(f.signature[k]) * 16 + bin(f.signature[k + 1]) * 4 + bin(f.signature[k + 2])] += 1 / 144;
    }
    return h;
  });
  const distance = (i, j, spatialOnly = false) => {
    const a = features[i], b = features[j];
    if (!a?.signature?.length || a.signature.length !== b?.signature?.length || a.method !== b.method || a.signature.some((v) => !Number.isFinite(v)) || b.signature.some((v) => !Number.isFinite(v))) return Infinity;
    const sum = a.signature.reduce((n, v, k) => n + (v - b.signature[k]) ** 2, 0);
    const spatial = Math.sqrt(sum / (a.method === "vision" ? 1 : a.signature.length));
    if (!histograms[i] || !histograms[j] || spatialOnly) return spatial;
    const colour = Math.sqrt(Math.max(0, 1 - histograms[i].reduce((n, p, k) => n + Math.sqrt(p * histograms[j][k]), 0)));
    return (spatial + colour) / 2;
  };
  const graphic = (f) => f?.flatness > 0.45 && f.edge < 0.085;
  const distant = (i, j) => Math.abs(i - j) > 1 && Math.abs((segments[i].start + segments[i].end - segments[j].start - segments[j].end) / 2) >= 12;
  // Repeated two-second photos and repeated slates are not room references. Require recurrence across
  // several parts of the talk, or a sustained camera view. Graphics cannot vouch for other graphics.
  const room = segments.map((s, i) => {
    if (graphic(features[i])) return false;
    const radius = features[i]?.method === "vision" ? 0.3 : 0.16;
    const matches = segments.map((_, j) => j).filter((j) => distance(i, j, true) < radius);
    return s.end - s.start >= 6 || (matches.length >= 3 && matches.some((j) => distant(i, j)));
  });
  if (room.filter(Boolean).length < 2) return [];
  const nearest = segments.map((_, i) => Math.min(Infinity, ...segments.map((other, j) => room[j] && distant(i, j) ? distance(i, j) : Infinity)));
  const baseline = nearest.filter((v, i) => room[i] && Number.isFinite(v));
  const typical = median(baseline), mad = median(baseline.map((v) => Math.abs(v - typical)));
  return segments.flatMap((s, i) => {
    const f = features[i], d = nearest[i];
    if (!Number.isFinite(d) || !f || s.end <= s.start) return [];
    const floor = f.method === "vision" ? 0.3 : histograms[i] ? 0.31 : 0.08;
    const limit = Math.max(floor, typical + Math.max(3 * mad, typical * 0.65));
    const weight = s.end - s.start < 6 ? 1.1 : 1;
    const novelty = d * weight / limit;
    if (novelty <= 1) return [];
    const card = f.flatness > 0.82 && f.edge < 0.07;
    const kind = f.textArea >= 0.035 ? (card ? "title-card" : "slide") : card ? "title-card" : graphic(f) ? "slide" : "insert";
    const reason = `Visually unlike recurring room shots (nearest distance ${r3(d)}, typical ${r3(typical)})${s.end - s.start < 6 ? "; under six seconds" : ""}${f.textArea >= 0.035 ? "; substantial detected text" : card ? "; mostly flat colour with few edges" : graphic(f) ? "; flat-colour/edge pattern suggests a slide" : ""}. Verify the original picture before trimming or covering it.`;
    return [{ start: r3(s.start), end: r3(s.end), kind, confidence: r3(Math.min(0.95, 0.5 + (novelty - 1) * 0.3)), reason }];
  });
}

let unavailableBinary = false;

/** Compile locally, independently of ASR and all transcript cache versions. */
export async function featureprintBinary({ run = execute, cacheDir = process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor") } = {}) {
  if (process.platform !== "darwin" || (run === execute && unavailableBinary)) return null;
  try {
    const src = path.join(PKG_ROOT, "scripts", "featureprint.swift");
    const bin = path.join(cacheDir, `featureprint-${Math.round(fs.statSync(src).mtimeMs)}`);
    if (!fs.existsSync(bin)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      await run("swiftc", ["-O", src, "-o", bin], { capture: true });
    }
    return bin;
  } catch { if (run === execute) unavailableBinary = true; return null; }
}

/** One centre frame per scene. Vision uses upright frames; ffmpeg autorotates its fallback frames too. */
export async function segmentFeatures(file, segments, { run = execute, binary = featureprintBinary, log = warn } = {}) {
  if (!segments.length) return [];
  const times = segments.map((s) => r3((s.start + s.end) / 2));
  try {
    const bin = await binary({ run });
    if (!bin) throw new Error("local Vision helper unavailable");
    const frames = [];
    for (let i = 0; i < times.length; i += 120) {
      const { out } = await run(bin, [file, ...times.slice(i, i + 120).map(String)], { capture: true });
      const data = JSON.parse(out);
      if (!Array.isArray(data.frames) || data.frames.length !== Math.min(120, times.length - i)) throw new Error("incomplete Vision frames");
      frames.push(...data.frames.map((f) => {
        if (!f.signature?.length || f.signature.some((v) => !Number.isFinite(v))) throw new Error("invalid Vision signature");
        const norm = Math.hypot(...f.signature);
        if (!norm) throw new Error("empty Vision signature");
        return { ...thumbnailFeatures(f.thumbnail), ...f, signature: f.signature.map((v) => v / norm), method: "vision" };
      }));
    }
    return frames;
  } catch (error) { log(`inserts: Vision unavailable (${String(error.message).split("\n")[0]}); using ffmpeg thumbnail signatures`); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-inserts-"));
  try {
    const features = [];
    for (const t of times) {
      const dest = path.join(dir, "frame.rgb");
      await run("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=16:9", "-pix_fmt", "rgb24", "-f", "rawvideo", dest], { capture: true });
      features.push(thumbnailFeatures(fs.readFileSync(dest)));
    }
    return features;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Returns flags and writes ONLY an independent analysis cache, never source facts or transcripts. */
export async function detectInserts(file, row, { indexDir = path.join("work", "index"), sourceId = row.id, scenes = sceneSegments, features = segmentFeatures, log = warn, run = execute, binary } = {}) {
  try {
    if (!safeKey(row.key)) throw new Error("missing or unsafe source cache key");
    const dest = path.join(indexDir, `${row.key}.inserts.json`);
    try {
      const cached = readJSON(dest);
      if (cached.version === INSERT_VERSION && validFlags(cached.inserts)) return cached.inserts;
    } catch { /* Missing or corrupt analysis is recomputed without touching ASR. */ }
    const segments = await scenes(file, { start: 0, end: row.duration, run });
    const observations = await features(file, segments, { run, log, ...(binary ? { binary } : {}) });
    if (observations.some((f) => !f?.signature?.length || f.signature.some((v) => !Number.isFinite(v)))) throw new Error("incomplete visual signatures");
    const inserts = classifySegments(segments, observations);
    writeJSON(dest, { sourceId, version: INSERT_VERSION, inserts });
    return inserts;
  } catch (error) {
    log(`inserts: unavailable (${String(error.message).split("\n")[0]}); continuing without insert suggestions`);
    return [];
  }
}

/** Missing/old observations mean unmeasured, never a clean-picture assertion. */
export function loadInsertFlags(folder, { log = warn } = {}) {
  const out = {};
  try {
    const index = readJSON(path.join(folder, "work", "index", "sources.json"));
    for (const [id, row] of Object.entries(index.sources || {})) {
      if (!safeKey(row.key)) continue;
      const file = path.join(folder, "work", "index", `${row.key}.inserts.json`);
      if (!fs.existsSync(file)) continue;
      try { const cached = readJSON(file); if (cached.version === INSERT_VERSION && validFlags(cached.inserts)) out[id] = cached.inserts; }
      catch { log(`inserts: cannot read observations for ${id}; continuing`); }
    }
  } catch { /* An unindexed plan has no optional observations. */ }
  return out;
}

/** Subtract all cutaways from primary picture; inspect cutaway pictures themselves as well. Times stay source-owned. */
export function visibleInsertIntersections(plan, bySource = {}) {
  const hits = [], fps = plan.canvas?.fps || 30;
  const output = (i) => ({ start: i.outputStart ?? i.start ?? i.startFrame / fps, end: i.outputEnd ?? i.end ?? i.endFrame / fps });
  const cutaways = plan.cutaways || [];
  for (const item of [...(plan.items || []).filter((i) => i.kind === "clip"), ...cutaways]) {
    const span = output(item);
    if (![span.start, span.end, item.in, item.out].every(Number.isFinite)) continue;
    let visible = [{ start: span.start, end: Math.min(span.end, span.start + item.out - item.in) }];
    if (!cutaways.includes(item)) for (const x of cutaways.filter((x) => x.over === item.id)) {
      const cover = output(x);
      visible = visible.flatMap((v) => cover.end <= v.start || cover.start >= v.end ? [v] : [{ start: v.start, end: Math.min(v.end, cover.start) }, { start: Math.max(v.start, cover.end), end: v.end }].filter((p) => p.end > p.start));
    }
    for (const flag of bySource[item.sourceId] || []) for (const v of visible) {
      const start = Math.max(flag.start, item.in + v.start - span.start), end = Math.min(flag.end, item.in + v.end - span.start);
      if (end - start <= 1e-6) continue;
      hits.push({ ...flag, itemId: item.id, sourceId: item.sourceId, start: r3(start), end: r3(end), outputStart: r3(span.start + start - item.in), outputEnd: r3(span.start + end - item.in) });
    }
  }
  return hits.sort((a, b) => a.outputStart - b.outputStart || a.itemId.localeCompare(b.itemId));
}

export function insertWarnings(plan, bySource) {
  return visibleInsertIntersections(plan, bySource).map((hit) => ({ code: "baked-insert", level: "warn", ...hit,
    message: `item ${hit.itemId} shows a likely ${hit.kind === "insert" ? "stock insert" : hit.kind} ${hit.start}-${hit.end}; cover it with a cutaway or trim` }));
}

/** Analysis-only CLI: fresh saved index required; this never invokes ASR, candidates or rendering. */
export async function analyzeSpeakerInserts(folder, { source } = {}, { inserts = detectInserts, print = statusLog } = {}) {
  const { loadManifest, assetPath, assertNoGreg } = await import("./speaker-intake.mjs");
  const { loadSourceIndex } = await import("./speaker-index.mjs");
  folder = path.resolve(folder);
  const { manifest, problems } = loadManifest(folder);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) throw new Error(errors.map((p) => `${p.id}: ${p.message}`).join("\n"));
  assertNoGreg(manifest, "manifest");
  if (source && !manifest.sources.some((s) => s.id === source)) throw new Error(`speaker: unknown sourceId ${source}`);
  const brand = readJSON(assetPath(folder, manifest.brand.file));
  assertNoGreg(brand, "brand");
  const index = loadSourceIndex(folder, manifest, { brand }), out = {};
  for (const s of manifest.sources.filter((s) => !source || s.id === source)) {
    const row = index.sources[s.id];
    if (!row.hasVideo || !["stage", "podcast", "webinar", "interview"].includes(s.kind)) continue;
    out[s.id] = await inserts(assetPath(folder, s.path), row, { indexDir: path.join(folder, "work", "index"), sourceId: s.id, log: print });
    print(`${s.id}: ${out[s.id].length} baked-insert suggestions; verify each original picture`);
  }
  return out;
}
