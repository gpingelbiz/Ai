import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS } from "../src/pro-cards/conversation-2.mjs";
import { CARDS as registry } from "../src/pro-cards/index.mjs";
import { CARDS as core } from "../src/pro-cards/core.mjs";
import { CARDS as distinction } from "../src/pro-cards/distinction-payoff.mjs";
import { CARDS as procedure } from "../src/pro-cards/procedure-proof.mjs";
import { CARDS as conversation } from "../src/pro-cards/conversation.mjs";
import { CARDS as warning } from "../src/pro-cards/warning-emphasis-full.mjs";
import { groundCard, groundProOverlay, proSize, PRO_RECTS, PRO_MOTION } from "../src/pro.mjs";
import { renderProOverlay, proTimeline, proCSS } from "../src/pro-render.mjs";

function fixture(type, texts) {
  const words = [], pick = {};
  for (const [name, slot] of Object.entries(CARDS[type].slots)) {
    const phrases = texts?.[name] || Array(slot.repeat?.[1] || 1).fill("Call at 4?");
    const items = phrases.map((phrase) => {
      const from = words.length;
      for (const text of phrase.split(" ")) {
        const start = +(3 + words.length * 0.4).toFixed(3);
        words.push({ text, start, end: +(start + 0.3).toFixed(3) });
      }
      return { from, to: words.length - 1 };
    });
    pick[name] = slot.repeat ? items : items[0];
  }
  const grounded = groundCard(pick, type, words);
  assert.ok(grounded, `${type} grounds`);
  const o = { ...grounded, id: `c2-${type}`, place: { x: 120, y: 288, scale: 1 } };
  return { words, pick, o };
}

const selectors = {
  "dm-chat": [".dm-item-0 .dm-copy", ".dm-item-1 .dm-copy", ".dm-item-2 .dm-copy"],
  voicemail: [".vm-copy"],
  "video-call": [".vc-rep .vc-copy", ".vc-prospect .vc-copy"],
  comment: [".comment-copy"],
  "crm-note": [".crm-copy"],
  dialer: [".dial-copy"],
  typing: [".typing-copy"],
  "quick-replies": [".qr-incoming", ".qr-item-0", ".qr-item-1", ".qr-item-2"],
  "call-transcript": [".ct-rep .ct-copy", ".ct-prospect .ct-copy"],
  "lock-screen": [".ls-item-0 .ls-copy", ".ls-item-1 .ls-copy", ".ls-item-2 .ls-copy"],
};

function events(o) {
  const calls = [], tl = {};
  for (const method of ["fromTo", "to", "set"]) tl[method] = (...args) => { calls.push({ method, args }); return tl; };
  new Function("tl", proTimeline([o]))(tl);
  return calls;
}

test("conversation two registers only the ten requested types and preserves existing definitions", () => {
  assert.deepEqual(Object.keys(CARDS), Object.keys(selectors));
  const previous = { ...core, ...distinction, ...procedure, ...conversation, ...warning };
  for (const [type, def] of Object.entries(previous)) {
    assert.equal(registry[type], def, type);
    assert.ok(!(type in CARDS), type);
  }
  assert.ok(Object.keys(registry).length >= Object.keys(previous).length + 10, "the batch adds its ten cards (other batches may add more)");
  for (const [type, def] of Object.entries(CARDS)) assert.equal(registry[type], def);
});

