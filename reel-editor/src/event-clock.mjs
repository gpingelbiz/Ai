import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/** Measure our vendored 16-bit PCM WAVs, including stereo and padded metadata chunks.
 * Attack is the first sample at 10% of the file's absolute peak. Peak is the first absolute maximum.
 * Sample indexes count frames (all channels at one instant), never interleaved channel samples.
 */
export function measureSfx(wav) {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Expected a RIFF WAV");
  let format, data;
  for (let at = 12; at + 8 <= wav.length;) {
    const id = wav.toString("ascii", at, at + 4), from = at + 8;
    let size = wav.readUInt32LE(at + 4);
    if (id === "data" && size === 0xffffffff) size = wav.length - from; // ffmpeg's pipe WAV has an unknown length.
    if (from + size > wav.length) throw new Error("Truncated WAV chunk");
    if (id === "fmt " && size >= 16) format = { code: wav.readUInt16LE(from), channels: wav.readUInt16LE(from + 2), sampleRate: wav.readUInt32LE(from + 4), block: wav.readUInt16LE(from + 12), bits: wav.readUInt16LE(from + 14) };
    if (id === "data") data = wav.subarray(from, from + size);
    at = from + size + size % 2;
  }
  if (!format || !data) throw new Error("WAV needs fmt and data chunks");
  const { code, channels, sampleRate, block, bits } = format;
  if (code !== 1 || bits !== 16 || !channels || !sampleRate || block !== channels * 2 || !data.length || data.length % block) throw new Error("Expected nonempty 16-bit PCM WAV");
  const samples = data.length / block;
  const amplitude = (i) => {
    let value = 0;
    for (let c = 0; c < channels; c++) value = Math.max(value, Math.abs(data.readInt16LE(i * block + c * 2)));
    return value;
  };
  let peak = 0, peakSample = 0;
  for (let i = 0; i < samples; i++) {
    const value = amplitude(i);
    if (value > peak) { peak = value; peakSample = i; }
  }
  if (!peak) throw new Error("Silent SFX has no transient");
  let attackSample = 0;
  while (amplitude(attackSample) < peak * 0.1) attackSample++;
  return { sha256: createHash("sha256").update(wav).digest("hex"), sampleRate, channels, samples, attackSample, peakSample, attack: attackSample / sampleRate, peak: peakSample / sampleRate };
}

// No WAV decoding at render time. The stale-table test remeasures every file, including pitch variants.
export const SFX_ONSETS = Object.freeze(JSON.parse(fs.readFileSync(new URL("../assets/sfx/onsets.json", import.meta.url), "utf8")).files);

/** Optional generated MP3 cues must be measured too. Tests can inject a local PCM WAV decoder. */
export function measureSfxFile(file, { decode = (src) => execFileSync("ffmpeg", ["-v", "error", "-i", src, "-acodec", "pcm_s16le", "-f", "wav", "pipe:1"], { maxBuffer: 8 * 1024 * 1024 }) } = {}) {
  return measureSfx(String(file).endsWith(".wav") ? fs.readFileSync(file) : decode(file));
}

/** One clock for all looks, including bold:
 *   eventClock({ landAt: word.end + 8 / fps, sfx: "slam.wav", fps }).start
 * Use the visual tween endpoint (or its declared 95% arrival), not the tween start. Peak is the main impact;
 * attack is available for a sustained texture such as typing. Both landing and cue start are whole frames.
 * An event on frame zero cannot have audio preroll: clipped reports that unavoidable boundary case.
 */
export function eventClock({ landAt, sfx, fps = 30, anchor = "peak" }) {
  if (!Number.isFinite(landAt) || landAt < 0 || !Number.isFinite(fps) || fps <= 0) throw new Error("Event clock needs a nonnegative landing and positive fps");
  const file = String(sfx).split(/[\\/]/).at(-1), sound = typeof sfx === "object" && sfx ? sfx : SFX_ONSETS[file];
  if (!sound || !["attack", "peak"].includes(anchor) || !Number.isFinite(sound[anchor]) || sound[anchor] < 0) throw new Error(`Unknown SFX or transient: ${file} ${anchor}`);
  const landFrame = Math.round(landAt * fps), offset = sound[anchor];
  const wanted = Math.round(landFrame - offset * fps), startFrame = Math.max(0, wanted);
  return { start: startFrame / fps, startFrame, landAt: landFrame / fps, landFrame, anchor, offset, transientAt: startFrame / fps + offset, clipped: wanted < 0 };
}

