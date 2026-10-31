import fs from "node:fs";
import path from "node:path";
import { slug, writeJSON, readJSON, VIDEO_EXTS, warn } from "./util.mjs";
import { identityLeaks } from "./speaker-guard.mjs";

export const SOURCE_KINDS = ["stage", "podcast", "webinar", "interview", "testimonial", "broll", "photo"];
export const PROOF_KINDS = ["testimonial-video", "quote", "logo", "press", "book", "number", "award"];
export const LOGO_RELATIONSHIPS = ["spoke-at", "client", "featured-in", "available-at"];
const AUDIO = new Set([".mp3", ".m4a", ".wav", ".aac", ".aif", ".aiff", ".flac", ".ogg"]);
const IMAGES = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".tif", ".tiff", ".avif"]);

/** Deliberately checks values, including nested card text; object keys are not rendered. */
export function assertNoGreg(obj, label = "speaker") {
  const leak = identityLeaks(obj, label)[0];
  if (leak) throw new Error(`${leak}: speaker brand safety rejected a string containing Greg's identity`);
  return obj;
}

/** Relative assets (including symlinks) must stay inside the intake root. Absolute paths are explicit opt-ins. */
export function assetPath(folder, file) {
  if (typeof file !== "string" || !file.trim()) throw new Error("file path is missing");
  const root = fs.realpathSync(folder);
  const resolved = path.resolve(root, file);
  if (!path.isAbsolute(file)) {
    const rel = path.relative(root, resolved);
    if (rel === ".." || rel.startsWith(`..${path.sep}`)) throw new Error(`relative path escapes the client folder: ${file}`);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`file not found: ${file}`);
  if (!path.isAbsolute(file)) {
    const rel = path.relative(root, fs.realpathSync(resolved));
    if (rel === ".." || rel.startsWith(`..${path.sep}`)) throw new Error(`symlink escapes the client folder: ${file}`);
  }
  return resolved;
}

/** A headshot is a supplied identity photo. Missing clearance is visible in drafts and blocks finals. */
export function headshotProblems(folder, manifest, { final = false, checkFile = true } = {}) {
  const identity = manifest?.identity || {}, problems = [];
  const add = (message, level = "error") => problems.push({ level, id: "identity.headshot", message: `identity.headshot: ${message}` });
  if (identity.headshot == null) {
    if (identity.headshotRights != null) add("headshotRights requires a headshot");
    return problems;
  }
  if (typeof identity.headshot !== "string" || !identity.headshot.trim()) { add("photo path must be a non-empty string"); return problems; }
  const ext = path.extname(identity.headshot).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".heic", ".webp"].includes(ext)) add("photo must be jpg, jpeg, png, heic or webp");
  else if (checkFile) {
    try {
      if (!folder && !path.isAbsolute(identity.headshot)) throw new Error("clientDir is required for a relative headshot");
      const source = assetPath(folder || path.dirname(identity.headshot), identity.headshot);
      const header = Buffer.alloc(32), fd = fs.openSync(source, "r");
      let n;
      try { n = fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
      const bytes = header.subarray(0, n);
      const matches = ext === ".png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : [".jpg", ".jpeg"].includes(ext) ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : ext === ".webp" ? bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
        : bytes.toString("ascii", 4, 8) === "ftyp" && /heic|heix|hevc|hevx|mif1|msf1/.test(bytes.toString("ascii", 8));
      if (!matches) add(`file is not a ${ext.slice(1)} image: ${identity.headshot}`);
    } catch (error) { add(error.message); }
  }
  if (identity.headshotRights != null && (typeof identity.headshotRights !== "string" || !identity.headshotRights.trim())) add("headshotRights must be a non-empty rights id");
  const right = (Array.isArray(manifest.rights) ? manifest.rights : []).find((r) => r?.id === identity.headshotRights);
  if (right?.status !== "approved") add(`rights ${identity.headshotRights || "(missing)"} are ${right?.status || "unknown"}; ${final ? "approved rights required" : "draft use only"}`, final ? "error" : "warn");
  return problems;
}

