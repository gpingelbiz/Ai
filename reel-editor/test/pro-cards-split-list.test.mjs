import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CARDS, tagsOf } from "../src/pro-cards/index.mjs";
import { CARDS as batch } from "../src/pro-cards/split-list.mjs";
import { budgetProOverlays, groundProOverlay, placeProGraphics, placeProOverlay, proCaptionBox, PRO_MOTION, seamCaptions } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { runEdit } from "../src/pipeline.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";
import { PKG_ROOT, r3 } from "../src/util.mjs";

const type = "split-list";
const def = CARDS[type];
const range = (from, to = from) => ({ from, to });
const pick = { type, heading: "THREE HABITS", items: [range(4, 5), range(6), range(7, 8)] };
const words = "Here are three habits. Ask twice. Listen. Write it. Keep up the practice.".split(" ")
  .map((text, i) => ({ text, start: r3(2.8 + i * 0.2), end: r3(2.98 + i * 0.2) }));
const frame = { W: 1080, H: 1920, measured: true, head: { x: 320, y: 320, w: 440, h: 608 } };

test("split-list registers as a full-screen procedure and uses the full-screen budget", () => {
  assert.deepEqual(Object.keys(batch), [type]);
  assert.equal(def, batch[type]);
  assert.equal(def.family, "procedure");
  assert.deepEqual(tagsOf(type), ["list", "steps"]);
  assert.match(def.hint, /three to five.*names each one in turn/);
  assert.equal(def.fullscreen, true);
  assert.equal(def.split, true);
  assert.equal(def.surface, "bare");
  assert.deepEqual(def.size, { w: 1080, h: 1920 });
  assert.equal(def.slots.heading.kind, "label");
  assert.equal(def.slots.heading.optional, true);
  assert.equal(def.slots.items.kind, "spoken");
  assert.deepEqual(def.slots.items.repeat, [3, 5]);
  assert.ok(def.slots.items.size >= 56);
  const card = groundProOverlay(pick, words);
  const laterFull = { type: "caution-tape", fullscreen: true, start: 10, end: 13, duration: 3 };
  assert.deepEqual(budgetProOverlays([card, laterFull], { duration: 18 }).map((c) => c.type), [type]);
});

test("grounding takes spoken items in order and accepts only a short spoken heading", () => {
  const card = groundProOverlay(pick, words);
  assert.equal(card.slots.heading[0].text, "THREE HABITS");
  assert.deepEqual(card.slots.items.map((item) => item.text), ["Ask twice.", "Listen.", "Write it."]);
  assert.deepEqual(card.slots.items.map((item) => item.at), [words[4].start, words[6].start, words[7].start]);
  assert.deepEqual(card.reveals, [words[4].start, words[6].start, words[7].start]);

  const five = groundProOverlay({ type, items: [...pick.items, range(9, 10), range(11, 12)] }, words);
  assert.equal(five.slots.items.length, 5);
  assert.deepEqual(five.slots.heading, []);
  for (const name of ["3 HABITS", "FIVE HABITS", "Here are three habits Ask"]) {
    assert.equal(groundProOverlay({ ...pick, heading: name }, words), null);
  }
  const oversized = words.map((w, i) => i === 4 ? { ...w, text: "x".repeat(31) } : w);
  assert.equal(groundProOverlay(pick, oversized), null);
  const tooWideAt56 = words.map((w, i) => i === 6 ? { ...w, text: "W".repeat(13) } : w);
  assert.equal(groundProOverlay(pick, tooWideAt56), null);
  for (const items of [["invented", ...pick.items.slice(1)], pick.items.toReversed(), pick.items.slice(1), [...pick.items, range(9), range(10), range(11)]]) {
    assert.equal(groundProOverlay({ ...pick, items }, words), null);
  }
});

