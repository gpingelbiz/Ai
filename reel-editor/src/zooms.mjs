import { r3 } from "./util.mjs";

/**
 * Magic zooms: alternate punch-in / punch-out on caption-line starts, roughly every `interval` seconds
 * with deterministic jitter so the rhythm doesn't feel mechanical. Returns [{t, scale, snap}].
 */
export function planZooms(anchors, duration, { interval = 5, scales = [1.14, 1.22], snap = 0.12, leadIn = 0.4 } = {}) {
  const keys = [];
  let last = -Infinity;
  let n = 0;
  for (const a of anchors) {
    const t = a.start;
    if (t < leadIn || t > duration - 0.6) continue;
    const jitter = 0.8 + 0.4 * (((n * 7919) % 97) / 97);
    if (t - last < interval * jitter) continue;
    const zoomIn = n % 2 === 0;
    const scale = zoomIn ? scales[Math.floor(n / 2) % scales.length] : 1;
    keys.push({ t: r3(t), scale, snap });
    last = t;
    n++;
  }
  return keys;
}
