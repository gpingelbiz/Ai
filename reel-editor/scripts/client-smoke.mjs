#!/usr/bin/env node
// Offline update gate. Do not use doctor here: optional services are not update failures.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PKG_ROOT } from "../src/util.mjs";
import { normalizeSlideSpec } from "../src/slides.mjs";
import { withDefaults, checkStudio } from "../src/content-studio.mjs";
import { postInput } from "../src/studio-metricool.mjs";
for (const dir of ["src", "scripts", "bin"]) {
  for (const file of fs.readdirSync(path.join(PKG_ROOT, dir)).filter((f) => f.endsWith(".mjs"))) {
    const r = spawnSync(process.execPath, ["--check", path.join(PKG_ROOT, dir, file)], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr || `${file} syntax check failed`);
  }
}
import.meta.resolve("hyperframes/api");
if (checkStudio(withDefaults({ client: "Smoke" }), { publishing: false }).length) throw new Error("studio defaults failed");
normalizeSlideSpec({ width: 1080, height: 1920, slides: [{ kind: "body", headline: "Which would you pick?" }] });
const info = JSON.parse(postInput({ blogId: "offline", day: "2026-11-03", time: "12:00", tz: "UTC", media: [], text: "", kind: "story" }).info);
if (info.instagramData.type !== "STORY") throw new Error("story adapter failed");
console.log("Client offline self-check passed.");
