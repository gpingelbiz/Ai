import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { subjectMotion, landingMotion, QC_MEASUREMENTS, DEFECT_QUESTIONS } from "../src/broll-qc.mjs";
import { checkRunwayVideo, measureLanding } from "../src/broll-runway.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "broll-measurements-"));
process.env.REEL_CACHE = root;
process.env.REEL_BROLL_RECENT = path.join(root, "recent.json");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const clear = { shows: true, action: true, dark: false, physicsPlausible: true, identityStable: true, artifacts: false, directionPlausible: true, humanFaces: false, readableText: false, eventType: "continuous", onset: 0, contact: null, completion: null, checks: Object.fromEntries(Object.keys(DEFECT_QUESTIONS).map((key) => [key, { yes: false, time: null, why: "compared; absent" }])), defects: [], why: "fits the words" };
const drop = { ...clear, eventType: "drop-land", contact: 0.7, completion: 1.3 };
const noCollar = { collar: false, objectPosition: "on the surface", why: "material disperses" };
const collar = { collar: true, objectPosition: "inside a fixed bright band", why: "band hugs the base" };
const moving = { mean: 5, sustained: 5, local: 15, cameraSpeed: 0, approachGrowth: 0, peakTime: 0.5, regions: [{ time: 0.5, change: 5, x: 0.25, y: 0.25, width: 0.5, height: 0.5 }] };
const fixture = (options = {}) => {
  const dir = fs.mkdtempSync(path.join(root, "case-")), prompts = [];
  const deps = {
    log: () => {},
    measureMotion: async () => moving,
    measureLanding: async () => ({ available: true, spray: false }),
    localClipCheck: async () => ({ ok: true }),
    runFn: async (cmd, args) => {
      if (cmd === "ffprobe") return { out: JSON.stringify({ frames: Array.from({ length: 60 }, (_, i) => ({ best_effort_timestamp_time: i / 30 })) }) };
      fs.writeFileSync(args.at(-1), "frame");
    },
    claudeLook: async (prompt) => {
      prompts.push(prompt);
      return JSON.stringify(prompt.startsWith("Used source") ? clear : { seen: "a moving subject", contact: null });
    },
    ...options.deps,
  };
  return { dir, prompts, run: () => checkRunwayVideo({ file: "unlabelled.mp4", shot: { start: 0, duration: 1.6 }, groups: [], pick: {}, dir, ...options, deps }) };
};

const texture = (x, y) => (x * 73 + y * 41 + x * y * 3) % 256;

test("sustained motion trims a single flash and localized motion retains a small moving subject", () => {
  const flash = Array.from({ length: 25 }, (_, i) => Buffer.alloc(4096, i === 12 ? 255 : 0));
  const outlier = subjectMotion(Buffer.concat(flash));
  assert.ok(outlier.mean > 10);
  assert.equal(outlier.sustained, 0);
  assert.equal(outlier.local, 0, "a flash cannot qualify through the local activity gate");
  const small = Array.from({ length: 16 }, (_, f) => {
    const frame = Buffer.alloc(4096, 80);
    for (let y = 20; y < 36; y++) for (let x = 22; x < 38; x++) frame[y * 64 + x] = f % 2 ? 110 : 80;
    return frame;
  });
  const motion = subjectMotion(Buffer.concat(small));
  assert.ok(motion.sustained < 3);
  assert.ok(motion.local > QC_MEASUREMENTS.localMinMotion);
});

test("outer background registration measures sustained camera speed without following a large central subject", () => {
  const frames = Array.from({ length: 8 }, (_, f) => {
    const frame = Buffer.alloc(4096);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      frame[y * 64 + x] = texture((x - f * 2 + 64) % 64, y);
      if (x > 17 && x < 47 && y > 18 && y < 58) frame[y * 64 + x] = texture(x + f, y + 17);
    }
    return frame;
  });
  const motion = subjectMotion(Buffer.concat(frames));
  assert.ok(motion.shifts.every((s) => s.x === 2 && s.y === 0));
  assert.equal(motion.cameraSpeed, 0.25);
  assert.ok(motion.mean > 3, "subject continues moving after registration");
  const single = subjectMotion(Buffer.concat([frames[0], frames[1], ...Array(7).fill(frames[1])]));
  assert.equal(single.cameraSpeed, 0, "one jitter frame cannot establish a sustained pan");
});

