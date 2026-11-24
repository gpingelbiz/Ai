import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GATE_RULES, captionProblems, ctaNotes, ctaProblems, gateFixes, gateText, gateTimes, isolationHtml, layerMask, layoutProblems,
  contrastProblems, silentCaptions, fillerCard, letterContrast, measureLayers, overlapCount, planFixes, tidyCardText, rootLayers, runGate, safeZoneSpill, spokenNearMiss,
} from "../src/gate.mjs";
import { findSignOff } from "../src/cuts.mjs";
import { autoCta } from "../src/hook.mjs";

const W = 1080, H = 1920;
/** A black 1080x1920 frame with white rectangles painted on it (pngjs-shaped). */
function frame(rects = []) {
  const data = new Uint8Array(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const { x, y, w, h } of rects) {
    for (let yy = y; yy < Math.min(H, y + h); yy++) for (let xx = x; xx < Math.min(W, x + w); xx++) data.set([255, 255, 255], (yy * W + xx) * 4);
  }
  return { width: W, height: H, data };
}
const blank = frame();
const mask = (rects) => layerMask(frame(rects), blank);

const PAGE = `<!doctype html><html><head><style>#root{}</style></head><body>
  <div id="root" data-composition-id="reel" data-duration="25">
    <div id="video-wrap"><div id="drift-wrap"><video id="footage" src="a.mp4" data-start="0" data-duration="25"></video></div></div>
    <div id="defocus"></div>
    <!-- a comment with words in it -->
    <div id="hook" class="clip" data-start="0" data-duration="4"><div id="hook-block"><div id="hook-lines"><span class="hw">The</span> <span>question</span></div></div></div>
    <img src="x.png" alt="">
    <div id="captions"><div class="cap" id="cap-0"><span class="w">When</span><br><span>I</span></div></div>
    <div id="gfx-0" data-start="6" data-duration="2"><svg><path d="M0 0" /></svg><p>3 steps &amp; done</p></div>
    <div id="progress-0" data-start="0" data-duration="25">&nbsp;</div>
    <script>const words = "not a layer's text";</script>
    <audio id="music" src="m.m4a" data-start="0.5" data-duration="24"></audio>
  </div>
</body></html>`;

test("rootLayers lists #root's element children in nth-child order with timing and whether they hold words", () => {
  const layers = rootLayers(PAGE);
  assert.deepEqual(layers.map((l) => [l.index, l.id, l.tag, l.text]), [
    [1, "video-wrap", "div", false], [2, "defocus", "div", false], [3, "hook", "div", true], [4, null, "img", false],
    [5, "captions", "div", true], [6, "gfx-0", "div", true], [7, "progress-0", "div", false], [8, null, "script", false], [9, "music", "audio", false],
  ]);
  const hook = layers.find((l) => l.id === "hook");
  assert.equal(hook.start, 0);
  assert.equal(hook.duration, 4);
  assert.ok(Number.isNaN(layers.find((l) => l.id === "captions").duration));
  assert.deepEqual(rootLayers("<div>no root</div>"), []);
});

test("gateTimes samples inside each timed text layer and across the reel for captions", () => {
  const layers = rootLayers(PAGE).filter((l) => l.text);
  const times = gateTimes(layers, 25);
  for (const t of [0.6, 2, 6.6, 7, 7.7]) assert.ok(times.includes(t), `missing ${t}`);
  assert.ok(times.some((t) => t > 3.5 && t < 4), "the end of the hook is looked at");
  assert.equal(times.filter((t) => t > 8).length, 4, "captions get spread points");
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.ok(gateTimes(layers, 25, { max: 5 }).length === 5);
  assert.deepEqual(gateTimes(layers, 0), []);
});

