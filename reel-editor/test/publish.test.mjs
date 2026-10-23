import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCaption, postText, readItem, scan, fileItem, pickSlot } from "../src/publish-folder.mjs";

const CAPTION_TXT = `HOOK
Post copy from what is winning on Sandcastles (2026-10-22).

CAPTION
Your business can only go as fast as your weakest link.
Figure out your biggest constraint and only focus on that.

HASHTAGS
#businessowner #scalingabusiness #smallbusiness

HOOK TEXT (on screen, first 3 seconds) - pick one
1. I paid Hormozi a ton for this

NO CTA.
`;

test("caption: the CAPTION and HASHTAGS sections of the editor's caption.txt, or a plain file as it is", () => {
  const c = parseCaption(CAPTION_TXT);
  assert.equal(c.caption, "Your business can only go as fast as your weakest link.\nFigure out your biggest constraint and only focus on that.");
  assert.deepEqual(c.hashtags, ["#businessowner", "#scalingabusiness", "#smallbusiness"]);
  assert.equal(postText(c), `${c.caption}\n\n#businessowner #scalingabusiness #smallbusiness`);
  assert.equal(parseCaption("Own the number.\n\nThen fix it. #sales").caption, "Own the number.\n\nThen fix it. #sales");
  assert.equal(parseCaption("").source, "none");
});

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "reel-publish-")); }
const old = (f) => { const t = new Date(Date.now() - 3600e3); fs.utimesSync(f, t, t); };

test("items: a reel folder, a loose video with its caption, the check-note gate, and a file still copying", () => {
  const root = tmp();
  const a = path.join(root, "2026-10-22 Reel 8 with Runway");
  fs.mkdirSync(a);
  for (const f of ["I paid Hormozi.mp4", "B-roll 1.mp4"]) { fs.writeFileSync(path.join(a, f), "x"); old(path.join(a, f)); }
  fs.writeFileSync(path.join(a, "caption.txt"), CAPTION_TXT);
  const ia = readItem(path.basename(a), { root });
  assert.equal(path.basename(ia.video), "I paid Hormozi.mp4", "the reel, not a b-roll clip");
  assert.equal(ia.isAiGenerated, true, "b-roll files mean the AI label");
  assert.equal(ia.draft, false);
  fs.writeFileSync(path.join(a, "check this reel.txt"), "Preflight: FAILED\n\nFAIL  loudness -20 LUFS\n");
  assert.equal(readItem(path.basename(a), { root }).draft, true, "a failed check posts as a draft");
  fs.writeFileSync(path.join(a, "check this reel.txt"), "Preflight: check these\n\nwarn  Claude saw at 0:01 (collision): caption on the shirt\n");
  fs.writeFileSync(path.join(a, ".reel.json"), JSON.stringify({ isAiGenerated: true, preflight: "warn", obvious: "caption on the shirt" }));
  const noted = readItem(path.basename(a), { root });
  assert.equal(noted.draft, false, "a reviewer note alone does not hold a dropped reel back");
  assert.deepEqual(noted.notes, ["caption on the shirt"]);
  fs.writeFileSync(path.join(root, "quick.mp4"), "x"); old(path.join(root, "quick.mp4"));
  fs.writeFileSync(path.join(root, "quick.txt"), "Plain caption.");
  const ib = readItem("quick.mp4", { root });
  assert.equal(ib.text, "Plain caption.");
  assert.equal(ib.isAiGenerated, false);
  fs.writeFileSync(path.join(root, "copying.mp4"), "x");
  assert.equal(readItem("copying.mp4", { root }).waiting, true);
  assert.equal(readItem("nocap.mp4", { root }), null);
  fs.writeFileSync(path.join(root, "nocap.mp4"), "x"); old(path.join(root, "nocap.mp4"));
  assert.equal(readItem("nocap.mp4", { root }).draft, true, "no caption: a draft, never a captionless post");
  assert.ok(scan({ root }).length >= 4);
});

