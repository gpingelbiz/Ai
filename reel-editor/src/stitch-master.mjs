import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { rotateFilters, SDR_FILTER, SDR_TAGS, toneMapToSdr, hasZscale, hlgToSdrFilter } from "./hdr.mjs";
import { measureStitchLoudness } from "./stitch-index.mjs";
import { probeSource } from "./speaker-index.mjs";
import { run, readJSON, writeJSON } from "./util.mjs";

export function stitchAudioFilter(measured, frames) {
  const d = frames / 30;
  const level = measured && Number.isFinite(Number(measured.input_i))
    ? `loudnorm=I=-16:TP=-2:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,` : "";
  return `${level}aresample=48000:async=1:first_pts=0,aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo,apad,atrim=end_sample=${frames * 1600},afade=t=in:d=0.015:curve=qsin,afade=t=out:st=${Math.max(0, d - 0.015)}:d=0.015:curve=qsin`;
}

export function stitchVideoFilter(meta, frames, hdrFilter = null) {
  return [...rotateFilters(meta.rotationCw || 0), hdrFilter, "fps=30:start_time=0:round=near", "scale=1080:1920:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos", "crop=1080:1920", "setsar=1", "tpad=stop_mode=clone:stop_duration=0.1", `trim=end_frame=${frames}`, "settb=expr=1/30", "setpts=N", "format=yuv420p", "setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709"].filter(Boolean).join(",");
}

/** Each leg is encoded once at CRF 12 with PCM sound. The master concatenates those bytes without another encode. */
export async function compileStitch(timeline, index, dir, { execute = run, loudness = measureStitchLoudness, probe = probeSource, toneMap = toneMapToSdr, zscale = hasZscale } = {}) {
  const master = path.join(dir, "master.mov"), stamp = path.join(dir, "master.json");
  const signature = createHash("sha256").update(JSON.stringify(timeline.segments.map((s) => [s.key, s.in, s.frames]))).digest("hex");
  if (fs.existsSync(master) && fs.existsSync(stamp) && readJSON(stamp).signature === signature) return master;
  const legs = [], levels = [];
  for (const segment of timeline.segments) {
    const meta = index.find((c) => c.key === segment.key), cache = path.join(dir, "cache", segment.key);
    const identity = createHash("sha256").update(JSON.stringify({ version: 1, in: segment.in, frames: segment.frames })).digest("hex").slice(0, 20);
    const output = path.join(cache, `${identity}.mov`), levelFile = path.join(cache, `${identity}.level.json`);
    if (!fs.existsSync(output) || !fs.existsSync(levelFile)) {
      let input = segment.clip, normalized = meta, hdrFilter = meta.hdr ? SDR_FILTER : null;
      if (meta.hdrKind === "pq") {
        const sdr = path.join(cache, "sdr.mov");
        if (!fs.existsSync(sdr) && !await toneMap(input, sdr, meta)) throw new Error(`${meta.name}: HDR conversion could not be verified.`);
        input = sdr; normalized = { ...meta, rotationCw: 0 }; hdrFilter = null;
      } else if (meta.hdrKind === "hlg" && await zscale()) hdrFilter = hlgToSdrFilter();
      const measured = meta.hasAudio ? await loudness(input, { start: segment.in, duration: segment.frames / 30, execute }) : null;
      const tmp = output.replace(/\.mov$/, ".tmp.mov");
      try {
        await execute("ffmpeg", ["-y", "-v", "error", "-noautorotate", "-ss", String(segment.in), "-i", input,
          ...(!meta.hasAudio ? ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"] : []),
          "-filter_complex", `[0:v]${stitchVideoFilter(normalized, segment.frames, hdrFilter)}[v];[${meta.hasAudio ? "0:a:0" : "1:a:0"}]asetpts=PTS-STARTPTS,${stitchAudioFilter(measured, segment.frames)}[a]`,
          "-map", "[v]", "-map", "[a]", "-r", "30", "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "fast", "-crf", "12", "-pix_fmt", "yuv420p", ...SDR_TAGS, "-metadata:s:v:0", "rotate=0", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", tmp], { capture: true });
        const actual = await probe(tmp);
        if (Math.abs(actual.duration - segment.frames / 30) > 1 / 30 + 1e-6 || actual.width !== 1080 || actual.height !== 1920 || Math.abs(actual.fps - 30) > 0.001 || actual.rotationCw || actual.hdr) throw new Error(`${meta.name}: The normalized clip did not match the frame clock.`);
        const level = meta.hasAudio && segment.words.length ? await loudness(tmp, { execute }) : null;
        // Loud peaks can keep linear leveling short of the target. The plan's limit for an unheard join is 3 dB,
        // and the edit levels the whole reel again, so a near miss is recorded instead of failing the reel.
        if (level && Math.abs(Number(level.input_i) + 16) > 3) throw new Error(`${meta.name}: The speech level could not be matched within three decibels.`);
        fs.renameSync(tmp, output); writeJSON(levelFile, { measured, output: level });
      } finally { fs.rmSync(tmp, { force: true }); }
    }
    legs.push(output); levels.push({ clip: segment.clip, in: segment.in, ...readJSON(levelFile) });
  }
  const list = path.join(dir, "concat.txt");
  fs.writeFileSync(list, legs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const tmp = path.join(dir, "master.tmp.mov");
  try {
    await execute("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-map_metadata", "-1", ...SDR_TAGS, "-movflags", "+faststart", tmp], { capture: true });
    const meta = await probe(tmp);
    if (Math.abs(meta.duration - timeline.duration) > 1 / 30 + 1e-6) throw new Error("The stitched master did not match the frame clock.");
    fs.renameSync(tmp, master);
  } finally { fs.rmSync(tmp, { force: true }); }
  writeJSON(path.join(dir, "loudness.json"), levels);
  writeJSON(stamp, { schemaVersion: 1, signature, frames: timeline.frames });
  return master;
}
