import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readRecent, rememberScenes } from "../src/broll.mjs";
import { makeClips, sliceWords } from "../src/clips.mjs";
import { masterPlanningRules, refreshMasterCaption, runMasterCheck } from "../src/master-check.mjs";
import { buildProject, runEdit } from "../src/pipeline.mjs";
import { loadPreset } from "../src/presets.mjs";
import { probe } from "../src/probe.mjs";
import { cleanEdges, snapClipWindows } from "../src/reel-edges.mjs";
import { readJSON, run, writeJSON } from "../src/util.mjs";

let root, normal, bright, dark, black;
const silent = { items: [], measures: { duration: 3 } };
const faceNone = async (_file, times) => ({ frames: times.map((t) => ({ t, faces: [] })) });
const normalLuma = async () => ({ spikes: [] });
const deps = { detectFaces: faceNone, measureFlash: normalLuma, runPreflight: async () => silent };
const speech = (text, start = 0, interval = 0.2) => text.split(" ").map((word, i) => ({ text: word, start: start + i * interval, end: start + i * interval + interval / 2 }));
const get = (r, id) => r.rules.find((rule) => rule.id === id);
const card = (id, start = 1.5, place = { x: 100, y: 900, w: 720, h: 112 }, extra = {}) => ({
  id, start, duration: 0.8, place, type: "label", phrases: [{ text: "A sales point" }], ...extra,
});

async function clip(file, color, filter, duration = 3, audio = false) {
  const inputs = ["-f", "lavfi", "-i", `color=c=${color}:s=90x160:r=30:d=${duration}`];
  if (audio) inputs.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...inputs, ...(filter ? ["-vf", filter] : []), "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac"] : []), file], { capture: true });
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "master-check-"));
  normal = path.join(root, "normal.mp4"); bright = path.join(root, "bright.mp4"); dark = path.join(root, "dark.mp4"); black = path.join(root, "black.mp4");
  await Promise.all([
    clip(normal, "gray", null, 3, true),
    clip(bright, "gray", "drawbox=c=white:t=fill:enable='lt(n,9)'", 3, true),
    clip(dark, "gray", "drawbox=c=black:t=fill:enable='lt(n,3)'"),
    clip(black, "black", "drawbox=c=gray:t=fill:enable='gte(n,15)'"),
  ]);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture(overrides = {}, video = normal) {
  const dir = fs.mkdtempSync(path.join(root, "job-"));
  const plan = {
    name: "reel", canvas: { width: 1080, height: 1920 }, preset: "clean",
    video: { src: normal, width: 90, height: 160, duration: 3, fps: 30 },
    words: speech("Practice this once."),
    ...overrides,
  };
  const output = path.join(dir, "renders", "reel.mp4");
  fs.mkdirSync(path.dirname(output));
  fs.copyFileSync(video, output);
  writeJSON(path.join(dir, "plan.json"), plan);
  return { dir, plan, output };
}

test("caption and pro card checks sample the final render at 0.5s and respect the plate threshold, face eyes and hook hold", async () => {
  const { dir, output } = fixture({
    preset: "pingel-pro",
    captions: [{ text: "Practice this now", start: 0.45, end: 1.45, y: 1248, lines: [1, 2] }],
    proGraphics: [card("practice", 1.5)],
    hook: { text: "Practice makes the difference", start: 0, duration: 0.4 },
  });
  const box = (x, y, w, h, eyesY = y) => ({ x: x / 1080, y: y / 1920, w: w / 1080, h: h / 1920, eyesY: eyesY / 1920 });
  const byTime = {
    0: [box(190, 189, 100, 100)],
    0.5: [box(126, 1230, 40, 55), box(190, 189, 100, 100)],
    1: [box(350, 1220, 200, 180, 1280)],
    1.5: [box(400, 920, 100, 100)],
    2: [box(400, 820, 100, 100, 920)],
  };
  const result = await runMasterCheck(dir, { deps: { ...deps, detectFaces: async (file, times, options) => {
    assert.equal(file, output);
    assert.equal(options.landmarks, true);
    assert.deepEqual(times, [0, 0.5, 1, 1.5, 2, 2.5]);
    return { frames: times.map((t) => ({ t, faces: byTime[t] || [] })) };
  } } });
  assert.equal(result.status, "fail");
  assert.match(get(result, "captions-off-face").detail, /Caption 1 .*1\.00s/);
  assert.doesNotMatch(get(result, "captions-off-face").detail, /0\.50s/);
  assert.match(get(result, "cards-off-face").detail, /Hook .*0\.00s/);
  assert.match(get(result, "cards-off-face").detail, /Card practice .*1\.50s/);
  assert.doesNotMatch(get(result, "cards-off-face").detail, /0\.50s|2\.00s/);
  assert.deepEqual(readJSON(path.join(dir, "master-check.json")), result);
  assert.match(fs.readFileSync(path.join(dir, "master-check.txt"), "utf8"), /Master check FAIL/);
});

