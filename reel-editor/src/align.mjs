import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, r3 } from "./util.mjs";

/**
 * Forced alignment: the transcript's words, after any text fix, are re-timed against the audio by ElevenLabs
 * (POST /v1/forced-alignment: audio + text in, a start and end per word out). A corrected word otherwise inherits
 * a timing split evenly across the words it replaced, and faster-whisper's own timings run late on short words;
 * both show up as the gold word, the slam or the karaoke pop landing off the syllable.
 */

const BASE = "https://api.elevenlabs.io/v1";
const norm = (s) => String(s).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9&$%]/g, "");

export function hasAlignment(env = process.env) {
  return !!env.ELEVENLABS_API_KEY;
}

/** Raw call: [{text,start,end,loss}] for `text` spoken in `input` (audio is extracted first; the upload stays small). */
export async function forcedAlignmentRaw(input, text, { env = process.env } = {}) {
  const key = env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const tmp = path.join(os.tmpdir(), `reel-align-${process.pid}-${Date.now()}.mp3`);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", tmp]);
  try {
    const fd = new FormData();
    fd.append("file", new Blob([fs.readFileSync(tmp)], { type: "audio/mpeg" }), "audio.mp3");
    fd.append("text", text);
    const res = await fetch(`${BASE}/forced-alignment`, { method: "POST", headers: { "xi-api-key": key }, body: fd });
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch {}
      throw new Error(`ElevenLabs forced-alignment failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const j = await res.json();
    return (j.words || []).map((w) => ({ text: String(w.text ?? ""), start: +w.start, end: +w.end, loss: w.loss })).filter((w) => w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Pure: carry the aligner's timings onto our words. Tokens are matched by a longest common subsequence on
 * normalized text, so a tokenization difference costs one word, not the rest of the reel. Unmatched words keep
 * their timing. Returns {words, matched, moved, maxShift, medianShift} or null when the alignment is not trusted
 * (under 80% matched, or the typical shift is over a second: the audio and text did not line up).
 */
export function alignWords(ours, theirs, { minMatched = 0.8, maxMedianShift = 1.0, movedAt = 0.06 } = {}) {
  if (!ours.length || !theirs.length) return null;
  const A = ours.map((w) => norm(w.text));
  const B = theirs.map((w) => norm(w.text));
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] && A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] && A[i] === B[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  if (pairs.length < minMatched * n) return null;
  const shifts = pairs.map(([a, b]) => Math.abs(theirs[b].start - ours[a].start)).sort((x, y) => x - y);
  const median = shifts[Math.floor(shifts.length / 2)];
  if (median > maxMedianShift) return null;
  const words = ours.map((w) => ({ ...w }));
  let moved = 0, maxShift = 0;
  for (const [a, b] of pairs) {
    const t = theirs[b];
    if (!(t.end > t.start)) continue;
    const d = Math.abs(t.start - words[a].start);
    if (d >= movedAt) moved++;
    maxShift = Math.max(maxShift, d);
    words[a].start = r3(t.start);
    words[a].end = r3(Math.max(t.end, t.start + 0.04));
  }
  // Keep the sequence monotonic: a word never starts before the previous one ends.
  for (let k = 1; k < words.length; k++) {
    if (words[k].start < words[k - 1].end) {
      const mid = r3((words[k - 1].end + words[k].start) / 2);
      words[k - 1].end = Math.max(words[k - 1].start + 0.04, mid);
      words[k].start = Math.max(words[k - 1].end, mid);
      if (words[k].end < words[k].start + 0.04) words[k].end = r3(words[k].start + 0.04);
    }
  }
  return { words, matched: pairs.length, moved, maxShift: r3(maxShift), medianShift: r3(median) };
}

/** Align `words` to `input`'s audio. Returns the alignWords result, or {error}. */
export async function realignWords(input, words, { env = process.env } = {}) {
  try {
    const theirs = await forcedAlignmentRaw(input, words.map((w) => w.text).join(" "), { env });
    const res = alignWords(words, theirs);
    return res || { error: "the alignment did not line up with the transcript; keeping the engine's timings" };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
}

export function describeAlignment(res, why = "") {
  if (!res || res.error) return `word timing: ${res?.error || "skipped"}`;
  return `word timing: ${res.matched} words re-timed against the audio${why ? ` (${why})` : ""}, ${res.moved} moved, biggest shift ${res.maxShift}s`;
}
