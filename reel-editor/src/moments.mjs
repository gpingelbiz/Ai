import { r3 } from "./util.mjs";

/**
 * Clean-edge clip picking (after jevcut, cutawan and ripeclips, all MIT). Claude never writes a timestamp: code
 * numbers every sentence (L012) and every real place a clip could start or end (a sentence end, a pause), Claude
 * points at labels, and code maps labels back to times. Pass 1 finds the moments by their quotable line; pass 2
 * picks, for each moment, the opening among the real boundaries before it and the EARLIEST ending that completes
 * the thought. A gate then rejects openings that lean on something said before (a dangling "that", "and", "so").
 */

const END_MARK = /[.!?]["')\]]*$/;
const TRAIL = /(\.\.\.|…)["')\]]*$/;
// A sentence end, not a trail-off ("But it's...").
const END = { test: (t) => END_MARK.test(t) && !TRAIL.test(t) };

/** Sentences as addressable lines: [{id:"L000", i0, i1, start, end, text}]. A pause of `pause` s also ends one. */
export function sentenceLines(words, { pause = 0.9, maxWords = 40 } = {}) {
  const out = [];
  let i0 = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    if (END.test(String(w.text).trim()) || gap >= pause || i - i0 + 1 >= maxWords || !next) {
      const ws = words.slice(i0, i + 1);
      out.push({ id: `L${String(out.length).padStart(3, "0")}`, i0, i1: i, start: r3(ws[0].start), end: r3(ws[ws.length - 1].end), text: ws.map((x) => x.text).join(" ") });
      i0 = i + 1;
    }
  }
  return out;
}

/**
 * Energy per line, the non-LLM salience from auto-video-editor (MIT): loudness against the recording's median,
 * speech rate against its median, and exclamations. Returns [{id, loud, fast, tag}] with tag "" | "[energy]".
 */
export function lineEnergy(lines, envelope, { top = 0.12 } = {}) {
  const db = envelope?.db || [], step = envelope?.step || 0.02;
  const meanDb = (a, b) => {
    const s = Math.max(0, Math.floor(a / step)), e = Math.min(db.length, Math.ceil(b / step));
    const v = db.slice(s, e).filter((x) => x > -70);
    return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null;
  };
  const rows = lines.map((l) => ({ id: l.id, db: meanDb(l.start, l.end), wps: (l.i1 - l.i0 + 1) / Math.max(0.3, l.end - l.start), bang: /!/.test(l.text) }));
  const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const mDb = med(rows.map((r) => r.db)), mWps = med(rows.map((r) => r.wps));
  // A score per line (dB over the median, plus speech rate over the median, plus an exclamation), and only the top
  // `top` share gets the tag: a hint is useless when half the transcript carries it.
  const words = (l) => l.i1 - l.i0 + 1;
  const score = rows.map((r, k) => (words(lines[k]) < 4 || r.db == null ? -Infinity : (r.db - mDb) / 3 + (mWps > 0 ? (r.wps / mWps - 1) * 2 : 0) + (r.bang ? 1 : 0)));
  const cut = [...score].filter(Number.isFinite).sort((a, b) => b - a)[Math.max(0, Math.floor(rows.length * top) - 1)] ?? Infinity;
  return rows.map((r, k) => {
    const on = Number.isFinite(score[k]) && score[k] >= Math.max(1, cut);
    return { id: r.id, loud: r.db != null && r.db - mDb >= 3, fast: mWps > 0 && r.wps >= 1.25 * mWps, tag: on ? "[energy]" : "" };
  });
}

/** Real places a clip can start or end: before a sentence and after it. [{at, kind, line}] in time order. */
export function cutPoints(lines, words) {
  const pts = [];
  for (const l of lines) {
    const prev = words[l.i0 - 1], next = words[l.i1 + 1];
    // Start just before the first word (inside the silence when there is one); end just after the last word decays.
    const startAt = prev ? Math.max(prev.end, l.start - 0.15) : Math.max(0, l.start - 0.15);
    const endAt = next ? Math.min(next.start, l.end + 0.25) : l.end + 0.25;
    // A real start follows a finished sentence (the line before ended one), not just any pause.
    pts.push({ at: r3(startAt), kind: "start", line: l.id, sentence: !prev || END.test(String(prev.text).trim()) });
    pts.push({ at: r3(endAt), kind: "end", line: l.id, sentence: END.test(l.text.trim()) });
  }
  return pts;
}

/** Pass 1 prompt: find moments by their quotable line. The transcript carries line labels, no times. */
export function momentsPrompt({ lines, energy = [], count, duration, voice = "" }) {
  const tag = new Map(energy.map((e) => [e.id, e.tag]));
  const mark = (l) => `${l.id}${tag.get(l.id) ? " " + tag.get(l.id) : ""}| ${l.text}`;
  return [
    "You are a short-form editor mining one long talking-head recording for Instagram reels. Reply with JSON only; use no tools.",
    `The recording is ${Math.round(duration / 60)} minutes. Find up to ${count * 3} moments that would hold a cold viewer as a 30-90 second reel: a stake early, one idea, a turn or payoff, specifics (numbers, names, real moments), and a line worth quoting. Prefer the speaker being direct; skip warm-ups, housekeeping and thanks. For a question-and-answer, the answer is the moment.`,
    "Each moment is named by its ANCHOR: the one line a viewer would quote. Point at lines by their label (L012); never write times.",
    "Lines marked [energy] were said louder or faster than usual: a hint, not a rule.",
    "Score 0-100 for how well it would hold a cold viewer, and write a hook: 4-8 words, true to what is said, the key phrase in *asterisks*.",
    voice ? `\nVoice:\n${voice.trim()}` : "",
    "",
    ...lines.map(mark),
    "",
    'Reply: {"moments":[{"anchor":"L042","hook":"...","why":"one line","score":0-100}]}',
  ].join("\n");
}

/** The region around an anchor: openings (O labels) up to `before` s earlier, endings (E labels) that keep it in range. */
export function region(lines, points, anchorId, { before = 45, min = 25, max = 90 } = {}) {
  const ai = lines.findIndex((l) => l.id === anchorId);
  if (ai < 0) return null;
  const a = lines[ai];
  // Only whole-sentence boundaries are offered when there are any: a pause mid-sentence is a real silence but not
  // a place a clip can start or finish.
  const whole = (list) => (list.some((p) => p.sentence) ? list.filter((p) => p.sentence) : list);
  const opens = whole(points.filter((p) => p.kind === "start" && p.at <= a.start + 0.01 && p.at >= a.start - before));
  if (!opens.length) return null;
  const earliest = Math.min(...opens.map((p) => p.at));
  const ends = whole(points.filter((p) => p.kind === "end" && p.at >= a.end - 0.01 && p.at - earliest <= max && p.at - a.start <= max));
  if (!ends.length) return null;
  const first = lines.findIndex((l) => l.id === opens[0].line);
  const last = lines.findIndex((l) => l.id === ends[ends.length - 1].line);
  const O = opens.map((p, k) => ({ ...p, label: `O${k + 1}` }));
  const E = ends.map((p, k) => ({ ...p, label: `E${k + 1}` }));
  const text = [];
  for (let k = first; k <= last; k++) {
    const l = lines[k];
    const o = O.find((p) => p.line === l.id);
    const e = E.find((p) => p.line === l.id);
    text.push(`${o ? `«${o.label}» ` : ""}${l.id === anchorId ? ">> " : ""}${l.text}${e ? ` «${e.label}»` : ""}`);
  }
  return { anchor: anchorId, opens: O, ends: E, text: text.join("\n"), min, max };
}

/** Pass 2 prompt: for every region, the opening and the earliest complete ending, by label. */
export function edgesPrompt(regions) {
  return [
    "You are tightening reel clips cut from a long recording. Reply with JSON only; use no tools.",
    "For each region below, the line marked >> is the moment's anchor. «O1», «O2»... mark the real places the clip may START; «E1», «E2»... mark where it may END.",
    "Opening: pick the latest opening that still makes sense to someone who saw nothing before: it must not lean on an earlier line (no dangling 'that', 'this', 'it', 'they', 'and', 'but', 'so' pointing back), and it should put a stake or a question in the first words. If the anchor is an answer, start on the answer or on the shortest setup it needs.",
    "Ending: pick the EARLIEST ending where the thought is complete and the payoff has landed. Never end on a setup, a question, or a half-finished list. Do not run on into the next topic.",
    "If no opening or no ending works, set ok to false and say why.",
    "",
    ...regions.map((r, i) => `=== Region ${i + 1} (anchor ${r.anchor})\n${r.text}`),
    "",
    'Reply: {"edges":[{"region":1,"open":"O2","end":"E3","ok":true,"note":"one line"}]}',
  ].join("\n");
}

// "So" is left out: a story often opens on it ("So I heard this once...") without pointing back at anything.
// Reply words ("No, because...", "Yeah, totally") answer someone the viewer never heard.
const LEANS = new Set(["and", "but", "because", "which", "that", "this", "these", "those", "it", "they", "them", "he", "she", "also", "then", "or", "plus", "no", "yeah", "yes", "yep", "right", "exactly", "okay", "ok", "totally"]);
const firstWord = (text) => String(text).trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "") || "";

