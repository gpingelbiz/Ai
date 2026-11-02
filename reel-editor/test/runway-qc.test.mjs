import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { subjectMotion, reviewTimes, contactSheet, validTimeline, eventInPoint, phonePreviews, localClipCheck, audioPeak, soundMix, verifySound } from "../src/broll-qc.mjs";
import { runwayTiming, rapidListPicks, placeRunwayBroll, planShotBudget, videoMotion, hasPhysicalSound, checkRunwayVideo } from "../src/broll-runway.mjs";
import { generateTask, failurePolicy, waitForTask, makeStill } from "../src/runway.mjs";
import { bakeoffOptions, runBakeoff } from "../scripts/runway-bakeoff.mjs";
import { recordUsage, readUsage } from "../src/usage.mjs";
import { brollSoundTracks } from "../src/sounds.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "runway-qc-"));
process.env.REEL_CACHE = root;
process.env.REEL_BROLL_RECENT = path.join(root, "recent.json");
process.env.RUNWAY_API_KEY = "unit-test";
after(() => fs.rmSync(root, { recursive: true, force: true }));
const folder = () => fs.mkdtempSync(path.join(root, "case-"));
const json = (body) => ({ ok: true, json: async () => body, arrayBuffer: async () => Buffer.from("original download") });
const pass = { shows: true, action: true, dark: false, physicsPlausible: true, identityStable: true, artifacts: false, directionPlausible: true, humanFaces: false, readableText: false, onset: 0.4, contact: 1.2, completion: 1.5, defects: [] };
const fakeRun = async (_cmd, args) => { fs.writeFileSync(args.at(-1), args.at(-1).endsWith(".gray") ? Buffer.concat([Buffer.alloc(4096), Buffer.alloc(4096, 10)]) : "frame"); };

test("background registration removes a camera pan while retaining independent subject motion", () => {
  const width = 64, size = width * width, first = Buffer.alloc(size), pan = Buffer.alloc(size);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) first[y * width + x] = (x * 73 + y * 41 + x * y * 3) % 256;
  for (let y = 0; y < width; y++) for (let x = 2; x < width; x++) pan[y * width + x] = first[y * width + x - 2];
  const camera = subjectMotion(Buffer.concat([first, pan]));
  assert.deepEqual(camera.shifts, [{ x: 2, y: 0 }]);
  assert.equal(camera.mean, 0);
  for (let y = 25; y < 35; y++) for (let x = 25; x < 35; x++) pan[y * width + x] = 255 - pan[y * width + x];
  const subject = subjectMotion(Buffer.concat([first, pan]));
  assert.ok(subject.mean > 1);
  assert.deepEqual(subject.shifts, camera.shifts);
  assert.throws(() => subjectMotion(Buffer.alloc(4097)), /complete motion samples/);
});

test("one timestamped sheet covers every quarter second, the last frame, and the peak-motion neighbourhood", async () => {
  const times = reviewTimes(2.4, 1.2);
  for (const t of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 1.167, 1.2, 1.233, 2.367]) assert.ok(times.includes(t), String(t));
  const dir = folder(), calls = [];
  const result = await contactSheet("clip.mp4", 2.4, { dir, peakTime: 1.2, inPoint: 0.3, runFn: async (cmd, args) => { calls.push(args); await fakeRun(cmd, args); } });
  assert.ok(fs.existsSync(result.sheet));
  assert.equal(result.frames[0].time, 0.3);
  assert.ok(calls.at(-1).includes("-filter_complex"));
  assert.ok(fs.readFileSync(path.join(dir, "1.ppm")).subarray(0, 2).equals(Buffer.from("P6")));
});

test("timeline fields must establish ordered contact and completion within the inspected interval", () => {
  assert.ok(validTimeline(pass, 3));
  for (const change of [{ onset: -1 }, { contact: 0.1 }, { completion: 3.1 }, { onset: null }, { contact: undefined }, { artifacts: undefined }, { defects: null }]) assert.equal(validTimeline({ ...pass, ...change }, 3), false);
  assert.equal(eventInPoint(pass, 2, 3), 0.25);
  assert.equal(eventInPoint({ ...pass, onset: 1.7, contact: 2, completion: 2.5 }, 1.2, 3), 1.55);
  assert.equal(eventInPoint({ ...pass, onset: 0.1, completion: 2.5 }, 1.2, 3), null, "cannot drop the beginning to save a late landing");
  assert.equal(eventInPoint(null, 1.2, 3, 0.85), 0.85, "the motion-rise fallback remains available");
});

