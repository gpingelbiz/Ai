import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { PKG_ROOT, writeJSON } from "./util.mjs";
import { photosDir, studioPaths } from "./content-studio.mjs";
import { ROUTINE_TASKS, routineSetupFile, checkHeartbeats } from "./heartbeat.mjs";
import { isClientMode } from "./client-mode.mjs";

const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);
/** Every routine command starts with this, so one allow rule covers them all. */
const publishPrefix = ({ node = process.execPath, bin = path.join(PKG_ROOT, "bin", "reel.mjs") } = {}) => `${quote(node)} ${quote(bin)} studio publish`;
const studioPrefix = (options) => publishPrefix(options).replace(/ publish$/, "");
const heartbeatLine = (studio, options, action, task) => `${studioPrefix(options)} heartbeat ${action} ${task} --studio ${quote(studio.paths.root)}`;
const heartbeatStart = (studio, options, task) => `First run this single Bash command, before any other work:
${heartbeatLine(studio, options, "start", task)}
This command checks ${quote(path.join(studio.paths.root, ".check-run"))} to choose a check run.
Read its JSON result. If checkRun is true, follow ONLY the CHECK RUN steps below and then STOP. If this command fails or its result is unclear, STOP without making or posting anything.

CHECK RUN
Use ToolSearch to find the Metricool tools ${task === "reel-publish" ? "getScheduledPosts, getBestTimeToPostByNetwork and createScheduledPost" : "getScheduledPosts and createScheduledPost"}. Find the tools only; do not call them. If discovery is unavailable, fail this check with a short reason and STOP.
Run this command to read this client's brand and scan the photo, Publish and Made folders:
${heartbeatLine(studio, options, "discover", task)}
If it fails, fail this check and STOP. Do not run any normal steps. Do not create, make, render, serve, upload, schedule or post anything. Do not call Metricool, Runway or ElevenLabs, even for a draft. After successful discovery run:
${heartbeatLine(studio, options, "done", task)}
Reply "Check complete" and STOP. Never continue from a check run into the normal steps.
END CHECK RUN

NORMAL RUN
On every exit, even when nothing is ready, run the final heartbeat command below. If any step fails, use heartbeat fail instead of done with a short plain reason such as 'Posting needs attention'. Never include keys or raw tool responses in the reason. Never retry a write with an unknown outcome; hold it for a person.
`;
const heartbeatEnd = (studio, options, task) => `Always finish the run, including when there is nothing to post, with:
${heartbeatLine(studio, options, "done", task)}
If any step failed, use this instead, replacing only SHORT_REASON with a short reason:
${heartbeatLine(studio, options, "fail", `${task} 'SHORT_REASON'`)}
`;

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

${heartbeatStart(studio, options, "reel-publish")}
Dropping a finished reel into Desktop/Reels/Publish is approval to post it. Schedule ALL ready reels through the Metricool connector in this run. Do nothing else.
Fixed facts: blogId ${c.metricool.blogId}, timezone ${c.timezone}. Use the providers, trial setting, text, cover and AI flag returned by scan. One regular reel per day and at least two hours from every other post. Trial copies never take a regular reel day. A draft stays a draft.

Use each command below as one verbatim Bash command, substituting only the uppercase argument placeholders (SLOT_JSON, TRIAL_SLOT_JSON, REEL_ENTRY, LOCAL_DATE, OWNER, PLANNER_URL, POST_ID, ERROR_REASON). SLOT_JSON is a JSON object with scheduled, taken and bestByDay. TRIAL_SLOT_JSON has scheduled, bestByDay, trialCopy:true and notBefore set to the regular reel day. Never use cd, pipes, redirects or compound commands. Quote substituted arguments safely as single shell arguments.

