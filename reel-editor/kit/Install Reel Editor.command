#!/bin/bash
# Reel Editor: double-click to install or update (macOS, Apple Silicon).
# It downloads the latest installer from GitHub and asks four questions: your look, your ElevenLabs key
# (optional), whether to turn on the drop folder, and Codex for b-roll and carousels (optional). Running it again later updates everything.
clear
printf '\n\033[1mReel Editor\033[0m\n\n'
printf 'This installs Reel Editor on this Mac. It takes about 10 minutes.\n'
printf 'If a window asks to install Apple'"'"'s command line tools, click Install, wait, then double-click this file again.\n\n'
cd "$HOME" || exit 1
if curl -fsSL https://raw.githubusercontent.com/gpingelbiz/Ai/main/reel-editor/install.sh | bash; then
  printf '\n\033[32mAll set.\033[0m Drop a clip into Desktop/Reels/Raw, or open Start Here.html for how to use it.\n'
else
  printf '\n\033[31mThe install stopped.\033[0m Read the message above, then double-click this file again. Start Here.html has fixes for the common ones.\n'
fi
printf '\nYou can close this window.\n'
read -r -p "Press Return to close. " _ < /dev/tty || true
