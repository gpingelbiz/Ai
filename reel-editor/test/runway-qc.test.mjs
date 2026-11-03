import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { visionJSON, subjectMotion, videoFrames, motionCrops, landingCrops, DEFECT_QUESTIONS, reviewTimes, contactSheet, validTimeline, eventInPoint, momentInPoint, motionWindowInPoint, phonePreviews, localClipCheck, audioPeak, soundMix, verifySound } from "../src/broll-qc.mjs";
import { run } from "../src/util.mjs";
import { runwayTiming, rapidListPicks, placeRunwayBroll, planShotBudget, videoMotion, hasPhysicalSound, checkRunwayVideo, trimRunwayClip, clipCheckPrompt } from "../src/broll-runway.mjs";
import { generateTask, failurePolicy, waitForTask, makeStill } from "../src/runway.mjs";
import { bakeoffOptions, runBakeoff } from "../scripts/runway-bakeoff.mjs";
import { recordUsage, readUsage } from "../src/usage.mjs";
import { brollSoundTracks } from "../src/sounds.mjs";

const frameProbe = { out: JSON.stringify({ frames: Array.from({ length: 600 }, (_, i) => ({ best_effort_timestamp_time: String(i / 120) })) }) };
const root = fs.mkdtempSync(path.join(os.tmpdir(), "runway-qc-"));
process.env.REEL_CACHE = root;
process.env.REEL_BROLL_RECENT = path.join(root, "recent.json");
process.env.RUNWAY_API_KEY = "unit-test";
after(() => fs.rmSync(root, { recursive: true, force: true }));
const folder = () => fs.mkdtempSync(path.join(root, "case-"));
const json = (body) => ({ ok: true, json: async () => body, arrayBuffer: async () => Buffer.from("original download") });
const pass = { shows: true, action: true, dark: false, physicsPlausible: true, identityStable: true, artifacts: false, directionPlausible: true, humanFaces: false, readableText: false, eventType: "drop-land", onset: 0.4, contact: 1.2, completion: 1.5, checks: Object.fromEntries(Object.keys(DEFECT_QUESTIONS).map((key) => [key, { yes: false, time: null, why: "frames compared; absent" }])), defects: [] };
const landingPass = { collar: false, objectPosition: "on sand beside an outward spray", why: "textured grains disperse away from the base" };
const fakeRun = async (_cmd, args) => { if (_cmd === "ffprobe") return frameProbe; fs.writeFileSync(args.at(-1), args.at(-1).endsWith("landing.gray") ? Buffer.alloc(180 * 320 * 48, 220) : args.at(-1).endsWith(".gray") ? Buffer.concat([Buffer.alloc(4096), Buffer.alloc(4096, 10)]) : "frame"); };

test("vision JSON tolerates fences, nested trailing commas and bare keys without changing observations", () => {
  const why = 'sand, } {base: bright} and a "quoted" word, \\ path';
  for (const reply of [JSON.stringify({ why }), `\`\`\`json\n${JSON.stringify({ why })}\n\`\`\``, `Answer: {checks: [{yes: false, why: ${JSON.stringify(why)},},], contactPoint: {x: 0.5, y: 0.8,},}`]) {
    const result = visionJSON(reply);
    assert.equal(result.why ?? result.checks[0].why, why);
    if (result.checks) assert.deepEqual(result.contactPoint, { x: 0.5, y: 0.8 });
  }
  assert.throws(() => visionJSON('{"why":"sand" "yes":false}'), SyntaxError);
  assert.throws(() => visionJSON("not JSON"), /no JSON/);
  assert.throws(() => visionJSON('{yes: (() => true)()}'), SyntaxError, "repairs never evaluate code");
});

