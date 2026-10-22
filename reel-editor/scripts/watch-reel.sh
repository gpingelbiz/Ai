#!/bin/bash
# One drop-folder job: wait for the file to finish copying, make what its folder asks for, deliver it.
# Usage: watch-reel.sh /path/to/clip.mov [reel|broll|carousel]
#   reel      the edited reel, classic look (Anton pop captions, no cards)        -> "<date> Reel <n>/"
#   broll     the full look: graphic cards, reveal captions, Codex b-roll photos -> "<date> Reel <n> with B-roll/"
#   carousel  an IG carousel from the video     -> "<date> Carousel <n>/"
# watch-folder.sh picks the mode from the drop folder (Raw - Reel, Raw - Reel with B-roll, Raw - Carousel).
# Hook from the filename: "clip__You don't have a sales problem.mov" -> --hook "You don't have a sales problem"
# Tags in the filename: "#nocta" skips the CTA, "#nozoom" skips zooms, "#landscape" renders 16:9,
# "#low" drops the hook to chest height (wide shots where the default sits on your head),
# "#top" lifts it above the head (close-up selfies where your face fills the middle).
# Music: the editor picks a track from REEL_WATCH_MUSIC (default ~/Reels/music; Desktop/Reels/Music is a shortcut) by
# the mood of what is said, at REEL_WATCH_MUSIC_VOLUME (default 0.10) under the voice. "#music:calm" asks for the track
# whose name contains "calm"; "#nomusic" skips it. Nothing happens when the folder is empty. music.txt names the track.
# Every folder also gets caption.txt (Sandcastles-backed post copy via write-caption.mjs) when the Claude Code
# CLI is installed; REEL_WATCH_CAPTION=0 turns that off. B-roll and carousels need the Codex CLI signed in.
# Prints one JSON line on success: {"ok":true,"input":...,"output":...,"name":...}
set -euo pipefail

FILE="${1:-}"
MODE="${2:-reel}"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo '{"ok":false,"error":"no such file"}'; exit 1; }
case "$MODE" in reel|broll|carousel) ;; *) echo '{"ok":false,"error":"mode must be reel, broll or carousel"}'; exit 1;; esac
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
MUSIC_DIR="${REEL_WATCH_MUSIC:-$REELS/music}"
MUSIC_VOLUME="${REEL_WATCH_MUSIC_VOLUME:-}"
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

# Create and print a brand-new "<today> <kind> <n><suffix>" folder under $1 ("2026-10-21 Reel 3",
# "2026-10-21 Reel 4 with B-roll", "2026-10-21 Carousel 1"), keeping today's count per kind in $2.
# Background jobs cannot list Desktop folders (macOS privacy), so this never globs $1: it starts one past the
# count it saved, and `mkdir` (no -p) fails on a folder that already exists, so it moves on to the next number.
# Nothing can ever land in, or overwrite, an existing folder.
create_reel_folder() {
  local day n count tries kind suffix
  kind="${3:-Reel}"; suffix="${4:-}"
  day="$(date +%F)"; count="$2/$(printf '%s' "$kind" | tr 'A-Z' 'a-z')-count-$day"; n=1; tries=0
  if [ -f "$count" ]; then n=$(( $(cat "$count" 2>/dev/null || echo 0) + 1 )); fi
  until mkdir "$1/$day $kind $n$suffix" 2>/dev/null; do
    n=$((n + 1)); tries=$((tries + 1))
    [ "$tries" -lt 500 ] || return 1
  done
  echo "$n" > "$count"
  printf '%s/%s %s %d%s' "$1" "$day" "$kind" "$n" "$suffix"
}

base=$(basename "$FILE")
stem="${base%.*}"
hook=""
case "$stem" in *__*) hook="${stem#*__}"; stem="${stem%%__*}";; esac
hook=$(printf '%s' "$hook" | sed -E 's/ *#[a-z]+(:[A-Za-z0-9_-]+)?//g; s/^ +| +$//g')
flags=()
[ -n "$hook" ] && flags+=(--hook "$hook")
case "$base" in *"#nocta"*) ;; *) [ -n "$CTA" ] && flags+=(--cta "$CTA");; esac
case "$base" in *"#nozoom"*) flags+=(--no-zooms);; esac
case "$base" in *"#landscape"*) flags+=(--canvas landscape);; esac
case "$base" in *"#low"*) flags+=(--hook-position 0.40);; esac
case "$base" in *"#top"*) flags+=(--hook-position 0.08);; esac
# Music: the editor picks from the music folder by the mood of what is said; "#music:<name>" asks for a track
# whose file name contains <name>; "#nomusic" skips it. Carousels never get music.
if [ "$MODE" != carousel ] && [ -d "$MUSIC_DIR" ]; then
  case "$base" in
    *"#nomusic"*) ;;
    *)
      flags+=(--music-dir "$MUSIC_DIR")
      case "$base" in *"#music:"*) want="${base#*#music:}"; want="${want%%[ .#]*}"; flags+=(--music-want "$want");; esac
      [ -n "$MUSIC_VOLUME" ] && flags+=(--music-volume "$MUSIC_VOLUME")
      ;;
  esac
fi
# The b-roll folder gets the full look (the preset's cards and reveal captions plus photos); the plain folder keeps
# the classic captions with no cards.
case "$MODE" in
  broll) flags+=(--broll --graphics --caption-style reveal);;
  reel) flags+=(--no-graphics --caption-style pop);;
