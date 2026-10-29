import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset, mergeOverrides } from "../src/presets.mjs";
import { layoutChecks, premiseChecks } from "../src/preflight.mjs";
import { exactLineMatches, makePremise, parsePremiseReply, planPremise, premiseDuckSchedule, premiseGeometry, premisePrompt } from "../src/premise.mjs";

const lines = [
  { i: 0, start: 0, text: "Here are three ways to lead" },
  { i: 1, start: 5, text: "First um make the calls" },
  { i: 2, start: 7, text: "Second own the outcome" },
  { i: 3, start: 10, text: "Third ask what happened" },
  { i: 4, start: 14, text: "Then listen to them" },
  { i: 5, start: 18, text: "Write down the truth" },
  { i: 6, start: 22, text: "Call the next person" },
  { i: 7, start: 26, text: "Repeat the whole process" },
  { i: 8, start: 30, text: "Coach the same behavior" },
];

test("premise reply parsing and prompt keep the output small and explicit", () => {
  assert.deepEqual(parsePremiseReply('Here: ```json\n{"premise":"three ways","sections":[{"label":"make the calls","line":"1"}]}\n```'), { premise: "three ways", sections: [{ label: "make the calls", line: 1 }] });
  assert.deepEqual(parsePremiseReply({ premise: null, sections: "no" }), { premise: "", sections: [] });
  const prompt = premisePrompt({ lines: lines.slice(0, 2), hook: "Three ways to lead" });
  assert.match(prompt, /Otherwise return \{"premise":null,"sections":\[\]\}/);
  assert.match(prompt, /Every word must be copied/);
  assert.match(prompt, /^1: 5\.00s First um make the calls$/m);
});

test("premise validator drops words that were not said; a forced premise stays with a warning", () => {
  const bad = planPremise({ premise: "three secret systems", sections: [] }, { lines, duration: 35 });
  assert.equal(bad.plan, null);
  assert.match(bad.dropped[0], /outside the transcript or hook/);

  const forced = planPremise({ premise: "private framework", sections: [] }, { lines, duration: 35, forced: true });
  assert.equal(forced.plan.premise, "private framework");
  assert.equal(forced.plan.forced, true);
  assert.ok(forced.warnings.some((warning) => /outside the transcript or hook/.test(warning)));
});

test("section labels ground to the spoken line, allow dropped filler, enforce spacing and cap at six", () => {
  assert.deepEqual(exactLineMatches(lines, "make the calls"), [1]);
  const result = planPremise({
    premise: "three ways to lead",
    sections: [
      { label: "make the calls", line: 0 },
      { label: "own the outcome", line: 2 },
      { label: "ask what happened", line: 3 },
      { label: "listen to them", line: 4 },
      { label: "write down the truth", line: 5 },
      { label: "call the next person", line: 6 },
      { label: "repeat the whole process", line: 7 },
      { label: "coach the same behavior", line: 8 },
      { label: "invented stage", line: 9 },
    ],
  }, { lines, hook: "Three ways to lead", duration: 35 });
  assert.deepEqual(result.plan.sections.map((section) => [section.label, section.line, section.at]), [
    ["make the calls", 1, 5],
    ["ask what happened", 3, 10],
    ["listen to them", 4, 14],
    ["write down the truth", 5, 18],
    ["call the next person", 6, 22],
    ["repeat the whole process", 7, 26],
  ]);
  assert.ok(result.dropped.some((reason) => /2s after/.test(reason)), "the close section is dropped");
  assert.ok(result.dropped.some((reason) => /6-section cap/.test(reason)), "the seventh valid section is dropped");
  assert.ok(result.dropped.some((reason) => /outside the transcript or hook/.test(reason)), "invented section words are dropped");
  assert.deepEqual(Object.keys(result.plan).sort(), ["duration", "forced", "premise", "sections", "start"]);
  assert.equal(result.plan.start, 0.5);
  assert.equal(result.plan.duration, 34.5);
});

test("hook timing controls strip entry and a whole-reel hook leaves no strip window", () => {
  const raw = { premise: "three ways to lead", sections: [] };
  assert.equal(planPremise(raw, { lines, hook: { text: "Three ways to lead", start: 0, duration: 3 }, duration: 35 }).plan.start, 3);
  assert.equal(planPremise(raw, { lines, hook: { text: "Three ways to lead", start: 0, duration: 35 }, duration: 35 }).plan, null);
});

