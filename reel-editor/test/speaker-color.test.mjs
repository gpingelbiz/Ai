import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { measureClip } from "../src/cuts.mjs";
import { gradeOverrides, gradeSettings, gradePixel, gradeCube, gradeRanges, prepareGrade, lookOptions, fitGraph } from "../src/speaker-look.mjs";
import { compileVersion, fitGeometry } from "../src/speaker-compile.mjs";
import { hlgToSdrFilter, SDR_FILTER, SDR_TAGS } from "../src/hdr.mjs";
import { probeSource } from "../src/speaker-index.mjs";
import { run, writeJSON } from "../src/util.mjs";

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-color-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const ff = (args) => run("ffmpeg", ["-y", "-loglevel", "error", "-filter_threads", "1", ...args], { capture: true });
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Lossless native-depth neutral ramps isolate measurement precision from codec artefacts.
test("equivalent 8-bit and 10-bit ramps have normalized RGB exposure; daily finish retains legacy YAVG", async (t) => {
  const dir = temp(t), stats = [];
  for (const bits of [8, 10]) {
    const file = path.join(dir, `ramp-${bits}.mkv`), factor = bits === 10 ? 4 : 1;
    await ff(["-f", "lavfi", "-i", `nullsrc=s=96x96:r=30:d=0.5,format=yuv420p${bits === 10 ? "10le" : ""},geq=lum='${16 * factor}+${184 * factor}*X/(W-1)':cb=${128 * factor}:cr=${128 * factor}`, "-c:v", "ffv1", file]);
    stats.push(await measureClip(file, { duration: 0.5 }));
    if (bits === 10) {
      const legacy = await measureClip(file, { duration: 0.5, lumaMode: "signalstats" });
      assert.equal(legacy.luma, stats[1].diagnostics.nativeYavg / 255);
      assert.ok(legacy.luma > 1, "daily legacy domain is explicitly isolated from speaker grading");
    }
  }
  for (const s of stats) assert.ok(s.luma >= 0 && s.luma <= 1);
  assert.ok(Math.abs(stats[0].luma - stats[1].luma) < 2 / 255, JSON.stringify(stats));
  assert.ok(Math.abs(gradeSettings(stats[0]).ev - gradeSettings(stats[1]).ev) < 0.02);
  for (const s of stats) assert.ok(gradeSettings(s).ev > -0.03, "a neutral ramp near the exposure target is not falsely darkened");
  t.diagnostic(`8/10-bit RGB luma ${stats.map((s) => s.luma.toFixed(8))}; native YAVG ${stats.map((s) => s.diagnostics.nativeYavg)}; EV ${stats.map((s) => gradeSettings(s).ev)}`);
});

test("skin keeps 75% of saturation adjustment out, across complexions and both saturation directions", () => {
  const base = { ev: 0, contrast: 0, warmth: 0, balance: [0, 0, 0] };
  for (const rgb of [[0.22, 0.13, 0.08], [0.6, 0.38, 0.25], [0.8, 0.6, 0.45], [0.65, 0.3, 0.8]]) {
    const isSkin = rgb[1] > rgb[2];
    for (const saturation of [0.5, 1, 1.5]) {
      const actual = gradePixel(rgb, { ...base, saturation });
      const effective = isSkin ? 1 + (saturation - 1) * 0.25 : saturation;
      const expected = rgb.map((v) => Math.max(0, Math.min(1, luma(rgb) + effective * (v - luma(rgb)))));
      actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-12));
      assert.ok(Math.abs(luma(actual) - luma(rgb)) < 1e-12);
    }
  }
});

