#!/bin/bash
# A generic double-click kit, pinned to a tested release. --dev makes a local preview only.
# scripts/package-kit.sh [output folder] --release <release.json>
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/dist"
RELEASE=""
DEV=0
HAS_OUT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --release) [ $# -ge 2 ] || { echo '--release needs release.json' >&2; exit 2; }; RELEASE="$2"; shift ;;
    --dev) DEV=1 ;;
    --*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) [ "$HAS_OUT" = 0 ] || { echo 'Choose one output folder.' >&2; exit 2; }; OUT="$1"; HAS_OUT=1 ;;
  esac
  shift
done
if { [ -z "$RELEASE" ] && [ "$DEV" = 0 ]; } || { [ -n "$RELEASE" ] && [ "$DEV" = 1 ]; }; then
  echo 'Choose --release <release.json> for a tested kit, or --dev for a local preview.' >&2
  exit 2
fi
node --input-type=module - "$HERE" "$OUT" "$RELEASE" "$DEV" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [app, out, manifest, dev] = process.argv.slice(2);
const { withReleaseApp, command } = await import(pathToFileURL(path.join(app, "scripts/release.mjs")));
const build = ({ source, file, release }) => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "reel-kit-"));
  try {
    const kit = path.join(stage, "Reel Editor Kit");
    fs.mkdirSync(kit);
    fs.copyFileSync(path.join(source, "kit/Install Reel Editor.command"), path.join(kit, "Install Reel Editor.command"));
    fs.chmodSync(path.join(kit, "Install Reel Editor.command"), 0o755);
    for (const name of ["Start Here.html", "Setup Guide.html"]) {
      const page = fs.readFileSync(path.join(source, "kit", name), "utf8").replace(/[ \t]*<!-- studio -->[\s\S]*?<!-- \/studio -->\n?/g, "");
      fs.writeFileSync(path.join(kit, name), page);
    }
    if (file) {
      fs.copyFileSync(file, path.join(kit, "release.json"));
      fs.copyFileSync(path.join(source, "install.sh"), path.join(kit, "install.sh"));
    }
    const output = path.resolve(out);
    fs.mkdirSync(output, { recursive: true });
    const zip = path.join(output, "Reel Editor Kit.zip");
    fs.rmSync(zip, { force: true });
    // ditto strips resource forks and extended attributes and keeps the launcher's executable bit.
    command("ditto", ["-c", "-k", "--norsrc", "--noextattr", "--keepParent", kit, zip]);
    fs.writeFileSync(path.join(output, "Reel Editor Kit - send-out message.txt"), release ? `This kit installs tested release ${release.id}. Open Setup Guide.html first.\n` : "WARNING: Development kit. Not pinned to a tested release. Do not send it to a client.\n");
    console.log(zip);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
};
try {
  if (dev === "1") {
    console.warn("WARNING: Development kit. Do not send this kit to a client.");
    build({ source: app });
  } else {
    const file = path.resolve(manifest);
    const { id } = JSON.parse(fs.readFileSync(file, "utf8"));
    withReleaseApp({ app, id, manifestFile: file }, build);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
NODE
