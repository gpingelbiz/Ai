import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBrandTokens, upgradeBrandV1 } from "./brandtokens.mjs";
import { ensureDir, readJSON, writeJSON, PKG_ROOT } from "./util.mjs";

/**
 * Content Studio: a client's one folder that makes and schedules their posts by itself. Never Greg's own setup (his
 * content engine and reel folders stay as they are); every path, brand file, voice, photo, log and account here is
 * the client's.
 *
 *   Content Studio/
 *     Photos/       (or any folder named in studio.json) the photos posts are made from; each is used once
 *     Raw Reels/    drop a clip: the finished reel schedules itself
 *     Made/         a copy of every post made, for reference
 *     brand/        brand.json, voice.md, brand-guide.md, fonts/ (the client's), my-brand.json + dictionary.json (reels)
 *     studio.json   photo folder, posting slots, Metricool brand, image route, AI label rules
 *     .studio/      the kit's own state: post log, photo ledger, photo checks, work files, logs
 *
 * The real folder sits in the home folder (~/Content Studio) with a shortcut on the Desktop: macOS stops background
 * jobs from reading the Desktop, Documents and Downloads folders.
 */

export const DEFAULT_STUDIO_DIR = path.join(os.homedir(), "Content Studio");
export const studioDir = (dir, env = process.env) => path.resolve(dir || env.REEL_STUDIO || DEFAULT_STUDIO_DIR);

export function studioPaths(dir) {
  const root = studioDir(dir);
  const state = path.join(root, ".studio");
  const brand = path.join(root, "brand");
  return {
    root,
    config: path.join(root, "studio.json"),
    photos: path.join(root, "Photos"),
    rawReels: path.join(root, "Raw Reels"),
    made: path.join(root, "Made"),
    brand,
    brandJson: path.join(brand, "brand.json"),
    voice: path.join(brand, "voice.md"),
    guide: path.join(brand, "brand-guide.md"),
    reelPreset: path.join(brand, "my-brand.json"),
    dictionary: path.join(brand, "dictionary.json"),
    fonts: path.join(brand, "fonts"),
    state,
    posts: path.join(state, "posts.jsonl"),
    used: path.join(state, "used-photos.json"),
    checks: path.join(state, "photo-checks.json"),
    work: path.join(state, "work"),
    reels: path.join(state, "reels"),
    log: path.join(state, "studio.log"),
    lock: path.join(state, "run.lock"),
  };
}

/** Everything studio.json can hold, with the hands-off defaults. */
export const STUDIO_DEFAULTS = {
  client: "",
  timezone: "",
  photos: "Photos",
  slots: [
    { time: "10:00", format: "carousel" },
    { time: "18:00", format: "static" },
  ],
  daysAhead: 3,
  maxPerRun: 4,
  carouselSlides: [5, 8],
  reels: { enabled: true, earliest: 8, latest: 20, fallbackHour: 12, gapHours: 2, look: "auto" },
  metricool: { brand: "", blogId: "", networks: ["instagram"], connector: "" },
  publish: { mode: "schedule" },
  hosting: { route: "tunnel", folder: "" },
  ai: { label: "auto", broll: "auto" },
  sandcastles: false,
  mix: [],
  neverSay: [],
  cta: "",
};

export const FORMATS = ["carousel", "static"];
export const HOSTING_ROUTES = ["tunnel", "drive", "dropbox"];
export const PUBLISH_MODES = ["schedule", "draft", "off"];
export const NETWORKS = ["instagram", "facebook", "linkedin", "threads", "tiktok"];

const merge = (base, over) => {
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (!base || typeof base !== "object" || !over || typeof over !== "object") return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) if (!k.startsWith("_")) out[k] = k in base ? merge(base[k], v) : v;
  return out;
};

export const withDefaults = (config = {}) => merge(structuredClone(STUDIO_DEFAULTS), config || {});

