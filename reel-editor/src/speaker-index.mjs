import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { probe } from "./probe.mjs";
import { transcribe, normalizeWords, applyCorrections } from "./transcribe.mjs";
import { brandDictionary } from "./brandkit.mjs";
import { resolveEngine } from "./review.mjs";
import { sentenceLines } from "./moments.mjs";
import { audioEnvelope } from "./cuts.mjs";
import { assetPath } from "./speaker-intake.mjs";
import { readJSON, writeJSON, run, ensureDir, log, warn } from "./util.mjs";

/** Content identity ignores paths and mtimes. Sample bytes twice even when the two windows overlap. */
export function sourceCacheKey(file, { engine = "auto", language = "en", model = "large-v3-turbo", audioStream = null, prompt = "" } = {}) {
  const fd = fs.openSync(file, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const n = Math.min(size, 8 * 1024 * 1024);
    const first = Buffer.alloc(n), last = Buffer.alloc(n);
    fs.readSync(fd, first, 0, n, 0);
    fs.readSync(fd, last, 0, n, size - n);
    return crypto.createHash("sha256").update(String(size)).update(first).update(last)
      .update(JSON.stringify({ engine, language, model, audioStream, prompt })).digest("hex");
  } finally { fs.closeSync(fd); }
}

/** Keep existing rotation/HDR probing and add stream timing and audio facts without changing probe(). */
export async function probeSource(file) {
  const { out } = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { capture: true });
  const raw = JSON.parse(out);
  const video = raw.streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const audioStreams = raw.streams.filter((s) => s.codec_type === "audio").map((s) => ({
    index: s.index, codec: s.codec_name, channels: s.channels, channelLayout: s.channel_layout || "unknown",
    sampleRate: Number(s.sample_rate), startTime: Number(s.start_time || 0), duration: Number(s.duration || raw.format?.duration || 0),
    language: s.tags?.language || "", default: s.disposition?.default === 1,
  }));
  const meta = video ? await probe(file) : { duration: Number(raw.format?.duration || 0), width: 0, height: 0, fps: 0, rotation: 0, rotationCw: 0, hdr: false, hdrKind: null };
  const ratio = (s) => { const [n, d = 1] = String(s || "0/1").split("/").map(Number); return d ? n / d : 0; };
  return {
    ...meta, hasVideo: !!video, hasAudio: audioStreams.length > 0, size: fs.statSync(file).size,
    avgFps: ratio(video?.avg_frame_rate), timeBase: video?.time_base || null,
    colorSpace: video?.color_space || "", colorRange: video?.color_range || "",
    sampleAspectRatio: video?.sample_aspect_ratio || "1:1", startTime: Number(video?.start_time || raw.format?.start_time || 0),
    videoDuration: Number(video?.duration || meta.duration), videoStream: video?.index ?? null, audioStreams,
  };
}