test("each video look repairs formatting locally or retries once with the previous answer", async () => {
  for (const stage of ["blind", "verdict", "landing"]) for (const repair of [true, false]) {
    const attempts = { blind: 0, verdict: 0, landing: 0 }, prompts = [];
    const answers = { blind: { seen: "an object falls onto sand", contact: 1.2, contactPoint: { x: 0.5, y: 0.8 } }, verdict: pass, landing: landingPass };
    const original = JSON.stringify(answers[stage]);
    const malformed = repair ? `\`\`\`json\n${original.replace(/"(\w+)":/g, "$1:").replace(/}$/, ",}")}\n\`\`\`` : original.replace(/,/, " ");
    const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 0, duration: 2 }, pick: {}, groups: [], deps: {
      runFn: fakeRun, log: () => {}, localClipCheck: async () => ({ ok: true }), claudeLook: async (prompt) => {
        const current = prompt.startsWith("Used source") ? "verdict" : prompt.startsWith("Inspect the landing") ? "landing" : "blind";
        attempts[current]++;
        if (current === stage) {
          prompts.push(prompt);
          if (attempts[current] === 1) return malformed;
          if (attempts[current] === 2 && !repair) {
            assert.match(prompt, /Your last reply was not valid JSON; reply with the same answer as valid JSON only/);
            assert.ok(prompt.includes(JSON.stringify(malformed)), "the new CLI call needs the answer it must reformat");
          }
        }
        return JSON.stringify(answers[current]);
      },
    } });
    assert.equal(result.ok, true, `${stage}, repair=${repair}: ${result.why}`);
    assert.equal(result.unavailable, undefined);
    assert.equal(attempts[stage], (repair ? 1 : 2) + (stage === "landing" ? 1 : 0));
    assert.equal(prompts.length, attempts[stage]);
  }
});

test("persistent malformed JSON stops after one correction and retains its measured motion", async () => {
  let calls = 0;
  const logs = [];
  const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 0, duration: 2 }, pick: {}, groups: [], deps: {
    runFn: fakeRun, log: (s) => logs.push(s), claudeLook: async (prompt) => { calls++; if (calls === 2) assert.match(prompt, /Your last reply was not valid JSON/); return '{"seen":"object" "contact":null}'; },
  } });
  assert.equal(result.unavailable, true);
  assert.equal(calls, 2);
  assert.equal(result.motion.mean, 10);
  assert.match(logs[0], /subject motion 10\.000.*continuous minimum 3\.0/);
});

test("the measured continuous floor vetoes claimed walking, honors overrides and excludes drop events", async () => {
  for (const [mean, eventType, continuousMinMotion, expected] of [[2.41, "continuous", undefined, false], [3, "continuous", undefined, true], [3.47, "continuous", undefined, true], [5.15, "continuous", undefined, true], [7.86, "continuous", undefined, true], [8.48, "continuous", undefined, true], [11.93, "continuous", undefined, true], [2, "continuous", 2, true], [3, "continuous", 4, false], [2.59, "drop-land", undefined, true], [0, "drop-land", undefined, false]]) {
    const logs = [];
    const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 0, duration: 3 }, pick: { shows: "gorilla" }, groups: [], continuousMinMotion, deps: {
      runFn: async (cmd, args) => {
        await fakeRun(cmd, args);
        if (args.at(-1).endsWith(".gray")) {
          const after = Buffer.from(Array.from({ length: 4096 }, (_, i) => Math.floor(mean) + (i % 100 < Math.round(mean % 1 * 100) ? 1 : 0)));
          fs.writeFileSync(args.at(-1), Buffer.concat([Buffer.alloc(4096), after]));
        }
        return cmd === "ffprobe" ? frameProbe : undefined;
      },
      log: (s) => logs.push(s), localClipCheck: async () => { assert.ok(expected, "motion floor must veto before local checks"); return { ok: true }; },
      claudeLook: async (prompt) => JSON.stringify(prompt.startsWith("Used source") ? { ...pass, eventType, contact: null, completion: null, why: "unmistakably walking" } : { seen: "a subject moves", contact: null }),
    } });
    assert.equal(result.ok, expected, `${mean}, ${eventType}, minimum ${continuousMinMotion}: ${result.why}`);
    assert.equal(result.unavailable, undefined);
    assert.match(logs[0], new RegExp(`subject motion ${result.motion.mean.toFixed(3)}`));
    if (!expected && eventType === "continuous") assert.ok(result.why.includes(`continuous action motion ${result.motion.mean.toFixed(3)} below minimum ${(continuousMinMotion ?? 3).toFixed(1)}`));
    if (eventType === "drop-land" && expected) assert.equal(eventInPoint(result, 1.6, 3), 0.25);
  }
});

test("3x landing crops center on the contact surface, retain source labels, and do not reach outside used pixels", async () => {
  const calls = [], dir = folder();
  const crop = await landingCrops("clip.mp4", 2, { dir, contact: 1.2, point: { x: 0.5, y: 0.8 }, inPoint: 2, runFn: async (cmd, args) => { calls.push(args); return fakeRun(cmd, args); } });
  assert.deepEqual(crop.frames.map((f) => f.time), [3.167, 3.4, 3.5, 3.6]);
  assert.equal(crop.time, 3.2);
  const filters = calls.filter((a) => a.includes("-vf")).map((a) => a[a.indexOf("-vf") + 1]);
  assert.equal(filters.length, 4);
  assert.ok(filters.every((f) => f.endsWith("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,crop=360:640:360:1216")));
  for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }]) {
    const edge = await landingCrops("clip.mp4", 2, { dir, contact: 1.9, point, runFn: fakeRun });
    assert.equal(edge.frames.length, 1, "unavailable after-contact pixels cannot be taken from outside the interval");
    assert.ok(edge.region.x >= 0 && edge.region.x + edge.region.width <= 1);
    assert.ok(edge.region.y >= 0 && edge.region.y + edge.region.height <= 1);
  }
});

