import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GB, storageReport, cleanupStorage, watchFolders, storageSummary } from "../src/storage.mjs";

const NOW = Date.parse("2030-06-20T12:00:00Z");
const old = new Date(NOW - 31 * 86400000);
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const reels = path.join(home, "Reels"), studio = path.join(home, "Content Studio");
  const options = { home, env: {}, now: NOW, statfs: () => ({ bavail: 20 * GB, bsize: 1 }) };
  const put = (file, value = "bytes") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file; };
  const age = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, entry.name); if (entry.isDirectory()) age(f); else fs.utimesSync(f, old, old); } fs.utimesSync(dir, old, old); };
  const posts = [];
  const work = (name, { posted = true, status = "scheduled", extra = null } = {}) => {
    const dir = path.join(reels, "videos", name);
    put(path.join(dir, "renders/reel.mp4"), name);
    put(path.join(dir, "plan.json"), "{}");
    if (extra) put(path.join(dir, extra[0]), extra[1]);
    if (posted) {
      const file = put(path.join(studio, "Made", name, "reel.mp4"), name);
      posts.push({ id: name, status, metricoolId: `post-${name}`, files: [file] });
      put(path.join(studio, ".studio/posts.jsonl"), posts.map((p) => JSON.stringify(p)).join("\n"));
    }
    age(dir);
    return dir;
  };
  return { home, reels, studio, options, put, age, work };
}

test("watch folders use the saved installer list, environment overrides and mode names", (t) => {
  const f = fixture(t), custom = path.join(f.home, "Custom raw");
  f.put(path.join(f.home, ".reel/maintenance/client.json"), JSON.stringify({ dropFolders: [custom, path.join(f.reels, "raw-long")] }));
  assert.deepEqual(watchFolders({ home: f.home, env: {} }), [{ dir: custom, mode: "reel" }, { dir: path.join(f.reels, "raw-long"), mode: "long" }]);
  assert.deepEqual(watchFolders({ home: f.home, env: { REEL_WATCH_RAW: "~/Other raw", REEL_WATCH_RAW_RUNWAY: "~/Paid raw" } }), [
    { dir: path.join(f.home, "Other raw"), mode: "reel" }, { dir: path.join(f.reels, "raw-long"), mode: "long" }, { dir: path.join(f.home, "Paid raw"), mode: "runway" },
  ]);
  f.put(path.join(f.home, ".reel/maintenance/client.json"), '{"dropFolders":[]}');
  assert.deepEqual(watchFolders({ home: f.home, env: {} }), []);
  assert.deepEqual(watchFolders({ home: f.home, env: { REEL_WATCH_RAW: custom } }), []);
});

test("the installed watcher fills in folders absent from the maintenance list", (t) => {
  const f = fixture(t);
  f.put(path.join(f.home, ".reel/maintenance/client.json"), JSON.stringify({ dropFolders: [path.join(f.reels, "raw")] }));
  f.put(path.join(f.home, "Library/LaunchAgents/com.pingel.reel-watch.plist"), '<plist><dict><key>EnvironmentVariables</key><dict><key>REEL_WATCH_RAW</key><string>/custom/A &amp; B</string><key>REEL_WATCH_RAW_OWN_BROLL</key><string>/custom/footage</string></dict></dict></plist>');
  assert.deepEqual(watchFolders({ home: f.home, env: {} }), [{ dir: "/custom/A & B", mode: "reel" }, { dir: "/custom/footage", mode: "own-broll" }]);
  assert.equal(watchFolders({ home: f.home, env: { REEL_WATCH_RAW: "~/Override" } })[0].dir, path.join(f.home, "Override"));
});

