import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as LABELS } from "../src/pro-cards/herk-klabel.mjs";
import { CARDS, rootOf, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proSize, PRO_MOTION } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { zoneFor, rightLimit } from "../src/safe-zone.mjs";
import { loadPreset } from "../src/presets.mjs";
import { renderHTML } from "../src/compose.mjs";
import { fixturePlan } from "../scripts/golden.mjs";

const definition = { term: "Permission close", detail: "Ask if they want to continue" };
const examples = {
  "term-definition": definition,
  "definition-brace": definition,
  "definition-leader": definition,
  "definition-tooltip": definition,
  "definition-tab": definition,
  "definition-underline": definition,
  "reason-callout": { term: "Hold the pause", detail: "They need time to think" },
  "result-check": { term: "They came back", detail: "They booked a second call" },
  "risk-explainer": { term: "Talking too fast", detail: "They miss the question" },
  "shortcut-key": { keys: "Command K", effect: "Opens your search" },
  "search-explainer": { query: "Discovery questions", context: "Look for open questions" },
  "quote-explained": { quote: "Silence earns answers", explanation: "Give them time to think" },
  "live-status": { offer: "Coaching is open", access: "Current reps can join" },
  "step-detail": { action: "Replay the opener", instruction: "Listen for the first pause" },
  "alert-preview": { subject: "Call confirmed", body: "See you after lunch" },
  "spec-sheet": {
    title: "Your practice plan", firstField: "Duration", firstValue: "Ten minutes",
    secondField: "Partner", secondValue: "Another rep",
  },
  "split-benchmark": { firstValue: "2.4x", firstContext: "with practice", secondValue: "1.0x", secondContext: "without practice" },
  "offer-price-tag": { price: "$497", offer: "Includes weekly coaching" },
  "count-stack-label": { value: "2,400", metric: "calls completed", context: "across the team this month" },
  "reported-change-chip": { change: "+34%", metric: "booking rate", baseline: "compared with last month" },
  "percent-label-bar": { metric: "Rebooking rate", value: "78%", context: "of clients booked again" },
  "duration-bracket-label": { time: "two minutes", context: "for a full opener review" },
  "lesson-ribbon": { heading: "Key insight", quote: "Stay curious until you understand" },
};

function input(type, overrides = {}) {
  const values = { ...examples[type], ...overrides }, words = [], pick = { type };
  for (const [name, slot] of Object.entries(LABELS[type].slots)) {
    const value = values[name];
    if (value == null) continue;
    if (slot.kind === "label") {
      pick[name] = value;
      continue;
    }
    const from = words.length;
    for (const text of value.split(/\s+/)) {
      const start = 4 + words.length * 0.375;
      words.push({ text, start, end: start + 0.25 });
    }
    pick[name] = { from, to: words.length - 1 };
  }
  return { values, words, pick };
}

function ground(type, overrides) {
  const { words, pick } = input(type, overrides);
  return groundCard(pick, type, words);
}

function render(type, overrides) {
  const grounded = ground(type, overrides);
  assert.ok(grounded, `${type}: ${JSON.stringify(overrides)}`);
  const o = { ...grounded, id: `label-${type}`, place: { x: 150, y: 220, scale: 1 } };
  const calls = [], tl = {};
  for (const method of ["fromTo", "to"]) tl[method] = (...args) => { calls.push({ method, args }); return tl; };
  new Function("tl", proTimeline([o]))(tl);
  return { o, calls, ...renderProOverlay(o) };
}

const content = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const scoped = (r, selector) => r.calls.find(({ args }) => args[0] === `#${r.o.id} ${selector}`)?.args;

