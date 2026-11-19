import { spawn } from "node:child_process";

/**
 * Frame-aware placement for everything that lands on top of the speaker: animation cards, glow notify and stamp
 * overlays, and keyword slams. Before an item goes on screen we read its frame: where the head and body are (Apple
 * Vision boxes, moved by the framing and the strongest punch-in while it is up), where the captions sit, and which
 * parts of the picture are quiet (low edge energy in a tiny grey copy of the frame). Then every open spot is tried
 * (beside the head, above it, a top corner, between chin and captions, under the captions, the old push-down, a
 * full-screen card), the card is sized to fit that spot, and the cheapest spot wins. A spot the last card used costs
 * more, so a reel never repeats one layout. Nothing is ever placed on the face or the captions: a spot that would
 * touch either is not a candidate at all.
 *
 * Every box is canvas pixels, origin top-left. Detection boxes are fractions of the source frame.
 */

const r = Math.round;
const r3 = (x) => Math.round(x * 1000) / 1000;

export const PLACE_SLOTS = ["side", "top", "corner", "lower", "base", "behind", "push", "full"];

// Instagram covers the top 200 px (name, audio) and the bottom ~320 px (caption, buttons); the like/comment rail
// sits at the right edge from about 1150 px down.
const SAFE = { left: 64, right: 64, top: 200, bottom: 320, rail: 140, railTop: 1150 };

/** Read the transform the composition applies to the footage, so detection fractions become canvas pixels. */
export function viewFor({ framing = {}, origin, zoom = 1 } = {}) {
  const o = String(origin || framing.origin || "50% 40%").split(" ");
  return { ox: (parseFloat(o[0]) || 50) / 100, oy: (parseFloat(o[1]) || 40) / 100, z: (framing.scale || 1) * zoom, shift: framing.shift || 0 };
}

const toCanvas = (v, W, H) => (b) => {
  const x0 = v.ox + (b.x - v.ox) * v.z, x1 = v.ox + (b.x + b.w - v.ox) * v.z;
  const y0 = v.oy + (b.y - v.oy) * v.z + v.shift, y1 = v.oy + (b.y + b.h - v.oy) * v.z + v.shift;
  return { x: x0 * W, y: y0 * H, w: (x1 - x0) * W, h: (y1 - y0) * H };
};

const union = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const clip = (b, W, H) => {
  if (!b) return null;
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  const w = Math.min(W, b.x + b.w) - x, h = Math.min(H, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};
export const overlaps = (a, b, gap = 0) => !!a && !!b && a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
const area = (b) => (b ? Math.max(0, b.w) * Math.max(0, b.h) : 0);
const inter = (a, b) => {
  if (!a || !b) return 0;
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * What is where while an item is up. `detection` holds frames sampled inside the item's window; `view` comes from
 * viewFor (framing plus the strongest punch-in in the window). The head box runs from the top of the hair to just
 * under the chin and a little past the ears, across every sampled frame, so a speaker who moves stays clear.
 * measured is false when detection never ran (no Mac face finder): callers keep their old placement then.
 */
export function readFrame(detection, { W = 1080, H = 1920, view = viewFor(), captionTop = 0.68, captionBottom = null, captionFontFrac = 0.04, busy = null } = {}) {
  const map = toCanvas(view, W, H);
  let head = null, body = null, people = 0;
  for (const f of detection?.frames || []) {
    const faces = f.faces || [];
    people = Math.max(people, faces.length);
    for (const b of faces) {
      const cx = b.x + b.w / 2;
      const ub = (f.bodies || []).find((u) => cx >= u.x && cx <= u.x + u.w && u.y <= b.y);
      const top = ub ? Math.min(ub.y, b.y - 0.08 * b.h) : b.y - 0.22 * b.h;
      head = union(head, map({ x: b.x - 0.2 * b.w, y: top, w: 1.4 * b.w, h: b.y + 1.08 * b.h - top }));
    }
    for (const u of f.bodies || []) body = union(body, map(u));
    // Someone with no face found (turned away, a second person in profile): the top of their body stands in for a head.
    for (const u of f.bodies || []) {
      const hasFace = faces.some((b) => b.x + b.w / 2 >= u.x && b.x + b.w / 2 <= u.x + u.w && b.y >= u.y - 0.02);
      if (!hasFace) head = union(head, map({ x: u.x + 0.1 * u.w, y: u.y - 0.02, w: 0.8 * u.w, h: Math.min(u.h, 0.3) }));
    }
  }
  const capTop = captionTop * H;
  const capBottom = (captionBottom ?? captionTop + captionFontFrac * 2.6 + 0.02) * H;
  return {
    W, H,
    measured: !!detection?.frames?.length,
    head: clip(head, W, H),
    body: clip(body, W, H),
    people,
    caption: { x: 0, y: r(capTop - 0.008 * H), w: W, h: r(capBottom - capTop + 0.016 * H) },
    busy,
    view,
  };
}

/**
 * How full each part of the picture is: mean gradient magnitude on a cols x rows grey copy of the source frame,
 * scaled to 0-1. Returns { cols, rows, cells } or null when ffmpeg cannot read the frame.
 */
export async function frameBusy(video, t, { cols = 27, rows = 48 } = {}) {
  const buf = await new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-v", "error", "-ss", String(Math.max(0, t)), "-i", video, "-frames:v", "1", "-vf", `scale=${cols}:${rows},format=gray`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("error", () => resolve(null));
    p.on("close", (code) => resolve(code === 0 ? Buffer.concat(chunks) : null));
  });
  if (!buf || buf.length < cols * rows) return null;
  return busyFromGray(buf, cols, rows);
}

