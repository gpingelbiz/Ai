import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSetupHandler, openSetupPage } from "../src/setup-page.mjs";
import { createSetup, runTerminalSetup } from "../src/setup-steps.mjs";

const token = "test-session-token", origin = "http://127.0.0.1:45678";
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "setup-page-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const options = { home, deps: {
    run: () => ({ status: 0, stdout: '{"loggedIn":true}' }), fetchFn: async () => ({ status: 200 }),
    detectConnectors: async () => ({}), metricoolBrands: () => assert.fail("no real Metricool"),
    login: () => assert.fail("no real login"), verifyRoutines: async () => ({ ok: false, tasks: [] }),
    prepareRoutines: () => assert.fail("no real routine changes"), desktopApp: () => undefined,
  } };
  return { options, setup: createSetup(options) };
}
async function request(handler, { method = "GET", url = `/api/state?token=${token}`, headers = {}, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [typeof body === "string" ? body : JSON.stringify(body)]);
  req.method = method; req.url = url;
  req.headers = { host: new URL(origin).host, ...(method === "POST" ? { origin, "content-type": "application/json" } : {}), ...headers };
  const res = new EventEmitter();
  res.headers = {}; res.statusCode = 200;
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
  res.end = (value) => { res.body = value; res.emit("finish"); };
  await handler(req, res);
  return res;
}
for (const [name, options] of [
  ["wrong token", { url: "/api/state?token=wrong" }],
  ["missing token", { url: "/api/state" }],
  ["foreign origin", { headers: { origin: "https://evil.example" } }],
  ["null origin", { headers: { origin: "null" } }],
  ["wrong host", { headers: { host: "evil.example:45678" } }],
  ["rebound host", { headers: { host: "localhost:45678" } }],
  ["wrong port", { headers: { host: "127.0.0.1:45679" } }],
  ["foreign absolute URL", { url: `http://evil.example/api/state?token=${token}` }],
  ["protocol relative URL", { url: `//evil.example/api/state?token=${token}` }],
]) test(`setup page rejects ${name}`, async () => {
  let called = false;
  const handler = createSetupHandler({ snapshot: () => { called = true; } }, { token, origin });
  const res = await request(handler, options);
  assert.equal(res.statusCode, 403);
  assert.equal(called, false);
});
for (const headers of [{ origin: undefined }, { origin: "https://evil.example" }, { host: "evil.example" }, { "x-reel-setup-token": "wrong" }]) test(`setup page rejects an unauthorized mutation: ${JSON.stringify(headers)}`, async (t) => {
  const { setup } = fixture(t), handler = createSetupHandler(setup, { token, origin });
  const res = await request(handler, { method: "POST", url: "/api/answer", headers: { "x-reel-setup-token": token, ...headers }, body: { id: "schedule", answer: { posting: "off" } } });
  assert.equal(res.statusCode, 403);
  assert.equal(fs.existsSync(setup.stateFile), false);
});
test("setup page only permits JSON, limits body size and does not reflect credentials", async (t) => {
  const { setup } = fixture(t), handler = createSetupHandler(setup, { token, origin });
  const base = { method: "POST", url: `/api/answer?token=${token}` };
  assert.equal((await request(handler, { ...base, headers: { "content-type": "text/plain" }, body: {} })).statusCode, 415);
  assert.equal((await request(handler, { ...base, body: "fake-secret-invalid-json" })).statusCode, 400);
  const big = await request(handler, { ...base, body: { secret: "x".repeat(17000) } });
  assert.equal(big.statusCode, 413);
  assert.equal(big.body.includes("x".repeat(100)), false);
  const invalid = await request(handler, { ...base, body: { id: "fake-secret-unlisted-step", answer: {} } });
  assert.equal(invalid.statusCode, 400); assert.equal(invalid.body.includes("fake-secret"), false);
  assert.equal(fs.existsSync(setup.stateFile), false);
});
test("the page has no third party scripts or browser storage and uses a masked one use key field", async (t) => {
  const { setup } = fixture(t), handler = createSetupHandler(setup, { token, origin });
  const res = await request(handler, { url: `/?token=${token}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
  assert.match(res.headers["content-security-policy"], /default-src 'none'.*frame-ancestors 'none'/);
  assert.match(res.body, /<script nonce="[^"]+">/);
  assert.doesNotMatch(res.body, /<script[^>]+src=|localStorage|sessionStorage|indexedDB|document\.cookie|__NONCE__/);
  assert.match(res.body, /'Your key', 'password'/);
  assert.match(res.body, /const value = key.value; key.value = '';/);
  assert.match(res.body, /window\.close\(\)/);
  assert.match(res.body, /https:\/\/claude.com\/download/);
});
test("page mutations and Terminal questions use one saved state, even in separate instances", async (t) => {
  const { setup, options } = fixture(t), handler = createSetupHandler(setup, { token, origin });
  const res = await request(handler, { method: "POST", url: "/api/answer", headers: { "x-reel-setup-token": token }, body: { id: "key-pexels", answer: { value: "fake-once-key" } } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.includes("fake-once-key"), false);
  const terminal = createSetup(options), output = [];
  await runTerminalSetup(terminal, { ask: async () => "", askSecret: () => assert.fail("no key question needed"), write: (line) => output.push(line) });
  assert.ok(output.some((line) => line.includes("Pexels key: Done")));
  assert.equal(output.join("\n").includes("fake-once-key"), false);
  const current = JSON.parse((await request(handler)).body);
  assert.equal(current.steps[0].status, "done");
  assert.equal(current.steps.find((s) => s.id === "key-pexels").status, "done");
});
test("Finish stops the server only for an authenticated same origin request", async (t) => {
  const { setup } = fixture(t); let finishes = 0;
  const handler = createSetupHandler(setup, { token, origin, onFinish: () => { finishes++; } });
  const bad = await request(handler, { method: "POST", url: "/api/finish?token=wrong", body: {} });
  assert.equal(bad.statusCode, 403); assert.equal(finishes, 0);
  const good = await request(handler, { method: "POST", url: `/api/finish?token=${token}`, body: {} });
  assert.equal(good.statusCode, 200); assert.equal(finishes, 1);
});
test("live setup binds a free loopback port and exits on Finish", async (t) => {
  const { setup } = fixture(t);
  let page;
  try { page = await openSetupPage(setup, { open: () => {}, write: () => {} }); }
  catch (error) {
    // This sandbox denies listening. Request security is still covered above without sockets.
    if (["EPERM", "EACCES"].includes(error.cause?.code)) { t.skip("localhost listening is blocked in this sandbox"); return; }
    throw error;
  }
  t.after(() => { page.server.close(); page.server.closeAllConnections(); });
  const url = new URL(page.url);
  assert.equal(url.hostname, "127.0.0.1"); assert.notEqual(url.port, "0"); assert.match(url.searchParams.get("token"), /^[a-f0-9]{64}$/);
  const response = await fetch(`${url.origin}/api/finish`, { method: "POST", headers: { Origin: url.origin, "X-Reel-Setup-Token": url.searchParams.get("token"), "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 200);
  await page.finished;
  assert.equal(page.server.listening, false);
});
