import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkBrand, brandPreset, youtubePreset, brandDictionary, brandVoice, fetchFont, personalizeStartHere, personalizeSetupGuide, kitSendOutMessage } from "../src/brandkit.mjs";
import { loadPreset } from "../src/presets.mjs";
import { fontFile, PKG_ROOT } from "../src/util.mjs";

const jane = { name: "Jane Doe", handle: "@janedoe", colors: { text: "#FFFFFF", accent: "#E94B8A" }, world: "Her car in Scottsdale.", terms: ["Price With Confidence"], voice: "Warm, blunt." };

test("brand file: the problems are named in plain words", () => {
  assert.deepEqual(checkBrand(jane), []);
  const bad = checkBrand({ handle: "janedoe", colors: { text: "white" }, look: { hook: "neon" } });
  assert.ok(bad.some((p) => /name is missing/.test(p)) && bad.some((p) => /@theirhandle/.test(p)) && bad.some((p) => /colors.text/.test(p)) && bad.some((p) => /look.hook/.test(p)));
});

test("kit presets: Greg's look underneath, nothing of Greg's left on top", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-kit-"));
  fs.mkdirSync(path.join(dir, "fonts"));
  fs.writeFileSync(path.join(dir, "fonts", "Display.ttf"), "font");
  fs.writeFileSync(path.join(dir, "my-brand.json"), JSON.stringify(brandPreset(jane, { fonts: { display: "fonts/Display.ttf" } })));
  fs.writeFileSync(path.join(dir, "my-youtube.json"), JSON.stringify(youtubePreset(jane)));
  const p = loadPreset(path.join(dir, "my-brand.json"));
  assert.equal(p.colors.accent, "#E94B8A");
  assert.equal(p.broll.world, "Her car in Scottsdale.");
  assert.equal(p.carousel.handle, "@janedoe");
  assert.equal(p.carousel.style, "");
  assert.equal(p.lowerThird.name, "Jane Doe");
  assert.equal(p.lowerThird.credential, false, "identity text does not replace the credential-mode switch");
  assert.equal(p.zooms.style, "camera", "the full look comes from pingel-brand");
  assert.equal(p.fonts.display, path.join(dir, "fonts", "Display.ttf"), "font paths resolve next to the preset");
  assert.equal(fontFile(p, "Anton-Regular.ttf"), path.join(dir, "fonts", "Display.ttf"));
  assert.equal(fontFile(p, "Inter.ttf"), path.join(PKG_ROOT, "assets", "fonts", "Inter.ttf"), "no body font: Inter stays");
  const text = JSON.stringify(p);
  for (const greg of ["officialgregpingel", "Greg Pingel", "Bible", "Texas", "#C8A24B"]) assert.ok(!text.includes(greg), `no "${greg}" in Jane's look`);
  const y = loadPreset(path.join(dir, "my-youtube.json"));
  assert.equal(y.canvas, "landscape");
  assert.equal(y.lowerThird.handle, "@janedoe");
  assert.equal(y.lowerThird.credential, true);
  assert.ok(!JSON.stringify(y).includes("officialgregpingel"));
});

test("kit credentials stay in resolved brand identity", () => {
  const reel = brandPreset({ ...jane, credential: "Leadership coach" });
  const youtube = youtubePreset({ ...jane, credential: "Leadership coach" });
  assert.equal(reel.brand.identity.credential, "Leadership coach");
  assert.equal(reel.lowerThird.credential, undefined);
  assert.equal(youtube.brand.identity.credential, "Leadership coach");
  assert.equal(youtube.lowerThird.credential, undefined);
});

test("kit words and voice are theirs: no Greg frameworks, their name spelled right", () => {
  const d = brandDictionary(jane);
  assert.deepEqual(d.terms, ["Price With Confidence"]);
  assert.ok(d.names.includes("Jane Doe"));
  assert.ok(!JSON.stringify(d).includes("Ghost P&L"));
  assert.ok(d.powerWords.length > 10);
  assert.match(brandVoice(jane), /^# Jane Doe: caption voice\n\nWarm, blunt\./);
  assert.match(brandVoice({ name: "Sam" }), /Edit this file/);
});

test("fonts: a Google Fonts family by name (static weight from /static), refused when not open-licensed", async () => {
  const listing = (names) => ({ ok: true, json: async () => names.map((n) => ({ name: n, download_url: `https://x/${n}` })) });
  const fake = async (url) => {
    if (url.includes("/contents/ofl/montserrat/static")) return listing(["Montserrat-Regular.ttf", "Montserrat-ExtraBold.ttf"]);
    if (url.includes("/contents/ofl/montserrat")) return listing(["Montserrat[wght].ttf", "Montserrat-Italic[wght].ttf"]);
    if (url.startsWith("https://x/")) return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
    return { ok: false, json: async () => [] };
  };
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "reel-font-")), "Body.ttf");
  const r = await fetchFont("Montserrat ExtraBold", out, { fetchImpl: fake });
  assert.equal(r.license, "SIL Open Font License");
  assert.equal(fs.readFileSync(out, "utf8"), "https://x/Montserrat-ExtraBold.ttf");
  const v = await fetchFont("Montserrat", out, { fetchImpl: fake });
  assert.match(v.source, /Montserrat\[wght\]\.ttf$/, "no weight named: the variable font");
  await assert.rejects(fetchFont("Gotham", out, { fetchImpl: fake }), /not an open-licensed Google Fonts family/);
});

