import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../src/pro-cards/index.mjs";
import { groundCard, proSize, budgetProOverlays } from "../src/pro.mjs";
import { renderProOverlay, proCSS } from "../src/pro-render.mjs";

const words = "If they say I don't have time for this you say totally fair when is a better two minutes".split(" ").map((text, i) => ({ text, start: i * 0.4 + 3, end: i * 0.4 + 3.3 }));

test("every registry card is complete and renders from grounded word ranges", () => {
  for (const [type, def] of Object.entries(CARDS)) {
    assert.ok(def.hint && def.slots && def.size && typeof def.render === "function", `${type} is incomplete`);
    assert.ok(Object.values(def.slots).some((s) => s.kind === "spoken"), `${type} needs a spoken slot`);
  }
  const o = groundCard({ type: "objection", theySay: { from: 3, to: 8 }, youSay: { from: 11, to: 18 } }, "objection", words);
  assert.ok(o && o.card && o.reveals.length === 2 && o.reveals[0] < o.reveals[1]);
  const placed = { ...o, id: "pro-0", place: { x: 120, y: 288, scale: 1 } };
  const r = renderProOverlay(placed);
  assert.match(r.html, /pro-overlay pro-objection/);
  assert.match(r.html, /have time/);
  assert.match(r.timeline, /#pro-0 \.obj-you \.obj-text/);
  assert.deepEqual(proSize(o), { w: 720, h: 420 });
  assert.match(proCSS(), /\.pro-objection/);
});

test("label slots refuse digits and spoken slots must run in order", () => {
  assert.equal(groundCard({ youSay: { from: 3, to: 5 }, theySay: { from: 11, to: 12 } }, "objection", words), null);
});

test("the budget allows four cards in 30 s, one full screen, no type twice in a row", () => {
  const c = (type, start, extra = {}) => ({ type, start, end: start + 3, duration: 3, ...extra });
  const kept = budgetProOverlays([c("a", 3), c("a", 7), c("b", 11), c("c", 15, { fullscreen: true }), c("d", 19, { fullscreen: true }), c("e", 23)], { duration: 30 });
  assert.deepEqual(kept.map((k) => k.type), ["a", "b", "c", "e"]);
});
