import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSlideSpec, slideHTML } from "../src/slides.mjs";
import { parseCopy, inSource, copyPrompt } from "../src/studio-copy.mjs";
import { resolveBrandTokens, upgradeBrandV1 } from "../src/brandtokens.mjs";

const tokens = resolveBrandTokens({ brand: upgradeBrandV1({ name: "Sample Coach", handle: "@samplecoach", colors: { text: "#FFFFFF", accent: "#C8A24B", stroke: "#111111", bg: "#111111" } }) });

test("stat, steps and quote slides render their copy and the handle", () => {
  const { slides } = normalizeSlideSpec({ slides: [
    { kind: "stat", label: "THE NUMBER", number: "3%", headline: "OF BUSINESSES TEXT BACK IN *FIVE* MINUTES.", source: "NP Digital, Feb 2026" },
    { kind: "steps", headline: "WHAT HAPPENS AFTER A DM", steps: ["Reply in minutes.", "Follow up on day 2.", "Book from real times."] },
    { kind: "quote", quote: "Show up, do the work.", by: "Sample Coach", context: "On renewals" },
  ] });
  const [stat, steps, quote] = slides.map((slide) => slideHTML(slide, tokens, { fitScript: false, signature: false }));
  assert.match(stat, /class="stat-number"[^>]*>3%</);
  assert.match(stat, /NP Digital, Feb 2026/);
  assert.equal((steps.match(/class="step-n"/g) || []).length, 3);
  assert.match(quote, /Show up, do the work\./);
  for (const html of [stat, steps, quote]) assert.match(html, /@samplecoach/);
});

test("stat, steps and quote slides reject incomplete specs", () => {
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "stat", headline: "NO NUMBER" }] }), /number/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "steps", headline: "ONE", steps: ["only one"] }] }), /2 to 6/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "quote", quote: "Words" }] }), /who said it/);
});

const reply = (slide) => JSON.stringify({ angle: "a", hook: "h", slides: [{ role: "cover", headline: "Hook here" }, slide, { role: "point", headline: "Second point", body: "More." }, { role: "point", headline: "Third point", body: "More." }, { role: "close", headline: "Keep this" }], caption: "x", hashtags: ["#a", "#b", "#c"] });

test("a stat survives only when its number and source are in the client's own files", () => {
  const guide = "Our members finish at 82% when they start in a cohort (Studio records, 2026).";
  const ok = parseCopy(reply({ role: "stat", number: "82%", headline: "finish when they start together", source: "Studio records, 2026" }), { format: "carousel", sourceText: guide });
  assert.equal(ok.slides[1].role, "stat");
  const invented = parseCopy(reply({ role: "stat", number: "91%", headline: "finish when they start together", source: "Harvard" }), { format: "carousel", sourceText: guide });
  assert.equal(invented.slides[1].role, "point");
  assert.equal(invented.slides[1].number, undefined);
});

test("a quote survives only when its exact words are in the guide or voice notes", () => {
  const voice = "I always say: show up, do the work, and the results take care of themselves.";
  const ok = parseCopy(reply({ role: "quote", quote: "Show up, do the work", by: "Sample Coach" }), { format: "carousel", sourceText: voice });
  assert.equal(ok.slides[1].role, "quote");
  const invented = parseCopy(reply({ role: "quote", quote: "Greatness is a habit", by: "Sample Coach" }), { format: "carousel", sourceText: voice });
  assert.equal(invented.slides[1].role, "point");
  assert.equal(invented.slides[1].headline, "Greatness is a habit");
});

test("steps need at least 3 items, otherwise they fold into a point", () => {
  const two = parseCopy(reply({ role: "steps", headline: "Two steps", steps: ["One", "Two"] }), { format: "carousel" });
  assert.equal(two.slides[1].role, "point");
  const three = parseCopy(reply({ role: "steps", headline: "Three steps", steps: ["One", "Two", "Three"] }), { format: "carousel" });
  assert.deepEqual(three.slides[1].steps, ["One", "Two", "Three"]);
});

test("inSource ignores case and curly apostrophes, and the writer prompt carries the slide 2 rule", () => {
  assert.ok(inSource("Don't wait", "they said DON’T WAIT today"));
  assert.ok(!inSource("", "anything"));
  assert.match(copyPrompt({ format: "carousel", job: "Offer", client: "Sample Coach" }), /Slide 2 must stand on its own/);
});
