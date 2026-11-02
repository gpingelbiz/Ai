import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateClip, waitForTask, createImage, createVideo, makeClip, animateStill, makeSound, fitPrompt } from "../src/runway.mjs";
import { makeRunwayBroll, runwayPicksPrompt, runwayTiming, videoMotion, frameChange, measureMotion, checkRunwayVideo, stillPrompt, STILL_STYLE, actionInPoint, trimRunwayClip, placeRunwayBroll, PROMPT_VERSION } from "../src/broll-runway.mjs";
import { recordUsage, readUsage, usageReport, reelUsageNote } from "../src/usage.mjs";

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
  const runFn = async (_cmd, args) => _cmd === "ffprobe" ? { out: "5\n" } : fs.writeFileSync(args.at(-1), args.at(-1).endsWith(".gray") ? Buffer.concat([Buffer.alloc(4096), Buffer.alloc(4096, 10)]) : "frame");
  const deps = {
    runFn,
    claudeLook: async () => JSON.stringify({ seen: "a clear subject moving", shows: true, action: true, dark: false, why: "clear movement" }),
    hasRunway: () => true,
    hasClaude: () => true,
    claudeText: async (prompt) => { assert.match(prompt, /motion/); return '{"picks":[{"line":4,"scene":"a worn glove on a step","shows":"glove","motion":"slow push"},{"line":12,"scene":"a cold coffee","shows":"coffee","motion":"steam drifts"}]}'; },
    organization: async () => ({ creditBalance: 100 }),
    makeClip: async ({ dir, name, scene }) => { made.push(scene); fs.writeFileSync(path.join(dir, `${name}.mp4`), "v"); fs.writeFileSync(path.join(dir, `${name}.png`), "p"); return { mp4: path.join(dir, `${name}.mp4`), png: path.join(dir, `${name}.png`), items: [{ kind: "image", credits: 5, dollars: 0.05, ok: true }, { kind: "video", seconds: 5, credits: 25, dollars: 0.25, ok: true }] }; },
    recordUsage: (args) => recordUsage({ ...args, file: usage }),
  };
  const shots = await makeRunwayBroll({ workDir: wd, groups, duration: 50, hook: { start: 0, duration: 3 }, cta: null, settings: { max: 3, every: 12, duration: 4, videoSeconds: 5, maxCreditsPerReel: 150 }, deps });
  assert.equal(shots.length, 2, "two clips (duration 50 s gives 3 slots, the balance of 100 credits pays for 3, Claude picked 2)");
  assert.ok(shots.every((s) => s.file.endsWith(".mp4") && s.move === "none" && fs.existsSync(s.file)));
  assert.match(fs.readFileSync(path.join(wd, "runway usage.txt"), "utf8"), /Runway: 4 generations, 60 credits ≈ \$0\.60/);
  const u = readUsage(usage);
  const m = Object.values(u.months)[0];
  assert.equal(m.credits, 60);
  assert.equal(u.balance.credits, 100);
  // Reuse: nothing bought the second time.
  const again = await makeRunwayBroll({ workDir: wd, groups, duration: 50, hook: { start: 0, duration: 3 }, cta: null, settings: { max: 3, every: 12, duration: 4, videoSeconds: 5, maxCreditsPerReel: 150 }, deps: { ...deps, makeClip: async () => { throw new Error("should not buy"); } } });
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

