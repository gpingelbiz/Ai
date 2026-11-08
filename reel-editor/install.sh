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
#   --brand <folder> a brand kit's Brand folder (scripts/brand-kit.mjs): their look, fonts, words, voice; no look question
#   --release <file> install the tested release from a kit (no password or developer tools)
#   --studio         also set up the Content Studio (needs --brand from a Content Studio kit): photo folder, Claude sign-in,
#                    the client's Metricool brand, how images reach Metricool, posting times, the daily job
#   --no-routine     skip Claude desktop routine setup (testing)
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
YES=0; LINK=1; WATCH=""; LOOK=""; ACCENT=""; TEXTC=""; BRAND=""; STUDIO=0; NO_ROUTINE=0; RELEASE=""; RUNTIME=""; RELEASE_ID=dev
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --no-link) LINK=0 ;;
    --no-watch) WATCH=n ;;
    --watch) WATCH=y ;;
    --look) LOOK="$2"; shift ;;
    --accent) ACCENT="$2"; shift ;;
    --text) TEXTC="$2"; shift ;;
    --brand) BRAND="$2"; LOOK=brand; shift ;;
    --release) RELEASE="$2"; shift ;;
    --studio) STUDIO=1 ;;
    --no-routine) NO_ROUTINE=1 ;;
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
if [ -n "$RELEASE" ]; then
  [ "$(uname -m)" = arm64 ] || die "Intel Macs are not supported yet. Use an Apple Silicon Mac."
  MACOS="$(sw_vers -productVersion)"
  [ "${MACOS%%.*}" -ge 14 ] || die "Reel Editor needs macOS 14 or newer. Update macOS, then run this installer again."
  [ -f "$RELEASE" ] || die "The kit's release.json is missing. Unzip the whole kit, then try again."
  [ -f "$HERE/scripts/bootstrap-runtime.sh" ] && [ -f "$HERE/scripts/runtime.mjs" ] || die "The kit's setup files are missing. Unzip the whole kit, then try again."
  mkdir -p "$CONF" "$HOME/.local/share/reel-editor/tmp"
  chmod 700 "$CONF"
  touch "$CONF/install.log"; chmod 600 "$CONF/install.log"
  trap 'echo "The install stopped. See ~/.reel/install.log, then run this installer again." >&2' ERR
  RELEASE_ID="$(plutil -extract id raw -o - "$RELEASE")"
  RUNTIME_ID="$(plutil -extract runtime.id raw -o - "$RELEASE")"
  case "$RUNTIME_ID" in ''|*[!a-zA-Z0-9._-]*|.|..) die "The tools list is not valid." ;; esac
  RUNTIME="$HOME/.local/share/reel-editor/runtime/$RUNTIME_ID"
  note "Downloading tools (about 200 MB)"
  bash "$HERE/scripts/bootstrap-runtime.sh" "$RELEASE"
  export PATH="$RUNTIME/bin:$HOME/.local/bin:$PATH"
  RUNTIME_HELPER="$HERE/scripts/runtime.mjs"
  # The verified app carries the hashed speech package list; unpack it before preparing speech.
  note "Getting the tested editor ready"
  node "$RUNTIME_HELPER" app "$RELEASE"
  APP="$HOME/.local/share/reel-editor/releases/$RELEASE_ID"
  note "Getting speech recognition ready (about 1.6 GB, once)"
  node "$RUNTIME_HELPER" speech "$RELEASE"
  VENV="$RUNTIME/venv"
  note "Getting the render browser ready"
  node "$RUNTIME_HELPER" browser "$RELEASE"
  node "$RUNTIME_HELPER" switch "$RELEASE"
  if [ "$LINK" = 1 ]; then
    mkdir -p "$HOME/.local/bin"
    cat > "$HOME/.local/bin/.reel-install.tmp" <<'LAUNCHER'
