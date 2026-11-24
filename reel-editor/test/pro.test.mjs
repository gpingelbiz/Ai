import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPreset } from "../src/presets.mjs";
import { GREG_PRESETS } from "../src/client-mode.mjs";
import { readFrame, viewFor } from "../src/frame-place.mjs";
import { eventClock } from "../src/event-clock.mjs";
import { PRO_MOTION, PRO_RECTS, proEnabled, groundProOverlay, proCandidates, budgetProOverlays, proPrompt, makeProGraphics, proTextWidth, proTextLines, proSize, attachProWordMarks, placeProOverlay, placeProGraphics, proSoundCues } from "../src/pro.mjs";

const wordsAt = (text, start = 3, step = 0.4) => text.split(" ").map((text, i) => ({ text, start: +(start + i * step).toFixed(3), end: +(start + i * step + 0.25).toFixed(3) }));
const range = (from, to = from) => ({ from, to });
const frame = (head = null) => ({ W: 1080, H: 1920, measured: true, head, caption: { x: 0, y: 1080, w: 1080, h: 220 } });
const temp = (t) => { const root = fs.mkdtempSync(path.resolve("test/.pro-plan-")); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };

test("pro is a Greg-only portrait preset that inherits the brand and disables glow cards and glossy icons", () => {
  const p = loadPreset("pingel-pro"), plan = { preset: p.name, canvas: { width: 1080, height: 1920 } };
  assert.ok(GREG_PRESETS.includes(p.name)); assert.equal(p.colors.accent, "#C8A24B");
  assert.ok(proEnabled(p, plan, {}));
  for (const env of [{ REEL_CLIENT: "jane" }, { REEL_CLIENT_MODE: "1" }]) assert.equal(proEnabled(p, plan, env), false);
  assert.equal(proEnabled(p, { ...plan, preset: "brand-jane" }, {}), false);
  assert.equal(proEnabled({ ...p, name: "pingel-brand" }, plan, {}), false);
  assert.equal(proEnabled(p, { ...plan, canvas: { width: 1920, height: 1080 } }, {}), false);
  assert.equal(proEnabled({ ...p, pro: { enabled: false } }, plan, {}), false);
  for (const key of ["glow", "bold", "icons", "slams", "coldOpen"]) assert.equal(p[key].enabled, false, key);
  // Greg 11-23: B-roll back on; "use codex Astra to make some or use runway api". Runway's checks rejected most
  // clips on these teaching reels, so pro uses Codex-drawn stills (Codex config model), free, at most 2 per reel.
  assert.equal(p.broll.enabled, true);
  assert.equal(p.broll.engine, "codex");
  assert.equal(p.broll.stillFallback, true);
  assert.equal(p.broll.library, false);
  assert.deepEqual(p.broll.stock, []);
  assert.equal(p.broll.maxWithGraphics, 2);
  assert.equal(p.graphics.placeFull, false);
});

test("correction uses exact wrong/right word timestamps, draws a 200ms strike then writes for 233ms and holds 2.4s", () => {
  const words = wordsAt("Don't say are you say because you're.");
  const c = groundProOverlay({ type: "flip", wrong: range(2, 3), right: range(5, 6) }, words);
  assert.equal(c.start, words[2].start); assert.deepEqual(c.phrases.map((p) => p.text), ["are you", "because you're."]);
  assert.equal(c.strikeAt, words[5].start - 0.3);
  assert.equal(c.reveals[1], words[5].start);
  assert.ok(c.reveals[1] >= c.strikeAt + 0.2);
  assert.equal(c.end, +(c.complete + 2.4 + 0.167).toFixed(3));
  assert.equal(c.duration, +(c.end - c.start).toFixed(3));
  assert.equal(proCandidates(words)[0].type, "correction");
  const longWrong = wordsAt("bad bad bad better", 3, 0.01); longWrong[2].end = 3.3;
  const overlap = groundProOverlay({ type: "correction", wrong: range(0, 2), right: range(3) }, longWrong);
  assert.equal(overlap.reveals[1], 3.6, "the replacement waits for the strike to complete");
});