/** Principal entrance endpoints in compose.mjs / GRAPHICS_JS. This only describes picture timing. */
export function legacyLanding(kind, event, { fps = 30, zoomStyle = "snap", graphicsMode = "overlay", hookStyle = "gold" } = {}) {
  if (kind === "slam") return event.t + 0.42;
  if (kind === "move") return event.t + (event.cut ? 0 : zoomStyle === "camera" && !event.onKey ? 0.55 : event.snap || 0);
  if (kind === "icon") return event.t + 7 / fps;
  if (kind === "flash") return event.duration;
  if (kind === "hook") return event.start + (hookStyle === "headline" ? 0.3 + 0.03 * Math.max(0, (event.words?.length || String(event.text || "").trim().split(/\s+/).length) - 1) : 0.39);
  if (kind === "marker") return Math.max(event.start, event.wordStart ?? event.start) + 0.04 + 0.38;
  if (kind === "whip-in") return event.start + 3 / fps; // Maximum blur, compose.mjs's seven-frame whip.
  if (kind === "whip-out") return event.start + event.duration - 4 / fps;
  if (kind === "card") {
    const items = event.type === "ladder" ? event.rungs : event.items;
    const live = ["list", "steps", "ladder"].includes(event.type) && items?.length && items.every((item) => Number.isFinite(item.at));
    const quiet = event.skin;
    const enter = live ? 8 / fps : Math.max(event.mode === "proof" ? 8 / fps : 0, quiet === "note" ? 0.01 : quiet === "atelier" ? 0.45 : quiet === "serifonlife" ? 0.6 : quiet === "notify" ? 0.55 : graphicsMode === "band" ? 0.32 : graphicsMode === "overlay" ? event.mode === "proof" ? 8 / fps : 0.3 : 0.16);
    return event.start + enter;
  }
  throw new Error(`Unknown legacy landing: ${kind}`);
}

/** Endpoints from GLOW_SCENES_JS, GLOW_ICONS_JS and the swap strike in compose.mjs. */
export function glowLanding(kind, event, { index = 0, at, scenes = [], fps = 30 } = {}) {
  const t0 = event.start + 0.08;
  if (kind === "scene") return event.start + 0.22; // Ground wipe, independent of a possible icon bridge.
  if (kind === "number") return event.start + (event.from == null ? 0.3 : Math.min(0.9, Math.max(0.4, event.end - event.start - 0.68)));
  if (kind === "meter") return event.start + 1.08;
  if (kind === "item") {
    if (["list", "steps"].includes(event.type)) return (index ? Math.max(t0 + index * 0.12, at - 0.05) : t0) + 0.28;
    if (event.type === "flow") return (index ? at : event.start) + 0.2;
    if (event.type === "bars") return (index ? Math.max(event.start, at) : event.start) + 0.65;
    return at + 0.32; // gsPop for a future collection type.
  }
  if (kind === "branch") return Math.max(event.start, at) + 0.2;
  if (kind === "right") return event.type === "bars" ? Math.max(event.start, at) + 0.65 : Math.max(t0 + 0.35, at - 0.05) + 0.25;
  if (kind === "bubble") return at + 0.2;
  if (kind === "typing") return Math.max(0, at - 0.4); // First attack at the typing dots, not the last click's peak.
  if (kind === "stamp") return event.start + 0.22;
  if (kind === "notify") return event.start + 0.28;
  if (kind === "swap") return Math.max(event.start, at) + 0.22;
  if (["icon", "hit", "ping"].includes(kind)) {
    if (!event.action) return event.t + 7 / fps;
    const bridge = scenes.find((scene) => scene.bridge === index);
    const end = event.end ?? event.t + 1;
    const outAt = bridge ? bridge.start : end - Math.min(0.14, (end - event.t) / 4);
    const enter = Math.min(0.32, (outAt - event.t) * 0.7);
    if (kind === "hit") return event.t + enter * 0.75;
    if (kind === "ping") return event.t + enter;
    return event.t + (["drop", "spin"].includes(event.action) ? enter : enter / 2);
  }
  throw new Error(`Unknown glow landing: ${kind}`);
}
