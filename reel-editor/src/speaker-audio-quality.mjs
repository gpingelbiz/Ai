import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { run as runCommand, readJSON, writeJSON, log } from "./util.mjs";
import { assetPath, loadManifest } from "./speaker-intake.mjs";
import { loadSourceIndex } from "./speaker-index.mjs";

export const AUDIO_QUALITY_VERSION = 1;
// Score = 2.5 points per dB of floor contrast, so clean/usable/weak start at 30/20/3 dB. Calibrated 2026-11-01 on Julee:
// board feeds (Nova, PowerHouse 2024/2025) 36-59 dB, Audacious 2026 phone 31, testimonials 13-32, Florida phone 4-15.
export const AUDIO_QUALITY_THRESHOLDS = Object.freeze({ clean: 75, usable: 50, weak: 7.5 });
const dnsmosWarnings = new WeakSet();
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const db = (energy, count) => count && energy > 0 ? Math.max(-120, 10 * Math.log10(energy / count)) : -120;
const rounded = (n) => Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
const median = (xs) => { const a = [...xs].sort((a, b) => a - b); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };

/** Absolute source times. Merge overlapping words; only internal gaps >=250 ms count, trimmed 60 ms at each edge. */
export function speechPauseSpans(words = [], { start, end }) {
  const speech = [];
  for (const w of words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && w.start < end && w.end > start).sort((a, b) => a.start - b.start)) {
    const span = { start: Math.max(start, w.start), end: Math.min(end, w.end) }, last = speech.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else speech.push(span);
  }
  const pauses = [];
  for (let i = 1; i < speech.length; i++) if (speech[i].start - speech[i - 1].end >= 0.25 - 1e-9) pauses.push({ start: speech[i - 1].end + 0.06, end: speech[i].start - 0.06 });
  return { speech, pauses };
}

/** 2.5 points per dB of floor contrast (saturating at 100), less monotonic signal-damage penalties.
 * Floor contrast is loud speech (P90) over the quietest moments (P5) of 50 ms windows: a board feed's pauses fall to
 * the noise floor, a phone in a noisy room never does. Missing contrast is unmeasured, never bad.
 * Optional DNSMOS is retained as independent evidence; it does not override the explainable signal score.
 */
export function qualityScore(metrics) {
  if (!Number.isFinite(metrics?.contrastDb)) return { score: null, label: null };
  const penalty = Math.min(40, Math.max(0, metrics.clippedPct || 0) * 8)
    + Math.min(20, Math.max(0, (metrics.channelImbalanceDb || 0) - 6) * 0.6)
    + Math.min(50, Math.max(0, -35 - (metrics.lufs ?? -35)) * 2);
  const score = rounded(clamp(clamp(2.5 * metrics.contrastDb, 0, 100) - penalty, 0, 100));
  const label = Object.entries(AUDIO_QUALITY_THRESHOLDS).find(([, min]) => score >= min)?.[0] || "reject";
  return { score, label };
}

/** Decode only the requested window. ffmpeg supplies untouched float PCM and EBU R128; JS counts samples.
 * Native rate/channels avoid resampling-induced clipping counts or downmix cancellation hiding channel damage.
 * run follows util.run(cmd,args,{capture:true}); temporary PCM is always removed, including failed runs.
 */
