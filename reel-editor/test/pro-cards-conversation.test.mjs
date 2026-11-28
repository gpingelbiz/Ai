import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS } from "../src/pro-cards/conversation.mjs";
import { CARDS as registry } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, proSize, PRO_RECTS, PRO_MOTION, PRO_RULES } from "../src/pro.mjs";
import { renderProOverlay, proTimeline, proCSS } from "../src/pro-render.mjs";

const phrases = ["Not now", "Call at 4?", "Thanks", "New lead", "Quick question", "Can we talk", "I need help", "Where is that belief from?", "Hey I need help", "how to slow down", "Strategy call", "21", "Thursday at 4", "Permission to talk", "They answer"];
const words = [], ranges = phrases.map((phrase) => {
  const from = words.length;
  for (const text of phrase.split(" ")) {
    const start = +(3 + words.length * 0.4).toFixed(3);
    words.push({ text, start, end: +(start + 0.3).toFixed(3) });
  }
  return { from, to: words.length - 1 };
});
const picks = {
  "text-thread": { messages: ranges.slice(0, 3) },
  "incoming-call": { caller: ranges[3] },
  email: { subject: ranges[4], preview: ranges[5] },
  notification: { message: ranges[6] },
  "ask-this": { question: ranges[7] },
  "script-highlight": { line: ranges[8] },
  "search-bar": { query: ranges[9] },
  calendar: { event: ranges[10], date: ranges[11], details: ranges[12] },
  unlock: { payoff: ranges[13] },
  "green-flag": { signal: ranges[14] },
};
const selectors = {
  "text-thread": [".thread-bubble-0 .thread-copy", ".thread-bubble-1 .thread-copy", ".thread-bubble-2 .thread-copy"],
  "incoming-call": [".call-copy"],
  email: [".email-subject", ".email-preview"],
  notification: [".notice-copy"],
  "ask-this": [".ask-copy"],
  "script-highlight": [".script-copy"],
  "search-bar": [".search-query"],
  calendar: [".calendar-event", ".calendar-date", ".calendar-details"],
  unlock: [".unlock-copy"],
  "green-flag": [".flag-copy"],
};
const placed = (type, pick = picks[type], transcript = words) => {
  const o = groundCard(pick, type, transcript);
  assert.ok(o, `${type} grounds`);
  return { ...o, id: `conversation-${type}`, place: { x: 120, y: 288, scale: 1 } };
};
const events = (o) => {
  const calls = [], tl = {};
  for (const method of ["fromTo", "to"]) tl[method] = (...args) => { calls.push({ method, args }); return tl; };
  new Function("tl", proTimeline([o]))(tl);
  return calls;
};

test("conversation batch registers exactly the ten approved types", () => {
  assert.deepEqual(Object.keys(CARDS), Object.keys(picks));
  for (const [type, def] of Object.entries(CARDS)) assert.equal(registry[type], def);
});

