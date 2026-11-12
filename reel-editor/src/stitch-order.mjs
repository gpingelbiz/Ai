import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { run, writeJSON } from "./util.mjs";

export const stitchVideo = (name) => /\.(mov|mp4|m4v)$/i.test(name);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Metadata preference is deliberate: copying a phone export can change its filesystem dates. */
export function filmingTime(raw, birthMs) {
  const tags = [raw.format?.tags || {}, ...(raw.streams || []).map((s) => s.tags || {})];
  for (const key of ["creation_time", "com.apple.quicktime.creationdate"]) {
    for (const row of tags) {
      const time = Date.parse(row[key]);
      if (Number.isFinite(time)) return time;
    }
  }
  return birthMs;
}

/** Inodes track renames, while the render marker separately tracks content changes. */
export function reconcileOrder(previous, observed, now = Date.now()) {
  const byId = new Map(observed.map((c) => [c.id, c]));
  const old = (previous?.clips || []).filter((c) => byId.has(c.id));
  const known = new Set(old.map((c) => c.id));
  const added = observed.filter((c) => !known.has(c.id)).sort((a, b) => a.filmed - b.filmed || compare(a.name, b.name) || compare(a.id, b.id));
  let clips = [...old.map((c) => ({ ...byId.get(c.id), firstSeen: c.firstSeen })), ...added.map((c) => ({ ...c, firstSeen: now }))];
  if (clips.length && clips.every((c) => /^\d+/.test(c.name))) {
    clips = clips.sort((a, b) => Number(a.name.match(/^\d+/)[0]) - Number(b.name.match(/^\d+/)[0]) || compare(a.name, b.name) || compare(a.id, b.id));
  }
  const changed = added.length || old.some((c) => c.size !== byId.get(c.id).size || c.mtimeMs !== byId.get(c.id).mtimeMs);
  return { schemaVersion: 1, lastArrival: changed ? now : previous?.lastArrival ?? now, clips };
}

export function orderSignature(clips) {
  return crypto.createHash("sha256").update(JSON.stringify(clips.map((c) => [c.id, c.key]))).digest("hex");
}

export function clipFiles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).filter((d) => d.isFile() && stitchVideo(d.name)).map((d) => path.join(folder, d.name));
}

export async function readFilmingTime(file, birthMs, execute = run) {
  try {
    const { out } = await execute("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { capture: true });
    return filmingTime(JSON.parse(out), birthMs);
  } catch { return birthMs; }
}

export async function recordOrder(folder, { now = Date.now(), creationTime = readFilmingTime } = {}) {
  const ledger = path.join(folder, ".stitch-order.json");
  let previous = null;
  if (fs.existsSync(ledger)) previous = JSON.parse(fs.readFileSync(ledger, "utf8"));
  const observed = [];
  for (const file of clipFiles(folder)) {
    const st = fs.statSync(file), id = `${st.dev}:${st.ino}:${st.birthtimeMs}`;
    const saved = previous?.clips?.find((c) => c.id === id && c.size === st.size && c.mtimeMs === st.mtimeMs);
    observed.push({ id, name: path.basename(file), size: st.size, mtimeMs: st.mtimeMs, filmed: saved?.filmed ?? await creationTime(file, st.birthtimeMs || st.mtimeMs), ...(saved?.key ? { key: saved.key } : {}) });
  }
  const next = reconcileOrder(previous, observed, now);
  if (JSON.stringify(previous) !== JSON.stringify(next)) writeJSON(ledger, next);
  return next;
}

/** An explicit order must list every input exactly once. Relative paths are relative to the order file. */
export function explicitOrder(files, names, folder) {
  if (!Array.isArray(names) || names.some((n) => typeof n !== "string")) throw new Error("The order file must be an array of clip paths.");
  const ordered = names.map((n) => path.resolve(folder, n));
  if (ordered.length !== files.length || new Set(ordered).size !== files.length || ordered.some((f) => !files.includes(f))) throw new Error("The order file must list every clip exactly once.");
  return ordered;
}
