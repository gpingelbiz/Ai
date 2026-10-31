import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PKG_ROOT, slug } from "./util.mjs";
import { LOOKS, LOOK_IDS } from "./looks.mjs";
import { upgradeBrandV1 } from "./brandtokens.mjs";
import { signupsHTML } from "./signups.mjs";
import { deepMerge, readJSON } from "./util.mjs";
import { resolveBrandTokens } from "./brandtokens.mjs";
import { assertNoGreg } from "./speaker-intake.mjs";

/**
 * Brand kits: one brand file (kit/brand-template.json) becomes a Reel Editor Kit zip for someone else, with their
 * look, fonts, words and caption voice built in. The kit's installer puts the brand in ~/.reel and never asks for a
 * look. Everything personal to Greg in his presets (colors, b-roll world, @handle, carousel style, name tag, his
 * caption voice and framework names) is overridden, so none of it can reach someone else's reels.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Problems with a brand file, in words; empty when it can be built. */
export function checkBrand(b) {
  const out = [];
  if (!b || typeof b !== "object") return ["the brand file is not a JSON object"];
  if (!String(b.name || "").trim()) out.push("name is missing (their name, as it appears on the kit)");
  if (b.handle && !/^@[A-Za-z0-9._]+$/.test(b.handle)) out.push(`handle "${b.handle}" should look like @theirhandle`);
  for (const k of ["text", "accent"]) if (!HEX.test(b.colors?.[k] || "")) out.push(`colors.${k} must be a hex color like #FFFFFF`);
  for (const k of ["stroke", "bg"]) if (b.colors?.[k] && !HEX.test(b.colors[k])) out.push(`colors.${k} must be a hex color like #000000`);
  if (b.look?.hook && !["headline", "gold", "box"].includes(b.look.hook)) out.push('look.hook is "headline", "gold" or "box"');
  if (b.look?.captions && !["reveal", "pop", "quiet", "serif"].includes(b.look.captions)) out.push('look.captions is "reveal", "pop", "quiet" or "serif"');
  for (const k of ["hookCase", "captionCase"]) if (b.look?.[k] && !["upper", "sentence"].includes(b.look[k])) out.push(`look.${k} is "upper" or "sentence"`);
  const hs = b.look?.hookSeconds;
  if (hs != null && hs !== "reel" && !(Number(hs) >= 1 && Number(hs) <= 60)) out.push('look.hookSeconds is a number of seconds (1-60) or "reel"');
  if (b.look?.pace && !["fast", "calm"].includes(b.look.pace)) out.push('look.pace is "fast" or "calm"');
  if (b.looks?.only != null) {
    const only = Array.isArray(b.looks.only) ? b.looks.only.map((x) => String(x).toLowerCase().trim()) : [];
    for (const x of only) if (!LOOK_IDS.includes(x) || x === "gregcard") out.push(`looks.only: "${x}" is not a look they can use (${LOOK_IDS.filter((id) => id !== "gregcard").join(", ")})`);
    if (only.filter((x) => LOOK_IDS.includes(x) && x !== "gregcard").length < 2) out.push("looks.only needs at least 2 looks, so reels can vary");
  }
  return out;
}

export const kitSlug = (b) => slug(b.name || b.identity?.name || "brand");

/**
 * Calm pacing (look.pace "calm"): gentler silence cuts (gaps over 0.6 s instead of 0.35 s), punch-ins at most every
 * 16 s and two per 30 s with no jump-cut cadence between them, no icon pops or impact bumps, and no cold open unless
 * look.coldOpen turns it on.
 * "fast" (the default) is the pacing Greg's own reels used until 2026-10-31 (FAST below).
 */
export const CALM = { cuts: { silence: "medium" }, zooms: { minSpacing: 16, maxPer30: 2, cadence: { enabled: false } }, icons: { enabled: false }, motion: { impact: { enabled: false } } };

/**
 * Fast pacing (the default for client brands): tight silence cuts, the jump-cut cadence between the punch-ins,
 * and cards and cutaways right after the hook. Greg's own preset moved to the one-take look on
 * 2026-10-31 (his uncut reels held viewers best), so client brands write this out instead of inheriting his.
 */
export const FAST = { cuts: { silence: "fast" }, zooms: { cadence: { enabled: true } } };

