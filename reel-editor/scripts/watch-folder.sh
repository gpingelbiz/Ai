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
filesize() { if stat -c %s "$1" >/dev/null 2>&1; then stat -c %s "$1"; else stat -f %z "$1"; fi; }
filemtime() { if stat -c %Y "$1" >/dev/null 2>&1; then stat -c %Y "$1"; else stat -f %m "$1"; fi; }

# One scanner at a time: launchd fires on every change and a hand-run must not race it on the same clip.
# A lock older than 3 hours is a crashed run and is taken over.
LOCK="$SEEN/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ "$(( $(date +%s) - $(filemtime "$LOCK") ))" -gt 10800 ]; then rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# Keep scanning until a pass finds nothing new, so clips dropped mid-render are not missed.
while :; do
  did=0
  for pair in "reel|$RAW" "broll|$RAW_BROLL" "carousel|$RAW_CAROUSEL"; do
    mode="${pair%%|*}"; dir="${pair#*|}"
    for f in "$dir"/*.{mov,mp4,m4v}; do
      # A marker names the clip by name, size and modified time, so a new file with an old name is edited again.
      # Older name-only markers still count, so clips done before are not redone.
      base="$(basename "$f")"; [ "$mode" = reel ] || base="$mode-$base"
      key="$base@$(filesize "$f")-$(filemtime "$f")"
      [ -e "$SEEN/$key.done" ] || [ -e "$SEEN/$key.failed" ] || [ -e "$SEEN/$base.done" ] || [ -e "$SEEN/$base.failed" ] && continue
      did=1
      if "$JOB" "$f" "$mode"; then mark="$SEEN/$key.done"; else mark="$SEEN/$key.failed"; fi
      touch "$mark" || { echo "cannot write $mark; stopping so this clip is not edited again and again" >&2; exit 1; }
    done
  done
  [ "$did" = 1 ] || break
done
