import fs from "node:fs";
import path from "node:path";
import { readJSON, deepMerge, PKG_ROOT, warn } from "./util.mjs";
import { resolveBrandTokens } from "./brandtokens.mjs";

const PRESET_DIR = path.join(PKG_ROOT, "presets");

export function listPresets() {
  return fs
    .readdirSync(PRESET_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_") && !f.startsWith("pace-"))
    .map((f) => f.replace(/\.json$/, ""));
}

/** Default preset: REEL_PRESET (a name in presets/ or a path to a .json, set by install.sh), else pingel-brand. */
export function loadPreset(nameOrPath = process.env.REEL_PRESET || "pingel-brand") {
  const file = fs.existsSync(nameOrPath) && nameOrPath.endsWith(".json") ? nameOrPath : path.join(PRESET_DIR, `${nameOrPath}.json`);
  if (!fs.existsSync(file)) throw new Error(`preset not found: ${nameOrPath} (have: ${listPresets().join(", ")})`);
  const base = readJSON(path.join(PRESET_DIR, "_defaults.json"));
  const own = readJSON(file);
  // "extends": another preset's settings underneath this one's (pingel-runway builds on pingel-brand).
  const parent = own.extends ? deepMerge(base, readJSON(path.join(PRESET_DIR, `${own.extends}.json`))) : base;
  const p = deepMerge(parent, own);
  delete p.extends;
  if (!p.name) p.name = path.basename(file, ".json");
  // A brand preset names its fonts relative to itself (a kit installs them next to it in ~/.reel/fonts).
  if (own.fonts) {
    p.fonts = { ...p.fonts };
    for (const k of ["display", "displayItalic", "body"]) if (own.fonts[k] && !path.isAbsolute(own.fonts[k])) p.fonts[k] = path.resolve(path.dirname(file), own.fonts[k]);
  }
  let brand = p.brand?.schemaVersion === 2 ? p.brand : null;
  if (p.brandFile) {
    const candidates = path.isAbsolute(p.brandFile)
      ? [p.brandFile]
      : [path.resolve(PKG_ROOT, p.brandFile), path.resolve(path.dirname(file), p.brandFile)];
    const brandPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (brandPath) {
      try { brand = readJSON(brandPath); }
      catch (error) { warn(`brand tokens: ${error.message}; using preset colors and fonts`); }
    } else warn(`brand tokens: file not found: ${p.brandFile}; using preset colors and fonts`);
  }
  p.brand = resolveBrandTokens({ preset: p, brand });
  if (!["none", "edge-rule", "corner-mark", "title-plate"].includes(p.brand.signature?.kind)) {
    warn(`brand signature: unknown kind "${p.brand.signature.kind}"; disabled`);
    p.brand.signature = { ...p.brand.signature, kind: "none" };
  }
  return p;
}

export function loadDictionary(file) {
  const f = file || process.env.REEL_DICTIONARY || path.join(PKG_ROOT, "dictionary.json");
  return fs.existsSync(f) ? readJSON(f) : { terms: [], powerWords: [], corrections: [] };
}

/** The Runway b-roll timing and budget from presets/pingel-runway.json (clip length, gaps, counts, credit cap). */
export function runwayTiming() {
  const { enabled, engine, ...timing } = readJSON(path.join(PRESET_DIR, "pingel-runway.json")).broll || {};
  return timing;
}

/** CLI flags win over the preset. */
/** A pacing overlay (presets/pace-<name>.json) on top of any preset: `--pace fast` is the measured short-form pacing. */
export function applyPace(preset, pace) {
  if (!pace || pace === "normal") return preset;
  const file = path.join(PRESET_DIR, `pace-${pace}.json`);
  if (!fs.existsSync(file)) throw new Error(`no pacing "${pace}" (have: ${fs.readdirSync(PRESET_DIR).filter((f) => f.startsWith("pace-")).map((f) => f.slice(5, -5)).join(", ") || "none"})`);
  const { name, _about, ...over } = readJSON(file);
  return { ...deepMerge(preset, over), pace };
}

export function mergeOverrides(preset, o = {}) {
  const p = structuredClone(applyPace(preset, o.pace));
  // Numbers are read with `!= null`, so --music-volume 0 and --hook-position 0 count (a bare `if (o.x)` dropped them).
  const num = (v) => (v == null || v === "" ? null : parseFloat(v));
  if (o.silence) p.cuts.silence = o.silence;
  if (o.noBadTakes) p.cuts.badTakes = false;
  if (o.noFillers) p.cuts.fillers = false;
  if (o.noZooms) p.zooms.enabled = false;
  if (o.noCaptions) p.captions.enabled = false;
  if (o.captions) p.captions.enabled = true;
  if (o.noHook) p.hook.enabled = false;
  if (o.premise) p.premise = { ...(p.premise || {}), mode: "on", text: o.premise };
  if (["auto", "on", "off"].includes(o.premiseMode)) p.premise = { ...(p.premise || {}), mode: o.premiseMode };
  if (o.noPremise) p.premise = { ...(p.premise || {}), mode: "off", text: null };
  if (o.activeWord) p.captions.activeWord = true;
  if (o.titleStyle) p.hook.style = o.titleStyle;
  if (num(o.hookPosition) != null) p.hook.position = num(o.hookPosition);
  if (o.hookSeconds === "reel") p.hook.duration = "reel";
  else if (num(o.hookSeconds) > 0) p.hook.duration = num(o.hookSeconds);
  if (num(o.captionPosition) != null) p.captions.position = num(o.captionPosition);
  if (o.noAutoKeywords) p.captions.autoKeywords = false;
  if (o.cta) { p.cta.enabled = true; p.cta.text = o.cta; }
  if (o.ctaLast) p.cta.last = parseFloat(o.ctaLast);
  if (o.ctaAt) p.cta.start = parseFloat(o.ctaAt);
  if (o.ctaDuration) p.cta.duration = parseFloat(o.ctaDuration);
  if (o.ctaStyle) p.cta.style = o.ctaStyle;
  if (num(o.ctaPosition) != null) p.cta.position = num(o.ctaPosition);
  if (o.wordsPerLine) p.captions.wordsPerLine = parseInt(o.wordsPerLine, 10);
  if (o.canvas) p.canvas = o.canvas;
  if (o.music) p.audio.music = o.music;
  if (o.musicDir) p.audio.musicDir = o.musicDir;
  if (o.musicWant) p.audio.musicWant = o.musicWant;
  if (o.noDuck) p.audio.duck = false;
  if (o.duckFrom === "voice" || o.duckFrom === "words") p.audio.duckFrom = o.duckFrom;
  if (num(o.musicVolume) != null) p.audio.musicVolume = num(o.musicVolume);
  if (o.sfx) p.audio.sfx = true;
  if (o.noCleanAudio) p.audio.cleanAudio = false;
  if (o.roomTone) p.audio.roomTone = true;
  if (o.noRoomTone) p.audio.roomTone = false;
  if (o.voice) p.audio.voiceId = o.voice;
  if (o.engine) p.transcribe.engine = o.engine;
  if (o.model) p.transcribe.model = o.model;
  if (o.language) p.transcribe.language = o.language;
  if (o.quality) p.render.quality = o.quality;
  if (o.fps) p.render.fps = parseFloat(o.fps);
  if (o.broll) p.broll.enabled = true;
  if (o.graphics) p.graphics.enabled = true;
  if (o.noGraphics) p.graphics.enabled = false;
  if (o.captionStyle) p.captions.style = o.captionStyle;
  if (o.noBroll) p.broll.enabled = false;
  if (o.slams) p.slams.enabled = true;
  if (o.noSlams) p.slams.enabled = false;
  if (o.annotate) p.captions.annotate = true;
  if (o.noAnnotate) p.captions.annotate = false;
  if (o.zoomStyle) p.zooms.style = o.zoomStyle;
  if (o.brollCut) p.broll.cut = o.brollCut;
  if (o.brollEngine) {
    // A preset that is not a Runway preset (a client's brand, from the Runway drop folder) gets the pingel-runway
    // timing and budget under its own look, instead of the 2-second still timing.
    if (o.brollEngine === "runway" && p.broll.engine !== "runway") Object.assign(p.broll, runwayTiming());
    p.broll.engine = o.brollEngine;
  }
  if (o.noCadence) p.zooms.cadence.enabled = false;
  if (o.coldOpen) p.coldOpen.enabled = true;
  if (o.noColdOpen) p.coldOpen.enabled = false;
  if (o.sounds) p.audio.sounds = true;
  if (o.noSounds) p.audio.sounds = false;
  if (o.studio) p.audio.studio = true;
  if (o.noStudio) p.audio.studio = false;
  if (o.fixWords) p.transcribe.fix = true;
  if (o.noFixWords) p.transcribe.fix = false;
  if (o.align) p.transcribe.align = "always";
  if (o.noAlign) p.transcribe.align = false;
  if (o.noPreflight) p.preflight = { ...(p.preflight || {}), enabled: false };
  if ((Array.isArray(o.credit) ? o.credit.length : o.credit) || o.creditSelf) p.lowerThird.credential = true;
  if (o.look) p.graphics = { ...(p.graphics || {}), look: o.look === "auto" ? null : o.look };
  if (o.signature) p.signature = { ...(p.signature || {}), enabled: true };
  if (o.noSignature) p.signature = { ...(p.signature || {}), enabled: false };
  if (o.houseLooks) p.houseLooks = { ...(p.houseLooks || {}), enabled: true };
  if (o.noHouseLooks) p.houseLooks = { ...(p.houseLooks || {}), enabled: false };
  if (o.behind) p.hook.behind = true;
  if (o.noBehind) p.hook.behind = false;
  if (["frame", "designed", "archetypes"].includes(o.coverStyle)) p.cover.style = o.coverStyle;
  return p;
}
