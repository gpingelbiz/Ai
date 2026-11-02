import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { resolveIntro, introSpan, introCutout, introProxyFilter, prepareIntroAssets, renderIntro, INTRO_ANIMATIONS, INTRO_FACE_MAX_FRAMES } from '../src/speaker-intro.mjs';
import { resolvePlan, validatePlan, planUsage, timelineWords } from '../src/speaker-compile.mjs';
import { speakerCardsHTML, cardChecks, resolveCard } from '../src/speaker-cards.mjs';
import { speakerHTML, composeSpeakerProject } from '../src/speaker-compose.mjs';
import { usedAssets, rightsChecks } from '../src/speaker-qc.mjs';
import { reviewRows } from '../src/speaker-review.mjs';
import { activeBox, letterboxCards } from '../src/speaker-look.mjs';
import { resolveBrandTokens } from '../src/brandtokens.mjs';
import { run } from '../src/util.mjs';

const canvas = { width: 1920, height: 1080, fps: 30 };
const tokens = resolveBrandTokens({ brand: { name: 'Client', fonts: { display: 'Playfair Display', body: 'Montserrat' }, colors: { text: '#FFFFFF', bg: '#111111', accent: '#FFB27D' } } });
const manifest = { clientId: 'client', identity: { name: 'Julee Gracey', roleLine: 'Speaker', bookingMode: 'direct', bookingText: 'Book Julee', bookingUrl: 'https://example.com' }, sources: [
  { id: 'speech', path: 'speech.mp4', kind: 'stage', audio: 'ok', rights: 'r' },
  { id: 'window', path: 'window.mp4', kind: 'broll', audio: 'ok', rights: 'r' },
  { id: 'photo', path: 'photo.png', kind: 'photo', audio: 'none', rights: 'r' },
], proof: [{ id: 'book', text: 'Author of Highly Confident', sourceId: 'window', kind: 'book', rights: 'r' }, { id: 'portrait', kind: 'press', file: 'photo.png', rights: 'r' }], rights: [{ id: 'r', status: 'approved' }, { id: 'pending', status: 'pending' }], music: [] };
const index = { sources: { speech: { width: 1920, height: 1080, hasAudio: true, duration: 20, words: [{ text: 'We', start: 2.04, end: 2.1 }, { text: 'plan.', start: 2.3, end: 2.5 }] }, window: { width: 160, height: 90, duration: 2 }, photo: { width: 160, height: 240 } } };
const text = (extra = {}) => ({ id: 'name', kind: 'text', from: 0, to: 30, rect: { x: 144, y: 300, w: 1000, h: 150 }, identity: 'name', fontSize: 100, ...extra });
const image = (extra = {}) => ({ id: 'portrait', kind: 'image', from: 0, to: 30, rect: { x: 1200, y: 180, w: 400, h: 660 }, proofId: 'portrait', cutout: true, ...extra });
const video = (extra = {}) => ({ id: 'window', kind: 'video', from: 0, to: 30, rect: { x: 1100, y: 180, w: 480, h: 300 }, sourceId: 'window', in: 0.2, out: 1.2, ...extra });
const plan = (layers = [text()]) => ({ schemaVersion: 1, clientId: 'client', version: 'full', revision: 1, canvas, look: { grade: 'off' }, items: [
  { id: 'a', kind: 'clip', role: 'opening', sourceId: 'speech', in: 2, out: 3 },
  { id: 'b', kind: 'clip', role: 'opening', sourceId: 'window', in: 0, out: 1, audio: 'mute' },
  { id: 'c', kind: 'clip', role: 'opening', sourceId: 'photo', in: 0, out: 1, audio: 'mute' },
  { id: 'booking', kind: 'card', role: 'booking', duration: 6.6, card: { type: 'booking' } },
], overlays: [{ id: 'intro', at: 'a', spanTo: 'c', offset: 0, card: { type: 'intro', layers } }] });
const resolve = (p, m = manifest, idx = index, extra = {}) => resolveIntro(p.overlays[0].card, { manifest: m, index: idx, plan: p, entry: p.overlays[0], ...extra });
const errors = (result) => result.problems.filter((p) => p.level === 'error');
const png = (file, color = 128) => { const p = new PNG({ width: 4, height: 6 }); p.data.fill(color); fs.writeFileSync(file, PNG.sync.write(p)); };
const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speaker-intro-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const ffprobe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]));

function seekable(timeline) {
  const context = { setTimeout: () => 0, clearTimeout: () => {} }; vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../assets/vendor/gsap.min.js', import.meta.url), 'utf8'), context);
  const tl = context.window.gsap.timeline({ paused: true }), targets = new Map();
  const target = (s) => { if (!targets.has(s)) targets.set(s, { autoAlpha: s.includes('si-motion') ? 1 : 0, x: 0, y: 0, scale: 1, clipPath: 'inset(0 0 0 0)' }); return targets.get(s); };
  vm.runInNewContext(timeline, { tl: { set: (s, ...args) => tl.set(target(s), ...args), fromTo: (s, ...args) => tl.fromTo(target(s), ...args) } });
  return { tl, targets };
}

