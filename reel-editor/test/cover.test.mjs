import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCHETYPES, COVER_TARGETS, archetypeHTML, checkCropBounds, coverLayout, coverTimes,
  fitLines, lineWidthPx, makeCoverManifest, normalizeTitles, placeOnFrame,
  scoreFrameCandidates, titleFits, titlePrompt,
} from "../src/cover.mjs";
import { loadPreset } from "../src/presets.mjs";

const GREG = loadPreset("pingel-v2").brand;
const CALM = structuredClone(GREG);
CALM.identity = { name: "Calm Coach", handle: "@calmcoach" };
CALM.type.display.case = "sentence";
CALM.motion.personality = "calm";

test("titles: Greg alone keeps uppercase power treatment; client titles keep their case and voice", () => {
  const greg = normalizeTitles([
    { title: "Own it first", score: 30 },
    { title: "a mindset shift", score: 40 },
    { title: "Nobody *fires* the manager", teaser: "they copy the blame", score: 33 },
  ], { hook: "h", brand: GREG });
  assert.deepEqual(greg.map((item) => item.title), ["NOBODY *FIRES* THE MANAGER", "*OWN* IT FIRST"]);
  const calm = normalizeTitles([{ title: "Stop waiting for permission", score: 20 }], { brand: CALM });
  assert.deepEqual(calm.map((item) => item.title), ["Stop waiting for permission"]);
  assert.doesNotMatch(titlePrompt({ transcript: "t", hook: "h", brand: CALM }), /blunt sales coach|ONE power word/);
  assert.match(titlePrompt({ transcript: "t", hook: "h", brand: GREG }), /2-4 words, hard max 5/);
  assert.ok(titleFits({ title: "OWN IT *FIRST*" }));
});

test("display-font measurement keeps two lines inside the title width", () => {
  for (const title of ["OWN IT *FIRST*", "NOBODY *PERFORMS* NOW", "THEY *COPY* YOU", "BAD NUMBER. *BREATHE.*"]) {
    const layout = fitLines(title);
    assert.ok(layout.lines.length <= 2);
    assert.ok(layout.T >= 120 && layout.T <= 190, `${title}: ${layout.T}`);
    if (layout.T > 120) for (const line of layout.lines) assert.ok(lineWidthPx(line, layout.T) * (line.includes("*") ? 1.22 : 1) <= 1080 * 0.88 + 1, `${line} too wide`);
  }
});

test("legacy frame placement still keeps text in the grid-safe vertical band", () => {
  const close = placeOnFrame({ face: { x: 0.18, y: 0.22, w: 0.5, h: 0.3 }, blockH: 400 });
  assert.equal(close.zone, "below");
  assert.ok(close.blockTop + 400 <= 1620 && close.blockTop >= 1000);
  const low = placeOnFrame({ face: { x: 0.2, y: 0.55, w: 0.5, h: 0.3 }, blockH: 400 });
  assert.equal(low.zone, "above");
});

test("frame score prefers an open-eyed sharp hook frame and rejects cuts, b-roll, and behind-head hook frames", () => {
  const face = { x: 0.34, y: 0.2, w: 0.3, h: 0.28 };
  const ranked = scoreFrameCandidates([
    { t: 0.5, face, parts: { eyes: 0.1, expression: 0.2, sharp: 0.3, size: 1, center: 1 } },
    { t: 1.1, face, parts: { eyes: 1, expression: 0.9, sharp: 0.95, size: 1, center: 1 } },
    { t: 1.5, face, parts: { eyes: 1, expression: 1, sharp: 1, size: 1, center: 1 }, hookBehind: true },
    { t: 4, face, parts: { eyes: 1, expression: 1, sharp: 1, size: 1, center: 1 } },
    { t: 8, face, parts: { eyes: 1, expression: 1, sharp: 1, size: 1, center: 1 } },
  ], { duration: 20, hookEnd: 3, broll: [{ start: 8, duration: 2 }], cuts: [{ t: 4 }] });
  assert.equal(ranked[0].frameTimeMs, 1100);
  assert.ok(ranked.every((item) => !item.blocked.broll && !item.blocked.jumpCut && !item.blocked.hookBehind));
  assert.ok(ranked[0].scores.eyesOpen > ranked[1].scores.eyesOpen);
  assert.ok(coverTimes(66).some((time) => time < 3) && coverTimes(66).some((time) => time > 20));
});

test("all five archetypes keep title and face inside every delivered crop", () => {
  const face = { x: 0.28, y: 0.2, w: 0.34, h: 0.3 };
  for (const template of ARCHETYPES) for (const target of COVER_TARGETS) {
    const layout = coverLayout({ template, target, face, faces: [face], title: "Own the number before it owns you", brand: GREG });
    assert.deepEqual(checkCropBounds({ target, titleBox: layout.titleBox, faceBox: layout.faceBox }).issues, [], `${template}/${target.id}`);
    assert.ok(layout.fontPx >= 48, `${template}/${target.id} title too small`);
  }
});

test("archetype templates use brand variables, escape copy, and leave the signature slot empty", () => {
  for (const template of ARCHETYPES) {
    const html = archetypeHTML({ template, target: "reel", frame: "assets/frame.png", face: { x: 0.2, y: 0.2, w: 0.4, h: 0.3 }, title: "Own <this> *first*", brand: GREG, proof: { context: "A real message", items: [{ text: "Their words" }] } });
    const rules = html.slice(html.indexOf("html, body")); // token declarations legitimately contain the brand's authored values.
    assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|\brgba?\(/i, `${template} has a literal colour outside tokensCSS`);
    assert.doesNotMatch(rules, /\bAnton\b|\bInter\b|DM Serif Display/, `${template} has a literal font outside tokensCSS`);
    assert.match(rules, /var\(--brand-/);
    assert.match(html, /data-slot="signature"><\/div>/);
    if (template === "proof-reaction") assert.match(html, /A real message/);
    else { assert.match(html, /Own/); assert.match(html, /&lt;this&gt;/); }
  }
});

test("manifest has the publish contract and normalized focal box", () => {
  const manifest = makeCoverManifest({ variantId: "native-premise-v1", template: "native-premise", frameTimeMs: 1233.4, title: "Own *this*", focalBox: { x: 0.2, y: 0.1, w: 0.4, h: 0.5 }, brand: GREG, scores: { total: 9 } });
  assert.deepEqual(Object.keys(manifest).slice(0, 7), ["variantId", "template", "frameTimeMs", "title", "targets", "focalBox", "brand"]);
  assert.equal(manifest.frameTimeMs, 1233);
  assert.equal(manifest.title, "Own this");
  assert.equal(manifest.targets.length, 5);
  assert.equal(manifest.brand, "@officialgregpingel");
});