test("a dedicated landing inspection vetoes a cotton collar even when general physics checks pass", async () => {
  for (const collar of [true, false]) {
    const prompts = [], dir = folder();
    const result = await checkRunwayVideo({ file: "clip.mp4", dir, inPoint: 2, shot: { start: 0, duration: 2 }, pick: { shows: "coconut" }, groups: [], deps: {
      runFn: fakeRun, log: () => {}, localClipCheck: async () => { assert.equal(collar, false); return { ok: true }; },
      claudeLook: async (prompt) => {
        prompts.push(prompt);
        if (prompt.startsWith("Used source")) return JSON.stringify(pass);
        if (!prompt.startsWith("Inspect the landing")) return JSON.stringify({ seen: "a coconut lands on a surface", contact: 1.2, contactPoint: { x: 0.5, y: 0.8 } });
        assert.match(prompt, /EVERY fixed 3x contact-region crop/);
        assert.match(prompt, /3\.167, 3\.4, 3\.5, 3\.6/);
        assert.match(prompt, /white or bright ring, collar, disc, halo or outline/);
        assert.match(prompt, /cotton or foam/);
        assert.match(prompt, /throws textured sand sideways in one direction/);
        assert.match(prompt, /where the object sits relative/);
        for (const [, image] of prompt.matchAll(/"([^"\n]+\.png)"/g)) assert.ok(fs.existsSync(path.join(dir, image)));
        return JSON.stringify(collar ? { collar: true, objectPosition: "seated inside the white collar", why: "a symmetrical cotton-like ring forms around the base after contact" } : landingPass);
      },
    } });
    assert.equal(result.ok, !collar);
    assert.equal(result.unavailable, undefined);
    assert.equal(prompts.length, 4, "two independent landing reviews agree");
    assert.equal(result.landing.collar, collar);
    const saved = JSON.parse(fs.readFileSync(path.join(path.dirname(result.sheet), "verdict.json")));
    assert.deepEqual(saved.landing, result.landing);
    if (collar) assert.match(result.why, /landing collar at 3\.2s:.*object position: seated inside/);
  }
});

test("landing inspection fails closed on incomplete answers and missing contact locations", async () => {
  for (const location of [undefined, { x: -0.1, y: 0.8 }, { x: 0.5, y: 2 }, { x: 0.5, y: 0.8 }]) {
    let openCalls = 0, landingCalls = 0;
    const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 0, duration: 2 }, pick: {}, groups: [], deps: {
      runFn: fakeRun, log: () => {}, claudeLook: async (prompt) => {
        if (prompt.startsWith("Used source")) return JSON.stringify(pass);
        if (prompt.startsWith("Inspect the landing")) { landingCalls++; return JSON.stringify({ collar: false, why: "clear" }); }
        openCalls++;
        return JSON.stringify({ seen: "an object lands", contact: 1.2, contactPoint: location });
      },
    } });
    assert.equal(result.unavailable, true);
    assert.equal(openCalls, landingCalls ? 1 : 2);
    assert.equal(landingCalls, location?.y === 0.8 && location.x >= 0 ? 2 : 0);
  }
});

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
  for (const t of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 1.167, 1.2, 1.233, 2.366]) assert.ok(times.includes(t), String(t));
  assert.ok(reviewTimes(1.6, 1.6).every((t) => t <= 1.5666), "no sample seeks past the last frame");
  const dir = folder(), calls = [];
  const result = await contactSheet("clip.mp4", 2.4, { dir, peakTime: 1.2, inPoint: 0.3, runFn: async (cmd, args) => { calls.push(args); return fakeRun(cmd, args); } });
  assert.ok(fs.existsSync(result.sheet));
  assert.equal(result.frames[0].time, 0.3);
  assert.ok(calls.at(-1).includes("-filter_complex"));
  assert.ok(fs.readFileSync(path.join(dir, "1.ppm")).subarray(0, 2).equals(Buffer.from("P6")));
});

