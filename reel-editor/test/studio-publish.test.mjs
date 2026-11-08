import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { initStudio, loadStudio, readPosts } from "../src/content-studio.mjs";
import { studioAgents, installAgents } from "../src/studio-cli.mjs";
import { scanPublish, publishSlot, finishPublish, failPublish, claimPublish, beginPublish, releasePublish, publishClaims, publishLedger, INTERRUPTED_PUBLISH } from "../src/studio-publish.mjs";
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
  const claim = claimPublish(s, "clip", { date: "2026-11-08T10:00:00" });
  const r = finishPublish(s, "clip", { owner: claim.owner, date: "2026-11-08T10:00:00", planner: "https://example.test/1", id: "1", trialCopy: "2026-11-08T12:00:00", trialPlanner: "https://example.test/2", trialId: "2" });
  assert.equal(fs.existsSync(dir), false); assert.equal(fs.existsSync(r.files[0]), true);
  const posts = readPosts(s.paths); assert.equal(posts.length, 2); assert.equal(posts[1].format, "trial"); assert.equal(posts[0].status, "scheduled");
  assert.match(fs.readFileSync(path.join(r.made, "Scheduled.txt"), "utf8"), /10:00/);
});
test("done preserves the draft gate even without a draft argument", (t) => {
  const s = fixture(t); reel(s, "clip", "");
  const claim = claimPublish(s, "clip", { date: "2026-11-08T10:00:00" });
  assert.equal(finishPublish(s, "clip", { date: claim.slot, id: "draft-id", owner: claim.owner }).status, "draft");
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
    assert.doesNotMatch(line, /&&|\|\||[|<>]|\bcd\b/); assert.match(line, /studio publish/);
  }
  assert.match(text, /blogId 42, timezone UTC/);
  const result = writeRoutine(s, { home: s.home });
  assert.equal(fs.readFileSync(result.file, "utf8"), fs.readFileSync(result.skill, "utf8"));
  assert.match(result.setup, /create_scheduled_task[\s\S]*45 7-20 \* \* \*[\s\S]*list scheduled tasks[\s\S]*enabled/);
  const calls = [];
  const notes = openRoutineSetup(s, { home: s.home, appExists: false, run: (cmd, args, options) => { calls.push({ cmd, args, options }); return { status: cmd === "brew" ? 1 : 0 }; } });
  assert.deepEqual(calls.map((r) => r.cmd), ["brew", "pbcopy", "open"]);
  assert.match(notes.join(" "), /claude.ai\/download[\s\S]*Code tab[\s\S]*routine is on/);
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
  const claim = claimPublish(s, "Clips", { date: "2026-11-08T10:00:00" });
  finishPublish(s, "Clips", { date: claim.slot, owner: claim.owner, id: "one", trialCopyFailed: "No trial slot" });
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

function publisher(s, id, { stage, barrier } = {}) {
  const code = `
    import fs from 'node:fs';
    import { loadStudio } from ${JSON.stringify(new URL('../src/content-studio.mjs', import.meta.url).href)};
    import { claimPublish, beginPublish } from ${JSON.stringify(new URL('../src/studio-publish.mjs', import.meta.url).href)};
    const s = loadStudio(${JSON.stringify(s.paths.root)});
    const barrier = ${JSON.stringify(barrier || '')};
    if (barrier) {
      process.send({ ready: true });
      while (!fs.existsSync(barrier)) await new Promise(r => setTimeout(r, 5));
    }
    try {
      const claim = claimPublish(s, ${JSON.stringify(id)}, { date: '2031-01-02T10:00:00' });
      if (${JSON.stringify(stage)} !== 'before') {
        beginPublish(s, claim.id, claim.owner);
        fs.appendFileSync(${JSON.stringify(path.join(s.home, 'fake-creates'))}, claim.id + '\\n');
      }
      if (barrier) process.send({ claim }, () => process.exit(0));
      else { process.send({ claim }); setInterval(() => {}, 1000); }
    } catch (error) { process.send({ error: error.message }, () => process.exit(0)); }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const messages = [];
  const first = new Promise(resolve => child.once('message', resolve));
  child.on('message', m => messages.push(m));
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 || signal === 'SIGKILL' ? resolve({ code, signal }) : reject(new Error(stderr)));
  });
  return { child, first, closed, messages };
}
for (const stage of ['before', 'after']) test(`killed ${stage} create stays held through a fresh scan and cannot create again`, async t => {
  const s = fixture(t); const dir = reel(s);
  const id = scanPublish(s).ready[0].id;
  const run = publisher(s, id, { stage });
  t.after(() => run.child.kill('SIGKILL'));
  const { claim } = await run.first;
  assert.ok(claim);
  run.child.kill('SIGKILL'); await run.closed;
  assert.equal(publishClaims(s)[0].state, 'awaiting-receipt');
  const note = path.join(dir, 'Posting check.txt'); fs.unlinkSync(note);
  const fresh = loadStudio(s.paths.root);
  assert.deepEqual(scanPublish(fresh).ready, []);
  assert.equal(scanPublish(fresh).held[0].message, INTERRUPTED_PUBLISH);
  assert.match(fs.readFileSync(path.join(s.paths.root, 'STATUS.txt'), 'utf8'), /Posting was interrupted\. This reel may already be scheduled/);
  assert.equal(fs.readFileSync(note, 'utf8').trim(), INTERRUPTED_PUBLISH);
  assert.throws(() => claimPublish(fresh, id, { date: claim.slot }), /Posting was interrupted/);
  const count = fs.existsSync(path.join(s.home, 'fake-creates')) ? fs.readFileSync(path.join(s.home, 'fake-creates'), 'utf8').trim().split('\n').length : 0;
  assert.equal(count, stage === 'before' ? 0 : 1);
});
test('two publishers race for one durable claim and only one reaches a fake create', async t => {
  const s = fixture(t); reel(s);
  const id = scanPublish(s).ready[0].id, barrier = path.join(s.home, 'go');
  const runs = [publisher(s, id, { barrier }), publisher(s, id, { barrier })];
  t.after(() => runs.forEach(r => r.child.kill('SIGKILL')));
  await Promise.all(runs.map(r => r.first)); fs.writeFileSync(barrier, 'go');
  await Promise.all(runs.map(r => r.closed));
  assert.equal(runs.flatMap(r => r.messages).filter(m => m.claim).length, 1);
  assert.equal(runs.flatMap(r => r.messages).filter(m => m.error).length, 1);
  assert.equal(fs.readFileSync(path.join(s.home, 'fake-creates'), 'utf8').trim().split('\n').length, 1);
  assert.equal(publishClaims(s).length, 1); assert.deepEqual(scanPublish(s).ready, []);
});
test('serving consumes a claim once; failures and wrong owners cannot unlock it', t => {
  const s = fixture(t); reel(s);
  const claim = claimPublish(s, scanPublish(s).ready[0].id, { date: '2031-01-02T10:00:00' });
  assert.throws(() => beginPublish(s, claim.id, 'another owner'), /owner/);
  beginPublish(s, claim.id, claim.owner);
  assert.throws(() => beginPublish(s, claim.id, claim.owner), /Posting was interrupted/);
  assert.throws(() => finishPublish(s, claim.id, { date: claim.slot, id: 'remote', owner: 'another' }), /owner/);
  assert.equal(failPublish(s, claim.id, 'No result', { owner: claim.owner }).status, 'held');
  assert.deepEqual(scanPublish(s).ready, []);
  assert.throws(() => releasePublish(s, claim.id), /Choose/);
  releasePublish(s, claim.id, { notPosted: true });
  assert.equal(scanPublish(s).ready.length, 1);
  const next = claimPublish(s, claim.id, { date: claim.slot });
  assert.notEqual(next.owner, claim.owner);
  beginPublish(s, next.id, next.owner);
});
test('done requires identifying receipts and saves normal and trial ids before clearing a claim', t => {
  const s = fixture(t); reel(s);
  const claim = claimPublish(s, 'clip', { date: '2031-01-02T10:00:00' });
  assert.throws(() => finishPublish(s, claim.id, { owner: claim.owner, date: claim.slot }), /post id/);
  assert.throws(() => finishPublish(s, claim.id, { owner: claim.owner, date: claim.slot, id: 'normal' }), /trial copy result/);
  const made = finishPublish(s, claim.id, { owner: claim.owner, date: claim.slot, id: 'normal', trialCopy: '2031-01-02T12:00:00', trialId: 'trial' });
  const receipt = JSON.parse(fs.readFileSync(path.join(publishLedger(s), `${claim.id}.receipt.json`), 'utf8'));
  assert.equal(receipt.normal.id, 'normal'); assert.equal(receipt.trial.id, 'trial');
  assert.equal(receipt.made, made.made); assert.deepEqual(publishClaims(s), []);
  assert.deepEqual(scanPublish(s).ready, []);
  assert.throws(() => claimPublish(s, claim.id, { date: claim.slot }), /reel id/);
});
test('a saved receipt survives failed local filing and forbids another create', t => {
  const s = fixture(t); reel(s);
  const claim = claimPublish(s, 'clip', { date: '2031-01-02T10:00:00' });
  fs.rmSync(s.paths.made, { recursive: true }); fs.writeFileSync(s.paths.made, 'blocked');
  assert.throws(() => finishPublish(s, claim.id, { owner: claim.owner, date: claim.slot, id: 'normal', trialCopyFailed: 'No reply' }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(publishLedger(s), `${claim.id}.receipt.json`))).normal.id, 'normal');
  assert.deepEqual(scanPublish(s).ready, []);
  assert.throws(() => beginPublish(s, claim.id, claim.owner), /receipt is already saved/);
  assert.throws(() => releasePublish(s, claim.id, { notPosted: true }), /receipt is already saved/);
});
test('a person can confirm posting without a lost remote id and the reel cannot be offered again', t => {
  const s = fixture(t); reel(s);
  const claim = claimPublish(s, 'clip', { date: '2031-01-02T10:00:00' });
  releasePublish(s, claim.id, { posted: true });
  assert.deepEqual(publishClaims(s), []); assert.deepEqual(scanPublish(s).ready, []);
  const saved = JSON.parse(fs.readFileSync(path.join(publishLedger(s), `${claim.id}.receipt.json`)));
  assert.equal(saved.normal.confirmedByPerson, true); assert.equal(saved.trial.uncertain, true);
});
test('a trial only receipt stays separate from a normal receipt', t => {
  const s = fixture(t, { reels: { trial: true } }); reel(s);
  const claim = claimPublish(s, 'clip', { date: '2031-01-02T10:00:00' });
  finishPublish(s, claim.id, { owner: claim.owner, date: claim.slot, id: 'only-trial' });
  const receipt = JSON.parse(fs.readFileSync(path.join(publishLedger(s), `${claim.id}.receipt.json`)));
  assert.equal(receipt.normal, null); assert.equal(receipt.trial.id, 'only-trial');
});
test('a damaged claim holds its reel instead of treating it as ready', t => {
  const s = fixture(t); reel(s);
  const claim = claimPublish(s, 'clip', { date: '2031-01-02T10:00:00' });
  fs.writeFileSync(path.join(publishLedger(s), `${claim.id}.claim.json`), '{}');
  assert.deepEqual(scanPublish(s).ready, []);
  assert.equal(scanPublish(s).held[0].id, claim.id);
  assert.throws(() => claimPublish(s, claim.id, { date: claim.slot }), /Posting was interrupted/);
});
test('the posting note never becomes a missing caption, even on a video named caption', t => {
  const s = fixture(t, { reels: { trial: false } }); const dir = reel(s, 'clip', '');
  fs.renameSync(path.join(dir, 'clip.mp4'), path.join(dir, 'caption.mp4'));
  fs.unlinkSync(path.join(dir, 'caption.txt'));
  const claim = claimPublish(s, 'clip', { date: '2031-01-02T10:00:00' });
  assert.equal(finishPublish(s, claim.id, { owner: claim.owner, date: claim.slot, id: 'draft' }).status, 'draft');
});
