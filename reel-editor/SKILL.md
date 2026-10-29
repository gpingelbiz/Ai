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
node scripts/write-caption.mjs videos/<name> "<where the reel is>/caption.txt"   # the post caption only; hook ideas go to videos/<name>/post notes.txt
```

It runs Claude Code headless with only the Sandcastles hook and format lookups allowed, in the voice from `voice/greg.md`. No CTA unless `REEL_WATCH_CTA` is set. The drop folder does this on its own after every reel.

## Look

`--broll-engine runway` / preset `pingel-runway` / drop folder `Raw - Reel with Runway B-roll` make the b-roll as Runway video clips (src/runway.mjs, src/broll-runway.mjs; usage ledger in src/usage.mjs, `reel usage`). `reel youtube <recording>` and the `Raw - Full YouTube Edit` drop folder edit a whole long video for YouTube (presets/youtube.json, src/chapters.mjs, src/youtube.mjs; spec in docs/long-form-youtube.md). `reel clips <recording>` and the `Raw - Clips from Long Video` drop folder cut a long recording into reels with the full look, the crop following whoever is talking and a split screen when two people trade lines (`src/speakers.mjs`). The drop folders split the looks: `Raw - Reel` is the classic look (`--no-graphics --caption-style pop --no-slams --no-annotate`), `Raw - Reel with B-roll` is the full look (cards with count-up stats, compare / bars / message / post cards and list icons, graded b-roll with an optional `--broll-cut flash|blur`, camera punch-ins with a jump-cut cadence between them, a cold open on the first still, climax-word slams, hand-drawn markers on the gold words, and CC0 sounds on the edits; `--no-cadence`, `--no-cold-open`, `--no-sounds` turn each off). By hand, the brand preset cuts in graphic cards (`--graphics`: stats, checklists, highlighted quotes, headlines, step diagrams, written by headless Claude from the transcript) and uses word-by-word reveal captions (`--caption-style reveal`). Read `graphics.json` after an edit and check every card says only what Greg said (numbers with their qualifiers). `--no-graphics` / `--caption-style pop` give the earlier look.

Every reel also goes through four quality stages (README "Studio sound, the caption word fix, preflight and text behind you"): studio sound (`src/studio.mjs`: DeepFilterNet3 denoise via the `deep-filter` binary from `scripts/install-deepfilter.sh`, then de-click, de-ess, phrase leveler, -16 LUFS; `--no-studio`; the log line says whether the binary ran), the caption word fix (`src/correct.mjs`: headless Claude corrects only mis-heard dictionary `terms` / `phrases` / `names`, numbers and homophones, text only, refused when it would change over 8% of the words; `--no-fix-words`) followed by ElevenLabs forced alignment when the text changed or the words came from faster-whisper (`src/align.mjs`; `--align` / `--no-align`), the preflight on the finished file (`src/preflight.mjs`: loudness, true peak, black or static open, silence, length, captions over the chin, hook over the face, Instagram safe strip; `preflight.txt` next to `plan.json`, copied to the reel folder as `check this reel.txt` only when something is flagged; `--no-preflight`; never blocks delivery unless `preflight.strict`), and the hook behind the speaker (`src/behind.mjs` + `scripts/matte.swift`: Apple Vision person cutout as a VP9-alpha clip layered over the hook in a wrap that mirrors the footage moves; on in `pingel-brand` and `pingel-runway`, off in the classic `Raw - Reel` folder; `--behind` / `--no-behind`). `--pace fast` (or `#fast` in a dropped file name) adds the measured short-form pacing (`presets/pace-fast.json`). `reel clips` picks moments with labelled clean edges (`src/moments.mjs`; `clips-picker.json` has the raw picks, `--picker legacy` the old picker). Every render is also watched by Claude from frames (`src/watch.mjs`, `--no-review`), and its findings land in `preflight.txt` with times; verify each on the real frame before acting, it never changes the reel. `npm run test:golden` checks six fixed frames after any change to the composer. When a reel looks or sounds off, read the `[reel]` lines for `studio sound:`, `caption fix:`, `word timing:`, `hook behind you:`, `watched:` and `preflight:` first.

## Test look: pingel-v2

