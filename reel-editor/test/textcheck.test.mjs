import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateTextSamples, expandFaceUp, runTextcheck, textSamples } from "../src/textcheck.mjs";

const ocr = ({ lines = [], faces = [] } = {}) => ({ width: 1080, height: 1920, lines, faces });
const line = (text, box) => ({ text, confidence: 0.95, box });
const face = (box) => ({ confidence: 0.9, box });

test("textcheck samples every hook, caption, premise section and card timing from the final plan", () => {
  const plan = {
    video: { duration: 12 },
    hook: { text: "Own the number", start: 0, duration: 2.5 },
    captions: [{ text: "Own it now", start: 2.5, end: 3.2 }],
    premise: { premise: "The decision", start: 2.5, duration: 8, sections: [{ at: 4, label: "First" }, { at: 7, label: "Second" }] },
    graphics: [{ type: "list", title: "Do this", start: 5, duration: 4, items: [{ text: "Call back", at: 2 }] }],
  };
  const samples = textSamples(plan);
  assert.deepEqual(samples.map((sample) => sample.kind), ["hook", "caption", "premise", "premise", "premise", "card", "card"]);
  assert.ok(samples.every((sample) => sample.at >= sample.start && sample.at <= sample.end));
  assert.equal(samples.at(-1).at, 7.2, "card item cues are offsets from the card start");
});

test("textcheck holds clipped text, face overlap, sub-0.30s timing and a hook below 80% OCR coverage", () => {
  const samples = [
    { id: "hook-0", kind: "hook", text: "Own every single number", start: 0, end: 2, duration: 2, at: 0.5, ocr: ocr({ lines: [line("Own every number", { x: 0.1, y: 0.1, w: 0.5, h: 0.05 })] }) },
    { id: "caption-0", kind: "caption", text: "Call them back", start: 2, end: 2.25, duration: 0.25, at: 2.125, ocr: ocr({ lines: [line("Call them back", { x: 0.001, y: 0.44, w: 0.4, h: 0.05 })] }) },
    { id: "caption-1", kind: "caption", text: "Make the decision", start: 3, end: 4, duration: 1, at: 3.5, ocr: ocr({ lines: [line("Make the decision", { x: 0.32, y: 0.32, w: 0.4, h: 0.07 })], faces: [face({ x: 0.4, y: 0.35, w: 0.2, h: 0.2 })] }) },
  ];
  const result = evaluateTextSamples(samples);
  assert.equal(result.verdict, "hold");
  assert.deepEqual(new Set(result.problems.map((problem) => problem.code)), new Set(["hook-ocr", "text-flash", "text-edge", "text-face"]));
  const expanded = expandFaceUp({ x: 0.4, y: 0.35, w: 0.2, h: 0.2 });
  assert.ok(Math.abs(expanded.y - 0.33) < 1e-9 && Math.abs(expanded.h - 0.22) < 1e-9);
});

test("textcheck schedules clean stand-in OCR and writes the result into the workdir", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "reel-textcheck-test-"));
  fs.mkdirSync(path.join(work, "renders"));
  fs.writeFileSync(path.join(work, "renders", "clean.mp4"), "video");
  fs.writeFileSync(path.join(work, "plan.json"), JSON.stringify({ name: "clean", video: { duration: 4 }, hook: { text: "Own every number", start: 0, duration: 2 }, captions: [] }));
  const result = await runTextcheck(work, {
    extractFrame: async (_video, _at, output) => fs.writeFileSync(output, "frame"),
    analyzeFrame: async () => ocr({ lines: [line("Own every number", { x: 0.1, y: 0.1, w: 0.5, h: 0.05 })] }),
  });
  assert.equal(result.verdict, "schedule");
  assert.equal(JSON.parse(fs.readFileSync(path.join(work, "textcheck.json"), "utf8")).verdict, "schedule");
});

test("textcheck fails closed and still writes a hold when its inputs are unavailable", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "reel-textcheck-hold-"));
  const result = await runTextcheck(work);
  assert.equal(result.verdict, "hold");
  assert.match(result.notes[0], /no plan\.json/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(work, "textcheck.json"), "utf8")).verdict, "hold");
});

test("a few flashing caption lines are a note, systemic flashes and a flashing hook hold", async () => {
  const { evaluateTextSamples } = await import("../src/textcheck.mjs");
  const ocr = JSON.stringify({ width: 1080, height: 1920, lines: [], faces: [] });
  const caption = (i, duration) => ({ id: `c${i}`, kind: "caption", at: i, duration, text: "", ocr });
  const fewFlashes = [...Array(30)].map((_, i) => caption(i, i < 2 ? 0.12 : 0.8));
  assert.equal(evaluateTextSamples(fewFlashes).verdict, "schedule");
  const manyFlashes = [...Array(30)].map((_, i) => caption(i, i < 5 ? 0.12 : 0.8));
  assert.equal(evaluateTextSamples(manyFlashes).verdict, "hold");
  const hookFlash = [...fewFlashes, { id: "h", kind: "hook", at: 0, duration: 0.2, text: "", ocr }];
  assert.equal(evaluateTextSamples(hookFlash, { hookCoverage: 0 }).verdict, "hold");
});
