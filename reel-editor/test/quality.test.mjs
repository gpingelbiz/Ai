import { test } from "node:test";
import assert from "node:assert/strict";
import { alignWords } from "../src/align.mjs";
import { fixPrompt, validateEdits, applyEdits, fixHints } from "../src/correct.mjs";
import { layoutChecks, preflightText, describePreflight, SAFE } from "../src/preflight.mjs";

const W = (text, start, end, extra = {}) => ({ text, start, end, ...extra });

test("forced alignment: timings carried over by matched token, tokenization slips cost one word, bad fits rejected", () => {
  const ours = [W("Your", 0.1, 0.3), W("team", 0.3, 0.5), W("doesn't", 0.5, 0.9), W("remember", 0.9, 1.4), W("Ghost", 1.5, 1.7), W("P&L.", 1.7, 2.0)];
  const theirs = [
    { text: "Your", start: 0.14, end: 0.24 }, { text: "team", start: 0.3, end: 0.52 }, { text: "doesn't", start: 0.7, end: 1.0 },
    { text: "remember", start: 1.06, end: 1.54 }, { text: "Ghost", start: 1.62, end: 1.8 }, { text: "P", start: 1.8, end: 1.9 }, { text: "&L", start: 1.9, end: 2.1 },
  ];
  const r = alignWords(ours, theirs);
  assert.ok(r);
  assert.equal(r.matched, 5); // "P&L." has no single counterpart and keeps its own timing
  assert.equal(r.words[2].start, 0.7);
  assert.ok(r.words[5].start >= 1.7 && r.words[5].start <= 1.8, "the unmatched word only moves to stay after its neighbour");
  assert.ok(r.moved >= 2);
  // Monotonic after the move: no word starts before the previous one ends.
  for (let i = 1; i < r.words.length; i++) assert.ok(r.words[i].start >= r.words[i - 1].end - 1e-9, `word ${i}`);
  // Under 80% matched: not trusted.
  assert.equal(alignWords(ours, [{ text: "nothing", start: 0, end: 1 }]), null);
  // Everything shifted by three seconds: the audio did not match the text.
  assert.equal(alignWords(ours, theirs.map((w) => ({ ...w, start: w.start + 3, end: w.end + 3 }))), null);
});

test("caption fix: prompt lists the terms, edits are validated and applied with even timing and the sentence tail kept", () => {
  const words = [W("the", 0, 0.2), W("ghost", 0.2, 0.5, { prob: 0.3 }), W("pianel", 0.5, 0.9), W("shows", 0.9, 1.1), W("it.", 1.1, 1.4)];
  const p = fixPrompt({ words, terms: ["Ghost P&L"], names: ["Greg Pingel"], hints: fixHints(words, { items: [{ kind: "differs", start: 0.2, heard: "the [ghost pianel] shows", alt: "the [ghost panel] shows" }] }) });
  assert.match(p, /Ghost P&L; Greg Pingel/);
  assert.match(p, /word 1: heard the \[ghost pianel\] shows/);
  assert.match(p, /1:ghost 2:pianel/);
  const v = validateEdits(words, [{ i: 1, n: 2, to: "Ghost P&L" }, { i: 9, n: 1, to: "x" }, { i: 3, n: 1, to: "shows" }, { i: 0, n: 1, to: "" }]);
  assert.equal(v.dropped, null);
  assert.deepEqual(v.edits.map((e) => [e.i, e.n, e.to]), [[1, 2, "Ghost P&L"]]);
  const out = applyEdits(words, v.edits);
  assert.deepEqual(out.map((w) => w.text), ["the", "Ghost", "P&L", "shows", "it."]);
  assert.equal(out[1].start, 0.2);
  assert.equal(out[1].end, 0.55);
  assert.equal(out[2].end, 0.9);
  assert.ok(out[1].fixed && out[2].fixed && !out[3].fixed);
  // A rewrite is refused as a whole.
  const big = validateEdits(words, words.map((w, i) => ({ i, n: 1, to: w.text + "x" })));
  assert.equal(big.edits.length, 0);
  assert.match(big.dropped, /rewrite/);
  // The punctuation at the end of a replaced span stays on the last new word.
  const tail = applyEdits([W("go", 0, 0.5), W("hi", 0.5, 1.0), W("level.", 1.0, 1.5)], [{ i: 0, n: 3, to: "GoHighLevel" }]);
  assert.deepEqual(tail.map((w) => w.text), ["GoHighLevel."]);
});

