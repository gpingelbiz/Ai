import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as BATCH } from "../src/pro-cards/herk-kstat.mjs";
import { CARDS, CARD_GROUPS, rootOf, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, proSize, PRO_RECTS, PRO_MOTION } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { zoneFor, rightLimit } from "../src/safe-zone.mjs";
import { fixturePlan } from "../scripts/golden.mjs";
import { loadPreset } from "../src/presets.mjs";
import { renderHTML } from "../src/compose.mjs";

const fixtures = {
  "annotated-figure": { value: "$12K", note: ["from booked calls", "with no closer"] },
  "paired-rate-bars": { before: "20%", after: "45%", label: "show rate" },
  "percent-bubble": { value: "25%", context: "of calls converted" },
  "percent-grid": { value: "73.5%", context: "of leads answered" },
  "percent-tank": { value: "60%", context: "of seats filled" },
  "percent-track": { value: "74%", context: "of clients renewed" },
  "arc-gauge": { value: "seventy five percent", context: "of clients renewed" },
  "delta-arrow": { value: "down 30%", context: "in missed calls" },
  "rising-figure": { value: "six", context: "new coaching clients" },
  "people-fraction": { value: "7 out of 10", context: "reps got a reply" },
  "rank-medallion": { value: "first out of 20", context: "for client renewals" },
  "percentile-tail": { value: "top five percent", context: "of the team" },
  "ratio-lockup": { value: "three to one", context: "replies to calls booked" },
  "digital-duration": { time: "14:32" },
  "quantified-quote": { lead: "We booked", value: "three", tail: "calls that afternoon" },
  "side-by-side-metrics": { first: "24%", firstContext: "showed up", second: "3.2x", secondContext: "more booked calls" },
  "range-marker": { min: "$100", max: "$900", value: "$300" },
  "trend-points": { samples: ["20%", "45%", "30%", "fifty percent"], context: "show rate" },
  "comparison-rows": { heading: "Close rates", items: ["20% on referrals", "40% on inbound"] },
  "benchmark-rings": { items: ["80% of closers", "60% of setters", "40% of coaches"] },
  "funnel-counts": { items: ["80 prospects", "40 replies", "20 calls", "eight clients"] },
  "waterfall-build": { changes: ["plus $900 from calls", "minus $300 in refunds", "plus $50 from upsells"], total: "$650" },
};

function input(type, overrides = {}) {
  const sample = { ...fixtures[type], ...overrides };
  const words = [];
  const pick = { type };
  function range(line) {
    const from = words.length;
    for (const word of line.split(" ")) {
      const start = (300 + words.length * 13) / 100;
      words.push({ text: word, start, end: start + 0.1 });
    }
    return { from, to: words.length - 1 };
  }
  for (const [name, slot] of Object.entries(BATCH[type].slots)) {
    if (sample[name] == null) continue;
    pick[name] = slot.kind === "label" ? sample[name] : slot.repeat ? sample[name].map(range) : range(sample[name]);
  }
  return { words, pick, sample };
}

function ground(type, overrides) {
  const { pick, words } = input(type, overrides);
  return groundCard(pick, type, words);
}

function fixture(type, overrides) {
  const { words, pick, sample } = input(type, overrides);
  const grounded = groundCard(pick, type, words);
  assert.ok(grounded, `${type}: ${JSON.stringify(sample)}`);
  return { words, pick, sample, o: { ...grounded, id: `test-${type}`, place: { x: 180, y: 288 } } };
}

function render(type, overrides) {
  const { o } = fixture(type, overrides);
  const calls = [];
  const tl = {
    fromTo: (...args) => calls.push({ method: "fromTo", args }),
    to: (...args) => calls.push({ method: "to", args }),
  };
  new Function("tl", proTimeline([o]))(tl);
  return { o, calls, ...renderProOverlay(o) };
}

