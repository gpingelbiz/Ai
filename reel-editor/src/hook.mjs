import { fitBlockHook, hookBlockHeight, BLOCK_HOOKS } from "./placement.mjs";
import { proLineBreaks } from "./pro-captions.mjs";
import { norm } from "./text.mjs";

/** A single readable title; long supplied titles are shortened at word boundaries at the same type size. */
export function planProHook(words, { text, duration = 2.4, reelDuration, measure } = {}) {
  const source = pickHook(words, { text, maxWords: 12 });
  if (!source) return null;
  const all = source.text.replace(/\*/g, "").split(/\s+/).map((text) => ({ text }));
  const weak = /^(a|an|the|to|of|in|on|at|for|with|from|by|and|or|but|your|my|our|their|his|her|its|not|never|no|without|\d+)$/i;
  // Keep the whole title: step the size down (100, 88, 80 px on 1080x1920; measure is at 108) before dropping words.
  for (const px of [100, 88, 80]) {
    const lines = proLineBreaks(all, { measure, maxWidth: 768 * 108 / px });
    if (lines && !weak.test(all.at(-1).text)) return { text: all.map((w) => w.text).join(" "), words: all, lines: lines.map((line) => line.length), fontSize: px, start: 0, duration: Math.min(reelDuration, Math.max(2, Math.min(2.7, Number(duration) || 2.4))) };
  }
  const tokens = [...all];
  while (tokens.length) {
    const lines = proLineBreaks(tokens, { measure, maxWidth: 768 * 108 / 80 });
    if (lines && !weak.test(tokens.at(-1).text)) {
      return { text: tokens.map((w) => w.text).join(" "), words: tokens, lines: lines.map((line) => line.length), fontSize: 80, start: 0, duration: Math.min(reelDuration, Math.max(2, Math.min(2.7, Number(duration) || 2.4))) };
    }
    tokens.pop();
  }
  throw new Error("pro hook cannot fit at 108 px; supply a shorter title");
}

/** The title itself carries duplicated opening words. Unrelated speech retains its caption. */
export function proCaptionsUnderHook(groups, hook, { measure } = {}) {
  if (!hook) return groups;
  const title = hook.words.map((w) => norm(w.text));
  const spoken = groups.flatMap((g) => g.words);
  const offset = spoken.findIndex((word, i) => word.start < hook.duration && title.every((t, j) => norm(spoken[i + j]?.text || "") === t));
  if (offset < 0) return groups;
  const hidden = new Set(spoken.slice(offset, offset + title.length).filter((w) => w.start < hook.duration));
  return groups.flatMap((g) => {
    const words = g.words.filter((w) => !hidden.has(w) || w.end > hook.duration);
    if (!words.length) return [];
    const start = hidden.has(words[0]) ? hook.duration : Math.max(g.start, words[0].start);
    const lines = proLineBreaks(words, { measure }) || [words];
    return [{ ...g, words, text: words.map((w) => w.text).join(" "), start, lines: lines.map((line) => line.length), ...(g.end - start < 0.5 ? { flags: ["short-cue"] } : {}) }];
  });
}

function cleanHook(s) {
  return s.replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/\s+/g, " ").replace(/[,.;:\-]+$/, "").trim();
}

/** Face-safe geometry for the solid house hook plaque. Null means there was no usable head measurement. */
export function plaqueLayout(words, options = {}) {
  const fit = fitBlockHook(words, { ...options, treat: "plaque" });
  if (!fit) return null;
  // Older block treatments express position at their text anchor. The plaque
  // is absolutely positioned from its top edge, so expose that coordinate.
  const above = { ...fit, position: fit.position - 1.2 * fit.fontSizeFrac, zone: "above" };
  // A head high in the frame leaves a thin band above it, and squeezing the plaque in there made a 12-word hook
  // unreadable on a phone (2026-10-30 real re-cut). When the text would drop below 85% or still not clear the head,
  // put the plaque at full size between the chin and the captions instead, if it fits there.
  const { headBottom, captionTop, fontSizeFrac, W = 1080, H = 1920, gap = 0.015 } = options;
  if (fit.fits && fit.fontSizeFrac >= fontSizeFrac * 0.85) return above;
  if (!(headBottom > 0) || !(captionTop > 0)) return above;
  const block = BLOCK_HOOKS.plaque;
  const h = hookBlockHeight(words, { W, H, fontPx: Math.round(fontSizeFrac * H * block.em), charEm: block.charEm, lineHeight: block.lineHeight, padEm: block.padEm, goldScale: 1 });
  const top = headBottom + gap;
  if (top + h > captionTop - gap) return above;
  return { fontSizeFrac, position: Math.round(top * 1000) / 1000, fits: true, zone: "below" };
}