test('intro derives a half-open span across consecutive clip items without changing audio, words or runtime', () => {
  const p = plan(), r = resolvePlan(p, { manifest, index });
  assert.deepEqual(errors(resolve(p)), []);
  assert.deepEqual(introSpan(p.overlays[0], p), { startFrame: 0, endFrame: 90, frames: 90, start: 0, end: 3 });
  assert.equal(r.overlays[0].endFrame, 90); assert.equal(r.frames, 288);
  const plain = structuredClone(p); plain.overlays = [];
  const base = resolvePlan(plain, { manifest, index });
  assert.deepEqual(r.items, base.items); assert.deepEqual(timelineWords(r, index), timelineWords(base, index));
  p.overlays[0].at = 'b'; p.overlays[0].offset = 1 / 30;
  assert.equal(introSpan(p.overlays[0], p).frames, 59);
});

test('intro rejects backwards, missing, interrupted or mismatched spans and other cards retain single-item bounds', () => {
  const mutations = [p => p.overlays[0].spanTo = 'missing', p => { p.overlays[0].at = 'c'; p.overlays[0].spanTo = 'a'; }, p => p.items[1] = { id: 'b', kind: 'card', duration: 1, role: 'proof', card: { type: 'title' } }, p => p.overlays[0].duration = 2, p => p.overlays[0].offset = 1];
  for (const mutate of mutations) { const p = plan(); mutate(p); assert.ok(validatePlan(p, { manifest, index }).some(p => p.level === 'error')); }
  const p = plan(); p.overlays[0].card = { type: 'title' }; p.overlays[0].duration = 3;
  assert.ok(validatePlan(p, { manifest, index }).some(p => /spanTo requires|extends past/.test(p.message)));
  const insert = plan(); insert.items[3].card = insert.overlays[0].card; insert.overlays = [];
  assert.ok(validatePlan(insert, { manifest, index }).some(p => /must be an overlay/.test(p.message)));
});

test('intro text resolves exact identity, contiguous proof fragments and transcript word timestamps', () => {
  const p = plan([text(), text({ id: 'book', identity: undefined, proofId: 'book', words: { start: 2, end: 3 }, from: 30, to: 60 }), text({ id: 'quote', identity: undefined, itemId: 'a', sourceWordRange: { start: 0, end: 1 }, wordByWord: true, from: 1, to: 30 })]);
  const r = resolve(p); assert.deepEqual(errors(r), []);
  assert.equal(r.card.layers[1].text, 'Highly Confident');
  assert.deepEqual(r.card.layers[2].wordFrames, [1, 9]);
  const rendered = renderIntro(r.card, { id: 'intro', span: r.span, tokens });
  assert.match(rendered.html, /Julee/); assert.match(rendered.html, /Highly/);
  assert.match(rendered.timeline, /word-1.*0\.3\)/);
  const composed = resolvePlan(p, { manifest, index });
  const row = reviewRows(composed, manifest).find(r => r.id === 'intro');
  assert.equal(row.text, 'Julee Gracey · Highly Confident · We plan.');
  assert.deepEqual(row.introLayers[2].wordFrames, [1, 9]);
});

test('intro refuses invented copy, unsafe identity fields, shifted utterances and incomplete words', () => {
  const bad = [text({ text: 'World class' }), text({ identity: 'headshot' }), text({ identity: undefined, proofId: 'missing' }), text({ proofId: 'book' }), text({ wordByWord: true }), text({ identity: undefined, sourceWordRange: { start: 0, end: 99 }, itemId: 'a' }), text({ identity: undefined, sourceWordRange: { start: 0, end: 1 }, itemId: 'b' }), text({ identity: undefined, sourceWordRange: { start: 0, end: 1 }, itemId: 'a', from: 10 })];
  for (const l of bad) assert.ok(errors(resolve(plan([l]))).length, JSON.stringify(l));
  const p = plan([text({ identity: undefined, itemId: 'a', sourceWordRange: { start: 0, end: 1 } })]); p.items[0].in = 2.05;
  assert.ok(errors(resolve(p)).some(p => /complete word/.test(p.message)));
  assert.ok(resolveCard({ type: 'intro', layers: [text()] }, { manifest }).problems.some(p => /overlay/.test(p.message)));
  const idx = structuredClone(index); idx.sources.speech.words[0].text = 'We always';
  const multi = plan([text({ identity: undefined, itemId: 'a', sourceWordRange: { start: 0, end: 1 }, wordByWord: true })]);
  assert.ok(errors(resolve(multi, manifest, idx)).some(p => /one timestamped word/.test(p.message)));
});

