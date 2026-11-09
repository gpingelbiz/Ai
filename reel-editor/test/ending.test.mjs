import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { endingReport, findSignOff, planCuts, remapWords, guardSilenceCuts, snapSegments } from "../src/cuts.mjs";
import { openingReport, openingEndingChecks, timelineToSource, endAfterPhrase, resolveEndingOverride, endingMetadata } from "../src/ending.mjs";
import { runPreflight, preflightText, writePreflight } from "../src/preflight.mjs";

const line = (text, start, step = 0.3) => text.split(" ").map((text, i) => ({ text, start: +(start + i * step).toFixed(3), end: +(start + i * step + step * 0.8).toFixed(3) }));
const point = line("Price the work.", 0);
const farewell = [...point, ...line("Have a great day. I just wanted you to have a great day.", 1.5)];
// Negative fixture: a single ask remains the final point, even with a phrase from the closer list.
const cta = [...point, ...line("DM me and I'll send you the script.", 1.5)];
const settings = { silence: "off", badTakes: false, fillers: false };

test("endingReport finds a farewell and leaves its input untouched", () => {
  const before = structuredClone(farewell);
  const report = endingReport(farewell, 6);
  assert.equal(report.lastPointEnd, point.at(-1).end);
  assert.equal(report.tailStart, 1.5);
  assert.match(report.tailText, /^Have a great day/);
  assert.equal(report.reason, "conversational tail");
  assert.deepEqual(farewell, before);
  assert.equal(endingReport(point, 1), null);
  assert.equal(endingReport([], 10), null);
  assert.equal(endingReport(point, NaN), null);
});

test("existing sign offs and added conversational phrases share the detector", () => {
  for (const phrase of ["thanks for watching", "thank you for watching", "link in bio", "talk soon", "see you", "anyway", "that's it", "good morning", "hey folks", "hi everyone", "goodbye", "what's next on my plate", "what should i do next", "what do i need to do next"]) {
    const words = [...point, ...line(`${phrase}.`, 2)];
    assert.equal(findSignOff(words, words.at(-1).end + 0.2), point.length, phrase);
    assert.ok(endingReport(words, words.at(-1).end + 0.2), phrase);
    assert.equal(findSignOff(words, 60), -1, `mid reel: ${phrase}`);
  }
  const followedByAdvice = [...point, ...line("Have a great day.", 1), ...line("Now price the work.", 2.5)];
  assert.equal(endingReport(followedByAdvice, 4), null);
  assert.ok(planCuts(followedByAdvice, 4, settings).words.every((w) => !w.drop));
  assert.equal(findSignOff([...line('Say "have a great day" to the buyer.', 0), ...line("Then price the work.", 3)], 5), -1);
});

test("a single intentional CTA is never conversational tail or removed", () => {
  for (const words of [cta, [...farewell, ...line("DM me for the script.", 6.2)], [...point, ...line("Send this to the owner who needs it.", 1.5)], [...point, ...line("DM me and let me know.", 1.5)]]) {
    const duration = words.at(-1).end + 0.2;
    assert.equal(endingReport(words, duration), null);
    const cuts = planCuts(words, duration, settings);
    assert.ok(cuts.words.every((w) => !w.drop));
    assert.deepEqual(remapWords(cuts.words, cuts.segments).map((w) => w.text), words.map((w) => w.text));
  }
});

test("silence after a complete point is reported separately from a CTA", () => {
  const last = cta.at(-1).end;
  assert.equal(endingReport(cta, last + 1.5), null);
  assert.deepEqual(endingReport(cta, last + 2), { lastPointEnd: last, tailStart: last, tailSeconds: 2, tailText: "", reason: "silence or room tone after the last word" });
  assert.equal(endingReport(point, 30), null, "only diagnose the last ten seconds");
});

test("automatic tail cuts need no flag and signOff false preserves words", () => {
  const cuts = planCuts(farewell, 6, settings);
  assert.deepEqual(cuts.words.filter((w) => w.drop).map((w) => w.drop), farewell.slice(point.length).map(() => "sign-off"));
  assert.equal(remapWords(cuts.words, cuts.segments).at(-1).text, "work.");
  const untouched = planCuts(farewell, 6, { ...settings, signOff: false });
  assert.ok(untouched.words.every((w) => !w.drop));
  const briefGoodbye = [...point, ...line("Talk soon.", 1.1)];
  assert.ok(planCuts(briefGoodbye, 2, settings).words.slice(point.length).every((w) => w.drop === "sign-off"));
  const short = [...point, ...line("That's it.", 1.1)];
  assert.ok(planCuts(short, 2, settings).words.every((w) => !w.drop), "brief existing verbal punctuation stays");
});

