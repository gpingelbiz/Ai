import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readJSON, writeJSON } from "./util.mjs";
import { speakerQC, writeQC, planDuration, identityProblems, rightsChecks } from "./speaker-qc.mjs";

function safePart(value, label) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(String(value))) throw new Error(`speaker ${label}: invalid name ${value}`);
  return String(value);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function planHash(plan) { return crypto.createHash("sha256").update(canonical(plan)).digest("hex"); }

/** Bounded memory even for a multi-gigabyte master. */
function fileHash(file) {
  const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024), fd = fs.openSync(file, "r");
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function storeFile(folder) { return path.join(folder, "review", "review.json"); }
function loadStore(folder) { return fs.existsSync(storeFile(folder)) ? readJSON(storeFile(folder)) : { schemaVersion: 1, versions: {} }; }
function initial(version) { return { version, state: "draft", revision: 1, rounds: [], history: [], files: [] }; }
function save(folder, store, entry) { store.versions[entry.version] = entry; writeJSON(storeFile(folder), store); return entry; }
function invalidate(entry, reason) {
  entry.history.push({ state: entry.state, approval: entry.approval || null, reason });
  entry.state = "revised";
  entry.approval = null;
  entry.warning = reason;
}

function snapshot(folder, entry) {
  if (!entry.planPath || !entry.files?.length) throw new Error(`speaker ${entry.version}: build a review before approval`);
  const plan = readJSON(path.resolve(folder, entry.planPath));
  const hashes = {};
  for (const file of entry.files) hashes[file.path] = fileHash(path.resolve(folder, file.path));
  const manifestPath = path.join(folder, "speaker-manifest.json");
  hashes["speaker-manifest.json"] = fileHash(manifestPath);
  const manifest = readJSON(manifestPath);
  if (manifest.brand?.file) hashes[`brand:${manifest.brand.file}`] = fileHash(path.resolve(folder, manifest.brand.file));
  const editable = path.join(folder, "work", entry.version, "speaker-plan.json");
  if (fs.existsSync(editable)) hashes[`work/${entry.version}/speaker-plan.json`] = fileHash(editable);
  return { planHash: planHash(plan), hashes };
}

/** Read state, invalidating approval as soon as an input or reviewed byte changes or disappears. */
export function reviewState(folder, version) {
  safePart(version, "version");
  const store = loadStore(folder), entry = store.versions[version] || initial(version);
  if (["approved", "delivered"].includes(entry.state)) {
    let reason = "";
    try {
      const now = snapshot(folder, entry);
      if (now.planHash !== entry.approval.planHash || canonical(now.hashes) !== canonical(entry.approval.hashes)) reason = "Plan or reviewed files changed after approval; a new approval is required";
    } catch (error) { reason = `Approved input missing or unreadable: ${error.message}`; }
    if (reason) { invalidate(entry, reason); save(folder, store, entry); }
  }
  return entry;
}

/** Called only after a complete review has been built. files include delivery bytes and original-input guards. */
export function registerReview(folder, version, { planPath, revision, files }) {
  const prior = reviewState(folder, version), store = loadStore(folder);
  const next = { ...prior, revision, planPath: path.relative(folder, planPath), reviewPlanHash: planHash(readJSON(planPath)), files };
  if (["approved", "delivered"].includes(next.state)) {
    const current = snapshot(folder, next);
    if (current.planHash !== next.approval.planHash || canonical(current.hashes) !== canonical(next.approval.hashes)) invalidate(next, "Review package changed; a new approval is required");
  } else if (next.state === "revision" || next.state === "revised") next.state = "revised";
  return save(folder, store, next);
}

/** Record one consolidated response. A second response is preserved and explicitly marked as extra scope. */
export function recordRevision(folder, version, comments, problems = []) {
  const entry = reviewState(folder, version), store = loadStore(folder);
  if (!comments.length && !problems.length) throw new Error(`speaker ${version}: no comments to record`);
  if (entry.approval) entry.history.push({ state: entry.state, approval: entry.approval, reason: "client comments" });
  const round = { round: entry.rounds.length + 1, revision: entry.revision, planHash: entry.planPath ? planHash(readJSON(path.resolve(folder, entry.planPath))) : null, comments, problems, extraRevision: entry.rounds.length >= 1 };
  if (round.extraRevision) round.warning = "extra revision (Greg's call)";
  entry.rounds.push(round);
  entry.state = "revision";
  entry.approval = null;
  return save(folder, store, entry);
}

async function checkFiles(folder, entry, final, qc) {
  const plan = readJSON(path.resolve(folder, entry.planPath)), manifest = readJSON(path.join(folder, "speaker-manifest.json"));
  const videos = entry.files.filter((f) => f.kind === "video" && f.delivery);
  if (!videos.length) throw new Error(`speaker ${entry.version}: no reviewed delivery video`);
  const captions = Object.fromEntries(entry.files.filter((f) => ["srt", "vtt"].includes(f.kind)).map((f) => [f.kind, path.resolve(folder, f.path)]));
  for (const kind of ["srt", "vtt", "poster"]) if (!entry.files.some((f) => f.kind === kind && f.delivery)) throw new Error(`speaker ${entry.version}: missing reviewed ${kind}`);
  const rights = rightsChecks(plan, manifest, final).filter((c) => c.level === "fail");
  if (rights.length) throw new Error(`speaker ${entry.version}: ${rights.map((c) => c.message).join("; ")}`);
  const identity = [...identityProblems(plan), ...identityProblems(manifest)];
  if (identity.length) throw new Error(`speaker ${entry.version}: forbidden Greg identity at ${identity.join(", ")}`);
  for (const video of videos) {
    const result = await qc(path.resolve(folder, video.path), { resolvedPlan: plan, manifest, final, captionFiles: captions });
    writeQC(path.join(folder, "work", entry.version), result);
    if (!result.ok) throw new Error(`speaker ${entry.version}: QC failed: ${result.checks.filter((c) => c.level === "fail").map((c) => c.message).join("; ")}`);
  }
  return { plan, manifest };
}

