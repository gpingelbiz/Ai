import fs from "node:fs";
import path from "node:path";
import { run, PKG_ROOT } from "./util.mjs";
import { hyperframesBin, renderEnv } from "./render.mjs";
import { hasCodex, codexPausedUntil } from "./codex.mjs";
import { findDeepFilter } from "./studio.mjs";

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
  const dfn = findDeepFilter();
  rows.push(["deep-filter (studio sound)", dfn ? `ok (${dfn})` : "not installed: scripts/install-deepfilter.sh (the spectral denoiser is used until then)"]);
  rows.push(["swiftc (faces, speakers, cutout)", await ok("xcrun", ["--find", "swiftc"]) ? "ok" : "MISSING (xcode-select --install)"]);
  const bin = hyperframesBin();
  rows.push(["hyperframes", bin.length === 1 ? `ok (${bin[0]})` : "not installed locally; falls back to npx (run npm install)"]);
  rows.push(["ELEVENLABS_API_KEY", process.env.ELEVENLABS_API_KEY ? "set" : "not set (needed only for --sfx, --voiceover, --engine elevenlabs)"]);
  rows.push(["ELEVENLABS_VOICE_ID", process.env.ELEVENLABS_VOICE_ID ? "set" : "not set (needed for --voiceover unless --voice given)"]);
  const codex = !hasCodex() ? "not installed (only for --broll and carousels: npm install -g @openai/codex)"
    : !(await ok(process.env.REEL_CODEX_BIN || "codex", ["login", "status"])) ? "installed, not signed in (run: codex login)"
    : codexPausedUntil() ? `ok, paused after a rate limit until ${new Date(codexPausedUntil()).toLocaleTimeString()}` : "ok";
  rows.push(["codex (b-roll, carousel)", codex]);
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
