import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildPrompt, parseReply, formatCaptionFile, formatPostText, cleanCaption, voiceFile, findAsks, oneAsk } from "../scripts/write-caption.mjs";

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

test("Greg's prompt requests one recipient specific send line from this reel, or only the configured DM offer", () => {
  for (const sandcastles of [true, false]) {
    const options = { transcript: "I still approve every discount.", hook: "Discounts", voice: "Greg", greg: true, sandcastles };
    const send = buildPrompt(options);
    assert.match(send, /ONE line.*specific person they can picture.*THIS reel says/);
    assert.match(send, /Send this to the owner who still approves every discount\./);
    assert.match(send, /Do not reuse that recipient for an unrelated reel/);
    assert.match(send, /No other save, send, share, comment, DM, follow or link asks/);
    assert.match(send, /Never use AI as the ask or keyword/);
    assert.doesNotMatch(send, /No call to action of any kind/);
    const dm = buildPrompt({ ...options, cta: "DM me DISCOUNT" });
    assert.match(dm, /ONE DM offer.*DM me DISCOUNT/);
    assert.match(dm, /only ask\. No send line/);
    assert.doesNotMatch(dm, /Send this to the owner/);
  }
});

test("findAsks detects engagement instructions, including mixed case, without treating ordinary verbs or AI as asks", () => {
  const cases = [
    ["Save this for later.", ["save"]],
    ["Send this reel to the owner who approves every discount.", ["send"]],
    ["Share this with your setter.", ["share"]],
    ["COMMENT READY below.", ["comment"]],
    ["Leave a comment below.", ["comment"]],
    ["Want the exact words? DM me DISCOUNT and I'll send it.", ["dm"]],
    ["Send me a DM for the exact words.", ["dm"]],
    ["Follow @example for more.", ["follow"]],
    ["Tap the link in bio.", ["link"]],
    ["Save and share this. Then comment READY.", ["save", "share", "comment"]],
    ["Save this. Save the reel.", ["save", "save"]],
    ["Don't forget to save this. Send to the owner who approves every discount.", ["save", "send"]],
    ["AI", []],
    ["AI can save money. I send a proposal and follow the process.", []],
    ["I share responsibility. A comment from the buyer changed the call. The DM offer works.", []],
    ["I'll send it when the owner approves the discount.", []],
  ];
  for (const [line, expected] of cases) assert.deepEqual(findAsks(line), expected, line);
});

test("oneAsk keeps the final ask line and moves it to the caption ending, preserving the specific recipient", () => {
  const send = "Send this to the owner who still approves every discount.";
  assert.equal(oneAsk(`Save this.\nDiscounts need a limit.\nComment READY.\n${send}`), `Discounts need a limit.\n${send}`);
  assert.equal(oneAsk(`${send}\nDiscounts need a limit.\n\n#a #b #c`), `Discounts need a limit.\n\n${send}\n#a #b #c`);
  assert.equal(oneAsk(`Discounts need a limit.\n${send}`), `Discounts need a limit.\n${send}`);
  assert.equal(oneAsk("Discounts need a limit."), "Discounts need a limit.");
  assert.equal(oneAsk("Discounts need a limit.\nSave this and share this."), "Discounts need a limit.");
  assert.equal(oneAsk("Discounts need a limit.\nSave this. Save the reel."), "Discounts need a limit.");
  assert.equal(oneAsk("Discounts need a limit.\nSave this — send this to the owner."), "Discounts need a limit.");
});

test("a CTA keeps only the DM offer, never a send line or AI keyword, and clients bypass the guard", () => {
  const dm = "Want the exact words? DM me DISCOUNT and I'll send them.";
  const caption = `Save this.\n${dm}\nSend this to the owner who approves discounts.`;
  assert.equal(oneAsk(caption, { cta: "DM me DISCOUNT" }), dm);
  assert.equal(oneAsk(caption, { greg: false }), caption);
  assert.equal(oneAsk("AI changes the work.\nComment AI.\nDM me 'AI'.\nSend me AI.\nSend this to AI."), "AI changes the work.");
  assert.equal(oneAsk("Want the exact words? DM me AI.", { cta: "DM me AI" }), "");
});

