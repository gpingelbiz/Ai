// Did the cloned voice say the script? (Greg 2026-11-25: "we need to make sure the voice is right to the captions".)
// reel proof transcribes the finished narration once and lines it up with the script, word by word. A line where the
// voice dropped, swapped or added a real word is re-recorded; spelling the transcriber uses for the same sound
// ("might of" / "might have", "alright" / "all right", "41" / "forty one") is not a mistake.
import { tokenSpans } from "./receipts.mjs";

// Words a transcriber writes for the same spoken sound, or drops and adds without the voice doing so.
const SAME = [["of", "have"], ["of", "ve"], ["okay", "ok"]];
// Two heard words that are one written word ("all right" for "alright").
const JOIN = { "all right": "alright", "going to": "gonna", "want to": "wanna", "a lot": "alot" };
const LIGHT = new Set(["a", "an", "the", "of", "to", "and", "or", "but", "so", "uh", "um", "oh", "is", "it", "in", "on", "at", "that", "this", "s", "d", "ll", "ve", "re", "m"]);
const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

// Symbols a transcriber writes for spoken words (11-26: the voice said "30 percent", Whisper wrote "30%").
const SYMBOLS = [[/(\d)\s*%/g, "$1 percent"], [/\s&\s/g, " and "]];

/** Raw speech tokens of one piece of text: lower case, contractions split ("she'd" -> "she", "d"), "%" read as "percent". */
function rawTokens(text) {
  const out = [];
  const said = SYMBOLS.reduce((s, [re, to]) => s.replace(re, to), String(text || ""));
  for (const t of tokenSpans(said)) for (const part of t.text.split("'")) if (part) out.push(part);
  return out;
}

/** Tokens across word boundaries: "all right" -> "alright", "forty one" -> "41". Items are {t, at}. */
function mergeTokens(items) {
  const merged = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i], next = items[i + 1];
    const pair = next && JOIN[`${cur.t} ${next.t}`];
    if (pair) { merged.push({ ...cur, t: pair }); i++; continue; }
    const a = NUM[cur.t], b = next ? NUM[next.t] : undefined;
    if (a >= 20 && a % 10 === 0 && b > 0 && b < 10) { merged.push({ ...cur, t: String(a + b) }); i++; continue; }
    merged.push(a != null ? { ...cur, t: String(a) } : cur);
  }
  return merged;
}

/** Tokens for comparing speech: lower case, contractions split, spelled-out numbers turned into digits. */
export function speechTokens(text) {
  return mergeTokens(rawTokens(text).map((t) => ({ t }))).map((x) => x.t);
}

const same = (a, b) => a === b || SAME.some((g) => g.includes(a) && g.includes(b));

/**
 * Line every script token up with what was heard (edit distance, sound-alikes free) and report, per line, the real
 * words the voice dropped, swapped or added. heard is [{text, start, end}] for the whole narration.
 */
export function checkLines(lines, heard) {
  const script = [];
  lines.forEach((line, li) => speechTokens(line.text).forEach((t) => script.push({ li, t })));
  const raw = [];
  for (const w of heard || []) for (const t of rawTokens(w.text)) raw.push({ t, at: w.start });
  const h = mergeTokens(raw);
  const n = script.length, m = h.length;
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const del = (i) => (LIGHT.has(script[i].t) ? 0.4 : 1), ins = (j) => (LIGHT.has(h[j].t) ? 0.4 : 1);
  for (let i = 1; i <= n; i++) D[i][0] = D[i - 1][0] + del(i - 1);
  for (let j = 1; j <= m; j++) D[0][j] = D[0][j - 1] + ins(j - 1);
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    D[i][j] = Math.min(D[i - 1][j - 1] + (same(script[i - 1].t, h[j - 1].t) ? 0 : 1), D[i - 1][j] + del(i - 1), D[i][j - 1] + ins(j - 1));
  }
  const problems = lines.map(() => []);
  // An added word belongs to the line that was playing when it was heard (lines carry start and duration once laid
  // out); without times, to the line before it.
  const lineAt = (at, fallback) => {
    if (!Number.isFinite(at)) return fallback;
    let best = -1;
    lines.forEach((line, k) => { if (Number.isFinite(line.start) && at >= line.start - 0.15) best = k; });
    return best >= 0 ? best : fallback;
  };
  let i = n, j = m, lastLi = lines.length - 1;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (same(script[i - 1].t, h[j - 1].t) ? 0 : 1)) { ops.push(["m", i - 1, j - 1]); i--; j--; }
    else if (i > 0 && D[i][j] === D[i - 1][j] + del(i - 1)) { ops.push(["d", i - 1, null]); i--; }
    else { ops.push(["i", null, j - 1]); j--; }
  }
  ops.reverse();
  lastLi = 0;
  for (const [op, a, b] of ops) {
    if (a != null) lastLi = script[a].li;
    if (op === "m" && !same(script[a].t, h[b].t)) problems[script[a].li].push(`said "${h[b].t}" for "${script[a].t}"`);
    else if (op === "d" && !LIGHT.has(script[a].t)) problems[script[a].li].push(`dropped "${script[a].t}"`);
    else if (op === "i" && !LIGHT.has(h[b].t)) problems[lineAt(h[b].at, lastLi)].push(`added "${h[b].t}"`);
  }
  return lines.map((line, k) => ({ kind: line.kind, text: line.text, ...(Number.isFinite(line.start) ? { start: line.start, duration: line.duration } : {}), ok: !problems[k].length, problems: problems[k] }));
}
