import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReframe, sampleTimes, faceCentres, smoothTrack, objectPositionLane } from "../src/reframe.mjs";

const wide = { width: 1920, height: 1080 }, tall = { width: 1080, height: 1920 };

test("only a wider source gets a reframe", () => {
  assert.ok(needsReframe(wide, tall));
  assert.ok(!needsReframe({ width: 1080, height: 1920 }, tall));
  assert.ok(!needsReframe({ width: 1080, height: 1080 }, { width: 1080, height: 1080 }));
  assert.deepEqual(sampleTimes(1.6, 0.5), [0.1, 0.6, 1.1]);
});

test("the crop follows the biggest face, holds through empty frames, and ignores twitches", () => {
  const det = { frames: [
    { t: 0.1, faces: [{ x: 0.1, y: 0.2, w: 0.1, h: 0.2 }, { x: 0.6, y: 0.2, w: 0.2, h: 0.3 }] },
    { t: 0.6, faces: [] },
    { t: 1.1, faces: [{ x: 0.61, y: 0.2, w: 0.2, h: 0.3 }] },
    { t: 1.6, faces: [{ x: 0.2, y: 0.2, w: 0.2, h: 0.3 }] },
  ] };
  const c = faceCentres(det);
  assert.deepEqual(c.map((p) => Math.round(p.x * 100) / 100), [0.7, 0.7, 0.71, 0.3]);
  const s = smoothTrack(c, { window: 0, deadband: 0.03 });
  assert.deepEqual(s.map((p) => p.t), [0.1, 1.6]);
  const lane = objectPositionLane(s, wide, tall);
  assert.equal(lane.length, 2);
  assert.ok(lane[0].x > 70 && lane[1].x < 30, JSON.stringify(lane));
  assert.deepEqual(objectPositionLane(s, { width: 1080, height: 1920 }, tall), []);
});
