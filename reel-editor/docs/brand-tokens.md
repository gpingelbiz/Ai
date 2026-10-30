# Brand tokens (schema version 2)

Every visual format resolves one semantic brand object before it chooses a layout. A renderer asks for `ink`, `surface`, or the `display` type role; it does not contain a creator's hex values, font names, handle, or signature treatment.

Use `reel brand <preset-or-brand.json>` to inspect the resolved object, `--css` to emit the shared CSS variables, and `--check` to report validation problems.

## Authored shape

`schemaVersion` is `2`. The complete reference implementation is [`brands/pingel.json`](../brands/pingel.json).

- `identity`: `name`, `handle`, `credential`, optional `logo` file, and `handlePlacement`.
- `colors`: nine six-digit hex roles. `ink` is primary text; `accent` is emphasis; `accentInk` is text placed on the accent; `surface` and `surface2` are backgrounds/cards; `stroke` is an outline; `muted` is secondary copy; `paper` is the light-layout field; `warn` is urgency. Layout code must not infer meaning from a literal color.
- `type`: `display`, `body`, and optional `editorial` and `mono` roles. Each role records `family`, either `file` or `googleFamily`, `weights`, `case` (`upper` or `sentence`), `tracking` in em, unitless `lineHeight`, `licence`, and `sourceUrl`.
- `typeScale`: `xs`, `sm`, `md`, `lg`, `xl`, `display`, and `slideBody`, in pixels for a 1080-wide canvas. `slideBody` defaults to 42 and controls supporting slide copy. Format adapters may scale these values; the authored hierarchy stays the same.
- `spacing`: `xs` through `xxl`, in pixels. `radius`: `sm`, `md`, `lg`, and `pill`, in pixels.
- `texture`: `grain` from 0 to 1 and `paper` on/off. Photo finishing maps this design amount to bounded noise with
  `min(0.03, grain × 0.275)`, so the authored `0.08` becomes `0.022` actual monochrome grain strength.
- `motion`: `personality` (`punchy` or `calm`), integer `enterMs`, `exitMs`, and `staggerMs`, plus GSAP `enterEase` and `exitEase` names.
- `signature`: `kind` (`none`, `edge-rule`, `corner-mark`, or `title-plate`), `position`, `colorRole`, `thickness`, optional partial-rule `length`, and `opacity`. A corner mark uses the brand handle or monogram; title-plate geometry comes from the brand radius and spacing tokens.
- `imagery`: `finish` on/off (default on), grade `grade` name (`none`, `muted-editorial`, `bw`, or `warm`) and
  `intensity` from 0 to 1. Finishing changes photo pixels before slide text and brand colors are composited.
- `houseLooks`: look IDs allowed during automatic selection; an empty list allows all looks.
- `modes`: semantic mode names such as `authority`, `editorial`, or `proof`, mapped to look IDs. `contentModes` is accepted as a compatibility alias.

`coverPalettes` is a temporary compatibility field in Greg's file. It preserves the designed-cover palettes until the Phase 1 cover adapter consumes semantic roles directly. Other brands never inherit it; their three compatibility variants are derived from their own `surface/accent`, `paper/ink`, and `accent/surface` roles.

## Resolution and migration

`upgradeBrandV1()` converts `kit/brand-template.json` files deterministically. It maps `colors.text` to `ink`, `colors.bg` to `surface`, the two font slots to type roles, case and pace to typography/motion, and `looks.only` to `houseLooks`. Missing semantic colors, scales, texture, motion, and geometry are derived from those supplied values. A custom display font without recorded licence metadata remains usable but produces a warning.

`resolveBrandTokens({ preset, brand })` returns a complete v2 object. With no brand file it derives identity, colors, fonts, case, grade, and motion from the existing preset. The legacy preset fields remain unchanged, so current reel output and old `plan.json` files keep working.

Validation reports malformed hex values, missing `ink`, `accent`, or `surface`, and ink-on-surface contrast below 4.5:1. Licence omissions are prefixed `warning:` and are not rendering errors.

## CSS contract

`tokensCSS()` emits local `@font-face` declarations plus a `:root` block. The stable names include:

```css
--brand-ink
--brand-accent
--brand-accent-ink
--brand-surface
--brand-display-font
--brand-body-font
--brand-radius
--space-md
--type-display
```

The remaining color roles and every type, spacing, radius, texture, and default motion value follow the same naming pattern. HTML templates should include this string once and use only these properties or their resolved token object.
