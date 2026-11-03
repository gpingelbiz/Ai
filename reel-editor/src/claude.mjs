import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/**
 * Claude Code headless (`claude -p`) for text-only jobs: no built-in tools and no MCP servers, so it can only
 * read the prompt and answer. Runs on the signed-in Claude account. REEL_CLAUDE_BIN overrides the binary.
 */
function executable(file, disk) {
  try { disk.accessSync(file, fs.constants.X_OK); return disk.statSync(file).isFile(); } catch { return false; }
}

/** Background shells may not load the profile that adds Claude's installer directory to PATH. */
export function claudeBinary(env = process.env, { fs: disk = fs, homedir = os.homedir } = {}) {
  if (env.REEL_CLAUDE_BIN) return env.REEL_CLAUDE_BIN;
  const candidates = (env.PATH || "").split(path.delimiter).filter(Boolean).map((d) => path.resolve(d, "claude"));
  const home = env.HOME || homedir();
  candidates.push(path.join(home, ".local/bin/claude"), path.join(home, ".claude/local/claude"));
  return candidates.find((file) => executable(file, disk)) || "claude";
}

export function hasClaude(env = process.env, deps = {}) {
  const bin = claudeBinary(env, deps), disk = deps.fs || fs;
  if (bin.includes("/")) return executable(bin, disk);
  return (env.PATH || "").split(path.delimiter).some((d) => d && executable(path.join(d, bin), disk));
}

export function claudeText(prompt, { timeoutMs = 240000, model, deps = {} } = {}) {
  return claudeRun(["-p", prompt, "--tools", "", "--strict-mcp-config", "--output-format", "text"], { timeoutMs, model, cwd: os.tmpdir(), deps });
}

/**
 * The same, with only the Read tool, run inside `cwd`: for jobs that have to look at pictures there (frames of a
 * b-roll clip). The prompt names the files to read.
 */
export function claudeLook(prompt, { cwd, timeoutMs = 180000, model, deps = {} } = {}) {
  return claudeRun(["-p", prompt, "--tools", "Read", "--allowedTools", "Read", "--strict-mcp-config", "--output-format", "text"], { timeoutMs, model, cwd, deps });
}

function claudeRun(args, { timeoutMs, model, cwd, deps }) {
  return new Promise((resolve, reject) => {
    const env = deps.env || process.env;
    if (model || env.REEL_CLAUDE_MODEL) args.push("--model", model || env.REEL_CLAUDE_MODEL);
    const child = (deps.spawn || spawn)(claudeBinary(env, deps), args, { stdio: ["ignore", "pipe", "pipe"], cwd, env });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(-300)}`)); });
  });
}

/** The first JSON object in a reply (Claude sometimes wraps it in prose or a code fence). */
export function firstJSON(text) {
  const s = String(text);
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in the reply");
  return JSON.parse(s.slice(a, b + 1));
}
