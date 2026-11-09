import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initStudio } from "../src/content-studio.mjs";
import { studioHealth, watcherDrops, watcherWorkName, routineIssues } from "../src/studio-health.mjs";
import { GB } from "../src/storage.mjs";

const now = new Date("2030-06-20T12:00Z"), old = new Date(now.getTime() - 2 * 86400000);
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "health-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, "Reels"), raw = path.join(home, "My raw clips"), seen = path.join(root, "videos/.seen");
  const put = (file, value = "video") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file; };
  const clip = (name) => { const file = put(path.join(raw, name)); fs.utimesSync(file, old, old); return file; };
  const marker = (file, mode, result, legacy = false) => {
    const st = fs.statSync(file), base = `${mode === "reel" ? "" : `${mode}-`}${path.basename(file)}`;
    return put(path.join(seen, `${base}${legacy ? "" : `@${st.size}-${Math.floor(st.mtimeMs / 1000)}`}.${result}`), "");
  };
  return { home, root, raw, seen, put, clip, marker };
}

for (const mode of ["reel", "broll", "carousel", "long", "youtube", "runway", "own-broll"]) {
  test(`completed ${mode} originals older than a day are not stuck`, (t) => {
    const f = fixture(t), file = f.clip("An original.MOV");
    f.marker(file, mode, "done");
    assert.deepEqual(watcherDrops([{ dir: f.raw, mode }], { root: f.root, now: now.getTime() }), []);
    fs.appendFileSync(file, "new copy"); fs.utimesSync(file, old, old);
    assert.equal(watcherDrops([{ dir: f.raw, mode }], { root: f.root, now: now.getTime() }).length, 1);
    f.marker(file, mode, "done", true);
    assert.deepEqual(watcherDrops([{ dir: f.raw, mode }], { root: f.root, now: now.getTime() }), []);
  });
}

test("failed clips show their actual note even when recent; old failed markers also count", (t) => {
  const f = fixture(t), file = f.clip("bad.mov");
  f.marker(file, "runway", "failed", true);
  f.put(`${file} - why it failed.txt`, "A previous purchase needs checking. Your original is safe.");
  const issues = watcherDrops([{ dir: f.raw, mode: "runway" }], { root: f.root, now: now.getTime() });
  assert.equal(issues.length, 1); assert.match(issues[0], /previous purchase needs checking/);
});

test("an old long recording with work touched recently is still editing", (t) => {
  const f = fixture(t), file = f.clip("Interview #nocta__A long hook.mov");
  const work = path.join(f.root, "videos", watcherWorkName(file, "long"));
  const progress = f.put(path.join(work, "clip-1/edit/project/progress.txt"), "working");
  const recent = new Date(now.getTime() - 3600000);
  for (let dir = path.dirname(progress); dir.startsWith(work); dir = path.dirname(dir)) fs.utimesSync(dir, old, old);
  fs.utimesSync(progress, recent, recent);
  assert.equal(path.basename(work), "interview-clips");
  assert.deepEqual(watcherDrops([{ dir: f.raw, mode: "long" }], { root: f.root, now: now.getTime() }), []);
  fs.utimesSync(progress, old, old);
  assert.equal(watcherDrops([{ dir: f.raw, mode: "long" }], { root: f.root, now: now.getTime() }).length, 1);
});

test("routine health uses completion rather than start, names the last day and clears on recovery", () => {
  const beat = { "reel-publish": { start: now.toISOString(), done: "2030-06-17T12:00Z" } };
  assert.deepEqual(routineIssues(beat, { now }), ["The reel posting routine has not finished since 2030-06-17. Open the Claude app and check its tasks."]);
  beat["reel-publish"].done = now.toISOString();
  assert.deepEqual(routineIssues(beat, { now }), []);
  beat["reel-publish"].fail = "2030-06-20T12:01Z"; beat["reel-publish"].reason = "Posting confirmation needs checking.";
  assert.match(routineIssues(beat, { now })[0], /Posting confirmation needs checking/);
  assert.equal(routineIssues({ "daily-posts": { done: "2030-06-19T12:00Z" } }, { now: new Date("2030-06-20T07:00Z") }).length, 0);
});

test("studio health watches saved Raw folders, markers, heartbeats and low disk together", async (t) => {
  const f = fixture(t), studio = path.join(f.home, "Content Studio");
  const paths = initStudio(studio, { config: { timezone: "UTC", publish: { mode: "off" }, reels: { rawIntake: false, publisher: "claude" }, daily: { publisher: "claude" } } });
  f.put(path.join(f.home, ".reel/maintenance/client.json"), JSON.stringify({ dropFolders: [f.raw] }));
  f.put(path.join(paths.state, "daily.json"), JSON.stringify({ day: "2030-06-20", completed: true }));
  f.put(path.join(studio, "heartbeat.json"), JSON.stringify({ "reel-publish": { done: "2030-06-17T12:00Z" }, "daily-posts": { done: now.toISOString() } }));
  const finished = f.clip("finished.mov"), failed = f.clip("failed.mov");
  f.marker(finished, "reel", "done"); f.marker(failed, "reel", "failed");
  f.put(`${failed} - why it failed.txt`, "The edit needs help. Your original is safe.");
  const notices = [];
  const result = await studioHealth(studio, { home: f.home, env: { REEL_CLIENT_MODE: "1" }, now,
    deps: { claudeConnected: () => true, notify: (...args) => notices.push(args),
      storageReport: () => ({ freeBytes: 7 * GB, warning: true, blocked: true, errors: [] }) } });
  assert.equal(result.issues.length, 3);
  assert.ok(result.issues.every((issue) => !issue.includes("finished.mov")));
  assert.match(result.message, /has not finished since 2030-06-17/);
  assert.match(result.message, /The edit needs help/); assert.match(result.message, /Editing is paused because this Mac is nearly full/);
  const status = fs.readFileSync(path.join(studio, "STATUS.txt"), "utf8");
  assert.match(status.split("\n")[0], /release dev\) Free some space on this Mac\.$/);
  assert.match(status, /posting:.*has not finished since 2030-06-17/);
  assert.equal(notices.length, 1);
});

test("an editor only disk pause without a failed marker is visible in status", async (t) => {
  const f = fixture(t), file = f.clip("paused.mov");
  f.put(`${file} - why it failed.txt`, "Editing is paused because this Mac is nearly full. Your original is safe.");
  const result = await studioHealth(path.join(f.home, ".reel/maintenance"), { home: f.home, env: {}, dropFolders: [f.raw], now,
    deps: { notify: () => {}, storageReport: () => ({ freeBytes: 20 * GB, warning: false, blocked: false, errors: [] }) } });
  assert.match(result.message, /Editing is paused/);
});
