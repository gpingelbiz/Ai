import crypto from "node:crypto";
import { S } from "./pipeline.mjs";

export function scrub(value, c) {
  let text = String(value ?? "");
  for (const secret of [c.opus.apiKey, c.dropbox.appKey, c.dropbox.refreshToken, c.opus.orgId]) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text.replace(/https?:\/\/[^\s<>"']+/gi, "[link removed]").replace(/Bearer\s+\S+/gi, "[redacted]");
}

/** Shared connection probes. None of these operations changes a remote file or project. */
export function probes(c, { opus, dropbox }) {
  return [
    ["Opus key", async () => {
      if (!c.opus.apiKey) throw new Error("not set up");
      const t = await opus.templates();
      return ` (${(t || []).length} brand templates)`;
    }],
    ["Dropbox sign-in", async () => {
      if (!c.dropbox.appKey || !c.dropbox.refreshToken) throw new Error("not set up");
      const a = await dropbox.account();
      return ` (${a.email})`;
    }],
    ["drop folder", async () => {
      if (!c.folders.drop) throw new Error("not set up");
      const n = (await dropbox.list(c.folders.drop)).filter((e) => e[".tag"] === "file").length;
      return ` ${c.folders.drop} (${n} files)`;
    }],
    ["finished folder", async () => {
      if (!c.folders.finished) throw new Error("not set up");
      if (!await dropbox.exists(c.folders.finished)) throw new Error("not there");
      return ` ${c.folders.finished}`;
    }],
  ];
}

export async function watchReport({ c, state, clients, job, now = Date.now() }) {
  const problems = [];
  for (const [label, fn] of probes(c, clients)) {
    try { await fn(); } catch (e) { problems.push(`${label} failed: ${e.message}.`); }
  }
  const minutesSinceRun = state.lastRun ? (now - Date.parse(state.lastRun)) / 60000 : null;
  if (!job) problems.push("The background job is off.");
  if (minutesSinceRun === null || !Number.isFinite(minutesSinceRun) || minutesSinceRun > 30) problems.push("The background job has not run within 30 minutes.");
  if (state.lastReport?.blocked) problems.push(`Sending is blocked: ${state.lastReport.blocked}.`);
  const counts = Object.fromEntries(Object.values(S).map((s) => [s, 0]));
  const inOpus = [], needsLook = [], newlyDone = [];
  for (const it of Object.values(state.items || {})) {
    counts[it.status] = (counts[it.status] || 0) + 1;
    if (it.status === S.IN_OPUS) {
      const hoursInOpus = (now - Date.parse(it.sentAt)) / 3600000;
      inOpus.push({ name: it.name, stage: it.stage, hoursInOpus });
      if (hoursInOpus > c.stuckHours) problems.push(`${it.name} has been in Opus over ${c.stuckHours} hours.`);
    }
    if (it.status === S.FAILED) { needsLook.push({ name: it.name, error: it.error }); problems.push(`${it.name} needs a look: ${it.error || "unknown error"}.`); }
    if (it.status === S.DELIVERING && it.deliverErrors) problems.push(`${it.name} has clip delivery errors: ${it.lastError || "unknown error"}.`);
    if (it.status === S.DONE && Date.parse(it.doneAt) > Date.parse(state.watchedAt || "1970-01-01")) newlyDone.push({ name: it.name, clips: it.clips, dest: it.dest });
  }
  const report = { ok: !problems.length, problems, job, lastRun: state.lastRun || null, minutesSinceRun, counts, inOpus, needsLook, newlyDone };
  // Scrub all strings, including names and paths supplied by remote services.
  return JSON.parse(JSON.stringify(report, (key, value) => typeof value === "string" ? scrub(value, c) : value));
}
export const problemHash = (problems) => crypto.createHash("sha256").update(JSON.stringify([...problems].sort())).digest("hex");

/** Only watcher metadata may change. Call with freshly loaded state under the lock. */
export function markWatched(state, report, { at, alerts, notify }) {
  const hash = problemHash(report.problems);
  if (alerts && report.problems.length && state.watchNotified !== hash) {
    notify(report.problems.join(" "));
    state.watchNotified = hash;
  } else if (!report.problems.length) delete state.watchNotified;
  state.watchedAt = at;
}