test("rings, upward hops, morphing, human faces and text each independently reject an otherwise moving clip", async () => {
  for (const change of [{ artifacts: true, defects: ["white ring"] }, { directionPlausible: false, defects: ["upward hop before falling"] }, { physicsPlausible: false }, { identityStable: false }, { humanFaces: true }, { readableText: true }, { contact: null }]) {
    const dir = folder();
    const result = await checkRunwayVideo({ file: "clip.mp4", dir, shot: { start: 10, duration: 2 }, pick: { shows: "coconut", action: "The coconut drops and lands" }, groups: [], deps: { runFn: fakeRun, claudeLook: async (prompt) => JSON.stringify(prompt.startsWith("Used source") ? { ...pass, ...change } : { seen: "a coconut changes position" }), localClipCheck: async () => { throw new Error("local checks cannot rescue a failed visual check"); } } });
    assert.equal(result.ok, false);
    assert.equal(result.look, "pass", "a negative verdict is a completed inspection");
    assert.ok(fs.existsSync(path.join(path.dirname(result.sheet), "verdict.json")));
  }
});

test("invalid or unavailable video inspection is retried once and never approved by pixel motion", async () => {
  for (const reply of [new Error("review offline"), { shows: true, action: true, dark: false }]) {
    let calls = 0;
    const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 10, duration: 2 }, pick: {}, groups: [], deps: { runFn: fakeRun, claudeLook: async (prompt) => { if (!prompt.startsWith("Used source")) return '{"seen":"moving object"}'; calls++; if (reply instanceof Error) throw reply; return JSON.stringify(reply); } } });
    assert.equal(calls, 2); assert.equal(result.ok, false); assert.equal(result.unavailable, true);
  }
});

test("spoken payoff and first unrelated word bound a cutaway, including repeated transcript words", () => {
  const groups = [{ start: 10, text: "a coconut just hits me in the head then a snake", words: [
    { text: "a", start: 10, end: 10.1 }, { text: "coconut", start: 10.1, end: 10.4 }, { text: "just", start: 10.4, end: 10.6 }, { text: "hits", start: 10.6, end: 10.8 }, { text: "me", start: 10.8, end: 11 }, { text: "in", start: 11, end: 11.2 }, { text: "the", start: 11.2, end: 11.4 }, { text: "head", start: 11.4, end: 11.7 }, { text: "then", start: 11.8, end: 12 }, { text: "a", start: 12, end: 12.1 }, { text: "snake", start: 12.1, end: 12.5 },
  ] }];
  const candidate = { ...groups[0], i: 0 }, pick = { shows: "coconut", duration: 2.5, endsAt: { line: 0, wordIndex: 7, text: "head" }, endsBefore: { line: 0, wordIndex: 8, text: "then" } };
  const t = runwayTiming(pick, candidate, groups, { len: 2.5 });
  assert.ok(Math.abs(t.start + t.duration - 11.7) < 1e-8);
  assert.equal(runwayTiming({ ...pick, endsAt: { ...pick.endsAt, text: "snake" } }, candidate, groups), null);
  assert.equal(runwayTiming({ ...pick, endsBefore: { line: 0, wordIndex: 4, text: "me" } }, candidate, groups), null, "do not stretch a too-short phrase");
});

test("phone preview draws the real caption and falls back to its band when drawtext is missing", async () => {
  const shot = { start: 1, duration: 2 }, groups = [{ start: 1, end: 2.5, text: "A coconut lands" }], dir = folder(), calls = [];
  const previews = await phonePreviews("still.jpg", shot, groups, { dir, caption: { top: 0.57, height: 0.2, fontSizeFrac: 0.04 }, runFn: async (cmd, args) => { calls.push(args); if (args.some((s) => s.includes("drawtext="))) throw new Error("no drawtext filter"); return fakeRun(cmd, args); } });
  assert.equal(previews[0].text, groups[0].text);
  assert.equal(previews[0].textDrawn, false);
  assert.equal(fs.readFileSync(path.join(dir, "caption-1.txt"), "utf8"), "A coconut lands");
  assert.match(calls[1][calls[1].indexOf("-vf") + 1], /scale=360:640.*drawbox=x=0:y=365:w=360:h=128/);
  assert.ok(fs.existsSync(previews[0].file));
});

