import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseVslScript, alignVslScript, screenToVslCards, planVslGraphics, makeVslGraphics } from "../src/vsl-script.mjs";
import { normalizeScene, sceneUsesSpeakerWords, resolveProgressScenes, sceneHTML, makeGraphics } from "../src/graphics.mjs";
import { PKG_ROOT } from "../src/util.mjs";

const spoken = (text, start, step = 0.4) => text.split(/\s+/).map((text, i) => ({ text, start: start + i * step, end: start + i * step + step * 0.8 }));
const script = `---
project: synthetic-demo
client: fixture
version: 2
wpm: 150
---
## S1 Opening
JOB: Introduce the exercise.
SAY: Welcome to our practice studio.
SAY: [pause] Build a simple weekly plan.
SCREEN: Weekly plan
EVIDENCE: F1, P2
NOTE: Keep the natural pause.
## S6b Next action
SAY: Choose your next small action.
SCREEN: One clear action
`;
const words = [...spoken("Welcome to our practice studio", 0), ...spoken("Build a simple weekly", 3), ...spoken("Build a simple weekly plan", 6), ...spoken("Choose your next small action", 18)];

test("VSL parser reads front matter, suffix ids, repeated labels, cues, evidence and notes", () => {
  const parsed = parseVslScript('\uFEFF' + script.replaceAll('\n', '\r\n'));
  assert.deepEqual(parsed.frontMatter, { project: "synthetic-demo", client: "fixture", version: 2, wpm: 150 });
  assert.deepEqual(parsed.sections.map(({ id, title }) => [id, title]), [["S1", "Opening"], ["S6b", "Next action"]]);
  assert.equal(parsed.sections[0].say[1].text, "Build a simple weekly plan.");
  assert.deepEqual(parsed.sections[0].evidence, ["F1", "P2"]);
  assert.equal(parsed.sections[0].notes[0], "Keep the natural pause.");
  const cues = parseVslScript("## S2 Cues\nSAY: Start [pause [quietly]] here.\nSAY: End [unfinished cue\nsay: ignored\nNOTE: Never spoken\n```\nSCREEN: ignored sample\n```\n## Appendix\nSCREEN: ignored footer");
  assert.deepEqual(cues.sections[0].say.map((line) => line.text), ["Start here.", "End"]);
  assert.deepEqual(cues.sections[0].screen, []);
  assert.throws(() => parseVslScript("---\nproject: unfinished"), /front matter/);
});

