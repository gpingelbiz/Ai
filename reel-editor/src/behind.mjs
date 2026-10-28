import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, PKG_ROOT, r3 } from "./util.mjs";

/**
 * Text behind you: Apple Vision cuts the person out of the hook window frame by frame (scripts/matte.swift), and the
 * cutout becomes a VP9 clip with alpha that the composer layers over the hook text. The viewer sees the headline run
 * behind the head and shoulders while the face stays clear.
 */

const SWIFT_SRC = path.join(PKG_ROOT, "scripts", "matte.swift");

async function matteBinary() {
  if (process.platform !== "darwin" || !fs.existsSync(SWIFT_SRC)) return null;
  const dir = process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor");
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, `matte-${Math.round(fs.statSync(SWIFT_SRC).mtimeMs)}`);
  if (!fs.existsSync(bin)) {
    try {
      await run("swiftc", ["-O", SWIFT_SRC, "-o", bin], { capture: true });
    } catch {
      return null;
    }
  }
  return bin;
}

/**
 * Build <outDir>/cutout.webm for [start, start+duration] of `video`. Returns {src, start, duration, coverage, frames}
 * or {error} (no person found, the mask covers everything, Swift unavailable, ffmpeg failed).
 */
export async function makeCutout({ video, start = 0, duration = 3, fps = 30, outDir, quality = "accurate", minCoverage = 0.04, maxCoverage = 0.8, name = "cutout", grid = null }) {
  const bin = await matteBinary();
  if (!bin) return { error: "person cutout needs Swift (xcode-select --install)" };
  const stem = String(name).replace(/[^a-z0-9-]+/gi, "-");
  const maskDir = path.join(outDir, stem === "cutout" ? "matte" : `${stem}-matte`);
  fs.rmSync(maskDir, { recursive: true, force: true });
  fs.mkdirSync(maskDir, { recursive: true });
  let info;
  try {
    const args = [video, String(r3(start)), String(r3(start + duration)), maskDir, "--quality", quality];
    if (grid) args.push("--grid", `${grid.cols || 27}x${grid.rows || 48}`);
    const { out } = await run(bin, args, { capture: true });
    info = JSON.parse(out);
  } catch (e) {
    fs.rmSync(maskDir, { recursive: true, force: true });
    return { error: `person matte failed: ${String(e.message).split("\n")[0]}` };
  }
  const pct = Math.round((info.coverage || 0) * 100);
  if (!info.frames) { fs.rmSync(maskDir, { recursive: true, force: true }); return { error: "person matte: no frames" }; }
  if (info.coverage < minCoverage) { fs.rmSync(maskDir, { recursive: true, force: true }); return { error: `no person in the ${stem === "cutout" ? "hook frames" : "matte window"} (mask covers ${pct}%)` }; }
  if (info.coverage > maxCoverage) { fs.rmSync(maskDir, { recursive: true, force: true }); return { error: `the person mask covers ${pct}% of the frame, too close to use` }; }
  if (grid) {
    try { info.grid = JSON.parse(fs.readFileSync(path.join(maskDir, "occupancy.json"), "utf8")); } catch { info.grid = null; }
  }
  const webm = path.join(outDir, `${stem}.webm`);
  try {
    // The mask (slightly softened) becomes the alpha of the same frames; VP9 keeps the alpha for the renderer's browser.
    await run("ffmpeg", [
      "-y", "-loglevel", "error",
      "-ss", String(r3(start)), "-t", String(r3(duration)), "-i", video,
      "-framerate", String(fps), "-i", path.join(maskDir, "%05d.png"),
      "-filter_complex", "[1:v]format=gray,boxblur=1:1[m];[0:v][m]alphamerge,format=yuva420p[o]",
      "-map", "[o]", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "22", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1",
      "-an", "-shortest", webm,
    ], { quiet: true });
  } catch (e) {
    return { error: `cutout encode failed: ${String(e.message).split("\n")[0]}` };
  } finally {
    fs.rmSync(maskDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(webm) || !fs.statSync(webm).size) return { error: "cutout encode wrote nothing" };
  return { src: webm, start: r3(start), duration: r3(Math.min(duration, info.frames / (info.fps || fps))), coverage: r3(info.coverage), frames: info.frames, ...(info.grid ? { grid: info.grid } : {}) };
}

export function describeCutout(res) {
  if (!res || res.error) return `hook behind you: off (${res?.error || "unknown"})`;
  return `hook behind you: cutout over ${res.frames} frames, you cover ${Math.round(res.coverage * 100)}% of the frame`;
}
