import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { matchAudio, findVisualLanding, checkSync } from "../scripts/sync-check.mjs";
import { soundCues } from "../src/sounds.mjs";
import { PKG_ROOT } from "../src/util.mjs";

test("sync checker finds the template under a louder unrelated audio transient", () => {
  const samples = new Float32Array(40), template = [0, 0.5, -0.25, 0.75, -1, 0.1, 0];
  samples[2] = 4;
  samples.set(template.map((value) => value * 0.3), 20);
  const match = matchAudio(samples, template, { rate: 100, expectedStart: 0.2, search: 0.2 });
  assert.equal(match.start, 0.2); assert.ok(match.score > 0.9999);
  assert.equal(matchAudio([], template), null);
  assert.equal(matchAudio(samples, [0, 0]), null);
});

test("sync checker finds the settled frame and refuses empty, static or noisy reference crops", () => {
  const frames = [0, 20, 70, 95, 100, 100, 100].map((value) => new Uint8Array(4).fill(value));
  assert.equal(findVisualLanding(frames, { fps: 30, firstFrame: 30 }).at, 33 / 30);
  assert.equal(findVisualLanding([]), null);
  assert.equal(findVisualLanding([frames[0], frames[1], frames[2], new Uint8Array(2)]), null);
  assert.equal(findVisualLanding(frames.map(() => frames[0])), null);
  assert.equal(findVisualLanding([0, 90, 10, 95, 0].map((value) => new Uint8Array(4).fill(value))), null);
});

test("ffmpeg diagnostic measures a real muxed transient and an eight-frame visual entrance within one frame", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-sync-check-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const render = path.join(dir, "sync.mp4");
  const plan = { canvas: { width: 64, height: 64 }, video: { duration: 2 }, style: { render: { fps: 30 } }, slams: [{ t: 38 / 30 - 0.42 }] };
  plan.audio = { tracks: soundCues(plan) };
  const cue = plan.audio.tracks[0];
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=black:s=64x64:r=30:d=2", "-i", path.join(PKG_ROOT, cue.src), "-filter_complex", `[0:v]format=gray,geq=lum='if(lt(N,30),0,if(lt(N,38),(N-30)*255/8,255))'[v];[1:a]adelay=${cue.start * 1000}:all=1,apad,atrim=0:2[a]`, "-map", "[v]", "-map", "[a]", "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", render]);
  const result = checkSync(render, plan, { boxes: { [cue.id]: { x: 0, y: 0, w: 64, h: 64 } } });
  const measured = result.cues[0];
  assert.equal(measured.status, "candidate");
  assert.ok(measured.audioCorrelation > 0.8);
  assert.equal(measured.visualLanding, 38 / 30);
  assert.ok(Math.abs(measured.deltaMs) < 1000 / 30, JSON.stringify(measured));
  const noBox = checkSync(render, plan).cues[0];
  assert.equal(noBox.status, "uncertain"); assert.equal(noBox.fullFrameFallback, true);
  assert.equal(checkSync(render, { ...plan, audio: { tracks: [{ id: "sfx-broll-1" }] } }).cues[0].status, "unmeasured");
});
