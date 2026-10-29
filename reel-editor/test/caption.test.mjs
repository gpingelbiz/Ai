import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseReply, formatCaptionFile, formatPostText, cleanCaption, voiceFile } from "../scripts/write-caption.mjs";

test("the caption prompt carries the voice, the hook, the transcript and the CTA rule", () => {
  const none = buildPrompt({ transcript: "Own it first.", hook: "The 10 minutes after a bad number", voice: "Raw accountability.", cta: "" });
  assert.match(none, /No call to action of any kind/);
  assert.match(none, /Raw accountability\./);
  assert.match(none, /Hook in the reel: The 10 minutes after a bad number/);
  assert.match(none, /Own it first\./);
  assert.match(none, /never present those words as the speaker's own/);
  const withCta = buildPrompt({ transcript: "x", hook: "", voice: "v", cta: "Comment GHOST" });
  assert.match(withCta, /offer built around this call to action: Comment GHOST/);
  assert.match(withCta, /never as a bare instruction/);
  assert.doesNotMatch(withCta, /No call to action/);
});

test("parseReply finds the JSON, caps hashtags at 3 and adds missing #", () => {
  const j = parseReply('Sure:\n{"caption":"Line one\\nLine two","hashtags":["leadership","#salesteam","#a","#b"],"hooks":[{"text":"A"},{"text":"B"},{"text":"C"},{"text":"D"}],"trend":"t"}');
  assert.deepEqual(j.hashtags, ["#leadership", "#salesteam", "#a"]);
  assert.equal(j.hooks.length, 3);
  assert.throws(() => parseReply("no json here"));
  assert.throws(() => parseReply('{"caption":"x"}'));
});

test("post notes.txt (work folder) keeps the caption, hashtags and hook options in the hand-written format", () => {
  const txt = formatCaptionFile({ caption: "One.\nTwo.", hashtags: ["#a", "#b", "#c"], hooks: [{ text: "Hook one", pattern: "the hook in the reel" }, { text: "Hook two", pattern: "contrarian", example: "@x, 2.4M views, 153x" }], trend: "Contrarian wins." }, { title: "Hook one", cta: "", date: "2026-10-21" });
  assert.match(txt, /^HOOK ONE\n/);
  assert.match(txt, /CAPTION\nOne\.\nTwo\./);
  assert.match(txt, /HASHTAGS\n#a #b #c/);
  assert.match(txt, /2\. Hook two\n {3}\(contrarian; @x, 2\.4M views, 153x\)/);
  assert.match(txt, /NO CTA\.\n$/);
});

test("Greg's voice for his brand preset, a neutral one otherwise, REEL_CAPTION_VOICE wins", () => {
  assert.match(voiceFile({ style: { name: "pingel-brand" } }, {}), /voice\/greg\.md$/);
  assert.match(voiceFile({ style: { name: "my-brand" } }, {}), /voice\/default\.md$/);
  const own = new URL("../voice/default.md", import.meta.url).pathname;
  assert.equal(voiceFile({ style: { name: "pingel-brand" } }, { REEL_CAPTION_VOICE: own }), own);
});

test("the caption is written from the transcript, in the speaker's language, with plain punctuation", () => {
  const p = buildPrompt({ transcript: "Ihr müsst täglich investieren.", hook: "90% der Paare", voice: "v", cta: "" });
  assert.match(p, /Write the caption from the transcript alone/);
  assert.match(p, /the reel's main point first, then its key points in the order the speaker makes them/);
  assert.match(p, /in the language the speaker speaks/);
  assert.match(p, /address the viewer the way they do/);
  assert.match(p, /No dashes of any kind/);
  assert.match(p, /They shape the hook options only/);
});

test("caption.txt is the post as it goes up: caption lines, a blank line, the hashtags, nothing else", () => {
  assert.equal(formatPostText({ caption: "Own it first.\n\nDo the reps.", hashtags: ["#a", "#b", "#c"], hooks: [{ text: "x" }] }), "Own it first.\nDo the reps.\n\n#a #b #c\n");
  assert.equal(formatPostText({ caption: "Only this.", hashtags: [] }), "Only this.\n");
});

test("cleanCaption: no dashes, semicolons or ellipses for anyone; hyphenated words stay", () => {
  assert.equal(cleanCaption("Ihr müsst täglich in sie investieren \u2013 wie bei eurem Auto."), "Ihr müsst täglich in sie investieren, wie bei eurem Auto.");
  assert.equal(cleanCaption("Own it first\u2014nobody is coming.\nThe 9-to-5 is a choice - not a sentence."), "Own it first, nobody is coming.\nThe 9-to-5 is a choice, not a sentence.");
  assert.equal(cleanCaption("Wait\u2026 what?\nDo the reps; the rest follows...\n- one-on-one calls"), "Wait. What?\nDo the reps. The rest follows.\nOne-on-one calls");
  assert.equal(cleanCaption("Yo is fine for a client."), "Yo is fine for a client.");
});

test("cleanCaption for Greg: no Yo opener, and a line the Publish folder would hold back is dropped", () => {
  assert.equal(cleanCaption("Yo, listen up.\nThe Ghost P&L shows the leak.\nComment GHOST below.\nMy wife said it first.\nOwn it.", { greg: true }), "Listen up.\nOwn it.");
});
