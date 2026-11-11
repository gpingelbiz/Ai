# Proof folder

Greg's vertical `pingel-bold` reels can show a real screenshot, a short definition, or a small business math panel while captions continue. There is no overlay quota. Client jobs cannot use these kinds, and the personal preset, this guide and test fixtures are excluded from client releases.

Put approved screenshots in `~/Reels/brand-assets/proof/`. Set another folder with `bold.proof.manifest` in `presets/pingel-bold.json`. No new CLI flags are required. Keep originals outside the repository. Use PNG, JPG, JPEG or HEIC. Add the metadata below to `manifest.json`:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` on the top-level object |
| `entries` | Array of records |
| `id` | Unique letters, digits, underscores or hyphens, up to 80 characters |
| `file` | Screenshot path relative to the manifest folder, inside that folder |
| `crop` | `{x,y,w,h}` in fractions of the full image, with the origin at the top left; all bounds within 0 to 1 |
| `proves` | What this record actually supports, including metric, period, denominator and qualifications where needed |
| `date` | Capture date as `YYYY-MM-DD` |
| `label` | Optional honest source label, up to seven words and 48 characters; otherwise choose a label range from the transcript |
| `redact` | Array of additional `{x,y,w,h}` rectangles in the same full-image coordinates; use `[]` when none |
| `approved` | Exactly `true` after reviewing the screenshot and crop for publication |

The only sample manifest is [the unapproved placeholder test fixture](../test/fixtures/bold-proof/manifest.json). It contains no real proof. Start with an empty `entries` array, then add your own records. Keep source labels and necessary context inside the crop, including the denominator and any qualification. Add manual masks for client names and unrelated messages. Approval is your review of that record and crop; the editor cannot establish the underlying business claim.

The editor offers only approved metadata to the existing argument planner. Claude selects an entry ID and the exact claim word indexes; code checks subject overlap with `proves`. It does not ask Claude to write labels or generate screenshots. A selected image is read locally by Apple Vision, then irreversibly masked with the existing evidence privacy rules for email, phone, street address, long digit runs and detected faces, plus your manual boxes. The source file and raw OCR text never enter the HyperFrames project. A cropped, redacted PNG is stored as `project/assets/bold-proof/<sha256>.png`.

Every unmasked OCR line inside the crop must fit at 32 rendered pixels or more. A crop cutting through a line is rejected. Long digit runs may include a real metric: if it is masked, prepare a clearer approved source rather than disabling redaction. Missing manifests or missing or unsafe sources produce one short log line per job and no proof overlay. A missing glossary simply offers no glossary candidates. With no measured face boxes, overlays are omitted. Check the first real render for crop context, redactions and phone readability.

For approved definitions, put `glossary.json` next to the manifest. Its schema is `{ "schemaVersion": 1, "entries": [] }`. Each entry has `term`, `definition` and `approved: true`. A term is at most four words and 40 characters; the definition is at most 14 words and 140 characters. Only a term spoken in the reel can be selected. Claude chooses that term or a transcript range where Greg explains it. Code uses the supplied wording, removes decorative punctuation through bold's text cleaner, and rejects a line that cannot fit at 32 pixels. It never accepts Claude-written definition copy.

Preset defaults under `bold`:

| Option | Default |
| --- | --- |
| `proof.enabled`, `define.enabled`, `math.enabled` | `true` |
| `proof.manifest` | `~/Reels/brand-assets/proof/manifest.json` |
| Each kind's `max` | `2`, with a hard cap of one through 30 seconds and two for longer reels |
| `proof.width`, `proof.height` | 820, 360 pixels at 1080 canvas width |
| `define.width`, `define.maxWords` | 820 pixels, 14 words |
| `proof.soundVolume`, `define.soundVolume` | 0.12, hard capped at 0.2 |
| `math.widthFraction`, `math.size` | 0.4 of frame width, 96 pixels |
| `math.resultSound`, `math.soundVolume` | `false`, 0.1 |

Sizes scale with canvas width; the source text floor remains 32 pixels. Cards hold 3.5 to 6 seconds in total with at least 3.5 seconds after an eight-frame slide landing, or enter by hard cut. Both entrances end by hard cut. Math rows hard cut at the selected number's word; unspoken exact results appear four frames after the final operand. Math is limited to two operands, at most eight seconds, beside the face, below the headline and above captions. Ambiguous ranges, clipped qualifiers, incompatible units, nonexact unspoken results and layouts without space fail closed. Simple unspoken results require operands and a result bounded to a billion units and exact cents; comparisons show only spoken values. Math lines are silent unless `resultSound` is enabled. All cues use the event clock.

`bold-picks.json` keeps inclusive selections alongside the existing argument plan:

- `proof`: `kind`, `from`, `to`, `reason`, `entryId`, optional `label:{from,to}`, and `entrance:"slide"|"cut"`.
- `define`: `kind`, `from`, `to`, `reason`, `term:{from,to}`, either `definitionRange:{from,to}` or `glossaryTerm`, and `entrance`.
- `math`: `kind`, `from`, `to`, `reason`, `operation`, two operand ranges in `numbers` (each may have a transcript `label` range), and optional spoken `result:{from,to}`. Operations are `add`, `subtract`, `multiply`, `percent`, `compare`, `per`. A rate divides operand one by operand two; percent plus an amount calculates the percentage of that amount.

Validated picks also contain code-derived `holdSeconds`. `plan.json` keeps accepted events in `bold.overlays` with integer `startFrame`, `endFrame`, `landingFrame`, seconds, safe `box` geometry and `data`. Proof data includes the cleaned image URL, hash, source date, redaction count and measured text size. Definition data contains the grounded term and explanation; math data contains computed rows with their word frames. Cached picks are validated against the current transcript and approved files on every restyle. Use the existing `--repick` to request different direction.
