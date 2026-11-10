import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { checkPicks, glowPrompt, layoutGlow } from "../src/glow.mjs";
import { GLOW_ICON_ACTIONS, GLOW_ICONS_JS } from "../src/glow-icons.mjs";
import { firstGlowIcon, glowRuntime, glowScenesHTML, GLOW_BRIDGE_DURATION, GLOW_SCENES_JS } from "../src/glow-scenes.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";

const library = ["phone", "coins", "target", "person"].map((name) => ({ name, draw: name, file: `/fake/icon-${name}.png` }));
const words = Array.from({ length: 36 }, (_, i) => ({ text: ["messages", "adds", "up", "hit"][i % 4], start: 4 + i * 0.4, end: 4.3 + i * 0.4 }));
const empty = { features: [], icons: [], overlays: [], scenes: [] };
const layout = (picks, detection = null) => layoutGlow({ words, video: { duration: 22 } }, { ...empty, ...picks }, library, detection);
const picture = (name) => ({ name, image: `assets/${name}.png` });
const esc = (s) => String(s).replaceAll('"', "&quot;");

function fixture(glow = true) {
  const style = loadPreset("pingel-brand");
  if (glow) style.captions.style = "glow";
  return { name: "glow-actions", canvas: { width: 1080, height: 1920 }, video: { duration: 22, hasAudio: false }, style, captions: [], zooms: [], icons: [], audio: { tracks: [] } };
}

const runtime = (html) => JSON.parse(html.match(/const PLAN = (.*);/)[1]);

function timeline(plan, js = GLOW_SCENES_JS, seek = false) {
  const calls = [], nodes = new Map();
  const node = (id, rect = { left: 0, top: 0, width: 100, height: 100 }) => {
    const el = { id, opacity: 0, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, zIndex: 0, clipPath: "inset(0 0 0 0)", filter: "none", offsetWidth: 200, getBoundingClientRect: () => rect, querySelector: (sel) => nodes.get(id + sel), querySelectorAll: () => [] };
    nodes.set(id, el);
    return el;
  };
  node("root", { left: 10, top: 20, width: 540, height: 960 });
  (plan.icons || []).forEach((icon, i) => {
    node(`icon-${i}`);
    node(`icon-${i}.icon-disc`, { left: 360, top: 520, width: 80, height: 80 });
    ["shadow", "ghost-0", "ghost-1", "ping", "hit"].forEach((cls) => node(`icon-${i}.icon-${cls}`));
  });
  (plan.glowScenes || []).forEach((s, i) => {
    node(`gscene-${i}`);
    node(`gs-${i}-i0`, { left: 160, top: 240, width: 240, height: 240 });
    node(`gs-${i}-p0`, { left: 160, top: 240, width: 240, height: 240 });
  });
  let actual;
  if (seek) {
    const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
    vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
    context.window.gsap.config({ nullTargetWarn: false });
    context.window.gsap.ticker.sleep();
    actual = context.window.gsap.timeline({ paused: true });
  }
  const resolve = (target) => typeof target === "string" ? nodes.get(target.slice(1)) || node(target.slice(1)) : target;
  const tl = {
    fromTo: (target, from, to, at) => { calls.push({ target, from, to, at }); actual?.fromTo(resolve(target), from, to, at); },
    to: (target, to, at) => { calls.push({ target, to, at }); actual?.to(resolve(target), to, at); },
    set: (target, to, at) => { calls.push({ target, to, at, set: true }); actual?.set(resolve(target), to, at); },
  };
  const document = { getElementById: (id) => nodes.get(id), querySelector: (sel) => nodes.get(sel.slice(1)) };
  vm.runInNewContext(js, { PLAN: plan, tl, document, iconFrame: 1 / 30 });
  return { calls, nodes, actual };
}

test("glow icon actions: prompt gives the fixed vocabulary and sentence-based examples", () => {
  const prompt = glowPrompt(words, library, { duration: 22 });
  assert.match(prompt, /action \(optional: drop, spin, stack, ping, hit, float; default float\)/);
  for (const example of ["phone + messages -> ping", "coins + adds up -> stack", "target + hit -> hit"]) assert.ok(prompt.includes(example));
});

