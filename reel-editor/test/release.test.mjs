import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { allowedFile, copyApp, hashFiles, buildRelease, publishRelease, buildKits, loadArtifact, testCounts } from "../scripts/release.mjs";
import { fileHash, currentRelease, verifyRelease } from "../src/release.mjs";
import { releaseSection } from "../src/doctor.mjs";
import { clientStatus } from "../src/client-status.mjs";
import { requireBaselines, MOMENTS } from "../scripts/golden.mjs";
import { hyperframesBin } from "../src/render.mjs";
import { transcribe, whisperPin } from "../src/transcribe.mjs";
import { PKG_ROOT } from "../src/util.mjs";

const ID = "2026.11.08.1";
const TAP = "# tests 7\n# pass 7\n# fail 0\n# skipped 0\n";
const GOLDENS = MOMENTS.map((_, i) => `same     frame-0${i + 1}.png  matches`).join("\n");
const json = (file, value) => put(file, JSON.stringify(value, null, 2) + "\n");
function put(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file; }
function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reel-release-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function exec(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stderr || r.error || ""}`);
  return r.stdout;
}
function repo(t, { code = false } = {}) {
  const app = path.join(tmp(t), "app");
  fs.mkdirSync(app);
  if (code) copyApp(PKG_ROOT, app);
  else {
    json(path.join(app, "package.json"), { name: "fake-release", scripts: { test: "node --test" }, devDependencies: { pngjs: "7.0.0" } });
    json(path.join(app, "package-lock.json"), { lockfileVersion: 3 });
    put(path.join(app, "src/main.mjs"), "export const hello = 'world';\n");
    put(path.join(app, "install.sh"), "#!/bin/bash\necho pinned-installer\n");
    put(path.join(app, "kit/Install Reel Editor.command"), "#!/bin/bash\necho pinned-launcher\n");
    put(path.join(app, "scripts/helper.swift"), "// fake helper source\n");
    for (const name of ["Start Here.html", "Setup Guide.html"]) put(path.join(app, "kit", name), "<h1>Release guide</h1>\n<!-- studio -->\nMetricool\n<!-- /studio -->\n");
    fs.mkdirSync(path.join(app, "runtime"));
    fs.copyFileSync(path.join(PKG_ROOT, "runtime/runtime.json"), path.join(app, "runtime/runtime.json"));
  }
  put(path.join(app, ".gitignore"), "dist/\nnode_modules/\n");
  exec("git", ["init", "--quiet"], { cwd: app });
  exec("git", ["add", "."], { cwd: app });
  exec("git", ["-c", "user.name=Release Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"], { cwd: app });
  return app;
}
function fakeTools(app, overrides = {}) {
  const calls = [];
  const run = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, ...opts });
    if (cmd === "npm" && args[0] === "test") return overrides.unit ?? TAP;
    if (cmd === process.execPath && args[0] === "scripts/golden.mjs") return overrides.goldens ?? GOLDENS;
    if (cmd === "/bin/bash" && args[0] === "scripts/build-helpers.sh") {
      const helper = put(path.join(app, "dist/helpers/darwin-arm64/helper"), "prebuilt-helper");
      fs.chmodSync(helper, 0o755);
      json(path.join(app, "dist/helpers/darwin-arm64/helpers.json"), { helper: { sha256: fileHash(helper), source: "a".repeat(64) } });
      return "";
    }
    if (cmd === "npm" && args[0] === "ci") {
      assert.notEqual(opts.cwd, app, "npm ci must never change the checkout");
      assert.ok(!args.includes("--omit=dev"), "pngjs is needed at runtime");
      put(path.join(opts.cwd, "node_modules/hyperframes/cli.mjs"), "fake-cli");
      fs.mkdirSync(path.join(opts.cwd, "node_modules/.bin"), { recursive: true });
      fs.symlinkSync("../hyperframes/cli.mjs", path.join(opts.cwd, "node_modules/.bin/hyperframes"));
      put(path.join(opts.cwd, "node_modules/.cache/SECRET"), "do not ship cache");
      return "";
    }
    if (cmd === "gh") { assert.fail("tests must never invoke real gh"); }
    return exec(cmd, args, opts);
  };
  return { run, calls };
}
function built(t, options) {
  const app = repo(t, options), tools = fakeTools(app);
  // A stand-in render browser, so tests never download Chrome.
  const browser = (stage) => put(path.join(stage, "assets/browser/chrome-headless-shell-mac-arm64/chrome-headless-shell"), "fake chrome");
  const release = buildRelease({ app, id: ID, run: tools.run, browser });
  return { app, release, ...tools };
}

// These are secret *markers*, never real personal files or credentials.
test("release allowlist excludes personal files, footage, music, caches and checkout dependencies", (t) => {
  const root = tmp(t), app = path.join(root, "checkout"), stage = path.join(root, "stage");
  const denied = [".env.local", ".git/config", "brands/greg.json", "presets/pingel-v2.json", "voice/greg.md", "examples/greg.mp4", "examples/content-studio/Photos/greg.jpg", "music/greg.mp3", "assets/music/greg.mp3", "node_modules/.cache/key", "node_modules/old/index.js", "dist/release/old.tar.gz", "runtime/keys.env", "src/.env.local"];
  const allowed = ["src/main.mjs", "bin/reel.mjs", "scripts/helper.swift", "kit/Start Here.html", "presets/clean.json", "assets/vendor/gsap.min.js", "assets/fonts/Inter.ttf", "assets/sfx/slam.wav", "voice/default.md", "dictionary.json", "runtime/runtime.json", "runtime/requirements.lock", "examples/sample-words.json", "examples/accept/script.json", "dist/helpers/darwin-arm64/helper", "dist/helpers/darwin-arm64/helpers.json", "install.sh", "package.json", "package-lock.json"];
  for (const file of denied) put(path.join(app, file), "SECRET_MARKER");
  for (const file of allowed) put(path.join(app, file), "public");
  put(path.join(root, "outside"), "SECRET_MARKER");
  fs.symlinkSync(path.join(root, "outside"), path.join(app, "src/linked-secret.mjs"));
  copyApp(app, stage);
  for (const file of allowed) assert.equal(fs.readFileSync(path.join(stage, file), "utf8"), "public", file);
  for (const file of denied) assert.equal(fs.existsSync(path.join(stage, file)), false, file);
  assert.equal(fs.existsSync(path.join(stage, "src/linked-secret.mjs")), false);
  for (const file of Object.keys(hashFiles(stage))) assert.notEqual(fs.readFileSync(path.join(stage, file), "utf8"), "SECRET_MARKER");
  for (const base of ["presets/pingel-brand.json", "presets/pingel-runway.json"]) assert.equal(allowedFile(base), true, `${base} is the engine base client brands extend`);
  assert.equal(allowedFile("examples/accept/talk.wav"), false, "acceptance speech must be generated on the client's Mac");
});

test("dirty repo, including sibling files and untracked files, stops before any release checks", (t) => {
  const app = repo(t), { run, calls } = fakeTools(app);
  put(path.join(app, "untracked-secret-marker"), "fake");
  assert.throws(() => buildRelease({ app, id: ID, run }), /untracked-secret-marker/);
  assert.equal(calls.length, 1);
});

test("build produces the contracted sidecar, single-folder archive, file hashes and executable helpers", (t) => {
  const { app, release, run, calls } = built(t);
  assert.equal(release.schema, 1); assert.equal(release.id, ID);
  assert.match(release.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(release.runtime, JSON.parse(fs.readFileSync(path.join(app, "runtime/runtime.json"))));
  assert.deepEqual(release.tests, { unit: "7/7", goldens: "6/6" });
  assert.ok(release.files["node_modules/.bin/hyperframes"]);
  assert.ok(!Object.keys(release.files).some((p) => p.includes(".cache")));
  const { archive } = loadArtifact(app, ID);
  assert.equal(fileHash(archive), release.artifact.sha256);
  assert.equal(fs.statSync(archive).size, release.artifact.bytes);
  const out = tmp(t);
  exec("tar", ["-xzf", archive, "-C", out]);
  assert.deepEqual(fs.readdirSync(out), ["reel-editor"]);
  const extracted = path.join(out, "reel-editor");
  assert.deepEqual(verifyRelease({ app: extracted }), []);
  assert.equal(currentRelease({ app: extracted }).verified, true);
  assert.ok(fs.statSync(path.join(extracted, "dist/helpers/darwin-arm64/helper")).mode & 0o111);
  assert.equal(fs.existsSync(path.join(app, "node_modules")), false);
  assert.equal(fs.existsSync(calls.find((c) => c.cmd === "npm" && c.args[0] === "ci").cwd), false, "temporary app cleaned up");
  assert.throws(() => buildRelease({ app, id: ID, run }), /already exists/);
});

test("unit and golden failures cannot produce an artifact, including missing and newly written baselines", (t) => {
  for (const overrides of [{ unit: "# tests 7\n# pass 6\n# fail 1\n" }, { goldens: GOLDENS.replace(/^same/, "written") }, { goldens: GOLDENS.split("\n").slice(1).join("\n") }]) {
    const app = repo(t), { run, calls } = fakeTools(app, overrides);
    assert.throws(() => buildRelease({ app, id: ID, run }), /Every unit|six golden/);
    assert.equal(fs.existsSync(path.join(app, "dist/release", ID)), false);
    assert.equal(calls.some((c) => c.cmd === "npm" && c.args[0] === "ci"), false);
  }
  assert.throws(() => testCounts(TAP, GOLDENS.replaceAll("frame-06", "frame-05")), /six golden/);
});

test("failed dependency install cleans staging and leaves no release", (t) => {
  const app = repo(t), { run } = fakeTools(app);
  let staging;
  assert.throws(() => buildRelease({ app, id: ID, run: (cmd, args, opts) => {
    if (cmd === "npm" && args[0] === "ci") { staging = opts.cwd; throw new Error("fake install failure"); }
    return run(cmd, args, opts);
  } }), /fake install failure/);
  assert.equal(fs.existsSync(staging), false);
  assert.equal(fs.existsSync(path.join(app, "dist/release", ID)), false);
});

test("invalid release ids are rejected before creating paths or running tools beyond git status", (t) => {
  const app = repo(t), { run } = fakeTools(app);
  for (const id of ["../escape", "2026.11.08.0", "latest", "reel-2026.11.08.1"]) assert.throws(() => buildRelease({ app, id, run }), /release number/);
});

test("publish previews both files and requires --yes; stub gh receives exactly one create with the saved commit", (t) => {
  const { app, release } = built(t);
  const bin = path.join(tmp(t), "gh"), log = bin + ".json";
  put(bin, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`);
  fs.chmodSync(bin, 0o755);
  const stub = (cmd, args) => { assert.equal(cmd, "gh"); return exec(bin, args); };
  assert.throws(() => publishRelease({ app, id: ID, run: stub }), /Add --yes/);
  assert.equal(fs.existsSync(log), false);
  publishRelease({ app, id: ID, yes: true, run: stub });
  const args = JSON.parse(fs.readFileSync(log));
  assert.deepEqual(args.slice(0, 3), ["release", "create", `reel-${ID}`]);
  assert.ok(args.includes(release.commit)); assert.ok(args.includes("gpingelbiz/Ai"));
  const { archive } = loadArtifact(app, ID);
  fs.appendFileSync(archive, "changed");
  assert.throws(() => publishRelease({ app, id: ID, yes: true, run: () => assert.fail() }), /does not match/);
});

