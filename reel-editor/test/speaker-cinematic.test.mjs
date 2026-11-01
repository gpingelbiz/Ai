import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { resolveBrandTokens } from "../src/brandtokens.mjs";
import { resolveCard, titleCard, topicCard, keywordCard, eventListCard, cardDuration, cardChecks, speakerCardsHTML } from "../src/speaker-cards.mjs";
import { validatePlan, resolvePlan, planUsage, fitGeometry } from "../src/speaker-compile.mjs";
import { speakerMotionHTML, speakerHTML } from "../src/speaker-compose.mjs";
import { activeBox, letterboxCards, fitGraph } from "../src/speaker-look.mjs";
import { rightsChecks, usedAssets } from "../src/speaker-qc.mjs";
import { reviewRows } from "../src/speaker-review.mjs";

const canvas = { width: 1920, height: 1080, fps: 30 };
const tokens = resolveBrandTokens({ brand: { name: "Julee Gracey", fonts: { display: "Playfair Display", body: "Montserrat" }, colors: { text: "#FFFFFF", bg: "#111111", accent: "#FFB27D" } } });
const manifest = {
  clientId: "example", identity: { name: "Julee Gracey", roleLine: "Sales and on-camera confidence speaker", tagline: "Decide Anyway", bookingMode: "direct", bookingText: "Book Julee", bookingUrl: "https://example.com" },
  sources: [
    { id: "talk", path: "talk.mp4", kind: "stage", audio: "ok", rights: "r", event: "PowerHouse Summit 2025" },
    { id: "other", path: "other.mp4", kind: "stage", rights: "r", event: "Nova Presentation" },
    { id: "repeat", kind: "stage", rights: "r", event: "PowerHouse Summit 2025" },
  ],
  rights: [{ id: "r", status: "approved" }, { id: "pending", status: "pending" }],
  proof: [
    { id: "credential", kind: "press", text: "Briefcase model, NBC’s Deal or No Deal", rights: "r" },
    { id: "eyebrow", kind: "press", text: "Briefcase model", rights: "r" },
    { id: "main", kind: "press", text: "NBC’s Deal or No Deal", rights: "r" },
    { id: "heading", kind: "press", text: "Selected stages", rights: "r" },
  ],
};
const index = { sources: { talk: { width: 1920, height: 1080, duration: 10, words: [{ text: "Taking", start: 1, end: 1.3 }, { text: "action", start: 1.3, end: 1.8 }] } } };
const title = { type: "title", layout: "cinematic", showRole: false };
const topic = { type: "topic", layout: "cinematic", eyebrow: "Briefcase model", text: "NBC’s Deal or No Deal" };
const keyword = { type: "keyword", layout: "cinematic", text: "Taking action" };
const events = { type: "event-list", heading: "Spoke at", sourceIds: ["other", "talk", "repeat", "other"] };
const plan = () => ({ schemaVersion: 1, clientId: "example", version: "full", revision: 1, canvas, items: [
  { id: "talk", kind: "clip", role: "opening", sourceId: "talk", in: 0, out: 10 },
  { id: "book", kind: "card", role: "booking", duration: 6.6, card: { type: "booking" } },
], overlays: [] });
const withOverlay = (card, duration = 4, offset = 0.8) => {
  const p = plan(); p.overlays.push({ id: "overlay", at: "talk", offset, duration, card }); return p;
};
const withEvents = (card = events, duration = 5) => {
  const p = plan(); p.items.splice(1, 0, { id: "events", kind: "card", role: "proof", duration, card }); return p;
};
const resolve = (card, m = manifest, mode = card.type === "event-list" ? "insert" : "overlay") => {
  const result = resolveCard(card, { manifest: m, mode }); assert.deepEqual(result.problems, []); return result.card;
};
const calls = (timeline) => {
  const result = [];
  vm.runInNewContext(timeline, { tl: { set: (...args) => result.push(["set", ...args]), fromTo: (...args) => result.push(["fromTo", ...args]) } });
  return result;
};
const render = (card, options = {}) => ({ title: titleCard, topic: topicCard, keyword: keywordCard, "event-list": eventListCard })[card.type](resolve(card), { tokens, mode: card.type === "event-list" ? "insert" : "overlay", ...options });

