import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCHETYPES, COVER_TARGETS, archetypeHTML, checkCropBounds, coverLayout, coverTimes,
  fitLines, lineWidthPx, makeCoverManifest, normalizeTitles, placeOnFrame,
  scoreFrameCandidates, titleFits, titlePrompt,
} from "../src/cover.mjs";
import { loadPreset } from "../src/presets.mjs";
import { profileCrop } from "../src/grid-check.mjs";

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
    if (target.id === "reel") assert.deepEqual(checkCropBounds({ target, titleBox: layout.titleBox, faceBox: layout.faceBox, cropRect: profileCrop(target.width, target.height) }).issues, [], `${template}/reel-center-crop`);
    assert.ok(layout.fontPx >= 48, `${template}/${target.id} title too small`);
  }
});

test("3:4 cover validation checks the center crop of the reel geometry", () => {
  const crop = profileCrop(1080, 1920);
  const safe = checkCropBounds({ target: "reel", cropRect: crop, titleBox: { x: 72, y: 300, w: 500, h: 220 }, faceBox: { x: 650, y: 600, w: 300, h: 500 } });
  assert.equal(safe.ok, true);
  const clipped = checkCropBounds({ target: "reel", cropRect: crop, titleBox: { x: 72, y: 100, w: 500, h: 220 }, faceBox: null });
  assert.deepEqual(clipped.issues, ["title outside crop"]);
});

test("archetype templates use brand variables, escape copy, and carry the brand signature in its slot", () => {
  for (const template of ARCHETYPES) {
    const html = archetypeHTML({ template, target: "reel", frame: "assets/frame.png", face: { x: 0.2, y: 0.2, w: 0.4, h: 0.3 }, title: "Own <this> *first*", brand: GREG, proof: { context: "A real message", items: [{ text: "Their words" }] } });
    const rules = html.slice(html.indexOf("html, body")); // token declarations legitimately contain the brand's authored values.
    assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|\brgba?\(/i, `${template} has a literal colour outside tokensCSS`);
    assert.doesNotMatch(rules, /\bAnton\b|\bInter\b|DM Serif Display/, `${template} has a literal font outside tokensCSS`);
    assert.match(rules, /var\(--brand-/);
    assert.match(html, /data-slot="signature"><div class="signature-layer"/, "pingel-v2 has a signature device");
    assert.match(archetypeHTML({ template, target: "reel", frame: "assets/frame.png", title: "Own it", brand: loadPreset("pingel-brand").brand }), /data-slot="signature"><\/div>/, "no device, empty slot");
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

test("a frame cover comes from inside the hook window, even when the hook sits behind the head", () => {
  const face = { x: 0.3, y: 0.2, w: 0.3, h: 0.25 };
  const frames = [0.2, 1.1, 2.0, 3.2, 6.2].map((t) => ({ t, face, faces: [face], parts: { eyes: t === 3.2 ? 1 : 0.8, size: 0.8, center: 0.9, sharp: t === 3.2 ? 0.4 : 0.2 }, hookOverlap: 0.3 }));
  const ranked = scoreFrameCandidates(frames, { duration: 19, hookEnd: 3, hookBehind: true, frameMode: true });
  assert.ok(ranked[0].t < 3, `picked ${ranked[0].t}s, after the hook`);
  assert.ok(ranked.every((c) => c.t <= 2.8));
  // Archetype covers compose their own title, so they still skip hook-behind-head frames.
  assert.equal(scoreFrameCandidates(frames, { duration: 19, hookEnd: 3, hookBehind: true })[0].t, 3.2);
});

test("a frame cover prefers the hook frames before the first caption appears", () => {
  const face = { x: 0.3, y: 0.2, w: 0.3, h: 0.25 };
  const frames = [0.2, 0.8, 1.4].map((t) => ({ t, face, faces: [face], parts: { eyes: t === 0.2 ? 0.85 : 1, size: 0.75, center: 0.95, sharp: 0.15 } }));
  assert.equal(scoreFrameCandidates(frames, { duration: 19, hookEnd: 3, frameMode: true, captionFrom: 0.5 })[0].t, 0.2);
});
