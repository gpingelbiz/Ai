import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import { boldTalkPrompt, validateBoldSpeakers, boldSpeakersFromTurns, resolveBoldTalk, boldTalkCSS, validateBoldTopic, placeBoldTopic } from "../src/bold-talk.mjs";
import { boldSettings, validateBoldPicks, fallbackBoldDirection, groupBoldWords, restyleBold } from "../src/bold.mjs";
import { boldHTML, boldCSS, boldOverlayTimeline } from "../src/bold-render.mjs";
import { placeBoldOverlays, boldBoxesOverlap, boldOverlayHandler } from "../src/bold-overlays.mjs";
import { loadPreset } from "../src/presets.mjs";
import { renderHTML } from "../src/compose.mjs";
import { fixturePlan } from "../scripts/golden.mjs";

const words = "Ask better questions and listen to the answer. What do you say when they ask about price? We help them choose the right solution.".split(" ").map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));
const other = { from: 8, to: 16, speaker: "other", reason: "A caller asks Greg a real question" };
const topic = { kind: "topic", from: 0, to: 3, reason: "The conversation is about asking better questions" };
const direction = () => ({ ...fallbackBoldDirection(words), fallback: undefined, speakers: [other], overlays: [topic] });
const plan = () => ({ ...fixturePlan("/fixture.mp4"), preset: "pingel-bold", style: loadPreset("pingel-bold"), words: structuredClone(words), video: { src: "/fixture.mp4", duration: 12 }, audio: { tracks: [] } });
const detection = () => ({ frames: Array.from({ length: 24 }, (_, i) => ({ t: i / 2, faces: [{ x: 0.38, y: 0.32, w: 0.2, h: 0.18 }] })) });

test("speaker prompt and optional direction validate inclusive ranges without names, text or overlap", () => {
  assert.match(boldTalkPrompt(), /All unmarked words belong to Greg/);
  assert.match(boldTalkPrompt(), /Never mark Greg quoting/);
  assert.deepEqual(validateBoldSpeakers(undefined, words), []);
  assert.deepEqual(validateBoldSpeakers([other], words), [other]);
  const valid = direction();
  assert.deepEqual(validateBoldPicks(valid, words).speakers, [other]);
  for (const speakers of [{}, [null], [{ ...other, from: -1 }], [{ ...other, to: words.length }], [{ ...other, from: 0.5 }], [{ ...other, speaker: "Greg" }], [{ ...other, text: "Invented" }], [{ ...other, reason: "" }], [other, other]]) {
    assert.throws(() => validateBoldSpeakers(speakers, words));
    assert.throws(() => validateBoldPicks({ ...valid, speakers }, words));
  }
  const old = { ...valid }; delete old.speakers;
  assert.equal(validateBoldPicks(old, words).speakers, undefined, "old saved direction stays compatible");
});

test("face turns map words by overlap, preserve uncertainty and never assume a face identity", () => {
  const turns = [{ start: 0, end: 3.2, person: 0 }, { start: 3.2, end: 6.8, person: 1 }, { start: 6.8, end: 12, person: 0 }];
  const ranges = boldSpeakersFromTurns(words, turns, 0);
  assert.deepEqual(ranges.map((p) => [p.from, p.to]), [[8, 16]]);
  assert.deepEqual(boldSpeakersFromTurns(words, turns, null), []);
  assert.deepEqual(boldSpeakersFromTurns(words, null, 0), []);
  assert.deepEqual(boldSpeakersFromTurns(words, [...turns, { start: 1, end: 4, person: 2 }], 0), []);
  assert.deepEqual(boldSpeakersFromTurns([{ start: 1, end: 3 }], [{ start: 1, end: 2, person: 0 }, { start: 2, end: 3, person: 1 }], 0), []);
});

