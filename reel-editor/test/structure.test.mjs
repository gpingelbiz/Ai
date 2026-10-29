import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHTML } from "../src/compose.mjs";
import { normalizeScene, persistentDuckSchedule, resolvePersistentScenes, sceneHTML } from "../src/graphics.mjs";
import { lucideIconNames, validLucideIcon } from "../src/icons.mjs";
import { planPersistentLayout } from "../src/layouts.mjs";
import { loadPreset, mergeOverrides } from "../src/presets.mjs";
import { graphicChecks, pacingChecks } from "../src/preflight.mjs";

const enumerated = [
  { i: 0, start: 0, text: "Here are three things to do" },
  { i: 1, start: 5, text: "First make the call" },
  { i: 2, start: 8, text: "Second coach the manager" },
  { i: 3, start: 12, text: "Third track the result" },
];

const checklist = normalizeScene({
  type: "list", line: 1, title: "THE PLAN", persistent: true,
  items: [
    { text: "make the call", line: 1 },
    { text: "coach the manager", line: 2 },
    { text: "track the result", line: 3 },
    { text: "invent a credential", line: 4 },
  ],
});

test("persistent checklist grounds every item, needs enumeration, caps at one and 40% / 30 seconds", () => {
  const first = resolvePersistentScenes([checklist, { ...checklist, title: "SECOND" }], enumerated, { duration: 60, hook: { start: 0, duration: 3 }, persistent: true });
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].items.map((item) => item.text), ["make the call", "coach the manager", "track the result"]);
  assert.deepEqual(first[0].items.map((item) => item.at), [0, 3, 7]);
  assert.equal(first[0].start, 5);
  assert.equal(first[0].duration, 24, "40% of a 60 second reel");
  assert.equal(resolvePersistentScenes([checklist], enumerated, { duration: 100, persistent: true })[0].duration, 30, "absolute cap");
  assert.equal(resolvePersistentScenes([{ ...checklist, endLine: 4 }], [...enumerated, { i: 4, start: 18, text: "Now a different subject" }], { duration: 60, persistent: true })[0].duration, 13, "the first new-topic line ends the panel");
  assert.deepEqual(resolvePersistentScenes([checklist], enumerated.map((line) => ({ ...line, text: line.text.replace(/First|Second|Third|three things/gi, "then") })), { duration: 60, persistent: true }), []);
  assert.deepEqual(resolvePersistentScenes([checklist], enumerated, { duration: 60, persistent: false }), []);
});

test("numeric ladder keeps only spoken rungs and counts only between spoken endpoints", () => {
  const lines = [
    { i: 0, start: 4, text: "$1,000 a month" },
    { i: 1, start: 9, text: "then $10,000 a month" },
    { i: 2, start: 12, text: "then we paused" },
    { i: 3, start: 14, text: "then $100,000 a month" },
  ];
  const scene = normalizeScene({ type: "ladder", line: 0, title: "THE LEVELS", rungs: [
    { value: "$1,000", label: "a month", line: 0 },
    { value: "$10,000", label: "a month", line: 1 },
    { value: "$50,000", label: "a month", line: 2 },
    { value: "$100,000", label: "a month", line: 3 },
  ] });
  const [ladder] = resolvePersistentScenes([scene], lines, { duration: 40, ladder: true });
  assert.deepEqual(ladder.rungs.map((rung) => rung.value), ["$1,000", "$10,000", "$100,000"]);
  const html = sceneHTML(ladder, { schema: 2 });
  assert.doesNotMatch(html, /50,000/);
  assert.match(html, /data-from="1000" data-to="10000"/);
  assert.match(html, /data-from="10000" data-to="100000"/);
  assert.doesNotMatch(sceneHTML({ ...ladder, rungs: [{ value: "10", label: "", at: 0 }, { value: "100%", label: "", at: 5 }] }, { schema: 2 }), /g-ladder-count/, "a changed unit reveals the exact value instead of inventing the prior unit");
});

test("persistent structure ducks for cards, b-roll and slams with six-frame fades", () => {
  const scene = { type: "list", persistent: true, start: 5, duration: 20 };
  assert.deepEqual(persistentDuckSchedule({
    scene,
    cards: [scene, { type: "message", start: 7, duration: 2 }],
    broll: [{ start: 11, duration: 3 }],
    slams: [{ t: 13.5, end: 15 }],
    fps: 30,
  }), [
    { outAt: 6.8, hiddenAt: 7, inAt: 9, shownAt: 9.2 },
    { outAt: 10.8, hiddenAt: 11, inAt: 15, shownAt: 15.2 },
  ]);
});

