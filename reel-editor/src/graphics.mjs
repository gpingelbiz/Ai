import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, r3 } from "./util.mjs";

/**
 * Graphic scenes: designed full-screen cards that show what the speaker is saying, the way explainer reels cut
 * to a big number, a checklist, a highlighted quote or a step diagram. Claude (headless, no tools) reads the
 * timed transcript and picks the moments and the words; every word on a card comes from the speaker. The
 * editor renders the cards in HTML in the brand colors and fonts, so nothing is misspelled. The voice keeps
 * playing and the captions stay on top.
 *
 * Types: stat (a number or amount), list (2-4 items, checked or struck), quote (a line on a paper card with one
 * phrase highlighted), headline (the key statement), steps (2-4 connected nodes: a flow or a before -> after).
 */

export const TYPES = ["stat", "list", "quote", "headline", "steps", "compare", "bars", "message", "post", "chapter", "progress"];

/**
 * graphics.json schema. 2 = the dynamic-graphics plan (cards timed to the words they show, truthful numbers).
 * An older plan is still reused as is, so an old reel renders as it did; `--new-graphics` replans it.
 */
export const GRAPHICS_SCHEMA = 2;

/**
 * Line icons for list rows (24x24 stroke paths, drawn on as the row appears). Claude picks one per row from
 * this list; a row without a pick gets one from its words, or none. Nothing is downloaded: HyperFrames ships no
 * icon pack, and Lottie files would have to come from LottieFiles with their own licenses.
 */
export const ICONS = {
  dollar: "M12 2v20 M17 6.5a4 4 0 0 0-4-2.5h-2a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5",
  clock: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 7v5l3 2",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  people: "M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8 M3 21v-1a6 6 0 0 1 12 0v1 M16 3.5a4 4 0 0 1 0 7.5 M21 21v-1a6 6 0 0 0-4-5.7",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  growth: "M3 17l6-6 4 4 8-8 M15 7h6v6",
  calendar: "M4 6h16v15H4z M4 11h16 M8 3v5 M16 3v5",
  check: "M4 12.5l5 5L20 7",
  x: "M6 6l12 12 M18 6L6 18",
  fire: "M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1 2-2 3-4 4 0-3-1-5-3-7-1 4-3 5-3 12a7 7 0 0 0 7 7z",
  target: "M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18 M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8",
  message: "M4 5h16v11H9l-5 4z",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4 M12 14v4 M8 21h8",
  lock: "M6 11h12v10H6z M9 11V7a3 3 0 0 1 6 0v4",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  brain: "M10 4a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h1V4z M14 4a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-1V4z",
  home: "M4 11l8-7 8 7 M6 10v10h12V10",
  shield: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z M6 11a6 6 0 0 0 12 0 M12 17v4",
  doc: "M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6",
  flag: "M5 21V4 M5 4h12l-2 4 2 4H5",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6",
  repeat: "M4 10a8 8 0 0 1 14-4l2 2 M20 4v4h-4 M20 14a8 8 0 0 1-14 4l-2-2 M4 20v-4h4",
};
const ICON_WORDS = [
  ["dollar", /\b(money|dollar|pay|paid|cash|revenue|price|profit|income|cost)\b|\$/i],
  ["clock", /\b(time|minute|minutes|hour|hours|day|days|week|weeks|wait|late|early)\b/i],
  ["phone", /\b(call|calls|phone|dial|ring)\b/i],
  ["people", /\b(team|people|rep|reps|closer|closers|client|clients|staff|hire|setter|setters|customer|customers)\b/i],
  ["chart", /\b(number|numbers|data|report|metrics|stats|scoreboard)\b/i],
  ["growth", /\b(grow|growth|scale|increase|more|double)\b/i],
  ["calendar", /\b(calendar|schedule|book|booked|monday|friday|month|quarter)\b/i],
  ["x", /\b(stop|never|quit|cut|kill|no)\b/i],
  ["fire", /\b(fire|burn|hot|urgent)\b/i],
  ["target", /\b(goal|goals|target|aim|focus)\b/i],
  ["message", /\b(text|texts|message|messages|dm|dms|say|tell|ask|reply)\b/i],
  ["trophy", /\b(win|wins|winner|close|closed|closes|deal|deals)\b/i],
  ["lock", /\b(lock|secure|locked)\b/i],
  ["heart", /\b(love|heart|care|family|wife|kids)\b/i],
  ["brain", /\b(think|mind|mindset|brain|decide|decision)\b/i],
  ["home", /\b(home|house)\b/i],
  ["shield", /\b(protect|safe|guard|defend|own|owned)\b/i],
  ["mic", /\b(speak|talk|speech|voice|pitch)\b/i],
  ["doc", /\b(plan|script|sheet|list|notes|contract|offer)\b/i],
  ["flag", /\b(standard|standards|rule|rules|lead|leader)\b/i],
  ["star", /\b(best|star|elite|top)\b/i],
  ["bolt", /\b(fast|quick|energy|push|now)\b/i],
  ["eye", /\b(see|watch|watching|look|show|showed)\b/i],
  ["repeat", /\b(repeat|again|reps|habit|daily|every)\b/i],
];
export function iconFor(text, pick) {
  if (pick && ICONS[pick]) return pick;
  const hit = ICON_WORDS.find(([, re]) => re.test(String(text || "")));
  return hit ? hit[0] : "";
}

/** How long each kind of card holds, from how much there is to read. */
export function sceneDuration(s) {
  const n = (s.items || []).length;
  const timed = (s.type === "list" || s.type === "steps") && n && s.items.every((it) => Number.isFinite(it.at));
  if (timed) return r3(Math.min(8, Math.round((s.items[n - 1].at + 1.2) * 30) / 30));
  if (s.type === "message" && s.mode === "proof") {
    const lastItem = Math.max(0, ...(s.items || []).map((it) => Number(it.at) || 0));
    const last = Math.max(lastItem, Number(s.outcome?.at) || 0);
    const beat = (s.items || []).some((it) => (Number(it.at) || 0) === last) ? 20 / 30 : 10 / 30;
    const words = [s.context, ...(s.items || []).map((it) => it.text), s.outcome?.text].filter(Boolean).join(" ").split(/\s+/).length;
    return r3(Math.ceil(Math.min(8, Math.max(last + beat + 1.5, 0.7 + words * 0.375)) * 30) / 30);
  }
  // Cards hold long enough to be read twice: the speaker is still on screen, so a card is never a cut.
  if (s.type === "list" || s.type === "steps" || s.type === "bars") return r3(Math.min(8, 4.5 + 0.7 * n));
  if (s.type === "message") return r3(Math.min(8, 4 + 1.2 * n));
  if (s.type === "compare" && (Number.isInteger(s.pivotLine) || Number.isFinite(s.pivotAt))) return 4.5;
  if (s.type === "quote" || s.type === "compare") return 6;
  if (s.type === "chapter") return 3.5;
  if (s.type === "headline") return 5.5;
  return 5.5;
}

/** Up to one card per `every` seconds after the hook; a short reel (9 s and up) still gets one. */
export function graphicsCount(duration, { max = 6, every = 10 } = {}) {
  const n = Math.max(0, Math.min(max, Math.floor((duration - 4) / every)));
  return n === 0 && duration >= 9 && max >= 1 ? 1 : n;
}

const clean = (s, max = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const shortWords = (s, max = 3, chars = 32) => clean(s, chars).split(/\s+/).filter(Boolean).slice(0, max).join(" ");
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);
const wordCount = (s) => String(s || "").replace(/\*/g, "").trim().split(/\s+/).filter(Boolean).length;
const capWords = (s, max) => words(s).slice(0, Math.max(0, max)).join(" ");
const compareWords = (s) => words(s.title).length + [s.a, s.b].reduce((n, x) => n + words(x?.label).length + words(x?.value).length + words(x?.note).length, 0);
const itemLine = (line) => Number.isInteger(line) ? line : parseInt(line, 10);
const hasTimedItems = (s) => (s.type === "list" || s.type === "steps") && s.items?.length && s.items.every((it) => Number.isFinite(it.at));

function cardWords(s) {
  return wordCount(s.eyebrow) + wordCount(s.title) + (s.items || []).reduce((n, it) => n + wordCount(it.text) + wordCount(it.tag), 0);
}

const QUALIFIED_NUMBER = /\b(?:about|around|over|under|within|nearly|almost|up\s+to)\b|\bafter\s+(?:\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+years?\b/i;
const sceneWords = (s) => [s.eyebrow, s.title, s.value, s.value2, s.sub, ...(s.items || []).flatMap((it) => [it.label, it.value])].filter(Boolean).join(" ");

/** The numeric motion a card may use. Old plans with no field keep the original zero count-up. */
export function numberMotion(s, { schema = 1 } = {}) {
  if (!s || !["stat", "bars"].includes(s.type)) return "";
  const qualified = QUALIFIED_NUMBER.test(sceneWords(s));
  const statEnds = s.type === "stat" && splitStat(s.value) && splitStat(s.value2);
  const barEnds = s.type === "bars" && s.items?.length === 2 && s.items.every((it) => splitStat(it.value));
  if (s.motion === "growth" && !qualified && (statEnds || barEnds)) return "growth";
  if (s.motion === "reveal" || s.motion === "growth" || schema >= GRAPHICS_SCHEMA) return "reveal";
  return "";
}

function capCompareSide(x, max = 6) {
  const valueWords = words(x.value).length;
  const label = capWords(x.label, Math.max(1, max - valueWords));
  const note = capWords(x.note, max - valueWords - words(label).length);
  return { ...x, label, note };
}

/** Fit a staged comparison to its 160 WPM reading budget without cutting a number or its qualifier apart. */
function fitCompareBudget(s, duration) {
  const budget = Math.max(2, Math.floor((duration - 0.7) / 0.375));
  const out = { ...s, a: capCompareSide(s.a), b: capCompareSide(s.b) };
  if (compareWords(out) <= budget) return out;
  out.title = "";
  for (const side of [out.a, out.b]) {
    while (compareWords(out) > budget && words(side.note).length) side.note = capWords(side.note, words(side.note).length - 1);
  }
  for (const side of [out.a, out.b]) {
    while (compareWords(out) > budget && words(side.label).length > 1) side.label = capWords(side.label, words(side.label).length - 1);
  }
  if (compareWords(out) > budget && out.a.value && out.b.value) { out.a.value = ""; out.b.value = ""; }
  for (const side of [out.a, out.b]) {
    while (compareWords(out) > budget && words(side.label).length > 1) side.label = capWords(side.label, words(side.label).length - 1);
  }
  return out;
}

const cleanWords = (s, maxWords, maxChars = 160) => {
  const words = String(s ?? "").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, maxWords);
  while (words.length && words.join(" ").length > maxChars) words.pop();
  return words.join(" ");
};
const proofTokens = (s) => String(s || "").toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];

/** The first transcript line where an exact spoken phrase begins, including phrases that cross caption lines. */
function firstExactLine(lines, phrase) {
  const needle = proofTokens(phrase);
  if (!needle.length) return null;
  const words = [];
  for (const line of lines || []) for (const word of proofTokens(line.text)) words.push({ word, line: line.i });
  outer: for (let i = 0; i <= words.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (words[i + j].word !== needle[j]) continue outer;
    return words[i].line;
  }
  return null;
}

/** Ground a proof thread in exact transcript phrases and resolve its line cues to frame-quantized offsets. */
function groundProof(s, lines, candidates) {
  const byLine = new Map((lines || []).map((line) => [line.i, line]));
  const allowed = new Set((candidates || []).map((line) => line.i));
  const line = firstExactLine(lines, s.context);
  if (line == null || !allowed.has(line)) return null;
  const start = Math.round(byLine.get(line).start * 30) / 30;
  let prior = line;
  const items = [];
  for (const item of s.items || []) {
    const first = firstExactLine(lines, item.text);
    if (first == null || first !== item.line || first < prior || !byLine.has(first)) return null;
    prior = first;
    items.push({ ...item, at: r3(Math.round((byLine.get(first).start - start) * 30) / 30) });
  }
  let outcome = null;
  if (s.outcome) {
    const first = firstExactLine(lines, s.outcome.text);
    if (first == null || first !== s.outcome.line || first < prior || !byLine.has(first)) return null;
    outcome = { ...s.outcome, at: r3(Math.round((byLine.get(first).start - start) * 30) / 30) };
  }
  const grounded = { ...s, line, items, ...(outcome ? { outcome } : {}) };
  grounded.duration = sceneDuration(grounded);
  const words = proofTokens([grounded.context, ...items.map((it) => it.text), outcome?.text].filter(Boolean).join(" ")).length;
  if (words > Math.floor((grounded.duration - 0.7) / 0.375)) return null;
  return grounded;
}

