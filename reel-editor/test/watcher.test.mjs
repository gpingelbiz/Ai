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

test("the drop folder keeps the learning record hidden beside each delivered reel", () => {
  assert.match(script, /analytics-features\.json" \] && cp -f "\$work\/analytics-features\.json" "\$folder\/\.reel-features\.json"/);
  assert.match(script, /\.Clip \$k\.reel-features\.json/);
});

test("a plain drop (no hook, no tags, no CTA) does not trip set -u on an empty flag list", () => {
  const line = script.split("\n").find((l) => l.includes('${flags[@]+"${flags[@]}"}'));
  assert.ok(line, "the reel edit line uses the empty-safe expansion");
  const r = bash('flags=(); printf "[%s]" ${flags[@]+"${flags[@]}"} x; flags+=(--hook "a b"); printf "<%s>" ${flags[@]+"${flags[@]}"}');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "[x]<--hook><a b>");
});

test("#credit asks the editor for the active brand identity credential", () => {
  assert.match(script, /\*"#credit"\*\) flags\+=\(--credit-self\)/);
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

// Full drops with stand-ins for reel, codex and osascript: one clip in each drop folder, through the real
// watch-folder.sh and watch-reel.sh.
function fakeDrops({ brollShots = 2, carouselFails = false, music = [], clips = { reel: ["clip.mov"], broll: ["clip.mov"], carousel: ["clip.mov"] }, longClips = 2 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "reel-home-"));
  const bin = path.join(home, ".local", "bin");
  fs.mkdirSync(bin, { recursive: true });
  const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
  stub("osascript", "exit 0");
  stub("codex", "exit 0");
  // reel edit <file> --out <work> --title <name> ...  /  reel carousel <work> --out <folder> ...
  stub("reel", `
echo "$*" >> "$HOME/reel-calls"
if [ "$1" = carousel ]; then ${carouselFails ? "exit 1" : 'mkdir -p "$4"; echo slide > "$4/Slide 1.png"; exit 0'}; fi
if [ "$1" = clips ]; then
  work="$4"; name="$6"; list=""
  i=1; while [ $i -le ${longClips} ]; do d="$work/clip-$i/edit"; mkdir -p "$d/renders" "$d/covers"; echo clip$i > "$d/renders/$name-$i.mp4"; echo cover > "$d/covers/Cover.png"; echo "Music: bed.mp3" > "$d/music.txt"
    list="$list{\\"start\\":$((i*60)),\\"end\\":$((i*60+45)),\\"hook\\":\\"Own it *first*. Clip $i?\\",\\"score\\":$((90-i)),\\"why\\":\\"a stake, a turn\\",\\"output\\":\\"$d/renders/$name-$i.mp4\\"},"; i=$((i + 1)); done
  echo "{\\"clips\\":[\${list%,}]}" > "$work/clips.json"; exit 0
fi
work="$4"; name="$6"; mkdir -p "$work/renders" "$work/broll"
case "$*" in *--no-render*) ;; *) echo "$name" > "$work/renders/$name.mp4";; esac
case "$*" in *--music-dir*) all="$*"; d="\${all#*--music-dir }"; d="\${d%% *}"; w=""; case "$*" in *--music-want*) w="\${all#*--music-want }"; w="\${w%% *}";; esac; t="$(ls "$d"/*.mp3 "$d"/*.wav 2>/dev/null | { if [ -n "$w" ]; then grep -i -- "$w" | head -1; else head -1; fi; })"; [ -n "$t" ] && echo "Music: $(basename "$t")" > "$work/music.txt";; esac
files=""
case "$*" in *--broll*)
  i=1; while [ $i -le ${brollShots} ]; do echo img$i > "$work/broll/broll-$i.png"; files="$files{\\"file\\":\\"$work/broll/broll-$i.png\\"},"; i=$((i + 1)); done;;
esac
echo "{\\"hook\\":{\\"text\\":\\"Own it first\\"},\\"broll\\":[\${files%,}]}" > "$work/plan.json"
echo '{"performance":{}}' > "$work/analytics-features.json"`);
  const dirs = { reel: path.join(home, "raw"), broll: path.join(home, "raw-broll"), carousel: path.join(home, "raw-carousel"), long: path.join(home, "raw-long") };
  for (const [mode, d] of Object.entries(dirs)) { fs.mkdirSync(d); for (const c of clips[mode] || []) fs.writeFileSync(path.join(d, c), "video"); }
  // A .zshrc like Greg's: the CTA is set to empty with a trailing comment, and one line uses a zsh-only expansion.
  fs.writeFileSync(path.join(home, ".zshrc"), 'export REEL_WATCH_CTA=""   # no CTA for now\nexport REEL_NOPE="$(zsh-only)"\nexport PRODUCER_BROWSER_GPU_MODE=hardware\n');
  const musicDir = path.join(home, "music");
  fs.mkdirSync(musicDir);
  for (const m of music) fs.writeFileSync(path.join(musicDir, m), "audio");
  const done = path.join(home, "Done");
  spawnSync("/bin/bash", [new URL("../scripts/watch-folder.sh", import.meta.url).pathname], {
    env: { HOME: home, PATH: "/usr/bin:/bin", REEL_WATCH_ROOT: path.join(home, "Reels"), REEL_WATCH_DONE: done, REEL_WATCH_RAW: dirs.reel, REEL_WATCH_RAW_BROLL: dirs.broll, REEL_WATCH_RAW_CAROUSEL: dirs.carousel, REEL_WATCH_RAW_LONG: dirs.long, REEL_WATCH_MUSIC: musicDir, REEL_WATCH_FAST: "1", REEL_WATCH_PRUNE_DAYS: "0", REEL_WATCH_CAPTION: "0" },
    stdio: "pipe",
  });
  const day = spawnSync("date", ["+%F"], { encoding: "utf8" }).stdout.trim();
  const list = (d) => (fs.existsSync(path.join(done, d)) ? fs.readdirSync(path.join(done, d)).filter((f) => !f.startsWith(".")).sort() : null);
  const read = (p) => fs.readFileSync(path.join(done, p), "utf8").trim();
  return { home, day, done, list, read, top: fs.readdirSync(done).filter((f) => !f.startsWith(".")).sort(), calls: fs.readFileSync(path.join(home, "reel-calls"), "utf8"), seen: fs.readdirSync(path.join(home, "Reels", "videos", ".seen")).filter((f) => !f.startsWith(".")).sort() };
}

