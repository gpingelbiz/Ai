import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeStructure, descriptionText, srtText, v3Timeline, endScreenPlan, sentenceLines, structurePrompt } from "../src/chapters.mjs";
import { packageYouTube } from "../src/youtube.mjs";
import { planCadence } from "../src/zooms.mjs";
import { sceneCandidates, placeScenes, graphicsCSS } from "../src/graphics.mjs";

const sentences = Array.from({ length: 60 }, (_, i) => ({ i, start: i * 10, text: `sentence ${i}.` }));

test("structure: YouTube's chapter rules, re-hook spacing, three titles", () => {
  const s = normalizeStructure({
    promise: "Own it *first*",
    chapters: [{ sentence: 0, title: "The bad number" }, { sentence: 3, title: "Too close" }, { sentence: 20, title: "What you own" }, { sentence: 59, title: "Too late" }, { sentence: 40, title: "The standard" }],
    rehooks: [{ sentence: 2, text: "too early" }, { sentence: 18, text: "Here is where it *breaks*" }, { sentence: 20, text: "too close" }, { sentence: 36, text: "Nobody tells you this" }, { sentence: 59, text: "in the end screen" }],
    titles: ["A", "B", "C", "D"], description: "What you get.", hashtags: ["sales", "#closers", "#x"], pinned: "What do you do after a bad number?",
  }, sentences, 598, { endSafe: 20 });
  assert.deepEqual(s.chapters.map((c) => [c.start, c.title]), [[0, "The bad number"], [200, "What you own"], [400, "The standard"]], "first chapter at 0:00, the one 20 s after is dropped, the one inside the last 10 s is dropped");
  assert.deepEqual(s.rehooks.map((h) => h.start), [180, 360], "re-hooks after 45 s, 90 s apart, not in the end-screen zone");
  assert.deepEqual(s.titles, ["A", "B", "C"]);
  assert.deepEqual(s.hashtags, ["#sales", "#closers", "#x"]);
  assert.equal(normalizeStructure({ chapters: [{ sentence: 0, title: "only" }, { sentence: 10, title: "two" }] }, sentences, 600).chapters.length, 0, "fewer than 3 chapters means none");
  assert.match(descriptionText(s, { duration: 600, booking: "Book a call: x" }), /^What you get\.\n\nBook a call: x\n\nChapters\n0:00 The bad number\n3:20 What you own\n6:40 The standard\n\n#sales #closers #x\n$/);
  const lines = sentenceLines([{ start: 0, end: 1, text: "Own it" }, { start: 1, end: 2, text: "first." }, { start: 2.5, end: 3, text: "Then ask." }]);
  assert.deepEqual(lines.map((l) => l.text), ["Own it first.", "Then ask."]);
  assert.match(structurePrompt({ sentences: lines, duration: 600 }), /3 to 5 chapters/);
});

test("srt, v3 timeline and the end-screen plan", () => {
  const srt = srtText([{ start: 0, end: 1, text: "own it", words: [1, 2] }, { start: 1.2, end: 2.1, text: "first", words: [1] }, { start: 6, end: 7, text: "later", words: [1] }]);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,100\nown it first\n\n2\n00:00:06,000 --> 00:00:07,000\nlater\n/);
  const v3 = v3Timeline([{ start: 0, end: 2 }, { start: 3.5, end: 5 }], { source: "a.mp4", fps: 30 });
  assert.equal(v3.v[0][1].offset, 105);
  assert.equal(v3.v[0][1].start, 60, "the second clip starts where the first ends");
  assert.equal(v3.a[0].length, 2);
  assert.deepEqual(endScreenPlan(300).start, 280);
});

test("long form: cards and cadence stay out of the last 20 s, cadence is denser early, band css exists", () => {
  const groups = Array.from({ length: 120 }, (_, i) => ({ start: 3 + i * 2.5, end: 5 + i * 2.5, text: "x", words: [] }));
  const cands = sceneCandidates(groups, 303, { hook: { start: 0, duration: 3 }, tail: 20 });
  assert.ok(cands.every((c) => c.start + 2.2 <= 283));
  const placed = placeScenes([{ type: "headline", line: 118, text: "late", duration: 5.5, eyebrow: "" }], cands, { duration: 303, tail: 20 });
  assert.equal(placed.length, 0, "a card inside the end-screen zone is dropped");
  const z = planCadence(groups, 303, [], { min: 20, earlyUntil: 180, earlyMin: 12, hook: { start: 0, duration: 3 }, tail: 20 });
  const cuts = z.filter((k) => k.cut);
  assert.ok(cuts.every((k) => k.t <= 283), "no jump cut in the last 20 s");
  const early = cuts.filter((k) => k.t < 180), late = cuts.filter((k) => k.t >= 180);
  const gap = (xs) => xs.slice(1).map((k, i) => k.t - xs[i].t);
  assert.ok(Math.min(...gap(early)) >= 12 && Math.max(...gap(early)) < 20, `early gaps 12-20: ${gap(early).slice(0, 4)}`);
  assert.ok(Math.min(...gap(late)) >= 20, "late gaps at least 20 s");
  assert.match(graphicsCSS({ W: 1920, H: 1080, colors: {}, mode: "band" }), /\.g-box \{ left: var\(--gx, 56%\); right: auto; width: var\(--gw, 40%\); top: var\(--gy, 20%\)/);
});

test("packaging writes the description, titles, srt, end screen and v3 timeline", async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), "yt-"));
  fs.writeFileSync(path.join(wd, "cuts.json"), JSON.stringify({ segments: [{ start: 0, end: 10 }, { start: 12, end: 20 }] }));
  const plan = { name: "t", source: "/x/long.mov", video: { duration: 18, fps: 30 }, canvas: { width: 1920, height: 1080 }, hook: { text: "Own it first" }, captions: [{ start: 0, end: 1, text: "own it", words: [1, 2] }], graphics: [], broll: [], slams: [], zooms: [], style: { youtube: { endSafe: 20, booking: "" } }, structure: { promise: "", chapters: [{ start: 0, title: "A" }, { start: 6, title: "B" }, { start: 12, title: "C" }], rehooks: [], titles: ["T1", "T2"], description: "d", hashtags: ["#a"], pinned: "p?" } };
  const missing = path.join(wd, "nope.mp4");
  const pkg = await packageYouTube(wd, plan, missing);
  const read = (f) => fs.readFileSync(f, "utf8");
  assert.match(read(pkg.files.description), /0:00 A\n0:06 B\n0:12 C/);
  assert.equal(read(pkg.files.titles), "1. T1\n2. T2\n");
  assert.match(read(pkg.files.srt), /own it/);
  assert.equal(read(pkg.files.pinned), "p?\n");
  assert.equal(JSON.parse(read(pkg.files.endscreen)).start, 0, "an 18 s video: the end screen starts at 0 (the plan is still written)");
  assert.equal(JSON.parse(read(pkg.files.v3)).v[0].length, 2);
  assert.match(read(pkg.files.summary), /Chapters: 3/);
  fs.rmSync(wd, { recursive: true, force: true });
});