/** "10:00" / "6:30 PM" / 18 -> {h, m}; null when it is not a time of day. */
export function parseTime(value) {
  if (Number.isInteger(value) && value >= 0 && value < 24) return { h: value, m: 0 };
  const m = String(value ?? "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  }
  return h < 24 && min < 60 ? { h, m: min } : null;
}

export const hhmm = ({ h, m }) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

const validZone = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

/** Problems with a studio.json, in words; empty when the daily run can use it. */
export function checkStudio(config, { publishing = true } = {}) {
  const c = withDefaults(config);
  const out = [];
  if (!String(c.client || "").trim()) out.push("client is missing (the client's name)");
  if (c.timezone && !validZone(c.timezone)) out.push(`timezone "${c.timezone}" is not a time zone (like America/Chicago)`);
  if (!Array.isArray(c.slots)) out.push("slots must be a list like [{\"time\":\"10:00\",\"format\":\"carousel\"}]");
  else c.slots.forEach((s, i) => {
    if (!parseTime(s?.time)) out.push(`slots[${i}].time "${s?.time}" is not a time of day (like 10:00 or 6:00 PM)`);
    if (!FORMATS.includes(s?.format)) out.push(`slots[${i}].format is "carousel" or "static"`);
  });
  const times = (c.slots || []).map((s) => parseTime(s?.time)).filter(Boolean).map((t) => t.h * 60 + t.m).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] < 120) out.push("two posting slots are less than 2 hours apart");
  if (!(Number(c.daysAhead) >= 0 && Number(c.daysAhead) <= 14)) out.push("daysAhead is a number of days, 0 (today only) to 14");
  const [lo, hi] = c.carouselSlides || [];
  if (!(lo >= 3 && hi <= 10 && lo <= hi)) out.push("carouselSlides is [least, most] between 3 and 10, like [5, 8]");
  if (!HOSTING_ROUTES.includes(c.hosting?.route)) out.push(`hosting.route is ${HOSTING_ROUTES.join(", ")}`);
  if (c.hosting?.route !== "tunnel" && !String(c.hosting?.folder || "").trim()) out.push(`hosting.folder: the ${c.hosting.route === "drive" ? "Google Drive" : "Dropbox"} folder the images go to`);
  if (!PUBLISH_MODES.includes(c.publish?.mode)) out.push(`publish.mode is ${PUBLISH_MODES.join(", ")}`);
  if (publishing && c.publish?.mode !== "off" && !String(c.metricool?.blogId || "").trim()) out.push("metricool.blogId is missing (run the installer again to pick the Metricool brand)");
  const nets = c.metricool?.networks || [];
  if (!nets.length || nets.some((n) => !NETWORKS.includes(n))) out.push(`metricool.networks lists where posts go: ${NETWORKS.join(", ")}`);
  if (!["auto", "always"].includes(c.ai?.label)) out.push('ai.label is "auto" (labelled when a picture is AI-made) or "always"; AI pictures are always labelled');
  if (![true, false, "auto"].includes(c.ai?.broll)) out.push('ai.broll is true, false or "auto" (AI pictures only when Codex is set up)');
  return out;
}

/** The Mac's own time zone, for a studio.json that names none. */
export const macZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

/** The photo folder studio.json names: relative to the studio, or an absolute path, "~" for home. */
export function photosDir(config, paths) {
  const p = String(config.photos || "Photos").replace(/^~(?=\/|$)/, os.homedir());
  return path.isAbsolute(p) ? p : path.join(paths.root, p);
}

/** Open-licensed fonts the editor ships (assets/fonts), used when a brand names one of them and brings no file. */
export const BUNDLED_FONTS = Object.fromEntries([
  ["anton", "Anton-Regular.ttf"], ["inter", "Inter.ttf"], ["dm serif display", "DMSerifDisplay-Regular.ttf"],
  ["courier prime", "CourierPrime-Regular.ttf"], ["permanent marker", "PermanentMarker-Regular.ttf"],
].map(([family, file]) => [family, path.join(PKG_ROOT, "assets", "fonts", file)]));

/**
 * The client's brand for slides: brand/brand.json (the kit template's shape or schema v2), with font files from
 * brand/fonts (Display.ttf / Body.ttf, as the brand kit fetches them) when the file names a family only.
 */
export function studioBrand(paths) {
  const raw = readJSON(paths.brandJson);
  const tokens = resolveBrandTokens({ brand: raw.schemaVersion === 2 ? raw : upgradeBrandV1(raw) });
  for (const [role, file] of [["display", "Display"], ["body", "Body"]]) {
    const spec = tokens.type?.[role];
    if (!spec) continue;
    const given = spec.file && (path.isAbsolute(spec.file) ? spec.file : path.join(paths.brand, spec.file));
    if (given && fs.existsSync(given)) { spec.file = given; continue; }
    const found = ["ttf", "otf"].map((ext) => path.join(paths.fonts, `${file}.${ext}`)).find((f) => fs.existsSync(f)) || BUNDLED_FONTS[String(spec.family || "").toLowerCase()];
    if (found) spec.file = found;
    else if (spec.file && !path.isAbsolute(spec.file)) spec.file = null;
  }
  const logo = tokens.identity?.logo;
  if (typeof logo === "string" && logo && !path.isAbsolute(logo)) tokens.identity.logo = fs.existsSync(path.join(paths.brand, logo)) ? path.join(paths.brand, logo) : null;
  return { raw, tokens };
}

