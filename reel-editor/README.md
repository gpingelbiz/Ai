# Reel Editor

Self-hosted reel editor for talking-head videos. Drop in a raw clip, get back a finished vertical reel:

1. **Transcribe** with Whisper on the Mac Mini (word timestamps, framework names from `dictionary.json`).
2. **Cut** dead air, `um`/`uh`, stutters, and false starts (the first take of a restarted phrase).
3. **Clean audio**: high-pass, noise reduction, loudness normalized to -16 LUFS.
4. **Captions**: 3 words per line, Anton, all caps, Bone text, Signet Gold keyword, heavy stroke, lower third at 72%, pop-in.
5. **Hook title**: Anton in Signet Gold at 22% from the top for the first 3 seconds.
6. **Magic zooms**: punch in and out every ~5 seconds on caption boundaries.
7. **Render** with [HyperFrames](https://github.com/heygen-com/hyperframes) (HTML composition, deterministic MP4).

Optional through ElevenLabs: whoosh/pop sound effects, a narration track, and Scribe as an alternate transcription engine.

It does what the Submagic "Magic" pipeline did (captions, zooms, hook, bad-take and silence removal) on your own machine, with every intermediate step as a file you can edit.

## Install (Mac Mini)

```bash
brew install ffmpeg
pip install faster-whisper                     # already there if Whisper runs on the Mac
cd reel-editor && npm install                  # pulls the hyperframes CLI
npm link                                       # gives you the `reel` command (or use node bin/reel.mjs)
reel doctor
```

The first render downloads a headless Chrome through HyperFrames. The first transcription downloads the Whisper model (small, ~500 MB). Both are cached after that.

Optional keys, only for the ElevenLabs features:

```bash
export ELEVENLABS_API_KEY=...     # https://elevenlabs.io/app/developers/api-keys
export ELEVENLABS_VOICE_ID=...    # default voice for --voiceover
```

## Use

```bash
reel edit raw.mov
reel edit raw.mov --hook "You don't have a sales problem"
reel edit raw.mov --hook "..." --cta "Comment GHOST"                 # gold pill at chest level, last 3s
reel edit raw.mov --title-style box --cta "Comment FREEDOM" --cta-last 4
reel edit raw.mov --music beds/drive.mp3 --sfx
reel edit raw.mov --silence medium --no-bad-takes          # lighter touch
reel edit raw.mov --preset clean --canvas landscape          # plain subtitles, no hook, no zooms
reel batch ~/Movies/raw/                                     # every new clip in a folder
```

Output lands in `videos/<name>/`:

| File | What it is |
| --- | --- |
| `words.json` | word timestamps on the raw clip (reused on the next run; `--force` to redo) |
| `cuts.json` | kept segments and every removed region with its reason |
| `clean.mp4` | the cut, audio-cleaned footage |
| `plan.json` | everything the composition is built from: caption lines, keywords, hook, zooms, audio tracks |
| `project/` | the HyperFrames project (`index.html` + assets) |
| `renders/<name>.mp4` | the finished reel |

### Fix something and re-render

Edit `plan.json` (change a caption word, move a highlight, rewrite the hook, drop a zoom) and run:

```bash
reel build videos/<name>
```

To change what gets cut, edit `cuts.json` is not enough; rerun `reel edit` with different `--silence`, `--no-bad-takes`, or `--no-fillers` flags. `words.json` is reused so the second run skips transcription.

### Presets

`presets/pingel-brand.json` is the default and carries the brand look. `presets/clean.json` is plain subtitles. Any key in `presets/_defaults.json` can be overridden in a preset or passed as a path: `--preset my-look.json`.

### Dictionary

`dictionary.json` has four lists:

- `terms`: phrases that always get the gold highlight (framework names, money words). Also fed to Whisper as the initial prompt so it spells them right.
- `phrases`: extra phrases that always get the gold highlight but are NOT sent to Whisper. Use this for everyday phrases (`show up`): a hint can change what Whisper hears, and it once dropped a clipped opening "Don't".
- `corrections`: fixes for how Whisper hears a term (`"ghost p and l"` becomes `Ghost P&L`).
- `powerWords`: single words that get highlighted when no term is in the line.

With `autoKeywords` on (the brand preset), lines with none of the above get an automatic pick: a number with its unit (`three minutes`), a number word, or a strong 6+ letter word. A word gets automatic gold only once per clip and never on two automatic lines in a row. `--no-auto-keywords` turns it off; `--hook-position 0.40` drops the hook to chest height for wide shots.

## Hook title and CTA

`--title-style` picks the hook look: `gold` (Signet Gold, default), `outline` (Bone with the black outline), `box` (Bone on an Obsidian backing, for busy or bright footage).

`--cta "Comment GHOST"` adds the pop-up call to action for the last 3 seconds (`--cta-last 4`, or `--cta-at 10 --cta-duration 3` for a fixed window). It sits at chest level (`--cta-position 0.62`). Styles: `pill` (Obsidian text on a Signet Gold pill, default), `box` (Bone on Obsidian with a gold border), `text` (plain gold text with the caption stroke). One keyword per reel: GHOST for operator pieces, FREEDOM only on its own post.

## Hook titles

Without `--hook`, the first phrase of the clip is used. For a real hook, have Claude read `words.json` and write one, then pass it with `--hook`. The `SKILL.md` in this folder tells Claude how to run the whole thing.

## HDR footage (iPhone, HDR10)

iPhone clips are HLG (Dolby Vision) and some cameras record PQ (HDR10). HyperFrames draws HDR video on a native layer above the page, which hides every caption, so the cut pass always converts HDR sources to BT.709 SDR first:

- HLG: ffmpeg's `colorspace` filter. Matches what the phone shows.
- PQ: a VideoToolbox tone-map pass on macOS (`source-sdr.mov` in the work dir), rotation applied in software. On other machines it falls back to `colorspace` with a warning, and colors may look flat.

The log line `encoding clean.mp4 (... + hlg → BT.709 SDR)` confirms it ran.

## Automate with n8n

`n8n/reel-watch-folder.json` is an importable workflow: new file in `~/Reels/raw` → `scripts/watch-reel.sh` → finished MP4 in `~/Reels/done` plus a Mac notification (and a #pingel-hq post when you enable the Slack node). The filename carries the brief: `clip__Hook text here #nocta.mov`. Setup, filename tags, the Docker caveat and a launchd alternative are in `n8n/README.md`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ELEVENLABS_API_KEY` | `--sfx`, `--voiceover`, `--engine elevenlabs` |
| `ELEVENLABS_VOICE_ID` | default voice for `--voiceover` |
| `REEL_PYTHON` | python that has `faster_whisper` (default `python3`) |
| `REEL_WHISPER_DEVICE` / `REEL_WHISPER_COMPUTE` | `cpu`/`int8` by default; `cuda`/`float16` on a GPU box |
| `REEL_BROWSER_PATH` | use an existing Chrome/Chromium for rendering instead of the HyperFrames download |
| `REEL_SFX_CACHE` | where generated sound effects are cached (default `~/.cache/reel-editor/sfx`) |
| `REEL_DICTIONARY` | alternate dictionary file |
| `REEL_DEBUG=1` | stack traces and every check finding |

## Tests

```bash
npm test
```

Covers cut planning (silence, fillers, stutters, false starts, deliberate repeats), word remapping, caption grouping and keyword picking, hook and zoom planning, and the generated composition HTML. An end-to-end render needs ffmpeg and Chrome; run `reel edit examples/...` on any clip with `--transcript examples/sample-words.json` to exercise it without Whisper.

## Credits

Built on [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0) and GSAP (bundled `assets/vendor/gsap.min.js`, GreenSock standard license). Fonts: Anton and Inter (SIL OFL).
