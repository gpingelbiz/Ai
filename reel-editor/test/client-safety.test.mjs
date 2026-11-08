import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GREG_PRESETS, isClientMode, isClientJob } from "../src/client-mode.mjs";
import { loadPreset, listPresets, mergeOverrides } from "../src/presets.mjs";
import { checkBrand, brandPreset, personalizeStartHere, personalizeSetupGuide } from "../src/brandkit.mjs";
import { voiceFile, captionAccess, buildPrompt } from "../scripts/write-caption.mjs";
import { PKG_ROOT, readJSON } from "../src/util.mjs";

test("client mode recognizes kits and existing hosted clients", () => {
  assert.deepEqual(GREG_PRESETS, ["pingel-brand", "pingel-v2", "pingel-runway"]);
  // A kit install is client mode; a client folder on Greg's Mac is a client job but keeps Greg's tools.
  assert.equal(isClientMode({ REEL_CLIENT_MODE: "1" }), true);
  for (const env of [{}, { REEL_CLIENT_MODE: "0" }, { REEL_CLIENT: "" }, { REEL_CLIENT: "sample" }]) assert.equal(isClientMode(env), false);
  for (const env of [{ REEL_CLIENT_MODE: "1" }, { REEL_CLIENT: "sample" }, { REEL_CLIENT_MODE: "0", REEL_CLIENT: "sample" }]) assert.equal(isClientJob(env), true);
  for (const env of [{}, { REEL_CLIENT_MODE: "0" }, { REEL_CLIENT: "" }]) assert.equal(isClientJob(env), false);
});

test("client presets refuse Greg's names and files, while legacy client brands use neutral defaults", (t) => {
  const saved = { ...process.env };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-safety-"));
  t.after(() => {
    for (const key of ["REEL_CLIENT_MODE", "REEL_CLIENT", "REEL_PRESET"]) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  process.env.REEL_CLIENT_MODE = "1";
  delete process.env.REEL_PRESET;
  assert.equal(loadPreset().name, "clean");
  assert.ok(GREG_PRESETS.every((p) => !listPresets().includes(p)));
  for (const name of GREG_PRESETS) {
    assert.throws(() => loadPreset(name), /belongs to Greg/);
    assert.throws(() => loadPreset(path.join(PKG_ROOT, "presets", `${name}.json`)), /belongs to Greg/);
    const file = path.join(dir, "renamed.json");
    fs.writeFileSync(file, JSON.stringify({ name }));
    assert.throws(() => loadPreset(file), /belongs to Greg/);
    fs.writeFileSync(file, JSON.stringify({ name: "other", extends: name }));
    assert.throws(() => loadPreset(file), /belongs to Greg/);
  }
  const template = readJSON(path.join(PKG_ROOT, "kit/brand-template.json"));
  const own = path.join(dir, "brand.json");
  fs.writeFileSync(own, JSON.stringify(brandPreset({ ...template, name: "Example Person", handle: "@example", colors: { ...template.colors, accent: "#00AAFF" } })));
  const preset = loadPreset(own);
  assert.equal(preset.colors.accent, "#00AAFF");
  assert.equal(preset.brand.identity.name, "Example Person");
  assert.equal(preset.captions.style, "reveal");
  assert.doesNotMatch(JSON.stringify(preset), /officialgregpingel|Ghost P&L|Greg Pingel/);
  assert.equal(mergeOverrides(preset, { brollEngine: "runway" }).broll.engine, "runway");
  assert.equal(mergeOverrides(preset, { brollEngine: "runway" }).broll.animate, true);
  delete process.env.REEL_CLIENT_MODE;
  delete process.env.REEL_CLIENT;
  assert.equal(loadPreset("pingel-brand").name, "pingel-brand");
});

test("client caption settings cannot enable Sandcastles or Greg's watchlist or default voice", () => {
  for (const client of [{ REEL_CLIENT_MODE: "1" }, { REEL_CLIENT: "sample" }]) {
    const env = { ...client, REEL_CAPTION_SANDCASTLES: "1", REEL_CAPTION_WATCHLIST: "1" };
    assert.deepEqual(captionAccess(env), { sandcastles: false, watchlist: false });
    assert.match(voiceFile({ style: { name: "pingel-brand" } }, env), /voice\/default.md$/);
    const prompt = buildPrompt({ transcript: "This is my own idea.", voice: "My voice.", hook: "Own idea", ...captionAccess(env) });
    assert.doesNotMatch(prompt, /Sandcastles|sandcastles|watchlist/);
  }
  assert.deepEqual(captionAccess({}), { sandcastles: true, watchlist: true });
});

test("starter brand allows every house look; narrowed lists need two different valid looks", () => {
  const brand = readJSON(path.join(PKG_ROOT, "kit/brand-template.json"));
  assert.deepEqual(checkBrand(brand), []);
  for (const only of [["phone"], ["phone", "phone"], ["phone", "madeup"], ["phone", "gregcard"], "phone"]) assert.ok(checkBrand({ ...brand, looks: { only } }).length > 0);
  assert.deepEqual(checkBrand({ ...brand, looks: { only: ["phone", "receipts"] } }), []);
});

for (const studio of [false, true]) {
  test(`kit guides run the bundled launcher from Terminal (studio=${studio})`, () => {
    const brand = { name: "Example Person" };
    for (const [file, personalize] of [["Start Here.html", personalizeStartHere], ["Setup Guide.html", personalizeSetupGuide]]) {
      const html = personalize(fs.readFileSync(path.join(PKG_ROOT, "kit", file), "utf8"), brand, { studio });
      assert.match(html, /macOS 14 or newer/);
      assert.match(html, /20 to 40 minutes/);
      assert.match(html, /about 2 GB/);
      assert.match(html, /Editing ready/);
      assert.match(html, /never change your security settings/);
      assert.doesNotMatch(html, /Open Anyway|Privacy.*Security|password/i);
      assert.doesNotMatch(html, /curl -fsSL|tools, click Install|enter your Mac password|Pick <b>1<\/b>/);
      assert.match(html, /Type <code>bash<\/code> and a space/);
      assert.match(html, /from the kit folder into the Terminal window/);
      assert.ok(html.includes(studio ? "Install Reels.command" : "Install Reel Editor.command"));
    }
  });
}
