import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { resolveBrandTokens } from "../src/brandtokens.mjs";
import { resolveCard, titleCard, bookingCard, bookingLayout, keywordCard, topicCard, quoteCard, testimonialNameCard, cardDuration, cardChecks, speakerCardsHTML } from "../src/speaker-cards.mjs";
import { validatePlan, resolvePlan, fitGeometry } from "../src/speaker-compile.mjs";
import { speakerHTML, speakerMotionHTML, composeSpeakerProject } from "../src/speaker-compose.mjs";
import { activeBox, letterboxCards, fitGraph } from "../src/speaker-look.mjs";

const canvas = { width: 1920, height: 1080, fps: 30 };
const tokens = resolveBrandTokens({ brand: { name: "Julee Gracey", fonts: { display: "Playfair Display", body: "Montserrat" }, colors: { text: "#FFFFFF", bg: "#111111", accent: "#FFB27D" } } });
const manifest = {
  clientId: "example", identity: { name: "Julee Gracey", roleLine: "Sales and on-camera speaker · Author of Highly Confident", tagline: "Decide Anyway", bookingMode: "direct", bookingText: "Book Julee for your next event", bookingUrl: "https://juleegracey.com" },
  sources: [{ id: "talk", kind: "stage", audio: "ok", rights: "r" }, { id: "phone", kind: "testimonial", audio: "ok", rights: "r" }],
  rights: [{ id: "r", status: "approved" }],
  proof: [
    { id: "q", kind: "quote", text: "Julee taught me exactly how to sell and close.", attribution: { name: "Julia B.", title: "Coaching client" }, rights: "r" },
    { id: "t", kind: "testimonial-video", sourceId: "phone", in: 0, out: 10, attribution: { name: "Sonia", title: "Coaching client", org: "An Example Organization" }, rights: "r" },
    { id: "credential", kind: "quote", text: "TV host · FX sitcom star", attribution: { name: "Host" }, rights: "r" },
  ],
};
const index = { sources: { talk: { width: 1920, height: 1080, duration: 10, hasAudio: true }, phone: { width: 360, height: 640, duration: 10, hasAudio: true } } };
const plan = () => ({ schemaVersion: 1, clientId: "example", version: "full", revision: 1, canvas, items: [
  { id: "talk", kind: "clip", role: "opening", sourceId: "talk", in: 0, out: 10 },
  { id: "book", kind: "card", role: "booking", duration: 6.6, card: { type: "booking" } },
], overlays: [], cutaways: [] });
const resolved = (card, mode = "overlay", m = manifest) => {
  const result = resolveCard(card, { manifest: m, mode });
  assert.deepEqual(result.problems, []);
  return result.card;
};
const calls = (timeline) => {
  const result = [];
  vm.runInNewContext(timeline, { tl: { set: (...args) => result.push(["set", ...args]), fromTo: (...args) => result.push(["fromTo", ...args]) } });
  return result;
};
const safe = (layout, box = activeBox(), global = false) => {
  const y = layout.y - (global ? box.y : 0);
  assert.equal(layout.fits, true);
  assert.ok(layout.x >= 96 && layout.x + layout.w <= 1824);
  assert.ok(y >= 54 && y + layout.h <= box.height - 54 + 1e-7, JSON.stringify(layout));
  if (layout.photo) {
    assert.ok(layout.photo.x >= layout.x + layout.w + 48);
    assert.ok(layout.photo.x + layout.photo.w <= 1824);
    assert.ok(layout.photo.y >= 54 && layout.photo.y + layout.photo.h <= box.height - 54);
  }
};