test("filing: a reel folder moves to Scheduled with a receipt; one clip leaves a Clips folder, the rest wait", () => {
  const root = tmp();
  const a = path.join(root, "Reel 1");
  fs.mkdirSync(a);
  fs.writeFileSync(path.join(a, "r.mp4"), "x"); old(path.join(a, "r.mp4"));
  fs.writeFileSync(path.join(a, "caption.txt"), "Cap.");
  const dest = fileItem(readItem("Reel 1", { root }), { status: "scheduled", receipt: "ok" });
  assert.ok(fs.existsSync(path.join(dest, "Scheduled.txt")) && !fs.existsSync(a));
  const c = path.join(root, "2026-10-22 Clips 1");
  fs.mkdirSync(c);
  for (const k of [1, 2]) {
    fs.writeFileSync(path.join(c, `Clip ${k} - hook ${k}.mp4`), "x"); old(path.join(c, `Clip ${k} - hook ${k}.mp4`));
    fs.writeFileSync(path.join(c, `Clip ${k} - caption.txt`), `Caption ${k}.`);
  }
  const first = readItem("2026-10-22 Clips 1", { root });
  assert.equal(first.text, "Caption 1.");
  fileItem(first, { status: "scheduled", receipt: "ok" });
  const second = readItem("2026-10-22 Clips 1", { root });
  assert.equal(second.text, "Caption 2.", "clip 2 is next");
  fileItem(second, { status: "failed", receipt: "no" });
  assert.ok(fs.existsSync(path.join(root, "Not posted")));
});

test("slot: one reel a day, today only with two hours to spare, best hour first", () => {
  const now = new Date("2026-10-22T17:30:00-07:00");
  assert.deepEqual(pickSlot({ now, bestByDay: { "2026-10-22": [18, 20], "2026-10-23": [9] } }), { day: "2026-10-22", hour: 20 });
  assert.deepEqual(pickSlot({ now, taken: ["2026-10-22"], bestByDay: { "2026-10-23": [9, 12] } }), { day: "2026-10-23", hour: 9 });
  assert.deepEqual(pickSlot({ now, taken: ["2026-10-22", "2026-10-23"] }), { day: "2026-10-24", hour: 18 });
  // Never within two hours of another post that day: the 10 AM carousel pushes the reel to noon.
  assert.deepEqual(pickSlot({ now, taken: ["2026-10-22"], bestByDay: { "2026-10-23": [10, 11, 12] }, busy: { "2026-10-23": [10, 18] } }), { day: "2026-10-23", hour: 12 });
  // No best hour is clear: the clear hour nearest the best one.
  assert.deepEqual(pickSlot({ now, taken: ["2026-10-22"], bestByDay: { "2026-10-23": [10, 11] }, busy: { "2026-10-23": [9, 11, 18] } }), { day: "2026-10-23", hour: 13 });
});

test("a clip dragged in on its own takes its caption from the delivered Clips folder it came from", () => {
  const desk = tmp(), root = tmp();
  const clips = path.join(desk, "2026-10-22 Clips 2");
  fs.mkdirSync(clips);
  fs.writeFileSync(path.join(clips, "Clip 3 - Then we talk.mp4"), "video-bytes");
  fs.writeFileSync(path.join(clips, "Clip 3 - caption.txt"), "CAPTION\nThen we talk.\n\nHASHTAGS\n#sales\n");
  fs.writeFileSync(path.join(root, "Clip 3 - Then we talk.mp4"), "video-bytes"); old(path.join(root, "Clip 3 - Then we talk.mp4"));
  const it = readItem("Clip 3 - Then we talk.mp4", { root, sourceRoots: [desk] });
  assert.equal(it.text, "Then we talk.\n\n#sales");
  assert.equal(it.draft, false);
  fs.writeFileSync(path.join(root, "Other.mp4"), "different"); old(path.join(root, "Other.mp4"));
  assert.equal(readItem("Other.mp4", { root, sourceRoots: [desk] }).why, "there is no caption");
});
