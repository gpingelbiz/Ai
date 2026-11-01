import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sceneSegments, thumbnailFeatures, classifySegments, segmentFeatures, detectInserts, INSERT_VERSION, loadInsertFlags, visibleInsertIntersections, insertWarnings, featureprintBinary, analyzeSpeakerInserts } from "../src/speaker-inserts.mjs";
import { run, writeJSON } from "../src/util.mjs";
import { parseSpeakerArgs, speakerMain, analyzeSpeaker } from "../src/speaker.mjs";
import { indexSources } from "../src/speaker-index.mjs";
import { speakerQC } from "../src/speaker-qc.mjs";

function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inserts-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const segments = Array.from({ length: 12 }, (_, i) => ({ start: i * 20, end: i * 20 + 3 }));
const features = () => segments.map((_, i) => ({ signature: i % 2 ? [0.2, 0.3] : [0.1, 0.2], method: "thumbnail", flatness: 0.2, edge: 0.2, textArea: 0 }));
const flag = (start, end, kind = "insert") => ({ start, end, kind, confidence: 0.8, reason: "A rare original picture" });

test("thumbnail features are deterministic and distinguish flat fields from edges", () => {
  const flat = thumbnailFeatures(Buffer.alloc(432, 128));
  assert.equal(flat.flatness, 1); assert.equal(flat.edge, 0); assert.equal(flat.signature.length, 432);
  const noisy = thumbnailFeatures(Array.from({ length: 432 }, (_, k) => Math.floor(k / 3) % 2 ? 255 : 0));
  assert.ok(noisy.edge > 0.4); assert.ok(noisy.flatness < 0.6);
  assert.throws(() => thumbnailFeatures([0]), /16x9/);
  assert.throws(() => thumbnailFeatures(Array(432).fill(NaN)), /16x9/);
});

test("sceneSegments finds two real hard cuts and preserves source-clock slice boundaries", async (t) => {
  const file = path.join(temp(t), "cuts.mp4");
  await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=black:s=64x36:r=10:d=0.8[b];color=white:s=64x36:r=10:d=0.8[w];color=red:s=64x36:r=10:d=0.8[r];[b][w][r]concat=n=3:v=1:a=0", "-c:v", "libx264", "-pix_fmt", "yuv420p", file], { capture: true });
  const scenes = await sceneSegments(file, { start: 0, end: 2.4 });
  assert.deepEqual(scenes, [{ start: 0, end: 0.8 }, { start: 0.8, end: 1.6 }, { start: 1.6, end: 2.4 }]);
  const sliced = await sceneSegments(file, { start: 0.4, end: 2 });
  assert.deepEqual(sliced, [{ start: 0.4, end: 0.8 }, { start: 0.8, end: 1.6 }, { start: 1.6, end: 2 }]);
});

test("scene parsing deduplicates cuts, rejects invalid ranges and seeks before opening source", async () => {
  const scenes = await sceneSegments("source.mp4", { start: 100, end: 110, run: async (cmd, args) => {
    assert.equal(cmd, "ffmpeg"); assert.ok(args.indexOf("-ss") < args.indexOf("-i"));
    return { err: "pts_time:2 pts_time:2 pts_time:5 pts_time:11" };
  } });
  assert.deepEqual(scenes, [{ start: 100, end: 102 }, { start: 102, end: 105 }, { start: 105, end: 110 }]);
  await assert.rejects(sceneSegments("x", { start: 2, end: 1 }), /invalid/);
  await assert.rejects(sceneSegments("x", { start: 0, end: 1, threshold: 0 }), /invalid/);
});

test("recurring room angles are unflagged; rare photo, text-heavy slide and flat title card are suggestions", () => {
  const fs = features();
  assert.deepEqual(classifySegments(segments, fs), []);
  fs[3] = { ...fs[3], signature: [0.9, 0.9] };
  fs[6] = { ...fs[6], signature: [0.8, 0], textArea: 0.12 };
  fs[9] = { ...fs[9], signature: [0, 0.9], textArea: 0.1, flatness: 0.95, edge: 0.02 };
  const flags = classifySegments(segments, fs);
  assert.deepEqual(flags.map((x) => x.kind), ["insert", "slide", "title-card"]);
  assert.ok(flags.every((x) => x.confidence >= 0.5 && x.confidence <= 1 && /recurring room/.test(x.reason)));
  assert.deepEqual(classifySegments([], []), []);
  assert.throws(() => classifySegments(segments, []), /one feature/);
  assert.deepEqual(classifySegments(segments, segments.map(() => ({}))), []);
});

