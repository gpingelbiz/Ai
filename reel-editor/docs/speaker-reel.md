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
- `fit`: contain by default; portrait and small sources sit in a client-brand frame, preserving aspect ratio. Cover is allowed only for landscape sources. Contain limits linear enlargement to 1.5× and warns when a source cannot fill the desired area. Cover warns above 1.5× and needs visual review.
- `audio`: source or mute. A source marked none/bad must use mute when selected as a timeline clip. A cutaway always supplies picture only.
- `protect: true`: no internal trimming, retiming, denoise or silence cuts. All items already stay at speed 1.0. Meaningful pauses and real reactions remain intact. Normalization and 10 ms edge fades do not rearrange the passage.
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
