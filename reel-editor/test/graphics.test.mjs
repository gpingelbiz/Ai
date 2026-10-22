import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeScene, placeScenes, sceneCandidates, graphicsCount, sceneHTML, scenesPrompt, sceneDuration } from "../src/graphics.mjs";
import { brollCandidates } from "../src/broll.mjs";
import { firstJSON } from "../src/claude.mjs";
import { renderHTML } from "../src/compose.mjs";

const groups = Array.from({ length: 40 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.8, text: `line ${i}`, words: [] }));

test("scenes: unknown types, empty fields and short lists are dropped; text is trimmed", () => {
  assert.equal(normalizeScene({ type: "chart", line: 3 }), null);
  assert.equal(normalizeScene({ type: "stat", line: 3, value: "" }), null);
  assert.equal(normalizeScene({ type: "list", line: 3, items: [{ text: "only one" }] }), null);
  assert.equal(normalizeScene({ type: "headline", line: "x", text: "Hi" }), null);
  const l = normalizeScene({ type: "list", line: "5", eyebrow: "WHAT TO STOP", items: ["Slam the desk", { text: "Go cold", state: "strike" }, { text: "Breathe", state: "check", tag: "do" }, { text: "a" }, { text: "b" }] });
  assert.equal(l.line, 5);
  assert.equal(l.items.length, 4);
  assert.deepEqual(l.items.map((i) => i.state), ["plain", "strike", "check", "plain"]);
  assert.equal(l.duration, sceneDuration(l));
});

test("placement: after the hook, spaced, ends before the CTA and the last 1.5s", () => {
  const cands = sceneCandidates(groups, 80, { hook: { start: 0, duration: 3 }, cta: { start: 72.5, duration: 3 } });
  assert.ok(cands.every((c) => c.start >= 3.5));
  const scenes = [
    { type: "headline", line: 10, text: "a", duration: 2.6 },
    { type: "headline", line: 2, text: "b", duration: 2.6 },
    { type: "headline", line: 11, text: "too close", duration: 2.6 },
    { type: "headline", line: 35, text: "runs into the CTA", duration: 2.6 },
    { type: "headline", line: 36, text: "no room before the CTA", duration: 2.6 },
    { type: "headline", line: 0, text: "in the hook", duration: 2.6 },
  ].map((s) => ({ ...s, eyebrow: "" }));
  const placed = placeScenes(scenes, cands, { duration: 80, cta: { start: 72.5 }, gap: 3 });
  assert.deepEqual(placed.map((s) => s.line), [2, 10, 35]);
  assert.equal(placed[2].start, 70);
  assert.equal(placed[2].duration, 2.5, "trimmed to end at the CTA");
  assert.equal(graphicsCount(12), 0);
  assert.equal(graphicsCount(67), 6);
});

test("b-roll keeps clear of the cards", () => {
  const busy = [{ start: 10, duration: 3 }];
  const c = brollCandidates(groups, 80, { hook: { start: 0, duration: 3 }, busy, len: 2.4, clear: 1.5 });
  assert.ok(c.every((x) => x.start + 2.4 <= 8.5 || x.start >= 14.5));
  assert.ok(c.some((x) => x.start === 6) && c.some((x) => x.start === 16));
});

test("cards: escaped text, gold and highlight markup, strike lines, step links", () => {
  assert.match(sceneHTML({ type: "headline", eyebrow: "X", text: "Not who. *What happened?*" }), /<span class="g-gold">What happened\?<\/span>/);
  assert.match(sceneHTML({ type: "quote", eyebrow: "", text: "a <b> *can hear it*" }), /a &lt;b&gt; <span class="g-hl">can hear it<\/span>/);
  const list = sceneHTML({ type: "list", eyebrow: "", items: [{ text: "Go cold", state: "strike", tag: "" }, { text: "Breathe", state: "check", tag: "do" }] });
  assert.match(list, /g-strike-line/);
  assert.match(list, /class="g-tag">do</);
  assert.equal((sceneHTML({ type: "steps", eyebrow: "", items: [{ text: "a" }, { text: "b" }, { text: "c" }] }).match(/g-link/g) || []).length, 2);
  assert.match(sceneHTML({ type: "stat", eyebrow: "", value: "Almost 8 years", value2: "", sub: "" }), /calc\(var\(--u\) \* 107\)/);
});

test("the prompt keeps qualifiers, bans invented numbers and lists only allowed lines", () => {
  const cands = sceneCandidates(groups.slice(0, 6), 14, { hook: { start: 0, duration: 3 } });
  const p = scenesPrompt({ candidates: cands, transcript: "t", hook: "h", count: 1 });
  assert.match(p, /Almost 8 years/);
  assert.match(p, /Never invent numbers/);
  assert.match(p, /^2: 4\.0s line 2$/m);
  assert.doesNotMatch(p, /^0: /m);
  assert.deepEqual(firstJSON('Here: ```json\n{"scenes":[]}\n```'), { scenes: [] });
});

test("render: cards and reveal captions", () => {
  const plan = {
    name: "t",
    canvas: { width: 1080, height: 1920 },
    video: { duration: 20, hasAudio: true },
    style: { colors: { text: "#fff", accent: "#C8A24B", stroke: "#000", bg: "#0B0B0D" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none", style: "reveal" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: {}, cta: {} },
    captions: [{ start: 1, end: 2, text: "own it", words: [{ text: "own", start: 1, end: 1.4 }, { text: "it", start: 1.4, end: 1.8 }] }],
    graphics: [{ type: "headline", eyebrow: "E", text: "Own *it*", start: 6, duration: 2.6 }],
  };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /id="gfx-0" class="gfx clip gfx-headline" data-start="6" data-duration="2.6"/);
  assert.ok(html.indexOf('id="gfx-0"') < html.indexOf('id="captions"'), "cards sit under the captions");
  assert.match(html, /"reveal":true/);
  assert.match(html, /\.cap \.w \{ opacity: 0\.38; \}/);
  assert.match(html, /PLAN\.graphics\.forEach/);
});
