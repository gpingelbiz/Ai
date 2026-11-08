#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PKG_ROOT } from "../src/util.mjs";
import { fileHash, releaseID, verifyRelease, readReleaseManifest, sameRelease } from "../src/release.mjs";

const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

export function command(cmd, args, { cwd = PKG_ROOT, env = process.env, quiet = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.stdout && !quiet) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error || r.status !== 0) throw new Error(`${cmd} stopped${r.error ? `: ${r.error.message}` : ` (${r.status})`}. No release was published.`);
  return r.stdout || "";
}

function validID(id) {
  if (!releaseID(id)) throw new Error("Use a release number such as 2026.11.08.1.");
  return id;
}

export function assertClean(app, run = command) {
  const changes = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: app });
  if (changes.trim()) throw new Error(`Save all repository changes in git before building a release:\n${changes.trimEnd()}`);
}

/** Start from nothing: local footage, brands, credentials and old dependencies cannot enter a release. */
// Client brands are built on these two (src/presets.mjs: brand-<slug> extends pingel-brand; the Runway folder reads
// pingel-runway's clip timing), so they ship as the engine base; client mode never lets a client pick them as a look.
const BASE_PRESETS = ["presets/pingel-brand.json", "presets/pingel-runway.json"];

export function allowedFile(name) {
  if (BASE_PRESETS.includes(name)) return true;
  const parts = name.split("/");
  if (parts.some((part) => part.startsWith(".") || /^(?:brands|music)$/i.test(part) || /^(?:pingel-|greg(?:[.-]|$))/i.test(part) || /(?:\.env(?:\.|$)|keys\.env$|\.pem$|\.key$)/i.test(part))) return false;
  if (["package.json", "package-lock.json", "install.sh"].includes(name)) return true;
  if (name === "dictionary.json" || name === "voice/default.md" || name === "examples/sample-words.json") return true;
  if (name.startsWith("examples/accept/")) return /\.(?:json|svg|png|jpg|txt)$/.test(name);
  if (name.startsWith("dist/helpers/darwin-arm64/")) return parts.length === 4;
  if (parts[0] === "assets") return ["fonts", "icons", "vendor", "sfx"].includes(parts[1]);
  return ["bin", "src", "scripts", "kit", "presets", "runtime"].includes(parts[0]);
}

export function copyApp(app, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const visit = (dir, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Never traverse the checkout's dependencies (which may be a symlink to Greg's install).
      if (!prefix && !["bin", "src", "scripts", "kit", "presets", "assets", "voice", "runtime", "examples", "dist", "package.json", "package-lock.json", "dictionary.json", "install.sh"].includes(entry.name)) continue;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!prefix || ["dist/helpers", "examples/accept"].includes(name) || allowedFile(name + "/file")) visit(path.join(dir, entry.name), name);
      } else if (entry.isFile() && allowedFile(name)) {
        const target = path.join(dest, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(dir, entry.name), target);
        fs.chmodSync(target, fs.statSync(path.join(dir, entry.name)).mode & 0o777);
      }
    }
  };
  visit(app);
}

export function hashFiles(app) {
  const files = {};
  const visit = (dir, prefix = "") => {
    for (const name of fs.readdirSync(dir).sort()) {
      if ([".cache", ".DS_Store"].includes(name)) { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); continue; }
      const rel = prefix ? `${prefix}/${name}` : name;
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const resolved = fs.realpathSync(file);
        if (!resolved.startsWith(fs.realpathSync(app) + path.sep) || !fs.statSync(resolved).isFile()) throw new Error(`A release link points outside the app: ${rel}`);
        files[rel] = fileHash(file);
      } else if (stat.isDirectory()) visit(file, rel);
      else if (stat.isFile() && rel !== "release.json") files[rel] = fileHash(file);
      else if (!stat.isFile()) throw new Error(`This file cannot be shipped: ${rel}`);
    }
  };
  visit(app);
  return files;
}