test("card options validate enums, booleans and modes in both plan and card preflight", () => {
  for (const card of [
    { type: "title", layout: "compact", reveal: "cut", showRole: false }, { type: "title", reveal: "mask", showRole: true },
    { type: "topic", text: manifest.proof[2].text, layout: "compact" }, { type: "keyword", text: "Taking action", layout: "compact" },
    { type: "quote", proofId: "q", layout: "premium" }, { type: "booking", layout: "premium" }, { type: "testimonial-name", proofId: "t", layout: "premium" },
  ]) resolved(card, ["quote", "booking"].includes(card.type) ? "insert" : "overlay");
  for (const card of [
    { type: "title", reveal: "wipe" }, { type: "title", reveal: null }, { type: "title", showRole: "false" },
    { type: "title", layout: "premium" }, { type: "keyword", layout: "wide", text: "Act" }, { type: "topic", layout: null, text: "Act" },
    { type: "quote", layout: "compact", proofId: "q" }, { type: "booking", layout: "compact" }, { type: "testimonial-name", layout: "compact", proofId: "t" },
    { type: "booking", reveal: "cut" }, { type: "topic", text: "Act", showRole: false },
  ]) {
    assert.ok(resolveCard(card, { manifest, mode: "overlay" }).problems.some((p) => p.code === "card-option"), JSON.stringify(card));
    const p = plan(); p.overlays = [{ id: "opt", at: "talk", offset: 0, duration: 3, card }];
    assert.ok(validatePlan(p, { manifest, index }).some((p) => p.id === "opt"));
  }
  assert.ok(resolveCard({ type: "title", layout: "compact" }, { manifest }).problems.some((p) => /overlay/.test(p.message)));
});

test("omitted options retain the standard HTML, geometry, animations and durations", () => {
  for (const [render, spec, mode] of [
    [titleCard, { type: "title" }, "overlay"], [bookingCard, { type: "booking" }, "insert"],
    [quoteCard, { type: "quote", proofId: "q" }, "insert"], [topicCard, { type: "topic", text: "Act" }, "overlay"],
    [keywordCard, { type: "keyword", text: "Taking action" }, "overlay"], [testimonialNameCard, { type: "testimonial-name", proofId: "t" }, "overlay"],
  ]) {
    const a = resolved(spec, mode), b = resolved({ ...spec, layout: "standard", ...(spec.type === "title" ? { reveal: "mask", showRole: true } : {}) }, mode);
    assert.deepEqual(render(a, { tokens, mode }), render(b, { tokens, mode }));
    assert.equal(cardDuration(a), cardDuration(b));
  }
});

