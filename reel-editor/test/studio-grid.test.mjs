import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recentTiles, gridRepair, gridGate } from "../src/daily.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "studio-grid-"));

test("recentTiles lists the first image of earlier posts, newest first, skipping missing files", () => {
  const dir = tmp();
  const file = (name) => { const p = path.join(dir, name); fs.writeFileSync(p, "x"); return p; };
  const posts = [
    { day: "2026-11-01", time: "10:00", files: [file("a.png")] },
    { day: "2026-11-02", time: "18:00", files: [file("c.png")] },
    { day: "2026-11-02", time: "10:00", files: [file("b.png")] },
    { day: "2026-11-03", time: "10:00", files: [path.join(dir, "gone.png")] },
    { day: "2026-11-03", time: "18:00" },
  ];
  assert.deepEqual(recentTiles(posts).map((p) => path.basename(p)), ["c.png", "b.png", "a.png"]);
});

test("gridRepair swaps to a sibling cover, flips a typographic static, recrops, or gives up", () => {
  const spec = (slide) => ({ slides: [slide, { kind: "photosplit" }] });
  assert.equal(gridRepair(spec({ kind: "cover-top" }), "relayout").slides[0].kind, "cover-list");
  assert.equal(gridRepair(spec({ kind: "cover-card" }), "relayout").slides[0].kind, "cover-list");
  assert.equal(gridRepair(spec({ kind: "verdict" }), "relayout").slides[0].light, true);
  assert.equal(gridRepair(spec({ kind: "cover-doc", pos: "center" }), "recrop").slides[0].pos, "auto");
  assert.equal(gridRepair(spec({ kind: "note" }), "relayout"), null);
  assert.equal(gridRepair(spec({ kind: "cover-compare" }), "relayout"), null);
});

test("gridGate passes a distinct tile, repairs a samey one once, and holds when the repair still repeats", async () => {
  const dir = tmp();
  const old = path.join(dir, "old.png"); fs.writeFileSync(old, "x");
  const posts = [{ day: "2026-11-01", time: "10:00", files: [old] }];
  const spec = { slides: [{ kind: "cover-top", headline: "A", photo: "p.jpg" }] };
  const base = { pngs: ["new.png"], spec, posts, workDir: dir, brand: {}, check: async () => ({ verdict: "schedule" }) };
  const renderSlides = async () => ["fixed.png"];

  const ok = await gridGate({ ...base, deps: { gridCheck: async () => ({ verdict: "schedule", checks: [] }), renderSlides } });
  assert.equal(ok.verdict, "schedule");
  assert.equal(ok.pngs, undefined);

  let calls = 0;
  const samey = async () => (++calls === 1 ? { verdict: "retry", checks: [{ code: "sameness", verdict: "retry", notes: ["like the last three"] }] } : { verdict: "schedule", checks: [] });
  const fixed = await gridGate({ ...base, deps: { gridCheck: samey, renderSlides } });
  assert.equal(fixed.verdict, "schedule");
  assert.deepEqual(fixed.pngs, ["fixed.png"]);
  assert.equal(fixed.spec.slides[0].kind, "cover-list");

  const always = async () => ({ verdict: "retry", checks: [{ code: "sameness", verdict: "retry", notes: ["like the last three"] }] });
  const held = await gridGate({ ...base, deps: { gridCheck: always, renderSlides } });
  assert.equal(held.verdict, "hold");

  const noAlt = await gridGate({ ...base, spec: { slides: [{ kind: "note", text: "x" }] }, deps: { gridCheck: always, renderSlides } });
  assert.equal(noAlt.verdict, "hold");
  assert.match(noAlt.notes.join(" "), /no other layout/);

  const first = await gridGate({ ...base, posts: [], deps: { gridCheck: always, renderSlides } });
  assert.equal(first.verdict, "schedule", "a client's first post has nothing to compare against");
});
