import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PKG_ROOT, run, readJSON, writeJSON } from "./util.mjs";
import { normalizeWords } from "./transcribe.mjs";
import { probe } from "./probe.mjs";
import { loadPreset } from "./presets.mjs";
import { groupWords } from "./captions.mjs";
import { composeProject } from "./compose.mjs";
import { renderEnv } from "./render.mjs";

const token = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Missing words are allowed; reordered words and invented timestamps cannot pass. */
export function checkSpeech(words, expected, duration) {
  let start = -1, end = -1;
  if (!words.length || !expected.length) throw new Error("No spoken words were found.");
  for (const w of words) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end <= w.start || w.start <= start || w.end <= end || w.end > duration + 0.25) {
      throw new Error("The spoken words have incorrect times.");
    }
    start = w.start; end = w.end;
  }
  const want = expected.map(token), heard = words.map((w) => token(w.text));
  // Longest common subsequence counts the expected words heard in the right order.
  let row = Array(want.length + 1).fill(0);
  for (const word of heard) {
    const next = [0];
    for (let i = 1; i <= want.length; i++) next[i] = word === want[i - 1] ? row[i - 1] + 1 : Math.max(row[i], next[i - 1]);
    row = next;
  }
  const matched = row[want.length], ratio = matched / want.length;
  if (ratio < 0.8) throw new Error("Too few of the spoken words were recognized in order.");
  return { matched, expected: want.length, ratio, timings: true };
}

async function localWhisper(input, { out, model, revision, env, run: execute = run }) {
  // Resolve the pinned snapshot from disk only, even if a newer model is cached too.
  const code = [
    "import runpy, sys",
    "from huggingface_hub import snapshot_download",
    "model = snapshot_download(repo_id=sys.argv[1], revision=sys.argv[2], local_files_only=True)",
    "sys.argv = [sys.argv[3], *sys.argv[4:], '--model', model]",
    "runpy.run_path(sys.argv[0], run_name='__main__')",
  ].join("\n");
  await execute(env.REEL_PYTHON || "python3", ["-c", code, model, revision, path.join(PKG_ROOT, "scripts/transcribe_words.py"), input, "-o", out, "--lang", "en"], { env, capture: true });
  return normalizeWords(readJSON(out));
}

async function localRender(project, output, { env, run: execute = run }) {
  const binary = path.join(PKG_ROOT, "node_modules/.bin/hyperframes");
  if (!fs.existsSync(binary)) throw new Error("The installed renderer is missing. Run this kit's installer again.");
  let browser = env.REEL_BROWSER_PATH || env.HYPERFRAMES_BROWSER_PATH;
  if (!browser) {
    const { getInstalledBrowsers, detectBrowserPlatform, Browser } = await import("@puppeteer/browsers");
    const installed = await getInstalledBrowsers({ cacheDir: path.join(env.HOME, ".cache/hyperframes/chrome") });
    browser = installed.filter((b) => b.browser === Browser.CHROMEHEADLESSSHELL && b.platform === detectBrowserPlatform())
      .sort((a, b) => b.buildId.localeCompare(a.buildId, "en", { numeric: true }))[0]?.executablePath;
  }
  // HyperFrames otherwise downloads a browser during render when its cache is empty.
  if (!browser || !fs.existsSync(browser) || !fs.statSync(browser).size) throw new Error("The installed render browser is missing. Run this kit's installer again.");
  const args = ["render", project, "-o", output, "-q", "looks", "-f", "30"];
  if (process.platform === "darwin" && env.REEL_SW_ENCODE !== "1") args.push("--gpu");
  await execute(binary, args, { env: { ...renderEnv(), ...env, HYPERFRAMES_BROWSER_PATH: browser }, capture: true });
}

