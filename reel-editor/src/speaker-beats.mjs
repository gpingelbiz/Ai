import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { run, writeJSON, readJSON } from "./util.mjs";

/** Energy-flux onsets and tempo autocorrelation. No models, downloads or Python runtime. */
export function detectBeats(samples, { sampleRate = 22050 } = {}) {
  if (!(sampleRate > 0)) throw new Error("speaker beats: sampleRate must be positive");
  const hop = Math.max(1, Math.round(sampleRate * 0.005)), flux = [];
  let previous = 0;
  for (let i = 0; i < samples.length; i += hop) {
    let energy = 0;
    for (let j = i; j < Math.min(samples.length, i + hop); j++) energy += samples[j] ** 2;
    energy = Math.sqrt(energy / hop);
    flux.push(Math.max(0, energy - previous)); previous = energy;
  }
  let max = 0;
  for (const value of flux) max = Math.max(max, value);
  if (max < 1e-6) return [];
  const step = hop / sampleRate, onsets = [];
  for (let i = 0; i < flux.length; i++) {
    if (flux[i] < max * 0.15 || flux[i] < (flux[i - 1] || 0) || flux[i] <= (flux[i + 1] || 0)) continue;
    if (onsets.length && i - onsets.at(-1) < 0.2 / step) {
      if (flux[i] > flux[onsets.at(-1)]) onsets[onsets.length - 1] = i;
    } else onsets.push(i);
  }
  if (onsets.length < 3) return onsets.map((i) => i * step);
  let best = 0, lag = Math.round(0.5 / step);
  for (let n = Math.round(0.3 / step); n <= Math.round(1 / step); n++) {
    let score = 0;
    for (const i of onsets) score += flux[i] * ((flux[i + n] || 0) + 0.5 * ((flux[i + n - 1] || 0) + (flux[i + n + 1] || 0)));
    // A weak tempo prior resolves exact half/double-time ties, without overpowering measured attacks.
    score *= 1 - Math.abs(n * step - 0.5) * 0.05;
    if (score > best) { best = score; lag = n; }
  }
  const period = lag * step;
  let anchor = onsets[0] * step, phaseScore = -1;
  for (const i of onsets.slice(0, 100)) {
    const phase = i * step;
    const score = onsets.reduce((sum, j) => {
      const distance = Math.abs((j * step - phase) / period - Math.round((j * step - phase) / period));
      return sum + (distance < 0.12 ? flux[j] : 0);
    }, 0);
    if (score > phaseScore) { phaseScore = score; anchor = phase; }
  }
  while (anchor - period >= 0) anchor -= period;
  const beats = [];
  for (let t = anchor; t <= onsets.at(-1) * step + period * 0.1; t += period) {
    let nearest = t, distance = 0.08;
    for (const i of onsets) if (Math.abs(i * step - t) < distance) { nearest = i * step; distance = Math.abs(nearest - t); }
    beats.push(Math.round(nearest * 1000000) / 1000000);
  }
  return beats;
}

/** Full-content hash; decoding and cached data stay under work/index, never beside originals. */
export async function speakerBeats(file, { indexDir = path.resolve("work/index"), runImpl = run } = {}) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const key = hash.digest("hex"), cache = path.join(indexDir, `beats-v1-${key}.json`);
  if (fs.existsSync(cache)) return readJSON(cache).beats;
  fs.mkdirSync(indexDir, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-beats-"));
  try {
    const pcm = path.join(scratch, "mono.f32");
    await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "22050", "-f", "f32le", pcm], { capture: true });
    const bytes = fs.readFileSync(pcm), samples = new Float32Array(bytes.length / 4);
    for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
    const beats = detectBeats(samples);
    writeJSON(cache, { schemaVersion: 1, hash: key, beats });
    return beats;
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

/** Translate source beats through cue offsets and loops, without changing the output span. */
export function sectionBeatTimes(beats, { sourceStart = 0, outputStart, outputEnd, trackDuration }) {
  if (![trackDuration, sourceStart, outputStart, outputEnd].every(Number.isFinite) || !(trackDuration > 0) || sourceStart < 0 || sourceStart >= trackDuration || !(outputEnd > outputStart)) throw new Error("speaker beats: invalid section offset or track duration");
  const result = [];
  for (let loop = 0; loop * trackDuration - sourceStart + outputStart <= outputEnd; loop++) {
    for (const beat of beats) {
      const at = beat + loop * trackDuration - sourceStart + outputStart;
      if (at >= outputStart && at <= outputEnd) result.push(at);
    }
  }
  return result.sort((a, b) => a - b).filter((b, n, all) => !n || b > all[n - 1] + 1e-7);
}

