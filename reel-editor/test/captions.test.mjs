import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupWords, markKeywords, cleanText } from "../src/captions.mjs";
import { applyCorrections } from "../src/transcribe.mjs";
import { pickHook, pickCta } from "../src/hook.mjs";
import { planZooms } from "../src/zooms.mjs";
import { renderHTML } from "../src/compose.mjs";

const sample = JSON.parse(readFileSync(new URL("../examples/sample-words.json", import.meta.url))).words;
const dict = JSON.parse(readFileSync(new URL("../dictionary.json", import.meta.url)));

test("dictionary corrections merge split framework names and keep punctuation", () => {
  const w = applyCorrections(sample, dict.corrections);
  const i = w.findIndex((x) => x.text === "Ghost");
  assert.ok(i > 0);
  assert.equal(w[i + 1].text, "P&L");
  assert.equal(w[i + 2].text, "problem.");
  assert.equal(w[i].start, 2.75);
  assert.equal(w[i + 1].end, 3.55);
});

test("groupWords makes 3-word lines, breaks on sentence end and pauses, never overlaps", () => {
  const groups = groupWords(sample, 24, { wordsPerLine: 3 });
  assert.ok(groups.every((g) => g.words.length <= 3));
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i].start >= groups[i - 1].end);
  assert.equal(groups[0].text, "Most coaches don't");
  assert.ok(groups.some((g) => g.text === "sales problem"), "trailing period stripped and sentence ends the line");
});

test("markKeywords prefers dictionary terms, then numbers and power words", () => {
  const groups = markKeywords(groupWords(applyCorrections(sample, dict.corrections), 24), dict);
  const keyed = groups.map((g) => g.words.filter((w) => w.key).map((w) => w.text).join(" ")).filter(Boolean);
  assert.ok(keyed.includes("sales"));
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

test("planZooms alternates in/out and respects the interval", () => {
  const groups = groupWords(sample, 24);
  const z = planZooms(groups, 24, { interval: 4, scales: [1.14, 1.22] });
  assert.ok(z.length >= 2);
  assert.ok(z[0].scale > 1 && z[1].scale === 1);
  for (let i = 1; i < z.length; i++) assert.ok(z[i].t - z[i - 1].t >= 4 * 0.8 - 0.001);
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
