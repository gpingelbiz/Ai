import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../src/util.mjs";
import { outputSpan, planDuration, usedAssets, rightsChecks, identityProblems, gapsOutsideCards, captionEnd, speakerQC, writeQC } from "../src/speaker-qc.mjs";

const plan = () => ({ schemaVersion: 1, version: "full", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 }, items: [
  { id: "i01", kind: "clip", sourceId: "s1", in: 10, out: 13, start: 0, end: 3, role: "core" },
  { id: "i02", kind: "card", start: 3, end: 8, duration: 5, role: "booking", card: { type: "booking" } },
], overlays: [{ id: "o1", at: "i01", start: 1, end: 2, card: { type: "quote", proofId: "p1" } }] });
const manifest = () => ({ identity: { name: "Client", bookingMode: "direct" }, sources: [{ id: "s1", path: "footage/s1.mp4", rights: "r1" }], proof: [{ id: "p1", rights: "r1", sourceId: "s1" }], rights: [{ id: "r1", status: "approved" }] });
const deps = (over = {}) => ({
  probe: async () => ({ duration: 8, width: 1920, height: 1080, fps: 30, pixFmt: "yuv420p", codec: "h264", hasAudio: true }),
  encoding: async () => ({ video: { avg_frame_rate: "30/1" }, audio: { codec_name: "aac", sample_rate: "48000", channels: 2 } }),
  measureLoudness: async () => ({ i: -14, tp: -1 }), silences: async () => [], blackGaps: async () => [], ...over,
});
function captions(dir, end = "00:00:02.500") {
  const files = { srt: path.join(dir, "captions.srt"), vtt: path.join(dir, "captions.vtt") };
  for (const file of Object.values(files)) fs.writeFileSync(file, `1\n00:00:00.100 --> ${end}\nExact words.\n`);
  return files;
}

test("speaker resolved spans and duration use output timing and reject invalid spans", () => {
  assert.deepEqual(outputSpan({ id: "i", outputStart: 1, outputEnd: 2, in: 100, out: 101 }), { start: 1, end: 2 });
  assert.deepEqual(outputSpan({ output: { start: 0, end: 2 } }), { start: 0, end: 2 });
  assert.equal(planDuration(plan()), 8);
  assert.throws(() => outputSpan({ id: "broken", start: 2, end: 1 }), /broken/);
  assert.throws(() => planDuration({ items: [] }), /no items/);
});

test("speaker referenced proof, testimonial sources and missing rights are checked", () => {
  const p = plan(), m = manifest();
  p.overlays.push({ id: "o2", card: { type: "logo-wall", logos: ["logo"] } });
  m.proof.push({ id: "logo", rights: "missing" }, { id: "unused", rights: "unknown" });
  assert.deepEqual(usedAssets(p, m), { sourceIds: ["s1"], proofIds: ["p1", "logo"] });
  assert.equal(rightsChecks(p, m).find((c) => c.assetId === "logo").level, "warn");
  assert.equal(rightsChecks(p, m, true).find((c) => c.assetId === "logo").level, "fail");
  p.items[0].sourceId = "not-found";
  assert.match(rightsChecks(p, m)[0].message, /unknown ID/);
});

test("speaker identity checks detect display copy while allowing operator filesystem paths", () => {
  assert.deepEqual(identityProblems({ identity: { name: "Greg Pingel" }, brand: { file: "/Users/gregpingel/Clients/brand.json" } }), ["identity.name"]);
  for (const text of ["@officialgregpingel", "PINGEL", "Greg Pingel"]) assert.equal(identityProblems({ card: { text } }).length, 1);
  assert.equal(identityProblems({ source: { file: "presets/pingel-brand.json" } }).length, 1);
});

test("speaker gap exemptions subtract only card spans, including straddling and adjacent cards", () => {
  assert.deepEqual(gapsOutsideCards([{ start: 2, end: 8 }], plan()), []);
  assert.deepEqual(gapsOutsideCards([{ start: 0, end: 8 }], plan()), [{ start: 0, end: 3 }]);
  assert.deepEqual(gapsOutsideCards([{ start: 0, end: 1.5 }], plan()), []);
});

test("speaker caption end accepts SRT/VTT hours and minutes and uses the latest cue", () => {
  assert.equal(captionEnd("00:00:01,000 --> 00:00:03,200\nHi\n00:01.000 --> 00:02.000"), 3.2);
  assert.equal(captionEnd("WEBVTT\n\n01:00:00.000 --> 01:00:01.000\nHi"), 3601);
  assert.equal(captionEnd("junk"), null);
});

