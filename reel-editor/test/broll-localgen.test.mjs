import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { localgenPrompts, generateBrollLibrary, admitBrollBatch, LOCALGEN_LICENCE } from "../src/broll-localgen.mjs";
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

test("generate-only keeps prompts and results, prints the batch folder and never calls admission or Claude", async () => {
  const f = fixture();
  const result = await generateBrollLibrary({ promptsFile: f.promptsFile, generateOnly: true, deps: { ...f.deps, checkRunwayVideo: fail, saveLibraryClip: fail } });
  assert.equal(f.calls.runs.length, 1);
  assert.deepEqual(readJSON(path.join(result.dir, "prompts.json")), [prompt]);
  assert.equal(readJSON(path.join(result.dir, "results.json"))[0].ok, true);
  assert.deepEqual(result.approved, []);
  assert.ok(f.calls.logs.includes(`broll-generate: batch folder: ${result.dir}`));
  assert.equal(fs.existsSync(path.join(result.dir, "admission.json")), false);
  assert.equal(fs.existsSync(f.env.REEL_BROLL_LIBRARY), false);
});

test("admission accepts a copied batch, saves progress per clip, skips approvals and retries rejections", async () => {
  const f = fixture([prompt, { ...prompt, id: "coconut-2", seed: 1102 }]);
  const generated = await generateBrollLibrary({ promptsFile: f.promptsFile, generateOnly: true, deps: f.deps });
  const dir = path.join(f.dir, "MacBook batch");
  fs.cpSync(generated.dir, dir, { recursive: true });
  fs.rmSync(generated.dir, { recursive: true });
  f.calls.runs.length = 0;
  f.deps.checkRunwayVideo = async (args) => {
    assert.equal(args.file, path.join(dir, `${args.pick.id}.mp4`));
    if (args.pick.id === "coconut-2") {
      assert.equal(readJSON(path.join(dir, "admission.json"))[0].approved, true);
      return { ...verdict, ok: false, why: "no drop" };
    }
    return verdict;
  };
  const first = await generateBrollLibrary({ admit: dir, deps: f.deps });
  assert.equal(first.approved.length, 1);
  assert.equal(f.calls.runs.length, 2);
  f.deps.checkRunwayVideo = async (args) => { assert.equal(args.pick.id, "coconut-2"); return verdict; };
  const second = await admitBrollBatch({ dir, deps: f.deps });
  assert.equal(second.approved.length, 1);
  assert.equal(second.results.length, 2);
  assert.ok(second.results.every((r) => r.approved));
  assert.equal(readLibrary(f.env).clips.length, 2);
  const again = await admitBrollBatch({ dir, deps: { ...f.deps, runFn: fail, checkRunwayVideo: fail, saveLibraryClip: fail } });
  assert.deepEqual(again.results, second.results);
  assert.deepEqual(again.approved, []);
});

test("admission dry-run is read-only and invalid admission records fail before any process", async () => {
  const f = fixture(), generated = await generateBrollLibrary({ promptsFile: f.promptsFile, generateOnly: true, deps: f.deps });
  const deps = { ...f.deps, runFn: fail, checkRunwayVideo: fail, saveLibraryClip: fail };
  assert.equal((await admitBrollBatch({ dir: generated.dir, dryRun: true, deps })).dryRun, true);
  assert.equal(fs.existsSync(path.join(generated.dir, "admission.json")), false);
  for (const records of [null, [{ id: prompt.id, approved: true }], [{ id: "other", approved: false }], [{ id: prompt.id, approved: false }, { id: prompt.id, approved: false }]]) {
    writeJSON(path.join(generated.dir, "admission.json"), records);
    await assert.rejects(admitBrollBatch({ dir: generated.dir, deps }), /invalid local admission results/);
  }
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
    assert.equal((await main(["broll-generate", "--prompts", f.promptsFile, "--generate-only", "--dry-run"])).dryRun, true);
    await assert.rejects(main(["broll-generate", "--admit", f.dir, "--generate-only"]), /cannot be combined/);
    await assert.rejects(main(["broll-generate", "--admit", f.dir, "--prompts", f.promptsFile]), /cannot be combined/);
    assert.equal(fs.existsSync(f.env.REEL_LOCALGEN_HOME), false);
    const generated = await generateBrollLibrary({ promptsFile: f.promptsFile, generateOnly: true, deps: f.deps });
    assert.equal((await main(["broll-generate", "--admit", generated.dir, "--dry-run"])).dryRun, true);
  } finally { if (before === undefined) delete process.env.REEL_LOCALGEN_HOME; else process.env.REEL_LOCALGEN_HOME = before; }
});

test("supplied queue contains two literal fixed-seed variants per subject", () => {
  const prompts = localgenPrompts(readJSON(path.join(PKG_ROOT, "tools/localgen/prompts.json")));
  assert.equal(prompts.length, 10);
  for (const subject of ["coconut", "cream", "gorilla", "snake", "wave"]) assert.equal(prompts.filter((p) => p.shows === subject).length, 2);
  assert.equal(new Set(prompts.map((p) => p.seed)).size, 10);
  for (const p of prompts) { assert.match(p.prompt, /Camera locked off/); assert.match(p.prompt, /Natural daylight/); assert.match(p.prompt, /no .*text/i); }
  for (const p of prompts.filter((p) => p.shows === "coconut")) {
    assert.match(p.prompt, /entering from the top of the frame at the first frame/);
    assert.match(p.prompt, /lands on the sand within the first second/);
    assert.match(p.prompt, /no stick, no stem, no rope, no string/);
  }
  for (const p of prompts.filter((p) => p.shows === "cream")) {
    assert.match(p.prompt, /plain blank unlabelled tube, no text, no logo/);
    assert.match(p.prompt, /cream is already flowing at the first frame/);
  }
  assert.match(prompts.find((p) => p.id === "gorilla-2").prompt, /consistent dark black fur/);
  assert.match(prompts.find((p) => p.id === "wave-2").prompt, /photorealistic documentary footage/i);
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
