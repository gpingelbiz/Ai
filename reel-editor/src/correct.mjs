import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { sha1, r3, readJSON, writeJSON } from "./util.mjs";

/**
 * Caption word fix: Claude reads the transcript against the dictionary (brand terms, names, phrases) and fixes only
 * what the engine clearly mis-heard: a brand term, a name, a wrong number, a homophone that makes no sense. Text only,
 * smallest span, no rephrasing. The edited words are then re-timed by forced alignment (align.mjs).
 */

const norm = (s) => String(s).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9&$%]/g, "");

export function fixPrompt({ words, terms = [], names = [], hints = [] }) {
  const numbered = words.map((w, i) => `${i}:${w.text}`).join(" ");
  const list = [...new Set([...terms, ...names])].filter(Boolean);
  return [
    "You are checking an automatic transcript of a short talking-head video. The words become on-screen captions, so spelling matters.",
    "Fix ONLY words the speech engine clearly mis-heard:",
    "- a brand term, product name or person's name from the list below heard as other words (e.g. 'ghost pianel' is 'Ghost P&L')",
    "- a number heard as the wrong number when the context makes the right one certain",
    "- a homophone that makes no sense in context (their/there, to/too, then/than, hire/higher)",
    "Do not rephrase, do not drop fillers, do not fix grammar, do not add or move punctuation, do not expand contractions. Keep each edit to the smallest span of words. When in doubt, leave it.",
    list.length ? `Terms and names (spell exactly like this): ${list.join("; ")}` : "No term list was given; fix only numbers and homophones.",
    hints.length ? `Places the engines were unsure or disagreed (check these first):\n${hints.map((h) => `- word ${h.i}: ${h.note}`).join("\n")}` : "",
    `Transcript, one token per word, numbered:\n${numbered}`,
    'Reply with JSON only: {"edits":[{"i":<index of the first word to replace>,"n":<how many words to replace>,"to":"<replacement text>"}]} or {"edits":[]} when nothing is wrong.',
  ].filter(Boolean).join("\n\n");
}

/** Keep only well-formed, small, real edits; drop everything when the model wanted to rewrite the reel. */
export function validateEdits(words, edits, { maxSpan = 4, maxReplaceFrac = 0.08, maxTo = 6 } = {}) {
  if (!Array.isArray(edits)) return { edits: [], dropped: "no edits array" };
  const ok = [];
  const used = new Set();
  for (const e of edits) {
    const i = Number(e?.i), n = Number(e?.n ?? 1);
    const to = String(e?.to ?? "").trim();
    if (!Number.isInteger(i) || !Number.isInteger(n) || i < 0 || n < 1 || n > maxSpan || i + n > words.length) continue;
    const toks = to.split(/\s+/).filter(Boolean);
    if (!toks.length || toks.length > maxTo) continue;
    const from = words.slice(i, i + n).map((w) => w.text).join(" ");
    if (from === to) continue;
    let clash = false;
    for (let k = i; k < i + n; k++) if (used.has(k)) clash = true;
    if (clash) continue;
    for (let k = i; k < i + n; k++) used.add(k);
    ok.push({ i, n, from, to });
  }
  if (used.size > Math.max(2, maxReplaceFrac * words.length)) return { edits: [], dropped: `${used.size} of ${words.length} words would change; that is a rewrite, not a fix` };
  return { edits: ok.sort((a, b) => a.i - b.i), dropped: null };
}

/** Apply validated edits: replaced words share the span's time evenly (the aligner fixes that afterwards). */
export function applyEdits(words, edits) {
  const out = [];
  const byStart = new Map(edits.map((e) => [e.i, e]));
  let i = 0;
  while (i < words.length) {
    const e = byStart.get(i);
    if (!e) { out.push(words[i]); i++; continue; }
    const s = words[i].start, t = words[i + e.n - 1].end;
    const tail = (words[i + e.n - 1].text.match(/[.,!?;:]+$/) || [""])[0];
    const toks = e.to.split(/\s+/).filter(Boolean);
    toks.forEach((tok, j) => {
      const text = j === toks.length - 1 && !/[.,!?;:]$/.test(tok) ? tok + tail : tok;
      out.push({ ...words[i], text, start: r3(s + ((t - s) * j) / toks.length), end: r3(s + ((t - s) * (j + 1)) / toks.length), fixed: true });
    });
    i += e.n;
  }
  return out;
}

/** Hints for the prompt from the review (engine disagreements) and low-confidence words. */
export function fixHints(words, review, { minProb = 0.5, max = 25 } = {}) {
  const hints = [];
  // Review items (review.mjs) carry a raw-timeline start, not an index: the first word at that time is the spot.
  const at = (t) => { let i = words.findIndex((w) => w.start >= t - 0.015); return i < 0 ? null : i; };
  for (const it of review?.items || []) {
    const i = at(it.start);
    if (i == null) continue;
    if (it.kind === "differs") hints.push({ i, note: `heard ${it.heard}; the second engine heard ${it.alt}` });
    else if (it.kind === "unsure") hints.push({ i, note: `${it.heard} at low confidence` });
  }
  words.forEach((w, i) => { if (w.prob != null && w.prob < minProb && !hints.some((h) => h.i === i)) hints.push({ i, note: `"${w.text}" at ${Math.round(w.prob * 100)}% confidence` }); });
  return hints.slice(0, max);
}

/**
 * Run the fix (cached in <workDir>/words-fixed.json by transcript + dictionary). Returns {words, edits, note}.
 * Never throws: on any failure the words come back unchanged with the reason in `note`.
 */
export async function fixWords({ words, dict = {}, review = null, workDir, force = false, minProb = 0.5 }) {
  const terms = [...(dict.terms || []), ...(dict.phrases || [])];
  const names = dict.names || [];
  if (!words.length) return { words, edits: [], note: "no words" };
  if (!hasClaude()) return { words, edits: [], note: "caption fix: Claude Code CLI not found, words left as heard" };
  const key = sha1(JSON.stringify([words.map((w) => w.text), terms, names]));
  const cache = workDir ? path.join(workDir, "words-fixed.json") : null;
  if (cache && !force && fs.existsSync(cache)) {
    try {
      const saved = readJSON(cache);
      if (saved.key === key) return { words: applyEdits(words, saved.edits), edits: saved.edits, note: null, cached: true };
    } catch {}
  }
  let reply;
  try {
    reply = await claudeText(fixPrompt({ words, terms, names, hints: fixHints(words, review, { minProb }) }), { timeoutMs: 180000 });
  } catch (e) {
    return { words, edits: [], note: `caption fix skipped: ${String(e.message).split("\n")[0]}` };
  }
  let parsed;
  try { parsed = firstJSON(reply); } catch { return { words, edits: [], note: "caption fix skipped: the reply had no JSON" }; }
  const { edits, dropped } = validateEdits(words, parsed.edits);
  if (dropped) return { words, edits: [], note: `caption fix skipped: ${dropped}` };
  if (cache) writeJSON(cache, { key, edits });
  return { words: applyEdits(words, edits), edits, note: null };
}

export function describeFix(res, words) {
  if (res.note) return res.note;
  if (!res.edits.length) return "caption fix: every word checked, nothing to change";
  const at = (i) => { const t = words[i]?.start || 0; return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; };
  const shown = res.edits.slice(0, 4).map((e) => `"${e.from}" → "${e.to}" at ${at(e.i)}`).join(", ");
  return `caption fix: ${res.edits.length} change${res.edits.length === 1 ? "" : "s"} (${shown}${res.edits.length > 4 ? ", …" : ""})${res.cached ? " (saved)" : ""}`;
}