test("skin saturation protection survives the baked 33-cube LUT on lavfi patches", async (t) => {
  const dir = temp(t), values = [];
  for (const saturation of [1, 0.5]) {
    const lut = path.join(dir, `${saturation}.cube`), raw = path.join(dir, `${saturation}.rgb`);
    fs.writeFileSync(lut, gradeCube({ ev: 0, contrast: 0, warmth: 0, balance: [0, 0, 0], saturation }));
    await ff(["-f", "lavfi", "-i", "color=c=0xC28262:s=32x32:d=0.1", "-vf", `format=rgb24,lut3d=file=${lut}:interp=tetrahedral`, "-frames:v", "1", "-f", "rawvideo", raw]);
    values.push([...fs.readFileSync(raw).subarray(0, 3)]);
  }
  const chroma = values.map((rgb) => Math.max(...rgb) - Math.min(...rgb));
  assert.ok(Math.abs(chroma[1] / chroma[0] - 0.875) < 0.02);
  t.diagnostic(`skin saturation 1 -> 0.5: RGB ${values[0]} -> ${values[1]}, chroma ratio ${(chroma[1] / chroma[0]).toFixed(5)}`);
});

test("balance and warmth validate boundaries, retain zeros and inherit independently of EV", () => {
  assert.deepEqual(gradeOverrides({ balance: [-0.03, 0, 0.03], warmth: -0.01 }), { warmth: -0.01, balance: [-0.03, 0, 0.03] });
  assert.equal(gradeOverrides({ warmth: 0.01 }).warmth, 0.01);
  for (const balance of [null, [], [0, 0], [0, 0, 0, 0], [0, 0.031, 0], [NaN, 0, 0], [0, "0", 0], Array(3)]) assert.throws(() => gradeOverrides({ balance }), /balance/);
  for (const warmth of [null, "0", NaN, Infinity, -0.01001, 0.01001]) assert.throws(() => gradeOverrides({ warmth }), /warmth/);
  const stats = { luma: 0.2 }, neutral = { r: 0.4, g: 0.5, b: 0.6, fraction: 1 };
  const settings = gradeSettings(stats, neutral, { balance: [0, 0, 0], warmth: 0 });
  assert.deepEqual(settings.balance, [0, 0, 0]); assert.equal(settings.warmth, 0); assert.equal(settings.ev, 0.3);
});

test("grade range union excludes gaps and duplicate uses, and validates boundaries", () => {
  assert.deepEqual(gradeRanges([{ in: 8, out: 10 }, { in: 1, out: 3 }, { in: 2, out: 4 }, { in: 1, out: 3 }], 12), [{ in: 1, out: 4 }, { in: 8, out: 10 }]);
  for (const ranges of [[], [{ in: -1, out: 1 }], [{ in: 1, out: 1 }], [{ in: 0, out: Infinity }], [{ in: 0, out: 15 }], [{ in: 12, out: 12.01 }]]) assert.throws(() => gradeRanges(ranges, 12), /range/);
});

test("selected ranges share one fixed source measurement, invalidate old cache and never sample wash", async (t) => {
  const dir = temp(t), calls = [];
  const legacyKey = createHash("sha256").update(JSON.stringify({ version: 1, sourceKey: "source", preFilter: "transpose=clock" })).digest("hex");
  writeJSON(path.join(dir, `${legacyKey}.look.json`), { stats: { luma: 2.4 }, settings: { ev: -0.3 } });
  const options = { sourceKey: "source", meta: { duration: 60 }, preFilter: "transpose=clock", cacheDir: dir,
    ranges: [{ in: 10, out: 12 }, { in: 40, out: 42 }],
    measure: async (_, opts) => { calls.push(opts); return { luma: 0.42 }; },
    execute: async (_, args) => { assert.ok(args.includes("-noautorotate")); assert.equal(args[args.indexOf("-vf") + 1], "transpose=clock,scale=32:32:flags=area,format=rgb24"); fs.writeFileSync(args.at(-1), Buffer.from([128, 140, 128])); } };
  const first = await prepareGrade("source.mov", options);
  assert.equal(first.settings.ev, 0); assert.notEqual(first.key, legacyKey); assert.equal(first.measurement.version, 2); assert.equal(first.gradeVersion, 3);
  assert.equal(first.measurement.colorDomain, "display-rgb24-rec709"); assert.equal(first.measurement.region, "source-foreground");
  assert.ok(calls[0].sampleTimes.every((v) => v > 10 && v < 12 || v > 40 && v < 42));
  assert.equal(calls[0].lumaMode, "rgb24"); assert.equal(calls[0].noAutorotate, true);
  const variant = await prepareGrade("source.mov", { ...options, overrides: { ev: -0.15, balance: [0, 0, 0], warmth: 0 } });
  assert.equal(calls.length, 1); assert.equal(first.measurementKey, variant.measurementKey); assert.notEqual(first.key, variant.key);
  const changed = await prepareGrade("source.mov", { ...options, ranges: [{ in: 20, out: 22 }] });
  assert.equal(calls.length, 2); assert.notEqual(first.measurementKey, changed.measurementKey);
  for (const key of [first.key, first.measurementKey]) {
    const file = path.join(dir, `${key}.look.json`), data = JSON.parse(fs.readFileSync(file));
    data.stats.luma = 2.4; writeJSON(file, data);
  }
  fs.writeFileSync(first.lut, "invalid old LUT");
  const recovered = await prepareGrade("source.mov", options);
  assert.equal(calls.length, 3); assert.equal(recovered.fallback, undefined); assert.equal(recovered.settings.ev, 0);
  assert.equal(fs.readFileSync(first.lut, "utf8"), gradeCube(recovered.settings));
});

