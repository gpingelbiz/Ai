import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { soundCues, SOUNDS } from "../src/sounds.mjs";
import { planCadence } from "../src/zooms.mjs";
import { renderHTML, composeProject } from "../src/compose.mjs";
import { PKG_ROOT } from "../src/util.mjs";

test("sound cues: one per edit, markers skipped next to a louder cue, levels scale, files exist", () => {
  const cues = soundCues({
    zooms: [{ t: 5, scale: 1.14 }, { t: 8, scale: 1 }, { t: 12, scale: 1.08, cut: true }],
    graphics: [{ start: 20, duration: 6 }],
    slams: [{ t: 30, end: 31.1 }],
    coldOpen: { duration: 0.6 },
    captions: [{ start: 30.2, words: [{ text: "truth", key: true, start: 30.26 }] }, { start: 40, words: [{ text: "own", key: true, start: 40.1 }] }, { start: 44, words: [{ text: "x" }] }],
    annotate: true,
    markers: true,
    level: 0.3,
  });
  assert.deepEqual(cues.map((c) => c.id), ["sfx-flash-1", "sfx-move-1", "sfx-card-1", "sfx-slam-1", "sfx-marker-1"], "a jump cut makes no sound; the marker next to the slam is dropped");
  assert.equal(cues[1].start, 4.94, "the whoosh leads the move a little");
  assert.equal(cues[3].volume, 0.3);
  assert.equal(cues[4].volume, 0.135);
  for (const k of Object.keys(SOUNDS)) assert.ok(fs.existsSync(path.join(PKG_ROOT, "assets", "sfx", SOUNDS[k].file)), `${k} file vendored`);
  assert.ok(fs.readFileSync(path.join(PKG_ROOT, "assets", "sfx", "NOTICE.md"), "utf8").includes("CC0"));
  assert.deepEqual(soundCues({ zooms: [], graphics: [] }), []);
  assert.ok(soundCues({ captions: [{ start: 1, words: [{ text: "own", key: true, start: 1 }] }], annotate: true }).length === 0, "marker sounds are off by default");
});

test("cadence: jump cuts fill the gaps between punch-ins, alternate the frame, stay clear of cards and the hook", () => {
  const groups = Array.from({ length: 30 }, (_, i) => ({ start: 1 + i * 2, end: 2.5 + i * 2, text: "x", words: [] }));
  const keys = [{ t: 11, scale: 1.14, snap: 0.12 }, { t: 14, scale: 1, snap: 0.3 }];
  const z = planCadence(groups, 61, keys, { min: 2.5, hook: { start: 0, duration: 3 }, busy: [{ start: 30, duration: 5 }] });
  const cuts = z.filter((k) => k.cut);
  assert.ok(cuts.length >= 8, `enough cuts: ${cuts.length}`);
  assert.ok(cuts.every((k) => k.t >= 3 && k.t <= 59.5), "after the hook, before the end");
  assert.ok(cuts.every((k) => !(k.t >= 29.7 && k.t < 35.3)), "never under the still");
  assert.ok(cuts.every((k) => (k.t < 11 ? 11 - k.t >= 1.5 : k.t - 14 >= 2.5)), "a clear lead before the punch-in, a full gap after its release");
  const ordered = z.map((k) => k.t);
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b), "time ordered");
  for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i].t - cuts[i - 1].t >= 2.5);
  const scales = cuts.map((k) => k.scale);
  assert.ok(scales.some((s) => s > 1) && scales.some((s) => s === 1), "alternates between the two framings");
  assert.ok(cuts.filter((k) => k.scale > 1).every((k) => Math.abs(k.xPercent) === 1.2) && cuts.filter((k) => k.scale === 1).every((k) => k.xPercent === 0));
  assert.ok(planCadence(groups, 61, keys, { tight: true }).filter((k) => k.cut).every((k) => k.scale <= 1.05), "tight frame: gentle step");
});

test("render: cold open still under the hook, flash layer, sfx tracks copied into the project", () => {
  const style = { colors: { text: "#fff", accent: "#fc0", stroke: "#000" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: { style: "camera" }, cta: {}, broll: { grade: { preset: "muted-editorial" } } };
  const plan = { name: "t", canvas: { width: 1080, height: 1920 }, video: { duration: 20, hasAudio: true, src: path.join(PKG_ROOT, "package.json") }, style, captions: [], zooms: [{ t: 6, scale: 1.08, cut: true, xPercent: 1.2 }, { t: 9, scale: 1, cut: true, xPercent: 0 }], broll: [{ start: 10, duration: 2, motion: "in", file: path.join(PKG_ROOT, "assets", "sfx", "NOTICE.md") }], coldOpen: { duration: 0.6, src: "assets/broll/broll-1.png" }, audio: { tracks: [{ id: "sfx-slam-1", src: "assets/sfx/slam.wav", start: 3, duration: 0.18, volume: 0.3, track: 9 }] } };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /id="cold-open" class="broll clip" data-start="0" data-duration="0.6"[^>]*><div class="broll-move"><img src="assets\/broll\/broll-1.png"/);
  assert.match(html, /id="open-flash" class="clip" data-start="0" data-duration="1.1"/);
  assert.match(html, /"coldOpen":\{"duration":0.6\}/);
  assert.match(html, /"zooms":\[\{"t":6,"scale":1.08,"cut":true,"xPercent":1.2\}/);
  assert.match(html, /<audio id="sfx-slam-1" src="assets\/sfx\/slam.wav" data-start="3" data-duration="0.18" data-track-index="9" data-volume="0.3">/);
  const dir = fs.mkdtempSync(path.join(PKG_ROOT, "test", ".tmp-open-"));
  try {
    composeProject(plan, dir);
    assert.ok(fs.existsSync(path.join(dir, "assets", "sfx", "slam.wav")), "the used sound is copied");
    assert.ok(!fs.existsSync(path.join(dir, "assets", "sfx", "card.wav")), "unused sounds are not");
    assert.equal(plan.coldOpen.src, "assets/broll/broll-1.md", "the still is whatever the first b-roll file became");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const none = renderHTML({ ...plan, coldOpen: null, audio: { tracks: [] } }, "assets/footage.mp4");
  assert.ok(!none.includes('id="cold-open"') && !none.includes('id="open-flash"'));
});
