# Reel Editor

Self-hosted reel editor for talking-head videos. Drop in a raw clip, get back a finished vertical reel:

1. **Transcribe** with ElevenLabs Scribe when `ELEVENLABS_API_KEY` is set (most accurate, about 2 s per minute of video), otherwise Whisper large-v3-turbo on the Mac Mini. The brand preset also gets a **second opinion** from the other engine: every phrase the two hear differently, or either is unsure of, goes into `review.txt` with its time in the finished reel (the drop folder puts it next to the reel as `<name> - check these words.txt`). If Scribe is unreachable, Whisper takes over.
2. **Cut** dead air, `um`/`uh`, stutters, and false starts (the first take of a restarted phrase). Every silence cut is checked against the real audio level, so a word the transcript timed wrong is never clipped, and a word repeated across a sentence break ("look at you. You can") is not a stutter.
3. **Clean audio**: high-pass, noise reduction, loudness normalized to -16 LUFS.
4. **Captions**: 3 words per line, Anton, all caps, Bone text, Signet Gold keyword, heavy stroke, lower third at 72%, pop-in.
5. **Hook title**: Anton in Signet Gold at 22% from the top for the first 3 seconds.
6. **Magic zooms**: punch in and out every ~5 seconds on caption boundaries.
7. **Render** with [HyperFrames](https://github.com/heygen-com/hyperframes) (HTML composition, deterministic MP4).

Optional through ElevenLabs: whoosh/pop sound effects, a narration track, and Scribe as an alternate transcription engine.

It does what the Submagic "Magic" pipeline did (captions, zooms, hook, bad-take and silence removal) on your own machine, with every intermediate step as a file you can edit.

**Setting this up on another Mac?** One line in Terminal does it (three questions: look, ElevenLabs key, drop folder):

```bash
curl -fsSL https://raw.githubusercontent.com/gpingelbiz/Ai/main/reel-editor/install.sh | bash
```

[SETUP.md](SETUP.md) has the details, your own words and colors, and troubleshooting.

**Sending it to someone?** `scripts/package-kit.sh ~/Desktop` builds `Reel Editor Kit.zip`: a double-click installer plus a one-page Start Here guide. It holds no code or keys; the installer pulls the latest version from GitHub when it runs.

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

Or run `npx -y @elevenlabs/cli@latest onboard init` in this folder: it signs you in through the browser and writes the key to `.env.local` (gitignored), which `reel` loads on start. A key already set in the shell wins.

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

### One long recording into several reels

`reel clips <long video> [--count 5] [--plan-only] [--replan]` transcribes the whole recording once, has headless Claude pick up to `count` windows of 30-90 s (each starting where a thought begins and ending on its payoff, scored 0-100 for how well it would hold a cold viewer, with a hook written for each), cuts each window out of the source with the hardware encoder and runs the normal edit on it with its slice of the transcript. `clips.json` in the work dir lists the windows, scores and outputs; `--plan-only` stops after the pick, `--replan` picks again, `--auto-hook` uses the opening line instead of Claude's hook. Every edit option applies to each clip.

## Hook A/B

`reel hooks <workdir> "hook A" "hook B"` renders the first 4 s of a finished reel once per hook (draft quality, same cuts, captions and music) into `<workdir>/hooks/`. The drop folders do this with hook ideas 2 and 3 from `caption.txt` into a `Hook options` folder next to the reel; drop the clip again as `clip__Chosen hook.mov` to re-edit with the winner. `REEL_WATCH_HOOKS=0` turns it off.

## Wide shots

A source wider than the canvas (a landscape or wide clip into 9:16) is reframed: Apple Vision samples the face every half second, the x centre is smoothed with a dead band, and the crop window follows the speaker (an object-position lane on the footage) instead of staying on the middle of the frame. `reframe.enabled: false` in a preset keeps the centre crop.

## Voice and speed

The clean pass sums the phone's stereo to mono, then high-pass, spectral denoise, de-ess, gentle compression, a limiter and -16 LUFS, encoded with the Apple hardware encoder at the canvas size (never upscaled; a wider source keeps its width for the reframe). The two transcripts and the level scan run side by side, the final render uses GPU encoding, and the lint/layout check is opt-in (`--check`). A 1-minute phone clip now edits in about 1.5 minutes with cards and music. `REEL_SW_ENCODE=1` / `REEL_SW_RENDER=1` force software; `REEL_DEEPFILTER=<path>` is reserved for a DeepFilterNet denoiser.

Sign-offs ("thanks for watching", "see you in the next one", "link in bio"...) inside the last 10 s are cut, so a reel ends on its last point.

## Publishing

`scripts/publish.mjs <work dir> --media-url <public link> [--trial] [--date <iso>] [--reviewer you@x.com]` writes `post.json` (caption and 5 hashtags from `caption.json`, cover frame at the hook, `isAiGenerated` when the reel has AI stills, as Instagram requires) and sends the reel to Metricool for your approval through headless Claude with only the Metricool review tool allowed. Metricool needs the video as a public link (Dropbox or Google Drive links are uploaded by it), so upload the MP4 first. It never auto-posts: a reviewer approves in Metricool.

## Punch-ins, caption lines and the cover

Punch-ins fire only on lines that carry a gold word (the claims), at least 10 s apart and at most 3 per 30 s, never under a card or a cutaway, never in the hook or the last second; each one is released at the next line start. A tight frame (the head fills more than 40% of the height) gets gentle zooms (1.07 / 1.10) instead of 1.14 / 1.22, so the chin stays off the captions.

Caption lines keep phrases whole: a line can't be made only of glue words ("or a") or end on one; the glue moves to the next line, which may grow one word past `wordsPerLine`.

Every reel gets three covers (`<workdir>/covers/Cover 1-3.png`, copied into the reel folder), built on the real frame the way the top-performing talking-head reels in this niche are: `scripts/person.swift` scores frames across the reel (expression x3: a mouth not mid-word; light x2; sharpness x2; angle; face size) and the best one is zoomed a little around the face, darkened a touch with a vignette; headless Claude writes 10 title candidates from the transcript and scores them (specificity, charge, brevity, stakes); the top 3 that fit become the variants: 2-4 words, ALL CAPS Anton measured with the real font metrics so a line never wraps, one accent word, placed under the chin on a close-up or in the top third when the face sits low, always inside the 3:4 grid crop. Three text treatments: outline (white, thick black stroke, shadow), bar (a near-black band with gold rules) and box (the accent word on a gold or red block). No username on the cover. Upload Cover 1 when posting; `reel cover <workdir>` remakes them. `cover.enabled: false` in a preset skips it.

Research (Oct 2026): covers get a marginal share of views (most come from recommendations) but custom covers lift profile-grid taps. The covers that perform in the sales-coach lane (Sandcastles top outliers, the grids of Andy Elliott, Jeremy Miner, Matt Ryder) keep the real room, put the face big, and use 3-6 heavy caps with a thick outline or a solid bar and one accent word; cut-outs on flat designed plates are the YouTube-tool look, not what wins on Reels. The grid crops to 3:4.

B-roll remembers the last 24 scenes it drew (`~/.cache/reel-editor/broll-recent.json`) and asks Codex for something different each time.

## Layout and safe zones

Captions are placed from the face: just under the chin, with the block never lower than 0.76 (where the caption overlay starts to cover it) and never higher than 0.56 (Meta's safe box ends at 65%: the username, caption and audio bar cover the bottom 35%). A close-up selfie gets them under the chin at about 0.75; a wide shot gets them at the safe line. `--caption-position` overrides; without a face the preset's 0.60 is used. A 7% left and 12% right margin keeps them off the action buttons on the right. The hook goes above the head or under the chin and the cards keep to the top 54%. The CTA pill sits at 0.48. The hook is on screen at full strength from frame 0 with a slow push-in on the footage (reels that spread show text by frame 4 and motion in the first half second).

## Dictionary

`dictionary.json` has four lists:

- `terms`: phrases that always get the gold highlight (framework names, money words). Also fed to Whisper as the initial prompt so it spells them right.
- `phrases`: extra phrases that always get the gold highlight but are NOT sent to Whisper. Use this for everyday phrases (`show up`): a hint can change what Whisper hears, and it once dropped a clipped opening "Don't".
- `corrections`: fixes for how Whisper hears a term (`"ghost p and l"` becomes `Ghost P&L`).
- `candidates`: everyday business words (close, sales, pipeline, money...) that get gold at most once per clip and never on two lines in a row, so gold keeps meaning something.
- `powerWords`: single words that get highlighted when no term is in the line.

With `autoKeywords` on (the brand preset), lines with none of the above get an automatic pick: a number with its unit (`three minutes`), a number word, or a strong 6+ letter word. A word gets automatic gold only once per clip and never on two automatic lines in a row. `--no-auto-keywords` turns it off; `--hook-position 0.40` drops the hook to chest height for wide shots.

## Post copy (caption, hashtags, hook options)

`scripts/write-caption.mjs <work dir> [out.txt]` writes the Instagram post copy for a finished reel: a 1-2 line caption in the speaker's words, 3 hashtags, and 3 hook-text options, each tied to a hook pattern Sandcastles shows winning for the reel's topic (with the example creator, views and outlier score). It runs `claude -p` with only the Sandcastles `top_hooks` and `top_formats` tools allowed, so it can't touch files or run commands. Voice comes from `REEL_CAPTION_VOICE`, else `voice/greg.md` for the brand preset, else `voice/default.md`. The drop folder runs it after every reel (`REEL_WATCH_CAPTION=0` turns it off). Needs the Claude Code CLI signed in and the Sandcastles connector added on claude.ai; without them the reel is delivered without a caption file.

## Music

`--music-dir <folder>` picks the bed from a folder of `<Mood> - Title - Artist.mp3` files by the mood of what is said: headless Claude reads the transcript and names 2-3 moods from the ones on disk (or none, for a raw confrontation), and a track is drawn inside them; files named `Signature ...` are the brand sound and weigh 3; a `Bench/` subfolder is parked. `--music-want <text>` (the drop folders' `#music:<name>`) forces the track whose name contains it; `--music <file>` is a fixed file. The bed is normalized to -16 LUFS, then plays at `--music-volume` (0.10, about 20 dB under the voice) from 0.5 s in, with a 1 s fade in, 1.5 s fade out and a swell to about double in pauses of 0.9 s or more (`--no-duck` for a flat level). `music.txt` in the work dir and the reel folder names the track. The drop folders use `~/Reels/music` (Desktop/Reels/Music; `REEL_WATCH_MUSIC`); `#nomusic` skips. The mix runs through a true-peak ceiling of -1.5 dBTP and the delivered file is normalized to -14 LUFS / -1 dBTP in two passes (`render.deliveryLoudness: false` to skip).

Research behind the defaults (Oct 2026): an active pool of 30-40 tracks with 5-8 signature ones beats a big random one, 8-10% under the voice is safer than 12% on phone speakers, Instagram turns loud uploads down toward -14 LUFS, and no mainstream editor matches music to the words.

## Graphic cards and reveal captions

The brand look is modeled on explainer reels: designed cards cut in to show what is being said, and captions that light up word by word.

`--graphics` (on in the brand preset): Claude Code, headless with no tools, reads the timed transcript and picks up to one moment per 10 seconds after the hook (at most 6) where a card makes the point land: `stat` (a number the speaker says, qualifiers kept: "Almost 8 years"), `list` (2-4 items, checked or struck through as they appear), `quote` (a paper card with one phrase highlighted), `headline` (the key line, one phrase in gold) and `steps` (2-4 connected nodes). Every word on a card comes from the speaker; the editor sets the cards in the preset colors with Inter and animates them (rise in, strike-through, highlight sweep, line draw, slow push). The voice keeps playing and the captions stay on top; nothing covers the hook, the last 1.5 seconds or the CTA. The plan is saved in `<work dir>/graphics.json` and reused while the transcript lines are the same (`--new-graphics` replans). With cards on, `--broll` adds at most 2 photos, only in the gaps at least 1.5 seconds from a card.

`--caption-style reveal` (the brand default): heavy Inter, no outline, a soft shadow; each 2-3 word phrase appears dimmed and every word lights up as it is spoken, highlights in gold. `--caption-style pop` is the earlier Anton look with the black outline.

## B-roll and carousel (Codex)

Both use the [Codex CLI](https://developers.openai.com/codex) signed in with a ChatGPT plan: `codex exec` headless, with its built-in image tool. No API key and no per-image bill, but the plan's rate limits apply.

`--broll` adds 1-3 generated stills (about one per 12 seconds after the hook; at most 2 when cards are on). In one session, Codex reads the finished transcript, picks the caption lines a picture would land on, and draws a vertical still for each: a literal object or process shot tied to the thing being said (a phone face-down on a tailgate, a whiteboard with one smudged number), never an empty conference room, dinner table or skyline, and never a scene drawn for a recent reel. The look is a candid documentary photo: one named practical light, mixed colour temperatures, worn surfaces, grain and halation, no retouching; the known AI tells (golden glow, symmetry, a centred subject, plastic surfaces, invented text) are banned, and the bottom third stays plain for the captions. The render hard-cuts to each still for 2 seconds (1.6-2.4) with a 6% ease-out push or a 3% pan, graded toward the phone footage with a vignette and moving grain, while the voice keeps playing and the captions stay on top. Never during the hook, never in the last second, never over the CTA. The drop folders split the work: `Raw - Reel` makes the edited reel, `Raw - Reel with B-roll` makes it with b-roll (plus the stills), `Raw - Carousel` makes only the carousel. The stills and their plan are saved in `<work dir>/broll/` and reused while the transcript lines are unchanged (`--new-broll` redraws). `broll.style` in a preset replaces the style line.

`reel carousel <work dir> [--out dir] [--slides 6]` turns a finished reel into an Instagram carousel: 1080x1350 PNGs and a `carousel.txt` with the slide text. Codex writes the slides from the transcript (a cover, the reel's points in order, a closing line) in the voice from `voice/`, and picks an image for each slide: one of the reel's b-roll stills when it fits, else a new one (at most 2 new, `carousel.newImages`; the rest are set as text cards). The words are set by the editor in Anton and Inter with one gold phrase per title, never drawn by the image model, so they are spelled right. The handle on each slide comes from `carousel.handle`. No CTA unless `REEL_WATCH_CTA` is set.

Rate limits: the first 429 from Codex pauses every Codex call from the editor for 20 minutes (saved in `~/.cache/reel-editor/codex-cooldown`, so the next drop waits too). Each reel uses at most two Codex sessions: one picks the b-roll moments and draws every still, one writes the carousel and draws its new images (every session carries a large setup prompt, and many sessions back to back trip the limit). A reel never fails because of b-roll: without Codex, or while it is paused, it renders without it. Headless Codex refuses some config-default models on a ChatGPT login; the editor then retries with `gpt-5.6-sol`, or set `REEL_CODEX_MODEL`.

## Hook title and CTA

`--title-style` picks the hook look. `headline` is the brand default: the words rise in one by one on a soft dark glow (no box), one phrase in Signet Gold and slightly larger, and a short gold rule draws in under it. The gold phrase is picked like a caption keyword (a dictionary term, a number with its unit, or the strongest word); mark it yourself with asterisks: `--hook "The *10 minutes* after a bad number"`. The older looks are `gold` (all Signet Gold), `outline` (Bone with the black outline) and `box` (Bone on an Obsidian backing). The hook places itself on the brand preset: Apple Vision finds the face in the hook's frames (punch-in zoom included), and the hook goes above the head when there is room, otherwise between the chin and the captions, with the text shrunk to as little as 70% if neither gap fits. `--hook-position` overrides it (the drop folder's `#top` and `#low` tags do the same). An automatic hook (the opening sentence) hides the caption lines that repeat it while it is on screen.

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
