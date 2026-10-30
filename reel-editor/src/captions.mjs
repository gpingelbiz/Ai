import { r3, warn } from "./util.mjs";

import { norm } from "./text.mjs";

/** Accent text is the established default; a house system can keep emphasis typographic on raw footage. */
export const keywordColorOnFootage = (settings = {}) => settings.keywordColorOnFootage !== false;

/** Strip emojis and trailing commas/periods. Keeps ? and ! because they carry tone. */
export function cleanText(t, { emojis = false } = {}) {
  let s = String(t);
  if (!emojis) s = s.replace(/[\p{Extended_Pictographic}️‍]/gu, "");
  // Quotation marks (Scribe quotes reported speech) read as stray marks on a 3-word caption line.
  s = s.replace(/["“”„«»]/g, "");
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

const BREAK_START = new Set(["and", "or", "but", "so", "because", "when", "if", "that", "then", "while", "although", "unless", "until", "yet", "after", "before", "once", "without", "with", "from", "in", "on", "at", "for", "to"]);
const ATTACHED_START = new Set(["of", "than", "as", "your", "my", "our", "their", "his", "her", "its"]);

const rawText = (w) => String(w.rawText ?? w.text ?? "").trim();

function protectedBoundaries(run, phrases) {
  const blocked = new Set();
  const toks = run.map((w) => norm(rawText(w)));
  const list = phrases instanceof Set ? [...phrases] : Array.isArray(phrases) ? phrases : [];
  for (const value of list) {
    const phrase = (Array.isArray(value) ? value : String(value).split(/\s+/)).map(norm).filter(Boolean);
    if (phrase.length < 2) continue;
    for (let i = 0; i + phrase.length <= toks.length; i++) {
      if (!phrase.every((t, j) => toks[i + j] === t)) continue;
      for (let j = 1; j < phrase.length; j++) blocked.add(i + j);
    }
  }
  return blocked;
}

/**
 * Split at the strongest phrase boundaries, adding a line only when a strong signal or display penalty earns it.
 * The ordered regrouping idea comes from stable-ts (MIT); this is a small independent scoring implementation.
 */
export function phraseSplit(run, per, { maxChars = 22, protectedPhrases = new Set() } = {}) {
  const n = run.length;
  const limit = Math.max(1, Math.floor(per) || 1);
  if (n <= limit) return n ? [run] : [];
  const minLines = Math.ceil(n / limit);
  const blocked = protectedBoundaries(run, protectedPhrases);

  const boundaryScore = (at) => {
    if (at >= n) return 0;
    const prev = run[at - 1], next = run[at];
    const raw = rawText(prev);
    const gap = Number.isFinite(next.start) && Number.isFinite(prev.end) ? Math.max(0, next.start - prev.end) : 0;
    let score = 0;
    if (/[.!?][\])}'\"”’]*$/.test(raw)) score += 4000;
    if (gap >= 0.7) score += 1200;
    else if (gap >= 0.35) score += 800;
    else if (gap >= 0.2) score += 400;
    if (/[,;:–—-][\])}'\"”’]*$/.test(raw)) score += 250;
    if (BREAK_START.has(norm(rawText(next)))) score += 120;
    if (blocked.has(at)) score -= 5000;
    return score;
  };

  const lineScore = (start, end) => {
    const line = run.slice(start, end);
    const chars = line.map(rawText).join(" ").length;
    let score = 0;
    if (chars > maxChars) score -= 400 + (chars - maxChars) * 40;
    if (GLUE.has(norm(rawText(line[line.length - 1])))) score -= 700;
    if (ATTACHED_START.has(norm(rawText(line[0])))) score -= 220;
    if (line.length === 1) {
      const word = line[0];
      if (norm(rawText(word)).length < 10 && !word.key && !word.keyword) score -= 1400;
    }
    return score;
  };

  let best = null;
  for (let lineCount = minLines; lineCount <= n; lineCount++) {
    const base = Math.floor(n / lineCount), extra = n % lineCount;
    const desired = Array.from({ length: lineCount }, (_, i) => base + (i < extra ? 1 : 0));
    let states = new Map([[0, { score: -(lineCount - minLines) * 1600, balance: 0, lines: [] }]]);
    for (let l = 0; l < lineCount; l++) {
      const nextStates = new Map();
      for (const [start, state] of states) {
        const remainLines = lineCount - l - 1;
        const minEnd = start + 1;
        const maxEnd = Math.min(start + limit, n - remainLines);
        for (let end = minEnd; end <= maxEnd; end++) {
          const remain = n - end;
          if (remain < remainLines || remain > remainLines * limit) continue;
          const candidate = {
            score: state.score + lineScore(start, end) + boundaryScore(end),
            balance: state.balance + Math.abs(end - start - desired[l]),
            lines: [...state.lines, run.slice(start, end)],
          };
          const old = nextStates.get(end);
          if (!old || candidate.score > old.score || (candidate.score === old.score && candidate.balance < old.balance)) nextStates.set(end, candidate);
        }
      }
      states = nextStates;
    }
    const candidate = states.get(n);
    if (candidate && (!best || candidate.score > best.score || (candidate.score === best.score && candidate.balance < best.balance))) best = candidate;
  }
  return best?.lines || balancedSplit(run, limit);
}

// Words a line should not start or end on: a line that reads "OR A" or ends on "the" is a fragment, not a thought.
const GLUE = new Set(["a", "an", "the", "or", "and", "but", "of", "to", "in", "on", "at", "for", "with", "from", "by", "as", "than", "so", "if", "that", "your", "my", "our", "their", "his", "her", "its"]);
const isGlue = (w) => GLUE.has(norm(w.text));

/**
 * Keep phrases whole: a line made only of glue words joins the next line, and a line ending on a glue word hands
 * that word to the next line ("a bad number or | a bad month" becomes "a bad number | or a bad month"). A line may
 * grow to `max` + 1 words rather than leave a dangling word. Runs until nothing moves.
 */
export function tidyLines(lines, max = 4) {
  let out = lines.map((l) => [...l]);
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      const cur = out[i];
      if (!cur.length) continue;
      const next = out[i + 1];
      if (!next) continue;
      if (cur.every(isGlue) && cur.length + next.length <= max + 2) { out[i + 1] = [...cur, ...next]; out[i] = []; moved = true; continue; }
      if (isGlue(cur[cur.length - 1]) && cur.length > 1 && next.length + 1 <= max + 1) { next.unshift(cur.pop()); moved = true; }
    }
    out = out.filter((l) => l.length);
    if (!moved) break;
  }
  return out;
}

