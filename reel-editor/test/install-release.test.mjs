import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrateKeys, readManifest, switchRelease, verifyFiles, verifyModel } from "../scripts/runtime.mjs";

const app = fileURLToPath(new URL("..", import.meta.url));
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sq = (s) => `'${s.replaceAll("'", "'\\''")}'`;
function put(file, value, executable = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode: executable ? 0o755 : 0o644 });
}
function tar(source, output, name) {
  const r = spawnSync("tar", ["-czf", output, "-C", source, name], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-install-")), home = path.join(dir, "person's home");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "fakes"), brand = path.join(dir, "Brand"), manifest = path.join(dir, "release.json");
  fs.mkdirSync(home);
  for (const name of ["sudo", "brew", "xcode-select", "swiftc", "git", "npm", "npx"]) put(path.join(bin, name), `#!/bin/bash\necho ${name} >> "$HOME/forbidden"\nexit 99\n`, true);
  put(path.join(bin, "uname"), '#!/bin/bash\nif [ "$1" = -s ]; then echo Darwin; else echo "${TEST_ARCH:-arm64}"; fi\n', true);
  put(path.join(bin, "sw_vers"), '#!/bin/bash\necho "${TEST_MACOS:-14.0}"\n', true);
  put(path.join(bin, "curl"), `#!/bin/bash
while [ $# -gt 0 ]; do
 case "$1" in --output) OUT="$2"; shift ;; file://*) URL="$1" ;; esac
 shift
done
echo "$URL" >> "$HOME/downloads"
[ -n "$URL" ] || exit 91
exec /bin/cp "\${URL#file://}" "$OUT"
`, true);
  for (const name of ["launchctl", "plutil"]) {
    // Real macOS plutil reads JSON before Node exists. Other platforms use a data-only fake.
    if (name === "plutil" && process.platform === "darwin") continue;
    put(path.join(bin, name), name === "plutil" ? `#!${process.execPath}
const fs = require('fs'); const a=process.argv.slice(2);
if (a[0] === '-lint') process.exit(0);
let value=JSON.parse(fs.readFileSync(a.at(-1),'utf8')); for(const key of a[1].split('.')) value=value[key];
if(value === undefined) process.exit(1); const out=a[4]; const text=a[2] === 'json' ? JSON.stringify(value) : String(value);
if(out==='-') console.log(text); else fs.writeFileSync(out,text);
` : '#!/bin/bash\nexit 0\n', true);
  }
  const tools = {}, source = path.join(dir, "tool-source");
  const tool = (name, contents, kind) => {
    let archive = path.join(dir, `${name}.${kind === "file" ? "bin" : kind}`);
    if (kind === "file") put(archive, contents, true);
    else {
      const folder = path.join(source, name);
      put(path.join(folder, name === "node" ? "bin/node" : name), contents, true);
      if (name === "node") for (const cmd of ["npm", "npx"]) put(path.join(folder, "bin", cmd), '#!/bin/bash\necho npm >> "$HOME/forbidden"\nexit 99\n', true);
      if (kind === "zip") {
        const r = spawnSync("zip", ["-q", archive, name], { cwd: folder }); assert.equal(r.status, 0);
      } else tar(source, archive, name);
    }
    const bytes = fs.readFileSync(archive);
    tools[name] = { version: "test", url: pathToFileURL(archive).href, sha256: hash(bytes), kind,
      ...(kind === "tar.gz" ? { strip: 1 } : { bin: name }) };
  };
  tool("node", `#!/bin/bash\nexec ${sq(process.execPath)} "$@"\n`, "tar.gz");
  tool("ffmpeg", "#!/bin/bash\nexit 0\n", "zip");
  tool("ffprobe", "#!/bin/bash\nexit 0\n", "zip");
  tool("yt-dlp", "#!/bin/bash\nexit 0\n", "file");
  tool("cloudflared", "#!/bin/bash\nexit 0\n", "tar.gz");
  tool("uv", `#!/bin/bash
echo "$*" >> "$HOME/uv-calls"
if [ "$1" = python ]; then
 mkdir -p "$UV_PYTHON_INSTALL_DIR/bin"
 cat > "$UV_PYTHON_INSTALL_DIR/bin/python3" <<'PYTHON'
#!/bin/bash
repo="models--$(printf '%s' "$3" | sed 's@/@--@g')"
mkdir -p "$5/$repo/blobs" "$5/$repo/snapshots/$4"
echo pinned-model > "$5/model-download"
digest="$(shasum -a 256 "$5/model-download")"; digest="\${digest%% *}"
mv "$5/model-download" "$5/$repo/blobs/$digest"
ln -sf "../../blobs/$digest" "$5/$repo/snapshots/$4/model.bin"
PYTHON
 chmod +x "$UV_PYTHON_INSTALL_DIR/bin/python3"
elif [ "$1" = venv ]; then
 mkdir -p "$4/bin"
 ln -s "$UV_PYTHON_INSTALL_DIR/bin/python3" "$4/bin/python"
elif [ "$1" = pip ] && [ "\${TEST_KILL_SPEECH:-}" = 1 ]; then
 kill -KILL "$PPID"
 exit 1
fi
`, "tar.gz");
  const releaseSource = path.join(dir, "release-source"), releaseApp = path.join(releaseSource, "reel-editor");
  put(path.join(releaseApp, "bin/reel.mjs"), `import fs from 'node:fs'; import path from 'node:path';
const home=process.env.HOME, args=process.argv.slice(2);
if(args[0]==='accept') {
 if(process.env.TEST_FAIL_ACCEPT) { console.error('The sample speech could not be transcribed.'); process.exit(1); }
 const dir=path.join(home,'Reels/install-test'); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'sample.mp4'),'fake reel');
 console.log('Editing ready (release '+process.env.REEL_RELEASE+')');
} else if(args[0]==='broll-shotlist') fs.writeFileSync(args[2], 'neutral shot list');
else throw Error('Unexpected reel command');
`);
  put(path.join(releaseApp, "runtime/requirements.lock"), "faster-whisper==1.2.1 --hash=sha256:fake\n");
  put(path.join(releaseApp, "dictionary.json"), '{"powerWords":[]}');
  // The posting setup the installer runs after the test reel; it records that it ran and with which answers.
  put(path.join(releaseApp, "scripts/studio-setup.mjs"), `import fs from 'node:fs'; fs.appendFileSync(process.env.HOME + '/setup-calls', process.argv.slice(2).join(' ') + '\\n');`);
  put(path.join(releaseApp, "voice/default.md"), "Neutral voice.");
  put(path.join(releaseApp, "assets/browser/chrome-headless-shell-mac-arm64/chrome-headless-shell"), "#!/bin/bash\nexit 0\n", true);
  put(path.join(releaseApp, "scripts/client-maintenance.mjs"), "// local fake: no jobs started\n");
  put(path.join(releaseApp, "scripts/install-watcher.sh"), fs.readFileSync(path.join(app, "scripts/install-watcher.sh")), true);
  put(path.join(releaseApp, "node_modules/hyperframes/package.json"), JSON.stringify({ version: "0.8.214", bin: { hyperframes: "bin/cli.mjs" } }));
  put(path.join(releaseApp, "node_modules/hyperframes/bin/cli.mjs"), "if (process.env.TEST_FAIL_BROWSER) process.exit(1); if (!process.env.HYPERFRAMES_BROWSER_PATH) throw Error('Unchecked browser download'); console.log('Browser ready');\n");
  fs.mkdirSync(path.join(releaseApp, "node_modules/.bin"));
  fs.symlinkSync("../hyperframes/bin/cli.mjs", path.join(releaseApp, "node_modules/.bin/hyperframes"));
  const files = {};
  function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) collect(p); else files[path.relative(releaseApp, p)] = hash(fs.readFileSync(p));
    }
  }
  collect(releaseApp);
  const archive = path.join(dir, "release.tar.gz"); tar(releaseSource, archive, "reel-editor");
  const bytes = fs.readFileSync(archive);
  const m = { schema: 1, id: "2026.11.08.1", commit: "a".repeat(40), runtime: { id: "rt-test", platform: "darwin-arm64", minMacOS: "14.0", tools,
    python: { version: "3.12.13", requirements: "runtime/requirements.lock" }, whisper: { model: "neutral/whisper", revision: "a".repeat(40), files: { "model.bin": hash(Buffer.from("pinned-model\n")) } }, hyperframes: { version: "0.8.214" } },
    artifact: { name: "release.tar.gz", url: pathToFileURL(archive).href, sha256: hash(bytes), bytes: bytes.length }, files };
  for (const name of ["brand.json", "my-brand.json", "my-youtube.json"]) put(path.join(brand, name), JSON.stringify({ name: "Avery's Studio" }));
  put(path.join(brand, "dictionary.json"), "{}"); put(path.join(brand, "voice.md"), "Your voice.");
  const save = () => put(manifest, JSON.stringify(m)); save();
  const root = path.join(home, ".local/share/reel-editor");
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, REEL_CACHE: path.join(home, "cache") };
  const run = (extra = {}, args = []) => spawnSync("/bin/bash", [path.join(app, "install.sh"), "--release", manifest, "--brand", brand, "--yes", "--no-watch", ...args], { env: { ...env, ...extra }, encoding: "utf8", timeout: 30000 });
  return { dir, home, bin, brand, manifest, root, m, env, save, run };
}

