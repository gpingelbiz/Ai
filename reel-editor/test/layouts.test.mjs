import { test } from "node:test";
import assert from "node:assert/strict";
import { planBrollLayouts, planWindowLayout, planSplitLayout } from "../src/layouts.mjs";
import { headBoxFor, zoomDuring } from "../src/placement.mjs";
import { renderHTML } from "../src/compose.mjs";

const detectionFor = (face) => ({
  frames: [{
    faces: [{ x: face.cx - face.w / 2, y: face.cy - face.h / 2, w: face.w, h: face.h }],
    bodies: [{ x: Math.max(0, face.cx - face.w), y: Math.max(0, face.cy - face.h), w: face.w * 2, h: 0.6 }],
  }],
});

const contextFor = (face) => ({
  W: 1080,
  H: 1920,
  captionTop: 0.68,
  face,
  detection: detectionFor(face),
  zooms: [{ t: 5, scale: 1.1 }, { t: 7, scale: 1 }],
  framing: { scale: 1, origin: "50% 40%", shift: 0 },
});

const shot = { start: 5, duration: 2, motion: "in" };

test("window layout takes the empty side and never overlaps the strongest-zoom head box", () => {
  for (const [cx, side] of [[0.25, "right"], [0.75, "left"]]) {
    const face = { cx, cy: 0.4, w: 0.16, h: 0.14 };
    const context = contextFor(face);
    const planned = planWindowLayout(shot, context).shot;
    assert.equal(planned.layout, "window");
    assert.equal(planned.panel.side, side);
    assert.ok(planned.panel.x >= 76 && planned.panel.x + planned.panel.w <= 940);
    assert.ok(planned.panel.y >= 200 && planned.panel.y + planned.panel.h < context.captionTop * context.H);

    const head = headBoxFor(face, context.detection, { zoom: zoomDuring(context.zooms, shot.start, shot.start + shot.duration) });
    const hx = (head.cx - head.w / 2) * context.W, hr = (head.cx + head.w / 2) * context.W;
    assert.ok(planned.panel.x + planned.panel.w <= hx || planned.panel.x >= hr, "panel clears the whole head");
  }
});

test("window falls back to today's full cutaway when a centred wide head leaves no side", () => {
  const face = { cx: 0.5, cy: 0.45, w: 0.45, h: 0.2 };
  const result = planWindowLayout(shot, contextFor(face));
  assert.equal(result.shot.layout, "full");
  assert.match(result.skipped, /neither side/);
});

test("split centres a fitting face in the bottom half and a low face falls back to window", () => {
  const fit = { cx: 0.25, cy: 0.4, w: 0.16, h: 0.14 };
  const split = planSplitLayout(shot, contextFor(fit));
  assert.equal(split.shot.layout, "split");
  assert.equal(split.shot.split.seamY, 960);
  assert.ok(Math.abs(fit.cy + split.shot.split.footageY / 1920 - 2 / 3) < 0.001);

  const low = { cx: 0.25, cy: 0.78, w: 0.16, h: 0.14 };
  const fallback = planSplitLayout(shot, contextFor(low));
  assert.equal(fallback.shot.layout, "window");
  assert.match(fallback.skipped, /too low/);
});

test("mix alternates window, split, window in a fixed order", () => {
  const face = { cx: 0.25, cy: 0.4, w: 0.16, h: 0.14 };
  const shots = [5, 12, 19].map((start) => ({ start, duration: 2 }));
  const planned = planBrollLayouts(shots, { ...contextFor(face), layout: "mix" });
  assert.deepEqual(planned.shots.map((b) => b.layout), ["window", "split", "window"]);
  assert.equal(planned.logs.length, 3, "one log line per item");
});

const style = {
  colors: { text: "#f7f1e7", accent: "#d5ac4e", stroke: "#080808", bg: "#101010" },
  captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.07, position: 0.68, shadow: "none" },
  hook: { fontSizeFrac: 0.05, position: 0.2 },
  zooms: {}, cta: {}, broll: { cut: "hard" },
};

const renderPlan = {
  name: "layouts",
  canvas: { width: 1080, height: 1920 },
  video: { duration: 24, hasAudio: true },
  style,
  captions: [], zooms: [], graphics: [], slams: [], audio: { tracks: [] },
  framing: { scale: 1, origin: "50% 40%", shift: 0 },
};

test("renderHTML emits window and split structure, brand CSS and parseable GSAP", () => {
  const plan = {
    ...renderPlan,
    broll: [
      { start: 6, duration: 2, motion: "left", src: "assets/broll/broll-1.png", layout: "window", panel: { x: 580, y: 200, w: 360, h: 450, side: "right" } },
      { start: 14, duration: 2, motion: "in", src: "assets/broll/broll-2.png", layout: "split", split: { seamY: 960, footageY: 500 } },
    ],
  };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /class="broll broll-window clip" style="left:580px;top:200px;width:360px;height:450px/);
  assert.match(html, /border: 2px solid #f7f1e7/);
  assert.match(html, /class="broll broll-split clip"/);
  assert.match(html, /class="split-divider"/);
  assert.match(html, /background: #d5ac4e/);
  assert.match(html, /id="footage-layout"[\s\S]*id="footage-position"[\s\S]*id="video-wrap"/);
  assert.match(html, /"layout":"window"/);
  assert.match(html, /"layout":"split","footageY":500/);
  assert.match(html, /duration: 8 \/ 30, ease: "power3\.out"/);
  assert.match(html, /duration: 6 \/ 30, ease: "power2\.in"/);
  const script = html.match(/<script>\n([\s\S]*?)\n    <\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test("an explicit full layout renders exactly like a legacy plan with no layout field", () => {
  const item = { start: 6, duration: 2, motion: "left", src: "assets/broll/broll-1.png" };
  const legacy = renderHTML({ ...renderPlan, broll: [item] }, "assets/footage.mp4");
  const full = renderHTML({ ...renderPlan, broll: [{ ...item, layout: "full" }] }, "assets/footage.mp4");
  assert.equal(full, legacy);
});
