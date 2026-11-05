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

export function dailyPostsPrompt(studio, options = {}) {
  const c = studio.config;
  const command = (action, args = "") => `${publishPrefix(options).replace(/ publish$/, " posts")} ${action}${args ? ` ${args}` : ""} --studio ${quote(studio.paths.root)}`;
  return `---
name: daily-posts
description: Make and schedule carousels and static posts at 6 AM and noon.
---
Make and schedule only the posts returned by ready. Fixed facts: blogId ${c.metricool.blogId}, timezone ${c.timezone}, daysAhead ${c.daysAhead}. Keep this Mac on and the Claude app open.
Use each command below verbatim as one Bash command. Substitute only SCHEDULED_JSON, POST_ID, LOCAL_DATE, PLANNER_URL, METRICOOL_ID, ERROR_REASON. Quote each safely as a single shell argument. Never use cd, pipes, redirects or compound commands.
1. Run:
${command("scan")}
If work is false STOP with no connector calls.
2. Call Metricool getScheduledPosts once for brandId ${c.metricool.blogId}, timezone ${c.timezone}, fromDate today through daysAhead days from today. Include EVERY network and drafts. Map to {day,hour,minute,type} in that timezone. REEL means only regular Instagram reels, TRIAL_REEL means trials, STORY means Instagram stories, POST means everything else. Draft reels are POST. Include id and plannerUrl when available, and no post text. SCHEDULED_JSON is this complete array.
3. Run:
${command("make", "'SCHEDULED_JSON'")}
4. Run:
${command("wait")}
Repeat wait while running is true; each wait returns within two minutes. Making posts can take many minutes. Never start another make while one is running. If making failed, still process ready and finish.
5. Run:
${command("ready")}
6. For each ready post, oldest first, run this with the Bash timeout set to 600000:
${command("serve", "'POST_ID'")}
Call Metricool createScheduledPost once with blogId, date and info returned by ready, filling only info.media with the https URLs from serve in slide order. Keep mediaAltText, text, draft, AI flag, networks and all other info exactly. date includes the correct UTC offset for ${c.timezone} on that day. No best time lookup is needed. Never retry an uncertain create. Only success when the response media URL starts with https://static.metricool.com.
Always run this after a create, including a failure:
${command("stop")}
After a confirmed success run this, with LOCAL_DATE set to the date returned by ready:
${command("done", "'POST_ID' --date 'LOCAL_DATE' --planner 'PLANNER_URL' --id 'METRICOOL_ID'")}
If serve failed, so createScheduledPost was never called, run:
${command("fail", "'POST_ID' --why 'ERROR_REASON' --not-sent")}
If createScheduledPost failed or its media was unconfirmed run:
${command("fail", "'POST_ID' --why 'ERROR_REASON'")}
Never call done on an unconfirmed post. Continue to the next ready post. Never retry that post in this run.
7. Always run last, including after errors:
${command("finish")}
Reply with one short line per post: scheduled or draft, day and time, or failure.
Never touch other posts, use createScheduledPostForReview, send messages, or change the supplied copy. Only use Bash and the Metricool tools getScheduledPosts and createScheduledPost.
`;
}

export function allowPostsCommands({ home = os.homedir(), ...options } = {}) {
  const file = path.join(home, ".claude", "settings.json");
  let settings;
  try { settings = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") return false; settings = {}; }
  const rule = `Bash(${publishPrefix(options).replace(/ publish$/, " posts")} *)`;
  const allow = settings.permissions?.allow || [];
  if (!allow.includes(rule)) {
    settings.permissions = { ...settings.permissions, allow: [...allow, rule] };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2)); fs.renameSync(`${file}.tmp`, file);
  }
  return true;
}

export function writeRoutine(studio, { home = os.homedir(), ...options } = {}) {
  const prompt = routinePrompt(studio, options);
  const file = path.join(studio.paths.state, "reel-publish-routine.md");
  const skill = path.join(home, ".claude", "scheduled-tasks", "reel-publish", "SKILL.md");
  for (const target of [file, skill]) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, prompt); }
  let daily = null;
  if (studio.config.daily.publisher === "claude") {
    daily = { file: path.join(studio.paths.state, "daily-posts-routine.md"), skill: path.join(home, ".claude", "scheduled-tasks", "daily-posts", "SKILL.md") };
    for (const target of [daily.file, daily.skill]) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, dailyPostsPrompt(studio, options)); }
  }
  return { file, skill, daily, setup: `Create a scheduled task using create_scheduled_task with taskId reel-publish, cron 45 7-20 * * *, description "Schedule approved reels from Publish", and the complete prompt from ${quote(file)}. ${daily ? `Create a second scheduled task using create_scheduled_task with taskId daily-posts, cron 0 6,12 * * *, description "Make and schedule carousels and static posts", and the complete prompt from ${quote(daily.file)}. ` : ""}Then use ToolSearch to find the Metricool tools getScheduledPosts, getBestTimeToPostByNetwork and createScheduledPost, and add their exact full tool names to permissions.allow in ${quote(path.join(home, ".claude", "settings.json"))}, keeping everything else in that file, so later runs do not stop to ask. Then list scheduled tasks, confirm reel-publish${daily ? " and daily-posts are" : " is"} enabled, and tell me in one line that the routine${daily ? "s are" : " is"} on.` };
}

/** Install preparation only. The desktop app itself must register the task. */
export function openRoutineSetup(studio, { run = spawnSync, home = os.homedir(), appExists = fs.existsSync("/Applications/Claude.app") } = {}) {
  const routine = writeRoutine(studio, { home });
  const notes = [];
  if (!allowPublishCommands({ home })) notes.push("Could not update your Claude settings file, so Claude may ask before it posts. Answer yes when it does.");
  if (studio.config.daily.publisher === "claude" && !allowPostsCommands({ home })) notes.push("Could not update your Claude settings file. Answer yes if Claude asks before making posts.");
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
  fs.mkdirSync(path.join(studio.paths.root, "Filming packs"), { recursive: true });
  for (const [name, target] of [["Brand", studio.paths.brand], ["Filming packs", path.join(studio.paths.root, "Filming packs")], ["Publish", studio.paths.publish], ["Photos", photosDir(studio.config, studio.paths)], ["Made", studio.paths.made], ["STATUS.txt", status]]) {
    const link = path.join(desk, name);
    try { fs.lstatSync(link); } catch (e) { if (e.code !== "ENOENT") throw e; fs.symlinkSync(target, link); }
  }
}
