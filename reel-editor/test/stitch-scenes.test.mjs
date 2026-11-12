import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStitchScenes, loadStitchScenes, sceneAt, fitSceneWindow, planSceneCuts, remapStitchScenes, measureSceneFaces, sceneZooms, sceneSoundTracks, applyScenePlan, stitchTimeline, detectionInScene, layoutSceneBold, endSceneCuts } from "../src/stitch-scenes.mjs";
import { eventClock } from "../src/event-clock.mjs";
import { loadPreset } from "../src/presets.mjs";
import { fixturePlan } from "../scripts/golden.mjs";
import { restyleBold } from "../src/bold.mjs";
import { restyleGlow } from "../src/glow.mjs";
import { placeBoldOverlays, registerBoldOverlay } from "../src/bold-overlays.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scenes = [{ start: 0, end: 3, clip: "a", place: "A", join: "start" }, { start: 3, end: 6, clip: "b", place: "B", join: "place" }, { start: 6, end: 10, clip: "c", place: "B", join: "take" }];
const words = [{ text: "I", start: 2.4, end: 2.6 }, { text: "think", start: 2.6, end: 2.9 }, { text: "I", start: 3.1, end: 3.3 }, { text: "think", start: 3.3, end: 3.6 }, { text: "clearly.", start: 3.6, end: 4 }, { text: "Next", start: 6.1, end: 6.4 }, { text: "sentence.", start: 7, end: 7.3 }];

