import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runAcceptance, checkSpeech, acceptCommand } from "../src/acceptance.mjs";
import { PKG_ROOT, readJSON } from "../src/util.mjs";

const script = readJSON(path.join(PKG_ROOT, "examples/accept/script.json"));
const words = () => script.expectedWords.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));
const meta = { duration: 7, width: 1080, height: 1920, hasAudio: true, fps: 30 };

function fixture(t, overrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "accept-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const calls = [];
  const deps = {
    run: async (cmd, args, options) => { calls.push({ cmd, args, options }); },
    probe: async (file) => { calls.push({ cmd: "probe", file }); return meta; },
    transcribe: async (input, options) => { calls.push({ cmd: "transcribe", input, options }); return words(); },
    // Compose is real: this also catches incompatible plan or caption shapes without running a tool.
    render: async (project, output, options) => {
      assert.ok(fs.readFileSync(path.join(project, "index.html"), "utf8").includes("Editing check"));
      calls.push({ cmd: "render", project, output, options });
      fs.writeFileSync(output, "finished video");
    },
    ...overrides,
  };
  // The composer copies local footage; the mux fake supplies it.
  const execute = deps.run;
  deps.run = async (cmd, args, options) => {
    await execute(cmd, args, options);
    if (cmd === "ffmpeg") fs.writeFileSync(args.at(-1), "sample");
  };
  return { home, deps, calls };
}

test("accept makes speech and a vertical picture, transcribes locally and renders neutral captions", async (t) => {
  const f = fixture(t);
  const result = await runAcceptance({ ...f, env: { REEL_RELEASE: "2026.11.08.1", ELEVENLABS_API_KEY: "fake-test-key" } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.release, "2026.11.08.1");
  assert.equal(result.checks.speech.ratio, 1);
  assert.equal(result.checks.video.audio, true);
  assert.equal(fs.readFileSync(result.output, "utf8"), "finished video");
  assert.deepEqual(readJSON(path.join(f.home, "Reels/install-test/accept.json")), result);
  assert.deepEqual(f.calls.map((c) => c.cmd), ["say", "ffmpeg", "ffmpeg", "probe", "transcribe", "render", "probe"]);
  assert.deepEqual(f.calls[0].args.slice(0, 1), ["-o"]);
  assert.equal(f.calls[0].args.at(-1), script.sentence);
  assert.ok(f.calls[1].args.includes("color=c=0x303840:s=1080x1920"));
  const transcribe = f.calls.find((c) => c.cmd === "transcribe");
  assert.equal(transcribe.options.engine, "faster-whisper");
  assert.equal(transcribe.options.revision, readJSON(path.join(PKG_ROOT, "runtime/runtime.json")).whisper.revision);
  for (const call of f.calls.filter((c) => c.options)) {
    assert.equal(call.options.env.HF_HUB_OFFLINE, "1");
    assert.equal(call.options.env.HYPERFRAMES_NO_TELEMETRY, "1");
  }
  assert.deepEqual(fs.readdirSync(path.join(f.home, "Reels/install-test")).sort(), ["accept.json", "accept.mp4"]);
});

test("accept's render plan contains only clean captions and the locally spoken sample", async (t) => {
  let captured;
  const f = fixture(t, { compose: (plan) => { captured = plan; }, render: async (_, output) => fs.writeFileSync(output, "video") });
  const result = await runAcceptance(f);
  assert.equal(result.ok, true, result.error);
  assert.equal(captured.style.name, "clean");
  assert.deepEqual(captured.style.transcribe, { ...captured.style.transcribe, engine: "faster-whisper", fix: false, align: false, verify: false });
  for (const key of ["broll", "graphics", "slams", "icons", "zooms"]) assert.deepEqual(captured[key], []);
  assert.equal(captured.hook, null); assert.equal(captured.cta, null);
  assert.deepEqual(captured.audio.tracks, []);
  assert.ok(captured.captions.length > 0);
});

test("default adapters resolve only the pinned local model and installed renderer, even with service keys", async (t) => {
  const f = fixture(t);
  const browser = path.join(f.home, "browser"); fs.writeFileSync(browser, "local browser");
  f.deps.transcribe = undefined;
  f.deps.render = undefined;
  f.deps.run = async (cmd, args, options) => {
    f.calls.push({ cmd, args, options });
    if (cmd === "python-test") {
      assert.equal(args[0], "-c");
      assert.match(args[1], /snapshot_download\(repo_id=sys.argv\[1\], revision=sys.argv\[2\], local_files_only=True\)/);
      assert.match(args[1], /runpy.run_path/);
      fs.writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify({ words: words() }));
    } else if (cmd === "ffmpeg") fs.writeFileSync(args.at(-1), "sample");
    else if (cmd.endsWith("/hyperframes")) fs.writeFileSync(args[args.indexOf("-o") + 1], "video");
    else assert.equal(cmd, "say");
  };
  const result = await runAcceptance({ ...f, env: { REEL_PYTHON: "python-test", REEL_BROWSER_PATH: browser, ELEVENLABS_API_KEY: "fake-test-key" } });
  assert.equal(result.ok, true, result.error);
  const render = f.calls.find((c) => c.cmd.endsWith("/hyperframes"));
  assert.equal(render.cmd, path.join(PKG_ROOT, "node_modules/.bin/hyperframes"));
  assert.equal(render.options.env.HYPERFRAMES_BROWSER_PATH, browser);
  assert.ok(f.calls.every((c) => !["npx", "claude", "curl"].includes(c.cmd)));
});

