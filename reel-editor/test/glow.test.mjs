import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPicks, fitsTwoLines, layoutGlow, chinDuring, glowPrompt, pacingReport, restyleGlow } from "../src/glow.mjs";
import { CLEAN_SHARE, SCENE_SETTLE, BAND_MAX, SCENE_SHARE, SCENE_REPEAT_GAP } from "../src/glow-pacing.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { glowScenesHTML, glowScenesCSS, glowRuntime, GLOW_SCENES_JS } from "../src/glow-scenes.mjs";
import { composeProject, renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { esc } from "../src/text.mjs";

const said = "So the first thing is listening judgment and practice matter more than any script you memorized today";
const words = said.split(" ").map((text, i) => ({ text, start: 3 + i * 0.4, end: 3 + i * 0.4 + 0.3 }));
const library = [{ name: "ear", file: "/x/icon-ear.png" }, { name: "target", file: "/x/icon-target.png" }, { name: "script", file: "/x/icon-script.png" }];

test("feature lines must fit two lines of 16 characters", () => {
  assert.equal(fitsTwoLines(words, { from: 5, to: 6, br: 6 }), true); // LISTENING / JUDGMENT
  assert.equal(fitsTwoLines(words, { from: 5, to: 8, br: 7 }), false); // LISTENING JUDGMENT is 18
  assert.equal(fitsTwoLines(words, { from: 5, to: 8, br: null }), false);
  assert.equal(fitsTwoLines(words, { from: 9, to: 15, br: 12 }), false);
});

test("checked picks drop overlaps, unknown icons, title-card words and repeats", () => {
  const picks = checkPicks({
    features: [{ from: 5, to: 6, key: 6, br: 6 }, { from: 6, to: 7, key: 7, br: null }, { from: 0, to: 1, key: 0, br: null }],
    icons: [{ word: 5, icon: "ear" }, { word: 6, icon: "ear" }, { word: 8, icon: "target" }, { word: 14, icon: "unicorn" }],
    scenes: [{ from: 12, to: 14, icons: ["script"], key: 14 }],
  }, words, library, { hookEnd: 3.5 });
  assert.deepEqual(picks.features.map((f) => [f.from, f.to]), [[5, 6]]);
  assert.deepEqual(picks.icons.map((p) => p.icon), ["ear", "target"], `up to ${BAND_MAX} band elements may start in 3 seconds`);
  assert.equal(picks.scenes.length, 1);
});

test("glow direction asks for a graphics-rich reel with short clean holds and the same limits pacing enforces", () => {
  const prompt = glowPrompt(words, library, { duration: 30 });
  for (const rule of [/graphics-rich/, /about 10 to 14 picks in a 20-second reel/, /about 10 to 15% of the reel/, new RegExp(`needs ${SCENE_SETTLE} seconds on Greg`), /For this 30-second reel that means about 18 picks in all \(at least 16\).* about 5 full-screen scenes/, /An icon never sits on a word a scene covers/, new RegExp(`No more than ${BAND_MAX} band elements`), /at least four different element types and at least two different scene types/, /a flow for any process/, /a thread for any exchange/, /bars or a number for any figure/, /first 3 seconds/]) assert.match(prompt, rule);
  // The sparse pacing brief is gone.
  assert.doesNotMatch(prompt, /25 to 35%|1.2 seconds settled|2 band elements|A beat does not need a graphic/);
});

test("pacing trims rolling band windows by value, preserves its inputs and is idempotent", () => {
  const ws = Array.from({ length: 8 }, (_, i) => ({ text: "point", start: 4 + i * 0.5, end: 4.3 + i * 0.5 }));
  ws[7] = { text: "point", start: 8.1, end: 8.4 };
  const picks = { features: [{ from: 2, to: 3, key: 2 }], overlays: [{ type: "stamp", from: 4, to: 4 }], icons: [{ word: 0, icon: "ear" }, { word: 1, icon: "target" }, { word: 7, icon: "script" }], scenes: [] };
  const before = structuredClone(picks);
  const report = pacingReport(picks, ws, 20);
  assert.deepEqual(picks, before);
  assert.deepEqual(report.picks.features, picks.features);
  assert.deepEqual(report.picks.overlays, picks.overlays);
  // Four band starts fall in 3.92..5.97: the feature and overlay outrank the icons, and only the start that would make
  // a fourth in 3 seconds goes.
  assert.deepEqual(report.picks.icons, [picks.icons[0], picks.icons[2]], "features and overlays outrank decorative icons");
  assert.equal(report.dropped.filter((d) => d.reason === "band-window").length, 1);
  assert.deepEqual(pacingReport(report.picks, ws, 20).picks, report.picks);
});

test("band windows roll across fixed buckets and allow exactly three seconds between first and fourth", () => {
  const ws = [5.9, 6.2, 6.5, 8.8, 8.9].map((start) => ({ text: "point", start, end: start + 0.1 }));
  const picks = { icons: [0, 1, 2, 3, 4].map((word) => ({ word, icon: `icon-${word}` })) };
  const report = pacingReport(picks, ws, 30);
  assert.equal(BAND_MAX, 3);
  assert.deepEqual(report.picks.icons.map((p) => p.word), [0, 1, 2, 4], "8.8 is 2.9 s after 5.9; 8.9 is exactly 3 s after");
});

test("pacing reserves the title's full three seconds including entrance padding", () => {
  const ws = [2.99, 3, 3.05].map((start) => ({ text: "point", start, end: start + 0.2 }));
  const picks = checkPicks({ features: [{ from: 0, to: 0 }, { from: 1, to: 1 }], icons: [{ word: 2, icon: "ear" }] }, ws, library, { hookEnd: 0, duration: 20 });
  assert.deepEqual(picks.features.map((p) => p.from), [1]);
  const out = layoutGlow({ words: ws, video: { duration: 20 } }, picks, library, null);
  assert.ok(out.captions.filter((g) => g.kind === "feat").every((g) => g.start >= 3));
  assert.ok(out.icons.every((g) => g.t >= 3));
});

test("scene settling uses displayed exits including minimum holds and delayed rows", () => {
  const ws = [4, 4.1, 5.8, 6.8, 7.1, 9, 12, 14.1, 16, 16.3].map((start) => ({ text: "point", start, end: start + 0.1 }));
  const picks = {
    scenes: [{ type: "icons", from: 0, to: 1, icons: ["ear"] }, { type: "quote", from: 2, to: 2 }, { type: "steps", from: 6, to: 7, items: [{ word: 6, label: "point" }, { word: 7, label: "point" }] }],
    overlays: [2, 3, 4, 8, 9].map((from) => ({ type: "stamp", from, to: from })),
    features: [{ from: 2, to: 2 }], icons: [{ word: 3, icon: "ear" }],
  };
  const report = pacingReport(picks, ws, 30);
  // The first scene shows until 5.75 (its 1.8 s minimum): the quote (5.65), the stamp and feature on 5.8 come too soon;
  // the stamp on 6.8 is SCENE_SETTLE after it.
  assert.deepEqual(report.picks.scenes.map((s) => s.from), [0, 6]);
  assert.deepEqual(report.picks.overlays.map((o) => o.from), [3, 4, 8, 9]);
  assert.equal(report.picks.features.length, 0);
  assert.ok(report.dropped.some((d) => d.kind === "overlays" && d.pick.from === 2 && d.reason === "scene-settle"));
  const out = layoutGlow({ words: ws, video: { duration: 30 } }, report.picks, library, null);
  assert.ok(out.overlays[0].start - out.scenes[0].end >= SCENE_SETTLE);
  assert.ok(out.scenes[1].start - out.scenes[0].end >= SCENE_SETTLE);
  assert.equal(out.scenes[1].end, 15, "the final step gets its full 0.9-second hold");
  assert.ok(out.overlays.find((o) => o.start > out.scenes[1].start).start - out.scenes[1].end >= SCENE_SETTLE);
});

test("scene settling is applied by checkPicks before layout", () => {
  const ws = [4, 4.2, 6.2, 7.2, 10].map((start) => ({ text: "point", start, end: start + 0.15 }));
  const picks = checkPicks({ scenes: [{ type: "icons", from: 0, to: 1, icons: ["ear"] }, { type: "quote", from: 2, to: 2 }], overlays: [{ type: "stamp", word: 2 }, { type: "stamp", word: 3 }] }, ws, library, { duration: 30 });
  assert.equal(picks.scenes.length, 1, `a 6.05 entrance is less than ${SCENE_SETTLE} s after the 5.75 exit`);
  // The stamp at 6.2 s is past the 5.75 s exit plus the settle; both stamps stay.
  assert.deepEqual(picks.overlays.map((o) => o.from), 6.2 >= 5.75 + SCENE_SETTLE ? [2, 3] : [3]);
  const repeats = checkPicks({ scenes: [{ type: "icons", from: 0, to: 1, icons: ["ear"] }, { type: "quote", from: 2, to: 2 }, { type: "icons", from: 4, to: 4, icons: ["ear"] }] }, ws, library, { duration: 30 });
  assert.equal(repeats.scenes.length, 1, "dropping a crowded intervening scene must not leave repeated scene types");
});

test("pacing drops the latest icons first to restore the clean-hold share and reports sparse gaps", () => {
  const ws = [3.2, 3.8, 5, 6, 7, 8, 9].map((start) => ({ text: "point", start, end: start + 0.8 }));
  const report = pacingReport({ features: [{ from: 0, to: 3 }], icons: [{ word: 4, icon: "ear" }, { word: 5, icon: "target" }, { word: 6, icon: "script" }] }, ws, 10);
  assert.ok(report.cleanFraction >= CLEAN_SHARE);
  assert.equal(report.picks.features.length, 1);
  assert.deepEqual(report.picks.icons.map((p) => p.word), [4]);
  assert.equal(report.dropped.filter((d) => d.reason === "clean-hold").length, 2);
  const sparse = pacingReport({}, ws, 20);
  assert.equal(sparse.cleanSeconds, 17, "the title is not counted as clean face time");
  assert.equal(sparse.onTarget, false);
  assert.deepEqual(sparse.gaps, [{ start: 3, end: 20 }]);
  assert.ok(Number.isFinite(pacingReport({}, [], Infinity).cleanFraction));
  assert.equal(pacingReport({}, [], 0).cleanSeconds, 0);
});

test("a fixture restyle composes only the paced picks into the page runtime", async () => {
  const { loadPreset } = await import("../src/presets.mjs");
  const { renderHTML } = await import("../src/compose.mjs");
  const ws = [3.3, 3.8, 4.3, 8, 8.3, 10, 11, 14].map((start) => ({ text: "point", start, end: start + 0.3 }));
  const plan = { name: "paced", canvas: { width: 1080, height: 1920 }, video: { duration: 20, hasAudio: false }, words: ws, style: loadPreset("pingel-brand"), hook: { text: "The point", start: 0, duration: 3 } };
  const { picks } = await restyleGlow(plan, { library, picks: { features: [{ from: 0, to: 1, key: 1 }], icons: [{ word: 0, icon: "ear" }, { word: 2, icon: "target" }], scenes: [{ type: "icons", from: 3, to: 4, icons: ["ear"] }], overlays: [{ type: "stamp", word: 5 }, { type: "stamp", word: 7 }] } });
  // Both icons fit the three-per-3-seconds band; the stamp at 10 s comes within SCENE_SETTLE of the scene's 9.75 exit.
  assert.equal(picks.icons.length, 2);
  assert.deepEqual(picks.overlays.map((o) => o.from), [7]);
  const html = renderHTML(plan, "assets/fixture.mp4");
  const runtime = JSON.parse(html.match(/const PLAN = (.+);/)[1]);
  assert.equal(runtime.glowScenes.length, 1);
  assert.equal(runtime.glowOverlays.length, 1);
  assert.match(html, /id="gscene-0"/);
  assert.match(html, /id="gover-0"/);
  assert.doesNotMatch(html, /id="gover-1"/);
  assert.equal(runtime.glowOverlays[0].start, plan.glowOverlays[0].start);
});

test("layout turns picks into feature lines, subtitles, icons and a scene with no caption under it", () => {
  const plan = { words, video: { duration: 12 } };
  const detection = { frames: [{ t: 5, faces: [{ x: 0.3, y: 0.2, w: 0.4, h: 0.27 }] }] };
  const picks = { features: [{ from: 5, to: 6, key: 6, br: 6 }], icons: [{ word: 5, icon: "ear" }], scenes: [{ from: 12, to: 14, icons: ["script"], key: 14 }] };
  const out = layoutGlow(plan, picks, library, detection);
  const feat = out.captions.find((g) => g.kind === "feat");
  assert.deepEqual(feat.words.map((w) => w.text), ["listening", "judgment"]);
  assert.equal(feat.words.find((w) => w.key).text, "judgment");
  assert.equal(feat.words.find((w) => w.br).text, "judgment");
  assert.equal(feat.place.y, Math.round((0.47 + 0.02) * 1920));
  assert.ok(out.captions.every((g) => g.kind === "feat" || g.words.length <= 3));
  assert.equal(out.scenes.length, 1);
  const scene = out.scenes[0];
  assert.ok(out.captions.every((g) => !(g.start < scene.end && g.end > scene.start + 0.15)));
  assert.equal(out.icons.length, 1);
  assert.equal(out.icons[0].file, "/x/icon-ear.png");
});

test("chin falls back when no face is found", () => {
  assert.equal(chinDuring(null, 0, 1), 0.47);
  assert.equal(chinDuring({ frames: [{ t: 1, faces: [{ x: 0, y: 0.3, w: 0.2, h: 0.2 }] }] }, 0.9, 1.1), 0.5);
});

test("a one-word subtitle between feature lines still stays up half a second", () => {
  const ws = "Price feels high or the timing is wrong".split(" ").map((text, i) => ({ text, start: 4 + i * 0.3, end: 4 + i * 0.3 + 0.25 }));
  const plan = { words: ws, video: { duration: 10 } };
  const out = layoutGlow(plan, { features: [{ from: 0, to: 2, key: 0, br: null }, { from: 4, to: 7, key: 7, br: 6 }], icons: [], scenes: [] }, [], null);
  const sub = out.captions.find((g) => g.kind === "sub");
  assert.deepEqual(sub.words.map((w) => w.text), ["or"]);
  assert.ok(sub.end - sub.start >= 0.5);
});

test("element picks must match the spoken words: numbers said, labels short, one scene type at a time", () => {
  const said = "Look the typical package sold for 736 dollars but most coaches list it at 997 and then wonder why pushy loses while listening wins every time okay";
  const ws = said.split(" ").map((text, i) => ({ text, start: 3 + i * 0.5, end: 3 + i * 0.5 + 0.4 }));
  const lib = ["person", "cash-stack", "megaphone", "ear", "cross", "check", "text-message"].map((name) => ({ name, file: `/x/${name}.png` }));
  const picks = checkPicks({
    scenes: [
      { type: "number", from: 5, to: 7, value: "$736", label: "What it sold for" },
      { type: "number", from: 10, to: 12, value: "$5,000", label: "Made up" },
      { type: "versus", from: 18, to: 21, left: { word: 18, icon: "megaphone", label: "Pushy" }, right: { word: 20, icon: "ear", label: "Listening" } },
    ],
    overlays: [{ type: "stamp", word: 13 }, { type: "stamp", word: 14 }],
  }, ws, lib, { hookEnd: 3, duration: 60 });
  assert.deepEqual(picks.scenes.map((s) => s.type), ["number", "versus"]);
  assert.equal(picks.overlays[0].type, "stamp");
  const out = layoutGlow({ words: ws, video: { duration: 20 } }, picks, lib, null);
  const versus = out.scenes.find((s) => s.type === "versus");
  assert.equal(versus.cross.file, "/x/cross.png");
  assert.ok(versus.end - versus.start >= 1.8);
  assert.equal(out.overlays.length, 1); // "at" is a filler
  assert.equal(out.overlays[0].text, "997");
});

test("the glow look is on for Greg's vertical reels only", async () => {
  const { glowEnabled } = await import("../src/glow.mjs");
  const on = { glow: { enabled: true } };
  const tall = { preset: "pingel-brand", canvas: { width: 1080, height: 1920 } };
  assert.equal(glowEnabled(on, tall, {}), true);
  assert.equal(glowEnabled(on, { ...tall, preset: "pingel-runway" }, {}), true);
  assert.equal(glowEnabled({}, tall, {}), false);
  assert.equal(glowEnabled(on, { ...tall, preset: "brand-julee" }, {}), false);
  assert.equal(glowEnabled(on, tall, { REEL_CLIENT: "julee-gracey" }), false);
  assert.equal(glowEnabled(on, tall, { REEL_CLIENT_MODE: "1" }), false);
  assert.equal(glowEnabled(on, { ...tall, canvas: { width: 1920, height: 1080 } }, {}), false);
});

test("with the chin low in frame, feature lines fall back to subtitles and stamps are left out", () => {
  const ws = "We all know the answer is listening every single time".split(" ").map((text, i) => ({ text, start: 4 + i * 0.4, end: 4 + i * 0.4 + 0.3 }));
  const detection = { frames: [4, 5, 6, 7, 8].map((t) => ({ t, faces: [{ x: 0.3, y: 0.45, w: 0.4, h: 0.3 }] })) };
  const out = layoutGlow({ words: ws, video: { duration: 10 } }, { features: [{ from: 0, to: 2, key: 2, br: null }], icons: [], overlays: [{ type: "stamp", from: 6, to: 6 }], scenes: [] }, [], detection);
  assert.equal(out.captions.filter((g) => g.kind === "feat").length, 0);
  assert.equal(out.overlays.length, 0);
  assert.deepEqual(out.captions.flatMap((g) => g.words.map((w) => w.text)), ws.map((w) => w.text));
});

test("a stamp never shares the band with a fading feature line", () => {
  const ws = "Every conversation goes a way nobody expected today".split(" ").map((text, i) => ({ text, start: 4 + i * 0.3, end: 4 + i * 0.3 + 0.25 }));
  const out = layoutGlow({ words: ws, video: { duration: 10 } }, { features: [{ from: 0, to: 4, key: 1, br: 2 }], icons: [], overlays: [{ type: "stamp", from: 6, to: 6 }], scenes: [] }, [], null);
  const feat = out.captions.find((g) => g.kind === "feat");
  assert.ok(feat.end <= out.overlays[0].start - 0.05 + 1e-9);
});

test("the title goes above the head when the chin band is full", async () => {
  const { hookSpot } = await import("../src/glow.mjs");
  const band = (t0, t1) => 1000;
  const high = { frames: [{ t: 1, faces: [{ x: 0.3, y: 0.2, w: 0.4, h: 0.27 }] }] };
  const low = { frames: [{ t: 1, faces: [{ x: 0.3, y: 0.42, w: 0.4, h: 0.3 }] }] };
  const lowAndTall = { frames: [{ t: 1, faces: [{ x: 0.3, y: 0.12, w: 0.4, h: 0.62 }] }] };
  assert.deepEqual(hookSpot(high, 3, 0.032, band), { y: 1000 });
  assert.deepEqual(hookSpot(low, 3, 0.032, band), { y: Math.round(0.07 * 1920) });
  assert.deepEqual(hookSpot(lowAndTall, 3, 0.032, band), { y: 1000, crowded: true });
});

test("a restyle copy carries the music bed but not the packaged sound effects", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { carryProjectAudio } = await import("../src/glow.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "restyle-audio-"));
  const src = path.join(root, "job"), dest = path.join(root, "job-glow");
  fs.mkdirSync(path.join(src, "project", "assets", "sfx"), { recursive: true });
  fs.writeFileSync(path.join(src, "project", "assets", "music.m4a"), "bed");
  fs.writeFileSync(path.join(src, "project", "assets", "sfx", "move.wav"), "sfx");
  const plan = { audio: { tracks: [{ id: "music", src: "assets/music.m4a" }, { id: "sfx-move-1", src: "assets/sfx/move.wav" }, { id: "gone", src: "assets/missing.m4a" }] } };
  assert.deepEqual(carryProjectAudio(src, dest, plan), ["assets/music.m4a"]);
  assert.equal(fs.readFileSync(path.join(dest, "project", "assets", "music.m4a"), "utf8"), "bed");
  assert.equal(fs.existsSync(path.join(dest, "project", "assets", "sfx", "move.wav")), false);
});

// Lane D: scene checks, deterministic layout and composed output; no video renderer or paid services.
const sceneWords = (text) => text.split(" ").map((text, i) => ({ text, start: 4 + i * 0.35, end: 4.28 + i * 0.35 }));
const flowWords = sceneWords("Listen then diagnose then build if timing slips");
const flowPick = { type: "flow", from: 0, to: 7, items: [{ word: 0, label: "Listen", icon: "ear" }, { word: 2, label: "diagnose" }, { word: 4, label: "build" }], branch: { word: 6, label: "timing slips" } };
const threadWords = sceneWords("“What if I wait?” “Start with listening.”");
const threadPick = { type: "thread", from: 0, to: 6, who: "Lead", bubbles: [{ from: 0, to: 3, side: "them" }, { from: 4, to: 6, side: "me" }] };
const barsWords = sceneWords("Before ten thousand dollars after twenty thousand dollars");
const barsPick = { type: "bars", from: 0, to: 7, left: { label: "Before", value: "$10K", amount: 10000, word: 1 }, right: { label: "after", value: "$20K", amount: 20000, word: 5 } };
const checkedScene = (scene, ws, options = {}) => checkPicks({ scenes: [scene] }, ws, library, { duration: 60, ...options });
const laidScene = (scene, ws) => layoutGlow({ words: ws, video: { duration: 60 } }, checkedScene(scene, ws), library, null).scenes[0];

test("flow checks keep 2–4 spoken nodes, optional library icons and an in-range spoken branch", () => {
  const s = checkedScene(flowPick, flowWords).scenes[0];
  assert.equal(s.type, "flow");
  assert.equal(s.items.length, 3);
  assert.equal(s.items[0].icon, "ear");
  assert.deepEqual(s.branch, { word: 6, label: "timing slips" });
  assert.equal(checkedScene({ ...flowPick, items: flowPick.items.slice(0, 2), branch: undefined }, flowWords).scenes.length, 1);
  const ws = sceneWords("listen diagnose build own");
  assert.equal(checkedScene({ type: "flow", from: 0, to: 3, items: ws.map((w, word) => ({ word, label: w.text })) }, ws).scenes.length, 1);
});

test("flow rejects invented or long labels, bad counts, indexes, icons and branches", () => {
  for (const [name, patch] of [
    ["one node", { items: flowPick.items.slice(0, 1) }],
    ["five nodes", { items: [...flowPick.items, ...flowPick.items] }],
    ["invented label", { items: [{ word: 0, label: "Profit" }, flowPick.items[1]] }],
    ["long label", { items: [{ word: 0, label: "A very long label" }, flowPick.items[1]] }],
    ["outside span", { items: [{ word: 8, label: "Listen" }, flowPick.items[1]] }],
    ["wrong word", { items: [{ word: 1, label: "Listen" }, flowPick.items[1]] }],
    ["unknown icon", { items: [{ ...flowPick.items[0], icon: "invented" }, flowPick.items[1]] }],
    ["reverse order", { items: [...flowPick.items].reverse() }],
    ["invented branch", { branch: { word: 6, label: "Price" } }],
    ["branch outside span", { branch: { word: 8, label: "timing slips" } }],
    ["null item", { items: [null, flowPick.items[1]] }],
  ]) assert.equal(checkedScene({ ...flowPick, ...patch }, flowWords).scenes.length, 0, name);
});

test("thread checks keep only transcript ranges and allow 2–4 bubbles of at most 12 words", () => {
  const pick = structuredClone(threadPick);
  pick.bubbles[0].text = "Invented reply";
  const s = checkedScene(pick, threadWords).scenes[0];
  assert.deepEqual(s.bubbles, threadPick.bubbles);
  const ws = sceneWords(Array.from({ length: 48 }, (_, i) => `word${i}`).join(" "));
  const long = { type: "thread", from: 0, to: 47, who: "Client", bubbles: Array.from({ length: 4 }, (_, k) => ({ from: k * 12, to: k * 12 + 11, side: k % 2 ? "me" : "them" })) };
  assert.equal(checkedScene(long, ws).scenes.length, 1);
});

test("thread rejects invalid speakers, indexes, counts, overlaps and long bubbles", () => {
  for (const [name, patch] of [
    ["who too long", { who: "A very long name" }],
    ["missing who", { who: undefined }],
    ["one bubble", { bubbles: [threadPick.bubbles[0]] }],
    ["five bubbles", { bubbles: Array(5).fill(threadPick.bubbles[0]) }],
    ["bad side", { bubbles: [{ ...threadPick.bubbles[0], side: "client" }, threadPick.bubbles[1]] }],
    ["overlap", { bubbles: [threadPick.bubbles[0], { ...threadPick.bubbles[1], from: 3 }] }],
    ["outside span", { bubbles: [threadPick.bubbles[0], { ...threadPick.bubbles[1], to: 7 }] }],
    ["backward range", { bubbles: [{ ...threadPick.bubbles[0], from: 3, to: 0 }, threadPick.bubbles[1]] }],
  ]) assert.equal(checkedScene({ ...threadPick, ...patch }, threadWords).scenes.length, 0, name);
  const ws = sceneWords(Array(20).fill("word").join(" "));
  assert.equal(checkedScene({ type: "thread", from: 0, to: 19, who: "Lead", bubbles: [{ from: 0, to: 12, side: "them" }, { from: 13, to: 19, side: "me" }] }, ws).scenes.length, 0);
});

test("bars checks match both full spoken amounts and their indexed starts", () => {
  assert.deepEqual(checkedScene(barsPick, barsWords).scenes[0], barsPick);
  const ws = sceneWords("Before 20% after 40%");
  const s = { type: "bars", from: 0, to: 3, left: { label: "Before", value: "20%", amount: 20, word: 1 }, right: { label: "after", value: "40%", amount: 40, word: 3 } };
  assert.equal(checkedScene(s, ws).scenes.length, 1);
  assert.equal(checkedScene({ ...s, left: { ...s.left, amount: 0, value: "0%" } }, sceneWords("Before 0% after 40%")).scenes.length, 1);
});

test("bars reject fabricated values, distorted heights, bad labels, indexes and invalid amounts", () => {
  for (const [name, patch] of [
    ["unspoken value", { value: "$99K", amount: 99000 }],
    ["partial match", { value: "$10", amount: 10 }],
    ["invented label", { label: "Profit" }],
    ["long label", { label: "An overly long label" }],
    ["wrong height", { amount: 99999 }],
    ["string height", { amount: "10000" }],
    ["negative", { amount: -10000 }],
    ["NaN", { amount: NaN }],
    ["infinity", { amount: Infinity }],
    ["wrong word", { word: 2 }],
    ["outside span", { word: 8 }],
  ]) assert.equal(checkedScene({ ...barsPick, left: { ...barsPick.left, ...patch } }, barsWords).scenes.length, 0, name);
  assert.equal(checkedScene({ ...barsPick, left: barsPick.right, right: barsPick.left }, barsWords).scenes.length, 0);
  assert.equal(checkedScene({ ...barsPick, right: null }, barsWords).scenes.length, 0);
});

test("number facts require the actual spoken amount; a spoken counter start is optional and checked separately", () => {
  const ws = sceneWords("It went from ten thousand to twenty thousand dollars");
  const fact = { type: "number", from: 0, to: 8, value: "$20K", label: "dollars" };
  const change = { ...fact, countFrom: "$10K" };
  assert.equal(checkedScene(fact, ws).scenes[0].countFrom, undefined);
  assert.equal(checkedScene(change, ws).scenes[0].countFrom, "$10K");
  for (const value of ["$99K", "$20", "$21K", "$20001"]) assert.equal(checkedScene({ ...fact, value }, ws).scenes.length, 0, value);
  assert.equal(checkedScene({ ...change, countFrom: "$8K" }, ws).scenes.length, 0);
  const zeroWords = sceneWords("from zero to twenty percent");
  assert.equal(checkedScene({ type: "number", from: 0, to: 4, value: "20%", countFrom: 0 }, zeroWords).scenes[0].countFrom, "0");
});

test("spoken number evidence handles decimals, commas and hyphens without matching number fragments", () => {
  const cases = [
    ["twenty-five percent", "25%", true], ["twenty five percent", "5%", false],
    ["twenty five percent", "20%", false], ["twenty dollars", "20%", false],
    ["736 dollars", "$739", false], ["736 dollars", "$73", false],
    ["nine point five percent", "9.5%", true], ["nine point five percent", "5%", false],
    ["one hundred and twenty dollars", "$120", true], ["one hundred and twenty dollars", "$20", false],
    ["1,000 dollars", "$1,000", true], ["10 thousand dollars", "$10K", true],
  ];
  for (const [text, value, valid] of cases) {
    const ws = sceneWords(text);
    assert.equal(checkedScene({ type: "number", from: 0, to: ws.length - 1, value }, ws).scenes.length, valid ? 1 : 0, `${text} → ${value}`);
  }
});

test("new scene layout resolves assets and absolute times, keeping verbatim thread words", () => {
  const flow = laidScene(flowPick, flowWords);
  assert.deepEqual(flow.items.map((it) => it.at), [4, 4.7, 5.4]);
  assert.equal(flow.items[0].icon.file, "/x/icon-ear.png");
  assert.equal(flow.items[1].icon, null);
  assert.equal(flow.branch.at, flowWords[6].start);
  const thread = laidScene(threadPick, threadWords);
  // Spoken words exactly, without the transcript's quote marks (a chat bubble is already the quote).
  assert.deepEqual(thread.bubbles[0].words, threadWords.slice(0, 4).map((w) => ({ ...w, text: w.text.replace(/[“”"]/g, "") })));
  assert.equal(thread.bubbles[1].at, threadWords[4].start);
  assert.ok(thread.bubbles[0].at - thread.start >= 0.4);
  const bars = laidScene(barsPick, barsWords);
  assert.deepEqual(bars.left, { label: "Before", value: "$10K", amount: 10000, at: barsWords[1].start });
  assert.deepEqual(bars.right, { label: "after", value: "$20K", amount: 20000, at: barsWords[5].start });
  for (const [pick, ws] of [[flowPick, flowWords], [threadPick, threadWords], [barsPick, barsWords]]) {
    const out = layoutGlow({ words: ws, video: { duration: 60 } }, checkedScene(pick, ws), library, null);
    const scene = out.scenes[0];
    assert.ok(scene.end - scene.start >= 1.8);
    assert.ok(out.captions.every((c) => c.end <= scene.start || c.start >= scene.end));
  }
});

test("scenes retain minimum holds, spacing, hook exclusion and the one-third budget", () => {
  const ws = sceneWords("before 10 after 20");
  const short = { type: "bars", from: 0, to: 3, left: { label: "before", value: "10", amount: 10, word: 1 }, right: { label: "after", value: "20", amount: 20, word: 3 } };
  assert.equal(checkedScene(short, ws, { hookEnd: 5 }).scenes.length, 0);
  assert.equal(checkedScene(short, ws, { duration: 5.5 }).scenes.length, 0);
  assert.equal(checkedScene(flowPick, flowWords, { duration: 8 }).scenes.length, 0);
  const pick = { type: "number", from: 0, to: 0, value: "10" };
  const tiny = sceneWords("10");
  assert.ok(laidScene(pick, tiny).end - laidScene(pick, tiny).start >= 1.8 - 1e-9);
  const spaced = [...flowWords, ...barsWords.map((w) => ({ ...w, start: w.start + 8, end: w.end + 8 }))];
  const second = { ...barsPick, from: 8, to: 15, left: { ...barsPick.left, word: 9 }, right: { ...barsPick.right, word: 13 } };
  const checked = checkPicks({ scenes: [flowPick, second] }, spaced, library, { duration: 60 });
  const out = layoutGlow({ words: spaced, video: { duration: 60 } }, checked, library, null);
  assert.equal(out.scenes.length, 2);
  assert.ok(out.scenes[0].end + 0.3 <= out.scenes[1].start);
  assert.ok(out.scenes.reduce((sum, s) => sum + s.end - s.start, 0) <= 60 / 3);
});


function scenePlan(scenes) {
  const style = loadPreset("pingel-brand");
  style.captions.style = "glow";
  return { name: "glow-scenes-fixture", preset: "pingel-brand", canvas: { width: 1080, height: 1920 }, style, video: { src: "/tmp/fixed.mp4", duration: 60 }, hook: null, cta: null, captions: [], zooms: [], graphics: [], broll: [], slams: [], icons: [], audio: { tracks: [] }, framing: { scale: 1, origin: "50% 40%", shift: 0, face: null, side: "right" }, reframe: [], glowScenes: scenes };
}

test("the prompt exposes flow, thread, bars and instant facts with an explicitly spoken countFrom", () => {
  const prompt = glowPrompt(flowWords, library, { duration: 60 });
  for (const type of ["flow", "thread", "bars"]) assert.ok(prompt.includes(`   ${type}:`));
  assert.match(prompt, /countFrom.*spoken starting value/);
  assert.match(prompt, /A plain fact lands at once \(it never counts up from zero\)/);
  assert.match(prompt, /Always labelled ILLUSTRATIVE/);
  assert.match(prompt, /at least 1.8 seconds/);
  assert.match(prompt, /Amounts must match the displayed values/);
});

test("composed fixture HTML includes connectors, illustrative verbatim bubbles, proportional bars and runtime fields", () => {
  const scenes = [laidScene(flowPick, flowWords), laidScene(threadPick, threadWords), laidScene(barsPick, barsWords)];
  scenes[0].items[0].icon.image = "assets/scenes/ear.png";
  const html = renderHTML(scenePlan(scenes), "assets/footage.mp4");
  for (const type of ["flow", "thread", "bars"]) assert.match(html, new RegExp(`class="glow-scene gst-${type} clip"`));
  assert.match(html, /id="gs-0-path" d="M160 140 L160 500 L160 860"/);
  assert.match(html, /src="assets\/scenes\/ear.png"/);
  assert.match(html, /gs-flow-branch-path/);
  assert.match(html, /ILLUSTRATIVE/);
  assert.match(html, /gs-thread-them[^>]*>What if I wait\?</);
  assert.match(html, /gs-thread-me[^>]*>Start with listening\.</);
  assert.equal((html.match(/aria-label="Typing"/g) || []).length, 2);
  assert.match(html, /id="gs-2-lfill" style="height:50%"/);
  assert.match(html, /id="gs-2-rfill" style="height:100%"/);
  const runtime = JSON.parse(html.match(/const PLAN = (\{[^\n]+\});/)[1]);
  assert.deepEqual(runtime.glowScenes[0].items, [4, 4.7, 5.4]);
  assert.equal(runtime.glowScenes[0].nodes[2].y, 860);
  assert.equal(runtime.glowScenes[1].bubbles[1].words.length, 3);
  assert.deepEqual(runtime.glowScenes[2].bars.map((b) => b.amount), [10000, 20000]);
  assert.match(html, /getTotalLength\(\)/);
});

test("new scene content is escaped, and all foreground containers avoid the Instagram buttons", () => {
  const scene = laidScene(threadPick, threadWords);
  scene.who = '<Lead "&">';
  scene.bubbles[0].words[0].text = "<script>";
  const html = glowScenesHTML([scene], { W: 1080, H: 1920, esc });
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('<Lead "&">'));
  const css = glowScenesCSS({ W: 1080, H: 1920, c: { accent: "#C8A24B", text: "#F5F1E8", bg: "#0B0B0D" } });
  for (const cls of ["flow", "thread", "bars"]) {
    const rule = css.match(new RegExp(`\\.gs-${cls} \\{([^}]+)\\}`))[1];
    assert.ok(Number(rule.match(/right: (\d+)%/)[1]) >= 14, cls);
  }
  assert.match(css, /\.gs-bars-fill[^}]*transform-origin: 50% 100%/);
  assert.match(css, /\.gs-bars-r \.gs-bars-fill \{ background: #C8A24B/);
});

test("non-glow compose ignores stray glow scenes and retains byte-identical output", () => {
  const plan = scenePlan([]);
  plan.style = loadPreset("clean");
  const base = renderHTML(plan, "assets/footage.mp4");
  plan.glowScenes = [laidScene(flowPick, flowWords), laidScene(threadPick, threadWords), laidScene(barsPick, barsWords)];
  assert.equal(renderHTML(plan, "assets/footage.mp4"), base);
});

test("composeProject copies flow node icons using the existing scene asset mechanism", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "glow-flow-project-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scene = laidScene(flowPick, flowWords);
  const icon = path.join(root, "ear.png"), footage = path.join(root, "footage.mp4");
  fs.writeFileSync(icon, "fixture PNG");
  fs.writeFileSync(footage, "fixture footage");
  scene.items[0].icon.file = icon;
  const plan = scenePlan([scene]);
  plan.video.src = footage;
  const project = path.join(root, "project");
  composeProject(plan, project);
  assert.equal(fs.readFileSync(path.join(project, scene.items[0].icon.image), "utf8"), "fixture PNG");
  assert.match(fs.readFileSync(path.join(project, "index.html"), "utf8"), /assets\/scenes\/scene-icon-1.png/);
});

// Real vendored GSAP runs against simple element objects: no DOM, browser or render process.
function sceneTimeline(scenes) {
  const context = vm.createContext({ setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true });
  const elements = new Map(), calls = [];
  let measured = 0;
  const element = (id) => {
    if (!elements.has(id)) {
      const attrs = { cx: 160, cy: 140 };
      elements.set(id, { id, style: {}, opacity: 0, scale: 1, scaleY: 1, y: 0, strokeDasharray: 0, strokeDashoffset: 0, textContent: "", offsetHeight: 100, getTotalLength: () => { measured++; return 720; }, getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = Number(v); } });
    }
    return elements.get(id);
  };
  const resolve = (target) => typeof target === "string" ? target.endsWith(" span") ? [0, 1, 2].map((k) => element(`${target}-${k}`)) : element(target.slice(1)) : target;
  const tl = {};
  for (const method of ["set", "fromTo", "to"]) tl[method] = (target, ...args) => {
    calls.push({ method, target, args });
    timeline[method](resolve(target), ...args);
    return tl;
  };
  const document = { getElementById: element, querySelector: (selector) => element(selector.slice(1)) };
  new Function("PLAN", "document", "tl", GLOW_SCENES_JS)(glowRuntime(scenes, []), document, tl);
  return { calls, element, measured: () => measured, seek: (time) => timeline.totalTime(time, false), close: () => { timeline.kill(); gsap.ticker.sleep(); } };
}

test("flow measures the path once and its token reaches each node on time after arbitrary seeks", (t) => {
  const scene = laidScene(flowPick, flowWords), run = sceneTimeline([scene]);
  t.after(run.close);
  assert.equal(run.measured(), 1);
  assert.ok(run.calls.some((c) => c.method === "fromTo" && c.target === "#gs-0-r0" && c.args[2] === scene.start));
  run.seek(scene.items[2].at);
  assert.equal(run.element("gs-0-token").getAttribute("cy"), 860);
  run.seek(scene.start + 0.001);
  run.seek(scene.items[1].at);
  assert.equal(run.element("gs-0-token").getAttribute("cy"), 500);
  run.seek(scene.items[2].at);
  assert.equal(run.element("gs-0-token").getAttribute("cy"), 860);
  assert.equal(run.element("gs-0-path").strokeDashoffset, 0);
  assert.equal(run.measured(), 1);
});

test("thread has 0.4-second typing windows and measured upward shifts that survive backward seeks", (t) => {
  const scene = laidScene(threadPick, threadWords), run = sceneTimeline([scene]);
  t.after(run.close);
  for (let k = 0; k < 2; k++) {
    const show = run.calls.find((c) => c.method === "set" && c.target === `#gs-0-typing${k}` && c.args[0].opacity === 1);
    const hide = run.calls.find((c) => c.method === "set" && c.target === `#gs-0-typing${k}` && c.args[0].opacity === 0);
    assert.ok(Math.abs(hide.args[1] - show.args[1] - 0.4) < 1e-9);
  }
  run.seek(scene.bubbles[1].at + 0.3);
  assert.equal(run.element("gs-0-b0").y, -122);
  run.seek(scene.bubbles[0].at + 0.3);
  assert.equal(run.element("gs-0-b0").y, 0);
  run.seek(scene.bubbles[1].at + 0.3);
  assert.equal(run.element("gs-0-b0").y, -122);
});

test("plain number facts have no count tween; spoken changes count from their starting amount in either direction", (t) => {
  const ws = sceneWords("from ten thousand to twenty thousand dollars");
  const pick = { type: "number", from: 0, to: 6, value: "$20K", countFrom: "$10000" };
  const change = laidScene(pick, ws), fact = laidScene({ ...pick, countFrom: undefined }, ws);
  assert.equal(change.from, "$10000");
  assert.equal(glowRuntime([change], []).glowScenes[0].num.from, 10);
  assert.equal(glowRuntime([fact], []).glowScenes[0].num.from, undefined);
  const factRun = sceneTimeline([fact]);
  t.after(factRun.close);
  assert.ok(!factRun.calls.some((c) => c.args[0].v != null));
  const run = sceneTimeline([change]);
  t.after(run.close);
  run.seek(change.end - 0.3);
  assert.equal(run.element("gs-0-num").textContent, "$20K");
  run.seek(change.start + 0.001);
  assert.equal(run.element("gs-0-num").textContent, "$10K");
  const decrease = { ...change, from: "$20K", value: "$10K" }, down = sceneTimeline([decrease]);
  t.after(down.close);
  down.seek(decrease.end - 0.3);
  assert.equal(down.element("gs-0-num").textContent, "$10K");
  down.seek(decrease.start + 0.001);
  assert.equal(down.element("gs-0-num").textContent, "$20K");
});

test("bars grow from their baseline and count values on cue with stable backward seeks", (t) => {
  const scene = laidScene(barsPick, barsWords), run = sceneTimeline([scene]);
  t.after(run.close);
  run.seek(scene.right.at + 0.8);
  assert.equal(run.element("gs-0-rnum").textContent, "$20K");
  assert.equal(run.element("gs-0-rfill").scaleY, 1);
  run.seek(scene.right.at + 0.001);
  assert.equal(run.element("gs-0-rnum").textContent, "$0K");
  assert.ok(run.element("gs-0-rfill").scaleY < 0.01);
  run.seek(scene.right.at + 0.8);
  assert.equal(run.element("gs-0-rnum").textContent, "$20K");
});

test("scenes may cover a little over a third of the reel but never more than SCENE_SHARE", () => {
  // Two 4.1 s scenes in a 21 s reel: 39%, over a third (a third would drop the second whole scene) but under the cap.
  const ws = Array.from({ length: 40 }, (_, i) => ({ text: "point", start: 3.2 + i * 0.45, end: 3.5 + i * 0.45 }));
  const scenes = [{ type: "icons", from: 0, to: 7, icons: ["ear"] }, { type: "quote", from: 16, to: 23 }, { type: "icons", from: 30, to: 37, icons: ["ear"] }];
  const picks = checkPicks({ scenes }, ws, library, { duration: 21 });
  assert.equal(picks.scenes.length, 2);
  assert.ok(SCENE_SHARE * 21 >= 8.2 && 21 / 3 < 8.2);
});

test("a scene too close to the previous one does not use up the budget or type rotation of a later scene", () => {
  const ws = Array.from({ length: 40 }, (_, i) => ({ text: "point", start: 3.2 + i * 0.45, end: 3.5 + i * 0.45 }));
  // icons, then a quote right after it (too soon), then a quote later: without the early skip the first quote took the
  // rotation, the later quote was dropped as a repeat, and pacing then dropped the first quote too.
  const scenes = [{ type: "icons", from: 0, to: 3, icons: ["ear"] }, { type: "quote", from: 5, to: 8 }, { type: "quote", from: 20, to: 23 }];
  const picks = checkPicks({ scenes }, ws, library, { duration: 40 });
  assert.deepEqual(picks.scenes.map((s) => s.from), [0, 20]);
});

test("the same scene type may come back once the reel has moved on, never back to back", () => {
  const ws = Array.from({ length: 50 }, (_, i) => ({ text: "point", start: 3.2 + i * 0.45, end: 3.5 + i * 0.45 }));
  const list = (from) => ({ type: "icons", from, to: from + 3, icons: ["ear"] });
  // Ends at about 6.2; one at 8.7 is too soon for the same type, one at 15.4 is far enough.
  assert.deepEqual(checkPicks({ scenes: [list(0), list(12)] }, ws, library, { duration: 40 }).scenes.map((s) => s.from), [0]);
  assert.deepEqual(checkPicks({ scenes: [list(0), list(27)] }, ws, library, { duration: 40 }).scenes.map((s) => s.from), [0, 27]);
  assert.ok(ws[27].start - 0.15 - 6.2 >= SCENE_REPEAT_GAP);
});

test("bare stretches find spoken runs with nothing on screen, after the title", async () => {
  const { bareStretches } = await import("../src/glow.mjs");
  const ws = Array.from({ length: 30 }, (_, i) => ({ text: "word", start: 3 + i * 0.4, end: 3 + i * 0.4 + 0.3 }));
  const picks = { features: [{ from: 5, to: 8 }], icons: [], overlays: [], scenes: [] };
  const bare = bareStretches(picks, ws, 20, 3, 2.5);
  assert.ok(bare.length >= 1);
  assert.ok(bare.every((s) => ws[s.to].end - ws[s.from].start >= 2.5));
  assert.ok(bare.every((s) => s.to < 5 || s.from > 8));
  assert.deepEqual(bareStretches({ features: [], icons: [], overlays: [], scenes: [] }, ws.slice(0, 3), 10, 3, 2.5), []);
});
