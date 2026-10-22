import { test } from "node:test";
import assert from "node:assert/strict";
import { coverHTML, layoutTitle, normalizeTitles, coverTimes, titlePrompt, placePerson, PALETTES } from "../src/cover.mjs";

test("titles: 2-5 words, one starred power word (added when missing), banned words out, hook fallback", async () => {
  const t = normalizeTitles([
    { title: "Own it first", score: 30 },
    { title: "a mindset shift", score: 40 },
    { title: "Nobody *fires* the manager", teaser: "they copy the blame instead of the fix", score: 33 },
    { title: "one", score: 50 },
    { title: "Own it first", score: 10 },
  ], { hook: "h" });
  assert.deepEqual(t.map((x) => x.title), ["NOBODY *FIRES* THE MANAGER", "*OWN* IT FIRST"]);
  const { titleFits } = await import("../src/cover.mjs");
  assert.ok(titleFits({ title: "OWN IT *FIRST*" }));
  assert.ok(!titleFits({ title: "NOBODY *PERFORMS* NOW" }), "too wide for two lines at 150 px caps");
  assert.equal(t[0].teaser.split(" ").length, 6);
  assert.deepEqual(normalizeTitles([], { hook: "The 10 minutes after a bad number" })[0].title, "THE 10 MINUTES *AFTER*");
});

test("layout: short titles on one line, three words split, cap height within 150-230", () => {
  assert.deepEqual(layoutTitle("OWN IT *FIRST*").lines, ["OWN IT", "*FIRST*"]);
  assert.equal(layoutTitle("*QUIT* NOW").lines.length, 1);
  const l = layoutTitle("NOBODY *FIRES* THE MANAGER");
  assert.equal(l.lines.length, 2);
  assert.ok(l.T >= 150 && l.T <= 230);
  // Under a chin at 820 the block must start at 850 or lower; the teaser goes before the type shrinks below 170.
  const fit = layoutTitle("OWN IT *FIRST*", { teaser: "THEN ASK WHAT HAPPENED", chinY: 820 });
  assert.ok(fit.blockTop >= 850, String(fit.blockTop));
  assert.ok(fit.T >= 150);
  const pos = placePerson({ face: { x: 0.18, y: 0.31, w: 0.5, h: 0.28 } });
  assert.ok(Math.abs(pos.scale - 560 / (0.28 * 1920)) < 0.01);
  assert.equal(Math.round((0.31 + 0.28) * 1920 * pos.scale + pos.ty), 820, "chin lands at y=820");
});

test("cover html: person cut-out, title block above y=1400, gold word, palette, handle, grain", () => {
  const html = coverHTML({ person: "assets/person.png", personBox: { x: 0, y: 0.22, w: 1, h: 0.78 }, face: { x: 0.2, y: 0.3, w: 0.5, h: 0.28 }, title: "OWN IT *FIRST*", teaser: "OR YOUR REPS COPY THE BLAME", palette: PALETTES.navy });
  assert.match(html, /<img id="person" src="assets\/person.png"/);
  const top = parseInt(html.match(/#block \{[^}]*top: (\d+)px/)[1], 10);
  assert.ok(top >= 850 && top < 1400, String(top));
  assert.match(html, /<span class="k">FIRST<\/span>/);
  assert.match(html, /#F7B500/);
  assert.doesNotMatch(html, /id="handle"/);
  assert.match(html, /id="mark"/);
  assert.match(html, /id="grain"/);
  assert.ok(coverTimes(66).length > 20 && coverTimes(3).length >= 2);
  assert.match(titlePrompt({ transcript: "t", hook: "h" }), /2-4 words, hard max 5/);
});
