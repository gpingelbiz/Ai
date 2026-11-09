// Synthetic dry plan only: no client copy, media, model calls or filesystem writes.
import { planVslGraphics } from "../src/vsl-script.mjs";

const script = `---
project: synthetic-practice
version: 1
wpm: 150
---
## S1 Welcome
SAY: Welcome to the practice studio.
SCREEN: Make room to practice
## S2 Offer
SAY: This practice kit costs forty nine dollars today.
SCREEN: $49 today
## S3 Contents
SAY: The kit includes a notebook timer and checklist.
SCREEN: Notebook | Timer | Checklist
## S4 Method
SAY: Pick one goal then practice and review.
SCREEN: 1. Pick a goal | 2. Practice | 3. Review
## S5 Feedback
SAY: One participant called the exercise clear and useful.
SCREEN: "Clear and useful." Example Participant
SCREEN: [CONFIRM: add a verified result]
## S6b Next action
SAY: Choose your next small action and start today.
SCREEN: Your next small action
`;
const takes = [
  [0, "Welcome to the practice studio"],
  [12, "This practice kit costs forty nine dollars today"],
  [24, "The kit includes a notebook timer and checklist"],
  [36, "Pick one goal then practice and review"],
  [48, "One participant called the exercise clear and useful"],
  [60, "Choose your next small action and start today"],
];
const words = takes.flatMap(([start, text]) => text.split(" ").map((text, i) => ({ text, start: start + i * 0.4, end: start + i * 0.4 + 0.32 })));
const plan = planVslGraphics({ script, words, duration: 72 });
console.log(JSON.stringify({
  schema: plan.schema,
  sections: plan.sections,
  cards: plan.scenes.map((card) => ({ section: card.sectionId, source: card.source, type: card.type, start: card.start, end: +(card.start + card.duration).toFixed(3),
    ...(card.text ? { text: card.text } : {}), ...(card.eyebrow ? { eyebrow: card.eyebrow } : {}),
    ...(card.value ? { value: card.value, sub: card.sub } : {}), ...(card.items ? { items: card.items.map((item) => item.text) } : {}) })),
  diagnostics: plan.diagnostics,
}, null, 2));
