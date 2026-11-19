import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seeded } from "./music.mjs";
import { run, r3 } from "./util.mjs";

export const musicHistoryPath = (env = process.env) => env.REEL_MUSIC_HISTORY || path.join(os.homedir(), "Reels", ".music-history.json");

export function readMusicHistory(file = musicHistoryPath()) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data) || data.some((entry) => !entry || typeof entry.reel !== "string" || (entry.track !== null && typeof entry.track !== "string"))) throw new Error(`invalid pro music history: ${file}`);
  return data;
}

/** Rotation is a hard constraint, even for an explicitly requested or Signature track. */
export function pickProTrack(tracks, { history = [], reel = "", moods = [], want = "", seed = "" } = {}) {
  const saved = history.find((h) => h.reel === reel);
  const existing = saved && tracks.find((t) => t.name === saved.track && (!want || t.name.toLowerCase().includes(want.toLowerCase())) && (!moods.length || moods.some((m) => String(t.mood).toLowerCase().includes(m.toLowerCase()))));
  if (existing) return existing;
  const previous = history.filter((h) => h.reel !== reel);
  const recent = previous.slice(-3).map((h) => h.track);
  const week = previous.slice(-6).map((h) => h.track);
  const eligible = tracks.filter((t) => !recent.includes(t.name) && week.filter((name) => name === t.name).length < 2);
  const lc = (s) => String(s || "").toLowerCase();
  const moodPool = moods.length ? eligible.filter((t) => moods.some((m) => lc(t.mood).includes(lc(m)))) : eligible;
  // A missing matching mood is preferable to reusing an inappropriate score.
  const pool = want ? moodPool.filter((t) => lc(t.name).includes(lc(want))) : moodPool;
  if (!pool.length) return null;
  const random = seeded(seed || reel || "pro")();
  return pool[Math.floor(random * pool.length)];
}

/** Offline mood choice keeps local renders tied to the lesson when the optional model is unavailable. */
export function proMoodChoice(transcript, available) {
  const text = String(transcript).toLowerCase();
  if (/\b(tonality|tone of voice|listen to how|hear the difference|sound like this)\b/.test(text)) return { moods: [], none: true, why: "vocal demonstration" };
  const preferred = /\b(don't|never|stop|mistake|wrong|lose|warning)\b/.test(text) ? /dark|tense|dry|beat/i
    : /\b(can do|better|proud|believe|keep going|improve|encourage)\b/.test(text) ? /warm|motivation|piano|soul/i
      : /\b(first|second|step|practice|repeat|process|write|record)\b/.test(text) ? /boom|bap|percussion|beat|lofi|lo-fi/i
        : /lofi|lo-fi|calm|piano|sparse|warm/i;
  const moods = available.filter((mood) => preferred.test(mood));
  return { moods, none: !moods.length, why: moods.length ? "lesson mood (local fallback)" : "no matching lesson mood in the library" };
}

/** Count completed reels only. Rebuilding the same reel updates its entry without consuming another use. */
export function recordProMusic({ reel, track, at = new Date().toISOString() }, file = musicHistoryPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Two renders may finish together; reject a stale pick instead of losing a writer or repeating a track.
  const lock = `${file}.lock`;
  const fd = fs.openSync(lock, "wx");
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const history = readMusicHistory(file);
    const index = history.findIndex((h) => h.reel === reel);
    if (index >= 0 && history[index].track === track) return;
    if (index >= 0) history[index] = { reel, track, at };
    else history.push({ reel, track, at });
    for (let i = 0; i < history.length; i++) {
      const name = history[i].track;
      if (name === null) continue;
      if (history.slice(Math.max(0, i - 3), i).some((h) => h.track === name) || history.slice(Math.max(0, i - 6), i + 1).filter((h) => h.track === name).length > 2) throw new Error("pro music history changed during rendering; regenerate this reel's music before delivery");
    }
    fs.writeFileSync(tmp, JSON.stringify(history, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

/** Transcript words plus audible breaths; a short gap never opens the music fader. */
export function proSpeechRegions(words, { duration, envelope = null } = {}) {
  const all = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start).map((w) => ({ start: Math.max(0, w.start), end: Math.min(duration, w.end) }));
  const db = envelope?.db, step = envelope?.step;
  if (Array.isArray(db) && step > 0) {
    const sorted = db.filter(Number.isFinite).sort((a, b) => a - b);
    const threshold = Math.max(-45, (sorted[Math.floor((sorted.length - 1) * 0.1)] ?? -60) + 12);
    db.forEach((level, i) => { if (level > threshold && i * step < duration) all.push({ start: i * step, end: Math.min(duration, (i + 1) * step) }); });
  }
  const regions = [];
  for (const region of all.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start)) {
    const last = regions.at(-1);
    if (last && region.start - last.end <= 0.650001) last.end = Math.max(last.end, region.end);
    else regions.push({ ...region });
  }
  return regions;
}

const smooth = (u) => { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x); };

/** Relative duck amount in dB; overlapping release/attack windows hold down rather than breathe upwards. */
export function proDuckDbAt(time, regions) {
  let gain = 0;
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    let end = region.end;
    while (i + 1 < regions.length && regions[i + 1].start - 0.12 <= end + 0.7) end = regions[++i].end;
    if (time < region.start - 0.12 || time > end + 0.7) continue;
    const db = time < region.start - 0.02 ? -6 * smooth((time - region.start + 0.12) / 0.1)
      : time <= end + 0.25 ? -6 : -6 * (1 - smooth((time - end - 0.25) / 0.45));
    gain = Math.min(gain, db);
  }
  return gain;
}

