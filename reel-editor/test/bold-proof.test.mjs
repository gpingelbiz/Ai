import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { PNG } from "pngjs";
import { boldEvidenceEnabled, proofClaimMatches, loadBoldProof, validateProofPick, validateDefinePick, stageBoldProof, placeBoldCard } from "../src/bold-proof.mjs";
import { boldOverlayHandler, boldOverlayPrompts, validateBoldOverlay, placeBoldOverlays } from "../src/bold-overlays.mjs";
import { boldSettings, restyleBold } from "../src/bold.mjs";
import { boldHTML, boldCSS, boldOverlayTimeline } from "../src/bold-render.mjs";
import { loadPreset } from "../src/presets.mjs";
import { eventClock } from "../src/event-clock.mjs";
import { run } from "../src/util.mjs";
import { allowedFile } from "../scripts/release.mjs";

function fixture(t, text = "Our booked calls report shows forty calls. Show rate means calls that actually showed up.") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bold-proof-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const words = text.split(" ").map((text, i) => ({ text, start: 4 + i * 0.2, end: 4.15 + i * 0.2 }));
  const style = loadPreset("pingel-bold"); style.bold.proof.manifest = path.join(root, "manifest.json");
  const plan = { preset: "pingel-bold", style, words, video: { duration: 25 }, canvas: { width: 1080, height: 1920 }, audio: { tracks: [] } };
  const entry = { id: "calls", file: "calls.png", crop: { x: 0, y: 0, w: 1, h: 1 }, proves: "Our booked calls report shows forty calls", date: "2026-11-10", label: "Booked calls report", redact: [{ x: 0.7, y: 0.7, w: 0.2, h: 0.1 }], approved: true };
  const png = new PNG({ width: 600, height: 200 }); png.data.fill(255);
  fs.writeFileSync(path.join(root, "calls.png"), PNG.sync.write(png));
  const write = (entries = [entry]) => fs.writeFileSync(style.bold.proof.manifest, JSON.stringify({ schemaVersion: 1, entries }));
  write();
  fs.writeFileSync(path.join(root, "glossary.json"), JSON.stringify({ schemaVersion: 1, entries: [{ term: "Show rate", definition: "Calls that actually showed up", approved: true }, { term: "setter", definition: "Do not show", approved: false }] }));
  const context = { plan, words, env: {}, settings: boldSettings(style), fps: 30, duration: 25, projectDir: path.join(root, "project"), log: () => {}, zones: { safe: { x: 76, y: 200, w: 928, h: 1400 }, caption: { x: 76, y: 1056, w: 928, h: 150 }, headline: { x: 76, y: 200, w: 928, h: 140, end: 3 }, faces: [{ x: 350, y: 400, w: 300, h: 400, start: 0, end: 25 }], measured: true } };
  context.proofCatalog = loadBoldProof(context);
  const proof = { kind: "proof", from: 0, to: 6, entryId: "calls", reason: "The report supports booked calls" };
  const define = { kind: "define", from: 7, to: words.length - 1, term: { from: 7, to: 8 }, definitionRange: { from: 10, to: words.length - 1 }, reason: "Explains the term" };
  return { root, context, entry, write, proof, define };
}

test("approved manifest and glossary stay Greg-only, portrait-only, local, bounded and private", (t) => {
  const f = fixture(t), c = f.context;
  assert.equal(boldEvidenceEnabled(c), true); assert.equal(boldEvidenceEnabled(), false);
  assert.equal(c.proofCatalog.entries.length, 1); assert.equal(c.proofCatalog.glossary.length, 1);
  for (const env of [{ REEL_CLIENT: "fixture" }, { REEL_CLIENT_MODE: "1" }]) {
    const client = { ...c, env };
    assert.equal(boldEvidenceEnabled(client), false); assert.deepEqual(loadBoldProof(client).entries, []);
    assert.equal(validateProofPick(f.proof, client), null); assert.equal(validateDefinePick(f.define, client), null);
  }
  for (const preset of ["clean", "brand-fixture", "vsl", "speaker", "youtube"]) assert.equal(boldEvidenceEnabled({ ...c, plan: { ...c.plan, preset } }), false);
  assert.equal(boldEvidenceEnabled({ ...c, plan: { ...c.plan, canvas: { width: 1920, height: 1080 } } }), false);
  for (const bad of [{ approved: false }, { crop: { x: 0, y: 0, w: 2, h: 1 } }, { redact: [{}] }, { file: "missing.png" }, { file: "/etc/passwd" }, { label: "Made up ".repeat(20) }, { date: "unknown" }]) {
    f.write([{ ...f.entry, ...bad }]); assert.deepEqual(loadBoldProof(c).entries, [], JSON.stringify(bad));
  }
  f.write([f.entry, f.entry]); assert.deepEqual(loadBoldProof(c).entries, []);
  fs.symlinkSync("/etc/passwd", path.join(f.root, "outside.png")); f.write([{ ...f.entry, file: "outside.png" }]);
  assert.deepEqual(loadBoldProof(c).entries, []);
  for (const file of ["presets/pingel-bold.json", "test/fixtures/bold-proof/manifest.json", "docs/bold-proof.md"]) assert.equal(allowedFile(file), false);
  const placeholder = JSON.parse(fs.readFileSync(new URL("./fixtures/bold-proof/manifest.json", import.meta.url)));
  assert.equal(placeholder.entries[0].approved, false);
});

