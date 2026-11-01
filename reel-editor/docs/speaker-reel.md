# Client speaker reels

`reel speaker` builds a landscape client speaker reel from several real recordings, with client cards, optional captions, licensed section music, QC, review and approval. The full starter targets 210 seconds; short and teaser target 60 and 30 seconds. These are budgets, not compulsory runtimes. Complete passages stay intact, and unsupported sections are omitted with a note.

This path never touches Publish, Content Studio, Metricool or posting code. Final delivery copies the exact approved bytes.

## Operator workflow: empty folder to delivery

Run commands from the reel-editor repository with Node 22, ffmpeg and the existing transcription/Claude tools available. `node bin/reel.mjs` can replace `reel` in every command. The sandbox cannot run Chrome; production draft rendering needs the normal Mac/HyperFrames environment.

### 1. Create the client and import originals

Desktop setup creates an empty client folder, a manifest skeleton and five numbered Desktop shortcuts, and installs the separate draft watcher:

```bash
node scripts/speaker-client.mjs add "Julee Gracey" --slug julee-gracey --brand "/Users/gregpingel/Clients/Julee Gracey/brand.json"
client="$HOME/Reels/speaker-clients/julee-gracey"
```

Drop originals into `Desktop/Reels/Speaker Reels/Julee Gracey/1 Drop footage here`; testimonials, logos, press and book covers into `2 Drop proof here`; licensed tracks into `3 Music`. For a supplied archive, import without changing originals:

```bash
bash scripts/speaker-import.sh "/path/to/client-footage.zip" "$client"
# Or use the client's Dropbox shared folder link as the first argument.
reel speaker init "$client" --add-new
```

`add` already created the manifest, so use `--add-new`. For a folder created by hand instead, run `mkdir -p /path/to/client/{footage,proof,music}`, copy originals there and run `reel speaker init /path/to/client` once. Repeated discovery uses `--add-new`. It appends unlisted assets, preserves existing records and never deletes originals.

### 2. Complete identity, brand, proof and permissions

```bash
open -e "$client/speaker-manifest.json"
```

Fill in the real role line, booking route, buyer/audience/topics and the exact client brand path. Check source kinds, `audio` intent, event names and dates. Supply testimonial source ranges and the person's name/title/organization. Review guessed logo relationships. Record approved/pending/unknown rights plus evidence for each source and proof item. List each music file with its licence. Confirm the actual client display/body fonts are installed on the render Mac, or supply local font files in the brand's semantic `type.display.file` / `type.body.file` fields. No font download happens here.

Unknown/pending footage may appear only in warned drafts. Unlicensed or missing music is skipped in drafts and refused at final. Resolve permissions **before** the approval draft: changing the manifest later invalidates approval.

### 3. Index and inspect candidates

```bash
reel speaker index "$client"
reel speaker reactions "$client"
reel speaker candidates "$client"
reel speaker status "$client"
open -e "$client/work/candidates/all.json"
```

`index` caches each source transcript and probe facts. `candidates` uses Claude only to choose contiguous word ranges from that cache; code resolves timestamps. It also runs optional original-audio reaction and original-frame shot suggestions. `--source source-id` limits either analysis command. The optional detectors fail open with a log line. Shot observations live beside the index, and reaction scores remain suggestions until an operator verifies them. A reaction is never automatically moved or placed behind another line.

### 4. Create and edit the plan

```bash
reel speaker plan "$client" --version full
open -e "$client/work/plans/full.json"
reel speaker "$client" --version full --plan-only --draft
```

The starter reserves the highest-ranked complete story/teaching passage for the core, picks a separate one-liner opening, adds manifest title/booking cards, and uses an approved named video testimonial with its name overlay when it fits. Approved attributed quote proof can fill the proof section. It leaves notes for unavailable sections. Verify every passage against the original and edit ranges, order, cards, overlays, cutaways and music by hand. It never pads the runtime or shortens a story to a budget. Full budgets are opening 12, identity 13, proof 20, core 110, room/testimonial 40, close 9 and booking 6 seconds. The name overlay begins with the opening; card preflight requires six fully readable seconds for the final booking card.

`--version short` and `--version teaser` create independent plans from original source candidates. A long story cannot be truncated into either; select a shorter complete passage manually if needed. Unfilled sections stay omitted. A plan containing only cards needs usable footage before rendering a real reel.

Existing plans are never overwritten by default. `plan --replan --version full` retains the old file as `full.r<n>.json`, writes a new starter with a later revision, and excludes archives from drafting/status. Ordinary revisions should be manual edits, with `revision` incremented.

### 5. Render, listen and review

```bash
reel speaker draft "$client" --version full
open "$client/review/full-r1/index.html"
```

