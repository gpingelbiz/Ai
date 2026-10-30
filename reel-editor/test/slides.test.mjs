import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, resolveBrandTokens, tokensCSS, upgradeBrandV1 } from "../src/brandtokens.mjs";
import { loadPreset, mergeOverrides } from "../src/presets.mjs";
import { SLIDES_SCHEMA, normalizeSlides, slidesPrompt } from "../src/carousel.mjs";
import { checkSequence, expandSlides, LEGACY_SLIDE_KINDS, FAMILY_SLIDE_KINDS, normalizeSlideSpec, slideHTML } from "../src/slides.mjs";

const tokens = loadPreset("pingel-brand").brand;
const fixture = "/tmp/supplied-photo.png";

const examples = {
  photo: { headline: "Photo *headline*", photo: fixture },
  photosplit: { headline: "Photo *split*", sub: "Supporting copy", photo: fixture },
  phototop: { headline: "Photo *top*", photo: fixture },
  splittop: { headline: "Split *top*", sub: "Supporting copy", photo: fixture },
  cover: { headline: "Cover *headline*" },
  body: { headline: "Body *headline*", sub: "Supporting copy" },
  cta: { headline: "Useful *close*" },
  static: { headline: "Static *headline*" },
  "static-light": { headline: "Light *static*" },
  checklist: { title: "A *checklist*", items: [{ text: "First row", checked: true }, { text: "Second row", note: "A note" }, { text: "Third row" }] },
  compare: { title: "Compare *choices*", left: { label: "LEFT", value: "First choice" }, right: { label: "RIGHT", value: "Second choice" }, decisionLine: "Use the supplied decision." },
  postcard: { name: "Supplied Name", handle: "@supplied", postText: "Supplied *post* text." },
  notes: { title: "Supplied notes", date: "Supplied date", lines: ["First line", "Second line"] },
  story: { photo: fixture, focalPoint: { x: 0.4, y: 0.3 }, chapter: "ONE", caption: "Supplied *story* caption." },
  stat: { label: "THE NUMBER", number: "3%", headline: "Supplied *stat* meaning", sub: "Supplied line", source: "Supplied source, 2026" },
  steps: { label: "THE STEPS", headline: "Supplied *steps*", steps: ["First step", "Second step", "Third step"] },
  quote: { quote: "Supplied *quote* words.", by: "Supplied Name", context: "Supplied context" },
  evidence: { image: fixture, sourceLabel: "Supplied source" },
  "cover-top": { photo: fixture, headline: "FIVE WORDS *SIT* UP TOP", sub: "Supplied supporting copy." },
  "cover-doc": { photo: fixture, headline: "REAL WORK SHOWN", corner: "br" },
  "cover-card": { photo: fixture, headline: "THE *CARD* SITS BESIDE THE FACE", sub: "Supplied supporting copy stays on the card.", side: "left" },
  "cover-compare": { photo: fixture, headline: "SUPPLIED CHOICE", left: { label: "OLD WAY", text: "Wait for later" }, right: { label: "DECISION", text: "Act while clear" }, decision: "right" },
  "cover-list": { photo: fixture, headline: "FIVE *POINTS* WORTH KEEPING TODAY", sub: "Supplied supporting copy." },
  verdict: { headline: "THE *CLEAR* DECISION BEATS MORE NOISE" },
  note: { label: "KEEP THIS", text: "A short supplied note leaves the rest of the slide quiet." },
  script: { label: "SAY THIS INSTEAD", headline: "STOP ASKING IF THEY NEED MORE TIME", say: "Ask which part of the decision still feels unclear right now." },
};

test("slide families: every old and new kind returns a complete token-driven HTML page", () => {
  for (const kind of [...LEGACY_SLIDE_KINDS, ...FAMILY_SLIDE_KINDS]) {
    const html = slideHTML({ kind, ...examples[kind] }, tokens);
    assert.match(html, /<!doctype html>/i, kind);
    assert.match(html, new RegExp(`class="slide ${kind.replace("-", "\\-")}`), kind);
    const rules = (html.match(/<style>([\s\S]+)<\/style>/)?.[1] || "").replace(tokensCSS(tokens), "");
    assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b/i, `${kind} leaked a color literal outside tokensCSS`);
    for (const declaration of rules.matchAll(/font-family:\s*([^;]+)/gi)) assert.match(declaration[1], /var\(/, `${kind} leaked a font family outside tokensCSS`);
  }
});

test("slide families: supplied text and attributes are escaped while accent spans remain", () => {
  const html = slideHTML({ kind: "postcard", name: "<Name>", handle: '"handle"', postText: "Use *this* <script>alert(1)</script> & stop" }, tokens);
  assert.match(html, /&lt;Name&gt;/);
  assert.match(html, /&quot;handle&quot;/);
  assert.match(html, /<span class="accent">this<\/span>/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; stop/);
  assert.doesNotMatch(html, /verified|metrics/i);
});

test("slide families: every page carries the resolved brand signature when the brand declares one", () => {
  const signed = structuredClone(tokens);
  signed.signature = { kind: "edge-rule", position: "left", colorRole: "accent", thickness: 4, length: 180, opacity: 0.7 };
  for (const kind of [...LEGACY_SLIDE_KINDS, ...FAMILY_SLIDE_KINDS]) {
    const html = slideHTML({ kind, ...examples[kind] }, signed);
    assert.match(html, /class="signature-layer"/, kind);
  }
});

test("checklists: seven and eight rows split after row six without inventing continuation copy", () => {
  for (const count of [7, 8]) {
    const source = { kind: "checklist", title: "Supplied title", items: Array.from({ length: count }, (_, i) => ({ text: `Row ${i + 1}` })) };
    const expanded = expandSlides([source]);
    assert.deepEqual(expanded.map((slide) => slide.items.length), [6, count - 6]);
    assert.deepEqual(expanded.map((slide) => slide.title), ["Supplied title", "Supplied title"]);
  }
});

