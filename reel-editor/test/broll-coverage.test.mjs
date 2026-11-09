import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkPick, subjectWords } from "../src/broll.mjs";
import { runwayTiming, validateBrollPicks, placeRunwayBroll, runwayPicksPrompt } from "../src/broll-runway.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/broll/img-6056-timing.json", import.meta.url)));
const generatedScene = (pick) => ({
  driving: "A car driving along a desert highway.",
  flight: "An airplane flight taking off in daylight.",
  "middle of nowhere": "A remote road in the middle of nowhere.",
}[pick.shows] || pick.scene);

for (const { name, groups, pick } of fixture.cases) {
  test(`real word slice: ${name} survives stock and generated planning`, () => {
    const candidate = { i: 0, ...groups[0] }, rejected = [];
    const timing = (p, c, onReject) => runwayTiming(p, c, groups, { len: 2.5, onReject });
    const t = timing(pick, candidate);
    assert.ok(t, name);
    assert.ok(t.duration >= 1.2 - 1e-6 && t.duration <= 2.5);
    assert.ok(t.start + t.duration <= groups[pick.endsBefore.line].words[pick.endsBefore.wordIndex].start);
    assert.equal(t.start, groups[0].words.find((w) => w.text === pick.shows.split(" ")[0]).start);
    for (const stock of [true, false]) {
      const p = stock ? pick : { ...pick, scene: generatedScene(pick) };
      const valid = validateBrollPicks([p], [candidate], groups, timing, {}, { stock, onReject: (_, why) => rejected.push(why) });
      assert.equal(valid.length, 1);
      assert.equal(placeRunwayBroll(valid, [candidate], { timing }).length, 1);
    }
    assert.deepEqual(rejected, []);
    if (["laptop", "middle of nowhere"].includes(pick.shows)) {
      const payoff = groups[pick.endsAt.line].words[pick.endsAt.wordIndex].end;
      assert.ok(payoff - t.start < 1.2, "the actual spoken idea was too short for the old cap");
      assert.ok(t.start + t.duration > payoff, "related words give the picture readable time");
    }
  });
}

test("anchors cross several caption lines, retain connecting words, and start in the chosen line", () => {
  const groups = [
    { start: 10, text: "in the middle", words: [{ text: "in", start: 10 }, { text: "the", start: 10.1 }, { text: "middle", start: 10.2 }] },
    { start: 10.4, text: "of" }, { start: 10.6, text: "nowhere" },
  ];
  const pick = { shows: "middle of nowhere", scene: "A remote desert road.", duration: 1.8 };
  assert.deepEqual(subjectWords(pick.shows, pick.scene), ["middle", "of", "nowhere"]);
  assert.deepEqual(runwayTiming(pick, { i: 0, ...groups[0] }, groups), { start: 10.2, duration: 1.8000000000000007 });
  assert.equal(runwayTiming({ ...pick, shows: "nowhere of middle" }, { i: 0, ...groups[0] }, groups), null);
  assert.equal(runwayTiming({ ...pick, shows: "of nowhere" }, { i: 0, ...groups[0] }, groups), null);
});

test("timing diagnostics name hard limits, invalid refs and missing anchors", () => {
  const { groups, pick } = fixture.cases.find((c) => c.name === "greg line 48: laptop");
  const candidate = { i: 0, ...groups[0] }, start = 41.973;
  const reject = (change, options, expected) => {
    let reason;
    const timing = (p, c, onReject) => runwayTiming(p, c, groups, { ...options, onReject });
    assert.deepEqual(validateBrollPicks([{ ...pick, ...change }], [candidate], groups, timing, {}, { onReject: (_, why) => { reason = why; } }), []);
    assert.match(reason, expected);
  };
  reject({}, { busy: [{ start: start + 2, duration: 1 }] }, /busy\/clear limit.*leaves 0\.5s.*needs 1\.2s/);
  reject({}, { busy: [{ start, duration: 1 }] }, /busy\/clear limit.*leaves 0s/);
  reject({}, { until: start + 0.7 }, /until \(reel\/CTA\) limit.*leaves 0\.7s/);
  reject({ endsBefore: { line: 1, wordIndex: 0, text: "hopefully" } }, {}, /endsBefore limit.*leaves 1\.02s/);
  reject({ endsAt: { ...pick.endsAt, text: "wrong" } }, {}, /invalid endsAt word reference/);
  reject({ endsBefore: { ...pick.endsBefore, text: "wrong" } }, {}, /invalid endsBefore word reference/);
  reject({ shows: "computer" }, {}, /anchor not found across caption lines: computer/);
  reject({ line: 99 }, {}, /line is not a candidate/);
  const allowed = runwayTiming(pick, candidate, groups, { until: start + 1.2 });
  assert.ok(Math.abs(allowed.duration - 1.2) < 1e-6, "the minimum still fits exactly");
});