test("unavailable samples fail the affected face rule while a sampled frame with zero faces passes", async () => {
  const { dir } = fixture({ captions: [{ text: "Practice", start: 0, end: 1, y: 1248 }] });
  const good = await runMasterCheck(dir, { deps });
  assert.equal(get(good, "captions-off-face").ok, true);
  const bad = await runMasterCheck(dir, { deps: { ...deps, detectFaces: async () => null } });
  assert.match(get(bad, "captions-off-face").detail, /unavailable at 0\.00s, 0\.50s/);
  assert.equal(get(bad, "cards-off-face").ok, true);
});

test("pro floors start at 15 and 20 seconds, word marks do not count, and full-screen holds are capped at one", async () => {
  const pro = { preset: "pro", style: { broll: { enabled: true } }, proGraphics: [card("one"), { type: "wordMark" }] };
  const status = (plan, duration) => masterPlanningRules(plan, duration).map(({ ok }) => ok);
  assert.deepEqual(status(pro, 14.99), [true, true, true]);
  assert.deepEqual(status(pro, 15), [false, true, true]);
  assert.deepEqual(status(pro, 20), [false, false, true]);
  assert.deepEqual(status({ ...pro, style: { broll: { enabled: false } } }, 20), [false, true, true]);
  assert.deepEqual(status({ ...pro, preset: "clean" }, 20), [true, true, true]);
  const proGraphics = [card("one", 1, null, { fullscreen: true }), card("two", 2, null, { fullscreen: true })];
  const { dir } = fixture({ ...pro, proGraphics });
  const result = await runMasterCheck(dir, { deps });
  assert.equal(get(result, "full-screen-max").severity, "block");
  assert.match(get(result, "full-screen-max").detail, /1\.00s, 2\.00s/);
  assert.equal(result.status, "fail");
});

test("recent B-roll motif warnings exclude this reel and keep another reel's copy of the same scene", async () => {
  const broll = [{ start: 1, scene: "a notebook on a table", pick: { visibleSubject: "notepad" } }];
  const { dir } = fixture({ broll });
  const history = path.join(dir, "recent.json");
  const check = () => runMasterCheck(dir, { deps: { ...deps, readRecent: (_file, options) => readRecent(history, options) } });
  rememberScenes(["notebook and coffee"], history, 24, path.join(root, "old"));
  rememberScenes([broll[0].scene, "an open notebook"], history, 24, dir);
  assert.equal(get(await check(), "broll-no-repeat").ok, true);
  rememberScenes([broll[0].scene], history, 24, path.join(root, "older"));
  const result = await check();
  assert.match(get(result, "broll-no-repeat").detail, /1\.00s.*notebook/);
  assert.equal(result.status, "pass");
  writeJSON(history, { scenes: ["notebook and coffee", broll[0].scene] });
  assert.equal(get(await check(), "broll-no-repeat").ok, true);
});

test("clean edges report the exact words and use block severity only for clips from a long source", async () => {
  const words = speech("and then we", 1.9);
  const { dir, plan } = fixture({ words });
  const plain = await runMasterCheck(dir, { deps });
  assert.equal(plain.status, "pass");
  assert.match(get(plain, "clean-edges").detail, /"and".*"we"/s);
  assert.equal(get(plain, "clean-edges").severity, "warn");
  writeJSON(path.join(dir, "plan.json"), { ...plan, clipSource: { input: "training.mp4" } });
  const cut = await runMasterCheck(dir, { deps });
  assert.equal(cut.status, "fail");
  assert.equal(get(cut, "clean-edges").severity, "block");
  assert.equal(cleanEdges(speech("So I tried it"), 1.2).ok, true);
  assert.equal(cleanEdges(speech("um I tried it."), 1.2).ok, false);
  assert.equal(cleanEdges(speech("What happened?”"), 0.31).ok, true);
});

