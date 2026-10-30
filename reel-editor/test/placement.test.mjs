import { test } from "node:test";
import assert from "node:assert/strict";
import { headExtent, placeHook, zoomDuring, hookBlockHeight, captionsRepeatingHook, cardHeadTop, headBoxFor, placeProgressRail } from "../src/placement.mjs";
import { cleanText } from "../src/captions.mjs";

const words = (s) => s.split(" ").map((text) => ({ text, key: text.startsWith("*") }));
const fontPx = Math.round(0.052 * 1920 * 1.08);

// Real Vision boxes from Greg's clips (fractions of the frame, origin top-left).
const selfie = { frames: [{ faces: [{ x: 0.316, y: 0.329, w: 0.433, h: 0.244 }], bodies: [{ x: 0.043, y: 0.259, w: 0.944, h: 0.737 }] }] };
const wide = { frames: [{ faces: [{ x: 0.44, y: 0.22, w: 0.087, h: 0.049 }], bodies: [{ x: 0.27, y: 0.187, w: 0.3, h: 0.335 }] }] };

test("close-up selfie: the hook goes above the head", () => {
  const head = headExtent(selfie, { zoom: 1.14 });
  const p = placeHook(head, { words: words("The 10 minutes after a bad number"), fontPx });
  assert.equal(p.zone, "above");
  assert.ok(p.position + hookBlockHeight(words("The 10 minutes after a bad number"), { fontPx: fontPx * p.fontScale }) <= head.top, "block ends above the head");
});

test("hook plaque layout moves up and shrinks until its solid field clears the head", async () => {
  const { plaqueLayout } = await import("../src/hook.mjs");
  const { BLOCK_HOOKS } = await import("../src/placement.mjs");
  const copy = words("Your team does not remember the meeting");
  const fit = plaqueLayout(copy, { headTop: 0.245, fontSizeFrac: 0.07, W: 1080, H: 1920 });
  const metrics = BLOCK_HOOKS.plaque;
  const height = hookBlockHeight(copy, { W: 1080, H: 1920, fontPx: Math.round(fit.fontSizeFrac * 1920 * metrics.em), charEm: metrics.charEm, lineHeight: metrics.lineHeight, padEm: metrics.padEm, goldScale: 1 });
  const top = fit.position;
  assert.ok(fit.fontSizeFrac < 0.07, "a tight top third shrinks the plaque");
  assert.ok(top >= 0.03);
  assert.ok(top + height <= 0.245 - 0.015 + 0.001, "the plaque ends above the expanded head gap");
  assert.equal(plaqueLayout(copy, { headTop: null, fontSizeFrac: 0.07 }), null, "no face keeps the preset position");
});

test("wide shot: the hook goes between the chin and the captions", () => {
  const head = headExtent(wide, { zoom: 1.14 });
  const p = placeHook(head, { words: words("Running late? Stay out of the meeting"), fontPx });
  assert.equal(p.zone, "below");
  assert.ok(p.position > head.bottom && p.position < 0.68);
});

test("nobody in frame keeps the default position", () => {
  assert.equal(headExtent({ frames: [{ faces: [], bodies: [] }] }), null);
  assert.deepEqual(placeHook(null, { words: words("a b c"), fontPx, defaultPosition: 0.22 }), { position: 0.22, fontScale: 1, zone: "fallback" });
});

test("zoomDuring takes the strongest zoom while the hook is up", () => {
  assert.equal(zoomDuring([{ t: 0.43, scale: 1.14 }, { t: 6, scale: 1 }], 0, 3), 1.14);
  assert.equal(zoomDuring([{ t: 4, scale: 1.22 }], 0, 3), 1);
});

test("an automatic hook hides the caption lines that repeat it; a written hook hides nothing", () => {
  const groups = [
    { start: 0, words: words("Your team doesn't") },
    { start: 0.8, words: words("remember your meeting.") },
    { start: 2.2, words: words("They remember the") },
    { start: 3.5, words: words("your meeting again") },
  ];
  const hook = { text: "Your team doesn't remember your meeting", start: 0, duration: 3, auto: true };
  assert.deepEqual([...captionsRepeatingHook(groups, hook)], [0, 1]);
  assert.equal(captionsRepeatingHook(groups, { ...hook, auto: false }).size, 0);
});

test("captions drop quotation marks", () => {
  assert.equal(cleanText('"Hey, Vin,'), "Hey, Vin");
  assert.equal(cleanText("“That’s on the table.”"), "That’s on the table");
});

test("captions sit under the chin, capped low, at the safe line on wide shots, default without a face", async () => {
  const { placeCaptions } = await import("../src/placement.mjs");
  const close = placeCaptions({ top: 0.22, bottom: 0.68 }, { fontSizeFrac: 0.04 });
  assert.equal(close.zone, "below-chin");
  assert.ok(close.position > 0.68 && close.position <= 0.76, String(close.position));
  assert.ok(close.top > 0.68, "the block starts under the chin");
  const low = placeCaptions({ top: 0.3, bottom: 0.8 }, { fontSizeFrac: 0.04 });
  assert.deepEqual([low.position, low.zone], [0.76, "capped"]);
  const wide = placeCaptions({ top: 0.1, bottom: 0.35 }, { fontSizeFrac: 0.04 });
  assert.deepEqual([wide.position, wide.zone], [0.56, "safe-zone"]);
  assert.deepEqual(placeCaptions(null, { defaultPosition: 0.6 }).position, 0.6);
});

