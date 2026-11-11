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

## Tested releases and client kits

For client kits, use the release commands in this section. Older kit examples elsewhere in this guide need `--release <release.json>` or `--dev` added. Released kits use their bundled installer.

Save every repository change in git before building. From `reel-editor/`:

```bash
npm run release -- build --id 2026.11.08.1
node scripts/brand-kit.mjs their-brand.json --release dist/release/2026.11.08.1/release.json
node scripts/brand-kit.mjs their-brand.json --studio their-guide.md --release dist/release/2026.11.08.1/release.json
node scripts/release.mjs kits 2026.11.08.1 --clients /path/to/private/kits.json
```

The build refuses any changed or untracked repository files, runs `npm test`, requires all six golden frames to match, and builds the Apple Silicon helpers with `scripts/build-helpers.sh`. Missing golden baselines fail; `npm run test:golden:update` is only for an intended, reviewed change. The builder copies the app into a temporary folder and runs full `npm ci` there. It keeps dev dependencies because `pngjs` is used by runtime slide and grid checks. Building needs the normal maintainer tools and access to the package cache or registry; tests use local fakes and never download packages.

Outputs are `dist/release/<id>/reel-editor-<id>.tar.gz` and `release.json`. The manifest records the saved git commit, the entire pinned runtime, every shipped file's SHA-256 and the passing test counts. The archive contains one `reel-editor/` folder. It excludes local settings, keys, personal brands, Greg's presets and voice, music, personal example footage and dependency caches. A fresh dependency install goes into the archive. The embedded `release.json` describes the app files; the sidecar also has the finished archive's SHA-256 and size. Neither manifest hashes itself, since an archive cannot contain its own final hash.

Kit builds require `--release`; they verify and open the saved archive and use its own kit builder and templates. Each zip gets `release.json`, that release's `install.sh`, its launcher and guides, and the person's Brand folder. Zips strip extended attributes and resource forks. For a local preview, use `--dev` instead; the console and adjacent send-out message warn against sending it to a client. Existing Greg installs without `--release` keep their development workflow.

The private registry defaults to `~/Reels/client-brands/kits.json`. Paths can be absolute, start with `~/`, or be relative to the registry file:

```json
[
  { "brand": "jane.json", "studio": null, "out": "kits/jane" },
  { "brand": "sam.json", "studio": "sam-guide.md", "out": "kits/sam" }
]
```

After reviewing the artifact and getting Greg's go-ahead, `node scripts/release.mjs publish 2026.11.08.1` prints the destination, commit, both upload paths, hash and size. Add `--yes` to create GitHub release `reel-2026.11.08.1` and upload both files. There is no automatic retry. `reel doctor` shows the release, runtime and changed or missing files; a client's `STATUS.txt` starts with its release number.

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
reel edit raw.mov --hook "..." --cta "DM me"                         # gold pill at chest level, last 3s
reel edit raw.mov --title-style box --cta "DM me" --cta-last 4
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

### Bold look

Greg's vertical reels can use `reel edit raw.mov --preset pingel-bold` (or `REEL_PRESET=pingel-bold`). Glow remains the default. `reel restyle videos/<name> --look bold` creates `videos/<name>-bold`, preserving footage, cuts and project music. Restyle without `--look` still uses glow. Add `--repick` to edit or restyle to replace the saved direction; `--no-render` writes a project without measuring a rendered face.

Bold makes one argument-planning call. `bold-picks.json` saves `schemaVersion: 1`, the transcript hash, `argument` ranges (`buyerProblem`, `answer`, `payoff`), a verbatim `headline` range with one `emphasis` index, `punch` spans with roles and reasons, quiet `emphasis` word indexes, optional argument `turns`, and `overlays`. Ranges are inclusive. Invalid direction falls back to the opening sentence and quiet captions. `plan.json` retains `words` and adds `bold` version 1 with the headline, caption `groups`, argument, measured `zones`, accepted `overlays` and event landing frames/seconds. Every spoken word remains in one caption group while the headline holds.

The preset's `bold` block controls headline size/hold (3 to 4.5 seconds), phrase timing, quiet Inter 650 at 84 px, punch Inter 900 at 104 px with a 12 px stroke, gold and punch budgets, chin clearance, safe bounds and semantic framing limits. Dimensions scale from 1080×1920. B-roll and legacy graphics are off by default. The registry in `src/bold-overlays.mjs` imports trusted overlay kinds; placement protects the face, headline and caption zone, and sounds use only accepted events. Client jobs cannot enable bold, and its preset is excluded from client releases.

#### Proof folder

Bold supports optional `proof`, `define` and `math` overlays in the same argument-planning call. Put real approved screenshots and `manifest.json` in `~/Reels/brand-assets/proof/`, or set `bold.proof.manifest`. Approved glossary definitions live in `glossary.json` beside it; transcript explanations need no glossary. See [Proof folder setup, schema, defaults and plan fields](docs/bold-proof.md). Sources are locally redacted, cropped and checked against the 32 px text floor. Cards hold 3.5 to 6 seconds; math builds from spoken number ranges beside the face. Each kind is capped at one through 30 seconds, two on longer reels. Missing grounding, files or space leaves captions running clean. No new CLI flags.

#### Conversations, stickers and payoffs

Conversations use optional direction `speakers: [{from,to,speaker:"other",reason}]`. Every unmarked word defaults to Greg. Face turns take priority when `bold.talk.gregPerson` explicitly identifies Greg's zero-based person index from left to right; its default `null` keeps uncertain identity on Greg. Existing `speakerTurns` / `speakerTimeline.turns` are reused, or the existing face-turn helper scans multi-face footage. Phrases never cross voices. Other speech uses gold Inter 600, while Greg stays bone. One optional `topic` overlay selects 4 to 7 consecutive transcript words and holds in the top safe area after the headline until the conversation ends. Unplaceable cards are omitted. `plan.bold.talk` records the resolved speakers, conversation indexes and source.

`bold.sticker.enabled` and `bold.payoff.enabled` are off in the engine defaults and on in `pingel-bold` (Claude decides when a sentence earns one; code caps them). Stickers use `{kind:"sticker",from,to,asset,purpose:"prop"|"reaction",reason}`; asset IDs come from the same planning prompt. `sticker.photosDir` and `iconsDir` name Greg's local folders. Only single-face, clear photos pass; the existing native still-person tool extracts their real pixels. Checks and cutouts cache under the job's `bold-extras/`, and selected PNGs stage under `project/assets/bold-extras/`. No personal assets enter the repository or client releases. Sticker width defaults to 260 px, hold to 1.2 seconds, with 6-frame entrance and 4-frame exit. Code caps width at 220 to 320 px, hold at 0.9 to 1.5 seconds, two stickers per reel, ten seconds apart and one reaction. Limits can be lowered in the preset.

Payoffs use `{kind:"payoff",from,to,style:"stack"|"burst",reason}` only inside an already marked punch `role:"payoff"` that survives caption budgets. One seeded gold-coin decoration lasts about one second below captions. Coins carry no quantities or proof claims. The preset controls width (320), hold (1), style (`stack`) and piece count (9, capped at 12). Missing assets, failed cutouts, absent face measurements or occupied space omit the effect. Accepted stickers get a soft card cue; a payoff gets one slam, aligned by `eventClock`. Speaker captions and topic cards are silent. These additions introduce no CLI flags; the existing `--preset pingel-bold`, `--look bold` and `--repick` controls apply.

## VSL sales videos

Drop a recording into `~/Desktop/Reels/Raw - VSL Editor` (shortcut to `~/Reels/raw-vsl`). Each client's `~/Desktop/Reels/Clients/<Name>/Raw - VSL Editor` points to that client's `raw-vsl`. Re-run the installer to add Greg's shortcut and watcher path; re-run `node scripts/client.mjs add their-brand.json` for an existing client's shortcut and launchd path. The scanner also creates `raw-vsl` in existing client roots.

VSL always uses `--preset vsl --canvas landscape`: clean sentence-case lower-band captions, gentle silence cuts with at least 0.35 s of breath between phrases, false-start/retake removal, closing words preserved (`cuts.signOff: false`), and a 2 s final hold from the source when available. Leave at least 2 s of footage after the final word when recording. Client colors and fonts come from the active client `REEL_PRESET`; hooks, music, zooms, reel CTAs and the Instagram hook/post-copy pass are off. Short-form filename tags are ignored in this folder.

Name the recording with its VSL Builder project id, for example `2026-sample-offer.mov` or `take-1 #vsl-2026-sample-offer.mov`. Lookup searches `${REEL_VSL_PROJECTS:-~/Clients}/*/vsl/projects/<project-id>/04-script/`, uses the newest `final_script` line in `approvals.jsonl`, and otherwise selects the highest `script.vNNN.md`. Duplicate project ids across clients are treated as ambiguous. Without a match, the edit has no cards and the delivered folder includes `No script found.txt` with naming instructions.

