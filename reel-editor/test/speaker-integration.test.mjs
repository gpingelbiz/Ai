import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { starterPlan, writeStarterPlan, SECTION_BUDGETS } from "../src/speaker-plan.mjs";
import { speakerMusicLane, licensedMusic } from "../src/speaker-music.mjs";
import { speakerHTML } from "../src/speaker-compose.mjs";
import { parseSpeakerArgs, speakerMain, composeSpeaker, runSpeaker, analyzeSpeaker } from "../src/speaker.mjs";
import { compileVersion, resolvePlan } from "../src/speaker-compile.mjs";
import { indexSources, loadSourceIndex } from "../src/speaker-index.mjs";
import { speakerPreset } from "../src/brandkit.mjs";
import { resolveBrandTokens } from "../src/brandtokens.mjs";
import { rightsChecks } from "../src/speaker-qc.mjs";
import { reviewState, approve } from "../src/speaker-deliver.mjs";
import { speakerStatus } from "../scripts/speaker-status.mjs";
import { writeJSON, run } from "../src/util.mjs";

const brand = { name: "Avery Example", fonts: { display: "Client Display", body: "Client Body" }, colors: { text: "#FFFFFF", bg: "#112233", accent: "#DD9955" } };
function manifest() { return { schemaVersion: 1, clientId: "avery", identity: { name: "Avery Example", roleLine: "Service leadership speaker", bookingMode: "direct", bookingText: "Book Avery", bookingUrl: "https://example.test/speaking" }, brand: { file: "brand.json" }, brief: { topics: ["Leadership"] }, sources: [
  { id: "stage", path: "footage/stage.mp4", kind: "stage", audio: "ok", rights: "r1" },
  { id: "phone", path: "footage/phone.mp4", kind: "testimonial", audio: "ok", rights: "r1" },
], proof: [{ id: "t1", kind: "testimonial-video", sourceId: "phone", in: 0, out: 4, attribution: { name: "Sam Example", title: "Organizer", org: "Summit" }, rights: "r1" }], rights: [{ id: "r1", status: "approved" }], music: [] }; }
function temp(t) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-integration-")); t.after(() => fs.rmSync(folder, { recursive: true, force: true })); return folder; }
const candidate = (id, kind, start, end, score = 90) => ({ id, kind, sourceId: "stage", in: start, out: end, score, flags: [], alternates: [] });

test("starter budgets are 210/60/30; best core is reserved intact and proof cannot be invented", () => {
  for (const [version, seconds] of [["full", 210], ["short", 60], ["teaser", 30]]) assert.equal(Object.values(SECTION_BUDGETS[version]).reduce((a, b) => a + b), seconds);
  const m = manifest(), list = [candidate("core", "story", 20, 120), candidate("hook", "one_liner", 0, 5), candidate("close", "one_liner", 130, 135, 80)];
  const p = starterPlan(m, list);
  assert.deepEqual(p.items.map((i) => i.role), ["opening", "identity", "core", "testimonial", "close", "booking"]);
  assert.deepEqual(p.items.find((i) => i.role === "core"), { id: "i03", kind: "clip", sourceId: "stage", in: 20, out: 120, role: "core", fit: "contain", audio: "source", protect: true, note: "Candidate core; verify source context." });
  assert.ok(p.notes.some((n) => n.startsWith("proof omitted")));
  assert.equal(p.overlays.find((o) => o.card.type === "testimonial-name").card.proofId, "t1");
  m.rights[0].status = "pending";
  const empty = starterPlan(m, []);
  assert.deepEqual(empty.items.map((i) => i.role), ["identity", "booking"]);
  assert.ok(empty.notes.some((n) => n.startsWith("core omitted")));
  assert.ok(empty.notes.some((n) => n.startsWith("room/testimonial omitted")));
  assert.throws(() => starterPlan(m, [], { version: "../bad" }), /unsupported/);
  const short = starterPlan(manifest(), list, { version: "short" });
  assert.ok(!short.items.some((i) => i.out === 120), "long story is never truncated for a short");
});

test("starter plan does not overwrite manual edits; replan preserves collision-free numbered archives", (t) => {
  const folder = temp(t), m = manifest();
  const first = writeStarterPlan(folder, m, []);
  first.plan.notes.push("Manual instruction"); writeJSON(first.file, first.plan);
  assert.throws(() => writeStarterPlan(folder, m, []), /already exists/);
  const second = writeStarterPlan(folder, m, [], { replan: true });
  assert.equal(second.plan.revision, 2);
  assert.ok(JSON.parse(fs.readFileSync(path.join(folder, "work/plans/full.r1.json"))).notes.includes("Manual instruction"));
  assert.equal(writeStarterPlan(folder, m, [], { replan: true }).plan.revision, 3);
});