The printed review-page path is authoritative. Draft runs compile → compose → HyperFrames render → −14 LUFS/−1 dBTP normalization → speaker QC → review. `work/full/draft.mp4` is the finished draft; `base.mp4` is only the plain dialogue assembly. Cards are placed at the resolved absolute output times over the paused deterministic GSAP timeline. Original footage keeps its framing and real sound.

Clean (no burned speech captions) is default. `--captions`, `captions:true`, or `captions:{"enabled":true}` in the plan burns verbatim captions; SRT and VTT are always exported. The review records the actual clean/open variant. Changing caption mode renders a new reviewed file requiring approval.

The Desktop watcher already calls the equivalent flag form:

```bash
reel speaker "$client" --version full --draft
```

`--render-only` recompiles from the saved fresh index without ASR; it still renders cards, normalizes, checks and builds review. Without `--version` or `--plan`, the flag form processes every active plan in `work/plans/`. An explicit `--plan path/to/file.json` selects a manual plan. Without `--draft`, compilation requires approved source/proof rights; this is still not approval or delivery.

Watch the complete draft and listen to every join: spelling, names, source context, lip sync, reaction authenticity, branded portrait windows, music masking, readable cards and the booking destination. QC findings and rights warnings are visible in the review; failed QC cannot pass approval. The sheet labels every item, card, overlay and cutaway with source/output times.

### 6. Record one consolidated response and revise

```bash
touch "$client/review/client-comments.txt"
open -e "$client/review/client-comments.txt"
reel speaker comments "$client" --version full "$client/review/client-comments.txt"
open -e "$client/work/plans/full.json"
reel speaker draft "$client" --version full --render-only
open "$client/review/full-r2/index.html"
```

Save comments such as `FULL-i03: keep the pause` or `0:42 check this word`. Import records the combined response in `review/review.json`; it does not rewrite editorial decisions. Edit the plan yourself, increment `revision` from 1 to 2, and rebuild. Extra comment rounds are retained and flagged as extra scope. Save/close the plan before a manual render to avoid racing the watcher; the watcher serializes its own runs only.

### 7. Record the client's approval and deliver

After the client explicitly approves that exact reviewed file, all rights are approved, and QC passes:

```bash
reel speaker approve "$client" --version full --by "Julee Gracey"
reel speaker deliver "$client" --version full
reel speaker status "$client"
```

The CLI records the approval time. It never infers client approval. Approval binds resolved plan, rendered files, sidecars, manifest, brand and editable plan. A changed input or reviewed byte requires a new approval. Delivery rechecks rights/music and QC, then copies the approved video variant, SRT, VTT and real-frame poster into `final/` with checksums and `manifest.json`; it never rerenders approved bytes. Repeat planning, drafting, review and approval for each version needed.

## Client folder

```text
<client>/speaker-manifest.json
<client>/footage/...      originals, any subfolders, never modified
<client>/proof/...        real testimonials, logos, press, books
<client>/music/...        licensed tracks
<client>/work/index/      cached probe/transcript and optional observations
<client>/work/candidates/ code-resolved candidate ranges
<client>/work/plans/      editable plans and retained revisions
<client>/work/<version>/  compilation, composition, draft and QC
<client>/review/          review pages, warnings and approval state
<client>/final/           exact approved deliverables
```

Paths in JSON are relative to the client folder unless absolute. Relative paths and symlinks must stay inside that folder. Absolute paths explicitly permit external source files. No fallback client brand is selected.

## Manifest contract

`speaker-manifest.json`, schemaVersion 1:

```json
{
  "schemaVersion": 1,
  "clientId": "julee-gracey",
  "identity": {
    "name": "Julee Gracey",
    "roleLine": "Sales and on-camera confidence speaker",
    "tagline": "",
    "bookingMode": "direct",
    "bookingUrl": "https://example.com/speaking",
    "bookingText": "Book Julee for your next event",
    "email": "",
    "phone": "",
    "bureau": null
  },
  "brand": { "file": "/Users/gregpingel/Clients/Julee Gracey/brand.json" },
  "brief": {
    "buyer": "event planners",
    "audience": "women who own service businesses",
    "topics": ["..."]
  },
  "sources": [
    {
      "id": "phs25",
      "path": "footage/PHS 2025 Presentation Julee.mp4",
      "kind": "stage",
      "event": "PowerHouse Summit 2025",
      "date": "2025-09-20",
      "audio": "ok",
      "rights": "r-phs25"
    }
  ],
  "proof": [
    {
      "id": "t-sonia",
      "kind": "testimonial-video",
      "sourceId": "t-sonia-src",
      "in": 0,
      "out": 9.5,
      "attribution": { "name": "", "title": "", "org": "" },
      "relationship": "attendee",
      "text": "",
      "rights": "r-t1"
    },
    {
      "id": "logo-phs",
      "kind": "logo",
      "file": "proof/logos/phs.png",
      "relationship": "spoke-at",
      "rights": "r-phs25"
    }
  ],
  "rights": [
    { "id": "r-phs25", "status": "approved", "note": "", "evidence": "" }
  ],
  "music": [
    { "file": "music/track.mp3", "license": "Artlist, client licence" }
  ]
}
```