test("cinematic layout and its scoped options validate in plan and card preflight", () => {
  for (const spec of [title, topic, keyword]) {
    const card = { ...spec, motion: "rise", accent: true };
    resolve(card);
    assert.deepEqual(validatePlan(withOverlay(card, spec.type === "keyword" ? 2 : 4), { manifest, index }), []);
    assert.ok(resolveCard(card, { manifest }).problems.some((p) => /overlay/.test(p.message)));
  }
  for (const card of [
    { ...title, layout: "cinema" }, { ...title, motion: "slide" }, { ...title, accent: "yes" },
    { ...topic, eyebrow: 7 }, { ...topic, eyebrow: "" }, { ...topic, layout: "compact" },
    { ...keyword, motion: "scale" }, { type: "booking", layout: "cinematic" },
    { ...title, eyebrow: "Briefcase model" }, { ...title, showRole: "false" },
  ]) {
    assert.ok(resolveCard(card, { manifest, mode: "overlay" }).problems.some((p) => p.level === "error"), JSON.stringify(card));
    assert.ok(validatePlan(withOverlay(card), { manifest, index }).some((p) => p.level === "error"), JSON.stringify(card));
  }
});

test("cinematic credentials accept separate exact fields or one exact comma/space split, with seven words combined", () => {
  for (const text of ["Briefcase model, NBC’s Deal or No Deal", "Briefcase model NBC’s Deal or No Deal"]) {
    const m = structuredClone(manifest); m.proof = [{ ...m.proof[0], text }];
    assert.equal(resolve(topic, m).eyebrow, topic.eyebrow);
    assert.deepEqual(validatePlan(withOverlay(topic), { manifest: m, index }), []);
  }
  resolve(topic);
  for (const card of [{ ...topic, eyebrow: "World famous model" }, { ...topic, text: "NBC's Deal or No Deal" }]) {
    assert.ok(resolveCard(card, { manifest, mode: "overlay" }).problems.some((p) => p.code === "card-provenance"));
    assert.ok(validatePlan(withOverlay(card), { manifest, index }).some((p) => /provenance/.test(p.message)));
  }
  const m = structuredClone(manifest); m.identity.tagline = "One two three four five six"; m.identity.roleLine = "Seven eight";
  const card = { ...topic, text: m.identity.tagline, eyebrow: m.identity.roleLine };
  assert.ok(resolveCard(card, { manifest: m, mode: "overlay" }).problems.some((p) => p.code === "card-topic-length"));
  assert.ok(validatePlan(withOverlay(card), { manifest: m, index }).some((p) => /combined/.test(p.message)));
  for (const text of ["proof/headshot.jpg", "r-photo"]) {
    m.identity.headshot = "proof/headshot.jpg"; m.identity.headshotRights = "r-photo";
    assert.ok(resolveCard({ ...topic, eyebrow: text }, { manifest: m, mode: "overlay" }).problems.some((p) => p.code === "card-provenance"));
  }
});

test("eyebrow and combined credential proof rights reach compilation, cards and final delivery", () => {
  for (const joined of [false, true]) {
    const m = structuredClone(manifest);
    if (joined) m.proof = [m.proof[0]]; else m.proof = m.proof.slice(1, 3);
    m.proof[0].rights = "pending";
    const p = withOverlay(topic);
    assert.ok(validatePlan(p, { manifest: m, index, draft: true }).some((p) => p.level === "warn" && /rights/.test(p.message)));
    assert.ok(validatePlan(p, { manifest: m, index }).some((p) => p.level === "error" && /rights/.test(p.message)));
    assert.ok(resolveCard(topic, { manifest: m, mode: "overlay", final: true }).problems.some((p) => p.code === "card-rights" && p.level === "error"));
    assert.ok(rightsChecks(p, m, true).some((p) => p.assetId === m.proof[0].id && p.level === "fail"));
    assert.ok(planUsage(p, m).proofIds.includes(m.proof[0].id));
    assert.ok(usedAssets(p, m).proofIds.includes(m.proof[0].id));
  }
});

test("cinematic keyword motion preserves transcript, word-count, testimonial, spacing and duration guards", () => {
  for (const card of [{ ...keyword, text: "action Taking" }, { ...keyword, text: "A fabricated claim" }, { ...keyword, text: "What if I did" }]) {
    assert.ok(validatePlan(withOverlay({ ...card, motion: "rise" }, 2), { manifest, index }).some((p) => p.level === "error"));
  }
  for (const duration of [1, 3]) assert.ok(validatePlan(withOverlay(keyword, duration), { manifest, index }).some((p) => /keyword duration/.test(p.message)));
  const m = structuredClone(manifest); m.sources[0].kind = "testimonial";
  assert.ok(validatePlan(withOverlay(keyword, 2), { manifest: m, index }).some((p) => /testimonial/.test(p.message)));
  const p = withOverlay(keyword, 2);
  p.overlays.push({ ...p.overlays[0], id: "second", offset: 5 });
  assert.ok(validatePlan(p, { manifest, index }).some((p) => /20 seconds apart/.test(p.message)));
});

