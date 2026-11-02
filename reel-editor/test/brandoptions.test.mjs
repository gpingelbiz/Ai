import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkBrand, brandPreset, CALM } from "../src/brandkit.mjs";
import { loadPreset, mergeOverrides, runwayTiming } from "../src/presets.mjs";
import { hookSeconds } from "../src/hook.mjs";
import { renderHTML } from "../src/compose.mjs";
import { skinFonts } from "../src/looks.mjs";
import { ownDisplay } from "../src/util.mjs";

const julee = { name: "Julee Gracey", handle: "@juleegracey", colors: { text: "#FFFFFF", accent: "#FFB27D", stroke: "#111111", bg: "#111111" } };

/** Write a brand preset next to a stand-in display font and load it the way the watcher does. */
function load(brand, { font = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-brandopt-"));
  fs.mkdirSync(path.join(dir, "fonts"));
  if (font) fs.writeFileSync(path.join(dir, "fonts", "Display.ttf"), "font");
  fs.writeFileSync(path.join(dir, "preset.json"), JSON.stringify(brandPreset(brand, font ? { fonts: { display: "fonts/Display.ttf" } } : {})));
  return { p: loadPreset(path.join(dir, "preset.json")), dir };
}

const GREG = {
  "captions.uppercase": false, "captions.fontSizeFrac": 0.0355, "captions.autoKeywords": false, "captions.keywordColorOnFootage": false,
  "hook.uppercase": undefined, "hook.duration": 3, "hook.fontSizeFrac": 0.041, "hook.behind": false, "hook.plaque": true,
  "zooms.minSpacing": undefined, "zooms.maxPer30": undefined,
  "looks.lockHook": true, "looks.lockCaptions": true, "cover.style": "archetypes", "finish.enabled": true,
  // Off since 2026-10-29: the opening still put b-roll behind Greg, which no top reel in the b-roll study did.
  "coldOpen.enabled": false,
};
const at = (o, k) => k.split(".").reduce((v, part) => v?.[part], o);

// Greg 2026-10-31 ("Do all 7"): his own reels went to the one-take look; client brands keep the fast pacing.
const ONE_TAKE = { "cuts.silence": "medium", "zooms.cadence.enabled": false, "graphics.clearStart": 5, "graphics.max": 3, "broll.clearStart": 5, "broll.max": 2 };
const CLIENT_FAST = { "cuts.silence": "fast", "zooms.cadence.enabled": true, "graphics.clearStart": 0, "graphics.max": 6, "broll.clearStart": 0, "broll.max": 3 };

test("Greg's preset keeps today's case and hook time, with the one-take pacing", () => {
  // Greg 2026-10-30: pingel-v2 text direction is his default
  const g = loadPreset("pingel-brand");
  for (const [k, v] of Object.entries({ ...GREG, ...ONE_TAKE })) assert.equal(at(g, k), v, k);
  assert.doesNotMatch(g.broll.world, /wife/i, "never his wife, not even in a b-roll brief");
  assert.equal(ownDisplay(g), false, "pingel-brand has no display font: Anton and DM Serif stay");
});

test("a brand file without the new fields inherits Greg's new defaults and keeps its legacy behind hook", () => {
  // Greg 2026-10-30: pingel-v2 text direction is his default
  const { p, dir } = load(julee);
  try {
    for (const [k, v] of Object.entries({ ...GREG, ...CLIENT_FAST, "hook.behind": true })) assert.equal(at(p, k), v, k);
    const raw = brandPreset(julee);
    assert.ok(!("coldOpen" in raw), "coldOpen not written");
    assert.deepEqual(raw.cuts, { silence: "fast" }, "client brands write the fast pacing instead of inheriting Greg's one-take look");
    assert.ok(!("uppercase" in raw.captions) && !("uppercase" in raw.hook) && !("duration" in raw.hook));
    assert.equal(raw.hook.behind, true, "generic brands still request their legacy behind hook");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("brand.json: sentence-case hook and captions, whole-reel hook, calm pace", () => {
  const { p, dir } = load({ ...julee, look: { hookCase: "sentence", captionCase: "sentence", hookSeconds: "reel", pace: "calm" } });
  try {
    assert.equal(p.hook.uppercase, false);
    assert.equal(p.captions.uppercase, false);
    assert.equal(p.hook.duration, "reel");
    assert.equal(p.cuts.silence, CALM.cuts.silence);
    assert.equal(p.zooms.minSpacing, 16);
    assert.equal(p.zooms.maxPer30, 2);
    assert.equal(p.zooms.cadence.enabled, false);
    assert.equal(p.zooms.enabled, true, "calm still allows the odd punch-in");
    assert.equal(p.coldOpen.enabled, false, "calm has no cold open by default");
    assert.equal(p.cuts.badTakes, true, "the rest of the cut settings stay");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const on = load({ ...julee, look: { pace: "calm", coldOpen: true, hookSeconds: 6 } });
  try {
    assert.equal(on.p.coldOpen.enabled, true, "coldOpen overrides the calm default");
    assert.equal(on.p.hook.duration, 6);
  } finally { fs.rmSync(on.dir, { recursive: true, force: true }); }
  assert.equal(brandPreset({ ...julee, look: { pace: "fast", coldOpen: false } }).coldOpen.enabled, false);
  assert.deepEqual(brandPreset({ ...julee, look: { pace: "fast" } }).cuts, { silence: "fast" }, "fast writes the pacing Greg's reels had before his one-take look");
});

test("brand.json: calm brands keep plain slams with no icons or bumps; fast brands get every add-on in their colours", () => {
  const calm = load({ ...julee, look: { pace: "calm" } });
  const fast = load(julee);
  try {
    assert.equal(calm.p.slams.popout.enabled, false);
    assert.equal(calm.p.icons.enabled, false);
    assert.equal(calm.p.motion.impact.enabled, false);
    assert.equal(calm.p.motion.drift.enabled, true, "drift stays: it is a slow push, not a stamp");
    assert.equal(calm.p.broll.layout, "full-split", "b-roll goes full screen or splits, never behind the speaker");
    assert.equal(fast.p.slams.popout.enabled, true);
    assert.equal(fast.p.icons.enabled, true);
    assert.equal(fast.p.colors.accent, julee.colors.accent, "the add-ons draw in the brand's own colours");
  } finally { for (const x of [calm, fast]) fs.rmSync(x.dir, { recursive: true, force: true }); }
});

test("brand.json: bad values are named in plain words", () => {
  assert.deepEqual(checkBrand({ ...julee, look: { hookCase: "sentence", captionCase: "upper", hookSeconds: "reel", pace: "calm" } }), []);
  assert.deepEqual(checkBrand({ ...julee, look: { hookSeconds: 8 } }), []);
  const bad = checkBrand({ ...julee, look: { hookCase: "lower", captionCase: "title", hookSeconds: "forever", pace: "slow" } });
  for (const re of [/look.hookCase/, /look.captionCase/, /look.hookSeconds/, /look.pace/]) assert.ok(bad.some((m) => re.test(m)), String(re));
});

test("hook time: seconds capped at the reel, or the whole reel", () => {
  assert.equal(hookSeconds(3, 20), 3);
  assert.equal(hookSeconds(3, 2), 2);
  assert.equal(hookSeconds("reel", 7.4), 7.4);
  assert.equal(hookSeconds(undefined, 20), 3);
});

test("render: the hook is uppercase unless the brand says sentence case", () => {
  const plan = (hook) => ({
    name: "t", canvas: { width: 1080, height: 1920 }, video: { duration: 8, hasAudio: true },
    style: { colors: { text: "#fff", accent: "#FFB27D", stroke: "#000", bg: "#111" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none", uppercase: hook.uppercase !== false }, hook: { fontSizeFrac: 0.05, position: 0.2, ...hook }, zooms: {}, cta: {} },
    hook: { text: "Stop Waiting For Permission to raise your prices", start: 0, duration: 8 },
    captions: [],
  });
  const block = (html, sel) => html.slice(html.indexOf(`${sel} {`), html.indexOf("}", html.indexOf(`${sel} {`)));
  const greg = renderHTML(plan({}), "assets/footage.mp4");
  assert.match(block(greg, "#hook"), /text-transform: uppercase;/);
  assert.match(block(greg, ".cap-line"), /text-transform: uppercase;/);
  const hers = renderHTML(plan({ uppercase: false }), "assets/footage.mp4");
  assert.match(block(hers, "#hook"), /text-transform: none;/);
  assert.match(block(hers, ".cap-line"), /text-transform: none;/);
  assert.match(hers, /"duration":8/, "a whole-reel hook stays up the whole reel");
});

test("briefing serif: DM Serif Display for Greg, the brand's display font when it has one", () => {
  const greg = skinFonts(["editorial"]);
  assert.deepEqual(greg.files, ["DMSerifDisplay-Regular.ttf"]);
  assert.match(greg.css, /font-family: "DM Serif Display"; src: url\("assets\/fonts\/DMSerifDisplay-Regular\.ttf"\)/);
  const hers = skinFonts(["editorial", "paper"], { display: true });
  assert.deepEqual(hers.files, ["PermanentMarker-Regular.ttf"], "nothing to copy: the brand font is already there as the display font");
  assert.match(hers.css, /font-family: "DM Serif Display"; src: url\("assets\/fonts\/Anton-Regular\.ttf"\)/);
  assert.doesNotMatch(hers.css, /DMSerifDisplay-Regular/);
  const { p, dir } = load(julee);
  try { assert.equal(ownDisplay(p), true); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const none = load(julee, { font: false });
  try { assert.equal(ownDisplay(none.p), false, "no font file: DM Serif stays"); } finally { fs.rmSync(none.dir, { recursive: true, force: true }); }
});

test("Runway: a client's reel gets the pingel-runway timing under its own look; Greg's Runway preset is unchanged", () => {
  const { p: before, dir } = load({ ...julee, world: "her world" });
  try {
    assert.equal(before.broll.duration, 2, "a brand preset alone keeps the still b-roll timing");
    const p = mergeOverrides(before, { brollEngine: "runway", broll: true });
    const pick = (b) => ({ duration: b.duration, gap: b.gap, max: b.max, maxWithGraphics: b.maxWithGraphics, every: b.every, videoSeconds: b.videoSeconds, maxCreditsPerReel: b.maxCreditsPerReel });
    assert.equal(p.broll.engine, "runway");
    assert.deepEqual(pick(p.broll), { duration: 4, gap: 6, max: 3, maxWithGraphics: 2, every: 12, videoSeconds: 5, maxCreditsPerReel: 150 });
    assert.equal(p.broll.world, "her world", "the client's world stays");
    assert.equal(p.colors.accent, "#FFB27D", "the client's brand stays");
    assert.equal(p.name, "brand-julee-gracey");
    assert.equal(mergeOverrides(before, { brollEngine: "codex" }).broll.duration, 2, "the codex engine keeps its own timing");
    const greg = loadPreset("pingel-runway");
    assert.deepEqual(mergeOverrides(greg, { broll: true }).broll, { ...greg.broll, enabled: true }, "Greg's Runway preset comes out as before");
    assert.deepEqual(pick(greg.broll), pick(runwayTiming()));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("brand.json brollLibrary: a client's own clips become the b-roll engine; without it the Codex stills stay", () => {
  const { p, dir } = load({ ...julee, world: "her world", brollLibrary: "broll-library" });
  try {
    assert.equal(p.broll.engine, "library");
    assert.equal(p.broll.library, path.join(dir, "broll-library"), "the folder sits in her reel folder, next to preset.json");
    assert.equal(p.broll.world, "her world", "her world still steers the picks");
    assert.equal(p.broll.layout, "full-split", "the rest of the b-roll settings stay");
    assert.equal(p.broll.duration, 2, "about 2 seconds a cutaway");
    const rw = mergeOverrides(p, { brollEngine: "runway", broll: true });
    assert.equal(rw.broll.engine, "runway", "her Runway drop folder still means Runway");
    assert.equal(rw.broll.duration, 4, "with the Runway timing");
    const other = mergeOverrides(p, { brollLibrary: "/tmp/other clips" });
    assert.deepEqual([other.broll.engine, other.broll.library], ["library", "/tmp/other clips"], "a one-off folder for one edit");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const home = load({ ...julee, brollLibrary: "~/Clips/b-roll" });
  try { assert.equal(home.p.broll.library, path.join(os.homedir(), "Clips/b-roll")); } finally { fs.rmSync(home.dir, { recursive: true, force: true }); }
  const plain = load(julee);
  try {
    assert.equal(plain.p.broll.engine, "codex", "no folder: AI stills from her world, as before");
    assert.equal(plain.p.broll.library, undefined);
    assert.ok(!("engine" in brandPreset(julee).broll) && !("library" in brandPreset({ ...julee, brollLibrary: " " }).broll), "nothing written without a folder");
  } finally { fs.rmSync(plain.dir, { recursive: true, force: true }); }
  const greg = loadPreset("pingel-brand");
  assert.deepEqual([greg.broll.engine, greg.broll.library], ["codex", undefined], "Greg's preset is unchanged");
  assert.equal(mergeOverrides(greg, { brollLibrary: "/tmp/greg clips" }).broll.engine, "library", "Greg can point one edit at a folder too");
  assert.deepEqual(checkBrand({ ...julee, brollLibrary: "broll-library" }), []);
  assert.ok(checkBrand({ ...julee, brollLibrary: true }).some((m) => /brollLibrary is a folder/.test(m)));
});