The example illustrates the shared contract. Add the `t-sonia-src` source and `r-t1` permission record before using its testimonial. Every source and proof entry must reference an existing rights id.

- `source.kind`: stage, podcast, webinar, interview, testimonial, broll or photo.
- `source.audio`: ok, none (no sound), or bad (picture only; never use its sound).
- `source.audioStream` is an optional ffprobe stream index. Otherwise the default audio stream, then the first stream, is selected.
- `proof.kind`: testimonial-video, quote, logo, press, book, number or award.
- Logo relationships: spoke-at, client, featured-in, available-at. Never mix these claims under one heading.
- `rights.status`: approved, pending or unknown. Drafts visibly warn on the latter two; uncleared assets cannot pass the strict compile gate.
- IDs are unique within each registry. Source paths must exist; proof source ids and rights ids must resolve. Missing files, bad enums and dangling references are errors naming the entry.

`loadManifest(folder)` returns `{ manifest, problems }`. Problems have `{ level: "error" | "warn", id, message }`. Malformed/unreadable manifests return a manifest error rather than a partial result.

### Optional client headshot

Add the client's own real photo to `identity`; the plan still uses `{ "type": "booking" }` or `{ "type": "title" }` without a photo override:

```json
{
  "headshot": "proof/headshot.jpg",
  "headshotRights": "r-headshot"
}
```

`identity.headshot` accepts a relative client path or an explicit absolute path. The file must exist, stay within the client folder when relative (including symlinks), and have a matching JPEG/JPG, PNG, HEIC or WebP image signature. Intake reports invalid paths and types as errors. The optional `headshotRights` references `manifest.rights`; a missing, unknown or pending permission is a draft warning and an error in strict compilation and final card checks. Record approved clearance before the approval draft.

Booking cards and inserted title cards copy this photo into `project/assets/speaker-cards/` with a stable content-hash filename. HEIC originals are converted locally with macOS `sips` into a JPEG in those composition assets; originals are never changed. Conversion failures identify the card and photo. Title overlays over footage do not show or require the headshot. No generated or stock portrait is used.

## Brand and truth rules

The client brand file must exist and supply a name, display font and body font. Legacy brand files use `name` and `fonts.display/body`; semantic v2 brands use `identity.name` and `type.display/body`. Visual tokens come through `resolveBrandTokens()` and `tokensCSS()`.

`speakerPreset(brand)` reuses the client settings from `youtubePreset(brand)` without inheriting the stock YouTube preset. The neutral `presets/speaker.json` contains no identity or brand-file reference. It sets 1920×1080, 30 fps, speed 1.0, contain framing, and a 1.5× enlargement limit. Cold opens, slams, zoom cadence, random looks, generated B-roll, hooks/re-hooks, end-screen reservation, sign-off trimming, silence cutting, filler removal and bad-take removal are off. Captions are available to later composition but off by default. There are no generated sound effects, stylistic grain or automatic stage white balance.

The shared safety guard rejects “Greg Pingel”, “officialgregpingel” or “pingel” in editorial strings in the manifest, plan, brand, tokens or preset. It masks only the home-directory username in a standalone absolute filesystem path, so `/Users/gregpingel/Clients/Julee Gracey/brand.json` works. Identity in copy or a filename such as `presets/pingel-brand.json` still fails.

Never generate or fake a crowd, applause, face, voice, testimonial, logo, number or quote. Every word on screen must come from the manifest, proof or the speaker's transcript. A real reaction must stay linked to its actual talk and moment. A cutaway never imports its own sound or relocates audience applause. Podcast and webinar footage must retain their honest context.

## Plan contract

Each version has its own plan at `work/plans/<version>.json`, schemaVersion 1. Full, short and teaser are assembled from originals independently. The core compiler currently accepts landscape 1920×1080 at 30 fps; vertical composition is a later integration.

