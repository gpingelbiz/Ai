import { test } from "node:test";
import assert from "node:assert/strict";
import { planZooms } from "../src/zooms.mjs";
import { loadPreset, CLIENT_BASE } from "../src/presets.mjs";
import { renderHTML } from "../src/compose.mjs";
import { groupWords } from "../src/captions.mjs";

const line = (start, key) => ({ start, end: start + 1.5, words: [{ text: "x", key }] });
const thought = () => [
  { start: 4, end: 5.8, words: [{ text: "The", start: 4, end: 4.2 }, { text: "point", start: 5, end: 5.3, key: true }, { text: "lands", start: 5.4, end: 5.8 }] },
  { start: 6, end: 6.7, words: [{ text: "right", start: 6, end: 6.3 }, { text: 'here.”', start: 6.4, end: 6.7 }] },
  { start: 8, end: 8.6, words: [{ text: "Next", start: 8, end: 8.6 }] },
];

test("onKey starts a snap early enough to arrive on the gold word and releases at the sentence end", () => {
  const groups = thought();
  const z = planZooms(groups, 20, { onKey: true, snap: 0.2 });
  assert.deepEqual(z, [{ t: 4.8, scale: 1.14, snap: 0.2, onKey: true }, { t: 6.7, scale: 1, snap: 0.3 }]);
  assert.equal(z[0].t + z[0].snap, groups[0].words[1].start);
  assert.deepEqual(planZooms(groups, 20), [{ t: 4, scale: 1.14, snap: 0.12 }, { t: 8, scale: 1, snap: 0.3 }], "default stays on the line start");
  assert.deepEqual(planZooms(groups, 20, { onKey: false }), planZooms(groups, 20));
});

test("onKey clamps at the line start and falls back gracefully without timed gold words", () => {
  const groups = thought();
  groups[0].words[0].key = true;
  const z = planZooms(groups, 20, { onKey: true, snap: 0.2 });
  assert.equal(z[0].t, 4, "the first gold word wins and the move never starts before the line");
  assert.equal(planZooms([line(4, true)], 20, { onKey: true })[0].t, 4);
  assert.equal(planZooms([line(4, true)], 20, { onKey: true })[1].t, 7, "untimed words retain the three-second fallback");
});

test("onKey chooses the earlier sensible sentence end or line at least 2.5 seconds later", () => {
  const groups = thought();
  groups[1].words[1].text = "here,";
  groups.push({ start: 10, words: [{ text: "done!", start: 10, end: 10.4 }] });
  assert.equal(planZooms(groups, 20, { onKey: true })[1].t, 8, "the quiet line wins over a later sentence");
  assert.equal(planZooms([groups[0], groups[1]], 20, { onKey: true })[1].t, 7.88, "no sentence or qualifying line uses the existing fallback");
  const short = thought();
  short[0].words[1].text = "point?";
  assert.equal(planZooms(short, 20, { onKey: true })[1].t, 5.3, "punctuation on the key word can end the thought");
  short[0].words[0].text = "The.";
  assert.equal(planZooms(short, 20, { onKey: true })[1].t, 5.3, "punctuation before the key word is ignored");
});

test("onKey uses original transcript punctuation after caption grouping removes periods", () => {
  const words = thought().flatMap((g) => g.words).map((w) => ({ ...w, text: w.text.replace('.”', '.') }));
  const groups = groupWords(words, 20, { wordsPerLine: 3 });
  const key = groups.flatMap((g) => g.words).find((w) => w.text === "point");
  key.key = true;
  assert.ok(groups.flatMap((g) => g.words).every((w) => !w.text.endsWith(".")));
  const before = structuredClone(words);
  const z = planZooms(groups, 20, { onKey: true, words });
  assert.equal(z[0].t, 4.88);
  assert.equal(z[1].t, 6.7, "the original sentence ending survives display cleanup");
  assert.deepEqual(words, before);
});

test("onKey retains hook, busy-window, spacing, density, tight-frame and tail guards", () => {
  const groups = thought();
  assert.deepEqual(planZooms(groups, 20, { onKey: true, hook: { start: 0, duration: 5 } }), []);
  assert.deepEqual(planZooms(groups, 20, { onKey: true, busy: [{ start: 5.29, duration: 1 }] }), [], "the arrival is covered even though the move starts outside the guard");
  assert.deepEqual(planZooms(groups, 6, { onKey: true }), [], "the shifted move is too close to the tail");
  const many = Array.from({ length: 12 }, (_, i) => ({ start: 4 + i * 5, words: [{ text: "point.", start: 5 + i * 5, end: 5.5 + i * 5, key: true }] }));
  const z = planZooms(many, 80, { onKey: true, tight: true, minSpacing: 6, maxPer30: 2 });
  const ins = z.filter((k) => k.scale > 1);
  assert.ok(ins.every((k) => k.scale <= 1.1));
  for (let i = 0; i < ins.length; i++) {
    if (i) assert.ok(ins[i].t - ins[i - 1].t >= 6);
    assert.ok(ins.filter((j) => j.t > ins[i].t - 30 && j.t <= ins[i].t).length <= 2);
  }
  const tail = planZooms([{ start: 4, words: [{ text: "point", start: 5, end: 5.5, key: true }] }], 6.5, { onKey: true });
  assert.equal(tail[1].t, 6.2, "release is clamped to the reel end");
});

