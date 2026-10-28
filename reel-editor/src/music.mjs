import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { log, warn, r3 } from "./util.mjs";

/**
 * The music bed. Tracks live in one folder as "<Mood> - <Title> - <Artist>.mp3"; a name starting with
 * "Signature " is a brand sound that comes back often (weight 3). Files in subfolders (Bench/) are parked.
 * The pick is by mood: Claude reads the transcript and names 2-3 moods from the ones on disk (or "none" for a raw
 * piece), and a track is drawn at random inside them. "#music:<name>" forces a track; no Claude, no match, or no
 * folder falls back to a plain random draw. The bed starts half a second after the first frame, sits 20 dB under
 * the voice and swells a little in the pauses.
 */
export const AUDIO_EXTS = new Set([".mp3", ".m4a", ".wav", ".aac", ".aif", ".aiff", ".flac"]);

export function listTracks(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => AUDIO_EXTS.has(path.extname(f).toLowerCase()) && !f.startsWith("."))
    .map((f) => {
      const stem = f.replace(/\.[^.]+$/, "");
      const signature = /^signature\s+/i.test(stem);
      const body = stem.replace(/^signature\s+/i, "");
      const mood = body.includes(" - ") ? body.split(" - ")[0].trim() : "";
      return { file: path.join(dir, f), name: f, mood, signature };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const moodsOf = (tracks) => [...new Set(tracks.map((t) => t.mood).filter(Boolean))].sort();

/** Deterministic random in [0,1) from a string, so the same clip picks the same track on a re-run. */
export function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

/**
 * Pick one track. `want` (from #music:name) matches the file name; else `moods` narrows to those moods; signature
 * tracks weigh 3. Returns null when there are no tracks.
 */
export function pickTrack(tracks, { want = "", moods = [], seed = "" } = {}) {
  if (!tracks.length) return null;
  const lc = (s) => String(s).toLowerCase();
  if (want) {
    const hit = tracks.find((t) => lc(t.name).includes(lc(want)));
    if (hit) return hit;
  }
  let pool = moods.length ? tracks.filter((t) => moods.some((m) => lc(t.mood) === lc(m) || lc(t.mood).includes(lc(m)))) : [];
  if (!pool.length) pool = tracks;
  const weights = pool.map((t) => (t.signature ? 3 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = (seed ? seeded(seed)() : Math.random()) * total;
  for (let i = 0; i < pool.length; i++) { x -= weights[i]; if (x < 0) return pool[i]; }
  return pool[pool.length - 1];
}

export function moodPrompt({ transcript, hook, moods, voice = "" }) {
  return [
    "You choose the background music mood for one short talking-head reel. Reply with JSON only; use no tools.",
    `Available moods (use these names exactly): ${moods.join(", ")}.`,
    "Pick 2 or 3 moods that fit the feel of what is said: tense or dark for accountability and hard truths, warm or soulful for faith and family, building or epic for conviction and the close, lo-fi or piano for calm teaching, rock or funk for energy and humor.",
    "Set none to true only for a raw, direct confrontation where any music would soften it.",
    voice ? `\nVoice of the speaker:\n${voice.trim()}` : "",
    "",
    `Hook: ${hook || "(none)"}`,
    "",
    "Transcript:",
    transcript,
    "",
    'Reply: {"moods":["...","..."],"none":false,"why":"one short sentence"}',
  ].join("\n");
}

/** Ask Claude for the moods; falls back to [] (random pick) when it cannot run. */
export async function chooseMoods({ transcript, hook, moods, voice }) {
  if (!moods.length || !transcript) return { moods: [], none: false };
  if (!hasClaude()) return { moods: [], none: false };
  try {
    const reply = await claudeText(moodPrompt({ transcript, hook, moods, voice }), { timeoutMs: 90000 });
    const j = firstJSON(reply);
    const lc = moods.map((m) => m.toLowerCase());
    const picked = (Array.isArray(j.moods) ? j.moods : []).map(String).filter((m) => lc.includes(m.toLowerCase())).slice(0, 3);
    return { moods: picked, none: !!j.none, why: j.why };
  } catch (e) {
    warn(`music: mood pick failed (${String(e.message).split("\n")[0]}); picking at random`);
    return { moods: [], none: false };
  }
}

/**
 * Volume lane for the bed: `level` under speech, swelling to `level * swell` in pauses of `minGap` seconds or
 * more, with short ramps. Returns [{t, v}] in reel time, starting at `start` with a fade in and ending with a fade out.
 */
export function duckingLane(words, { duration, level = 0.1, swell = 2.2, minGap = 0.9, ramp = 0.35, start = 0.5, fadeIn = 1, fadeOut = 1.5 } = {}) {
  const hi = Math.min(1, level * swell);
  const pts = [{ t: r3(start), v: 0 }, { t: r3(Math.min(duration, start + fadeIn)), v: level }];
  const spoken = words.filter((w) => w.end > start).sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < spoken.length; i++) {
    const g0 = spoken[i].end, g1 = spoken[i + 1].start;
    if (g1 - g0 < minGap) continue;
    const up = Math.min(ramp, (g1 - g0) / 3);
    pts.push({ t: r3(g0 + 0.1), v: level }, { t: r3(g0 + 0.1 + up), v: hi }, { t: r3(g1 - 0.15 - up), v: hi }, { t: r3(g1 - 0.15), v: level });
  }
  pts.push({ t: r3(Math.max(start, duration - fadeOut)), v: level }, { t: r3(duration), v: 0 });
  // Monotonic, de-duplicated times.
  const out = [];
  for (const p of pts) {
    if (p.t < start || p.t > duration) continue;
    const last = out[out.length - 1];
    if (last && p.t <= last.t) { if (p.t === last.t) last.v = p.v; continue; }
    out.push(p);
  }
  return out;
}

/**
 * Duck from the real voice level as well as the transcript. The detector follows FFmpeg's sidechain-compressor
 * shape (separate attack and release smoothing; idea from af_sidechaincompress.c, LGPL-2.1+), while the sparse
 * output stays compatible with the existing HyperFrames volume lane.
 */
export function duckingLaneFromEnvelope(env, { duration, words = [], level = 0.1, swell = 2.2, minGap = 0.9, ramp = 0.35, start = 0.5, fadeIn = 1, fadeOut = 1.5, attack = 0.025, release = 0.25, floorOffsetDb = 12 } = {}) {
  const step = Number(env?.step);
  const db = env?.db;
  if (!(duration > 0) || !(step > 0) || !Array.isArray(db) || !db.length) return duckingLane(words, { duration, level, swell, minGap, ramp, start, fadeIn, fadeOut });
  const levels = db.filter(Number.isFinite).sort((a, b) => a - b);
  if (!levels.length) return duckingLane(words, { duration, level, swell, minGap, ramp, start, fadeIn, fadeOut });
  const floor = levels[Math.floor((levels.length - 1) * 0.1)];
  const threshold = Math.max(-45, floor + floorOffsetDb);
  const spoken = words
    .filter((w) => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);

  // Collapse the 20 ms decisions into speech regions first; only real gaps become automation points.
  const regions = [];
  let word = 0, open = null;
  const blocks = Math.ceil(duration / step);
  for (let i = 0; i < blocks; i++) {
    const a = i * step, b = Math.min(duration, a + step);
    while (word < spoken.length && spoken[word].end <= a) word++;
    const inWord = word < spoken.length && spoken[word].start < b && spoken[word].end > a;
    const speech = (i < db.length && Number.isFinite(db[i]) && db[i] > threshold) || inWord;
    if (speech && open == null) open = a;
    if (!speech && open != null) { regions.push({ start: open, end: a }); open = null; }
  }
  if (open != null) regions.push({ start: open, end: duration });
  if (!regions.length) return duckingLane(words, { duration, level, swell, minGap, ramp, start, fadeIn, fadeOut });

  const hi = Math.min(1, level * swell);
  const pts = [{ t: r3(start), v: 0 }, { t: r3(Math.min(duration, start + fadeIn)), v: level }];
  for (let i = 0; i + 1 < regions.length; i++) {
    const g0 = regions[i].end + release, g1 = regions[i + 1].start;
    if (g1 - g0 < minGap) continue;
    const up = Math.min(ramp, (g1 - g0) / 3);
    pts.push(
      { t: r3(g0), v: level },
      { t: r3(g0 + up), v: hi },
      { t: r3(g1), v: hi },
      { t: r3(g1 + attack), v: level },
    );
  }
  pts.push({ t: r3(Math.max(start, duration - fadeOut)), v: level }, { t: r3(duration), v: 0 });
  const out = [];
  for (const p of pts) {
    if (p.t < start || p.t > duration) continue;
    const last = out[out.length - 1];
    if (last && p.t <= last.t) { if (p.t === last.t) last.v = p.v; continue; }
    out.push(p);
  }
  return out;
}

export function describePick(track, choice) {
  const why = choice?.moods?.length ? ` (${choice.moods.join(" / ")}${choice.why ? ": " + choice.why : ""})` : " (random)";
  return `${track.name}${why}`;
}
