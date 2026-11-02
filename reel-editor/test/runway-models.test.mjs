import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODELS, modelInfo, createImage, createVideo, createSound, estimateClip, conformStill, makeStill, makeClip, makeSound } from "../src/runway.mjs";
import { shotSeed, shotModels, runwayPicksPrompt, PROMPT_VERSION } from "../src/broll-runway.mjs";
import { brollSoundTracks } from "../src/sounds.mjs";
import { bakeoffOptions, runBakeoff } from "../scripts/runway-bakeoff.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runway-models-"));
process.env.RUNWAY_API_KEY = "unit-test";
process.env.REEL_CACHE = dir;
process.env.REEL_BROLL_RECENT = path.join(dir, "recent.json");
process.env.REEL_USAGE_FILE = path.join(dir, "ledger.json");
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const response = (body) => ({ ok: true, json: async () => body, arrayBuffer: async () => Buffer.from("download") });

function fixture() {
  const calls = [], runs = [], tasks = new Map(), ledger = [];
  const fetchFn = async (url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body), id = String(calls.length);
      calls.push({ url, body });
      tasks.set(id, { status: "SUCCEEDED", output: [`https://fake/${id}`] });
      return response({ id });
    }
    if (url.includes("/v1/tasks/")) return response(tasks.get(url.split("/").at(-1)));
    assert.match(url, /^https:\/\/fake\//);
    return response({});
  };
  const runFn = async (cmd, args) => {
    runs.push({ cmd, args });
    fs.writeFileSync(args.at(-1), "local asset");
  };
  return { calls, runs, tasks, ledger, fetchFn, runFn, sleepFn: async () => {}, recordUsage: (entry) => ledger.push(entry) };
}

for (const [model, perSecond, videoPrice, ratio, seed, moderation, audio, lastFrame] of [
  ["gen4_turbo", 5, 15, "720:1280", true, true, false, false],
  ["gen4.5", 12, 36, "720:1280", true, true, false, false],
  ["kling3.0_standard", 9, 27, "720:1280", false, false, true, true],
  ["grok_imagine_1_5_lite", 3, 10, "auto_720p", false, false, false, false],
  ["gemini_omni_flash_1.1", 10, 30, "720:1280", false, false, false, true],
  ["wan3", 10, 30, "auto_720p", false, false, true, true],
]) {
  test(`${model}: body capabilities, duration and price`, async () => {
    const f = fixture();
    await createVideo({ model, image: "https://fake/first", lastImage: "https://fake/last", prompt: "The coconut lands.", duration: 3, seed: 123, fetchFn: f.fetchFn });
    const body = f.calls[0].body;
    assert.deepEqual(body, {
      model, promptImage: lastFrame ? [{ uri: "https://fake/first", position: "first" }, { uri: "https://fake/last", position: "last" }] : "https://fake/first",
      promptText: "The coconut lands.", ratio, duration: 3,
      ...(seed ? { seed: 123 } : {}), ...(moderation ? { contentModeration: { publicFigureThreshold: "auto" } } : {}), ...(audio ? { audio: false } : {}),
    });
    assert.equal(MODELS[model].credits.perSecond, perSecond);
    assert.equal(estimateClip({ seconds: 3, videoModel: model }).video, videoPrice);
    assert.equal(estimateClip({ seconds: 3, videoModel: model, audio: true }).video, videoPrice + (model === "kling3.0_standard" ? 12 : 0));
    const range = MODELS[model].duration;
    await assert.rejects(createVideo({ model, duration: range[0] - 1, fetchFn: f.fetchFn }), /duration/);
    await assert.rejects(createVideo({ model, duration: range[1] + 1, fetchFn: f.fetchFn }), /duration/);
    await assert.rejects(createVideo({ model, duration: 3.5, fetchFn: f.fetchFn }), /integer/);
    assert.equal(f.calls.length, 1);
  });
}

