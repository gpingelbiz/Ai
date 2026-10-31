#!/bin/bash
# Shared speaker scanner: source files stay put, and only drafts are built.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export SPEAKER_HOME="${SPEAKER_HOME:-$HOME}"
ROOT="${SPEAKER_CLIENTS_ROOT:-$SPEAKER_HOME/Reels/speaker-clients}"
REEL="${SPEAKER_REEL:-reel}"
export PATH="$SPEAKER_HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
DRY=0
case "${1:-}" in --dry-run) DRY=1;; "") ;; *) echo 'usage: speaker-watch.sh [--dry-run]' >&2; exit 2;; esac
LOCK="${SPEAKER_LOCK:-$ROOT/.speaker-watch.lock}"
mtime() { if stat -c %Y "$1" >/dev/null 2>&1; then stat -c %Y "$1"; else stat -f %m "$1"; fi; }
if [ "$DRY" = 0 ]; then
  mkdir -p "$(dirname "$LOCK")"
  if ! mkdir "$LOCK" 2>/dev/null; then
    if [ "$(( $(date +%s) - $(mtime "$LOCK") ))" -gt 10800 ]; then
      rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null || exit 0
    else echo 'speaker watcher busy'; exit 0; fi
  fi
fi
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; if [ "$DRY" = 0 ]; then rmdir "$LOCK" 2>/dev/null || true; fi; }
trap cleanup EXIT
trap 'exit 130' INT TERM
HELP="$("$REEL" speaker --help 2>/dev/null)"; HELP_OK=$?
if [ "$HELP_OK" != 0 ] || ! printf '%s' "$HELP" | grep -Eqi '(^|[^[:alnum:]_])speaker([^[:alnum:]_]|$)'; then HELP=""; fi
log() { local line; line="$(date '+%F %T') $*"; if [ "$DRY" = 1 ]; then printf '%s\n' "$line"; else printf '%s\n' "$line" >> "$client/watch.log"; fi; }
step() {
  local label="$1"; shift
  if [ "$DRY" = 1 ]; then log "would run $REEL speaker $*"; return 0; fi
  if "$REEL" speaker "$@" > "$TMP/step.log" 2>&1; then log "$label OK"; return 0; fi
  log "$label FAILED: $(tail -c 700 "$TMP/step.log" | tr '\n\r' '  ')"; return 1
}
# NUL-separated clients preserve spaces, commas and parentheses.
node "$HERE/speaker-status.mjs" --clients > "$TMP/clients" || exit 1
while IFS= read -r -d '' client; do
  [ -d "$client/work" ] || { [ "$DRY" = 1 ] || mkdir -p "$client/work"; }
  node "$HERE/speaker-status.mjs" --snapshot "$client" > "$TMP/before" || continue
  stable=0
  if [ "$DRY" = 1 ]; then stable=1
  else
    # Even an empty snapshot waits once: a just-started directory copy may not have entries yet.
    for ((attempt=0; attempt<${SPEAKER_STABLE_ATTEMPTS:-30}; attempt++)); do
      sleep "${SPEAKER_STABLE_SECONDS:-10}"
      node "$HERE/speaker-status.mjs" --snapshot "$client" > "$TMP/after" || break
      if cmp -s "$TMP/before" "$TMP/after"; then stable=1; break; fi
      cp "$TMP/after" "$TMP/before"
    done
  fi
  ready=1
  if [ "$stable" = 0 ]; then log 'intake waiting: files still changing; retry next run'; ready=0
  else
    # Include capabilities so installing a newer CLI also retries previously skipped steps.
    printf '%s\n' "$HELP" >> "$TMP/before"
    if cmp -s "$TMP/before" "$client/work/.speaker-watch-indexed"; then log 'init/index skipped: intake unchanged (cached)'
    else
      complete=1
      if printf '%s' "$HELP" | grep -Eq '(^|[^[:alnum:]_])init([^[:alnum:]_]|$)'; then
        if ! step 'init --add-new' init "$client" --add-new; then ready=0; complete=0; fi
      else log 'init skipped: speaker init not available yet'; complete=0; fi
      if [ "$ready" = 1 ]; then
        if printf '%s' "$HELP" | grep -Eq '(^|[^[:alnum:]_])index([^[:alnum:]_]|$)'; then
          if ! step index index "$client"; then ready=0; complete=0; fi
        else log 'index skipped: speaker index not available yet'; complete=0; fi
      else log 'index skipped: intake failed'; fi
      if [ "$DRY" = 0 ] && [ "$complete" = 1 ]; then cp "$TMP/before" "$client/work/.speaker-watch-indexed"; fi
    fi
  fi
  shopt -s nullglob
  for plan in "$client/work/plans/"*.json; do
    version="$(basename "$plan" .json)"
    case "$version" in *[!a-zA-Z0-9_-]*|"") log "draft skipped: invalid plan version $version"; continue;; esac
    if [ "$ready" != 1 ]; then log "draft $version skipped: intake not ready"; continue; fi
    if ! printf '%s' "$HELP" | grep -q -- '--draft'; then log "draft $version skipped: speaker --draft not available yet"; continue; fi
    stamp="$client/work/$version/.speaker-watch-draft"
    if [ -f "$stamp" ] && [ ! "$plan" -nt "$stamp" ]; then log "draft $version skipped: plan unchanged"; continue; fi
    touch -r "$plan" "$TMP/draft-time"
    if step "draft $version" "$client" --version "$version" --draft && [ "$DRY" = 0 ]; then
      mkdir -p "$client/work/$version"
      # Preserve the plan's original mtime, so a plan edited during a render is rebuilt next time.
      touch -r "$TMP/draft-time" "$stamp"
    fi
  done
  if ! node "$HERE/speaker-status.mjs" "$client" $([ "$DRY" = 1 ] && printf '%s' '--dry-run') > "$TMP/status" 2>&1; then log "status FAILED: $(cat "$TMP/status" | tr '\n\r' '  ')"; else log 'status updated'; fi
done < "$TMP/clients"
