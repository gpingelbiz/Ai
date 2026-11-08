import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firstJSON } from "./claude.mjs";
import { run, r3 } from "./util.mjs";
import { nativeTool } from "./native-tool.mjs";

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
const trimmedMean = (values) => {
  const sorted = [...values].sort((a, b) => a - b), trim = Math.floor(sorted.length * 0.1);
  const kept = sorted.slice(trim, sorted.length - trim);
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
};

export const QC_MEASUREMENTS = { localMinMotion: 12, maxCameraSpeed: 0.18, maxApproachGrowth: 0.8, minSprayDrift: 0.25 };

/** Repair only unquoted keys and trailing commas, leaving quoted observations untouched. */
export function visionJSON(text) {
  try { return firstJSON(text); } catch {
    const reply = String(text), start = reply.indexOf("{"), end = reply.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON in the reply");
    const repaired = reply.slice(start, end + 1).replace(/"(?:\\.|[^"\\])*"|([,{]\s*)([A-Za-z_$][\w$]*)(\s*:)|,(\s*[}\]])/g,
      (match, before, key, colon, closing) => key ? `${before}${JSON.stringify(key)}${colon}` : closing || match);
    return JSON.parse(repaired);
  }
}

/** Block matching estimates the shared camera shift; residual changes belong to the subject or scene. */
export function subjectMotion(pixels, { width = 64, height = 64, fps = 8, radius = 3, block = 8 } = {}) {
  const size = width * height, count = pixels.length / size;
  if (!Number.isInteger(count) || count < 2) throw new Error("not enough complete motion samples");
  const changes = [], shifts = [], regions = [], growth = [], residuals = [];
  for (let f = 1; f < count; f++) {
    const before = (f - 1) * size, after = f * size, matches = [];
    for (let y = radius; y + block < height - radius; y += block) for (let x = radius; x + block < width - radius; x += block) {
      let best = Infinity, shift = { x: 0, y: 0 };
      // Prefer zero on flat patches, where translation is unknowable.
      const offsets = [];
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) offsets.push({ x: dx, y: dy });
      offsets.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y));
      for (const offset of offsets) {
        let error = 0;
        for (let v = 0; v < block; v += 2) for (let u = 0; u < block; u += 2) error += Math.abs(pixels[before + (y + v) * width + x + u] - pixels[after + (y + v + offset.y) * width + x + u + offset.x]);
        if (error < best) { best = error; shift = offset; }
      }
      matches.push({ ...shift, atX: x + block / 2, atY: y + block / 2, error: best / (Math.ceil(block / 2) ** 2) });
    }
    if (!matches.length) throw new Error("motion grid too small");
    // The subject often fills the centre. Register against the outer scene instead.
    const border = matches.filter((s) => s.atX < width * 0.25 || s.atX > width * 0.75 || s.atY < height * 0.25);
    const background = border.length >= 4 ? border : matches;
    const shift = { x: median(background.map((s) => s.x)), y: median(background.map((s) => s.y)) };
    const expansion = (tracks) => {
      const rates = [];
      for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
        const a = tracks[i], b = tracks[j], dx = a.atX - b.atX, dy = a.atY - b.atY, distance = dx * dx + dy * dy;
        if (distance >= (width / 4) ** 2) rates.push(((a.x - b.x) * dx + (a.y - b.y) * dy) / distance * fps);
      }
      return rates.length >= 6 ? median(rates) : 0;
    };
    // Relative separation of feature blocks estimates size growth without confusing a pan with approach.
    const tracked = matches.filter((s) => s.error < 20);
    growth.push(expansion(tracked.filter((s) => s.atX >= width * 0.25 && s.atX <= width * 0.75 && s.atY >= height * 0.25 && Math.hypot(s.x - shift.x, s.y - shift.y) >= 0.75)) - expansion(tracked.filter((s) => background.includes(s))));
    let error = 0, samples = 0;
    const residual = new Float64Array(size);
    for (let y = radius; y < height - radius; y++) for (let x = radius; x < width - radius; x++) {
      const change = Math.abs(pixels[before + y * width + x] - pixels[after + (y + shift.y) * width + x + shift.x]);
      residual[y * width + x] = change; error += change; samples++;
    }
    changes.push(error / samples); shifts.push(shift); residuals.push(residual);
    // Keep a half-frame window over the largest residual, rather than zooming the centre blindly.
    const w = Math.floor(width / 2), h = Math.floor(height / 2);
    const stride = width + 1, sums = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) sums[(y + 1) * stride + x + 1] = residual[y * width + x] + sums[y * stride + x + 1] + sums[(y + 1) * stride + x] - sums[y * stride + x];
    let best = -1, region;
    for (let y = 0; y <= height - h; y += 2) for (let x = 0; x <= width - w; x += 2) {
      const sum = sums[(y + h) * stride + x + w] - sums[y * stride + x + w] - sums[(y + h) * stride + x] + sums[y * stride + x];
      if (sum > best) { best = sum; region = { x: x / width, y: y / height, width: w / width, height: h / height }; }
    }
    regions.push({ ...region, time: f / fps, change: error / samples });
  }
  const peak = changes.indexOf(Math.max(...changes));
  const trim = Math.floor(changes.length * 0.1), ordered = changes.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const kept = ordered.slice(trim, ordered.length - trim), accumulated = new Float64Array(size);
  for (const { index } of kept) for (let at = 0; at < size; at++) accumulated[at] += residuals[index][at] / kept.length;
  const window = Math.max(1, Math.round(fps / 2)), camera = [], approach = [];
  for (let at = 0; at + window <= shifts.length; at++) {
    const part = shifts.slice(at, at + window);
    camera.push(Math.hypot(median(part.map((s) => s.x)) / width, median(part.map((s) => s.y)) / height) * fps);
    approach.push(median(growth.slice(at, at + window)));
  }
  return { mean: changes.reduce((s, c) => s + c, 0) / changes.length, sustained: trimmedMean(changes), local: quantile(accumulated, 0.95), cameraSpeed: Math.max(0, ...camera), approachGrowth: Math.max(0, ...approach), frames: count, changes, shifts, regions, peakTime: (peak + 1) / fps };
}

