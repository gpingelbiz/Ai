import { headBoxFor, zoomDuring } from "./placement.mjs";

const SAFE_LEFT = 76;
const SAFE_RIGHT = 940;
const TOP_SAFE = 200;
const PANEL_GAP = 24;
const PANEL_MIN = 280;
const PANEL_MAX = 360;
const SPLIT_FACE_Y = 2 / 3;

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

/** Put a 4:5 panel on whichever side leaves the most room around the whole head at the strongest active zoom. */
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
  if (width < PANEL_MIN) {
    return { shot: { ...shot, layout: "full" }, skipped: "window skipped: neither side has a clear 280px panel" };
  }

  const height = Math.round(width * 1.25);
  const x = rooms[0].side === "left" ? SAFE_LEFT : SAFE_RIGHT - width;
  const panel = { x, y: TOP_SAFE, w: width, h: height, side: rooms[0].side };
  return { shot: { ...shot, layout: "window", panel }, note: `window on the ${panel.side} of the head` };
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

  const footageY = Math.round((SPLIT_FACE_Y - currentY) * H);
  return {
    shot: { ...shot, layout: "split", split: { seamY: Math.round(H / 2), footageY } },
    note: "horizontal split with the face centred in the bottom half",
  };
}

export function planMixLayout(shot, context = {}) {
  return context.index % 2 ? planSplitLayout(shot, context) : planWindowLayout(shot, context);
}

// One entry per layout keeps parallel additions (such as cutout) to a single, conflict-light map insertion.
export const BROLL_LAYOUTS = {
  full: planFullLayout,
  window: planWindowLayout,
  split: planSplitLayout,
  mix: planMixLayout,
};

export function planBrollLayouts(shots = [], { layout = "full", ...context } = {}) {
  const mode = BROLL_LAYOUTS[layout] ? layout : "full";
  if (mode === "full") return { shots, logs: [] };
  const logs = [];
  const planned = shots.map((shot, index) => {
    const result = BROLL_LAYOUTS[mode](shot, { ...context, index });
    const actual = result.shot.layout || "full";
    const detail = result.skipped ? `${result.skipped}; ${result.note || "using a full-frame cutaway"}` : result.note;
    logs.push(`b-roll layout: ${actual} at ${round(shot.start)}s (${detail})`);
    return result.shot;
  });
  return { shots: planned, logs };
}
