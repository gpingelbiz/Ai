import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as BATCH } from "../src/pro-cards/herk-vstat.mjs";
import { CARDS, rootOf, tagsOf } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, PRO_MOTION, PRO_RECTS, proSize } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { fixturePlan } from "../scripts/golden.mjs";

const fixtures = {
  "stat-disc": { value: "4.2M", context: "calls tracked" },
  "stat-unit-slab": { value: "9", unit: "out of ten", context: "coaches followed up" },
  "percent-bar": { value: "73%", context: "of leads booked" },
  "ratio-stack": { share: "one", total: "200", context: "calls reached a buyer" },
  "percent-waffle": { value: "73%", context: "of reps kept the script" },
  "ranked-bar-rows": { heading: "Lead sources", items: ["Referrals 55%", "forty percent from ads", "Email 5%"] },
  "filled-arc-gauge": { value: "fifty percent", context: "of coaches stuck with it" },
  "percent-wedge": { value: "73%", context: "of sales came from referrals" },
  "multiplier-discs": { value: "four times", group: "coached reps", baseline: "new reps" },
  "measured-stamp": { value: "73%", context: "of my clients renewed" },
  "price-tag-cost": { heading: "Subscription cost", loss: "$47 a month", consequence: "for software you never use" },
  "turnaround-page": { value: "21 days", context: "to get the first booking" },
  "qualified-stat": { value: "75%", context: "of clients came back", caveat: "only counting paid trials" },
  "stat-window": { value: "38M", context: "calls reviewed" },
  "metric-delta-chip": { before: "20%", after: "40%", label: "close rate" },
  "rating-cell-strip": { heading: "Call quality", score: "5 out of 7" },
  "ratio-step-blocks": { share: "7", total: "10", context: "pipeline stages cleared" },
  "ratio-people-icons": { share: "two", total: "three", context: "prospects booked a call" },
  "rank-ribbon": { value: "number one", context: "in referral bookings" },
  "metric-faceoff": { before: "9 hours", after: "12 minutes", label: "time needed to prep calls" },
  "relative-time-pin": { start: "day zero", end: "day thirty", point: "day ten", context: "the next call happens" },
  "stat-leaders": { value: "2,000", notes: ["from paid trials", "also includes renewals", "inbound calls only"] },
};

function input(type, overrides = {}) {
  const copy = { ...fixtures[type], ...overrides }, words = [], pick = { type };
  function range(value) {
    const from = words.length;
    for (const text of value.split(/\s+/)) {
      const start = 3 + words.length / 4;
      words.push({ text, start, end: start + 0.2 });
    }
    return { from, to: words.length - 1 };
  }
  for (const [name, slot] of Object.entries(BATCH[type].slots)) {
    if (copy[name] == null) continue;
    pick[name] = slot.kind === "label" ? copy[name] : slot.repeat ? copy[name].map(range) : range(copy[name]);
  }
  return { words, pick, copy };
}

function ground(type, overrides) {
  const { words, pick } = input(type, overrides);
  return groundCard(pick, type, words);
}

function fixture(type, overrides) {
  const o = ground(type, overrides);
  assert.ok(o, `${type} ${JSON.stringify(overrides)}`);
  return { ...o, id: `vstat-${type}`, place: { x: 180, y: 260, scale: 1 } };
}

function render(type, overrides) {
  const o = fixture(type, overrides), calls = [], tl = {};
  for (const method of ["fromTo", "to", "set"]) {
    tl[method] = (...args) => { calls.push({ method, args }); return tl; };
  }
  new Function("tl", proTimeline([o]))(tl);
  return { ...renderProOverlay(o), calls, o };
}