#!/bin/sh
[ -f "$HOME/.reel/env.sh" ] && . "$HOME/.reel/env.sh"
exec "$REEL_RUNTIME/bin/node" "$HOME/.local/share/reel-editor/current/bin/reel.mjs" "$@"
LAUNCHER
    chmod 755 "$HOME/.local/bin/.reel-install.tmp"
    mv -f "$HOME/.local/bin/.reel-install.tmp" "$HOME/.local/bin/reel"
  fi
  # Always enter through current so background jobs survive the next release switch.
  APP="$HOME/Ai/reel-editor"
  [ -n "$LOOK" ] || LOOK=clean
else
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
py_ok() { "$1" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 14) else 1)' >/dev/null 2>&1; }
NEED_BREW=0
for cmd in node ffmpeg ffprobe git; do command -v "$cmd" >/dev/null 2>&1 || NEED_BREW=1; done
PY="$(command -v python3 || true)"
if [ -z "$PY" ] || ! py_ok "$PY"; then NEED_BREW=1; fi
if [ "$NEED_BREW" = 1 ] && ! command -v brew >/dev/null 2>&1; then
  [ -x /opt/homebrew/bin/brew ] || { note "Installing Homebrew (it will ask for your Mac password)…"; /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" < /dev/tty; }
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
fi
# Only install what is missing, judged by the command itself: `brew list python` misses python@3.14, and
# installing a second Python re-points python3 for every script on the Mac. No Homebrew auto-update either.
export HOMEBREW_NO_AUTO_UPDATE=1
for pair in ffmpeg:ffmpeg ffprobe:ffmpeg node:node git:git; do
  cmd="${pair%%:*}"; formula="${pair#*:}"
  if command -v "$cmd" >/dev/null 2>&1; then ok "$cmd (already installed)"; else note "installing ${formula}…"; brew install "$formula" >/dev/null; ok "$cmd"; fi
done
# Python is judged by its version, not its presence: every Mac with the Apple tools has /usr/bin/python3, and on
# macOS 15 and 26 that is 3.9, too old. Then Homebrew's Python is installed and used by full path for the venv,
# so nothing else on the Mac is re-pointed. (2026-10-30: a fresh Mac stopped here before this.)
# Too new fails as well: Whisper's PyAV has no ready-made build for a Python newer than 3.14, and building it from
# source stops with "pkg-config is required" (2026-11-04: Homebrew's newest Python on a client's Mac).
py_ok() { "$1" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 14) else 1)' >/dev/null 2>&1; }
PY="$(command -v python3 || true)"
if [ -n "$PY" ] && py_ok "$PY"; then ok "python3 (already installed)"
else
  # A versioned Homebrew Python, used by full path, so python3 stays what it was for everything else on the Mac.
  BREW_PY="$(brew --prefix 2>/dev/null)/opt/python@3.13/bin/python3.13"
  if ! py_ok "$BREW_PY"; then note "installing python 3.13 (this Mac's python3 will not run Whisper)…"; brew install python@3.13 >/dev/null; fi
  PY="$BREW_PY"
  py_ok "$PY" && ok "python3 ($("$PY" -V 2>&1))" || die "No Python between 3.10 and 3.14. Run: brew install python@3.13, then run this again."
fi
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 22 ] || die "Node $(node -v) is too old; Reel Editor needs 22 or newer. Run: brew upgrade node"

# ---------------------------------------------------------------- 3. Code
bold "3/7  Reel Editor code"
if [ -e "$DIR/.git" ]; then
  # A client kit must never pull over edits in its code folder.
  if [ -n "$BRAND" ] && [ -n "$(git -C "$DIR" status --porcelain --untracked-files=all)" ]; then
    die "Your code folder has uncommitted changes. Keep or commit them before re-running the installer. Nothing was updated."
  fi
  git -C "$DIR" pull --ff-only -q || die "The code update stopped. Read the message above, then run this installer again."
  ok "updated $DIR"
else
  git clone -q "$REPO" "$DIR" || die "The code download stopped. Read the message above, then run this installer again."
  ok "downloaded to $DIR"
