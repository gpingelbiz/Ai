import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fakeDropbox, fakeOpus } from "./fakes.mjs";

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "opus-dropbox.mjs");
const sh = promisify(execFile);
const cli = (home, ...args) => sh(process.execPath, [bin, ...args], { env: { ...process.env, OPUS_DROPBOX_HOME: home, OPUS_DROPBOX_NOTIFY: "0" } }).catch((e) => e);

test("run before setup says what is missing and changes nothing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-dropbox-cli-"));
  try {
    const r = await cli(home, "run");
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.missing.includes("the Opus API key"));
    assert.ok(!fs.existsSync(path.join(home, "state.json")));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("the command the background job runs: drop, Opus, clips back, state on disk", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-dropbox-cli-"));
  const dbx = await fakeDropbox();
  const op = await fakeOpus();
  try {
    op.clipCount = 1;
    dbx.folder("/Opus Clips");
    dbx.put("/Unedited/Podcast Ep 4.mp4");
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({
      folders: { drop: "/Unedited", finished: "/Opus Clips" },
      opus: { apiKey: "opus-key", project: {} },
      dropbox: { appKey: "app", refreshToken: "refresh" },
      endpoints: { opus: op.url, dropboxApi: dbx.api, dropboxContent: dbx.content },
    }));
    let out = JSON.parse((await cli(home, "run")).stdout);
    assert.equal(out.sent, 1);
    op.finish("P1");
    out = JSON.parse((await cli(home, "run")).stdout);
    assert.equal(out.delivered, 1);
    const t = new Date();
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    assert.deepEqual(dbx.names(`/Opus Clips/${today} Reel 1`), ["Hook number 1 why.mp4", "caption.txt"]);
    const state = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
    assert.equal(Object.values(state.items)[0].status, "done");
    assert.equal(fs.statSync(path.join(home, "state.json")).mode & 0o777, 0o600);
    assert.ok(!fs.existsSync(path.join(home, ".lock")), "lock released");
    const status = (await cli(home, "status")).stdout;
    assert.match(status, /Done \(1\)/);
    assert.match(fs.readFileSync(path.join(home, "run.log"), "utf8"), /"event":"delivered"/);
  } finally {
    dbx.close(); op.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a second run while one is going does nothing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-dropbox-cli-"));
  try {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ folders: { drop: "/a", finished: "/b" }, opus: { apiKey: "k" }, dropbox: { appKey: "a", refreshToken: "r" } }));
    fs.mkdirSync(path.join(home, ".lock"));
    const out = JSON.parse((await cli(home, "run")).stdout);
    assert.equal(out.skipped, "another run is going");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("settings rejects invalid choices without writes and prints no credentials", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-settings-"));
  try {
    const config = { folders: { drop: "/a", finished: "/b" }, opus: { apiKey: "hidden-key", project: {} }, dropbox: { appKey: "hidden-app", refreshToken: "hidden-token" }, endpoints: { opus: "http://127.0.0.1:1" } };
    const file = path.join(home, "config.json");
    fs.writeFileSync(file, JSON.stringify(config));
    const before = fs.readFileSync(file, "utf8");
    for (const n of ["-1", "5", "1.2", "x"]) {
      const result = await cli(home, "settings", "length", n);
      assert.equal(result.code, 1);
      assert.equal(fs.readFileSync(file, "utf8"), before);
    }
    assert.doesNotMatch((await cli(home, "settings")).stdout, /hidden-|https?:/);
    assert.match((await cli(home, "settings", "length", "2")).stdout, /from now on/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)).opus.project.curationPref.clipDurations, [[30, 60]]);
    fs.mkdirSync(path.join(home, ".lock"));
    assert.equal((await cli(home, "settings", "length", "1")).code, 1);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("recut requires consent and filed done state, sends once and keeps old clips", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-recut-"));
  const dbx = await fakeDropbox(), op = await fakeOpus();
  try {
    dbx.folder("/clips"); dbx.put("/drop/video.mp4");
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ folders: { drop: "/drop", finished: "/clips" }, opus: { apiKey: "opus-key", project: {} }, dropbox: { appKey: "app", refreshToken: "refresh" }, endpoints: { opus: op.url, dropboxApi: dbx.api, dropboxContent: dbx.content } }));
    await cli(home, "run"); op.finish("P1"); await cli(home, "run");
    const stateFile = path.join(home, "state.json"), before = fs.readFileSync(stateFile, "utf8");
    const moves = () => dbx.calls.filter((c) => c.route === "files/move_v2").length;
    const n = moves();
    assert.match((await cli(home, "recut", "video.mp4")).stdout, /at least 10/);
    assert.equal(moves(), n); assert.equal(fs.readFileSync(stateFile, "utf8"), before);
    await cli(home, "recut", "video.mp4", "--yes");
    assert.equal((await cli(home, "recut", "video.mp4", "--yes")).code, 1);
    await cli(home, "run"); await cli(home, "run");
    assert.equal(op.created.length, 2);
    assert.equal((await cli(home, "recut", "video.mp4", "--yes")).code, 1);
    op.finish("P2"); await cli(home, "run");
    assert.equal(dbx.names("/clips").length, 4, "two clips from each send, each in its own reel folder");
    const state = JSON.parse(fs.readFileSync(stateFile));
    state.items.duplicate = { ...Object.values(state.items)[0] };
    fs.writeFileSync(stateFile, JSON.stringify(state));
    assert.match((await cli(home, "recut", "video.mp4", "--yes")).stderr, /More than one/);
  } finally { dbx.close(); op.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test("watch preserves items, scrubs failures and skips metadata writes while locked", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-watch-cli-"));
  try {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ opus: { apiKey: "secret-key", project: {} }, dropbox: { appKey: "secret-app", refreshToken: "secret-token" }, endpoints: { opus: "http://127.0.0.1:1", dropboxApi: "http://127.0.0.1:1", dropboxContent: "http://127.0.0.1:1" } }));
    const state = { items: { a: { name: "video", status: "failed", error: "secret-key https://example.com/shared" } } };
    const file = path.join(home, "state.json");
    fs.writeFileSync(file, JSON.stringify(state));
    const result = JSON.parse((await cli(home, "watch", "--notify")).stdout);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret-|https?:/);
    const after = JSON.parse(fs.readFileSync(file));
    assert.deepEqual(after.items, state.items);
    assert.ok(after.watchedAt); assert.ok(after.watchNotified);
    fs.mkdirSync(path.join(home, ".lock"));
    const bytes = fs.readFileSync(file, "utf8");
    await cli(home, "watch", "--notify");
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a plain watch writes nothing; only the routine's --notify pass records what it reported", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-watch-plain-"));
  try {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ opus: { apiKey: "k", project: {} }, dropbox: {}, folders: {}, notify: false }));
    const file = path.join(home, "state.json");
    fs.writeFileSync(file, JSON.stringify({ items: { a: { name: "v", status: "done", doneAt: "2026-11-05T00:00:00Z" } } }));
    const before = fs.readFileSync(file, "utf8");
    assert.equal(JSON.parse((await cli(home, "watch")).stdout).newlyDone.length, 1);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.equal(JSON.parse((await cli(home, "watch", "--notify")).stdout).newlyDone.length, 1);
    assert.equal(JSON.parse((await cli(home, "watch", "--notify")).stdout).newlyDone.length, 0);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