/** Exercise only local speech, captions and rendering. No general editing or service planners run here. */
export async function runAcceptance({ home = os.homedir(), env = process.env, deps = {} } = {}) {
  const dir = path.join(home, "Reels/install-test");
  fs.mkdirSync(dir, { recursive: true });
  const result = { schema: 1, ok: false, release: env.REEL_RELEASE || "dev", checkedAt: new Date().toISOString(), checks: {} };
  const offline = { ...env, HOME: home, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", TRANSFORMERS_OFFLINE: "1", HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", PRODUCER_BROWSER_GPU_MODE: "hardware" };
  const execute = deps.run || run;
  const inspect = deps.probe || probe;
  let stage = "Preparing the editing check", work;
  try {
    work = fs.mkdtempSync(path.join(dir, ".accept-"));
    const script = readJSON(path.join(PKG_ROOT, "examples/accept/script.json"));
    const runtime = readJSON(path.join(PKG_ROOT, "runtime/runtime.json"));
    const speech = path.join(work, "speech.aiff"), picture = path.join(work, "picture.png"), input = path.join(work, "sample.mp4");
    const output = path.join(work, "accept.mp4");
    stage = "Making the spoken sample";
    await execute("say", ["-o", speech, "-r", "150", script.sentence], { env: offline, capture: true });
    stage = "Making the test picture";
    await execute("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x303840:s=1080x1920", "-frames:v", "1", "-threads", "1", picture], { env: offline, capture: true });
    stage = "Adding the speech to the picture";
    await execute("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-loop", "1", "-i", picture, "-i", speech, "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-shortest", input], { env: offline, capture: true });
    const meta = await inspect(input);
    if (!meta.hasAudio || meta.width !== 1080 || meta.height !== 1920 || !Number.isFinite(meta.duration) || meta.duration < 1 || meta.duration > 30) throw new Error("The spoken sample could not be read.");
    result.checks.sample = true;
    stage = "Reading the speech on this Mac";
    const words = await (deps.transcribe || localWhisper)(input, { engine: "faster-whisper", model: runtime.whisper.model, revision: runtime.whisper.revision, language: "en", out: path.join(work, "words.json"), env: offline, run: execute });
    result.checks.speech = checkSpeech(words, script.expectedWords, meta.duration);
    stage = "Rendering the editing check";
    const style = loadPreset("clean");
    style.signature.enabled = false;
    style.transcribe = { ...style.transcribe, engine: "faster-whisper", fix: false, align: false, verify: false };
    const plan = {
      version: 1, name: "Editing check", preset: "clean", source: input,
      video: { src: input, ...meta }, canvas: { width: 1080, height: 1920 }, style,
      words, captions: groupWords(words, meta.duration, style.captions),
      hook: null, cta: null, broll: [], graphics: [], slams: [], icons: [], zooms: [], audio: { tracks: [] },
    };
    const project = path.join(work, "project");
    (deps.compose || composeProject)(plan, project);
    await (deps.render || localRender)(project, output, { env: offline, run: execute });
    stage = "Checking the finished video";
    const finished = await inspect(output);
    if (!finished.hasAudio || finished.width !== 1080 || finished.height !== 1920 || !Number.isFinite(finished.duration) || finished.duration < 1 || Math.abs(finished.duration - meta.duration) > Math.max(0.5, meta.duration * 0.05)) {
      throw new Error("The finished video has the wrong picture, sound or length.");
    }
    result.checks.video = { width: finished.width, height: finished.height, duration: finished.duration, audio: true };
    const delivered = path.join(dir, "accept.mp4");
    fs.renameSync(output, delivered);
    result.output = delivered;
    result.ok = true;
  } catch (error) {
    result.error = `${stage} did not finish. Run this kit's installer again.`;
    result.detail = String(error.message).split("\n")[0];
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
  }
  writeJSON(path.join(dir, "accept.json"), result);
  return result;
}

export async function acceptCommand(args = [], { accept = runAcceptance, print = console.log, printError = console.error } = {}) {
  if (args.some((arg) => arg !== "--json") || args.length > 1) throw new Error("Use reel accept or reel accept --json.");
  const result = await accept();
  if (args.includes("--json")) print(JSON.stringify(result));
  else if (result.ok) print(`Editing ready (release ${result.release})`);
  else printError(result.error);
  return result.ok ? 0 : 1;
}