test("speaker QC measures encoding, thresholds, card gaps, captions and final rights", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-qc-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { resolvedPlan: plan(), manifest: manifest(), captionFiles: captions(dir), deps: deps() };
  let res = await speakerQC("draft.mp4", options);
  assert.equal(res.ok, true); writeQC(dir, res);
  assert.match(fs.readFileSync(path.join(dir, "qc.txt"), "utf8"), /Speaker QC: OK/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "qc.json"))).ok, true);
  options.manifest.rights[0].status = "pending";
  res = await speakerQC("draft.mp4", options);
  assert.equal(res.ok, true); assert.ok(res.checks.some((c) => c.level === "warn"));
  res = await speakerQC("draft.mp4", { ...options, final: true }); assert.equal(res.ok, false);
  res = await speakerQC("draft.mp4", { ...options, deps: deps({ measureLoudness: async () => ({ i: -12.9, tp: -0.9 }), silences: async () => [{ start: 0, end: 2 }], blackGaps: async () => [{ start: 3, end: 8 }] }) });
  for (const code of ["loudness", "peak", "silence"]) assert.equal(res.checks.find((c) => c.code === code).level, "fail");
  assert.equal(res.checks.find((c) => c.code === "black").level, "pass");
  captions(dir, "00:00:08.000");
  res = await speakerQC("draft.mp4", options); assert.equal(res.checks.find((c) => c.code === "captions-vtt").level, "fail");
  fs.rmSync(options.captionFiles.srt);
  res = await speakerQC("draft.mp4", options); assert.equal(res.checks.find((c) => c.code === "captions-srt").level, "fail");
});

test("speaker QC reports measurement failures and an absent or short booking card", async () => {
  const p = plan(); p.items[1].end = 7;
  const res = await speakerQC("missing.mp4", { resolvedPlan: p, manifest: manifest(), deps: deps({ probe: async () => { throw new Error("missing file"); } }) });
  assert.equal(res.ok, false);
  assert.match(res.checks.find((c) => c.code === "media").message, /missing file/);
  assert.equal(res.checks.find((c) => c.code === "booking").level, "fail");
});

test("speaker QC decodes tiny generated normal, quiet and silent black files", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-qc-media-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cap = captions(dir, "00:00:01.500"), p = plan();
  p.items = [{ id: "i01", kind: "clip", sourceId: "s1", start: 0, end: 2 }]; p.overlays = [];
  const results = {};
  for (const mode of ["normal", "quiet", "black"]) {
    const file = path.join(dir, `${mode}.mp4`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", mode === "black" ? "color=black:s=160x90:r=30" : "testsrc2=s=160x90:r=30", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-af", mode === "normal" ? "loudnorm=I=-14:TP=-1:LRA=11" : mode === "quiet" ? "volume=0.05" : "volume=0", "-ar", "48000", "-ac", "2", "-c:a", "aac", file], { capture: true });
    results[mode] = await speakerQC(file, { resolvedPlan: p, manifest: manifest(), captionFiles: cap });
  }
  assert.equal(results.normal.checks.find((c) => c.code === "loudness").level, "pass");
  assert.equal(results.quiet.checks.find((c) => c.code === "loudness").level, "fail");
  assert.equal(results.normal.checks.find((c) => c.code === "dimensions").level, "fail");
  for (const code of ["black", "silence"]) assert.equal(results.black.checks.find((c) => c.code === code).level, "fail");
});

test("speaker QC rejects wrong duration, rate, pixel format, codec, audio and identity", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-qc-format-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = plan(); p.items[1].card.text = "@officialgregpingel";
  const res = await speakerQC("draft.mp4", { resolvedPlan: p, manifest: manifest(), captionFiles: captions(dir), deps: deps({
    probe: async () => ({ duration: 8.05, width: 1920, height: 1080, fps: 24, pixFmt: "yuv444p", codec: "hevc" }),
    encoding: async () => ({ video: { avg_frame_rate: "24/1" }, audio: { codec_name: "mp3", sample_rate: "44100", channels: 1 } }),
  }) });
  for (const code of ["duration", "fps", "pixel-format", "video-codec", "audio", "identity"]) assert.equal(res.checks.find((c) => c.code === code).level, "fail", code);
});
