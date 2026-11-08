import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { nativeTool } from "../src/native-tool.mjs";
import { PKG_ROOT } from "../src/util.mjs";

const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const options = { platform: "darwin", arch: "arm64" };
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-tool-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fixture(t) {
  const app = temp(t), dir = path.join(app, "dist/helpers/darwin-arm64");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(app, "scripts"));
  const source = path.join(app, "scripts/faces.swift"), bin = path.join(dir, "faces"), manifest = path.join(dir, "helpers.json");
  fs.writeFileSync(source, "// neutral test source\n");
  fs.writeFileSync(bin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(manifest, JSON.stringify({ faces: { sha256: hash(bin), source: hash(source) } }));
  return { app, source, bin, manifest };
}
const neverCompile = () => assert.fail("must not compile");

test("resolver picks the executable with matching source and binary hashes", async (t) => {
  const { app, bin } = fixture(t);
  assert.equal(await nativeTool("faces", { ...options, app, compile: neverCompile }), bin);
});

test("resolver preserves the developer's compile fallback when the helper is missing", async (t) => {
  const { app, bin } = fixture(t);
  fs.unlinkSync(bin);
  let calls = 0;
  assert.equal(await nativeTool("faces", { ...options, app, compile: async () => { calls++; return "/legacy/cache/faces"; } }), "/legacy/cache/faces");
  assert.equal(calls, 1);
});

test("a stale source hash never selects the shipped helper", async (t) => {
  const { app, source, bin } = fixture(t);
  fs.appendFileSync(source, "// changed\n");
  assert.notEqual(await nativeTool("faces", { ...options, app, compile: () => "/newly-compiled" }), bin);
});

test("a changed binary, non-executable binary, or broken manifest uses the developer fallback", async (t) => {
  for (const fault of ["binary", "permissions", "manifest"]) {
    const { app, bin, manifest } = fixture(t);
    if (fault === "binary") fs.appendFileSync(bin, "# changed\n");
    if (fault === "permissions") fs.chmodSync(bin, 0o644);
    if (fault === "manifest") fs.writeFileSync(manifest, "{");
    assert.equal(await nativeTool("faces", { ...options, app, compile: () => "fallback" }), "fallback", fault);
  }
});

test("a helper for another architecture or operating system is not selected", async (t) => {
  const { app } = fixture(t);
  assert.equal(await nativeTool("faces", { ...options, app, arch: "x64", compile: () => "fallback" }), "fallback");
  assert.equal(await nativeTool("faces", { ...options, app, platform: "linux", compile: () => "fallback" }), "fallback");
  await assert.rejects(nativeTool("../faces", { app, compile: neverCompile }), /Unknown built-in tool/);
});

test("developer compilation errors still reach the caller's existing fallback", async (t) => {
  const { app, bin } = fixture(t);
  fs.unlinkSync(bin);
  await assert.rejects(nativeTool("faces", { ...options, app, compile: () => { throw new Error("compiler unavailable"); } }), /compiler unavailable/);
});

test("client mode uses valid helpers and never reaches swiftc for missing or stale helpers", (t) => {
  const stubDir = temp(t), marker = path.join(stubDir, "compiler-ran");
  fs.writeFileSync(path.join(stubDir, "swiftc"), '#!/bin/sh\nprintf called > "$COMPILER_MARKER"\nexit 99\n', { mode: 0o755 });
  for (const fault of ["none", "missing", "source", "binary", "permissions", "manifest"]) {
    const { app, source, bin, manifest } = fixture(t);
    if (fault === "missing") fs.unlinkSync(bin);
    if (fault === "source") fs.appendFileSync(source, "// changed");
    if (fault === "binary") fs.appendFileSync(bin, "# changed");
    if (fault === "permissions") fs.chmodSync(bin, 0o644);
    if (fault === "manifest") fs.writeFileSync(manifest, "{}");
    const code = `
      import assert from "node:assert/strict";
      import { nativeTool } from ${JSON.stringify(new URL("../src/native-tool.mjs", import.meta.url).href)};
      import { run } from ${JSON.stringify(new URL("../src/util.mjs", import.meta.url).href)};
      const resolve = () => nativeTool("faces", { app: ${JSON.stringify(app)}, platform: "darwin", arch: "arm64", compile: () => run("swiftc", [], { capture: true }) });
      ${fault === "none" ? `assert.equal(await resolve(), ${JSON.stringify(bin)});` : 'await assert.rejects(resolve(), /Reinstall Reel Editor/);'}
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, REEL_CLIENT_MODE: "1", PATH: stubDir, COMPILER_MARKER: marker } });
    assert.equal(result.status, 0, `${fault}: ${result.stderr}`);
    assert.equal(fs.existsSync(marker), false, fault);
  }
});

function fakeCompiler(t) {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, "swiftc"), `#!/bin/bash
set -eu
[ "$1" = "-O" ]
[ "$2" = "-target" ]
[ "$3" = "arm64-apple-macos14.0" ]
[ "$4" = "-module-cache-path" ]
SOURCE="$6"
[ "$7" = "-o" ]
if [ "$(basename "$SOURCE" .swift)" = "$FAIL_HELPER" ]; then exit 1; fi
printf '#!/bin/sh\\nexit 0\\n' > "$8"
chmod +x "$8"
`, { mode: 0o755 });
  return dir;
}

test("Bash build script compiles every Swift source for macOS 14 arm64 and records both hashes", (t) => {
  const out = temp(t), stub = fakeCompiler(t);
  const result = spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts/build-helpers.sh"), out], { encoding: "utf8", env: { ...process.env, PATH: `${stub}:/usr/bin:/bin`, FAIL_HELPER: "" } });
  assert.equal(result.status, 0, result.stderr);
  const dir = path.join(out, "darwin-arm64"), manifest = JSON.parse(fs.readFileSync(path.join(dir, "helpers.json")));
  const sources = fs.readdirSync(path.join(PKG_ROOT, "scripts")).filter((s) => s.endsWith(".swift"));
  assert.deepEqual(Object.keys(manifest).sort(), sources.map((s) => s.slice(0, -6)).sort());
  for (const [name, record] of Object.entries(manifest)) {
    assert.deepEqual(record, { sha256: hash(path.join(dir, name)), source: hash(path.join(PKG_ROOT, "scripts", `${name}.swift`)) });
    fs.accessSync(path.join(dir, name), fs.constants.X_OK);
  }
  assert.deepEqual(fs.readdirSync(out), ["darwin-arm64"]);
});

test("failed build preserves the last complete helper set and removes partial output", (t) => {
  const out = temp(t), stub = fakeCompiler(t), dir = path.join(out, "darwin-arm64");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "helpers.json"), "previous build");
  const result = spawnSync("/bin/bash", [path.join(PKG_ROOT, "scripts/build-helpers.sh"), out], { encoding: "utf8", env: { ...process.env, PATH: `${stub}:/usr/bin:/bin`, FAIL_HELPER: "faces" } });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(dir, "helpers.json"), "utf8"), "previous build");
  assert.deepEqual(fs.readdirSync(out), ["darwin-arm64"]);
});