1. Run:
${command("scan")}
If ready is empty, reply "Nothing to publish", mention problems briefly, write the final heartbeat and STOP. Make no connector calls.
2. Call Metricool getScheduledPosts once for brandId ${c.metricool.blogId}, timezone ${c.timezone}, fromDate now through 21 days from now. Build scheduled as objects {day,hour,minute,type} in that timezone. Include EVERY network and drafts. Use REEL only for a regular Instagram reel, TRIAL_REEL for a trial, STORY for an Instagram story and POST for everything else. Stories do not block feed slots. Build taken from non draft regular Instagram reel dates, or trial dates too when scan says trial true. Exclude draft reels from taken; represent them as POST in scheduled so their time still blocks.
3. Call getBestTimeToPostByNetwork once for brandId ${c.metricool.blogId}, socialNetwork instagram, timezone ${c.timezone}, the same dates. Build bestByDay with dates and hours ranked best first.
4. For EACH ready reel in order:
a. Run:
${command("slot", "'SLOT_JSON'")}
The command also accounts for the local posts log and daily photo post times. If null, report no clear time, write the final heartbeat and stop.
b. Claim the reel for this run BEFORE anything is posted, with LOCAL_DATE the chosen local dayTHH:00:
${command("claim", "'REEL_ENTRY' --date 'LOCAL_DATE'")}
It returns an owner: use it as OWNER in every command below for this reel. If claim says the reel may already be scheduled, or that it is held, skip this reel, say so in your reply and continue with the next one. Never work around a claim.
Then run:
${command("serve", "'REEL_ENTRY' --owner 'OWNER'")}
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
${command("done", "'REEL_ENTRY' --owner 'OWNER' --date 'LOCAL_DATE' --planner 'PLANNER_URL' --id 'POST_ID'")}
When a trial copy succeeded append --trial-copy '<local dayTHH:00:00>' --trial-planner '<plannerUrl>' --trial-id '<post id>'. When it failed append --trial-copy-failed '<exact error>' and --trial-date '<chosen local date if available>'. These are arguments to that same single command. Draft status comes from scan and is preserved by done.
If the first post failed, or its media was not confirmed on static.metricool.com, run:
${command("fail", "'REEL_ENTRY' --owner 'OWNER' --why 'ERROR_REASON'")}
Continue to the next reel. Never call done on an unconfirmed post. If you cannot tell whether the create worked, run neither done nor fail: the claim keeps the reel held for a person to check, which is what we want. Never run publish release; only a person does that.
5. Reply with one short line per reel: scheduled or draft, day and time, networks, trial result or failure.

Never post anything absent from scan, change other posts, create more than one trial copy, use createScheduledPostForReview, send messages, or use networks absent from scan. Keep this Mac on and the Claude app open.
${heartbeatEnd(studio, options, "reel-publish")}
`;
}

export function dailyPostsPrompt(studio, options = {}) {
  const c = studio.config;
  const command = (action, args = "") => `${publishPrefix(options).replace(/ publish$/, " posts")} ${action}${args ? ` ${args}` : ""} --studio ${quote(studio.paths.root)}`;
  return `---
name: daily-posts
description: Make and schedule carousels and static posts at 6 AM and noon.
---
${heartbeatStart(studio, options, "daily-posts")}
Make and schedule only the posts returned by ready. Fixed facts: blogId ${c.metricool.blogId}, timezone ${c.timezone}, daysAhead ${c.daysAhead}. Keep this Mac on and the Claude app open.
Use each command below verbatim as one Bash command. Substitute only SCHEDULED_JSON, POST_ID, LOCAL_DATE, PLANNER_URL, METRICOOL_ID, ERROR_REASON. Quote each safely as a single shell argument. Never use cd, pipes, redirects or compound commands.
1. Run:
${command("scan")}
If work is false write the final heartbeat and STOP with no connector calls.
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
Never touch other posts, use createScheduledPostForReview, send messages, or change the supplied copy. In normal runs only use Bash and the Metricool tools getScheduledPosts and createScheduledPost.
${heartbeatEnd(studio, options, "daily-posts")}
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

const setupProblem = "Open Claude, then Code, and paste the setup request again.";
const readRecord = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const runProblem = (id) => `Open Claude, then Code, then Scheduled, and press Run now on ${id}`;
const conflictProblem = (id) => `${id} already uses another folder. Open Claude, then Code, then Scheduled, and check that task before setting up this client.`;

