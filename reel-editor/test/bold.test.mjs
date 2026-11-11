import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boldEnabled, boldSettings, boldText, boldPrompt, validateBoldPicks, fallbackBoldDirection, groupBoldWords, boldFaceBoxes, layoutBold, prepareBoldPlan, restyleBold } from "../src/bold.mjs";
import { boldBoxesOverlap } from "../src/bold-overlays.mjs";
import { loadPreset } from "../src/presets.mjs";
import { carryProjectAudio } from "../src/glow.mjs";
import { allowedFile } from "../scripts/release.mjs";

const said = "Stop chasing every single lead. Ask better questions and find the right clients. Ten calls can change your business when you ask the right questions.";
const words = said.split(" ").map((text, i) => ({ text, start: i * 0.35, end: i * 0.35 + 0.3 }));
const direction = () => ({ schemaVersion: 1, argument: { buyerProblem: { from: 0, to: 4, reason: "Chasing poor fit leads" }, answer: { from: 5, to: 12, reason: "Ask useful questions" }, payoff: { from: 13, to: 17, reason: "Calls change the business" } }, headline: { from: 0, to: 4, emphasis: 1, reason: "The buyer's actual problem" }, punch: [{ from: 13, to: 17, role: "payoff", reason: "The spoken call count earns emphasis", emphasis: 13, payoff: 13 }], emphasis: [{ word: 7, gold: true, reason: "Better questions are the answer" }], turns: [{ from: 6, to: 8, reason: "Turn from the problem to the answer" }], overlays: [] });
const plan = () => ({ name: "bold-fixture", preset: "pingel-bold", style: loadPreset("pingel-bold"), canvas: { width: 1080, height: 1920 }, words: structuredClone(words), video: { src: "/fixture.mp4", duration: 15, fps: 30, hasAudio: true }, framing: { scale: 1, origin: "50% 38%" }, audio: { tracks: [{ id: "music", src: "assets/music.mp3", start: 0, duration: 15, volume: 0.1 }, { id: "narration", src: "assets/voice.mp3" }, { id: "sfx-old", src: "assets/sfx/drop.wav" }] } });

test("bold is Greg-only, portrait-only and opt-in, including saved plans and hand-edited presets", async () => {
  const p = plan();
  assert.equal(boldEnabled(p.style, p, {}), true);
  for (const env of [{ REEL_CLIENT: "jane" }, { REEL_CLIENT_MODE: "1" }]) {
    assert.equal(boldEnabled(p.style, p, env), false);
    let asks = 0; const lines = [];
    const refused = await restyleBold(p, { env, ask: async () => { asks++; }, log: (line) => lines.push(line) });
    assert.equal(asks, 0); assert.equal(refused.plan, p); assert.equal(lines.length, 1);
  }
  for (const preset of ["clean", "brand-jane", "vsl", "speaker", "youtube"]) assert.equal(boldEnabled(p.style, { ...p, preset }, {}), false);
  for (const canvas of [{ width: 1920, height: 1080 }, { width: 1080, height: 1080 }]) assert.equal(boldEnabled(p.style, { ...p, canvas }, {}), false);
  assert.equal(boldEnabled({ bold: { enabled: false } }, p, {}), false);
  assert.equal(boldEnabled(null, null, {}), false);
});

test("preset inherits the engine and keeps all competing automatic planners off; release excludes it", () => {
  const p = loadPreset("pingel-bold"), base = loadPreset("pingel-brand");
  for (const key of ["cuts", "audio", "finish", "cover"]) assert.deepEqual(p[key], base[key], key);
  for (const key of ["glow", "graphics", "slams", "icons", "coldOpen", "houseLooks", "broll"]) assert.equal(p[key].enabled, false, key);
  assert.equal(p.motion.impact.enabled, false); assert.equal(p.motion.drift.enabled, false);
  assert.equal(p.zooms.cadence.enabled, false); assert.equal(base.glow.enabled, true);
  assert.equal(allowedFile("presets/pingel-bold.json"), false);
  assert.equal(allowedFile("src/bold.mjs"), true);
  const cfg = boldSettings(); cfg.zone.left = 0;
  assert.equal(boldSettings().zone.left, 76, "defaults cannot be mutated through a result");
  assert.equal(boldSettings({ bold: { quiet: { size: 80 } } }).quiet.size, 80);
});

