import fs from "node:fs";
import path from "node:path";
import { run, log, warn, PKG_ROOT } from "./util.mjs";

export function hyperframesBin() {
  const local = path.join(PKG_ROOT, "node_modules", ".bin", "hyperframes");
  return fs.existsSync(local) ? [local] : ["npx", "hyperframes"];
}

export function renderEnv() {
  const env = {};
  if (process.env.REEL_BROWSER_PATH) env.HYPERFRAMES_BROWSER_PATH = process.env.REEL_BROWSER_PATH;
  // Hardware GPU capture by default (the watcher sets it too); REEL_SW_RENDER=1 forces software.
  if (!process.env.PRODUCER_BROWSER_GPU_MODE) env.PRODUCER_BROWSER_GPU_MODE = process.env.REEL_SW_RENDER === "1" ? "software" : "hardware";
  return env;
}

/** Lint + runtime + layout check. Non-fatal: counts are printed, lint errors are listed. */
export async function check(projectDir) {
  const bin = hyperframesBin();
  let raw = "";
  try {
    const { out } = await run(bin[0], [...bin.slice(1), "check", projectDir, "--json", "--no-contrast", "--samples", "5"], { capture: true, allowFail: true, env: renderEnv() });
    raw = out;
  } catch (e) {
    warn("check could not run:", e.message.split("\n")[0]);
    return null;
  }
  const start = raw.indexOf("{");
  let j = null;
  if (start >= 0) {
    try {
      j = JSON.parse(raw.slice(start));
    } catch {}
  }
  if (!j) {
    warn("check returned no parseable JSON; run `npx hyperframes check " + projectDir + "` to see it");
    return null;
  }
  const flat = [];
  const walk = (v, section) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, section));
    else if (v && typeof v === "object") {
      if (v.severity || v.level) flat.push({ ...v, section });
      else for (const [k, x] of Object.entries(v)) walk(x, section || k);
    }
  };
  walk(j, null);
  const errors = flat.filter((i) => /error/i.test(i.severity || i.level || ""));
  const warnings = flat.length - errors.length;
  log(`check: ${errors.length} error(s), ${warnings} warning(s)`);
  for (const i of errors) log(`  error [${i.section || "check"}]: ${i.rule || i.id || i.code || ""} ${i.message || ""}`.trim());
  if (process.env.REEL_DEBUG) for (const i of flat) if (!errors.includes(i)) log(`  ${i.severity || i.level} [${i.section || ""}]: ${i.rule || i.id || i.code || ""} ${i.message || ""}`.trim());
  return { errors: errors.length, warnings };
}

export async function render(projectDir, output, { quality = "looks", fps } = {}) {
  const bin = hyperframesBin();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const args = [...bin.slice(1), "render", projectDir, "-o", output, "-q", quality];
  if (fps) args.push("-f", String(fps));
  // GPU encoding on a Mac (VideoToolbox): same look, faster final encode. REEL_SW_ENCODE=1 keeps libx264.
  if (process.platform === "darwin" && process.env.REEL_SW_ENCODE !== "1") args.push("--gpu");
  await run(bin[0], args, { env: renderEnv() });
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error(`render produced no file at ${output}`);
  return output;
}
