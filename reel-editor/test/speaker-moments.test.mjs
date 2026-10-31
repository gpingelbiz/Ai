import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sentenceLines } from "../src/moments.mjs";
import { candidateWindows, validateWordSpan, candidateScore, candidatesPrompt, resolveCandidate, shingleSimilarity, rankCandidates, findCandidates, writeCandidates, describeCandidates } from "../src/speaker-moments.mjs";

const ratings = (n = 4) => ({ topic: n, clarity: n, payoff: n, specificity: n, delivery: n, novelty: n });
const source = { id: "talk-a", audio: "ok", kind: "stage", rightsStatus: "approved", duration: 200 };
const passage = (text = "Learn to speak with confidence and share your best ideas.", duration = 8, sourceId = source.id) => {
  const tokens = text.split(" ");
  return tokens.map((text, i) => ({ id: `W${i}`, text, sourceId, start: 1 + i * duration / tokens.length, end: 1 + (i + 1) * duration / tokens.length }));
};
const pick = (words, kind = "one_liner", overrides = {}) => ({ kind, source_id: words[0].sourceId, start_word: words[0].id, end_word: words.at(-1).id, ratings: ratings(), ...overrides });
const story = (duration = 60) => {
  const words = passage("Once I lost a sale. Learning to listen changed everything. Customers started trusting me again.", duration);
  return { words, raw: pick(words, "story", { beats: { setup: ["W0", "W4"], turn: ["W5", "W9"], result: ["W10", "W14"] } }) };
};

test("60-minute talk has twelve eight-minute windows with three-minute overlap", () => {
  const windows = candidateWindows(3600);
  assert.equal(windows.length, 12);
  assert.deepEqual(windows[0], { start: 0, end: 480 });
  assert.deepEqual(windows.at(-1), { start: 3300, end: 3600 });
  for (let i = 1; i < windows.length; i++) assert.equal(windows[i - 1].end - windows[i].start, 180);
  assert.deepEqual(candidateWindows(480), [{ start: 0, end: 480 }]);
  assert.deepEqual(candidateWindows(0), []);
  assert.throws(() => candidateWindows(50, { overlap: 480 }), /invalid/);
  assert.throws(() => candidateWindows(NaN), /invalid/);
});

test("span validation rejects unknown/reversed IDs, omitted words, duplicates and cross-source spans", () => {
  const words = passage("We must not remove this qualifier.");
  assert.equal(validateWordSpan(words, "W1", "W4").text, "must not remove this");
  assert.throws(() => validateWordSpan(words, "bogus", "W4"), /unknown word/);
  assert.throws(() => validateWordSpan(words, "W4", "W1"), /reversed/);
  assert.throws(() => validateWordSpan(words, "W1", "W4", { wordIds: ["W1", "W3", "W4"] }), /gaps/);
  assert.throws(() => validateWordSpan(words, "W1", "W4", { wordIds: ["W1", "W3", "W2", "W4"] }), /order/);
  assert.throws(() => validateWordSpan([...words, words[0]], "W0", "W4"), /duplicate/);
  assert.throws(() => validateWordSpan(words.map((w, i) => ({ ...w, sourceId: i === 2 ? "other" : w.sourceId })), "W0", "W4"), /crosses/);
  assert.throws(() => validateWordSpan(words.map((w, i) => ({ ...w, start: i === 2 ? -1 : w.start })), "W0", "W4"), /timing/);
});

test("opaque IDs select all source words without assuming numeric ID adjacency", () => {
  const words = passage().map((w, i) => ({ ...w, id: `source:arbitrary:${i * 7}` }));
  assert.equal(validateWordSpan(words, words[0].id, words.at(-1).id).words.length, words.length);
});

test("weighted ratings total 95 without verified response and 100 with a verified nearby response", () => {
  assert.equal(candidateScore(ratings()), 95);
  assert.equal(candidateScore(ratings(2)), 47.5);
  assert.equal(candidateScore({ ...ratings(0), topic: 4 }), 25);
  assert.equal(candidateScore({ ...ratings(0), clarity: 4 }), 25);
  assert.equal(candidateScore({ ...ratings(0), payoff: 4 }), 20);
  assert.throws(() => candidateScore({ ...ratings(), novelty: 5 }), /novelty/);
  const reaction = { sourceId: source.id, kind: "applause", start: 10, end: 12, verified: true };
  const score = (r, end = 10) => candidateScore(ratings(), { sourceId: source.id, end, reactions: [r] });
  assert.equal(score(reaction), 100);
  assert.equal(score({ ...reaction, start: 12, end: 13 }), 100);
  for (const r of [{ ...reaction, verified: false }, { ...reaction, verified: undefined, confidence: "high" }, { ...reaction, sourceId: "other" }, { ...reaction, start: 12.001, end: 14 }, { ...reaction, start: 9.99 }, { ...reaction, kind: "crowd" }]) assert.equal(score(r), 95);
});

