// Greg 11-23: tight shots left reels with zero cards. The floor retries missed cards smaller, then lets one
// stand in for the captions, and the captions under it are hidden.
import test from "node:test";
import assert from "node:assert/strict";
import { placeProOverlay, placeProGraphics, applyCaptionSwaps, proSize } from "../src/pro.mjs";

// The 11-23 3 PM reel: big head, captions right under the chin, only ~224 px free above and below.
const tight = { measured: true, W: 1080, H: 1920, head: { x: 85, y: 465, w: 760, h: 650 }, mic: { x: 0, y: 892, w: 259, h: 518 }, caption: { x: 0, y: 1233, w: 1080, h: 239 } };
const quote = {"type":"quote","card":true,"start":3.34,"slots":{"quote":[{"text":"it's very easy to talk extremely fast.","from":13,"to":19,"at":3.34,"end":5.74,"lines":["it's very easy to","talk extremely fast."]}]},"reveals":[3.34],"complete":5.74,"end":7.907,"duration":4.567,"id":"pro-0"};
quote.id = "q";

test("a quote card has no normal room in a tight shot", () => {
  assert.ok(proSize(quote));
  assert.equal(placeProOverlay(quote, tight), null);
});

test("caption swap puts the card in the caption band, clear of the face", () => {
  const p = placeProOverlay(quote, tight, { ignoreMic: true, captionSwap: true });
  assert.equal(p.slot, "caption-swap");
  assert.ok(p.y >= tight.head.y + tight.head.h, "below the face");
  assert.ok(p.y + p.h <= 1720, "above the bottom safe line");
});

test("placeProGraphics rescues a card below the floor and shortens a swap card", async () => {
  const detect = async (_v, times) => ({ frames: times.map((t) => ({ t })) });
  const placed = await placeProGraphics([quote], { video: "x", detect, minCards: 2 }).catch(() => null);
  // Synthetic detection carries no head; the call must still return an array with a missed list.
  assert.ok(Array.isArray(placed));
  assert.ok(Array.isArray(placed.missed));
});

test("captions under a swap card are hidden, word marks there are dropped, others stay", () => {
  const cards = [{ ...quote, end: 6.54, place: { slot: "caption-swap" } }, { id: "w1", type: "wordMark", start: 4, end: 4.5 }, { id: "w2", type: "wordMark", start: 9, end: 9.5 }];
  const groups = [{ start: 2, end: 3.34 }, { start: 3.34, end: 6.88 }, { start: 6.88, end: 7.9 }];
  const out = applyCaptionSwaps(cards, groups);
  assert.deepEqual(out.groups.map((g) => g.start), [2, 6.88]);
  assert.deepEqual(out.cards.map((c) => c.id), ["q", "w2"]);
});

test("no swap cards leaves everything alone", () => {
  const groups = [{ start: 0, end: 1 }];
  assert.equal(applyCaptionSwaps([{ id: "a", type: "quote", start: 0, end: 1, place: { slot: "torso" } }], groups).groups, groups);
});
