import { test } from "node:test";
import assert from "node:assert/strict";
import { trackFaces, speechSpans, speakerTurns, settleTurns, splitSpans, cameraPath, planLayout, layoutFilter, pathAt } from "../src/speakers.mjs";

// Two people in a landscape shot: A on the left (x≈0.25), B on the right (x≈0.75). A talks 0-6 s, B 6-12 s, then they trade lines 12-20 s.
function synth() {
  const frames = [];
  for (let t = 0; t < 20; t += 0.25) {
    const aTalks = t < 6 || (t >= 12 && Math.floor(t / 1.5) % 2 === 0);
    const bTalks = (t >= 6 && t < 12) || (t >= 12 && !aTalks);
    const wobble = (on) => (on ? 0.25 + 0.2 * Math.sin(t * 20) : 0.02);
    frames.push({ t: Math.round(t * 1000) / 1000, faces: [{ x: 0.18, y: 0.3, w: 0.14, h: 0.25, mouth: wobble(aTalks), yaw: 0 }, { x: 0.68, y: 0.32, w: 0.14, h: 0.25, mouth: wobble(bTalks), yaw: 0 }] });
  }
  const words = [];
  for (let t = 0; t < 20; t += 0.4) words.push({ text: "w", start: t, end: t + 0.3 });
  return { frames, words };
}

test("tracks: faces become two steady tracks; speech spans merge the words", () => {
  const { frames, words } = synth();
  const tracks = trackFaces(frames);
  assert.equal(tracks.length, 2);
  assert.ok(tracks[0].samples.length >= 70 && tracks[1].samples.length >= 70);
  assert.deepEqual(speechSpans(words).length, 1, "continuous talk is one span");
  assert.equal(speechSpans([{ start: 0, end: 1 }, { start: 3, end: 4 }]).length, 2);
});

test("turns: the moving mouth wins, with a hold; split spans where they trade lines", () => {
  const { frames, words } = synth();
  const tracks = trackFaces(frames);
  const turns = settleTurns(speakerTurns(tracks, words, { from: 0, to: 20 }));
  assert.ok(turns.length >= 2, `turns: ${JSON.stringify(turns)}`);
  assert.equal(turns[0].track, 0, "A talks first");
  assert.ok(turns.some((x) => x.track === 1 && x.start >= 5 && x.start <= 8), "B takes over near 6 s");
  for (const x of turns.slice(0, -1)) assert.ok(x.end - x.start >= 2 - 1e-6, "every settled turn holds at least 2 s");
  const sp = splitSpans(speakerTurns(tracks, words, { from: 0, to: 20 }), tracks, { from: 0, to: 20 });
  assert.ok(sp.length >= 1 && sp[0][0] >= 9, `a split during the back-and-forth: ${JSON.stringify(sp)}`);
});

test("camera: dead band then eased pans; layout plan and ffmpeg graph", () => {
  const samples = [];
  for (let t = 0; t < 10; t += 0.25) samples.push({ t, cx: t < 5 ? 0.3 : 0.6, cy: 0.4, w: 0.15, h: 0.25, mouth: 0 });
  const path = cameraPath({ samples }, { cropW: 0.28 });
  assert.ok(path.length >= 3, "a hold key and a move key around the jump");
  assert.equal(pathAt(path, 0).cx, 0.3);
  assert.ok(Math.abs(pathAt(path, 9).cx - 0.6) < 0.01);
  const mid = pathAt(path, path[1].t + (path[2].t - path[1].t) / 2).cx;
  assert.ok(mid > 0.3 && mid < 0.6, "eases between");
  const { frames, words } = synth();
  const plan = planLayout({ tracks: trackFaces(frames), words, from: 0, to: 20, W: 1920, H: 1080 });
  assert.ok(plan.segments.length >= 2);
  assert.ok(plan.segments.every((s, i) => !i || s.start >= plan.segments[i - 1].end - 1e-6), "segments in order, no overlap");
  const f = layoutFilter(plan, { W: 1920, H: 1080, fps: 30, duration: 20 });
  assert.match(f.graph, /crop@single=w=608:h=1080/);
  assert.match(f.commands, /^0\.000 crop@single x \d+;/);
  if (plan.segments.some((s) => s.mode === "split")) {
    assert.match(f.graph, /vstack.*overlay=enable='between\(t,/);
    assert.match(f.commands, /crop@pa x \d+, crop@pa y \d+;/);
  }
});
