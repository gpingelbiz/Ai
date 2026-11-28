import { createRequire } from "node:module";
import { cleanText, autoKeyword } from "./captions.mjs";
import { norm } from "./text.mjs";
import { r3 } from "./util.mjs";
import { zoneFor, centredWidth } from "./safe-zone.mjs";

// The pro plates are centred. Captions sit in the right button column's rows, so a plate is at most as wide as the
// frame minus the column on both sides (720 px at 1080x1920); the hook title sits above those rows and only keeps
// clear of the 150 px side strips (780 px). Both plates have 24 px of padding each side.
const PRO_ZONE = zoneFor(1080, 1920);
export const PRO_PAD = 24;
export const PRO_CAPTION_PLATE = centredWidth(PRO_ZONE, PRO_ZONE.railTop, PRO_ZONE.bottom);
export const PRO_CAPTION_LINE = PRO_CAPTION_PLATE - 2 * PRO_PAD;
export const PRO_HOOK_PLATE = centredWidth(PRO_ZONE, 0, PRO_ZONE.railTop);
export const PRO_HOOK_LINE = PRO_HOOK_PLATE - 2 * PRO_PAD;
/** The lowest a pro caption plate may reach: where the platforms' bottom strip starts. */
export const PRO_CAPTION_FLOOR = PRO_ZONE.bottom;

const NEGATIONS = new Set("not never no without don't doesn't didn't can't cannot won't wouldn't shouldn't couldn't isn't aren't wasn't weren't".split(" "));
const NUMBERS = new Set("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion point half double triple".split(" "));
const UNITS = new Set("percent dollars bucks times seconds minutes hours days weeks months years calls clients leads deals".split(" "));
const GLUE = new Set("a an the of to in on at for with from by your my our their and or but".split(" "));
const ACTION = new Set("stop start pause listen respond understand slow fast lose win ask tell change replace instead but never not".split(" "));

/** Use the shipped font, including its actual variable weight; estimates can silently create a third line. */
export function loadProMeasure(file, { size = 80, weight = 700, tracking = -0.8 } = {}) {
  const fontkit = createRequire(import.meta.url)("fontkit");
  const base = fontkit.openSync(file);
  const font = base.variationAxes?.wght ? base.getVariation({ wght: weight }) : base;
  return (text) => font.layout(String(text)).advanceWidth * size / font.unitsPerEm + [...String(text)].length * tracking;
}

function blockedBreaks(words, protectedPhrases = []) {
  const toks = words.map((w) => norm(String(w.rawText ?? w.text).replace(/’/g, "'")));
  const blocked = new Set();
  for (let i = 1; i < words.length; i++) {
    const a = toks[i - 1], b = toks[i];
    const number = (t) => NUMBERS.has(t) || /^\$?\d/.test(t);
    if (NEGATIONS.has(a) || (NEGATIONS.has(b) && /^(do|does|did|can|could|would|should|is|are|was|were|will|have|has)$/.test(a))) blocked.add(i);
    if (number(a) && (number(b) || UNITS.has(b))) blocked.add(i);
    if ((number(a) && b === "and" && number(toks[i + 1])) || (a === "and" && number(b) && number(toks[i - 2]))) blocked.add(i);
  }
  for (const phrase of protectedPhrases) {
    const parts = String(phrase).split(/\s+/).map(norm);
    if (parts.length < 2 || parts.length > 6) continue;
    for (let i = 0; i + parts.length <= toks.length; i++) {
      if (parts.every((t, j) => t === toks[i + j])) for (let j = 1; j < parts.length; j++) blocked.add(i + j);
    }
  }
  return blocked;
}

/** Fixed-size, balanced lines. Null asks the phrase splitter to use fewer words, never smaller type. */
export function proLineBreaks(words, { measure, maxWidth = PRO_CAPTION_LINE, protectedPhrases = [] } = {}) {
  const width = (ws) => measure(ws.map((w) => w.text).join(" "));
  if (!words.length) return [];
  if (width(words) <= maxWidth) return [words];
  const blocked = blockedBreaks(words, protectedPhrases);
  let best = null;
  for (const relaxed of [false, true]) {
    for (let i = 1; i < words.length; i++) {
      if (blocked.has(i) && !relaxed) continue;
      const lines = [words.slice(0, i), words.slice(i)];
      const widths = lines.map(width);
      if (widths.some((w) => w > maxWidth)) continue;
      const score = Math.abs(widths[0] - widths[1]) + (GLUE.has(norm(words[i - 1].text)) ? 300 : 0);
      if (!best || score < best.score) best = { score, lines };
    }
    // An oversized number may wrap inside the same cue, but never split across caption replacements.
    if (best) break;
  }
  return best?.lines ?? null;
}