const state = (r, suffix) => {
  const call = r.calls.find(({ args }) => args[0].endsWith(suffix));
  assert.ok(call, suffix);
  return call.args;
};
const strip = (s) => s.replace(/<br>/g, " ").replace(/<[^>]*>/g, "");
const colors = new Set(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"]);

test("the triage covers every source once and attributes each retained design", () => {
  const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/herk-triage-kstat.json", import.meta.url), "utf8"));
  const ids = ("annot beforeafter bigpercent bracketstat bubble cbars clockface column compass counterpill curve delta dial donut dotgrid figure fillshape fraction " +
    "funnel growtharrow heatcell isotype layered mega meter milestone money multiplier multiring needle nodes odometer orbitmoons orbitstat pair percentile " +
    "pictobar polar quotestat radialbars range rank ratio ring risewall score segbar semigauge sparkline spectrum split stackedbars tickerstat tiles timer trendline underscore versus waffle waterfall").split(" ");
  assert.deepEqual(triage.map(({ id }) => id), ids.map((id) => `kallaway.t1.stat.${id}`));
  for (const row of triage) {
    assert.match(row.reason, /^[^\n]+$/);
    if (row.outcome === "unfit") assert.equal(row.type, undefined);
    else if (row.outcome === "duplicate") assert.ok(CARDS[row.type] || row.type === "stat", row.id);
    else {
      assert.ok(["new", "variant", "merged"].includes(row.outcome));
      const def = BATCH[row.type];
      assert.ok(def, row.id);
      assert.ok(def.source.slice(5).split(",").includes(row.id), row.id);
      if (row.outcome !== "merged") assert.equal(row.outcome, def.variantOf ? "variant" : "new");
    }
  }
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(triage.filter((row) => row.type === type && ["new", "variant"].includes(row.outcome)).length, 1);
    assert.deepEqual(def.source.slice(5).split(",").sort(), triage.filter((row) => row.type === type).map((row) => row.id).sort());
  }
});

test("every design registers, fits the safe panel, and grounds exact copy at its word index", () => {
  assert.deepEqual(Object.keys(BATCH).sort(), Object.keys(fixtures).sort());
  const zone = zoneFor();
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(CARDS[type], def);
    assert.equal(def.family, "proof");
    assert.ok(!def.fullscreen);
    assert.match(def.source, /^herk:kallaway\.t1\.stat\./);
    assert.match(def.hint, /^[^\n]+$/);
    assert.ok(def.tags.length >= 1 && def.tags.length <= 3 && def.tags.every((tag) => TAG_WORDS.includes(tag)));
    const { o, words, pick, sample } = fixture(type);
    const { w, h } = proSize(o);
    assert.ok(PRO_RECTS.some((rect) => w <= rect.w && h <= rect.h), `${type} ${w}×${h}`);
    const maxSlots = Object.fromEntries(Object.entries(def.slots).map(([name, slot]) => [
      name, Array.from({ length: slot.repeat?.[1] ?? 1 }, () => ({ lines: Array(slot.maxLines).fill("word") })),
    ]));
    const largest = proSize({ ...o, slots: maxSlots });
    assert.ok(PRO_RECTS.some((rect) => largest.w <= rect.w && largest.h <= rect.h), `${type} at maximum copy`);
    assert.ok(o.place.x >= zone.left && o.place.y >= zone.top && o.place.y + h <= zone.bottom);
    assert.ok(o.place.x + w <= rightLimit(zone, o.place.y, o.place.y + h));
    const root = rootOf(type);
    assert.ok(CARD_GROUPS[root].includes(type));
    const selected = groundProOverlay({ ...pick, type: root, design: type }, words);
    assert.equal(selected.type, type);
    assert.deepEqual(selected.slots, o.slots);
    assert.deepEqual(o.reveals, o.phrases.map(({ from }) => words[from].start));
    for (const [name, slot] of Object.entries(def.slots)) {
      const expected = sample[name] == null ? [] : slot.repeat ? sample[name] : [sample[name]];
      assert.deepEqual(o.slots[name].map(({ text }) => text), expected);
      for (const item of o.slots[name]) {
        assert.equal(item.fontSize, undefined, `${type}.${name} keeps its planned size`);
        if (slot.kind === "spoken") assert.equal(item.text, words.slice(item.from, item.to + 1).map((word) => word.text).join(" "));
      }
      assert.ok(slot.size >= (slot.kind === "label" ? 28 : 40), type);
    }
  }
});

