import { r3 } from "./util.mjs";

const FRAME = 1 / 30;
const DRIFT_CAP = 4;
const BUMP_CAP = 8;

const overlaps = (a0, a1, b) => a0 < b.start + b.duration && a1 > b.start;
const moveDuration = (z, style) => z.cut ? 0 : style === "camera" ? (z.scale > 1 ? 0.55 : 0.9) : Math.max(0, z.snap || 0);

/**
 * Slow pushes for genuinely still stretches. Zoom keys split the reel into stretches; cutaways remove their whole
 * windows. The hook and clean tail are never eligible. A long reel is capped at four, keeping the longest gaps.
 * Returns { stretches, skipped }, where each stretch carries the reset at its next move.
 */
export function planDrift(zooms = [], broll = [], duration = 0, { enabled = true, minGap = 6, scale = 0.03, hook = null, tail = 1.5, max = DRIFT_CAP, zoomStyle = "snap" } = {}) {
  if (!enabled || !(duration > 0) || !(scale > 0)) return { stretches: [], skipped: { short: 0, cap: 0 } };
  const from = Math.max(0, hook ? hook.start + hook.duration : 0);
  const to = Math.max(from, duration - Math.max(1.5, tail));
  const moves = [...zooms]
    .filter((z) => Number.isFinite(z.t) && z.t > from && z.t < to)
    .map((z) => ({ t: z.t, kind: "zoom", z }));
  const cuts = broll
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.duration) && b.duration > 0)
    .flatMap((b) => [{ t: b.start, kind: "broll-in", b }, { t: b.start + b.duration, kind: "broll-out", b }])
    .filter((e) => e.t > from && e.t < to);
  const events = [{ t: from, kind: "edge" }, ...moves, ...cuts, { t: to, kind: "tail" }]
    .sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind))
    .filter((e, i, a) => !i || Math.abs(e.t - a[i - 1].t) > 1e-6 || e.kind !== a[i - 1].kind);
  const insideCutaway = (t0, t1) => broll.some((b) => overlaps(t0, t1, b));
  const eligible = [];
  let short = 0;
  for (let i = 0; i + 1 < events.length; i++) {
    const prev = events[i], next = events[i + 1];
    let start = prev.t;
    if (prev.kind === "zoom") start += moveDuration(prev.z, zoomStyle);
    if (insideCutaway(start + 1e-5, next.t - 1e-5)) continue;
    const tailReset = next.kind === "tail" ? 5 * FRAME : 0;
    const end = next.t - tailReset;
    if (end - start < minGap) { if (end > start) short++; continue; }
    const reset = next.kind === "zoom" ? (next.z.cut ? "cut" : "move") : next.kind.startsWith("broll") ? "cut" : "exit";
    const out = reset === "move" ? moveDuration(next.z, zoomStyle) : reset === "exit" ? 5 * FRAME : 0;
    eligible.push({ start: r3(start), end: r3(end), scale: r3(1 + scale), reset, out: r3(out) });
  }
  const keep = eligible
    .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
    .slice(0, Math.max(0, max))
    .sort((a, b) => a.start - b.start);
  return { stretches: keep, skipped: { short, cap: Math.max(0, eligible.length - keep.length) } };
}

/**
 * A separate footage bump when a card or slam lands. It stays clear of cutaways, the hook, the clean tail and any
 * punch-in/jump cut within `clear`; dense landings are spaced and capped so the move remains punctuation.
 */
export function planBumps(graphics = [], slams = [], zooms = [], { enabled = true, scale = 0.025, broll = [], hook = null, duration = Infinity, tail = 1.5, clear = 0.3, minSpacing = 0.6, max = BUMP_CAP, slamLand = 0.42 } = {}) {
  const skipped = { nearMove: 0, cutaway: 0, hook: 0, tail: 0, spacing: 0, cap: 0 };
  if (!enabled || !(scale > 0)) return { bumps: [], skipped };
  const candidates = [
    ...graphics.filter((g) => g.type !== "progress").map((g) => ({ t: g.start, kind: "card" })),
    ...slams.map((s) => ({ t: s.t + slamLand, kind: "slam" })),
  ].filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind));
  const moves = zooms.filter((z) => z.cut || z.scale > 1);
  const bumps = [];
  for (const x of candidates) {
    if (hook && x.t >= hook.start && x.t < hook.start + hook.duration) { skipped.hook++; continue; }
    if (x.t >= duration - Math.max(1.5, tail)) { skipped.tail++; continue; }
    if (broll.some((b) => x.t >= b.start - clear && x.t <= b.start + b.duration + clear)) { skipped.cutaway++; continue; }
    if (moves.some((z) => Math.abs(z.t - x.t) <= clear)) { skipped.nearMove++; continue; }
    if (bumps.length && x.t - bumps.at(-1).t < minSpacing) { skipped.spacing++; continue; }
    if (bumps.length >= max) { skipped.cap++; continue; }
    bumps.push({ t: r3(x.t), scale: r3(1 + scale), kind: x.kind });
  }
  return { bumps, skipped };
}

/** Strongest drift scale touching a layout window (conservative at the reset). */
export function driftDuring(stretches = [], t0 = 0, t1 = 0) {
  return stretches.reduce((scale, d) => (t0 < d.end + (d.out || 0) && t1 > d.start ? Math.max(scale, d.scale || 1) : scale), 1);
}