test("comparison and three-step rail reveal at spoken words, and stat values never count up", () => {
  const words = wordsAt("Ask Listen Close 30 calls", 4, 1.2);
  const steps = groundProOverlay({ type: "list", items: [{ word: 0, label: "Ask" }, { word: 1, label: "Listen" }, { word: 2, label: "Close" }] }, words);
  assert.deepEqual(steps.reveals, [4, 5.2, 6.4]); assert.equal(steps.complete, 6.7);
  const compare = groundProOverlay({ type: "versus", left: { word: 0, label: "Ask" }, right: { word: 1, label: "Listen" } }, words);
  assert.deepEqual(compare.reveals, [4, 5.2]);
  const stat = groundProOverlay({ type: "number", value: "30", label: "calls", from: 3, to: 4 }, words);
  assert.equal(stat.start, 7.6); assert.equal(stat.phrases[0].text, "30"); assert.equal(stat.label, "calls");
  assert.equal(stat.countFrom, undefined);
  const label = groundProOverlay({ type: "label", from: 0, to: 1 }, words);
  assert.ok(label.duration <= 2.5);
  const mark = groundProOverlay({ type: "word-mark", word: 1, mark: "circle" }, words);
  // Greg 11-19: circles covered the words, so every mark is an underline.
  assert.equal(mark.start, 5.2); assert.equal(mark.mark, "underline"); assert.equal(mark.complete, 5.467);
});

test("planner reuses graphics scenes, glow picks and flip beats without inventing copy or duplicating repeated phrases", () => {
  const words = [...wordsAt("Ask Listen Close.", 0), ...wordsAt("Ask Listen Close.", 6), ...wordsAt("It's not luck, it's work.", 16)];
  const groups = [{ start: 6, text: "Ask Listen Close." }];
  const out = proCandidates(words, { groups, graphics: [{ type: "steps", line: 0, items: [{ text: "Ask" }, { text: "Listen" }, { text: "Close" }] }], picks: { scenes: [{ type: "versus", left: { word: 3, label: "Ask" }, right: { word: 4, label: "Listen" } }] } });
  assert.ok(out.some((o) => o.type === "correction"));
  assert.equal(out.find((o) => o.type === "steps").start, 6);
  assert.equal(out.find((o) => o.type === "compare").start, 6);
  for (const pick of [null, { type: "unknown" }, { type: "quote", text: "invented" }, { type: "steps", items: [range(3), range(4)] }, { type: "compare", left: range(4), right: range(3) }, { type: "wordMark", word: -1 }, { type: "label", from: 0, to: 999 }, { type: "stat", value: "90", label: "Close" }, { type: "stat", value: "Ask", label: "Close" }]) assert.equal(groundProOverlay(pick, words), null, JSON.stringify(pick));
});

test("copy wraps conservatively at the specified size; oversized words and layouts are omitted", () => {
  assert.deepEqual(proTextLines("Ask Listen", { width: 180, size: 40, maxLines: 2 }), ["Ask", "Listen"]);
  assert.deepEqual(proTextLines("I'll", { width: 180, size: 40 }), ["I'll"]);
  assert.ok(proTextWidth("WWW", 40) > proTextWidth("iii", 40));
  assert.equal(proTextWidth("a a", 40), 64);
  assert.equal(proTextLines("W".repeat(20), { width: 100, size: 52 }), null);
  assert.equal(proTextLines("a", { width: 0, size: 52 }), null);
  assert.equal(proTextLines("", { width: 100, size: 52 }), null);
  assert.equal(proTextLines("Ask Listen", { width: 180, size: 40 }), null);
  assert.equal(groundProOverlay({ type: "compare", left: range(0), right: range(1) }, wordsAt(`${"W".repeat(30)} okay`)), null);
  assert.equal(groundProOverlay({ type: "label", from: 0, to: 3 }, wordsAt("one two three four")), null);
});

