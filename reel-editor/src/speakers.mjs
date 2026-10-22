import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, r3, PKG_ROOT } from "./util.mjs";

/**
 * Speaker-aware reframing for long-form footage (a podcast, an interview, a training) cut into reels: find the
 * faces, follow the one who is talking, cut between them when the turn changes, and split the screen when two
 * people trade lines in the same shot, the way Opus Clip and Cutawan lay out a two-person conversation.
 *
 * Signals: Apple Vision face boxes with lip motion every 0.25 s (scripts/speakers.swift), voice activity from
 * the word timings, and Scribe's speaker labels when it has them. Rules follow the measured ones from Cutawan and
 * openshorts: lip motion normalised per face, a 15% margin before a switch, 1.2 s minimum hold, a 0.8 s median
 * on the camera path, a dead band of a fifth of the crop width, pans of 0.5-1.4 s, hard cuts on a speaker change,
 * split screen only when both faces stay in the shot and both speak inside a 5 s window.
 */

const SWIFT_SRC = path.join(PKG_ROOT, "scripts", "speakers.swift");

async function speakersBinary() {
  if (process.platform !== "darwin" || !fs.existsSync(SWIFT_SRC)) return null;
  const dir = process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor");
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, `speakers-${Math.round(fs.statSync(SWIFT_SRC).mtimeMs)}`);
  if (!fs.existsSync(bin)) {
    try { await run("swiftc", ["-O", SWIFT_SRC, "-o", bin], { capture: true }); } catch { return null; }
  }
  return bin;
}

