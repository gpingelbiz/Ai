import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { findDeepFilter } from "./studio.mjs";
import { run as execute, readJSON, writeJSON, ensureDir, warn } from "./util.mjs";
import { measurePassage } from "./speaker-audio-quality.mjs";

const RATE = 48000, HANDLE = 24000, VERSION = 3;
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;

export function repairOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("audioRepair must be an object");
  const { profile, ...rest } = value;
  if (!["dfn3-6", "dfn3-9"].includes(profile)) throw new Error("audioRepair.profile must be dfn3-6 or dfn3-9");
  if (Object.hasOwn(rest, "engine") || Object.hasOwn(rest, "attenLimitDb")) throw new Error("audioRepair uses profile to select attenuation");
  try {
    const settings = repairSettings({ ...rest, engine: "deepfilternet", attenLimitDb: profile === "dfn3-6" ? 6 : 9 });
    return { ...settings, allowProtected: value.allowProtected === true, auditioned: value.auditioned === true };
  } catch (e) { throw new Error(e.message.replaceAll("enhance", "audioRepair")); }
}

export function repairSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("enhance must be an object");
  const allowed = ["engine", "attenLimitDb", "channel", "allowProtected", "dryRanges", "rampMs", "auditioned"];
  for (const k of Object.keys(value)) if (!allowed.includes(k)) throw new Error(`unknown enhance setting: ${k}`);
  if (value.engine !== "deepfilternet") throw new Error("enhance.engine must be deepfilternet");
  if (![6, 9].includes(value.attenLimitDb)) throw new Error("enhance.attenLimitDb must be 6 or 9");
  if (!["existing", "left", "right"].includes(value.channel ?? "existing")) throw new Error("enhance.channel must be existing, left or right");
  for (const k of ["allowProtected", "auditioned"]) if (value[k] != null && typeof value[k] !== "boolean") throw new Error(`enhance.${k} must be boolean`);
  if (value.rampMs != null && (!finite(value.rampMs) || value.rampMs < 1 || value.rampMs > 1000)) throw new Error("enhance.rampMs must be 1 to 1000");
  if (value.dryRanges != null && !Array.isArray(value.dryRanges)) throw new Error("enhance.dryRanges must be an array");
  const dryRanges = value.dryRanges || [];
  for (const r of dryRanges) if (!r || !finite(r.start) || !finite(r.end) || r.start < 0 || r.end <= r.start) throw new Error("enhance.dryRanges need source seconds 0 <= start < end");
  return { engine: value.engine, attenLimitDb: value.attenLimitDb, channel: value.channel ?? "existing", rampMs: value.rampMs ?? 150, dryRanges };
}

/** Full content identity, bounded memory even for a camera master. The native binary embeds its model. */
export function repairFileHash(file) {
  const hash = crypto.createHash("sha256"), fd = fs.openSync(file, "r"), buffer = Buffer.alloc(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

export function repairCacheKey(evidence) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical({ version: VERSION, ...evidence }))).digest("hex");
}

/** Protect hints as well as verified reactions. Ramps sit OUTSIDE each source-clock interval. */
export function reactionRanges(reactions, dryRanges, sourceId) {
  if (!Array.isArray(reactions)) throw new Error("reaction index has no spans");
  const ranges = [...dryRanges];
  for (const r of reactions) {
    if (r.sourceId != null && r.sourceId !== sourceId) throw new Error("reaction index belongs to another source");
    if (!["laughter", "applause", "cheering", "audience_response"].includes(r.kind)) continue;
    if (!finite(r.start) || !finite(r.end) || r.start < 0 || r.end <= r.start) throw new Error("invalid reaction interval");
    ranges.push({ start: r.start, end: r.end });
  }
  const merged = [];
  for (const r of ranges.sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && r.start <= previous.end) previous.end = Math.max(previous.end, r.end);
    else merged.push({ start: r.start, end: r.end });
  }
  return merged;
}

