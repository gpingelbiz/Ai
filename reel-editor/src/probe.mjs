import { run } from "./util.mjs";
import { hdrKind, rotationCw } from "./hdr.mjs";

/** ffprobe → { duration, width, height, fps, hasAudio, rotation, rotationCw, hdr, hdrKind } with rotation applied to
 *  width/height. hdrKind is "hlg" | "pq" | "bt2020" | null; see hdr.mjs for why HDR sources are converted to SDR. */
export async function probe(file) {
  const { out } = await run(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries",
      "stream=index,codec_type,codec_name,width,height,r_frame_rate,pix_fmt,color_transfer,color_primaries,color_space:stream_tags=rotate:stream_side_data=rotation:format=duration",
      "-of", "json",
      file,
    ],
    { capture: true },
  );
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  const a = (j.streams || []).find((s) => s.codec_type === "audio");
  if (!v) throw new Error(`no video stream in ${file}`);
  let rotation = 0;
  if (v.tags?.rotate) rotation = parseInt(v.tags.rotate, 10) || 0;
  const sd = (v.side_data_list || []).find((s) => s.rotation != null);
  if (sd) rotation = Number(sd.rotation) || 0;
  let width = v.width;
  let height = v.height;
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const [n, d] = String(v.r_frame_rate || "30/1").split("/").map(Number);
  const fps = d ? n / d : n;
  return {
    duration: parseFloat(j.format?.duration || "0"),
    width,
    height,
    fps: Math.round(fps * 1000) / 1000,
    codec: v.codec_name,
    hasAudio: !!a,
    rotation,
    pixFmt: v.pix_fmt || "",
    colorTransfer: v.color_transfer || "",
    colorPrimaries: v.color_primaries || "",
    rotationCw: rotationCw(v),
    hdrKind: hdrKind(v),
    hdr: hdrKind(v) !== null,
  };
}
