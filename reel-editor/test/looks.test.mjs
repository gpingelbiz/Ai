import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOKS, LOOK_IDS, skinFor, looksPrompt, pickLook, skinHTML, skinsCSS, skinFonts } from "../src/looks.mjs";
import { sceneHTML } from "../src/graphics.mjs";

const statHTML = (v) => `<div class="g-stat g-in"><span class="g-count" data-to="1">${v}</span></div>`;

test("looks: every look maps every card type to a skin; the prompt lists them and steers off the last one", () => {
  for (const id of LOOK_IDS) for (const t of ["stat", "list", "quote", "headline", "steps", "compare", "bars", "message", "post", "chapter"]) assert.ok(typeof skinFor(id, t) === "string");
  assert.equal(skinFor("receipts", "stat"), "notify");
  assert.equal(skinFor("glass", "stat"), "glass");
  const p = looksPrompt(["phone", "receipts"]);
  assert.match(p, /receipts: Receipts, for money/);
  assert.match(p, /most recent last: phone, receipts\. Do not use any of the last three \(phone, receipts\)/);
});

test("pick: Claude's look when valid, else one from the topic words that is not the last reel's", () => {
  assert.equal(pickLook({ look: "fieldnotes", lookWhy: "a story" }).look, "fieldnotes");
  const fb = pickLook({ look: "neon" }, { transcript: "the price, the revenue, the profit and the deals", recent: [] });
  assert.equal(fb.look, "receipts");
  assert.notEqual(pickLook({}, { transcript: "price revenue profit", recent: ["receipts"] }).look, "receipts");
  const cool = pickLook({}, { transcript: "price revenue profit", recent: ["receipts", "phone", "press"] }).look;
  assert.ok(!["receipts", "phone", "press"].includes(cool), "none of the last three");
});

test("artifacts: a notification keeps the count-up, a receipt totals only numbers the speaker gave, the typewriter types", () => {
  const n = skinHTML({ type: "stat", eyebrow: "WHAT IT COST", value: "$10,000", sub: "one missed call" }, "notify", { statHTML });
  assert.match(n, /g-notify g-drop/);
  assert.match(n, /g-count/);
  assert.match(n, /What it cost/);
  const r = skinHTML({ type: "list", eyebrow: "RECEIPT", items: [{ text: "Slam the desk", state: "strike" }, { text: "Own it", state: "check" }] }, "receipt", { statHTML });
  assert.doesNotMatch(r, /r-total/, "no total on a list: nothing to add up");
  assert.match(r, /✕[\s\S]*✓/);
  const t = skinHTML({ type: "quote", eyebrow: "THE STANDARD", text: "your team copies *how you react*" }, "type", { statHTML });
  assert.match(t, /t-ch/);
  assert.match(t, /— the standard/);
  assert.equal(skinHTML({ type: "list", items: [] }, "paper", { statHTML }), null, "paper only restyles");
  assert.match(sceneHTML({ type: "stat", eyebrow: "X", value: "$5", skin: "notify" }), /g-notify/);
});

test("timed list rows keep their live-item hooks in every look skin", () => {
  const card = { type: "list", eyebrow: "THE ORDER", items: [{ text: "First", state: "plain", at: 0 }, { text: "Second", state: "check", at: 2 }] };
  for (const look of LOOK_IDS) {
    const html = sceneHTML({ ...card, skin: skinFor(look, "list") });
    assert.equal((html.match(/class="g-live-item"/g) || []).length, 2, look);
    assert.equal((html.match(/g-item-text/g) || []).length, 2, look);
  }
});

test("styles and fonts only for the skins in use", () => {
  const css = skinsCSS({ H: 1920, colors: { accent: "#C8A24B" }, skins: ["paper", "receipt"] });
  assert.match(css, /skin-paper/);
  assert.match(css, /skin-receipt/);
  assert.doesNotMatch(css, /skin-notify/);
  const f = skinFonts(["paper", "type", "glass"]);
  assert.deepEqual(f.files.sort(), ["CourierPrime-Bold.ttf", "CourierPrime-Regular.ttf", "PermanentMarker-Regular.ttf"]);
  assert.match(f.css, /Permanent Marker/);
});

test("every compare skin keeps the staged pivot markup", () => {
  for (const id of LOOK_IDS) {
    const html = sceneHTML({ type: "compare", skin: skinFor(id, "compare"), pivotAt: 1, kind: "roles", a: { label: "Seller", value: "", note: "" }, b: { label: "Buyer", value: "", note: "" } });
    assert.match(html, /g-compare-dynamic g-kind-roles/, id);
  }
});

import { THEMES, applyTheme, MARKERS, themeCSS, themeFontSkins } from "../src/looks.mjs";
import { loadPreset } from "../src/presets.mjs";
import { composeProject } from "../src/compose.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("themes: every look but glass has a whole theme; every marker, hook and slam it names is drawn", () => {
  const css = themeCSS({ H: 1920, colors: {}, theme: null }) + Object.values(THEMES).filter(Boolean).map((t) => themeCSS({ H: 1920, colors: {}, theme: t })).join("");
  for (const id of LOOK_IDS) {
    const t = THEMES[id];
    if (id === "glass") { assert.equal(t, null); continue; }
    assert.ok(MARKERS[t.marker], `${id} marker`);
    assert.ok(["hard", "flash", "blur"].includes(t.cut), `${id} cut`);
    assert.ok(["snap", "camera"].includes(t.zoom), `${id} zoom`);
    assert.ok(t.grade.preset && t.grade.intensity > 0 && t.grade.intensity <= 1, `${id} grade`);
    if (t.hook !== "headline") assert.ok(css.includes(`hook-t-${t.hook}`), `${id} hook ${t.hook}`);
    if (t.slam !== "slam") assert.ok(css.includes(`slam-t-${t.slam}`), `${id} slam ${t.slam}`);
  }
  assert.deepEqual(themeFontSkins(THEMES.fieldnotes), ["paper"]);
  assert.deepEqual(themeFontSkins(THEMES.receipts), ["type"]);
});

