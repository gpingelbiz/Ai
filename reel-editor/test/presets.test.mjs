import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPreset, mergeOverrides } from "../src/presets.mjs";

test("voice envelope music ducking is on by default", () => {
  assert.equal(loadPreset("clean").audio.duckFrom, "voice");
});

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

test("room tone is on by default and can be disabled per preset", () => {
  assert.equal(loadPreset("clean").audio.roomTone, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-preset-room-"));
  const file = path.join(dir, "quiet.json");
  fs.writeFileSync(file, JSON.stringify({ audio: { roomTone: false } }));
  assert.equal(loadPreset(file).audio.roomTone, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("signature and house-look switches are preset defaults with per-reel overrides", () => {
  const base = loadPreset("pingel-v2");
  assert.equal(base.signature.enabled, true);
  assert.equal(base.houseLooks.enabled, true);
  const off = mergeOverrides(base, { noSignature: true, noHouseLooks: true });
  assert.equal(off.signature.enabled, false);
  assert.equal(off.houseLooks.enabled, false);
  const on = mergeOverrides(off, { signature: true, houseLooks: true, look: "blueprint" });
  assert.equal(on.signature.enabled, true);
  assert.equal(on.houseLooks.enabled, true);
  assert.equal(on.graphics.look, "blueprint", "an explicit look remains the final per-reel choice");
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
