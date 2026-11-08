#!/bin/bash
# Make whatever each new clip's drop folder asks for, once. launchd runs this whenever a drop folder changes
# (see install-watcher.sh); you can also run it by hand.
#   REEL_WATCH_RAW           Raw - Reel: the edited reel                (default ~/Reels/raw)
#   REEL_WATCH_RAW_BROLL     Raw - Reel with B-roll                     (default ~/Reels/raw-broll)
#   REEL_WATCH_RAW_CAROUSEL  Raw - Carousel: an IG carousel from the video (default ~/Reels/raw-carousel)
#   REEL_WATCH_RAW_LONG      Raw - Clips from Long Video: a long recording cut into several reels (default ~/Reels/raw-long)
#   REEL_WATCH_RAW_YOUTUBE   Raw - Full YouTube Edit: the whole long video edited for YouTube (default ~/Reels/raw-youtube)
#   REEL_WATCH_RAW_RUNWAY    Raw - Reel with Runway B-roll: the full look with generated video clips (default ~/Reels/raw-runway)
#   REEL_WATCH_RAW_OWN_BROLL Raw - My B-roll clips: import footage in place (default ~/Reels/raw-own-broll)
#   REEL_WATCH_ROOT          work folder (default ~/Reels); markers live in videos/.seen
#   REEL_CLIENTS             client roots (default ~/Reels/clients; scripts/client.mjs makes them), scanned after
#                            Greg's folders under the same lock, each job with that client's client.env
# A clip is skipped once it has a .done or .failed marker. Rename a failed clip to retry it.
set -uo pipefail

[ ! -f "$HOME/.reel/env.sh" ] || . "$HOME/.reel/env.sh"
[ -f "$HOME/.reel/env.sh" ] || export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

RAW="${REEL_WATCH_RAW:-$HOME/Reels/raw}"
RAW_BROLL="${REEL_WATCH_RAW_BROLL:-$HOME/Reels/raw-broll}"
RAW_CAROUSEL="${REEL_WATCH_RAW_CAROUSEL:-$HOME/Reels/raw-carousel}"
RAW_LONG="${REEL_WATCH_RAW_LONG:-$HOME/Reels/raw-long}"
RAW_YOUTUBE="${REEL_WATCH_RAW_YOUTUBE:-$HOME/Reels/raw-youtube}"
RAW_RUNWAY="${REEL_WATCH_RAW_RUNWAY:-$HOME/Reels/raw-runway}"
RAW_OWN_BROLL="${REEL_WATCH_RAW_OWN_BROLL:-$HOME/Reels/raw-own-broll}"
SEEN="${REEL_WATCH_ROOT:-$HOME/Reels}/videos/.seen"
JOB="$(cd "$(dirname "$0")" && pwd)/watch-reel.sh"
mkdir -p "$RAW" "$RAW_BROLL" "$RAW_CAROUSEL" "$RAW_LONG" "$RAW_YOUTUBE" "$RAW_RUNWAY" "$RAW_OWN_BROLL" "$SEEN"
shopt -s nullglob nocaseglob
filesize() { if stat -c %s "$1" >/dev/null 2>&1; then stat -c %s "$1"; else stat -f %z "$1"; fi; }
filemtime() { if stat -c %Y "$1" >/dev/null 2>&1; then stat -c %Y "$1"; else stat -f %m "$1"; fi; }

# A settled identity is taken only after two matching size and modified-time checks.
# 75 means copying, so a later scan can try again without a failed marker.
wait_clip() {
  READY_IDENTITY=""
  if [ "${REEL_WATCH_FAST:-0}" = 1 ]; then
    READY_IDENTITY="$(filesize "$1")-$(filemtime "$1")"
    return 0
  fi
  local clip="$1" last="" current="" good=0 size mtime age i=0
  while [ "$i" -lt "${REEL_WATCH_WAIT_CHECKS:-150}" ]; do
    size=$(filesize "$clip") || return 75
    mtime=$(filemtime "$clip") || return 75
    current="$size-$mtime"; age=$(( $(date +%s) - mtime ))
    if [ "$current" = "$last" ] && [ "$size" -gt 0 ] && [ "$age" -ge "${REEL_WATCH_SETTLE_SECONDS:-5}" ]; then good=$((good + 1)); else good=0; fi
    if [ "$good" -ge 2 ]; then
      if ffprobe -v error -show_entries format=duration -of csv=p=0 "$clip" 2>/dev/null | awk 'BEGIN { ok=0 } /^[0-9]+([.][0-9]+)?$/ { if ($0+0 > 0) ok=1 } END { exit !ok }'; then
        # A probe can take time; a writer must not change the identity underneath it.
        if [ "$current" = "$(filesize "$clip")-$(filemtime "$clip")" ]; then READY_IDENTITY="$current"; return 0; fi
        good=0
      fi
    fi
    last="$current"; i=$((i + 1))
    [ "$i" -ge "${REEL_WATCH_WAIT_CHECKS:-150}" ] || sleep "${REEL_WATCH_WAIT_SECONDS:-2}"
  done
  # A paused copy can look stable but still be missing the end of the video.
  return 75
}

