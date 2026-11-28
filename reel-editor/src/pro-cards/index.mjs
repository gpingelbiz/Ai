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
import { CARDS as distinctionPayoff } from "./distinction-payoff.mjs";
import { CARDS as procedureProof } from "./procedure-proof.mjs";
import { CARDS as conversation } from "./conversation.mjs";
import { CARDS as warningEmphasisFull } from "./warning-emphasis-full.mjs";
import { CARDS as distinction2 } from "./distinction-2.mjs";
import { CARDS as procedure2 } from "./procedure-2.mjs";
import { CARDS as proof2 } from "./proof-2.mjs";
import { CARDS as conversation2 } from "./conversation-2.mjs";
import { CARDS as warningPayoff2 } from "./warning-payoff-2.mjs";
import { CARDS as splitList } from "./split-list.mjs";
// The Herk Edit Kit import (2026-11-27), restyled to the pro look: see HERK-LICENSE.md and herk-triage-*.json.
import { CARDS as herkKstat } from "./herk-kstat.mjs";
import { CARDS as herkKoverview } from "./herk-koverview.mjs";
import { CARDS as herkKsection } from "./herk-ksection.mjs";
import { CARDS as herkKlower } from "./herk-klower.mjs";
import { CARDS as herkKlabel } from "./herk-klabel.mjs";
import { CARDS as herkVstat } from "./herk-vstat.mjs";
import { CARDS as herkVoverview } from "./herk-voverview.mjs";
import { CARDS as herkVlabel } from "./herk-vlabel.mjs";
// Batch builders: add one import line and one spread each; nothing else in this file changes.

export const CARDS = Object.freeze({
  ...core,
  ...distinctionPayoff,
  ...procedureProof,
  ...conversation,
  ...warningEmphasisFull,
  ...distinction2,
  ...procedure2,
  ...proof2,
  ...conversation2,
  ...warningPayoff2,
  ...splitList,
  ...herkKstat,
  ...herkKoverview,
  ...herkKsection,
  ...herkKlower,
  ...herkKlabel,
  ...herkVstat,
  ...herkVoverview,
  ...herkVlabel,
});

// Designs (since 2026-11-27, the Herk Edit Kit import). A card may be another design of an existing type: it sets
// variantOf: "<type>" and has exactly that type's slots (same names, kinds, repeat and optional). The planner sees one
// entry per root type and the code picks the design (src/pro.mjs), so the prompt stays one line per meaning however
// many designs there are, and "one type per reel" counts the whole group.
export const rootOf = (type) => CARDS[type]?.variantOf || type;
export const CARD_GROUPS = Object.freeze(Object.keys(CARDS).reduce((groups, type) => {
  const root = rootOf(type);
  (groups[root] ||= []).push(type);
  return groups;
}, {}));

// What each card shows, so the element mix can pick by kind. New cards carry their own `tags`; these are the cards
// that came before tags. Vocabulary: comparison before-after checklist list steps timeline flow ranking number
// percent money chart rating progress time quote definition callout highlight rule warning question message
// conversation title.
export const TAG_WORDS = Object.freeze(["comparison", "before-after", "checklist", "list", "steps", "timeline", "flow", "ranking", "number", "percent", "money", "chart", "rating", "progress", "time", "quote", "definition", "callout", "highlight", "rule", "warning", "question", "message", "conversation", "title"]);
const EARLIER_TAGS = {
  correction: ["comparison"], compare: ["comparison"], steps: ["steps"], stat: ["number"], wordMark: ["highlight"], label: ["title"],
  objection: ["conversation", "quote"], "do-dont": ["comparison"], "myth-truth": ["comparison"], "before-after": ["before-after", "comparison"],
  thumbs: ["comparison"], poll: ["comparison", "question"], signpost: ["comparison", "flow"], venn: ["comparison"], rule: ["rule", "callout"],
  "tip-badge": ["callout", "rule"], quote: ["quote"], "takeaway-banner": ["title", "callout"], checklist: ["checklist", "list"],
  timeline: ["timeline", "steps"], formula: ["rule", "flow"], countdown: ["number", "list"], ranking: ["ranking", "list"],
  "percent-ring": ["number", "percent", "chart"], bars: ["chart", "number"], rating: ["rating", "number"], "progress-ring": ["progress", "percent"],
  stopwatch: ["time", "number"], "loading-bar": ["progress"], "text-thread": ["message", "conversation"], "incoming-call": ["conversation"],
  email: ["message"], notification: ["message"], "ask-this": ["question", "conversation"], "script-highlight": ["quote", "highlight"],
  "search-bar": ["question"], calendar: ["time"], unlock: ["callout"], "green-flag": ["callout"], "red-flag": ["warning"],
  cost: ["money", "number"], receipt: ["money", "number"], "pros-cons": ["comparison", "list"], "gold-frame": ["highlight", "quote"],
  "big-word": ["highlight", "title"], "sticky-note": ["callout"], arrow: ["highlight"], meter: ["progress", "rating"],
  "voice-wave": ["conversation"], "full-list": ["list"], "versus-split": ["comparison"], "scale-balance": ["comparison"],
  "toggle-switch": ["comparison", "before-after"], spectrum: ["comparison", "rating"], "you-say-they-hear": ["conversation", "comparison"],
  "true-false": ["comparison"], "verdict-stamp": ["callout"], "rookie-pro": ["comparison", "before-after"], "word-swap": ["comparison"],
  "either-or": ["comparison", "question"], "stack-fan": ["list"], roadmap: ["steps", "timeline"], branch: ["flow"], funnel: ["flow", "chart"],
  cycle: ["flow"], staircase: ["steps"], "pill-tracker": ["progress", "steps"], "first-then-finally": ["steps"], pyramid: ["chart", "list"],
  recipe: ["list", "steps"], odometer: ["number"], scoreboard: ["number", "comparison"], "line-chart": ["chart", "number"],
  gauge: ["chart", "rating"], "money-stack": ["money", "number"], trophy: ["callout"], streak: ["progress", "number"],
  "case-study": ["callout", "number"], "kpi-tile": ["number"], testimonial: ["quote"], "dm-chat": ["message", "conversation"],
  voicemail: ["conversation"], "video-call": ["conversation"], comment: ["message"], "crm-note": ["message"], dialer: ["conversation"],
  typing: ["message"], "quick-replies": ["conversation", "list"], "call-transcript": ["conversation", "quote"], "lock-screen": ["message"],
  "stop-sign": ["warning"], "caution-tape": ["warning"], "crossed-out": ["comparison", "warning"], trap: ["warning"],
  "marker-highlight": ["highlight"], newspaper: ["title", "quote"], seal: ["callout"], "key-insight": ["callout", "definition"],
  lightbulb: ["callout"], "save-this": ["callout"],
};
export const tagsOf = (type) => CARDS[type]?.tags || EARLIER_TAGS[type] || EARLIER_TAGS[rootOf(type)] || [];