test("release installs with only local artifacts, preserves brands without baselines, migrates keys and switches safely", (t) => {
  const f = fixture(t);
  put(path.join(f.home, "Ai/reel-editor/old-edit.txt"), "keep my edits");
  for (const name of ["my-brand.json", "my-youtube.json", "brand.json"]) put(path.join(f.home, ".reel", name), JSON.stringify({ name: "My edited brand" }));
  put(path.join(f.home, ".zshrc"), '# keep me\nexport ELEVENLABS_API_KEY="dummy-test-key"\n');
  let r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Editing ready \(release 2026.11.08.1\)/);
  assert.equal(fs.existsSync(path.join(f.home, "forbidden")), false);
  assert.equal(fs.readlinkSync(path.join(f.home, "Ai/reel-editor")), path.join(f.root, "current"));
  assert.equal(fs.readlinkSync(path.join(f.root, "current")), path.join(f.root, "releases", f.m.id));
  const legacy = fs.readdirSync(path.join(f.root, "releases")).find((s) => s.startsWith("legacy-"));
  assert.equal(fs.readFileSync(path.join(f.root, "releases", legacy, "old-edit.txt"), "utf8"), "keep my edits");
  for (const name of ["my-brand", "my-youtube", "brand"]) {
    assert.match(fs.readFileSync(path.join(f.home, ".reel", name + ".json"), "utf8"), /My edited brand/);
    assert.equal(fs.readFileSync(path.join(f.home, ".reel", name + ".kit-new.json"), "utf8"), fs.readFileSync(path.join(f.brand, name + ".json"), "utf8"));
  }
  assert.doesNotMatch(fs.readFileSync(path.join(f.home, ".zshrc"), "utf8"), /_API_KEY/);
  const settings = fs.readFileSync(path.join(f.home, ".reel/env.sh"), "utf8");
  assert.match(settings, /REEL_CLIENT='avery-s-studio'/); assert.match(settings, /REEL_CLIENT_MODE='1'/);
  const downloads = fs.readFileSync(path.join(f.home, "downloads"), "utf8");
  r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(f.home, "downloads"), "utf8"), downloads, "completed downloads are rechecked and reused");
  assert.equal(fs.existsSync(path.join(f.root, "previous")), false, "same-release reruns leave rollback alone");
  f.m.id = "2026.11.08.2"; f.save();
  r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readlinkSync(path.join(f.root, "previous")), path.join(f.root, "releases/2026.11.08.1"));
  const state = JSON.parse(fs.readFileSync(path.join(f.home, ".reel/install-state.json")));
  assert.equal(state.release, f.m.id); assert.ok(state.phases.acceptance); assert.ok(state.phases.speech);
});