test("preflight layout: captions over the chin, the hook on the face, the Instagram strip; text behind the subject is exempt", () => {
  const base = {
    canvas: { width: 1080, height: 1920 },
    style: { captions: { enabled: true, position: 0.62, fontSizeFrac: 0.04, wordsPerLine: 3 }, hook: { position: 0.2, fontSizeFrac: 0.052, style: "headline" } },
    captions: [{ start: 0, end: 1 }],
    hook: { text: "Your team forgot the meeting", start: 0, duration: 3 },
    head: { top: 0.18, bottom: 0.66 },
  };
  const codes = (p) => layoutChecks(p).map((i) => i.code).sort();
  assert.deepEqual(codes(base), ["captions-face", "hook-face"]);
  assert.deepEqual(codes({ ...base, behind: { src: "cutout.webm" }, style: { ...base.style, captions: { ...base.style.captions, position: 0.7 } } }), []);
  assert.deepEqual(codes({ ...base, head: null, style: { ...base.style, captions: { ...base.style.captions, position: 0.85 } } }), ["captions-safe-zone"]);
  assert.ok(SAFE.bottom > 0.15 && SAFE.bottom < 0.2);
  const res = { status: "warn", items: [{ level: "warn", code: "x", message: "something" }], measures: { lufs: -14.1, truePeak: -1.2, lra: 3, duration: 30.5, width: 1080, height: 1920, openMotion: 5 } };
  assert.match(preflightText(res), /check these[\s\S]*warn {2}something[\s\S]*-14.1 LUFS, peak -1.2 dBTP/);
  assert.match(describePreflight(res), /1 warning: something/);
  assert.equal(describePreflight({ status: "ok", items: [] }), "preflight: ok");
});

test("pacing checks: shots, first cut, time away and caption flashes from the plan; targets only with a pacing preset", async () => {
  const { pacingChecks } = await import("../src/preflight.mjs");
  const plan = {
    video: { duration: 20 },
    zooms: [{ t: 0.8, scale: 1.08 }, { t: 2, scale: 1 }, { t: 3.2, scale: 1.16 }],
    graphics: [{ start: 8, duration: 4 }],
    broll: [{ start: 14, duration: 2 }, { start: 16, duration: 2 }],
    coldOpen: null,
    captions: [{ start: 1, end: 1.6, text: "the call" }, { start: 1.6, end: 1.75, text: "you it" }],
    style: {},
  };
  const r = pacingChecks(plan);
  assert.equal(r.stats.firstCut, 0.8);
  assert.equal(r.stats.maxShot, 4.8, "3.2 to 8 is the longest hold");
  assert.equal(r.stats.maxAway, 4, "two cutaways back to back keep the speaker away 4 s");
  assert.deepEqual(r.items.map((i) => i.code), ["caption-speed"], "no pace targets without a pacing preset");
  const fast = pacingChecks({ ...plan, style: { pacing: { avgShot: [1.1, 1.4], maxShot: 2.8, firstCut: 1, maxAway: 3.5 } } });
  assert.deepEqual(fast.items.map((i) => i.code).sort(), ["caption-speed", "pace-average", "pace-away", "pace-longest"]);
});

test("pacing: progress milestones are small pulse events, not one long card", async () => {
  const { pacingChecks } = await import("../src/preflight.mjs");
  const plan = { video: { duration: 20 }, zooms: [], graphics: [{ type: "progress", start: 0, duration: 15, pulses: [{ at: 4, hidden: false }, { at: 9, hidden: true }, { at: 13, hidden: false }] }], broll: [], captions: [] };
  const { stats } = pacingChecks(plan);
  assert.equal(stats.firstCut, 4, "the long rail lifetime is not a card hold");
  assert.equal(stats.shots, 5, "only the two visible 1.4-second pulses add event boundaries");
});