fi
APP="$DIR/reel-editor"
( cd "$APP" && npm install --silent --no-audit --no-fund ) || die "The editor packages did not install. Read the message above."
ok "packages installed"
if [ "$LINK" = 1 ]; then
  ( cd "$APP" && npm link --silent ) || die "The reel command could not be linked. Read the message above."
  ok "the reel command is ready"
fi

# ---------------------------------------------------------------- 4. Whisper + render browser
bold "4/7  Whisper and the render browser"
# A venv from an earlier run on a Python that cannot run Whisper is rebuilt; nothing but Whisper lives in it.
if [ -x "$VENV/bin/python" ] && ! py_ok "$VENV/bin/python"; then rm -rf "$VENV"; fi
[ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
# av<17: PyAV 19 removed an argument faster-whisper 1.2.1 passes ("unexpected keyword argument metadata_errors").
"$VENV/bin/pip" install -q --disable-pip-version-check --only-binary=av --upgrade faster-whisper "av<17" || die "Whisper did not install. Read the message above, then run this again."
ok "Whisper (faster-whisper) installed"
( cd "$APP" && npx --yes hyperframes browser ensure ) || die "The render browser did not install. Read the message above."
ok "render browser ready"
# Studio sound: the DeepFilterNet denoiser is one binary from its official GitHub release (no Python). Optional:
# without it the spectral denoiser runs and the log says so.
if [ -x "$HOME/.cache/reel-editor/bin/deep-filter" ]; then ok "studio sound denoiser present"
elif bash "$APP/scripts/install-deepfilter.sh" >/dev/null 2>&1; then ok "studio sound denoiser installed (DeepFilterNet)"
else note "DeepFilterNet could not be fetched; reels use the built-in denoiser. Later: $APP/scripts/install-deepfilter.sh"; fi

fi # legacy tools and code
RUNTIME_HELPER="${RUNTIME_HELPER:-$APP/scripts/runtime.mjs}"

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
DICT=""; VOICE=""; YTPRESET=""
case "$LOOK" in
  brand)
    # A brand kit (scripts/brand-kit.mjs): their look, YouTube look, fonts, words and voice, ready made.
    [ -f "$BRAND/my-brand.json" ] || die "No brand in $BRAND (my-brand.json is missing)."
    mkdir -p "$CONF/fonts"
    # Their own edits win; an untouched copy (same as the last kit's) takes the new kit's look and b-roll settings.
    if [ -f "$CONF/my-brand.json" ] && ! cmp -s "$CONF/my-brand.json" "$BRAND/my-brand.json" && { [ ! -f "$CONF/.kit-my-brand.json" ] || ! cmp -s "$CONF/my-brand.json" "$CONF/.kit-my-brand.json"; }; then
      cp -f "$BRAND/my-brand.json" "$CONF/my-brand.kit-new.json"
      note "kept your edited ~/.reel/my-brand.json; this kit's version is next to it as my-brand.kit-new.json"
    else
      cp -f "$BRAND/my-brand.json" "$CONF/my-brand.json"
    fi
    cp -f "$BRAND/my-brand.json" "$CONF/.kit-my-brand.json"
    for name in my-youtube.json brand.json; do
      if [ -f "$BRAND/$name" ]; then
        if [ -f "$CONF/$name" ] && ! cmp -s "$CONF/$name" "$BRAND/$name" && { [ ! -f "$CONF/.kit-$name" ] || ! cmp -s "$CONF/$name" "$CONF/.kit-$name"; }; then
          cp -f "$BRAND/$name" "$CONF/${name%.json}.kit-new.json"
          note "kept your edited $name; this kit's version is next to it"
        else cp -f "$BRAND/$name" "$CONF/$name"; fi
        cp -f "$BRAND/$name" "$CONF/.kit-$name"
      fi
    done
    [ ! -f "$CONF/my-youtube.json" ] || YTPRESET="$CONF/my-youtube.json"
    for f in "$BRAND"/fonts/*; do [ -f "$f" ] && cp -f "$f" "$CONF/fonts/"; done
    # Their word list and voice are theirs to edit: a re-run keeps the edited copies.
    [ -f "$CONF/dictionary.json" ] || cp "$BRAND/dictionary.json" "$CONF/dictionary.json"
    [ -f "$CONF/voice.md" ] || cp "$BRAND/voice.md" "$CONF/voice.md"
    PRESET="$CONF/my-brand.json"; DICT="$CONF/dictionary.json"; VOICE="$CONF/voice.md"
    ok "your brand: colors, fonts, words and caption voice from the kit (in $CONF)"
    ;;
  greg) PRESET=pingel-brand ;;
  clean) PRESET=clean ;;
  custom)
    [ -n "$ACCENT" ] || { ask "Highlight color, as a hex code [#F5C518]:" "#F5C518"; ACCENT="$REPLY"; }
    [ -n "$TEXTC" ] || { ask "Caption text color [#FFFFFF]:" "#FFFFFF"; TEXTC="$REPLY"; }
    PRESET="$CONF/my-brand.json"
    # Greg's full look with your two colors; his b-roll world, @handle and carousel style are cleared.
    node -e 'const fs=require("fs");const [out,a,t]=process.argv.slice(1);const p={name:"my-brand",extends:"pingel-brand",colors:{text:t,accent:a,stroke:"#000000",bg:"#0B0B0D"},broll:{world:"",style:""},carousel:{handle:"",style:""},lowerThird:{name:"",handle:""}};fs.writeFileSync(out,JSON.stringify(p,null,2)+"\n")' \
      "$PRESET" "$ACCENT" "$TEXTC"
    ;;
  *) die "unknown look: $LOOK (greg, clean or custom)" ;;
esac
if [ "$LOOK" != greg ] && [ "$LOOK" != brand ]; then
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
bold "6/7  Keys and settings"
node "$RUNTIME_HELPER" migrate-keys
KEY=""
if grep -q '^ELEVENLABS_API_KEY=' "$CONF/keys.env" 2>/dev/null; then
  ok "ElevenLabs key already set (kept)"
else
  note "ElevenLabs Scribe is the most accurate transcription (key from elevenlabs.io, Developers, API Keys)."
  ask_secret "Paste your ElevenLabs API key, or press Return to skip:"
  KEY="$REPLY"
fi
RWKEY=""
if grep -q '^RUNWAY_API_KEY=' "$CONF/keys.env" 2>/dev/null; then
  ok "Runway key already set (kept)"
else
  note "Runway makes short video b-roll for Raw - Reel with Runway B-roll, about 30 cents a clip (key and credits at dev.runwayml.com)."
  ask_secret "Paste your Runway API key, or press Return to skip:"
  RWKEY="$REPLY"
fi
PBKEY=""
if grep -q '^PIXABAY_API_KEY=' "$CONF/keys.env" 2>/dev/null; then
  ok "Pixabay key already set (kept)"
else
  note "Pixabay adds free stock video for Raw - Reel with B-roll."
  note "Use your own key: make a free account at https://pixabay.com/api/docs/; your key is shown on that page once logged in."
  ask_secret "Paste your Pixabay API key, or press Return to skip:"
  PBKEY="$REPLY"
fi
PXKEY=""
if grep -q '^PEXELS_API_KEY=' "$CONF/keys.env" 2>/dev/null; then
  ok "Pexels key already set (kept)"
else
  note "Pexels adds free stock video for Raw - Reel with B-roll."
  note "Use your own key from https://www.pexels.com/api/ (free; new sign-ups may be paused)."
  ask_secret "Paste your Pexels API key, or press Return to skip:"
  PXKEY="$REPLY"
fi
[ -n "$WATCH" ] || { ask "Turn on the drop folder (drop a clip, get a reel)? [Y/n]:" y; case "$REPLY" in n*|N*) WATCH=n ;; *) WATCH=y ;; esac; }

if [ -z "$RELEASE" ]; then
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

# Claude Code writes the graphic cards, the captions and the hook ideas, on the person's own Claude plan. Optional:
# without it, reels come without cards and captions. A Content Studio kit installs and signs it in later (step 2 of
# its setup), so it is not asked twice.
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CLAUDE_BIN" ] && [ -x "$HOME/.local/bin/claude" ]; then CLAUDE_BIN="$HOME/.local/bin/claude"; fi
claude_ok() { [ -n "$CLAUDE_BIN" ] && perl -e 'alarm 120; exec @ARGV' "$CLAUDE_BIN" -p "Reply with the word OK and nothing else." --tools "" --strict-mcp-config --output-format text 2>/dev/null | grep -q OK; }
if [ "$STUDIO" != 1 ]; then
  if [ -z "$CLAUDE_BIN" ]; then
    ask "Add Claude for graphic cards, captions and hook ideas (needs a Claude Pro or Max plan)? [Y/n]:" y
    case "$REPLY" in
      n*|N*) note "Claude skipped: reels come without cards, captions and hook ideas" ;;
      *) if curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1; then CLAUDE_BIN="$HOME/.local/bin/claude"; ok "Claude Code installed"
         else note "Claude Code did not install. Later: run  curl -fsSL https://claude.ai/install.sh | bash  in Terminal."; fi ;;
    esac
  fi
  if [ -n "$CLAUDE_BIN" ] && [ -x "$CLAUDE_BIN" ]; then
    if claude_ok; then ok "Claude signed in: cards, captions and hook ideas on"
    elif [ "$YES" != 1 ] && [ -r /dev/tty ]; then
      note "Sign in with YOUR Claude account (Pro or Max). Claude opens here: follow the sign-in, then type /exit and press Return."
      "$CLAUDE_BIN" < /dev/tty > /dev/tty 2>&1 || true
      if claude_ok; then ok "Claude signed in: cards, captions and hook ideas on"; else note "Claude is not signed in yet. Later: type  claude  in Terminal and sign in."; fi
    else note "Claude is not signed in. Later: type  claude  in Terminal and sign in."; fi
  fi
fi

fi # optional account tools stay out of the pinned release install

for pair in ELEVENLABS_API_KEY:KEY RUNWAY_API_KEY:RWKEY PIXABAY_API_KEY:PBKEY PEXELS_API_KEY:PXKEY; do
  name="${pair%%:*}"; variable="${pair#*:}"; value="${!variable}"
  if [ -n "$value" ]; then printf '%s\n' "$value" | node "$RUNTIME_HELPER" save-key "$name"; fi
done
CLIENT=""
if [ -n "$BRAND" ]; then
  CLIENT="$(node -e 'const fs=require("fs"),p=require("path"); const dir=process.argv[1]; const name=JSON.parse(fs.readFileSync(p.join(dir,fs.existsSync(p.join(dir,"brand.json"))?"brand.json":"my-brand.json"),"utf8")).name; const slug=String(name||"client").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); console.log(slug||"client")' "$BRAND")"
fi
REEL_RUNTIME="$RUNTIME" REEL_RELEASE="$RELEASE_ID" REEL_PYTHON="$VENV/bin/python" \
REEL_PRESET="$PRESET" REEL_DICTIONARY="$DICT" REEL_CAPTION_VOICE="$VOICE" REEL_YOUTUBE_PRESET="$YTPRESET" \
REEL_WATCH_RAW="$HOME/Reels/raw" REEL_WATCH_DONE="$HOME/Desktop/Reels" \
REEL_CLIENT="$CLIENT" REEL_CLIENT_MODE="$(if [ -n "$BRAND" ]; then echo 1; fi)" \
node "$RUNTIME_HELPER" env
. "$CONF/env.sh"
ok "settings saved in ~/.reel/env.sh"
if [ -n "$RELEASE" ]; then node "$RUNTIME_HELPER" phase "$RELEASE" settings; fi

# The jungle-reel props group belongs only to the house shot list; clients get the general groups.
mkdir -p "$HOME/Desktop/Reels"
SHOTLIST_ARGS=()
[ "$LOOK" = greg ] || SHOTLIST_ARGS+=(--client)
node "$APP/bin/reel.mjs" broll-shotlist --html "$HOME/Desktop/Reels/B-roll shot list.html" ${SHOTLIST_ARGS[@]+"${SHOTLIST_ARGS[@]}"}

if [ "$WATCH" = y ]; then
  mkdir -p "$HOME/Reels/raw" "$HOME/Reels/raw-broll" "$HOME/Reels/raw-own-broll" "$HOME/Reels/raw-carousel" "$HOME/Reels/raw-long" "$HOME/Reels/raw-youtube" "$HOME/Reels/raw-runway" "$HOME/Reels/music" "$HOME/Desktop/Reels"
  # macOS blocks background jobs from reading the Desktop, so the real drop folders live in ~/Reels and the
  # Desktop gets shortcuts. An older single "Raw" shortcut becomes "Raw - Reel".
  D="$HOME/Desktop/Reels"
  if [ -L "$D/Raw" ] && [ ! -e "$D/Raw - Reel" ]; then mv "$D/Raw" "$D/Raw - Reel"; fi
  [ -e "$D/Raw - Reel" ] || ln -s "$HOME/Reels/raw" "$D/Raw - Reel"
  [ -e "$D/Raw - Reel with B-roll" ] || ln -s "$HOME/Reels/raw-broll" "$D/Raw - Reel with B-roll"
  [ -e "$D/Raw - My B-roll clips" ] || ln -s "$HOME/Reels/raw-own-broll" "$D/Raw - My B-roll clips"
  [ -e "$D/Raw - Carousel" ] || ln -s "$HOME/Reels/raw-carousel" "$D/Raw - Carousel"
  [ -e "$D/Raw - Clips from Long Video" ] || ln -s "$HOME/Reels/raw-long" "$D/Raw - Clips from Long Video"
  [ -e "$D/Raw - Full YouTube Edit" ] || ln -s "$HOME/Reels/raw-youtube" "$D/Raw - Full YouTube Edit"
  [ -e "$D/Raw - Reel with Runway B-roll" ] || ln -s "$HOME/Reels/raw-runway" "$D/Raw - Reel with Runway B-roll"
  [ -e "$D/Music" ] || ln -s "$HOME/Reels/music" "$D/Music"
  # Their music is their own: the folder gets a note and clickable links to where Greg's comes from (src/music-source.mjs).
  if [ -n "${RELEASE:-}" ]; then
    if ! node --input-type=module -e 'const [mod, dir] = process.argv.slice(1); import(mod).then((m) => m.setUpMusicFolder(dir))' "$APP/src/music-source.mjs" "$HOME/Reels/music" >> "$CONF/install.log" 2>&1; then
      note "The music folder is ready; its optional guide could not be written. Details: ~/.reel/install.log"
    fi
  else
    node --input-type=module -e 'const [mod, dir] = process.argv.slice(1); import(mod).then((m) => m.setUpMusicFolder(dir))' "$APP/src/music-source.mjs" "$HOME/Reels/music" >/dev/null 2>&1 || true
  fi
  REEL_WATCH_RAW="$HOME/Reels/raw" REEL_WATCH_DONE="$D" "$APP/scripts/install-watcher.sh"
  ok "drop folders on in Desktop/Reels: Raw - Reel, Raw - Reel with B-roll, Raw - My B-roll clips, Raw - Carousel, Raw - Clips from Long Video, Raw - Full YouTube Edit, Raw - Reel with Runway B-roll (music from Desktop/Reels/Music: links to Epidemic Sound inside)"
fi

# ---------------------------------------------------------------- 7. Prove it
bold "7/7  Test reel"
if [ -z "$RELEASE" ]; then
( cd "$APP" && node bin/reel.mjs doctor 2>/dev/null | sed -n '1,8p' | sed 's/^/  /' )
TEST="$HOME/Reels/install-test"
mkdir -p "$TEST"
ffmpeg -nostdin -y -loglevel error -f lavfi -i "testsrc2=size=1080x1920:rate=30" -f lavfi -i "sine=frequency=440" -t 24 -pix_fmt yuv420p -shortest "$TEST/test.mov"
out=$(cd "$TEST" && node "$APP/bin/reel.mjs" edit test.mov --out "$TEST/videos/test" --transcript "$APP/examples/sample-words.json" --hook "It *works*" 2>&1 | tail -1)
[ -f "$out" ] || die "The test reel did not render. Run: cd $APP && node bin/reel.mjs doctor"
ok "test reel: $out"
[ "$YES" = 1 ] || open "$out" 2>/dev/null || true
fi

if [ "$STUDIO" = 1 ]; then
  # The Content Studio: the client's photo folder, Claude, Metricool and posting times (scripts/studio-setup.mjs).
  [ -n "$BRAND" ] || die "--studio needs a Reels kit (its Brand folder)."
  [ -n "$RELEASE" ] || bold "Your reels and posts"
  if [ -n "$RELEASE" ]; then
    # A kit gets editing proven first; the posting setup page opens after the test reel (below).
    note "Posting setup comes right after your test reel."
  else
  STUDIO_ARGS=(--brand "$BRAND"); [ "$NO_ROUTINE" != 1 ] || STUDIO_ARGS+=(--no-routine); [ "$YES" = 1 ] && STUDIO_ARGS+=(--yes)
  node "$APP/scripts/studio-setup.mjs" "${STUDIO_ARGS[@]}" || die "The reels and posts setup stopped. Read the message above, then run the installer again."
  fi
fi

# Only client kits opt in; Greg's presets and installer path keep their existing jobs.
if [ "$LOOK" = brand ]; then
  MAINTENANCE_ARGS=(install --app "$APP")
  [ "$STUDIO" != 1 ] || MAINTENANCE_ARGS+=(--studio)
  [ "$WATCH" = y ] || MAINTENANCE_ARGS+=(--no-watch)
  node "$APP/scripts/client-maintenance.mjs" "${MAINTENANCE_ARGS[@]}"
  ok "weekly fixes on: your settings and brand stay yours; local code edits pause updates"
  note "Updates are checked offline and rolled back if the check fails. Notes: ~/.reel/maintenance/updates.log"
  [ "$STUDIO" = 1 ] || note "Waiting reels are checked three times a day. Alerts appear on this Mac; notes: ~/.reel/maintenance/STATUS.txt"
fi

if [ -n "$RELEASE" ]; then
  note "Making your test reel"
  if [ "$LINK" = 1 ]; then "$HOME/.local/bin/reel" accept 2>&1 | tee -a "$CONF/install.log"; else node "$APP/bin/reel.mjs" accept 2>&1 | tee -a "$CONF/install.log"; fi
  node "$RUNTIME_HELPER" phase "$RELEASE" acceptance
  # accept owns the filename; open the movie it made in the isolated test folder.
  out="$(find "$HOME/Reels/install-test" -type f -name '*.mp4' -print | sed -n '1p')"
  [ -n "$out" ] || die "The test reel is missing. See ~/.reel/install.log, then run this installer again."
  [ "$YES" = 1 ] || open "$out" || die "The test reel is ready at $out, but it could not be opened."
fi

if [ -n "$RELEASE" ] && [ "$STUDIO" = 1 ]; then
  # One setup for accounts, keys, posting times and the Claude routines (src/setup-steps.mjs). It saves after every
  # answer, so stopping halfway is safe: reel setup picks up where it stopped.
  bold "Your reels and posts"
  if [ "$YES" = 1 ] || [ ! -r /dev/tty ]; then
    node "$APP/scripts/studio-setup.mjs" --brand "$BRAND" --yes
    note "Next: open Terminal and type  reel setup  to connect your accounts and posting."
  else
    note "A setup page opens in your browser. Follow it, then click Finish there."
    "$HOME/.local/bin/reel" setup --brand "$BRAND" || note "Setup is saved where it stopped. Type  reel setup  in Terminal to continue."
  fi
fi

bold "Done."
note "Open a new Terminal window, then:  reel edit my-clip.mov --hook \"Your *hook* here\""
[ "$WATCH" != y ] || note "Or drop a clip into one of the Raw folders in Desktop/Reels and wait for the notification."
note "Run this installer again any time to update."
}

main "$@" < /dev/null
