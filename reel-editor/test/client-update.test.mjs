import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { updateClient, updateRelease, releaseEnvironment } from "../src/client-update.mjs";
import { newerRelease, releaseManifest, stableRelease, checkArchive } from "../src/release-feed.mjs";
import { maintenanceAgents, installMaintenance } from "../scripts/client-maintenance.mjs";
import { checkRuntime, clientSmoke } from "../scripts/client-smoke.mjs";
import { PKG_ROOT, writeJSON, readJSON } from "../src/util.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const OLD = "2026.11.08.1", NEXT = "2026.11.08.2", NEWEST = "2026.11.08.3";
const pinned = readJSON(path.join(PKG_ROOT, "runtime/runtime.json"));
const put = (file, data) => { if (file instanceof URL) file = fileURLToPath(file); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const json = (file, data) => put(file, JSON.stringify(data));
function setup(t, { changedRuntime = false, fail = "" } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "reel-updates-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const base = path.join(home, ".local/share/reel-editor"), state = path.join(home, ".reel/maintenance");
  const dir = (id) => path.join(base, "releases", id);
  const current = path.join(base, "current"), previous = path.join(base, "previous");
  const calls = [], notices = [], url = (f) => pathToFileURL(f).href;
  const env = { HOME: home, PATH: "/usr/bin:/bin", REEL_RELEASE: OLD, REEL_CLIENT_MODE: "1", REEL_PRESET: path.join(home, ".reel/my-brand.json") };
  const runtime = changedRuntime ? { ...pinned, id: "rt-next" } : pinned;
  put(path.join(base, "runtime", pinned.id, ".complete"), "ready");
  function archive(id, spec = runtime) {
    const src = path.join(home, "feed", id), app = path.join(src, "reel-editor");
    const files = { "bin/reel.mjs": "// offline cli\n", "scripts/client-smoke.mjs": "// offline smoke\n", "scripts/bootstrap-runtime.sh": "#!/bin/bash\n", "runtime/runtime.json": JSON.stringify(spec) };
    for (const [name, data] of Object.entries(files)) put(path.join(app, name), data);
    const artifact = path.join(home, "feed", `reel-editor-${id}.tar.gz`);
    const tar = spawnSync("/usr/bin/tar", ["-czf", artifact, "-C", src, "reel-editor"], { env: { ...process.env, COPYFILE_DISABLE: "1" }, encoding: "utf8" });
    assert.equal(tar.status, 0, tar.stderr);
    const bytes = fs.readFileSync(artifact);
    const manifest = { schema: 1, id, commit: "a".repeat(40), createdAt: new Date().toISOString(), runtime: spec,
      artifact: { name: path.basename(artifact), url: url(artifact), sha256: sha(bytes), bytes: bytes.length }, files: Object.fromEntries(Object.entries(files).map(([f, data]) => [f, sha(data)])), tests: { unit: "1324/1324", goldens: "6/6" } };
    const manifestFile = path.join(src, "release.json"); json(manifestFile, manifest);
    return { manifest, manifestFile, artifact, app };
  }
  function installed(id, spec = pinned) {
    const a = archive(id, spec); fs.cpSync(a.app, dir(id), { recursive: true });
    json(path.join(dir(id), "release.json"), a.manifest); put(path.join(dir(id), ".complete"), id);
    return a;
  }
  installed(OLD); fs.symlinkSync(dir(OLD), current);
  const feed = path.join(home, "feed/stable.json");
  function promote(id = NEXT, spec = runtime) {
    const a = archive(id, spec);
    json(feed, { id, releaseJson: url(a.manifestFile), sha256: sha(fs.readFileSync(a.manifestFile)) });
    return a;
  }
  promote();
  const run = (cmd, args, cwd, e) => {
    calls.push({ cmd, args, cwd, env: e });
    assert.ok(!["git", "npm", "npx"].includes(cmd), "release updates do not use git or package installation");
    if (cmd === "/usr/bin/tar") {
      const r = spawnSync(cmd, args, { encoding: "utf8" });
      if (r.status !== 0) throw new Error(r.stderr); return r.stdout;
    }
    if (args[0]?.endsWith("bootstrap-runtime.sh")) {
      if (fail === "bootstrap") throw new Error("bootstrap interrupted");
      // bootstrap-runtime.sh reads the release.json as its only argument and writes only .tools-complete.
      assert.deepEqual(args.slice(1), [path.join(cwd, "release.json")]);
      assert.ok(fs.existsSync(args[1]), "the release.json is in place before the tools step");
      put(path.join(e.REEL_RUNTIME, ".tools-complete"), "");
    }
    if (args[0]?.endsWith("scripts/runtime.mjs")) {
      assert.deepEqual(args.slice(1), ["speech", path.join(cwd, "release.json")]);
      assert.ok(fs.existsSync(path.join(e.REEL_RUNTIME, ".tools-complete")), "speech runs after the tools step");
      assert.equal(e.HF_HUB_OFFLINE, undefined, "the speech model download is not forced offline");
      put(path.join(e.REEL_RUNTIME, ".complete"), "ready");
    }
    if (args.includes("doctor") && fail === "activation") throw new Error("activation failed");
    if (args[0]?.endsWith("client-smoke.mjs") && fail === "smoke") throw new Error("smoke failed");
    return "";
  };
  return { home, base, state, current, previous, dir, feed: url(feed), env, run, calls, notices, promote, installed,
    app: dir(OLD), notify: (...args) => notices.push(args), lockWaitMs: 0, inUse: () => false };
}
const active = (u) => path.basename(fs.readlinkSync(u.current));
const txFile = (u) => path.join(u.state, "update-transaction.json");

for (const [a, b, expected] of [[NEXT, OLD, true], [OLD, NEXT, false], [OLD, OLD, false], ["2026.11.08.10", NEXT, true], ["bad", OLD, false]]) {
  test(`release id comparison: ${a} > ${b}`, () => assert.equal(Boolean(newerRelease(a, b)), expected));
}

test("release update verifies and stages offline, swaps links, preserves every client file", async (t) => {
  const u = setup(t);
  const protectedFiles = [".reel/my-brand.json", ".reel/keys.env", ".reel/env.sh", "Reels/videos/.seen/clip.done", "Content Studio/.studio/posts.jsonl", "Content Studio/.studio/used-photos.json"];
  for (const p of protectedFiles) put(path.join(u.home, p), `private ${p}`);
  assert.equal((await updateClient(u)).status, "updated");
  assert.equal(active(u), NEXT); assert.equal(path.basename(fs.readlinkSync(u.previous)), OLD);
  assert.ok(!fs.existsSync(txFile(u)));
  assert.ok(!fs.existsSync(path.join(u.state, "update.lock")));
  assert.equal(u.calls.filter((c) => c.args.includes("doctor")).length, 1);
  assert.ok(u.calls.filter((c) => c.cmd.endsWith("/bin/node") && !c.args[0].endsWith("scripts/runtime.mjs")).every((c) => c.env.REEL_RELEASE === NEXT && c.env.HF_HUB_OFFLINE === "1"));
  // The kit installer's repair path (scripts/runtime.mjs installApp) reads this marker as JSON.
  const marker = readJSON(path.join(u.dir(NEXT), ".complete"));
  const manifest = readJSON(path.join(u.dir(NEXT), "release.json"));
  assert.equal(marker.manifest, sha(JSON.stringify(manifest)));
  assert.equal(marker.artifact, manifest.artifact.sha256);
  for (const p of protectedFiles) assert.equal(fs.readFileSync(path.join(u.home, p), "utf8"), `private ${p}`);
});

test("same and older release feeds do nothing, without even downloading the manifest", async (t) => {
  const u = setup(t); u.promote(OLD);
  const stable = readJSON(new URL(u.feed)); stable.releaseJson = "file:///missing"; json(new URL(u.feed), stable);
  assert.equal((await updateClient(u)).status, "unchanged"); assert.equal(u.calls.length, 0);
});

test("a changed runtime is bootstrapped in its own folder before any smoke check", async (t) => {
  const u = setup(t, { changedRuntime: true });
  assert.equal((await updateClient(u)).status, "updated");
  const index = u.calls.findIndex((c) => c.args[0]?.endsWith("bootstrap-runtime.sh"));
  assert.ok(index >= 0); assert.ok(u.calls.slice(0, index).every((c) => !c.args[0]?.endsWith("client-smoke.mjs")));
  assert.ok(fs.existsSync(path.join(u.base, "runtime", pinned.id, ".complete")));
  const speech = u.calls.findIndex((c) => c.args[0]?.endsWith("scripts/runtime.mjs") && c.args[1] === "speech");
  assert.ok(speech > index, "Python, Whisper and the speech model are prepared after the tools");
  assert.ok(fs.existsSync(path.join(u.base, "runtime", "rt-next", ".complete")));
});

test("the updater calls the real tools and speech steps the way they read their arguments", () => {
  // The fake run above only checks what the updater sends; these pin what the real scripts expect.
  const boot = fs.readFileSync(path.join(PKG_ROOT, "scripts/bootstrap-runtime.sh"), "utf8");
  assert.match(boot, /^MANIFEST="\$\{1:\?/m);
  assert.doesNotMatch(boot, /--app|--home/);
  const rt = fs.readFileSync(path.join(PKG_ROOT, "scripts/runtime.mjs"), "utf8");
  assert.match(rt, /const \[action, file, \.\.\.args\] = process\.argv\.slice\(2\)/);
  assert.match(rt, /if \(action === "speech"\) return prepareSpeech\(home, m\)/);
});

for (const fail of ["smoke", "activation", "bootstrap"]) test(`failed ${fail} keeps the old editor and suppresses the failed id`, async (t) => {
  const u = setup(t, { fail, changedRuntime: true });
  assert.equal((await updateClient(u)).status, "failed"); assert.equal(active(u), OLD);
  assert.equal(readJSON(path.join(u.state, "failed-release.json")).id, NEXT);
  assert.match(fs.readFileSync(path.join(u.state, "STATUS.txt"), "utf8"), /previous editor is kept/);
  u.calls.length = 0;
  assert.equal((await updateClient(u)).status, "failed-id"); assert.equal(u.calls.length, 0);
  if (fail !== "activation") assert.ok(!fs.existsSync(path.join(u.dir(NEXT), ".complete")));
});

test("a newer id is attempted after a failed id and a rollback restores the older previous link", async (t) => {
  const u = setup(t, { fail: "activation" });
  const older = "2026.11.07.1"; u.installed(older); fs.symlinkSync(u.dir(older), u.previous);
  await updateClient(u);
  assert.equal(path.basename(fs.readlinkSync(u.previous)), older);
  u.promote(NEWEST);
  assert.equal((await updateClient(u)).status, "failed");
  assert.equal(readJSON(path.join(u.state, "failed-release.json")).id, NEWEST);
});

for (const job of ["watcher", "studio"]) test(`${job} lock defers activation and the prepared transaction resumes offline`, async (t) => {
  const u = setup(t);
  const lock = path.join(u.home, job === "watcher" ? "Reels/videos/.seen/.lock" : "Content Studio/.studio/run.lock");
  fs.mkdirSync(lock, { recursive: true });
  assert.equal((await updateClient(u)).status, "busy"); assert.equal(active(u), OLD);
  assert.equal(readJSON(txFile(u)).phase, "ready");
  fs.rmSync(lock, { recursive: true });
  assert.equal((await updateClient({ ...u, feed: "file:///missing" })).status, "updated"); assert.equal(active(u), NEXT);
});

test("custom watcher and studio roots are checked and admission races are rechecked", async (t) => {
  const u = setup(t);
  u.env.REEL_WATCH_ROOT = path.join(u.home, "Custom Reels"); u.env.REEL_STUDIO = path.join(u.home, "Custom Studio");
  const lock = path.join(u.env.REEL_STUDIO, ".studio/run.lock"); fs.mkdirSync(lock, { recursive: true });
  assert.equal((await updateClient(u)).status, "busy"); assert.equal(active(u), OLD);
});

test("update lock is respected and a dead updater lock is recovered without waiting six hours", async (t) => {
  const u = setup(t);
  put(path.join(u.state, "update.lock"), JSON.stringify({ pid: process.pid }));
  assert.equal((await updateClient(u)).status, "busy"); assert.equal(active(u), OLD);
  fs.rmSync(path.join(u.state, "update.lock"));
  put(path.join(u.state, "updater.lock"), JSON.stringify({ pid: 2147483647 }));
  assert.equal((await updateClient(u)).status, "updated");
});

for (const phase of ["switching", "switched"]) test(`killed ${phase} transaction rolls back before consulting the feed`, async (t) => {
  const u = setup(t); u.installed(NEXT);
  if (phase === "switched") { fs.unlinkSync(u.current); fs.symlinkSync(u.dir(NEXT), u.current); }
  json(txFile(u), { phase, from: OLD, to: NEXT, oldPrevious: null });
  assert.equal((await updateClient({ ...u, feed: "file:///missing" })).status, "recovered");
  assert.equal(active(u), OLD); assert.equal(readJSON(path.join(u.state, "failed-release.json")).id, NEXT);
  assert.equal(u.calls.length, 0);
});

test("committed recovery keeps the working release and finishes cleanup", async (t) => {
  const u = setup(t); u.installed(NEXT);
  fs.unlinkSync(u.current); fs.symlinkSync(u.dir(NEXT), u.current); fs.symlinkSync(u.dir(OLD), u.previous);
  json(txFile(u), { phase: "committed", from: OLD, to: NEXT });
  assert.equal((await updateClient({ ...u, feed: "file:///missing" })).status, "recovered"); assert.equal(active(u), NEXT);
});

test("interrupted preparing recovery removes only its own incomplete candidate", async (t) => {
  const u = setup(t);
  put(path.join(u.dir(NEXT), "half-a-file"), "partial");
  put(path.join(u.base, "releases", `.update-${NEXT}`, "partial.tar.gz"), "partial");
  json(txFile(u), { phase: "preparing", from: OLD, to: NEXT, oldPrevious: null });
  assert.equal((await updateClient(u)).status, "updated"); assert.equal(active(u), NEXT);
  assert.ok(!fs.existsSync(path.join(u.dir(NEXT), "half-a-file")));
});

for (const kill of ["extract", "bootstrap", "switched"]) test(`a real killed updater recovers after ${kill}`, async (t) => {
  const u = setup(t, { changedRuntime: kill === "bootstrap" });
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { updateClient } from ${JSON.stringify(new URL("../src/client-update.mjs", import.meta.url).href)};
    import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
    const opts = JSON.parse(process.env.TEST_OPTIONS);
    await updateClient({ ...opts, notify: () => {}, run: (cmd, args, cwd) => {
      if (cmd === '/usr/bin/tar') { const r = spawnSync(cmd, args); if (r.status) throw Error('tar'); if (process.env.TEST_KILL === 'extract') process.kill(process.pid, 'SIGKILL'); }
      if (args[0]?.endsWith('bootstrap-runtime.sh') && process.env.TEST_KILL === 'bootstrap' || args.includes('doctor') && process.env.TEST_KILL === 'switched') process.kill(process.pid, 'SIGKILL');
      return '';
    }});
  `], { env: { ...process.env, TEST_KILL: kill, TEST_OPTIONS: JSON.stringify({ home: u.home, app: u.app, state: u.state, env: u.env, feed: u.feed }) }, stdio: ["ignore", "pipe", "pipe"] });
  const [code, signal] = await once(child, "exit");
  assert.equal(code, null); assert.equal(signal, "SIGKILL");
  if (kill === "switched") {
    assert.equal(active(u), NEXT); assert.equal(readJSON(txFile(u)).phase, "switched");
    assert.equal((await updateClient({ ...u, feed: "file:///missing" })).status, "recovered"); assert.equal(active(u), OLD);
  } else {
    assert.equal(active(u), OLD); assert.equal(readJSON(txFile(u)).phase, "preparing");
    assert.equal((await updateClient(u)).status, "updated"); assert.equal(active(u), NEXT);
  }
});

test("pruning retains active, previous, legacy folders and any release with an open job", async (t) => {
  const u = setup(t), free = "2026.11.06.1", busy = "2026.11.07.1";
  u.installed(free); u.installed(busy); put(path.join(u.base, "releases/legacy-20261101/my-work"), "original");
  assert.equal((await updateClient({ ...u, inUse: (dir) => path.basename(dir) === busy })).status, "updated");
  assert.ok(!fs.existsSync(u.dir(free))); assert.ok(fs.existsSync(u.dir(busy)));
  assert.ok(fs.existsSync(u.dir(OLD))); assert.ok(fs.existsSync(u.dir(NEXT)));
  assert.ok(fs.existsSync(path.join(u.base, "releases/legacy-20261101/my-work")));
});

for (const what of ["manifest", "artifact", "files"]) test(`bad ${what} hash never changes current or marks a candidate complete`, async (t) => {
  const u = setup(t); const a = u.promote();
  if (what === "artifact") fs.appendFileSync(a.artifact, "corruption");
  if (what === "manifest") fs.appendFileSync(a.manifestFile, " ");
  if (what === "files") {
    a.manifest.files["bin/reel.mjs"] = "0".repeat(64); json(a.manifestFile, a.manifest);
    const stable = readJSON(new URL(u.feed)); stable.sha256 = sha(fs.readFileSync(a.manifestFile)); json(new URL(u.feed), stable);
  }
  assert.equal((await updateClient(u)).status, "failed"); assert.equal(active(u), OLD);
  assert.ok(!fs.existsSync(path.join(u.dir(NEXT), ".complete")));
});

test("stub fetch checks feed, manifest digest, ids and HTTPS", async (t) => {
  const u = setup(t), a = u.promote(); const calls = [];
  const stable = { id: NEXT, releaseJson: "https://releases.test/release.json", sha256: sha(fs.readFileSync(a.manifestFile)) };
  const fetcher = async (url) => { calls.push(url); return new Response(url.endsWith("stable.json") ? JSON.stringify(stable) : fs.readFileSync(a.manifestFile)); };
  const s = await stableRelease({ feed: "https://releases.test/stable.json", fetcher });
  assert.equal((await releaseManifest(s, { fetcher })).manifest.id, NEXT); assert.equal(calls.length, 2);
  await assert.rejects(stableRelease({ feed: "http://unsafe.test", fetcher }), /not supported/);
  await assert.rejects(releaseManifest({ ...s, id: OLD }, { fetcher }), /two different/);
});

test("legacy kits announce the new installer and retain their git update path", async (t) => {
  const u = setup(t), calls = []; fs.unlinkSync(u.current);
  u.env = { HOME: u.home, PATH: "/usr/bin:/bin" };
  json(path.join(u.state, "client.json"), { app: u.app, dropFolders: [] });
  const run = (cmd, args) => { calls.push({ cmd, args }); return args[0] === "rev-parse" ? args[1] === "--show-toplevel" ? u.home : "old" : ""; };
  assert.equal((await updateClient({ ...u, run })).status, "unchanged");
  assert.ok(calls.some((c) => c.cmd === "git" && c.args[0] === "pull"));
  assert.match(fs.readFileSync(path.join(u.state, "STATUS.txt"), "utf8"), /A new installer is ready, ask Greg for your updated kit/);
  assert.ok(!fs.existsSync(u.current));
});

test("release maintenance agents keep their labels and shell paths across switches", (t) => {
  const u = setup(t);
  const a = maintenanceAgents({ app: u.dir(OLD), home: u.home }), b = maintenanceAgents({ app: u.dir(NEXT), home: u.home });
  assert.deepEqual(a, b);
  assert.doesNotMatch(a[0].plist, /releases\/|\/node<\/string>/);
  assert.ok(a[0].plist.includes(path.join(u.home, "Ai/reel-editor")));
  assert.match(a[0].plist, /env.sh/);
  const agents = installMaintenance({ app: u.dir(NEXT), home: u.home, run: () => ({ status: 0 }) });
  assert.equal(agents.length, 2);
  assert.equal(readJSON(path.join(u.state, "client.json")).app, path.join(u.home, "Ai/reel-editor"));
});

test("maintenance shell loads env.sh PATH in a clean launchd environment", (t) => {
  const u = setup(t), bin = path.join(u.home, "fake tools"), output = path.join(u.home, "called.json");
  put(path.join(bin, "node"), `#!/bin/bash\nprintf '%s\\n' "$REEL_RELEASE" "$PATH" "$@" > "$OUTPUT"\n`); fs.chmodSync(path.join(bin, "node"), 0o755);
  put(path.join(u.home, ".reel/env.sh"), `export PATH='${bin}:/usr/bin:/bin'\nexport REEL_RELEASE=${NEXT}\n`);
  const shell = 'if [ -f "$HOME/.reel/env.sh" ]; then . "$HOME/.reel/env.sh" || exit 1; fi\nexec node "$1/scripts/client-maintenance.mjs" "${@:2}"';
  assert.ok(maintenanceAgents({ home: u.home, app: u.app })[0].plist.includes(shell.replaceAll('"', '&quot;')));
  const r = spawnSync("/bin/bash", ["-c", shell, "reel-maintenance", path.join(u.home, "Ai/reel-editor"), "update", "--state", u.state], { env: { HOME: u.home, PATH: "/usr/bin:/bin", OUTPUT: output }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(output, "utf8"), new RegExp(NEXT.replaceAll(".", "\\.")));
});

function fakeTools(t) {
  const u = setup(t), e = releaseEnvironment(readJSON(path.join(u.app, "release.json")), { home: u.home, env: u.env });
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, opts }); const name = path.basename(cmd);
    const stdout = name === "node" ? `v${pinned.tools.node.version}\n` : name === "python" ? args[0] === "--version" ? `Python ${pinned.python.version}\n` : "" : `${name} version ${pinned.tools[name].version} Copyright\n`;
    return { status: 0, stdout };
  };
  return { ...u, e, calls, run };
}

