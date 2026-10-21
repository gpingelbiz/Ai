---
name: reel-editor
description: Edit a raw talking-head video into a finished reel on the local machine: Whisper transcript, silence and bad-take removal, Pingel Brand captions (3 words per line, Anton, gold keywords), 3-second hook title, magic zooms, HyperFrames render. Use when Greg drops a video and says edit it, caption it, clean it up, add zooms, or "magic" it.
---

# Reel Editor (self-hosted)

Run everything with the `reel` CLI in this folder (`node bin/reel.mjs` if it is not linked). No hosted service, no credits.

## Standard run

1. Confirm the input is a local file path. Drive or Dropbox links must be downloaded first.
2. Transcribe first so you can write the hook from the words:
   ```bash
   reel transcribe "<video>" -o videos/<name>/words.json
   ```
   Read `words.json`. Write a hook title: 4 to 8 words, Greg's voice (direct, no hype, no emojis), a claim or a contrast that makes the viewer stay. Never use A.C.R.A. Framework names are THE GHOST P&L, THE FIVE ROOMS, THE SWAP, THE CLOSER LINE, THE WRONG SCOREBOARD.
3. Edit and render:
   ```bash
   reel edit "<video>" --out videos/<name> --hook "<your hook>"
   ```
   `words.json` from step 2 is reused automatically.
4. Read the summary lines: cuts removed, caption count, zooms. Then look at the render (`videos/<name>/renders/<name>.mp4`). Extract 3 or 4 frames with ffmpeg and check: hook readable, captions not covering the face, keyword highlights on the right words.
5. If something is off, edit `videos/<name>/plan.json` (caption text, `key` flags, hook text, zoom list) and run `reel build videos/<name>`. Do not hand-edit `project/index.html`; it is regenerated.

## Flags you will actually use

- `--silence slow|medium|fast` (default fast), `--no-bad-takes`, `--no-fillers`, `--no-cuts`
- `--cta "Comment GHOST"` for the keyword pop-up in the last 3 seconds (GHOST on operator content; FREEDOM only on its own post; never two keywords on one reel). `--cta-last`, `--cta-at`, `--cta-style pill|box|text`.
- `--title-style gold|outline|box` (box when the opening frames are bright or busy)
- `--no-zooms`, `--no-hook`, `--words-per-line 4`, `--active-word`
- `--music <file>` (`--music-volume 0.12`), `--sfx` (ElevenLabs whoosh/pop, needs `ELEVENLABS_API_KEY`)
- `--voiceover script.txt --voice <id> [--replace-audio]` for narrated or faceless cuts
- `--canvas landscape` for YouTube, `--quality delivery` for the final export
- `--preset clean` for plain subtitles with none of the brand styling

## Deliver

Give Greg the render path, the before/after duration, and anything that looked off (a mis-heard word, a caption on the face, a weak auto hook). Offer thumbnail-agent as the optional next step.
