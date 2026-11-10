import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPicks, fitsTwoLines, layoutGlow, chinDuring } from "../src/glow.mjs";

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
  assert.deepEqual(picks.icons.map((p) => p.icon), ["ear", "target"]);
  assert.equal(picks.scenes.length, 1);
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
