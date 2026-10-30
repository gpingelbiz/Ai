import test from "node:test";
import assert from "node:assert/strict";
import { resolveBrandTokens, tokensCSS, upgradeBrandV1 } from "../src/brandtokens.mjs";
import { faceAwareFamilyPlacement, normalizeSlideSpec, sampleSlidesSpec, slideHTML } from "../src/slides.mjs";
import { buildAltText, buildSpec, copyPrompt, coverFamiliesForJob, parseCopy, slideWordCount, textPositionClass } from "../src/studio-copy.mjs";
import { pickStaticFamily, STATIC_FAMILIES } from "../src/mix.mjs";

const photo = "/tmp/supplied-family-photo.png";
const tokens = resolveBrandTokens({ brand: upgradeBrandV1({
  name: "Sample Coach",
  handle: "@samplecoach",
  colors: { text: "#F7F2EA", accent: "#B97867", stroke: "#241F1B", bg: "#241F1B" },
}) });

const familySlides = [
  { kind: "cover-top", photo, headline: "A *CLEAR* PROMISE SITS UP TOP", sub: "The scene stays visible below." },
  { kind: "cover-doc", photo, headline: "REAL WORK SHOWN", corner: "tr" },
  { kind: "cover-card", photo, headline: "THE *BRIEF CARD* SITS BESIDE THE FACE", sub: "Only supplied context appears on this solid field.", side: "left" },
  { kind: "cover-compare", photo, headline: "CHOOSE THE USEFUL PATH", left: { label: "OLD WAY", text: "Wait for later" }, right: { label: "DECISION", text: "Act while clear" }, decision: "right" },
  { kind: "cover-list", photo, headline: "FIVE *USEFUL* POINTS TO KEEP", sub: "A real count belongs here." },
  { kind: "verdict", headline: "THE *CLEAR* DECISION BEATS MORE NOISE" },
  { kind: "note", label: "KEEP THIS", text: "A short useful note leaves the rest of the slide quiet." },
  { kind: "script", label: "SAY THIS INSTEAD", headline: "STOP ASKING IF THEY NEED MORE TIME", say: "Ask which part of the decision still feels unclear right now." },
];

test("new cover and static families normalize with their complete contracts", () => {
  const normalized = normalizeSlideSpec({ slides: familySlides });
  assert.deepEqual(normalized.slides.map((slide) => slide.kind), familySlides.map((slide) => slide.kind));
  assert.equal(normalized.slides[3].decision, "right");
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "cover-top", headline: "Five words sit up here" }] }), /needs a photo/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "cover-doc", photo, headline: "Too short", corner: "middle" }] }), /3 to 6 words|corner/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "cover-card", photo, headline: "Too short", side: "middle" }] }), /6 to 12 words|side/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "cover-compare", photo, left: { label: "A", text: "two words" } }] }), /needs right/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "cover-list", photo, headline: "Too short" }] }), /5 to 8 words/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "verdict", headline: "Too short" }] }), /5 to 11 words/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "note", text: "Too short" }] }), /7 to 18 words/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "script", headline: "This objection is much too short", say: "Too short" }] }), /10 to 18 words/);
});

test("the shared sample spec includes every new family for both sample-brand render passes", () => {
  const kinds = sampleSlidesSpec(photo).slides.map((slide) => slide.kind);
  for (const kind of familySlides.map((slide) => slide.kind)) assert.ok(kinds.includes(kind), kind);
});

test("new family markup contains only supplied copy and token-driven colors", () => {
  for (const slide of familySlides) {
    const html = slideHTML(slide, tokens, { fitScript: false, signature: false });
    assert.match(html, new RegExp(`class="slide ${slide.kind}`));
    assert.match(html, /@samplecoach/);
    const rules = (html.match(/<style>([\s\S]+)<\/style>/)?.[1] || "").replace(tokensCSS(tokens), "");
    assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b/i, slide.kind);
  }
  const top = slideHTML(familySlides[0], tokens, { fitScript: false });
  assert.match(top, /A <span class="accent">CLEAR<\/span> PROMISE SITS UP TOP/);
  assert.match(top, /\/ \.65\)/, "the local text scrim is at least 65 percent under the words");
  assert.doesNotMatch(slideHTML(familySlides[1], tokens), /class="story-scrim"|class="cover-top-scrim"/);
  assert.match(slideHTML(familySlides[7], tokens), /Ask which part of the decision still feels unclear right now\./);
});

test("face-aware family furniture goes opposite the face and keeps defaults when no face exists", () => {
  assert.deepEqual(faceAwareFamilyPlacement([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]), { side: "right", corner: "br" });
  assert.deepEqual(faceAwareFamilyPlacement([{ x: 700, y: 900, w: 200, h: 200 }], { width: 1200, height: 1600 }), { side: "left", corner: "tl" });
  assert.equal(faceAwareFamilyPlacement([]), null);
});

