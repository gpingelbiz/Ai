import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
