The pro caption, hook, music/mix and camera options are implemented independently of the existing looks. No preset file was created and no changes were committed. Add the JSON at the end of this report to the separately built `presets/pingel-pro.json`.

| File | Change |
| --- | --- |
| `src/pro-captions.mjs` | Measures the shipped Inter font at weight 700; splits retained speech into meaning-aware 2–5-word cues, allowing at most six; protects negations, number expressions and dictionary phrases; targets 800–1300 ms and flags cues below 500 ms. Fits at most two lines within 780 px without shrinking. Budgets five gold keywords per 30 seconds, capped at eight and one per cue. Reserves one upward-only caption anchor per thought using sampled chin positions. |
| `src/pro-text.mjs` | Emits the fitted 92%-opaque #111111 caption plate with 24 px horizontal padding and 12 px corners, Inter 700 at 80/92 px with −0.8 px tracking, no shadow/glow and #E2BA64 keywords. Emits the black Anton 400 / 108 px opening title at y=260. |
| `src/hook.mjs` | Adds a two-line pro title, shortens overflow at word boundaries, clamps its hold to 2.0–2.7 seconds, and removes only duplicated caption words while the title carries them. Later/unrelated speech remains captioned, including when the matching spoken sentence extends past the title hold. |
| `src/pro-audio.mjs` | Adds mood-filtered uniform track selection, history rotation, an offline lesson-mood fallback, phrase ducking, shared SFX limits and measured two-pass mastering. Checks the encoded AAC against −16 LUFS ±1 and ≤−1.5 dBTP; retries peak overshoot and fails instead of silently delivering an out-of-target mix. |
| `src/zooms.mjs` | Adds the proportional pro punch budget and at most two punches in any 30-second window. Uses 8–12% punches that arrive on the operative word over 200 ms; finishes moves before the final two seconds. |
| `src/pipeline.mjs` | Connects the options to grouping, title planning, face sampling, music preparation and final mastering. Pro camera pacing disables cadence, drift and impact bumps. Hook previews rebuild their pro captions from retained speech and receive pro mastering. Saves music history only after a completed render; a no-render build does not consume a use. |
| `src/compose.mjs` | Selects pro markup/CSS and hard caption swaps; disables hook pushes and uses plain `power2.out` camera moves under the corresponding options. The legacy branches keep their original output. |
| `src/glow.mjs`, `src/bold.mjs` | Prevent either restyler from replacing an explicitly enabled pro caption/hook system. |
| `src/client-mode.mjs` | Registers `pingel-pro` in `GREG_PRESETS`. |
| `test/pro-captions.test.mjs` | Tests phrase coverage, timing, width, protected meaning, fast-cue flags, gold budgeting, stable thought anchors, hook fitting and duplicate suppression. |
| `test/pro-audio.test.mjs` | Tests rotation, uniform Signature treatment, history persistence and stale-pick protection, offline moods, envelope maths, music gain, SFX calibration, master retries/failure, real FFmpeg mixing/mastering and a complete no-browser pro project build. Also exercises hook-preview composition with an injected renderer. |
| `test/pro-render.test.mjs` | Tests markup, exact style values, generated runtime syntax, opt-in guards, zoom budgets and five pre-change composition hashes. |
| `test/client-safety.test.mjs` | Updates the expected Greg-only names to include `pingel-pro`; existing client refusal checks now cover the new name. |
| `docs/pro-captions-hook-audio.md` | This handoff report and preset integration block. |

Music files retain the existing `<Mood> - <Title> - <Artist>` naming convention. Configure `audio.musicDir` or pass `--music-dir /path/to/the/music-folder`. A requested track cannot bypass rotation or a selected mood. Signature tracks have equal selection weight. If the matching catalog is exhausted, the bed stays silent with a log message; the constraints are not relaxed. At least four eligible tracks are needed to sustain the last-three rule without silent reels. Vocal demonstrations can deliberately select silence.

History defaults to `~/Reels/.music-history.json`; `REEL_MUSIC_HISTORY` overrides it. It is an array of `{ "reel": "absolute work directory", "track": "filename or null", "at": "ISO timestamp" }` records. Silent completed pro reels occupy a history slot. Rebuilding the same reel reuses its eligible saved selection and does not append another use. Writes use an exclusive lock and atomic rename. A conflicting pick made by a concurrent render is rejected rather than recorded as a repeat. Tests use worktree-local history files; the production history was not touched.

The bed is normalized to −20 LUFS and calibrated against measured dialogue loudness. With dialogue at −16 LUFS, the base gain is −8 dB and speech adds another −6 dB, putting the speech bed near −34 LUFS. Speech regions combine transcript words and the available voice envelope; gaps through 650 ms merge. Ducking begins 120 ms before speech, descends over 100 ms, holds through speech plus 250 ms, and releases over 450 ms using smoothstep in dB. Overlapping release/attack windows remain ducked. The bed fades out over 240 ms without fading or trimming the dialogue.

All built-in, generated and b-roll effects share the same pro budget: normally three per 30 seconds, no more than four in any 30 seconds or five total, and at least 1.5 seconds apart. File peaks are measured before applying approximately −23 dBFS whoosh, −27 dBFS tick/marker and −25 dBFS pop/card ceilings. No sounds are added merely to fill the budget.

Verification: all 37 focused checks pass (`node --test test/pro-*.test.mjs test/client-safety.test.mjs`). `npm test` reports 1,961 passes, two failures and one skip out of 1,964 tests. Both failures also occurred before these changes: localhost hosting is denied with `listen EPERM` in `test/content-studio.test.mjs:428`, and the macOS PQ/VideoToolbox fixture fails in `test/hdr.test.mjs:79`. The pre-change run also had a bold CLI timeout; that test passed in the final run. These environment failures were left outside this task's scope. Syntax checks and `git diff --check` pass.

Five pre-change fixtures (glow/pingel-brand, bold, clean, VSL and pingel-v2) produce byte-identical HTML, CSS and GSAP data, with permanent hash regression tests. Golden PNG files are untouched. Browser-based golden rendering and production-footage visual/listening review were not run because browser use is prohibited for this task. The audio integration test creates a local voice/music mix and verifies the actual AAC master against both targets. Font fitting uses the already installed renderer's `fontkit`; no packages were installed.

After the other builder supplies the preset, use `reel edit /path/to/clip.mp4 --preset pingel-pro --music-dir /path/to/the/music-folder`. Existing preset names and their rendering behavior are unchanged. Short or unusually fast speech can produce flagged cues below the target hold; a single unrenderable token or protected phrase raises a transcript/fit error instead of silently shrinking or omitting speech. Without a usable chin measurement the caption anchor stays at y=1248 and the build logs that fallback.

Merge this exact block into `presets/pingel-pro.json`, keeping the other builder's graphics and brand settings:

```json
{
  "captions": {
    "enabled": true,
    "pro": true
  },
  "hook": {
    "enabled": true,
    "pro": true,
    "duration": 2.4
  },
  "audio": {
    "pro": true,
    "music": null,
    "musicWant": "",
    "sounds": true
  },
  "zooms": {
    "enabled": true,
    "pro": true
  }
}
```