/** The card looks a brand allows: everything but gregcard, or only `looks.only` (brand looks included). */
export function lookChoice(b) {
  const only = Array.isArray(b?.looks?.only) ? b.looks.only.map((x) => String(x).toLowerCase().trim()).filter((x) => LOOK_IDS.includes(x) && x !== "gregcard") : [];
  if (!only.length) return { excludeLooks: ["gregcard"] };
  return { excludeLooks: LOOK_IDS.filter((id) => !only.includes(id) && !LOOKS[id].brandOnly), includeLooks: only.filter((id) => LOOKS[id].brandOnly) };
}

/** The reel preset: Greg's full look underneath (so it keeps improving with the editor), every personal field theirs. */
export function brandPreset(b, { fonts = {} } = {}) {
  const tokens = upgradeBrandV1(b);
  const compat = tokens.compat?.reel || {};
  const identity = tokens.identity || {};
  const colors = tokens.colors || {};
  const look = b.schemaVersion === 2
    ? { hookCase: tokens.type?.display?.case, captionCase: tokens.type?.body?.case, pace: tokens.motion?.personality, ...(compat.look || {}) }
    : compat.look || {};
  const legacy = b.schemaVersion === 2
    ? { ...b, name: identity.name, handle: identity.handle, looks: compat.looks || { only: tokens.houseLooks || [] } }
    : b;
  const calm = look.pace === "calm";
  const quietCaps = look.captions === "quiet" || look.captions === "serif";
  // Only what the brand file asks for is written, so a brand file without these fields keeps Greg's behaviour.
  const coldOpen = look.coldOpen != null ? look.coldOpen !== false : calm ? false : null;
  return {
    name: `brand-${kitSlug(b)}`,
    extends: "pingel-brand",
    brandFile: "",
    brand: tokens,
    colors: { text: colors.ink, accent: colors.accent, stroke: colors.stroke || "#000000", bg: colors.surface || "#0B0B0D" },
    ...(fonts.display || fonts.body ? { fonts: { ...(fonts.display ? { display: fonts.display } : {}), ...(fonts.displayItalic ? { displayItalic: fonts.displayItalic } : {}), ...(fonts.body ? { body: fonts.body } : {}) } } : {}),
    // quiet: the reveal timing in the body font at 600, smaller, no outline, the keyword in an accent box.
    // serif: the same in their display serif (BossBabe's and Jasmine Star's podcast captions), a touch larger.
    // Both turn the keyword colour back on: the accent box is the point, and Greg's preset has it off for his gold.
    captions: { style: quietCaps ? "reveal" : look.captions || "reveal", annotate: look.annotate !== false, ...(quietCaps ? { quiet: true, keywordColorOnFootage: true, fontSizeFrac: look.captions === "serif" ? 0.033 : 0.029 } : {}), ...(look.captions === "serif" ? { serif: true } : {}), ...(look.captionCase ? { uppercase: look.captionCase !== "sentence" } : {}) },
    hook: {
      style: look.hook || "headline", behind: look.behind !== false,
      // looks.lockHook false lets each reel's look draw the hook; Greg's plaque would cover every one of them.
      ...(legacy.looks?.lockHook === false ? { plaque: false } : {}),
      ...(look.hookCase ? { uppercase: look.hookCase !== "sentence" } : {}),
      ...(look.hookSeconds != null ? { duration: look.hookSeconds === "reel" ? "reel" : Number(look.hookSeconds) } : {}),
    },
    ...structuredClone(calm ? CALM : FAST),
    ...(coldOpen != null ? { coldOpen: { enabled: coldOpen } } : {}),
    // Calm brands keep the slams plain: no pop-out (the dim, outline and word behind the head), no icon stickers
    // and no impact bumps (CALM); drift and the face-on b-roll layouts stay.
    slams: { enabled: look.slams !== false, ...(calm ? { popout: { enabled: false } } : {}) },
    ...((legacy.looks?.lockHook != null || legacy.looks?.lockCaptions != null) ? { looks: { lockHook: legacy.looks?.lockHook === true, lockCaptions: legacy.looks?.lockCaptions === true } } : {}),
    // The Greg card is Greg's signature look; nobody else's reels get it. looks.only narrows the catalog to the
    // looks listed and opts into the brand looks among them (atelier, note, serifonlife).
    graphics: { ...lookChoice(legacy), ...(calm ? { every: 14, max: 4 } : { every: 10, max: 6 }), clearStart: 0 },
    // worldInPrompt: the Codex stills come from their world, not Greg's built-in examples.
    broll: { world: String(compat.world ?? b.world ?? "").trim(), worldInPrompt: true, style: String(compat.brollStyle ?? b.brollStyle ?? "").trim(), max: 3, every: 12, clearStart: 0 },
    carousel: { handle: identity.handle || "", style: String(compat.carouselStyle ?? b.carouselStyle ?? "").trim() },
    lowerThird: { name: identity.name, handle: identity.handle || "" },
  };
}

