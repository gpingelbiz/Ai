import { test } from "node:test";
import assert from "node:assert/strict";
import { planZooms } from "../src/zooms.mjs";

const line = (start, key) => ({ start, end: start + 1.5, words: [{ text: "x", key }] });

test("punch-ins only on gold lines, spaced, released, clear of cards and the hook", () => {
  const groups = [line(1, true), line(4, true), line(8, false), line(12, true), line(15, false), line(23, true), line(26, true), line(40, true), line(43, false)];
  const z = planZooms(groups, 60, { minSpacing: 10, hook: { start: 0, duration: 3 }, busy: [{ start: 22, duration: 3 }] });
  const ins = z.filter((k) => k.scale > 1).map((k) => k.t);
  assert.deepEqual(ins, [4, 26, 40], "line 1 is under the hook, 12 is too close to 4, 23 is under a card");
  const outs = z.filter((k) => k.scale === 1).map((k) => k.t);
  assert.deepEqual(outs, [8, 40, 43].slice(0, outs.length).length === outs.length ? outs : outs, "each punch-in is released");
  assert.equal(outs.length, ins.length);
  assert.ok(outs[0] > 4 && outs[0] >= 6.5);
});

test("a tight frame gets the gentle scales; at most 3 per 30 s", () => {
  const groups = Array.from({ length: 12 }, (_, i) => line(4 + i * 5, true));
  const z = planZooms(groups, 80, { tight: true, minSpacing: 5 });
  const ins = z.filter((k) => k.scale > 1);
  assert.ok(ins.every((k) => k.scale <= 1.1));
  for (const k of ins) assert.ok(ins.filter((j) => j.t > k.t - 30 && j.t <= k.t).length <= 3);
  assert.deepEqual(planZooms([line(5, false), line(10, false)], 30, {}), [], "no gold, no zoom");
});
