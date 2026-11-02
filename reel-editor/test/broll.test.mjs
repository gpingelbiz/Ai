import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { brollCount, brollCandidates, placeBroll, picksPrompt, holdForSplit, checkPick, PICKS_SCHEMA, readRecent, rememberScenes } from "../src/broll.mjs";
import { codexModels, isModelRefusal, imageInstructions, savedImage } from "../src/codex.mjs";
import { renderHTML } from "../src/compose.mjs";
import { applyTheme } from "../src/looks.mjs";
import { loadPreset } from "../src/presets.mjs";
import { deepMerge } from "../src/util.mjs";

const cache = fs.mkdtempSync(path.join(os.tmpdir(), "broll-test-"));
process.env.REEL_BROLL_RECENT = path.join(cache, "recent.json");
process.env.REEL_CACHE = cache;
const realRecent = path.join(os.homedir(), ".cache", "reel-editor", "broll-recent.json");
const snapshot = () => fs.existsSync(realRecent) ? { bytes: fs.readFileSync(realRecent).toString("base64"), mtime: fs.statSync(realRecent).mtimeMs } : null;
const before = snapshot();
after(() => {
  assert.deepEqual(snapshot(), before, "the real recent-scene cache must stay untouched");
  fs.rmSync(cache, { recursive: true, force: true });
});

const groups = Array.from({ length: 30 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.8, text: `line ${i}`, words: [] }));

test("b-roll count scales with length", () => {
  assert.equal(brollCount(7), 0);
  assert.equal(brollCount(12), 1, "a short reel still gets one still");
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

test("one prompt picks the lines and draws the stills; faces and text are banned", () => {
  const cands = brollCandidates(groups.slice(0, 6), 14, { hook: { start: 0, duration: 3 } });
  const p = picksPrompt({ candidates: cands, transcript: "x", hook: "Hook", count: 1, spacing: 6.4, style: "moody" });
  assert.match(p, /^2: 4\.0s line 2$/m);
  assert.doesNotMatch(p, /^0: /m);
  assert.match(p, /at least 6\.4 seconds apart/);
  assert.match(p, /broll-1\.png/);
  assert.match(p, /vertical 9:16 \(1080x1920\) image/);
  assert.match(p, /Look for every image: moody/);
  assert.match(imageInstructions(), /No people/);
  assert.match(imageInstructions(), /No text, letters/);
  assert.match(imageInstructions(), /Candid documentary photograph/);
  assert.match(imageInstructions(), /no golden glow/);
  assert.match(imageInstructions(), /stock photo of X/);
});

test("codex model: env wins, else config default then the fallback", () => {
  assert.deepEqual(codexModels({ REEL_CODEX_MODEL: "x" }), ["x"]);
  assert.equal(codexModels({}).at(-1), "gpt-5.6-sol");
  assert.ok(isModelRefusal("The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account"));
  assert.ok(!isModelRefusal("network error"));
});

test("only real, non-empty image files count", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "img-"));
  fs.writeFileSync(path.join(d, "empty.png"), "");
  fs.writeFileSync(path.join(d, "real.png"), Buffer.alloc(5000));
  assert.equal(savedImage(d, "empty.png"), null);
  assert.equal(savedImage(d, "missing.png"), null);
  assert.equal(savedImage(d, "real.png"), path.join(d, "real.png"));
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
  assert.match(html, /"broll":\[\{"start":6,"duration":2.4,"motion":"left","video":false\}\]/);
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

test("recent scenes are remembered (last 24) and shown to Codex as things to avoid", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { readRecent, rememberScenes } = await import("../src/broll.mjs");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "br-")), "recent.json");
  assert.deepEqual(readRecent(f), []);
  rememberScenes(["an empty conference room", "  a dinner table  "], f);
  assert.deepEqual(readRecent(f), ["an empty conference room", "a dinner table"]);
  rememberScenes(Array.from({ length: 30 }, (_, i) => `scene ${i}`), f);
  assert.equal(readRecent(f).length, 24);
  const cands = brollCandidates(groups.slice(0, 6), 14, { hook: { start: 0, duration: 3 } });
  assert.match(picksPrompt({ candidates: cands, transcript: "x", hook: "h", count: 1, recent: ["an empty conference room"] }), /already used these scenes[\s\S]*- an empty conference room/);
});