test("a CLI-forced premise keeps the hook timing through the async planner", async () => {
  const plan = await makePremise({ workDir: ".", groups: lines, hook: { text: "Three ways to lead", start: 0, duration: 3 }, duration: 35, settings: { mode: "on", text: "three ways to lead" } });
  assert.equal(plan.start, 3);
  assert.equal(plan.duration, 32);
});

test("duck schedule merges overlapping cards and slams, ignores a card outside the strip, and uses six-frame fades", () => {
  const schedule = premiseDuckSchedule({
    box: { x: 76, y: 200, w: 864, h: 120 },
    cards: [
      { type: "headline", start: 6, duration: 3 },
      { type: "headline", start: 11, duration: 2, box: { x: 76, y: 800, w: 400, h: 200 } },
      { type: "list", start: 12, duration: 2, box: { x: 100, y: 220, w: 600, h: 300 } },
      { type: "progress", start: 0, duration: 20 },
    ],
    slams: [{ t: 8.5, end: 10 }],
    start: 3,
    end: 20,
    fps: 30,
  });
  assert.deepEqual(schedule, [
    { outAt: 5.8, hiddenAt: 6, inAt: 10, shownAt: 10.2 },
    { outAt: 11.8, hiddenAt: 12, inAt: 14, shownAt: 14.2 },
  ]);
});

test("brand-token geometry and rendering produce the fixed strip, section swaps and no card warnings", () => {
  const style = loadPreset("pingel-v2");
  const geometry = premiseGeometry({ brand: style.brand, sections: [{ label: "make the calls" }], headTop: 0.3, captionTop: 1200 });
  assert.equal(geometry.skip, undefined);
  assert.ok(geometry.fontSize >= 44 && geometry.fontSize <= 52);
  assert.equal(geometry.box.x, 76);
  assert.ok(geometry.box.y >= 200 && geometry.box.y + geometry.box.h <= 330);

  const premise = { premise: "three ways < lead", sections: [{ label: "make the calls", line: 1, at: 5 }], start: 3, duration: 17, forced: false, ...geometry, headTop: 0.3, duck: [{ outAt: 7.8, hiddenAt: 8, inAt: 10, shownAt: 10.2 }] };
  const plan = {
    name: "premise", canvas: { width: 1080, height: 1920 }, video: { duration: 20, hasAudio: false }, style,
    hook: { text: "Three ways to lead", start: 0, duration: 3 }, premise, captions: [], graphics: [], zooms: [], broll: [], slams: [], audio: { tracks: [] },
  };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /id="premise-strip"/);
  assert.match(html, /three ways &lt; lead/);
  assert.match(html, /--brand-accent: #C8A24B/);
  assert.match(html, /const swap = 8 \/ \(PLAN\.fps \|\| 30\)/);
  assert.match(html, /d\.hiddenAt - d\.outAt/);
  assert.deepEqual(premiseChecks(plan), []);
  assert.ok(!layoutChecks(plan).some((item) => item.code.startsWith("card-")), "the full strip lifetime is exempt from card hold and occupancy rules");
});

test("premise preflight checks minimum size, safe bounds and the measured head top", () => {
  const plan = {
    canvas: { width: 1080, height: 1920 },
    style: { captions: { enabled: true, position: 0.7, fontSizeFrac: 0.04 } },
    captions: [{ start: 0, end: 10 }],
    premise: { premise: "three ways", sections: [], fontSize: 42, box: { x: 60, y: 180, w: 900, h: 180 }, headTop: 0.17 },
  };
  assert.deepEqual(premiseChecks(plan).map((item) => item.code).sort(), ["premise-bounds", "premise-head", "premise-size"]);
});

test("premise preset and CLI overrides leave every existing preset off except pingel-v2", () => {
  assert.equal(loadPreset("clean").premise.mode, "off");
  assert.equal(loadPreset("pingel-brand").premise.mode, "off");
  assert.equal(loadPreset("pingel-v2").premise.mode, "auto");
  const base = loadPreset("clean");
  assert.deepEqual(mergeOverrides(base, { premise: "own the outcome" }).premise, { mode: "on", text: "own the outcome" });
  assert.deepEqual(mergeOverrides(base, { premiseMode: "auto" }).premise, { mode: "auto" });
  assert.deepEqual(mergeOverrides(loadPreset("pingel-v2"), { noPremise: true }).premise, { mode: "off", text: null });
});