export function busyFromGray(px, cols, rows) {
  const cells = new Float32Array(cols * rows);
  const at = (x, y) => px[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1);
    cells[y * cols + x] = Math.min(1, Math.hypot(gx, gy) / 60);
  }
  return { cols, rows, cells };
}

/** Mean busyness under a canvas rectangle (0 quiet, 1 full of detail). 0.3 when the frame was not read. */
export function busyUnder(frame, box) {
  const b = frame.busy;
  if (!b?.cells) return 0.3;
  const { W, H, view: v } = frame;
  // Canvas point back to a source fraction (the inverse of toCanvas).
  const sx = (X) => v.ox + (X / W - v.ox) / v.z, sy = (Y) => v.oy + (Y / H - v.shift - v.oy) / v.z;
  const c0 = Math.max(0, Math.floor(sx(box.x) * b.cols)), c1 = Math.min(b.cols - 1, Math.ceil(sx(box.x + box.w) * b.cols) - 1);
  const r0 = Math.max(0, Math.floor(sy(box.y) * b.rows)), r1 = Math.min(b.rows - 1, Math.ceil(sy(box.y + box.h) * b.rows) - 1);
  let sum = 0, n = 0;
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) { sum += b.cells[y * b.cols + x]; n++; }
  return n ? sum / n : 0.3;
}

/**
 * Rough size of a card at its design width (900 px, the overlay card), from its type and text, and the narrowest
 * width its layout survives (two-column cards and the horizontal step row need a wide box). `wrap` says how much
 * taller the card gets when its text has to wrap into a narrower box. The page measures the real card and refits it.
 */
