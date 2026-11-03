import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { addOwnBroll, ownClipMetadata, ownVideoFiles, ownClipCovers, brollShotlist } from "../src/broll-own.mjs";
import { ownLibraryDir, libraryDir, libraryClipPath, readLibrary, findLibraryClip, rankLibraryClips } from "../src/broll-library.mjs";
import { fillBrollLibrary } from "../src/broll-fill.mjs";
import { DEFECT_QUESTIONS } from "../src/broll-qc.mjs";
import { main } from "../src/cli.mjs";
import { listPresets } from "../src/presets.mjs";
import { writeJSON } from "../src/util.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "own-broll-tests-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const fail = () => { throw new Error("unexpected process, network or paid call"); };
const verdict = { shows: true, action: true, dark: false, physicsPlausible: true, identityStable: true, artifacts: false, directionPlausible: true, humanFaces: false, readableText: false, eventType: "drop-land", checks: Object.fromEntries(Object.keys(DEFECT_QUESTIONS).map((key) => [key, { yes: false, time: null, why: "absent in compared frames" }])), defects: [], ok: true, look: "pass", onset: 0.2, contact: 0.6, completion: 1.1 };
const pick = { shows: "coconut", action: "drops onto sand", scene: "coconut on sand", kind: "action" };
const shot = { line: 0, start: 0, duration: 1.6, text: "coconut drops onto sand", ...pick };
const groups = [{ start: 0, text: shot.text, words: shot.text.split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.3 })) }];
function fixture() {
  const dir = fs.mkdtempSync(path.join(root, "case-")), env = { REEL_CACHE: dir, REEL_BROLL_LIBRARY: path.join(dir, "index"), REEL_BROLL_OWN: path.join(dir, "own"), REEL_BROLL_RECENT: path.join(dir, "recent.json") };
  const calls = { conforms: [], checks: [], runs: [], logs: [], trims: [] };
  const deps = {
    env, now: () => 1800000000000, logFn: (s) => calls.logs.push(s), claudeLook: fail, claudeText: fail, fetchFn: fail,
    conformStockClip: async (input, file, options) => { calls.conforms.push({ input, file, options }); fs.writeFileSync(file, "conformed full source"); },
    runFn: async (cmd, args) => { calls.runs.push({ cmd, args }); assert.equal(cmd, "ffprobe"); return { out: "6" }; },
    checkRunwayVideo: async (args) => { calls.checks.push(args); return verdict; },
    trimRunwayClip: async (file, duration, options) => { calls.trims.push({ file, duration, options }); const full = file.replace(/\.mp4$/, ".full.mp4"); fs.copyFileSync(file, full); fs.writeFileSync(file, "trimmed interval"); return { full, inPoint: options.inPoint ?? 0 }; },
  };
  const file = path.join(dir, "coconut - drops onto sand.mov");
  fs.writeFileSync(file, "original camera bytes");
  return { dir, env, file, deps, calls, args: { inputs: [file], deps }, find: { pick, shot, groups, workDir: path.join(dir, "reel"), dir, deps } };
}
function writeIndex(f, clips, reels = []) { writeJSON(path.join(libraryDir(f.env), "index.json"), { clips, reels }); }
function candidate(f, id, over = {}) {
  const file = path.join(f.dir, `${id}.mp4`); fs.writeFileSync(file, id);
  return { id, file, source: "pexels", shows: pick.shows, subjectWords: ["coconut"], description: pick.action, duration: 6, approvedAt: "2026-01-01", usedIn: [], ...over };
}

test("own metadata uses filename subject/action, sidecar fields, then explicit overrides", () => {
  const f = fixture();
  assert.deepEqual(ownClipMetadata(f.file), { shows: "coconut", action: "drops onto sand", scene: "" });
  assert.deepEqual(ownClipMetadata(path.join(f.dir, "coffee.MOV")), { shows: "coffee", action: "", scene: "" });
  writeJSON(f.file.replace(/\.mov$/, ".json"), { shows: "cream", action: "squeezed onto palm", scene: "beach" });
  assert.deepEqual(ownClipMetadata(f.file, { shows: "lotion", scene: "table" }), { shows: "lotion", action: "squeezed onto palm", scene: "table" });
  writeJSON(f.file.replace(/\.mov$/, ".json"), { shows: "", action: 42 });
  assert.throws(() => ownClipMetadata(f.file), /metadata needs shows/);
  assert.throws(() => ownClipMetadata(f.file, { shows: "cream" }), /metadata needs action/);
  writeJSON(f.file.replace(/\.mov$/, ".json"), []);
  assert.throws(() => ownClipMetadata(f.file), /metadata object/);
});