const readText = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };

/** studio.json, the brand, the voice and the brand guide, ready for a run. Throws with every problem in words. */
export function loadStudio(dir, { publishing = true } = {}) {
  const paths = studioPaths(dir);
  if (!fs.existsSync(paths.config)) throw new Error(`no studio.json in ${paths.root} (run the Content Studio installer)`);
  const config = withDefaults(readJSON(paths.config));
  if (!config.timezone) config.timezone = macZone();
  const problems = checkStudio(config, { publishing });
  if (!fs.existsSync(paths.brandJson)) problems.push(`brand/brand.json is missing in ${paths.root}`);
  if (problems.length) throw new Error(`studio.json needs fixing:\n- ${problems.join("\n- ")}`);
  const brand = studioBrand(paths);
  for (const d of [paths.state, paths.made, paths.rawReels]) ensureDir(d);
  return { paths, config, brand: brand.raw, tokens: brand.tokens, voice: readText(paths.voice), guide: readText(paths.guide), photos: photosDir(config, paths) };
}

/* ---------- the post log: .studio/posts.jsonl, append-only, the latest line per id wins ---------- */

export function readPosts(paths) {
  const text = readText(paths.posts);
  const byId = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { const p = JSON.parse(line); if (p.id) byId.set(p.id, { ...(byId.get(p.id) || {}), ...p }); } catch {}
  }
  return [...byId.values()];
}

export function logPost(paths, record) {
  ensureDir(path.dirname(paths.posts));
  fs.appendFileSync(paths.posts, JSON.stringify({ ...record, logged: new Date().toISOString() }) + "\n");
  return record;
}

/** One line in .studio/studio.log, with the time. */
export function studioLog(paths, line) {
  try { ensureDir(paths.state); fs.appendFileSync(paths.log, `${new Date().toISOString().slice(0, 19).replace("T", " ")} ${line}\n`); } catch {}
}

/**
 * A run lock: the daily job and the Raw Reels watcher share one Claude login and one image link, so they never run
 * at the same time. A lock older than 3 hours is a crashed run and is taken over. Returns a release function, or
 * null when another run holds it.
 */
export function takeLock(paths, name = "run") {
  ensureDir(paths.state);
  const lock = paths.lock;
  try {
    fs.mkdirSync(lock);
  } catch {
    let age = 0;
    try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch {}
    if (age < 3 * 3600000) return null;
    fs.rmSync(lock, { recursive: true, force: true });
    try { fs.mkdirSync(lock); } catch { return null; }
  }
  fs.writeFileSync(path.join(lock, "who"), `${name} ${process.pid}\n`);
  return () => fs.rmSync(lock, { recursive: true, force: true });
}

/** A new studio folder: the subfolders, studio.json (kept when present) and the brand files copied from `brandFrom`. */
export function initStudio(dir, { config = {}, brandFrom = null } = {}) {
  const paths = studioPaths(dir);
  for (const d of [paths.root, paths.rawReels, paths.made, paths.brand, paths.state]) ensureDir(d);
  if (brandFrom) {
    for (const f of ["brand.json", "voice.md", "brand-guide.md", "my-brand.json", "my-youtube.json", "dictionary.json"]) {
      const src = path.join(brandFrom, f);
      // The voice, guide and word list are the client's to edit: a re-run keeps their edited copies.
      const keep = ["voice.md", "brand-guide.md", "dictionary.json"].includes(f) && fs.existsSync(path.join(paths.brand, f));
      if (fs.existsSync(src) && !keep) fs.copyFileSync(src, path.join(paths.brand, f));
    }
    const fonts = path.join(brandFrom, "fonts");
    if (fs.existsSync(fonts)) {
      ensureDir(paths.fonts);
      for (const f of fs.readdirSync(fonts)) fs.copyFileSync(path.join(fonts, f), path.join(paths.fonts, f));
    }
  }
  const existing = fs.existsSync(paths.config) ? readJSON(paths.config) : {};
  const next = merge(merge(structuredClone(STUDIO_DEFAULTS), existing), config);
  writeJSON(paths.config, { _how: "Content Studio settings. Edit and save; the next run uses them. Times are in timezone. Re-run the installer to change the Metricool brand or the image route.", ...next });
  if (photosDir(next, paths) === paths.photos) ensureDir(paths.photos);
  return paths;
}
