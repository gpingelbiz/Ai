import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initStudio, loadStudio } from "../src/content-studio.mjs";
import { PKG_ROOT } from "../src/util.mjs";
import { writeRoutine, routinePrompt, dailyPostsPrompt, writeRoutineReceipt, routineReceiptCommand, verifyRoutines, openRoutineSetup, allowHeartbeatCommands } from "../src/studio-routine.mjs";
import { ROUTINE_TASKS, routineSetupFile, heartbeat, heartbeatCommand, checkHeartbeats, discoverHeartbeat } from "../src/heartbeat.mjs";

const now = new Date("2026-11-08T12:00:00Z");
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "routine-proof-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, "Content Studio");
  initStudio(root, { brandFrom: path.join(PKG_ROOT, "examples/content-studio/brand"), config: { client: "Example", timezone: "UTC", metricool: { blogId: "42", connector: "Test" }, daily: { publisher: "claude" }, reels: { publisher: "claude" } } });
  const studio = { ...loadStudio(root), home };
  const setup = writeRoutine(studio, { home, now });
  const tasks = ROUTINE_TASKS.map((task) => ({ ...task, folder: root, enabled: true }));
  return { ...studio, setup, tasks };
}
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
function receipt(s, changes = {}) { return writeRoutineReceipt(s.paths.root, { nonce: s.setup.nonce, tasks: s.tasks, now, ...changes }); }
function complete(s, task) {
  assert.equal(heartbeat(s.paths.root, "start", task, { now }).checkRun, true);
  discoverHeartbeat(s.paths.root, task, { now });
  heartbeat(s.paths.root, "done", task, { now });
}

test("one paste lists first, limits ownership, uses local folders, lists again and writes an observed receipt", (t) => {
  const s = fixture(t);
  assert.match(s.setup.setup, /^First list scheduled tasks before creating or updating anything/);
  assert.match(s.setup.setup, /Never touch other tasks/);
  assert.match(s.setup.setup, /If it differs[\s\S]*STOP and report a conflict/);
  assert.match(s.setup.setup, /enabled LOCAL task, never a cloud task/);
  for (const task of ROUTINE_TASKS) assert.ok(s.setup.setup.includes(`taskId ${task.id}, cron ${task.schedule}`));
  assert.ok(s.setup.setup.indexOf("List scheduled tasks again") < s.setup.setup.indexOf("routine-receipt --nonce"));
  assert.ok(s.setup.setup.includes(s.setup.nonce));
  assert.ok(s.setup.setup.includes(s.paths.root));
  assert.match(s.setup.setup, /actual enabled state, cron schedule and working folder/);
  assert.match(s.setup.setup, /Posting stays pending until both checks finish/);
  assert.equal(read(routineSetupFile(s.paths.root)).nonce, s.setup.nonce);
});

test("receipt has only observed task fields and passes after both check runs", (t) => {
  const s = fixture(t);
  s.tasks[0].prompt = "must not be saved";
  const saved = receipt(s);
  assert.deepEqual(Object.keys(saved), ["nonce", "at", "tasks"]);
  assert.deepEqual(Object.keys(saved.tasks[0]), ["id", "enabled", "schedule", "folder"]);
  assert.deepEqual(read(path.join(s.paths.root, "routines.json")), saved);
  complete(s, "reel-publish");
  assert.equal(verifyRoutines(s.paths.root).problem, "Open Claude, then Code, then Scheduled, and press Run now on daily-posts");
  complete(s, "daily-posts");
  assert.deepEqual(verifyRoutines(s.paths.root), { ok: true, tasks: saved.tasks, problem: null });
  assert.equal(fs.existsSync(path.join(s.paths.root, ".check-run")), false);
  // Later empty normal runs retain the successful setup check.
  assert.equal(heartbeat(s.paths.root, "start", "daily-posts", { now }).checkRun, false);
  heartbeat(s.paths.root, "done", "daily-posts", { now });
  assert.equal(verifyRoutines(s.paths.root).ok, true);
});

