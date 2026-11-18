#!/usr/bin/env node
// Plan check: re-runs saved edits and proves the edit plan did not change. Each case copies a saved work folder
// (APFS clone, so it is instant and free), re-runs runEdit on the copy with rendering off, and compares the new edit
// plan exactly with the plan the baseline code (origin/main by default) made from the same copy. Used as the guard for
// the edit pipeline rework (#127): any difference is a bug.
//   node scripts/plan-check.mjs              baseline from origin/main (cached per commit), then compare this tree
//   node scripts/plan-check.mjs --ref <ref>  baseline from another commit or branch
//   node scripts/plan-check.mjs --only <case>[,<case>]   run some cases
//   node scripts/plan-check.mjs --list       show the cases
// Safety: originals are only read (every file's size and mtime is compared before and after), every paid key is
// removed, `claude`, `codex` and `curl` are replaced by stubs that fail and are recorded, fetch is blocked, and REEL_CACHE is a fresh clone per
// run, so no saved state outside the temp folder changes. A saved result an edit cannot reuse fails the case loudly
// instead of spending money.
// Not covered: Runway moving B-roll (every saved Runway edit predates the current B-roll prompt, so re-running one
// would ask Claude again) and the music mood pick (Claude's answer is not saved, so the track the edit used is given as the file).
// Normalized before comparing: the temp work folder path (replaced by $WORK) and the temp cache path ($CACHE).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "../src/util.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const HOME = os.homedir();
const ROOT = path.join(os.tmpdir(), "reel-plan-check");
const REAL_CACHE = process.env.REEL_CACHE || path.join(HOME, ".cache", "reel-editor");

// One case per path through an edit. `opts` is what runEdit gets besides `out` and `noRender`.
export const CASES = [
  { name: "glow", folder: "~/Reels/videos/clip-vsl-listen-glow", what: "glow look, Greg's default" },
  { name: "glow-clip", folder: "~/Reels/videos/clip-fathom-two-objections-glow", what: "glow look on a clip" },
  { name: "bold", folder: "~/Reels/videos/img-7526-broll-bold", what: "bold look with B-roll" },
  { name: "vsl", folder: "~/Reels/videos/greg-vsl-vsl", what: "Greg's VSL, 16:9" },
  { name: "stitch", folder: "~/Reels/videos/greg-3-places-stitch", what: "stitch from three takes", stitch: true },
  { name: "julee-vsl", folder: "~/Reels/clients/julee-gracey/videos/2026-bf-day3-retreat-vsl2", what: "Julee's scripted VSL: cards and B-roll", client: "~/Reels/clients/julee-gracey/client.env", script: "~/Clients/julee-gracey/vsl/projects/2026-bf-day3-retreat/04-script/script.v005.md" },
];

// Baselines are reused per baseline commit and per version of this script (a changed recipe re-runs them).
const RECIPE = createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex").slice(0, 8);
const PAID = /(API_KEY|_SECRET|_TOKEN|^ANTHROPIC|^OPENAI|^RUNWAY|^ELEVENLABS|^PIXABAY|^PEXELS|^SUBMAGIC|^CODEX_)/i;
// Where tools live stays; every other REEL_ setting comes from the case, so Greg's shell never leaks into a check.
const TOOLS = new Set(["REEL_PYTHON", "REEL_RUNTIME", "REEL_DEEPFILTER", "REEL_BROWSER_PATH", "REEL_CHROME", "REEL_CLOUDFLARED"]);
const home = (p) => p.replace(/^~(?=\/)/, HOME);
const readJSON = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

/** Variables a client's own jobs run with (its client.env), minus anything secret. */
export function clientVars(file) {
  const vars = {};
  for (const line of fs.readFileSync(home(file), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)='(.*)'$/);
    if (m && !PAID.test(m[1])) vars[m[1]] = m[2].replace(/'\\''/g, "'");
  }
  return vars;
}

/**
 * Recipe for re-running a saved edit: the source it used, and its plan's style (the preset after every option the
 * edit was given was applied) as the preset, so the saved cards and B-roll still match.
 */