test("timeline timing hints are ordered when present, and never require a settle to select pixels", () => {
  assert.ok(validTimeline(pass, 3));
  for (const change of [{ onset: -1 }, { contact: 0.1 }, { completion: 3.1 }, { onset: null }, { contact: undefined }, { artifacts: undefined }, { defects: null }]) assert.equal(validTimeline({ ...pass, ...change }, 3), false);
  assert.equal(eventInPoint(pass, 2, 3), 0.25);
  assert.equal(eventInPoint({ ...pass, onset: 1.7, contact: 2, completion: 2.5 }, 1.2, 3), 1.55);
  assert.equal(eventInPoint({ ...pass, onset: 0.1, completion: 2.5 }, 1.2, 3), 0.1, "keep the onset even if the settle cannot fit; review the actual used action");
  assert.equal(eventInPoint({ ...pass, contact: null, completion: null }, 1.2, 3), 0.25);
  assert.equal(eventInPoint({ ...pass, eventType: "continuous", contact: null, completion: 3 }, 1.6, 3), 0.25);
  assert.equal(eventInPoint(pass, 4, 3), null, "the media still has to cover the requested duration");
  for (const eventType of ["continuous", "drop-land"]) assert.ok(validTimeline({ ...pass, eventType, contact: null, completion: null }, 3));
  assert.equal(validTimeline({ ...pass, eventType: "unknown" }, 3), false);
  assert.equal(eventInPoint(null, 1.2, 3, 0.85), 0.85, "the motion-rise fallback remains available");
  assert.equal(momentInPoint({ onset: 0, contact: 1.25, completion: 3.75 }, 1.6, 16), 0.65, "a long wave is cut around the break");
  assert.equal(momentInPoint({ onset: 4, contact: null, completion: 12 }, 1.6, 16), 3.85, "a continuous event starts at its onset");
  assert.equal(momentInPoint({ onset: 0, contact: 15.9, completion: 16 }, 1.6, 16), 14.4);
  assert.equal(momentInPoint({ onset: 0, contact: 1, completion: 2 }, 3, 2), null, "the clip must outlast the cutaway");
});

for (const fps of [24, 30]) test(`real short ${fps === 24 ? "24 fps" : "24-to-30 fps"} clip keeps its final frame and detail crops`, async () => {
  const dir = folder(), file = path.join(dir, "short.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=90x160:rate=24", "-t", "1.6", "-r", String(fps), "-c:v", "libx264", "-pix_fmt", "yuv420p", file], { quiet: true });
  const samples = await videoFrames(file);
  const last = samples.at(-1).time;
  assert.ok(last < 1.6);
  const sheetDir = fs.mkdtempSync(path.join(dir, "sheet-"));
  const sheet = await contactSheet(file, 1.6, { dir: sheetDir, samples, inPoint: 2, times: [0, 0.75, 1.567, 1.6, 2] });
  assert.equal(sheet.frames.at(-1).time, Math.round((2 + last) * 1000) / 1000);
  assert.equal(sheet.frames.length, 3, "requests beyond the last PTS share one real final frame");
  const result = await checkRunwayVideo({ file, dir, inPoint: 2, shot: { start: 0, duration: 1.6 }, pick: { shows: "moving pattern" }, groups: [], deps: {
    runFn: run, localClipCheck: async () => ({ ok: true }),
    claudeLook: async (prompt) => JSON.stringify(prompt.startsWith("Used source") ? { ...pass, eventType: "continuous", contact: null, completion: null } : prompt.startsWith("Inspect the landing") ? landingPass : { seen: "a moving pattern", contact: 1.6, contactPoint: { x: 0.5, y: 0.8 } }),
  } });
  assert.equal(result.ok, true, result.why);
  assert.equal(result.frames.at(-1).time, Math.round((2 + last) * 1000) / 1000);
  assert.equal(result.crops.length, 3);
  for (const page of [sheet, result, ...result.crops]) {
    for (const frame of page.frames) for (const png of [frame.file, frame.tile]) assert.equal(fs.readFileSync(png).subarray(1, 4).toString(), "PNG");
    for (const png of page.sheets) assert.equal(fs.readFileSync(png).subarray(1, 4).toString(), "PNG");
    assert.ok(page.frames.every((f) => f.time >= 2 && f.time < 3.6));
  }
});

