// Greg's own cloned voice through VoiceStudio (a free local app, debpalash/VoiceStudio) instead of an ElevenLabs
// stock voice. Only engines whose licence allows commercial use are accepted: the app's default engine, OmniVoice,
// is CC-BY-NC, so it is never used for a post. A voice is named "vs:<saved voice>" or "vs:<saved voice>@<engine>".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir, log, run, sha1 } from "./util.mjs";

export const COMMERCIAL_ENGINES = Object.freeze(["cosyvoice", "voxcpm2"]);
export const DEFAULT_ENGINE = "cosyvoice";

export function voicestudioBinary(env = process.env) {
  return env.REEL_VOICESTUDIO_BIN || path.join(env.HOME || os.homedir(), ".local", "bin", "voicestudio");
}

export function voicestudioURL(env = process.env) {
  return (env.REEL_VOICESTUDIO_URL || "http://127.0.0.1:3900").replace(/\/+$/, "");
}

export function hasVoiceStudio(env = process.env, disk = fs) {
  try { disk.accessSync(voicestudioBinary(env), fs.constants.X_OK); return true; } catch { return false; }
}

/** True for "vs:Greg" style voice names (anything else is an ElevenLabs voice id). */
export function isVoiceStudioVoice(value) {
  return /^vs:/i.test(String(value || "").trim());
}

/** "vs:Greg" -> { name: "Greg", engine: "cosyvoice" }; "vs:Greg@voxcpm2" picks the engine. */
export function parseVoice(value, { engine = DEFAULT_ENGINE } = {}) {
  const raw = String(value || "").trim().replace(/^vs:/i, "");
  const at = raw.lastIndexOf("@");
  const name = (at > 0 ? raw.slice(0, at) : raw).trim();
  const picked = (at > 0 ? raw.slice(at + 1) : engine).trim().toLowerCase();
  if (!name) throw new Error("no VoiceStudio voice name (use vs:<saved voice name>, for example vs:Greg)");
  if (!COMMERCIAL_ENGINES.includes(picked)) {
    throw new Error(`VoiceStudio engine "${picked}" is not cleared for posts (its licence is non-commercial or unknown); use ${COMMERCIAL_ENGINES.join(" or ")}`);
  }
  return { name, engine: picked };
}

async function healthy(url, fetchImpl) {
  try {
    const res = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch { return false; }
}

/** Starts the VoiceStudio app in the background when its local backend is not answering, and waits for it. */
export async function ensureVoiceStudio({ env = process.env, timeoutMs = 120000, deps = {} } = {}) {
  const fetchImpl = deps.fetch || fetch, runImpl = deps.run || run, sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const url = voicestudioURL(env);
  if (await healthy(url, fetchImpl)) return url;
  if (!hasVoiceStudio(env, deps.fs || fs)) {
    throw new Error(`VoiceStudio is not installed on this Mac (${voicestudioBinary(env)} is missing); cloned-voice narration only runs where VoiceStudio is set up`);
  }
  if ((deps.platform || process.platform) === "darwin") await runImpl("open", ["-g", "-a", "VoiceStudio"], { capture: true, allowFail: true });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await sleep(3000);
    if (await healthy(url, fetchImpl)) return url;
  }
  throw new Error(`VoiceStudio did not start within ${Math.round(timeoutMs / 1000)} s (open the app once by hand to finish its setup)`);
}

export function voiceCacheDir(env = process.env) {
  return env.REEL_VOICE_CACHE || path.join(env.REEL_CACHE || path.join(env.HOME || os.homedir(), ".cache", "reel-editor"), "voice");
}

/**
 * Speaks `text` in a saved VoiceStudio voice and writes `out` (.wav as rendered, anything else is converted by
 * ffmpeg, so narration.mp3 works). The same voice, engine and text render once and are reused from the cache.
 */
export async function speak({ text, voice = "vs:Greg", out, env = process.env, deps = {} }) {
  const words = String(text || "").trim();
  if (!words) throw new Error("nothing to say");
  if (!out) throw new Error("speak needs an output file");
  const v = parseVoice(voice);
  const runImpl = deps.run || run;
  const cache = ensureDir(voiceCacheDir(env));
  const cached = path.join(cache, `${sha1(`${v.name}|${v.engine}|${words}`)}.wav`);
  if (!fs.existsSync(cached) || fs.statSync(cached).size < 1000) {
    await (deps.ensure || ensureVoiceStudio)({ env, deps });
    const textFile = path.join(cache, `${path.basename(cached, ".wav")}.txt`);
    const tmp = `${cached}.part.wav`;
    fs.writeFileSync(textFile, words);
    try {
      await runImpl(voicestudioBinary(env), ["--json", "speak", "--voice", v.name, "--engine", v.engine, "--language", "English", "--text-file", textFile, "-o", tmp, "--overwrite"], { capture: true });
      if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 1000) throw new Error("VoiceStudio wrote no audio");
      fs.renameSync(tmp, cached);
    } finally {
      fs.rmSync(textFile, { force: true });
      fs.rmSync(tmp, { force: true });
    }
  }
  ensureDir(path.dirname(path.resolve(out)));
  if (path.extname(out).toLowerCase() === ".wav") fs.copyFileSync(cached, out);
  else await runImpl("ffmpeg", ["-y", "-v", "error", "-i", cached, "-ac", "1", "-ar", "44100", "-b:a", "160k", out], { capture: true });
  log(`voice: "${words.slice(0, 48)}${words.length > 48 ? "…" : ""}" in ${v.name} (${v.engine})`);
  return out;
}
