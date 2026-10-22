#!/bin/bash
# Reel Editor installer for macOS (Apple Silicon).
#
#   curl -fsSL https://raw.githubusercontent.com/gpingelbiz/Ai/main/reel-editor/install.sh | bash
#
# Asks four questions (look, ElevenLabs key, drop folder, Codex for b-roll and carousels), installs everything,
# proves it with a test reel.
# Safe to run again: it updates the code and keeps your settings.
#
# Options (for re-runs and automation):
#   --yes            take the defaults, ask nothing (Greg's look unless --look is given; no key; drop folder on)
#   --look greg|clean|custom   --accent "#hex" --text "#hex" (custom colors)
#   --no-watch       do not turn on the drop folder
#   --no-link        do not link the `reel` command globally (testing)
#   --dir <path>     where the code goes (default ~/Ai)
set -euo pipefail

# Everything runs inside main(), so bash has read the whole script before anything starts. Under `curl | bash`
# the script is bash's stdin, and a child process that reads stdin (ffmpeg does) would otherwise eat the rest of it.
main() {

REPO="https://github.com/gpingelbiz/Ai.git"
DIR="$HOME/Ai"
VENV="$HOME/.reel-venv"
CONF="$HOME/.reel"
ZSHRC="$HOME/.zshrc"
YES=0; LINK=1; WATCH=""; LOOK=""; ACCENT=""; TEXTC=""

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --no-link) LINK=0 ;;
    --no-watch) WATCH=n ;;
    --watch) WATCH=y ;;
    --look) LOOK="$2"; shift ;;
    --accent) ACCENT="$2"; shift ;;
    --text) TEXTC="$2"; shift ;;
    --dir) DIR="$2"; shift ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
  shift
done

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
# Questions come from the keyboard even when this script arrives through `curl | bash`.
ask() { # ask "Question" default -> REPLY
  if [ "$YES" = 1 ] || [ ! -r /dev/tty ]; then REPLY="$2"; return; fi
  printf '%s ' "$1" > /dev/tty
  read -r REPLY < /dev/tty || REPLY=""
  [ -n "$REPLY" ] || REPLY="$2"
}
ask_secret() {
  if [ "$YES" = 1 ] || [ ! -r /dev/tty ]; then REPLY=""; return; fi
  printf '%s ' "$1" > /dev/tty
  read -rs REPLY < /dev/tty || REPLY=""
  printf '\n' > /dev/tty
}

bold "Reel Editor installer"
[ "$(uname -s)" = Darwin ] || die "This installer is for macOS."
[ "$(uname -m)" = arm64 ] || note "This Mac is not Apple Silicon. It will work, but renders are much slower."

# ---------------------------------------------------------------- 1. Apple tools
bold "1/7  Apple command line tools"
if xcode-select -p >/dev/null 2>&1 && command -v swiftc >/dev/null 2>&1; then
  ok "installed"
else
  xcode-select --install >/dev/null 2>&1 || true
  die "An Apple installer window just opened. Click Install, wait for it to finish, then run this command again."
fi

# ---------------------------------------------------------------- 2. Homebrew + tools
bold "2/7  Homebrew, ffmpeg, Node, Python"
if ! command -v brew >/dev/null 2>&1; then
  [ -x /opt/homebrew/bin/brew ] || { note "Installing Homebrew (it will ask for your Mac password)…"; /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" < /dev/tty; }
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
fi
# Only install what is missing, judged by the command itself: `brew list python` misses python@3.14, and
# installing a second Python re-points python3 for every script on the Mac. No Homebrew auto-update either.
export HOMEBREW_NO_AUTO_UPDATE=1
for pair in ffmpeg:ffmpeg node:node python3:python git:git; do
  cmd="${pair%%:*}"; formula="${pair#*:}"
  if command -v "$cmd" >/dev/null 2>&1; then ok "$cmd (already installed)"; else note "installing $formula…"; brew install "$formula" >/dev/null; ok "$cmd"; fi
done
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "python3 is older than 3.10. Install a newer one (brew install python), then run this again."
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 22 ] || die "Node $(node -v) is too old; Reel Editor needs 22 or newer. Run: brew upgrade node"

