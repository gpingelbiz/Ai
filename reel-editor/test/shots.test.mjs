import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyShot, groupShots, shotCandidates } from "../src/shots.mjs";

const box = (h, x = 0.4, y = 0.2) => ({ x, y, w: h * 0.7, h });
const audience = () => ({ faces: Array.from({ length: 6 }, (_, i) => box(0.08, 0.1 + i % 3 * 0.2, i < 3 ? 0.2 : 0.5)), bodies: [] });
const wide = () => ({ faces: [box(0.08)], bodies: [box(0.4)] });
const sample = (t, data) => ({ t, width: 1920, height: 1080, ...data });

test("classify close, medium and wide using face/body geometry", () => {
  assert.equal(classifyShot({ faces: [box(0.30)] }), "close");
  assert.equal(classifyShot({ faces: [box(0.25)] }), "close");
  assert.equal(classifyShot({ faces: [box(0.15)] }), "medium");
  assert.equal(classifyShot({ faces: [box(0.10)] }), "medium");
  assert.equal(classifyShot(wide()), "wide");
  assert.equal(classifyShot({ ...wide(), bodies: [box(0.50)] }), "unknown");
  assert.equal(classifyShot({ faces: [box(0.08)] }), "unknown");
  assert.equal(classifyShot({ faces: [], bodies: [box(0.4)] }), "unknown");
  assert.equal(classifyShot({ ...wide(), width: 1080, height: 1920 }), "unknown");
});

test("audience candidate needs six small faces across two rows or eight bodies", () => {
  assert.equal(classifyShot(audience()), "audience-candidate");
  const oneRow = audience().faces.map((f) => ({ ...f, y: 0.2 }));
  assert.equal(classifyShot({ faces: oneRow }), "unknown");
  assert.equal(classifyShot({ faces: audience().faces.slice(1) }), "unknown");
  const large = audience().faces.map((f) => ({ ...f, h: 0.12 }));
  assert.equal(classifyShot({ faces: large }), "medium");
  assert.equal(classifyShot({ bodies: Array.from({ length: 8 }, () => box(0.1)) }), "audience-candidate");
  assert.equal(classifyShot({ bodies: Array.from({ length: 7 }, () => box(0.1)) }), "unknown");
});

test("confidence floors and malformed/missing boxes are not observations", () => {
  assert.equal(classifyShot({}), "unknown");
  assert.equal(classifyShot({ faces: [{ ...box(0.3), confidence: 0.5 }] }), "unknown");
  assert.equal(classifyShot({ faces: [{ ...box(0.3), confidence: 0.51 }] }), "close");
  assert.equal(classifyShot({ faces: [{ ...box(0.3), x: -1 }] }), "unknown");
  assert.equal(classifyShot({ faces: [{ ...box(0.3), h: NaN }] }), "unknown");
  assert.equal(classifyShot({ ...wide(), bodies: [{ ...box(0.4), confidence: 0.3 }] }), "unknown");
});

test("confirmed speaker boxes can supply stage-wide observations in a multi-person frame", () => {
  const s = { faces: [box(0.08), box(0.07)], bodies: [box(0.4), box(0.3)], speaker: { face: box(0.08), body: box(0.4) } };
  assert.equal(classifyShot(s), "wide");
  assert.equal(classifyShot({ ...s, speaker: null }), "unknown");
});

test("groupShots requires consecutive samples for wide/audience, retains time and observations", () => {
  const input = [sample(0, audience()), sample(0.5, audience()), sample(1, wide()), sample(1.5, {}), sample(2, { faces: [box(0.3)] })];
  const groups = groupShots(input, { duration: 2.2 });
  assert.deepEqual(groups.map(({ kind, start, end }) => ({ kind, start, end })), [
    { kind: "audience-candidate", start: 0, end: 1 }, { kind: "unknown", start: 1, end: 2 }, { kind: "close", start: 2, end: 2.2 },
  ]);
  assert.equal(groups[0].samples.length, 2);
  assert.ok(groups.every((g) => g.observation === true));
  assert.equal(input[2].kind, undefined);
  assert.equal(groupShots([sample(0, wide()), sample(0.5, wide())])[0].kind, "wide");
});

test("missing frames break consecutive shot evidence; grouping is sorted and validates time/fps", () => {
  const groups = groupShots([sample(2, audience()), sample(0, audience())]);
  assert.deepEqual(groups.map((g) => g.kind), ["unknown", "unknown"]);
  assert.deepEqual(groups.map((g) => g.start), [0, 2]);
  assert.throws(() => groupShots([], { fps: 0 }), /settings/);
  assert.throws(() => groupShots([], { minSamples: 1 }), /settings/);
  assert.throws(() => groupShots([sample(0, {}), sample(0, {})]), /time/);
  assert.deepEqual(groupShots([]), []);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "original.mov");
  fs.writeFileSync(file, "runner fixture");
  return { file, meta: { width: 1920, height: 1080, duration: 2 } };
}

test("injected Vision runner samples original landscape at two fps without reframing", async (t) => {
  const { file, meta } = fixture(t);
  const groups = await shotCandidates(file, { meta, run: async (input, times) => {
    assert.equal(input, file);
    assert.deepEqual(times, [0, 0.5, 1, 1.5]);
    return { width: 1920, height: 1080, frames: times.map((t) => sample(t, audience())) };
  } });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "audience-candidate");
  assert.equal(groups[0].end, 2);
});

test("failed decode samples stay unknown; portrait footage is skipped", async (t) => {
  const { file, meta } = fixture(t);
  const groups = await shotCandidates(file, { meta, run: async () => ({ width: 1920, height: 1080, frames: [sample(0, audience()), sample(1, audience())] }) });
  assert.ok(groups.every((g) => g.kind === "unknown"));
  assert.deepEqual(await shotCandidates(file, { meta: { ...meta, width: 720, height: 1280 }, run: () => assert.fail("portrait must not run Vision") }), []);
});

test("Vision work is batched and grouping continues across batch boundaries", async (t) => {
  const { file, meta } = fixture(t);
  let calls = 0;
  const groups = await shotCandidates(file, { meta: { ...meta, duration: 61 }, run: async (input, times) => {
    calls++;
    assert.ok(times.length <= 120);
    return { width: 1920, height: 1080, frames: times.map((t) => sample(t, wide())) };
  } });
  assert.equal(calls, 2);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].end, 61);
});

test("optional Vision failure logs once; missing file and invalid fps are clear errors", async (t) => {
  const { file, meta } = fixture(t);
  const logs = [];
  assert.deepEqual(await shotCandidates(file, { meta, run: async () => null, log: (s) => logs.push(s) }), []);
  assert.equal(logs.length, 1);
  await assert.rejects(shotCandidates(`${file}-missing`), /no such source/);
  await assert.rejects(shotCandidates(file, { meta, fps: 0 }), /fps/);
  await assert.rejects(shotCandidates(file, { meta: { ...meta, width: undefined } }), /geometry/);
});
