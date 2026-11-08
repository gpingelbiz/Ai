import { spawn } from "node:child_process";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadStudio, readPosts, logPost, studioLog, parseTime } from "./content-studio.mjs";
import { readItem, fileItem, stop, tiktokData, FAILED, SOURCE_ROOTS } from "./publish-folder.mjs";
import { reelDetails, reelSlot, trialSlotFor, reelMadeName, recordReelSuccess } from "./studio-reels.mjs";
import { zonedNow, addDays } from "./daily.mjs";
import { clientStatus, clientNotify } from "./client-status.mjs";
import { hostFiles } from "./studio-host.mjs";
import { PKG_ROOT } from "./util.mjs";

const itemAt = (studio, entry, options = {}) => {
  if (!entry || path.basename(entry) !== entry || entry === "." || entry === "..") throw new Error("Use an entry from scan");
  const item = readItem(entry, { root: studio.paths.publish, sourceRoots: SOURCE_ROOTS, client: true, ...options });
  if (!item?.video) throw new Error("Reel is no longer in Publish");
  return item;
};

export const INTERRUPTED_PUBLISH = "Posting was interrupted. This reel may already be scheduled. Open Metricool and check before trying again.";

export const publishLedger = (studio) => path.join(studio.paths.root, "publish", "ledger");
const ledgerFile = (studio, id, kind) => {
  if (!/^[a-f0-9]{32}$/.test(id || "")) throw new Error("Use a reel id from scan");
  return path.join(publishLedger(studio), `${id}.${kind}.json`);
};
const readLedger = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const exists = (file) => fs.existsSync(file);

// Publish a complete record in one step. A competing claim must never replace it.
function saveLedger(file, record, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(record, null, 2) + "\n"); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    if (exclusive) fs.linkSync(temp, file);
    else fs.renameSync(temp, file);
    const dir = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { fs.rmSync(temp, { force: true }); }
}

const reelId = (studio, item) => {
  const st = fs.statSync(item.video);
  return createHash("sha256").update(JSON.stringify([path.relative(studio.paths.publish, item.video), st.dev, st.ino, st.birthtimeMs])).digest("hex").slice(0, 32);
};
const entries = (studio) => fs.readdirSync(studio.paths.publish).filter(n => !n.startsWith(".") && n !== FAILED && n !== "ledger");
function publishItem(studio, ref, options = {}) {
  for (const entry of entries(studio)) {
    const item = itemAtOrNull(studio, entry, options);
    if (item?.video && [entry, reelId(studio, item), item.video].includes(ref)) return item;
  }
  throw new Error("Use a reel id from scan");
}
function itemAtOrNull(studio, entry, options) {
  return readItem(entry, { root: studio.paths.publish, sourceRoots: SOURCE_ROOTS, client: true, ...options });
}
export function publishClaims(studio) {
  let files;
  try { files = fs.readdirSync(publishLedger(studio)); } catch (e) { if (e.code === "ENOENT") return []; throw e; }
  return files.filter(n => /^[a-f0-9]{32}\.claim\.json$/.test(n)).map(n => {
    try {
      const claim = readLedger(path.join(publishLedger(studio), n));
      if (claim?.id !== n.slice(0, 32) || !claim.owner || !claim.entry || claim.state !== "awaiting-receipt") throw new Error("Invalid saved claim");
      return claim;
    }
    catch { return { id: n.slice(0, 32), state: "awaiting-receipt", damaged: true }; }
  });
}
const holdNote = item => path.join(path.dirname(item.video), item.dir ? "Posting check.txt" : `Posting check ${createHash("sha256").update(path.basename(item.video)).digest("hex").slice(0, 12)}.txt`);
export function publishHolds(studio) {
  const claims = publishClaims(studio);
  for (const claim of claims) {
    if (!claim.entry) continue;
    const item = itemAtOrNull(studio, claim.entry, { settle: 0 });
    if (item?.video) fs.writeFileSync(holdNote(item), INTERRUPTED_PUBLISH + "\n");
  }
  let previousHold = false;
  try { previousHold = !!readLedger(path.join(studio.paths.state, "status.json"))["posting"]; } catch {}
  if (claims.length || previousHold) clientStatus(studio.paths, "posting", claims.length ? INTERRUPTED_PUBLISH : "No reels need a posting check.");
  return claims.map(({ id, entry, slot, at }) => ({ id, entry, slot, at, message: INTERRUPTED_PUBLISH }));
}
function ownedClaim(studio, ref, owner) {
  const claim = publishClaims(studio).find(c => c.id === ref || c.entry === ref);
  if (!claim || !owner || claim.owner !== owner) throw new Error("Use the owner returned by claim. This reel is held until its posting is checked.");
  return claim;
}

