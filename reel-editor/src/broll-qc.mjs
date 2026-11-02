import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firstJSON } from "./claude.mjs";
import { run, r3 } from "./util.mjs";

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Block matching estimates the shared camera shift; residual changes belong to the subject or scene. */
export function subjectMotion(pixels, { width = 64, height = 64, fps = 8, radius = 3, block = 8 } = {}) {
  const size = width * height, count = pixels.length / size;
  if (!Number.isInteger(count) || count < 2) throw new Error("not enough complete motion samples");
  const changes = [], shifts = [];
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
      matches.push(shift);
    }
    if (!matches.length) throw new Error("motion grid too small");
    const shift = { x: median(matches.map((s) => s.x)), y: median(matches.map((s) => s.y)) };
    let error = 0, samples = 0;
    for (let y = radius; y < height - radius; y++) for (let x = radius; x < width - radius; x++) {
      error += Math.abs(pixels[before + y * width + x] - pixels[after + (y + shift.y) * width + x + shift.x]); samples++;
    }
    changes.push(error / samples); shifts.push(shift);
  }
  const peak = changes.indexOf(Math.max(...changes));
  return { mean: changes.reduce((s, c) => s + c, 0) / changes.length, frames: count, changes, shifts, peakTime: (peak + 1) / fps };
}

export function reviewTimes(duration, peakTime = 0) {
  const last = Math.max(0, duration - 1 / 30), times = [0, last];
  for (let t = 0.25; t < last; t += 0.25) times.push(t);
  for (const offset of [-0.125, -1 / 30, 0, 1 / 30, 0.125]) times.push(Math.max(0, Math.min(last, peakTime + offset)));
  return [...new Set(times.map(r3))].sort((a, b) => a - b);
}

// A tiny bitmap time label keeps contact sheets usable even on ffmpeg builds without drawtext.
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];
export function timeLabel(time, file, width = 180, height = 20) {
  const pixels = Buffer.alloc(width * height * 3), label = time.toFixed(3);
  for (let c = 0; c < label.length; c++) {
    const bits = label[c] === "." ? "000000000000010" : DIGITS[Number(label[c])];
    for (let i = 0; i < 15; i++) if (bits[i] === "1") for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const at = ((3 + Math.floor(i / 3) * 2 + y) * width + 5 + c * 8 + i % 3 * 2 + x) * 3;
      pixels.fill(255, at, at + 3);
    }
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
}

export async function contactSheet(file, duration, { dir, peakTime, inPoint = 0, runFn = run } = {}) {
  const frames = [];
  for (const [i, time] of reviewTimes(duration, peakTime).entries()) {
    const frame = path.join(dir, `${i + 1}.png`), label = path.join(dir, `${i + 1}.ppm`), tile = path.join(dir, `${i + 1}.tile.png`);
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(time), "-i", file, "-frames:v", "1", "-vf", "scale=360:640:force_original_aspect_ratio=increase,crop=360:640", frame], { quiet: true });
    if (!fs.existsSync(frame)) throw new Error("video check frame missing");
    timeLabel(inPoint + time, label);
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", frame, "-i", label, "-filter_complex", "[0:v]scale=180:320[v];[v][1:v]vstack=inputs=2[out]", "-map", "[out]", "-frames:v", "1", tile], { quiet: true });
    frames.push({ file: frame, tile, time: r3(inPoint + time) });
  }
  const sheet = path.join(dir, "timeline.png"), columns = 4;
  const layout = frames.map((_, i) => `${i % columns * 180}_${Math.floor(i / columns) * 340}`).join("|");
  await runFn("ffmpeg", ["-y", "-loglevel", "error", ...frames.flatMap((f) => ["-i", f.tile]), "-filter_complex", `${frames.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${frames.length}:layout=${layout}[out]`, "-map", "[out]", "-frames:v", "1", sheet], { quiet: true });
  if (!fs.existsSync(sheet)) throw new Error("contact sheet missing");
  return { frames, sheet };
}

/** A valid discrete event must have an ordered start, contact (if applicable), and readable ending. */
export function validTimeline(result, duration) {
  return ["shows", "action", "dark", "physicsPlausible", "identityStable", "artifacts", "directionPlausible", "humanFaces", "readableText"].every((k) => typeof result[k] === "boolean") &&
    Array.isArray(result.defects) && result.defects.every((d) => typeof d === "string") &&
    Number.isFinite(result.onset) && Number.isFinite(result.completion) && result.onset >= 0 && result.completion >= result.onset && result.completion <= duration &&
    (result.contact === null || Number.isFinite(result.contact) && result.contact >= result.onset && result.contact <= result.completion);
}

export function eventInPoint(timeline, duration, clipDuration, fallback = 0) {
  if (!timeline) return Math.max(0, Math.min(fallback, clipDuration - duration));
  const start = Math.max(0, Math.min(timeline.onset - 0.15, clipDuration - duration));
  const requiredEnd = timeline.completion + 0.2;
  if (start > timeline.onset || requiredEnd > start + duration + 0.000001 || duration > clipDuration) return null;
  return r3(start);
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
export async function localClipCheck(frames, { dir, runFn = run, look, pick } = {}) {
  const source = fileURLToPath(new URL("../scripts/ocr.swift", import.meta.url)), bin = path.join(dir, "ocr");
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(source).mtimeMs) await runFn("swiftc", ["-O", "-o", bin, source], { capture: true });
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
  if (effect.time < timeline.onset || effect.time > timeline.completion || impact && (!Number.isFinite(timeline.contact) || Math.abs(effect.time - timeline.contact) > 0.1)) return { ok: false, why: "sound peak outside the visible event" };
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
    const window = i ? samples.slice(Math.max(0, Math.floor((timeline.onset - 0.1) * 16000)), Math.min(samples.length, Math.ceil((timeline.completion + 0.1) * 16000))) : samples;
    peaks.push(audioPeak(window));
  }
  return soundMix(peaks[0], peaks[1], timeline, shot, groups, { underDb, impact });
}