test("cinematic type sits on footage without a plate and uses only a full-width lower-third scrim", () => {
  for (const card of [title, { ...title, showRole: true, accent: true }, topic, keyword]) {
    const r = render(card);
    assert.match(r.html, /sc-cinematic-copy/); assert.doesNotMatch(r.html, /background:|sc-headshot/);
    assert.match(r.css, /\.sc-cinematic\{left:0;top:0;width:1920px;height:1080px;background:none;border-radius:0;color:#fff/);
    assert.match(r.css, /height:33\.333333%;background:linear-gradient\(to bottom,rgba\(0,0,0,0\) 0%.*rgba\(0,0,0,0\.45\) 100%\)/);
    assert.match(r.css, /sc-cinematic-copy\{[^}]*background:none[^}]*text-shadow:0 2px 3px.*0 6px 18px.*0 14px 40px/);
    assert.match(r.css, /\.sc-name \{ font-family:var\(--brand-display-font\)/);
    assert.equal(r.html.includes('class="sc-cinematic-rule"'), card.accent === true);
    assert.ok(!r.html.includes(manifest.identity.tagline));
  }
  const name = render({ ...title, showRole: true });
  assert.ok(name.layout.name.fontSize >= 120 && name.layout.name.fontSize <= 150);
  assert.match(name.html, /sc-cinematic-role/); assert.match(name.css, /letter-spacing:2.4px/);
  assert.ok(render(keyword).layout.text.fontSize > render(topic).layout.text.fontSize);
});

test("cinematic layouts and moving text retain 96px safe margins at full frame and both letterboxes", () => {
  for (const ratio of [null, 2.35, 2.39]) for (const card of [title, { ...title, showRole: true, accent: true }, topic, keyword]) {
    const box = activeBox(ratio), p = withOverlay(card, card.type === "keyword" ? 2 : 4); p.look = { letterbox: ratio };
    const rp = resolvePlan(p, { manifest, index });
    const raw = speakerCardsHTML(rp, { manifest, tokens });
    const output = letterboxCards(raw, box, rp), l = output.review.find((c) => c.id === "overlay").layout;
    assert.equal(l.fits, true); assert.equal(l.x, 96); assert.equal(l.w, 1344);
    assert.ok(l.y >= box.y + 96); assert.equal(l.y + l.h, box.y + box.height - 96);
    assert.ok(l.y + l.h + 32 <= box.y + box.height - 64, "rise never reaches the frame edge");
    assert.ok(l.x + l.w <= 1824);
    assert.ok(!cardChecks(rp, { manifest, tokens }).some((p) => p.code === "card-text-fit"));
  }
});

test("oversized cinematic names, roles and event strings fail fit checks instead of overflowing", () => {
  for (const field of ["name", "roleLine"]) {
    const m = structuredClone(manifest); m.identity[field] = "Wide ".repeat(100);
    const p = resolvePlan(withOverlay({ ...title, showRole: true }), { manifest: m, index });
    assert.ok(cardChecks(p, { manifest: m, tokens }).some((p) => p.code === "card-text-fit"));
    assert.throws(() => speakerCardsHTML(p, { manifest: m, tokens }), /minimum readable/);
  }
  const m = structuredClone(manifest); m.sources[0].event = "W".repeat(500);
  const p = resolvePlan(withEvents(), { manifest: m, index });
  assert.ok(cardChecks(p, { manifest: m, tokens }).some((p) => p.code === "card-text-fit"));
  assert.throws(() => speakerCardsHTML(p, { manifest: m, tokens }), /minimum readable/);
});

test("cinematic collision checks use lower-third text geometry, including conservative token-free checks", () => {
  const p = withOverlay(title); p.overlays.push({ id: "topic", at: "talk", offset: 0.8, duration: 4, card: topic });
  const rp = resolvePlan(p, { manifest, index });
  for (const options of [{ manifest, tokens }, { manifest }]) assert.ok(cardChecks(rp, options).some((p) => p.code === "card-overlay-collision"));
  p.overlays[1].card = { type: "topic", text: manifest.identity.tagline };
  assert.ok(!cardChecks(resolvePlan(p, { manifest, index }), { manifest, tokens }).some((p) => p.code === "card-overlay-collision"));
});

test("cinematic rise uses nine absolute frames, 32px travel and a six-frame linear exit", () => {
  for (const card of [title, topic, keyword]) {
    const r = render({ ...card, motion: "rise" }, { start: 31 / 30, end: 91 / 30 });
    const c = calls(r.timeline);
    assert.equal(c.length, 4); assert.equal(c[0][3], 31 / 30);
    assert.equal(c[1][2].y, 32); assert.equal(c[1][2].autoAlpha, 0);
    assert.equal(c[1][3].y, 0); assert.equal(c[1][3].duration, 9 / 30); assert.equal(c[1][3].ease, "power2.out");
    assert.equal(c[1][4], 31 / 30); assert.equal(c[2][4], 85 / 30); assert.equal(c[2][3].duration, 6 / 30); assert.equal(c[2][3].ease, "none");
    assert.equal(c[3][3], 91 / 30); assert.equal(r.durationHints.fullyLegible, 1.5);
  }
  const r = render(title, { start: 1, end: 5 });
  assert.equal(calls(r.timeline)[1][2].y, 0, "motion omitted means fade only");
  const p = resolvePlan(withOverlay({ ...title, motion: "rise" }), { manifest, index });
  assert.ok(!speakerMotionHTML(p).timeline.includes("#speaker-card-1 .sc-name"), "cinematic titles never add the standard name mask");
});

// Seek the real bundled timeline engine on plain objects; CSS painting still needs production review.
function seekable(timeline) {
  const context = { setTimeout: () => 0, clearTimeout: () => {} }; vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const tl = context.window.gsap.timeline({ paused: true }), targets = new Map();
  const target = (selector) => { if (!targets.has(selector)) targets.set(selector, { autoAlpha: 0, y: 0 }); return targets.get(selector); };
  vm.runInNewContext(timeline, { tl: { set: (s, ...args) => tl.set(target(s), ...args), fromTo: (s, ...args) => tl.fromTo(target(s), ...args) } });
  return { tl, targets };
}

test("bundled GSAP reaches exact rise/hold/fade values when seeking forward and backward by frame", () => {
  const r = render({ ...title, motion: "rise" }, { start: 1, end: 3 });
  const { tl, targets } = seekable(r.timeline), root = targets.get("#speaker-card"), copy = targets.get("#speaker-card .sc-cinematic-copy");
  for (const frame of [30, 31, 34, 38, 39, 60, 84, 85, 89, 90, 29, 39, 30, 60]) {
    tl.seek(frame / 30);
    if (frame < 30 || frame >= 90) assert.equal(root.autoAlpha, 0, `hidden at frame ${frame}`);
    else {
      const exit = frame <= 84 ? 1 : (90 - frame) / 6;
      assert.ok(Math.abs(root.autoAlpha - exit) < 0.00001, `exit at ${frame}`);
      const progress = Math.min(1, (frame - 30) / 9), eased = 1 - (1 - progress) ** 3;
      assert.ok(Math.abs(copy.autoAlpha - eased) < 0.00001, `entry alpha at ${frame}`);
      assert.ok(Math.abs(copy.y - 32 * (1 - eased)) < 0.0001, `entry y at ${frame}`);
    }
  }
});

test("cut cinematic titles land completely on their first frame, including cut plus rise, then fade for six frames", () => {
  for (const motion of [undefined, "rise"]) {
    const card = { ...title, reveal: "cut", ...(motion ? { motion } : {}) }, r = render(card, { start: 0.8, end: 4.8 });
    assert.equal(r.durationHints.enter, 0); assert.equal(r.durationHints.exit, 0.2);
    assert.equal(calls(r.timeline).filter((c) => c[0] === "fromTo").length, 1);
    assert.ok(!r.timeline.includes("scale:") && !r.timeline.includes("clipPath"));
    const { tl, targets } = seekable(r.timeline); tl.seek(0.8);
    assert.equal(targets.get("#speaker-card").autoAlpha, 1); assert.equal(targets.get("#speaker-card .sc-cinematic-copy").autoAlpha, 1);
    assert.equal(targets.get("#speaker-card .sc-cinematic-copy").y, 0);
  }
});

test("cinematic entry and exit require at least sixteen frames in all preflight paths", () => {
  const p = withOverlay(title, 15 / 30);
  assert.ok(validatePlan(p, { manifest, index }).some((p) => /16 frames/.test(p.message)));
  assert.throws(() => render(title, { end: 15 / 30 }), /16 frames/);
  p.overlays[0] = { ...p.overlays[0], start: 1, end: 1.5 };
  assert.ok(cardChecks(p, { manifest, tokens }).some((p) => p.code === "card-hold"));
  assert.ok(!validatePlan(withOverlay(title, 16 / 30), { manifest, index }).some((p) => /16 frames/.test(p.message)));
});

test("event-list resolves exact manifest event strings, deduplicates in plan order and adds no logos", () => {
  const card = resolve(events), r = render(events);
  assert.deepEqual(card.events, ["Nova Presentation", "PowerHouse Summit 2025"]);
  assert.deepEqual(r.text, ["Spoke at", ...card.events]); assert.equal(r.assets.length, 0);
  assert.ok(r.html.indexOf("Nova Presentation") < r.html.indexOf("PowerHouse Summit 2025"));
  assert.doesNotMatch(r.html, /<img|sc-logo|sc-headshot/);
  assert.match(r.html, /class="sc-rule"/); assert.match(r.html, /font-size:60px/);
  assert.equal(cardDuration(card), 5); assert.equal(r.durationHints.fullyLegible, 5);
  assert.ok(calls(r.timeline).every((c) => c[0] === "set"));
  assert.deepEqual(validatePlan(withEvents(), { manifest, index }), []);
  const m = structuredClone(manifest); m.sources[0].event = 'A & B <Summit> 2025';
  assert.match(eventListCard(resolve(events, m), { tokens }).html, /A &amp; B &lt;Summit&gt; 2025/);
});

test("event-list heading provenance, source existence, events, mode and six-line limit validate", () => {
  for (const heading of ["Spoke at", "Recent stages", "Selected stages", manifest.identity.tagline]) resolve({ ...events, heading });
  for (const card of [
    { ...events, heading: "Trusted by world leaders" }, { ...events, heading: 5 },
    { ...events, sourceIds: [] }, { ...events, sourceIds: "talk" }, { ...events, sourceIds: ["missing"] },
  ]) {
    assert.ok(resolveCard(card, { manifest }).problems.some((p) => p.level === "error"));
    assert.ok(validatePlan(withEvents(card), { manifest, index }).some((p) => p.level === "error"));
  }
  const m = structuredClone(manifest); delete m.sources[0].event;
  assert.ok(validatePlan(withEvents(), { manifest: m, index }).some((p) => /have an event/.test(p.message)));
  assert.ok(resolveCard(events, { manifest, mode: "overlay" }).problems.some((p) => /insert/.test(p.message)));
  assert.ok(validatePlan(withOverlay(events), { manifest, index }).some((p) => /insert/.test(p.message)));
  m.sources = Array.from({ length: 7 }, (_, n) => ({ id: `s${n}`, event: `Event ${n}`, rights: "r" }));
  const card = { ...events, sourceIds: m.sources.map((s) => s.id) };
  assert.ok(resolveCard(card, { manifest: m }).problems.some((p) => p.code === "card-event-lines"));
  assert.ok(validatePlan(withEvents(card), { manifest: m, index }).some((p) => /six event lines/.test(p.message)));
});

test("event-list source rights survive duplicate event names through strict compile, card preflight, QC and delivery", () => {
  const m = structuredClone(manifest); m.sources[2].rights = "pending";
  m.proof[3].rights = "pending";
  const p = withEvents({ ...events, heading: "Selected stages" });
  assert.ok(planUsage(p, m).sourceIds.includes("repeat"));
  assert.ok(usedAssets(p, m).sourceIds.includes("repeat"));
  for (const final of [false, true]) {
    const rp = resolvePlan(p, { manifest: m, index, draft: true });
    assert.ok(cardChecks(rp, { manifest: m, tokens, final }).some((p) => p.code === "card-rights" && p.level === (final ? "error" : "warn")));
    const checks = rightsChecks(p, m, final);
    for (const id of ["repeat", "heading"]) assert.ok(checks.some((p) => p.assetId === id && p.level === (final ? "fail" : "warn")));
  }
  assert.ok(validatePlan(p, { manifest: m, index, draft: true }).some((p) => /rights/.test(p.message) && p.level === "warn"));
  assert.ok(validatePlan(p, { manifest: m, index }).some((p) => /rights/.test(p.message) && p.level === "error"));
  const rp = resolvePlan(p, { manifest: m, index, draft: true });
  assert.throws(() => speakerCardsHTML(rp, { manifest: m, tokens, final: true }), /rights/);
});

test("event-list fits six real event lines at both letterboxes and refuses wrapping beyond six", () => {
  const m = structuredClone(manifest);
  m.sources = Array.from({ length: 6 }, (_, n) => ({ id: `s${n}`, event: `Conference ${n + 1}`, rights: "r" }));
  const card = resolve({ ...events, sourceIds: m.sources.map((s) => s.id) }, m);
  for (const ratio of [null, 2.35, 2.39]) {
    const box = activeBox(ratio), r = eventListCard(card, { tokens, canvas: { ...canvas, activeBox: box } });
    assert.equal(r.layout.fits, true); assert.equal(r.layout.events.reduce((n, f) => n + f.lines, 0), 6);
    assert.ok(r.layout.y >= 96 && r.layout.y + r.layout.h <= box.height - 96);
  }
  m.sources[0].event = "A very long event name ".repeat(5);
  const long = resolve({ ...events, sourceIds: m.sources.map((s) => s.id) }, m);
  assert.equal(eventListCard(long, { tokens }).layout.fits, false);
});

test("event-list reading windows reject less than four and more than five seconds everywhere", () => {
  for (const duration of [119 / 30, 151 / 30]) {
    const p = withEvents(events, duration);
    assert.ok(validatePlan(p, { manifest, index }).some((p) => /4 to 5 seconds/.test(p.message)));
    assert.throws(() => render(events, { end: duration }), /4 to 5 seconds/);
    const rp = resolvePlan(withEvents(), { manifest, index }); rp.items[1].end = rp.items[1].outputEnd = 10 + duration;
    assert.ok(cardChecks(rp, { manifest, tokens }).some((p) => p.code === "card-hold"));
  }
  for (const duration of [4, 5]) assert.deepEqual(validatePlan(withEvents(events, duration), { manifest, index }), []);
});

test("review and composition carry actual events, eyebrow copy, source IDs and valid overlay modes", () => {
  const p = withEvents(); p.overlays = withOverlay(topic).overlays;
  const rp = resolvePlan(p, { manifest, index }), f = speakerCardsHTML(rp, { manifest, tokens });
  assert.deepEqual(f.review.find((c) => c.id === "events").sourceIds, events.sourceIds);
  assert.ok(f.review.find((c) => c.id === "overlay").text.includes("Briefcase model"));
  assert.ok(f.review.find((c) => c.id === "overlay").proofIds.includes("eyebrow"));
  const rows = reviewRows(rp, manifest);
  assert.equal(rows.find((r) => r.id === "events").text, "Spoke at · Nova Presentation · PowerHouse Summit 2025");
  assert.deepEqual(rows.find((r) => r.id === "overlay").problems, []);
  assert.equal(rows.find((r) => r.id === "overlay").text, "Briefcase model · NBC’s Deal or No Deal");
  const html = speakerHTML(rp, { manifest, cards: f }); assert.match(html, /sc-cinematic/); assert.match(html, /Spoke at/);
});

test("lavfi base-picture smoke check: cinematic overlays leave the source graph and every base pixel unchanged", (t) => {
  const plain = resolvePlan(plan(), { manifest, index }), cinematic = resolvePlan(withOverlay(title), { manifest, index });
  assert.deepEqual(cinematic.items, plain.items);
  const geometry = fitGeometry(index.sources.talk, "contain", canvas);
  const graph = fitGraph("0:v", "v", geometry, { frames: 6 }).join(";");
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=0.2"];
  const hashes = (filters) => execFileSync("ffmpeg", [...args, ...filters, "-frames:v", "6", "-an", "-f", "framemd5", "pipe:1"], { encoding: "utf8" }).split("\n").filter((line) => /^0,/.test(line)).map((line) => line.split(",").at(-1).trim());
  const base = hashes(["-vf", "null"]), fitted = hashes(["-filter_complex", graph, "-map", "[v]"]);
  assert.equal(fitted.length, 6); assert.deepEqual(fitted, base);
  t.diagnostic(`6/6 frames pixel-identical at 1920x1080/30fps (0.2s); graph: ${graph}`);
});
