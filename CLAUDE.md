# gpingelbiz/Ai

The `reel` editor lives in `reel-editor/` (it also ships to client kits through `reel-editor/scripts/release.mjs`); `opus-dropbox/` is the Dimaria Opus Clip kit. Files at the repo root and in `docs/` never ship in a kit.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on gpingelbiz/Ai, worked with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created when the first term or decision is settled. See `docs/agents/domain.md`.
