import test from "node:test";
import assert from "node:assert/strict";
import { readFrame, placeCard, placeSequence, openSpaces, fitScale, cardFootprint, overlaps, busyFromGray, busyUnder, viewFor, planPlacements } from "../src/frame-place.mjs";
import { placedGraphicsJS, GRAPHICS_JS, STRUCTURE_GRAPHICS_JS, graphicsCSS } from "../src/graphics.mjs";
import { placeGlowOverlays } from "../src/glow.mjs";

// A seated speaker on the right of a wide shot, a centred close-up, and a tight crop with the head at the top.
const det = (face, body) => ({ frames: [0, 1, 2].map((t) => ({ t, faces: face ? [face] : [], bodies: body ? [body] : [] })) });
const RIGHT = det({ x: 0.55, y: 0.22, w: 0.24, h: 0.14 }, { x: 0.45, y: 0.18, w: 0.45, h: 0.6 });
const CENTER = det({ x: 0.36, y: 0.3, w: 0.28, h: 0.16 }, { x: 0.2, y: 0.26, w: 0.6, h: 0.6 });
const TIGHT = det({ x: 0.22, y: 0.06, w: 0.56, h: 0.32 }, { x: 0.05, y: 0.02, w: 0.9, h: 0.9 });
const frameOf = (d, extra = {}) => readFrame(d, { captionTop: 0.68, ...extra });

const clear = (p, f) => p.slot === "full" || (!overlaps(p, f.head, 0) && !overlaps(p, f.caption, 0));

test("readFrame maps the head through the framing and punch-in, and the captions into a band", () => {
  const f = frameOf(RIGHT);
  assert.ok(f.measured);
  assert.ok(f.head.x > 540 && f.head.y < 0.22 * 1920);
  const z = readFrame(RIGHT, { view: viewFor({ framing: { scale: 1.2, origin: "50% 40%" } }) });
  assert.ok(z.head.w > f.head.w, "a punch-in makes the head bigger");
  assert.ok(f.caption.y < 0.68 * 1920 && f.caption.y + f.caption.h > 0.72 * 1920);
  assert.equal(readFrame(null).measured, false);
});

test("a card beside a speaker on the right goes to the empty left side, smaller than full width", () => {
  const f = frameOf(RIGHT);
  const p = placeCard({ type: "stat" }, f);
  assert.equal(p.slot, "side");
  assert.equal(p.side, "left");
  assert.ok(p.scale <= 0.85 && p.w < 700);
  assert.ok(clear(p, f));
  assert.ok(!p.drop, "no push-down when there is room");
});

test("never on the face or the captions, for every card type and every shot", () => {
  for (const d of [RIGHT, CENTER, TIGHT]) {
    const f = frameOf(d);
    for (const type of ["stat", "headline", "list", "steps", "compare", "bars", "quote", "message", "post", "chapter"]) {
      const p = placeCard({ type, items: [{}, {}, {}], eyebrow: "X", title: "A short line here" }, f);
      assert.ok(p, `${type} gets a placement`);
      if (p.slot === "push") {
        assert.ok(p.y + p.h + 0.02 * 1920 - 1 <= f.head.y + p.drop, `${type} push clears the head`);
      } else assert.ok(clear(p, f), `${type} on ${JSON.stringify(f.head)} → ${JSON.stringify(p)}`);
    }
  }
});

test("a tight crop with no room anywhere gets a full-screen card, not a push that would shove the head off", () => {
  const f = frameOf(TIGHT);
  const p = placeCard({ type: "compare", eyebrow: "X" }, f);
  assert.ok(["full", "lower", "push"].includes(p.slot));
  assert.notEqual(p.slot, "side");
});

