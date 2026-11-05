import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PKG_ROOT } from "../src/util.mjs";

const installer = fs.readFileSync(path.join(PKG_ROOT, "install.sh"), "utf8");

// Run the real settings lines, without installing tools, signing in or rendering the proof reel.
test("installer keeps existing stock keys inside or outside its block on repeated runs", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "reel-install-keys-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const questions = installer.slice(installer.indexOf('PBKEY=""'), installer.indexOf('[ -n "$WATCH" ] ||'));
  const settings = installer.slice(installer.indexOf('touch "$ZSHRC"'), installer.indexOf('ok "settings saved'));
  const run = (reply = "") => spawnSync("/bin/bash", ["-c", `set -euo pipefail
ZSHRC="$HOME/.zshrc"; VENV="$HOME/venv"; PRESET=clean; DICT=""; VOICE=""; YTPRESET=""; WATCH=n; KEY=""; RWKEY=""
ok() { :; }; note() { :; }; ask_secret() { echo asked >> "$HOME/asked"; REPLY="$TEST_REPLY"; }
${questions}
${settings}
`], { env: { HOME: home, PATH: process.env.PATH, TEST_REPLY: reply }, encoding: "utf8" });
  const file = path.join(home, ".zshrc");
  for (const outside of [false, true]) {
    const keys = 'export PIXABAY_API_KEY="existing-pixabay"\nexport PEXELS_API_KEY="existing-pexels"\n';
    fs.writeFileSync(file, outside ? keys : `# >>> reel-editor >>>\n${keys}# <<< reel-editor <<<\n`);
    for (let i = 0; i < 2; i++) {
      const r = run(); assert.equal(r.status, 0, r.stderr);
      const saved = fs.readFileSync(file, "utf8");
      assert.equal((saved.match(/^export PIXABAY_API_KEY=/gm) || []).length, 1);
      assert.equal((saved.match(/^export PEXELS_API_KEY=/gm) || []).length, 1);
      assert.ok(saved.includes(keys));
    }
  }
  assert.equal(fs.existsSync(path.join(home, "asked")), false, "existing keys are never requested again");
  fs.writeFileSync(file, "# other settings\n");
  let r = run(); assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /export (PIXABAY|PEXELS)_API_KEY=/);
  r = run("new-test-key"); assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(file, "utf8"), /export PIXABAY_API_KEY="new-test-key"/);
  assert.match(fs.readFileSync(file, "utf8"), /export PEXELS_API_KEY="new-test-key"/);
  const asked = fs.readFileSync(path.join(home, "asked"), "utf8");
  r = run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(home, "asked"), "utf8"), asked);
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
  const page = fs.readFileSync(path.join(home, "Desktop", "Reels", "B-roll shot list.html"), "utf8");
  assert.match(page, /coffee/); assert.doesNotMatch(page, /jungle-reel|gorilla|coconut/);
  const plist = fs.readFileSync(path.join(home, "Library", "LaunchAgents", "com.pingel.reel-watch.plist"), "utf8");
  assert.match(plist, /<key>REEL_WATCH_RAW_OWN_BROLL<\/key>/);
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
  assert.match(setup, /!flag\("--no-routine"\) && publishMode !== "off"/);
});
