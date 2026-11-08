import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PKG_ROOT } from "../src/util.mjs";

function setup(t, job = 'echo job >> "$HOME/calls"') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "watch-safety-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, ".local/bin"), scripts = path.join(home, "scripts"), raw = path.join(home, "raw");
  for (const dir of [bin, scripts, raw]) fs.mkdirSync(dir, { recursive: true });
  function stub(name, body, dir = bin) { const file = path.join(dir, name); fs.writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 }); }
  fs.copyFileSync(path.join(PKG_ROOT, "scripts/watch-folder.sh"), path.join(scripts, "watch-folder.sh"));
  stub("watch-reel.sh", job, scripts);
  stub("ffprobe", "echo 5.25");
  stub("sleep", ":");
  const clip = path.join(raw, "clip.mov"); fs.writeFileSync(clip, "video");
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, REEL_WATCH_RAW: raw, REEL_WATCH_ROOT: path.join(home, "Reels"), REEL_WATCH_WAIT_CHECKS: "6", REEL_WATCH_WAIT_SECONDS: "0", REEL_WATCH_SETTLE_SECONDS: "0" };
  const run = () => spawnSync("/bin/bash", [path.join(scripts, "watch-folder.sh")], { env, encoding: "utf8", timeout: 10000 });
  const seen = path.join(home, "Reels/videos/.seen");
  const markers = () => fs.readdirSync(seen).filter((f) => /\.(done|failed)$/.test(f));
  const calls = () => fs.existsSync(path.join(home, "calls")) ? fs.readFileSync(path.join(home, "calls"), "utf8").trim().split("\n") : [];
  return { home, raw, clip, env, stub, run, seen, markers, calls };
}

test("scanner waits before taking the marker identity and edits a chunked copy only once", (t) => {
  const f = setup(t);
  f.stub("sleep", 'if [ ! -f "$HOME/grew" ]; then printf more >> "$HOME/raw/clip.mov"; touch "$HOME/grew"; fi');
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.calls(), ["job"]);
  const stat = fs.statSync(f.clip);
  assert.deepEqual(f.markers(), [`clip.mov@${stat.size}-${Math.floor(stat.mtimeMs / 1000)}.done`]);
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.calls(), ["job"]);
});

test("a copy still growing at the deadline is left for the next scan without a failure", (t) => {
  const f = setup(t);
  f.stub("sleep", 'printf more >> "$HOME/raw/clip.mov"');
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Still copying/);
  assert.deepEqual(f.calls(), []); assert.deepEqual(f.markers(), []);
  assert.equal(fs.existsSync(`${f.clip} - why it failed.txt`), false);
  f.stub("sleep", ":");
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.calls(), ["job"]);
  assert.equal(f.markers().length, 1);
});

test("matching size alone is insufficient while the modified time is changing", (t) => {
  const f = setup(t);
  f.env.NODE_BIN = process.execPath;
  f.stub("sleep", '"$NODE_BIN" -e \'const fs=require("fs"),f=process.env.HOME+"/raw/clip.mov",s=fs.statSync(f);fs.utimesSync(f,s.atime,new Date(s.mtimeMs+1000))\'');
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.calls(), []); assert.deepEqual(f.markers(), []);
});

test("a real edit failure keeps its marker and leaves a plain note beside the original", (t) => {
  const f = setup(t, 'echo job >> "$HOME/calls"; exit 1');
  assert.equal(f.run().status, 0);
  assert.equal(f.markers().length, 1); assert.match(f.markers()[0], /\.failed$/);
  assert.match(fs.readFileSync(`${f.clip} - why it failed.txt`, "utf8"), /edit stopped[\s\S]*original is safe/);
  assert.equal(fs.readFileSync(f.clip, "utf8"), "video");
  assert.equal(f.run().status, 0); assert.deepEqual(f.calls(), ["job"]);
});

test("a paused copy without a readable duration stays unmarked for the next scan", (t) => {
  const f = setup(t); f.stub("ffprobe", 'echo "N/A"');
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.calls(), []);
  assert.deepEqual(f.markers(), []);
  assert.equal(fs.existsSync(`${f.clip} - why it failed.txt`), false);
});

test("a child that defers copying does not create a failed marker", (t) => {
  const f = setup(t, "exit 75");
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.markers(), []);
});

test("replacing the input during an edit leaves the new copy for the next scan", (t) => {
  const f = setup(t, 'echo job >> "$HOME/calls"; if [ ! -f "$HOME/changed" ]; then printf more >> "$1"; touch "$HOME/changed"; fi');
  assert.equal(f.run().status, 0); assert.deepEqual(f.markers(), []);
  assert.equal(f.run().status, 0); assert.equal(f.markers().length, 1);
  assert.equal(f.run().status, 0); assert.deepEqual(f.calls(), ["job", "job"]);
});

