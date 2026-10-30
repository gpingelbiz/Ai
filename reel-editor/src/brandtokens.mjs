/** Shared semantic brand tokens. Renderers consume roles from here, never a person's literal palette. */

export const BRAND_SCHEMA = 2;

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_ROLES = ["ink", "accent", "accentInk", "surface", "surface2", "stroke", "muted", "paper", "warn"];
const TYPE_ROLES = ["display", "body", "editorial", "mono"];

const TYPE_SCALE = { xs: 24, sm: 30, md: 40, lg: 54, xl: 72, display: 112, slideBody: 42 };
const SPACING = { xs: 8, sm: 16, md: 24, lg: 40, xl: 64, xxl: 96 };
const RADIUS = { sm: 8, md: 18, lg: 36, pill: 999 };

const clone = (value) => value == null ? value : structuredClone(value);

function merge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return clone(over ?? base);
  if (!base || typeof base !== "object" || !over || typeof over !== "object") return clone(over ?? base);
  const out = clone(base);
  for (const [key, value] of Object.entries(over)) out[key] = key in out ? merge(out[key], value) : clone(value);
  return out;
}

const validHex = (value) => HEX.test(String(value || ""));
const rgb = (hex) => validHex(hex) ? [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) : [0, 0, 0];
const hex = (parts) => `#${parts.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const mixHex = (a, b, amount = 0.5) => hex(rgb(a).map((v, i) => v * (1 - amount) + rgb(b)[i] * amount));

function luminance(value) {
  const channel = (n) => {
    const x = n / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(value).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The color itself when it reads on `background` (at least `min`:1), else the same hue darkened (light background) or
 * lightened (dark background) just enough to reach it. A pale accent like peach on white paper becomes a deep peach.
 */
export function readableOn(color, background, min = 4.5) {
  if (contrast(color, background) >= min) return color;
  const toward = luminance(background) > 0.18 ? "#000000" : "#FFFFFF";
  for (let step = 1; step <= 50; step += 1) {
    const next = mixHex(color, toward, step / 50);
    if (contrast(next, background) >= min) return next;
  }
  return toward;
}

function familyFromFile(file, fallback) {
  if (!file) return fallback;
  const name = String(file).split(/[\\/]/).pop().replace(/\.(?:ttf|otf|woff2?)$/i, "");
  return name.replace(/[-_](?:regular|variable|bold|medium|semibold|black|italic).*$/i, "").replace(/[-_]+/g, " ") || fallback;
}

function fontRole(spec, fallback, { caseMode, lineHeight, tracking, weights = [400] } = {}) {
  const given = spec && typeof spec === "object" ? spec : {};
  const text = typeof spec === "string" ? spec.trim() : "";
  const isFile = /\.(?:ttf|otf|woff2?)$/i.test(text);
  const family = given.family || (isFile ? familyFromFile(text, fallback.family) : text) || fallback.family;
  const file = given.file || (isFile ? text : text ? null : fallback.file || null);
  const googleFamily = given.googleFamily || (!isFile && text ? text : fallback.googleFamily || null);
  return {
    family,
    file,
    googleFamily,
    weights: clone(given.weights || weights),
    case: given.case || caseMode || "sentence",
    tracking: Number.isFinite(given.tracking) ? given.tracking : tracking ?? 0,
    lineHeight: Number.isFinite(given.lineHeight) ? given.lineHeight : lineHeight ?? 1.2,
    licence: given.licence || given.license || fallback.licence || "",
    sourceUrl: given.sourceUrl || given.sourceURL || fallback.sourceUrl || "",
  };
}

/** The full color roles from whatever a brand gives (ink or text, surface or bg, accent, stroke); the rest derived. */
export function derivedColors(input = {}) {
  const ink = validHex(input.ink) ? input.ink : validHex(input.text) ? input.text : "#F5F1E8";
  const accent = validHex(input.accent) ? input.accent : "#C8A24B";
  const surface = validHex(input.surface) ? input.surface : validHex(input.bg) ? input.bg : "#0B0B0D";
  const stroke = validHex(input.stroke) ? input.stroke : surface;
  const accentInk = validHex(input.accentInk) ? input.accentInk : contrast(ink, accent) >= contrast(surface, accent) ? ink : surface;
  return {
    ink,
    accent,
    accentInk,
    surface,
    surface2: validHex(input.surface2) ? input.surface2 : mixHex(surface, ink, 0.1),
    stroke,
    muted: validHex(input.muted) ? input.muted : mixHex(ink, surface, 0.38),
    paper: validHex(input.paper) ? input.paper : luminance(surface) > 0.55 ? surface : ink,
    warn: validHex(input.warn) ? input.warn : accent,
  };
}

function motionTokens(personality = "punchy") {
  return personality === "calm"
    ? { personality: "calm", enterMs: 600, exitMs: 350, staggerMs: 110, enterEase: "sine.out", exitEase: "sine.in" }
    : { personality: "punchy", enterMs: 420, exitMs: 280, staggerMs: 60, enterEase: "power3.out", exitEase: "power2.in" };
}

function baseTokens({ colors = {}, display, body, identity = {}, personality = "punchy" } = {}) {
  const calm = personality === "calm";
  return {
    schemaVersion: BRAND_SCHEMA,
    identity: {
      name: identity.name || "",
      handle: identity.handle || "",
      credential: identity.credential || "",
      logo: identity.logo || null,
      handlePlacement: identity.handlePlacement || "bottom-left",
    },
    colors: derivedColors(colors),
    type: {
      display: fontRole(display, { family: "Anton", file: "assets/fonts/Anton-Regular.ttf", licence: "SIL OFL 1.1" }, { caseMode: "upper", lineHeight: 0.95, tracking: 0.005 }),
      body: fontRole(body, { family: "Inter", file: "assets/fonts/Inter.ttf", licence: "SIL OFL 1.1" }, { caseMode: "sentence", lineHeight: 1.32, tracking: 0, weights: [400, 500, 600, 700, 850] }),
      editorial: null,
      mono: null,
    },
    typeScale: clone(TYPE_SCALE),
    spacing: clone(SPACING),
    radius: clone(RADIUS),
    texture: { grain: calm ? 0.025 : 0.08, paper: calm },
    motion: motionTokens(personality),
    signature: { kind: "none", position: "none", colorRole: "accent", thickness: 0, opacity: 0.68 },
    imagery: { finish: true, grade: "muted-editorial", intensity: calm ? 0.3 : 0.55 },
    houseLooks: [],
    modes: {},
    contentModes: {},
  };
}

/** Upgrade the original kit/brand-template.json shape to the complete v2 semantic shape. */
export function upgradeBrandV1(v1) {
  if (v1?.schemaVersion === BRAND_SCHEMA) return clone(v1);
  const source = v1 && typeof v1 === "object" ? v1 : {};
  const personality = source.look?.pace === "calm" ? "calm" : "punchy";
  const displaySpec = source.fonts?.display || { family: "Anton", file: "assets/fonts/Anton-Regular.ttf", licence: "SIL OFL 1.1" };
  const bodySpec = source.fonts?.body || { family: "Inter", file: "assets/fonts/Inter.ttf", licence: "SIL OFL 1.1" };
  const out = baseTokens({
    colors: source.colors || {},
    display: displaySpec,
    body: bodySpec,
    identity: {
      name: source.name,
      handle: source.handle,
      credential: source.credential || source.credentialLine,
      logo: typeof source.logo === "string" ? source.logo : source.logo?.file || null,
      handlePlacement: source.handlePlacement,
    },
    personality,
  });
  out.type.display.case = source.look?.hookCase || "upper";
  out.type.body.case = source.look?.captionCase || "upper";
  if (source.fonts?.display && source.fontLicences?.display) out.type.display.licence = source.fontLicences.display;
  if (source.fonts?.body && source.fontLicences?.body) out.type.body.licence = source.fontLicences.body;
  if (source.fontSources?.display) out.type.display.sourceUrl = source.fontSources.display;
  if (source.fontSources?.body) out.type.body.sourceUrl = source.fontSources.body;
  // A v1 file did not carry licensing metadata for its chosen fonts. Keep that absence visible to validation.
  if (source.fonts?.display && !source.fontLicences?.display) out.type.display.licence = "";
  if (source.fonts?.body && !source.fontLicences?.body) out.type.body.licence = "";
  out.houseLooks = Array.isArray(source.looks?.only) ? clone(source.looks.only) : [];
  out.modes = clone(source.modes || source.contentModes || {});
  out.contentModes = clone(source.contentModes || source.modes || {});
  out.compat = {
    reel: {
      look: clone(source.look || {}),
      looks: clone(source.looks || {}),
      world: String(source.world || ""),
      brollStyle: String(source.brollStyle || ""),
      carouselStyle: String(source.carouselStyle || ""),
    },
  };
  return out;
}

/** Return plain-English validation problems. Warnings are prefixed so callers can keep them non-fatal. */
export function validateBrand(brand) {
  if (!brand || typeof brand !== "object") return ["brand is not a JSON object"];
  const legacyProblems = [];
  if (brand.schemaVersion !== BRAND_SCHEMA) {
    for (const [legacy, role] of [["text", "ink"], ["accent", "accent"], ["bg", "surface"], ["stroke", "stroke"]]) {
      const value = brand.colors?.[legacy];
      if (value != null && !validHex(value)) legacyProblems.push(`colors.${role} must be a six-digit hex color like #F5F1E8`);
    }
  }
  const b = brand.schemaVersion === BRAND_SCHEMA ? brand : upgradeBrandV1(brand);
  const problems = [...legacyProblems];
  for (const role of ["ink", "accent", "surface"]) if (!b.colors?.[role]) problems.push(`colors.${role} is missing`);
  for (const role of COLOR_ROLES) {
    const value = b.colors?.[role];
    if (value != null && !validHex(value)) problems.push(`colors.${role} must be a six-digit hex color like #F5F1E8`);
  }
  if (validHex(b.colors?.ink) && validHex(b.colors?.surface) && contrast(b.colors.ink, b.colors.surface) < 4.5) {
    problems.push(`colors.ink on colors.surface has contrast below 4.5:1`);
  }
  if (b.type?.display && !String(b.type.display.licence || b.type.display.license || "").trim()) {
    problems.push("warning: type.display has no licence noted");
  }
  return problems;
}