test("retry prompts repair the named defect using one positive physical event", () => {
  const pick = { shows: "coconut", action: "The coconut drops onto sand and settles", motion: "Locked camera" };
  const prompt = videoMotion(pick, { retry: true, correction: "the coconut hops upward against gravity" });
  assert.match(prompt, /falls downward from its support, lands naturally and settles/);
  assert.doesNotMatch(prompt, /upward|no |without |hop/);
  assert.match(videoMotion(pick, { correction: "white ring and morphing" }), /retains its original shape/);
  assert.match(videoMotion(pick, { correction: "frozen clip" }), /begins the requested movement immediately/);
});

test("whole-shot reservation includes a redraw, same-model retry, optional endpoint and only physical sound", () => {
  const settings = { imageModel: "nano_banana_2.1", videoModel: "gen4.5", videoSeconds: 3, sfx: true };
  const pick = { kind: "action", sound: "a thud", soundRole: "impact" };
  const budget = planShotBudget(pick, 2.5, settings);
  assert.deepEqual([budget.credits, budget.retry, budget.reserve], [45, 36, 85]);
  assert.equal(planShotBudget({ ...pick, kind: "ambient" }, 2.5, settings).sound, undefined);
  for (const p of [{ sound: "birds" }, { ...pick, kind: "ambient" }, { ...pick, soundRole: "ambience" }]) assert.equal(hasPhysicalSound(p, settings), false);
  assert.equal(planShotBudget({ ...pick, endScene: "same coconut resting" }, 2.5, { ...settings, lastFrame: true, videoModel: "kling3.0_standard" }).endImage, 4);
});

function taskJournal() {
  const file = path.join(folder(), "broll.json"), journal = { tasks: [], save: () => fs.writeFileSync(file, JSON.stringify({ tasks: journal.tasks })) };
  return { file, journal };
}

test("task intent and id are durable before polling; restart resumes the same paid task and settles once", async () => {
  const { file, journal } = taskJournal(); let purchases = 0;
  const options = { kind: "video", model: "gen4.5", credits: 36, requestKey: "same-shot", journal, items: [], request: async () => { purchases++; assert.equal(JSON.parse(fs.readFileSync(file)).tasks[0].state, "submitting"); return { id: "paid-1" }; }, fetchFn: async () => { assert.equal(JSON.parse(fs.readFileSync(file)).tasks[0].taskId, "paid-1"); return json({ status: "SUCCEEDED", output: ["https://fake/clip"], cost: { credits: 35 } }); }, sleepFn: async () => {} };
  await assert.rejects(generateTask({ ...options, timeoutMs: -1 }), /timed out/);
  assert.equal(journal.tasks[0].state, "pending");
  const saved = JSON.parse(fs.readFileSync(file)); journal.tasks = saved.tasks;
  const result = await generateTask(options);
  assert.equal(result.status, "SUCCEEDED"); assert.equal(purchases, 1);
  assert.equal(options.items.length, 1); assert.equal(options.items[0].credits, 35);
  assert.equal(journal.tasks[0].state, "succeeded");
});

test("unknown submission blocks repurchase and failed tasks retain their actual refunded cost", async () => {
  const { journal } = taskJournal(); let purchases = 0;
  const options = { kind: "image", model: "nano_banana_2.1", credits: 4, requestKey: "unknown", journal, items: [], request: async () => { purchases++; throw new Error("network timeout after submission"); } };
  await assert.rejects(generateTask(options), { code: "UNKNOWN_SUBMISSION" });
  await assert.rejects(generateTask(options), { code: "UNKNOWN_SUBMISSION" });
  assert.equal(purchases, 1);
  const other = taskJournal(), items = [];
  const failed = { ...options, ...other, requestKey: "failed", items, request: async () => ({ id: "bad-output" }), sleepFn: async () => {}, fetchFn: async () => json({ status: "FAILED", failureCode: "SAFETY.OUTPUT.IMAGE", cost: { credits: 0 } }) };
  await assert.rejects(generateTask(failed), { code: "SAFETY.OUTPUT.IMAGE" });
  assert.equal(items[0].credits, 0);
  assert.equal(other.journal.tasks[0].state, "failed");
});

test("missing outputs and failed downloads recover a successful purchase instead of resubmitting", async () => {
  const { journal } = taskJournal(), dir = folder(); let purchases = 0, downloads = 0;
  const options = { prompt: "A coconut", file: path.join(dir, "still.png"), imageModel: "nano_banana_2.1", journal, items: [], sleepFn: async () => {}, runFn: fakeRun, fetchFn: async (url, init) => {
    if (init?.method === "POST") { purchases++; return json({ id: "image-1" }); }
    if (url.includes("/tasks/")) return json({ status: "SUCCEEDED", output: ["https://fake/image"] });
    if (++downloads <= 2) throw new Error("download connection failed");
    return json({});
  } };
  await assert.rejects(makeStill(options), { code: "OUTPUT_UNAVAILABLE" });
  await makeStill(options);
  assert.equal(purchases, 1); assert.equal(downloads, 3); assert.equal(options.items.length, 1);
  const missing = taskJournal();
  await assert.rejects(generateTask({ kind: "video", model: "gen4.5", credits: 36, ...missing, request: async () => ({ id: "empty" }), sleepFn: async () => {}, fetchFn: async () => json({ status: "SUCCEEDED", output: [] }) }), { code: "OUTPUT_UNAVAILABLE" });
});

