import fs from "node:fs";
import path from "node:path";
import { log, run, warn } from "./util.mjs";

const ffmpegOptions = { capture: true };
const ffmpegArgs = ["-hide_banner", "-v", "error", "-nostdin", "-y", "-filter_threads", "1"];
const cover = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=bicubic`;
const normalize = "out_color_matrix=bt709:out_range=tv,format=yuv444p";
const rgb = "scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24";
const stats = "signalstats,metadata=mode=print:file=-";
const channels = ["Y", "U", "V"];
const time = (seconds) => seconds.toFixed(6);

function meanSignal(output) {
  return Object.fromEntries(channels.map((c) => {
    const values = [...output.matchAll(new RegExp(`^lavfi\\.signalstats\\.${c}AVG=(\\d+(?:\\.\\d+)?)$`, "gm"))].map((m) => Number(m[1]));
    if (!values.length) throw new Error(`ffmpeg returned no ${c}AVG samples`);
    return [c, values.reduce((sum, x) => sum + x, 0) / values.length];
  }));
}

export async function extractBrollReference(footage, start, file, { runFn = run } = {}) {
  await runFn("ffmpeg", [...ffmpegArgs, "-ss", time(Math.max(0, start - 0.120)), "-i", footage,
    "-vf", `${cover(540, 960)}:out_color_matrix=bt709:out_range=tv,format=yuv444p,crop=540:960,setsar=1,${rgb}`,
    "-frames:v", "1", "-update", "1", file], ffmpegOptions);
  if (!fs.existsSync(file)) throw new Error("ffmpeg returned no reference frame");
  return file;
}

export function brollMatchShifts(still, speaker) {
  // Both inputs are normalized to 8-bit limited-range BT.709. Round the cap inward to a whole code.
  const lumaCap = Math.floor((235 - 16) * 0.08);
  const shift = (channel, strength, cap) => Math.max(-cap, Math.min(cap, Math.round((speaker[channel] - still[channel]) * strength)));
  return { Y: shift("Y", 0.40, lumaCap), U: shift("U", 0.65, 3), V: shift("V", 0.65, 3) };
}

/** Match against the speaker on both sides of the insert and keep the generated PNG. */
export async function finishBrollStill({ file, footage, start, duration }, { runFn = run, logFn = log, warnFn = warn } = {}) {
  const finished = path.join(path.dirname(file), `${path.parse(file).name}-finished.png`);
  const ffmpeg = (...args) => runFn("ffmpeg", [...ffmpegArgs, ...args], ffmpegOptions);
  let scratch;
  try {
    scratch = fs.mkdtempSync(path.join(path.dirname(file), ".finish-"));
    const conformed = path.join(scratch, "conformed.mkv");
    const output = path.join(scratch, "finished.png");
    const before = await ffmpeg("-i", file, "-vf",
      `${cover(1080, 1920)}:${normalize},crop=1080:1920,setsar=1,${stats}`,
      "-frames:v", "1", "-c:v", "ffv1", "-threads", "1", "-colorspace", "bt709", "-color_range", "tv", conformed);
    const still = meanSignal(before.out);
    const sample = (at) => ffmpeg("-ss", time(at), "-t", "0.24", "-i", footage,
      "-vf", `${cover(540, 960)}:${normalize},crop=540:960,${stats}`, "-an", "-f", "null", "-");
    const lead = await sample(Math.max(0, start - 0.360));
    const tail = await sample(start + duration + 0.120);
    const speaker = meanSignal(`${lead.out}\n${tail.out}`);
    const { Y, U, V } = brollMatchShifts(still, speaker);
    await ffmpeg("-i", conformed, "-vf", [
      `lutyuv=y='clip(val+(${Y}),16,235)':u='clip(val+(${U}),16,240)':v='clip(val+(${V}),16,240)'`,
      "eq=contrast=0.98:saturation=0.92:gamma=1.01",
      "gblur=sigma=0.55",
      "noise=c0s=3:c0f=t+u:c0_seed=217",
      rgb,
    ].join(","), "-frames:v", "1", "-update", "1", output);
    const after = meanSignal((await ffmpeg("-i", output, "-vf", `scale=${normalize},${stats}`, "-frames:v", "1", "-f", "null", "-")).out);
    fs.renameSync(output, finished);
    const means = (values) => channels.map((c) => `${c}=${values[c].toFixed(2)}`).join(" ");
    logFn(`b-roll: ${path.basename(finished)} at ${start}s, before ${means(still)}, speaker ${means(speaker)}, after ${means(after)}`);
    return finished;
  } catch (e) {
    warnFn(`b-roll: finish failed for ${path.basename(file)}; using original: ${String(e.message).split("\n")[0]}`);
    return file;
  } finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}
