import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPreset } from "../src/presets.mjs";

test("REEL_PRESET picks the default look: a preset name or a path to a partial .json", () => {
  const saved = process.env.REEL_PRESET;
  try {
    delete process.env.REEL_PRESET;
    assert.equal(loadPreset().name, "pingel-brand");
    process.env.REEL_PRESET = "clean";
    assert.equal(loadPreset().name, "clean");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-preset-"));
    const file = path.join(dir, "my-brand.json");
    fs.writeFileSync(file, JSON.stringify({ name: "my-brand", colors: { accent: "#00AAFF" } }));
    process.env.REEL_PRESET = file;
    const p = loadPreset();
    assert.equal(p.name, "my-brand");
    assert.equal(p.colors.accent, "#00AAFF");
    assert.ok(p.colors.text, "missing keys fall back to the defaults");
    assert.equal(loadPreset("pingel-brand").name, "pingel-brand", "an explicit --preset still wins");
    fs.rmSync(dir, { recursive: true, force: true });
  } finally {
    if (saved === undefined) delete process.env.REEL_PRESET; else process.env.REEL_PRESET = saved;
  }
});
