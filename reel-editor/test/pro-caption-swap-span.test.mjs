// 2026-11-28: the first reel with the ghost-editor cards put a 12 s "three examples, then the point" card in the caption
// spot, which hid the captions for 12 s. Only a card whose words take at most PRO_SWAP_SPAN may stand in for them.
import test from "node:test";
import assert from "node:assert/strict";
import { canSwapCaptions, PRO_SWAP_SPAN } from "../src/pro.mjs";

test("a short card may take the caption spot", () => {
  assert.equal(canSwapCaptions({ start: 3.34, complete: 5.74, end: 7.9 }), true);
  assert.equal(canSwapCaptions({ start: 10, complete: 10 + PRO_SWAP_SPAN, end: 18 }), true);
});

test("a long build-up card never hides the captions", () => {
  // The test reel's actions-to-principle card: examples from 4.9 s, the point said at 16.66 s.
  assert.equal(canSwapCaptions({ start: 4.9, complete: 16.664, end: 18.831 }), false);
});

test("a card without a completion time is judged by its end", () => {
  assert.equal(canSwapCaptions({ start: 2, end: 7 }), true);
  assert.equal(canSwapCaptions({ start: 2, end: 9 }), false);
});