test("each drop folder makes its own thing: reel, reel with b-roll, carousel", () => {
  const r = fakeDrops({ brollShots: 2 });
  assert.deepEqual(r.top, [`${r.day} Carousel 1`, `${r.day} Reel 1`, `${r.day} Reel 2 with B-roll`]);
  assert.deepEqual(r.list(`${r.day} Reel 1`), ["Own it first.mp4"]);
  assert.deepEqual(r.list(`${r.day} Reel 2 with B-roll`), ["B-roll 1.png", "B-roll 2.png", "Own it first.mp4"]);
  assert.equal(fs.readFileSync(path.join(r.done, `${r.day} Reel 2 with B-roll`, "Own it first.mp4"), "utf8").trim(), "clip-broll");
  assert.deepEqual(r.list(`${r.day} Carousel 1`), ["Slide 1.png"]);
  assert.ok(fs.existsSync(path.join(r.done, `${r.day} Reel 1`, ".reel-features.json")));
  // The plain reel never asks for b-roll; the carousel never renders a reel.
  const lines = r.calls.trim().split("\n");
  assert.ok(lines.some((l) => /^edit .*\/raw\/clip\.mov .*--no-graphics --caption-style pop/.test(l) && !/--broll/.test(l)), "plain reel: classic captions, no cards");
  assert.ok(lines.some((l) => /^edit .*raw-broll\/clip\.mov .*--broll --graphics --caption-style reveal/.test(l)), "b-roll reel: the full look");
  assert.ok(lines.some((l) => /^edit .*raw-carousel\/clip\.mov .*--no-render/.test(l)));
  assert.ok(lines.some((l) => /^carousel .*clip-carousel --out .*Carousel 1 --images 3$/.test(l)));
  assert.deepEqual(r.seen.map((m) => m.replace(/@.*(\.done|\.failed)$/, "$1")).filter((m) => !m.startsWith(".")), ["broll-clip.mov.done", "carousel-clip.mov.done", "clip.mov.done"]);
});