test("wrapped items fit the five-row panel at the minimum type size", () => {
  const phrases = ["Ask the direct question", "Listen for the real ask", "Pause", "Listen", "Summarize"];
  const source = phrases.map((text, i) => ({ text, start: 3 + i * 0.3, end: 3.28 + i * 0.3 }));
  const list = { type, items: source.map((_, i) => range(i)) };
  const card = groundProOverlay(list, source);
  assert.deepEqual(card.slots.items.map((item) => item.lines.length), [2, 2, 1, 1, 1]);
  assert.ok(card.slots.items.every((item) => item.fontSize === undefined));
  const tooTall = source.map((w, i) => i === 2 ? { ...w, text: "Repeat the key question" } : w);
  assert.equal(groundProOverlay(list, tooTall), null);
});

test("placement measures clearance from the seam and skips a low or missing head", async () => {
  const card = groundProOverlay(pick, words);
  assert.deepEqual(placeProOverlay(card, frame), { slot: "split", spot: "split", x: 0, y: 0, w: 1080, h: 1920, scale: 1 });
  const half = { W: 540, H: 960, measured: true, head: { x: 160, y: 160, w: 220, h: 304 } };
  assert.deepEqual(placeProOverlay(card, half), { slot: "split", spot: "split", x: 0, y: 0, w: 540, h: 960, scale: 0.5 });
  assert.equal(placeProOverlay(card, { ...frame, head: { ...frame.head, h: 609 } }), null);
  assert.equal(placeProOverlay(card, { ...frame, head: null }), null);
  assert.equal(placeProOverlay(card, { ...frame, measured: false }), null);

  const placed = await placeProGraphics([card], { detect: async (_, times) => ({
    frames: times.map((t, i) => ({ t, faces: [{ x: 0.3, y: i === 5 ? 0.4 : 0.2, w: 0.2, h: 0.15 }] })),
  }) });
  assert.deepEqual(placed, []);
  assert.deepEqual(placed.missed, [card]);
});

test("seamCaptions centres only overlapping cues and keeps their plates inside the shared safe zone", () => {
  const groups = [
    { start: 2, end: 3, y: 1200 },
    { start: 2.9, end: 4, y: 1200, lines: [1] },
    { start: 5.5, end: 6.5, y: 1200, lines: [2, 1] },
    { start: 6, end: 7, y: 1200 },
  ];
  const card = { type, start: 3, end: 6 };
  assert.equal(seamCaptions([card], groups), groups);
  assert.equal(seamCaptions([{ ...card, place: { slot: "full" } }], groups), groups);
  for (const H of [1920, 960]) {
    const W = 1080 * H / 1920, zone = zoneFor(W, H);
    const moved = seamCaptions([{ ...card, place: { slot: "split" } }], groups, { H });
    assert.equal(moved[0], groups[0]);
    assert.equal(moved[3], groups[3]);
    assert.deepEqual(moved.slice(1, 3).map((g) => g.y), [902, 856].map((y) => y * H / 1920));
    for (const group of moved.slice(1, 3)) {
      const { x, y, w, h } = proCaptionBox(group, { W, H });
      assert.equal(y + h / 2, H / 2);
      assert.ok(x >= zone.left && x + w <= rightLimit(zone, y, y + h));
      assert.ok(y >= zone.top && y + h <= zone.bottom);
    }
  }
});