export function recipe(c) {
  const folder = home(c.folder);
  const meta = readJSON(path.join(folder, "meta.json"));
  const plan = readJSON(path.join(folder, "plan.json"));
  const opts = { title: path.basename(folder) };
  if (c.stitch) opts.scenes = path.join(folder, "stitch", "scenes.json");
  if (c.hook) opts.hook = plan.hook.text;
  if (c.script) opts.script = home(c.script);
  const style = structuredClone(plan.style);
  // The music mood is Claude's pick and is not saved; the track the edit used is (music.txt), so it is given as the
  // file. The mood picker itself is not covered by this check.
  const picked = fs.existsSync(path.join(folder, "music.txt")) && fs.readFileSync(path.join(folder, "music.txt"), "utf8").match(/^Music: (.+)$/m)?.[1];
  if (picked && style.audio?.musicDir && fs.existsSync(path.join(style.audio.musicDir, picked))) style.audio.music = path.join(style.audio.musicDir, picked);
  const env = c.client ? clientVars(c.client) : {};
  return { folder, input: meta.input, style, env, opts: { ...opts, ...(c.opts || {}) } };
}

/** Size and mtime of every file under a folder, so a write into an original is caught. */
export function fingerprint(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { const st = fs.statSync(p); out[path.relative(dir, p)] = `${st.size}:${Math.round(st.mtimeMs)}`; }
    }
  };
  walk(dir);
  return out;
}

/** First path at which two JSON values differ, or null when they are equal. */
export function firstDifference(a, b, at = "plan") {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    return { at, before: a, after: b };
  }
  if (Array.isArray(a) && a.length !== b.length) return { at: `${at}.length`, before: a.length, after: b.length };
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const d = firstDifference(a[k], b[k], Array.isArray(a) ? `${at}[${k}]` : `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

export function normalize(plan, { work, cache }) {
  let s = JSON.stringify(plan);
  for (const [from, to] of [[work, "$WORK"], [cache, "$CACHE"]]) s = s.split(from).join(to);
  return JSON.parse(s);
}

function stubs(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const calls = path.join(dir, "calls.log");
  for (const name of ["claude", "codex", "curl"]) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, `#!/bin/sh\necho "${name} $*" >> "${calls}"\necho "plan check: ${name} is blocked (a saved result was not reused)" >&2\nexit 1\n`);
    fs.chmodSync(f, 0o755);
  }
  return calls;
}

/** Runs one case with the code in `code` (a reel-editor folder) and returns its normalized edit plan. */
function runCase(c, code, label) {
  const r = recipe(c);
  // The same paths for every run of a case: the edit seeds some picks from its work folder's path.
  const run = path.join(ROOT, "run", c.name);
  fs.rmSync(run, { recursive: true, force: true });
  fs.mkdirSync(run, { recursive: true });
  const work = path.join(run, "work"), cache = path.join(run, "cache"), bin = path.join(run, "bin");
  const clone = (from, to) => {
    const res = spawnSync("cp", ["-cR", from, to]);
    if (res.status !== 0) throw new Error(`could not clone ${from}: ${String(res.stderr).trim()}`);
  };
  clone(r.folder, work);
  const cacheFrom = r.env.REEL_CACHE || REAL_CACHE;
  if (fs.existsSync(cacheFrom)) clone(cacheFrom, cache); else fs.mkdirSync(cache);
  const preset = path.join(run, "preset.json");
  fs.writeFileSync(preset, JSON.stringify(r.style));
  const calls = stubs(bin);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !PAID.test(k) && (!k.startsWith("REEL_") || TOOLS.has(k))));
  Object.assign(env, r.env, {
    PATH: `${bin}:${process.env.PATH}`, REEL_CLAUDE_BIN: path.join(bin, "claude"), REEL_CODEX_BIN: path.join(bin, "codex"),
    REEL_CACHE: cache, REEL_USAGE_FILE: path.join(run, "usage.json"), REEL_BROLL_RECENT: path.join(cache, "broll-recent.json"),
    // Placeholders let steps that check for a key reach their saved results; the network is blocked in the child.
    RUNWAY_API_KEY: "plan-check-no-network", ELEVENLABS_API_KEY: "plan-check-no-network", PLAN_CHECK_CALLS: calls,
  });
  const before = fingerprint(r.folder);
  const job = path.join(run, "job.json"), result = path.join(run, "plan.json");
  fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
  const log = path.join(ROOT, "logs", `${label}-${c.name}.log`);
  fs.writeFileSync(job, JSON.stringify({ code, input: r.input, opts: { ...r.opts, preset, out: work, noRender: true }, result }));
  const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", job], { env, cwd: run, encoding: "utf8", timeout: 10 * 60 * 1000 });
  fs.writeFileSync(log, `${res.stdout || ""}${res.stderr || ""}`);
  const changed = Object.entries(fingerprint(r.folder)).filter(([f, v]) => before[f] !== v).map(([f]) => f);
  const removed = Object.keys(before).filter((f) => !fs.existsSync(path.join(r.folder, f)));
  if (changed.length || removed.length) throw new Error(`${c.name}: the ORIGINAL work folder changed (${[...changed, ...removed].slice(0, 5).join(", ")})`);
  const blocked = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim() : "";
  if (blocked) throw new Error(`${c.name}: tried a paid call (${blocked.split("\n")[0].slice(0, 120)}); log: ${log}`);
  if (res.status !== 0 || !fs.existsSync(result)) {
    const tail = `${res.stderr || ""}${res.stdout || ""}`.trim().split("\n").slice(-6).join("\n");
    throw new Error(`${c.name}: the edit failed${res.error ? ` (${res.error.message})` : ""}\n${tail}\nlog: ${log}`);
  }
  return { plan: normalize(readJSON(result), { work, cache }), log };
}

