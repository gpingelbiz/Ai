import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLIP_LENGTHS, setChoice, templateLines } from "../src/setup.mjs";
import { watchReport, markWatched } from "../src/watch.mjs";
import { install, routine, attended, allowRules, setupPrompt } from "../src/watcher.mjs";

const script = fileURLToPath(new URL("../bin/opus-dropbox.mjs", import.meta.url));
test("shared settings choices validate without mutation", () => {
  const project = { curationPref: { other: true } }, templates = [{ templateId: "t", name: "Brand", isDefault: true }];
  assert.match(templateLines(templates)[0], /0\).*Brand/);
  for (const value of [-1, 2, "1.5", "", "x"]) {
    const before = structuredClone(project);
    assert.throws(() => setChoice(project, "template", value, templates));
    assert.deepEqual(project, before);
  }
  assert.throws(() => setChoice(project, "length", CLIP_LENGTHS.length));
  setChoice(project, "template", 1, templates);
  assert.equal(project.brandTemplateId, "t");
  setChoice(project, "template", 0, templates);
  assert.ok(!project.brandTemplateId);
  CLIP_LENGTHS.forEach(([, d], i) => { setChoice(project, "length", i); assert.deepEqual(project.curationPref?.clipDurations ?? null, d); });
  setChoice(project, "length", 0);
  assert.deepEqual(project.curationPref, { other: true });
});

test("watch detects problems, scrubs output and only metadata changes; notifications dedupe", async () => {
  const now = Date.now();
  const c = { opus: { apiKey: "secret-opus" }, dropbox: { appKey: "secret-app", refreshToken: "secret-refresh" }, folders: { drop: "/a", finished: "/b" }, stuckHours: 1 };
  const state = { lastRun: new Date(now - 31 * 60000).toISOString(), lastReport: { blocked: "secret-opus https://example.com/share" }, items: {
    a: { name: "slow", status: "in_opus", stage: "QUEUED", sentAt: new Date(now - 7200000).toISOString() },
    b: { name: "bad", status: "failed", error: "secret-refresh https://example.com/share" },
    c: { name: "delivery", status: "delivering", deliverErrors: 1, lastError: "secret-app" },
    d: { name: "done", status: "done", doneAt: new Date(now).toISOString(), clips: 2, dest: "/b/done" },
  } };
  const original = structuredClone(state);
  const clients = { opus: { templates: async () => { throw new Error("secret-opus https://example.com/key"); } }, dropbox: { account: async () => { throw new Error("secret-refresh"); }, list: async () => { throw new Error("missing"); }, exists: async () => false } };
  const report = await watchReport({ c, state, clients, job: false, now });
  assert.deepEqual(state, original);
  assert.equal(report.problems.length, 10);
  assert.equal(report.counts.done, 1);
  assert.equal(report.newlyDone.length, 1);
  assert.doesNotMatch(JSON.stringify(report), /secret-|https:\/\//);
  let notices = 0;
  const opts = { at: new Date(now).toISOString(), alerts: true, notify: () => notices++ };
  markWatched(state, report, opts); markWatched(state, report, opts);
  assert.equal(notices, 1);
  markWatched(state, { problems: ["different"] }, opts);
  assert.equal(notices, 2);
  assert.deepEqual(state.items, original.items);
  assert.deepEqual(state.lastReport, original.lastReport);
  markWatched(state, { problems: [] }, opts);
  const healthy = await watchReport({ c, state, clients: { opus: { templates: async () => [] }, dropbox: { account: async () => ({}), list: async () => [], exists: async () => true } }, job: true, now });
  assert.equal(healthy.newlyDone.length, 0);
});

test("installer preserves settings, dedupes exact permissions and leaves broken JSON alone", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opus-watcher-"));
  const opts = { home, script, say: () => {}, copy: () => ({ status: 0 }) };
  const file = path.join(home, ".claude/settings.json");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ theme: "dark", permissions: { deny: ["keep"], allow: ["existing"] } }));
    install(opts); const first = JSON.parse(fs.readFileSync(file)); install(opts);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), first);
    assert.equal(first.theme, "dark"); assert.deepEqual(first.permissions.deny, ["keep"]);
    assert.equal(first.permissions.allow.length, 8);
    assert.ok(fs.readdirSync(path.dirname(file)).some((n) => n.endsWith(".bak")));
    assert.doesNotMatch(first.permissions.allow.join("\n"), /\*|bypass/);
    fs.writeFileSync(file, "broken {"); install(opts);
    assert.equal(fs.readFileSync(file, "utf8"), "broken {");
    assert.ok(!fs.existsSync(path.join(home, ".claude/scheduled-tasks")), "the app creates the routine's file");
    assert.ok(fs.existsSync(path.join(home, ".claude/skills/opus-dropbox/SKILL.md")));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("routine has one exact read command and forbidden actions only in rules", () => {
  const opts = { node: "/node path/node", script: "/app's path/tool.mjs" };
  const text = routine(opts);
  assert.match(text, /watch --notify/);
  for (const action of ["send", "recut", "run", "setup", "stop", "start"]) {
    assert.ok(text.split("\n").filter((s) => new RegExp(`\\b${action}\\b`, "i").test(s)).every((s) => s.startsWith("Never")));
  }
  assert.equal(allowRules(opts).length, 7);
  assert.match(attended(opts), /clear yes.*that video/);
  assert.match(setupPrompt(text), /opus-watch.*7 7-21 \* \* \*/);
});
