#!/bin/bash
# One drop-folder job: wait for the file to finish copying, make what its folder asks for, deliver it.
# Usage: watch-reel.sh /path/to/clip.mov [reel|broll|carousel]
#   reel      the edited reel, classic look (Anton pop captions, no cards)        -> "<date> Reel <n>/"
#   broll     the full look: graphic cards, reveal captions, Codex b-roll photos -> "<date> Reel <n> with B-roll/"
#   carousel  an IG carousel from the video     -> "<date> Carousel <n>/"
#   long      a long recording (a podcast, a live, a training) cut into several reels with the full look, the
#             crop following whoever is talking, split screen when two people trade lines -> "<date> Clips <n>/"
#   runway    the full look with Runway video clips as the b-roll (RUNWAY_API_KEY; ~30 credits a clip, usage in
#             the reel folder's "runway usage.txt" and `reel usage`) -> "<date> Reel <n> with Runway/"
#   youtube   the whole long video for YouTube: chapters with title cards, re-hooks, sparse cards and b-roll,
#             112% punch-ins, a clean last 20 s, and the package (description, titles, srt, thumbnails) -> "<date> YouTube <n>/"
# watch-folder.sh picks the mode from the drop folder (Raw - Reel, Raw - Reel with B-roll, Raw - Carousel).
# Hook from the filename: "clip__You don't have a sales problem.mov" -> --hook "You don't have a sales problem"
# Tags in the filename: "#nocta" skips the CTA, "#nozoom" skips zooms, "#landscape" renders 16:9,
# "#low" drops the hook to chest height (wide shots where the default sits on your head),
# "#top" lifts it above the head (close-up selfies where your face fills the middle). "#fast" adds the measured
# short-form pacing (presets/pace-fast.json).
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
case "$MODE" in reel|broll|carousel|long|youtube|runway) ;; *) echo '{"ok":false,"error":"mode must be reel, broll, carousel, long, youtube or runway"}'; exit 1;; esac
# Environment: n8n and launchd start with a bare PATH, so set everything the pipeline needs here.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# Pull REEL_/ELEVENLABS_/PRODUCER_ exports from ~/.zshrc, but let values already set (n8n, launchd, a test) win.
if [ -f "$HOME/.zshrc" ]; then
  while IFS= read -r line; do
    var="${line#export }"; var="${var%%=*}"
    [ "$var" != "PATH" ] && [ -n "${!var+x}" ] && continue
    # A command substitution or a zsh-only expansion would abort the job under set -e; plain values (with or
    # without a trailing comment) are read as they are.
    case "$line" in
      *'$('*|*'`'*|*'${('*) ;;
      *) eval "$line" || true;;
    esac
  done < <(grep -E '^export (REEL_|ELEVENLABS_|RUNWAY_|PRODUCER_|PATH=)' "$HOME/.zshrc" 2>/dev/null || true)
fi
export PRODUCER_BROWSER_GPU_MODE="${PRODUCER_BROWSER_GPU_MODE:-hardware}"

REELS="${REEL_WATCH_ROOT:-$HOME/Reels}"
DONE="${REEL_WATCH_DONE:-$REELS/done}"
CTA="${REEL_WATCH_CTA-Comment GHOST}"   # unset: default; set but empty: no CTA
MUSIC_DIR="${REEL_WATCH_MUSIC:-$REELS/music}"
MUSIC_VOLUME="${REEL_WATCH_MUSIC_VOLUME:-}"
EXTRA_ARGS="${REEL_WATCH_ARGS:-}"
mkdir -p "$DONE" "$REELS/videos"