# ---------------------------------------------------------------- 3. Code
bold "3/7  Reel Editor code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only -q && ok "updated $DIR"
else
  git clone -q "$REPO" "$DIR" && ok "downloaded to $DIR"
fi
APP="$DIR/reel-editor"
( cd "$APP" && npm install --silent --no-audit --no-fund >/dev/null ) && ok "packages installed"
if [ "$LINK" = 1 ]; then ( cd "$APP" && npm link --silent >/dev/null 2>&1 ) && ok "the reel command is ready"; fi

# ---------------------------------------------------------------- 4. Whisper + render browser
bold "4/7  Whisper and the render browser"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
# av<17: PyAV 19 removed an argument faster-whisper 1.2.1 passes ("unexpected keyword argument metadata_errors").
"$VENV/bin/pip" install -q --disable-pip-version-check --upgrade faster-whisper "av<17" && ok "Whisper (faster-whisper) installed"
( cd "$APP" && npx --yes hyperframes browser ensure >/dev/null 2>&1 ) && ok "render browser ready"

# ---------------------------------------------------------------- 5. Your look and words
bold "5/7  Your look"
mkdir -p "$CONF"
if [ -z "$LOOK" ]; then
  note "1) Greg Pingel's brand (black and gold)"
  note "2) Plain white captions, no styling"
  note "3) My own colors"
  ask "Pick 1, 2 or 3 [1]:" 1
  case "$REPLY" in 2) LOOK=clean ;; 3) LOOK=custom ;; *) LOOK=greg ;; esac
fi
DICT=""; VOICE=""
case "$LOOK" in
  greg) PRESET=pingel-brand ;;
  clean) PRESET=clean ;;
  custom)
    [ -n "$ACCENT" ] || { ask "Highlight color, as a hex code [#F5C518]:" "#F5C518"; ACCENT="$REPLY"; }
    [ -n "$TEXTC" ] || { ask "Caption text color [#FFFFFF]:" "#FFFFFF"; TEXTC="$REPLY"; }
    PRESET="$CONF/my-brand.json"
    node -e 'const fs=require("fs");const [src,out,a,t]=process.argv.slice(1);const p=JSON.parse(fs.readFileSync(src,"utf8"));p.name="my-brand";p.colors={...(p.colors||{}),accent:a,text:t};fs.writeFileSync(out,JSON.stringify(p,null,2)+"\n")' \
      "$APP/presets/pingel-brand.json" "$PRESET" "$ACCENT" "$TEXTC"
    ;;
  *) die "unknown look: $LOOK (greg, clean or custom)" ;;
esac
if [ "$LOOK" != greg ]; then
  # A starter word list of your own (Greg's framework names stay out of your captions).
  DICT="$CONF/dictionary.json"
  [ -f "$DICT" ] || node -e 'const fs=require("fs");const [src,out]=process.argv.slice(1);const d=JSON.parse(fs.readFileSync(src,"utf8"));fs.writeFileSync(out,JSON.stringify({terms:[],phrases:[],corrections:[],powerWords:d.powerWords||[]},null,2)+"\n")' "$APP/dictionary.json" "$DICT"
  ok "your word list: $DICT (add your program and framework names to \"terms\")"
  VOICE="$CONF/voice.md"
  [ -f "$VOICE" ] || cp "$APP/voice/default.md" "$VOICE"
  ok "your caption voice: $VOICE (how you talk, words you never use)"
fi
ok "look: $LOOK"

# ---------------------------------------------------------------- 6. Settings
bold "6/7  ElevenLabs and settings"
KEY=""
if grep -q '^export ELEVENLABS_API_KEY=' "$ZSHRC" 2>/dev/null; then
  ok "ElevenLabs key already set (kept)"