for (const [type, def] of Object.entries(CARDS)) {
  test(`${type} grounds exact slots, fits a placement rectangle and reveals every spoken item`, () => {
    assert.equal(def.family, ["calendar", "unlock", "green-flag"].includes(type) ? "payoff" : "conversation");
    assert.ok(def.hint && !def.hint.includes("\n"));
    assert.ok(["bone", "obsidian", "bare"].includes(def.surface));
    for (const slot of Object.values(def.slots)) {
      assert.equal(slot.kind, "spoken");
      assert.ok(slot.width > 0 && slot.size > 0 && slot.maxChars > 0 && slot.maxLines > 0);
    }
    const o = placed(type), result = renderProOverlay(o);
    // Named design: since the 2026-11-28 ghost-editor import some of these types have more designs, and the planner's pick may land on one.
    const { group, ...designed } = groundProOverlay({ type, design: type, slots: picks[type] }, words) || {};
    assert.deepEqual(designed, groundCard(picks[type], type, words));
    assert.deepEqual(proSize(o), def.size);
    assert.ok(PRO_RECTS.some((rect) => def.size.w <= rect.w && def.size.h <= rect.h));
    assert.equal(o.fullscreen, undefined);
    assert.equal(o.reveals.length, selectors[type].length);
    assert.match(result.html, new RegExp(`pro-overlay pro-${type}`));
    assert.equal(result.html.includes("pro-bone"), def.surface === "bone");
    assert.doesNotMatch(result.html, /undefined|NaN/);
    assert.doesNotThrow(() => new vm.Script(proTimeline([o])));
    const calls = events(o);
    o.phrases.forEach((p, i) => {
      assert.equal(p.text, words.slice(p.from, p.to + 1).map((w) => w.text).join(" "));
      assert.equal(o.reveals[i], words[p.from].start);
      const reveal = calls.find(({ method, args }) => method === "fromTo" && args[0] === `#${o.id} ${selectors[type][i]}`);
      assert.ok(reveal, `${type}: ${selectors[type][i]}`);
      assert.equal(reveal.args[1].opacity, 0);
      assert.equal(reveal.args[1].clipPath, "inset(0 100% 0 0)");
      assert.equal(reveal.args[2].opacity, 1);
      assert.equal(reveal.args[2].clipPath, "inset(0 0% 0 0)");
      assert.equal(reveal.args[2].duration, PRO_MOTION.enter);
      assert.equal(reveal.args[2].immediateRender, false);
      assert.equal(reveal.args[3], o.reveals[i]);
    });
    assert.ok(Math.abs(o.end - PRO_MOTION.exit - o.complete - PRO_RULES.hold) < 0.002);
    assert.match(result.timeline, /duration:0\.167,ease:proExit/);
    assert.doesNotMatch(result.timeline, /repeat|yoyo|onComplete|onUpdate|Math\.random|textContent|innerHTML/);
  });

  test(`${type} keeps styles scoped, escapes speech and rejects overflowing or fabricated copy`, () => {
    for (const rule of def.css.split("}").map((rule) => rule.trim()).filter(Boolean)) {
      for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) assert.ok(selector.trim().startsWith(`.pro-${type}`), selector);
    }
    assert.ok(proCSS().includes(def.css));
    assert.doesNotMatch(def.css, /glow|gradient|@import|animation:|@keyframes|Caveat|emoji/i);
    const palette = ["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"];
    for (const color of def.css.match(/#[\da-f]{3,8}/gi) || []) assert.ok(palette.includes(color), color);
    const unsafeWords = [], pick = {};
    for (const [name, slot] of Object.entries(def.slots)) {
      const items = Array.from({ length: slot.repeat?.[1] || 1 }, () => {
        const from = unsafeWords.length;
        unsafeWords.push({ text: "<>&'", start: 3 + from, end: 3.4 + from });
        return { from };
      });
      pick[name] = slot.repeat ? items : items[0];
    }
    const result = renderProOverlay(placed(type, pick, unsafeWords));
    assert.match(result.html, /&lt;&gt;&amp;&#39;/);
    assert.doesNotMatch(result.html, /<b>|undefined|NaN/);
    const name = Object.keys(def.slots)[0];
    const bad = { ...picks[type], [name]: def.slots[name].repeat ? [{ text: "made up" }] : { text: "made up" } };
    assert.equal(groundCard(bad, type, words), null);
    const long = [{ text: "W".repeat(100), start: 3, end: 4 }];
    assert.equal(groundCard({ [name]: def.slots[name].repeat ? [{ from: 0 }] : { from: 0 } }, type, long), null);
  });
}

test("text threads accept only one to three ordered messages and allocate room for every line", () => {
  const slot = CARDS["text-thread"].slots.messages;
  const height = 64 + 36 + 16 + 3 * (slot.maxLines * 52 + 32) + 2 * 12;
  assert.ok(height <= CARDS["text-thread"].size.h);
  for (const count of [1, 2, 3]) {
    const o = placed("text-thread", { messages: ranges.slice(0, count) });
    assert.equal(o.reveals.length, count);
    assert.equal((renderProOverlay(o).html.match(/class="thread-copy"/g) || []).length, count);
    assert.equal(events(o).filter(({ args }) => String(args[0]).endsWith(" .thread-copy")).length, count);
  }
  for (const messages of [[], ranges.slice(0, 4), [ranges[1], ranges[0]]]) assert.equal(groundCard({ messages }, "text-thread", words), null);
});

test("email preview and calendar date/details are optional and keep their own reveal times", () => {
  const email = placed("email", { subject: ranges[4] });
  assert.doesNotMatch(renderProOverlay(email).html, /class="email-preview"/);
  assert.equal(email.reveals.length, 1);
  for (const date of [false, true]) for (const details of [false, true]) {
    const pick = { event: ranges[10], ...(date ? { date: ranges[11] } : {}), ...(details ? { details: ranges[12] } : {}) };
    const o = placed("calendar", pick), result = renderProOverlay(o), calls = events(o);
    assert.equal(result.html.includes('class="calendar-date"'), date);
    assert.equal(result.html.includes('class="calendar-details"'), details);
    assert.equal(o.reveals.length, 1 + Number(date) + Number(details));
    if (date) assert.match(result.html, />21</);
    if (details) {
      const reveal = calls.find(({ args }) => String(args[0]).endsWith(" .calendar-details"));
      assert.equal(reveal.args[3], words[ranges[12].from].start);
    }
    const tick = calls.find(({ args }) => String(args[0]).endsWith(" .calendar-check path"));
    assert.equal(tick.args[3], o.reveals.at(-1));
    if (!date && !details) assert.doesNotMatch(result.html.replace(/<[^>]*>/g, ""), /\d/);
  }
});

test("cards show numbers only from spoken ranges and never add mockup metadata", () => {
  for (const type of Object.keys(CARDS)) {
    const o = placed(type), text = renderProOverlay(o).html.replace(/<[^>]*>/g, "");
    const spoken = o.phrases.map((p) => p.text).join(" ");
    assert.deepEqual(text.match(/\d+/g) || [], spoken.match(/\d+/g) || [], type);
    assert.doesNotMatch(text, /9:41|LINE 2|30 min|today|typing/i);
  }
});

test("notification drops from above and SVG icons change state on the spoken beat", () => {
  const notice = placed("notification");
  const calls = events(notice), panel = calls.find(({ args }) => args[0] === `#${notice.id}`);
  const drop = calls.find(({ args }) => args[0] === `#${notice.id} .notice-frame`);
  assert.equal(panel.args[1].y + drop.args[1].y, -16);
  assert.equal(panel.args[2].y + drop.args[2].y, 0);
  assert.equal(drop.args[2].duration, panel.args[2].duration);
  assert.equal(drop.args[2].ease(0.5), panel.args[2].ease(0.5));
  assert.equal(drop.args[3], notice.start);
  for (const [type, selector] of [["incoming-call", ".call-handset"], ["script-highlight", ".script-mark"], ["unlock", ".lock-shackle"], ["green-flag", ".flag-cloth"]]) {
    const o = placed(type), state = events(o).find(({ args }) => args[0] === `#${o.id} ${selector}`);
    assert.ok(state, type);
    assert.equal(state.args[2].duration, PRO_MOTION.state);
    assert.equal(state.args[2].immediateRender, false);
    assert.equal(state.args[3], o.reveals[0]);
    assert.match(renderProOverlay(o).timeline, /ease:proState/);
  }
  for (const type of ["incoming-call", "notification", "ask-this", "search-bar", "calendar", "unlock", "green-flag"]) assert.match(renderProOverlay(placed(type)).html, /<svg [^>]*viewBox=/);
});

test("script highlighter prebuilds a separate sweep behind each wrapped spoken line", () => {
  const transcript = "Hey I need help with something real fast".split(" ").map((text, i) => ({ text, start: 3 + i * 0.4, end: 3.3 + i * 0.4 }));
  const o = placed("script-highlight", { line: { from: 0, to: transcript.length - 1 } }, transcript);
  const lines = o.slots.line[0].lines;
  assert.ok(lines.length > 1);
  const html = renderProOverlay(o).html;
  assert.equal((html.match(/class="script-mark"/g) || []).length, lines.length);
  assert.equal((html.match(/class="script-copy"/g) || []).length, lines.length);
  for (const line of lines) assert.ok(html.includes(line));
});

test("vendored GSAP keeps all card states deterministic under forward, reverse and shuffled seeks", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true });
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const elements = new Map(), tl = {};
  for (const method of ["fromTo", "to"]) tl[method] = (selector, ...args) => {
    if (!elements.has(selector)) elements.set(selector, { opacity: args[0].opacity ?? 1, y: 0, rotation: 0, strokeDashoffset: 1, clipPath: "inset(0 100% 0 0)" });
    timeline[method](elements.get(selector), ...args);
    return tl;
  };
  const overlays = Object.keys(CARDS).map((type) => placed(type));
  new Function("tl", proTimeline(overlays))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...elements].map(([selector, el]) => {
      const parent = elements.get(selector.split(" ")[0]);
      if (parent?.opacity === 0 || el.opacity === 0) return null;
      return [selector, el.opacity, el.y, el.rotation, el.strokeDashoffset, el.clipPath];
    });
  };
  const frames = Array.from({ length: 720 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) { const frame = i * 137 % frames.length; assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`); }
});
