import { SDR_FILTER, SDR_TAGS } from "./hdr.mjs";
import { run, r3, warn } from "./util.mjs";

export const PACE = { off: Infinity, slow: 1.0, medium: 0.6, fast: 0.35, tight: 0.2 };
const FILLERS = new Set(["um", "uh", "uhm", "umm", "uhh", "erm", "hmm", "mm", "ah", "er", "mhm"]);
// Function words where an immediate repeat is almost always a stutter ("I I think", "the the").
const STUTTER_WORDS = new Set(["i", "the", "a", "an", "to", "and", "so", "but", "we", "you", "it", "is", "in", "of", "for", "if", "what", "when", "they", "he", "she", "my", "our", "this", "that's", "it's"]);
import { norm } from "./text.mjs";
// Sign-offs: a reel ends on its last point, so a closing "thanks for watching" inside the last seconds is dropped.
const SIGN_OFFS = ["thanks for watching", "thank you for watching", "see you in the next", "see you next time", "see you on the next", "catch you in the next", "like and subscribe", "like comment subscribe", "hit the follow", "follow for more", "link in bio", "link in my bio", "peace out", "catch you later", "that's it for today", "that's all for today", "until next time"];

/** Index of the first word of a sign-off phrase that starts inside the last `tail` seconds, else -1. */
export function findSignOff(words, duration, { tail = 10 } = {}) {
  const toks = words.map((w) => norm(w.text));
  for (let i = 0; i < toks.length; i++) {
    if (words[i].start < duration - tail) continue;
    for (const phrase of SIGN_OFFS) {
      const p = phrase.split(" ").map(norm);
      if (i + p.length > toks.length) continue;
      let ok = true;
      for (let k = 0; k < p.length; k++) if (toks[i + k] !== p[k]) { ok = false; break; }
      if (ok) return i;
    }
  }
  return -1;
}
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
    // "...look at you. You can..." ends one sentence and starts the next: not a stutter.
    if (endsClause(words[m].text)) continue;
    if (toks[m] === toks[m + 1] && STUTTER_WORDS.has(toks[m]) && words[m + 1].start - words[m].end < 0.6) drop[m] = "stutter";
  }
  return drop;
}

/**
 * Build the keep-list.
 * - silence: off | slow | medium | fast | tight (gap threshold between words; tight is the measured pacing preset:
 *   no dead air over about 0.2 s between phrases)
 * - beats: a pause after a comma, colon or list marker up to this long is a natural beat and stays (0 = off)
 * - badTakes / fillers: drop those words and force a cut around them
 * Returns { segments:[{start,end}], removed:[{start,end,reason}], words:[...with drop], originalDuration, keptDuration }.
 */