else
  note "ElevenLabs Scribe is the most accurate transcription (key from elevenlabs.io, Developers, API Keys)."
  ask_secret "Paste your ElevenLabs API key, or press Return to skip:"
  KEY="$REPLY"
fi
[ -n "$WATCH" ] || { ask "Turn on the drop folder (drop a clip, get a reel)? [Y/n]:" y; case "$REPLY" in n*|N*) WATCH=n ;; *) WATCH=y ;; esac; }

# Codex makes the b-roll stills and carousels, on the person's own ChatGPT plan. Optional: without it, reels
# come with no b-roll and no carousel.
if command -v codex >/dev/null 2>&1; then
  if codex login status >/dev/null 2>&1; then ok "Codex signed in: b-roll and carousels on"
  else note "Codex is installed but not signed in. Run  codex login  once to turn on b-roll and carousels."; fi
else
  ask "Make b-roll and carousels with Codex (needs a ChatGPT account)? [Y/n]:" y
  case "$REPLY" in
    n*|N*) note "Codex skipped: reels come without b-roll and carousels" ;;
    *)
      if npm install -g @openai/codex --silent --no-audit --no-fund >/dev/null 2>&1; then ok "Codex installed"
      else note "Codex did not install; reels come without b-roll and carousels"; fi
      if command -v codex >/dev/null 2>&1 && [ "$YES" != 1 ] && [ -r /dev/tty ]; then
        note "Sign in with your ChatGPT account in the browser window that opens."
        codex login < /dev/tty > /dev/tty 2>&1 || note "Sign-in skipped. Run  codex login  later to turn on b-roll and carousels."
      fi ;;
  esac
fi

touch "$ZSHRC"
# Keep a call-to-action someone set by hand; a re-run must not wipe it.
CTA_LINE="$(grep '^export REEL_WATCH_CTA=' "$ZSHRC" 2>/dev/null | tail -1 || true)"
[ -n "$CTA_LINE" ] || CTA_LINE='export REEL_WATCH_CTA=""   # call-to-action for drop-folder reels, e.g. "Comment WORD"'
# Replace our block (and loose reel lines from older setups); leave everything else in ~/.zshrc alone.
tmp="$(mktemp)"
awk '/^# >>> reel-editor >>>/{skip=1} !skip && !/^export (REEL_[A-Z_]+|PRODUCER_BROWSER_GPU_MODE)=/{print} /^# <<< reel-editor <<</{skip=0}' "$ZSHRC" > "$tmp"
{
  echo "# >>> reel-editor >>>"
  echo "export REEL_PYTHON=\"$VENV/bin/python\""
  echo "export PRODUCER_BROWSER_GPU_MODE=hardware"
  echo "export REEL_PRESET=\"$PRESET\""
  [ -z "$DICT" ] || echo "export REEL_DICTIONARY=\"$DICT\""
  echo "$CTA_LINE"
  [ -z "$VOICE" ] || echo "export REEL_CAPTION_VOICE=\"$VOICE\""
  if [ "$WATCH" = y ]; then
    echo "export REEL_WATCH_RAW=\"$HOME/Reels/raw\""
    echo "export REEL_WATCH_DONE=\"$HOME/Desktop/Reels\""
  fi
  [ -z "$KEY" ] || echo "export ELEVENLABS_API_KEY=\"$KEY\""
  echo "# <<< reel-editor <<<"
} >> "$tmp"
cat "$tmp" > "$ZSHRC" && rm -f "$tmp"
ok "settings saved in ~/.zshrc"
export REEL_PYTHON="$VENV/bin/python" PRODUCER_BROWSER_GPU_MODE=hardware REEL_PRESET="$PRESET" REEL_WATCH_CTA=""
[ -z "$DICT" ] || export REEL_DICTIONARY="$DICT"
[ -z "$KEY" ] || export ELEVENLABS_API_KEY="$KEY"

