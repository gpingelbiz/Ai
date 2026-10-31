import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { measureClip } from "./cuts.mjs";
import { sourceCacheKey } from "./speaker-index.mjs";
import { run, ensureDir, readJSON, writeJSON } from "./util.mjs";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const short = (n) => Number(n.toFixed(8));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// ffmpeg filter paths have two escaping layers; CLI arguments themselves never pass through a shell.
export const filterPath = (file) => String(file).replace(/([\\':])/g, "\\$1").replace(/([\\'\[\],;\s])/g, "\\$1");

export function lookOptions(look = {}) {
  if (!look || typeof look !== "object" || Array.isArray(look)) throw new Error("look must be an object");
  const grade = look.grade ?? "auto", letterbox = look.letterbox ?? null;
  if (!["auto", "off"].includes(grade)) throw new Error("look.grade must be auto or off");
  if (![null, 2.35, 2.39].includes(letterbox)) throw new Error("look.letterbox must be null, 2.35 or 2.39");
  return { ...look, grade, letterbox };
}

export function activeBox(letterbox = null, { width = 1920, height = 1080 } = {}) {
  if (![null, 2.35, 2.39].includes(letterbox)) throw new Error("look.letterbox must be null, 2.35 or 2.39");
  const h = letterbox == null ? height : Math.min(height, Math.round(width / letterbox / 2) * 2);
  return { x: 0, y: (height - h) / 2, width, height: h };
}

export function defaultFit(meta = {}, canvas = {}) {
  return meta.width < meta.height || meta.height < (canvas.height || 1080) * 0.6 ? "blur" : "contain";
}

export function pushScale(frame, frames, push = 1) {
  if (!Number.isFinite(push) || push < 1 || push > 1.2) throw new Error("push must be between 1 and 1.2");
  const u = frames <= 1 ? 0 : clamp(frame / (frames - 1), 0, 1);
  return 1 + (push - 1) * u * u * (3 - 2 * u);
}

export function pushFilter(frames, push = 1, { width = 1920, height = 1080, fps = 30 } = {}) {
  pushScale(0, frames, push);
  if (push === 1 || frames <= 1) return "";
  const u = `min(1,on/${frames - 1})`;
  return `scale=${width * 4}:${height * 4}:flags=lanczos,zoompan=z='1+${short(push - 1)}*(${u})*(${u})*(3-2*(${u}))':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${width}x${height}:fps=${fps}`;
}

/** Named pads make this usable for both the dialogue picture and picture-only cutaways. */
export function fitGraph(input, output, geometry, { fit = "contain", background = "#111111", frames, push = 1, width = 1920, height = 1080, fps = 30 } = {}) {
  const motion = pushFilter(frames, push, { width, height, fps });
  const name = (part) => `${output}_${part}`;
  // Reserve the push margin before scaling. Even its last frame respects the foreground enlargement ceiling.
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  const scale = push > 1 && fit !== "cover" ? `scale=${even(geometry.width / push)}:${even(geometry.height / push)}:flags=lanczos,setsar=1` : geometry.filter;
  const finish = (label) => motion ? `[${label}]${motion}[${output}]` : `[${label}]null[${output}]`;
  if (fit !== "blur") return [`[${input}]${scale},${fit === "cover" ? `crop=${width}:${height}` : `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${background}`}[${name("fit")}]`, finish(name("fit"))];
  return [
    `[${input}]split=2[${name("bg")}][${name("fg")}]`,
    `[${name("bg")}]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,gblur=sigma=${short(40 * height / 1080)}:steps=3,eq=saturation=0.8,lutyuv=y='16+(val-16)*0.65'[${name("back")}]`,
    `[${name("fg")}]${scale},format=yuva420p,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0[${name("front")}]`,
    // Transparent pad must be created in an alpha format, before overlaying the sharp foreground.
    `[${name("back")}][${name("front")}]overlay=0:0:shortest=1[${name("fit")}]`, finish(name("fit")),
  ];
}

/** Ignore near-black, clipped, skin and saturated pixels when estimating a neutral illuminant. */
export function neutralStats(pixels) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i + 2 < pixels.length; i += 3) {
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) => v / 255);
    const hi = Math.max(...rgb), lo = Math.min(...rgb);
    if (lo < 0.08 || hi > 0.92 || (hi - lo) / hi > 0.32 || skinWeight(rgb) > 0.2) continue;
    r += rgb[0]; g += rgb[1]; b += rgb[2]; count++;
  }
  return count ? { r: r / count, g: g / count, b: b / count, count, fraction: count / (pixels.length / 3) } : null;
}

