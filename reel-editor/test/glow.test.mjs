import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPicks, fitsTwoLines, layoutGlow, chinDuring, glowPrompt, pacingReport, restyleGlow } from "../src/glow.mjs";

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
  assert.deepEqual(picks.icons.map((p) => p.icon), ["ear"], "the third band element in 3 seconds is trimmed");
  assert.equal(picks.scenes.length, 1);
});

test("glow direction follows argument beats, camera space and subtitle-only holds", () => {
  const prompt = glowPrompt(words, library, { duration: 30 });
  for (const rule of [/For each beat choose a graphic/, /zooms are planned elsewhere/, /2 to 4 seconds/, /25 to 35%/, /1.2 seconds settled/, /2 band elements/, /first 3 seconds/]) assert.match(prompt, rule);
  assert.doesNotMatch(prompt, /almost all the time|nearly every phrase|at least four different/);
});

test("pacing trims rolling band windows by value, preserves its inputs and is idempotent", () => {
  const ws = Array.from({ length: 8 }, (_, i) => ({ text: "point", start: 4 + i * 0.5, end: 4.3 + i * 0.5 }));
  ws[7] = { text: "point", start: 8.1, end: 8.4 };
  const picks = { features: [{ from: 2, to: 3, key: 2 }], overlays: [{ type: "stamp", from: 4, to: 4 }], icons: [{ word: 0, icon: "ear" }, { word: 1, icon: "target" }, { word: 7, icon: "ear" }], scenes: [] };
  const before = structuredClone(picks);
  const report = pacingReport(picks, ws, 20);
  assert.deepEqual(picks, before);
  assert.deepEqual(report.picks.features, picks.features);
  assert.deepEqual(report.picks.overlays, picks.overlays);
  assert.deepEqual(report.picks.icons, [picks.icons[2]], "features and overlays outrank earlier decorative icons");
  assert.equal(report.dropped.filter((d) => d.reason === "band-window").length, 2);
  assert.deepEqual(pacingReport(report.picks, ws, 20).picks, report.picks);
});

test("band windows roll across fixed buckets and allow exactly three seconds between first and third", () => {
  const ws = [5.9, 6.2, 8.8, 8.9].map((start) => ({ text: "point", start, end: start + 0.1 }));
  const picks = { icons: [0, 1, 2, 3].map((word) => ({ word, icon: `icon-${word}` })) };
  const report = pacingReport(picks, ws, 30);
  assert.deepEqual(report.picks.icons.map((p) => p.word), [0, 1, 3]);
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
  assert.deepEqual(report.picks.scenes.map((s) => s.from), [0, 6]);
  assert.deepEqual(report.picks.overlays.map((o) => o.from), [4, 9]);
  assert.equal(report.picks.features.length, 0);
  assert.equal(report.picks.icons.length, 0);
  const out = layoutGlow({ words: ws, video: { duration: 30 } }, report.picks, library, null);
  assert.ok(out.overlays[0].start - out.scenes[0].end >= 1.2);
  assert.ok(out.scenes[1].start - out.scenes[0].end >= 1.2);
  assert.equal(out.scenes[1].end, 15, "the final step gets its full 0.9-second hold");
  assert.ok(out.overlays[1].start - out.scenes[1].end >= 1.2);
});

test("scene settling is applied by checkPicks before layout", () => {
  const ws = [4, 4.2, 6.9, 7.2, 10].map((start) => ({ text: "point", start, end: start + 0.15 }));
  const picks = checkPicks({ scenes: [{ type: "icons", from: 0, to: 1, icons: ["ear"] }, { type: "quote", from: 2, to: 2 }], overlays: [{ type: "stamp", word: 2 }, { type: "stamp", word: 3 }] }, ws, library, { duration: 30 });
  assert.equal(picks.scenes.length, 1, "6.75 entrance is less than 1.2 seconds after the 5.75 exit");
  assert.deepEqual(picks.overlays.map((o) => o.from), [3]);
  const repeats = checkPicks({ scenes: [{ type: "icons", from: 0, to: 1, icons: ["ear"] }, { type: "quote", from: 2, to: 2 }, { type: "icons", from: 4, to: 4, icons: ["ear"] }] }, ws, library, { duration: 30 });
  assert.equal(repeats.scenes.length, 1, "dropping a crowded intervening scene must not leave repeated scene types");
});

test("pacing drops icons first to restore at least 25% clean holds and reports sparse gaps", () => {
  const ws = [3.2, 3.8, 5, 6, 7, 8, 9].map((start) => ({ text: "point", start, end: start + 0.8 }));
  const report = pacingReport({ features: [{ from: 0, to: 3 }], icons: [{ word: 5, icon: "ear" }, { word: 6, icon: "target" }] }, ws, 10);
  assert.ok(report.cleanFraction >= 0.25);
  assert.equal(report.picks.features.length, 1);
  assert.equal(report.picks.icons.length, 0);
  assert.ok(report.dropped.some((d) => d.reason === "clean-hold"));
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
  assert.equal(picks.icons.length, 1);
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
