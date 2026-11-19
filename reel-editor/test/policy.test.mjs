import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPolicy, policyProblems, policyApplies } from "../src/policy.mjs";
import { lintSlideCopy } from "../src/slide-preflight.mjs";

test("the rule book loads and every rule has a reason and working patterns", () => {
  const p = loadPolicy();
  assert.ok(p.rules.length >= 7);
  for (const r of p.rules) assert.ok(r.reason && r.res.length, r.id);
});

test("captions: the banned phrases are caught; ordinary copy, prices and hyphenated words pass", () => {
  const ids = (t) => policyProblems(t).map((x) => x.id);
  assert.deepEqual(ids("DM GHOST for the map."), ["retired-keyword"]);
  assert.ok(ids("Comment GHOST and I'll send it.").includes("ghost-pl"));
  assert.deepEqual(ids("Apply through my hiring portal."), ["hiring-portal"]);
  assert.deepEqual(ids("I hit seven figures."), ["income-claim"]);
  assert.deepEqual(ids("This is it — the close."), ["dash"]);
  assert.deepEqual(ids("Our ticket is $3,000 a client. Follow-up wins."), []);
});

test("slides: Greg's brand runs the rule book; client brands don't; dash and Ghost stay with the slide's own checks", () => {
  assert.equal(policyApplies({ identity: { handle: "@officialgregpingel" } }), true);
  assert.equal(policyApplies({ identity: { handle: "@juleegracey" } }), false);
  const slide = { kind: "body", headline: "APPLY THROUGH THE HIRING PORTAL", sub: "Seven figures in a year." };
  const codes = lintSlideCopy(slide, [], { index: 2, policy: true }).map((p) => p.code);
  assert.ok(codes.includes("copy-policy-hiring-portal") && codes.includes("copy-policy-income-claim"));
  assert.ok(!lintSlideCopy(slide, [], { index: 2, policy: false }).some((p) => p.code.startsWith("copy-policy")), "client brands keep their own rules");
  assert.ok(!lintSlideCopy({ kind: "body", headline: "A — B" }, [], { index: 2, policy: true }).some((p) => p.code === "copy-policy-dash"), "no double dash report");
});

test("his wife never; a prospect's spouse objection is fine", () => {
  const ids = (t) => policyProblems(t).map((x) => x.id);
  assert.deepEqual(ids("My wife sent me the photo."), ["wife"]);
  assert.deepEqual(ids("Maria and the kids at the park."), ["wife"]);
  assert.deepEqual(ids('SWAP #1: "Let me talk to my wife."'), []);
  assert.deepEqual(ids('He said "I need to check with my wife" and hung up.'), []);
});

test("v11 stop-saying phrases are caught; ordinary copy that shares a word passes", () => {
  const ids = (t) => policyProblems(t).map((x) => x.id);
  assert.deepEqual(ids("I've helped coaches grow 3 to 5x in 3 to 6 months."), ["v11-stop-saying"]);
  assert.deepEqual(ids("Scale your offer 3, 4, 5x."), ["v11-stop-saying"]);
  assert.deepEqual(ids("I install the whole sales system, A to Z."), ["v11-stop-saying"]);
  assert.deepEqual(ids("A sales system that runs without you."), ["v11-stop-saying"]);
  assert.deepEqual(ids("Follow up that never misses."), ["v11-stop-saying"]);
  assert.deepEqual(ids("Find your biggest leak."), ["v11-stop-saying"]);
  assert.deepEqual(ids("Take the free scorecard. It takes 4 minutes."), ["v11-stop-saying"]);
  assert.deepEqual(ids("He never misses leg day."), []);
  assert.deepEqual(ids("We replied in 4 minutes, not 4 hours."), []);
  assert.deepEqual(ids("Take the free sales scorecard and see the first place to look."), []);
  assert.deepEqual(ids("Your offer sells. Every call still waits on you."), []);
});