test("argument prompt has no graphic quota and permits only transcript-index direction", () => {
  const prompt = boldPrompt(words, { duration: 15 });
  for (const rule of [/argument.*before/i, /buyerProblem/, /argument.answer/, /argument.payoff/, /no graphic quota/, /no compulsory full-screen/, /Default to quiet/, /never times, positions or new copy/, /25%/, /0 Stop/]) assert.match(prompt, rule);
  assert.equal(boldText('“Greg—said…” 💰'), "Greg said");
});

test("strict validation accepts grounded ranges and rejects junk, overlaps, invented headlines and payoff numbers", () => {
  const valid = direction();
  assert.equal(validateBoldPicks(valid, words).headline.emphasis, 1);
  assert.deepEqual(valid, direction(), "validation preserves its input");
  const invalid = [null, {}, { ...valid, schemaVersion: 2 }, { ...valid, headline: { ...valid.headline, from: -1 } }, { ...valid, headline: { ...valid.headline, text: "Make a million dollars" } }, { ...valid, headline: { ...valid.headline, to: words.length } }, { ...valid, headline: { ...valid.headline, emphasis: 10 } }, { ...valid, argument: { ...valid.argument, answer: { from: 3, to: 6, reason: "overlap" } } }, { ...valid, punch: [...valid.punch, valid.punch[0]] }, { ...valid, punch: [{ ...valid.punch[0], payoff: 16 }] }, { ...valid, punch: [{ ...valid.punch[0], role: "magic" }] }, { ...valid, turns: [{ from: 0.5, to: 4, reason: "fraction" }] }, { ...valid, emphasis: [{ word: 999, gold: true, reason: "invented" }] }, { ...valid, emphasis: [valid.emphasis[0], valid.emphasis[0]] }, { ...valid, overlays: [{ kind: "unknown", from: 0, to: 999, reason: "bad range" }] }];
  for (const reply of invalid) assert.throws(() => validateBoldPicks(reply, words));
  assert.deepEqual(validateBoldPicks({ ...valid, overlays: [{ kind: "unknown", from: 0, to: 2, reason: "No registered handler" }] }, words).overlays, []);
});

test("fallback uses the first spoken sentence and never adds filler to short or empty transcripts", () => {
  const picks = fallbackBoldDirection(words);
  assert.deepEqual([picks.headline.from, picks.headline.to], [0, 4]);
  assert.deepEqual(picks.punch, []);
  assert.equal(fallbackBoldDirection([]).headline, null);
  assert.equal(fallbackBoldDirection([{ text: "Listen.", start: 0, end: 0.4 }]).headline.to, 0);
  assert.equal(fallbackBoldDirection(Array.from({ length: 20 }, () => ({ text: "spoken" }))).headline.to, 7);
});

test("caption coverage is exact across rapid speech, pauses, repeated words, punctuation and coincident timestamps", () => {
  const cases = [words, words.map((w, i) => ({ ...w, start: i * 0.07, end: i * 0.07 + 0.06 })), words.map((w) => ({ ...w, text: "same", start: 0, end: 0.2 })), words.map((w, i) => ({ ...w, start: i * 0.35 + (i > 8 ? 2 : 0), end: i * 0.35 + (i > 8 ? 2 : 0) + 0.3 })), [{ text: "...", start: 0, end: 0.3 }, { text: "I", start: 0.35, end: 0.7 }, { text: "I", start: 0.8, end: 1 }]];
  for (const ws of cases) {
    const before = structuredClone(ws);
    const groups = groupBoldWords(ws, 18);
    assert.deepEqual(groups.flatMap((g) => Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i)), ws.map((_, i) => i));
    assert.deepEqual(ws, before);
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]; assert.ok(Number.isInteger(g.startFrame) && Number.isInteger(g.endFrame)); assert.ok(g.endFrame > g.startFrame); assert.ok(g.end <= 18);
      if (groups[i + 1]) assert.ok(g.endFrame <= groups[i + 1].startFrame);
    }
    assert.ok(groups.every((g) => g.mode === "quiet"));
  }
  assert.deepEqual(groupBoldWords([], 0), []);
  assert.throws(() => groupBoldWords([{ text: "bad", start: NaN, end: 1 }], 2), /timing/);
});

