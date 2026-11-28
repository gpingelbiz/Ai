import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { firstDifference, normalize, clientVars, fingerprint, CASES } from "../scripts/plan-check.mjs";

test("plan check names the first path where two edit plans differ", () => {
  const before = { captions: [{ text: "every single time", words: [{ text: "every" }] }], hook: { text: "a" } };
  assert.equal(firstDifference(before, structuredClone(before)), null);
  const after = structuredClone(before);
  after.captions[0].words[0].text = "each";
  assert.deepEqual(firstDifference(before, after), { at: "plan.captions[0].words[0].text", before: "every", after: "each" });
  assert.deepEqual(firstDifference({ zooms: [1, 2] }, { zooms: [1] }), { at: "plan.zooms.length", before: 2, after: 1 });
  assert.deepEqual(firstDifference({ a: 1 }, { a: 1, b: 2 }), { at: "plan.b", before: undefined, after: 2 });
});

test("plan check replaces the temp work and cache paths before comparing", () => {
  const plan = { video: { src: "/tmp/x/work/clean.mp4" }, icons: ["/tmp/x/cache/icons/a.png"] };
  assert.deepEqual(normalize(plan, { work: "/tmp/x/work", cache: "/tmp/x/cache" }), { video: { src: "$WORK/clean.mp4" }, icons: ["$CACHE/icons/a.png"] });
});

test("plan check reads a client's settings and drops anything secret", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-check-test-"));
  const file = path.join(dir, "client.env");
  fs.writeFileSync(file, "# note\nREEL_CLIENT='Julee Gracey'\nREEL_PRESET='/x/preset.json'\nRUNWAY_API_KEY='secret'\nREEL_WATCH_CTA='It'\\''s here'\n");
  assert.deepEqual(clientVars(file), { REEL_CLIENT: "Julee Gracey", REEL_PRESET: "/x/preset.json", REEL_WATCH_CTA: "It's here" });
  const before = fingerprint(dir);
  fs.writeFileSync(path.join(dir, "client.env"), "changed");
  assert.notDeepEqual(fingerprint(dir), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("plan check cases have unique names", () => {
  assert.equal(new Set(CASES.map((c) => c.name)).size, CASES.length);
});