test("glow icon actions: validation preserves the six actions and defaults missing or invalid values to float", () => {
  const actions = [...GLOW_ICON_ACTIONS, undefined, "shake", "PING", {}, null];
  // Two seconds apart, so pacing (at most two band elements in three seconds) keeps every one.
  const spread = Array.from({ length: 60 }, (_, i) => ({ text: "messages", start: 4 + i * 0.4, end: 4.3 + i * 0.4 }));
  const picks = checkPicks({ icons: actions.map((action, i) => ({ word: i * 5, icon: i % 2 ? "coins" : "phone", action })) }, spread, library);
  assert.deepEqual(picks.icons.map((p) => p.action), [...GLOW_ICON_ACTIONS, "float", "float", "float", "float", "float"]);
  for (const pick of picks.icons) assert.equal(layout({ icons: [{ ...pick, word: pick.word % 30 }] }).icons[0].action, pick.action);
  assert.equal(layout({ icons: [{ word: 0, icon: "phone", action: "invented" }] }).icons[0].action, "float");
});

test("glow bridges: a matching recent icon survives scene overlap and carries its final plan index", () => {
  const out = layout({ icons: [{ word: 0, icon: "target" }, { word: 2, icon: "phone", action: "ping" }], scenes: [{ type: "icons", from: 4, to: 6, icons: ["phone"] }] });
  assert.equal(out.icons.length, 2);
  assert.equal(out.scenes[0].bridge, 1);
  assert.equal(out.icons[1].end, Math.round((out.scenes[0].start + GLOW_BRIDGE_DURATION) * 1000) / 1000);
  assert.equal(out.icons[1].action, "ping");
  assert.ok(out.icons.every((icon) => icon.x + icon.size <= 0.86 * 1080 && icon.y + icon.size <= 0.785 * 1920));
});

test("glow bridges: no bridge for a stale icon, a different first icon or an icon after scene start", () => {
  const scene = { type: "icons", from: 4, to: 6, icons: ["phone", "target"] };
  for (const icon of [{ word: 0, icon: "phone" }, { word: 2, icon: "target" }, { word: 5, icon: "phone" }]) {
    const out = layout({ icons: [icon], scenes: [scene] });
    assert.equal(out.scenes[0].bridge, undefined);
    assert.ok(out.icons.every((icon) => icon.end <= out.scenes[0].start || icon.t >= out.scenes[0].end));
  }
  const steps = layout({ icons: [{ word: 2, icon: "phone" }], scenes: [{ type: "steps", from: 4, to: 6, items: [{ word: 4, label: "messages", icon: "phone" }, { word: 5, label: "adds up", icon: "coins" }] }] });
  assert.equal(steps.scenes[0].bridge, undefined, "step nodes are not library image icons");
});

test("glow bridges: quick speech can hand off before the usual minimum band hold", () => {
  const fast = words.map((w, i) => ({ ...w, start: 4 + i * 0.2, end: 4.15 + i * 0.2 }));
  const out = layoutGlow({ words: fast, video: { duration: 15 } }, { ...empty, icons: [{ word: 1, icon: "phone" }], scenes: [{ type: "icons", from: 2, to: 4, icons: ["phone"] }] }, library, null);
  assert.equal(out.scenes[0].bridge, 0);
  assert.ok(out.icons[0].end - out.icons[0].t < 0.6);
  assert.ok(out.icons[0].t < out.scenes[0].start);
});

