import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOKS, LOOK_IDS, THEMES, lookExclusions, looksPrompt, pickLook, skinFonts, skinsCSS, themeCSS, themeFontSkins, skinFor } from "../src/looks.mjs";
import { BRAND_LOOKS, brandSkinsCSS, noteHTML } from "../src/brandlooks.mjs";
import { brandPreset, checkBrand, lookChoice, fetchFont } from "../src/brandkit.mjs";
import { loadPreset } from "../src/presets.mjs";
import { sceneHTML } from "../src/graphics.mjs";
import { renderHTML } from "../src/compose.mjs";

const julee = { name: "Julee Gracey", colors: { text: "#FFFFFF", accent: "#FFB27D", bg: "#111111" } };
const BRAND = Object.keys(BRAND_LOOKS);

test("brand looks never reach Greg: his preset excludes them and his catalog is the 11 house looks", () => {
  const g = loadPreset("pingel-brand");
  const off = lookExclusions(g.graphics);
  assert.deepEqual(off.sort(), [...BRAND].sort());
  assert.equal(LOOK_IDS.filter((id) => !off.includes(id)).length, 11);
  const prompt = looksPrompt([], { exclude: off });
  for (const id of BRAND) assert.doesNotMatch(prompt, new RegExp(`- ${id}:`));
  assert.notEqual(pickLook({ look: "atelier" }, { exclude: off }).look, "atelier", "Claude cannot pick one for him");
});

test("a brand file opts in with looks.only: the rest are off, the brand looks among them are on", () => {
  assert.deepEqual(lookChoice(julee), { excludeLooks: ["gregcard"] }, "no looks.only: today's behaviour");
  const b = { ...julee, looks: { only: ["atelier", "note", "serifonlife", "Phone"] } };
  const g = brandPreset(b).graphics;
  assert.deepEqual(g.includeLooks, ["atelier", "note", "serifonlife"]);
  assert.ok(g.excludeLooks.includes("gregcard") && g.excludeLooks.includes("glass") && g.excludeLooks.includes("receipts"));
  assert.ok(!g.excludeLooks.includes("phone"));
  const allowed = LOOK_IDS.filter((id) => !lookExclusions(g).includes(id));
  assert.deepEqual(allowed.sort(), ["atelier", "note", "phone", "serifonlife"]);
  assert.equal(pickLook({ look: "note" }, { exclude: lookExclusions(g) }).look, "note");
  assert.deepEqual(checkBrand(b), []);
  assert.match(checkBrand({ ...julee, looks: { only: ["neon", "note"] } }).join(" "), /"neon" is not a look/);
  assert.match(checkBrand({ ...julee, looks: { only: ["gregcard", "note"] } }).join(" "), /"gregcard" is not a look they can use/);
  assert.match(checkBrand({ ...julee, looks: { only: ["note"] } }).join(" "), /at least 2 looks/);
  assert.deepEqual(brandPreset({ ...julee, look: { pace: "calm" } }).graphics, { excludeLooks: ["gregcard"], every: 14, max: 4, clearStart: 0 }, "calm also means fewer cards");
});

test("every brand look maps all ten card types to a brand skin and has a theme", () => {
  for (const id of BRAND) {
    for (const t of ["stat", "list", "quote", "headline", "steps", "compare", "bars", "message", "post", "chapter"]) assert.notEqual(skinFor(id, t), "glass", `${id} ${t}`);
    assert.ok(THEMES[id] && THEMES[id].cut === "hard", `${id} has a theme with hard cuts`);
  }
});

test("brand skins: sentence case, no glow, and the accent is a fill or a line, never text", () => {
  const css = brandSkinsCSS({ H: 1920, colors: julee.colors, skins: BRAND });
  for (const sk of BRAND) assert.match(css, new RegExp(`\\.gfx\\.skin-${sk} \\.g-box`));
  // The one exception is Atelier's big decorative quote mark (a glyph, not words).
  assert.doesNotMatch(css.replace(/[^\n]*::before \{[^}]*\}/g, ""), /(^|[;{ ])color: #FFB27D/i, "peach is never a text color");
  assert.doesNotMatch(css, /text-transform: uppercase[^}]*font-size: \d+px[^}]*Look Serif/);
  assert.match(css, /\.gfx\.skin-atelier \.g-headline \{[^}]*text-transform: none/);
  assert.match(css, /\.gfx\.skin-atelier \.g-stat, \.gfx\.skin-atelier \.g-stat2 \{[^}]*text-shadow: none/);
  assert.equal(skinsCSS({ H: 1920, colors: julee.colors, skins: ["notify"] }).includes("skin-atelier"), false, "only the skins in use");
  for (const [hook, cls] of [["cream", "hook-t-cream"], ["linebox", "hook-t-linebox"], ["quiet", "hook-t-quiet"]]) assert.match(themeCSS({ H: 1920, colors: julee.colors, theme: { hook } }), new RegExp(cls));
  assert.deepEqual(themeFontSkins(THEMES.atelier).sort(), ["atelier", "editorial"], "the cream hook's brand fonts, the serif slam's");
});

