import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { resolveBrandTokens } from "../src/brandtokens.mjs";
import { resolveCard, testimonialNameCard, cardChecks, speakerCardsHTML } from "../src/speaker-cards.mjs";
import { validatePlan, resolvePlan, fitGeometry } from "../src/speaker-compile.mjs";
import { activeBox, letterboxCards, fitGraph } from "../src/speaker-look.mjs";

const canvas = { width: 1920, height: 1080, fps: 30 };
const tokens = resolveBrandTokens({ brand: { name: "Example", fonts: { display: "Playfair Display", body: "Montserrat" }, colors: { text: "#FFFFFF", bg: "#111111", accent: "#FFB27D" } } });
const manifest = {
  clientId: "example", identity: { name: "Speaker", roleLine: "Speaker and author", bookingMode: "direct", bookingText: "Book Speaker", bookingUrl: "https://example.com" },
  sources: [{ id: "phone", kind: "testimonial", audio: "ok", rights: "r" }, { id: "other", kind: "testimonial", rights: "r" }],
  rights: [{ id: "r", status: "approved" }],
  proof: [{ id: "t", kind: "testimonial-video", sourceId: "phone", in: 0, out: 10, attribution: { name: "Sonia", title: "Coaching client", org: "An Example Organization" }, rights: "r" }],
};
const portrait = { width: 360, height: 640, duration: 10, hasAudio: true };
const landscape = { ...portrait, width: 1920, height: 1080 };
const spec = { type: "testimonial-name", layout: "cinematic", proofId: "t", motion: "rise" };
function fixture({ meta = portrait, fit, ratio = null, card = spec, push = 1, sourceCrop, resolve = true } = {}) {
  const index = { sources: { phone: meta } };
  const plan = { schemaVersion: 1, clientId: "example", version: "full", revision: 1, canvas, look: { letterbox: ratio }, items: [
    { id: "phone", kind: "clip", role: "testimonial", sourceId: "phone", in: 0, out: 10, ...(fit ? { fit } : {}), push, ...(sourceCrop ? { sourceCrop } : {}) },
    { id: "book", kind: "card", role: "booking", duration: 6.6, card: { type: "booking" } },
  ], overlays: [{ id: "who", at: "phone", offset: 0.3, duration: 4.5, card }] };
  return { plan, index, resolved: resolve ? resolvePlan(plan, { manifest, index }) : plan };
}
function render(card = spec, options = {}) {
  const r = resolveCard(card, { manifest, mode: "overlay" });
  assert.deepEqual(r.problems, []);
  return testimonialNameCard(r.card, { tokens, start: 31 / 30, end: 166 / 30, ...options });
}
const output = (f, m = manifest) => speakerCardsHTML(f.resolved, { manifest: m, tokens, index: f.index });
const safe = (l, box, global = false) => {
  const y = l.y - (global ? box.y : 0);
  assert.equal(l.fits, true);
  assert.ok(l.x >= 96 && l.x + l.w <= 1824);
  assert.ok(y >= 96 && y + l.h <= box.height - 96);
  assert.ok(y + l.h + 12 <= box.height - 84, "rise stays inside the bottom safe margin");
  if (l.portrait) assert.ok(l.x + l.w + 48 <= l.portrait.x);
};

