import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  frameTimes, faceSampleTimes, faceTrack, orientationOf, cropBox, cutArgs, usableRange, placeLibrary, libraryPrompt,
  indexClip, indexLibrary, makeLibraryBroll, cutShot, libraryClips, indexPath, momentAt,
} from "../src/broll-library.mjs";
import { brollCandidates, holdForSplit, readRecent } from "../src/broll.mjs";
import { probe } from "../src/probe.mjs";

// Never the real cache: a client's recent picks live in their REEL_CACHE.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brlib-"));
process.env.REEL_BROLL_LIBRARY_RECENT = path.join(tmp, "recent.json");

const groups = Array.from({ length: 25 }, (_, i) => ({ start: 3 + i * 2, end: 4.8 + i * 2, text: `line ${i}`, words: [] }));
const clip = (id, over = {}) => ({ id, file: `clip ${id}.mov`, path: `/lib/clip ${id}.mov`, duration: 20, width: 1080, height: 1920, orientation: "portrait", description: `clip ${id} overall`, moments: [{ t: 2, what: `clip ${id} early` }, { t: 12, what: `clip ${id} late` }], faces: [], ...over });

test("library index timing: frames every ~5 s (3 to 10), faces every half second, shape names", () => {
  assert.deepEqual(frameTimes(6), [1, 3, 5]);
  assert.equal(frameTimes(60).length, 10);
  assert.equal(frameTimes(22).length, 5);
  assert.deepEqual(faceSampleTimes(2), [0.25, 0.75, 1.25, 1.75]);
  assert.equal(orientationOf(720, 1280), "portrait");
  assert.equal(orientationOf(1920, 1080), "landscape");
  assert.equal(orientationOf(1000, 1000), "square");
  const track = faceTrack({ frames: [{ t: 0.25, faces: [{ x: 0.1, y: 0.2, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.3, w: 0.2, h: 0.2 }] }, { t: 0.75, faces: [], bodies: [{ x: 0.6, y: 0.4, w: 0.2, h: 0.4 }] }, { t: 1.25, faces: [], bodies: [] }] });
  assert.deepEqual(track, [{ t: 0.25, x: 0.6, y: 0.4 }, { t: 0.75, x: 0.7, y: 0.6 }], "largest face, a body when no face, nobody left out");
});

test("9:16 crop: a wide clip keeps full height with the face centred across; a tall one full width", () => {
  const wide = { width: 1920, height: 1080 };
  assert.deepEqual(cropBox(wide, { x: 0.5, y: 0.4 }), { w: 606, h: 1080, x: 656, y: 0 });
  assert.deepEqual(cropBox(wide, { x: 0.2, y: 0.4 }), { w: 606, h: 1080, x: 80, y: 0 }, "the face on the left");
  assert.deepEqual(cropBox(wide, { x: 0.98, y: 0.4 }), { w: 606, h: 1080, x: 1314, y: 0 }, "kept inside the frame");
  assert.deepEqual(cropBox({ width: 1080, height: 1920 }, { x: 0.9, y: 0.9 }), { w: 1080, h: 1920, x: 0, y: 0 }, "already 9:16: nothing cut");
  assert.deepEqual(cropBox({ width: 1080, height: 2400 }, { x: 0.5, y: 0.5 }), { w: 1080, h: 1920, x: 0, y: 432 }, "taller: the face a little above the middle");
  assert.deepEqual(cropBox({ width: 1080, height: 2400 }, { x: 0.5, y: 0.95 }), { w: 1080, h: 1920, x: 0, y: 480 }, "kept inside the frame");
});