test("no b-roll back from Codex leaves a note; a failed carousel leaves a note and is marked failed", () => {
  const r = fakeDrops({ brollShots: 0, carouselFails: true });
  assert.deepEqual(r.list(`${r.day} Reel 2 with B-roll`), ["No b-roll this time.txt", "Own it first.mp4"]);
  assert.deepEqual(r.list(`${r.day} Carousel 1`), ["Carousel failed.txt"]);
  assert.ok(r.seen.some((m) => /^carousel-clip\.mov@.*\.failed$/.test(m)));
});

test("music: a random track from the folder, #music:name picks one, #nomusic skips; carousels never get music", () => {
  const r = fakeDrops({ brollShots: 0, music: ["Calm Morning.mp3", "Dark Drive.wav"], clips: { reel: ["a.mov", "b__Own it #music:dark.mov", "c__Own it #nomusic.mov"], broll: ["d.mov"], carousel: ["e.mov"] } });
  const lines = r.calls.trim().split("\n");
  const edit = (name) => lines.find((l) => l.startsWith("edit ") && l.includes("/" + name + " "));
  assert.match(edit("a.mov"), /--music-dir \S+\/music/);
  assert.match(edit("b__Own it #music:dark.mov"), /--music-dir \S+\/music --music-want dark/);
  assert.match(edit("b__Own it #music:dark.mov"), /--hook Own it /, "the #music tag is stripped from the hook");
  assert.doesNotMatch(edit("c__Own it #nomusic.mov"), /--music/);
  assert.match(edit("d.mov"), /--music-dir /);
  assert.doesNotMatch(edit("e.mov"), /--music/);
  const reel1 = r.list(`${r.day} Reel 1`);
  assert.ok(reel1.includes("music.txt"));
  assert.match(r.read(`${r.day} Reel 2/music.txt`), /^Music: Dark Drive\.wav$/);
  assert.ok(!r.list(`${r.day} Reel 3`).includes("music.txt"));
  assert.ok(fs.existsSync(path.join(r.done, `${r.day} Reel 2`, "Own it.mp4")), "the slug and title drop the tag");
});

test("music: an empty folder means no music.txt, no error", () => {
  const r = fakeDrops({ brollShots: 0, music: [] });
  assert.deepEqual(r.list(`${r.day} Reel 1`), ["Own it first.mp4"]);
});

test("an empty CTA with a trailing comment in .zshrc still means no CTA; a command substitution is skipped", () => {
  const r = fakeDrops({ brollShots: 0 });
  assert.doesNotMatch(r.calls, /--cta/, "no Comment GHOST pill when REEL_WATCH_CTA is set empty in .zshrc");
});

test("a long recording in Raw - Long Form becomes a Clips folder with one reel per moment", () => {
  const r = fakeDrops({ clips: { long: ["podcast.mp4"] }, longClips: 2 });
  assert.deepEqual(r.top, [`${r.day} Clips 1`]);
  assert.deepEqual(r.list(`${r.day} Clips 1`), ["Clip 1 - Cover.png", "Clip 1 - Own it first. Clip 1.mp4", "Clip 1 - music.txt", "Clip 2 - Cover.png", "Clip 2 - Own it first. Clip 2.mp4", "Clip 2 - music.txt", "clips.txt"]);
  assert.match(r.read(`${r.day} Clips 1/clips.txt`), /Clip 1 {2}\(1:00-1:45, score 89\)\n {2}Own it \*first\*\. Clip 1\?\n {2}a stake, a turn/);
  assert.ok(r.calls.split("\n").some((l) => /^clips .*raw-long\/podcast\.mp4 --out .*podcast-clips --title podcast-clips --count 5 .*--broll --graphics --caption-style reveal/.test(l)), r.calls);
  assert.ok(r.seen.some((s) => s.startsWith("long-podcast.mp4@") && s.endsWith(".done")));
});
