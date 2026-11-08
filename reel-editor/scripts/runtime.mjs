// Installer helpers run with the verified Node, without npm or extra dependencies.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const exists = (file) => fs.existsSync(file);
const digest = (file) => {
  const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024), fd = fs.openSync(file, "r");
  try { let n; while ((n = fs.readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest("hex");
};
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const browserFile = "assets/browser/chrome-headless-shell-mac-arm64/chrome-headless-shell";
function atomic(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode });
  fs.renameSync(tmp, file);
}
function json(file, data) { atomic(file, JSON.stringify(data, null, 2) + "\n"); }
function safePath(name) {
  return typeof name === "string" && name !== "" && !path.isAbsolute(name) && !name.split("/").some((p) => p === ".." || p === "." || !p);
}
export function readManifest(file) {
  const m = read(file);
  const hash = (s) => /^[a-f0-9]{64}$/.test(s || "");
  if (m.schema !== 1 || !/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(m.id || "") ||
      !/^[\w.-]+$/.test(m.runtime?.id || "") || [".", ".."].includes(m.runtime.id) ||
      m.runtime.platform !== "darwin-arm64" || !hash(m.artifact?.sha256) ||
      !Number.isSafeInteger(m.artifact?.bytes) || m.artifact.bytes <= 0 ||
      !m.files || !Object.keys(m.files).length || Object.entries(m.files).some(([p, h]) => !safePath(p) || !hash(h))) {
    throw new Error("The release file is not valid. Ask for a new kit.");
  }
  for (const tool of ["node", "ffmpeg", "ffprobe", "uv", "yt-dlp"]) {
    const t = m.runtime.tools?.[tool];
    if (!t || !hash(t.sha256) || !/^(https:|file:)\/\//.test(t.url || "")) throw new Error("The tools list is not valid.");
  }
  if (!/^(https:|file:)\/\//.test(m.artifact.url || "") || !safePath(m.runtime.python?.requirements) ||
      !/^\d+\.\d+\.\d+$/.test(m.runtime.python?.version || "") ||
      !/^[\w.-]+\/[\w.-]+$/.test(m.runtime.whisper?.model || "") ||
      !/^[a-f0-9]{40}$/.test(m.runtime.whisper?.revision || "")) throw new Error("The speech tools list is not valid.");
  return m;
}

function layout(home, m) {
  const root = path.join(home, ".local/share/reel-editor");
  return { home, root, conf: path.join(home, ".reel"), tmp: path.join(root, "tmp"),
    rt: path.join(root, "runtime", m.runtime.id), app: path.join(root, "releases", m.id) };
}
function command(bin, args, l, env = {}) {
  const fd = fs.openSync(path.join(l.conf, "install.log"), "a", 0o600);
  let r;
  try { r = spawnSync(bin, args, { stdio: ["ignore", fd, fd], env: { ...process.env, ...env } }); }
  finally { fs.closeSync(fd); }
  if (r.error || r.status !== 0) throw new Error(`${path.basename(bin)} stopped. See ~/.reel/install.log, then run this installer again.`);
}
export function recordPhase(home, manifest, phase) {
  const file = path.join(home, ".reel/install-state.json");
  let state;
  try { state = read(file); } catch { state = {}; }
  if (state.release !== manifest.id || state.runtime !== manifest.runtime.id) state = { schema: 1, release: manifest.id, runtime: manifest.runtime.id, phases: {} };
  state.phases[phase] = new Date().toISOString();
  json(file, state);
}
export function verifyFiles(root, files) {
  return Object.entries(files).every(([name, hash]) => {
    if (!safePath(name)) return false;
    const file = path.join(root, name);
    try { return inside(fs.realpathSync(root), fs.realpathSync(file)) && digest(file) === hash; }
    catch { return false; }
  });
}
function inventory(root, dirs) {
  const files = {};
  function walk(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const name = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(name);
      else if (e.isFile() || e.isSymbolicLink() && fs.statSync(path.join(root, name)).isFile()) files[name] = digest(path.join(root, name));
    }
  }
  for (const dir of dirs) walk(dir);
  return files;
}
export function verifyModel(cache, model, revision) {
  const repo = path.join(cache, `models--${model.replaceAll("/", "--")}`), snapshot = path.join(repo, "snapshots", revision);
  if (!exists(path.join(snapshot, "model.bin"))) throw new Error("The speech model download is incomplete. Run this installer again.");
  const blobs = fs.realpathSync(path.join(repo, "blobs"));
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) { walk(file); continue; }
      const blob = fs.realpathSync(file), expected = path.basename(blob);
      if (!inside(blobs, blob) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expected)) throw new Error("The speech model download has no checksum. Ask for help before continuing.");
      let actual;
      if (expected.length === 64) actual = digest(blob);
      else {
        const hash = crypto.createHash("sha1");
        hash.update(`blob ${fs.statSync(blob).size}\0`); hash.update(fs.readFileSync(blob)); actual = hash.digest("hex");
      }
      if (actual !== expected) throw new Error("The speech model download did not match its checksum. Run this installer again.");
    }
  }
  walk(snapshot);
}
export function installApp(home, m) {
  const l = layout(home, m), identity = sha(JSON.stringify(m));
  fs.mkdirSync(l.tmp, { recursive: true });
  fs.mkdirSync(l.conf, { recursive: true, mode: 0o700 });
  const marker = path.join(l.app, ".complete");
  if (exists(marker)) {
    if (read(marker).manifest !== identity || !verifyFiles(l.app, m.files)) throw new Error("The installed release has changed. Keep your reels; ask for help repairing this release.");
    recordPhase(home, m, "release"); return;
  }
  if (exists(l.app)) throw new Error("An unfinished release folder needs checking. Your previous release is still safe.");
  const stage = fs.mkdtempSync(path.join(l.tmp, "release."));
  try {
    const archive = path.join(stage, "app.tar.gz");
    command("curl", ["--fail", "--location", "--retry", "3", "--retry-delay", "1", "--output", archive, m.artifact.url], l);
    if (fs.statSync(archive).size !== m.artifact.bytes || digest(archive) !== m.artifact.sha256) throw new Error("The release download did not match its checksum. Nothing was activated.");
    const list = spawnSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (list.status !== 0 || list.stdout.trim().split("\n").some((name) => {
      const trimmed = name.replace(/\/$/, "");
      return !safePath(trimmed) || !(trimmed === "reel-editor" || trimmed.startsWith("reel-editor/"));
    })) throw new Error("The release archive has an unsafe path.");
    command("tar", ["-xzf", archive, "-C", stage], l);
    const app = path.join(stage, "reel-editor");
    if (!verifyFiles(app, m.files)) throw new Error("The unpacked release did not match its checksums. Nothing was activated.");
    // Check links too, including links not listed separately in the file manifest.
    function links(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isSymbolicLink() && !inside(fs.realpathSync(app), fs.realpathSync(p))) throw new Error("The release contains a link outside the app.");
        if (e.isDirectory()) links(p);
      }
    }
    links(app);
    json(path.join(app, "release.json"), m);
    json(path.join(app, ".complete"), { manifest: identity, artifact: m.artifact.sha256 });
    fs.mkdirSync(path.dirname(l.app), { recursive: true });
    fs.renameSync(app, l.app);
    recordPhase(home, m, "release");
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

