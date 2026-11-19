import test from "node:test";
import assert from "node:assert/strict";
import { beatJob, classifyBeats, findFlips, flipCards, mixCards, mixGlowPicks, markTarget, linesFromWords, beatJobsPrompt, ENTRANCES, CALM_ENTRANCES } from "../src/beat-jobs.mjs";
import { normalizeScene, placeScenes, sceneHTML, scenesPrompt, sceneUsesSpeakerWords, sceneDuration } from "../src/graphics.mjs";
import { cardFootprint, placeCard, readFrame } from "../src/frame-place.mjs";
import { mixCSS, MIX_JS, MIX_MARKS } from "../src/mix-render.mjs";
import { glowPrompt, fitsTwoLines, checkPicks, placeGlowScenes } from "../src/glow.mjs";
import { MARKERS } from "../src/looks.mjs";

const timed = (text, t0 = 0, step = 0.3) => text.split(" ").map((t, i) => ({ text: t, start: +(t0 + i * step).toFixed(3), end: +(t0 + i * step + 0.25).toFixed(3) }));
const side = (ws, f, a, b) => ws.slice(f[a], f[b] + 1).map((w) => w.text).join(" ");

test("each beat gets the job its words carry", () => {
  assert.equal(beatJob("I need to talk to my wife first"), "objection");
  assert.equal(beatJob("It's not luck, it's work"), "distinction");
  assert.equal(beatJob("First, you ask the question. Then you listen"), "procedure");
  assert.equal(beatJob("I closed 14 deals last week"), "proof");
  assert.equal(beatJob("Never pitch first!"), "emphasis");
  assert.equal(beatJob("and that's how my morning went"), "plain");
  // The closing seconds are the takeaway, whatever the words.
  const beats = classifyBeats([{ text: "I closed 14 deals", start: 4, end: 6 }, { text: "So remember this", start: 27, end: 29 }], { duration: 30 });
  assert.deepEqual(beats.map((b) => b.job), ["proof", "takeaway"]);
});

test("the flip finder cuts the wrong and right phrases out of what he says", () => {
  const cases = [
    ["Listen. It's not luck, it's work every day.", "luck,", "work every day.", "it's"],
    ["Closing is not talking but listening.", "talking", "listening.", "but"],
    ["Stop chasing leads, start booking calls.", "chasing leads,", "booking calls.", "start"],
    ["Instead of pitching, ask questions.", "pitching,", "ask questions.", "ask"],
  ];
  for (const [line, wrong, right, turn] of cases) {
    const ws = timed(line);
    const [f] = findFlips(ws);
    assert.ok(f, line);
    assert.equal(side(ws, f, "wrongFrom", "wrongTo"), wrong);
    assert.equal(side(ws, f, "rightFrom", "rightTo"), right);
    assert.equal(ws[f.pivot].text, turn);
  }
  assert.deepEqual(findFlips(timed("I am not sure what to say here today")), []);
  assert.deepEqual(findFlips(timed("it's not it, it's it")), []);
  // From real transcripts: a side that runs on past five words is not a flip (never cut a phrase mid-thought).
  assert.deepEqual(findFlips(timed("That's not the signal to coast. That's the signal that you're one stretch away from the")), []);
  assert.deepEqual(findFlips(timed("so not all at once, but you have to show up for it.")), []);
  const real = timed("not because volume is smarter, but because every attempt teaches you something, and");
  const [r] = findFlips(real);
  assert.equal(side(real, r, "wrongFrom", "wrongTo"), "volume is smarter,");
  assert.equal(side(real, r, "rightFrom", "rightTo"), "every attempt teaches you something,");
  // The same line with the comma dropped by the transcriber: "and" ends the phrase.
  const bare = timed("not because volume is smaller, but because every attempt teaches you something and a skill is built");
  assert.equal(side(bare, findFlips(bare)[0], "rightFrom", "rightTo"), "every attempt teaches you something");
});

test("a flip card is his words, strikes on the spoken turn and fits one slot", () => {
  const groups = [{ start: 3, end: 4.5, text: "Here is the thing.", words: timed("Here is the thing.", 3) }, { start: 5, end: 7, text: "It's not luck, it's work.", words: timed("It's not luck, it's work.", 5) }];
  const [card] = flipCards(groups);
  assert.equal(card.line, 1);
  assert.equal(card.wrong, "luck");
  assert.equal(card.right, "work");
  assert.equal(card.pivotAt, 0.9);
  const s = normalizeScene(card);
  assert.equal(s.type, "flip");
  assert.ok(sceneUsesSpeakerWords(s, groups));
  assert.ok(sceneDuration({ ...s, pivotAt: 0.9 }) >= 3.2);
  const html = sceneHTML(s);
  assert.match(html, /g-flip-wrong.*luck.*g-flip-strike.*g-flip-right.*work/);
  assert.equal(normalizeScene({ type: "flip", line: 1, wrong: "work", right: "Work" }), null);
  const foot = cardFootprint(s);
  assert.ok(foot.w <= 900 && foot.h < 400);
  const wide = readFrame({ frames: [0, 1].map((t) => ({ t, faces: [{ x: 0.52, y: 0.2, w: 0.22, h: 0.13 }], bodies: [] })) }, { captionTop: 0.68 });
  assert.notEqual(placeCard(s, wide, { allowBehind: true, pin: ["behind", "side", "lower"] })?.slot, "behind");
  // The planner times it: the strike lands on "it's", and a card right after it never cuts the flip short.
  const cands = groups.map((g, i) => ({ i, start: g.start, text: g.text, words: g.words }));
  const placed = placeScenes([{ ...s, pivotAt: 0.9 }], cands, { duration: 20 });
  assert.equal(placed[0].pivotAt, 0.9);
  assert.match(scenesPrompt({ candidates: cands, transcript: "x", hook: "h", count: 2, beats: classifyBeats(groups, { duration: 20 }) }), /flip: a myth flip[\s\S]*Beat jobs/);
});