if [ "$WATCH" = y ]; then
  mkdir -p "$HOME/Reels/raw" "$HOME/Reels/raw-broll" "$HOME/Reels/raw-carousel" "$HOME/Reels/raw-long" "$HOME/Reels/raw-youtube" "$HOME/Reels/raw-runway" "$HOME/Reels/music" "$HOME/Desktop/Reels"
  # macOS blocks background jobs from reading the Desktop, so the real drop folders live in ~/Reels and the
  # Desktop gets shortcuts. An older single "Raw" shortcut becomes "Raw - Reel".
  D="$HOME/Desktop/Reels"
  if [ -L "$D/Raw" ] && [ ! -e "$D/Raw - Reel" ]; then mv "$D/Raw" "$D/Raw - Reel"; fi
  [ -e "$D/Raw - Reel" ] || ln -s "$HOME/Reels/raw" "$D/Raw - Reel"
  [ -e "$D/Raw - Reel with B-roll" ] || ln -s "$HOME/Reels/raw-broll" "$D/Raw - Reel with B-roll"
  [ -e "$D/Raw - Carousel" ] || ln -s "$HOME/Reels/raw-carousel" "$D/Raw - Carousel"
  [ -e "$D/Raw - Clips from Long Video" ] || ln -s "$HOME/Reels/raw-long" "$D/Raw - Clips from Long Video"
  [ -e "$D/Raw - Full YouTube Edit" ] || ln -s "$HOME/Reels/raw-youtube" "$D/Raw - Full YouTube Edit"
  [ -e "$D/Raw - Reel with Runway B-roll" ] || ln -s "$HOME/Reels/raw-runway" "$D/Raw - Reel with Runway B-roll"
  [ -e "$D/Music" ] || ln -s "$HOME/Reels/music" "$D/Music"
  [ -e "$HOME/Reels/music/Put music here.txt" ] || printf 'Drop licensed music files here (mp3, m4a or wav), for example Epidemic Sound downloads.\nEvery reel gets one at random, low under your voice. Name a clip "...#music:calm.mov" to use the track whose name has "calm", or "...#nomusic.mov" for none.\n' > "$HOME/Reels/music/Put music here.txt"
  REEL_WATCH_RAW="$HOME/Reels/raw" REEL_WATCH_DONE="$D" "$APP/scripts/install-watcher.sh" >/dev/null
  ok "drop folders on in Desktop/Reels: Raw - Reel, Raw - Reel with B-roll, Raw - Carousel, Raw - Clips from Long Video, Raw - Full YouTube Edit (music from Desktop/Reels/Music)"
fi

# ---------------------------------------------------------------- 7. Prove it
bold "7/7  Test reel"
( cd "$APP" && node bin/reel.mjs doctor 2>/dev/null | sed -n '1,8p' | sed 's/^/  /' )
TEST="$HOME/Reels/install-test"
mkdir -p "$TEST"
ffmpeg -nostdin -y -loglevel error -f lavfi -i "testsrc2=size=1080x1920:rate=30" -f lavfi -i "sine=frequency=440" -t 24 -pix_fmt yuv420p -shortest "$TEST/test.mov"
out=$(cd "$TEST" && node "$APP/bin/reel.mjs" edit test.mov --out "$TEST/videos/test" --transcript "$APP/examples/sample-words.json" --hook "It *works*" 2>&1 | tail -1)
[ -f "$out" ] || die "The test reel did not render. Run: cd $APP && node bin/reel.mjs doctor"
ok "test reel: $out"
[ "$YES" = 1 ] || open "$out" 2>/dev/null || true

bold "Done."
note "Open a new Terminal window, then:  reel edit my-clip.mov --hook \"Your *hook* here\""
[ "$WATCH" != y ] || note "Or drop a clip into one of the Raw folders in Desktop/Reels and wait for the notification."
note "Run this installer again any time to update."
}

main "$@" < /dev/null