```json
{
  "schemaVersion": 1,
  "clientId": "julee-gracey",
  "version": "full",
  "revision": 1,
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "items": [
    {
      "id": "i01", "kind": "clip", "sourceId": "phs25",
      "in": 512.30, "out": 530.10, "role": "opening",
      "fit": "contain", "audio": "source", "protect": false, "note": ""
    },
    {
      "id": "i02", "kind": "card", "duration": 4,
      "role": "identity", "card": { "type": "title" }
    }
  ],
  "overlays": [
    {
      "id": "o01", "at": "i05", "offset": 0.5, "duration": 4,
      "card": { "type": "testimonial-name", "proofId": "t-sonia" }
    }
  ],
  "cutaways": [
    {
      "id": "x01", "over": "i03", "offset": 4.0,
      "sourceId": "broll-signing", "in": 10.0, "out": 13.0, "fit": "cover"
    }
  ],
  "music": {
    "file": "music/track.mp3",
    "sections": [ { "from": "i01", "to": "i02", "gainDb": -20 } ]
  }
}
```

The overlay/cutaway example refers to additional items and sources; add them to a complete playable plan or omit those arrays.

Items play back to back. Overlays and cutaways add no time.

- `item.kind`: clip or card.
- `role`: opening, identity, proof, core, room, testimonial, close, booking or montage.
- `fit`: omitted values resolve to `blur` for portrait sources or sources below 60% of canvas height, otherwise `contain`. `blur` centres the sharp picture over a heavily blurred, 35% darker and slightly desaturated copy of the same frames. `contain` keeps the client-brand frame. Both preserve aspect ratio and limit foreground enlargement to 1.5×. `cover` is allowed only for landscape sources, warns above 1.5× and needs visual review. Explicit saved fits always win.
- `audio`: source or mute. A source marked none/bad must use mute when selected as a timeline clip. A cutaway always supplies picture only.
- `protect: true`: no internal trimming, retiming, denoise or silence cuts. All items already stay at speed 1.0. Meaningful pauses and real reactions remain intact. Normalization and 10 ms edge fades do not rearrange the passage.
- `limit: true` (optional, source audio only): each clip normally receives fixed gain toward −16 LUFS, stopping at −1.5 dBTP. A peaky phone recording can stay several LU quiet that way. With `limit`, the clip takes the full gain, and a delay-compensated lookahead limiter holds its sample peaks at −2 dBFS. It never compresses between peaks and never cuts silence. Use it only where the review hears a quiet clip.
- `in` and `out` are original source seconds, with `0 <= in < out`. Out cannot exceed the indexed duration. Photos can be held for the requested duration; audio-only sources use a plain brand frame.
- Overlays target `at`; cutaways target `over`. Offset is relative to the target item. Entries must fit inside the target and cutaways must not overlap. Item durations, offsets and overlay durations resolve to integer frames using nearest-frame rounding.
- Versions and item ids use safe folder/file names. Revision is a positive integer. Duplicate ids and versions are errors.

A cutaway replaces the picture over its target for its duration. The target's original sound and captions continue. It does not create another voice track.

Card objects are rendered by the separate `speaker-cards.mjs` integration. Their fields come only from the manifest identity or proof. A card never invents or rewrites text:

| Type | Fields |
| --- | --- |
| title | name, roleLine, optional tagline; defaults from manifest.identity |
| booking | mode direct/bureau, name, roleLine, text, url, optional email, phone, bureauName |
| testimonial-name | proofId; or name, title, org matching a supplied attribution |
| quote | proofId; or exact text (25 words maximum), name, optional title and org |
| logo-wall | heading, relationship, logos (3 to 6 distinct proof ids, all with the same relationship) |
| topic | exact text from identity or proof |

Direct booking shows the client's route. Bureau booking uses `identity.bureau` and suppresses direct contact. Logo headings are “Spoke at”, “Clients”, “Featured in” or “Available at”, matching the registry relationship. Quotes and attributions must match the supplied proof exactly.

### Card readability at 1920×1080

| Text role | Minimum pixels |
| --- | ---: |
| Testimonial name, body font, bold | 60 |
| Testimonial title / organization | 40 / 36 |
| Booking and inserted title name, display font | 84 |
| Booking and title role line / booking instruction | 40 / 40 |
| Booking URL or bureau name, body font, bold | 52 |
| Title tagline | 30 |
| Title overlay name | 72 |
| Topic label | 44 |
| Quote / quote attribution | 54 / 30 |
| Logo-wall heading | 54 |

Testimonials sit bottom-left inside a 5% inset on an 88% brand-surface plate with the brand radius. Topic labels use the same plate at the top-left. Text shrinks only to its minimum, then wraps; copy that cannot fit fails card checks. Authored size overrides are unsupported and below-minimum sizes receive an explicit finding.

Booking and inserted title text is vertically centred. With a headshot, text occupies the left column and the photo occupies about the right 43% of the canvas, at 80% canvas height, vertically centred, with the brand radius and top-centre cover framing. Without a photo, text uses the safe full width. Booking cards reserve six fully legible seconds; animation uses only additional hold time.

