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
    assert.deepEqual(dbx.names("/Opus Clips/Podcast Ep 4"), ["Clip 1 - Hook number 1 why.mp4", "Clip 1 - caption.txt"]);
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
