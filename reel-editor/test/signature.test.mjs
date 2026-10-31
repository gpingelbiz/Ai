import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { renderHTML } from "../src/compose.mjs";
import { carouselHTML } from "../src/carousel.mjs";
import { loadPreset } from "../src/presets.mjs";
import { signatureHTML, signatureLayout, signatureSafeArea, titlePlate } from "../src/signature.mjs";

const formats = [
  ["reel", 1080, 1920],
  ["cover", 1080, 1920],
  ["cover", 1080, 1440],
  ["carousel", 1080, 1350],
  ["static", 1080, 1350],
  ["story", 1080, 1920],
  ["thumbnail", 1920, 1080],
];

function tokens(kind, position = kind === "edge-rule" ? "left" : "top-left") {
  const brand = structuredClone(loadPreset("pingel-brand").brand);
  brand.signature = { ...brand.signature, kind, position, colorRole: "accent", thickness: 4, length: 120, opacity: 0.7 };
  return brand;
}

test("signature: every device and format stays inside its platform-safe rectangle", () => {
  for (const kind of ["edge-rule", "corner-mark", "title-plate"]) {
    for (const [format, width, height] of formats) {
      const layout = signatureLayout(tokens(kind), { format, width, height });
      const safe = signatureSafeArea({ format, width, height });
      assert.equal(layout.skip, undefined, `${kind} ${format} ${height}`);
      assert.ok(layout.x >= safe.x - 0.001, `${kind} ${format} left`);
      assert.ok(layout.y >= safe.y - 0.001, `${kind} ${format} top`);
      assert.ok(layout.x + layout.w <= safe.x + safe.w + 0.001, `${kind} ${format} right`);
      assert.ok(layout.y + layout.h <= safe.y + safe.h + 0.001, `${kind} ${format} bottom`);
      const html = signatureHTML(tokens(kind), { format, width, height });
      assert.match(html, new RegExp(`data-kind="${kind}"`));
      assert.match(html, /data-x="[\d.]+" data-y="[\d.]+" data-w="[\d.]+" data-h="[\d.]+"/);
    }
  }
  assert.equal(signatureHTML(tokens("none"), { format: "reel", width: 1080, height: 1920 }), "");
});

test("signature: corner devices move away from the head guard and title plates use token geometry", () => {
  const brand = tokens("corner-mark");
  const guarded = signatureLayout(brand, { format: "reel", width: 1080, height: 1920, headBox: { cx: 0.22, cy: 0.2, w: 0.34, h: 0.24 } });
  assert.notEqual(guarded.corner, "top-left");
  const plate = titlePlate(tokens("title-plate"), { format: "carousel", width: 1080 });
  assert.deepEqual(plate, { radius: 18, paddingX: 24, paddingY: 16, rulePosition: "top", ruleThickness: 4 });
});

function fixture(style) {
  return {
    version: 1,
    name: "signature-legacy-fixture",
    canvas: { width: 1080, height: 1920, mode: "portrait" },
    style,
    video: { src: "/tmp/fixed.mp4", duration: 4, width: 1080, height: 1920, fps: 30, hasAudio: false },
    hook: null,
    cta: null,
    captions: [],
    zooms: [],
    graphics: [],
    broll: [],
    slams: [],
    icons: [],
    audio: { tracks: [] },
    framing: { scale: 1, origin: "50% 40%", shift: 0, face: null, side: "right" },
    reframe: [],
  };
}

test("compose: the persistent reel signature is above b-roll and below cards and captions", () => {
  const style = loadPreset("pingel-v2");
  const plan = fixture(style);
  plan.broll = [{ src: "assets/broll.png", start: 0.5, duration: 1 }];
  plan.graphics = [{ type: "headline", text: "A speaker line", eyebrow: "", start: 1.7, duration: 1, skin: "type" }];
  const html = renderHTML(plan, "assets/footage.mp4");
  const broll = html.indexOf('id="broll-0"');
  const signature = html.indexOf('class="signature-layer"');
  const card = html.indexOf('id="gfx-0"');
  const captions = html.indexOf('id="captions"');
  assert.ok(broll < signature && signature < card && card < captions);
});

test("carousel: an enabled signature appears once on every slide", () => {
  const brand = tokens("edge-rule");
  const html = carouselHTML([{ title: "One", body: "" }, { title: "Two", body: "" }, { title: "Three", body: "" }], { colors: {}, tokens: brand });
  assert.equal((html.match(/class="signature-layer"/g) || []).length, 3);
});

test("legacy render snapshots: no signature and no house list keep every existing preset's HTML unchanged", () => {
  const expected = {
    clean: "6138df32bbb050886d4625ea8b055259ca2a1baa57f437214a371d8aecbcdefd",
    "pace-fast": "afcfbca8378f7e54f2e6fe41f56283cd53df97794cb2c4037c0a948d08b29f53",
    "pingel-brand": "22d553ccbd4dda63bc49f89f48b9729a4f7a3dd9d044f721d049a2c9910d1638",
    "pingel-runway": "22d553ccbd4dda63bc49f89f48b9729a4f7a3dd9d044f721d049a2c9910d1638",
    "pingel-v2": "22d553ccbd4dda63bc49f89f48b9729a4f7a3dd9d044f721d049a2c9910d1638",
    speaker: "02fd8099cebdcecbf752ed364a994eb4b9b706388112c8db6eedc3512df3f83a",
    youtube: "1e0120f8f3c4dc3eb9b118ca35c0c75fdda699f6089095cbc22e7ab8baa4278f",
  };
  for (const file of fs.readdirSync(new URL("../presets", import.meta.url)).filter((name) => name.endsWith(".json") && !name.startsWith("_")).sort()) {
    const name = file.slice(0, -5);
    const style = loadPreset(name);
    style.brand.signature = { ...style.brand.signature, kind: "none" };
    style.brand.houseLooks = [];
    style.brand.modes = {};
    style.brand.contentModes = {};
    const hash = crypto.createHash("sha256").update(renderHTML(fixture(style), "assets/footage.mp4")).digest("hex");
    assert.equal(hash, expected[name], name);
  }
});
