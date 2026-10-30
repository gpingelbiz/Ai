import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { run, PKG_ROOT, ensureDir, writeJSON, readJSON } from "./util.mjs";

/**
 * The Content Studio photo pool: every photo in the client's photo folder, checked once with the face finder
 * (scripts/faces.swift --photo), the bad shots skipped with a reason, and a ledger so a photo that went on a post is
 * never offered again, in any crop, even after it is renamed or moved (the ledger keys on the file's content).
 */

export const IMAGE = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i;

/** Every image under `dir` (subfolders too; hidden files and folders skipped), oldest first by name. */
export function listPhotos(dir) {
  const out = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (IMAGE.test(e.name)) {
        try { const st = fs.statSync(full); out.push({ file: full, rel: path.relative(dir, full), size: st.size, mtimeMs: Math.round(st.mtimeMs) }); } catch {}
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
}

/** A content key: the size plus a hash of the first 256 KB, so a renamed or moved photo is still the same photo. */
export function photoKey(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(262144);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const size = fs.fstatSync(fd).size;
    return `p-${crypto.createHash("sha1").update(buf.subarray(0, n)).update(String(size)).digest("hex").slice(0, 16)}`;
  } finally {
    fs.closeSync(fd);
  }
}

/* ---------- the Swift helpers ---------- */

const cacheDir = () => process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor");

/** Compile scripts/<name>.swift once into the cache (recompiled when the source changes). Null off macOS. */
export async function swiftTool(name) {
  const src = path.join(PKG_ROOT, "scripts", `${name}.swift`);
  if (process.platform !== "darwin" || !fs.existsSync(src)) return null;
  const bin = path.join(ensureDir(cacheDir()), `${name}-${Math.round(fs.statSync(src).mtimeMs)}`);
  if (!fs.existsSync(bin)) {
    try { await run("swiftc", ["-O", src, "-o", bin], { capture: true }); } catch { return null; }
  }
  return bin;
}

/** Face finder reports for these files, 20 at a time. */
export async function detectPhotos(files) {
  const bin = await swiftTool("faces");
  if (!bin) throw new Error("the face finder needs a Mac with Swift (xcode-select --install)");
  const out = [];
  for (let i = 0; i < files.length; i += 20) {
    const { out: text } = await run(bin, ["--photo", ...files.slice(i, i + 20)], { capture: true });
    for (const line of text.split("\n")) if (line.trim()) { try { out.push(JSON.parse(line)); } catch {} }
  }
  return out;
}

/* ---------- bad shots ---------- */

// Calibrated 2026-10-30 on phone-style photos: good shots read light 0.38-0.54, sharp 0.011-0.038 and face quality
// 0.42-0.68; the same shots darkened read light 0.12, washed out 0.91 (face 0.24), blurred sharp 0.0001 (face 0.19).
export const PHOTO_RULES = {
  minShortSide: 1000, // Instagram shows 1080 wide; anything smaller looks soft
  minLight: 0.16, // mean luminance: too dark to read
  maxLight: 0.88, // blown out
  minSharp: 0.0012, // Laplacian variance on a 256 px grey copy: under this the whole frame is soft
  minFaceQuality: 0.35, // Vision's face capture quality: blur, closed eyes, a face turned away
  qualityFaceMin: 0.08, // ...judged only on a face at least this tall: a wide shot's small face always scores low
  edge: 0.01, // a face box touching the frame edge is cut off
};

/** Why a photo is not fit to post, or "" when it is. */
export function badShot(report, rules = PHOTO_RULES) {
  if (!report || report.error) return report?.error || "could not be read";
  const short = Math.min(report.width || 0, report.height || 0);
  if (short < rules.minShortSide) return `too small (${report.width}x${report.height})`;
  if (report.screenshot) return "a screenshot";
  // A phone screenshot has no camera and a phone screen's shape.
  if (!report.camera && /\.png$/i.test(report.file || "") && Math.max(report.width, report.height) / short > 2) return "looks like a screenshot";
  if (report.light < rules.minLight) return "too dark";
  if (report.light > rules.maxLight) return "washed out";
  if (report.sharp < rules.minSharp) return "blurry";
  const faces = [...(report.faces || [])].sort((a, b) => b.w * b.h - a.w * a.h);
  const main = faces[0];
  if (main) {
    if (Number.isFinite(main.quality) && main.h >= rules.qualityFaceMin && main.quality < rules.minFaceQuality) return "the face is blurry, turned away or mid-blink";
    const e = rules.edge;
    if (main.x < e || main.y < e || main.x + main.w > 1 - e || main.y + main.h > 1 - e) return "the face is cut off at the edge";
  }
  return "";
}

