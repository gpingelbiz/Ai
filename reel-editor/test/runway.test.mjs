import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateClip, waitForTask, createImage, createVideo, makeClip, animateStill } from "../src/runway.mjs";
import { makeRunwayBroll, runwayPicksPrompt } from "../src/broll-runway.mjs";
import { recordUsage, readUsage, usageReport, reelUsageNote } from "../src/usage.mjs";
import { RUNWAY_STYLE } from "../src/codex.mjs";

const cache = fs.mkdtempSync(path.join(os.tmpdir(), "runway-test-"));
process.env.REEL_BROLL_RECENT = path.join(cache, "recent.json");
process.env.REEL_CACHE = cache;
const realRecent = path.join(os.homedir(), ".cache", "reel-editor", "broll-recent.json");
const snapshot = () => fs.existsSync(realRecent) ? { bytes: fs.readFileSync(realRecent).toString("base64"), mtime: fs.statSync(realRecent).mtimeMs } : null;
const before = snapshot();
after(() => {
  assert.deepEqual(snapshot(), before, "the real recent-scene cache must stay untouched");
  fs.rmSync(cache, { recursive: true, force: true });
});

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
  const groups = Array.from({ length: 20 }, (_, i) => ({ start: 3 + i * 2, end: 4.8 + i * 2, text: `line ${i} glove coffee`, words: [] }));
  const made = [];
  const deps = {
    hasRunway: () => true,
    hasClaude: () => true,
    claudeText: async (prompt) => { assert.match(prompt, /motion/); return '{"picks":[{"line":4,"scene":"a worn glove on a step","shows":"glove","motion":"slow push"},{"line":12,"scene":"a cold coffee","shows":"coffee","motion":"steam drifts"}]}'; },
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

test("Runway prompt ranks spare picks, uses natural colour, literal analogies and the dark-read rule", () => {
  const p = runwayPicksPrompt({ candidates: [], count: 3, transcript: "a snake in a jungle", voice: "a garage", recent: [...Array.from({ length: 16 }, (_, i) => `scene-${i}`), "scene-4"] });
  assert.match(p, /Pick 5 caption lines, ranked best first/);
  assert.match(p, /The picture is what the words say/);
  assert.match(p, /an analogy, a joke, a story/);
  assert.match(p, /never a rope for a snake, never tape for a coconut, never a box cutter for a knife/);
  assert.match(p, /only for lines about their own life and work; never use it to replace an image they name/);
  assert.match(p, /Dark-read rule:.*noose, self-harm/);
  assert.match(p, /a knife in a leather sheath on a log/);
  assert.match(p, /an image the speaker names is not clip art/);
  assert.match(p, /one to three words copied exactly/);
  assert.ok(p.includes(RUNWAY_STYLE));
  assert.doesNotMatch(p, /the report, the number|muted, desaturated|one hard practical light/);
  assert.equal((p.match(/^- scene-/gm) || []).length, 12);
  assert.equal((p.match(/^- scene-4$/gm) || []).length, 1);
  const custom = runwayPicksPrompt({ candidates: [], count: 1, style: "bright documentary" });
  assert.match(custom, /Look for every scene: bright documentary/);
  assert.ok(!custom.includes(RUNWAY_STYLE));
});

// Real orchestration and HTTP code, with every paid call, CLI and ffmpeg replaced.
function runwayFixture({ checks = [], picks = [{ line: 4, shows: "snake", scene: "a green snake dropping from a jungle branch" }], cap = 150, imageCredits = 5, failVideos = 0, reportCosts = true, settings = {}, balance = 1000 } = {}) {
  const workDir = fs.mkdtempSync(path.join(cache, "clips-"));
  const images = [], videos = [], looked = [], tasks = new Map();
  const fetchFn = async (url, init) => {
    if (url.endsWith("/v1/text_to_image")) {
      images.push(JSON.parse(init.body));
      const id = `img-${images.length}`;
      tasks.set(id, { status: "SUCCEEDED", output: [`https://fake/${id}.png`], ...(reportCosts ? { cost: { credits: imageCredits } } : {}) });
      return json({ id });
    }
    if (url.endsWith("/v1/image_to_video")) {
      videos.push(JSON.parse(init.body));
      const id = `vid-${videos.length}`;
      tasks.set(id, videos.length <= failVideos
        ? { status: "FAILED", failureCode: "SAFETY.INPUT", failure: "refused", ...(reportCosts ? { cost: { credits: 25 } } : {}) }
        : { status: "SUCCEEDED", output: [`https://fake/${id}.mp4`], ...(reportCosts ? { cost: { credits: 25 } } : {}) });
      return json({ id });
    }
    if (url.includes("/v1/tasks/")) {
      const task = tasks.get(url.split("/").at(-1));
      assert.ok(task, `unexpected task ${url}`);
      return json(task);
    }
    if (url.startsWith("https://fake/")) return json({});
    throw new Error(`unexpected fetch ${url}`);
  };
  const runFn = async (cmd, args) => { assert.equal(cmd, "ffmpeg"); fs.writeFileSync(args.at(-1), "conformed video"); };
  const io = { fetchFn, sleepFn: async () => {}, runFn };
  const deps = {
    hasRunway: () => true, hasClaude: () => true,
    organization: async () => ({ creditBalance: balance }),
    claudeText: async () => JSON.stringify({ picks }),
    claudeLook: async (prompt, options) => {
      looked.push({ prompt, ...options });
      assert.equal(options.cwd, path.join(workDir, "broll"));
      const file = prompt.match(/Read the image "([^"]+)"/)[1];
      assert.ok(fs.existsSync(path.join(options.cwd, file)), "the image must be downloaded before looking");
      const result = checks[looked.length - 1] ?? { shows: true, dark: false, why: "clear subject" };
      if (result instanceof Error) throw result;
      return JSON.stringify(result);
    },
    makeClip: (args) => makeClip({ ...args, ...io }),
    animateStill: (args) => animateStill({ ...args, ...io }),
    recordUsage: (args) => recordUsage({ ...args, file: path.join(workDir, "usage.json") }),
  };
  const run = () => makeRunwayBroll({ workDir, groups: Array.from({ length: 20 }, (_, i) => ({ start: 4 + i * 2, text: "a snake a coconut a knife" })), duration: 50, settings: { maxCreditsPerReel: cap, ...settings }, deps });
  const plan = () => JSON.parse(fs.readFileSync(path.join(workDir, "broll", "broll.json"), "utf8"));
  return { run, plan, images, videos, looked, workDir, deps, io };
}

