#!/bin/bash
# Build "<Name> Opus Dropbox Kit.zip": the installer, the tool, and kit.json with the Dropbox app key.
# Usage: scripts/make-kit.sh --name "Client Name" --app-key <Dropbox app key> [--out <folder>]
# The app key is the public half of the Dropbox app (README, "The Dropbox app"); the kit never carries a secret.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NAME="" KEY="" OUT="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --app-key) KEY="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
done
[ -n "$NAME" ] && [ -n "$KEY" ] || { echo "usage: $0 --name \"Client Name\" --app-key KEY [--out DIR]"; exit 1; }
[[ "$KEY" =~ ^[a-z0-9]{10,20}$ ]] || { echo "That does not look like a Dropbox app key (the short key, not the secret)."; exit 1; }

KIT="$NAME Opus Dropbox Kit"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/$KIT/app"
cp -R "$HERE/bin" "$HERE/src" "$HERE/package.json" "$HERE/README.md" "$WORK/$KIT/app/"
printf '{\n  "dropboxAppKey": "%s"\n}\n' "$KEY" > "$WORK/$KIT/app/kit.json"
cp "$HERE/kit/Install Opus Dropbox.command" "$WORK/$KIT/"
chmod +x "$WORK/$KIT/Install Opus Dropbox.command" "$WORK/$KIT/app/bin/opus-dropbox.mjs"
cat > "$WORK/$KIT/Read me first.txt" <<'EOF'
Opus Dropbox

What it does: drop an unedited video in your Dropbox folder, and Opus Clip makes the clips. They show up in your
finished folder by themselves, each with a caption file. The original moves to a "Done" folder inside the drop folder.

Before you install:
1. Opus Clip on a plan with API access (Pro or higher). Copy your API key from Opus.
2. Know your Dropbox login.

Install: double-click "Install Opus Dropbox". If macOS says it can't check it, right-click it and pick Open.
It asks for the Opus key, then opens Dropbox in the browser. Dropbox first shows "Before you connect this app..."
because the app is new: click Continue, then Allow. Then it asks which folders to use.

It runs every 5 minutes while this Mac is awake. Double-click "Opus Dropbox Status" on the Desktop to see what it is doing.
A video that fails moves to "Needs a look" inside the drop folder with a note. Move it back to send it again.
EOF
mkdir -p "$OUT"
rm -f "$OUT/$KIT.zip"
(cd "$WORK" && ditto -c -k --keepParent "$KIT" "$OUT/$KIT.zip")
echo "$OUT/$KIT.zip"