test("feature separation estimates subject growth while a translation does not grow the subject", () => {
  const expand = Array.from({ length: 8 }, (_, f) => {
    const frame = Buffer.alloc(4096, 80);
    for (const [start, direction] of [[16, -1], [36, 1]]) for (let y = 19; y < 53; y++) for (let u = 0; u < 14; u++) {
      const x = start + direction * f + u;
      if (x >= 0 && x < 64) frame[y * 64 + x] = (u * 61 + y * 79) % 256;
    }
    return frame;
  });
  const growth = subjectMotion(Buffer.concat(expand));
  assert.ok(growth.approachGrowth > 0.25);
  assert.equal(growth.cameraSpeed, 0);
  const pan = Array.from({ length: 8 }, (_, f) => Buffer.from(Array.from({ length: 4096 }, (_, i) => texture((i % 64 - f + 64) % 64, Math.floor(i / 64)))));
  assert.equal(subjectMotion(Buffer.concat(pan)).approachGrowth, 0);
});

function surfaceFrames(directional) {
  const width = 100, height = 120, fps = 20, contact = 0.5, point = { x: 0.5, y: 0.7 };
  const frames = Array.from({ length: 24 }, (_, f) => {
    const frame = Buffer.alloc(width * height, 220);
    if (f >= contact * fps) {
      const drift = directional ? (f - contact * fps) * 4 : 0;
      for (let y = 79; y < 94; y++) for (let x = 0; x < width; x++) {
        const distance = directional ? Math.hypot(x - 40 - drift, y - 87) : Math.abs(Math.hypot(x - 50, y - 84) - 12);
        if (distance < (directional ? 8 : 2)) frame[y * width + x] = 250;
      }
    }
    return frame;
  });
  return { pixels: Buffer.concat(frames), options: { width, height, fps, contact, point } };
}

test("surface differences separate a directional outward spray from a symmetric stationary band", () => {
  for (const directional of [true, false]) {
    const { pixels, options } = surfaceFrames(directional), measured = landingMotion(pixels, options);
    assert.equal(measured.available, true);
    assert.equal(measured.spray, directional, JSON.stringify(measured));
    if (directional) assert.ok(measured.drift > 0.25 && measured.expansion > 0.025);
    else { assert.equal(measured.drift, 0); assert.ok(measured.symmetry > 0.8); }
    const atEnd = landingMotion(pixels, { ...options, contact: 1.15 });
    assert.equal(atEnd.available, false);
    assert.equal(atEnd.spray, false, "missing after-contact pixels cannot prove a spray");
  }
  assert.throws(() => landingMotion(Buffer.alloc(7), { contact: 1, point: { x: 0.5, y: 0.5 } }), /complete landing samples/);
  assert.throws(() => landingMotion(Buffer.alloc(180 * 320 * 2), { contact: 1, point: { x: -1, y: 0 } }), /location/);
});

