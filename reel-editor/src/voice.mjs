// Greg's cloned voice, wherever it lives: "el:<voice id>" is his ElevenLabs clone (src/elevenlabs.mjs, the proof reel
// voice since 2026-11-25), "vs:<name>" a VoiceStudio voice on this Mac (src/voicestudio.mjs).
import { log } from "./util.mjs";
import { isCloneVoice, parseCloneVoice, speakClone } from "./elevenlabs.mjs";
import { DEFAULT_SEED, isVoiceStudioVoice, parseVoice as parseStudioVoice, speak as speakStudio } from "./voicestudio.mjs";

export { DEFAULT_SEED };

/** Checks a voice name before any work starts; throws with how to name one. */
export function parseVoice(value) {
  if (isCloneVoice(value)) return { kind: "elevenlabs", ...parseCloneVoice(value) };
  if (isVoiceStudioVoice(value)) return { kind: "voicestudio", ...parseStudioVoice(value) };
  throw new Error(`unknown voice "${value}": use el:<ElevenLabs voice id> (Greg's clone) or vs:<VoiceStudio voice>`);
}

/** One line in the voice. previousText / nextText only reach ElevenLabs (they keep the read flowing line to line). */
export async function speak({ text, voice, out, env = process.env, seed = env.REEL_VOICE_SEED ?? DEFAULT_SEED, previousText = "", nextText = "", deps = {} }) {
  if (isCloneVoice(voice)) {
    await (deps.speakClone || speakClone)({ text, voice, out, seed, previousText, nextText, deps });
    const words = String(text || "").trim();
    log(`voice: "${words.slice(0, 48)}${words.length > 48 ? "…" : ""}" in ElevenLabs ${parseCloneVoice(voice).model}`);
    return out;
  }
  return (deps.speakStudio || speakStudio)({ text, voice, out, env, seed, deps });
}
