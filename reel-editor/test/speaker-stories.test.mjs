import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STORY_VERSION, STORY_THRESHOLD, contentWords, storySimilarity, flattenCandidates, lexicalStoryGroups, storyGroups, chooseTelling, describeStoryGroups, groupCandidateFile } from "../src/speaker-stories.mjs";
import { rankCandidates, findCandidates, writeCandidates } from "../src/speaker-moments.mjs";
import { parseSpeakerArgs, speakerMain, analyzeSpeaker, SPEAKER_HELP } from "../src/speaker.mjs";
import { indexSources } from "../src/speaker-index.mjs";
import { writeJSON, readJSON } from "../src/util.mjs";

const beats = { setup: true, turn: true, result: false };
const candidate = (id, text, extra = {}) => ({ id, sourceId: id, event: `Event ${id}`, text, kind: "story", in: 10, out: 70, score: 80, flags: [], reactionIds: [], alternates: [], ...extra });
const a = candidate("a", "I offered the broker half my commission to sit in his office, listen to clients, and bring coffee. The mentor accepted and I learned real estate sales.");
const b = candidate("b", "The agent accepted my offer: fifty percent of each sale. I watched clients in the office, brought coffee and learned from my mentor about real estate.");
const unrelated = candidate("c", "A marathon requires running shoes, endurance training and miles around the neighborhood. Stop planning equipment and start walking.");
const reply = (members = [{ id: "a", beats }, { id: "b", beats }]) => JSON.stringify({ groups: [{ label: "Learning from a mentor", members }] });
const temp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-stories-test-")); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test("content words drop stopwords and normalize written/spoken money without inventing transcript text", () => {
  assert.deepEqual(contentWords("a million five"), contentWords("$1.5 million"));
  assert.deepEqual(contentWords("1.5 million"), contentWords("$1,500,000"));
  assert.deepEqual(contentWords("one point five million"), contentWords("$1.5 million"));
  assert.deepEqual(contentWords("fifty percent"), contentWords("50 percent"));
  assert.deepEqual([...contentWords("The clients and the mentors")], ["client", "mentor"]);
  assert.equal(contentWords(null).size, 0);
});

test("lexical matcher groups two paraphrased tellings and keeps an unrelated story separate", () => {
  assert.ok(storySimilarity(a.text, b.text) >= STORY_THRESHOLD);
  assert.ok(storySimilarity(a.text, unrelated.text) < STORY_THRESHOLD);
  assert.equal(storySimilarity(a.text, a.text), 1);
  assert.equal(storySimilarity("the and", a.text), 0);
  const groups = lexicalStoryGroups([b, unrelated, a]);
  assert.deepEqual(groups.map((g) => g.members.map((c) => c.id)), [["a", "b"], ["c"]]);
  assert.deepEqual(groups, lexicalStoryGroups([unrelated, a, b]));
  assert.throws(() => lexicalStoryGroups([a], { threshold: NaN }), /threshold/);
});

test("lexical complete-link and length checks stop tiny excerpts bridging longer unrelated stories", () => {
  const texts = ["apple banana cherry date elderberry fig grape honeydew", "apple banana cherry date orange pear kiwi lemon", "orange pear kiwi lemon plum melon berry lime"];
  const groups = lexicalStoryGroups(texts.map((s, i) => candidate(String(i), s)), { threshold: 0.45 });
  assert.equal(groups.length, 2);
  const large = candidate("long", "ego assistant office coffee commission listing broker client house training sales listening learning real estate professional humble");
  const tiny = candidate("tiny", "ego assistant office coffee");
  assert.equal(lexicalStoryGroups([large, tiny]).length, 2);
});

