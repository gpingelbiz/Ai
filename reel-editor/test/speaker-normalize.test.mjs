import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nextLimit, speakerNormalize, speakerLoudnessFilter } from "../src/speaker-normalize.mjs";

test("nextLimit lowers the limiter by the AAC overshoot and stops once under the ceiling", () => {
  assert.equal(nextLimit(-2, -1.6), null);
  assert.equal(nextLimit(-2, -1), null);
  assert.equal(nextLimit(-2, -0.6), -2.7, "applause overshoot of 0.7 dB over the -1.3 target");
  assert.equal(nextLimit(-2.7, -0.9), -3.1);
  assert.equal(nextLimit(-2, NaN), null);
  assert.match(speakerLoudnessFilter({ input_i: -17, input_tp: -1, input_lra: 5, input_thresh: -27, target_offset: 0 }, { limitDb: -2.7 }), /alimiter=limit=0\.7328/);
});

test("speakerNormalize re-encodes with a lower limiter until the true peak passes, then keeps the file", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-normalize-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "draft.mp4"); fs.writeFileSync(file, "original");
  const filters = [], peaks = [-0.6, -1.4];
  const runImpl = async (cmd, args) => {
    if (args.includes("print_format=json") || args.join(" ").includes("print_format=json")) return { err: '{"input_i":"-17.8","input_tp":"-3","input_lra":"6","input_thresh":"-28","target_offset":"0.1"}' };
    filters.push(args[args.indexOf("-af") + 1]); fs.writeFileSync(args.at(-1), `encode ${filters.length}`); return { err: "" };
  };
  assert.equal(await speakerNormalize(file, { runImpl, measurePeak: async () => peaks.shift() }), true);
  assert.equal(filters.length, 2);
  assert.match(filters[0], /alimiter=limit=0\.7943/); assert.match(filters[1], /alimiter=limit=0\.7328/);
  assert.equal(fs.readFileSync(file, "utf8"), "encode 2"); assert.ok(!fs.existsSync(file.replace(/\.mp4$/, ".loud.mp4")));
});

test("keyword spacing is caught by the plan check, before any render", async () => {
  const { motionProblems } = await import("../src/speaker-beats.mjs");
  const plan = { items: [{ id: "a", kind: "clip", sourceId: "s", in: 0, out: 30, role: "core" }, { id: "b", kind: "clip", sourceId: "s", in: 40, out: 70, role: "core" }],
    overlays: [{ id: "k1", at: "a", offset: 5, duration: 2, card: { type: "keyword", text: "trust" } }, { id: "k2", at: "a", offset: 20, duration: 2, card: { type: "keyword", text: "plan" } }, { id: "k3", at: "b", offset: 0, duration: 2, card: { type: "keyword", text: "wish" } }] };
  const spacing = motionProblems(plan, { sources: [{ id: "s", kind: "stage" }] }).filter((p) => /20 seconds apart/.test(p.message)).map((p) => p.id);
  // Same rule as the composition check: each keyword is measured from the one before it (k2 at 20 s, k3 at 30 s).
  assert.deepEqual(spacing, ["k2", "k3"]);
  plan.overlays.splice(1, 1);
  assert.deepEqual(motionProblems(plan, { sources: [{ id: "s", kind: "stage" }] }).filter((p) => /20 seconds apart/.test(p.message)), [], "k1 at 5 s and k3 at 30 s are 25 s apart");
});
