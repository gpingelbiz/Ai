import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hdrKind, rotationCw, rotateFilters, toneMapArgs, toneMapToSdr } from "../src/hdr.mjs";
import { probe } from "../src/probe.mjs";
import { applyCuts } from "../src/cuts.mjs";

test("hdrKind tells HLG, PQ and BT.2020 apart from SDR", () => {
  assert.equal(hdrKind({ color_transfer: "arib-std-b67", color_primaries: "bt2020" }), "hlg");
  assert.equal(hdrKind({ color_transfer: "smpte2084", color_primaries: "bt2020" }), "pq");
  assert.equal(hdrKind({ color_transfer: "bt2020-10", color_primaries: "bt2020" }), "bt2020");
  assert.equal(hdrKind({ color_space: "bt2020nc" }), "bt2020");
  assert.equal(hdrKind({ color_transfer: "bt709", color_primaries: "bt709" }), null);
  assert.equal(hdrKind({}), null);
});

test("rotationCw reads the display matrix (counter-clockwise) and the legacy rotate tag (clockwise)", () => {
  assert.equal(rotationCw({ side_data_list: [{ rotation: -90 }] }), 90); // iPhone portrait
  assert.equal(rotationCw({ side_data_list: [{ rotation: 90 }] }), 270);
  assert.equal(rotationCw({ side_data_list: [{ rotation: 180 }] }), 180);
  assert.equal(rotationCw({ tags: { rotate: "90" } }), 90);
  assert.equal(rotationCw({}), 0);
});

test("rotateFilters and the tone-map pass rotate by hand because hardware frames skip autorotate", () => {
  assert.deepEqual(rotateFilters(90), ["transpose=clock"]);
  assert.deepEqual(rotateFilters(270), ["transpose=cclock"]);
  assert.deepEqual(rotateFilters(180), ["hflip", "vflip"]);
  assert.deepEqual(rotateFilters(0), []);
  const args = toneMapArgs("in.mov", "out.mov", { rotation: 90, hasAudio: true });
  assert.ok(args.includes("-noautorotate"));
  assert.ok(args[args.indexOf("-vf") + 1].endsWith(",transpose=clock"));
  assert.ok(args.includes("bt709"));
});

test("toneMapToSdr reports unavailable off macOS so the pipeline falls back", async () => {
  assert.equal(await toneMapToSdr("in.mov", "out.mov", {}, "linux"), false);
});

// Integration: real ffmpeg round trips on tiny synthetic HDR clips.
const ff = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
const haveX265 = ff.status === 0 && /libx265/.test(ff.stdout);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-hdr-"));

function makeHdrClip(file, trc, { rotate = 0 } = {}) {
  const args = [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "1.5",
    "-vf", `format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=${trc}:colorspace=bt2020nc`,
    "-c:v", "libx265", "-x265-params", `log-level=error:colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc`,
    "-pix_fmt", "yuv420p10le", "-color_primaries", "bt2020", "-color_trc", trc, "-colorspace", "bt2020nc",
    "-tag:v", "hvc1", "-c:a", "aac", "-shortest", file,
  ];
  if (rotate) args.splice(args.indexOf("-f"), 0, "-display_rotation", String(rotate));
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

test("HLG source: probe flags it and the cut pass outputs tagged BT.709 SDR", { skip: !haveX265 && "ffmpeg with libx265 not found" }, async () => {
  const src = path.join(tmp, "hlg.mov");
  const out = path.join(tmp, "hlg-clean.mp4");
  makeHdrClip(src, "arib-std-b67");
  const meta = await probe(src);
  assert.equal(meta.hdrKind, "hlg");
  assert.equal(meta.hdr, true);
  await applyCuts(src, [{ start: 0, end: 0.6 }, { start: 0.9, end: 1.5 }], out, { hasAudio: true, cleanAudio: false, hdr: true });
  const clean = await probe(out);
  assert.equal(clean.hdr, false, `clean.mp4 still HDR: ${clean.colorTransfer}/${clean.colorPrimaries}`);
  assert.equal(clean.colorTransfer, "bt709");
  assert.equal(clean.pixFmt, "yuv420p");
  assert.ok(clean.duration > 1 && clean.duration < 1.4, `duration ${clean.duration}`);
});

test("PQ source on macOS: VideoToolbox tone-maps to BT.709 and keeps a portrait rotation", { skip: (!haveX265 && "ffmpeg with libx265 not found") || (process.platform !== "darwin" && "VideoToolbox is macOS only") }, async () => {
  const src = path.join(tmp, "pq.mov");
  const out = path.join(tmp, "pq-sdr.mov");
  makeHdrClip(src, "smpte2084", { rotate: 90 }); // display matrix 90 counter-clockwise = 270 clockwise
  const meta = await probe(src);
  assert.equal(meta.hdrKind, "pq");
  assert.equal(meta.width, 180, "probe should report the rotated (portrait) width");
  assert.equal(await toneMapToSdr(src, out, meta), true);
  const sdr = await probe(out);
  assert.equal(sdr.hdr, false);
  assert.equal(sdr.colorTransfer, "bt709");
  assert.equal(sdr.rotationCw, 0, "rotation must be baked into the pixels, not left as metadata");
  assert.equal(sdr.width, 180);
  assert.equal(sdr.height, 320);
  assert.equal(sdr.hasAudio, true);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
