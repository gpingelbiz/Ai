import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { checkPicks, glowPrompt, layoutGlow, restyleGlow } from "../src/glow.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";

const wordsOf = (text) => text.split(" ").map((text, i) => ({ text, start: 4 + i * 0.4, end: 4.3 + i * 0.4 }));
const heroWords = wordsOf("Your most expensive habit");
const hero = { variant: "hero", from: 0, to: 3, hero: 2 };
const swapWords = wordsOf("It's not luck it's work");
const swap = { variant: "swap", from: 0, to: 4, wrong: 2, right: 4, br: 3 };
const checked = (words, features) => checkPicks({ features }, words, []);
const layout = (words, features, detection = null, W = 1080, H = 1920) => layoutGlow({ words, video: { duration: 15 } }, checked(words, features), [], detection, { W, H });
const rows = (g) => g.words.reduce((lines, w) => { if (w.br) lines.push([]); lines.at(-1).push(w.text); return lines; }, [[]]);

function fixture(words, features) {
  const style = structuredClone(loadPreset("pingel-brand"));
  style.captions = { ...style.captions, style: "glow" };
  const { captions, icons, scenes: glowScenes, overlays: glowOverlays } = layout(words, features);
  return { name: "glow-features", preset: "pingel-brand", canvas: { width: 1080, height: 1920 }, video: { duration: 15, hasAudio: true }, style, words, captions, icons, glowScenes, glowOverlays };
}

function page(plan) {
  const html = renderHTML(plan, "assets/footage.mp4");
  const script = html.match(/<script>\n([\s\S]*?)\n    <\/script>/)[1];
  const runtime = JSON.parse(script.match(/const PLAN = (.*);/)[1]);
  assert.doesNotThrow(() => new Function(script));
  return { html, script, runtime };
}

test("feature prompt describes hero isolation and literal spoken swaps", () => {
  const prompt = glowPrompt(heroWords, [], { duration: 15 });
  assert.match(prompt, /variant "hero"/);
  assert.match(prompt, /at most 9 characters/);
  assert.match(prompt, /support line, at most 16 characters/);
  assert.match(prompt, /variant "swap" only when Greg literally contrasts/);
  assert.match(prompt, /Both words must be spoken/);
});

test("hero checks preserve its absolute index and reject bad indexes and lengths", () => {
  assert.deepEqual(checked(heroWords, [hero]).features, [{ from: 0, to: 3, key: 2, br: null, variant: "hero", hero: 2 }]);
  for (const index of [-1, 4, 1.5, "2", null]) {
    assert.equal(checked(heroWords, [{ ...hero, hero: index }]).features.length, 0);
  }
  assert.equal(checked(wordsOf("Your extraordinary habit"), [{ ...hero, to: 2, hero: 1 }]).features.length, 0);
  assert.equal(checked(wordsOf("Your !!! habit"), [{ ...hero, to: 2, hero: 1 }]).features.length, 0);
  assert.equal(checked(heroWords, [{ ...hero, from: 1, hero: 0 }]).features.length, 0);
  assert.equal(checked(wordsOf("This support is too long expensive habit"), [{ ...hero, to: 6, hero: 5 }]).features.length, 0);
  assert.equal(checked(wordsOf("Your expensive support is far too long"), [{ ...hero, to: 6, hero: 1 }]).features.length, 0);
  assert.equal(checked(wordsOf("Your most expensive habit"), [{ ...hero, from: 2, to: 2 }]).features.length, 0);
});

test("hero support lines accept sixteen characters and hero words accept nine", () => {
  const ws = wordsOf("Your costly ways expensive daily habit");
  const picks = checked(ws, [{ variant: "hero", from: 0, to: 5, hero: 3 }]);
  assert.equal(picks.features.length, 1); // "Your costly ways" = 16; "expensive" = 9
  const { variant, ...fields } = hero;
  assert.equal(checked(heroWords, [fields]).features[0].variant, variant);
});

test("swap checks require two distinct spoken words inside the phrase in order and two short lines", () => {
  assert.deepEqual(checked(swapWords, [swap]).features, [{ from: 0, to: 4, key: 4, br: 3, variant: "swap", wrong: 2, right: 4 }]);
  for (const change of [{ wrong: -1 }, { right: 5 }, { right: "4" }, { wrong: 2.5 }, { right: 2 }, { wrong: 4, right: 2 }, { wrong: null }]) {
    assert.equal(checked(swapWords, [{ ...swap, ...change }]).features.length, 0);
  }
  assert.equal(checked(swapWords, [{ ...swap, br: null }]).features.length, 0);
  assert.equal(checked(wordsOf("It's not luck it's luck"), [swap]).features.length, 0);
  assert.equal(checked(wordsOf("It's not luck it's !!!"), [swap]).features.length, 0);
  assert.equal(checked(swapWords, [{ ...swap, from: 1, wrong: 0 }]).features.length, 0);
  assert.equal(checked(swapWords, [{ ...swap, to: 3 }]).features.length, 0);
  const { variant, ...fields } = swap;
  assert.equal(checked(swapWords, [fields]).features[0].variant, variant);
  assert.equal(checked(wordsOf("not luck work"), [{ variant: "swap", from: 0, to: 2, wrong: 1, right: 2 }]).features.length, 1);
});