test("split-list escapes copy and writes numbered rows once at their spoken reveals", () => {
  const source = words.map((w, i) => i === 6 ? { ...w, text: "<b>&'yes'" } : w);
  const grounded = groundProOverlay(pick, source);
  const card = { ...grounded, id: "pro-0", place: placeProOverlay(grounded, frame) };
  const { html, timeline } = renderProOverlay(card);
  assert.match(html, /class="pro-overlay pro-split-list pro-bare pro-full"/);
  assert.match(html, /&lt;b&gt;&amp;&#39;yes&#39;/);
  assert.doesNotMatch(html, /<b>|<img\b/);
  assert.deepEqual(Array.from(html.matchAll(/class="split-number"[^>]*>(\d)<\/span>/g), ([, n]) => Number(n)), [1, 2, 3]);

  const calls = [];
  const tl = { fromTo: (...args) => calls.push(args), to: (...args) => calls.push(args) };
  new Function("tl", proTimeline([card]))(tl);
  const rows = calls.filter(([selector]) => selector.includes(".split-item"));
  assert.equal(rows.length, 3);
  for (const [i, [selector, from, to, at]] of rows.entries()) {
    assert.equal(selector, `#pro-0 .split-item:nth-child(${i + 1})`);
    assert.deepEqual(from, { opacity: 0, clipPath: "inset(0 100% 0 0)" });
    assert.equal(to.opacity, 1);
    assert.equal(to.clipPath, "inset(0 0% 0 0)");
    assert.equal(to.duration, PRO_MOTION.enter);
    assert.equal(to.immediateRender, false);
    assert.equal(to.ease, calls[0][2].ease);
    assert.equal(at, card.slots.items[i].at);
  }
  assert.equal(renderProOverlay(card).timeline, timeline);

  for (const rule of def.css.split("}").filter((part) => part.trim())) assert.match(rule.trim(), /^\.pro-split-list[. ]/);
  assert.match(def.css, /inset:960px 0 -16px;background:#0B0B0D;border-top:4px solid #C8A24B/);
  assert.match(def.css, /left:180px;width:720px/);
  assert.doesNotMatch(def.css, /gradient|shadow|url\(|@keyframes/);
  assert.deepEqual(new Set(def.css.match(/#[\da-f]{6}/gi)), new Set(["#0B0B0D", "#C8A24B", "#F5F1E8"]));
  assert.deepEqual(new Set(Array.from(def.css.matchAll(/"([^"]+)",sans-serif/g), ([, font]) => font)), new Set(["Inter", "Anton"]));
  assert.ok(proCSS({ types: new Set([type]) }).includes(def.css));
  assert.doesNotMatch(proCSS({ types: new Set(["full-list"]) }), /\.pro-split-list/);
});

test("runEdit saves only the placed split card's overlapping pro captions on the seam", { skip: spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(PKG_ROOT, ".split-list-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const footage = path.join(dir, "source.mp4"), transcript = path.join(dir, "transcript.json"), preset = path.join(dir, "preset.json");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=108x192:r=30:d=9", "-c:v", "libx264", "-pix_fmt", "yuv420p", footage]);
  fs.writeFileSync(transcript, JSON.stringify({ words: [...words, { text: "Repeat.", start: 7.3, end: 7.9 }] }));
  fs.writeFileSync(preset, JSON.stringify({
    name: "pingel-pro", extends: "pingel-pro", canvas: "portrait", framing: { enabled: false },
    finish: { enabled: false }, audio: { pro: false },
  }));
  const options = { preset, transcript, noRender: true, noCuts: true, noHook: true, noZooms: true, noBroll: true, noSounds: true, noFixWords: true, noAlign: true, noMirrorCheck: true, noEvidence: true };
  const edit = (name, y) => runEdit(footage, { ...options, out: path.join(dir, name) }, {
    proDirection: { available: () => true, ask: async () => JSON.stringify({ overlays: [pick] }) },
    detectFaces: async (_, times) => ({ frames: times.map((time) => ({ t: time, faces: [{ x: 0.35, y, w: 0.3, h: 0.18 }] })) }),
  });
  const { plan, workDir } = await edit("high", 0.18);
  const [card] = plan.proGraphics;
  assert.equal(card.place.slot, "split");
  const html = fs.readFileSync(path.join(workDir, "project", "index.html"), "utf8");
  assert.match(html, /pro-split-list pro-bare pro-full/);
  let centred = 0;
  plan.captions.forEach((g, i) => {
    if (g.start < card.end && g.end > card.start) {
      assert.equal(g.y + proCaptionBox(g, { H: plan.canvas.height }).h / 2, plan.canvas.height / 2);
      assert.match(html, new RegExp(`id="cap-${i}"[^>]*top:${g.y}px`));
      centred++;
    } else assert.equal(g.y, plan.proCaptionSource[i].y);
  });
  assert.ok(centred > 0 && centred < plan.captions.length);

  const low = await edit("low", 0.45);
  assert.deepEqual(low.plan.proGraphics, []);
  assert.deepEqual(low.plan.captions, low.plan.proCaptionSource);
});