test("VSL bracketed screens never reach a card, including unfinished and ordinary bracket cues", () => {
  const parsed = parseVslScript("## S1 Safe\nSAY: A normal sentence for timing.\nSCREEN: Visible copy\nSCREEN: [CONFIRM: price] $88\nSCREEN: A [pause] cue\nSCREEN: An unfinished [bracket\nSCREEN: [confirm lower case]\nSCREEN: Final approved copy");
  assert.equal(parsed.skippedScreens.length, 4);
  assert.deepEqual(parsed.sections[0].screen.map((line) => line.text), ["Visible copy", "Final approved copy"]);
  const plan = planVslGraphics({ script: parsed, words: spoken("A normal sentence for timing", 0), duration: 20 });
  assert.equal(plan.scenes.length, 2);
  assert.doesNotMatch(JSON.stringify(plan.scenes), /CONFIRM|\[pause|unfinished|confirm lower/);
  assert.equal(plan.diagnostics.filter((item) => item.code === "screen-bracket").length, 4);
  assert.deepEqual(screenToVslCards("Not approved [yet]"), []);
  assert.equal(normalizeScene({ type: "quote", source: "script", line: 0, text: "Bad [cue]" }), null);
});

test("VSL SAY alignment chooses complete retakes on the edited timeline in script order", () => {
  const aligned = alignVslScript(parseVslScript(script), words, { duration: 30 });
  assert.equal(aligned[0].say[0].start, 0);
  assert.equal(aligned[0].say[1].start, 6);
  assert.equal(aligned[1].say[0].start, 18);
  assert.deepEqual(aligned.map(({ id, start, end }) => [id, start, end]), [["S1", 0, 18], ["S6b", 18, 30]]);
  const repeated = alignVslScript(parseVslScript("## S1 Repeat\nSAY: Build a simple weekly plan."), [...spoken("Build a simple weekly plan", 0), ...spoken("Build a simple weekly plan", 8)], { duration: 20 });
  assert.equal(repeated[0].say[0].start, 8, "equal complete retakes prefer the later telling");
});

test("VSL alignment tolerates punctuation, misreads, rewording, omitted SAYs and sections", () => {
  const parsed = parseVslScript("## S1 Start\nSAY: Let's build a simple weekly plan together.\nSAY: Purple elephants juggle distant galaxies.\n## S2 Omitted\nSAY: Zebras dance near volcanoes.\n## S3 End\nSAY: Choose your next small action now.");
  const heard = [...spoken("LETS build a clear weekly plans together", 1), ...spoken("Choose the next small action now!", 20)];
  const aligned = alignVslScript(parsed, heard, { duration: 30 });
  assert.equal(aligned[0].say[0].start, 1);
  assert.equal(aligned[0].say[1].start, null);
  assert.equal(aligned[1].say[0].start, null);
  assert.equal(aligned[2].start, 20);
  assert.ok(aligned[1].estimated && aligned[1].start > 1 && aligned[1].end === 20);
  const empty = alignVslScript(parsed, [], { duration: 30 });
  assert.equal(empty[0].start, 0);
  assert.equal(empty.at(-1).end, 30);
  assert.ok(empty.every((section) => section.estimated && section.end >= section.start));
});

test("VSL maps amounts, pipe lists, numbered steps, verbatim attributed quotes and headlines", () => {
  assert.deepEqual(screenToVslCards("Only $49 today").map(({ type, value, sub, motion, source }) => ({ type, value, sub, motion, source })), [{ type: "stat", value: "$49", sub: "Only today", motion: "reveal", source: "script" }]);
  assert.equal(screenToVslCards("An offer with more than six words costs $49")[0].type, "headline");
  assert.equal(screenToVslCards("Today | $49")[0].type, "stat", "a short price line takes precedence over pipe separators");
  assert.equal(screenToVslCards("Today | $49")[0].sub, "Today");
  assert.equal(screenToVslCards("Alpha | Beta | Gamma | Delta | Epsilon")[0].items.length, 5);
  const steps = screenToVslCards("1. Pick a goal | 2. Make a plan | 3. Try it")[0];
  assert.equal(steps.type, "steps");
  assert.deepEqual(steps.items.map((item) => item.text), ["Pick a goal", "Make a plan", "Try it"]);
  const quoteText = "This synthetic quote is deliberately long so we can verify that approved text is preserved exactly rather than truncated to the automatic planner character limit. Every printed word belongs here.";
  const attribution = "Example Person, Owner of the Fictional Practice Studio";
  const quote = screenToVslCards(`"${quoteText}" ${attribution}`)[0];
  assert.equal(quote.type, "quote");
  assert.equal(quote.text, quoteText);
  assert.equal(quote.eyebrow, attribution);
  assert.ok(sceneHTML(quote, { schema: 2 }).includes("Every printed word belongs here."));
  assert.equal(screenToVslCards('“A useful exercise.” — Example Author')[0].eyebrow, "Example Author");
  assert.equal(screenToVslCards("A sentence worth displaying")[0].type, "headline");
});

test("VSL long lists split without truncating items or dropping the sixth row", () => {
  const items = ["One item that is longer than thirty two characters", "Two", "Three", "Four", "Five", "Six"];
  const cards = screenToVslCards(items.join(" | "));
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.items.length), [3, 3]);
  assert.deepEqual(cards.flatMap((card) => card.items.map((item) => item.text)), items);
  assert.ok(cards.every((card) => card.items.every((item) => item.icon === "")));
});

