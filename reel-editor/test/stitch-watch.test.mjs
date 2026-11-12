import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scanStitch, waitStitchClip } from "../src/stitch-watch.mjs";
import { recordOrder } from "../src/stitch-order.mjs";
import { clientPaths, DROP_FOLDERS, agentPlist, clientEnv } from "../src/clients.mjs";
import { PKG_ROOT, readJSON } from "../src/util.mjs";

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "stitch-watch-")); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, "raw-stitch"), seen = path.join(home, "videos/.seen"); fs.mkdirSync(root);
  let time = 100000, status = 0, calls = [], copying = false;
  const deps = { seen, job: "/fake/watch-reel.sh", env: { REEL_WATCH_FAST: "1", REEL_STITCH_QUIET: "90" }, now: () => time, record: (f, opts) => recordOrder(f, { ...opts, creationTime: async (file) => file.includes("early") ? 1 : 2 }), ready: async () => !copying, execute: async (_, args, opts) => { calls.push({ args, env: opts.env }); return { code: status }; } };
  const folder = (name) => { const dir = path.join(root, name); fs.mkdirSync(dir); return dir; };
  const drop = (dir, name, bytes = "clip") => { const file = path.join(dir, name); fs.writeFileSync(file, bytes); return file; };
  return { home, root, seen, deps, folder, drop, calls, advance: (seconds) => time += seconds * 1000, status: (code) => status = code, copying: (v) => copying = v, scan: () => scanStitch(root, deps) };
}

test("quiet window writes no markers, new arrivals reset it, one settled ordered reel renders once", async (t) => {
  const f = setup(t), dir = f.folder("a reel #nomusic"); f.drop(dir, "later.mov"); f.drop(dir, "early.mov");
  assert.equal(await f.scan(), 0); assert.deepEqual(fs.readdirSync(f.seen), []);
  f.advance(80); f.drop(dir, "third.mov"); assert.equal(await f.scan(), 0);
  f.advance(89); assert.equal(await f.scan(), 0);
  f.advance(1); assert.equal(await f.scan(), 1); assert.equal(f.calls.length, 1);
  assert.deepEqual(readJSON(path.join(dir, ".stitch-ready.json")).clips.map((c) => c.name), ["early.mov", "later.mov", "third.mov"]);
  assert.equal(f.calls[0].args.at(-1), "stitch");
  assert.equal(await f.scan(), 0); assert.equal(f.calls.length, 1);
});

test("settling, child deferrals and changes during settling leave no marker", async (t) => {
  const f = setup(t), dir = f.folder("reel"); f.drop(dir, "one.mov"); await f.scan(); f.advance(90);
  f.copying(true); await f.scan(); assert.deepEqual(fs.readdirSync(f.seen), []);
  f.copying(false); f.status(75); await f.scan(); assert.deepEqual(fs.readdirSync(f.seen), []);
  f.drop(dir, "third.mov"); await f.scan(); f.advance(90);
  f.deps.ready = async () => { f.drop(dir, "new.mov"); return true; }; await f.scan(); assert.deepEqual(fs.readdirSync(f.seen), []);
});

test("adding, removing and numbering files changes markers; an ordinary rename keeps the completed identity", async (t) => {
  const f = setup(t), dir = f.folder("reel"), a = f.drop(dir, "a.mov"), b = f.drop(dir, "b.mov");
  await f.scan(); f.advance(90); await f.scan(); assert.equal(f.calls.length, 1);
  const rename = path.join(dir, "renamed.mov"); fs.renameSync(a, rename); await f.scan(); assert.equal(f.calls.length, 1);
  fs.renameSync(rename, path.join(dir, "2.mov")); fs.renameSync(b, path.join(dir, "1.mov")); await f.scan(); assert.equal(f.calls.length, 2);
  f.drop(dir, "3.mov"); await f.scan(); f.advance(90); await f.scan(); assert.equal(f.calls.length, 3);
  fs.rmSync(path.join(dir, "2.mov")); await f.scan(); assert.equal(f.calls.length, 4);
  fs.writeFileSync(path.join(dir, "1.mov"), "different content"); await f.scan(); f.advance(90); await f.scan(); assert.equal(f.calls.length, 5);
});

test("failure notes stay inside reel folders, holds stay distinct and a content change retries", async (t) => {
  const f = setup(t), dir = f.folder("reel"); f.drop(dir, "one.mov"); await f.scan(); f.advance(90); f.status(1);
  await f.scan(); assert.match(fs.readFileSync(path.join(dir, "why it failed.txt"), "utf8"), /original clips are safe/);
  await f.scan(); assert.equal(f.calls.length, 1);
  f.drop(dir, "one.mov", "new content"); await f.scan(); f.advance(90); f.status(76); fs.writeFileSync(path.join(dir, "why it's held.txt"), "No speech"); await f.scan();
  assert.ok(fs.readdirSync(f.seen).some((s) => s.endsWith(".held"))); assert.equal(fs.existsSync(path.join(dir, "why it failed.txt")), false);
});

