import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addNewFiles, initManifest, loadManifest, validateManifest, assertNoGreg, assetPath } from "../src/speaker-intake.mjs";
import { sourceCacheKey, indexSources, loadSourceIndex, probeSource } from "../src/speaker-index.mjs";
import { speakerPreset } from "../src/brandkit.mjs";
import { writeJSON, run } from "../src/util.mjs";
import { runSpeaker, planSummary, composeSpeaker } from "../src/speaker.mjs";
import { resolvePlan } from "../src/speaker-compile.mjs";

const brand = { name: "Jane Doe", fonts: { display: "Playfair Display", body: "Montserrat" }, colors: { text: "#FFFFFF", accent: "#FFB27D", bg: "#111111" } };
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-intake-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, "footage"));
  fs.writeFileSync(path.join(folder, "footage", "talk.mp4"), "test footage");
  writeJSON(path.join(folder, "brand.json"), brand);
  const manifest = { schemaVersion: 1, clientId: "jane", identity: { name: "Jane Doe", bookingMode: "direct", roleLine: "Speaker" }, brand: { file: "brand.json" }, sources: [{ id: "talk", path: "footage/talk.mp4", kind: "stage", audio: "ok", rights: "r1" }], proof: [], rights: [{ id: "r1", status: "approved" }], music: [] };
  writeJSON(path.join(folder, "speaker-manifest.json"), manifest);
  return { folder, manifest };
}

test("speaker manifest validates good input and reports unreadable JSON", (t) => {
  const { folder, manifest } = fixture(t);
  assert.deepEqual(loadManifest(folder), { manifest, problems: [] });
  fs.writeFileSync(path.join(folder, "speaker-manifest.json"), "{");
  assert.match(loadManifest(folder).problems[0].message, /cannot read/);
});

test("speaker manifest names missing files, duplicate ids, bad enums and dangling references", (t) => {
  const { folder, manifest } = fixture(t);
  manifest.sources[0].path = "footage/missing.mp4";
  manifest.sources[0].kind = "imaginary";
  manifest.sources[0].audio = "maybe";
  manifest.sources.push({ ...manifest.sources[0], rights: "gone" });
  manifest.proof.push({ id: "p1", kind: "testimonial-video", sourceId: "missing", rights: "gone" });
  const problems = validateManifest(folder, manifest);
  for (const re of [/file not found/, /duplicate/, /source.kind/, /source.audio/, /rights id/, /unknown proof sourceId/]) assert.ok(problems.some((p) => re.test(p.message)), String(re));
});

test("pending/unknown rights are draft warnings, and invalid rights statuses fail", (t) => {
  const { folder, manifest } = fixture(t);
  for (const status of ["pending", "unknown"]) {
    manifest.rights[0].status = status;
    assert.deepEqual(validateManifest(folder, manifest).map((p) => p.level), ["warn"]);
  }
  manifest.rights[0].status = "yes";
  assert.ok(validateManifest(folder, manifest).some((p) => p.level === "error"));
});

test("relative assets reject traversal and escaping symlinks; explicit absolute assets work", (t) => {
  const { folder } = fixture(t);
  const outside = path.join(os.tmpdir(), `speaker-outside-${process.pid}.mp4`);
  fs.writeFileSync(outside, "outside"); t.after(() => fs.rmSync(outside, { force: true }));
  fs.symlinkSync(outside, path.join(folder, "footage", "link.mp4"));
  assert.throws(() => assetPath(folder, "../escape.mp4"), /escapes/);
  assert.throws(() => assetPath(folder, "footage/link.mp4"), /symlink escapes/);
  assert.equal(assetPath(folder, outside), outside);
});