test("VSL cards follow the most similar SAY, fall back to the section and respect timing bounds", () => {
  const plan = planVslGraphics({ script, words, duration: 30 });
  assert.equal(plan.schema, 2);
  assert.equal(plan.scenes.schema, 2);
  assert.deepEqual(plan.scenes.map(({ start, duration }) => [start, duration]), [[6, 5.5], [18, 5.5]]);
  const bounded = planVslGraphics({ script: "## S1 First\nSAY: A warm welcome to this exercise.\nSCREEN: Unrelated display copy\nSCREEN: Another display line\n## S2 Second\nSAY: Here is the useful next step.\nSCREEN: Useful next step\n## S3 Closing\nSAY: Finish this exercise with a wave.\nSCREEN: Closing words", words: [...spoken("A warm welcome to this exercise", 0), ...spoken("Here is the useful next step", 7), ...spoken("Finish this exercise with a wave", 18)], duration: 20 });
  assert.equal(bounded.scenes[0].start, 2);
  assert.equal(bounded.scenes[1].start + bounded.scenes[1].duration, 7);
  assert.equal(bounded.scenes.at(-1).start + bounded.scenes.at(-1).duration, 12.5);
  assert.ok(bounded.scenes.every((card, i, cards) => card.duration > 0 && card.duration <= 7 && card.start + card.duration <= (cards[i + 1]?.start ?? Infinity) && card.start + card.duration <= 17.5));
  assert.ok(!bounded.scenes.some((card) => card.sectionId === "S3"));
  const late = planVslGraphics({ script: "## S1 Late\nSAY: Choose your next action now.\nSCREEN: Next action", words: spoken("Choose your next action now", 15), duration: 20 });
  assert.equal(late.scenes[0].duration, 2.5, "the protected tail clips even the normal minimum hold");
});

test("VSL split lists have consecutive holds and reuse existing skins without applying reel themes", () => {
  const plan = planVslGraphics({ script: "## S1 Items\nSAY: Review these practice items together.\nSCREEN: One | Two | Three | Four | Five | Six", words: spoken("Review these practice items together", 4), duration: 30, settings: { look: "fieldnotes" } });
  assert.equal(plan.scenes.length, 2);
  assert.equal(plan.scenes[0].start + plan.scenes[0].duration, plan.scenes[1].start);
  assert.ok(plan.scenes.every((card) => card.skin === "paper"));
  assert.equal(plan.scenes.look, undefined);
});

test("speaker-words check exempts exact source script only; other sources remain checked", () => {
  const groups = [{ text: "A spoken phrase" }];
  for (const source of [undefined, "automatic", "Script", true, "script "]) {
    assert.equal(sceneUsesSpeakerWords({ type: "headline", text: "Approved extra copy", source }, groups), false);
    assert.equal(sceneUsesSpeakerWords({ type: "headline", text: "A spoken phrase", source }, groups), true);
  }
  assert.equal(sceneUsesSpeakerWords({ type: "headline", text: "Approved extra copy", source: "script" }, groups), true);
  assert.equal(sceneUsesSpeakerWords({ type: "headline", text: "Unconfirmed [price]", source: "script" }, groups), false);
  const lines = [{ start: 0, text: "intro" }, { start: 5, text: "first thing" }, { start: 18, text: "last thing" }];
  const progress = { type: "progress", style: "journey", title: "Approved navigation", items: [{ line: 1, label: "First chapter" }, { line: 2, label: "Last chapter" }] };
  const options = { hook: { start: 0, duration: 3 }, duration: 30 };
  assert.deepEqual(resolveProgressScenes([progress], lines, options), []);
  assert.equal(resolveProgressScenes([{ ...progress, source: "script" }], lines, options).length, 1);
});

test("VSL writes schema 2 cards and sections; edited scripts replace saved automatic/script plans", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsl-script-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const scriptPath = path.join(dir, "script.md");
  fs.writeFileSync(scriptPath, script);
  fs.writeFileSync(path.join(dir, "graphics.json"), JSON.stringify({ scenes: [{ text: "Stale automatic card" }] }));
  const first = makeVslGraphics({ scriptPath, workDir: dir, words, duration: 30 });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "graphics.json")));
  assert.equal(saved.schema, 2);
  assert.equal(saved.source, "script");
  assert.deepEqual(saved.scenes, [...first.scenes]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "vsl-sections.json"))), first.sections);
  fs.writeFileSync(scriptPath, script.replace("SCREEN: Weekly plan", "SCREEN: Revised approved copy"));
  const second = makeVslGraphics({ scriptPath, workDir: dir, words, duration: 30 });
  assert.equal(second.scenes[0].text, "Revised approved copy");
  assert.notEqual(second.scenes[0].text, first.scenes[0].text);
  assert.throws(() => makeVslGraphics({ scriptPath: path.join(dir, "missing.md"), workDir: dir, words, duration: 30 }), /ENOENT/);
  assert.throws(() => planVslGraphics({ script: "No sections here", words, duration: 30 }), /no ## S1/);
});