const callFor = (r, selector) => r.calls.find(({ args }) => args[0] === `#${r.o.id} ${selector}`);
const displayText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("all source ids are triaged once and every built design carries its complete provenance", () => {
  const names = "circle giant-left bar fraction odometer over-photo ledger dot-grid arc-gauge versus callout stacked-bars column-chart semi-gauge pie-slice circle-pack stamp receipt price-tag postage calendar quote footnote bracket multiplier trend-delta torn corner-bleed ticker-tape map spotlight linear-meter heat-strip progress-steps isotype timeline-point rank-banner annotated engraving window magnifier".split(" ");
  const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/herk-triage-vstat.json", import.meta.url), "utf8"));
  assert.deepEqual(triage.map((entry) => entry.id), names.map((name) => `vox-explainer.t1.stat.${name}`));
  for (const { id, outcome, type, reason } of triage) {
    assert.ok(["new", "variant", "merged", "duplicate", "unfit"].includes(outcome), id);
    assert.ok(reason.length > 20 && !reason.includes("\n"), id);
    if (outcome === "unfit") assert.equal(type, undefined, id);
    else if (outcome === "duplicate") assert.ok(CARDS[type] && !BATCH[type], id);
    else assert.ok(BATCH[type].source.slice(5).split(",").includes(id), id);
  }
  for (const [type, def] of Object.entries(BATCH)) {
    const entries = triage.filter((entry) => entry.type === type);
    assert.equal(entries.filter(({ outcome }) => outcome === (def.variantOf ? "variant" : "new")).length, 1, type);
    assert.deepEqual(def.source.slice(5).split(",").sort(), entries.map(({ id }) => id).sort(), type);
  }
});

test("new designs register through their roots and fit normal on-footage placement", () => {
  assert.deepEqual(Object.keys(BATCH), Object.keys(fixtures));
  const frame = { measured: true, W: 1080, H: 1920, head: { x: 300, y: 890, w: 500, h: 400 } };
  const safe = zoneFor();
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(CARDS[type], def);
    assert.ok(tagsOf(type).length >= 1 && tagsOf(type).length <= 3, type);
    assert.ok(CARDS[rootOf(type)].hint.length > 40);
    assert.ok(!def.fullscreen);
    const { words, pick, copy } = input(type);
    const o = fixture(type);
    const selected = groundProOverlay({ ...pick, type: rootOf(type), design: type }, words);
    assert.equal(selected?.type, type);
    assert.deepEqual(o.slots, selected.slots);
    for (const [name, slot] of Object.entries(def.slots)) {
      assert.deepEqual(o.slots[name].map(({ text }) => text), slot.repeat ? copy[name] : [copy[name]]);
    }
    assert.deepEqual(o.reveals, o.phrases.map(({ from }) => words[from].start));
    const size = proSize(o);
    assert.ok(PRO_RECTS.some((rect) => size.w <= rect.w && size.h <= rect.h), type);
    const place = placeProOverlay(o, frame);
    assert.ok(place, type);
    assert.ok(place.x >= safe.left && place.x + place.w <= rightLimit(safe, place.y, place.y + place.h), type);
    assert.ok(place.y >= safe.top && place.y + place.h <= safe.bottom, type);

    // Check the height budget for the most lines and items the contract even permits.
    const slots = Object.fromEntries(Object.entries(def.slots).map(([name, slot]) =>
      [name, Array.from({ length: slot.repeat?.[1] || 1 }, () => ({ text: "W".repeat(120), lines: Array(slot.maxLines).fill("Word") }))]));
    const worst = proSize({ ...o, slots });
    assert.ok(worst.w <= 720 && worst.h <= 560, `${type} max ${worst.w}x${worst.h}`);
  }
});

test("the planner can request a variant and fall back when its chart cannot represent the input", () => {
  const { words, pick } = input("percent-bar", { value: "12.5%" });
  const o = groundProOverlay({ ...pick, type: "percent-ring", design: "percent-waffle" }, words);
  assert.ok(o);
  assert.notEqual(o.type, "percent-waffle");
  assert.equal(o.group, "percent-ring");
  assert.equal(o.slots.value[0].text, "12.5%");
});

