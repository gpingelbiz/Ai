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

test("the reel command itself honours REEL_PRESET (the CLI used to hard-default pingel-brand)", async () => {
  const { spawnSync } = await import("node:child_process");
  const bin = new URL("../bin/reel.mjs", import.meta.url).pathname;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-cli-"));
  const words = new URL("../examples/sample-words.json", import.meta.url).pathname;
  const clip = path.join(dir, "t.mov");
  const ff = spawnSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=270x480:r=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "24", "-shortest", "-pix_fmt", "yuv420p", clip]);
  if (ff.status !== 0) return; // no ffmpeg on this machine: nothing to check
  const r = spawnSync("node", [bin, "edit", clip, "--out", path.join(dir, "w"), "--transcript", words, "--no-render", "--no-verify"], { env: { ...process.env, REEL_PRESET: "clean" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /preset: clean/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a client's Runway reel gets the pingel-runway timing under its own look; Greg's Runway preset is unchanged", async () => {
  const { mergeOverrides, runwayTiming } = await import("../src/presets.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-preset-"));
  const file = path.join(dir, "preset.json");
  fs.writeFileSync(file, JSON.stringify({ name: "brand-jane", extends: "pingel-brand", colors: { accent: "#FFB27D" }, broll: { world: "her world" } }));
  try {
    const before = loadPreset(file);
    assert.equal(before.broll.duration, 2, "a brand preset alone keeps the still b-roll timing");
    const p = mergeOverrides(before, { brollEngine: "runway", broll: true });
    assert.equal(p.broll.engine, "runway");
    const pick = (b) => ({ duration: b.duration, gap: b.gap, max: b.max, maxWithGraphics: b.maxWithGraphics, every: b.every, videoSeconds: b.videoSeconds, maxCreditsPerReel: b.maxCreditsPerReel });
    assert.deepEqual(pick(p.broll), { duration: 4, gap: 6, max: 3, maxWithGraphics: 2, every: 12, videoSeconds: 5, maxCreditsPerReel: 150 });
    assert.equal(p.broll.world, "her world", "the client's world stays");
    assert.equal(p.colors.accent, "#FFB27D", "the client's brand stays");
    assert.equal(mergeOverrides(before, { brollEngine: "codex" }).broll.duration, 2, "the codex engine keeps its own timing");
    const greg = loadPreset("pingel-runway");
    assert.deepEqual(mergeOverrides(greg, { broll: true }).broll, { ...greg.broll, enabled: true }, "Greg's Runway preset comes out as before");
    assert.deepEqual(pick(greg.broll), pick(runwayTiming()));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