test("folder discovery recurses, accepts video extensions and ignores sidecars and duplicate paths", () => {
  const f = fixture(), nested = path.join(f.dir, "session"); fs.mkdirSync(nested);
  const second = path.join(nested, "coffee.MP4"); fs.writeFileSync(second, "coffee");
  fs.writeFileSync(path.join(nested, "notes.txt"), "notes"); writeJSON(f.file.replace(/\.mov$/, ".json"), { shows: "coconut" });
  assert.deepEqual(ownVideoFiles([f.dir, f.file]).sort(), [f.file, second].sort());
});

test("own import copies the original unchanged, saves a full proxy and timeline without recording use", async () => {
  const f = fixture(), bytes = fs.readFileSync(f.file), stat = fs.statSync(f.file);
  const out = await addOwnBroll({ ...f.args, scene: "beach" });
  assert.equal(out.approved.length, 1); assert.equal(out.results[0].status, "approved");
  const clip = out.approved[0];
  assert.equal(clip.source, "own"); assert.deepEqual(clip.licence, { provider: "own", creator: "Greg Pingel" });
  assert.equal(clip.contentHash, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.equal(path.isAbsolute(clip.file), false); assert.equal(path.isAbsolute(clip.originalFile), false);
  assert.deepEqual(fs.readFileSync(f.file), bytes); assert.equal(fs.statSync(f.file).mtimeMs, stat.mtimeMs);
  assert.deepEqual(fs.readFileSync(libraryClipPath(clip, f.env, "originalFile")), bytes);
  assert.equal(fs.readFileSync(libraryClipPath(clip, f.env), "utf8"), "conformed full source");
  assert.deepEqual(clip.timeline, { eventType: "drop-land", onset: 0.2, contact: 0.6, completion: 1.1 });
  assert.equal(clip.duration, 6); assert.deepEqual(clip.usedIn, []); assert.deepEqual(readLibrary(f.env).reels, []);
  assert.equal(f.calls.checks.length, 1); assert.equal(f.calls.checks[0].eventOnly, true); assert.equal(f.calls.checks[0].shot.duration, 6);
  assert.equal(f.calls.checks[0].pick.action, "drops onto sand"); assert.equal(f.calls.checks[0].pick.scene, "beach");
  assert.equal(f.calls.conforms[0].input, f.file); assert.equal(f.calls.trims.length, 0);
  assert.equal(fs.existsSync(path.dirname(f.calls.conforms[0].file)), false, "temporary evidence/proxy is cleaned up");
  assert.equal(fs.existsSync(f.env.REEL_BROLL_RECENT), false);
});

test("identical original content is imported only once even with another name, extension or batch entry", async () => {
  const f = fixture(), renamed = path.join(f.dir, "another coconut.mp4"); fs.copyFileSync(f.file, renamed);
  const out = await addOwnBroll({ inputs: [f.file, renamed], deps: f.deps });
  assert.deepEqual(out.results.map((r) => r.status), ["approved", "duplicate"]);
  f.deps.conformStockClip = fail; f.deps.checkRunwayVideo = fail; f.deps.runFn = fail;
  assert.equal((await addOwnBroll({ inputs: [renamed], deps: f.deps })).results[0].status, "duplicate");
  assert.equal(readLibrary(f.env).clips.length, 1); assert.equal(f.calls.checks.length, 1);
  assert.equal(fs.readFileSync(renamed, "utf8"), "original camera bytes");
});

test("rejected, unavailable and malformed locator checks leave both bank and originals untouched", async () => {
  for (const rejected of [{ ...verdict, ok: false, action: false, why: "coconut never drops" }, { unavailable: true, why: "vision unavailable" }, { ...verdict, completion: 20 }]) {
    const f = fixture(); writeIndex(f, [candidate(f, "existing")]);
    const before = fs.readFileSync(path.join(libraryDir(f.env), "index.json"));
    f.deps.checkRunwayVideo = async () => rejected;
    const out = await addOwnBroll(f.args);
    assert.equal(out.results[0].status, "rejected"); assert.ok(out.results[0].reason);
    assert.deepEqual(fs.readFileSync(path.join(libraryDir(f.env), "index.json")), before);
    assert.equal(fs.existsSync(f.env.REEL_BROLL_OWN), false);
    assert.equal(fs.readFileSync(f.file, "utf8"), "original camera bytes");
    assert.equal(fs.existsSync(path.dirname(f.calls.conforms[0].file)), false);
  }
});

test("a rejection reports its reason and does not stop the next file", async () => {
  const f = fixture(), second = path.join(f.dir, "coffee - pours.mp4"); fs.writeFileSync(second, "coffee");
  let checks = 0;
  f.deps.checkRunwayVideo = async () => ++checks === 1 ? { ...verdict, action: false, ok: false, why: "required drop absent" } : verdict;
  const out = await addOwnBroll({ inputs: [f.file, second], deps: f.deps });
  assert.deepEqual(out.results.map((r) => r.status), ["rejected", "approved"]);
  assert.match(f.calls.logs[0], /required drop absent/); assert.equal(readLibrary(f.env).clips.length, 1);
});

test("an index write failure rolls back own copies and leaves the original available for retry", async () => {
  const f = fixture(); fs.writeFileSync(libraryDir(f.env), "blocked index directory");
  const out = await addOwnBroll(f.args);
  assert.equal(out.results[0].status, "rejected");
  assert.equal(fs.readFileSync(f.file, "utf8"), "original camera bytes");
  assert.deepEqual(fs.readdirSync(path.join(f.env.REEL_BROLL_OWN, "clips")), []);
  assert.deepEqual(fs.readdirSync(path.join(f.env.REEL_BROLL_OWN, "originals")), []);
  fs.rmSync(libraryDir(f.env));
  assert.equal((await addOwnBroll(f.args)).approved.length, 1);
});

test("dry run lists metadata but creates no bank, original copies or process/vision calls", async () => {
  const f = fixture(); f.deps.conformStockClip = fail; f.deps.runFn = fail; f.deps.checkRunwayVideo = fail;
  const out = await addOwnBroll({ ...f.args, dryRun: true, action: "rolls", scene: "beach" });
  assert.equal(out.approved.length, 0); assert.equal(out.results[0].status, "dry-run");
  assert.match(f.calls.logs[0], /coconut.*rolls.*beach/);
  assert.equal(fs.existsSync(libraryDir(f.env)), false); assert.equal(fs.existsSync(f.env.REEL_BROLL_OWN), false);
  assert.equal(fs.readFileSync(f.file, "utf8"), "original camera bytes");
});

test("metadata overrides require one expanded video and invalid inputs fail before import", async () => {
  const f = fixture();
  await assert.rejects(addOwnBroll({ deps: f.deps }), /at least one/);
  await assert.rejects(addOwnBroll({ inputs: [path.join(f.dir, "missing")], deps: f.deps }), /ENOENT/);
  const text = path.join(f.dir, "notes.txt"); fs.writeFileSync(text, "notes");
  await assert.rejects(addOwnBroll({ inputs: [text], deps: f.deps }), /no video files/);
  fs.writeFileSync(path.join(f.dir, "coffee.mp4"), "coffee");
  await assert.rejects(addOwnBroll({ inputs: [f.dir], shows: "coconut", deps: f.deps }), /single video/);
  assert.equal(fs.existsSync(libraryDir(f.env)), false);
});

test("relative own paths follow the own-folder override and reuse still re-cuts and checks the exact interval", async () => {
  const f = fixture(), [clip] = (await addOwnBroll(f.args)).approved;
  const moved = path.join(f.dir, "other-mac-own"); fs.renameSync(f.env.REEL_BROLL_OWN, moved); f.env.REEL_BROLL_OWN = moved;
  assert.equal(ownLibraryDir(f.env), moved); assert.equal(ownLibraryDir({}), path.join(os.homedir(), "Reels", "B-roll library", "own"));
  assert.ok(fs.existsSync(libraryClipPath(clip, f.env, "originalFile")));
  const accepted = await findLibraryClip(f.find);
  assert.equal(accepted.libraryId, clip.id); assert.equal(accepted.source, "library"); assert.equal(accepted.licence.provider, "own");
  assert.deepEqual(f.calls.checks.slice(1).map((c) => !!c.eventOnly), [true, false]);
  assert.deepEqual(f.calls.checks.slice(1).map((c) => c.shot.duration), [6, 1.6]);
  assert.equal(f.calls.trims[0].duration, 1.6); assert.equal(f.calls.checks.at(-1).inPoint, f.calls.trims[0].options.inPoint);
  assert.equal(fs.readFileSync(accepted.file, "utf8"), "trimmed interval");
  assert.equal(readLibrary(f.env).clips[0].usedIn.length, 1);
  assert.equal(await findLibraryClip(f.find), null, "no same-reel reuse");
});

test("legacy absolute paths remain readable for both stock and own clips", async () => {
  for (const source of ["pexels", "own"]) {
    const f = fixture(), clip = candidate(f, "legacy", { source }); writeIndex(f, [clip]);
    assert.equal(libraryClipPath(clip, f.env), clip.file);
    assert.equal((await findLibraryClip(f.find)).libraryId, clip.id);
  }
});

test("ranking prefers own, then action matches, then least recent use (never-used first)", () => {
  const c = (id, source, description, date) => ({ id, source, description, usedIn: date ? [{ date }] : [] });
  const clips = [c("stock", "pexels", "drops onto sand"), c("own-other", "own", "rolls on table"),
    c("own-new", "own", "dropping onto sand", "2026-09-01"), c("own-old", "own", "drops onto sand", "2026-08-01"), c("own-unused", "own", "drops onto sand")];
  assert.deepEqual(rankLibraryClips(clips, pick).map((c) => c.id), ["own-unused", "own-old", "own-new", "own-other", "stock"]);
  assert.equal(clips[0].id, "stock", "ranking is pure");
});

test("lookup ranks before limiting, tries beyond two matches, and stops at twelve", async () => {
  const f = fixture(), clips = Array.from({ length: 13 }, (_, i) => candidate(f, `stock-${i}`));
  const own = candidate(f, "own-last", { source: "own" }); writeIndex(f, [...clips, own]);
  const attempted = [];
  f.deps.checkRunwayVideo = async ({ file }) => { attempted.push(path.basename(file)); return { ok: false }; };
  assert.equal(await findLibraryClip(f.find), null);
  assert.equal(attempted.length, 12); assert.match(attempted[0], /own-last/); assert.match(attempted[11], /stock-10/);
  const g = fixture(), three = [0, 1, 2].map((i) => candidate(g, `clip-${i}`)); writeIndex(g, three);
  g.deps.checkRunwayVideo = async ({ file }) => file.includes("clip-2") ? verdict : { ok: false };
  assert.equal((await findLibraryClip(g.find)).libraryId, "clip-2");
});

test("own ranking keeps subject, duration and ten-reel reuse eligibility rules", async () => {
  const f = fixture(), old = path.join(f.dir, "old-reel");
  const recent = candidate(f, "recent", { source: "own", usedIn: [{ reel: old, date: "2026-01-01" }] });
  const wrong = candidate(f, "wrong", { source: "own", subjectWords: ["coffee"] });
  const short = candidate(f, "short", { source: "own", duration: 1 });
  writeIndex(f, [recent, wrong, short], [old, ...Array.from({ length: 9 }, (_, i) => path.join(f.dir, `reel-${i}`))]);
  assert.equal(await findLibraryClip(f.find), null); assert.equal(f.calls.checks.length, 0);
  const bank = readLibrary(f.env); bank.reels.push(path.join(f.dir, "next-reel")); writeIndex(f, bank.clips, bank.reels);
  assert.equal((await findLibraryClip(f.find)).libraryId, "recent");
});

test("a trimmed own clip failure is never used and lookup proceeds to the next clip", async () => {
  const f = fixture(); writeIndex(f, [candidate(f, "first", { source: "own" }), candidate(f, "second", { source: "own" })]);
  f.deps.checkRunwayVideo = async ({ file, eventOnly }) => !eventOnly && file.includes("first") ? { ...verdict, ok: false } : verdict;
  assert.equal((await findLibraryClip(f.find)).libraryId, "second");
  assert.equal(readLibrary(f.env).clips[0].usedIn.length, 0);
});

test("shotlist has 48 filmable shots across eight worlds with framing and exclusions", () => {
  const f = fixture(), worlds = brollShotlist({ deps: f.deps }), shots = worlds.flatMap((w) => w.shots);
  assert.equal(worlds.length, 8); assert.equal(shots.length, 48);
  assert.deepEqual(worlds.map((w) => w.world), ["truck", "phone", "desk", "coffee", "gym", "coaching", "home", "jungle-reel props"]);
  for (const s of shots) {
    assert.ok(["shows", "action", "scene", "framing", "exclusion"].every((k) => typeof s[k] === "string" && s[k].length));
    assert.match(s.exclusion, /faces.*private.*earnings.*violence.*rope/);
  }
  assert.ok(!shots.some((s) => s.shows.includes("rope")));
  assert.equal(listPresets().includes("broll-shotlist"), false);
});

test("--missing requires an approved own clip with the action and an existing resolved file", async () => {
  const f = fixture(); await addOwnBroll(f.args);
  let missing = brollShotlist({ missing: true, deps: f.deps }).flatMap((w) => w.shots);
  assert.equal(missing.length, 47);
  assert.ok(!missing.some((s) => s.shows === "coconut" && s.action === "drops onto sand"));
  assert.ok(missing.some((s) => s.shows === "coconut" && s.action === "rolls to a stop on sand"));
  const clip = readLibrary(f.env).clips[0], brief = { shows: "coconut", action: "drops onto sand", scene: "sand" };
  assert.equal(ownClipCovers({ ...clip, source: "pexels" }, brief), false);
  assert.equal(ownClipCovers({ ...clip, approvedAt: undefined }, brief), false);
  assert.equal(ownClipCovers({ ...clip, action: "" }, brief), false);
  assert.equal(ownClipCovers({ ...clip, action: "sets down on mud" }, { ...brief, action: "set down on mud" }), true);
  assert.equal(ownClipCovers({ ...clip, action: "drops down on mud" }, { ...brief, action: "set down on mud" }), false);
  fs.rmSync(libraryClipPath(clip, f.env));
  missing = brollShotlist({ missing: true, deps: f.deps }).flatMap((w) => w.shots);
  assert.equal(missing.length, 48);
});

test("stock fill counts approved own proxies via their relative paths", async () => {
  const f = fixture(); await addOwnBroll(f.args);
  const bank = readLibrary(f.env), clip = bank.clips[0];
  writeIndex(f, [clip, { ...clip, id: "another-angle" }, { ...clip, id: "third-angle" }]);
  f.deps.search = fail;
  const out = await fillBrollLibrary({ subjects: ["coconut"], deps: f.deps });
  assert.match(out.subjects[0].skipped, /3 approved clips/);
});

test("CLI wires both commands, options, help and dry-run without importing anything", async () => {
  const f = fixture(), lines = [], original = console.log, libraryEnv = process.env.REEL_BROLL_LIBRARY;
  try {
    process.env.REEL_BROLL_LIBRARY = f.env.REEL_BROLL_LIBRARY;
    console.log = (...s) => lines.push(s.join(" "));
    await main(["--help"]); await main(["broll-add", "--help"]); await main(["broll-shotlist", "--help"]);
    const dry = await main(["broll-add", f.file, "--shows", "cream", "--action", "squeezed onto palm", "--scene", "beach", "--dry-run"]);
    assert.equal(dry.results[0].shows, "cream"); assert.equal(dry.results[0].action, "squeezed onto palm");
    assert.equal(dry.approved.length, 0);
    assert.equal((await main(["broll-shotlist"])).length, 8);
    assert.equal((await main(["broll-shotlist", "--missing"])).flatMap((w) => w.shots).length, 48);
  } finally {
    console.log = original;
    if (libraryEnv === undefined) delete process.env.REEL_BROLL_LIBRARY; else process.env.REEL_BROLL_LIBRARY = libraryEnv;
  }
  assert.match(lines.join("\n"), /reel broll-add/); assert.match(lines.join("\n"), /reel broll-shotlist/);
  assert.match(lines.join("\n"), /REEL_BROLL_OWN/); assert.match(lines.join("\n"), /--missing/);
  assert.equal(fs.existsSync(libraryDir(f.env)), false); assert.equal(fs.existsSync(f.env.REEL_BROLL_OWN), false);
});
