import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleTimes, cleanFindings, watchItems, describeWatch, expectations, watchPrompt } from "../src/watch.mjs";

test("reviewer frames: dense in the first 2.5 s, one after every change, capped", () => {
  const plan = { zooms: [{ t: 4 }, { t: 9 }], graphics: [{ start: 12, duration: 5 }], broll: [{ start: 20, duration: 2 }], slams: [{ t: 25 }] };
  const t = sampleTimes(plan, 40);
  assert.ok(t.filter((x) => x < 2.5).length >= 9, "first 2.5 s sampled densely");
  for (const c of [4.15, 9.15, 12.15, 17.15, 20.15, 22.15]) assert.ok(t.includes(c), `frame just after the change at ${c}`);
  assert.ok(sampleTimes(plan, 600, { maxFrames: 36 }).length <= 40);
});

test("reviewer findings: unknown kinds and out-of-range times are dropped; findings become warnings", () => {
  const r = cleanFindings({ issues: [{ t: 3.2, kind: "face-covered", severity: "high", note: "caption on the chin" }, { t: 99, kind: "face-covered", note: "x" }, { t: 1, kind: "vibes", note: "meh" }], viewer: { first3s: "swipe", why: "static open", dropAt: 12, dropWhy: "long hold" } }, 30);
  assert.equal(r.issues.length, 1);
  const items = watchItems({ ...r, frames: 20 });
  assert.equal(items.length, 2);
  assert.match(items[0].message, /Claude saw at 0:03\.2 \(face covered, obvious\): caption on the chin/);
  assert.match(items[1].message, /swipe in the first 3 s: static open/);
  assert.match(describeWatch({ ...r, frames: 20 }), /1 thing to check \(1 obvious\); a cold viewer would swipe after 3 s, likely stop at 12s/);
  assert.deepEqual(watchItems({ error: "x" }), []);
});

test("reviewer prompt: the intended look is stated so it is not reported as a fault", () => {
  const plan = { name: "r", hook: { text: "The *10* minutes", start: 0, duration: 3 }, slams: [{ t: 5, text: "every" }], zooms: [{ t: 4, cut: true }], captions: [{ start: 1, text: "your team" }], style: { captions: { style: "reveal", annotate: true } } };
  const p = watchPrompt({ sheets: [{ file: "/tmp/s1.png", times: [0.05, 0.3] }], exp: expectations(plan), name: "r" });
  assert.match(p, /dimmed on purpose/);
  assert.match(p, /the repeat and the exit/);
  assert.match(p, /jump cuts/);
  assert.match(p, /\/tmp\/s1\.png: frames at 0\.05s, 0\.30s/);
});