test("smoke runs the exact runtime binaries and imports Whisper offline", (t) => {
  const u = fakeTools(t); checkRuntime({ app: u.app, env: u.e, run: u.run });
  assert.equal(u.calls.length, 5);
  assert.ok(u.calls.every((c) => c.cmd.startsWith(u.e.REEL_RUNTIME + "/") && c.opts.env.HF_HUB_OFFLINE === "1"));
  assert.deepEqual(u.calls.at(-1).args, ["-c", "import faster_whisper"]);
});
for (const name of ["node", "ffmpeg", "ffprobe", "python", "whisper"]) test(`smoke fails on a missing or different ${name}`, (t) => {
  const u = fakeTools(t);
  assert.throws(() => checkRuntime({ app: u.app, env: u.e, run: (cmd, args, opts) => {
    if (name === "whisper" ? args[0] === "-c" : path.basename(cmd) === name) return { status: name === "whisper" ? 1 : 0, stdout: "different version" };
    return u.run(cmd, args, opts);
  } }), /installer again/);
});
test("smoke preserves legacy behavior, rejects missing runtime markers and keeps today's adapter checks", async (t) => {
  const u = fakeTools(t);
  checkRuntime({ env: {}, run: () => assert.fail("legacy tools were checked") });
  assert.throws(() => checkRuntime({ env: { REEL_RELEASE: NEXT } }), /missing/);
  fs.rmSync(path.join(u.e.REEL_RUNTIME, ".complete"));
  assert.throws(() => checkRuntime({ app: u.app, env: u.e, run: u.run }), /not ready/);
  await clientSmoke({ env: {}, run: () => ({ status: 0 }) });
});

