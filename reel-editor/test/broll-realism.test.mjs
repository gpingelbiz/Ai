import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkPick, makeBroll, placeBroll, STILL_PICKS_SCHEMA } from "../src/broll.mjs";
import { brollMatchShifts, finishBrollStill } from "../src/broll-finish.mjs";
import { codexExec, codexModels } from "../src/codex.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { run } from "../src/util.mjs";

const workFolder = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-realism-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const group = (start, ...texts) => ({
  start, end: start + texts.length * 0.4, text: texts.join(" "),
  words: texts.map((text, i) => ({ text, start: start + i * 0.4, end: start + (i + 1) * 0.4 })),
});
const ref = (groups, line, wordIndex) => ({ line, wordIndex, text: groups[line].words[wordIndex].text });
const groups = [
  group(2.1, "They", "hung", "up", "on", "me"),
  group(4.1, "I", "called", "again", "straight", "away"),
  group(6.1, "Here", "is", "what", "I", "changed"),
  group(8.1, "Back", "to", "the", "lot", "again"),
  group(10.1, "Track", "the", "next", "call", "too"),
  group(12.1, "It", "builds", "a", "routine", "fast"),
  group(14.1, "Now", "make", "it", "a", "habit"),
  group(16.1, "See", "you"),
];
const pick = (line, word, camera = "detail-48mm") => ({
  line, anchor: { line, word }, camera, shows: groups[line].words[word].text,
  visibleSubject: "Phone on the desk", scene: "Close phone on a matte desk edge",
  action: "Call ended and the display is idle", light: "Broad window at camera left",
  signsOfUse: ["rubbed case corner", "pencil scuff"], need: "The call visibly ended.",
  endsAt: ref(groups, line, 4), endsBefore: ref(groups, line + 1, 0),
});

test("an anchored action can show a different subject and must point to an exact word", () => {
  const candidate = { ...groups[0], i: 0 };
  const shot = pick(0, 1);
  assert.equal(checkPick(shot, candidate, groups), null);
  assert.match(checkPick({ ...shot, anchor: { line: 0, word: 5 } }, candidate, groups), /anchor/);
  assert.match(checkPick({ ...shot, anchor: { line: 1, word: 1 } }, candidate, groups), /anchor/);
  assert.match(checkPick({ ...shot, scene: "a gun on the desk" }, candidate, groups), /weapon/);
  assert.equal(checkPick({ shows: "hung", scene: "a hung picture" }, candidate, groups), null);
  assert.match(checkPick({ shows: "hung", scene: shot.scene }, candidate, groups), /scene does not contain hung/);
});

test("pro plans at exact words, protects both ends and cards, and draws only two accepted shots", async (t) => {
  const workDir = workFolder(t);
  const settings = loadPreset("pingel-pro").broll;
  const footage = path.join(workDir, "speaker clip.mp4");
  const source = path.join(workDir, "drawn.png");
  const ffmpeg = (...args) => run("ffmpeg", ["-v", "error", "-nostdin", "-y", "-filter_threads", "1", ...args], { capture: true });
  await ffmpeg("-f", "lavfi", "-i", "color=c=0x888179:s=108x192:r=25:d=18", "-c:v", "mpeg4", footage);
  await ffmpeg("-f", "lavfi", "-i", "color=c=0x564d45:s=640x480", "-frames:v", "1", "-update", "1", source);
  // The first caption starts before the intro boundary. Its second word lands exactly on it.
  // 4.1 crosses the card's 0.4 s lead. 8.1 fits but is within 6 s of the first insert's end.
  const picks = [pick(0, 1), pick(1, 0), pick(3, 0), { ...pick(4, 0, "room-24mm"), duration: 2 }, pick(6, 0)];
  const calls = [];
  const deps = {
    hasCodex: () => true, codexPausedUntil: () => 0,
    codexExec: async (prompt, options) => {
      calls.push(options);
      if (options.schema) {
        assert.equal(options.schema, STILL_PICKS_SCHEMA);
        assert.match(prompt, /Return zero to 2 picks/);
        assert.match(prompt, /eligible word indices: \[1,2,3,4\]/);
        return JSON.stringify({ picks });
      }
      assert.equal(options.model, "gpt-6.2-astra");
      assert.equal(options.images.length, 2);
      assert.match(prompt, /Reference frame from the same video: match its light, colour temperature, contrast and texture; do not copy its content\./);
      assert.match(prompt, /Camera: detail-48mm/);
      assert.match(prompt, /Camera: room-24mm/);
      assert.doesNotMatch(prompt, /broll-3\.png/);
      for (const image of options.images) {
        const { out } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", image], { capture: true });
        assert.equal(out.trim(), "540,960");
        fs.copyFileSync(source, path.join(options.cwd, path.basename(image).replace("-reference.png", ".png")));
      }
      return "Saved";
    },
  };
  const args = { workDir, groups, footage, duration: 18, hook: { start: 0, duration: 2.4 }, busy: [{ start: 5.6, duration: 1.9 }], settings, deps };
  const shots = await makeBroll(args);
  assert.deepEqual(shots.map(({ start, duration, camera }) => [start, duration, camera]), [[2.5, 1.6, "detail-48mm"], [10.1, 2, "room-24mm"]]);
  for (const shot of shots) {
    assert.match(shot.file, /-finished\.png$/);
    assert.deepEqual(fs.readFileSync(shot.originalFile), fs.readFileSync(source));
    const { out } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height,sample_aspect_ratio", "-of", "csv=p=0", shot.file], { capture: true });
    assert.equal(out.trim(), "1080,1920,1:1");
  }
  assert.ok(calls[1].images.every((image) => !fs.existsSync(image)));
  assert.deepEqual(await makeBroll(args), shots);
  assert.equal(calls.length, 2);
});