test("the cut: muted, SDR for HDR, still crop when the face stays, an eased pan when it moves", () => {
  const meta = { width: 1920, height: 1080, hdr: false };
  const still = cutArgs({ input: "in.mov", output: "out.mp4", at: 4, len: 2, meta, track: [{ t: 4.25, x: 0.3, y: 0.4 }, { t: 5.75, x: 0.31, y: 0.4 }], canvas: { width: 1080, height: 1920 } });
  const vf = still[still.indexOf("-vf") + 1];
  assert.ok(still.includes("-an"), "no sound: the voice keeps going");
  assert.deepEqual(still.slice(still.indexOf("-ss"), still.indexOf("-ss") + 4), ["-ss", "4", "-t", "2.1"]);
  assert.match(vf, /crop=606:1080:272:0,scale=1080:1920/);
  assert.doesNotMatch(vf, /colorspace/);
  const pan = cutArgs({ input: "in.mov", output: "out.mp4", at: 4, len: 2, meta: { ...meta, hdr: true }, track: [{ t: 4.25, x: 0.3, y: 0.4 }, { t: 5.75, x: 0.7, y: 0.4 }] });
  const pvf = pan[pan.indexOf("-vf") + 1];
  assert.match(pvf, /^colorspace=iall=bt2020:all=bt709/, "HLG comes down to BT.709 first");
  assert.match(pvf, /crop=606:1080:'272\+\(768\)\*\(min\(1,t\/2\)/, "eases from the face at the start to the face at the end");
  const none = cutArgs({ input: "in.mov", output: "out.mp4", at: 1, len: 2, meta, track: [] });
  assert.match(none[none.indexOf("-vf") + 1], /crop=606:1080:656:0/, "no face: the middle");
});

test("library picks: real lines and clips, each clip once, the second kept inside the clip, spaced like every engine", () => {
  const cands = brollCandidates(groups, 60, { hook: { start: 0, duration: 3 }, len: 2 });
  const clips = [clip(1), clip(2), clip(3, { duration: 2.2 }), clip(4, { duration: 1.5 })];
  assert.deepEqual(usableRange(20, 2), { from: 0.5, to: 17.5 });
  assert.equal(usableRange(1.5, 2), null, "shorter than a cut");
  const shots = placeLibrary([
    { line: 2, clip: 1, at: 30 },
    { line: 3, clip: 2, at: 4 }, // too close to the one before, so clip 2 is still free
    { line: 8, clip: 1, at: 3 }, // clip 1 again
    { line: 10, clip: 2, at: -1 },
    { line: 14, clip: 99, at: 1 }, // no such clip
    { line: 99, clip: 3, at: 1 }, // no such line
    { line: 18, clip: 3, at: 5 },
    { line: 21, clip: 4, at: 0 }, // too short to cut
  ], cands, clips, { len: 2, gap: 4, max: 3 });
  assert.deepEqual(shots.map((s) => [s.line, s.clip.id, s.at]), [[2, 1, 17.5], [10, 2, 0.5], [18, 3, 0.15]]);
  assert.ok(shots.every((s) => s.motion === "none" && s.duration === 2));
  assert.equal(new Set(shots.map((s) => s.clip.id)).size, shots.length, "never the same clip twice in a reel");
  assert.match(shots[0].scene, /^clip 1\.mov at 17\.5s: clip 1 late$/);
  assert.equal(momentAt(clip(1), 3), "clip 1 early");
});

test("library prompt: the catalog with usable seconds and moments, each clip once, recent moments steered off", () => {
  const cands = brollCandidates(groups, 60, { hook: { start: 0, duration: 3 }, len: 2 });
  const p = libraryPrompt({ candidates: cands, transcript: "t", hook: "Hook", count: 2, spacing: 6, len: 2, clips: [clip(1)], recent: ["clip 1.mov at 4s"], world: "Dallas sales coach" });
  assert.match(p, /speaker's OWN footage/);
  assert.match(p, /1: "clip 1\.mov" 20\.0 s, portrait, usable from 0\.5s to 17\.5s\. clip 1 overall\n   Moments: 2\.0s clip 1 early; 12\.0s clip 1 late/);
  assert.match(p, /Use each clip at most once in this reel/);
  assert.match(p, /never the same moment again[\s\S]*- clip 1\.mov at 4s/);
  assert.match(p, /The speaker's world: Dallas sales coach/);
  assert.match(p, /"clip":<clip id>,"at":<seconds into the clip>/);
});

test("library index: written next to the clip once, reused while the clip is unchanged, file name without Claude", async () => {
  const lib = fs.mkdtempSync(path.join(tmp, "lib-"));
  const file = path.join(lib, "Key West Laptop.mov");
  fs.writeFileSync(file, "x");
  fs.writeFileSync(path.join(lib, "notes.txt"), "not a clip");
  fs.writeFileSync(path.join(lib, ".hidden.mov"), "x");
  assert.deepEqual(libraryClips(lib), [file]);
  let looks = 0;
  const deps = {
    probe: async () => ({ duration: 12, width: 720, height: 1280, fps: 30, hdrKind: "hlg" }),
    detectFaces: async (_f, times) => ({ frames: times.map((t) => ({ t, faces: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.1 }] })) }),
    hasClaude: () => true,
    extractFrames: async (_f, frames, dir) => frames.forEach((f) => fs.writeFileSync(path.join(dir, f.file), "jpg")),
    claudeLook: async (prompt, { cwd }) => {
      looks++;
      assert.match(prompt, /frame-1\.jpg: 2\.0 s/);
      assert.ok(fs.existsSync(path.join(cwd, "frame-3.jpg")), "the frames are in the folder Claude reads");
      return 'Here: {"description":"The creator types on a laptop on a balcony over a marina.","moments":[{"t":2,"what":"laptop close"},{"t":40,"what":"past the end"},{"t":10,"what":"marina wide"}]}';
    },
  };
  const a = await indexClip(file, { deps });
  assert.equal(a.cached, false);
  assert.deepEqual([a.duration, a.orientation, a.hdr, a.described, a.faces.length], [12, "portrait", "hlg", true, 24]);
  assert.deepEqual(a.moments, [{ t: 2, what: "laptop close" }, { t: 10, what: "marina wide" }], "moments past the end are dropped");
  assert.ok(fs.existsSync(indexPath(file)), "cached next to the clip");
  const b = await indexClip(file, { deps });
  assert.equal(b.cached, true);
  assert.equal(looks, 1, "indexed once");
  fs.writeFileSync(file, "a new take"); // a changed clip is looked at again
  await indexClip(file, { deps });
  assert.equal(looks, 2);
  const blind = await indexClip(file, { force: true, deps: { ...deps, claudeLook: async () => { throw new Error("signed out"); } } });
  assert.equal(blind.description, "Key West Laptop", "the file name stands in");
  assert.equal(blind.described, false);
  const all = await indexLibrary(lib, { deps: { ...deps, probe: async () => { throw new Error("no video stream"); } }, force: true });
  assert.equal(all.length, 0, "a clip that will not probe is skipped, not fatal");
});

test("library b-roll: Claude picks, cuts made, real footage marked, recent picks remembered, plan reused", async () => {
  const wd = fs.mkdtempSync(path.join(tmp, "wd-"));
  const lib = fs.mkdtempSync(path.join(tmp, "lib-"));
  const clips = [clip(1, { path: path.join(lib, "a.mov"), file: "a.mov" }), clip(2, { path: path.join(lib, "b.mov"), file: "b.mov" }), clip(3, { path: path.join(lib, "c.mov"), file: "c.mov" })];
  const cuts = [];
  const deps = {
    hasClaude: () => true,
    indexLibrary: async (dir) => { assert.equal(dir, lib); return clips.map(({ id, ...c }) => c); },
    claudeText: async (prompt) => {
      assert.match(prompt, /"a\.mov" 20\.0 s/);
      // Claude repeats a clip; the engine still uses it once.
      return '{"picks":[{"line":3,"clip":1,"at":4},{"line":9,"clip":1,"at":12},{"line":15,"clip":2,"at":6},{"line":20,"clip":3,"at":2}]}';
    },
    cutShot: async ({ clip: c, at, len, out, still, canvas }) => { cuts.push([c.file, at, len, canvas.width]); fs.writeFileSync(out, "mp4"); fs.writeFileSync(still, "png"); },
  };
  const args = { workDir: wd, groups, duration: 50, hook: { start: 0, duration: 3 }, cta: null, settings: { library: lib, max: 3, every: 12, duration: 2, gap: 4 }, canvas: { width: 1080, height: 1920 }, deps };
  const shots = await makeLibraryBroll(args);
  assert.deepEqual(cuts, [["a.mov", 4, 2, 1080], ["b.mov", 6, 2, 1080], ["c.mov", 2, 2, 1080]]);
  assert.ok(shots.every((s) => s.file.endsWith(".mp4") && s.motion === "none" && s.real === true && s.clipSeconds === 2 && fs.existsSync(s.still)));
  assert.deepEqual(shots.map((s) => s.source.name), ["a.mov", "b.mov", "c.mov"]);
  assert.deepEqual(readRecent(process.env.REEL_BROLL_LIBRARY_RECENT), ["a.mov at 4s", "b.mov at 6s", "c.mov at 2s"]);
  // The next run of the same reel cuts nothing new.
  const again = await makeLibraryBroll({ ...args, deps: { ...deps, claudeText: async () => { throw new Error("should not ask"); } } });
  assert.equal(again.length, 3);
  // The split hold never stretches a library cut past its end; a 5-second Runway clip still holds.
  const held = holdForSplit(shots, { duration: 50, hold: 5, clipSeconds: 5 });
  assert.ok(held.every((s) => !s.hold));
  assert.ok(holdForSplit(shots.map(({ clipSeconds, ...s }) => s), { duration: 50, hold: 5, clipSeconds: 5 }).some((s) => s.hold));
  // No folder, no Claude: no b-roll, no throw.
  assert.deepEqual(await makeLibraryBroll({ ...args, workDir: fs.mkdtempSync(path.join(tmp, "wd-")), settings: { library: path.join(tmp, "nope") } }), []);
  assert.deepEqual(await makeLibraryBroll({ ...args, workDir: fs.mkdtempSync(path.join(tmp, "wd-")), deps: { ...deps, hasClaude: () => false } }), []);
  assert.deepEqual(await makeLibraryBroll({ ...args, workDir: fs.mkdtempSync(path.join(tmp, "wd-")), deps: { ...deps, claudeText: async () => '{"picks":[{"line":3,"clip":7,"at":1}]}' } }), [], "no real clip picked");
});

// Integration: a real ffmpeg cut of a tiny synthetic landscape clip with sound.
const ff = spawnSync("ffmpeg", ["-hide_banner", "-version"], { encoding: "utf8" });
test("library cut: a wide clip comes out 9:16, muted, the canvas size, with a still", { skip: ff.status !== 0 && "ffmpeg not found" }, async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "cut-"));
  const src = path.join(dir, "wide.mp4");
  const r = spawnSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=640x360:r=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "4", "-shortest", "-pix_fmt", "yuv420p", src]);
  assert.equal(r.status, 0);
  const out = path.join(dir, "broll-1.mp4"), still = path.join(dir, "broll-1.png");
  await cutShot({ clip: { path: src, width: 640, height: 360, hdr: null, faces: [{ t: 1.25, x: 0.2, y: 0.5 }, { t: 2.75, x: 0.8, y: 0.5 }] }, at: 1, len: 2, out, still, canvas: { width: 270, height: 480 }, fps: 30 });
  const m = await probe(out);
  assert.deepEqual([m.width, m.height, m.hasAudio], [270, 480, false]);
  assert.ok(m.duration > 1.9 && m.duration < 2.3, `about 2 s (${m.duration})`);
  assert.ok(fs.statSync(still).size > 0);
});