test("Start Here carries their name and no look question", () => {
  const html = fs.readFileSync(path.join(PKG_ROOT, "kit", "Start Here.html"), "utf8");
  const out = personalizeStartHere(html, { ...jane, fonts: { display: "Bebas Neue" } });
  assert.match(out, /<h1>Jane Doe's Reel Editor<\/h1>/);
  assert.match(out, /Already set: this kit carries your colors, fonts, caption voice and words/);
  assert.doesNotMatch(out, /Pick <b>1<\/b> only if you make content for Greg Pingel/);
});

function lintGuide(text) {
  const withoutFolders = text.replace(/Raw - (?:Reel with Runway B-roll|Reel with B-roll|My B-roll clips|Clips from Long Video|Full YouTube Edit|Carousel|Reel)/g, "folder");
  assert.doesNotMatch(withoutFolders, /[\u2013\u2014]| - |\bYo\b/i);
}

for (const studio of [false, true]) {
  test(`Setup Guide personalization and delivery text: studio=${studio}`, () => {
    const source = fs.readFileSync(path.join(PKG_ROOT, "kit/Setup Guide.html"), "utf8");
    const html = personalizeSetupGuide(source, { ...jane, name: 'Jane & Jo' }, { studio });
    assert.match(html, new RegExp(`<title>Jane &amp; Jo's ${studio ? "Content Studio" : "Reel Editor"}: Setup Guide</title>`));
    assert.match(html, new RegExp(`<h1>Jane &amp; Jo's ${studio ? "Content Studio" : "Reel Editor"}: Setup Guide</h1>`));
    assert.ok(html.includes(studio ? "Install Content Studio.command" : "Install Reel Editor.command"));
    assert.equal(html.includes("Connect Metricool to Claude before installing"), studio);
    assert.equal(html.includes("Make the first post now"), studio);
    assert.equal(html.includes("Add Claude for graphic cards"), !studio);
    assert.doesNotMatch(html, /<!-- \/?studio -->|Your look/);
    if (!studio) assert.doesNotMatch(html, /Metricool|Content Studio/);
    lintGuide(source); lintGuide(html);
    const message = kitSendOutMessage({ ...jane, names: ["Jane Doe", "Jo Smith"] }, { studio });
    assert.match(message, /^Hi Jane and Jo,/);
    assert.equal(message.includes("Metricool"), studio);
    assert.match(message, /AirDrop/); assert.match(message, /Setup Guide.html first/);
    lintGuide(message);
    assert.match(kitSendOutMessage(jane), /^Hi, here is/);
    assert.match(kitSendOutMessage({ ...jane, names: ["Compass", "Compass Construction"] }), /^Hi, here is/);
  });
}

import { spawnSync } from "node:child_process";
import { askDailySlots } from "../scripts/studio-setup.mjs";
import { initStudio, withDefaults } from "../src/content-studio.mjs";

test('none for both daily post types persists an empty slot list', async () => {
  const slots = await askDailySlots(async () => "none", []);
  assert.deepEqual(slots, []);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-slots-"));
  try {
    initStudio(root, { config: { slots } });
    assert.deepEqual(withDefaults(JSON.parse(fs.readFileSync(path.join(root, "studio.json")))).slots, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const studio of [false, true]) {
  test(`brand-kit zip includes guide and adjacent delivery text: studio=${studio}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-output-"));
    try {
      const brand = path.join(root, "brand.json"), guide = path.join(root, "guide.md");
      fs.writeFileSync(brand, JSON.stringify(jane));
      fs.writeFileSync(guide, "NOT FILLED IN YET\n");
      const result = spawnSync(process.execPath, ["scripts/brand-kit.mjs", brand, "--out", root, ...(studio ? ["--studio", guide] : [])], { cwd: PKG_ROOT, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const kitName = `Jane Doe ${studio ? "Content Studio" : "Reel Editor"} Kit`;
      const zip = path.join(root, `${kitName}.zip`), message = path.join(root, `${kitName} - send-out message.txt`);
      const listing = spawnSync("unzip", ["-Z1", zip], { encoding: "utf8" });
      assert.equal(listing.status, 0, listing.stderr);
      assert.ok(listing.stdout.includes(`${kitName}/Setup Guide.html`));
      assert.doesNotMatch(listing.stdout, /send-out message/);
      const page = spawnSync("unzip", ["-p", zip, `${kitName}/Setup Guide.html`], { encoding: "utf8" }).stdout;
      assert.equal(page, personalizeSetupGuide(fs.readFileSync(path.join(PKG_ROOT, "kit/Setup Guide.html"), "utf8"), jane, { studio }));
      lintGuide(fs.readFileSync(message, "utf8"));
      assert.ok(result.stdout.trim().endsWith(`${zip}\n${message}`));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test("generic kit includes the beginner guide without studio sections", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generic-guide-"));
  try {
    const result = spawnSync("bash", ["scripts/package-kit.sh", root], { cwd: PKG_ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const page = spawnSync("unzip", ["-p", path.join(root, "Reel Editor Kit.zip"), "Reel Editor Kit/Setup Guide.html"], { encoding: "utf8" });
    assert.equal(page.status, 0, page.stderr);
    assert.match(page.stdout, /Step 0: get the kit onto your Mac/);
    assert.doesNotMatch(page.stdout, /Metricool|Content Studio|<!-- studio -->/);
    lintGuide(page.stdout);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test("client kit copy uses a single desktop folder and explains approval and the app handoff", () => {
  for (const file of ["Start Here.html", "Setup Guide.html", "Install Content Studio.command"]) {
    const copy = fs.readFileSync(path.join(PKG_ROOT, "kit", file), "utf8");
    assert.doesNotMatch(copy, /Raw Reels|Desktop\/Content Studio/);
    assert.match(copy, /Desktop\/Reels/);
    assert.match(copy, /Claude app/);
  }
});
