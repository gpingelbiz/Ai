import test from "node:test";
import assert from "node:assert/strict";
import { sentenceLines, openerProblems, shapeRegion, shapesPrompt, buildShape, resolveShapes, momentsPrompt, SHAPE_RULES } from "../src/moments.mjs";
import { keepWords, keepsArgs } from "../src/clips.mjs";

// A talk: sentences of known length, one second of pause between them. Each sentence is 8 words over 4 s.
function talk(sentences) {
  const words = [];
  let t = 10;
  for (const s of sentences) {
    const ws = s.split(" ");
    ws.forEach((w, i) => words.push({ text: w, start: t + i * 0.5, end: t + i * 0.5 + 0.4 }));
    t += ws.length * 0.5 + 1;
  }
  return words;
}
const S = {
  setup1: "You slowly warm the room for a long time.",
  setup2: "It sits at twenty degrees and nothing happens.",
  setup3: "Then it is at thirty and still nothing changes.",
  chat: "I see you in the chat saying it keeps working.",
  setup4: "You are adding heat the whole time you wait.",
  claim: "Most people quit right before the ice melts.",
  setup5: "Thirty one degrees is where the work piles up.",
  payoff: "Thirty two is where everything you did finally shows.",
  after: "So keep adding heat on the days nothing moves.",
  next: "Now let me show you the calendar block I use.",
};
const order = ["setup1", "setup2", "setup3", "chat", "setup4", "claim", "setup5", "payoff", "after", "next"];
const words = talk(order.map((k) => S[k]));
const lines = sentenceLines(words);
const id = (k) => lines[order.indexOf(k)].id;

test("openers that refer back, read the chat or ask the room are rejected; a plain claim opens", () => {
  assert.deepEqual(openerProblems({ text: S.claim }), []);
  assert.equal(openerProblems({ text: "If you take one thing from this whole segment that I just went through, it is this." })[0].code, "refers-back");
  assert.equal(openerProblems({ text: "Remember those lies I talked about earlier?" })[0].code, "refers-back");
  assert.ok(openerProblems({ text: "I see you guys are saying it in the chat." }).some((p) => p.code === "reads-chat"));
  assert.ok(openerProblems({ text: "What is the last good habit you dropped?" }, { text: "Working out, gratitude texts, right? Cardio." }).some((p) => p.code === "reads-chat"));
  assert.equal(openerProblems({ text: "And that is why it works." })[0].code, "leans-back");
});

test("the claim said later leads, the body follows in order without it, the chat line is left out and the payoff lands inside", () => {
  const shape = { lead: id("claim"), from: id("setup1"), to: id("after"), drop: [], payoff: id("payoff"), ok: true };
  const built = buildShape(shape, lines, words, { min: 20, max: 60 });
  assert.equal(built.problem, undefined, built.problem);
  assert.equal(built.lifted, true);
  assert.equal(built.lead, S.claim);
  assert.ok(built.keeps.length <= SHAPE_RULES.maxKeeps);
  // Cold-open guard: the claim's words appear once, at the very start.
  const clipWords = keepWords(words, built.keeps);
  const text = clipWords.map((w) => w.text).join(" ");
  assert.ok(text.startsWith("Most people quit right before the ice melts."), text.slice(0, 60));
  assert.equal(text.split("Most people quit").length - 1, 1, "the lifted line is not in the body too");
  assert.ok(!/in the chat/.test(text), "code leaves the chat line out even though Claude kept it");
  assert.ok(text.includes(S.payoff));
  assert.ok(!text.includes(S.next), "the body stops at its payoff, never the next topic");
  // The payoff's place in clip time is the end of that line inside the kept ranges.
  const payoffWord = clipWords.find((w) => w.text === "shows.");
  assert.ok(Math.abs(built.payoff.time - payoffWord.end) < 0.2, `${built.payoff.time} vs ${payoffWord.end}`);
  // Clip words run on without gaps between kept ranges.
  for (let k = 1; k < clipWords.length; k++) assert.ok(clipWords[k].start >= clipWords[k - 1].start);
});

test("a window whose payoff is not kept, or that runs short or long, is rejected", () => {
  assert.match(buildShape({ lead: id("claim"), from: id("setup1"), to: id("setup5"), payoff: id("payoff") }, lines, words, { min: 20, max: 60 }).problem, /payoff/);
  assert.match(buildShape({ lead: id("claim"), from: id("setup1"), to: id("after"), drop: [id("payoff")], payoff: id("payoff") }, lines, words, { min: 20, max: 60 }).problem, /payoff/);
  assert.match(buildShape({ lead: id("claim"), from: id("setup5"), to: id("payoff"), payoff: id("payoff") }, lines, words).problem, /under 35 s/);
  assert.match(buildShape({ lead: id("setup1"), from: id("setup1"), to: id("after"), payoff: id("payoff") }, lines, words, { min: 10, max: 20 }).problem, /over 20 s/);
});