function tokensFromPreset(preset = {}) {
  const displayFile = preset.fonts?.display || "assets/fonts/Anton-Regular.ttf";
  const bodyFile = preset.fonts?.body || "assets/fonts/Inter.ttf";
  const calm = preset.motion?.personality === "calm" || (preset.zooms?.minSpacing >= 16 && preset.zooms?.cadence?.enabled === false);
  const tokens = baseTokens({
    colors: preset.colors || {},
    display: { family: familyFromFile(displayFile, "Anton"), file: displayFile, weights: [400], case: preset.hook?.uppercase === false ? "sentence" : "upper", licence: displayFile.includes("assets/fonts/Anton") ? "SIL OFL 1.1" : "" },
    body: { family: familyFromFile(bodyFile, "Inter"), file: bodyFile, weights: [400, 500, 600, 700, 850], case: preset.captions?.uppercase === false ? "sentence" : "upper", licence: bodyFile.includes("assets/fonts/Inter") ? "SIL OFL 1.1" : "" },
    identity: {
      name: preset.lowerThird?.name || "",
      handle: preset.carousel?.handle || preset.lowerThird?.handle || "",
      credential: typeof preset.lowerThird?.credential === "string" ? preset.lowerThird.credential : "",
    },
    personality: calm ? "calm" : "punchy",
  });
  const grade = preset.broll?.grade;
  if (grade?.preset) tokens.imagery = { finish: true, grade: grade.preset, intensity: Number.isFinite(grade.intensity) ? grade.intensity : 0.55 };
  return tokens;
}