test("a sequence of cards in one shot never repeats one spot back to back when another fits", () => {
  const f = frameOf(RIGHT);
  const cards = ["stat", "headline", "list", "quote", "stat"].map((type) => ({ type, items: [{}, {}], title: "Two words" }));
  const placed = placeSequence(cards, cards.map(() => f));
  for (let i = 1; i < placed.length; i++) assert.notDeepEqual([placed[i].slot, placed[i].side], [placed[i - 1].slot, placed[i - 1].side], `card ${i} repeats ${placed[i].slot}`);
  assert.ok(new Set(placed.map((p) => p.slot)).size >= 3, placed.map((p) => p.slot).join(","));
});

test("push-down is never the default: it only wins when nothing clear fits and it beats full screen", () => {
  for (const d of [RIGHT, CENTER]) assert.notEqual(placeCard({ type: "stat" }, frameOf(d)).slot, "push");
});

test("a preset can pin a fixed spot", () => {
  const f = frameOf(RIGHT);
  const wide = frameOf(det({ x: 0.55, y: 0.42, w: 0.2, h: 0.11 }));
  assert.equal(placeCard({ type: "stat" }, wide, { pin: "top" }).slot, "top");
  assert.equal(placeCard({ type: "stat" }, wide, { pin: ["corner"] }).slot, "corner");
  assert.equal(placeCard({ type: "stat" }, f, { pin: "top" }), null, "a pinned spot with no room returns null: the caller keeps its old layout");
});

test("wide cards (compare, the horizontal step row) never squeeze into a side column", () => {
  const f = frameOf(RIGHT);
  for (const type of ["compare", "bars"]) assert.notEqual(placeCard({ type, items: [{}, {}] }, f).slot, "side");
});

test("fitScale shrinks and wraps a card into a narrow space, and gives up below the floor", () => {
  const foot = cardFootprint({ type: "headline", title: "This is a longer headline line" });
  const wide = fitScale(foot, { w: 864, h: 600 });
  const narrow = fitScale(foot, { w: 420, h: 900 });
  assert.ok(wide.scale === 0.85 && narrow.scale <= 0.85 && narrow.w <= 420);
  assert.equal(fitScale(foot, { w: 200, h: 80 }), null);
});

test("the quiet side wins over the busy side when both fit", () => {
  const cols = 27, rows = 48, px = new Uint8Array(cols * rows);
  // Busy (striped) left half, flat right half.
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) px[y * cols + x] = x < 13 ? (Math.floor(x / 2) % 2) * 255 : 120;
  const busy = busyFromGray(px, cols, rows);
  const noFace = { frames: [{ t: 0, faces: [{ x: 0.44, y: 0.5, w: 0.12, h: 0.06 }], bodies: [] }] };
  const f = readFrame(noFace, { busy, captionTop: 0.8 });
  assert.ok(busyUnder(f, { x: 0, y: 300, w: 400, h: 400 }) > busyUnder(f, { x: 680, y: 300, w: 400, h: 400 }));
  const p = placeCard({ type: "stat" }, f, { history: [{ slot: "top", side: "center" }] });
  if (p.slot === "side") assert.equal(p.side, "right");
});

test("openSpaces with nobody in the frame still offers the top and the middle", () => {
  const spaces = openSpaces(readFrame({ frames: [{ t: 0, faces: [], bodies: [] }] }, { captionTop: 0.7 }));
  assert.ok(spaces.some((s) => s.slot === "top"));
});

test("planPlacements samples each card's own window and skips cards with no detection", async () => {
  const asked = [];
  const detect = async (_v, times) => { asked.push(times); return times[0] > 10 ? null : RIGHT; };
  const { placements, log } = await planPlacements([{ type: "stat", start: 2, duration: 3 }, { type: "list", start: 12, duration: 3, items: [{}, {}] }], { video: "x.mp4", detect, busy: async () => null });
  assert.equal(asked.length, 2);
  assert.ok(asked[0].every((t) => t >= 2 && t <= 5));
  assert.ok(placements[0] && placements[1] === null);
  assert.match(log, /side left/);
});