async function child(jobFile) {
  const job = readJSON(jobFile);
  globalThis.fetch = async (url) => {
    fs.appendFileSync(process.env.PLAN_CHECK_CALLS, `fetch ${url}\n`);
    throw new Error(`plan check: network is blocked (${url})`);
  };
  const { runEdit } = await import(pathToFileURL(path.join(job.code, "src", "pipeline.mjs")).href);
  const { plan } = await runEdit(job.input, job.opts);
  fs.writeFileSync(job.result, JSON.stringify(plan));
}

function git(args, cwd = APP) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.trim()}`);
  return res.stdout.trim();
}

/** A checkout of `ref` with this tree's node_modules, made once per commit. */
function baselineCode(ref) {
  const sha = git(["rev-parse", ref]);
  const dir = path.join(ROOT, "code", sha);
  const app = path.join(dir, "reel-editor");
  if (!fs.existsSync(path.join(app, "src", "pipeline.mjs"))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const tar = spawnSync("sh", ["-c", `git archive ${sha} reel-editor | tar -x -C "${dir}"`], { cwd: path.resolve(APP, ".."), encoding: "utf8" });
    if (tar.status !== 0) throw new Error(`could not check out ${ref}: ${tar.stderr.trim()}`);
  }
  const nm = path.join(app, "node_modules");
  if (!fs.existsSync(nm)) fs.symlinkSync(fs.realpathSync(path.join(APP, "node_modules")), nm);
  return { sha, app };
}

async function main(argv) {
  if (argv[0] === "--child") return child(argv[1]);
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes("--list")) { for (const c of CASES) console.log(`${c.name.padEnd(10)} ${c.what}  (${c.folder})`); return; }
  const only = arg("--only")?.split(",");
  const cases = only ? CASES.filter((c) => only.includes(c.name)) : CASES;
  if (!cases.length) throw new Error(`no such case: ${only}`);
  fs.mkdirSync(ROOT, { recursive: true });
  const { sha, app } = baselineCode(arg("--ref") || "origin/main");
  console.log(`plan check: baseline ${sha.slice(0, 7)} vs this tree (${APP})`);
  let failed = 0;
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const saved = path.join(ROOT, "baselines", `${sha.slice(0, 12)}-${RECIPE}`, `${c.name}.json`);
      let before;
      if (fs.existsSync(saved)) before = readJSON(saved);
      else {
        before = runCase(c, app, "base").plan;
        fs.mkdirSync(path.dirname(saved), { recursive: true });
        fs.writeFileSync(saved, JSON.stringify(before));
      }
      const after = runCase(c, APP, "this");
      const d = firstDifference(before, after.plan);
      const secs = Math.round((Date.now() - t0) / 1000);
      if (d) {
        failed++;
        console.log(`FAIL ${c.name} (${secs}s): edit plan differs at ${d.at}\n  before: ${JSON.stringify(d.before)?.slice(0, 200)}\n  after:  ${JSON.stringify(d.after)?.slice(0, 200)}\n  log: ${after.log}`);
      } else console.log(`same ${c.name} (${secs}s)`);
    } catch (error) {
      failed++;
      console.log(`FAIL ${error.message}`);
    }
  }
  console.log(failed ? `plan check: ${failed} of ${cases.length} failed` : `plan check: all ${cases.length} edit plans identical`);
  process.exitCode = failed ? 1 : 0;
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
