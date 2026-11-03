# Local FastMetal candidate worker — approval plan

<!-- DOWNLOAD MANIFEST -->
## DOWNLOAD MANIFEST

**Budget approximately 23–26 GB downloaded, 45–50 GB disk including caches and a 5 GB candidate allowance. Require 55 GB free before installation.** These are decimal GB; only the weights repository's 19.5 GB listing is a published total. Package/source sizes are planning estimates, not a measured or fully locked bill of materials. The Mini's reported 101 GB free provides room for this pilot.

| Download | Source URL | Licence | Download GB | Destination under `~/localgen` |
| --- | --- | --- | ---: | --- |
| uv 0.13.7 installer + Apple arm64 binary | https://astral.sh/uv/0.13.7/install.sh ; https://github.com/astral-sh/uv/releases/tag/0.13.7 | MIT OR Apache-2.0 | ~0.025 | `uv-install.sh`, `bin/` |
| Managed CPython 3.12.16 arm64 build, runtime libraries | https://github.com/astral-sh/python-build-standalone/releases ; https://www.python.org/downloads/release/python-31216/ | PSF-2.0 plus bundled library licences | ~0.04 | `python/`, `cache/uv/` |
| FastVideo source, commit `a943220c115228ade5d57b3bab9a6a87fd600a10` | https://github.com/hao-ai-lab/FastVideo/commit/a943220c115228ade5d57b3bab9a6a87fd600a10 | Apache-2.0; bundled TAEHV/RIFE code MIT | ~0.15 | `FastVideo/` including its Git metadata |
| Python wheels, package metadata, build tooling and transitive dependencies for `.[mlx]` and venv seeding | https://pypi.org/simple/ ; https://files.pythonhosted.org/ ; declared list: https://github.com/hao-ai-lab/FastVideo/blob/a943220c115228ade5d57b3bab9a6a87fd600a10/pyproject.toml | Per package: Apache, MIT, BSD, PSF, LGPL and bundled notices; **not all Apache** | ~3–6 | `.venv/`, `cache/uv/` |
| Complete `FastVideo/FastMetal-5B-QAD`, revision `5e4819ec9c8dd062443cf015bd9022c700eca458`: INT8 DiT, UMT5 encoder, tokenizer, scheduler, VAE and metadata | https://huggingface.co/FastVideo/FastMetal-5B-QAD/tree/main | Apache-2.0 (repository/model-card declaration) | **19.5** | `models/FastMetal-5B-QAD/`, HF metadata in `cache/huggingface/` and local model `.cache/` |
| TAEHV Wan 2.2 decoder `taew2_2.pth`, pinned upstream commit | https://raw.githubusercontent.com/madebyollin/taehv/563f40bdc820ed86bcad72ea515ee48f06bd22ec/taew2_2.pth | MIT | ~0.022 | `cache/taehv/taew2_2.pth` |

Estimated network sum **22.74–25.74 GB**. Installed storage is larger than compressed wheels; allow **45–50 GB** including retained package caches, source, weights, embeddings, evidence and candidates. Library imports copy approved MP4s and consume the existing library's storage separately. No second model, RIFE weights, prompt-enhancer model, Node packages, Homebrew packages or developer tools are part of this recipe. Existing Git, curl, ffmpeg and ffprobe are prerequisites; missing prerequisites stop the installer.

The wheel row covers all direct and transitive packages fetched by the approved install, including pip/setuptools/wheel seeding, PyTorch/torchvision/torchaudio, MLX, transformers/tokenizers/sentencepiece, diffusers/peft/accelerate, safetensors/HF Hub, scipy/numpy/h5py, image/video libraries (av, imageio, imageio-ffmpeg, OpenCV, Pillow, moviepy), web/UI packages, data/training utilities and their dependencies. Exact resolved versions, individual wheel sizes and licences need an installation-time inventory; `packages.txt` records versions. This is an explicit approval scope for that dependency set, not a claim that its per-wheel manifest has been verified. If approval requires individual wheel hashes/sizes first, do not set `LOCALGEN_OK`; prepare that inventory separately with approval for the metadata requests.
<!-- END DOWNLOAD MANIFEST -->

## Verified sources and limits