/** A broad orange/red skin region includes dark and light complexions. It protects hue, not identity. */
export function skinWeight([r, g, b]) {
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), chroma = hi - lo;
  if (chroma < 0.025 || r < g || g < b) return 0;
  const hue = 60 * (g - b) / chroma;
  return clamp((hue - 0) / 8, 0, 1) * clamp((65 - hue) / 10, 0, 1);
}

export function gradeSettings(stats = {}, neutral = null) {
  const ev = Number.isFinite(stats.luma) && stats.luma > 0 ? clamp(Math.log2(0.42 / stats.luma), -0.3, 0.3) : 0;
  const coloredStage = stats.saturation > 0.55 || Math.abs(stats.warmth || 0) > 0.18;
  let balance = [0, 0, 0];
  if (!coloredStage && neutral?.fraction >= 0.05) {
    const mean = (neutral.r + neutral.g + neutral.b) / 3;
    balance = [neutral.r, neutral.g, neutral.b].map((v) => clamp((mean - v) * 0.25, -0.015, 0.015));
  }
  return { ev: short(ev), balance: balance.map(short), contrast: 0.025, warmth: 0.003, coloredStage };
}

/** Luminance changes use one RGB multiplier. Skin gets no chromatic balance or warmth shift. */
export function gradePixel(rgb, settings) {
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const exposed = clamp(y * 2 ** clamp(settings.ev, -0.3, 0.3), 0, 1);
  const target = exposed + settings.contrast * (exposed - 0.5) * 4 * exposed * (1 - exposed);
  const gain = y > 0 ? Math.min(target / y, 1 / Math.max(...rgb)) : 1;
  const protect = 1 - skinWeight(rgb);
  return rgb.map((v, i) => clamp(v * gain + protect * (settings.balance[i] + (i === 0 ? settings.warmth : i === 2 ? -settings.warmth : 0)) * 4 * y * (1 - y), 0, 1));
}