test("failure policies stop input safety, soften output safety and delay third-party/internal failures", async () => {
  assert.equal(failurePolicy("SAFETY.INPUT.TEXT").retry, false);
  assert.equal(failurePolicy("INPUT_PREPROCESSING.SAFETY.TEXT").retry, false);
  assert.equal(failurePolicy("ASSET.INVALID").remedy, "revise-input");
  assert.equal(failurePolicy("SAFETY.OUTPUT.VIDEO").remedy, "soften");
  assert.equal(failurePolicy("THIRD_PARTY.UNAVAILABLE").delayMs, 10000);
  assert.equal(failurePolicy("INTERNAL.BAD_OUTPUT").remedy, "delay");
  const waits = []; let polls = 0;
  const result = await waitForTask("task", { sleepFn: async (ms) => waits.push(ms), fetchFn: async () => ++polls <= 3 ? { ok: false, status: 503 } : json({ status: "SUCCEEDED", output: ["https://fake/clip"] }) });
  assert.equal(result.status, "SUCCEEDED");
  for (const i of [0, 2, 4, 6]) assert.ok(waits[i] >= 5000 && waits[i] <= 7000);
  for (const [i, minimum] of [[1, 5000], [3, 10000], [5, 20000]]) assert.ok(waits[i] >= minimum && waits[i] <= minimum * 1.5);
});

test("local Mac checks inspect every sampled frame, reject text and human faces, and fail on missing reports", async () => {
  const frames = [{ file: "a.png", time: 0 }, { file: "b.png", time: 0.25 }];
  for (const scenario of ["clear", "text", "human", "animal", "missing"]) {
    const dir = folder(), runs = [];
    const check = () => localClipCheck(frames, { dir, pick: { shows: "gorilla" }, runFn: async (cmd, args) => {
      runs.push(cmd);
      if (cmd === "swiftc") { fs.writeFileSync(args[args.indexOf("-o") + 1], "binary"); return {}; }
      return { out: JSON.stringify({ width: 360, height: 640, lines: scenario === "text" ? [{ text: "SALE", confidence: 0.9 }] : [], faces: ["human", "animal"].includes(scenario) ? [{ confidence: 0.9 }] : scenario === "missing" ? undefined : [] }) };
    }, look: async () => JSON.stringify({ human: scenario !== "animal", certain: true }) });
    if (scenario === "missing") await assert.rejects(check(), /incomplete/);
    else { const result = await check(); assert.equal(result.ok, ["clear", "animal"].includes(scenario)); if (result.ok) assert.equal(result.analyzed, frames.length); }
    assert.equal(runs[0], "swiftc");
  }
});

test("sound peak follows the event; measured gain and onset duck keep track 10 under the voice", async () => {
  const samples = new Float32Array(16000 * 2); samples[16000] = 0.5;
  const peak = audioPeak(samples); assert.equal(peak.time, 1);
  assert.ok(Math.abs(peak.db + 6.0206) < 0.001);
  assert.throws(() => audioPeak(new Float32Array(20)), /unavailable/);
  const shot = { start: 10, duration: 2 }, timeline = { onset: 0.4, contact: 1, completion: 1.5 }, groups = [{ words: [{ start: 10.8, end: 11.2 }] }];
  const mix = soundMix({ time: 1, db: -3 }, { time: 1, db: -2 }, timeline, shot, groups, { impact: true });
  assert.equal(mix.gainDb, -11);
  assert.ok(mix.lane.some((p) => p.v < mix.volume));
  assert.equal(soundMix({ time: 1.4, db: -3 }, { db: -2 }, timeline, shot, groups, { impact: true }).ok, false);
  assert.equal(soundMix({ time: 1.8, db: -3 }, { db: -2 }, timeline, shot, groups).ok, false);
  assert.equal(soundMix({ time: 0.35, db: -3 }, { db: -2 }, timeline, shot, groups).ok, false, "the contact tolerance cannot admit a peak before the event starts");
  const dir = folder(), sound = path.join(dir, "sfx.wav"); fs.writeFileSync(sound, "sound");
  const track = brollSoundTracks([{ ...shot, sfx: sound, sfxMix: mix }], dir)[0];
  assert.equal(track.track, 10); assert.equal(track.volume, mix.volume); assert.deepEqual(track.lane, mix.lane);
  const checked = await verifySound(sound, "voice.mp4", shot, timeline, groups, { dir, impact: true, runFn: async (_cmd, args) => {
    const data = Buffer.alloc(16000 * 2 * 4); data.writeFloatLE(args.includes("-ss") ? 0.8 : 0.5, 16000 * 4); fs.writeFileSync(args.at(-1), data);
  } });
  assert.ok(checked.ok); assert.equal(checked.audioTransientTime, 1);
});