export function planCuts(words, duration, { silence = "fast", badTakes = true, fillers = true, signOff = true, pad = 0.12, minGapCut = 0.15, minSegment = 0.3, beats = 0 } = {}) {
  const thr = PACE[silence] ?? PACE.fast;
  const beatAfter = (w) => /[,;:]$|^(first|second|third|so|now|look)[,]?$/i.test(String(w?.text || "").trim());
  const drop = badTakes ? findBadTakes(words) : new Array(words.length).fill(null);
  if (signOff) {
    const i = findSignOff(words, duration);
    if (i >= 0) for (let k = i; k < words.length; k++) drop[k] = "sign-off";
    // A recording that stops mid-word ("so go set-") ends on its last finished sentence when one is close by.
    const last = words.length - 1;
    if (last > 0 && /[-—]$/.test(String(words[last].text).trim())) {
      let k = last - 1;
      while (k >= 0 && !/[.!?,;]$/.test(String(words[k].text).trim())) k--;
      if (k >= 0 && words[last].end - words[k].end <= 4) for (let j = k + 1; j <= last; j++) drop[j] = drop[j] || "cut-off";
    }
  }
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
    const gap = cur ? w.start - cur.lastEnd : 0;
    if (cur && !pending.length && (gap <= thr || (beats > 0 && gap <= beats && beatAfter(words[i - 1])))) {
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
    if (b <= a) continue;
    const prev = out[out.length - 1];
    // Every segment holds a kept word, so a sliver under minSegment is merged into its neighbour, never dropped
    // (an isolated 40 ms word between two pauses used to vanish from both video and captions).
    if (prev && (b - a < minSegment || (!s.forced && a - prev.end < minGapCut))) prev.end = r3(Math.max(prev.end, b));
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

/**
 * Snap segment edges to the source frame grid. Video trims land on frames while audio trims are sample-exact, so
 * unaligned edges leave up to a frame of mismatch per cut and 25 cuts can put the lips a few frames out.
 */
export function snapSegments(segments, fps, duration) {
  const q = 1 / (fps || 30);
  const out = [];
  for (const s of segments) {
    let a = Math.round(s.start / q) * q;
    let b = Math.round(s.end / q) * q;
    if (duration != null) b = Math.min(b, duration);
    a = Math.max(0, a);
    if (b - a < q) b = a + q;
    const prev = out[out.length - 1];
    if (prev && a < prev.end) a = prev.end;
    if (b <= a) continue;
    out.push({ ...s, start: r3(a), end: r3(b) });
  }
  return out;
}

/** Move kept words onto the cut timeline. Dropped words and words outside every segment disappear. */
/**
 * True when a clip is mostly not talking: speech covers under 15% of it, or it has a handful of words (under 8) that
 * cover under 35%. A walk-up or vlog shot like that has no dead air to cut; the footage is the content.
 */
export function mostlyNotTalking(words, duration) {
  if (!(duration >= 3)) return false;
  const spoken = (words || []).reduce((s, w) => s + Math.max(0, (w.end ?? 0) - (w.start ?? 0)), 0);
  const share = spoken / duration;
  return share < 0.15 || ((words || []).length < 8 && share < 0.35);
}

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

/** Pick a clean source-timeline room sample from the existing dBFS envelope. */
export function findRoomTone(env, words, duration, { min = 0.4, max = 1.5, clear = 0.08, trim = 0.05, quietDb = 6, spikeDb = 6 } = {}) {
  const step = Number(env?.step);
  const db = Array.isArray(env?.db) ? env.db : [];
  const limit = Math.min(Number(duration) || 0, db.length * step);
  if (!(step > 0) || !(limit > 0) || !db.length || max < min || min <= 0) return null;
  const levels = db.filter(Number.isFinite).sort((a, b) => a - b);
  if (!levels.length) return null;
  const floor = levels[Math.floor((levels.length - 1) * 0.1)];
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const occupied = (words || [])
    .filter((w) => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end > w.start)
    .map((w) => ({ start: Math.max(0, w.start - clear), end: Math.min(limit, w.end + clear) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const span of occupied) {
    const prev = merged[merged.length - 1];
    if (prev && span.start <= prev.end) prev.end = Math.max(prev.end, span.end);
    else merged.push({ ...span });
  }
  const gaps = [];
  let at = 0;
  for (const span of merged) {
    if (span.start > at) gaps.push({ start: at, end: span.start, edge: at === 0 });
    at = Math.max(at, span.end);
  }
  if (at < limit) gaps.push({ start: at, end: limit, edge: true });

  // Room-bed selection follows erm's quiet-region idea (MIT), using our envelope instead of decoding again.
  const candidates = [];
  const minFrames = Math.ceil(min / step);
  const maxFrames = Math.max(minFrames, Math.floor(max / step));
  for (const gap of gaps) {
    const i0 = Math.max(0, Math.ceil((gap.start - 1e-9) / step));
    const i1 = Math.min(db.length, Math.floor((gap.end + 1e-9) / step));
    const longest = Math.min(maxFrames, i1 - i0);
    for (let n = longest; n >= minFrames; n--) {
      let found = false;
      for (let i = i0; i + n <= i1; i++) {
        const xs = db.slice(i, i + n);
        if (xs.some((v) => !Number.isFinite(v))) continue;
        const mid = median(xs);
        if (mid > floor + quietDb || Math.max(...xs) > mid + spikeDb) continue;
        candidates.push({ start: i * step, end: (i + n) * step, db: mid, edge: gap.edge });
        found = true;
      }
      if (found) break; // this gap's longest clean windows are enough
    }
  }
  candidates.sort((a, b) => Number(b.edge) - Number(a.edge) || (b.end - b.start) - (a.end - a.start) || a.db - b.db || a.start - b.start);
  const best = candidates[0];
  if (!best || best.end - best.start <= trim * 2) return null;
  return { start: r3(best.start + trim), end: r3(best.end - trim), db: r3(best.db) };
}

/** Carry a source-time level envelope through the kept segments, which are concatenated in reel time. */
export function remapEnvelope(env, segments) {
  const step = Number(env?.step);
  const source = env?.db;
  if (!(step > 0) || !Array.isArray(source) || !source.length || !Array.isArray(segments) || !segments.length) return { step: step > 0 ? step : 0.02, db: [] };
  const kept = segments.filter((s) => Number.isFinite(s?.start) && Number.isFinite(s?.end) && s.end > s.start);
  if (kept.length !== segments.length) return { step, db: [] };
  const sourceDuration = source.length * step;
  if (kept.some((s) => s.start < 0 || s.end > sourceDuration + step)) return { step, db: [] };
  const duration = kept.reduce((sum, s) => sum + s.end - s.start, 0);
  const db = [];
  let seg = 0, off = 0;
  for (let i = 0; i * step < duration - step / 2; i++) {
    const t = i * step;
    while (seg + 1 < kept.length && t >= off + kept[seg].end - kept[seg].start - step / 100) {
      off += kept[seg].end - kept[seg].start;
      seg++;
    }
    const sourceT = kept[seg].start + (t - off);
    const j = Math.min(source.length - 1, Math.max(0, Math.floor((sourceT + step / 100) / step)));
    db.push(Number.isFinite(source[j]) ? source[j] : -120);
  }
  return { step, db };
}

/** One ffmpeg pass: trim+concat the kept segments, optional audio clean-up, constant frame rate.
 *  hdr: convert BT.2020/HLG video to tagged BT.709 SDR (captions disappear in HyperFrames otherwise; see hdr.mjs). */
/**
 * Voice chain, in signal order: sum to mono (phone side mics add comb filtering), high-pass, spectral denoise, de-ess,
 * gentle compression, a limiter, then loudness to -16 LUFS (the delivered mix is normalized again to -14 at the end).
 * Studio sound (studio.mjs) denoises the voice with DeepFilterNet first and passes it in as `audioInput` with its own
 * chain (leveler + de-click instead of the spectral denoiser).
 */
export const VOICE_CHAIN = "pan=mono|c0=0.5*c0+0.5*c1,highpass=f=80,afftdn=nr=12:nf=-45:tn=1,deesser=i=0.4:m=0.5:f=0.5,acompressor=threshold=0.09:ratio=3:attack=10:release=150:makeup=2,alimiter=limit=0.89:attack=5:release=50,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=channel_layouts=stereo";

export async function applyCuts(input, segments, output, { hasAudio = true, cleanAudio = true, fps = 30, hdr = false, scaleTo = null, encoder = "auto", audioInput = null, voiceChain = VOICE_CHAIN, roomTone = null } = {}) {
  const parts = [];
  const maps = [];
  // audioInput: a denoised voice WAV on the source's timeline replaces the source's own audio track.
  const ain = audioInput ? "[1:a]" : "[0:a]";
  const cutDuration = segments.reduce((sum, s) => sum + s.end - s.start, 0);
  const useRoomTone = hasAudio && Number.isFinite(roomTone?.start) && Number.isFinite(roomTone?.end) && roomTone.end > roomTone.start && cutDuration > 0;
  segments.forEach((s, i) => {
    parts.push(`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) {
      const d = s.end - s.start;
      const f = Math.min(0.02, d / 4);
      parts.push(`${ain}atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${f}:curve=qsin,afade=t=out:st=${r3(d - f)}:d=${f}:curve=qsin[a${i}]`);
    }
    maps.push(hasAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  let fc = `${parts.join(";")};${maps.join("")}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[vcat]${hasAudio ? "[a]" : ""}`;
  // HDR (HLG/PQ, BT.2020) sources become tagged BT.709 SDR so the renderer composites captions normally.
  // Scale down to cover the canvas (never up): a 4K phone clip encodes and renders 4x faster at 1080p, and the
  // composer crops to the canvas anyway. A wider source keeps its full width for panning.
  const vf = [hdr ? SDR_FILTER : null, scaleTo ? `scale=${scaleTo.width}:${scaleTo.height}:force_original_aspect_ratio=increase:force_divisible_by=2` : null].filter(Boolean).join(",");
  fc += `;[vcat]${vf || "null"}[v]`;
  let audioOut = "[a]";
  if (useRoomTone) {
    const samples = Math.max(1, Math.floor((roomTone.end - roomTone.start) * 48000));
    fc += `;${ain}atrim=start=${roomTone.start}:end=${roomTone.end},asetpts=PTS-STARTPTS,aresample=48000,aloop=loop=-1:size=${samples},atrim=duration=${r3(cutDuration)},asetpts=PTS-STARTPTS,volume=-12dB[room];[a][room]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[abed]`;
    audioOut = "[abed]";
  }
  if (hasAudio && cleanAudio) {
    fc += `;${audioOut}${voiceChain}[ao]`;
    audioOut = "[ao]";
  }
  const common = [
    "-y", "-loglevel", "error", "-stats",
    "-i", input,
    ...(audioInput ? ["-i", audioInput] : []),
    "-filter_complex", fc,
    "-map", "[v]",
    ...(hasAudio ? ["-map", audioOut] : ["-an"]),
    "-fps_mode", "cfr", "-r", String(fps),
  ];
  const tail = [
    "-pix_fmt", "yuv420p",
    ...(hdr ? SDR_TAGS : []),
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : []),
    "-movflags", "+faststart",
    output,
  ];
  // The Apple hardware encoder is several times faster than libx264 for this intermediate; fall back if it is missing.
  const useHw = encoder === "videotoolbox" || (encoder === "auto" && process.platform === "darwin" && process.env.REEL_SW_ENCODE !== "1");
  try {
    if (useHw) {
      try {
        await run("ffmpeg", [...common, "-c:v", "h264_videotoolbox", "-q:v", "72", "-allow_sw", "1", ...tail], { quiet: true });
        return output;
      } catch (e) {
        if (encoder === "videotoolbox") throw e;
      }
    }
    await run("ffmpeg", [...common, "-c:v", "libx264", "-preset", "medium", "-crf", "18", ...tail]);
    return output;
  } catch (e) {
    if (!useRoomTone) throw e;
    warn("room tone: mix failed, cuts fade to silence as before");
    return applyCuts(input, segments, output, { hasAudio, cleanAudio, fps, hdr, scaleTo, encoder, audioInput, voiceChain, roomTone: null });
  }
}

/** Audio level every `step` seconds, in dBFS, from the first audio track (one ffmpeg pass, mono 16 kHz). */
export async function audioEnvelope(input, { step = 0.02 } = {}) {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = path.join(os.tmpdir(), `reel-env-${process.pid}-${Date.now()}.raw`);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "s16le", tmp]);
  try {
    const buf = fs.readFileSync(tmp);
    const n = Math.floor(16000 * step);
    const db = [];
    for (let off = 0; off + n * 2 <= buf.length; off += n * 2) {
      let sum = 0;
      for (let k = 0; k < n; k++) { const v = buf.readInt16LE(off + k * 2); sum += v * v; }
      const rms = Math.sqrt(sum / n) / 32768;
      db.push(rms > 0 ? 20 * Math.log10(rms) : -120);
    }
    return { step, db };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Never cut a sound. Transcript timings can be off by a few hundred ms (Whisper starts words early, Scribe has been
 * seen ending one early), so every silence gap is checked against the real audio level. Loud frames inside a gap are
 * kept: the cut shrinks to the longest quiet run, or is dropped when no run is long enough. Gaps that also remove a
 * filler, stutter or bad take are left alone (those cuts are meant to remove sound). The first and last gaps are
 * checked too, so a clipped opening word is not trimmed away.
 * Returns { cuts, restored } with segments, removed and keptDuration rebuilt.
 */
export function guardSilenceCuts(cuts, env, duration, { minLen = 0.12, margin = 0.04, minLoud = 0.08 } = {}) {
  const { step, db } = env;
  if (!db.length) return { cuts, restored: 0 };
  // Room noise is measured inside the planned gaps, not across the speech: that is where the floor matters.
  const gapDb = [];
  let tg = 0;
  for (const s of [...cuts.segments, { start: duration, end: duration }]) {
    for (let i = Math.floor(tg / step); i < Math.min(db.length, Math.floor(s.start / step)); i++) gapDb.push(db[i]);
    tg = s.end;
  }
  const sorted = (gapDb.length >= 10 ? gapDb : [...db]).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loudDb = Math.min(-30, Math.max(-48, floor + 12)); // a little above this recording's room noise
  // A sound counts only when it lasts: a breath or a click is a frame or two, a word is not.
  const minRun = Math.max(1, Math.round(minLoud / step));
  const loud = (t0, t1) => {
    const out = [];
    const i0 = Math.max(0, Math.floor(t0 / step)), i1 = Math.min(db.length, Math.ceil(t1 / step));
    let run = [];
    for (let i = i0; i <= i1; i++) {
      if (i < i1 && db[i] > loudDb) { run.push(i); continue; }
      if (run.length >= minRun) out.push(...run);
      run = [];
    }
    return out;
  };
  const intentional = cuts.removed.filter((r) => r.reason !== "silence");
  const touchesIntentional = (a, b) => intentional.some((r) => r.start < b && r.end > a);
  const segs = cuts.segments.map((s) => ({ ...s }));
  let restored = 0;

  // Leading and trailing silence: pull the first/last segment out to cover any sound.
  if (segs.length && segs[0].start > 0 && !touchesIntentional(0, segs[0].start)) {
    const hits = loud(0, segs[0].start);
    if (hits.length) { segs[0].start = r3(Math.max(0, hits[0] * step - margin)); restored++; }
  }
  const last = segs[segs.length - 1];
  if (last && last.end < duration && !touchesIntentional(last.end, duration)) {
    const hits = loud(last.end, duration);
    if (hits.length) { last.end = r3(Math.min(duration, (hits[hits.length - 1] + 1) * step + margin)); restored++; }
  }

  // Gaps between segments.
  const out = [segs[0]];
  for (let k = 1; k < segs.length; k++) {
    const prev = out[out.length - 1];
    const cur = segs[k];
    const g0 = prev.end, g1 = cur.start;
    const hits = g1 > g0 && !touchesIntentional(g0, g1) ? loud(g0, g1) : [];
    if (!hits.length) { out.push(cur); continue; }
    restored++;
    // Longest quiet run inside the gap.
    let best = null, runStart = null;
    const i0 = Math.floor(g0 / step), i1 = Math.ceil(g1 / step);
    for (let i = i0; i <= i1; i++) {
      const quiet = i < i1 && !(db[i] > loudDb);
      if (quiet && runStart == null) runStart = i;
      if (!quiet && runStart != null) {
        if (!best || i - runStart > best[1] - best[0]) best = [runStart, i];
        runStart = null;
      }
    }
    if (best && (best[1] - best[0]) * step - 2 * margin >= minLen) {
      prev.end = r3(Math.max(g0, best[0] * step + margin));
      cur.start = r3(Math.min(g1, best[1] * step - margin));
      out.push(cur);
    } else {
      prev.end = cur.end; // nothing quiet enough to cut: keep the whole gap
    }
  }

  const silences = [];
  let t = 0;
  for (const s of out) {
    if (s.start - t > 0.001) silences.push({ start: r3(t), end: s.start, reason: "silence" });
    t = s.end;
  }
  if (duration - t > 0.001) silences.push({ start: r3(t), end: r3(duration), reason: "silence" });
  const kept = out.reduce((acc, s) => acc + (s.end - s.start), 0);
  const planned = cuts.removed.filter((r) => r.reason === "silence").length;
  return {
    cuts: { ...cuts, segments: out, removed: [...intentional, ...silences].sort((a, b) => a.start - b.start), keptDuration: r3(kept) },
    restored,
    noisy: planned >= 4 && restored / planned > 0.5,
  };
}