export async function measurePassage(file, { start, end, audioStream = null, words = [], run = runCommand } = {}) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error("audio quality: invalid passage range");
  const probe = await run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file], { capture: true });
  const streams = JSON.parse(probe.out).streams.filter((s) => s.codec_type === "audio");
  const stream = audioStream == null ? streams.find((s) => s.disposition?.default === 1) || streams[0] : streams.find((s) => s.index === audioStream);
  if (!stream?.channels || !(Number(stream.sample_rate) > 0)) throw new Error("audio quality: selected audio stream missing");
  const channels = stream.channels, rate = Number(stream.sample_rate);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-quality-")), raw = path.join(dir, "passage.f32");
  try {
    const { err } = await run("ffmpeg", ["-y", "-hide_banner", "-nostats", "-ss", String(start), "-i", file, "-map", `0:${stream.index}`, "-vn", "-t", String(end - start), "-af", "ebur128=peak=true", "-c:a", "pcm_f32le", "-f", "f32le", raw], { capture: true });
    const summary = err.slice(err.lastIndexOf("Summary:"));
    const value = (pattern) => { const m = summary.match(pattern); return m ? rounded(Number(m[1])) : null; };
    const spans = speechPauseSpans(words, { start, end });
    const energy = Array(channels).fill(0), buckets = { speech: [0, 0], pauses: [0, 0] }, positions = { speech: 0, pauses: 0 };
    const windows = [], windowSize = Math.max(1, Math.round(rate * 0.05));
    let count = 0, clipped = 0, windowEnergy = 0, windowCount = 0;
    const fd = fs.openSync(raw, "r"), buffer = Buffer.alloc(channels * 4 * 8192);
    try {
      let n;
      while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) for (let offset = 0; offset + channels * 4 <= n; offset += channels * 4) {
        let power = 0;
        for (let c = 0; c < channels; c++) {
          const sample = buffer.readFloatLE(offset + c * 4);
          energy[c] += sample * sample; power += sample * sample / channels;
          if (Math.abs(sample) >= 10 ** (-0.1 / 20)) clipped++;
        }
        const time = start + count / rate;
        for (const kind of ["speech", "pauses"]) {
          const list = spans[kind];
          while (positions[kind] < list.length && time >= list[positions[kind]].end) positions[kind]++;
          if (list[positions[kind]] && time >= list[positions[kind]].start) { buckets[kind][0] += power; buckets[kind][1]++; }
        }
        count++; windowEnergy += power; windowCount++;
        if (windowCount === windowSize) { windows.push(db(windowEnergy, windowCount)); windowEnergy = 0; windowCount = 0; }
      }
    } finally { fs.closeSync(fd); }
    if (!count) throw new Error("audio quality: no decoded samples");
    if (windowCount) windows.push(db(windowEnergy, windowCount));
    windows.sort((a, b) => a - b);
    const percentile = (p) => windows[Math.floor((windows.length - 1) * p)];
    // Continuous speech or unusable word timings cannot supply actual pause ambience: show the fallback explicitly.
    const method = buckets.speech[1] && buckets.pauses[1] ? "word-spans" : "rms-percentiles-50ms";
    const speechDb = method === "word-spans" ? db(...buckets.speech) : percentile(0.9);
    const pauseDb = method === "word-spans" ? db(...buckets.pauses) : percentile(0.1);
    const channelDb = energy.map((sum) => rounded(db(sum, count)));
    // Word-gap ambience mixes speech tails and breaths into the "pause", so it is reported but does not drive the score.
    const floorDb = percentile(0.05);
    return { lufs: value(/I:\s*([-+\d.]+)\s*LUFS/), truePeak: value(/Peak:\s*([-+\d.]+)\s*dBFS/), speechDb: rounded(speechDb), pauseDb: rounded(pauseDb), gapContrastDb: rounded(speechDb - pauseDb),
      floorDb: rounded(floorDb), contrastDb: rounded(percentile(0.9) - floorDb), channelDb,
      channelImbalanceDb: rounded(Math.max(...channelDb) - Math.min(...channelDb)), clippedPct: rounded(clipped / (count * channels) * 100), dnsmos: null, method,
      speechSeconds: rounded(buckets.speech[1] / rate), pauseSeconds: rounded(buckets.pauses[1] / rate) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Evenly spread word anchors, up to 20 seconds each. A source score is a median of measurements, not whole-file SNR. */
export function sourceQualityWindows(row, { windows = 5 } = {}) {
  if (row.audio !== "ok" || !row.words?.length) return [];
  if (!Number.isInteger(windows) || windows < 1) throw new Error("audio quality: windows must be a positive integer");
  const words = row.words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
  if (!words.length) return [];
  const duration = row.duration ?? words.at(-1).end, length = Math.min(20, duration), ranges = [];
  for (let i = 0; i < windows; i++) {
    const target = words[0].start + (words.at(-1).end - words[0].start) * (i + 0.5) / windows;
    const word = words.reduce((best, w) => Math.abs(w.start - target) < Math.abs(best.start - target) ? w : best, words[0]);
    const start = Math.max(0, Math.min(duration - length, word.start - length / 2)), end = start + length;
    if (end > start && !ranges.some((r) => r.start === start)) ranges.push({ start, end });
  }
  return ranges;
}

async function qualityRecord(file, options = {}) {
  const { scoreDnsmos = null, print = log, measure = measurePassage } = options;
  const metrics = await measure(file, options);
  if (scoreDnsmos) {
    try {
      const result = await scoreDnsmos(file, { start: options.start, end: options.end, audioStream: options.audioStream });
      if (!["sig", "bak", "ovrl"].every((k) => Number.isFinite(result?.[k]) && result[k] >= 1 && result[k] <= 5)) throw new Error("expected sig, bak, ovrl in 1–5");
      metrics.dnsmos = Object.fromEntries(["sig", "bak", "ovrl"].map((k) => [k, result[k]]));
    } catch (e) {
      if (!dnsmosWarnings.has(scoreDnsmos)) { print(`audio quality: DNSMOS unavailable (${e.message.split("\n")[0]})`); dnsmosWarnings.add(scoreDnsmos); }
    }
  }
  return { ...qualityScore(metrics), metrics, version: AUDIO_QUALITY_VERSION };
}

export async function sourceQuality(file, row, { windows = 5, passage = qualityRecord, ...options } = {}) {
  const ranges = sourceQualityWindows(row, { windows });
  if (!ranges.length) return null;
  const records = [];
  for (const range of ranges) records.push(await passage(file, { ...options, ...range, words: row.words, audioStream: row.audioStream }));
  const metrics = { method: "source-window-medians", dnsmos: null, windows: ranges };
  for (const key of ["lufs", "truePeak", "speechDb", "pauseDb", "gapContrastDb", "floorDb", "contrastDb", "channelImbalanceDb", "clippedPct"]) metrics[key] = rounded(median(records.map((r) => r.metrics[key]).filter(Number.isFinite)));
  const mos = records.map((r) => r.metrics.dnsmos).filter(Boolean);
  if (mos.length) metrics.dnsmos = Object.fromEntries(["sig", "bak", "ovrl"].map((k) => [k, rounded(median(mos.map((m) => m[k])))]));
  metrics.channelDb = Array.from({ length: Math.max(...records.map((r) => r.metrics.channelDb?.length || 0)) }, (_, i) => rounded(median(records.map((r) => r.metrics.channelDb?.[i]).filter(Number.isFinite))));
  return { ...qualityScore(metrics), metrics, version: AUDIO_QUALITY_VERSION };
}

/** Own cache; transcript keys/bytes never change. Timing fingerprint also invalidates after word-timing corrections.
 * Adapters should expose .version (model hash + adapter version) so changing optional weights invalidates their scores.
 */
export async function cachedPassageQuality(folder, source, row, { start, end, ...options } = {}) {
  if (source.audio !== "ok") return null;
  const file = path.join(folder, "work", "index", `${row.key}.quality.json`);
  let cache;
  try { cache = readJSON(file); } catch { cache = null; }
  if (cache?.version !== AUDIO_QUALITY_VERSION || !cache.passages || typeof cache.passages !== "object" || Array.isArray(cache.passages)) cache = { sourceId: source.id, version: AUDIO_QUALITY_VERSION, passages: {} };
  const timings = (row.words || []).filter((w) => w.start < end && w.end > start).map((w) => [w.start, w.end]);
  const signature = crypto.createHash("sha256").update(JSON.stringify([timings, row.audioStream, options.scoreDnsmos ? options.scoreDnsmos.version || "injected" : null])).digest("hex");
  const key = `${start}:${end}:v${AUDIO_QUALITY_VERSION}`;
  if (cache.passages[key]?.signature === signature) return cache.passages[key].audioQuality;
  const audioQuality = await qualityRecord(assetPath(folder, source.path), { ...options, start, end, words: row.words, audioStream: row.audioStream });
  cache.passages[key] = { start, end, signature, audioQuality }; writeJSON(file, cache);
  return audioQuality;
}

/** All candidate files may contain copies of an alternate; the passage cache deduplicates their measurement. */
export async function measureSpeakerQuality(folder, { source: sourceId, manifest: suppliedManifest, index: suppliedIndex, print = log, ...options } = {}) {
  const loaded = suppliedManifest ? { manifest: suppliedManifest, problems: [] } : loadManifest(folder);
  if (loaded.problems.some((p) => p.level === "error")) throw new Error(loaded.problems.filter((p) => p.level === "error").map((p) => p.message).join("\n"));
  const manifest = loaded.manifest, index = suppliedIndex || loadSourceIndex(folder, manifest);
  if (sourceId && !manifest.sources.some((s) => s.id === sourceId)) throw new Error(`speaker: unknown sourceId ${sourceId}`);
  const rows = [], sources = new Map(manifest.sources.map((s) => [s.id, s]));
  const selected = (s) => s && s.audio === "ok" && (!sourceId || s.id === sourceId);
  const passage = (source, row, range) => cachedPassageQuality(folder, source, row, { ...options, ...range, print });
  const show = (name, source, record) => {
    if (!record) return;
    rows.push({ name, event: source.event || "", ...record });
    print(`${name}\t${source.event || "—"}\t${record.label || "unmeasured"}\t${record.score ?? "—"}\t${record.metrics.contrastDb ?? "—"}\t${record.metrics.lufs ?? "—"}`);
  };
  print("source/candidate\tevent\tlabel\tscore\tcontrastDb\tLUFS");
  for (const source of manifest.sources.filter(selected)) {
    const row = index.sources[source.id];
    try {
      const record = await sourceQuality(assetPath(folder, source.path), row, { ...options, passage: (_file, range) => passage(source, row, range), print });
      if (record) { row.audioQuality = record; show(source.id, source, record); }
    } catch (e) { print(`${source.id}: audio quality unavailable (${e.message.split("\n")[0]})`); }
  }
  writeJSON(path.join(folder, "work", "index", "sources.json"), index);
  const dir = path.join(folder, "work", "candidates"), shown = new Set();
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []) {
    const file = path.join(dir, name);
    let data;
    try { data = readJSON(file); }
    catch (e) { print(`${name}: audio quality unavailable (${e.message.split("\n")[0]})`); continue; }
    if (!Array.isArray(data)) continue;
    let changed = false;
    const visit = async (candidate) => {
      const source = sources.get(candidate.sourceId), row = index.sources[candidate.sourceId];
      if (selected(source) && row) {
        try {
          const record = await passage(source, row, { start: candidate.in, end: candidate.out });
          if (record) {
            candidate.audioQuality = record; changed = true;
            const key = `${source.id}:${candidate.in}:${candidate.out}`;
            if (!shown.has(key)) { show(candidate.id, source, record); shown.add(key); }
          }
        } catch (e) { print(`${candidate.id}: audio quality unavailable (${e.message.split("\n")[0]})`); }
      }
      for (const alt of candidate.alternates || []) await visit(alt);
    };
    for (const candidate of data) await visit(candidate);
    if (changed) writeJSON(file, data);
  }
  return { index, rows };
}