function musicPlan() { return { canvas: { fps: 30 }, duration: 24, music: { file: "music.wav", sections: [] }, items: [
  { id: "a", startFrame: 0, endFrame: 240, role: "opening" },
  { id: "b", startFrame: 240, endFrame: 480, role: "core" },
  { id: "c", startFrame: 480, endFrame: 720, role: "room", protect: true },
] }; }
test("music lanes honor dB gain, speech ducking, frame times, section boundaries and protected reactions", () => {
  const p = musicPlan(), words = [{ start: 1, end: 2 }, { start: 6, end: 7 }];
  let lane = speakerMusicLane(p, words);
  const at = (t) => lane.find((p) => Math.abs(p.t - t) < 1e-6).v;
  assert.ok(Math.abs(at(1) - 0.1) < 1e-6);
  assert.ok(at(4) > at(1));
  assert.ok(lane.filter((p) => p.t >= 8).every((p) => p.v === 0));
  assert.ok(lane.every((p) => Math.abs(p.t * 30 - Math.round(p.t * 30)) < 1e-7));
  p.music.sections = [{ from: "a", to: "a", gainDb: -24 }, { from: "c", to: "c", gainDb: -18 }];
  lane = speakerMusicLane(p, words);
  assert.ok(Math.abs(at(1) - 10 ** (-24 / 20)) < 1e-6);
  assert.ok(lane.filter((p) => p.t >= 8 && p.t < 16).every((p) => p.v === 0));
  assert.ok(lane.filter((p) => p.t >= 16).every((p) => p.v <= 10 ** (-18 / 20) + 1e-8), "explicit protected reaction has no swell");
  p.music.sections = [{ from: "b", to: "c", gainDb: -20 }];
  lane = speakerMusicLane(p, words); assert.ok(at(9) > 0); assert.equal(at(1), 0);
  p.music.sections.push({ from: "c", to: "c", gainDb: -20 });
  assert.throws(() => speakerMusicLane(p), /overlapping/);
  p.music.sections = [{ from: "unknown", to: "c", gainDb: -20 }]; assert.throws(() => speakerMusicLane(p), /invalid section/);
  assert.deepEqual(speakerMusicLane({}), []);
});

test("unlicensed or missing music skips with one draft warning and refuses final use", (t) => {
  const folder = temp(t), p = musicPlan(), m = manifest(), messages = [];
  assert.equal(licensedMusic(folder, p, m, { print: (s) => messages.push(s) }), null); assert.equal(messages.length, 1);
  assert.throws(() => licensedMusic(folder, p, m, { final: true }), /licence/);
  assert.equal(rightsChecks({ ...p, items: [] }, m, true).find((c) => c.code === "music-license").level, "fail");
  fs.writeFileSync(path.join(folder, "music.wav"), "licensed bytes"); m.music = [{ file: "music.wav", license: "Client licence" }];
  assert.equal(licensedMusic(folder, p, m), fs.realpathSync(path.join(folder, "music.wav")));
  fs.rmSync(path.join(folder, "music.wav")); assert.throws(() => licensedMusic(folder, p, m, { final: true }), /file not found/);
  assert.equal(licensedMusic(folder, {}, m), null);
});

for (const [command, tail] of [["init", ["--add-new"]], ["index", ["--engine", "faster-whisper", "--language", "en", "--model", "tiny"]], ["candidates", ["--source", "stage"]], ["reactions", []], ["plan", ["--version", "short", "--replan"]], ["draft", ["--version", "full", "--captions", "--render-only"]], ["comments", ["--version", "full", "changes.txt"]], ["approve", ["--version", "full", "--by", "Client Name"]], ["deliver", ["--version", "full"]], ["status", []]]) {
  test(`speaker ${command} arguments parse without losing paths or flags`, () => {
    const args = parseSpeakerArgs([command, "/tmp/Client Folder", ...tail]);
    assert.equal(args.command, command); assert.equal(args.folder, "/tmp/Client Folder");
    if (command === "comments") assert.equal(args.file, "changes.txt");
    if (command === "draft") { assert.equal(args.options.draft, true); assert.equal(args.options.captions, true); assert.equal(args.options.renderOnly, true); }
    if (command === "approve") assert.equal(args.options.by, "Client Name");
  });
}
test("Desktop draft flags match subcommand and bad arguments fail clearly", () => {
  assert.equal(parseSpeakerArgs(["/tmp/client", "--version", "full", "--draft"]).options.draft, true);
  assert.equal(parseSpeakerArgs(["--version", "full", "draft", "/tmp/client"]).options.draft, true);
  assert.equal(parseSpeakerArgs(["--help"]).help, true);
  for (const args of [["deliver", "c"], ["approve", "c", "--version", "full"], ["plan", "c", "--version", "../bad"], ["comments", "c", "--version", "full"], ["c", "--source", "x"], ["c", "--add-new"], ["c", "--replan"], ["c", "--by", "A"], ["c", "--unknown"], ["c", "--plan-only", "--render-only"]]) assert.throws(() => parseSpeakerArgs(args));
});