test("apply: a theme sets hook, marker, slams, grade, cut and camera on a copy; command-line choices win; glass changes nothing", () => {
  const base = loadPreset("pingel-brand");
  const before = JSON.stringify(base);
  const s = applyTheme(base, "press");
  assert.equal(JSON.stringify(base), before, "the preset is not changed in place");
  assert.equal(s.look, "press");
  assert.equal(s.hook.treat, "stamp");
  assert.equal(s.captions.marker, "box");
  assert.equal(s.slams.style, "ghost");
  assert.equal(s.broll.grade.preset, "mono-clean");
  assert.deepEqual(s.broll.grade.adjust, {});
  assert.equal(s.broll.grade.details.grain, 0.18);
  assert.equal(s.broll.cut, "flash");
  assert.equal(s.zooms.style, "snap");
  assert.equal(s.captions.style, base.captions.style, "caption type is never themed");
  assert.equal(s.captions.wordsPerLine, base.captions.wordsPerLine);
  const kept = applyTheme(base, "press", { keep: { zoomStyle: true, brollCut: true } });
  assert.equal(kept.zooms.style, base.zooms.style);
  assert.equal(kept.broll.cut, base.broll.cut);
  assert.equal(applyTheme(base, "glass"), base);
});

test("compose: the themed hook, slam and marker reach the page, with the typed hook's one cursor", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-theme-"));
  const video = path.join(dir, "v.mp4");
  fs.writeFileSync(video, "");
  const style = applyTheme(loadPreset("pingel-brand"), "receipts");
  style.audio.sounds = false;
  const w = (text, start, key) => text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.25, key: t === key }));
  const words = w("they remember how you react", 2.7, "react");
  composeProject({
    version: 1, name: "t", preset: style.name, style,
    video: { src: video, duration: 8, width: 1080, height: 1920, fps: 30, hasAudio: false },
    canvas: { width: 1080, height: 1920, mode: "portrait" },
    hook: { text: "The *10 minutes* after", start: 0, duration: 2.4, words: [{ text: "The" }, { text: "10", key: true }, { text: "minutes", key: true }, { text: "after" }] },
    cta: null, captions: [{ words, start: 2.65, end: 4.6, text: "they remember how you react" }],
    zooms: [], graphics: [], broll: [], slams: [{ t: 3.9, end: 5, text: "react" }],
    coldOpen: null, lowerThird: null, reframe: null, behind: null,
    framing: { scale: 1, origin: "50% 40%", side: "right", face: null }, audio: { tracks: [] }, words: [],
  }, dir);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.match(html, /id="hook" class="clip hook-t-type"/);
  assert.equal((html.match(/<span class="hook-cursor"><\/span>/g) || []).length, 1);
  assert.doesNotMatch(html, /#hook-lines::after/);
  assert.match(html, /slam-word slam-t-type/);
  assert.match(html, /CourierPrime/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("placement: a Courier hook measures taller than the same words in Anton", async () => {
  const { hookBlockHeight } = await import("../src/placement.mjs");
  const words = "Your team doesn't remember your meeting".split(" ").map((text) => ({ text }));
  const anton = hookBlockHeight(words, { fontPx: 120 });
  const courier = hookBlockHeight(words, { fontPx: 118, charEm: 0.6, lineHeight: 1.14, padEm: 0.5 });
  assert.ok(courier > anton);
});

test("block hooks: an opaque hook block always ends above the head, shrinking to fit; other hooks are left alone", async () => {
  const { fitBlockHook, hookBlockHeight, BLOCK_HOOKS } = await import("../src/placement.mjs");
  const words = "Your team doesn't remember your meeting at all".split(" ").map((text) => ({ text }));
  for (const treat of Object.keys(BLOCK_HOOKS)) {
    for (const headTop of [0.22, 0.3, 0.4]) {
      const fit = fitBlockHook(words, { treat, headTop, fontSizeFrac: 0.07 });
      const b = BLOCK_HOOKS[treat];
      const h = hookBlockHeight(words, { fontPx: Math.round(fit.fontSizeFrac * 1920 * b.em), charEm: b.charEm, lineHeight: b.lineHeight, padEm: b.padEm, goldScale: 1 });
      const top = fit.position - 1.2 * fit.fontSizeFrac;
      assert.ok(top >= 0.029, `${treat} ${headTop} top`);
      if (fit.fits) assert.ok(top + h <= headTop, `${treat} at head ${headTop}: block ends at ${top + h}`);
      assert.ok(fit.fontSizeFrac >= 0.07 * 0.6 - 1e-9);
    }
  }
  assert.equal(fitBlockHook(words, { treat: "headline", headTop: 0.3, fontSizeFrac: 0.07 }), null);
  assert.ok(fitBlockHook(words, { treat: "panel", headTop: 0.3, fontSizeFrac: 0.07 }).fits);
});