/** Measure displaced surface material, excluding the dark object and its deep shadow. */
export function landingMotion(pixels, { width = 180, height = 320, fps = 24, contact, point, minSprayDrift = QC_MEASUREMENTS.minSprayDrift } = {}) {
  const size = width * height, count = pixels.length / size;
  if (!Number.isInteger(count) || count < 2) throw new Error("not enough complete landing samples");
  if (!Number.isFinite(contact) || ![point?.x, point?.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error("landing location unavailable");
  const before = Math.max(0, Math.round((contact - 0.25) * fps)), samples = [];
  for (let f = Math.max(before + 1, Math.ceil(contact * fps)); f < count && f / fps <= contact + 0.5; f++) {
    let mass = 0, radius = 0, xMoment = 0, left = 0, right = 0, area = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const rx = x / width - point.x, ry = (y - point.y * height) / width, r = Math.hypot(rx, ry), at = y * width + x;
      const base = pixels[before * size + at], delta = pixels[f * size + at] - base;
      if (r >= 0.4 || ry <= -0.08 || ry >= 0.22 || base < 170) continue;
      area++;
      const weight = delta > -55 && delta < 55 ? Math.max(0, Math.abs(delta) - 6) : 0;
      mass += weight; radius += weight * r; xMoment += weight * rx;
      if (rx < 0) left += weight; else right += weight;
    }
    samples.push({ time: f / fps, mass, energy: mass / Math.max(1, area), radius: radius / Math.max(1, mass), x: xMoment / Math.max(1, mass), symmetry: Math.min(left, right) / Math.max(1, left, right) });
  }
  const peak = Math.max(0, ...samples.map((s) => s.mass));
  const active = samples.filter((s) => s.mass >= peak * 0.3 && s.energy >= 1);
  const drift = active.length > 1 ? Math.max(...active.map((s) => s.x)) - Math.min(...active.map((s) => s.x)) : 0;
  let expansion = 0, nearest = Infinity;
  for (const sample of active) { expansion = Math.max(expansion, sample.radius - nearest); nearest = Math.min(nearest, sample.radius); }
  // A bright plume can be symmetric at impact. Require outward travel over several frames.
  const spray = active.length >= 3 && drift >= minSprayDrift && expansion >= 0.025;
  return { available: samples.length >= 3, spray, drift, expansion, symmetry: active.length ? median(active.map((s) => s.symmetry)) : 0, samples };
}

export function reviewTimes(duration, peakTime = 0) {
  // Floored: rounding 1.5667 up to 1.567 seeks past a 1.6 s clip's last frame and returns nothing.
  const last = Math.max(0, Math.floor((duration - 1 / 30) * 1000) / 1000), times = [0, last];
  for (let t = 0.25; t < last; t += 0.25) times.push(t);
  for (const offset of [-0.125, -1 / 30, 0, 1 / 30, 0.125]) times.push(Math.max(0, Math.min(last, peakTime + offset)));
  return [...new Set(times.map(r3))].sort((a, b) => a - b);
}

// A tiny bitmap time label keeps contact sheets usable even on ffmpeg builds without drawtext.
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];
export function timeLabel(time, file, width = 360, height = 28) {
  const pixels = Buffer.alloc(width * height * 3), label = time.toFixed(3);
  for (let c = 0; c < label.length; c++) {
    const bits = label[c] === "." ? "000000000000010" : DIGITS[Number(label[c])];
    for (let i = 0; i < 15; i++) if (bits[i] === "1") for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const at = ((3 + Math.floor(i / 3) * 3 + y) * width + 5 + c * 12 + i % 3 * 3 + x) * 3;
      pixels.fill(255, at, at + 3);
    }
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
}

