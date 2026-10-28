import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planBumps, planDrift } from "../src/motion.mjs";
import { cardHeadTop } from "../src/placement.mjs";
import { soundCues } from "../src/sounds.mjs";
import { renderHTML } from "../src/compose.mjs";

const defaults = JSON.parse(readFileSync(new URL("../presets/_defaults.json", import.meta.url)));
const base = {
  name: "motion",
  canvas: { width: 1080, height: 1920 },
  video: { duration: 24, hasAudio: true },
  style: defaults,
  captions: [],
  zooms: [],
  graphics: [],
  broll: [],
  slams: [],
  audio: { tracks: [] },
};

const parseInlineScript = (html) => {
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
  for (const js of scripts) new Function(js);
};

test("drift: only long clear gaps survive the hook, zoom moves, cutaways and clean tail", () => {
  const zooms = [
    { t: 12, scale: 1.14, snap: 0.12 },
    { t: 18, scale: 1, snap: 0.3 },
    { t: 28, scale: 1.08, snap: 0, cut: true },
  ];
  const { stretches, skipped } = planDrift(zooms, [{ start: 32, duration: 2 }], 40, { minGap: 6, scale: 0.03, hook: { start: 0, duration: 3 }, tail: 1.5 });
  assert.deepEqual(stretches, [
    { start: 3, end: 12, scale: 1.03, reset: "move", out: 0.12 },
    { start: 18.3, end: 28, scale: 1.03, reset: "cut", out: 0 },
  ]);
  assert.ok(skipped.short >= 2);
  assert.ok(stretches.every((d) => d.end <= 32 || d.start >= 34), "none crosses the cutaway");

  const tail = planDrift([], [], 20, { minGap: 6, hook: { start: 0, duration: 3 }, tail: 1.5 }).stretches[0];
  assert.equal(tail.start, 3);
  assert.equal(tail.end, 18.333, "the five-frame reset finishes before the last 1.5 seconds");
  assert.equal(tail.reset, "exit");
});

test("impact: card/slam landings become capped bumps, but not near punch-ins, jump cuts or cutaways", () => {
  const graphics = [{ type: "headline", start: 5 }, { type: "stat", start: 10 }, { type: "quote", start: 20 }];
  const slams = [{ t: 13.58, end: 15 }]; // lands at 14.0, inside the cutaway
  const zooms = [{ t: 5.2, scale: 1.14 }, { t: 10.25, scale: 1.08, cut: true }];
  const p = planBumps(graphics, slams, zooms, { scale: 0.025, broll: [{ start: 14, duration: 2 }], duration: 24 });
  assert.deepEqual(p.bumps, [{ t: 20, scale: 1.025, kind: "card" }]);
  assert.equal(p.skipped.nearMove, 2);
  assert.equal(p.skipped.cutaway, 1);
  assert.equal(planBumps(Array.from({ length: 12 }, (_, i) => ({ start: 2 + i })), [], [], { max: 3, minSpacing: 0 }).bumps.length, 3, "the reel cap is deterministic");
});

test("whip: directional SVG blur and seven-frame slides render, with move.wav cues on both cuts", () => {
  const plan = { ...base, style: { ...defaults, broll: { ...defaults.broll, cut: "whip" } }, broll: [{ start: 6, duration: 2, motion: "left", src: "assets/broll/one.png" }] };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /feGaussianBlur id="whip-foot-blur" stdDeviation="0 0"/);
  assert.match(html, /attr: \{ stdDeviation: "42 0" \}/);
  assert.match(html, /xPercent: -14, duration: frames/);
  assert.match(html, /xPercent: 14, duration: frames/);
  assert.match(html, /"brollCut":"whip"/);
  const cues = soundCues({ broll: [{ start: 6, duration: 2 }], brollCut: "whip" });
  assert.deepEqual(cues.map((c) => [c.id, c.src, c.start]), [
    ["sfx-move-1", "assets/sfx/move.wav", 5.94],
    ["sfx-move-2", "assets/sfx/move.wav", 7.94],
  ]);
  const shared = soundCues({ broll: [{ start: 6, duration: 2, layout: "window" }, { start: 12, duration: 2, layout: "split" }, { start: 18, duration: 2, layout: "cutout" }], brollCut: "whip" });
  assert.deepEqual(shared.map((c) => c.start), [17.94, 19.94], "window and split cutaways do not whip, so they get no whoosh");
  parseInlineScript(html);
});

test("card head guard multiplies the drift scale active in the card window", () => {
  const detection = { frames: [{ faces: [{ x: 0.32, y: 0.33, w: 0.43, h: 0.24 }], bodies: [{ x: 0.04, y: 0.26, w: 0.94, h: 0.73 }] }] };
  const plain = cardHeadTop(detection, { t0: 5, t1: 8 });
  const drifted = cardHeadTop(detection, { drift: [{ start: 3, end: 10, scale: 1.03, out: 0.12 }], t0: 5, t1: 8 });
  assert.ok(drifted < plain, "the drift lifts the head, so the card is guarded higher");
});

test("render: impact and drift use independent inner wrappers, mirror the cutout, and legacy markup is unchanged", () => {
  const behind = { src: "assets/cutout.webm", start: 0, duration: 3 };
  const impact = renderHTML({ ...base, behind, motion: { bumps: [{ t: 6, scale: 1.025, kind: "card" }], drift: [] } }, "assets/footage.mp4");
  assert.match(impact, /id="impact-wrap" class="motion-inner impact-inner"/);
  assert.match(impact, /id="cutout-impact-wrap" class="motion-inner impact-inner"/);
  assert.match(impact, /duration: 2 \* MOTION_FRAME, ease: "expo.out"/);
  parseInlineScript(impact);

  const drift = renderHTML({ ...base, motion: { bumps: [], drift: [{ start: 3, end: 12, scale: 1.03, reset: "move", out: 0.12 }] } }, "assets/footage.mp4");
  assert.match(drift, /id="drift-wrap" class="motion-inner drift-inner"/);
  assert.match(drift, /ease: "sine.inOut"/);
  parseInlineScript(drift);

  const legacy = renderHTML(base, "assets/footage.mp4");
  const empty = renderHTML({ ...base, motion: { bumps: [], drift: [] } }, "assets/footage.mp4");
  assert.equal(empty, legacy, "an old plan, or an empty opt-in lane, emits exactly the old composition");
  assert.ok(!legacy.includes("motion-inner") && !legacy.includes('"motion"'));
  assert.deepEqual(defaults.motion, { impact: { enabled: false, scale: 0.025 }, drift: { enabled: false, minGap: 6, scale: 0.03 } });
});