test("frame extraction uses decoded indices and rejects unavailable timestamps", async () => {
  const calls = [], dir = folder();
  const result = await contactSheet("clip.mp4", 1.6, { dir, times: [0, 1.567, 1.6], samples: [{ index: 0, time: 0 }, { index: 47, time: 1.566667 }, { index: 48, time: 1.6 }], runFn: async (cmd, args) => { calls.push(args); return fakeRun(cmd, args); } });
  assert.deepEqual(result.frames.map((f) => f.time), [0, 1.567]);
  const extraction = calls.filter((args) => args.includes("-vf"));
  assert.equal(extraction.length, 2);
  assert.match(extraction[1][extraction[1].indexOf("-vf") + 1], /select=eq\(n\\,47\)/);
  assert.ok(extraction.every((args) => !args.includes("-ss")));
  const offset = await videoFrames("offset.mp4", { runFn: async () => ({ out: JSON.stringify({ frames: [{ best_effort_timestamp_time: "5" }, { best_effort_timestamp_time: "5.5" }] }) }) });
  assert.deepEqual(offset, [{ index: 0, time: 0 }, { index: 1, time: 0.5 }]);
  for (const frames of [[], [{}], [{ best_effort_timestamp_time: null }], [{ best_effort_timestamp_time: "N/A" }]]) await assert.rejects(videoFrames("bad.mp4", { runFn: async () => ({ out: JSON.stringify({ frames }) }) }), /timestamps unavailable/);
});

test("continuous word-fitting actions pass without contact or a settle, even through the cut", async () => {
  for (const shows of ["snake", "gorilla", "two by four", "cream"]) for (const completion of [null, 2]) {
    const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 0, duration: 2 }, pick: { shows }, groups: [], deps: {
      runFn: fakeRun, localClipCheck: async () => ({ ok: true }),
      claudeLook: async (prompt) => JSON.stringify(prompt.startsWith("Used source") ? { ...pass, eventType: "continuous", contact: null, completion } : { seen: "the subject visibly moves", contact: null }),
    } });
    assert.equal(result.ok, true, `${shows}: ${result.why}`);
    assert.equal(eventInPoint(result, 1.6, 2), 0.25);
  }
});

test("rings, upward hops, morphing, human faces and text each independently reject an otherwise moving clip", async () => {
  for (const change of [{ artifacts: true, defects: ["white ring"] }, { defects: ["white ring"] }, { directionPlausible: false, defects: ["upward hop before falling"] }, { physicsPlausible: false }, { identityStable: false }, { humanFaces: true }, { readableText: true }]) {
    const dir = folder();
    const result = await checkRunwayVideo({ file: "clip.mp4", dir, shot: { start: 10, duration: 2 }, pick: { shows: "coconut", action: "The coconut drops and lands" }, groups: [], deps: { runFn: fakeRun, claudeLook: async (prompt) => JSON.stringify(prompt.startsWith("Used source") ? { ...pass, ...change } : { seen: "a coconut changes position", contact: 1.2, contactPoint: { x: 0.5, y: 0.8 } }), localClipCheck: async () => { throw new Error("local checks cannot rescue a failed visual check"); } } });
    assert.equal(result.ok, false);
    assert.equal(result.look, "pass", "a negative verdict is a completed inspection");
    assert.ok(fs.existsSync(path.join(path.dirname(result.sheet), "verdict.json")));
  }
});

test("invalid or unavailable video inspection is retried once and never approved by pixel motion", async () => {
  for (const reply of [new Error("review offline"), { shows: true, action: true, dark: false }]) {
    let calls = 0;
    const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 10, duration: 2 }, pick: {}, groups: [], deps: { runFn: fakeRun, claudeLook: async (prompt) => { if (!prompt.startsWith("Used source")) return '{"seen":"moving object","contact":null}'; calls++; if (reply instanceof Error) throw reply; return JSON.stringify(reply); } } });
    assert.equal(calls, 2); assert.equal(result.ok, false); assert.equal(result.unavailable, true);
  }
});

test("motion regions follow an off-centre subject after camera compensation", () => {
  const first = Buffer.alloc(4096), second = Buffer.alloc(4096);
  for (let y = 46; y < 57; y++) for (let x = 48; x < 59; x++) second[y * 64 + x] = 200;
  const motion = subjectMotion(Buffer.concat([first, second]));
  const region = motion.regions[0];
  assert.equal(region.time, motion.peakTime);
  assert.ok(region.x > 0.25 && region.y > 0.25);
  assert.ok(region.x * 64 <= 48 && (region.x + region.width) * 64 >= 59);
  assert.ok(region.y * 64 <= 46 && (region.y + region.height) * 64 >= 57);
});

