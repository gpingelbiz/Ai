# Master reel check implementation report

`reel check <work dir>` checks a saved render, writes `master-check.json` and `master-check.txt`, prints the report, and exits with status 1 when a blocking rule fails. Use `--fix` to enable repairs. Final `reel edit` and `reel build` renders run the same checker automatically. They retain a failed render and log its failing rule IDs.

## What changed

- `src/master-check.mjs:35` samples the rendered video every 0.5 seconds and checks caption plates, pro cards, and the hook during its on-screen hold. `src/placement.mjs:37` and `scripts/faces.swift:40` use the existing Vision helper to request eye landmarks. Older detections without eye positions use an estimate from the face rectangle. Missing samples with active overlays block the check.
- `src/master-check.mjs:80`, `:165`, `:232`, and `:255` enforce the pro minimums and full-screen limit, inspect planned display copy and speech, and measure opening luma with FFmpeg. The checker reuses preflight for loudness, caption speed, and black opening. It recomputes pro box collisions and includes saved measured overlaps from the existing layout gate when present.
- `src/broll.mjs:41` and `src/broll-runway.mjs:865` associate remembered scenes with their reel so the repetition check can exclude that reel. Legacy entries have scene descriptions only. The checker filters exact matches to the current reel's scene descriptions from those entries.
- `src/pipeline.mjs:1416` runs the checker after final render and preflight. `src/pipeline.mjs:1444` and `:1509` retry each unmet pro minimum once, rebuild repaired copy, and preserve the previous render if a repair render fails. `src/master-check.mjs:268` trims the opening flash from the encoded video and audio, then checks the result again using the adjusted timeline. `src/cli.mjs:493` exposes the standalone command.
- `src/reel-edges.mjs:20` and `:36` share the sentence-edge criteria and choose the nearest usable boundaries. `src/clips.mjs:120` snaps the source window before cutting, including on cached picks, and records long-clip provenance for blocking edge checks. `src/pipeline.mjs:253` preserves the closing pause when the cut needs it.
- `scripts/write-caption.mjs:261` refreshes the banned-words rule when post copy is written after rendering. `scripts/watch-reel.sh:144` delivers the JSON and prefixes failed filenames with `CHECK FAILED - `. It writes `Check notes.txt` for individual reels and clip-numbered notes in shared Clips folders.
- `src/publish-folder.mjs:120` reads the verdict or forwarded note. `scripts/publish-folder.mjs:26` logs and skips failures, and direct serve and filing commands refuse them as well. `scripts/publish-forward.mjs:81` carries the JSON alongside the existing note when bundling a loose video.

## Verification

- The focused run passed 50 tests across `test/master-check.test.mjs`, `test/watcher.test.mjs`, `test/publish.test.mjs`, and `test/publish-forward.test.mjs`. Coverage includes every rule, generated FFmpeg clips, mocked face observations, source-window snapping, edit and build ordering, forced retries, watcher naming, forwarding, and Metricool refusal.
- `bash -n scripts/watch-reel.sh` and `git diff --check` passed. The Swift face helper type-checked and compiled.
- `npm test -- --test-concurrency=2` finished with 2,223 passed, three failed, and one skipped. An untouched copy of the same Git revision had 2,208 passed, the same three failures, and one skipped under the workspace-local test setup. The failures were local HTTP bind permission at `test/content-studio.test.mjs:428`, a test fixture path containing the workspace owner's name at `test/content-studio.test.mjs:617`, and VideoToolbox tone mapping at `test/hdr.test.mjs:79`.

## Verification limits

- The native Vision smoke test could not decode the synthetic video in this sandbox. Final-render sampling, overlap thresholds, and missing-sample handling were verified with mocked face observations.
- The edit/build integration tests used a render adapter. Live HyperFrames rendering, signed-in generation, and Metricool scheduling were outside the verification run.
