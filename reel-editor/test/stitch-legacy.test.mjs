import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { renderHTML } from "../src/compose.mjs";
import { applyScenePlan } from "../src/stitch-scenes.mjs";
import { legacyStitchFixtures } from "./fixtures/stitch-legacy.mjs";

// Captured from the unmodified composer at HEAD before adding scene-aware composition.
const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/stitch-legacy-html.json", import.meta.url)));

test("without stitch scenes every preset, active glow and client look emits byte identical HTML", () => {
  const old = { client: process.env.REEL_CLIENT, mode: process.env.REEL_CLIENT_MODE };
  process.env.REEL_CLIENT = ""; process.env.REEL_CLIENT_MODE = "0";
  try {
    const fixtures = legacyStitchFixtures();
    assert.deepEqual(Object.keys(fixtures).sort(), Object.keys(baseline).sort());
    for (const [name, p] of Object.entries(fixtures)) {
      const json = JSON.stringify(p); applyScenePlan(p); assert.equal(JSON.stringify(p), json);
      assert.equal(crypto.createHash("sha256").update(renderHTML(p, "assets/footage.mp4")).digest("hex"), baseline[name], name);
    }
  } finally {
    if (old.client == null) delete process.env.REEL_CLIENT; else process.env.REEL_CLIENT = old.client;
    if (old.mode == null) delete process.env.REEL_CLIENT_MODE; else process.env.REEL_CLIENT_MODE = old.mode;
  }
});
