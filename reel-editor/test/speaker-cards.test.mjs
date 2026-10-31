import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { headshotProblems, validateManifest } from "../src/speaker-intake.mjs";
import { validatePlan } from "../src/speaker-compile.mjs";
import { resolveBrandTokens, contrast } from "../src/brandtokens.mjs";
import {
  resolveCard, cardDuration, bookingLayout, bookingUrlDisplay, logoWallLayout, titleCard, bookingCard,
  testimonialNameCard, quoteCard, logoWallCard, topicCard, speakerCardsHTML, copyCardAssets, cardChecks,
} from "../src/speaker-cards.mjs";

const canvas = { width: 1920, height: 1080, fps: 30 };
// The local client file is the integration fixture when available. Keep the suite portable to other builders/CI.
let julee;
try { julee = JSON.parse(await fs.readFile("/Users/gregpingel/Clients/Julee Gracey/brand.json", "utf8")); }
catch { julee = { name: "Julee Gracey", colors: { text: "#FFFFFF", bg: "#111111", accent: "#FFB27D" }, fonts: { display: "Playfair Display", body: "Montserrat" } }; }
const tokens = resolveBrandTokens({ brand: julee });
const other = resolveBrandTokens({ brand: {
  name: "Avery Example", colors: { text: "#102A43", bg: "#FAF7ED", accent: "#3355AA" },
  fonts: { display: "Example Wide", body: "Example Book" }, look: { pace: "calm" },
} });
const makeManifest = () => ({
  schemaVersion: 1, clientId: "julee-gracey",
  identity: { name: "Julee Gracey", roleLine: "Sales and on-camera confidence speaker", tagline: "Decide Anyway", bookingMode: "direct", bookingUrl: "https://example.com/speaking", bookingText: "Book Julee for your next event", email: "julee@example.com", phone: "+1 555 555 0100", bureau: { name: "Example Speakers Bureau", bookingText: "Ask your bureau representative" } },
  sources: [{ id: "talk", kind: "stage", path: "footage/talk.mp4", rights: "approved" }, { id: "testimonial", kind: "testimonial", path: "proof/interview.mp4", rights: "approved" }],
  rights: [{ id: "approved", status: "approved" }, { id: "waiting", status: "pending" }, { id: "unknown", status: "unknown" }],
  proof: [
    { id: "t1", kind: "testimonial-video", sourceId: "testimonial", in: 0, out: 12, attribution: { name: "Sonia Example", title: "Event organizer", org: "Example Summit" }, text: "She understood our audience.", rights: "approved" },
    { id: "q1", kind: "quote", text: "Our audience left ready to act.", attribution: { name: "Robin Example", title: "Director", org: "Example Company" }, rights: "approved" },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `logo${i}`, kind: "logo", file: `proof/logos/logo${i}.png`, relationship: "spoke-at", rights: "approved" })),
  ],
});
const manifest = makeManifest();
const resolve = (card, m = manifest, options = {}) => resolveCard(card, { manifest: m, ...options });
const good = (card, m = manifest) => {
  const result = resolve(card, m);
  assert.deepEqual(result.problems, []);
  return result.card;
};
const has = (problems, code, level = "error") => problems.some((p) => p.code === code && p.level === level);
const insert = (id, card, start, end) => ({ id, kind: "card", outputStart: start, outputEnd: end, card });
const overlay = (id, card, start, end, at = "talk1") => ({ id, at, outputStart: start, outputEnd: end, card });
const clip = (id, sourceId, start, end) => ({ id, kind: "clip", sourceId, in: 0, out: end - start, outputStart: start, outputEnd: end });
const plan = () => ({ schemaVersion: 1, canvas, items: [clip("talk1", "talk", 0, 12), insert("book", { type: "booking" }, 12, 18)], overlays: [] });

test("resolve title defaults come from identity; only surrounding whitespace is trimmed", () => {
  const m = makeManifest();
  m.identity.name = "  Julee   Gracey  ";
  const input = { type: "title", name: "Julee   Gracey" };
  const before = structuredClone(input);
  assert.deepEqual(good(input, m), { type: "title", name: "Julee   Gracey", roleLine: m.identity.roleLine, tagline: m.identity.tagline });
  assert.deepEqual(input, before);
  assert.ok(has(resolve({ type: "title", name: "Other person" }).problems, "card-provenance"));
  assert.ok(has(resolve({ type: "title", roleLine: manifest.identity.name }).problems, "card-provenance"));
  delete m.identity.name;
  assert.ok(has(resolve({ type: "title" }, m).problems, "card-name"));
  delete m.identity.roleLine;
  assert.ok(has(resolve({ type: "title" }, m).problems, "card-role"));
});

test("resolve direct booking uses approved fields, requires a route and rejects replacement copy", () => {
  const card = good({ type: "booking" });
  assert.equal(card.mode, "direct");
  assert.equal(card.url, manifest.identity.bookingUrl);
  assert.equal(card.text, manifest.identity.bookingText);
  assert.ok(has(resolve({ type: "booking", url: "https://unapproved.example" }).problems, "card-provenance"));
  assert.ok(has(resolve({ type: "booking", text: "A new pitch" }).problems, "card-provenance"));
  const m = makeManifest();
  m.identity.bookingUrl = "";
  assert.ok(has(resolve({ type: "booking" }, m).problems, "card-booking-url"));
  m.identity.bookingText = "";
  assert.ok(has(resolve({ type: "booking" }, m).problems, "card-booking-text"));
  assert.ok(has(resolve({ type: "booking", mode: "anything" }).problems, "card-booking-mode"));
});

test("bureau card omits every direct contact and uses only the approved bureau name and instruction", () => {
  const card = good({ type: "booking", mode: "bureau" });
  assert.equal(card.bureauName, manifest.identity.bureau.name);
  assert.equal(card.text, manifest.identity.bureau.bookingText);
  for (const field of ["url", "email", "phone"]) assert.equal(field in card, false);
  const rendered = bookingCard(card, { tokens });
  for (const contact of [manifest.identity.bookingUrl, manifest.identity.email, manifest.identity.phone]) assert.ok(!rendered.html.includes(contact));
  assert.match(rendered.html, /Example Speakers Bureau/);
  const m = makeManifest();
  m.identity.bookingMode = "bureau";
  assert.equal(good({ type: "booking" }, m).mode, "bureau");
  m.identity.bureau = null;
  assert.ok(has(resolve({ type: "booking" }, m).problems, "card-bureau-name"));
});

