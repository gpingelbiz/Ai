#!/bin/bash
# One drop-folder job: wait for the file to finish copying, run `reel edit`, copy the render to the done folder.
# Usage: watch-reel.sh /path/to/clip.mov
# Hook from the filename: "clip__You don't have a sales problem.mov" -> --hook "You don't have a sales problem"
# Tags in the filename: "#nocta" skips the CTA, "#nozoom" skips zooms, "#landscape" renders 16:9.
# Prints one JSON line on success: {"ok":true,"input":...,"output":...,"name":...}
set -euo pipefail

FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo '{"ok":false,"error":"no such file"}'; exit 1; }

# Environment: n8n and launchd start with a bare PATH, so set everything the pipeline needs here.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -f "$HOME/.zshrc" ] && eval "$(grep -E '^export (REEL_|ELEVENLABS_|PRODUCER_|PATH=)' "$HOME/.zshrc" 2>/dev/null || true)"
export PRODUCER_BROWSER_GPU_MODE="${PRODUCER_BROWSER_GPU_MODE:-hardware}"

REELS="${REEL_WATCH_ROOT:-$HOME/Reels}"
DONE="${REEL_WATCH_DONE:-$REELS/done}"
CTA="${REEL_WATCH_CTA:-Comment GHOST}"
EXTRA_ARGS="${REEL_WATCH_ARGS:-}"
mkdir -p "$DONE" "$REELS/videos"

# Wait until the file stops growing (phone exports and Drive sync write in chunks).
filesize() { if stat -c %s "$1" >/dev/null 2>&1; then stat -c %s "$1"; else stat -f %z "$1"; fi; }
last=-1
for _ in $(seq 1 120); do
  size=$(filesize "$FILE")
  if [ "$size" = "$last" ] && [ "$size" -gt 0 ]; then break; fi
  last=$size
  sleep 2
done

base=$(basename "$FILE")
stem="${base%.*}"
hook=""
case "$stem" in *__*) hook="${stem#*__}"; stem="${stem%%__*}";; esac
hook=$(printf '%s' "$hook" | sed -E 's/ *#[a-z]+//g; s/^ +| +$//g')
flags=()
[ -n "$hook" ] && flags+=(--hook "$hook")
case "$base" in *"#nocta"*) ;; *) [ -n "$CTA" ] && flags+=(--cta "$CTA");; esac
case "$base" in *"#nozoom"*) flags+=(--no-zooms);; esac
case "$base" in *"#landscape"*) flags+=(--canvas landscape);; esac
name=$(echo "$stem" | sed -E 's/#[a-z]+//g; s/[^A-Za-z0-9]+/-/g; s/^-+|-+$//g' | tr 'A-Z' 'a-z')
[ -n "$name" ] || name="reel"

work="$REELS/videos/$name"
log="$REELS/watch.log"
echo "$(date '+%F %T') start $base -> $work ${flags[*]:-}" >> "$log"
cd "$REELS"
# shellcheck disable=SC2086
if reel edit "$FILE" --out "$work" --title "$name" "${flags[@]}" $EXTRA_ARGS >> "$log" 2>&1; then
  out="$work/renders/$name.mp4"
  cp -f "$out" "$DONE/$name.mp4"
  echo "$(date '+%F %T') done  $DONE/$name.mp4" >> "$log"
  printf '{"ok":true,"input":"%s","output":"%s","name":"%s","hook":"%s"}\n' "$FILE" "$DONE/$name.mp4" "$name" "$hook"
else
  echo "$(date '+%F %T') FAIL  $base (see above)" >> "$log"
  printf '{"ok":false,"input":"%s","name":"%s","log":"%s"}\n' "$FILE" "$name" "$log"
  exit 1
fi