`--preset pingel-v2` (or `#v2` in a dropped file name; never on a client's reel or in the Runway folder) is the test look from the Oct 28 design teardown of 36 top niche reels (`~/Reels/research/design-teardown/DESIGN_SPEC.md`): sentence-case Inter captions at 65% that show the whole phrase and swap (`captions.dimFuture: false`, `animation: cut`), gold only on dictionary terms, a smaller hook (85 px, up to 12 words) in front of the speaker, base framing on (face 20% tall, centred 38% down), no cadence jump cuts, no cold open, less b-roll. Same brand colours. Judge it against the default look on at least 10 reels (3-second view rate, average watch). The hook in front of the speaker is measured in the page and moved up (then shrunk) so it never reaches the head.

## Add-ons: cutouts, b-roll layouts, motion, icon pops

On in `pingel-brand`, so `pingel-v2`, `pingel-runway` and client brand kits (which build on it) get them too, drawn in their own colours; a calm brand (`look.pace: "calm"`) keeps plain slams, no icons and no bumps (`CALM` in `src/brandkit.mjs`). Off in `_defaults`. Each logs one `[reel]` line saying what it placed or why it skipped.
- Pop-out slam (`slams.popout`, `src/cutouts.mjs`): the reel's strongest slam word gets a Vision cutout of its window; the room behind Greg dims and blurs with an accent glow, Greg gets a thin outline, and the word sits behind his head. `scripts/matte.swift --grid` writes an occupancy grid so the word is placed where the head covers at most `maxCovered` (6%) of it, else above the head. `max: 1` per reel.
- B-roll layouts (`broll.layout`, `src/layouts.mjs`): `full` (the old cutaway), `window` (picture in picture beside the head, or above it when the head is centred), `split` (b-roll top half, Greg bottom half), `cutout` (Greg cut out over the b-roll), `mix` (window, cutout, split in turn; what does not fit becomes the cutout). Greg's preset uses `mix`, so a b-roll reel keeps his face on screen.
- Motion (`motion.impact`, `motion.drift`, `src/motion.mjs`): a 2+4-frame bump on the footage when a card or slam lands, and a slow 3% push on stretches of 6 s or more with no punch-in or cut. `--broll-cut whip` (not on by default; each card look picks its own cut) slides into and out of b-roll with a horizontal blur and a whoosh.
- Icon pops (`icons`, `src/icons.mjs`, Lucide icons in `assets/icons`, ISC): a gold disc with an icon beside the head on the word Greg says (money, calls, texts, minutes, booked, closer, jail, family, Zoom and more in `ICON_MAP`), at most 4 per reel, 6 s apart, never on a card, slam, cutaway or the hook.

## Card looks

Cards take a per-reel look picked by Claude from the topic (`src/looks.mjs`: receipts, phone, fieldnotes, gregcard, briefing, press, shopfloor, blueprint, casefile, redline, glass), never one of the last three; `--look <id>` / `#look:<id>` sets it. `node scripts/looks-preview.mjs --footage <video>` shows them all. The look also sets the hook treatment, the gold-word marker, the slam style, the b-roll grade and cut, and the camera move (`THEMES` / `applyTheme`; glass keeps the preset's own); captions never change, and `--zoom-style` / `--broll-cut` win. `node scripts/themes-preview.mjs --footage <video> --still <broll.png>` shows every look's whole theme.

Brand looks (`src/brandlooks.mjs`, from the women-coach reel research in Julee Gracey's notes): `atelier` (cream editorial card, hairline frame, serif in sentence case, italic keyword on an accent band), `note` (Instagram-style white line boxes that pop on, the keyword in an accent box) and `serifonlife` (the serif straight on the video). Calm motion, hard cuts, the accent only as a fill or a line, the brand's own fonts ("Look Serif" / "Look Sans", plus `fonts/DisplayItalic.ttf`, which `client.mjs` and `brand-kit.mjs` fetch). They are opt-in: a brand file's `looks.only` lists the looks its reels may use, and Greg's presets never get them. `looks-preview.mjs --preset <theirs> --cards <their five cards.json>` shows only the looks a preset can use. A preset on the brand looks also gets the quiet house pieces: the phone look's labels in ink with serif headings, and the name tag as a serif credit. `look.captions: "quiet"` gives their captions the body font at 600, no outline, the keyword in an accent box. `#hookreel` in a file name (or `--hook-seconds reel`) keeps the hook up for the whole reel: one-liners, and the title strip on podcast and stage clips.

## Clients

`node scripts/client.mjs add their-brand.json` sets up a client edited on this Mac: drop folders in `~/Desktop/Reels/Clients/<Name>/`, finished reels there too, everything in the client's brand (`src/clients.mjs`, `client.env` per client, scanned by the same `watch-folder.sh` under one lock). The Greg card look, Greg's Sandcastles watchlist and his CTA never reach a client. `client.mjs list` shows them.

## Brand kits

`node scripts/brand-kit.mjs <brand.json>` builds `dist/<Name> Reel Editor Kit.zip` with their look, fonts, words and voice built in (template `kit/brand-template.json`; fill it from their Brand & Messaging Guide). Never hand anyone a kit in Greg's look, and never edit someone else's footage in pingel-brand: client work uses the client's kit.

Per-brand options in the brand file's `look` (left out = Greg's behaviour): `hookCase` / `captionCase` `upper | sentence`, `hookSeconds` (seconds, or `"reel"` for one-line reels), `pace` `fast | calm` (calm: gentler silence cuts, a punch-in at most every 16 s, no jump cuts, no cold open) and `coldOpen`. A brand display font also replaces DM Serif Display in the briefing look and the serif hook. A client's Runway reel gets the pingel-runway timing (4-second clips, 6-second gaps) under their own look. After changing a client's brand.json, re-run `node scripts/client.mjs add <brand.json> --no-agent` so their preset updates without restarting their watcher.

The shared schema is in `docs/brand-tokens.md`; Greg's v2 source is `brands/pingel.json`. Inspect what any renderer receives with `reel brand [preset-or-brand.json]`, emit its CSS variables with `--css`, or list validation problems with `--check`. Old `kit/brand-template.json` files are upgraded in memory, so existing client kits keep working.

## Publish

`Desktop/Reels/Publish` -> `~/Reels/publish`: whatever Greg drops there posts to Instagram through Metricool, one reel a day at the best time, via the scheduled task `reel-publish` (hourly :45) and `scripts/publish-folder.mjs` (scan, slot, serve/stop a Cloudflare quick-tunnel link, done/fail). The caption posts exactly as written in caption.txt. A reel with a failed check, an obvious reviewer finding or no caption becomes a Metricool draft. Never schedule from anywhere else, never edit the caption, never use the review tool.

## Cover

`reel cover <workdir>` builds the brand-token cover archetypes from Vision-scored real frames and exports reel, 3:4 grid, 4:5 feed, square, and landscape PNGs. `covers/manifest.json` records the chosen frame time and `grid-preview.png` shows it at phone-tile size beside recent covers. Proof/reaction is eligible only when the plan already has proof content; every other word comes from the hook or transcript. Tell Greg to upload Cover 1.

## Long recordings and hook tests

`reel clips <long video> --count 5` turns a live or training into scored reels (clips.json); `reel hooks <workdir> "A" "B"` renders the first 4 s per hook for a pick. Landscape sources are reframed to follow the face automatically. `scripts/publish.mjs <workdir> --media-url <link> --reviewer <email>` sends a reel to Metricool for Greg's approval (never auto-posts); reels with AI stills are flagged isAiGenerated.

## Music

Licensed tracks live in `~/Reels/music` (Desktop/Reels/Music). For a chat edit pass one with `--music`; the drop folders pick by mood and note the track in the work folder's `music.txt`. Never add music from anywhere else.

## B-roll and carousel

`--broll` on `reel edit` adds 1-3 Codex stills after the hook (no faces, no readable text); `reel carousel videos/<name> --out "<reel folder>/Carousel"` makes the IG carousel from the finished reel, reusing those stills. Both need the Codex CLI signed in and stop for 20 minutes after a rate limit. Check every still before posting: describe what is in it, and never present an AI image as real footage of Greg, a client or a real event.

The carousel writer can use checklist, compare, postcard and documentary-story families when the transcript genuinely supplies that structure. `--no-families` keeps the established photo/text composition for a reel; `--families` turns the family choice back on. Untyped saved slides always stay on the established renderer.

For scheduled carousels and statics, `reel slides <spec.json> [--brand brands/x.json] [--out <dir>]` accepts the content engine's existing `out_dir` plus `slides[]` contract and prints one PNG path per line. It supports the legacy photo, photosplit, phototop, splittop, cover, body, cta, static and static-light kinds, plus checklist, compare, postcard, notes, story and evidence. `*phrase*` uses the brand accent. `reel slides --sample --out slides-samples` renders every kind for both `brands/pingel.json` and the calm fixture; review those samples on a Mac with Chrome before changing the scheduled content engine over.

## Deliver

Put each finished reel in its own folder under `~/Desktop/Reels`: `<YYYY-MM-DD> Reel <n>`, numbered through the day (the drop folder keeps the count in `~/Reels/videos/reel-count-<date>`; bump it when you add one by hand). Inside: the MP4 named after its hook and `caption.txt` (the post caption from what the reel says, hashtags at the end), nothing else (Greg 2026-10-29); the hidden `.reel.json` / `.reel-features.json` stay for Publish and the analytics. The cover, b-roll stills, music pick, review.txt, preflight.txt and post notes.txt (hook ideas) stay in `~/Reels/videos/<name>`. A b-roll reel's folder is `<YYYY-MM-DD> Reel <n> with B-roll`; a carousel goes in `<YYYY-MM-DD> Carousel <n>` (count in `carousel-count-<date>`). The drop folders do the same: Desktop/Reels has `Raw - Reel`, `Raw - Reel with B-roll` and `Raw - Carousel`, and the folder a clip is dropped into decides which of the three it gets.


Give Greg the render path, the before/after duration, and anything that looked off (a mis-heard word, a caption on the face, a weak auto hook). Offer thumbnail-agent as the optional next step.
