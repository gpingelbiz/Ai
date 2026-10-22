import fs from "node:fs";
import path from "node:path";
import { readJSON, deepMerge, PKG_ROOT } from "./util.mjs";

const PRESET_DIR = path.join(PKG_ROOT, "presets");

export function listPresets() {
  return fs
    .readdirSync(PRESET_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => f.replace(/\.json$/, ""));
}

/** Default preset: REEL_PRESET (a name in presets/ or a path to a .json, set by install.sh), else pingel-brand. */
export function loadPreset(nameOrPath = process.env.REEL_PRESET || "pingel-brand") {
  const file = fs.existsSync(nameOrPath) && nameOrPath.endsWith(".json") ? nameOrPath : path.join(PRESET_DIR, `${nameOrPath}.json`);
  if (!fs.existsSync(file)) throw new Error(`preset not found: ${nameOrPath} (have: ${listPresets().join(", ")})`);
  const base = readJSON(path.join(PRESET_DIR, "_defaults.json"));
  const p = deepMerge(base, readJSON(file));
  if (!p.name) p.name = path.basename(file, ".json");
  return p;
}

export function loadDictionary(file) {
  const f = file || process.env.REEL_DICTIONARY || path.join(PKG_ROOT, "dictionary.json");
  return fs.existsSync(f) ? readJSON(f) : { terms: [], powerWords: [], corrections: [] };
}

/** CLI flags win over the preset. */
export function mergeOverrides(preset, o = {}) {
  const p = structuredClone(preset);
  // Numbers are read with `!= null`, so --music-volume 0 and --hook-position 0 count (a bare `if (o.x)` dropped them).
  const num = (v) => (v == null || v === "" ? null : parseFloat(v));
  if (o.silence) p.cuts.silence = o.silence;
  if (o.noBadTakes) p.cuts.badTakes = false;
  if (o.noFillers) p.cuts.fillers = false;
  if (o.noZooms) p.zooms.enabled = false;
  if (o.noCaptions) p.captions.enabled = false;
  if (o.captions) p.captions.enabled = true;
  if (o.noHook) p.hook.enabled = false;
  if (o.activeWord) p.captions.activeWord = true;
  if (o.titleStyle) p.hook.style = o.titleStyle;
  if (num(o.hookPosition) != null) p.hook.position = num(o.hookPosition);
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
  if (num(o.musicVolume) != null) p.audio.musicVolume = num(o.musicVolume);
  if (o.sfx) p.audio.sfx = true;
  if (o.noCleanAudio) p.audio.cleanAudio = false;
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
  if (o.noCadence) p.zooms.cadence.enabled = false;
  if (o.coldOpen) p.coldOpen.enabled = true;
  if (o.noColdOpen) p.coldOpen.enabled = false;
  if (o.sounds) p.audio.sounds = true;
  if (o.noSounds) p.audio.sounds = false;
  return p;
}