test("cinematic testimonial options are scoped to overlays and preserve supplied attribution and rights", () => {
  const f = fixture();
  assert.deepEqual(validatePlan(f.plan, { manifest, index: f.index }), []);
  assert.deepEqual(cardChecks(f.resolved, { manifest, tokens, index: f.index }), []);
  for (const card of [{ ...spec, motion: "slide" }, { ...spec, layout: "editorial" }, { ...spec, accent: "true" }]) {
    assert.ok(resolveCard(card, { manifest, mode: "overlay" }).problems.some((p) => p.level === "error"));
    const invalid = fixture({ card, resolve: false });
    assert.ok(validatePlan(invalid.plan, { manifest, index: invalid.index }).some((p) => p.level === "error"));
    assert.throws(() => output(invalid));
  }
  assert.ok(resolveCard({ ...spec, stylePreset: "editorial" }, { manifest, mode: "overlay" }).problems.some((p) => p.code === "card-provenance"));
  assert.ok(resolveCard(spec, { manifest, mode: "insert" }).problems.some((p) => /overlay/.test(p.message)));
  for (const bad of [{ name: "Invented name" }, { title: "Event planner" }, { org: "Invented company" }, { proofId: "missing" }]) {
    const card = { ...spec, ...bad }, invalid = fixture({ card, resolve: false });
    assert.ok(resolveCard(card, { manifest, mode: "overlay" }).problems.some((p) => p.level === "error"));
    assert.ok(validatePlan(invalid.plan, { manifest, index: invalid.index }).some((p) => p.level === "error"));
  }
  const pending = structuredClone(manifest); pending.rights[0].status = "pending";
  for (const final of [false, true]) {
    const issues = (layout) => resolveCard({ type: "testimonial-name", proofId: "t", layout }, { manifest: pending, final, mode: "overlay" }).problems.filter((p) => p.code === "card-rights");
    assert.deepEqual(issues("cinematic"), issues("premium"));
    assert.equal(issues("cinematic")[0].level, final ? "error" : "warn");
  }
  const wrongHost = structuredClone(f.resolved); wrongHost.items[0].sourceId = "other";
  assert.ok(cardChecks(wrongHost, { manifest, tokens, index: f.index }).some((p) => p.code === "card-testimonial-name"));
  const short = structuredClone(f.resolved); short.overlays[0].outputEnd = short.overlays[0].outputStart + 119 / 30;
  assert.ok(cardChecks(short, { manifest, tokens, index: f.index }).some((p) => p.code === "card-hold"));
  assert.throws(() => render(spec, { start: 0, end: 119 / 30 }), /at least 4 seconds/);
});

test("cinematic testimonial portrait gutters stay safe at every active height, push and supported pixel aspect", () => {
  for (const ratio of [null, 2.35, 2.39]) for (const push of [1, 1.2]) for (const meta of [portrait, { ...portrait, width: 1080, height: 1920 }, { ...portrait, width: 900, height: 1000 }, { ...portrait, width: 650, height: 720 }, { ...portrait, sampleAspectRatio: "1:2" }, { ...portrait, sampleAspectRatio: "2:1", rotationCw: 90 }]) {
    const f = fixture({ meta, ratio, push }), box = activeBox(ratio), raw = output(f);
    const l = raw.review.find((r) => r.id === "who").layout;
    safe(l, box); assert.equal(l.x, 96); assert.equal(l.y + l.h, box.height - 96);
    assert.ok(l.w <= 536); assert.ok(l.portrait);
    assert.equal(l.name.fontSize, 60); assert.equal(l.title.fontSize, 40); assert.equal(l.org.fontSize, 36);
    safe(letterboxCards(raw, box, f.resolved).review.find((r) => r.id === "who").layout, box, true);
    assert.ok(!cardChecks(f.resolved, { manifest, tokens, index: f.index }).some((p) => p.code === "card-text-fit"));
  }
  const r = testimonialNameCard({ ...resolveCard(spec, { manifest, mode: "overlay" }).card, title: "Client", org: "" }, { tokens, context: { item: { fit: "wash" } } });
  safe(r.layout, activeBox()); assert.equal(r.layout.w, 330);
});

test("cinematic testimonial caption uses cropped portrait geometry without changing premium placement", () => {
  const f = fixture({ meta: landscape, fit: "wash", sourceCrop: { x: 0.35, y: 0, w: 0.3, h: 1 } });
  const l = output(f).review.find((r) => r.id === "who").layout;
  assert.ok(l.portrait); safe(l, activeBox()); assert.equal(l.w, 536);
  for (const extra of [{ tokens }, {}]) assert.doesNotThrow(() => cardChecks(f.resolved, { manifest, ...extra }));
  const p = fixture({ meta: landscape, fit: "wash", card: { type: "testimonial-name", layout: "premium", proofId: "t" } });
  assert.equal(output(p).review.find((r) => r.id === "who").layout.activeAware, undefined);
});