`bookingUrlDisplay()` removes `https://`, `http://`, leading `www.`, query strings, fragments and trailing slashes for display only: `https://www.site.com/speaking/?campaign=reel` displays as `site.com/speaking`. The full approved URL remains in resolved card data and review text. The route uses the brand accent when it meets 4.5:1 contrast on the card surface, otherwise the card text colour. Headshot paths and permission ids cannot serve as topic copy.

## Index and compiled output

Each source is probed for duration, dimensions, rotation, frame rates, sample aspect ratio, HDR, audio streams, channel layout and stream timing. Cache keys hash the file size, first 8 MiB and last 8 MiB, plus engine, model, language, selected stream and prompt. Renaming identical content reuses ASR; changed sampled bytes or settings invalidate it. This bounded fingerprint does not detect a same-size edit confined to the unsampled middle of a file larger than 16 MiB.

`work/index/<key>.words.json` stores raw ASR. `<key>.json` stores probe facts, corrected words, sentence lines and the audio envelope. `work/index/sources.json` connects source ids to cached records. Dictionary corrections are applied using the client's brand, never Greg's dictionary. `indexSources()` accepts injected transcription, probe and envelope implementations for offline tests.

For each version the compiler writes:

```text
work/<version>/base.mp4
work/<version>/map.json
work/<version>/words.json
work/<version>/plan.resolved.json
work/<version>/captions.srt
work/<version>/captions.vtt
work/<version>/compile/                 normalized temporary clips and dialogue stems
```

The command also saves `preset.resolved.json`, `brand.resolved.json`, `brand.css`, base `loudness.json`, the input snapshot `speaker-plan.json`, `composition.json`, `project/index.html` with copied assets, `draft.mp4`, and `qc.json`/`qc.txt`. Generated files stay inside work/ and review/; originals are read-only inputs.

`base.mp4` is 1920×1080, 30 fps CFR, square pixels, yuv420p BT.709 SDR, AAC 48 kHz stereo. Card inserts are plain brand-background frames with silence; actual card graphics are composited later. Each source is rotated, converted from HDR using the existing handling, scaled once and framed separately. PQ uses the existing macOS tone-map pass when available; a fallback emits a review warning. Source excerpts are normalized toward −16 LUFS using measured fixed gain constrained by true peak, without speech denoising. If stereo channels cancel when averaged, the louder channel is selected. Every sound join gets 10 ms fades. PCM intermediates avoid accumulated AAC priming delay. Audio is padded/trimmed to exactly 1600 samples per video frame before concatenation; stream durations are checked per item and at the end.

`map.json` lists each item with itemId, kind, sourceId, original in/out, output start/end and role. Picture-only cutaways have additional labelled map entries. `words.json` contains output-time words tagged with sourceId and itemId, sliced from original transcripts; muted clips contribute no words. Overlays and cutaways never replace dialogue words.

`plan.resolved.json` preserves source in/out and adds each item's, overlay's and cutaway's startFrame/endFrame, frames, start/end and outputStart/outputEnd in seconds, plus total frames/duration and warnings. SRT and VTT preserve transcript text with two lines of about 32 characters and a 17-character/second reading target. Fast speech is retained verbatim and warned on; captions are never fabricated to satisfy a reading rate.

The compiler uses hard picture cuts and a re-encoded ffmpeg concatenation. No automatic silence cutting, speed ramping, reaction movement or content generation runs. `base.mp4` contains dialogue only. Composition prepares the listed licensed music at −16 LUFS, then applies each section's `gainDb` as linear gain with `duckingLane()` over output words. Section endpoints name inclusive items. No sections means a −20 dB default bed on unprotected, non-core items only. Nonempty sections mean silence everywhere outside them. Explicit sections may include protected/core items; those and room/testimonial passages never swell. Other long pauses may rise after a conservative release, with frame-aligned automation and section edge fades. Overlapping music sections fail clearly. Unlicensed/missing draft tracks remain silent with a review warning; final delivery refuses them.

## Integration boundary and verification

`compileVersion(folder, plan, { manifest, index, preset, tokens, draft, encoder })` returns `{ base, workDir, map, words, resolvedPlan, plan, captions }`. `validatePlan()`, `resolvePlan()`, `planUsage()`, `timelineWords()`, `captionFiles()`, `fitGeometry()` and `safeMonoFilter()` are exported for integration and tests.

`runSpeaker()` orchestrates brand safety, indexing, validation, compilation, composition, rendering, normalization, QC and review. `composeSpeaker(workDir, resolvedPlan, { manifest, preset, tokens, captions })` writes a dedicated landscape HyperFrames project and returns its paths. It uses `speakerCardsHTML()`/`copyCardAssets()` and client tokensCSS without the general composer's stock font setup. `speakerHTML()`, `speakerMusicLane()`, `licensedMusic()`, `starterPlan()`, `writeStarterPlan()` and `parseSpeakerArgs()` are exported for offline verification. Render/normalize/QC/index/analysis dependencies can be injected; tests never call live ASR/Claude or Chrome.