test("bureau contact leaks produce errors and are stripped even on invalid input", () => {
  for (const [key, value] of Object.entries({ url: manifest.identity.bookingUrl, email: manifest.identity.email, phone: manifest.identity.phone })) {
    const result = resolve({ type: "booking", mode: "bureau", [key]: value });
    assert.ok(has(result.problems, "card-contact-leak"), key);
    assert.ok(!JSON.stringify(result.card).includes(value));
  }
  const m = makeManifest();
  m.identity.bureau.bookingText = `Contact ${m.identity.email}`;
  assert.ok(has(resolve({ type: "booking", mode: "bureau" }, m).problems, "card-contact-leak"));
  assert.ok(has(resolve({ type: "booking", mode: "bureau", bureauName: "Unapproved bureau" }).problems, "card-provenance"));
});

test("testimonial-name resolves an exact attribution from proofId or supplied manifest-matching fields", () => {
  const card = good({ type: "testimonial-name", proofId: "t1" });
  assert.equal(card.name, "Sonia Example");
  assert.equal(card.title, "Event organizer");
  assert.equal(card.org, "Example Summit");
  assert.deepEqual(good({ type: "testimonial-name", name: card.name, title: card.title, org: card.org }), card);
  assert.ok(has(resolve({ type: "testimonial-name", proofId: "missing" }).problems, "card-proof"));
  assert.ok(has(resolve({ type: "testimonial-name", proofId: "t1", title: "CEO" }).problems, "card-provenance"));
  assert.ok(has(resolve({ type: "testimonial-name", name: "A stranger" }).problems, "card-name"));
  const m = makeManifest();
  m.proof[0].attribution.name = "";
  assert.ok(has(resolve({ type: "testimonial-name", proofId: "t1" }, m).problems, "card-name"));
});

test("quote copy and attribution are exact, with no cross-proof field mixing", () => {
  const card = good({ type: "quote", proofId: "q1" });
  assert.equal(card.text, manifest.proof[1].text);
  assert.deepEqual(good({ type: "quote", text: card.text, name: card.name, title: card.title, org: card.org }), card);
  assert.ok(has(resolve({ type: "quote", proofId: "q1", text: "She changed our company." }).problems, "card-provenance"));
  assert.ok(has(resolve({ type: "quote", text: card.text, name: "Sonia Example" }).problems, "card-proof"));
  assert.ok(has(resolve({ type: "quote", proofId: "logo0" }).problems, "card-proof"));
  const m = makeManifest();
  m.proof[1].text = Array(26).fill("word").join(" ");
  assert.ok(has(resolve({ type: "quote", proofId: "q1" }, m).problems, "card-quote-length"));
  m.proof[1].text = Array(25).fill("word").join(" ");
  assert.deepEqual(resolve({ type: "quote", proofId: "q1" }, m).problems, []);
  m.proof[1].text = "";
  assert.ok(has(resolve({ type: "quote", proofId: "q1" }, m).problems, "card-quote-text"));
});

test("logo-wall validates count, unique assets and one honest relationship", () => {
  const wall = { type: "logo-wall", relationship: "spoke-at", logos: ["logo0", "logo1", "logo2"] };
  assert.equal(good(wall).heading, "Spoke at");
  assert.equal(good({ ...wall, heading: "Selected speaking engagements" }).heading, "Selected speaking engagements");
  for (const logos of [[], ["logo0", "logo1"], Array.from({ length: 7 }, (_, i) => `logo${i}`)]) assert.ok(has(resolve({ ...wall, logos }).problems, "card-logo-count"));
  assert.ok(has(resolve({ ...wall, logos: ["logo0", "logo0", "logo1"] }).problems, "card-logo-duplicate"));
  assert.ok(has(resolve({ ...wall, logos: ["logo0", "logo1", "missing"] }).problems, "card-logo"));
  assert.ok(has(resolve({ ...wall, heading: "Featured in" }).problems, "card-logo-relationship"));
  assert.ok(has(resolve({ ...wall, relationship: "trusted-by" }).problems, "card-logo-relationship"));
  assert.ok(has(resolve({ ...wall, heading: "one two three four five six seven eight" }).problems, "card-heading-length"));
  const m = makeManifest();
  m.proof[2].relationship = "client";
  assert.ok(has(resolve(wall, m).problems, "card-logo-relationship"));
  m.proof[2].relationship = "spoke-at";
  delete m.proof[2].file;
  assert.ok(has(resolve(wall, m).problems, "card-logo"));
});

test("all four logo relationships keep separate headings", () => {
  for (const [relationship, heading] of Object.entries({ "spoke-at": "Spoke at", client: "Hired by", "featured-in": "Featured in", "available-at": "Available at" })) {
    const m = makeManifest();
    for (const p of m.proof.filter((p) => p.kind === "logo")) p.relationship = relationship;
    assert.equal(good({ type: "logo-wall", relationship, logos: ["logo0", "logo1", "logo2"] }, m).heading, heading);
  }
});

test("topic is the short-copy exception and must be under eight words", () => {
  assert.deepEqual(good({ type: "topic", text: "  Sales confidence  " }), { type: "topic", text: "Sales confidence" });
  assert.ok(has(resolve({ type: "topic", text: "" }).problems, "card-topic-length"));
  assert.ok(has(resolve({ type: "topic", text: "one two three four five six seven eight" }).problems, "card-topic-length"));
  assert.ok(has(resolve({ type: "topic", text: "Valid", inventedLabel: "Invented" }).problems, "card-provenance"));
  assert.ok(has(resolve(null).problems, "card-type"));
  assert.ok(has(resolve({ type: "new-type" }).problems, "card-type"));
});

test("all proof rights are warnings in drafts, errors in finals, including absent rights records", () => {
  for (const rights of ["waiting", "unknown", "missing", undefined]) {
    const m = makeManifest();
    m.proof[0].rights = rights;
    assert.ok(has(resolve({ type: "testimonial-name", proofId: "t1" }, m).problems, "card-rights", "warn"));
    assert.ok(has(resolve({ type: "testimonial-name", proofId: "t1" }, m, { final: true }).problems, "card-rights"));
  }
  const m = makeManifest();
  m.proof[2].rights = "waiting";
  assert.ok(has(resolve({ type: "logo-wall", relationship: "spoke-at", logos: ["logo0", "logo1", "logo2"] }, m).problems, "card-rights", "warn"));
});

test("quote timing clamps to 5–8 seconds, rounds to frames and follows reading time", () => {
  for (const [n, expected] of [[1, 5], [9, 5], [12, 5.5], [15, 6.5], [18, 7.5], [25, 8]]) {
    assert.equal(cardDuration({ type: "quote", text: Array(n).fill("word").join(" ") }), expected);
  }
  const time = cardDuration({ type: "quote", text: Array(11).fill("word").join(" ") });
  assert.equal(time * 30, Math.round(time * 30));
  assert.ok(time >= 11 / 3 + 1.5);
  for (const type of ["title", "booking", "testimonial-name", "logo-wall", "topic"]) assert.ok(cardDuration({ type }) >= 4);
});