for (const [model, ratio, price, largeSize, largeRatio, largePrice, seed, limit] of [
  ["gen4_image", "720:1280", 5, "1080p", "1080:1920", 8, true, 3],
  ["nano_banana_2.1", "768:1376", 4, "2K", "1536:2752", 6, false, 14],
]) {
  test(`${model}: still sizes, references, body and prices`, async () => {
    const f = fixture(), refs = [{ uri: "https://fake/first", tag: "firstframe" }];
    await createImage({ model, prompt: "The same coconut as @firstframe.", seed: 123, referenceImages: refs, fetchFn: f.fetchFn });
    assert.deepEqual(f.calls[0].body, { model, promptText: "The same coconut as @firstframe.", ratio, referenceImages: refs, ...(seed ? { seed: 123, contentModeration: { publicFigureThreshold: "auto" } } : {}) });
    await createImage({ model, prompt: "A coconut.", size: largeSize, fetchFn: f.fetchFn });
    assert.equal(f.calls[1].body.ratio, largeRatio);
    assert.equal(estimateClip({ seconds: 3, imageModel: model }).image, price);
    assert.equal(estimateClip({ seconds: 3, imageModel: model, imageSize: largeSize }).image, largePrice);
    await assert.rejects(createImage({ model, prompt: "A coconut", referenceImages: Array.from({ length: limit + 1 }, () => refs[0]), fetchFn: f.fetchFn }), /reference images/);
    assert.equal(f.calls.length, 2);
  });
}

test("unknown models, unsupported sizes and invalid seeds fail before HTTP", async () => {
  const fetchFn = () => assert.fail("must not fetch");
  for (const fn of [() => createImage({ model: "unknown", fetchFn }), () => createVideo({ model: "unknown", fetchFn }), () => createSound({ model: "unknown", fetchFn }), () => createVideo({ seed: -1, fetchFn }), () => createImage({ size: "8K", fetchFn })]) await assert.rejects(fn);
  assert.throws(() => modelInfo("__proto__"), /Unknown Runway/);
  assert.throws(() => estimateClip({ videoModel: "unknown" }), /Unknown Runway video model/);
  assert.throws(() => estimateClip({ imageModel: "unknown" }), /Unknown Runway image model/);
  assert.equal(estimateClip({ seconds: 2, videoModel: "gen4.5" }).video, 24);
});

test("Mirelo: exact sound fields, fractional used duration, price and proxy", async () => {
  const f = fixture();
  await createSound({ videoUri: "https://fake/clip", promptText: "A coconut thuds onto sand", duration: 2.5, seed: 12, fetchFn: f.fetchFn });
  assert.deepEqual(f.calls[0].body, { model: "mirelo_sfx_2_0", videoUri: "https://fake/clip", promptText: "A coconut thuds onto sand", negativePrompt: "music, speech, singing", duration: 2.5, seed: 12, format: "wav", numVariants: 1 });
  assert.equal(estimateClip({ seconds: 3, videoModel: "kling3.0_standard", lastFrame: true, sfxSeconds: 2.5 }).credits, 42);
  const file = path.join(dir, "trimmed.mp4"), out = path.join(dir, "broll-1.sfx.wav");
  fs.writeFileSync(file, "trimmed clip");
  const made = await makeSound({ file, out, sound: "A thud", seconds: 2.5, seed: 12, ...f });
  assert.equal(made.items[0].credits, 5);
  assert.match(f.calls[1].body.videoUri, /^data:video\/mp4;base64,/);
  assert.equal(f.calls[1].body.duration, 2.5);
  assert.equal(f.calls[1].body.seed, 12);
  assert.equal(fs.existsSync(file.replace(".mp4", ".sound.mp4")), false);
  assert.ok(f.runs[0].args.includes("2.5"));
  await assert.rejects(createSound({ duration: 2, videoUri: `data:video/mp4;base64,${"a".repeat(5 * 1024 * 1024)}`, fetchFn: f.fetchFn }), /5 MB/);
  await assert.rejects(createSound({ duration: 0, fetchFn: f.fetchFn }), /duration/);
  await assert.rejects(createSound({ duration: 601, fetchFn: f.fetchFn }), /duration/);
});