test("glow bridges: face and overlay guards cannot leave dangling scene indexes", () => {
  const picks = { icons: [{ word: 2, icon: "phone" }], scenes: [{ type: "icons", from: 4, to: 6, icons: ["phone"] }] };
  const lowFace = { frames: [{ t: 5, faces: [{ x: 0.3, y: 0.45, w: 0.4, h: 0.3 }] }] };
  const crowded = layout(picks, lowFace);
  assert.equal(crowded.icons.length, 0);
  assert.equal(crowded.scenes[0].bridge, undefined);
  const busy = layout({ ...picks, overlays: [{ type: "stamp", from: 2, to: 2 }] });
  assert.equal(busy.icons.length, 0);
  assert.equal(busy.scenes[0].bridge, undefined);
  const shifted = layout({ icons: [{ word: 0, icon: "target" }, { word: 3, icon: "phone" }], scenes: [{ type: "icons", from: 5, to: 7, icons: ["phone"] }], overlays: [{ type: "stamp", from: 0, to: 0 }] });
  assert.equal(shifted.scenes[0].bridge, 0, "index is assigned after filtering");
});

test("glow bridges: first icons in number, list, versus and people scenes can bridge", () => {
  const variants = [
    { type: "number", value: "10", label: "messages", icon: "phone" },
    { type: "list", items: [{ word: 4, icon: "phone", label: "messages" }, { word: 5, icon: "coins", label: "adds up" }] },
    { type: "versus", left: { word: 4, icon: "phone", label: "messages" }, right: { word: 5, icon: "coins", label: "adds up" } },
    { type: "people", count: 3, label: "messages" },
  ];
  for (const scene of variants) {
    const name = scene.type === "people" ? "person" : "phone";
    const out = layout({ icons: [{ word: 2, icon: name }], scenes: [{ ...scene, from: 4, to: 6 }] });
    assert.equal(out.scenes[0].bridge, 0, scene.type);
    firstGlowIcon(out.scenes[0]).image = `assets/${name}.png`;
    const s = glowRuntime(out.scenes, []).glowScenes[0];
    assert.equal(s.bridge, 0);
    assert.equal(s.bridgeTarget, scene.type === "people" ? "#gs-0-p0" : "#gs-0-i0");
    const html = glowScenesHTML(out.scenes, { W: 1080, H: 1920, esc });
    assert.ok(html.includes(`id="${s.bridgeTarget.slice(1)}"`));
    assert.match(html, /gs-bridge-target/, "target waits for the incoming icon");
  }
});

test("glow wipes: runtime rotates left, up, right and uses 0.22-second matching entrance/exit travel", () => {
  const scenes = Array.from({ length: 4 }, (_, i) => ({ type: "icons", start: 4 + i * 4, end: 6 + i * 4, icons: [picture("phone")] }));
  const plan = glowRuntime(scenes, []);
  assert.deepEqual(plan.glowScenes.map((s) => s.wipe.direction), ["left", "up", "right", "left"]);
  assert.deepEqual(plan.glowScenes.map((s) => [s.wipe.enter, s.wipe.exit]), [
    ["inset(0 0 0 100%)", "inset(0 100% 0 0)"], ["inset(100% 0 0 0)", "inset(0 0 100% 0)"],
    ["inset(0 100% 0 0)", "inset(0 0 0 100%)"], ["inset(0 0 0 100%)", "inset(0 100% 0 0)"],
  ]);
  const { calls, nodes } = timeline(plan);
  plan.glowScenes.forEach((s, i) => {
    const scene = calls.filter((c) => c.target === nodes.get(`gscene-${i}`));
    const wipes = scene.filter((c) => c.to.clipPath);
    assert.equal(wipes.length, 2);
    assert.equal(wipes[0].at, s.start);
    assert.equal(wipes[1].at, s.end - 0.22);
    assert.ok(wipes.every((c) => c.to.duration === 0.22 && c.to.immediateRender === false));
    assert.equal(scene.filter((c) => "opacity" in c.to).length, 2, "short fades remain underneath");
  });
});

