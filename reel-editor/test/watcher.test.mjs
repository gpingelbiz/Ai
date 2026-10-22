import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs, { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The drop-folder scripts run under macOS /bin/bash 3.2 with set -euo pipefail. Two bugs shipped because
// newer-bash habits passed `bash -n` but failed at run time there; these run the real lines on /bin/bash.
const script = readFileSync(new URL("../scripts/watch-reel.sh", import.meta.url), "utf8");
const bash = (code) => spawnSync("/bin/bash", ["-c", `set -euo pipefail\n${code}`], { encoding: "utf8" });

test("watcher scripts parse under /bin/bash", () => {
  for (const f of ["watch-reel.sh", "watch-folder.sh", "install-watcher.sh"]) {
    const r = spawnSync("/bin/bash", ["-n", new URL(`../scripts/${f}`, import.meta.url).pathname], { encoding: "utf8" });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test("a plain drop (no hook, no tags, no CTA) does not trip set -u on an empty flag list", () => {
  const line = script.split("\n").find((l) => l.includes('${flags[@]+"${flags[@]}"}'));
  assert.ok(line, "the reel edit line uses the empty-safe expansion");
  const r = bash('flags=(); printf "[%s]" ${flags[@]+"${flags[@]}"} x; flags+=(--hook "a b"); printf "<%s>" ${flags[@]+"${flags[@]}"}');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "[x]<--hook><a b>");
});

test("notify() survives quotes and apostrophes in titles", () => {
  const fn = script.split("\n").find((l) => l.startsWith("notify()"));
  assert.ok(fn);
  const r = bash(`${fn}\nosascript() { echo "$@"; }\nnotify 'Reel ready' "Your team doesn't remember your \\"meeting\\""; echo ok`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok$/m);
});

test("each reel gets a brand-new '<date> Reel <n>' folder without listing the parent (macOS blocks that on the Desktop)", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const fn = script.match(/create_reel_folder\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, "watch-reel.sh defines create_reel_folder");
  assert.doesNotMatch(fn[0], /"\$1\/\$day Reel "\*/, "never globs the done folder");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-folders-"));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "reel-state-"));
  const day = spawnSync("date", ["+%F"], { encoding: "utf8" }).stdout.trim();
  const next = () => bash(`${fn[0]}\ncreate_reel_folder "${dir}" "${state}"`).stdout.trim();
  // Folders made by hand (no count saved yet) are skipped, never reused.
  fs.mkdirSync(path.join(dir, `${day} Reel 1`));
  fs.mkdirSync(path.join(dir, `${day} Reel 2`));
  fs.writeFileSync(path.join(dir, `${day} Reel 1`, "caption.txt"), "keep me");
  assert.equal(next(), `${dir}/${day} Reel 3`);
  assert.equal(next(), `${dir}/${day} Reel 4`);
  assert.equal(fs.readFileSync(path.join(dir, `${day} Reel 1`, "caption.txt"), "utf8"), "keep me", "existing folders untouched");
  // A deleted folder's number is not reused: the saved count moves forward.
  fs.rmdirSync(path.join(dir, `${day} Reel 4`));
  assert.equal(next(), `${dir}/${day} Reel 5`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

// Full drop with stand-ins for reel, codex and osascript: checks the three folders a reel gets.
function fakeDrop({ brollShots, tag = "" }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "reel-home-"));
  const bin = path.join(home, ".local", "bin");
  fs.mkdirSync(bin, { recursive: true });
  const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
  stub("osascript", "exit 0");
  stub("codex", "exit 0");
  // reel edit <file> --out <work> --title <name> ...: writes both renders and a plan with b-roll stills.
  stub("reel", `
if [ "$1" = carousel ]; then mkdir -p "$4"; echo slide > "$4/Slide 1.png"; exit 0; fi
work="$4"; name="$6"; mkdir -p "$work/renders" "$work/broll"
echo with > "$work/renders/$name.mp4"
case "$*" in *--both*) echo plain > "$work/renders/$name-no-broll.mp4";; esac
files=""
i=1; while [ $i -le ${brollShots} ]; do echo img$i > "$work/broll/broll-$i.png"; files="$files{\\"file\\":\\"$work/broll/broll-$i.png\\"},"; i=$((i + 1)); done
echo "{\\"hook\\":{\\"text\\":\\"Own it first\\"},\\"broll\\":[\${files%,}]}" > "$work/plan.json"`);
  const raw = path.join(home, "raw");
  fs.mkdirSync(raw);
  const clip = path.join(raw, `clip${tag}.mov`);
  fs.writeFileSync(clip, "video");
  execFileSync("/bin/bash", [new URL("../scripts/watch-reel.sh", import.meta.url).pathname, clip], {
    env: { HOME: home, PATH: "/usr/bin:/bin", REEL_WATCH_ROOT: path.join(home, "Reels"), REEL_WATCH_DONE: path.join(home, "Done"), REEL_WATCH_CAPTION: "0", REEL_WATCH_CTA: "" },
    stdio: "pipe",
  });
  const done = path.join(home, "Done");
  const folder = path.join(done, fs.readdirSync(done)[0]);
  const list = (d) => (fs.existsSync(path.join(folder, d)) ? fs.readdirSync(path.join(folder, d)).sort() : null);
  const read = (p) => fs.readFileSync(path.join(folder, p), "utf8").trim();
  return { folder, list, read, top: fs.readdirSync(folder).sort() };
}

test("a drop gets Reel with B-roll, Reel with no B-roll and Carousel", () => {
  const r = fakeDrop({ brollShots: 2 });
  assert.deepEqual(r.top, ["Carousel", "Reel with B-roll", "Reel with no B-roll"]);
  assert.deepEqual(r.list("Reel with B-roll"), ["B-roll 1.png", "B-roll 2.png", "Own it first.mp4"]);
  assert.deepEqual(r.list("Reel with no B-roll"), ["Own it first.mp4"]);
  assert.equal(r.read("Reel with B-roll/Own it first.mp4"), "with");
  assert.equal(r.read("Reel with no B-roll/Own it first.mp4"), "plain");
  assert.deepEqual(r.list("Carousel"), ["Slide 1.png"]);
});

test("no b-roll back from Codex: a note instead of a duplicate reel; #nobroll: no b-roll folder", () => {
  const r = fakeDrop({ brollShots: 0 });
  assert.deepEqual(r.list("Reel with B-roll"), ["No b-roll this time.txt"]);
  const n = fakeDrop({ brollShots: 0, tag: " #nobroll" });
  assert.deepEqual(n.top, ["Carousel", "Reel with no B-roll"]);
  assert.equal(n.read("Reel with no B-roll/Own it first.mp4"), "with");
});