/** Return an integer-frame boundary only when the beat is within the permitted four frames. */
export function snapFrame(frame, beats, { fps = 30, maxFrames = 4 } = {}) {
  let chosen = frame, distance = maxFrames + 1;
  for (const beat of beats) {
    const candidate = Math.round(beat * fps), d = Math.abs(candidate - frame);
    if (d <= maxFrames && d < distance) { chosen = candidate; distance = d; }
  }
  return chosen;
}

/** Picture-only shots cover a fixed dialogue span; short beat gaps are combined to keep >=0.8s. */
export function layoutMontage(montage, item, beats, { fps = 30 } = {}) {
  if (![1, 2].includes(montage.every ?? 1)) throw new Error(`${montage.id}: montage every must be 1 or 2`);
  if (item.protect) throw new Error(`${montage.id}: montage cannot cover protected speech or reactions`);
  const start = item.startFrame + Math.round(montage.offset * fps), end = start + Math.round(montage.duration * fps);
  if (start < item.startFrame || end > item.endFrame || end <= start) throw new Error(`${montage.id}: montage span exceeds ${item.id}`);
  const min = Math.ceil(0.8 * fps), boundaries = [start];
  const grid = [...new Set(beats.map((b) => Math.round(b * fps)))].sort((a, b) => a - b).filter((b) => b > start && b < end);
  for (let n = (montage.every ?? 1) - 1; n < grid.length; n += montage.every ?? 1) if (grid[n] - boundaries.at(-1) >= min && end - grid[n] >= min) boundaries.push(grid[n]);
  boundaries.push(end);
  if (!montage.shots?.length || boundaries.length - 1 > montage.shots.length) throw new Error(`${montage.id}: montage needs ${boundaries.length - 1} picture-only shots`);
  return boundaries.slice(0, -1).map((frame, n) => {
    const shot = montage.shots[n], duration = (boundaries[n + 1] - frame) / fps;
    if (duration < 0.8 || shot.out - shot.in < duration - 1e-7) throw new Error(`${montage.id}: shot ${n + 1} is too short (${duration}s required)`);
    return { ...shot, id: `${montage.id}-${n + 1}`, montageId: montage.id, over: item.id, offset: (frame - item.startFrame) / fps, out: shot.in + duration };
  });
}

/** Snap only picture-only montage boundaries; dialogue with source audio is never shortened. */
export function snapSpeakerPlan(plan, sectionBeats, { index } = {}) {
  const result = structuredClone(plan), fps = plan.canvas.fps;
  for (const { section, beats } of sectionBeats) {
    const from = result.items.find((i) => i.id === section.from), to = result.items.find((i) => i.id === section.to);
    if (section.snap !== "beats") continue;
    // Moving an item join changes both source ranges only for explicitly muted montage pictures.
    for (let n = 1; n < result.items.length; n++) {
      const a = result.items[n - 1], b = result.items[n];
      if (!b.snap || a.role !== "montage" || b.role !== "montage" || a.audio !== "mute" || b.audio !== "mute" || a.protect || b.protect || b.startFrame <= from.startFrame || b.startFrame >= to.endFrame) continue;
      const shifted = snapFrame(b.startFrame, beats, { fps }), delta = shifted - b.startFrame;
      if ((a.out - a.in) * fps + delta < 24 || (b.out - b.in) * fps - delta < 24) continue;
      const sourceEnd = (index?.sources?.[a.sourceId] || index?.[a.sourceId])?.duration ?? Infinity;
      const aOut = a.in + (shifted - a.startFrame) / fps, bIn = b.out - (b.endFrame - shifted) / fps;
      if (aOut > sourceEnd + 1e-7 || bIn < 0) continue;
      a.out = aOut; b.in = bIn;
      a.endFrame = shifted; b.startFrame = shifted;
    }
    for (const x of result.cutaways || []) {
      const item = result.items.find((i) => i.id === x.over);
      if (item.protect || item.startFrame + Math.round(x.offset * fps) < from.startFrame || item.startFrame + Math.round(x.offset * fps) >= to.endFrame) continue;
      const start = item.startFrame + Math.round(x.offset * fps), end = start + Math.round((x.out - x.in) * fps);
      if (end - start < Math.ceil(0.8 * fps)) continue;
      const shiftedStart = snapFrame(start, beats, { fps }), shiftedEnd = snapFrame(end, beats, { fps });
      const sourceEnd = (index?.sources?.[x.sourceId] || index?.[x.sourceId])?.duration ?? Infinity;
      const newStart = shiftedStart;
      let newEnd = shiftedEnd;
      if (newStart < item.startFrame || newEnd > Math.min(item.endFrame, to.endFrame) || newEnd - newStart < Math.ceil(0.8 * fps)) continue;
      if (x.in + (newEnd - newStart) / fps > sourceEnd + 1e-7) newEnd = Math.min(end, newStart + Math.round((x.out - x.in) * fps));
      if (newEnd - newStart < Math.ceil(0.8 * fps)) continue;
      if ((result.cutaways || []).some((other) => other !== x && other.over === x.over && newStart < item.startFrame + Math.round((other.offset + other.out - other.in) * fps) && newEnd > item.startFrame + Math.round(other.offset * fps))) continue;
      x.offset = (newStart - item.startFrame) / fps;
      x.out = x.in + (newEnd - newStart) / fps;
    }
  }
  return result;
}

