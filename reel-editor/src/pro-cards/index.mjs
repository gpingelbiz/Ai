// The pro look's card registry (Greg 2026-11-19: "build them all out", 50 card designs). Each batch file exports
// CARDS = { <type>: definition }. A definition is data plus one render function, so batches never edit shared code:
//   hint      when the planner should use it (one line, sent to Claude)
//   slots     { name: { kind: "spoken" | "label", repeat?: [min, max], maxChars, width, size, maxLines } } in reveal
//             order. "spoken" = an exact word range Greg says, revealed when he says it. "label" = a short static
//             caption the planner writes (at most 4 words, no digits, so no card ever shows an unspoken number).
//   size      { w, h } or (overlay) => { w, h } on 1080x1920
//   surface   "obsidian" (dark panel, default) | "bone" (light card) | "bare" (no panel, the render draws its own)
//   fullscreen  true for the one full-screen card a reel may have
//   render(o, h) -> { inner, timeline }  o.slots[name] = [{ text, lines, at, end }], o.reveals; h = helpers
//   css       string of rules scoped under .pro-<type>
import { CARDS as core } from "./core.mjs";
// Batch builders: add one import line and one spread each; nothing else in this file changes.

export const CARDS = Object.freeze({
  ...core,
});