test("conversations use existing face turns when identity is configured, then marked speech, then Greg", async () => {
  const p = plan(), settings = boldSettings(p.style), det = detection();
  det.frames.forEach((f) => f.faces.push({ x: 0.72, y: 0.32, w: 0.15, h: 0.18 }));
  let scans = 0;
  const timeline = async (_video, _words, opts) => { scans++; assert.equal(opts.people.length, 2); return { turns: [{ start: 0, end: 3.2, person: 0 }, { start: 3.2, end: 6.8, person: 1 }, { start: 6.8, end: 12, person: 0 }] }; };
  const unknown = await resolveBoldTalk(p, {}, det, { settings, render: "/baseline.mp4", timeline });
  assert.equal(scans, 1); assert.deepEqual(unknown.speakers, []); assert.ok(unknown.conversation);
  settings.talk.gregPerson = 0;
  const detected = await resolveBoldTalk(p, { speakers: [{ ...other, from: 0, to: 1 }] }, det, { settings, render: "/baseline.mp4", timeline });
  assert.equal(detected.source, "faces"); assert.deepEqual(detected.speakers.map((p) => [p.from, p.to]), [[8, 16]]);
  p.speakerTurns = [{ start: 0, end: 3.2, person: 0 }, { start: 3.2, end: 6.8, person: 1 }];
  await resolveBoldTalk(p, {}, det, { settings, timeline: () => assert.fail("saved turns should be reused") });
  delete p.speakerTurns;
  const marked = await resolveBoldTalk(p, direction(), detection(), { settings, timeline: () => assert.fail("one face should not scan lip turns") });
  assert.equal(marked.source, "direction"); assert.deepEqual(marked.speakers, [other]);
  assert.equal((await resolveBoldTalk(p, {}, detection(), { settings })).conversation, null);
  assert.deepEqual((await resolveBoldTalk(p, direction(), det, { settings, render: "/baseline.mp4", timeline: async () => { throw new Error("unavailable"); } })).speakers, [other]);
  settings.talk.enabled = false;
  assert.equal((await resolveBoldTalk(p, direction(), det, { settings })).conversation, null);
});

test("every grouping and merge stage respects speaker boundaries, including protected amounts and coincident times", () => {
  const cases = [words, words.map((w, i) => ({ ...w, start: i * 0.025, end: i * 0.025 + 0.02 })), words.map((w) => ({ ...w, start: 0, end: 0.2 })), words.map((w, i) => ({ ...w, text: i === 7 ? "100" : i === 8 ? "dollars" : w.text }))];
  for (const ws of cases) {
    const settings = boldSettings(); settings.phrases.protectedPhrases = ["100 dollars", "answer What"];
    const groups = groupBoldWords(ws, 12, direction(), { settings });
    assert.deepEqual(groups.flatMap((g) => Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i)), ws.map((_, i) => i));
    for (const [i, g] of groups.entries()) {
      assert.ok(g.to < other.from || g.from > other.to || (g.from >= other.from && g.to <= other.to), JSON.stringify(g));
      assert.equal(g.speaker === "other", g.from >= other.from && g.to <= other.to);
      assert.ok(g.endFrame > g.startFrame);
      if (groups[i + 1]) assert.ok(g.endFrame <= groups[i + 1].startFrame);
    }
  }
  assert.deepEqual(groupBoldWords(words, 12, { ...direction(), speakers: [] }), groupBoldWords(words, 12, { ...direction(), speakers: undefined }));
});

