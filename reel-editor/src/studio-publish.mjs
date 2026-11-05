import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadStudio, readPosts, logPost, studioLog, parseTime } from "./content-studio.mjs";
import { readItem, fileItem, serve, stop, tiktokData, FAILED, SOURCE_ROOTS } from "./publish-folder.mjs";
import { reelDetails, reelSlot, trialSlotFor, reelMadeName, recordReelSuccess } from "./studio-reels.mjs";
import { zonedNow, addDays } from "./daily.mjs";
import { clientStatus, clientNotify } from "./client-status.mjs";
import { PKG_ROOT } from "./util.mjs";

const itemAt = (studio, entry, options = {}) => {
  if (!entry || path.basename(entry) !== entry || entry === "." || entry === "..") throw new Error("Use an entry from scan");
  const item = readItem(entry, { root: studio.paths.publish, sourceRoots: SOURCE_ROOTS, client: true, ...options });
  if (!item?.video) throw new Error("Reel is no longer in Publish");
  return item;
};

export function scanPublish(studio, { now = Date.now(), settle = 60000 } = {}) {
  const c = studio.config;
  if (c.publish.mode === "off" || c.reels.enabled === false) return { ready: [], waiting: [], problems: [] };
  const ready = [], waiting = [], problems = [];
  for (const entry of fs.readdirSync(studio.paths.publish).filter((n) => !n.startsWith(".") && n !== FAILED)) {
    const item = readItem(entry, { root: studio.paths.publish, sourceRoots: SOURCE_ROOTS, client: true, now, settle });
    if (!item) continue;
    if (item.problem) { problems.push({ entry, problem: item.problem }); continue; }
    if (item.waiting) { waiting.push(entry); continue; }
    const d = reelDetails(studio, item);
    ready.push({ entry, video: item.video, ...d, why: d.draftWhy, isAiGenerated: d.ai,
      blogId: c.metricool.blogId, timezone: c.timezone, providers: c.metricool.networks,
      instagramType: d.trial ? "TRIAL_REEL" : "REEL", tiktok: tiktokData({ isAiGenerated: d.ai }), droppedAt: item.droppedAt });
  }
  ready.sort((a, b) => a.droppedAt - b.droppedAt || a.entry.localeCompare(b.entry));
  return { folder: studio.paths.publish, blogId: c.metricool.blogId, timezone: c.timezone, ready, waiting, problems };
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
  const posts = readPosts(studio.paths);
  if (input.trialCopy) return trialSlotFor({ now, tz: c.timezone, scheduled, posts, reels: c.reels, from: input.notBefore });
  return reelSlot({ now, tz: c.timezone, scheduled, posts, best: input.bestByDay || {}, reels: c.reels });
}

export function finishPublish(studio, entry, receipt = {}) {
  const item = itemAt(studio, entry, { settle: 0 });
  const d = reelDetails(studio, item);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(receipt.date || "")) throw new Error("done needs --date in the studio time zone");
  const day = receipt.date.slice(0, 10), time = receipt.date.slice(11, 16);
  const hook = path.basename(item.video).replace(/\.(mov|mp4|m4v)$/i, "");
  const made = fileItem(item, { status: "scheduled", receipt: "Recording the Metricool receipt.\n", destination: studio.paths.made,
    name: reelMadeName({ day, hour: Number(time.slice(0, 2)) }, hook) });
  const record = { id: `${day}-${time.replace(":", "")}-reel`, day, time, format: "reel", hook, made,
    files: [path.join(made, path.basename(item.video))], ...d, status: d.draft || receipt.draft ? "draft" : "scheduled",
    plannerUrl: receipt.planner || "", metricoolId: receipt.id || "", why: d.draftWhy || receipt.why || "", draftWhy: d.draftWhy || (receipt.draft ? receipt.why || "flagged" : "") };
  fs.rmSync(path.join(made, "Not posted.txt"), { force: true });
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
  clientStatus(studio.paths, "publish", `${hook}: ${record.status} ${day} ${time}`);
  return completed;
}

/** Out of Publish, so the next run cannot post it twice when Metricool's answer was unclear. Dragging it back retries. */
export function failPublish(studio, entry, why) {
  const item = itemAt(studio, entry, { settle: 0 });
  fileItem(item, { status: "failed", receipt: `Not posted: ${why}\nCheck Metricool first. If it is not there, drag this reel back into Publish to try again.\n` });
  clientNotify(`${studio.config.client}: reel not posted`, `${entry}: ${why}`);
  studioLog(studio.paths, `REEL NOT POSTED ${entry}: ${why}`);
  clientStatus(studio.paths, "publish", `Reel needs attention: ${entry}: ${why}`);
  return { entry, status: "not-posted", why };
}

export async function publishCommand(args) {
  const { values: v, positionals: [cmd, arg] } = parseArgs({ args, allowPositionals: true, options: Object.fromEntries([
    ...["studio", "date", "planner", "id", "why", "networks", "trial-copy", "trial-date", "trial-planner", "trial-id", "trial-copy-failed"].map((k) => [k, { type: "string" }]),
    ...["draft", "trial"].map((k) => [k, { type: "boolean" }]),
  ]) });
  const studio = loadStudio(v.studio);
  const state = path.join(studio.paths.state, "publish-serve.json");
  let result;
  if (cmd === "scan") result = scanPublish(studio);
  else if (cmd === "slot") result = publishSlot(studio, JSON.parse(arg || "{}"));
  else if (cmd === "stop") result = await stop({ state });
  else if (cmd === "serve") {
    const item = scanPublish(studio).ready.find((r) => r.video === path.resolve(arg || ""));
    if (!item) throw new Error("serve needs a ready video from scan");
    result = await serve(item.video, { script: path.join(PKG_ROOT, "scripts", "publish-folder.mjs"), state });
  } else if (cmd === "done") result = finishPublish(studio, arg, { ...v, trialCopy: v["trial-copy"], trialDate: v["trial-date"], trialPlanner: v["trial-planner"], trialId: v["trial-id"], trialCopyFailed: v["trial-copy-failed"] });
  else if (cmd === "fail") result = failPublish(studio, arg, v.why || "unknown error");
  else throw new Error("publish scan|slot|serve|stop|done|fail --studio <dir>");
  console.log(JSON.stringify(result, null, 2));
}