test("sequence checks: both covers, useful close, checklist density and fitted type are guarded", () => {
  const warnings = checkSequence([
    { kind: "cover", headline: "One two three four five six seven eight nine ten", body: "This is a full paragraph. It has another sentence and too much setup for a cover." },
    { kind: "body", headline: "And then this happens" },
    { kind: "checklist", title: "Tiny list", items: [{ text: "One" }, { text: "Two" }], rowFontSize: 30 },
    { kind: "cta", headline: "Follow for more" },
  ]);
  assert.ok(warnings.some((warning) => warning.includes("slide 1 has more than 9 words")));
  assert.ok(warnings.some((warning) => warning.includes("slide 1 contains a paragraph")));
  assert.ok(warnings.some((warning) => warning.includes("slide 2 cannot stand alone") && warning.includes("And")));
  assert.ok(warnings.some((warning) => warning.includes("checklist has fewer than 3 rows")));
  assert.ok(warnings.some((warning) => warning.includes("30px") && warning.includes("34px")));
  assert.ok(warnings.some((warning) => warning.includes("last slide is only a logo or generic follow request")));
});

test("sequence checks: a missing slide-two headline and a logo-only close are named", () => {
  const warnings = checkSequence([{ kind: "cover", headline: "A useful promise" }, { kind: "body", body: "Only setup" }, { kind: "static", logo: true }]);
  assert.ok(warnings.some((warning) => warning.includes("slide 2") && warning.includes("no headline")));
  assert.ok(warnings.some((warning) => warning.includes("last slide")));
});

test("spec contract: all content-engine kinds and both sizes are accepted; unknown kinds are clear errors", () => {
  const old = normalizeSlideSpec({ out_dir: "/tmp/out", slides: LEGACY_SLIDE_KINDS.map((kind) => ({ kind, headline: "Supplied", ...(kind.includes("photo") || kind.includes("split") ? { photo: fixture } : {}) })) });
  assert.deepEqual(old.slides.map((slide) => slide.kind), LEGACY_SLIDE_KINDS);
  assert.equal(normalizeSlideSpec({ width: 1080, height: 1080, slides: [{ kind: "static", headline: "Square" }] }).height, 1080);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "mystery" }] }), /unknown slide kind "mystery".*expected photo/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "story", caption: "No file" }] }), /needs a real photo file/);
  assert.throws(() => normalizeSlideSpec({ slides: [{ kind: "story", photo: fixture, caption: "No focal point" }] }), /needs a focalPoint/);
});

test("carousel schema and normalization remain backward compatible while carrying optional families", () => {
  assert.deepEqual(SLIDES_SCHEMA.properties.slides.items.required, ["title", "body", "reuse", "scene", "file"]);
  assert.ok(!SLIDES_SCHEMA.properties.slides.items.required.includes("kind"));
  const legacy = normalizeSlides([
    { title: "Cover", body: "", reuse: 0, scene: "", file: "" },
    { title: "Point", body: "Body", reuse: 0, scene: "", file: "" },
    { title: "Close", body: "", reuse: 0, scene: "", file: "" },
  ], { count: 3 });
  assert.ok(legacy.every((slide) => !("kind" in slide)));

  const typed = normalizeSlides([
    { kind: "checklist", title: "List", body: "", reuse: 0, scene: "", file: "", items: [{ text: "One" }, { text: "Two" }, { text: "Three" }] },
    { kind: "compare", title: "Choice", body: "", reuse: 0, scene: "", file: "", left: { label: "A", value: "A value" }, right: { label: "B", value: "B value" }, decisionLine: "Decide", orientation: "stacked" },
    { title: "Close", body: "", reuse: 0, scene: "", file: "" },
  ], { count: 3 });
  assert.deepEqual(typed.map((slide) => slide.kind || null), ["checklist", "compare", null]);
  assert.match(slidesPrompt({ transcript: "Supplied words", hook: "Hook", voice: "Voice", count: 3, cta: "", stills: [] }), /checklist, compare, postcard, or story/);
});

test("slide family switches are declared in preset defaults", () => {
  const preset = loadPreset("clean");
  assert.equal(preset.carousel.families, true);
  assert.deepEqual(preset.slides, { enabled: true, signature: true, height: 1350 });
  assert.equal(mergeOverrides(preset, { noFamilies: true }).carousel.families, false);
  assert.equal(mergeOverrides(preset, { families: true }).carousel.families, true);
});

test("paper layouts get an accent that reads on paper: a pale peach deepens, a dark oxblood stays", () => {
  const brand = (accent) => resolveBrandTokens({ brand: upgradeBrandV1({ name: "Light Test", handle: "@light", colors: { text: "#FFFFFF", accent, stroke: "#111111", bg: "#111111" } }) });
  const lightAccent = (html) => html.match(/--slide-light-accent:(#[0-9A-F]{6})/i)?.[1];
  const peach = brand("#FFB27D");
  for (const kind of ["static-light", "postcard", "notes"]) {
    const value = lightAccent(slideHTML({ kind, ...examples[kind] }, peach));
    assert.ok(value && contrast(value, peach.colors.paper) >= 4.5, `${kind}: ${value} on ${peach.colors.paper}`);
  }
  const html = slideHTML({ kind: "static-light", ...examples["static-light"] }, peach);
  assert.match(html, /\.static-light \.accent[^{]*\{ color: var\(--slide-light-accent/);
  const oxblood = brand("#9E3D3D");
  assert.equal(lightAccent(slideHTML({ kind: "static-light", ...examples["static-light"] }, oxblood)), "#9E3D3D");
});