Run `npm test`. The focused speaker tests use only fake ASR and tiny generated ffmpeg sources. The real compiler fixture includes landscape sine audio, portrait footage, a silent one-second card and a picture-only cutaway, and verifies dimensions, frame rate, colour tags, portrait padding and A/V duration. Chrome/HyperFrames and golden renders require a separate permitted environment. Real footage still needs an operator to verify intelligibility, lip sync, reaction context, spelling, permissions and final client approval.


## Speaker picture finishing

These are plan options; no new CLI flags or preset keys are required. Defaults apply when fields are omitted, including on saved plans. Existing explicit `fit: "contain"` choices remain flat client-brand frames; change those entries to `"blur"` to adopt the new portrait treatment.

```json
{
  "look": { "grade": "auto", "letterbox": null },
  "items": [
    { "id": "stage", "kind": "clip", "sourceId": "stage-camera", "in": 12, "out": 20, "role": "core", "stabilize": true, "push": 1 },
    { "id": "phone", "kind": "clip", "sourceId": "phone-camera", "in": 5, "out": 12, "role": "room", "fit": "blur", "look": { "grade": "off" } }
  ],
  "cutaways": [
    { "id": "detail", "over": "stage", "offset": 2, "sourceId": "detail-camera", "in": 0, "out": 3, "push": 1.06 }
  ]
}
```

Merge these fields into a complete plan with its existing schema, canvas, identity and rights records.

- `look.grade`: `"auto"` (default) or `"off"`. Auto measures each used source after rotation/SDR conversion, caches its exposure and neutral-colour statistics, and holds one correction throughout that source. Exposure correction is bounded to ±0.3 EV; neutral balance offsets stop at ±0.015 per RGB channel. Saturated/strongly coloured stages skip white balance. A shared gentle luminance S-curve and slight warmth follow. A broad skin-hue region is excluded from chromatic correction; no denoising, sharpening, grain or invented detail is added. This is conservative matching, with human colour review still required.
- Item/cutaway `look: { "grade": "off" }` bypasses both source matching and house grade, useful for original title cards. `"auto"` can also opt an entry back into a plan whose grade is off.
- Item/cutaway `stabilize: true` enables two-pass vidstab on the selected picture range with up to one second of original handles at each end. Manifest `source.handheld: true` supplies this default for every use of that source; explicit `stabilize: false` disables it. The transform uses smoothing 15 and a 3% base zoom plus adaptive edge coverage. Cache identity includes source content, range, available duration, rotation/SDR normalization and settings. A failed pass logs one line, records a review warning, and uses the original picture. Original dialogue is always extracted separately at the original source times.
- Item/cutaway `push`: 1 to 1.2. Items default to 1; cutaways longer than 1.5 seconds default to 1.06. Set 1 to disable. The smooth, deterministic move reaches its final scale on the last output frame and runs at 4× internal precision. For `contain`/`blur`, the foreground reserves the move's margin so it remains fully visible and never exceeds 1.5× source enlargement.
- `look.letterbox`: `null` (default), `2.35` or `2.39`. Bars mask the composed picture, leaving 1920×818 or 1920×804 active pixels. Cards, lower thirds and burned captions stay within that area. A composition adapter reflows the existing card boxes without shrinking type; layouts that cannot fit fail with the card ID. Check heads, hands and slides before using either crop. The resolved plan carries an informational finding shown on the review page.

Colour measurements and deterministic LUTs live in `work/index/look/<key>.look.json` and `<key>.cube`; stabilized picture-only ranges live in `work/index/look/stabilize/`. The original index/transcript JSON is unchanged. Review pairs for each used source/grade mode are written to `work/<version>/look/*-before.jpg` and `*-after.jpg`, sampled at the same original source time. `look/look.json` records the grade settings, cache keys and active box. These frames show colour correction before framing, motion and composited cards. Optional measurement/review-frame failures log once per source operation; failed measurement falls back to the shared gentle house grade.

`plan.resolved.json` records actual fits, pushes, stabilization requests, plan look and active box. `composition.json` records letterbox/active-box metadata and adjusted card review geometry. Existing `base.mp4`, map, words and sidecar contracts retain their timing and dimensions. Final composition adds the bars; the base assembly remains full 1920×1080. All source audio and cutaway L-cuts use the existing compiler clock. Hardware encoding still uses the existing VideoToolbox helper, with its existing automatic software fallback.

## Speaker motion and sound cues

The following additions are optional plan fields; there are no new CLI flags or preset options. Existing single-file music plans retain their existing mix. New cue plans use the client's brand and licensed local files only. No media, music, reactions or proof is generated.