test("large timeline pages retain every cell and handle a single-frame last page", async () => {
  const dir = folder(), calls = [];
  const times = Array.from({ length: 7 }, (_, i) => i / 4);
  const result = await contactSheet("clip.mp4", 2, { dir, times, runFn: async (cmd, args) => { calls.push(args); return fakeRun(cmd, args); } });
  assert.equal(result.sheets.length, 2);
  assert.equal(result.sheet, result.sheets[0]);
  const pages = calls.filter((args) => result.sheets.includes(args.at(-1)));
  assert.equal(pages[0].filter((arg) => arg === "-i").length, 6);
  assert.match(pages[0].join(" "), /layout=0_0\|360_0\|720_0\|0_668/);
  assert.ok(pages[1].includes("[0:v]null[out]"));
  assert.doesNotMatch(calls.flat().join(" "), /scale=180/);
});

test("2x bursts use fixed motion regions at peak and contact, with absolute time labels", async () => {
  const calls = [], dir = folder();
  const motion = { peakTime: 0.5, regions: [{ time: 0.5, change: 20, x: 0.25, y: 0.125 }, { time: 1.5, change: 10, x: 0.5, y: 0.5 }] };
  const crops = await motionCrops("clip.mp4", 2, { dir, motion, contact: 1.5, inPoint: 2, runFn: async (cmd, args) => { calls.push(args); return fakeRun(cmd, args); } });
  assert.deepEqual(crops.map((c) => c.name), ["peak", "contact"]);
  assert.deepEqual(crops[1].frames.map((f) => f.time), [3.25, 3.375, 3.467, 3.5, 3.533, 3.625, 3.75]);
  assert.equal(crops[1].time, 3.5);
  const filters = calls.filter((args) => args.includes("-vf")).map((args) => args[args.indexOf("-vf") + 1]);
  assert.equal(filters.filter((f) => f.endsWith("crop=360:640:180:160")).length, 7);
  assert.equal(filters.filter((f) => f.endsWith("crop=360:640:360:640")).length, 7);
  const peakOnly = await motionCrops("clip.mp4", 2, { dir, motion, contact: null, runFn: fakeRun });
  assert.equal(peakOnly.length, 1);
});

test("every explicit defect answer vetoes an otherwise clean verdict and records its source time", async () => {
  for (const key of ["upwardOrTeleport", "contactArtifact", "identityChange", "cameraSwing", "aggressiveApproach", "humanFaces", "readableText", "unsafeAssociation"]) {
    let lookCalls = 0;
    const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), inPoint: 2, shot: { start: 10, duration: 2 }, pick: { shows: "coconut" }, groups: [], deps: {
      runFn: fakeRun,
      claudeLook: async () => JSON.stringify(++lookCalls === 1 ? { seen: "an object moves", contact: 1.2, contactPoint: { x: 0.5, y: 0.8 } } : { ...pass, checks: { ...pass.checks, [key]: { yes: true, time: 3.2, why: "visible defect at contact" } } }),
      localClipCheck: async () => { assert.fail("defect must veto before local checks"); },
    } });
    assert.equal(result.ok, false, key);
    assert.equal(result.unavailable, undefined);
    assert.equal(lookCalls, 2, "valid negatives are not retried");
    assert.match(result.why, new RegExp(`${key} at 3.2s: visible defect`));
    assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(result.sheet), "verdict.json"))).checks[key].yes, true);
  }
});

test("missing defect answers, untimed yes and answers outside the source interval fail closed", async () => {
  for (const checks of [undefined, {}, { ...pass.checks, cameraSwing: { yes: true, time: null, why: "swing" } }, { ...pass.checks, cameraSwing: { yes: true, time: 1, why: "swing" } }, { ...pass.checks, cameraSwing: { yes: true, time: 9, why: "swing" } }, { ...pass.checks, contactArtifact: { yes: false, time: null, why: "" } }]) {
    assert.equal(validTimeline({ ...pass, checks }, 2, 2), false);
    let calls = 0;
    const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), inPoint: 2, shot: { start: 0, duration: 2 }, pick: {}, groups: [], deps: {
      runFn: fakeRun, claudeLook: async (prompt) => { if (!prompt.startsWith("Used source")) return JSON.stringify({ seen: "an object moves", contact: null }); calls++; return JSON.stringify({ ...pass, checks }); },
    } });
    assert.equal(result.unavailable, true);
    assert.equal(calls, 2);
  }
});