test("source ending override preserves the word pad and removes matching captions", () => {
  const endAt = point.at(-1).end;
  const cuts = planCuts(farewell, 6, { ...settings, endAt, signOff: false });
  assert.equal(cuts.segments.at(-1).end, +(endAt + 0.12).toFixed(3));
  assert.ok(cuts.words.slice(point.length).every((w) => w.drop === "ending"));
  assert.deepEqual(remapWords(cuts.words, cuts.segments).map((w) => w.text), point.map((w) => w.text));
  assert.ok(cuts.removed.some((r) => r.reason === "ending" && r.end === 6));
  const insideWord = planCuts(farewell, 6, { ...settings, endAt: endAt - 0.05 });
  assert.ok(insideWord.segments.at(-1).end >= endAt + 0.1, "keep the full final consonant");
  for (const endAt of [NaN, -1, 0, 7, "1"]) assert.throws(() => planCuts(farewell, 6, { endAt }));
  assert.throws(() => planCuts(line("Hello.", 2), 6, { endAt: 1 }), /first word/);
});

test("an explicit selection can retain a CTA past an automatic closer", () => {
  const words = [...farewell, ...line("DM me for the script.", 6.2)];
  const endAt = words.at(-1).end;
  const cuts = planCuts(words, endAt + 1, { ...settings, endAt });
  assert.equal(remapWords(cuts.words, cuts.segments).at(-1).text, "script.");
  assert.ok(!cuts.words.some((w) => w.drop === "sign-off"));
});

test("the audio guard cannot restore an explicit ending or automatic room tone tail", () => {
  for (const cuts of [planCuts(farewell, 6, { ...settings, endAt: point.at(-1).end }), planCuts(point, 6, settings), planCuts(farewell, 6, settings)]) {
    const guarded = guardSilenceCuts(cuts, { step: 0.02, db: new Array(300).fill(-20) }, 6).cuts;
    assert.equal(guarded.segments.at(-1).end, cuts.segments.at(-1).end);
  }
});

test("opening reports first speech, greeting captions and literal hook coverage", () => {
  const words = line("Hey guys. Your price sets the standard.", 1.2);
  const plan = { captions: [{ text: "Hey guys" }], hook: { text: "Your price sets the standard" } };
  const report = openingReport(words, plan);
  assert.equal(report.firstWordStart, 1.2);
  assert.equal(report.firstCaptionText, "Hey guys");
  assert.deepEqual(report.findings.map((i) => i.code), ["opening-delay", "opening-filler"]);
  assert.equal(report.hookSpoken, true);
  assert.equal(openingReport([], {}).firstWordStart, null);
  assert.equal(openingReport([], {}).hookSpoken, null);
  const setup = openingReport(line("I wanted to tell you something.", 0.1), { hook: { text: "Price the work" } });
  assert.equal(setup.hookSpoken, false);
  assert.ok(setup.findings.some((i) => i.code === "opening-setup"));
  assert.ok(!openingReport(line("Price the work.", 1), {}).findings.some((i) => i.code === "opening-delay"));
  assert.equal(openingReport(line("Price", 4), { hook: { text: "Price" } }).hookSpoken, false);
  for (const text of ["so", "um", "what's up", "good morning", "okay so", "alright"]) assert.ok(openingReport(line(text, 0), { captions: [{ text }] }).findings.some((i) => i.code === "opening-filler"), text);
  assert.ok(!openingReport(line("Some owners", 0), {}).findings.length);
  assert.equal(openingReport([], { hook: { text: "Price the work" } }).hookSpoken, null);
  assert.ok(openingReport(line("Hey guys price the work.", 0), { captions: [{ text: "Hey" }] }).findings.some((i) => i.code === "opening-filler"));
  assert.deepEqual(openingReport(line("Price", 0), { hook: { text: "Price the work", words: [{ text: "Price", key: true }, { text: "work" }] } }).hookKeywords, ["price"]);
});

test("timeline seconds resolve through concatenated source segments, including joins", () => {
  const cuts = { segments: [{ start: 2, end: 4 }, { start: 8, end: 12 }] };
  assert.equal(timelineToSource(0, cuts), 2);
  assert.equal(timelineToSource(2, cuts), 4);
  assert.equal(timelineToSource(3, cuts), 9);
  assert.equal(timelineToSource(6, cuts), 12);
  for (const t of [NaN, -1, 7]) assert.throws(() => timelineToSource(t, cuts));
  assert.throws(() => timelineToSource(1, null), /saved cuts map/);
});