test("stills are conformed before checking and sent as bounded portrait JPEGs", async () => {
  const f = fixture(), order = [];
  const made = await makeClip({ scene: "A coconut", dir, name: "portrait", imageModel: "nano_banana_2.1", imageRatio: "720:1280", seconds: 3, ...f, check: async (file) => { order.push(file); assert.match(file, /\.input.jpg$/); assert.equal(f.calls.length, 1); return { ok: true }; } });
  assert.equal(order.length, 1);
  assert.equal(f.calls[0].body.ratio, "768:1376");
  assert.match(f.calls[1].body.promptImage, /^data:image\/jpeg;base64,/);
  assert.ok(f.runs.some((r) => r.args.includes("scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280")));
  assert.equal(made.items.reduce((sum, i) => sum + i.credits, 0), 19);
  let tries = 0;
  const file = path.join(dir, "big.png"); fs.writeFileSync(file, "input");
  await conformStill(file, { runFn: async (_, args) => fs.writeFileSync(args.at(-1), Buffer.alloc(++tries === 1 ? 2000000 : 100)) });
  assert.equal(tries, 2);
  await assert.rejects(conformStill(file, { runFn: async (_, args) => fs.writeFileSync(args.at(-1), Buffer.alloc(2000000)) }), /2 MB/);
});

test("end stills use first-frame references, check identity, and fall back on rejection or budget", async () => {
  for (const mode of ["pass", "reject", "unavailable", "budget", "failure"]) {
    const f = fixture(), checks = [];
    const made = await makeClip({ scene: "A coconut above sand", endScene: "The same coconut on sand", motion: "The coconut lands", dir, name: `end-${mode}`, seconds: 3, seed: 42, videoModel: "kling3.0_standard", ...f,
      beforeBuy: (kind, pending) => { if (kind === "endImage") { assert.equal(pending[0].credits, 5); if (mode === "budget") throw new Error("cap"); } },
      check: async (file, context) => { checks.push({ file, context }); if (context?.end && mode === "failure") throw new Error("look failed"); return { ok: !context?.end || mode === "pass", why: mode, unavailable: mode === "unavailable" }; },
    });
    assert.equal(made.items.reduce((sum, i) => sum + i.credits, 0), mode === "budget" ? 32 : 37);
    const video = f.calls.at(-1).body;
    assert.equal(Array.isArray(video.promptImage), mode === "pass");
    assert.equal(video.audio, false);
    assert.equal("seed" in video, false);
    assert.equal(f.calls[0].body.seed, 42);
    if (mode !== "budget") {
      assert.match(f.calls[1].body.promptText, /@firstframe/);
      assert.equal(f.calls[1].body.referenceImages[0].tag, "firstframe");
      assert.match(f.calls[1].body.referenceImages[0].uri, /^data:image\/jpeg;base64,/);
      assert.ok(checks[1].context.first);
    }
  }
});

test("routing, stable shot seeds, planner fields and the five-shot preset budget", () => {
  const settings = JSON.parse(fs.readFileSync(new URL("../presets/pingel-runway.json", import.meta.url))).broll;
  assert.equal(settings.maxCreditsPerReel, 260);
  // Routing itself, with Kling on action shots and a last frame (a brand can still choose this).
  const routed = { ...settings, imageModel: "gen4_image", videoModel: "gen4_turbo", actionVideoModel: "kling3.0_standard", lastFrame: true };
  const action = shotModels({ kind: "action", endScene: "Landed" }, routed), ambient = shotModels({ kind: "ambient", endScene: "Landed" }, routed);
  assert.equal(action.videoModel, "kling3.0_standard"); assert.equal(action.lastFrame, true); assert.equal(action.audio, false);
  assert.equal(ambient.videoModel, "gen4_turbo"); assert.equal(ambient.lastFrame, false);
  assert.equal(shotModels({ kind: "action" }, { ...routed, videoSeconds: 2 }).seconds, 3);
  // Greg's defaults from the 2026-11-02 bake-off: Nano Banana stills, Gen-4.5 for every shot, no end frame, Kling as the retry.
  assert.deepEqual([settings.imageModel, settings.videoModel, settings.actionVideoModel, settings.retryVideoModel, settings.lastFrame], ["nano_banana_2.1", "gen4.5", "gen4.5", "kling3.0_standard", false]);
  const shot = shotModels({ kind: "action", endScene: "Landed" }, settings);
  assert.equal(shot.videoModel, "gen4.5"); assert.equal(shot.lastFrame, false);
  // Worst case per shot: a 1K Nano still, 3 s of Gen-4.5, 2.5 s of synced sound.
  const worst = 5 * (4 + 3 * 12 + 2.5 * 2);
  assert.equal(worst, 225);
  assert.equal(5 * estimateClip({ ...shot, sfxSeconds: settings.duration }).credits, worst);
  assert.ok(worst <= settings.maxCreditsPerReel);
  assert.equal(settings.sfx, true); assert.equal(settings.sfxVolume, 0.35);
  assert.equal(shotSeed("/one/reel", 5), shotSeed("/two/reel", 5));
  assert.notEqual(shotSeed("/one/reel", 5), shotSeed("/one/reel", 6));
  assert.notEqual(shotSeed("/one/reel", 5), shotSeed("/one/other", 5));
  assert.ok(shotSeed("/one/reel", 5) >= 0 && shotSeed("/one/reel", 5) <= 4294967295);
  assert.equal(PROMPT_VERSION, "literal-video-v4");
  const prompt = runwayPicksPrompt({ candidates: [], count: 2 });
  for (const field of ["kind:", "endScene:", "sound:"]) assert.ok(prompt.includes(field));
});

