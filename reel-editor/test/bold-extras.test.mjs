import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { PNG } from "pngjs";
import { boldExtrasAllowed, clearBoldPhoto, prepareBoldExtras, trimBoldStickerPNG, stageBoldExtras, validateBoldSticker, placeBoldExtraBox, placeBoldSticker, validateBoldPayoff, boldPayoffPieces, placeBoldPayoff, boldExtraSounds, boldExtraTimeline } from "../src/bold-extras.mjs";
import { boldSettings, boldPrompt, validateBoldPicks, fallbackBoldDirection, restyleBold } from "../src/bold.mjs";
import { boldOverlayHandler, placeBoldOverlays, boldBoxesOverlap } from "../src/bold-overlays.mjs";
import { boldHTML, boldCSS, boldOverlayTimeline } from "../src/bold-render.mjs";
import { eventClock } from "../src/event-clock.mjs";
import { loadPreset } from "../src/presets.mjs";
import { fixturePlan } from "../scripts/golden.mjs";
import { renderHTML } from "../src/compose.mjs";
import { allowedFile } from "../scripts/release.mjs";

const words = "Ask better questions and help people choose the right solution. That is how you win ten new clients this month and build a healthy business.".split(" ").map((text, i) => ({ text, start: i, end: i + 0.6 }));
const sticker = (from = 4, purpose = "prop") => ({ kind: "sticker", from, to: from, reason: "A real prop clarifies the sentence", asset: "icon-phone", purpose });
const payoff = (from = 16) => ({ kind: "payoff", from, to: from, reason: "The spoken client result earns the payoff", style: "stack" });
const punch = { from: 14, to: 19, role: "payoff", emphasis: 15, payoff: 15, reason: "Spoken result" };
const p = () => ({ ...fixturePlan("/fixture.mp4"), preset: "pingel-bold", style: loadPreset("pingel-bold"), words: structuredClone(words), video: { duration: 30, src: "/fixture.mp4" }, audio: { tracks: [] } });
function context() {
  const plan = p(), settings = boldSettings(plan.style);
  settings.sticker.enabled = true; settings.payoff.enabled = true;
  plan.style.bold.sticker.enabled = true; plan.style.bold.payoff.enabled = true;
  const zones = { safe: { x: 76, y: 200, w: 928, h: 1400 }, caption: { x: 76, y: 1056, w: 928, h: 160 }, headline: { x: 76, y: 200, w: 928, h: 150, end: 3 }, faces: [{ x: 420, y: 500, w: 200, h: 320, start: 0, end: 30 }], measured: true };
  plan.bold = { groups: [{ from: 14, to: 19, mode: "punch", role: "payoff" }], overlays: [], zones };
  return { plan, env: {}, words, settings, zones, punch: [punch], fps: 30, duration: 30, overlays: [], extraAssets: [{ id: "icon-phone", type: "icon", description: "A gold phone" }], stagedExtras: new Map([["icon-phone", { src: "assets/bold-extras/icon-abc123.png", width: 400, height: 400, type: "icon" }]]) };
}
function imageBuffer() {
  const png = new PNG({ width: 20, height: 30 });
  for (let y = 4; y < 26; y++) for (let x = 4; x < 16; x++) { const at = (y * 20 + x) * 4; png.data[at] = 200; png.data[at + 1] = 160; png.data[at + 2] = 70; png.data[at + 3] = 255; }
  return PNG.sync.write(png);
}
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bold-extras-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const photoReport = (file) => ({ file, width: 1200, height: 1600, camera: "phone", light: 0.45, sharp: 0.01, faces: [{ x: 0.3, y: 0.2, w: 0.25, h: 0.3, quality: 0.7 }] });