/** Structural safety checks are also called before compilation, including plan-only runs. */
export function motionProblems(plan, manifest = {}) {
  const problems = [], add = (id, message) => problems.push({ level: "error", id, message });
  const items = plan.items || [], byId = new Map(items.map((i) => [i.id, i]));
  let decorative = 0;
  for (const [n, item] of items.entries()) {
    if (item.snap != null && typeof item.snap !== "boolean") add(item.id, "snap must be true or false");
    const type = item.transition ?? "cut";
    if (!["cut", "dip", "flash", "whip"].includes(type)) add(item.id, "unknown transition");
    if (type !== "cut") {
      decorative++;
      const before = items[n - 1], afterFrames = type === "dip" ? 4 : type === "flash" ? 2 : 3;
      const frames = (i) => Math.round((i?.kind === "clip" ? i.out - i.in : i?.duration || 0) * 30);
      if (before && (frames(before) < afterFrames || frames(item) < afterFrames)) add(item.id, "transition exceeds an adjacent item span");
      if (!n) add(item.id, "transition requires a preceding item boundary");
      if (item.protect || items[n - 1]?.protect || item.role === "core" || items[n - 1]?.role === "core") add(item.id, "decorative transition cannot touch protected speech or the core");
    }
    if (item.card?.type === "keyword") add(item.id, "keyword cards must be overlays");
  }
  if (decorative > 4) add("transitions", "at most four decorative transitions per reel");
  for (const key of ["montage", "sfx"]) if (plan[key] != null && !Array.isArray(plan[key])) add(key, `${key} must be an array`);
  for (const m of Array.isArray(plan.montage) ? plan.montage : []) {
    if (!m || !/^[a-zA-Z0-9_-]+$/.test(m.id || "")) { add("montage", "montage needs a safe id"); continue; }
    const item = byId.get(m.over);
    if (!item || item.kind !== "clip" || item.protect) add(m.id, "montage needs an unprotected clip target");
    if (!(m.offset >= 0) || !Number.isFinite(m.offset) || !(m.duration >= 0.8) || !Number.isFinite(m.duration)) add(m.id, "montage needs offset >= 0 and duration >= 0.8");
    if (![1, 2].includes(m.every ?? 1)) add(m.id, "montage every must be 1 or 2");
    if (!Array.isArray(m.shots) || !m.shots.length) add(m.id, "montage needs picture-only shots");
    for (const [n, shot] of (Array.isArray(m.shots) ? m.shots : []).entries()) {
      if (!shot || !manifest.sources?.some((s) => s.id === shot.sourceId && ["broll", "photo"].includes(s.kind))) add(m.id, `shot ${n + 1} must be an indexed broll or photo source`);
      if (!Number.isFinite(shot?.in) || !Number.isFinite(shot?.out) || shot.in < 0 || shot.out - shot.in < 0.8) add(m.id, `shot ${n + 1} needs a usable source range`);
    }
    const sections = Array.isArray(plan.music?.sections) ? plan.music.sections.filter(Boolean) : [];
    if (!sections.some((s) => s.snap === "beats" && items.indexOf(byId.get(s.from)) <= items.indexOf(item) && items.indexOf(byId.get(s.to)) >= items.indexOf(item))) add(m.id, "montage needs a music section with snap: beats");
  }
  for (const o of plan.overlays || []) if (o?.card?.type === "keyword") {
    if (!byId.has(o.at) || byId.get(o.at).kind !== "clip") add(o.id, "keyword needs a speaking clip target");
    if (byId.get(o.at)?.role === "testimonial" || manifest.sources?.find((s) => s.id === byId.get(o.at)?.sourceId)?.kind === "testimonial") add(o.id, "keyword cannot cover a testimonial");
    if (o.duration < 1.2 || o.duration > 2.5) add(o.id, "keyword duration must be 1.2 to 2.5 seconds");
    const tokens = String(o.card.text || "").trim().split(/\s+/u).filter(Boolean);
    if (tokens.length < 1 || tokens.length > 3) add(o.id, "keyword needs one to three transcript words");
    if (o.card.position != null && !["center", "lower-third"].includes(o.card.position)) add(o.id, "keyword position must be center or lower-third");
    if (o.card.motion != null && !["scale", "slide"].includes(o.card.motion)) add(o.id, "keyword motion must be scale or slide");
  }
  let cursor = 0;
  const spans = items.map((i) => {
    const start = cursor; cursor += Math.round((i.kind === "clip" ? i.out - i.in : i.duration) * 30) / 30;
    return { id: i.id, start, end: cursor, protect: i.protect };
  });
  const entries = [...items, ...(plan.overlays || [])], effectIds = new Set();
  for (const s of Array.isArray(plan.sfx) ? plan.sfx : []) {
    if (!s || typeof s !== "object") { add("sfx", "SFX must be objects"); continue; }
    if (!/^[a-zA-Z0-9_-]+$/.test(s.id || "") || effectIds.has(s.id)) add(s.id || "sfx", "SFX needs a distinct safe id");
    effectIds.add(s.id);
    const target = entries.find((i) => i.id === s.at);
    if (!target || !(target.card || target.transition && target.transition !== "cut")) add(s.id || "sfx", "SFX must name a transition boundary or card entry");
    if (typeof s.file !== "string" || !s.file.trim()) add(s.id || "sfx", "SFX file is required");
    if (!Number.isFinite(s.gainDb) || s.gainDb > 0 || s.gainDb < -96) add(s.id || "sfx", "SFX gainDb must be -96 to 0");
    if (s.duration != null && (!Number.isFinite(s.duration) || s.duration <= 0 || s.duration > 6)) add(s.id || "sfx", "SFX duration must be 0 to 6 seconds");
    if (s.start != null && (!Number.isFinite(s.start) || s.start < 0)) add(s.id || "sfx", "SFX start must be non-negative");
    const protectedItem = target?.at ? byId.get(target.at) : target;
    const span = spans.find((i) => i.id === protectedItem?.id), start = (span?.start || 0) + (target?.at ? target.offset : 0);
    if (span && spans.some((i) => i.protect && i.start < start + (s.duration ?? 0.6) && i.end > start)) add(s.id || "sfx", "SFX cannot cover protected speech or reactions");
  }
  return problems;
}

