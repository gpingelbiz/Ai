import fs from "node:fs";
import path from "node:path";
import { keptRanges, placeGroups } from "./stitch-plan.mjs";
import { run, ensureDir, writeJSON, PKG_ROOT } from "./util.mjs";
import { swiftTool } from "./photos.mjs";

const FRAME = "scale=360:540:force_original_aspect_ratio=decrease,pad=360:540:(ow-iw)/2:(oh-ih)/2:color=0x161616";

/** Homebrew's ffmpeg 9 (on the Mini since Nov 23 2026) is built without the drawtext filter. */
export async function hasDrawtext(execute = run) {
  const r = await Promise.resolve().then(() => execute("ffmpeg", ["-hide_banner", "-filters"], { capture: true, allowFail: true })).catch(() => null);
  return /\bdrawtext\b/.test(String(r?.out ?? r ?? ""));
}

/** The tile's words as a 360x180 picture from the photo helper (Apple text drawing), or null when it can't run. */
async function wordsPicture(number, scratch, { execute, swift }) {
  const bin = await swift("photosheet");
  if (!bin) return null;
  const out = path.join(scratch, `words-${number}.png`);
  await execute(bin, ["label", out, "360", "180", path.join(scratch, `tile-${number}.txt`), path.join(scratch, "font.ttf")], { capture: true });
  return fs.existsSync(out) ? out : null;
}

/** One 360x720 tile: the clip's middle frame with its words under it. With no way to draw words it is still the frame, never a failed stitch. */
async function writeTile(row, scratch, { execute, drawtext, swift }) {
  const input = ["-y", "-v", "error", "-ss", String(row.at), "-i", row.clip], output = ["-frames:v", "1", `tile-${row.number}.png`], opts = { cwd: scratch, capture: true };
  if (drawtext) return execute("ffmpeg", [...input, "-vf", `${FRAME},pad=360:720:0:0:color=0x161616,drawtext=fontfile=font.ttf:textfile=tile-${row.number}.txt:expansion=none:fontsize=22:fontcolor=white:x=14:y=556:line_spacing=8`, ...output], opts);
  const words = await wordsPicture(row.number, scratch, { execute, swift }).catch(() => null);
  if (!words) return execute("ffmpeg", [...input, "-vf", `${FRAME},pad=360:720:0:0:color=0x161616`, ...output], opts);
  return execute("ffmpeg", [...input, "-i", words, "-filter_complex", `[0:v]${FRAME}[f];[1:v]scale=360:180,format=rgb24[w];[f]format=rgb24[g];[g][w]vstack=inputs=2`, ...output], opts);
}

export function previewRows(index, timeline) {
  return placeGroups(index).map((clip, i) => {
    const kept = timeline.segments.filter((s) => s.clip === clip.file), ranges = kept.length ? kept : keptRanges(clip).ranges;
    let remaining = ranges.reduce((n, r) => n + r.out - r.in, 0) / 2;
    let at = ranges.at(-1).out;
    for (const range of ranges) {
      if (remaining <= range.out - range.in) { at = range.in + remaining; break; }
      remaining -= range.out - range.in;
    }
    return { number: i + 1, clip: clip.file, name: clip.name, place: clip.place, duration: kept.reduce((n, s) => n + s.frames / 30, 0), words: kept.flatMap((s) => s.words).slice(0, 12).map((w) => w.text).join(" "), at, omitted: !kept.length };
  });
}

export function orderText(rows, notes = []) {
  return rows.map((r) => `${r.number}. ${r.name}\nPlace ${r.place}   ${r.duration.toFixed(2)} seconds kept\n${r.omitted ? "Repeated take left out" : r.words || "No speech"}\n`).join("\n")
    + "\nWrong order? Rename the clips 1, 2, 3 and it redoes the reel.\n" + (notes.length ? "\n" + notes.join("\n") + "\n" : "");
}

export async function writeStitchPreview(index, timeline, folder, dir, { execute = run, swift = swiftTool } = {}) {
  const rows = previewRows(index, timeline), scratch = ensureDir(path.join(dir, "preview")), drawtext = await hasDrawtext(execute);
  fs.writeFileSync(path.join(folder, "Order.txt"), orderText(rows, timeline.notes));
  writeJSON(path.join(dir, "preview.json"), rows);
  fs.copyFileSync(path.join(PKG_ROOT, "assets/fonts/Inter.ttf"), path.join(scratch, "font.ttf"));
  for (const row of rows) {
    const firstWords = row.words.match(/.{1,30}(?:\s|$)/g)?.map((s) => s.trim()).slice(0, 3).join("\n") || "No speech";
    fs.writeFileSync(path.join(scratch, `tile-${row.number}.txt`), `${row.number}. Place ${row.place}\n${row.duration.toFixed(2)} seconds kept\n${row.omitted ? "Repeated take left out" : firstWords}`);
    await writeTile(row, scratch, { execute, drawtext, swift });
  }
  const columns = Math.min(3, rows.length), height = Math.ceil(rows.length / columns) * 720;
  const inputs = rows.flatMap((r) => ["-i", `tile-${r.number}.png`]);
  const layout = rows.map((_, i) => `${i % columns * 360}_${Math.floor(i / columns) * 720}`).join("|");
  await execute("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", rows.length === 1 ? "[0:v]null[v]" : `${rows.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${rows.length}:layout=${layout}:fill=0x161616,pad=${columns * 360}:${height}:0:0:color=0x161616[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "2", path.join(folder, "Order - check this.jpg")], { cwd: scratch, capture: true });
  return rows;
}