test("card rules: hook and tail clear, 2.5 s spacing, five per 30 s, 70% cover, no repeats, one full screen", () => {
  let n = 0;
  const cue = (start, duration = 3, extra = {}) => ({ type: `t${n++}`, start, duration, end: start + duration, ...extra });
  assert.deepEqual(budgetProOverlays([cue(0), cue(2.3), cue(2.6), cue(5), cue(8), cue(13), cue(18), cue(23), cue(28)], { duration: 30 }).map((o) => o.start), [2.6, 8, 13, 18, 23]);
  assert.equal(budgetProOverlays([cue(3), cue(4)], { duration: 30 }).length, 1);
  assert.equal(budgetProOverlays([cue(3, 2), cue(5.6, 2)], { duration: 30 }).length, 2);
  const same = budgetProOverlays([{ type: "stat", start: 3, end: 5 }, { type: "stat", start: 9, end: 11 }], { duration: 30 });
  assert.equal(same.length, 1);
  const full = budgetProOverlays([cue(3, 4, { fullscreen: true }), cue(10, 4, { fullscreen: true }), cue(17, 6, { fullscreen: true })], { duration: 30 });
  assert.equal(full.length, 1);
  const rolling = budgetProOverlays(Array.from({ length: 40 }, (_, i) => cue(3 + i * 3, 2)), { duration: 130 });
  for (let start = 0; start < 130; start += 0.1) {
    const win = rolling.filter((o) => o.start >= start && o.start < start + 30);
    assert.ok(win.length <= 5);
    const occupied = rolling.reduce((m, o) => m + Math.max(0, Math.min(start + 30, o.end) - Math.max(start, o.start)), 0);
    assert.ok(occupied <= 21 + 1e-6);
  }
});

test("placement fits each card into the room this shot has, above the head or on the torso, never over face, mic or captions", () => {
  const hit = (a, b, m = 0) => b && a.x < b.x + b.w + m && a.x + a.w > b.x - m && a.y < b.y + b.h + m && a.y + a.h > b.y - m;
  const base = { measured: true, W: 1080, H: 1920 };
  const mic = { x: 0, y: 880, w: 280, h: 480 }, caption = { x: 0, y: 1080, w: 1080, h: 220 };
  for (const headY of [420, 520, 640]) {
    const head = { x: 330, y: headY, w: 420, h: 520 };
    for (const [type, h] of [["correction", 256], ["compare", 320], ["steps", 240], ["stat", 280]]) {
      const p = placeProOverlay({ type }, { ...base, head });
      if (!p) continue;
      const box = { x: p.x, y: p.y - 8, w: p.w, h: p.h + 24 };
      assert.ok(!hit(box, head, 56) && !hit(box, mic, 24) && !hit(box, caption), `${type} at head ${headY} clears face, mic and captions`);
      assert.ok(p.scale >= 0.62 && p.scale <= 1);
      assert.ok(Math.abs(p.h - h * p.scale) < 0.01);
    }
  }
  // A head filling the frame leaves no room at a readable size.
  assert.equal(placeProOverlay({ type: "stat" }, { ...base, head: { x: 0, y: 200, w: 1080, h: 1500 } }), null);
  assert.equal(placeProOverlay({ type: "stat" }, null), null);
  assert.equal(placeProOverlay({ type: "stat" }, { ...base, measured: false }), null);
  assert.equal(placeProOverlay({ type: "stat" }, { ...base, H: 1080 }), null);
  assert.equal(placeProOverlay({ type: "wordMark" }, { ...base, head: { x: 330, y: 520, w: 420, h: 520 } }).slot, "caption");
  assert.equal(placeProOverlay({ type: "full-list", card: true, fullscreen: true, slots: {} }, { ...base, head: { x: 330, y: 520, w: 420, h: 520 } })?.slot, "full");
});

test("word marks attach only to the actual caption word and fit within its lifetime", () => {
  const words = wordsAt("Ask Listen Close", 5);
  const mark = { ...groundProOverlay({ type: "wordMark", word: 1, mark: "underline" }, words), id: "pro-0" };
  const captions = [{ words, end: 7 }];
  const [bound] = attachProWordMarks([mark], captions);
  assert.equal(bound.caption, 0); assert.equal(bound.captionWord, 1); assert.equal(bound.end, 7);
  assert.deepEqual(attachProWordMarks([mark], []), []);
  assert.deepEqual(attachProWordMarks([mark], [{ words, end: 5.5 }]), []);
  assert.deepEqual(attachProWordMarks([{ type: "label" }], []), [{ type: "label" }]);
});

