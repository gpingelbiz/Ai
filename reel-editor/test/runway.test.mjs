import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateClip, waitForTask, createImage, createVideo } from "../src/runway.mjs";
import { makeRunwayBroll, runwayPicksPrompt } from "../src/broll-runway.mjs";
import { recordUsage, readUsage, usageReport, reelUsageNote } from "../src/usage.mjs";

process.env.RUNWAY_API_KEY = "test-key";
const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

test("runway: cost estimates, task polling, create calls send the documented fields", async () => {
  assert.deepEqual(estimateClip({ seconds: 5 }), { image: 5, video: 25, credits: 30, dollars: 0.3 });
  assert.equal(estimateClip({ seconds: 10, videoModel: "gen4.5" }).credits, 125);
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
    if (url.endsWith("/v1/text_to_image")) return json({ id: "img1", estimatedCost: { credits: 5 } });
    if (url.endsWith("/v1/image_to_video")) return json({ id: "vid1", estimatedCost: { credits: 25 } });
    if (url.includes("/v1/tasks/img1")) return json(calls.filter((c) => c.url.includes("tasks/img1")).length < 2 ? { status: "RUNNING", progress: 0.4 } : { status: "SUCCEEDED", output: ["https://x/img.png"], cost: { credits: 5 } });
    if (url.includes("/v1/tasks/fail")) return json({ status: "FAILED", failureCode: "SAFETY.INPUT.TEXT", failure: "nope", cost: { credits: 5 } });
    throw new Error("unexpected " + url);
  };
  const img = await createImage({ prompt: "a worn glove", fetchFn });
  assert.equal(img.estimatedCredits, 5);
  assert.deepEqual(calls[0].body, { model: "gen4_image", promptText: "a worn glove", ratio: "720:1280", contentModeration: { publicFigureThreshold: "auto" } });
  assert.equal(calls[0].headers["X-Runway-Version"], "2024-11-06");
  assert.match(calls[0].headers.Authorization, /^Bearer test-key$/);
  const vid = await createVideo({ image: "https://x/img.png", prompt: "slow push", fetchFn });
  assert.deepEqual(calls[1].body, { model: "gen4_turbo", promptImage: "https://x/img.png", ratio: "720:1280", duration: 5, contentModeration: { publicFigureThreshold: "auto" }, promptText: "slow push" });
  assert.equal(vid.id, "vid1");
  const t = await waitForTask("img1", { fetchFn, sleepFn: async () => {} });
  assert.equal(t.status, "SUCCEEDED");
  await assert.rejects(waitForTask("fail", { fetchFn, sleepFn: async () => {} }), /SAFETY\.INPUT\.TEXT: nope/);
});

test("runway b-roll: budget checks, picks via Claude, clips made, usage recorded, note written", async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), "rw-"));
  const usage = path.join(wd, "usage.json");
  const groups = Array.from({ length: 20 }, (_, i) => ({ start: 3 + i * 2, end: 4.8 + i * 2, text: `line ${i}`, words: [] }));
  const made = [];
  const deps = {
    hasRunway: () => true,
    hasClaude: () => true,
    claudeText: async (prompt) => { assert.match(prompt, /motion/); return '{"picks":[{"line":4,"scene":"a worn glove on a step","motion":"slow push"},{"line":12,"scene":"a cold coffee","motion":"steam drifts"}]}'; },
    organization: async () => ({ creditBalance: 100 }),
    makeClip: async ({ dir, name, scene }) => { made.push(scene); fs.writeFileSync(path.join(dir, `${name}.mp4`), "v"); fs.writeFileSync(path.join(dir, `${name}.png`), "p"); return { mp4: path.join(dir, `${name}.mp4`), png: path.join(dir, `${name}.png`), items: [{ kind: "image", credits: 5, dollars: 0.05, ok: true }, { kind: "video", seconds: 5, credits: 25, dollars: 0.25, ok: true }] }; },
    recordUsage: (args) => recordUsage({ ...args, file: usage }),
  };
  const shots = await makeRunwayBroll({ workDir: wd, groups, duration: 50, hook: { start: 0, duration: 3 }, cta: null, settings: { max: 3, every: 12, duration: 4, videoSeconds: 5, maxCreditsPerReel: 150 }, deps });
  assert.equal(shots.length, 2, "two clips (duration 50 s gives 3 slots, the balance of 100 credits pays for 3, Claude picked 2)");
  assert.ok(shots.every((s) => s.file.endsWith(".mp4") && s.motion === "none" && fs.existsSync(s.file)));
  assert.match(fs.readFileSync(path.join(wd, "runway usage.txt"), "utf8"), /Runway: 4 generations, 60 credits ≈ \$0\.60/);
  const u = readUsage(usage);
  const m = Object.values(u.months)[0];
  assert.equal(m.credits, 60);
  assert.equal(u.balance.credits, 100);
  // Reuse: nothing bought the second time.
  const again = await makeRunwayBroll({ workDir: wd, groups, duration: 50, hook: { start: 0, duration: 3 }, cta: null, settings: { max: 3, every: 12, duration: 4 }, deps: { ...deps, makeClip: async () => { throw new Error("should not buy"); } } });
  assert.equal(again.length, 2);
  // Budget: a balance under one clip buys nothing.
  const poor = await makeRunwayBroll({ workDir: fs.mkdtempSync(path.join(os.tmpdir(), "rw2-")), groups, duration: 50, hook: { start: 0, duration: 3 }, cta: null, settings: {}, deps: { ...deps, organization: async () => ({ creditBalance: 10 }) } });
  assert.equal(poor.length, 0);
  const capped = await makeRunwayBroll({ workDir: fs.mkdtempSync(path.join(os.tmpdir(), "rw3-")), groups, duration: 50, hook: { start: 0, duration: 3 }, cta: null, settings: { maxCreditsPerReel: 10 }, deps });
  assert.equal(capped.length, 0, "the per-reel cap under one clip buys nothing");
  assert.match(usageReport(readUsage(usage)), /This month: 4 generations, 60 credits ≈ \$0\.60/);
  assert.match(reelUsageNote([{ kind: "video", seconds: 5, credits: 25, dollars: 0.25 }, { kind: "image", credits: 5, dollars: 0.05, ok: false, error: "SAFETY.INPUT.TEXT: no" }]), /1 generation, 30 credits ≈ \$0\.30 \(1 failed and still charged\)[\s\S]*image: 5 credits \(failed: SAFETY\.INPUT\.TEXT\)/);
  fs.rmSync(wd, { recursive: true, force: true });
});
