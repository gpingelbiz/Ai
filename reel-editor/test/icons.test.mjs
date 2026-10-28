import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { iconCandidates, iconMatches, placeIcon, planIcons } from "../src/icons.mjs";
import { renderHTML } from "../src/compose.mjs";
import { soundCues } from "../src/sounds.mjs";

const line = (start, text, key = false) => {
  const parts = text.split(" ");
  return {
    start,
    end: start + parts.length * 0.35,
    text,
    words: parts.map((word, i) => ({ text: word, start: start + i * 0.3, end: start + i * 0.3 + 0.25, key: key && i === 0 })),
  };
};

const face = { cx: 0.3, cy: 0.35, w: 0.18, h: 0.16 };

test("icon dictionary: phrases, stems and plurals match whole spoken words; vague and embedded words do not", () => {
  assert.deepEqual(iconMatches("Money, closers, texting, objections, trucks").map((x) => x.icon), ["dollar-sign.svg", "handshake.svg", "message-square.svg", "circle-x.svg", "truck.svg"]);
  assert.deepEqual(iconMatches("TEXT ME in ten minutes for booked calls").map((x) => x.icon), ["message-square.svg", "clock.svg", "calendar-check.svg"], "long phrases win over their component words");
  assert.deepEqual(iconMatches("thing stuff good way people moneyball recalls"), [], "no vague words or substring matches");
  const c = iconCandidates([line(4, "Sales calls"), line(9, "faith family gym")]);
  assert.deepEqual(c.map((x) => [x.t, x.icon]), [[4, "phone-call.svg"], [9, "book-open.svg"], [9.3, "heart.svg"], [9.6, "dumbbell.svg"]]);
});

test("icon planning: gold nouns rank first, spacing and reel/rolling caps apply, and icons never repeat in sequence", () => {
  const ranked = planIcons([line(5, "calls"), line(12, "close"), line(19, "money", true)], 40, { face, minSpacing: 0, max: 1, maxPer30: 9 });
  assert.equal(ranked[0].word, "money", "the later gold word outranks earlier nouns and verbs");

  const spaced = planIcons([line(4, "money"), line(7, "calls"), line(11, "time"), line(18, "deal"), line(25, "truck")], 40, { face, minSpacing: 6, max: 4, maxPer30: 3 });
  assert.ok(spaced.length <= 3, "at most three pops fit in any rolling 30 seconds");
  assert.ok(spaced.every((x, i) => !i || x.t - spaced[i - 1].t >= 6));

  const noRepeat = planIcons([line(5, "calls"), line(12, "sales calls"), line(19, "money"), line(26, "calls")], 40, { face, minSpacing: 0, max: 10, maxPer30: 10 });
  assert.deepEqual(noRepeat.map((x) => x.icon), ["phone-call.svg", "dollar-sign.svg", "phone-call.svg"]);
});

test("icon planning: hook, cards, cutaways, guarded slams, rail pulses and the last 1.5 seconds are busy", () => {
  const groups = [line(2, "money"), line(5.5, "calls"), line(10.5, "time"), line(13.8, "deal"), line(20.4, "text"), line(24, "truck"), line(28, "faith")];
  const icons = planIcons(groups, 30, {
    face,
    hook: { start: 0, duration: 3 },
    busy: [
      { start: 5, duration: 2, kind: "card" },
      { start: 10, duration: 2, kind: "cutaway" },
      { start: 15, duration: 1, pad: 0.3, kind: "slam" },
      { start: 20, duration: 1.4, kind: "rail pulse" },
    ],
    minSpacing: 0,
    max: 20,
    maxPer30: 20,
  });
  assert.deepEqual(icons.map((x) => x.word), ["truck"]);
  assert.deepEqual(icons.skipped, { hook: 1, card: 1, cutaway: 1, slam: 1, "rail pulse": 1, tail: 1 });
});