test("short scenes weigh more; adjacent lookalike inserts cannot establish room recurrence", () => {
  const fs = features(); fs[3] = { ...fs[3], signature: [0.31, 0.41] };
  const short = classifySegments(segments, fs).find((x) => x.start === 60);
  const longSegments = segments.map((s) => ({ ...s, end: s.start + 8 }));
  const long = classifySegments(longSegments, fs).find((x) => x.start === 60);
  assert.ok(short.confidence > long.confidence);
  const montage = segments.map((s) => ({ ...s })); montage[4] = { start: 63, end: 65 };
  fs[4] = { ...fs[3] };
  assert.equal(classifySegments(montage, fs).filter((x) => x.start === 60 || x.start === 63).length, 2);
});

test("fallback samples real original thumbnails, logs Vision failure once, removes temporary frames", async (t) => {
  const file = path.join(temp(t), "source.mp4"), logs = [];
  await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=white:s=64x36:r=10:d=0.5", "-c:v", "libx264", file], { capture: true });
  const result = await segmentFeatures(file, [{ start: 0, end: 0.4 }], { binary: async () => null, log: (s) => logs.push(s) });
  assert.equal(logs.length, 1); assert.equal(result[0].method, "thumbnail"); assert.equal(result[0].flatness, 1);
  assert.deepEqual(await segmentFeatures(file, [], { binary: () => assert.fail() }), []);
});

test("injected Vision returns normalized signatures and retains upright geometry and text observations", async () => {
  const result = await segmentFeatures("source", segments.slice(0, 2), { binary: async () => "vision", run: async (cmd, args) => {
    assert.equal(cmd, "vision"); assert.deepEqual(args, ["source", "1.5", "21.5"]);
    return { out: JSON.stringify({ frames: [1.5, 21.5].map((t) => ({ t, width: 540, height: 960, signature: [3, 4], thumbnail: Array(432).fill(128), textArea: 0.12 })) }) };
  } });
  assert.deepEqual(result[0].signature, [0.6, 0.8]); assert.equal(result[0].method, "vision"); assert.equal(result[0].height, 960); assert.equal(result[0].textArea, 0.12);
});

test("Vision compilation failure is optional and injectable", async (t) => {
  const result = await featureprintBinary({ cacheDir: temp(t), run: async () => { throw new Error("no SDK"); } });
  assert.equal(result, null);
});

test("insert cache is independent, reused by key/version, and stale or corrupt records recompute", async (t) => {
  const indexDir = temp(t), row = { id: "talk", key: "content-key", duration: 240 };
  let calls = 0;
  const deps = { indexDir, scenes: async () => { calls++; return segments; }, features: async () => { const f = features(); f[3].signature = [0.9, 0.9]; return f; } };
  const flags = await detectInserts("original", row, deps);
  assert.equal(flags.length, 1); assert.equal(calls, 1);
  const dest = path.join(indexDir, "content-key.inserts.json"), cache = JSON.parse(fs.readFileSync(dest));
  assert.deepEqual(Object.keys(cache), ["sourceId", "version", "inserts"]); assert.equal(cache.version, INSERT_VERSION);
  assert.deepEqual(await detectInserts("original", row, deps), flags); assert.equal(calls, 1);
  writeJSON(dest, { ...cache, version: 0 }); await detectInserts("original", row, deps); assert.equal(calls, 2);
  fs.writeFileSync(dest, "{"); await detectInserts("original", row, deps); assert.equal(calls, 3);
  await detectInserts("new-original", { ...row, key: "new-key" }, deps); assert.equal(calls, 4);
  assert.ok(!fs.existsSync(path.join(indexDir, "content-key.words.json")));
});

test("analysis fails open once without caching a false empty success", async (t) => {
  const indexDir = temp(t), logs = [];
  const row = { id: "talk", key: "safe", duration: 10 };
  assert.deepEqual(await detectInserts("source", row, { indexDir, scenes: async () => { throw new Error("decoder unavailable\nprivate details"); }, log: (s) => logs.push(s) }), []);
  assert.equal(logs.length, 1); assert.doesNotMatch(logs[0], /private details/); assert.ok(!fs.existsSync(path.join(indexDir, "safe.inserts.json")));
  await detectInserts("source", { ...row, key: "../escape" }, { indexDir, log: (s) => logs.push(s) }); assert.equal(logs.length, 2);
});