test("the rolling limit permits two starts per 30 seconds and rejects a third", () => {
  const candidates = [3, 12, 22, 34].map((start, i) => ({ start, i, text: "a spoken line" }));
  const picks = candidates.map(({ i: line }) => ({ line, scene: "a visible task" }));
  const shots = placeBroll(picks, candidates, { len: 1.5, gap: 6, max: 4, maxPer30: 2 });
  assert.deepEqual(shots.map((s) => s.start), [3, 12, 34]);
});

test("an intentional zero picks is cached and never triggers a drawing call or retry", async (t) => {
  const workDir = workFolder(t);
  let calls = 0;
  const args = { workDir, groups, duration: 18, settings: loadPreset("pingel-pro").broll, deps: {
    hasCodex: () => true, codexPausedUntil: () => 0,
    codexExec: async (_prompt, { schema }) => {
      assert.equal(schema, STILL_PICKS_SCHEMA);
      calls++;
      return '{"picks":[]}';
    },
  } };
  assert.deepEqual(await makeBroll(args), []);
  assert.deepEqual(await makeBroll(args), []);
  assert.equal(calls, 1);
  assert.match(fs.readFileSync(path.join(workDir, "No b-roll this time.txt"), "utf8"), /helped the lesson/);
  await makeBroll({ ...args, force: true });
  assert.equal(calls, 2);
});