test("cinematic testimonial landscape and saved non-wash fits use the lower-left scrim inside safe margins", () => {
  for (const ratio of [null, 2.35, 2.39]) for (const fit of [undefined, "contain", "cover", "blur", "wash"]) {
    const f = fixture({ meta: landscape, fit, ratio }), raw = output(f), box = activeBox(ratio);
    const l = raw.review.find((r) => r.id === "who").layout;
    safe(l, box); assert.equal(l.w, 1152); assert.ok(!l.portrait);
    assert.match(raw.css, /height:33\.333333%;background:linear-gradient\(to bottom,rgba\(0,0,0,0\).*rgba\(0,0,0,0\.45\) 100%\)/);
    safe(letterboxCards(raw, box, f.resolved).review.find((r) => r.id === "who").layout, box, true);
  }
  for (const fit of ["contain", "blur"]) {
    const f = fixture({ fit });
    assert.equal(output(f).review.find((r) => r.id === "who").layout.w, 1152);
  }
});

test("cinematic testimonial HTML has no plate, uses white display/body type, accent rule and shared shadows", () => {
  const r = render(spec, { context: { item: { fit: "wash" }, meta: portrait } });
  assert.doesNotMatch(r.html, /background:|sc-route|sc-headshot|sc-plate|undefined/);
  assert.match(r.html, /class="sc-name" style="font-size:60px">Sonia/);
  assert.match(r.html, /class="sc-body sc-cinematic-role" style="font-size:40px">Coaching client/);
  assert.match(r.html, /margin-left:24px/); assert.match(r.html, /class="sc-cinematic-rule"/);
  assert.match(r.css, /\.sc-cinematic\{[^}]*background:none;border-radius:0;color:#fff/);
  assert.match(r.css, /\.sc-name \{ font-family:var\(--brand-display-font\)/);
  assert.match(r.css, /\.sc-body \{ font-family:var\(--brand-body-font\)/);
  assert.match(r.css, /letter-spacing:2\.4px/);
  assert.match(r.css, /text-shadow:0 2px 3px rgba\(0,0,0,0\.6\),0 6px 18px rgba\(0,0,0,0\.45\),0 14px 40px rgba\(0,0,0,0\.3\)/);
  assert.match(r.css, /width:4px;height:120px;transform:scaleY\(0\);transform-origin:50% 100%/);
  assert.doesNotMatch(r.css, /::before|linear-gradient/);
  const m = structuredClone(manifest); m.proof[0].attribution.org = "";
  const f = fixture(), emptyOrg = output(f, m);
  assert.ok(!emptyOrg.html.includes('font-size:36px'));
  const noRule = render({ ...spec, accent: false });
  assert.doesNotMatch(noRule.html, /class="sc-cinematic-rule"/); assert.doesNotMatch(noRule.timeline, /scaleY/);
});

test("cinematic testimonial collision checks use the actual caption rectangle with or without tokens", () => {
  const f = fixture();
  f.resolved.overlays.push({ ...f.resolved.overlays[0], id: "duplicate" });
  for (const extra of [{ tokens }, {}]) assert.ok(cardChecks(f.resolved, { manifest, index: f.index, ...extra }).some((p) => p.code === "card-overlay-collision"));
  f.resolved.overlays[1].card = { type: "topic", text: "Speaker" };
  for (const extra of [{ tokens }, {}]) assert.ok(!cardChecks(f.resolved, { manifest, index: f.index, ...extra }).some((p) => p.code === "card-overlay-collision"));
});

test("cinematic testimonial refuses oversized attribution rather than overflowing the portrait gutter", () => {
  for (const field of ["name", "title", "org"]) {
    const m = structuredClone(manifest); m.proof[0].attribution[field] = "W".repeat(150);
    const f = fixture();
    assert.ok(cardChecks(f.resolved, { manifest: m, tokens, index: f.index }).some((p) => p.code === "card-text-fit"));
    assert.throws(() => output(f, m), /minimum readable/);
  }
});

function seekable(timeline) {
  const context = { setTimeout: () => 0, clearTimeout: () => {} }; vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const tl = context.window.gsap.timeline({ paused: true }), targets = new Map();
  const target = (s) => {
    if (!targets.has(s)) targets.set(s, { autoAlpha: 0, y: 0, scaleY: 0 });
    return targets.get(s);
  };
  vm.runInNewContext(timeline, { tl: { set: (s, ...args) => tl.set(target(s), ...args), fromTo: (s, ...args) => tl.fromTo(target(s), ...args) } });
  return { tl, targets };
}

test("cinematic testimonial seeks exact rule 0–6, copy 2–10 and exit 129–135 frames in either direction", () => {
  const r = render(), { tl, targets } = seekable(r.timeline);
  const root = targets.get("#speaker-card"), copy = targets.get("#speaker-card .sc-testimonial-text"), rule = targets.get("#speaker-card .sc-cinematic-rule");
  assert.equal(r.durationHints.enter, 10 / 30); assert.equal(r.durationHints.exit, 6 / 30);
  assert.equal(r.durationHints.fullyLegible, 119 / 30); assert.equal(r.durationHints.min, 4);
  const frames = Array.from({ length: 140 }, (_, n) => n + 29);
  const values = new Map(), ease = (p) => 1 - (1 - p) ** 3;
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.00001, `${message}: ${actual} vs ${expected}`);
  for (const frame of [...frames, ...frames.toReversed(), 41, 31, 160, 166, 32, 41]) {
    tl.seek(frame / 30);
    const local = frame - 31;
    near(root.autoAlpha, local < 0 || local >= 135 ? 0 : local <= 129 ? 1 : (135 - local) / 6, `root frame ${frame}`);
    if (local >= 0 && local < 135) {
      const p = Math.max(0, Math.min(1, (local - 2) / 8));
      near(copy.autoAlpha, ease(p), `copy frame ${frame}`);
      // Before its tween starts, CSS hides the group; it has no visible position to compare.
      if (local >= 2) near(copy.y, 12 * (1 - ease(p)), `rise frame ${frame}`);
      near(rule.scaleY, ease(Math.min(1, local / 6)), `rule frame ${frame}`);
    }
    const visible = [root.autoAlpha, root.autoAlpha ? copy.autoAlpha : 0, root.autoAlpha && copy.autoAlpha ? copy.y : 0, root.autoAlpha ? rule.scaleY : 0];
    if (values.has(frame)) visible.forEach((v, i) => near(v, values.get(frame)[i], `repeat frame ${frame}`));
    else values.set(frame, visible);
  }
  const { motion, ...fadeSpec } = spec;
  const fade = render(fadeSpec);
  assert.match(fade.timeline, /autoAlpha:0,y:0/);
  assert.doesNotMatch(r.timeline, /scale:0\.82|Date|random/);
});

test("lavfi: cinematic testimonial keeps the base graph unchanged and clears measured portrait foregrounds", (t) => {
  for (const { ratio, meta } of [...[null, 2.35, 2.39].map((ratio) => ({ ratio, meta: portrait })), { ratio: null, meta: { ...portrait, width: 650, height: 720 } }]) {
    const f = fixture({ ratio, meta }), box = activeBox(ratio), graph = fitGraph("0:v", "pic", fitGeometry(meta, "wash"), { fit: "wash", frames: 1, active: box }).join(";");
    const base = () => execFileSync("ffmpeg", ["-v", "error", "-filter_complex_threads", "1", "-f", "lavfi", "-i", `color=white:s=${meta.width}x${meta.height}:r=30:d=0.034`, "-filter_complex", graph, "-map", "[pic]", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { maxBuffer: 7 * 1024 * 1024 });
    const before = base(), raw = output(f), after = base();
    assert.deepEqual(after, before, "HTML composition leaves base pixels identical");
    const white = (x, y) => [...after.subarray((y * 1920 + x) * 3, (y * 1920 + x) * 3 + 3)].every((v) => v >= 240);
    const xs = Array.from({ length: 1920 }, (_, x) => x).filter((x) => white(x, 540));
    const ys = Array.from({ length: 1080 }, (_, y) => y).filter((y) => white(960, y));
    const l = raw.review.find((r) => r.id === "who").layout;
    assert.ok(l.x + l.w + 48 <= xs[0]);
    t.diagnostic(`${meta.width}x${meta.height}, ${ratio || "16:9"}: foreground ${xs.length}x${ys.length} at ${xs[0]},${ys[0]}; caption right ${l.x + l.w}; gap ${xs[0] - l.x - l.w}px; repeat RGB identical; graph: ${graph}`);
  }
});
