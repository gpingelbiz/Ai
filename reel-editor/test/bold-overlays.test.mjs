import { test } from "node:test";
import assert from "node:assert/strict";
import { registerBoldOverlay, boldOverlayKinds, boldOverlayHandler, boldOverlayPrompts, validateBoldOverlay, placeBoldOverlays, boldBoxesOverlap } from "../src/bold-overlays.mjs";
import { boldSettings, restyleBold, fallbackBoldDirection } from "../src/bold.mjs";
import { boldHTML, boldCSS, boldOverlayTimeline } from "../src/bold-render.mjs";
import { loadPreset } from "../src/presets.mjs";

test("registry has no production kinds; registration is explicit, complete and unique", () => {
  assert.deepEqual(boldOverlayKinds(), []); assert.equal(boldOverlayHandler("unknown"), null);
  assert.equal(boldOverlayPrompts(), ""); assert.equal(validateBoldOverlay({ kind: "unknown" }, {}), null);
  assert.throws(() => registerBoldOverlay("Bad name", {})); assert.throws(() => registerBoldOverlay("incomplete", {}));
  const dispose = registerBoldOverlay("fixture", { prompt: () => "Choose a grounded range", validate: (p) => p, place: () => null, html: () => "" });
  try {
    assert.match(boldOverlayPrompts(), /fixture: Choose a grounded range/);
    assert.deepEqual(boldOverlayKinds(), ["fixture"]);
    assert.throws(() => registerBoldOverlay("fixture", {}));
  } finally { dispose(); }
});

test("one placer rejects face, caption, headline, bounds and simultaneous collisions, with no phantom landing events", () => {
  const settings = boldSettings();
  const words = Array.from({ length: 12 }, (_, i) => ({ text: "said", start: i, end: i + 0.5 }));
  const context = { words, settings, fps: 30, duration: 15, zones: { safe: { x: 76, y: 200, w: 928, h: 1400 }, caption: { x: 76, y: 1000, w: 928, h: 180 }, headline: { x: 76, y: 200, w: 928, h: 150, end: 3 }, faces: [{ x: 300, y: 400, w: 400, h: 450, start: 0, end: 15 }] } };
  const dispose = registerBoldOverlay("fixture", { validate: (p) => p, place: (event) => event.proposal, html: () => "" });
  try {
    const pick = (from, box, extra = {}) => ({ kind: "fixture", from, to: from, reason: "Argument beat", proposal: { box, ...extra } });
    const free = { x: 100, y: 1300, w: 200, h: 200 };
    const accepted = placeBoldOverlays([pick(0, { x: 310, y: 410, w: 100, h: 100 }), pick(0, { x: 100, y: 1020, w: 200, h: 100 }), pick(1, { x: 100, y: 200, w: 200, h: 100 }), pick(2, { ...free, x: 0 }), pick(4, free, { landingFrame: 122 }), pick(4, free), pick(5, free), pick(6, free, { landingFrame: 999 }), pick(8, { ...free, x: NaN })], context);
    assert.deepEqual(accepted.map((event) => event.from), [4, 5]);
    assert.equal(accepted[0].landingFrame, 122); assert.equal(accepted[0].landing, 122 / 30);
    assert.equal(accepted[1].landingFrame, 150);
    assert.equal(boldBoxesOverlap(free, null), false); assert.equal(boldBoxesOverlap(free, free), true);
  } finally { dispose(); }
});

test("only accepted overlays receive markup, timeline and sound at the final frame clock", async () => {
  const words = "Ask better questions and listen to the answer before you sell".split(" ").map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));
  const picks = { ...fallbackBoldDirection(words), fallback: undefined, headline: { from: 0, to: 3, emphasis: 1, reason: "The answer" }, overlays: [{ kind: "fixture", from: 6, to: 8, reason: "Supports the answer" }] };
  let sounds = 0;
  const dispose = registerBoldOverlay("fixture", {
    prompt: "Transcript ranges only",
    validate: (pick) => ({ ...pick, holdSeconds: 1 }),
    place: (event) => ({ box: { x: 100, y: 200, w: 250, h: 150 }, landingFrame: event.startFrame + 2 }),
    html: (event, { esc }) => `<div class="fixture">${esc(words.slice(event.from, event.to + 1).map((w) => w.text).join(" "))}</div>`,
    css: () => ".bold-root .fixture { color:#F5F1E8; }",
    timeline: (event) => `tl.set(".fixture", { opacity: 1 }, ${event.landing});`,
    sounds: (event) => { sounds++; return [{ id: "sfx-fixture", start: event.landing, src: "assets/sfx/drop.wav" }]; },
  });
  try {
    const style = loadPreset("pingel-bold");
    const result = await restyleBold({ name: "overlay", preset: style.name, style, canvas: { width: 1080, height: 1920 }, words, video: { duration: 8 }, audio: { tracks: [] } }, { env: {}, picks, render: "/baseline.mp4", detect: async () => ({ frames: [{ t: 3, faces: [{ x: 0.3, y: 0.3, w: 0.3, h: 0.2 }] }] }) });
    assert.equal(result.plan.bold.overlays.length, 1); assert.equal(sounds, 1);
    const event = result.plan.bold.overlays[0];
    assert.equal(event.landing, 92 / 30); assert.equal(result.plan.audio.tracks[0].start, event.landing);
    const settings = boldSettings(style);
    assert.match(boldHTML(result.plan, { settings }), /class="fixture">the answer before/);
    assert.match(boldCSS(settings, result.plan), /\.bold-root \.fixture/);
    assert.match(boldOverlayTimeline(result.plan, settings), /tl\.set/);
    assert.equal(result.plan.bold.events[0].landing, event.landing);
    assert.equal(result.plan.captions.flatMap((g) => g.words).length, words.length);
  } finally { dispose(); }
});

test("validator and placer failures fail closed", () => {
  const dispose = registerBoldOverlay("fixture", { validate: () => { throw new Error("bad source"); }, place: () => { throw new Error("no room"); }, html: () => "" });
  try {
    assert.equal(validateBoldOverlay({ kind: "fixture" }, {}), null);
    assert.deepEqual(placeBoldOverlays([{ kind: "fixture", from: 0, to: 0 }], { words: [{ start: 0, end: 1 }], zones: {}, settings: boldSettings(), fps: 30, duration: 3 }), []);
  } finally { dispose(); }
});