/** Faces with lip motion from `from` to `to` seconds, every `step`. Null when the tool is unavailable. */
export async function scanFaces(video, { from = 0, to, step = 0.25 } = {}) {
  const bin = await speakersBinary();
  if (!bin) return null;
  try {
    const { out } = await run(bin, [video, String(from), String(to), String(step)], { capture: true });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Faces frame by frame into tracks: the same person is the face nearest the last known position, within reach. */
export function trackFaces(frames, { reach = 0.6, lost = 2.0, minSamples = 6 } = {}) {
  const tracks = [];
  for (const f of frames) {
    const used = new Set();
    for (const face of f.faces || []) {
      const cx = face.x + face.w / 2, cy = face.y + face.h / 2;
      let best = null, bestD = Infinity;
      for (const tr of tracks) {
        if (used.has(tr.id)) continue;
        const last = tr.samples[tr.samples.length - 1];
        if (f.t - last.t > lost) continue;
        const d = Math.hypot(cx - last.cx, cy - last.cy) / Math.max(0.05, Math.max(face.w, last.w));
        if (d < reach && d < bestD) { best = tr; bestD = d; }
      }
      if (!best) { best = { id: tracks.length, samples: [] }; tracks.push(best); }
      used.add(best.id);
      best.samples.push({ t: f.t, cx, cy, w: face.w, h: face.h, mouth: face.mouth ?? 0 });
    }
  }
  return tracks.filter((tr) => tr.samples.length >= minSamples).map((tr, i) => ({ ...tr, id: i }));
}

/** Voice activity from the words: [[start, end]] with gaps under `gap` merged. */
export function speechSpans(words, { gap = 0.35 } = {}) {
  const out = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && w.start - last[1] <= gap) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

/** Lip motion per track per sample: the spread of mouth openness in a ±win window, scaled per face (20th-80th percentile). */
export function lipActivity(tracks, { win = 0.5 } = {}) {
  return tracks.map((tr) => {
    const raw = tr.samples.map((s, i) => {
      const near = tr.samples.filter((q) => Math.abs(q.t - s.t) <= win).map((q) => q.mouth);
      const m = near.reduce((a, b) => a + b, 0) / near.length;
      return Math.sqrt(near.reduce((a, b) => a + (b - m) ** 2, 0) / near.length);
    });
    const lo = pct(raw, 0.2), hi = pct(raw, 0.8);
    const act = raw.map((v) => (hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0));
    return { id: tr.id, points: tr.samples.map((s, i) => ({ t: s.t, a: act[i] })) };
  });
}

/**
 * Who is talking, as turns [{start, end, track}]. At each step the face with the most lip motion wins, but only
 * during speech, only by a clear margin, and only after `confirm` seconds of winning; a turn holds at least `hold`.
 */
export function speakerTurns(tracks, words, { from = 0, to, step = 0.25, margin = 0.15, confirm = 0.75, hold = 1.2 } = {}) {
  if (!tracks.length) return [];
  const spans = speechSpans(words);
  const talking = (t) => spans.some(([a, b]) => t >= a - 0.15 && t <= b + 0.15);
  const acts = lipActivity(tracks);
  const at = (tr, t) => {
    const p = acts[tr].points;
    let best = null;
    for (const q of p) if (!best || Math.abs(q.t - t) < Math.abs(best.t - t)) best = q;
    return best && Math.abs(best.t - t) <= 0.4 ? best.a : null;
  };
  const turns = [];
  let current = null, since = from, candidate = null, candSince = from;
  for (let t = from; t < to; t = r3(t + step)) {
    const scores = tracks.map((_, i) => at(i, t));
    const present = scores.map((s, i) => (s == null ? null : i)).filter((i) => i != null);
    if (current == null && present.length) { current = present.length === 1 ? present[0] : present.reduce((a, b) => (scores[a] >= scores[b] ? a : b)); since = t; }
    if (!talking(t) || present.length < 2) { candidate = null; continue; }
    const sorted = present.sort((a, b) => scores[b] - scores[a]);
    const best = sorted[0], second = sorted[1];
    const clear = (scores[best] - scores[second]) / Math.max(1e-6, scores[best] + scores[second]) >= margin;
    if (!clear || best === current) { candidate = null; continue; }
    if (candidate !== best) { candidate = best; candSince = t; continue; }
    if (t - candSince + step >= confirm && t - since >= hold) {
      turns.push({ start: r3(since), end: r3(t), track: current });
      current = best; since = t; candidate = null;
    }
  }
  if (current != null) turns.push({ start: r3(since), end: r3(to), track: current });
  return turns.filter((x) => x.end > x.start);
}

/** Keep only the turns that fit the layout rules: a switch holds at least `hold` seconds, short blips merge back. */
export function settleTurns(turns, { hold = 2.0 } = {}) {
  const out = [];
  for (const t of turns) {
    const prev = out[out.length - 1];
    if (prev && (t.end - t.start < hold || prev.track === t.track)) prev.end = t.end;
    else out.push({ ...t });
  }
  return out;
}

/**
 * Stretches where two people trade lines inside one shot: inside any 5 s window both speak at least 0.6 s and both
 * faces are in frame for 90% of the samples. Returns [[start, end, trackA, trackB]] of at least `min` seconds.
 */
export function splitSpans(turns, tracks, { window = 5, each = 0.6, min = 3, bridge = 1.5, presence = 0.9, from = 0, to } = {}) {
  if (tracks.length < 2 || !turns.length) return [];
  const spoke = (tr, a, b) => turns.filter((x) => x.track === tr).reduce((s, x) => s + Math.max(0, Math.min(x.end, b) - Math.max(x.start, a)), 0);
  const present = (tr, a, b) => {
    const s = tracks[tr].samples.filter((q) => q.t >= a && q.t <= b).length;
    return s / Math.max(1, Math.round((b - a) / 0.25));
  };
  const ids = tracks.map((t) => t.id);
  // A real exchange, not one handover: at least two turn changes between the pair inside the window.
  const changes = (a, b, x, y) => turns.filter((q, i) => i && q.start > x && q.start < y && [a, b].includes(q.track) && [a, b].includes(turns[i - 1].track) && q.track !== turns[i - 1].track).length;
  const marks = [];
  for (let t = from; t + window <= to; t = r3(t + 0.5)) {
    const pair = [];
    for (const a of ids) for (const b of ids) if (a < b && changes(a, b, t, t + window) >= 2 && spoke(a, t, t + window) >= each && spoke(b, t, t + window) >= each && present(a, t, t + window) >= presence && present(b, t, t + window) >= presence) pair.push([a, b]);
    if (pair.length) marks.push({ t, pair: pair[0] });
  }
  const spans = [];
  for (const m of marks) {
    const last = spans[spans.length - 1];
    if (last && m.t <= last[1] + bridge && last[2] === m.pair[0] && last[3] === m.pair[1]) last[1] = r3(m.t + window);
    else spans.push([m.t, r3(m.t + window), m.pair[0], m.pair[1]]);
  }
  return spans.filter((s) => s[1] - s[0] >= min);
}

/** The camera path for one track: median over 0.8 s, dead band, eased pans. Returns [{t, cx, cy, w, h}] keyframes. */
export function cameraPath(track, { medianWin = 0.8, deadband = 0.2, cropW, panMin = 0.5, panMax = 1.4, speed = 0.9 } = {}) {
  const s = track.samples;
  if (!s.length) return [];
  const sm = s.map((p, i) => {
    const near = s.filter((q) => Math.abs(q.t - p.t) <= medianWin / 2);
    return { t: p.t, cx: median(near.map((q) => q.cx)), cy: median(near.map((q) => q.cy)), w: median(near.map((q) => q.w)), h: median(near.map((q) => q.h)) };
  });
  const keys = [{ ...sm[0] }];
  for (const p of sm.slice(1)) {
    const last = keys[keys.length - 1];
    const dx = Math.abs(p.cx - last.cx);
    if (dx < deadband * cropW && Math.abs(p.cy - last.cy) < deadband * cropW) continue;
    const dur = Math.max(panMin, Math.min(panMax, dx / (speed * cropW)));
    keys.push({ t: r3(Math.max(last.t + 0.05, p.t - dur)), cx: last.cx, cy: last.cy, w: last.w, h: last.h, hold: true });
    keys.push({ ...p, t: r3(Math.max(last.t + dur, p.t)) });
  }
  return keys;
}

/**
 * The whole layout plan for a clip: [{start, end, mode: "single"|"split", a, b}] where a/b are {track, path}.
 * from/to are source-time bounds of the clip; everything out is in clip time (0-based).
 */
export function planLayout({ tracks, words, from = 0, to, W, H, hold = 2.0 }) {
  const turns = settleTurns(speakerTurns(tracks, words, { from, to }), { hold });
  const splits = splitSpans(turns, tracks, { from, to });
  const segs = [];
  let t = from;
  const cut = (a, b, mode, trA, trB) => { if (b > a) segs.push({ start: r3(a - from), end: r3(b - from), mode, a: trA, b: trB }); };
  for (const sp of splits) {
    for (const x of turns) if (x.end > t && x.start < sp[0]) cut(Math.max(t, x.start), Math.min(sp[0], x.end), "single", x.track);
    cut(sp[0], sp[1], "split", sp[2], sp[3]);
    t = sp[1];
  }
  for (const x of turns) if (x.end > t) cut(Math.max(t, x.start), x.end, "single", x.track);
  if (!segs.length && tracks.length) cut(from, to, "single", 0);
  // Camera paths per track, in clip time.
  const cropW = (H * 9) / 16 / W; // fraction of the source width one portrait crop shows
  const paths = tracks.map((tr) => cameraPath({ samples: tr.samples.map((s) => ({ ...s, t: r3(s.t - from) })) }, { cropW }));
  return { segments: segs, paths, cropW, tracks: tracks.length };
}

/** Interpolate a path at clip time t (linear between keys, held outside). */
export function pathAt(path, t) {
  if (!path.length) return null;
  if (t <= path[0].t) return path[0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (t <= b.t) {
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
      return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, w: a.w + (b.w - a.w) * e, h: a.h + (b.h - a.h) * e };
    }
  }
  return path[path.length - 1];
}

/**
 * ffmpeg: a sendcmd file (one crop position per frame) and the filter graph that builds the portrait source.
 * Single: a full-height 9:16 crop that follows the face. Split: two 9:8 panels (1080x960) stacked, each framed on
 * its person, laid over the single view while the split holds.
 */
export function layoutFilter(plan, { W, H, fps = 30, duration, outW = 1080, outH = 1920 }) {
  const cw = Math.round((H * outW) / outH / 2) * 2; // single crop width in source pixels
  const ph = Math.round(Math.min(H, H * 0.62) / 2) * 2; // panel height: a tighter frame than the full height
  const pw = Math.round((ph * outW) / (outH / 2) / 2) * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lines = [];
  const frames = Math.ceil(duration * fps);
  const segAt = (t) => plan.segments.find((s) => t >= s.start && t < s.end) || plan.segments[plan.segments.length - 1];
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    const s = segAt(t);
    if (!s) break;
    const pa = pathAt(plan.paths[s.a] || [], t);
    const x = pa ? clamp(Math.round(pa.cx * W - cw / 2), 0, W - cw) : Math.round((W - cw) / 2);
    lines.push(`${t.toFixed(3)} crop@single x ${x};`);
    if (s.mode === "split") {
      const pb = pathAt(plan.paths[s.b] || [], t);
      for (const [name, p] of [["pa", pa], ["pb", pb]]) {
        const fx = p ? clamp(Math.round(p.cx * W - pw / 2), 0, W - pw) : Math.round((W - pw) / 2);
        const fy = p ? clamp(Math.round((p.cy - 0.08) * H - ph / 2), 0, H - ph) : Math.round((H - ph) / 2);
        lines.push(`${t.toFixed(3)} crop@${name} x ${fx}, crop@${name} y ${fy};`);
      }
    }
  }
  const enable = plan.segments.filter((s) => s.mode === "split").map((s) => `between(t,${s.start},${s.end})`).join("+") || "0";
  const hasSplit = plan.segments.some((s) => s.mode === "split");
  const graph = hasSplit
    ? `[0:v]split=3[v0][v1][v2];[v0]sendcmd=f='CMDS',crop@single=w=${cw}:h=${H}:x=0:y=0,scale=${outW}:${outH},setsar=1[single];[v1]crop@pa=w=${pw}:h=${ph}:x=0:y=0,scale=${outW}:${outH / 2},setsar=1[pa];[v2]crop@pb=w=${pw}:h=${ph}:x=0:y=0,scale=${outW}:${outH / 2},setsar=1[pb];[pa][pb]vstack[splitv];[single][splitv]overlay=enable='${enable}'[out]`
    : `[0:v]sendcmd=f='CMDS',crop@single=w=${cw}:h=${H}:x=0:y=0,scale=${outW}:${outH},setsar=1[out]`;
  return { commands: lines.join("\n") + "\n", graph, cw, pw, ph };
}