test("another accepted shot still excludes a crowded spot", () => {
  const { groups, pick } = fixture.cases.find((c) => c.name === "greg line 48: laptop");
  const candidates = [{ i: 0, ...groups[0] }, { i: 1, ...groups[0] }];
  const timing = (p, c) => runwayTiming(p, c, groups);
  const shots = placeRunwayBroll([{ ...pick, rank: 1 }, { ...pick, line: 1, rank: 2 }], candidates, { timing, gap: 3 });
  assert.equal(shots.length, 1);
  assert.equal(shots[0].rank, 1);
});

test("scene matching permits whole-word inflections in either engine", () => {
  for (const [shows, scene] of [["driving", "A car driven on a road."], ["drive", "A car driving on a road."], ["flight", "A jet flying overhead."], ["flying", "An airplane in flight."], ["mountains", "A mountain in daylight."], ["walking", "A person walks."], ["coconut", "Two coconuts on sand."]]) {
    for (const stock of [true, false]) assert.equal(checkPick({ shows, scene }, { start: 10 }, [{ start: 10, text: shows }], { stock }), null, `${shows}: ${scene}`);
  }
  assert.match(checkPick({ shows: "snake", scene: "A snakeskin boot." }, { start: 10 }, [{ start: 10, text: "snake" }], { stock: true }), /scene does not contain snake/);
});

test("only stock descriptions may use synonyms or an implied ambient setting", () => {
  const cases = [
    { shows: "flight", kind: "action", scene: "An airplane taking off.", stockSynonyms: ["airplane", "jet"] },
    { shows: "gorilla", kind: "action", scene: "A silverback ape in daylight.", stockSynonyms: ["silverback ape"] },
    { shows: "driving", kind: "ambient", scene: "An open desert highway." },
    { shows: "middle of nowhere", kind: "ambient", scene: "A lonely remote landscape." },
  ];
  for (const p of cases) {
    const groups = [{ start: 10, text: p.shows }];
    assert.equal(checkPick(p, { start: 10 }, groups, { stock: true }), null);
    assert.match(checkPick(p, { start: 10 }, groups), /scene does not contain/);
  }
  const check = (p) => checkPick(p, { start: 10 }, [{ start: 10, text: p.shows }], { stock: true });
  assert.match(check({ shows: "driving", kind: "action", scene: "An open highway." }), /scene does not contain driving/);
  assert.match(check({ shows: "gorilla", scene: "A silverback in daylight.", stockSynonyms: ["silverback ape"] }), /scene does not contain gorilla/);
  assert.match(check({ shows: "coconut", kind: "ambient", scene: "Packing tape on a shelf." }), /scene does not contain coconut/);
  assert.match(check({ shows: "snake", scene: "A snake beside a rope." }), /dark-read word/);
  assert.match(check({ shows: "knife", scene: "A knife on a desk." }), /weapon stays on the speaker/);
});

test("both planners request literal scene anchors and related-idea boundaries", () => {
  const prompt = runwayPicksPrompt({ candidates: [], count: 1 });
  assert.match(prompt, /Write the shows word literally in scene/);
  assert.match(prompt, /a car driving along a desert highway/);
  assert.match(prompt, /an airplane flight taking off/);
  assert.match(prompt, /first truly unrelated idea, not simply the next caption line/);
});
