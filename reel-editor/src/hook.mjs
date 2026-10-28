function cleanHook(s) {
  return s.replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/\s+/g, " ").replace(/[,.;:\-]+$/, "").trim();
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
