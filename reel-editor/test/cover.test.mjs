import { test } from "node:test";
import assert from "node:assert/strict";
import { coverHTML, fitLines, placeOnFrame, normalizeTitles, titleFits, coverTimes, titlePrompt, lineWidthPx, PALETTES, STYLES } from "../src/cover.mjs";

test("titles: 2-5 words, one starred power word (added when missing), banned words out, hook fallback, fit check", () => {
  const t = normalizeTitles([
    { title: "Own it first", score: 30 },
    { title: "a mindset shift", score: 40 },
    { title: "Nobody *fires* the manager", teaser: "they copy the blame", score: 33 },
    { title: "one", score: 50 },
    { title: "Own it first", score: 10 },
  ], { hook: "h" });
  assert.deepEqual(t.map((x) => x.title), ["NOBODY *FIRES* THE MANAGER", "*OWN* IT FIRST"]);
  assert.deepEqual(normalizeTitles([], { hook: "The 10 minutes after a bad number" })[0].title, "THE 10 MINUTES *AFTER*");
  assert.ok(titleFits({ title: "OWN IT *FIRST*" }));
  assert.ok(!titleFits({ title: "SOMETHING *EXTRAORDINARILY* LONG HAPPENS HERE" }));
});

test("lines fit 90% of the width with the real font, cap height 120-200, two lines max", () => {
  for (const title of ["OWN IT *FIRST*", "NOBODY *PERFORMS* NOW", "THEY *COPY* YOU", "BAD NUMBER. *BREATHE.*"]) {
    const l = fitLines(title);
    assert.ok(l.lines.length <= 2);
    assert.ok(l.T >= 120 && l.T <= 190, `${title}: T ${l.T}`);
    // At the 120 px floor a too-long title may still overflow; titleFits() rejects those before they are used.
    if (l.T > 120) for (const line of l.lines) assert.ok(lineWidthPx(line, l.T) * (line.includes("*") ? 1.22 : 1) <= 1080 * 0.88 + 1, `${line} too wide`);
  }
});

test("text goes under the chin on a close-up, in the top third when the face is low, and stays inside the grid crop", () => {
  const close = placeOnFrame({ face: { x: 0.18, y: 0.22, w: 0.5, h: 0.3 }, blockH: 400 });
  assert.equal(close.zone, "below");
  assert.ok(close.blockTop + 400 <= 1620 && close.blockTop >= 1000, String(close.blockTop));
  const low = placeOnFrame({ face: { x: 0.2, y: 0.55, w: 0.5, h: 0.3 }, blockH: 400 });
  assert.equal(low.zone, "above");
  assert.ok(low.blockTop >= 250);
  assert.ok(close.scale >= 1 && close.scale <= 1.35);
});

test("cover html: real frame, zoomed around the face, three styles, accent word, grain", () => {
  const face = { x: 0.18, y: 0.22, w: 0.5, h: 0.3 };
  for (const style of STYLES) {
    const html = coverHTML({ frame: "assets/frame.png", face, title: "OWN IT *FIRST*", palette: PALETTES.brand, style });
    assert.match(html, /<img id="frame" src="assets\/frame.png"/);
    assert.match(html, /<span class="k">FIRST<\/span>/);
    assert.match(html, /#C8A24B/);
    assert.match(html, /id="grain"/);
    if (style === "outline") assert.match(html, /-webkit-text-stroke: \d+px #000/);
    if (style === "whitebox") assert.match(html, /background: #fff; border-radius: 22px/);
    if (style === "outline") assert.match(html, /class="line payoff">/);
    if (style === "box") assert.match(html, /background: #C8A24B; padding/);
  }
  assert.ok(coverTimes(66).length > 20 && coverTimes(3).length >= 2);
  assert.match(titlePrompt({ transcript: "t", hook: "h" }), /2-4 words, hard max 5/);
});
