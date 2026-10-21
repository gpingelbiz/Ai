#!/usr/bin/env python3
"""Word-level transcription with faster-whisper (CPU, int8).

Usage: python3 transcribe_words.py INPUT -o words.json [--model small] [--lang en] [--prompt "Ghost P&L, ..."]
Writes {"engine","model","language","duration","words":[{"text","start","end","prob"}]}.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile


def main():
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--model", default="small")
    p.add_argument("--lang", default="en")
    p.add_argument("--prompt", default="")
    p.add_argument("--device", default=os.environ.get("REEL_WHISPER_DEVICE", "cpu"))
    p.add_argument("--compute", default=os.environ.get("REEL_WHISPER_COMPUTE", "int8"))
    a = p.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("faster-whisper is not installed: pip install faster-whisper")

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "audio.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", a.input, "-vn", "-ac", "1", "-ar", "16000", wav],
            check=True,
        )
        model = WhisperModel(a.model, device=a.device, compute_type=a.compute)
        segments, info = model.transcribe(
            wav,
            language=a.lang or None,
            vad_filter=True,
            beam_size=5,
            word_timestamps=True,
            initial_prompt=a.prompt or None,
            condition_on_previous_text=False,
        )
        words = []
        for seg in segments:
            for w in seg.words or []:
                text = w.word.strip()
                if not text:
                    continue
                words.append({
                    "text": text,
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "prob": round(w.probability, 3),
                })

    out = {
        "engine": "faster-whisper",
        "model": a.model,
        "language": info.language,
        "duration": round(info.duration, 3),
        "words": words,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"{len(words)} words, {info.duration:.1f}s of audio", file=sys.stderr)


if __name__ == "__main__":
    main()
