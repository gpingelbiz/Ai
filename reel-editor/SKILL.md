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
   Transcription is ElevenLabs Scribe (key in ~/.zshrc) with a Whisper second opinion. If the summary says `review: N spots to check`, read `videos/<name>/review.txt` and tell Greg each spot; fix the caption in `plan.json` when it is clearly wrong.
4. Read the summary lines: cuts removed, caption count, zooms. Then look at the render (`videos/<name>/renders/<name>.mp4`). Extract 3 or 4 frames with ffmpeg and check: hook readable, captions not covering the face, keyword highlights on the right words.
5. If something is off, edit `videos/<name>/plan.json` (caption text, `key` flags, hook text, zoom list) and run `reel build videos/<name>`. Do not hand-edit `project/index.html`; it is regenerated.

## Flags you will actually use

- `--silence slow|medium|fast` (default fast), `--no-bad-takes`, `--no-fillers`, `--no-cuts`
- `--cta "Comment GHOST"` for the keyword pop-up in the last 3 seconds (GHOST on operator content; FREEDOM only on its own post; never two keywords on one reel). `--cta-last`, `--cta-at`, `--cta-style pill|box|text`.
- Hook style is `headline` by default: words rise on a soft dark glow, one gold phrase, a gold rule under it. The gold phrase is picked automatically; mark it by hand with asterisks (`--hook "The *10 minutes* after a bad number"`). `--title-style gold|outline|box` are the older looks.
- The hook places itself: Apple Vision finds the face in the hook's frames and the hook goes above the head, or between the chin and the captions, shrinking the text if it must. Check the `hook placement:` summary line. `--hook-position` overrides it.
- With no `--hook`, the opening sentence is the hook and the caption lines that repeat it are hidden while it shows. A written hook is still better.
- `--hook-position 0.40` when the opening shot is wide and the default hook (22% from the top) would sit on the head
- Gold keywords are picked automatically when a line has no dictionary term; check them in the frames and fix `key` flags in `plan.json` if one is off. `--no-auto-keywords` turns this off.
- `--no-zooms`, `--no-hook`, `--words-per-line 4`, `--active-word`
- `--music <file>` (`--music-volume 0.12`), `--sfx` (ElevenLabs whoosh/pop, needs `ELEVENLABS_API_KEY`)
- `--voiceover script.txt --voice <id> [--replace-audio]` for narrated or faceless cuts
- `--canvas landscape` for YouTube, `--quality delivery` for the final export
- `--preset clean` for plain subtitles with none of the brand styling

## Post copy

After the render, write the caption, hashtags and hook options from Sandcastles:

```bash
node scripts/write-caption.mjs videos/<name> "<where the reel is> - caption.txt"
```

It runs Claude Code headless with only the Sandcastles hook and format lookups allowed, in the voice from `voice/greg.md`. No CTA unless `REEL_WATCH_CTA` is set. The drop folder does this on its own after every reel.

## B-roll and carousel

`--broll` on `reel edit` adds 1-3 Codex stills after the hook (no faces, no readable text); `reel carousel videos/<name> --out "<reel folder>/Carousel"` makes the IG carousel from the finished reel, reusing those stills. Both need the Codex CLI signed in and stop for 20 minutes after a rate limit. Check every still before posting: describe what is in it, and never present an AI image as real footage of Greg, a client or a real event.

## Deliver

Put each finished reel in its own folder under `~/Desktop/Reels`: `<YYYY-MM-DD> Reel <n>`, numbered through the day (the drop folder keeps the count in `~/Reels/videos/reel-count-<date>`; bump it when you add one by hand). Inside: `Reel with B-roll/` (the b-roll render, named after its hook, plus `B-roll 1.png`...), `Reel with no B-roll/` (the plain render, `renders/<name>-no-broll.mp4` when made with `--broll --both`), `Carousel/`, `caption.txt`, and `check these words.txt` when review.txt has spots.


Give Greg the render path, the before/after duration, and anything that looked off (a mis-heard word, a caption on the face, a weak auto hook). Offer thumbnail-agent as the optional next step.
