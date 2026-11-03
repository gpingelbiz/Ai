"""Standard-library tests; no MLX install, models, network or generator entrypoint."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("localgen", sys.argv[1])
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
p = {"id": "coconut-1", "seed": 123, "prompt": "Coconut drops.", "shows": "coconut",
     "scene": "Coconut above sand.", "action": "Coconut falls."}


def raises(fn, error=ValueError):
    try:
        fn()
    except error:
        return
    raise AssertionError("expected rejection")


with tempfile.TemporaryDirectory(prefix="localgen-python-") as tmp:
    home = Path(tmp)
    queue = home / "queue.json"
    for invalid in [None, [], [None], [p, p], [{**p, "id": "../outside"}], [{**p, "seed": True}],
                    [{**p, "seed": -1}], [{**p, "seed": 2**32}], [{**p, "scene": " "}]]:
        g.write_json(queue, invalid)
        raises(lambda: g.read_prompts(queue))
    g.write_json(queue, [p])
    assert g.read_prompts(queue) == [p]
    raises(lambda: g.preflight(home))
    model = home / "models/FastMetal-5B-QAD"
    script = home / "FastVideo/examples/inference/basic/mlx_wan22_generate.py"
    decoder = home / "cache/taehv/taew2_2.pth"
    for f in [script, model / "mlx_dit.json", model / "mlx_dit.safetensors",
              model / "text_encoder/config.json", model / "tokenizer/tokenizer_config.json", decoder]:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("fixture")
    raises(lambda: g.preflight(home))
    (model / "text_encoder/model.safetensors").write_text("fixture")
    raises(lambda: g.preflight(home))  # checksum mismatch, never downloads
    with patch.object(g, "TAEHV_SHA256", g.hashlib.sha256(b"fixture").hexdigest()):
        assert g.preflight(home) == (script, model)
    for event in ["socket.connect", "socket.getaddrinfo", "urllib.Request"]:
        raises(lambda: g.deny_network(event, ()), RuntimeError)
    g.deny_network("open", ())

    calls = []
    def fake_run(args, **kw):
        calls.append((args, kw))
        assert kw["env"]["HF_HUB_OFFLINE"] == "1"
        assert kw["env"]["TRANSFORMERS_OFFLINE"] == "1"
        assert kw["env"]["IMAGEIO_FFMPEG_EXE"] == "/fake/ffmpeg"
        assert kw["cwd"] == home / "FastVideo"
        job = json.loads(Path(args[-1]).read_text())
        argv = job["argv"]
        assert argv[argv.index("--width") + 1] == "704"
        assert argv[argv.index("--height") + 1] == "1280"
        assert argv[argv.index("--num-frames") + 1] == "65"
        assert argv[argv.index("--fps") + 1] == "24"
        assert argv[argv.index("--seed") + 1] == "123"
        assert "--fast" not in argv and "--enhance-prompt" not in argv
        output = Path(argv[argv.index("--output-path") + 1])
        if "failed" not in output.name:
            output.write_bytes(b"fake mp4")
        g.write_json(Path(job["memory_file"]), {"mlx_peak_gib": 9.3, "process_peak_rss_gib": 10.1})
        return types.SimpleNamespace(returncode=1 if "failed" in output.name else 0)

    assets = lambda _: (script, model)
    with contextlib.redirect_stdout(io.StringIO()):
        result = g.generate([p, {**p, "id": "failed"}], home, home / "out", runner=fake_run,
                            assets=assets, ffmpeg="/fake/ffmpeg", clock=lambda: 12)
    assert len(calls) == 2 and result[0]["ok"] and not result[1]["ok"]
    assert result[0]["mlx_peak_gib"] == 9.3 and result[0]["wall_seconds"] == 0
    assert json.loads((home / "out/results.json").read_text()) == result
    raises(lambda: g.generate([p], home, home / "out", runner=fake_run, assets=assets, ffmpeg="/fake/ffmpeg"))
    raises(lambda: g.generate([p], home, home / "other", frames=50, runner=fake_run, assets=assets))

    # Simulate an upstream reset after a larger allocation than the final stage.
    mx = types.ModuleType("mlx.core")
    mx.get_peak_memory = lambda: 12 * 1024**3
    def reset():
        mx.get_peak_memory = lambda: 5 * 1024**3
    mx.reset_peak_memory = reset
    mlx = types.ModuleType("mlx")
    mlx.core = mx
    vae = types.SimpleNamespace(_cache_dir=lambda: Path("/unexpected-cache"))
    runtime = types.ModuleType("fastvideo.mlx_runtime")
    runtime.wan_vae = vae
    modules = {"mlx": mlx, "mlx.core": mx, "fastvideo": types.ModuleType("fastvideo"), "fastvideo.mlx_runtime": runtime}
    def fake_entry(*args, **kwargs):
        assert vae._cache_dir() == home / "cache/taehv"
        mx.reset_peak_memory()
    with patch.dict(sys.modules, modules), patch.object(sys, "addaudithook") as audit, patch.object(g.runpy, "run_path", fake_entry):
        memory = home / "worker-memory.json"
        g.worker({"home": str(home), "argv": [str(script)], "memory_file": str(memory)})
        audit.assert_called_once_with(g.deny_network)
    assert json.loads(memory.read_text())["mlx_peak_gib"] == 12
