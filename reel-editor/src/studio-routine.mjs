import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PKG_ROOT } from "./util.mjs";
import { photosDir } from "./content-studio.mjs";

const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);
/** Every routine command starts with this, so one allow rule covers them all. */
const publishPrefix = ({ node = process.execPath, bin = path.join(PKG_ROOT, "bin", "reel.mjs") } = {}) => `${quote(node)} ${quote(bin)} studio publish`;

/** Allow only the routine's own commands, so an unattended run never stops on them. Everything else in the file stays. */
export function allowPublishCommands({ home = os.homedir(), ...options } = {}) {
  const file = path.join(home, ".claude", "settings.json");
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") return false; }
  const rule = `Bash(${publishPrefix(options)} *)`;
  const allow = settings.permissions?.allow || [];
  if (!allow.includes(rule)) {
    settings.permissions = { ...settings.permissions, allow: [...allow, rule] };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }
  return true;
}

export function routinePrompt(studio, options = {}) {
  const c = studio.config;
  const command = (action, args = "") => `${publishPrefix(options)} ${action}${args ? ` ${args}` : ""} --studio ${quote(studio.paths.root)}`;
  return `---
name: reel-publish
description: Schedule approved reels hourly at :45 from 7 AM to 8 PM.
---

Dropping a finished reel into Desktop/Reels/Publish is approval to post it. Schedule ALL ready reels through the Metricool connector in this run. Do nothing else.
Fixed facts: blogId ${c.metricool.blogId}, timezone ${c.timezone}. Use the providers, trial setting, text, cover and AI flag returned by scan. One regular reel per day and at least two hours from every other post. Trial copies never take a regular reel day. A draft stays a draft.

Use each command below as one verbatim Bash command, substituting only the uppercase argument placeholders (SLOT_JSON, TRIAL_SLOT_JSON, REEL_VIDEO, REEL_ENTRY, LOCAL_DATE, PLANNER_URL, POST_ID, ERROR_REASON). SLOT_JSON is a JSON object with scheduled, taken and bestByDay. TRIAL_SLOT_JSON has scheduled, bestByDay, trialCopy:true and notBefore set to the regular reel day. Never use cd, pipes, redirects or compound commands. Quote substituted arguments safely as single shell arguments.

1. Run:
${command("scan")}
If ready is empty, reply "Nothing to publish", mention problems briefly and STOP. Make no connector calls.
2. Call Metricool getScheduledPosts once for brandId ${c.metricool.blogId}, timezone ${c.timezone}, fromDate now through 21 days from now. Build scheduled as objects {day,hour,minute,type} in that timezone. Include EVERY network and drafts. Use REEL only for a regular Instagram reel, TRIAL_REEL for a trial, STORY for an Instagram story and POST for everything else. Stories do not block feed slots. Build taken from non draft regular Instagram reel dates, or trial dates too when scan says trial true. Exclude draft reels from taken; represent them as POST in scheduled so their time still blocks.
3. Call getBestTimeToPostByNetwork once for brandId ${c.metricool.blogId}, socialNetwork instagram, timezone ${c.timezone}, the same dates. Build bestByDay with dates and hours ranked best first.
4. For EACH ready reel in order:
a. Run:
${command("slot", "'SLOT_JSON'")}
The command also accounts for the local posts log and daily photo post times. If null, report no clear time and stop.
b. Run:
${command("serve", "'REEL_VIDEO'")}
It returns a temporary https video link. It may take two minutes.
c. Call createScheduledPost with blogId ${c.metricool.blogId}, date as dayTHH:00:00 plus the UTC offset of ${c.timezone} on that day, and info JSON:
{"autoPublish":true,"draft":<reel.draft>,"descendants":[],"firstCommentText":"","hasNotReadNotes":false,"media":[<temporary link>],"mediaAltText":[],"videoCoverMilliseconds":<reel.coverMs>,"providers":<one {"network":name} per reel.providers>,"publicationDate":{"dateTime":<dayTHH:00:00>,"timezone":"${c.timezone}"},"shortener":false,"smartLinkData":{"ids":[]},"text":<reel.text exactly>,"instagramData":{"type":<reel.instagramType>,"showReelOnFeed":true,"isAiGenerated":<reel.isAiGenerated>}}
If providers includes tiktok, add tiktokData from reel.tiktok exactly. Do not change the caption or add a call to action. Never retry a create call with an uncertain result. Only count success when the response media URL starts with https://static.metricool.com.
d. Always run this, including after a failure:
${command("stop")}
e. After success add this slot to scheduled and its day to taken for a non draft regular reel. If reel.trialCopy is true, create ONE separate Instagram TRIAL_REEL with the same text, cover, AI flag and draft setting, using the static.metricool.com media URL from the first response. First choose its time with:
${command("slot", "'TRIAL_SLOT_JSON'")}
Use only Instagram for the trial copy, without tiktokData. Add its time to scheduled, never taken. If the copy fails or no slot is available, retain the regular post and record the reason. Do not retry the regular post.
f. For a confirmed regular or trial only post, run:
${command("done", "'REEL_ENTRY' --date 'LOCAL_DATE' --planner 'PLANNER_URL' --id 'POST_ID'")}
When a trial copy succeeded append --trial-copy '<local dayTHH:00:00>' --trial-planner '<plannerUrl>' --trial-id '<post id>'. When it failed append --trial-copy-failed '<exact error>' and --trial-date '<chosen local date if available>'. These are arguments to that same single command. Draft status comes from scan and is preserved by done.
If the first post failed, or its media was not confirmed on static.metricool.com, run:
${command("fail", "'REEL_ENTRY' --why 'ERROR_REASON'")}
Continue to the next reel. Never call done on an unconfirmed post.
5. Reply with one short line per reel: scheduled or draft, day and time, networks, trial result or failure.

Never post anything absent from scan, change other posts, create more than one trial copy, use createScheduledPostForReview, send messages, or use networks absent from scan. Keep this Mac on and the Claude app open.
`;
}

