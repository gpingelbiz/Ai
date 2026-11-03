import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { localgenPrompts, generateBrollLibrary, LOCALGEN_LICENCE } from "../src/broll-localgen.mjs";
import { readLibrary } from "../src/broll-library.mjs";
import { main } from "../src/cli.mjs";
import { PKG_ROOT, readJSON, writeJSON } from "../src/util.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "localgen-tests-"));
process.env.REEL_CACHE = root;
process.env.REEL_BROLL_RECENT = path.join(root, "recent.json");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const fail = () => { throw new Error("unexpected process or provider call"); };
const prompt = { id: "coconut-1", shows: "coconut", scene: "One coconut above sand in daylight.", action: "The coconut falls onto sand.", prompt: "A coconut drops onto sand. Locked camera.", seed: 1101 };
const verdict = { ok: true, look: "pass", shows: true, action: true };

function fixture(prompts = [prompt]) {
  const dir = fs.mkdtempSync(path.join(root, "case-")), promptsFile = path.join(dir, "queue.json");
  writeJSON(promptsFile, prompts);
  const calls = { runs: [], checks: [], warnings: [], logs: [] };
  const env = { REEL_LOCALGEN_HOME: path.join(dir, "worker"), REEL_CACHE: dir, REEL_BROLL_LIBRARY: path.join(dir, "library"), REEL_BROLL_RECENT: path.join(dir, "recent.json") };
  const deps = { env, logFn: (s) => calls.logs.push(s), warnFn: (s) => calls.warnings.push(s),
    makeClip: fail, animateStill: fail, makeSound: fail, organization: fail, claudeLook: fail, claudeText: fail,
    runFn: async (cmd, args, options) => {
      calls.runs.push({ cmd, args, options });
      if (cmd === "ffprobe") return { out: JSON.stringify({ streams: [{ width: 704, height: 1280 }], format: { duration: "2.708333" } }) };
      assert.equal(cmd, path.join(env.REEL_LOCALGEN_HOME, ".venv/bin/python"));
      const out = args[args.indexOf("--out") + 1];
      const queue = readJSON(args[args.indexOf("--prompts") + 1]);
      writeJSON(path.join(out, "results.json"), queue.map((p) => {
        const file = path.join(out, `${p.id}.mp4`);
        fs.writeFileSync(file, `candidate ${p.id}`);
        return { id: p.id, file, ok: true };
      }));
    },
    checkRunwayVideo: async (args) => { calls.checks.push(args); return verdict; },
  };
  return { dir, env, calls, deps, promptsFile };
}

test("local generation validates the entire queue before starting any work", async () => {
  for (const value of [null, [], [null], [{ ...prompt, action: " " }], [{ ...prompt, id: "../escape" }], [prompt, prompt], [{ ...prompt, seed: -1 }], [{ ...prompt, seed: 2 ** 32 }], [{ ...prompt, seed: 0.5 }]]) {
    assert.throws(() => localgenPrompts(value));
    const f = fixture(value);
    await assert.rejects(generateBrollLibrary({ promptsFile: f.promptsFile, deps: { ...f.deps, runFn: fail } }));
    assert.equal(fs.existsSync(f.env.REEL_LOCALGEN_HOME), false);
  }
  assert.deepEqual(localgenPrompts([{ ...prompt, extra: "ignored" }]), [prompt]);
  await assert.rejects(generateBrollLibrary(), /needs --prompts/);
});

test("dry-run validates and lists without processes, checks, library writes or worker directories", async () => {
  const f = fixture();
  const result = await generateBrollLibrary({ promptsFile: f.promptsFile, dryRun: true, deps: { ...f.deps, runFn: fail, checkRunwayVideo: fail, saveLibraryClip: fail } });
  assert.deepEqual(result, { dryRun: true, prompts: [prompt], approved: [] });
  assert.equal(fs.existsSync(f.env.REEL_LOCALGEN_HOME), false);
  assert.match(f.calls.logs[0], /coconut-1: seed 1101/);
});

test("local queue uses the venv, probes each MP4 and imports only inspected footage without marking use", async () => {
  const f = fixture([prompt, { ...prompt, id: "coconut-2", seed: 1102 }]);
  f.deps.checkRunwayVideo = async (args) => { f.calls.checks.push(args); return args.pick.id === "coconut-1" ? verdict : { ...verdict, ok: false, why: "no physical drop" }; };
  const result = await generateBrollLibrary({ promptsFile: f.promptsFile, deps: f.deps });
  assert.equal(result.approved.length, 1);
  assert.equal(f.calls.runs.length, 3);
  assert.equal(f.calls.runs[0].args[0], path.join(PKG_ROOT, "tools/localgen/generate.py"));
  assert.equal(f.calls.runs[0].options.env, f.env);
  assert.equal(f.calls.checks.length, 2);
  const check = f.calls.checks[0];
  assert.equal(check.pick.shows, prompt.shows); assert.equal(check.pick.action, prompt.action);
  assert.equal(check.shot.duration, 2.708333); assert.equal(check.eventOnly, undefined);
  assert.equal(check.groups[0].text, `${prompt.shows}. ${prompt.action}`);
  const bank = readLibrary(f.env);
  assert.equal(bank.clips.length, 1); assert.deepEqual(bank.reels, []);
  assert.deepEqual(bank.clips[0].usedIn, []);
  assert.equal(bank.clips[0].source, "localgen");
  assert.deepEqual(bank.clips[0].licence, LOCALGEN_LICENCE);
  assert.equal(fs.readFileSync(bank.clips[0].file, "utf8"), "candidate coconut-1");
  assert.deepEqual(readJSON(path.join(result.dir, "admission.json")), result.results);
  assert.match(result.results[1].reason, /no physical drop/);
  assert.equal(fs.existsSync(f.env.REEL_BROLL_RECENT), false);
});