/**
 * A single word wider than the caption line ("disproportionately", IMG_4766 Nov 27): it gets a cue of its own at a
 * smaller size (down to 55%), or, longer still, splits across two lines with a hyphen at the size that fits. Returns
 * { words, lines, fontScale } or null when it already fits.
 */
export function longWordCue(word, { measure, maxWidth = PRO_CAPTION_LINE, minScale = 0.55 } = {}) {
  const width = measure(word.text);
  if (!(width > maxWidth)) return null;
  const scale = Math.floor((maxWidth / width) * 100) / 100;
  if (scale >= minScale) return { words: [word], lines: [1], fontScale: scale };
  const t = String(word.text), mid = Math.floor(t.length / 2);
  let best = null;
  for (let d = 0; d < mid - 1; d++) for (const k of [mid - d, mid + d]) {
    if (best || k < 3 || t.length - k < 3) continue;
    const a = `${t.slice(0, k)}-`, b = t.slice(k);
    const fit = Math.min(1, Math.floor((maxWidth / Math.max(measure(a), measure(b))) * 100) / 100);
    best = { words: [{ ...word, text: a }, { ...word, text: b }], lines: [1, 1], ...(fit < 1 ? { fontScale: fit } : {}) };
  }
  return best || { words: [word], lines: [1], fontScale: scale };
}

