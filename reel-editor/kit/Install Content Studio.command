#!/bin/bash
# Content Studio: double-click to install or update (macOS, Apple Silicon).
# Installs the reel editor with this kit's brand, then sets up the Content Studio: your photo folder, your Claude
# sign-in, your Metricool brand, how images reach Metricool, and your posting times, and turns on the daily run.
# Running it again later updates everything and keeps your settings.
clear
printf '\n\033[1mContent Studio\033[0m\n\n'
printf 'This sets up your Content Studio on this Mac. It takes about 15 minutes.\n'
printf 'If a window asks to install Apple'"'"'s command line tools, click Install, wait, then double-click this file again.\n\n'
KIT="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$KIT/Brand/brand.json" ]; then
  printf '\033[31mThe Brand folder is missing next to this file.\033[0m Unzip the whole kit and double-click this file inside it.\n'
  read -r -p "Press Return to close. " _ < /dev/tty || true
  exit 1
fi
cd "$HOME" || exit 1
if curl -fsSL https://raw.githubusercontent.com/gpingelbiz/Ai/main/reel-editor/install.sh | bash -s -- --brand "$KIT/Brand" --studio; then
  printf '\n\033[32mAll set.\033[0m Drop photos in your photo folder and clips in Content Studio/Raw Reels. Open Start Here.html for how it works.\n'
else
  printf '\n\033[31mThe install stopped.\033[0m Read the message above, then double-click this file again. Start Here.html has fixes for the common ones.\n'
fi
printf '\nYou can close this window.\n'
read -r -p "Press Return to close. " _ < /dev/tty || true
