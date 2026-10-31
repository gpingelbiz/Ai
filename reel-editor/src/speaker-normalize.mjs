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

export function speakerLoudnessFilter(measured) {
  const m = measured;
  return `loudnorm=I=-14:TP=-2:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary,alimiter=limit=${LIMIT.toFixed(4)}:attack=1:release=50:level=disabled`;
}

export async function speakerNormalize(file, { runImpl = run } = {}) {
  const tmp = file.replace(/\.mp4$/, ".loud.mp4");
  try {
    const { err } = await runImpl("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "loudnorm=I=-14:TP=-2:LRA=11:print_format=json", "-f", "null", "-"], { capture: true, allowFail: true });
    const m = String(err).match(/\{[^{}]*"input_i"[^{}]*\}/);
    if (!m) return false;
    const j = JSON.parse(m[0]);
    await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", speakerLoudnessFilter(j),
      "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", tmp]);
    fs.renameSync(tmp, file);
    log(`loudness: ${Number(j.input_i).toFixed(1)} LUFS → -14 LUFS, true peak under -1 dBTP`);
    return true;
  } catch (e) {
    warn(`loudness pass skipped: ${String(e.message).split("\n")[0]}`);
    fs.rmSync(tmp, { force: true });
    return false;
  }
}
