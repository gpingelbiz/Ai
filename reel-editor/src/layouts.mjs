import { headBoxFor, zoomDuring } from "./placement.mjs";

const SAFE_LEFT = 76;
const SAFE_RIGHT = 940;
const TOP_SAFE = 200;
const PANEL_GAP = 24;
const PANEL_MIN = 280;
const PANEL_MAX = 360;
const SPLIT_FACE_Y = 2 / 3;
// Two caption lines below the caption top; the head keeps this gap from the seam and the captions; the chin stays
// above the platform's bottom strip.
const SPLIT_CAPTION_BAND = 0.1;
const SPLIT_GAP = 0.012;
const SPLIT_CHIN_MAX = 0.86;
const SPLIT_SEAM_MIN = 0.36;

const round = (n) => Math.round(n * 1000) / 1000;

function headFor(shot, { face, detection, zooms = [], framing = {} }) {
  if (!face) return null;
  const originY = parseFloat(String(framing.origin || "50% 38%").split(" ")[1]) / 100 || 0.38;
  return headBoxFor(face, detection, {
    zoom: zoomDuring(zooms, shot.start, shot.start + shot.duration),
    scale: framing.scale || 1,
    originY,
    shift: framing.shift || 0,
  });
}

export function planFullLayout(shot) {
  return { shot, note: "full-frame cutaway" };
}

/** The biggest clear panel: 4:5 beside the head (on the side with more room) or 5:4 on the wall above it, at the
 *  strongest active zoom. A centred head leaves no side room, and a high head no wall; the larger one wins. */
export function planWindowLayout(shot, context = {}) {
  const { W = 1080, H = 1920, captionTop = 0.68 } = context;
  const head = headFor(shot, context);
  if (!head) return { shot: { ...shot, layout: "full" }, skipped: "window skipped: no head box was found" };

  const leftEdge = (head.cx - head.w / 2) * W;
  const rightEdge = (head.cx + head.w / 2) * W;
  const rooms = [
    { side: "left", room: leftEdge - PANEL_GAP - SAFE_LEFT },
    { side: "right", room: SAFE_RIGHT - rightEdge - PANEL_GAP },
  ].sort((a, b) => b.room - a.room);
  const vertical = captionTop * H - PANEL_GAP - TOP_SAFE;
  const width = Math.floor(Math.min(PANEL_MAX, rooms[0].room, vertical / 1.25));
  const side = width >= PANEL_MIN
    ? { x: rooms[0].side === "left" ? SAFE_LEFT : SAFE_RIGHT - width, y: TOP_SAFE, w: width, h: Math.round(width * 1.25), side: rooms[0].side }
    : null;
  const above = (head.cy - head.h / 2) * H - PANEL_GAP - TOP_SAFE;
  const aw = Math.floor(Math.min(SAFE_RIGHT - SAFE_LEFT, PANEL_MAX * 1.5, above * 1.25));
  const top = aw >= PANEL_MIN && Math.round(aw / 1.25) >= PANEL_MIN * 0.8
    ? { x: Math.round(Math.max(SAFE_LEFT, Math.min(SAFE_RIGHT - aw, head.cx * W - aw / 2))), y: TOP_SAFE, w: aw, h: Math.round(aw / 1.25), side: "top" }
    : null;
  const panel = [side, top].filter(Boolean).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!panel) return { shot: { ...shot, layout: "full" }, skipped: "window skipped: no clear 280px panel beside or above the head" };
  return { shot: { ...shot, layout: "window", panel }, note: panel.side === "top" ? "window above the head" : `window on the ${panel.side} of the head` };
}