test("placement samples the entire held window, follows framing, rejects moving heads and missing detection", async () => {
  const o = { ...groundProOverlay({ type: "stat", value: "30", label: "calls" }, wordsAt("30 calls", 4)), id: "pro-0" };
  const calls = [];
  const opts = { video: "fixture.mp4", detect: async (_, times) => { calls.push(times); return { frames: times.map((t) => ({ t, faces: [{ x: 0.3, y: 0.6, w: 0.2, h: 0.1 }] })) }; } };
  const placed = await placeProGraphics([o], opts);
  assert.equal(placed.length, 1); assert.ok(calls[0].length >= 12);
  assert.ok(calls[0].every((t) => t >= o.start && t < o.end));
  assert.deepEqual(await placeProGraphics([o], { ...opts, detect: async () => null }), []);
  const movingDetect = async (_, times) => ({ frames: times.map((t, i) => ({ t, faces: [{ x: 0.3, y: i === 5 ? 0.23 : 0.6, w: 0.2, h: 0.1 }] })) });
  assert.deepEqual(await placeProGraphics([o], { ...opts, minCards: 0, detect: movingDetect }), []);
  // Below the two-card floor a rescue may place it smaller, but only clear of every position the head took.
  for (const p of await placeProGraphics([o], { ...opts, detect: movingDetect })) assert.ok(p.place.rescued && p.place.x >= 0.5 * 1080, "beside the moving head, never on it");
  const framed = await placeProGraphics([o], { ...opts, framingAt: () => ({ scale: 2 }), zoomAt: () => 1.2 });
  assert.ok(framed.every((p) => p.place.slot !== "full"));
});

test("one soft tick belongs to each final overlay, never a label or a deleted graphic", () => {
  const words = wordsAt("bad good 30 calls", 4);
  const overlays = [groundProOverlay({ type: "correction", wrong: range(0), right: range(1) }, words), groundProOverlay({ type: "label", from: 2, to: 3 }, words)].map((o, i) => ({ ...o, id: `pro-${i}` }));
  const cues = proSoundCues(overlays);
  assert.equal(cues.length, 1); assert.equal(cues[0].eventId, "pro-0"); assert.equal(cues[0].volume, 0.08);
  assert.equal(cues[0].start, eventClock({ landAt: overlays[0].reveals[1] + 0.233, sfx: "card.wav", fps: 30 }).start);
  assert.deepEqual(proSoundCues([]), []);
  const [stat] = proSoundCues([{ ...overlays[0], type: "stat" }], { fps: 60 });
  assert.equal(stat.start, eventClock({ landAt: overlays[0].start + 0.233, sfx: "card.wav", fps: 60 }).start);
  assert.deepEqual(proSoundCues(overlays, { level: 0 }), []);
  assert.equal(proSoundCues(overlays, { level: 0.02 })[0].volume, 0.02);
  const [mark] = proSoundCues([{ ...overlays[0], type: "wordMark", mark: "circle" }]);
  assert.equal(mark.start, eventClock({ landAt: overlays[0].start + 0.367, sfx: "card.wav", fps: 30 }).start);
});

test("Claude fallback uses existing beat jobs, caches direction and retimes when words change without network", async (t) => {
  const workDir = temp(t), words = wordsAt("Ask Listen Close 30 calls", 4);
  const prompt = proPrompt(words, { duration: 30 });
  assert.match(prompt, /ON Greg's footage/); assert.match(prompt, /At most one full-screen/); assert.match(prompt, /Beat jobs/); assert.match(prompt, /0 4.000 Ask/);
  let asked = 0;
  const args = { workDir, words, duration: 30, available: () => true, ask: async () => { asked++; return JSON.stringify({ overlays: [{ type: "steps", items: [range(0), range(1), range(2)] }] }); } };
  assert.equal((await makeProGraphics(args))[0].type, "steps");
  await makeProGraphics(args); assert.equal(asked, 1);
  await makeProGraphics({ ...args, force: true }); assert.equal(asked, 2);
  await makeProGraphics({ ...args, words: words.map((w) => ({ ...w, start: w.start + 1, end: w.end + 1 })) }); assert.equal(asked, 3);
  const missing = temp(t);
  assert.deepEqual(await makeProGraphics({ workDir: missing, words, duration: 30, available: () => false }), []);
  assert.deepEqual(await makeProGraphics({ workDir: missing, words, duration: 30, force: true, available: () => true, ask: async () => { throw new Error("offline"); } }), []);
  assert.deepEqual(await makeProGraphics({ workDir: missing, words, duration: 30, force: true, available: () => true, ask: async () => '{"overlays":{}}' }), []);
});