/**
 * Group words into caption lines. A run ends at a sentence end or a pause longer than maxGap;
 * each run is split into phrase-aware (or fallback balanced) lines of at most wordsPerLine words.
 * Returns [{ words:[{text,start,end,key?}], start, end, text }].
 */
export function groupWords(words, duration, { wordsPerLine = 3, maxGap = 0.7, emojis = false, lead = 0.05, minShow = 0, phraseBreaks = false, maxChars = 22, protectedPhrases = new Set() } = {}) {
  const runs = [];
  let run = [];
  for (const w of words) {
    const text = cleanText(w.text, { emojis });
    if (!text) continue;
    if (run.length && w.start - run[run.length - 1].end > maxGap) {
      runs.push(run);
      run = [];
    }
    run.push({ text, start: w.start, end: w.end, rawText: w.text });
    if (/[.!?]$/.test(w.text.trim())) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  const per = Math.max(1, wordsPerLine);
  let split;
  try {
    split = runs.flatMap((r) => phraseBreaks ? phraseSplit(r, per, { maxChars, protectedPhrases }) : balancedSplit(r, per));
  } catch {
    warn("caption phrase breaks unavailable; using balanced lines");
    split = runs.flatMap((r) => balancedSplit(r, per));
  }
  let lines = tidyLines(split, Math.max(2, wordsPerLine + 1)).map((line) => line.map(({ text, start, end }) => ({ text, start, end })));
  // minShow: a line that would be on screen for less than this joins the next one (fast talkers with short lines
  // otherwise flash a word for a few frames); never past wordsPerLine + 2 words, never across a pause.
  if (minShow > 0) {
    const merged = [];
    for (let k = 0; k < lines.length; k++) {
      const cur = lines[k], next = lines[k + 1];
      if (next && next[0].start - cur[0].start < minShow && cur.length + next.length <= wordsPerLine + 2 && next[0].start - cur[cur.length - 1].end <= maxGap) {
        lines[k + 1] = [...cur, ...next];
        continue;
      }
      merged.push(cur);
    }
    lines = merged;
  }
  const groups = lines.map((ws) => ({ words: ws }));

  groups.forEach((g, i) => {
    const next = groups[i + 1];
    const first = g.words[0];
    const last = g.words[g.words.length - 1];
    // `lead`: a line appears this long before its first word (the measured preset: two frames).
    g.start = r3(Math.max(0, first.start - lead));
    const limit = next ? Math.max(0, next.words[0].start - lead) : duration;
    g.end = r3(Math.min(limit, last.end + 0.6));
    // A hold that would end just before the next line leaves blank frames between them: run straight into it.
    if (next && limit - g.end < 0.3) g.end = r3(limit);
    if (g.end - g.start < 0.3) g.end = r3(Math.min(limit, g.start + 0.3));
    g.text = g.words.map((w) => w.text).join(" ");
  });
  for (let i = 0; i + 1 < groups.length; i++) if (groups[i].end > groups[i + 1].start) groups[i].end = groups[i + 1].start;
  return groups.filter((g) => g.end > g.start);
}

/**
 * Mark highlight words per line: dictionary terms first (framework names, always gold; multi-word terms highlight
 * every word), then numbers / dollar amounts / power words, then dictionary candidates and automatic picks under
 * the rarity rule (once per clip, never on two lines in a row), so gold keeps meaning something.
 * At most maxPerLine highlights unless a term is longer.
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

// Long words that carry no weight on their own: soft adverbs and everyday -ing verbs. Any word ending in -ly
// is treated the same way unless the dictionary lists it as a power word.
const WEAK_WORDS = new Set(("almost always already usually sometimes often enough little pretty rather quite somehow anyway anyways " +
  "looking getting trying doing having making taking coming saying thinking talking working putting giving " +
  "sitting standing walking telling asking showing turning keeping letting starting moving playing " +
  "people person somebody whatever whenever wherever another around through without within between before behind " +
  "should've could've would've").split(" "));

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
    else if (!STOP_WORDS.has(t) && !WEAK_WORDS.has(t) && !/ly$/.test(t) && t.replace(/'/g, "").length >= 6) consider(i, 1, 2 + Math.min(t.length, 10) / 100);
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
  const candidates = new Set((dict.candidates || []).map(norm));
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
        if (/^\$?\d/.test(t) && UNIT_WORDS.has(toks[i + 1] || "")) g.words[i + 1].key = true; // "10 minutes"
        marked++;
        break;
      }
    }
    if (marked) continue;
    // Candidates (everyday business words) are gold once per clip and never on two lines in a row.
    const ci = toks.findIndex((t) => candidates.has(t) && !usedAuto.has(t));
    if (ci >= 0 && !wasAuto) {
      g.words[ci].key = true;
      usedAuto.add(toks[ci]);
      prevAuto = true;
      continue;
    }
    if (!auto) continue;
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

/** Hook words with the gold emphasis. "*10 minutes*" in the hook text marks it by hand; otherwise the
 *  caption picker chooses (dictionary term, then number + unit or power word, then the automatic pick). */
export function hookWords(text, dict = {}) {
  const raw = String(text).split(/\s+/).filter(Boolean);
  if (raw.some((t) => t.includes("*"))) {
    let on = false;
    const words = raw.map((t) => {
      const start = t.startsWith("*");
      const end = t.replace(/[?!.,]+$/, "").endsWith("*");
      if (start) on = true;
      const w = { text: t.replace(/\*/g, ""), key: on };
      if (end) on = false;
      return w;
    });
    return { text: words.map((w) => w.text).join(" "), words };
  }
  const g = [{ words: raw.map((t) => ({ text: t })) }];
  markKeywords(g, dict, { auto: true });
  return { text: raw.join(" "), words: g[0].words.map((w) => ({ text: w.text, key: !!w.key })) };
}
