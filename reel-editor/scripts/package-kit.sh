#!/bin/bash
# Build "Reel Editor Kit.zip" to send to someone: the double-click installer and the Start Here page.
#   scripts/package-kit.sh [output folder]     (default: reel-editor/dist)
# The kit holds no code and no keys: the installer downloads the latest Reel Editor from GitHub when it runs,
# so the same zip keeps working after updates.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HERE/dist}"
STAGE="$(mktemp -d)"
KIT="$STAGE/Reel Editor Kit"
mkdir -p "$KIT" "$OUT"
cp "$HERE/kit/Install Reel Editor.command" "$HERE/kit/Start Here.html" "$KIT/"
chmod +x "$KIT/Install Reel Editor.command"
xattr -cr "$KIT" 2>/dev/null || true
# ditto keeps the executable bit, so the installer still double-clicks after unzipping.
rm -f "$OUT/Reel Editor Kit.zip"
ditto -c -k --norsrc --noextattr --keepParent "$KIT" "$OUT/Reel Editor Kit.zip"
rm -rf "$STAGE"
echo "$OUT/Reel Editor Kit.zip"