test("complete story beats are required, ordered, nonoverlapping and inside the passage", () => {
  const { words, raw } = story();
  const c = resolveCandidate(raw, { source, words });
  assert.equal(c.text, words.map((w) => w.text).join(" "));
  assert.deepEqual(c.beats, raw.beats);
  assert.throws(() => resolveCandidate({ ...raw, beats: { ...raw.beats, turn: undefined } }, { source, words }), /missing turn/);
  assert.throws(() => resolveCandidate({ ...raw, beats: { ...raw.beats, turn: ["W2", "W4"] } }, { source, words }), /overlapping/);
  assert.throws(() => resolveCandidate({ ...raw, beats: { ...raw.beats, result: ["W14", "W12"] } }, { source, words }), /reversed/);
  assert.throws(() => resolveCandidate({ ...raw, source_id: "other" }, { source, words }), /unknown sourceId/);
});

test("boundaries expand outward, retain exact qualifiers, and discard model text/flags/score/reaction ids", () => {
  const words = passage("Confidence is not about ignoring your fear in difficult conversations.");
  const raw = pick(words, "one_liner", { start_word: "W2", end_word: "W7", text: "FAKE", score: 100, flags: ["APPROVED"], reaction_ids: ["fake"] });
  const c = resolveCandidate(raw, { source, words });
  assert.equal(c.startWord, "W0");
  assert.equal(c.endWord, "W9");
  assert.equal(c.text, "Confidence is not about ignoring your fear in difficult conversations.");
  assert.equal(c.score, 95);
  assert.deepEqual(c.reactionIds, []);
  assert.ok(!JSON.stringify(c).includes("FAKE"));
  assert.ok(!c.flags.includes("APPROVED"));
  assert.deepEqual(c, resolveCandidate(raw, { source, words }));
});

test("rhetorical question can close a complete story only with explicit resolved_question", () => {
  const { words, raw } = story();
  words.at(-1).text = "again?";
  assert.throws(() => resolveCandidate(raw, { source, words }), /no clean/);
  assert.equal(resolveCandidate({ ...raw, resolved_question: true }, { source, words }).endWord, words.at(-1).id);
  const promptWords = passage("Who wants to practice speaking today?");
  assert.equal(resolveCandidate(pick(promptWords, "audience_prompt"), { source, words: promptWords }).kind, "audience_prompt");
});

test("duration rules reject short/long one-liners and short stories; long stories stay whole as alternates", () => {
  for (const duration of [1, 16]) {
    const words = passage(undefined, duration);
    assert.throws(() => resolveCandidate(pick(words), { source, words }), /3-15s/);
  }
  const short = story(40);
  assert.throws(() => resolveCandidate(short.raw, { source, words: short.words }), /45s/);
  const long = story(180);
  long.words.forEach((w) => { w.sourceId = "long-talk"; });
  long.raw.source_id = "long-talk";
  const c = resolveCandidate(long.raw, { source: { ...source, id: "long-talk" }, words: long.words });
  assert.ok(c.flags.includes("alternate-only"));
  assert.equal(c.endWord, long.words.at(-1).id);
  assert.equal(c.out, 181.25);
  const normal = story(60);
  const n = resolveCandidate(normal.raw, { source, words: normal.words });
  const grouped = rankCandidates([c, n]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].out, 61.25);
  assert.equal(grouped[0].alternates[0].out, 181.25);
  assert.equal(rankCandidates([c])[0].out, 181.25);
});

test("energy and rights flags come from index metadata; unusable sound earns no delivery points", () => {
  const words = passage();
  const c = resolveCandidate(pick(words), { source: { ...source, rightsStatus: "pending", audio: "bad" }, words });
  assert.ok(c.flags.includes("picture-only"));
  assert.ok(c.flags.includes("check-rights"));
  assert.equal(c.ratings.delivery, 0);
  assert.equal(c.score, 85);
  const env = { db: Array(500).fill(-20), step: 0.02 };
  assert.ok(resolveCandidate(pick(words), { source, words, envelope: env }).flags.includes("shortlist"));
});