test("a missing render browser stops instead of downloading one", async (t) => {
  const f = fixture(t, { render: undefined });
  const result = await runAcceptance({ ...f, env: { REEL_BROWSER_PATH: path.join(f.home, "missing-browser") } });
  assert.equal(result.ok, false);
  assert.match(result.detail, /browser is missing/);
});

test("speech check needs 80 percent in order, with sane increasing times", () => {
  assert.equal(checkSpeech(words().slice(0, 14), script.expectedWords, 7).matched, 14);
  assert.throws(() => checkSpeech(words().slice(0, 13), script.expectedWords, 7), /Too few/);
  assert.throws(() => checkSpeech(words().reverse().map((w, i) => ({ ...w, start: i * 0.4, end: i * 0.4 + 0.3 })), script.expectedWords, 7), /Too few/);
  for (const change of [{ start: -1 }, { start: NaN }, { end: 99 }, { end: 0 }, { start: 0.4 }]) {
    const bad = words(); Object.assign(bad[0], change);
    assert.throws(() => checkSpeech(bad, script.expectedWords, 7), /times/);
  }
  assert.throws(() => checkSpeech([], script.expectedWords, 7), /No spoken/);
});

for (const stage of ["say", "ffmpeg", "transcribe", "render", "probe"]) {
  test(`accept records failure when ${stage} cannot finish`, async (t) => {
    const fail = async () => { throw new Error("local tool unavailable"); };
    const overrides = ["say", "ffmpeg"].includes(stage)
      ? { run: async (cmd) => { if (cmd === stage) await fail(); } }
      : { [stage]: fail };
    const f = fixture(t, overrides);
    const result = await runAcceptance({ ...f, env: {} });
    assert.equal(result.ok, false);
    assert.equal(result.release, "dev");
    assert.match(result.detail, /local tool unavailable/);
    assert.equal(readJSON(path.join(f.home, "Reels/install-test/accept.json")).ok, false);
    assert.equal(fs.existsSync(path.join(f.home, "Reels/install-test/accept.mp4")), false);
  });
}

for (const invalid of [{ hasAudio: false }, { width: 1920 }, { height: 1080 }, { duration: 9 }, { duration: NaN }]) {
  test(`accept rejects a finished video with ${JSON.stringify(invalid)}`, async (t) => {
    let probes = 0;
    const f = fixture(t, { probe: async () => ++probes === 1 ? meta : { ...meta, ...invalid } });
    const result = await runAcceptance(f);
    assert.equal(result.ok, false);
    assert.match(result.error, /finished video/);
  });
}

test("accept prints just the readiness line or one JSON result and returns the right exit code", async () => {
  const out = [], errors = [];
  const options = { accept: async () => ({ ok: true, release: "2026.11.08.1" }), print: (s) => out.push(s), printError: (s) => errors.push(s) };
  assert.equal(await acceptCommand([], options), 0);
  assert.deepEqual(out, ["Editing ready (release 2026.11.08.1)"]);
  out.length = 0;
  assert.equal(await acceptCommand(["--json"], options), 0);
  assert.deepEqual(JSON.parse(out[0]), { ok: true, release: "2026.11.08.1" });
  options.accept = async () => ({ ok: false, error: "Speech check stopped." });
  assert.equal(await acceptCommand([], options), 1);
  assert.deepEqual(errors, ["Speech check stopped."]);
  await assert.rejects(acceptCommand(["--engine", "elevenlabs"], options), /Use reel accept/);
  const cli = spawnSync(process.execPath, [path.join(PKG_ROOT, "bin/reel.mjs"), "accept", "--unknown"], { encoding: "utf8" });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /Use reel accept/);
});
