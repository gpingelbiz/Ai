import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { clientStatus } from "../src/client-status.mjs";

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "status-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, "Content Studio");
  return { home, root, state: path.join(root, ".studio") };
}

test("the first status line keeps the check time, release and one action from any part", (t) => {
  const paths = fixture(t), now = new Date("2030-01-02T12:00Z");
  clientStatus(paths, "publish", "Posting confirmation needs attention.", now, { action: "Check this reel in Metricool before trying again." });
  clientStatus(paths, "editing", "All good", now);
  const text = fs.readFileSync(path.join(paths.root, "STATUS.txt"), "utf8");
  assert.match(text.split("\n")[0], /^2030-01-02T12:00:00.000Z Reel Editor \(release dev\) Check this reel in Metricool before trying again\.$/);
  assert.match(text, /publish: Posting confirmation needs attention/);
  assert.match(text, /editing: All good/);
  clientStatus(paths, "publish", "Scheduled", now);
  assert.match(fs.readFileSync(path.join(paths.root, "STATUS.txt"), "utf8").split("\n")[0], /All good$/);
});

test("simultaneous status writers retain every line and update both status views", async (t) => {
  const paths = fixture(t), gate = path.join(paths.home, "start");
  const moduleURL = new URL("../src/client-status.mjs", import.meta.url).href;
  clientStatus(paths, "editing", "All good");
  const jobs = ["editing", "posting", "update", "storage", "filming", "daily", "publish", "health"];
  const children = jobs.map((job) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import fs from "node:fs";
      import { clientStatus } from ${JSON.stringify(moduleURL)};
      while (!fs.existsSync(process.argv[1])) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      clientStatus(JSON.parse(process.argv[2]), process.argv[3], "saved " + process.argv[3]);
    `, gate, JSON.stringify(paths), job], { env: { HOME: paths.home, PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(Error(err)));
  }));
  fs.writeFileSync(gate, "go");
  await Promise.all(children);
  const text = fs.readFileSync(path.join(paths.root, "STATUS.txt"), "utf8");
  for (const job of jobs) assert.ok(text.includes(`${job}: saved ${job}`), job);
  assert.equal(fs.readFileSync(path.join(paths.home, ".reel/maintenance/STATUS.txt"), "utf8"), text);
  const dir = path.join(paths.home, ".reel/maintenance/status");
  assert.deepEqual(fs.readdirSync(dir).filter((f) => !f.startsWith(".")).sort(), ["editing.json", "posting.json", "storage.json", "updates.json"]);
});

test("a dead status writer can be recovered without discarding its saved parts", (t) => {
  const paths = fixture(t);
  clientStatus(paths, "posting", "Keep this line");
  const lock = path.join(paths.home, ".reel/maintenance/status/.compose.lock");
  fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, "owner.json"), '{"pid":2147483647}');
  clientStatus(paths, "editing", "New line");
  const text = fs.readFileSync(path.join(paths.root, "STATUS.txt"), "utf8");
  assert.match(text, /Keep this line/); assert.match(text, /New line/);
});
