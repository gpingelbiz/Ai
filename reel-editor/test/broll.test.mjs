import { test } from "node:test";
import assert from "node:assert/strict";
import { brollCount, brollCandidates, placeBroll, picksPrompt } from "../src/broll.mjs";
import { codexModels, isModelRefusal, imagePrompt, pool } from "../src/codex.mjs";
import { renderHTML } from "../src/compose.mjs";

const groups = Array.from({ length: 30 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.8, text: `line ${i}`, words: [] }));

test("b-roll count scales with length", () => {
  assert.equal(brollCount(12), 0);
  assert.equal(brollCount(20), 1);
  assert.equal(brollCount(40), 3);
  assert.equal(brollCount(90), 3);
  assert.equal(brollCount(90, { max: 2 }), 2);
});

test("candidates skip the hook, the last second and the CTA", () => {
  const c = brollCandidates(groups, 60, { hook: { start: 0, duration: 3 }, cta: { start: 50, duration: 3 }, len: 2.4 });
  assert.ok(c.every((x) => x.start >= 3.5));
  assert.ok(c.every((x) => x.start + 2.4 <= 50));
  assert.equal(c[0].start, 4);
});

test("placement keeps real lines, in order, spaced apart", () => {
  const cands = brollCandidates(groups, 60, { hook: { start: 0, duration: 3 } });
  const picks = [
    { line: 10, scene: "an empty boardroom at night" },
    { line: 3, scene: "a phone face down on a desk" },
    { line: 4, scene: "too close to the one before" },
    { line: 0, scene: "inside the hook, not a candidate" },
    { line: 20, scene: "" },
    { line: 25, scene: "a hand on a door handle" },
  ];
  const shots = placeBroll(picks, cands, { len: 2.4, gap: 4, max: 3 });
  assert.deepEqual(shots.map((s) => s.line), [3, 10, 25]);
  assert.deepEqual(shots.map((s) => s.start), [6, 20, 50]);
  assert.deepEqual(shots.map((s) => s.motion), ["in", "left", "out"]);
});

test("the picks prompt lists only allowed lines and bans faces and text", () => {
  const cands = brollCandidates(groups.slice(0, 6), 14, { hook: { start: 0, duration: 3 } });
  const p = picksPrompt({ candidates: cands, transcript: "x", hook: "Hook", count: 1 });
  assert.match(p, /^2: 4\.0s line 2$/m);
  assert.doesNotMatch(p, /^0: /m);
  assert.match(p, /no faces/);
  assert.match(imagePrompt("a desk"), /No faces/);
  assert.match(imagePrompt("a desk"), /No readable text/);
  assert.match(imagePrompt("a desk."), /vertical 9:16 image: a desk\.\n/);
});

test("codex model: env wins, else config default then the fallback", () => {
  assert.deepEqual(codexModels({ REEL_CODEX_MODEL: "x" }), ["x"]);
  assert.equal(codexModels({}).at(-1), "gpt-5.6-sol");
  assert.ok(isModelRefusal("The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account"));
  assert.ok(!isModelRefusal("network error"));
});

test("pool keeps order and returns errors in place", async () => {
  const r = await pool([1, 2, 3, 4], 2, async (x) => { if (x === 3) throw new Error("no"); return x * 10; });
  assert.equal(r[0], 10);
  assert.ok(r[2] instanceof Error);
  assert.equal(r[3], 40);
});

test("render: b-roll sits between the footage and the captions", () => {
  const plan = {
    name: "t",
    canvas: { width: 1080, height: 1920 },
    video: { duration: 20, hasAudio: true },
    style: { colors: { text: "#fff", accent: "#fc0", stroke: "#000" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: {}, cta: {} },
    captions: [],
    broll: [{ start: 6, duration: 2.4, motion: "left", src: "assets/broll/broll-1.png" }],
  };
  const html = renderHTML(plan, "assets/footage.mp4");
  const iVideo = html.indexOf('id="video-wrap"'), iBroll = html.indexOf('id="broll-0"'), iCaps = html.indexOf('id="captions"');
  assert.ok(iVideo < iBroll && iBroll < iCaps);
  assert.match(html, /data-start="6" data-duration="2.4"/);
  assert.match(html, /"broll":\[\{"start":6,"duration":2.4,"motion":"left"\}\]/);
});

test("a 429 pauses Codex for everyone; refusals and other errors do not", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { isRateLimit, codexPausedUntil } = await import("../src/codex.mjs");
  assert.ok(isRateLimit("ERROR: exceeded retry limit, last status: 429 Too Many Requests"));
  assert.ok(!isRateLimit("model is not supported"));
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cd-")), "cooldown");
  const env = { REEL_CODEX_COOLDOWN_FILE: f };
  assert.equal(codexPausedUntil(Date.now(), env), 0);
  fs.writeFileSync(f, String(Date.now() + 60000));
  assert.ok(codexPausedUntil(Date.now(), env) > Date.now());
  fs.writeFileSync(f, String(Date.now() - 1));
  assert.equal(codexPausedUntil(Date.now(), env), 0);
});