for (const n of [3, 4, 5, 6]) test(`logo wall ${n}: equal heights, even gaps, safe inset and object-fit contain`, () => {
  const boxes = logoWallLayout(n, { tokens });
  assert.equal(boxes.length, n);
  assert.equal(boxes[0].x, 96);
  assert.ok(Math.abs(boxes.at(-1).x + boxes.at(-1).w - 1824) < 1e-7);
  for (let i = 1; i < n; i++) {
    assert.equal(boxes[i].h, boxes[0].h);
    assert.equal(boxes[i].w, boxes[0].w);
    assert.ok(Math.abs(boxes[i].x - boxes[i - 1].x - boxes[0].w - tokens.spacing.lg) < 1e-7);
  }
  const card = good({ type: "logo-wall", relationship: "spoke-at", logos: Array.from({ length: n }, (_, i) => `logo${i}`) });
  const rendered = logoWallCard(card, { tokens, manifest, clientDir: "/tmp/client" });
  assert.equal((rendered.html.match(/<img /g) || []).length, n);
  assert.match(rendered.css, /object-fit:contain/);
  assert.equal(rendered.assets.length, n);
});

test("logo layout rejects counts outside its contract", () => {
  for (const n of [0, 2, 7, 3.5]) assert.throws(() => logoWallLayout(n, { tokens }), /3 to 6/);
});

test("booking shrinks to its minimum, wraps very long names and keeps its route readable", () => {
  const card = good({ type: "booking" });
  const ordinary = bookingLayout(card, { tokens });
  assert.equal(ordinary.name.fontSize, 84);
  assert.ok(ordinary.route.fontSize >= 52);
  assert.ok(ordinary.role.fontSize >= 40);
  assert.ok(ordinary.y >= 96);
  const long = bookingLayout({ ...card, name: "Professor Alexandria Catherine Montgomery-Worthington of the International Leadership Institute" }, { tokens });
  assert.equal(long.name.fontSize, 84);
  assert.ok(long.name.lines > 1);
  assert.ok(long.fits);
  const oversized = structuredClone(tokens);
  oversized.typeScale.xl = 140;
  const shrunk = bookingLayout({ ...card, name: "Alexandria Catherine Montgomery-Worthington" }, { tokens: oversized });
  assert.ok(shrunk.name.fontSize < 140);
  assert.ok(shrunk.name.fontSize >= 84);
  assert.equal(bookingLayout({ ...card, name: "word ".repeat(200) }, { tokens }).fits, false);
});

test("six pure renderers use escaped copy, token CSS and deterministic absolute GSAP calls", () => {
  const specs = [
    [titleCard, { type: "title" }], [bookingCard, { type: "booking" }], [testimonialNameCard, { type: "testimonial-name", proofId: "t1" }],
    [quoteCard, { type: "quote", proofId: "q1" }], [logoWallCard, { type: "logo-wall", relationship: "spoke-at", logos: ["logo0", "logo1", "logo2"] }], [topicCard, { type: "topic", text: "Sales confidence" }],
  ];
  for (const [render, spec] of specs) {
    const card = good(spec), options = { tokens, manifest, clientDir: "/tmp/client", start: 10, end: 18 };
    const before = structuredClone(card);
    const result = render(card, options);
    assert.deepEqual(card, before);
    assert.deepEqual(render(card, options), result);
    assert.ok(result.durationHints.enter <= 0.3);
    assert.ok(result.durationHints.exit <= 0.2);
    assert.match(result.css, /--brand-display-font/);
    assert.match(result.css, /--brand-body-font/);
    const calls = [];
    vm.runInNewContext(result.timeline, { tl: { fromTo: (...args) => calls.push(args) } });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][3], 10);
    assert.ok(Math.abs((calls[1][3] + calls[1][2].duration) - 18) < 1e-7);
    assert.equal(calls[0][2].immediateRender, false);
    assert.equal(calls[1][2].immediateRender, false);
  }
});

test("six-second booking and four-second attribution hold fully legible; no fade steals reading time", () => {
  for (const [render, spec, seconds] of [[bookingCard, { type: "booking" }, 6], [testimonialNameCard, { type: "testimonial-name", proofId: "t1" }, 4]]) {
    const result = render(good(spec), { tokens, start: 10, end: 10 + seconds });
    assert.equal(result.durationHints.fullyLegible, seconds);
    assert.equal(result.durationHints.enter, 0);
    assert.equal(result.durationHints.exit, 0);
  }
  assert.ok(bookingCard(good({ type: "booking" }), { tokens, start: 0, end: 6 }).durationHints.fullyLegible >= 6);
});

test("lower third stays below the middle 40% and uses an 88% brand plate and radius", () => {
  const r = testimonialNameCard(good({ type: "testimonial-name", proofId: "t1" }), { tokens });
  assert.ok(r.layout.y >= 1080 * 0.7);
  assert.equal(r.layout.x, 1920 * 0.05);
  assert.equal(r.layout.y + r.layout.h, 1080 * 0.95);
  assert.match(r.css, /background:var\(--sc-surface\)/);
  assert.match(r.css, /border-radius:var\(--brand-radius-md\)/);
});

test("speakerCardsHTML includes inserts, absolute overlay times and review provenance; never rewrites input", () => {
  const p = plan();
  p.overlays.push(overlay("name", { type: "title" }, 0.017, 4.017));
  const before = structuredClone(p);
  const fragment = speakerCardsHTML(p, { manifest, tokens });
  assert.deepEqual(p, before);
  assert.equal(fragment.review.length, 2);
  assert.equal(fragment.review[0].id, "name");
  assert.equal(fragment.review[0].start, 1 / 30);
  assert.equal(fragment.review[1].type, "booking");
  assert.match(fragment.timeline, /tl.fromTo/);
  assert.match(fragment.html, /speaker-cards/);
  assert.deepEqual(fragment.problems, []);
  assert.deepEqual(speakerCardsHTML(p, { manifest, tokens }), fragment);
  assert.throws(() => speakerCardsHTML({ ...p, overlays: [overlay("bad", { type: "title", name: "Invented" }, 0, 4)] }, { manifest, tokens }), /bad.*name must exactly/);
});

test("draft proof warnings travel to the review page; finals refuse unresolved rights", () => {
  const m = makeManifest();
  m.proof[1].rights = "waiting";
  const p = plan();
  p.items = [insert("quote", { type: "quote", proofId: "q1" }, 0, 6), insert("book", { type: "booking" }, 6, 12)];
  const f = speakerCardsHTML(p, { manifest: m, tokens });
  assert.ok(has(f.review[0].problems, "card-rights", "warn"));
  assert.ok(has(f.problems, "card-rights", "warn"));
  assert.throws(() => speakerCardsHTML(p, { manifest: m, tokens, final: true }), /quote.*rights.*pending/);
});

