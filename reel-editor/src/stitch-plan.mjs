import { findBadTakes } from "./cuts.mjs";

const token = (text) => String(text).toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}']/gu, "");
const fillers = new Set(["um", "uh", "uhm", "umm", "uhh", "erm", "hmm", "mm", "ah", "er", "mhm"]);
const heads = new Set(["ok", "okay", "alright", "go", ...fillers]);

const lcs = (x, y) => {
  let row = new Array(y.length + 1).fill(0);
  for (const t of x) {
    const next = [0];
    for (let j = 0; j < y.length; j++) next.push(t === y[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]));
    row = next;
  }
  return row[y.length];
};
const facts = (toks) => toks.filter((t) => /\d/.test(t) || ["not", "no", "never", "don't", "can't", "won't", "isn't"].includes(t)).join(" ");

/** Retakes are rarely word for word. Short lines must match exactly; from six words on, most of the longer
 * attempt's words must appear in order in the other. `facts` says when a number or a "not" changed. */
export function repeatedTake(a, b, { minShare = 0.7, minWords = 6 } = {}) {
  if (a.place !== b.place) return false;
  const toks = (c) => (c.ranges ? c.ranges.flatMap((r) => r.words) : c.words).map((w) => token(w.text)).filter((t) => t && !fillers.has(t));
  const x = toks(a), y = toks(b);
  if (Math.min(x.length, y.length) < 3) return false;
  const exact = x.length === y.length && x.every((t, i) => t === y[i]);
  if (exact) return { exact: true, factsDiffer: false };
  if (Math.max(x.length, y.length) < minWords || lcs(x, y) / Math.max(x.length, y.length) < minShare) return false;
  return { exact: false, factsDiffer: facts(x) !== facts(y) };
}

/** Same place when the median distance between the two clips' scene prints is under 17 (see backgroundFingerprint
 * for the measured gap). Missing prints never match, so an unreadable clip gets a place of its own. */
export function samePlace(a, b, { maxDistance = 17 } = {}) {
  if (!a?.length || !b?.length) return false;
  const distances = [];
  for (const x of a) for (const y of b) {
    if (!x.signature?.length || x.signature.length !== y.signature?.length) continue;
    distances.push(Math.sqrt(x.signature.reduce((sum, v, i) => sum + (v - y.signature[i]) ** 2, 0)));
  }
  if (!distances.length) return false;
  distances.sort((p, q) => p - q);
  return distances[Math.floor(distances.length / 2)] < maxDistance;
}

export function placeGroups(clips) {
  const representatives = [];
  return clips.map((clip) => {
    let n = representatives.findIndex((c) => samePlace(c.fingerprint, clip.fingerprint));
    if (n < 0) { n = representatives.length; representatives.push(clip); }
    let label = "", value = n + 1;
    while (value) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
    return { ...clip, place: label };
  });
}

