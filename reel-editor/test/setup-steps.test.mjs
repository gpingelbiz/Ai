import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSetup, runTerminalSetup } from "../src/setup-steps.mjs";
import { hasKey, saveKey } from "../src/credentials.mjs";

function fixture(t, overrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "setup-steps-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const studioRoot = path.join(home, "Content Studio");
  const calls = [];
  const deps = {
    run(bin, args) { calls.push([bin, args]); return { status: 0, stdout: args[0] === "auth" ? '{"loggedIn":true}' : 'Logged in using ChatGPT' }; },
    login: () => assert.fail("no real login"),
    detectConnectors: async () => ({ metricool: { connected: true, name: "My Metricool" } }),
    metricoolBrands: async () => [{ id: "1", label: "Brand One", timezone: "America/Phoenix", networks: ["instagram", "facebook"] }, { id: "2", label: "Brand Two", timezone: "America/Chicago", networks: ["instagram"] }],
    fetchFn: async () => ({ status: 200 }),
    directReady: () => true,
    desktopApp: () => undefined,
    verifyRoutines: async (root) => ({ ok: true, tasks: [{ id: "reel-publish", enabled: true, schedule: "45 7-20 * * *", folder: root }, { id: "daily-posts", enabled: true, schedule: "0 6,12 * * *", folder: root }] }),
    ...overrides,
  };
  const options = { home, studioRoot, deps };
  return { ...options, options, calls, make: () => createSetup(options), config: () => JSON.parse(fs.readFileSync(path.join(studioRoot, "studio.json"), "utf8")) };
}
const brandAnswer = { brand: "Brand Two", brandId: "2", networks: ["instagram"], confirm: true };
test("resume after every ordered step, with no reapplication of saved answers", async (t) => {
  const f = fixture(t);
  let setup = f.make();
  const answers = {
    claude: { action: "check" }, metricool: brandAnswer, photos: {}, media: { route: "tunnel" }, schedule: { posting: "off" },
    "key-elevenlabs": { action: "skip" }, "key-runway": { action: "later" }, "key-pixabay": { value: "test-only" }, "key-pexels": { action: "later" },
    codex: { action: "check" }, health: { action: "skip" }, routines: { action: "check" },
  };
  assert.deepEqual(setup.steps.map((s) => s.id), Object.keys(answers));
  for (const [index, [id, answer]] of Object.entries(answers).entries()) {
    assert.equal(setup.next().id, id);
    await setup.answer(id, answer);
    const before = fs.readFileSync(path.join(f.studioRoot, "studio.json"), "utf8");
    setup = f.make();
    assert.equal(setup.next()?.id, Object.keys(answers)[index + 1]);
    assert.equal(fs.readFileSync(path.join(f.studioRoot, "studio.json"), "utf8"), before);
    assert.equal(setup.snapshot().steps[index].status, answer.action === "skip" || answer.action === "later" ? "skipped" : "done");
  }
  assert.equal(setup.next(), undefined);
  assert.equal(fs.readFileSync(setup.stateFile, "utf8").includes("test-only"), false);
  assert.deepEqual(fs.readdirSync(f.studioRoot).filter((s) => /\.tmp$|\.lock$/.test(s)), []);
  assert.ok(f.calls.some(([,args]) => args.join(" ") === "auth status"));
  assert.equal(f.calls.some(([,args]) => args.includes("-p")), false);
});
test("new setups hold photo slots empty and posting off without changing legacy defaults", (t) => {
  const f = fixture(t), setup = f.make();
  assert.deepEqual(f.config().slots, []);
  assert.equal(f.config().publish.mode, "off");
  assert.deepEqual(setup.snapshot().slots, []);
  assert.equal(f.config().reels.rawIntake, false);
});
test("posting off is preserved across brand changes, checks and restarts; only an explicit choice turns it on", async (t) => {
  const f = fixture(t), setup = f.make();
  await setup.answer("claude", { action: "check" });
  await setup.answer("metricool", brandAnswer);
  await setup.answer("schedule", { posting: "off" });
  await f.make().answer("metricool", { brand: "Brand One", networks: ["facebook"], confirm: true });
  await f.make().answer("schedule", { action: "check" });
  assert.equal(f.config().publish.mode, "off");
  await f.make().answer("schedule", { posting: "Turn on posting" });
  assert.equal(f.config().publish.mode, "schedule");
  assert.deepEqual(f.config().slots, []);
  await f.make().answer("schedule", { posting: "off" });
  assert.equal(f.config().publish.mode, "off");
});
test("posting needs connected accounts and photo slots need a completed guide", async (t) => {
  const f = fixture(t), setup = f.make();
  await setup.answer("schedule", { posting: "Turn on posting" });
  assert.equal(f.config().publish.mode, "off");
  await setup.answer("schedule", { posting: "off", slots: [{ format: "carousel", time: "10:00" }] });
  assert.deepEqual(f.config().slots, []);
  await setup.answer("schedule", { posting: "keep", brandGuideComplete: true, slots: [{ format: "carousel", time: "10:00" }, { format: "static", time: "6:00 PM" }] });
  assert.deepEqual(f.config().slots, [{ format: "carousel", time: "10:00" }, { format: "static", time: "18:00" }]);
  assert.equal(f.config().publish.mode, "off");
  await setup.answer("schedule", { posting: "off", brandGuideComplete: true, slots: [{ format: "carousel", time: "10:00" }, { format: "static", time: "10:30" }] });
  assert.equal(f.config().slots[1].time, "18:00");
});
test("Metricool requires a visible connector, a deliberate brand by name, listed networks and time zone", async (t) => {
  const f = fixture(t), setup = f.make();
  for (const answer of [{ brand: "1", networks: ["instagram"], confirm: true }, { brand: "Brand One", networks: ["instagram"] }, { brand: "Brand One", networks: ["tiktok"], confirm: true }, { brand: "Brand One", networks: [], confirm: true }]) {
    await setup.answer("metricool", answer);
    assert.equal(setup.snapshot().steps.find((s) => s.id === "metricool").status, "needs-you");
    assert.equal(f.config().metricool.blogId, "");
  }
  await setup.answer("metricool", { action: "check" });
  const view = setup.snapshot().steps.find((s) => s.id === "metricool");
  assert.deepEqual(view.brands[0], { id: "1", name: "Brand One", networks: ["instagram", "facebook"], timezone: "America/Phoenix" });
  await setup.answer("metricool", brandAnswer);
  assert.equal(f.config().timezone, "America/Chicago");
  f.deps.detectConnectors = async () => ({});
  await f.make().answer("metricool", brandAnswer);
  assert.equal(f.config().metricool.blogId, "2");
  f.deps.detectConnectors = async () => ({ metricool: { name: "Visible", connected: true } });
  f.deps.metricoolBrands = async () => [{ id: "1", label: "Brand One", networks: ["instagram"], timezone: "wrong" }];
  await f.make().answer("metricool", { brand: "Brand One", networks: ["instagram"], confirm: true });
  assert.equal(f.config().metricool.blogId, "2");
});
test("settings edited outside setup are preserved on resume and unrelated answers", async (t) => {
  const f = fixture(t), setup = f.make();
  await setup.answer("schedule", { posting: "off" });
  const config = f.config();
  config.publish = { mode: "off", custom: "keep" }; config.slots = [{ format: "static", time: "15:00" }]; config.reels.look = "mine"; config.extra = { mine: true };
  fs.writeFileSync(path.join(f.studioRoot, "studio.json"), JSON.stringify(config));
  const before = fs.readFileSync(path.join(f.studioRoot, "studio.json"), "utf8");
  f.make().snapshot();
  assert.equal(fs.readFileSync(path.join(f.studioRoot, "studio.json"), "utf8"), before);
  await setup.answer("metricool", brandAnswer);
  assert.deepEqual(f.config().publish, { mode: "off", custom: "keep" });
  assert.equal(f.config().slots[0].time, "15:00"); assert.equal(f.config().reels.look, "mine"); assert.deepEqual(f.config().extra, { mine: true });
});
test("failed credential answers are saved without keys, URLs, raw errors or losing a good saved key", async (t) => {
  const secret = "fake-secret-never-in-state";
  const f = fixture(t, { fetchFn: async () => { throw new Error(`bad URL ${secret}`); } }), setup = f.make();
  saveKey("runway", "old-test-key", { home: f.home });
  await setup.answer("key-runway", { value: secret });
  assert.equal(hasKey("runway", { home: f.home }), true);
  const serialized = JSON.stringify(setup.snapshot());
  assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes("old-test-key"), false);
  assert.equal(fs.readFileSync(setup.stateFile, "utf8").includes(secret), false);
  assert.equal(setup.snapshot().steps.find((s) => s.id === "key-runway").answer.check, "unreachable");
  await setup.answer("health", { url: `https://example.test/${secret}` });
  assert.equal(fs.readFileSync(setup.stateFile, "utf8").includes(secret), false);
});
test("routine checks only use verifier; missing Desktop shows official download without an installer", async (t) => {
  let called = 0;
  const f = fixture(t, { verifyRoutines: async (root) => { called++; assert.equal(root, f.studioRoot); return { ok: false, tasks: [] }; } });
  const setup = f.make();
  await setup.answer("routines", { action: "check" });
  assert.equal(called, 1);
  assert.equal(setup.snapshot().steps.at(-1).status, "needs-you");
  await setup.answer("routines", { action: "prepare" });
  assert.equal(setup.snapshot().steps.at(-1).desktopMissing, true);
  assert.equal(f.calls.length, 0);
});
test("Codex API key login is not mistaken for ChatGPT sign in; Claude checks no model prompt", async (t) => {
  const f = fixture(t, { run: () => ({ status: 0, stdout: "Logged in using an API key" }) }), setup = f.make();
  await setup.answer("codex", { action: "check" });
  assert.equal(setup.snapshot().steps.find((s) => s.id === "codex").status, "needs-you");
  await setup.answer("claude", { action: "check" });
  assert.equal(setup.snapshot().steps[0].status, "needs-you");
});
test("Terminal and a second setup instance share the same state and masked key question", async (t) => {
  const f = fixture(t), terminal = f.make(), page = f.make();
  let secretAsked = false;
  const output = [];
  await runTerminalSetup(terminal, {
    ask: async (question, fallback) => {
      if (question.startsWith("Type the full brand")) return "Brand Two";
      if (question.startsWith("Type the connected")) return "instagram";
      if (question.startsWith("Use this brand")) return "yes";
      if (question === "Add, Skip, or Add later?" && !secretAsked) return "Add";
      return fallback;
    },
    askSecret: async () => { secretAsked = true; return "fake-terminal-secret"; },
    write: (value) => output.push(value),
  });
  assert.equal(secretAsked, true);
  assert.equal(output.join("\n").includes("fake-terminal-secret"), false);
  assert.equal(page.next(), undefined);
  assert.deepEqual(page.snapshot(), terminal.snapshot());
  await page.answer("schedule", { posting: "off" });
  assert.deepEqual(page.snapshot(), terminal.snapshot());
});
test("photo and media choices reject protected, missing and unconfirmed folders", async (t) => {
  const f = fixture(t), setup = f.make();
  await setup.answer("photos", { folder: path.join(f.home, "Desktop/Photos") });
  assert.equal(setup.snapshot().steps.find((s) => s.id === "photos").status, "needs-you");
  await setup.answer("media", { route: "drive", folder: f.home });
  assert.equal(f.config().hosting.route, "tunnel");
  await setup.answer("media", { route: "drive", folder: f.home, shared: true });
  assert.equal(f.config().hosting.route, "drive");
  await setup.answer("media", { route: "bad" });
  assert.equal(f.config().hosting.route, "drive");
});
test("failed checks and skips are durable and cannot skip a required step", async (t) => {
  const f = fixture(t, { run: () => ({ status: 1 }) }), setup = f.make();
  await setup.answer("claude", { action: "check" });
  assert.equal(f.make().next().id, "claude");
  await setup.answer("claude", { action: "skip" });
  assert.equal(f.make().next().id, "claude");
  await setup.answer("key-pexels", { action: "later" });
  assert.equal(f.make().snapshot().steps.find((s) => s.id === "key-pexels").status, "skipped");
});
test("missing direct sharing tool stays pending and never starts a download", async (t) => {
  const f = fixture(t, { directReady: () => false }), setup = f.make();
  await setup.answer("media", { route: "tunnel" });
  assert.equal(setup.snapshot().steps.find((s) => s.id === "media").status, "needs-you");
  assert.equal(f.config().hosting.route, "tunnel");
  assert.equal(f.calls.length, 0);
});
test("Terminal defaults preserve existing photos, route, slots and posting choice", async (t) => {
  const f = fixture(t), setup = f.make();
  for (const [id, answer] of [["claude", { action: "check" }], ["metricool", brandAnswer]]) await setup.answer(id, answer);
  const config = f.config();
  const photos = path.join(f.home, "Pictures/My Photos");
  fs.mkdirSync(photos, { recursive: true });
  config.photos = photos; config.hosting = { route: "dropbox", folder: f.home }; config.publish.mode = "draft"; config.slots = [{ format: "static", time: "14:00" }];
  fs.writeFileSync(path.join(f.studioRoot, "studio.json"), JSON.stringify(config));
  await runTerminalSetup(setup, { ask: async (q, fallback) => fallback, askSecret: () => assert.fail("no keys requested"), write: () => {} });
  assert.equal(f.config().photos, photos);
  assert.deepEqual(f.config().hosting, config.hosting);
  assert.equal(f.config().publish.mode, "draft");
  assert.deepEqual(f.config().slots, config.slots);
});
test("setup checks cannot overlap or overwrite the other interface's answer", async (t) => {
  let release;
  const f = fixture(t, { detectConnectors: () => new Promise((resolve) => { release = resolve; }) });
  const a = f.make(), b = f.make();
  const pending = a.answer("metricool", { action: "check" });
  await assert.rejects(b.answer("schedule", { posting: "off" }), /Another setup check/);
  release({});
  await pending;
  await b.answer("schedule", { posting: "off" });
  assert.equal(a.snapshot().steps.find((s) => s.id === "schedule").status, "done");
  assert.equal(b.snapshot().steps.find((s) => s.id === "metricool").status, "needs-you");
});
test("new setup creates the Desktop links once and preserves the client's brand on resume", (t) => {
  const f = fixture(t), brandFrom = path.join(f.home, "Kit Brand");
  fs.mkdirSync(brandFrom);
  fs.writeFileSync(path.join(brandFrom, "brand.json"), JSON.stringify({ name: "Test Brand" }));
  fs.writeFileSync(path.join(brandFrom, "voice.md"), "kit voice");
  createSetup({ ...f.options, brandFrom });
  assert.equal(fs.readlinkSync(path.join(f.home, "Desktop/Reels/Photos")), path.join(f.studioRoot, "Photos"));
  fs.writeFileSync(path.join(f.studioRoot, "brand/voice.md"), "my own voice");
  createSetup({ ...f.options, brandFrom });
  assert.equal(fs.readFileSync(path.join(f.studioRoot, "brand/voice.md"), "utf8"), "my own voice");
});