test("clips snap cached windows to a whole sentence and can end on a half-second pause", async () => {
  const words = [
    ...speech("Earlier words.", 0),
    ...speech("Practice carefully.", 4),
    ...speech("Repeat once", 15),
    ...speech("Another point.", 40),
  ];
  const snapped = snapClipWindows([{ start: 4.3, end: 15.1 }], words, 45, { min: 1 });
  assert.deepEqual(snapped.map(({ start, end }) => [start, end]), [[3.75, 15.8]]);
  assert.equal(cleanEdges(sliceWords(words, snapped[0].start, snapped[0].end), snapped[0].end - snapped[0].start).ok, true);
  const work = path.join(root, "clips");
  const long = path.join(root, "long.mp4");
  await clip(long, "gray", null, 45);
  writeJSON(path.join(work, "words.json"), { words });
  writeJSON(path.join(work, "clips.json"), { clips: [{ start: 4.3, end: 15.1, hook: "Practice" }] });
  const result = await makeClips(long, { out: work, planOnly: true, preset: "clean" });
  for (const c of result.clips) {
    assert.equal(c.snapped, true);
    assert.equal(cleanEdges(sliceWords(words, c.start, c.end), c.end - c.start).ok, true);
  }
  assert.equal(result.clips.length, 1);
});

test("FFmpeg flags bright and dark opening flashes and --fix trims through the first normal frame with audio", async () => {
  const original = fixture({}, bright);
  const args = ["bin/reel.mjs", "check", original.dir];
  const check = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stdout, /FAIL  no-flash/);
  assert.equal((await probe(original.output)).duration, 3);
  const fixed = spawnSync(process.execPath, [...args, "--fix"], { encoding: "utf8" });
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /FIXED  no-flash/);
  assert.match(fixed.stdout, /Trimmed 0\.30s/);
  const meta = await probe(original.output);
  assert.ok(Math.abs(meta.duration - 2.7) < 0.04);
  assert.equal(meta.hasAudio, true);
  const recheck = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(recheck.status, 0, recheck.stderr);
  assert.match(recheck.stdout, /Master check PASS/);
  assert.equal(readJSON(path.join(original.dir, "plan.json")).masterTrim, 0.3);
  const darker = fixture({}, dark);
  const report = await runMasterCheck(darker.dir);
  assert.match(get(report, "no-flash").detail, /Frame 1 .*luma 16/);
});

test("card and caption artifacts block checks and repair nested card copy, line wrapping and timed words", async () => {
  const captions = [{ start: 0, end: 1.5, y: 1248, lines: [4, 2], words: speech("Re - loop , the the"), text: "Re - loop , the the" }];
  const graphics = [{ type: "quote", text: "RIGHT", start: 1.5, duration: 0.5 },
    { type: "list", items: [{ text: "Use the the loop ; then ask !" }], start: 2, duration: 0.5 }];
  const { dir, plan } = fixture({ captions, graphics });
  const bad = await runMasterCheck(dir, { deps });
  assert.equal(bad.status, "fail");
  assert.match(get(bad, "card-text-clean").detail, /RIGHT.*Use the the loop.*Re - loop/s);
  assert.deepEqual(readJSON(path.join(dir, "plan.json")), plan);
  let builds = 0;
  const fixed = await runMasterCheck(dir, { fix: true, deps, rebuild: async (next) => {
    builds++;
    writeJSON(path.join(dir, "plan.json"), next);
  } });
  assert.equal(fixed.status, "fixed");
  assert.equal(get(fixed, "card-text-clean").fixed, true);
  assert.equal(builds, 1);
  const repaired = readJSON(path.join(dir, "plan.json"));
  assert.deepEqual(repaired.captions[0].lines, [1, 1]);
  assert.deepEqual(repaired.captions[0].words.map((w) => w.text), ["Re-loop,", "the"]);
  assert.equal(repaired.graphics.length, 1);
  assert.equal(repaired.graphics[0].items[0].text, "Use the loop; then ask!");
  assert.deepEqual(repaired.words, plan.words);
});