test("tools checksum mismatch stops before execution or any complete folder", (t) => {
  const f = fixture(t); f.m.runtime.tools.node.sha256 = "0".repeat(64); f.save();
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /checksum/);
  assert.doesNotMatch(r.stdout, /Editing ready|All set/);
  assert.equal(fs.existsSync(path.join(f.root, "runtime/rt-test")), false);
  assert.equal(fs.existsSync(path.join(f.root, "current")), false);
});

test("release checksum mismatch leaves the active release untouched", (t) => {
  const f = fixture(t); f.m.artifact.sha256 = "0".repeat(64); f.save();
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /checksum/);
  assert.equal(fs.existsSync(path.join(f.root, "current")), false);
  assert.equal(fs.existsSync(path.join(f.root, "releases", f.m.id)), false);
});

test("resume after a killed speech step reuses verified tools and release", (t) => {
  const f = fixture(t);
  let r = f.run({ TEST_KILL_SPEECH: "1" }); assert.notEqual(r.status, 0);
  assert.equal(fs.existsSync(path.join(f.root, "runtime/rt-test/.complete")), false);
  assert.equal(fs.existsSync(path.join(f.root, "current")), false);
  const downloads = fs.readFileSync(path.join(f.home, "downloads"), "utf8");
  r = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(f.home, "downloads"), "utf8"), downloads);
  assert.ok(fs.existsSync(path.join(f.root, "runtime/rt-test/.complete")));
  assert.match(fs.readFileSync(path.join(f.home, "uv-calls"), "utf8"), /--require-hashes --only-binary :all:/);
});