export function claimPublish(studio, ref, { date, slot = date, owner = randomUUID(), now = new Date() } = {}) {
  const item = publishItem(studio, ref, { settle: 60000 });
  if (item.waiting || item.problem || studio.config.publish.mode === "off" || studio.config.reels.enabled === false) throw new Error("This reel is not ready to post");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(slot || "")) throw new Error("claim needs the chosen date and time");
  const id = reelId(studio, item);
  if (typeof owner !== "string" || !owner) throw new Error("The posting run needs a name");
  if (exists(ledgerFile(studio, id, "receipt")) || publishClaims(studio).some(c => c.entry === item.entry)) throw new Error(INTERRUPTED_PUBLISH);
  const details = reelDetails(studio, item);
  const claim = { id, slot, owner, at: now.toISOString(), state: "awaiting-receipt", entry: item.entry, video: path.basename(item.video), trial: details.trial, draft: details.draft };
  try { saveLedger(ledgerFile(studio, id, "claim"), claim, true); }
  catch (e) { if (e.code === "EEXIST") throw new Error(INTERRUPTED_PUBLISH); throw e; }
  publishHolds(studio);
  return claim;
}

/** Consuming the saved claim is one way only, even when hosting stops before a create. */
export function beginPublish(studio, ref, owner) {
  const claim = ownedClaim(studio, ref, owner);
  if (exists(ledgerFile(studio, claim.id, "receipt"))) throw new Error("The posting receipt is already saved");
  const item = itemAt(studio, claim.entry, { settle: 0 });
  if (reelId(studio, item) !== claim.id || path.basename(item.video) !== claim.video) throw new Error("The claimed reel changed. Check its posting before trying again.");
  const dispatch = `${claim.id}.${createHash("sha256").update(claim.owner).digest("hex")}.serve`;
  try { saveLedger(path.join(publishLedger(studio), dispatch + ".json"), { id: claim.id, at: new Date().toISOString() }, true); }
  catch (e) { if (e.code === "EEXIST") throw new Error(INTERRUPTED_PUBLISH); throw e; }
  return { claim, item };
}

export function scanPublish(studio, { now = Date.now(), settle = 60000 } = {}) {
  const c = studio.config;
  const held = publishHolds(studio);
  if (c.publish.mode === "off" || c.reels.enabled === false) return { ready: [], waiting: [], problems: [], held };
  const ready = [], waiting = [], problems = [];
  for (const entry of entries(studio)) {
    if (held.some(h => h.entry === entry)) continue;
    const item = itemAtOrNull(studio, entry, { now, settle });
    if (!item) continue;
    if (item.problem) { problems.push({ entry, problem: item.problem }); continue; }
    if (item.waiting) { waiting.push(entry); continue; }
    const id = reelId(studio, item);
    if (held.some(h => h.id === id) || exists(ledgerFile(studio, id, "receipt"))) continue;
    const d = reelDetails(studio, item);
    ready.push({ id, entry, video: item.video, ...d, why: d.draftWhy, isAiGenerated: d.ai,
      blogId: c.metricool.blogId, timezone: c.timezone, providers: c.metricool.networks,
      instagramType: d.trial ? "TRIAL_REEL" : "REEL", tiktok: tiktokData({ isAiGenerated: d.ai }), droppedAt: item.droppedAt });
  }
  ready.sort((a, b) => a.droppedAt - b.droppedAt || a.entry.localeCompare(b.entry));
  return { folder: studio.paths.publish, blogId: c.metricool.blogId, timezone: c.timezone, ready, waiting, problems, held };
}

