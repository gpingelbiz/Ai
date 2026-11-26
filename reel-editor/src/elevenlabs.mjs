import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, sha1, ensureDir } from "./util.mjs";
import { normalizeWords } from "./transcribe.mjs";

const BASE = "https://api.elevenlabs.io/v1";

export function hasKey() {
  return !!process.env.ELEVENLABS_API_KEY;
}

function key() {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not set (get one at https://elevenlabs.io/app/developers/api-keys)");
  return k;
}

async function fail(res, what) {
  let body = "";
  try { body = await res.text(); } catch {}
  throw new Error(`ElevenLabs ${what} failed: HTTP ${res.status} ${body.slice(0, 400)}`);
}

/** Text to speech → mp3 file. */
export async function tts({ text, voiceId = process.env.ELEVENLABS_VOICE_ID, modelId = "eleven_multilingual_v2", out, stability = 0.5, similarity = 0.75, style = 0 }) {
  if (!voiceId) throw new Error("no voice id: pass --voice or set ELEVENLABS_VOICE_ID");
  const res = await fetch(`${BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability, similarity_boost: similarity, style } }),
  });
  if (!res.ok) await fail(res, "text-to-speech");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

// Greg's own clone on ElevenLabs (Greg 2026-11-25: the VoiceStudio clone "sounds to AI still", "Ok the eleven labs
// voice"). A voice is named "el:<voice id>" or "el:<voice id>@<model>". Eleven v4 is the default: the same 39-word
// passage scored against Greg's real VSL recording with a speaker model (CAM++) came out v4 0.918 (Greg against
// himself 0.935), the VoiceStudio clone 0.897, Multilingual v2 0.803, v3 0.746.
export const CLONE_MODEL = "eleven_v4";
export const CLONE_SETTINGS = Object.freeze({ stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true });

/** True for "el:<voice id>" voice names. */
export function isCloneVoice(value) {
  return /^el:/i.test(String(value || "").trim());
}

/** "el:abc123" -> { voiceId: "abc123", model: "eleven_v4" }; "el:abc123@eleven_multilingual_v2" picks the model. */
export function parseCloneVoice(value, { model = CLONE_MODEL } = {}) {
  const raw = String(value || "").trim().replace(/^el:/i, "");
  const at = raw.indexOf("@");
  const voiceId = (at > 0 ? raw.slice(0, at) : raw).trim();
  const picked = (at > 0 ? raw.slice(at + 1) : model).trim();
  if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) throw new Error(`not an ElevenLabs voice id: "${voiceId}" (use el:<voice id>, from elevenlabs.io → Voices)`);
  if (!/^eleven_[a-z0-9_]+$/.test(picked)) throw new Error(`not an ElevenLabs model: "${picked}" (for example eleven_v4)`);
  return { voiceId, model: picked };
}

/**
 * One line in a cloned ElevenLabs voice, written as a 48 kHz WAV (other extensions are converted by ffmpeg). The
 * same seed gives the same take; the lines before and after go along so each line keeps the flow of the whole read.
 */
export async function speakClone({ text, voice, out, seed, previousText = "", nextText = "", settings = CLONE_SETTINGS, deps = {} }) {
  const words = String(text || "").trim();
  if (!words) throw new Error("nothing to say");
  if (!out) throw new Error("speakClone needs an output file");
  const v = parseCloneVoice(voice);
  const fixedSeed = String(seed ?? "").toLowerCase() === "random" || seed === "" || seed == null ? null : Number(seed);
  const body = {
    text: words,
    model_id: v.model,
    voice_settings: { ...settings },
    ...(Number.isFinite(fixedSeed) ? { seed: Math.abs(Math.trunc(fixedSeed)) % 4294967296 } : {}),
    ...(previousText ? { previous_text: String(previousText).trim() } : {}),
    ...(nextText ? { next_text: String(nextText).trim() } : {}),
  };
  const res = await (deps.fetch || fetch)(`${BASE}/text-to-speech/${v.voiceId}?output_format=wav_48000`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, "text-to-speech");
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 1000) throw new Error("ElevenLabs returned no audio");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  if (path.extname(out).toLowerCase() === ".wav") fs.writeFileSync(out, audio);
  else {
    const tmp = `${out}.part.wav`;
    fs.writeFileSync(tmp, audio);
    try { await (deps.run || run)("ffmpeg", ["-y", "-v", "error", "-i", tmp, "-ac", "1", "-ar", "44100", "-b:a", "160k", out], { capture: true }); }
    finally { fs.rmSync(tmp, { force: true }); }
  }
  return out;
}

/** Sound effect from a prompt, cached under ~/.cache/reel-editor/sfx so a whoosh is generated once and reused. */
export async function sfx({ prompt, durationSeconds = 1, promptInfluence = 0.4, out }) {
  const cacheDir = ensureDir(process.env.REEL_SFX_CACHE || path.join(os.homedir(), ".cache", "reel-editor", "sfx"));
  const cached = path.join(cacheDir, `${sha1(`${prompt}|${durationSeconds}|${promptInfluence}`)}.mp3`);
  if (!fs.existsSync(cached)) {
    const res = await fetch(`${BASE}/sound-generation`, {
      method: "POST",
      headers: { "xi-api-key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({ text: prompt, duration_seconds: durationSeconds, prompt_influence: promptInfluence }),
    });
    if (!res.ok) await fail(res, "sound-generation");
    fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(cached, out);
  return out;
}

/** Scribe speech-to-text with word timestamps. Audio is extracted first so the upload stays small. */
export async function scribe(input, { language = "en", modelId = "scribe_v1" } = {}) {
  const tmp = path.join(os.tmpdir(), `reel-scribe-${process.pid}.mp3`);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", tmp]);
  try {
    const fd = new FormData();
    fd.append("model_id", modelId);
    fd.append("timestamps_granularity", "word");
    fd.append("diarize", "false");
    if (language) fd.append("language_code", language);
    fd.append("file", new Blob([fs.readFileSync(tmp)], { type: "audio/mpeg" }), "audio.mp3");
    const res = await fetch(`${BASE}/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: fd });
    if (!res.ok) await fail(res, "speech-to-text");
    return normalizeWords(await res.json());
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
