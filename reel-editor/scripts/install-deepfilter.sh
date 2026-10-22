#!/bin/bash
# Install the DeepFilterNet denoiser binary for studio sound (one file, no Python).
# Source: the official release of https://github.com/Rikorose/DeepFilterNet (MIT / Apache-2.0).
# Lands in ~/.cache/reel-editor/bin/deep-filter (REEL_CACHE overrides the cache dir); `reel doctor` shows it.
set -euo pipefail
VERSION="${DEEPFILTER_VERSION:-0.5.6}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="deep-filter-${VERSION}-aarch64-apple-darwin";;
  Darwin-x86_64) ASSET="deep-filter-${VERSION}-x86_64-apple-darwin";;
  Linux-x86_64) ASSET="deep-filter-${VERSION}-x86_64-unknown-linux-musl";;
  Linux-aarch64) ASSET="deep-filter-${VERSION}-aarch64-unknown-linux-gnu";;
  *) echo "no DeepFilterNet release for $(uname -s)-$(uname -m); set REEL_DEEPFILTER to a built binary" >&2; exit 1;;
esac
DIR="${REEL_CACHE:-$HOME/.cache/reel-editor}/bin"
mkdir -p "$DIR"
URL="https://github.com/Rikorose/DeepFilterNet/releases/download/v${VERSION}/${ASSET}"
echo "fetching $URL"
curl -fsSL -o "$DIR/deep-filter.tmp" "$URL"
chmod +x "$DIR/deep-filter.tmp"
mv "$DIR/deep-filter.tmp" "$DIR/deep-filter"
"$DIR/deep-filter" --help >/dev/null 2>&1 && echo "installed $DIR/deep-filter" || { echo "the binary did not run; remove $DIR/deep-filter and set REEL_DEEPFILTER" >&2; exit 1; }