/** Connector snapshots are passed in by Claude; these commands never call a connector. */
export function publishSlot(studio, input = {}, { now = new Date() } = {}) {
  const c = studio.config;
  const today = zonedNow(c.timezone, now).day;
  const scheduled = [...(input.scheduled || [])];
  for (const [day, hours] of Object.entries(input.busy || {})) for (const hour of hours) scheduled.push({ day, hour, minute: 0, type: "POST" });
  for (const day of input.taken || []) scheduled.push({ day, hour: 0, minute: 0, type: "REEL" });
  for (let k = 0; k <= 14; k++) for (const s of c.slots) {
    const t = parseTime(s.time);
    scheduled.push({ day: addDays(today, k), hour: t.h, minute: t.m, type: "POST" });
  }
  for (const claim of publishClaims(studio)) {
    const date = claim.slot || "";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(date)) scheduled.push({ day: date.slice(0, 10), hour: Number(date.slice(11, 13)), minute: Number(date.slice(14, 16)), type: claim.draft ? "POST" : claim.trial ? "TRIAL_REEL" : "REEL" });
  }
  const posts = readPosts(studio.paths);
  if (input.trialCopy) return trialSlotFor({ now, tz: c.timezone, scheduled, posts, reels: c.reels, from: input.notBefore });
  return reelSlot({ now, tz: c.timezone, scheduled, posts, best: input.bestByDay || {}, reels: c.reels });
}

export function finishPublish(studio, entry, receipt = {}) {
  const claim = ownedClaim(studio, entry, receipt.owner);
  const saved = ledgerFile(studio, claim.id, "receipt");
  if (exists(saved)) throw new Error("The posting receipt is already saved. Check the reel in Made.");
  const item = itemAt(studio, claim.entry, { settle: 0 });
  if (reelId(studio, item) !== claim.id) throw new Error("The claimed reel changed. Check its posting before trying again.");
  const d = reelDetails(studio, item);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(receipt.date || "")) throw new Error("done needs --date in the studio time zone");
  if (receipt.date.slice(0, 16) !== claim.slot.slice(0, 16)) throw new Error("The receipt date must match the claimed time");
  if (!receipt.id && !receipt.confirmedByPerson) throw new Error("done needs the Metricool post id");
  if (receipt.trialCopy && receipt.trialCopyFailed) throw new Error("Record one trial copy result");
  if (receipt.trialCopy && !receipt.trialId) throw new Error("done needs the trial copy post id");
  if (d.trialCopy && !d.draft && !receipt.trialCopy && !receipt.trialCopyFailed && !receipt.confirmedByPerson) throw new Error("Record the trial copy result before done");
  const primary = { id: receipt.id || "", date: receipt.date, planner: receipt.planner || "", confirmedByPerson: !!receipt.confirmedByPerson };
  const copies = { normal: d.trial ? null : primary, trial: d.trial ? primary : receipt.trialCopy ? { id: receipt.trialId, date: receipt.trialCopy, planner: receipt.trialPlanner || "" } : receipt.trialCopyFailed ? { id: "", date: receipt.trialDate || "", uncertain: true, why: receipt.trialCopyFailed } : null };
  // Save evidence before moving anything. An interrupted filing must still block another create.
  saveLedger(saved, { ...claim, state: "receipted", ...copies }, true);
  const day = receipt.date.slice(0, 10), time = receipt.date.slice(11, 16);
  const hook = path.basename(item.video).replace(/\.(mov|mp4|m4v)$/i, "");
  const made = fileItem(item, { status: "scheduled", receipt: "Recording the Metricool receipt.\n", destination: studio.paths.made,
    name: reelMadeName({ day, hour: Number(time.slice(0, 2)) }, hook) });
  const record = { id: `${day}-${time.replace(":", "")}-reel`, day, time, format: "reel", hook, made,
    files: [path.join(made, path.basename(item.video))], ...d, status: d.draft || receipt.draft ? "draft" : "scheduled",
    plannerUrl: receipt.planner || "", metricoolId: receipt.id || "", why: d.draftWhy || receipt.why || "", draftWhy: d.draftWhy || (receipt.draft ? receipt.why || "flagged" : "") };
  fs.rmSync(path.join(made, "Not posted.txt"), { force: true });
  fs.rmSync(path.join(made, path.basename(holdNote(item))), { force: true });
  fs.rmSync(holdNote(item), { force: true });
  logPost(studio.paths, { ...record, status: "made" });
  const completed = recordReelSuccess(studio, record, { id: receipt.id || "", plannerUrl: receipt.planner || "" }, { notify: () => {} });
  if (receipt.trialCopy || receipt.trialCopyFailed) {
    const date = receipt.trialCopy || receipt.trialDate || receipt.date;
    const copy = { ...completed, id: `${record.id}-trial`, day: date.slice(0, 10), time: date.slice(11, 16), format: "trial", trial: true,
      status: receipt.trialCopyFailed ? "trial-skipped" : completed.status, why: receipt.trialCopyFailed || completed.why,
      plannerUrl: receipt.trialPlanner || "", metricoolId: receipt.trialId || "" };
    if (receipt.trialCopyFailed) logPost(studio.paths, copy);
    else recordReelSuccess(studio, copy, { id: receipt.trialId || "", plannerUrl: receipt.trialPlanner || "" }, { notify: () => {} });
    if (receipt.trialCopyFailed) fs.writeFileSync(path.join(made, "Trial Not posted.txt"), `Not in Metricool yet: ${copy.why}\n`);
  }
  saveLedger(saved, { ...readLedger(saved), made, completed });
  fs.unlinkSync(ledgerFile(studio, claim.id, "claim"));
  publishHolds(studio);
  clientStatus(studio.paths, "publish", `${hook}: ${record.status} ${day} ${time}`);
  return completed;
}