test("isolationHtml hides every root layer but one", () => {
  assert.match(isolationHtml(PAGE, 3), /#root > \*:not\(:nth-child\(3\)\) \{ opacity: 0 !important; \}<\/style><\/head>/);
  assert.match(isolationHtml(PAGE), /#root > \* \{ opacity: 0 !important; \}/);
});

test("masks, overlap and the safe zone read real pixel extents", () => {
  const hook = mask([{ x: 227, y: 925, w: 626, h: 150 }]);
  assert.deepEqual(hook.box, { x: 228, y: 926, w: 626, h: 150 });
  const touching = mask([{ x: 215, y: 1072, w: 595, h: 75 }]);
  const clear = mask([{ x: 215, y: 1140, w: 595, h: 75 }]);
  assert.ok(overlapCount(hook, touching) > GATE_RULES.minOverlap);
  assert.equal(overlapCount(hook, clear), 0);
  assert.equal(safeZoneSpill(hook).share, 0);
  const low = safeZoneSpill(mask([{ x: 200, y: 1560, w: 600, h: 100 }]));
  assert.deepEqual(low.edges, ["bottom"]);
  assert.ok(low.share > 0.5);
  assert.deepEqual(safeZoneSpill(mask([{ x: 700, y: 1100, w: 300, h: 60 }])).edges, ["buttons"]);
  const wide = { ...mask([{ x: 200, y: 1560, w: 600, h: 100 }]), W: 1920, H: 1080 };
  assert.deepEqual(safeZoneSpill(wide), { share: 0, edges: [] }, "a landscape render has no Instagram overlay");
});

test("layoutProblems flags touching text and the safe zone, and skips full-screen layers", () => {
  const layers = rootLayers(PAGE);
  const frames = [
    { t: 0.6, layers: { 3: mask([{ x: 227, y: 925, w: 626, h: 150 }]), 5: mask([{ x: 215, y: 1072, w: 595, h: 75 }]) } },
    { t: 2, layers: { 3: mask([{ x: 227, y: 925, w: 626, h: 150 }]), 5: mask([{ x: 215, y: 1076, w: 595, h: 75 }]) } },
    { t: 6.6, layers: { 5: mask([{ x: 215, y: 1250, w: 595, h: 75 }]), 6: mask([{ x: 0, y: 0, w: 1080, h: 1500 }]) } },
    { t: 7, layers: { 5: mask([{ x: 215, y: 1250, w: 595, h: 75 }]), 6: mask([{ x: 300, y: 1240, w: 400, h: 120 }]) } },
    { t: 9, layers: { 5: mask([{ x: 215, y: 1620, w: 595, h: 75 }]) } },
  ];
  const problems = layoutProblems(frames, layers);
  const overlap = problems.filter((p) => p.code === "text-overlap");
  assert.equal(overlap.length, 2);
  assert.deepEqual(overlap[0].layers, ["hook", "captions"]);
  assert.deepEqual(overlap[0].times, [0.6, 2], "one problem per pair, every time it happens");
  assert.deepEqual(overlap[1].kinds, ["captions", "card"]);
  assert.deepEqual(overlap[1].times, [7], "the full-screen card at 6.6 s is not text on text");
  const safe = problems.filter((p) => p.code === "safe-zone");
  assert.equal(safe.length, 1);
  assert.deepEqual(safe[0].edges, ["bottom"]);
});

test("captionProblems catches doubled words and a word followed by its own tail", () => {
  const cap = (texts, start) => ({ start, end: start + 1, text: texts.join(" "), words: texts.map((text, i) => ({ text, start: start + i * 0.3, end: start + i * 0.3 + 0.2 })) });
  const plan = { captions: [cap(["for", "the", "spring", "Bootcamp"], 19.8), cap(["Camp."], 21.04), cap(["the", "the", "plan"], 22), cap(["very", "very", "good"], 23)] };
  const problems = captionProblems(plan);
  assert.deepEqual(problems.map((p) => [p.cap, p.word]), [[1, 0], [2, 1]]);
  assert.match(problems[0].message, /bootcamp camp/);
  assert.deepEqual(captionProblems({ captions: [cap(["Camp", "followed"], 0), cap(["by", "camping"], 1)] }), []);
});

test("ctaProblems finds a spoken ask the cut lost, and leaves kept asks and sign-offs alone", () => {
  const words = (text, start, drop = null) => text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.25, ...(drop ? { drop } : {}) }));
  const body = words("Asking for help is a proven winning strategy.", 0);
  const ask = "I invite you to join me for the spring Bootcamp.";
  const lost = { originalDuration: 8, words: [...body, ...words(ask, 4, "ending")] };
  const [problem] = ctaProblems(lost);
  assert.equal(problem.code, "cta-cut");
  assert.equal(problem.endAfter, "I invite you to join me for the spring Bootcamp");
  assert.deepEqual(ctaProblems({ originalDuration: 8, words: [...body, ...words(ask, 4)] }), []);
  assert.deepEqual(ctaProblems({ originalDuration: 8, words: [...body, ...words("Link in bio.", 4, "sign-off")] }), []);
  const retake = { originalDuration: 12, words: [...body, ...words("Join me for the bootcamp.", 4, "retake"), ...words("Join me for the bootcamp.", 7)] };
  assert.deepEqual(ctaProblems(retake), [], "a dropped retake of an ask that is kept later");
  assert.deepEqual(ctaProblems(null), []);
  assert.equal(ctaNotes({ words: body }).length, 1);
  assert.deepEqual(ctaNotes({ words: words("Comment BOOTCAMP below.", 0) }), []);
});