test("the caption command guards only Greg, logs a missing send line, and updates the sidecar with the final text", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-caption-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = path.join(dir, "fake-claude.mjs");
  fs.writeFileSync(fake, '#!/usr/bin/env node\nimport fs from "node:fs";\nfs.writeFileSync(process.env.REEL_TEST_PROMPT, process.argv[3]);\nconsole.log(process.env.REEL_TEST_REPLY);\n', { mode: 0o755 });
  const send = "Send this to the owner who still approves every discount.";
  const dm = "Want the exact words? DM me DISCOUNT and I'll send them.";
  const cases = [
    { name: "greg", input: `Yo, discounts need a limit — set one.\nSave this.\n${send}`, expected: `Discounts need a limit, set one.\n${send}`, asks: ["send"] },
    { name: "offer", input: `Save this.\n${dm}\n${send}`, expected: dm, asks: ["dm"], env: { REEL_WATCH_CTA: "DM me DISCOUNT" } },
    { name: "missing", input: "Discounts need a limit.", expected: "Discounts need a limit.", asks: [], missing: true },
    { name: "ai", input: "Discounts need a limit.\nComment AI.\nThe Ghost P&L knows.\nDM me AI.", expected: "Discounts need a limit.", asks: [], missing: true },
    { name: "client", input: `Save this.\n${send}`, expected: `Save this.\n${send}`, asks: ["save", "send"], env: { REEL_CLIENT: "example" }, neutral: true },
    { name: "voice", input: `Save this.\n${send}`, expected: `Save this.\n${send}`, asks: ["save", "send"], env: { REEL_CAPTION_VOICE: new URL("../voice/default.md", import.meta.url).pathname }, neutral: true },
  ];
  for (const c of cases) {
    const work = path.join(dir, c.name);
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, "plan.json"), JSON.stringify({ style: { name: "pingel-brand" }, captions: [{ text: "Discounts need a limit." }] }));
    fs.writeFileSync(path.join(work, "analytics-features.json"), JSON.stringify({ performance: { shares: 2 }, record: { sourceDuration: 20 } }));
    const promptFile = path.join(work, "prompt.txt");
    const run = spawnSync(process.execPath, [new URL("../scripts/write-caption.mjs", import.meta.url).pathname, work], {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, REEL_CLIENT_MODE: "0", REEL_CLIENT: "", REEL_CAPTION_VOICE: "", REEL_WATCH_CTA: "", REEL_CAPTION_SANDCASTLES: "0",
        ...c.env, REEL_CLAUDE_BIN: fake, REEL_TEST_PROMPT: promptFile,
        REEL_TEST_REPLY: JSON.stringify({ caption: c.input, hashtags: ["#a", "#b", "#c"], hooks: [{ text: "Discounts need a limit" }] }) },
    });
    assert.equal(run.status, 0, `${c.name}: ${run.stderr}`);
    assert.equal(fs.readFileSync(path.join(work, "caption.txt"), "utf8"), `${c.expected}\n\n#a #b #c\n`, c.name);
    const features = JSON.parse(fs.readFileSync(path.join(work, "analytics-features.json"), "utf8"));
    assert.equal(features.record.captionEnding, c.expected.split("\n").at(-1), c.name);
    assert.deepEqual(features.record.captionAsks, c.asks, c.name);
    assert.equal(features.record.sourceDuration, 20);
    assert.deepEqual(features.performance, { shares: 2 });
    assert.equal(run.stdout.includes("caption: no send line"), !!c.missing, c.name);
    const prompt = fs.readFileSync(promptFile, "utf8");
    if (c.neutral) {
      assert.match(prompt, /No call to action of any kind/);
      assert.doesNotMatch(prompt, /ONE line asking/);
    } else assert.match(prompt, /ONE (?:line asking|DM offer)/);
  }
});
