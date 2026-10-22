import { r3 } from "./util.mjs";

/**
 * Face-tracking reframe for sources wider than the canvas (a landscape or wide shot into 9:16). The face is sampled
 * every half second, its x centre smoothed, and turned into an object-position lane the composer animates, so the
 * crop follows the speaker instead of staying on the middle of the frame.
 */

/** True when the source has more width per height than the canvas: there is something to pan across. */
export function needsReframe(meta, canvas) {
  return meta.width / meta.height > canvas.width / canvas.height + 0.02;
}

export function sampleTimes(duration, step = 0.5) {
  const out = [];
  for (let t = 0.1; t < duration; t += step) out.push(r3(t));
  return out;
}

/** Face centre x (0-1) per sampled frame from the detector's output; frames with nobody carry the last centre. */
export function faceCentres(detection) {
  const frames = detection?.frames || [];
  const out = [];
  let last = 0.5;
  for (const f of frames) {
    const boxes = (f.faces && f.faces.length ? f.faces : f.bodies) || [];
    if (boxes.length) {
      const b = boxes.reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a));
      last = b.x + b.w / 2;
    }
    out.push({ t: f.t, x: last });
  }
  return out;
}

/** Moving average over `window` samples, then only the moves worth making (dead band), so the crop does not twitch. */
export function smoothTrack(points, { window = 3, deadband = 0.03 } = {}) {
  if (!points.length) return [];
  const avg = points.map((p, i) => {
    const a = Math.max(0, i - window), b = Math.min(points.length, i + window + 1);
    const xs = points.slice(a, b).map((q) => q.x);
    return { t: p.t, x: xs.reduce((s, v) => s + v, 0) / xs.length };
  });
  const out = [avg[0]];
  for (const p of avg.slice(1)) if (Math.abs(p.x - out[out.length - 1].x) >= deadband) out.push(p);
  if (out[out.length - 1] !== avg[avg.length - 1]) out.push(avg[avg.length - 1]);
  return out;
}

/**
 * object-position X (percent) that puts the face centre in the middle of the visible crop.
 * visible = the fraction of the source width the canvas shows; X=0 shows the left edge, X=100 the right.
 */
export function objectPositionLane(track, meta, canvas) {
  const visible = (canvas.width / canvas.height) / (meta.width / meta.height);
  if (visible >= 1) return [];
  return track.map((p) => ({ t: r3(p.t), x: r3(Math.max(0, Math.min(100, ((p.x - visible / 2) / (1 - visible)) * 100))) }));
}