/** Unknown task folders are left alone, including old tasks with no ownership record. */
function checkTaskFolder(skill, root, id) {
  const dir = path.dirname(skill);
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(conflictProblem(id));
  } catch (e) { if (e.code === "ENOENT") return; throw e; }
  for (const file of [skill, path.join(dir, "reel-owner.json")]) {
    try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error(conflictProblem(id)); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  const owner = readRecord(path.join(dir, "reel-owner.json"));
  if (owner) {
    if (owner.folder === root) return;
    throw new Error(conflictProblem(id));
  }
  // Older Reel tasks already name their folder on every command line.
  let text = "";
  try { text = fs.readFileSync(skill, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const commands = text.split("\n").filter((line) => / studio (publish|posts) /.test(line));
  if (commands.length && commands.every((line) => line.endsWith(` --studio ${quote(root)}`))) return;
  throw new Error(conflictProblem(id));
}

export function writeRoutine(studio, { home = os.homedir(), now = new Date(), ...options } = {}) {
  const root = path.resolve(studio.paths.root);
  const tasks = ROUTINE_TASKS.filter((t) => t.id === "reel-publish" || studio.config.daily.publisher === "claude" || isClientMode());
  const outputs = tasks.map(({ id }) => ({
    id,
    file: path.join(studio.paths.state, `${id}-routine.md`),
    skill: path.join(home, ".claude", "scheduled-tasks", id, "SKILL.md"),
  }));
  // Check every task before writing either copy or changing the previous setup nonce.
  for (const out of outputs) checkTaskFolder(out.skill, root, out.id);
  const nonce = randomUUID();
  for (const out of outputs) {
    const prompt = out.id === "reel-publish" ? routinePrompt(studio, options) : dailyPostsPrompt(studio, options);
    for (const target of [out.file, out.skill]) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, prompt);
    }
    writeJSON(path.join(path.dirname(out.skill), "reel-owner.json"), { folder: root });
  }
  writeJSON(routineSetupFile(root), { nonce, at: now.toISOString(), folder: root, tasks });
  // The first scheduled run is safe even if it starts before the person presses Run now.
  checkHeartbeats(root, { now });
  const [publish, daily = null] = outputs;
  const receipt = `${studioPrefix(options)} routine-receipt --nonce ${quote(nonce)} --tasks 'TASKS_JSON' --studio ${quote(root)}`;
  const setup = `First list scheduled tasks before creating or updating anything. Discover the scheduled task tools if needed. Never touch other tasks. Only this client's tasks ${tasks.map((t) => t.id).join(" and ")} may be changed.
Check the actual working folder of each existing task with either name. If it differs from ${quote(root)}, or you cannot confirm its folder, STOP and report a conflict. Do not change, delete or replace that task or its prompt folder.
For each of this client's tasks, update it if it exists or create it using create_scheduled_task if it does not. Make each an enabled LOCAL task, never a cloud task, with working folder ${quote(root)}:
${tasks.map((t) => `taskId ${t.id}, cron ${t.schedule}, complete prompt from ${quote(outputs.find((out) => out.id === t.id).file)}.`).join("\n")}
Then use ToolSearch to find the Metricool tools getScheduledPosts, getBestTimeToPostByNetwork and createScheduledPost, and add their exact full tool names to permissions.allow in ${quote(path.join(home, ".claude", "settings.json"))}, keeping everything else in that file, so later runs do not stop to ask.
List scheduled tasks again. Read their actual enabled state, cron schedule and working folder from this second list. Confirm ${tasks.length === 2 ? "both tasks run" : "the task runs"} locally. Do not guess these values from the prompt files. If a task is missing, uses a different folder or is not local, STOP and report the problem.
Then run this one Bash command, replacing only TASKS_JSON with the actual JSON array from that list, safely quoted as one shell argument:
${receipt}
Each array entry has exactly {"id": taskId, "enabled": true or false, "schedule": cron string, "folder": absolute working folder}. Include only this client's tasks. Never include keys, prompts or other task data.
Tell me to open Claude, then Code, then Scheduled, and press Run now once on each task. The check only finds tools, reads the brand and scans folders. Posting stays pending until ${tasks.length === 2 ? "both checks finish" : "the check finishes"}. Keep this Mac on and the Claude app open.`;
  return { file: publish.file, skill: publish.skill, daily, nonce, setup };
}

/** The app supplies observed task data, never its prompt or credentials. */
export function writeRoutineReceipt(studioRoot, { nonce, tasks, now = new Date() } = {}) {
  const root = studioPaths(studioRoot).root;
  const setup = readRecord(routineSetupFile(root));
  if (!setup?.nonce || nonce !== setup.nonce || !Array.isArray(setup.tasks) || !setup.tasks.length || setup.tasks.some((t) => !ROUTINE_TASKS.some((expected) => expected.id === t?.id))) throw new Error(setupProblem);
  if (!Array.isArray(tasks) || tasks.length !== setup.tasks.length || setup.tasks.some(({ id }) => tasks.filter((t) => t?.id === id).length !== 1)) throw new Error(setupProblem);
  const clean = tasks.map((t) => {
    if (typeof t.enabled !== "boolean" || typeof t.schedule !== "string" || typeof t.folder !== "string" || !path.isAbsolute(t.folder)) throw new Error(setupProblem);
    return { id: t.id, enabled: t.enabled, schedule: t.schedule, folder: t.folder };
  });
  const receipt = { nonce, at: now.toISOString(), tasks: clean };
  writeJSON(path.join(root, "routines.json"), receipt);
  return receipt;
}