test("speaker CLI dispatches read/review actions with explicit approval identity", async () => {
  const calls = [];
  for (const [command, tail] of [["status", []], ["candidates", ["--source", "stage"]], ["reactions", []], ["draft", ["--version", "full"]], ["index", []], ["approve", ["--version", "full", "--by", "Client"]], ["deliver", ["--version", "full"]]]) {
    await speakerMain([command, "/tmp/client", ...tail], { print: () => {}, status: () => "status", analyze: async (...a) => calls.push([command, ...a]), run: async (...a) => calls.push([command, ...a]), approve: async (...a) => { calls.push([command, ...a]); return {}; }, deliver: async (...a) => { calls.push([command, ...a]); return { dir: "final" }; } });
  }
  assert.equal(calls.length, 6);
  const approved = calls.find((c) => c[0] === "approve"); assert.equal(approved[3].by, "Client"); assert.ok(Number.isFinite(Date.parse(approved[3].at)));
});

test("speaker HTML escapes copy, registers a paused timeline and caption visibility is opt in", () => {
  const p = { duration: 2, canvas: { width: 1920, height: 1080, fps: 30 } }, cards = { css: "", html: "", timeline: "" }, m = manifest();
  const options = { manifest: m, cards, cues: [{ start: 0.11, end: 1.11, text: "<speaker> & words" }] };
  assert.ok(!speakerHTML(p, options).includes("id=\"caption-0\""));
  const html = speakerHTML(p, { ...options, captions: true });
  assert.match(html, /&lt;speaker&gt; &amp; words/); assert.match(html, /data-start="0.1"/);
  assert.match(html, /paused:true/); assert.match(html, /__timelines\["speaker"\]/);
  assert.throws(() => speakerHTML(p, { ...options, manifest: { identity: { name: "Greg Pingel" } } }), /brand safety/);
});

