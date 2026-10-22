import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findDeepFilter, STUDIO_CHAIN, describeStudio } from "../src/studio.mjs";

test("studio sound: binary lookup order, chain contents, log lines", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-studio-"));
  const cache = path.join(tmp, "cache");
  fs.mkdirSync(path.join(cache, "bin"), { recursive: true });
  const bin = path.join(cache, "bin", "deep-filter");
  fs.writeFileSync(bin, "#!/bin/sh\n");
  fs.chmodSync(bin, 0o755);
  assert.equal(findDeepFilter({ REEL_CACHE: cache, PATH: "" }), bin);
  const explicit = path.join(tmp, "df");
  fs.writeFileSync(explicit, "");
  fs.chmodSync(explicit, 0o755);
  assert.equal(findDeepFilter({ REEL_DEEPFILTER: explicit, REEL_CACHE: cache, PATH: "" }), explicit);
  assert.equal(findDeepFilter({ REEL_CACHE: path.join(tmp, "nope"), PATH: "" }), null);
  // The studio chain levels and de-clicks instead of the spectral denoiser, and still lands at -16 LUFS.
  assert.ok(!STUDIO_CHAIN.includes("afftdn"));
  for (const f of ["highpass", "adeclick", "deesser", "speechnorm", "acompressor", "alimiter", "loudnorm=I=-16"]) assert.ok(STUDIO_CHAIN.includes(f), f);
  assert.match(describeStudio(null), /not installed/);
  assert.match(describeStudio({ error: "boom" }), /failed \(boom\)/);
  assert.match(describeStudio({ seconds: 1.2, floorBefore: -59, floorAfter: -68 }), /-59 → -68 dB/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
