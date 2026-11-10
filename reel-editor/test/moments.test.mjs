import { test } from "node:test";
import assert from "node:assert/strict";
import { sentenceLines, cutPoints, region, edgeProblems, resolveClips, momentsPrompt, edgesPrompt, askEdges, lineEnergy } from "../src/moments.mjs";

// A recording as sentences of 5 words each, 0.3 s per word, 0.4 s between sentences.
function recording(sentences) {
  const words = [];
  let t = 0;
  for (const s of sentences) {
    const toks = s.split(" ");
    toks.forEach((tok) => { words.push({ text: tok, start: +t.toFixed(3), end: +(t + 0.25).toFixed(3) }); t += 0.3; });
    t += 0.4;
  }
  return words;
}
const S = [];
for (let i = 0; i < 40; i++) S.push(i === 20 ? "And that is why it works." : i === 21 ? "The first call sets everything." : `Sentence number ${i} says things.`);
const words = recording(S);

test("lines and cut points: every sentence is a label, every boundary a real start or end in the silence", () => {
  const lines = sentenceLines(words);
  assert.equal(lines.length, 40);
  assert.equal(lines[3].id, "L003");
  const pts = cutPoints(lines, words);
  const s5 = pts.find((p) => p.kind === "start" && p.line === "L005");
  assert.ok(s5.at < lines[5].start && s5.at >= words[lines[5].i0 - 1].end, "start sits in the gap before the line");
  const e5 = pts.find((p) => p.kind === "end" && p.line === "L005");
  assert.ok(e5.at > lines[5].end && e5.at <= words[lines[5].i1 + 1].start, "end sits in the gap after it");
});

test("prompts carry labels, never times", () => {
  const lines = sentenceLines(words);
  const p1 = momentsPrompt({ lines, energy: [{ id: "L021", tag: "[energy]" }], count: 2, duration: 80 });
  assert.match(p1, /L021 \[energy\]\| The first call/);
  assert.doesNotMatch(p1, /\d+\.\d+s/);
  const r = region(lines, cutPoints(lines, words), "L021");
  assert.ok(r.opens.length > 1 && r.ends.length > 1);
  assert.match(edgesPrompt([r]), /«O1»[\s\S]*>> The first call sets everything\./);
});

test("gate: an opening that leans back moves to the next clean one; edges are checked", () => {
  const lines = sentenceLines(words);
  const pts = cutPoints(lines, words);
  const r = region(lines, pts, "L021", { before: 3 });
  // Claude picks the opening on L020 ("And that is why...") and an ending 30 s on.
  const open = r.opens.find((p) => p.line === "L020").label;
  const end = r.ends.find((p) => p.at - r.opens[0].at > 30).label;
  const [clip] = resolveClips({ moments: [{ anchor: "L021", hook: "h", score: 80 }], regions: [r], edges: [{ region: 1, open, end, ok: true }], lines, words, duration: 200, count: 1, min: 5 });
  assert.ok(clip, "a clip comes back");
  const first = words.find((w) => w.start >= clip.start);
  assert.equal(first.text, "The", "the leaning opening moved to the clean line after it");
  assert.deepEqual(clip.problems, []);
  // Problems are named for a bad window.
  const bad = edgeProblems({ start: lines[20].start - 0.1, end: lines[22].start + 0.5 }, lines, words);
  assert.deepEqual(bad.map((p) => p.code).sort(), ["leans-back", "mid-sentence-end"]);
});

test("energy: a louder line is tagged against the recording's median", () => {
  const lines = sentenceLines(words.slice(0, 15));
  const db = new Array(Math.ceil(words[14].end / 0.02)).fill(-30);
  for (let k = Math.floor(lines[1].start / 0.02); k < Math.ceil(lines[1].end / 0.02); k++) db[k] = -22;
  const e = lineEnergy(lines, { step: 0.02, db });
  assert.equal(e[1].tag, "[energy]");
  assert.equal(e[0].tag, "");
});

test("askEdges asks in batches at once and counts region numbers across all of them", async () => {
  const regions = Array.from({ length: 12 }, (_, i) => ({ anchor: `L${i}`, text: `>> line ${i}`, opens: [], ends: [] }));
  const prompts = [];
  const edges = await askEdges(regions, async (prompt) => {
    prompts.push(prompt);
    const n = (prompt.match(/=== Region \d+/g) || []).length;
    return { edges: Array.from({ length: n }, (_, k) => ({ region: k + 1, open: "O1", end: "E1", ok: true, note: prompt.match(/anchor (L\d+)/)[1] })) };
  });
  assert.equal(prompts.length, 3); // 5 + 5 + 2
  assert.deepEqual(edges.map((e) => e.region), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(edges[5].note, "L5"); // region 6 is the first of the second batch
  assert.ok(prompts.every((p) => /=== Region 1 \(anchor/.test(p) && !/=== Region 6/.test(p)));
});

test("askEdges keeps the batches that answered when one fails, and throws only when all fail", async () => {
  const regions = Array.from({ length: 7 }, (_, i) => ({ anchor: `L${i}`, text: "x", opens: [], ends: [] }));
  const failed = [];
  const edges = await askEdges(regions, async (prompt) => {
    if (/anchor L0\)/.test(prompt)) throw new Error("claude timed out after 600s");
    return { edges: [{ region: 1, ok: true }, { region: 2, ok: true }, { region: 9, ok: true }] }; // 9 is out of range
  }, { onFail: (e, from, to) => failed.push([e.message, from, to]) });
  assert.deepEqual(failed, [["claude timed out after 600s", 1, 5]]);
  assert.deepEqual(edges.map((e) => e.region), [6, 7]);
  await assert.rejects(askEdges(regions, async () => { throw new Error("down"); }), /down/);
});