test("measurement rejects malformed sample clocks and unknown domains before decoding", async () => {
  for (const sampleTimes of [[], Array(12), Array(12).fill(NaN), Array(12).fill(-1), "not a clock"]) {
    await assert.rejects(measureClip("unused.mkv", { duration: 1, sampleTimes }), /twelve finite sample times/);
  }
  await assert.rejects(measureClip("unused.mkv", { duration: 1, lumaMode: "unknown" }), /unknown luma measurement domain/);
});

test("invalid normalized source measurements never drive automatic darkening; overrides survive fallback", async (t) => {
  const dir = temp(t);
  for (const [n, stats] of [{ luma: 2.4 }, { luma: -0.1 }, { luma: NaN }, { luma: Infinity }, { luma: 0.4, saturation: 1.1 }, { luma: 0.4, contrast: NaN }].entries()) {
    const grade = await prepareGrade("source.mov", { sourceKey: String(n), meta: { duration: 1 }, cacheDir: dir, measure: async () => stats, overrides: { ev: 0.2 }, print: () => {} });
    assert.equal(grade.fallback, true); assert.equal(grade.settings.ev, 0.2);
  }
  for (const luma of [2.4, NaN, Infinity, -1]) assert.equal(gradeSettings({ luma }).ev, 0);
});

test("portrait foreground is measured before wash styling, including selected-range exposure", async (t) => {
  const dir = temp(t), file = path.join(dir, "portrait.mkv"), washed = path.join(dir, "wash.mkv");
  await ff(["-f", "lavfi", "-i", "nullsrc=s=48x96:r=30:d=1,geq=lum='if(lt(N,15),52,150)':cb=128:cr=128", "-c:v", "ffv1", file]);
  const meta = await probeSource(file);
  const grade = await prepareGrade(file, { sourceKey: "portrait", meta, ranges: [{ in: 0.6, out: 0.9 }], cacheDir: dir });
  assert.equal(grade.fallback, undefined);
  const dark = await prepareGrade(file, { sourceKey: "portrait", meta, ranges: [{ in: 0.4, out: 0.5 }], cacheDir: dir });
  assert.equal(dark.fallback, undefined); assert.ok(dark.stats.luma < 0.2, "exclusive out point must not sample the brighter following shot");
  const end = await prepareGrade(file, { sourceKey: "portrait", meta, ranges: [{ in: 0.9, out: 1 }], cacheDir: dir });
  assert.equal(end.fallback, undefined); assert.ok(end.stats.luma > 0.6, "range ending at EOF still supplies twelve complete samples");
  const before = await measureClip(file, { duration: 1, sampleTimes: grade.measurement.sampleTimes });
  assert.equal(grade.stats.luma, before.luma);
  const graph = fitGraph("0:v", "pic", fitGeometry(meta, "wash", { width: 320, height: 180 }), { fit: "wash", width: 320, height: 180, frames: 30 }).join(";");
  await ff(["-filter_complex_threads", "1", "-i", file, "-filter_complex", graph, "-map", "[pic]", "-t", "1", "-c:v", "ffv1", washed]);
  const after = await measureClip(washed, { duration: 1, sampleTimes: grade.measurement.sampleTimes });
  assert.ok(before.luma - after.luma > 0.1);
  t.diagnostic(`portrait selected sharp luma ${before.luma.toFixed(6)}, styled full frame ${after.luma.toFixed(6)}; sample times ${grade.measurement.sampleTimes.map((n) => n.toFixed(3))}`);
});