test("note skin: one box per line, the keyword in its own box, lists pop on item by item", () => {
  const statHTML = (v) => `<div class="g-stat g-in">${v}</div>`;
  const h = noteHTML({ type: "headline", eyebrow: "THE DM", text: "Ask *this* first" }, { statHTML });
  assert.match(h, /nb-label[^]*nb-head"><span class="nb">Ask <span class="nb-key">this<\/span> first<\/span>/);
  const l = sceneHTML({ type: "list", skin: "note", title: "Say this", items: [{ text: "One", state: "strike" }, { text: "Two", state: "check" }] });
  assert.equal((l.match(/class="nb-line g-in/g) || []).length, 3);
  assert.match(l, /nb-item nb-strike/);
  assert.match(l, /nb-item nb-check/);
  assert.equal(noteHTML({ type: "message", items: [] }, { statHTML }), null, "the thread keeps the regular markup");
});

test("brand fonts: declared over their weight range from the project's own files, with the italic", () => {
  const f = skinFonts(["atelier", "paper"]);
  assert.deepEqual(f.files, ["PermanentMarker-Regular.ttf"], "the brand fonts are already in the project");
  assert.match(f.css, /font-family: "Look Serif"; src: url\("assets\/fonts\/Anton-Regular\.ttf"\) format\("truetype"\); font-weight: 300 900; font-style: normal/);
  assert.match(f.css, /font-family: "Look Serif"; src: url\("assets\/fonts\/DisplayItalic\.ttf"\) format\("truetype"\); font-weight: 300 900; font-style: italic/);
  assert.match(f.css, /font-family: "Look Sans"; src: url\("assets\/fonts\/Inter\.ttf"\)/);
  assert.match(skinFonts(["paper"]).css, /font-style: normal/);
});

test("fetchFont italic: the family's variable italic, or nothing for a .ttf path", async () => {
  const listing = [{ name: "PlayfairDisplay[wght].ttf", download_url: "u/regular" }, { name: "PlayfairDisplay-Italic[wght].ttf", download_url: "u/italic" }];
  const got = [];
  const fetchImpl = async (url) => { got.push(url); return url.includes("api.github.com") ? { ok: !url.endsWith("/static"), json: async () => listing } : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; };
  const out = `${(await import("node:os")).tmpdir()}/reel-italic-test.ttf`;
  const r = await fetchFont("Playfair Display", out, { fetchImpl, italic: true });
  assert.equal(r.source, "u/italic");
  assert.equal(await fetchFont("/x/Brand.ttf", out, { italic: true }), null);
  const none = async (url) => (url.includes("api.github.com") ? { ok: !url.endsWith("/static"), json: async () => [listing[0]] } : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  assert.equal(await fetchFont("Playfair Display", out, { fetchImpl: none, italic: true }), null);
});

test("render: quiet motion for brand skins, the house motion untouched", () => {
  const plan = {
    name: "t", canvas: { width: 1080, height: 1920 }, video: { duration: 12, hasAudio: true },
    style: { colors: julee.colors, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: {}, cta: {}, graphics: { mode: "overlay" } },
    captions: [],
    graphics: [{ type: "headline", eyebrow: "E", text: "Own *it*", start: 2, duration: 3, skin: "atelier" }, { type: "headline", text: "Two", start: 6, duration: 3 }],
  };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /class="gfx clip gfx-headline skin-atelier"/);
  assert.match(html, /const quiet = \["atelier","note","serifonlife"\]\.find/);
  assert.match(html, /\.gfx\.skin-atelier \.g-box/);
  assert.match(html, /ease: "back\.out\(1\.8\)"/, "the house bubble pop is still there for every other skin");
});

test("quiet captions, the quiet phone labels and name tag: only for a brand that asks, never for Greg", async () => {
  const { mergeOverrides } = await import("../src/presets.mjs");
  const base = (style) => ({
    name: "t", canvas: { width: 1080, height: 1920 }, video: { duration: 8, hasAudio: true },
    style: { colors: julee.colors, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none", style: "reveal", ...style.captions }, hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: {}, cta: {}, graphics: style.graphics || {} },
    captions: [{ start: 1, end: 2, text: "ask this", words: [{ text: "ask", start: 1, end: 1.4 }, { text: "this", start: 1.4, end: 1.8, key: true }] }],
  });
  const house = renderHTML(base({}), "assets/footage.mp4");
  assert.doesNotMatch(house, /\.cap \.w\.k \{ color: #111111; background:/);
  assert.doesNotMatch(house, /\.lt-name \{ font-family: "Look Serif"/);
  const hers = renderHTML(base({ captions: { quiet: true }, graphics: { includeLooks: ["note"] } }), "assets/footage.mp4");
  assert.match(hers, /\.cap-line \{ font-family: "Inter", sans-serif; font-weight: 600;[^}]*-webkit-text-stroke: 0/);
  assert.match(hers, /\.cap \.w\.k \{ color: #111111; background: #FFB27D;/);
  assert.match(hers, /\.gfx\.skin-notes \.n-bar \{ color: #111111; \}/);
  assert.match(hers, /\.lt-name \{ font-family: "Look Serif"/);
  assert.match(hers, /font-family: "Look Serif"; src: url\("assets\/fonts\/Anton-Regular\.ttf"\)/, "the brand fonts load for them");
  const b = brandPreset({ ...julee, look: { captions: "quiet" } }).captions;
  assert.deepEqual([b.style, b.quiet, b.fontSizeFrac], ["reveal", true, 0.029]);
  assert.deepEqual(checkBrand({ ...julee, look: { captions: "quiet" } }), []);
  assert.doesNotMatch(hers, /\.cap-line \{ font-family: "Look Serif", "Anton", serif;/, "quiet stays in the body font");
  const serif = renderHTML(base({ captions: { quiet: true, serif: true }, graphics: { includeLooks: ["note"] } }), "assets/footage.mp4");
  assert.match(serif, /\.cap-line \{ font-family: "Look Serif", "Anton", serif; font-weight: 500;/, "serif captions use the display serif");
  assert.match(serif, /\.cap \.w\.k \{ color: #111111; background: #FFB27D;/, "the keyword keeps the accent box");
  const bs = brandPreset({ ...julee, look: { captions: "serif" } }).captions;
  assert.deepEqual([bs.style, bs.quiet, bs.serif, bs.fontSizeFrac], ["reveal", true, true, 0.033]);
  assert.equal(brandPreset({ ...julee, look: { captions: "quiet" } }).captions.serif, undefined);
  assert.equal(brandPreset({ ...julee, look: { captions: "quiet" } }).captions.keywordColorOnFootage, true, "quiet captions show the accent box");
  assert.equal(brandPreset({ ...julee, look: { captions: "serif" } }).captions.keywordColorOnFootage, true);
  assert.equal(brandPreset({ ...julee, look: { captions: "reveal" } }).captions.keywordColorOnFootage, undefined, "other styles inherit");
  const unlocked = brandPreset({ ...julee, looks: { only: ["note", "atelier"], lockHook: false } });
  assert.deepEqual([unlocked.hook.plaque, unlocked.looks.lockHook], [false, false], "an unlocked hook drops the plaque so the look draws it");
  assert.ok(!("plaque" in brandPreset({ ...julee, looks: { only: ["note", "atelier"] } }).hook), "no lock field: the plaque is inherited");
  assert.deepEqual(checkBrand({ ...julee, look: { captions: "serif" } }), []);
  assert.match(checkBrand({ ...julee, look: { captions: "script" } }).join(), /"reveal", "pop", "quiet" or "serif"/);
  const g = loadPreset("pingel-brand");
  assert.equal(mergeOverrides(g, { hookSeconds: "reel" }).hook.duration, "reel");
  assert.equal(mergeOverrides(g, { hookSeconds: "6" }).hook.duration, 6);
  assert.equal(mergeOverrides(g, {}).hook.duration, 3, "no flag: Greg's 3 s");
});