test("flattenCandidates keeps every nested alternate once without mutating evidence", () => {
  const nested = { ...a, storyLabel: "old", beatCoverage: beats, alternates: [{ ...b, alternates: [unrelated] }] };
  assert.deepEqual(flattenCandidates([nested, b]).map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(flattenCandidates([nested])[0].alternates, []);
  assert.ok(!Object.hasOwn(flattenCandidates([nested])[0], "beatCoverage"));
  assert.equal(nested.alternates[0].alternates.length, 1);
});

test("storyGroups uses one restricted prompt, validates good output, preserves code-owned evidence", async () => {
  let calls = 0;
  const groups = await storyGroups([a, b, unrelated], { ask: async (prompt) => {
    calls++;
    const input = JSON.parse(prompt.split("INPUT:\n")[1].split("\nOUTPUT:")[0]);
    assert.deepEqual(input, [a, b, unrelated].map((c) => ({ id: c.id, event: c.event, text: c.text })));
    assert.match(prompt, /Never write times, quotes/);
    return JSON.stringify({ groups: [{ label: "Learning from a mentor", in: 999, text: "fake quote", members: [{ id: "a", beats, out: 999, text: "fake quote" }, { id: "b", beats }] }] });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(groups[0].members.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(groups[0].members[0].beatCoverage, beats);
  assert.equal(groups[0].members[0].out, a.out);
  assert.equal(groups[0].members[0].text, a.text);
  assert.equal(groups[1].members[0].id, "c");
  assert.ok(!JSON.stringify(groups).includes("fake quote"));
});

test("storyGroups drops unknown/duplicate IDs and malformed beats with warnings; omitted evidence survives", async () => {
  const warnings = [];
  const groups = await storyGroups([a, b, unrelated], { ask: async () => JSON.stringify({ groups: [
    { label: "Bad\nlabel", members: [{ id: "c", beats }] },
    { label: 'Invented "quote" at 12:30', members: [{ id: "c", beats }] },
    { label: "Mentor", members: [{ id: "a", beats }, { id: "fake", beats }, { id: "a", beats }, { id: "b", beats: { ...beats, result: "yes" } }] },
    { label: "Duplicate", members: [{ id: "a", beats }] },
  ] }), log: (w) => warnings.push(w) });
  assert.deepEqual(groups.flatMap((g) => g.members.map((c) => c.id)).sort(), ["a", "b", "c"]);
  assert.equal(groups.find((g) => g.label === "Mentor").members.length, 1);
  assert.ok(warnings.some((w) => w.includes("fake")));
  assert.equal(warnings.filter((w) => w.includes("duplicate id a")).length, 2);
  assert.ok(warnings.some((w) => w.includes("beat coverage")));
  assert.equal(groups.find((g) => g.members.some((c) => c.id === "c")).label, "Single telling");
});

for (const [name, ask] of [["failed call", async () => { throw new Error("offline"); }], ["unavailable adapter", null], ["malformed reply", async () => "{}"]]) {
  test(`storyGroups ${name} fails open to local lexical groups with one warning`, async () => {
    const logs = [];
    const groups = await storyGroups([a, b, unrelated], { ask, log: (s) => logs.push(s) });
    assert.equal(logs.length, 1);
    assert.deepEqual(groups.map((g) => g.members.map((c) => c.id)), [["a", "b"], ["c"]]);
    assert.equal(groups[0].method, "lexical");
    assert.deepEqual(groups[0].members[0].beatCoverage, { setup: false, turn: false, result: false });
  });
}

test("no candidates or only one event needs no model call", async () => {
  let calls = 0;
  const ask = async () => { calls++; return reply(); };
  assert.deepEqual(await storyGroups([], { ask }), []);
  await storyGroups([a], { ask });
  await storyGroups([a, { ...b, sourceId: a.sourceId }], { ask });
  assert.equal(calls, 0);
});

test("chooseTelling orders clean, usable, unknown, weak, reject, then score with deterministic ties", () => {
  const members = [candidate("reject", "", { score: 100, audioQuality: { label: "reject" } }), candidate("unknown", "", { score: 99 }), candidate("weak", "", { score: 100, audioQuality: { label: "weak" } }), candidate("usable", "", { audioQuality: { label: "usable" } }), candidate("clean-low", "", { score: 10, audioQuality: { label: "clean" } }), candidate("clean-best", "", { score: 20, audioQuality: { label: "clean" } })];
  const choice = chooseTelling({ members });
  assert.deepEqual([choice.best, ...choice.alternates].map((c) => c.id), ["clean-best", "clean-low", "usable", "unknown", "weak", "reject"]);
  assert.match(choice.reason, /clean audio/);
  assert.equal(chooseTelling([b, a]).best.id, "a");
  assert.equal(chooseTelling([]).best, undefined);
  assert.equal(members[0].id, "reject");
});

test("rankCandidates groups paraphrases from different sources and promotes better audio over score", () => {
  const dirty = { ...a, score: 95, audioQuality: { label: "weak" } };
  const clean = { ...b, score: 75, audioQuality: { label: "clean" } };
  const ranked = rankCandidates([dirty, unrelated, clean]);
  const family = ranked.find((c) => c.id === "b");
  assert.ok(family);
  assert.deepEqual(family.alternates.map((c) => c.id), ["a"]);
  assert.equal(ranked.length, 2);
  assert.deepEqual(dirty.alternates, []);
});

test("rankCandidates accepts semantic families with zero lexical overlap and keeps shortlisting rules", async () => {
  const x = candidate("x", "A completely distinct vocabulary.", { score: 90 });
  const groups = await storyGroups([a, x], { ask: async () => reply([{ id: "a", beats }, { id: "x", beats }]) });
  const ranked = rankCandidates([a, x], { storyFamilies: groups });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "x");
  assert.equal(ranked[0].alternates[0].id, "a");
  assert.deepEqual(ranked[0].beatCoverage, beats);
  const long = { ...x, flags: ["alternate-only"], audioQuality: { label: "clean" } };
  assert.equal(rankCandidates([a, long], { storyFamilies: groups })[0].id, "a");
});

test("findCandidates calls semantic grouping once after source picks and carries measured audio", async () => {
  const sources = [{ id: "source-a", event: "Stage A", audio: "ok", duration: 10, rightsStatus: "approved", audioQuality: { label: "weak" } }, { id: "source-b", event: "Stage B", audio: "ok", duration: 10, rightsStatus: "approved", audioQuality: { label: "clean" } }];
  const words = Object.fromEntries(sources.map((s, j) => [s.id, (j ? "Steady practice builds courage every morning." : "Careful listening helps teams solve problems.").split(" ").map((text, i) => ({ id: `${s.id}-${i}`, sourceId: s.id, text, start: i + 1, end: i + 1.8 }))]));
  let grouping = 0, selections = 0;
  const result = await findCandidates({ sources, words, ask: async (prompt) => {
    const input = JSON.parse(prompt.split("INPUT:\n")[1].split("\nOUTPUT:")[0]);
    if (Array.isArray(input)) {
      grouping++;
      return reply(input.map((c) => ({ id: c.id, beats })));
    }
    selections++;
    return JSON.stringify({ candidates: [{ kind: "one_liner", source_id: input.sources[0].id, start_word: input.words[0].id, end_word: input.words.at(-1).id, ratings: { topic: 4, clarity: 4, payoff: 4, specificity: 4, delivery: 4, novelty: 4 } }] });
  } });
  assert.equal(selections, 2);
  assert.equal(grouping, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceId, "source-b");
  assert.equal(result[0].alternates[0].sourceId, "source-a");
});

test("story comparison description shows both real tellings with timing, audio, reactions, score and BEST", () => {
  const text = describeStoryGroups([{ label: "Mentor", method: "model", members: [{ ...a, audioQuality: { label: "clean" }, reactionIds: ["r1"], reactionHints: ["r1"] }, b] }]);
  for (const expected of ["Mentor", "Event a", "Event b", "0:10.00-1:10.00", "60.00s", "audio clean", "audio unknown", "r1", "score 80", "BEST", "unverified hints"]) assert.ok(text.includes(expected), expected);
  assert.equal((text.match(/BEST/g) || []).length, 1);
  assert.equal(describeStoryGroups([]), "");
});

test("saved candidate grouping has its own cache and rehydrates audio without repeating the model or ASR", async (t) => {
  const folder = temp(t), base = path.join(folder, "work/candidates");
  writeJSON(path.join(base, "all.json"), [{ ...a, alternates: [b] }, unrelated]);
  writeJSON(path.join(folder, "speaker-manifest.json"), { sources: [{ id: "a", event: "Conference A" }] });
  writeJSON(path.join(folder, "work/index/sources.json"), { sources: { a: { audioQuality: { label: "clean", version: 1 } } } });
  const beforeIndex = fs.readFileSync(path.join(folder, "work/index/sources.json"), "utf8");
  let calls = 0;
  const options = { ask: async () => { calls++; return reply(); }, print: () => {} };
  const first = await groupCandidateFile(folder, options);
  assert.equal(first.groups[0].members[0].event, "Conference A");
  assert.equal(chooseTelling(first.groups[0]).best.id, "a");
  assert.equal(readJSON(first.file).version, STORY_VERSION);
  const updated = readJSON(path.join(base, "all.json"));
  updated[0].alternates[0].audioQuality = { label: "clean", version: 1 };
  updated[0].audioQuality = { label: "weak", version: 1 };
  writeJSON(path.join(base, "all.json"), updated);
  const second = await groupCandidateFile(folder, options);
  assert.equal(calls, 1);
  assert.equal(chooseTelling(second.groups[0]).best.id, "b");
  assert.equal(fs.readFileSync(path.join(folder, "work/index/sources.json"), "utf8"), beforeIndex);
  const old = readJSON(first.file); old.version--;
  writeJSON(first.file, old);
  await groupCandidateFile(folder, options);
  assert.equal(calls, 2);
  updated[0].text += " Changed words.";
  writeJSON(path.join(base, "all.json"), updated);
  await groupCandidateFile(folder, options);
  assert.equal(calls, 3);
  const broken = readJSON(first.file); broken.groups[0].members = null;
  writeJSON(first.file, broken);
  await groupCandidateFile(folder, options);
  assert.equal(calls, 4, "malformed optional cache is rebuilt");
});

test("stories CLI reads existing alternates, writes comparisons and ranked leads without candidate finding", async (t) => {
  const folder = temp(t), messages = [];
  writeJSON(path.join(folder, "work/candidates/all.json"), [{ ...a, score: 95, audioQuality: { label: "weak" }, alternates: [{ ...b, audioQuality: { label: "clean" } }] }, unrelated]);
  const result = await speakerMain(["stories", folder], { ask: async () => reply(), print: (s) => messages.push(s), candidates: () => { throw new Error("must never find candidates"); } });
  assert.ok(fs.existsSync(path.join(folder, "work/candidates/stories.json")));
  assert.equal(result.candidates.find((c) => c.id === "b").alternates[0].id, "a");
  assert.equal(readJSON(path.join(folder, "work/candidates/b.json"))[0].sourceId, "b");
  assert.ok(messages.join("\n").includes("BEST"));
  assert.equal(parseSpeakerArgs(["stories", folder]).command, "stories");
  assert.match(SPEAKER_HELP, /speaker stories <folder>/);
  assert.throws(() => writeCandidates(folder, [candidate("reserved", "", { sourceId: "stories" })]), /reserved/);
  await assert.rejects(groupCandidateFile(temp(t)), /run candidates first/);
});

test("candidates CLI groups the complete inventory once before limits, preserves source refreshes and source quality", async (t) => {
  const folder = temp(t);
  const manifest = { schemaVersion: 1, clientId: "client", identity: { name: "Avery Example", roleLine: "Speaker", bookingMode: "direct", bookingUrl: "https://example.test" }, brand: { file: "brand.json" }, brief: { topics: [] },
    sources: ["a", "b", "c", "d", "e"].map((id) => ({ id, event: `Event ${id}`, path: `${id}.bin`, audio: "ok", kind: "stage", rights: "r" })), rights: [{ id: "r", status: "approved" }], proof: [], music: [] };
  for (const s of manifest.sources) fs.writeFileSync(path.join(folder, s.path), `tiny source bytes ${s.id}`);
  writeJSON(path.join(folder, "speaker-manifest.json"), manifest);
  writeJSON(path.join(folder, "brand.json"), { name: "Avery Example" });
  const index = await indexSources(folder, manifest, { engine: "elevenlabs", print: () => {}, probe: async () => ({ duration: 80, hasVideo: false, hasAudio: true, audioStreams: [{ index: 0, default: true }] }), transcribe: async () => [{ text: "Learn.", start: 1, end: 2 }], audioEnvelope: async () => ({ step: 1, db: [] }) });
  index.sources.b.audioQuality = { label: "clean", version: 1 };
  writeJSON(path.join(folder, "work/index/sources.json"), index);
  const inventory = [a, b, unrelated, candidate("d", "Different speech on balancing family and work.", { score: 60 }), candidate("e", "A separate example of handling a schedule.", { score: 50 })];
  let calls = 0;
  const deps = { print: () => {}, reactions: async () => [], shots: async () => [], candidates: async (input) => {
    assert.equal(input.options.deferStoryGrouping, true);
    assert.equal(input.sources.find((s) => s.id === "b")?.audioQuality?.label, input.sources.some((s) => s.id === "b") ? "clean" : undefined);
    return inventory.filter((c) => input.sources.some((s) => s.id === c.sourceId));
  }, ask: async (prompt) => {
    calls++;
    const input = JSON.parse(prompt.split("INPUT:\n")[1].split("\nOUTPUT:")[0]);
    assert.equal(input.length, 5, "the model sees all candidates before the three-story limit");
    return reply();
  } };
  const first = await speakerMain(["candidates", folder], deps);
  assert.equal(calls, 1);
  assert.equal(first.length, 3);
  assert.equal(first.find((c) => c.id === "b").alternates[0].id, "a");
  const saved = readJSON(path.join(folder, "work/candidates/all.json"));
  saved.push(inventory.find((c) => c.id === "e"));
  writeJSON(path.join(folder, "work/candidates/all.json"), saved);
  await analyzeSpeaker(folder, { source: "a" }, deps);
  assert.equal(calls, 1, "unchanged combined evidence reuses its grouping cache");
  assert.ok(readJSON(path.join(folder, "work/candidates/all.json")).some((c) => c.id === "c"));
});

test("a story family never merges a one-liner into a complete story", async () => {
  const { rankCandidates } = await import("../src/speaker-moments.mjs");
  const base = { ratings: {}, flags: [], alternates: [], reactionIds: [] };
  const story = { ...base, id: "c-story", kind: "story", sourceId: "florida", in: 0, out: 60, score: 80, text: "mentor story", audioQuality: { label: "weak", score: 30 } };
  const line = { ...base, id: "c-line", kind: "one_liner", sourceId: "nova", in: 10, out: 13, score: 70, text: "power of a mentor", audioQuality: { label: "clean", score: 100 } };
  const families = [{ id: "s-1", label: "Mentor", method: "model", members: [story, line] }];
  const ranked = rankCandidates([story, line], { storyFamilies: families });
  assert.deepEqual(ranked.map((c) => [c.id, c.alternates.length]).sort(), [["c-line", 0], ["c-story", 0]]);
});
