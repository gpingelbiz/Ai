#!/bin/bash
# Reel Editor: double-click to install or update (macOS, Apple Silicon).
# It downloads the latest installer from GitHub and asks four questions: your look, your ElevenLabs key
# (optional), whether to turn on the drop folder, and Codex for b-roll and carousels (optional). Running it again later updates everything.
clear
printf '\n\033[1mReel Editor\033[0m\n\n'
printf 'This installs Reel Editor on this Mac. It takes about 10 minutes.\n'
printf 'If a window asks to install Apple'"'"'s command line tools, click Install, wait, then double-click this file again.\n\n'
# A brand kit carries a Brand folder next to this file: the installer takes that look and asks no look question.
KIT="$(cd "$(dirname "$0")" && pwd)"
BRAND_ARGS=()
[ -f "$KIT/Brand/my-brand.json" ] && BRAND_ARGS=(--brand "$KIT/Brand")
cd "$HOME" || exit 1
if curl -fsSL https://raw.githubusercontent.com/gpingelbiz/Ai/main/reel-editor/install.sh | bash -s -- ${BRAND_ARGS[@]+"${BRAND_ARGS[@]}"}; then
  printf '\n\033[32mAll set.\033[0m Drop a clip into a Raw folder in Desktop/Reels, or open Start Here.html for how to use it.\n'
else
  printf '\n\033[31mThe install stopped.\033[0m Read the message above, then double-click this file again. Start Here.html has fixes for the common ones.\n'
fi
printf '\nYou can close this window.\n'
read -r -p "Press Return to close. " _ < /dev/tty || true