test("persistent layout reuses the face-safe window and preflight exempts lifetime but checks size and face", () => {
  const face = { cx: 0.25, cy: 0.4, w: 0.16, h: 0.14 };
  const detection = { frames: [{ faces: [{ x: 0.17, y: 0.33, w: 0.16, h: 0.14 }], bodies: [] }] };
  const placed = planPersistentLayout({ ...checklist, start: 5, duration: 20 }, { W: 1080, H: 1920, captionTop: 0.68, face, detection, framing: { scale: 1, origin: "50% 40%" }, brand: loadPreset("pingel-v2").brand });
  assert.equal(placed.skip, undefined);
  assert.ok(placed.fontSize >= 40 && placed.placement.x >= 76 && placed.placement.x + placed.placement.w <= 940);

  const base = { type: "list", persistent: true, start: 5, duration: 20, items: checklist.items.slice(0, 3), box: { x: 100, y: 250, w: 300, h: 500 }, fontSize: 40 };
  const plan = { video: { duration: 30 }, canvas: { width: 1080, height: 1920 }, style: { captions: { enabled: true, position: 0.7, fontSizeFrac: 0.04 }, graphics: { mode: "overlay" }, preflight: { cards: {} } }, captions: [{ start: 0, end: 30 }], hook: { start: 0, duration: 3, text: "Here are three things to do" }, graphics: [base], broll: [] };
  const codes = graphicChecks(plan).map((item) => item.code);
  assert.ok(!codes.some((code) => ["card-reading-budget", "card-hold", "card-item-hold", "card-occupancy"].includes(code)));
  assert.equal(pacingChecks(plan).stats.firstCut, 30, "persistent lifetime does not create shot boundaries");
  const unsafe = graphicChecks({ ...plan, graphics: [{ ...base, fontSize: 39, head: { cx: 0.23, cy: 0.25, w: 0.2, h: 0.2 } }] }).map((item) => item.code);
  assert.ok(unsafe.includes("persistent-size") && unsafe.includes("persistent-face"));
});

test("Lucide section icons are allow-listed and structure options are switchable", () => {
  assert.ok(lucideIconNames().includes("book-open"));
  assert.equal(validLucideIcon("book-open"), "book-open.svg");
  assert.equal(validLucideIcon("instagram"), "");
  const v2 = loadPreset("pingel-v2");
  assert.deepEqual([v2.graphics.persistent, v2.graphics.ladder, v2.premise.icons, v2.timeLabels.enabled], [true, true, true, true]);
  const off = mergeOverrides(v2, { noPersistentGraphics: true, noLadder: true, noPremiseIcons: true, noTimeLabels: true });
  assert.deepEqual([off.graphics.persistent, off.graphics.ladder, off.premise.icons, off.timeLabels.enabled], [false, false, false, false]);
  const on = mergeOverrides(loadPreset("clean"), { persistentGraphics: true, ladder: true, premiseIcons: true, timeLabels: true });
  assert.deepEqual([on.graphics.enabled, on.graphics.persistent, on.graphics.ladder, on.premise.icons, on.timeLabels.enabled], [true, true, true, true, true]);
});

test("persistent rendering is token-driven while a legacy card emits no structure lane", () => {
  const style = loadPreset("pingel-v2");
  const base = { name: "structure", canvas: { width: 1080, height: 1920 }, video: { duration: 30, hasAudio: false }, style, captions: [], zooms: [], broll: [], slams: [], audio: { tracks: [] } };
  const legacy = renderHTML({ ...base, graphics: [{ type: "headline", text: "Own it", eyebrow: "THE STANDARD", start: 5, duration: 4 }] }, "assets/footage.mp4");
  assert.doesNotMatch(legacy, /gfx-persistent|g-ladder-count|g\.persistent/);
  const live = { ...checklist, start: 5, duration: 20, placement: { x: 580, y: 200, w: 360, h: 500 }, duck: [{ outAt: 8.8, hiddenAt: 9, inAt: 11, shownAt: 11.2 }], items: checklist.items.slice(0, 3).map((item, i) => ({ ...item, at: i * 3 })) };
  const html = renderHTML({ ...base, graphicsSchema: 2, graphics: [live] }, "assets/footage.mp4");
  assert.match(html, /gfx-persistent/);
  assert.match(html, /--brand-accent:/);
  assert.match(html, /"persistent":true/);
  assert.match(html, /d\.hiddenAt - d\.outAt/);
});
