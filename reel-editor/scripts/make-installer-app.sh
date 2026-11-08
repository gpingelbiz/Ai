#!/bin/bash
# Keep personalised files outside the signed app so the seal stays intact.
set -euo pipefail
SKIP='No Developer ID on this Mac: kits ship the Terminal steps.'
if [ "$#" != 1 ] || [ ! -d "$1" ]; then
  printf 'Usage: make-installer-app.sh <kit folder>\n' >&2
  exit 2
fi
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application:.*\)".*/\1/p' | head -n 1 || true)"
if [ -z "$IDENTITY" ] || [ -z "${REEL_NOTARY_PROFILE:-}" ]; then
  printf '%s\n' "$SKIP"
  exit 0
fi
# A saved profile is required. Never open a credential prompt or save credentials here.
if ! xcrun notarytool history --keychain-profile "$REEL_NOTARY_PROFILE" --output-format json </dev/null >/dev/null 2>&1; then
  printf '%s\n' "$SKIP"
  exit 0
fi
KIT="$(cd "$1" && pwd)"
NAME='Install Reel Editor'
STUDIO=''
if [ -f "$KIT/Install Reels.command" ]; then NAME='Install Reels'; STUDIO=' --studio'; fi
EXPECTED='bash "$KIT/install.sh" --brand "$KIT/Brand"'
EXPECTED="$EXPECTED$STUDIO"' --release "$KIT/release.json"'
if [ ! -f "$KIT/install.sh" ] || [ ! -f "$KIT/release.json" ] || [ ! -d "$KIT/Brand" ] || ! grep -Fxq "$EXPECTED" "$KIT/$NAME.command"; then
  printf 'The kit setup files do not match its installer.\n' >&2
  exit 1
fi
if [ -e "$KIT/$NAME.app" ]; then
  printf 'An installer app is already in this kit. Use a fresh kit folder.\n' >&2
  exit 1
fi
TEMP_PARENT="${TMPDIR:-/tmp}"
WORK="$(mktemp -d "${TEMP_PARENT%/}/reel-installer.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/$NAME.app"
# Resolve the folder at launch time. macOS may run the app from a temporary folder.
cat > "$WORK/installer.applescript" <<APPLESCRIPT
on run
  set kitPath to do shell script "/usr/bin/dirname " & quoted form of (POSIX path of (path to me))
  try
    do shell script "/bin/test -f " & quoted form of (kitPath & "/install.sh") & " && /bin/test -f " & quoted form of (kitPath & "/release.json") & " && /bin/test -d " & quoted form of (kitPath & "/Brand")
  on error
    set kitPath to POSIX path of (choose folder with prompt "Choose the unzipped Reels kit folder that contains the Install file.")
  end try
  set installCommand to "bash " & quoted form of (kitPath & "/install.sh") & " --brand " & quoted form of (kitPath & "/Brand") & "$STUDIO --release " & quoted form of (kitPath & "/release.json")
  tell application "Terminal"
    activate
    do script installCommand
  end tell
end run
APPLESCRIPT
osacompile -o "$APP" "$WORK/installer.applescript" </dev/null
plutil -replace CFBundleIdentifier -string com.pingel.reel-installer "$APP/Contents/Info.plist"
plutil -replace NSAppleEventsUsageDescription -string 'Opens Terminal to install Reels in your account.' "$APP/Contents/Info.plist"
# Hardened apps need permission to send the install command to Terminal.
cat > "$WORK/entitlements.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.automation.apple-events</key><true/></dict></plist>
PLIST
codesign --force --options runtime --timestamp --entitlements "$WORK/entitlements.plist" --sign "$IDENTITY" "$APP" </dev/null
codesign --verify --deep --strict "$APP" </dev/null
ditto -c -k --keepParent "$APP" "$WORK/installer.zip"
xcrun notarytool submit "$WORK/installer.zip" --keychain-profile "$REEL_NOTARY_PROFILE" --wait --output-format json </dev/null > "$WORK/notary.json"
if ! grep -Eq '"status"[[:space:]]*:[[:space:]]*"Accepted"' "$WORK/notary.json"; then
  printf 'The installer app was not approved. No app was added to the kit.\n' >&2
  exit 1
fi
xcrun stapler staple "$APP" </dev/null
xcrun stapler validate "$APP" </dev/null
spctl -a -vv --type execute "$APP" </dev/null
mv "$APP" "$KIT/$NAME.app"
printf 'Signed installer app added to the kit.\n'
