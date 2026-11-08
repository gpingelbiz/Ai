#!/bin/bash
# Build on the release Mac so clients never need Apple's command line tools.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HERE/dist/helpers}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
DEST="$OUT/darwin-arm64"
STAGE="$(mktemp -d "$OUT/.helpers.XXXXXX")"
cleanup() {
  if [ -d "$STAGE/previous" ] && [ ! -e "$DEST" ]; then mv "$STAGE/previous" "$DEST"; fi
  rm -rf "$STAGE"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir -p "$STAGE/build" "$STAGE/module-cache"
printf '{\n' > "$STAGE/build/helpers.json"
SEP=""
for SOURCE in "$HERE"/scripts/*.swift; do
  NAME="$(basename "$SOURCE" .swift)"
  echo "Building $NAME"
  swiftc -O -target arm64-apple-macos14.0 -module-cache-path "$STAGE/module-cache" "$SOURCE" -o "$STAGE/build/$NAME"
  BINARY_HASH="$(shasum -a 256 "$STAGE/build/$NAME")"
  SOURCE_HASH="$(shasum -a 256 "$SOURCE")"
  printf '%s  "%s": { "sha256": "%s", "source": "%s" }' "$SEP" "$NAME" "${BINARY_HASH%% *}" "${SOURCE_HASH%% *}" >> "$STAGE/build/helpers.json"
  SEP=$',\n'
done
printf '\n}\n' >> "$STAGE/build/helpers.json"
if [ -e "$DEST" ]; then mv "$DEST" "$STAGE/previous"; fi
mv "$STAGE/build" "$DEST"
echo "Built tools: $DEST"
