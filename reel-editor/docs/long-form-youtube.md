# Long-form YouTube: what the research says and what the editor does

Four research passes on 2026-10-22 (editing craft, open-source tools, YouTube specs, pro workflow and AI tools). Numbers are kept with their sources; conventions are marked as such.

## The rules that matter (measured where possible)

| Rule | Number | Source |
| --- | --- | --- |
| The first 30 s is the only interval YouTube measures as "Intro" | target >= 60% still watching at 0:30; typical curve 95% -> 65% | YouTube Help 9314415, vidIQ |
| Cold open, no branded intro, the promise inside 15 s | logo sting (if any) after 5-10 s, <= 5 s | 1of10, vidIQ (Creator Playbook) |
| Average percentage viewed benchmarks | 5-15 min: median 30%, top quartile 41%+; 15-60 min: 26% / 33%+ | AIR, 21,755 videos, 2025 |
| Re-hooks | planned moments near 3:00 and 6:00, then every 2-3 min; endings abrupt, never signalled | MrBeast production memo, AIR, Ed Lawrence |
| Visual change cadence for 25+ business viewers | every 10-20 s in minutes 0-3, then every 20-40 s, only on meaning; a static head past ~40 s flattens retention; over-editing lowers retention for this audience | AIR 100-channel analysis |
| Cuts per minute | talking-head lesson ~6.5/min; entertainment 10-15/min; <= 2/min reads slow | Umbrella Creators counts |
| Punch-in | 110-115%, hard cut in and out, subject within ~10% of its prior position | FireCut, AIR |
| Silence | cut gaps >= 0.5 s down to ~0.3 s; one deliberate ~1 s beat before a new idea; never cut inside a word | AutoCut/Timebolt defaults, AIR |
| B-roll | only as evidence, a new section, or a resolved setup; >= 3 s; own footage over stock; the hours go here (8 of 30 on an Abdaal video) | AIR, Adobe/Abdaal interview |
| Music | calm sections -20 to -25 dB under the voice; switch at story shifts; drop before a reveal | AIR |
| Captions | no data favours burned-in full captions for long-form; keyword/number callouts instead, full captions in the CC track | craft report; Hormozi still burns word captions (convention) |
| Chapters | description timestamps, 00:00 first, >= 3, each >= 10 s, ascending | YouTube Help 9884579 |
| End screen | last 5-20 s, video >= 25 s, <= 4 elements; one recommendation, not four | YouTube Help 6388789, AIR |
| Delivery | MP4 fast-start, H.264 High, BT.709, 1080p 8 Mbps (12 at 50/60), 2160p 35-45 Mbps, AAC 48 kHz 384 kbps, -14 LUFS / -1 dBTP | YouTube Help 1722171 |
| Thumbnail | 16:9, 1920x1080 or 3840x2160, < 2 MB; face ~1/3 of frame in 69% of breakouts, <= 4 words, high contrast, <= 3 elements | YouTube Help 72431, vidIQ 500-thumbnail study (June 2026), Paddy Galloway |
| Title / description | title <= 100 chars (key words first), description <= 5,000, 3 hashtags shown | YouTube Help 57404, 6390658 |
| Upload API | videos.insert: own bucket of 100/day; thumbnails.set 50 units, captions.insert 400; publishAt only on private | developers.google.com/youtube/v3 |

## What the tools reviewed get wrong (the tells)

Cuts between words, a zoom on every cut, captions as noise, stock b-roll that shows nothing, one looping track, a sound on every pop. The pro counter-rules: clarity over cut count, change on meaning, restraint for a 25+ audience, b-roll only when it carries information.

## What the editor does for a whole video (`reel youtube`, drop folder `Raw - Full YouTube Edit`)

1. One transcript (Scribe), the normal cuts (silence to ~0.3 s, fillers, false starts), plus retake collapse: a sentence said twice inside 30 s keeps the last take.
2. Claude reads the sentence-timed transcript once and returns the structure: the promise (hook, on screen in the first 3 s), chapters (>= 3, >= 10 s, keyworded titles) with a title card at each boundary, re-hook lines near 3:00 and 6:00 and every 2-3 min after, the sparse card moments (one per 60-90 s), the b-roll slots (evidence only, 4 s), three title options, the description hook line and a pinned comment.
3. Visual cadence on meaning: a 112% hard punch-in on a sentence start when the frame has been still for 20 s (10-20 s in the first three minutes), cards in a lower band that leaves the face alone, keyword and number callouts instead of burned-in captions (captions are off by default and go to the CC track; `--captions` burns them in), the cold open on the first still, one lower third with the name and handle in the first chapter.
4. Sound: the voice chain, one mood-picked bed at -20 dB under the voice, swapped at the middle chapter, sounds only on cards and callouts.
5. The ending: the sign-off is trimmed, the last 20 s carry no overlays (end-screen-safe), and the video ends on the last line, no fade.
6. Delivery: 1920x1080 (or source 4K) H.264 at YouTube's bitrate, -14 LUFS / -1 dBTP, `captions.srt`, `description.txt` with the chapter block, `titles.txt`, `thumbnails/` (three clean best frames at 1920x1080, face about a third of the frame, for text to be added), `endscreen.json`, `pinned_comment.txt`, and `edit.v3.json` (auto-editor's timeline schema) so a human can finish in Resolve or Premiere.

Left out of v1 on purpose: multicam switching (no second camera yet), screen-share picture-in-picture, automatic upload (the API is ready; it needs a Google Cloud project on Greg's channel and an OAuth consent), and any eye-contact or generative extension.
