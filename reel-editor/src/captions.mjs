import { r3 } from "./util.mjs";

const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9&$']/g, "");

/** Strip emojis and trailing commas/periods. Keeps ? and ! because they carry tone. */
export function cleanText(t, { emojis = false } = {}) {
  let s = String(t);
  if (!emojis) s = s.replace(/[\p{Extended_Pictographic}️‍]/gu, "");
  return s.trim().replace(/[,.;:]+$/, "").trim();
}

/** Split a run of n words into lines of at most `per` words with balanced sizes (7 -> 3/2/2, not 3/3/1). */
export function balancedSplit(run, per) {
  const n = run.length;
  if (n <= per) return [run];
  const lines = Math.ceil(n / per);
  const base = Math.floor(n / lines);
  let extra = n % lines;
  const out = [];
  let i = 0;
  for (let l = 0; l < lines; l++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    out.push(run.slice(i, i + size));
    i += size;
  }
  return out;
}

/**
 * Group words into caption lines. A run ends at a sentence end or a pause longer than maxGap;
 * each run is split into balanced lines of at most wordsPerLine words.
 * Returns [{ words:[{text,start,end,key?}], start, end, text }].
 */
export function groupWords(words, duration, { wordsPerLine = 3, maxGap = 0.7, emojis = false } = {}) {
  const runs = [];
  let run = [];
  for (const w of words) {
    const text = cleanText(w.text, { emojis });
    if (!text) continue;
    if (run.length && w.start - run[run.length - 1].end > maxGap) {
      runs.push(run);
      run = [];
    }
    run.push({ text, start: w.start, end: w.end });
    if (/[.!?]$/.test(w.text.trim())) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  const groups = runs.flatMap((r) => balancedSplit(r, Math.max(1, wordsPerLine))).map((ws) => ({ words: ws }));

  groups.forEach((g, i) => {
    const next = groups[i + 1];
    const first = g.words[0];
    const last = g.words[g.words.length - 1];
    g.start = r3(Math.max(0, first.start - 0.05));
    const limit = next ? Math.max(0, next.words[0].start - 0.05) : duration;
    g.end = r3(Math.min(limit, last.end + 0.6));
    if (g.end - g.start < 0.3) g.end = r3(Math.min(limit, g.start + 0.3));
    g.text = g.words.map((w) => w.text).join(" ");
  });
  for (let i = 0; i + 1 < groups.length; i++) if (groups[i].end > groups[i + 1].start) groups[i].end = groups[i + 1].start;
  return groups.filter((g) => g.end > g.start);
}

/**
 * Mark highlight words per line: dictionary terms first (multi-word terms highlight every word),
 * then numbers / dollar amounts / power words. At most maxPerLine highlights unless a term is longer.
 */
export function markKeywords(groups, dict = {}, { maxPerLine = 1 } = {}) {
  const terms = (dict.terms || []).map((t) => t.toLowerCase().split(/\s+/).map(norm)).filter((t) => t.length && t[0]).sort((a, b) => b.length - a.length);
  const power = new Set((dict.powerWords || []).map(norm));
  for (const g of groups) {
    if (maxPerLine <= 0) continue;
    const toks = g.words.map((w) => norm(w.text));
    let marked = 0;
    for (let i = 0; i < toks.length && marked < maxPerLine; i++) {
      for (const term of terms) {
        const k = term.length;
        if (i + k > toks.length) continue;
        let ok = true;
        for (let j = 0; j < k; j++) if (toks[i + j] !== term[j]) { ok = false; break; }
        if (!ok) continue;
        for (let j = 0; j < k; j++) g.words[i + j].key = true;
        marked++;
        i += k - 1;
        break;
      }
    }
    if (marked) continue;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (/^\$?\d/.test(t) || /\$/.test(g.words[i].text) || power.has(t)) {
        g.words[i].key = true;
        break;
      }
    }
  }
  return groups;
}