test("automatic planner never reuses approved script cards without --script", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsl-cache-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const original = process.env.REEL_CLAUDE_BIN;
  process.env.REEL_CLAUDE_BIN = path.join(dir, "no-model-binary");
  t.after(() => { if (original === undefined) delete process.env.REEL_CLAUDE_BIN; else process.env.REEL_CLAUDE_BIN = original; });
  const groups = [{ start: 4, text: "ordinary spoken words" }];
  fs.writeFileSync(path.join(dir, "graphics.json"), JSON.stringify({ source: "script", schema: 2, scenes: [{ source: "script", type: "headline", text: "Extra approved copy", line: 0, start: 4, duration: 5.5 }] }));
  assert.deepEqual(await makeGraphics({ workDir: dir, groups, duration: 20 }), []);
});

test("CLI --script replaces automatic cards, replans edits and survives a plan.json rebuild", (t) => {
  const available = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (available.status !== 0) return t.skip("ffmpeg unavailable for synthetic CLI integration");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsl-cli-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "input.mp4"), scriptPath = path.join(dir, "script.md"), transcript = path.join(dir, "words.json"), preset = path.join(dir, "preset.json"), work = path.join(dir, "work");
  const encoded = spawnSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=320x180:r=10:d=30", "-c:v", "libx264", "-preset", "ultrafast", input], { encoding: "utf8" });
  assert.equal(encoded.status, 0, encoded.stderr);
  fs.writeFileSync(scriptPath, script + "SCREEN: [CONFIRM: never display]\n");
  fs.writeFileSync(transcript, JSON.stringify({ words }));
  // Both automatic graphic planners are enabled: --script must replace both without model calls.
  fs.writeFileSync(preset, JSON.stringify({ name: "synthetic-vsl", extends: "clean", canvas: "landscape", captions: { autoPlace: false }, signature: { enabled: false }, reframe: { enabled: false }, transcribe: { fix: false, align: false }, graphics: { enabled: true, look: "glass" }, youtube: { chapters: true } }));
  const env = { ...process.env, REEL_CLAUDE_BIN: path.join(dir, "no-model-binary") };
  const args = [path.join(PKG_ROOT, "bin/reel.mjs"), "edit", input, "--preset", preset, "--transcript", transcript, "--script", scriptPath, "--out", work, "--no-cuts", "--no-render"];
  const run = () => {
    const result = spawnSync(process.execPath, args, { encoding: "utf8", env, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.doesNotMatch(result.stdout, /Claude is designing|chapter.*Claude/i);
    return JSON.parse(fs.readFileSync(path.join(work, "plan.json")));
  };
  const plan = run();
  assert.equal(plan.graphicsSchema, 2);
  assert.equal(plan.structure, null);
  assert.deepEqual(plan.graphics.map((card) => [card.source, card.text, card.start]), [["script", "Weekly plan", 6], ["script", "One clear action", 18]]);
  assert.deepEqual(plan.vslSections, JSON.parse(fs.readFileSync(path.join(work, "vsl-sections.json"))));
  assert.deepEqual(plan.graphics.map((card) => card.text), JSON.parse(fs.readFileSync(path.join(work, "graphics.json"))).scenes.map((card) => card.text));
  fs.writeFileSync(scriptPath, script.replace("SCREEN: Weekly plan", "SCREEN: Revised approved copy"));
  assert.equal(run().graphics[0].text, "Revised approved copy");
  const rebuild = spawnSync(process.execPath, [path.join(PKG_ROOT, "bin/reel.mjs"), "build", work, "--no-render"], { encoding: "utf8", env, timeout: 30000 });
  assert.equal(rebuild.status, 0, rebuild.stderr);
  assert.match(fs.readFileSync(path.join(work, "project/index.html"), "utf8"), /Revised approved copy/);
});
