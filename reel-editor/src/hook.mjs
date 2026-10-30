import { fitBlockHook, hookBlockHeight, BLOCK_HOOKS } from "./placement.mjs";

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