export function validateManifest(folder, manifest) {
  const problems = [];
  const add = (id, message, level = "error") => problems.push({ level, id, message });
  const m = manifest;
  if (!m || typeof m !== "object" || Array.isArray(m)) return [{ level: "error", id: "manifest", message: "manifest must be an object" }];
  if (m.schemaVersion !== 1) add("manifest", "schemaVersion must be 1");
  if (!String(m.clientId || "").trim()) add("manifest", "clientId is missing");
  if (!String(m.identity?.name || "").trim()) add("identity", "name is missing");
  if (m.identity?.bookingMode != null && !["direct", "bureau"].includes(m.identity.bookingMode)) add("identity", "bookingMode must be direct or bureau");
  problems.push(...headshotProblems(folder, m));
  if (!m.brand?.file) add("brand", "brand.file is missing");
  const collections = {};
  for (const key of ["sources", "proof", "rights", "music"]) {
    if (m[key] != null && !Array.isArray(m[key])) add(key, `${key} must be an array`);
    if (["sources", "rights"].includes(key) && !Array.isArray(m[key])) add(key, `${key} is required`);
    collections[key] = Array.isArray(m[key]) ? m[key].filter((x) => x && typeof x === "object") : [];
    if (Array.isArray(m[key]) && collections[key].length !== m[key].length) add(key, "entries must be objects");
    if (key === "music") continue;
    const ids = new Set();
    for (const item of collections[key]) {
      if (typeof item.id !== "string" || !item.id.trim()) add(key, "entry id is missing");
      else if (ids.has(item.id)) add(item.id, `duplicate ${key} id`);
      ids.add(item.id);
    }
  }
  const rights = new Map(collections.rights.map((x) => [x.id, x]));
  const sources = new Set(collections.sources.map((x) => x.id));
  const file = (id, value) => { try { assetPath(folder, value); } catch (e) { add(id, e.message); } };
  const permission = (item) => {
    const r = rights.get(item.rights);
    if (!r) add(item.id, `rights id does not resolve: ${item.rights || "(missing)"}`);
    else if (r.status !== "approved") add(item.id, `rights ${r.id} are ${r.status}; draft use only`, "warn");
  };
  for (const r of collections.rights) if (!["approved", "pending", "unknown"].includes(r.status)) add(r.id, "rights.status must be approved, pending or unknown");
  for (const s of collections.sources) {
    if (!SOURCE_KINDS.includes(s.kind)) add(s.id, `invalid source.kind: ${s.kind}`);
    if (!["ok", "none", "bad"].includes(s.audio)) add(s.id, `invalid source.audio: ${s.audio}`);
    if (s.audioStream != null && (!Number.isInteger(s.audioStream) || s.audioStream < 0)) add(s.id, "audioStream must be an ffprobe stream index");
    file(s.id, s.path);
    permission(s);
  }
  for (const p of collections.proof) {
    if (!PROOF_KINDS.includes(p.kind)) add(p.id, `invalid proof.kind: ${p.kind}`);
    if (p.sourceId != null && !sources.has(p.sourceId)) add(p.id, `unknown proof sourceId: ${p.sourceId}`);
    if (p.kind === "testimonial-video" && !p.sourceId) add(p.id, "testimonial-video needs sourceId");
    if (p.kind === "logo" && !LOGO_RELATIONSHIPS.includes(p.relationship)) add(p.id, `invalid logo relationship: ${p.relationship}`);
    if (p.file != null || ["logo", "book", "press"].includes(p.kind)) file(p.id, p.file);
    if (p.in != null && (!Number.isFinite(p.in) || p.in < 0)) add(p.id, "proof.in must be non-negative seconds");
    if (p.out != null && (!Number.isFinite(p.out) || p.out <= (p.in ?? 0))) add(p.id, "proof.out must be after proof.in");
    permission(p);
  }
  for (const [i, track] of collections.music.entries()) {
    try { assetPath(folder, track.file); } catch (e) { add(`music-${i}`, e.message, "warn"); }
    if (!String(track.license || "").trim()) add(`music-${i}`, "music licence is missing; draft music will be skipped", "warn");
  }
  return problems;
}

/** Malformed input is reported using the same shape as other validation errors. */
export function loadManifest(folder) {
  let manifest;
  try { manifest = readJSON(path.join(folder, "speaker-manifest.json")); }
  catch (e) { return { manifest: null, problems: [{ level: "error", id: "manifest", message: `cannot read speaker-manifest.json: ${e.message}` }] }; }
  return { manifest, problems: validateManifest(folder, manifest) };
}