// No Chrome, network or ASR service: inject transcript into the real cache, compile real media, write real HTML.
test("tiny two-source speaker plan → compile → client-brand composition and review wiring", { timeout: 120000 }, async (t) => {
  const folder = temp(t), m = manifest(); fs.mkdirSync(path.join(folder, "footage"));
  writeJSON(path.join(folder, "brand.json"), brand); writeJSON(path.join(folder, "speaker-manifest.json"), m);
  for (const [name, size, seconds] of [["stage", "160x90", "1.2"], ["phone", "90x160", "4.2"]]) {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=s=${size}:r=30`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", seconds, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", path.join(folder, "footage", `${name}.mp4`)], { capture: true });
  }
  await indexSources(folder, m, { brand, engine: "faster-whisper", transcribe: async () => [{ text: "True", start: 0.1, end: 0.3 }, { text: "words.", start: 0.4, end: 0.7 }], audioEnvelope: async () => ({ step: 0.02, db: [-20] }), print: () => {} });
  const index = loadSourceIndex(folder, m, { brand });
  const made = writeStarterPlan(folder, m, [candidate("one", "one_liner", 0, 0.3), candidate("story", "story", 0.3, 1.1)]);
  const preset = speakerPreset(brand), tokens = resolveBrandTokens({ preset, brand });
  const compiled = await compileVersion(folder, made.plan, { manifest: m, index, preset, tokens, encoder: "libx264", print: () => {} });
  const composition = await composeSpeaker(compiled.workDir, compiled.resolvedPlan, { manifest: m, preset, tokens, print: () => {} });
  const html = fs.readFileSync(composition.html, "utf8");
  for (const token of ["Client Display", "Client Body", "#112233", "#DD9955", "Avery Example", "Book Avery", "Sam Example"]) assert.ok(html.includes(token), token);
  assert.ok(!/greg\s*pingel|officialgregpingel|pingel/i.test(html));
  assert.ok(!html.includes('id="caption-0"'));
  const resolved = compiled.resolvedPlan;
  for (const entry of [...resolved.items.filter((i) => i.kind === "card"), ...resolved.overlays]) assert.ok(html.includes(`data-start="${entry.start}" data-duration="${entry.end - entry.start}"`), entry.id);
  assert.equal(resolved.items.find((i) => i.sourceId === "phone").fit, "contain");
  assert.ok(fs.existsSync(path.join(compiled.workDir, "captions.srt"))); assert.ok(fs.existsSync(path.join(compiled.workDir, "captions.vtt")));
  const statements = [];
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], { window: {}, gsap: { timeline: () => ({ fromTo: (...args) => statements.push(args), set: () => {}, to: () => {} }) } });
  assert.ok(statements.length >= 6);
  const order = [];
  const result = await runSpeaker(folder, { version: "full", draft: true, renderOnly: true, captions: true }, {
    compile: async () => compiled, loudness: async () => ({ i: -16, tp: -2 }), print: () => {},
    compose: async (...args) => { order.push("compose"); return composeSpeaker(...args); },
    render: async (_project, out) => { order.push("render"); fs.copyFileSync(compiled.base, out); },
    normalize: async () => { order.push("normalize"); return true; },
    qc: async () => { order.push("qc"); return { ok: true, checks: [] }; },
  });
  assert.deepEqual(order.slice(0, 4), ["compose", "render", "normalize", "qc"]);
  assert.ok(fs.existsSync(result[0].review.index)); assert.ok(fs.existsSync(path.join(compiled.workDir, "draft.mp4")));
  assert.ok(fs.readFileSync(composition.html, "utf8").includes('id="caption-0"'));
  const state = reviewState(folder, "full"); assert.equal(state.files.find((f) => f.kind === "video").variant, "open");
  const reviewedInput = fs.readFileSync(made.file);
  fs.appendFileSync(made.file, " ");
  await assert.rejects(approve(folder, "full", { by: "Client", at: "2026-10-31T12:00:00Z", qc: async () => ({ ok: true, checks: [] }) }), /inputs changed since review/);
  fs.writeFileSync(made.file, reviewedInput);
  await approve(folder, "full", { by: "Client", at: "2026-10-31T12:00:00Z", qc: async () => ({ ok: true, checks: [] }) });
  made.plan.revision++; writeJSON(made.file, made.plan);
  assert.equal(reviewState(folder, "full").state, "revised", "editing the operator plan invalidates exact-file approval");
  assert.match(speakerStatus(folder), /2 transcribed/);
  assert.equal(fs.existsSync(path.join(folder, "Publish")), false);
  const called = [];
  await analyzeSpeaker(folder, { source: "stage" }, { reactions: async () => [], shots: async () => [], candidates: async (input) => { called.push(input); return []; }, print: () => {} });
  assert.equal(called[0].words.stage[0].id, "stage-w0"); assert.equal(called[0].sources.length, 1);
});

test("teaser uses approved video proof before its core, never an anonymous testimonial", () => {
  const m = manifest();
  let p = starterPlan(m, [candidate("idea", "teaching", 0, 10)], { version: "teaser" });
  assert.deepEqual(p.items.map((i) => i.role), ["identity", "proof", "core", "booking"]);
  assert.equal(p.overlays[0].card.proofId, "t1");
  m.proof[0].attribution.name = "";
  p = starterPlan(m, [], { version: "teaser" });
  assert.ok(p.items.every((i) => i.kind === "card"));
});

test("composition copies supplied fonts/assets and exports native music automation without a renderer", async (t) => {
  const folder = temp(t), m = manifest(), work = path.join(folder, "work/full");
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "base.mp4"), "base-byte-fixture");
  fs.writeFileSync(path.join(folder, "client.ttf"), "client-font-byte-fixture");
  fs.writeFileSync(path.join(folder, "music.wav"), "licensed-byte-fixture");
  writeJSON(path.join(work, "words.json"), []);
  m.music = [{ file: "music.wav", license: "Client licence" }];
  const plan = { schemaVersion: 1, clientId: m.clientId, version: "full", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 }, duration: 6, music: { file: "music.wav", sections: [{ from: "book", to: "book", gainDb: -20 }] }, items: [{ id: "book", kind: "card", duration: 6, start: 0, end: 6, startFrame: 0, endFrame: 180, card: { type: "booking" }, role: "booking" }], overlays: [] };
  const tokens = resolveBrandTokens({ brand }); tokens.type.display.file = path.join(folder, "client.ttf");
  let prepared = 0;
  const c = await composeSpeaker(work, plan, { manifest: m, tokens, preset: speakerPreset(brand), print: () => {}, prepareMusic: async (cmd, args) => { prepared++; assert.equal(cmd, "ffmpeg"); assert.ok(args.includes("loudnorm=I=-16:TP=-1.5:LRA=11")); fs.writeFileSync(args.at(-1), "prepared-fixture"); } });
  const html = fs.readFileSync(c.html, "utf8");
  assert.equal(prepared, 1); assert.match(html, /data-automation=/); assert.match(html, /assets\/speaker-cards\/[^\"]+\.ttf/);
  assert.ok(!html.includes(path.join(folder, "client.ttf")));
  assert.ok(fs.existsSync(path.join(c.projectDir, "assets/music.wav")));
});
