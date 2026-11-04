import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupWords, markKeywords, cleanText, keywordColorOnFootage, autoKeyword, hookWords } from "../src/captions.mjs";
import { applyCorrections } from "../src/transcribe.mjs";
import { pickHook, pickCta } from "../src/hook.mjs";
import { planZooms } from "../src/zooms.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { placeCaptions } from "../src/placement.mjs";

const sample = JSON.parse(readFileSync(new URL("../examples/sample-words.json", import.meta.url))).words;
const dict = JSON.parse(readFileSync(new URL("../dictionary.json", import.meta.url)));

test("automatic gold lands on the last punch word instead of a long verb", () => {
  const words = (s) => s.split(" ").map((text) => ({ text }));
  for (const [line, want] of [
    ["Going to work feels like entering a jungle", "jungle"], ["a snake coming", "snake"],
    ["and a coconut", "coconut"], ["in the quicksand", "quicksand"], ["Bring a knife", "knife"],
    ["I'm going to the jungle okay?", "jungle"], ["quicksand and sand", "sand"],
    ["snake attacked quickly", "snake"], ["be prepared", "prepared"], ["it's guaranteed something's", "guaranteed"],
    ["ever know what's", "ever"],
  ]) {
    const ws = words(line);
    assert.equal(ws[autoKeyword(ws).i].text, want, line);
  }
  assert.deepEqual(hookWords("Going to work feels like entering a jungle").words.filter((w) => w.key).map((w) => w.text), ["jungle"]);
  const weak = "okay gonna wanna gotta really thing stuff something everything going coming getting every single always little through entering quickly what's that's something's";
  for (const text of weak.split(" ")) assert.equal(autoKeyword([{ text }]), null, text);
  assert.deepEqual(autoKeyword(words("three minutes in the quicksand")), { i: 0, len: 2, score: 5 });
  const power = markKeywords([{ words: words("attacked by a snake") }], { powerWords: ["attacked"] }, { auto: true });
  assert.deepEqual(power[0].words.filter((w) => w.key).map((w) => w.text), ["attacked"]);
});

test("shorter punch words keep gold rare: once per clip and never on adjacent auto lines", () => {
  const groups = ["a snake coming", "and a coconut", "Bring a knife", "a jungle", "a snake", "in the quicksand"].map((text) => ({ words: text.split(" ").map((text) => ({ text })) }));
  markKeywords(groups, {}, { auto: true, maxPerLine: 1 });
  assert.deepEqual(groups.map((g) => g.words.filter((w) => w.key).map((w) => w.text)), [["snake"], [], ["knife"], [], [], ["quicksand"]]);
  assert.ok(groups.every((g) => g.words.filter((w) => w.key).length <= 1));
});

