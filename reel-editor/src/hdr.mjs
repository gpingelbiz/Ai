import { run } from "./util.mjs";

/**
 * HDR handling. iPhones record HLG (Dolby Vision 8.4), some Android phones and cameras record PQ (HDR10).
 * HyperFrames composites HDR footage on a native layer drawn over the page, which hides every caption, so the
 * cut pass always hands it BT.709 SDR footage.
 *
 * - The daily cut pass retains its legacy BT.2020 conversion. Speaker reels can opt into an HLG-aware
 *   review transform; its exposure compensation must be reviewed before replacing accepted trims.
 * - PQ: colorspace cannot tone-map PQ (it comes out flat and dark), so on macOS a VideoToolbox pre-pass
 *   tone-maps it first. Elsewhere, or if that pass fails, the colorspace filter is used with a warning.
 */

/** "hlg" | "pq" | "bt2020" | null for an ffprobe video stream. */
export function hdrKind(stream = {}) {
  const trc = stream.color_transfer || "";
  if (trc === "arib-std-b67") return "hlg";
  if (trc === "smpte2084") return "pq";
  if (stream.color_primaries === "bt2020" || /^bt2020/.test(stream.color_space || "")) return "bt2020";
  return null;
}

/** Clockwise display rotation (0, 90, 180, 270) from an ffprobe video stream. */
export function rotationCw(stream = {}) {
  let cw = 0;
  if (stream.tags?.rotate) cw = parseInt(stream.tags.rotate, 10) || 0; // legacy tag is already clockwise
  const sd = (stream.side_data_list || []).find((s) => s.rotation != null);
  if (sd) cw = -Number(sd.rotation) || 0; // display matrix rotation is counter-clockwise
  return ((Math.round(cw / 90) * 90) % 360 + 360) % 360;
}

/** Software filters that apply a clockwise display rotation by hand (for decoders that skip autorotate). */
export function rotateFilters(cw) {
  if (cw === 90) return ["transpose=clock"];
  if (cw === 180) return ["hflip", "vflip"];
  if (cw === 270) return ["transpose=cclock"];
  return [];
}

/** yuv420p conversions need even dimensions; trim the last odd row/column of a source such as a 10000x6667 photo. Even sources get no filter, so their cache keys are unchanged. */
export function evenFilters(width, height) {
  return (Number(width) % 2 || Number(height) % 2) ? ["crop=trunc(iw/2)*2:trunc(ih/2)*2"] : [];
}

/** Legacy BT.2020 conversion, retained for existing plans and the daily pipeline. */
export const SDR_FILTER = "colorspace=iall=bt2020:all=bt709:format=yuv420p";

let zscaleProbe = null;
/** The HLG review transform needs ffmpeg's zscale (libzimg); Homebrew's ffmpeg 8.1 on the Mini lacks it. Probed once. */
export function hasZscale(execute = run) {
  if (execute !== run) return execute("ffmpeg", ["-hide_banner", "-filters"], { capture: true, allowFail: true }).then((r) => /\bzscale\b/.test(String(r?.out ?? r ?? ""))).catch(() => false);
  zscaleProbe ||= run("ffmpeg", ["-hide_banner", "-filters"], { capture: true, allowFail: true }).then((r) => /\bzscale\b/.test(String(r?.out ?? r ?? ""))).catch(() => false);
  return zscaleProbe;
}

/** HLG/BT.2020 review transform. -1.5 EV is a fixed review starting point, not camera calibration. */
export function hlgToSdrFilter() {
  return [
    "zscale=pin=2020:tin=arib-std-b67:min=2020_ncl:rin=limited:t=linear:npl=100",
    "format=gbrpf32le", "zscale=p=709", "exposure=exposure=-1.5",
    "tonemap=mobius:param=0.3:desat=2:peak=10",
    "zscale=t=709:m=709:r=limited:dither=error_diffusion", "format=yuv420p",
  ].join(",");
}

/** Output tags for BT.709 SDR video. */
export const SDR_TAGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"];

/** ffmpeg args for the VideoToolbox PQ → BT.709 tone-map pre-pass (rotation applied, audio copied). */
export function toneMapArgs(input, output, { rotation = 0, hasAudio = true } = {}) {
  const vf = [
    "scale_vt=color_matrix=bt709:color_primaries=bt709:color_transfer=bt709",
    "hwdownload",
    "format=p010le",
    "format=yuv420p",
    ...rotateFilters(rotation),
  ].join(",");
  return [
    "-y", "-loglevel", "error",
    "-noautorotate", // hardware frames skip autorotate silently, so rotate in software after download
    "-hwaccel", "videotoolbox", "-hwaccel_output_format", "videotoolbox_vld",
    "-i", input,
    "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-vf", vf,
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", ...SDR_TAGS,
    ...(hasAudio ? ["-c:a", "copy"] : []),
    output,
  ];
}

/** Tone-map a PQ source to BT.709 SDR with VideoToolbox. Returns true on success, false when unavailable. */
export async function toneMapToSdr(input, output, meta, platform = process.platform) {
  if (platform !== "darwin") return false;
  try {
    await run("ffmpeg", toneMapArgs(input, output, { rotation: meta.rotationCw || 0, hasAudio: meta.hasAudio }), { capture: true });
    return true;
  } catch {
    return false;
  }
}
