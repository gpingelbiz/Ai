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

test("no family twice in a row and no two light cards in a row", () => {
  const c = (type, start, extra = {}) => ({ type, start, end: start + 2, duration: 2, ...extra });
  assert.deepEqual(budgetProOverlays([c("correction", 3), c("compare", 6), c("steps", 9)], { duration: 30 }).map((k) => k.type), ["correction", "steps"]);
});

test("overlap checker finds cards covering captions, the hook or each other, and drops the later card", async () => {
  const { findProCollisions, resolveProCollisions } = await import("../src/pro.mjs");
  const card = (id, start, y, h = 240) => ({ id, type: "steps", start, end: start + 4, place: { x: 180, y, w: 720, h, scale: 1 } });
  const captions = [{ start: 5, end: 7, y: 1248, lines: [3, 2] }];
  const hook = { start: 0, duration: 2.4, lines: [3, 2], fontSize: 100 };
  assert.equal(findProCollisions({ cards: [card("a", 5, 1408)], captions }).length, 1, "a torso card under a two-line caption overlaps");
  assert.equal(findProCollisions({ cards: [card("a", 5, 1500)], captions }).length, 0);
  assert.equal(findProCollisions({ cards: [card("a", 1, 200)], hook }).length, 1, "a card over the hook overlaps");
  assert.equal(findProCollisions({ cards: [card("a", 3, 300), card("b", 5, 320)] }).length, 1, "two cards at once overlap");
  assert.equal(findProCollisions({ cards: [card("a", 3, 300), card("b", 8, 320)] }).length, 0, "cards at different times do not");
  const { kept, dropped } = resolveProCollisions([card("a", 3, 300), card("b", 5, 320), card("c", 5, 1408)], { captions });
  assert.deepEqual(kept.map((k) => k.id), ["a"]);
  assert.deepEqual(dropped.map((d) => d.id), ["b", "c"]);
});
