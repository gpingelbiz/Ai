import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import { log, ensureDir } from "./util.mjs";

/**
 * Codex CLI, headless (`codex exec`): text jobs with a JSON schema, and images from its built-in image tool.
 * Runs on the signed-in ChatGPT plan, so there is no API key and no per-image bill.
 *
 * Model: REEL_CODEX_MODEL when set. Otherwise the Codex config default first, then gpt-5.6-sol: some config
 * defaults (gpt-6.1-sol) are refused on a ChatGPT login when run headless, and the first model that works is
 * remembered for the rest of the run.
 */
const FALLBACK_MODELS = [null, "gpt-5.6-sol"];
let workingModel;

export function codexModels(env = process.env) {
  if (env.REEL_CODEX_MODEL) return [env.REEL_CODEX_MODEL];
  if (workingModel !== undefined) return [workingModel];
  return FALLBACK_MODELS;
}

export function hasCodex(env = process.env) {
  const bin = env.REEL_CODEX_BIN || "codex";
  if (bin.includes("/")) return fs.existsSync(bin);
  return (env.PATH || "").split(":").some((d) => d && fs.existsSync(path.join(d, bin)));
}

/**
 * Rate limits: the ChatGPT plan caps Codex use, and other jobs (lead ops) share the same account. The first 429
 * pauses every Codex call from the editor for COOLDOWN_MIN minutes, saved to a file so the next drop waits too,
 * instead of retrying into the limit.
 */
const COOLDOWN_MIN = 30;
export const cooldownFile = (env = process.env) => env.REEL_CODEX_COOLDOWN_FILE || path.join(os.homedir(), ".cache", "reel-editor", "codex-cooldown");
export const isRateLimit = (text) => /\b429\b|too many requests|rate.?limit|usage limit/i.test(String(text));

export function codexPausedUntil(now = Date.now(), env = process.env) {
  try {
    const until = parseInt(fs.readFileSync(cooldownFile(env), "utf8"), 10);
    return until > now ? until : 0;
  } catch {
    return 0;
  }
}

function pauseCodex(env = process.env) {
  const until = Date.now() + COOLDOWN_MIN * 60000;
  try { ensureDir(path.dirname(cooldownFile(env))); fs.writeFileSync(cooldownFile(env), String(until)); } catch {}
  log(`codex: rate-limited by the ChatGPT plan; no more Codex calls from the editor until ${new Date(until).toLocaleTimeString()}`);
}

export class CodexLimited extends Error {}

/** A model the account cannot use: worth trying the next one. Anything else is a real failure. */
export const isModelRefusal = (text) => /not supported|unsupported model|model .*(not found|does not exist|not available)|does not have access to model/i.test(String(text));

function runCodex(args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.REEL_CODEX_BIN || "codex", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`codex timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(Object.assign(new Error(`codex exited ${code}: ${(err || out).trim().split("\n").slice(-3).join(" ").slice(0, 400)}`), { output: out + err }));
    });
  });
}

/** One `codex exec` run in `cwd` (the only folder it may write). Returns the final message text. */
export async function codexExec(prompt, { cwd, schema, timeoutMs = 300000 } = {}) {
  const paused = codexPausedUntil();
  if (paused) throw new CodexLimited(`Codex is paused after a rate limit until ${new Date(paused).toLocaleTimeString()}`);
  ensureDir(cwd);
  const last = path.join(cwd, `.codex-last-${process.pid}-${Date.now()}.txt`);
  let schemaFile = null;
  if (schema) {
    schemaFile = path.join(cwd, `.codex-schema-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(schemaFile, JSON.stringify(schema));
  }
  let lastErr;
  try {
    for (const model of codexModels()) {
      const args = ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "workspace-write", "--color", "never", "-C", cwd, "-o", last];
      if (model) args.push("-m", model);
      if (schemaFile) args.push("--output-schema", schemaFile);
      args.push(prompt);
      try {
        await runCodex(args, { timeoutMs });
        workingModel = model;
        return fs.existsSync(last) ? fs.readFileSync(last, "utf8") : "";
      } catch (e) {
        lastErr = e;
        if (isRateLimit(e.output || e.message)) {
          pauseCodex();
          throw new CodexLimited("Codex hit the ChatGPT plan's rate limit");
        }
        if (!isModelRefusal(e.output || e.message)) throw e;
        log(`codex: model ${model || "(config default)"} refused on this account, trying the next one`);
      }
    }
    throw lastErr;
  } finally {
    fs.rmSync(last, { force: true });
    if (schemaFile) fs.rmSync(schemaFile, { force: true });
  }
}

/** Rules every generated still follows: nothing that reads as a real person, no text the eye tries to read. */
export const IMAGE_RULES = [
  "Photorealistic, cinematic, shallow depth of field, natural light, like a frame from a well-shot documentary.",
  "No faces. If a person helps the shot, show only hands, a silhouette, or someone from behind, never a recognizable face, and never anyone posed as the speaker.",
  "No readable text, letters, numbers, logos, brand names or UI labels anywhere in the image; screens and papers show only blurred or abstract shapes.",
];

export function imagePrompt(scene, { aspect = "9:16", style = "" } = {}) {
  const shape = aspect === "9:16" ? "vertical 9:16" : aspect === "4:5" ? "portrait 4:5" : aspect;
  return [
    "Use your image generation tool exactly once.",
    `Make one ${shape} image: ${String(scene).trim().replace(/\.$/, "")}.`,
    style ? `Look: ${style}` : "",
    ...IMAGE_RULES,
    "Save the image in the current folder as image.png. Do not write any other files and do not run anything else.",
  ].filter(Boolean).join("\n");
}

/** Generate one still with Codex's image tool and move it to `outPath` (a .png). */
export async function codexImage(scene, outPath, { aspect = "9:16", style = "", timeoutMs = 240000 } = {}) {
  const dir = ensureDir(path.join(path.dirname(outPath), `.codex-${path.basename(outPath, path.extname(outPath))}`));
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  try {
    await codexExec(imagePrompt(scene, { aspect, style }), { cwd: dir, timeoutMs });
    const made = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => path.join(dir, f));
    if (!made.length) throw new Error("codex finished without saving an image");
    made.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    fs.renameSync(made[0], outPath);
    return outPath;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Run `fn` over `items` with at most `n` at a time; results keep the input order, failures come back as Error. */
export async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (e) { results[i] = e instanceof Error ? e : new Error(String(e)); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}
