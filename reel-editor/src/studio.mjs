import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, r3 } from "./util.mjs";

/**
 * Studio sound: the voice is denoised by DeepFilterNet3 (a deep full-band denoiser, MIT/Apache, one binary) before
 * the mix chain, which then levels phrases, removes mouth clicks, de-esses, compresses gently and lands at -16 LUFS.
 * The spectral denoiser (afftdn) stays as the fallback when the binary is not installed.
 *
 * deep-filter is looked up at REEL_DEEPFILTER, then ~/.cache/reel-editor/bin/deep-filter, then on PATH.
 * Install: scripts/install-deepfilter.sh (fetches the official release binary for this Mac).
 */

export function findDeepFilter(env = process.env) {
  const cands = [];
  if (env.REEL_DEEPFILTER) cands.push(env.REEL_DEEPFILTER);
  cands.push(path.join(env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "bin", "deep-filter"));
  for (const d of (env.PATH || "").split(":")) if (d) cands.push(path.join(d, "deep-filter"));
  for (const c of cands) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {}
  }
  return null;
}

/** The mix chain after DeepFilterNet (signal order). Replaces afftdn with the leveler and the de-clicker. */
export const STUDIO_CHAIN = [
  "highpass=f=80",
  "adeclick=t=2",
  "deesser=i=0.4:m=0.5:f=0.5",
  // Phrase leveler: quiet phrases come up toward the loud ones (expansion 2.5x max, slow rate, nothing under -34 dBFS
  // so breaths and the room between sentences stay where the denoiser left them).
  "speechnorm=e=2.5:r=0.0002:t=0.02:l=1",
  "acompressor=threshold=0.09:ratio=3:attack=10:release=150:makeup=2",
  "alimiter=limit=0.89:attack=5:release=50",
  "loudnorm=I=-16:TP=-1.5:LRA=11",
  "aformat=channel_layouts=stereo",
].join(",");

/** Noise floor of a file in dBFS (ffmpeg astats), or null. */
export async function noiseFloor(file) {
  try {
    const { err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "astats=measure_overall=Noise_floor:measure_perchannel=none", "-f", "null", "-"], { capture: true, allowFail: true });
    const m = err.match(/Noise floor dB:\s*(-?[\d.]+)/);
    return m ? r3(+m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Denoise the voice of `input` into a 48 kHz mono WAV at `outWav`. Returns {wav, floorBefore, floorAfter, seconds}
 * or null when deep-filter is unavailable or fails (the caller keeps the spectral denoiser).
 */
export async function studioVoice(input, outWav, { deepFilter = findDeepFilter(), measure = true } = {}) {
  if (!deepFilter) return null;
  const dir = path.dirname(outWav);
  fs.mkdirSync(dir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(dir, "dfn-"));
  const raw = path.join(tmpDir, "voice.wav");
  const t0 = Date.now();
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", raw], { quiet: true });
    const outDir = path.join(tmpDir, "out");
    fs.mkdirSync(outDir);
    // -D compensates the model's look-ahead so the enhanced file lines up sample for sample with the source.
    await run(deepFilter, ["-D", "-o", outDir, raw], { capture: true });
    const made = fs.readdirSync(outDir).filter((f) => f.endsWith(".wav")).map((f) => path.join(outDir, f))[0];
    if (!made || !fs.statSync(made).size) throw new Error("deep-filter wrote no file");
    const [floorBefore, floorAfter] = measure ? await Promise.all([noiseFloor(raw), noiseFloor(made)]) : [null, null];
    fs.renameSync(made, outWav);
    return { wav: outWav, floorBefore, floorAfter, seconds: r3((Date.now() - t0) / 1000) };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** One line for the log. */
export function describeStudio(res) {
  if (!res || res.error) return res?.error ? `studio sound: deep-filter failed (${res.error}), using the spectral denoiser` : "studio sound: deep-filter not installed (scripts/install-deepfilter.sh), using the spectral denoiser";
  const floor = res.floorBefore != null && res.floorAfter != null ? `, noise floor ${res.floorBefore} → ${res.floorAfter} dB` : "";
  return `studio sound: DeepFilterNet3 denoise + phrase leveler + de-click (${res.seconds}s${floor})`;
}