function picturePlan() { return { canvas: { fps: 30 }, items: [{ id: "s5", kind: "clip", sourceId: "talk", in: 240, out: 250, outputStart: 10, outputEnd: 20 }], cutaways: [
  { id: "x1", over: "s5", sourceId: "room", in: 3, out: 5, outputStart: 12, outputEnd: 14 },
  { id: "x2", over: "s5", sourceId: "room", in: 6, out: 8, outputStart: 15, outputEnd: 17 },
] }; }

test("visible picture intersects source flags after subtracting cutaways; overlays never hide flags", () => {
  const p = picturePlan(); p.overlays = [{ at: "s5", outputStart: 10, outputEnd: 20 }];
  const flags = { talk: [flag(242, 244), flag(243, 248), flag(250, 252)], room: [flag(3.5, 4.5, "slide")] };
  const hits = visibleInsertIntersections(p, flags);
  assert.deepEqual(hits.map((h) => [h.itemId, h.start, h.end, h.outputStart, h.outputEnd]), [["x1", 3.5, 4.5, 12.5, 13.5], ["s5", 244, 245, 14, 15], ["s5", 247, 248, 17, 18]]);
  const warnings = insertWarnings(p, flags);
  assert.equal(warnings.length, 3); assert.equal(warnings[1].level, "warn"); assert.match(warnings[1].message, /item s5 shows a likely stock insert 244-245; cover it with a cutaway or trim/);
  assert.deepEqual(visibleInsertIntersections(p), []);
});

test("cutaway union handles contiguous, overlapping and full coverage; source clocks stay distinct", () => {
  const p = picturePlan(); p.cutaways.push({ id: "x3", over: "s5", sourceId: "room", in: 0, out: 10, outputStart: 10, outputEnd: 20 });
  assert.deepEqual(visibleInsertIntersections(p, { talk: [flag(240, 250)] }), []);
  const frameOnly = { canvas: { fps: 30 }, items: [{ id: "a", kind: "clip", sourceId: "talk", in: 2, out: 3, startFrame: 60, endFrame: 90 }] };
  assert.equal(visibleInsertIntersections(frameOnly, { talk: [flag(2, 3)] })[0].outputStart, 2);
});

test("load flags follows current source cache key, fails open per record and ignores obsolete versions", (t) => {
  const folder = temp(t), indexDir = path.join(folder, "work", "index"), logs = [];
  assert.deepEqual(loadInsertFlags(folder), {});
  writeJSON(path.join(indexDir, "sources.json"), { sources: { talk: { key: "now" }, old: { key: "old" }, corrupt: { key: "corrupt" }, unsafe: { key: "../escape" } } });
  writeJSON(path.join(indexDir, "now.inserts.json"), { version: INSERT_VERSION, inserts: [flag(1, 2)] });
  writeJSON(path.join(indexDir, "old.inserts.json"), { version: 0, inserts: [flag(1, 2)] });
  fs.writeFileSync(path.join(indexDir, "corrupt.inserts.json"), "{");
  assert.deepEqual(loadInsertFlags(folder, { log: (s) => logs.push(s) }), { talk: [flag(1, 2)] }); assert.equal(logs.length, 1);
});

test("QC emits advisory warnings for visible inserts even when media measurements fail", async () => {
  const p = picturePlan();
  const qc = await speakerQC("/tmp/unused.mp4", { resolvedPlan: p, manifest: { identity: {}, sources: [], rights: [] }, deps: { probe: async () => { throw new Error("synthetic failure"); }, inserts: { talk: [flag(246.12, 247.75)] } } });
  const warnings = qc.checks.filter((c) => c.code === "baked-insert");
  assert.equal(warnings.length, 1); assert.equal(warnings[0].level, "warn"); assert.equal(warnings[0].start, 247);
});

test("inserts CLI parses --source and dispatches analysis without drafting", async () => {
  assert.equal(parseSpeakerArgs(["inserts", "/tmp/client", "--source", "stage"]).command, "inserts");
  let seen;
  await speakerMain(["inserts", "/tmp/client", "--source", "stage"], { analyzeInserts: async (...args) => { seen = args; }, print: () => {} });
  assert.equal(seen[0], "/tmp/client"); assert.equal(seen[1].source, "stage");
});