/**
 * The plaque beside the head on a wide (16:9) canvas. A head near the top of a wide frame leaves a band above it
 * that squeezed the plaque to a quarter of its size (Greg's VSL, 2026-11-04), while the wall beside the speaker sat
 * empty. This puts the plaque on the roomier side, at up to `grow` times the preset size on at most `maxLines` lines,
 * centred on the face and ending above the chin. Null when the canvas is not wide or neither side has the room.
 * left/right are the plaque's edges as fractions of the width from the left and right sides.
 */
export function sidePlaqueLayout(words, { headLeft, headRight, headTop, headBottom, fontSizeFrac, W = 1920, H = 1080, margin = 0.05, gap = 0.035, top = 0.06, maxLines = 3, grow = 1.4, minWidth = 0.24 } = {}) {
  if (!(W > H) || !(headRight > headLeft) || !(headBottom > headTop) || !(fontSizeFrac > 0)) return null;
  const room = { left: headLeft - gap - margin, right: 1 - margin - headRight - gap };
  const side = room.right >= room.left ? "right" : "left";
  const width = room[side];
  if (width < minWidth) return null;
  const block = BLOCK_HOOKS.plaque;
  const r = (x) => Math.round(x * 1000) / 1000;
  for (let frac = fontSizeFrac * grow; frac >= fontSizeFrac * 0.8; frac *= 0.94) {
    const fontPx = Math.round(frac * H * block.em);
    // The plaque's side padding (0.38 em each side) comes out of the width the words wrap in.
    const h = hookBlockHeight(words, { W, H, fontPx, widthFrac: width - (0.8 * fontPx) / W, charEm: block.charEm, lineHeight: block.lineHeight, padEm: block.padEm, goldScale: 1 });
    const lines = Math.round((h * H - block.padEm * fontPx) / (fontPx * block.lineHeight));
    const blockTop = Math.max(top, Math.min((headTop + headBottom) / 2 - h / 2, headBottom - h));
    if (lines > maxLines || blockTop < top - 1e-6 || blockTop + h > headBottom + 1e-6) continue;
    const left = side === "left" ? margin : headRight + gap;
    return { side, fontSizeFrac: r(frac), position: r(blockTop), left: r(left), right: r(1 - left - width), lines, zone: "side" };
  }
  return null;
}

/** How long the hook stays up: hook.duration seconds, or the whole reel for "reel" (one-line reels). */
export function hookSeconds(setting, reel) {
  if (setting === "reel") return reel;
  const s = Number(setting);
  return Math.min(Number.isFinite(s) && s > 0 ? s : 3, reel);
}

/**
 * Hook title for the first seconds. Pass text for an AI-written hook; otherwise the opening phrase is used
 * (up to maxWords, cut at the first sentence end once 3 words are in).
 */
export function pickHook(words, { text, maxWords = 8, duration = 3, start = 0 } = {}) {
  if (text) return { text: cleanHook(text), start, duration };
  const early = words.filter((w) => w.start < 8).slice(0, maxWords + 4);
  const picked = [];
  for (const w of early) {
    picked.push(w.text);
    if (picked.length >= 3 && /[.!?]$/.test(w.text.trim())) break;
    if (picked.length >= maxWords) break;
  }
  if (picked.length < 3) return null;
  const t = cleanHook(picked.join(" "));
  return t ? { text: t, start, duration, auto: true } : null;
}

/** Pop-up call to action. Defaults to the last `last` seconds; `start`/`duration` override. */
export function pickCta(duration, { text, last = 3, start = null, duration: dur = null, style = "pill", position = 0.62, uppercase = true } = {}) {
  if (!text) return null;
  const d = Math.min(dur ?? last, duration);
  const s = start != null ? Math.max(0, Math.min(start, duration - 0.3)) : Math.max(0, duration - d);
  const clean = cleanHook(text);
  return { text: uppercase ? clean.toUpperCase() : clean, start: Math.round(s * 1000) / 1000, duration: Math.round(Math.min(d, duration - s) * 1000) / 1000, style, position };
}
