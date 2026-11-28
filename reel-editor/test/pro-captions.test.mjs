import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProMeasure, proLineBreaks, splitProPhrases, proGoldBudget, markProKeywords, placeProCaptions } from "../src/pro-captions.mjs";
import { planProHook, proCaptionsUnderHook } from "../src/hook.mjs";
import { loadPreset } from "../src/presets.mjs";
import { fontFile } from "../src/util.mjs";

const preset = loadPreset("pingel-brand");
const measure = loadProMeasure(fontFile(preset, "Inter.ttf"));
const titleMeasure = loadProMeasure(fontFile(preset, "Anton-Regular.ttf"), { size: 108, weight: 400, tracking: 0 });
const words = (text, { start = 0, step = 0.25 } = {}) => text.split(/\s+/).map((text, i) => ({ text, start: start + i * step, end: start + i * step + step * 0.9 }));
const cue = (text, start, thought = 0) => ({ text, start, end: start + 1, thought, words: words(text, { start }), lines: [text.split(" ").length] });

test("pro line fitting uses Inter 700 widths and fixed-size two-line resegmentation", () => {
  assert.ok(measure("WWWW") > measure("iiii") * 2);
  const bold = loadProMeasure(fontFile(preset, "Inter.ttf"), { weight: 900 });
  assert.ok(bold("Caption") > measure("Caption"));
  const input = words("you lose your tonality");
  const lines = proLineBreaks(input, { measure });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.flat(), input);
  for (const line of lines) assert.ok(measure(line.map((w) => w.text).join(" ")) <= 780);
  assert.deepEqual(proLineBreaks([], { measure }), []);
  assert.equal(proLineBreaks(words("WWWWWWWWWWWWWWWWWWWW"), { measure }), null);
});

test("pro captions cover every retained token once and target readable meaning-based phrases", () => {
  const input = words("When you talk fast, you lose your tonality. You don't listen to respond, you listen to understand.");
  const before = structuredClone(input);
  const groups = splitProPhrases(input, 5, { measure });
  assert.deepEqual(input, before);
  assert.deepEqual(groups.flatMap((g) => g.words.map((w) => w.rawText)), input.map((w) => w.text));
  assert.equal(groups[0].text, "When you talk fast");
  assert.ok(groups.every((g) => g.words.length >= 2 && g.words.length <= 6));
  assert.ok(groups.every((g) => g.end - g.start >= 0.8 - 1e-6 && g.end - g.start <= 1.3));
  assert.ok(groups.every((g) => g.lines.length <= 2 && g.lines.reduce((a, b) => a + b, 0) === g.words.length));
  for (let i = 1; i < groups.length; i++) assert.equal(groups[i].start, groups[i - 1].end, "hard swaps without speech gaps");
  assert.equal(groups[0].thought, groups[1].thought);
  assert.notEqual(groups[1].thought, groups[2].thought);
});

test("pro splitter protects negations, curly apostrophes, numbers and dictionary phrases", () => {
  for (const text of ["you do not stop listening when a client talks", "you don’t listen to respond you listen to understand", "in twenty five percent of calls the buyer agrees", "you need one hundred and twenty calls before lunch"]) {
    const groups = splitProPhrases(words(text), 5, { measure });
    const endings = groups.slice(0, -1).map((g) => g.words.at(-1).text);
    for (const token of ["do", "not", "don’t", "twenty", "five", "hundred", "and"]) assert.ok(!endings.includes(token), `${text}: split after ${token}`);
  }
  const groups = splitProPhrases(words("we teach the sales velocity method to every new closer"), 5, { measure, protectedPhrases: new Set(["sales velocity"]) });
  assert.ok(groups.some((g) => /sales velocity/.test(g.text)));
  assert.deepEqual(splitProPhrases([], 2, { measure }), []);
});

test("pro splitter flags unavoidable fast cues and reports unrenderable words without dropping them", () => {
  const groups = splitProPhrases(words("stop now. keep going.", { step: 0.1 }), 0.4, { measure });
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.flags.includes("short-cue")));
  // A word wider than the line is shown smaller or hyphenated, never a failed reel (IMG_4766, Nov 27).
  const wide = splitProPhrases(words("WWWWWWWWWWWWWWWWWWWW"), 2, { measure });
  assert.equal(wide.flatMap((g) => g.words.map((w) => w.text)).join("").replace(/-/g, ""), "WWWWWWWWWWWWWWWWWWWW");
  assert.ok(wide.every((g) => g.fontScale > 0 && g.fontScale <= 1));
  const clipped = splitProPhrases([{ text: "last", start: 0.9, end: 1.3 }, { text: "removed", start: 1.2, end: 1.4 }], 1, { measure });
  assert.equal(clipped[0].end, 1);
  assert.equal(clipped[0].text, "last");
});

test("long pro phrases re-split instead of changing type size or losing words", () => {
  const input = words("professional conversations demonstrate consistent communication professional conversations demonstrate consistent communication");
  const groups = splitProPhrases(input, 4, { measure });
  assert.deepEqual(groups.flatMap((g) => g.words.map((w) => w.rawText)), input.map((w) => w.text));
  assert.ok(groups.every((g) => g.words.length <= 5));
  for (const g of groups) {
    const lines = proLineBreaks(g.words, { measure });
    assert.ok(lines.length <= 2);
    assert.ok(lines.every((line) => measure(line.map((w) => w.text).join(" ")) <= 780));
  }
});