test("a closing invitation is the point of the reel, not a sign-off to trim", () => {
  const line = (text, start) => text.split(" ").map((text, i) => ({ text, start: start + i * 0.3, end: start + i * 0.3 + 0.24 }));
  for (const ask of ["I invite you to join me for the Bootcamp.", "So join me in January.", "Book a call with me today.", "I'd love to invite you to the retreat."]) {
    const words = [...line("Price the work.", 0), ...line("That's it for today.", 1.2), ...line(ask, 2.6)];
    assert.equal(findSignOff(words, words.at(-1).end + 0.2), -1, ask);
  }
});

const layersForFix = rootLayers(PAGE);
const basePlan = () => ({
  canvas: { width: W, height: H },
  style: { captions: { position: 0.58, placeMin: 0.58, placeMax: 0.79 }, hook: { position: 0.481 } },
  graphics: [{ type: "list", start: 6, duration: 2 }, { type: "stat", start: 12, duration: 2 }],
  captions: [{ start: 0, end: 1, text: "Bootcamp Camp", words: [{ text: "Bootcamp", start: 0, end: 0.4 }, { text: "Camp", start: 0.4, end: 0.8 }] }, { start: 1, end: 2, text: "Camp", words: [{ text: "Camp", start: 1, end: 1.4 }] }],
});

test("gateFixes moves the captions below the measured hook, or the hook up when the captions cannot move", () => {
  const frames = [
    { t: 0.6, layers: { 3: mask([{ x: 227, y: 925, w: 626, h: 150 }]), 5: mask([{ x: 215, y: 1072, w: 595, h: 75 }]) } },
    { t: 9, layers: { 5: mask([{ x: 215, y: 1072, w: 595, h: 75 }]) } },
  ];
  const problems = layoutProblems(frames, layersForFix);
  const { plan, applied, unfixable } = gateFixes(problems, basePlan(), { frames, layers: layersForFix });
  const shift = (926 + 150 + GATE_RULES.gap) - 1072;
  assert.equal(plan.style.captions.position, Math.round((0.58 + shift / H) * 1000) / 1000);
  assert.equal(plan.style.captions.placeMin, plan.style.captions.position);
  assert.equal(plan.style.captions.placeMax, 0.79);
  assert.match(applied[0], /captions moved down/);
  assert.deepEqual(unfixable, []);

  // Captions already near the Instagram strip: the hook goes up instead.
  const low = [{ t: 0.6, layers: { 3: mask([{ x: 227, y: 1420, w: 626, h: 150 }]), 5: mask([{ x: 215, y: 1560, w: 595, h: 30 }]) } }];
  const up = gateFixes(layoutProblems(low, layersForFix), basePlan(), { frames: low, layers: layersForFix });
  assert.ok(up.plan.style.hook.position < 0.481);
  assert.equal(up.plan.style.captions.position, 0.58);
  assert.match(up.applied[0], /hook moved up/);
});

