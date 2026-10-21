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