test("cut title is fully on at its absolute first frame, without parent fade or name mask", () => {
  const p = plan(); p.overlays = [{ id: "name", at: "talk", offset: 0.8, duration: 4, card: { type: "title", reveal: "cut", layout: "compact", showRole: false } }];
  const r = resolvePlan(p, { manifest, index }), f = speakerCardsHTML(r, { manifest, tokens });
  const title = titleCard(resolved(p.overlays[0].card), { tokens, mode: "overlay", start: 0.8, end: 4.8 });
  assert.deepEqual(JSON.parse(JSON.stringify(calls(title.timeline))), [["set", "#speaker-card", { autoAlpha: 1 }, 0.8], ["set", "#speaker-card", { autoAlpha: 0 }, 4.8]]);
  assert.equal(title.durationHints.fullyLegible, 4);
  const motion = speakerMotionHTML(r);
  assert.ok(!motion.timeline.includes("#speaker-card-1 .sc-name"));
  assert.ok(motion.timeline.includes("#speaker-card-0 .sc-name"), "standard booking retains its mask");
  assert.match(speakerHTML(r, { manifest, cards: f }), /tl.set\("#speaker-card-1",\{autoAlpha:1\},0.8\)/);
  assert.match(f.css, /#speaker-card-1 .sc-compact-name\{line-height:1.12/);
  const masked = structuredClone(r); masked.overlays[0].card.reveal = "mask";
  assert.match(speakerMotionHTML(masked).timeline, /#speaker-card-1 .sc-name/);
  assert.ok(titleCard(resolved({ type: "title", reveal: "mask" }), { tokens, mode: "overlay", end: 4 }).durationHints.enter > 0);
});

test("compact title uses a name-led 760px plate; showRole false also works without a manifest role", () => {
  for (const showRole of [true, false]) {
    const card = resolved({ type: "title", layout: "compact", showRole });
    const r = titleCard(card, { tokens, mode: "overlay" });
    safe(r.layout); assert.equal(r.layout.w, 760); assert.equal(r.layout.x, 96);
    assert.ok(r.layout.y > 1080 * 0.6); assert.ok(!r.html.includes('class="sc-rule"'));
    assert.equal(r.html.includes(manifest.identity.roleLine), showRole);
    assert.ok(!r.html.includes(manifest.identity.tagline));
    assert.match(r.css, /sc-compact-name\{line-height:1.12/);
  }
  const m = structuredClone(manifest); delete m.identity.roleLine;
  resolved({ type: "title", showRole: false }, "overlay", m);
  assert.ok(resolveCard({ type: "title" }, { manifest: m }).problems.some((p) => p.code === "card-role"));
  const huge = { ...resolved({ type: "title", layout: "compact" }), name: "Long ".repeat(200) };
  assert.equal(titleCard(huge, { tokens, mode: "overlay" }).layout.fits, false);
});

test("compact keyword stays lower-left within 620px, keeps word limits and uses six-frame 24px entry", () => {
  const card = resolved({ type: "keyword", text: "I trust myself", layout: "compact" });
  const r = keywordCard(card, { tokens, start: 31.4333333333, end: 33.6333333333 });
  safe(r.layout); assert.equal(r.layout.w, 620); assert.ok(r.layout.y >= 1080 * 0.65);
  assert.match(r.html, /align-items:flex-start;text-align:left/); assert.match(r.timeline, /\{y:24,autoAlpha:0\}/);
  assert.equal(calls(r.timeline)[1][3].duration, 0.2); assert.equal(r.durationHints.enter, 0.2);
  assert.ok(resolveCard({ ...card, text: "What if I did" }, { manifest, mode: "overlay" }).problems.some((p) => p.code === "card-keyword"));
});

test("compact topic keeps exact credential text, uses 620px and refuses more than three seconds", () => {
  const card = resolved({ type: "topic", text: manifest.proof[2].text, layout: "compact" });
  const r = topicCard(card, { tokens }); safe(r.layout); assert.equal(r.layout.w, 620);
  assert.equal(cardDuration(card), 3); assert.equal(r.durationHints.max, 3); assert.ok(r.html.includes(card.text));
  const p = plan(); p.overlays = [{ id: "credential", at: "talk", offset: 0, duration: 3, card }];
  assert.deepEqual(validatePlan(p, { manifest, index }), []);
  p.overlays[0].duration = 3 + 1 / 30;
  assert.ok(validatePlan(p, { manifest, index }).some((p) => /at most 3s/.test(p.message)));
  const rp = { ...p, items: [{ id: "book", kind: "card", start: 10, end: 16.6, card: { type: "booking" } }], overlays: [{ ...p.overlays[0], start: 0, end: 3 + 1 / 30 }] };
  assert.ok(cardChecks(rp, { manifest, tokens }).some((p) => p.code === "card-hold"));
  assert.throws(() => speakerCardsHTML(rp, { manifest, tokens }), /at most 3s/);
  p.overlays[0].card.text = "An invented credential";
  assert.ok(validatePlan(p, { manifest, index }).some((p) => /must come from manifest/.test(p.message)));
});

test("premium quote is static for its full five seconds, with 92px quote and 44/36px attribution", () => {
  const card = resolved({ type: "quote", proofId: "q", layout: "premium" }, "insert");
  const r = quoteCard(card, { tokens, start: 100, end: 105 }); safe(r.layout);
  assert.equal(r.layout.w, 1488); assert.equal(r.layout.quote.fontSize, 92); assert.equal(r.layout.name.fontSize, 44); assert.equal(r.layout.title.fontSize, 36);
  assert.match(r.html, /max-width:100%;line-height:1.12/); assert.match(r.html, /strong style="font-size:44px"/);
  assert.equal(r.durationHints.fullyLegible, 5); assert.ok(calls(r.timeline).every((c) => c[0] === "set"));
  assert.throws(() => quoteCard(card, { tokens, end: 4.9666666667 }), /five fully readable/);
  assert.equal(cardDuration({ ...card, text: "word ".repeat(25) }), 5);
  const org = quoteCard({ ...card, org: "Example Company" }, { tokens }); safe(org.layout); assert.equal(org.layout.org.fontSize, 36);
  assert.equal(resolveCard({ ...card, name: "Someone Else" }, { manifest }).problems.some((p) => p.code === "card-provenance"), true);
});

test("premium booking keeps its headshot, makes the approved URL secondary only to the name, and starts visible", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "booking-options-")); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const photo = path.join(folder, "headshot.jpg"); await fs.writeFile(photo, Buffer.from([255, 216, 255, 217]));
  const card = { ...resolved({ type: "booking", layout: "premium" }, "insert"), headshot: photo };
  const r = bookingCard(card, { tokens, start: 20, end: 26.6 }); safe(r.layout);
  assert.deepEqual(bookingLayout(card, { tokens }), r.layout);
  assert.equal(r.layout.name.fontSize, 112); assert.equal(r.layout.route.fontSize, 88); assert.equal(r.layout.role.fontSize, 40);
  assert.deepEqual(r.layout.photo, { x: 1240, y: 120, w: 560, h: 840 }); assert.equal(r.assets.length, 1);
  assert.match(r.html, />juleegracey.com<\/div>/); assert.match(r.html, /class="sc-headshot"/); assert.match(r.html, /color:#FFB27D/);
  assert.equal(card.url, manifest.identity.bookingUrl); assert.ok(r.text.includes(card.url));
  const c = calls(r.timeline); assert.equal(c[0][0], "set"); assert.equal(c[0][2].autoAlpha, 1); assert.equal(c[0][3], 20);
  assert.deepEqual(Object.keys(c[1][2]), ["y"]); assert.equal(c[1][3].duration, 0.3);
  assert.ok(r.durationHints.fullyLegible >= 6.3 - 1e-7);
  const p = { canvas, items: [{ id: "book", kind: "card", start: 20, end: 26.6, card }], overlays: [] };
  assert.equal(speakerMotionHTML(p).timeline, "");
  safe(bookingCard({ ...card, headshot: undefined }, { tokens }).layout);
  assert.equal(bookingCard({ ...card, url: "W".repeat(500) }, { tokens }).layout.fits, false);
});

function testimonialPlan(fit, meta = index.sources.phone, letterbox = null) {
  const p = plan(); p.look = { letterbox }; p.items[0] = { ...p.items[0], id: "phone", sourceId: "phone", fit };
  p.overlays = [{ id: "who", at: "phone", offset: 0.3, duration: 4.5, card: { type: "testimonial-name", proofId: "t", layout: "premium" } }];
  const sourceIndex = { sources: { phone: meta } };
  return { p: resolvePlan(p, { manifest, index: sourceIndex }), sourceIndex };
}

test("premium testimonial uses resolved wash or defaultFit portrait side space and falls back for other fits", () => {
  for (const fit of [undefined, "wash"]) {
    const { p, sourceIndex } = testimonialPlan(fit);
    if (fit === undefined) delete p.items[0].fit;
    const r = speakerCardsHTML(p, { manifest, tokens, index: sourceIndex }).review.find((row) => row.id === "who"); safe(r.layout);
    assert.equal(r.layout.w, 536); assert.ok(r.layout.x + r.layout.w + 48 <= r.layout.portrait.x);
  }
  for (const fit of ["contain", "blur", "cover"]) {
    // A resolved plan can carry an explicit fit; the card renderer never reclassifies it from portrait dimensions.
    const { p, sourceIndex } = testimonialPlan("wash"); p.items[0].fit = fit;
    const f = speakerCardsHTML(p, { manifest, tokens, index: sourceIndex });
    assert.equal(f.review.find((row) => row.id === "who").layout.w, 1152); assert.ok(!f.review.find((row) => row.id === "who").layout.activeAware);
  }
  for (const meta of [{ width: 640, height: 360, duration: 10 }, { width: 360, height: 640, sampleAspectRatio: "2:1", duration: 10 }]) {
    const { p, sourceIndex } = testimonialPlan("wash", meta);
    assert.ok(!speakerCardsHTML(p, { manifest, tokens, index: sourceIndex }).review.find((row) => row.id === "who").layout.activeAware);
  }
  const r = testimonialNameCard(resolved({ type: "testimonial-name", proofId: "t", layout: "premium" }), { tokens, context: { item: { fit: "wash" } } });
  safe(r.layout); assert.equal(r.layout.w, 330); assert.ok(r.layout.x + r.layout.w + 48 <= r.layout.portrait.x);
});

test("all new layouts stay within safe active-picture boxes for full frame, 2.35 and 2.39", () => {
  for (const ratio of [null, 2.35, 2.39]) {
    const box = activeBox(ratio), c = { ...canvas, activeBox: box };
    for (const [render, spec, mode] of [
      [titleCard, { type: "title", layout: "compact", showRole: false }, "overlay"],
      [titleCard, { type: "title", layout: "compact" }, "overlay"],
      [keywordCard, { type: "keyword", layout: "compact", text: "I trust myself" }, "overlay"],
      [topicCard, { type: "topic", layout: "compact", text: manifest.proof[2].text }, "overlay"],
      [quoteCard, { type: "quote", layout: "premium", proofId: "q" }, "insert"],
      [bookingCard, { type: "booking", layout: "premium" }, "insert"],
    ]) safe(render(resolved(spec, mode), { tokens, canvas: c, mode }).layout, box);
    safe(bookingLayout({ ...resolved({ type: "booking", layout: "premium" }, "insert"), headshot: "photo.jpg" }, { tokens, canvas: c }), box);
    const { p, sourceIndex } = testimonialPlan("wash", index.sources.phone, ratio);
    p.items[1].card.layout = "premium";
    const raw = speakerCardsHTML(p, { manifest, tokens, index: sourceIndex });
    const output = letterboxCards(raw, box, p);
    for (const row of output.review) safe(row.layout, box, true);
    assert.ok(output.review.find((row) => row.id === "who").layout.x + output.review.find((row) => row.id === "who").layout.w + 48 <= output.review.find((row) => row.id === "who").layout.portrait.x);
  }
});

test("new layouts refuse oversized proof and booking text instead of overflowing the active picture", () => {
  for (const type of ["quote", "booking", "testimonial-name"]) {
    const m = structuredClone(manifest), p = plan(); p.look = { letterbox: 2.39 };
    if (type === "booking") {
      m.identity.bookingUrl = `https://${"W".repeat(500)}.com`;
      p.items[1].card.layout = "premium";
    } else if (type === "quote") {
      m.proof[0].attribution.name = "Long name ".repeat(80);
      p.items[0] = { id: "quote", kind: "card", role: "proof", duration: 5, card: { type, proofId: "q", layout: "premium" } };
    } else {
      m.proof[1].attribution.org = "Long organization ".repeat(80);
      p.items[0] = { ...p.items[0], sourceId: "phone", fit: "wash" };
      p.overlays = [{ id: "who", at: "talk", offset: 0, duration: 4, card: { type, proofId: "t", layout: "premium" } }];
    }
    const rp = resolvePlan(p, { manifest: m, index });
    assert.ok(cardChecks(rp, { manifest: m, tokens, index }).some((p) => p.code === "card-text-fit"), type);
    assert.throws(() => speakerCardsHTML(rp, { manifest: m, tokens, index }), /minimum readable/);
  }
});

test("collision checks use actual compact boxes when font metrics are available", () => {
  const p = plan(); p.overlays = [
    { id: "name", at: "talk", offset: 0, duration: 3, card: { type: "title", layout: "compact", showRole: false } },
    { id: "top", at: "talk", offset: 0, duration: 3, card: { type: "topic", text: manifest.proof[2].text } },
  ];
  let rp = resolvePlan(p, { manifest, index });
  assert.ok(!cardChecks(rp, { manifest, tokens }).some((p) => p.code === "card-overlay-collision"));
  p.overlays[1].card.layout = "compact"; rp = resolvePlan(p, { manifest, index });
  assert.ok(cardChecks(rp, { manifest, tokens }).some((p) => p.code === "card-overlay-collision"));
  assert.ok(cardChecks(rp, { manifest }).some((p) => p.code === "card-overlay-collision"));
  p.overlays[1].offset = 3; rp = resolvePlan(p, { manifest, index });
  assert.ok(!cardChecks(rp, { manifest, tokens }).some((p) => p.code === "card-overlay-collision"));
});

test("composition passes indexed source geometry through to premium portrait identifiers without Chrome", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "card-options-")); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const workDir = path.join(folder, "work/full"); await fs.mkdir(workDir, { recursive: true }); await fs.mkdir(path.join(folder, "work/index"));
  await fs.writeFile(path.join(workDir, "base.mp4"), "fixture"); await fs.writeFile(path.join(workDir, "words.json"), "[]");
  await fs.writeFile(path.join(folder, "work/index/sources.json"), JSON.stringify(index));
  const { p } = testimonialPlan("wash"); p.items[1].card.layout = "premium";
  const result = await composeSpeakerProject(workDir, p, { manifest, tokens, print: () => {} });
  assert.equal(result.cards.find((row) => row.id === "who").layout.w, 536); assert.equal(result.warnings.length, 0);
  assert.match(await fs.readFile(result.html, "utf8"), /tl.set\("#speaker-card-0",\{autoAlpha:1\},10\)/);
  assert.ok(!(await fs.readFile(result.html, "utf8")).includes("clipPath"));
  // Standard plans do not acquire an index dependency merely to compose their existing cards.
  await fs.writeFile(path.join(folder, "work/index/sources.json"), "invalid fixture index");
  p.overlays[0].card.layout = "standard";
  p.items[1].end = p.items[1].outputEnd = 16.4; p.duration = 16.4;
  const standardName = await composeSpeakerProject(workDir, p, { manifest, tokens, print: () => {} });
  assert.equal(standardName.cards.find((row) => row.id === "who").layout.w, 1152);
  assert.equal(standardName.warnings.length, 0, "premium booking has six settled seconds within 6.4s");
  p.items[1].end = p.items[1].outputEnd = 16.2; p.duration = 16.2;
  const short = await composeSpeakerProject(workDir, p, { manifest, tokens, print: () => {} });
  assert.ok(short.warnings.some((w) => /reserve 6.3 seconds/.test(w.message)));
  p.items[1].card.layout = "standard"; p.items[1].end = p.items[1].outputEnd = 16.4; p.duration = 16.4;
  const standardBooking = await composeSpeakerProject(workDir, p, { manifest, tokens, print: () => {} });
  assert.ok(standardBooking.warnings.some((w) => /reserve 6.6 seconds/.test(w.message)));
});