test("all 60 source IDs have one decision, with all retained and merged sources credited", () => {
  const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/herk-triage-klabel.json", import.meta.url), "utf8"));
  const suffixes = "badge brace bracket bubble byline callout category checkmark chipstat comparemini coord counter crosshair dashed definition deltachip eyebrow fact flag formula hash highlightbox iconchip info infocard keycap keyword leader legend measure meterchip metric micropie minibar node note numbercallout percent pointer price progress pulse qmark quote rating ribbon ringmark search sparkchip spec status step tag takeaway tcode timestamp toast tooltip underline warning".split(" ");
  assert.deepEqual(triage.map(({ id }) => id), suffixes.map((suffix) => `kallaway.t2.label.${suffix}`));
  const counts = { new: 0, variant: 0, merged: 0, duplicate: 0, unfit: 0 };
  for (const { id, outcome, type, reason } of triage) {
    assert.ok(Object.hasOwn(counts, outcome), id);
    counts[outcome]++;
    assert.ok(reason.length > 24 && !reason.includes("\n"), id);
    if (outcome === "new") assert.ok(LABELS[type] && !LABELS[type].variantOf, id);
    if (outcome === "variant") assert.ok(LABELS[type]?.variantOf, id);
    if (outcome === "merged") assert.ok(LABELS[type], id);
    if (outcome === "unfit") assert.equal(type, undefined, id);
    if (outcome === "duplicate") {
      assert.ok(!LABELS[type], id);
      assert.ok(CARDS[type] || type === "stat", id);
    }
  }
  assert.deepEqual(counts, { new: 17, variant: 6, merged: 22, duplicate: 9, unfit: 6 });
  for (const [type, def] of Object.entries(LABELS)) {
    assert.match(def.source, /^herk:/);
    const expected = triage.filter((entry) => entry.type === type).map(({ id }) => id);
    assert.deepEqual(def.source.slice(5).split(",").sort(), expected.sort(), type);
  }
});

test("all designs ground exact transcript ranges through the public entry point and fit the shared safe zone", () => {
  assert.deepEqual(Object.keys(LABELS), Object.keys(examples));
  const frame = {
    W: 1080, H: 1920, measured: true,
    head: { x: 425, y: 830, w: 230, h: 272 },
    mic: { x: 150, y: 1100, w: 200, h: 120 },
    caption: { x: 180, y: 1140, w: 720, h: 120 },
  };
  const zone = zoneFor();
  for (const [type, def] of Object.entries(LABELS)) {
    assert.equal(CARDS[type], def);
    assert.ok(def.tags.length >= 1 && def.tags.length <= 3 && def.tags.every((tag) => TAG_WORDS.includes(tag)), type);
    assert.ok(!def.fullscreen, type);
    const { words, pick, values } = input(type);
    const o = groundProOverlay({ ...pick, type: rootOf(type), design: type }, words);
    assert.equal(o?.type, type);
    assert.deepEqual(o.reveals, o.phrases.map(({ from }) => words[from].start));
    assert.deepEqual(Object.fromEntries(Object.entries(o.slots).map(([key, items]) => [key, items[0].text])), values);
    const size = proSize(o);
    assert.ok(size.w <= 720 && size.h <= 560, type);
    if (typeof def.size === "function") assert.ok(def.size({}).h <= 560, type);
    const p = placeProOverlay(o, frame);
    assert.ok(p, type);
    assert.ok(p.x >= zone.left && p.y - 8 >= zone.top && p.y + p.h + 16 <= zone.bottom, type);
    assert.ok(p.x + p.w <= rightLimit(zone, p.y - 8, p.y + p.h + 16), type);
    for (const [name, slot] of Object.entries(def.slots)) {
      assert.ok(slot.size >= (slot.kind === "spoken" ? 40 : 28), `${type}.${name}`);
      assert.equal(o.slots[name][0].fontSize, undefined, `${type}.${name} never needs a shrink`);
    }
  }
});

