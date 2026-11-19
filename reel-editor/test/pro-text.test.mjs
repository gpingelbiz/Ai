import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { proCaptionHTML, proHookHTML, proCSS } from "../src/pro-text.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { fixturePlan } from "../scripts/golden.mjs";
import { GREG_PRESETS } from "../src/client-mode.mjs";
import { glowEnabled } from "../src/glow.mjs";
import { boldEnabled } from "../src/bold.mjs";
import { planZooms, planProZooms, proZoomBudget } from "../src/zooms.mjs";

test("pro caption markup has fixed line breaks, escaped words and a stable measured anchor", () => {
  const group = { y: 1100, lines: [2, 1], words: [{ text: "don't" }, { text: "<stop>", key: true }, { text: "listening" }] };
  const html = proCaptionHTML(group, 2);
  assert.match(html, /font-size:80px;top:1100px/);
  assert.match(html, /&lt;stop&gt;/);
  assert.equal((html.match(/class="pro-row"/g) || []).length, 2);
  assert.equal((html.match(/class="w k"/g) || []).length, 1);
  assert.match(proCaptionHTML({ ...group, y: undefined }, 0, { height: 960 }), /font-size:40px;top:624px/);
  const css = proCSS({ captions: true });
  for (const spec of [/font-weight: 700/, /line-height: 92px/, /letter-spacing: -0.8px/, /max-width: 780px/, /padding: 12px 24px/, /border-radius: 12px/, /rgba\(17,17,17,0.92\)/, /#E2BA64/, /text-shadow: none/]) assert.match(css, spec);
  assert.equal(proCSS(), "");
});

test("pro hook markup and style give frame zero a two-line Anton title on black", () => {
  const html = proHookHTML({ duration: 2.4, lines: [1, 2], words: [{ text: "STOP" }, { text: "<TALKING>" }, { text: "FAST" }] });
  assert.match(html, /data-start="0" data-duration="2.4"/);
  assert.match(html, /&lt;TALKING&gt;/);
  assert.equal((html.match(/pro-row/g) || []).length, 2);
  const css = proCSS({ hook: true });
  assert.match(css, /top: 176px/);
  assert.match(css, /font-family: "Anton"/);
  assert.match(css, /font-weight: 400; font-size: 100px/);
  assert.match(css, /background: #000000/);
  assert.match(css, /max-width: 768px; padding: 16px 24px/, "816 px outer width includes the plate padding");
  assert.match(css, /opacity: 1/);
});

test("pro composition uses hard caption swaps, immediate hook and plain 200 ms power2 camera moves", () => {
  const plan = fixturePlan("fixture.mp4");
  plan.preset = "pingel-pro";
  plan.style.captions.pro = true;
  plan.style.hook.pro = true;
  plan.style.zooms.pro = true;
  plan.hook.lines = [3, 5];
  plan.captions = plan.captions.map((g) => ({ ...g, lines: [g.words.length], y: 1248 }));
  const html = renderHTML(plan, "assets/footage.mp4");
  const runtime = JSON.parse(html.match(/const PLAN = (.+);/)[1]);
  assert.equal(runtime.capCut, true);
  assert.equal(runtime.activeWord, false);
  assert.equal(runtime.capDim, false);
  assert.equal(runtime.annotate, false);
  assert.equal(runtime.hookPush, false);
  assert.equal(runtime.hook.style, "pro");
  assert.equal(runtime.zoomStyle, "pro");
  assert.match(html, /tl.set\("#pro-title", \{ opacity: 1 \}, 0\)/);
  assert.match(html, /tl.set\("#pro-title", \{ opacity: 0 \}, PLAN.hook.duration\)/);
  assert.match(html, /duration: z.snap, ease: "power2.out"/);
  assert.equal((html.match(/class="cap cap-pro"/g) || []).length, plan.captions.length);
  const js = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Script(js), "emitted runtime parses");
});

test("pro switches prevent legacy restyling from overwriting their caption and hook contract", () => {
  assert.ok(GREG_PRESETS.includes("pingel-pro"));
  const plan = { preset: "pingel-pro", canvas: { width: 1080, height: 1920 } };
  for (const feature of ["captions", "hook"]) {
    const style = { glow: { enabled: true }, bold: { enabled: true }, [feature]: { pro: true } };
    assert.equal(glowEnabled(style, plan, {}), false);
    assert.equal(boldEnabled(style, plan, {}), false);
  }
  assert.equal(glowEnabled({ glow: { enabled: true } }, plan, {}), true);
});

test("pro zoom budget limits both total and rolling density with a still two-second ending", () => {
  assert.deepEqual([0, 2, 12, 30, 60].map(proZoomBudget), [0, 0, 1, 2, 4]);
  const groups = Array.from({ length: 30 }, (_, i) => ({ start: i * 3, end: i * 3 + 1, words: [{ text: "stop", key: true, start: i * 3 + 0.4, end: i * 3 + 0.8 }] }));
  const before = structuredClone(groups);
  const keys = planProZooms(groups, 90, { hook: { start: 0, duration: 2.4 } });
  const punches = keys.filter((z) => z.scale > 1);
  assert.ok(punches.length <= 6);
  for (const z of punches) {
    assert.ok(z.scale >= 1.08 && z.scale <= 1.12);
    assert.equal(z.snap, 0.2);
    assert.equal(z.ease, "power2.out");
    assert.ok(groups.some((g) => Math.abs(g.words[0].start - z.t - z.snap) < 1e-8));
    assert.ok(punches.filter((k) => k.t >= z.t && k.t < z.t + 30).length <= 2);
  }
  assert.ok(keys.every((z) => z.t + z.snap <= 88 + 1e-8));
  assert.deepEqual(planZooms(groups, 90, { pro: true }), planProZooms(groups, 90));
  assert.deepEqual(planProZooms(groups, 20, { busy: [{ start: 0, duration: 20 }] }), []);
  assert.deepEqual(planProZooms([{ start: 3, end: 4, words: [{ text: "plain", start: 3 }] }], 10), []);
  assert.deepEqual(groups, before);
});

// These hashes were captured before changing the composer; golden pixels have the same HTML, CSS and GSAP input.
const legacy = {
  "pingel-brand": "4eb4d6a574f49395fd8c951946f3ce715d4302693118df5b502bf1c6715ecad3",
  "pingel-bold": "f4bb7290699d14e6354ee7e7020ee7e2ba9f3b3c77df831200ef7ebf3d526192",
  clean: "ad9cc68d543e4107981dede25e654040ecb03a202e098fd6b867c5237770bc85",
  vsl: "91efe2ca41328efea454a587b14623b047ab1ecacb4b19a0d8bbb8f6b3b756d6",
  "pingel-v2": "307483b2092fa537163dda7739cd3fb2e6936ca8296122943ce647629b773830",
};
for (const [name, hash] of Object.entries(legacy)) test(`${name} composition remains byte-identical to the pre-pro baseline`, () => {
  const plan = fixturePlan("fixture.mp4");
  plan.style = loadPreset(name);
  plan.preset = name;
  assert.equal(createHash("sha256").update(renderHTML(plan, "assets/footage.mp4")).digest("hex"), hash);
});