test("personal extras require a Greg preset, opt-in, portrait and a personal job; client releases exclude their preset", async (t) => {
  const ctx = context(); assert.equal(boldExtrasAllowed(ctx), true);
  const root = temp(t);
  for (const change of [{ env: { REEL_CLIENT: "jane" } }, { env: { REEL_CLIENT_MODE: "1" } }, { plan: { ...ctx.plan, preset: "brand-jane" } }, { plan: { ...ctx.plan, canvas: { width: 1920, height: 1080 } } }, { plan: { ...ctx.plan, style: {} } }]) {
    const refused = { ...ctx, ...change, outDir: path.join(root, "job"), projectDir: path.join(root, "job/project") };
    assert.equal(boldExtrasAllowed(refused), false);
    assert.deepEqual(await prepareBoldExtras(refused, { detect: () => assert.fail("no client photo access") }), []);
    assert.equal((await stageBoldExtras([sticker()], refused, { cutout: () => assert.fail("no client cutout") })).size, 0);
    assert.equal(validateBoldSticker(sticker(), refused), null); assert.equal(validateBoldPayoff(payoff(), refused), null);
    assert.equal(placeBoldSticker({ ...sticker(), startFrame: 120 }, refused), null);
    assert.equal(placeBoldPayoff(payoff(), refused), null);
  }
  assert.equal(fs.existsSync(path.join(root, "job")), false);
  assert.equal(allowedFile("presets/pingel-bold.json"), false);
  assert.equal(boldSettings(loadPreset("pingel-brand")).sticker.enabled, false);
  const bold = loadPreset("pingel-bold"); assert.equal(bold.bold.sticker.enabled, false); assert.equal(bold.bold.payoff.enabled, false);
  assert.equal(boldExtrasAllowed(), false);
});

test("clear photo checks require exactly one sharp, uncut face and reject unreadable or missing measurements", () => {
  const good = photoReport("a.jpg"); assert.equal(clearBoldPhoto(good), true);
  for (const change of [{ faces: [] }, { faces: [...good.faces, good.faces[0]] }, { faces: [{ ...good.faces[0], quality: 0.1 }] }, { faces: [{ ...good.faces[0], quality: undefined }] }, { faces: [{ ...good.faces[0], x: 0 }] }, { faces: [{ ...good.faces[0], h: 0.01 }] }, { width: 100 }, { sharp: 0.00001 }, { light: 0.1 }, { error: "bad" }, { screenshot: true }]) assert.equal(clearBoldPhoto({ ...good, ...change }), false, JSON.stringify(change));
  assert.equal(clearBoldPhoto(null), false);
});

test("asset discovery uses the preset folders, caches checks in the job, confines symlinks and tolerates absent libraries", async (t) => {
  const root = temp(t), photos = path.join(root, "photos"), icons = path.join(root, "icons"), outDir = path.join(root, "job");
  fs.mkdirSync(photos); fs.mkdirSync(icons);
  fs.writeFileSync(path.join(photos, "greg.jpg"), "real-photo-fixture"); fs.writeFileSync(path.join(photos, "group.jpg"), "two-face-fixture");
  fs.writeFileSync(path.join(icons, "icon-phone.png"), imageBuffer());
  fs.writeFileSync(path.join(root, "outside.png"), imageBuffer()); fs.symlinkSync(path.join(root, "outside.png"), path.join(icons, "icon-escape.png"));
  fs.writeFileSync(path.join(icons, "library.json"), JSON.stringify([{ name: "phone", draw: "Gold phone" }, { name: "missing" }, { name: "../outside" }, { name: "escape" }]));
  const ctx = { ...context(), outDir, projectDir: path.join(outDir, "project") };
  ctx.settings.sticker.photosDir = photos; ctx.settings.sticker.iconsDir = icons;
  let calls = 0;
  const detect = async (files) => { calls++; return files.map((file) => ({ ...photoReport(file), ...(file.endsWith("group.jpg") ? { faces: [photoReport(file).faces[0], photoReport(file).faces[0]] } : {}) })); };
  const assets = await prepareBoldExtras(ctx, { detect });
  assert.equal(assets.filter((a) => a.type === "photo").length, 1); assert.equal(assets.filter((a) => a.type === "icon").length, 1);
  assert.equal(assets[0].id, "icon-phone"); assert.ok(fs.existsSync(path.join(outDir, "bold-extras/photo-checks.json")));
  assert.deepEqual(await prepareBoldExtras(ctx, { detect }), assets); assert.equal(calls, 1);
  ctx.settings.sticker.photosDir = path.join(root, "absent"); ctx.settings.sticker.iconsDir = path.join(root, "absent");
  assert.deepEqual(await prepareBoldExtras(ctx, { detect }), []);
  ctx.settings.sticker.photosDir = photos;
  assert.equal((await prepareBoldExtras({ ...ctx, outDir: path.join(root, "broken-job") }, { detect: async () => { throw new Error("no helper"); } })).length, 0);
});

