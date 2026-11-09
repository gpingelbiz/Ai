import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PKG_ROOT } from "../src/util.mjs";

const installer = fs.readFileSync(path.join(PKG_ROOT, "install.sh"), "utf8");

// Settings migration is exercised with literal dummy keys, never a real home directory.
test("installer moves stock keys out of zshrc and safely preserves quoted values", async (t) => {
  const { migrateKeys, saveKey, writeEnvironment } = await import("../scripts/runtime.mjs");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "reel-install-keys-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, ".zshrc");
  const unrelated = '# other settings\nexport SOMETHING="left alone"\n';
  fs.writeFileSync(file, unrelated + 'export PIXABAY_API_KEY="older-pixabay"\n# >>> reel-editor >>>\nexport PIXABAY_API_KEY="existing-pixabay"\nexport REEL_WATCH_CTA="" # none\n# <<< reel-editor <<<\nexport PEXELS_API_KEY=existing-pexels\n');
  migrateKeys(home);
  const value = `test'";$(touch "${home}/must-not-exist");\\tail`;
  saveKey(home, "ELEVENLABS_API_KEY", value);
  for (let i = 0; i < 2; i++) writeEnvironment(home, { REEL_PRESET: "clean", REEL_RUNTIME: "", REEL_PYTHON: "/fake/python", REEL_RELEASE: "dev" });
  const saved = fs.readFileSync(file, "utf8");
  assert.ok(saved.startsWith(unrelated));
  assert.doesNotMatch(saved, /_API_KEY=/);
  assert.equal((saved.match(/env\.sh/g) || []).length, 2);
  const keys = path.join(home, ".reel/keys.env");
  assert.equal(fs.statSync(keys).mode & 0o777, 0o600);
  const r = spawnSync("/bin/bash", ["-c", '. "$HOME/.reel/env.sh"; printf "%s\\n%s\\n%s" "$PIXABAY_API_KEY" "$PEXELS_API_KEY" "$ELEVENLABS_API_KEY"'], { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `existing-pixabay\nexisting-pexels\n${value}`);
  assert.equal(fs.existsSync(path.join(home, "must-not-exist")), false);
});

test("installer reruns create the own-clips shortcut, client shot list and watcher path", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "reel-install-folders-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, "bin"); fs.mkdirSync(bin);
  for (const name of ["launchctl", "plutil"]) {
    fs.writeFileSync(path.join(bin, name), "#!/bin/bash\nexit 0\n");
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  const folders = installer.slice(installer.indexOf('# The jungle-reel props'), installer.indexOf('# ---------------------------------------------------------------- 7.'));
  for (let i = 0; i < 2; i++) {
    const r = spawnSync("/bin/bash", ["-c", `set -euo pipefail
APP="$TEST_APP"; WATCH=y; LOOK=brand
ok() { :; }
${folders}`], { env: { HOME: home, PATH: `${bin}:${process.env.PATH}`, TEST_APP: PKG_ROOT, REEL_CACHE: path.join(home, "cache"), REEL_BROLL_RECENT: path.join(home, "recent.json") }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  const shortcut = path.join(home, "Desktop", "Reels", "Raw - My B-roll clips");
  assert.equal(fs.readlinkSync(shortcut), path.join(home, "Reels", "raw-own-broll"));
  assert.ok(fs.statSync(shortcut).isDirectory());
  const vsl = path.join(home, "Desktop", "Reels", "Raw - VSL Editor");
  assert.equal(fs.readlinkSync(vsl), path.join(home, "Reels", "raw-vsl"));
  assert.ok(fs.statSync(vsl).isDirectory());
  const page = fs.readFileSync(path.join(home, "Desktop", "Reels", "B-roll shot list.html"), "utf8");
  assert.match(page, /coffee/); assert.doesNotMatch(page, /jungle-reel|gorilla|coconut/);
  const plist = fs.readFileSync(path.join(home, "Library", "LaunchAgents", "com.pingel.reel-watch.plist"), "utf8");
  assert.match(plist, /<key>REEL_WATCH_RAW_OWN_BROLL<\/key>/);
  assert.match(plist, /<key>REEL_WATCH_RAW_VSL<\/key>/);
  assert.ok(plist.slice(plist.indexOf("<key>WatchPaths</key>")).includes(path.join(home, "Reels", "raw-vsl")));
  assert.ok(plist.slice(plist.indexOf("<key>WatchPaths</key>")).includes(path.join(home, "Reels", "raw-own-broll")));
});

test("installer only accepts a Python Whisper can run, and stops if Whisper fails", () => {
  const sh = fs.readFileSync(new URL("../install.sh", import.meta.url), "utf8");
  assert.match(sh, /\(3, 10\) <= sys\.version_info\[:2\] <= \(3, 14\)/);
  assert.match(sh, /brew install python@3\.13/);
  assert.doesNotMatch(sh, /brew install python >/);
  assert.match(sh, /--only-binary=av/);
  assert.match(sh, /"av<17" \|\| die /);
  assert.match(sh, /! py_ok "\$VENV\/bin\/python"; then rm -rf "\$VENV"/);
});


test("installer passes the routine test flag through without weakening Claude permissions", () => {
  assert.match(installer, /--no-routine\) NO_ROUTINE=1/);
  assert.match(installer, /STUDIO_ARGS\+=\(--no-routine\)/);
  const setup = fs.readFileSync(new URL("../scripts/studio-setup.mjs", import.meta.url), "utf8");
  const routine = fs.readFileSync(new URL("../src/studio-routine.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(installer + setup + routine, /bypassPermissions|disableAutoMode/);
  assert.match(setup, /setupCommand\(process.argv.slice\(2\), \{ terminal: true \}\)/);
});
