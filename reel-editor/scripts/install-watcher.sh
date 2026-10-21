#!/bin/bash
# Turn the drop folder on without n8n: a launchd agent that runs watch-folder.sh whenever ~/Reels/raw changes.
#   install-watcher.sh             write the agent and load it
#   install-watcher.sh --dry-run   print the agent plist and validate it, change nothing
#   install-watcher.sh --uninstall unload and remove it
set -euo pipefail

LABEL="com.pingel.reel-watch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"
RAW="${REEL_WATCH_RAW:-$HOME/Reels/raw}"
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
  <key>WatchPaths</key>
  <array><string>$RAW</string></array>
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

mkdir -p "$RAW" "$(dirname "$PLIST")"
mv "$tmp" "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL: drop clips in $RAW, finished reels go to ${REEL_WATCH_DONE:-$HOME/Reels/done}"
