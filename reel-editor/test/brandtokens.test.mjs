import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_SCHEMA, contrast, coverPalettes, readableOn, resolveBrandTokens, tokensCSS, upgradeBrandV1, validateBrand } from "../src/brandtokens.mjs";
import { brandPreset } from "../src/brandkit.mjs";
import { loadPreset } from "../src/presets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const calmV1 = json("test/fixtures/brand-calm-v1.json");
const pingel = json("brands/pingel.json");

test("brand v1 upgrade: the kit template and calm fixture become complete schema v2 tokens", () => {
  const template = upgradeBrandV1(json("kit/brand-template.json"));
  assert.equal(BRAND_SCHEMA, 2);
  assert.equal(template.schemaVersion, 2);
  assert.equal(template.identity.name, "Jane Doe");
  assert.equal(template.colors.ink, "#FFFFFF");
  assert.equal(template.colors.surface, "#111114");
  assert.equal(template.type.display.family, "Bebas Neue");
  assert.equal(template.type.body.family, "Montserrat");
  assert.ok(template.typeScale.display && template.spacing.md && template.radius.md);

  const calm = upgradeBrandV1(calmV1);
  assert.equal(calm.colors.paper, "#F8F1E8");
  assert.equal(calm.type.display.family, "Cormorant Garamond");
  assert.equal(calm.type.body.family, "Inter");
  assert.equal(calm.type.display.case, "sentence");
  assert.equal(calm.motion.personality, "calm");
  assert.equal(calm.texture.paper, true);
});

test("brand validation catches missing roles, bad hex and unreadable ink-on-surface contrast", () => {
  const bad = structuredClone(pingel);
  delete bad.colors.accent;
  bad.colors.ink = "#777777";
  bad.colors.surface = "#777778";
  bad.colors.warn = "red";
  const problems = validateBrand(bad);
  assert.ok(problems.some((p) => p.includes("colors.accent is missing")));
  assert.ok(problems.some((p) => p.includes("colors.warn must be a six-digit hex")));
  assert.ok(problems.some((p) => p.includes("contrast below 4.5:1")));
  const unlicensed = validateBrand(upgradeBrandV1(calmV1));
  assert.ok(unlicensed.some((p) => p.startsWith("warning:") && p.includes("licence")));
});

test("brand resolution: pingel keeps today's palette, fonts and identity exactly", () => {
  const p = loadPreset("pingel-brand");
  assert.deepEqual(p.colors, { text: "#F5F1E8", accent: "#C8A24B", stroke: "#000000", bg: "#0B0B0D" });
  assert.equal(p.brand.colors.ink, "#F5F1E8");
  assert.equal(p.brand.colors.accent, "#C8A24B");
  assert.equal(p.brand.colors.stroke, "#000000");
  assert.equal(p.brand.colors.surface, "#0B0B0D");
  assert.equal(p.brand.type.display.family, "Anton");
  assert.equal(p.brand.type.body.family, "Inter");
  assert.equal(p.brand.identity.handle, "@officialgregpingel");
  const compiled = brandPreset(pingel);
  assert.deepEqual(compiled.colors, p.colors);
  assert.equal(compiled.carousel.handle, "@officialgregpingel");
  assert.equal(compiled.brand.schemaVersion, 2);
});

test("brand resolution: a calm v1 brand keeps its fonts and sentence case", () => {
  const calm = resolveBrandTokens({ brand: calmV1 });
  assert.equal(calm.type.display.family, "Cormorant Garamond");
  assert.equal(calm.type.body.family, "Inter");
  assert.equal(calm.type.display.case, "sentence");
  assert.equal(calm.type.body.case, "sentence");
  assert.equal(calm.motion.personality, "calm");
});

test("token CSS includes every semantic color, type/space scales and local fonts", () => {
  const css = tokensCSS(pingel);
  for (const role of ["ink", "accent", "accent-ink", "surface", "surface2", "stroke", "muted", "paper", "warn"]) {
    assert.match(css, new RegExp(`--brand-${role}:`));
  }
  for (const name of ["xs", "sm", "md", "lg", "xl", "display"]) assert.match(css, new RegExp(`--type-${name}:`));
  for (const name of ["xs", "sm", "md", "lg", "xl", "xxl"]) assert.match(css, new RegExp(`--space-${name}:`));
  assert.match(css, /--brand-display-font: Anton, sans-serif;/);
  assert.match(css, /@font-face \{ font-family: "Anton";/);
});

test("cover palettes preserve Greg's legacy set and derive every calm-brand variant from roles", () => {
  assert.deepEqual(coverPalettes(pingel), pingel.coverPalettes);
  const calm = resolveBrandTokens({ brand: calmV1 });
  const palettes = coverPalettes(calm);
  assert.equal(palettes.brand.bg, calm.colors.surface);
  assert.equal(palettes.brand.accent, calm.colors.accent);
  assert.equal(palettes.navy.bg, calm.colors.paper);
  assert.equal(palettes.navy.accent, calm.colors.ink);
  assert.equal(palettes.red.bg, calm.colors.accent);
  assert.equal(palettes.red.accent, calm.colors.surface);
  assert.doesNotMatch(JSON.stringify(palettes), /0B1B33|E5322D|F7B500/);
});

test("all repository presets keep their legacy colors and fonts after token attachment", () => {
  const expected = {
    clean: { colors: { text: "#FFFFFF", accent: "#FFFFFF", stroke: "#000000", bg: "#0B0B0D" }, fonts: undefined },
    "pace-fast": { colors: { text: "#FFFFFF", accent: "#FFD600", stroke: "#000000", bg: "#0B0B0D" }, fonts: undefined },
    "pingel-brand": { colors: { text: "#F5F1E8", accent: "#C8A24B", stroke: "#000000", bg: "#0B0B0D" }, fonts: undefined },
    "pingel-runway": { colors: { text: "#F5F1E8", accent: "#C8A24B", stroke: "#000000", bg: "#0B0B0D" }, fonts: undefined },
    "pingel-v2": { colors: { text: "#F5F1E8", accent: "#C8A24B", stroke: "#000000", bg: "#0B0B0D" }, fonts: undefined },
    youtube: { colors: { text: "#F5F1E8", accent: "#C8A24B", stroke: "#000000", bg: "#0B0B0D" }, fonts: undefined },
  };
  for (const [name, before] of Object.entries(expected)) {
    const after = loadPreset(name);
    assert.deepEqual(after.colors, before.colors, `${name} colors`);
    assert.deepEqual(after.fonts, before.fonts, `${name} fonts`);
    assert.equal(after.brand.schemaVersion, 2, `${name} brand tokens`);
  }
});

test("readableOn keeps a color that already reads and deepens a pale one just enough, keeping its hue", () => {
  assert.equal(readableOn("#9E3D3D", "#F5F1EB"), "#9E3D3D");
  const peach = readableOn("#FFB27D", "#FFFFFF");
  assert.ok(contrast(peach, "#FFFFFF") >= 4.5, peach);
  assert.ok(contrast(peach, "#FFFFFF") < 5.5, `${peach} is darker than it needs to be`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(peach.slice(i, i + 2), 16));
  assert.ok(r > g && g > b, `${peach} is still a peach`);
  assert.ok(contrast(readableOn("#3A2B27", "#111111"), "#111111") >= 4.5, "a dark color on a dark field is lightened");
  assert.ok(contrast(readableOn("#C8A24B", "#F5F1E8", 3), "#F5F1E8") >= 3);
});
