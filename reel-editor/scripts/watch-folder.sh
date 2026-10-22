#!/bin/bash
# Make whatever each new clip's drop folder asks for, once. launchd runs this whenever a drop folder changes
# (see install-watcher.sh); you can also run it by hand.
#   REEL_WATCH_RAW           Raw - Reel: the edited reel                (default ~/Reels/raw)
#   REEL_WATCH_RAW_BROLL     Raw - Reel with B-roll                     (default ~/Reels/raw-broll)
#   REEL_WATCH_RAW_CAROUSEL  Raw - Carousel: an IG carousel from the video (default ~/Reels/raw-carousel)
#   REEL_WATCH_ROOT          work folder (default ~/Reels); markers live in videos/.seen
# A clip is skipped once it has a .done or .failed marker. Rename a failed clip to retry it.
set -uo pipefail

RAW="${REEL_WATCH_RAW:-$HOME/Reels/raw}"
RAW_BROLL="${REEL_WATCH_RAW_BROLL:-$HOME/Reels/raw-broll}"
RAW_CAROUSEL="${REEL_WATCH_RAW_CAROUSEL:-$HOME/Reels/raw-carousel}"
SEEN="${REEL_WATCH_ROOT:-$HOME/Reels}/videos/.seen"
JOB="$(cd "$(dirname "$0")" && pwd)/watch-reel.sh"
mkdir -p "$RAW" "$RAW_BROLL" "$RAW_CAROUSEL" "$SEEN"
shopt -s nullglob nocaseglob

# Keep scanning until a pass finds nothing new, so clips dropped mid-render are not missed.
while :; do
  did=0
  for pair in "reel|$RAW" "broll|$RAW_BROLL" "carousel|$RAW_CAROUSEL"; do
    mode="${pair%%|*}"; dir="${pair#*|}"
    for f in "$dir"/*.{mov,mp4,m4v}; do
      # Markers for the plain-reel folder keep their old names, so clips already done are not redone.
      key="$(basename "$f")"; [ "$mode" = reel ] || key="$mode-$key"
      [ -e "$SEEN/$key.done" ] || [ -e "$SEEN/$key.failed" ] && continue
      did=1
      if "$JOB" "$f" "$mode"; then touch "$SEEN/$key.done"; else touch "$SEEN/$key.failed"; fi
    done
  done
  [ "$did" = 1 ] || break
done