test("invalid variants do not claim words and valid variants obey existing hook and overlap guards", () => {
  assert.equal(checked(heroWords, [{ ...hero, hero: 10 }, hero]).features.length, 1);
  assert.equal(checked(heroWords, [{ ...hero, variant: "invented" }]).features.length, 0);
  assert.equal(checked(heroWords, [hero, hero]).features.length, 1);
  assert.equal(checkPicks({ features: [hero] }, heroWords, [], { hookEnd: 5 }).features.length, 0);
  assert.equal(checkPicks({ features: [hero], overlays: [{ type: "stamp", word: 2 }] }, heroWords, []).features.length, 0);
  const ws = wordsOf("one two three four five six seven eight");
  assert.equal(checked(ws, [{ variant: "hero", from: 0, to: 7, hero: 3 }]).features.length, 0);
});

test("hero layout isolates the gold word between two small rows and reserves its actual height", () => {
  const g = layout(heroWords, [hero]).captions.find((g) => g.kind === "feat");
  assert.deepEqual(rows(g), [["Your", "most"], ["expensive"], ["habit"]]);
  assert.deepEqual(g.words.map((w) => !!w.hero), [false, false, true, false]);
  assert.deepEqual(g.words.filter((w) => w.key).map((w) => w.text), ["expensive"]);
  assert.equal(g.place.heroSize, g.place.size * 2);
  assert.ok(g.place.heroSize * 9 * 0.72 <= g.place.w);
  assert.equal(g.place.h, Math.ceil((g.place.heroSize + 2 * g.place.size) * 1.08 + 2 * 0.04 * g.place.size + 8));
  assert.ok(g.place.h > 0.07 * 1920);
  assert.ok(g.place.y + g.place.h <= 0.785 * 1920);
  assert.ok(g.place.x + g.place.w <= 0.86 * 1080);
  assert.deepEqual(g.words.map((w) => [w.start, w.end]), heroWords.map((w) => [w.start, w.end]));
});

test("hero at either end uses only two rows and scales safely with the canvas", () => {
  for (const [text, index] of [["Expensive daily habit", 0], ["Your worst habit", 2]]) {
    const ws = wordsOf(text);
    for (const [W, H] of [[1080, 1920], [720, 1280]]) {
      const g = layout(ws, [{ variant: "hero", from: 0, to: 2, hero: index }], null, W, H).captions.find((g) => g.kind === "feat");
      assert.equal(rows(g).length, 2);
      assert.equal(g.words[0].br, undefined);
      assert.equal(g.place.heroSize, g.place.size * 2);
      assert.equal(g.place.h, Math.ceil((g.place.heroSize + g.place.size) * 1.08 + 0.04 * g.place.size + 8));
      assert.ok(g.place.y + g.place.h <= 0.785 * H);
    }
  }
});

test("a hero falls back when its taller block would enter the subtitle zone", () => {
  const detection = { frames: [{ t: heroWords.at(-1).end + 0.2, faces: [{ x: 0.2, y: 0.39, w: 0.4, h: 0.3 }] }] };
  const out = layout(heroWords, [hero], detection);
  assert.ok(out.captions.every((g) => g.kind === "sub"));
  assert.deepEqual(out.captions.flatMap((g) => g.words.map((w) => w.text)), heroWords.map((w) => w.text));
  assert.equal(layout(heroWords, [{ from: 0, to: 3, key: 2, br: 2 }], detection).captions.filter((g) => g.kind === "feat").length, 1);
});

test("swap layout keeps two short rows, spoken timing, and wrong/right flags with only right in gold", () => {
  const g = layout(swapWords, [swap]).captions.find((g) => g.kind === "feat");
  assert.equal(g.variant, "swap");
  assert.deepEqual(rows(g), [["It's", "not", "luck"], ["it's", "work"]]);
  assert.equal(g.words[2].wrong, true);
  assert.equal(g.words[4].right, true);
  assert.deepEqual(g.words.filter((w) => w.key).map((w) => w.text), ["work"]);
  assert.equal(g.place.h, Math.ceil(g.place.size * (2 * 1.08 + 0.04) + 8));
  assert.deepEqual(g.words.map((w) => [w.start, w.end]), swapWords.map((w) => [w.start, w.end]));
  const single = layout(wordsOf("not luck work"), [{ variant: "swap", from: 0, to: 2, wrong: 1, right: 2 }]).captions[0];
  assert.deepEqual(rows(single), [["not", "luck", "work"]]);
  assert.equal(single.place.h, Math.ceil(single.place.size * 1.08 + 8));
});

