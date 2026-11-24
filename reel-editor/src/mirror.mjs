/**
 * Mirrored footage: a selfie clip saved mirror-image puts every word in the shot backwards (a shirt reading
 * "YMRA TTOILLE", Nov 18-19 batch; flipped by hand each time). Vision reads a few frames as they are and flipped;
 * when only the flipped frames read as words, the clip is mirrored and the clean pass flips it back.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ocrBinary, parseOcrJSON } from "./evidence.mjs";
import { run } from "./util.mjs";

/** Letters in confidently read words of three letters or more: how much real text a frame shows. */
export function readableLetters(ocr, { minConfidence = 0.5 } = {}) {
  let parsed;
  try { parsed = parseOcrJSON(ocr); } catch { return 0; }
  let letters = 0;
  for (const line of parsed.lines) {
    if (line.confidence < minConfidence) continue;
    for (const word of line.text.match(/\p{L}{3,}/gu) || []) letters += word.length;
  }
  return letters;
}

/**
 * Pure verdict from per-frame scores [{ normal, flipped }]: mirrored when the flipped frames read clearly more text
 * overall (12+ letters and 2.5x the unflipped) and win in most of the frames that show any text at all.
 */
export function mirrorVerdict(scores = [], { minLetters = 12, ratio = 2.5 } = {}) {
  const normal = scores.reduce((sum, s) => sum + (s.normal || 0), 0);
  const flipped = scores.reduce((sum, s) => sum + (s.flipped || 0), 0);
  const withText = scores.filter((s) => (s.normal || 0) + (s.flipped || 0) > 0);
  const flippedWins = withText.filter((s) => (s.flipped || 0) > (s.normal || 0)).length;
  return flipped >= minLetters && flipped >= ratio * Math.max(1, normal) && flippedWins * 2 > withText.length;
}

async function extractFrame(video, at, output, flip) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(at), "-i", video, "-frames:v", "1", ...(flip ? ["-vf", "hflip"] : []), output], { capture: true });
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error(`no frame at ${at}s`);
}

/** Does the clip read backwards? False when Vision OCR is unavailable or nothing in the shot is text. */
export async function detectMirrored(video, duration, { at = [0.2, 0.5, 0.8], extract = extractFrame, ocr = null } = {}) {
  const binary = ocr ? null : await ocrBinary();
  if (!ocr && !binary) return false;
  const read = ocr || (async (file) => (await run(binary, [file], { capture: true })).out);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-mirror-"));
  try {
    const scores = [];
    for (const share of at) {
      const t = Math.max(0, Math.min(duration - 0.1, duration * share));
      const score = {};
      for (const flip of [false, true]) {
        const file = path.join(temp, `${Math.round(t * 1000)}-${flip ? "flipped" : "normal"}.png`);
        await extract(video, t, file, flip);
        score[flip ? "flipped" : "normal"] = readableLetters(await read(file));
      }
      scores.push(score);
    }
    return mirrorVerdict(scores) ? { mirrored: true, scores } : false;
  } catch {
    return false;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