test("claim grounding and source labels reject unrelated proof and model-written copy", (t) => {
  const { context: c, proof } = fixture(t);
  assert.equal(proofClaimMatches("Our booked calls report", "Booked calls in our report"), true);
  assert.equal(proofClaimMatches("Our sales were forty", "Forty views this month"), false);
  assert.equal(proofClaimMatches("The CPM", "CPM report"), true);
  assert.equal(proofClaimMatches("40 booked calls", "Sixteen booked calls"), false);
  assert.equal(proofClaimMatches("40 booked calls", "Forty booked calls"), true);
  assert.equal(proofClaimMatches("$10K collected cash", "Ten thousand dollars collected cash"), true);
  const valid = validateBoldOverlay({ ...proof, text: "Invented claim", holdSeconds: 999, src: "https://example.com" }, c);
  assert.equal(valid.entryId, "calls"); assert.ok(valid.holdSeconds <= 6); assert.equal(valid.text, undefined); assert.equal(valid.src, undefined);
  assert.equal(validateProofPick({ ...proof, entryId: "made-up" }, c), null);
  assert.equal(validateProofPick({ ...proof, label: { from: 10, to: 12 } }, c), null);
  assert.equal(validateProofPick({ ...proof, entrance: "bounce" }, c), null);
  const prompt = boldOverlayPrompts(c);
  assert.match(prompt, /"id":"calls"/); assert.match(prompt, /Zero is fine/);
  assert.doesNotMatch(prompt, /calls\.png|\/tmp|\/Users|Do not show/);
});

test("missing manifests and selected missing sources fail closed with one safe log line", async (t) => {
  const f = fixture(t), messages = [];
  fs.rmSync(f.context.plan.style.bold.proof.manifest);
  const c = { ...f.context, log: (line) => messages.push(line) }; c.proofCatalog = loadBoldProof(c);
  assert.equal(validateProofPick(f.proof, c), null); assert.equal(validateProofPick(f.proof, c), null);
  assert.equal(messages.length, 1); assert.match(messages[0], /manifest/);
  f.write(); c.proofCatalog = loadBoldProof(c); fs.rmSync(path.join(f.root, "calls.png"));
  assert.deepEqual(await stageBoldProof([f.proof, f.proof], c), {});
  assert.equal(messages.length, 2); assert.doesNotMatch(messages.join(" "), /forty|calls\.png/);
});

test("definitions select only transcript explanations or an approved glossary for a spoken term", (t) => {
  const { context: c, define } = fixture(t);
  const transcript = validateDefinePick(define, c);
  assert.deepEqual(transcript.definitionRange, define.definitionRange);
  const glossary = { ...define, definitionRange: undefined, glossaryTerm: "Show rate" };
  assert.ok(validateDefinePick(glossary, c));
  for (const bad of [{ term: { from: 0, to: 1 } }, { glossaryTerm: "setter", definitionRange: undefined }, { definitionRange: { from: 0, to: 2 } }, { definitionRange: undefined, definition: "Claude invented this" }, { glossaryTerm: "Show rate" }]) assert.equal(validateDefinePick({ ...define, ...bad }, c), null);
  const event = placeBoldOverlays([validateBoldOverlay(glossary, c)], c)[0];
  assert.equal(event.data.term, "Show rate"); assert.equal(event.data.definition, "Calls that actually showed up");
  const html = boldOverlayHandler("define").html(event, { esc: (s) => String(s).replace(/</g, "&lt;"), i: 0 });
  assert.match(html, /Calls that actually showed up/);
  assert.ok(event.endFrame - event.landingFrame >= 105); assert.ok(event.endFrame - event.startFrame <= 180);
});

