# Greg's pro teaching graphics

Enable with `reel edit <video> --preset pingel-pro`. Use `--no-render` to build a reviewable HyperFrames project without producing an MP4. `--no-graphics` disables the teaching graphics; `--no-sounds` keeps them silent. Other presets keep their existing rendering.

This task supplies teaching graphics only. It does not implement the research's separate caption, hook, music-selection or mastering systems.

## Files

- `presets/pingel-pro.json`: extends `pingel-brand`, enables `pro`, reserves caption space and disables glow, glossy icons, full-screen cards, slams and competing cutaways in this look.
- `src/client-mode.mjs`: registers `pingel-pro` in `GREG_PRESETS`, including the existing client-preset rejection.
- `src/pro.mjs`: grounds every phrase in timed words, reuses existing graphic scenes, glow picks, flip detection and beat classification, requests Claude direction using the existing text-only adapter when more direction is needed, applies budgets, places overlays and produces final sound cues.
- `src/pro-render.mjs`: six HTML/GSAP components (`correction`, `compare`, `stepsRail`, `stat`, `wordMark`, `label`), scoped CSS and dependency-free cubic Bézier eases. SVG annotations are authored here and use no added package.
- `src/pipeline.mjs`: selects pro planning before legacy cards, places it after final framing/zooms, saves `plan.proGraphics` and mixes only final admitted teaching ticks.
- `src/compose.mjs`: includes pro HTML, CSS and timeline only when the Greg-only gate passes. A word mark is a child of its actual caption-word span.
- `test/pro.test.mjs`: pure-function tests for grounding, typography bounds, budgets, captions, placement and sound; mocked Claude/cache and moving-head tests.
- `test/pro-render.test.mjs`: component/class/duration/escaping checks, compositor gates and real vendored GSAP forward/reverse/shuffled seek checks.
- `test/pro-cli.test.mjs`: the real `reel edit <fixture> --preset pingel-pro --no-render` command with fake media, face and Claude adapters. It checks the saved plan, HTML, fonts and sound assets without network or a browser. Its temporary files stay under this worktree.
- `test/client-safety.test.mjs`: updates the Greg preset registry expectation; existing client-refusal tests also cover the new preset.
- `test/event-clock.test.mjs`, `test/signature.test.mjs` and `test/fixtures/stitch-legacy.mjs`: keep legacy hash checks scoped to the pre-existing presets. No old hashes or frame baselines change; pro is covered by the new snapshot-free component tests.

## Planning and placement

Plans target two or three earned overlays per 30 seconds, with a hard rolling limit of three. Starts stay at least four seconds apart, overlays cannot overlap, nothing starts before 2.6 seconds or the hook's end, and occupancy including exits stays at most 15 seconds in any 30-second window. Short clips also retain at least half clean footage. A weak or unplaceable beat is omitted rather than filling a quota. Full-screen reading cards are not emitted by this implementation.

Saved `graphics.json` scenes and `glow-picks.json` element picks are reused where their exact phrases still occur in the current words: list/steps become a three-step rail, versus/compare become a comparison, number/stat become a stat, and explicit quote/flip wrong/right pairs become corrections. A quote without a wrong/right pair is not guessed into a correction. Lists with other than three items are not silently truncated. Claude fallback also receives the existing classified beat jobs.

`pro-graphics.json` caches word-range direction using the timed transcript, duration and hook end. `--new-graphics` refreshes cached direction. The final placed overlays and their event IDs live in `plan.json` as `proGraphics`; sound is generated from that final list. Text stays verbatim, including numeric qualifiers. Long text is rejected when it cannot wrap at the specified size.

Panels use the requested flat obsidian/bone/gold system, 16px corners and 32px padding. Correction and comparison holds last 2.4 seconds after the last phrase finishes speaking and revealing. Labels last at most 2.5 seconds. Entrance/state/exit durations are 233/300/167ms with the supplied cubic curves, a maximum 16px entrance and no idle motion. GSAP evaluates the curves directly, so CustomEase is unnecessary.

Placement uses `frame-place.mjs`'s `readFrame`, `viewFor` and overlap checks. Four samples per second cover each overlay's entire hold. The transformed moving head union gets a further 56px guard; the microphone gets 24px; the entrance travel and reserved y1080–1300 caption band are protected too. Placements stay fixed after selection. The actual caption band is also checked when the operator moves it.

The three supplied rectangles are candidates. A 256px correction or 240px rail cannot fit a 160px torso slot at the required type size, so it uses the explanation slot only if that space is safe. Panels never fall back to shrinking type, moving Greg or covering his face.

The current native detector finds faces and upper bodies, not microphones. Until microphone detections are supplied, a conservative lower-left source rectangle (x0/y880/w280/h480 at 1080×1920) follows the footage transform. `placeProOverlay` accepts a measured canvas `frame.mic`; `placeProGraphics` accepts per-sample normalized `mics`. Missing frame detection omits overlays. No real footage render was run as part of this task.

## Validation

Run `node --test test/pro*.test.mjs test/bold-render.test.mjs` for the new behavior and existing-look HTML compatibility. The latter includes exact pre-existing HTML hashes for glow, client, VSL and other looks. Run the complete suite with `npm test`.

Golden-frame baselines are not changed. Capturing new frames requires driving the renderer's browser, which this task prohibits; compatibility is checked through identical generated HTML and unchanged vendored fonts/GSAP rather than a new frame capture.

Validation in this worktree on November 19, 2026:

- All 46 focused pro, client safety, legacy HTML, event-clock and signature checks pass. The standalone bold CLI regression also passes.
- `npm test`: 1,950 tests, 1,947 passed, one skipped, two failed. Both failures also occurred in the unmodified baseline: local HTTP hosting cannot bind `127.0.0.1` (`listen EPERM`) in this sandbox, and the PQ HDR round trip cannot use macOS VideoToolbox tone mapping. The baseline also had a bold CLI timeout under full-suite load; its final full-suite and standalone runs pass.
- Syntax checks and `git diff --check` pass. No dependencies were installed, no browser or real HyperFrames render was run, and no golden frames were regenerated.

The implementation is complete at unit/fixture level. Real-footage visual review and microphone detection beyond the conservative fallback remain unverified. Changes are left in the working tree without a commit.