test("HLG review selection validates globally and leaves existing plans on their legacy path", () => {
  assert.equal(lookOptions().hlg, undefined);
  for (const hlg of ["legacy", "review"]) assert.equal(lookOptions({ hlg }).hlg, hlg);
  for (const hlg of [null, true, "auto"]) assert.throws(() => lookOptions({ hlg }), /look.hlg/);
  assert.throws(() => lookOptions({ hlg: "review" }, { allowSources: false }), /unknown key hlg/);
  assert.match(hlgToSdrFilter(), /tin=arib-std-b67.*t=linear.*gbrpf32le.*exposure=-1.5.*tonemap=mobius.*dither=error_diffusion/);
});

test("10-bit HLG-tagged ramp converts deterministically to SDR with monotonic neutral highlights", async (t) => {
  const dir = temp(t), file = path.join(dir, "hlg.mkv"), output = path.join(dir, "sdr.mkv");
  await ff(["-f", "lavfi", "-i", "nullsrc=s=96x48:r=30:d=0.5,format=yuv420p10le,geq=lum='64+876*X/(W-1)':cb=512:cr=512,setparams=range=limited:color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc", "-c:v", "ffv1", file]);
  const meta = await probeSource(file); assert.equal(meta.hdrKind, "hlg"); assert.equal(meta.pixFmt, "yuv420p10le");
  await ff(["-i", file, "-vf", hlgToSdrFilter(), "-c:v", "ffv1", ...SDR_TAGS, output]);
  const sdr = await probeSource(output); assert.equal(sdr.hdr, false); assert.equal(sdr.colorTransfer, "bt709"); assert.equal(sdr.pixFmt, "yuv420p");
  const samples = [];
  for (const [n, filter] of [hlgToSdrFilter(), hlgToSdrFilter(), SDR_FILTER].entries()) {
    const raw = path.join(dir, `${n}.rgb`);
    await ff(["-i", file, "-vf", `${filter},format=rgb24`, "-frames:v", "1", "-f", "rawvideo", raw]);
    samples.push(fs.readFileSync(raw));
  }
  assert.deepEqual(samples[0], samples[1]); assert.notDeepEqual(samples[0], samples[2]);
  let previous = -1;
  const row = samples[0].subarray(0, 96 * 3);
  for (let x = 0; x < 96; x++) {
    const rgb = [...row.subarray(x * 3, x * 3 + 3)];
    assert.ok(luma(rgb) >= previous - 1); previous = luma(rgb);
    assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 1);
  }
  const points = [0, 24, 48, 72, 95].map((x) => [...row.subarray(x * 3, x * 3 + 3)]);
  t.diagnostic(`HLG ramp RGB at x=0/24/48/72/95: ${points.map((p) => p.join(",")).join("; ")}; repeat renders byte-identical; duration ${sdr.videoDuration}s`);
});