failure_note() {
  printf '%s\n\nYour original is safe. Read %s/watch.log or share that log with the person who sent you this kit before trying again.\n' "$2" "${REEL_WATCH_ROOT:-$HOME/Reels}" > "$1 - why it failed.txt"
}

# One scanner at a time: launchd fires on every change and a hand-run must not race it on the same clip.
# A lock older than 3 hours is a crashed run and is taken over.
LOCK="$SEEN/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ "$(( $(date +%s) - $(filemtime "$LOCK") ))" -gt 10800 ]; then rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# One pass over a set of drop folders: $1 marker folder, $2 client.env ("" for Greg's own), then mode|folder pairs.
scan() {
  local seen="$1" envf="$2" pair mode dir f base key mark ready status identity
  shift 2
  for pair in "$@"; do
    mode="${pair%%|*}"; dir="${pair#*|}"
    for f in "$dir"/*.{mov,mp4,m4v}; do
      # Name-only markers from older installs still count.
      base="$(basename "$f")"; [ "$mode" = reel ] || base="$mode-$base"
      [ -e "$seen/$base.done" ] || [ -e "$seen/$base.failed" ] && continue
      wait_clip "$f"; ready=$?
      if [ "$ready" = 75 ]; then
        printf 'Still copying %s. Editing will start when copying finishes.\n' "$(basename "$f")"
        continue
      fi
      identity="$READY_IDENTITY"
      [ "$identity" = "$(filesize "$f")-$(filemtime "$f")" ] || continue
      key="$base@$identity"
      [ -e "$seen/$key.done" ] || [ -e "$seen/$key.failed" ] && continue
      # The child uses this exact settled copy, with this client's settings after the shared environment.
      if [ -n "$envf" ]; then
        ( set -a; . "$envf"; set +a; REEL_WATCH_CLIENT_ENV="$envf" REEL_WATCH_READY="$identity" "$JOB" "$f" "$mode" ); status=$?
      else
        REEL_WATCH_READY="$identity" "$JOB" "$f" "$mode"; status=$?
      fi
      [ "$status" != 75 ] || continue
      # Replacing or extending the input during an edit leaves the new copy for a later scan.
      [ "$identity" = "$(filesize "$f")-$(filemtime "$f")" ] || continue
      if [ "$status" = 0 ]; then
        mark="$seen/$key.done"
        rm -f "$f - why it failed.txt"
      else
        mark="$seen/$key.failed"
        failure_note "$f" "The edit stopped before it finished. Nothing was posted." || { echo "Cannot save the note beside this video." >&2; exit 1; }
      fi
      touch "$mark" || { echo "Cannot save this clip's result; stopping to avoid editing it twice." >&2; exit 1; }
      did=1
    done
  done
}

# Clients (scripts/client.mjs): each has its own drop folders and markers under ~/Reels/clients/<slug>.
CLIENTS="${REEL_CLIENTS:-$HOME/Reels/clients}"

# Keep scanning until a pass finds nothing new, so clips dropped mid-render are not missed.
while :; do
  did=0
  scan "$SEEN" "" "reel|$RAW" "broll|$RAW_BROLL" "carousel|$RAW_CAROUSEL" "long|$RAW_LONG" "youtube|$RAW_YOUTUBE" "runway|$RAW_RUNWAY" "own-broll|$RAW_OWN_BROLL"
  for envf in "$CLIENTS"/*/client.env; do
    c="$(dirname "$envf")"
    mkdir -p "$c/videos/.seen"
    scan "$c/videos/.seen" "$envf" "reel|$c/raw" "broll|$c/raw-broll" "carousel|$c/raw-carousel" "long|$c/raw-long" "youtube|$c/raw-youtube" "runway|$c/raw-runway"
  done
  [ "$did" = 1 ] || break
done
