import { r3 } from "./util.mjs";

/**
 * Face-tracking reframe for sources wider than the canvas (a landscape or wide shot into 9:16). The face is sampled
 * every quarter second, its x centre smoothed, and turned into an object-position lane the composer animates, so the
 * crop follows the speaker instead of staying on the middle of the frame.
 */

/** True when the source has more width per height than the canvas: there is something to pan across. */
export function needsReframe(meta, canvas) {
  return meta.width / meta.height > canvas.width / canvas.height + 0.02;
}

export function sampleTimes(duration, step = 0.25) {
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

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

/** Low-lag adaptive smoothing from Casiez, Roussel and Vogel's One Euro filter (CHI 2012). */
export class OneEuroFilter {
  constructor({ minCutoff = 0.8, beta = 0.15, dCutoff = 1 } = {}) {
    if (!(minCutoff > 0) || !(dCutoff > 0) || !(beta >= 0)) throw new Error("invalid One Euro filter settings");
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset(value, t) {
    this.t = Number.isFinite(t) ? t : null;
    this.raw = Number.isFinite(value) ? value : null;
    this.value = this.raw;
    this.derivative = 0;
    return this.value;
  }

  filter(value, t) {
    if (!Number.isFinite(value) || !Number.isFinite(t)) return this.value;
    if (this.t == null || t <= this.t) return this.reset(value, t);
    const dt = t - this.t;
    const derivative = (value - this.raw) / dt;
    const da = alpha(this.dCutoff, dt);
    this.derivative += da * (derivative - this.derivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    const a = alpha(cutoff, dt);
    this.value += a * (value - this.value);
    this.raw = value;
    this.t = t;
    return this.value;
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * A shot-aware crop path: One Euro removes detector noise, AutoFlip-style shot resets prevent cross-cut slides,
 * and velocity/acceleration limits keep an ordinary subject move feeling like a camera pan.
 */
export function planCropPath(points, {
  cuts = [], minCutoff = 0.8, beta = 0.15, dCutoff = 1, deadband = 0.015,
  maxSpeed = 0.35, maxAccel = 1.4,
} = {}) {
  const input = points
    .filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.x))
    .map((p) => ({ t: p.t, x: clamp(p.x, 0, 1) }))
    .sort((a, b) => a.t - b.t);
  if (!input.length) return [];

  const shotCuts = [...new Set(cuts.filter(Number.isFinite))]
    .filter((t) => t >= input[0].t && t <= input[input.length - 1].t)
    .sort((a, b) => a - b);
  const filter = new OneEuroFilter({ minCutoff, beta, dCutoff });
  const out = [];
  let current = null, velocity = 0, lastT = null, lastRaw = null, lastOut = null;

  const reset = (x, t, cut = false) => {
    filter.reset(x, t);
    current = x;
    velocity = 0;
    lastT = t;
    lastRaw = x;
    lastOut = x;
    out.push({ t: r3(t), x: r3(x), ...(cut ? { cut: true } : {}) });
  };

  const visit = ({ t, x }) => {
    if (current == null) { reset(x, t); return; }
    const dt = t - lastT;
    if (dt <= 0) return;
    const target = Math.abs(x - lastRaw) > 0.25 ? filter.reset(x, t) : filter.filter(x, t);
    const speed = Number.isFinite(maxSpeed) && maxSpeed > 0 ? maxSpeed : Infinity;
    const accel = Number.isFinite(maxAccel) && maxAccel > 0 ? maxAccel : Infinity;
    const wanted = clamp((target - current) / dt, -speed, speed);
    const nextVelocity = clamp(wanted, velocity - accel * dt, velocity + accel * dt);
    let next = current + nextVelocity * dt;
    // Do not carry momentum past the detector target or farther away from it.
    if ((target - current) * (next - target) >= 0) next = target;
    else if ((target - current) * (next - current) < 0) next = current;
    velocity = (next - current) / dt;
    current = clamp(next, 0, 1);
    lastT = t;
    lastRaw = x;
    if (Math.abs(current - lastOut) >= Math.max(0, deadband)) {
      lastOut = current;
      out.push({ t: r3(t), x: r3(current) });
    }
  };

  let i = 0;
  for (const cut of shotCuts) {
    while (i < input.length && input[i].t < cut) visit(input[i++]);
    const after = input[i];
    if (!after) break;
    reset(after.x, cut, true);
    if (after.t === cut) i++;
  }
  while (i < input.length) visit(input[i++]);
  return out;
}

/**
 * object-position X (percent) that puts the face centre in the middle of the visible crop.
 * visible = the fraction of the source width the canvas shows; X=0 shows the left edge, X=100 the right.
 */
export function objectPositionLane(track, meta, canvas) {
  const visible = (canvas.width / canvas.height) / (meta.width / meta.height);
  if (visible >= 1) return [];
  return track.map((p) => ({ t: r3(p.t), x: r3(Math.max(0, Math.min(100, ((p.x - visible / 2) / (1 - visible)) * 100))), ...(p.cut ? { cut: true } : {}) }));
}