test("ending phrase matching uses its last complete occurrence and ignores punctuation", () => {
  const words = [...line("Be ready for it.", 0), ...line("But be ready for it!", 4)];
  assert.equal(endAfterPhrase(words, "BE READY FOR IT"), words.at(-1).end);
  assert.equal(endAfterPhrase(line("I'll send it.", 0), "I’ll send it"), 0.84);
  assert.equal(endAfterPhrase([{ text: "Ghost P&L", start: 0, end: 1 }], "ghost p&l"), 1);
  assert.throws(() => endAfterPhrase(words, "ready it"), /not found/);
  assert.throws(() => endAfterPhrase(words, "..."), /spoken words/);
  assert.equal(resolveEndingOverride({}, words), null);
  assert.equal(resolveEndingOverride({ endAfter: "ready for it" }, words), words.at(-1).end);
  assert.equal(resolveEndingOverride({ endAt: "1" }, words, { segments: [{ start: 3, end: 5 }] }), 4);
  assert.throws(() => resolveEndingOverride({ endAt: "", endAfter: "it" }, words), /one ending option/);
  assert.throws(() => resolveEndingOverride({ endAfter: "it", noCuts: true }, words), /requires cuts/);
  assert.throws(() => resolveEndingOverride({ endAt: "" }, words, { segments: [{ start: 0, end: 8 }] }));
});

test("sidecar ending metadata has the exact contract for trimmed and clean reels", () => {
  const cuts = planCuts(farewell, 6, settings);
  const metadata = endingMetadata(farewell, 6, cuts, settings);
  assert.deepEqual(Object.keys(metadata), ["lastPointEnd", "tailSeconds", "tailText", "trimmed", "endAt"]);
  assert.equal(metadata.trimmed, true);
  assert.equal(metadata.endAt, point.at(-1).end);
  assert.match(metadata.tailText, /^Have/);
  const clean = endingMetadata(cta, 5, planCuts(cta, 5, settings), settings);
  assert.equal(clean.trimmed, false);
  assert.equal(clean.endAt, null);
  assert.equal(clean.tailSeconds, 0);
  const explicit = endingMetadata(farewell, 6, planCuts(farewell, 6, { ...settings, endAt: point.at(-1).end }), settings, point.at(-1).end);
  assert.equal(explicit.endAt, point.at(-1).end);
  const noCuts = { words: farewell, removed: [], segments: [{ start: 0, end: 6 }] };
  const retained = endingMetadata(farewell, 6, noCuts, settings);
  assert.equal(retained.trimmed, false);
  assert.equal(retained.lastPointEnd, point.at(-1).end);
  const quietTail = endingMetadata(point, 6, planCuts(point, 6, settings), settings);
  assert.equal(quietTail.tailSeconds, +(6 - point.at(-1).end).toFixed(3));
  const restoredPause = { ...cuts, segments: [{ start: 0, end: cuts.segments.at(-1).end }] };
  assert.equal(endingMetadata(farewell, 6, restoredPause, settings).lastPointEnd, point.at(-1).end);
});

test("reports use warn for short tails and check above four seconds, never fail", () => {
  const long = openingEndingChecks(farewell, { video: { duration: 6 } });
  assert.equal(long.items.at(-1).level, "check");
  assert.match(long.items.at(-1).message, /trim with reel edit --end-at 0.84/);
  const shortWords = [...point, ...line("Have a great day.", 1)];
  assert.equal(openingEndingChecks(shortWords, { video: { duration: 2.2 } }).items.at(-1).level, "warn");
  assert.match(preflightText({ status: "warn", items: long.items, measures: {} }), /check  ending runs/);
});