test("every spoken slot rejects invented, overlapping, missing and oversized text", () => {
  for (const [type, def] of Object.entries(BATCH)) {
    const { words, pick } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      if (!slot.optional) assert.equal(groundCard({ ...pick, [name]: undefined }, type, words), null, type);
      const tooLong = "W".repeat(slot.maxChars + 1);
      const invalidWidth = "W".repeat(Math.floor(slot.width / (slot.size * 0.95)) + 1);
      for (const line of [tooLong, invalidWidth]) {
        const substitute = slot.repeat ? [line, ...fixtures[type][name].slice(1)] : line;
        assert.equal(ground(type, { [name]: substitute }), null, `${type}.${name}: ${line}`);
      }
      if (slot.kind === "label") continue;
      for (const value of ["99", { text: "99" }, { from: -1 }, { from: words.length }, { from: 0, to: -1 }]) {
        const substitute = slot.repeat ? [value, ...pick[name].slice(1)] : value;
        assert.equal(groundCard({ ...pick, [name]: substitute }, type, words), null, `${type}.${name}`);
      }
      const range = slot.repeat ? pick[name][0] : pick[name];
      if (range.from > 0) {
        const overlapping = { from: range.from - 1, to: range.to };
        const substitute = slot.repeat ? [overlapping, ...pick[name].slice(1)] : overlapping;
        assert.equal(groundCard({ ...pick, [name]: substitute }, type, words), null, `${type}.${name}`);
      }
    }
  }
  for (const heading of ["Close rate 2", "one two three four five"]) assert.equal(ground("comparison-rows", { heading }), null);
});

test("visible values use only the exact ranges and write at the words using house timing", () => {
  for (const type of Object.keys(fixtures)) {
    const r = render(type);
    const spoken = [...r.html.matchAll(/<div class="ks-said ks-(\S+) (\S+?)">(.+?)<\/div>/g)];
    assert.equal(spoken.length, r.o.phrases.length, type);
    const values = r.o.phrases.map((item) => item.text).sort();
    assert.deepEqual(spoken.map((match) => strip(match[3])).sort(), values, type);
    for (const [, role, cls, html] of spoken) {
      const call = r.calls.find(({ args }) => args[0].endsWith(`.${cls}`) &&
        r.o.phrases.some((item) => item.text === strip(html) && item.at === args[3]));
      assert.ok(call, cls);
      const [, from, to] = call.args;
      assert.equal(from.opacity, 0, cls);
      assert.equal(to.opacity, 1, cls);
      assert.equal(to.duration, PRO_MOTION.enter, cls);
      assert.match(BATCH[type].css, role === "headline" ? /96px\/106px "Anton"/ : /40px\/48px "Inter"/);
    }
    for (const { method, args } of r.calls) {
      const tween = method === "fromTo" ? args[2] : args[1];
      assert.ok([PRO_MOTION.enter, PRO_MOTION.state, PRO_MOTION.exit].includes(tween.duration), type);
      assert.equal(typeof tween.ease, "function");
      if (method === "fromTo") assert.equal(tween.immediateRender, false);
      if (args[0].includes(" ")) {
        for (const { 1: cls } of args[0].matchAll(/\.([\w-]+)/g)) assert.match(r.html, new RegExp(`class="[^"]*\\b${cls}\\b`), args[0]);
      }
    }
    const visibleDigits = strip(r.html).match(/\d/g) || [];
    assert.deepEqual(visibleDigits.sort(), values.join("").match(/\d/g)?.sort() || [], type);
    assert.doesNotMatch(r.timeline, /NaN|undefined|rotation|repeat:|onUpdate|onComplete|Math\.random|Date\.now/);
    assert.doesNotMatch(r.html, /<(?:img|image|text|a)\b|data-slot=|SOURCE|http/i);
  }
});