export function gradeCube(settings, size = 33) {
  if (!Number.isInteger(size) || size < 2 || size > 65) throw new Error("LUT size must be between 2 and 65");
  const rows = ["TITLE \"Speaker neutral match and gentle house grade\"", `LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) rows.push(gradePixel([r, g, b].map((v) => v / (size - 1)), settings).map((v) => v.toFixed(7)).join(" "));
  return rows.join("\n") + "\n";
}

/** Measurements are held for a source, never chased frame by frame. HDR conversion happens before sampling. */
export async function prepareGrade(file, { sourceKey, meta, preFilter = "", cacheDir, execute = run, measure = measureClip, print = console.warn } = {}) {
  const key = hash({ version: 1, sourceKey: sourceKey || sourceCacheKey(file), preFilter });
  const dir = ensureDir(cacheDir), facts = path.join(dir, `${key}.look.json`), lut = path.join(dir, `${key}.cube`);
  try {
    let data;
    if (fs.existsSync(facts)) data = readJSON(facts);
    else {
      const stats = await measure(file, { duration: meta.duration, preFilter });
      const raw = path.join(dir, `${key}.rgb`);
      try {
        const duration = meta.duration > 0 ? meta.duration : 1;
        await execute("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-an", "-vf", [preFilter, `fps=${12 / duration}:start_time=${duration / 24}:round=near`, "scale=32:32:flags=area", "format=rgb24"].filter(Boolean).join(","), "-frames:v", "12", "-f", "rawvideo", raw], { capture: true });
        data = { schemaVersion: 1, key, stats, neutral: neutralStats(fs.readFileSync(raw)) };
      } finally { fs.rmSync(raw, { force: true }); }
      data.settings = gradeSettings(data.stats, data.neutral);
      writeJSON(facts, data);
    }
    if (!fs.existsSync(lut)) fs.writeFileSync(lut, gradeCube(data.settings));
    return { ...data, filter: `lut3d=file=${filterPath(lut)}:interp=tetrahedral`, lut };
  } catch { print("speaker look: source colour measurement unavailable; using gentle house grade");
    const settings = gradeSettings();
    fs.writeFileSync(lut, gradeCube(settings));
    return { key, settings, lut, filter: `lut3d=file=${filterPath(lut)}:interp=tetrahedral`, fallback: true };
  }
}

export function stabilizationKey(sourceKey, range, settings = {}) {
  return hash({ version: 1, sourceKey, in: range.in, out: range.out, duration: range.duration, preFilter: settings.preFilter || "", fps: 30, handles: 1, smoothing: 15, zoom: 3, ...settings });
}

/** Two passes include handles. Only picture is cached; original audio always stays on its own source clock. */
export async function stabilizeRange(file, range, { sourceKey, cacheDir, preFilter = "", execute = run, encodeVideo, print = console.warn } = {}) {
  const key = stabilizationKey(sourceKey || sourceCacheKey(file), range, { preFilter });
  const dir = ensureDir(cacheDir), output = path.join(dir, `${key}.mov`), pending = path.join(dir, `${key}.pending.mov`), transforms = path.join(dir, `${key}.trf`);
  const start = Math.max(0, range.in - 1), end = Math.min(range.duration, range.out + 1), duration = end - start;
  const result = { file: output, in: range.in - start, key, stabilized: true };
  if (fs.existsSync(output)) return result;
  const prefix = [preFilter, "fps=30:start_time=0:round=near"].filter(Boolean).join(",");
  const common = ["-y", "-loglevel", "error", "-filter_threads", "1", "-noautorotate", "-ss", String(start), "-t", String(duration), "-i", file, "-an"];
  try {
    await execute("ffmpeg", [...common, "-vf", `${prefix},vidstabdetect=shakiness=5:accuracy=9:result=${filterPath(transforms)}`, "-f", "null", "-"], { capture: true });
    const args = [...common, "-vf", `${prefix},vidstabtransform=input=${filterPath(transforms)}:smoothing=15:zoom=3:optzoom=1:interpol=bicubic,format=yuv420p`, "-frames:v", String(Math.round(duration * 30)), "-r", "30", "-fps_mode", "cfr"];
    if (encodeVideo) await encodeVideo(args, ["-pix_fmt", "yuv420p", pending]);
    else await execute("ffmpeg", [...args, "-c:v", "libx264", "-preset", "fast", "-crf", "18", pending], { capture: true });
    fs.renameSync(pending, output);
    return result;
  } catch {
    fs.rmSync(pending, { force: true }); fs.rmSync(transforms, { force: true });
    print("speaker look: stabilisation unavailable; using original picture");
    return { file, in: range.in, key, stabilized: false };
  }
}

export async function lookReviewFrames(file, { at = 0, beforeFilter = "", afterFilter = "", dir, name, execute = run, print = console.warn } = {}) {
  ensureDir(dir);
  try {
    for (const [suffix, filter] of [["before", beforeFilter], ["after", [beforeFilter, afterFilter].filter(Boolean).join(",")]]) {
      const output = path.join(dir, `${name}-${suffix}.jpg`);
      await execute("ffmpeg", ["-y", "-loglevel", "error", "-noautorotate", "-ss", String(at), "-i", file, "-vf", [filter, "scale=960:540:force_original_aspect_ratio=decrease", "setsar=1"].filter(Boolean).join(","), "-frames:v", "1", output], { capture: true });
      if (!fs.existsSync(output) || !fs.statSync(output).size) throw new Error("no review frame");
    }
    return true;
  } catch { print("speaker look: review frames unavailable"); return false; }
}

/** The shared card renderer currently accepts 1080 only. Reflow its boxes into the active picture,
 * keeping font sizes and aspect ratios. No shared renderer or daily-reel golden frame changes. */
export function letterboxCards(fragment, box, plan) {
  if (box.height === 1080) return fragment;
  const ids = [...plan.items.filter((item) => item.kind === "card"), ...(plan.overlays || [])].map((entry) => entry.id);
  const css = [], review = fragment.review.map((row) => {
    const i = ids.indexOf(row.id);
    if (i < 0) throw new Error(`speaker card ${row.id}: missing from letterbox plan`);
    const l = row.layout, overlay = row.mode === "overlay", identity = ["title", "booking"].includes(row.type) && !overlay;
    const inset = l.inset || l.x;
    const h = identity || overlay ? l.h : box.height - inset * 2;
    const y = identity ? (box.height - h) / 2 : row.type === "testimonial-name" ? box.height * 0.95 - h : overlay ? box.height * 0.05 : inset;
    if (y < 0 || y + h > box.height || identity && h > box.height - inset * 2) throw new Error(`speaker card ${row.id}: cannot fit inside letterbox active area`);
    const selector = `#speaker-card-${i}`;
    css.push(`${selector}${overlay ? "" : " > .sc-copy"}{top:${y}px!important;height:${h}px!important}`);
    if (l.photo) css.push(`${selector} > .sc-headshot{top:${box.height * 0.1}px!important;height:${box.height * 0.8}px!important}`);
    if (row.type === "logo-wall") css.push(`${selector} > .sc-heading{top:${inset}px!important}${selector} > .sc-logo{top:${box.height * 0.4}px!important;max-height:${box.height * 0.24}px}`);
    return { ...row, activeBox: box, layout: { ...l, y: y + box.y, h } };
  });
  return { ...fragment, css: `${fragment.css}\n.speaker-cards{inset:${box.y}px 0 ${box.y}px!important;overflow:hidden}\n${css.join("\n")}`, review };
}
