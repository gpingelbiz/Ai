import { norm } from "./text.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, PKG_ROOT } from "./util.mjs";
import { driftDuring } from "./motion.mjs";

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

/**
 * The highest the head gets while a card is up (fraction of the frame height): the strongest zoom in the card's
 * window and the base slide included. The page drops the footage just far enough that this clears the card's real
 * bottom edge, so a card never covers the head. Null when no face was found.
 */
export function cardHeadTop(detection, { zooms = [], drift = [], t0 = 0, t1 = 0, scale = 1, originY = 0.38, shift = 0 } = {}) {
  const head = headExtent(detection, { zoom: scale * zoomDuring(zooms, t0, t1) * driftDuring(drift, t0, t1), originY });
  return head ? Math.round((head.top + shift) * 1000) / 1000 : null;
}

/** The whole head as a box (fractions of the frame) for the progress rail: hair to chin at the given zoom, a face and
 *  a half wide, so the rail clears more than the face box. Falls back to the face box when no head span is found. */
export function headBoxFor(face, detection, { zoom = 1, scale = 1, originY = 0.38, shift = 0 } = {}) {
  if (!face) return null;
  const head = headExtent(detection, { zoom: scale * zoom, originY });
  if (!head) return face;
  const r = (x) => Math.round(x * 1000) / 1000;
  return { cx: face.cx, w: r(Math.min(1, face.w * scale * zoom * 1.5)), cy: r((head.top + head.bottom) / 2 + shift), h: r(head.bottom - head.top) };
}