test("loose reels archive only after success, Used is never scanned, next drop is fresh", async (t) => {
  const f = setup(t); f.drop(f.root, "one.mov"); await f.scan(); f.advance(90); f.status(1); await f.scan(); assert.ok(fs.existsSync(path.join(f.root, "one.mov")));
  f.drop(f.root, "two.mov"); await f.scan(); f.advance(90); f.status(0); await f.scan();
  assert.equal(fs.existsSync(path.join(f.root, "one.mov")), false);
  const used = path.join(f.root, "Used", fs.readdirSync(path.join(f.root, "Used"))[0]); assert.ok(fs.existsSync(path.join(used, "one.mov"))); assert.ok(fs.existsSync(path.join(used, "two.mov")));
  f.drop(f.root, "next.mov"); await f.scan(); f.advance(90); await f.scan(); assert.equal(f.calls.length, 3);
});

test("a source replaced during an edit is never marked or archived", async (t) => {
  const f = setup(t); const file = f.drop(f.root, "one.mov"); await f.scan(); f.advance(90);
  f.deps.execute = async () => { fs.writeFileSync(file, "new bytes after render started"); return { code: 0 }; };
  await f.scan(); assert.deepEqual(fs.readdirSync(f.seen), []); assert.ok(fs.existsSync(file));
});

test("waitStitchClip requires matching size and mtime, audio probe duration and both stable checks", async (t) => {
  const f = setup(t), file = f.drop(f.root, "one.mov"); let sleeps = 0, probes = 0;
  const deps = { env: { REEL_WATCH_WAIT_CHECKS: "5", REEL_WATCH_SETTLE_SECONDS: "0", REEL_WATCH_WAIT_SECONDS: "0" }, execute: async () => { probes++; return { out: "2.5\n" }; }, sleep: async () => { sleeps++; }, now: () => Date.now() + 10000 };
  assert.equal(await waitStitchClip(file, deps), true); assert.equal(sleeps, 2); assert.equal(probes, 1);
  assert.equal(await waitStitchClip(file, { ...deps, execute: async () => ({ out: "N/A" }) }), false);
  assert.equal(await waitStitchClip(file, { ...deps, sleep: async () => fs.appendFileSync(file, "more") }), false);
  assert.equal(await waitStitchClip(file, { env: { REEL_WATCH_FAST: "1" }, execute: () => assert.fail() }), true);
});

test("shell scanner reaches stitch jobs with hosted client settings and leaves legacy markers alone", (t) => {
  const f = setup(t), bin = path.join(f.home, ".local/bin"); fs.mkdirSync(bin, { recursive: true });
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  stub("node", `exec '${process.execPath}' "$@"`);
  stub("reel", 'printf "%s|%s|%s\\n" "$1" "$REEL_CLIENT" "$REEL_PRESET" >> "$HOME/calls"; exit 1');
  stub("ffprobe", "echo 1"); stub("osascript", "exit 0");
  const brand = { name: "Test Client" }, p = clientPaths(brand, { REEL_CLIENTS: path.join(f.home, "clients"), REEL_CLIENTS_DESKTOP: path.join(f.home, "Desktop") });
  for (const d of p.drops) fs.mkdirSync(d.dir, { recursive: true }); fs.writeFileSync(p.env, clientEnv(brand, p));
  const reel = path.join(p.root, "raw-stitch", "a #nomusic"); fs.mkdirSync(reel); fs.writeFileSync(path.join(reel, "one.mov"), "video");
  const env = { ...process.env, HOME: f.home, PATH: `${bin}:/usr/bin:/bin`, REEL_CLIENTS: path.dirname(p.root), REEL_WATCH_ROOT: f.home, REEL_WATCH_RAW_STITCH: f.root, REEL_WATCH_FAST: "1", REEL_STITCH_QUIET: "0", REEL_WATCH_CAPTION: "0", REEL_WATCH_PRUNE_DAYS: "0", REEL_CLIENT_MODE: "0" };
  for (const suffix of ["RAW", "RAW_BROLL", "RAW_CAROUSEL", "RAW_LONG", "RAW_YOUTUBE", "RAW_VSL", "RAW_RUNWAY", "RAW_OWN_BROLL"]) env[`REEL_WATCH_${suffix}`] = path.join(f.home, suffix);
  const r = spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts/watch-folder.sh")], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr); assert.match(fs.readFileSync(path.join(f.home, "calls"), "utf8"), new RegExp(`stitch\\|Test Client\\|${p.preset}`));
  assert.ok(fs.existsSync(path.join(reel, "why it failed.txt")));
  assert.ok(fs.readdirSync(path.join(p.root, "videos/.seen")).some((s) => s.startsWith("stitch-") && s.endsWith(".failed")));
});

