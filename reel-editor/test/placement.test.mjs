import { test } from "node:test";
import assert from "node:assert/strict";
import { headExtent, placeHook, zoomDuring, hookBlockHeight, captionsRepeatingHook } from "../src/placement.mjs";
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
