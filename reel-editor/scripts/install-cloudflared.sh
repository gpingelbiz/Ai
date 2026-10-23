#!/bin/bash
# Install cloudflared (Cloudflare's tunnel client, Apache-2.0) for auto-posting: a quick tunnel gives one finished
# reel a temporary public link for the minute Metricool needs to copy it. No Cloudflare account is used.
# Source: the official release of https://github.com/cloudflare/cloudflared. Lands in ~/.cache/reel-editor/bin.
set -euo pipefail
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="cloudflared-darwin-arm64.tgz";;
  Darwin-x86_64) ASSET="cloudflared-darwin-amd64.tgz";;
  Linux-x86_64) ASSET="cloudflared-linux-amd64";;
  Linux-aarch64) ASSET="cloudflared-linux-arm64";;
  *) echo "no cloudflared release for $(uname -s)-$(uname -m)" >&2; exit 1;;
esac
DIR="${REEL_CACHE:-$HOME/.cache/reel-editor}/bin"
mkdir -p "$DIR"
URL="https://github.com/cloudflare/cloudflared/releases/latest/download/${ASSET}"
TMP="$(mktemp -d)"
echo "fetching $URL"
curl -fsSL -o "$TMP/$ASSET" "$URL"
case "$ASSET" in
  *.tgz) tar -xzf "$TMP/$ASSET" -C "$TMP" && mv "$TMP/cloudflared" "$DIR/cloudflared";;
  *) mv "$TMP/$ASSET" "$DIR/cloudflared";;
esac
chmod +x "$DIR/cloudflared"
rmdir "$TMP" 2>/dev/null || true
"$DIR/cloudflared" --version
