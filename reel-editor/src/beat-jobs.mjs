/**
 * The element mix (research 2026-11-18, SHORTLIST items 1, 4, 8, 9 and the beat recipe): every beat of a reel gets a
 * job before any element is chosen, the job decides which kinds of element fit it, and a variety pass makes sure the
 * reel rotates through element types, entrances and marks so no two beats look alike.
 *
 * Jobs: objection (what a lead says back), distinction (two things set against each other, a myth and its fix),
 * procedure (do this, then this), proof (a number, a result, a message someone sent), emphasis (the punch line),
 * takeaway (the closing lesson: plain talking head, no card), plain (talk; a clean beat is correct, not a gap).
 *
 * Nothing here writes copy. Every card still comes from the speaker's own words: the flip finder below only cuts the
 * two phrases out of a line he says ("it's not luck, it's work").
 */

const r3 = (x) => Math.round(x * 1000) / 1000;
const low = (t) => String(t || "").toLowerCase().replace(/[’‘]/g, "'");
const tok = (t) => low(t).replace(/[^a-z0-9'$%]/g, "");

export const JOBS = ["objection", "distinction", "procedure", "proof", "emphasis", "takeaway", "plain"];

/**
 * What each job should look like. cards: graphics.mjs card types in order of fit; glow: the glow kit's elements;
 * enter: the entrance that suits it (the variety pass moves off it when the card before used the same one).
 */
export const JOB_ELEMENTS = {
  objection: { cards: ["message", "quote", "flip"], glow: ["notify", "quote", "thread"], enter: "slide", mark: "underline" },
  distinction: { cards: ["flip", "compare"], glow: ["swap", "versus", "bars"], enter: "wipe", mark: "arrow" },
  procedure: { cards: ["steps", "list", "ladder"], glow: ["flow", "steps", "list"], enter: "rise", mark: null },
  proof: { cards: ["stat", "bars", "message"], glow: ["number", "meter", "bars", "thread"], enter: "wipe", mark: "circle" },
  emphasis: { cards: ["headline", "post", "quote"], glow: ["stamp", "hero", "icons"], enter: "pop", mark: "underline" },
  takeaway: { cards: [], glow: ["feature"], enter: "rise", mark: null },
  plain: { cards: ["headline", "quote", "chapter", "post"], glow: ["feature", "icon"], enter: "rise", mark: null },
};

/** Every entrance the card runtime knows. Calm looks (Julee's) only get the calm ones. */
export const ENTRANCES = ["pop", "slide", "wipe", "rise", "blur", "drop"];
export const CALM_ENTRANCES = ["rise", "wipe", "blur", "slide"];
export const MARKS = ["underline", "circle", "arrow"];

const CUES = {
  objection: /\b(i can'?t afford|too expensive|costs? too much|(don'?t|do not) have (the )?(time|money)|no time|i'?ll think about it|let me think|think it over|not ready|i'?m not ready|what if|they (always )?(say|said|tell)|people (always )?(say|tell me)|you might (think|say)|you'?re (probably )?thinking|my (wife|husband|spouse|partner)|talk to my|send me (some )?info|objection|pushback|i'?m good|not interested|maybe later)\b/,
  distinction: /\b(it'?s not|that'?s not|isn'?t|aren'?t|wasn'?t|instead( of)?|versus|vs\.?|rather than|the difference|difference between|old way|new way|most (people|coaches|reps|closers)|amateurs?|myth|everyone thinks|stop \w+ing|less \w+,? more)\b|\bnot\b.+\bbut\b/,
  procedure: /(^|[.!?] )first\b|\b(first(ly)?,|first (you|we|thing|step)|second(ly)?|third(ly)?|step (one|two|three|1|2|3)|then you|and then|next,|finally,|after that|start (by|with)|number (one|two|three)|here'?s how|the process|the framework)/,
  proof: /\d|\b(clients?|closed|close rate|made|results?|revenue|deals?|sales|sent me|texted me|dm'?d me|messaged me|testimonial|last (week|month|year)|percent|million|thousand|hundred|grand|booked|doubled|tripled)\b/,
  emphasis: /\b(never|always|everything|nothing|the truth|the real|the only|most important|secret|biggest|number one|game ?changer|period|non-?negotiable|every single)\b|!/,
  takeaway: /\b(so (if|the|that|here|next|remember)|the lesson|remember|bottom line|that'?s why|if you want|the point is|here'?s the thing|comment|follow (me|for)|link in|dm me|takeaway)\b/,
};

/** The job of one spoken line. `tail` is true for a line in the reel's closing seconds. */
export function beatJob(text, { tail = false } = {}) {
  const t = low(text);
  if (tail && !CUES.procedure.test(t)) return "takeaway";
  for (const job of ["procedure", "distinction", "objection", "proof", "emphasis"]) if (CUES[job].test(t)) return job;
  if (tail || CUES.takeaway.test(t)) return tail ? "takeaway" : "plain";
  return "plain";
}

/**
 * Label every line (caption groups, or sentences from the words) with its job. The closing beat (the last 12% of the
 * reel, at least 3.5 s, at most 6 s) is the takeaway: Greg's line lands on his face.
 */
export function classifyBeats(lines, { duration = 0 } = {}) {
  const end = duration || Math.max(0, ...lines.map((l) => l.end ?? l.start ?? 0));
  const tailFrom = end - Math.min(6, Math.max(3.5, end * 0.12));
  return lines.map((l, i) => {
    const text = l.text ?? (l.words || []).map((w) => w.text).join(" ");
    const job = beatJob(text, { tail: (l.start ?? 0) >= tailFrom });
    return { i, start: r3(l.start ?? 0), end: r3(l.end ?? l.start ?? 0), text, job, ...(Number.isInteger(l.from) ? { from: l.from, to: l.to } : {}) };
  });
}

/** Sentences from timed words (a glow plan has words, not caption lines), each with its word index range. */
export function linesFromWords(words = []) {
  const out = [];
  let from = 0;
  words.forEach((w, i) => {
    const last = i === words.length - 1;
    if (last || /[.?!]["”]?$/.test(w.text) || (i - from >= 13 && /[,;:]$/.test(w.text))) {
      const ws = words.slice(from, i + 1);
      out.push({ from, to: i, start: ws[0].start, end: ws.at(-1).end ?? ws.at(-1).start, text: ws.map((x) => x.text).join(" ") });
      from = i + 1;
    }
  });
  return out;
}

const JOB_NOTES = {
  objection: "objection: what a lead or client says back. Show their words as a message or quote card, or a flip when he answers it with a better line",
  distinction: "distinction: two things set against each other. A flip when he literally says the wrong idea and then the right one, else a compare",
  procedure: "procedure: steps he walks through. Steps or a list that builds as he says each one, holding one spot",
  proof: "proof: a number, result or message that really exists in his words. A stat, bars or the proof message; leave it out if there is no real number or message",
  emphasis: "emphasis: the punch line. A headline or post card, one dominant event",
  takeaway: "takeaway: the closing lesson. No card; let the line land on the speaker",
  plain: "plain: talk. Usually no card; a clean beat between cards is correct",
};

/** The beat list for the card planner (graphics.mjs scenesPrompt). */
export function beatJobsPrompt(beats, { glow = false } = {}) {
  const used = [...new Set(beats.map((b) => b.job))];
  const label = (b) => glow ? `${b.from}-${b.to}` : `${b.i}`;
  return [
    "Beat jobs: every line already has a job. Pick each element from its line's job, so the reel rotates through different elements the way a designer would plan it, not one card type over and over:",
    ...used.map((j) => `- ${glow ? GLOW_NOTES[j] : JOB_NOTES[j]}`),
    glow ? "Lines by job (word range: job):" : "Lines by job (line number: job):",
    ...beats.map((b) => `${label(b)}: ${b.job}`),
    "Mix rule: no two cards in a row of the same type, and real plain beats between them.",
  ].join("\n");
}

const GLOW_NOTES = {
  objection: "objection: what a lead or client says back. A notify, quote or thread",
  distinction: "distinction: two things set against each other. A swap feature when he says the wrong word then the right one, else versus or bars",
  procedure: "procedure: steps he walks through. A flow (or steps, or a list)",
  proof: "proof: a number or result he says. A number, meter, bars or thread",
  emphasis: "emphasis: the punch word or line. A stamp, a hero feature or an icons scene",
  takeaway: "takeaway: the closing lesson. A plain feature at most, no scene",
  plain: "plain: talk. A feature or an icon, or nothing",
};

/**
 * Myth flip: a line where he names the wrong idea and then the right one, cut straight from his words. Returns
 * [{ from, to, wrongFrom, wrongTo, rightFrom, rightTo, pivot }] as word indexes (pivot = the word where the right
 * idea starts being said). Each side is one to four words.
 */
const STOP = new Set("a an the about just really very your my his her their our it its".split(" "));
export function findFlips(words = []) {
  const t = words.map((w) => tok(w.text));
  const out = [];
  const take = (from, max, stopAt) => {
    // Up to `max` words from `from`, ending at a comma/period, or before a stop index.
    const idx = [];
    for (let k = from; k < Math.min(words.length, from + max + 2) && idx.length < max; k++) {
      if (k === stopAt) break;
      if (!t[k]) break;
      idx.push(k);
      if (/[,.;:?!]["”]?$/.test(words[k].text)) break;
    }
    while (idx.length && STOP.has(t[idx[0]])) idx.shift();
    return idx.length ? [idx[0], idx.at(-1)] : null;
  };
  const isIt = (k) => ["it's", "its", "thats", "that's", "theyre", "they're", "youre", "you're"].includes(t[k]);
  for (let i = 0; i < words.length; i++) {
    let wrong = null, right = null, pivot = null, start = i;
    // "it's not X, it's Y" / "that's not X, it's Y"
    if (isIt(i) && t[i + 1] === "not") {
      const j = [...Array(7).keys()].map((k) => i + 3 + k).find((k) => k < words.length - 1 && isIt(k));
      if (j != null) { wrong = take(i + 2, 4, j); pivot = j; right = take(j + 1, 4); }
    } else if (t[i] === "not" && !isIt(i - 1)) {
      // "not X but Y"
      const j = [...Array(6).keys()].map((k) => i + 2 + k).find((k) => k < words.length - 1 && t[k] === "but");
      if (j != null) { wrong = take(i + 1, 4, j); pivot = j; right = take(j + 1, 4); }
    } else if (t[i] === "stop" && /ing$/.test(t[i + 1] || "")) {
      // "stop X, start Y"
      const j = [...Array(6).keys()].map((k) => i + 2 + k).find((k) => k < words.length - 1 && t[k] === "start");
      if (j != null) { wrong = take(i + 1, 4, j); pivot = j; right = take(j + 1, 4); }
    } else if (t[i] === "instead" && t[i + 1] === "of") {
      // "instead of X, Y"
      const w = take(i + 2, 4);
      if (w && /,$/.test(words[w[1]].text)) { wrong = w; pivot = w[1] + 1; right = take(w[1] + 1, 4); }
    }
    if (!wrong || !right || pivot == null || right[0] <= wrong[1]) continue;
    // The two sides must be different words (not "it's not it, it's it").
    const side = (r) => words.slice(r[0], r[1] + 1).map((w) => tok(w.text)).join(" ");
    if (side(wrong) === side(right)) continue;
    if (right[1] - start > 14) continue;
    out.push({ from: start, to: right[1], wrongFrom: wrong[0], wrongTo: wrong[1], rightFrom: right[0], rightTo: right[1], pivot: pivot });
    i = right[1];
  }
  return out;
}

const plainText = (words, a, b) => words.slice(a, b + 1).map((w) => String(w.text).replace(/["“”]/g, "").replace(/[,.;:?!]+$/, "")).join(" ");

/**
 * Flip cards for caption groups (graphics.mjs). Each flip becomes { type: "flip", line, wrong, right, pivotAt... }:
 * the line is the group where the wrong phrase starts; pivotAt is seconds after the card starts.
 */
export function flipCards(groups = []) {
  const words = [], owner = [];
  groups.forEach((g, gi) => (g.words || []).forEach((w) => { words.push(w); owner.push(gi); }));
  return findFlips(words).map((f) => {
    const line = owner[f.from];
    const start = groups[line]?.start ?? words[f.from].start;
    return {
      type: "flip", line, source: "flip-finder",
      wrong: plainText(words, f.wrongFrom, f.wrongTo), right: plainText(words, f.rightFrom, f.rightTo),
      pivotLine: owner[f.pivot], pivotAt: r3(Math.max(0.5, words[f.pivot].start - start)), spokenEnd: r3((words[f.to].end ?? words[f.to].start) - start),
    };
  }).filter((c) => c.wrong && c.right && c.wrong.length <= 30 && c.right.length <= 30);
}

const jobAt = (beats, t) => beats.find((b) => t >= b.start - 0.05 && t < b.end + 0.05)?.job || beats.filter((b) => b.start <= t).at(-1)?.job || "plain";

/** The word in a card that a mark points at, and when it is said (seconds after the card starts), or null. */
export function markTarget(card, words = []) {
  const hl = /\*([^*]+)\*/.exec(card.text || card.title || "")?.[1];
  const phrase = card.type === "flip" ? card.right : card.type === "stat" ? card.value : hl || null;
  if (!phrase) return null;
  const want = String(phrase).split(/\s+/).map(tok).filter(Boolean);
  if (!want.length) return null;
  const win = words.filter((w) => w.start >= card.start - 0.05 && w.start <= card.start + card.duration);
  const k = win.findIndex((w, j) => want.every((x, n) => tok(win[j + n]?.text) === x || (n === 0 && tok(w.text).includes(x.replace(/[$%]/g, "")))));
  const at = k >= 0 ? win[k].start - card.start : null;
  return { phrase, at: at == null ? null : r3(Math.max(0.35, at)) };
}

/**
 * The variety pass over a reel's planned cards (in time order): tags each with its beat job, drops a card in the
 * takeaway tail and a card that repeats the type right before it (a persistent list is one continuing idea and keeps
 * its spot), caps any one type at two, then gives every card an entrance and, where it has a word to point at, a
 * mark: neither the same as the card before. Returns { cards, report }.
 */
export function mixCards(cards, beats, { words = [], calm = false, maxPerType = 2 } = {}) {
  const kept = [], dropped = [];
  const count = {};
  for (const c of [...cards].sort((a, b) => a.start - b.start)) {
    if (c.type === "progress") { kept.push(c); continue; }
    const job = jobAt(beats, c.start);
    const prev = kept.filter((k) => k.type !== "progress").at(-1);
    if (job === "takeaway" && !c.persistent && c.source !== "script") { dropped.push({ c, why: "takeaway beat stays on the speaker" }); continue; }
    if (prev && prev.type === c.type && !c.persistent && c.source !== "script") { dropped.push({ c, why: `same type as the card before (${c.type})` }); continue; }
    if ((count[c.type] || 0) >= maxPerType && !c.persistent && c.source !== "script") { dropped.push({ c, why: `third ${c.type}` }); continue; }
    count[c.type] = (count[c.type] || 0) + 1;
    kept.push({ ...c, job });
  }
  const pool = calm ? CALM_ENTRANCES : ENTRANCES;
  let lastEnter = null, lastMark = null, k = 0;
  const out = kept.map((c) => {
    if (c.type === "progress" || c.persistent) return c;
    const want = JOB_ELEMENTS[c.job]?.enter;
    const rest = pool.filter((e) => e !== lastEnter);
    const enter = pool.includes(want) && want !== lastEnter ? want : rest[k % rest.length];
    lastEnter = enter;
    k++;
    const target = ["stat", "headline", "quote", "flip", "chapter"].includes(c.type) ? markTarget(c, words) : null;
    let mark = null;
    if (target) {
      const pref = c.type === "stat" ? "circle" : c.type === "flip" ? "arrow" : JOB_ELEMENTS[c.job]?.mark || "underline";
      mark = pref !== lastMark ? pref : MARKS.find((m) => m !== lastMark && !(m === "circle" && c.type !== "stat"));
      lastMark = mark;
    }
    return { ...c, enter, ...(mark ? { mark: { kind: mark, at: target.at ?? 0.5 } } : {}) };
  });
  return { cards: out, dropped, report: describeMix(out, dropped) };
}

/** One line for the run log: "beats: 4.1s objection quote (slide, underline), 9s distinction flip (wipe, arrow)". */
export function describeMix(cards, dropped = []) {
  const parts = cards.filter((c) => c.type !== "progress").map((c) => `${r3(c.start)}s ${c.job || "?"} ${c.type}${c.enter ? ` (${c.enter}${c.mark ? `, ${c.mark.kind}` : ""})` : ""}`);
  return `element mix: ${parts.join(", ") || "no cards"}${dropped.length ? `; left out ${dropped.map((d) => `${d.c.type} at ${r3(d.c.start)}s (${d.why})`).join(", ")}` : ""}`;
}

/**
 * The glow side of the mix, after checkPicks: a flip line no pick covers becomes a swap feature (the wrong word
 * strikes, the right one lands in gold), and feature lines take turns carrying a hand-drawn mark on their gold word
 * (underline, circle on a number, arrow), never the same mark twice running and never on every feature.
 * `fits(feature)` is the glow layout's own two-line check. Returns { picks, report }.
 */
export function mixGlowPicks(picks, words, { duration = 0, hookEnd = 3, fits = () => true, check = (p) => p } = {}) {
  const beats = classifyBeats(linesFromWords(words), { duration });
  const taken = new Set();
  for (const kind of ["features", "overlays", "scenes"]) for (const p of picks[kind] || []) for (let k = p.from ?? p.word; k <= (p.to ?? p.word); k++) taken.add(k);
  for (const p of picks.icons || []) taken.add(p.word);
  const added = [];
  const swaps = [];
  for (const f of findFlips(words)) {
    if (words[f.from].start < hookEnd) continue;
    // A swap shows both sides in one short phrase: "IT'S NOT LUCK / IT'S WORK".
    const from = f.rightTo - f.from < 7 ? f.from : Math.max(f.from, f.wrongFrom - 1), to = f.rightTo;
    if (to - from >= 7 || f.pivot <= from) continue;
    let free = true;
    for (let k = from; k <= to; k++) if (taken.has(k)) free = false;
    if (!free) continue;
    const swap = { from, to, key: f.rightTo, br: f.pivot, variant: "swap", wrong: f.wrongTo, right: f.rightTo };
    if (!fits(swap)) continue;
    swaps.push(swap);
    for (let k = from; k <= to; k++) taken.add(k);
    added.push({ swap, text: `swap "${plainText(words, f.wrongFrom, f.wrongTo)}" to "${plainText(words, f.rightFrom, f.rightTo)}"` });
  }
  // The glow checks run again over the new lines, so a swap never breaks the band pacing.
  const checked = swaps.length ? check({ ...picks, features: [...(picks.features || []), ...swaps] }) : picks;
  const kept = added.filter((a) => (checked.features || []).some((f) => f.from === a.swap.from && f.variant === "swap"));
  const features = [...(checked.features || [])].sort((a, b) => a.from - b.from);
  let lastMark = null, sinceMark = 9;
  const marked = [];
  const out = features.map(({ mark: oldMark, ...f }) => {
    sinceMark++;
    if (f.variant === "swap" || sinceMark < 2) return f;
    const key = f.hero ?? f.key;
    if (!Number.isInteger(key)) return f;
    const job = jobAt(beats, words[f.from].start);
    if (!["emphasis", "proof", "distinction", "objection"].includes(job)) return f;
    const pref = /\d|\$|%/.test(words[key].text) ? "circle" : JOB_ELEMENTS[job].mark === "circle" ? "underline" : JOB_ELEMENTS[job].mark || "underline";
    const mark = pref !== lastMark ? pref : pref === "underline" ? "arrow" : "underline";
    lastMark = mark;
    sinceMark = 0;
    marked.push(`${words[key].text.replace(/[^\w$%']/g, "")} ${mark}`);
    return { ...f, mark };
  });
  const jobs = beats.filter((b) => b.job !== "plain").map((b) => `${r3(b.start)}s ${b.job}`);
  return { picks: { ...checked, features: out }, beats, report: `element mix (glow): beats ${jobs.join(", ") || "all plain"}${kept.length ? `; added ${kept.map((a) => a.text).join(", ")}` : ""}${marked.length ? `; marks ${marked.join(", ")}` : ""}` };
}