test("init discovers media recursively, disambiguates ids, never overwrites and only appends new files", (t) => {
  const { folder } = fixture(t);
  fs.rmSync(path.join(folder, "speaker-manifest.json"));
  fs.mkdirSync(path.join(folder, "proof", "logos"), { recursive: true });
  fs.mkdirSync(path.join(folder, "footage", "podcast"));
  fs.writeFileSync(path.join(folder, "footage", "podcast", "talk.wav"), "audio");
  fs.writeFileSync(path.join(folder, "proof", "testimonial.mov"), "video");
  fs.writeFileSync(path.join(folder, "proof", "logos", "summit.png"), "logo");
  const made = initManifest(folder);
  assert.equal(made.added, 4);
  assert.equal(made.manifest.sources.length, 3);
  assert.equal(made.manifest.proof.length, 2);
  assert.ok(made.manifest.rights.every((r) => r.status === "unknown"));
  assert.ok(made.manifest.sources.some((s) => s.kind === "podcast"));
  assert.equal(new Set(made.manifest.sources.map((s) => s.id)).size, 3);
  assert.throws(() => initManifest(folder), /already exists/);
  const before = structuredClone(made.manifest);
  fs.writeFileSync(path.join(folder, "footage", "new portrait.mp4"), "new");
  const appended = addNewFiles(folder, before);
  assert.deepEqual(before, made.manifest, "caller manifest stays untouched");
  assert.deepEqual(appended.manifest.sources.slice(0, 3), before.sources);
  assert.equal(appended.added, 1);
  assert.equal(appended.manifest.sources.at(-1).new, true);
  assert.equal(initManifest(folder, { addNew: true }).added, 1);
  assert.equal(initManifest(folder, { addNew: true }).added, 0);
});

test("brand safety rejects all nested identity strings case-insensitively", () => {
  for (const text of ["Greg Pingel", "@officialgregpingel", "PINGEL", "A Pingel quotation", "/Users/gregpingel/Clients/Julee Gracey/brand.json"]) assert.throws(() => assertNoGreg({ cards: [{ text }] }), /brand safety/);
  assert.doesNotThrow(() => assertNoGreg({ name: "Julee Gracey", text: "Real words" }));
});

test("speaker preset is resolved, neutral and disables every automatic short-form treatment", () => {
  const preset = speakerPreset(brand);
  assert.doesNotThrow(() => assertNoGreg(preset));
  assert.equal(preset.extends, undefined);
  assert.equal(preset.brandFile, null);
  assert.equal(preset.brand.type.display.family, "Playfair Display");
  assert.equal(preset.colors.accent, brand.colors.accent);
  for (const key of ["captions", "coldOpen", "slams", "hook", "zooms", "broll", "framing", "reframe", "houseLooks"]) assert.equal(preset[key].enabled, false, key);
  assert.equal(preset.zooms.cadence.enabled, false);
  assert.deepEqual(preset.cuts, { silence: "off", badTakes: false, fillers: false, signOff: false, pad: 0.12 });
  assert.equal(preset.youtube.endSafe, 0);
  assert.equal(preset.render.fps, 30);
  assert.equal(preset.lowerThird.name, "Jane Doe");
  assert.throws(() => speakerPreset({ ...brand, name: "" }), /name is missing/);
  assert.throws(() => speakerPreset({ ...brand, fonts: {} }), /display font is missing/);
  const v2 = preset.brand;
  assert.equal(speakerPreset(v2).brand.identity.name, "Jane Doe");
});

test("content cache key survives rename; changed bytes, engine, model, language and stream invalidate", (t) => {
  const { folder } = fixture(t), file = path.join(folder, "footage", "talk.mp4");
  const key = sourceCacheKey(file);
  const renamed = path.join(folder, "renamed.mp4"); fs.renameSync(file, renamed);
  assert.equal(sourceCacheKey(renamed), key);
  for (const opts of [{ engine: "elevenlabs" }, { language: "fr" }, { model: "small" }, { audioStream: 1 }, { prompt: "Jane" }]) assert.notEqual(sourceCacheKey(renamed, opts), key);
  fs.writeFileSync(renamed, "changed byte"); assert.notEqual(sourceCacheKey(renamed), key);
});