function mediaFiles(folder) {
  const files = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if ((entry.isFile() || entry.isSymbolicLink()) && (VIDEO_EXTS.has(path.extname(file).toLowerCase()) || AUDIO.has(path.extname(file).toLowerCase()) || IMAGES.has(path.extname(file).toLowerCase()))) {
        try { assetPath(folder, path.relative(folder, file)); }
        catch (e) { warn(`speaker init: skipped ${path.relative(folder, file)} (${e.message})`); continue; }
        files.push(path.relative(folder, file));
      }
    }
  };
  visit(path.join(folder, "footage"));
  visit(path.join(folder, "proof"));
  return files;
}

/** Returns a new manifest and an added-file count; never edits existing entries or writes to disk. */
export function addNewFiles(folder, manifest, { markNew = true } = {}) {
  folder = path.resolve(folder);
  const next = structuredClone(manifest);
  for (const key of ["sources", "proof", "rights"]) next[key] ??= [];
  const known = new Set([...next.sources.map((x) => x.path), ...next.proof.map((x) => x.file)].filter(Boolean).map((x) => path.resolve(folder, x)));
  const ids = new Set([...next.sources, ...next.proof, ...next.rights].map((x) => x.id));
  const unique = (base) => { let id = base, n = 2; while (ids.has(id)) id = `${base}-${n++}`; ids.add(id); return id; };
  let added = 0;
  for (const file of mediaFiles(folder)) {
    if (known.has(path.resolve(folder, file))) continue;
    const base = slug(path.basename(file, path.extname(file)));
    const image = IMAGES.has(path.extname(file).toLowerCase());
    const proof = file.startsWith(`proof${path.sep}`);
    const id = unique(base), rights = unique(`r-${id}`), flag = markNew ? { new: true } : {};
    next.rights.push({ id: rights, status: "unknown", note: "", evidence: "" });
    if (image && proof) {
      const kind = /logo/i.test(file) ? "logo" : /book|cover/i.test(file) ? "book" : "press";
      next.proof.push({ id, kind, file, ...(kind === "logo" ? { relationship: "spoke-at" } : {}), rights, ...flag });
    } else {
      const kind = image ? "photo" : proof || /testimonial/i.test(file) ? "testimonial" : /broll|b-roll|reaction/i.test(file) ? "broll" : /podcast/i.test(file) || AUDIO.has(path.extname(file).toLowerCase()) ? "podcast" : /webinar|zoom/i.test(file) ? "webinar" : /interview/i.test(file) ? "interview" : "stage";
      next.sources.push({ id, path: file, kind, event: "", date: "", audio: image ? "none" : "ok", rights, ...flag });
      if (kind === "testimonial") next.proof.push({ id: unique(`${id}-proof`), kind: "testimonial-video", sourceId: id, in: 0, out: null, attribution: { name: "", title: "", org: "" }, relationship: "attendee", text: "", rights, ...flag });
    }
    known.add(path.resolve(folder, file));
    added++;
  }
  return { manifest: next, added };
}

export function initManifest(folder, { addNew = false } = {}) {
  folder = path.resolve(folder);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "speaker-manifest.json");
  if (fs.existsSync(file) && !addNew) throw new Error(`manifest already exists: ${file}; use --add-new to append files`);
  if (addNew && !fs.existsSync(file)) throw new Error(`manifest not found: ${file}; run init first`);
  const starter = addNew ? readJSON(file) : {
    schemaVersion: 1, clientId: slug(path.basename(folder)),
    identity: { name: "", roleLine: "", tagline: "", bookingMode: "direct", bookingUrl: "", bookingText: "", email: "", phone: "", bureau: null },
    brand: { file: "brand.json" }, brief: { buyer: "event planners", audience: "", topics: [] }, sources: [], proof: [], rights: [], music: [],
  };
  const result = addNewFiles(folder, starter, { markNew: addNew });
  if (addNew) writeJSON(file, result.manifest);
  else fs.writeFileSync(file, JSON.stringify(result.manifest, null, 2) + "\n", { flag: "wx" });
  return { ...result, file };
}
