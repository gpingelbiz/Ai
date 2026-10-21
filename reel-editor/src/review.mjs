import fs from "node:fs";
import path from "node:path";
import { r3 } from "./util.mjs";

/**
 * "Hear every word": the main transcript gets a second opinion from a different engine, and every place the two
 * disagree, or where either engine was unsure, goes into review.txt with its time in the finished reel.
 * Two independent engines rarely make the same mistake, so a disagreement is almost always a mis-hear.
 */

const FILLERS = new Set(["um", "uh", "uhm", "hmm", "mm", "mhm", "ah", "er", "erm"]);
const NUMBERS = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50", hundred: "100" };
// Spoken-form spellings that are the same words ("gonna" / "going to").
const SAME = [[/\bgonna\b/g, "going to"], [/\bwanna\b/g, "want to"], [/\bgotta\b/g, "got to"], [/\bkinda\b/g, "kind of"], [/\bsorta\b/g, "sort of"],
  [/\blemme\b/g, "let me"], [/\bgimme\b/g, "give me"], [/\bcause\b/g, "because"], [/\bok\b/g, "okay"], [/\byeah\b/g, "yes"]];
const spoken = (s) => SAME.reduce((acc, [re, to]) => acc.replace(re, to), String(s).toLowerCase().replace(/[’']/g, ""));
const tok = (t) => {
  const s = String(t).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9&$%]/g, "");
  return NUMBERS[s] || s;
};

/** "auto" means ElevenLabs Scribe when a key is set, otherwise local faster-whisper. */
export function resolveEngine(engine = "auto", env = process.env) {
  if (engine !== "auto") return engine;
  return env.ELEVENLABS_API_KEY ? "elevenlabs" : "faster-whisper";
}

/** The engine that gives the second opinion for a given main engine, or null when none is available. */
export function secondEngine(primary, env = process.env) {
  if (primary === "elevenlabs") return "faster-whisper";
  return env.ELEVENLABS_API_KEY ? "elevenlabs" : null;
}

/** Word-level alignment (longest common subsequence on normalized tokens, fillers ignored). */
function align(a, b) {
  const A = a.map((w) => tok(w.text));
  const B = b.map((w) => tok(w.text));
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const join = (ws) => ws.map((w) => w.text).join(" ");
const bracket = (ws) => `[${join(ws) || "(nothing)"}]`;

/**
 * Places to check, on the main transcript's (raw) timeline:
 * - "differs": the engines heard different words, or one heard words the other did not
 * - "unsure":  the main engine's confidence for a word is below minProb
 */
export function compareTranscripts(primary, second, { minProb = 0.5, context = 3 } = {}) {
  const P = primary.filter((w) => !FILLERS.has(tok(w.text)));
  const items = [];
  const covered = new Set();
  if (second && second.length) {
    const S = second.filter((w) => !FILLERS.has(tok(w.text)));
    const pairs = align(P, S);
    pairs.push([P.length, S.length]);
    let pi = 0, si = 0;
    for (const [a, b] of pairs) {
      if (a > pi || b > si) {
        const heard = P.slice(pi, a);
        const alt = S.slice(si, b);
        const flat = (ws) => spoken(join(ws)).split(/\s+/).map(tok).join("");
        const same = flat(heard) === flat(alt);
        if (!same) {
          const anchor = heard[0] || P[pi] || P[pi - 1] || alt[0];
          const end = heard.length ? heard[heard.length - 1].end : anchor.end;
          items.push({
            kind: "differs",
            start: r3(anchor.start),
            end: r3(end),
            heard: `${join(P.slice(Math.max(0, pi - context), pi))} ${bracket(heard)} ${join(P.slice(a, a + context))}`.replace(/\s+/g, " ").trim(),
            alt: `${join(S.slice(Math.max(0, si - context), si))} ${bracket(alt)} ${join(S.slice(b, b + context))}`.replace(/\s+/g, " ").trim(),
          });
          for (let k = pi; k < Math.max(a, pi + 1); k++) covered.add(k);
        }
      }
      pi = a + 1;
      si = b + 1;
    }
  }
  for (let i = 0; i < P.length; i++) {
    const p = P[i].prob;
    if (p == null || p >= minProb || covered.has(i)) continue;
    let k = i;
    while (k + 1 < P.length && P[k + 1].prob != null && P[k + 1].prob < minProb) k++;
    items.push({
      kind: "unsure",
      start: r3(P[i].start),
      end: r3(P[k].end),
      heard: `${join(P.slice(Math.max(0, i - context), i))} [${join(P.slice(i, k + 1))}] ${join(P.slice(k + 1, k + 1 + context))}`.replace(/\s+/g, " ").trim(),
      prob: r3(Math.min(...P.slice(i, k + 1).map((w) => w.prob))),
    });
    for (let x = i; x <= k; x++) covered.add(x);
    i = k;
  }
  return items.sort((x, y) => x.start - y.start);
}

/** Raw-clip time → time in the cut reel, or null when that moment was cut out. */
export function rawToClean(t, segments) {
  let offset = 0;
  for (const s of segments) {
    if (t >= s.start - 0.05 && t <= s.end + 0.05) return r3(offset + Math.max(0, t - s.start));
    offset += s.end - s.start;
  }
  return null;
}

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Write review.json (always) and review.txt (only when there is something to check). Returns the reel-time items. */
export function writeReview(workDir, { items = [], segments, primaryEngine, secondEngineName, title = "" }) {
  const inReel = items
    .map((it) => ({ ...it, reelTime: segments ? rawToClean(it.start, segments) : it.start }))
    .filter((it) => it.reelTime != null);
  fs.writeFileSync(path.join(workDir, "review.json"), JSON.stringify({ primaryEngine, secondEngine: secondEngineName, items: inReel }, null, 2) + "\n");
  const txt = path.join(workDir, "review.txt");
  if (!inReel.length) {
    fs.rmSync(txt, { force: true });
    return inReel;
  }
  const names = { elevenlabs: "ElevenLabs Scribe", "faster-whisper": "Whisper" };
  const lines = [
    `${title || "Reel"}: ${inReel.length} spot${inReel.length === 1 ? "" : "s"} to check`,
    `Main transcript: ${names[primaryEngine] || primaryEngine}. Second opinion: ${names[secondEngineName] || secondEngineName || "none"}.`,
    "Times are in the finished reel. The words in [brackets] are the ones in question.",
    "",
  ];
  for (const it of inReel) {
    if (it.kind === "differs") {
      lines.push(`${mmss(it.reelTime)}  caption says:  ${it.heard}`);
      lines.push(`      other engine:  ${it.alt}`);
    } else {
      lines.push(`${mmss(it.reelTime)}  unsure:        ${it.heard}`);
    }
    lines.push("");
  }
  lines.push("To fix a caption, edit its text in plan.json and run: reel build <work folder>");
  fs.writeFileSync(txt, lines.join("\n") + "\n");
  return inReel;
}