test("hosted folders and interval are installed, client kits keep their original folder contract", (t) => {
  const f = setup(t), p = clientPaths({ name: "Test" }, { REEL_CLIENTS: f.home, REEL_CLIENTS_DESKTOP: path.join(f.home, "Desktop") });
  assert.ok(p.drops.some((d) => d.label === "Raw - Stitch Clips")); assert.equal(DROP_FOLDERS.some(([dir]) => dir === "raw-stitch"), false);
  assert.match(agentPlist({ label: "x", script: "/s", env: {}, watch: p.drops.map((d) => d.dir), log: "/l" }), /StartInterval<\/key><integer>60/);
  for (const clientMode of ["0", "1"]) {
    const r = spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts/install-watcher.sh"), "--dry-run"], { env: { ...process.env, HOME: f.home, REEL_CLIENT_MODE: clientMode }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    if (clientMode === "0") { assert.match(r.stdout, /raw-stitch/); assert.match(r.stdout, /StartInterval<\/key><integer>60/); }
    else { assert.doesNotMatch(r.stdout, /raw-stitch|StartInterval/); }
  }
});

test("stitch shell jobs honor folder tags and deliver the sheet into a numbered Stitch folder", (t) => {
  const f = setup(t), bin = path.join(f.home, ".local/bin"); fs.mkdirSync(bin, { recursive: true });
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  stub("node", `exec '${process.execPath}' "$@"`); stub("osascript", "exit 0");
  const reel = path.join(f.root, "lesson #broll #nomusic"); fs.mkdirSync(reel);
  fs.writeFileSync(path.join(reel, "clip.mov"), "clip");
  fs.writeFileSync(path.join(bin, "reel"), `#!${process.execPath}\nconst fs=require('fs'),p=require('path'),a=process.argv.slice(2);fs.writeFileSync(process.env.HOME+'/args',JSON.stringify(a));const work=a[a.indexOf('--out')+1],name=a[a.indexOf('--title')+1];fs.mkdirSync(p.join(work,'renders'),{recursive:true});fs.writeFileSync(p.join(work,'renders',name+'.mp4'),'render');fs.writeFileSync(p.join(work,'plan.json'),JSON.stringify({hook:{text:'A real hook'},broll:[]}));for(const n of ['Order.txt','Order - check this.jpg'])fs.writeFileSync(p.join(a[1],n),'sheet');\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: f.home, PATH: `${bin}:/usr/bin:/bin`, REEL_WATCH_ROOT: f.home, REEL_WATCH_DONE: path.join(f.home, "Desktop"), REEL_WATCH_FAST: "1", REEL_WATCH_CAPTION: "0", REEL_WATCH_PRUNE_DAYS: "0", REEL_CLIENT_MODE: "0", REEL_CLIENT: "", REEL_PRESET: "clean" };
  const r = spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts/watch-reel.sh"), reel, "stitch"], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, 0, r.stderr + fs.readFileSync(path.join(f.home, "watch.log"), "utf8"));
  const args = readJSON(path.join(f.home, "args")); assert.equal(args[0], "stitch"); assert.ok(args.includes("--broll")); assert.ok(args.includes("--no-deliver")); assert.equal(args.includes("--music-dir"), false);
  const delivered = path.join(f.home, "Desktop", fs.readdirSync(path.join(f.home, "Desktop"))[0]);
  assert.match(path.basename(delivered), / Stitch 1$/); assert.ok(fs.existsSync(path.join(delivered, "Order - check this.jpg"))); assert.ok(fs.existsSync(path.join(delivered, "A real hook.mp4")));
});

test("the installed main watcher creates Greg's shortcut and never creates it on a kit Mac", (t) => {
  const f = setup(t), bin = path.join(f.home, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "launchctl"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  for (const mode of ["1", "0"]) {
    const home = path.join(f.home, `mac-${mode}`), env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, REEL_CLIENT_MODE: mode, REEL_WATCH_ROOT: path.join(home, "Reels"), REEL_WATCH_MUSIC: path.join(home, "Reels/music") };
    for (const suffix of ["RAW", "RAW_BROLL", "RAW_CAROUSEL", "RAW_LONG", "RAW_YOUTUBE", "RAW_VSL", "RAW_RUNWAY", "RAW_OWN_BROLL", "RAW_STITCH"]) env[`REEL_WATCH_${suffix}`] = path.join(home, "Reels", suffix === "RAW_STITCH" ? "raw-stitch" : suffix);
    const r = spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts/install-watcher.sh")], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const link = path.join(home, "Desktop/Reels/Raw - Stitch Clips");
    assert.equal(fs.existsSync(link), mode === "0"); assert.equal(fs.existsSync(path.join(home, "Reels/raw-stitch")), mode === "0");
    if (mode === "0") assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(home, "Reels/raw-stitch")));
  }
});

test("finished reels use cached content identities and do not wait or launch a job again", async (t) => {
  const f = setup(t), dir = f.folder("reel"); f.drop(dir, "one.mov"); await f.scan(); f.advance(90); await f.scan();
  assert.ok(readJSON(path.join(dir, ".stitch-order.json")).clips[0].key);
  f.deps.ready = () => assert.fail("unchanged finished clips are already settled");
  f.deps.execute = () => assert.fail("finished reel must not run again");
  assert.equal(await f.scan(), 0);
  fs.renameSync(path.join(dir, "one.mov"), path.join(dir, "renamed.mov"));
  assert.equal(await f.scan(), 0);
});
