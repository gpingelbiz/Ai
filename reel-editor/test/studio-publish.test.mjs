import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initStudio, loadStudio, readPosts } from "../src/content-studio.mjs";
import { studioAgents, installAgents } from "../src/studio-cli.mjs";
import { scanPublish, publishSlot, finishPublish, failPublish } from "../src/studio-publish.mjs";
import { kitFolders, routinePrompt, writeRoutine, openRoutineSetup } from "../src/studio-routine.mjs";
import { studioHealth } from "../src/studio-health.mjs";
import { PKG_ROOT } from "../src/util.mjs";
const now = new Date("2026-11-08T06:00Z");
function fixture(t, config = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "routine-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, "Content Studio");
  initStudio(root, { brandFrom: path.join(PKG_ROOT, "examples/content-studio/brand"), config: { client: "Example", timezone: "UTC", slots: [], metricool: { blogId: "42", connector: "Test", networks: ["instagram", "facebook"] }, reels: { rawIntake: false, publisher: "claude", trial: "both" }, ...config } });
  return { home, ...loadStudio(root) };
}
function reel(s, name = "clip", caption = "A useful caption.", meta = {}) {
  const dir = path.join(s.paths.publish, name); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "clip.mp4"), "v");
  fs.writeFileSync(path.join(dir, "caption.txt"), caption);
  fs.writeFileSync(path.join(dir, ".reel.json"), JSON.stringify(meta));
  fs.utimesSync(path.join(dir, "clip.mp4"), new Date(0), new Date(0));
  return dir;
}
test("quiet scan returns ready empty, with no connector or child process", (t) => {
  const s = fixture(t);
  assert.deepEqual(scanPublish(s).ready, []);
  assert.equal(fs.existsSync(s.paths.rawReels), false);
});
test("scan uses client policy, prefix, networks, trial and all draft gates", (t) => {
  const s = fixture(t, { publish: { mode: "schedule", captionPrefix: "Client prefix" } });
  reel(s, "normal", "Ghost P&L GHOST and his wife.");
  reel(s, "missing", ""); reel(s, "hold", "Caption", { textcheck: { verdict: "hold", notes: ["Check wording"] } });
  reel(s, "preflight", "Caption", { preflight: "fail" });
  const ready = scanPublish(s).ready;
  const normal = ready.find((r) => r.entry === "normal");
  assert.equal(normal.draft, false); assert.match(normal.text, /^Client prefix/);
  assert.deepEqual(normal.providers, ["instagram", "facebook"]); assert.equal(normal.blogId, "42"); assert.equal(normal.timezone, "UTC"); assert.equal(normal.trialCopy, true);
  for (const name of ["missing", "hold", "preflight"]) assert.equal(ready.find((r) => r.entry === name).draft, true);
  s.config.publish.mode = "draft"; assert.equal(scanPublish(s).ready.every((r) => r.draft), true);
  s.config.publish.mode = "off"; assert.deepEqual(scanPublish(s).ready, []);
});
test("done files to Made and logs normal and trial records; fail keeps the reel recoverable", (t) => {
  const s = fixture(t); const dir = reel(s);
  failPublish(s, "clip", "Network unavailable");
  assert.equal(fs.existsSync(dir), false);
  assert.match(fs.readFileSync(path.join(s.paths.publish, "Not posted", "clip", "Why it did not post.txt"), "utf8"), /Network unavailable/);
  assert.deepEqual(scanPublish(s, { settle: 0 }).ready, []);
  reel(s);
  const r = finishPublish(s, "clip", { date: "2026-11-08T10:00:00", planner: "https://example.test/1", id: "1", trialCopy: "2026-11-08T12:00:00", trialPlanner: "https://example.test/2" });
  assert.equal(fs.existsSync(dir), false); assert.equal(fs.existsSync(r.files[0]), true);
  const posts = readPosts(s.paths); assert.equal(posts.length, 2); assert.equal(posts[1].format, "trial"); assert.equal(posts[0].status, "scheduled");
  assert.match(fs.readFileSync(path.join(r.made, "Scheduled.txt"), "utf8"), /10:00/);
});
test("done preserves the draft gate even without a draft argument", (t) => {
  const s = fixture(t); reel(s, "clip", "");
  assert.equal(finishPublish(s, "clip", { date: "2026-11-08T10:00:00" }).status, "draft");
});
test("slots enforce regular day and two hours, include local daily slots, trial is independent", (t) => {
  const s = fixture(t, { slots: [{ time: "10:00", format: "static" }] });
  const input = { taken: ["2026-11-08"], busy: { "2026-11-09": [12] }, bestByDay: { "2026-11-09": [10, 12, 14] } };
  assert.deepEqual(publishSlot(s, input, { now }), { day: "2026-11-09", hour: 14 });
  const trial = publishSlot(s, { ...input, trialCopy: true, notBefore: "2026-11-08" }, { now });
  assert.equal(trial.day, "2026-11-08");
});
test("routine writes both copies, no personal text or shell compounds; only app creates task", (t) => {
  const s = fixture(t);
  const text = routinePrompt(s, { node: "/absolute/node", bin: "/absolute/reel.mjs" });
  assert.doesNotMatch(text, /Greg|Pingel|Phoenix|officialgregpingel|Ghost P&L|GHOST|wife/);
  for (const line of text.split("\n").filter((l) => l.startsWith("/absolute/node "))) {
    assert.doesNotMatch(line, /&&|\|\||[|<>]|\bcd\b/); assert.match(line, /studio (publish|heartbeat)/);
  }
  assert.match(text, /blogId 42, timezone UTC/);
  const result = writeRoutine(s, { home: s.home });
  assert.equal(fs.readFileSync(result.file, "utf8"), fs.readFileSync(result.skill, "utf8"));
  assert.match(result.setup, /create_scheduled_task[\s\S]*45 7-20 \* \* \*[\s\S]*List scheduled tasks[\s\S]*enabled/);
  const calls = [];
  const notes = openRoutineSetup(s, { home: s.home, appExists: false, run: (cmd, args, options) => { calls.push({ cmd, args, options }); return { status: cmd === "brew" ? 1 : 0 }; } });
  assert.deepEqual(calls.map((r) => r.cmd), ["open", "pbcopy"]);
  assert.deepEqual(calls[0].args, ["https://claude.com/download"]);
  assert.match(notes.join(" "), /claude.com\/download[\s\S]*Code tab[\s\S]*Posting setup is pending/);
  assert.doesNotMatch(text + result.setup, /bypassPermissions|disableAutoMode/);
});
test("kit migration is repeatable, avoids overwrite, leaves Done and real Desktop folder alone", (t) => {
  const s = fixture(t); fs.mkdirSync(s.paths.rawReels); fs.mkdirSync(path.join(s.paths.rawReels, "Done"));
  fs.writeFileSync(path.join(s.paths.rawReels, "clip.mov"), "new");
  const target = path.join(s.home, "Reels/raw-broll"); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, "clip.mov"), "old");
  fs.mkdirSync(path.join(s.home, "Desktop")); fs.symlinkSync(s.paths.root, path.join(s.home, "Desktop/Content Studio"));
  kitFolders(s, { home: s.home }); kitFolders(s, { home: s.home });
  assert.equal(fs.existsSync(path.join(s.home, "Desktop/Content Studio")), false);
  assert.equal(fs.readFileSync(path.join(target, "clip.mov"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(target, "clip (2).mov"), "utf8"), "new");
  assert.equal(fs.existsSync(path.join(s.paths.rawReels, "Done")), true);
  for (const name of ["Photos", "Publish", "Made", "STATUS.txt"]) assert.equal(fs.lstatSync(path.join(s.home, "Desktop/Reels", name)).isSymbolicLink(), true);
  fs.mkdirSync(path.join(s.home, "Desktop/Content Studio")); kitFolders(s, { home: s.home });
  assert.equal(fs.statSync(path.join(s.home, "Desktop/Content Studio")).isDirectory(), true);
  fs.rmdirSync(path.join(s.paths.rawReels, "Done")); kitFolders(s, { home: s.home }); assert.equal(fs.existsSync(s.paths.rawReels), false);
});
test("kit agents omit reels, legacy studios keep reels and raw intake", (t) => {
  const s = fixture(t); assert.deepEqual(studioAgents(s.paths.root).map((a) => a.label.split(".")[3]), ["daily", "health"]);
  initStudio(s.paths.root, { config: { reels: { rawIntake: true, publisher: "legacy" } } });
  assert.equal(fs.existsSync(s.paths.rawReels), true); assert.equal(studioAgents(s.paths.root).length, 3);
});
test("health alerts after three hours in Publish and ignores gated raw intake", async (t) => {
  const s = fixture(t, { publish: { mode: "off" } }); reel(s);
  fs.mkdirSync(s.paths.rawReels); fs.writeFileSync(path.join(s.paths.rawReels, "old.mov"), "v"); fs.utimesSync(path.join(s.paths.rawReels, "old.mov"), new Date(0), new Date(0));
  // ctime is the real arrival time; advance from it rather than a fixed calendar date.
  const arrival = fs.statSync(path.join(s.paths.publish, "clip")).ctimeMs;
  const healthNow = new Date(arrival + 4 * 3600000);
  fs.writeFileSync(path.join(s.paths.state, "daily.json"), JSON.stringify({ day: healthNow.toISOString().slice(0, 10), completed: true }));
  const notices = [];
  const result = await studioHealth(s.paths.root, { now: healthNow, deps: { claudeConnected: () => true, notify: (...args) => notices.push(args) } });
  assert.deepEqual(result.issues, ["Open the Claude app; it has to be open for reels to post"]);
  assert.equal(notices.length, 1); assert.match(fs.readFileSync(path.join(s.paths.root, "STATUS.txt"), "utf8"), /Open the Claude app/);
});


