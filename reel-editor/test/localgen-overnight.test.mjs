import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PKG_ROOT, readJSON } from "../src/util.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "overnight-tests-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const script = path.join(PKG_ROOT, "tools/localgen/overnight.sh");

function fixture() {
  const dir = fs.mkdtempSync(path.join(root, "case-")), bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const stub = (name, body) => {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
    return file;
  };
  const record = `import fs from "node:fs"; import path from "node:path"; const args = process.argv.slice(2); fs.appendFileSync(process.env.STUB_CALLS, JSON.stringify({ tool: path.basename(process.argv[1]), args }) + "\\n");`;
  stub("ssh", `${record}
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync("/bin/bash", ["-c", args.at(-1)], { input: fs.readFileSync(0), stdio: ["pipe", "inherit", "inherit"], env: { ...process.env, HOME: process.env.STUB_REMOTE_HOME } });
    process.exit(result.status ?? 1);`);
  stub("scp", `${record}
    const source = args.at(-2), target = args.at(-1);
    const decode = (s) => s.slice(s.indexOf(":") + 1).slice(1, -1).replaceAll("'\\\\''", "'");
    if (source.startsWith("mini:")) fs.cpSync(decode(source), path.join(target, path.basename(decode(source))), { recursive: true });
    else fs.copyFileSync(source, decode(target));`);
  const remoteNode = stub("remote-node", `${record}
    if (process.env.STUB_GENERATION_FAIL) { console.error("worker failed"); process.exit(7); }
    if (!args.includes("--generate-only") || args.includes("--admit")) throw new Error("wrong remote mode");
    const batch = path.join(process.env.HOME, "localgen/outputs/batch-test");
    fs.mkdirSync(batch, { recursive: true });
    fs.copyFileSync(args[args.indexOf("--prompts") + 1], path.join(batch, "prompts.json"));
    fs.writeFileSync(path.join(batch, "coconut-1.mp4"), "candidate");
    fs.writeFileSync(path.join(batch, "results.json"), JSON.stringify([{ id: "coconut-1", ok: true, file: path.join(batch, "coconut-1.mp4") }]));
    console.log("[reel] broll-generate: batch folder: " + batch);`);
  const localNode = stub("local-node", `${record}
    if (!args.includes("--admit") || args.includes("--generate-only")) throw new Error("wrong local mode");
    const batch = args[args.indexOf("--admit") + 1];
    for (const file of ["prompts.json", "results.json", "coconut-1.mp4"]) fs.accessSync(path.join(batch, file));
    if (process.env.STUB_ADMISSION_FAIL) { console.error("admission failed"); process.exit(9); }
    fs.writeFileSync(path.join(batch, "admission.json"), JSON.stringify([{ id: "coconut-1", approved: true, libraryId: "test-clip" }]));
    console.log("local admission complete");`);
  const env = { ...process.env, HOME: path.join(dir, "MacBook"), PATH: `${bin}:${process.env.PATH}`, STUB_REMOTE_HOME: path.join(dir, "Mini home"), STUB_CALLS: path.join(dir, "calls.jsonl"),
    REEL_LOCALGEN_SSH_HOST: "mini", REEL_LOCALGEN_SSH_KEY: path.join(dir, "key file"), REEL_LOCALGEN_REMOTE_REPO: PKG_ROOT,
    REEL_LOCALGEN_REMOTE_NODE: remoteNode, REEL_LOCALGEN_NODE: localNode, REEL_LOCALGEN_BATCHES: path.join(dir, "B-roll library/batches"), REEL_LOCALGEN_LOG: path.join(dir, "overnight.log"),
    REEL_CACHE: path.join(dir, "cache"), REEL_BROLL_RECENT: path.join(dir, "recent.json") };
  fs.mkdirSync(env.STUB_REMOTE_HOME);
  return { dir, env, calls: () => fs.readFileSync(env.STUB_CALLS, "utf8").trim().split("\n").map(JSON.parse) };
}