test("generated sound assets produce timed tracks under the voice at the default or configured level", () => {
  const assets = fs.mkdtempSync(path.join(dir, "assets-")), sfx = path.join(dir, "source.wav"); fs.writeFileSync(sfx, "wav");
  const shots = [{ start: 4, duration: 2.5, sfx }, { start: 9, duration: 2 }, { start: 11, duration: 2, sfx: path.join(dir, "missing.wav") }];
  assert.deepEqual(brollSoundTracks(shots, assets), [{ id: "sfx-broll-1", src: "assets/broll-1.sfx.wav", start: 4, duration: 2.5, volume: 0.35, track: 10 }]);
  assert.equal(fs.readFileSync(path.join(assets, "broll-1.sfx.wav"), "utf8"), "wav");
  assert.equal(brollSoundTracks(shots, assets, { volume: 0.2 })[0].volume, 0.2);
});

function bakeoffFixture() {
  const f = fixture(), out = fs.mkdtempSync(path.join(dir, "bakeoff-")), picks = path.join(out, "picks.json");
  fs.writeFileSync(picks, JSON.stringify({ picks: [{ name: "coconut", kind: "action", shows: "coconut", scene: "A coconut above sand", endScene: "The same coconut on sand", action: "The coconut lands", sound: "A coconut thuds on sand" }] }));
  return { f, options: { out, picks, stage: "stills", images: ["gen4_image", "nano_banana_2.1"], still: "gen4_image", videos: ["gen4_turbo", "kling3.0_standard", "grok_imagine_1_5_lite"], seconds: 3, maxCredits: 200, lastFrame: true, sfx: true } };
}

test("bake-off CLI parses documented commands and rejects invalid models before generation", () => {
  const options = bakeoffOptions(["--picks", "picks.json", "--out", dir, "--stage", "stills", "--max-credits", "260"]);
  assert.deepEqual(options.images, ["gen4_image", "nano_banana_2.1"]);
  assert.equal(options.seconds, 3); assert.equal(options.maxCredits, 260);
  for (const extra of [["--videos", "unknown"], ["--max-credits", "-1"], ["--seconds", "1.5"]]) assert.throws(() => bakeoffOptions(["--picks", "p", "--out", dir, "--stage", "videos", ...extra]));
});