/** All retained words, ordered by meaning and timing. Word times remain the source of truth. */
export function splitProPhrases(words, duration, { measure, protectedPhrases = [] } = {}) {
  const runs = [];
  let run = [];
  for (const word of words) {
    const text = cleanText(word.text);
    if (!text || word.start >= duration || word.end <= 0) continue;
    if (run.length && word.start - run.at(-1).end > 0.65) { runs.push(run); run = []; }
    run.push({ ...word, text, rawText: word.text, start: Math.max(0, word.start), end: Math.min(duration, word.end), key: false });
    if (/[.!?]["'”’)]*$/.test(word.text.trim())) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  const groups = [];
  runs.forEach((ws, thought) => {
    const blocked = blockedBreaks(ws, protectedPhrases);
    const states = new Map([[ws.length, { score: 0, cues: [] }]]);
    for (let i = ws.length - 1; i >= 0; i--) {
      if (i && blocked.has(i)) continue;
      let best = null;
      for (let j = i + 1; j <= Math.min(ws.length, i + 6); j++) {
        if (!states.has(j) || blocked.has(j)) continue;
        let slice = ws.slice(i, j);
        let lines = proLineBreaks(slice, { measure, protectedPhrases });
        let fontScale = null;
        if (!lines && slice.length === 1) {
          const long = longWordCue(slice[0], { measure });
          if (long) { slice = long.words; lines = long.lines.map((n, k) => long.words.slice(k, k + n)); fontScale = long.fontScale ?? null; }
        }
        if (!lines) continue;
        const start = r3(slice[0].start);
        const next = j < ws.length ? ws[j].start : runs[thought + 1]?.[0].start ?? duration;
        const contiguous = next - slice.at(-1).end <= 0.2;
        const end = r3(Math.min(duration, next, j < ws.length || contiguous ? next : Math.max(slice.at(-1).end, start + 0.8)));
        const d = end - start;
        const timing = d < 0.8 ? (0.8 - d) * 8 : d > 1.3 ? (d - 1.3) * 5 : Math.abs(d - 1.05);
        const boundary = /[,;:]$/.test(slice.at(-1).rawText) ? -0.8 : 0;
        const score = states.get(j).score + timing + (d < 0.5 ? 8 : 0) + (slice.length === 1 ? 5 : slice.length === 6 ? 1.5 : 0) + (GLUE.has(norm(slice.at(-1).text)) ? 3 : 0) + boundary + 0.15;
        const cue = { words: slice.map((w) => ({ ...w })), text: slice.map((w) => w.text).join(" "), start, end, thought, lines: lines.map((line) => line.length), ...(fontScale ? { fontScale } : {}), ...(d < 0.5 ? { flags: ["short-cue"] } : {}) };
        if (!best || score < best.score) best = { score, cues: [cue, ...states.get(j).cues] };
      }
      if (best) states.set(i, best);
    }
    // Nothing in the house layout fits (a protected phrase wider than the line, say): one word per cue, each at the
    // size that fits. The reel is never failed for its captions.
    if (!states.has(0)) {
      ws.forEach((w, k) => {
        const long = longWordCue(w, { measure });
        const end = r3(Math.min(duration, ws[k + 1]?.start ?? Math.max(w.end, w.start + 0.5)));
        const cueWords = long ? long.words : [w];
        groups.push({ words: cueWords.map((x) => ({ ...x })), text: cueWords.map((x) => x.text).join(" "), start: r3(w.start), end, thought, lines: long ? long.lines : [1], ...(long?.fontScale ? { fontScale: long.fontScale } : {}), flags: ["fallback"] });
      });
      return;
    }
    groups.push(...states.get(0).cues);
  });
  return groups;
}

export function proGoldBudget(duration) {
  return duration > 0 ? Math.min(8, Math.max(1, Math.round(5 * duration / 30))) : 0;
}

/** One operative word per cue, spread across the reel; dictionary phrases never paint whole sentences gold. */
export function markProKeywords(groups, duration, dict = {}) {
  const out = groups.map((g) => ({ ...g, words: g.words.map((w) => ({ ...w, key: false })) }));
  const power = new Set([...(dict.powerWords || []), ...(dict.terms || []), ...(dict.candidates || [])].flatMap((s) => String(s).split(/\s+/).map(norm)));
  const candidates = out.flatMap((g, gi) => {
    const automatic = autoKeyword(g.words);
    const ranked = g.words.map((w, wi) => ({ gi, wi, token: norm(w.text), score: (ACTION.has(norm(w.text)) ? 10 : 0) + (power.has(norm(w.text)) ? 6 : 0) + (automatic?.i === wi ? automatic.score : 0) })).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
    return ranked.length ? [ranked[0]] : [];
  });
  const budget = proGoldBudget(duration);
  for (let slot = 0; slot < budget; slot++) {
    const a = slot * duration / budget, b = (slot + 1) * duration / budget;
    const pick = candidates.filter((c) => out[c.gi].start >= a && out[c.gi].start < b).sort((x, y) => y.score - x.score)[0];
    if (pick) out[pick.gi].words[pick.wi].key = true;
  }
  return out;
}

/** A thought has one anchor, even when its cues wrap differently. The plate's bottom can only move upward. */
export function placeProCaptions(groups, heads = [], { height = 1920, base: baseFraction = 1248 / 1920 } = {}) {
  // Greg 11-24 "Why are the captions over my face": the old rule lifted a thought's captions above the chin whenever
  // any sampled chin dipped below the plate, which put them on the face. Now a thought keeps y=1248 when every
  // sampled face clears it; otherwise it drops below the lowest chin if that still fits above the bottom safe line,
  // else it goes above the highest head top; if neither fits it sits as low as allowed, never between top and chin.
  const scale = height / 1920;
  const positions = new Map();
  // base: the usual plate height (y=1248); reel proof sets it lower so the supplied texts get the room above.
  const base = baseFraction * height, bottomSafe = PRO_CAPTION_FLOOR * scale, topSafe = 420 * scale, gap = 56 * scale;
  for (const g of groups) {
    if (positions.has(g.thought)) continue;
    const related = groups.filter((other) => other.thought === g.thought);
    const start = related[0].start, end = related.at(-1).end;
    const faces = heads.filter((h) => h.t >= start && h.t <= end && Number.isFinite(h.chin))
      .map((h) => ({ chin: h.chin * height, top: Number.isFinite(h.top) ? h.top * height : (h.chin - 0.2) * height }));
    const plateHeight = Math.max(...related.map((h) => h.lines?.length || 1)) * 92 * scale + 24 * scale;
    let y = base;
    if (faces.length) {
      const lowestChin = Math.max(...faces.map((f) => f.chin)), highestTop = Math.min(...faces.map((f) => f.top));
      if (base < lowestChin + gap) {
        const below = lowestChin + gap, above = highestTop - gap - plateHeight;
        if (below + plateHeight <= bottomSafe) y = below;
        else if (above >= topSafe) y = above;
        else y = bottomSafe - plateHeight;
      }
    }
    positions.set(g.thought, r3(Math.max(0, y)));
  }
  return groups.map((g) => ({ ...g, y: positions.get(g.thought) }));
}
