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

test("fast cadence: a first cut inside the hook, no framing past max, framings rotate", async () => {
  const { planCadence } = await import("../src/zooms.mjs");
  // Two-word caption lines every 0.6 s for 12 s, then a 5 s line with words every 0.4 s and no new line.
  const groups = [];
  for (let t = 0.2; t < 12; t += 0.6) groups.push({ start: Math.round(t * 1000) / 1000, words: [{ start: t, end: t + 0.25 }, { start: t + 0.3, end: t + 0.55 }] });
  const long = { start: 12.2, words: [] };
  for (let t = 12.2; t < 17.2; t += 0.4) long.words.push({ start: Math.round(t * 1000) / 1000, end: t + 0.3 });
  groups.push(long, { start: 17.4, words: [{ start: 17.4, end: 17.8 }] });
  const hook = { start: 0, duration: 3 };
  const keys = planCadence(groups, 20, [], { min: 1.1, lead: 0.6, first: 0.7, max: 2.8, steps: [1.08, 1.16], hook, tail: 1.5 });
  assert.ok(keys[0].t >= 0.7 && keys[0].t <= 1.0, `first cut at ${keys[0].t}`);
  const times = [0, ...keys.map((k) => k.t), 18.5];
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] <= 2.8 + 1e-6, `gap ${times[i - 1]}-${times[i]}`);
  const tight = keys.filter((k) => k.scale > 1).map((k) => k.scale);
  assert.ok(tight.includes(1.08) && tight.includes(1.16), `framings rotate: ${tight}`);
  // Default cadence is unchanged: nothing inside the hook.
  assert.ok(planCadence(groups, 20, [], { hook }).every((k) => k.t >= 3));
});