test("wrong nonce, disabled task, wrong folder, wrong schedule and missing heartbeat give specific next steps", (t) => {
  const s = fixture(t);
  const file = path.join(s.paths.root, "routines.json");
  const paste = "Open Claude, then Code, and paste the setup request again.";
  assert.equal(verifyRoutines(s.paths.root).problem, paste);
  assert.throws(() => receipt(s, { nonce: "old" }), { message: paste });
  assert.equal(fs.existsSync(file), false);
  const saved = receipt(s);
  save(file, { ...saved, nonce: "old" });
  assert.equal(verifyRoutines(s.paths.root).problem, paste);
  receipt(s, { tasks: s.tasks.map((x) => ({ ...x, enabled: false })) });
  assert.equal(verifyRoutines(s.paths.root).problem, "Open Claude, then Code, then Scheduled, and turn on reel-publish.");
  receipt(s, { tasks: s.tasks.map((x) => ({ ...x, folder: path.join(s.home, "Someone else") })) });
  assert.equal(verifyRoutines(s.paths.root).problem, `Open Claude, then Code, then Scheduled, and choose ${s.paths.root} as the folder for reel-publish.`);
  receipt(s, { tasks: s.tasks.map((x) => ({ ...x, schedule: "* * * * *" })) });
  assert.equal(verifyRoutines(s.paths.root).problem, "Open Claude, then Code, then Scheduled, and paste the setup request again to fix the times for reel-publish.");
  receipt(s);
  assert.equal(verifyRoutines(s.paths.root).problem, "Open Claude, then Code, then Scheduled, and press Run now on reel-publish");
  heartbeat(s.paths.root, "start", "reel-publish", { now });
  assert.throws(() => heartbeat(s.paths.root, "done", "reel-publish", { now }), /Finish discovery/);
  heartbeat(s.paths.root, "fail", "reel-publish", { now, reason: "Tools unavailable" });
  assert.equal(verifyRoutines(s.paths.root).ok, false);
});

