import fs from "node:fs";
import { assetPath } from "./speaker-intake.mjs";
import { duckingLane } from "./music.mjs";

/** Missing permission never becomes audible in a draft, and blocks final delivery. */
export function licensedMusic(folder, plan, manifest, { final = false, print = console.log } = {}) {
  if (!plan.music) return null;
  const track = manifest.music?.find((m) => m.file === plan.music.file && String(m.license || "").trim());
  let file, reason;
  if (!track) reason = "track must be listed with a licence in manifest.music";
  else {
    try { file = assetPath(folder, track.file); if (!fs.existsSync(file)) reason = "file is missing"; }
    catch (e) { reason = e.message; }
  }
  if (reason) {
    if (final) throw new Error(`speaker music ${plan.music.file}: ${reason}`);
    print(`WARNING music ${plan.music.file}: ${reason}; draft music skipped`);
    return null;
  }
  return file;
}

/** Absolute, frame-aligned volume automation. Explicit sections are inclusive of their named items.
 * With no sections, only unprotected non-core items receive the -20 dB bed. Reactions never swell.
 */
export function speakerMusicLane(plan, words = []) {
  if (!plan.music) return [];
  const fps = plan.canvas.fps, duration = plan.duration;
  const sections = plan.music.sections || [], items = plan.items;
  const ranges = sections.map((s) => {
    const from = items.findIndex((i) => i.id === s.from), to = items.findIndex((i) => i.id === s.to);
    if (from < 0 || to < from || !Number.isFinite(s.gainDb) || s.gainDb > 0 || s.gainDb < -96) throw new Error(`speaker music: invalid section ${s.from}-${s.to}`);
    return { ...s, from, to };
  });
  for (let a = 0; a < ranges.length; a++) for (let b = a + 1; b < ranges.length; b++) {
    if (ranges[a].from <= ranges[b].to && ranges[b].from <= ranges[a].to) throw new Error(`speaker music: overlapping sections ${ranges[a].from}-${ranges[a].to} and ${ranges[b].from}-${ranges[b].to}`);
  }
  // Neighbouring items with the same music state form one run with one ducking lane, so the bed only fades where it
  // actually turns on or off (or changes level), never at every cut inside a section.
  const runs = [];
  for (const [n, item] of items.entries()) {
    const explicit = ranges.find((s) => n >= s.from && n <= s.to);
    const active = explicit || (!ranges.length && !item.protect && item.role !== "core");
    const level = active ? 10 ** ((explicit?.gainDb ?? -20) / 20) : 0;
    const swell = item.protect || ["core", "room", "testimonial"].includes(item.role) ? 1 : 2.2;
    const last = runs.at(-1);
    if (last && last.level === level && last.swell === swell && last.endFrame === item.startFrame) last.endFrame = item.endFrame;
    else runs.push({ level, swell, startFrame: item.startFrame, endFrame: item.endFrame });
  }
  const points = [];
  for (const [n, run] of runs.entries()) {
    const start = run.startFrame / fps, end = run.endFrame / fps, d = end - start;
    const local = words.filter((w) => w.end > start && w.start < end).map((w) => ({ ...w, start: Math.max(0, w.start - start), end: Math.min(d, w.end - start + 0.5) }));
    // Fade in only from silence and out only into silence; a level change between two active runs is a cut.
    const fadeIn = runs[n - 1]?.level ? 0 : Math.min(0.35, d / 3), fadeOut = runs[n + 1]?.level ? 0 : Math.min(0.5, d / 3);
    const lane = duckingLane(local, { duration: d, start: 0, level: run.level, swell: run.swell, minGap: 1.2, ramp: 0.8, fadeIn, fadeOut });
    let cursor = 0;
    for (let frame = run.startFrame; frame < run.endFrame; frame++) {
      const t = frame / fps - start;
      while (cursor + 1 < lane.length && lane[cursor + 1].t <= t) cursor++;
      const a = lane[cursor], b = lane[cursor + 1] || a;
      const v = a.v + (b.v - a.v) * (b.t > a.t ? (t - a.t) / (b.t - a.t) : 0);
      points.push({ t: frame / fps, v: Math.max(0, v) });
    }
  }
  points.push({ t: duration, v: 0 });
  return points;
}
