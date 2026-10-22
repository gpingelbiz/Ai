import { test } from "node:test";
import assert from "node:assert/strict";
import { planSlams, slamCandidates } from "../src/slams.mjs";
import { renderHTML } from "../src/compose.mjs";

const dict = { powerWords: ["accountability"], terms: ["Ghost P&L"] };
const line = (start, words) => ({ start, end: start + 1.6, text: words.map((w) => w[0]).join(" "), words: words.map(([text, key], k) => ({ text, key: !!key, start: start + k * 0.4, end: start + k * 0.4 + 0.35 })) });

test("slams: gold runs become candidates, ranked power word > number > term > everyday word", () => {
  const groups = [line(2, [["you", 0], ["standard", 1], ["it", 0]]), line(6, [["almost", 0], ["$10,000", 1], ["a", 0]]), line(10, [["accountability,", 1], ["period", 0]]), line(14, [["Ghost", 1], ["P&L", 1], ["call", 0]]), line(18, [["one", 1], ["thing", 0]]), line(22, [["own", 1], ["it", 0]])];
  const c = slamCandidates(groups, dict);
  assert.deepEqual(c.map((x) => x.text), ["standard", "$10,000", "accountability", "Ghost P&L"], "punctuation trimmed, runs joined, weak everyday words (one, own) skipped");
  assert.deepEqual(c.map((x) => x.rank), [1, 2.5, 3, 2]);
  assert.equal(c[3].t, 14, "a run starts on its first word");
});

test("slams: strongest first, spaced, after the hook, clear of cards, a punch-in line gets a bump", () => {
  const groups = [line(1, [["accountability", 1]]), line(5, [["standard", 1]]), line(9, [["$10,000", 1]]), line(20, [["accountability", 1]]), line(26, [["pipeline", 1]]), line(40, [["close", 1]]), line(58.9, [["blessing", 1]])];
  const s = planSlams(groups, 60, { dict, hook: { start: 0, duration: 3 }, busy: [{ start: 19, duration: 5 }], zooms: [{ t: 5, scale: 1.1 }], minSpacing: 8, max: 5, hold: 1.1 });
  assert.deepEqual(s.map((x) => x.text), ["$10,000", "pipeline", "close"], "line 1 is under the hook, the number outranks the punch-in line 4 s away, 20 is under a card, 58.9 is in the last 1.5 s");
  assert.ok(s.every((x) => x.end - x.t >= 1.09), "each slam holds at least the hold");
  assert.deepEqual(planSlams(groups, 60, { dict, max: 1, hook: { start: 0, duration: 3 } }).map((x) => x.text), ["accountability"], "max 1: the strongest word, not the first");
});

test("render: slams, markers, camera punch-ins and the b-roll grade are in the composition", () => {
  const style = { colors: { text: "#fff", accent: "#fc0", stroke: "#000" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none", annotate: true }, hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: { style: "camera" }, cta: {}, broll: { grade: { preset: "muted-editorial", intensity: 0.5 }, focusPull: 0.3 } };
  const plan = {
    name: "t",
    canvas: { width: 1080, height: 1920 },
    video: { duration: 20, hasAudio: true },
    style,
    captions: [{ start: 2, end: 3.5, text: "own the $10,000 number", words: [{ text: "own", start: 2, end: 2.3, key: true }, { text: "the", start: 2.3, end: 2.5 }, { text: "$10,000", start: 2.5, end: 3, key: true }, { text: "number", start: 3, end: 3.5 }] }],
    zooms: [{ t: 2, scale: 1.14, snap: 0.12 }, { t: 5, scale: 1, snap: 0.3 }],
    broll: [{ start: 6, duration: 2, motion: "left", src: "assets/broll/broll-1.png" }],
    slams: [{ t: 9, end: 10.2, text: "Accountability" }],
  };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /id="slam-0" class="slam clip" data-start="9" data-duration="1.2"/);
  assert.match(html, /class="slam-word"[^>]*>Accountability</);
  assert.match(html, /id="defocus"/);
  assert.match(html, /"zoomStyle":"camera"/);
  assert.match(html, /<img src="assets\/broll\/broll-1.png" alt="" data-color-grading="\{&quot;preset&quot;:&quot;muted-editorial&quot;[^"]*" style="--hf-color-grading-blur: 0.3"/);
  assert.ok(!html.includes("broll-grain"), "the CSS grain is gone; the grade carries grain and vignette");
  assert.match(html, /id="cap-0-w0">own<svg class="an an-underline"/, "a word gets the underline");
  assert.ok(!html.includes('id="cap-0-w2">$10,000<svg'), "one marker per line: the first gold word");
  const money = renderHTML({ ...plan, captions: [{ ...plan.captions[0], words: plan.captions[0].words.map((w, k) => ({ ...w, key: k === 2 })) }] }, "assets/footage.mp4");
  assert.match(money, /id="cap-0-w2">\$10,000<svg class="an an-circle"/, "an amount gets the circle");
  assert.ok(!html.includes('id="cap-0-w1">the<svg'), "plain words get nothing");
  const plain = renderHTML({ ...plan, style: { ...style, captions: { ...style.captions, annotate: false }, zooms: {} }, slams: [] }, "assets/footage.mp4");
  assert.ok(!plain.includes("<svg class=\"an") && !plain.includes('id="defocus"') && !plain.includes("slam-0"), "off by default");
});