test("storage measures originals, finished reels and work, and asks the Reels volume for available bytes", (t) => {
  const f = fixture(t);
  f.put(path.join(f.reels, "raw/original.mov"), "raw");
  f.put(path.join(f.reels, "done/reel.mp4"), "done");
  f.put(path.join(f.reels, "videos/clip/intermediate"), "working");
  f.put(path.join(f.studio, ".studio/reels/delivered/reel.mp4"), "delivery");
  f.put(path.join(f.studio, ".studio/work/post/plan.json"), "{}");
  fs.symlinkSync(path.join(f.reels, "raw"), path.join(f.reels, "videos", "linked"));
  let checked;
  const report = storageReport({ ...f.options, statfs: (file) => { checked = file; return { bavail: 14 * GB, bsize: 1 }; } });
  assert.equal(checked, f.reels);
  assert.equal(report.freeBytes, 14 * GB);
  assert.equal(report.originalsBytes, 3);
  assert.equal(report.finishedBytes, 12);
  assert.equal(report.workBytes, 9);
  assert.equal(report.warning, true); assert.equal(report.blocked, false);
});

test("disk thresholds are strict and an unavailable space check stays unknown", (t) => {
  const f = fixture(t);
  for (const [freeBytes, warning, blocked] of [[15 * GB, false, false], [8 * GB, true, false], [8 * GB - 1, true, true]]) {
    const report = storageReport({ ...f.options, statfs: () => ({ bavail: BigInt(freeBytes), bsize: 1n }) });
    assert.equal(report.warning, warning); assert.equal(report.blocked, blocked);
  }
  assert.equal(storageReport({ ...f.options, statfs: () => { throw Error("unavailable"); } }).freeBytes, null);
});

test("cleanup previews only old finished work with confirmed saved reels and no journals", (t) => {
  const f = fixture(t), safe = f.work("safe");
  const kept = [
    f.work("unposted", { posted: false }),
    f.work("draft", { status: "draft" }),
    f.work("unknown", { status: "held" }),
    f.work("paid", { extra: ["broll/broll.json", '{"tasks":[{"state":"unknown"}]}'] }),
    f.work("empty-journal", { extra: ["broll/broll.json", '{"tasks":[]}'] }),
    f.work("named-journal", { extra: ["Runway journal.txt", "keep"] }),
    f.work("broken-record", { extra: ["broll/broll.json", "broken"] }),
    f.work("queued"), f.work("recent"), f.work("changed"),
  ];
  f.put(path.join(f.studio, "Publish/queued/reel.mp4"), "queued");
  const recent = f.put(path.join(f.reels, "videos/recent/still-running"), "new");
  fs.utimesSync(recent, new Date(NOW), new Date(NOW));
  // A same-sized edit is a different reel and cannot borrow an older receipt.
  f.put(path.join(f.studio, "Made/changed/reel.mp4"), "CHANGED");
  const preview = cleanupStorage(f.options);
  assert.deepEqual(preview.cleanup.map((item) => item.path), [safe]);
  assert.deepEqual(preview.removed, []); assert.equal(fs.existsSync(safe), true);
  assert.match(storageSummary(preview), /Nothing has been deleted\. Add --yes/);
  const result = cleanupStorage({ ...f.options, yes: true });
  assert.deepEqual(result.removed, [safe]); assert.equal(fs.existsSync(safe), false);
  for (const dir of kept) assert.equal(fs.existsSync(dir), true, dir);
  assert.equal(fs.existsSync(path.join(f.studio, "Made/safe/reel.mp4")), true);
});

test("cleanup rechecks a preview and refuses to overlap an edit", (t) => {
  const f = fixture(t), work = f.work("safe");
  assert.equal(cleanupStorage(f.options).cleanup.length, 1);
  f.put(path.join(work, "broll/broll.json"), '{"tasks":[{"state":"submitting"}]}'); f.age(work);
  assert.deepEqual(cleanupStorage({ ...f.options, yes: true }).removed, []);
  fs.mkdirSync(path.join(f.reels, "videos/.seen/.lock"), { recursive: true });
  assert.throws(() => cleanupStorage({ ...f.options, yes: true }), /waiting for editing/);
});

test("a posted shortcut into the work folder is never treated as a saved finished reel", (t) => {
  const f = fixture(t), work = f.work("linked");
  const saved = path.join(f.studio, "Made/linked/reel.mp4");
  fs.unlinkSync(saved); fs.symlinkSync(path.join(work, "renders/reel.mp4"), saved);
  assert.deepEqual(cleanupStorage(f.options).cleanup, []);
  assert.equal(fs.existsSync(work), true);
});