/** A failed answer cannot prove that nothing was scheduled. Keep a claimed reel held. */
export function failPublish(studio, entry, why, { owner } = {}) {
  const pending = publishClaims(studio).find(c => c.id === entry || c.entry === entry);
  if (pending) {
    const claim = ownedClaim(studio, entry, owner);
    saveLedger(ledgerFile(studio, claim.id, "claim"), { ...claim, failure: why });
    publishHolds(studio);
    return { id: claim.id, status: "held", why, message: INTERRUPTED_PUBLISH };
  }
  const item = publishItem(studio, entry, { settle: 0 });
  fileItem(item, { status: "failed", receipt: `Not posted: ${why}\nCheck Metricool before trying again.\n` });
  clientNotify(`${studio.config.client}: reel not posted`, `${entry}: ${why}`);
  studioLog(studio.paths, `REEL NOT POSTED ${entry}: ${why}`);
  clientStatus(studio.paths, "publish", `Reel needs attention: ${entry}: ${why}`);
  return { entry, status: "not-posted", why };
}

/** This command records a person's check. Routines must never call it. */
export function releasePublish(studio, ref, { posted = false, notPosted = false } = {}) {
  if (posted === notPosted) throw new Error("Choose either posted or not posted after checking Metricool");
  const claim = publishClaims(studio).find(c => c.id === ref || c.entry === ref);
  if (!claim || claim.damaged) throw new Error("The saved posting claim needs to be checked by hand");
  if (exists(ledgerFile(studio, claim.id, "receipt"))) throw new Error("A posting receipt is already saved. Check the reel in Made before changing anything.");
  if (posted) {
    const details = reelDetails(studio, itemAt(studio, claim.entry, { settle: 0 }));
    return finishPublish(studio, claim.id, { owner: claim.owner, date: claim.slot, confirmedByPerson: true,
      ...(details.trialCopy ? { trialCopyFailed: "Check the trial copy in Metricool before scheduling anything else." } : {}) });
  }
  saveLedger(path.join(publishLedger(studio), `${claim.id}.${randomUUID()}.release.json`), { ...claim, state: "not-posted", checkedByPersonAt: new Date().toISOString() }, true);
  const item = itemAtOrNull(studio, claim.entry, { settle: 0 });
  if (item?.video) fs.rmSync(holdNote(item), { force: true });
  fs.unlinkSync(ledgerFile(studio, claim.id, "claim"));
  publishHolds(studio);
  return { id: claim.id, status: "released" };
}

