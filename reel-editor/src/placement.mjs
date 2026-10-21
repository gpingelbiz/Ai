import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, PKG_ROOT } from "./util.mjs";

/**
 * Put the hook where it will not cover the speaker's head: above it when there is room, otherwise between the chin
 * and the captions, shrinking the text if neither gap fits. Faces come from Apple Vision (scripts/faces.swift).
 * All positions are fractions of the canvas height, top = 0.
 */

const SWIFT_SRC = path.join(PKG_ROOT, "scripts", "faces.swift");

/** Compile faces.swift once into ~/.cache/reel-editor (recompiled when the source changes). Null off macOS. */
async function facesBinary() {
  if (process.platform !== "darwin" || !fs.existsSync(SWIFT_SRC)) return null;
  const dir = path.join(process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"));
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, `faces-${Math.round(fs.statSync(SWIFT_SRC).mtimeMs)}`);
  if (!fs.existsSync(bin)) {
    try {
      await run("swiftc", ["-O", SWIFT_SRC, "-o", bin], { capture: true });
    } catch {
      return null;
    }
  }
  return bin;
}

/** Faces and upper bodies in a few frames of `video`, or null when detection is unavailable. */
export async function detectFaces(video, times) {
  const bin = await facesBinary();
  if (!bin) return null;
  try {
    const { out } = await run(bin, [video, ...times.map((t) => String(Math.round(t * 1000) / 1000))], { capture: true });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Largest zoom scale active during [t0, t1] (zooms hold until the next one). */
export function zoomDuring(zooms = [], t0 = 0, t1 = 3) {
  let scale = 1;
  let current = 1;
  for (const z of [...zooms].sort((a, b) => a.t - b.t)) {
    if (z.t <= t0) current = z.scale;
    else if (z.t < t1) scale = Math.max(scale, z.scale);
  }
  return Math.max(scale, current);
}

/** Head extent (top of hair to chin) across frames, with the zoom applied around its origin. Null when nobody is found. */
export function headExtent(detection, { zoom = 1, originY = 0.38 } = {}) {
  if (!detection?.frames?.length) return null;
  const zy = (y) => originY + (y - originY) * zoom;
  let top = Infinity, bottom = -Infinity;
  for (const f of detection.frames) {
    const faces = f.faces || [];
    if (faces.length) {
      for (const b of faces) {
        // Vision's face box starts around the hairline. The upper-body box that contains the face starts at the top
        // of the head, so it is the better top when present; otherwise allow a little for hair.
        const cx = b.x + b.w / 2;
        const body = (f.bodies || []).find((u) => cx >= u.x && cx <= u.x + u.w && u.y <= b.y);
        const headTop = body ? Math.min(body.y, b.y - 0.05 * b.h) : b.y - 0.15 * b.h;
        top = Math.min(top, zy(headTop));
        bottom = Math.max(bottom, zy(b.y + b.h + 0.02));
      }
    } else {
      for (const b of f.bodies || []) {
        top = Math.min(top, zy(b.y));
        bottom = Math.max(bottom, zy(b.y + Math.min(b.h, 0.3)));
      }
    }
  }
  if (!Number.isFinite(top)) return null;
  return { top: Math.max(0, top), bottom: Math.min(1, bottom) };
}

/** Rough wrapped height of the hook (fraction of canvas height). Anton caps measure about 0.44em per character
 *  (29 characters filled 965 px at 75.6 px on a real render); 0.46 keeps a little slack. */
export function hookBlockHeight(words, { W = 1080, H = 1920, fontPx, widthFrac = 0.92, lineHeight = 1.0, goldScale = 1.14 } = {}) {
  const avail = W * widthFrac;
  let lines = 1, x = 0;
  for (const w of words) {
    const em = (w.key ? goldScale : 1) * fontPx;
    const width = (String(w.text).length * 0.46 + 0.25) * em;
    if (x > 0 && x + width > avail) { lines++; x = 0; }
    x += width;
  }
  return (lines * fontPx * lineHeight + 0.42 * fontPx) / H;
}

/**
 * Choose { position, fontScale, zone } for the hook.
 * zone: "above" (over the head), "below" (between chin and captions), "fallback" (nobody found, or no gap fits).
 */
export function placeHook(head, { words, W = 1080, H = 1920, fontPx, topSafe = 0.07, captionTop = 0.68, gap = 0.025, defaultPosition = 0.22, minScale = 0.7 } = {}) {
  if (!head) return { position: defaultPosition, fontScale: 1, zone: "fallback" };
  for (const scale of [1, 0.9, 0.8, minScale]) {
    const h = hookBlockHeight(words, { W, H, fontPx: fontPx * scale });
    const aboveRoom = head.top - gap - topSafe;
    if (h <= aboveRoom) return { position: round(Math.max(topSafe, head.top - gap - h)), fontScale: scale, zone: "above", head };
    const belowTop = head.bottom + gap;
    if (h <= captionTop - gap - belowTop) return { position: round(belowTop), fontScale: scale, zone: "below", head };
  }
  // Nothing fits: smallest text in the bigger gap.
  const aboveRoom = head.top - topSafe;
  const belowRoom = captionTop - head.bottom;
  return aboveRoom >= belowRoom
    ? { position: round(topSafe), fontScale: minScale, zone: "fallback", head }
    : { position: round(head.bottom + gap / 2), fontScale: minScale, zone: "fallback", head };
}

const round = (x) => Math.round(x * 1000) / 1000;

/** Caption lines that only repeat an automatic hook (the clip's own first sentence) while it is on screen. */
export function captionsRepeatingHook(groups, hook) {
  if (!hook?.auto) return new Set();
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9']/g, "");
  const hookToks = new Set(String(hook.text).split(/\s+/).map(norm).filter(Boolean));
  const end = hook.start + hook.duration;
  const hide = new Set();
  groups.forEach((g, i) => {
    if (g.start < end && g.words.length && g.words.every((w) => hookToks.has(norm(w.text)))) hide.add(i);
  });
  return hide;
}
