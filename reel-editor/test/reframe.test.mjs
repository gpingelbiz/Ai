import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReframe, sampleTimes, faceCentres, smoothTrack, OneEuroFilter, planCropPath, objectPositionLane } from "../src/reframe.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";

const wide = { width: 1920, height: 1080 }, tall = { width: 1080, height: 1920 };

test("only a wider source gets a reframe", () => {
  assert.ok(needsReframe(wide, tall));
  assert.ok(!needsReframe({ width: 1080, height: 1920 }, tall));
  assert.ok(!needsReframe({ width: 1080, height: 1080 }, { width: 1080, height: 1080 }));
  assert.deepEqual(sampleTimes(1.6, 0.5), [0.1, 0.6, 1.1]);
  assert.deepEqual(sampleTimes(0.9), [0.1, 0.35, 0.6, 0.85]);
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

const secondDifference = (xs) => xs.length < 3 ? 0 : xs.slice(2).reduce((sum, x, i) => sum + Math.abs(x - 2 * xs[i + 1] + xs[i]), 0) / (xs.length - 2);

function pathAt(path, t) {
  let i = path.findLastIndex((p) => p.t <= t);
  if (i < 0) return path[0].x;
  if (i === path.length - 1 || path[i + 1].cut) return path[i].x;
  const a = path[i], b = path[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  return a.x + f * (b.x - a.x);
}

test("One Euro crop planning turns detector noise into a near-still path", () => {
  const noise = [-0.02, 0.012, -0.008, 0.018, -0.014, 0.006, -0.018, 0.015, -0.004, 0.01];
  const points = Array.from({ length: 80 }, (_, i) => ({ t: i * 0.25, x: 0.5 + noise[i % noise.length] }));
  const path = planCropPath(points);
  const before = secondDifference(points.map((p) => p.x));
  const after = secondDifference(points.map((p) => pathAt(path, p.t)));
  assert.ok(after < before * 0.01, `${before} -> ${after}: ${JSON.stringify(path)}`);
  assert.ok(Math.max(...path.map((p) => p.x)) - Math.min(...path.map((p) => p.x)) <= 0.02);

  const filter = new OneEuroFilter();
  assert.equal(filter.filter(0.5, 2), 0.5);
  assert.equal(filter.filter(0.5, 2.25), 0.5);
  assert.ok(filter.filter(0.7, 2.5) > 0.5, "a real timestamped move starts immediately");
});

test("a 0.2 step is followed within one sample without overshoot", () => {
  const points = Array.from({ length: 25 }, (_, i) => ({ t: i * 0.25, x: i * 0.25 < 3 ? 0.5 : 0.7 }));
  const path = planCropPath(points, { deadband: 0 });
  const followed = path.find((p) => p.t >= 3 && p.x >= 0.65);
  assert.ok(followed && followed.t <= 3.3, JSON.stringify(path));
  assert.ok(path.every((p) => p.x <= 0.7), JSON.stringify(path));
  const speeds = path.slice(1).map((p, i) => (p.x - path[i].x) / (p.t - path[i].t));
  const accels = speeds.slice(1).map((v, i) => (v - speeds[i]) / (path[i + 2].t - path[i + 1].t));
  assert.ok(speeds.every((v) => Math.abs(v) <= 0.355), `speed: ${Math.max(...speeds.map(Math.abs))}`);
  assert.ok(accels.every((a) => Math.abs(a) <= 1.42), `acceleration: ${Math.max(...accels.map(Math.abs))}`);
});

test("the crop resets exactly at a cut instead of sliding across it", () => {
  const points = Array.from({ length: 25 }, (_, i) => {
    const t = 0.25 + i * 0.25;
    return { t, x: t < 5 ? 0.3 : 0.7 };
  }).filter((p) => p.t !== 5);
  const path = planCropPath(points, { cuts: [5] });
  assert.deepEqual(path.find((p) => p.t === 5), { t: 5, x: 0.7, cut: true });
  assert.ok(path.filter((p) => p.t >= 4.5 && p.t <= 5.5).every((p) => p.x === 0.3 || p.x === 0.7), JSON.stringify(path));
  const lane = objectPositionLane(path, wide, tall);
  assert.equal(lane.find((p) => p.t === 5).cut, true, "object-position keeps the instant-cut marker");
});

test("a missed face carries the last centre and cannot create a crop jump", () => {
  const points = faceCentres({ frames: [
    { t: 0, faces: [{ x: 0.3, y: 0.2, w: 0.2, h: 0.3 }] },
    { t: 0.25, faces: [] },
    { t: 0.5, faces: [] },
    { t: 0.75, faces: [{ x: 0.3, y: 0.2, w: 0.2, h: 0.3 }] },
  ] });
  assert.deepEqual(points.map((p) => p.x), [0.4, 0.4, 0.4, 0.4]);
  assert.deepEqual(planCropPath(points), [{ t: 0, x: 0.4 }]);
});

test("compose sets cut points instantly and keeps ordinary points on the old tween", () => {
  const style = loadPreset("clean");
  const html = renderHTML({
    name: "reframe", canvas: tall, style,
    video: { duration: 8, hasAudio: false }, captions: [], hook: null, cta: null,
    zooms: [], graphics: [], broll: [], slams: [], audio: { tracks: [] },
    reframe: [{ t: 0.1, x: 20 }, { t: 5, x: 80, cut: true }, { t: 5.25, x: 82 }],
  }, "assets/footage.mp4");
  assert.match(html, /"reframe":\[\{"t":0\.1,"x":20\},\{"t":5,"x":80,"cut":true\},\{"t":5\.25,"x":82\}\]/);
  assert.match(html, /if \(p\.cut\) tl\.set\(FOOT, \{ objectPosition: p\.x \+ "% 50%" \}, p\.t\);\s+else tl\.to\(FOOT/);
});

test("the default preset selects the switchable One Euro smoother", () => {
  const reframe = loadPreset("clean").reframe;
  assert.deepEqual(reframe, {
    enabled: true, step: 0.25, smoother: "oneeuro", minCutoff: 0.8, beta: 0.15,
    dCutoff: 1, deadband: 0.015, maxSpeed: 0.35, maxAccel: 1.4,
  });
});
