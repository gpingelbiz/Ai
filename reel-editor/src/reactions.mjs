import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run as execute, PKG_ROOT, ensureDir, readJSON, writeJSON, sha1, r3, warn } from "./util.mjs";

const SETTINGS = { enter: { applause: 0.75, laughter: 0.65, cheering: 0.75 }, exit: 0.35, minWindows: 2, mergeGap: 0.5, review: 0.40, window: 1.5, hop: 0.75, exitHold: 1 };

/**
 * Hysteresis on ORIGINAL-audio scores. High means detector confidence, never human verification.
 * Two successive entry windows are required. Below-exit scores must persist for exitHold seconds;
 * boundaries end at the last supported window, not at the end of that waiting period.
 * Review-only runs need one window >= review. Crowd is retained in raw scores, never called applause.
 */
export function spansFromScores(rows, options = {}) {
  const opts = { ...SETTINGS, ...options, enter: { ...SETTINGS.enter, ...options.enter } };
  const { enter, exit, minWindows, mergeGap, review, window, hop, exitHold } = opts;
  if (![exit, review, ...Object.values(enter)].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) || !Number.isInteger(minWindows) || minWindows < 1 || ![window, hop].every((v) => Number.isFinite(v) && v > 0) || ![mergeGap, exitHold].every((v) => Number.isFinite(v) && v >= 0) || review < exit || Object.values(enter).some((v) => v < review)) throw new Error("invalid reaction thresholds");
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  sorted.forEach((row, i) => {
    if (!Number.isFinite(row.t) || row.t < 0 || (i && row.t === sorted[i - 1].t) || (row.duration != null && (!Number.isFinite(row.duration) || row.duration <= 0))) throw new Error(`invalid reaction score window ${i}`);
    for (const kind of Object.keys(enter)) if (row[kind] != null && (!Number.isFinite(row[kind]) || row[kind] < 0 || row[kind] > 1)) throw new Error(`invalid ${kind} score at ${row.t}`);
  });
  const spans = [];
  for (const [kind, threshold] of Object.entries(enter)) {
    let active = null, streak = 0, lowSince = null, previous = null;
    const close = () => {
      if (active) spans.push({ kind, start: r3(active.start), end: r3(active.end), peak: active.peak, confidence: active.high ? "high" : "review" });
      active = null; streak = 0; lowSince = null;
    };
    for (const row of sorted) {
      // Missing samples cannot count as consecutive evidence or bridge an unobserved interval.
      if (previous && row.t - previous.t > (previous.hop ?? (previous.duration != null ? previous.duration / 2 : hop)) * 1.5 + 0.001) close();
      const score = row[kind] ?? 0;
      if (active && lowSince != null && row.t - lowSince >= exitHold) close();
      if (score >= review && !active) active = { start: row.t, end: row.t + (row.duration ?? window), peak: score, high: false };
      streak = score >= threshold ? streak + 1 : 0;
      if (active) {
        if (score >= exit) {
          active.end = row.t + (row.duration ?? window);
          active.peak = Math.max(active.peak, score);
          active.high ||= streak >= minWindows;
          lowSince = null;
        } else {
          lowSince ??= row.t;
          if (exitHold === 0) close();
        }
      }
      previous = row;
    }
    close();
  }
  const merged = [];
  for (const span of spans.sort((a, b) => a.kind.localeCompare(b.kind) || a.start - b.start)) {
    const prev = merged.at(-1);
    if (prev && prev.kind === span.kind && span.start - prev.end <= mergeGap + 1e-6) {
      prev.end = Math.max(prev.end, span.end);
      prev.peak = Math.max(prev.peak, span.peak);
      if (span.confidence === "high") prev.confidence = "high";
    } else merged.push({ ...span });
  }
  return merged.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
}

async function reactionsBinary(run, cacheDir) {
  if (process.platform !== "darwin" && run === execute) throw new Error("Apple SoundAnalysis requires macOS");
  const src = path.join(PKG_ROOT, "scripts", "reactions.swift");
  const bin = path.join(cacheDir, `reactions-${sha1(fs.readFileSync(src)).slice(0, 12)}-${process.arch}`);
  if (!fs.existsSync(bin)) {
    ensureDir(cacheDir);
    await run("swiftc", ["-O", "-o", bin, src], { capture: true });
  }
  return bin;
}

function clientWork(file) {
  let dir = path.dirname(path.resolve(file));
  while (true) {
    if (fs.existsSync(path.join(dir, "speaker-manifest.json"))) return path.join(dir, "work");
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * file must be the ORIGINAL source, before any denoise. run has util.run's (cmd,args,opts) signature.
 * workDir is <client>/work (auto-discovered from speaker-manifest.json); key is the source index key.
 * Returns observation spans with stable IDs. Only an operator may later add verified:true.
 */
export async function findReactions(file, { run = execute, workDir = clientWork(file), key, sourceId, force = false, cacheDir = process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), thresholds = {}, log = warn } = {}) {
  if (!fs.existsSync(file)) throw new Error(`reactions: no such source file: ${file}`);
  const stat = fs.statSync(file);
  const fingerprint = sha1(JSON.stringify([path.resolve(file), stat.size, stat.mtimeMs, fs.readFileSync(path.join(PKG_ROOT, "scripts", "reactions.swift"), "utf8"), SETTINGS, thresholds]));
  key ??= fingerprint.slice(0, 16);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(key)) throw new Error(`reactions: unsafe source key ${key}`);
  const cache = workDir ? path.join(workDir, "index", `${key}.reactions.json`) : null;
  if (cache && !force) {
    try {
      const old = readJSON(cache);
      if (old.fingerprint === fingerprint && old.sourceId === sourceId && Array.isArray(old.spans)) return old.spans;
    } catch {}
  }
  try {
    const bin = await reactionsBinary(run, cacheDir);
    // AVAudioFile/SoundAnalysis support audio containers. Decode the original audio losslessly to PCM;
    // no denoise, gain, time edits or resampling. This also handles video containers consistently.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-reactions-"));
    let result;
    try {
      const audio = path.join(temp, "original.wav");
      await run("ffmpeg", ["-y", "-v", "error", "-i", path.resolve(file), "-map", "0:a:0", "-vn", "-c:a", "pcm_f32le", audio], { capture: true });
      result = await run(bin, [audio], { capture: true });
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    const output = typeof result === "string" ? result : result.out;
    const rows = String(output || "").split(/\r?\n/).filter((s) => s.trim()).map((s) => JSON.parse(s));
    const spans = spansFromScores(rows, thresholds).map((span) => ({ ...span, id: `r-${sha1(JSON.stringify([key, span.kind, span.start, span.end])).slice(0, 12)}`, ...(sourceId ? { sourceId } : {}) }));
    if (cache) writeJSON(cache, { schemaVersion: 1, source: path.resolve(file), sourceId, key, fingerprint, detector: "Apple SoundAnalysis version1", settings: { ...SETTINGS, ...thresholds, enter: { ...SETTINGS.enter, ...thresholds.enter } }, rows, spans });
    return spans;
  } catch (error) {
    log(`reactions: unavailable (${String(error.message).split("\n")[0]}); continuing without reaction suggestions`);
    return [];
  }
}