for (const [type, def] of Object.entries(CARDS)) {
  test(`${type} grounds exact speech, fits placement and reveals on each spoken beat`, () => {
    const { o, pick, words } = fixture(type), size = proSize(o);
    assert.equal(def.family, "conversation");
    assert.ok(def.hint.length > 40 && !def.hint.includes("\n"));
    assert.ok(["obsidian", "bone", "bare"].includes(def.surface));
    assert.equal(o.fullscreen, undefined);
    assert.ok(PRO_RECTS.some((rect) => size.w <= rect.w && size.h <= rect.h));
    // Named design: since the 2026-11-28 ghost-editor import some of these types have more designs, and the planner's pick may land on one.
    const { group, ...designed } = groundProOverlay({ type, design: type, slots: pick }, words) || {};
    assert.deepEqual(designed, groundCard(pick, type, words));
    const result = renderProOverlay(o), calls = events(o);
    assert.match(result.html, new RegExp(`pro-overlay pro-${type}`));
    assert.doesNotMatch(result.html + result.timeline, /undefined|NaN/);
    assert.equal(o.phrases.length, selectors[type].length);
    o.phrases.forEach((item, i) => {
      assert.equal(item.text, words.slice(item.from, item.to + 1).map((w) => w.text).join(" "));
      const reveal = calls.find(({ args }) => args[0] === `#${o.id} ${selectors[type][i]}`);
      assert.ok(reveal, selectors[type][i]);
      assert.equal(reveal.method, "fromTo");
      assert.deepEqual(reveal.args[1], { opacity: 0, clipPath: "inset(0 100% 0 0)" });
      assert.equal(reveal.args[2].opacity, 1);
      assert.equal(reveal.args[2].clipPath, "inset(0 0% 0 0)");
      assert.equal(reveal.args[2].duration, PRO_MOTION.enter);
      assert.equal(reveal.args[2].immediateRender, false);
      assert.equal(reveal.args[3], words[item.from].start);
    });
    const exits = calls.filter(({ method }) => method === "to");
    assert.equal(exits.length, 1, "only the panel owns exit motion");
    assert.equal(exits[0].args[0], `#${o.id}`);
    assert.equal(exits[0].args[1].duration, PRO_MOTION.exit);
    for (const { method, args } of calls) {
      if (method !== "fromTo") continue;
      assert.ok([PRO_MOTION.enter, PRO_MOTION.state].includes(args[2].duration));
      assert.equal(args[2].immediateRender, false);
      assert.ok(args[3] >= o.start && args[3] + args[2].duration < o.end - PRO_MOTION.exit);
    }
    assert.doesNotMatch(result.timeline, /repeat|yoyo|rotation|onComplete|onUpdate|Math\.random|innerHTML|textContent/);
  });

  test(`${type} isolates styles and displays only escaped speech plus fixed short headings`, () => {
    const texts = Object.fromEntries(Object.entries(def.slots).map(([name, slot]) => [name, Array(slot.repeat?.[1] || 1).fill("<>&' 7")]));
    const { o } = fixture(type, texts), result = renderProOverlay(o);
    assert.match(result.html, /&lt;&gt;&amp;&#39; 7/);
    assert.doesNotMatch(result.html, /<img|<image|<text|<script|https?:|data:/);
    const visible = result.html.replace(/<[^>]*>/g, "").replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
    assert.deepEqual(visible.match(/\d+/g), o.phrases.map(() => "7"));
    const headings = result.html.split(/<[^>]*>/g).map((s) => s.trim()).filter((s) => s && !s.includes("&lt;"));
    for (const heading of headings) {
      assert.ok(heading.split(/\s+/).length <= 4, heading);
      assert.doesNotMatch(heading, /\d/);
    }
    assert.doesNotMatch(visible, /\b(?:AM|PM|likes|seen|online|yesterday|today)\b|9:41/i);
    for (const rule of def.css.split("}").map((s) => s.trim()).filter(Boolean)) {
      for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) assert.ok(selector.trim().startsWith(`.pro-${type}`), selector);
    }
    assert.ok(proCSS().includes(def.css));
    assert.doesNotMatch(def.css, /glow|gradient|@import|animation:|@keyframes|rotate|url\(/i);
    for (const color of (def.css + result.html).match(/#[\da-f]{6}\b/gi) || []) assert.ok(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"].includes(color), color);
    for (const font of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font[1]));
    for (const selector of selectors[type]) {
      const cls = selector.split(" ").at(-1);
      const rule = def.css.split("}").find((rule) => rule.slice(0, rule.indexOf("{")).includes(cls));
      // Repeated chips use their shared class rather than per-item CSS.
      const initial = rule || def.css.split("}").find((rule) => rule.includes(".qr-chip {"));
      assert.match(initial, /opacity:0/);
      assert.match(initial, /clip-path:inset\(0 100% 0 0\)/);
    }
  });

  test(`${type} rejects fabricated, missing, reversed and oversized spoken ranges`, () => {
    const { pick, words } = fixture(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      assert.equal(slot.kind, "spoken");
      const bad = { text: "invented" };
      assert.equal(groundCard({ ...pick, [name]: slot.repeat ? [bad] : bad }, type, words), null);
      assert.equal(groundCard({ ...pick, [name]: undefined }, type, words), null);
      const invalid = { from: words.length + 1 };
      assert.equal(groundCard({ ...pick, [name]: slot.repeat ? [invalid] : invalid }, type, words), null);
      const tooLong = words.map((w) => ({ ...w, text: "W".repeat(slot.maxChars + 1) }));
      assert.equal(groundCard(pick, type, tooLong), null);
    }
    if (Object.keys(def.slots).length > 1) {
      const [first, second] = Object.keys(def.slots);
      const later = def.slots[second].repeat ? pick[second][0] : pick[second];
      assert.equal(groundCard({ ...pick, [first]: later }, type, words), null);
    }
  });
}

test("threads and notification stacks accept one through three rows and grow with wrapped speech", () => {
  for (const [type, row, base] of [["dm-chat", "dm-bubble", 92], ["lock-screen", "ls-row", 80]]) {
    const long = "Please call me when you have time";
    for (const count of [1, 2, 3]) {
      const { o, pick, words } = fixture(type, { messages: Array(count).fill(long) });
      assert.ok(o.slots.messages.every((item) => item.lines.length === 2));
      assert.equal(proSize(o).h, base + count * 112 + (count - 1) * 12);
      assert.ok(proSize(o).h <= 560);
      assert.equal((renderProOverlay(o).html.match(new RegExp(`class="${row} `, "g")) || []).length, count);
      if (count > 1) assert.equal(groundCard({ messages: pick.messages.toReversed() }, type, words), null);
      for (const messages of [[], Array(4).fill(pick.messages[0])]) assert.equal(groundCard({ messages }, type, words), null);
    }
    assert.deepEqual(proSize(fixture(type, { messages: ["Hello"] }).o), { w: 720, h: 160 });
  }
});

test("quick replies require two or three quoted chips and reserve gold for the last", () => {
  for (const count of [2, 3]) {
    const { o, pick, words } = fixture("quick-replies", { incoming: ["Can you call?"], replies: Array(count).fill("Call at 4?") });
    assert.equal((renderProOverlay(o).html.match(/class="qr-chip /g) || []).length, count);
    const reveals = events(o).filter(({ args }) => / \.qr-item-/.test(args[0]));
    assert.deepEqual(reveals.map(({ args }) => args[3]), o.slots.replies.map((item) => item.at));
    for (const replies of [[], [pick.replies[0]], Array(4).fill(pick.replies[0])]) assert.equal(groundCard({ ...pick, replies }, "quick-replies", words), null);
  }
  assert.match(CARDS["quick-replies"].css, /\.qr-chip:last-child \{[^}]*background:#C8A24B/);
});

test("maximum allowed line counts fit the declared content boxes", () => {
  // Dimensions include padding, borders, labels and gaps, not just the text.
  const layouts = {
    voicemail: { width: 720 - 48, height: 40 + 48 + 12 + 2 * 38 },
    "video-call": { width: (720 - 48 - 16) / 2 - 36, height: 48 + 36 + 136 + 12 + 2 * 42 },
    comment: { width: 720 - 48 - 56 - 40 - 32, height: 48 + 2 + 28 + 8 + 2 * 44 },
    "crm-note": { width: 720 - 48, height: 40 + 28 + 8 + 2 * 40 },
    dialer: { width: 720 - 48, height: 48 + 2 * 44 + 16 + 160 },
    typing: { width: 720 - 64, height: 64 + 2 * 48 },
    "quick-replies": { width: 720 - 48 - 48, height: 48 + 24 + 2 * 44 + 28 + 24 + 24 + 2 * 38 },
    "call-transcript": { width: 720 - 48 - 132 - 16 - 24, height: 48 + 24 + 2 * 2 * 44 },
  };
  for (const [type, layout] of Object.entries(layouts)) {
    const def = CARDS[type];
    assert.ok(layout.height <= def.size.h, `${type} height ${layout.height}`);
    assert.equal(Object.values(def.slots)[0].width, layout.width, `${type} width`);
  }
  assert.equal(CARDS["quick-replies"].slots.replies.width, (720 - 48 - 24) / 3 - 48);
  assert.equal(CARDS["dm-chat"].slots.messages.width, 600 - 36 - 4);
  assert.equal(CARDS["lock-screen"].slots.messages.width, 720 - 48 - 32 - 40 - 16);
});

test("icons are generic inline SVGs and state changes are earned by speech", () => {
  for (const type of Object.keys(CARDS).filter((type) => !["quick-replies", "call-transcript"].includes(type))) {
    const html = renderProOverlay(fixture(type).o).html;
    assert.match(html, /<svg [^>]*viewBox=/);
    for (const tag of html.match(/<svg[^>]*>/g)) assert.match(tag, /aria-hidden="true"/);
  }
  const { o: dial } = fixture("dialer"), keys = events(dial).filter(({ args }) => args[0].endsWith(" .dial-keys circle"));
  assert.equal((renderProOverlay(dial).html.match(/<circle /g) || []).length, 12);
  assert.equal(keys.length, 2);
  assert.deepEqual(keys.map(({ args }) => [args[1].fill, args[2].fill, args[3]]), [["#343438", "#C8A24B", dial.start], ["#C8A24B", "#343438", dial.start + 0.3]]);
  const { o: comment } = fixture("comment"), heart = events(comment).find(({ args }) => args[0].endsWith(" .comment-heart path"));
  assert.equal(heart.args[2].fill, "#C8A24B");
  assert.equal(heart.args[2].duration, PRO_MOTION.state);
  assert.equal(heart.args[3], comment.start);
  const { o: typing } = fixture("typing"), dots = events(typing).find(({ args }) => args[0].endsWith(" .typing-dots"));
  assert.equal((renderProOverlay(typing).html.match(/<circle /g) || []).length, 3);
  assert.equal(dots.args[1].opacity, 1);
  assert.equal(dots.args[2].opacity, 0);
  assert.equal(dots.args[3], typing.start);
  const { o: video } = fixture("video-call"), tiles = events(video).filter(({ args }) => /^#c2-video-call \.vc-(rep|prospect)$/.test(args[0]));
  assert.deepEqual(tiles.map(({ args }) => [args[2].borderColor, args[3]]), [["#C8A24B", video.reveals[0]], ["#C8A24B", video.reveals[1]], ["#343438", video.reveals[1]]]);
  const transcript = renderProOverlay(fixture("call-transcript").o).html;
  assert.match(transcript, />Rep</);
  assert.match(transcript, />Prospect</);
  assert.doesNotMatch(transcript.replace(/<[^>]*>/g, ""), /\d+:\d+/);
});

test("vendored GSAP renders identical states on fresh, reverse and shuffled frame seeks", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap;
  t.after(() => gsap.ticker.sleep());
  const overlays = Object.keys(CARDS).map((type) => fixture(type).o);
  function build() {
    const timeline = gsap.timeline({ paused: true }), elements = new Map(), tl = {};
    t.after(() => timeline.kill());
    for (const method of ["fromTo", "to"]) tl[method] = (selector, ...args) => {
      if (!elements.has(selector)) elements.set(selector, { opacity: selector.endsWith(".typing-dots") ? 1 : args[0].opacity ?? 1, y: 0, fill: "#343438", color: "#A8A49C", borderColor: "#343438", clipPath: "inset(0 100% 0 0)" });
      timeline[method](elements.get(selector), ...args);
      return tl;
    };
    new Function("tl", proTimeline(overlays))(tl);
    const snapshot = (frame) => {
      timeline.totalTime(frame / 30, false);
      return [...elements].map(([selector, el]) => {
        const parent = elements.get(selector.split(" ")[0]);
        if (parent?.opacity === 0 || el.opacity === 0) return null;
        return [selector, el.opacity, el.y, el.fill, el.color, el.borderColor, el.clipPath];
      });
    };
    return { snapshot };
  }
  const { snapshot } = build(), frames = Array.from({ length: 300 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) {
    const frame = i * 137 % frames.length;
    assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`);
  }
  for (const frame of [91, 94, 99, 108, 129, 168, 200]) assert.deepEqual(build().snapshot(frame), forward[frame], `fresh ${frame}`);
});
