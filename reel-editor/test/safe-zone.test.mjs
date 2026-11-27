import test from "node:test";
import assert from "node:assert/strict";
import { SAFE_ZONE, zoneFor, rightLimit, centredWidth } from "../src/safe-zone.mjs";
import { GATE_SAFE, layerMask, safeZoneSpill } from "../src/gate.mjs";
import { readFrame, placeCard, openSpaces } from "../src/frame-place.mjs";
import { placeProOverlay, proCaptionBox, proHookBox } from "../src/pro.mjs";
import { PRO_CAPTION_LINE, PRO_HOOK_LINE, proLineBreaks } from "../src/pro-captions.mjs";
import { planWindowLayout, planPersistentLayout } from "../src/layouts.mjs";
import { SAFE, CARD_RULES } from "../src/preflight.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";

const W = 1080, H = 1920;
const Z = zoneFor(W, H);

/** A real gate mask for a box painted white on a black frame (the gate's own pixel reader). */
function boxMask(rects) {
  const paint = (list) => {
    const data = new Uint8Array(W * H * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    for (const { x, y, w, h } of list) {
      for (let yy = Math.max(0, Math.round(y)); yy < Math.min(H, Math.round(y + h)); yy++) {
        for (let xx = Math.max(0, Math.round(x)); xx < Math.min(W, Math.round(x + w)); xx++) data.set([255, 255, 255], (yy * W + xx) * 4);
      }
    }
    return { width: W, height: H, data };
  };
  return layerMask(paint(rects), paint([]));
}
const spill = (box) => safeZoneSpill(boxMask([box]));

/** The box lies inside the shared zone: side strips, the bottom strip and, in the column's rows, the button column. */
const inside = (b) => b.x >= Z.left - 0.5 && b.x + b.w <= rightLimit(Z, b.y, b.y + b.h) + 0.5 && b.y + b.h <= Z.bottom + 0.5;

test("one zone: 150 px side strips, the TikTok-wide button column from 35% down, the same numbers in the gate and preflight", () => {
  assert.equal(SAFE_ZONE.side, 150);
  assert.equal(SAFE_ZONE.rail, 180);
  assert.equal(SAFE_ZONE.railTop / SAFE_ZONE.height, 0.35);
  assert.deepEqual([Z.left, Z.right, Z.railX, Z.railTop, Z.bottom], [150, 930, 900, 672, 1600]);
  // The gate reads the same zone with a few pixels of measuring slack, never a different zone.
  assert.ok(Math.abs(GATE_SAFE.left - Z.left) <= 6 && Math.abs(GATE_SAFE.right - Z.right) <= 6 && Math.abs(GATE_SAFE.iconRight - Z.railX) <= 6);
  assert.equal(GATE_SAFE.iconFrom, 0.35);
  assert.ok(GATE_SAFE.iconTo >= GATE_SAFE.bottom, "the column runs down to the bottom strip");
  assert.equal(Math.round(GATE_SAFE.bottom * H), Z.bottom);
  assert.equal(CARD_RULES.left, 150);
  assert.equal(CARD_RULES.right, 930);
  assert.equal(SAFE.rightFrom, 0.35);
  // Scales with the canvas.
  const half = zoneFor(540, 960);
  assert.deepEqual([half.left, half.right, half.railX, half.railTop], [75, 465, 450, 336]);
  assert.equal(rightLimit(Z, 200, 600), 930, "above the column's rows only the side strip applies");
  assert.equal(rightLimit(Z, 200, 800), 900, "reaching the column's rows ends at the column");
  assert.equal(centredWidth(Z, 1200, 1400), 720);
  assert.equal(centredWidth(Z, 150, 450), 780);
});

test("the gate flags what the old zone let through: x 100, and the right column at 40% of the height", () => {
  assert.deepEqual(spill({ x: 100, y: 300, w: 400, h: 200 }).edges, ["left"]);
  assert.deepEqual(spill({ x: 560, y: 0.4 * H, w: 360, h: 200 }).edges, ["buttons"], "x 920 at 40% is under the button column");
  assert.deepEqual(spill({ x: 560, y: 300, w: 360, h: 200 }).edges, [], "the same card above the column's rows is clear");
  assert.deepEqual(spill({ x: 150, y: 0.4 * H, w: 750, h: 300 }).edges, [], "a box exactly on the zone passes");
});

// Speakers on the right, centred and on the left (the left one leaves the right column at 40% of the height open).
const det = (face, body) => ({ frames: [0, 1, 2].map((t) => ({ t, faces: [face], bodies: [body] })) });
const SHOTS = {
  right: det({ x: 0.55, y: 0.22, w: 0.24, h: 0.14 }, { x: 0.45, y: 0.18, w: 0.45, h: 0.6 }),
  centre: det({ x: 0.36, y: 0.3, w: 0.28, h: 0.16 }, { x: 0.2, y: 0.26, w: 0.6, h: 0.6 }),
  left: det({ x: 0.14, y: 0.3, w: 0.24, h: 0.14 }, { x: 0.04, y: 0.26, w: 0.45, h: 0.6 }),
};

test("frame placement offers only spots inside the zone the gate checks, so a placed card is never dropped for the edges", () => {
  for (const [name, d] of Object.entries(SHOTS)) {
    const f = readFrame(d, { captionTop: 0.68 });
    for (const sp of openSpaces(f, { behind: true })) assert.ok(inside(sp.space), `${name}: ${sp.slot} ${sp.side} ${JSON.stringify(sp.space)} stays in the zone`);
    for (const card of [{ type: "stat" }, { type: "compare", eyebrow: "X" }, { type: "list", items: [{}, {}, {}], title: "A short line here" }]) {
      const p = placeCard(card, f);
      assert.ok(p, `${name}: a ${card.type} card still finds a spot`);
      if (p.slot === "full") continue;
      assert.ok(inside(p), `${name}: ${card.type} at ${p.slot} ${p.side} ${JSON.stringify({ x: p.x, y: p.y, w: p.w, h: p.h })}`);
      assert.deepEqual(spill(p).edges, [], `${name}: the gate passes the ${card.type} card where placement put it`);
    }
  }
});

test("a card that used to land at x 100 or in the right column at 40% is placed clear of both instead", () => {
  // Speaker on the right: the left column was 64 px wide of the edge before; now it starts at 150.
  const right = readFrame(SHOTS.right, { captionTop: 0.68 });
  const a = placeCard({ type: "stat" }, right, { pin: "side" });
  assert.ok(a && a.slot === "side" && a.side === "left");
  assert.ok(a.x >= 150, `x ${a.x}`);
  // Speaker on the left: the right side column reaches past 40% of the height, so it ends at the button column.
  const left = readFrame(SHOTS.left, { captionTop: 0.68 });
  const b = placeCard({ type: "stat" }, left, { pin: "side" });
  assert.ok(b && b.side === "right");
  assert.ok(b.x + b.w <= rightLimit(Z, b.y, b.y + b.h), `right edge ${b.x + b.w} at y ${b.y}-${b.y + b.h}`);
  assert.deepEqual(spill(b).edges, []);
});

test("pro cards are placed inside the same zone: side strips, the column from 35% down, and the bottom strip at 1600", () => {
  const base = { measured: true, W, H, caption: { x: 0, y: 1080, w: W, h: 220 } };
  let placed = 0;
  for (const head of [{ x: 330, y: 420, w: 420, h: 520 }, { x: 600, y: 360, w: 380, h: 480 }, { x: 120, y: 360, w: 380, h: 480 }, { x: 360, y: 560, w: 360, h: 440 }]) {
    const recent = [];
    for (const type of ["correction", "compare", "steps", "stat"]) {
      for (const opts of [{}, { ignoreMic: true, minScale: 0.5 }, { ignoreMic: true, captionSwap: true }]) {
        const p = placeProOverlay({ type }, { ...base, head }, { ...opts, recent });
        if (!p) continue;
        placed++;
        recent.push(p.spot);
        assert.ok(inside(p), `${type} ${p.spot} at head x ${head.x}: ${JSON.stringify({ x: p.x, y: p.y, w: p.w, h: p.h })}`);
        assert.deepEqual(spill(p).edges, [], `${type} ${p.spot}: the gate passes it`);
      }
    }
  }
  assert.ok(placed > 20, `${placed} pro cards placed`);
  // A speaker on the left leaves the right column at 40% open: the card is placed beside the head, clear of the buttons.
  const p = placeProOverlay({ type: "stat" }, { ...base, head: { x: 120, y: 360, w: 380, h: 480 } });
  assert.ok(p && p.x + p.w <= 900 + 0.5, JSON.stringify(p));
});

test("pro caption and hook plates stay inside the zone; a long line splits, never wraps to a third line", () => {
  assert.equal(PRO_CAPTION_LINE, 672);
  assert.equal(PRO_HOOK_LINE, 732);
  for (const y of [1248, 900, 1300]) {
    const box = proCaptionBox({ y, lines: [3, 3] });
    assert.ok(inside(box), JSON.stringify(box));
    assert.ok(box.x >= 150 && box.x + box.w <= 900);
  }
  const hook = proHookBox({ fontSize: 100, lines: [3, 3] });
  assert.ok(hook.x >= 150 && hook.x + hook.w <= 930, JSON.stringify(hook));
  // 52 px per character: 12 characters fit one 672 px line ("Sales Sales" is 11), so three words need two lines.
  const measure = (t) => t.length * 52;
  const ws = (n) => Array.from({ length: n }, () => ({ text: "Sales" }));
  assert.equal(proLineBreaks(ws(2), { measure }).length, 1);
  assert.equal(proLineBreaks(ws(3), { measure }).length, 2);
  assert.equal(proLineBreaks(ws(5), { measure }), null, "null asks the splitter for fewer words; there is no third line");
});

test("b-roll windows and teaching panels keep clear of the side strips and of the column in its rows", () => {
  const detection = { frames: [{ t: 0, faces: [{ x: 0.12, y: 0.3, w: 0.22, h: 0.12 }] }] };
  const face = { cx: 0.23, cy: 0.36, w: 0.22, h: 0.12 };
  const win = planWindowLayout({ start: 0, duration: 3 }, { W, H, captionTop: 0.68, face, detection });
  if (win.shot.panel) assert.ok(inside(win.shot.panel), JSON.stringify(win.shot.panel));
  const panel = planPersistentLayout({ start: 0, duration: 3, type: "ladder", rungs: [1, 2, 3, 4, 5, 6] }, { W, H, captionTop: 0.68, face, detection, brand: { typeScale: { md: 40 }, spacing: { xs: 8, sm: 12, md: 24 } } });
  if (panel.placement) assert.ok(inside(panel.placement), JSON.stringify(panel.placement));
});

test("normal captions, hooks and the CTA on a vertical reel take the zone's margins even when a look asks for narrower ones", () => {
  const style = loadPreset("pingel-brand");
  style.glow = { ...style.glow, enabled: false };
  style.captions = { ...style.captions, pro: false, sideMarginFrac: 0.07, rightMarginFrac: 0.12 };
  style.hook = { ...style.hook, pro: false, plaque: false, position: 0.12 };
  const plan = {
    name: "t", preset: "pingel-brand", canvas: { width: W, height: H }, style, video: { duration: 10, width: W, height: H },
    words: [], captions: [{ start: 0, end: 1, text: "hello there", words: [{ text: "hello", start: 0, end: 0.5 }, { text: "there", start: 0.5, end: 1 }] }],
    hook: { text: "A hook", start: 0, duration: 2 }, cta: { text: "Comment GAME", start: 8, duration: 2, position: 0.62 },
    zooms: [], graphics: [], slams: [], icons: [],
  };
  const html = renderHTML(plan, "footage.mp4");
  const cap = html.match(/\.cap \{\s*position: absolute; left: ([\d.]+)%; right: ([\d.]+)%;/);
  assert.ok(cap, "caption CSS found");
  assert.ok(Number(cap[1]) >= 13.888 && Number(cap[2]) >= 16.666, `captions ${cap[1]}% / ${cap[2]}%`);
  const hook = html.match(/#hook-block \{ position: absolute; left: ([\d.]+)%; right: ([\d.]+)%;/);
  assert.ok(hook && Number(hook[1]) >= 13.888 && Number(hook[2]) >= 13.888, `hook ${hook?.[1]}%`);
  const cta = html.match(/#cta \{[^}]*padding: \d+px ([\d.]+)% 0;/);
  assert.ok(cta && Number(cta[1]) >= 16.666, `CTA ${cta?.[1]}%: it sits in the column's rows, centred`);
  // A landscape canvas has no platform overlay: the look's own margins stand.
  const wide = renderHTML({ ...plan, canvas: { width: H, height: W }, video: { ...plan.video, width: H, height: W } }, "footage.mp4");
  assert.match(wide, /\.cap \{\s*position: absolute; left: 7%; right: 12%;/);
});
