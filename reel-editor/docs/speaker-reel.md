# Client speaker reels

`reel speaker` assembles a landscape speaker reel from several real recordings. Event planners and speaker bureaus watch it to assess a speaker. The usual full version is 3 to 3.5 minutes. The operator chooses the excerpts in an editable plan; the compiler never invents dialogue or automatically picks clips.

This is a separate path from `reel edit`, `clips`, and `youtube`. It never touches Publish, Content Studio, Metricool, or posting code. Compilation creates working material. Client approval and final delivery belong to the review/delivery integration.

## Client folder

```text
<client>/speaker-manifest.json
<client>/footage/...      any subfolders; original files never modified
<client>/proof/...        testimonial videos, screenshots, logos, press, book covers
<client>/music/...        licensed tracks only
<client>/work/            generated: index/, candidates/, plans/, <version>/
<client>/review/          generated review pages and warnings
<client>/final/           approved deliverables only
```

Paths in JSON are relative to the client folder unless absolute. Relative paths and symlinks must stay inside that folder. Absolute paths explicitly permit external source files. The command never searches for another client's brand or silently picks a backup.

## Commands

```bash
reel speaker init /path/to/client
reel speaker init /path/to/client --add-new
reel speaker index /path/to/client
reel speaker /path/to/client --plan-only --draft
reel speaker /path/to/client --version full --draft
reel speaker /path/to/client --plan work/plans/full.json --draft
reel speaker /path/to/client --render-only --version full --draft
```

`init` recursively lists video, audio and image files under footage/ and proof/. It guesses kinds from file and folder names and creates unknown rights records. Images under proof/ become logo, press or book records; testimonial videos also get a source record. Review every guess, then fill in identity, brand, attribution, ranges and permissions. Initialization refuses to overwrite an existing manifest.

`init --add-new` appends only unlisted files, with `new: true` and unknown rights. It prints the number of files added, preserves existing entries exactly, and never removes an entry when a file disappears. `addNewFiles(folder, manifest)` is the watcher's non-writing hook; it returns `{ manifest, added }` without changing its input.

`index` probes every source. Sources with audio `ok` are transcribed once. Optional `--engine`, `--model` and `--language` select the existing transcription engine; defaults are auto, large-v3-turbo and en. No new service or package is installed. Audio marked `none` or `bad` is never transcribed.

Without `--version` or `--plan`, the main command compiles all JSON plans in `work/plans/`, sorted by name. `--version full` selects `work/plans/full.json`. `--plan` names an explicit plan, relative to the client folder or absolute. Manual plans are never overwritten. Missing plans produce an error explaining where to put them.

`--plan-only` probes and validates, then prints item count, roles, runtime, used sources/proof and rights warnings. It makes no transcription or render calls. `--render-only` requires a saved source index, checks source fingerprints and recompiles without transcription. It refuses stale or missing indexes.

`--draft` permits pending and unknown permissions, retaining warnings in the resolved plan and `review/<version>.warnings.json` and `.txt`. Without `--draft`, every used source and proof item must have approved rights. Neither mode is client approval or final delivery.

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

## Brand and truth rules

The client brand file must exist and supply a name, display font and body font. Legacy brand files use `name` and `fonts.display/body`; semantic v2 brands use `identity.name` and `type.display/body`. Visual tokens come through `resolveBrandTokens()` and `tokensCSS()`.

`speakerPreset(brand)` reuses the client settings from `youtubePreset(brand)` without inheriting the stock YouTube preset. The neutral `presets/speaker.json` contains no identity or brand-file reference. It sets 1920×1080, 30 fps, speed 1.0, contain framing, and a 1.5× enlargement limit. Cold opens, slams, zoom cadence, random looks, generated B-roll, hooks/re-hooks, end-screen reservation, sign-off trimming, silence cutting, filler removal and bad-take removal are off. Captions are available to later composition but off by default. There are no generated sound effects, stylistic grain or automatic stage white balance.

The safety guard rejects any string value containing “Greg Pingel”, “officialgregpingel” or “pingel”, case-insensitively, in the manifest, plan, brand, resolved tokens or preset. This literal guard also rejects filesystem paths containing those strings: the example's absolute brand path must be replaced with a safe relative path such as `brand.json`, pointing to the client's own brand, before running. No path exception is silently made.

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

The command also saves `preset.resolved.json`, `brand.resolved.json`, `brand.css` and `loudness.json`. Generated files stay inside work/ and review/; originals are read-only inputs.

`base.mp4` is 1920×1080, 30 fps CFR, square pixels, yuv420p BT.709 SDR, AAC 48 kHz stereo. Card inserts are plain brand-background frames with silence; actual card graphics are composited later. Each source is rotated, converted from HDR using the existing handling, scaled once and framed separately. PQ uses the existing macOS tone-map pass when available; a fallback emits a review warning. Source excerpts are normalized toward −16 LUFS using measured fixed gain constrained by true peak, without speech denoising. If stereo channels cancel when averaged, the louder channel is selected. Every sound join gets 10 ms fades. PCM intermediates avoid accumulated AAC priming delay. Audio is padded/trimmed to exactly 1600 samples per video frame before concatenation; stream durations are checked per item and at the end.

`map.json` lists each item with itemId, kind, sourceId, original in/out, output start/end and role. Picture-only cutaways have additional labelled map entries. `words.json` contains output-time words tagged with sourceId and itemId, sliced from original transcripts; muted clips contribute no words. Overlays and cutaways never replace dialogue words.

`plan.resolved.json` preserves source in/out and adds each item's, overlay's and cutaway's startFrame/endFrame, frames, start/end and outputStart/outputEnd in seconds, plus total frames/duration and warnings. SRT and VTT preserve transcript text with two lines of about 32 characters and a 17-character/second reading target. Fast speech is retained verbatim and warned on; captions are never fabricated to satisfy a reading rate.

The compiler uses hard picture cuts and a re-encoded ffmpeg concatenation. No automatic silence cutting, speed ramping, reaction movement or content generation runs. Music sections must reference a licensed manifest track; they are preserved for composition. `base.mp4` contains dialogue only.

## Integration boundary and verification

`compileVersion(folder, plan, { manifest, index, preset, tokens, draft, encoder })` returns `{ base, workDir, map, words, resolvedPlan, plan, captions }`. `validatePlan()`, `resolvePlan()`, `planUsage()`, `timelineWords()`, `captionFiles()`, `fitGeometry()` and `safeMonoFilter()` are exported for integration and tests.

`runSpeaker()` orchestrates intake, brand safety, indexing, validation and compilation. Its injected `compose` hook receives `(workDir, resolvedPlan, { preset, tokens })`. The exported `composeSpeaker()` currently returns `{ base }`; the integrator supplies actual card HTML, music, caption burning, HyperFrames rendering, review and final QC. Raw base files are never presented as approved deliverables. No browser rendering is needed for the compiler tests.

Run `npm test`. The focused speaker tests use only fake ASR and tiny generated ffmpeg sources. The real compiler fixture includes landscape sine audio, portrait footage, a silent one-second card and a picture-only cutaway, and verifies dimensions, frame rate, colour tags, portrait padding and A/V duration. Chrome/HyperFrames and golden renders require a separate permitted environment. Real footage still needs an operator to verify intelligibility, lip sync, reaction context, spelling, permissions and final client approval.