test("copy is escaped, CSS stays scoped and preset rendering keeps its original output", () => {
  const r = render("annotated-figure", { note: ["calls <img> & 'yes'"] });
  assert.doesNotMatch(r.html, /<img>/);
  assert.match(r.html, /&lt;img&gt; &amp; &#39;yes&#39;/);
  assert.match(render("comparison-rows", { heading: "<b> & 'yes'" }).html, /&lt;b&gt; &amp; &#39;yes&#39;/);
  assert.match(render("funnel-counts", { items: ["80 cold <x>", "50 replies & demos", "10 clients"] }).html, /cold &lt;x&gt;/);
  for (const [type, def] of Object.entries(BATCH)) {
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css));
    for (const [, selector] of def.css.matchAll(/([^{}]+)\{/g)) {
      assert.ok(selector.trim() === `.pro-${type}` || selector.trim().startsWith(`.pro-${type} `), selector);
    }
    for (const [color] of def.css.matchAll(/#[0-9a-f]+/gi)) assert.ok(colors.has(color), color);
    for (const [, font] of def.css.matchAll(/"([^"]+)"/g)) assert.ok(["Inter", "Anton"].includes(font), font);
    assert.doesNotMatch(def.css, /gradient|filter:|shadow:|@keyframes|rotate|animation:/);
  }
  for (const preset of ["pingel-brand", "pingel-bold", "clean", "vsl"]) {
    const plan = fixturePlan("/fixture.mp4");
    plan.preset = preset;
    plan.style = loadPreset(preset);
    const original = renderHTML(plan, "fixture.mp4");
    plan.proGraphics = Object.keys(fixtures).map((type) => fixture(type).o);
    assert.equal(renderHTML(plan, "fixture.mp4"), original, preset);
  }
});

test("pro composition carries only the picked card CSS and its grounded timeline", () => {
  const plan = fixturePlan("/fixture.mp4");
  plan.preset = "pingel-pro";
  plan.style = loadPreset(plan.preset);
  plan.canvas = { width: 1080, height: 1920 };
  const { o } = fixture("percent-track");
  plan.proGraphics = [o];
  const html = renderHTML(plan, "fixture.mp4");
  assert.ok(html.includes(renderProOverlay(o).html));
  assert.ok(html.includes(BATCH["percent-track"].css));
  assert.ok(html.includes(`"#${o.id} .rate-track .ks-draw"`));
  assert.doesNotMatch(html, /\.pro-percent-bubble/);
});

test("spoken numeric validation fails closed and a root can fall back to its established design", () => {
  const invalid = [
    ["annotated-figure", { value: "five or six" }],
    ["rising-figure", { value: "200 dollars percent" }],
    ["paired-rate-bars", { after: "105%" }],
    ["percent-bubble", { value: "20" }],
    ["percent-grid", { value: "-5%" }],
    ["percent-tank", { value: "about 20%" }],
    ["percent-track", { value: "20 to 40%" }],
    ["arc-gauge", { value: "100.1%" }],
    ["delta-arrow", { value: "20%" }],
    ["delta-arrow", { value: "down 0%" }],
    ["people-fraction", { value: "11 out of 10" }],
    ["people-fraction", { value: "7 out of 20" }],
    ["rank-medallion", { value: "11st" }],
    ["rank-medallion", { value: "third out of 2" }],
    ["percentile-tail", { value: "top 0%" }],
    ["percentile-tail", { value: "rank 12" }],
    ["ratio-lockup", { value: "2:0" }],
    ["ratio-lockup", { value: "2% to 3%" }],
    ["digital-duration", { time: "1:78" }],
    ["digital-duration", { time: "three minutes and" }],
    ["quantified-quote", { value: "quite a lot" }],
    ["side-by-side-metrics", { second: "many" }],
    ["range-marker", { max: "$50" }],
    ["range-marker", { value: "$900.01" }],
    ["range-marker", { value: "300%" }],
    ["trend-points", { samples: ["30%", "1", "45%"] }],
    ["trend-points", { samples: ["20%", "40%"] }],
    ["comparison-rows", { items: ["25 per cent", "30 percent"] }],
    ["comparison-rows", { items: ["10 to 20 booked", "30 booked"] }],
    ["comparison-rows", { items: ["ten five booked", "30 booked"] }],
    ["comparison-rows", { items: ["10 booked", "20% canceled"] }],
    ["benchmark-rings", { items: ["85% show rate", "105% close rate", "80% replies"] }],
    ["funnel-counts", { items: ["50 leads", "60 calls", "10 clients"] }],
    ["funnel-counts", { items: ["0 leads", "0 calls", "0 clients"] }],
    ["waterfall-build", { total: "$700" }],
    ["waterfall-build", { changes: ["50 leads", "minus 20 refunds"], total: "30" }],
    ["waterfall-build", { changes: ["plus $1.005 leads", "minus $0.01 refunds"], total: "$0.995" }],
  ];
  for (const [type, values] of invalid) assert.equal(ground(type, values), null, `${type}: ${JSON.stringify(values)}`);
  for (const value of ["six", "one point five million", "$2.4B", "3.25×", "twenty-six percent", "two thousand and three"]) {
    assert.ok(ground("rising-figure", { value }), value);
  }
  assert.ok(ground("digital-duration", { time: "five minutes and thirty seconds" }));
  assert.ok(ground("people-fraction", { value: "six out of ten" }));
  assert.ok(ground("percent-bubble", { value: "seventy five percent" }));
  assert.ok(ground("waterfall-build", { changes: ["plus $0.10 sales", "plus $0.20 upsells"], total: "$0.30" }));
  const { pick, words } = input("paired-rate-bars", { before: "20", after: "25" });
  assert.equal(groundProOverlay({ ...pick, type: "case-study", design: "paired-rate-bars" }, words).type, "case-study");
});

test("geometry tracks exact amounts with no prefilled steps or fabricated observations", () => {
  const bubble = render("percent-bubble");
  assert.equal(state(bubble, ".rate-bubble")[2].attr.r, 47);
  assert.equal(state(render("percent-bubble", { value: "0%" }), ".rate-bubble")[2].attr.r, 0);
  assert.equal(state(render("percent-tank", { value: "100%" }), ".rate-water")[2].scaleY, 1);
  assert.equal(state(render("percent-track", { value: "50%" }), ".rate-marker")[2].x, 312);
  assert.equal(state(render("arc-gauge"), ".rate-arc .ks-draw")[2].strokeDashoffset, 0.25);
  assert.equal(state(render("paired-rate-bars"), ".rate-row-1 .ks-fill")[2].scaleX, 0.45);
  const grid = render("percent-grid");
  assert.match(grid.html, /<rect width="220" height="154"\/><rect y="154" width="75" height="18"\/>/);
  assert.equal((grid.html.match(/class="rate-lit"/g) || []).length, 1);
  const people = render("people-fraction");
  assert.equal((people.html.match(/class="fraction-person/g) || []).length, 10);
  assert.equal((people.html.match(/fraction-person fraction-hit/g) || []).length, 7);
  assert.match(render("delta-arrow").html, /d="M12 12l136 120/);
  assert.match(render("delta-arrow", { value: "+340%" }).html, /d="M12 132L148 12/);
  assert.equal(state(render("range-marker"), ".bounds-marker")[2].x, 156);
  const top = render("percentile-tail");
  assert.match(top.html, /d="M640 12H16"/);
  assert.equal(state(top, ".percentile-rail .ks-draw")[2].strokeDashoffset, 0.95);
  assert.match(render("percentile-tail", { value: "bottom 20%" }).html, /d="M16 12H640"/);
  const trend = render("trend-points");
  assert.match(trend.html, /d="M141.6 48L303.6 144"/);
  assert.match(trend.html, /d="M303.6 144L206.4 240"/);
  assert.equal(state(trend, ".trend-segment-2")[3], trend.o.slots.samples[2].at);
  const funnel = render("funnel-counts");
  assert.equal(proSize(funnel.o).h, 496);
  assert.equal(state(funnel, ".funnel-row-3 .funnel-band")[2].scaleX, 0.1);
  const waterfall = render("waterfall-build");
  assert.match(waterfall.html, /class="waterfall-block waterfall-debit" x="176" y="5" width="84"/);
  assert.equal(state(waterfall, ".waterfall-row-0 .waterfall-joint")[3], waterfall.o.slots.changes[1].at);
});

test("vendored GSAP seeks the same card states forwards, backwards and out of order", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const { gsap } = context.window;
  const timeline = gsap.timeline({ paused: true });
  const elements = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  function element(selector) {
    if (!elements.has(selector)) {
      const attrs = { r: 0 };
      elements.set(selector, {
        opacity: 0, x: 0, y: 0, clipPath: "inset(0 100% 0 0)", scaleX: 0, scaleY: 0,
        fill: "#343438", strokeDashoffset: 1, attrs,
        getAttribute: (key) => attrs[key], setAttribute: (key, value) => { attrs[key] = value; },
      });
    }
    return elements.get(selector);
  }
  const tl = {
    fromTo: (selector, ...args) => timeline.fromTo(element(selector), ...args),
    to: (selector, ...args) => timeline.to(element(selector), ...args),
  };
  new Function("tl", proTimeline(Object.keys(fixtures).map((type) => fixture(type).o)))(tl);
  function snapshot(frame) {
    timeline.totalTime(frame / 30, false);
    return [...elements.values()].map((el) => [el.opacity, el.x, el.y, el.clipPath, el.scaleX, el.scaleY, el.fill, el.strokeDashoffset, el.attrs.r]);
  }
  const frames = Array.from({ length: 300 }, (_, i) => i);
  const forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (const i of frames) {
    const frame = i * 137 % frames.length;
    assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`);
  }
});