test("transparent trimming preserves real pixels and rejects empty, opaque and malformed cutouts", () => {
  const result = trimBoldStickerPNG(imageBuffer());
  assert.equal(result.width, 12); assert.equal(result.height, 22);
  const png = PNG.sync.read(result.buffer); assert.deepEqual([...png.data.subarray(0, 4)], [200, 160, 70, 255]);
  const empty = new PNG({ width: 10, height: 10 }); assert.throws(() => trimBoldStickerPNG(PNG.sync.write(empty)), /cutout/);
  empty.data.fill(255); assert.throws(() => trimBoldStickerPNG(PNG.sync.write(empty)), /cutout/);
  assert.throws(() => trimBoldStickerPNG(Buffer.from("invalid")));
});

test("selected real photos use injected cutout tooling once, cache it in the job and stage only relative project URLs", async (t) => {
  const root = temp(t), file = path.join(root, "greg.jpg"), outDir = path.join(root, "job"); fs.writeFileSync(file, "real photo fixture");
  const ctx = { ...context(), outDir, projectDir: path.join(outDir, "project"), extraAssets: [{ id: "photo-greg", type: "photo", root, file }] };
  const pick = { ...sticker(), asset: "photo-greg", purpose: "reaction" };
  let cuts = 0;
  const cutout = async (src, dest) => { cuts++; assert.equal(src, file); fs.writeFileSync(dest, imageBuffer()); };
  const first = await stageBoldExtras([pick], ctx, { cutout }); const second = await stageBoldExtras([pick], ctx, { cutout });
  assert.equal(cuts, 1); assert.deepEqual(first, second);
  const image = first.get("photo-greg"); assert.match(image.src, /^assets\/bold-extras\/photo-[a-f0-9]+\.png$/);
  assert.ok(fs.existsSync(path.join(ctx.projectDir, image.src))); assert.equal(image.width, 12); assert.equal(image.height, 22);
  assert.doesNotMatch(JSON.stringify(image), /greg\.jpg|\/Users\//);
  const broken = { ...ctx, outDir: path.join(root, "broken"), projectDir: path.join(root, "broken/project") };
  assert.equal((await stageBoldExtras([pick], broken, { cutout: async (_src, dest) => { fs.writeFileSync(dest, imageBuffer()); throw new Error("no clear mask"); } })).size, 0);
  assert.equal((await stageBoldExtras([pick], broken, { cutout })).size, 1, "partial failed mattes cannot poison the cache");
});

test("direction grounding permits catalog IDs only and a payoff requires an existing punch payoff", () => {
  const ctx = context();
  assert.deepEqual(validateBoldSticker(sticker(), ctx), { asset: "icon-phone", purpose: "prop" });
  for (const pick of [{ ...sticker(), asset: "../portrait.png" }, { ...sticker(), image: "https://example.com/a.png" }, { ...sticker(), purpose: "emoji" }]) assert.equal(validateBoldSticker(pick, ctx), null);
  assert.deepEqual(validateBoldPayoff(payoff(), ctx), { style: "stack" });
  assert.equal(validateBoldPayoff(payoff(2), ctx), null);
  assert.equal(validateBoldPayoff({ ...payoff(), amount: "1000000" }, ctx), null);
  assert.equal(validateBoldPayoff({ ...payoff(), style: "rain" }, ctx), null);
  assert.equal(validateBoldPayoff(payoff(), { ...ctx, punch: [{ ...punch, role: "money" }] }), null);
  const prompt = boldPrompt(words, { settings: ctx.settings, context: ctx });
  assert.match(prompt, /Rare and optional/); assert.match(prompt, /icon-phone/); assert.match(prompt, /never proof/);
  const reply = { ...fallbackBoldDirection(words), fallback: undefined, headline: { from: 0, to: 3, emphasis: 1, reason: "The lesson" }, punch: [punch], overlays: [payoff()] };
  assert.equal(validateBoldPicks(reply, words, { settings: ctx.settings, context: ctx }).overlays[0].kind, "payoff");
});

test("sticker admission clamps dimensions and time, enforces spacing, reel and reaction budgets, and rejects missing faces or assets", () => {
  const ctx = context(); ctx.settings.sticker.width = 999; ctx.settings.sticker.hold = 99; ctx.settings.sticker.maxPerReel = 99; ctx.settings.sticker.minSpacing = 0;
  const events = placeBoldOverlays([sticker(4), sticker(5), sticker(14), sticker(24)], ctx);
  assert.deepEqual(events.map((e) => e.from), [4, 14]);
  assert.equal(events[0].box.w, 320); assert.equal(events[0].endFrame - events[0].startFrame, 45); assert.equal(events[0].landingFrame, events[0].startFrame + 6);
  assert.ok(events.every((e) => !boldBoxesOverlap(e.box, ctx.zones.caption) && !boldBoxesOverlap(e.box, ctx.zones.faces[0])));
  assert.deepEqual(placeBoldOverlays([sticker(4, "reaction"), sticker(14, "reaction")], ctx).map((e) => e.from), [4]);
  assert.deepEqual(placeBoldOverlays([sticker(29)], { ...ctx, duration: 29.5 }), []);
  assert.deepEqual(placeBoldOverlays([sticker()], { ...ctx, stagedExtras: new Map() }), []);
  assert.deepEqual(placeBoldOverlays([sticker()], { ...ctx, zones: { ...ctx.zones, faces: [] } }), []);
  assert.equal(placeBoldExtraBox({ start: 4, end: 5 }, { ...ctx, zones: { ...ctx.zones, caption: ctx.zones.safe } }, 260, 260, true), null);
  assert.deepEqual(placeBoldOverlays([sticker()], { ...ctx, zones: { ...ctx.zones, faces: [{ x: 76, y: 200, w: 928, h: 1400, start: 0, end: 30 }] } }), []);
  ctx.settings.sticker.hold = 0; ctx.settings.sticker.width = 0;
  const small = placeBoldOverlays([sticker()], ctx)[0]; assert.equal(small.box.w, 220); assert.equal(small.endFrame - small.startFrame, 27);
});

test("payoff pieces are seeded and bounded; a surviving punch gets one short decoration below captions", () => {
  for (const style of ["stack", "burst"]) {
    const pieces = boldPayoffPieces(123, 9, style); assert.deepEqual(pieces, boldPayoffPieces(123, 9, style));
    assert.notDeepEqual(pieces, boldPayoffPieces(124, 9, style)); assert.equal(pieces.length, 9);
    assert.ok(pieces.every((p) => p.x >= 0 && p.x <= 90 && p.y >= 0 && p.y <= 80 && Math.abs(p.angle) <= 15));
  }
  assert.equal(boldPayoffPieces(0, 99).length, 12); assert.equal(boldPayoffPieces(0, 0).length, 3);
  const ctx = context(), events = placeBoldOverlays([payoff(16), payoff(18)], ctx);
  assert.equal(events.length, 1); assert.equal(events[0].endFrame - events[0].startFrame, 30);
  assert.ok(events[0].box.y >= ctx.zones.caption.y + ctx.zones.caption.h + 32);
  assert.equal(events[0].landingFrame, events[0].startFrame + 6);
  assert.deepEqual(placeBoldOverlays([payoff()], { ...ctx, plan: { ...ctx.plan, bold: { groups: [] } } }), []);
  assert.deepEqual(placeBoldOverlays([payoff(29)], ctx), []);
});

test("only accepted events get their own event-clock card or slam cue and all markup is scoped and escaped", () => {
  const ctx = context(), events = placeBoldOverlays([sticker(4), payoff(16)], ctx);
  assert.equal(events.length, 2);
  ctx.plan.bold.overlays = events;
  for (const event of events) {
    const [sound] = boldExtraSounds(event, ctx), file = event.kind === "sticker" ? "card.wav" : "slam.wav";
    assert.equal(sound.start, eventClock({ landAt: event.landing, sfx: file, fps: 30 }).start); assert.ok(sound.volume <= 0.2); assert.equal(sound.track, 9);
  }
  ctx.plan.bold.groups = [];
  const html = boldHTML(ctx.plan, { settings: ctx.settings }); assert.match(html, /bold-sticker/); assert.match(html, /bold-coin/); assert.doesNotMatch(html, /font-family.*emoji|1000000/);
  const malicious = { ...events[0], data: { src: 'x" onerror="alert(1)' } };
  assert.match(boldOverlayHandler("sticker").html(malicious, { esc: (s) => s.replaceAll('"', '&quot;'), i: 0 }), /&quot;/);
  const css = boldCSS(ctx.settings, ctx.plan);
  for (const rule of css.split("}").map((s) => s.trim()).filter(Boolean)) for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) assert.ok(selector.trim().startsWith(".bold-root "));
  assert.doesNotMatch(boldOverlayTimeline(ctx.plan, ctx.settings), /Math\.random|Date\.now|onComplete|onUpdate/);
});