test("Greg's restored gold drives spaced punch-ins, pop, dimmed words and markers", () => {
  const style = loadPreset("pingel-brand");
  const groups = ["a snake coming", "and a coconut", "Bring a knife", "a jungle", "in the quicksand", "a truck", "a coconut"].map((text, i) => ({
    text, start: 4 + i * 3, end: 6 + i * 3,
    words: text.split(" ").map((text, j) => ({ text, start: 4 + i * 3 + j * 0.3, end: 4.3 + i * 3 + j * 0.3 })),
  }));
  markKeywords(groups, {}, { auto: style.captions.autoKeywords, maxPerLine: style.captions.maxKeywordsPerLine });
  const ins = planZooms(groups, 30, style.zooms).filter((k) => k.scale > 1);
  assert.deepEqual(ins.map((k) => k.t), [4, 10, 16, 22]);
  assert.equal(style.zooms.cadence.enabled, false);
  const html = renderHTML({ name: "pop", canvas: { width: 1080, height: 1920 }, style, video: { duration: 30, hasAudio: true }, captions: groups, zooms: [] }, "assets/footage.mp4");
  assert.match(html, /"capCut":false/);
  assert.match(html, /"capDim":true/);
  assert.match(html, /<svg class="an /);
  assert.match(html, /\.cap \.w\.k \{ color: #C8A24B;/);
  assert.match(html, /text-transform: uppercase; color: #F5F1E8/);
});

test("Greg's captions clear a close selfie chin and keep two wrapped rows above the bottom UI", () => {
  const cap = loadPreset("pingel-brand").captions;
  const opts = { fontSizeFrac: cap.fontSizeFrac, gap: cap.placeGap, min: cap.placeMin, max: cap.placeMax, defaultPosition: cap.position };
  assert.equal(cap.placeMax, 0.79);
  for (const bottom of [0.71, 0.72, 0.73, 0.80]) {
    const spot = placeCaptions({ top: 0.2, bottom }, opts);
    const top = spot.position - 0.6 * cap.fontSizeFrac;
    const blockBottom = top + cap.fontSizeFrac * (2 * 1.04 + 0.02);
    assert.ok(blockBottom <= 0.84, `${blockBottom} crosses the bottom UI`);
    if (bottom <= 0.73) assert.ok(top > bottom, `${top} overlaps chin at ${bottom}`);
  }
  const fallback = placeCaptions(null, { ...opts, defaultPosition: 0.9 });
  assert.ok(fallback.position + cap.fontSizeFrac * (2 * 1.08 + 0.02 - 0.6) <= 0.84);
});

test("keyword color over footage keeps today's default and supports a weight-only guard", () => {
  assert.equal(keywordColorOnFootage({}), true);
  assert.equal(keywordColorOnFootage({ keywordColorOnFootage: true }), true);
  assert.equal(keywordColorOnFootage({ keywordColorOnFootage: false }), false);
});

test("dictionary corrections merge split framework names and keep punctuation", () => {
  const w = applyCorrections(sample, dict.corrections);
  const i = w.findIndex((x) => x.text === "Ghost");
  assert.ok(i > 0);
  assert.equal(w[i + 1].text, "P&L");
  assert.equal(w[i + 2].text, "problem.");
  assert.equal(w[i].start, 2.75);
  assert.equal(w[i + 1].end, 3.55);
});

test("groupWords makes short lines (3, one more to keep a phrase whole), breaks on sentence end and pauses, never overlaps", () => {
  const groups = groupWords(sample, 24, { wordsPerLine: 3 });
  assert.ok(groups.every((g) => g.words.length <= 4));
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i].start >= groups[i - 1].end);
  assert.equal(groups[0].text, "Most coaches don't");
  assert.ok(groups.some((g) => /sales problem$/.test(g.text)), "trailing period stripped and sentence ends the line");
});

test("markKeywords prefers dictionary terms, then numbers and power words", () => {
  const groups = markKeywords(groupWords(applyCorrections(sample, dict.corrections), 24), dict);
  const keyed = groups.map((g) => g.words.filter((w) => w.key).map((w) => w.text).join(" ")).filter(Boolean);
  // "sales" is an everyday candidate now, so the power word on its line ("problem") wins; framework names stay gold.
  assert.ok(keyed.some((k) => /problem|sales/.test(k)));
  assert.ok(keyed.includes("Ghost P&L"));
  assert.ok(keyed.includes("$40,000"));
  assert.ok(keyed.includes("Stop"));
});

test("cleanText strips emojis and trailing punctuation but keeps ? and !", () => {
  assert.equal(cleanText("money. 🔥"), "money");
  assert.equal(cleanText("really?"), "really?");
});

test("pickHook uses the first sentence or the supplied text", () => {
  assert.equal(pickHook(sample).text, "Most coaches don't have a sales problem");
  assert.equal(pickHook(sample, { text: "You don't have a sales problem." }).text, "You don't have a sales problem");
});

test("planZooms punches in on gold lines only, releases each one, and keeps them apart", () => {
  const groups = markKeywords(groupWords(sample, 24), dict);
  const z = planZooms(groups, 24, { minSpacing: 4, scales: [1.14, 1.22] });
  const ins = z.filter((k) => k.scale > 1);
  assert.ok(ins.length >= 1);
  for (const k of ins) assert.ok(groups.some((g) => g.start === k.t && g.words.some((w) => w.key)), "every punch-in sits on a gold line");
  for (let i = 1; i < ins.length; i++) assert.ok(ins[i].t - ins[i - 1].t >= 4);
  assert.equal(z.filter((k) => k.scale === 1).length, ins.length, "each punch-in is released");
});

test("renderHTML produces a standalone composition with one timeline and local fonts", () => {
  const groups = markKeywords(groupWords(sample, 24), dict);
  const style = JSON.parse(readFileSync(new URL("../presets/_defaults.json", import.meta.url)));
  const html = renderHTML(
    { name: "t", canvas: { width: 1080, height: 1920 }, style, video: { src: "/x/clean.mp4", duration: 24, hasAudio: true }, captions: groups, hook: pickHook(sample), zooms: [{ t: 3, scale: 1.14, snap: 0.12 }], audio: { tracks: [] } },
    "assets/footage.mp4",
  );
  assert.match(html, /data-composition-id="reel"/);
  assert.match(html, /window\.__timelines\["reel"\]/);
  assert.match(html, /@font-face \{ font-family: "Anton"/);
  assert.match(html, /data-has-audio="true"/);
  assert.doesNotMatch(html, /crossorigin/);
  assert.equal((html.match(/class="cap"/g) || []).length, groups.length);
});

test("pickCta sits in the last seconds by default and is clamped to the clip", () => {
  const c = pickCta(14.6, { text: "Comment GHOST", last: 3 });
  assert.deepEqual(c, { text: "COMMENT GHOST", start: 11.6, duration: 3, style: "pill", position: 0.62 });
  const d = pickCta(14.6, { text: "Comment GHOST", start: 13.5, duration: 4 });
  assert.equal(d.start + d.duration, 14.6);
  assert.equal(pickCta(10, {}), null);
});

test("renderHTML renders the CTA pill and hook styles", () => {
  const style = JSON.parse(readFileSync(new URL("../presets/_defaults.json", import.meta.url)));
  const base = { name: "t", canvas: { width: 1080, height: 1920 }, video: { src: "/x/clean.mp4", duration: 14.6, hasAudio: true }, captions: [], zooms: [], audio: { tracks: [] } };
  const html = renderHTML({ ...base, style, hook: pickHook(sample), cta: pickCta(14.6, { text: "Comment GHOST" }) }, "assets/footage.mp4");
  assert.match(html, /id="cta" class="clip" data-start="11.6" data-duration="3"/);
  assert.match(html, /COMMENT GHOST/);
  assert.match(html, /border-radius: 10em/);
  const outline = renderHTML({ ...base, style: { ...style, hook: { ...style.hook, style: "outline" } }, hook: pickHook(sample), cta: null }, "assets/footage.mp4");
  assert.match(outline, /color: #FFFFFF; text-align: center;/);
  assert.doesNotMatch(outline, /id="cta"/);
  const box = renderHTML({ ...base, style: { ...style, hook: { ...style.hook, style: "box" } }, hook: pickHook(sample), cta: null }, "assets/footage.mp4");
  assert.match(box, /background: rgba\(11, 11, 13, 0.86\)/);
});

test("the hook plaque uses brand tokens and the footage keyword guard removes colour markers", () => {
  const style = JSON.parse(readFileSync(new URL("../presets/_defaults.json", import.meta.url)));
  style.colors = { ...style.colors, text: "#E1E2E3", bg: "#121314", accent: "#A1B2C3" };
  style.hook = { ...style.hook, plaque: true };
  style.captions = { ...style.captions, quiet: true, annotate: true, keywordColorOnFootage: false };
  const hook = { text: "Own the number", words: [{ text: "Own" }, { text: "the" }, { text: "number", key: true }], start: 0, duration: 2 };
  const captions = [{ text: "Own the number", start: 2, end: 3, words: hook.words }];
  const html = renderHTML({ name: "plaque", canvas: { width: 1080, height: 1920 }, style, video: { duration: 4, hasAudio: false }, hook, captions, zooms: [], audio: { tracks: [] } }, "assets/footage.mp4");
  assert.match(html, /hook-plaque/);
  assert.match(html, /background: #121314; background-image: none; border: 0; border-left: 6px solid #A1B2C3/);
  assert.match(html, /\.cap \.w\.k \{ color: inherit; background: none; padding: 0; border-radius: 0; font-weight: 950; font-size: 1\.06em;/);
  assert.doesNotMatch(html, /<svg class="an /);
  assert.match(html, /#hook\.hook-plaque #hook-block \{ left: 7%; right: 7%; text-align: center; \}/, "centred unless the plan puts it beside the head");
  const wide = renderHTML({ name: "plaque", canvas: { width: 1920, height: 1080 }, style: { ...style, hook: { ...style.hook, side: { left: 0.601, right: 0.05 } } }, video: { duration: 4, hasAudio: false }, hook, captions, zooms: [], audio: { tracks: [] } }, "assets/footage.mp4");
  assert.match(wide, /#hook\.hook-plaque #hook-block \{ left: 60\.1%; right: 5%; text-align: left; \}/);
  const guarded = (st) => renderHTML({ name: "plaque", canvas: { width: 1920, height: 1080 }, style: st, video: { duration: 4, hasAudio: false }, hook: { ...hook, headTop: 0.085, headBottom: 0.534 }, captions, zooms: [], audio: { tracks: [] } }, "assets/footage.mp4");
  assert.match(guarded(style), /"headTop":0\.085/, "a centred plaque keeps the runtime guard that lifts it off the head");
  assert.doesNotMatch(guarded({ ...style, hook: { ...style.hook, side: { left: 0.601, right: 0.05 } } }), /"headTop"/, "beside the head, the guard would only push it up and shrink it");
  assert.match(guarded({ ...style, hook: { ...style.hook, side: { left: 0.601, right: 0.05 } } }), /"side":true/, "the box is shrunk to its longest line at render time");
  assert.doesNotMatch(guarded(style), /"side":true/);
});

test("caption lines keep phrases whole: no line made of glue words, none ending on one", async () => {
  const { tidyLines, groupWords } = await import("../src/captions.mjs");
  const w = (s) => s.split(" ").map((t, i) => ({ text: t, start: i, end: i + 0.5 }));
  const lines = groupWords(w("a bad number or a bad month here is why you can breathe lower your voice"), 100, { wordsPerLine: 3 }).map((g) => g.text);
  for (const l of lines) {
    assert.doesNotMatch(l, /\b(or|a|the|of|to|and|your)$/, `line ends on glue: "${l}"`);
    assert.notEqual(l, "or a");
  }
  assert.ok(lines.every((l) => l.split(" ").length <= 5));
  assert.deepEqual(tidyLines([[{ text: "or" }, { text: "a" }], [{ text: "bad" }, { text: "month" }]]).map((l) => l.map((x) => x.text).join(" ")), ["or a bad month"]);
});

test("minShow: a line that would flash joins the next one; off by default", async () => {
  const { groupWords } = await import("../src/captions.mjs");
  const words = [{ text: "you", start: 0, end: 0.08 }, { text: "it", start: 0.1, end: 0.18 }, { text: "works", start: 0.2, end: 0.5 }, { text: "every", start: 0.6, end: 0.9 }, { text: "time.", start: 0.95, end: 1.3 }];
  const off = groupWords(words, 2, { wordsPerLine: 2 });
  const on = groupWords(words, 2, { wordsPerLine: 2, minShow: 0.3 });
  assert.ok(on.length < off.length, `${off.map((g) => g.text).join(" | ")} vs ${on.map((g) => g.text).join(" | ")}`);
  for (let i = 0; i + 1 < on.length; i++) assert.ok(on[i + 1].start - on[i].start >= 0.25 || on[i].words.length >= 3);
});

test("design v2: dimFuture false shows the whole phrase and swaps it; the default still dims unspoken words", () => {
  const groups = markKeywords(groupWords(sample, 24), dict);
  const base = JSON.parse(readFileSync(new URL("../presets/_defaults.json", import.meta.url)));
  const plan = (captions) => ({ name: "t", canvas: { width: 1080, height: 1920 }, style: { ...base, captions: { ...base.captions, ...captions } }, video: { src: "/x/clean.mp4", duration: 24, hasAudio: true }, captions: groups, hook: pickHook(sample), zooms: [], audio: { tracks: [] } });
  const dim = renderHTML(plan({ style: "reveal" }), "assets/footage.mp4");
  assert.match(dim, /\.cap \.w \{ opacity: 0\.38; \}/);
  assert.match(dim, /"capDim":true/);
  const whole = renderHTML(plan({ style: "reveal", dimFuture: false, animation: "cut" }), "assets/footage.mp4");
  assert.doesNotMatch(whole, /\.cap \.w \{ opacity: 0\.38; \}/, "no dimmed future words");
  assert.match(whole, /"capDim":false/);
  assert.match(whole, /"capCut":true/, "a hard swap, no entrance animation");
});

test("the hook never covers the head: a measured head top reaches the page, the text-behind-you hook is left alone", () => {
  const groups = markKeywords(groupWords(sample, 24), dict);
  const style = JSON.parse(readFileSync(new URL("../presets/_defaults.json", import.meta.url)));
  const hook = { ...pickHook(sample), headTop: 0.272, headBottom: 0.492 };
  const html = renderHTML({ name: "t", canvas: { width: 1080, height: 1920 }, style, video: { src: "/x/clean.mp4", duration: 24, hasAudio: true }, captions: groups, hook, zooms: [], audio: { tracks: [] } }, "assets/footage.mp4");
  assert.match(html, /"headTop":0\.272,"headBottom":0\.492/);
  assert.match(html, /Number\.isFinite\(PLAN\.hook\.headTop\)/);
  const plain = renderHTML({ name: "t", canvas: { width: 1080, height: 1920 }, style, video: { src: "/x/clean.mp4", duration: 24, hasAudio: true }, captions: groups, hook: pickHook(sample), zooms: [], audio: { tracks: [] } }, "assets/footage.mp4");
  assert.doesNotMatch(plain, /"headTop"/, "no measurement, nothing moves");
});

test("pingel-v2 builds on pingel-brand: same colours and b-roll world, plus the opt-in house system", async () => {
  // Greg 2026-10-30: pingel-v2 text direction is his default
  const { loadPreset } = await import("../src/presets.mjs");
  const v2 = loadPreset("pingel-v2"), brand = loadPreset("pingel-brand");
  assert.deepEqual(v2.colors, brand.colors);
  assert.equal(v2.broll.world, brand.broll.world);
  assert.equal(v2.captions.uppercase, false);
  assert.equal(v2.captions.position, 0.65);
  assert.equal(v2.captions.dimFuture, false);
  assert.equal(v2.hook.behind, false);
  assert.equal(v2.framing.enabled, true);
  assert.equal(v2.zooms.cadence.enabled, false);
  assert.equal(v2.coldOpen.enabled, false);
  assert.equal(v2.brand.signature.kind, "edge-rule");
  assert.deepEqual(v2.brand.houseLooks, ["gregcard", "press", "receipts"]);
  assert.deepEqual(v2.brand.modes, { authority: "gregcard", editorial: "press", proof: "receipts" });
  assert.equal(brand.brand.signature.kind, "none");
  assert.deepEqual(brand.brand.houseLooks, []);
  assert.equal(brand.captions.uppercase, true);
  assert.equal(brand.captions.autoKeywords, true);
  assert.equal(brand.captions.keywordColorOnFootage, undefined);
  assert.equal(brand.hook.behind, false);
  assert.equal(brand.hook.plaque, true);
  assert.deepEqual(brand.looks, { lockHook: true, lockCaptions: true, lockBrollGrade: true });
  assert.equal(brand.cover.style, "archetypes");
  assert.equal(brand.finish.enabled, true);
});