/** Their YouTube look: the youtube preset with their name tag, colors and fonts. */
export function youtubePreset(b, { fonts = {} } = {}) {
  const tokens = upgradeBrandV1(b);
  const identity = tokens.identity || {};
  const colors = tokens.colors || {};
  const compat = tokens.compat?.reel || {};
  return {
    name: `brand-${kitSlug(b)}-youtube`,
    extends: "youtube",
    brandFile: "",
    brand: tokens,
    colors: { text: colors.ink, accent: colors.accent, stroke: colors.stroke || "#000000", bg: colors.surface || "#0B0B0D" },
    ...(fonts.display || fonts.body ? { fonts: { ...(fonts.display ? { display: fonts.display } : {}), ...(fonts.body ? { body: fonts.body } : {}) } } : {}),
    broll: { world: String(compat.world ?? b.world ?? "").trim() },
    carousel: { handle: identity.handle || "" },
    lowerThird: { name: identity.name, handle: identity.handle || "" },
  };
}

/** A resolved speaker preset: reuse client YouTube tokens without inheriting its personal preset. */
export function speakerPreset(b, { fonts = {} } = {}) {
  assertNoGreg(b, "brand");
  const name = b?.schemaVersion === 2 ? b.identity?.name : b?.name;
  if (!String(name || "").trim()) throw new Error("speaker brand: name is missing");
  for (const role of ["display", "body"]) {
    const font = b.schemaVersion === 2 ? b.type?.[role] : b.fonts?.[role];
    if (!(typeof font === "string" ? font.trim() : font && (font.family || font.file))) throw new Error(`speaker brand: ${role} font is missing`);
  }
  const client = youtubePreset(b, { fonts });
  delete client.extends;
  const neutral = readJSON(path.join(PKG_ROOT, "presets", "speaker.json"));
  const preset = deepMerge(deepMerge(readJSON(path.join(PKG_ROOT, "presets", "_defaults.json")), client), neutral);
  preset.name = `brand-${kitSlug(b)}-speaker`;
  preset.brandFile = null;
  preset.brand = resolveBrandTokens({ preset, brand: b });
  preset.colors = client.colors;
  preset.lowerThird = { ...preset.lowerThird, name, handle: preset.brand.identity?.handle || "" };
  preset.fonts = fonts.display || fonts.body ? { ...fonts } : {
    display: preset.brand.type.display.file || preset.brand.type.display.family,
    body: preset.brand.type.body.file || preset.brand.type.body.family,
  };
  return assertNoGreg(preset, "speaker preset");
}

/** Their word list: their terms and names; the generic power words stay, Greg's frameworks and fixes do not. */
export function brandDictionary(b) {
  let power = [];
  try { power = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "dictionary.json"), "utf8")).powerWords || []; } catch {}
  const list = (x) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
  return { terms: list(b.terms), names: [b.name, ...list(b.names)].filter((v, i, a) => v && a.indexOf(v) === i), phrases: list(b.phrases), candidates: list(b.candidates), powerWords: power, corrections: Array.isArray(b.corrections) ? b.corrections.filter((c) => c && c.from && c.to) : [] };
}

/** Their caption voice: the brand file's own words, or the neutral default with their name on it. */
export function brandVoice(b) {
  if (String(b.voice || "").trim()) return `# ${b.name}: caption voice\n\n${String(b.voice).trim()}\n`;
  let base = "";
  try { base = fs.readFileSync(path.join(PKG_ROOT, "voice", "default.md"), "utf8"); } catch {}
  return `# ${b.name}: caption voice\n\nEdit this file: who you talk to, the words you use, the words you never use.\n\n${base}`;
}

/**
 * A font for the kit: a .ttf/.otf path as given, or a Google Fonts family by name ("Bebas Neue", "Montserrat
 * ExtraBold"), fetched from github.com/google/fonts. Only open-licensed (OFL, Apache, UFL) families are taken.
 * Returns {file, license, source} or throws with what to do.
 */
