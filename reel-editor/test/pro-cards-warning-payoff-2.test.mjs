import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as batch } from "../src/pro-cards/warning-payoff-2.mjs";
import { CARDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, proSize, proPrompt, placeProOverlay, budgetProOverlays, PRO_RECTS, PRO_MOTION, PRO_RULES, proTextWidth } from "../src/pro.mjs";
import { renderProOverlay, proTimeline, proCSS } from "../src/pro-render.mjs";

const cases = {
  "stop-sign": { family: "warning", slot: "mistake", text: "Stop talking over them", labels: ["STOP"], height: 176 },
  "caution-tape": { family: "warning", slot: "warning", text: "Never promise what you cannot deliver", labels: [], height: 1920 },
  "crossed-out": { family: "warning", slot: "habit", text: "Pitching before listening", labels: [], height: 160 },
  trap: { family: "warning", slot: "trap", text: "Trying to win the argument", labels: ["Trap"], height: 176 },
  "marker-highlight": { family: "payoff", slot: "line", text: "Understand before you respond", labels: [], height: 160 },
  newspaper: { family: "payoff", slot: "headline", text: "More talking loses the sale", labels: ["Breaking"], height: 176 },
  seal: { family: "payoff", slot: "promise", text: "I will review your next call", labels: ["Promise"], height: 176 },
  "key-insight": { family: "payoff", slot: "insight", text: "The pause gives them room", labels: [], height: 160 },
  lightbulb: { family: "payoff", slot: "idea", text: "Ask what changed since last time", labels: [], height: 160 },
  "save-this": { family: "payoff", slot: "line", text: "One sentence then pause", labels: ["Save this"], height: 176 },
};

function fixture(type, text = cases[type].text) {
  // Start the selected phrase after an unrelated word so a renderer cannot accidentally use word zero.
  const words = ["Earlier", ...text.split(" ")].map((text, i) => ({ text, start: +(3 + i * 0.12).toFixed(3), end: +(3.1 + i * 0.12).toFixed(3) }));
  const pick = { type, slots: { [cases[type].slot]: { from: 1, to: words.length - 1 } } };
  const grounded = groundCard(pick, type, words);
  assert.ok(grounded, `${type} grounds: ${text}`);
  return { words, pick, grounded, overlay: { ...grounded, id: `test-${type}`, place: { x: grounded.fullscreen ? 0 : 120, y: grounded.fullscreen ? 0 : 288, scale: 1 } } };
}

function events(o) {
  const calls = [], enter = () => {}, state = () => {}, exit = () => {};
  const tl = {
    fromTo(target, from, to, at) { calls.push({ target, from, to, at }); return tl; },
    to(target, to, at) { calls.push({ target, to, at }); return tl; },
  };
  vm.runInNewContext(renderProOverlay(o).timeline, { tl, proEnter: enter, proState: state, proExit: exit });
  return { calls, enter, state, exit };
}

// Keep SVG text in this extraction: STOP and Promise are visible labels too.
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("the ten requested types register with compact sizes and specific planner hints", () => {
  assert.deepEqual(Object.keys(batch), Object.keys(cases));
  for (const [type, def] of Object.entries(batch)) {
    const { overlay, grounded, words, pick } = fixture(type);
    assert.equal(CARDS[type], def);
    assert.equal(def.family, cases[type].family);
    assert.deepEqual(Object.keys(def.slots), [cases[type].slot]);
    assert.equal(def.slots[cases[type].slot].kind, "spoken");
    assert.ok(def.hint.length > 50 && !def.hint.includes("\n"));
    assert.ok(proPrompt(words).includes(`[${def.family}]: ${def.hint}`));
    assert.deepEqual(groundProOverlay(pick, words), grounded);
    assert.deepEqual(proSize(overlay), { w: type === "caution-tape" ? 1080 : 720, h: cases[type].height });
    assert.equal(Boolean(overlay.fullscreen), type === "caution-tape");
    const place = placeProOverlay(overlay, { measured: true, W: 1080, H: 1920, head: { x: 400, y: 600, w: 200, h: 200 } });
    assert.equal(place.slot, overlay.fullscreen ? "full" : "upper");
    assert.equal(place.scale, 1);
    if (!overlay.fullscreen) assert.ok(PRO_RECTS.some((r) => def.size.w <= r.w && def.size.h <= r.h));
    const item = overlay.slots[cases[type].slot][0];
    assert.equal(item.text, cases[type].text);
    assert.equal(item.at, words[1].start);
    assert.deepEqual(overlay.reveals, [item.at]);
    for (const line of item.lines) assert.ok(proTextWidth(line, item.fontSize || def.slots[cases[type].slot].size) <= def.slots[cases[type].slot].width);
    assert.equal(overlay.end, +(overlay.complete + PRO_RULES.hold + PRO_MOTION.exit).toFixed(3));
  }
});

