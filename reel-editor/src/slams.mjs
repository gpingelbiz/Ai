import { r3 } from "./util.mjs";
import { norm } from "./text.mjs";

/**
 * Climax words: one spoken word (or a two-word phrase) slams in big in the top third for about a second, on the
 * beat it is said, the way explainer reels stamp "$10,000" or "ACCOUNTABILITY" over the speaker. The words are
 * the gold words the captions already carry (dictionary terms, power words, numbers), so nothing new is written;
 * the strongest ones win, spaced out, never under a card, a cutaway or the hook.
 */

const DISPLAY_MAX = 16;
// Everyday gold words that are not worth a stamp on their own ("one thing", "first", "why").
const WEAK = new Set("one two three four five six seven eight nine ten first last next why what that this thing things here there never always".split(" "));

function rankWord(text, dict) {
  const t = norm(text);
  if (!t) return 0;
  if ((dict.powerWords || []).some((p) => norm(p) === t)) return 3;
  if (/^\$?\d/.test(t) || /\$/.test(text)) return 2.5;
  if ((dict.terms || []).some((term) => norm(term.split(/\s+/)[0]) === t)) return 2;
  return 1;
}

const tidy = (s) => String(s).replace(/[.,!?;:"]+$/g, "").replace(/^["(]+/g, "");

/** Every run of gold words in a line is one candidate: {line, t, end, text, rank}. */
export function slamCandidates(groups, dict = {}) {
  const out = [];
  groups.forEach((g, i) => {
    const words = g.words || [];
    for (let j = 0; j < words.length; j++) {
      if (!words[j].key) continue;
      let k = j;
      while (k + 1 < words.length && words[k + 1].key && k - j < 2) k++;
      const run = words.slice(j, k + 1);
      const text = run.map((w) => tidy(w.text)).join(" ").trim();
      const rank = Math.max(...run.map((w) => rankWord(w.text, dict)));
      const weak = rank < 2 && (WEAK.has(norm(text)) || norm(text).length < 5);
      if (text && text.length <= DISPLAY_MAX && !weak) out.push({ line: i, t: r3(run[0].start ?? g.start), end: r3(run[run.length - 1].end ?? g.end), text, rank });
      j = k;
    }
  });
  return out;
}

/**
 * Pick the slams: strongest first, then by time; at least `minSpacing` apart, after the hook, clear of `busy`
 * (cards and cutaways), never in the last 1.5 s. A word on a punch-in line gets a bump so the camera and the
 * word hit together. Each slam holds `hold` seconds (longer if the word itself runs longer).
 * Returns [{t, end, text}] in time order.
 */
export function planSlams(groups, duration, { dict = {}, hook = null, busy = [], zooms = [], minSpacing = 8, max = 5, hold = 1.1, tail = 1.5 } = {}) {
  const from = hook ? hook.start + hook.duration + 0.3 : 1;
  duration = duration - Math.max(0, tail - 1.5);
  const punch = new Set(zooms.filter((z) => z.scale > 1).map((z) => z.t));
  const covered = (a, b) => busy.some((x) => a < x.start + x.duration + 0.4 && b > x.start - 0.4);
  const cands = slamCandidates(groups, dict)
    .map((c) => ({ ...c, rank: c.rank + (punch.has(groups[c.line].start) ? 1 : 0) }))
    .filter((c) => c.t >= from && c.t <= duration - 1.5)
    .map((c) => ({ ...c, end: r3(Math.min(duration - 0.3, Math.max(c.t + hold, c.end + 0.5))) }))
    .filter((c) => !covered(c.t, c.end))
    .sort((a, b) => b.rank - a.rank || a.t - b.t);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.abs(p.t - c.t) < minSpacing)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.t - b.t).map(({ t, end, text }) => ({ t, end, text }));
}
