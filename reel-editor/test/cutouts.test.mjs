import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { brollLayout, placePopoutWord, selectPopoutSlams } from "../src/cutouts.mjs";
import { renderHTML } from "../src/compose.mjs";

const grid = (fill = 0) => ({ cols: 27, rows: 48, cells: Array(27 * 48).fill(fill) });

test("pop-out placement: takes the largest clear box, shrinks around occupancy, then falls back above the head", () => {
  const clear = placePopoutWord("POWER", grid(), { maxCovered: 0.15 });
  assert.equal(clear.fallback, false);
  assert.equal(clear.covered, 0);

  const striped = grid();
  for (let row = 0; row < 48; row++) if (row % 8 < 2) for (let col = 0; col < 27; col++) striped.cells[row * 27 + col] = 1;
  const shrunk = placePopoutWord("POWER", striped, { maxCovered: 0.15 });
  assert.equal(shrunk.fallback, false);
  assert.ok(shrunk.fontSize < clear.fontSize, `${shrunk.fontSize} should be smaller than ${clear.fontSize}`);
  assert.ok(shrunk.covered <= 0.15);

  const blocked = placePopoutWord("ACCOUNTABILITY", grid(1), { maxCovered: 0.15, headTop: 0.3 });
  assert.equal(blocked.fallback, true);
  assert.ok(blocked.top + blocked.fontSize * 1.02 <= 0.3 * 1920, "fallback word clears the head");
});

test("pop-out selection: highest ranks win, with the cap and minimum rank", () => {
  const slams = [
    { t: 5, rank: 2.5, text: "$10,000" },
    { t: 14, rank: 4, text: "OWN IT" },
    { t: 24, rank: 3, text: "ACCOUNTABILITY" },
    { t: 34, rank: 2, text: "PIPELINE" },
  ];
  assert.deepEqual(selectPopoutSlams(slams, { max: 2, minRank: 2.5 }).map((x) => x.text), ["OWN IT", "ACCOUNTABILITY"]);
  assert.deepEqual(selectPopoutSlams(slams, { max: 1, minRank: 3.5 }).map((x) => x.text), ["OWN IT"]);
});

test("cutout b-roll layout map keeps full as the safe fallback", () => {
  assert.equal(brollLayout("full"), "full");
  assert.equal(brollLayout("cutout"), "cutout");
  assert.equal(brollLayout("unknown"), "full");
});

test("render: pop-out word is between its dim layer and matte; cutout b-roll and every matte mirror footage", () => {
  const style = JSON.parse(readFileSync(new URL("../presets/_defaults.json", import.meta.url)));
  const plan = {
    name: "cutouts",
    canvas: { width: 1080, height: 1920 },
    video: { duration: 20, hasAudio: true },
    style,
    captions: [],
    zooms: [{ t: 4, scale: 1.14, snap: 0.12 }],
    broll: [{ start: 6, duration: 2, motion: "in", src: "assets/broll/broll-1.png", cutout: { src: "assets/cutouts/broll-1.webm", start: 6, duration: 2 } }],
    slams: [{ t: 10, end: 11.2, text: "ACCOUNTABILITY", popout: { src: "assets/cutouts/popout-1.webm", start: 9.9, duration: 1.4, placement: { top: 180, fontSize: 270 }, dim: 0.62, blur: 10, outline: 0.004 } }],
  };
  const html = renderHTML(plan, "assets/footage.mp4");
  const bg = html.indexOf('id="popout-bg-0"'), word = html.indexOf('id="slam-0"'), popout = html.indexOf('id="popout-cutout-wrap-0"'), captions = html.indexOf('id="captions"');
  assert.ok(bg < word && word < popout && popout < captions, "dim < word < person matte < captions");
  assert.match(html, /id="broll-cutout-0" class="clip cutout-person broll-cutout-person"[^>]+src="assets\/cutouts\/broll-1\.webm"/);
  assert.match(html, /id="popout-cutout-0" class="clip cutout-person popout-cutout-person"[^>]+src="assets\/cutouts\/popout-1\.webm"/);
  assert.match(html, /"cutoutWraps":\["#broll-cutout-wrap-0","#popout-cutout-wrap-0"\]/);
  assert.match(html, /const WRAP = PLAN\.cutoutWraps\.length \? \["#video-wrap", \.\.\.PLAN\.cutoutWraps\]/);
  const script = html.match(/<script>\n([\s\S]*?)\n    <\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