test("agent rerun unloads and removes an old kit reels agent while retaining daily and health", (t) => {
  const s = fixture(t);
  const dir = path.join(s.home, "Library/LaunchAgents"); fs.mkdirSync(dir, { recursive: true });
  const label = "com.pingel.content-studio.reels.content-studio";
  fs.writeFileSync(path.join(dir, `${label}.plist`), "old");
  const calls = [];
  const run = (cmd, args) => { calls.push({ cmd, args }); return { status: 0 }; };
  for (let k = 0; k < 2; k++) installAgents(s.paths.root, { home: s.home, run });
  assert.equal(fs.existsSync(path.join(dir, `${label}.plist`)), false);
  assert.ok(calls.some((c) => c.args[0] === "bootout" && c.args[1].endsWith(label)));
  assert.equal(calls.some((c) => c.args[0] === "bootstrap" && c.args[2].includes(".reels.")), false);
  assert.equal(fs.readdirSync(dir).length, 2);
});

test("filing a Clips folder leaves its other videos ready for a later scan", (t) => {
  const s = fixture(t); const dir = reel(s, "Clips");
  fs.writeFileSync(path.join(dir, "second.mp4"), "v"); fs.utimesSync(path.join(dir, "second.mp4"), new Date(0), new Date(0));
  finishPublish(s, "Clips", { date: "2026-11-08T10:00:00" });
  assert.equal(scanPublish(s).ready[0].video, path.join(dir, "second.mp4"));
});