test("the variety pass never runs one type twice in a row, keeps the takeaway clean, rotates entrances and marks", () => {
  const words = timed("The *real* close happens after the call and $10,000 is the number", 4, 0.4);
  const beats = [{ start: 0, end: 20, job: "emphasis" }, { start: 26, end: 30, job: "takeaway" }];
  const cards = [
    { type: "headline", start: 4, duration: 5, text: "The *real* close" },
    { type: "headline", start: 10, duration: 5, text: "Another *line*" },
    { type: "stat", start: 12, duration: 5, value: "$10,000" },
    { type: "quote", start: 18, duration: 5, text: "the *call*" },
    { type: "quote", start: 27, duration: 3, text: "late *card*" },
  ];
  const { cards: out, dropped } = mixCards(cards, beats, { words });
  assert.deepEqual(out.map((c) => c.type), ["headline", "stat", "quote"]);
  assert.equal(dropped.length, 2);
  out.forEach((c, i) => { assert.ok(ENTRANCES.includes(c.enter)); if (i) assert.notEqual(c.enter, out[i - 1].enter); });
  assert.equal(out[0].mark.kind, "underline");
  assert.equal(out[0].mark.at, 0.4);
  assert.equal(out[1].mark.kind, "circle");
  const calm = mixCards(cards, beats, { words, calm: true }).cards;
  assert.ok(calm.every((c) => CALM_ENTRANCES.includes(c.enter)));
  assert.equal(markTarget({ type: "post", text: "x" }), null);
});

test("glow: a spoken flip becomes a swap line, features take turns carrying a mark", () => {
  const words = timed("Okay so listen up. It's not luck, it's work. You will never close a deal without a real offer. That number is 50 percent.", 2, 0.32);
  const library = [{ name: "target", draw: "a target" }];
  const picks = { features: [{ from: 10, to: 12, key: 11, br: null }, { from: 21, to: 23, key: 22, br: null }], icons: [], overlays: [], scenes: [] };
  const check = (p) => checkPicks(p, words, library, { hookEnd: 3, duration: 14 });
  const { picks: out, report } = mixGlowPicks(check(picks), words, { duration: 14, hookEnd: 3, fits: (f) => fitsTwoLines(words, f), check });
  const swap = out.features.find((f) => f.variant === "swap");
  assert.ok(swap, report);
  assert.equal(words[swap.wrong].text, "luck,");
  assert.equal(words[swap.right].text, "work.");
  assert.ok(out.features.some((f) => f.mark), report);
  assert.match(report, /swap "luck" to "work"/);
  assert.match(glowPrompt(words, library, { hook: "h", duration: 14 }), /Beat jobs/);
  assert.doesNotMatch(glowPrompt(words, library, { hook: "h", duration: 14, mix: false }), /Beat jobs/);
  assert.equal(linesFromWords(words).length, 4);
  assert.match(beatJobsPrompt(classifyBeats(linesFromWords(words), { duration: 14 }), { glow: true }), /\d+-\d+: distinction/);
});

test("glow scenes can sit behind the speaker, never on his face, and only when asked", () => {
  const det = { frames: [0, 1, 2, 3].map((t) => ({ t, faces: [{ x: 0.52, y: 0.2, w: 0.22, h: 0.13 }], bodies: [{ x: 0.38, y: 0.2, w: 0.5, h: 0.75 }] })) };
  const scenes = [{ type: "icons", start: 0.5, end: 3, icons: [] }];
  // No room beside him for the panel: without the matte the scene keeps the full screen.
  const plain = placeGlowScenes(scenes, det);
  assert.equal(plain[0].place, undefined);
  const frame = readFrame(det, { captionTop: 0.785, captionFontFrac: 0.03 });
  // Asked for behind: the panel goes behind him, and the head plus the shoulders (the matte lifts both) hide at most
  // a quarter of it.
  const p = placeCard({ type: "icons", foot: { w: 950, h: 900, minW: 950, minVisual: 380, wrap: 0 } }, frame, { kind: "scene", allowBehind: true, pin: "behind", maxScale: 0.7, minScale: 0.5, maxArea: 0.4, maxHidden: 0.25 });
  assert.equal(p.slot, "behind", JSON.stringify(p));
  const cover = (o) => Math.max(0, Math.min(p.x + p.w, o.x + o.w) - Math.max(p.x, o.x)) * Math.max(0, Math.min(p.y + p.h, o.y + o.h) - Math.max(p.y, o.y));
  assert.ok(p.occl.length === 2, "head and shoulders both block the panel");
  assert.ok((cover(p.occl[0]) + cover(p.occl[1])) / (p.w * p.h) <= 0.25 + 0.02);
  // Without the pin it only wins when it beats full screen honestly; either way it never lands on the face.
  const behind = placeGlowScenes(scenes, det, { behind: true });
  if (behind[0].place) assert.ok(["behind", "side", "top", "corner", "lower"].includes(behind[0].place.slot));
});

test("the page side ships only with the mix, and every mark shape exists", () => {
  for (const k of ["underline", "circle", "arrow"]) { assert.ok(MIX_MARKS[k]); assert.ok(MARKERS[k]); }
  assert.match(mixCSS({ H: 1920, colors: {} }), /\.g-flip-strike/);
  assert.match(MIX_JS, /g\.enter === "wipe"/);
  assert.match(MIX_JS, /g\.type === "flip"/);
});