test("proof staging reuses privacy redactions and copies only the irreversible crop", async (t) => {
  const { context: c, proof, root } = fixture(t);
  const ocr = { width: 600, height: 200, lines: [
    { text: "Booked calls report", box: { x: 0.1, y: 0.1, w: 0.8, h: 0.25 } },
    { text: "a@example.com 480-555-1212", box: { x: 0.1, y: 0.5, w: 0.8, h: 0.1 } },
    { text: "123 Main Street 123456789", box: { x: 0.1, y: 0.8, w: 0.8, h: 0.1 } },
  ], faces: [] };
  let boxes;
  const redact = async (source, redactions, out) => {
    boxes = redactions;
    const filters = redactions.map((b) => `drawbox=x=${Math.floor(b.x * 600)}:y=${Math.floor(b.y * 200)}:w=${Math.ceil(b.w * 600)}:h=${Math.ceil(b.h * 200)}:color=black:t=fill`).join(",");
    await run("ffmpeg", ["-y", "-v", "error", "-i", source, "-vf", filters, "-frames:v", "1", out], { capture: true });
  };
  const assets = await stageBoldProof([proof], c, { inspect: async () => ocr, redact });
  assert.ok(assets.calls); assert.ok(boxes.length >= 5, "email, phone, address, digits and manual masks");
  const file = path.join(c.projectDir, assets.calls.src), pixels = PNG.sync.read(fs.readFileSync(file));
  const box = boxes[0], offset = (Math.floor((box.y + box.h / 2) * 200) * 600 + Math.floor((box.x + box.w / 2) * 600)) * 4;
  assert.equal(pixels.data[offset], 0); assert.equal(pixels.data[0], 255);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)]);
  assert.doesNotMatch(JSON.stringify(assets), /example\.com|480-555|Main Street/);
  assert.ok(fs.existsSync(path.join(root, "calls.png")), "source untouched");
  assert.deepEqual(await stageBoldProof([proof], { ...c, env: { REEL_CLIENT: "fixture" } }, { inspect: () => assert.fail("client OCR") }), {});
});

test("unavailable OCR and a crop cutting source text fail closed before assets or sounds", async (t) => {
  const { context: c, proof } = fixture(t), messages = [];
  c.log = (line) => messages.push(line);
  assert.deepEqual(await stageBoldProof([proof], c, { inspect: async () => { throw new Error("local OCR unavailable"); } }), {});
  assert.equal(messages.length, 1);
  c.proofCatalog.reported = false;
  c.proofCatalog.entries[0].crop = { x: 0, y: 0, w: 0.5, h: 1 };
  assert.deepEqual(await stageBoldProof([proof], c, { inspect: async () => ({ width: 600, height: 200, lines: [{ text: "Booked calls report", box: { x: 0.1, y: 0.1, w: 0.8, h: 0.25 } }] }), redact: () => assert.fail("clipped source must not stage") }), {});
  assert.equal(messages.length, 2); assert.equal(fs.existsSync(c.projectDir), false);
  assert.deepEqual(placeBoldOverlays([validateBoldOverlay(proof, c)], c), []);
});

test("placement enforces legibility, face/caption clearance, hold, budget and one definition per term", (t) => {
  const f = fixture(t), c = f.context;
  c.proofAssets = { calls: { src: "assets/bold-proof/test.png", width: 600, height: 200, lines: [{ box: { h: 0.25 } }] } };
  const pick = validateBoldOverlay(f.proof, c), event = placeBoldOverlays([pick], c)[0];
  assert.ok(event); assert.equal(event.landingFrame, event.startFrame + 8); assert.ok(event.data.textPx >= 32);
  assert.equal(placeBoldOverlays([pick], { ...c, duration: 6 }).length, 0);
  assert.equal(placeBoldOverlays([pick], { ...c, zones: { ...c.zones, measured: false } }).length, 0);
  const tiny = { ...c, proofAssets: { calls: { ...c.proofAssets.calls, lines: [{ box: { h: 0.01 } }] } } };
  assert.equal(placeBoldOverlays([pick], tiny).length, 0);
  const later = { ...pick, from: 10, to: 14 };
  assert.equal(placeBoldOverlays([pick, later], c).length, 1);
  assert.equal(placeBoldCard({ w: 1000, h: 1000 }, event, c), null);
  const define = validateBoldOverlay(f.define, c);
  assert.equal(placeBoldOverlays([define, define], { ...c, duration: 60 }).length, 1);
  const sound = boldOverlayHandler("proof").sounds(event, c)[0];
  assert.equal(sound.start, eventClock({ landAt: event.landing, sfx: "card.wav", fps: 30 }).start);
  assert.equal(sound.volume, 0.12);
});