# Wait until the file is finished: size stable, untouched for 5 s, and readable by ffprobe twice (phone exports and
# Drive sync write in chunks, and a stalled copy can pass a size check while the file is still truncated).
# REEL_WATCH_FAST=1 skips the wait (tests).
filesize() { if stat -c %s "$1" >/dev/null 2>&1; then stat -c %s "$1"; else stat -f %z "$1"; fi; }
filemtime() { if stat -c %Y "$1" >/dev/null 2>&1; then stat -c %Y "$1"; else stat -f %m "$1"; fi; }
probe_ok() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | grep -Eq '^[0-9.]+$'; }
if [ "${REEL_WATCH_FAST:-0}" != 1 ]; then
  last=-1; good=0
  for _ in $(seq 1 150); do
    size=$(filesize "$FILE")
    age=$(( $(date +%s) - $(filemtime "$FILE") ))
    if [ "$size" = "$last" ] && [ "$size" -gt 0 ] && [ "$age" -ge 5 ] && probe_ok "$FILE"; then good=$((good + 1)); else good=0; fi
    [ "$good" -ge 2 ] && break
    last=$size
    sleep 2
  done
  if [ "$good" -lt 2 ]; then
    echo "$(date '+%F %T') FAIL  $(basename "$FILE"): still copying or not a readable video after 5 minutes" >> "${REEL_WATCH_ROOT:-$HOME/Reels}/watch.log"
    printf '{"ok":false,"input":"%s","error":"file never finished copying"}\n' "$FILE"
    exit 1
  fi
fi

# Mac notification (shows on the Mini; harmless when there is no GUI session).
notify() { local t m; t=$(printf '%s%s' "${REEL_CLIENT:+$REEL_CLIENT: }" "$1" | tr '"' "'"); m=$(printf '%s' "$2" | tr '"' "'"); osascript -e "display notification \"$m\" with title \"$t\"" >/dev/null 2>&1 || true; }

# Publish metadata next to a delivered reel (read by the Publish folder, src/publish-folder.mjs): whether the reel
# has AI pictures (Instagram's AI label), the preflight result and anything obvious the reviewer saw.
reel_meta() { # $1 work dir, $2 output json
  node -e 'const fs=require("fs"),p=require("path"),w=process.argv[1];const r=(f)=>{try{return JSON.parse(fs.readFileSync(p.join(w,f),"utf8"))}catch(e){return null}};const plan=r("plan.json")||{},pf=r("preflight.json")||{},wt=r("watch.json")||{};const hi=(wt.issues||[]).find((i)=>i.severity==="high");fs.writeFileSync(process.argv[2],JSON.stringify({isAiGenerated:!!(plan.broll&&plan.broll.length),preflight:pf.status||null,obvious:hi?hi.note:null,coverMs:50}))' "$1" "$2" 2>/dev/null || true
}

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
case "$base" in *"#fast"*) flags+=(--pace fast);; esac
case "$base" in *"#look:"*) lk="${base#*#look:}"; lk="${lk%%[ .#]*}"; flags+=(--look "$lk");; esac
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
  broll|long) flags+=(--broll --graphics --caption-style reveal);;
  # Greg's Runway look is pingel-runway; anyone else keeps their own look with Runway clips as the b-roll.
  runway) case "${REEL_PRESET:-pingel-brand}" in pingel-*) flags+=(--preset pingel-runway);; *) flags+=(--broll-engine runway);; esac
    flags+=(--broll --graphics --caption-style reveal);;
  reel) flags+=(--no-graphics --caption-style pop --no-slams --no-annotate --no-behind);;
esac
# A carousel needs the transcript and plan, not a render.
[ "$MODE" = carousel ] && flags+=(--no-render)
name=$(echo "$stem" | sed -E 's/#[a-z]+(:[A-Za-z0-9_-]+)?//g; s/[^A-Za-z0-9]+/-/g; s/^-+|-+$//g' | tr 'A-Z' 'a-z')
[ -n "$name" ] || name="reel"
# Each mode has its own work folder, so the same clip can go through two drop folders.
case "$MODE" in broll) name="$name-broll";; carousel) name="$name-carousel";; long) name="$name-clips";; youtube) name="$name-youtube";; runway) name="$name-runway";; esac

work="$REELS/videos/$name"
log="$REELS/watch.log"
# Housekeeping: keep the log under 5 MB and drop work folders (intermediates, not the delivered reels) older than
# REEL_WATCH_PRUNE_DAYS (default 30; 0 turns it off).
if [ -f "$log" ] && [ "$(filesize "$log")" -gt 5000000 ]; then tail -c 1000000 "$log" > "$log.tmp" && mv -f "$log.tmp" "$log"; fi
prune="${REEL_WATCH_PRUNE_DAYS:-30}"
if [ "$prune" -gt 0 ] 2>/dev/null; then
  find "$REELS/videos" -mindepth 1 -maxdepth 1 -type d -not -name ".*" -mtime +"$prune" -exec rm -rf {} + 2>/dev/null || true