test("icon placement: empty side wins, above is the fallback, no-room skips, and the square never covers the head", () => {
  const detection = { frames: [{ faces: [{ x: 0.21, y: 0.27, w: 0.18, h: 0.16 }], bodies: [{ x: 0.15, y: 0.2, w: 0.3, h: 0.6 }] }] };
  const side = placeIcon({ face, detection });
  assert.equal(side.side, "right", "a face on the left leaves the right side empty");
  const rect = { x: side.x, y: side.y, w: side.size, h: side.size };
  assert.ok(rect.x >= 76 && rect.x + rect.w <= 940 && rect.y >= 200);
  assert.ok(rect.x >= side.head.x + side.head.w || rect.x + rect.w <= side.head.x || rect.y >= side.head.y + side.head.h || rect.y + rect.h <= side.head.y, "the icon and strongest-zoom head boxes do not overlap");

  const above = placeIcon({ face: { cx: 0.5, cy: 0.55, w: 0.6, h: 0.25 } });
  assert.equal(above.side, "above", "both side gaps are too narrow, but the top gap is safe");
  assert.ok(above.y + above.size < above.head.y);
  const skipped = placeIcon({ face: { cx: 0.5, cy: 0.25, w: 0.6, h: 0.22 } });
  assert.equal(skipped.skip, true, "both sides and the top safe zone are blocked");

  const zoomed = placeIcon({ face, detection, zooms: [{ t: 5, scale: 1.4 }], t: 5, end: 6.2 });
  assert.ok(zoomed.head.w > side.head.w, "placement uses the strongest zoom active in its window");
});

test("render: icon SVGs are inline, brand skins and frame-timed motion are present, sound is quiet, and legacy plans are unchanged", () => {
  const style = JSON.parse(fs.readFileSync(new URL("../presets/_defaults.json", import.meta.url)));
  style.colors = { text: "#ABCDEF", accent: "#123456", stroke: "#000000", bg: "#654321" };
  style.icons = { ...style.icons, enabled: true, skin: "disc" };
  const base = { name: "icons", canvas: { width: 1080, height: 1920 }, video: { duration: 20, hasAudio: true }, style, captions: [], zooms: [], audio: { tracks: [] } };
  const icon = { t: 5, end: 6.2, icon: "dollar-sign.svg", word: "money", x: 700, y: 400, size: 130 };
  const html = renderHTML({ ...base, icons: [icon] }, "assets/footage.mp4");
  assert.match(html, /id="icon-0" class="icon-pop icon-disc clip"/);
  assert.match(html, /<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25"/);
  assert.match(html, /background: #123456/);
  assert.match(html, /color: #654321/);
  assert.doesNotMatch(html, /src="assets\/icons\//, "the render makes no icon fetch");
  assert.match(html, /duration: 4 \* iconFrame, ease: "back\.out\(1\.8\)"/);
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter(Boolean);
  for (const js of scripts) assert.doesNotThrow(() => new Function(js));

  const glass = renderHTML({ ...base, style: { ...style, icons: { ...style.icons, skin: "glass" } }, icons: [icon] }, "assets/footage.mp4");
  assert.match(glass, /class="icon-pop icon-glass clip"/);
  assert.match(glass, /background: rgba\(101, 67, 33, 0\.7\)/);
  assert.match(glass, /border: 1\.5px solid #ABCDEF/);
  assert.match(glass, /color: #123456/);

  const absent = renderHTML(base, "assets/footage.mp4");
  const empty = renderHTML({ ...base, icons: [] }, "assets/footage.mp4");
  assert.equal(empty, absent, "an old plan without icons renders byte-for-byte like an empty icon plan");
  assert.ok(!absent.includes("icon-pop") && !absent.includes("PLAN.icons"));

  const cue = soundCues({ icons: [icon], level: 0.3 });
  assert.deepEqual(cue, [{ id: "sfx-icon-1", src: "assets/sfx/card.wav", start: 5, duration: 0.3, volume: 0.135, track: 9 }]);
});
