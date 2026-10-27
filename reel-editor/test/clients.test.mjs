import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clientPaths, clientEnv, agentPlist, DROP_FOLDERS } from "../src/clients.mjs";
import { brandPreset } from "../src/brandkit.mjs";
import { looksPrompt, pickLook } from "../src/looks.mjs";
import { buildPrompt } from "../scripts/write-caption.mjs";

const brand = { name: "Jane Doe", handle: "@janedoe", colors: { text: "#FFFFFF", accent: "#E94B8A" } };

test("client paths: a root of its own under the clients folder, finished reels in Desktop/Reels/Clients/<Name>", () => {
  const p = clientPaths(brand, { REEL_CLIENTS: "/x/clients", REEL_CLIENTS_DESKTOP: "/d/Clients" });
  assert.equal(p.root, "/x/clients/jane-doe");
  assert.equal(p.desktop, "/d/Clients/Jane Doe");
  assert.equal(p.drops.length, 6);
  assert.equal(p.label, "com.pingel.reel-watch.client.jane-doe");
});

test("client.env sets every setting that has a Greg default, so ~/.zshrc can never fill one in", () => {
  const p = clientPaths(brand, { REEL_CLIENTS: "/x/clients", REEL_CLIENTS_DESKTOP: "/d/Clients" });
  const env = clientEnv({ ...brand, name: "Jane O'Doe" }, p);
  for (const k of ["REEL_PRESET", "REEL_YOUTUBE_PRESET", "REEL_DICTIONARY", "REEL_CAPTION_VOICE", "REEL_CACHE", "REEL_WATCH_ROOT", "REEL_WATCH_DONE", "REEL_WATCH_MUSIC", "REEL_WATCH_CTA"]) assert.match(env, new RegExp(`^${k}=`, "m"), k);
  assert.match(env, /^REEL_WATCH_CTA=''$/m, "no CTA unless the brand file names one");
  assert.match(env, /^REEL_CAPTION_WATCHLIST='0'$/m);
  const r = spawnSync("/bin/bash", ["-c", `set -a; . /dev/stdin; set +a; printf '%s|%s|[%s]' "$REEL_CLIENT" "$REEL_WATCH_DONE" "$REEL_WATCH_CTA"`], { input: env, encoding: "utf8" });
  assert.equal(r.stdout, "Jane O'Doe|/d/Clients/Jane Doe|[]");
});

test("clients never get the Greg card: not offered, not accepted, not the fallback", () => {
  assert.doesNotMatch(looksPrompt([], { exclude: ["gregcard"] }), /gregcard/);
  assert.match(looksPrompt([]), /gregcard/);
  assert.notEqual(pickLook({ look: "gregcard" }, { transcript: "one conviction", exclude: ["gregcard"] }).look, "gregcard");
  assert.deepEqual(brandPreset(brand).graphics.excludeLooks, ["gregcard"]);
});

test("a client's post copy never uses Greg's Sandcastles watchlist", () => {
  const args = { transcript: "x", hook: "", voice: "v", cta: "" };
  assert.match(buildPrompt(args), /scope \\?"watchlist\\?"/);
  assert.match(buildPrompt({ ...args, watchlist: false }), /Never use the "watchlist" scope/);
  assert.doesNotMatch(buildPrompt({ ...args, watchlist: false }), /You may also call top_hooks with scope "watchlist"/);
});

test("the client agent plist is valid and only watches the client's drop folders", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "reel-agent-")), "a.plist");
  fs.writeFileSync(f, agentPlist({ label: "com.pingel.reel-watch.client.x", script: "/s/watch-folder.sh", env: { REEL_WATCH_RAW: "/r & d" }, watch: ["/c/raw", "/c/raw-broll"], log: "/c/l.log" }));
  assert.equal(spawnSync("plutil", ["-lint", f]).status, 0);
  const j = JSON.parse(spawnSync("plutil", ["-convert", "json", "-o", "-", f], { encoding: "utf8" }).stdout);
  assert.deepEqual(j.WatchPaths, ["/c/raw", "/c/raw-broll"]);
  assert.equal(j.EnvironmentVariables.REEL_WATCH_RAW, "/r & d");
  assert.equal(j.RunAtLoad, false);
});

