import { run } from "./util.mjs";

/**
 * HDR handling. iPhones record HLG (Dolby Vision 8.4), some Android phones and cameras record PQ (HDR10).
 * HyperFrames composites HDR footage on a native layer drawn over the page, which hides every caption, so the
 * cut pass always hands it BT.709 SDR footage.
 *
 * - HLG and plain BT.2020: ffmpeg's colorspace filter (portable; HLG is SDR-compatible, so the result matches
 *   what the phone shows).
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

/** Filter that converts BT.2020 / HLG frames to BT.709 SDR (8-bit). */
export const SDR_FILTER = "colorspace=iall=bt2020:all=bt709:format=yuv420p";

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
