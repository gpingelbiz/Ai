import { test } from "node:test";
import assert from "node:assert/strict";

test("a paid video retry needs a named repair: approval text never buys one", async () => {
  const { retryRepair, videoMotion } = await import("../src/broll-runway.mjs");
  const dog = { shows: "dog", kind: "action", scene: "A dog on a driveway beside a house.", action: "The dog trots to the door.", need: "a dog arriving at a house door" };
  // Julee's dog run: the reviewer approved, only the camera measure rejected, and the retry said "None needed".
  const camera = { ok: false, action: true, correction: "None needed.", defects: ["sustained camera movement 0.250 frame widths/s exceeds 0.18"] };
  const fix = retryRepair(dog, camera);
  assert.match(fix, /camera stays fixed on a tripod/);
  assert.doesNotMatch(fix, /None needed/i);
  const prompt = videoMotion(dog, { retry: true, repair: fix });
  assert.ok(prompt.includes(fix) && !/Correction: None/i.test(prompt));
  // A travel shot keeps travelling: the camera rides with the vehicle.
  assert.match(retryRepair({ shows: "driving", kind: "ambient", scene: "A car driving along a desert highway." }, camera), /mounted rigidly inside the vehicle/);
  // Nothing named: no purchase.
  for (const c of ["None needed.", "none", "No correction needed", "Looks good.", "", "N/A"]) assert.equal(retryRepair(dog, { ok: false, correction: c, defects: [] }), null, JSON.stringify(c));
  // A reviewer defect becomes the repair; a missed meaning asks for it.
  assert.match(retryRepair(dog, { ok: false, correction: "", defects: ["the dog's legs morph into the ground"] }), /retains its original shape/);
  assert.match(retryRepair(dog, { ok: false, action: false, correction: "", defects: [] }), /clearly shows a dog arriving at a house door/);
  assert.match(retryRepair({ shows: "snake", action: "The snake slides forward." }, { ok: false, shows: false, correction: "", defects: [] }), /snake stays large, clearly visible/);
  assert.match(retryRepair({ shows: "snake", action: "The snake slides forward." }, { ok: false, action: false, correction: "None needed.", defects: [] }), /visibly performs this from the first frame: The snake slides forward/);
  assert.match(retryRepair(dog, { ok: false, defects: ["frozen clip after background compensation: motion 0.4 below 1"] }), /begins the movement in the first frame/);
});

test("pick rules ask for the viewer's need, a staged first frame, one beat and the camera's frame of reference", async () => {
  const { PICKS_RULES, PICKS_REPLY, PROMPT_VERSION, clipCheckPrompt } = await import("../src/broll-runway.mjs");
  assert.equal(PROMPT_VERSION, "literal-video-v8");
  assert.match(PICKS_RULES, /need: One short sentence/);
  assert.match(PICKS_REPLY, /"need":"\.\.\."/);
  assert.match(PICKS_RULES, /bead of cream at the nozzle/);
  assert.match(PICKS_RULES, /never against open sky/);
  assert.match(PICKS_RULES, /never a chain/);
  assert.match(PICKS_RULES, /names what the camera is fixed to/);
  const check = clipCheckPrompt({ seen: "a dog", frames: [{ time: 0 }], sheets: [], crops: [], pick: { shows: "dog", action: "walks", need: "a dog arriving at a house door" }, shot: { start: 0, duration: 2 }, groups: [] });
  assert.match(check, /must see to understand the words \(required\): "a dog arriving at a house door"/);
  assert.match(check, /When nothing needs correcting, set correction to ""/);
});