test('intro validates integer frames, fixed animations, media ranges, rectangles and minimum text fit', () => {
  const cases = [text({ from: 0.1 }), text({ to: 91 }), text({ rect: { x: 10, y: 300, w: 1000, h: 200 } }), text({ fontSize: 20 }), text({ rect: { x: 144, y: 300, w: 50, h: 40 } }), text({ font: 'Comic Sans' }), text({ color: 'red' }), text({ accentWord: 12 }), text({ lineBreaks: {} }), text({ animations: [{ type: 'bounce', from: 0, to: 6 }] }), text({ animations: [{ type: 'rise', from: 0.1, to: 6 }] }), text({ animations: [{ type: 'wipe', from: 0, to: 31 }] }), text({ animations: [{ type: 'drift', from: 0, to: 6, dx: Infinity }] }), video({ out: 1 }), video({ sourceId: 'missing' }), image({ sourceId: 'window', proofId: undefined }), image({ crop: { x: 0.5, y: 0, w: 1, h: 1 } }), { ...text(), kind: 'shape', shape: 'noise' }];
  for (const l of cases) assert.ok(errors(resolve(plan([l]))).length, JSON.stringify(l));
  const p = plan([text()]); p.overlays[0].card.layers.push(text()); assert.ok(errors(resolve(p)).some(p => /unique/.test(p.message)));
  assert.doesNotThrow(() => resolve(plan([text({ animations: [null] })])));
});

test('intro checks moving bounds and active-picture margins for both letterboxes', () => {
  const slam = image({ rect: { x: 1200, y: 180, w: 400, h: 660 }, animations: [{ type: 'slam', from: 0, to: 6 }] });
  assert.deepEqual(errors(resolve(plan([slam]))), []);
  const p = plan([image({ ...slam, rect: { x: 1400, y: 100, w: 400, h: 800 } })]);
  assert.ok(errors(resolve(p)).some(p => /animated bounds/.test(p.message)));
  for (const ratio of [2.35, 2.39]) {
    const p = plan([text()]); p.look.letterbox = ratio;
    const rp = resolvePlan(p, { manifest, index });
    const cards = letterboxCards(speakerCardsHTML(rp, { manifest, index, tokens }), activeBox(ratio), rp);
    assert.match(cards.css, /speaker-intro-layer/);
    assert.match(cards.html, new RegExp(`top:${300 - activeBox(ratio).y}px`));
    p.overlays[0].card.layers[0].rect.y = 96;
    assert.ok(errors(resolve(p)).some(p => /safe margin/.test(p.message)));
  }
});

test('protected speaking faces use a six-frame threshold, conservative unknown fallback and explicit opt-in', () => {
  assert.equal(INTRO_FACE_MAX_FRAMES, 6);
  const p = plan([text({ to: 6 })]); p.items[0].protect = true;
  assert.deepEqual(errors(resolve(p)), []);
  p.overlays[0].card.layers[0].to = 7;
  assert.ok(errors(resolve(p)).some(p => /protected speaking face/.test(p.message)));
  p.items[0].faceRects = [{ x: 1300, y: 200, w: 100, h: 150 }];
  assert.deepEqual(errors(resolve(p)), []);
  p.items[0].faceRects = [{ x: 150, y: 300, w: 100, h: 100 }];
  assert.ok(errors(resolve(p)).length);
  p.overlays[0].card.layers[0].allowOverFace = true;
  assert.deepEqual(errors(resolve(p)), []);
  const moved = plan([image({ rect: { x: 1200, y: 180, w: 400, h: 660 }, animations: [{ type: 'slam', from: 0, to: 6 }] })]); moved.items[0].protect = true; moved.items[0].faceRects = [{ x: 1650, y: 400, w: 20, h: 20 }];
  assert.ok(errors(resolve(moved)).some(p => /protected speaking face/.test(p.message)));
});