test("five-word Jaccard groups near-duplicate performances across talks and keeps alternates", () => {
  const a = "Learning to speak means learning to listen carefully to the person standing in front of you today.";
  const b = "Learning to speak means learning to listen carefully to the person standing in front of you now.";
  assert.ok(shingleSimilarity(a, b) >= 0.60);
  assert.equal(shingleSimilarity(a, a.toUpperCase()), 1);
  assert.equal(shingleSimilarity(a, "A completely different thought about another topic."), 0);
  const ws = passage(a), vs = passage(b, 8, "talk-b");
  const first = resolveCandidate(pick(ws), { source, words: ws });
  const second = resolveCandidate(pick(vs, "one_liner", { ratings: ratings(3) }), { source: { ...source, id: "talk-b" }, words: vs });
  const list = rankCandidates([second, first, first]);
  assert.equal(list.length, 1);
  assert.equal(list[0].sourceId, "talk-a");
  assert.equal(list[0].alternates.length, 1);
  assert.equal(list[0].alternates[0].sourceId, "talk-b");
});

test("a near-duplicate bridge merges repeat-performance groups transitively", () => {
  const tokens = Array.from({ length: 25 }, (_, i) => `token${i}`);
  const base = { kind: "one_liner", sourceId: source.id, in: 0, flags: [], alternates: [] };
  const a = { ...base, id: "a", score: 95, text: ["first", "three", "changed", ...tokens.slice(3)].join(" ") };
  const b = { ...base, id: "b", score: 94, text: [...tokens.slice(0, -3), "last", "three", "changed"].join(" ") };
  const bridge = { ...base, id: "c", score: 90, text: tokens.join(" ") };
  assert.ok(shingleSimilarity(a.text, b.text) < 0.60);
  const groups = rankCandidates([a, b, bridge]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].alternates.length, 2);
});

test("overlapping word timings never trim the first or last selected word", () => {
  const words = passage("Practice daily. Confidence comes from taking one small step today.");
  words[1].end = words[2].start + 0.05;
  const c = resolveCandidate(pick(words, "one_liner", { start_word: "W2" }), { source, words });
  assert.ok(c.in <= words[2].start);
  assert.ok(c.out >= words.at(-1).end);
  assert.equal(c.text, words.slice(2).map((w) => w.text).join(" "));
  assert.throws(() => resolveCandidate(pick(words), { source: { ...source, duration: 2 }, words }), /duration/);
});

test("client default category limits and overrides are enforced", () => {
  const make = (kind, n) => Array.from({ length: n }, (_, i) => ({ id: `${kind}-${i}`, kind, score: 95 - i, sourceId: source.id, in: i, text: `Unique${kind}${i} short phrase.`, flags: [], alternates: [] }));
  const all = [...make("story", 6), ...make("one_liner", 18), ...make("audience_prompt", 9)];
  const ranked = rankCandidates(all);
  assert.equal(ranked.filter((c) => c.kind === "story").length, 3);
  assert.equal(ranked.filter((c) => c.kind === "one_liner").length, 12);
  assert.equal(ranked.filter((c) => c.kind === "audience_prompt").length, 6);
  assert.equal(rankCandidates(all, { stories: 0, oneLiners: 1, interactions: 0 }).length, 1);
  assert.throws(() => rankCandidates(all, { stories: -1 }), /limits/);
});

test("prompt has no-writing rules and transcript rows expose only original ids/text, no timestamps", () => {
  const words = passage();
  const prompt = candidatesPrompt({ source, words, brief: { topics: ["Confident speaking"], buyer: "planners" } });
  assert.match(prompt, /Never write dialogue, timestamps/);
  assert.match(prompt, /contiguous/);
  assert.match(prompt, /incomplete_story/);
  assert.match(prompt, /no_candidate/);
  assert.match(prompt, /setup, turn and result/);
  const input = JSON.parse(prompt.split("INPUT:\n")[1].split("\nOUTPUT:")[0]);
  assert.deepEqual(input.words, words.map(({ id, text }) => ({ id, text })));
  assert.ok(input.boundaries.every((b) => b.word && !Object.hasOwn(b, "at")));
});

