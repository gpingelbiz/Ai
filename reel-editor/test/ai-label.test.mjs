import { test } from "node:test";
import assert from "node:assert/strict";
import { aiLabel, aiShot, shotOrigin } from "../src/ai-label.mjs";

test("AI label: AI-made B-roll or an AI voice, never real stock or the owner's own clips", () => {
  assert.equal(aiLabel({}), false, "no B-roll, no AI voice");
  assert.equal(aiLabel({ broll: [] }), false);
  assert.equal(aiLabel({ broll: [], aiVoice: true }), true, "the cloned voice alone earns the label");
  for (const shot of [{ stillSource: "codex" }, { stillSource: "runway", source: "runway", licence: { provider: "runway" } }, { source: "localgen", licence: { provider: "localgen" } }, { source: "library", licence: { provider: "runway" } }]) {
    assert.equal(aiShot(shot), true, JSON.stringify(shot));
    assert.equal(aiLabel({ broll: [shot] }), true);
  }
  for (const shot of [{ source: "pixabay", licence: { provider: "pixabay" } }, { source: "pexels" }, { source: "wikimedia" }, { source: "own", licence: { provider: "own" } }, { source: "library", licence: { provider: "Pixabay" } }]) {
    assert.equal(aiShot(shot), false, JSON.stringify(shot));
  }
  assert.equal(aiLabel({ broll: [{ source: "pixabay" }, { source: "library", licence: { provider: "own" } }] }), false, "stock plus own clips: no label");
  assert.equal(aiLabel({ broll: [{ source: "pixabay" }, { stillSource: "codex" }] }), true, "one AI shot is enough");
});

test("AI label: a shot with no source on record (older plans) keeps the label", () => {
  assert.equal(shotOrigin({ file: "broll/broll-1.png" }), null);
  assert.equal(aiLabel({ broll: [{ file: "broll/broll-1.png" }] }), true);
  assert.equal(aiLabel({ broll: [{ kind: "action", imageModel: "nano_banana_2.1", videoModel: "gen4.5" }] }), true);
});