test("bake-off requires a finite explicit budget before touching input and defaults to Nano and Gen-4.5", async () => {
  const args = ["--picks", "p.json", "--out", root, "--stage", "videos"];
  for (const cap of [undefined, "Infinity", "NaN", "-1"]) assert.throws(() => bakeoffOptions([...args, ...(cap === undefined ? [] : ["--max-credits", cap])]));
  const options = bakeoffOptions([...args, "--max-credits", "100"]);
  assert.equal(options.still, "nano_banana_2.1"); assert.equal(options.videos[0], "gen4.5");
  await assert.rejects(runBakeoff({ ...options, picks: "missing.json", maxCredits: Infinity }), /finite explicit/);
});

test("only a validated rapid noun list gets 0.8–1.2 second back-to-back shots, counted against max", () => {
  const groups = ["snake", "ape", "lion"].map((noun, i) => ({ start: 10 + i, end: 11 + i, text: `${noun} and a`, words: [{ text: noun, start: 10 + i, end: 10.8 + i }, { text: "and", start: 10.8 + i, end: 10.9 + i }, { text: "a", start: 10.9 + i, end: 11 + i }] }));
  const candidates = groups.map((g, i) => ({ ...g, i })), picks = groups.map((g, i) => ({ line: i, shows: g.words[0].text, scene: g.words[0].text, duration: 1, sequenceGroup: "animals" }));
  const list = rapidListPicks(picks, candidates, groups);
  assert.ok(list.every((p) => p.rapidList));
  const shots = placeRunwayBroll(list, candidates, { max: 3, gap: 3, timing: (p, c) => runwayTiming(p, c, groups) });
  assert.deepEqual(shots.map((s) => [s.start, s.duration]), [[10, 1], [11, 1], [12, 1]]);
  assert.equal(placeRunwayBroll(list, candidates, { max: 2, gap: 3, timing: (p, c) => runwayTiming(p, c, groups) }).length, 2);
  groups[0].words[1].text = "attacks";
  assert.ok(rapidListPicks(picks, candidates, groups).every((p) => !p.rapidList));
  assert.ok(rapidListPicks(picks.slice(0, 2), candidates, groups).every((p) => !p.rapidList));
});


test("resumed tasks settle the existing usage line, including refunds, without resetting reel spending", () => {
  const file = path.join(folder(), "usage.json"), at = new Date("2026-11-02T12:00:00Z");
  const entry = { taskId: "paid-1", model: "gen4.5", kind: "video", credits: 36, dollars: 0.36, ok: false };
  recordUsage({ reel: "same-reel", file, at, items: [entry] });
  recordUsage({ reel: "same-reel", file, at, items: [{ ...entry, credits: 35, dollars: 0.35, ok: true }] });
  recordUsage({ reel: "same-reel", file, at, items: [{ ...entry, credits: 35, dollars: 0.35, ok: true }] });
  const month = readUsage(file).months["2026-11"];
  assert.equal(month.lines.length, 1); assert.equal(month.credits, 35); assert.equal(month.generations, 1); assert.equal(month.failed, 0);
  assert.equal(month.reels["same-reel"].credits, 35);
  recordUsage({ reel: "same-reel", file, at, items: [{ ...entry, credits: 0, dollars: 0 }] });
  assert.equal(readUsage(file).months["2026-11"].credits, 0);
});


test("phone preview preserves the rendered caption casing", async () => {
  const dir = folder();
  await phonePreviews("still.jpg", { start: 1, duration: 1 }, [{ start: 1, end: 2, text: "a coconut lands" }], { dir, caption: { uppercase: true }, runFn: fakeRun });
  assert.equal(fs.readFileSync(path.join(dir, "caption-1.txt"), "utf8"), "A COCONUT LANDS");
});
