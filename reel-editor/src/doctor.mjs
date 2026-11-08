import fs from "node:fs";
import path from "node:path";
import { run, PKG_ROOT } from "./util.mjs";
import { hyperframesBin, renderEnv } from "./render.mjs";
import { hasCodex, codexPausedUntil } from "./codex.mjs";
import { findDeepFilter } from "./studio.mjs";
import { nativeTool } from "./native-tool.mjs";
import { isClientMode } from "./client-mode.mjs";
import { currentRelease, verifyRelease } from "./release.mjs";

export function releaseSection({ app = PKG_ROOT } = {}) {
  try {
    const release = currentRelease({ app });
    if (release.id === "dev") return "Release: dev";
    const files = release.verified ? "files verified" : `changed or missing files: ${verifyRelease({ app }).join(", ")}`;
    return `Release: ${release.id} (${release.commit.slice(0, 7)}), runtime ${release.runtime.id}, ${files}`;
  } catch { return "Release: saved release details could not be read; run your kit's installer again"; }
}

/** `reel doctor --release-only`: the local release check the updater runs after a switch. No services, no sign-ins. */
export function releaseOnly({ app = PKG_ROOT } = {}) {
  const line = releaseSection({ app });
  console.log(line);
  return /files verified$|^Release: dev$/.test(line);
}

async function ok(cmd, args) {
  try {
    await run(cmd, args, { capture: true });
    return true;
  } catch {
    return false;
  }
}

export async function doctor() {
  console.log(releaseSection());
  const rows = [];
  rows.push(["ffmpeg", await ok("ffmpeg", ["-version"]) ? "ok" : "MISSING (brew install ffmpeg)"]);
  rows.push(["ffprobe", await ok("ffprobe", ["-version"]) ? "ok" : "MISSING"]);
  const py = process.env.REEL_PYTHON || "python3";
  rows.push([`${py} faster-whisper`, await ok(py, ["-c", "import faster_whisper"]) ? "ok" : "MISSING (pip install faster-whisper)"]);
  const dfn = findDeepFilter();
  rows.push(["deep-filter (studio sound)", dfn ? `ok (${dfn})` : "not installed: scripts/install-deepfilter.sh (the spectral denoiser is used until then)"]);
  const helpers = ["faces", "matte", "person", "speakers", "featureprint", "ocr", "dhash", "photosheet", "photofinish", "reactions"];
  const missing = (await Promise.all(helpers.map(async (name) => {
    try { await nativeTool(name); return null; } catch { return name; }
  }))).filter(Boolean);
  if (!missing.length) rows.push(["built-in tools", "ok"]);
  else if (isClientMode()) rows.push(["built-in tools", "Some tools are missing or out of date. Reinstall Reel Editor."]);
  else rows.push(["swiftc (faces, speakers, cutout)", await ok("xcrun", ["--find", "swiftc"]) ? "ok" : "MISSING (xcode-select --install)"]);
  let bin;
  try {
    bin = hyperframesBin();
    rows.push(["hyperframes", bin.length === 1 ? `ok (${bin[0]})` : "not installed locally; falls back to npx (run npm install)"]);
  } catch (error) { rows.push(["hyperframes", error.message]); }
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
  if (!bin) return;
  try {
    await run(bin[0], [...bin.slice(1), "doctor"], { env: renderEnv() });
  } catch (e) {
    console.log("  hyperframes doctor reported problems (see above)");
  }
}