/** Verbatim contiguous tokens within the same output item; timing and source identity stay code-owned. */
export function validateKeywords(plan, words, manifest = {}) {
  const problems = motionProblems(plan, manifest).filter((p) => (plan.overlays || []).some((o) => o.id === p.id && o.card?.type === "keyword"));
  const normalize = (text) => String(text).toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  const overlays = (plan.overlays || []).filter((o) => o.card?.type === "keyword").sort((a, b) => a.start - b.start);
  for (const [n, o] of overlays.entries()) {
    const item = plan.items.find((i) => i.id === o.at), wanted = normalize(o.card.text);
    const spoken = words.filter((w) => item && w.sourceId === item.sourceId && (w.itemId == null || w.itemId === item.id) && w.start >= item.start && w.end <= item.end + 1e-7).sort((a, b) => a.start - b.start).flatMap((w) => normalize(w.text));
    if (!wanted.length || !spoken.some((_, at) => wanted.every((word, i) => spoken[at + i] === word))) problems.push({ level: "error", id: o.id, message: "keyword words must occur in order in this speaker item's output transcript" });
    if (n && o.start - overlays[n - 1].start < 20 - 1e-7) problems.push({ level: "error", id: o.id, message: "keyword overlays must be at least 20 seconds apart" });
  }
  return problems;
}
