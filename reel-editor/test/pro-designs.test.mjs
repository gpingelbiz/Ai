import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CARDS, CARD_GROUPS, rootOf, tagsOf, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { proPrompt, designOrder, groundProOverlay, budgetProOverlays, proSize } from "../src/pro.mjs";

const schema = (d) => Object.entries(d.slots || {}).map(([n, s]) => [n, s.kind, JSON.stringify(s.repeat || null), !!s.optional]);
const words = "one two three four five six seven eight nine ten eleven twelve".split(" ").map((text, i) => ({ text, start: 3 + i * 0.4, end: 3.3 + i * 0.4 }));

test("every design of a type has that type's slots, family and screen, and points at a root", () => {
  for (const [type, def] of Object.entries(CARDS)) {
    if (!def.variantOf) continue;
    const root = CARDS[def.variantOf];
    assert.ok(root, `${type} is a design of ${def.variantOf}, which does not exist`);
    assert.ok(!root.variantOf, `${type}: ${def.variantOf} is itself a design; point at its root`);
    assert.deepEqual(schema(def), schema(root), `${type} has the slots of ${def.variantOf}`);
    assert.equal(def.family, root.family, `${type} keeps the family of ${def.variantOf}`);
    assert.equal(!!def.fullscreen, !!root.fullscreen, `${type} keeps the screen of ${def.variantOf}`);
  }
  const listed = Object.values(CARD_GROUPS).flat();
  assert.equal(listed.length, Object.keys(CARDS).length);
  for (const [root, designs] of Object.entries(CARD_GROUPS)) assert.ok(designs.every((d) => rootOf(d) === root) && designs[0] === root || designs.includes(root));
});

test("every card is tagged from the shared words, so the element mix can pick by kind", () => {
  for (const type of Object.keys(CARDS)) {
    const tags = tagsOf(type);
    assert.ok(tags.length >= 1 && tags.length <= 3, `${type} has 1-3 tags (${tags})`);
    for (const t of tags) assert.ok(TAG_WORDS.includes(t), `${type}: "${t}" is not a tag word`);
  }
});

test("the planner sees one line per type, whatever the number of designs", () => {
  const prompt = proPrompt(words);
  for (const [type, def] of Object.entries(CARDS)) {
    const line = prompt.split("\n").filter((l) => l.startsWith(`${type} `) || l.startsWith(`${type} <`));
    assert.equal(line.length, def.variantOf ? 0 : 1, `${type} ${def.variantOf ? "is not" : "is"} listed`);
  }
});

test("a type's design is picked from the words: the same words always get the same design", () => {
  for (const [root, designs] of Object.entries(CARD_GROUPS)) {
    const pick = { type: root, a: { from: 2, to: 3 } };
    assert.deepEqual(designOrder(root, pick), designOrder(root, pick));
    assert.deepEqual([...designOrder(root, pick)].sort(), [...designs].sort());
    if (designs.length > 1) assert.equal(designOrder(root, { ...pick, design: designs[1] })[0], designs[1], "a named design goes first");
  }
});

test("two designs of one type count as the same type in a reel", () => {
  const group = Object.entries(CARD_GROUPS).find(([, d]) => d.length > 1 && !CARDS[d[0]].fullscreen);
  if (!group) return;
  const [root, designs] = group;
  const a = { type: designs[0], card: true, start: 4, end: 7, group: root }, b = { type: designs[1], card: true, start: 12, end: 15, group: root };
  assert.equal(budgetProOverlays([a, b], { duration: 40 }).length, 1);
});

test("imported Herk Edit Kit designs keep the MIT notice and say where they came from", () => {
  const herk = Object.entries(CARDS).filter(([, d]) => String(d.source || "").startsWith("herk:"));
  if (!herk.length) return;
  const notice = fs.readFileSync(new URL("../src/pro-cards/HERK-LICENSE.md", import.meta.url), "utf8");
  assert.match(notice, /MIT License/);
  assert.match(notice, /Copyright \(c\) 2026 Nate Herk/);
  for (const [type, def] of herk) {
    const size = typeof def.size === "function" ? null : def.size;
    if (size && !def.fullscreen) assert.ok(size.w <= 720 && size.h <= 560, `${type} fits a placement rect (${size.w}x${size.h})`);
    if (def.fullscreen) assert.deepEqual(def.size, { w: 1080, h: 1920 });
  }
  void groundProOverlay; void proSize;
});