for (const suffix of ["done", "failed"]) {
  test(`old name-only ${suffix} markers still skip the clip`, (t) => {
    const f = setup(t); fs.mkdirSync(f.seen, { recursive: true }); fs.writeFileSync(path.join(f.seen, `clip.mov.${suffix}`), "");
    assert.equal(f.run().status, 0); assert.deepEqual(f.calls(), []);
  });
}

test("scanner loads the shared environment before selecting drop folders", (t) => {
  const f = setup(t, 'printf "%s\\n" "$REEL_WATCH_CTA" >> "$HOME/calls"');
  fs.mkdirSync(path.join(f.home, ".reel"));
  fs.writeFileSync(path.join(f.home, ".reel/env.sh"), 'export REEL_WATCH_CTA="Ask for the guide"\nexport REEL_WATCH_RAW="$HOME/raw"\n');
  f.env.REEL_WATCH_RAW = path.join(f.home, "wrong");
  assert.equal(f.run().status, 0); assert.deepEqual(f.calls(), ["Ask for the guide"]);
});

test("low disk pauses before editing, leaves the exact note, and never records a failed edit", (t) => {
  const f = setup(t);
  fs.copyFileSync(path.join(PKG_ROOT, "scripts/watch-reel.sh"), path.join(f.home, "scripts/watch-reel.sh"));
  f.env.REEL_WATCH_FAST = "1";
  f.stub("df", 'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nvolume 40000000 33000000 7000000 83%% /\\n"');
  f.stub("reel", 'echo should-not-run >> "$HOME/calls"; exit 1');
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.calls(), []); assert.deepEqual(f.markers(), []);
  assert.equal(fs.readFileSync(`${f.clip} - why it failed.txt`, "utf8"), "Editing is paused because this Mac is nearly full. Your original is safe.\n");
  assert.equal(fs.readFileSync(f.clip, "utf8"), "video");
  assert.equal(f.run().status, 0); assert.deepEqual(f.calls(), []);
});

test("the disk admission gate allows exactly 8 GB and fails safely when space is unknown", (t) => {
  const f = setup(t);
  f.env.REEL_WATCH_FAST = "1"; f.env.REEL_WATCH_CAPTION = "0"; f.env.REEL_WATCH_PRUNE_DAYS = "0";
  f.stub("reel", 'echo admitted >> "$HOME/calls"; exit 1');
  f.stub("osascript", "exit 0");
  const run = () => spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts/watch-reel.sh"), f.clip], { env: f.env, encoding: "utf8" });
  f.stub("df", 'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nvolume 40000000 32187500 7812500 80%% /\\n"');
  assert.equal(run().status, 1); assert.deepEqual(f.calls(), ["admitted"]);
  f.stub("df", "exit 1");
  assert.equal(run().status, 75); assert.deepEqual(f.calls(), ["admitted"]);
  assert.match(fs.readFileSync(`${f.clip} - why it failed.txt`, "utf8"), /free space could not be checked/);
});

for (const mode of ["reel", "broll", "runway", "long"]) {
  test(`client ${mode} jobs keep their caption style and CTA despite #v2`, (t) => {
    const f = setup(t);
    f.stub("node", `exec '${process.execPath}' "$@"`);
    f.stub("reel", 'printf "%s\\n" "$@" > "$HOME/args"; exit 1');
    f.stub("osascript", "exit 0");
    fs.mkdirSync(path.join(f.home, ".reel"));
    const preset = path.join(f.home, ".reel/brand.json");
    fs.writeFileSync(preset, JSON.stringify({ name: "brand-example", captions: { style: "reveal", quiet: true } }));
    fs.writeFileSync(path.join(f.home, ".reel/env.sh"), `export PATH="$HOME/.local/bin:/usr/bin:/bin"\nexport REEL_CLIENT_MODE=1\nexport REEL_PRESET="$HOME/.reel/brand.json"\nexport REEL_WATCH_CTA="Get the guide"\n`);
    fs.writeFileSync(path.join(f.home, ".zshrc"), 'export REEL_WATCH_CTA="Wrong CTA"\nexport REEL_PRESET="pingel-brand"\n');
    const tagged = path.join(f.raw, "clip #v2.mov"); fs.renameSync(f.clip, tagged);
    const env = { ...f.env, REEL_WATCH_FAST: "1", REEL_WATCH_PRUNE_DAYS: "0", REEL_WATCH_CAPTION: "0" };
    const run = () => spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts/watch-reel.sh"), tagged, mode], { env, encoding: "utf8" });
    assert.equal(run().status, 1);
    let args = fs.readFileSync(path.join(f.home, "args"), "utf8");
    assert.doesNotMatch(args, /pingel-|--caption-style/);
    assert.match(args, /--cta\nGet the guide/);
    fs.writeFileSync(preset, JSON.stringify({ name: "brand-example" }));
    assert.equal(run().status, 1);
    args = fs.readFileSync(path.join(f.home, "args"), "utf8");
    assert.match(args, new RegExp(`--caption-style\\n${mode === "reel" ? "pop" : "reveal"}`));
  });
}