test("resolved time shapes are supported and invalid timing names the card", () => {
  const p = { canvas, items: [{ id: "book", kind: "card", start: 0, end: 6, card: { type: "booking" } }] };
  assert.equal(speakerCardsHTML(p, { manifest, tokens }).review[0].end, 6);
  p.items[0] = { id: "book", kind: "card", output: { start: 0, end: 6 }, card: { type: "booking" } };
  assert.equal(speakerCardsHTML(p, { manifest, tokens }).review[0].end, 6);
  delete p.items[0].output;
  assert.ok(has(cardChecks(p, { manifest }), "card-time"));
  assert.throws(() => speakerCardsHTML(p, { manifest, tokens }), /book.*invalid resolved output/);
});

test("preflight requires a matching testimonial name within one second, held on that testimonial", () => {
  const p = plan();
  p.items[0] = clip("test1", "testimonial", 0, 12);
  assert.ok(has(cardChecks(p, { manifest }), "card-testimonial-name"));
  p.overlays = [overlay("name", { type: "testimonial-name", proofId: "t1" }, 0.5, 5, "test1")];
  assert.deepEqual(cardChecks(p, { manifest }), []);
  p.overlays[0].outputStart = 1;
  assert.deepEqual(cardChecks(p, { manifest }), []);
  p.overlays[0].outputStart = 1.1;
  assert.ok(has(cardChecks(p, { manifest }), "card-testimonial-name"));
  p.overlays[0].outputStart = 0;
  p.overlays[0].outputEnd = 3.9;
  assert.ok(has(cardChecks(p, { manifest }), "card-testimonial-name"));
  assert.ok(has(cardChecks(p, { manifest }), "card-hold"));
  p.overlays[0].outputEnd = 5;
  p.overlays[0].card.proofId = "q1";
  assert.ok(has(cardChecks(p, { manifest }), "card-testimonial-name"));
  const m = makeManifest();
  m.proof[0].in = 1;
  p.overlays[0].card.proofId = "t1";
  assert.ok(has(cardChecks(p, { manifest: m }), "card-testimonial-name"));
});

test("preflight requires one final booking insert held at least six seconds", () => {
  const p = plan();
  assert.deepEqual(cardChecks(p, { manifest }), []);
  p.items[1].outputEnd = 16.9;
  assert.ok(has(cardChecks(p, { manifest }), "card-hold"));
  p.items[1].outputEnd = 18;
  assert.deepEqual(cardChecks(p, { manifest }), []);
  p.items.push(clip("late", "talk", 17, 20));
  assert.ok(has(cardChecks(p, { manifest }), "card-booking-last"));
  p.items.splice(1, 1);
  assert.ok(has(cardChecks(p, { manifest }), "card-booking-missing"));
  p.items.push(insert("book1", { type: "booking" }, 20, 26), insert("book2", { type: "booking" }, 26, 32));
  assert.ok(has(cardChecks(p, { manifest }), "card-booking-count"));
});

test("overlay collisions use time and reserved geometry, allowing top labels beside lower thirds", () => {
  const p = plan();
  p.overlays = [overlay("a", { type: "topic", text: "One" }, 0, 4), overlay("b", { type: "title" }, 3, 7)];
  assert.ok(has(cardChecks(p, { manifest }), "card-overlay-collision"));
  p.overlays[1].outputStart = 4;
  assert.ok(!has(cardChecks(p, { manifest }), "card-overlay-collision"));
  p.overlays[1] = overlay("b", { type: "testimonial-name", proofId: "t1" }, 0, 4);
  assert.ok(!has(cardChecks(p, { manifest }), "card-overlay-collision"));
  p.overlays[0] = overlay("a", { type: "testimonial-name", proofId: "t1" }, 0, 4);
  assert.ok(has(cardChecks(p, { manifest }), "card-overlay-collision"));
});

test("preflight detects topic limits, bad mode, text size, unknown sources and proof reading holds", () => {
  const p = plan();
  p.overlays = Array.from({ length: 4 }, (_, i) => overlay(`topic${i}`, { type: "topic", text: "Short topic" }, i * 3, i * 3 + 2));
  assert.ok(has(cardChecks(p, { manifest }), "card-topic-count"));
  p.overlays = [overlay("bad-book", { type: "booking", nameFontSize: 30 }, 0, 6)];
  assert.ok(has(cardChecks(p, { manifest }), "card-mode"));
  assert.ok(has(cardChecks(p, { manifest }), "card-text-size"));
  p.items[0].sourceId = "missing";
  assert.ok(has(cardChecks(p, { manifest }), "card-source"));
  p.items[0] = insert("q", { type: "quote", proofId: "q1" }, 0, 4);
  assert.ok(has(cardChecks(p, { manifest }), "card-hold"));
  p.items[0].outputEnd = 9;
  assert.ok(has(cardChecks(p, { manifest }), "card-hold"));
});

test("Greg identity is refused in raw/resolved cards, arbitrary plan fields and brand tokens", () => {
  for (const leak of ["Greg Pingel", "@officialgregpingel", "PINGEL"]) {
    assert.ok(has(resolve({ type: "topic", text: leak }).problems, "card-identity"));
    const p = { ...plan(), note: leak };
    assert.ok(has(cardChecks(p, { manifest }), "card-identity"));
    assert.throws(() => speakerCardsHTML(p, { manifest, tokens }), /Greg/);
    const bad = structuredClone(tokens);
    bad.identity.name = leak;
    assert.throws(() => titleCard(good({ type: "title" }), { tokens: bad }), /Greg/);
  }
  const m = makeManifest();
  m.identity.name = "Greg Pingel";
  assert.ok(has(resolve({ type: "title" }, m).problems, "card-identity"));
  const p = { ...plan(), brand: { file: "/Users/gregpingel/Clients/Julee Gracey/brand.json" } };
  assert.ok(!has(cardChecks(p, { manifest }), "card-identity"), "the supplied client brand path is infrastructure");
});

test("HTML escapes all displayed fields and never inserts unapproved source markup", () => {
  const m = makeManifest();
  m.identity.name = '<Julee & "Grace">';
  m.identity.roleLine = "<script>alert(1)</script>";
  const p = plan();
  const fragment = speakerCardsHTML(p, { manifest: m, tokens });
  assert.match(fragment.html, /&lt;Julee &amp; &quot;Grace&quot;&gt;/);
  assert.match(fragment.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!fragment.html.includes("<script>"));
  const card = good({ type: "topic", text: '<img src="x">' });
  assert.ok(!topicCard(card, { tokens }).html.includes('<img src="x">'));
  const custom = structuredClone(tokens);
  custom.type.display.family = "</style><script>bad()</script>";
  assert.ok(!titleCard(good({ type: "title" }), { tokens: custom }).css.includes("</style>"));
});