/** Measure exact reviewed ranges, including manual edits. Optional failures leave the item visibly unmeasured. */
export async function measurePlanAudio(folder, plan, manifest, { index: suppliedIndex, print = log, ...options } = {}) {
  let index;
  try { index = suppliedIndex || readJSON(path.join(folder, "work", "index", "sources.json")); }
  catch { print("speaker review: audio quality unavailable (source index missing)"); return plan; }
  for (const item of plan.items || []) {
    if (item.kind !== "clip" || item.audio === "mute") continue;
    const source = manifest.sources.find((s) => s.id === item.sourceId), row = index.sources[item.sourceId];
    if (source?.audio !== "ok" || !row) continue;
    try { item.audioQuality = await cachedPassageQuality(folder, source, row, { ...options, start: item.in, end: item.out, print }); }
    catch (e) { delete item.audioQuality; print(`${item.id}: audio quality unavailable (${e.message.split("\n")[0]})`); }
  }
  return plan;
}

/** WARN only: a quality measurement never approves an edit or permits prohibited source audio. */
export function audioQualityWarnings(plan, candidates = [], manifest = { sources: [] }) {
  const groups = (Array.isArray(candidates) ? candidates : []).filter(Boolean).map((c) => [c, ...(c.alternates || [])]);
  return (plan.items || []).filter((i) => i.kind === "clip" && i.audio !== "mute" && ["core", "room", "testimonial"].includes(i.role) && i.audioQuality?.label === "weak").map((item) => {
    const group = groups.find((g) => g.some((c) => c.sourceId === item.sourceId && c.in <= item.in + 0.1 && c.out >= item.out - 0.1));
    const cleaner = group?.filter((c) => !(c.sourceId === item.sourceId && c.in < item.out && c.out > item.in) && ["clean", "usable"].includes(c.audioQuality?.label) && manifest.sources.some((s) => s.id === c.sourceId && s.audio === "ok")).sort((a, b) => audioQualityRank(b.audioQuality) - audioQualityRank(a.audioQuality) || (b.score || 0) - (a.score || 0) || String(a.id).localeCompare(String(b.id)))[0];
    return { code: "audio-quality", level: "warn", itemId: item.id, message: `${item.id}: weak ${item.role} audio (${item.sourceId}, contrast ${item.audioQuality.metrics?.contrastDb ?? "unmeasured"} dB)${cleaner ? `; cleaner alternate ${cleaner.id}: ${cleaner.sourceId} ${cleaner.in}–${cleaner.out}s (${cleaner.audioQuality.label}); audition in context` : "; audition the original and check for a cleaner performance"}` };
  });
}

/** Missing quality is neutral between usable and weak; it never means reject. */
export function audioQualityRank(record) { return ({ clean: 3, usable: 2, weak: 0, reject: -1 })[record?.label] ?? 1; }