test("makeClip CHECK error includes the downloaded still and image usage, with no video bought", async () => {
  const f = runwayFixture();
  const dir = fs.mkdtempSync(path.join(cache, "check-"));
  await assert.rejects(makeClip({ scene: "a snake", dir, name: "still", ...f.io, check: async (png) => {
    assert.ok(fs.existsSync(png));
    return { ok: false, why: "looks like a strap" };
  } }), (e) => {
    assert.equal(e.code, "CHECK");
    assert.match(e.message, /looks like a strap/);
    assert.equal(e.items.length, 1);
    assert.equal(e.items[0].credits, 5);
    assert.equal(e.png, path.join(dir, "still.png"));
    return true;
  });
  assert.equal(f.videos.length, 0);
});

test("Runway checks fail then pass: only the corrected still buys video and metadata records retry-pass", async () => {
  const f = runwayFixture({ checks: [{ shows: false, dark: false, why: "the subject looks like a strap" }, { shows: true, dark: false }] });
  const shots = await f.run();
  assert.equal(f.images.length, 2);
  assert.equal(f.videos.length, 1);
  assert.equal(f.looked.length, 2);
  assert.match(f.images[1].promptText, /It must clearly show snake; the last picture failed because the subject looks like a strap/);
  assert.match(f.looked[0].prompt, /main subject, recognisable in one second under the caption "a snake a coconut a knife/);
  assert.match(f.looked[0].prompt, /noose, self-harm, death, a weapon used on or pointed at someone/);
  assert.equal(shots[0].shows, "snake");
  assert.equal(shots[0].check, "retry-pass");
  assert.equal(f.plan().shots[0].check, "retry-pass");
  assert.equal(f.plan().usage.reduce((sum, i) => sum + i.credits, 0), 35);
});

test("two failed still checks drop the shot and buy no video, including a clear but dark image", async () => {
  for (const result of [{ shows: false, dark: false, why: "wrong subject" }, { shows: true, dark: true, why: "reads as danger" }]) {
    const f = runwayFixture({ checks: [result, result] });
    assert.deepEqual(await f.run(), []);
    assert.equal(f.images.length, 2);
    assert.equal(f.videos.length, 0);
    assert.deepEqual(f.plan().shots, []);
    assert.equal(f.plan().usage.reduce((sum, i) => sum + i.credits, 0), 10);
  }
});

test("a failed vision call accepts the still, and check:false skips vision", async () => {
  const unavailable = runwayFixture({ checks: [new Error("claude timed out")] });
  assert.equal((await unavailable.run())[0].check, "skipped");
  assert.equal(unavailable.videos.length, 1);
  const disabled = runwayFixture({ settings: { check: false } });
  assert.equal((await disabled.run())[0].check, "skipped");
  assert.equal(disabled.looked.length, 0);
  assert.equal(disabled.videos.length, 1);
});

test("Runway rejects stand-ins before buying and selects spaced picks by rank", async () => {
  const f = runwayFixture({ cap: 60, picks: [
    { line: 2, shows: "coconut", scene: "packing tape on a shelf" },
    { line: 12, shows: "snake", scene: "a green snake dropping from a branch" },
    { line: 11, shows: "knife", scene: "a knife in a sheath on a log" },
    { line: 4, shows: "coconut", scene: "a coconut landing on the ground" },
  ] });
  const shots = await f.run();
  assert.deepEqual(shots.map((s) => s.line), [4, 12]);
  assert.ok(shots.every((s) => s.check === "pass"));
  assert.equal(f.images.length, 2);
  assert.equal(f.videos.length, 2);
});

test("still retries consume the cap before later clips, and an unaffordable retry buys nothing", async () => {
  const picks = [4, 12].map((line) => ({ line, shows: "snake", scene: "a green snake dropping from a branch" }));
  const f = runwayFixture({ cap: 60, picks, checks: [{ shows: false, dark: false, why: "not a snake" }] });
  assert.equal((await f.run()).length, 1);
  assert.equal(f.images.length, 2);
  assert.equal(f.videos.length, 1);
  assert.equal(f.plan().usage.reduce((sum, i) => sum + i.credits, 0), 35);
  const tight = runwayFixture({ cap: 30, checks: [{ shows: false, dark: false }] });
  assert.deepEqual(await tight.run(), []);
  assert.equal(tight.images.length, 1);
  assert.equal(tight.videos.length, 0);
  const exact = runwayFixture({ cap: 35, checks: [{ shows: false, dark: false }] });
  assert.equal((await exact.run()).length, 1, "a retry fits exactly at 35 credits");
  assert.equal(exact.plan().usage.reduce((sum, i) => sum + i.credits, 0), 35);
});

test("actual still charges are checked before video, and 1080 image pricing is budgeted", async () => {
  const f = runwayFixture({ cap: 30, imageCredits: 8 });
  assert.deepEqual(await f.run(), []);
  assert.equal(f.images.length, 1);
  assert.equal(f.videos.length, 0, "8 + 25 would cross the cap");
  const large = runwayFixture({ cap: 30, settings: { imageRatio: "1080:1920" } });
  assert.deepEqual(await large.run(), []);
  assert.equal(large.images.length, 0, "the 33-credit clip cannot start");
});

test("charged moderation retries obey the cap and the account reserve, even without reported costs", async () => {
  for (const options of [{ cap: 30 }, { cap: 150, balance: 40, settings: { keepCredits: 10 } }]) {
    const f = runwayFixture({ ...options, failVideos: 1, reportCosts: false });
    const shots = await f.run();
    assert.equal(f.videos.length, 1, "no budget for another charged video");
    assert.ok(shots[0].file.endsWith(".png"), "a checked still can remain after video moderation");
    assert.equal(f.plan().usage.reduce((sum, i) => sum + i.credits, 0), 30);
  }
  for (const failVideos of [1, 2]) {
    const fits = runwayFixture({ cap: 55, failVideos, reportCosts: false });
    assert.ok((await fits.run())[0].file.endsWith(failVideos === 1 ? ".mp4" : ".png"));
    assert.equal(fits.videos.length, 2);
    assert.equal(fits.plan().usage.reduce((sum, i) => sum + i.credits, 0), 55);
  }
});

test("local download and conform failures preserve paid usage for the next budget check", async () => {
  const f = runwayFixture({ reportCosts: false });
  const dir = fs.mkdtempSync(path.join(cache, "local-error-"));
  const cases = [
    { fetchFn: async (url, init) => url.endsWith(".png") ? json({}, false, 503) : f.io.fetchFn(url, init), credits: 5 },
    { runFn: async () => { throw new Error("conform failed"); }, credits: 30 },
  ];
  for (const { credits, ...overrides } of cases) {
    await assert.rejects(makeClip({ scene: "a snake", dir, name: "still", ...f.io, ...overrides }), (e) => {
      assert.equal(e.items.reduce((sum, i) => sum + i.credits, 0), credits);
      return true;
    });
  }
  const png = path.join(dir, "still.png");
  await assert.rejects(animateStill({ png, mp4: path.join(dir, "still.mp4"), ...f.io, runFn: async () => { throw new Error("conform failed"); } }), (e) => {
    assert.equal(e.items[0].credits, 25);
    return true;
  });
});