test("index caches ASR once, applies corrections on rerun, skips bad/none audio and detects stale bytes", async (t) => {
  const { folder, manifest } = fixture(t);
  const meta = { duration: 5, width: 1280, height: 720, hasAudio: true, hasVideo: true, audioStreams: [{ index: 1, default: true, channels: 2 }] };
  let calls = 0;
  const options = { brand: { ...brand, corrections: [{ from: "Janey", to: "Jane" }] }, transcribe: async () => { calls++; return [{ text: "Janey", start: 0, end: 1 }]; }, probe: async () => meta, audioEnvelope: async () => ({ step: 0.02, db: [-20] }), print: () => {} };
  const first = await indexSources(folder, manifest, options);
  assert.equal(calls, 1); assert.equal(first.sources.talk.words[0].text, "Jane");
  fs.renameSync(path.join(folder, manifest.sources[0].path), path.join(folder, "footage", "renamed.mp4"));
  manifest.sources[0].path = "footage/renamed.mp4";
  const cached = await indexSources(folder, manifest, options);
  assert.equal(calls, 1); assert.equal(cached.sources.talk.cached, true);
  assert.equal(loadSourceIndex(folder, manifest).sources.talk.words[0].text, "Jane");
  assert.equal(loadSourceIndex(folder, manifest, { brand: { ...brand, corrections: [{ from: "Janey", to: "Jane Doe" }] } }).sources.talk.words[1].text, "Doe");
  manifest.sources[0].audio = "bad";
  assert.throws(() => loadSourceIndex(folder, manifest), /audio intent changed/);
  const picture = await indexSources(folder, manifest, options);
  assert.equal(calls, 1); assert.deepEqual(picture.sources.talk.words, []);
  manifest.sources[0].audio = "none"; await indexSources(folder, manifest, options); assert.equal(calls, 1);
  fs.appendFileSync(path.join(folder, manifest.sources[0].path), "new bytes");
  assert.throws(() => loadSourceIndex(folder, manifest), /stale/);
});

test("render-only reuses cached ASR and writes draft warnings through the composition hook", async (t) => {
  const { folder, manifest } = fixture(t);
  manifest.rights[0].status = "pending";
  writeJSON(path.join(folder, "speaker-manifest.json"), manifest);
  const idx = await indexSources(folder, manifest, {
    brand, probe: async () => ({ duration: 2, width: 1280, height: 720, hasAudio: true, audioStreams: [{ index: 1 }] }),
    transcribe: async () => [{ text: "Real.", start: 0, end: 0.5 }], audioEnvelope: async () => ({ step: 0.02, db: [-20] }), print: () => {},
  });
  const plan = { schemaVersion: 1, clientId: "jane", version: "full", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 }, items: [{ id: "a", kind: "clip", sourceId: "talk", in: 0, out: 1, role: "core" }], overlays: [], cutaways: [] };
  writeJSON(path.join(folder, "work", "plans", "full.json"), plan);
  let composed = 0;
  const results = await runSpeaker(folder, { renderOnly: true, draft: true }, {
    index: () => { throw new Error("ASR must not run"); },
    compile: async (_folder, p, opts) => ({ base: path.join(folder, "work", "full", "base.mp4"), workDir: path.join(folder, "work", "full"), resolvedPlan: resolvePlan(p, { ...opts, index: idx }) }),
    compose: async (_dir, p, { tokens }) => { composed++; assert.equal(tokens.identity.name, "Jane Doe"); return { base: "fake" }; },
    loudness: async () => ({ i: -16, tp: -2, lra: 4 }), print: () => {},
  });
  assert.equal(composed, 1); assert.equal(results.length, 1);
  assert.match(fs.readFileSync(path.join(folder, "review", "full.warnings.txt"), "utf8"), /DRAFT.*NOT CLEARED[\s\S]*pending/);
  assert.equal(fs.existsSync(path.join(folder, "Publish")), false);
});

test("orchestrator leaves publication alone and validates missing plans and missing brand", async (t) => {
  const { folder, manifest } = fixture(t);
  await assert.rejects(runSpeaker(folder), /no speaker plan/);
  fs.rmSync(path.join(folder, "brand.json"));
  await assert.rejects(runSpeaker(folder), /file not found.*brand.json/);
  const summary = planSummary({ version: "full", items: [{ id: "a", kind: "clip", sourceId: "talk", role: "core", frames: 30 }], canvas: { fps: 30 }, duration: 1, frames: 30, problems: [] }, manifest);
  assert.deepEqual(summary.roles, { core: 1 });
  assert.deepEqual(summary.sourceIds, ["talk"]);
  assert.deepEqual(await composeSpeaker("/tmp/test", {}, { preset: speakerPreset(brand), tokens: speakerPreset(brand).brand }), { base: "/tmp/test/base.mp4" });
});

test("probeSource indexes audio-only media and channel layouts without requiring video", async (t) => {
  const { folder } = fixture(t), file = path.join(folder, "footage", "audio.wav");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=400:duration=0.2", "-ac", "2", file], { capture: true });
  const meta = await probeSource(file);
  assert.equal(meta.hasVideo, false); assert.equal(meta.hasAudio, true);
  assert.equal(meta.audioStreams[0].channels, 2); assert.ok(meta.duration > 0);
});