test("Codex forwards each image and applies the environment override only when set", async (t) => {
  const cwd = workFolder(t);
  const bin = path.join(cwd, "fake-codex.cjs");
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify(args));
`, { mode: 0o755 });
  for (const [name, value] of Object.entries({ REEL_CODEX_BIN: bin, REEL_CODEX_COOLDOWN_FILE: path.join(cwd, "cooldown"), REEL_CODEX_MODEL: "" })) {
    const old = process.env[name];
    process.env[name] = value;
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
  const images = ["ref 1.png", "ref 2.png"].map((f) => path.join(cwd, f));
  const invoke = async () => JSON.parse(await codexExec("Make the still", { cwd, model: "gpt-6.2-astra", images }));
  const args = await invoke();
  assert.deepEqual(args.slice(-6), ["--image", images[0], "--image", images[1], "--", "Make the still"]);
  assert.equal(args[args.indexOf("-m") + 1], "gpt-6.2-astra");
  assert.equal(codexModels({})[0], null, "a drawing model must not become the default for text jobs");
  process.env.REEL_CODEX_MODEL = "override";
  const overridden = await invoke();
  assert.equal(overridden[overridden.indexOf("-m") + 1], "override");
});

test("finish uses bounded limited-range shifts, two speaker windows and a fixed luma finish", async (t) => {
  const dir = workFolder(t);
  const file = path.join(dir, "broll-1.png");
  fs.writeFileSync(file, "original");
  assert.deepEqual(brollMatchShifts({ Y: 50, U: 150, V: 128 }, { Y: 200, U: 100, V: 140 }), { Y: 17, U: -3, V: 3 });
  assert.deepEqual(brollMatchShifts({ Y: 100, U: 128, V: 128 }, { Y: 110, U: 131, V: 125 }), { Y: 4, U: 2, V: -2 });
  assert.equal(brollMatchShifts({ Y: 220, U: 128, V: 128 }, { Y: 55, U: 128, V: 128 }).Y, -17);
  const calls = [], logs = [], warnings = [];
  const sample = (Y, U, V) => ({ out: `lavfi.signalstats.YAVG=${Y}\nlavfi.signalstats.UAVG=${U}\nlavfi.signalstats.VAVG=${V}\n` });
  const finished = await finishBrollStill({ file, footage: "speaker.mp4", start: 5, duration: 1.5 }, {
    logFn: (line) => logs.push(line), warnFn: (line) => warnings.push(line),
    runFn: async (cmd, args) => {
      assert.equal(cmd, "ffmpeg");
      calls.push(args);
      if (calls.length === 1) return sample(50, 150, 128);
      if (calls.length <= 3) return sample(200, 100, 140);
      if (calls.length === 4) fs.writeFileSync(args.at(-1), "finished");
      return sample(67, 147, 131);
    },
  });
  const filter = (i) => calls[i][calls[i].indexOf("-vf") + 1];
  assert.match(filter(0), /scale=1080:1920:force_original_aspect_ratio=increase.*flags=bicubic.*crop=1080:1920,setsar=1,signalstats/);
  assert.deepEqual([calls[1].slice(7, 11), calls[2].slice(7, 11)], [["-ss", "4.640000", "-t", "0.24"], ["-ss", "6.620000", "-t", "0.24"]]);
  assert.match(filter(3), /lutyuv=y='clip\(val\+\(17\),16,235\)':u='clip\(val\+\(-3\),16,240\)':v='clip\(val\+\(3\),16,240\)'/);
  assert.match(filter(3), /eq=contrast=0.98:saturation=0.92:gamma=1.01,gblur=sigma=0.55,noise=c0s=3:c0f=t\+u:c0_seed=217/);
  assert.doesNotMatch(filter(3), /vignette|1080|1920/);
  assert.match(logs[0], /before Y=50.00 U=150.00 V=128.00.*after Y=67.00 U=147.00 V=131.00/);
  assert.deepEqual(warnings, []);
  assert.equal(finished, path.join(dir, "broll-1-finished.png"));
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  const fallback = await finishBrollStill({ file, footage: "speaker.mp4", start: 5, duration: 1.5 }, {
    warnFn: (line) => warnings.push(line),
    runFn: async () => { throw new Error("decode failed"); },
  });
  assert.equal(fallback, file);
  assert.match(warnings[0], /using original.*decode failed/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["broll-1-finished.png", "broll-1.png"]);
});

test("the pro preset uses hard full-frame cuts and exact camera-specific motion", () => {
  const style = loadPreset("pingel-pro");
  const settings = { stillModel: "gpt-6.2-astra", duration: 1.6, minDuration: 1.4, maxDuration: 2.0, minOneAfter: 20, gap: 6,
    clearStart: 2.5, tail: 3, cardClear: 0.4, layout: "full", hold: 0, focusPull: 0, cut: "hard", max: 2, maxWithGraphics: 2 };
  for (const [key, value] of Object.entries(settings)) assert.equal(style.broll[key], value, key);
  const broll = ["room-24mm", "detail-48mm", "detail-48mm"].map((camera, i) => ({
    camera, start: 4 + 8 * i, duration: 1.5, src: `test-${i}.${i === 2 ? "mp4" : "png"}`, video: i === 2,
  }));
  const html = renderHTML({ preset: "pingel-pro", canvas: { width: 1080, height: 1920 }, video: { duration: 24 }, style, broll }, "footage.mp4");
  const plan = JSON.parse(html.match(/const PLAN = (.+);/)[1]);
  assert.deepEqual(plan.broll.map((b) => b.stillMove), [
    [{ scale: 1.0, x: 0 }, { scale: 1.035, x: 6, ease: "none" }],
    [{ scale: 1.015, x: 0 }, { scale: 1.03, x: 0, ease: "none" }],
    undefined,
  ]);
  assert.equal(plan.focusPull, 0);
  assert.equal(plan.brollCut, "hard");
  assert.match(html, /b.stillMove \? b.duration/);
  assert.match(html, /tl.set\(el, \{ opacity: 1 \}, b.start\)[\s\S]*?tl.set\(el, \{ opacity: 0 \}, bEnd\)/);
});

test("Greg 11-24: reels of 20 s or more ask for at least one insert, and stills never draw handwriting", async () => {
  const { picksPrompt, codexStillInstructions } = await import("../src/broll.mjs");
  const base = { candidates: [], groups: [], transcript: "", count: 2 };
  assert.match(picksPrompt({ ...base, minPicks: 1 }), /Return 1 to 2 picks/);
  assert.match(picksPrompt({ ...base, minPicks: 1 }), /at least one insert/);
  assert.match(picksPrompt(base), /Return zero to 2 picks/);
  assert.match(codexStillInstructions({}), /Never draw handwriting/);
  const style = loadPreset("pingel-pro");
  assert.equal(style.broll.minOneAfter, 20);
});

test("Greg 11-24: a subject already in 2 of the last 12 scenes is rejected, others pass", async () => {
  const { repeatedMotif, picksPrompt } = await import("../src/broll.mjs");
  const recent = ["open notebook with checkmarks on a desk", "headset beside a notebook checklist", "laptop on a desk"];
  assert.equal(repeatedMotif({ visibleSubject: "a spiral notebook", scene: "pen over a checklist" }, recent), "notebook");
  assert.equal(repeatedMotif({ visibleSubject: "a laptop on a muted call" }, recent), null);
  assert.equal(repeatedMotif({ visibleSubject: "car keys on a kitchen counter" }, recent), null);
  assert.match(picksPrompt({ candidates: [], groups: [], transcript: "", count: 2, recent }), /Do NOT repeat their main subject/);
});