test("release reader and doctor show dev, verified, modified, missing and unsafe files", (t) => {
  const app = tmp(t);
  assert.deepEqual(currentRelease({ app }), { id: "dev" });
  assert.equal(releaseSection({ app }), "Release: dev");
  const data = { schema: 1, id: ID, commit: "a".repeat(40), runtime: { id: "rt-test" }, files: {} };
  put(path.join(app, "src/a.mjs"), "original"); data.files["src/a.mjs"] = fileHash(path.join(app, "src/a.mjs"));
  json(path.join(app, "release.json"), data);
  assert.deepEqual(currentRelease({ app }), { id: ID, commit: data.commit, runtime: data.runtime, verified: true });
  assert.equal(releaseSection({ app }), `Release: ${ID} (aaaaaaa), runtime rt-test, files verified`);
  put(path.join(app, "src/a.mjs"), "changed");
  assert.deepEqual(verifyRelease({ app }), ["src/a.mjs"]);
  assert.match(releaseSection({ app }), /changed or missing files: src\/a.mjs/);
  fs.rmSync(path.join(app, "src/a.mjs"));
  assert.deepEqual(verifyRelease({ app }), ["src/a.mjs"]);
  data.files["../escape"] = "a".repeat(64); json(path.join(app, "release.json"), data);
  assert.ok(verifyRelease({ app }).includes("../escape"));
  put(path.join(app, "release.json"), "broken");
  assert.deepEqual(verifyRelease({ app }), ["release.json"]);
  assert.match(releaseSection({ app }), /could not be read/);
});