/** How good a photo is for a post: a clear main face counts most, then sharpness and light. */
export function photoScore(report) {
  const faces = [...(report.faces || [])].sort((a, b) => b.w * b.h - a.w * a.h);
  const main = faces[0];
  const face = main ? 1 + (Number.isFinite(main.quality) ? main.quality : 0.5) + Math.min(1, main.h / 0.25) : 0;
  const sharp = Math.min(1, (report.sharp || 0) / 0.01);
  const light = Math.max(0, 1 - Math.abs((report.light ?? 0.5) - 0.5) * 2);
  return Math.round((face * 2 + sharp + light) * 1000) / 1000;
}

/** EXIF "2026:10:12 09:14:03" -> ms, or null. */
export function takenMs(taken) {
  const m = String(taken || "").match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

/** Photos taken within `minutes` of each other are one moment (a burst, one sitting): never two on one post. */
export function momentOf(report, minutes = 10) {
  const t = takenMs(report.taken);
  return t == null ? `file:${report.key || report.file}` : `t:${Math.floor(t / (minutes * 60000))}`;
}

/* ---------- the ledger ---------- */

export function readLedger(file) {
  try { return readJSON(file); } catch { return {}; }
}

/** Record photos as spent: {key: {file, post, date, moment}}. A spent photo is never offered again. */
export function markUsed(file, photos, { post, date }) {
  const ledger = readLedger(file);
  for (const p of photos) ledger[p.key] = { file: p.file, post, date, moment: p.moment || null };
  writeJSON(file, ledger);
  return ledger;
}

/* ---------- the pool ---------- */

/**
 * Every photo in `dir` with its check, from the cache when the file has not changed (`.studio/photo-checks.json`).
 * Returns {all, usable, used, skipped}: usable = fit to post and never used, best first.
 */
export async function photoPool(dir, { checksFile, ledgerFile, detect = detectPhotos, rules = PHOTO_RULES } = {}) {
  const files = listPhotos(dir);
  const cache = checksFile ? readLedger(checksFile) : {};
  const fresh = files.filter((f) => { const c = cache[f.file]; return !c || c.size !== f.size || c.mtimeMs !== f.mtimeMs; });
  if (fresh.length) {
    const reports = await detect(fresh.map((f) => f.file));
    const byFile = new Map(reports.map((r) => [r.file, r]));
    for (const f of fresh) {
      let key = null;
      try { key = photoKey(f.file); } catch {}
      cache[f.file] = { size: f.size, mtimeMs: f.mtimeMs, key, report: byFile.get(f.file) || { file: f.file, error: "the face finder skipped it" } };
    }
  }
  // Forget files that are gone, so the cache does not grow forever.
  const live = new Set(files.map((f) => f.file));
  for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k];
  if (checksFile && fresh.length) writeJSON(checksFile, cache);
  const ledger = ledgerFile ? readLedger(ledgerFile) : {};
  const all = files.map((f) => {
    const c = cache[f.file];
    const report = { ...(c?.report || {}), file: f.file, key: c?.key };
    return { ...report, rel: f.rel, key: c?.key, moment: momentOf({ ...report, key: c?.key }), score: photoScore(report), why: badShot(report, rules), used: !!(c?.key && ledger[c.key]) };
  });
  const usedMoments = new Set(Object.values(ledger).map((u) => u.moment).filter((m) => m && m.startsWith("t:")));
  const usable = all.filter((p) => !p.why && !p.used && p.key).sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  // A moment already on an earlier post comes last: same day, same outfit, same place.
  usable.sort((a, b) => (usedMoments.has(a.moment) ? 1 : 0) - (usedMoments.has(b.moment) ? 1 : 0));
  return { all, usable, used: all.filter((p) => p.used), skipped: all.filter((p) => p.why && !p.used) };
}

/**
 * Pick `n` photos for one post: never two from the same moment, the best face first (it goes on the cover).
 * Returns fewer when the pool runs short; the post then uses fewer photo slides, never a repeat.
 */
export function pickPhotos(usable, n, { avoid = [] } = {}) {
  const taken = new Set(avoid);
  const out = [];
  for (const p of usable) {
    if (out.length >= n) break;
    if (taken.has(p.moment) || taken.has(p.key)) continue;
    out.push(p);
    taken.add(p.moment);
  }
  return out;
}

/** An upright JPEG copy for the render (HEIC and rotated phone photos come out the way they look). */
export async function exportPhoto(src, out, maxPx = 2160) {
  const bin = await swiftTool("photosheet");
  if (!bin) { fs.copyFileSync(src, out); return out; }
  ensureDir(path.dirname(out));
  await run(bin, ["export", src, out, String(maxPx)], { capture: true });
  return out;
}

/** A numbered contact sheet of these photos (1 = the first), for Claude or a person to look at. */
export async function contactSheet(files, out) {
  const bin = await swiftTool("photosheet");
  if (!bin) throw new Error("contact sheets need a Mac with Swift");
  ensureDir(path.dirname(out));
  await run(bin, ["sheet", out, ...files], { capture: true });
  return out;
}

/** One line per reason: "3 too dark, 1 blurry". */
export function skipSummary(skipped) {
  const counts = {};
  for (const p of skipped) counts[p.why] = (counts[p.why] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${n} ${why}`).join(", ");
}