export async function publishCommand(args) {
  const { values: v, positionals: [cmd, arg] } = parseArgs({ args, allowPositionals: true, options: Object.fromEntries([
    ...["studio", "date", "planner", "id", "why", "networks", "trial-copy", "trial-date", "trial-planner", "trial-id", "trial-copy-failed", "owner", "slot"].map((k) => [k, { type: "string" }]),
    ...["draft", "trial", "posted", "not-posted"].map((k) => [k, { type: "boolean" }]),
  ]) });
  const studio = loadStudio(v.studio);
  const state = path.join(studio.paths.state, "publish-serve.json");
  let result;
  if (cmd === "scan") result = scanPublish(studio);
  else if (cmd === "claim") result = claimPublish(studio, arg, v);
  else if (cmd === "release") result = releasePublish(studio, arg, { posted: !!v.posted, notPosted: !!v["not-posted"] });
  else if (cmd === "slot") result = publishSlot(studio, JSON.parse(arg || "{}"));
  else if (cmd === "stop") result = await stop({ state });
  else if (cmd === "serve-child") {
    const claim = ownedClaim(studio, arg, v.owner);
    const item = itemAt(studio, claim.entry, { settle: 0 });
    return hostChild([item.video], { state, hosting: { route: "tunnel" }, postId: item.entry });
  }
  else if (cmd === "serve") {
    beginPublish(studio, arg, v.owner);
    result = (await detachedHost({ state, args: [path.join(PKG_ROOT, "bin", "reel.mjs"), "studio", "publish", "serve-child", arg, "--owner", v.owner, "--studio", studio.paths.root], timeoutMs: 120000 })).urls[0];
  } else if (cmd === "done") result = finishPublish(studio, arg, { ...v, trialCopy: v["trial-copy"], trialDate: v["trial-date"], trialPlanner: v["trial-planner"], trialId: v["trial-id"], trialCopyFailed: v["trial-copy-failed"] });
  else if (cmd === "fail") result = failPublish(studio, arg, v.why || "unknown error", v);
  else throw new Error("publish scan|slot|claim|serve|stop|done|fail|release --studio <dir>");
  console.log(JSON.stringify(result, null, 2));
}

/** The routine runs inside a Claude session; a child that calls `claude -p` must not look nested in it. */
export function outsideClaude(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k === "CLAUDE_CODE_OAUTH_TOKEN" || !/^(CLAUDECODE$|CLAUDE_CODE_)/.test(k)));
}

/** Shared detached hosting lifecycle for app publishing commands. */
export async function detachedHost({ state, args, timeoutMs = 660000 }) {
  await stop({ state });
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore", env: outsideClaude() });
  child.unref();
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, 1000));
    try { const result = JSON.parse(fs.readFileSync(state, "utf8")); if (result.urls?.every(u => u.startsWith("https://"))) return result; } catch {}
    try { process.kill(child.pid, 0); } catch { throw new Error("The file host stopped before returning links"); }
  }
  try { process.kill(child.pid, "SIGTERM"); } catch {}
  throw new Error("The file host timed out");
}

export async function hostChild(files, { state, ...options }) {
  const host = await hostFiles(files, options);
  fs.writeFileSync(state, JSON.stringify({ pid: process.pid, urls: host.urls }));
  const quit = async () => { await host.close(); fs.rmSync(state, { force: true }); process.exit(0); };
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
  setTimeout(quit, 20 * 60000);
}
