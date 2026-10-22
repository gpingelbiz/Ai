#!/bin/bash
# One drop-folder job: wait for the file to finish copying, run `reel edit`, copy the render to the done folder.
# Usage: watch-reel.sh /path/to/clip.mov
# Hook from the filename: "clip__You don't have a sales problem.mov" -> --hook "You don't have a sales problem"
# Tags in the filename: "#nocta" skips the CTA, "#nozoom" skips zooms, "#landscape" renders 16:9,
# "#low" drops the hook to chest height (wide shots where the default sits on your head),
# "#top" lifts it above the head (close-up selfies where your face fills the middle).
# "#nobroll" skips the Codex b-roll stills, "#nocarousel" skips the carousel (REEL_WATCH_BROLL=0 and
# REEL_WATCH_CAROUSEL=0 turn them off for every drop). Both need the Codex CLI signed in, else they are skipped.
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

# Create and print a brand-new "<today> Reel <n>" folder under $1, keeping today's count in $2.
# Background jobs cannot list Desktop folders (macOS privacy), so this never globs $1: it starts one past the
# count it saved, and `mkdir` (no -p) fails on a folder that already exists, so it moves on to the next number.
# A reel can never land in, or overwrite, an existing folder.
create_reel_folder() {
  local day n count tries
  day="$(date +%F)"; count="$2/reel-count-$day"; n=1; tries=0
  if [ -f "$count" ]; then n=$(( $(cat "$count" 2>/dev/null || echo 0) + 1 )); fi
  until mkdir "$1/$day Reel $n" 2>/dev/null; do
    n=$((n + 1)); tries=$((tries + 1))
    [ "$tries" -lt 500 ] || return 1
  done
  echo "$n" > "$count"
  printf '%s/%s Reel %d' "$1" "$day" "$n"
}

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
broll=1; carousel=1
{ [ "${REEL_WATCH_BROLL:-1}" = 0 ] || ! command -v codex >/dev/null 2>&1; } && broll=0
{ [ "${REEL_WATCH_CAROUSEL:-1}" = 0 ] || ! command -v codex >/dev/null 2>&1; } && carousel=0
case "$base" in *"#nobroll"*) broll=0;; esac
case "$base" in *"#nocarousel"*) carousel=0;; esac
[ "$broll" = 1 ] && flags+=(--broll --both)
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
  # Each reel gets its own folder: "<YYYY-MM-DD> Reel <n>", numbered through the day. A new folder also means a
  # reel is never overwritten. Inside:
  #   Reel with B-roll/     the reel with the Codex cutaways, plus the stills on their own
  #   Reel with no B-roll/  the same reel without them
  #   Carousel/             the IG slides made from the video, plus their text
  #   caption.txt, and "check these words.txt" when the engines disagreed
  mkdir -p "$DONE"
  folder="$(create_reel_folder "$DONE" "$REELS/videos")"
  reel_label="$(basename "$folder")"
  file="${pretty:-$name}.mp4"
  plain="$out"
  [ "$broll" = 1 ] && [ -f "$work/renders/$name-no-broll.mp4" ] && plain="$work/renders/$name-no-broll.mp4"
  mkdir "$folder/Reel with no B-roll"
  dest="$folder/Reel with no B-roll/$file"
  cp "$plain" "$dest"
  if [ "$broll" = 1 ]; then
    mkdir "$folder/Reel with B-roll"
    # The stills this reel used, from its plan (one path per line).
    stills=$(node -e 'try{const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const b of p.broll||[])if(b.file)console.log(b.file)}catch(e){}' "$work/plan.json" 2>/dev/null || true)
    if [ -n "$stills" ]; then
      dest="$folder/Reel with B-roll/$file"
      cp "$out" "$dest"
      i=1
      while IFS= read -r still; do
        [ -f "$still" ] && cp "$still" "$folder/Reel with B-roll/B-roll $i.png" && i=$((i + 1))
      done <<< "$stills"
    else
      printf 'No b-roll this time: Codex was busy or rate-limited, so this reel has only the version without b-roll.\nTo get it, rename the clip in Raw (any new name) and drop it again in 20 minutes.\n' > "$folder/Reel with B-roll/No b-roll this time.txt"
    fi
  fi
  if [ -s "$work/review.txt" ]; then cp -f "$work/review.txt" "$folder/check these words.txt"; fi
  echo "$(date '+%F %T') done  $dest" >> "$log"
  if [ -s "$work/review.txt" ]; then notify "$reel_label ready: check a few words" "$(basename "$dest" .mp4). See the note in its folder."; else notify "$reel_label ready" "$(basename "$dest" .mp4)"; fi
  # The carousel (Codex) runs alongside the post copy (Claude + Sandcastles). Neither holds up the reel.
  if [ "$carousel" = 1 ]; then
    (
      if reel carousel "$work" --out "$folder/Carousel" >> "$log" 2>&1; then notify "$reel_label carousel ready" "$(basename "$dest" .mp4)"
      else echo "$(date '+%F %T') carousel failed for $name (reel is fine)" >> "$log"; fi
    ) &
  fi
  # Post copy (caption, hashtags, hook options) from Sandcastles via headless Claude.
  if [ "${REEL_WATCH_CAPTION:-1}" != 0 ] && command -v claude >/dev/null 2>&1; then
    caption="$folder/caption.txt"
    if node "$HERE/write-caption.mjs" "$work" "$caption" >> "$log" 2>&1 && [ -s "$caption" ]; then
      notify "$reel_label caption ready" "$(basename "$dest" .mp4)"
    fi
  fi
  wait
  printf '{"ok":true,"input":"%s","output":"%s","name":"%s","hook":"%s"}\n' "$FILE" "$dest" "$name" "$hook"
else
  echo "$(date '+%F %T') FAIL  $base (see above)" >> "$log"
  notify "Reel failed" "$base. Rename it to retry; details in ~/Reels/watch.log"
  printf '{"ok":false,"input":"%s","name":"%s","log":"%s"}\n' "$FILE" "$name" "$log"
  exit 1
fi
