import { SDR_FILTER, SDR_TAGS } from "./hdr.mjs";
import { run, r3 } from "./util.mjs";

export const PACE = { off: Infinity, slow: 1.0, medium: 0.6, fast: 0.35 };
const FILLERS = new Set(["um", "uh", "uhm", "umm", "uhh", "erm", "hmm", "mm", "ah", "er", "mhm"]);
// Function words where an immediate repeat is almost always a stutter ("I I think", "the the").
const STUTTER_WORDS = new Set(["i", "the", "a", "an", "to", "and", "so", "but", "we", "you", "it", "is", "in", "of", "for", "if", "what", "when", "they", "he", "she", "my", "our", "this", "that's", "it's"]);
const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9&$']/g, "");
const endsClause = (t) => /[.,!?;:]$/.test(String(t).trim());

/**
 * Bad-take detection: a phrase of 3..8 words that is repeated shortly after is a restart.
 * Everything from the false start up to the restart is dropped (the second take is kept).
 * Returns an array parallel to words: null | "bad-take" | "stutter".
 */
export function findBadTakes(words, { minPhrase = 3, maxPhrase = 8, maxTail = 5, maxSpan = 10 } = {}) {
  const toks = words.map((w) => norm(w.text));
  const drop = new Array(words.length).fill(null);
  let i = 0;
  while (i < toks.length) {
    let found = null;
    for (let k = Math.min(maxPhrase, toks.length - i); k >= minPhrase && !found; k--) {
      for (let j = i + 1; j <= Math.min(toks.length - k, i + k + maxTail); j++) {
        let ok = true;
        for (let m = 0; m < k; m++) if (toks[i + m] !== toks[j + m]) { ok = false; break; }
        if (!ok) continue;
        if (words[j].start - words[i].start > maxSpan) continue;
        // A clause boundary anywhere in the abandoned span means a deliberate repetition, not a restart.
        let clause = false;
        for (let m = i; m < j; m++) if (endsClause(words[m].text)) { clause = true; break; }
        if (clause) continue;
        found = { j, k };
        break;
      }
    }
    if (found) {
      for (let m = i; m < found.j; m++) drop[m] = "bad-take";
      i = found.j;
    } else i++;
  }
  for (let m = 0; m + 1 < toks.length; m++) {
    if (drop[m] || drop[m + 1]) continue;
    if (toks[m] === toks[m + 1] && STUTTER_WORDS.has(toks[m]) && words[m + 1].start - words[m].end < 0.6) drop[m] = "stutter";
  }
  return drop;
}

/**
 * Build the keep-list.
 * - silence: off | slow | medium | fast (gap threshold between words)
 * - badTakes / fillers: drop those words and force a cut around them
 * Returns { segments:[{start,end}], removed:[{start,end,reason}], words:[...with drop], originalDuration, keptDuration }.
 */