async function clientFixture(t) {
  const folder = temp(t);
  const manifest = { schemaVersion: 1, clientId: "example", identity: { name: "Avery Example" }, brand: { file: "brand.json" }, brief: {}, proof: [], rights: [{ id: "r", status: "approved" }], music: [], sources: ["stage", "podcast", "webinar", "interview", "testimonial", "broll", "photo"].map((kind) => ({ id: kind, path: `${kind}.mp4`, kind, audio: "none", rights: "r" })) };
  writeJSON(path.join(folder, "speaker-manifest.json"), manifest); writeJSON(path.join(folder, "brand.json"), { name: "Avery Example" });
  for (const s of manifest.sources) fs.writeFileSync(path.join(folder, s.path), s.id);
  await indexSources(folder, manifest, { brand: { name: "Avery Example" }, engine: "hyperframes", probe: async () => ({ duration: 240, hasVideo: true, width: 1920, height: 1080, audioStreams: [] }), print: () => {} });
  return folder;
}

test("standalone inserts filters talk source kinds and --source without reactions, ASR or candidates", async (t) => {
  const folder = await clientFixture(t), seen = [];
  const deps = { inserts: async (_, row, options) => { seen.push([row.id, options.sourceId, options.indexDir]); return [flag(60, 63)]; }, print: () => {} };
  const result = await analyzeSpeakerInserts(folder, {}, deps);
  assert.deepEqual(Object.keys(result), ["stage", "podcast", "webinar", "interview"]); assert.equal(seen.length, 4);
  assert.equal(seen[0][2], path.join(folder, "work", "index"));
  seen.length = 0; await analyzeSpeakerInserts(folder, { source: "webinar" }, deps); assert.equal(seen.length, 1);
  await assert.rejects(analyzeSpeakerInserts(folder, { source: "missing" }, deps), /unknown source/);
});

test("candidates attach overlapping insert suggestions to primary and alternate entries", async (t) => {
  const folder = await clientFixture(t);
  const list = await analyzeSpeaker(folder, { source: "stage" }, { print: () => {}, shots: async () => [], inserts: async () => [flag(60, 63), flag(90, 92)], candidates: async () => [{ id: "c1", kind: "one_liner", sourceId: "stage", in: 58, out: 65, text: "Exact source words", flags: [], score: 80, alternates: [{ id: "c2", kind: "one_liner", sourceId: "stage", in: 90, out: 91, text: "Exact source words", flags: [], score: 70 }] }] });
  assert.deepEqual(list[0].inserts, [flag(60, 63)]); assert.deepEqual(list[0].alternates[0].inserts, [flag(90, 92)]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, "work", "candidates", "all.json")))[0].inserts.length, 1);
});

test("malformed cache fields recompute without admitting invalid time ranges into review", async (t) => {
  const indexDir = temp(t), dest = path.join(indexDir, "safe.inserts.json");
  writeJSON(dest, { version: INSERT_VERSION, inserts: [{ start: 3, end: 2, kind: "insert", confidence: 2, reason: "broken" }] });
  let calls = 0;
  const flags = await detectInserts("original", { id: "talk", key: "safe", duration: 240 }, { indexDir, scenes: async () => { calls++; return segments; }, features: async () => features() });
  assert.equal(calls, 1); assert.deepEqual(flags, []);
  const logs = [];
  await detectInserts("original", { id: "talk", key: "incomplete", duration: 240 }, { indexDir, scenes: async () => segments, features: async () => segments.map(() => ({})), log: (s) => logs.push(s) });
  assert.equal(logs.length, 1); assert.ok(!fs.existsSync(path.join(indexDir, "incomplete.inserts.json")));
});

test("analysis caches legitimate empty results without repeating work", async (t) => {
  const indexDir = temp(t), row = { id: "talk", key: "empty", duration: 240 };
  const deps = { indexDir, scenes: async () => segments, features: async () => features() };
  assert.deepEqual(await detectInserts("original", row, deps), []);
  assert.deepEqual(await detectInserts("original", row, { ...deps, scenes: () => assert.fail("empty cache must be reused") }), []);
});