Checked official pages on 2026-11-03 without downloading code, packages or weights. The [model card](https://huggingface.co/FastVideo/FastMetal-5B-QAD) and [weights file listing](https://huggingface.co/FastVideo/FastMetal-5B-QAD/tree/main) both declare Apache-2.0. The root listing does not contain a separate LICENSE file; verification here is the publisher's explicit repo/card licence metadata. Keep the snapshot README and provenance. [FastVideo source licence](https://github.com/hao-ai-lab/FastVideo/blob/main/LICENSE) is Apache-2.0; the [decoder licence](https://github.com/madebyollin/taehv/blob/563f40bdc820ed86bcad72ea515ee48f06bd22ec/LICENSE) is MIT. This licence check is not an output-quality claim.

The [official MLX installation guide](https://github.com/hao-ai-lab/FastVideo/blob/main/docs/getting_started/installation/mlx.md) specifies Python 3.12, macOS 14+ and a source checkout. The Mini's Python 3.14 is left in place. Use [uv's managed Python](https://docs.astral.sh/uv/guides/install-python/) to obtain 3.12.16: Python.org's [3.12.16 release](https://www.python.org/downloads/release/python-31216/) has no Mac installer. uv's [unmanaged install option](https://docs.astral.sh/uv/reference/installer/) keeps its binary in the worker folder without editing shell profiles.

No account/token is required for the public source, wheels or this ungated HF model. The later admission check uses the existing signed-in `claude` CLI plus ffmpeg/ffprobe and the existing local vision checker; it may consume the existing Claude allowance. Generation has no provider fees and makes zero Runway calls. If vision is unavailable, candidates remain unapproved.

## Exact install recipe (do not run before approval)

Run **on the Mini**, from the existing editor checkout. First inspect this manifest with `bash tools/localgen/install.sh`; it prints the table and exits before writes or network access. Only after Greg approves its complete download scope:

```sh
LOCALGEN_OK=1 bash tools/localgen/install.sh
```

The installer puts uv 0.13.7 in `~/localgen/bin`, obtains CPython 3.12.16, and creates **`~/localgen/.venv`** with `uv venv --python 3.12.16 --seed`. It fetches the pinned FastVideo source commit. From that checkout its MLX install command is:

```sh
~/localgen/bin/uv pip install --python ~/localgen/.venv/bin/python --no-sources -e '.[mlx]'
```

`--no-sources` avoids optional CUDA Git-source mappings. It then downloads the pinned complete model snapshot via `huggingface_hub.snapshot_download`, and preloads the small decoder with SHA-256 `d053e216ca50e2bb837bbcd79b85f0366bea00e5938025572382a773b74c559a`. This additional decoder download is visible in the [upstream loader](https://github.com/hao-ai-lab/FastVideo/blob/main/fastvideo/mlx_runtime/wan_vae.py). A completed install records versions and becomes a no-op on rerun; interrupted installs resume existing downloads. It never auto-updates a completed environment. Removing `installed.txt` is an intentional repair requiring another approved run. An interrupted lock must be removed manually after confirming no installer is running.

## Queue and admission

Preview from any machine:

```sh
node bin/reel.mjs broll-generate --prompts tools/localgen/prompts.json --dry-run
```

Later, run the same command **on the Mini** without `--dry-run`. No SSH occurs in the wrapper. It launches `generate.py` with the worker venv, records a fresh `~/localgen/outputs/batch-*` directory, probes actual MP4 dimensions/duration, and calls `checkRunwayVideo` with each shot's literal shows/action and a synthetic caption context. Only explicit passing subject, action, motion and appearance checks reach `saveLibraryClip`, with `{ provider: "localgen", model: "FastMetal-5B", licence: "Apache-2.0" }` and no reel-use/history registration. Ordinary editing rechecks library footage in the actual spoken context.

Defaults: 704 wide × 1280 high, 65 frames at 24 fps (**2.71 s**), normal three-step generation, CPU text encoding, TAEHV decode, fixed per-prompt seeds, one clip at a time. Direct `generate.py` accepts `--frames` from 49 to 81 in steps of four (2.04–3.38 s). 704×1280 is compatible with the runtime's spatial grid; portrait quality has not been benchmarked. Do not silently substitute landscape or upscale a smaller result. The [upstream generator](https://github.com/hao-ai-lab/FastVideo/blob/main/examples/inference/basic/mlx_wan22_generate.py) provides width/height/frame controls and metrics.

Both Hugging Face offline flags and a Python network audit hook are active during generation. Missing assets fail, without automatic downloads. The worker redirects the decoder cache and supplies an explicit prompt-cache path. Homebrew ffmpeg handles encoding. Every candidate keeps MP4, job, upstream metrics, stdout/stderr log, memory record and admission evidence. Reusing an occupied output directory fails; the wrapper always creates a fresh one. Failed clips stay outside the library.

`REEL_LOCALGEN_HOME` defaults to `~/localgen`; the existing `REEL_BROLL_LIBRARY` and `REEL_CACHE` still select library storage. `LOCALGEN_OK` defaults unset. No preset or normal editing behavior changes.

## Mini capacity and pilot expectations

[Published measurements](https://haoailab.com/blogs/fastmetal/) for **81-frame landscape** 5B output report 151 s / 9.34 GiB MLX peak on M4 Max and about 200 s / 9.54 GiB on M5 Air. These are not M4 Pro portrait measurements. Budget **approximately 3–6 minutes per cold 2–3 s portrait candidate** on this M4 Pro, and **30–60 minutes for ten attempts**, plus inspection time. This is an engineering estimate allowing for slower GPU bandwidth, encoding and shape-dependent performance; it is not a proportional frame-count benchmark.

Expect roughly **9–12 GiB peak MLX allocations** and budget **14–18 GB total process/system pressure** on 24 GB unified memory. Neither number is measured on this Mini. Close memory-heavy apps and observe the first clip before leaving the queue overnight. Every fresh worker logs elapsed wall time, MLX peak across resets, and peak process RSS. RSS and MLX allocations overlap: never sum them. A killed worker may have null memory metrics and is rejected. Successful admission rate matters more than generation count.

The ten prompts cover two variants each of a falling coconut, dispensing cream, walking gorilla, sliding snake and breaking wave. The cream shot necessarily includes an isolated palm and tube; “no people” here means no visible person/face/body beyond the required hands. Other shots contain no humans. All are fixed daylight compositions. Action fidelity, portrait support on the pinned revision, Python wheel compatibility and timing remain to be tested on the Mini after download approval. Source `main` was readable; pinned generator contents could not be fetched through web search, so the installer checks the required metrics API before fetching weights.
