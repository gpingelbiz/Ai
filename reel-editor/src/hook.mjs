function cleanHook(s) {
  return s.replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/\s+/g, " ").replace(/[,.;:\-]+$/, "").trim();
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
