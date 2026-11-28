import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { prepareAudio } from "../src/pipeline.mjs";
import { loadPreset } from "../src/presets.mjs";

let ffmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ffmpeg = false; }

// A stand-in for Claude that counts its calls and answers the next mood in a list each time, the way a real
// reply can differ from one run to the next. Re-running a reel must not ask again or change the song.
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "music-mood-")), lib = path.join(dir, "lib"), work = path.join(dir, "work");
  fs.mkdirSync(lib); fs.mkdirSync(work);
  for (const name of ["Lo-fi - A", "Epic - B", "Tense - C", "Lo-fi - D", "Epic - E", "Tense - F"])
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=2", path.join(lib, `${name}.wav`)]);
  const calls = path.join(dir, "calls"), stub = path.join(dir, "claude");
  fs.writeFileSync(stub, `#!/bin/sh\nn=$(cat "${calls}" 2>/dev/null || echo 0); echo $((n+1)) > "${calls}"\nset -- Lo-fi Epic Tense; i=$((n % 3 + 1)); eval m=\\\${$i}\necho "{\\"moods\\":[\\"$m\\"],\\"none\\":false,\\"why\\":\\"stub\\"}"\n`, { mode: 0o755 });
  const saved = { bin: process.env.REEL_CLAUDE_BIN, history: process.env.REEL_MUSIC_HISTORY };
  process.env.REEL_CLAUDE_BIN = stub; process.env.REEL_MUSIC_HISTORY = path.join(dir, "history.json");
  t.after(() => {
    for (const [k, v] of [["REEL_CLAUDE_BIN", saved.bin], ["REEL_MUSIC_HISTORY", saved.history]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const count = () => (fs.existsSync(calls) ? Number(fs.readFileSync(calls, "utf8")) : 0);
  const edit = async ({ pro = false, transcript = "keep practice simple", force = false } = {}) => {
    const preset = loadPreset("clean");
    preset.audio = { ...preset.audio, music: null, musicDir: lib, pro, sounds: false, sfx: false, duck: false };
    await prepareAudio({ workDir: work, projectDir: path.join(work, "project"), preset, opts: { force }, duration: 2, hook: { text: "a hook" }, zooms: [], words: [{ start: 0, end: 2, text: "practice" }], transcript });
    return fs.readFileSync(path.join(work, "music.txt"), "utf8").trim();
  };
  return { edit, count, work };
}

for (const pro of [false, true]) {
  test(`re-running a reel reuses its saved music mood (${pro ? "pro" : "plain"} look)`, { skip: !ffmpeg }, async (t) => {
    const { edit, count, work } = setup(t);
    const first = await edit({ pro });
    assert.equal(count(), 1, "the first edit asks Claude once");
    for (let i = 0; i < 4; i++) assert.equal(await edit({ pro }), first, "a re-run keeps the same song");
    assert.equal(count(), 1, "a re-run never asks Claude again");
    assert.ok(fs.existsSync(path.join(work, "music-mood.json")), "the answer is saved in the work folder");
  });
}

test("a changed transcript or a force re-run asks for the mood again", { skip: !ffmpeg }, async (t) => {
  const { edit, count } = setup(t);
  await edit();
  await edit({ transcript: "a different cut of the reel" });
  assert.equal(count(), 2, "new words get a new mood");
  await edit({ transcript: "a different cut of the reel", force: true });
  assert.equal(count(), 3, "force asks again");
});