test("the watcher edits Greg's drops as Greg and a client's drops with the client's settings, markers apart", () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "reel-clients-"));
  const bin = path.join(T, "bin"); fs.mkdirSync(bin);
  fs.copyFileSync(new URL("../scripts/watch-folder.sh", import.meta.url), path.join(bin, "watch-folder.sh"));
  // A stand-in job: records what it was run with.
  fs.writeFileSync(path.join(bin, "watch-reel.sh"), `#!/bin/bash\nprintf '%s|%s|%s|%s|%s\\n' "$(basename "$1")" "$2" "\${REEL_CLIENT:-greg}" "\${REEL_PRESET:-default}" "\${REEL_WATCH_DONE:-none}" >> "${T}/jobs.txt"\n`);
  fs.chmodSync(path.join(bin, "watch-reel.sh"), 0o755);
  const greg = path.join(T, "greg");
  const env = { ...process.env, REEL_WATCH_ROOT: greg, REEL_CLIENTS: path.join(T, "clients"), REEL_WATCH_DONE: "/greg/Desktop/Reels" };
  delete env.REEL_PRESET; delete env.REEL_CLIENT;
  for (const [dir] of DROP_FOLDERS) env[{ raw: "REEL_WATCH_RAW", "raw-broll": "REEL_WATCH_RAW_BROLL", "raw-carousel": "REEL_WATCH_RAW_CAROUSEL", "raw-long": "REEL_WATCH_RAW_LONG", "raw-youtube": "REEL_WATCH_RAW_YOUTUBE", "raw-runway": "REEL_WATCH_RAW_RUNWAY" }[dir]] = path.join(greg, dir);
  const p = clientPaths(brand, { REEL_CLIENTS: env.REEL_CLIENTS, REEL_CLIENTS_DESKTOP: path.join(T, "Desktop") });
  for (const d of p.drops) fs.mkdirSync(d.dir, { recursive: true });
  fs.writeFileSync(p.env, clientEnv(brand, p));
  fs.mkdirSync(path.join(greg, "raw"), { recursive: true });
  fs.writeFileSync(path.join(greg, "raw", "mine.mov"), "x");
  fs.writeFileSync(path.join(p.root, "raw-broll", "hers.mov"), "x");
  const run = () => spawnSync("/bin/bash", [path.join(bin, "watch-folder.sh")], { env, encoding: "utf8" });
  assert.equal(run().status, 0);
  const jobs = fs.readFileSync(path.join(T, "jobs.txt"), "utf8").trim().split("\n").sort();
  assert.deepEqual(jobs, [
    `hers.mov|broll|Jane Doe|${p.preset}|${p.desktop}`,
    "mine.mov|reel|greg|default|/greg/Desktop/Reels",
  ]);
  assert.ok(fs.readdirSync(path.join(p.root, "videos", ".seen")).some((f) => f.startsWith("broll-hers.mov@") && f.endsWith(".done")));
  assert.ok(!fs.readdirSync(path.join(greg, "videos", ".seen")).some((f) => f.includes("hers")), "a client's marker never lands in Greg's");
  run();
  assert.equal(fs.readFileSync(path.join(T, "jobs.txt"), "utf8").trim().split("\n").length, 2, "nothing is edited twice");
  fs.rmSync(T, { recursive: true, force: true });
});

test("client b-roll comes from the client's world, with a scene history of its own; Greg's prompt is unchanged", async () => {
  const { picksPrompt, recentFile } = await import("../src/broll.mjs");
  const base = { candidates: [{ i: 1, start: 1, text: "x" }], transcript: "x", hook: "", count: 1 };
  const greg = picksPrompt(base);
  assert.match(greg, /truck tailgate/);
  const jane = picksPrompt({ ...base, world: "a Tesla interior in Scottsdale" });
  assert.match(jane, /speaker's world .*a Tesla interior in Scottsdale/);
  assert.doesNotMatch(jane, /truck tailgate|job-site step|Bible open/);
  assert.equal(brandPreset({ ...brand, world: "w" }).broll.worldInPrompt, true);
  assert.equal(recentFile({ REEL_CACHE: "/c/jane" }), "/c/jane/broll-recent.json");
  assert.match(recentFile({}), /\.cache\/reel-editor\/broll-recent\.json$/);
});