fi
echo "$(date '+%F %T') start $base ($MODE) -> $work ${flags[*]:-}" >> "$log"
cd "$REELS"
# YouTube: the whole video. Its own preset (16:9, no burned-in captions, chapters), then the package next to it.
if [ "$MODE" = youtube ]; then
  ytflags=()
  [ -n "$hook" ] && ytflags+=(--hook "$hook")
  case "$base" in *"#captions"*) ytflags+=(--captions);; esac
  [ -d "$MUSIC_DIR" ] && case "$base" in *"#nomusic"*) ;; *) ytflags+=(--music-dir "$MUSIC_DIR");; esac
  # shellcheck disable=SC2086
  if ! reel youtube "$FILE" --out "$work" --title "$name" ${ytflags[@]+"${ytflags[@]}"} $EXTRA_ARGS >> "$log" 2>&1; then
    echo "$(date '+%F %T') FAIL  $base youtube (see above)" >> "$log"
    notify "YouTube edit failed" "$base. Rename it to retry; details in ~/Reels/watch.log"
    printf '{"ok":false,"input":"%s","name":"%s","log":"%s"}\n' "$FILE" "$name" "$log"
    exit 1
  fi
  mkdir -p "$DONE"
  folder="$(create_reel_folder "$DONE" "$REELS/videos" YouTube)"
  label="$(basename "$folder")"
  used_hook=$(node -e 'try{const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((p.hook&&p.hook.text)||"")}catch(e){}' "$work/plan.json" 2>/dev/null || true)
  pretty=$(printf '%s' "$used_hook" | sed -E 's/\*//g; s/[?!]+ */ - /g; s#[/:"*<>|\\]##g; s/ +/ /g; s/^ +| +$//g; s/ -$//; s/\.+$//')
  cp "$work/renders/$name.mp4" "$folder/${pretty:-$name}.mp4"
  for f in description.txt titles.txt captions.srt pinned_comment.txt endscreen.json edit.v3.json youtube.txt; do [ -f "$work/youtube/$f" ] && cp -f "$work/youtube/$f" "$folder/$f"; done
  for t in "$work"/youtube/thumbnails/Thumbnail*.png; do [ -f "$t" ] && cp -f "$t" "$folder/$(basename "$t")"; done
  [ -s "$work/review.txt" ] && cp -f "$work/review.txt" "$folder/check these words.txt"
  [ -s "$work/music.txt" ] && cp -f "$work/music.txt" "$folder/music.txt"
  echo "$(date '+%F %T') done  $folder" >> "$log"
  notify "$label ready" "${pretty:-$name}"
  printf '{"ok":true,"input":"%s","output":"%s","name":"%s","hook":"%s"}\n' "$FILE" "$folder" "$name" "$used_hook"
  exit 0
fi