test("verification refuses symlinks escaping the app even when their target has the expected bytes", (t) => {
  const root = tmp(t), app = path.join(root, "app"); fs.mkdirSync(app);
  const target = put(path.join(root, "outside"), "same content");
  fs.symlinkSync(target, path.join(app, "escape"));
  json(path.join(app, "release.json"), { schema: 1, id: ID, commit: "a".repeat(40), runtime: { id: "rt" }, files: { escape: fileHash(target) } });
  assert.deepEqual(verifyRelease({ app }), ["escape"]);
  assert.throws(() => hashFiles(app), /outside the app/);
});

test("STATUS keeps a release header and each job's existing message", (t) => {
  const root = tmp(t), paths = { root, state: path.join(root, "state") };
  clientStatus(paths, "filming", "waiting"); clientStatus(paths, "health", "ready");
  const lines = fs.readFileSync(path.join(root, "STATUS.txt"), "utf8").split("\n");
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT\S+ Reel Editor \(release dev\) Read the posting note below\.$/);
  assert.match(lines.join("\n"), /filming: waiting/); assert.match(lines.join("\n"), /health: ready/);
});

test("missing golden frames fail without writing baselines; --update explicitly permits creation", (t) => {
  const dir = tmp(t);
  assert.throws(() => requireBaselines({ dir }), /Missing golden frames: frame-01/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.doesNotThrow(() => requireBaselines({ dir, update: true }));
  for (let i = 1; i <= 6; i++) put(path.join(dir, `frame-0${i}.png`), "fake baseline");
  assert.doesNotThrow(() => requireBaselines({ dir }));
});

test("client renderer cannot fall back to npx; developer installs keep that fallback", (t) => {
  const app = tmp(t);
  assert.throws(() => hyperframesBin({ app, env: { REEL_CLIENT_MODE: "1" } }), /renderer is missing/);
  assert.deepEqual(hyperframesBin({ app, env: {} }), ["npx", "hyperframes"]);
  const local = put(path.join(app, "node_modules/.bin/hyperframes"), "fake");
  assert.deepEqual(hyperframesBin({ app, env: { REEL_CLIENT_MODE: "1" } }), [local]);
});

test("Whisper gets the runtime's pinned model and revision; Python supports that revision", async (t) => {
  const runtime = tmp(t), output = path.join(runtime, "words.json"), log = path.join(runtime, "args.json");
  const pin = { model: "example/pinned-whisper", revision: "a".repeat(40) };
  json(path.join(runtime, "runtime.json"), { whisper: pin });
  const python = put(path.join(runtime, "python"), `#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(log)},JSON.stringify(args));fs.writeFileSync(args[args.indexOf('-o')+1],JSON.stringify({words:[{text:'Hello',start:0,end:1}]}));\n`);
  fs.chmodSync(python, 0o755);
  const old = { REEL_RUNTIME: process.env.REEL_RUNTIME, REEL_PYTHON: process.env.REEL_PYTHON, REEL_CLIENT_MODE: process.env.REEL_CLIENT_MODE };
  t.after(() => { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  process.env.REEL_RUNTIME = runtime; process.env.REEL_PYTHON = python; process.env.REEL_CLIENT_MODE = "1";
  await transcribe("fake.wav", { engine: "faster-whisper", out: output });
  const args = JSON.parse(fs.readFileSync(log));
  assert.equal(args[args.indexOf("--model") + 1], pin.model);
  assert.equal(args[args.indexOf("--revision") + 1], pin.revision);
  await assert.rejects(transcribe("fake.wav", { engine: "hyperframes", out: output, hyperframesBin: ["npx", "hyperframes"] }), /installed renderer/);
  assert.equal(whisperPin({}), null);
  json(path.join(runtime, "runtime.json"), { whisper: { model: "bad", revision: "main" } });
  assert.throws(() => whisperPin({ REEL_RUNTIME: runtime }), /saved version/);
});

test("brand and generic kit builders require a release or an explicit development preview", (t) => {
  const root = tmp(t), brand = json(path.join(root, "brand.json"), { name: "Jane", colors: { text: "#FFFFFF", accent: "#AAAAAA" } });
  const r = spawnSync(process.execPath, ["scripts/brand-kit.mjs", brand, "--out", root], { cwd: PKG_ROOT, encoding: "utf8" });
  assert.equal(r.status, 2); assert.match(r.stderr, /--release/);
  const generic = spawnSync("/bin/bash", ["scripts/package-kit.sh", root], { cwd: PKG_ROOT, encoding: "utf8" });
  assert.equal(generic.status, 2); assert.match(generic.stderr, /--release/);
  assert.equal(fs.readdirSync(root).some((f) => f.endsWith(".zip")), false);
});

test("registry kits use the selected release builder, installer and guides with no network", (t) => {
  const { app, release, run } = built(t, { code: true });
  const root = tmp(t), registry = path.join(root, "kits.json");
  json(path.join(root, "brand.json"), { name: "Jane Doe", handle: "@janedoe", colors: { text: "#FFFFFF", accent: "#E94B8A" } });
  put(path.join(root, "guide.md"), "NOT FILLED IN YET\n");
  json(registry, [{ brand: "brand.json", studio: null, out: "reel-kit" }, { brand: "brand.json", studio: "guide.md", out: "studio-kit" }]);
  const commands = [];
  // Only git, tar, local Node, ditto and unzip can run in this test; no services or downloads.
  const kitRun = (cmd, args, opts) => {
    commands.push({ cmd, args, opts });
    assert.ok(["tar", process.execPath].includes(cmd));
    return run(cmd, args, opts);
  };
  buildKits({ app, id: ID, clients: registry, run: kitRun });
  const kitCommands = commands.filter((c) => c.cmd === process.execPath);
  assert.equal(kitCommands.length, 2);
  assert.notEqual(kitCommands[0].opts.cwd, app);
  for (const [folder, name] of [["reel-kit", "Jane Doe Reel Editor Kit"], ["studio-kit", "Jane Doe Reels and Posts Kit"]]) {
    const zip = path.join(root, folder, name + ".zip");
    const contents = (file) => exec("unzip", ["-p", zip, `${name}/${file}`]);
    assert.deepEqual(JSON.parse(contents("release.json")), release);
    assert.equal(contents("install.sh"), fs.readFileSync(path.join(app, "install.sh"), "utf8"));
    assert.match(contents("Brand/my-brand.json"), /Jane Doe/);
    assert.match(contents("Setup Guide.html"), /Jane Doe/);
    assert.match(fs.readFileSync(path.join(root, folder, name + " - send-out message.txt"), "utf8"), /tested release 2026\.11\.08\.1/);
    assert.doesNotMatch(exec("unzip", ["-Z1", zip]), /__MACOSX/);
  }
  // A newer checkout cannot change a generic kit built from the saved archive.
  put(path.join(app, "kit/Start Here.html"), "NEW UNTESTED GUIDE");
  const pinnedBrand = path.join(root, "direct-brand");
  exec(process.execPath, [path.join(PKG_ROOT, "scripts/brand-kit.mjs"), path.join(root, "brand.json"), "--release", path.join(app, "dist/release", ID, "release.json"), "--out", pinnedBrand], { cwd: PKG_ROOT });
  const pinnedPage = exec("unzip", ["-p", path.join(pinnedBrand, "Jane Doe Reel Editor Kit.zip"), "Jane Doe Reel Editor Kit/Start Here.html"]);
  assert.doesNotMatch(pinnedPage, /NEW UNTESTED GUIDE/);
  const out = path.join(root, "generic");
  exec("/bin/bash", [path.join(PKG_ROOT, "scripts/package-kit.sh"), out, "--release", path.join(app, "dist/release", ID, "release.json")], { cwd: PKG_ROOT });
  const page = exec("unzip", ["-p", path.join(out, "Reel Editor Kit.zip"), "Reel Editor Kit/Start Here.html"]);
  assert.doesNotMatch(page, /NEW UNTESTED GUIDE/);
  assert.equal(fs.existsSync(kitCommands[0].opts.cwd), false, "extracted release removed after all kits");
});

test("dirty files elsewhere in the same repository also block a build from reel-editor", (t) => {
  const parent = repo(t), app = path.join(parent, "reel-editor");
  fs.mkdirSync(app);
  put(path.join(parent, "sibling-change.txt"), "fake change");
  const { run, calls } = fakeTools(app);
  assert.throws(() => buildRelease({ app, id: ID, run }), /sibling-change\.txt/);
  assert.equal(calls.length, 1);
});

test("an altered sidecar runtime cannot be mixed with an older archive in a kit", (t) => {
  const { app, release, run } = built(t);
  const root = tmp(t), registry = json(path.join(root, "kits.json"), []);
  release.runtime.id = "rt-untested";
  json(path.join(app, "dist/release", ID, "release.json"), release);
  assert.throws(() => buildKits({ app, id: ID, clients: registry, run }), /saved release files do not match/);
});

test("the Python transcription entry point loads exactly the requested snapshot before Whisper", (t) => {
  const root = tmp(t), output = path.join(root, "words.json");
  const code = `
import json, os, runpy, subprocess, sys, types
hub = types.ModuleType('huggingface_hub')
def snapshot_download(**kwargs):
    assert kwargs['repo_id'] == 'example/model'
    assert kwargs['revision'] == 'a' * 40
    assert 'model.bin' in kwargs['allow_patterns']
    return '/fake/pinned-snapshot'
hub.snapshot_download = snapshot_download
sys.modules['huggingface_hub'] = hub
whisper = types.ModuleType('faster_whisper')
class WhisperModel:
    def __init__(self, model, **kwargs):
        assert model == '/fake/pinned-snapshot'
    def transcribe(self, *args, **kwargs):
        word = types.SimpleNamespace(word=' Hello', start=0.1, end=0.5, probability=0.9)
        return [types.SimpleNamespace(words=[word])], types.SimpleNamespace(language='en', duration=1.0)
whisper.WhisperModel = WhisperModel
sys.modules['faster_whisper'] = whisper
def fake_ffmpeg(args, **kwargs):
    assert args[0] == 'ffmpeg'
    open(args[-1], 'wb').close()
subprocess.run = fake_ffmpeg
sys.argv = ['transcribe_words.py', 'fake.wav', '-o', ${JSON.stringify(output)}, '--model', 'example/model', '--revision', 'a' * 40]
runpy.run_path(${JSON.stringify(path.join(PKG_ROOT, "scripts/transcribe_words.py"))}, run_name='__main__')
`;
  exec("python3", ["-c", code]);
  const transcript = JSON.parse(fs.readFileSync(output));
  assert.equal(transcript.revision, "a".repeat(40));
  assert.equal(transcript.words[0].text, "Hello");
});