/** Use decoded frame indices: rounded seeks can land just past the final PTS, even at 30 fps. */
export async function videoFrames(file, { runFn = run } = {}) {
  const probe = await runFn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", file], { capture: true });
  const frames = JSON.parse(probe.out).frames;
  if (!Array.isArray(frames) || !frames.length || frames.some((f) => f.best_effort_timestamp_time == null || !Number.isFinite(Number(f.best_effort_timestamp_time)))) throw new Error("video frame timestamps unavailable");
  const first = Number(frames[0].best_effort_timestamp_time);
  return frames.map((f, index) => ({ index, time: Number(f.best_effort_timestamp_time) - first }));
}

export async function contactSheet(file, duration, { dir, peakTime, inPoint = 0, times = reviewTimes(duration, peakTime), region, zoom = 2, samples, runFn = run } = {}) {
  samples ??= await videoFrames(file, { runFn });
  const available = samples.filter((f) => f.time >= 0 && f.time < duration);
  if (!available.length) throw new Error("no video frames in used interval");
  const selected = [...new Map(times.map((time) => {
    const nearest = available.reduce((a, b) => Math.abs(a.time - time) <= Math.abs(b.time - time) ? a : b);
    return [nearest.index, nearest];
  })).values()].sort((a, b) => a.index - b.index);
  const frames = [];
  for (const [i, { index, time }] of selected.entries()) {
    const frame = path.join(dir, `${i + 1}.png`), label = path.join(dir, `${i + 1}.ppm`), tile = path.join(dir, `${i + 1}.tile.png`);
    const width = 360 * zoom, height = 640 * zoom;
    const filter = region ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},crop=360:640:${Math.round(region.x * width)}:${Math.round(region.y * height)}` : "scale=360:640:force_original_aspect_ratio=increase,crop=360:640";
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-frames:v", "1", "-vf", `select=eq(n\\,${index}),${filter}`, "-fps_mode", "vfr", frame], { quiet: true });
    if (!fs.existsSync(frame)) throw new Error(`video check frame ${index} missing at ${time}s`);
    timeLabel(inPoint + time, label);
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", frame, "-i", label, "-filter_complex", "[0:v][1:v]vstack=inputs=2[out]", "-map", "[out]", "-frames:v", "1", tile], { quiet: true });
    frames.push({ file: frame, tile, time: r3(inPoint + time) });
  }
  // Bound page size so an image reader does not shrink a long timeline back to tiny cells.
  const sheets = [];
  for (let at = 0; at < frames.length; at += 6) {
    const page = frames.slice(at, at + 6), sheet = path.join(dir, `timeline-${sheets.length + 1}.png`);
    const layout = page.map((_, i) => `${i % 3 * 360}_${Math.floor(i / 3) * 668}`).join("|");
    const filter = page.length === 1 ? "[0:v]null[out]" : `${page.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${page.length}:layout=${layout}[out]`;
    await runFn("ffmpeg", ["-y", "-loglevel", "error", ...page.flatMap((f) => ["-i", f.tile]), "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", sheet], { quiet: true });
    if (!fs.existsSync(sheet)) throw new Error("contact sheet missing");
    sheets.push(sheet);
  }
  return { frames, sheet: sheets[0], sheets };
}

/** Fixed framing across each burst makes small changes at motion and contact easy to compare. */
export async function motionCrops(file, duration, { dir, motion, contact, inPoint = 0, samples, runFn = run } = {}) {
  samples ??= await videoFrames(file, { runFn });
  const crops = [];
  for (const [name, time] of [["peak", motion.peakTime], ["contact", contact]]) {
    if (!Number.isFinite(time)) continue;
    const nearby = motion.regions.filter((r) => Math.abs(r.time - time) <= 0.25);
    const region = nearby.sort((a, b) => b.change - a.change)[0] || motion.regions.reduce((a, b) => Math.abs(a.time - time) < Math.abs(b.time - time) ? a : b);
    const last = Math.max(0, duration - 1 / 30);
    const times = [...new Set([-0.25, -0.125, -1 / 30, 0, 1 / 30, 0.125, 0.25].map((offset) => r3(Math.max(0, Math.min(last, time + offset)))))];
    const cropDir = fs.mkdtempSync(path.join(dir, `${name}-`));
    crops.push({ name, time: r3(inPoint + time), region, ...await contactSheet(file, duration, { dir: cropDir, inPoint, times, region, samples, runFn }) });
  }
  return crops;
}

/** Keep the landing surface fixed at 3x, before contact and while the impact material disperses. */
export async function landingCrops(file, duration, { dir, contact, point, inPoint = 0, samples, runFn = run } = {}) {
  const region = { x: Math.max(0, Math.min(2 / 3, point.x - 1 / 6)), y: Math.max(0, Math.min(2 / 3, point.y - 1 / 6)), width: 1 / 3, height: 1 / 3 };
  const times = [-1 / 30, 0.2, 0.3, 0.4].map((offset) => contact + offset).filter((time) => time >= 0 && time < duration);
  const cropDir = fs.mkdtempSync(path.join(dir, "landing-"));
  return { name: "landing", time: r3(inPoint + contact), region, zoom: 3, ...await contactSheet(file, duration, { dir: cropDir, inPoint, times, region, zoom: 3, samples, runFn }) };
}

export const DEFECT_QUESTIONS = {
  upwardOrTeleport: "Does an object move upward against gravity BEFORE falling, or teleport? Track the same object's position against the background before release and throughout the fall: an unexplained upward hop before landing is a defect. A physical bounce AFTER contact is allowed.",
  contactArtifact: "At contact, is there a ring, halo, smear, double edge, melting or pass-through? Compare before/contact/after crops. Distinguish a generated contour from natural displaced sand and ordinary motion blur.",
  identityChange: "Do limbs, faces, anatomy, object shape or identity change unnaturally?",
  cameraSwing: "Is there a sudden camera swing or reframing?",
  aggressiveApproach: "Does an animal turn toward and come at the camera aggressively? A calm natural walk toward or away from the camera is allowed.",
  humanFaces: "Are any faces of PEOPLE visible? Animal faces are allowed.",
  readableText: "Is any readable text, lettering, label or logo visible?",
  unsafeAssociation: "Does anything with these spoken or neighbouring words read as a noose, a weapon in use, an attack, self-harm, death, threat or harm? Harmless animal motion can illustrate a joke without acting out harm.",
};

/** Contact and completion are optional timing hints, not requirements for a word-fitting action. */
export function validTimeline(result, duration, inPoint = 0) {
  return ["shows", "action", "dark", "physicsPlausible", "identityStable", "artifacts", "directionPlausible", "humanFaces", "readableText"].every((k) => typeof result[k] === "boolean") &&
    Array.isArray(result.defects) && result.defects.every((d) => typeof d === "string") &&
    Object.keys(DEFECT_QUESTIONS).every((key) => {
      const answer = result.checks?.[key];
      return answer && typeof answer.yes === "boolean" && typeof answer.why === "string" && !!answer.why.trim() &&
        (answer.yes ? Number.isFinite(answer.time) && answer.time >= inPoint && answer.time <= inPoint + duration : answer.time === null);
    }) &&
    ["continuous", "drop-land"].includes(result.eventType) &&
    Number.isFinite(result.onset) && result.onset >= 0 && result.onset <= duration &&
    (result.completion === null || Number.isFinite(result.completion) && result.completion >= result.onset && result.completion <= duration) &&
    (result.contact === null || Number.isFinite(result.contact) && result.contact >= result.onset && result.contact <= (result.completion ?? duration));
}

/** Prefer sustained measured subject movement within the located event, never empty lead-in or sky. */
export function motionWindowInPoint(timeline, duration, clipDuration, motion, { whole = false } = {}) {
  if (!timeline || !motion?.changes?.length || duration > clipDuration) return null;
  const fps = motion.fps || 8, end = timeline.completion ?? clipDuration;
  const from = Math.max(0, timeline.onset - 0.15);
  const until = Math.min(clipDuration - duration, Math.max(from, end - duration));
  const starts = [from, until];
  for (let t = Math.ceil(from * fps) / fps; t <= until; t += 1 / fps) starts.push(t);
  let best = null, score = 0;
  for (const start of starts.sort((a, b) => a - b)) {
    if (start < 0 || start + duration > clipDuration + 0.000001) continue;
    if (timeline.eventType === "drop-land") {
      const contact = timeline.contact ?? timeline.completion;
      if (contact != null && (contact < start || contact > start + duration)) continue;
      if (whole && (start > timeline.onset || (timeline.completion ?? contact ?? timeline.onset) + 0.2 > start + duration)) continue;
    }
    const mean = motion.changes.reduce((sum, change, i) => sum + change * Math.max(0, Math.min((i + 1) / fps, start + duration) - Math.max(i / fps, start)), 0) / duration;
    if (mean > score + 0.000001) { score = mean; best = start; }
  }
  return best === null ? null : r3(best);
}

export function eventInPoint(timeline, duration, clipDuration, fallback = 0, motion) {
  if (duration > clipDuration) return null;
  if (!timeline) return Math.max(0, Math.min(fallback, clipDuration - duration));
  const moving = motionWindowInPoint(timeline, duration, clipDuration, motion, { whole: true });
  if (moving !== null) return moving;
  let start = Math.max(0, timeline.onset - 0.15);
  if (timeline.eventType === "drop-land") {
    const end = timeline.completion ?? timeline.contact;
    // Include the landing/settle when it fits without losing the onset; the used pixels decide approval.
    if (Number.isFinite(end)) start = Math.min(timeline.onset, Math.max(start, end + 0.2 - duration));
  }
  start = Math.max(0, Math.min(start, clipDuration - duration));
  return r3(start);
}

/**
 * Where to cut found footage (stock or library) whose event runs longer than the cutaway: a window holding the
 * contact moment after a short lead-in, or starting at the onset of a continuous event such as a wave or a walk.
 * Generated clips keep eventInPoint, which needs the whole event inside the window.
 */
export function momentInPoint(timeline, duration, clipDuration, motion) {
  if (!timeline || duration > clipDuration) return null;
  const moving = motionWindowInPoint(timeline, duration, clipDuration, motion);
  if (moving !== null) return moving;
  const key = timeline.contact ?? timeline.onset;
  const lead = timeline.contact == null ? 0.15 : Math.min(0.6, duration * 0.4);
  const start = Math.max(0, Math.min(key - lead, clipDuration - duration));
  return key >= start && key <= start + duration && (timeline.completion == null || timeline.completion > start) ? r3(start) : null;
}

/** Review the portrait crop at phone size, including each overlapping caption in its actual band. */
export async function phonePreviews(file, shot, groups, { dir, caption = {}, runFn = run } = {}) {
  const top = Math.max(0, Math.min(0.95, caption.top ?? 0.62)), height = Math.min(1 - top, caption.height ?? 0.18);
  const lines = groups.filter((g) => g.start < shot.start + shot.duration && (g.end ?? g.start + 1) > shot.start);
  const previews = [];
  for (const [i, group] of (lines.length ? lines : [{ text: "" }]).entries()) {
    const out = path.join(dir, `phone-${i + 1}.png`), text = path.join(dir, `caption-${i + 1}.txt`);
    const captionText = String(group.text || "");
    fs.writeFileSync(text, caption.uppercase ? captionText.toUpperCase() : captionText);
    const base = `scale=360:640:force_original_aspect_ratio=increase,crop=360:640,drawbox=x=0:y=${Math.round(top * 640)}:w=360:h=${Math.ceil(height * 640)}:color=black@0.7:t=fill`;
    const args = ["-y", "-loglevel", "error", "-i", file, "-frames:v", "1", "-vf"];
    let textDrawn = true;
    try {
      const escaped = text.replace(/[':\\]/g, "\\$&");
      await runFn("ffmpeg", [...args, `${base},drawtext=textfile='${escaped}':expansion=none:fontcolor=white:fontsize=${Math.round((caption.fontSizeFrac ?? 0.04) * 640)}:x=(w-tw)/2:y=${Math.round(top * 640 + 8)}`, out], { quiet: true });
    } catch {
      textDrawn = false;
      await runFn("ffmpeg", [...args, base, out], { quiet: true });
    }
    if (!fs.existsSync(out)) throw new Error("phone preview missing");
    previews.push({ file: out, text: group.text, textDrawn, band: { top, height } });
  }
  return previews;
}

/** The evidence-image helper runs both Apple face detection and OCR and reports analysis errors. */
export async function localClipCheck(frames, { dir, runFn = run, look, pick, resolveTool = nativeTool } = {}) {
  const bin = await resolveTool("ocr", { compile: async () => {
    const source = fileURLToPath(new URL("../scripts/ocr.swift", import.meta.url)), bin = path.join(dir, "ocr");
    if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(source).mtimeMs) await runFn("swiftc", ["-O", "-o", bin, source], { capture: true });
    return bin;
  } });
  const reports = [];
  for (const frame of frames) {
    const response = await runFn(bin, [frame.file], { capture: true });
    const report = JSON.parse(response.out);
    if (!Array.isArray(report.lines) || !Array.isArray(report.faces) || !(report.width > 0) || !(report.height > 0)) throw new Error("incomplete Apple Vision report");
    reports.push({ time: frame.time, ...report });
    if (report.lines.some((l) => String(l.text || "").trim() && l.confidence >= 0.5)) return { ok: false, why: "readable text in generated frame", reports };
    if (report.faces.some((f) => f.confidence >= 0.5)) {
      // Vision can mistake an ape for a human. Confirm the species from the flagged frame.
      const result = firstJSON(await look(`Inspect ${JSON.stringify(path.relative(dir, frame.file))}. Apple Vision flagged a face. Is any HUMAN face visible? An animal face is allowed. Required subject: ${JSON.stringify(pick.shows)}. Reply JSON only: {"human":true|false,"certain":true|false}`, { cwd: dir }));
      if (result.human !== false || result.certain !== true) return { ok: false, why: "human face or uncertain face in generated frame", reports };
    }
  }
  return { ok: true, analyzed: reports.length, expected: frames.length, reports };
}

export function audioPeak(samples, rate = 16000) {
  let peak = 0, index = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > peak) { peak = Math.abs(samples[i]); index = i; }
  if (!(peak > 0) || !Number.isFinite(peak)) throw new Error("audio peak unavailable");
  return { db: 20 * Math.log10(peak), time: index / rate };
}

export function soundMix(effect, voice, timeline, shot, groups, { underDb = 12, impact = false } = {}) {
  if (effect.time < timeline.onset || effect.time > (timeline.completion ?? shot.duration) || impact && (!Number.isFinite(timeline.contact) || Math.abs(effect.time - timeline.contact) > 0.1)) return { ok: false, why: "sound peak outside the visible event" };
  if (![effect.db, voice.db, underDb].every(Number.isFinite)) throw new Error("sound level unavailable");
  underDb = Math.max(10, Math.min(14, underDb));
  const gainDb = Math.min(voice.db - underDb - effect.db, -14 - effect.db, 6), volume = 10 ** (gainDb / 20), duck = volume * 10 ** (-3 / 20);
  const onsets = groups.flatMap((g) => g.words || []).filter((w) => w.start >= shot.start && w.start < shot.start + shot.duration).filter((w, i, all) => !i || w.start - all[i - 1].end > 0.08);
  const points = new Map([[shot.start, volume], [shot.start + shot.duration, volume]]);
  for (const w of onsets) {
    points.set(Math.max(shot.start, w.start - 0.02), volume);
    points.set(Math.max(shot.start, w.start - 0.01), duck);
    points.set(Math.min(shot.start + shot.duration, w.start + 0.08), duck);
    points.set(Math.min(shot.start + shot.duration, w.start + 0.28), volume);
  }
  return { ok: true, gainDb: r3(gainDb), volume, audioTransientTime: effect.time, visualEventTime: timeline.contact, lane: [...points].sort(([a], [b]) => a - b).map(([t, v]) => ({ t: r3(t), v: r3(v) })) };
}

export async function verifySound(file, voiceFile, shot, timeline, groups, { dir, runFn = run, underDb = 12, impact = false } = {}) {
  if (!voiceFile) throw new Error("speech source unavailable for measured sound");
  const peaks = [];
  for (const [i, source] of [file, voiceFile].entries()) {
    const raw = path.join(dir, `audio-${i}.f32`);
    await runFn("ffmpeg", ["-y", "-loglevel", "error", ...(i ? ["-ss", String(shot.start)] : []), "-i", source, "-t", String(shot.duration), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", raw], { quiet: true });
    const data = fs.readFileSync(raw);
    if (!data.length || data.length % 4) throw new Error("audio samples unavailable");
    const samples = Array.from({ length: data.length / 4 }, (_, n) => data.readFloatLE(n * 4));
    const window = i ? samples.slice(Math.max(0, Math.floor((timeline.onset - 0.1) * 16000)), Math.min(samples.length, Math.ceil(((timeline.completion ?? shot.duration) + 0.1) * 16000))) : samples;
    peaks.push(audioPeak(window));
  }
  return soundMix(peaks[0], peaks[1], timeline, shot, groups, { underDb, impact });
}