test("the placed runtime only moves the footage for a push placement; plans without place keep the old runtime", () => {
  for (const base of [GRAPHICS_JS, STRUCTURE_GRAPHICS_JS]) {
    const js = placedGraphicsJS(base);
    assert.equal((js.match(/if \(!placed\) tl\.to\("#video-wrap"/g) || []).length, 6);
    assert.match(js, /placed === "push" && g\.place\.drop/);
    // The page's own regex survives the template literal (an unescaped one counted every element as painted).
    assert.ok(js.includes(String.raw`/^rgba\(.*, 0\)$/`));
    assert.doesNotThrow(() => new Function("PLAN", "tl", "gsap", "document", js));
  }
  assert.doesNotMatch(GRAPHICS_JS, /placeCardBox/);
  assert.doesNotMatch(graphicsCSS({ W: 1080, H: 1920, colors: {} }), /gfx-placed/);
  assert.match(graphicsCSS({ W: 1080, H: 1920, colors: {}, placed: true }), /gfx-full/);
});

test("glow overlays move off the chin band when it is cramped and vary their spot", () => {
  const frames = Array.from({ length: 40 }, (_, k) => ({ t: k * 0.25, faces: [{ x: 0.5, y: 0.25, w: 0.3, h: 0.3 }], bodies: [] }));
  const over = (start, extra = {}) => ({ type: "notify", start, end: start + 1.5, words: [], place: { x: 76, y: 1100, w: 670 }, ...extra });
  const out = placeGlowOverlays([over(1, { cramped: true }), over(4), over(7)], { frames });
  assert.equal(out.length, 3);
  for (const o of out) assert.ok(o.place.slot && o.place.scale <= 1);
  assert.notDeepEqual([out[0].place.slot, out[0].place.side], [out[1].place.slot, out[1].place.side]);
  assert.equal(placeGlowOverlays([over(1, { cramped: true })], null).length, 0, "without detection a cramped overlay is still left out");
});

test("behind the speaker: allowed only with a matte, only partly hidden, and never in front of the head", () => {
  // A centred close-up: no side room, little headroom. Behind lets a card tuck under the hair line.
  const close = frameOf(det({ x: 0.3, y: 0.2, w: 0.4, h: 0.2 }, { x: 0.15, y: 0.18, w: 0.7, h: 0.8 }));
  const without = placeCard({ type: "stat" }, close, { allowFull: false });
  const withB = placeCard({ type: "stat" }, close, { allowBehind: true, allowFull: false, pin: "behind" });
  assert.notEqual(without?.slot, "behind");
  assert.equal(withB.slot, "behind");
  const hidden = (() => { const h = close.head; const w = Math.min(withB.x + withB.w, h.x + h.w) - Math.max(withB.x, h.x); const t = Math.min(withB.y + withB.h, h.y + h.h) - Math.max(withB.y, h.y); return w > 0 && t > 0 ? (w * t) / (withB.w * withB.h) : 0; })();
  assert.ok(hidden > 0 && hidden <= 0.3, `hidden ${hidden}`);
  assert.ok(!overlaps(withB, close.caption, 0));
});

test("a card carries its next best clear spots, and small-type cards keep a higher reading floor", () => {
  const f = frameOf(RIGHT);
  const p = placeCard({ type: "stat" }, f);
  assert.ok(p.alts?.length >= 1, "alternates for the page");
  for (const a of p.alts) {
    assert.notDeepEqual([a.slot, a.side], [p.slot, p.side]);
    assert.ok(a.space && a.layoutW && a.scale);
  }
  assert.equal(cardFootprint({ type: "bars" }).minScale, 0.72);
  assert.equal(cardFootprint({ type: "message", items: [{}, {}] }).minScale, 0.8);
  const js = placedGraphicsJS(GRAPHICS_JS);
  assert.match(js, /for \(const o of \[p, \.\.\.\(p\.alts \|\| \[\]\)\]\)/, "the page walks the alternates");
  assert.match(js, /o\.slot === "behind" && !textClear\(p\.occl\)/, "no word behind the person");
  assert.match(js, /PLAN\.height \* 0\.0135/, "26 px main line floor");
});
