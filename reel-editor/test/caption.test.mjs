import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseReply, formatCaptionFile, voiceFile } from "../scripts/write-caption.mjs";

test("the caption prompt carries the voice, the hook, the transcript and the CTA rule", () => {
  const none = buildPrompt({ transcript: "Own it first.", hook: "The 10 minutes after a bad number", voice: "Raw accountability.", cta: "" });
  assert.match(none, /No call to action of any kind/);
  assert.match(none, /Raw accountability\./);
  assert.match(none, /Hook in the reel: The 10 minutes after a bad number/);
  assert.match(none, /Own it first\./);
  assert.match(none, /never present those words as the speaker's own/);
  const withCta = buildPrompt({ transcript: "x", hook: "", voice: "v", cta: "Comment GHOST" });
  assert.match(withCta, /word for word: Comment GHOST/);
  assert.doesNotMatch(withCta, /No call to action/);
});

test("parseReply finds the JSON, caps hashtags at 3 and adds missing #", () => {
  const j = parseReply('Sure:\n{"caption":"Line one\\nLine two","hashtags":["leadership","#salesteam","#a","#b"],"hooks":[{"text":"A"},{"text":"B"},{"text":"C"},{"text":"D"}],"trend":"t"}');
  assert.deepEqual(j.hashtags, ["#leadership", "#salesteam", "#a"]);
  assert.equal(j.hooks.length, 3);
  assert.throws(() => parseReply("no json here"));
  assert.throws(() => parseReply('{"caption":"x"}'));
});

test("the caption file matches the hand-written format", () => {
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