test("corruption is rechecked on resume for both release and runtime", (t) => {
  const f = fixture(t); let r = f.run(); assert.equal(r.status, 0, r.stderr);
  const file = path.join(f.root, "releases", f.m.id, "dictionary.json");
  const original = fs.readFileSync(file); fs.writeFileSync(file, "changed");
  r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /release has changed/);
  fs.writeFileSync(file, original);
  fs.appendFileSync(path.join(f.root, "runtime/rt-test/bin/ffmpeg"), "# changed\n");
  r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /tools have changed/);
});

test("unsupported Macs stop before downloads and privileged tools", (t) => {
  const f = fixture(t);
  for (const env of [{ TEST_ARCH: "x86_64" }, { TEST_MACOS: "13.6" }]) {
    const r = f.run(env); assert.notEqual(r.status, 0); assert.match(r.stderr, /not supported yet|macOS 14/);
  }
  assert.equal(fs.existsSync(path.join(f.home, "downloads")), false);
  assert.equal(fs.existsSync(path.join(f.home, "forbidden")), false);
});

test("browser and acceptance failures stop without claiming completion", (t) => {
  const f = fixture(t);
  for (const env of [{ TEST_FAIL_BROWSER: "1" }, { TEST_FAIL_ACCEPT: "1" }]) {
    const r = f.run(env); assert.notEqual(r.status, 0); assert.doesNotMatch(r.stdout, /Editing ready|All set|Done\./);
  }
  assert.match(fs.readFileSync(path.join(f.home, ".reel/install.log"), "utf8"), /Browser ready/);
});

test("installer refuses to switch while the watcher or studio lock is held", (t) => {
  const f = fixture(t); const r = f.run(); assert.equal(r.status, 0, r.stderr);
  for (const lock of ["Reels/videos/.seen/.lock", "Content Studio/.studio/run.lock"]) {
    fs.mkdirSync(path.join(f.home, lock), { recursive: true });
    assert.throws(() => switchRelease(f.home, f.m), /being made/);
    fs.rmdirSync(path.join(f.home, lock));
  }
});

test("watcher gets the runtime PATH without loading the login shell", (t) => {
  const f = fixture(t); let r = f.run(); assert.equal(r.status, 0, r.stderr);
  const watcher = path.join(f.dir, "watcher/install-watcher.sh");
  put(watcher, fs.readFileSync(path.join(app, "scripts/install-watcher.sh")), true);
  put(path.join(f.dir, "watcher/watch-folder.sh"), '#!/bin/bash\nprintf "%s\\n%s" "$REEL_CLIENT" "$REEL_PYTHON"\n', true);
  r = spawnSync("/bin/bash", [watcher, "--dry-run"], { env: f.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /<key>PATH<\/key>/);
  assert.ok(r.stdout.includes(path.join(f.root, "runtime/rt-test/bin")));
  assert.doesNotMatch(r.stdout, /<string>-lc<\/string>/);
  assert.match(r.stdout, /\.reel\/env\.sh/);
  assert.match(r.stdout, /watch-folder\.sh/);
  const block = r.stdout.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)[1];
  const args = [...block.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1].replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
  const child = spawnSync(args[0], args.slice(1), { env: f.env, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, `avery-s-studio\n${f.root}/runtime/rt-test/venv/bin/python`);
});

test("unsafe shell keys stay untouched and are never executed", (t) => {
  const f = fixture(t), zshrc = path.join(f.home, ".zshrc");
  const original = `export OLD_API_KEY="$(touch '${f.home}/bad')"\n`; put(zshrc, original);
  assert.throws(() => migrateKeys(f.home), /shell expression/);
  assert.equal(fs.readFileSync(zshrc, "utf8"), original); assert.equal(fs.existsSync(path.join(f.home, "bad")), false);
});

test("release manifest rejects escaping paths and verifies file bytes", (t) => {
  const f = fixture(t); f.m.files["../outside"] = "a".repeat(64); f.save();
  assert.throws(() => readManifest(f.manifest), /not valid/);
  assert.equal(verifyFiles(f.dir, { "../outside": "a".repeat(64) }), false);
});

test("kit launchers run their bundled release installer and return its failure", (t) => {
  const f = fixture(t);
  put(path.join(f.dir, "install.sh"), '#!/bin/bash\nprintf "%s\\n" "$@" > "$HOME/kit-args"\nexit 23\n');
  for (const name of ["Install Reels.command", "Install Reel Editor.command"]) {
    const launcher = path.join(f.dir, name); fs.copyFileSync(path.join(app, "kit", name), launcher);
    const r = spawnSync("/bin/bash", [launcher], { env: { ...f.env, TERM: "dumb" }, encoding: "utf8" });
    assert.equal(r.status, 23, r.stderr); assert.doesNotMatch(r.stdout, /All set/);
    const args = fs.readFileSync(path.join(f.home, "kit-args"), "utf8");
    assert.ok(args.includes(`--brand\n${f.brand}\n`)); assert.ok(args.includes(`--release\n${f.manifest}\n`));
    assert.equal(args.includes("--studio\n"), name === "Install Reels.command");
  }
});

test("release studio kits prove editing first, then save setup without running the old account installers", (t) => {
  const f = fixture(t), r = f.run({}, ["--studio"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Posting setup comes right after your test reel/);
  assert.ok(r.stdout.indexOf("Editing ready") < r.stdout.lastIndexOf("Your reels and posts"), "setup runs after the test reel");
  assert.match(fs.readFileSync(path.join(f.home, "setup-calls"), "utf8"), /--brand .*--yes/);
  assert.match(r.stdout, /Editing ready/);
  assert.equal(fs.existsSync(path.join(f.home, "forbidden")), false);
});

test("legacy tools skip Homebrew when Node, ffmpeg, ffprobe and usable Python are present", (t) => {
  const f = fixture(t), sh = fs.readFileSync(path.join(app, "install.sh"), "utf8");
  const start = sh.indexOf("py_ok()"), end = sh.indexOf("# ---------------------------------------------------------------- 3.");
  fs.symlinkSync(process.execPath, path.join(f.bin, "node"));
  for (const name of ["ffmpeg", "ffprobe", "python3"]) put(path.join(f.bin, name), "#!/bin/bash\nexit 0\n", true);
  const r = spawnSync("/bin/bash", ["-c", `set -euo pipefail\nok() { :; }; note() { :; }; die() { echo "$*" >&2; exit 1; }\n${sh.slice(start, end)}`], { env: f.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(f.home, "forbidden")), false);
});

test("legacy git and npm failures stop instead of reporting ready", (t) => {
  const f = fixture(t), dir = path.join(f.home, "code");
  fs.symlinkSync(process.execPath, path.join(f.bin, "node"));
  for (const name of ["ffmpeg", "ffprobe", "python3", "xcode-select"]) put(path.join(f.bin, name), "#!/bin/bash\nexit 0\n", true);
  const run = () => spawnSync("/bin/bash", [path.join(app, "install.sh"), "--dir", dir, "--yes", "--look", "clean", "--no-link", "--no-watch"], { env: f.env, encoding: "utf8" });
  let r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /code download stopped/);
  put(path.join(f.bin, "git"), '#!/bin/bash\nif [ "$1" = clone ]; then mkdir -p "$4/reel-editor"; fi\nexit 0\n', true);
  r = run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /packages did not install/);
  assert.doesNotMatch(r.stdout, /test reel:|Done\./);
});

