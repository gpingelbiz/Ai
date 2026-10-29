import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderHTML } from "../src/compose.mjs";
import { chooseEvidenceLayout, evidenceSlideHTML, evidenceTiming, pairEvidenceFiles, parseEvidenceSpec, parseOcrJSON, redactionsFor, renderedEvidenceTextPx } from "../src/evidence.mjs";
import { evidenceChecks } from "../src/preflight.mjs";
import { loadPreset, mergeOverrides } from "../src/presets.mjs";

const ocr = parseOcrJSON(`Vision log\n{"width":1000,"height":1600,"lines":[{"text":"He sent the exact message","confidence":0.91,"box":{"x":0.1,"y":0.2,"w":0.7,"h":0.04}}],"faces":[{"confidence":0.8,"box":{"x":0.7,"y":0.1,"w":0.2,"h":0.2}}]}`);

test("evidence specs, watcher pairing and Vision JSON parsing are deterministic", () => {
  assert.deepEqual(parseEvidenceSpec("proof.png@4.5|His DM, Oct 2026"), { file: path.resolve("proof.png"), at: 4.5, label: "His DM, Oct 2026" });
  assert.deepEqual(pairEvidenceFiles("IMG_1163__A hook.mov", ["other proof.png", "IMG_1163 receipt.jpg", "IMG_1163 proof 2.jpeg", "IMG_1163 proof.mov"]), ["IMG_1163 proof 2.jpeg", "IMG_1163 receipt.jpg"]);
  assert.equal(ocr.lines[0].text, "He sent the exact message");
  assert.equal(ocr.faces[0].box.x, 0.7);
});

test("privacy patterns cover phones, email, address, cards, extra words and faces while keeping brand identity", () => {
  const sample = {
    width: 1000,
    height: 1000,
    lines: [
      { text: "@calmcoach Calm Coach", confidence: 1, box: { x: 0.05, y: 0.05, w: 0.8, h: 0.04 } },
      { text: "a.person@example.com (480) 555-1212 480-555-1212 480.555.1212", confidence: 1, box: { x: 0.05, y: 0.15, w: 0.9, h: 0.04 } },
      { text: "123 Main Street 4111 1111 1111 1111 private", confidence: 1, box: { x: 0.05, y: 0.25, w: 0.9, h: 0.04 } },
    ],
    faces: [{ box: { x: 0.7, y: 0.4, w: 0.2, h: 0.2 } }],
  };
  const found = redactionsFor(sample, { extraWords: ["private"], identity: { handle: "@calmcoach", name: "Calm Coach" } });
  assert.equal(found.filter((item) => item.what === "phone").length, 3);
  for (const kind of ["email", "address", "digits", "extra", "face"]) assert.ok(found.some((item) => item.what === kind), kind);
  assert.ok(!found.some((item) => /calmcoach|Calm Coach/i.test(item.match)));
});

test("evidence timing prefers quoted OCR, then a pointing phrase, then supplied seconds", () => {
  const transcript = [
    { i: 0, start: 1, text: "Let me explain what happened" },
    { i: 1, start: 4, text: "He sent the exact message yesterday" },
    { i: 2, start: 9, text: "Look at this before we continue" },
  ];
  const quoted = evidenceTiming({ ocrLines: ocr.lines, transcript, at: 12, duration: 20 });
  assert.equal(quoted.start, 4);
  assert.equal(quoted.reason, "quoted text");
  assert.ok(quoted.duration >= 3.5 && quoted.duration <= 6);
  const pointed = evidenceTiming({ ocrLines: [{ text: "unrelated words" }], transcript, duration: 20 });
  assert.equal(pointed.start, 9);
  assert.equal(pointed.reason, "pointing phrase");
  const supplied = evidenceTiming({ ocrLines: [], transcript: transcript.slice(0, 1), at: 6.2, duration: 20 });
  assert.equal(supplied.start, 6.2);
  assert.equal(evidenceTiming({ ocrLines: [], transcript: transcript.slice(0, 1), duration: 20 }).skip, true);
});