export function cardFootprint(card = {}) {
  const words = (s) => String(s || "").length;
  const n = (card.items || card.rungs || card.bubbles || card.bars || []).length;
  const eyebrow = card.eyebrow ? 50 : 0;
  switch (card.type) {
    case "stat": return { w: 900, h: 260 + eyebrow + (card.sub || card.label ? 70 : 0), minW: 480, wrap: 0.35 };
    case "headline": case "chapter": return { w: 900, h: 110 + eyebrow + Math.ceil(words(card.title || card.text) / 20) * 85, minW: 480, wrap: 0.8 };
    case "quote": return { w: 900, h: 140 + eyebrow + Math.ceil(words(card.text || card.quote) / 26) * 66, minW: 520, wrap: 0.8 };
    // Timed lists keep each row on one line, so they need a wider layout than a wrapped card.
    // The compact size: the page tightens padding and gaps when the roomy version does not fit (graphics.mjs).
    case "list": case "ladder": return { w: 900, h: 130 + eyebrow + Math.max(2, n) * 90, minW: 640, wrap: 0.3 };
    case "steps": return card.items?.every((it) => Number.isFinite(it.at)) ? { w: 900, h: 110 + eyebrow + Math.max(2, n) * 84, minW: 640, wrap: 0.3 } : { w: 900, h: 280 + eyebrow, minW: 720, minVisual: 600, wrap: 0.3 };
    case "compare": return { w: 900, h: 300 + eyebrow, minW: 700, minVisual: 600, wrap: 0.4 };
    case "bars": return { w: 900, h: 120 + eyebrow + Math.max(2, n) * 84, minW: 620, minVisual: 520, wrap: 0.3, minScale: 0.72 };
    case "message": return { w: 900, h: 150 + Math.max(2, n) * 104, minW: 560, wrap: 0.5, minScale: 0.8 };
    case "post": return { w: 900, h: 340, minW: 600, wrap: 0.5 };
    case "flip": return { w: 900, h: 150 + eyebrow + Math.ceil(Math.max(words(card.wrong), words(card.right)) / 18) * 86, minW: 480, wrap: 0.7 };
    case "notify": return { w: 670, h: 150, minW: 520, wrap: 0.5 };
    case "stamp": { const w = Math.round(Math.max(4, words(card.text)) * 0.62 * 144 + 24); return { w, h: 160, minW: w, minVisual: 200, wrap: 0 }; }
    case "slam": return { w: Math.max(300, words(card.text) * 0.52 * 200), h: 220, minW: 260, wrap: 0, slam: true };
    default: return { w: 900, h: 320 + eyebrow, minW: 520, wrap: 0.5 };
  }
}

/**
 * Largest scale (<= max) at which the card fits a w x h space: the card lays out at width space.w / scale (but never
 * wider than its design width, nor narrower than minW) and grows taller as it wraps. Null when it cannot fit at min.
 */
export function fitScale(foot, space, { max = 0.85, min = 0.56 } = {}) {
  for (let s = max; s >= min - 1e-9; s = r3(s - 0.02)) {
    const layoutW = Math.min(foot.w, space.w / s);
    if (layoutW < foot.minW - 1e-6) continue;
    // Shrinking is fine; shrinking past reading size is not. Wide cards need a wide box on screen too.
    if (layoutW * s < (foot.minVisual ?? Math.min(foot.w, 330)) - 1e-6) return null;
    const h = foot.h * Math.pow(foot.w / layoutW, foot.wrap) * s;
    const w = layoutW * s;
    if (h <= space.h + 1e-6 && w <= space.w + 1e-6) return { scale: r3(s), layoutW: r(layoutW), w: r(w), h: r(h) };
  }
  return null;
}

// Base cost of each spot; the scale, busyness, torso overlap and repetition terms are added per card.
const COST = { side: 0.05, top: 0.1, corner: 0.14, lower: 0.16, base: 0.32, behind: 0.3, push: 0.5, full: 0.95 };

