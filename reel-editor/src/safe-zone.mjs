/**
 * The one safe zone every vertical reel is placed in and checked against. Placement (frame-place, the pro cards,
 * b-roll windows, the bold look), the captions, hooks and CTAs, preflight and the master gate all read these numbers,
 * so a card is put somewhere clear the first time instead of being dropped at the gate.
 *
 * Why these numbers (Greg 11-26, "Ok so those 3 things"): every reel now also posts to TikTok and Facebook, and the old
 * zone was Instagram's alone.
 *   side  150 px down each side stays clear (a Brian Mark reel marks ~150 px dead strips; the old zone was 64-76 px).
 *   rail  the right button column: TikTok's is wider (about 180 px measured from its in-feed template, Instagram's
 *         about 134) and starts higher, so nothing reaches into it from 35% of the height down to the bottom strip.
 *   top / bottom  the top bar (7%) and the caption, handle and audio strip (from 1600 px down), as before.
 * Reference pixels are for 1080x1920; zoneFor scales them to the canvas. A landscape canvas has no overlay at all.
 */
export const SAFE_ZONE = Object.freeze({
  width: 1080,
  height: 1920,
  side: 150,      // px kept clear at the left and right edges
  top: 134,       // px under the top bar (7%)
  bottom: 1600,   // px where the bottom strip starts (83.3%)
  rail: 180,      // px width of the right button column
  railTop: 672,   // px where the column starts (35%)
});

/** The zone in canvas pixels: { W, H, left, right, top, bottom, railX, railTop }. right/railX are x positions. */
export function zoneFor(W = SAFE_ZONE.width, H = SAFE_ZONE.height, zone = SAFE_ZONE) {
  const sx = W / zone.width, sy = H / zone.height;
  return { W, H, left: zone.side * sx, right: W - zone.side * sx, top: zone.top * sy, bottom: zone.bottom * sy, railX: W - zone.rail * sx, railTop: zone.railTop * sy };
}

/** The right-hand limit for something spanning y0..y1: the button column's edge once it reaches the column's rows. */
export function rightLimit(z, y0, y1) {
  return y1 > z.railTop && y0 < z.bottom ? Math.min(z.right, z.railX) : z.right;
}

/** The widest box centred on the frame that stays clear of both side strips and, at those rows, the button column. */
export function centredWidth(z, y0, y1) {
  const mid = z.W / 2;
  return 2 * Math.max(0, Math.min(mid - z.left, rightLimit(z, y0, y1) - mid));
}

/** Side margins as fractions of the width, for CSS left/right: centred text in the column rows uses the rail on both sides. */
export function marginFractions(z = zoneFor(), { centred = false, rail = true } = {}) {
  const left = z.left / z.W, right = (z.W - (rail ? Math.min(z.right, z.railX) : z.right)) / z.W;
  return centred ? { left: Math.max(left, right), right: Math.max(left, right) } : { left, right };
}
