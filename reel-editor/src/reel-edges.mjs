import { sentenceLines, sentenceEnd } from "./moments.mjs";
import { r3 } from "./util.mjs";

const OPENING_FILLER = /^(and|so|but|like|um|uh|yeah|that's|which|because)$/i;
const CLEAR_OPENER = /^(?:(?:And|So|But)\s+(?:I|we|you|he|she|they|here|what|how|when|if|there)\b|Like (?:it or not|I said)\b|That's (?:how|why|when|what|the)\b)/;
const leadingWord = (text) => String(text).trim().replace(/^["'“‘([{]+/, "").replace(/’/g, "'");

function startsThought(words, index) {
  const first = leadingWord(words[index].text);
  const token = first.match(/^[\p{L}']+/u)?.[0] || first;
  if (OPENING_FILLER.test(token)) {
    const opening = [first, ...words.slice(index + 1, index + 5).map((w) => w.text)].join(" ");
    return CLEAR_OPENER.test(opening);
  }
  return !/^\p{Ll}/u.test(token) && !/[-—]$/.test(first);
}

export const spokenWords = (words = []) => words.filter((w) => !w.drop && /[\p{L}\p{N}]/u.test(w.text || ""));

export function cleanEdges(words, duration) {
  const speech = spokenWords(words);
  if (!speech.length) return { ok: false, detail: "No spoken words available to check the opening and ending." };
  const first = speech[0], last = speech.at(-1);
  const start = startsThought(speech, 0);
  const end = sentenceEnd(last.text) || r3(duration - last.end) >= 0.5;
  return {
    ok: start && end,
    detail: [
      `First word "${first.text}" at ${first.start}s${start ? "" : " reads as a continuation or filler"}.`,
      `Last word "${last.text}" at ${last.end}s${end ? "" : " ends without punctuation or a half-second pause"}.`,
    ].join(" "),
  };
}

/** Choose the nearest pair of clear boundaries that fits the clip and leaves existing windows intact. */
export function snapClipWindows(clips, words, duration, { min = 25, max = 105, pad = 0.25 } = {}) {
  const speech = spokenWords(words);
  const lines = sentenceLines(speech, { pause: 0.5, maxWords: Infinity });
  const starts = lines.filter(({ i0 }) => startsThought(speech, i0)).map(({ i0, start }) => ({
    index: i0,
    at: Math.max(0, start - pad, speech[i0 - 1]?.end ?? 0),
  }));
  const ends = lines.flatMap(({ i1, end }) => {
    const next = speech[i1 + 1]?.start ?? duration;
    const punctuated = sentenceEnd(speech[i1].text);
    if (!punctuated && r3(next - end) < 0.5) return [];
    return [{ index: i1, at: Math.min(next, duration, end + (punctuated ? pad : 0.5)) }];
  });
  if (!starts.length || !ends.length) return [];
  const accepted = [];
  for (const clip of clips) {
    let best = null;
    const byStart = starts.map((s) => ({ ...s, delta: Math.abs(s.at - clip.start) })).sort((a, b) => a.delta - b.delta);
    const byEnd = ends.map((e) => ({ ...e, delta: Math.abs(e.at - clip.end) })).sort((a, b) => a.delta - b.delta);
    for (const start of byStart) {
      if (best && start.delta + byEnd[0].delta >= best.delta) break;
      for (const end of byEnd) {
        const delta = start.delta + end.delta;
        if (best && delta >= best.delta) break;
        if (end.index < start.index || end.at - start.at < min || end.at - start.at > max) continue;
        if (accepted.some((c) => start.at < c.end && c.start < end.at)) continue;
        best = { start: r3(start.at), end: r3(end.at), delta };
        break;
      }
    }
    if (best) {
      const snapped = best.start !== clip.start || best.end !== clip.end;
      accepted.push({ ...clip, start: best.start, end: best.end, problems: [], ...(snapped ? { snapped: true } : {}) });
    }
  }
  return accepted;
}