export function prepareSpeech(home, m) {
  const l = layout(home, m), marker = path.join(l.rt, ".complete"), identity = sha(JSON.stringify(m.runtime));
  const lock = path.join(l.app, m.runtime.python.requirements);
  if (!m.files[m.runtime.python.requirements] || !verifyFiles(l.app, { [m.runtime.python.requirements]: m.files[m.runtime.python.requirements] })) throw new Error("The speech package list did not match this release.");
  if (exists(marker)) {
    const done = read(marker);
    if (done.manifest !== identity || done.requirements !== digest(lock) || !verifyFiles(l.rt, done.files || {})) throw new Error("The installed speech tools have changed. Ask for help repairing the tools.");
    recordPhase(home, m, "speech"); return;
  }
  const uv = path.join(l.rt, "bin/uv"), python = path.join(l.rt, "venv/bin/python");
  const modelStage = path.join(l.tmp, `models-${m.runtime.id}`);
  const env = { PATH: `${l.rt}/bin:${process.env.PATH}`, UV_PYTHON_INSTALL_DIR: path.join(l.rt, "python"),
    UV_PYTHON_BIN_DIR: path.join(l.rt, "bin"), UV_CACHE_DIR: path.join(l.tmp, "uv-cache"),
    UV_PYTHON_DOWNLOADS: "automatic", UV_PYTHON_PREFERENCE: "only-managed", HF_HUB_DISABLE_TELEMETRY: "1", TMPDIR: l.tmp };
  command(uv, ["python", "install", m.runtime.python.version], l, env);
  if (!exists(python)) command(uv, ["venv", "--python", m.runtime.python.version, path.join(l.rt, "venv")], l, env);
  command(uv, ["pip", "install", "--python", python, "--require-hashes", "--only-binary", ":all:", "-r", lock], l, env);
  // Keep the exact snapshot inside the runtime; transcription can use the usual HF cache lookup offline.
  command(python, ["-c", "from huggingface_hub import snapshot_download; import sys; snapshot_download(sys.argv[1], revision=sys.argv[2], cache_dir=sys.argv[3])",
    m.runtime.whisper.model, m.runtime.whisper.revision, modelStage], l, env);
  verifyModel(modelStage, m.runtime.whisper.model, m.runtime.whisper.revision);
  atomic(path.join(modelStage, `models--${m.runtime.whisper.model.replaceAll("/", "--")}`, "refs/main"), m.runtime.whisper.revision);
  fs.rmSync(path.join(l.rt, "models"), { recursive: true, force: true });
  fs.renameSync(modelStage, path.join(l.rt, "models"));
  json(marker, { manifest: identity, requirements: digest(lock), files: inventory(l.rt, ["python", "venv", "models"]) });
  recordPhase(home, m, "speech");
}