test("banned words report each surface and privacy warnings report named details at their spoken timestamps", async () => {
  const words = speech("My wife and kids fly to New York tonight near Thanksgiving.", 0, 0.23);
  const { dir } = fixture({
    words, captions: [{ text: "Comment GHOST", start: 0, end: 1 }],
    hook: { text: "Ghost P&L", duration: 2 }, graphics: [card("spouse", 1, null, { text: "wife" })],
  });
  writeJSON(path.join(dir, "caption.json"), { caption: "Reply with the word GHOST", hooks: [{ text: "Unused idea" }] });
  fs.writeFileSync(path.join(dir, "caption.txt"), "I said Ghost P&L.");
  const result = await runMasterCheck(dir, { deps });
  assert.equal(result.status, "fail");
  assert.match(get(result, "banned-words").detail, /Spoken transcript.*0\.23s.*Caption 1.*Hook.*Card.*caption\.json.*caption\.txt/s);
  const privacy = get(result, "private-details");
  assert.equal(privacy.severity, "warn");
  assert.match(privacy.detail, /"wife" at 0\.23s.*"kids" at 0\.69s.*"fly to New York" at 0\.92s.*"tonight".*"Thanksgiving"/s);
  const plain = fixture({ words: speech("There is a ghost.").concat(speech("Flight Friday this morning and Christmas.", 1)) });
  const original = await runMasterCheck(plain.dir, { deps });
  assert.equal(original.status, "pass");
  assert.equal(get(original, "private-details").ok, false);
  const captionFile = path.join(plain.dir, "late-caption.txt");
  fs.writeFileSync(captionFile, "Caption mentions my wife.");
  assert.equal(refreshMasterCaption(plain.dir, captionFile).status, "fail");
});

test("existing preflight folds loudness, fast captions, black open and pairwise overlaps into master severity", async () => {
  const { dir } = fixture({
    preset: "pingel-pro", captions: [{ text: "A long caption flits past in a fraction of a second", start: 1.6, end: 1.7, y: 1248 }],
    proGraphics: [
      card("hook-card", 0, { x: 140, y: 179, w: 720, h: 112 }),
      card("caption-card", 1.5, { x: 150, y: 1249, w: 720, h: 112 }),
      card("another-card", 1.5, { x: 153, y: 1251, w: 720, h: 112 }),
    ], hook: { text: "A practice plan works", duration: 0.8 },
  }, black);
  const result = await runMasterCheck(dir, { deps: { detectFaces: faceNone } });
  assert.equal(get(result, "fast-captions").ok, false);
  assert.equal(get(result, "fast-captions").severity, "warn");
  assert.equal(get(result, "black-open").ok, false);
  assert.equal(get(result, "black-open").severity, "block");
  assert.match(get(result, "overlaps").detail, /the hook and card hook-card.*caption 1 and card caption-card.*card caption-card and card another-card/s);
  const audio = fixture();
  const audioReport = await runMasterCheck(audio.dir);
  assert.equal(audioReport.status, "pass");
  assert.equal(get(audioReport, "loudness").ok, false);
  assert.equal(get(audioReport, "loudness").severity, "warn");
});