test("landing decode uses a fixed portrait window and removes raw samples on success and failure", async () => {
  const dir = fs.mkdtempSync(path.join(root, "decode-"));
  const { pixels, options } = surfaceFrames(true);
  // Decode uses the production size; content need not establish a spray in this IO test.
  const result = await measureLanding("clip.mp4", 1.6, { dir, contact: options.contact, point: options.point, runFn: async (cmd, args) => {
    assert.equal(cmd, "ffmpeg");
    assert.match(args[args.indexOf("-vf") + 1], /setpts=PTS-STARTPTS,fps=24:start_time=0:round=near,trim=duration=1.6,scale=180:320/);
    fs.writeFileSync(args.at(-1), Buffer.alloc(180 * 320 * 38, pixels[0]));
  } });
  assert.equal(result.available, true);
  assert.deepEqual(fs.readdirSync(dir), []);
  await assert.rejects(measureLanding("clip.mp4", 1.6, { dir, runFn: async (_cmd, args) => { fs.writeFileSync(args.at(-1), "partial"); throw new Error("decode failed"); } }), /decode failed/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("continuous gates use robust local activity, sustained camera speed and size growth with configurable limits", async () => {
  for (const [stats, qcMeasurements, expected, reason] of [
    [{ mean: 2.7, sustained: 2.7, local: 16 }, {}, true],
    [{ mean: 2.4, sustained: 2.3, local: 9.8 }, {}, false, /continuous action motion/],
    [{ mean: 2.7, sustained: 2.7, local: 16 }, { localMinMotion: 20 }, false, /continuous action motion/],
    [{ cameraSpeed: 0.28 }, {}, false, /sustained camera movement/],
    [{ cameraSpeed: 0.28 }, { maxCameraSpeed: 0.3 }, true],
    [{ approachGrowth: 1 }, {}, false, /rapid subject size growth/],
    [{ approachGrowth: 1 }, { maxApproachGrowth: 1.1 }, true],
  ]) {
    const f = fixture({ qcMeasurements, deps: { measureMotion: async () => ({ ...moving, ...stats }) } });
    const result = await f.run();
    assert.equal(result.ok, expected, result.why);
    if (reason) assert.match(result.why, reason);
  }
  const invalid = await fixture({ qcMeasurements: { maxCameraSpeed: NaN } }).run();
  assert.equal(invalid.unavailable, true);
});

test("measured outward spray bypasses texture guesses and is saved, while other defects still veto", async () => {
  for (const unsafe of [false, true]) {
    const f = fixture({ deps: {
      measureLanding: async () => ({ available: true, spray: true, drift: 0.35, expansion: 0.07 }),
      claudeLook: async (prompt) => {
        assert.ok(!prompt.startsWith("Inspect the landing"), "measured spray does not need a collar guess");
        return JSON.stringify(prompt.startsWith("Used source") ? { ...drop, dark: unsafe } : { seen: "a subject drops", contact: 0.7, contactPoint: { x: 0.5, y: 0.8 } });
      },
    } });
    const result = await f.run();
    assert.equal(result.ok, !unsafe, result.why);
    if (!unsafe) {
      assert.equal(result.landing.measured, true);
      const saved = JSON.parse(fs.readFileSync(path.join(path.dirname(result.sheet), "verdict.json")));
      assert.deepEqual(saved.surface, result.surface);
    } else assert.match(result.why, /unsafe association/);
  }
});

test("ambiguous landings require two agreeing inspections and preserve all votes", async () => {
  for (const votes of [[false, false], [true, true], [false, true, true], [true, false, false]]) {
    let calls = 0;
    const result = await fixture({ deps: { claudeLook: async (prompt) => JSON.stringify(prompt.startsWith("Used source") ? drop : prompt.startsWith("Inspect the landing") ? votes[calls++] ? collar : noCollar : { seen: "a subject lands", contact: 0.7, contactPoint: { x: 0.5, y: 0.8 } }) } }).run();
    assert.equal(calls, votes.length);
    assert.equal(result.landing.reviews.length, votes.length);
    assert.equal(result.ok, votes.filter(Boolean).length < 2, result.why);
  }
});

test("an unsupported artifact bit is reinspected once; persistent contradictions fail closed", async () => {
  for (const persist of [false, true]) {
    let calls = 0;
    const f = fixture({ deps: { claudeLook: async (prompt) => {
      if (!prompt.startsWith("Used source")) return JSON.stringify({ seen: "the subject moves", contact: null });
      calls++;
      if (calls === 2) assert.match(prompt, /contradictory.*Reinspect/);
      return JSON.stringify({ ...clear, artifacts: persist || calls === 1 });
    } } });
    const result = await f.run();
    assert.equal(calls, 2);
    assert.equal(result.ok, !persist);
    assert.equal(result.unavailable, persist || undefined);
  }
});