/** Injectable ASR and envelope functions keep indexing tests local and revisions free of API calls. */
export async function indexSources(folder, manifest, { brand = {}, engine = "auto", language = "en", model = "large-v3-turbo", transcribe: transcribeImpl = transcribe, probe: probeImpl = probeSource, audioEnvelope: envelopeImpl = audioEnvelope, print = log } = {}) {
  const dir = ensureDir(path.join(folder, "work", "index"));
  const dictionary = brandDictionary({ ...brand, name: brand.name || brand.identity?.name });
  const prompt = [...dictionary.names, ...dictionary.terms, ...dictionary.phrases].join(", ");
  const settings = { engine: resolveEngine(engine), language, model, prompt };
  // Audio analysis has its own cache and survives a normal index refresh with the same content key.
  const previousIndexFile = path.join(dir, "sources.json");
  const previousSources = fs.existsSync(previousIndexFile) ? readJSON(previousIndexFile).sources || {} : {};
  const sources = {};
  for (const source of manifest.sources) {
    const file = assetPath(folder, source.path);
    const key = sourceCacheKey(file, { ...settings, audioStream: source.audioStream ?? null });
    const factsFile = path.join(dir, `${key}.json`), wordsFile = path.join(dir, `${key}.words.json`);
    // Probe every run: a renamed source may now be addressed by a different id, but its content cache is shared.
    let meta;
    try { meta = await probeImpl(file); }
    catch (e) { throw new Error(`${source.id}: source probe failed: ${e.message}`); }
    const audio = source.audioStream == null ? meta.audioStreams?.find((s) => s.default) || meta.audioStreams?.[0] : meta.audioStreams?.find((s) => s.index === source.audioStream);
    if (source.audio === "ok" && !audio) throw new Error(`${source.id}: audio is ok but the chosen audio stream is missing; set audio to none or bad for picture only`);
    const cached = source.audio === "ok" && fs.existsSync(wordsFile);
    let rawWords = [], envelope = { step: 0.02, db: [] };
    if (source.audio === "ok") {
      let input = file, selected = null;
      try {
        // ASR and the envelope must hear the same explicitly selected stream as the compiler.
        if (!cached && audio.index !== meta.audioStreams[0].index) {
          selected = path.join(dir, `${key}.audio.wav`);
          await run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-map", `0:${audio.index}`, "-vn", "-c:a", "pcm_s16le", selected], { capture: true });
          input = selected;
        }
        if (cached) rawWords = normalizeWords(readJSON(wordsFile));
        else {
          rawWords = normalizeWords(await transcribeImpl(input, { ...settings, out: wordsFile }));
          writeJSON(wordsFile, { ...settings, words: rawWords });
        }
        const old = fs.existsSync(factsFile) ? readJSON(factsFile) : null;
        if (old?.envelope?.db) envelope = old.envelope;
        else {
          if (audio.index !== meta.audioStreams[0].index && !selected) {
            selected = path.join(dir, `${key}.audio.wav`);
            await run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-map", `0:${audio.index}`, "-vn", "-c:a", "pcm_s16le", selected], { capture: true });
            input = selected;
          }
          try { envelope = await envelopeImpl(input); }
          catch (e) { warn(`${source.id}: audio envelope unavailable (${e.message.split("\n")[0]})`); }
        }
      } finally { if (selected) fs.rmSync(selected, { force: true }); }
    }
    // Cache raw ASR; changing spelling corrections reuses it and rebuilds the corrected view.
    const words = applyCorrections(rawWords, dictionary.corrections);
    const row = { ...meta, id: source.id, path: source.path, key, audio: source.audio, audioStream: audio?.index ?? null, words, lines: sentenceLines(words), envelope, cached };
    if (previousSources[source.id]?.key === key && source.audio === "ok" && previousSources[source.id]?.audioQuality) row.audioQuality = previousSources[source.id].audioQuality;
    const existing = source.audio !== "ok" && fs.existsSync(factsFile) ? readJSON(factsFile) : null;
    writeJSON(factsFile, { ...row, ...(existing ? { words: existing.words || [], lines: existing.lines || [], envelope: existing.envelope || envelope } : {}), path: undefined, id: undefined, cached: undefined });
    sources[source.id] = row;
    print(`${source.id}: ${meta.duration.toFixed(2)}s, ${words.length} words, ${source.audio === "ok" ? cached ? "cached" : "new" : `picture only (${source.audio})`}`);
  }
  const index = { schemaVersion: 1, clientId: manifest.clientId, settings, sources };
  writeJSON(path.join(dir, "sources.json"), index);
  return index;
}

/** Render-only refuses stale media, and never transcribes. */
export function loadSourceIndex(folder, manifest, { brand = null } = {}) {
  const file = path.join(folder, "work", "index", "sources.json");
  if (!fs.existsSync(file)) throw new Error("speaker index is missing; run reel speaker index first");
  const index = readJSON(file);
  if (index.clientId !== manifest.clientId) throw new Error("speaker index belongs to a different client");
  for (const source of manifest.sources) {
    const row = index.sources[source.id];
    if (!row || row.key !== sourceCacheKey(assetPath(folder, source.path), { ...index.settings, audioStream: source.audioStream ?? null })) throw new Error(`${source.id}: speaker index is stale; run reel speaker index first`);
    if (row.audio !== source.audio) throw new Error(`${source.id}: indexed audio intent changed; run reel speaker index first`);
    if (source.audio === "ok" && row.audioStream == null) throw new Error(`${source.id}: indexed audio stream is missing`);
    if (source.audio === "ok" && brand) {
      const raw = readJSON(path.join(folder, "work", "index", `${row.key}.words.json`));
      row.words = applyCorrections(normalizeWords(raw), brandDictionary(brand).corrections);
      row.lines = sentenceLines(row.words);
    }
  }
  return index;
}
