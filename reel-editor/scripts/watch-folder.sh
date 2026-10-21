#!/bin/bash
# Edit every new clip in the raw folder once. launchd runs this whenever the folder changes
# (see install-watcher.sh); you can also run it by hand.
#   REEL_WATCH_RAW   drop folder (default ~/Reels/raw)
#   REEL_WATCH_ROOT  work folder (default ~/Reels); markers live in videos/.seen
# A clip is skipped once it has a .done or .failed marker. Rename a failed clip to retry it.
set -uo pipefail

RAW="${REEL_WATCH_RAW:-$HOME/Reels/raw}"
SEEN="${REEL_WATCH_ROOT:-$HOME/Reels}/videos/.seen"
JOB="$(cd "$(dirname "$0")" && pwd)/watch-reel.sh"
mkdir -p "$RAW" "$SEEN"
shopt -s nullglob nocaseglob

# Keep scanning until a pass finds nothing new, so clips dropped mid-render are not missed.
while :; do
  did=0
  for f in "$RAW"/*.{mov,mp4,m4v}; do
    key="$(basename "$f")"
    [ -e "$SEEN/$key.done" ] || [ -e "$SEEN/$key.failed" ] && continue
    did=1
    if "$JOB" "$f"; then touch "$SEEN/$key.done"; else touch "$SEEN/$key.failed"; fi
  done
  [ "$did" = 1 ] || break
done