function run(env, args = []) {
  const result = spawnSync("/bin/bash", [script, ...args], { env, encoding: "utf8", timeout: 15000 });
  if (result.status && env.REEL_LOCALGEN_LOG && fs.existsSync(env.REEL_LOCALGEN_LOG)) result.stderr += fs.readFileSync(env.REEL_LOCALGEN_LOG, "utf8");
  return result;
}

test("overnight dry-run previews defaults and overrides without SSH, scp, generation, admission or writes", () => {
  const f = fixture(), env = { ...f.env };
  for (const key of Object.keys(env)) if (key.startsWith("REEL_LOCALGEN_")) delete env[key];
  const defaults = run(env, ["--dry-run"]);
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.match(defaults.stdout, /gregs-mac-mini/);
  assert.match(defaults.stdout, /id_triage_mirror/);
  assert.match(defaults.stdout, /--generate-only.*wait/);
  assert.match(defaults.stdout, /--admit/);
  assert.match(defaults.stdout, /localgen-batches/);
  assert.equal(fs.existsSync(env.HOME), false);
  const custom = run(f.env, ["--dry-run", "--prompts", path.join(PKG_ROOT, "tools/localgen/prompts.json")]);
  assert.equal(custom.status, 0, custom.stderr);
  assert.match(custom.stdout, /remote-node/);
  assert.match(custom.stdout, /local-node/);
  assert.match(custom.stdout, /mini/);
  assert.equal(fs.existsSync(f.env.STUB_CALLS), false);
  assert.equal(fs.existsSync(f.env.REEL_LOCALGEN_BATCHES), false);
  assert.equal(fs.existsSync(f.env.REEL_LOCALGEN_LOG), false);
});

test("overnight waits for background generation, copies its batch and admits locally while retaining Mini evidence", () => {
  const f = fixture(), result = run(f.env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = f.calls();
  assert.deepEqual(calls.map((c) => c.tool), ["ssh", "scp", "ssh", "remote-node", "ssh", "scp", "local-node"]);
  const localBatch = path.join(f.env.REEL_LOCALGEN_BATCHES, "batch-test");
  assert.equal(readJSON(path.join(localBatch, "admission.json"))[0].approved, true);
  const remoteBatch = path.join(f.env.STUB_REMOTE_HOME, "localgen/outputs/batch-test");
  assert.equal(fs.existsSync(path.join(remoteBatch, "results.json")), true);
  assert.equal(fs.existsSync(path.join(remoteBatch, "admission.json")), false);
  const jobs = path.join(f.env.STUB_REMOTE_HOME, "localgen/jobs");
  const job = path.join(jobs, fs.readdirSync(jobs)[0]);
  assert.equal(fs.readFileSync(path.join(job, "status"), "utf8"), "0\n");
  assert.match(fs.readFileSync(f.env.REEL_LOCALGEN_LOG, "utf8"), /local admission complete/);
});

test("overnight stops on generation failure and retains the worker log and status", () => {
  const f = fixture(), result = run({ ...f.env, STUB_GENERATION_FAIL: "1" });
  assert.equal(result.status, 7, result.stdout + result.stderr);
  assert.equal(f.calls().filter((c) => c.tool === "scp").length, 1);
  assert.equal(f.calls().some((c) => c.tool === "local-node"), false);
  assert.match(fs.readFileSync(f.env.REEL_LOCALGEN_LOG, "utf8"), /worker failed/);
  const jobs = path.join(f.env.STUB_REMOTE_HOME, "localgen/jobs"), job = path.join(jobs, fs.readdirSync(jobs)[0]);
  assert.equal(fs.readFileSync(path.join(job, "status"), "utf8"), "7\n");
});

test("overnight propagates local admission failure and keeps both batch copies", () => {
  const f = fixture(), result = run({ ...f.env, STUB_ADMISSION_FAIL: "1" });
  assert.equal(result.status, 9, result.stdout + result.stderr);
  for (const dir of [f.env.REEL_LOCALGEN_BATCHES, path.join(f.env.STUB_REMOTE_HOME, "localgen/outputs")]) assert.equal(fs.existsSync(path.join(dir, "batch-test/results.json")), true);
  assert.match(fs.readFileSync(f.env.REEL_LOCALGEN_LOG, "utf8"), /admission failed/);
});