/** Split at the halfway seam. The outer footage position moves; #video-wrap keeps owning every punch-in. */
export function planSplitLayout(shot, context = {}) {
  const { face, H = 1920, framing = {} } = context;
  const currentY = face ? face.cy + (framing.shift || 0) : null;
  if (!Number.isFinite(currentY)) {
    const fallback = planWindowLayout(shot, context);
    return { ...fallback, skipped: `split skipped: no face box was found${fallback.skipped ? `; ${fallback.skipped}` : ""}` };
  }
  if (currentY > SPLIT_FACE_Y) {
    const fallback = planWindowLayout(shot, context);
    return { ...fallback, skipped: `split skipped: the face is too low for the bottom half${fallback.skipped ? `; ${fallback.skipped}` : ""}` };
  }

  const strongest = zoomDuring(context.zooms || [], shot.start, shot.start + shot.duration) * (framing.scale || 1);
  if (face.h * strongest > 0.29) {
    const fallback = planWindowLayout(shot, context);
    return { ...fallback, skipped: `split skipped: the zoomed face is too tall for the bottom half${fallback.skipped ? `; ${fallback.skipped}` : ""}` };
  }

  // The head (hair to chin) must miss the caption band, which stays where the reel put it. Try the face centred a
  // third of the way down the bottom half, then tucked between the seam and the captions, then below the captions.
  // The footage only ever moves down (moving it up would open a gap at the bottom of the frame).
  const fh = face.h * strongest, hair = 0.35 * fh;
  const capTop = context.captionTop ?? 0.68, capBottom = capTop + SPLIT_CAPTION_BAND;
  const e = 1e-6; // the tucked spot sits exactly on its limits
  const clear = (cy, seam) => cy - fh / 2 - hair >= seam + SPLIT_GAP - e && cy + fh / 2 <= SPLIT_CHIN_MAX + e && cy >= currentY - e && (cy + fh / 2 <= capTop - SPLIT_GAP + e || cy - fh / 2 - hair >= capBottom + SPLIT_GAP - e);
  // Between the seam and the captions: the chin just above the captions, the seam raised (to 36% at most) to make
  // room for the hair.
  const tuckCy = capTop - SPLIT_GAP - fh / 2;
  const tuckSeam = Math.max(SPLIT_SEAM_MIN, Math.min(0.5, tuckCy - fh / 2 - hair - SPLIT_GAP));
  const spots = [
    [SPLIT_FACE_Y, 0.5, "horizontal split with the face centred in the bottom half"],
    [tuckCy, tuckSeam, `horizontal split at ${Math.round(tuckSeam * 100)}% with the face between the seam and the captions`],
    [capBottom + SPLIT_GAP + hair + fh / 2, 0.5, "horizontal split with the face below the captions"],
  ];
  const spot = spots.find(([cy, seam]) => clear(cy, seam));
  if (!spot) {
    const fallback = planWindowLayout(shot, context);
    return { ...fallback, skipped: `split skipped: the head cannot clear the captions under the seam${fallback.skipped ? `; ${fallback.skipped}` : ""}` };
  }
  const footageY = Math.round((spot[0] - currentY) * H);
  return {
    shot: { ...shot, layout: "split", split: { seamY: Math.round(spot[1] * H), footageY } },
    note: spot[2],
  };
}

/** "cutout" here only marks the item; the pipeline mattes it next, and a failed matte leaves the full cutaway. */
export function planCutoutLayout(shot) {
  return { shot: { ...shot, layout: "cutout" }, note: "the speaker stays cut out over the b-roll" };
}

/** Window, cutout, split in turn, so several cutaways never repeat one look; a window or split that cannot fit
 *  becomes the cutout, which fits any frame. */
export function planMixLayout(shot, context = {}) {
  const turn = (context.index || 0) % 3;
  if (turn === 1) return planCutoutLayout(shot);
  const result = turn === 2 ? planSplitLayout(shot, context) : planWindowLayout(shot, context);
  if ((result.shot.layout || "full") !== "full") return result;
  return { ...planCutoutLayout(shot), skipped: result.skipped };
}

// One entry per layout keeps parallel additions (such as cutout) to a single, conflict-light map insertion.
export const BROLL_LAYOUTS = {
  full: planFullLayout,
  window: planWindowLayout,
  split: planSplitLayout,
  mix: planMixLayout,
};

/** `perShot[i]` ({face, detection} sampled inside item i's window) wins over the reel-wide face: a reel can change
 *  framing (a selfie shot after a seated one), and the opening frames say nothing about a cutaway at 0:39. */
export function planBrollLayouts(shots = [], { layout = "full", perShot = [], ...context } = {}) {
  const mode = BROLL_LAYOUTS[layout] ? layout : "full";
  if (mode === "full") return { shots, logs: [] };
  const logs = [];
  const planned = shots.map((shot, index) => {
    const result = BROLL_LAYOUTS[mode](shot, { ...context, ...(perShot[index] || {}), index });
    const actual = result.shot.layout || "full";
    const detail = result.skipped ? `${result.skipped}; ${result.note || "using a full-frame cutaway"}` : result.note;
    logs.push(`b-roll layout: ${actual} at ${round(shot.start)}s (${detail})`);
    return result.shot;
  });
  return { shots: planned, logs };
}