test("only exact spoken copy and fixed short labels are displayed, including spoken numbers", () => {
  for (const [type, { slot, labels }] of Object.entries(cases)) {
    for (const text of [cases[type].text, "Wait 2 minutes", "Wait two minutes"]) {
      const { overlay } = fixture(type, text), html = renderProOverlay(overlay).html;
      let remainder = visible(html);
      for (const label of labels) {
        assert.ok(label.split(/\s+/).length <= 4 && !/\d/.test(label));
        assert.ok(remainder.includes(label), `${type}: ${label}`);
        remainder = remainder.replace(label, "").trim();
      }
      assert.equal(remainder, text, type);
      assert.deepEqual(visible(html).match(/\d+/g) || [], text.match(/\d+/g) || [], type);
      assert.equal(overlay.slots[slot][0].text, text);
    }
    const { overlay } = fixture(type, "<b>& 'test'");
    const html = renderProOverlay(overlay).html;
    assert.match(html, /&lt;b&gt;&amp;/);
    assert.match(html, /&#39;test&#39;/);
    assert.doesNotMatch(html, /<b>/);
  }
});

test("spoken slots reject missing, invented, out-of-range and overlong copy", () => {
  for (const [type, { slot }] of Object.entries(cases)) {
    const { words } = fixture(type);
    for (const bad of [undefined, "made up copy", { from: -1 }, { from: 999 }, { from: 2, to: 1 }, { from: 1.5 }, { from: 1, to: words.length }]) {
      assert.equal(groundCard({ [slot]: bad }, type, words), null, `${type}: ${JSON.stringify(bad)}`);
    }
    const long = [{ text: "x".repeat(batch[type].slots[slot].maxChars + 1), start: 3, end: 4 }];
    assert.equal(groundCard({ [slot]: { from: 0 } }, type, long), null);
  }
});

test("copy writes at its reveal; state changes and the shared panel use the house timings", () => {
  for (const type of Object.keys(cases)) {
    const { overlay } = fixture(type);
    // A later reveal also stays independent of the panel's start when supplied by the renderer.
    overlay.reveals = [overlay.start + 0.5];
    const { calls, enter, state, exit } = events(overlay);
    assert.equal(calls[0].target, `#${overlay.id}`);
    assert.equal(calls[0].at, overlay.start);
    assert.equal(calls[0].from.y, 16);
    assert.equal(calls[0].to.duration, PRO_MOTION.enter);
    assert.equal(calls[0].to.ease, enter);
    const copy = calls.find((c) => c.target === `#${overlay.id} .wp-copy`);
    assert.ok(copy, type);
    assert.equal(copy.from.opacity, 0);
    assert.equal(copy.from.clipPath, "inset(0 100% 0 0)");
    assert.equal(copy.to.opacity, 1);
    assert.equal(copy.to.clipPath, "inset(0 0% 0 0)");
    assert.equal(copy.to.duration, PRO_MOTION.enter);
    assert.equal(copy.to.ease, enter);
    for (const call of calls.slice(1, -1)) {
      assert.equal(call.at, overlay.reveals[0]);
      assert.equal(call.to.immediateRender, false);
      if (call !== copy) {
        assert.equal(call.to.duration, PRO_MOTION.state);
        assert.equal(call.to.ease, state);
      }
      assert.ok(!("rotation" in call.to) && !("x" in call.to) && !("y" in call.to));
    }
    assert.equal(calls.at(-1).target, `#${overlay.id}`);
    assert.equal(calls.at(-1).to.duration, PRO_MOTION.exit);
    assert.equal(calls.at(-1).to.ease, exit);
    assert.equal(calls.at(-1).at, +(overlay.end - PRO_MOTION.exit).toFixed(3));
    assert.match(batch[type].css, /\.wp-copy \{[^}]*opacity:0;clip-path:inset\(0 100% 0 0\)/);
    assert.doesNotMatch(renderProOverlay(overlay).timeline, /repeat|yoyo|onUpdate|onComplete|Math\.random|innerHTML|textContent|rotation/);
  }
});

test("SVG accents draw or light at the spoken word without fabricated claims", () => {
  const draws = { "stop-sign": ".wp-rim", "crossed-out": ".wp-cross path", trap: ".wp-rope", "marker-highlight": ".wp-marker path", seal: ".wp-ring", "key-insight": ".wp-teeth" };
  for (const [type, selector] of Object.entries(draws)) {
    const { overlay } = fixture(type), { calls } = events(overlay);
    const draw = calls.find((c) => c.target === `#${overlay.id} ${selector}`);
    assert.equal(draw.from.strokeDashoffset, 1);
    assert.equal(draw.to.strokeDashoffset, 0);
    assert.match(renderProOverlay(overlay).html, /pathLength="1"/);
    assert.match(batch[type].css, /stroke-dasharray:1;stroke-dashoffset:1/);
  }
  const bulb = fixture("lightbulb").overlay, bulbCalls = events(bulb).calls;
  const glass = bulbCalls.find((c) => c.target.endsWith(" .wp-glass"));
  assert.equal(glass.from.fill, "#343438");
  assert.equal(glass.to.fill, "#C8A24B");
  const rays = bulbCalls.find((c) => c.target.endsWith(" .wp-rays"));
  assert.equal(rays.from.opacity, 0);
  assert.equal(rays.to.opacity, 1);
  const bookmark = events(fixture("save-this").overlay).calls.find((c) => c.target.endsWith(" .wp-ribbon"));
  assert.equal(bookmark.from.fill, "#0B0B0D");
  assert.equal(bookmark.to.fill, "#C8A24B");
  assert.match(batch.newspaper.css, /\.wp-copy \{ font:400 44px\/48px "Anton"/);
  const cross = renderProOverlay(fixture("crossed-out").overlay).html;
  assert.equal((cross.match(/<path /g) || []).length, 2);
});

test("the marker preserves fitted lines and reduced type while sweeping behind each line", () => {
  const { overlay } = fixture("marker-highlight", Array(8).fill("WWWW").join(" "));
  const item = overlay.slots.line[0], html = renderProOverlay(overlay).html;
  assert.equal(item.lines.length, 2);
  assert.ok(item.fontSize < batch["marker-highlight"].slots.line.size);
  assert.equal((html.match(/class="wp-marker"/g) || []).length, item.lines.length);
  assert.equal((html.match(/class="wp-copy"/g) || []).length, item.lines.length);
  assert.equal((html.match(new RegExp(`font-size:${item.fontSize}px`, "g")) || []).length, item.lines.length);
  assert.equal(visible(html), item.text);
  assert.match(batch["marker-highlight"].css, /\.wp-marker \{ position:absolute/);
  assert.match(batch["marker-highlight"].css, /\.wp-copy \{ position:relative/);
});

test("all new CSS is scoped, uses the brand palette and leaves existing selector names alone", () => {
  const palette = ["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"];
  const css = proCSS();
  for (const [type, def] of Object.entries(batch)) {
    for (const rule of def.css.split("}").filter((r) => r.trim())) {
      for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) {
        assert.match(selector.trim(), new RegExp(`^\\.pro-${type}(?:[ .:]|$)`));
      }
    }
    assert.ok(css.includes(def.css));
    const html = renderProOverlay(fixture(type).overlay).html;
    if (type !== "newspaper") assert.match(html, /<svg\b/);
    assert.doesNotMatch(html, /<img|<image|<use|[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(def.css, /url\(|glow|blur\(|@keyframes|animation:|text-shadow|rotate\(/);
    for (const color of def.css.match(/#[\da-f]{6}/gi) || []) assert.ok(palette.includes(color), color);
    for (const font of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font[1]));
    assert.ok(["obsidian", "bone", "bare"].includes(def.surface));
  }
});

test("caution tape reserves one fullscreen reading moment and keeps the rest transparent", () => {
  const { overlay, words } = fixture("caution-tape", "Do not guess"), def = batch["caution-tape"];
  assert.equal(def.surface, "bare");
  assert.match(renderProOverlay(overlay).html, /pro-bare pro-full/);
  assert.match(def.css, /\.pro-caution-tape\.pro-full \{ padding:0;background:none;box-shadow:none/);
  assert.match(def.css, /left:150px;top:170px;width:780px/, "inside the 150 px side strips (the shared safe zone)");
  assert.equal((renderProOverlay(overlay).html.match(/class="wp-stripes"/g) || []).length, 2);
  assert.match(proPrompt(words), /caution-tape.*FULL SCREEN/);
  assert.equal(budgetProOverlays([overlay], { duration: 30 }).length, 1);
  const second = { ...overlay, start: 12, end: 15, duration: 3 };
  assert.equal(budgetProOverlays([overlay, second], { duration: 30 }).length, 1);
  assert.equal(budgetProOverlays([{ ...overlay, end: overlay.start + 4.501, duration: 4.501 }], { duration: 30 }).length, 0);
});

test("vendored GSAP gives identical states when seeking forward, backward or out of order", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true }), elements = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const tl = {};
  for (const method of ["fromTo", "to"]) tl[method] = (selector, ...args) => {
    if (!elements.has(selector)) elements.set(selector, { opacity: /wp-copy|wp-rays/.test(selector) || !selector.includes(" ") ? 0 : 1, clipPath: "inset(0 100% 0 0)", strokeDashoffset: 1, y: 0, fill: selector.endsWith(" .wp-glass") ? "#343438" : "#0B0B0D" });
    timeline[method](elements.get(selector), ...args);
    return tl;
  };
  new Function("tl", proTimeline(Object.keys(cases).map((type) => fixture(type).overlay)))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...elements].map(([selector, el]) => [selector, ...["opacity", "clipPath", "strokeDashoffset", "y", "fill"].map((k) => el[k])]);
  };
  const frames = Array.from({ length: 241 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) {
    const frame = i * 137 % frames.length;
    assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`);
  }
});
