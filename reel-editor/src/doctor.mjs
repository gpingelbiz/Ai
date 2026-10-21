import fs from "node:fs";
import path from "node:path";
import { run, PKG_ROOT } from "./util.mjs";
import { hyperframesBin, renderEnv } from "./render.mjs";

async function ok(cmd, args) {
  try {
    await run(cmd, args, { capture: true });
    return true;
  } catch {
    return false;
  }
}

export async function doctor() {
  const rows = [];
  rows.push(["ffmpeg", await ok("ffmpeg", ["-version"]) ? "ok" : "MISSING (brew install ffmpeg)"]);
  rows.push(["ffprobe", await ok("ffprobe", ["-version"]) ? "ok" : "MISSING"]);
  const py = process.env.REEL_PYTHON || "python3";
  rows.push([`${py} faster-whisper`, await ok(py, ["-c", "import faster_whisper"]) ? "ok" : "MISSING (pip install faster-whisper)"]);
  const bin = hyperframesBin();
  rows.push(["hyperframes", bin.length === 1 ? `ok (${bin[0]})` : "not installed locally; falls back to npx (run npm install)"]);
  rows.push(["ELEVENLABS_API_KEY", process.env.ELEVENLABS_API_KEY ? "set" : "not set (needed only for --sfx, --voiceover, --engine elevenlabs)"]);
  rows.push(["ELEVENLABS_VOICE_ID", process.env.ELEVENLABS_VOICE_ID ? "set" : "not set (needed for --voiceover unless --voice given)"]);
  rows.push(["fonts", ["Anton-Regular.ttf", "Inter.ttf"].every((f) => fs.existsSync(path.join(PKG_ROOT, "assets", "fonts", f))) ? "ok" : "MISSING"]);
  rows.push(["REEL_BROWSER_PATH", process.env.REEL_BROWSER_PATH || "(unset: hyperframes downloads its own Chrome)"]);
  for (const [k, v] of rows) console.log(`  ${k.padEnd(24)} ${v}`);
  console.log("\n  hyperframes doctor:");
  try {
    await run(bin[0], [...bin.slice(1), "doctor"], { env: renderEnv() });
  } catch (e) {
    console.log("  hyperframes doctor reported problems (see above)");
  }
}
