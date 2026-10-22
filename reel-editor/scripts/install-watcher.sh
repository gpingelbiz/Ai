#!/bin/bash
# Turn the drop folders on without n8n: a launchd agent that runs watch-folder.sh whenever ~/Reels/raw,
# ~/Reels/raw-broll or ~/Reels/raw-carousel changes.
#   install-watcher.sh             write the agent and load it
#   install-watcher.sh --dry-run   print the agent plist and validate it, change nothing
#   install-watcher.sh --uninstall unload and remove it
# REEL_WATCH_RAW / REEL_WATCH_RAW_BROLL / REEL_WATCH_RAW_CAROUSEL / REEL_WATCH_DONE pick the folders; they are
# written into the agent so the script scans the same folders launchd watches.
set -euo pipefail

LABEL="com.pingel.reel-watch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"
RAW="${REEL_WATCH_RAW:-$HOME/Reels/raw}"
RAW_BROLL="${REEL_WATCH_RAW_BROLL:-$HOME/Reels/raw-broll}"
RAW_CAROUSEL="${REEL_WATCH_RAW_CAROUSEL:-$HOME/Reels/raw-carousel}"
RAW_LONG="${REEL_WATCH_RAW_LONG:-$HOME/Reels/raw-long}"
MUSIC="${REEL_WATCH_MUSIC:-$HOME/Reels/music}"
DONE="${REEL_WATCH_DONE:-$HOME/Reels/done}"
LOG="${REEL_WATCH_ROOT:-$HOME/Reels}/watch-launchd.log"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

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
    <string>$HERE/watch-folder.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>REEL_WATCH_RAW</key><string>$RAW</string>
    <key>REEL_WATCH_RAW_BROLL</key><string>$RAW_BROLL</string>
    <key>REEL_WATCH_RAW_CAROUSEL</key><string>$RAW_CAROUSEL</string>
    <key>REEL_WATCH_RAW_LONG</key><string>$RAW_LONG</string>
    <key>REEL_WATCH_MUSIC</key><string>$MUSIC</string>
    <key>REEL_WATCH_DONE</key><string>$DONE</string>
  </dict>
  <key>WatchPaths</key>
  <array><string>$RAW</string><string>$RAW_BROLL</string><string>$RAW_CAROUSEL</string><string>$RAW_LONG</string></array>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
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

mkdir -p "$RAW" "$RAW_BROLL" "$RAW_CAROUSEL" "$RAW_LONG" "$MUSIC" "$(dirname "$PLIST")"
mv "$tmp" "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL: drop clips in $RAW (reel), $RAW_BROLL (reel with b-roll), $RAW_CAROUSEL (carousel) or $RAW_LONG (long form); results go to $DONE"