test("allow rule: covers the routine's commands, keeps the settings file, leaves a broken file alone", async () => {
  const { allowPublishCommands, routinePrompt: prompt } = await import("../src/studio-routine.mjs");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "allow-"));
  const file = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ model: "x", permissions: { allow: ["Read"], deny: ["Bash(rm *)"] } }));
  assert.equal(allowPublishCommands({ home, node: "/a/node", bin: "/b/reel.mjs" }), true);
  assert.equal(allowPublishCommands({ home, node: "/a/node", bin: "/b/reel.mjs" }), true);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.model, "x");
  assert.deepEqual(saved.permissions.deny, ["Bash(rm *)"]);
  assert.deepEqual(saved.permissions.allow, ["Read", "Bash(/a/node /b/reel.mjs studio publish *)"]);
  assert.doesNotMatch(JSON.stringify(saved), /bypassPermissions|disableAutoMode/);
  fs.writeFileSync(file, "{broken");
  assert.equal(allowPublishCommands({ home }), false);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});

test("health: a reel just dragged into Publish is not stuck, whatever age its video file is", async () => {
  const { stuckDrops } = await import("../src/studio-health.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stuck-"));
  fs.mkdirSync(path.join(dir, "reel"));
  const video = path.join(dir, "reel", "a.mp4");
  fs.writeFileSync(video, "x");
  const old = new Date(Date.now() - 5 * 86400000);
  fs.utimesSync(video, old, old);
  const opts = { maxAge: 3 * 3600000, byArrival: true };
  assert.deepEqual(stuckDrops([dir], opts), []);
  assert.equal(stuckDrops([dir], { ...opts, now: Date.now() + 4 * 3600000 }).length, 1);
});