test("composed hero page has three unwrapped rows, isolated gold text and explicit 2x size", () => {
  const plan = fixture(heroWords, [hero]);
  const { html, runtime } = page(plan);
  const block = html.match(/<div class="cap cap-feat cap-hero"[^\n]+/)[0];
  assert.equal((block.match(/class="cap-row"/g) || []).length, 3);
  assert.match(block, /class="w k hero" id="cap-0-w2">expensive<span class="glow-light" aria-hidden="true">expensive<\/span><\/span>/);
  assert.match(block, new RegExp(`--hero-size:${plan.captions[0].place.heroSize}px`));
  assert.match(html, /\.cap-row \{ display: flex; flex-wrap: nowrap/);
  assert.match(html, /\.cap\.cap-hero \.w.hero \{ font-size: var\(--hero-size\)/);
  assert.deepEqual(runtime.capKinds, ["feat"]);
  assert.deepEqual(runtime.capSwaps, [null]);
});

test("composed swap timeline builds each word, then strikes and dims exactly at the right word", () => {
  const { html, script, runtime } = page(fixture(swapWords, [swap]));
  assert.match(html, /class="w wrong" id="cap-0-w2">luck<span class="glow-light" aria-hidden="true">luck<\/span><span class="swap-strike" id="cap-0-strike" aria-hidden="true"><\/span>/);
  assert.match(html, /class="w k right" id="cap-0-w4">work<span class="glow-light" aria-hidden="true">work<\/span><\/span>/);
  assert.match(html, /\.swap-strike \{[^}]+transform: scaleX\(0\); transform-origin: 0 50%/);
  assert.deepEqual(runtime.capSwaps, [{ wrong: 2, right: 4 }]);
  const calls = [];
  const timeline = script.slice(script.indexOf("PLAN.captions.forEach((g, i) => {"), script.indexOf("// Face-tracking reframe:"));
  vm.runInNewContext(timeline, {
    PLAN: runtime,
    document: { getElementById: (id) => ({ id, firstElementChild: { id: "line" }, querySelector: () => null }), querySelectorAll: () => [] },
    tl: Object.fromEntries(["set", "to", "fromTo"].map((method) => [method, (...args) => calls.push({ method, args })])),
  });
  const strike = calls.find((c) => c.args[0] === "#cap-0-strike");
  assert.equal(strike.method, "fromTo");
  assert.equal(strike.args[1].scaleX, 0);
  assert.equal(strike.args[2].scaleX, 1);
  assert.equal(strike.args[2].immediateRender, false);
  assert.equal(strike.args[3], swapWords[4].start);
  const dim = calls.find((c) => c.args[0] === "#cap-0-w2" && /^rgba\(.*0\.38\)$/.test(c.args[2]?.color || ""));
  assert.ok(dim.args[1].color, "dims by colour so the strike keeps full strength");
  assert.equal(dim.args[3], swapWords[4].start);
  const builds = calls.filter((c) => c.method === "fromTo" && c.args[2]?.filter === "blur(0px)");
  assert.equal(builds.length, swapWords.length);
  builds.forEach((c, i) => assert.equal(c.args[3], Math.max(runtime.captions[0].start, swapWords[i].start - 0.03)));
});

test("variant flags emit no markup, styles or runtime additions when glow is off", () => {
  const plan = fixture(swapWords, [swap]);
  plan.style.captions.style = "pop";
  const legacy = structuredClone(plan);
  delete legacy.captions[0].variant;
  legacy.captions[0].words.forEach((w) => { delete w.wrong; delete w.right; });
  const { html, runtime } = page(plan);
  assert.equal(html, renderHTML(legacy, "assets/footage.mp4"));
  assert.doesNotMatch(html, /swap-strike|capSwaps|cap-row|cap-hero|cap-swap/);
  assert.equal(runtime.glow, undefined);
});

test("saved-pick restyle wires both variants through to a standalone page without calling Claude", async () => {
  const ws = wordsOf("Your most expensive habit it's not luck it's work");
  const features = [hero, { ...swap, from: 4, to: 8, wrong: 6, right: 8, br: 7 }];
  const plan = fixture(ws, []);
  const result = await restyleGlow(plan, { library: [], picks: { features }, ask: () => { throw new Error("No API call allowed"); } });
  assert.deepEqual(result.plan.captions.filter((g) => g.kind === "feat").map((g) => g.variant), ["hero", "swap"]);
  const { html, runtime } = page(result.plan);
  assert.match(html, /cap-feat cap-hero/);
  assert.match(html, /cap-feat cap-swap/);
  assert.deepEqual(runtime.capSwaps, [null, { wrong: 2, right: 4 }]);
});
