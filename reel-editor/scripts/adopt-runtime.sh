#!/bin/bash
# Greg's own Macs: use the same pinned tools as every client kit (runtime/runtime.json) without changing anything
# else. The git checkout, presets, ~/.zshrc settings, keys, LaunchAgents and the Whisper model cache stay as they
# are; ~/.reel/env.sh puts the pinned tools first on PATH, and the watchers already read that file.
#
#   bash scripts/adopt-runtime.sh            install the pinned tools, then write ~/.reel/env.sh
#   bash scripts/adopt-runtime.sh --undo     remove ~/.reel/env.sh (the old tools come back; the runtime stays)
#
# Kit installs never use this: install.sh --release does the whole client install.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HOME/.reel/env.sh"

if [ "${1:-}" = "--undo" ]; then
  [ -f "$ENV_FILE" ] && mv "$ENV_FILE" "$ENV_FILE.off-$(date +%Y%m%d-%H%M%S)" && echo "Pinned tools off; the old tools are used again."
  exit 0
fi
[ -e "$APP/../.git" ] || { echo "This is for a git checkout of the editor (Greg's Macs). A kit install already has the pinned tools." >&2; exit 1; }
if [ -f "$ENV_FILE" ] && grep -q "REEL_CLIENT_MODE='1'" "$ENV_FILE"; then echo "This Mac is a client kit install; leave it to its installer." >&2; exit 1; fi

ROOT="$HOME/.local/share/reel-editor"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# bootstrap-runtime.sh reads the tools list from a release.json; give it one that holds just the runtime.
node -e 'const fs=require("fs");const [rt,out]=process.argv.slice(1);fs.writeFileSync(out,JSON.stringify({runtime:JSON.parse(fs.readFileSync(rt,"utf8"))}))' "$APP/runtime/runtime.json" "$TMP/release.json"
RT_ID="$(/usr/bin/plutil -extract runtime.id raw -o - "$TMP/release.json")"
RT="$ROOT/runtime/$RT_ID"
echo "Pinned tools $RT_ID"
bash "$APP/scripts/bootstrap-runtime.sh" "$TMP/release.json"

# Python and the locked Whisper packages, inside the runtime (Greg's existing ~/.cache/huggingface model is reused).
PY_VERSION="$(/usr/bin/plutil -extract runtime.python.version raw -o - "$TMP/release.json")"
export UV_PYTHON_INSTALL_DIR="$RT/python" UV_PYTHON_BIN_DIR="$RT/bin" UV_PYTHON_PREFERENCE=only-managed UV_CACHE_DIR="$ROOT/tmp/uv-cache"
if [ ! -f "$RT/.speech-complete" ]; then
  "$RT/bin/uv" python install "$PY_VERSION"
  [ -x "$RT/venv/bin/python" ] || "$RT/bin/uv" venv --python "$PY_VERSION" "$RT/venv"
  "$RT/bin/uv" pip install --python "$RT/venv/bin/python" --require-hashes --only-binary :all: -r "$APP/runtime/requirements.lock"
  "$RT/venv/bin/python" -c "import faster_whisper" && touch "$RT/.speech-complete"
fi
echo "Speech packages ready"

mkdir -p "$HOME/.reel"
[ ! -f "$ENV_FILE" ] || cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cat > "$ENV_FILE.tmp" <<EOF
# Greg's Mac: the pinned tools from runtime/runtime.json ($RT_ID), first on PATH. Written by scripts/adopt-runtime.sh;
# everything else (preset, folders, keys) stays in ~/.zshrc and ~/Ai/reel-editor/.env.local. Undo: adopt-runtime.sh --undo
# The watchers read only this file once it exists, so first carry over the reel settings from ~/.zshrc, as they did.
while IFS= read -r _line; do eval "\$_line"; done < <(grep -E '^export (REEL_|ELEVENLABS_|RUNWAY_|PEXELS_|PIXABAY_|PRODUCER_)' "\$HOME/.zshrc" 2>/dev/null || true)
unset _line
export PATH='$RT/bin':"\$PATH"
export REEL_RUNTIME='$RT'
export REEL_PYTHON='$RT/venv/bin/python'
export REEL_CLOUDFLARED='$RT/bin/cloudflared'
EOF
mv "$ENV_FILE.tmp" "$ENV_FILE"
grep -q '/.reel/env.sh' "$HOME/.zshrc" 2>/dev/null || printf '\n# Reel Editor pinned tools (scripts/adopt-runtime.sh)\n[ -f "$HOME/.reel/env.sh" ] && . "$HOME/.reel/env.sh"\n' >> "$HOME/.zshrc"
. "$ENV_FILE"
echo "Using: $(command -v node) $(node -v), $(command -v ffmpeg) ($(file -b "$(command -v ffmpeg)" | awk '{print $NF}'))"
echo "Done. New Terminal windows and the watchers use the pinned tools."