/** Resolve either an authored brand or only a legacy preset into one complete v2 object. */
export function resolveBrandTokens({ preset = {}, brand = null } = {}) {
  const fromPreset = tokensFromPreset(preset);
  if (!brand) return fromPreset;
  const authored = brand.schemaVersion === BRAND_SCHEMA ? clone(brand) : upgradeBrandV1(brand);
  if (!authored.modes && authored.contentModes) authored.modes = clone(authored.contentModes);
  if (!authored.contentModes && authored.modes) authored.contentModes = clone(authored.modes);
  const resolved = merge(fromPreset, authored);
  resolved.schemaVersion = BRAND_SCHEMA;
  resolved.colors = derivedColors(resolved.colors);
  return resolved;
}

const cssText = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const fontStack = (role, fallback) => {
  const family = Array.isArray(role?.family) ? role.family : [role?.family || fallback];
  return family.map((name) => /\s/.test(name) ? `"${cssText(name)}"` : cssText(name)).join(", ") + `, ${fallback}`;
};

/** CSS custom properties and local @font-face rules for any HTML-based format. */
export function tokensCSS(tokens) {
  const t = resolveBrandTokens({ brand: tokens });
  const faces = [];
  const seen = new Set();
  for (const roleName of TYPE_ROLES) {
    const role = t.type?.[roleName];
    if (!role?.file) continue;
    const key = `${role.family}|${role.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ext = String(role.file).split(".").pop().toLowerCase();
    const format = ext === "otf" ? "opentype" : ext === "woff2" ? "woff2" : ext === "woff" ? "woff" : "truetype";
    const weights = Array.isArray(role.weights) && role.weights.length ? role.weights : [400];
    const weight = weights.length > 1 ? `${Math.min(...weights)} ${Math.max(...weights)}` : weights[0];
    faces.push(`@font-face { font-family: "${cssText(role.family)}"; src: url("${cssText(role.file)}") format("${format}"); font-weight: ${weight}; font-style: normal; font-display: block; }`);
  }
  const vars = [];
  for (const role of COLOR_ROLES) vars.push(`  --brand-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${t.colors[role]};`);
  for (const roleName of TYPE_ROLES) {
    const role = t.type?.[roleName];
    if (!role) continue;
    vars.push(`  --brand-${roleName}-font: ${fontStack(role, roleName === "editorial" ? "serif" : roleName === "mono" ? "monospace" : "sans-serif")};`);
    vars.push(`  --brand-${roleName}-weight: ${(role.weights || [400])[0]};`);
    vars.push(`  --brand-${roleName}-case: ${role.case === "upper" ? "uppercase" : "none"};`);
    vars.push(`  --brand-${roleName}-tracking: ${role.tracking || 0}em;`);
    vars.push(`  --brand-${roleName}-line-height: ${role.lineHeight || 1.2};`);
  }
  for (const [name, value] of Object.entries(t.typeScale)) vars.push(`  --type-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value}px;`);
  for (const [name, value] of Object.entries(t.spacing)) vars.push(`  --space-${name}: ${value}px;`);
  for (const [name, value] of Object.entries(t.radius)) vars.push(`  --brand-radius-${name}: ${value}px;`);
  vars.push(`  --brand-radius: ${t.radius.md}px;`);
  vars.push(`  --brand-grain: ${t.texture.grain};`);
  vars.push(`  --brand-motion-enter: ${t.motion.enterMs}ms;`);
  vars.push(`  --brand-motion-exit: ${t.motion.exitMs}ms;`);
  return `${faces.join("\n")}\n:root {\n${vars.join("\n")}\n}`.trim();
}

/** Three legacy cover slots, sourced from semantic roles for every non-Greg brand. */
export function coverPalettes(tokens) {
  const t = resolveBrandTokens({ brand: tokens });
  if (String(t.identity?.handle || "").toLowerCase() === "@officialgregpingel") {
    const saved = t.coverPalettes;
    if (saved) return clone(saved);
  }
  const c = t.colors;
  return {
    brand: { name: "surface+accent", bg: c.surface, bg2: c.surface2, accent: c.accent, accent2: mixHex(c.accent, c.paper, 0.24) },
    navy: { name: "paper+ink", bg: c.paper, bg2: mixHex(c.paper, c.ink, 0.1), accent: c.ink, accent2: c.muted },
    red: { name: "accent+surface", bg: c.accent, bg2: mixHex(c.accent, c.surface, 0.18), accent: c.surface, accent2: c.ink },
  };
}