export function planCuts(words, duration, { silence = "fast", badTakes = true, fillers = true, pad = 0.12, minGapCut = 0.15, minSegment = 0.3 } = {}) {
  const thr = PACE[silence] ?? PACE.fast;
  const drop = badTakes ? findBadTakes(words) : new Array(words.length).fill(null);
  if (fillers) {
    words.forEach((w, i) => {
      if (drop[i] || !FILLERS.has(norm(w.text))) return;
      const prevGap = i > 0 ? w.start - words[i - 1].end : 1;
      const nextGap = i + 1 < words.length ? words[i + 1].start - w.end : 1;
      // A filler glued into the flow on both sides can't be cut cleanly; leave it.
      if (prevGap < 0.12 && nextGap < 0.12) return;
      drop[i] = "filler";
    });
  }

  const removed = [];
  const segs = [];
  let cur = null;
  let pending = []; // dropped regions (one per reason run) waiting for the next kept word
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (drop[i]) {
      const last = pending[pending.length - 1];
      if (last && last.reason === drop[i]) last.end = Math.max(last.end, w.end);
      else pending.push({ start: w.start, end: w.end, reason: drop[i] });
      continue;
    }
    if (cur && !pending.length && w.start - cur.lastEnd <= thr) {
      cur.lastEnd = Math.max(cur.lastEnd, w.end);
      continue;
    }
    if (cur) {
      let end = cur.lastEnd + pad;
      if (pending.length) end = Math.min(end, pending[0].start);
      segs.push({ start: cur.start, end, forced: cur.forced });
    }
    let start = w.start - pad;
    let forced = false;
    if (pending.length) {
      start = Math.max(start, pending[pending.length - 1].end);
      removed.push(...pending);
      pending = [];
      forced = true;
    }
    if (segs.length) start = Math.max(start, segs[segs.length - 1].end);
    cur = { start, lastEnd: w.end, forced };
  }
  if (cur) segs.push({ start: cur.start, end: cur.lastEnd + pad, forced: cur.forced });
  if (pending.length) {
    removed.push(...pending);
    if (segs.length) segs[segs.length - 1].end = Math.min(segs[segs.length - 1].end, pending[0].start);
  }

  const out = [];
  for (const s of segs) {
    const a = Math.max(0, s.start);
    const b = Math.min(duration, s.end);
    if (b - a < minSegment) continue;
    const prev = out[out.length - 1];
    if (prev && !s.forced && a - prev.end < minGapCut) prev.end = r3(b);
    else out.push({ start: r3(a), end: r3(b) });
  }
  if (!out.length) out.push({ start: 0, end: r3(duration) });

  const silences = [];
  let t = 0;
  for (const s of out) {
    if (s.start - t > 0.001) silences.push({ start: r3(t), end: s.start, reason: "silence" });
    t = s.end;
  }
  if (duration - t > 0.001) silences.push({ start: r3(t), end: r3(duration), reason: "silence" });

  const kept = out.reduce((acc, s) => acc + (s.end - s.start), 0);
  return {
    segments: out,
    removed: [...removed.map((x) => ({ start: r3(x.start), end: r3(x.end), reason: x.reason })), ...silences].sort((a, b) => a.start - b.start),
    originalDuration: r3(duration),
    keptDuration: r3(kept),
    words: words.map((w, i) => (drop[i] ? { ...w, drop: drop[i] } : w)),
  };
}

/** Move kept words onto the cut timeline. Dropped words and words outside every segment disappear. */
export function remapWords(words, segments) {
  let off = 0;
  const map = segments.map((s) => {
    const m = { ...s, off };
    off += s.end - s.start;
    return m;
  });
  const out = [];
  for (const w of words) {
    if (w.drop) continue;
    const mid = (w.start + w.end) / 2;
    const s = map.find((m) => mid >= m.start && mid <= m.end);
    if (!s) continue;
    const segLen = s.end - s.start;
    const ns = Math.max(s.off, s.off + (w.start - s.start));
    const ne = Math.min(s.off + segLen, s.off + (w.end - s.start));
    out.push({ text: w.text, start: r3(ns), end: r3(Math.max(ne, ns + 0.05)) });
  }
  return out;
}

/** One ffmpeg pass: trim+concat the kept segments, optional audio clean-up, constant frame rate.
 *  hdr: convert BT.2020/HLG video to tagged BT.709 SDR (captions disappear in HyperFrames otherwise; see hdr.mjs). */
export async function applyCuts(input, segments, output, { hasAudio = true, cleanAudio = true, fps = 30, hdr = false } = {}) {
  const parts = [];
  const maps = [];
  segments.forEach((s, i) => {
    parts.push(`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) {
      const d = s.end - s.start;
      const f = Math.min(0.02, d / 4);
      parts.push(`[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${f},afade=t=out:st=${r3(d - f)}:d=${f}[a${i}]`);
    }
    maps.push(hasAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  let fc = `${parts.join(";")};${maps.join("")}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[vcat]${hasAudio ? "[a]" : ""}`;
  // HDR (HLG/PQ, BT.2020) sources become tagged BT.709 SDR so the renderer composites captions normally.
  fc += hdr ? `;[vcat]${SDR_FILTER}[v]` : ";[vcat]null[v]";
  let audioOut = "[a]";
  if (hasAudio && cleanAudio) {
    fc += ";[a]highpass=f=80,afftdn=nr=10:nf=-40,loudnorm=I=-16:TP=-1.5:LRA=11[ao]";
    audioOut = "[ao]";
  }
  const args = [
    "-y", "-loglevel", "error", "-stats",
    "-i", input,
    "-filter_complex", fc,
    "-map", "[v]",
    ...(hasAudio ? ["-map", audioOut] : ["-an"]),
    "-fps_mode", "cfr", "-r", String(fps),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    ...(hdr ? SDR_TAGS : []),
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : []),
    "-movflags", "+faststart",
    output,
  ];
  await run("ffmpeg", args);
  return output;
}