/** Tidy one scene from Claude: known type, short text, the fields that type needs. Returns null if unusable. */
export function normalizeScene(raw, { schema = GRAPHICS_SCHEMA } = {}) {
  if (!raw || !TYPES.includes(raw.type)) return null;
  if (raw.type === "progress") {
    const s = { type: "progress", title: shortWords(raw.title), style: raw.style === "count" ? "count" : "journey" };
    s.items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it) => ({ line: Number.isInteger(it?.line) ? it.line : parseInt(it?.line, 10), label: shortWords(it?.label) }))
      .filter((it) => Number.isInteger(it.line) && it.label)
      .slice(0, 4);
    if (s.items.length < 2) return null;
    return s;
  }
  const s = { type: raw.type, line: Number.isInteger(raw.line) ? raw.line : parseInt(raw.line, 10), eyebrow: clean(raw.eyebrow, 40) };
  if (!Number.isInteger(s.line)) return null;
  if (s.type === "stat") {
    s.value = clean(raw.value, 16);
    s.value2 = clean(raw.value2, 16);
    s.sub = clean(raw.sub, 60);
    if (!s.value) return null;
  } else if (s.type === "list" || s.type === "steps") {
    s.title = clean(raw.title, 48);
    const items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it) => (typeof it === "string" ? { text: it } : it || {}))
      .map((it) => ({ text: clean(it.text, 32), tag: clean(it.tag, 18), state: ["check", "strike"].includes(it.state) ? it.state : "plain", icon: s.type === "list" ? iconFor(it.text, clean(it.icon, 12).toLowerCase()) : "", ...((it.line !== undefined && it.line !== null && it.line !== "") ? { line: itemLine(it.line) } : {}) }))
      .filter((it) => it.text)
      .slice(0, 4);
    if (items.length < 2) return null;
    const supplied = items.filter((it) => Object.hasOwn(it, "line"));
    const lined = items.filter((it) => Number.isInteger(it.line));
    // No cue lines is the legacy card. Once one item is timed, every item must be timed in spoken order.
    if (supplied.length && (lined.length !== items.length || lined.some((it, i) => i && it.line <= lined[i - 1].line) || items.some((it) => wordCount(it.text) > 4))) return null;
    s.items = items;
  } else if (s.type === "bars") {
    s.title = clean(raw.title, 48);
    s.unit = clean(raw.unit, 8);
    s.items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it) => ({ label: clean(it?.label, 24), value: clean(it?.value, 12) }))
      .filter((it) => it.label && splitStat(it.value))
      .slice(0, 4);
    if (s.items.length < 2) return null;
    const hi = Number.isInteger(raw.emphasize) ? raw.emphasize : s.items.length - 1;
    s.emphasize = Math.max(0, Math.min(s.items.length - 1, hi));
  } else if (s.type === "compare") {
    s.title = clean(raw.title, 40);
    const side = (x) => ({ label: clean(x?.label, 22), value: clean(x?.value, 12), note: clean(x?.note, 28) });
    s.a = side(raw.a);
    s.b = side(raw.b);
    if (!s.a.label || !s.b.label) return null;
    if (!(splitStat(s.a.value) && splitStat(s.b.value))) { s.a.value = ""; s.b.value = ""; }
    const pivotLine = Number.isInteger(raw.pivotLine) ? raw.pivotLine : parseInt(raw.pivotLine, 10);
    if (Number.isInteger(pivotLine)) {
      s.pivotLine = pivotLine;
      s.kind = ["versus", "before-after", "roles"].includes(raw.kind) ? raw.kind : "versus";
      s.a = capCompareSide(s.a);
      s.b = capCompareSide(s.b);
    }
  } else if (s.type === "message") {
    if (raw.mode === "proof") {
      s.mode = "proof";
      s.context = cleanWords(raw.context, 6, 48);
      s.items = (Array.isArray(raw.items) ? raw.items : [])
        .map((it) => ({ from: it?.from === "me" ? "me" : "them", text: cleanWords(it?.text, 16), line: Number.isInteger(it?.line) ? it.line : parseInt(it?.line, 10) }))
        .filter((it) => it.text && Number.isInteger(it.line))
        .slice(0, 3);
      if (raw.outcome) {
        const line = Number.isInteger(raw.outcome.line) ? raw.outcome.line : parseInt(raw.outcome.line, 10);
        const text = cleanWords(raw.outcome.text, 12, 100);
        if (Number.isInteger(line) && text) s.outcome = { line, text };
      }
      if (!s.context || !s.items.length) return null;
    } else {
      s.contact = clean(raw.contact, 18);
      s.items = (Array.isArray(raw.items) ? raw.items : [])
        .map((it) => ({ from: it?.from === "me" ? "me" : "them", text: clean(it?.text, 90) }))
        .filter((it) => it.text)
        .slice(0, 3);
    }
    if (!s.items.length) return null;
  } else if (s.type === "post") {
    s.text = clean(raw.text, 150);
    if (!s.text) return null;
  } else if (s.type === "chapter") {
    s.text = clean(raw.text, 48);
    s.number = Number.isInteger(raw.number) ? raw.number : 0;
    if (!s.text) return null;
  } else {
    s.text = clean(raw.text, s.type === "quote" ? 140 : 60);
    if (!s.text) return null;
  }
  if (s.type === "stat" || s.type === "bars") s.motion = numberMotion({ ...s, motion: raw.motion }, { schema }) || "reveal";
  s.duration = sceneDuration(s);
  return s;
}

/** Caption lines a card may start on: after the hook, with room before the end and the CTA. */
export function sceneCandidates(groups, duration, { hook, cta, lead = 0.5, tail = 1.5, longest = 8 } = {}) {
  const from = hook ? hook.start + hook.duration + lead : 3;
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  return groups.map((g, i) => ({ i, start: g.start, text: g.text, words: g.words || [] })).filter((c) => c.start >= from && c.start + 2.2 <= until && c.start + Math.min(longest, until - c.start) <= until);
}