test('nested image, video, proof and transcript references flow into compile and final rights checks', () => {
  const p = plan([text({ identity: undefined, proofId: 'book', fontSize: 60 }), image(), video(), text({ id: 'q', identity: undefined, itemId: 'a', sourceWordRange: { start: 0, end: 1 }, from: 1 })]);
  // Use assets not otherwise present in the base edit.
  const m = structuredClone(manifest); m.sources.push({ id: 'extra', kind: 'broll', path: 'extra.mp4', audio: 'none', rights: 'pending' }); m.proof[1].rights = 'pending'; m.proof[0].rights = 'pending'; m.proof[0].sourceId = 'extra';
  for (const usage of [planUsage(p, m), usedAssets(p, m)]) { assert.ok(usage.sourceIds.includes('extra')); assert.ok(usage.proofIds.includes('portrait')); assert.ok(usage.proofIds.includes('book')); }
  assert.ok(validatePlan(p, { manifest: m, index, draft: true }).some(p => p.level === 'warn' && /rights/.test(p.message)));
  assert.ok(validatePlan(p, { manifest: m, index }).some(p => p.level === 'error' && /rights/.test(p.message)));
  for (const id of ['extra', 'portrait', 'book']) assert.ok(rightsChecks(p, m, true).some(p => p.assetId === id && p.level === 'fail'));
  const rp = resolvePlan(p, { manifest: m, index, draft: true });
  assert.ok(cardChecks(rp, { manifest: m, index, final: true, tokens }).some(p => p.level === 'error' && /rights/.test(p.message)));
  const unrelated = structuredClone(manifest); unrelated.sources[1].rights = 'pending';
  const nameOnly = resolvePlan(plan(), { manifest: unrelated, index, draft: true });
  assert.equal(reviewRows(nameOnly, unrelated).find(r => r.id === 'intro').rights, 'approved');
});