test("lavfi: side identifiers clear measured portrait foregrounds at all active heights", (t) => {
  for (const ratio of [null, 2.35, 2.39]) {
    const box = activeBox(ratio), graph = fitGraph("0:v", "pic", fitGeometry(index.sources.phone, "wash"), { fit: "wash", frames: 1, active: box }).join(";");
    const rgb = execFileSync("ffmpeg", ["-v", "error", "-filter_complex_threads", "1", "-f", "lavfi", "-i", "color=white:s=360x640:r=30:d=0.034", "-filter_complex", graph, "-map", "[pic]", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { maxBuffer: 7 * 1024 * 1024 });
    const whiteAt = (x, y) => [...rgb.subarray((y * 1920 + x) * 3, (y * 1920 + x) * 3 + 3)].every((v) => v >= 240);
    const xs = Array.from({ length: 1920 }, (_, x) => x).filter((x) => whiteAt(x, 540));
    const ys = Array.from({ length: 1080 }, (_, y) => y).filter((y) => whiteAt(960, y));
    const { p, sourceIndex } = testimonialPlan("wash", index.sources.phone, ratio);
    const layout = speakerCardsHTML(p, { manifest, tokens, index: sourceIndex }).review.find((row) => row.id === "who").layout;
    assert.ok(layout.x + layout.w + 48 <= xs[0]);
    assert.ok(ys[0] >= box.y && ys.at(-1) < box.y + box.height);
    t.diagnostic(`${ratio || "16:9"}: measured foreground ${xs.length}x${ys.length} at ${xs[0]},${ys[0]}; identifier ends x=${layout.x + layout.w}; clear gap ${xs[0] - layout.x - layout.w}px`);
  }
});