# Long form: one recording into several reels. Claude picks the moments and writes each hook, so there is no
# two-pass hook step; each clip lands in "<date> Clips <n>/" with its cover, caption and the words to check.
if [ "$MODE" = long ]; then
  # shellcheck disable=SC2086
  if ! reel clips "$FILE" --out "$work" --title "$name" --count "${REEL_WATCH_CLIPS:-5}" ${flags[@]+"${flags[@]}"} $EXTRA_ARGS >> "$log" 2>&1; then
    echo "$(date '+%F %T') FAIL  $base clips (see above)" >> "$log"
    notify "Clips failed" "$base. Rename it to retry; details in ~/Reels/watch.log"
    printf '{"ok":false,"input":"%s","name":"%s","log":"%s"}\n' "$FILE" "$name" "$log"
    exit 1
  fi
  mkdir -p "$DONE"
  folder="$(create_reel_folder "$DONE" "$REELS/videos" Clips)"
  label="$(basename "$folder")"
  made=0
  while IFS=$'\t' read -r k out hooktxt score range why edges; do
    [ -f "$out" ] || continue
    pretty=$(printf '%s' "$hooktxt" | sed -E 's/\*//g; s/[?!]+ */ - /g; s#[/:"*<>|\\]##g; s/ +/ /g; s/^ +| +$//g; s/ -$//; s/\.+$//')
    cp "$out" "$folder/Clip $k - ${pretty:-clip}.mp4"
    reel_meta "$(dirname "$(dirname "$out")")" "$folder/.Clip $k.reel.json"
    cdir="$(dirname "$(dirname "$out")")"
    [ -f "$cdir/covers/Cover.png" ] && cp -f "$cdir/covers/Cover.png" "$folder/Clip $k - Cover.png"
    [ -s "$cdir/review.txt" ] && cp -f "$cdir/review.txt" "$folder/Clip $k - check these words.txt"
    [ -s "$cdir/music.txt" ] && cp -f "$cdir/music.txt" "$folder/Clip $k - music.txt"
    printf 'Clip %s  (%s, score %s)\n  %s\n  %s\n  %s\n\n' "$k" "$range" "$score" "$hooktxt" "$why" "${edges:-}" >> "$folder/clips.txt"
    if [ "${REEL_WATCH_CAPTION:-1}" != 0 ] && command -v claude >/dev/null 2>&1; then
      node "$HERE/write-caption.mjs" "$cdir" "$folder/Clip $k - caption.txt" >> "$log" 2>&1 || true
    fi
    made=$((made + 1))
  done < <(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const f=(s)=>Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");(j.clips||[]).forEach((c,i)=>{if(c.output)console.log([i+1,c.output,(c.hook||"").replace(/\t/g," "),c.score,f(c.start)+"-"+f(c.end),(c.why||"").replace(/\t|\n/g," "),c.problems?(c.problems.length?"Edges: "+c.problems.map((p)=>p.message).join("; "):"Edges: clean start and finish"):""].join("\t"))})' "$work/clips.json" 2>/dev/null || true)
  echo "$(date '+%F %T') done  $folder ($made clips)" >> "$log"
  notify "$label ready" "$made clip$([ "$made" = 1 ] || echo s) from $base"
  printf '{"ok":true,"input":"%s","output":"%s","name":"%s","clips":%s}\n' "$FILE" "$folder" "$name" "$made"
  exit 0
fi

# No written hook in the file name: a first pass (no render) gets the transcript, the cards and the stills, then
# the post copy writes three hooks, strongest first, and the finished reel is edited with that one on screen.
# The opening words are never the hook. Carousels have no on-screen hook.
written_hook=""
if [ -z "$hook" ] && [ "$MODE" != carousel ] && [ "${REEL_WATCH_CAPTION:-1}" != 0 ] && command -v claude >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  if reel edit "$FILE" --out "$work" --title "$name" ${flags[@]+"${flags[@]}"} --no-render $EXTRA_ARGS >> "$log" 2>&1 \
     && node "$HERE/write-caption.mjs" "$work" "$work/caption.txt" >> "$log" 2>&1 && [ -s "$work/caption.txt" ]; then
    written_hook=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(j.bestIsWritten&&j.best)process.stdout.write(j.best)}catch(e){}' "$work/caption.json" 2>/dev/null || true)
    if [ -n "$written_hook" ]; then
      flags+=(--hook "$written_hook")
      hook="$written_hook"
      echo "$(date '+%F %T') hook  $base -> \"$written_hook\" (written, from the post copy)" >> "$log"
    fi
  fi