test("two very different brands replace every authored color/font; renderer has no private palette", () => {
  for (const render of [titleCard, bookingCard, testimonialNameCard, quoteCard, logoWallCard, topicCard]) {
    const spec = render === bookingCard ? { type: "booking" } : render === testimonialNameCard ? { type: "testimonial-name", proofId: "t1" } : render === quoteCard ? { type: "quote", proofId: "q1" } : render === logoWallCard ? { type: "logo-wall", relationship: "spoke-at", logos: ["logo0", "logo1", "logo2"] } : render === topicCard ? { type: "topic", text: "Sales" } : { type: "title" };
    const card = good(spec), a = render(card, { tokens, manifest, clientDir: "/tmp/client" }), b = render(card, { tokens: other, manifest, clientDir: "/tmp/client" });
    for (const role of ["ink", "accent", "surface"]) {
      assert.ok(a.css.includes(tokens.colors[role]));
      assert.ok(b.css.includes(other.colors[role]));
      assert.ok(!b.css.includes(tokens.colors[role]));
    }
    for (const font of [tokens.type.display.family, tokens.type.body.family]) { assert.ok(a.css.includes(font)); assert.ok(!b.css.includes(font)); }
    for (const font of [other.type.display.family, other.type.body.family]) assert.ok(b.css.includes(font));
    const colors = a.css.match(/#[\da-f]{6}\b/gi) || [];
    assert.ok(colors.every((c) => Object.values(tokens.colors).some((v) => v.toLowerCase() === c.toLowerCase())));
    assert.ok(!/Anton|Inter[,;"\s]|#C8A24B|#F5F1E8/i.test(b.css));
  }
});

test("contrast falls back to a readable brand pair and logs just one line per fragment", () => {
  const bad = structuredClone(tokens);
  bad.colors.ink = "#EEEEEE";
  bad.colors.surface = "#FFFFFF";
  bad.colors.paper = "#111111";
  const p = plan();
  p.overlays = [overlay("title", { type: "title" }, 0, 4), overlay("topic", { type: "topic", text: "Sales" }, 6, 10)];
  const logs = [];
  const f = speakerCardsHTML(p, { manifest, tokens: bad, log: (line) => logs.push(line) });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /low contrast/);
  const ink = f.css.match(/--sc-ink:(#[\da-f]{6})/i)[1], surface = f.css.match(/--sc-surface:(#[\da-f]{6})/i)[1];
  assert.ok(contrast(ink, surface) >= 4.5);
  assert.ok(Object.values(bad.colors).includes(ink));
  assert.ok(Object.values(bad.colors).includes(surface));
  bad.colors.paper = "#EFEFEF";
  assert.throws(() => titleCard(good({ type: "title" }), { tokens: bad }), /no text\/background pair/);
});

test("brand and canvas are mandatory client inputs, never silent Greg defaults", () => {
  assert.throws(() => titleCard(good({ type: "title" })), /need resolved client/);
  assert.throws(() => titleCard(good({ type: "title" }), { tokens: {} }), /need resolved client/);
  assert.throws(() => titleCard(good({ type: "title" }), { tokens, canvas: { width: 1080, height: 1920 } }), /1920x1080/);
  assert.throws(() => titleCard(good({ type: "title" }), { tokens, canvas: { fps: 24 } }), /30 fps/);
});

test("copyCardAssets copies exact logo/font bytes, rewrites paths and preserves original fragment and files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "speaker-cards-"));
  try {
    const m = makeManifest();
    const files = [];
    for (let i = 0; i < 3; i++) {
      const file = path.join(dir, `logo & ${i}.png`);
      await fs.writeFile(file, Buffer.from(`original logo ${i}`));
      m.proof[i + 2].file = file;
      files.push(file);
    }
    const local = structuredClone(tokens);
    local.type.display.file = path.join(dir, 'display " font.ttf');
    await fs.writeFile(local.type.display.file, "exact font bytes");
    const p = { canvas, items: [insert("wall", { type: "logo-wall", relationship: "spoke-at", logos: ["logo0", "logo1", "logo2"] }, 0, 5), insert("book", { type: "booking" }, 5, 11)] };
    const fragment = speakerCardsHTML(p, { manifest: m, tokens: local });
    const before = structuredClone(fragment);
    const output = path.join(dir, "project");
    const copied = await copyCardAssets(fragment, output);
    assert.deepEqual(fragment, before);
    assert.equal(copied.assets.length, 4);
    for (const asset of copied.assets) {
      assert.deepEqual(await fs.readFile(path.join(output, asset.file)), await fs.readFile(asset.source));
      assert.match(asset.file, /^assets\/speaker-cards\/[a-f0-9]{20}\.(png|ttf)$/);
    }
    assert.ok(!copied.html.includes("speaker-asset-"));
    assert.ok(!copied.css.includes('display \\" font.ttf'));
    assert.match(copied.css, /src: url\("assets\/speaker-cards\//);
    assert.deepEqual(await copyCardAssets(fragment, output), copied);
    assert.equal(await fs.readFile(files[0], "utf8"), "original logo 0");
    const missing = structuredClone(fragment);
    missing.assets[0].source = path.join(dir, "missing.png");
    await assert.rejects(copyCardAssets(missing, output), /speaker card.*cannot read.*missing.png/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("relative logo files require a client directory and are resolved inside that directory", () => {
  const card = good({ type: "logo-wall", relationship: "spoke-at", logos: ["logo0", "logo1", "logo2"] });
  assert.throws(() => logoWallCard(card, { tokens, manifest }), /clientDir is required.*logo0/);
  assert.equal(logoWallCard(card, { tokens, manifest, clientDir: "/tmp/speaker-client" }).assets[0].source, "/tmp/speaker-client/proof/logos/logo0.png");
});

test("readable holds include the whole quote and logo reading window without losing time to animation", () => {
  const m = makeManifest();
  m.proof[1].text = Array(25).fill("Exact").join(" ");
  const card = good({ type: "quote", proofId: "q1" }, m);
  const q = quoteCard(card, { tokens });
  assert.equal(q.durationHints.recommended, 8);
  assert.equal(q.durationHints.fullyLegible, 8);
  assert.ok(q.html.includes(card.text));
  const wall = logoWallCard(good({ type: "logo-wall", relationship: "spoke-at", logos: ["logo0", "logo1", "logo2"] }), { tokens, manifest, clientDir: "/tmp/client", start: 0, end: 4 });
  assert.equal(wall.durationHints.fullyLegible, 4);
  assert.equal(good({ type: "quote", proofId: "t1" }).text, manifest.proof[0].text);
});

test("text overflow fails at readable minimums, including long attributions and top overlays", () => {
  const m = makeManifest(), p = plan();
  m.identity.name = "LongName ".repeat(200);
  assert.ok(has(cardChecks(p, { manifest: m, tokens }), "card-text-fit"));
  assert.throws(() => speakerCardsHTML(p, { manifest: m, tokens }), /book.*minimum readable/);
  m.identity.name = manifest.identity.name;
  m.proof[0].attribution.title = "Long title ".repeat(50);
  p.overlays = [overlay("name", { type: "testimonial-name", proofId: "t1" }, 0, 5)];
  assert.ok(has(cardChecks(p, { manifest: m, tokens }), "card-text-fit"));
  assert.throws(() => speakerCardsHTML(p, { manifest: m, tokens }), /name.*minimum readable/);
  p.overlays = [overlay("topic", { type: "topic", text: "W".repeat(1000) }, 0, 4)];
  assert.ok(has(cardChecks(p, { manifest: m, tokens }), "card-text-fit"));
  assert.throws(() => speakerCardsHTML(p, { manifest: m, tokens }), /topic.*minimum readable/);
});

test("direct pure rendering also aligns times to frames and rejects empty/reversed spans", () => {
  const card = good({ type: "title" });
  const r = titleCard(card, { tokens, start: 0.017, end: 4.017 });
  const calls = [];
  vm.runInNewContext(r.timeline, { tl: { fromTo: (...args) => calls.push(args) } });
  assert.equal(calls[0][3], 1 / 30);
  for (const [start, end] of [[2, 1], [-1, 2], [0.01, 0.015], [0, NaN]]) assert.throws(() => titleCard(card, { tokens, start, end }), /invalid output/);
  const p = { canvas, items: [insert("tiny", { type: "booking" }, 0.01, 0.015)] };
  assert.ok(has(cardChecks(p, { manifest }), "card-time"));
});

test("source rights remain warnings in drafts and block final fragments; invalid ranges name the item", () => {
  const m = makeManifest(), p = plan();
  m.sources[0].rights = "waiting";
  assert.ok(has(cardChecks(p, { manifest: m }), "card-source-rights", "warn"));
  assert.ok(has(cardChecks(p, { manifest: m, final: true }), "card-source-rights"));
  assert.throws(() => speakerCardsHTML(p, { manifest: m, tokens, final: true }), /talk1.*rights.*pending/);
  p.items[0].out = p.items[0].in;
  assert.ok(has(cardChecks(p, { manifest: m }), "card-source-range"));
  m.sources[0].rights = "approved";
  p.items[0].out = 12;
  assert.deepEqual(cardChecks(p, { manifest: m, final: true }), []);
  assert.ok(speakerCardsHTML(p, { manifest: m, tokens, final: true }).html.includes("Book Julee"));
});

test("named client fonts never alias repository defaults, while supplied client font files remain assets", () => {
  const p = plan();
  const named = speakerCardsHTML(p, { manifest, tokens });
  assert.equal(named.assets.length, 0);
  assert.ok(!/Anton-Regular|Inter\.ttf/.test(named.css));
  assert.ok(named.css.includes("Playfair Display"));
  const local = structuredClone(tokens);
  local.type.display.file = "/tmp/client/fonts/Display.ttf";
  local.type.body.file = "/tmp/client/fonts/Body.ttf";
  const fragment = speakerCardsHTML(p, { manifest, tokens: local });
  assert.equal(fragment.assets.length, 2);
  assert.ok(fragment.assets.every((a) => a.font));
  assert.ok(fragment.css.includes("/tmp/client/fonts/Display.ttf"));
});

const photoBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=", "base64");
async function headshotFixture(t) {
  const clientDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "speaker-headshot-")));
  t.after(() => fs.rm(clientDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(clientDir, "proof"));
  await fs.writeFile(path.join(clientDir, "proof", "client & photo.png"), photoBytes);
  const m = makeManifest();
  m.identity.headshot = "proof/client & photo.png";
  m.identity.headshotRights = "approved";
  return { m, clientDir, source: path.join(clientDir, m.identity.headshot) };
}

test("booking URL display removes protocol, www, query, fragment and trailing slash, preserving paths and case", () => {
  for (const [input, expected] of [
    ["https://www.juleegracey.com/", "juleegracey.com"], ["http://www.site.com/speaking/", "site.com/speaking"],
    [" HTTPS://WWW.Site.com/Speaking/?utm_source=reel#book ", "Site.com/Speaking"],
    ["site.com/speaking?campaign=one", "site.com/speaking"], ["www.site.com///", "site.com"],
    ["https://site.com?redirect=/other/", "site.com"], ["site.com/speaking#booking", "site.com/speaking"],
    ["", ""], [undefined, ""],
  ]) assert.equal(bookingUrlDisplay(input), expected);
  const m = makeManifest();
  m.identity.bookingUrl = "https://www.juleegracey.com/speaking/?utm_source=reel";
  const p = plan(), f = speakerCardsHTML(p, { manifest: m, tokens });
  assert.match(f.html, />juleegracey.com\/speaking<\/div>/);
  assert.ok(!f.html.includes("utm_source"));
  assert.ok(f.review[0].text.includes(m.identity.bookingUrl));
  assert.equal(resolve({ type: "booking" }, m).card.url, m.identity.bookingUrl);
});

test("all card types render at their readable font minimums and preflight flags smaller authored sizes", () => {
  const specs = [
    [titleCard, { type: "title" }, { nameFontSize: 84, roleFontSize: 40, taglineFontSize: 30 }, [84, 40, 30]],
    [bookingCard, { type: "booking" }, { nameFontSize: 84, roleFontSize: 40, textFontSize: 40, urlFontSize: 52 }, [84, 40, 40, 52]],
    [testimonialNameCard, { type: "testimonial-name", proofId: "t1" }, { nameFontSize: 60, titleFontSize: 40, orgFontSize: 36 }, [60, 40, 36]],
    [quoteCard, { type: "quote", proofId: "q1" }, { fontSize: 54, nameFontSize: 30, titleFontSize: 30, orgFontSize: 30 }, [54, 30]],
    [logoWallCard, { type: "logo-wall", relationship: "spoke-at", logos: ["logo0", "logo1", "logo2"] }, { headingFontSize: 54 }, [54]],
    [topicCard, { type: "topic", text: "Sales confidence" }, { fontSize: 44 }, [44]],
  ];
  const small = structuredClone(tokens);
  for (const key of Object.keys(small.typeScale)) small.typeScale[key] = 1;
  for (const [render, spec, minima, expected] of specs) {
    const r = render(good(spec), { tokens: small, manifest, clientDir: "/tmp/client" });
    assert.deepEqual([...r.html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1])), expected, spec.type);
    for (const [key, min] of Object.entries(minima)) {
      const entry = { ...spec, [key]: min - 1 };
      const p = plan();
      if (["testimonial-name", "topic"].includes(spec.type)) p.overlays = [overlay("small", entry, 0, 6)];
      else p.items.unshift(insert("small", entry, 0, 6));
      assert.ok(cardChecks(p, { manifest, tokens: small }).some((p) => p.code === "card-text-size" && p.message.includes(`${key} is below ${min}px`)), `${spec.type}.${key}`);
    }
  }
  const r = testimonialNameCard(good({ type: "testimonial-name", proofId: "t1" }), { tokens: small });
  assert.ok(Number(r.html.match(/--sc-bold:(\d+)/)[1]) >= 700);
  assert.match(r.html, /class="sc-body sc-route" style="font-size:60px"/);
  assert.match(r.css, /\.sc-testimonial-name, \.sc-topic \{ background:color-mix\(in srgb, var\(--sc-surface\) 88%, transparent\)/);
  assert.match(r.css, /border-radius:var\(--brand-radius-md\)/);
  const title = titleCard(good({ type: "title" }), { tokens: small, mode: "overlay" });
  assert.equal(title.layout.name.fontSize, 72);
  const p = plan();
  p.overlays = [overlay("small-title", { type: "title", nameFontSize: 71 }, 0, 4)];
  assert.ok(cardChecks(p, { manifest, tokens: small }).some((p) => p.code === "card-text-size" && /below 72px/.test(p.message)));
});

test("headshot booking and inserted title share a safe, centred two-column layout; overlays stay over footage", async (t) => {
  const { m, clientDir, source } = await headshotFixture(t);
  for (const [type, render] of [["booking", bookingCard], ["title", titleCard]]) {
    const result = resolve({ type }, m, { clientDir });
    assert.deepEqual(result.problems, []);
    const r = render(result.card, { tokens, clientDir, manifest: m });
    assert.ok(r.layout.fits);
    assert.equal(r.layout.y + r.layout.h / 2, 540);
    assert.equal(r.layout.photo.y, 108);
    assert.equal(r.layout.photo.h, 864);
    assert.ok(r.layout.photo.w >= 1920 * 0.4 && r.layout.photo.w <= 1920 * 0.45);
    assert.ok(r.layout.x + r.layout.w + tokens.spacing.lg <= r.layout.photo.x);
    assert.equal(r.layout.photo.x + r.layout.photo.w, 1824);
    assert.ok(r.layout.name.fontSize >= 84);
    assert.ok(r.layout.role.fontSize >= 40);
    assert.match(r.html, /<img class="sc-headshot"/);
    assert.match(r.css, /object-fit:cover; object-position:center top/);
    assert.deepEqual(r.assets.map((a) => a.source), [source]);
    assert.ok(!/greg\s*pingel|officialgregpingel|pingel/i.test(r.html + r.timeline + r.css));
    if (type === "booking") {
      assert.ok(r.layout.text.fontSize >= 40);
      assert.ok(r.layout.route.fontSize >= 52);
      assert.equal(r.durationHints.fullyLegible, 6);
    }
  }
  const p = plan();
  p.overlays = [overlay("title", { type: "title" }, 0, 4)];
  const f = speakerCardsHTML(p, { manifest: m, clientDir, tokens });
  assert.equal(f.assets.filter((a) => a.headshot).length, 1, "only the booking insert uses the photo");
  assert.equal(f.review[0].layout.photo, undefined);
  assert.equal(f.review[1].layout.photo.h, 864);
  assert.throws(() => speakerCardsHTML(p, { manifest: m, tokens }), /book.*clientDir is required/);
});

test("no-headshot booking fills the safe width and vertically centres its larger text block", () => {
  const card = good({ type: "booking" }), r = bookingCard(card, { tokens });
  assert.equal(r.layout.photo, null);
  assert.equal(r.layout.x, 96);
  assert.equal(r.layout.w, 1728);
  assert.equal(r.layout.y + r.layout.h / 2, 540);
  assert.ok(r.layout.name.fontSize >= 84 && r.layout.route.fontSize >= 52);
  assert.ok(!r.html.includes('<img'));
  assert.deepEqual(r.assets, []);
  assert.match(r.html, new RegExp(`color:${tokens.colors.accent}`));
  const low = structuredClone(tokens);
  low.colors.accent = low.colors.surface;
  assert.match(bookingCard(card, { tokens: low }).html, new RegExp(`color:${tokens.colors.ink}`));
});

test("headshot validation rejects missing files, non-images, extension spoofing and escaping relative paths", async (t) => {
  const { m, clientDir, source } = await headshotFixture(t);
  assert.deepEqual(headshotProblems(clientDir, m), []);
  m.identity.headshot = source;
  assert.deepEqual(headshotProblems(null, m), []);
  m.identity.headshot = "proof/missing.jpg";
  assert.match(headshotProblems(clientDir, m)[0].message, /identity.headshot.*file not found.*missing.jpg/);
  assert.ok(validateManifest(clientDir, m).some((p) => p.id === "identity.headshot" && p.level === "error"));
  m.identity.headshot = "proof/video.mp4";
  assert.match(headshotProblems(clientDir, m)[0].message, /must be jpg/);
  m.identity.headshot = "proof/fake.png";
  await fs.writeFile(path.join(clientDir, m.identity.headshot), "not a photo");
  assert.match(headshotProblems(clientDir, m)[0].message, /not a png image/);
  for (const headshot of ["../outside.png", 12, ""]) {
    m.identity.headshot = headshot;
    assert.equal(headshotProblems(clientDir, m)[0].level, "error");
  }
  await fs.symlink(source, path.join(clientDir, "proof", "inside.png"));
  m.identity.headshot = "proof/inside.png";
  assert.deepEqual(headshotProblems(clientDir, m), []);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "speaker-outside-photo-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "photo.png"), photoBytes);
  await fs.symlink(path.join(outside, "photo.png"), path.join(clientDir, "proof", "outside.png"));
  m.identity.headshot = "proof/outside.png";
  assert.match(headshotProblems(clientDir, m)[0].message, /symlink escapes/);
  m.identity.headshot = source;
  m.identity.headshotRights = 42;
  assert.ok(headshotProblems(clientDir, m).some((p) => p.level === "error" && /rights id/.test(p.message)));
  m.identity.headshotRights = "approved";
  assert.ok(headshotProblems(clientDir, { ...m, rights: null }).some((p) => p.level === "warn"));
  delete m.identity.headshot;
  assert.match(headshotProblems(clientDir, m)[0].message, /requires a headshot/);
});

test("JPEG, PNG, WebP and HEIC signatures validate only with matching allowed extensions", async (t) => {
  const { m, clientDir } = await headshotFixture(t);
  for (const [ext, bytes] of [["jpg", Buffer.from([255, 216, 255, 224])], ["jpeg", Buffer.from([255, 216, 255, 224])],
    ["png", photoBytes], ["webp", Buffer.from("RIFF1234WEBPVP8 ")], ["heic", Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic")]]) {
    m.identity.headshot = `proof/photo.${ext.toUpperCase()}`;
    await fs.writeFile(path.join(clientDir, m.identity.headshot), bytes);
    assert.deepEqual(headshotProblems(clientDir, m), [], ext);
    await fs.writeFile(path.join(clientDir, m.identity.headshot), "wrong signature");
    assert.ok(headshotProblems(clientDir, m).some((p) => /not a .* image/.test(p.message)), ext);
  }
});

test("headshot rights warn in draft review, fail final cards and strict compile, and are unused by overlay titles", async (t) => {
  const { m, clientDir } = await headshotFixture(t);
  const p = plan(), manual = { schemaVersion: 1, clientId: m.clientId, version: "full", revision: 1, canvas,
    items: [{ id: "book", kind: "card", role: "booking", duration: 6, card: { type: "booking" } }] };
  for (const rights of ["waiting", "unknown", "missing", undefined]) {
    m.identity.headshotRights = rights;
    assert.ok(headshotProblems(clientDir, m).some((p) => p.level === "warn" && /rights/.test(p.message)));
    assert.ok(headshotProblems(clientDir, m, { final: true }).some((p) => p.level === "error" && /rights/.test(p.message)));
    const f = speakerCardsHTML(p, { manifest: m, clientDir, tokens });
    assert.ok(has(f.problems, "card-headshot", "warn"));
    assert.ok(has(f.review[0].problems, "card-headshot", "warn"));
    assert.throws(() => speakerCardsHTML(p, { manifest: m, clientDir, tokens, final: true }), /book.*headshot.*rights/);
    assert.ok(validatePlan(manual, { manifest: m, index: {}, draft: true }).some((p) => p.id === "book" && p.level === "warn" && /headshot/.test(p.message)));
    assert.ok(validatePlan(manual, { manifest: m, index: {} }).some((p) => p.id === "book" && p.level === "error" && /headshot/.test(p.message)));
    assert.deepEqual(resolve({ type: "title" }, m, { mode: "overlay" }).problems, []);
    manual.items[0].card = { type: "title" };
    assert.ok(validatePlan(manual, { manifest: m, index: {} }).some((p) => /headshot/.test(p.message)));
    manual.items[0].card = { type: "booking" };
  }
  m.identity.headshotRights = "approved";
  assert.deepEqual(validatePlan(manual, { manifest: m, index: {} }), []);
  assert.deepEqual(speakerCardsHTML(p, { manifest: m, clientDir, tokens, final: true }).problems, []);
  for (const text of [m.identity.headshot, m.identity.headshotRights, "An invented topic"]) {
    manual.items[0].card = { type: "topic", text };
    assert.ok(validatePlan(manual, { manifest: m, index: {} }).some((p) => /topic text must come from/.test(p.message)));
  }
  manual.items[0].card = { type: "topic", text: m.identity.tagline };
  assert.deepEqual(validatePlan(manual, { manifest: m, index: {} }), []);
});

test("headshots copy with exact bytes and stable names; HEIC uses sips JPEG output without changing the original", async (t) => {
  const { m, clientDir, source } = await headshotFixture(t);
  const p = plan();
  p.items.unshift(insert("identity", { type: "title" }, 0, 4));
  const f = speakerCardsHTML(p, { manifest: m, clientDir, tokens });
  const before = structuredClone(f), project = path.join(clientDir, "project");
  const copied = await copyCardAssets(f, project);
  assert.deepEqual(f, before);
  assert.equal(copied.assets.length, 2);
  assert.equal(copied.assets[0].file, copied.assets[1].file);
  assert.deepEqual(await fs.readFile(path.join(project, copied.assets[0].file)), photoBytes);
  assert.deepEqual(await fs.readFile(source), photoBytes);
  assert.ok(!copied.html.includes("speaker-asset-"));
  assert.deepEqual(await copyCardAssets(f, project), copied);
  m.identity.headshot = "proof/photo.HEIC";
  const heicBytes = Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic");
  await fs.writeFile(path.join(clientDir, m.identity.headshot), heicBytes);
  const heic = speakerCardsHTML(plan(), { manifest: m, clientDir, tokens });
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 1, 2]);
  let calls = 0;
  const convertImage = async (command, args, options) => {
    calls++;
    assert.equal(command, "sips");
    assert.deepEqual(args.slice(0, 4), ["-s", "format", "jpeg", path.join(clientDir, m.identity.headshot)]);
    assert.equal(options.capture, true);
    await fs.writeFile(args.at(-1), jpeg);
  };
  const jpg = await copyCardAssets(heic, project, { convertImage });
  assert.equal(calls, 1);
  assert.match(jpg.assets[0].file, /[a-f0-9]{20}\.jpg$/);
  assert.deepEqual(await fs.readFile(path.join(project, jpg.assets[0].file)), jpeg);
  assert.deepEqual(await fs.readFile(path.join(clientDir, m.identity.headshot)), heicBytes);
  assert.ok(jpg.html.includes(jpg.assets[0].file));
  assert.deepEqual(await copyCardAssets(heic, project, { convertImage }), jpg);
  await assert.rejects(copyCardAssets(heic, project, { convertImage: async () => { throw new Error("converter unavailable"); } }), /book.*cannot convert headshot.*converter unavailable/);
  assert.ok(!(await fs.readdir(path.join(project, "assets/speaker-cards"))).some((name) => name.startsWith(".headshot-")));
});

test("headshot and raw renderer identity leaks fail clearly and authored headshot overrides are refused", async (t) => {
  const { m, clientDir } = await headshotFixture(t);
  assert.ok(has(resolve({ type: "booking", headshot: "invented.png" }, m, { clientDir }).problems, "card-provenance"));
  for (const leak of ["Greg Pingel", "officialgregpingel", "pingel"]) {
    m.identity.headshot = `proof/${leak}.png`;
    assert.ok(has(resolve({ type: "booking" }, m, { clientDir }).problems, "card-identity"));
    assert.throws(() => bookingCard({ ...good({ type: "booking" }), name: leak }, { tokens }), /Greg/);
  }
});
