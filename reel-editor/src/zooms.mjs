import { r3 } from "./util.mjs";

/**
 * Punch-ins, used sparingly: on the lines that carry a gold word (the claims), at most one per `minSpacing`
 * seconds, never under a card or a cutaway, and never in the hook or the last second. A tight frame (the head
 * fills much of the height) gets a gentler zoom so the chin does not run into the captions. Each punch-in is
 * released at the next quiet line start so the frame comes back to 1 before the next one.
 * Returns [{t, scale, snap}].
 */
export function planZooms(groups, duration, { minSpacing = 10, scales = [1.14, 1.22], tightScales = [1.07, 1.1], snap = 0.12, leadIn = 0.4, busy = [], hook = null, tight = false, maxPer30 = 3 } = {}) {
  const from = hook ? hook.start + hook.duration : leadIn;
  const covered = (t) => busy.some((b) => t >= b.start - 0.3 && t < b.start + b.duration + 0.3);
  const use = tight ? tightScales : scales;
  const keys = [];
  let last = -Infinity;
  let n = 0;
  const lines = groups.filter((g) => g.words && g.words.some((w) => w.key));
  for (const g of lines) {
    const t = g.start;
    if (t < from || t > duration - 1.2 || covered(t)) continue;
    if (t - last < minSpacing) continue;
    if (keys.filter((k) => k.scale > 1 && k.t > t - 30).length >= maxPer30) continue;
    keys.push({ t: r3(t), scale: use[n % use.length], snap });
    // Release on the next line start that is at least 2.5 s later, or 3 s on.
    const next = groups.find((h) => h.start >= t + 2.5 && !covered(h.start));
    const rel = Math.min(duration - 0.3, next ? next.start : t + 3);
    keys.push({ t: r3(rel), scale: 1, snap: 0.3 });
    last = t;
    n++;
  }
  return keys;
}

/**
 * Cut cadence: the frame changes every `min` to `max` seconds even when nothing is said that earns a punch-in,
 * the way fast talking-head edits alternate between two framings at sentence boundaries (cutroom's jump-cut
 * zoom). Each cut is instant, at a caption line start, between the base frame and a slightly tighter one with a
 * small sideways shift that alternates; at least `min` after the last move of any kind (a punch-in, its release or
 * a cut) and at least `lead` before the next punch-in, never under a cutaway or the hook (cards are fine: the
 * footage keeps moving under them), never in the last 1.5 s. A tight frame gets a gentler step.
 * Returns the merged key list, time-ordered. Cut keys carry `cut: true` and `snap: 0`.
 */
export function planCadence(groups, duration, keys = [], { min = 2.5, lead = 1.5, scale = 1.08, tightScale = 1.05, busy = [], hook = null, tight = false } = {}) {
  const from = hook ? hook.start + hook.duration : 0.5;
  const covered = (t) => busy.some((b) => t >= b.start - 0.3 && t < b.start + b.duration + 0.3);
  const step = tight ? tightScale : scale;
  const all = [...keys].sort((a, b) => a.t - b.t);
  const out = [];
  let side = 1;
  for (const g of groups) {
    const t = g.start;
    if (t < from || t > duration - 1.5 || covered(t)) continue;
    const moves = [...all, ...out];
    const lastMove = Math.max(from, ...moves.filter((k) => k.t <= t).map((k) => k.t));
    if (t - lastMove < min) continue;
    if (all.some((k) => k.t > t && k.t - t < lead)) continue;
    // The frame we are in right now: the last key before t, else the base frame.
    const before = moves.filter((k) => k.t <= t).sort((a, b) => b.t - a.t)[0];
    const atBase = !before || before.scale === 1;
    out.push(atBase ? { t: r3(t), scale: step, snap: 0, cut: true, xPercent: r3(1.2 * side) } : { t: r3(t), scale: 1, snap: 0, cut: true, xPercent: 0 });
    if (atBase) side = -side;
  }
  return [...all, ...out].sort((a, b) => a.t - b.t);
}