test("progress placement uses the clear band, falls back to the empty side, or skips when neither fits", async () => {
  const { placeProgressRail } = await import("../src/placement.mjs");
  const band = placeProgressRail({ hookTop: 0.12, hookBottom: 0.3, captionTop: 0.7 });
  assert.deepEqual([band.orientation, band.x, band.x + band.w], ["horizontal", 86, 900]);
  const side = placeProgressRail({ hookTop: 0.12, hookBottom: 0.3, captionTop: 0.72, side: "right", face: { cx: 0.42, cy: 0.47, w: 0.3, h: 0.32 } });
  assert.equal(side.orientation, "vertical");
  assert.ok(side.x >= 680 && side.x + side.w <= 940);
  const skip = placeProgressRail({ hookTop: 0.1, hookBottom: 0.58, captionTop: 0.64, side: "right", face: { cx: 0.82, cy: 0.62, w: 0.3, h: 0.5 } });
  assert.equal(skip.skip, true);
  assert.match(skip.reason, /gap|face|rail/);
});

test("cards never cover the head: the head top under a card uses the strongest zoom in its window and the base slide", () => {
  const zooms = [{ t: 0, scale: 1 }, { t: 6, scale: 1.08 }, { t: 9, scale: 1 }];
  const still = cardHeadTop(selfie, { zooms, t0: 1, t1: 4 });
  const cut = cardHeadTop(selfie, { zooms, t0: 5, t1: 8 });
  assert.equal(still, headExtent(selfie).top + 0, "no zoom in the window: the plain head top");
  assert.ok(cut < still, "a jump cut 8% tighter inside the window lifts the head, so the card must clear more");
  assert.equal(cardHeadTop(selfie, { zooms, t0: 1, t1: 4, shift: 0.05 }), Math.round((still + 0.05) * 1000) / 1000, "the base framing slide moves it");
  assert.equal(cardHeadTop(null, { zooms, t0: 1, t1: 4 }), null, "no face: no measurement, the page keeps its fixed drop");
});

test("the progress rail clears the whole head, hair included, not just the face box", () => {
  // Vision's face box starts near the hairline; the head box starts at the top of the upper body (the crown).
  const face = { cx: 0.5, cy: 0.47, w: 0.3, h: 0.14 };
  const det = { frames: [{ faces: [{ x: 0.35, y: 0.40, w: 0.3, h: 0.14 }], bodies: [{ x: 0.2, y: 0.36, w: 0.6, h: 0.6 }] }] };
  const head = headBoxFor(face, det, { zoom: 1.1 });
  assert.ok(head.cy - head.h / 2 < face.cy - face.h / 2, "the head box starts above the face box");
  assert.ok(head.w > face.w, "and is wider");
  // The default band is y 820-990 px. The face box starts at 1027 px, so the face-only check let the band through,
  // but the crown (top of the upper body, 0.47) reaches up into the band: the head check moves or skips it.
  const args = { W: 1080, H: 1920, hookTop: 0.1, hookBottom: 0.2, captionTop: 0.68, side: "right" };
  const lowFace = { cx: 0.5, cy: 0.585, w: 0.16, h: 0.1 };
  assert.equal(placeProgressRail({ ...args, face: lowFace }).orientation, "horizontal");
  const withHead = placeProgressRail({ ...args, face: headBoxFor(lowFace, { frames: [{ faces: [{ x: 0.42, y: 0.535, w: 0.16, h: 0.1 }], bodies: [{ x: 0.25, y: 0.47, w: 0.5, h: 0.5 }] }] }, { zoom: 1.1 }) });
  assert.notEqual(withHead.orientation, "horizontal", "the band would sit on the hair, so it moves or is skipped");
});

test("the progress rail goes to the top of the frame when the head fills the middle (Clip 5 framing)", () => {
  // Head 44.5%-60.5% of the frame, hook at 32%, captions at 66%: the middle band sits on the head and the side strip
  // has no 300 px gap, so before the top band the rail was skipped (and before the head check it covered the head).
  const head = { cx: 0.5, cy: 0.525, w: 0.3, h: 0.16 };
  const args = { W: 1080, H: 1920, hookTop: 0.319, hookBottom: 0.42, captionTop: 0.66, face: head, side: "right" };
  const p = placeProgressRail(args);
  assert.equal(p.at, "top");
  assert.equal(p.y, 200, "under Instagram's top bar");
  assert.ok(p.y + p.h + 24 <= 0.319 * 1920, "above the hook");
  assert.ok(p.y + p.h < (head.cy - head.h / 2) * 1920, "and above the head");
  assert.equal(placeProgressRail({ ...args, hookTop: 0.12, hookBottom: 0.22 }).skip, true, "a hook at the top leaves no room up there either");
});

test("plaqueLayout moves a squeezed hook between the chin and the captions at full size", async () => {
  const { plaqueLayout } = await import("../src/hook.mjs");
  const copy = "90 % der Paare verstehen nicht dass ihre Beziehung nicht von alleine".split(" ").map((text) => ({ text }));
  const fit = plaqueLayout(copy, { headTop: 0.12, headBottom: 0.38, captionTop: 0.6, fontSizeFrac: 0.041, W: 1080, H: 1920 });
  assert.equal(fit.zone, "below");
  assert.equal(fit.fontSizeFrac, 0.041);
  assert.ok(fit.position >= 0.38 && fit.position < 0.6);
  const roomy = plaqueLayout(copy.slice(0, 5), { headTop: 0.4, headBottom: 0.7, captionTop: 0.75, fontSizeFrac: 0.041, W: 1080, H: 1920 });
  assert.equal(roomy.zone, "above");
});