/** Head extent (top of hair to chin) across frames, with the zoom applied around its origin. Null when nobody is found. */
/** The speaker's face box as fractions of the frame: median centre and size over the sampled frames, or null. */
export function faceBox(detection) {
  const faces = (detection?.frames || []).flatMap((f) => (f.faces || []).length ? [(f.faces || []).reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a))] : []);
  if (!faces.length) return null;
  const med = (k) => { const s = faces.map((f) => f[k]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const w = med("w"), h = med("h");
  return { cx: round(med("x") + w / 2), cy: round(med("y") + h / 2), w: round(w), h: round(h) };
}

/**
 * Base framing for a wide talking-head shot: scale the footage so the face is about `target` of the frame height
 * (the podcast close framing), anchored on the face, never past `max` (an upscale past that goes soft).
 */
export function baseFraming(face, { target = 0.27, max = 1.3, min = 1, eyeLine = 0.42 } = {}) {
  if (!face || !face.h) return { scale: 1, origin: "50% 40%", shift: 0 };
  const scale = round(Math.max(min, Math.min(max, target / face.h)));
  // With the origin on the face, the face stays where it was; slide the frame so the face centre sits near the
  // eye line, as far as the scaled footage has slack without showing an edge.
  const roomUp = face.cy + (1 - face.cy) * scale - 1; // slack at the bottom (fraction of the frame)
  const roomDown = face.cy * scale - face.cy; // slack at the top
  const shift = round(Math.max(-roomUp, Math.min(roomDown, eyeLine - face.cy)));
  return { scale, origin: `${Math.round(face.cx * 100)}% ${Math.round(face.cy * 100)}%`, shift };
}

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
export function hookBlockHeight(words, { W = 1080, H = 1920, fontPx, widthFrac = 0.92, lineHeight = 1.0, goldScale = 1.14, charEm = 0.46, padEm = 0.42 } = {}) {
  const avail = W * widthFrac;
  let lines = 1, x = 0;
  for (const w of words) {
    const em = (w.key ? goldScale : 1) * fontPx;
    const width = (String(w.text).length * charEm + 0.25) * em;
    if (x > 0 && x + width > avail) { lines++; x = 0; }
    x += width;
  }
  return (lines * fontPx * lineHeight + padEm * fontPx) / H;
}

/**
 * Choose { position, fontScale, zone } for the hook.
 * zone: "above" (over the head), "below" (between chin and captions), "fallback" (nobody found, or no gap fits).
 */
/**
 * Caption height from the face: the block sits just under the chin (with a little air), as high as the Instagram
 * safe zone on a wide shot (`min`) and never lower than `max`, where the caption overlay starts to cover it. Without a
 * face, the preset position. Returns the block's centre as a fraction of the height, plus the top of the block
 * (what the hook placement must stay above).
 */
export function placeCaptions(head, { fontSizeFrac = 0.04, lines = 2, lineHeight = 1.08, gap = 0.03, min = 0.56, max = 0.76, defaultPosition = 0.6 } = {}) {
  const half = (fontSizeFrac * lineHeight * lines) / 2;
  if (!head) return { position: defaultPosition, top: round(defaultPosition - half), zone: "default" };
  const wanted = head.bottom + gap + half;
  const position = round(Math.min(max, Math.max(min, wanted)));
  return { position, top: round(position - half), zone: wanted > max ? "capped" : wanted < min ? "safe-zone" : "below-chin" };
}

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

const rectsOverlap = (a, b, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** Place a credential plate inside the content-safe rectangle, above captions and on the empty side of the head. */
export function placeCredentialLowerThird({ W = 1080, H = 1920, width = 864, height = 190, captionTop = 0.72, face = null, gap = 24 } = {}) {
  const landscape = W > H;
  const left = landscape ? 90 : 76;
  const right = landscape ? W - 90 : Math.min(940, W - 76);
  const top = landscape ? Math.round(H * 0.1) : 200;
  const bottom = Math.min(captionTop * H - gap, landscape ? H * 0.9 : H - 320);
  const faceRect = face ? { x: face.cx * W - face.w * W / 2, y: face.cy * H - face.h * H / 2, w: face.w * W, h: face.h * H } : null;
  const xs = face && face.cx < 0.5 ? [right - width, left] : [left, right - width];
  const ys = [Math.floor(bottom - height)];
  if (faceRect) {
    ys.push(Math.floor(faceRect.y - height - gap));
    ys.push(Math.ceil(faceRect.y + faceRect.h + gap));
  }
  for (const y of [...new Set(ys)]) {
    if (y < top || y + height > bottom) continue;
    for (const x of xs) {
      const box = { x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) };
      if (box.x < left || box.x + box.w > right) continue;
      if (!faceRect || !rectsOverlap(box, faceRect, gap)) return { ...box, faceOverlap: false, captionOverlap: false };
    }
  }
  return { skip: true, reason: "no safe plate position clear of the head and captions" };
}

/** Place the payoff rail between hook and captions, or vertically on the empty side of the face. */
export function placeProgressRail({ W = 1080, H = 1920, hookTop = 0, hookBottom = 0.35, captionTop = 0.68, face = null, side = "right" } = {}) {
  const hook = { x: 76, y: hookTop * H, w: Math.min(W - 152, 864), h: Math.max(0, (hookBottom - hookTop) * H) };
  const faceRect = face ? { x: face.cx * W - face.w * W / 2, y: face.cy * H - face.h * H / 2, w: face.w * W, h: face.h * H } : null;
  // 170 px tall: a label may wrap to two 48 px lines ("FINALLY / LEFT") instead of being cut off.
  const band = { x: 86, y: 820, w: Math.min(814, W - 86 - 140), h: 170, orientation: "horizontal" };
  const bandBlocked = rectsOverlap(band, hook, 20) || band.y + band.h + 20 > captionTop * H || (faceRect && rectsOverlap(band, faceRect, 18));
  if (!bandBlocked) return band;

  // In a medium talking-head shot the head fills the middle of the frame, so the band would sit on it. Next try the
  // top of the frame: under Instagram's top bar (y 200) and above the hook, when the hook sits low enough.
  const top = { ...band, y: 200 };
  if (top.y + top.h + 24 <= hookTop * H && !(faceRect && rectsOverlap(top, faceRect, 18))) return { ...top, at: "top" };

  const x = side === "left" ? 76 : Math.min(680, W - 400);
  const y = Math.max(200, Math.ceil(hookBottom * H + 24));
  const bottom = Math.min(captionTop * H - 24, H - 320);
  const strip = { x, y, w: 260, h: Math.floor(bottom - y), orientation: "vertical" };
  if (strip.h < 300) return { skip: true, reason: "no 300px gap between the hook and captions" };
  if (strip.x < 76 || strip.x + strip.w > Math.min(940, W - 76)) return { skip: true, reason: "the empty-side strip would enter the action rail" };
  if (rectsOverlap(strip, hook, 16)) return { skip: true, reason: "the empty-side strip would hit the hook" };
  if (faceRect && rectsOverlap(strip, faceRect, 18)) return { skip: true, reason: "the empty-side strip would hit the face" };
  return strip;
}

const round = (x) => Math.round(x * 1000) / 1000;

/** Caption lines that only repeat an automatic hook (the clip's own first sentence) while it is on screen. */
export function captionsRepeatingHook(groups, hook) {
  if (!hook?.auto) return new Set();
  const hookToks = new Set(String(hook.text).split(/\s+/).map(norm).filter(Boolean));
  const end = hook.start + hook.duration;
  const hide = new Set();
  groups.forEach((g, i) => {
    if (g.start < end && g.words.length && g.words.every((w) => hookToks.has(norm(w.text)))) hide.add(i);
  });
  return hide;
}

/** Hook treatments drawn on a solid block, with their type metrics (em = size against the preset hook size,
 *  charEm = average character width; Courier is monospace at 0.6em, the panel adds a lamp and a frame). */
export const BLOCK_HOOKS = {
  type: { em: 0.98, charEm: 0.6, lineHeight: 1.14, padEm: 0.5 },
  stamp: { em: 1, charEm: 0.46, lineHeight: 1.1, padEm: 0.4 },
  panel: { em: 1, charEm: 0.46, lineHeight: 1.1, padEm: 0.9 },
};

/**
 * A solid hook block is opaque, so it must end above the head (above the eyes at the very least): it is measured
 * in its own type, shrunk (to 60% at most) until it fits between the top of the frame and the head, and placed so
 * its bottom clears the head. compose puts the block's top 1.2 hook-font-heights above `position`.
 * Returns { fontSizeFrac, position, fits } or null for a treatment that is not a block.
 */
export function fitBlockHook(words, { treat, headTop, fontSizeFrac, W = 1080, H = 1920, top = 0.03, gap = 0.015 } = {}) {
  const block = BLOCK_HOOKS[treat];
  if (!block || !(headTop > 0)) return null;
  const measure = (frac) => hookBlockHeight(words, { W, H, fontPx: Math.round(frac * H * block.em), charEm: block.charEm, lineHeight: block.lineHeight, padEm: block.padEm, goldScale: 1 });
  let frac = fontSizeFrac;
  while (frac > fontSizeFrac * 0.6 && measure(frac) > headTop - gap - top) frac = Math.round(frac * 0.94 * 1000) / 1000;
  const h = measure(frac);
  const blockTop = Math.max(top, headTop - gap - h);
  return { fontSizeFrac: frac, position: Math.round((blockTop + 1.2 * frac) * 1000) / 1000, fits: blockTop + h <= headTop - gap + 1e-6 };
}
