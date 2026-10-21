import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupWords, markKeywords, autoKeyword } from "../src/captions.mjs";
import { loadPreset, mergeOverrides } from "../src/presets.mjs";

const dict = JSON.parse(readFileSync(new URL("../dictionary.json", import.meta.url)));

// The whiteboard clip that exposed the problem: real speech, no framework names, and the old picker found nothing.
const SPEECH =
  "Don't show up, text me, hey, man, I have to, I'm going to respect the team and not be in the meeting, because what if I say something, " +
  "what if the most important part of the meeting happens in the first minute? Or what if you being late distracts the team for three minutes, " +
  "and I know it's like, oh, we're distracted for three minutes.";
const words = SPEECH.split(" ").map((text, i) => ({ text, start: i * 0.2, end: i * 0.2 + 0.18 }));
const fresh = () => groupWords(structuredClone(words), words.length * 0.2, { wordsPerLine: 3 });
const keyed = (groups) => groups.map((g) => g.words.filter((w) => w.key).map((w) => w.text).join(" ")).filter(Boolean);

test("autoKeyword prefers number + unit pairs, then number words, then strong long words", () => {
  const w = (s) => s.split(" ").map((text) => ({ text }));
  assert.deepEqual(autoKeyword(w("for three minutes")), { i: 1, len: 2, score: 5 });
  assert.equal(autoKeyword(w("the first minute?")).len, 2);
  assert.equal(autoKeyword(w("the most important")).i, 2);
  assert.equal(autoKeyword(w("and I know")), null, "stop words never get gold");
  assert.equal(autoKeyword(w("something what if")), null, "filler long words are stop words");
});

test("without auto, real speech with no dictionary words gets almost no gold", () => {
  const off = keyed(markKeywords(fresh(), { terms: [], powerWords: [] }));
  assert.equal(off.length, 0);
});

test("auto keywords put gold on the words a person would pick, and keep it rare", () => {
  const groups = markKeywords(fresh(), dict, { auto: true });
  const k = keyed(groups);
  for (const want of ["show up", "respect", "important", "first minute?", "late", "three minutes"]) assert.ok(k.includes(want), `missing ${want} in ${JSON.stringify(k)}`);
  assert.equal(k.filter((x) => x === "meeting").length <= 1, true, "a repeated word only gets auto gold once");
  assert.ok(k.length < groups.length * 0.6, `${k.length}/${groups.length} lines gold is too many`);
  for (let i = 1; i < groups.length; i++) {
    const a = groups[i - 1].words.some((w) => w.key && w.text !== "three");
    const b = groups[i].words.some((w) => w.key);
    if (a && b) {
      const pair = [groups[i - 1].text, groups[i].text].join(" | ");
      const strong = /show up|respect|late|three minutes|first minute/i.test(pair);
      assert.ok(strong, `two gold lines in a row without a strong reason: ${pair}`);
    }
  }
});

test("dictionary and power words still win over auto picks", () => {
  const g = [{ words: [{ text: "the" }, { text: "Closer" }, { text: "Line" }] }, { words: [{ text: "never" }, { text: "important" }, { text: "again" }] }];
  markKeywords(g, dict, { auto: true });
  assert.deepEqual(g[0].words.map((w) => !!w.key), [false, true, true]);
  assert.deepEqual(g[1].words.map((w) => !!w.key), [true, false, false]);
});

test("--hook-position and --no-auto-keywords override the brand preset", () => {
  const brand = loadPreset("pingel-brand");
  assert.equal(brand.captions.autoKeywords, true);
  assert.equal(brand.hook.position, 0.22);
  const p = mergeOverrides(brand, { hookPosition: "0.4", noAutoKeywords: true });
  assert.equal(p.hook.position, 0.4);
  assert.equal(p.captions.autoKeywords, false);
  assert.equal(loadPreset("clean").captions.autoKeywords, false, "clean preset stays plain");
});

test("everyday phrases highlight but stay out of the Whisper hints", () => {
  const hints = (dict.terms || []).slice(0, 40).map((t) => t.toLowerCase());
  assert.ok(!hints.includes("show up"), "a Whisper hint for 'show up' once made it drop a clipped opening \"Don't\"");
  assert.ok((dict.phrases || []).includes("show up"));
  const g = [{ words: [{ text: "Don't" }, { text: "show" }, { text: "up," }] }];
  markKeywords(g, dict);
  assert.deepEqual(g[0].words.map((w) => !!w.key), [false, true, true]);
});

test("hookWords picks one gold phrase, or takes it from *asterisks*", async () => {
  const { hookWords } = await import("../src/captions.mjs");
  const auto = hookWords("The 10 minutes after a bad number", dict);
  assert.deepEqual(auto.words.filter((w) => w.key).map((w) => w.text), ["10", "minutes"]);
  const late = hookWords("Running late? Stay out of the meeting", dict);
  assert.deepEqual(late.words.filter((w) => w.key).map((w) => w.text), ["late?"]);
  const hand = hookWords("The 10 minutes after a *bad number*", dict);
  assert.equal(hand.text, "The 10 minutes after a bad number");
  assert.deepEqual(hand.words.filter((w) => w.key).map((w) => w.text), ["bad", "number"]);
});

test("headline hook renders words, scrim and rule, and the brand preset uses it", async () => {
  const { renderHTML } = await import("../src/compose.mjs");
  const { hookWords } = await import("../src/captions.mjs");
  const style = loadPreset("pingel-brand");
  assert.equal(style.hook.style, "headline");
  const hook = { start: 0, duration: 3, ...hookWords("The 10 minutes after a bad number", dict) };
  const html = renderHTML({ name: "t", canvas: { width: 1080, height: 1920 }, style, video: { src: "/x.mp4", duration: 8, hasAudio: true }, captions: [], hook, zooms: [], audio: { tracks: [] } }, "assets/footage.mp4");
  assert.match(html, /id="hook-scrim"/);
  assert.match(html, /id="hook-bar"/);
  assert.equal((html.match(/class="hw k"/g) || []).length, 2, "10 and minutes are gold");
  assert.doesNotMatch(html, /id="hook-text"/, "no boxed span in headline mode");
  const boxed = renderHTML({ name: "t", canvas: { width: 1080, height: 1920 }, style: mergeOverrides(style, { titleStyle: "box" }), video: { src: "/x.mp4", duration: 8, hasAudio: true }, captions: [], hook, zooms: [], audio: { tracks: [] } }, "assets/footage.mp4");
  assert.match(boxed, /id="hook-text"/, "older styles still work");
});