function wetAt(n, start, ranges, rampMs) {
  let wet = 1;
  for (const r of ranges) {
    // Round outward: even a fractional boundary protects every touched sample.
    const a = Math.floor((r.start - start) * RATE + 1e-7), b = Math.ceil((r.end - start) * RATE - 1e-7);
    const distance = n < a ? a - n : n >= b ? n - b : 0;
    const u = Math.min(1, distance / (rampMs * RATE / 1000));
    wet = Math.min(wet, u * u * (3 - 2 * u));
  }
  return wet;
}

/** Mono float PCM before the common gain/fades. Copy dry bytes exactly, without summing two full signals. */
export function blendOriginalReactions(original, enhanced, { start, ranges = [], rampMs = 150 }) {
  if (original.length !== enhanced.length || original.length % 4) throw new Error("repair sample count mismatch");
  const result = Buffer.alloc(original.length);
  for (let n = 0; n < original.length / 4; n++) {
    const x = original.readFloatLE(n * 4), e = enhanced.readFloatLE(n * 4);
    if (!Number.isFinite(x) || !Number.isFinite(e)) throw new Error("non-finite repair sample");
    const wet = wetAt(n, start, ranges, rampMs);
    if (wet === 0) original.copy(result, n * 4, n * 4, n * 4 + 4);
    else result.writeFloatLE(x + wet * (e - x), n * 4);
  }
  return result;
}

/** Strong displaced waveform evidence fails open. Quiet/uncorrelated audio cannot establish alignment. */
function alignmentChecks(original, enhanced, options) {
  const count = original.length / 4, windows = [];
  for (const fraction of [0.2, 0.5, 0.8]) {
    const center = Math.floor(count * fraction), from = Math.max(480, center - 6000), to = Math.min(count - 480, center + 6000);
    let best = 0, bestLag = null, zero = null;
    for (let lag = -480; lag <= 480; lag += 16) {
      let dot = 0, xx = 0, yy = 0, points = 0;
      for (let n = from; n < to; n += 16) {
        if (wetAt(n, options.start, options.ranges || [], options.rampMs || 150) < 1) continue;
        const x = original.readFloatLE(n * 4), y = enhanced.readFloatLE((n + lag) * 4);
        dot += x * y; xx += x * x; yy += y * y; points++;
      }
      if (points <= 50 || xx <= 1e-12 || yy <= 1e-12) continue;
      const score = dot / Math.sqrt(xx * yy);
      if (lag === 0) zero = score;
      if (score > best) { best = score; bestLag = lag; }
    }
    if (best > 0.85 && best - zero > 0.12 && Math.abs(bestLag) >= 48) throw new Error(`unexplained repair timing shift (${bestLag} samples)`);
    windows.push({ bestLag, correlation: bestLag == null ? null : best, zeroCorrelation: zero });
  }
  return windows;
}

export function validateRepair(original, enhanced, repaired, options) {
  // The two-buffer form is also useful for a stand-alone reaction null check.
  if (options == null) { options = repaired; repaired = enhanced; enhanced = null; }
  const { samples, start, ranges = [], rampMs = 150 } = options;
  if (original.length !== samples * 4 || repaired.length !== samples * 4 || enhanced && enhanced.length !== samples * 4) throw new Error("repair sample count mismatch");
  if (enhanced && !blendOriginalReactions(original, enhanced, { start, ranges, rampMs }).equals(repaired)) throw new Error("repair blend or reaction null mismatch");
  let protectedSamples = 0, maxReactionError = 0;
  for (let n = 0; n < samples; n++) {
    const x = original.readFloatLE(n * 4), y = repaired.readFloatLE(n * 4);
    if (!Number.isFinite(x) || !Number.isFinite(y) || enhanced && !Number.isFinite(enhanced.readFloatLE(n * 4))) throw new Error("non-finite repair sample");
    if (ranges.some((r) => n >= Math.floor((r.start - start) * RATE + 1e-7) && n < Math.ceil((r.end - start) * RATE - 1e-7))) {
      protectedSamples++;
      maxReactionError = Math.max(maxReactionError, Math.abs(y - x));
      if (!original.subarray(n * 4, n * 4 + 4).equals(repaired.subarray(n * 4, n * 4 + 4))) throw new Error("reaction null check failed");
    }
  }
  const alignment = enhanced ? alignmentChecks(original, enhanced, options) : [];
  return { samples, finite: true, protectedSamples, maxReactionError, reactionNull: true, alignment };
}

