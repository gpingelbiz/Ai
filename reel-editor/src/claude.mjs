import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/**
 * Claude Code headless (`claude -p`) for text-only jobs: no built-in tools and no MCP servers, so it can only
 * read the prompt and answer. Runs on the signed-in Claude account. REEL_CLAUDE_BIN overrides the binary.
 */
export function hasClaude(env = process.env) {
  const bin = env.REEL_CLAUDE_BIN || "claude";
  if (bin.includes("/")) return fs.existsSync(bin);
  return (env.PATH || "").split(":").some((d) => d && fs.existsSync(path.join(d, bin)));
}

export function claudeText(prompt, { timeoutMs = 240000, model } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--tools", "", "--strict-mcp-config", "--output-format", "text"];
    if (model || process.env.REEL_CLAUDE_MODEL) args.push("--model", model || process.env.REEL_CLAUDE_MODEL);
    const child = spawn(process.env.REEL_CLAUDE_BIN || "claude", args, { stdio: ["ignore", "pipe", "pipe"], cwd: os.tmpdir() });
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
