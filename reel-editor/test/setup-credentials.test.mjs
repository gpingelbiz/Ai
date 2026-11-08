import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { KEY_NAMES, validateCredential, saveKey, removeKey, hasKey } from "../src/credentials.mjs";

const addresses = {
  elevenlabs: "https://api.elevenlabs.io/v1/user",
  runway: "https://api.dev.runwayml.com/v1/organization",
  pixabay: "https://pixabay.com/api/videos/?key=fake+key&q=test&per_page=3",
  pexels: "https://api.pexels.com/videos/search?query=test&per_page=1",
};
for (const service of Object.keys(KEY_NAMES)) {
  for (const [code, expected] of [[200, "valid"], [401, "invalid"], [403, "no-permission"], [408, "unreachable"], [429, "unreachable"], [500, "unreachable"], [503, "unreachable"]]) {
    test(`${service} key check: ${code} is ${expected}, one read only`, async () => {
      let calls = 0;
      const result = await validateCredential(service, "fake key", { fetchFn: async (url, options) => {
        calls++;
        assert.equal(url, addresses[service]);
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "error");
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.body, undefined);
        if (service === "runway") assert.deepEqual(options.headers, { Authorization: "Bearer fake key", "X-Runway-Version": "2024-11-06" });
        if (service === "elevenlabs") assert.deepEqual(options.headers, { "xi-api-key": "fake key" });
        if (service === "pexels") assert.deepEqual(options.headers, { Authorization: "fake key" });
        return { status: code };
      } });
      assert.deepEqual(result, { status: expected });
      assert.equal(calls, 1);
    });
  }
  for (const failure of [new Error("network failure with fake key"), new DOMException("timeout with fake key", "TimeoutError")]) {
    test(`${service} key check: ${failure.name} never means invalid`, async () => {
      let calls = 0;
      assert.deepEqual(await validateCredential(service, "fake key", { fetchFn: async () => { calls++; throw failure; } }), { status: "unreachable" });
      assert.equal(calls, 1);
    });
  }
}
test("Pixabay bad keys use its 400 response; other 400 responses are not guessed invalid", async () => {
  assert.deepEqual(await validateCredential("pixabay", "fake", { fetchFn: async () => ({ status: 400, text: async () => '[ERROR 400] Invalid API key.' }) }), { status: "invalid" });
  assert.deepEqual(await validateCredential("pixabay", "fake", { fetchFn: async () => ({ status: 400, text: async () => 'query not allowed' }) }), { status: "no-permission" });
});
test("empty and multiline keys do not make a request", async () => {
  for (const value of ["", "  ", "fake\nkey", "fake\0key"]) assert.deepEqual(await validateCredential("pexels", value, { fetchFn: () => assert.fail("must not fetch") }), { status: "invalid" });
});
test("keys are private, literal shell data; edits preserve other keys and never execute them", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "setup-keys-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const marker = path.join(home, "should-not-exist"), file = path.join(home, ".reel/keys.env");
  const hostile = `fake ' "; $(touch ${marker}); \`touch ${marker}\` $HOME \\ !# & | > <`;
  saveKey("elevenlabs", hostile, { home });
  saveKey("runway", "second fake", { home });
  saveKey("pixabay", "third fake", { home });
  saveKey("pexels", "fourth fake", { home });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(hasKey("elevenlabs", { home }), true);
  assert.equal(hasKey("RUNWAY_API_KEY", { home }), true);
  assert.equal(fs.existsSync(marker), false);
  // A shell consumer must receive the same literal value, even with hostile punctuation.
  const sourced = spawnSync("/bin/bash", ["-c", '. "$1"; printf "%s" "$ELEVENLABS_API_KEY"', "test", file], { encoding: "utf8" });
  assert.equal(sourced.status, 0);
  assert.equal(sourced.stdout, hostile);
  assert.equal(fs.existsSync(marker), false);
  fs.chmodSync(file, 0o644); fs.chmodSync(path.dirname(file), 0o755);
  removeKey("runway", { home });
  assert.equal(hasKey("runway", { home }), false);
  assert.equal(hasKey("elevenlabs", { home }), true);
  assert.equal(hasKey("pixabay", { home }), true);
  assert.equal(hasKey("pexels", { home }), true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["keys.env"]);
  assert.throws(() => saveKey("pexels", "bad\nvalue", { home }), /one line/);
});
test("keys file expressions are rejected as data without printing or executing them", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "setup-key-data-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, ".reel"));
  const marker = path.join(home, "executed");
  fs.writeFileSync(path.join(home, ".reel/keys.env"), `PEXELS_API_KEY=$(touch ${marker})\n`);
  assert.throws(() => hasKey("pexels", { home }), (e) => !e.message.includes(marker));
  assert.equal(fs.existsSync(marker), false);
});