/** Every open spot for this frame, as { slot, side, space, anchor } spaces that already miss the head and captions. */
export function openSpaces(frame, { gap = 28, behind = false } = {}) {
  const { W, H, head, caption } = frame;
  const L = SAFE.left, R = W - SAFE.right, T = SAFE.top;
  const capTop = caption.y - gap, capBottom = caption.y + caption.h + gap;
  const floor = H - SAFE.bottom;
  const railR = (bottom) => (bottom > SAFE.railTop ? Math.min(R, W - SAFE.rail) : R);
  const spaces = [];
  const add = (slot, side, x, y, w, h, anchor) => {
    const right = Math.min(x + w, railR(y + h));
    w = right - x;
    if (w >= 160 && h >= 90) spaces.push({ slot, side, space: { x: r(x), y: r(y), w: r(w), h: r(h) }, anchor });
  };
  if (!head) {
    // Nobody in the frame (or detection found no one): any spot above the captions is open.
    add("top", "center", L, T, R - L, Math.min(capTop, H * 0.5) - T, "top");
    add("lower", "center", L, H * 0.42, R - L, capTop - H * 0.42, "center");
    return spaces;
  }
  const hTop = head.y, hBot = head.y + head.h, hL = head.x, hR = head.x + head.w, hCy = head.y + head.h / 2;
  // Above the head, full width.
  add("top", "center", L, T, R - L, hTop - gap - T, "top");
  // Beside the head: the full column from the top bar to the captions, centred on the face height.
  add("side", "left", L, T, hL - gap - L, capTop - T, { cy: hCy });
  add("side", "right", hR + gap, T, R - hR - gap, capTop - T, { cy: hCy });
  // The like/comment rail narrows the right column low in the frame; the column above the rail keeps its width.
  if (capTop > SAFE.railTop && SAFE.railTop - T > 300) add("side", "right", hR + gap, T, R - hR - gap, SAFE.railTop - T, { cy: hCy });
  // A top corner: smaller, pinned to the top bar on the side with more room; it may reach over the head's column
  // only above the hair.
  const cornerW = Math.max(hL - gap - L, R - hR - gap);
  const leftRoom = hL - gap - L, rightRoom = R - hR - gap;
  const cSide = leftRoom >= rightRoom ? "left" : "right";
  add("corner", cSide, cSide === "left" ? L : R - Math.max(cornerW, (R - L) * 0.5), T, Math.max(cornerW, (R - L) * 0.5), Math.min(capTop, hTop - gap) - T, cSide === "left" ? "top-left" : "top-right");
  // Between the chin and the captions.
  // Two looks for the same band: tucked under the chin, or resting just above the captions.
  add("lower", "high", L, hBot + gap, R - L, capTop - hBot - gap, "top");
  add("lower", "low", L, hBot + gap, R - L, capTop - hBot - gap, "bottom");
  // A narrow card or word in that band can also sit off to one side, under a shoulder.
  add("lower", "left", L, hBot + gap, (R - L) * 0.62, capTop - hBot - gap, "left");
  add("lower", "right", L + (R - L) * 0.38, hBot + gap, (R - L) * 0.62, capTop - hBot - gap, "right");
  // Behind the speaker (Greg 11-18: "put the cards behind the speaker if it covers any"): the card may reach into the
  // head's box because a person matte keeps the head in front of it. Only part of the card may hide behind the head.
  if (behind) {
    // Sized so a card that fills the space tucks only its own inner edge (13%) behind the head.
    add("behind", "top", L, T, R - L, Math.min(capTop, T + (hTop - T) / 0.87) - T, "top");
    add("behind", "left", L, T, Math.min(R, L + (hL - L) / 0.87) - L, capTop - T, { cy: hCy - 0.15 * head.h });
    add("behind", "right", Math.max(L, R - (R - hR) / 0.87), T, R - Math.max(L, R - (R - hR) / 0.87), capTop - T, { cy: hCy - 0.15 * head.h });
  }
  // Under the captions, above the platform's bottom strip (only when the body does not fill it... the body may).
  add("base", "center", L, capBottom, R - L, floor - capBottom, "center");
  return spaces;
}

/**
 * Pick the spot, size and look of one card. Returns a placement the page applies:
 *   { slot, side, x, y, w, h, scale, layoutW, anchor, drop?, why }
 * or { slot: "full" } (a full-screen card on the brand ground, the speaker hidden for its length).
 * history: the slots and sides of the cards before this one, newest last. pin: a preset's fixed slot (string or
 * list); "push" or "legacy" keeps the old top card with the footage pushed down.
 */
const sizeClass = (a, W, H) => (a < 0.07 * W * H ? "small" : a < 0.15 * W * H ? "medium" : "large");

