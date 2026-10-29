import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkBrand, brandPreset, youtubePreset, brandDictionary, brandVoice, fetchFont, personalizeStartHere } from "../src/brandkit.mjs";
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
