import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { claudeBinary, hasClaude, claudeText, claudeLook } from "../src/claude.mjs";

function disk(files) {
  return {
    accessSync(file) { if (files[file] !== "executable" && files[file] !== "directory") throw new Error("not executable"); },
    statSync(file) { return { isFile: () => files[file] !== "directory" }; },
  };
}

test("Claude lookup prefers the explicit override, then executable PATH entries, then installer locations", () => {
  const env = { HOME: "/home/worker", PATH: "/first:/second" };
  const files = { "/first/claude": "directory", "/second/claude": "executable", "/home/worker/.local/bin/claude": "executable", "/home/worker/.claude/local/claude": "executable" };
  const deps = { fs: disk(files), homedir: () => "/other" };
  assert.equal(claudeBinary({ ...env, REEL_CLAUDE_BIN: "/custom/claude" }, deps), "/custom/claude");
  assert.equal(hasClaude({ ...env, REEL_CLAUDE_BIN: "/missing" }, deps), false);
  assert.equal(claudeBinary(env, deps), "/second/claude");
  files["/second/claude"] = "not-executable";
  assert.equal(claudeBinary(env, deps), "/home/worker/.local/bin/claude");
  assert.equal(hasClaude(env, deps), true);
  delete files["/home/worker/.local/bin/claude"];
  assert.equal(claudeBinary(env, deps), "/home/worker/.claude/local/claude");
  delete files["/home/worker/.claude/local/claude"];
  assert.equal(claudeBinary(env, deps), "claude");
  assert.equal(hasClaude(env, deps), false);
  assert.equal(claudeBinary({}, { fs: disk({ "/other/.local/bin/claude": "executable" }), homedir: () => "/other" }), "/other/.local/bin/claude");
});

test("a named Claude override resolves only through PATH and never silently falls back", () => {
  const deps = { fs: disk({ "/bin/custom": "executable", "/home/worker/.local/bin/claude": "executable" }) };
  assert.equal(claudeBinary({ HOME: "/home/worker", REEL_CLAUDE_BIN: "custom" }, deps), "custom");
  assert.equal(hasClaude({ PATH: "/bin", REEL_CLAUDE_BIN: "custom" }, deps), true);
  assert.equal(hasClaude({ PATH: "/missing", REEL_CLAUDE_BIN: "custom" }, deps), false);
});

test("text and vision runners spawn the shared fallback with injected dependencies", async () => {
  const env = { HOME: "/worker", REEL_CLAUDE_MODEL: "test-model" }, calls = [];
  const deps = { env, fs: disk({ "/worker/.local/bin/claude": "executable" }), spawn: (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => { child.stdout.emit("data", "test reply"); child.emit("close", 0); });
    return child;
  } };
  assert.equal(await claudeText("text prompt", { deps }), "test reply");
  assert.equal(await claudeLook("vision prompt", { cwd: "/frames", deps }), "test reply");
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.bin, "/worker/.local/bin/claude");
    assert.equal(c.opts.env, env);
    assert.deepEqual(c.args.slice(-2), ["--model", "test-model"]);
  }
  assert.equal(calls[1].opts.cwd, "/frames");
  assert.equal(calls[0].args[calls[0].args.indexOf("--tools") + 1], "");
  assert.equal(calls[1].args[calls[1].args.indexOf("--tools") + 1], "Read");
});

test("Greg 11-24: firstJSON reads the first object even with trailing notes or a second object", async () => {
  const { firstJSON } = await import("../src/claude.mjs");
  const L = { lenient: true };
  assert.deepEqual(firstJSON('{"overlays":[{"t":"a}"}]}\n\nNote: {extra}', L), { overlays: [{ t: "a}" }] });
  assert.deepEqual(firstJSON('Here you go {"a":1} and also {"b":2}', L), { a: 1 });
  assert.deepEqual(firstJSON('```json\n{"a":{"b":"x\\"}"}}\n```', L), { a: { b: 'x"}' } });
  assert.throws(() => firstJSON('Here you go {"a":1} and also {"b":2}'), "strict by default");
  assert.throws(() => firstJSON("no json here"));
});