Finished videos land in a new `<date> VSL <n>/` under the usual delivery root (Desktop/Reels after install, or the client's Desktop root). Script sections supply `chapters.txt` beside the video, in `mm:ss S1 Title` format, from the planner's `vsl-sections.json` on the finished timeline. Work files stay in `~/Reels/videos/<name>-vsl/` (or the client's `videos/`). `REEL_WATCH_RAW_VSL` overrides Greg's input folder. Originals stay in the drop folder; rename to retry.

By hand: `reel edit recording.mov --preset vsl --canvas landscape [--script script.md]`. Script parsing, alignment and SCREEN cards are supplied by the VSL script planner; `graphics.scriptOnly` prevents automatic card planning, and cards leave the first 2 s and last 2.5 s clear.

### One long recording into several reels

`reel clips <long video> [--count 5] [--plan-only] [--replan]` transcribes the whole recording once, has headless Claude pick up to `count` windows of 30-90 s (each starting where a thought begins and ending on its payoff, scored 0-100 for how well it would hold a cold viewer, with a hook written for each), cuts each window out of the source with the hardware encoder and runs the normal edit on it with its slice of the transcript. `clips.json` in the work dir lists the windows, scores and outputs; `--plan-only` stops after the pick, `--replan` picks again, `--auto-hook` uses the opening line instead of Claude's hook. Every edit option applies to each clip.

## Hook A/B

`reel hooks <workdir> "hook A" "hook B"` renders the first 4 s of a finished reel once per hook (draft quality, same cuts, captions and music) into `<workdir>/hooks/`. The drop folders do this with hook ideas 2 and 3 from `caption.txt` into a `Hook options` folder next to the reel; drop the clip again as `clip__Chosen hook.mov` to re-edit with the winner. `REEL_WATCH_HOOKS=0` turns it off.

## Wide shots

A source wider than the canvas (a landscape or wide clip into 9:16) is reframed: Apple Vision samples the face every quarter second, a low-lag One Euro path holds still through detector noise and resets at jump cuts, and the crop window follows the speaker (an object-position lane on the footage) instead of staying on the middle of the frame. `reframe.smoother: "average"` restores the old path; `reframe.enabled: false` keeps the centre crop.

## Voice and speed

The clean pass sums the phone's stereo to mono, then denoises, de-esses, levels, compresses gently, limits and lands at -16 LUFS, encoded with the Apple hardware encoder at the canvas size (never upscaled; a wider source keeps its width for the reframe). With the DeepFilterNet binary installed that is the studio sound pass (below); without it the spectral denoiser (afftdn) does the job. The two transcripts and the level scan run side by side, the final render uses GPU encoding, and the lint/layout check is opt-in (`--check`). A 1-minute phone clip now edits in about 1.5 minutes with cards and music. `REEL_SW_ENCODE=1` / `REEL_SW_RENDER=1` force software.

Sign-offs ("thanks for watching", "see you in the next one", "link in bio"...) inside the last 10 s are cut, so a reel ends on its last point.

## Publishing

`scripts/publish.mjs <work dir> --media-url <public link> [--trial] [--date <iso>] [--reviewer you@x.com]` writes `post.json` (caption and 5 hashtags from `caption.json`, the scored cover-frame time, `isAiGenerated` when the reel has AI stills, as Instagram requires) and sends the reel to Metricool for your approval through headless Claude with only the Metricool review tool allowed. Metricool needs the video as a public link (Dropbox or Google Drive links are uploaded by it), so upload the MP4 first. It never auto-posts: a reviewer approves in Metricool.

## Punch-ins, caption lines and the cover

The frame cover is `Cover.png` at the best Vision-scored time, not a fixed first blink. `cover.style: "archetypes"` builds the brand-token native-premise, verdict, interview, proof/reaction, and editorial families; `--cover-style` switches it per reel. Every chosen cover exports reel, 3:4 grid, 4:5 feed, square, and landscape crops plus `covers/manifest.json` and a phone-size `grid-preview.png`.

Punch-ins fire only on lines that carry a gold word (the claims), at least 10 s apart and at most 3 per 30 s, never under a card or a cutaway, never in the hook or the last second; each one is released at the next line start. A tight frame (the head fills more than 40% of the height) gets gentle zooms (1.07 / 1.10) instead of 1.14 / 1.22, so the chin stays off the captions.

Base framing (`framing`, on in the youtube preset): the face is sampled across the whole video and a wide shot is scaled so the face box is about 30% of the frame height (the podcast medium shot is 22-28%, punch-ins reach 32-40%), anchored on the face and slid so the face sits near the eye line; every punch-in and jump cut is relative to that base. Cards go in the empty third beside the face (never wider than 30% of the frame, at eye level), the name tag sits bottom-left, and burned captions sit at chest height under 70% width.

**Two or more people in a wide shot** (`src/group.mjs`, Oct 22 fix after the podcast test): the base frame fits everyone (scale from the span of all faces plus a shoulder margin, never past `framing.max`) instead of zooming on one face and cropping the other off; every punch-in and jump cut centres whoever is talking at that moment (`xPercent` computed per key from the speaker timeline, never showing past the footage edge; keys at scale 1 return to the group frame); the card band sits centred above the heads and captions are placed under the lowest chin at the largest punch-in. A face seen in under 25% of the sample frames is not a person. The log says `framing: 2 people at 22%, 74% across` and `speakers: n turns, k of m punch-ins and cuts aimed at the person talking`; one person keeps the single-face framing.

Two punch-in styles (`zooms.style`, `--zoom-style`): `camera` (the brand default) is the creator move from the HyperFrames camera recipe: the frame pushes in over half a second with a slight lift and tilt while the edges defocus for a beat, then returns slowly; `snap` is the hard cut-in zoom.

Cut cadence (`zooms.cadence`, `--no-cadence`; off in Greg's `pingel-brand` since 2026-10-31, on for client brands at the default pace): between the punch-ins the frame still changes every 2.5-4.5 s, the way fast talking-head edits alternate between two framings at sentence boundaries (after cutroom's jump-cut zoom). Each cut is instant, at a caption line start, between the base frame and one 8% tighter with a small sideways shift that alternates; at least 2.5 s after the last move and 1.5 s before the next punch-in, never under a still or the hook (the footage keeps moving under a card), never in the last 1.5 s. A tight frame steps 5%.

Cold open (`coldOpen`, on in the brand preset, `--cold-open` / `--no-cold-open`): with b-roll, frame 0 is the first still under the hook text for 0.6 s with a slow push while the voice starts, then a white flash on the cut to the speaker. No still, no cold open.

Sounds (`audio.sounds`, on in the brand preset, `--sounds` / `--no-sounds`): the editor's own edits get small CC0 sounds vendored in `assets/sfx` (Kenney interface packs and Remotion's whoosh and whip; sources in `assets/sfx/NOTICE.md`): a soft drop when a card lands, a whip on a word slam, a whoosh leading each camera punch-in and the cold-open flash. The marker strokes are silent (`audio.soundMarkers: true` adds a scratch per gold word; it was too chirpy). Each cue is its own track at `audio.soundsVolume` (0.3) under the voice, mixed by HyperFrames with the music ducking and the true-peak master. Jump cuts are silent. `--sfx` (ElevenLabs-generated whoosh and pop) still exists for anyone without the vendored files.

`--slams` (on in the brand preset): climax words. The strongest gold word in a stretch (a power word, a number or amount, a framework name) stamps in big in the top third as it is said, in gold Anton: it slams down from 1.6x with a three-frame impact shake, holds about a second and whips up out of frame. At most 5 per reel, 8 s apart, never under a card, a cutaway or the hook; nothing new is written, the words are the ones the captions already highlight. Saved in `plan.json` as `slams`.

`--annotate` (on in the brand preset): a hand-drawn marker on the gold word in each caption line as it is spoken: a squiggle underline for a word, a loose circle for a number or amount. The stroke draws on over 0.4 s and the word gives one small pop as the ink lands. The classic drop folder runs with `--no-slams --no-annotate` so its captions stay as they were.

Caption lines keep phrases whole: a line can't be made only of glue words ("or a") or end on one; the glue moves to the next line, which may grow one word past `wordsPerLine`.

Every reel gets three covers (`<workdir>/covers/Cover 1-3.png`, kept in the work folder), built on the real frame the way the top-performing talking-head reels in this niche are: `scripts/person.swift` scores frames across the reel (expression x3: a mouth not mid-word; light x2; sharpness x2; angle; face size) and the best one is zoomed a little around the face, darkened a touch with a vignette; headless Claude writes 10 title candidates from the transcript and scores them (specificity, charge, brevity, stakes); the top 3 that fit become the variants: 2-4 words, ALL CAPS Anton measured with the real font metrics so a line never wraps, one accent word, placed under the chin on a close-up or in the top third when the face sits low, always inside the 3:4 grid crop. Three text treatments: outline (white, thick black stroke, shadow), bar (a near-black band with gold rules) and box (the accent word on a gold or red block). No username on the cover. Upload Cover 1 when posting; `reel cover <workdir>` remakes them. `cover.enabled: false` in a preset skips it.

Research (Oct 2026): covers get a marginal share of views (most come from recommendations) but custom covers lift profile-grid taps. The covers that perform in the sales-coach lane (Sandcastles top outliers, the grids of Andy Elliott, Jeremy Miner, Matt Ryder) keep the real room, put the face big, and use 3-6 heavy caps with a thick outline or a solid bar and one accent word; cut-outs on flat designed plates are the YouTube-tool look, not what wins on Reels. The grid crops to 3:4.

B-roll remembers the last 24 scenes it drew (`~/.cache/reel-editor/broll-recent.json`) and asks Codex for something different each time.

## Studio sound, the caption word fix, preflight and text behind you

Four stages added after the Oct 2026 GitHub research (`src/studio.mjs`, `src/correct.mjs` + `src/align.mjs`, `src/preflight.mjs`, `src/behind.mjs` + `scripts/matte.swift`), all on by default where their tool exists.

**Studio sound** (`audio.studio`, `--no-studio`): the voice is denoised by DeepFilterNet3 (`deep-filter`, one Rust binary from the official release, MIT/Apache; `scripts/install-deepfilter.sh` puts it in `~/.cache/reel-editor/bin`, `REEL_DEEPFILTER=<path>` overrides, `reel doctor` shows it) on the source timeline with delay compensation, then the mix chain takes that WAV instead of the source audio: high-pass, de-click, de-ess, a phrase leveler (`speechnorm`, quiet lines come up toward the loud ones, nothing under -34 dBFS is touched so breaths and room stay down), gentle compression, a limiter and -16 LUFS. On a phone clip in a room the noise floor dropped from -59 to -68 dB and 20 s took 0.7 s. The log line says what happened; without the binary it says so once and the spectral denoiser runs.

**Caption word fix** (`transcribe.fix`, `--no-fix-words`): after the dictionary corrections, headless Claude reads the numbered transcript against the dictionary's `terms`, `phrases` and `names` and the review's disagreements and low-confidence words, and returns only edits (`{i, n, to}`): a brand term or name heard as other words, a wrong number, a homophone that makes no sense. No rephrasing, no filler removal; an edit list that would change more than 8% of the words is refused as a rewrite. Cached in `words-fixed.json`. The log names each change with its time ("ghost pianel" → "Ghost P&L" at 0:12).

**Word timing** (`transcribe.align`: `auto` | `always` | `false`, `--align` / `--no-align`): the words are re-timed against the audio by ElevenLabs forced alignment (`POST /v1/forced-alignment`, audio + text in, a start and end per word out) when the fix changed anything or the transcript came from faster-whisper, whose timings run late on short words; a Scribe transcript with no edits already lines up (tested: 215 words, 0 moved) and is left alone. The aligner's words are matched to ours by a longest common subsequence on normalized tokens, so a tokenization difference costs one word; under 80% matched or a typical shift over a second is rejected and the engine's timings stay. Cached in `words-aligned.json`; the final words go back into `words.json`.

**Preflight** (`preflight.enabled`, `preflight.strict`, `--no-preflight`): the finished file is checked before it leaves: integrated loudness -14 ±1.5 LUFS and true peak at or under -1 dBTP (ebur128 summary), loudness range, a black or static first second (blackdetect; mean frame difference over the first 2 s), silence at the start and dead air anywhere, the length against the plan, and the layout from the plan: captions over the chin, the hook over the face (not when it runs behind you), captions or CTA inside the strip Instagram covers with its caption and buttons (bottom 16.7%, right 11%). Thresholds follow the reel-qc project (MIT). `preflight.txt` and `preflight.json` sit next to `plan.json`; the watcher copies a report with anything in it into the reel folder as `check this reel.txt`. `strict: true` keeps a failing file as `<name>.failed.mp4` and stops the run; off by default so a reel always arrives.

**Text behind you** (`hook.behind`, on in the pingel-brand and pingel-runway presets, `--behind` / `--no-behind`): Apple Vision's person segmentation (`scripts/matte.swift`, accurate quality, a 35% share of the previous frame blended in so the edge does not flicker) cuts you out of every frame of the hook window; the frames become a VP9 clip with alpha (`cutout.webm`) that the composer layers over the hook in a wrap mirroring every move of the footage wrap (push-in, punch-ins, jump cuts, reframe). The hook is then placed so the top of the head covers the bottom of its last line, at most half a line (`hook.behindOverlap` caps it at 40% of the block; with three lines the whole last line used to disappear), 12% larger (`hook.behindScale`), and the captions stay on top of the cutout. No face in the hook frames, a mask under 4% or over 80% of the frame, or no Swift: the hook goes back to its normal placement and the log says why. About 12 s for a 3-second hook at 1080x1920.

## Fast pacing, clean clip edges, the render reviewer and golden frames

Five additions from the Oct 22 Codex GitHub research (eight researchers; reports and verification notes in the session that built them).

**One-take look** (Greg's `pingel-brand` since 2026-10-31, from the setup audit: his uncut reels held viewers best, 41% past 3 s against 25% for the cut-up ones): `cuts.silence: "medium"` (pauses under 0.6 s stay), no jump-cut cadence between the punch-ins, and `graphics.clearStart` / `broll.clearStart` 5, so no card or cutaway covers him in the first 5 seconds, at most 3 cards and 2 b-roll shots a reel. Client brands write their old fast pacing out (`FAST` in `src/brandkit.mjs`) instead of inheriting this.

**Fast pacing** (`--pace fast`, or `#fast` in a dropped file name; `presets/pace-fast.json`, an overlay on any look): the numbers herk-edit-kit (MIT) measured on 27 top Reels. Shots average 1.1-1.4 s and never hold past 2.8 s (the cadence cuts at a word start when no new caption line comes in time), the first cut lands at about 0.7 s inside the hook (the hook's slow push is off), the framing rotates through two tighter steps (1.08, 1.16), dead air between phrases goes down to 0.2 s while the beat after a comma or "First," (up to 0.4 s) stays (`cuts.silence: "tight"`, `cuts.beats`), captions are 1-2 words that hard-swap with no pop and appear two frames early (`captions.lead`, `captions.animation: "cut"`). The overlay carries `pacing` targets the preflight checks. The music level is left alone (the playbook puts the bed 11 dB under the voice; Greg's level is about 20 dB under).

**Clean clip edges** (`reel clips`, the default picker; `--picker legacy` is the old one; `src/moments.mjs`): after jevcut, cutawan and ripeclips (all MIT). Claude never writes a timestamp. Code numbers every sentence (`L012`) and every real start and end (before a sentence that follows a finished one, after a sentence that finishes; never a mid-sentence pause). Pass 1: Claude finds up to three moments per clip by their quotable anchor line, with the louder or faster lines (top 12% by loudness and speech rate against the recording's median, after auto-video-editor) tagged `[energy]` as a hint. Pass 2: for every moment Claude picks the opening among the labelled starts and the EARLIEST labelled ending where the thought completes. Code maps labels to times and gates the edges: an opening on a reply or back-reference ("And", "That", "Yeah", "No"), a false start ("Well-") or mid-sentence moves to the next clean opening; an ending mid-sentence, on a question or on a trail-off ("But it's...") runs on to the next whole sentence; a clip under 25 s runs on to an ending that reaches it. A clip with an edge problem left ranks 10 points lower per problem, so a clean spare beats it. `clips-picker.json` keeps Claude's raw picks and why any moment was dropped; `clips.txt` in the delivery folder says "Edges: clean start and finish" or names the problem. On the 58-minute two-person test all five clips came out with clean edges by these checks; the old picker's five clips on the same recording had none (each opened on a back-reference or mid-sentence, or ended mid-sentence).

**Pacing and caption checks** (in the preflight): from the plan, the shot count, average and longest shot, the first cut, and the longest stretch the speaker is off screen (full-frame cutaways; cards sit over the speaker). Against the `pacing` targets when the preset has them. Caption lines that flash by too fast to read are flagged (on screen under 0.3 s, or over 30 characters a second; the 17-a-second subtitle guideline is reported as a figure, since speech-synced captions read at the speaking speed). The `Pacing:` line in `preflight.txt` has the numbers.

**Render reviewer** (`src/watch.mjs`, on by default, `--no-review`, preset `review.watch: false`): headless Claude with only the Read tool looks at contact sheets of the finished file: every quarter second of the first 2.5 s, a frame just after every picture change, one every 4 s, at most about 36 frames. It is told the intended look (word-by-word reveal dims the unspoken words, slams repeat a caption word, jump cuts) and reports only what it can point at in a frame: face covered, subject cut, text error, wrong picture, collision, dead frame, plus a cold-viewer verdict for the first 3 s and where it would stop. About 20 s per reel. Findings go into `preflight.txt` (so the drop folder's `check this reel.txt`) as warnings with their times; `watch.json` keeps them. Nothing is changed automatically: video models invent faults (herk-edit-kit and agentic-video-editor both say to verify every complaint on real frames), so the reel is never re-rendered on its say-so.

**What the reviewer's first real run fixed** (on every look, not only the fast one): a card that only repeats the hook title is dropped; a quote that carries its own quote marks gets no extra ones; a long compare-card label is set smaller and wraps instead of being clipped; a recording that stops mid-word ("so go set-") ends on its last finished sentence when one is within 4 s; with fast pacing, a caption line that would flash for under 0.3 s joins the next one (`captions.minShow`; 14 flashes became 1 on the test reel). Two of its findings were intended effects (a card mid-wipe, a slam word leaving past the top edge); it is now told about both.

**Golden frames** (`npm run test:golden`, `npm run test:golden:update`; `scripts/golden.mjs`, pixelmatch and pngjs as dev dependencies): a fixed composition (the headline hook, reveal captions with a marker, a headline card, a list card, a slam and a jump cut over a formula gradient) is snapshotted at six exact times with HyperFrames' software renderer and compared at half size with the frames in `test/golden/`. Over 0.2% of pixels changed fails, after one re-capture (a footage frame still loading is a flake; a change that repeats is real). Diffs land in `test/golden/diff/` (ignored by git). Run it after touching the composer, the fonts, GSAP or HyperFrames; update the frames only when the look change is intended. About 7 s.

## The rule book (`policy/content-policy.json`)

There is one file listing what may never appear in Greg's posts:
- the Ghost P&L;
- his wife (a prospect's spouse objection is fine);
- retired framework names and keywords;
- the hiring portal;
- income claims;
- dashes.

It is read in three places:
- **The reel caption gate** (`bannedInCaption`): a reel that breaks a rule posts as a draft, with the reason.
- **The slide gate** (`reel preflight`, for Greg's brand only): each rule marked `slides: true` becomes a `copy-policy-<id>` problem. Client brands keep their own never-say lists.
- **`reel policy <caption file|text>`:** prints `policy: ok` or each broken rule, and exits 1. The content engine runs it on every caption before scheduling.

Change a rule in the file, not in code. `REEL_POLICY` points at another file.

## Publish folder (auto-posting to Instagram through Metricool)

`Desktop/Reels/Publish` (a link to `~/Reels/publish`) posts what you drop in it. Drop a finished reel folder as a drop folder delivered it (the video plus `caption.txt`), one clip's files from a Clips folder, or a loose video with a caption file of the same name (`My reel.mp4` + `My reel.txt`). The caption that posts is `caption.txt` exactly as it is in the file (edit it before dropping); an older `caption.txt` with CAPTION and HASHTAGS sections posts those two sections. Dropping is the approval. Greg's own setup: it needs his Metricool account and the hourly task, so the installer does not create it.

How it runs: the scheduled task `reel-publish` (Claude desktop app, hourly at :45, 7 AM to 8 PM Phoenix, bypass permissions) runs `scripts/publish-folder.mjs scan` and stops at once when nothing is waiting. Otherwise it takes the oldest drop, reads Metricool's schedule and best times for the next 14 days, picks the first day with no Instagram reel already scheduled (today only when its best hour is 2 h away) and the best hour on it that is at least 2 h from every other post that day, drafts and carousels included (Greg: never at the same time as other posts). One run schedules every waiting reel, one per day, opens a temporary public link to that one video (`serve`: a local server on a random path behind a Cloudflare quick tunnel, `scripts/install-cloudflared.sh` puts the official binary in `~/.cache/reel-editor/bin`; any other path returns 404), schedules the reel through the Metricool connector with the caption untouched, the first frame as the cover and Instagram's AI label when the reel has generated b-roll, then closes the link (`stop`). Metricool copies the video onto its own servers when the post is created (tested: the 80 MB file came back byte for byte from static.metricool.com), so the link is only open for that minute. The item moves to `Publish/Scheduled/` with `Scheduled.txt` (the time and the Metricool link) and a notification; a failure moves it to `Publish/Not posted/` with `Why it did not post.txt`. A Clips folder is posted one clip per day, the rest waiting in place.

The gate: a reel whose preflight failed (the hidden `.reel.json`; an older folder's `check this reel.txt` with a FAIL line counts too), or that has no caption goes into Metricool as a draft instead and the notification says why. Dropping a reel is the approval, so the render reviewer's notes do not hold it back (it also flags intended effects); they are copied into `Scheduled.txt` to look at. A video dragged in on its own finds its caption in the Desktop folder it was delivered in (same name and size): `Clip 3 - caption.txt` for a clip, `caption.txt` for a reel. The drop folders leave a hidden `.reel.json` (`.Clip 2.reel.json` per clip) next to each reel with the AI flag, the preflight result and the cover frame for this, and a hidden `.reel-features.json` for the analytics; Finder does not show them, so a finished folder looks like the reel and its caption only.

**Trial copies and TikTok (Greg 2026-10-31).** Every reel posts twice:
- **The regular reel** goes to Instagram followers and to TikTok.
- **A separate copy goes out as an Instagram Trial Reel,** shown to non-followers first. It runs on the same day at least 2 h from every other post, or the next free day.

`scan` marks it with `trialCopy`. The posting task reuses the regular post's static.metricool.com video for the copy, and `slot` takes `notBefore` for it. These reels get no trial copy:
- drafts;
- a reel already marked as a trial (`#trial` in its name, a `Publish/Trial/` subfolder, or `trial: true`);
- `#public` or `#notrial` in its name, or `trial: false`.

Only regular reels count toward one reel a day. Don't share a trial copy to followers from Instagram's 72-hour results notice: they already got the regular reel. TikTok's AI label follows the b-roll flag. `#igonly`, or a caption over TikTok's 2,200 characters, keeps a reel off TikTok, and `REEL_PUBLISH_CROSSPOST=""` turns TikTok off. The task passes `--networks`, `--trial-copy` and `--trial-planner` (or `--trial-copy-failed`) to `done`, so the receipt says what went out.

By hand: `node scripts/publish-folder.mjs scan` shows what is next; `serve`, `stop`, `done`, `fail` and `slot` are the steps the task runs. `scripts/publish.mjs` (the older review hand-off) needs a public link of your own.

### A second Publish folder that forwards to the first (Greg's MacBook Pro)

The posting task runs on one Mac only (the Mac mini), so one reel a day stays counted in one place. A second Mac gets
its own `Desktop/Reels/Publish` (a link to `~/Reels/publish`) that SENDS what is dropped in it to the posting Mac:
`scripts/publish-forward.mjs run` (LaunchAgent `com.pingel.reel-publish-forward`: on every drop plus every 2 minutes).
A loose video is bundled with its caption, `.reel.json` and check note, found from the delivered folder on THIS Mac
(the posting Mac has no delivered folders to look in), then copied into `<dest>/.incoming/<token>`, verified by
checksum and renamed to its real name only when complete, so the posting Mac's scan never sees half a reel. A name
already waiting there is never overwritten. What went is filed under `Sent to the Mini/<date>/`. Failures retry every
2 minutes, are logged in `~/Reels/publish-forward.log`, and send a Mac notification after 15 minutes.
`publish-forward.mjs scan|status` shows what is waiting and whether the Mini answers. Env: `REEL_FORWARD_HOST`,
`REEL_FORWARD_KEY`, `REEL_FORWARD_DEST` (see the file header).

## Card looks: every reel gets its own visual direction

The overlay cards change look per reel (`src/looks.mjs`). In the same Claude call that writes the cards, Claude picks one look for the whole reel from what it is about, and each card type takes that look's skin. A look is never reused within three reels (the last 20 are in `~/.cache/reel-editor/looks-recent.json`). `--look <id>` or `#look:<id>` in a dropped file name sets one; `graphics.look` in a preset fixes it for a brand. Plans saved before looks existed keep their glass cards, and the YouTube band layout stays glass.

| Look | For reels about | The cards |
| --- | --- | --- |
| `receipts` | money, pricing, revenue, a P&L | numbers arrive as a phone alert banner; lists and bars print as an itemized receipt with a torn edge; quotes type out |
| `phone` | calls, DMs, objections, leads | alert banners, a Notes-app list with check circles, a light text thread in the brand accent |
| `fieldnotes` | discipline, faith, a story | taped lined paper, Permanent Marker handwriting, marker highlights and strikes |
| `gregcard` | one conviction line | Courier Prime typed out letter by letter on black, sentence case, the label signed in the accent |
| `briefing` | leadership, systems, frameworks | editorial cream panel, DM Serif Display, a black top rule, accent blocks behind key words |
| `press` | a hard truth, a contrarian take | one-ink press sheet: halftone paper, torn bottom edge, Anton with an off-register accent ghost, stamped down |
| `shopfloor` | close rates, KPIs, standards | matte instrument panel with bolts, Courier labels, segmented meters, a status lamp that blinks twice |
| `blueprint` | a process, a pipeline, cause and effect | dark schematic grid, outlined nodes, dashed connectors, corner marks |
| `casefile` | proof, a call review, a case study | a document with a margin line, an EXHIBIT A stamp, things to stop shown as redaction bars |
| `redline` | a mistake, what not to do | no panel: bold outlined type over the video, an accent label, hand-circled key words, thick strikes |
| `glass` | anything else | the original dark glass card |

Every look draws its colors from the brand (text, accent, card background) and keeps one accent per card, so brand kits get all eleven in their own colors. The fonts the looks add (Courier Prime, Permanent Marker, DM Serif Display; SIL OFL / Apache 2.0, from github.com/google/fonts) are in `assets/fonts` and only copied into a reel that uses them. The direction came from ten Codex researchers on overlay styles (press sheet, instrument panel, schematic, case file and redline were their strongest brand-safe recommendations; branded UI clones, neon and unlicensed packs were ruled out). `node scripts/looks-preview.mjs --footage <video>` renders the same five cards in every look on one sheet.

### The look drives the whole reel

The look is not only the cards. Once Claude picks it, the same look sets the rest of the reel's design (`THEMES` and `applyTheme` in `src/looks.mjs`, applied right after the cards are planned), so two reels in a row never share a hook, a marker, a slam and a b-roll grade:

| Look | Hook (frame 0) | Gold-word marker | Slam | B-roll grade | B-roll cut | Camera |
| --- | --- | --- | --- | --- | --- | --- |
| `receipts` | typed Courier on a black block, one cursor | box | typed | bright-pop | flash | snap |
| `phone` | headline | underline | text bubble | soft-boost | blur | camera |
| `fieldnotes` | Permanent Marker | scribble | marker | vintage-wash, grain | blur | camera |
| `gregcard` | typed Courier on a black block | underline | typed | mono-fade | hard | snap |
| `briefing` | DM Serif with accent blocks | box | serif | muted-editorial, vignette | hard | camera |
| `press` | stamped down on a paper block | box | Anton with an accent ghost | mono-clean, grain | flash | snap |
| `shopfloor` | instrument panel | bracket | panel | deep-contrast | hard | snap |
| `blueprint` | headline | bracket | outline | muted-editorial | blur | camera |
| `casefile` | typed Courier on a black block | box | stamp | mono-fade, grain | hard | snap |
| `redline` | headline with the key words hand-circled | circle | redline | deep-contrast | flash | snap |
| `glass` | the preset's own hook, markers, slams, grade, cut and camera | | | | | |

Caption type, size, words per line and timing never change with the look, so captions read the same in every reel. Every hook stays fully on screen on frame 0, because frame 0 is the cover: the hooks drawn on a solid block (typed, stamp, panel) never run behind the head. They sit above it, smaller if needed, with the person cutout under the block, so a cold-open still keeps the person on the cover. `--zoom-style` and `--broll-cut` on the command line win over the look. `node scripts/themes-preview.mjs --footage <video> --still <broll.png>` renders one row per look: the hook, a caption with its marker, a slam and a graded b-roll still (on the GPU: the grades are WebGL, and the b-roll frame is captured in its own snapshot run because a multi-time snapshot skips the grade).

## Clients: edit a client's footage on this Mac, in their brand

`node scripts/client.mjs add their-brand.json` sets up a client from the same brand file a kit uses (`kit/brand-template.json`, plus an optional `cta`). Your team then drops the client's clips in `~/Desktop/Reels/Clients/<Name>/`, which has the same six drop folders as yours (Raw - Reel, with B-roll, Carousel, Clips from Long Video, Full YouTube Edit, with Runway B-roll) and a Music shortcut. Their finished reels land in that same folder. `node scripts/client.mjs list` shows the clients set up here. Re-running `add` with an edited brand file updates the client and keeps their reels. `add` also gives the client a Content Studio (`~/Reels/clients/<slug>/Content Studio`, posting off and no carousel slots until their Metricool brand is set in its `studio.json`; `--guide <brand-guide.md>` copies their guide in) with **Publish** and **Content Studio** shortcuts in their Desktop folder and its watcher, and their Music folder starts empty with a note and two clickable links to where Greg's music comes from (Epidemic Sound's music and plans; `src/music-source.mjs`): Greg's tracks are licensed to Greg, so each client brings their own. A kit's installer writes the same note and links, and a Content Studio kit adds `Desktop/Reels/Publish`.

Each client is a Reels root of its own (`~/Reels/clients/<slug>`): drop folders, work files, `watch.log`, music, look history and markers. Their brand preset, YouTube look, word list, caption voice and fonts sit next to them. `client.env` sets every setting that has a default of yours (preset, YouTube preset, word list, voice, Desktop folder, music, CTA), so nothing from `~/.zshrc` fills in for a client. None of your brand reaches a client's reel: not your colors, @handle, voice, frameworks, Greg card look, Sandcastles watchlist or CTA. A client has no CTA unless their brand file names one.

One watcher runs everything. `add` installs a small launchd agent per client (`com.pingel.reel-watch.client.<slug>`) that only wakes the shared `watch-folder.sh` when the client's folders change. Your own agent is never reinstalled. The scanner does your folders first, then each client's, under one lock, so two edits never run at the same time. Mac notifications start with the client's name. The client's reels use your ElevenLabs, Claude, Codex and Runway accounts. Publishing to a client's own Instagram is not wired yet: their reels are delivered to their folder.

## Content Studio: a client's posts, made and scheduled by themselves

For Greg's coaching clients, never for Greg: his own content engine (`~/automation/ig-content`) and his reel folders stay exactly as they are. One folder on the client's Mac makes their statics, carousels and reels and schedules them into the client's own Metricool every day. Nobody reviews the carousels or statics; the client only drops photos and clips. Every brand file, voice, photo, log, Claude login and Metricool account is the client's.

| In `~/Content Studio` (Desktop shortcut) | What it is |
| --- | --- |
| `Photos/` | or any folder named in `studio.json`: the photos posts are made from; each is used once, ever |
| `Raw Reels/` | drop a clip: it is edited in the client's look and scheduled by itself (the clip moves to `Raw Reels/Done`) |
| `Made/` | a copy of every post (slides or reel, `caption.txt`, `Scheduled.txt` with the time and Metricool link, or `Not posted.txt`), reference only |
| `brand/` | the client's `brand-guide.md` (their Brand & Messaging Guide), `voice.md`, `brand.json`, `fonts/`, plus `my-brand.json` and `dictionary.json` for reels |
| `studio.json` | photo folder, posting `slots` (default a 10:00 carousel and an 18:00 static), `daysAhead` (3), Metricool brand and connector, `hosting` route, `ai` label rules, `neverSay`, `publish.mode`, `slideColors` (`bg`, `text`, `accent`, `lines`, `cards`: slides in other colors than the reels, like cream carousels from a dark reel brand; a pale accent is darkened just enough to read as words, fills keep it) |
| `.studio/` | the kit's own state: `posts.jsonl` (the post log, latest line per post wins), `used-photos.json` (the ledger), `photo-checks.json`, work files, `studio.log` |

**The daily run** (`reel daily`, launchd `com.pingel.content-studio.daily.<folder>` at 6:07; `src/daily.mjs`). It reads the client's Metricool queue for the next `daysAhead` days and fills every slot that has no post within 2 hours (a post the client made by hand counts, reels do not; today only when the slot is 3 h away). For each: the job comes from the pillar mix in the client's guide (`src/mix.mjs`: the first table with a Pillar or Job column and a percentage, or an agent-brief "pillar ratio" line, or `mix` in studio.json; the pillar furthest under its share over 14 days, never the same twice in a row while another is behind; no mix anywhere means an even split, never Greg's jobs). Claude writes the post as JSON from the client's guide and voice only (`src/studio-copy.mjs`; no tools, or Sandcastles' hook lookups when the client has that connector), with the recent hooks to avoid; the code checks the shape, cleans the punctuation and asks once more on a bad reply. Photos (below) go on the cover and spread through the points; a slide without a photo is set as type, or gets a Codex still when the client has Codex and `ai.broll` allows it. `reel slides` renders it in the client's colors and fonts with the words placed away from the face (face high: words at the bottom; face low: words at the top; the crop aimed at the face). The slides and caption go to `Made/`, the photos into the ledger, and the post into Metricool. A post that uses a `neverSay` phrase goes in as a draft with the reason; `publish.mode: "draft"` makes every post a draft, `"off"` makes posts into `Made/` only. A post that did not reach Metricool keeps its `Made/` folder with `Not posted.txt` and is sent by the next run while its time is ahead. One run at a time (`.studio/run.lock`, shared with the reel watcher). `--dry-run` lists the open slots, `--no-publish` makes without scheduling, `--only carousel|static`, `--limit n`, `--day YYYY-MM-DD` fills that day only.

**Photos** (`reel photos`, `src/photos.mjs`). Every image in the folder (subfolders too; HEIC included) is checked once by the face finder in photo mode (`scripts/faces.swift --photo`: upright size, EXIF date and camera, screenshot flag, mean light, sharpness as the variance of the Laplacian, faces with Vision's face capture quality) and cached by size and time. Skipped with a reason: under 1000 px on the short side, a screenshot, too dark (light under 0.16), washed out (over 0.88), blurry (sharpness under 0.0012), a face that is blurry, mid-blink or turned away (capture quality under 0.35, judged only on a face at least 8% of the frame tall: a wide shot's small face always scores low), a face cut off at the edge. Calibrated on phone-style photos and the same shots darkened, washed out and blurred. Photos within 10 minutes of each other are one moment and never share a post; a moment already posted comes last. The ledger keys on the file's content (size plus a hash of the first 256 KB), so a renamed or moved photo is still spent. Claude then looks at a numbered contact sheet of the best 24 candidates (`scripts/photosheet.swift`, upright thumbnails) with only the Read tool, matches photos to slides, and lists any that must never be posted (a screenshot, a document, someone else's post, a child in swimwear, anything the guide rules out); those go into the ledger as never. Without Claude the best face takes the cover and the rest go in order. The chosen photos are exported upright at 2160 px for the render. `reel photos` (counts), `check` (every photo with its verdict), `sheet`, `pick <n>`, `use <file>` (mark as spent by hand).

**Metricool** (`src/studio-metricool.mjs`). Through the Metricool connector on the client's own claude.ai account: every call is headless Claude Code with exactly one Metricool tool allowed and everything else denied, told to call it once with the JSON the code built and return the raw result. The connector's name is found by its address in `claude mcp list` (`claude.ai Metricool Social Media Management` today, so `mcp__claude_ai_Metricool_Social_Media_Management__createScheduledPost`; the older `mcp__claude_ai_metricool__` name in `scripts/publish.mjs` no longer matches) and saved in studio.json. Dates carry the zone's own offset. Instagram's AI label (`isAiGenerated`, one flag for a whole carousel) is on whenever a picture in the post is AI-made, always; `ai.label: "always"` labels every post. Carousels can also go to LinkedIn as a PDF document, Facebook, Threads or TikTok when the brand has them (`metricool.networks`). `publish.captionPrefix` puts a line before every caption (tests use `HOLD TEST`).

**How images reach Metricool** (`src/studio-host.mjs`, `hosting.route`; the installer explains all three and the client picks). Metricool takes media as public links and copies each file to its own servers when the post is created. `tunnel` (the default): this Mac serves only the post's files at random 24-hex paths behind a Cloudflare quick tunnel (cloudflared from `scripts/install-cloudflared.sh`), anything else is a 404, and the tunnel closes as soon as the post is in Metricool. `drive`: the files are copied into a Google Drive for desktop folder the client shared once as "anyone with the link"; the link is built from the file id Drive writes on the synced file (`com.google.drivefs.item-id#S`) and checked before it is used (a private file answers with a sign-in page). `dropbox`: copied into the Dropbox folder; the share link comes from the Dropbox connector on the client's claude.ai, as a direct `raw=1` link.

**Raw Reels** (`reel studio reels`, launchd `com.pingel.content-studio.reels.<folder>` on every drop plus hourly; `src/studio-reels.mjs`). A clip settled for a minute is edited by the drop-folder job itself (`scripts/watch-reel.sh`) with the client's environment only: `brand/my-brand.json` (or plain captions, never Greg's look), their word list and caption voice, their music folder, their CTA, no Sandcastles watchlist (`REEL_CAPTION_SANDCASTLES=0` writes the caption from the transcript alone when the client has no Sandcastles), the full look with Codex b-roll only when the client has Codex. The reel goes to `Made/` and into Metricool on the first day with no reel, at Metricool's best Instagram hour between `reels.earliest` and `reels.latest` that is 2 h from every other post (`pickSlot` from the Publish folder). No caption or a failed preflight makes it a draft. **Publish** (`Content Studio/Publish`, a Desktop shortcut next to the Raw folders) is Greg's Publish folder for a client: drop a finished reel (its folder with `caption.txt`, or a loose video with a `.txt` of the same name) and the same watcher moves it into the delivered folder and schedules it as it is, without editing it again; no caption makes it a draft. `reels.trial: true` posts every reel as an Instagram Trial Reel (shown to non-followers first; graduate it by hand in Instagram), for a client who allows Trial Reels only.

**Setting a client up.** Build their kit with their brand file and their Brand & Messaging Guide: `node scripts/brand-kit.mjs their-brand.json --studio their-brand-guide.md` makes `dist/<Name> Content Studio Kit.zip` (the Brand folder now carries `brand-guide.md`, the installer is `Install Content Studio.command`, Start Here keeps its Content Studio section, which plain kits drop). On their Mac the installer runs `install.sh --brand <Brand> --studio`: the reel editor in their brand, then `scripts/studio-setup.mjs`: their photo folder (one inside Desktop, Documents, Downloads or iCloud Drive cannot be read by a background job, so it offers to copy the photos in), Claude Code installed and signed in with their own account, the Metricool connector connected on their claude.ai and their brand picked from their account (time zone and networks from it), the image route, the posting times, then studio.json, the two launchd agents and, if they say yes, the first post. Re-running keeps every setting it does not ask about, and their edited voice, guide and word list. `reel studio status` shows the settings check, the last posts and the photo pool; `reel studio agents --uninstall` turns it off. The kit's installer is downloaded from GitHub's main branch, so a kit works once this is merged.

**The sample client** (`examples/content-studio`): Jordan Example, a fictional coach for independent gym owners, with a brand, voice, ten-section-style guide (a three-pillar mix and a never-do list), seven photos drawn by Codex for the test (so `ai.label` is `always`) and a dark and a blurred copy that the check skips. Copy the folder and run `reel daily --studio <copy> --no-publish`, or fill in a test Metricool brand. On 2026-10-30 it made a static (photo matched by Claude, words under the face) and a six-slide carousel (cover, three photo slides, a checklist, a photo close) and put both into Metricool as drafts through the temporary-link route: Metricool copied all seven images onto static.metricool.com.

## Brand kits: the editor for someone else, in their own brand

`node scripts/brand-kit.mjs their-brand.json` makes `dist/<Name> Reel Editor Kit.zip` to hand to someone. Start from `kit/brand-template.json`: their name and @handle, colors (text, accent, stroke, card background), fonts (a Google Fonts family name such as "Bebas Neue" or "Montserrat ExtraBold", fetched from github.com/google/fonts and only when open-licensed, or a .ttf path), the look (hook headline | gold | box, captions reveal | pop, markers, slams, hook behind the head), their world for the b-roll, their carousel picture style, their caption voice, their terms, names and spelling fixes. A brand guide from the pingel-hq brand-guide-builder has everything this file needs.

The zip holds the double-click installer, a Start Here page with their name on it, and a `Brand` folder: `my-brand.json` (the reel look), `my-youtube.json` (the YouTube look with their name tag), `dictionary.json`, `voice.md`, `fonts/` with `FONTS.txt` naming each font's source and license. The installer sees the Brand folder, copies it to `~/.reel`, sets `REEL_PRESET`, `REEL_YOUTUBE_PRESET`, `REEL_DICTIONARY` and `REEL_CAPTION_VOICE`, and asks no look question; a re-run keeps their edited word list and voice. Their kit still needs their own ElevenLabs key and their own ChatGPT account for Codex; the Runway folder works with their own Runway key (their look, Runway clips as the b-roll), and the Publish folder is Greg's only.

Their look builds on Greg's full look (so it keeps every improvement), with every personal field replaced: colors, fonts, b-roll world, @handle, carousel style, name tag, caption voice and framework names (the tests check that nothing of Greg's is left). Fonts: the display font stands in for Anton (hooks, climax words, pop captions, cover titles), the body font for Inter (reveal captions, cards, carousels); a variable body font keeps the heavy caption weight. "My own colors" in the plain installer now clears Greg's world, handle and carousel style too. The kit's installer is downloaded from GitHub's main branch when it runs, so a kit works once the brand-kit change is merged.

## Layout and safe zones

Captions are placed from the face: just under the chin, with the block never lower than 0.76 (where the caption overlay starts to cover it) and never higher than 0.56 (Meta's safe box ends at 65%: the username, caption and audio bar cover the bottom 35%). A close-up selfie gets them under the chin at about 0.75; a wide shot gets them at the safe line. `--caption-position` overrides; without a face the preset's 0.60 is used. A 7% left and 12% right margin keeps them off the action buttons on the right. The hook goes above the head or under the chin and the cards keep to the top 54%. The CTA pill sits at 0.48. The hook is on screen at full strength from frame 0 with a slow push-in on the footage (reels that spread show text by frame 4 and motion in the first half second).

## Dictionary

`dictionary.json` has four lists:

- `terms`: phrases that always get the gold highlight (framework names, money words). Also fed to Whisper as the initial prompt so it spells them right.
- `phrases`: extra phrases that always get the gold highlight but are NOT sent to Whisper. Use this for everyday phrases (`show up`): a hint can change what Whisper hears, and it once dropped a clipped opening "Don't".
- `corrections`: fixes for how Whisper hears a term (`"ghost p and l"` becomes `Ghost P&L`).
- `candidates`: everyday business words (close, sales, pipeline, money...) that get gold at most once per clip and never on two lines in a row, so gold keeps meaning something.
- `powerWords`: single words that get highlighted when no term is in the line.
- `names`: people and companies spelled exactly (`Greg Pingel`); the caption word fix uses them with `terms` and `phrases` to correct what the engine mis-heard. No highlight, not sent to Whisper.

With `autoKeywords` on (the brand preset), lines with none of the above get an automatic pick: a number with its unit (`three minutes`), a number word, or a strong 6+ letter word. A word gets automatic gold only once per clip and never on two automatic lines in a row. `--no-auto-keywords` turns it off; `--hook-position 0.40` drops the hook to chest height for wide shots.

## Post copy (caption, hashtags, hook options)

When the clip carries no written hook (`clip__Your hook here.mov`), the drop folders run two passes: a first `reel edit --no-render` for the transcript, cards and stills, then the post copy writes three hooks strongest first (never the opening words, never a greeting), and the finished reel is edited with the first one on screen. All three stay in `post notes.txt` in the work folder; to use another, drop the clip again with that hook in the file name. The "Hook options" folder of 4-second variants is gone; `reel hooks` still renders variants by hand.

`scripts/write-caption.mjs <work dir> [out.txt]` writes the Instagram post copy for a finished reel: a 1-2 line caption in the speaker's words, 3 hashtags, and 3 hook-text options, each tied to a hook pattern Sandcastles shows winning for the reel's topic (with the example creator, views and outlier score). It runs `claude -p` with only the Sandcastles `top_hooks` and `top_formats` tools allowed, so it can't touch files or run commands. Voice comes from `REEL_CAPTION_VOICE`, else `voice/greg.md` for the brand preset, else `voice/default.md`. The drop folder runs it after every reel (`REEL_WATCH_CAPTION=0` turns it off). Needs the Claude Code CLI signed in and the Sandcastles connector added on claude.ai; without them the reel is delivered without a caption file.

## Music

`--music-dir <folder>` picks the bed from a folder of `<Mood> - Title - Artist.mp3` files by the mood of what is said: headless Claude reads the transcript and names 2-3 moods from the ones on disk (or none, for a raw confrontation), and a track is drawn inside them; files named `Signature ...` are the brand sound and weigh 3; a `Bench/` subfolder is parked. `--music-want <text>` (the drop folders' `#music:<name>`) forces the track whose name contains it; `--music <file>` is a fixed file. The bed is normalized to -16 LUFS, then plays at `--music-volume` (0.10, about 20 dB under the voice) from 0.5 s in, with a 1 s fade in, 1.5 s fade out and a swell to about double in pauses of 0.9 s or more (`--no-duck` for a flat level). `music.txt` in the work dir and the reel folder names the track. The drop folders use `~/Reels/music` (Desktop/Reels/Music; `REEL_WATCH_MUSIC`); `#nomusic` skips. The mix runs through a true-peak ceiling of -1.5 dBTP and the delivered file is normalized to -14 LUFS / -1 dBTP in two passes (`render.deliveryLoudness: false` to skip).

Research behind the defaults (Oct 2026): an active pool of 30-40 tracks with 5-8 signature ones beats a big random one, 8-10% under the voice is safer than 12% on phone speakers, Instagram turns loud uploads down toward -14 LUFS, and no mainstream editor matches music to the words.

## Graphic cards and reveal captions

The brand look is modeled on explainer reels: designed cards cut in to show what is being said, and captions that light up word by word.

`--graphics` (on in the brand preset): Claude Code, headless with no tools, reads the timed transcript and picks up to one moment per 10 seconds after the hook (at most 6) where a card makes the point land: `stat` (a number the speaker says, qualifiers kept: "Almost 8 years"), `list` (2-4 items, checked or struck through as they appear), `quote` (a paper card with one phrase highlighted), `headline` (the key line, one phrase in gold) and `steps` (2-4 connected nodes). Every word on a card comes from the speaker; the editor sets the cards in the preset colors with Inter and animates them (rise in, strike-through, highlight sweep, line draw). Two modes (`graphics.mode`): `overlay` (the default) is a compact glass panel in the top third while the footage keeps playing, the way explainer reels drop a payroll card or a checklist over the speaker; the footage slides down about 7% while a card is up so it never sits on the forehead. `full` takes the whole screen with a slow push. The voice keeps playing and the captions stay on top; nothing covers the hook, the last 1.5 seconds or the CTA. The plan is saved in `<work dir>/graphics.json` and reused while the transcript lines are the same (`--new-graphics` replans). With cards on, `--broll` adds at most 2 photos, only in the gaps at least 1.5 seconds from a card. A `stat` card counts: the number accelerates up from 0 and decelerates onto the exact value (one integer per frame, tabular figures, the words around it stay put: "Almost 8 years" counts the 8), a gold bar sweeps under it in sync (a ring fills for a percentage) and the line lands with one small pulse.

Four more card types, modeled on the HyperFrames registry: `compare` (two things set against each other: the muted left panel is the base, the accent right panel wipes over from the divider, a VS badge pops, bars fill when both sides have a number), `bars` (2-4 numbers that belong together as horizontal bars that grow in reading order with counting values, the one that matters in the accent), `message` (a text exchange the speaker reads out or acts out, as an iMessage thread: typing dots, then each bubble pops from its tail; their words only, nothing is read from Messages) and `post` (the speaker's own strongest line as a social post card under the preset's handle, the like lands a beat after the text). List rows also carry a line icon (phone, dollar, clock, people, chart, calendar, target, trophy, flag and 15 more) that draws on with the row; Claude picks it per item, or the item's words do. HyperFrames ships no icon pack and Lottie files carry their own licenses, so the icons are the editor's own stroke paths.

`--caption-style reveal` (the brand default): heavy Inter, no outline, a soft shadow; each 2-3 word phrase appears dimmed and every word lights up as it is spoken, highlights in gold. `--caption-style pop` is the earlier Anton look with the black outline.

## The whole video for YouTube

`reel youtube <recording>` (or a drop into `Raw - Full YouTube Edit`) edits a long talking-head video end to end with the `youtube` preset, built from the research in `docs/long-form-youtube.md`: 16:9 at 1920x1080, the normal cuts (silence to ~0.3 s, fillers, false starts, retakes), the promise on screen for the first 3 s, and one Claude pass over the whole transcript for the structure: chapters (0:00 first, at least 3, at least 10 s, 40 s apart) with a title card at each boundary, re-hooks near minute 3 and 6 and every 2-3 minutes after as headline cards, three title options, the description line, hashtags and a pinned comment. Everything else is the reel grammar with long-form restraint: a 112% hard punch-in when the frame has been still for 20 s (12 s in the first three minutes), cards in a lower band every 75 s or so, one 16:9 still per 75 s, keyword callouts every 45 s instead of burned-in captions (`--captions` or `#captions` in the file name burns them in; the words go to `captions.srt` either way), a lower third with the name and handle at 4 s, a music bed at -20 dB, and nothing over the last 20 s so YouTube's end screen has a clean plate. The package next to the video: `description.txt` (with the chapter block), `titles.txt`, `captions.srt`, `pinned_comment.txt`, `endscreen.json`, three clean `Thumbnail n.png` frames at 1920x1080 for text to be added, `edit.v3.json` (auto-editor's timeline, so Resolve or Premiere can take over) and `youtube.txt`, the one-page summary.

## Runway b-roll (generated video clips) and the usage ledger

`--broll-engine runway` (preset `pingel-runway`) makes literal cutaways from the spoken words. Claude ranks picks as `action` (an event that finishes) or `ambient` (a place or continuous movement). `broll.imageModel` defaults to `gen4_image` (5 credits at 720p, 8 at 1080p); `pingel-runway` uses `nano_banana_2.1` (4 at 1K, 6 at 2K). Every downloaded still is scaled and centre-cropped locally to a 720x1280 JPEG under 2 MB before animation.

Both Greg presets use `broll.videoModel` and `broll.actionVideoModel: "gen4.5"` (12 credits/s, 3 generated seconds, native audio off). The generic video default remains `gen4_turbo` (5 credits/s). `broll.lastFrame: true` generates an end still using the approved first still as a reference. Both stills get independent open-first checks, and the end check compares subject identity. An end still that fails falls back to the first frame. A failed first check gets one redraw; unavailable checks drop the shot. Accepted videos are trimmed and checked for subject, motion and safety; failed videos get one re-animation, subject to budget. Supported comparison models also include `gen4.5` (12/s, 2–10 s), `grok_imagine_1_5_lite` (3/s plus 1 start-frame credit), `gemini_omni_flash_1.1` and `wan3` (10/s).

Picks may include a short physical `sound`. With `broll.sfx: true`, Mirelo SFX 2.0 generates synchronized sound from the accepted trimmed clip (2 credits/s). Its WAV becomes a project audio track at the shot start, under the voice, at `broll.sfxVolume` (default 0.35). Failures warn and leave the shot silent. Music ducking stays as configured. Each shot has a deterministic seed reused across still, video retries and sound where supported, recorded in `broll.json`.

`pingel-brand` and `pingel-runway` use natural colour with no b-roll grade override, up to 2.5-second shots, 3-second gaps, up to 5 shots (2 with graphics) and a 300-credit working cap / 450-credit hard cap. The generic cap remains 150. Every first still, end still, video, retry and sound purchase checks the cap and account reserve (`broll.keepCredits`) before spending. Usage goes to `~/.cache/reel-editor/usage.json` and `runway usage.txt`; `reel usage` reports totals. Needs `RUNWAY_API_KEY`. Use `--new-broll` to regenerate cached shots.

Compare models without running the pipeline (the picks file is an array or `{ "picks": [...] }`, with `name`, `shows`, `scene`, `endScene`, `action`, `motion`, `sound`, `kind`):

```sh
node scripts/runway-bakeoff.mjs --picks picks.json --out ./bakeoff --stage stills --images gen4_image,nano_banana_2.1 --max-credits 260
node scripts/runway-bakeoff.mjs --picks picks.json --out ./bakeoff --stage videos --still gen4_image --videos gen4_turbo,kling3.0_standard,grok_imagine_1_5_lite --seconds 3 --last-frame --sfx --max-credits 260
```

Outputs live under `<out>/<shot>/`: model-named PNG stills (plus `.end.png`), side-by-side still sheets, `<imageModel>--<videoModel>.mp4`, optional `.sfx.wav`, and frame sheets with model rows and columns at 0, 0.75, 1.5 and 2.25 seconds. `usage.json` tracks every generation; the cap applies cumulatively across stages in that output folder and aborts cleanly before the next purchase. Each invocation adds only its new generations to the shared usage ledger.

## Long form into clips (speaker focus and split screens)

`reel clips <recording>` (or a drop into `Raw - Clips from Long Video`) turns a podcast, a live or a training into several reels the Opus Clip way. The recording is transcribed once, Claude picks up to 5 windows of 30-90 s with a hook and a score, and each window is cut out and edited with the full look. Wide footage first becomes a portrait source that follows whoever is talking: Apple Vision finds every face with its lip motion four times a second (`scripts/speakers.swift`), the faces are tracked, and the one whose mouth moves most during speech is the speaker, with the rules Cutawan and openshorts measured (lip motion on one scale shared by all faces, so a listener's fidgeting never beats the talker's words (it used to be scaled per face and the crop cut to the person who was not speaking); the winner must also clear an absolute floor and a 30% margin and keep it for 0.75 s before a switch, a 1.2 s hold, a face seen under 15% as long as the main one is dropped as a false detection, a 0.8 s median on the camera path, a dead band of a fifth of the crop width, pans of 0.5-1.4 s). A turn change is a hard cut to the other person; when two people trade lines inside one shot (two changes within 5 s, both faces in frame 90% of the time) the screen splits into two 1080x960 panels for at least 3 s. Three or more people: the crop follows the speaker, no split. ffmpeg renders the crops from one command file (`layout-cmds.txt`), `layout.json` keeps the plan, `--no-layout` keeps the plain centre cut. The single view is a crop 1.2x tighter than the full height, slid so the face sits near the eye line (a full-height crop left a seated person's face low, and the captions landed on the chin). A clip that is already portrait is used as it is. Each clip lands in `<date> Clips <n>/` as `Clip 1 - <hook>.mp4` with its cover, caption and words to check, and `clips.txt` lists the moments with their scores. `REEL_WATCH_CLIPS` sets how many (default 5).

## B-roll and carousel (Codex)

Both use the [Codex CLI](https://developers.openai.com/codex) signed in with a ChatGPT plan: `codex exec` headless, with its built-in image tool. No API key and no per-image bill, but the plan's rate limits apply.

`--broll` uses Codex to rank literal subjects from this reel and draw daylight opening frames. It shares the Runway path's spoken-word boundaries, spacing, weapon exclusions and safety rules; a client world enters the prompt only with `broll.worldInPrompt: true`, and the named thing wins. `Raw - Reel with B-roll` always selects Codex; `Raw - Reel with Runway B-roll` selects Runway for the first frame.

`pingel-brand` uses the free tier: `broll.animate: false`, `broll.library: true`, and `broll.stock: ["pexels", "pixabay"]`. For each ranked, word-timed pick, the editor tries an approved library clip, then filmed stock, then a newly drawn Codex still with a photo move. This route spends zero Runway credits, including sound. The Runway folder (`pingel-runway`) has `library: true`, `stock: []` and `animate: true`: a library fit saves generation credits; otherwise the existing Runway generation, checks, recovery and sound pipeline runs. Client presets default to `stock: []`, `library: false`, `animate: false`; opt in explicitly in their own preset (or `compat.reel.stock` / `compat.reel.library` in a brand file).

### Free stock and the moving-clip library

Set `PEXELS_API_KEY` and/or `PIXABAY_API_KEY` in the environment or `.env.local`; the drop-folder watcher also imports these export prefixes from `~/.zshrc`. Missing keys warn once per provider per reel and skip that provider. Keys are never logged. The search adapters follow the current [Pexels video API](https://www.pexels.com/api/documentation/) and [Pixabay video API](https://pixabay.com/api/docs/), including Pixabay's per-variant `thumbnail` field and `video_type=film` filter.

`stockQuery` is 2–4 plain words naming the subject and harmless action. Search tries that query, then `shows` alone; Pexels tries portrait first, then any orientation. Results are cached for 24 hours under `<REEL_CACHE or ~/.cache/reel-editor>/broll-stock`. `broll.stockMaxSearches` defaults to **6 requests total per reel**, shared across providers and picks; cache hits cost no requests. Rate-limit headers and 429 cooldowns persist to disk. A 429 defers that provider until its reset/Retry-After or a fallback hour (Pexels) / minute (Pixabay), with no immediate retry. This is bounded per-reel sourcing, not bulk downloading.

Candidates are 3–20 seconds, with portrait renditions at least 720 pixels wide or landscape renditions at least 1280 pixels wide. Claude describes a single numbered thumbnail sheet blind, then chooses a literal, safe fit or `none`, excluding human faces, text, logos and watermarks. Only the chosen video downloads. Clips are centre-cropped to 720x1280, muted and conformed to 30 fps; if a landscape subject does not survive the crop, its clip check rejects it. The existing motion/event checker inspects the full clip, chooses an in-point, and checks the exact trimmed interval. One different candidate may follow a failed clip; then Codex supplies the still fallback. Selection evidence stays under `broll/stock-*`.

`REEL_BROLL_LIBRARY` overrides the library folder; otherwise it is `<REEL_CACHE or ~/.cache/reel-editor>/broll-library`. Both enabled folders save accepted moving sources with subject words, action/scene, search query, duration, approval date, source licence or Runway task IDs, and a `usedIn` reel/date history in `index.json`. Lookup matches subject words and reruns the full and trimmed contextual clip checks; a prior approval never approves a new line. Clips used in the previous ten distinct work folders, or already used in the current one, are excluded. Library reuse retains the original licence.

Each accepted stock/library shot carries `licence` in `broll/broll.json`; `broll credits.txt` in the work folder records provider, asset ID, source page, creator and download date (or Runway task IDs). Caption files and delivery-folder contents are unchanged.

`reel carousel <work dir> [--out dir] [--slides 6]` turns a finished reel into an Instagram carousel: 1080x1350 PNGs and a `carousel.txt` with the slide text. Codex writes the slides from the transcript (a cover, the reel's points in order, a closing line) in the voice from `voice/`, and picks an image for each slide: one of the reel's b-roll stills when it fits, else a new one (at most 2 new, `carousel.newImages`; the rest are set as text cards). The words are set by the editor in Anton and Inter with one gold phrase per title, never drawn by the image model, so they are spelled right. The handle on each slide comes from `carousel.handle`. No CTA unless `REEL_WATCH_CTA` is set.

Rate limits: the first 429 from Codex pauses every Codex call from the editor for 20 minutes (saved in `~/.cache/reel-editor/codex-cooldown`, so the next drop waits too). Without stock/library sourcing, one Codex session picks and draws the b-roll stills. The free footage route plans first and draws only the needed fallback stills in later sessions; the carousel uses its own session to write and draw its new images (every session carries a large setup prompt, and many sessions back to back trip the limit). A reel never fails because of b-roll: without Codex, or while it is paused, it renders without it. Headless Codex refuses some config-default models on a ChatGPT login; the editor then retries with `gpt-5.6-sol`, or set `REEL_CODEX_MODEL`.

## Hook title and CTA

`--title-style` picks the hook look. `headline` is the brand default: the words rise in one by one on a soft dark glow (no box), one phrase in Signet Gold and slightly larger, and a short gold rule draws in under it. The gold phrase is picked like a caption keyword (a dictionary term, a number with its unit, or the strongest word); mark it yourself with asterisks: `--hook "The *10 minutes* after a bad number"`. The older looks are `gold` (all Signet Gold), `outline` (Bone with the black outline) and `box` (Bone on an Obsidian backing). The hook places itself on the brand preset: Apple Vision finds the face in the hook's frames (punch-in zoom included), and the hook goes above the head when there is room, otherwise between the chin and the captions, with the text shrunk to as little as 70% if neither gap fits. `--hook-position` overrides it (the drop folder's `#top` and `#low` tags do the same). An automatic hook (the opening sentence) hides the caption lines that repeat it while it is on screen.

`--cta "DM me"` adds the pop-up call to action for the last 3 seconds (`--cta-last 4`, or `--cta-at 10 --cta-duration 3` for a fixed window). It sits at chest level (`--cta-position 0.62`). Styles: `pill` (Obsidian text on a Signet Gold pill, default), `box` (Bone on Obsidian with a gold border), `text` (plain gold text with the caption stroke). One keyword per reel: GHOST for operator pieces, FREEDOM only on its own post.

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
| `ELEVENLABS_API_KEY` | `--sfx`, `--voiceover`, `--engine elevenlabs`, forced alignment (word timing) |
| `REEL_DEEPFILTER` | path to the `deep-filter` binary for studio sound (default `~/.cache/reel-editor/bin/deep-filter`, then PATH) |
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

Sound timing uses `src/event-clock.mjs`: `eventClock({ landAt, sfx: "slam.wav", fps }).start` aligns the file's measured peak to a visual landing on whole frames. `assets/sfx/onsets.json` records attack and peak samples for all vendored WAVs; tests remeasure the files and their hashes. Legacy and glow cue selection, order, levels and variants stay the same. Normal `plan.json` tracks keep `{id, src, start, duration, volume, track}`; only cue starts change. Generated `--sfx` files are measured locally after generation. Saved plans retain their saved audio times until cues are rebuilt.

For a finished render, run `node scripts/sync-check.mjs render.mp4 plan.json [--boxes boxes.json]`. The optional JSON maps cue IDs to `{x,y,w,h}` in canvas pixels; tight boxes should exclude the speaker. The read-only report contains audio correlation, a visual landing candidate from frame differences, and `deltaMs` (positive means audio is late). Moving footage or overlapping graphics can make the visual estimate uncertain; inspect the reported frames. No browser is used. `{audit:true}` on either cue scheduler adds `sync` details for diagnostics without changing normal plans. Frame-zero events report clipped preroll when alignment is impossible.

## Credits

Built on [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0) and GSAP (bundled `assets/vendor/gsap.min.js`, GreenSock standard license). Fonts: Anton and Inter (SIL OFL).

## Speaker reels on the Desktop

`node scripts/speaker-client.mjs add "Julee Gracey" --brand "/path/to/client/brand.json" [--slug julee-gracey] [--dry-run]` sets up `~/Reels/speaker-clients/<slug>/` and `~/Desktop/Reels/Speaker Reels/<Client Name>/`. The five numbered shortcuts lead to footage, proof, licensed music, draft review and approved finals. `START HERE.txt` explains intake and permissions; `Status.txt` shows progress and the next step. Re-running `add` preserves the manifest's sources and permissions. Greg's identity is refused in client brands.

One separate agent, `com.pingel.speaker-watch`, watches each active client's footage, proof and `work/plans/`, with a 15-minute fallback for nested drops. Files must stop changing for 10 seconds before intake runs. It calls `reel speaker init <folder> --add-new`, then `reel speaker index <folder>`; unchanged intake is cached. Saving `work/plans/<version>.json` requests `reel speaker <folder> --version <version> --draft`. Successful drafts have a private timestamp under `work/<version>/`; failed drafts retry. Missing speaker commands are logged and skipped until installed. The watcher only makes drafts; final delivery needs permissions and approval of the exact file. Nothing is posted automatically.

- `node scripts/speaker-client.mjs list` shows client status. `remove "Client Name" [--dry-run]` removes Desktop shortcuts and disables that client's watch, keeping all footage and work. Re-running `add` enables it again.
- `node scripts/speaker-status.mjs [<client folder>] [--dry-run]` reports indexed hours, transcription, permissions, proof, candidates, plans and review/delivery state. Without `--dry-run` it also refreshes existing Desktop Status files. Missing contract files mean “not yet”.
- `scripts/speaker-watch.sh [--dry-run]` runs the draft scanner by hand. Each client has an append-only `watch.log`; a shared lock expires after three hours.
- `scripts/install-speaker-watch.sh [--dry-run] [--uninstall]` rebuilds and validates the one launchd agent. A dry run prints the plist without loading it.
- `scripts/speaker-import.sh '<Dropbox shared folder link>' '<client folder>' [--include '*.mov'] [--exclude '*backup*'] [--dry-run] [--delete-zip]` downloads a folder ZIP, retries failed downloads from byte zero up to three times, lists entries and streams ZIP64 files into intake. Local ZIP paths and `file://` links work too. Include/exclude globs match archive paths or basenames, case sensitively. Testimonials, logos, press/screenshots and photos go into proof subfolders; other video/audio goes into footage. Raw camera stills and macOS junk are skipped. Existing originals are kept. Remote ZIPs stay in `work/imports/` unless `--delete-zip` is explicit; interrupted extractions leave hidden partial files for inspection.

For isolated setup/tests, set `SPEAKER_HOME` (or `HOME`), `SPEAKER_CLIENTS_ROOT`, `SPEAKER_DESKTOP_ROOT`, `SPEAKER_AGENT_DIR`, `SPEAKER_REEL`, `SPEAKER_LOCK` and `SPEAKER_LAUNCH_LOG` as needed. The agent records roots and the reel watcher's usual executable PATH. `SPEAKER_STABLE_SECONDS` (default 10) and `SPEAKER_STABLE_ATTEMPTS` (default 30) control copying checks. `SPEAKER_LAUNCHCTL` can point to a local test stub; `SPEAKER_PYTHON` and `SPEAKER_CURL` select import tools. Dry runs never create client/agent folders or download remote archives.

## Speaker reels

`reel speaker candidates <client>` finds transcript-grounded passages; `reel speaker plan <client> --version full|short|teaser` writes an editable starter. `reel speaker draft <client> --version full` compiles footage, composites client cards, renders, normalizes and checks the draft, then prints the review page. Clean video is default; `--captions` burns captions, and SRT/VTT always exist. Section music requires a manifest licence and is off under core/protected passages unless explicitly included.

Import consolidated feedback with `reel speaker comments <client> --version full changes.txt`, edit/increment the plan and rebuild. After explicit client approval, run `reel speaker approve <client> --version full --by "Client name"`, then `reel speaker deliver <client> --version full`. Delivery copies the exact approved bytes; changing the plan, brand, manifest or reviewed files requires reapproval. `reel speaker status <client>` shows progress. See [the complete operator workflow](docs/speaker-reel.md), including Desktop intake and permissions. Speaker projects never publish automatically.
