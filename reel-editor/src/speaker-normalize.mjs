import fs from "node:fs";
import { run, log, warn } from "./util.mjs";

/**
 * Speaker delivery loudness: -14 LUFS integrated with true peak at or under -1 dBTP AFTER the AAC encode.
 * The daily-reel pass (normalizeDelivery) lifts a quiet mix with linear loudnorm, and the AAC encode then puts
 * inter-sample peaks back over the line (Julee's first draft: -17.2 LUFS in, +0.1 dBTP out). Here loudnorm aims
 * for -2 dBTP, a limiter holds samples at -2 dBFS, and the audio is cut to the picture so the file is exactly as
 * long as the plan.
 */
export const LIMIT = 10 ** (-2 / 20);
// QC fails above -1 dBTP; aim a little under it when a retry has to pull the limiter down.
export const PEAK_CEILING = -1, PEAK_TARGET = -1.3;

export function speakerLoudnessFilter(measured, { limitDb = -2 } = {}) {
  const m = measured;
  return `loudnorm=I=-14:TP=-2:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary,alimiter=limit=${(10 ** (limitDb / 20)).toFixed(4)}:attack=1:release=50:level=disabled`;
}

/**
 * Dense transients such as applause overshoot in the AAC encode by more than the 1 dB of headroom
 * (Julee draft 8: the tent's closing applause came out at -0.6 dBTP). Lower the limiter by the measured overshoot.
 * Returns the next limiter level, or null when the encode is already within the ceiling.
 */
export function nextLimit(limitDb, truePeak) {
  if (!Number.isFinite(truePeak) || truePeak <= PEAK_CEILING) return null;
  return Math.round((limitDb - (truePeak - PEAK_TARGET)) * 10) / 10;
}

export async function measureTruePeak(file, { runImpl = run } = {}) {
  const { err } = await runImpl("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true, allowFail: true });
  const m = String(err).slice(String(err).lastIndexOf("Summary:")).match(/Peak:\s*([-+\d.]+)\s*dBFS/);
  return m ? Number(m[1]) : NaN;
}

export async function speakerNormalize(file, { runImpl = run, measurePeak = measureTruePeak, attempts = 3 } = {}) {
  const tmp = file.replace(/\.mp4$/, ".loud.mp4");
  try {
    const { err } = await runImpl("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "loudnorm=I=-14:TP=-2:LRA=11:print_format=json", "-f", "null", "-"], { capture: true, allowFail: true });
    const m = String(err).match(/\{[^{}]*"input_i"[^{}]*\}/);
    if (!m) return false;
    const j = JSON.parse(m[0]);
    let limitDb = -2, peak = NaN;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", speakerLoudnessFilter(j, { limitDb }),
        "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", tmp]);
      peak = await measurePeak(tmp, { runImpl });
      const next = nextLimit(limitDb, peak);
      if (next == null || attempt === attempts) break;
      log(`loudness: true peak ${peak} dBTP after the AAC encode; limiter ${limitDb} → ${next} dBFS`);
      limitDb = next;
    }
    fs.renameSync(tmp, file);
    log(`loudness: ${Number(j.input_i).toFixed(1)} LUFS → -14 LUFS, true peak ${Number.isFinite(peak) ? `${peak} dBTP` : "unmeasured"}`);
    return true;
  } catch (e) {
    warn(`loudness pass skipped: ${String(e.message).split("\n")[0]}`);
    fs.rmSync(tmp, { force: true });
    return false;
  }
}