test("gateFixes drops a card that touches text, and takes a doubled caption word out", () => {
  const frames = [{ t: 7, layers: { 5: mask([{ x: 215, y: 1250, w: 595, h: 75 }]), 6: mask([{ x: 300, y: 1240, w: 400, h: 120 }]) } }];
  const problems = [...layoutProblems(frames, layersForFix), ...captionProblems(basePlan())];
  const { plan, applied, unfixable } = gateFixes(problems, basePlan(), { frames, layers: layersForFix });
  assert.deepEqual(plan.graphics.map((g) => g.type), ["stat"]);
  assert.equal(plan.captions[0].text, "Bootcamp");
  assert.equal(plan.captions.length, 1, "the emptied caption hands its time to the one before");
  assert.equal(plan.captions[0].end, 2);
  assert.equal(applied.length, 3);
  assert.deepEqual(unfixable, []);
  assert.equal(basePlan().graphics.length, 2, "the input plan is not changed");
});

function workFolder(plan, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-test-"));
  fs.mkdirSync(path.join(dir, "project"));
  fs.writeFileSync(path.join(dir, "project", "index.html"), PAGE);
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan));
  for (const [name, value] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  return dir;
}

test("runGate returns a fixed plan, then holds what it cannot fix and marks the text check as held", async () => {
  const overlapping = { layers: layersForFix, times: [0.6], frames: [{ t: 0.6, layers: { 3: mask([{ x: 227, y: 925, w: 626, h: 150 }]), 5: mask([{ x: 215, y: 1072, w: 595, h: 75 }]) } }] };
  const plan = { ...basePlan(), video: { duration: 25 }, captions: [] };
  const dir = workFolder(plan, { "textcheck.json": { verdict: "schedule", notes: [], problems: [] } });
  const first = await runGate(dir, { measure: async () => overlapping });
  assert.equal(first.verdict, "fix");
  assert.ok(first.plan.style.captions.position > 0.58);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "textcheck.json"), "utf8")).verdict, "schedule", "a fix round does not hold");

  const last = await runGate(dir, { round: GATE_RULES.maxRounds, fixes: first.fixes, measure: async () => overlapping });
  assert.equal(last.verdict, "hold");
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "gate.json"), "utf8"));
  assert.equal(saved.verdict, "hold");
  assert.deepEqual(saved.fixes, first.fixes);
  const tc = JSON.parse(fs.readFileSync(path.join(dir, "textcheck.json"), "utf8"));
  assert.equal(tc.verdict, "hold");
  assert.match(tc.notes[0], /^gate-text-overlap: hook and captions touch/);
  assert.match(fs.readFileSync(path.join(dir, "gate.txt"), "utf8"), /^Master check: HELD/);

  const clean = await runGate(dir, { measure: async () => ({ layers: layersForFix, times: [9], frames: [{ t: 9, layers: { 5: mask([{ x: 215, y: 1200, w: 595, h: 75 }]) } }] }) });
  assert.equal(clean.verdict, "ok");
  assert.match(gateText(clean), /^Master check: OK/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("runGate holds when the layout cannot be measured and asks for an edit ending after a lost ask", async () => {
  const words = (text, start, drop = null) => text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.25, ...(drop ? { drop } : {}) }));
  const cuts = { originalDuration: 8, words: [...words("Asking for help is a proven strategy.", 0), ...words("Join me for the Bootcamp.", 4, "ending")] };
  const dir = workFolder({ ...basePlan(), video: { duration: 25 }, captions: [] }, { "cuts.json": cuts });
  const result = await runGate(dir, { measure: async () => { throw new Error("Chrome missing"); } });
  assert.equal(result.verdict, "hold");
  assert.deepEqual(result.problems.filter((p) => p.level === "hold").map((p) => p.code), ["gate-unavailable", "cta-cut"]);
  assert.deepEqual(result.retry, { endAfter: "Join me for the Bootcamp" });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "gate.json"), "utf8")).retry, { endAfter: "Join me for the Bootcamp" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("measureLayers snapshots the empty frame and each text layer alone, only while it is on screen", async () => {
  const dir = workFolder({});
  const calls = [];
  const shots = new Map();
  const snapshot = async (variant, times, out) => {
    const html = fs.readFileSync(path.join(variant, "index.html"), "utf8");
    const index = Number(html.match(/nth-child\((\d+)\)/)?.[1]) || null;
    calls.push({ index, times, linked: fs.lstatSync(path.join(variant, "index.html")).isSymbolicLink() });
    return times.map((t) => { const p = `${out}/${t}.png`; shots.set(p, index === 3 ? frame([{ x: 227, y: 925, w: 626, h: 150 }]) : index === 5 ? frame([{ x: 215, y: 1200, w: 595, h: 75 }]) : blank); return { t, path: p }; });
  };
  const result = await measureLayers(path.join(dir, "project"), { duration: 25, snapshot, readPng: (p) => shots.get(p) });
  assert.equal(calls[0].index, null, "the empty frame comes first");
  assert.deepEqual(calls.map((c) => c.index), [null, 3, 5, 6]);
  assert.ok(calls.every((c) => !c.linked), "the page is a rewritten copy, never the original");
  assert.ok(calls[1].times.every((t) => t <= 4.01), "the hook is only shot while it is up");
  const first = result.frames.find((f) => f.t === 0.6);
  assert.deepEqual(first.layers[3].box, { x: 228, y: 926, w: 626, h: 150 });
  assert.ok(first.layers[5].count > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("spokenNearMiss swaps a hook word for the near-identical word actually said, and nothing looser", () => {
  const spoken = new Map(["your", "confidence", "on", "camera", "is", "a", "skill", "experience", "sales"].map((w) => [w, 1]));
  assert.equal(spokenNearMiss("competence", spoken), null, "said once: not enough to rewrite a same-length word");
  spoken.set("confidence", 3);
  assert.equal(spokenNearMiss("competence", spoken), "confidence");
  assert.equal(spokenNearMiss("persuation", new Map([["persuasion", 1]])), "persuasion", "a one-letter slip");
  assert.equal(spokenNearMiss("confidence", spoken), null, "said, so it stays");
  assert.equal(spokenNearMiss("existence", spoken), null, "different start");
  assert.equal(spokenNearMiss("scale", spoken), null, "different ending");
  assert.equal(spokenNearMiss("sale", spoken), null, "too short to judge");
});

test("planFixes merges a flash caption, fixes a near-miss hook word and leaves a clean plan alone", () => {
  const cap = (text, start, end) => ({ start, end, text, words: text.split(" ").map((t, i, all) => ({ text: t, start: start + ((end - start) * i) / all.length, end: start + ((end - start) * (i + 1)) / all.length })) });
  const plan = {
    style: { captions: { maxChars: 22 } },
    words: "Your confidence on camera is a skill and confidence it was the work".split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 })),
    hook: { text: "Your *Competence,* on camera", words: [{ text: "Your" }, { text: "Competence," , key: true }, { text: "on" }, { text: "camera" }] },
    captions: [cap("Your confidence", 0, 0.6), cap("on camera", 0.6, 1.2), cap("it was", 1.2, 1.4), cap("the work", 1.45, 2.2)],
  };
  const { plan: fixed, applied } = planFixes(plan);
  assert.equal(fixed.hook.text, "Your *Confidence,* on camera");
  assert.equal(fixed.hook.words[1].text, "Confidence,");
  assert.equal(fixed.captions.length, 3);
  assert.equal(fixed.captions[2].text, "it was the work");
  assert.equal(fixed.captions[2].start, 1.2);
  assert.equal(applied.length, 2);
  assert.equal(plan.captions.length, 4, "the input plan is not changed");
  const again = planFixes(fixed);
  assert.deepEqual(again.applied, [], "a fixed plan has nothing left to fix");
  const cards = planFixes({ graphics: [{ type: "quote", start: 1, duration: 2, text: "" }, { type: "list", start: 4, duration: 2, items: [{ text: "Price the work" }] }, { type: "post", start: 7, duration: 2, image: "a.png" }] });
  assert.deepEqual(cards.plan.graphics.map((g) => g.type), ["list", "post"]);
  assert.match(cards.applied[0], /card 1 \(quote\) dropped: it had no words/);
  const pro = planFixes({ ...plan, style: { captions: { pro: true } }, hook: null });
  assert.equal(pro.plan.captions.length, 4, "pro captions keep their own layout");
});

test("autoCta shows the card for the offer the client names last, from when it is named to the end", () => {
  const words = "I invite you to join me for the Business Builder Bootcamp starting in January with me".split(" ").map((text, i) => ({ text, start: 14 + i * 0.5, end: 14 + i * 0.5 + 0.4 }));
  const keywords = [{ say: ["retreat"], text: "Comment RETREAT" }, { say: ["bootcamp", "business builder"], text: "Comment BOOTCAMP" }];
  const cta = autoCta(words, 25.4, { keywords, style: "box", position: 0.3, uppercase: false });
  assert.equal(cta.text, "Comment BOOTCAMP");
  assert.equal(cta.start, 19.4, "no earlier than 6 s before the end");
  assert.equal(cta.duration, 6);
  assert.equal(cta.style, "box");
  assert.equal(autoCta(words, 25.4, { keywords: [{ say: ["retreat"], text: "Comment RETREAT" }] }), null, "nothing named, no card");
  assert.equal(autoCta(words, 25.4, {}), null);
  const late = autoCta(words.slice(0, 10).map((w) => ({ ...w, start: w.start + 8 })), 25.4, { keywords });
  assert.equal(late.start, 22.9, "named in the last seconds: still up for 2.5 s");
});

test("gateFixes moves a CTA card up off the captions instead of dropping it", () => {
  const layers = [...rootLayers(PAGE), { index: 10, id: "cta", tag: "div", text: true, start: 19, duration: 6 }];
  const frames = [{ t: 20, layers: { 5: mask([{ x: 215, y: 1250, w: 595, h: 75 }]), 10: mask([{ x: 300, y: 1180, w: 480, h: 100 }]) } }];
  const problems = layoutProblems(frames, layers);
  assert.deepEqual(problems[0].kinds, ["captions", "cta"]);
  const plan = { ...basePlan(), cta: { text: "Comment BOOTCAMP", start: 19, duration: 6, position: 0.62 } };
  const { plan: fixed, applied } = gateFixes(problems, plan, { frames, layers });
  const shift = 1250 - GATE_RULES.gap - (1180 + 100);
  assert.equal(fixed.cta.position, Math.round((0.62 + shift / H) * 1000) / 1000);
  assert.match(applied[0], /CTA moved up/);
});

test("card text: transcript spacing is closed up and filler-only cards are dropped", () => {
  const card = { type: "stat", value: "1 ,000", unit: "clients", sub: "Re -loop .", items: [{ text: "self- made , twice" }] };
  tidyCardText(card);
  assert.deepEqual(card, { type: "stat", value: "1,000", unit: "clients", sub: "Re-loop.", items: [{ text: "self-made, twice" }] });
  assert.equal(fillerCard({ type: "headline", headline: "RIGHT" }), true);
  assert.equal(fillerCard({ type: "list", items: [{ text: "bat," }, { text: "bat," }, { text: "bat" }] }), true);
  assert.equal(fillerCard({ type: "stat", value: "10", unit: "%" }), false);
  assert.equal(fillerCard({ type: "headline", headline: "Price the work" }), false);
  const { plan, applied } = planFixes({ graphics: [{ type: "headline", headline: "RIGHT", start: 1, duration: 2 }, { type: "stat", value: "1 ,000", unit: "calls", start: 4, duration: 2 }] });
  assert.deepEqual(plan.graphics.map((g) => g.value || g.headline), ["1,000"]);
  assert.equal(applied.length, 2);
});

test("runGate moves captions that sit on a face to just under the chin", async () => {
  const layersHere = rootLayers(PAGE);
  const measured = { layers: layersHere, times: [9], frames: [{ t: 9, layers: { 5: mask([{ x: 215, y: 800, w: 595, h: 75 }]) } }] };
  const textcheck = { verdict: "hold", video: "/tmp/r.mp4", notes: ["text-face at 9.00s: text line \"we hear\" overlaps a face expanded 10% above the forehead"], problems: [{ code: "text-face", sample: "caption-4", at: 9, message: "text line \"we hear\" overlaps a face expanded 10% above the forehead" }] };
  const dir = workFolder({ ...basePlan(), video: { duration: 25 }, captions: [] }, { "textcheck.json": textcheck });
  let asked = null;
  const faces = async (video, times) => { asked = { video, times }; return { frames: [{ faces: [{ x: 0.3, y: 0.2, w: 0.4, h: 0.25 }] }] }; };
  const result = await runGate(dir, { measure: async () => measured, faces });
  assert.deepEqual(asked, { video: "/tmp/r.mp4", times: [9] });
  assert.equal(result.verdict, "fix");
  const chin = (0.2 + 0.25 * 0.92) * H;
  assert.equal(result.plan.style.captions.position, Math.round((0.58 + (chin + GATE_RULES.gap - 800) / H) * 1000) / 1000);
  assert.match(result.fixes[0], /under the face/);
  assert.ok(!result.problems.some((p) => p.code === "textcheck"), "the face note is the gate's to fix, not a second hold");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("letterContrast reads light captions against the finished frame, and a washed-out run gets the dark box", () => {
  const letters = [{ x: 300, y: 1200, w: 400, h: 60 }];
  const layer = frame(letters);
  const m = layerMask(layer, blank);
  const paint = (bg) => { const f = frame(letters); for (let i = 0; i < f.data.length; i += 4) if (f.data[i] !== 255) f.data.set([bg, bg, bg], i); return f; };
  const onWall = letterContrast(layer, paint(235), m);
  const onJacket = letterContrast(layer, paint(60), m);
  assert.ok(onWall < 1.2, `white on a white wall reads ${onWall}:1`);
  assert.ok(onJacket > 3, `white on a dark jacket reads ${onJacket}:1`);
  assert.equal(letterContrast(layer, paint(60), { count: 0 }), null);
  const frames = [2, 5, 8, 11].map((t, i) => ({ t, contrast: { captions: i < 2 ? 1.1 : 3.5 } }));
  const [problem] = contrastProblems(frames);
  assert.equal(problem.code, "caption-contrast");
  assert.deepEqual(problem.times, [2, 5]);
  assert.deepEqual(contrastProblems(frames.slice(1)), [], "one washed-out moment is a note for the eye, not a box");
  const quiet = { ...basePlan(), style: { ...basePlan().style, captions: { ...basePlan().style.captions, quiet: true } } };
  const fixed = gateFixes([problem], quiet);
  assert.equal(fixed.plan.style.captions.plate, 0.62);
  assert.match(fixed.applied[0], /soft dark box/);
  assert.deepEqual(gateFixes([problem], basePlan()).unfixable.length, 1, "outlined captions are not boxed");
});

test("mirrored footage: only flipped frames read as words, so the clip is flipped back", async () => {
  const { readableLetters, mirrorVerdict, detectMirrored } = await import("../src/mirror.mjs");
  const ocr = (lines) => JSON.stringify({ width: 1080, height: 1920, lines: lines.map(([text, confidence]) => ({ text, confidence, box: { x: 0.1, y: 0.5, w: 0.8, h: 0.05 } })) });
  assert.equal(readableLetters(ocr([["ELLIOTT ARMY", 0.9], ["Built to Close", 0.4]])), 11, "low-confidence lines and short words do not count");
  assert.equal(readableLetters("not json"), 0);
  assert.equal(mirrorVerdict([{ normal: 0, flipped: 11 }, { normal: 0, flipped: 11 }, { normal: 0, flipped: 0 }]), true);
  assert.equal(mirrorVerdict([{ normal: 20, flipped: 2 }, { normal: 18, flipped: 0 }]), false, "text that already reads");
  assert.equal(mirrorVerdict([{ normal: 0, flipped: 0 }]), false, "no text in the shot");
  assert.equal(mirrorVerdict([{ normal: 6, flipped: 10 }, { normal: 6, flipped: 4 }]), false, "not clearly more");
  const extract = async (video, t, file, flip) => fs.writeFileSync(file, flip ? "flipped" : "normal");
  const read = async (file) => fs.readFileSync(file, "utf8") === "flipped" ? ocr([["ELLIOTT ARMY", 0.95]]) : ocr([["YMRA TTOILLE", 0.3]]);
  const found = await detectMirrored("/x.mp4", 20, { extract, ocr: read });
  assert.equal(found.mirrored, true);
  assert.equal(found.scores.length, 3);
  assert.equal(await detectMirrored("/x.mp4", 20, { extract: async () => { throw new Error("no ffmpeg"); }, ocr: read }), false, "a failure never flips a clip");
});

test("silentCaptions removes lines that caption silence and keeps lines that are heard", () => {
  const plan = { captions: [{ start: 1, end: 2, text: "we price" }, { start: 10, end: 11, text: "the leaked" }, { start: 11.5, end: 12.5, text: "half heard" }] };
  const { plan: fixed, applied } = silentCaptions(plan, [{ start: 9.5, end: 12 }]);
  assert.deepEqual(fixed.captions.map((c) => c.text), ["we price", "half heard"]);
  assert.match(applied[0], /"the leaked" at 10.00s removed: nothing is heard there/);
  assert.deepEqual(silentCaptions(plan, []).applied, []);
});

test("a CTA pill too wide for the frame gets smaller text instead of holding the reel", () => {
  const layers = [...rootLayers(PAGE), { index: 10, id: "cta", tag: "div", text: true, start: 20, duration: 5 }];
  const frames = [{ t: 21.5, layers: { 10: mask([{ x: 110, y: 860, w: 860, h: 122 }]) } }];
  const problems = layoutProblems(frames, layers);
  assert.deepEqual(problems.map((p) => [p.code, p.edges]), [["safe-zone", ["buttons"]]]);
  const plan = { ...basePlan(), style: { ...basePlan().style, cta: { fontSizeFrac: 0.036 } }, cta: { text: "Comment BOOTCAMP", start: 20, duration: 5, position: 0.48 } };
  const { plan: fixed, applied, unfixable } = gateFixes(problems, plan, { frames, layers });
  const factor = (2 * (946 - 540) - 12) / (860 * 1.06);
  assert.equal(fixed.style.cta.fontSizeFrac, Math.round(0.036 * factor * 10000) / 10000);
  assert.ok(860 * factor * 1.06 <= 2 * (946 - 540), "the pulsed pill fits left of the buttons");
  assert.match(applied[0], /CTA text made 12% smaller so it clears Instagram's buttons/);
  assert.deepEqual(unfixable, []);
  assert.equal(fixed.cta.text, "Comment BOOTCAMP", "the ask stays");
});