test("actual GSAP restores sticker and payoff entrance, particles and exit under reverse, shuffled and cold seeks", (t) => {
  const ctx = context(), events = placeBoldOverlays([sticker(4), payoff(16)], ctx);
  const sandbox = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), sandbox);
  const gsap = sandbox.window.gsap;
  const build = () => {
    const timeline = gsap.timeline({ paused: true }), elements = new Map();
    const el = (selector) => { if (!elements.has(selector)) elements.set(selector, { opacity: 0, xPercent: 0, yPercent: 0, scale: 1 }); return elements.get(selector); };
    const tl = {};
    for (const method of ["set", "fromTo"]) tl[method] = (selector, ...args) => { timeline[method](el(selector), ...args); return tl; };
    events.forEach((event, i) => new Function("tl", boldOverlayHandler(event.kind).timeline(event, { plan: ctx.plan, i }))(tl));
    t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
    return (frame) => { timeline.totalTime(frame / 30, false); return [...elements].map(([id, element]) => [id, element.opacity, element.xPercent, element.yPercent, element.scale]); };
  };
  const seek = build(), frames = Array.from({ length: 600 }, (_, i) => i), expected = frames.map(seek);
  for (const frame of frames.toReversed()) assert.deepEqual(seek(frame), expected[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) { const frame = i * 137 % 600; assert.deepEqual(seek(frame), expected[frame], `shuffled ${frame}`); }
  for (const frame of [120, 126, 160, 480, 486, 506, 510]) assert.deepEqual(build()(frame), expected[frame], `cold ${frame}`);
  assert.equal(expected[126][0][1], 1); assert.equal(expected[165][0][1], 0);
  assert.equal(expected[481].find(([id]) => id.endsWith("nth-child(9)"))[1], 0, "later coins stay hidden until their accumulation step");
  assert.match(boldExtraTimeline(events[0], { fps: 30, i: 0 }), /duration:0.2/);
});