test("glow bridges: measured geometry and explicit opacity tweens hand off without a scene pop or early band exit", () => {
  const plan = { width: 1080, height: 1920, icons: [{ t: 4, end: 5 + GLOW_BRIDGE_DURATION, action: "float" }], ...glowRuntime([{ type: "icons", start: 5, end: 7, icons: [picture("phone")], bridge: 0 }], []) };
  const js = GLOW_SCENES_JS + GLOW_ICONS_JS + '\nPLAN.icons.forEach((icon, i) => { const el = document.getElementById("icon-" + i); giAnimate(icon, i, el, el.querySelector(".icon-disc")); });';
  const { calls, nodes } = timeline(plan, js);
  const source = calls.filter((c) => c.target === nodes.get("icon-0"));
  const x = source.find((c) => "x" in c.to);
  const rise = source.find((c) => "y" in c.to);
  assert.equal(x.to.x, -240, "viewport coordinates convert to composition coordinates");
  assert.equal(rise.to.y, -400);
  assert.equal(rise.to.scaleX, 3);
  assert.equal(rise.to.scaleY, 3);
  assert.equal(x.at, 5);
  assert.equal(rise.at, 5.22, "rise only after the ground covers the face");
  assert.ok(Math.abs(rise.at + rise.to.duration - plan.icons[0].end) < 1e-9);
  const fades = source.filter((c) => !c.set && c.to.opacity === 0);
  assert.equal(fades.length, 1, "normal band exit does not compete with the bridge");
  assert.ok(Math.abs(fades[0].at + fades[0].to.duration - plan.icons[0].end) < 1e-9);
  const target = calls.filter((c) => c.target === nodes.get("gs-0-i0") || c.target === "#gs-0-i0");
  const reveal = target.find((c) => c.to.opacity === 1);
  assert.equal(reveal.from.opacity, 0);
  assert.equal(reveal.at, fades[0].at);
  assert.ok(target.every((c) => !("scale" in c.to)), "the scene icon takes over without a second pop");
  for (const c of [...source, ...target].filter((c) => !c.set)) {
    assert.equal(c.to.immediateRender, false);
    assert.ok(!c.to.onStart && !c.to.onComplete, "handoff is reversible timeline state");
  }
});

test("glow icon action timelines: drop, spin, stack, ping, hit and float each act once", () => {
  for (const action of GLOW_ICON_ACTIONS) {
    const plan = { icons: [{ t: 4, end: 5.5, action }] };
    const { calls, nodes } = timeline(plan, GLOW_ICONS_JS + '\ngiAnimate(PLAN.icons[0], 0, document.getElementById("icon-0"), document.getElementById("icon-0").querySelector(".icon-disc"));');
    const disc = calls.filter((c) => c.target === nodes.get("icon-0.icon-disc"));
    if (action === "drop") {
      assert.ok(disc.some((c) => c.from.y < 0 && c.to.y === 0));
      assert.ok(calls.some((c) => c.target === nodes.get("icon-0.icon-shadow") && c.to.scaleX === 1));
    }
    if (action === "spin") assert.deepEqual(disc.map((c) => [c.from.scaleX, c.to.scaleX]), [[1, 0], [0, 1]]);
    if (action === "stack") assert.equal(calls.filter((c) => c.target?.id?.includes(".icon-ghost-")).length, 2);
    if (action === "ping") assert.ok(calls.some((c) => c.target === nodes.get("icon-0.icon-ping") && c.to.scale === 1));
    if (action === "hit") {
      assert.equal(disc.filter((c) => "x" in c.to).length, 2);
      assert.equal(calls.filter((c) => c.target === nodes.get("icon-0.icon-hit")).length, 2);
    }
    assert.equal(calls.filter((c) => c.to.repeat).length, action === "float" ? 1 : 0);
    assert.ok(calls.every((c) => c.set || (c.to.duration > 0 && c.to.immediateRender === false)));
    assert.ok(calls.every((c) => c.at >= 4 && c.at + (c.to.duration || 0) * ((c.to.repeat || 0) + 1) <= 5.5 + 1e-9));
  }
});

