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
    clean: "b06324be3e9fe816767452765357529bb2cd3cd8a41fb98dc595a5231b8bd40c",
    "pace-fast": "97682c1d05d38d845d6849a1e91701b929848dca6b20e729aeff68e440f46579",
    // 2026-11-02: Greg's own captions went back to caps, gold and markers (jungle reel debrief); pingel-v2 keeps its look.
    "pingel-brand": "2f2a3d460c7aba9001451b0eadec4c761dbcd11f1b092605ce030b946f06c3fe",
    // Bold's own runtime and caption coverage have separate tests in bold*.test.mjs.
    "pingel-bold": "16eada40f684cdda83cf9e6aa54cb7dce10e1ffc74016dcfcb908fbd0053f7ee",
    // Runway also disables the inherited focus pull.
    "pingel-runway": "1bd775a4ac3c27de1274ac55610d9570170fa228b2cb8bebb246d83d6e8435e5",
    "pingel-v2": "6a7516b461408b5ef2fbb0aa9197cdff6710d65b270094d489406605f0ec99c5",
    speaker: "03f8b0f0aea3503cfb6d76046b7bb6239bdcf5bafba57c304a6db29ede8a102d",
    // 2026-11-10: Greg picked bigger VSL subtitles on a dark plate.
    vsl: "022929dbccdb55581e4f019e6a37367fb2decbfbb6d61321cfa1c995975c5835",
    youtube: "1ed1bfcbb4b859978467789b6171b21cd1317f899b392844b6ab3e9a4ce6029c",
  };
  // Pro is new; its classes and timing are checked without snapshots in pro-render.test.mjs.
  for (const file of fs.readdirSync(new URL("../presets", import.meta.url)).filter((name) => name.endsWith(".json") && !name.startsWith("_") && !["broll-shotlist.json", "pingel-pro.json"].includes(name)).sort()) {
    const name = file.slice(0, -5);
    const style = loadPreset(name);
    // Freeze the legacy still finish; moving presets now omit the focus blur.
    if (name === "pingel-brand" || name === "pingel-v2") style.broll.focusPull = 0.3;
    style.brand.signature = { ...style.brand.signature, kind: "none" };
    style.brand.houseLooks = [];
    style.brand.modes = {};
    style.brand.contentModes = {};
    const hash = crypto.createHash("sha256").update(renderHTML(fixture(style), "assets/footage.mp4")).digest("hex");
    assert.equal(hash, expected[name], name);
  }
});
