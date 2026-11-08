#!/bin/bash
# Turn the drop folders on without n8n: a launchd agent that runs watch-folder.sh whenever ~/Reels/raw,
# ~/Reels/raw-broll or ~/Reels/raw-carousel changes.
#   install-watcher.sh             write the agent and load it
#   install-watcher.sh --dry-run   print the agent plist and validate it, change nothing
#   install-watcher.sh --uninstall unload and remove it
# REEL_WATCH_RAW / REEL_WATCH_RAW_BROLL / REEL_WATCH_RAW_CAROUSEL / REEL_WATCH_DONE pick the folders; they are
# written into the agent so the script scans the same folders launchd watches.
set -euo pipefail
[ ! -f "$HOME/.reel/env.sh" ] || . "$HOME/.reel/env.sh"

LABEL="com.pingel.reel-watch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"
RAW="${REEL_WATCH_RAW:-$HOME/Reels/raw}"
RAW_BROLL="${REEL_WATCH_RAW_BROLL:-$HOME/Reels/raw-broll}"
RAW_CAROUSEL="${REEL_WATCH_RAW_CAROUSEL:-$HOME/Reels/raw-carousel}"
RAW_LONG="${REEL_WATCH_RAW_LONG:-$HOME/Reels/raw-long}"
RAW_YOUTUBE="${REEL_WATCH_RAW_YOUTUBE:-$HOME/Reels/raw-youtube}"
RAW_RUNWAY="${REEL_WATCH_RAW_RUNWAY:-$HOME/Reels/raw-runway}"
RAW_OWN_BROLL="${REEL_WATCH_RAW_OWN_BROLL:-$HOME/Reels/raw-own-broll}"
MUSIC="${REEL_WATCH_MUSIC:-$HOME/Reels/music}"
DONE="${REEL_WATCH_DONE:-$HOME/Reels/done}"
LOG="${REEL_WATCH_ROOT:-$HOME/Reels}/watch-launchd.log"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

xml() { printf '%s' "$1" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }
# No login shell: the agent gets the exact tool search path used by this setup.
AGENT_PATH="$(xml "$PATH")"
AGENT_COMMAND='[ ! -f "$HOME/.reel/env.sh" ] || . "$HOME/.reel/env.sh"; exec /bin/bash "$1"'

render() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>$(xml "$AGENT_COMMAND")</string>
    <string>reel-watch</string>
    <string>$(xml "$HERE/watch-folder.sh")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$AGENT_PATH</string>
    <key>REEL_WATCH_RAW</key><string>$(xml "$RAW")</string>
    <key>REEL_WATCH_RAW_BROLL</key><string>$(xml "$RAW_BROLL")</string>
    <key>REEL_WATCH_RAW_CAROUSEL</key><string>$(xml "$RAW_CAROUSEL")</string>
    <key>REEL_WATCH_RAW_LONG</key><string>$(xml "$RAW_LONG")</string>
    <key>REEL_WATCH_RAW_YOUTUBE</key><string>$(xml "$RAW_YOUTUBE")</string>
    <key>REEL_WATCH_RAW_RUNWAY</key><string>$(xml "$RAW_RUNWAY")</string>
    <key>REEL_WATCH_RAW_OWN_BROLL</key><string>$(xml "$RAW_OWN_BROLL")</string>
    <key>REEL_WATCH_MUSIC</key><string>$(xml "$MUSIC")</string>
    <key>REEL_WATCH_DONE</key><string>$(xml "$DONE")</string>
  </dict>
  <key>WatchPaths</key>
  <array><string>$(xml "$RAW")</string><string>$(xml "$RAW_BROLL")</string><string>$(xml "$RAW_CAROUSEL")</string><string>$(xml "$RAW_LONG")</string><string>$(xml "$RAW_YOUTUBE")</string><string>$(xml "$RAW_RUNWAY")</string><string>$(xml "$RAW_OWN_BROLL")</string></array>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
}

tmp="$(mktemp)"
render > "$tmp"
plutil -lint "$tmp" >/dev/null
if [ "${1:-}" = "--dry-run" ]; then
  cat "$tmp"
  echo "plist OK (dry run, nothing installed)" >&2
  rm -f "$tmp"
  exit 0
fi

mkdir -p "$RAW" "$RAW_BROLL" "$RAW_CAROUSEL" "$RAW_LONG" "$RAW_YOUTUBE" "$RAW_RUNWAY" "$RAW_OWN_BROLL" "$MUSIC" "$(dirname "$PLIST")"
mv "$tmp" "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL: drop clips in $RAW (reel), $RAW_BROLL (reel with b-roll), $RAW_CAROUSEL (carousel) , $RAW_LONG (long form) or $RAW_YOUTUBE (whole video for YouTube); results go to $DONE"