### Multiple tracks and source offsets

Register each music file in `manifest.music` with a nonempty `license`. Effects additionally need `kind: "sfx"`. The same final licensing guard checks **all** tracks and effects; unlicensed/missing draft assets stay silent with a review warning.

```json
{
  "music": {
    "tracks": [
      { "id": "build", "file": "music/build.wav" },
      { "id": "drive", "file": "music/drive.wav" }
    ],
    "sections": [
      { "from": "opening", "to": "identity", "track": "build", "start": 18, "snap": "beats", "fadeIn": 0.5, "fadeOut": 0.75 },
      { "from": "proof", "to": "proof-end", "track": "drive", "start": 4, "gainDb": -18 }
    ]
  }
}
```

Sections name inclusive timeline items, never overlap authored spans, and are silent elsewhere. `start` is the source-track offset in seconds, independent of output time. The single-file `{file, sections}` form also accepts `start`, `fadeIn`, `fadeOut` and `snap`. Track changes at adjacent section boundaries overlap for 0.5–1.0 seconds (default 23 frames at 30 fps); the outgoing track fades away by the first word of a named protected section. There is no tail into an unnamed core or reaction. Explicit sections alone can enable music over protected/core footage.

For new cue plans, omitted `gainDb` means approximately −18 dB under speech and −6 dB without speech. An explicit `gainDb` sets the speech level, with restrained pause lifts. Ducking uses output words, anticipates speech by 150 ms and retains a 600 ms release; short gaps never swell. Protected passages do not swell. `fadeIn`/`fadeOut` are seconds; track crossfades clamp to the 0.5–1.0 second range. All cue automation uses integer output frames, and assets use exact 48 kHz sample padding.

Composition measures the actual automated music bed and dialogue over matching speech windows. `work/<version>/music-qc.json` records both stem LUFS measurements. Speech less than **8 LU** above its bed produces a visible review warning. Unavailable measurements produce one warning, never a made-up pass. The existing `speakerNormalize` and encoded-file speaker QC retain the **−14 LUFS / ≤−1 dBTP** delivery target.

### Beat timing and montage shot lists

`speakerBeats(file, {indexDir})` (default cache: `./work/index`) uses ffmpeg PCM decoding and a local energy-flux/tempo tracker in JavaScript. It needs no Python, model, API or package install. The full file SHA-256 and tracker version key `work/index/beats-v1-<hash>.json`; the JSON stores `{schemaVersion, hash, beats}`. Beat times refer to the original track before the section's `start` offset. Sparse or strongly syncopated music still needs an operator to audition the result.

A music section with `"snap":"beats"` enables picture snapping. Existing cutaway boundaries move at most **four frames** and never yield less than **0.8 seconds** of picture. Small range extensions use only indexed source handles; a snap never reads past the original file. Protected items retain their picture timing. At a join, `"snap":true` on the incoming item permits snapping only when **both neighbours are muted montage clips**; dialogue boundaries never move. The joined source ranges are revalidated by the existing compiler.

To time pictures over one unchanged dialogue item, add a montage helper:

```json
{
  "montage": [{
    "id": "opening-pictures", "over": "opening", "offset": 0, "duration": 4, "every": 2,
    "shots": [
      { "sourceId": "stage-wide-broll", "in": 2, "out": 4, "fit": "contain" },
      { "sourceId": "arrival-broll", "in": 0, "out": 2, "fit": "contain" },
      { "sourceId": "book-signing", "in": 4, "out": 6, "fit": "contain" },
      { "sourceId": "stage-angle-broll", "in": 1, "out": 3, "fit": "cover" }
    ]
  }]
}
```

Each shot must reference a manifest `broll` or `photo` source, have cleared or draft-warned rights and provide enough original duration. `every` is 1 or 2 beats; intervals below 0.8 seconds combine with the next beat. Supply one shot per resulting interval; insufficient shots or handles fail with the helper id. Extra shots remain unused. Only a music section with beat snapping can drive a montage. Helpers cannot cover protected items, and they cannot manufacture or relocate reactions.

Because the original compiler bakes pictures into `base.mp4`, optional beat changes run through `compileVersion` again during composition. It rewrites base/map/words/resolved-plan/sidecars together. This costs an additional compile pass only for beat-enabled plans. Missing beat analysis fails open once with unchanged pictures. The editable plan and original media stay untouched; inspect `plan.resolved.json` and the review for the actual picture placements.

### Transcript keywords, reveals, transitions and effects

A keyword is an overlay with one to three verbatim, ordered words from the target item's output transcript:

```json
{
  "id": "keyword-1", "at": "opening", "offset": 2.1, "duration": 1.8,
  "card": { "type": "keyword", "text": "Decide Anyway", "position": "center", "motion": "scale" }
}
```

