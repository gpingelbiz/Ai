import { run } from "./util.mjs";

/** ffprobe → { duration, width, height, fps, hasAudio, rotation } with rotation applied to width/height. */
export async function probe(file) {
  const { out } = await run(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries",
      "stream=index,codec_type,codec_name,width,height,r_frame_rate:stream_tags=rotate:stream_side_data=rotation:format=duration",
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
  };
}
