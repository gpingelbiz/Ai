#!/bin/bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
awk '/<!-- DOWNLOAD MANIFEST -->/{printing=1; next} /<!-- END DOWNLOAD MANIFEST -->/{printing=0} printing' "$script_dir/PLAN.md"
if [ "${LOCALGEN_OK:-}" != "1" ]; then
  echo 'STOPPED: Greg must approve all manifest downloads first. Then run with LOCALGEN_OK=1.'
  exit 1
fi

if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'Apple Silicon macOS is required.' >&2
  exit 1
fi
for tool in git curl ffmpeg ffprobe shasum; do
  command -v "$tool" >/dev/null || { echo "Missing existing prerequisite: $tool (no automatic install)." >&2; exit 1; }
done

localgen_root="${REEL_LOCALGEN_HOME:-$HOME/localgen}"
mkdir -p "$localgen_root"
if ! mkdir "$localgen_root/.install-lock" 2>/dev/null; then
  echo 'Another install is running; remove .install-lock only after checking it has stopped.' >&2
  exit 1
fi
trap 'rmdir "$localgen_root/.install-lock"' EXIT
if [ -f "$localgen_root/installed.txt" ]; then
  echo "Already installed; keeping recorded versions in $localgen_root/installed.txt."
  exit 0
fi
free_kb="$(df -Pk "$localgen_root" | awk 'END {print $4}')"
if [ "$free_kb" -lt 55000000 ]; then
  echo 'Reserve at least 55 GB free for installation, caches and candidates.' >&2
  exit 1
fi
export UV_CACHE_DIR="$localgen_root/cache/uv"
export UV_PYTHON_INSTALL_DIR="$localgen_root/python"
export UV_PYTHON_BIN_DIR="$localgen_root/bin"
export HF_HOME="$localgen_root/cache/huggingface"
export HF_HUB_DISABLE_TELEMETRY=1
export GIT_LFS_SKIP_SMUDGE=1
mkdir -p "$localgen_root/bin" "$localgen_root/cache/taehv"
if [ ! -x "$localgen_root/bin/uv" ]; then
  curl -fLsS https://astral.sh/uv/0.13.7/install.sh -o "$localgen_root/uv-install.sh"
  UV_UNMANAGED_INSTALL="$localgen_root/bin" sh "$localgen_root/uv-install.sh"
fi
uv_bin="$localgen_root/bin/uv"
"$uv_bin" python install 3.12.16
if [ ! -x "$localgen_root/.venv/bin/python" ]; then
  "$uv_bin" venv --python 3.12.16 --seed "$localgen_root/.venv"
fi
"$localgen_root/.venv/bin/python" -c 'import sys; assert sys.version_info[:3] == (3, 12, 16), "Existing venv must use Python 3.12.16"'

fastvideo_revision=a943220c115228ade5d57b3bab9a6a87fd600a10
if [ ! -d "$localgen_root/FastVideo/.git" ]; then
  git init "$localgen_root/FastVideo"
  git -C "$localgen_root/FastVideo" remote add origin https://github.com/hao-ai-lab/FastVideo.git
fi
if ! git -C "$localgen_root/FastVideo" cat-file -e "$fastvideo_revision^{commit}" 2>/dev/null; then
  git -C "$localgen_root/FastVideo" fetch --depth 1 origin "$fastvideo_revision"
fi
git -C "$localgen_root/FastVideo" checkout --detach "$fastvideo_revision"
(
  cd "$localgen_root/FastVideo"
  "$uv_bin" pip install --python "$localgen_root/.venv/bin/python" --no-sources -e '.[mlx]'
)
# Refuse an upstream API mismatch before downloading the model.
"$localgen_root/.venv/bin/python" - "$localgen_root" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
script = root / 'FastVideo/examples/inference/basic/mlx_wan22_generate.py'
assert '--metrics-json' in script.read_text(), 'Generator API differs; review the recipe before continuing'
PY
"$localgen_root/.venv/bin/python" - "$localgen_root" <<'PY'
from pathlib import Path
import sys
from huggingface_hub import snapshot_download
root = Path(sys.argv[1])
snapshot_download('FastVideo/FastMetal-5B-QAD', revision='5e4819ec9c8dd062443cf015bd9022c700eca458',
                  local_dir=root / 'models/FastMetal-5B-QAD')
PY
decoder="$localgen_root/cache/taehv/taew2_2.pth"
if [ ! -f "$decoder" ]; then
  curl -fLsS https://raw.githubusercontent.com/madebyollin/taehv/563f40bdc820ed86bcad72ea515ee48f06bd22ec/taew2_2.pth -o "$decoder.tmp"
  echo "d053e216ca50e2bb837bbcd79b85f0366bea00e5938025572382a773b74c559a  $decoder.tmp" | shasum -a 256 -c -
  mv "$decoder.tmp" "$decoder"
fi
echo "d053e216ca50e2bb837bbcd79b85f0366bea00e5938025572382a773b74c559a  $decoder" | shasum -a 256 -c -
"$uv_bin" pip freeze --python "$localgen_root/.venv/bin/python" > "$localgen_root/packages.txt"
{
  echo "FastVideo $fastvideo_revision"
  echo 'FastVideo/FastMetal-5B-QAD 5e4819ec9c8dd062443cf015bd9022c700eca458'
  "$localgen_root/.venv/bin/python" --version
  "$uv_bin" --version
} > "$localgen_root/installed.txt"
echo "Installed under $localgen_root. No clips generated. See PLAN.md for the local queue command."