test("scene files require contiguous whole frames and the matching master duration", () => {
  assert.equal(validateStitchScenes(scenes, 10), scenes);
  assert.throws(() => validateStitchScenes([], 10));
  assert.throws(() => validateStitchScenes([{ ...scenes[0], end: 2.99 }], 2.99));
  assert.throws(() => validateStitchScenes(scenes, 20));
  assert.throws(() => validateStitchScenes([scenes[0], { ...scenes[1], start: 4 }], 6));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stitch-scenes-"));
  try { fs.writeFileSync(path.join(dir, "scenes.json"), JSON.stringify(scenes)); assert.deepEqual(loadStitchScenes(path.join(dir, "scenes.json"), 10), scenes); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(sceneAt(scenes, 3), scenes[1]);
});

test("one shared visual gate rejects crossings for every time shape and accepts exact cut edges", () => {
  assert.equal(fitSceneWindow({ start: 2, duration: 2 }, scenes), null);
  assert.equal(fitSceneWindow({ t: 2, end: 4 }, scenes), null);
  assert.equal(fitSceneWindow({ at: 2, duration: 2 }, scenes), null);
  assert.ok(fitSceneWindow({ start: 2, end: 3 }, scenes));
  assert.ok(fitSceneWindow({ start: 3, end: 5 }, scenes));
  const legacy = { start: 2, end: 4 }; assert.equal(fitSceneWindow(legacy, null), legacy);
});

test("bad take and silence cuts cannot erase the opening word at a join or a silent scene", () => {
  const cuts = planSceneCuts(words, 10, scenes, { silence: "tight", badTakes: true, fillers: true, signOff: false });
  assert.equal(cuts.words.filter((w) => !w.drop).length, words.length);
  for (const s of scenes) assert.ok(cuts.segments.some((r) => r.start <= s.start && r.end > s.start));
  const mapped = remapStitchScenes(scenes, cuts.segments);
  for (const s of mapped) { assert.equal(Math.round(s.start * 30), s.start * 30); assert.equal(Math.round(s.end * 30), s.end * 30); }
  assert.deepEqual(mapped.map((s) => s.join), ["start", "place", "take"]);
  assert.throws(() => remapStitchScenes(scenes, [{ start: 0, end: 3 }]));
  assert.equal(planSceneCuts([], 10, scenes).keptDuration, 10);
});

test("each scene gets separate face samples and framing with no cross scene median", async () => {
  const calls = [], preset = loadPreset("pingel-v2");
  const facts = await measureSceneFaces("master.mov", scenes, async (_, times) => {
    calls.push(times); return { frames: times.map((t) => ({ t, faces: [{ x: t < 3 ? 0.1 : 0.7, y: 0.1, w: 0.15, h: t < 3 ? 0.1 : 0.3 }] })) };
  }, preset);
  assert.equal(calls.length, 3);
  calls.forEach((times, i) => assert.ok(times.every((t) => t >= scenes[i].start && t < scenes[i].end)));
  assert.notEqual(facts[0].face.cx, facts[1].face.cx); assert.notEqual(facts[0].framing.scale, facts[1].framing.scale);
  const det = { frames: [{ t: 2.99 }, { t: 3 }, { t: 5.9 }] };
  assert.deepEqual(detectionInScene(det, scenes, 3).frames.map((f) => f.t), [3, 5.9]);
});

test("place zoom settles in twelve frames, take zoom holds to the next sentence and sound peak lands on cut", () => {
  const keys = sceneZooms([{ t: 2.9, scale: 1.2 }, { t: 4.2, scale: 1.1 }, { t: 6.1, scale: 1.2 }], scenes, words);
  assert.ok(keys.some((k) => k.t === 3 && k.scale === 1.06));
  assert.ok(keys.some((k) => k.t === 3.4 && k.settleFrom === 3));
  assert.ok(keys.some((k) => k.t === 6 && k.scale === 1.08));
  assert.ok(keys.some((k) => k.t === 7.3 && k.scale === 1));
  assert.equal(keys.some((k) => k.t === 2.9 || k.t === 6.1), false);
  const [sound] = sceneSoundTracks(scenes);
  assert.equal(sound.start, eventClock({ landAt: 3, sfx: "move.wav", fps: 30 }).start); assert.equal(sound.volume, 0.1);
});

test("final admission applies to standard cards, B roll, glow, captions and cached plans, and is idempotent", () => {
  const crossing = { start: 2, end: 4, duration: 2 };
  const p = { stitchScenes: scenes, words, graphics: [crossing], broll: [crossing], glowScenes: [crossing], glowOverlays: [crossing], icons: [{ t: 2, end: 4 }], captions: [{ ...crossing, words: words.slice(0, 5), text: "heard words" }], zooms: [], audio: { tracks: [] }, framing: {}, canvas: { height: 1920 } };
  applyScenePlan(p);
  for (const key of ["graphics", "broll", "glowScenes", "glowOverlays", "icons"]) assert.deepEqual(p[key], []);
  assert.equal(p.captions.length, 2); assert.equal(p.captions.flatMap((g) => g.words).length, 5);
  const first = JSON.stringify(p); applyScenePlan(p); assert.equal(JSON.stringify(p), first);
  assert.match(stitchTimeline(p), /duration: 0.399/); assert.match(stitchTimeline(p), /scale: 1.08/);
  const bridge = { ...p, icons: [{ t: 2, end: 3.3 }, { t: 8, end: 9 }], glowScenes: [{ start: 3.3, end: 5, bridge: 0 }] };
  applyScenePlan(bridge); assert.equal(bridge.glowScenes[0].bridge, undefined);
  const legacy = { captions: [], words: [] }; assert.equal(applyScenePlan(legacy), legacy); assert.equal(stitchTimeline(legacy), "");
});

test("bold and glow restyles keep scene joins and remove crossing visuals with fake direction and face tools", async () => {
  const p = fixturePlan("master.mov"); p.stitchScenes = scenes; p.words = words; p.video.hasAudio = true;
  p.style = loadPreset("pingel-bold"); p.preset = p.style.name;
  const detect = async (_, times) => ({ frames: times.map((t) => ({ t, faces: [{ x: 0.4, y: t < 3 ? 0.1 : 0.2, w: 0.15, h: t < 3 ? 0.2 : 0.3 }] })) });
  const picks = { schemaVersion: 1, argument: { buyerProblem: null, answer: null, payoff: null }, headline: null, punch: [], emphasis: [], turns: [], overlays: [] };
  const bold = await restyleBold(p, { render: "fake.mp4", picks, detect, log: () => {}, env: { REEL_CLIENT_MODE: "0", REEL_CLIENT: "" } });
  assert.ok(bold.plan.zooms.some((k) => k.t === 3 && k.stitch));
  assert.ok(bold.plan.bold.groups.every((g) => fitSceneWindow(g, scenes)));
  assert.equal(bold.plan.bold.groups.reduce((n, g) => n + g.to - g.from + 1, 0), words.length);
  assert.notEqual(bold.plan.bold.sceneZones[0].zones.chin, bold.plan.bold.sceneZones[1].zones.chin);
  const glowPlan = structuredClone(p); glowPlan.style = loadPreset("pingel-brand"); glowPlan.preset = glowPlan.style.name;
  const glow = await restyleGlow(glowPlan, { render: "fake.mp4", picks: { features: [], icons: [], scenes: [], overlays: [] }, detect, cutout: async () => ({ error: "fake" }) });
  assert.ok(glow.plan.zooms.some((k) => k.t === 3 && k.stitch));
  assert.ok(glow.plan.captions.every((g) => fitSceneWindow(g, scenes)));
});

test("ending flags preserve the last word and trim subsequent scenes without a fragment of their opening", () => {
  const cuts = planSceneCuts(words, 10, scenes, { silence: "off", badTakes: false, fillers: false });
  const end = endSceneCuts(cuts, scenes, 2.9, 10);
  assert.equal(end.segments.at(-1).end, 3);
  assert.deepEqual(end.words.filter((w) => !w.drop).map((w) => w.text), ["I", "think"]);
  assert.equal(endSceneCuts(cuts, scenes, 3.5, 10).segments.at(-1).end, 3.6);
  assert.throws(() => endSceneCuts(cuts, scenes, 0.1, 10));
});

test("scene zooms compose with each scene's own base scale in the camera style", () => {
  const p = { stitchScenes: scenes, stitchFaces: scenes.map((s, i) => ({ ...s, framing: { scale: i ? 1 : 1.3, origin: "50% 40%" } })), canvas: { height: 1920 }, style: { zooms: { style: "camera" } }, zooms: [{ t: 4, scale: 1.2, snap: 0.12 }], captions: [] };
  const js = stitchTimeline(p);
  assert.match(js, /scale: 1.2, xPercent: 0, yPercent: -1.2/);
  assert.doesNotMatch(js, /scale: 1.56/);
});