// Minimal tar headers let us exercise unsafe entries without extracting any of them.
function tarEntry(name, { type = "0", link = "", data = "" } = {}) {
  const h = Buffer.alloc(512); h.write(name, 0, 100); h.write("0000755\0", 100); h.write(`${Buffer.byteLength(data).toString(8).padStart(11, "0")}\0`, 124);
  h.fill(32, 148, 156); h.write(type, 156); h.write(link, 157, 100); h.write("ustar\0", 257);
  h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([h, Buffer.from(data), Buffer.alloc((512 - Buffer.byteLength(data) % 512) % 512)]);
}
for (const [name, entries] of [
  ["traversal", [tarEntry("reel-editor/../../escape")]],
  ["absolute", [tarEntry("/tmp/escape")]],
  ["outside link", [tarEntry("reel-editor/link", { type: "2", link: "../../escape" })]],
  ["link parent", [tarEntry("reel-editor/link", { type: "2", link: "other" }), tarEntry("reel-editor/link/child")]],
  ["device", [tarEntry("reel-editor/device", { type: "3" })]],
]) test(`archive rejects ${name} before extraction`, async (t) => {
  const u = setup(t), file = path.join(u.home, "unsafe.tar.gz"); put(file, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
  await assert.rejects(checkArchive(file), /archive/);
});
test("archive accepts internal npm bin symlinks", async (t) => {
  const u = setup(t), file = path.join(u.home, "safe.tar.gz");
  put(file, gzipSync(Buffer.concat([tarEntry("reel-editor/node_modules/.bin/tool", { type: "2", link: "../tool/bin.mjs" }), tarEntry("reel-editor/node_modules/tool/bin.mjs"), Buffer.alloc(1024)])));
  await checkArchive(file);
});

test("waiting retries the locks and activates only after editing stops", async (t) => {
  const u = setup(t), lock = path.join(u.home, "Reels/videos/.seen/.lock");
  fs.mkdirSync(lock, { recursive: true }); let waits = 0;
  const r = await updateClient({ ...u, lockWaitMs: 5000, wait: async () => {
    waits++; assert.equal(active(u), OLD); fs.rmSync(lock, { recursive: true });
  } });
  assert.equal(r.status, "updated"); assert.equal(waits, 1);
});

test("ready recovery detects a modified manifest even when its file hashes were changed with it", async (t) => {
  const u = setup(t), lock = path.join(u.home, "Reels/videos/.seen/.lock");
  fs.mkdirSync(lock, { recursive: true }); assert.equal((await updateClient(u)).status, "busy");
  const file = path.join(u.dir(NEXT), "release.json"); const m = readJSON(file); m.commit = "b".repeat(40); json(file, m);
  fs.rmSync(lock, { recursive: true });
  assert.equal((await updateClient(u)).status, "failed"); assert.equal(active(u), OLD);
});

test("corrupt transactions and transactions for an unrelated active release are kept for repair", async (t) => {
  const u = setup(t); put(txFile(u), "not json");
  assert.equal((await updateClient(u)).status, "failed"); assert.equal(fs.readFileSync(txFile(u), "utf8"), "not json");
  json(txFile(u), { phase: "committed", from: "2026.11.07.1", to: NEXT });
  assert.equal((await updateClient(u)).status, "failed"); assert.equal(readJSON(txFile(u)).phase, "committed");
  assert.equal(active(u), OLD);
});

test("REEL_RELEASE=dev keeps git behavior even when a release pointer also exists", async (t) => {
  const u = setup(t); let pulled = false;
  const run = (cmd, args) => {
    assert.equal(cmd, "git"); if (args[0] === "pull") pulled = true;
    return args[0] === "rev-parse" ? args[1] === "--show-toplevel" ? u.home : "old" : "";
  };
  assert.equal((await updateClient({ ...u, env: { REEL_RELEASE: "dev" }, run })).status, "unchanged");
  assert.equal(pulled, true); assert.equal(active(u), OLD);
});

test("runtime checks use actual local fake executables with no inherited tool paths", (t) => {
  const u = setup(t), e = releaseEnvironment(readJSON(path.join(u.app, "release.json")), { home: u.home, env: {} });
  for (const name of ["node", "ffmpeg", "ffprobe"]) {
    const file = path.join(e.REEL_RUNTIME, "bin", name);
    const output = name === "node" ? `v${pinned.tools.node.version}` : `${name} version ${pinned.tools[name].version}`;
    put(file, `#!/bin/bash\nprintf '%s\\n' '${output}'\n`); fs.chmodSync(file, 0o755);
  }
  const python = path.join(e.REEL_RUNTIME, "venv/bin/python");
  put(python, `#!/bin/bash\n[ "$HF_HUB_OFFLINE" = 1 ] || exit 1\nif [ "$1" = --version ]; then printf '%s\\n' 'Python ${pinned.python.version}'; else [ "$2" = 'import faster_whisper' ]; fi\n`); fs.chmodSync(python, 0o755);
  checkRuntime({ app: u.app, env: e });
});