`position` is `center` (default) or `lower-third`; `motion` is `scale` (default) or `slide`. The entry takes six frames, then the card holds until its end. The overlay window is 1.2–2.5 seconds; use at least 1.4 seconds to retain 1.2 seconds fully settled. Keywords use only the client's display font, ink, surface and radius. Unknown/reordered words, words from another item/source, testimonials and keyword starts less than 20 seconds apart fail. Plan-only runs without transcripts warn that indexed-word validation is still required; rendering refuses ungrounded text. Speaker identification within a shared microphone source still requires operator review.

Title and booking names reveal with a 0.6-second mask on the absolute GSAP timeline and then hold. Reserve at least **6.6 seconds** for a booking card to retain six fully readable seconds after its reveal; historical six-second plans remain accepted for compatibility.

`transition` on an incoming item is `cut` (default), `dip` (eight frames to the brand surface), `flash` (four frames, white at 60%) or `whip` (six frames of directional blur/slide). A reel may have at most four decorative transitions. Neither side of a decorative boundary may touch protected footage or the core; transitions never add time. Effects remain opt-in:

```json
{
  "sfx": [{
    "id": "proof-whoosh", "at": "proof", "file": "music/whoosh.wav",
    "gainDb": -24, "start": 0, "duration": 0.6
  }]
}
```

`at` names an item with a decorative incoming transition or a card/overlay entry. `start` selects the source offset; `duration` defaults to 0.6 seconds (maximum six). `gainDb` is explicit (−96 to 0). The complete audible interval must avoid every protected item, including a reaction beginning after the cue. The file must be registered as a licensed `kind:"sfx"` asset. No stock applause, reactions or automatic whooshes are inserted.

`composition.json` records individual cue files, source offsets, output times, volume points and warnings. Composition multiplies each prepared cue by its gain lane and sums them into one `assets/music-bed.wav`, which the HTML references with no renderer automation. HyperFrames 0.8 rendered some separate cue elements silent. Existing daily-reel presets, composer and golden-frame fixtures are unchanged. Run `node --test test/speaker-motion.test.mjs` for the offline motion/audio checks, then `npm test`; golden/Chrome rendering still needs the normal render environment.

## Audio quality

`reel speaker quality <folder> [--source id]` measures permitted (`audio: "ok"`) originals and every saved candidate/alternate. It also runs after `candidates`. No ASR, model download or audio repair is involved. Source rows and candidates receive `audioQuality: {score, label, metrics, version: 1}`. Passage caches live independently in `work/index/<key>.quality.json`; source scores summarize up to five spread speech windows. A normal index refresh preserves these records when the content key is unchanged.

Labels are `clean`, `usable`, `weak` and `reject` (floor contrast of at least 30, 20 and 3 dB; 2.5 score points per dB). Floor contrast (`contrastDb`) is the 90th minus the 5th percentile of 50 ms RMS windows: a board or lav feed's pauses fall to its noise floor, a phone in a noisy room never does. Julee's pilot: board feeds 43–58 dB, Audacious phone 31, Sonia 30, Madi 14, Florida phone 7–14. `gapContrastDb` (RMS during indexed words minus internal gaps of at least 250 ms, trimmed 60 ms) is kept as a diagnostic only: word gaps hold speech tails and breaths. Without measurable speech/pause spans, the visible `method` changes to `rms-percentiles-50ms`. Metrics also retain original-stream LUFS, true peak, per-channel RMS, imbalance and the percentage of samples at or above −0.1 dBFS. These are recording diagnostics, not intelligibility, isolated microphone noise or permission checks. Pause ambience can include breaths, music and genuine reactions. Thresholds are calibrated on Julee's pilot passages; inspect and audition new clients.

The starter ranks audio labels before editorial scores and excludes measured rejects. Within a candidate's alternate performances, it prefers the best label among tellings within ten **editorial score** points of the best eligible telling. Missing measurements mean unmeasured, never bad. Weak selections add a plan note. Review measures exact clip ranges, displays label/contrast, and QC warns for weak core, room or testimonial sound, naming a cleaner candidate alternate when available. Suggestions still need human context and listening review; bad-audio sources never enter the mix and reactions never move.

An optional injected `scoreDnsmos(file, {start, end, audioStream})` may return `{sig, bak, ovrl}` (1–5). It defaults to null, is stored separately in `metrics.dnsmos`, and does not override signal scores. Give the adapter a `.version` containing its model hash and implementation version for cache invalidation. A local implementation would need ONNX Runtime (e.g. `onnxruntime-node`), Microsoft's DNSMOS P.835 `sig_bak_ovr.onnx`, and verified code/model licences and attribution; none is installed or downloaded by this command.
