import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openingHook, goodHook, autoHookText, hookPrompt } from "../src/hook.mjs";
import { loadProMeasure, splitProPhrases, longWordCue, PRO_CAPTION_LINE } from "../src/pro-captions.mjs";
import { proCaptionHTML } from "../src/pro-text.mjs";
import { deadAirProblems } from "../src/gate.mjs";
import { removeRanges, guardSilenceCuts } from "../src/cuts.mjs";

const say = (text, t0 = 0.2, step = 0.3) => text.split(" ").map((w, i) => ({ text: w, start: r(t0 + i * step), end: r(t0 + i * step + 0.25) }));
const r = (x) => Math.round(x * 1000) / 1000;
const measure = loadProMeasure(new URL("../assets/fonts/Inter.ttf", import.meta.url).pathname);

test("a hook from the opening is a complete thought, or none: no cut at a word count, no trailing comma", () => {
  assert.equal(openingHook(say("Every block has a purpose. If it isn't on the calendar, it's a wish.")), "Every block has a purpose");
  // The H5 opening: one long sentence. Cutting it at 12 words made "...is, who"; now there is no spoken hook.
  assert.equal(openingHook(say("The question to ask every morning is, who in my pipeline is closest to giving me a dollar today?")), null);
  assert.equal(openingHook(say("Yes.")), null);
  assert.equal(goodHook("Measure the inputs you *control*"), true);
  for (const bad of ["The question to ask every morning is, who", "The best time to prospect, follow up,", "The biggest threat to consistency isn't", "Too short"]) assert.equal(goodHook(bad), false, bad);
});

test("with no complete opening line, the hook is written the clip picker's way and cached; a bad reply is asked once more", async () => {
  const words = say("The question to ask every morning is, who in my pipeline is closest to giving me a dollar today?");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-"));
  const cache = path.join(dir, "hook-written.json");
  const replies = [{ hook: "The question to ask every morning is, who" }, { hook: "Ask who is *closest to a dollar*" }];
  let asked = 0;
  const ask = async (prompt) => { asked++; assert.match(prompt, /never ends on a comma/); return replies.shift(); };
  const got = await autoHookText(words, { ask, cache, fsx: fs });
  assert.deepEqual(got, { text: "Ask who is *closest to a dollar*", source: "written" });
  assert.equal(asked, 2);
  const again = await autoHookText(words, { ask: async () => { throw new Error("never asked again"); }, cache, fsx: fs });
  assert.equal(again.source, "written (cached)");
  assert.equal(await autoHookText(words, { ask: null }), null, "no Claude: the caller keeps its old behaviour");
  assert.match(hookPrompt(words), /4-8 words/);
});

test("one long word never fails the pro captions: it gets its own cue at a size that fits, or a hyphen", () => {
  const groups = splitProPhrases(say("You're getting paid disproportionately to what you're putting in.", 1), 20, { measure });
  const long = groups.find((g) => g.text === "disproportionately");
  assert.ok(long && long.fontScale > 0.55 && long.fontScale < 1, JSON.stringify(long));
  assert.ok(measure("disproportionately") * long.fontScale <= PRO_CAPTION_LINE);
  assert.equal(groups.flatMap((g) => g.words).length, 9, "every word is shown");
  assert.match(proCaptionHTML(long, 3), /class="cap-line" style="font-size:\d+px;line-height:\d+px"/);
  const huge = longWordCue({ text: "antidisestablishmentarianismlike", start: 0, end: 1 }, { measure });
  assert.equal(huge.words.length, 2);
  assert.ok(huge.words[0].text.endsWith("-"));
  assert.ok(huge.words.every((w) => measure(w.text) * (huge.fontScale || 1) <= PRO_CAPTION_LINE + 1));
  // Even a protected phrase wider than the line never throws.
  assert.doesNotThrow(() => splitProPhrases(say("Call the disproportionatelysuccessfulreps first.", 1), 20, { measure, protectedPhrases: ["the disproportionatelysuccessfulreps first."] }));
});

test("dead air over 2 s holds the reel and maps to source time so the edit can cut it", () => {
  const words = [...say("Think about a block of ice sitting there.", 0.2), ...say("That's the part nobody sees.", 9.0)];
  const plan = { canvas: { width: 1080, height: 1920 }, words, style: {} };
  const cuts = { segments: [{ start: 50, end: 54 }, { start: 60, end: 80 }] };
  const [p] = deadAirProblems(plan, cuts);
  assert.equal(p.code, "dead-air");
  assert.equal(p.level, "hold");
  assert.ok(p.gap > 6 && p.gap < 7, String(p.gap));
  // "there." ends at reel 2.55 s: 0.25 s later is 52.8 s in the source; the next word at reel 9.0 s, less 0.15 s, is
  // 4.85 s into the second kept segment (64.85 s).
  assert.deepEqual(p.cutSource, { start: 52.8, end: 64.85 });
  assert.deepEqual(deadAirProblems({ ...plan, style: { look: "receipts" } }, cuts), [], "a proof reel's texts hold on purpose");
  assert.deepEqual(deadAirProblems({ ...plan, canvas: { width: 1920, height: 1080 } }, cuts), [], "vertical reels only");
  assert.deepEqual(deadAirProblems({ ...plan, words: say("No gap here at all.") }, cuts), []);
});

test("removeRanges cuts the gate's stretches out of the kept segments", () => {
  const cuts = { segments: [{ start: 0, end: 10 }, { start: 12, end: 30 }], removed: [{ start: 10, end: 12, reason: "silence" }], keptDuration: 28 };
  const out = removeRanges(cuts, [{ start: 20, end: 25 }]);
  assert.deepEqual(out.segments, [{ start: 0, end: 10 }, { start: 12, end: 20 }, { start: 25, end: 30 }]);
  assert.equal(out.keptDuration, 23);
  assert.ok(out.removed.some((x) => x.reason === "dead-air" && x.start === 20));
});

test("the silence guard keeps sound next to a word but not room sound seconds away from any word", () => {
  const step = 0.02, dur = 20, db = Array.from({ length: dur / step }, () => -70);
  const loud = (a, b) => { for (let i = Math.round(a / step); i < Math.round(b / step); i++) db[i] = -40; };
  loud(0, 4); loud(4.1, 4.3); loud(7, 8.5); loud(12, 20);
  // Speech 0-4 and 12-20; a planned cut 4-12. Sound at 4.1-4.3 is a clipped word tail (kept); 7-8.5 is the room.
  const cuts = { segments: [{ start: 0, end: 4 }, { start: 12, end: 20 }], removed: [{ start: 4, end: 12, reason: "silence" }], keptDuration: 12 };
  const { cuts: out } = guardSilenceCuts(cuts, { step, db }, dur);
  assert.ok(out.segments[0].end >= 4.29, JSON.stringify(out.segments));
  assert.ok(out.segments[0].end < 5, "the room sound 3 s from any word does not come back");
  assert.equal(out.segments.length, 2);
});
