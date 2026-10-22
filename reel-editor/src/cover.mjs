import fs from "node:fs";
import path from "node:path";
import { esc } from "./text.mjs";
import { hyperframesBin, renderEnv } from "./render.mjs";
import { log, run, ensureDir, PKG_ROOT } from "./util.mjs";

/**
 * Cover image for the reel: a frame of the footage from the hook window, a soft dark base and the hook as a
 * headline at chest height, all inside Instagram's 3:4 grid crop (y 12.5-87.5%) and the 4:5 feed crop, under 30%
 * text. 1080x1920 PNG, written to <workDir>/cover.png. Instagram otherwise uses frame 0, where the hook sits near
 * the top and the grid crops it.
 */
export function coverHTML({ W = 1080, H = 1920, frame, hook, colors, handle = "" }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", ...colors };
  const words = hook.words || String(hook.text || "").split(/\s+/).map((t) => ({ text: t }));
  const len = words.map((w) => w.text).join(" ").length;
  const size = len <= 18 ? 150 : len <= 30 ? 128 : len <= 44 ? 110 : 96;
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${W}, height=${H}" /><title>cover</title>
<script src="assets/vendor/gsap.min.js"></script>
<style>
  @font-face { font-family: "Anton"; src: url("assets/fonts/Anton-Regular.ttf") format("truetype"); font-display: block; }
  @font-face { font-family: "Inter"; src: url("assets/fonts/Inter.ttf") format("truetype"); font-weight: 100 900; font-display: block; }
  html, body { margin: 0; background: ${c.bg}; }
  #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${c.bg}; }
  #frame { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  #shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 48%, rgba(0,0,0,0.55) 72%, rgba(0,0,0,0.82) 100%); }
  #title { position: absolute; left: 6%; right: 6%; top: 69%; text-align: center; font-family: "Anton", sans-serif; font-size: ${size}px; line-height: 1.0; letter-spacing: 0.005em; text-transform: uppercase; color: ${c.text}; text-wrap: balance; text-shadow: 0 0.04em 0 rgba(0,0,0,0.6), 0 0.1em 0.5em rgba(0,0,0,0.6); }
  #title .k { color: ${c.accent}; }
  #rule { position: absolute; left: 50%; top: 66.5%; width: 140px; height: 12px; margin-left: -70px; border-radius: 6px; background: ${c.accent}; box-shadow: 0 0.1em 0.4em rgba(0,0,0,0.5); }
  #handle { position: absolute; left: 0; right: 0; top: 84.5%; text-align: center; font-family: "Inter", sans-serif; font-size: 30px; font-weight: 600; letter-spacing: 0.04em; color: ${c.text}; opacity: 0.75; }
</style></head>
<body><div id="root" data-composition-id="cover" data-start="0" data-width="${W}" data-height="${H}" data-duration="1" data-fps="30">
  <img id="frame" src="${esc(frame)}" alt="" />
  <div id="shade"></div>
  <div id="rule"></div>
  <h1 id="title" class="clip" data-start="0" data-duration="1">${words.map((w) => `<span${w.key ? ' class="k"' : ""}>${esc(w.text)}</span>`).join(" ")}</h1>
  ${handle ? `<div id="handle">${esc(handle)}</div>` : ""}
</div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["cover"] = gsap.timeline({ paused: true });</script>
</body></html>
`;
}

/** The moment to freeze: a little into the hook window, when the speaker is settled and looking up. */
export function coverTime(plan) {
  const h = plan.hook;
  const t = h ? h.start + Math.min(0.8, h.duration / 3) : 0.5;
  return Math.max(0.05, Math.min(t, (plan.video?.duration || 1) - 0.1));
}

export async function makeCover(workDir, plan, { handle = "" } = {}) {
  workDir = path.resolve(workDir);
  if (!plan.hook) return null;
  const dir = ensureDir(path.join(workDir, "cover"));
  ensureDir(path.join(dir, "assets", "fonts"));
  ensureDir(path.join(dir, "assets", "vendor"));
  for (const f of ["Anton-Regular.ttf", "Inter.ttf"]) fs.copyFileSync(path.join(PKG_ROOT, "assets", "fonts", f), path.join(dir, "assets", "fonts", f));
  fs.copyFileSync(path.join(PKG_ROOT, "assets", "vendor", "gsap.min.js"), path.join(dir, "assets", "vendor", "gsap.min.js"));
  const t = coverTime(plan);
  const framePng = path.join(dir, "assets", "frame.png");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(t), "-i", plan.video.src, "-frames:v", "1", "-vf", `scale=${plan.canvas.width}:${plan.canvas.height}:force_original_aspect_ratio=increase,crop=${plan.canvas.width}:${plan.canvas.height}`, framePng]);
  fs.writeFileSync(path.join(dir, "index.html"), coverHTML({ W: plan.canvas.width, H: plan.canvas.height, frame: "assets/frame.png", hook: plan.hook, colors: plan.style?.colors, handle }));
  const shots = ensureDir(path.join(dir, "shots"));
  for (const f of fs.readdirSync(shots)) fs.rmSync(path.join(shots, f), { force: true });
  const bin = hyperframesBin();
  await run(bin[0], [...bin.slice(1), "snapshot", dir, "--at", "0.5", "--no-end", "--keep", "-o", shots, "--describe", "false"], { capture: true, env: renderEnv() });
  const src = path.join(shots, "at-0.5s.png");
  if (!fs.existsSync(src)) throw new Error("the cover snapshot was not written");
  const out = path.join(workDir, "cover.png");
  fs.copyFileSync(src, out);
  log(`cover: ${out} (frame at ${t.toFixed(1)}s)`);
  return out;
}