test("spoken slots reject invented strings, unsupported numbers and copy that needs shrink-to-fit", () => {
  for (const [type, def] of Object.entries(LABELS)) {
    const { words, pick } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      if (slot.kind !== "spoken") continue;
      for (const value of ["Invented", { text: "Invented" }, { from: -1 }, { from: 0, to: words.length }, undefined]) {
        assert.equal(groundCard({ ...pick, [name]: value }, type, words), null, `${type}.${name}`);
      }
      assert.equal(ground(type, { [name]: "W".repeat(slot.maxChars + 1) }), null, `${type}.${name} length`);
    }
  }
  assert.equal(ground("definition-tab", { term: "WWWWWWWWWWWWWW" }), null);
  const { pick, words } = input("term-definition");
  assert.equal(groundCard({ ...pick, detail: pick.term }, "term-definition", words), null);
  for (const heading of ["Takeaway 1", "word word word word word", "Invented copy", "Number ٤", "four"]) {
    assert.equal(ground("lesson-ribbon", { heading }), null, heading);
  }
  assert.match(render("lesson-ribbon", { heading: undefined }).html, />Takeaway</);

  for (const invalid of ["huge", "48 to 78%", "100.1%", "about 40%", "four five percent", "-1%", "1e1%"]) {
    assert.equal(ground("percent-label-bar", { value: invalid }), null, invalid);
  }
  for (const invalid of ["many", "34%", "+30 to 40%", "up about 40%", "up 1e1%", "down negative 10%"]) {
    assert.equal(ground("reported-change-chip", { change: invalid }), null, invalid);
  }
  for (const valid of ["+34%", "down ten percent", "up 125%"]) {
    assert.ok(ground("reported-change-chip", { change: valid }), valid);
  }
  assert.equal(ground("percent-label-bar", { value: "+34%" }), null);
  for (const invalid of ["many", "2.4", "one million", "100%"]) {
    assert.equal(ground("count-stack-label", { value: invalid }), null, invalid);
  }
  for (const invalid of ["a lot", "500", "free", "five to ten dollars", "$5 euros", "$5 percent"]) {
    assert.equal(ground("offer-price-tag", { price: invalid }), null, invalid);
  }
  for (const valid of ["$497", "five hundred dollars", "£300", "300 euros"]) {
    assert.ok(ground("offer-price-tag", { price: valid }), valid);
  }
  for (const invalid of ["12", "several weeks", "6 to days", "$12 weeks", "<b>2</b> minutes"]) {
    assert.equal(ground("duration-bracket-label", { time: invalid }), null, invalid);
  }
  for (const valid of ["two to three minutes", "2-3 minutes", "14 weeks"]) {
    assert.ok(ground("duration-bracket-label", { time: valid }), valid);
  }
  for (const invalid of ["1.0", "20%", "several times", "2x to 3x", "$4x"]) {
    assert.equal(ground("split-benchmark", { secondValue: invalid }), null, invalid);
  }
  assert.equal(ground("split-benchmark", { firstValue: "$7", secondValue: "£8" }), null);
  assert.ok(ground("split-benchmark", { firstValue: "$7", secondValue: "eight dollars" }));
});

test("every exact spoken phrase writes on its reveal and every motion uses the house timings", () => {
  for (const type of Object.keys(LABELS)) {
    const r = render(type);
    const copyEls = [...r.html.matchAll(/<div class="([^"]*\bkl-copy\b[^"]*)">([^<]*(?:<br>[^<]*)*)<\/div>/g)];
    assert.equal(copyEls.length, r.o.phrases.length, type);
    for (const phrase of r.o.phrases) {
      const rendered = copyEls.find(([, , value]) => content(value) === phrase.text);
      assert.ok(rendered, `${type}: ${phrase.text}`);
      const classes = rendered[1].split(" ");
      const writing = r.calls.find(({ args }) => args[0].startsWith(`#${r.o.id} .`) &&
        classes.includes(args[0].split(".").at(-1)) &&
        args[1]?.opacity === 0 && args[2]?.opacity === 1 && args[3] === phrase.at);
      assert.equal(writing?.args[2].duration, PRO_MOTION.enter, `${type}: ${phrase.text}`);
    }
    for (const { method, args } of r.calls) {
      const vars = method === "fromTo" ? args[2] : args[1];
      assert.equal(typeof vars.ease, "function");
      if (method === "fromTo") {
        assert.equal(vars.immediateRender, false);
        assert.ok([PRO_MOTION.enter, PRO_MOTION.state].includes(vars.duration), type);
        assert.ok(r.o.reveals.includes(args[3]), type);
      } else {
        assert.equal(args[0], `#${r.o.id}`);
        assert.equal(vars.duration, PRO_MOTION.exit);
      }
    }
    assert.doesNotMatch(r.timeline, /NaN|undefined|rotation|repeat:|yoyo:|onUpdate|Math\.random/);
    assert.deepEqual(content(r.html).match(/\d+(?:\.\d+)?/g) || [], r.o.phrases.flatMap((p) => p.text.match(/\d+(?:\.\d+)?/g) || []));
  }
});

