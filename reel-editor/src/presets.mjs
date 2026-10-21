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

export function loadPreset(nameOrPath = "pingel-brand") {
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
  if (o.silence) p.cuts.silence = o.silence;
  if (o.noBadTakes) p.cuts.badTakes = false;
  if (o.noFillers) p.cuts.fillers = false;
  if (o.noZooms) p.zooms.enabled = false;
  if (o.noCaptions) p.captions.enabled = false;
  if (o.noHook) p.hook.enabled = false;
  if (o.activeWord) p.captions.activeWord = true;
  if (o.titleStyle) p.hook.style = o.titleStyle;
  if (o.cta) { p.cta.enabled = true; p.cta.text = o.cta; }
  if (o.ctaLast) p.cta.last = parseFloat(o.ctaLast);
  if (o.ctaAt) p.cta.start = parseFloat(o.ctaAt);
  if (o.ctaDuration) p.cta.duration = parseFloat(o.ctaDuration);
  if (o.ctaStyle) p.cta.style = o.ctaStyle;
  if (o.ctaPosition) p.cta.position = parseFloat(o.ctaPosition);
  if (o.wordsPerLine) p.captions.wordsPerLine = parseInt(o.wordsPerLine, 10);
  if (o.canvas) p.canvas = o.canvas;
  if (o.music) p.audio.music = o.music;
  if (o.musicVolume) p.audio.musicVolume = parseFloat(o.musicVolume);
  if (o.sfx) p.audio.sfx = true;
  if (o.noCleanAudio) p.audio.cleanAudio = false;
  if (o.voice) p.audio.voiceId = o.voice;
  if (o.engine) p.transcribe.engine = o.engine;
  if (o.model) p.transcribe.model = o.model;
  if (o.language) p.transcribe.language = o.language;
  if (o.quality) p.render.quality = o.quality;
  if (o.fps) p.render.fps = parseFloat(o.fps);
  return p;
}
