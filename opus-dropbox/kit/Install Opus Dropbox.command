#!/bin/bash
# Opus Dropbox installer. Double-click it (the first time macOS may say it can't check it: right-click, Open).
#   1. Gets its own copy of Node (the engine the tool runs on) from nodejs.org into the tool's folder. No password,
#      and nothing else on the Mac changes.
#   2. Copies the tool into ~/Library/Application Support/Opus Dropbox/app.
#   3. Asks the setup questions (Opus key, Dropbox sign-in, the two folders) and starts the background job.
# Running it again updates the tool and keeps every answer (press Enter to keep each one).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_HOME="${OPUS_DROPBOX_HOME:-$HOME/Library/Application Support/Opus Dropbox}"
APP="$APP_HOME/app"
NODE="$APP_HOME/node/bin/node"
mkdir -p "$APP_HOME"
[ -f "$HERE/app/bin/opus-dropbox.mjs" ] || { echo "The app folder is missing next to this installer. Unzip the whole kit and run it from there."; exit 1; }

# 1) Node: the tool keeps its own, so a Node someone installs or removes later can never break the background job.
node_ok() { [ -x "$1" ] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' 2>/dev/null; }
if ! node_ok "$NODE"; then
  echo "Getting Node from nodejs.org (about 50 MB)..."
  case "$(uname -m)" in arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) echo "Unknown Mac type: $(uname -m)"; exit 1 ;; esac
  BASE="https://nodejs.org/dist/latest-v22.x"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE="$(awk -v a="darwin-$ARCH.tar.gz" '$2 ~ ("^node-v[0-9.]+-" a "$") {print $2; exit}' "$TMP/SHASUMS256.txt")"
  [ -n "$FILE" ] || { echo "nodejs.org has no Node for this Mac type."; exit 1; }
  curl -fSL --progress-bar "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null) || { echo "The Node download did not match its checksum. Run the installer again."; exit 1; }
  rm -rf "$APP_HOME/node"
  mkdir -p "$APP_HOME/node"
  tar -xzf "$TMP/$FILE" -C "$APP_HOME/node" --strip-components 1
  node_ok "$NODE" || { echo "Node did not install."; exit 1; }
fi
echo "Node $("$NODE" --version) is ready."

# 2) The tool.
mkdir -p "$APP"
rsync -a --delete "$HERE/app/" "$APP/"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# 3) Setup, then a check of everything it set up.
"$NODE" "$APP/bin/opus-dropbox.mjs" setup
echo
"$NODE" "$APP/bin/opus-dropbox.mjs" check || true

# A Desktop shortcut that shows what the tool is doing.
STATUS="$HOME/Desktop/Opus Dropbox Status.command"
cat > "$STATUS" <<EOF
#!/bin/bash
"$NODE" "$APP/bin/opus-dropbox.mjs" status
echo
read -n 1 -s -r -p "Press any key to close."
EOF
chmod +x "$STATUS"
echo
echo "Done. Double-click \"Opus Dropbox Status\" on the Desktop any time to see what it is doing."
"$NODE" "$APP/bin/opus-dropbox.mjs" watcher install || true
echo "Paste the copied prompt in the Claude app Code tab to turn on the watcher."

"$NODE" "$APP/bin/opus-dropbox.mjs" panel install || true