test("blind description comes first, then words govern the action and contact detail review", async () => {
  const prompts = [];
  const words = "bring a two by four and hold it on the quicksand";
  const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 0, duration: 2 }, pick: { shows: "two by four", action: "The hands lower the board and it lands" }, groups: [{ start: 0, end: 2, text: words }], deps: {
    runFn: fakeRun, localClipCheck: async () => ({ ok: true }), claudeLook: async (prompt, { cwd }) => {
      prompts.push(prompt);
      if (prompt.startsWith("Inspect the landing")) return JSON.stringify(landingPass);
      if (prompts.length === 1) {
        assert.doesNotMatch(prompt, /two by four|quicksand|hands lower/);
        assert.match(prompt, /Describe what you see first/);
        return JSON.stringify({ seen: "hands pressing a wooden board into mud", contact: 0.8, contactPoint: { x: 0.5, y: 0.8 } });
      }
      assert.ok(fs.readdirSync(path.join(cwd, prompt.match(/clip-check-[^/]+/)[0])).some((f) => f.startsWith("contact-")));
      return JSON.stringify({ ...pass, contact: null, why: "board visibly presses into mud and fits the words" });
    },
  } });
  assert.equal(result.ok, true, "the action hint cannot force a visible landing or a lowering from above");
  assert.match(prompts[1], /Action hint only, NOT a script or acceptance requirement/);
  assert.ok(prompts[1].includes(words));
  assert.match(prompts[1], /"name":"contact","time":0.8/);
  assert.match(prompts[1], /ring, halo, smear, double edge, melting/);
  assert.match(prompts[1], /move upward against gravity BEFORE falling, or teleport/);
  assert.match(prompts[1], /calm natural walk toward or away/);
  assert.equal(result.crops[1].time, 0.8);
});

test("a late event can select its in-point but cannot pass a used interval pinned to zero", async () => {
  for (const selecting of [true, false]) {
    const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 0, duration: 3 }, selecting, pick: {}, groups: [], deps: {
      runFn: fakeRun, localClipCheck: async () => ({ ok: true }), claudeLook: async (prompt) => JSON.stringify(prompt.startsWith("Used source") ? { ...pass, onset: 1.7, contact: 2, completion: 2.3 } : prompt.startsWith("Inspect the landing") ? landingPass : { seen: "an object falls late", contact: 2, contactPoint: { x: 0.5, y: 0.8 } }),
    } });
    assert.equal(result.ok, selecting);
    if (!selecting) assert.match(result.why, /after the first second/);
  }
});