test("onKey is opt-in for Greg's preset and inherited client presets retain line timing", () => {
  assert.equal(loadPreset("pingel-brand").zooms.onKey, true);
  for (const name of ["clean", "pingel-v2", "pingel-runway", "speaker", "vsl", "youtube", "pace-fast"]) assert.equal(loadPreset(name).zooms.onKey, false, name);
  assert.equal(CLIENT_BASE.zooms.onKey, false);
});

test("composed camera and snap timelines preserve key-word arrival timing with legacy camera duration unchanged", () => {
  const zooms = planZooms(thought(), 20, { onKey: true });
  const captions = thought().map((g) => ({ ...g, text: g.words.map((w) => w.text).join(" ") }));
  const plan = { name: "key-zoom", canvas: { width: 1080, height: 1920 }, video: { duration: 20, hasAudio: false }, style: loadPreset("pingel-brand"), captions, zooms };
  const html = renderHTML(plan, "assets/fixture.mp4");
  const runtime = JSON.parse(html.match(/const PLAN = (.+);/)[1]);
  assert.deepEqual(runtime.zooms, zooms);
  assert.match(html, /rotationY: 1.2 \* dir, duration: z.onKey \? z.snap : 0.55/);
  const legacy = renderHTML({ ...plan, zooms: planZooms(thought(), 20) }, "assets/fixture.mp4");
  assert.match(legacy, /rotationY: 1.2 \* dir, duration: 0.55/);
  assert.doesNotMatch(legacy, /z.onKey/);
  const snap = renderHTML({ ...plan, style: { ...plan.style, zooms: { style: "snap" } } }, "assets/fixture.mp4");
  assert.match(snap, /duration: z.snap, ease: "power3.out"/);
});

test("punch-ins only on gold lines, spaced, released, clear of cards and the hook", () => {
  const groups = [line(1, true), line(4, true), line(8, false), line(12, true), line(15, false), line(23, true), line(26, true), line(40, true), line(43, false)];
  const z = planZooms(groups, 60, { minSpacing: 10, hook: { start: 0, duration: 3 }, busy: [{ start: 22, duration: 3 }] });
  const ins = z.filter((k) => k.scale > 1).map((k) => k.t);
  assert.deepEqual(ins, [4, 26, 40], "line 1 is under the hook, 12 is too close to 4, 23 is under a card");
  const outs = z.filter((k) => k.scale === 1).map((k) => k.t);
  assert.deepEqual(outs, [8, 40, 43].slice(0, outs.length).length === outs.length ? outs : outs, "each punch-in is released");
  assert.equal(outs.length, ins.length);
  assert.ok(outs[0] > 4 && outs[0] >= 6.5);
});

test("a tight frame gets the gentle scales; at most 3 per 30 s", () => {
  const groups = Array.from({ length: 12 }, (_, i) => line(4 + i * 5, true));
  const z = planZooms(groups, 80, { tight: true, minSpacing: 5 });
  const ins = z.filter((k) => k.scale > 1);
  assert.ok(ins.every((k) => k.scale <= 1.1));
  for (const k of ins) assert.ok(ins.filter((j) => j.t > k.t - 30 && j.t <= k.t).length <= 3);
  assert.deepEqual(planZooms([line(5, false), line(10, false)], 30, {}), [], "no gold, no zoom");
});

test("fast cadence: a first cut inside the hook, no framing past max, framings rotate", async () => {
  const { planCadence } = await import("../src/zooms.mjs");
  // Two-word caption lines every 0.6 s for 12 s, then a 5 s line with words every 0.4 s and no new line.
  const groups = [];
  for (let t = 0.2; t < 12; t += 0.6) groups.push({ start: Math.round(t * 1000) / 1000, words: [{ start: t, end: t + 0.25 }, { start: t + 0.3, end: t + 0.55 }] });
  const long = { start: 12.2, words: [] };
  for (let t = 12.2; t < 17.2; t += 0.4) long.words.push({ start: Math.round(t * 1000) / 1000, end: t + 0.3 });
  groups.push(long, { start: 17.4, words: [{ start: 17.4, end: 17.8 }] });
  const hook = { start: 0, duration: 3 };
  const keys = planCadence(groups, 20, [], { min: 1.1, lead: 0.6, first: 0.7, max: 2.8, steps: [1.08, 1.16], hook, tail: 1.5 });
  assert.ok(keys[0].t >= 0.7 && keys[0].t <= 1.0, `first cut at ${keys[0].t}`);
  const times = [0, ...keys.map((k) => k.t), 18.5];
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] <= 2.8 + 1e-6, `gap ${times[i - 1]}-${times[i]}`);
  const tight = keys.filter((k) => k.scale > 1).map((k) => k.scale);
  assert.ok(tight.includes(1.08) && tight.includes(1.16), `framings rotate: ${tight}`);
  // Default cadence is unchanged: nothing inside the hook.
  assert.ok(planCadence(groups, 20, [], { hook }).every((k) => k.t >= 3));
});