export function writeRoutine(studio, { home = os.homedir(), ...options } = {}) {
  const prompt = routinePrompt(studio, options);
  const file = path.join(studio.paths.state, "reel-publish-routine.md");
  const skill = path.join(home, ".claude", "scheduled-tasks", "reel-publish", "SKILL.md");
  for (const target of [file, skill]) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, prompt); }
  return { file, skill, setup: `Create a scheduled task using create_scheduled_task with taskId reel-publish, cron 45 7-20 * * *, description "Schedule approved reels from Publish", and the complete prompt from ${quote(file)}. Then use ToolSearch to find the Metricool tools getScheduledPosts, getBestTimeToPostByNetwork and createScheduledPost, and add their exact full tool names to permissions.allow in ${quote(path.join(home, ".claude", "settings.json"))}, keeping everything else in that file, so later runs do not stop to ask. Then list scheduled tasks, confirm reel-publish is enabled, and tell me in one line that the routine is on.` };
}

/** Install preparation only. The desktop app itself must register the task. */
export function openRoutineSetup(studio, { run = spawnSync, home = os.homedir(), appExists = fs.existsSync("/Applications/Claude.app") } = {}) {
  const routine = writeRoutine(studio, { home });
  const notes = [];
  if (!allowPublishCommands({ home })) notes.push("Could not update your Claude settings file, so Claude may ask before it posts. Answer yes when it does.");
  if (!appExists) {
    const r = run("brew", ["install", "--cask", "claude"], { stdio: "inherit" });
    if (r.status !== 0) notes.push("Install the Claude app from claude.ai/download, then open it.");
  }
  const copied = run("pbcopy", [], { input: routine.setup, encoding: "utf8" });
  run("open", ["-a", "Claude"]);
  notes.push(copied.status === 0 ? "The setup prompt is copied. Open the Code tab in the Claude app, paste, then press Return." : `Open the Code tab in the Claude app and paste this request: ${routine.setup}`);
  notes.push("Claude sets up your posting routine. Answer yes to its questions. When it says the routine is on, you are done. Keep your Mac on and the Claude app open.");
  return notes;
}

export function kitFolders(studio, { home = os.homedir() } = {}) {
  const desk = path.join(home, "Desktop", "Reels");
  fs.mkdirSync(desk, { recursive: true });
  const old = path.join(home, "Desktop", "Content Studio");
  try { if (fs.lstatSync(old).isSymbolicLink()) fs.unlinkSync(old); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const raw = studio.paths.rawReels;
  if (studio.config.reels.rawIntake === false && fs.existsSync(raw)) {
    const target = path.join(home, "Reels", "raw-broll");
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(raw)) {
      const from = path.join(raw, name);
      if (!/\.(mov|mp4|m4v)$/i.test(name) || !fs.statSync(from).isFile()) continue;
      let to = path.join(target, name);
      for (let k = 2; fs.existsSync(to); k++) to = path.join(target, `${path.parse(name).name} (${k})${path.extname(name)}`);
      fs.renameSync(from, to);
    }
    if (!fs.readdirSync(raw).length) fs.rmdirSync(raw);
  }
  const status = path.join(studio.paths.root, "STATUS.txt");
  if (!fs.existsSync(status)) fs.writeFileSync(status, "Ready. Keep your Mac on and the Claude app open.\n");
  for (const [name, target] of [["Publish", studio.paths.publish], ["Photos", photosDir(studio.config, studio.paths)], ["Made", studio.paths.made], ["STATUS.txt", status]]) {
    const link = path.join(desk, name);
    try { fs.lstatSync(link); } catch (e) { if (e.code !== "ENOENT") throw e; fs.symlinkSync(target, link); }
  }
}
