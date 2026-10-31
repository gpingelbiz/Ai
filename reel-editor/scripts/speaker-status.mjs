#!/usr/bin/env node
// Status comes from the speaker contract, never from daily reel or publishing state.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { speakerConfig, speakerClients, safeName } from "./speaker-client.mjs";

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw new Error(`Cannot read ${f}: ${e.message}`); } };
const files = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(".json")).map((d) => path.join(dir, d.name)).sort() : [];
export function contractRows(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return value ? [value] : [];
}
export function versionRecord(value, version) {
  if (!value) return null;
  if (Array.isArray(value)) return value.find((v) => v.version === version) || null;
  if (value.versions) return Array.isArray(value.versions) ? value.versions.find((v) => v.version === version) || null : value.versions[version] || null;
  return value.version === version ? value : null;
}
export function planState(plan, resolved, review, final) {
  if (!resolved) return "not yet drafted";
  if (resolved.revision != null && plan.revision != null && resolved.revision !== plan.revision) return `revision ${plan.revision} awaiting draft`;
  const current = (r) => r && (r.revision == null || plan.revision == null || r.revision === plan.revision);
  if (current(final) && (final.status === "delivered" || final.state === "delivered" || final.files?.length || final.deliveredAt)) return "delivered";
  if (current(review)) {
    const state = review.status || review.state;
    if (state === "approved" || review.approved === true) return "approved (deliver the approved file)";
    if (["revision", "changes-requested", "changes_requested", "revision-requested"].includes(state)) return "revision requested";
  }
  return `draft${plan.revision ? `, revision ${plan.revision}` : ""}`;
}
export function speakerStatus(folder) {
  const manifest = read(path.join(folder, "speaker-manifest.json")) || {};
  const sources = manifest.sources || [], proof = manifest.proof || [];
  const index = new Map();
  for (const file of files(path.join(folder, "work/index"))) {
    const value = read(file);
    if (value?.sources && !Array.isArray(value.sources)) {
      for (const [id, row] of Object.entries(value.sources)) index.set(id, { ...index.get(id), ...row, id });
      continue;
    }
    for (const row of contractRows(value, ["sources", "entries", "index"])) {
      const id = row.sourceId || row.id || path.basename(file, ".json");
      index.set(id, { ...index.get(id), ...row });
    }
  }
  const canonicalSources = read(path.join(folder, "work/index/sources.json"))?.sources;
  const indexedRows = canonicalSources && !Array.isArray(canonicalSources) ? Object.values(canonicalSources) : [...index.values()];
  const rows = indexedRows.filter((r) => r.sourceId || r.id || r.duration != null || r.probe);
  const duration = rows.reduce((n, r) => n + (Number(r.duration ?? r.durationSeconds ?? r.probe?.duration ?? r.media?.duration) || 0), 0);
  const transcribed = rows.filter((r) => Array.isArray(r.words) || Array.isArray(r.transcript?.words) || Array.isArray(r.transcription?.words) || r.transcribed === true || ["done", "complete", "completed", "cached"].includes(r.transcription?.status) || r.transcriptFile || r.wordsFile).length;
  const rights = new Map((manifest.rights || []).map((r) => [r.id, r]));
  const waiting = [...sources.map((s) => ({ ...s, label: s.path || s.id })), ...proof.map((p) => ({ ...p, label: p.attribution?.name || p.file || p.id }))]
    .filter((item) => rights.get(item.rights)?.status !== "approved").map((item) => `${item.label} (${rights.get(item.rights)?.status || "unknown"})`);
  // Also surface permission records still waiting even before an operator attaches an asset.
  for (const r of rights.values()) if (r.status !== "approved" && ![...sources, ...proof].some((s) => s.rights === r.id)) waiting.push(`${r.id} (${r.status || "unknown"})`);
  const candidates = contractRows(read(path.join(folder, "work/candidates/all.json")), ["candidates", "items"]).length;
  const review = read(path.join(folder, "review/review.json")), delivered = read(path.join(folder, "final/manifest.json"));
  const plans = files(path.join(folder, "work/plans")).filter((file) => !/\.r\d+\.json$/.test(file)).map((file) => {
    const plan = read(file), version = plan.version || path.basename(file, ".json");
    if (!/^[a-zA-Z0-9_-]+$/.test(version)) throw new Error(`Invalid version in ${file}`);
    const resolvedFile = path.join(folder, "work", version, "plan.resolved.json");
    const resolved = read(resolvedFile);
    const finalFiles = delivered?.files?.filter((f) => f.version === version);
    const finalVersion = finalFiles?.length ? { version, revision: finalFiles.at(-1).revision, files: finalFiles } : versionRecord(delivered, version);
    let state = planState(plan, resolved, versionRecord(review, version), finalVersion);
    if (resolved && fs.statSync(file).mtimeMs > fs.statSync(resolvedFile).mtimeMs) state = "plan changed; awaiting draft";
    return { version, state };
  });
  let next = !sources.length && !rows.length ? "Drop original footage and proof into the Desktop shortcuts." : !rows.length || transcribed < sources.filter((s) => s.audio !== "none" && s.audio !== "bad" && s.kind !== "photo" && s.kind !== "broll").length ? "Wait for indexing; check watch.log if it does not advance." : !plans.length ? "Review candidates and create work/plans/full.json." : plans.some((p) => /revision|awaiting|not yet/.test(p.state) && !p.state.startsWith("draft")) ? "Edit the plan from the combined review notes, then save it for a new draft." : plans.some((p) => p.state.startsWith("draft")) ? "Review the draft and collect the client's timecoded changes or approval." : plans.some((p) => p.state.startsWith("approved")) ? "Deliver the exact approved file after all permissions are approved." : "Approved deliverables are in 5 Final.";
  if (waiting.length) next += " Confirm the listed permissions before final delivery.";
  return `${manifest.identity?.name || path.basename(folder)}\nStatus: ${plans.length ? plans.map((p) => `${p.version}: ${p.state}`).join("; ") : "intake — draft not yet"}\nFootage: ${sources.length || rows.length} files; ${(duration / 3600).toFixed(2)} hours indexed; ${transcribed} transcribed.\nRights waiting: ${waiting.length}${waiting.length ? ` — ${waiting.slice(0, 5).join(", ")}${waiting.length > 5 ? `, and ${waiting.length - 5} more (see speaker-manifest.json)` : ""}` : " (none recorded as pending or unknown)"}.\nProof: ${proof.length} items. Candidates found: ${candidates}.\nPlans: ${plans.length ? plans.map((p) => `${p.version}: ${p.state}`).join("; ") : "not yet"}.\nNext: ${next}\nNothing is posted automatically.\n`;
}
export function writeSpeakerStatus(folder, { config = speakerConfig(), dryRun = false } = {}) {
  const text = speakerStatus(folder);
  if (!dryRun) {
    const manifest = read(path.join(folder, "speaker-manifest.json"));
    const desktop = path.join(config.desktop, safeName(manifest?.identity?.name || path.basename(folder)));
    // A removed client stays removed: status never recreates Desktop folders.
    if (fs.existsSync(desktop)) {
      const target = path.join(desktop, "Status.txt");
      if (fs.lstatSync(desktop).isSymbolicLink() || fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Status must be a real file in a real Desktop folder: ${target}`);
      fs.writeFileSync(target, text);
    }
  }
  return text;
}
// Snapshot only intake files. No hashing gigabytes, and no following directory symlinks.
export function intakeSnapshot(folder) {
  const entries = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "__MACOSX") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) { const stat = fs.statSync(file); entries.push([path.relative(folder, file), stat.size, stat.mtimeMs]); }
    }
  }
  walk(path.join(folder, "footage")); walk(path.join(folder, "proof"));
  return JSON.stringify(entries.sort((a, b) => a[0].localeCompare(b[0])));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), config = speakerConfig();
    if (args[0] === "--snapshot") console.log(intakeSnapshot(args[1]));
    else if (args[0] === "--clients") { for (const c of speakerClients(config, { activeOnly: true })) process.stdout.write(c.folder + "\0"); }
    else {
      const folder = args.find((a) => !a.startsWith("--"));
      const clients = folder ? [path.resolve(folder)] : speakerClients(config).map((c) => c.folder);
      if (!clients.length) console.log("No speaker clients yet.");
      for (const client of clients) console.log(writeSpeakerStatus(client, { config, dryRun: args.includes("--dry-run") }));
    }
  } catch (e) { console.error(`speaker-status: ${e.message}`); process.exitCode = 1; }
}