/** Source ranges snap outwards so no retained word loses even part of a frame. */
export function keptRanges(clip) {
  const duration = clip.duration, words = clip.words.filter((w) => w.start >= 0 && w.start < duration && w.end > w.start).sort((a, b) => a.start - b.start);
  const drop = findBadTakes(words);
  // A recording that stops mid-word leaves "ex-" or "it's-" at the very end: drop it instead of holding the reel.
  // The half sentence before it goes too ("I know it's-"), back to the last finished sentence when there is one.
  let cut = words.length;
  while (cut > 0 && /[-–—]$/.test(words[cut - 1].text) && duration - words[cut - 1].end < 0.5) cut--;
  if (cut < words.length) {
    let end = cut;
    while (end > 0 && !/[.!?]["”']?$/.test(words[end - 1].text)) end--;
    if (end > 0) cut = end;
    for (let i = cut; i < words.length; i++) drop[i] = drop[i] || "cut off";
  }
  let first = 0;
  while (first < words.length && heads.has(token(words[first].text))) {
    const w = words[first], next = words[first + 1];
    if (token(w.text) === "go" && next && !/[.!?,]$/.test(w.text) && next.start - w.end < 0.25) break;
    drop[first++] = "filler head";
  }
  const kept = words.filter((_, i) => !drop[i]);
  if (!kept.length) return { ranges: [{ in: 0, out: Math.min(120, Math.ceil(duration * 30)) / 30, words: [] }], restarts: drop.filter(Boolean).length, fillers: 0 };
  const runs = [];
  for (let i = 0; i < words.length; i++) {
    if (drop[i]) continue;
    if (i === 0 || drop[i - 1] || !runs.length) runs.push([]);
    runs.at(-1).push(words[i]);
  }
  const ranges = runs.map((run) => {
    const start = run[0].start, end = Math.max(...run.map((w) => w.end));
    const before = words.filter((w, i) => drop[i] && w.end <= start).at(-1)?.end ?? 0;
    const after = words.find((w, i) => drop[i] && w.start >= end)?.start ?? duration;
    // If a discarded syllable shares an edge frame, retaining that frame wins over clipping a real word.
    const a = Math.max(0, Math.floor(Math.max(before, start - 0.15) * 30));
    const b = Math.min(Math.ceil(duration * 30), Math.ceil(Math.min(after, end + 0.35) * 30));
    return { in: a / 30, out: b / 30, words: run };
  });
  return { ranges, restarts: drop.filter(Boolean).length, fillers: kept.filter((w) => fillers.has(token(w.text))).length };
}

export function midWord(segment) {
  return segment.words.some((w) => (w.start < segment.in - 1e-7 && w.end > segment.in + 1e-7) || (w.start < segment.out - 1e-7 && w.end > segment.out + 1e-7)) || /[-–—]$/.test(segment.words.at(-1)?.text || "");
}

/** Pure planning only. Every word and source time comes from indexed real footage. */
export function planStitch(index) {
  const notes = [], held = [], prepared = placeGroups(index).map((clip) => ({ ...clip, ...keptRanges(clip) }));
  const selected = [];
  for (const clip of prepared) {
    if (clip.lowResolution) notes.push(`${clip.name}: The short side is under 720 pixels. An original copy may look clearer.`);
    const prior = selected.at(-1);
    if (prior && repeatedTake(prior, clip)) {
      const repeat = repeatedTake(prior, clip);
      // A reworded retake is the client's redo, so a changed number or "not" keeps the later take and says so.
      const earlierCleaner = !repeat.factsDiffer && prior.restarts + prior.fillers + 2 <= clip.restarts + clip.fillers;
      const removed = earlierCleaner ? clip : prior;
      notes.push(`${removed.name}: This looks like a retake of the clip next to it, so only ${earlierCleaner ? prior.name : clip.name} was used.${repeat.factsDiffer ? " The two takes say a number or a no differently. Check the later one is the one you want." : ""}`);
      if (earlierCleaner) continue;
      selected.pop();
    }
    selected.push(clip);
  }
  const segments = [];
  let frame = 0;
  for (const clip of selected) for (const range of clip.ranges) {
    const frames = Math.round((range.out - range.in) * 30);
    if (frames < 1) { held.push(`${clip.name} is too short to read.`); continue; }
    const previous = segments.at(-1);
    const segment = { clip: clip.file, key: clip.key, name: clip.name, in: range.in, out: range.out, words: range.words, place: clip.place, join: previous ? previous.place === clip.place ? "take" : "place" : "start", start: frame / 30, end: (frame + frames) / 30, frames };
    if (segment.join === "take" && (midWord(segment) || midWord(previous))) held.push(`The join at ${clip.name} cuts through a word. Leave a little space around the spoken line and try again.`);
    segments.push(segment); frame += frames;
  }
  if (!segments.some((s) => s.words.length)) held.push("None of these clips has speech. Add the talking clips and try again.");
  if (frame > 180 * 30) held.push("The stitched reel is over 180 seconds. Split these clips into two reel folders.");
  return { schemaVersion: 1, fps: 30, frames: frame, duration: frame / 30, segments, notes, held };
}

export function stitchScenes(timeline) {
  return timeline.segments.map(({ start, end, clip, place, join, words }) => ({ start, end, clip, place, join, ...(!words.length ? { silent: true } : {}) }));
}
