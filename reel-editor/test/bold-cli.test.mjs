import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fixturePlan } from "../scripts/golden.mjs";

test("CLI restyle writes a separate bold project, preserves source and music, reuses picks and honors --repick without network", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bold-cli-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const src = path.join(root, "job"), dest = `${src}-bold`, footage = path.join(root, "source.mp4"), calls = path.join(root, "calls.txt"), fake = path.join(root, "claude-fake");
  fs.mkdirSync(path.join(src, "project/assets"), { recursive: true }); fs.writeFileSync(footage, "footage bytes");
  const p = fixturePlan(footage); p.words = "Ask better questions and listen before you try to sell anything today".split(" ").map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));
  p.audio.tracks = [{ id: "music", src: "assets/music.mp3", start: 0, duration: 10, volume: 0.1 }];
  fs.writeFileSync(path.join(src, "project/assets/music.mp3"), "licensed track bytes");
  fs.writeFileSync(path.join(src, "plan.json"), JSON.stringify(p)); fs.writeFileSync(path.join(src, "glow-picks.json"), "{}");
  const reply = { schemaVersion: 1, argument: { buyerProblem: null, answer: null, payoff: null }, headline: { from: 0, to: 3, emphasis: 1, reason: "Actual advice" }, punch: [], emphasis: [], turns: [], overlays: [] };
  fs.writeFileSync(fake, `#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(process.env.BOLD_FAKE_CALLS, 'ask\\n');\nconsole.log(${JSON.stringify(JSON.stringify(reply))});\n`, { mode: 0o755 });
  // ESM needs a recognized extension when this executable is outside the package.
  const fakeModule = `${fake}.mjs`; fs.renameSync(fake, fakeModule);
  const env = { ...process.env, REEL_CLAUDE_BIN: fakeModule, BOLD_FAKE_CALLS: calls, REEL_CLIENT: "", REEL_CLIENT_MODE: "0" };
  const run = (extra = [], overrides = {}) => spawnSync(process.execPath, ["bin/reel.mjs", "restyle", src, "--look", "bold", "--no-render", ...extra], { cwd: new URL("..", import.meta.url), env: { ...env, ...overrides }, encoding: "utf8", timeout: 15000 });
  for (const extra of [[], [], ["--repick"]]) {
    const result = run(extra); assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(dest, "plan.json")));
    assert.equal(saved.preset, "pingel-bold"); assert.equal(saved.bold.schemaVersion, 1);
    assert.equal(saved.words.length, p.words.length);
    assert.equal(fs.readFileSync(path.join(dest, "project/assets/music.mp3"), "utf8"), "licensed track bytes");
    assert.equal(fs.existsSync(path.join(dest, "glow-picks.json")), false);
    assert.match(fs.readFileSync(path.join(dest, "project/index.html"), "utf8"), /bold-root/);
  }
  assert.equal(fs.readFileSync(calls, "utf8"), "ask\nask\n");
  assert.equal(fs.readFileSync(path.join(src, "plan.json"), "utf8"), JSON.stringify(p));
  assert.equal(fs.readFileSync(footage, "utf8"), "footage bytes");
  assert.notEqual(run([], { REEL_CLIENT: "jane" }).status, 0);
  assert.notEqual(run(["--out", src]).status, 0);
  const other = path.join(root, "unrelated"); fs.mkdirSync(other); fs.writeFileSync(path.join(other, "keep.txt"), "keep");
  assert.notEqual(run(["--out", other]).status, 0); assert.equal(fs.readFileSync(path.join(other, "keep.txt"), "utf8"), "keep");
  const glow = spawnSync(process.execPath, ["bin/reel.mjs", "restyle", dest, "--icons", path.join(root, "no-icons"), "--no-render"], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", timeout: 15000 });
  assert.equal(glow.status, 0, glow.stderr);
  const glowPlan = JSON.parse(fs.readFileSync(path.join(`${dest}-glow`, "plan.json")));
  assert.equal(glowPlan.bold, undefined); assert.equal(glowPlan.style.bold.enabled, false); assert.equal(glowPlan.style.glow.enabled, true);
  assert.doesNotMatch(fs.readFileSync(path.join(`${dest}-glow`, "project/index.html"), "utf8"), /bold-root|boldFit/);
});