test("protected phrases and amounts keep their group and line boundaries, and fast fragments merge", () => {
  const ws = "Call one hundred thousand dollars the real cost today".split(" ").map((text, i) => ({ text, start: i * 0.13, end: i * 0.13 + 0.11 }));
  const groups = groupBoldWords(ws, 2, undefined, { protectedPhrases: ["real cost"] });
  const amount = groups.find((g) => g.from <= 1 && g.to >= 4);
  assert.ok(amount); assert.ok(amount.protectedBreaks.length >= 3);
  assert.ok(groups.some((g) => g.from <= 6 && g.to >= 7));
  assert.ok(groups.slice(0, -1).every((g) => g.end - g.start >= 0.4 - 1 / 30));
  const rapid = Array.from({ length: 10 }, (_, i) => ({ text: "word", start: i * 0.07, end: i * 0.07 + 0.06 }));
  assert.ok(groupBoldWords(rapid, 0.7).every((g) => g.endFrame - g.startFrame >= 12), "a rapid final fragment joins backwards");
});

test("punch and quiet gold budgets are enforced without dropping transcript words", () => {
  const picks = direction();
  picks.punch = [{ from: 0, to: words.length - 1, role: "rant", emphasis: 0, reason: "Rant" }];
  picks.emphasis = words.map((_, word) => ({ word, gold: true, reason: "word" }));
  const groups = groupBoldWords(words, 15, picks);
  const quiet = groups.filter((g) => g.mode === "quiet");
  assert.ok(groups.filter((g) => g.mode === "punch").length <= Math.floor(groups.length * 0.4));
  assert.ok(quiet.filter((g) => g.emphasis?.gold).length <= Math.floor(quiet.length * 0.25));
  assert.ok(groups.every((g) => !g.emphasis || Number.isInteger(g.emphasis.word)));
  const settings = boldSettings(); settings.phrases.punchShare = 1;
  const selected = { ...direction(), punch: [{ from: 2, to: 4, role: "objection", emphasis: 4, reason: "This phrase answers the objection" }] };
  const precise = groupBoldWords(words, 15, selected, { settings });
  assert.deepEqual(precise.filter((g) => g.mode === "punch").flatMap((g) => Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i)), [2, 3, 4], "a punch span can start inside an ordinary phrase");
});

test("layout reserves captions beneath all measured chins and puts the headline above a low head", () => {
  const p = plan(), picks = validateBoldPicks(direction(), words);
  const detection = { frames: [{ t: 0, faces: [{ x: 0.3, y: 0.32, w: 0.35, h: 0.16 }] }, { t: 4, faces: [{ x: 0.3, y: 0.31, w: 0.35, h: 0.19 }] }] };
  const out = layoutBold(p, picks, detection);
  assert.equal(out.zones.measured, true);
  assert.equal(out.headline.startFrame, 0); assert.equal(out.headline.endFrame, 90);
  assert.equal(out.headline.place.y, 200);
  assert.ok(out.zones.caption.y >= out.zones.chin + 32);
  assert.ok(out.groups.every((g) => g.place.y + g.place.h <= 1600));
  assert.equal(boldBoxesOverlap(out.zones.caption, out.zones.headline), false);
  for (const face of out.zones.faces) {
    assert.equal(boldBoxesOverlap(face, out.zones.headline), false);
    assert.equal(boldBoxesOverlap(face, out.zones.caption), false);
  }
  const none = layoutBold(p, picks, null);
  assert.equal(none.zones.measured, false); assert.equal(none.groups[0].startFrame, 0);
});