export const repairDryRanges = (reactions, settings, _start, _samples) => reactionRanges(reactions, settings.dryRanges || []);

export function loadRepairReactions(workDir, key, sourceId, sourceFile) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key || "")) throw new Error("reaction index source key missing");
  const file = path.join(workDir, "index", `${key}.reactions.json`), record = readJSON(file);
  if (record.key !== key || record.sourceId !== sourceId || sourceFile && (!record.source || fs.realpathSync(record.source) !== fs.realpathSync(sourceFile))) throw new Error("reaction index source identity mismatch");
  return record.spans;
}

/** Native -D removes lookahead but shortens the tail. Feed 0.5s of extra silence, then trim, never stretch. */
export async function prepareRepair(file, { original, sourceKey, sourceId, stream, start, samples, out = start + samples / RATE, sourceDuration, mono, settings, reactions, cacheDir,
  binary = findDeepFilter(), execute: injected, run = injected || execute, measure = measurePassage, print = warn } = {}) {
  const fallback = (reason) => {
    const message = `dialogue enhance: ${String(reason).split("\n")[0]}; using original audio`;
    print(message);
    return { status: "fallback", warning: message };
  };
  if (!binary) return fallback("deep-filter binary missing");
  let temp;
  try {
    const options = repairSettings(settings.profile ? repairOptions(settings) : settings), ranges = reactionRanges(reactions, options.dryRanges, sourceId);
    if (!finite(start) || start < 0 || !Number.isInteger(samples) || samples < 1 || !finite(sourceDuration) || sourceDuration <= start || !finite(out) || out <= start || out > sourceDuration) throw new Error("invalid repair source range");
    const lead = Math.min(HANDLE, Math.floor(start * RATE + 1e-7));
    const end = start + samples / RATE, contextStart = start - lead / RATE;
    const contextEnd = Math.min(sourceDuration, end + 0.5);
    const contextSamples = Math.max(lead + samples, Math.round((contextEnd - contextStart) * RATE));
    if (!Buffer.isBuffer(original) || original.length !== samples * 4) throw new Error("original dialogue sample count mismatch");
    const evidence = { sourceKey, sourceId, sourceHash: repairFileHash(file), originalHash: crypto.createHash("sha256").update(original).digest("hex"), stream, start, out, samples,
      contextStart, contextEnd, contextSamples, tailSamples: HANDLE, mono, settings: options, ranges, binaryHash: repairFileHash(binary), model: "embedded", delayCompensation: "native -D", selectionClock: "compiler PCM" };
    const key = repairCacheKey(evidence), dir = ensureDir(path.join(cacheDir, key));
    const wav = path.join(dir, "repair.wav"), sidecar = path.join(dir, "repair.json"), dry = path.join(dir, "original.wav"), wet = path.join(dir, "enhanced.wav");
    if (fs.existsSync(sidecar)) {
      try {
        const old = readJSON(sidecar);
        if (old.key === key && repairCacheKey(old.evidence) === key && old.wavHash === repairFileHash(wav) && old.originalHash === repairFileHash(dry) && old.enhancedHash === repairFileHash(wet)) return { ...old, file: wav, original: dry, enhanced: wet, sidecar };
      } catch { /* Rebuild an incomplete cache; never reuse partial files. */ }
    }
    temp = fs.mkdtempSync(path.join(dir, "prepare-"));
    const input = path.join(temp, "padded.wav"), paddedRaw = path.join(temp, "padded.f32"), output = ensureDir(path.join(temp, "out"));
    // Match the compiler's decoded stereo representation before selecting a channel, including mono upmix gain.
    const graph = `aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo,${mono},apad,atrim=end_sample=${contextSamples},apad=pad_len=${HANDLE},atrim=end_sample=${contextSamples + HANDLE}`;
    await run("ffmpeg", ["-y", "-v", "error", "-ss", String(contextStart), "-i", file, "-map", `0:${stream}`, "-vn", "-t", String((contextSamples + HANDLE) / RATE), "-af", graph, "-f", "f32le", paddedRaw], { capture: true });
    const padded = fs.readFileSync(paddedRaw);
    if (padded.length !== (contextSamples + HANDLE) * 4) throw new Error("padded repair sample count mismatch");
    // Container seeks can round different packet timestamps. Keep the compiler's selected samples authoritative;
    // context supplies only the handles, never a second interpretation of the dialogue's source clock.
    original.copy(padded, lead * 4);
    fs.writeFileSync(paddedRaw, padded);
    await run("ffmpeg", ["-y", "-v", "error", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", paddedRaw, "-c:a", "pcm_f32le", input], { capture: true });
    const args = ["-D", "--atten-lim-db", String(options.attenLimitDb), "-o", output, input];
    await run(binary, args, { capture: true });
    const made = fs.readdirSync(output).filter((f) => f.endsWith(".wav"));
    if (made.length !== 1) throw new Error("deep-filter must write exactly one WAV");
    const raw = path.join(temp, "enhanced.f32"), dryRaw = path.join(temp, "original.f32"), originalWav = path.join(temp, "original.wav");
    const decode = (input, output) => run("ffmpeg", ["-y", "-v", "error", "-i", input, "-map", "0:a:0", "-ar", "48000", "-ac", "1", "-f", "f32le", output], { capture: true });
    await decode(path.join(output, made[0]), raw);
    fs.writeFileSync(dryRaw, original);
    await run("ffmpeg", ["-y", "-v", "error", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", dryRaw, "-c:a", "pcm_f32le", originalWav], { capture: true });
    const enhanced = fs.readFileSync(raw), x = original;
    if (enhanced.length < (lead + samples) * 4) throw new Error("compensated output lost dialogue tail");
    const aligned = enhanced.subarray(lead * 4, (lead + samples) * 4);
    const y = blendOriginalReactions(x, aligned, { start, ranges, rampMs: options.rampMs });
    const checks = validateRepair(x, aligned, y, { samples, start, ranges, rampMs: options.rampMs });
    fs.writeFileSync(raw, aligned);
    await run("ffmpeg", ["-y", "-v", "error", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", raw, "-c:a", "pcm_f32le", wet], { capture: true });
    fs.writeFileSync(raw, y);
    const pending = path.join(temp, "repair.wav");
    await run("ffmpeg", ["-y", "-v", "error", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", raw, "-c:a", "pcm_f32le", pending], { capture: true });
    // These metrics are separate evidence, never a replacement for original source/candidate labels.
    const measurements = { selectedOriginal: await measure(originalWav, { start: 0, end: samples / RATE }), repaired: await measure(pending, { start: 0, end: samples / RATE }) };
    fs.copyFileSync(originalWav, dry);
    fs.renameSync(pending, wav);
    const result = { version: VERSION, key, status: "repaired", evidence, checks, measurements, graph, command: [binary, ...args.slice(0, 3)],
      wavHash: repairFileHash(wav), originalHash: repairFileHash(dry), enhancedHash: repairFileHash(wet) };
    writeJSON(sidecar, result);
    return { ...result, file: wav, original: dry, enhanced: wet, sidecar };
  } catch (error) { return fallback(error.message); }
  finally { if (temp) fs.rmSync(temp, { recursive: true, force: true }); }
}

/** Re-read the actual pre-gain WAVs for QC; a sidecar's past PASS is not current evidence. */
export async function checkRepairFiles(folder, item, { run = execute, sourceFile, audioStream } = {}) {
  const repair = item.audioRepairResult;
  if (repair?.status !== "repaired") throw new Error(repair?.warning || "requested enhancement was not prepared");
  const resolve = (relative) => {
    if (typeof relative !== "string" || path.isAbsolute(relative)) throw new Error("repair artifact must be client relative");
    const file = path.resolve(folder, relative), root = fs.realpathSync(folder) + path.sep;
    if (!fs.realpathSync(file).startsWith(root)) throw new Error("repair artifact escapes client folder");
    return file;
  };
  const sidecar = resolve(repair.sidecar), record = readJSON(sidecar);
  const relative = (name) => path.relative(folder, path.join(path.dirname(sidecar), name));
  const wav = resolve(repair.file || relative("repair.wav")), original = resolve(repair.original || relative("original.wav")), enhanced = resolve(repair.enhanced || relative("enhanced.wav"));
  if (record.key !== repair.key || repairCacheKey(record.evidence) !== repair.key) throw new Error("repair provenance changed");
  if (record.wavHash !== repairFileHash(wav) || record.originalHash !== repairFileHash(original) || record.enhancedHash !== repairFileHash(enhanced)) throw new Error("repair WAV changed");
  const e = record.evidence, options = repairSettings(repairOptions(item.audioRepair));
  if (e.start !== item.in || e.out !== item.out || e.samples !== item.frames * 1600 || JSON.stringify(canonical(e.settings)) !== JSON.stringify(canonical(options)) || repair.sourceKey && e.sourceKey !== repair.sourceKey || e.sourceId !== item.sourceId) throw new Error("repair provenance: settings or range changed");
  const ranges = reactionRanges(loadRepairReactions(path.join(folder, "work"), e.sourceKey, item.sourceId), options.dryRanges, item.sourceId);
  if (JSON.stringify(ranges) !== JSON.stringify(e.ranges)) throw new Error("reaction ranges changed since repair");
  if (e.delayCompensation !== "native -D") throw new Error("repair alignment contract missing");
  if (sourceFile && e.sourceHash !== repairFileHash(sourceFile)) throw new Error("repair source content changed");
  if (audioStream != null && audioStream !== e.stream) throw new Error("repair source stream changed");
  const temp = fs.mkdtempSync(path.join(path.dirname(wav), "qc-"));
  try {
    const buffers = [];
    for (const [n, file] of [original, enhanced, wav].entries()) {
      const raw = path.join(temp, `${n}.f32`);
      await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-ar", "48000", "-ac", "1", "-f", "f32le", raw], { capture: true });
      buffers.push(fs.readFileSync(raw));
    }
    return validateRepair(...buffers, { samples: e.samples, start: e.start, ranges: e.ranges, rampMs: e.settings.rampMs });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export async function repairQC(folder, item, { final = false, source } = {}) {
  if (!item.audioRepair) return [];
  const checks = [];
  try {
    const evidence = await checkRepairFiles(folder, item, { sourceFile: source?.path ? path.resolve(folder, source.path) : null, audioStream: source?.audioStream });
    checks.push({ code: "audio-repair", level: "pass", message: `${item.id}: ${evidence.samples} finite samples; ${evidence.protectedSamples} original reaction samples; null error ${evidence.maxReactionError}` });
    if (item.audioRepair.auditioned !== true) checks.push({ code: "audio-repair-audition", level: final ? "fail" : "warn", message: `${item.id}: repaired dialogue needs matched-level listening; set audioRepair.auditioned:true only after review` });
  } catch (error) {
    checks.push({ code: "audio-repair", level: final ? "fail" : "warn", message: `${item.id}: ${error.message}` });
  }
  return checks;
}
