#!/bin/bash
# One drop-folder job: wait for the file to finish copying, run `reel edit`, copy the render to the done folder.
# Usage: watch-reel.sh /path/to/clip.mov
# Hook from the filename: "clip__You don't have a sales problem.mov" -> --hook "You don't have a sales problem"
# Tags in the filename: "#nocta" skips the CTA, "#nozoom" skips zooms, "#landscape" renders 16:9,
# "#low" drops the hook to chest height (wide shots where the default sits on your head),
# "#top" lifts it above the head (close-up selfies where your face fills the middle).
# After the reel lands, write-caption.mjs adds "<name> - caption.txt" (Sandcastles-backed post copy) when the
# Claude Code CLI is installed; REEL_WATCH_CAPTION=0 turns that off.
# The finished MP4 in the done folder is named after the hook when there is one.
# Prints one JSON line on success: {"ok":true,"input":...,"output":...,"name":...}
set -euo pipefail

FILE="${1:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo '{"ok":false,"error":"no such file"}'; exit 1; }

# Environment: n8n and launchd start with a bare PATH, so set everything the pipeline needs here.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# Pull REEL_/ELEVENLABS_/PRODUCER_ exports from ~/.zshrc, but let values already set (n8n, launchd, a test) win.
if [ -f "$HOME/.zshrc" ]; then
  while IFS= read -r line; do
    var="${line#export }"; var="${var%%=*}"
    [ "$var" != "PATH" ] && [ -n "${!var+x}" ] && continue
    eval "$line"
  done < <(grep -E '^export (REEL_|ELEVENLABS_|PRODUCER_|PATH=)' "$HOME/.zshrc" 2>/dev/null || true)
fi
export PRODUCER_BROWSER_GPU_MODE="${PRODUCER_BROWSER_GPU_MODE:-hardware}"

REELS="${REEL_WATCH_ROOT:-$HOME/Reels}"
DONE="${REEL_WATCH_DONE:-$REELS/done}"
CTA="${REEL_WATCH_CTA-Comment GHOST}"   # unset: default; set but empty: no CTA
EXTRA_ARGS="${REEL_WATCH_ARGS:-}"
mkdir -p "$DONE" "$REELS/videos"

# Wait until the file stops growing (phone exports and Drive sync write in chunks).
filesize() { if stat -c %s "$1" >/dev/null 2>&1; then stat -c %s "$1"; else stat -f %z "$1"; fi; }
last=-1
for _ in $(seq 1 120); do
  size=$(filesize "$FILE")
  if [ "$size" = "$last" ] && [ "$size" -gt 0 ]; then break; fi
  last=$size
  sleep 2
done

# Mac notification (shows on the Mini; harmless when there is no GUI session).
notify() { local t m; t=$(printf '%s' "$1" | tr '"' "'"); m=$(printf '%s' "$2" | tr '"' "'"); osascript -e "display notification \"$m\" with title \"$t\"" >/dev/null 2>&1 || true; }

base=$(basename "$FILE")
stem="${base%.*}"
hook=""
case "$stem" in *__*) hook="${stem#*__}"; stem="${stem%%__*}";; esac
hook=$(printf '%s' "$hook" | sed -E 's/ *#[a-z]+//g; s/^ +| +$//g')
flags=()
[ -n "$hook" ] && flags+=(--hook "$hook")
case "$base" in *"#nocta"*) ;; *) [ -n "$CTA" ] && flags+=(--cta "$CTA");; esac
case "$base" in *"#nozoom"*) flags+=(--no-zooms);; esac
case "$base" in *"#landscape"*) flags+=(--canvas landscape);; esac
case "$base" in *"#low"*) flags+=(--hook-position 0.40);; esac
case "$base" in *"#top"*) flags+=(--hook-position 0.08);; esac
name=$(echo "$stem" | sed -E 's/#[a-z]+//g; s/[^A-Za-z0-9]+/-/g; s/^-+|-+$//g' | tr 'A-Z' 'a-z')
[ -n "$name" ] || name="reel"

work="$REELS/videos/$name"
log="$REELS/watch.log"
echo "$(date '+%F %T') start $base -> $work ${flags[*]:-}" >> "$log"
cd "$REELS"
# shellcheck disable=SC2086
# ${flags[@]+...}: macOS bash 3.2 treats an empty array as unbound under set -u (a plain drop has no flags).
if reel edit "$FILE" --out "$work" --title "$name" ${flags[@]+"${flags[@]}"} $EXTRA_ARGS >> "$log" 2>&1; then
  out="$work/renders/$name.mp4"
  # Readable name from the hook ("Running late - Stay out of the meeting.mp4"), else the slug.
  used_hook="$hook"
  [ -n "$used_hook" ] || used_hook=$(node -e 'try{const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((p.hook&&p.hook.text)||"")}catch(e){}' "$work/plan.json" 2>/dev/null || true)
  pretty=$(printf '%s' "$used_hook" | sed -E 's/[?!]+ */ - /g; s#[/:"*<>|\\]##g; s/ +/ /g; s/^ +| +$//g; s/ -$//')
  dest="$DONE/${pretty:-$name}.mp4"
  # Never overwrite a finished reel (macOS also refuses it for background jobs on the Desktop): add (2), (3), ...
  if [ -e "$dest" ]; then n=2; while [ -e "$DONE/${pretty:-$name} ($n).mp4" ]; do n=$((n + 1)); done; dest="$DONE/${pretty:-$name} ($n).mp4"; fi
  cp "$out" "$dest"
  # Words the two transcription engines disagreed on, or were unsure of, go next to the reel.
  note="${dest%.mp4} - check these words.txt"
  if [ -s "$work/review.txt" ]; then cp -f "$work/review.txt" "$note"; else rm -f "$note"; fi
  echo "$(date '+%F %T') done  $dest" >> "$log"
  if [ -s "$work/review.txt" ]; then notify "Reel ready: check a few words" "$(basename "$dest" .mp4). See the note next to it."; else notify "Reel ready" "$(basename "$dest" .mp4)"; fi
  # Post copy (caption, hashtags, hook options) from Sandcastles via headless Claude. Never holds up the reel.
  if [ "${REEL_WATCH_CAPTION:-1}" != 0 ] && command -v claude >/dev/null 2>&1; then
    caption="${dest%.mp4} - caption.txt"
    if node "$HERE/write-caption.mjs" "$work" "$caption" >> "$log" 2>&1 && [ -s "$caption" ]; then
      notify "Caption ready" "$(basename "$caption" .txt)"
    fi
  fi
  printf '{"ok":true,"input":"%s","output":"%s","name":"%s","hook":"%s"}\n' "$FILE" "$dest" "$name" "$hook"
else
  echo "$(date '+%F %T') FAIL  $base (see above)" >> "$log"
  notify "Reel failed" "$base. Rename it to retry; details in ~/Reels/watch.log"
  printf '{"ok":false,"input":"%s","name":"%s","log":"%s"}\n' "$FILE" "$name" "$log"
  exit 1
fi
