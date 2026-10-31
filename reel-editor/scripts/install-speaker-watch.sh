#!/bin/bash
# One draft-only speaker agent. Roots are passed explicitly to launchd.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export SPEAKER_HOME="${SPEAKER_HOME:-$HOME}"
export SPEAKER_CLIENTS_ROOT="${SPEAKER_CLIENTS_ROOT:-$SPEAKER_HOME/Reels/speaker-clients}"
AGENTS="${SPEAKER_AGENT_DIR:-$SPEAKER_HOME/Library/LaunchAgents}"
LABEL="com.pingel.speaker-watch"
PLIST="$AGENTS/$LABEL.plist"
LAUNCHCTL="${SPEAKER_LAUNCHCTL:-launchctl}"
DRY=0; UNINSTALL=0
for arg in "$@"; do
  case "$arg" in --dry-run) DRY=1;; --uninstall) UNINSTALL=1;; *) echo "usage: install-speaker-watch.sh [--dry-run] [--uninstall]" >&2; exit 2;; esac
done
if [ "$UNINSTALL" = 1 ]; then
  if [ "$DRY" = 1 ]; then echo "Would unload $LABEL and remove $PLIST"; exit 0; fi
  "$LAUNCHCTL" bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL (all client footage kept)"
  exit 0
fi
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
node "$HERE/speaker-client.mjs" --plist > "$tmp"
if command -v plutil >/dev/null 2>&1; then
  plutil -lint -- "$tmp" >&2
else
  python3 -c 'import plistlib,sys; plistlib.load(open(sys.argv[1],"rb"))' "$tmp"
fi
if [ "$DRY" = 1 ]; then cat "$tmp"; echo "plist OK (dry run, nothing installed)" >&2; exit 0; fi
mkdir -p "$AGENTS" "$SPEAKER_CLIENTS_ROOT" "$(dirname "${SPEAKER_LAUNCH_LOG:-$SPEAKER_CLIENTS_ROOT/watch-launchd.log}")"
cp "$tmp" "$PLIST"
"$LAUNCHCTL" bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
"$LAUNCHCTL" bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (intake, indexing and drafts only)"
