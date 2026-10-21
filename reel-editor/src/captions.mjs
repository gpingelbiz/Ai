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

// Fallback keyword picker for lines with no dictionary term, number or power word. Real speech rarely
// says a framework name, so without this most reels get no gold at all.
const NUM_WORDS = new Set("one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty hundred thousand million billion half double triple first second third last".split(" "));
const UNIT_WORDS = new Set("second seconds minute minutes hour hours day days week weeks month months year years times percent dollars bucks calls clients leads deals".split(" "));
const STOP_WORDS = new Set(("a an the and or but so because if then than that this these those there here what when where which who whom whose why how " +
  "i i'm i've i'll i'd me my mine you you're you've you'll your yours he she it it's its we we're our they they're their them us " +
  "is are was were be been being am do does did done don't doesn't didn't have has had having can can't could would should will won't shall may might must " +
  "to of in on at for with from by about into over under up down out off again just really very also too only even still like oh hey man yeah okay ok um uh " +
  "going gonna wanna gotta get got go goes went thing things something anything everything nothing someone anyone everyone stuff kind sort " +
  "know think mean said say says saying tell told want wanted need let let's make made take took come came look see feel " +
  "actually basically literally probably maybe right well now then much many more most some any all every each other another same").split(" "));

/** Best automatic pick in one line: a number + unit pair ("three minutes"), a number word, or a strong 6+ letter word. */
export function autoKeyword(words) {
  const toks = words.map((w) => norm(w.text));
  let best = null;
  const consider = (i, len, score) => { if (!best || score > best.score) best = { i, len, score }; };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t) continue;
    if (NUM_WORDS.has(t) && UNIT_WORDS.has(toks[i + 1] || "")) consider(i, 2, 5);
    else if (NUM_WORDS.has(t)) consider(i, 1, 3);
    else if (!STOP_WORDS.has(t) && t.replace(/'/g, "").length >= 6) consider(i, 1, 2 + Math.min(t.length, 10) / 100);
  }
  return best;
}

/** Gold keywords: dictionary terms first, then numbers and power words, then (auto) the autoKeyword pick.
 *  Auto picks skip a line right after another auto pick and a word already auto-picked earlier in the clip,
 *  except number + unit pairs, so the gold stays rare enough to mean something. */
export function markKeywords(groups, dict = {}, { maxPerLine = 1, auto = false } = {}) {
  // phrases highlight like terms but are not sent to Whisper as spelling hints (a hint can change what it hears).
  const terms = [...(dict.terms || []), ...(dict.phrases || [])].map((t) => t.toLowerCase().split(/\s+/).map(norm)).filter((t) => t.length && t[0]).sort((a, b) => b.length - a.length);
  const power = new Set((dict.powerWords || []).map(norm));
  const usedAuto = new Set();
  let prevAuto = false;
  for (const g of groups) {
    if (maxPerLine <= 0) continue;
    const wasAuto = prevAuto;
    prevAuto = false;
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
        marked++;
        break;
      }
    }
    if (marked || !auto) continue;
    const pick = autoKeyword(g.words);
    if (!pick || pick.score < 2) continue;
    const word = toks.slice(pick.i, pick.i + pick.len).join(" ");
    if (pick.score < 5 && (wasAuto || usedAuto.has(word))) continue;
    for (let j = pick.i; j < pick.i + pick.len; j++) g.words[j].key = true;
    usedAuto.add(word);
    prevAuto = true;
  }
  return groups;
}