test("face projection accounts for final punch-in scale and compositor lift", () => {
  const detection = { frames: [{ t: 4, faces: [{ x: 0.3, y: 0.2, w: 0.3, h: 0.2 }] }] };
  const base = boldFaceBoxes(detection), zoomed = boldFaceBoxes(detection, { zooms: [{ t: 3, scale: 1.2 }], origin: "50% 38%" });
  assert.equal(zoomed[0].w, base[0].w * 1.2);
  assert.ok(zoomed[0].y < base[0].y);
  assert.deepEqual(boldFaceBoxes(null), []);
});

test("restyle makes one injected call, caches direction, measures the baseline and leaves its input intact", async () => {
  const p = plan(), before = structuredClone(p); let asks = 0, detects = 0;
  const options = { env: {}, render: "/baseline.mp4", ask: async () => { asks++; return JSON.stringify(direction()); }, detect: async (file, times) => { detects++; assert.equal(file, "/baseline.mp4"); assert.ok(times.every((time) => Math.abs(time * 30 - Math.round(time * 30)) < 1e-7)); return { frames: [{ t: 0, faces: [{ x: 0.3, y: 0.2, w: 0.3, h: 0.25 }] }] }; } };
  const first = await restyleBold(p, options);
  assert.deepEqual(p, before); assert.equal(asks, 1); assert.equal(detects, 1);
  assert.equal(first.plan.bold.schemaVersion, 1);
  assert.ok(first.plan.captions.length > 0); assert.equal(first.plan.captions[0].from, 0);
  assert.deepEqual(first.plan.audio.tracks.map((t) => t.id), ["music", "narration"]);
  assert.deepEqual(first.plan.bold.overlays, []);
  const protectedRun = await restyleBold(p, { ...options, picks: first.picks, protectedPhrases: ["better questions and find"] });
  assert.ok(protectedRun.plan.bold.groups.some((g) => g.from <= 6 && g.to >= 9));
  assert.ok(first.plan.bold.events.every((event) => Math.abs(event.landing * 30 - event.landingFrame) < 1e-7));
  const second = await restyleBold(p, { ...options, picks: first.picks });
  assert.equal(asks, 1); assert.deepEqual(second.plan.bold, first.plan.bold);
});

test("offline, malformed and absent direction use all quiet fallback, reusable without a second call", async () => {
  for (const ask of [async () => { throw new Error("offline"); }, async () => "junk", async () => JSON.stringify({ schemaVersion: 1 })]) {
    const lines = []; const first = await restyleBold(plan(), { env: {}, ask, log: (line) => lines.push(line) });
    assert.equal(first.picks.fallback, true); assert.equal(lines.length, 1);
    assert.ok(first.plan.bold.groups.every((g) => g.mode === "quiet"));
    const second = await restyleBold(plan(), { env: {}, picks: first.picks, ask: async () => { assert.fail("cached fallback asks again"); } });
    assert.deepEqual(second.plan.bold, first.plan.bold);
  }
});

test("cached direction cannot reuse indexes for another transcript and object-returning ask fakes work", async () => {
  const p = plan(); const first = await restyleBold(p, { env: {}, ask: async () => direction() });
  assert.ok(first.picks.transcriptHash); assert.equal(first.picks.fallback, undefined);
  p.words[0].text = "Different";
  const messages = [];
  const second = await restyleBold(p, { env: {}, picks: first.picks, log: (line) => messages.push(line), ask: async () => assert.fail("cached validation must not ask") });
  assert.equal(second.picks.fallback, true); assert.match(messages[0], /another transcript/);
  const empty = { ...plan(), words: [] };
  assert.deepEqual((await restyleBold(empty, { env: {}, ask: async () => assert.fail("no words") })).plan.bold.groups, []);
});