test("receipts reject missing or duplicate tasks and malformed input without replacing good data", (t) => {
  const s = fixture(t);
  receipt(s);
  const file = path.join(s.paths.root, "routines.json");
  const before = fs.readFileSync(file, "utf8");
  for (const tasks of [null, [], [s.tasks[0], s.tasks[0]], s.tasks.map((x) => ({ ...x, enabled: "true" })), s.tasks.map((x) => ({ ...x, folder: "~/Content Studio" }))]) assert.throws(() => receipt(s, { tasks }));
  assert.throws(() => routineReceiptCommand(["--nonce", s.setup.nonce, "--tasks", "{bad", "--studio", s.paths.root]));
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("a new setup invalidates both old receipts and old check proof", (t) => {
  const s = fixture(t);
  receipt(s); for (const task of ROUTINE_TASKS) complete(s, task.id);
  assert.equal(verifyRoutines(s.paths.root).ok, true);
  const next = writeRoutine(s, { home: s.home, now });
  assert.notEqual(next.nonce, s.setup.nonce);
  assert.equal(verifyRoutines(s.paths.root).ok, false);
  s.setup = next; receipt(s);
  assert.equal(verifyRoutines(s.paths.root).problem, "Open Claude, then Code, then Scheduled, and press Run now on reel-publish");
});

test("check prompts start before normal work and stop without create even with queued work", (t) => {
  const s = fixture(t);
  fs.writeFileSync(path.join(s.paths.publish, "ready.mp4"), "queued media");
  fs.writeFileSync(path.join(s.paths.photos, "ready.jpg"), "queued photo");
  for (const [task, prompt] of [["reel-publish", routinePrompt(s)], ["daily-posts", dailyPostsPrompt(s)]]) {
    const lines = prompt.split("\n").filter((line) => line.startsWith(process.execPath));
    assert.match(lines[0], new RegExp(`studio heartbeat start ${task}`));
    assert.match(lines.at(-2), new RegExp(`studio heartbeat done ${task}`));
    assert.match(lines.at(-1), new RegExp(`studio heartbeat fail ${task}`));
    const branch = prompt.split("CHECK RUN\n")[1].split("END CHECK RUN")[0];
    assert.match(branch, /Find the tools only; do not call them/);
    assert.match(branch, /Reply "Check complete" and STOP/);
    assert.match(branch, /Do not create, make, render, serve, upload, schedule or post anything/);
    const start = heartbeat(s.paths.root, "start", task, { now });
    assert.equal(start.checkRun, true);
    // Execute every Bash instruction in the selected branch against the real helpers.
    // Any normal command, including make or create, fails this allowlist.
    const calls = [];
    for (const line of branch.split("\n").filter((line) => line.startsWith(process.execPath))) {
      const match = line.match(/studio heartbeat (discover|done) (reel-publish|daily-posts) --studio /);
      assert.ok(match, line);
      calls.push(match[1]);
      if (match[1] === "discover") {
        const found = discoverHeartbeat(s.paths.root, match[2], { now });
        assert.ok(found.brand["brand.json"]);
        assert.ok(found.folders.some((f) => f.entries.includes("ready.mp4")));
      } else heartbeat(s.paths.root, "done", match[2], { now });
    }
    assert.deepEqual(calls, ["discover", "done"]);
  }
  assert.equal(fs.readFileSync(path.join(s.paths.publish, "ready.mp4"), "utf8"), "queued media");
  assert.equal(fs.existsSync(s.paths.posts), false);
});

test("a fresh check stays read only for both tasks until both succeed", (t) => {
  const s = fixture(t); receipt(s);
  complete(s, "reel-publish"); complete(s, "daily-posts");
  const file = path.join(s.paths.root, "heartbeat.json");
  const previous = fs.readFileSync(file, "utf8");
  const armed = checkHeartbeats(s.paths.root, { now });
  assert.deepEqual(armed.tasks, ["reel-publish", "daily-posts"]);
  const pending = fs.readFileSync(file, "utf8");
  // A crash between arming the marker and clearing earlier proof cannot verify an old run.
  fs.writeFileSync(file, previous);
  assert.equal(verifyRoutines(s.paths.root).ok, false);
  fs.writeFileSync(file, pending);
  assert.equal(verifyRoutines(s.paths.root).ok, false);
  complete(s, "reel-publish");
  // A task may run again while its partner still needs its check. It still cannot post.
  complete(s, "reel-publish");
  heartbeat(s.paths.root, "start", "daily-posts", { now });
  heartbeat(s.paths.root, "fail", "daily-posts", { now, reason: "Brand needs attention" });
  assert.equal(fs.existsSync(path.join(s.paths.root, ".check-run")), true);
  complete(s, "daily-posts");
  assert.equal(verifyRoutines(s.paths.root).ok, true);
});

test("both global task folders are checked before any overwrite", (t) => {
  const s = fixture(t);
  const before = fs.readFileSync(s.setup.skill, "utf8");
  const setupBefore = fs.readFileSync(routineSetupFile(s.paths.root), "utf8");
  const dir = path.dirname(s.setup.daily.skill);
  save(path.join(dir, "reel-owner.json"), { folder: path.join(s.home, "Other Client") });
  fs.writeFileSync(s.setup.daily.skill, "Someone else's task");
  assert.throws(() => writeRoutine(s, { home: s.home }), /daily-posts already uses another folder/);
  assert.equal(fs.readFileSync(s.setup.skill, "utf8"), before);
  assert.equal(fs.readFileSync(s.setup.daily.skill, "utf8"), "Someone else's task");
  assert.equal(fs.readFileSync(routineSetupFile(s.paths.root), "utf8"), setupBefore);
});

test("unmarked foreign and unknown task folders are preserved; old own prompts can upgrade", (t) => {
  const s = fixture(t);
  const owner = path.join(path.dirname(s.setup.skill), "reel-owner.json");
  fs.unlinkSync(owner);
  // Earlier tasks used the same explicit studio command suffix.
  writeRoutine(s, { home: s.home });
  fs.unlinkSync(owner);
  fs.writeFileSync(s.setup.skill, `node reel studio publish scan --studio '${path.join(s.home, "Other Client")}'\n`);
  assert.throws(() => writeRoutine(s, { home: s.home }), /already uses another folder/);
  fs.unlinkSync(s.setup.skill);
  assert.throws(() => writeRoutine(s, { home: s.home }), /already uses another folder/);
});

test("heartbeat records failures and handles bad files, missing starts and concurrent writers safely", (t) => {
  const s = fixture(t);
  assert.throws(() => heartbeat(s.paths.root, "done", "daily-posts"), /Start the routine check/);
  assert.throws(() => heartbeat(s.paths.root, "start", "other"), /Choose reel-publish/);
  heartbeat(s.paths.root, "start", "daily-posts", { now });
  const fail = heartbeat(s.paths.root, "fail", "daily-posts", { now, reason: "Claude needs attention" });
  assert.equal(fail.status, "fail"); assert.equal(fail.reason, "Claude needs attention");
  const file = path.join(s.paths.root, "heartbeat.json");
  const before = fs.readFileSync(file, "utf8");
  const lock = path.join(s.paths.state, "heartbeat.lock"); fs.mkdirSync(lock);
  assert.throws(() => heartbeat(s.paths.root, "start", "daily-posts"), /saving its check/);
  assert.equal(fs.readFileSync(file, "utf8"), before); fs.rmdirSync(lock);
  fs.writeFileSync(file, "{bad");
  assert.throws(() => heartbeat(s.paths.root, "start", "daily-posts"), /could not be read/);
  assert.equal(fs.readFileSync(file, "utf8"), "{bad");
  assert.equal(fs.existsSync(lock), false);
  for (const value of [null, {}, { tasks: [] }]) {
    save(file, value);
    assert.throws(() => heartbeat(s.paths.root, "start", "daily-posts"), /could not be read/);
  }
});

test("router entry points accept the exact requested command arguments", (t) => {
  const s = fixture(t);
  // Child processes call exported handlers directly until the other builder wires the router.
  const script = `import { routineReceiptCommand } from './src/studio-routine.mjs'; routineReceiptCommand(process.argv.slice(1));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script, "--", "--nonce", s.setup.nonce, "--tasks", JSON.stringify(s.tasks), "--studio", s.paths.root], { cwd: PKG_ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Routine details saved/);
  const heartbeatScript = `import { heartbeatCommand } from './src/heartbeat.mjs'; heartbeatCommand(process.argv.slice(1));`;
  const check = spawnSync(process.execPath, ["--input-type=module", "-e", heartbeatScript, "--", "check", "--studio", s.paths.root], { cwd: PKG_ROOT, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr); assert.equal(JSON.parse(check.stdout).checkRun, true);
  assert.throws(() => heartbeatCommand(["done", "daily-posts", "extra", "--studio", s.paths.root]));
});

test("Claude download uses no package manager and checks the person's Applications folder", (t) => {
  const s = fixture(t); const calls = [];
  const run = (cmd, args, options) => { calls.push({ cmd, args, options }); return { status: 0 }; };
  openRoutineSetup(s, { home: s.home, appExists: false, run });
  assert.deepEqual(calls.map((c) => [c.cmd, c.args]), [["open", ["https://claude.com/download"]], ["pbcopy", []]]);
  assert.match(calls[1].options.input, /routine-receipt/);
  calls.length = 0;
  const app = path.join(s.home, "Applications", "Claude.app"); fs.mkdirSync(app, { recursive: true });
  openRoutineSetup(s, { home: s.home, run });
  assert.deepEqual(calls.map((c) => c.cmd), ["pbcopy", "open"]);
  assert.ok(calls[1].args.includes(app) || calls[1].args.includes("/Applications/Claude.app"));
  const settings = read(path.join(s.home, ".claude", "settings.json"));
  assert.ok(settings.permissions.allow.some((s) => s.includes("studio heartbeat *")));
  const file = path.join(s.home, ".claude", "settings.json"); fs.writeFileSync(file, "{broken");
  assert.equal(allowHeartbeatCommands({ home: s.home }), false);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});