export function placeCard(card, frame, { history = [], pin = null, maxScale = 0.85, minScale = 0.56, maxArea = 0.3, allowFull = true, allowPush = true, allowBehind = false, maxHidden = 0.3, kind = "card", fullCost = COST.full, behindCost = COST.behind } = {}) {
  const foot = card.foot || cardFootprint(card);
  const { W, H, head, body } = frame;
  const allowed = pin ? (Array.isArray(pin) ? pin : [pin]) : null;
  const prev = history.at(-1), prev2 = history.at(-2);
  // What the person matte covers: the head, and the body from the shoulders down (Vision's upper-body box is a
  // rectangle, so beside the head at head height it is still wall).
  const shoulders = head && body ? clip({ x: body.x, y: head.y + 0.85 * head.h, w: body.w, h: body.y + body.h - (head.y + 0.85 * head.h) }, W, H) : null;
  const covers = head ? [head, ...(shoulders ? [shoulders] : [])] : body ? [body] : [];
  const hiddenArea = (b) => covers.reduce((a, c) => a + inter(b, c), 0) - (covers.length === 2 ? inter(b, clip({ x: Math.max(head.x, shoulders.x), y: Math.max(head.y, shoulders.y), w: Math.min(head.x + head.w, shoulders.x + shoulders.w) - Math.max(head.x, shoulders.x), h: Math.min(head.y + head.h, shoulders.y + shoulders.h) - Math.max(head.y, shoulders.y) }, W, H)) : 0);
  // Behind the speaker the person may only cover the card's inner edge (its padding), never the middle where the
  // words are: the head reaches at most 15% into the card from the side that faces it.
  const edgeOnly = (box, side) => {
    if (!head) return true;
    const reach = side === "top" ? (box.y + box.h - head.y) / box.h : side === "left" ? (box.x + box.w - head.x) / box.w : (head.x + head.w - box.x) / box.w;
    return reach <= 0.15;
  };
  const options = [];
  for (const sp of openSpaces(frame, { behind: allowBehind && (kind === "card" || kind === "scene") })) {
    if (kind === "scene" && sp.slot === "base") continue;
    if (allowed && !allowed.includes(sp.slot)) continue;
    if (kind === "slam" && sp.slot === "base") continue;
    // A flip is read word for word (the old phrase, then the new one): none of it may hide behind the head.
    if (card.type === "flip" && sp.slot === "behind") continue;
    // A corner card is a small card by design; the big slots cap at maxScale ("make them smaller so they fit").
    const max = sp.slot === "corner" ? Math.min(maxScale, 0.66) : maxScale;
    // Small-type cards (bars, message threads) cannot shrink as far as a big headline and still read.
    const fit = fitScale(foot, sp.space, { max, min: Math.max(minScale, foot.minScale || 0) });
    if (!fit) continue;
    if (fit.w * fit.h > maxArea * W * H) continue;
    const box = boxIn(sp, fit, frame);
    // Behind the speaker, the person matte lifts the head AND the body above the card: both hide it.
    const hidden = sp.slot === "behind" ? hiddenArea(box) / Math.max(1, area(box)) : head ? inter(box, head) / Math.max(1, area(box)) : 0;
    if (sp.slot === "behind" ? hidden < 0.02 || hidden > maxHidden || !edgeOnly(box, sp.side) : head && overlaps(box, head, 8)) continue;
    if (overlaps(box, frame.caption, 8)) continue;
    let cost = (sp.slot === "behind" ? behindCost : COST[sp.slot]) + (sp.slot === "behind" ? hidden * 0.8 : 0);
    cost += (max - fit.scale) * 0.6; // a squeezed card reads worse (the page refits it to its real size)
    cost += 0.5 * busyUnder(frame, box);
    // Over the torso is a normal spot for a card (the lower third); it only counts a little against the wall.
    if (body) cost += 0.12 * (inter(box, body) / Math.max(1, area(box)));
    if (prev && prev.slot === sp.slot) cost += prev.side === sp.side ? 0.45 : 0.25;
    if (prev2 && prev2.slot === sp.slot && prev2.side === sp.side) cost += 0.15;
    if (prev && prev.side && prev.side === sp.side && sp.side !== "center") cost += 0.08;
    // Vary how much screen a card takes too (small, medium, large), not only where it sits.
    if (prev?.size && prev.size === sizeClass(fit.w * fit.h, W, H)) cost += 0.06;
    options.push({ ...sp, fit, box, cost });
  }
  // The old layout: the card in the top band and the footage pushed down just far enough to clear the head.
  if (allowPush && kind === "card" && head && (!allowed || allowed.includes("push"))) {
    const sp = { slot: "push", side: "center", space: { x: SAFE.left, y: SAFE.top, w: W - SAFE.left - SAFE.right, h: H * 0.34 }, anchor: "top" };
    const fit = fitScale(foot, sp.space, { max: maxScale, min: minScale });
    if (fit) {
      const box = boxIn(sp, fit, frame);
      const drop = Math.max(0, box.y + box.h + H * 0.02 - head.y);
      if (drop <= H * 0.16 && head.y + head.h + drop < frame.caption.y + frame.caption.h) {
        let cost = COST.push + (drop / H) * 3;
        if (prev?.slot === "push") cost += 0.4;
        options.push({ ...sp, fit, box, cost, drop: r(drop) });
      }
    }
  }
  if (allowFull && (kind === "card" || kind === "scene") && (!allowed || allowed.includes("full"))) options.push({ slot: "full", side: "center", cost: fullCost + (prev?.slot === "full" ? 0.3 : 0) });
  if (!options.length) return null;
  options.sort((a, b) => a.cost - b.cost);
  const best = options[0];
  if (best.slot === "full") return { slot: "full", side: "center", why: options.length === 1 ? "no clear space beside, above or below the speaker" : "full screen beat the open spots" };
  const why = `${best.slot}${best.side !== "center" ? ` ${best.side}` : ""} at ${Math.round(best.fit.scale * 100)}%${best.drop ? `, footage down ${best.drop}px` : ""}`;
  // The next best clear spots (not the push, not full screen): the page tries them in order when the real card
  // will not read in the first one, so a card is never hidden while another clear spot exists.
  const spot = (o) => ({ slot: o.slot, side: o.side, space: o.space, anchor: typeof o.anchor === "string" ? o.anchor : "center", scale: o.fit.scale, layoutW: o.fit.layoutW, ...(o.anchor?.cy != null ? { cy: r(o.anchor.cy) } : {}) });
  const alts = options.slice(1).filter((o) => o.fit && o.slot !== "push" && !(o.slot === best.slot && o.side === best.side)).slice(0, 3).map(spot);
  // The page checks every word against these boxes before a card goes behind the speaker.
  const occl = covers.length ? covers.map((c) => ({ x: r(c.x), y: r(c.y), w: r(c.w), h: r(c.h) })) : null;
  return { slot: best.slot, side: best.side, ...best.box, scale: best.fit.scale, layoutW: best.fit.layoutW, space: best.space, anchor: typeof best.anchor === "string" ? best.anchor : "center", ...(best.anchor?.cy != null ? { cy: r(best.anchor.cy) } : {}), ...(best.drop ? { drop: best.drop } : {}), ...(alts.length ? { alts } : {}), ...(occl ? { occl } : {}), why };
}