test("required word ranges, repeat counts, copy limits and labels are enforced", () => {
  for (const [type, def] of Object.entries(BATCH)) {
    const { words, pick } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      if (!slot.optional) assert.equal(groundCard({ ...pick, [name]: undefined }, type, words), null, `${type}.${name}`);
      if (slot.kind === "label") {
        for (const label of ["Lead source 2", "a b c d e", "m".repeat(slot.maxChars + 1)]) {
          assert.equal(ground(type, { [name]: label }), null, `${type}.${name}`);
        }
        continue;
      }
      for (const value of ["made up 99", { text: "99" }, { from: -1 }, { from: words.length }]) {
        assert.equal(groundCard({ ...pick, [name]: slot.repeat ? Array(slot.repeat[0]).fill(value) : value }, type, words), null, `${type}.${name}`);
      }
      const tooLong = "W".repeat(slot.maxChars + 1);
      assert.equal(ground(type, { [name]: slot.repeat ? Array(slot.repeat[0]).fill(tooLong) : tooLong }), null);
    }
  }
  assert.equal(ground("ranked-bar-rows", { items: ["Ads 10%"] }), null);
  assert.equal(ground("stat-leaders", { notes: Array(4).fill("repeat note") }), null);
  assert.equal(ground("stat-unit-slab", { value: "9999999" }), null, "short copy must still fit the width");
});

test("numeric validators reject ranges, mismatched units, missing totals and invalid chart values", () => {
  for (const value of ["many", "10 or 20", "3/7", "1,2", "1e3", "twenty ten", "one hundred and", "$20 percent", "<b>20</b>"]) {
    assert.equal(ground("stat-window", { value }), null, value);
  }
  for (const value of ["73", "101%", "-1%", "10 to 20 percent", "seventy percent off"]) {
    for (const type of ["percent-bar", "percent-waffle", "filled-arc-gauge", "percent-wedge"]) {
      assert.equal(ground(type, { value }), null, `${type} ${value}`);
    }
  }
  assert.equal(ground("percent-waffle", { value: "12.5%" }), null);
  assert.ok(ground("percent-bar", { value: "twelve point five percent" }));
  assert.ok(ground("percent-bar", { value: "seventy-three percent" }));
  assert.equal(ground("ratio-stack", { share: "9", total: "8" }), null);
  assert.equal(ground("ratio-stack", { share: "0", total: "0" }), null);
  assert.equal(ground("ratio-step-blocks", { total: "11" }), null);
  assert.equal(ground("ratio-people-icons", { context: "stages complete" }), null);
  assert.equal(ground("ratio-step-blocks", { context: "clients bought" }), null);
  assert.equal(ground("rating-cell-strip", { score: "5" }), null);
  assert.equal(ground("rating-cell-strip", { score: "8 of 7" }), null);
  assert.equal(ground("ranked-bar-rows", { items: ["7 to 12 percent", "Emails 8%"] }), null);
  assert.equal(ground("ranked-bar-rows", { items: ["Sales 10% vs 20%", "Emails 8%"] }), null);
  assert.equal(ground("multiplier-discs", { value: "12" }), null);
  assert.equal(ground("price-tag-cost", { loss: "47" }), null);
  assert.equal(ground("turnaround-page", { value: "11/27/26" }), null);
  assert.equal(ground("metric-delta-chip", { after: "40" }), null);
  assert.equal(ground("metric-delta-chip", { after: "20%" }), null);
  assert.equal(ground("metric-faceoff", { after: "40%" }), null);
  assert.equal(ground("relative-time-pin", { point: "day forty" }), null);
  assert.equal(ground("relative-time-pin", { end: "week thirty" }), null);
  assert.equal(ground("relative-time-pin", { start: "2026", end: "2028", point: "2027" }), null);
  assert.equal(ground("rank-ribbon", { value: "12" }), null);
});