/** Music is normalized to -20 LUFS, then sits 12 LU under voice, with another 6 dB under speech. */
export function proMusicGain(voiceLufs = -16) {
  return 10 ** (((Number.isFinite(voiceLufs) ? voiceLufs : -16) + 8) / 20);
}

export function proDuckingLane(words, { duration, level = proMusicGain(), envelope = null, fadeOut = 0.24 } = {}) {
  if (!(duration > 0)) return [];
  const regions = proSpeechRegions(words, { duration, envelope });
  const times = new Set([0, r3(duration)]);
  const ramp = (a, b) => {
    const count = Math.max(1, Math.ceil((b - a) / 0.02));
    for (let i = 0; i <= count; i++) times.add(r3(Math.max(0, Math.min(duration, a + (b - a) * i / count))));
  };
  for (const region of regions) { ramp(region.start - 0.12, region.start - 0.02); ramp(region.end + 0.25, region.end + 0.7); }
  ramp(0, Math.min(0.03, duration / 2));
  const out = Math.min(0.3, Math.max(0.18, fadeOut), duration / 2);
  ramp(duration - out, duration);
  return [...times].sort((a, b) => a - b).map((t) => ({ t, v: level * 10 ** (proDuckDbAt(t, regions) / 20) * smooth(t / Math.min(0.03, duration / 2)) * smooth((duration - t) / out) }));
}

/** All effect sources share one budget, including generated and b-roll sound. Peaks are measured pre-gain. */
export function limitProSfx(tracks, duration, peaks = {}) {
  const budget = Math.min(5, Math.max(1, Math.round(3 * duration / 30)));
  const effects = [];
  const other = tracks.filter((t) => !t.id.startsWith("sfx-"));
  for (const track of tracks.filter((t) => t.id.startsWith("sfx-")).sort((a, b) => a.start - b.start)) {
    if (effects.length >= budget || track.start < 0 || track.start >= duration - 0.2 || (effects.length && track.start - effects.at(-1).start < 1.5)) continue;
    if (effects.filter((t) => t.start > track.start - 30).length >= 4) continue;
    const target = /whoosh|move|zoom/.test(track.id) ? -23 : /tick|marker/.test(track.id) ? -27 : -25;
    const peak = peaks[track.src];
    // Unmeasured files stay silent: a guessed fader cannot enforce an absolute peak ceiling.
    if (!Number.isFinite(peak)) continue;
    effects.push({ ...track, volume: 10 ** ((target - peak) / 20), ...(track.lane ? { lane: null } : {}), peakTargetDb: target });
  }
  return [...other, ...effects];
}

export async function measureProLoudness(file, { runImpl = run } = {}) {
  const { err } = await runImpl("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "loudnorm=I=-16:TP=-2:LRA=11:print_format=json", "-f", "null", "-"], { capture: true });
  const match = String(err).match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!match) throw new Error("pro audio: loudness measurement unavailable");
  return JSON.parse(match[0]);
}

export function proLoudnessFilter(measured, { limitDb = -2 } = {}) {
  for (const key of ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]) if (!Number.isFinite(Number(measured[key]))) throw new Error(`pro audio: invalid ${key}`);
  return `loudnorm=I=-16:TP=-2:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,alimiter=limit=${(10 ** (limitDb / 20)).toFixed(6)}:attack=1:release=50:level=disabled`;
}

/** Verify the encoded AAC, and retry from the original mix. Never report success for an unmeasured master. */
export async function normalizeProDelivery(file, { runImpl = run, measure = measureProLoudness } = {}) {
  const tmp = file.replace(/\.mp4$/, ".pro-loud.mp4");
  try {
    const measured = await measure(file, { runImpl });
    let limitDb = -2;
    for (let attempt = 0; attempt < 3; attempt++) {
      await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", proLoudnessFilter(measured, { limitDb }), "-ar", "48000", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", tmp]);
      const result = await measure(tmp, { runImpl });
      const integrated = Number(result.input_i), peak = Number(result.input_tp);
      if (Number.isFinite(integrated) && Math.abs(integrated + 16) <= 1 && Number.isFinite(peak) && peak <= -1.5) { fs.renameSync(tmp, file); return result; }
      if (Number.isFinite(peak) && peak > -1.5) limitDb -= peak + 1.8;
      else throw new Error(`pro audio: encoded mix outside target (${integrated} LUFS, ${peak} dBTP)`);
    }
    throw new Error("pro audio: encoded true peak still exceeds -1.5 dBTP after three passes");
  } finally { fs.rmSync(tmp, { force: true }); }
}