test("one planning call prepares, places and rebuilds cached definitions with every caption intact", async (t) => {
  const { context: c, define } = fixture(t);
  const direction = { schemaVersion: 1, argument: { buyerProblem: null, answer: null, payoff: null }, headline: { from: 0, to: 3, emphasis: 1, reason: "Spoken promise" }, punch: [], emphasis: [], turns: [], overlays: [define] };
  let calls = 0;
  const options = { env: {}, outDir: path.dirname(c.projectDir), render: "/baseline", ask: async (prompt) => { calls++; assert.match(prompt, /"term":"Show rate"/); return direction; }, detect: async () => ({ frames: [{ t: 5, faces: [{ x: 0.3, y: 0.2, w: 0.3, h: 0.2 }] }] }) };
  const result = await restyleBold(c.plan, options);
  assert.equal(calls, 1); assert.equal(result.plan.bold.overlays.length, 1);
  assert.equal(result.plan.captions.flatMap((g) => g.words).length, c.words.length);
  const cached = await restyleBold(c.plan, { ...options, picks: result.picks, ask: () => assert.fail("second call") });
  assert.deepEqual(cached.plan.bold, result.plan.bold);
  const html = boldHTML(result.plan, { settings: c.settings }); assert.match(html, /bold-definition-term/);
  const css = boldCSS(c.settings, result.plan);
  for (const rule of css.split("}").filter((part) => part.trim())) for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) assert.ok(selector.trim().startsWith(".bold-root "));
  new vm.Script(boldOverlayTimeline(result.plan, c.settings));
});

test("proof restyles stage a deterministic cleaned asset, and cached picks cannot bypass revoked approval", async (t) => {
  const { context: c, proof, entry, write } = fixture(t);
  const direction = { schemaVersion: 1, argument: { buyerProblem: null, answer: null, payoff: null }, headline: { from: 0, to: 3, emphasis: 1, reason: "Spoken promise" }, punch: [], emphasis: [], turns: [], overlays: [proof] };
  const options = { env: {}, log: () => {}, outDir: path.dirname(c.projectDir), render: "/baseline", picks: direction, ask: () => assert.fail("cached picks need no API"), detect: async () => ({ frames: [{ t: 5, faces: [{ x: 0.3, y: 0.2, w: 0.3, h: 0.2 }] }] }), proof: { inspect: async () => ({ width: 600, height: 200, lines: [{ text: "Booked calls report forty", box: { x: 0.1, y: 0.1, w: 0.8, h: 0.25 } }] }), redact: async (source, boxes, out) => { assert.ok(boxes.length); fs.copyFileSync(source, out); } } };
  const first = await restyleBold(c.plan, options), second = await restyleBold(c.plan, { ...options, picks: first.picks });
  assert.equal(first.plan.bold.overlays.length, 1); assert.deepEqual(second.plan.bold, first.plan.bold);
  const event = first.plan.bold.overlays[0];
  assert.ok(fs.existsSync(path.join(c.projectDir, event.data.src)));
  assert.equal(first.plan.audio.tracks.length, 1);
  event.data.label = '<script>"&';
  const html = boldHTML(first.plan, { settings: c.settings });
  assert.match(html, /&lt;script&gt;&quot;&amp;/); assert.doesNotMatch(html, /<script>|calls\.png/);
  write([{ ...entry, approved: false }]);
  const revoked = await restyleBold(c.plan, { ...options, picks: first.picks });
  assert.deepEqual(revoked.plan.bold.overlays, []); assert.deepEqual(revoked.plan.audio.tracks, []);
  assert.equal(revoked.plan.captions.flatMap((group) => group.words).length, c.words.length);
});

test("card timelines are identical at every frame under forward, reverse and shuffled GSAP seeks", (t) => {
  const { context: c, define } = fixture(t);
  const events = placeBoldOverlays([validateBoldOverlay(define, c)], c);
  const sandbox = { window: {}, console, setTimeout, clearTimeout }; sandbox.window = sandbox; sandbox.global = sandbox;
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), sandbox);
  const gsap = sandbox.gsap, timeline = gsap.timeline({ paused: true }), targets = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  let initialY = 48;
  const target = (id) => { if (!targets.has(id)) targets.set(id, { opacity: 0, y: initialY }); return targets.get(id); };
  const tl = Object.fromEntries(["set", "fromTo"].map((method) => [method, (id, ...args) => { timeline[method](target(id), ...args); return tl; }]));
  for (const entrance of ["slide", "cut"]) {
    timeline.clear(); targets.clear();
    initialY = entrance === "cut" ? 0 : 48;
    new Function("tl", boldOverlayHandler("define").timeline({ ...events[0], entrance }, { i: 0, plan: c.plan }))(tl);
    const sample = (frame) => { timeline.totalTime(frame / 30, false); return [...targets.values()].map((item) => [item.opacity, item.y]); };
    const frames = Array.from({ length: 750 }, (_, i) => i), forward = frames.map(sample);
    for (const frame of [...frames].reverse()) assert.deepEqual(sample(frame), forward[frame], `reverse ${entrance} ${frame}`);
    for (const frame of frames.map((i) => i * 137 % 750)) assert.deepEqual(sample(frame), forward[frame], `shuffle ${entrance} ${frame}`);
  }
});
