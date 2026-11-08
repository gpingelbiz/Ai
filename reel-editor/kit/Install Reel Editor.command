#!/bin/bash
# Run from Terminal or double click to install the tested editor with this kit's brand.
set -o pipefail
clear
printf 'This works the same when started from Terminal.\n'
printf '\nReel Editor\n\n'
printf 'This gets editing ready in your account.\n'
printf 'The first setup downloads tools and speech recognition. Keep this window open.\n\n'
KIT="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$KIT/Brand/my-brand.json" ]; then
  printf 'The Brand folder is missing next to this file. Unzip the whole kit, then open this file inside it.\n'
  read -r -p "Press Return to close. " _ < /dev/tty || true
  exit 1
fi
if [ ! -f "$KIT/install.sh" ] || [ ! -f "$KIT/release.json" ]; then
  printf 'The setup files are missing. Unzip the whole kit, then try again.\n'
  read -r -p "Press Return to close. " _ < /dev/tty || true
  exit 1
fi
cd "$HOME" || exit 1
bash "$KIT/install.sh" --brand "$KIT/Brand" --release "$KIT/release.json"
STATUS=$?
if [ "$STATUS" = 0 ]; then
  printf '\nUse the Raw folders in Desktop/Reels for your clips. Start Here.html explains the next steps.\n'
else
  printf '\nThe install stopped. Read the message above, then use the Terminal steps in Setup Guide.html to continue.\n'
fi
read -r -p "Press Return to close. " _ < /dev/tty || true
exit "$STATUS"
