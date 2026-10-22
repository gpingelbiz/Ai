import { r3 } from "./util.mjs";
import { trackFaces, scanFaces, speakerTurns, settleTurns } from "./speakers.mjs";

/**
 * Wide shots with two or more people (a podcast two-shot): the base frame fits everyone instead of zooming on one
 * face and cropping the others off, every punch-in and jump cut aims at whoever is talking, and cards stay above
 * the heads. One person in the frame keeps the single-face framing in placement.mjs.
 */

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** People in a detection (detectFaces output): [{cx, cy, w, h, share}], left to right. Under 25% of the frames is not a person. */
export function peopleFrom(detection) {
  const frames = (detection?.frames || []).filter((f) => (f.faces || []).length);
  if (!frames.length) return [];
  const tracks = trackFaces(frames.map((f) => ({ t: f.t, faces: (f.faces || []).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })) })), { minSamples: 2, reach: 0.9, lost: 1e9 });
  return tracks
    .map((tr) => ({ cx: r3(median(tr.samples.map((s) => s.cx))), cy: r3(median(tr.samples.map((s) => s.cy))), w: r3(median(tr.samples.map((s) => s.w))), h: r3(median(tr.samples.map((s) => s.h))), share: tr.samples.length / frames.length }))
    .filter((p) => p.share >= 0.25)
    .sort((a, b) => a.cx - b.cx);
}

/**
 * Base frame for a group: scale so every face plus a shoulder margin fits (never past `max`), anchored on the group,
 * slid so the heads sit near the eye line without cutting off the highest head or the lowest chin.
 */
export function groupFraming(people, { max = 1.3, margin = 0.1, eyeLine = 0.42 } = {}) {
  const minX = Math.min(...people.map((p) => p.cx - p.w / 2)) - margin;
  const maxX = Math.max(...people.map((p) => p.cx + p.w / 2)) + margin;
  const span = Math.max(0.2, maxX - minX);
  const scale = r3(clamp(1 / span, 1, max));
  const cx = clamp((minX + maxX) / 2, 0, 1);
  const cy = people.reduce((a, p) => a + p.cy, 0) / people.length;
  // Where a point at height y lands after scaling about the origin (cx, cy) and sliding by `shift`.
  const at = (y, shift) => cy + (y - cy) * scale + shift;
  const roomUp = cy + (1 - cy) * scale - 1; // slack at the bottom
  const roomDown = cy * scale - cy; // slack at the top
  let shift = clamp(eyeLine - cy, -roomUp, roomDown);
  const topHead = Math.min(...people.map((p) => p.cy - 0.75 * p.h));
  const lowChin = Math.max(...people.map((p) => p.cy + 0.65 * p.h));
  if (at(topHead, shift) < 0.05) shift += 0.05 - at(topHead, shift);
  if (at(lowChin, shift) > 0.9) shift -= at(lowChin, shift) - 0.9;
  shift = r3(clamp(shift, -roomUp, roomDown));
  const face = { cx: r3(cx), cy: r3(cy), w: r3(maxX - minX), h: r3(median(people.map((p) => p.h))) };
  return { scale, origin: `${Math.round(cx * 100)}% ${Math.round(cy * 100)}%`, shift, face };
}

/**
 * xPercent that puts person `p` at the centre of the frame when the footage is at total scale `s` about origin
 * x `ox` (fractions), as far as the edges allow (never shows beyond the footage).
 */
export function aimX(p, s, ox) {
  if (s <= 1) return 0;
  const want = 0.5 - ox - (p.cx - ox) * s; // translation that lands the person at the centre
  const lo = 1 - ox - (1 - ox) * s, hi = ox * s - ox;
  return r3(clamp(want, lo, hi) * 100);
}

/** Face tracks from a scan, matched to `people` by position: speaker track id -> person index. */
export function matchTracks(tracks, people) {
  return tracks.map((tr) => {
    const cx = median(tr.samples.map((s) => s.cx));
    let best = 0, bd = Infinity;
    people.forEach((p, i) => { const d = Math.abs(p.cx - cx); if (d < bd) { bd = d; best = i; } });
    return best;
  });
}

/** Who is talking over the whole video: a function t -> person index (or null before anyone is known). */
export async function speakerTimeline(video, words, { duration, people, step }) {
  const st = step || (duration > 600 ? 0.5 : 0.25);
  const scan = await scanFaces(video, { from: 0, to: duration, step: st });
  if (!scan?.frames?.length) return null;
  const tracks = trackFaces(scan.frames);
  if (tracks.length < 2) return null;
  const turns = settleTurns(speakerTurns(tracks, words, { from: 0, to: duration, step: st }), { hold: 2 });
  if (!turns.length) return null;
  const map = matchTracks(tracks, people);
  const segs = turns.map((t) => ({ start: t.start, end: t.end, person: map[t.track] }));
  return { turns: segs, at: (t) => { const s = segs.find((x) => t >= x.start && t < x.end) || (t < segs[0].start ? segs[0] : segs[segs.length - 1]); return s ? s.person : null; } };
}

/**
 * Aim the zoom keys at the speaker. Keys at scale 1 return to the group frame; every other key (punch-in or jump
 * cut) centres whoever is talking at that moment, or the middle of the group when nobody is known.
 */
export function aimZooms(zooms, { people, base, originX, at }) {
  return zooms.map((z) => {
    if (!(z.scale > 1)) return { ...z, xPercent: 0 };
    const i = at ? at(z.t) : null;
    const p = i != null && people[i] ? people[i] : { cx: originX };
    return { ...z, xPercent: aimX(p, z.scale * base, originX), who: i ?? null };
  });
}