test("bake-off creates both stages, sheets, sound and a cumulative ledger without the pipeline", async () => {
  const { f, options } = bakeoffFixture();
  const first = await runBakeoff(options, f);
  assert.equal(first.credits, 18);
  for (const model of options.images) for (const suffix of [".png", ".end.png"]) assert.ok(fs.existsSync(path.join(options.out, "coconut", model + suffix)));
  assert.ok(fs.existsSync(path.join(options.out, "coconut", "stills-sheet.png")));
  const second = await runBakeoff({ ...options, stage: "videos" }, f);
  assert.equal(second.credits, 18 + 15 + 27 + 10 + 3 * 6);
  const videos = f.calls.filter((c) => c.url.endsWith("/image_to_video"));
  assert.equal(videos.length, 3);
  assert.equal(Array.isArray(videos[1].body.promptImage), true);
  assert.equal(Array.isArray(videos[0].body.promptImage), false);
  assert.equal(videos[2].body.ratio, "auto_720p");
  for (const video of options.videos) assert.ok(fs.existsSync(path.join(options.out, "coconut", `gen4_image--${video}.sfx.wav`)));
  assert.ok(fs.existsSync(path.join(options.out, "coconut", "gen4_image--frames-sheet.png")));
  assert.ok(f.runs.some((r) => r.args.some((a) => a.includes("xstack=inputs=12:layout=0_0|180_0|360_0|540_0|0_320"))));
  assert.deepEqual(f.runs.filter((r) => r.args.includes("-ss")).slice(0, 4).map((r) => r.args[r.args.indexOf("-ss") + 1]), ["0", "0.75", "1.5", "2.25"]);
  const usage = JSON.parse(fs.readFileSync(path.join(options.out, "usage.json")));
  assert.equal(usage.items.length, 10);
  assert.equal(f.ledger[0].items.length, 4); assert.equal(f.ledger[1].items.length, 6);
  assert.match(fs.readFileSync(path.join(options.out, "runway usage.txt"), "utf8"), /88 credits/);
});

test("bake-off caps before first/end still, video and sound purchases and records local failures", async () => {
  for (const cap of [0, 5, 10]) {
    const { f, options } = bakeoffFixture();
    const result = await runBakeoff({ ...options, maxCredits: cap }, f);
    assert.equal(result.aborted, true);
    assert.equal(result.credits, cap);
    assert.equal(f.calls.length, cap / 5);
  }
  for (const extra of [0, 15]) {
    const { f, options } = bakeoffFixture();
    await runBakeoff(options, f);
    const result = await runBakeoff({ ...options, stage: "videos", maxCredits: 18 + extra }, f);
    assert.equal(result.aborted, true);
    assert.equal(result.credits, 18 + extra);
    assert.equal(f.calls.filter((c) => c.url.endsWith("/video_to_audio")).length, 0);
  }
  const { f, options } = bakeoffFixture();
  await assert.rejects(runBakeoff(options, { ...f, runFn: async () => { throw new Error("local conform failed"); } }), /local conform failed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(options.out, "usage.json"))).credits, 5);
  assert.equal(f.ledger[0].items[0].credits, 5);
});


test("bake-off records charged sound failures and continues with accepted video", async () => {
  const { f, options } = bakeoffFixture();
  await runBakeoff(options, f);
  const fetchFn = async (url, init) => {
    const result = await f.fetchFn(url, init);
    if (url.endsWith("/video_to_audio")) f.tasks.set(String(f.calls.length - 1), { status: "FAILED", failure: "sound unavailable", cost: { credits: 3 } });
    return result;
  };
  const result = await runBakeoff({ ...options, stage: "videos", videos: ["gen4_turbo"] }, { ...f, fetchFn });
  assert.equal(result.aborted, false);
  assert.equal(result.credits, 18 + 15 + 3);
  assert.equal(result.items.at(-1).ok, false);
  assert.equal(result.items.at(-1).credits, 3);
  assert.ok(fs.existsSync(path.join(options.out, "coconut", "gen4_image--frames-sheet.png")));
});

test("Veo 3.1: only 4, 6 or 8 seconds, audio always sent and priced", async () => {
  assert.equal(estimateClip({ seconds: 4, videoModel: "veo3.1" }).video, 80);
  assert.equal(estimateClip({ seconds: 4, videoModel: "veo3.1_fast" }).video, 40);
  const bodies = [];
  const fetchFn = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: "v1" }), text: async () => "{}" }; };
  await createVideo({ image: "https://x/a.png", prompt: "The coconut drops.", model: "veo3.1_fast", duration: 4, seed: 7, fetchFn });
  assert.equal(bodies[0].audio, false);
  assert.equal(bodies[0].seed, 7);
  await assert.rejects(createVideo({ image: "https://x/a.png", prompt: "x", model: "veo3.1", duration: 5, fetchFn }), /one of 4, 6, 8/);
});