test("slideBody is 42 by default, client-overridable, and legacy Pingel photo subs retain their old size", () => {
  assert.equal(tokens.typeScale.slideBody, 42);
  const custom = resolveBrandTokens({ brand: { ...tokens, typeScale: { ...tokens.typeScale, slideBody: 47 } } });
  assert.match(tokensCSS(custom), /--type-slide-body: 47px/);
  assert.match(slideHTML({ kind: "photosplit", photo, headline: "Supplied", sub: "Supplied" }, custom), /--legacy-sub-size:47px/);
  const pingel = resolveBrandTokens({ brand: { ...tokens, identity: { ...tokens.identity, handle: "@officialgregpingel" } } });
  assert.match(slideHTML({ kind: "photosplit", photo, headline: "Supplied", sub: "Supplied" }, pingel), /--legacy-sub-size:36px/);
});

const reply = (slides) => JSON.stringify({ angle: "one", hook: "one", slides, caption: "A useful caption.", hashtags: [] });

test("parseCopy splits over-budget middle copy without dropping words and fails when the deck is full", () => {
  const longBody = Array.from({ length: 31 }, (_, i) => `word${i + 1}`).join(" ");
  const slides = [
    { role: "cover", headline: "A useful cover promise" },
    { role: "point", headline: "One useful point", body: longBody },
    { role: "point", headline: "Third useful point" },
    { role: "point", headline: "Fourth useful point" },
    { role: "close", headline: "Keep this useful close" },
  ];
  const parsed = parseCopy(reply(slides), { format: "carousel", slides: [5, 6] });
  assert.equal(parsed.slides.length, 6);
  const joined = parsed.slides.slice(1, 3).flatMap((slide) => [slide.headline, slide.body]).filter(Boolean).join(" ");
  for (let i = 1; i <= 31; i++) assert.match(joined, new RegExp(`\\bword${i}\\b`));
  assert.ok(parsed.slides.slice(1, 3).every((slide) => slideWordCount(slide) <= 32));
  assert.throws(() => parseCopy(reply(slides), { format: "carousel", slides: [5, 5] }), /no room to split/);
  assert.throws(() => parseCopy(reply([{ role: "verdict", headline: "One two three four five six seven eight nine ten eleven twelve" }]), { format: "static" }), /11 word budget/);
  assert.throws(() => parseCopy(reply([{ role: "note", text: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen" }]), { format: "static" }), /18 word budget/);
  assert.throws(() => parseCopy(reply([{ role: "script", headline: "One two three four five six seven eight nine ten", say: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen" }]), { format: "static" }), /28 word budget/);

  const longCover = Array.from({ length: 19 }, (_, i) => `cover${i + 1}`).join(" ");
  const coverSplit = parseCopy(reply([{ role: "cover", headline: longCover }, ...slides.slice(2)]), { format: "carousel", slides: [5, 6] });
  assert.equal(coverSplit.slides.length, 5);
  assert.ok(coverSplit.slides.slice(0, 2).every((slide) => slideWordCount(slide) <= (slide.role === "cover" ? 18 : 32)));
});

test("slide 2 is repaired to a different text-position class", () => {
  const parsed = parseCopy(reply([
    { role: "cover-top", headline: "A useful promise sits up top" },
    { role: "cover-list", headline: "Five useful points worth keeping" },
    { role: "point", headline: "Third useful point" },
    { role: "point", headline: "Fourth useful point" },
    { role: "close", headline: "Keep this useful close" },
  ]), { format: "carousel", slides: [5, 6] });
  assert.notEqual(textPositionClass(parsed.slides[0].role), textPositionClass(parsed.slides[1].role));
  assert.equal(parsed.slides[1].role, "body");
});

test("the writer routes cover jobs and enforces teaching artifacts versus Story scenes", () => {
  assert.deepEqual(coverFamiliesForJob("Story"), ["cover-doc"]);
  assert.deepEqual(coverFamiliesForJob("Offer"), ["cover-top", "cover-list"]);
  assert.deepEqual(coverFamiliesForJob("Sales"), ["cover-compare", "cover-top"]);
  assert.deepEqual(coverFamiliesForJob("System"), ["cover-card", "cover-list"]);
  const prompt = copyPrompt({ format: "carousel", job: "Sales", client: "Sample Coach" });
  assert.match(prompt, /cover-compare/);
  assert.match(prompt, /left and right objects with label and text/);
  assert.match(prompt, /2 or 3 keep-this slides/);

  const teaching = parseCopy(reply([
    { role: "cover-top", headline: "A useful offer promise starts here" },
    { role: "steps", headline: "Use these steps", steps: ["Start here", "Check this", "Finish there"] },
    { role: "compare", headline: "Choose the path", left: { label: "Wait", value: "Later" }, right: { label: "Act", value: "Today" } },
    { role: "point", headline: "The useful reason" },
    { role: "close", headline: "Keep this useful close" },
  ]), { format: "carousel", slides: [5, 8], job: "Offer" });
  assert.equal(teaching.slides.filter((slide) => ["steps", "list", "stat", "compare"].includes(slide.role)).length, 2);

  assert.throws(() => parseCopy(reply([
    { role: "cover-doc", headline: "REAL WORK SHOWN" },
    { role: "story", caption: "A real scene moves the story forward." },
    { role: "compare", headline: "Two paths", left: { label: "First", value: "One" }, right: { label: "Second", value: "Two" } },
    { role: "story", caption: "Another real scene carries the turn." },
    { role: "close", headline: "One useful human lesson" },
  ]), { format: "carousel", slides: [5, 8], job: "Story" }), /cannot contain keep-this/);
});

test("new roles build the expected specs and alt text covers their fields", () => {
  const staticCopy = parseCopy(reply([{ role: "script", headline: "STOP ASKING IF THEY NEED MORE TIME", say: "Ask which part of the decision still feels unclear right now." }]), { format: "static", staticFamily: "script" });
  const script = buildSpec(staticCopy, [null], { format: "static" });
  assert.equal(script.slides[0].kind, "script");
  assert.match(buildAltText(script)[0], /Ask which part/);

  const compare = { slides: [{ role: "cover-compare", headline: "Choose", left: { label: "OLD", text: "Wait for later" }, right: { label: "NEW", text: "Act while clear" }, decision: "right" }] };
  const spec = buildSpec(compare, [{ file: photo, visualDescription: "A coach at a whiteboard" }], { format: "carousel" });
  assert.equal(spec.slides[0].kind, "cover-compare");
  const alt = buildAltText(spec, [{ visualDescription: "A coach at a whiteboard" }])[0];
  assert.match(alt, /OLD\. Wait for later\. NEW\. Act while clear/);
});

test("daily statics rotate all four families and never repeat the last one", () => {
  assert.deepEqual(STATIC_FAMILIES, ["verdict", "note", "cover-top", "script"]);
  const history = [];
  for (const family of STATIC_FAMILIES) {
    const next = pickStaticFamily(history);
    assert.equal(next, family);
    assert.notEqual(next, history.at(-1)?.staticFamily);
    history.push({ format: "static", day: `2026-11-0${history.length + 1}`, time: "18:00", staticFamily: next });
  }
  assert.equal(pickStaticFamily(history), "verdict");
  assert.equal(pickStaticFamily([{ format: "carousel", day: "2026-11-05" }]), "verdict");
});

test("a cover with no usable photo falls back to a type-only layout instead of failing the post", async () => {
  const { buildSpec } = await import("../src/studio-copy.mjs");
  const copy = { slides: [
    { role: "cover-top", headline: "Stop pitching", sub: "Say the sentence." },
    { role: "cover-compare", headline: "Two ways", left: { label: "Most", text: "Pitch" }, right: { label: "Do", text: "Ask" } },
  ] };
  const spec = buildSpec(copy, [null, null], { format: "carousel", outDir: "/tmp/x" });
  assert.deepEqual(spec.slides[0], { kind: "cover", headline: "Stop pitching", sub: "Say the sentence." });
  assert.equal(spec.slides[1].kind, "compare");
  assert.equal(spec.slides[1].left.value, "Pitch");
  assert.throws(() => buildSpec({ slides: [{ role: "cover-doc" }] }, [null], { format: "carousel", outDir: "/tmp/x" }), /needs a real photo/);
});

test("cover-top with a face high in the frame becomes the band-on-top cover; a photo-less story beat becomes a note", async () => {
  const { buildSpec } = await import("../src/studio-copy.mjs");
  const high = { export: "/tmp/a.jpg", faces: [{ x: 0.3, y: 0.2, w: 0.3, h: 0.25 }] };
  const low = { export: "/tmp/b.jpg", faces: [{ x: 0.3, y: 0.6, w: 0.3, h: 0.2 }] };
  const copy = { slides: [{ role: "cover-top", headline: "Real job" }] };
  assert.equal(buildSpec(copy, [high], { format: "carousel", outDir: "/tmp/x" }).slides[0].kind, "cover-list");
  assert.equal(buildSpec(copy, [low], { format: "carousel", outDir: "/tmp/x" }).slides[0].kind, "cover-top");
  const story = buildSpec({ slides: [{ role: "story", caption: "Last one out tonight.", chapter: "After close" }] }, [null], { format: "carousel", outDir: "/tmp/x" });
  assert.deepEqual(story.slides[0], { kind: "note", text: "Last one out tonight.", label: "After close" });
});

test("light slides set a pale accent as ink on a true-accent highlight; a dark accent keeps plain colored words", () => {
  const brand = (accent) => resolveBrandTokens({ brand: upgradeBrandV1({ name: "chip", colors: { text: "#F5F1E8", accent, stroke: "#0B0B0D", bg: "#0B0B0D" } }) });
  const pale = brand("#C8A24B");
  const dark = brand("#1F3A5F");
  const note = { kind: "note", text: "Nobody buys the *modules.*" };
  const script = { kind: "script", light: true, headline: "Can we *pause*?", say: "Sure. What changed?" };
  assert.match(slideHTML(note, pale, { fitScript: false }), /class="slide note[^"]*has-chip"/);
  assert.match(slideHTML(note, pale, { fitScript: false }), /--slide-chip-ink:#0B0B0D/i, "the brand surface is the ink when it reads on the accent");
  assert.match(slideHTML(script, pale, { fitScript: false }), /<section class="[^"]*has-chip/);
  assert.match(slideHTML(note, pale, { fitScript: false }), /--slide-chip-bg:#C8A24B/i);
  assert.doesNotMatch(slideHTML(note, dark, { fitScript: false }), /<section class="[^"]*has-chip/);
  assert.doesNotMatch(slideHTML({ kind: "verdict", headline: "Dark *verdict*" }, pale, { fitScript: false }), /<section class="[^"]*has-chip/, "dark slides keep the plain accent");
});

test("dry run 2 fixes: long high-face covers take a side card, a type-only cover before a centred slide 2 becomes a note, quotes get alt text", async () => {
  const { buildSpec, buildAltText } = await import("../src/studio-copy.mjs");
  const { gridRepair } = await import("../src/daily.mjs");
  const highLeft = { export: "/tmp/a.jpg", faces: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.25 }] };
  const nine = "The one habit that keeps members renewing every single month";
  const card = buildSpec({ slides: [{ role: "cover-top", headline: nine, sub: "Short sub" }] }, [highLeft], { format: "carousel", outDir: "/tmp/x" }).slides[0];
  assert.equal(card.kind, "cover-card");
  assert.equal(card.side, "right", "the card goes opposite the face");
  assert.equal(gridRepair({ slides: [{ kind: "cover-top", headline: nine }] }, "relayout"), null, "a 9 word headline never relayouts into cover-list");

  const copy = { slides: [
    { role: "cover-top", headline: "The Sale You Lost With *One Extra Sentence*", sub: "A simple fix for women who over explain." },
    { role: "compare", headline: "Explaining is not closing", left: { label: "Now", value: "Explain twice" }, right: { label: "Better", value: "Say it once" } },
  ] };
  const spec = buildSpec(copy, [null, null], { format: "carousel", outDir: "/tmp/x" });
  assert.equal(spec.slides[0].kind, "note");
  assert.equal(spec.slides[0].text, "The Sale You Lost With *One Extra Sentence*. A simple fix for women who over explain.");
  const photoNext = buildSpec({ slides: [copy.slides[0], { role: "point", headline: "Say it once", body: "Then stop." }] }, [null, { export: "/tmp/b.jpg" }], { format: "carousel", outDir: "/tmp/x" });
  assert.equal(photoNext.slides[0].kind, "cover", "a photo slide 2 already differs, so the cover stays");

  const alt = buildAltText({ slides: [{ kind: "quote", quote: "What If I Did?", by: "Julee Gracey", context: "before hitting post" }, { kind: "stat", number: "72%", headline: "Renew", source: "Guide" }] });
  assert.match(alt[0], /What If I Did\?/);
  assert.match(alt[1], /72%/);
});

test("dark script labels use the small-text accent; verdict headlines get a wide enough column", () => {
  const brand = resolveBrandTokens({ brand: upgradeBrandV1({ name: "lbl", colors: { text: "#F4EFE6", accent: "#E8704A", stroke: "#14202B", bg: "#14202B" } }) });
  const html = slideHTML({ kind: "script", headline: "The gym opens at six today", say: "By the time the first member walks in the floor is clean." , label: "Say this instead" }, brand, { fitScript: false });
  assert.match(html, /\.slide\.script:not\(\.is-light\) \.script-label \{ color: var\(--slide-accent-small/);
  assert.match(html, /\.verdict-main h1 \{ max-width: 82%/);
});
