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
const COOLDOWN_MIN = 20;
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
/**
 * OpenAI structured output (`codex --output-schema`) rejects a schema whose `required` misses any property
 * (a live 400 on 2026-11-02 broke the b-roll picks and the carousel slides). Every property becomes required; one
 * that was optional becomes nullable, and its nulls are stripped from the reply again so callers see it left out.
 */
export function strictSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const out = Array.isArray(schema) ? schema.map(strictSchema) : { ...schema };
  if (out.properties) {
    const required = new Set(out.required || []);
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => {
      const strict = strictSchema(v);
      if (required.has(k)) return [k, strict];
      const type = strict.type ? [...new Set([...(Array.isArray(strict.type) ? strict.type : [strict.type]), "null"])] : undefined;
      return [k, { ...strict, ...(type ? { type } : {}), ...(strict.enum ? { enum: [...new Set([...strict.enum, null])] } : {}) }];
    }));
    out.required = Object.keys(out.properties);
  }
  if (out.items) out.items = strictSchema(out.items);
  return out;
}

/** Drop the nulls `strictSchema` allowed for properties the original schema left optional. */
export function stripOptionalNulls(value, schema) {
  if (Array.isArray(value)) return value.map((v) => stripOptionalNulls(v, schema?.items));
  if (!value || typeof value !== "object" || !schema?.properties) return value;
  const required = new Set(schema.required || []);
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => !(v === null && !required.has(k))).map(([k, v]) => [k, stripOptionalNulls(v, schema.properties[k])]));
}

export async function codexExec(prompt, { cwd, schema, timeoutMs = 300000 } = {}) {
  const paused = codexPausedUntil();
  if (paused) throw new CodexLimited(`Codex is paused after a rate limit until ${new Date(paused).toLocaleTimeString()}`);
  ensureDir(cwd);
  const last = path.join(cwd, `.codex-last-${process.pid}-${Date.now()}.txt`);
  let schemaFile = null;
  if (schema) {
    schemaFile = path.join(cwd, `.codex-schema-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(schemaFile, JSON.stringify(strictSchema(schema)));
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
        const text = fs.existsSync(last) ? fs.readFileSync(last, "utf8") : "";
        if (!schema) return text;
        try { return JSON.stringify(stripOptionalNulls(JSON.parse(text), schema)); } catch { return text; }
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

/**
 * Rules every generated still follows. The look is a candid documentary photo, not a render: one named practical
 * light, mixed colour temperatures, worn surfaces, grain and halation, nothing retouched. The known AI tells (a
 * uniform golden glow, plastic surfaces, symmetry, a centred subject, invented text) are banned outright, and the
 * bottom third stays plain and dark for the captions.
 */
export const IMAGE_STYLE = "Candid documentary photograph, 35mm feel, handheld, as if shot on a phone. One practical light source, named and placed (an overhead shop fluorescent, a dash light at dusk, a single window from camera left); mixed warm and cool colour temperatures; deep shadows that fall off naturally; muted, desaturated colour; worn, scuffed, slightly dusty surfaces; fine film grain; soft halation on the highlights; no retouching, no stylization.";
export const RUNWAY_STYLE = "Photoreal, natural colour with real saturation, daylight or one clear practical light. The subject is sharp and big in frame, shallow depth of field, no text.";
export const IMAGE_RULES = [
  "No people, no faces, no hands with visible fingers, no silhouettes, nobody who could read as the speaker.",
  "No text, letters, numbers, logos, signage or UI labels anywhere; screens and papers show only blurred or abstract shapes.",
  "No symmetry, no centred subject, no golden glow, no clean studio lighting, no neon, no purple, no pastel, no plastic-smooth surfaces.",
  "The subject sits in the upper two thirds of the frame; the bottom third stays plain and dark (captions go there). Vertical 9:16.",
  "Kill test: if the result could be captioned \"stock photo of X\", it is wrong; make it a specific, lived-in object or process shot instead.",
];

/**
 * The image half of a prompt: draw each listed scene with the image tool, one call per scene, in order, and save
 * them in the current folder under the given names. One Codex session does all of a reel's images: every
 * session costs a full setup prompt, and separate sessions back to back trip the plan's rate limit.
 */
export function imageInstructions({ aspect = "9:16", style = "" } = {}) {
  const shape = aspect === "9:16" ? "vertical 9:16 (1080x1920)" : aspect === "4:5" ? "portrait 4:5 (1080x1350)" : aspect === "16:9" ? "wide landscape 16:9 (1920x1080, wider than it is tall)" : aspect;
  return [
    `Then make the images: for each scene, use your image generation tool once to make a ${shape} image of it, one at a time, and save it in the current folder under the file name given. If one image fails, skip it and keep going; never retry more than once.`,
    `Look for every image: ${style || IMAGE_STYLE}`,
    "Rules for every image:",
    ...IMAGE_RULES.map((r) => `- ${r}`),
    "Do not write any other files and do not run anything else.",
  ].filter(Boolean).join("\n");
}

/** Image files Codex saved in `dir`, by name, that are real images (not empty), with OpenAI's C2PA stripped. */
export function savedImage(dir, name) {
  const f = path.join(dir, name);
  try { if (fs.statSync(f).size <= 1000) return null; } catch { return null; }
  try { stripC2pa(f); } catch (e) { log(`could not strip C2PA from ${f}: ${e.message}`); }
  return f;
}

/**
 * Codex's image tool signs every image with OpenAI's C2PA Content Credentials (Greg 2026-11-02: strip them).
 * Drops the manifest only (PNG caBX chunk, JPEG APP11 segment); pixels and colour chunks stay byte for byte.
 * Returns true when the file was rewritten.
 */
export function stripC2pa(file) {
  const data = fs.readFileSync(file), keep = [];
  let i, dropped = false;
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    keep.push(data.subarray(0, 8));
    for (i = 8; i + 8 <= data.length;) {
      const n = data.readUInt32BE(i), type = data.toString("latin1", i + 4, i + 8), end = i + 12 + n;
      if (end > data.length) return false;
      if (type === "caBX") dropped = true; else keep.push(data.subarray(i, end));
      i = end;
      if (type === "IEND") break;
    }
    keep.push(data.subarray(i));
  } else if (data[0] === 0xff && data[1] === 0xd8) {
    keep.push(data.subarray(0, 2));
    for (i = 2; i + 4 <= data.length && data[i] === 0xff && data[i + 1] !== 0xda;) {
      const end = i + 2 + data.readUInt16BE(i + 2);
      if (end > data.length) return false;
      if (data[i + 1] === 0xeb) dropped = true; else keep.push(data.subarray(i, end));
      i = end;
    }
    keep.push(data.subarray(i));
  } else return false;
  if (!dropped) return false;
  const tmp = `${file}.strip-${process.pid}`;
  fs.writeFileSync(tmp, Buffer.concat(keep));
  fs.renameSync(tmp, file);
  return true;
}
