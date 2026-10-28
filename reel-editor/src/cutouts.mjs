import { makeCutout } from "./behind.mjs";
import { r3 } from "./util.mjs";

/** Cutout is one b-roll layout; unknown values keep the established full-frame cutaway. */
export function brollLayout(value) {
  return ({ full: "full", cutout: "cutout" })[value] || "full";
}

/** The strongest already-spaced slam words become pop-outs. */
export function selectPopoutSlams(slams, { max = 2, minRank = 2.5 } = {}) {
  return (slams || [])
    .filter((sl) => (sl.rank || 0) >= minRank)
    .sort((a, b) => b.rank - a.rank || a.t - b.t)
    .slice(0, Math.max(0, max))
    .sort((a, b) => a.t - b.t);
}

function cellsOf(grid) {
  const cols = Math.max(1, Math.round(grid?.cols || 0));
  const rows = Math.max(1, Math.round(grid?.rows || 0));
  const flat = Array.isArray(grid?.cells?.[0]) ? grid.cells.flat() : grid?.cells;
  if (!Array.isArray(flat) || flat.length !== cols * rows) return null;
  return { cols, rows, cells: flat.map((v) => Math.max(0, Math.min(1, Number(v) || 0))) };
}

function coveredByPerson(grid, box, W, H) {
  const g = cellsOf(grid);
  if (!g) return 1;
  const cw = W / g.cols, ch = H / g.rows;
  let covered = 0;
  for (let row = 0; row < g.rows; row++) {
    const y0 = row * ch, y1 = y0 + ch;
    const oh = Math.max(0, Math.min(box.y + box.h, y1) - Math.max(box.y, y0));
    if (!oh) continue;
    for (let col = 0; col < g.cols; col++) {
      const x0 = col * cw, x1 = x0 + cw;
      const ow = Math.max(0, Math.min(box.x + box.w, x1) - Math.max(box.x, x0));
      if (ow) covered += ow * oh * g.cells[row * g.cols + col];
    }
  }
  return covered / Math.max(1, box.w * box.h);
}

/** Largest readable word box in the upper half. Falls back to a normal-size word fully above the head. */
export function placePopoutWord(text, grid, { width = 1080, height = 1920, maxCovered = 0.15, headTop = 0.28, zoom = 1, originX = 0.5, originY = 0.38, shiftY = 0 } = {}) {
  const left = Math.min(width, Math.max(0, width * (76 / 1080)));
  const right = Math.min(width, Math.max(left + 1, width * (940 / 1080)));
  const safeWidth = right - left;
  // Anton is condensed; this keeps the measured box inside the safe 76-940 band while letting the pop-out read
  // larger than the normal slam's deliberately conservative 0.52em-per-character estimate.
  const chars = Math.max(3, String(text || "").length * 0.42);
  const maxFont = Math.min(height * 0.16, safeWidth / chars);
  const minFont = Math.min(maxFont, height * 0.105);
  const topMin = height * 0.04;
  const yStep = height / Math.max(24, cellsOf(grid)?.rows || 48);
  for (let font = maxFont; font >= minFont - 0.5; font -= height * 0.0125) {
    const boxW = Math.min(safeWidth, font * chars);
    const boxH = font * 1.02;
    const x = left + (safeWidth - boxW) / 2;
    const lastTop = height * 0.5 - boxH;
    for (let y = topMin; y <= lastTop + 0.5; y += yStep) {
      // The matte is in source-frame coordinates. Map the rendered word box back through the same base/punch-in
      // scale and base slide used by the footage wrapper (the conservative strongest zoom during the slam).
      const sourceBox = {
        x: originX * width + (x - originX * width) / zoom,
        y: originY * height + (y - shiftY * height - originY * height) / zoom,
        w: boxW / zoom,
        h: boxH / zoom,
      };
      const covered = coveredByPerson(grid, sourceBox, width, height);
      if (covered <= maxCovered) return { top: Math.round(y), fontSize: Math.round(font), covered: r3(covered), fallback: false };
    }
  }
  const gap = height * 0.018;
  const ceiling = Math.max(1, headTop * height - gap);
  const fontSize = Math.max(1, Math.round(Math.min(height * 0.115, safeWidth / chars, ceiling / 1.02)));
  return { top: Math.round(Math.max(0, ceiling - fontSize * 1.02)), fontSize, covered: null, fallback: true };
}

export async function makePopoutSlams({ slams, video, fps = 30, outDir, canvas, settings = {}, framing = {}, zoomDuring = () => 1, headTopFor = () => null }) {
  const picked = new Set(selectPopoutSlams(slams, settings));
  const events = [];
  const planned = [];
  let n = 0;
  for (const sl of slams || []) {
    if (!picked.has(sl)) { planned.push(sl); continue; }
    n++;
    const start = r3(Math.max(0, sl.t - 0.1));
    const end = r3(sl.end + 0.1);
    const cut = await makeCutout({ video, start, duration: r3(end - start), fps, outDir, name: `popout-${n}`, grid: { cols: 27, rows: 48 } });
    if (cut.error) {
      planned.push(sl);
      events.push(`pop-out slam: "${sl.text}" stayed normal (${cut.error})`);
      continue;
    }
    const origin = String(framing.origin || "50% 38%").split(/\s+/).map((v) => parseFloat(v) / 100);
    const placement = placePopoutWord(sl.text, cut.grid, { width: canvas.width, height: canvas.height, maxCovered: settings.maxCovered, headTop: headTopFor(sl) ?? 0.28, zoom: (framing.scale || 1) * zoomDuring(sl.t, sl.end), originX: origin[0] || 0.5, originY: origin[1] || 0.38, shiftY: framing.shift || 0 });
    planned.push({ ...sl, popout: { file: cut.src, start: cut.start, duration: cut.duration, frames: cut.frames, coverage: cut.coverage, placement, dim: settings.dim, blur: settings.blur, outline: settings.outline } });
    events.push(`pop-out slam: "${sl.text}" cut out over ${cut.frames} frames; ${placement.fallback ? "word moved above the head" : `${Math.round((placement.covered || 0) * 100)}% of the word covered`}`);
  }
  return { slams: planned, events };
}

export async function makeCutoutBroll({ broll, layout, video, fps = 30, outDir }) {
  if (brollLayout(layout) !== "cutout") return { broll, events: [] };
  const events = [];
  const planned = [];
  for (let i = 0; i < (broll || []).length; i++) {
    const b = broll[i];
    const cut = await makeCutout({ video, start: b.start, duration: b.duration, fps, outDir, name: `broll-cutout-${i + 1}` });
    if (cut.error) {
      planned.push(b);
      events.push(`cutout b-roll: item ${i + 1} stayed full-frame (${cut.error})`);
    } else {
      planned.push({ ...b, cutout: { file: cut.src, start: cut.start, duration: cut.duration, frames: cut.frames, coverage: cut.coverage } });
      events.push(`cutout b-roll: item ${i + 1} keeps the speaker over the cutaway (${cut.frames} frames matted)`);
    }
  }
  return { broll: planned, events };
}