test("render: the b-roll cut is hard by default, flash adds the wash layer, blur fades through the grade", () => {
  const base = { name: "t", canvas: { width: 1080, height: 1920 }, video: { duration: 20, hasAudio: true }, captions: [], broll: [{ start: 6, duration: 2, motion: "in", src: "assets/broll/broll-1.png" }] };
  const style = (cut) => ({ colors: { text: "#fff", accent: "#fc0", stroke: "#000" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: {}, cta: {}, broll: { cut } });
  const hard = renderHTML({ ...base, style: style(undefined) }, "assets/footage.mp4");
  assert.match(hard, /"brollCut":"hard"/);
  assert.ok(!hard.includes('class="broll-flash"'));
  const flash = renderHTML({ ...base, style: style("flash") }, "assets/footage.mp4");
  assert.match(flash, /"brollCut":"flash"/);
  assert.match(flash, /<div class="broll-flash"><div class="broll-flash-core"><\/div><\/div>/);
  assert.match(renderHTML({ ...base, style: style("blur") }, "assets/footage.mp4"), /"brollCut":"blur"/);
  assert.match(renderHTML({ ...base, style: style("nope") }, "assets/footage.mp4"), /"brollCut":"hard"/, "unknown falls back to hard");
});

test("holdForSplit holds the cutaway with the most clear time, and only when there are two or more", () => {
  const shots = [{ start: 6, duration: 2, file: "a.png" }, { start: 14, duration: 2, file: "b.png" }, { start: 30, duration: 2, file: "c.png" }];
  const held = holdForSplit(shots, { duration: 40, busy: [{ start: 20, duration: 3 }], tail: 1, gap: 4, hold: 5 });
  // Room: 6 -> 10 (next at 14 minus gap 4) = 4 s; 14 -> 18.5 (card at 20 minus 1.5) = 4.5 s; 30 -> 39 = 9 s.
  assert.deepEqual(held.map((s) => s.duration), [2, 2, 5]);
  assert.equal(held[2].hold, true);
  assert.equal(held[2].baseDuration, 2);
  assert.equal(holdForSplit([shots[0]], { duration: 40 }).length, 1);
  assert.equal(holdForSplit([shots[0]], { duration: 40 })[0].hold, undefined, "one cutaway stays a full cutaway");
  const cramped = holdForSplit(shots, { duration: 34, cta: { start: 33 }, busy: [{ start: 9, duration: 2 }, { start: 17, duration: 2 }], gap: 4, hold: 5 });
  assert.ok(cramped.every((s) => !s.hold), "no room anywhere leaves them all short");
  const clip = holdForSplit([{ start: 6, duration: 4, file: "a.mp4" }, { start: 20, duration: 4, file: "b.mp4" }], { duration: 40, hold: 8, clipSeconds: 5 });
  assert.equal(clip[1].duration, 5, "a generated clip is held no longer than it runs");
});

test("b-roll: clearStart keeps every cutaway off the first seconds", () => {
  const groups = Array.from({ length: 20 }, (_, i) => ({ start: i * 1.5, end: i * 1.5 + 1.4, text: `line ${i}` }));
  const c = brollCandidates(groups, 30, { hook: { start: 0, duration: 3 }, clearStart: 5 });
  assert.ok(c.length && c.every((x) => x.start >= 5));
  assert.ok(brollCandidates(groups, 30, { hook: { start: 0, duration: 3 } }).some((x) => x.start < 5), "off by default");
});

test("checkPick rejects the jungle stand-ins and accepts the actual spoken subject", () => {
  const candidate = { start: 20, text: "a snake coming" };
  const lines = [
    { start: 20, text: "a snake coming" },
    { start: 22, text: "and a coconut" },
    { start: 24, text: "Bring a knife" },
  ];
  assert.match(checkPick({ shows: "snake", scene: "a tow strap in a garage" }, candidate, lines, { len: 4 }), /scene does not contain snake/);
  assert.match(checkPick({ shows: "coconut", scene: "packing tape on a shelf" }, candidate, lines, { len: 4 }), /scene does not contain coconut/);
  assert.match(checkPick({ shows: "knife", scene: "a box cutter opening a box" }, candidate, lines, { len: 4 }), /scene does not contain knife/);
  assert.equal(checkPick({ shows: "snake", scene: "a green snake dropping from a jungle branch" }, candidate, lines, { len: 2.4 }), null);
  assert.match(checkPick({ scene: "a snake" }, candidate, lines, {}), /shows missing/);
  assert.match(checkPick({ shows: "lion", scene: "a lion" }, candidate, lines, {}), /not spoken: lion/);
  assert.match(checkPick({ shows: "snake", scene: "a snake" }, null, lines, {}), /not a candidate/);
  for (const word of ["rope", "cord", "strap", "noose", "lasso", "cable", "chain", "ropes", "chain-link"]) {
    assert.match(checkPick({ shows: "snake", scene: `a snake next to a ${word}` }, candidate, lines, {}), /dark-read word/);
  }
  assert.equal(checkPick({ shows: "SNAKE,", scene: "A green Snake." }, candidate, lines, {}), null, "case and punctuation normalise");
  assert.match(checkPick({ shows: "snake", scene: "a snakeskin boot" }, candidate, lines, {}), /does not contain snake/, "the noun must be a whole word");
  assert.match(checkPick({ shows: "a coconut", scene: "a round fruit" }, candidate, lines, {}), /does not contain coconut/, "the longest shows word is the noun");
});

test("checkPick uses words in the shot window, including the next caption and half-second allowance", () => {
  const candidate = { start: 10 };
  const lines = [{ start: 9.9, text: "snake coconut knife", words: [
    { start: 9.99, text: "snake" }, { start: 12.9, text: "coconut!" }, { start: 12.91, text: "knife" },
  ] }];
  assert.equal(checkPick({ shows: "coconut", scene: "a coconut falling" }, candidate, lines, { len: 2.4 }), null);
  assert.match(checkPick({ shows: "snake", scene: "a snake" }, candidate, lines, { len: 2.4 }), /not spoken/);
  assert.match(checkPick({ shows: "knife", scene: "a knife" }, candidate, lines, { len: 2.4 }), /not spoken/);
});

test("ranked placement keeps the best spaced picks, then returns time order", () => {
  const candidates = brollCandidates(groups, 60);
  const picks = [10, 9, 3, 25].map((line) => ({ line, scene: "a snake", shows: "snake" }));
  assert.deepEqual(placeBroll(picks, candidates, { ranked: true, len: 2.4, gap: 4, max: 2 }).map((s) => s.line), [3, 10]);
  assert.deepEqual(placeBroll(picks, candidates, { len: 2.4, gap: 4, max: 2 }).map((s) => s.line), [3, 9], "default still chooses in time order");
  assert.deepEqual(placeBroll(picks, candidates, { max: 0 }), []);
});

test("stills prompt requires the named image, permits literal analogies and limits recent scenes", () => {
  const p = picksPrompt({ candidates: [], count: 2, world: "a garage", recent: [...Array.from({ length: 16 }, (_, i) => `scene-${i}`), "scene-4"] });
  assert.match(p, /The picture is what the words say/);
  assert.match(p, /an analogy, a joke, a story/);
  assert.match(p, /snake sliding down a broad jungle rock/);
  assert.doesNotMatch(p, /toward the camera|dropping on them|hitting their head/);
  assert.match(p, /never a rope for a snake, never tape for a coconut, never a box cutter for a knife/);
  assert.match(p, /Dark-read rule:.*noose, self-harm/);
  assert.match(p, /only for lines about their own life and work; never use it to replace an image they name/);
  assert.match(p, /an image the speaker names is not clip art/);
  assert.doesNotMatch(p, /the report, the number/);
  assert.equal((p.match(/^- scene-/gm) || []).length, 12);
  assert.equal((p.match(/^- scene-4$/gm) || []).length, 1);
  assert.ok(PICKS_SCHEMA.properties.picks.items.required.includes("shows"));
});

test("recent scene dedupe keeps the newest occurrence and writes only the temp cache", () => {
  fs.writeFileSync(process.env.REEL_BROLL_RECENT, JSON.stringify({ scenes: ["first", " second ", "first", "third"] }));
  assert.deepEqual(readRecent(), ["second", "first", "third"]);
  assert.deepEqual(rememberScenes(["second", "fourth", "first", " fourth "]), ["third", "second", "first", "fourth"]);
  assert.deepEqual(readRecent(), ["third", "second", "first", "fourth"]);
  assert.notEqual(process.env.REEL_BROLL_RECENT, realRecent);
});

test("pingel-runway disables creative grade and focus blur through merge, theme and composition", () => {
  const preset = loadPreset("pingel-runway");
  const themed = applyTheme(preset, "gregcard");
  assert.equal(themed.broll.grade, false);
  assert.equal(deepMerge({ broll: { grade: { preset: "mono-fade" } } }, { broll: { grade: false } }).broll.grade, false);
  assert.equal(themed.look, "gregcard");
  assert.equal(themed.slams.style, "type");
  assert.equal(applyTheme({ ...preset, looks: {} }, "gregcard").broll.grade.preset, "mono-fade");
  assert.deepEqual([preset.broll.duration, preset.broll.gap, preset.broll.max, preset.broll.every, preset.broll.maxCreditsPerReel], [2.5, 3, 5, 10, 180]);
  assert.equal(preset.broll.grade, false, "applyTheme does not mutate the preset");
  assert.equal(preset.broll.videoSeconds, 3);
  assert.equal(preset.broll.retryVideoModel, "gen4.5");
  assert.equal(preset.broll.focusPull, 0);
  const html = renderHTML({ name: "test", canvas: { width: 1080, height: 1920 }, video: { duration: 20, hasAudio: true }, captions: [], style: themed, broll: [{ start: 6, duration: 2, src: "assets/broll/broll-1.mp4", move: "none" }] }, "assets/footage.mp4");
  assert.doesNotMatch(html, /data-color-grading=/);
  assert.match(html, /"focusPull":0/);
});

test("Codex stills validate picks before placement and persist shows", async () => {
  const { makeBroll } = await import("../src/broll.mjs");
  const workDir = fs.mkdtempSync(path.join(cache, "stills-"));
  const picks = [
    { line: 0, scene: "packing tape on a shelf", shows: "coconut", file: "broll-1.png" },
    { line: 1, scene: "a green snake on a jungle branch", shows: "snake", file: "broll-2.png" },
  ];
  const shots = await makeBroll({ workDir, duration: 30, groups: [{ start: 6, text: "a coconut" }, { start: 14, text: "a snake" }], deps: {
    hasCodex: () => true, codexPausedUntil: () => 0,
    codexExec: async (prompt, { cwd, schema }) => {
      assert.equal(schema, PICKS_SCHEMA);
      for (const p of picks) fs.writeFileSync(path.join(cwd, p.file), Buffer.alloc(2000));
      return JSON.stringify({ picks });
    },
  } });
  assert.equal(shots.length, 1);
  assert.equal(shots[0].shows, "snake");
  assert.equal(JSON.parse(fs.readFileSync(path.join(workDir, "broll", "broll.json"))).shots[0].shows, "snake");
});

test("stills keep world opt-in and never reuse a plan from an older prompt", async () => {
  const { makeBroll, PROMPT_VERSION } = await import("../src/broll.mjs");
  const workDir = fs.mkdtempSync(path.join(cache, "versioned-stills-"));
  const groups = [{ start: 6, text: "a snake" }, { start: 14, text: "a coconut" }];
  const prompts = [];
  const deps = {
    hasCodex: () => true, codexPausedUntil: () => 0,
    codexExec: async (prompt, { cwd }) => {
      prompts.push(prompt);
      fs.writeFileSync(path.join(cwd, "broll-1.png"), Buffer.alloc(2000));
      return JSON.stringify({ picks: [{ line: 0, shows: "snake", scene: "a green snake on a branch", file: "broll-1.png" }] });
    },
  };
  const run = (settings = {}) => makeBroll({ workDir, duration: 30, groups, settings: { world: "OPT-IN WORLD", ...settings }, deps });
  await run();
  assert.doesNotMatch(prompts[0], /OPT-IN WORLD/);
  const planPath = path.join(workDir, "broll", "broll.json");
  const saved = JSON.parse(fs.readFileSync(planPath));
  assert.equal(saved.promptVersion, PROMPT_VERSION);
  assert.ok(saved.key.startsWith(`${PROMPT_VERSION}|`));
  await run();
  assert.equal(prompts.length, 1, "the current prompt plan can be reused");
  for (const version of [undefined, "older-prompt"]) {
    fs.writeFileSync(planPath, JSON.stringify({ ...saved, promptVersion: version }));
    const count = prompts.length;
    await run();
    assert.equal(prompts.length, count + 1, "matching caption lines cannot bypass a prompt-version change");
  }
  await makeBroll({ workDir, duration: 30, groups, force: true, settings: { world: "OPT-IN WORLD", worldInPrompt: true }, deps });
  assert.match(prompts.at(-1), /OPT-IN WORLD/);
  assert.match(prompts.at(-1), /never use it to replace an image they name/);
  assert.match(prompts.at(-1), /Kill test/);
  assert.match(prompts.at(-1), /bottom third stays plain and dark/);
});

test("candidates retain word timing and a checked video cannot be held beyond its checked interval", () => {
  const words = [{ start: 6.3, text: "snake" }];
  assert.deepEqual(brollCandidates([{ start: 6, text: "a snake", words }], 20)[0].words, words);
  const shots = [{ start: 6, duration: 2, file: "a.mp4", moves: { ok: true } }, { start: 20, duration: 2, file: "b.mp4", moves: { ok: true } }];
  assert.deepEqual(holdForSplit(shots, { duration: 40, hold: 5 }), shots);
});


test("video compositions use real playback with no editor push while preserving the sent prompt", () => {
  const shot = { start: 6, duration: 1.8, motion: "The coconut rolls. Camera: locked camera.", move: "none", video: true, src: "assets/broll/broll-1.mp4" };
  const html = renderHTML({ name: "animated", canvas: { width: 1080, height: 1920 }, video: { duration: 20, hasAudio: true }, captions: [], broll: [shot], style: {
    colors: { text: "#fff", accent: "#fc0", stroke: "#000" },
    captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72 },
    hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: {}, cta: {},
  } }, "assets/footage.mp4");
  assert.match(html, /<video class="broll-media".*broll-1\.mp4/);
  assert.match(html, /"broll":\[\{"start":6,"duration":1.8,"motion":"none","video":true\}\]/);
  assert.equal(shot.motion, "The coconut rolls. Camera: locked camera.");
});