export function testCounts(unit, goldens) {
  const total = Number(unit.match(/^# tests (\d+)\s*$/m)?.[1]);
  const passed = Number(unit.match(/^# pass (\d+)\s*$/m)?.[1]);
  const failed = Number(unit.match(/^# fail (\d+)\s*$/m)?.[1]);
  if (!total || passed !== total || failed !== 0) throw new Error("Every unit test must pass, with no skipped tests, before a release can be built.");
  const lines = goldens.split(/\r?\n/).filter((line) => /^(same|written|changed|size|missing)\s/.test(line));
  if (lines.length !== 6 || lines.some((line, i) => !new RegExp(`^same\\s+frame-0${i + 1}\\.png\\s`).test(line))) throw new Error("All six golden frames must match. Missing or newly written frames do not pass.");
  return { unit: `${passed}/${total}`, goldens: "6/6" };
}

/**
 * The render browser ships inside the release (hashed with every other file): HyperFrames' own download has no
 * pinned checksum, and scripts/runtime.mjs refuses to render without this copy.
 */
export function bundleBrowser(stage, run = command) {
  const hf = path.join(stage, "node_modules", ".bin", "hyperframes");
  run(hf, ["browser", "ensure"], { cwd: stage });
  const chrome = run(hf, ["browser", "path"], { cwd: stage }).trim().split(/\r?\n/).pop();
  if (!/chrome-headless-shell-mac-arm64\/chrome-headless-shell$/.test(chrome) || !fs.existsSync(chrome)) throw new Error(`The render browser was not found (${chrome}).`);
  fs.cpSync(path.dirname(chrome), path.join(stage, "assets", "browser", "chrome-headless-shell-mac-arm64"), { recursive: true, verbatimSymlinks: true });
}

export function buildRelease({ app = PKG_ROOT, id, run = command, now = new Date(), browser = bundleBrowser } = {}) {
  assertClean(app, run);
  id = validID(id || `${now.toISOString().slice(0, 10).replaceAll("-", ".")}.1`);
  const output = path.join(app, "dist", "release", id);
  if (fs.existsSync(output)) throw new Error(`Release ${id} already exists. Choose a new release number.`);
  const commit = run("git", ["rev-parse", "HEAD"], { cwd: app }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Could not read the saved git build.");
  const tests = testCounts(run("npm", ["test"], { cwd: app, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --test-reporter=tap`.trim() } }), run(process.execPath, ["scripts/golden.mjs"], { cwd: app }));
  run("/bin/bash", ["scripts/build-helpers.sh"], { cwd: app });
  assertClean(app, run);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-release-"));
  try {
    const stage = path.join(temp, "reel-editor");
    copyApp(app, stage);
    for (const file of ["install.sh", "package.json", "package-lock.json", "runtime/runtime.json", "dist/helpers/darwin-arm64/helpers.json"]) {
      if (!fs.existsSync(path.join(stage, file))) throw new Error(`The release needs ${file}.`);
    }
    // pngjs is a devDependency used by the app's grid and slide checks, so keep full npm ci.
    run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: stage });
    browser(stage, run);
    const runtime = JSON.parse(fs.readFileSync(path.join(stage, "runtime/runtime.json"), "utf8"));
    const name = `reel-editor-${id}.tar.gz`;
    const release = { schema: 1, id, commit, createdAt: now.toISOString(), runtime, artifact: { name, url: `https://github.com/gpingelbiz/Ai/releases/download/reel-${id}/${name}` }, files: hashFiles(stage), tests };
    // The embedded manifest describes the files; only the sidecar can contain the finished archive's hash.
    json(path.join(stage, "release.json"), release);
    const archive = path.join(temp, name);
    run("tar", ["-czf", archive, "-C", temp, "reel-editor"], { cwd: app, env: { ...process.env, COPYFILE_DISABLE: "1" } });
    release.artifact.sha256 = fileHash(archive);
    release.artifact.bytes = fs.statSync(archive).size;
    assertClean(app, run);
    if (run("git", ["rev-parse", "HEAD"], { cwd: app }).trim() !== commit) throw new Error("The saved git build changed during release checks. Build again.");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const ready = path.join(temp, "ready");
    fs.mkdirSync(ready);
    fs.renameSync(archive, path.join(ready, name));
    json(path.join(ready, "release.json"), release);
    const pending = fs.mkdtempSync(path.join(path.dirname(output), `.${id}-`));
    try {
      fs.cpSync(ready, pending, { recursive: true });
      fs.renameSync(pending, output);
    } finally { fs.rmSync(pending, { recursive: true, force: true }); }
    console.log(`${path.join(output, name)}\nsha256 ${release.artifact.sha256}\n${release.artifact.bytes} bytes`);
    return release;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export function loadArtifact(app, id, { file = path.join(app, "dist", "release", id, "release.json") } = {}) {
  validID(id);
  const dir = path.dirname(file);
  const release = readReleaseManifest(file);
  const name = `reel-editor-${id}.tar.gz`;
  if (!release || release.id !== id || release.artifact?.name !== name || release.artifact.url !== `https://github.com/gpingelbiz/Ai/releases/download/reel-${id}/${name}` || !/^[a-f0-9]{64}$/.test(release.artifact.sha256 || "") || !Number.isSafeInteger(release.artifact.bytes) || release.artifact.bytes <= 0 || !/^([1-9]\d*)\/\1$/.test(release.tests?.unit || "") || release.tests?.goldens !== "6/6") throw new Error("The release details do not match this release number.");
  const archive = path.join(dir, name);
  if (fileHash(archive) !== release.artifact.sha256 || fs.statSync(archive).size !== release.artifact.bytes) throw new Error("The release download does not match its check. Build it again before sending it.");
  return { release, file, archive };
}

export function publishRelease({ app = PKG_ROOT, id, yes = false, run = command } = {}) {
  const { release, file, archive } = loadArtifact(app, id);
  console.log(`Publish reel-${id} to gpingelbiz/Ai\nCommit: ${release.commit}\n${archive}\n${file}\nsha256 ${release.artifact.sha256}\n${release.artifact.bytes} bytes`);
  if (!yes) throw new Error("Nothing was published. Add --yes after reviewing the files above.");
  run("gh", ["release", "create", `reel-${id}`, archive, file, "--repo", "gpingelbiz/Ai", "--target", release.commit, "--title", `Reel Editor ${id}`, "--notes", `Tested release ${id}. Unit tests: ${release.tests.unit}. Golden frames: ${release.tests.goldens}.`], { cwd: app });
}

/** Only checked archives are unpacked; the kit builder itself comes from the selected release. */
export function withReleaseApp({ app = PKG_ROOT, id, run = command, manifestFile }, use) {
  const { release, file, archive } = loadArtifact(app, id, { file: manifestFile });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-kit-release-"));
  try {
    const listing = run("tar", ["-tzf", archive], { cwd: app, quiet: true });
    if (!listing.trim() || listing.trim().split(/\r?\n/).some((p) => !/^reel-editor(?:\/|$)/.test(p) || p.split("/").includes(".."))) throw new Error("The release contains an unexpected folder.");
    run("tar", ["-xzf", archive, "-C", temp], { cwd: app, env: { ...process.env, COPYFILE_DISABLE: "1" } });
    const source = path.join(temp, "reel-editor");
    const bad = verifyRelease({ app: source });
    const embedded = JSON.parse(fs.readFileSync(path.join(source, "release.json"), "utf8"));
    if (bad.length || !sameRelease(embedded, release)) throw new Error(`The saved release files do not match: ${bad.join(", ") || "release.json"}`);
    return use({ source, release, file });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export function buildKits({ app = PKG_ROOT, id, clients = path.join(os.homedir(), "Reels/client-brands/kits.json"), run = command } = {}) {
  const registry = JSON.parse(fs.readFileSync(clients, "utf8"));
  if (!Array.isArray(registry) || registry.some((c) => !c || typeof c.brand !== "string" || typeof c.out !== "string" || (c.studio != null && typeof c.studio !== "string"))) throw new Error("The client list needs a brand file, an output folder and an optional studio guide for each kit.");
  const resolve = (file) => path.resolve(path.dirname(path.resolve(clients)), file.replace(/^~(?=\/)/, os.homedir()));
  return withReleaseApp({ app, id, run }, ({ source, file }) => {
    for (const c of registry) {
      const args = [path.join(source, "scripts/brand-kit.mjs"), resolve(c.brand), "--release", file, "--out", resolve(c.out)];
      if (c.studio) args.push("--studio", resolve(c.studio));
      run(process.execPath, args, { cwd: source });
    }
  });
}

export function main(args = process.argv.slice(2)) {
  const [action, ...rest] = args;
  const options = new Map();
  let id;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--yes") options.set(arg, true);
    else if (["--id", "--clients"].includes(arg) && rest[i + 1] && !rest[i + 1].startsWith("--")) options.set(arg, rest[++i]);
    else if (!arg.startsWith("--") && !id) id = arg;
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (action === "build" && !id && [...options.keys()].every((k) => k === "--id")) return buildRelease({ id: options.get("--id") });
  if (action === "publish" && id && [...options.keys()].every((k) => k === "--yes")) return publishRelease({ id, yes: options.has("--yes") });
  if (action === "kits" && id && [...options.keys()].every((k) => k === "--clients")) return buildKits({ id, clients: options.get("--clients") });
  throw new Error("Use: release.mjs build [--id 2026.11.08.1], publish <id> [--yes], or kits <id> [--clients registry.json].");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
