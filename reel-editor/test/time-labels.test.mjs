import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { parseTimeLabelsReply, planTimeLabels, timeLabelGeometry, timeLabelsPrompt } from "../src/time-labels.mjs";

const lines = [
  { i: 0, start: 1, text: "At 5 AM I woke up" },
  { i: 1, start: 4, text: "Day one we made the calls" },
  { i: 2, start: 6, text: "By Friday the board was full" },
  { i: 3, start: 8, text: "Three months later it changed" },
  { i: 4, start: 14, text: "Two years later we knew why" },
];

test("time labels are exact, outside the hook, three seconds apart and capped at six", () => {
  const raw = { labels: [
    { text: "At 5 AM", line: 0 },
    { text: "Day one", line: 1 },
    { text: "By Friday", line: 2 },
    { text: "Three months later", line: 3 },
    { text: "a year later", line: 3 },
    { text: "Two years later", line: 4 },
  ] };
  const result = planTimeLabels(raw, { lines, hook: { start: 0, duration: 3 }, duration: 20 });
  assert.deepEqual(result.labels.map((item) => [item.text, item.at, item.duration, item.icon]), [
    ["Day one", 4, 4, "calendar.svg"],
    ["Three months later", 8, 4, "calendar.svg"],
    ["Two years later", 14, 4, "calendar.svg"],
  ]);
  assert.ok(result.dropped.some((reason) => /during the hook/.test(reason)));
  assert.ok(result.dropped.some((reason) => /under 3s/.test(reason)));
  assert.ok(result.dropped.some((reason) => /not said/.test(reason)));
  assert.deepEqual(parseTimeLabelsReply({ labels: [{ text: "  Day one  ", line: "1" }] }), [{ text: "Day one", line: 1 }]);
  assert.match(timeLabelsPrompt({ lines, hook: { start: 0, duration: 3 } }), /Copy each phrase exactly/);
});

test("time label geometry clears premise, captions and head, then renders brand tokens and Lucide", () => {
  const style = loadPreset("pingel-v2");
  const premise = { box: { x: 76, y: 200, w: 864, h: 100 } };
  const geometry = timeLabelGeometry({ brand: style.brand, premise, captionTop: 1200 });
  assert.equal(geometry.skip, undefined);
  assert.equal(geometry.box.x, 76);
  assert.ok(geometry.box.y > premise.box.y + premise.box.h && geometry.fontSize >= 40 && geometry.fontSize <= 44);
  assert.equal(timeLabelGeometry({ brand: style.brand, premise, captionTop: 350 }).skip, true);
  assert.equal(timeLabelGeometry({ brand: style.brand, premise, captionTop: 1200, head: { cx: 0.2, cy: 0.2, w: 0.3, h: 0.3 } }).skip, true);

  const item = { text: "Day one < now", line: 1, at: 4, duration: 4, icon: "calendar.svg", ...geometry };
  const plan = { name: "times", canvas: { width: 1080, height: 1920 }, video: { duration: 12, hasAudio: false }, style, captions: [], graphics: [], zooms: [], broll: [], slams: [], timeLabels: [item], audio: { tracks: [] } };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /id="time-label-0"/);
  assert.match(html, /Day one &lt; now/);
  assert.match(html, /time-label-icon"><svg/);
  assert.match(html, /font-family: var\(--brand-body-font\)/);
  assert.match(html, /PLAN\.timeLabels\.forEach/);
});