test("other-speaker captions stay quiet and lighter gold, with Greg bone and no extra sound", async () => {
  const p = plan(), picks = direction();
  picks.punch = [{ from: 8, to: 16, role: "objection", emphasis: 16, reason: "Caller question" }];
  picks.emphasis = [{ word: 2, gold: true, reason: "Important action" }];
  const { plan: result } = await restyleBold(p, { picks, env: {}, render: "/baseline.mp4", detect: async () => detection() });
  const settings = boldSettings(p.style), html = boldHTML(result, { settings }), css = boldCSS(settings, result);
  const others = result.bold.groups.filter((g) => g.speaker === "other");
  assert.ok(others.length); assert.ok(others.every((g) => g.mode === "quiet" && g.emphasis === null));
  assert.ok(result.bold.groups.filter((g) => !g.speaker).every((g) => !g.emphasis?.gold));
  assert.match(html, /bold-caption bold-quiet bold-other/);
  assert.match(css, /\.bold-root \.bold-other \.bold-word \{ color:#C8A24B; font-weight:600/);
  assert.equal(result.audio.tracks.length, 0);
  assert.equal(boldTalkCSS(settings, { bold: { groups: [] } }), "");
  assert.equal(result.captions.flatMap((g) => g.words).length, words.length);
});

test("one verbatim 4 to 7 word topic holds after the headline, only for a safely placed conversation", async () => {
  const p = plan(), settings = boldSettings(p.style);
  for (const pick of [{ ...topic, to: 2 }, { ...topic, to: 7 }, { ...topic, text: "An invented topic" }]) assert.equal(validateBoldTopic(pick, { words, settings }), null);
  assert.deepEqual(validateBoldTopic(topic, { words, settings }), {});
  const { plan: result } = await restyleBold(p, { picks: direction(), env: {}, render: "/baseline.mp4", detect: async () => detection() });
  const accepted = result.bold.overlays.filter((e) => e.kind === "topic");
  assert.equal(accepted.length, 1);
  const event = accepted[0];
  assert.equal(event.startFrame, result.bold.headline.endFrame); assert.equal(event.endFrame, Math.ceil(words.at(-1).end * 30));
  assert.ok(!boldBoxesOverlap(event.box, result.bold.zones.caption));
  assert.match(boldHTML(result, { settings }), /Ask better questions and<\/span>/);
  assert.match(boldOverlayTimeline(result, settings), /bold-topic/);
  result.words[0].text = "<script>";
  assert.match(boldHTML(result, { settings }), /&lt;script&gt;/);
  const context = { plan: result, words, settings, talk: result.bold.talk, zones: result.bold.zones, fps: 30, duration: 12, overlays: [event] };
  assert.equal(placeBoldTopic(event, context), null, "at most one topic");
  assert.deepEqual(placeBoldOverlays([topic], { ...context, talk: { conversation: null } }), []);
  assert.deepEqual(placeBoldOverlays([topic], { ...context, zones: { ...context.zones, measured: false } }), []);
  assert.deepEqual(placeBoldOverlays([topic], { ...context, zones: { ...context.zones, faces: [{ ...event.box, start: 0, end: 12 }] } }), []);
  const solo = await restyleBold(p, { picks: { ...direction(), speakers: [] }, env: {}, render: "/baseline.mp4", detect: async () => detection() });
  assert.deepEqual(solo.plan.bold.overlays, []);
  settings.talk.topic.enabled = false;
  assert.equal(validateBoldTopic(topic, { words, settings }), null);
});

test("conversation metadata and registered extras leave every legacy preset's HTML byte-identical", () => {
  for (const name of ["clean", "pingel-brand", "pingel-v2", "pingel-runway", "vsl", "speaker", "youtube"]) {
    const p = fixturePlan("/fixture.mp4"); p.preset = name; p.style = loadPreset(name);
    const before = renderHTML(p, "assets/footage.mp4");
    p.bold = { talk: { speakers: [other] }, overlays: [topic], groups: [] };
    p.speakerTurns = [{ person: 1, start: 0, end: 10 }];
    const after = renderHTML(p, "assets/footage.mp4");
    assert.equal(createHash("sha256").update(after).digest("hex"), createHash("sha256").update(before).digest("hex"), name);
    assert.doesNotMatch(after, /bold-topic|bold-other|bold-sticker|bold-payoff/);
  }
});

test("topic hard handoffs restore exactly at headline end and conversation end under arbitrary GSAP seeks", (t) => {
  const sandbox = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), sandbox);
  const gsap = sandbox.window.gsap, timeline = gsap.timeline({ paused: true }), card = { opacity: 0 };
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const tl = { set: (_selector, values, at) => { timeline.set(card, values, at); return tl; } };
  const event = { startFrame: 90, endFrame: 270, start: 3, end: 9 };
  new Function("tl", boldOverlayHandler("topic").timeline(event, { i: 0 }))(tl);
  const snapshot = (frame) => { timeline.totalTime(frame / 30, false); return card.opacity; };
  const frames = Array.from({ length: 300 }, (_, i) => i), forward = frames.map(snapshot);
  assert.equal(forward[89], 0); assert.equal(forward[90], 1); assert.equal(forward[269], 1); assert.equal(forward[270], 0);
  for (const frame of frames.toReversed()) assert.equal(snapshot(frame), forward[frame]);
  for (let i = 0; i < 300; i++) { const frame = i * 137 % 300; assert.equal(snapshot(frame), forward[frame]); }
});