export async function fetchFont(spec, outFile, { fetchImpl = fetch, italic = false } = {}) {
  if (!spec) return null;
  if (/\.(ttf|otf)$/i.test(spec)) {
    if (italic) return null;
    const src = spec.replace(/^~(?=\/)/, os.homedir());
    if (!fs.existsSync(src)) throw new Error(`font file not found: ${spec}`);
    fs.copyFileSync(src, outFile);
    return { file: outFile, license: "supplied with the brand (check it allows video use)", source: src };
  }
  const words = String(spec).trim().split(/\s+/);
  const WEIGHTS = ["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold", "ExtraBold", "Black"];
  const weight = WEIGHTS.find((w) => w.toLowerCase() === words[words.length - 1].toLowerCase());
  const family = (weight ? words.slice(0, -1) : words).join(" ");
  const dir = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const lic of ["ofl", "apache", "ufl"]) {
    const list = async (sub) => {
      const res = await fetchImpl(`https://api.github.com/repos/google/fonts/contents/${lic}/${dir}${sub}`, { headers: { "User-Agent": "reel-editor" } });
      return res.ok ? (await res.json()).filter((f) => /\.ttf$/i.test(f.name)) : null;
    };
    const top = await list("");
    if (!top) continue;
    const stat = (await list("/static")) || [];
    const fam = family.replace(/\s+/g, "");
    const want = `${fam}-${weight || "Regular"}.ttf`.toLowerCase();
    // No weight named: the variable font first (it carries every weight; reveal captions are drawn at 850).
    const variable = top.find((f) => /\[.*wght.*\]\.ttf$/i.test(f.name) && !/italic/i.test(f.name));
    // italic: the family's italic (the brand looks set the keyword in it), variable first; none means none.
    const pick = italic
      ? top.find((f) => /italic\[.*wght.*\]\.ttf$/i.test(f.name)) || [...top, ...stat].find((f) => f.name.toLowerCase() === `${fam}-italic.ttf`.toLowerCase())
      : (!weight && variable) || [...top, ...stat].find((f) => f.name.toLowerCase() === want)
        || top.find((f) => /-regular\.ttf$/i.test(f.name))
        || top.find((f) => !/italic/i.test(f.name));
    if (!pick && italic) return null;
    if (!pick) continue;
    const res = await fetchImpl(pick.download_url);
    if (!res.ok) throw new Error(`could not download ${pick.name}: HTTP ${res.status}`);
    fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
    return { file: outFile, license: lic === "ofl" ? "SIL Open Font License" : lic === "apache" ? "Apache License 2.0" : "Ubuntu Font License", source: pick.download_url, note: weight && pick.name.toLowerCase() !== want ? `${weight} is not a separate file; using ${pick.name}` : "" };
  }
  throw new Error(`"${spec}" is not an open-licensed Google Fonts family; give a .ttf path instead`);
}

/** The Start Here page without its Content Studio parts (a plain reel kit, or the generic kit). */
export const stripStudio = (html) => String(html).replace(/[ \t]*<!-- studio -->[\s\S]*?<!-- \/studio -->\n?/g, "");

/**
 * The Start Here page with their name on it and the look question gone (their look comes with the kit). A Content
 * Studio kit (`studio: true`) keeps the Content Studio section and points at Install Content Studio.command; any
 * other kit drops it.
 */
export function personalizeStartHere(html, b, { studio = false } = {}) {
  const who = studio ? `${b.name}'s Content Studio` : `${b.name}'s Reel Editor`;
  const page = studio
    ? String(html).replace(/<!-- \/?studio -->\n?/g, "").replace(/<b>Install Reel Editor\.command<\/b>/g, "<b>Install Content Studio.command</b>")
    : stripStudio(html);
  return page
    .replace("<!-- signups -->", signupsHTML({ studio }))
    .replace(/<title>Reel Editor: Start Here<\/title>/, `<title>${esc(who)}: Start Here</title>`)
    .replace(/<h1>Reel Editor<\/h1>/, `<h1>${esc(who)}</h1>`)
    .replace(/<tr><td>Your look<\/td><td>[\s\S]*?<\/td><\/tr>/, `<tr><td>Your look</td><td>Already set: this kit carries your colors${b.fonts?.display || b.fonts?.body ? ", fonts" : ""}, caption voice and words. The installer does not ask.</td></tr>`)
    .replace(/<li><b>Change your look:<\/b>[\s\S]*?<\/li>/, `<li><b>Change your look:</b> open <code>~/.reel/my-brand.json</code> and edit the <code>colors</code> hex codes, or ask for a new kit.</li>`);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