test("one planning call stages only chosen assets, keeps captions, schedules accepted sounds and stays absent from legacy/client HTML", async (t) => {
  const root = temp(t), iconsDir = path.join(root, "icons"), outDir = path.join(root, "job"); fs.mkdirSync(iconsDir);
  fs.writeFileSync(path.join(iconsDir, "icon-phone.png"), imageBuffer()); fs.writeFileSync(path.join(iconsDir, "library.json"), JSON.stringify([{ name: "phone", draw: "Gold phone" }]));
  const input = p(); Object.assign(input.style.bold.sticker, { enabled: true, iconsDir, photosDir: path.join(root, "missing") }); input.style.bold.payoff.enabled = true;
  let asks = 0;
  const ask = async (prompt) => { asks++; assert.match(prompt, /icon-phone/); return { ...fallbackBoldDirection(words), fallback: undefined, headline: { from: 0, to: 3, emphasis: 1, reason: "The lesson" }, punch: [punch], overlays: [sticker(4), payoff(16)] }; };
  const detection = { frames: Array.from({ length: 60 }, (_, i) => ({ t: i / 2, faces: [{ x: 0.4, y: 0.26, w: 0.18, h: 0.16 }] })) };
  const { plan: result } = await restyleBold(input, { ask, outDir, render: "/baseline.mp4", detect: async () => detection, env: {} });
  assert.equal(asks, 1); assert.equal(result.bold.overlays.length, 2); assert.equal(result.audio.tracks.length, 2);
  assert.equal(result.captions.flatMap((g) => g.words).length, words.length);
  assert.deepEqual(input.bold, undefined, "planning commits to a clone");
  const html = renderHTML(result, "assets/footage.mp4"); assert.match(html, /bold-sticker/); assert.match(html, /bold-payoff/);
  const code = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]; new vm.Script(code);
  const legacy = p(); legacy.preset = "clean"; legacy.style = loadPreset("clean"); legacy.bold = result.bold;
  assert.doesNotMatch(renderHTML(legacy, "assets/footage.mp4"), /bold-sticker|bold-payoff|bold-coin/);
  const refused = await restyleBold(input, { env: { REEL_CLIENT: "jane" }, ask: () => assert.fail("client cannot plan personal extras"), outDir: path.join(root, "client"), log: () => {} });
  assert.equal(refused.plan, input); assert.equal(fs.existsSync(path.join(root, "client")), false);
});