/** Code's gate on one clip: [{code, message}] problems with its edges (empty = clean). */
export function edgeProblems(clip, lines, words) {
  const out = [];
  const inside = words.filter((w) => w.start >= clip.start - 0.01 && w.end <= clip.end + 0.01);
  if (!inside.length) return [{ code: "empty", message: "no words in the clip" }];
  const fw = firstWord(inside[0].text);
  if (LEANS.has(fw)) out.push({ code: "leans-back", message: `opens on "${inside[0].text}", which leans on what came before` });
  else if (/[-—]$/.test(String(inside[0].text).trim())) out.push({ code: "leans-back", message: `opens on a false start ("${inside[0].text}")` });
  else if (/^[a-z]/.test(String(inside[0].text).trim()) && !/^i\b/.test(inside[0].text)) {
    const before = words[words.indexOf(inside[0]) - 1];
    if (before && !END.test(String(before.text).trim())) out.push({ code: "leans-back", message: `opens mid-sentence on "${inside[0].text}"` });
  }
  const lastText = String(inside[inside.length - 1].text).trim();
  if (!END.test(lastText)) out.push({ code: "mid-sentence-end", message: `ends on "${lastText}", mid-sentence` });
  if (/\?["')]*$/.test(lastText)) out.push({ code: "ends-on-question", message: "ends on a question" });
  const tail = clip.end - inside[inside.length - 1].end;
  if (tail > 0.6) out.push({ code: "dead-air-end", message: `${r3(tail)} s of silence after the last word` });
  const head = inside[0].start - clip.start;
  if (head > 0.5) out.push({ code: "dead-air-start", message: `${r3(head)} s before the first word` });
  return out;
}

/**
 * Turn Claude's picks into clips: map labels to times, enforce length, apply the gate (an opening that leans back
 * moves to the next opening that does not, when one keeps the clip in range), drop overlaps, best first.
 */
export function resolveClips({ moments, regions, edges, lines, words, duration, count, min = 25, max = 90, dropped = [] }) {
  const out = [];
  regions.forEach((r, k) => {
    const m = moments[k];
    const drop = (why) => dropped.push({ anchor: m?.anchor, hook: m?.hook, why });
    if (!r) return drop("no real boundaries around the anchor");
    const e = (edges || []).find((x) => Number(x.region) === k + 1);
    if (!e) return drop("no edges came back");
    if (e.ok === false) return drop(`Claude: ${e.note || "no clean edges"}`);
    let oi = r.opens.findIndex((p) => p.label === e.open);
    let end = r.ends.find((p) => p.label === e.end);
    if (oi < 0 || !end) return drop(`unknown label ${e.open}/${e.end}`);
    // Too short: run on to the next complete ending that reaches the minimum, if one is in the region.
    if (end.at - r.opens[oi].at < min) end = r.ends.find((p) => p.at - r.opens[oi].at >= min) || end;
    const startOf = (i) => r.opens[i].at;
    let clip = { start: startOf(oi), end: Math.min(duration, end.at) };
    // The gate: an opening that leans back moves to the next clean opening that keeps the clip long enough.
    let problems = edgeProblems(clip, lines, words);
    if (problems.some((p) => p.code === "leans-back")) {
      for (let j = oi + 1; j < r.opens.length; j++) {
        const cand = { start: startOf(j), end: clip.end };
        if (cand.end - cand.start < min) break;
        if (!edgeProblems(cand, lines, words).some((p) => p.code === "leans-back")) { clip = cand; oi = j; problems = edgeProblems(clip, lines, words); break; }
      }
    }
    // An ending mid-sentence or on a question runs on to the next whole sentence that ends without one.
    if (problems.some((p) => p.code === "mid-sentence-end" || p.code === "ends-on-question")) {
      for (const p of r.ends.filter((x) => x.at > clip.end + 0.01)) {
        const cand = { start: clip.start, end: Math.min(duration, p.at) };
        if (cand.end - cand.start > max + 5) break;
        const pr = edgeProblems(cand, lines, words);
        if (!pr.some((x) => x.code === "mid-sentence-end" || x.code === "ends-on-question")) { clip = cand; problems = pr; break; }
      }
    }
    const len = clip.end - clip.start;
    if (len < min || len > max + 5) return drop(`${r3(len)} s long`);
    if (out.some((o) => clip.start < o.end && clip.end > o.start)) return drop("overlaps a better clip");
    out.push({ start: r3(clip.start), end: r3(clip.end), hook: String(m.hook || "").trim(), why: String(m.why || "").trim(), score: Math.max(0, Math.min(100, Math.round(Number(m.score) || 0))), anchor: r.anchor, edges: { open: r.opens[oi].label, end: e.end, note: String(e.note || "") }, problems });
    if (problems.length) out[out.length - 1].problems = problems;
  });
  // A clip with an edge problem ranks 10 points lower per problem, so a clean spare beats it.
  const rank = (c) => c.score - 10 * (c.problems?.length || 0);
  return out.sort((a, b) => rank(b) - rank(a)).slice(0, count);
}

/** One line per clip for the log and clips.txt. */
export function describeEdges(c) {
  return c.problems?.length ? `edges: ${c.problems.map((p) => p.message).join("; ")}` : "edges: clean start and finish";
}