function pivotTime(candidate) {
  const tokens = candidate.words.map((w) => String(w.text || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  const phrases = [["but"], ["instead"], ["now"], ["what", "they", "hear"], ["the", "real", "reason"], ["two", "years", "later"]];
  for (const phrase of phrases) {
    const at = tokens.findIndex((_, i) => phrase.every((x, j) => tokens[i + j] === x));
    if (at >= 0 && Number.isFinite(candidate.words[at]?.start)) return candidate.words[at].start;
  }
  return candidate.start;
}

/**
 * Time the scenes: real candidate lines, in order, `gap` seconds apart, each ending before `until`. When the next
 * card comes before the previous one would end, the previous one is shortened (never below `minHold`) rather than
 * the next one dropped: a card that holds long is good, a point with no card is worse.
 */
export function placeScenes(scenes, candidates, { duration, cta, gap = 3, max = 6, tail = 1.5, minHold = 4, fps = 30, lines = candidates } = {}) {
  const byLine = new Map(candidates.map((c) => [c.i, c]));
  const until = Math.min(duration - tail, cta ? cta.start : Infinity);
  const out = [];
  const stats = [];
  let contrast = false;
  let proofUsed = false;
  const ready = [...scenes].map((s) => s?.type === "message" && s.mode === "proof" ? groundProof(s, lines, candidates) : s).filter((x) => x && byLine.has(x.line));
  for (const s of ready.sort((a, b) => byLine.get(a.line).start - byLine.get(b.line).start)) {
    if (s.type === "compare" && Number.isInteger(s.pivotLine) && contrast) continue;
    if (s.mode === "proof" && proofUsed) continue;
    const start = s.mode === "proof" ? Math.round(byLine.get(s.line).start * 30) / 30 : byLine.get(s.line).start;
    if (s.type === "stat" && (stats.length >= 2 || stats.some((at) => start - at < 8))) continue;
    let scene = s;
    const lined = (s.type === "list" || s.type === "steps") ? (s.items || []).filter((it) => Number.isInteger(it.line)) : [];
    if (lined.length) {
      if (lined.length !== s.items.length || lined.some((it, i) => i && it.line <= lined[i - 1].line)) continue;
      const cues = lined.map((it) => byLine.get(it.line)?.start);
      if (cues.some((t) => !Number.isFinite(t)) || cues[0] < start || cues.some((t, i) => i && t <= cues[i - 1]) || cues[cues.length - 1] - cues[0] > 8 || cues[cues.length - 1] - start > 8) continue;
      const items = s.items.map((it, i) => ({ ...it, at: r3(Math.round((cues[i] - start) * 30) / 30) }));
      if (items.some((it, i) => i && it.at <= items[i - 1].at)) continue;
      scene = { ...s, items };
      scene.duration = sceneDuration(scene);
      const budget = Math.floor((scene.duration - 0.7) / 0.375);
      if (items.some((it) => wordCount(it.text) > 4) || cardWords(scene) > budget) continue;
      const timed = out.filter(hasTimedItems);
      if (timed.length >= 2 || timed.some((g) => start - g.start < 8)) continue;
      if (start + scene.duration > until) continue;
    }
    const prev = out[out.length - 1];
    if (prev && start < prev.start + prev.duration + gap) {
      const room = r3(start - gap - prev.start);
      if (prev.mode === "proof" && room < prev.duration) continue;
      if (room < minHold) continue;
      if (hasTimedItems(prev)) continue;
      prev.duration = room;
    }
    const dur = r3(Math.min(scene.duration, until - start));
    if (scene.mode === "proof" && dur < scene.duration) continue;
    if (dur < (scene.type === "compare" && Number.isInteger(scene.pivotLine) ? 3 : 2) && !hasTimedItems(scene)) continue;
    let placed = { ...scene, start: r3(start), duration: dur };
    if (scene.type === "compare" && Number.isInteger(scene.pivotLine)) {
      const pivot = byLine.get(scene.pivotLine);
      if (!pivot) continue;
      const pivotAt = r3(Math.round((pivotTime(pivot) - start) * fps) / fps);
      if (pivotAt < 6 / fps || pivotAt > dur - 16 / fps) continue;
      placed = fitCompareBudget({ ...placed, pivotAt }, dur);
      contrast = true;
    }
    out.push(placed);
    if (scene.type === "stat") stats.push(start);
    if (scene.mode === "proof") proofUsed = true;
    if (out.length >= max) break;
  }
  return out;
}

const transcriptWords = (groups) => new Set(groups.flatMap((g) => String(g.text || "").toLowerCase().replace(/[^a-z0-9'’]+/g, " ").split(/\s+/).filter(Boolean)));

/** A progress rail starts with the hook, not on an ordinary card candidate. Its item lines are its later pulses. */
export function resolveProgressScenes(scenes, groups, { hook, duration, cards = [] } = {}) {
  if (!hook) return [];
  const words = transcriptWords(groups);
  const numberWords = { two: 2, three: 3, four: 4 };
  const promised = String(hook.text || "").toLowerCase().match(/\b(?:2|3|4|two|three|four)\b/);
  const promisedCount = promised ? numberWords[promised[0]] || Number(promised[0]) : 0;
  const truthSafe = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9'’]+/g, " ").split(/\s+/).filter(Boolean).every((w) => words.has(w));
  const byLine = new Map(groups.map((g, i) => [i, g]));
  const overlapsCard = (at) => cards.some((c) => c.type !== "progress" && at < c.start + c.duration && at + 1.4 > c.start);
  for (const s of scenes.filter((x) => x?.type === "progress").slice(0, 1)) {
    if (s.style === "count" && promisedCount !== s.items.length) continue;
    if ((s.title && !truthSafe(s.title)) || s.items.some((it) => !truthSafe(it.label))) continue;
    if (s.items.some((it) => !byLine.has(it.line))) continue;
    const starts = s.items.map((it) => byLine.get(it.line).start);
    if (starts.some((at, i) => i && at <= starts[i - 1])) continue;
    const hookEnd = r3(hook.start + hook.duration);
    if (s.style !== "count" && starts.at(-1) < hookEnd + 8) continue;
    if (starts[0] < hook.start || starts.at(-1) >= duration) continue;
    const pulses = s.items.map((it, i) => ({ line: it.line, at: r3(starts[i]), hidden: overlapsCard(starts[i]) }));
    return [{ ...s, start: r3(hook.start), duration: r3(Math.min(duration, starts.at(-1) + 1.4) - hook.start), hookEnd, pulses }];
  }
  return [];
}

export function scenesPrompt({ candidates, anchors = candidates, transcript, hook, count, voice = "", looks = "" }) {
  return [
    "You are the motion designer on a talking-head Instagram reel. You pick the moments where a designed graphic card cuts in to show what the speaker is saying, and you write the words on each card. You never use tools; reply with JSON only.",
    `Pick up to ${count} moments, spread across the reel, at least 6 seconds apart. Only pick a moment when a card makes the point clearer or hit harder: the speaker says a number or amount, lists things, describes steps or a before and after, contrasts two things, quotes something, or lands the key line.`,
    "",
    "Card types and their fields:",
    '- stat: a number or amount the speaker says. value ("$10,000", "10 minutes", "8 years"), optional value2 for a range or change, sub (a short line under it, from their words), motion ("reveal" or "growth"). Use reveal by default. Use growth only when the card contains both ends of an explicit change the speaker states, such as value "3" and value2 "30" for "from 3 to 30".',
    "- list: 2 to 4 short items the speaker names. title (optional), items [{text, tag, state, line}]: line is where that item is first said; state is check (things to do / that count), strike (things that don't matter / to stop), or plain. tag is an optional 1-2 word label on the right.",
    "- quote: a line worth reading, either something the speaker quotes (eyebrow = where it is from, as they say it) or their own strongest line (eyebrow = a 2-4 word label). text, with the one phrase that matters in *asterisks* (it is highlighted).",
    "- headline: the key statement in at most 7 words, with the one phrase that matters in *asterisks* (it is set in gold).",
    "- steps: 2 to 4 short nodes connected top to bottom: a sequence the speaker gives, or a cause -> effect / before -> after. items [{text, line}], where line is where that step is first said.",
    "- compare: two things the speaker sets against each other (the old way vs the new way, closer A vs closer B, what you say vs what they hear). title (optional), kind (versus, before-after, or roles), pivotLine (the numbered caption line where the contrast word is spoken), a {label, value, note} and b {label, value, note}: label 1-3 words, value only when the speaker gives a number for both sides, note an optional 2-4 word line.",
    "- bars: 2 to 4 numbers the speaker gives that belong together (months, reps, before/after amounts). title (optional), unit (\"%\", \"k\", \"\"), items [{label, value}], emphasize = index of the number that matters most, motion (\"reveal\" or \"growth\"). Keep exact printed labels and use reveal unless two rows are the explicit starting and ending values of one spoken change.",
    "- message: a text exchange the speaker reads out or acts out. For reconstructed proof, use mode: \"proof\", context (who and what, in the speaker's exact words), items [{from: \"them\" | \"me\", text, line}] 1-3 bubbles, and optional outcome {line, text}. Each bubble is at most 16 words. Do not add contact in proof mode. Legacy acted-out exchanges may omit mode and use contact plus items without line.",
    "- post: the speaker\u2019s own strongest line shown as a social post card. text, at most 20 words.",
    "- progress: one small payoff rail, separate from the card count. title is optional and at most 3 words; style is journey or count; items are 2 to 4 ordered {line, label} milestones, with each label 1 to 3 words taken from the speaker. journey is only for real ordered beats whose final payoff is at least 8 seconds after the hook. count is only when the hook explicitly promises a number, and each item is a promised section start. Never use progress on a one-idea reel.",
    `- list items may carry icon: one of ${Object.keys(ICONS).join(", ")} (pick the one that fits the item, else leave empty).`,
    "Every card has an eyebrow: a 2-5 word label in caps over it (\"AFTER A BAD NUMBER\", \"THE STANDARD\", \"WHAT YOU OWN\").",
    "",
    "Rules:",
    "- Use only what the speaker says: their words, names and numbers, lightly trimmed. Never invent numbers, sources, quotes, results or steps they did not give.",
    "- Keep every qualifier the speaker puts on a number (almost, about, over, nearly, up to, around): they said \"almost eight years\", so the value is \"Almost 8 years\", never \"8 years\".",
    "- A qualified value (about, over, under, within, nearly, almost, up to, after N years) always uses motion \"reveal\". The qualifier stays attached to the number; never count through other qualified claims.",
    "- Use at most two stat cards in the reel, and put their start lines at least 8 seconds apart.",
    "- When the speaker quotes someone else or acts out a message or line, a quote card may show it but must not present it as the speaker's own words.",
    "- For proof messages, anchor the card where the speaker first establishes that the message exists; anchor each bubble or outcome to the first line where its content becomes known.",
    "- Proof context, bubble text and outcome text must be exact consecutive words from the transcript, only trimmed shorter. Never invent a sender name, timestamp, read receipt or outcome.",
    "- Use at most one proof message in the reel.",
    "- Short: items at most 4 words, headline at most 7 words, sub and eyebrow at most 6 words.",
    "- Anchor every item to the line where that item first becomes known. Never reveal a later point early.",
    "- Pick at most two timed list/steps cards in the reel and keep their starts at least 8 seconds apart.",
    "- A timed list/steps card must fit this whole-card reading budget: floor((seconds on screen - 0.7) / 0.375) words.",
    "- A compare holds 3 to 4.5 seconds. Use at most one compare in the reel, at most 6 words on either side, and keep the whole card inside its reading budget. Set pivotLine to the line that contains the spoken contrast (but, instead, now, what they hear, the real reason, two years later). Side B is the payoff: never reveal or make it readable before pivotLine.",
    "- Vary the card types; no type more than twice unless the reel is mostly a list.",
    "- Fewer cards beat more: the biggest reels in this niche are a face, one premise and captions. Reply with an empty scenes list when the reel is one opinion with no structure, an emotional or identity moment, or a skit. A personal story gets at most a proof message or a progress rail, and only when the speaker gives a real message or a real sequence. Never pick a card that repeats the hook or the line already on screen.",
    "- Offer at most one progress scene. It does not replace or consume one of the requested cards. Its item line anchors must be strictly increasing.",
    "- No emojis, no hashtags, no calls to action.",
    voice ? `\nVoice for labels and trims:\n${voice.trim()}` : "",
    "",
    `Hook on screen at the start: ${hook || "(none)"}`,
    "",
    "Whole transcript for context:",
    transcript,
    "",
    "Lines a card may start on (number: start time, text). A card starts when that line is spoken, so pick the line where the idea begins:",
    ...candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`),
    "",
    "Lines a progress milestone may anchor to (number: start time, text):",
    ...anchors.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text}`),
    "",
    looks ? `\n${looks}\n` : "",
    'Reply with JSON only: {"look":"<id>","lookWhy":"...","scenes":[{"line":<number from the list>,"type":"stat|list|quote|headline|steps|compare|bars|message|post|progress","eyebrow":"...","motion":"reveal|growth","value":"","value2":"","sub":"","title":"","text":"","style":"journey|count","unit":"","emphasize":0,"contact":"","mode":"proof","context":"","outcome":{"line":0,"text":""},"pivotLine":0,"kind":"versus|before-after|roles","a":{"label":"","value":"","note":""},"b":{"label":"","value":"","note":""},"items":[{"text":"","line":<number from the list>,"tag":"","state":"plain","icon":"","label":"","value":"","from":"them"}]}]}',
  ].join("\n");
}

/**
 * Plan the graphic scenes for one reel. Saves <workDir>/graphics.json and reuses it while the transcript lines
 * are unchanged (`force` replans). Never throws: any failure returns [] and the reel renders without cards.
 */
export async function makeGraphics({ workDir, groups, duration, hook, cta, settings = {}, voice = "", force = false, handle = "", tail = 1.5 }) {
  const planPath = path.join(workDir, "graphics.json");
  const max = graphicsCount(duration, { max: settings.max ?? 6, every: settings.every ?? 10 });
  if (!max) { log("graphics: reel too short, skipped"); return []; }
  const candidates = sceneCandidates(groups, duration, { hook, cta, tail });
  const anchors = groups.map((g, i) => ({ i, start: g.start, text: g.text }));
  const lines = anchors;
  if (!candidates.length) { log("graphics: no room after the hook, skipped"); return []; }
  const key = candidates.map((c) => `${c.i}@${c.start}:${c.text}`).join("|");
  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    // Reuse while every card still has its line (a new hook hides different caption lines and shifts the line
    // numbers; the cards follow their line by start time instead of costing another Claude call).
    const byStart = (s) => candidates.find((c) => Math.abs(c.start - (s.start ?? -1)) < 0.05);
    const sameLines = Array.isArray(saved.scenes) && saved.scenes.length && saved.scenes.filter((s) => s.type !== "progress").every(byStart);
    if ((saved.key === key || sameLines) && Array.isArray(saved.scenes)) {
      // Timing rules may have changed since the plan was saved: keep the picks, re-time them.
      // A plan saved before looks existed keeps its glass cards, so an old reel renders as it did.
      const look = settings.look && LOOKS[settings.look] ? settings.look : saved.look || "glass";
      const schema = saved.schema || 1;
      // A timed item follows its line by time too (its saved offset from the card start).
      const relined = (s) => ({ ...s, items: s.items?.map((it) => ({ ...it, ...(Number.isInteger(it.line) && Number.isFinite(it.at) ? { line: candidates.find((c) => Math.abs(c.start - (s.start + it.at)) < 0.05)?.i ?? it.line } : {}) })) });
      const remapProof = (s) => s.type === "message" && s.mode === "proof" ? {
        ...s,
        items: (s.items || []).map((it) => ({ ...it, line: lines.find((line) => Math.abs(line.start - (s.start + (it.at || 0))) < 0.05)?.i ?? it.line })),
        ...(s.outcome ? { outcome: { ...s.outcome, line: lines.find((line) => Math.abs(line.start - (s.start + (s.outcome.at || 0))) < 0.05)?.i ?? s.outcome.line } } : {}),
      } : s;
      const savedCards = saved.scenes.filter((s) => s.type !== "progress").map(relined).map(remapProof).map((s) => schema >= GRAPHICS_SCHEMA ? { ...s, ...normalizeScene(s, { schema }) } : s).map((s) => ({ ...s, line: byStart(s)?.i ?? s.line, duration: sceneDuration(s), skin: skinFor(look, s.type, s.mode), ...(s.type === "post" ? { handle } : {}) }));
      const cards = placeScenes(savedCards, candidates, { duration, cta, gap: settings.gap ?? 3, max, tail, lines });
      const rawProgress = saved.scenes.filter((s) => s.type === "progress").map(normalizeScene).filter(Boolean).map((s) => ({ ...s, skin: skinFor(look, s.type) }));
      const scenes = [...cards, ...resolveProgressScenes(rawProgress, groups, { hook, duration, cards })].sort((a, b) => a.start - b.start);
      const old = schema < GRAPHICS_SCHEMA ? `; card plan v${schema}, --new-graphics replans it with the v${GRAPHICS_SCHEMA} cards` : "";
      log(`graphics: reusing ${scenes.length} card${scenes.length === 1 ? "" : "s"} from ${planPath} (look: ${look}${old})`);
      scenes.look = look;
      scenes.schema = schema;
      return scenes;
    }
  }
  if (!hasClaude()) { warn("graphics need the Claude Code CLI (claude) signed in; skipped"); return []; }
  const t0 = Date.now();
  let scenes, lookPicked = null;
  try {
    log(`graphics: Claude is designing up to ${max} card${max === 1 ? "" : "s"}…`);
    const transcript = groups.map((g) => g.text).join(" ");
    const recent = recentLooks();
    const fixed = settings.look && LOOKS[settings.look] ? settings.look : null;
    const reply = firstJSON(await claudeText(scenesPrompt({ candidates, anchors, transcript, hook: hook?.text, count: max, voice, looks: fixed ? "" : looksPrompt(recent, { exclude: settings.excludeLooks || [] }) }), { timeoutMs: 240000 }));
    const picked = fixed ? { look: fixed, why: "set for this reel" } : pickLook(reply, { transcript, recent, exclude: settings.excludeLooks || [] });
    lookPicked = picked;
    const raw = (reply.scenes || []).map(normalizeScene).filter(Boolean);
    const cards = placeScenes(raw.filter((s) => s.type !== "progress").map((s) => ({ ...(s.type === "post" ? { ...s, handle } : s), skin: skinFor(picked.look, s.type, s.mode) })), candidates, { duration, cta, gap: settings.gap ?? 3, max, tail, lines });
    const progress = resolveProgressScenes(raw.filter((s) => s.type === "progress").map((s) => ({ ...s, skin: skinFor(picked.look, s.type) })), groups, { hook, duration, cards });
    scenes = [...cards, ...progress].sort((a, b) => a.start - b.start);
  } catch (e) {
    warn(`graphics: ${String(e.message).split("\n")[0]}; rendering without them`);
    return [];
  }
  writeJSON(planPath, { schema: GRAPHICS_SCHEMA, key, look: lookPicked?.look || "glass", lookWhy: lookPicked?.why || "", scenes });
  scenes.schema = GRAPHICS_SCHEMA;
  if (lookPicked && !settings.look) rememberLook(lookPicked.look);
  log(`graphics: look "${LOOKS[lookPicked?.look || "glass"].label}"${lookPicked?.why ? ` (${lookPicked.why})` : ""}`);
  scenes.look = lookPicked?.look || "glass";
  log(`graphics: ${scenes.length} card${scenes.length === 1 ? "" : "s"} in ${Math.round((Date.now() - t0) / 1000)}s${scenes.map((s) => `\n  ${s.start}s ${s.type}: ${s.eyebrow} | ${s.value || s.text || s.title || ""}${s.items ? " " + s.items.map((i) => i.text).join(" / ") : ""}`).join("")}`);
  return scenes;
}

// ---------------------------------------------------------------- rendering

import { esc } from "./text.mjs";
import { skinHTML, SKINS_JS, looksPrompt, pickLook, recentLooks, rememberLook, skinFor, LOOKS } from "./looks.mjs";
const marked = (s, cls) => esc(s).replace(/\*([^*]+)\*/g, `<span class="${cls}">$1</span>`).replace(/\*/g, "");

/**
 * Split a stat value into the part that counts up and the text around it: "$10,000" -> {prefix:"$", number:"10,000",
 * suffix:""}, "Almost 8 years" -> {prefix:"Almost ", number:"8", suffix:" years"}. null when there is no number.
 */
export function splitStat(value) {
  const m = /^(.*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(String(value ?? ""));
  if (!m) return null;
  const number = m[2];
  const to = parseFloat(number.replace(/,/g, ""));
  if (!Number.isFinite(to)) return null;
  const dec = (number.split(".")[1] || "").length;
  return { prefix: m[1], number, suffix: m[3], to, dec, commas: number.includes(","), percent: /^\s*%/.test(m[3]) };
}

/** A stat line. With no motion this is the legacy zero count-up markup, kept unchanged for schema-1 plans. */
function statHTML(value, size, extraClass = "", { motion = "", from = null } = {}) {
  const p = splitStat(value);
  if (!p) return motion
    ? `<div class="g-stat g-in g-stat-${motion}${extraClass}" style="font-size:calc(var(--u) * ${size})"><span class="g-value-mask"><span class="g-value-lock">${esc(value)}</span></span><span class="g-value-line"></span></div>`
    : `<div class="g-stat g-in${extraClass}" style="font-size:calc(var(--u) * ${size})">${esc(value)}</div>`;
  const affix = (t) => (!t ? "" : /^[\s$€£%+x×~-]+$/.test(t) ? `<span class="g-affix g-sym">${esc(t)}</span>` : `<span class="g-affix">${esc(t)}</span>`);
  const ring = p.percent ? `<span class="g-ring" style="--ring:0%" data-pct="${Math.max(0, Math.min(100, p.to))}"></span>` : "";
  if (motion) {
    const start = Number(from);
    const startText = Number.isFinite(start) ? (p.commas ? start.toLocaleString("en-US", { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec }) : start.toFixed(p.dec)) : p.number;
    const number = motion === "growth"
      ? `<span class="g-count" data-from="${from}" data-to="${p.to}" data-dec="${p.dec}" data-commas="${p.commas ? 1 : 0}">${esc(startText)}</span>`
      : `<span class="g-exact-number">${esc(p.number)}</span>`;
    return `<div class="g-stat g-in g-stat-${motion}${extraClass}" style="font-size:calc(var(--u) * ${size})"><span class="g-value-mask"><span class="g-value-lock">${ring}${affix(p.prefix)}${number}${affix(p.suffix)}</span></span><span class="g-value-line"></span></div>`;
  }
  return `<div class="g-stat g-in${extraClass}" style="font-size:calc(var(--u) * ${size})">${ring}${affix(p.prefix)}<span class="g-count" data-to="${p.to}" data-dec="${p.dec}" data-commas="${p.commas ? 1 : 0}">${esc(p.number)}</span>${affix(p.suffix)}</div>`;
}

/** Inner HTML of one card. Elements with g-in animate in, in document order. */
export function sceneHTML(s, { schema = 1 } = {}) {
  if (s.type === "message" && s.mode === "proof") {
    const beats = s.items.map((it, k) => `<div class="g-proof-beat g-${it.from}" data-proof-item="${k}"><div class="g-proof-typing"><i></i><i></i><i></i></div><div class="g-proof-bubble">${esc(it.text)}</div></div>`).join("");
    const outcome = s.outcome ? `<div class="g-proof-outcome">${esc(s.outcome.text)}<span class="g-proof-underline"></span></div>` : "";
    return `<div class="g-box g-proof"><div class="g-proof-label">IN HIS WORDS</div><div class="g-proof-context">${esc(s.context)}</div><div class="g-proof-thread">${beats}${outcome}</div></div>`;
  }
  const motion = numberMotion(s, { schema });
  const renderStat = (value, size, extraClass = "") => {
    const growth = motion === "growth" && s.type === "stat" && value === s.value;
    return statHTML(growth ? s.value2 : value, size, extraClass, { motion, from: growth ? splitStat(s.value).to : null });
  };
  // A look can reshape a card into an artifact (notification, Notes list, receipt, typed card); otherwise its skin
  // only restyles the regular markup below.
  const stagedCompare = s.type === "compare" && Number.isFinite(s.pivotAt);
  if (!stagedCompare && s.skin && s.skin !== "glass") { const h = skinHTML({ ...s, motion }, s.skin, { statHTML: renderStat }); if (h) return h; }
  const eyebrow = s.eyebrow ? `<div class="g-eyebrow g-in"><span class="g-dot"></span>${esc(s.eyebrow)}</div>` : "";
  if (s.type === "stat") {
    // Sized by length so a long value ("Almost 8 years") stays inside the card; short ones go big.
    const size = (v) => Math.round(Math.min(170, 1250 / Math.max(1, String(v).length)));
    const primary = renderStat(s.value, size(motion === "growth" ? s.value2 : s.value));
    const range = s.value2 && motion !== "growth" ? `<div class="g-arrow g-in">to</div>${renderStat(s.value2, size(s.value2), " g-stat2")}` : "";
    // Every number gets a fill that sweeps with the count (a ring for a percentage, a bar for anything else).
    const fill = !motion && splitStat(s.value) && !splitStat(s.value).percent ? `<div class="g-fill g-in"><div class="g-fill-bar"></div></div>` : "";
    return `<div class="g-box g-center">${eyebrow}${primary}${range}${fill}${s.sub ? `<div class="g-sub g-in">${esc(s.sub)}</div>` : ""}</div>`;
  }
  if (s.type === "list") {
    const live = hasTimedItems(s);
    const rows = s.items
      .map((it, k) => {
        const mark = it.state === "check" ? `<span class="g-mark g-check">&#10003;</span>` : it.state === "strike" ? `<span class="g-mark g-x">&#10005;</span>` : `<span class="g-mark g-num">${String(k + 1).padStart(2, "0")}</span>`;
        const icon = it.icon && ICONS[it.icon] ? `<svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[it.icon]}"/></svg>` : "";
        if (live) return `<div class="g-live-item">${k ? '<span class="g-live-connector"></span>' : ""}<span class="g-item-dot"></span><div class="g-row g-${it.state} g-item-text">${mark}<span class="g-row-text">${esc(it.text)}${it.state === "strike" ? '<span class="g-strike-line"></span>' : ""}</span>${it.tag ? `<span class="g-tag">${esc(it.tag)}</span>` : ""}${icon}</div></div>`;
        return `<div class="g-row g-in g-${it.state}">${mark}<span class="g-row-text">${esc(it.text)}${it.state === "strike" ? '<span class="g-strike-line"></span>' : ""}</span>${it.tag ? `<span class="g-tag">${esc(it.tag)}</span>` : ""}${icon}</div>`;
      })
      .join("");
    return `<div class="g-box">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-rows">${rows}</div></div>`;
  }
  if (s.type === "quote") {
    return `<div class="g-box g-center"><div class="g-paper g-in">${s.eyebrow ? `<div class="g-paper-eyebrow">${esc(s.eyebrow)}</div>` : ""}<div class="g-quote">${/["“”]/.test(s.text) ? marked(s.text, "g-hl") : `&ldquo;${marked(s.text, "g-hl")}&rdquo;`}</div><div class="g-paper-mark"></div></div></div>`;
  }
  if (s.type === "headline") {
    return `<div class="g-box g-center">${eyebrow}<div class="g-headline g-in">${marked(s.text, "g-gold")}</div><div class="g-rule g-in"></div></div>`;
  }
  if (s.type === "chapter") {
    // A chapter title card: the number as the eyebrow, the title, a rule that draws under it.
    return `<div class="g-box g-center g-chapter"><div class="g-eyebrow g-in"><span class="g-dot"></span>${esc(s.eyebrow || (s.number ? `Chapter ${s.number}` : "Next"))}</div><div class="g-headline g-in">${marked(s.text, "g-gold")}</div><div class="g-rule g-in"></div></div>`;
  }
  if (s.type === "compare") {
    // Two panels: the muted left side is the base, the accent right side wipes over from the divider.
    const max = Math.max(1, ...[s.a, s.b].map((x) => (splitStat(x.value) || { to: 0 }).to));
    const side = (x, cls) => {
      const v = splitStat(x.value);
      return `<div class="g-side ${cls}${String(x.label).length > 14 ? " g-side-long" : ""}"><div class="g-side-label">${esc(x.label)}</div>${v ? `<div class="g-side-value">${esc(x.value)}</div><div class="g-side-bar"><div class="g-side-fill" style="--w:${Math.round((v.to / max) * 100)}%"></div></div>` : ""}${x.note ? `<div class="g-side-note">${esc(x.note)}</div>` : ""}</div>`;
    };
    if (stagedCompare) {
      const kind = ["versus", "before-after", "roles"].includes(s.kind) ? s.kind : "versus";
      const from = s.faceSide === "right" ? " g-from-right" : "";
      const pivot = kind === "before-after"
        ? '<div class="g-pivot g-pivot-arrow"><span>&rarr;</span></div>'
        : `<div class="g-pivot g-pivot-divider"><span class="g-divider"></span>${kind === "versus" ? '<span class="g-versus">VS</span>' : ""}</div>`;
      const a = side(s.a, "g-side-a").replace(/<\/div>$/, kind === "before-after" ? '<span class="g-side-cross"></span></div>' : "</div>");
      return `<div class="g-box g-center g-contrast" style="left:7.04%;right:12.96%;top:10.42%;bottom:auto;max-height:45%">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-compare g-compare-dynamic g-kind-${kind}${from}">${a}${pivot}${side(s.b, "g-side-b")}</div></div>`;
    }
    return `<div class="g-box g-center">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-compare g-in">${side(s.a, "g-side-a")}<div class="g-vs">VS</div>${side(s.b, "g-side-b")}</div></div>`;
  }
  if (s.type === "bars") {
    const max = Math.max(1, ...s.items.map((it) => splitStat(it.value).to));
    const from = motion === "growth" ? splitStat(s.items[0].value).to : null;
    const rows = s.items
      .map((it, k) => {
        const v = splitStat(it.value);
        const exact = `${it.value}${v.suffix || !s.unit ? "" : s.unit}`;
        const value = !motion
          ? `<span class="g-count" data-to="${v.to}" data-dec="${v.dec}" data-commas="${v.commas ? 1 : 0}">${esc(v.number)}</span>${esc(v.suffix || s.unit || "")}`
          : motion === "growth" && k === 1
            ? `${v.prefix ? `<span class="g-affix">${esc(v.prefix)}</span>` : ""}<span class="g-count" data-from="${from}" data-to="${v.to}" data-dec="${v.dec}" data-commas="${v.commas ? 1 : 0}">${esc(v.commas ? from.toLocaleString("en-US", { minimumFractionDigits: v.dec, maximumFractionDigits: v.dec }) : from.toFixed(v.dec))}</span>${esc(v.suffix || s.unit || "")}`
            : `<span class="g-value-mask"><span class="g-value-lock">${esc(exact)}</span></span>`;
        return `<div class="g-bar-row g-in${k === s.emphasize ? " g-bar-hi" : ""}"><div class="g-bar-head"><span class="g-bar-label">${esc(it.label)}</span><span class="g-bar-value">${value}</span></div><div class="g-bar-track"><div class="g-bar-fill" style="--w:${Math.round((v.to / max) * 100)}%"></div></div></div>`;
      })
      .join("");
    return `<div class="g-box">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-bars">${rows}</div></div>`;
  }
  if (s.type === "message") {
    const bubbles = s.items.map((it) => `<div class="g-bubble g-in g-${it.from}">${esc(it.text)}</div>`).join("");
    return `<div class="g-box">${eyebrow}<div class="g-thread">${s.contact ? `<div class="g-thread-head g-in"><span class="g-avatar">${esc(s.contact.slice(0, 1).toUpperCase())}</span>${esc(s.contact)}</div>` : ""}<div class="g-typing"><i></i><i></i><i></i></div>${bubbles}</div></div>`;
  }
  if (s.type === "post") {
    const handle = s.handle ? `<span class="g-post-handle">${esc(s.handle)}</span>` : "";
    const name = s.handle ? esc(s.handle.replace(/^@/, "").replace(/^official/i, "")) : "";
    return `<div class="g-box g-center"><div class="g-post g-in"><div class="g-post-head"><span class="g-post-avatar"></span><span class="g-post-who"><span class="g-post-name">${name}<svg class="g-post-badge" viewBox="0 0 24 24"><path d="M12 2l2.4 2.2 3.2-.5 1 3.1 2.9 1.5-1.3 3 1.3 3-2.9 1.5-1 3.1-3.2-.5L12 22l-2.4-2.2-3.2.5-1-3.1-2.9-1.5 1.3-3-1.3-3 2.9-1.5 1-3.1 3.2.5z"/><path class="g-post-tick" d="M8 12.5l2.6 2.5L16 9.5"/></svg></span>${handle}</span></div><div class="g-post-text">${esc(s.text)}</div><div class="g-post-foot"><span class="g-post-heart">&#9829;</span></div></div></div>`;
  }
  // steps
  if (hasTimedItems(s)) {
    const nodes = s.items.map((it, k) => `<div class="g-live-item">${k ? '<span class="g-live-connector"></span>' : ""}<span class="g-item-dot"></span><div class="g-node g-item-text"><span class="g-node-num">${String(k + 1).padStart(2, "0")}</span>${esc(it.text)}</div></div>`).join("");
    return `<div class="g-box g-center">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-steps">${nodes}</div></div>`;
  }
  const nodes = s.items.map((it, k) => `${k ? '<div class="g-link"></div>' : ""}<div class="g-node g-in${k === s.items.length - 1 ? " g-node-last" : ""}"><span class="g-node-num">${String(k + 1).padStart(2, "0")}</span>${esc(it.text)}</div>`).join("");
  return `<div class="g-box g-center">${eyebrow}${s.title ? `<div class="g-title g-in">${marked(s.title, "g-gold")}</div>` : ""}<div class="g-steps">${nodes}</div></div>`;
}

/** Semantic markup for the hook-time rail. It is rendered on its own track, never by the card loop. */
export function progressHTML(s) {
  const count = s.style === "count" ? `<div class="p-count"><span class="p-current">01</span>/<span>${String(s.items.length).padStart(2, "0")}</span></div>` : "";
  const nodes = s.items.map((it, i) => `<div class="p-node" data-index="${i}"><span class="p-dot"></span><span class="p-label">${esc(it.label)}</span></div>`).join("");
  return `<div class="p-shell">${s.title ? `<div class="p-title">${esc(s.title)}</div>` : ""}<div class="p-main">${count}<div class="p-track"><div class="p-line"><div class="p-fill"></div></div>${nodes}</div></div></div>`;
}

/** Rail styles use only the preset palette and the fonts already selected for the reel. */
export function progressCSS({ H, colors }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  return `
      .progress { --p-text: ${c.text}; --p-accent: ${c.accent}; --p-bg: ${c.bg}; position: absolute; opacity: 0; pointer-events: none; color: var(--p-text); font-family: "Inter", sans-serif; }
      .p-shell { width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: ${px(8)}; padding: ${px(12)} ${px(18)}; border: ${px(2)} solid color-mix(in srgb, ${c.text} 34%, transparent); border-radius: ${px(18)}; background: color-mix(in srgb, ${c.bg} 85%, transparent); box-shadow: 0 ${px(12)} ${px(36)} color-mix(in srgb, ${c.bg} 60%, transparent); }
      .p-title { min-height: ${px(48)}; font-family: "Anton", sans-serif; font-size: ${px(48)}; line-height: 1; letter-spacing: 0.02em; text-transform: uppercase; }
      .p-main { display: flex; align-items: center; gap: ${px(20)}; min-height: ${px(68)}; }
      .p-count { flex: none; min-width: ${px(108)}; font-family: "Anton", sans-serif; font-size: ${px(48)}; line-height: 1; font-variant-numeric: tabular-nums; }
      .p-current { color: var(--p-accent); }
      .p-track { position: relative; flex: 1; height: ${px(72)}; display: flex; align-items: flex-start; justify-content: space-between; }
      .p-line { position: absolute; left: ${px(14)}; right: ${px(14)}; top: ${px(12)}; height: ${px(5)}; background: color-mix(in srgb, ${c.text} 20%, transparent); transform-origin: 0 50%; }
      .p-fill { width: 100%; height: 100%; background: var(--p-accent); transform: scaleX(0); transform-origin: 0 50%; }
      .p-node { position: relative; z-index: 1; min-width: 0; flex: 1; display: flex; flex-direction: column; align-items: center; gap: ${px(8)}; transform-origin: 50% ${px(12)}; }
      .p-dot { width: ${px(24)}; height: ${px(24)}; box-sizing: border-box; border: ${px(5)} solid var(--p-bg); border-radius: 50%; background: var(--p-text); box-shadow: 0 0 0 ${px(2)} color-mix(in srgb, ${c.text} 54%, transparent); }
      .p-label { width: 100%; min-height: ${px(48)}; overflow: hidden; font-size: ${px(48)}; font-weight: 800; line-height: 1; text-align: center; text-transform: uppercase; white-space: nowrap; text-overflow: ellipsis; }
      .progress.vertical .p-shell { padding: ${px(18)} ${px(14)}; }
      .progress.vertical .p-main { flex: 1; align-items: stretch; flex-direction: column; gap: ${px(12)}; }
      .progress.vertical .p-count { min-width: 0; }
      .progress.vertical .p-track { height: auto; min-height: 0; flex-direction: column; align-items: stretch; }
      .progress.vertical .p-line { left: ${px(10)}; right: auto; top: ${px(12)}; bottom: ${px(12)}; width: ${px(5)}; height: auto; transform-origin: 50% 0; }
      .progress.vertical .p-fill { width: 100%; height: 100%; transform: scaleY(0); transform-origin: 50% 0; }
      .progress.vertical .p-node { flex: 1; flex-direction: row; align-items: flex-start; gap: ${px(12)}; }
      .progress.vertical .p-dot { flex: none; }
      .progress.vertical .p-label { text-align: left; }
      .progress.skin-receipt .p-shell, .progress.skin-type .p-shell, .progress.skin-case .p-shell { border-radius: 0; font-family: "Courier Prime", monospace; }
      .progress.skin-paper .p-shell { border-width: ${px(4)}; font-family: "Permanent Marker", sans-serif; }
      .progress.skin-editorial .p-title, .progress.skin-editorial .p-label { font-family: "DM Serif Display", serif; text-transform: none; }
      .progress.skin-panel .p-shell, .progress.skin-blueprint .p-shell, .progress.skin-redline .p-shell { border-radius: 0; border-style: dashed; }`;
}

/** Deterministic hook draw and milestone pulses (all motion is quantized to whole 30 fps frames). */
export const PROGRESS_JS = `
        PLAN.progress.forEach((p, i) => {
          const el = document.getElementById("progress-" + i);
          const nodes = [...el.querySelectorAll(".p-node")];
          const labels = [...el.querySelectorAll(".p-label")];
          const fill = el.querySelector(".p-fill");
          const current = el.querySelector(".p-current");
          const f = (frames) => frames / (PLAN.fps || 30);
          const vertical = el.classList.contains("vertical");
          tl.fromTo(el, { opacity: 0, scale: 0.985 }, { opacity: 1, scale: 1, duration: f(8), ease: "power3.out" }, p.start);
          tl.fromTo(el.querySelector(".p-line"), vertical ? { scaleY: 0 } : { scaleX: 0 }, vertical ? { scaleY: 1, duration: f(8), ease: "power3.out" } : { scaleX: 1, duration: f(8), ease: "power3.out" }, p.start);
          nodes.forEach((node, k) => {
            const land = [5, 8, 12, 12][k];
            tl.fromTo(node, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: f(3), ease: "power3.out" }, p.start + f(land - 3));
          });
          labels.forEach((label, k) => tl.fromTo(label, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: f(6), ease: "power3.out" }, p.start + f(k * 3)));
          tl.to(el, { opacity: 0, duration: f(5), ease: "power2.in" }, Math.max(p.start, p.hookEnd - f(5)));
          p.pulses.forEach((pulse, active) => {
            if (pulse.hidden) return;
            const at = pulse.at;
            tl.set(el, { opacity: 0, scale: 0.985 }, at);
            nodes.forEach((node, k) => {
              tl.set(node, { opacity: k < active ? 0.45 : k === active ? 1 : 0.18, scale: 1 }, at);
              tl.set(node.querySelector(".p-dot"), { backgroundColor: k === active ? "var(--p-accent)" : "var(--p-text)" }, at);
              tl.set(labels[k], { opacity: k < active ? 0.45 : k === active ? 1 : 0 }, at);
            });
            if (current) tl.set(current, { textContent: String(active + 1).padStart(2, "0") }, at);
            tl.fromTo(el, { opacity: 0, scale: 0.985 }, { opacity: 1, scale: 1, duration: f(8), ease: "power3.out" }, at);
            tl.fromTo(fill, vertical ? { scaleY: 0 } : { scaleX: 0 }, vertical ? { scaleY: (active + 1) / nodes.length, duration: f(10), ease: "power2.inOut" } : { scaleX: (active + 1) / nodes.length, duration: f(10), ease: "power2.inOut" }, at + f(5));
            const dot = nodes[active].querySelector(".p-dot");
            tl.to(dot, { scale: 1.15, duration: f(3), ease: "expo.out" }, at + f(8));
            tl.to(dot, { scale: 1, duration: f(3), ease: "power2.out" }, at + f(11));
            tl.to(el, { opacity: 0, duration: f(5), ease: "power2.in" }, at + 1.4 - f(5));
          });
        });`;

/**
 * CSS for the cards at canvas size W x H. Two modes: "full" takes the screen (content in the upper two thirds,
 * captions keep the bottom); "overlay" is a compact glass panel in the top third while the footage keeps playing,
 * the way explainer reels drop a payroll card or a checklist over the speaker.
 */
export function graphicsCSS({ W, H, colors, mode = "overlay", captionTop = H * 0.68 }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  const overlay = mode === "overlay" ? `
      .gfx { background: none; }
      .gfx::after { background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0) 42%); }
      .g-box { left: 4%; right: 4%; top: 5.5%; bottom: auto; max-height: 40%; justify-content: flex-start; gap: ${px(24)}; padding: ${px(36)} ${px(40)} ${px(40)}; border-radius: ${px(26)}; background: linear-gradient(180deg, rgba(10,10,12,0.86), rgba(10,10,12,0.78)); border: ${px(2)} solid rgba(255,255,255,0.12); box-shadow: 0 ${px(24)} ${px(60)} rgba(0,0,0,0.55), inset 0 ${px(3)} 0 ${c.accent}; }
      .g-center { align-items: flex-start; text-align: left; }
      .g-eyebrow { font-size: ${px(32)}; }
      .g-stat { line-height: 1; }
      .g-arrow { font-size: ${px(28)}; margin: ${px(-6)} 0; }
      .g-sub { font-size: ${px(44)}; max-width: 100%; }
      .g-fill { width: 100%; height: ${px(10)}; }
      .g-title { font-size: ${px(64)}; }
      .g-rows { gap: ${px(14)}; }
      .g-row { padding: ${px(20)} ${px(24)}; font-size: ${px(48)}; border-radius: ${px(18)}; gap: ${px(18)}; }
      .g-mark { width: ${px(54)}; }
      .g-num { font-size: ${px(30)}; }
      .g-tag { font-size: ${px(22)}; }
      .g-paper { width: 100%; padding: ${px(34)} ${px(36)} ${px(38)}; transform: none; }
      .g-paper-eyebrow { font-size: ${px(22)}; margin-bottom: ${px(14)}; }
      .g-quote { font-size: ${px(54)}; line-height: 1.2; }
      .g-headline { font-size: ${px(82)}; text-align: left; }
      .g-rule { width: ${px(110)}; height: ${px(10)}; }
      .g-steps { flex-direction: row; align-items: stretch; gap: ${px(12)}; width: 100%; }
      .g-node { flex: 1; justify-content: center; padding: ${px(22)} ${px(12)}; font-size: ${px(34)}; text-align: center; gap: ${px(10)}; flex-direction: column; }
      .g-node-num { font-size: ${px(22)}; }
      .g-link { width: ${px(26)}; height: ${px(4)}; align-self: center; background: linear-gradient(90deg, ${c.accent}, ${c.accent}55); }
      .g-icon { width: ${px(44)}; height: ${px(44)}; }
      .g-side { padding: ${px(20)} ${px(20)}; min-height: ${px(120)}; }
      .g-side-label { font-size: ${px(34)}; overflow-wrap: break-word; }
      .g-side-long .g-side-label { font-size: ${px(27)}; }
      .g-side-value { font-size: ${px(54)}; }
      .g-side-note { font-size: ${px(24)}; }
      .g-bar-label { font-size: ${px(30)}; }
      .g-bar-value { font-size: ${px(36)}; }
      .g-bars { gap: ${px(12)}; }
      .g-bubble { font-size: ${px(32)}; padding: ${px(16)} ${px(24)}; }
      .g-post { padding: ${px(24)} ${px(28)} ${px(22)}; }
      .g-post-text { font-size: ${px(36)}; }` : "";
  const band = mode === "band" ? `
      .gfx { background: none; }
      .gfx::after { background: linear-gradient(0deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 30%, rgba(0,0,0,0) 44%); }
      .g-box { left: var(--gx, 56%); right: auto; width: var(--gw, 40%); top: var(--gy, 20%); bottom: auto; max-height: 62%; justify-content: flex-start; gap: ${px(18)}; padding: ${px(28)} ${px(36)} ${px(30)}; border-radius: ${px(22)}; background: linear-gradient(180deg, rgba(10,10,12,0.86), rgba(10,10,12,0.78)); border: ${px(2)} solid rgba(255,255,255,0.12); box-shadow: 0 ${px(24)} ${px(60)} rgba(0,0,0,0.55); border-left: ${px(8)} solid ${c.accent}; }
      .g-center { align-items: flex-start; text-align: left; }
      .g-eyebrow { font-size: ${px(26)}; }
      .g-stat { line-height: 1; }
      .g-sub { font-size: ${px(36)}; max-width: 100%; }
      .g-fill { width: 60%; height: ${px(10)}; }
      .g-title { font-size: ${px(48)}; }
      .g-rows { display: grid; grid-template-columns: 1fr 1fr; gap: ${px(10)} ${px(18)}; }
      .g-row { padding: ${px(14)} ${px(18)}; font-size: ${px(34)}; border-radius: ${px(14)}; gap: ${px(14)}; }
      .g-mark { width: ${px(40)}; }
      .g-num { font-size: ${px(24)}; }
      .g-tag { font-size: ${px(20)}; }
      .g-icon { width: ${px(36)}; height: ${px(36)}; }
      .g-paper { width: 100%; padding: ${px(26)} ${px(30)} ${px(28)}; transform: none; }
      .g-paper-eyebrow { font-size: ${px(20)}; margin-bottom: ${px(10)}; }
      .g-quote { font-size: ${px(40)}; line-height: 1.2; }
      .g-headline { font-size: ${px(64)}; text-align: left; }
      .g-rule { width: ${px(110)}; height: ${px(8)}; }
      .g-steps { flex-direction: row; align-items: stretch; gap: ${px(12)}; width: 100%; }
      .g-node { flex: 1; justify-content: center; padding: ${px(16)} ${px(12)}; font-size: ${px(28)}; text-align: center; gap: ${px(8)}; flex-direction: column; }
      .g-node-num { font-size: ${px(20)}; }
      .g-link { width: ${px(26)}; height: ${px(4)}; align-self: center; background: linear-gradient(90deg, ${c.accent}, ${c.accent}55); }
      .g-compare { grid-template-columns: 1fr 1fr; }
      .g-side { padding: ${px(16)} ${px(18)}; min-height: ${px(100)}; }
      .g-side-label { font-size: ${px(30)}; overflow-wrap: break-word; }
      .g-side-long .g-side-label { font-size: ${px(24)}; }
      .g-side-value { font-size: ${px(46)}; }
      .g-side-note { font-size: ${px(22)}; }
      .g-bar-label { font-size: ${px(26)}; }
      .g-bar-value { font-size: ${px(30)}; }
      .g-bars { gap: ${px(10)}; }
      .g-bar-track { height: ${px(16)}; }
      .g-bubble { font-size: ${px(28)}; padding: ${px(12)} ${px(20)}; max-width: 70%; }
      .g-post { padding: ${px(20)} ${px(24)} ${px(18)}; }
      .g-post-text { font-size: ${px(30)}; }
      .g-chapter { width: var(--gw, 40%); }
      .g-chapter .g-headline { font-size: ${px(72)}; }` : "";
  return `
      .gfx { --u: ${u}px; position: absolute; inset: 0; overflow: hidden; opacity: 0; background: radial-gradient(120% 62% at 50% 34%, ${c.accent}2e 0%, ${c.accent}00 60%), ${c.bg}; color: ${c.text}; font-family: "Inter", sans-serif; }
      .gfx::after { content: ""; position: absolute; inset: 0; background: radial-gradient(90% 60% at 50% 40%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%); pointer-events: none; }
      .g-box { position: absolute; left: 8%; right: 11%; top: 15%; bottom: 46%; display: flex; flex-direction: column; justify-content: center; gap: ${px(34)}; z-index: 1; }
      .g-center { align-items: center; text-align: center; }
      .g-eyebrow { display: inline-flex; align-items: center; gap: ${px(14)}; font-size: ${px(30)}; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: ${c.accent}; }
      .g-dot { width: ${px(12)}; height: ${px(12)}; border-radius: 50%; background: ${c.accent}; box-shadow: 0 0 ${px(18)} ${c.accent}; }
      .g-stat { font-weight: 900; white-space: nowrap; line-height: 0.95; letter-spacing: -0.03em; color: ${c.text}; text-shadow: 0 0 ${px(60)} ${c.accent}66; }
      .g-stat2 { color: ${c.accent}; text-shadow: 0 0 ${px(70)} ${c.accent}88; }
      .g-stat { display: inline-flex; align-items: baseline; font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; transform-origin: 50% 58%; }
      .g-count { display: inline-block; min-width: 1ch; }
      .g-stat-reveal, .g-stat-growth { align-items: stretch; flex-direction: column; }
      .g-value-mask { display: inline-flex; overflow: hidden; }
      .g-value-lock { display: inline-flex; align-items: baseline; transform-origin: 50% 58%; }
      .g-value-line { display: block; width: 100%; height: ${px(8)}; margin-top: ${px(10)}; border-radius: ${px(4)}; background: ${c.accent}; transform-origin: 0 50%; }
      .g-affix { white-space: pre; }
      .g-sym { font-size: 0.6em; align-self: center; margin: 0 0.06em; opacity: 0.9; }
      .g-fill { width: 60%; height: ${px(12)}; border-radius: ${px(6)}; background: rgba(255,255,255,0.12); overflow: hidden; }
      .g-fill-bar { width: 100%; height: 100%; background: ${c.accent}; transform-origin: 0 50%; transform: scaleX(0); }
      .g-ring { --ring: 0%; display: inline-block; width: 0.9em; height: 0.9em; margin-right: 0.18em; align-self: center; border-radius: 50%; background: conic-gradient(from -90deg, ${c.accent} 0 var(--ring), rgba(255,255,255,0.14) var(--ring) 100%); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 16%), #000 0); mask: radial-gradient(farthest-side, transparent calc(100% - 16%), #000 0); }
      .g-arrow { font-size: ${px(34)}; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; opacity: 0.6; margin: ${px(-14)} 0; }
      .g-sub { font-size: ${px(46)}; font-weight: 600; line-height: 1.25; opacity: 0.85; max-width: 90%; }
      .g-title { font-weight: 900; font-size: ${px(84)}; line-height: 1.02; letter-spacing: -0.02em; text-transform: uppercase; text-wrap: balance; }
      .g-gold { color: ${c.accent}; }
      .g-rows { display: flex; flex-direction: column; gap: ${px(20)}; }
      .g-row { position: relative; display: flex; align-items: center; gap: ${px(26)}; padding: ${px(30)} ${px(34)}; border-radius: ${px(22)}; background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03)); border: ${px(2)} solid rgba(255,255,255,0.10); box-shadow: 0 ${px(18)} ${px(50)} rgba(0,0,0,0.45); font-size: ${px(52)}; font-weight: 800; text-transform: uppercase; letter-spacing: -0.005em; }
      .g-row.g-check { border-color: ${c.accent}88; box-shadow: 0 0 ${px(40)} ${c.accent}22, 0 ${px(18)} ${px(50)} rgba(0,0,0,0.45); }
      .g-row.g-strike .g-row-text { opacity: 0.45; }
      .g-row-text { position: relative; flex: 1; }
      .g-strike-line { position: absolute; left: 0; right: 0; top: 52%; height: ${px(5)}; background: ${c.text}; transform-origin: 0 50%; }
      .g-mark { flex: none; width: ${px(64)}; text-align: center; font-weight: 900; }
      .g-check { color: ${c.accent}; }
      .g-x { opacity: 0.5; }
      .g-num { font-size: ${px(34)}; color: ${c.accent}; letter-spacing: 0.06em; }
      .g-tag { flex: none; font-size: ${px(24)}; font-weight: 700; letter-spacing: 0.18em; opacity: 0.6; }
      .g-paper { position: relative; width: 88%; padding: ${px(64)} ${px(60)} ${px(70)}; background: #F5F1E8; color: #141414; border-radius: ${px(10)}; box-shadow: 0 ${px(30)} ${px(80)} rgba(0,0,0,0.55); transform: rotate(-1.2deg); text-align: left; }
      .g-paper-eyebrow { font-size: ${px(24)}; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase; opacity: 0.55; margin-bottom: ${px(22)}; }
      .g-quote { font-size: ${px(62)}; font-weight: 800; line-height: 1.22; letter-spacing: -0.01em; }
      .g-hl { background-image: linear-gradient(${c.accent}, ${c.accent}); background-repeat: no-repeat; background-size: 0% 46%; background-position: 0 88%; padding: 0 0.06em; }
      .g-paper-mark { position: absolute; right: ${px(40)}; bottom: ${px(30)}; width: ${px(40)}; height: ${px(8)}; border-radius: ${px(4)}; background: ${c.accent}; }
      .g-headline { font-weight: 900; font-size: ${px(104)}; line-height: 1.0; letter-spacing: -0.02em; text-transform: uppercase; text-wrap: balance; }
      .g-rule { width: ${px(150)}; height: ${px(12)}; border-radius: ${px(6)}; background: ${c.accent}; transform-origin: 50% 50%; }
      .g-steps { display: flex; flex-direction: column; align-items: center; }
      .g-node { display: inline-flex; align-items: center; gap: ${px(20)}; padding: ${px(26)} ${px(40)}; border-radius: ${px(18)}; background: rgba(255,255,255,0.06); border: ${px(2)} solid rgba(255,255,255,0.14); font-size: ${px(50)}; font-weight: 800; text-transform: uppercase; box-shadow: 0 ${px(18)} ${px(50)} rgba(0,0,0,0.45); }
      .g-node-last { border-color: ${c.accent}; box-shadow: 0 0 ${px(50)} ${c.accent}33, 0 ${px(18)} ${px(50)} rgba(0,0,0,0.45); }
      .g-node-num { font-size: ${px(28)}; color: ${c.accent}; letter-spacing: 0.08em; }
      .g-link { width: ${px(4)}; height: ${px(70)}; background: linear-gradient(${c.accent}, ${c.accent}55); transform-origin: 50% 0; }
      .g-icon { flex: none; width: ${px(52)}; height: ${px(52)}; transform-origin: 50% 50%; }
      .g-icon path { fill: none; stroke: ${c.accent}; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .gfx.gfx-timed.gfx-list .g-box, .gfx.gfx-timed.gfx-steps .g-box { left: ${px(76)}; right: ${px(140)}; top: ${px(200)}; bottom: auto; max-height: ${px(Math.max(300, captionTop / u - 260))}; box-sizing: border-box; overflow: hidden; transform-origin: 50% 50%; }
      .gfx.gfx-timed .g-rows, .gfx.gfx-timed .g-steps { display: flex; flex-direction: column; align-items: stretch; gap: ${px(12)}; width: 100%; }
      .gfx.gfx-timed .g-live-item { position: relative; display: flex; align-items: center; min-height: ${px(62)}; padding-left: ${px(34)}; transform-origin: 0 50%; }
      .gfx.gfx-timed .g-item-text { flex: 1; min-width: 0; opacity: 0; color: ${c.accent}; transform-origin: 0 50%; }
      .gfx.gfx-timed .g-item-dot { position: absolute; left: 0; top: 50%; width: ${px(16)}; height: ${px(16)}; margin-top: -${px(8)}; border-radius: 50%; background: ${c.accent}; box-shadow: 0 0 ${px(16)} ${c.accent}88; opacity: 0; }
      .gfx.gfx-timed .g-live-connector { position: absolute; left: ${px(7)}; bottom: 50%; width: ${px(3)}; height: calc(50% + ${px(20)}); background: ${c.accent}; transform: scaleY(0); transform-origin: 50% 100%; opacity: 0.75; }
      .gfx.gfx-timed .g-live-item.g-item-done .g-item-text { opacity: 0.55; color: ${c.text}; }
      .gfx.gfx-timed.gfx-steps .g-node { justify-content: flex-start; min-height: ${px(62)}; padding: ${px(16)} ${px(22)}; font-size: ${px(48)}; text-align: left; flex-direction: row; }
      .g-compare { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: ${px(96)}; width: 100%; }
      .g-side { position: relative; padding: ${px(28)} ${px(26)}; border-radius: ${px(20)}; background: rgba(255,255,255,0.06); border: ${px(2)} solid rgba(255,255,255,0.12); text-align: left; min-height: ${px(150)}; }
      .g-side-b { background: linear-gradient(180deg, ${c.accent}2a, ${c.accent}14); border-color: ${c.accent}aa; clip-path: inset(0 100% 0 0); }
      .g-side-label { font-size: ${px(40)}; font-weight: 900; text-transform: uppercase; line-height: 1.05; }
      .g-side-a .g-side-label { opacity: 0.7; }
      .g-side-b .g-side-label { color: ${c.accent}; }
      .g-side-value { margin-top: ${px(10)}; font-size: ${px(64)}; font-weight: 900; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
      .g-side-bar { margin-top: ${px(12)}; height: ${px(10)}; border-radius: ${px(5)}; background: rgba(255,255,255,0.12); overflow: hidden; }
      .g-side-fill { width: var(--w); height: 100%; background: ${c.text}; transform-origin: 0 50%; transform: scaleX(0); opacity: 0.6; }
      .g-side-b .g-side-fill { background: ${c.accent}; opacity: 1; }
      .g-side-note { margin-top: ${px(10)}; font-size: ${px(26)}; font-weight: 600; opacity: 0.75; }
      .g-vs { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(0); width: ${px(74)}; height: ${px(74)}; border-radius: 50%; display: grid; place-items: center; background: ${c.bg}; border: ${px(3)} solid ${c.accent}; color: ${c.accent}; font-size: ${px(26)}; font-weight: 900; letter-spacing: 0.08em; z-index: 1; }
      .g-compare-dynamic { gap: ${px(72)}; align-items: stretch; }
      .g-compare-dynamic .g-side { display: flex; flex-direction: column; justify-content: center; min-height: ${px(210)}; overflow: hidden; }
      .g-compare-dynamic .g-side-a { clip-path: inset(0 100% 0 0); }
      .g-compare-dynamic.g-from-right .g-side-a { clip-path: inset(0 0 0 100%); }
      .g-compare-dynamic .g-side-b { clip-path: inset(0 100% 0 0); }
      .g-compare-dynamic .g-side-label, .g-compare-dynamic .g-side-long .g-side-label, .g-compare-dynamic .g-side-note { font-size: ${px(48)}; line-height: 1.08; }
      .g-compare-dynamic .g-pivot { position: absolute; left: 50%; top: 0; bottom: 0; width: ${px(72)}; transform: translateX(-50%); display: grid; place-items: center; z-index: 2; pointer-events: none; }
      .g-compare-dynamic .g-divider { width: ${px(5)}; height: 100%; background: ${c.accent}; transform: scaleY(0); transform-origin: 50% 0; }
      .g-compare-dynamic .g-versus { position: absolute; display: grid; place-items: center; width: ${px(72)}; height: ${px(72)}; border-radius: 50%; background: ${c.bg}; border: ${px(3)} solid ${c.accent}; color: ${c.accent}; font-size: ${px(48)}; font-weight: 900; transform: scale(0); }
      .g-compare-dynamic .g-pivot-arrow { color: ${c.accent}; font-size: ${px(76)}; font-weight: 900; opacity: 0; }
      .g-compare-dynamic .g-side-cross { position: absolute; left: 8%; right: 8%; top: 50%; height: ${px(6)}; background: ${c.accent}; transform: rotate(-7deg) scaleX(0); transform-origin: 0 50%; }
      .g-bars { display: flex; flex-direction: column; gap: ${px(16)}; width: 100%; }
      .g-bar-head { display: flex; justify-content: space-between; align-items: baseline; gap: ${px(16)}; margin-bottom: ${px(8)}; }
      .g-bar-label { font-size: ${px(34)}; font-weight: 800; text-transform: uppercase; opacity: 0.8; }
      .g-bar-value { display: inline-block; transform-origin: 100% 50%; font-size: ${px(40)}; font-weight: 900; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
      .g-bar-track { height: ${px(22)}; border-radius: ${px(11)}; background: rgba(255,255,255,0.12); overflow: hidden; }
      .g-bar-fill { width: var(--w); height: 100%; border-radius: ${px(11)}; background: rgba(255,255,255,0.55); transform-origin: 0 50%; transform: scaleX(0); }
      .g-bar-hi .g-bar-fill { background: ${c.accent}; }
      .g-bar-hi .g-bar-label, .g-bar-hi .g-bar-value { color: ${c.accent}; opacity: 1; }
      .g-thread { position: relative; display: flex; flex-direction: column; gap: ${px(12)}; width: 100%; font-family: -apple-system, "Inter", sans-serif; }
      .g-thread-head { display: flex; align-items: center; gap: ${px(14)}; font-size: ${px(28)}; font-weight: 600; opacity: 0.85; margin-bottom: ${px(6)}; }
      .g-avatar { width: ${px(48)}; height: ${px(48)}; border-radius: 50%; background: #8e8e93; color: #fff; display: grid; place-items: center; font-size: ${px(26)}; font-weight: 700; }
      .g-bubble { position: relative; max-width: 82%; padding: ${px(18)} ${px(26)}; border-radius: ${px(30)}; font-size: ${px(34)}; font-weight: 500; line-height: 1.25; text-transform: none; letter-spacing: 0; transform-origin: 0 100%; }
      .g-bubble.g-them { align-self: flex-start; background: #2a2a2e; color: #fff; border-bottom-left-radius: ${px(8)}; }
      .g-bubble.g-me { align-self: flex-end; background: #0a80f8; color: #fff; border-bottom-right-radius: ${px(8)}; transform-origin: 100% 100%; }
      .g-typing { position: absolute; left: 0; top: 0; display: flex; gap: ${px(8)}; padding: ${px(18)} ${px(24)}; border-radius: ${px(30)}; background: #2a2a2e; opacity: 0; }
      .g-typing i { width: ${px(14)}; height: ${px(14)}; border-radius: 50%; background: #8e8e93; }
      .g-post { width: 100%; padding: ${px(30)} ${px(32)} ${px(26)}; border-radius: ${px(24)}; background: #15202b; border: ${px(2)} solid #38444d; box-shadow: 0 ${px(18)} ${px(50)} rgba(0,0,0,0.5); text-align: left; text-transform: none; }
      .g-post-head { display: flex; align-items: center; gap: ${px(16)}; margin-bottom: ${px(18)}; }
      .g-post-avatar { width: ${px(64)}; height: ${px(64)}; border-radius: 50%; background: linear-gradient(135deg, ${c.accent}, ${c.accent}55); }
      .g-post-who { display: flex; flex-direction: column; line-height: 1.1; }
      .g-post-name { display: inline-flex; align-items: center; gap: ${px(6)}; font-size: ${px(30)}; font-weight: 800; color: #e7e9ea; }
      .g-post-badge { width: ${px(30)}; height: ${px(30)}; fill: #1d9bf0; }
      .g-post-tick { fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .g-post-handle { font-size: ${px(24)}; color: #8b98a5; font-weight: 500; }
      .g-post-text { font-size: ${px(40)}; font-weight: 600; line-height: 1.25; color: #e7e9ea; }
      .g-post-foot { display: flex; align-items: center; gap: ${px(10)}; margin-top: ${px(18)}; font-size: ${px(30)}; color: #8b98a5; }
      .g-post-heart { display: inline-block; transform-origin: 50% 50%; }
      .g-post-heart.lit { color: #f91880; }${overlay}${band}`;
}

/** Proof threads are brand artifacts, not phone screenshots; this CSS is emitted only when a proof card exists. */
export function proofMessageCSS({ H, colors, captionTop = H * 0.72 }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  const maxHeight = Math.max(360, Math.round(captionTop - 200 * u - 40 * u));
  return `
      .gfx.gfx-message-proof { background: none; color: ${c.text}; }
      .gfx.gfx-message-proof::after { background: linear-gradient(180deg, color-mix(in srgb, ${c.bg} 52%, transparent) 0%, color-mix(in srgb, ${c.bg} 18%, transparent) 34%, transparent 48%); }
      .gfx.gfx-message-proof .g-box.g-proof { left: ${px(76)}; right: auto; top: ${px(200)}; bottom: auto; width: ${px(864)}; max-height: ${maxHeight}px; box-sizing: border-box; overflow: hidden; justify-content: flex-start; align-items: stretch; gap: ${px(12)}; padding: ${px(26)} ${px(32)} ${px(30)}; border-radius: ${px(24)}; border: ${px(2)} solid ${c.text}; background: color-mix(in srgb, ${c.bg} 94%, transparent); color: ${c.text}; box-shadow: 0 ${px(18)} ${px(52)} color-mix(in srgb, ${c.bg} 72%, transparent); text-align: left; }
      .gfx.gfx-message-proof .g-proof-label { font-size: ${px(24)}; line-height: 1; font-weight: 800; letter-spacing: 0.2em; color: ${c.accent}; }
      .gfx.gfx-message-proof .g-proof-context { min-height: ${px(52)}; font-size: ${px(48)}; line-height: 1.08; font-weight: 850; letter-spacing: -0.01em; text-transform: uppercase; color: ${c.text}; }
      .gfx.gfx-message-proof .g-proof-thread { display: flex; flex-direction: column; align-items: stretch; gap: ${px(12)}; width: 100%; }
      .gfx.gfx-message-proof .g-proof-beat { position: relative; display: flex; min-height: ${px(62)}; align-items: flex-end; opacity: 0; }
      .gfx.gfx-message-proof .g-proof-beat.g-me { justify-content: flex-end; }
      .gfx.gfx-message-proof .g-proof-bubble { max-width: 82%; padding: ${px(16)} ${px(22)}; border-radius: ${px(22)}; font-size: ${px(48)}; font-weight: 700; line-height: 1.16; transform-origin: 0 100%; background: ${c.text}; color: ${c.bg}; }
      .gfx.gfx-message-proof .g-me .g-proof-bubble { transform-origin: 100% 100%; background: ${c.accent}; color: ${c.bg}; }
      .gfx.gfx-message-proof .g-proof-typing { position: absolute; left: 0; bottom: ${px(8)}; display: flex; gap: ${px(7)}; padding: ${px(16)} ${px(20)}; border-radius: ${px(22)}; background: ${c.text}; opacity: 0; }
      .gfx.gfx-message-proof .g-me .g-proof-typing { left: auto; right: 0; background: ${c.accent}; }
      .gfx.gfx-message-proof .g-proof-typing i { width: ${px(12)}; height: ${px(12)}; border-radius: 50%; background: ${c.bg}; }
      .gfx.gfx-message-proof .g-proof-outcome { position: relative; align-self: flex-start; margin-top: ${px(8)}; padding-bottom: ${px(10)}; font-size: ${px(48)}; font-weight: 850; line-height: 1.12; color: ${c.text}; opacity: 0; }
      .gfx.gfx-message-proof .g-proof-underline { position: absolute; left: 0; right: 0; bottom: 0; height: ${px(8)}; border-radius: ${px(4)}; background: ${c.accent}; transform-origin: 0 50%; transform: scaleX(0); }`;
}

/** GSAP for the cards (runs inside the composition's timeline script; expects PLAN.graphics and tl). */
export const GRAPHICS_JS = `
        PLAN.graphics.forEach((g, i) => {
          const el = document.getElementById("gfx-" + i);
          const box = el.querySelector(".g-box");
          const ins = el.querySelectorAll(".g-in");
          const fps = PLAN.fps || 30;
          const liveItems = g.items ? [...el.querySelectorAll(".g-live-item")] : [];
          const proof = g.mode === "proof";
          const frame = 1 / fps;
          let t1;
          if (liveItems.length) {
            const closed = PLAN.graphicsSide === "right" ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)";
            tl.set(el, { opacity: 1 }, g.start);
            tl.fromTo(box, { clipPath: closed }, { clipPath: "inset(0 0% 0 0)", duration: 8 / fps, ease: "power3.out", immediateRender: false }, g.start);
            tl.fromTo(ins, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 6 / fps, ease: "power3.out", stagger: 2 / fps }, g.start);
            liveItems.forEach((item, k) => {
              const cue = g.start + g.items[k].at;
              const dot = item.querySelector(".g-item-dot");
              const text = item.querySelector(".g-item-text");
              const connector = item.querySelector(".g-live-connector");
              if (dot) tl.set(dot, { opacity: 1 }, Math.max(g.start, cue - 1 / fps));
              if (k) {
                const previous = liveItems[k - 1].querySelector(".g-item-text");
                tl.to(previous, { opacity: 0.55, color: PLAN.graphicsText, duration: 6 / fps, ease: "power3.out" }, cue);
              }
              tl.fromTo(text, { opacity: 0, y: 12, scale: 1.04, color: PLAN.graphicsAccent }, { opacity: 1, y: 0, scale: 1, color: PLAN.graphicsAccent, duration: 6 / fps, ease: "power3.out", immediateRender: false }, cue);
              if (connector) tl.fromTo(connector, { scaleY: 0 }, { scaleY: 1, duration: 7 / fps, ease: "power2.inOut", immediateRender: false }, cue);
              item.querySelectorAll(".g-strike-line").forEach((s) => tl.fromTo(s, { scaleX: 0 }, { scaleX: 1, duration: 10 / fps, ease: "power2.inOut", immediateRender: false }, cue));
              item.querySelectorAll(".g-icon path").forEach((p) => {
                const L = p.getTotalLength();
                p.style.strokeDasharray = L + " " + L;
                tl.fromTo(p, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: 10 / fps, ease: "power2.inOut", immediateRender: false }, cue);
              });
            });
            if (PLAN.graphicsMode === "overlay") {
              const drop = PLAN.height * 0.11;
              tl.to("#video-wrap", { y: drop, duration: 8 / fps, ease: "power2.out" }, g.start);
              tl.to("#video-wrap", { y: 0, duration: 8 / fps, ease: "power2.inOut" }, g.start + g.duration - 5 / fps);
            }
            t1 = g.start + 8 / fps;
          } else {
            if (proof) tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 8 * frame, ease: "power3.out" }, g.start);
            else tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: "power1.out" }, g.start);
            if (PLAN.graphicsMode === "band") tl.fromTo(box, { y: 28, scale: 0.985 }, { y: 0, scale: 1, duration: 0.32, ease: "power3.out" }, g.start);
            else if (PLAN.graphicsMode !== "overlay") tl.fromTo(box, { scale: 1 }, { scale: 1.035, duration: g.duration, ease: "none" }, g.start);
            else {
              tl.fromTo(box, { y: -24, scale: 0.98 }, { y: 0, scale: 1, duration: proof ? 8 * frame : 0.3, ease: "power3.out" }, g.start);
              // The footage slides down a little while the card is up, so the card never sits on the forehead.
              const drop = PLAN.height * 0.11;
              tl.to("#video-wrap", { y: drop, duration: 0.35, ease: "power2.out" }, g.start);
              tl.to("#video-wrap", { y: 0, duration: 0.35, ease: "power2.inOut" }, g.start + g.duration - 0.2);
            }
${SKINS_JS}
            tl.fromTo(ins, { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 0.42, ease: "power3.out", stagger: Math.min(0.22, 1.1 / Math.max(1, ins.length)) }, g.start + 0.06);
            // Bubbles run on their own clock (typing, then pop), so take them out of the stagger.
            el.querySelectorAll(".g-bubble.g-in").forEach((b) => tl.set(b, { opacity: 0 }, g.start + 0.06));
            t1 = g.start + 0.06 + 0.42 + Math.min(0.22, 1.1 / Math.max(1, ins.length)) * Math.max(0, ins.length - 1);
            el.querySelectorAll(".g-strike-line").forEach((s, k) => tl.fromTo(s, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power2.inOut" }, t1 + 0.1 + k * 0.18));
            el.querySelectorAll(".g-link").forEach((s, k) => tl.fromTo(s, PLAN.graphicsMode === "overlay" ? { scaleX: 0 } : { scaleY: 0 }, PLAN.graphicsMode === "overlay" ? { scaleX: 1, duration: 0.25, ease: "power2.out" } : { scaleY: 1, duration: 0.25, ease: "power2.out" }, g.start + 0.3 + k * 0.2));
            el.querySelectorAll(".g-hl").forEach((s) => tl.fromTo(s, { backgroundSize: "0% 46%" }, { backgroundSize: "100% 46%", duration: 0.5, ease: "power2.inOut" }, t1 + 0.05));
            el.querySelectorAll(".g-rule").forEach((s) => tl.fromTo(s, { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power3.inOut" }, t1));
            // List icons draw on with their row, then settle with a small pop.
            el.querySelectorAll(".g-icon path").forEach((p, k) => {
              const L = p.getTotalLength();
              p.style.strokeDasharray = L + " " + L;
              const at = g.start + 0.2 + k * Math.min(0.22, 1.1 / Math.max(1, ins.length));
              tl.fromTo(p, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: 0.45, ease: "power2.inOut", immediateRender: false }, at);
              tl.fromTo(p.closest(".g-icon"), { scale: 1 }, { scale: 1.12, duration: 0.1, ease: "power2.out", yoyo: true, repeat: 1, immediateRender: false }, at + 0.4);
            });
          }
          // Compare: schema 2 waits for the spoken pivot; an older card keeps its original wipe exactly.
          if (PLAN.graphicsSchema >= 2 && g.pivotAt != null) {
            const frame = 1 / (PLAN.fps || 30);
            const pivot = g.start + g.pivotAt;
            const a = el.querySelector(".g-side-a"), b = el.querySelector(".g-side-b");
            const aFrom = g.faceSide === "right" ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)";
            if (a) tl.fromTo(a, { clipPath: aFrom }, { clipPath: "inset(0 0% 0 0)", duration: 6 * frame, ease: "power3.out", immediateRender: false }, g.start);
            el.querySelectorAll(".g-divider").forEach((d) => tl.fromTo(d, { scaleY: 0 }, { scaleY: 1, duration: 5 * frame, ease: "power2.inOut", immediateRender: false }, pivot));
            el.querySelectorAll(".g-pivot-arrow").forEach((d) => tl.fromTo(d, { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 5 * frame, ease: "power2.inOut", immediateRender: false }, pivot));
            el.querySelectorAll(".g-versus").forEach((v) => tl.fromTo(v, { scale: 0 }, { scale: 1, duration: 3 * frame, ease: "power3.out", immediateRender: false }, pivot + 2 * frame));
            if (b) {
              tl.fromTo(b, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 10 * frame, ease: "power3.out", immediateRender: false }, pivot);
              tl.fromTo(b, { scale: 1 }, { scale: 1.04, duration: 3 * frame, ease: "expo.out", immediateRender: false }, pivot + 10 * frame);
              tl.to(b, { scale: 1, duration: 3 * frame, ease: "power2.out" }, pivot + 13 * frame);
            }
            if (a) tl.to(a, { opacity: 0.5, filter: "grayscale(1)", duration: 5 * frame, ease: "power2.inOut" }, pivot);
            el.querySelectorAll(".g-side-cross").forEach((x) => tl.to(x, { scaleX: 1, duration: 5 * frame, ease: "power2.inOut" }, pivot));
            const sideFills = el.querySelectorAll(".g-side-fill");
            if (sideFills.length === 2) {
              tl.fromTo(sideFills[0], { scaleX: 0 }, { scaleX: 1, duration: 12 * frame, ease: "power3.out", immediateRender: false }, g.start);
              tl.fromTo(sideFills[1], { scaleX: 0 }, { scaleX: 1, duration: 12 * frame, ease: "power3.out", immediateRender: false }, pivot);
            }
          } else {
            el.querySelectorAll(".g-side-b").forEach((b) => tl.fromTo(b, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "sine.inOut", immediateRender: false }, g.start + 0.45));
            el.querySelectorAll(".g-vs").forEach((v) => tl.to(v, { scale: 1, duration: 0.35, ease: "back.out(2)" }, g.start + 0.95));
            el.querySelectorAll(".g-side-fill").forEach((f, k) => tl.fromTo(f, { scaleX: 0 }, { scaleX: 1, duration: 0.85, ease: "power3.out", immediateRender: false }, g.start + 0.5 + k * 0.18));
          }
          el.querySelectorAll(".g-bar-fill").forEach((f, k) => tl.fromTo(f, { scaleX: 0 }, { scaleX: 1, duration: 0.85, ease: "power3.out", immediateRender: false }, g.start + 0.5 + k * 0.18));
          // Message thread: typing dots before each incoming bubble, bubbles pop from their tail.
          const bubbles = el.querySelectorAll(".g-bubble");
          const dots = el.querySelector(".g-typing");
          bubbles.forEach((b, k) => {
            const at = g.start + 0.3 + k * 1.15;
            if (dots && b.classList.contains("g-them")) {
              tl.set(dots, { opacity: 1, y: b.offsetTop }, at - 0.55);
              dots.querySelectorAll("i").forEach((d, j) => tl.fromTo(d, { y: 0 }, { y: -6, duration: 0.18, ease: "sine.inOut", yoyo: true, repeat: 1, immediateRender: false }, at - 0.5 + j * 0.12));
              tl.set(dots, { opacity: 0 }, at);
            }
            tl.fromTo(b, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.32, ease: "back.out(1.8)", immediateRender: false }, at);
          });
          // Proof thread: each exact spoken beat owns its cue. The tray grows, dots type for 12 frames, then the
          // bubble lands from its tail. Reconstructed proof is visibly labelled and never carries phone chrome.
          if (proof) {
            const proofBeats = [...el.querySelectorAll(".g-proof-beat")];
            const proofOutcome = el.querySelector(".g-proof-outcome");
            const pad = parseFloat(getComputedStyle(box).paddingBottom) || 0;
            const top = box.getBoundingClientRect().top;
            const context = el.querySelector(".g-proof-context");
            const baseHeight = Math.ceil(context.getBoundingClientRect().bottom - top + pad);
            const expansions = [];
            proofBeats.forEach((beat, k) => {
              const at = g.start + (g.items[k]?.at || 0);
              const typing = beat.querySelector(".g-proof-typing");
              const bubble = beat.querySelector(".g-proof-bubble");
              expansions.push({ at, height: Math.ceil(beat.getBoundingClientRect().bottom - top + pad) });
              tl.set(beat, { opacity: 1 }, at);
              tl.fromTo(typing, { opacity: 0 }, { opacity: 1, duration: 1 * frame, ease: "power1.out", immediateRender: false }, at);
              typing.querySelectorAll("i").forEach((dot, j) => tl.fromTo(dot, { y: 0 }, { y: -6, duration: 3 * frame, ease: "sine.inOut", yoyo: true, repeat: 1, immediateRender: false }, at + (1 + j * 2) * frame));
              tl.set(typing, { opacity: 0 }, at + 12 * frame);
              tl.fromTo(bubble, { opacity: 0, scale: 0.72 }, { opacity: 1, scale: 1, duration: 8 * frame, ease: "back.out(1.5)", immediateRender: false }, at + 12 * frame);
            });
            if (proofOutcome && g.outcome) {
              const at = g.start + (g.outcome.at || 0);
              expansions.push({ at, height: Math.ceil(proofOutcome.getBoundingClientRect().bottom - top + pad) });
              tl.fromTo(proofOutcome, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 6 * frame, ease: "power3.out", immediateRender: false }, at);
              tl.fromTo(proofOutcome.querySelector(".g-proof-underline"), { scaleX: 0 }, { scaleX: 1, duration: 10 * frame, ease: "power2.inOut", immediateRender: false }, at);
            }
            let height = baseHeight;
            tl.set(box, { height }, g.start);
            expansions.sort((a, b) => a.at - b.at || a.height - b.height).forEach((event) => {
              const next = Math.max(height, event.height);
              if (next > height) tl.fromTo(box, { height }, { height: next, duration: 8 * frame, ease: "power3.out", immediateRender: false }, event.at);
              height = next;
            });
          }
          // Post card: the like lands a beat after the text.
          el.querySelectorAll(".g-post-heart").forEach((h) => {
            tl.fromTo(h, { scale: 1 }, { scale: 1.5, duration: 0.14, ease: "power2.out", yoyo: true, repeat: 1, immediateRender: false }, t1 + 0.5);
            tl.set(h, { className: "g-post-heart lit" }, t1 + 0.5);
          });
          const gfxFrame = 1 / fps;
          if (g.motion === "reveal" || g.motion === "growth") {
            // An exact fact is present in the DOM from its first visible frame. Motion comes from the five-frame
            // bottom mask, seven-frame brand baseline and restrained three-plus-three-frame value lock.
            el.querySelectorAll(".g-value-mask").forEach((m, k) => tl.fromTo(m, { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", duration: 5 * gfxFrame, ease: "power2.inOut", immediateRender: false }, g.start + k * gfxFrame));
            el.querySelectorAll(".g-value-line").forEach((line) => tl.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 7 * gfxFrame, ease: "power2.inOut", immediateRender: false }, g.start));
            if (g.motion === "reveal") el.querySelectorAll(".g-value-lock").forEach((value) => {
              tl.fromTo(value, { scale: 1 }, { scale: 1.04, duration: 3 * gfxFrame, ease: "expo.out", immediateRender: false }, g.start + 5 * gfxFrame);
              tl.to(value, { scale: 1, duration: 3 * gfxFrame, ease: "power2.out" }, g.start + 8 * gfxFrame);
            });
            const ringEase = gsap.parseEase("power3.out");
            el.querySelectorAll(".g-ring").forEach((ring) => {
              const last = 21;
              for (let f = 0; f <= last; f++) tl.set(ring, { "--ring": (parseFloat(ring.dataset.pct) * ringEase(f / last)).toFixed(2) + "%" }, g.start + f * gfxFrame);
            });
          }
          if (g.motion === "growth") {
            // A real from/to claim counts from its spoken start, never zero, with one deterministic value per frame.
            const countEase = gsap.parseEase("power3.out");
            el.querySelectorAll(".g-count[data-from]").forEach((n) => {
              const from = parseFloat(n.dataset.from), to = parseFloat(n.dataset.to), dec = parseInt(n.dataset.dec || "0", 10), commas = n.dataset.commas === "1";
              const fmt = (v) => (commas ? Number(v.toFixed(dec)).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec));
              const at = g.start + 5 * gfxFrame;
              const last = 21;
              for (let f = 0; f <= last; f++) tl.set(n, { textContent: fmt(from + (to - from) * countEase(f / last)) }, at + f * gfxFrame);
              const stat = n.closest(".g-value-lock") || n.closest(".g-bar-value");
              tl.fromTo(stat, { scale: 1 }, { scale: 1.04, duration: 3 * gfxFrame, ease: "expo.out", immediateRender: false }, at + last * gfxFrame);
              tl.to(stat, { scale: 1, duration: 3 * gfxFrame, ease: "power2.out" }, at + (last + 3) * gfxFrame);
            });
          } else if (!g.motion) {
            // Schema 1: preserve the original zero count-up byte for byte.
            const COUNT = Math.min(1.3, Math.max(0.6, g.duration * 0.25));
            const countEase = gsap.parseEase("sine.inOut");
            el.querySelectorAll(".g-count").forEach((n, k) => {
              const to = parseFloat(n.dataset.to), dec = parseInt(n.dataset.dec || "0", 10), commas = n.dataset.commas === "1";
              const fmt = (v) => (commas ? Number(v.toFixed(dec)).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec));
              const at = g.start + 0.16 + k * (COUNT + 0.25);
              const last = Math.max(1, Math.round(COUNT * fps));
              for (let f = 0; f <= last; f++) tl.set(n, { textContent: fmt(to * countEase(f / last)) }, at + COUNT * (f / last));
              const stat = n.closest(".g-stat") || n.closest(".g-bar-value");
              tl.to(stat, { scale: 1.07, duration: 0.165, ease: "power3.out" }, at + COUNT);
              tl.to(stat, { scale: 1, duration: 0.165, ease: "power2.out" }, at + COUNT + 0.165);
              const ring = stat.querySelector(".g-ring");
              if (ring) for (let f = 0; f <= last; f++) tl.set(ring, { "--ring": (parseFloat(ring.dataset.pct) * countEase(f / last)).toFixed(2) + "%" }, at + COUNT * (f / last));
              if (k === 0) el.querySelectorAll(".g-fill-bar").forEach((bar) => tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: COUNT, ease: "sine.inOut" }, at));
            });
          }
          if (liveItems.length || (PLAN.graphicsSchema >= 2 && g.pivotAt != null) || proof) tl.to(el, { opacity: 0, duration: 5 / fps, ease: "power2.in" }, g.start + g.duration - 5 / fps);
          else tl.to(el, { opacity: 0, duration: 0.16, ease: "power1.in" }, g.start + g.duration - 0.16);
        });`;
