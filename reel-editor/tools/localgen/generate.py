#!/usr/bin/env python3
"""Serial, offline FastMetal candidates. Installation is a separate approved step."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import runpy
import shutil
import subprocess
import sys
import time

TAEHV_SHA256 = "d053e216ca50e2bb837bbcd79b85f0366bea00e5938025572382a773b74c559a"


def read_prompts(file):
    prompts = json.loads(Path(file).read_text())
    if not isinstance(prompts, list) or not prompts:
        raise ValueError("prompts must be a nonempty JSON array")
    ids = set()
    for p in prompts:
        if not isinstance(p, dict) or any(not isinstance(p.get(k), str) or not p[k].strip()
                                          for k in ("id", "prompt", "shows", "scene", "action")):
            raise ValueError("each prompt needs id, prompt, shows, scene and action")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", p["id"]) or p["id"] in ids:
            raise ValueError("prompt ids must be unique lowercase slugs")
        if type(p.get("seed")) is not int or not 0 <= p["seed"] <= 0xffffffff:
            raise ValueError("each prompt needs a uint32 seed")
        ids.add(p["id"])
    return prompts


def write_json(file, value):
    tmp = file.with_suffix(file.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2) + "\n")
    tmp.replace(file)


def preflight(home):
    model = home / "models" / "FastMetal-5B-QAD"
    script = home / "FastVideo" / "examples/inference/basic/mlx_wan22_generate.py"
    decoder = home / "cache/taehv/taew2_2.pth"
    required = [script, model / "mlx_dit.json", model / "mlx_dit.safetensors",
                model / "text_encoder/config.json", model / "tokenizer/tokenizer_config.json", decoder]
    if any(not f.is_file() or not f.stat().st_size for f in required):
        raise ValueError("local assets missing; review PLAN.md and approve install.sh first")
    if not list((model / "text_encoder").glob("*.safetensors")):
        raise ValueError("text encoder weights missing")
    if hashlib.sha256(decoder.read_bytes()).hexdigest() != TAEHV_SHA256:
        raise ValueError("TAEHV checksum mismatch; no automatic download")
    return script, model


def generation_args(script, model, p, out, home, frames):
    return [str(script), "--mlx-checkpoint", str(model), "--text-encoder-root", str(model),
            "--vae-root", str(model / "vae"), "--decode-backend", "taehv",
            "--text-encoder-device", "cpu", "--width", "704", "--height", "1280",
            "--num-frames", str(frames), "--fps", "24", "--seed", str(p["seed"]),
            "--prompt", p["prompt"], "--output-path", str(out / (p["id"] + ".mp4")),
            "--prompt-embeds-cache", str(home / "cache/prompts" / (p["id"] + ".npy")),
            "--metrics-json", str(out / (p["id"] + ".metrics.json"))]


def offline_env(home, ffmpeg):
    return {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1", "HF_HOME": str(home / "cache/huggingface"),
            "WANDB_MODE": "disabled", "IMAGEIO_FFMPEG_EXE": ffmpeg}


def deny_network(event, args):
    # HF's offline switch does not cover the decoder's urllib fallback.
    if event in ("socket.connect", "socket.getaddrinfo", "urllib.Request"):
        raise RuntimeError("generation is offline; approve missing assets through install.sh")


def worker(job):
    sys.addaudithook(deny_network)
    import mlx.core as mx
    from fastvideo.mlx_runtime import wan_vae

    home = Path(job["home"])
    wan_vae._cache_dir = lambda: home / "cache/taehv"
    peaks = []
    reset = mx.reset_peak_memory

    def track_reset():
        peaks.append(mx.get_peak_memory())
        reset()

    mx.reset_peak_memory = track_reset
    started = time.perf_counter()
    try:
        # The upstream entrypoint imports helpers from the source checkout.
        sys.path.insert(0, str(home / "FastVideo"))
        sys.argv = job["argv"]
        runpy.run_path(sys.argv[0], run_name="__main__")
    finally:
        peaks.append(mx.get_peak_memory())
        # macOS ru_maxrss is bytes. RSS and MLX allocations overlap; do not add them.
        write_json(Path(job["memory_file"]), {
            "wall_seconds": round(time.perf_counter() - started, 3),
            "mlx_peak_gib": round(max(peaks) / 1024**3, 3),
            "process_peak_rss_gib": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**3, 3),
        })


def generate(prompts, home, out, frames=65, *, runner=subprocess.run, clock=time.perf_counter,
             assets=preflight, ffmpeg=None):
    if frames not in range(49, 82, 4):
        raise ValueError("frames must be 49, 53, 57, 61, 65, 69, 73, 77 or 81")
    script, model = assets(home)
    ffmpeg = ffmpeg or shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("ffmpeg must already be installed")
    out.mkdir(parents=True, exist_ok=True)
    (home / "cache/prompts").mkdir(parents=True, exist_ok=True)
    results = []
    for p in prompts:
        file = out / (p["id"] + ".mp4")
        # A fresh output directory prevents partial or stale files from being admitted.
        if any(out.glob(p["id"] + ".*")):
            raise ValueError("output exists; choose a new --out directory")
        argv = generation_args(script, model, p, out, home, frames)
        memory_file = out / (p["id"] + ".memory.json")
        job = out / (p["id"] + ".job.json")
        write_json(job, {"home": str(home), "argv": argv, "memory_file": str(memory_file)})
        started = clock()
        with (out / (p["id"] + ".log")).open("w") as log:
            completed = runner([sys.executable, str(Path(__file__).resolve()), "--worker", str(job)],
                               cwd=home / "FastVideo", env=offline_env(home, ffmpeg),
                               stdout=log, stderr=subprocess.STDOUT, check=False)
        memory = json.loads(memory_file.read_text()) if memory_file.exists() else {}
        result = {"id": p["id"], "file": str(file), "seed": p["seed"],
                  "frames": frames, "fps": 24, "width": 704, "height": 1280,
                  "wall_seconds": round(clock() - started, 3),
                  "mlx_peak_gib": memory.get("mlx_peak_gib"),
                  "process_peak_rss_gib": memory.get("process_peak_rss_gib"),
                  "ok": completed.returncode == 0 and file.is_file() and file.stat().st_size > 0}
        results.append(result)
        write_json(out / "results.json", results)
        print(json.dumps(result), flush=True)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompts", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--home", type=Path, default=Path.home() / "localgen")
    parser.add_argument("--frames", type=int, default=65)
    parser.add_argument("--worker", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        worker(json.loads(args.worker.read_text()))
        return
    if not args.prompts or not args.out:
        parser.error("--prompts and --out are required")
    if sys.platform != "darwin" or os.uname().machine != "arm64":
        parser.error("generation requires an Apple Silicon Mac")
    generate(read_prompts(args.prompts), args.home.expanduser().resolve(), args.out.expanduser().resolve(), args.frames)


if __name__ == "__main__":
    main()
