import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { depthHookSpot, prepareDepthHook, GLOW_DEPTH_JS } from "../src/glow-depth.mjs";
import { glowLightRuntime, holdGlowFeatures, GLOW_LIGHT_JS } from "../src/glow-light.mjs";
import { restyleGlow, glowPrompt } from "../src/glow.mjs";
import { composeProject, renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";

const detection = (start = 0, y = 0.24) => ({ frames: [0.05, 1, 2, 2.95].map((t) => ({ t: start + t, faces: [{ x: 0.32, y, w: 0.36, h: 0.26 }] })) });
const emptyPicks = { features: [], icons: [], scenes: [], overlays: [] };
const words = "Listening wins every time".split(" ").map((text, i) => ({ text, start: 4 + i * 0.4, end: 4.3 + i * 0.4 }));

function fixture() {
  return {
    name: "depth-fixture", preset: "pingel-brand", canvas: { width: 1080, height: 1920 },
    style: loadPreset("pingel-brand"), video: { src: "/missing/clean.mp4", duration: 10, width: 1080, height: 1920, fps: 30 },
    hook: { text: "LISTEN FIRST", start: 0, duration: 3 }, words,
    captions: [], icons: [], graphics: [], slams: [], broll: [], zooms: [], audio: { tracks: [] },
  };
}

function files(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "glow-depth-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const video = path.join(root, "clean.mp4"), matte = path.join(root, "person.webm");
  fs.writeFileSync(video, "fake clean footage");
  fs.writeFileSync(matte, "fake alpha clip");
  return { root, video, matte };
}

function runtime(html) {
  return JSON.parse(html.match(/const PLAN = (\{[^\n]+\});/)[1]);
}

test("depth title tucks only an edge behind the measured head and stays in the upper safe frame", () => {
  for (const text of ["LISTEN FIRST", "7", "DO IT", "THE WRONG SCOREBOARD"]) {
    const hook = { text, start: 0, duration: 3 };
    const d = detection(0, 0.32);
    const place = depthHookSpot(hook, d);
    assert.equal(place.depth, true, text);
    assert.ok(place.size >= 0.045 * 1920);
    assert.ok(place.y >= 0.07 * 1920);
    assert.ok(place.x + place.w <= 0.86 * 1080);
    const head = (0.32 - 0.15 * 0.26) * 1920;
    assert.ok(place.bottom > head);
    assert.ok(place.bottom - head <= place.size * 0.31);
    assert.ok(place.bottom < 0.5 * 1920);
  }
});

test("depth placement rejects missing faces, insufficient headroom, large motion and long titles", () => {
  const hook = fixture().hook;
  assert.equal(depthHookSpot(hook, null), null);
  assert.equal(depthHookSpot(hook, detection(0, 0.08)), null);
  assert.equal(depthHookSpot({ ...hook, text: "A".repeat(90) }, detection()), null);
  const moving = detection();
  moving.frames[2].faces[0].y += 0.12;
  assert.equal(depthHookSpot(hook, moving), null);
});

test("depth measures the actual hook window, including body measurements for hair", () => {
  const hook = { ...fixture().hook, start: 5 };
  assert.equal(depthHookSpot(hook, detection()), null);
  const d = detection(5, 0.32);
  d.frames.forEach((frame) => { frame.bodies = [{ x: 0.2, y: 0.26, w: 0.6, h: 0.7 }]; });
  const place = depthHookSpot(hook, d);
  assert.ok(place.bottom >= 0.26 * 1920);
  assert.ok(place.bottom - 0.26 * 1920 < place.size * 0.31);
});

test("depth reuses a full hook cutout and puts the person above the title", async (t) => {
  const { matte } = files(t);
  const plan = fixture();
  plan.behind = { file: matte, start: 0, duration: 3, under: true };
  const out = await prepareDepthHook(plan, detection(), { cutout: () => { throw new Error("must reuse"); } });
  assert.equal(out.behind.file, matte);
  assert.equal(out.behind.under, false);
});

test("depth makes a clean-footage cutout with hook timing, output folder and render fps", async (t) => {
  const { root, video, matte } = files(t);
  const plan = fixture();
  plan.video.src = video;
  plan.style.render.fps = 24;
  plan.behind = { file: matte, start: 1, duration: 3 };
  let args;
  const out = await prepareDepthHook(plan, detection(), { outDir: root, cutout: async (input) => {
    args = input;
    return { src: matte, start: input.start, duration: input.duration, coverage: 0.3 };
  } });
  assert.deepEqual(args, { video, start: 0, duration: 3, fps: 24, outDir: root, name: "glow-hook" });
  assert.equal(out.behind.file, matte);
});

test("depth never reuses truncated, shifted or missing cutout files", async (t) => {
  const { matte } = files(t);
  for (const behind of [
    { file: matte, start: 0, duration: 2.9 },
    { file: matte, start: 0.1, duration: 3 },
    { file: "/missing/person.webm", start: 0, duration: 3 },
  ]) {
    const plan = fixture();
    plan.behind = behind;
    assert.equal(await prepareDepthHook(plan, detection()), null);
  }
});

test("depth returns a safe fallback when segmentation is unavailable, throws or returns a short clip", async (t) => {
  const { root, video, matte } = files(t);
  for (const cutout of [
    async () => ({ error: "Swift unavailable" }),
    async () => { throw new Error("matte failed"); },
    async () => ({ src: matte, start: 0, duration: 2.8 }),
    async () => ({ src: "/missing/person.webm", start: 0, duration: 3 }),
  ]) {
    const plan = fixture();
    plan.video.src = video;
    assert.equal(await prepareDepthHook(plan, detection(), { outDir: root, cutout }), null);
  }
});

test("depth opt-out and absent hooks do not invoke the cutout tool", async (t) => {
  const { root, video } = files(t);
  const plan = fixture();
  plan.video.src = video;
  let calls = 0;
  const options = { outDir: root, cutout: () => { calls++; return { error: "must not run" }; } };
  plan.style.glow.depthHook = false;
  assert.equal(await prepareDepthHook(plan, detection(), options), null);
  plan.style.glow.depthHook = true;
  plan.hook = null;
  assert.equal(await prepareDepthHook(plan, detection(), options), null);
  assert.equal(calls, 0);
});

test("restyle builds and composes the depth title with a mocked cutout and face finder", async (t) => {
  const { root, video, matte } = files(t);
  const plan = fixture();
  plan.video.src = video;
  const options = { render: "/fake/render.mp4", outDir: root, library: [], picks: emptyPicks,
    detect: async () => detection(), cutout: async () => ({ src: matte, start: 0, duration: 3, coverage: 0.3 }),
    ask: () => assert.fail("saved picks must not call Claude"),
  };
  await restyleGlow(plan, options);
  assert.equal(plan.hook.place.depth, true);
  const place = structuredClone(plan.hook.place);
  await restyleGlow(plan, { ...options, cutout: () => assert.fail("reuse") });
  assert.deepEqual(plan.hook.place, place);
  const project = path.join(root, "project");
  composeProject(plan, project);
  const html = fs.readFileSync(path.join(project, "index.html"), "utf8");
  assert.match(html, /hook-glow-depth/);
  assert.match(html, new RegExp(`top: ${place.y}px; width: ${place.w}px; font-size: ${place.size}px`));
  assert.ok(html.indexOf('id="cutout-wrap"') > html.indexOf('id="hook"'));
  assert.match(html, /id="cutout"[^>]+data-start="0" data-duration="3"/);
  assert.doesNotMatch(html, /#cutout-wrap \{ z-index: 1/);
  assert.ok(fs.existsSync(path.join(project, "assets/cutout.webm")));
  const rt = runtime(html);
  assert.equal(rt.glowDepth.bottom, place.bottom);
  assert.deepEqual(rt.cutoutMedia, ["#cutout"]);
  assert.equal(rt.hook.headTop, undefined);
  new vm.Script(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
});

test("restyle falls back to hookSpot and clears an old matte and head guard on failure", async (t) => {
  const { root, video, matte } = files(t);
  const plan = fixture();
  plan.video.src = video;
  plan.hook.headTop = 0.2;
  plan.behind = { file: matte, start: 0, duration: 1 };
  await restyleGlow(plan, { render: "fake", outDir: root, picks: emptyPicks, detect: async () => detection(), cutout: async () => ({ error: "unavailable" }) });
  assert.equal(plan.hook.place.depth, undefined);
  assert.equal(plan.hook.place.y, Math.round((0.5 + 0.02) * 1920));
  assert.equal(plan.behind, null);
  assert.equal(plan.hook.headTop, undefined);
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.doesNotMatch(html, /id="cutout-wrap"|hook-t-headline hook-glow hook-glow-depth/);
});

test("a matte that goes missing after restyle uses the stored safe placement at composition time", async (t) => {
  const { root, video, matte } = files(t);
  const plan = fixture();
  plan.video.src = video;
  plan.behind = { file: matte, start: 0, duration: 3 };
  await restyleGlow(plan, { render: "fake", picks: emptyPicks, detect: async () => detection() });
  const fallback = plan.hook.place.fallback;
  fs.rmSync(matte);
  const project = path.join(root, "project");
  composeProject(plan, project);
  const html = fs.readFileSync(path.join(project, "index.html"), "utf8");
  assert.match(html, new RegExp(`top: ${fallback.y}px; width: ${fallback.w}px; font-size: ${fallback.size}px`));
  assert.equal(runtime(html).glowDepth, undefined);
  assert.doesNotMatch(html, /id="cutout-wrap"|hook-t-headline hook-glow hook-glow-depth/);
});

test("restyle does not generate a depth cutout for a wide reel or a different preset", async (t) => {
  const { root, video } = files(t);
  let calls = 0;
  for (const change of [{ preset: "clean" }, { canvas: { width: 1920, height: 1080 } }]) {
    const plan = Object.assign(fixture(), change);
    plan.video.src = video;
    await restyleGlow(plan, { render: "fake", outDir: root, picks: emptyPicks, detect: async () => detection(), cutout: () => { calls++; return { error: "must not run" }; } });
    assert.equal(plan.hook.place.depth, undefined);
  }
  assert.equal(calls, 0);
});

test("a feature reserves the full light sweep after the final spoken word builds", async () => {
  const plan = fixture();
  await restyleGlow(plan, { picks: { ...emptyPicks, features: [{ from: 0, to: 1, key: 1 }] } });
  const feat = plan.captions.find((g) => g.kind === "feat");
  const light = glowLightRuntime(plan).find((s) => s.selector.startsWith("#cap-"));
  assert.equal(light.start, words[1].start - 0.03 + 0.18);
  assert.equal(light.duration, 0.6);
  assert.ok(feat.end - 0.16 >= light.start + light.duration - 1e-9);
});

test("a crowded feature keeps its line and timing but gets no sweep rather than clipping it or overlapping a scene", () => {
  const plan = fixture();
  plan.captions = [{ kind: "feat", start: 3.95, end: 5, words: words.slice(0, 2), place: {} }];
  plan.glowScenes = [{ start: 4.9, end: 6 }];
  holdGlowFeatures(plan);
  assert.deepEqual(plan.captions.map((g) => [g.kind, g.end, g.sweep]), [["feat", 5, false]]);
  assert.equal(glowLightRuntime(plan).length, 1, "only the hook keeps its sweep");
});

test("the extended feature hold still clears the face throughout its sweep", async () => {
  const plan = fixture();
  const d = { frames: [{ t: 4.4, faces: [{ x: 0.3, y: 0.2, w: 0.3, h: 0.25 }] }, { t: 5.25, faces: [{ x: 0.3, y: 0.4, w: 0.3, h: 0.35 }] }] };
  await restyleGlow(plan, { render: "fake", picks: { ...emptyPicks, features: [{ from: 0, to: 1, key: 1 }] }, detect: async () => d });
  // Either the line was too low to show at all (subtitles) or it keeps its own short hold without a sweep.
  assert.ok(plan.captions.every((g) => g.kind === "sub" || g.sweep === false));
});

test("gold light markup and runtime target only the hook and feature lines, once for 0.6 seconds", async () => {
  const plan = fixture();
  await restyleGlow(plan, { picks: { ...emptyPicks, features: [{ from: 0, to: 1, key: 1 }] } });
  const html = renderHTML(plan, "assets/footage.mp4");
  const rt = runtime(html);
  assert.equal(rt.glowLights.length, 2);
  assert.ok(rt.glowLights.every((s) => s.duration === 0.6));
  assert.equal(rt.glowLights[0].selector, "#hook-lines .hw");
  assert.match(html, /class="glow-light" aria-hidden="true"/);
  assert.match(html, /background-clip: text/);
  const subtitles = html.match(/<div class="cap cap-sub"[^\n]+/g);
  assert.ok(subtitles.length);
  assert.ok(subtitles.every((line) => !line.includes('class="glow-light"')));
});

test("light runtime emits one seekable gradient pass per glyph with no repeat", () => {
  const calls = [];
  const lights = [{ style: {} }, { style: {} }];
  const words = lights.map((light, i) => ({ querySelector: () => light, getBoundingClientRect: () => ({ left: 100 + i * 120, right: 200 + i * 120 }) }));
  vm.runInNewContext(GLOW_LIGHT_JS, {
    PLAN: { width: 1080, glowLights: [{ selector: "#hook-lines .hw", start: 0.4, duration: 0.6 }] },
    document: { querySelectorAll: () => words, getElementById: () => ({ getBoundingClientRect: () => ({ width: 540 }) }) },
    tl: { set: (...args) => calls.push(["set", ...args]), fromTo: (...args) => calls.push(["fromTo", ...args]) },
  });
  const moves = calls.filter((c) => c[0] === "fromTo");
  assert.equal(moves.length, 2);
  assert.ok(moves.every((c) => c[3].duration === 0.6 && c[3].repeat === undefined && c[4] === 0.4));
  assert.notEqual(moves[0][2].backgroundPositionX, moves[1][2].backgroundPositionX);
  assert.ok(calls.filter((c) => c[0] === "set" && c[2].opacity === 0).every((c) => c[3] === 1));
  assert.equal(lights[0].style.backgroundSize, "1320px 100%");
});

test("depth runtime aligns the real block height to the planned lower edge", () => {
  const block = { style: {} };
  vm.runInNewContext(GLOW_DEPTH_JS, {
    PLAN: { height: 1920, glowDepth: { bottom: 500, size: 100 } },
    document: { getElementById: (id) => id === "hook-block" ? block : { getBoundingClientRect: () => id === "root" ? { height: 960 } : { height: 80 } } },
  });
  assert.equal(block.style.top, "340px");
});

test("depth runtime shrinks an unexpectedly wide font and keeps the overlap shallow", () => {
  const wrap = { style: {} };
  const line = {
    get scrollWidth() { return (Number.parseFloat(wrap.style.fontSize) || 100) * 10; },
    clientWidth: 900,
    getBoundingClientRect: () => ({ height: 90 }),
  };
  vm.runInNewContext(GLOW_DEPTH_JS, {
    PLAN: { height: 1920, glowDepth: { bottom: 500, size: 100 } },
    document: { getElementById: (id) => id === "hook-block" ? wrap : id === "hook-lines" ? line : { getBoundingClientRect: () => ({ height: 1920 }) } },
  });
  assert.equal(wrap.style.fontSize, "90px");
  assert.equal(wrap.style.top, "407px");
});

test("non-glow compositions contain no light or depth runtime, even with stale glow metadata", () => {
  const plan = fixture();
  plan.hook.place = { depth: true, x: 76, y: 200, w: 853, size: 144, bottom: 344 };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.doesNotMatch(html, /glow-light|glowLights|glowDepth|hook-glow-depth/);
});

test("Claude leaves depth and the gold sweep to the deterministic layout", () => {
  const prompt = glowPrompt(words, [], { duration: 10 });
  assert.match(prompt, /title's depth and a soft gold light sweep .* are automatic; never pick them or add text for them/);
  assert.equal(loadPreset("pingel-brand").glow.depthHook, true);
});

test("a long title reaches the large depth size on three lines", () => {
  const hook = { text: "Every objection is one of two things", start: 0, duration: 3 };
  const place = depthHookSpot(hook, detection(0, 0.32));
  assert.equal(place.breaks.length, 2);
  assert.ok(place.size >= 0.045 * 1920 && place.y >= 0.07 * 1920);
});

test("a head that bobs a little still gets the depth title, tucked at its highest point", () => {
  const d = detection(0, 0.34);
  d.frames[1].faces[0].y += 0.025;
  d.frames[3].faces[0].y += 0.015;
  const place = depthHookSpot({ text: "Nobody claps for Tuesday", start: 0, duration: 3 }, d);
  assert.ok(place);
  const head = (0.34 - 0.15 * 0.26) * 1920;
  assert.ok(place.bottom - head <= place.size * 0.31);
});