test('intro text is plate-free and HTML uses one paused timeline with the original audio-bearing base', () => {
  const p = plan([text({ animations: [{ type: 'rise', from: 0, to: 6 }] })]), rp = resolvePlan(p, { manifest, index });
  const cards = speakerCardsHTML(rp, { manifest, tokens, index });
  assert.match(cards.css, /si-text\{background:none;padding:0/); assert.doesNotMatch(cards.html.slice(cards.html.indexOf('class="speaker-intro-layer')), /background:|sc-plate|sc-copy/);
  for (const field of ['plate', 'background', 'padding', 'html']) assert.ok(errors(resolve(plan([text({ [field]: 'black' })]))).length);
  const html = speakerHTML(rp, { manifest, cards });
  assert.equal((html.match(/gsap.timeline/g) || []).length, 1);
  assert.equal((html.match(/data-has-audio="true"/g) || []).length, 1);
  assert.doesNotMatch(html, /requestAnimationFrame|Math.random|Date\(|onComplete|currentTime|@keyframes/);
});

test('all fixed animations seek identically forwards and backwards at integer boundaries', () => {
  const layers = INTRO_ANIMATIONS.map((type, n) => text({ id: type, from: 10, to: 50, rect: { x: 250, y: 300, w: 1000, h: 150 }, animations: [{ type, from: 10, to: type === 'cut' ? 10 : 16 }, { type: 'fade', from: 44, to: 50, out: true }] }));
  const p = plan(layers), r = resolve(p); assert.deepEqual(errors(r), []);
  const rendered = renderIntro(r.card, { id: 'intro', span: r.span, tokens });
  const { tl, targets } = seekable(rendered.timeline), frames = [0, 9, 10, 11, 15, 16, 17, 43, 44, 49, 50, 51, 90];
  const state = () => JSON.stringify([...targets].map(([s, o]) => [s, o.autoAlpha, o.x, o.y, o.scale, o.clipPath]));
  const expected = new Map();
  for (const f of frames) { tl.seek(f / 30); expected.set(f, state()); }
  for (const f of [...frames].reverse()) { tl.seek(f / 30); assert.equal(state(), expected.get(f), `frame ${f}`); }
  tl.seek(16 / 30); assert.equal(targets.get('#intro-layer-1 > .si-motion').scale, 1);
  tl.seek(10 / 30); assert.equal(targets.get('#intro-layer-1 > .si-motion').scale, 1.08);
  tl.seek(50 / 30); for (const [selector, o] of targets) if (!selector.includes('si-motion')) assert.equal(o.autoAlpha, 0);
  assert.match(rendered.timeline, /power3.out/); assert.doesNotMatch(rendered.timeline, /bounce|elastic/);
});

test('word reveals use actual source timestamps through nonzero overlay starts and backwards seeks', () => {
  const p = plan([text({ identity: undefined, itemId: 'a', sourceWordRange: { start: 0, end: 1 }, wordByWord: true, from: 1, to: 30 })]);
  p.items.unshift({ ...p.items[1], id: 'lead' });
  const r = resolve(p), rendered = renderIntro(r.card, { id: 'intro', span: r.span, tokens });
  const { tl, targets } = seekable(rendered.timeline);
  for (const [f, first, second] of [[30, 0, 0], [31, 1, 0], [38, 1, 0], [39, 1, 1], [38, 1, 0], [30, 0, 0]]) {
    tl.seek(f / 30); assert.equal(targets.get('#intro-layer-0-word-0').autoAlpha, first); assert.equal(targets.get('#intro-layer-0-word-1').autoAlpha, second);
  }
});

test('cutout caches full source content, reuses an injected segmenter once, and leaves originals intact', async (t) => {
  const dir = temp(t), source = path.join(dir, 'portrait.png'); png(source);
  const original = fs.readFileSync(source); let calls = 0;
  const segmenter = async (source, output) => { calls++; png(output, 64); };
  const cache = path.join(dir, 'cache'), a = await introCutout(source, cache, { segmenter }), b = await introCutout(source, cache, { segmenter });
  assert.equal(a.file, b.file); assert.equal(calls, 1); assert.equal(a.cutout, true); assert.deepEqual(fs.readFileSync(source), original);
  png(source, 129); const c = await introCutout(source, cache, { segmenter }); assert.notEqual(c.key, a.key); assert.equal(calls, 2);
});

test('segmentation failure, unavailable helper and invalid output fail open with a warning and can retry', async (t) => {
  const dir = temp(t), source = path.join(dir, 'portrait.png'); png(source); const cache = path.join(dir, 'cache'), messages = [];
  for (const segmenter of [async () => { throw new Error('Vision unavailable'); }, async (_, out) => fs.writeFileSync(out, 'bad PNG')]) {
    const result = await introCutout(source, cache, { segmenter, print: s => messages.push(s) }); assert.equal(result.file, source); assert.equal(result.cutout, false);
  }
  assert.equal(messages.length, 2); assert.match(messages[0], /original rectangular photo/);
  assert.equal((await introCutout(source, cache, { segmenter: async (_, out) => png(out) })).cutout, true);
  assert.deepEqual(fs.readdirSync(cache).filter(f => f.startsWith('.person-')), []);
});

test('missing files, unsafe relative assets and invalid registry image kinds are rejected before preparation', (t) => {
  const dir = temp(t);
  assert.ok(errors(resolve(plan([image()]), manifest, index, { clientDir: dir })).some(p => /missing or unsafe asset/.test(p.message)));
  const m = structuredClone(manifest); m.proof[1].file = '../escape.png';
  assert.ok(errors(resolve(plan([image()]), m, index, { clientDir: dir })).some(p => /unsafe/.test(p.message)));
  m.proof[1].file = 'movie.mp4'; assert.ok(errors(resolve(plan([image()]), m)).some(p => /proof image/.test(p.message)));
});

test('lavfi video proxy is pretrimmed to exact source frames, silent, 30fps and content cached', async (t) => {
  const dir = temp(t), input = path.join(dir, 'window.mp4'), projectDir = path.join(dir, 'project');
  ff('-f', 'lavfi', '-i', 'nullsrc=s=160x90:r=30:d=2,geq=lum=32+N*2:cb=128:cr=128', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-crf', '0', '-c:a', 'aac', '-shortest', input);
  const p = plan([video({ from: 4, to: 19, in: 0.4, out: 0.9 })]);
  let encodes = 0;
  const runImpl = async (...args) => { encodes++; return run(...args); };
  const a = await prepareIntroAssets(p, { manifest, index, clientDir: dir, projectDir, runImpl });
  const proxy = a.prepared.intro.window, file = path.join(projectDir, proxy.file), streams = ffprobe(file).streams, v = streams.find(s => s.codec_type === 'video');
  assert.equal(streams.length, 1); assert.equal(v.avg_frame_rate, '30/1'); assert.equal(Number(v.nb_frames), 15); assert.equal(Number(v.duration), 0.5); assert.equal(v.color_space, 'bt709');
  const y = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'extractplanes=y,crop=1:1', '-f', 'rawvideo', '-']);
  const raw = Array.from({ length: 15 }, (_, i) => y[i]);
  const sourceY = execFileSync('ffmpeg', ['-v', 'error', '-i', input, '-vf', 'trim=start_frame=12:end_frame=27,setpts=PTS-STARTPTS,extractplanes=y,crop=1:1', '-f', 'rawvideo', '-']);
  const expected = Array.from({ length: 15 }, (_, i) => sourceY[i]);
  assert.equal(raw.length, 15); assert.equal(expected.length, 15);
  const max = Math.max(...raw.map((v, i) => Math.abs(v - expected[i]))); assert.ok(max <= 2, `max error ${max}; raw ${[...raw]}; expected ${[...expected]}`);
  const b = await prepareIntroAssets(p, { manifest, index, clientDir: dir, projectDir, runImpl }); assert.equal(b.prepared.intro.window.file, proxy.file); assert.equal(encodes, 1);
  const resolved = resolve(p), rendered = renderIntro(resolved.card, { id: 'intro', span: resolved.span, tokens, assets: a.prepared.intro });
  assert.match(rendered.html, /muted playsinline/); assert.match(rendered.html, /data-media-start="0"/); assert.match(rendered.html, /data-start="0.13333333333333333"/); assert.match(rendered.html, /data-has-audio="false"/);
  assert.equal(rendered.layers[0].firstFrame, 4); assert.equal(rendered.layers[0].lastFrame, 18);
  t.diagnostic(`proxy: 15/15 frames; source frames 12–26; duration ${v.duration}s; audio streams 0; max gray error ${max}; encode calls ${encodes}`);
});

test('lavfi proxy applies upright rotation before normalized cropping, with exact dimensions and silent output', async (t) => {
  const dir = temp(t), input = path.join(dir, 'window.mp4'), projectDir = path.join(dir, 'project');
  ff('-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=1', '-c:v', 'libx264', input);
  const idx = structuredClone(index); idx.sources.window = { ...idx.sources.window, width: 90, height: 160, rotationCw: 90 };
  const l = video({ from: 0, to: 9, in: 0, out: 0.3, rect: { x: 1100, y: 180, w: 240, h: 240 }, crop: { x: 0, y: 0.25, w: 1, h: 0.5 } });
  const a = await prepareIntroAssets(plan([l]), { manifest, index: idx, clientDir: dir, projectDir });
  const asset = a.prepared.intro.window, v = ffprobe(path.join(projectDir, asset.file)).streams[0];
  assert.match(asset.filter, /transpose=clock.*crop=90:80:0:40/); assert.equal(v.width, 240); assert.equal(v.height, 214); assert.equal(Number(v.nb_frames), 9);
  assert.ok(introProxyFilter(l, idx.sources.window, { preFilter: 'transpose=clock' }).includes('trim=end_frame=9'));
  t.diagnostic(`upright proxy: crop 90x80 at 0,40; 240x214; ${v.nb_frames} frames at ${v.avg_frame_rate}; audio streams 0`);
});

test('two cropped photo windows share one normalized asset, preserve aspect ratio and record cutout fallback', async (t) => {
  const dir = temp(t), original = path.join(dir, 'photo.png'), projectDir = path.join(dir, 'project'); png(original);
  let normalizeCalls = 0, segments = 0;
  const normalizeStill = async (src, out) => { normalizeCalls++; fs.copyFileSync(src, out); };
  const p = plan([image({ cutout: false }), image({ id: 'detail', cutout: false, crop: { x: 0, y: 0.25, w: 1, h: 0.5 } })]);
  const a = await prepareIntroAssets(p, { manifest, index, clientDir: dir, projectDir, normalizeStill });
  assert.equal(normalizeCalls, 1); assert.equal(a.prepared.intro.portrait.file, a.prepared.intro.detail.file);
  const r = resolve(p), rendered = renderIntro(r.card, { id: 'intro', span: r.span, tokens, assets: a.prepared.intro });
  assert.match(rendered.html, /viewBox="0 1.5 4 3"/); assert.match(rendered.html, /width="4" height="6"/);
  const c = await prepareIntroAssets(plan([image()]), { manifest, index, clientDir: dir, projectDir, normalizeStill, segmenter: async () => { segments++; throw new Error('no matte'); }, print: () => {} });
  assert.equal(c.prepared.intro.portrait.cutout, false); assert.equal(c.warnings.length, 1); assert.equal(segments, 1); assert.equal(normalizeCalls, 1);
});

test('shape fields, gradient scrims and rules use brand tokens and retain independent authored opacity', () => {
  const p = plan(['field', 'scrim', 'rule'].map((shape, i) => ({ id: shape, kind: 'shape', shape, from: 0, to: 30, rect: { x: 144, y: 200 + i * 200, w: 500, h: shape === 'rule' ? 3 : 100 }, color: 'accent', opacity: 0.14, animations: [{ type: 'fade', from: 0, to: 6 }] })));
  const r = resolve(p); assert.deepEqual(errors(r), []);
  const rendered = renderIntro(r.card, { id: 'intro', span: r.span, tokens });
  assert.match(rendered.html, /linear-gradient\(to right,#FFB27D,transparent\)/); assert.equal((rendered.html.match(/opacity:0.14/g) || []).length, 3);
});

test('composition prepares intro assets once, keeps one base audio path and persists review evidence and warnings', async (t) => {
  const dir = temp(t), work = path.join(dir, 'work/full'); fs.mkdirSync(path.join(dir, 'work/index'), { recursive: true }); fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'base.mp4'), 'base-video'); fs.writeFileSync(path.join(work, 'words.json'), '[]'); fs.writeFileSync(path.join(dir, 'work/index/sources.json'), JSON.stringify(index)); png(path.join(dir, 'photo.png'));
  const p = resolvePlan(plan([image()]), { manifest, index }); let prepares = 0;
  const result = await composeSpeakerProject(work, p, { manifest, tokens, print: () => {}, prepareIntro: async (rp, options) => {
    prepares++; assert.equal(rp.overlays[0].startFrame, 0); assert.deepEqual(options.index, index);
    return { prepared: { intro: { portrait: { file: 'assets/portrait.png', width: 160, height: 240, cutout: false, warning: 'rectangular fallback', sourceHash: 'test-hash', original: 'photo.png' } } }, warnings: ['rectangular fallback'] };
  } });
  assert.equal(prepares, 1); const html = fs.readFileSync(result.html, 'utf8'); assert.equal((html.match(/data-has-audio="true"/g) || []).length, 1);
  assert.equal((html.match(/<audio/g) || []).length, 0); assert.match(html, /assets\/portrait.png/);
  const saved = JSON.parse(fs.readFileSync(path.join(work, 'plan.resolved.json'))), comp = JSON.parse(fs.readFileSync(path.join(work, 'composition.json')));
  assert.equal(saved.overlays[0].introReview[0].firstFrame, 0); assert.equal(saved.overlays[0].introReview[0].lastFrame, 29); assert.equal(saved.overlays[0].introReview[0].cutout, false);
  assert.ok(comp.warnings.some(w => w.id === 'intro' && /fallback/.test(w.message)));
  const row = reviewRows(saved, manifest).find(r => r.id === 'intro'); assert.equal(row.introLayers[0].sourceHash, 'test-hash');
});

test('intro proxy reuses existing grade/HDR handling and records PQ and HLG fallback warnings', async (t) => {
  const dir = temp(t), source = path.join(dir, 'window.mp4'); fs.writeFileSync(source, 'original source');
  const p = plan([video()]); p.look = { grade: 'auto', hlg: 'review', sources: { window: { ev: 0.2 } } };
  const idx = structuredClone(index); idx.sources.window = { ...idx.sources.window, hdr: true, hdrKind: 'hlg' };
  let gradeArgs, encodeArgs;
  const deps = { manifest, index: idx, clientDir: dir, projectDir: path.join(dir, 'project'), print: () => {}, zscaleImpl: async () => false,
    gradeImpl: async (file, args) => { gradeArgs = args; return { filter: 'eq=brightness=0.01' }; },
    runImpl: async (cmd, args) => { encodeArgs = args; fs.writeFileSync(args.at(-1), 'proxy'); }, probeImpl: async () => ({ hasAudio: false, duration: 1 }), toneMapImpl: async () => false };
  const hlg = await prepareIntroAssets(p, deps);
  assert.ok(hlg.warnings.some(w => /zscale unavailable/.test(w))); assert.match(gradeArgs.preFilter, /iall=bt2020/); assert.deepEqual(gradeArgs.overrides, { ev: 0.2 }); assert.deepEqual(gradeArgs.ranges, [{ in: 0.2, out: 1.2 }]); assert.match(hlg.prepared.intro.window.filter, /eq=brightness=0.01/); assert.ok(encodeArgs.includes('-an'));
  idx.sources.window.hdrKind = 'pq';
  const pq = await prepareIntroAssets(p, { ...deps, projectDir: path.join(dir, 'pq-project') }); assert.ok(pq.warnings.some(w => /PQ tone mapping unavailable/.test(w)));
  const mapped = await prepareIntroAssets(p, { ...deps, projectDir: path.join(dir, 'mapped-project'), toneMapImpl: async (src, out, meta) => { assert.equal(meta.hasAudio, false); fs.copyFileSync(src, out); return true; } });
  assert.equal(mapped.warnings.length, 0); assert.doesNotMatch(mapped.prepared.intro.window.filter, /iall=bt2020/);
});

test('corrupt cutout cache entries rebuild and an invalid generated matte still fails open', async (t) => {
  const dir = temp(t), src = path.join(dir, 'photo.png'), cache = path.join(dir, 'cache'); png(src); let calls = 0;
  const segmenter = async (_, out) => { calls++; png(out); };
  const a = await introCutout(src, cache, { segmenter }); fs.writeFileSync(a.file, 'corrupt');
  const b = await introCutout(src, cache, { segmenter }); assert.equal(calls, 2); assert.equal(b.cutout, true);
});

test('example plan retains d14 frames 101/173/221/273 and the op4 portrait drop at 413 without client writes', () => {
  const p = JSON.parse(fs.readFileSync(new URL('../docs/examples/speaker-intro.json', import.meta.url)));
  const launch = introSpan(p.overlays.find(o => o.id === 'book-launch'), p), hero = introSpan(p.overlays.find(o => o.id === 'hero-drop'), p);
  assert.deepEqual([launch.startFrame, launch.endFrame, hero.startFrame, hero.endFrame], [101, 273, 413, 485]);
  const windows = p.overlays[1].card.layers.filter(l => l.kind === 'image' || l.kind === 'video').map(l => [l.id, launch.startFrame + l.from, launch.startFrame + l.to]);
  assert.deepEqual(windows, [['billboard',101,173],['book-photo',173,221],['detail',181,221],['signing',221,273]]);
  assert.equal(p.overlays[2].card.layers[0].proofId, 'sarahmariephotographycopyright-8');
});

test('repeated animation properties, face observations outside the frame and leaked identity cannot bypass validation', () => {
  assert.ok(errors(resolve(plan([text({ animations: [{ type: 'rise', from: 0, to: 6 }, { type: 'fade', from: 8, to: 12 }] })]))).some(p => /repeat opacity/.test(p.message)));
  const p = plan(); p.items[0].protect = true; p.items[0].faceRects = [{ x: 5000, y: 5000, w: 50, h: 50 }]; assert.ok(errors(resolve(p)).some(p => /protected speaking face/.test(p.message)));
  const m = structuredClone(manifest); m.identity.name = 'Greg Pingel'; assert.ok(errors(resolve(plan(), m)).some(p => /Greg/.test(p.message)));
});

test("intro sourceWordRange defers to composition when the index has no words (plan-only probe index)", async () => {
  const { resolveIntro } = await import("../src/speaker-intro.mjs");
  const plan = { canvas: { width: 1920, height: 1080, fps: 30 }, look: { letterbox: null },
    items: [{ id: "a", kind: "clip", sourceId: "s", in: 0, out: 4, audio: "source" }],
    overlays: [{ id: "o", at: "a", offset: 0, duration: 3, card: { type: "intro", layers: [{ id: "q", kind: "text", from: 1, to: 80, rect: { x: 144, y: 300, w: 1100, h: 300 }, itemId: "a", sourceWordRange: { start: 0, end: 1 }, fontSize: 112, wordByWord: true, allowOverFace: true }] } }] };
  const manifest = { sources: [{ id: "s", kind: "stage", audio: "ok" }] };
  const out = resolveIntro(plan.overlays[0].card, { plan, entry: plan.overlays[0], manifest, index: { sources: { s: { width: 1920, height: 1080 } } }, mode: "overlay" });
  const problems = out.problems || [];
  assert.ok(!problems.some((p) => p.level === "error" && /sourceWordRange|evidence|lineBreaks|accentWord|fit at the minimum/.test(p.message)), JSON.stringify(problems));
  assert.ok(problems.some((p) => p.level === "warn" && /checked against indexed words/.test(p.message)));
});

test("intro bleed lets shape/image/video layers fill the active picture but never text", async () => {
  const { resolveIntro } = await import("../src/speaker-intro.mjs");
  const plan = { canvas: { width: 1920, height: 1080, fps: 30 }, look: { letterbox: null }, items: [{ id: "a", kind: "clip", sourceId: "s", in: 0, out: 4, audio: "source" }] };
  const entry = { id: "o", at: "a", offset: 0, duration: 3 };
  const run = (layer) => resolveIntro({ type: "intro", layers: [layer] }, { plan, entry, manifest: { sources: [{ id: "s", kind: "stage", audio: "ok" }] }, index: {}, mode: "overlay" }).problems || [];
  const scrim = { id: "scrim", kind: "shape", shape: "scrim", color: "surface", from: 0, to: 60, rect: { x: 0, y: 0, w: 1920, h: 1080 }, allowOverFace: true };
  assert.ok(run(scrim).some((p) => /safe margin/.test(p.message)), "full-frame shape needs bleed");
  assert.ok(!run({ ...scrim, bleed: true }).some((p) => /safe margin|outside the active picture|bleed/.test(p.message)));
  assert.ok(run({ id: "t", kind: "text", identity: "name", from: 0, to: 60, rect: { x: 0, y: 0, w: 1920, h: 200 }, bleed: true }).some((p) => /bleed must be boolean on a shape, image or video/.test(p.message)));
});

test("intro proof text can show one field of the proof's supplied attribution, never invented copy", () => {
  const m = structuredClone(manifest);
  m.proof.push({ id: 'organizer', kind: 'quote', text: 'Julee is a storyteller.', attribution: { name: 'Dolores Hirschmann', title: 'TEDx Organizer, Speaker Strategist', org: '' }, rights: 'r' });
  const quote = (extra) => text({ identity: undefined, proofId: 'organizer', fontSize: 64, ...extra });
  const p = plan([quote({ id: 'q' }), quote({ id: 'who', proofField: 'name', from: 30, to: 60 }), quote({ id: 'role', proofField: 'title', font: 'body', fontSize: 40, rect: { x: 144, y: 500, w: 1200, h: 80 }, from: 30, to: 60 })]);
  const r = resolve(p, m); assert.deepEqual(errors(r), []);
  assert.deepEqual(r.card.layers.map((l) => l.text), ['Julee is a storyteller.', 'Dolores Hirschmann', 'TEDx Organizer, Speaker Strategist']);
  assert.equal(r.card.layers[1].proofField, 'name');
  for (const bad of [{ proofField: 'quote' }, { proofField: 'org' }, { proofId: undefined, identity: 'name', proofField: 'name' }]) {
    assert.ok(errors(resolve(plan([quote({ id: 'x', ...bad })]), m)).length, JSON.stringify(bad));
  }
});