test("runPreflight persists both reports with a nonblocking check", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-ending-preflight-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "fixture.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=128x128:r=10:d=6", "-an", "-c:v", "libx264", "-preset", "ultrafast", file]);
  const result = await runPreflight(file, { plan: { video: { duration: 6 }, words: farewell } });
  assert.equal(result.status, "warn");
  assert.ok(result.opening);
  assert.equal(result.ending.tailStart, 1.5);
  assert.equal(result.items.find((i) => i.code === "ending-tail").level, "check");
  writePreflight(dir, result);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "preflight.json"))).ending, result.ending);
  assert.match(fs.readFileSync(path.join(dir, "preflight.txt"), "utf8"), /check  ending runs/);
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ video: { duration: 6 }, words: farewell }));
  const cli = JSON.parse(execFileSync(process.execPath, ["bin/reel.mjs", "ending", dir, "--json"], { encoding: "utf8" }));
  assert.deepEqual(cli.ending, result.ending);
  const plain = execFileSync(process.execPath, ["bin/reel.mjs", "ending", dir], { encoding: "utf8" });
  assert.match(plain, /First spoken word:/);
  assert.match(plain, /trim with reel edit --end-at/);
  // Exercise both edit flags through CLI parsing, source planning and saved plan.ending.
  const transcript = path.join(dir, "source-words.json"), preset = path.join(dir, "preset.json");
  fs.writeFileSync(transcript, JSON.stringify({ words: farewell }));
  fs.writeFileSync(preset, JSON.stringify({ name: "ending-test", hook: { enabled: false }, captions: { autoPlace: false }, zooms: { enabled: false }, graphics: { enabled: false }, signature: { enabled: false }, broll: { enabled: false }, audio: { cleanAudio: false }, cuts: settings }));
  for (const [flag, value] of [["--end-after", "price the work"], ["--end-at", "0.84"]]) {
    const out = path.join(dir, flag.slice(2));
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "cuts.json"), JSON.stringify({ segments: [{ start: 0, end: 6 }] }));
    execFileSync(process.execPath, ["bin/reel.mjs", "edit", file, "--transcript", transcript, "--preset", preset, "--out", out, "--no-render", flag, value], { env: { ...process.env, REEL_SW_ENCODE: "1" }, stdio: "pipe", timeout: 20000 });
    const edited = JSON.parse(fs.readFileSync(path.join(out, "plan.json")));
    assert.equal(edited.ending.trimmed, true);
    assert.equal(edited.ending.endAt, 0.84);
    assert.equal(edited.words.at(-1).text, "work.");
    assert.ok(!edited.captions.some((c) => /great day/.test(c.text)));
    assert.ok(edited.video.duration < 1.1, "no frozen or silent extension");
  }
});

const realDir = "/Users/gregpingel/Reels/videos/img-3058";
test("img-3058 farewell maps from finished time to source and both trim paths end after it", { skip: !fs.existsSync(path.join(realDir, "plan.json")) }, (t) => {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(realDir, name)));
  const plan = read("plan.json"), saved = read("cuts.json"), source = read("words.json").words;
  const report = endingReport(plan.words, plan.video.duration);
  assert.equal(report.lastPointEnd, 86.926);
  assert.equal(report.tailStart, 87.366);
  assert.equal(plan.words.at(-1).end, 93.266);
  assert.equal(report.tailSeconds, 6.34);
  const endAt = timelineToSource(report.lastPointEnd, saved);
  assert.equal(endAt, 96.76);
  assert.equal(endAfterPhrase(source, "be ready for it"), endAt);
  const sameEditAfter = saved.segments.reduce((sum, s) => sum + Math.max(0, Math.min(s.end, endAt + 0.12) - s.start), 0);
  assert.ok(Math.abs(sameEditAfter - 87.046) < 0.002);
  t.diagnostic(`Saved edit with earlier segments preserved: ${saved.keptDuration.toFixed(3)} s to ${sameEditAfter.toFixed(3)} s, including 0.12 s audio pad.`);
  const options = plan.style.cuts;
  const before = planCuts(source, saved.originalDuration, { ...options, signOff: false });
  for (const override of [{ endAt }, {}]) {
    const cuts = planCuts(source, saved.originalDuration, { ...options, ...override });
    const last = cuts.words.filter((w) => !w.drop).at(-1);
    assert.equal(last.text, "it.");
    assert.equal(last.end, 96.76);
    assert.ok(cuts.segments.at(-1).end >= 96.86 && cuts.segments.at(-1).end < 97.2);
    assert.equal(remapWords(cuts.words, cuts.segments).at(-1).text, "it.");
    const snapped = snapSegments(cuts.segments, 30, saved.originalDuration);
    const duration = snapped.reduce((sum, s) => sum + s.end - s.start, 0);
    t.diagnostic(`img-3058 ${override.endAt ? "explicit" : "auto"}: before ${before.keptDuration.toFixed(3)} s, after ${cuts.keptDuration.toFixed(3)} s, frame aligned ${duration.toFixed(3)} s. Saved cut was ${saved.keptDuration.toFixed(3)} s. Last point 86.926 timeline = ${endAt} source.`);
  }
});