fi
run_start=$(( $(wc -l < "$log" 2>/dev/null || echo 0) + 1 ))
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
pretty=$(printf '%s' "$used_hook" | sed -E 's/[?!]+ */ - /g; s#[/:"*<>|\\]##g; s/ +/ /g; s/^ +| +$//g; s/ -$//; s/\.+$//')
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
  if [ "$MODE" = broll ] || [ "$MODE" = runway ]; then
    # The stills (or clips) this reel used, from its plan (one path per line).
    shots=$(node -e 'try{const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const b of p.broll||[])if(b.file)console.log(b.file)}catch(e){}' "$work/plan.json" 2>/dev/null || true)
    if [ "$MODE" = runway ]; then folder="$(create_reel_folder "$DONE" "$REELS/videos" Reel " with Runway")"; else folder="$(create_reel_folder "$DONE" "$REELS/videos" Reel " with B-roll")"; fi
  else
    folder="$(create_reel_folder "$DONE" "$REELS/videos" Reel)"
  fi
  label="$(basename "$folder")"
  dest="$folder/$title.mp4"
  cp "$work/renders/$name.mp4" "$dest"
  reel_meta "$work" "$folder/.reel.json"
  if [ -n "$shots" ]; then
    i=1
    while IFS= read -r still; do
      [ -f "$still" ] && cp "$still" "$folder/B-roll $i.${still##*.}" && i=$((i + 1))
    done <<< "$shots"
    [ -s "$work/runway usage.txt" ] && cp -f "$work/runway usage.txt" "$folder/runway usage.txt"
  elif [ "$MODE" = runway ]; then
    printf 'No b-roll this time: Runway made nothing for this clip (balance, cap or a failed generation; see ~/Reels/watch.log and run: reel usage).\n' > "$folder/No b-roll this time.txt"
  elif [ "$MODE" = broll ]; then
    # Say why, from the editor's own lines for this run, instead of guessing at Codex.
    if tail -n +"$run_start" "$log" 2>/dev/null | grep -q "b-roll: reel too short"; then
      printf 'No b-roll this time: the clip is under 8 seconds, too short for a still.\n' > "$folder/No b-roll this time.txt"
    elif tail -n +"$run_start" "$log" 2>/dev/null | grep -q "b-roll: no room after the hook"; then
      printf 'No b-roll this time: no room for a 2-second still between the hook and the end of this clip.\n' > "$folder/No b-roll this time.txt"
    elif tail -n +"$run_start" "$log" 2>/dev/null | grep -q "rate-limited"; then
      printf 'No b-roll this time: Codex is rate-limited on the ChatGPT plan, so this reel came out without it.\nRename the clip in Raw - Reel with B-roll (any new name) and drop it again in 20 minutes.\n' > "$folder/No b-roll this time.txt"
    else
      printf 'No b-roll this time: Codex gave nothing usable for this clip (see ~/Reels/watch.log).\nRename the clip in Raw - Reel with B-roll (any new name) and drop it again to retry.\n' > "$folder/No b-roll this time.txt"
    fi
  fi
  [ -s "$work/review.txt" ] && cp -f "$work/review.txt" "$folder/check these words.txt"
  # Preflight: the editor's own checks on the finished file (sound, the open, dead air, layout). Only a report
  # with something in it reaches the folder.
  pf_note=""
  if [ -s "$work/preflight.txt" ] && ! head -1 "$work/preflight.txt" | grep -q "Preflight: OK"; then
    cp -f "$work/preflight.txt" "$folder/check this reel.txt"
    pf_note=" Preflight flagged something, see the note."
  fi
  # Cover: the reel's first frame (Cover.png); the designed set only when the preset asks for it.
  for c in "$work"/covers/Cover*.png; do [ -f "$c" ] && cp -f "$c" "$folder/$(basename "$c")"; done
  [ -s "$work/music.txt" ] && cp -f "$work/music.txt" "$folder/music.txt"
  echo "$(date '+%F %T') done  $dest" >> "$log"
  if [ -s "$work/review.txt" ]; then notify "$label ready: check a few words" "$title. See the note in its folder.$pf_note"; else notify "$label ready" "$title.$pf_note"; fi
fi

# Post copy (caption, hashtags, the hook options) from Sandcastles via headless Claude. Written in the first pass
# when the hook came from it; otherwise written now. Never holds up the delivery.
if [ "${REEL_WATCH_CAPTION:-1}" != 0 ] && command -v claude >/dev/null 2>&1; then
  if [ -n "$written_hook" ] && [ -s "$work/caption.txt" ]; then
    cp -f "$work/caption.txt" "$folder/caption.txt"
  elif node "$HERE/write-caption.mjs" "$work" "$folder/caption.txt" >> "$log" 2>&1 && [ -s "$folder/caption.txt" ]; then
    notify "$label caption ready" "$title"
  fi
fi
printf '{"ok":true,"input":"%s","output":"%s","name":"%s","hook":"%s"}\n' "$FILE" "$dest" "$name" "$hook"