test("Runway planner uses the synthesis with ranked alternatives, literal subjects and phrase anchors", () => {
  const p = runwayPicksPrompt({ candidates: [{ i: 4, start: 10, text: "a snake" }], count: 3, spacing: 3, duration: 2.5, transcript: "a snake in a jungle", voice: "a garage", recent: [...Array.from({ length: 16 }, (_, i) => `scene-${i}`), "scene-4"] });
  assert.match(p, /Return up to 5 useful candidates, ranked strongest first/);
  assert.match(p, /Fewer candidates, including zero/);
  assert.match(p, /3 seconds from one shot's END to the next START/);
  assert.match(p, /A jungle stays a jungle; a snake stays a snake; a coconut stays a coconut/);
  assert.match(p, /Read the whole passage first/);
  assert.match(p, /Preserve Greg's reactions, conviction, personal admissions and final/);
  assert.match(p, /immediately following caption/);
  assert.match(p, /1.2 and 2.5 seconds/);
  assert.match(p, /Default: "Locked camera/);
  assert.match(p, /camera move only for a place reveal or travel/);
  assert.match(p, /positive descriptions/);
  assert.match(p, /neck contact, noose-like compositions/);
  assert.match(p, /4: 10.0s a snake/);
  assert.doesNotMatch(p, /a garage|fast push|crash zoom|whip|toward the camera|muted, desaturated|one hard practical light/);
  assert.equal((p.match(/^- scene-/gm) || []).length, 12);
  assert.equal((p.match(/^- scene-4$/gm) || []).length, 1);
  assert.match(runwayPicksPrompt({ candidates: [], count: 1, style: "bright documentary" }), /Optional visual style: bright documentary/);
});

// Real orchestration and HTTP code, with every paid call, CLI and ffmpeg replaced.
function runwayFixture({ checks = [], openChecks = [], videoChecks = [], videoOpenChecks = [], motionLevels = [], actionLevels, picks = [{ line: 4, shows: "snake", scene: "a green snake dropping from a jungle branch" }], cap = 150, imageCredits = 5, failVideos = 0, reportCosts = true, settings = {}, balance = 1000, groups } = {}) {
  const workDir = fs.mkdtempSync(path.join(cache, "clips-"));
  const images = [], videos = [], sounds = [], looked = [], openLooked = [], videoLooked = [], videoOpenLooked = [], runs = [], pickPrompts = [], tasks = new Map();
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
    if (url.endsWith("/v1/video_to_audio")) {
      sounds.push(JSON.parse(init.body));
      const id = `sfx-${sounds.length}`;
      tasks.set(id, { status: "SUCCEEDED", output: [`https://fake/${id}.wav`] });
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
  let measured = 0;
  const runFn = async (cmd, args) => {
    runs.push({ cmd, args });
    if (cmd === "ffprobe") return { out: String(settings.videoSeconds ?? 5) };
    assert.equal(cmd, "ffmpeg");
    if (args.at(-1).endsWith(".gray")) {
      const action = args.includes("fps=8,scale=64:64,format=gray");
      const level = action ? 10 : motionLevels[measured++] ?? 10;
      const levels = action && actionLevels ? actionLevels : Array.from({ length: 24 }, (_, i) => i % 2 ? level : 0);
      fs.writeFileSync(args.at(-1), Buffer.concat(levels.map((v) => Buffer.alloc(4096, v))));
    } else fs.writeFileSync(args.at(-1), "conformed video or check frame");
  };
  const io = { fetchFn, sleepFn: async () => {}, runFn };
  const deps = {
    hasRunway: () => true, hasClaude: () => true,
    organization: async () => ({ creditBalance: balance }),
    runFn,
    claudeText: async (prompt) => { pickPrompts.push(prompt); return JSON.stringify({ picks }); },
    claudeLook: async (prompt, options) => {
      assert.equal(options.cwd, path.join(workDir, "broll"));
      if (prompt.startsWith("Inspect these three frames")) {
        videoOpenLooked.push({ prompt, ...options });
        const files = [...prompt.matchAll(/"([^"\n]+\.png)"/g)].map((m) => m[1]);
        assert.equal(files.length, 3);
        assert.ok(files.every((file) => fs.existsSync(path.join(options.cwd, file))));
        const result = videoOpenChecks[videoOpenLooked.length - 1] ?? { seen: "subject position changes" };
        if (result instanceof Error) throw result;
        return JSON.stringify(result);
      }
      if (prompt.startsWith("Used source interval:")) {
        videoLooked.push({ prompt, ...options });
        const result = videoChecks[videoLooked.length - 1] ?? { shows: true, action: true, dark: false, why: "action visible" };
        if (result instanceof Error) throw result;
        return JSON.stringify(result);
      }
      const file = prompt.match(/Inspect "([^"]+)"/)[1];
      assert.ok(fs.existsSync(path.join(options.cwd, file)), "the image must be downloaded before looking");
      if (prompt.includes('"seen":"..."')) {
        openLooked.push({ prompt, ...options });
        const result = openChecks[openLooked.length - 1] ?? { seen: "a green snake on a branch" };
        if (result instanceof Error) throw result;
        return JSON.stringify(result);
      }
      looked.push({ prompt, ...options });
      const result = checks[looked.length - 1] ?? { shows: true, dark: false, why: "clear subject" };
      if (result instanceof Error) throw result;
      return JSON.stringify(result);
    },
    makeClip: (args) => makeClip({ ...args, ...io }),
    animateStill: (args) => animateStill({ ...args, ...io }),
    makeSound: (args) => makeSound({ ...args, ...io }),
    recordUsage: (args) => recordUsage({ ...args, file: path.join(workDir, "usage.json") }),
  };
  const run = () => makeRunwayBroll({ workDir, groups: groups ?? Array.from({ length: 20 }, (_, i) => ({ start: 4 + i * 2, text: "a snake a coconut a knife" })), duration: 50, voice: "UNRELATED PRIVATE VOICE", settings: { maxCreditsPerReel: cap, ...settings }, deps });
  const plan = () => JSON.parse(fs.readFileSync(path.join(workDir, "broll", "broll.json"), "utf8"));
  return { run, plan, images, videos, sounds, looked, openLooked, videoLooked, videoOpenLooked, runs, pickPrompts, workDir, deps, io };
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
  assert.equal(f.images[1].promptText, stillPrompt({ scene: "a green snake dropping from a jungle branch" }));
  assert.doesNotMatch(f.images[1].promptText, /strap/);
  assert.match(f.looked[0].prompt, /Overlapping captions and spoken words: "a snake a coconut a knife/);
  assert.match(f.looked[0].prompt, /self-harm, death, an attack, weapon use against someone/);
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

test("still vision retries unavailable calls, and check:false skips only still vision", async () => {
  const transient = runwayFixture({ checks: [new Error("claude timed out")] });
  assert.equal((await transient.run())[0].check, "pass");
  assert.equal(transient.looked.length, 2);
  assert.equal(transient.videos.length, 1);
  for (const field of ["checks", "openChecks"]) {
    const unavailable = runwayFixture({ [field]: [new Error("claude timed out"), new Error("claude timed out")] });
    assert.deepEqual(await unavailable.run(), []);
    assert.equal(unavailable.images.length, 1);
    assert.equal(unavailable.videos.length, 0);
    assert.equal(unavailable[field === "checks" ? "looked" : "openLooked"].length, 2);
    assert.equal(unavailable.plan().usage.reduce((n, i) => n + i.credits, 0), 5);
  }
  const disabled = runwayFixture({ settings: { check: false } });
  assert.equal((await disabled.run())[0].check, "skipped");
  assert.equal(disabled.looked.length, 0);
  assert.equal(disabled.videos.length, 1);
  assert.equal(disabled.videoLooked.length, 1, "video vision remains mandatory");
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
    assert.deepEqual(shots, [], "a refused video never falls back to a still");
    assert.equal(f.plan().usage.reduce((sum, i) => sum + i.credits, 0), 30);
  }
  for (const failVideos of [1, 2]) {
    const fits = runwayFixture({ cap: 55, failVideos, reportCosts: false });
    const shots = await fits.run();
    if (failVideos === 1) assert.ok(shots[0].file.endsWith(".mp4"));
    else assert.deepEqual(shots, []);
    assert.equal(fits.videos.length, 2);
    assert.equal(fits.plan().usage.reduce((sum, i) => sum + i.credits, 0), 55);
  }
});

test("local download and conform failures preserve paid usage for the next budget check", async () => {
  const f = runwayFixture({ reportCosts: false });
  const dir = fs.mkdtempSync(path.join(cache, "local-error-"));
  const cases = [
    { fetchFn: async (url, init) => url.endsWith(".png") ? json({}, false, 503) : f.io.fetchFn(url, init), credits: 5 },
    { runFn: async () => { throw new Error("conform failed"); }, credits: 5 },
  ];
  for (const { credits, ...overrides } of cases) {
    await assert.rejects(makeClip({ scene: "a snake", dir, name: "still", ...f.io, ...overrides }), (e) => {
      assert.equal(e.items.reduce((sum, i) => sum + i.credits, 0), credits);
      return true;
    });
  }
  const png = path.join(dir, "still.png");
  await assert.rejects(animateStill({ png, mp4: path.join(dir, "still.mp4"), ...f.io, runFn: async () => { throw new Error("conform failed"); } }), (e) => {
    assert.deepEqual(e.items, []);
    return true;
  });
});

test("Runway timing uses the first shows word, clamps durations, and ignores later caption boundaries", () => {
  const groups = [
    { start: 10, text: "bring a two by four", words: [{ start: 10, text: "bring" }, { start: 10.2, text: "a" }, { start: 10.5, text: "two" }, { start: 10.7, text: "by" }, { start: 10.9, text: "four" }] },
    { start: 11.4, text: "hold it" }, { start: 12.2, text: "a coconut" },
  ];
  const c = { ...groups[0], i: 0 };
  const p = { shows: "two by four" };
  assert.ok(Math.abs(runwayTiming(p, c, groups).duration - 2.4) < 1e-9);
  assert.equal(runwayTiming(p, c, groups).start, 10.5);
  assert.ok(Math.abs(runwayTiming({ ...p, duration: 0.1 }, c, []).duration - 1.2) < 1e-9);
  assert.equal(runwayTiming({ ...p, duration: 20 }, c, [], { len: 2 }).duration, 2);
  assert.equal(runwayTiming(p, c, [], { len: 2 }).duration, 2, "missing duration defaults to settings.duration");
  assert.equal(runwayTiming({ ...p, duration: "2" }, c, [], { len: 2 }).duration, 2);
  assert.deepEqual(runwayTiming(p, { ...c, words: undefined }, [], { len: 2 }), { start: 10, duration: 2 });
  assert.ok(runwayTiming(p, c, [{}, {}, { start: 11 }]), "later captions do not cap a shot");
  assert.equal(runwayTiming(p, c, [], { until: 11 }), null);
  assert.equal(runwayTiming(p, c, [], { busy: [{ start: 13, duration: 2 }] }), null, "word delay must still clear graphics");
  assert.equal(runwayTiming({ shows: "coconut" }, c, groups), null, "subject must belong to the chosen line");
});

test("variable durations preserve ranked spacing in both time directions", async () => {
  const { placeBroll } = await import("../src/broll.mjs");
  const candidates = [10, 13.2, 16.4].map((start, i) => ({ i, start, text: "a snake" }));
  const picks = [1, 0, 2].map((line, i) => ({ line, scene: "a snake", shows: "snake", duration: 1.2, rank: i + 1 }));
  const shots = placeBroll(picks, candidates, { ranked: true, len: 2.4, gap: 2, timing: (p, c) => runwayTiming(p, c, []) });
  assert.deepEqual(shots.map((s) => s.line), [0, 1, 2]);
  assert.ok(shots.every((s) => s.duration === 1.2));
  picks[0].duration = 2.4;
  assert.deepEqual(placeBroll(picks, candidates, { ranked: true, gap: 2, timing: (p, c) => runwayTiming(p, c, []) }).map((s) => s.line), [0, 1]);
});

test("Runway ignores world and voice, asks open before naming the subject, and keeps the full brief", async () => {
  const pick = { line: 0, shows: "snake", scene: "a green snake on a branch", action: "The snake sways downward", motion: "A quick push. No text, no faces", duration: 1.8 };
  const f = runwayFixture({ picks: [pick], settings: { world: "UNRELATED GARAGE", voice: "UNRELATED VOICE" }, groups: [
    { start: 10, text: "see the snake", words: [{ start: 10, text: "see" }, { start: 10.2, text: "the" }, { start: 10.5, text: "snake" }] },
    { start: 11.5, text: "sways" }, { start: 14, text: "a coconut" },
  ] });
  const [shot] = await f.run();
  assert.doesNotMatch(f.pickPrompts[0], /UNRELATED GARAGE|UNRELATED VOICE|UNRELATED PRIVATE VOICE|speaker's world/);
  assert.doesNotMatch(f.openLooked[0].prompt, /snake|Caption|shows/);
  assert.match(f.looked[0].prompt, /independent description was "a green snake on a branch"/);
  assert.equal(shot.start, 10.5);
  assert.equal(shot.duration, 1.8);
  for (const field of ["scene", "action", "shows"]) assert.equal(shot[field], pick[field]);
  assert.equal(shot.motion, f.videos[0].promptText);
  assert.equal(shot.move, "none");
  assert.equal(shot.video, true);
  assert.equal(shot.rank, 1);
  assert.equal(shot.check, "pass");
  assert.equal(shot.seen, "a green snake on a branch");
  assert.equal(shot.moves.ok, true);
  assert.equal(shot.moves.action, true);
  assert.equal(shot.moves.motion.mean, 10);
  assert.deepEqual(f.plan().shots[0], shot);
  assert.doesNotMatch(shot.motion, /\b(no|never|without)\b/i);
  assert.doesNotMatch(f.images[0].promptText, /\b(no|never|without)\b/i);
  assert.ok(f.images[0].promptText.endsWith(STILL_STYLE));
});

test("generation templates use positive descriptions, daylight and a locked camera by default", () => {
  const pick = { scene: "A coconut on a low rock. No faces; without text", shows: "coconut", action: "The coconut rolls. No people", motion: "fast push; no faces; without text" };
  assert.equal(stillPrompt(pick), `A coconut on a low rock. Vertical photograph. ${STILL_STYLE}`);
  assert.equal(videoMotion(pick), "The coconut rolls. Real-time movement beginning immediately. Locked camera.");
  assert.equal(videoMotion(pick, { retry: true }), videoMotion(pick));
  const scene = "Photographic close view of a coconut, resting on a rock, in daylight.";
  assert.equal(stillPrompt({ scene }), `${scene} Vertical photograph. ${STILL_STYLE}`);
  assert.match(videoMotion({ action: "A hand turns a page, revealing the next page", motion: "A quick push" }), /Locked camera/);
  assert.match(videoMotion({ shows: "snake", action: "no text", motion: "no faces" }), /snake moves.*Locked camera/);
  assert.match(videoMotion({ action: "Leaves sway", motion: "The camera moves forward revealing a jungle clearing" }), /camera moves forward revealing/);
  assert.match(videoMotion({ action: "The vehicle travels forward", motion: "Stable forward-facing camera" }), /Stable forward-facing camera/);
  assert.match(videoMotion({ action: "The vehicle travels forward", motion: "Stable forward-facing camera" }, { retry: true }), /Locked camera/);
});

test("motion measurement compares quarter-second grey samples from only the used duration", async () => {
  assert.deepEqual(frameChange(Buffer.from([0, 10, 2, 6, 4, 2]), 2), { mean: 3, frames: 3 });
  assert.equal(frameChange(Buffer.alloc(4096 * 5)).mean, 0);
  assert.throws(() => frameChange(Buffer.alloc(4097)), /complete motion samples/);
  const dir = fs.mkdtempSync(path.join(cache, "measure-"));
  let called = 0;
  const result = await measureMotion("fake.mp4", 1.8, { dir, runFn: async (cmd, args) => {
    called++;
    assert.equal(cmd, "ffmpeg");
    assert.equal(args[args.indexOf("-t") + 1], "1.8");
    assert.equal(args[args.indexOf("-vf") + 1], "fps=4,scale=64:64,format=gray");
    fs.writeFileSync(args.at(-1), Buffer.concat([Buffer.alloc(4096), Buffer.alloc(4096, 8)]));
  } });
  assert.deepEqual(result, { mean: 8, frames: 2 });
  assert.equal(called, 1);
  assert.deepEqual(fs.readdirSync(dir), [], "temporary samples are removed");
  await assert.rejects(measureMotion("bad.mp4", 2, { dir, runFn: async () => { throw new Error("decode failed"); } }), /decode failed/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("video look reads start, middle and end, with caption words and explicit all-frame/action questions", async () => {
  const f = runwayFixture();
  await f.run();
  const prompt = f.videoLooked[0].prompt;
  assert.match(prompt, /Used source interval: 0 to 2.4/);
  assert.match(f.videoOpenLooked[0].prompt, /physical changes/);
  assert.match(prompt, /Overlapping words and captions.*a snake a coconut a knife/);
  assert.match(prompt, /intact and recognizable throughout these frames/);
  assert.match(prompt, /establishing the required event inside this interval/);
  const times = [];
  const dir = fs.mkdtempSync(path.join(cache, "frame-times-"));
  const result = await checkRunwayVideo({ file: "fake.mp4", dir, shot: { start: 10, duration: 2 }, pick: { shows: "snake", action: "snake sways" }, groups: [], deps: {
    runFn: async (_cmd, args) => {
      if (args.includes("-ss")) times.push(Number(args[args.indexOf("-ss") + 1]));
      fs.writeFileSync(args.at(-1), args.at(-1).endsWith(".gray") ? Buffer.concat([Buffer.alloc(4096), Buffer.alloc(4096, 10)]) : "frame");
    },
    claudeLook: async () => '{"seen":"subject moves","shows":true,"action":true,"dark":false}',
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(times, [0, 1, 2 - 1 / 30]);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("a frozen clip gets one re-animation from the same still, with charged usage", async () => {
  const f = runwayFixture({ cap: 55, motionLevels: [0, 10] });
  const [shot] = await f.run();
  assert.equal(f.images.length, 1);
  assert.equal(f.videos.length, 2);
  assert.match(f.videos[1].promptImage, /^data:image\/jpeg;base64,/);
  assert.match(f.videos[1].promptText, /Real-time movement beginning immediately.*Locked camera/);
  assert.equal(shot.motion, f.videos[1].promptText);
  assert.equal(shot.move, "none");
  assert.equal(shot.moves.ok, true);
  assert.equal(f.plan().usage.reduce((n, i) => n + i.credits, 0), 55);
});

test("frozen, wrong-subject, dark or inactive videos fail closed after one re-animation", async () => {
  for (const options of [
    { motionLevels: [0, 0] },
    ...[{ shows: false, action: true, dark: false }, { shows: true, action: false, dark: false }, { shows: true, action: true, dark: true }].map((result) => ({ videoChecks: [result, result] })),
  ]) {
    const f = runwayFixture({ cap: 55, ...options });
    assert.deepEqual(await f.run(), []);
    assert.equal(f.images.length, 1);
    assert.equal(f.videos.length, 2);
    assert.equal(f.plan().usage.reduce((n, i) => n + i.credits, 0), 55);
  }
});

test("motion retry respects the cap and account reserve, and threshold can be raised", async () => {
  for (const options of [{ cap: 30 }, { balance: 40, settings: { keepCredits: 10 } }, { cap: 30, settings: { motionThreshold: 11 } }]) {
    const f = runwayFixture({ motionLevels: [options.settings?.motionThreshold ? 10 : 0], ...options });
    assert.deepEqual(await f.run(), []);
    assert.equal(f.videos.length, 1);
    assert.equal(f.plan().usage.reduce((n, i) => n + i.credits, 0), 30);
  }
});

test("Runway reuse requires the prompt version, timings and settings, and never accepts a saved still", async () => {
  const f = runwayFixture();
  await f.run();
  const planPath = path.join(f.workDir, "broll", "broll.json");
  const saved = f.plan();
  assert.equal(saved.promptVersion, PROMPT_VERSION);
  assert.ok(saved.key.startsWith(`${PROMPT_VERSION}|`));
  await f.run();
  assert.equal(f.videos.length, 1, "matching plan reuses its validated clip");
  for (const mutate of [
    (p) => { delete p.promptVersion; },
    (p) => { p.promptVersion = "older-prompt"; },
    (p) => { p.shots[0].file = p.shots[0].still; },
    (p) => { p.key += "changed timings"; },
  ]) {
    const changed = structuredClone(saved);
    mutate(changed);
    fs.writeFileSync(planPath, JSON.stringify(changed));
    const before = f.videos.length;
    await f.run();
    assert.equal(f.videos.length, before + 1);
  }
});

test("prompt limits count UTF-16 units, drop only the optional style and never submit truncated prose", async () => {
  const warnings = [];
  const required = `${"a".repeat(970)}.`;
  assert.equal(fitPrompt(`${required} ${STILL_STYLE}`, { optionalStyle: STILL_STYLE, warnFn: (s) => warnings.push(s) }), required);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /dropped the optional style sentence/);
  const scene = `${"a".repeat(960)}.`;
  assert.equal(stillPrompt({ scene }), `${scene} Vertical photograph.`);
  assert.equal(fitPrompt("🦍".repeat(500)), "🦍".repeat(500));
  assert.throws(() => fitPrompt(`${"🦍".repeat(500)}.`, { warnFn: (s) => warnings.push(s) }), /1,000 UTF-16/);
  assert.throws(() => fitPrompt(`${"a".repeat(1001)}. ${STILL_STYLE}`, { optionalStyle: STILL_STYLE, warnFn: (s) => warnings.push(s) }), /1,000 UTF-16/);
  let calls = 0;
  const fetchFn = async () => { calls++; return json({ id: "task" }); };
  await assert.rejects(createImage({ prompt: "a".repeat(1001), fetchFn }), /1,000 UTF-16/);
  await assert.rejects(createVideo({ prompt: "a".repeat(1001), image: "https://fake/image.png", fetchFn }), /1,000 UTF-16/);
  assert.equal(calls, 0);
  await createImage({ prompt: "a".repeat(1000), fetchFn });
  assert.equal(calls, 1);
  const f = runwayFixture({ picks: [{ line: 4, shows: "snake", scene: "a snake", action: "a".repeat(1001) }] });
  assert.deepEqual(await f.run(), []);
  assert.equal(f.images.length, 0, "oversized motion is rejected before paying for a still");
});

test("action in-point uses the first above-median eighth-second change, pre-roll and end clamp", () => {
  const samples = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 30, 31, 32, 33]);
  assert.equal(actionInPoint(samples, 1.2, 3, { size: 1 }), 9 / 8 - 0.15);
  assert.equal(actionInPoint(samples, 2.5, 3, { size: 1 }), 0.5);
  assert.equal(actionInPoint(samples, 4, 3, { size: 1 }), 0);
  assert.equal(actionInPoint(Buffer.from([0, 20, 20, 20]), 1.2, 3, { size: 1 }), 0, "early action clamps to zero");
  assert.equal(actionInPoint(Buffer.from([0, 5, 10, 15]), 1.2, 3, { size: 1 }), 0, "uniform motion has no above-median event");
  assert.equal(actionInPoint(Buffer.from([0, 0, 0]), 1.2, 3, { size: 1 }), 0);
  assert.throws(() => actionInPoint(Buffer.alloc(1), 1.2, 3), /complete motion samples/);
});

test("selection preserves the full download, trims with injected ffmpeg, and checks the trimmed file", async () => {
  const levels = Array.from({ length: 24 }, (_, i) => i < 8 ? 0 : 20);
  const f = runwayFixture({ settings: { videoSeconds: 3 }, actionLevels: levels, picks: [{ line: 4, shows: "snake", scene: "a snake on a rock", action: "The snake slides down", duration: 1.2 }] });
  const [shot] = await f.run();
  assert.equal(shot.inPoint, 0.85);
  assert.equal(f.plan().shots[0].inPoint, 0.85);
  assert.ok(shot.full.endsWith("broll-1.full.mp4"));
  assert.ok(fs.existsSync(shot.full));
  assert.ok(shot.file.endsWith("broll-1.mp4"));
  const trim = f.runs.find((r) => r.args.includes("-ss") && r.args.at(-1) === shot.file);
  assert.equal(trim.args[trim.args.indexOf("-i") + 1], shot.full);
  assert.equal(trim.args[trim.args.indexOf("-ss") + 1], "0.85");
  assert.equal(trim.args[trim.args.indexOf("-t") + 1], "1.5");
  const measure = f.runs.find((r) => r.args.includes("fps=4,scale=64:64,format=gray"));
  assert.equal(measure.args[measure.args.indexOf("-i") + 1], shot.file);
  assert.match(f.videoOpenLooked[0].prompt, /at 0.85s/);
  assert.match(f.videoLooked[0].prompt, /Used source interval: 0.85 to 2.05/);
  assert.doesNotMatch(f.videoOpenLooked[0].prompt, /snake|Required subject/);
  assert.match(f.videoLooked[0].prompt, /clip-check-.*1.png/);
});

test("trim failures retain the full clip and clean temporary sampling files", async () => {
  const dir = fs.mkdtempSync(path.join(cache, "trim-failure-"));
  const file = path.join(dir, "broll-1.mp4");
  fs.writeFileSync(file, "original");
  await assert.rejects(trimRunwayClip(file, 2, { runFn: async () => { throw new Error("probe failed"); } }), /probe failed/);
  assert.deepEqual(fs.readdirSync(dir), ["broll-1.full.mp4"]);
  assert.equal(fs.readFileSync(path.join(dir, "broll-1.full.mp4"), "utf8"), "original");
});

test("three-second Turbo generation is 20 credits and Gen-4.5 retry buys only 36 more", async () => {
  assert.deepEqual(estimateClip({ seconds: 3 }), { image: 5, video: 15, credits: 20, dollars: 0.2 });
  assert.equal(estimateClip({ seconds: 3, videoModel: "gen4.5" }).video, 36);
  const settings = { videoSeconds: 3, retryVideoModel: "gen4.5" };
  const f = runwayFixture({ settings, cap: 56, reportCosts: false, motionLevels: [0, 10] });
  assert.equal((await f.run()).length, 1);
  assert.equal(f.images.length, 1);
  assert.deepEqual(f.videos.map((v) => [v.model, v.duration, v.ratio]), [["gen4_turbo", 3, "720:1280"], ["gen4.5", 3, "720:1280"]]);
  assert.equal(f.plan().usage.reduce((n, i) => n + i.credits, 0), 56);
  assert.equal(f.plan().usage.at(-1).model, "gen4.5");
  for (const options of [{ cap: 55 }, { cap: 180, balance: 65, settings: { ...settings, keepCredits: 10 } }]) {
    const tight = runwayFixture({ settings, reportCosts: false, motionLevels: [0], ...options });
    assert.deepEqual(await tight.run(), []);
    assert.equal(tight.videos.length, 1, "retry must fit its own rate before purchase");
    assert.equal(tight.plan().usage.reduce((n, i) => n + i.credits, 0), 20);
  }
});

test("unavailable clip vision retries once and accepts only measured motion, recording unavailable", async () => {
  const timedOut = new Error("look timed out");
  for (const field of ["videoChecks", "videoOpenChecks"]) {
    const f = runwayFixture({ [field]: [timedOut, timedOut] });
    const [shot] = await f.run();
    assert.equal(shot.moves.look, "unavailable");
    assert.equal(shot.moves.ok, true);
    assert.equal(f[field === "videoChecks" ? "videoLooked" : "videoOpenLooked"].length, 2);
    assert.equal(f.videos.length, 1);
    const frozen = runwayFixture({ cap: 30, [field]: [timedOut, timedOut], motionLevels: [0] });
    assert.deepEqual(await frozen.run(), []);
    assert.equal(frozen.videos.length, 1);
    const transient = runwayFixture({ [field]: [timedOut] });
    assert.equal((await transient.run())[0].moves.look, "pass");
  }
});

test("cross-caption phrases anchor exact ordered words, with only the next caption eligible", async () => {
  const groups = [
    { start: 10, text: "Bring a two", words: [{ start: 10, text: "Bring" }, { start: 10.1, text: "a" }, { start: 10.3, text: "two" }] },
    { start: 10.7, text: "by four", words: [{ start: 10.7, text: "by" }, { start: 10.9, text: "four" }] },
    { start: 11.1, text: "and use it" },
  ];
  const c = { ...groups[0], i: 0 }, pick = { line: 0, shows: "two by four", scene: "a wooden two by four", duration: 2.2 };
  assert.equal(runwayTiming(pick, c, groups).start, 10.3);
  assert.ok(Math.abs(runwayTiming(pick, c, groups).duration - 2.2) < 1e-9);
  assert.equal(runwayTiming({ ...pick, shows: "four two" }, c, groups), null);
  assert.equal(runwayTiming({ ...pick, shows: "by four" }, c, groups), null, "first word must be in candidate caption");
  assert.equal(runwayTiming(pick, c, [groups[0], groups[2], groups[1]]), null);
  const f = runwayFixture({ groups, picks: [pick] });
  const [shot] = await f.run();
  assert.equal(shot.start, 10.3);
  assert.equal(shot.duration, 2.2, "later caption changes do not truncate the board");
  const coconut = { i: 0, start: 31.465, text: "a coconut" };
  assert.ok(runwayTiming({ shows: "coconut", duration: 1.8 }, coconut, [coconut, { start: 32 }, { start: 32.415 }]).duration > 1.79);
});

test("shot duration caps at reel/CTA and reserved cards, retaining the 1.2 second minimum", () => {
  const candidate = { i: 0, start: 10, text: "a coconut" }, pick = { shows: "coconut", duration: 2.5 };
  assert.equal(runwayTiming(pick, candidate, [], { until: 12 }).duration, 2);
  assert.equal(runwayTiming(pick, candidate, [], { until: 11 }), null);
  assert.equal(runwayTiming(pick, candidate, [], { busy: [{ start: 13.5, duration: 2 }] }).duration, 2);
  assert.equal(runwayTiming(pick, candidate, [], { busy: [{ start: 10, duration: 2 }] }), null);
  assert.ok(Math.abs(runwayTiming(pick, candidate, [], { busy: [{ start: 6, duration: 1 }] }).duration - 2.4) < 1e-9);
});

test("ranked placement caps at the next accepted shot with an end-to-start gap in either order", () => {
  const candidates = [10, 14.5].map((start, i) => ({ i, start, text: "a coconut" }));
  const picks = [0, 1].map((line) => ({ line, shows: "coconut", scene: "a coconut", duration: 2.5, rank: line + 1 }));
  const options = { max: 5, gap: 3, timing: (p, c) => runwayTiming(p, c, [], { len: 2.5 }) };
  for (const order of [picks, [...picks].reverse()]) {
    const shots = placeRunwayBroll(order, candidates, options);
    assert.deepEqual(shots.map((s) => [s.start, s.duration]), [[10, 1.5], [14.5, 2.5]]);
  }
  candidates[1].start = 14;
  assert.equal(placeRunwayBroll(picks, candidates, options).length, 1, "drop when the minimum duration and gap cannot fit");
});


test("action orchestration checks matching end identity, routes Kling and adds sound after the used interval passes", async () => {
  const f = runwayFixture({ reportCosts: false, settings: { imageModel: "nano_banana_2.1", actionVideoModel: "kling3.0_standard", lastFrame: true, sfx: true, videoSeconds: 3 },
    picks: [{ line: 0, shows: "coconut", kind: "action", scene: "A coconut above sand", endScene: "The same coconut on sand", action: "The coconut drops onto sand", sound: "A coconut thuds onto sand" }],
  });
  const shots = await f.run();
  assert.equal(shots.length, 1);
  assert.equal(f.images.length, 2);
  assert.equal(f.videos[0].model, "kling3.0_standard");
  assert.equal(f.videos[0].audio, false);
  assert.equal(Array.isArray(f.videos[0].promptImage), true);
  assert.equal(f.openLooked.length, 2);
  assert.match(f.looked[1].prompt, /Compare with approved first frame/);
  assert.match(f.looked[1].prompt, /same individual subject/);
  assert.match(f.looked[1].prompt, /completed event/);
  assert.equal(f.sounds[0].duration, shots[0].duration);
  assert.equal(f.sounds[0].seed, shots[0].seed);
  assert.equal(shots[0].kind, "action");
  assert.ok(fs.existsSync(shots[0].sfx));
  assert.deepEqual(f.plan().shots, shots);
  assert.equal(f.plan().usage.reduce((s, i) => s + i.credits, 0), 4 + 4 + 27 + shots[0].duration * 2);
  const soundProxy = f.runs.findIndex((r) => r.args.at(-1).endsWith(".sound.mp4"));
  const clipCheck = f.runs.findLastIndex((r) => r.args.at(-1).includes("clip-check-"));
  assert.ok(soundProxy > clipCheck);
});

test("ambient picks use the ambient model and never buy an end still or sound without a sound description", async () => {
  const f = runwayFixture({ reportCosts: false, settings: { videoModel: "gen4_turbo", actionVideoModel: "kling3.0_standard", lastFrame: true, sfx: true, videoSeconds: 3 },
    picks: [{ line: 0, shows: "snake", kind: "ambient", scene: "A snake resting on a branch", endScene: "The same snake resting", action: "The snake gently sways" }],
  });
  const shots = await f.run();
  assert.equal(shots[0].kind, "ambient"); assert.equal(shots[0].videoModel, "gen4_turbo");
  assert.equal(f.images.length, 1); assert.equal(f.sounds.length, 0);
  assert.equal("sfx" in shots[0], false);
  assert.match(f.videoLooked[0].prompt, /gentle continuous movement/);
});

test("end identity rejection uses only the approved first still; its credits stay in the reel cap", async () => {
  const f = runwayFixture({ reportCosts: false, cap: 37, checks: [{ shows: true, dark: false }, { shows: false, dark: false, why: "different coconut" }], settings: { actionVideoModel: "kling3.0_standard", lastFrame: true, videoSeconds: 3 },
    picks: [{ line: 0, shows: "coconut", kind: "action", scene: "A coconut above sand", endScene: "The same coconut on sand", action: "The coconut lands" }],
  });
  const shots = await f.run();
  assert.equal(shots.length, 1); assert.equal(shots[0].check, "pass");
  assert.equal(typeof f.videos[0].promptImage, "string");
  assert.equal(f.plan().usage.reduce((s, i) => s + i.credits, 0), 37);
});

test("shot seeds survive redraws and re-animation, and failed synced sound warns but keeps the shot", async () => {
  const f = runwayFixture({ reportCosts: false, checks: [{ shows: false, dark: false }, { shows: true, dark: false }], motionLevels: [0, 12],
    settings: { sfx: true }, picks: [{ line: 0, shows: "coconut", scene: "A coconut above sand", action: "The coconut lands", sound: "A thud" }],
  });
  let called = false;
  f.deps.makeSound = async ({ file, seconds, seed }) => { called = true; assert.ok(fs.existsSync(file)); assert.ok(seconds <= 2.5); assert.equal(seed, f.images[0].seed); throw Object.assign(new Error("sound task failed"), { items: [{ kind: "audio", credits: 2 * seconds, dollars: 0.02 * seconds, ok: false }] }); };
  const shots = await f.run();
  assert.equal(called, true); assert.equal(shots.length, 1); assert.equal("sfx" in shots[0], false);
  assert.equal(f.images.length, 2); assert.equal(f.videos.length, 2);
  assert.ok(f.images.every((i) => i.seed === shots[0].seed));
  assert.ok(f.videos.every((v) => v.seed === shots[0].seed));
  assert.equal(f.plan().usage.at(-1).ok, false);
});

test("reported video cost exhausting the remaining cap prevents a sound purchase", async () => {
  const f = runwayFixture({ cap: 30, settings: { videoSeconds: 3, sfx: true }, picks: [{ line: 0, shows: "coconut", scene: "A coconut above sand", action: "The coconut lands", sound: "A thud" }] });
  const shots = await f.run();
  assert.equal(shots.length, 1); assert.equal(f.sounds.length, 0);
  assert.equal(f.plan().usage.reduce((s, i) => s + i.credits, 0), 30);
});
