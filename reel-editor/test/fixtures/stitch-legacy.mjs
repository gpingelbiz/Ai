import { fixturePlan } from "../../scripts/golden.mjs";
import { listPresets, loadPreset } from "../../src/presets.mjs";
import { brandPreset } from "../../src/brandkit.mjs";
import { resolveBrandTokens } from "../../src/brandtokens.mjs";
import { deepMerge } from "../../src/util.mjs";

export function legacyStitchFixtures() {
  const plans = {};
  for (const name of listPresets()) {
    const p = fixturePlan("/tmp/stitch-legacy.mp4"); p.style = loadPreset(name); p.preset = p.style.name;
    if (["vsl", "youtube"].includes(name)) p.canvas = { width: 1920, height: 1080, mode: "landscape" };
    plans[name] = p;
  }
  const glow = structuredClone(plans["pingel-brand"]);
  glow.style.captions.style = "glow"; glow.glowScenes = []; glow.glowOverlays = [];
  plans["glow-active"] = glow;
  const brand = { name: "Example Coach", handle: "@example", colors: { text: "#ffffff", accent: "#e94b8a" }, look: { captions: "quiet" } };
  for (const look of ["atelier", "note", "serifonlife"]) {
    const p = fixturePlan("/tmp/stitch-legacy.mp4");
    p.style = deepMerge(loadPreset("pingel-brand"), brandPreset(brand)); p.preset = p.style.name;
    p.style.brand = resolveBrandTokens({ brand }); p.graphics = p.graphics.map((g) => ({ ...g, skin: look }));
    plans[`client-${look}`] = p;
  }
  return plans;
}