export function switchRelease(home, m) {
  const l = layout(home, m), current = path.join(l.root, "current"), previous = path.join(l.root, "previous");
  if (!exists(path.join(l.app, ".complete")) || !exists(path.join(l.rt, ".complete"))) throw new Error("The download has not finished yet. Run this installer again.");
  const locks = [path.join(process.env.REEL_WATCH_ROOT || path.join(home, "Reels"), "videos/.seen/.lock"),
    path.join(process.env.REEL_STUDIO || path.join(home, "Content Studio"), ".studio/run.lock")];
  if (locks.some(exists)) throw new Error("A reel or post is being made. Wait for it to finish, then run this installer again.");
  const symlink = (target, dest) => {
    const temp = `${dest}.${process.pid}.tmp`;
    fs.rmSync(temp, { force: true }); fs.symlinkSync(target, temp); fs.renameSync(temp, dest);
  };
  let old;
  try { old = fs.readlinkSync(current); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const alias = path.join(home, "Ai/reel-editor");
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  let stat;
  try { stat = fs.lstatSync(alias); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (stat && !stat.isSymbolicLink()) {
    let legacy = path.join(l.root, "releases", `legacy-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    while (exists(legacy)) legacy += "-saved";
    fs.renameSync(alias, legacy);
  }
  if (old && path.resolve(l.root, old) !== l.app) symlink(path.resolve(l.root, old), previous);
  symlink(l.app, current);
  symlink(current, alias);
  recordPhase(home, m, "activated");
}

// Parse old exports as literal data; never source a person's login shell during setup.
function literal(raw) {
  const s = raw.trim(), comment = s.match(/^([\w./:@+%=-]*)(?:\s+#.*)?$/);
  if (comment) return comment[1];
  const single = s.match(/^'((?:[^']|'\\'')*)'(?:\s+#.*)?$/);
  if (single) return single[1].replaceAll("'\\''", "'");
  const double = s.match(/^"((?:[^"\\]|\\.)*)"(?:\s+#.*)?$/);
  if (double && !/(?<!\\)[$`]/.test(double[1])) return double[1].replace(/\\([$`"\\])/g, "$1");
  throw new Error("An old key or setting uses a shell expression. Replace it with a plain value in ~/.zshrc, then run this installer again.");
}
export function migrateKeys(home) {
  const conf = path.join(home, ".reel"), zshrc = path.join(home, ".zshrc"), file = path.join(conf, "keys.env");
  fs.mkdirSync(conf, { recursive: true, mode: 0o700 });
  const source = exists(zshrc) ? fs.readFileSync(zshrc, "utf8") : "", keys = new Map();
  if (exists(file)) for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*_API_KEY)=(.*)$/);
    if (m) keys.set(m[1], literal(m[2]));
  }
  const saved = new Set(keys.keys());
  const remaining = source.split(/(?<=\n)/).filter((line) => {
    const m = line.match(/^\s*export\s+([A-Z][A-Z0-9_]*_API_KEY)=(.*?)(?:\r?\n)?$/);
    if (!m) return true;
    if (!saved.has(m[1])) keys.set(m[1], literal(m[2]));
    return false;
  }).join("");
  atomic(file, [...keys].map(([k, v]) => `${k}=${quote(v)}\n`).join(""));
  fs.chmodSync(file, 0o600);
  if (remaining !== source) atomic(zshrc, remaining, exists(zshrc) ? fs.statSync(zshrc).mode & 0o777 : 0o600);
}
export function saveKey(home, name, value) {
  if (!/^[A-Z][A-Z0-9_]*_API_KEY$/.test(name) || /[\r\n\0]/.test(value)) throw new Error("Please paste the key on one line.");
  migrateKeys(home);
  const file = path.join(home, ".reel/keys.env");
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((line) => line && !line.startsWith(`${name}=`));
  atomic(file, [...lines, `${name}=${quote(value)}`, ""].join("\n"));
}
export function writeEnvironment(home, values) {
  migrateKeys(home);
  const conf = path.join(home, ".reel"), file = path.join(conf, "env.sh"), zshrc = path.join(home, ".zshrc");
  const old = exists(file) ? fs.readFileSync(file, "utf8") : "";
  const source = exists(zshrc) ? fs.readFileSync(zshrc, "utf8") : "";
  let cta = "";
  for (const line of (old + "\n" + source).split("\n")) {
    const m = line.match(/^export REEL_WATCH_CTA=(.*)$/); if (m) cta = literal(m[1]);
  }
  const env = { ...values, REEL_WATCH_CTA: cta, PRODUCER_BROWSER_GPU_MODE: "hardware" };
  let content = "# Reel Editor settings. Your keys stay in keys.env.\n";
  const prefix = [values.REEL_RUNTIME && `${values.REEL_RUNTIME}/bin`, `${home}/.local/bin`].filter(Boolean).join(":");
  content += `export PATH=${quote(prefix)}:"$PATH"\n`;
  for (const [k, v] of Object.entries(env)) content += `export ${k}=${quote(v)}\n`;
  if (values.REEL_RUNTIME) {
    content += `export HF_HUB_CACHE=${quote(path.join(values.REEL_RUNTIME, "models"))}\n`;
    const browser = path.join(home, ".local/share/reel-editor/current", browserFile);
    for (const key of ["HYPERFRAMES_BROWSER_PATH", "REEL_BROWSER_PATH"]) content += `export ${key}=${quote(browser)}\n`;
  }
  if (values.REEL_RUNTIME) {
    // A weekly update or a rollback switches `current`; read the active release and its tools from it every time,
    // so these never point at a release that is no longer active. plutil reads JSON and ships with every Mac.
    content += [
      'REEL_SHARE="$HOME/.local/share/reel-editor"',
      'if [ -f "$REEL_SHARE/current/release.json" ]; then',
      '  _rel="$(/usr/bin/plutil -extract id raw -o - "$REEL_SHARE/current/release.json" 2>/dev/null)"',
      '  _rt="$(/usr/bin/plutil -extract runtime.id raw -o - "$REEL_SHARE/current/release.json" 2>/dev/null)"',
      '  if [ -n "$_rel" ] && [ -n "$_rt" ] && [ -f "$REEL_SHARE/runtime/$_rt/.complete" ]; then',
      '    export REEL_RELEASE="$_rel" REEL_RUNTIME="$REEL_SHARE/runtime/$_rt"',
      '    export REEL_PYTHON="$REEL_RUNTIME/venv/bin/python" HF_HUB_CACHE="$REEL_RUNTIME/models" PATH="$REEL_RUNTIME/bin:$PATH"',
      '  fi',
      '  unset _rel _rt',
      'fi',
      '',
    ].join("\n");
  }
  content += '[ -f "$HOME/.reel/keys.env" ] && { set -a; . "$HOME/.reel/keys.env"; set +a; }\n';
  atomic(file, content);
  let block = false;
  const lines = source.split(/(?<=\n)/).filter((line) => {
    if (line.trim() === "# >>> reel-editor >>>") { block = true; return false; }
    if (line.trim() === "# <<< reel-editor <<<") { block = false; return false; }
    return !block && !/^export (REEL_[A-Z_]+|PRODUCER_BROWSER_GPU_MODE)=/.test(line);
  }).join("");
  atomic(zshrc, lines + (lines && !lines.endsWith("\n") ? "\n" : "") + '# >>> reel-editor >>>\n[ -f "$HOME/.reel/env.sh" ] && . "$HOME/.reel/env.sh"\n# <<< reel-editor <<<\n', exists(zshrc) ? fs.statSync(zshrc).mode & 0o777 : 0o600);
}

async function main() {
  const [action, file, ...args] = process.argv.slice(2), home = process.env.HOME;
  if (action === "migrate-keys") return migrateKeys(home);
  if (action === "save-key") {
    // Secrets arrive over stdin so they never appear in the process argument list.
    return saveKey(home, file, fs.readFileSync(0, "utf8").replace(/\n$/, ""));
  }
  if (action === "env") {
    const names = ["REEL_RUNTIME", "REEL_RELEASE", "REEL_PYTHON", "REEL_PRESET", "REEL_DICTIONARY", "REEL_CAPTION_VOICE", "REEL_YOUTUBE_PRESET", "REEL_WATCH_RAW", "REEL_WATCH_DONE", "REEL_CLIENT", "REEL_CLIENT_MODE"];
    return writeEnvironment(home, Object.fromEntries(names.map((k) => [k, process.env[k] || ""])));
  }
  const m = readManifest(file), l = layout(home, m);
  if (action === "app") { recordPhase(home, m, "tools"); return installApp(home, m); }
  if (action === "speech") return prepareSpeech(home, m);
  if (action === "switch") return switchRelease(home, m);
  if (action === "phase") return recordPhase(home, m, args[0]);
  if (action === "browser") {
    const pkg = read(path.join(l.app, "node_modules/hyperframes/package.json"));
    if (pkg.version !== m.runtime.hyperframes.version) throw new Error("The render tool did not match this release.");
    const relative = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.hyperframes;
    const cli = path.resolve(l.app, "node_modules/hyperframes", relative);
    if (!inside(l.app, cli)) throw new Error("The render tool path is not valid.");
    // HyperFrames' own browser download has no pinned checksum. Use the release's verified copy.
    const browser = path.join(l.app, browserFile);
    if (!m.files[browserFile] || !verifyFiles(l.app, { [browserFile]: m.files[browserFile] })) throw new Error("This kit is missing its checked render browser. Ask for a new kit.");
    fs.accessSync(browser, fs.constants.X_OK);
    command(path.join(l.rt, "bin/node"), [cli, "browser", "ensure"], l, { PATH: `${l.rt}/bin:${process.env.PATH}`, HYPERFRAMES_BROWSER_PATH: browser, REEL_BROWSER_PATH: browser });
    return recordPhase(home, m, "browser");
  }
  throw new Error("Unknown installer step.");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