/** Where the fitted card sits inside its space: hugging the outer edge beside the head, centred on the face height. */
function boxIn(sp, fit, frame) {
  const s = sp.space;
  let x, y;
  if (sp.slot === "side" || (sp.slot === "behind" && sp.side !== "top")) x = sp.side === "left" ? s.x : s.x + s.w - fit.w;
  else if (sp.anchor === "top-left" || sp.anchor === "left") x = s.x;
  else if (sp.anchor === "top-right" || sp.anchor === "right") x = s.x + s.w - fit.w;
  else x = s.x + (s.w - fit.w) / 2;
  if (sp.anchor === "top" || sp.anchor === "top-left" || sp.anchor === "top-right") y = s.y;
  else if (sp.anchor === "bottom") y = s.y + s.h - fit.h;
  else if (sp.anchor?.cy != null) y = Math.max(s.y, Math.min(s.y + s.h - fit.h, sp.anchor.cy - fit.h / 2));
  else y = s.y + (s.h - fit.h) / 2;
  return { x: r(x), y: r(y), w: fit.w, h: fit.h };
}

/** Plan a whole reel's cards in order, so each one sees what the ones before it chose. */
export function placeSequence(items, frames, opts = {}) {
  const history = [];
  return items.map((item, i) => {
    const frame = frames[i];
    if (!frame?.measured) return null;
    const p = placeCard(item, frame, { ...opts, history, kind: item.kind || opts.kind || "card" });
    if (p) history.push({ slot: p.slot, side: p.side, size: p.slot === "full" ? "full" : sizeClass(p.w * p.h, frame.W, frame.H) });
    return p;
  });
}

/** One-line summary for the run log: "cards placed: side left, top, corner right, full". */
export const describePlacements = (list) => list.filter(Boolean).map((p) => `${p.slot}${p.side && p.side !== "center" ? ` ${p.side}` : ""}`).join(", ");