test("failed blind timing is retried without revealing the intended subject", async () => {
  let calls = 0;
  const result = await checkRunwayVideo({ file: "clip.mp4", dir: folder(), shot: { start: 0, duration: 2 }, pick: { shows: "snake" }, groups: [], deps: {
    runFn: fakeRun, claudeLook: async (prompt) => { calls++; assert.doesNotMatch(prompt, /snake/); return JSON.stringify({ seen: "an object moves", contact: 8 }); },
  } });
  assert.equal(result.unavailable, true);
  assert.equal(calls, 2);
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

test("movement sound can accompany a continuous action with no settle or contact", async () => {
  const dir = folder(), shot = { start: 0, duration: 2 }, timeline = { onset: 0.4, contact: null, completion: null };
  const result = await verifySound("movement.wav", "voice.mp4", shot, timeline, [], { dir, runFn: async (_cmd, args) => {
    const data = Buffer.alloc(16000 * 2 * 4);
    data.writeFloatLE(0.5, 16000 * 4);
    fs.writeFileSync(args.at(-1), data);
  } });
  assert.ok(result.ok);
  assert.equal(result.audioTransientTime, 1);
  assert.equal(soundMix({ time: 2.1, db: -3 }, { db: -2 }, timeline, shot, []).ok, false);
  assert.equal(soundMix({ time: 1, db: -3 }, { db: -2 }, timeline, shot, [], { impact: true }).ok, false, "impact sound still needs a visible contact");
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


test("ambient moving settings need no event while every timed defect and motion floor still vetoes them", async () => {
  const pick = { shows: "mountains", kind: "ambient", scene: "Clouds drifting over mountains", action: "Clouds drift" };
  const prompt = clipCheckPrompt({ seen: "clouds over mountains", frames: [], sheets: [], crops: [], pick, shot: { start: 0, duration: 2 }, groups: [] });
  assert.match(prompt, /No discrete event, payoff or word-fitting event is required/);
  assert.doesNotMatch(prompt, /Meaningful word-fitting subject action must begin/);
  for (const question of Object.values(DEFECT_QUESTIONS)) assert.ok(prompt.includes(question));
  for (const defect of [null, ...Object.keys(DEFECT_QUESTIONS), "frozen", "slow", "swing", "local", "wrong-setting"]) {
    const dir = folder(), checks = structuredClone(pass.checks);
    if (checks[defect]) checks[defect] = { yes: true, time: 0.5, why: "visible defect at this frame" };
    const result = await checkRunwayVideo({ file: "ambient.mp4", dir, shot: { start: 0, duration: 2 }, pick, groups: [], deps: {
      runFn: fakeRun, log: () => {},
      measureMotion: async () => ({ mean: defect === "frozen" ? 0 : defect === "slow" ? 2 : 6, sustained: defect === "slow" ? 2 : 6, local: 0, cameraSpeed: defect === "swing" ? 0.5 : 0, peakTime: 0, regions: [{ time: 0, x: 0.25, y: 0.25, width: 0.5, height: 0.5, change: 6 }] }),
      localClipCheck: async () => ({ ok: defect !== "local", why: "readable text in local check" }),
      claudeLook: async (p) => {
        if (!p.startsWith("Used source")) return '{"seen":"clouds moving over the spoken mountains","contact":null}';
        assert.match(p, /No discrete event/);
        return JSON.stringify({ ...pass, shows: defect !== "wrong-setting", checks, eventType: "continuous", onset: 0, contact: null, completion: null });
      },
    } });
    assert.equal(result.ok, defect === null, `${defect}: ${result.why}`);
    assert.equal(result.unavailable, undefined, `${defect}: ${result.why}`);
  }
});

test("reviewMovingClip keeps ambient kind through both inspections and checks the actual cut", async () => {
  const { reviewMovingClip } = await import("../src/broll-library.mjs");
  const calls = [], dir = folder(), pick = { kind: "ambient", shows: "road", action: "Road passes during the drive" };
  const accepted = await reviewMovingClip({ file: "road.mp4", duration: 6, shot: { start: 10, duration: 1.2 }, pick, groups: [], dir, deps: {
    checkRunwayVideo: async (args) => { calls.push(args); return { ...pass, ok: true, look: "pass", eventType: "continuous", onset: 0, contact: null, completion: null }; },
    trimRunwayClip: async (_file, duration, options) => { assert.equal(duration, 1.2); assert.equal(options.timeline, undefined); return { inPoint: 2, full: "road.full.mp4" }; },
  } });
  assert.ok(accepted); assert.equal(accepted.kind, "ambient");
  assert.equal(calls.length, 2); assert.equal(calls[0].eventOnly, true); assert.equal(calls[1].inPoint, 2);
  assert.ok(calls.every((c) => c.pick.kind === "ambient"));
});

test("moving subject windows prefer measured movement inside the located event and retain landing constraints", () => {
  const motion = { changes: Array.from({ length: 64 }, (_, i) => i >= 32 && i < 48 ? 10 : 0) };
  const timeline = { eventType: "continuous", onset: 0, contact: null, completion: 7 };
  assert.equal(momentInPoint(timeline, 1.2, 8, motion), 4);
  assert.equal(eventInPoint(timeline, 1.2, 8, 0, motion), 4);
  const lateOutsideEvent = { changes: Array.from({ length: 64 }, (_, i) => i > 48 ? 100 : i >= 16 && i < 32 ? 5 : 0) };
  assert.equal(motionWindowInPoint({ ...timeline, onset: 1, completion: 4 }, 1.2, 8, lateOutsideEvent), 2);
  const landing = { eventType: "drop-land", onset: 1, contact: 1.4, completion: 1.6 };
  const start = eventInPoint(landing, 1.2, 8, 0, motion);
  assert.ok(start <= 1 && start + 1.2 >= 1.8, "a later motion peak must not lose the landing event");
});

test("trimRunwayClip measures subject movement before cutting a continuous event", async () => {
  const dir = folder(), file = path.join(dir, "plane.mp4"), cuts = [];
  fs.writeFileSync(file, "plane crossing then empty sky");
  const frames = Array.from({ length: 64 }, (_, i) => Buffer.alloc(4096, i >= 32 && i < 48 ? i % 2 * 30 : 0));
  const trimmed = await trimRunwayClip(file, 1.2, { dir, timeline: { eventType: "continuous", onset: 0, contact: null, completion: 7 }, inPoint: 0, runFn: async (cmd, args) => {
    if (cmd === "ffprobe") return { out: "8" };
    if (args.at(-1).endsWith("frames.gray")) fs.writeFileSync(args.at(-1), Buffer.concat(frames));
    else { cuts.push(args); fs.writeFileSync(args.at(-1), "moving plane interval"); }
  } });
  assert.ok(trimmed.inPoint >= 4 && trimmed.inPoint < 5, `cut at ${trimmed.inPoint}`);
  assert.equal(cuts[0][cuts[0].indexOf("-ss") + 1], String(trimmed.inPoint));
  assert.equal(fs.readFileSync(trimmed.full, "utf8"), "plane crossing then empty sky");
});