export function routineReceiptCommand(args) {
  const { values, positionals } = parseArgs({ args, options: { nonce: { type: "string" }, tasks: { type: "string" }, studio: { type: "string" } }, allowPositionals: true, strict: true });
  let tasks;
  try { tasks = JSON.parse(values.tasks); } catch { throw new Error(setupProblem); }
  if (positionals.length) throw new Error(setupProblem);
  const receipt = writeRoutineReceipt(values.studio, { nonce: values.nonce, tasks });
  console.log("Routine details saved. Run both checks in Claude.");
  return receipt;
}

export function verifyRoutines(studioRoot) {
  const root = studioPaths(studioRoot).root;
  const setup = readRecord(routineSetupFile(root));
  const receipt = readRecord(path.join(root, "routines.json"));
  const tasks = Array.isArray(receipt?.tasks) ? receipt.tasks : [];
  const result = (problem) => ({ ok: !problem, tasks, problem });
  if (!setup?.nonce || setup.folder !== root || !Array.isArray(setup.tasks) || setup.tasks.some((t) => !ROUTINE_TASKS.some((expected) => expected.id === t?.id)) || receipt?.nonce !== setup.nonce || !Number.isFinite(Date.parse(receipt?.at)) || !Number.isFinite(Date.parse(setup.at)) || Date.parse(receipt.at) < Date.parse(setup.at)) return result(setupProblem);
  const beats = readRecord(path.join(root, "heartbeat.json"));
  const checkFile = path.join(root, ".check-run");
  const check = readRecord(checkFile);
  if (fs.existsSync(checkFile) && (!check?.id || check.nonce !== setup.nonce)) return result(setupProblem);
  // Legacy studios keep their original single task. Client setups always require both.
  const expected = isClientMode() ? ROUTINE_TASKS : ROUTINE_TASKS.filter((t) => setup.tasks?.some((x) => x.id === t.id));
  if (!expected.length || tasks.length !== expected.length) return result(setupProblem);
  for (const { id, schedule } of expected) {
    const matches = tasks.filter((t) => t?.id === id);
    if (matches.length !== 1) return result(setupProblem);
    const task = matches[0];
    if (task.folder !== root) return result(`Open Claude, then Code, then Scheduled, and choose ${root} as the folder for ${id}.`);
    if (task.enabled !== true) return result(`Open Claude, then Code, then Scheduled, and turn on ${id}.`);
    if (task.schedule !== schedule) return result(`Open Claude, then Code, then Scheduled, and paste the setup request again to fix the times for ${id}.`);
    const done = beats?.tasks?.[id]?.checkDone;
    if (done?.nonce !== setup.nonce || !done?.id || (check && done.id !== check.id) || !Number.isFinite(Date.parse(done?.at)) || Date.parse(done.at) < Date.parse(setup.at)) return result(runProblem(id));
  }
  return result(null);
}

export function allowHeartbeatCommands({ home = os.homedir(), ...options } = {}) {
  const file = path.join(home, ".claude", "settings.json");
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") return false; }
  const rule = `Bash(${studioPrefix(options)} heartbeat *)`;
  const allow = settings.permissions?.allow || [];
  if (!allow.includes(rule)) {
    settings.permissions = { ...settings.permissions, allow: [...allow, rule] };
    writeJSON(file, settings);
  }
  return true;
}

/** Install preparation only. The desktop app itself must register the task. */
export function openRoutineSetup(studio, { run = spawnSync, home = os.homedir(), appExists, ...options } = {}) {
  const routine = writeRoutine(studio, { home, ...options });
  const notes = [];
  if (!allowPublishCommands({ home, ...options })) notes.push("Could not update your Claude settings file, so Claude may ask before it posts. Answer yes when it does.");
  if (routine.daily && !allowPostsCommands({ home, ...options })) notes.push("Could not update your Claude settings file. Answer yes if Claude asks before making posts.");
  if (!allowHeartbeatCommands({ home, ...options })) notes.push("Answer yes if Claude asks to save a routine check.");
  const app = ["/Applications/Claude.app", path.join(home, "Applications", "Claude.app")].find((file) => fs.existsSync(file));
  const installed = appExists ?? !!app;
  if (!installed) {
    run("open", ["https://claude.com/download"]);
    notes.push("Download Claude from https://claude.com/download and drag Claude into Applications. Then open it and continue with the copied request.");
  }
  const copied = run("pbcopy", [], { input: routine.setup, encoding: "utf8" });
  if (installed) run("open", app ? [app] : ["-a", "Claude"]);
  notes.push(copied.status === 0 ? "The setup request is copied. Open the Code tab in Claude, paste, then press Return." : `Open the Code tab in Claude and paste this request: ${routine.setup}`);
  notes.push("Posting setup is pending. In Claude, open Code, then Scheduled, and press Run now on each task once. The checks do not post anything. Keep your Mac on and Claude open.");
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