/**
 * Measure and place a reel's cards (or slams, or glow overlays) in time order. Each item gets three face samples
 * inside its own window and one busyness read at its middle. `zoomAt(t0, t1)` is the strongest punch-in (drift
 * included) while it is up; `framingAt(t)` the base framing (stitched reels change it per scene).
 * Returns the placements (null where nothing was measured) and the log line.
 */
export async function planPlacements(items, { video, detect, zoomAt = () => 1, framingAt = () => ({}), originAt = () => null, W = 1080, H = 1920, captionTop = 0.68, captionFontFrac = 0.04, busy = frameBusy, ...opts } = {}) {
  const frames = [];
  for (const it of items) {
    const t0 = it.start, t1 = it.start + it.duration;
    const det = await detect(video, [0.12, 0.5, 0.88].map((f) => r3(t0 + f * (t1 - t0))));
    const framing = framingAt(t0) || {};
    const view = viewFor({ framing, origin: originAt(t0), zoom: zoomAt(t0, t1) });
    const grid = det ? await busy(video, (t0 + t1) / 2).catch(() => null) : null;
    frames.push(det ? readFrame(det, { W, H, view, captionTop, captionFontFrac, busy: grid }) : null);
  }
  const placements = placeSequence(items, frames, opts);
  return { placements, frames, log: placements.some(Boolean) ? describePlacements(placements) : "" };
}

/**
 * A wide source cropped to a tall canvas (reframe.mjs): move each detection box into the crop window that the
 * composition shows at that frame's time, so placement reads the frame the viewer sees. `lane` is the reframe
 * object-position lane ({ t, x: 0-100, cut? }); between points the crop slides, at a cut it jumps.
 */
export function reframeDetection(det, lane, meta, canvas) {
  if (!det?.frames || !lane?.length) return det;
  const visible = (canvas.width / canvas.height) / (meta.width / meta.height);
  if (visible >= 1) return det;
  const xAt = (t) => {
    let q = lane[0];
    for (const p of lane.slice(1)) {
      if (p.t > t) return p.cut ? q.x : q.x + (p.x - q.x) * Math.max(0, Math.min(1, (t - q.t) / Math.max(0.2, p.t - q.t)));
      q = p;
    }
    return q.x;
  };
  const move = (left) => (b) => ({ ...b, x: (b.x - left) / visible, w: b.w / visible });
  const inView = (b) => b.x + b.w > 0 && b.x < 1;
  return { ...det, frames: det.frames.map((f) => {
    const m = move((xAt(f.t) / 100) * (1 - visible));
    return { ...f, faces: (f.faces || []).map(m).filter(inView), bodies: (f.bodies || []).map(m).filter(inView) };
  }) };
}

/**
 * Detection of the clean footage moved onto the canvas the viewer sees: the face-following crop of a wide source,
 * then the base framing and the punch-in active at each frame. Boxes come back as canvas fractions, so readFrame
 * can use them with no view. (A restyle must not read faces off its old render: a full-screen scene there hides
 * the speaker, and the frame would look empty.)
 */
export function canvasDetection(det, plan, { zoomAt = () => 1 } = {}) {
  if (!det?.frames) return det;
  const canvas = plan.canvas || { width: 1080, height: 1920 };
  const meta = { width: det.width || canvas.width, height: det.height || canvas.height };
  const cropped = Math.abs(canvas.width / canvas.height - meta.width / meta.height) >= 0.05;
  const base = cropped ? (plan.reframe?.length ? reframeDetection(det, plan.reframe, meta, canvas) : null) : det;
  if (!base) return null;
  const framing = plan.framing || {};
  const origin = framing.scale > 1 && framing.origin ? framing.origin : plan.style?.zooms?.origin || "50% 40%";
  return { ...base, frames: base.frames.map((f) => {
    const v = viewFor({ framing, origin, zoom: zoomAt(f.t) });
    const map = (b) => { const c = toCanvas(v, 1, 1)(b); return { x: c.x, y: c.y, w: c.w, h: c.h }; };
    return { ...f, faces: (f.faces || []).map(map), bodies: (f.bodies || []).map(map) };
  }) };
}