test("pro gold budget is five per 30 s, capped at eight and one operative word per cue", () => {
  assert.deepEqual([0, 12, 30, 45, 90].map(proGoldBudget), [0, 2, 5, 8, 8]);
  const groups = Array.from({ length: 30 }, (_, i) => cue(`stop mistake${i} now`, i));
  const before = structuredClone(groups);
  const marked = markProKeywords(groups, 30, { terms: ["stop mistake0"], powerWords: ["now"] });
  assert.deepEqual(groups, before);
  assert.ok(marked.every((g) => g.words.filter((w) => w.key).length <= 1));
  assert.equal(marked.flatMap((g) => g.words).filter((w) => w.key).length, 5);
  assert.equal(marked[0].words.find((w) => w.key).text, "stop", "action beats a dictionary or automatic word");
  const diverse = Array.from({ length: 30 }, (_, i) => cue(`use method${i} carefully`, i));
  assert.equal(markProKeywords(diverse, 30).flatMap((g) => g.words).filter((w) => w.key).length, 5);
  assert.ok(markProKeywords(diverse, 90).flatMap((g) => g.words).filter((w) => w.key).length <= 8);
});

test("pro captions never sit on the face: below the lowest chin, else above the head, one anchor per thought", () => {
  const groups = [cue("first thought", 0), { ...cue("wrap this thought", 1), lines: [1, 2] }, cue("next thought", 3, 1)];
  const before = structuredClone(groups);
  const f = (t, top, chin) => ({ t, top: top / 1920, chin: chin / 1920 });
  // Faces well above the plate keep the default line.
  assert.ok(placeProCaptions(groups, [f(0.2, 500, 900), f(1.5, 520, 950), f(3.5, 500, 900)]).every((g) => g.y === 1248));
  // A chin dipping to 1230 moves the thought BELOW it (1230 + 56), still inside the safe line; others stay put.
  const dip = placeProCaptions(groups, [f(0.2, 800, 1200), f(1.5, 830, 1230), f(3.5, 500, 900)]);
  assert.equal(dip[0].y, dip[1].y);
  assert.equal(dip[0].y, 1286);
  assert.ok(dip[0].y + 208 <= 1720);
  assert.equal(dip[2].y, 1248);
  // No room below a very low face: above the highest head top instead, never between top and chin.
  const low = placeProCaptions(groups, [f(0.2, 1000, 1500), f(1.5, 1010, 1520)]);
  assert.ok(low[0].y + 208 <= 1000 - 56);
  assert.ok(low[0].y + 208 <= 1000 || low[0].y >= 1520, "plate clear of the low face");
  assert.equal(placeProCaptions(groups)[0].y, 1248);
  assert.equal(placeProCaptions(groups, [], { height: 960 })[0].y, 624);
  assert.deepEqual(groups, before);
});

test("pro hook has a bounded hold, fixed Anton size, two lines, and a word-shortened title", () => {
  const input = words("When you talk fast you lose your tonality.");
  for (const duration of [0, 1, 2.4, 3, "reel"]) {
    const hook = planProHook(input, { duration, reelDuration: 10, measure: titleMeasure });
    assert.equal(hook.start, 0);
    assert.ok(hook.duration >= 2 && hook.duration <= 2.7);
    assert.ok(hook.lines.length <= 2);
    assert.ok(!/\b(your|the|and|not)$/.test(hook.text));
  }
  const hook = planProHook(input, { text: "A professional conversation requires exceptionally thoughtful communication and extensive preparation", reelDuration: 10, measure: titleMeasure });
  assert.ok(hook.text.split(" ").length < 12);
  assert.ok(!hook.text.endsWith("and"));
  assert.equal(planProHook(input, { reelDuration: 1, measure: titleMeasure }).duration, 1);
  assert.equal(planProHook([], { reelDuration: 10, measure: titleMeasure }), null);
});

test("pro hook carries its duplicate words while unrelated opening and later speech remain captioned", () => {
  const groups = [cue("Stop talking fast", 0), cue("and start listening", 1), cue("Stop talking fast", 4, 1)];
  const hook = planProHook([], { text: "Stop talking fast", reelDuration: 10, measure: titleMeasure });
  const visible = proCaptionsUnderHook(groups, hook, { measure });
  assert.deepEqual(visible.map((g) => g.text), ["and start listening", "Stop talking fast"]);
  assert.deepEqual(proCaptionsUnderHook(groups, { ...hook, words: [{ text: "Different" }] }, { measure }), groups);
  assert.equal(proCaptionsUnderHook(groups, null, { measure }), groups);
  const mixed = [cue("Stop talking fast and listen", 0)];
  assert.equal(proCaptionsUnderHook(mixed, hook, { measure })[0].text, "and listen");
  const slow = [cue("Stop talking fast", 0), cue("and start listening", 3)];
  const longerHook = planProHook([], { text: "Stop talking fast and start listening", reelDuration: 10, measure: titleMeasure });
  assert.ok(!proCaptionsUnderHook(slow, longerHook, { measure }).some((g) => g.start < longerHook.duration), "even a hook whose speech extends past its hold cannot duplicate opening captions");
});