test("speaker compiler selects HLG review for clips and cutaways, preserves plain BT.2020 and the frame clock", { timeout: 120000 }, async (t) => {
  const dir = temp(t), index = { sources: {} }, sources = [];
  const identity = { ev: 0, saturation: 1, contrast: 0, balance: [0, 0, 0], warmth: 0 };
  const brand = { name: "Jane Doe", fonts: { display: "Georgia", body: "Arial" }, colors: { text: "#FFFFFF", accent: "#FFB27D", bg: "#111111" } };
  writeJSON(path.join(dir, "brand.json"), brand);
  for (const [id, transfer] of [["hlg", "arib-std-b67"], ["plain", "bt2020-10"]]) {
    const file = path.join(dir, `${id}.mkv`);
    await ff(["-f", "lavfi", "-i", `nullsrc=s=96x48:r=30:d=0.5,format=yuv420p10le,geq=lum=700:cb=512:cr=512,setparams=range=limited:color_primaries=bt2020:color_trc=${transfer}:colorspace=bt2020nc`, "-c:v", "ffv1", file]);
    index.sources[id] = { ...await probeSource(file), words: [] };
    sources.push({ id, path: `${id}.mkv`, kind: "broll", audio: "none", rights: "r1" });
  }
  const manifest = { schemaVersion: 1, clientId: "jane", identity: { name: "Jane Doe", roleLine: "Speaker", bookingMode: "direct", bookingUrl: "https://example.test", bookingText: "Book Jane" }, brand: { file: "brand.json" }, sources, proof: [], rights: [{ id: "r1", status: "approved" }] };
  const plan = { schemaVersion: 1, clientId: "jane", version: "legacy", revision: 1, canvas: { width: 1920, height: 1080, fps: 30 }, look: { grade: "auto", sources: { hlg: identity, plain: identity } },
    items: ["hlg", "plain"].map((sourceId) => ({ id: sourceId, kind: "clip", sourceId, in: 0, out: 0.2, fit: "cover", push: 1, audio: "mute", role: "room" })),
    cutaways: [{ id: "x", over: "plain", offset: 0.1, sourceId: "hlg", in: 0.3, out: 0.4, fit: "cover", push: 1 }], overlays: [] };
  const render = async (p) => {
    const compiled = await compileVersion(dir, p, { manifest, index, encoder: "libx264", print: () => {} });
    const raw = path.join(compiled.workDir, "pixel.rgb");
    await ff(["-i", compiled.base, "-vf", "crop=2:2:960:540,format=rgb24", "-f", "rawvideo", raw]);
    const data = fs.readFileSync(raw), evidence = JSON.parse(fs.readFileSync(path.join(compiled.workDir, "look", "look.json")));
    assert.equal(data.length, 12 * 12);
    const meta = await probeSource(compiled.base);
    assert.equal(meta.colorTransfer, "bt709"); assert.equal(meta.hdr, false);
    assert.ok(Math.abs(meta.videoDuration - 0.4) < 1 / 30);
    assert.ok(Math.abs(meta.audioStreams[0].duration - meta.videoDuration) < 1 / 30);
    return { compiled, evidence, pixels: [0, 6, 9].map((frame) => [...data.subarray(frame * 12, frame * 12 + 3)]) };
  };
  const legacy = await render(plan), review = await render({ ...plan, version: "review", look: { ...plan.look, hlg: "review" } });
  const distance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  assert.ok(distance(legacy.pixels[0], review.pixels[0]) > 5);
  assert.ok(distance(legacy.pixels[1], review.pixels[1]) <= 2);
  assert.ok(distance(review.pixels[0], review.pixels[2]) <= 2, "HLG cutaway receives the same conversion as HLG clip");
  assert.equal(review.evidence.sources.hlg.fallback, false);
  assert.equal(review.evidence.sources.hlg.measurement.preFilter, hlgToSdrFilter());
  assert.equal(review.evidence.sources.plain.measurement.preFilter, SDR_FILTER);
  assert.notEqual(legacy.evidence.sources.hlg.key, review.evidence.sources.hlg.key);
  assert.equal(legacy.evidence.sources.plain.key, review.evidence.sources.plain.key);
  assert.deepEqual(review.evidence.sources.hlg.measurement.ranges, [{ in: 0, out: 0.2 }, { in: 0.3, out: 0.4 }]);
  assert.ok(review.compiled.resolvedPlan.problems.some((p) => /HLG review transform/.test(p.message)));
  assert.equal(plan.look.hlg, undefined);
  t.diagnostic(`compiled HLG/plain/HLG-cutaway RGB: legacy ${legacy.pixels.map((p) => p.join(",")).join("; ")}; review ${review.pixels.map((p) => p.join(",")).join("; ")}; both 12 frames, 0.4s`);
});
