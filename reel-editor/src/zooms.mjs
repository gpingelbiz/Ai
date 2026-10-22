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