/** Describe a plan in one line for the log. */
export function describeLayout(plan) {
  const n = plan.segments.length, splits = plan.segments.filter((s) => s.mode === "split").length;
  const cuts = plan.segments.filter((s, i) => i && s.mode === "single" && plan.segments[i - 1].mode === "single" && s.a !== plan.segments[i - 1].a).length;
  return `${plan.tracks} face${plan.tracks === 1 ? "" : "s"}, ${n} segment${n === 1 ? "" : "s"}, ${cuts} speaker cut${cuts === 1 ? "" : "s"}, ${splits} split${splits === 1 ? "" : "s"}`;
}

/**
 * Build the portrait, speaker-framed source for one clip. Returns the output path, or null when the clip is not
 * wider than portrait or no face was found (the caller then uses the plain cut).
 */
export async function reframeClip(src, out, { words, meta, fps = 30 }) {
  if (meta.width / meta.height <= 9 / 16 + 0.02) return null;
  const scan = await scanFaces(src, { from: 0, to: meta.duration, step: 0.25 });
  if (!scan?.frames?.length) return null;
  const tracks = trackFaces(scan.frames);
  if (!tracks.length) return null;
  const plan = planLayout({ tracks, words, from: 0, to: meta.duration, W: scan.width, H: scan.height });
  const { commands, graph } = layoutFilter(plan, { W: scan.width, H: scan.height, fps, duration: meta.duration });
  const cmds = path.join(path.dirname(out), "layout-cmds.txt");
  fs.writeFileSync(cmds, commands);
  fs.writeFileSync(path.join(path.dirname(out), "layout.json"), JSON.stringify({ plan, tracks: tracks.map((t) => ({ id: t.id, samples: t.samples.length })) }, null, 1));
  const g = graph.replace("CMDS", cmds.replace(/[\\:']/g, "\\$&"));
  const enc = process.platform === "darwin" ? ["-c:v", "h264_videotoolbox", "-q:v", "75"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16"];
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-filter_complex", g, "-map", "[out]", "-map", "0:a?", "-r", String(fps), ...enc, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], { quiet: true });
  return { out, plan };
}