test("inspection errors, missing subjects/actions and unavailable or incomplete verdicts fail closed", async () => {
  for (const moves of [{ ...verdict, unavailable: true }, { ...verdict, look: "unavailable" }, { ...verdict, shows: false }, { ...verdict, action: false }, { ok: true, look: "pass" }, null, new Error("vision offline")]) {
    const f = fixture();
    f.deps.checkRunwayVideo = async () => { if (moves instanceof Error) throw moves; return moves; };
    f.deps.saveLibraryClip = fail;
    const result = await generateBrollLibrary({ promptsFile: f.promptsFile, deps: f.deps });
    assert.deepEqual(result.approved, []); assert.equal(result.results[0].approved, false);
    assert.deepEqual(readLibrary(f.env).clips, []);
  }
});

test("wrong dimensions/duration, failed generations and missing files never reach inspection", async () => {
  for (const bad of ["landscape", "small", "short", "long", "nan", "failed", "missing", "wrong-file"]) {
    const f = fixture(), run = f.deps.runFn;
    f.deps.checkRunwayVideo = fail; f.deps.saveLibraryClip = fail;
    f.deps.runFn = async (cmd, args, options) => {
      if (cmd === "ffprobe") return { out: JSON.stringify({ streams: [{ width: bad === "small" ? 448 : 704, height: bad === "landscape" ? 480 : 1280 }], format: { duration: ({ short: "1", long: "4", nan: "NaN" })[bad] || "2.71" } }) };
      await run(cmd, args, options);
      const out = args[args.indexOf("--out") + 1], file = path.join(out, "results.json"), results = readJSON(file);
      if (bad === "failed") results[0].ok = false;
      if (bad === "missing") fs.unlinkSync(results[0].file);
      if (bad === "wrong-file") results[0].file = path.join(f.dir, "other.mp4");
      writeJSON(file, results);
    };
    const result = await generateBrollLibrary({ promptsFile: f.promptsFile, deps: f.deps });
    assert.deepEqual(result.approved, [], bad);
  }
});

test("invalid result manifests and generator process failure stop before admission", async () => {
  for (const manifest of [null, [], [{ id: "other" }], [{ id: prompt.id }, { id: prompt.id }]]) {
    const f = fixture();
    f.deps.runFn = async (_cmd, args) => writeJSON(path.join(args[args.indexOf("--out") + 1], "results.json"), manifest);
    f.deps.checkRunwayVideo = fail;
    await assert.rejects(generateBrollLibrary({ promptsFile: f.promptsFile, deps: f.deps }), /invalid local generation results/);
  }
  const f = fixture(); f.deps.runFn = async () => { throw new Error("worker failed"); };
  await assert.rejects(generateBrollLibrary({ promptsFile: f.promptsFile, deps: f.deps }), /worker failed/);
  assert.deepEqual(readLibrary(f.env).clips, []);
});

test("CLI exposes broll-generate help, requires prompts and supports a process-free dry-run", async () => {
  const f = fixture(), before = process.env.REEL_LOCALGEN_HOME;
  process.env.REEL_LOCALGEN_HOME = f.env.REEL_LOCALGEN_HOME;
  try {
    await main(["broll-generate", "--help"]);
    await assert.rejects(main(["broll-generate"]), /needs --prompts/);
    assert.equal((await main(["broll-generate", "--prompts", f.promptsFile, "--dry-run"])).dryRun, true);
    assert.equal(fs.existsSync(f.env.REEL_LOCALGEN_HOME), false);
  } finally { if (before === undefined) delete process.env.REEL_LOCALGEN_HOME; else process.env.REEL_LOCALGEN_HOME = before; }
});

test("supplied queue contains two literal fixed-seed variants per subject", () => {
  const prompts = localgenPrompts(readJSON(path.join(PKG_ROOT, "tools/localgen/prompts.json")));
  assert.equal(prompts.length, 10);
  for (const subject of ["coconut", "cream", "gorilla", "snake", "wave"]) assert.equal(prompts.filter((p) => p.shows === subject).length, 2);
  assert.equal(new Set(prompts.map((p) => p.seed)).size, 10);
  for (const p of prompts) { assert.match(p.prompt, /Camera locked off/); assert.match(p.prompt, /Natural daylight/); assert.match(p.prompt, /no .*text/i); }
});

test("installer parses and gates all mutations and downloads behind explicit approval", () => {
  const file = path.join(PKG_ROOT, "tools/localgen/install.sh"), script = fs.readFileSync(file, "utf8");
  const syntax = spawnSync("/bin/bash", ["-n", file], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  const stop = script.indexOf('if [ "${LOCALGEN_OK:-}" != "1" ]');
  assert.ok(stop > script.indexOf("awk "));
  assert.ok(stop < script.indexOf('mkdir -p "$localgen_root"'));
  assert.ok(stop < script.indexOf("curl -fLsS"));
  assert.match(script, /installed\.txt/); assert.match(script, /shasum -a 256 -c/);
  assert.match(script, /python install 3\.12\.16/);
});

test("Python helpers exercise offline generation, memory tracking and failures with injected runtime only", () => {
  const result = spawnSync("python3", ["-B", path.join(PKG_ROOT, "test/localgen-python.py"), path.join(PKG_ROOT, "tools/localgen/generate.py")], { encoding: "utf8", env: { ...process.env, REEL_CACHE: root }, timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
