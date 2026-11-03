#!/bin/bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
prompts="$repo/tools/localgen/prompts.json"
dry_run=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prompts) [ "$#" -ge 2 ] || { echo "--prompts needs a file" >&2; exit 1; }; prompts="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) echo "Usage: bash tools/localgen/overnight.sh [--prompts <file>] [--dry-run]" >&2; exit 1 ;;
  esac
done
[ -f "$prompts" ] || { echo "Prompts file missing: $prompts" >&2; exit 1; }

host=${REEL_LOCALGEN_SSH_HOST:-gregs-mac-mini}
key=${REEL_LOCALGEN_SSH_KEY:-$HOME/.ssh/id_triage_mirror}
remote_repo=${REEL_LOCALGEN_REMOTE_REPO:-Ai/reel-editor}
remote_node=${REEL_LOCALGEN_REMOTE_NODE:-node}
node=${REEL_LOCALGEN_NODE:-node}
batches=${REEL_LOCALGEN_BATCHES:-$HOME/Reels/B-roll library/localgen-batches}
log_file=${REEL_LOCALGEN_LOG:-$batches/overnight-$(date +%Y%m%d-%H%M%S)-$$.log}
ssh_args=(-i "$key" -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=6)

# Quote remote shell arguments, including checkout and batch paths with spaces.
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
show() { printf ' %q' "$@"; printf '\n'; }
if [ "$dry_run" = 1 ]; then
  echo "Dry run; log: $log_file"
  show ssh "${ssh_args[@]}" "$host" 'create a job folder under ~/localgen/jobs'
  show scp -O -i "$key" "$prompts" "$host:<job>/prompts.json"
  show ssh "${ssh_args[@]}" "$host" "cd $(quote "$remote_repo"); nohup $(quote "$remote_node") bin/reel.mjs broll-generate --prompts <job>/prompts.json --generate-only & wait"
  show scp -O -i "$key" -r "$host:<batch folder>" "$batches/"
  show "$node" "$repo/bin/reel.mjs" broll-generate --admit "$batches/<batch folder>"
  exit 0
fi

mkdir -p "$batches" "$(dirname "$log_file")"
echo "Overnight local generation; log: $log_file"
exec >>"$log_file" 2>&1
echo "Started: $(date)"
remote_job=$(ssh "${ssh_args[@]}" "$host" 'mkdir -p "$HOME/localgen/jobs" && mktemp -d "$HOME/localgen/jobs/overnight-XXXXXX"')
echo "Mini job: $remote_job"
scp -O -i "$key" -o BatchMode=yes "$prompts" "$host:$(quote "$remote_job/prompts.json")"

# The detached worker retains its log and status even if this SSH connection drops.
ssh "${ssh_args[@]}" "$host" "/bin/bash -s -- $(quote "$remote_repo") $(quote "$remote_job") $(quote "$remote_node")" <<'REMOTE'
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$1"
nohup /bin/bash -c '
  "$1" bin/reel.mjs broll-generate --prompts "$2/prompts.json" --generate-only >"$2/generation.log" 2>&1
  code=$?
  if [ "$code" -eq 0 ]; then
    sed -n "s/^\[reel\] broll-generate: batch folder: //p" "$2/generation.log" | tail -n 1 >"$2/batch-path"
    [ -s "$2/batch-path" ] || code=1
  fi
  printf "%s\n" "$code" >"$2/status"
  exit "$code"
' _ "$3" "$2" </dev/null >/dev/null 2>&1 &
code=0
wait "$!" || code=$?
cat "$2/generation.log"
exit "$code"
REMOTE

remote_batch=$(ssh "${ssh_args[@]}" "$host" "cat $(quote "$remote_job/batch-path")")
batch_name=$(basename "$remote_batch")
case "$batch_name" in batch-?*) ;; *) echo "Invalid Mini batch path: $remote_batch" >&2; exit 1 ;; esac
[ ! -e "$batches/$batch_name" ] || { echo "Local batch already exists: $batches/$batch_name" >&2; exit 1; }
scp -O -i "$key" -o BatchMode=yes -r "$host:$(quote "$remote_batch")" "$batches/"
"$node" "$repo/bin/reel.mjs" broll-generate --admit "$batches/$batch_name"
echo "Finished; batch: $batches/$batch_name"
