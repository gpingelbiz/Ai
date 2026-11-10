import fs from "node:fs";
import { makeCutout } from "./behind.mjs";
import { headExtent } from "./placement.mjs";

/** A large title touches only the bottom edge of its last line to the highest measured head position. */
export function depthHookSpot(hook, detection, { W = 1080, H = 1920 } = {}) {
  const frames = (detection?.frames || []).filter((f) => f.t >= hook.start - 0.13 && f.t <= hook.start + hook.duration + 0.13 && f.faces?.length);
  if (!frames.length) return null;
  const tops = frames.map((f) => headExtent({ frames: [f] })?.top).filter(Number.isFinite);
  if (!tops.length) return null;
  const words = hook.words || String(hook.text || "").split(/\s+/).filter(Boolean).map((text) => ({ text }));
  if (!words.length) return null;
  const w = Math.floor(0.86 * W) - Math.round(0.07 * W);
  const top = Math.min(...tops) * H;
  const candidates = [];
  // One to three lines: a long title (36+ characters) only reaches a large size on three.
  const splits = [[]];
  for (let a = 1; a < words.length; a++) { splits.push([a]); for (let b = a + 1; b < words.length; b++) splits.push([a, b]); }
  for (const breaks of splits) {
    const cuts = [0, ...breaks, words.length];
    const lines = cuts.slice(1).map((end, k) => words.slice(cuts[k], end));
    // Anton caps are condensed; leave width for tracking and wide letters, including a short word or digit.
    const chars = Math.max(...lines.map((line) => line.map((word) => word.text).join(" ").length));
    const size = Math.floor(Math.min(0.075 * H, w / Math.max(1, chars * 0.6)));
    if (size < 0.045 * H) continue;
    // A moving head must still touch the letters without swallowing a word, even a one-character number.
    if ((Math.max(...tops) - Math.min(...tops)) * H > size * 0.12) continue;
    const bottom = Math.round(top + size * 0.18);
    const y = Math.round(bottom - lines.length * size);
    if (y < 0.07 * H || bottom > 0.5 * H) continue;
    candidates.push({ x: Math.round(0.07 * W), y, w, size, depth: true, bottom, br: breaks[0] || 0, breaks });
  }
  return candidates.sort((a, b) => b.size - a.size || a.breaks.length - b.breaks.length || a.br - b.br)[0] || null;
}

/** Reuse an exact-window matte; a newly generated matte always uses clean footage, never the rendered graphics. */
export async function prepareDepthHook(plan, detection, { outDir, cutout = makeCutout } = {}) {
  if (plan.style?.glow?.depthHook !== true || !plan.hook) return null;
  const place = depthHookSpot(plan.hook, detection, { W: plan.canvas.width, H: plan.canvas.height });
  if (!place) return null;
  const hook = plan.hook, old = plan.behind;
  // The matte can come back a frame or two short of the window (its duration is frames / fps); that still covers it.
  const matches = (b) => b && !b.error && Math.abs(b.start - hook.start) < 0.001 && b.duration >= hook.duration - 0.07;
  if (matches(old) && old.file && fs.existsSync(old.file)) return { place, behind: { ...old, under: false } };
  if (!outDir || !plan.video?.src || !fs.existsSync(plan.video.src)) return null;
  try {
    const made = await cutout({ video: plan.video.src, start: hook.start, duration: hook.duration, fps: plan.style.render?.fps || 30, outDir, name: "glow-hook" });
    if (!matches(made) || !made.src || !fs.existsSync(made.src)) return null;
    return { place, behind: { file: made.src, start: made.start, duration: made.duration, coverage: made.coverage } };
  } catch {
    return null;
  }
}

export const GLOW_DEPTH_JS = `        if (PLAN.glowDepth) {
          const block = document.getElementById("hook-lines");
          // Real font metrics may differ from the conservative planner. Keep the last line at the measured head.
          const root = document.getElementById("root").getBoundingClientRect();
          const k = root.height ? root.height / PLAN.height : 1;
          const wrap = document.getElementById("hook-block");
          let size = PLAN.glowDepth.size;
          while (block.scrollWidth > block.clientWidth + 1 && size > 1) {
            size--;
            wrap.style.fontSize = size + "px";
          }
          const height = block.getBoundingClientRect().height / k;
          const bottom = PLAN.glowDepth.bottom - (PLAN.glowDepth.size - size) * 0.18;
          wrap.style.top = (bottom - height) + "px";
        }
`;