test("semantic zooms and returns all land on transcript beats, while no-face failures keep captions", async () => {
  const p = plan(); p.words = Array.from({ length: 160 }, (_, i) => ({ text: i % 4 ? "said" : "Listen.", start: i * 0.4, end: i * 0.4 + 0.3 })); p.video.duration = 65;
  const picks = { schemaVersion: 1, argument: { buyerProblem: null, answer: null, payoff: null }, headline: { from: 1, to: 4, emphasis: 1, reason: "Spoken promise" }, punch: [], emphasis: [], turns: [3, 25, 48, 70, 93, 116, 139].map((from) => ({ from, to: from + 1, reason: "Argument turn" })), overlays: [] };
  const result = await restyleBold(p, { env: {}, picks, render: "/baseline", detect: async () => { throw new Error("unavailable"); } });
  for (const key of result.plan.zooms) {
    assert.ok(picks.turns.some((pick) => Math.abs(p.words[pick.from].start - key.t) < 1 / 30));
    assert.ok(result.plan.zooms.filter((other) => other.t > key.t - 30 && other.t <= key.t).length <= 4);
  }
  assert.equal(result.plan.bold.zones.measured, false); assert.equal(result.plan.captions.flatMap((g) => g.words).length, 160);
  p.head = { top: 0.1, bottom: 0.9 };
  const tight = await restyleBold(p, { env: {}, picks });
  assert.ok(tight.plan.bold.zones.caption.y + tight.plan.bold.zones.caption.h <= 1600);
});

test("an extreme close crop gains safe chest room and every framing move has a semantic event", async () => {
  const p = plan();
  const result = await restyleBold(p, { env: {}, picks: direction(), render: "/baseline.mp4", detect: async () => ({ frames: [{ t: 0, faces: [{ x: 0.2, y: 0.3, w: 0.6, h: 0.5 }] }] }) });
  const b = result.plan.bold;
  assert.ok(result.plan.framing.shift < 0);
  assert.ok(b.zones.caption.y >= b.zones.chin + 32 - 0.01);
  assert.ok(b.zones.caption.y + b.zones.caption.h <= 1600);
  for (const face of b.zones.faces) assert.equal(boldBoxesOverlap(face, b.zones.caption), false);
  assert.ok(result.plan.zooms.length <= 4);
  assert.equal(b.events.filter((event) => event.kind === "framing").length, result.plan.zooms.length);
  const quiet = await restyleBold(p, { env: {}, picks: fallbackBoldDirection(words) });
  assert.deepEqual(quiet.plan.zooms, []);
});

test("preparing a restyle removes glow and legacy visual lanes, keeps cuts, footage, music and carried project audio", (t) => {
  const p = plan(); Object.assign(p, { cuts: { segments: [{ start: 0, end: 15 }] }, glowScenes: [{}], glowOverlays: [{}], bold: {}, hook: {}, graphics: [{}], slams: [{}], broll: [{}], icons: [{}], coldOpen: {}, motion: {} });
  const base = prepareBoldPlan(p);
  assert.deepEqual(base.cuts, p.cuts); assert.deepEqual(base.video, p.video);
  for (const key of ["glowScenes", "glowOverlays", "bold"]) assert.equal(base[key], undefined);
  for (const key of ["graphics", "slams", "broll", "icons", "captions", "evidence"]) assert.deepEqual(base[key], []);
  assert.equal(base.motion, null);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bold-audio-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const src = path.join(root, "src"), dest = path.join(root, "dest"); fs.mkdirSync(path.join(src, "project/assets"), { recursive: true });
  fs.writeFileSync(path.join(src, "project/assets/music.mp3"), "real licensed music");
  assert.deepEqual(carryProjectAudio(src, dest, base), ["assets/music.mp3"]);
  assert.equal(fs.readFileSync(path.join(dest, "project/assets/music.mp3"), "utf8"), "real licensed music");
});