test("a kit without a hashed browser stops before activation or a browser download", (t) => {
  const f = fixture(t); delete f.m.files["assets/browser/chrome-headless-shell-mac-arm64/chrome-headless-shell"]; f.save();
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /missing its checked render browser/);
  assert.equal(fs.existsSync(path.join(f.root, "current")), false);
  assert.equal(fs.readFileSync(path.join(f.home, "downloads"), "utf8").trim().split("\n").length, 7);
});

test("downloaded Whisper files are checked against the pinned sha256, wherever the cache keeps them", (t) => {
  const f = fixture(t), cache = path.join(f.dir, "models"), repo = path.join(cache, "models--neutral--whisper"), revision = "b".repeat(40);
  // huggingface_hub 2.x: the snapshot links into the repo's blobs, which link on into a shared store in the cache.
  const bytes = Buffer.from("model"), store = path.join(cache, "blobs", "xx", "xet-name"), snapshot = path.join(repo, "snapshots", revision);
  put(store, bytes); fs.mkdirSync(path.join(repo, "blobs"), { recursive: true }); fs.mkdirSync(snapshot, { recursive: true });
  fs.symlinkSync("../../blobs/xx/xet-name", path.join(repo, "blobs", hash(bytes)));
  fs.symlinkSync(`../../blobs/${hash(bytes)}`, path.join(snapshot, "model.bin"));
  verifyModel(cache, "neutral/whisper", revision, { "model.bin": hash(bytes) });
  assert.throws(() => verifyModel(cache, "neutral/whisper", revision, {}), /no checksum/);
  assert.throws(() => verifyModel(cache, "neutral/whisper", revision, { "model.bin": hash(bytes), "vocabulary.json": hash(bytes) }), /incomplete/);
  fs.writeFileSync(store, "bad bytes");
  assert.throws(() => verifyModel(cache, "neutral/whisper", revision, { "model.bin": hash(bytes) }), /did not match/);
});