esac
# A carousel needs the transcript and plan, not a render.
[ "$MODE" = carousel ] && flags+=(--no-render)
name=$(echo "$stem" | sed -E 's/#[a-z]+(:[A-Za-z0-9_-]+)?//g; s/[^A-Za-z0-9]+/-/g; s/^-+|-+$//g' | tr 'A-Z' 'a-z')
[ -n "$name" ] || name="reel"
# Each mode has its own work folder, so the same clip can go through two drop folders.
case "$MODE" in broll) name="$name-broll";; carousel) name="$name-carousel";; esac

work="$REELS/videos/$name"
log="$REELS/watch.log"
echo "$(date '+%F %T') start $base ($MODE) -> $work ${flags[*]:-}" >> "$log"
cd "$REELS"
# shellcheck disable=SC2086
# ${flags[@]+...}: macOS bash 3.2 treats an empty array as unbound under set -u (a plain drop has no flags).
if ! reel edit "$FILE" --out "$work" --title "$name" ${flags[@]+"${flags[@]}"} $EXTRA_ARGS >> "$log" 2>&1; then
  echo "$(date '+%F %T') FAIL  $base (see above)" >> "$log"
  notify "Reel failed" "$base. Rename it to retry; details in ~/Reels/watch.log"
  printf '{"ok":false,"input":"%s","name":"%s","log":"%s"}\n' "$FILE" "$name" "$log"
  exit 1
fi

# Readable name from the hook ("Running late - Stay out of the meeting.mp4"), else the slug.
used_hook="$hook"
[ -n "$used_hook" ] || used_hook=$(node -e 'try{const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((p.hook&&p.hook.text)||"")}catch(e){}' "$work/plan.json" 2>/dev/null || true)
pretty=$(printf '%s' "$used_hook" | sed -E 's/[?!]+ */ - /g; s#[/:"*<>|\\]##g; s/ +/ /g; s/^ +| +$//g; s/ -$//')
title="${pretty:-$name}"
mkdir -p "$DONE"

if [ "$MODE" = carousel ]; then
  folder="$(create_reel_folder "$DONE" "$REELS/videos" Carousel)"
  label="$(basename "$folder")"
  if ! reel carousel "$work" --out "$folder" --images "${REEL_WATCH_CAROUSEL_IMAGES:-3}" >> "$log" 2>&1; then
    echo "$(date '+%F %T') FAIL  $base carousel (see above)" >> "$log"
    printf 'The carousel could not be made this time (usually Codex was busy or rate-limited).\nRename the clip in Raw - Carousel (any new name) and drop it again in 20 minutes. Details: ~/Reels/watch.log\n' > "$folder/Carousel failed.txt"
    notify "Carousel failed" "$base. Try again in 20 minutes; see the note in $label"
    printf '{"ok":false,"input":"%s","name":"%s","log":"%s"}\n' "$FILE" "$name" "$log"
    exit 1
  fi
  dest="$folder"
  echo "$(date '+%F %T') done  $dest" >> "$log"
  notify "$label ready" "$title"
else
  shots=""
  if [ "$MODE" = broll ]; then
    # The stills this reel used, from its plan (one path per line).
    shots=$(node -e 'try{const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const b of p.broll||[])if(b.file)console.log(b.file)}catch(e){}' "$work/plan.json" 2>/dev/null || true)
    folder="$(create_reel_folder "$DONE" "$REELS/videos" Reel " with B-roll")"
  else
    folder="$(create_reel_folder "$DONE" "$REELS/videos" Reel)"
  fi
  label="$(basename "$folder")"
  dest="$folder/$title.mp4"
  cp "$work/renders/$name.mp4" "$dest"
  if [ -n "$shots" ]; then
    i=1
    while IFS= read -r still; do
      [ -f "$still" ] && cp "$still" "$folder/B-roll $i.png" && i=$((i + 1))
    done <<< "$shots"
  elif [ "$MODE" = broll ]; then
    printf 'No b-roll this time: Codex was busy or rate-limited, so this reel came out without it.\nRename the clip in Raw - Reel with B-roll (any new name) and drop it again in 20 minutes.\n' > "$folder/No b-roll this time.txt"
  fi
  [ -s "$work/review.txt" ] && cp -f "$work/review.txt" "$folder/check these words.txt"
  [ -s "$work/music.txt" ] && cp -f "$work/music.txt" "$folder/music.txt"
  echo "$(date '+%F %T') done  $dest" >> "$log"
  if [ -s "$work/review.txt" ]; then notify "$label ready: check a few words" "$title. See the note in its folder."; else notify "$label ready" "$title"; fi
fi

# Post copy (caption, hashtags, hook options) from Sandcastles via headless Claude. Never holds up the delivery.
if [ "${REEL_WATCH_CAPTION:-1}" != 0 ] && command -v claude >/dev/null 2>&1; then
  if node "$HERE/write-caption.mjs" "$work" "$folder/caption.txt" >> "$log" 2>&1 && [ -s "$folder/caption.txt" ]; then
    notify "$label caption ready" "$title"
  fi
fi
printf '{"ok":true,"input":"%s","output":"%s","name":"%s","hook":"%s"}\n' "$FILE" "$dest" "$name" "$hook"