test("fake ask round trip reconstructs text, uses source reactions, dedupes multi-source picks", async () => {
  const words = passage();
  const ask = async (prompt) => {
    assert.ok(prompt.includes("W0"));
    return JSON.stringify({ candidates: [pick(words, "one_liner", { text: "never trust this", reaction_ids: ["fake"] })] });
  };
  const list = await findCandidates({ sources: [source], words, lines: sentenceLines(words), reactions: [{ id: "r1", kind: "laughter", start: 9.5, end: 11, verified: true }], brief: {}, ask });
  assert.equal(list.length, 1);
  assert.equal(list[0].text, words.map((w) => w.text).join(" "));
  assert.equal(list[0].score, 100);
  assert.deepEqual(list[0].reactionIds, ["r1"]);
  const second = { ...source, id: "talk-b" };
  const otherWords = passage(undefined, 8, second.id);
  const both = await findCandidates({ sources: [source, second], words: { [source.id]: words, [second.id]: otherWords }, ask: async (p) => {
    const input = JSON.parse(p.split("INPUT:\n")[1].split("\nOUTPUT:")[0]);
    return JSON.stringify({ candidates: [pick(input.words.map((w) => ({ ...w, sourceId: input.sources[0].id })))] });
  } });
  assert.equal(both.length, 1);
  assert.equal(both[0].alternates.length, 1);
});

test("fake ask cannot select IDs outside supplied chunk", async () => {
  const words = passage();
  await assert.rejects(findCandidates({ sources: [source], words, ask: async () => JSON.stringify({ candidates: [pick(words, "one_liner", { start_word: "invented" })] }) }), /outside the supplied/);
});

test("unknown source metadata and malformed replies fail clearly", async () => {
  const words = passage();
  const ask = async () => JSON.stringify({ candidates: [] });
  await assert.rejects(findCandidates({ sources: [source], words: words.map((w) => ({ ...w, sourceId: "unknown" })), ask }), /unknown sourceId/);
  await assert.rejects(findCandidates({ sources: [source, source], words, ask }), /duplicate sourceId/);
  await assert.rejects(findCandidates({ sources: [{ ...source, duration: 2 }], words, ask }), /invalid duration/);
  await assert.rejects(findCandidates({ sources: [source], words, ask: async () => "{}" }), /candidates\[\]/);
});

test("overlapping windows dedupe the same pick and expanded story context never exceeds ten minutes", async () => {
  const words = passage().map((w) => ({ ...w, start: w.start + 350, end: w.end + 350 }));
  let calls = 0;
  const list = await findCandidates({ sources: [{ ...source, duration: 900 }], words, ask: async () => {
    calls++;
    return JSON.stringify({ candidates: [pick(words)] });
  } });
  assert.equal(calls, 2);
  assert.equal(list.length, 1);
  const longWords = passage(undefined, 650);
  const supplied = [];
  await findCandidates({ sources: [{ ...source, duration: 1000 }], words: longWords, ask: async (prompt) => {
    const input = JSON.parse(prompt.split("INPUT:\n")[1].split("\nOUTPUT:")[0]);
    supplied.push(input.words.map((w) => w.id));
    return JSON.stringify({ candidates: [{ kind: "incomplete_story" }] });
  } });
  assert.ok(supplied.some((ids) => ids.length > supplied[0].length));
  for (const ids of supplied) {
    const have = longWords.filter((w) => ids.includes(w.id));
    assert.ok(have.at(-1).end - have[0].start <= 600);
  }
});

test("no_candidate and incomplete_story do not manufacture output; missing beats get expanded context", async () => {
  const words = passage();
  let count = 0;
  const result = await findCandidates({ sources: [{ ...source, duration: 1200 }], words, ask: async () => {
    count++;
    return JSON.stringify({ candidates: [{ kind: count === 1 ? "incomplete_story" : "no_candidate" }] });
  } });
  assert.equal(count, 2);
  assert.deepEqual(result, []);
});

test("writer emits merged and per-source JSON with alternate provenance; description shows first 12 words", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-candidates-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const words = passage("Learning to speak means learning to listen carefully to the person standing in front of you today.");
  const a = resolveCandidate(pick(words), { source, words });
  const b = { ...a, id: "alternate", sourceId: "talk-b", score: 80 };
  const list = rankCandidates([a, b]);
  const file = writeCandidates(dir, list);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), list);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "work/candidates/talk-b.json")))[0].sourceId, "talk-b");
  assert.match(describeCandidates(list), /^one_liner 95 talk-a 0:00-0:09 Learning to speak means learning to listen carefully to the person standing$/);
  assert.throws(() => writeCandidates(dir, [{ ...a, sourceId: "../outside" }]), /unsafe/);
  assert.throws(() => writeCandidates(dir, [{ ...a, sourceId: "all" }]), /unsafe/);
});