test("layout choice and 32px source-text rule are explicit", () => {
  assert.equal(chooseEvidenceLayout({ quoted: [{}], cutoutAvailable: true, talkingHead: true }), "focus");
  assert.equal(chooseEvidenceLayout({ cutoutAvailable: true, talkingHead: true }), "over");
  assert.equal(chooseEvidenceLayout({ requested: "over", cutoutAvailable: false, talkingHead: true }), "card");
  assert.equal(renderedEvidenceTextPx([{ box: { h: 0.02 } }], { h: 1200 }, 1), 24);
  assert.equal(renderedEvidenceTextPx([{ box: { h: 0.02 } }], { h: 1200 }, 2), 48);
});

test("evidence still HTML uses cleaned source, escaped label and brand tokens", () => {
  const html = evidenceSlideHTML({ cleanedFile: "clean.png", label: "His DM < real" }, loadPreset("clean").brand);
  assert.match(html, /width:1080px;height:1350px/);
  assert.match(html, /clean\.png/);
  assert.match(html, /His DM &lt; real/);
  assert.match(html, /var\(--brand-accent\)/);
});

test("reel HTML renders the cleaned evidence asset, title plate and deterministic timeline", () => {
  const style = loadPreset("clean");
  const item = {
    src: "assets/evidence/1.png", cleanedFile: "clean.png", start: 4, duration: 4, layout: "focus", label: "His DM",
    box: { x: 0, y: 0, w: 1080, h: 1920 }, media: { x: 0, y: 0, w: 1080, h: 1920 }, imageBox: { x: 0, y: 96, w: 1080, h: 1728 },
    labelBox: { x: 76, y: 200, w: 864, h: 96 }, plate: { radius: 12, paddingX: 24, paddingY: 12, rulePosition: "top", ruleThickness: 4 },
    highlights: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.04 }], zoom: 1.4, x: -100, y: -180,
    motion: { enter: 0.2, exit: 0.2, enterEase: style.brand.motion.enterEase, exitEase: style.brand.motion.exitEase, slide: style.brand.spacing.md, zoomStart: 4.2, zoomDuration: 3.6 },
  };
  const plan = { name: "evidence", canvas: { width: 1080, height: 1920 }, video: { duration: 10, hasAudio: false }, style, hook: null, premise: null, cta: null, captions: [], graphics: [], evidence: [item], zooms: [], broll: [], slams: [], audio: { tracks: [] } };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /class="evidence evidence-focus/);
  assert.match(html, /assets\/evidence\/1\.png/);
  assert.match(html, /evidence-rule-top/);
  assert.match(html, /PLAN\.evidence\.forEach/);
});

test("evidence preflight requires provenance and reports weak OCR, private digits and proof overlap", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-check-"));
  const sourceFile = path.join(dir, "source.png"), recordFile = path.join(dir, "1.json");
  fs.writeFileSync(sourceFile, "image");
  fs.writeFileSync(recordFile, JSON.stringify({ ocr: [{ text: "123456789", confidence: 0.3 }], redactions: [], longDigitRuns: true }));
  const plan = { evidence: [{ sourceFile, recordFile, start: 4, duration: 4, textPx: 31 }], graphics: [{ type: "message", mode: "proof", start: 5, duration: 2 }] };
  const codes = evidenceChecks(plan).map((item) => item.code);
  for (const code of ["evidence-ocr", "evidence-private-digits", "evidence-legibility", "evidence-proof-overlap"]) assert.ok(codes.includes(code), code);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("evidence defaults and CLI-only redaction escape hatch preserve no-evidence HTML", () => {
  const style = loadPreset("clean");
  assert.deepEqual(style.evidence, { enabled: true, layout: "auto", redact: true });
  const off = mergeOverrides(style, { evidence: ["one.png"], evidenceLayout: "focus", redact: ["secret"], noRedact: true });
  assert.equal(off.evidence.redact, false);
  assert.equal(off.evidence.layout, "focus");
  assert.deepEqual(off.evidence.items, ["one.png"]);
  assert.deepEqual(off.evidence.extraWords, ["secret"]);
  const plan = { name: "plain", canvas: { width: 1080, height: 1920 }, video: { duration: 3, hasAudio: false }, style, hook: null, premise: null, cta: null, captions: [], graphics: [], zooms: [], broll: [], slams: [], audio: { tracks: [] } };
  assert.equal(renderHTML(plan, "assets/footage.mp4"), renderHTML({ ...plan, evidence: [] }, "assets/footage.mp4"));
});