/** by and at describe the client's explicit approval, never an automatically inferred approval. */
export async function approve(folder, version, { by, at, qc = speakerQC } = {}) {
  if (!String(by || "").trim()) throw new Error(`speaker ${version}: approver name is required`);
  if (!at || !Number.isFinite(Date.parse(at))) throw new Error(`speaker ${version}: approval date is required (ISO timestamp)`);
  let entry = reviewState(folder, version);
  if (!["draft", "revised"].includes(entry.state)) throw new Error(`speaker ${version}: cannot approve state ${entry.state}; build the revised review first`);
  const beforeStateHash = planHash(entry);
  const before = snapshot(folder, entry);
  if (before.planHash !== entry.reviewPlanHash) throw new Error(`speaker ${version}: plan changed since review; build a new review before approval`);
  await checkFiles(folder, entry, false, qc);
  const after = snapshot(folder, entry);
  if (canonical(before) !== canonical(after)) throw new Error(`speaker ${version}: files changed during approval`);
  entry = reviewState(folder, version);
  if (planHash(entry) !== beforeStateHash) throw new Error(`speaker ${version}: review state changed during approval`);
  entry.approval = { by: String(by).trim(), at, ...after };
  entry.state = "approved";
  delete entry.warning;
  return save(folder, loadStore(folder), entry);
}

export function deliveryName({ clientId, version, revision, width = 1920, height = 1080, variant = "clean", kind = "video" }) {
  safePart(clientId, "clientId"); safePart(version, "version");
  if (![width, height].every((n) => Number.isInteger(n) && n > 0)) throw new Error("speaker dimensions: expected positive integers");
  if (!Number.isInteger(revision) || revision < 1) throw new Error("speaker revision: expected positive integer");
  if (!["open", "clean"].includes(variant)) throw new Error(`speaker variant: invalid ${variant}`);
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const unit = gcd(width, height), base = `${clientId}-speaker_${version}_v${revision}_${width / unit}x${height / unit}_${height}p`;
  if (kind === "video") return `${base}_${variant}.mp4`;
  if (!["srt", "vtt", "poster"].includes(kind)) throw new Error(`speaker delivery kind: ${kind}`);
  return `${base}${kind === "poster" ? "_poster.jpg" : `.${kind}`}`;
}

/** Copy exact approved bytes. This module never calls a renderer, normalizer or posting integration. */
export async function deliver(folder, version, { qc = speakerQC } = {}) {
  let entry = reviewState(folder, version);
  if (entry.state !== "approved") throw new Error(`speaker ${version}: delivery requires approved state (currently ${entry.state})${entry.warning ? `: ${entry.warning}` : ""}`);
  const { plan, manifest } = await checkFiles(folder, entry, true, qc);
  // Recheck after asynchronous QC, immediately before copying.
  entry = reviewState(folder, version);
  if (entry.state !== "approved") throw new Error(`speaker ${version}: approved hashes changed during QC`);
  const badIdentity = [...identityProblems(plan), ...identityProblems(manifest)];
  if (badIdentity.length) throw new Error(`speaker identity: forbidden text at ${badIdentity.join(", ")}`);
  const dir = path.join(folder, "final");
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const file of entry.files.filter((f) => f.delivery)) {
    const name = deliveryName({ clientId: manifest.clientId, version, revision: plan.revision, ...plan.canvas, kind: file.kind, variant: file.variant || "clean" });
    const target = path.join(dir, name), expected = entry.approval.hashes[file.path];
    fs.copyFileSync(path.resolve(folder, file.path), target);
    if (fileHash(target) !== expected) { fs.rmSync(target, { force: true }); throw new Error(`speaker ${version}: copied bytes differ for ${name}`); }
    files.push({ file: name, sha256: expected, duration: planDuration(plan), dimensions: { width: plan.canvas.width, height: plan.canvas.height }, version, revision: plan.revision,
      kind: file.kind, ...(file.variant ? { variant: file.variant } : {}), approvalDate: entry.approval.at, approvedBy: entry.approval.by, planHash: entry.approval.planHash, bookingMode: manifest.identity.bookingMode });
  }
  const manifestFile = path.join(dir, "manifest.json");
  const existing = fs.existsSync(manifestFile) ? readJSON(manifestFile) : { schemaVersion: 1, clientId: manifest.clientId, files: [] };
  existing.files = [...existing.files.filter((f) => !(f.version === version && f.revision === plan.revision)), ...files];
  writeJSON(manifestFile, existing);
  entry.state = "delivered";
  entry.delivery = { files: files.map((f) => f.file), approvalDate: entry.approval.at };
  save(folder, loadStore(folder), entry);
  return { dir, files, manifest: manifestFile };
}
