import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("reel edit --preset pingel-pro builds a fixture project through the real CLI without network or rendering", (t) => {
  const root = fs.mkdtempSync(path.resolve("test/.pro-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin"), work = path.join(root, "job"), video = path.join(root, "fixture.mp4"), transcript = path.join(root, "words.json");
  fs.mkdirSync(bin); fs.writeFileSync(video, "fixture video bytes");
  const words = [
    ..."Don't say are you say because you're.".split(" ").map((text, i) => ({ text, start: 3 + i * 0.4, end: 3.25 + i * 0.4 })),
    ..."Make 30 calls.".split(" ").map((text, i) => ({ text, start: 13 + i * 0.4, end: 13.25 + i * 0.4 })),
  ];
  fs.writeFileSync(transcript, JSON.stringify({ words }));
  const executable = (name, source) => {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${source}\n`, { mode: 0o755 });
    return file;
  };
  executable("ffprobe", `console.log(JSON.stringify({ streams:[{ codec_type:"video",width:1080,height:1920,r_frame_rate:"30/1",color_transfer:"bt709" }],format:{duration:"30"} }));`);
  // Media tools are adapters here: fixture bytes reach the composer, while the actual renderer is never called.
  // "-" is stdout (a pipe), not a file: writing it left a stray file named "-" in the repo after every run.
  executable("ffmpeg", `import fs from 'node:fs'; const out = process.argv.at(-1); if (out !== '-') fs.writeFileSync(out,'fixture clean video');`);
  const faceTool = `#!${process.execPath}\nconsole.log(JSON.stringify({ frames:process.argv.slice(3).map(Number).map(t=>({t,faces:[{x:.3,y:.65,w:.2,h:.1}],bodies:[]})) }));\n`;
  executable("swiftc", `import fs from 'node:fs'; const args=process.argv.slice(2); fs.writeFileSync(args[args.indexOf('-o')+1],${JSON.stringify(faceTool)},{mode:0o755});`);
  const claude = executable("claude.mjs", `console.log(JSON.stringify({overlays:[{type:"stat",valueRange:{from:8,to:8},labelRange:{from:9,to:9}}]}));`);
  const platform = path.join(root, "platform.mjs");
  fs.writeFileSync(platform, 'Object.defineProperty(process,"platform",{value:"darwin"});\n');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, REEL_CACHE: path.join(root, "cache"), REEL_CLIENT: "", REEL_CLIENT_MODE: "0", REEL_CLAUDE_BIN: claude, REEL_NATIVE_HELPERS: "off" };
  const result = spawnSync(process.execPath, ["--import", platform, "bin/reel.mjs", "edit", video, "--preset", "pingel-pro", "--transcript", transcript, "--out", work, "--no-render", "--no-hook", "--no-cuts", "--no-zooms", "--no-verify"], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const plan = JSON.parse(fs.readFileSync(path.join(work, "plan.json"), "utf8"));
  assert.equal(plan.preset, "pingel-pro");
  assert.equal(plan.proGraphics.length, 2);
  assert.deepEqual(plan.proGraphics.map((o) => o.type), ["correction", "stat"]);
  assert.deepEqual(plan.graphics, []); assert.deepEqual(plan.icons, []);
  assert.equal(plan.glowScenes, undefined);
  // audio.pro drops any effect whose peak it cannot measure (the fixture ffmpeg cannot), so cues are a subset.
  assert.ok(plan.audio.tracks.length <= plan.proGraphics.length);
  for (const c of plan.audio.tracks.filter((t) => t.eventId)) assert.ok(plan.proGraphics.some((o) => o.id === c.eventId));
  assert.equal(fs.readFileSync(video, "utf8"), "fixture video bytes");
  const html = fs.readFileSync(path.join(work, "project/index.html"), "utf8");
  assert.match(html, /pro-overlay pro-correction/); assert.match(html, /pro-overlay pro-stat/);
  if (plan.audio.tracks.length) assert.ok(fs.existsSync(path.join(work, "project/assets/sfx/card.wav")));
  assert.ok(fs.existsSync(path.join(work, "project/assets/fonts/Inter.ttf")));
  assert.ok(fs.existsSync(path.join(work, "pro-graphics.json")));
});
