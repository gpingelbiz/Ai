#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PKG_ROOT } from "../src/util.mjs";

export function checkRuntime({ app = PKG_ROOT, env = process.env, run = spawnSync } = {}) {
  if (!env.REEL_RUNTIME) {
    if (env.REEL_RELEASE && env.REEL_RELEASE !== "dev") throw new Error("The editor's local tools are missing. Run your installer again.");
    return; // Older git installs still use their existing tools.
  }
  const runtime = env.REEL_RUNTIME;
  const spec = JSON.parse(fs.readFileSync(path.join(app, "runtime/runtime.json")));
  if (path.basename(runtime) !== spec.id || !fs.existsSync(path.join(runtime, ".complete"))) throw new Error("The editor's local tools are not ready. Run your installer again.");
  const offline = { ...env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" };
  const exec = (bin, args) => {
    const r = run(bin, args, { env: offline, encoding: "utf8", timeout: 60000 });
    if (r.status !== 0) throw new Error(`The editor could not check ${path.basename(bin)}. Run your installer again.`);
    return String(r.stdout || r.stderr || "").trim();
  };
  for (const name of ["node", "ffmpeg", "ffprobe"]) {
    const out = exec(path.join(runtime, "bin", name), [name === "node" ? "--version" : "-version"]);
    const version = name === "node" ? out.match(/^v(\S+)$/)?.[1] : out.match(new RegExp(`^${name} version (\\S+)`))?.[1];
    if (version !== spec.tools[name].version) throw new Error(`The editor has a different ${name} version from the tested one. Run your installer again.`);
  }
  const python = path.join(runtime, "venv/bin/python");
  if (exec(python, ["--version"]) !== `Python ${spec.python.version}`) throw new Error("The editor has a different Python version from the tested one. Run your installer again.");
  exec(python, ["-c", "import faster_whisper"]);
}

export async function clientSmoke({ app = PKG_ROOT, env = process.env, run = spawnSync } = {}) {
  checkRuntime({ app, env, run });
  for (const dir of ["src", "scripts", "bin"]) {
    for (const file of fs.readdirSync(path.join(app, dir)).filter((f) => f.endsWith(".mjs"))) {
      const r = run(env.REEL_RUNTIME ? path.join(env.REEL_RUNTIME, "bin/node") : process.execPath, ["--check", path.join(app, dir, file)], { env, encoding: "utf8", timeout: 60000 });
      if (r.status !== 0) throw new Error(`The editor could not check ${file}. Run your installer again.`);
    }
  }
  import.meta.resolve("hyperframes/api");
  const { normalizeSlideSpec } = await import("../src/slides.mjs");
  const { withDefaults, checkStudio } = await import("../src/content-studio.mjs");
  const { postInput } = await import("../src/studio-metricool.mjs");
  if (checkStudio(withDefaults({ client: "Smoke" }), { publishing: false }).length) throw new Error("studio defaults failed");
  normalizeSlideSpec({ width: 1080, height: 1920, slides: [{ kind: "body", headline: "Which would you pick?" }] });
  const info = JSON.parse(postInput({ blogId: "offline", day: "2026-11-03", time: "12:00", tz: "UTC", media: [], text: "", kind: "story" }).info);
  if (info.instagramData.type !== "STORY") throw new Error("story adapter failed");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  clientSmoke().then(() => console.log("Client offline self-check passed.")).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