test("all spoken items write in at their own reveal with seekable house motion", () => {
  for (const type of Object.keys(BATCH)) {
    const r = render(type), visible = displayText(r.html);
    for (const [name, slot] of Object.entries(BATCH[type].slots)) {
      for (const [i, item] of r.o.slots[name].entries()) {
        assert.ok(visible.includes(item.text), `${type} ${item.text}`);
        if (slot.kind !== "spoken") continue;
        const selector = `.vs-${name}${slot.repeat ? `-${i}` : ""}`;
        const reveal = callFor(r, selector);
        assert.ok(reveal, `${type} ${selector}`);
        const [, from, to, at] = reveal.args;
        assert.equal(at, item.at, selector);
        assert.equal(from.opacity, 0, selector);
        assert.match(from.clipPath, /100%/);
        assert.equal(to.opacity, 1, selector);
        assert.equal(to.duration, PRO_MOTION.enter, selector);
        assert.equal(to.immediateRender, false, selector);
      }
    }
    for (const { method, args } of r.calls) {
      if (method !== "fromTo") continue;
      const [, , to] = args;
      assert.ok([PRO_MOTION.enter, PRO_MOTION.state].includes(to.duration), type);
      assert.equal(typeof to.ease, "function", type);
      assert.equal(to.immediateRender, false, type);
    }
    assert.doesNotMatch(r.timeline, /Math\.random|\bDate\b|\brotation\b|back\.out|steps\(/);
  }
});

test("marks reflect the supplied data without emitting extra numbers", () => {
  for (const [value, fraction] of [["0%", 0], ["twelve point five percent", 0.125], ["100%", 1]]) {
    const r = render("percent-bar", { value });
    assert.equal(callFor(r, ".vs-fill").args[2].scaleX, fraction);
    assert.equal(callFor(r, ".vs-notch").args[2].x, Math.round(fraction * 646 * 1000) / 1000);
    assert.equal(displayText(r.html), `${value} of leads booked`);
  }
  const waffle = render("percent-waffle", { value: "23%" });
  assert.equal((waffle.html.match(/<circle\b/g) || []).length, 100);
  assert.equal(waffle.calls.filter(({ args }) => args[0].includes("nth-child")).length, 3);
  assert.ok(callFor(waffle, ".vs-dots circle:nth-child(n+21):nth-child(-n+23)"));
  assert.equal(render("percent-waffle", { value: "0%" }).calls.filter(({ args }) => args[0].includes("nth-child")).length, 0);
  assert.ok(callFor(render("percent-waffle", { value: "100%" }), ".vs-dots circle:nth-child(n+91):nth-child(-n+100)"));
  assert.match(render("percent-wedge", { value: "100%" }).html, /circle class="vs-sector"/);
  assert.doesNotMatch(render("percent-wedge", { value: "0%" }).html, /class="vs-sector"/);
  assert.equal(displayText(render("percent-wedge").html), "73% of sales came from referrals");
  const arc = render("filled-arc-gauge", { value: "60%" });
  assert.equal(callFor(arc, ".vs-line").args[2].strokeDashoffset, 0.4);
  for (const type of ["ratio-step-blocks", "ratio-people-icons"]) {
    const r = render(type, { share: "2", total: "3" });
    assert.equal((r.html.match(/class="vs-mark /g) || []).length, 3);
    assert.equal(callFor(r, ".vs-mark:nth-child(-n+2)").args[3], r.o.slots.total[0].at);
  }
  const discs = render("multiplier-discs");
  assert.match(discs.html, /r="59"/);
  assert.match(discs.html, /r="29\.5"/);
  const rows = render("ranked-bar-rows");
  assert.equal(callFor(rows, ".vs-fill-1").args[2].scaleX, 0.4);
  const pin = render("relative-time-pin");
  assert.match(pin.html, /cx="222"/);
  assert.equal(callFor(pin, ".vs-pin").args[3], pin.o.slots.point[0].at);
  assert.match(render("metric-delta-chip", { before: "60%", after: "20%" }).html, /M12 21 28 37l16-16/);
  assert.ok(callFor(render("rating-cell-strip"), ".vs-cell:nth-child(5)"));
});

test("all card copy is escaped and CSS uses the scoped house palette and reading sizes", () => {
  const palette = new Set(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"]);
  for (const [type, def] of Object.entries(BATCH)) {
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css));
    for (const [, selectors] of def.css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of selectors.trim().split(",").map((s) => s.trim())) {
        assert.ok(selector === `.pro-${type}` || selector.startsWith(`.pro-${type} `), selector);
      }
    }
    for (const [value] of def.css.matchAll(/#[\da-f]+/gi)) assert.ok(palette.has(value), value);
    assert.deepEqual([...new Set([...def.css.matchAll(/"([^"]+)"/g)].map((m) => m[1]))], ["Inter", "Anton"]);
    assert.match(def.css, /40px\/48px "Inter"/);
    assert.match(def.css, /96px\/104px "Anton"/);
    assert.match(def.css, /28px\/34px "Inter"/);
    assert.doesNotMatch(def.css, /glow|blur\(|gradient|background-image|@keyframes/i);
    const slot = Object.entries(def.slots).find(([name, s]) => s.kind === "spoken" && !s.validate && !!fixtures[type][name]);
    if (!slot) continue;
    const [name, config] = slot;
    const tag = "<b> & 'go'";
    const r = render(type, { [name]: config.repeat ? [tag, "a short note"] : tag });
    assert.doesNotMatch(r.html, /<b>|<img|<image/);
    assert.match(displayText(r.html), /&lt;b&gt; &amp; &#39;go&#39;/);
  }
  const labelled = render("rating-cell-strip", { heading: "<b> & 'go'" });
  assert.match(labelled.html, /&lt;b&gt; &amp; &#39;go&#39;/);
});

test("the pro composer includes the picked card, its timeline and only its own card CSS", () => {
  const plan = fixturePlan("/fixture.mp4");
  plan.style = loadPreset("pingel-pro");
  plan.preset = plan.style.name;
  for (const [type, def] of Object.entries(BATCH)) {
    const o = fixture(type), rendered = renderProOverlay(o);
    plan.proGraphics = [o];
    const html = renderHTML(plan, "fixture.mp4");
    assert.ok(html.includes(rendered.html), type);
    assert.ok(html.includes(rendered.timeline), type);
    assert.ok(html.includes(def.css), type);
    for (const [other, otherDef] of Object.entries(BATCH)) {
      if (other !== type) assert.ok(!html.includes(otherDef.css), other);
    }
  }
});

test("adding these overlays has no effect on other presets", () => {
  for (const preset of ["pingel-brand", "pingel-bold", "clean", "vsl"]) {
    const plan = fixturePlan("/fixture.mp4");
    plan.preset = preset;
    plan.style = loadPreset(preset);
    const before = renderHTML(plan, "fixture.mp4");
    plan.proGraphics = Object.keys(BATCH).map((type) => fixture(type));
    assert.equal(renderHTML(plan, "fixture.mp4"), before, preset);
  }
});

test("vendored GSAP seeks to identical chart and copy states forward and backward", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap;
  const timeline = gsap.timeline({ paused: true }), elements = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const element = (selector, defaults = {}) => {
    if (!elements.has(selector)) elements.set(selector, { ...defaults });
    return elements.get(selector);
  };
  const tl = {
    fromTo(selector, from, to, at) { timeline.fromTo(element(selector, from), from, to, at); },
    to(selector, to, at) { timeline.to(element(selector), to, at); },
  };
  new Function("tl", proTimeline(Object.keys(BATCH).map((type) => fixture(type))))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...elements].map(([selector, state]) => [selector, state.opacity, state.x, state.y, state.scale, state.scaleX,
      state.clipPath, state.fill, state.strokeDashoffset]);
  };
  const frames = Array.from({ length: 420 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse frame ${frame}`);
  for (const step of frames) {
    const frame = step * 137 % frames.length;
    assert.deepEqual(snapshot(frame), forward[frame], `shuffled frame ${frame}`);
  }
});