test("glow bridge and wipe timelines restore source, target and ground on backward GSAP seeks", () => {
  const plan = { width: 1080, height: 1920, icons: [{ t: 4, end: 5 + GLOW_BRIDGE_DURATION, action: "float" }], ...glowRuntime([{ type: "icons", start: 5, end: 7, icons: [picture("phone")], bridge: 0 }], []) };
  const js = GLOW_SCENES_JS + GLOW_ICONS_JS + '\ngiAnimate(PLAN.icons[0], 0, document.getElementById("icon-0"), document.getElementById("icon-0").querySelector(".icon-disc"));';
  const { nodes, actual } = timeline(plan, js, true);
  const source = nodes.get("icon-0"), target = nodes.get("gs-0-i0"), ground = nodes.get("gscene-0");
  const before = () => {
    actual.seek(4.7);
    assert.equal(source.opacity, 1);
    assert.equal(source.x, 0);
    assert.equal(source.y, 0);
    assert.equal(source.scaleX, 1);
    assert.equal(target.opacity, 0);
    assert.equal(ground.opacity, 0);
  };
  const after = () => {
    actual.seek(6);
    assert.equal(source.opacity, 0);
    assert.equal(source.x, -240);
    assert.equal(source.y, -400);
    assert.equal(source.scaleX, 3);
    assert.equal(target.opacity, 1);
    assert.equal(ground.opacity, 1);
    assert.equal(ground.clipPath, "inset(0 0 0 0)");
  };
  before();
  after();
  before();
  actual.seek(5.1);
  assert.equal(source.y, 0, "stays below the chin during the wipe");
  assert.equal(source.scaleX, 1);
  actual.seek(plan.icons[0].end);
  assert.equal(target.y, 0, "target holds still until the shared move finishes");
  after();
  actual.seek(8);
  assert.equal(ground.opacity, 0);
  after();
  before();
  actual.kill();
});

test("compose: fixture emits glow image actions, bridge and wipes, with valid inline scripts", () => {
  const plan = fixture();
  plan.icons = GLOW_ICON_ACTIONS.map((action, i) => ({ t: 4 + i * 2, end: 5.5 + i * 2, image: "assets/phone.png", word: "messages", x: 690, y: 950, size: 200, action }));
  plan.icons.push({ t: 18, end: 19, icon: "phone.svg", word: "phone", x: 690, y: 950, size: 200, action: "hit" });
  plan.glowScenes = [{ type: "icons", start: 5, end: 7, icons: [picture("phone")], bridge: 0 }];
  const html = renderHTML(plan, "assets/footage.mp4");
  const data = runtime(html);
  assert.deepEqual(data.icons.slice(0, 6).map((i) => i.action), GLOW_ICON_ACTIONS);
  assert.equal(data.icons.at(-1).action, undefined, "Lucide stays on its existing runtime");
  assert.equal(data.glowScenes[0].bridge, 0);
  assert.equal(data.glowScenes[0].wipe.direction, "left");
  assert.equal((html.match(/class="icon-ghost /g) || []).length, 2);
  for (const cls of ["icon-shadow", "icon-ping", "icon-hit"]) assert.ok(html.includes(`class="${cls}"`));
  assert.match(html, /background: #C8A24B/);
  for (const [, js] of html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(js));
});

test("compose: non-glow plans ignore actions and dormant glow scenes byte-for-byte", () => {
  const plan = fixture(false);
  plan.icons = [{ t: 4, end: 5.5, image: "assets/phone.png", word: "messages", x: 690, y: 950, size: 200 }];
  const legacy = renderHTML(plan, "assets/footage.mp4");
  plan.icons[0].action = "stack";
  plan.glowScenes = [{ type: "icons", start: 5, end: 7, icons: [picture("phone")], bridge: 0 }];
  assert.equal(renderHTML(plan, "assets/footage.mp4"), legacy);
  assert.doesNotMatch(legacy, /icon-act|giAnimate|gsBridge|clipPath: s.wipe/);
});

test("glow bridges: pacing keeps a band icon that hands into the next scene and drops one that does not", () => {
  const picks = (icon) => checkPicks({ icons: [{ word: 2, icon }], scenes: [{ type: "icons", from: 4, to: 6, icons: ["phone"] }] }, words, library, { duration: 22 });
  assert.deepEqual(picks("phone").icons.map((p) => p.icon), ["phone"]);
  assert.equal(picks("coins").icons.length, 0, "an unrelated icon running into a scene is trimmed");
  const out = layoutGlow({ words, video: { duration: 22 } }, picks("phone"), library, null);
  assert.equal(out.scenes[0].bridge, 0);
});
