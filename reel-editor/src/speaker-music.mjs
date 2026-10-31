import fs from "node:fs";
import { assetPath } from "./speaker-intake.mjs";
import { duckingLane } from "./music.mjs";

/** Missing permission never becomes audible in a draft, and blocks final delivery. */
function licensedSingleMusic(folder, plan, manifest, { final = false, print = console.log } = {}) {
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
function legacyMusicLane(plan, words = []) {
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

/** Validate all listed tracks and effects. The legacy return remains one absolute filename. */
export function licensedMusic(folder, plan, manifest, options = {}) {
  if (plan.music?.tracks != null && !Array.isArray(plan.music.tracks)) throw new Error("speaker music: tracks must be an array");
  if (Array.isArray(plan.music?.tracks) && !plan.music.tracks.length) throw new Error("speaker music: tracks must contain at least one track");
  const refs = [...(plan.music?.tracks || (plan.music ? [{ id: "main", file: plan.music.file }] : [])), ...(plan.sfx || []).map((s) => ({ ...s, kind: "sfx" }))];
  if (!refs.length) return null;
  const files = {};
  for (const ref of refs) {
    const registry = { ...manifest, music: (manifest.music || []).filter((m) => ref.kind === "sfx" ? m.kind === "sfx" : m.kind !== "sfx") };
    const file = licensedSingleMusic(folder, { music: { file: ref.file } }, registry, options);
    if (file) files[ref.kind === "sfx" ? `sfx:${ref.id || ref.file}` : ref.id] = file;
  }
  return plan.music?.tracks || plan.sfx?.length ? files : files.main || null;
}

/** Validate the new cue contract without opening files; called by plan validation and composition. */
export function musicProblems(plan, manifest, { draft = false } = {}) {
  const problems = [], add = (message, level = "error") => problems.push({ level, id: "music", message });
  const tracks = plan.music?.tracks || (plan.music ? [{ id: "main", file: plan.music.file }] : []);
  if (!Array.isArray(tracks)) return [{ level: "error", id: "music", message: "music.tracks must be an array" }];
  if (plan.music?.tracks && !tracks.length) add("music.tracks must contain at least one track");
  const ids = new Set();
  for (const t of tracks) {
    if (!t || typeof t.file !== "string" || !t.file.trim() || typeof t.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(t.id) || ids.has(t.id)) { add("music tracks need distinct safe ids and files"); continue; }
    ids.add(t.id);
    if (!(manifest.music || []).some((m) => m.file === t.file && m.kind !== "sfx" && String(m.license || "").trim())) add(`${t.id}: track must be listed with a licence in manifest.music; draft music skipped`, draft ? "warn" : "error");
  }
  if (plan.music && !Array.isArray(plan.music.sections)) add("music.sections must be an array");
  const sections = plan.music?.sections || [], items = plan.items || [];
  for (const [n, s] of (Array.isArray(sections) ? sections : []).entries()) {
    if (!s || typeof s !== "object") { add("music sections must be objects"); continue; }
    const from = items.findIndex((i) => i.id === s.from), to = items.findIndex((i) => i.id === s.to);
    if (from < 0 || to < from) add(`invalid section ${s.from}-${s.to}: from/to must name items in playback order`);
    if (plan.music.tracks && !ids.has(s.track)) add(`section ${s.from}: unknown track ${s.track}`);
    if (s.gainDb != null && (!Number.isFinite(s.gainDb) || s.gainDb > 0 || s.gainDb < -96)) add(`section ${s.from}: gainDb must be between -96 and 0`);
    for (const key of ["start", "fadeIn", "fadeOut"]) if (s[key] != null && (!Number.isFinite(s[key]) || s[key] < 0)) add(`section ${s.from}: ${key} must be non-negative`);
    if (s.snap != null && s.snap !== "beats") add(`section ${s.from}: snap must be beats`);
    for (const other of sections.slice(0, n)) {
      const a = items.findIndex((i) => i.id === other?.from), b = items.findIndex((i) => i.id === other?.to);
      if (from >= 0 && a <= to && from <= b) add(`overlapping sections ${other.from}-${other.to} and ${s.from}-${s.to}`);
    }
  }
  for (const s of Array.isArray(plan.sfx) ? plan.sfx : []) if (s && !(manifest.music || []).some((m) => m.file === s.file && m.kind === "sfx" && String(m.license || "").trim())) add(`SFX ${s.id || s.file}: must be listed as kind sfx with a licence in manifest.music`, draft ? "warn" : "error");
  return problems;
}

const dbGain = (db) => 10 ** (db / 20);

/** Independent cue lanes permit two different tracks to overlap during a deterministic crossfade. */
export function speakerMusicCues(plan, words = []) {
  if (!plan.music) return [];
  const errors = musicProblems({ ...plan, sfx: [] }, { music: (plan.music.tracks || [{ file: plan.music.file }]).map((t) => ({ ...t, license: "validated separately" })) }).filter((p) => p.level === "error");
  if (errors.length) throw new Error(errors.map((p) => p.message).join("; "));
  const fps = plan.canvas.fps, items = plan.items;
  const tracks = plan.music.tracks || [{ id: "main", file: plan.music.file }];
  const sections = plan.music.sections?.length ? plan.music.sections.map((s) => ({ ...s })) : [];
  if (!sections.length) for (const [n, item] of items.entries()) {
    if (item.protect || item.role === "core") continue;
    const last = sections.at(-1);
    if (last && last.to === items[n - 1]?.id) last.to = item.id;
    else sections.push({ from: item.id, to: item.id, track: tracks[0]?.id });
  }
  const cues = sections.map((s, n) => {
    const from = items.find((i) => i.id === s.from), to = items.find((i) => i.id === s.to), track = tracks.find((t) => t.id === (s.track || tracks[0]?.id));
    if (!track) throw new Error(`speaker music section ${s.from}: unknown track ${s.track}`);
    return { id: `music-${n}`, section: s, track: track.id, file: track.file, start: s.start || 0, outputStart: from.startFrame / fps, outputEnd: to.endFrame / fps };
  }).sort((a, b) => a.outputStart - b.outputStart);
  for (let n = 0; n + 1 < cues.length; n++) {
    const a = cues[n], b = cues[n + 1];
    if (Math.abs(a.outputEnd - b.outputStart) > 1 / fps || a.track === b.track) continue;
    // Outgoing tail overlaps the incoming cue. Never leak it into an unnamed protected section.
    const boundaryItem = items.find((i) => i.id === b.section.from);
    const firstWord = words.find((w) => w.start >= b.outputStart && w.start < b.outputEnd)?.start;
    const crossfade = Math.round(Math.min(1, Math.max(0.5, a.section.fadeOut ?? b.section.fadeIn ?? 0.75)) * fps) / fps;
    a.outputEnd = Math.min(b.outputEnd, a.outputEnd + crossfade, boundaryItem.protect && firstWord != null ? Math.floor(firstWord * fps) / fps : Infinity);
    a.crossfade = a.outputEnd - b.outputStart;
    b.crossfadeIn = a.crossfade;
  }
  for (const cue of cues) {
    const startFrame = Math.round(cue.outputStart * fps), endFrame = Math.round(cue.outputEnd * fps), d = cue.outputEnd - cue.outputStart;
    const localWords = words.filter((w) => w.end > cue.outputStart && w.start < cue.outputEnd).map((w) => ({ start: Math.max(0, w.start - cue.outputStart - 0.15), end: Math.min(d, w.end - cue.outputStart + 0.6) }));
    const level = dbGain(cue.section.gainDb ?? -18), high = cue.section.gainDb == null ? dbGain(-6) : Math.min(1, level * 2.2);
    const protectedCue = items.some((i) => i.protect && i.endFrame > startFrame && i.startFrame < endFrame);
    const lane = duckingLane(localWords, { duration: d, start: 0, level, swell: protectedCue ? 1 : high / level, minGap: 1.2, ramp: 0.8, fadeIn: 0, fadeOut: 0 });
    const fadeIn = Math.max(1 / fps, cue.crossfadeIn || cue.section.fadeIn || 0.35), fadeOut = Math.max(1 / fps, cue.crossfade || cue.section.fadeOut || 0.5);
    let cursor = 0;
    cue.points = Array.from({ length: Math.round(plan.duration * fps) + 1 }, (_, frame) => {
      const t = frame / fps, local = t - cue.outputStart;
      if (frame < startFrame || frame >= endFrame) return { t, v: 0 };
      while (cursor + 1 < lane.length && lane[cursor + 1].t <= local) cursor++;
      const a = lane[cursor], b = lane[cursor + 1] || a;
      let value = a.v + (b.v - a.v) * (b.t > a.t ? (local - a.t) / (b.t - a.t) : 0);
      // Intro/outro silence also swells, but protected speech/reactions never do.
      if (!protectedCue) {
        if (!localWords.length) value = high;
        else {
          const intro = Math.max(0, Math.min(1, (localWords[0].start - local) / 0.8));
          const outro = Math.max(0, Math.min(1, (local - localWords.at(-1).end) / 0.8));
          value = Math.max(value, level + (high - level) * Math.max(intro, outro));
        }
      }
      let fade = Math.min(1, local / fadeIn, (d - local) / fadeOut);
      if (cue.crossfade) fade = Math.min(1, local / fadeIn, (cue.outputEnd - t) / cue.crossfade);
      return { t, v: Math.max(0, value * fade) };
    });
    cue.duration = d;
  }
  return cues;
}

export function speakerMusicLane(plan, words = []) {
  if (!plan.music?.tracks && !plan.music?.sections?.some((s) => s.gainDb == null || s.start != null || s.fadeIn != null || s.fadeOut != null || s.snap)) return legacyMusicLane(plan, words);
  const cues = speakerMusicCues(plan, words);
  return Array.from({ length: Math.round(plan.duration * plan.canvas.fps) + 1 }, (_, n) => ({ t: n / plan.canvas.fps, v: cues.reduce((v, cue) => v + cue.points[n].v, 0) }));
}

/** Matched stem windows: a warning is reviewable, and never changes dialogue or protected sound. */
export function speechBedWarnings(windows, minimumLU = 8) {
  return windows.filter((w) => Number.isFinite(w.speechLUFS) && Number.isFinite(w.bedLUFS) && w.speechLUFS - w.bedLUFS < minimumLU).map((w) => ({ level: "warn", id: "music-masking", message: `speech ${w.start.toFixed(2)}-${w.end.toFixed(2)}s is only ${(w.speechLUFS - w.bedLUFS).toFixed(1)} LU above music (needs ${minimumLU})` }));
}