test("drawing, key states and measurement use the relevant reveal and only the earned value", () => {
  for (const [value, fraction] of [["0%", 0], ["12.5%", 0.125], ["40.0%", 0.4], ["seventy-eight percent", 0.78],
    ["nine per cent", 0.09], ["one hundred percent", 1]]) {
    const r = render("percent-label-bar", { value });
    assert.ok(content(r.html).includes(value));
    const [, from, to, at] = scoped(r, ".kl-fill");
    assert.equal(from.scaleX, 0);
    assert.equal(to.scaleX, fraction, value);
    assert.equal(at, r.o.slots.value[0].at);
  }
  const count = render("count-stack-label");
  assert.match(count.html, />2,400</);
  assert.equal(scoped(count, ".kl-value")[1].clipPath, "inset(100% 0 0 0)");
  assert.equal(scoped(count, ".kl-rule")[3], count.o.slots.metric[0].at);

  const brace = render("definition-brace"), ruler = render("duration-bracket-label");
  for (const [r, shape] of [[brace, "brace"], [ruler, "measure"]]) {
    assert.equal((r.html.match(/pathLength="1"/g) || []).length, 2);
    const [, from, to, at] = scoped(r, `.kl-${shape} path`);
    assert.equal(from.strokeDashoffset, 1);
    assert.equal(to.strokeDashoffset, 0);
    assert.equal(at, r.o.start);
  }
  const key = render("shortcut-key"), search = render("search-explainer"), check = render("result-check");
  assert.equal(scoped(key, ".kl-key")[3], key.o.slots.effect[0].at);
  assert.equal(scoped(search, ".kl-caret")[2].opacity, 0);
  assert.equal(scoped(search, ".kl-caret")[3], search.o.slots.context[0].at);
  assert.equal(scoped(check, ".kl-check path")[3], check.o.slots.detail[0].at);
});

test("all designs escape spoken markup and scope their CSS and house palette", () => {
  const palette = ["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"];
  for (const [type, def] of Object.entries(LABELS)) {
    const slot = Object.entries(def.slots).find(([name, s]) => s.kind === "spoken" &&
      !["price", "time", "change"].includes(name) && !/value$/i.test(name))?.[0];
    const r = render(type, slot ? { [slot]: "<b> & 'x'" } : undefined);
    if (slot) assert.match(r.html, /&lt;b&gt; &amp; &#39;x&#39;/, type);
    assert.doesNotMatch(r.html, /<(b|img|image|script)\b/);
    assert.doesNotMatch(r.html, /font-size:/, "fit never lowers the promised font");
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css));
    for (const match of def.css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of match[1].trim().split(",")) {
        assert.ok(selector.trim() === `.pro-${type}` || selector.trim().startsWith(`.pro-${type} `), selector);
      }
    }
    for (const match of def.css.matchAll(/#[\da-f]{6}\b/gi)) assert.ok(palette.includes(match[0]), match[0]);
    for (const match of def.css.matchAll(/"([^"]+)"/g)) assert.ok(["Inter", "Anton"].includes(match[1]), match[1]);
    assert.doesNotMatch(def.css, /gradient|blur\(|text-shadow|animation:|@keyframes|emoji/i);
  }
  const plan = fixturePlan("/fixture.mp4");
  for (const preset of ["pingel-brand", "pingel-bold", "clean", "vsl"]) {
    plan.preset = preset;
    plan.style = loadPreset(preset);
    plan.proGraphics = [];
    const before = renderHTML(plan, "fixture.mp4");
    plan.proGraphics = Object.keys(LABELS).map((type) => render(type).o);
    assert.equal(renderHTML(plan, "fixture.mp4"), before, preset);
  }
  plan.preset = "pingel-pro";
  plan.style = loadPreset(plan.preset);
  for (const [type, def] of Object.entries(LABELS)) {
    const r = render(type);
    plan.proGraphics = [r.o];
    const html = renderHTML(plan, "fixture.mp4", {});
    assert.ok(html.includes(r.html), type);
    assert.ok(html.includes(r.timeline), type);
    assert.ok(html.includes(def.css), type);
  }
});

test("vendored GSAP settles the percentage fill the same way on forward and reverse seeks", (t) => {
  const r = render("percent-label-bar");
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true }), fill = { scaleX: 0 };
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const [, from, to, at] = scoped(r, ".kl-fill");
  timeline.fromTo(fill, from, to, at);
  const samples = [at - 0.1, at, at + 0.15, at + 0.3, at + 0.4];
  const values = samples.map((time) => { timeline.totalTime(time); return fill.scaleX; });
  assert.deepEqual(values.slice(0, 2), [0, 0]);
  assert.deepEqual(values.slice(3), [0.78, 0.78]);
  for (const [i, time] of [...samples.entries()].reverse()) {
    timeline.totalTime(time);
    assert.equal(fill.scaleX, values[i], `reverse seek at ${time}`);
  }
});