test("edit and build gate the final render after preflight, leave a failed file, and retry both planning floors once", async (t) => {
  const work = path.join(root, "edit");
  const transcript = path.join(root, "words.json");
  writeJSON(transcript, { source: normal, words: speech("You have a wife.") });
  const steps = [];
  const adapters = {
    ...deps,
    render: async (_project, output) => { steps.push("render"); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(normal, output); },
    runTextcheck: async () => ({ verdict: "ok", notes: [] }),
    runPreflight: async () => { steps.push("preflight"); return { ...silent, status: "ok" }; },
    detectFaces: async (file, times) => { if (file.includes("/renders/")) steps.push("faces"); return faceNone(file, times); },
  };
  const info = t.mock.method(console, "log", () => {});
  const edited = await runEdit(normal, { out: work, preset: "clean", transcript, noGate: true, noHook: true, noCuts: true, noReview: true, noZooms: true, noSounds: true }, adapters);
  assert.deepEqual(steps, ["render", "preflight", "faces"]);
  assert.ok(fs.existsSync(edited.output));
  assert.equal(readJSON(path.join(work, "master-check.json")).status, "fail");
  assert.ok(info.mock.calls.some(({ arguments: args }) => args.join(" ") === "[reel] MASTER CHECK FAILED: banned-words"));

  const floor = fixture({
    preset: "pro", style: { ...loadPreset("clean"), broll: { enabled: true, layout: "full" } },
    captions: [], audio: { tracks: [] }, video: { ...edited.plan.video, src: normal, hasAudio: false, duration: 20 },
  });
  const attempts = [];
  const built = await buildProject(floor.dir, { noGate: true, noReview: true, noPreflight: true }, {
    ...adapters,
    runPreflight: async () => ({ items: [], measures: { duration: 20 } }),
    replanMaster: async (_workDir, plan, ids) => {
      attempts.push(ids);
      return { ...plan, proGraphics: [card("new-1")], broll: [{ start: 5, duration: 1, file: normal, scene: "street" }] };
    },
  });
  assert.deepEqual(attempts, [["card-floor", "broll-present"]]);
  assert.ok(fs.existsSync(built.output));
  const report = readJSON(path.join(floor.dir, "master-check.json"));
  assert.equal(report.status, "fail");
  assert.equal(get(report, "broll-present").fixed, true);
  assert.match(get(report, "card-floor").detail, /Replanned once/);
});

test("build repairs a pro plan by forcing fresh card direction and B-roll picks through the planners", async () => {
  const words = speech("Set the sales target.", 4).concat(speech("Review your calls daily.", 11));
  const captions = [words.slice(0, 4), words.slice(4)].map((group) => ({ words: group, text: group.map((w) => w.text).join(" "), start: group[0].start, end: group.at(-1).end, lines: [4], y: 1248 }));
  const preset = loadPreset("pingel-pro");
  const { dir } = fixture({
    preset: "pingel-pro", style: { ...preset, audio: { ...preset.audio, sounds: false } },
    words, captions, lines: captions, audio: { tracks: [] },
    video: { src: normal, width: 90, height: 160, duration: 22, fps: 30, hasAudio: false },
  });
  // A matching cached plan must not suppress the retry's request for fresh direction.
  writeJSON(path.join(dir, "pro-graphics.json"), { schema: 2, key: JSON.stringify({ words, duration: 22, hookEnd: 2.6 }), direction: [] });
  let cardCalls = 0, brollCalls = 0, renders = 0;
  await buildProject(dir, { noGate: true, noReview: true, noPreflight: true }, {
    ...deps,
    runPreflight: async () => ({ items: [], measures: { duration: 22 } }),
    runTextcheck: async () => ({ verdict: "ok", notes: [] }),
    render: async (_project, output) => { renders++; fs.copyFileSync(normal, output); },
    proDirection: { available: () => true, ask: async () => {
      cardCalls++;
      return JSON.stringify({ overlays: [{ type: "quote", quote: { from: 0, to: 3 } }, { type: "steps", items: [{ from: 4, to: 4 }, { from: 5, to: 5 }, { from: 6, to: 7 }] }] });
    } },
    makeBroll: async (args) => {
      brollCalls++;
      assert.equal(args.force, true);
      assert.ok(args.busy.length >= 2);
      return [{ start: 17, duration: 1, file: normal, scene: "a street" }];
    },
  });
  const result = readJSON(path.join(dir, "master-check.json"));
  assert.equal(result.status, "fixed", JSON.stringify(result));
  assert.equal(get(result, "card-floor").fixed, true);
  assert.equal(get(result, "broll-present").fixed, true);
  assert.deepEqual([cardCalls, brollCalls, renders], [1, 1, 2]);
});

test("Greg 11-24: a full-screen card is not a cards-off-face failure (it covers the speaker on purpose)", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../src/master-check.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(!card\.place \|\| isFull\(card\)\) return \[\];/);
});
