import fs from "node:fs";
import path from "node:path";
import { sourceCacheKey, probeSource } from "./speaker-index.mjs";
import { transcribe, normalizeWords } from "./transcribe.mjs";
import { resolveEngine } from "./review.mjs";
import { featureprintBinary } from "./speaker-inserts.mjs";
import { readFilmingTime } from "./stitch-order.mjs";
import { run, readJSON, writeJSON, ensureDir } from "./util.mjs";

export async function measureStitchLoudness(file, { start = null, duration = null, execute = run } = {}) {
  const { err } = await execute("ffmpeg", ["-hide_banner", "-nostats", ...(start == null ? [] : ["-ss", String(start)]), "-i", file, ...(duration == null ? [] : ["-t", String(duration)]), "-vn", "-af", "loudnorm=I=-16:TP=-2:LRA=11:print_format=json", "-f", "null", "-"], { capture: true });
  const match = String(err).match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!match) throw new Error("The clip's sound level could not be measured.");
  return JSON.parse(match[0]);
}

/** Vision scene prints of three frames. On real footage the same place measured 4 to 11 apart (a handheld phone,
 * a truck cab, a job site minutes apart) and different places 24 to 31, where edge pixel hashes split one truck cab
 * into two places. Three samples vote, so a passing hand or a single turn does not move a clip into another place. */
export async function backgroundFingerprint(file, meta, dir, { execute = run, binary = featureprintBinary } = {}) {
  const bin = await binary();
  if (!bin) throw new Error("The background checker is unavailable.");
  const times = [0.25, 0.5, 0.75].map((f) => (Math.max(0, Math.min(meta.duration - 1 / 30, meta.duration * f))).toFixed(3));
  const { out } = await execute(bin, [file, ...times], { capture: true });
  const frames = (JSON.parse(out).frames || []).filter((f) => Array.isArray(f.signature) && f.signature.length).map((f) => ({ signature: f.signature }));
  if (!frames.length) throw new Error("The background checker returned no frames.");
  return frames;
}

const INDEX_VERSION = 2;

/** All costly source analysis shares speaker-index's content identity and ignores filenames. */
export async function indexStitch(files, dir, settings, { probe = probeSource, transcribe: hear = transcribe, loudness = measureStitchLoudness, fingerprint = backgroundFingerprint, creationTime = readFilmingTime } = {}) {
  const cacheSettings = { ...settings, engine: resolveEngine(settings.engine) };
  const clips = [];
  for (const file of files) {
    try {
      const key = sourceCacheKey(file, cacheSettings), cache = ensureDir(path.join(dir, "cache", key)), facts = path.join(cache, "index.json");
      let row = null;
      // Facts saved by an older index (edge-pixel place prints) are measured again.
      if (fs.existsSync(facts)) row = readJSON(facts);
      if (row?.schemaVersion !== INDEX_VERSION) {
        const meta = await probe(file);
        if (!meta.hasVideo || !(meta.duration > 0) || !(meta.width > 0) || !(meta.height > 0)) throw new Error("The video could not be read.");
        const words = meta.hasAudio ? normalizeWords(await hear(file, { ...settings, out: path.join(cache, "words.json") })) : [];
        const level = meta.hasAudio ? await loudness(file) : null;
        row = { schemaVersion: INDEX_VERSION, ...meta, key, words, loudness: level, fingerprint: await fingerprint(file, meta, cache), creationTime: await creationTime(file, fs.statSync(file).birthtimeMs), lowResolution: Math.min(meta.width, meta.height) < 720 };
        writeJSON(facts, row);
      }
      clips.push({ ...row, file, name: path.basename(file) });
    } catch (error) { error.clip = file; throw error; }
  }
  writeJSON(path.join(dir, "index.json"), { schemaVersion: 1, settings, clips });
  return clips;
}
