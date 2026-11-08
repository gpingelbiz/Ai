#!/bin/bash
# This first step uses only tools shipped with macOS; Node is not installed yet.
set -euo pipefail

MANIFEST="${1:?Pass the kit release.json}"
ROOT="$HOME/.local/share/reel-editor"
mkdir -p "$ROOT/tmp" "$ROOT/runtime" "$HOME/.reel"
umask 077
LOG="$HOME/.reel/install.log"
fail() { echo "$* See ~/.reel/install.log, then run this installer again." >&2; exit 1; }
field() { plutil -extract "$1" raw -o - "$MANIFEST"; }
ID="$(field runtime.id)"
case "$ID" in ''|*[!a-zA-Z0-9._-]*|.|..) fail "The tools list is not valid." ;; esac
RT="$ROOT/runtime/$ID"
WORK="$(mktemp -d "$ROOT/tmp/tools.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
plutil -extract runtime json -o "$WORK/runtime.json" "$MANIFEST"

# Check the actual installed bytes before running the downloaded Node on a resume.
if [ -f "$RT/.tools-complete" ] && cmp -s "$WORK/runtime.json" "$RT/.runtime.json"; then
  for BIN in node npm npx; do
    [ "$(readlink "$RT/bin/$BIN")" = "../node/bin/$BIN" ] || fail "The installed tools links have changed. Ask for help repairing the tools."
  done
  if (cd "$RT" && shasum -a 256 -c .tools-files.sha256) >> "$LOG" 2>&1; then
    exit 0
  fi
  fail "The installed tools have changed. Keep your reels; ask for help repairing the tools."
fi
[ ! -e "$RT" ] || fail "An unfinished tools folder needs checking: $RT"
mkdir -p "$WORK/runtime/bin"
for NAME in node ffmpeg ffprobe uv yt-dlp; do
  URL="$(field "runtime.tools.$NAME.url")"
  SHA="$(field "runtime.tools.$NAME.sha256")"
  KIND="$(field "runtime.tools.$NAME.kind")"
  case "$SHA" in *[!a-fA-F0-9]*|'') fail "The tools checksum is missing." ;; esac
  [ "${#SHA}" = 64 ] || fail "The tools checksum is not valid."
  if ! curl --fail --location --retry 3 --retry-delay 1 --output "$WORK/download" "$URL" >> "$LOG" 2>&1; then
    fail "The tools download stopped."
  fi
  ACTUAL="$(shasum -a 256 "$WORK/download")"; ACTUAL="${ACTUAL%% *}"
  [ "$ACTUAL" = "$SHA" ] || fail "The tools download did not match its checksum. Nothing was installed."
  mkdir -p "$WORK/unpack"
  case "$KIND" in
    tar.gz)
      tar -tzf "$WORK/download" > "$WORK/entries"
      if grep -E '(^/|(^|/)\.\.(/|$))' "$WORK/entries" >> "$LOG"; then fail "The tools archive has an unsafe path."; fi
      STRIP="$(field "runtime.tools.$NAME.strip")"
      case "$STRIP" in 0|1) ;; *) fail "The tools archive format is not supported." ;; esac
      tar -xzf "$WORK/download" --strip-components "$STRIP" -C "$WORK/unpack" >> "$LOG" 2>&1
      if [ "$NAME" = node ]; then
        mv "$WORK/unpack" "$WORK/runtime/node"
        for BIN in node npm npx; do ln -s "../node/bin/$BIN" "$WORK/runtime/bin/$BIN"; done
      else
        cp "$WORK/unpack/uv" "$WORK/runtime/bin/uv"
      fi
      ;;
    zip)
      unzip -Z1 "$WORK/download" > "$WORK/entries"
      if grep -E '(^/|(^|/)\.\.(/|$))' "$WORK/entries" >> "$LOG"; then fail "The tools archive has an unsafe path."; fi
      unzip -q "$WORK/download" -d "$WORK/unpack" >> "$LOG" 2>&1
      BIN="$(field "runtime.tools.$NAME.bin")"
      [ "$BIN" = "$NAME" ] || fail "The tools filename is not valid."
      cp "$WORK/unpack/$BIN" "$WORK/runtime/bin/$BIN"
      ;;
    file) cp "$WORK/download" "$WORK/runtime/bin/$NAME" ;;
    *) fail "The tools archive format is not supported." ;;
  esac
  chmod +x "$WORK/runtime/bin/$NAME"
  rm -rf "$WORK/unpack" "$WORK/download"
done
cp "$WORK/runtime.json" "$WORK/runtime/.runtime.json"
(cd "$WORK/runtime" && find bin node -type f -exec shasum -a 256 '{}' \; > .tools-files.sha256)
touch "$WORK/runtime/.tools-complete"
mv "$WORK/runtime" "$RT"