test("a lead that refers back falls back to the first kept body line, or the shape is dropped", () => {
  const w2 = talk(["If you take one thing from this whole segment, it is this.", ...order.map((k) => S[k])]);
  const l2 = sentenceLines(w2);
  const built = buildShape({ lead: l2[0].id, from: l2[1].id, to: l2[9].id, payoff: l2[8].id }, l2, w2, { min: 20, max: 60 });
  assert.equal(built.problem, undefined, built.problem);
  assert.equal(built.lead, S.setup1, "the refers-back line never opens; the body's own first line does");
  const bad = buildShape({ lead: l2[0].id, from: l2[0].id, to: l2[9].id, payoff: l2[8].id }, l2, w2, { min: 20, max: 60 });
  assert.equal(bad.lead, S.setup1);
});

test("at most three kept ranges: the smallest gaps close first, the lead stays its own range", () => {
  const shape = { lead: id("claim"), from: id("setup1"), to: id("after"), drop: [id("setup2"), id("setup4"), id("setup5")], payoff: id("payoff") };
  const built = buildShape(shape, lines, words, { min: 10, max: 60 });
  assert.equal(built.problem, undefined, built.problem);
  assert.ok(built.keeps.length <= 3, JSON.stringify(built.keeps));
  const text = keepWords(words, built.keeps).map((w) => w.text).join(" ");
  assert.ok(text.startsWith("Most people quit"));
  assert.equal(text.split("Most people quit").length - 1, 1);
});

test("shapes resolve best first, never with overlapping ranges; the prompts carry the rules", () => {
  const regions = [shapeRegion(lines, id("claim")), shapeRegion(lines, id("payoff"))];
  const moments = [{ anchor: id("claim"), hook: "Most people quit *right before it melts*", score: 90 }, { anchor: id("payoff"), hook: "Thirty two degrees", score: 80 }];
  const shapes = [
    { region: 1, lead: id("claim"), from: id("setup1"), to: id("after"), payoff: id("payoff"), ok: true },
    { region: 2, lead: id("payoff"), from: id("setup5"), to: id("after"), payoff: id("after"), ok: true },
  ];
  const dropped = [];
  const clips = resolveShapes({ moments, regions, shapes, lines, words, count: 5, dropped, rules: { min: 10, max: 60 } });
  assert.equal(clips.length, 1);
  assert.equal(clips[0].hook, moments[0].hook);
  assert.ok(clips[0].keeps.length >= 1 && clips[0].payoff.line === S.payoff);
  assert.match(dropped[0].why, /overlaps/);
  const p = shapesPrompt(regions);
  assert.match(p, /lead/); assert.match(p, /payoff/); assert.match(p, /35 to 60 seconds/); assert.match(p, /chat/);
  assert.match(momentsPrompt({ lines, count: 2, duration: 600, minLen: 35, maxLen: 60 }), /35-60 second reel/);
});

test("kept ranges are cut with a seek per range and joined with 30/40 ms audio fades", () => {
  const args = keepsArgs("/in.mov", [{ start: 119.6, end: 125.9 }, { start: 78.9, end: 157.9 }], "/out.mp4", { encoder: ["-c:v", "libx264"] });
  assert.deepEqual(args.slice(3, 9), ["-ss", "119.6", "-t", "6.3", "-i", "/in.mov"]);
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.match(graph, /afade=t=in:d=0\.03/);
  assert.match(graph, /afade=t=out:st=6\.26:d=0\.04/);
  assert.match(graph, /concat=n=2:v=1:a=1\[v\]\[a\]/);
});

test("an opener in the middle of a list refers back; the body ends on its payoff line", () => {
  assert.equal(openerProblems({ text: "Third, you start with your body before your phone." })[0].code, "refers-back");
  assert.deepEqual(openerProblems({ text: "Thirty two is where it shows." }), []);
  const built = buildShape({ lead: id("claim"), from: id("setup1"), to: id("next"), payoff: id("payoff") }, lines, words, { min: 20, max: 60 });
  const text = keepWords(words, built.keeps).map((w) => w.text).join(" ");
  assert.ok(text.endsWith("finally shows."), text.slice(-40));
});
