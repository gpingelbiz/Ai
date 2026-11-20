import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as BATCH } from "../src/pro-cards/proof-2.mjs";
import { CARDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, proSize, PRO_RECTS, PRO_MOTION, proPrompt } from "../src/pro.mjs";
import { renderProOverlay, proCSS, proTimeline } from "../src/pro-render.mjs";
import { loadPreset } from "../src/presets.mjs";
import { renderHTML } from "../src/compose.mjs";
import { fixturePlan } from "../scripts/golden.mjs";

const fixtures = {
  odometer: { value: "1,250", label: "calls made" },
  scoreboard: { leftTeam: "Team West", leftScore: "24", rightTeam: "Team East", rightScore: "18" },
  "line-chart": { start: "20%", startLabel: "Before coaching", end: "40%", endLabel: "After coaching" },
  gauge: { value: "seventy five percent", context: "of our clients renewed" },
  "money-stack": { value: "five thousand dollars" },
  trophy: { achievement: "We won the sales award" },
  streak: { count: "seven", label: "days in a row" },
  "case-study": { before: "20%", after: "40%", label: "close rate" },
  "kpi-tile": { label: "Close rate", value: "forty percent" },
  testimonial: { name: "Jane Smith", quote: "I finally feel confident on calls" },
};

function input(type, overrides = {}) {
  const values = { ...fixtures[type], ...overrides }, words = [], pick = { type };
  for (const [name, slot] of Object.entries(BATCH[type].slots)) {
    if (values[name] == null) continue;
    if (slot.kind === "label") { pick[name] = values[name]; continue; }
    const from = words.length;
    for (const text of values[name].split(" ")) {
      const start = 3 + words.length * 0.4;
      words.push({ text, start, end: start + 0.3 });
    }
    pick[name] = { from, to: words.length - 1 };
  }
  return { words, pick };
}

function fixture(type, overrides) {
  const { words, pick } = input(type, overrides), o = groundCard(pick, type, words);
  assert.ok(o, `${type}: ${JSON.stringify(overrides)}`);
  return { words, pick, o: { ...o, id: `proof-${type}`, place: { x: 120, y: 288, scale: 1 } } };
}

function render(type, overrides) {
  const { o } = fixture(type, overrides), calls = [], tl = {};
  for (const method of ["fromTo", "to", "set"]) tl[method] = (...args) => { calls.push({ method, args }); return tl; };
  new Function("tl", proTimeline([o]))(tl);
  return { ...renderProOverlay(o), calls, o };
}

const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const matching = (r, suffix) => r.calls.filter(({ args }) => args[0].endsWith(suffix));

test("ten proof cards register with bounded sizes, exact ranges and planner hints", () => {
  assert.deepEqual(Object.keys(BATCH), Object.keys(fixtures));
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(CARDS[type], def);
    assert.equal(def.family, "proof");
    assert.ok(def.hint.length > 40 && !def.hint.includes("\n"));
    assert.ok(PRO_RECTS.some((r) => def.size.w <= r.w && def.size.h <= r.h), type);
    assert.ok(!def.fullscreen);
    const { words, pick, o } = fixture(type);
    assert.deepEqual(groundProOverlay(pick, words), groundCard(pick, type, words));
    assert.deepEqual(proSize(o), def.size);
    assert.deepEqual(o.reveals, o.phrases.map((p) => words[p.from].start));
    for (const [name, slot] of Object.entries(def.slots)) {
      assert.equal(o.slots[name][0].text, fixtures[type][name]);
      if (slot.validate) assert.equal(slot.validate(o.slots[name][0].text, o.slots), true, `${type}.${name}`);
    }
    assert.match(proPrompt(words), new RegExp(`${type}.*\\[proof\\]`));
  }
});

test("required spoken quantities cannot be supplied as invented text, labels or missing ranges", () => {
  for (const [type, def] of Object.entries(BATCH)) {
    const { words, pick } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      if (!slot.optional) assert.equal(groundCard({ ...pick, [name]: undefined }, type, words), null);
      if (slot.kind === "spoken") {
        for (const value of ["99", { text: "99" }, { from: -1 }, { from: words.length }, { from: 0, to: -1 }]) {
          assert.equal(groundCard({ ...pick, [name]: value }, type, words), null, `${type}.${name}`);
        }
      }
    }
  }
  for (const label of ["Close rate 2", "one two three four five"]) {
    const { pick, words } = input("kpi-tile", { label });
    assert.equal(groundCard(pick, "kpi-tile", words), null);
  }
  const { pick, words } = input("scoreboard");
  assert.equal(groundCard({ ...pick, rightTeam: pick.leftTeam }, "scoreboard", words), null);
});

test("numeric slot validators reject absent, ambiguous, malformed and incompatible quantities", () => {
  const invalid = ["many", "", "10 to 20", "3/7", "ten or twenty", "-5", "negative five", "1,2", "1e3", "twenty ten", "one hundred and", "one thousand and", "$20 percent", "20% dollars", "Infinity", "<b>20</b>"];
  for (const [type, def] of Object.entries(BATCH)) {
    const { o } = fixture(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      if (!slot.validate) continue;
      for (const text of invalid) assert.equal(slot.validate(text, o.slots), false, `${type}.${name}: ${text}`);
    }
  }
  const valid = ["0", "1,250", "12.5", "twenty-five", "one hundred and five", "two thousand three hundred", "$5,000", "fifty percent"];
  for (const text of valid) assert.equal(BATCH["kpi-tile"].slots.value.validate(text), true, text);
  for (const text of ["8", "eight", "-1", "2.5", "two percent", "7/7", "seven days"]) assert.equal(BATCH.streak.slots.count.validate(text), false, text);
  for (const text of ["0", "zero", "1", "one", "7", "seven"]) assert.equal(BATCH.streak.slots.count.validate(text), true, text);
  for (const text of ["75", "101%", "negative ten percent", "ten to twenty percent"]) assert.equal(BATCH.gauge.slots.value.validate(text), false, text);
  for (const text of ["0%", "100%", "12.5%", "seventy-five percent", "one hundred percent"]) assert.equal(BATCH.gauge.slots.value.validate(text), true, text);
  for (const text of ["5000", "five thousand", "five euros"]) assert.equal(BATCH["money-stack"].slots.value.validate(text), false, text);
  assert.equal(BATCH.odometer.slots.value.validate("1000000"), false);
  assert.equal(BATCH.odometer.slots.value.validate("1.5"), false);
  assert.equal(BATCH["line-chart"].slots.end.validate("10%", { start: [{ text: "20%" }] }), false);
  assert.equal(BATCH["line-chart"].slots.end.validate("20%", { start: [{ text: "20%" }] }), false);
  assert.equal(BATCH["case-study"].slots.after.validate("40", { before: [{ text: "20%" }] }), false);
});

// groundCard currently has no validation hook; adding it requires an exception to the file edit limit.
test("groundCard invokes slot validators so invalid spoken numbers and streaks return null", () => {
  const ground = (type, overrides) => { const { words, pick } = input(type, overrides); return groundCard(pick, type, words); };
  assert.ok(ground("streak", { count: "seven" }), "a streak of seven grounds");
  assert.equal(ground("streak", { count: "twelve" }), null, "a streak past seven does not");
  assert.equal(ground("odometer", { value: "many", label: "calls made" }), null, "a value with no spoken number does not");
});

test("every spoken field reveals at its word with explicit seekable initial states", () => {
  for (const type of Object.keys(BATCH)) {
    const r = render(type);
    for (const item of r.o.phrases) {
      assert.ok(visible(r.html).includes(item.text), `${type}: ${item.text}`);
      assert.ok(r.calls.some(({ method, args }) => method === "fromTo" && args[1].opacity === 0 && args[2].opacity === 1 && args[2].duration === PRO_MOTION.enter && args[3] === item.at), `${type}: ${item.at}`);
    }
    for (const { method, args } of r.calls) {
      if (method === "fromTo") assert.equal(args[2].immediateRender, false);
      const to = method === "fromTo" ? args[2] : args[1];
      assert.ok([PRO_MOTION.enter, PRO_MOTION.state, PRO_MOTION.exit].includes(to.duration));
      assert.equal(typeof to.ease, "function");
    }
    assert.doesNotMatch(r.timeline, /NaN|undefined|rotation|repeat:|yoyo:|onUpdate|onComplete|Math\.random/);
    if (type !== "odometer") assert.deepEqual(visible(r.html).match(/\d+(?:\.\d+)?/g) || [], r.o.phrases.flatMap((p) => p.text.match(/\d+(?:\.\d+)?/g) || []));
    assert.match(r.timeline, /duration:0\.167/);
  }
});

test("odometer rolls only the earned digits and retains exact transcript wording", () => {
  for (const [value, digits] of [["0", "0"], ["1,250", "1250"], ["twenty five", "25"], ["999999", "999999"]]) {
    const r = render("odometer", { value });
    assert.equal((r.html.match(/class="odo-window"/g) || []).length, digits.length);
    assert.match(r.html, new RegExp(`aria-label="${value}"`));
    for (const [i, digit] of [...digits].entries()) {
      assert.ok(r.html.includes(`<span aria-hidden="true">${digit}</span><span>${digit}</span>`));
      const call = matching(r, `.odo-reel-${i}`)[0];
      assert.equal(call.args[1].y, 0);
      assert.equal(call.args[2].y, -64);
      assert.equal(call.args[2].duration, 0.3);
      assert.ok(call.args[3] >= r.o.slots.value[0].at);
    }
  }
});

test("scoreboard waits for both scores, awards only the winner and leaves ties neutral", () => {
  for (const [leftScore, rightScore, winner] of [["24", "18", "left"], ["12", "30", "right"], ["20", "20", null], ["twenty", "ten", "left"]]) {
    const r = render("scoreboard", { leftScore, rightScore });
    const wins = r.calls.filter(({ args }) => args[2]?.color === "#C8A24B");
    assert.equal(wins.length, winner ? 1 : 0);
    if (winner) {
      assert.ok(wins[0].args[0].endsWith(`.score-${winner} .score-led`));
      assert.equal(wins[0].args[3], r.o.slots.rightScore[0].at);
    }
    assert.match(BATCH.scoreboard.css, /"Anton"/);
  }
});

test("line chart draws only its two earned endpoints and the gauge maps spoken percentages", () => {
  const chart = render("line-chart");
  assert.equal(matching(chart, ".chart-line")[0].args[3], chart.o.slots.end[0].at);
  assert.match(chart.html, /d="M24 116L632 20"/);
  assert.equal((chart.html.match(/<circle/g) || []).length, 2);
  for (const [value, x2, y2] of [["0%", 60, 164], ["50%", 180, 44], ["100%", 300, 164], ["75%", 264.853, 79.147], ["seventy five percent", 264.853, 79.147]]) {
    const r = render("gauge", { value }), call = matching(r, ".gauge-needle")[0];
    assert.deepEqual(call.args[2].attr, { x2, y2 });
    assert.equal(call.args[3], r.o.slots.value[0].at);
  }
});

test("money builds unnumbered bills; trophy draws an SVG outline on the achievement", () => {
  const money = render("money-stack"), trophy = render("trophy");
  assert.equal((money.html.match(/class="money-bill money-bill-/g) || []).length, 3);
  const times = [0, 1, 2].map((i) => matching(money, `.money-bill-${i}`)[0].args[3]);
  assert.ok(times[0] === money.o.reveals[0] && times[0] < times[1] && times[1] < times[2]);
  assert.doesNotMatch(visible(money.html), /\d/);
  assert.equal(matching(trophy, ".trophy-outline")[0].args[3], trophy.o.reveals[0]);
  assert.match(trophy.html, /<svg/);
});

test("streak has seven dots, fills only the spoken count and never starts early", () => {
  for (const count of ["0", "three", "7"]) {
    const r = render("streak", { count });
    const n = count === "three" ? 3 : Number(count);
    assert.equal((r.html.match(/class="streak-dot streak-dot-/g) || []).length, 7);
    const fills = r.calls.filter(({ args }) => /\.streak-dot-\d+$/.test(args[0]));
    assert.equal(fills.length, n);
    fills.forEach(({ args }, i) => assert.equal(args[3], Math.round((r.o.slots.count[0].at + i * 0.04) * 1000) / 1000));
  }
});

test("case study reveals the outcome arrow with after; KPI uses no numbered sparkline axes", () => {
  const c = render("case-study"), k = render("kpi-tile");
  assert.equal(matching(c, ".p2-arrow path")[0].args[3], c.o.slots.after[0].at);
  assert.equal(matching(k, ".kpi-spark path")[0].args[3], k.o.slots.value[0].at);
  assert.doesNotMatch(k.html, /<text|<image|<img/);
  assert.equal(visible(k.html), "Close rate forty percent");
  const spoken = render("case-study", { before: "twenty five percent", after: "seventy five percent" });
  assert.ok(visible(spoken.html).includes("twenty five percent"));
  assert.ok(visible(spoken.html).includes("seventy five percent"));
});

test("testimonial uses only a spoken client's initials or the Client label initial", () => {
  const named = render("testimonial"), anonymous = render("testimonial", { name: undefined });
  assert.match(named.html, /pro-bone/);
  assert.match(named.html, /test-initials p2-hidden[^>]*>JS<\/text>/);
  assert.equal(matching(named, ".test-initials")[0].args[3], named.o.slots.name[0].at);
  assert.match(anonymous.html, /test-initials[^>]*>C<\/text>/);
  assert.doesNotMatch(anonymous.html, /test-name|Jane|Smith|Greg/);
  assert.equal(anonymous.o.reveals.length, 1);
});

test("copy is escaped, CSS stays scoped, palette is fixed and legacy presets are unaffected", () => {
  const r = render("testimonial", { name: "<b> & 'x'", quote: "<img> & 'x'" });
  assert.doesNotMatch(r.html, /<b>|<img>/);
  assert.match(r.html, /&lt;img&gt; &amp; &#39;x&#39;/);
  for (const [type, def] of Object.entries(BATCH)) {
    assert.ok(proCSS().includes(def.css));
    for (const match of def.css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of match[1].trim().split(",")) assert.ok(selector.trim() === `.pro-${type}` || selector.trim().startsWith(`.pro-${type} `), selector);
    }
    for (const color of def.css.matchAll(/#[\da-f]+/gi)) assert.ok(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"].includes(color[0]));
    assert.doesNotMatch(def.css, /glow|gradient|animation:|@keyframes|Caveat|emoji/i);
  }
  for (const preset of ["pingel-brand", "pingel-bold", "clean", "vsl"]) {
    const plan = fixturePlan("/fixture.mp4"); plan.preset = preset; plan.style = loadPreset(preset);
    const before = renderHTML(plan, "fixture.mp4");
    plan.proGraphics = Object.keys(BATCH).map((type) => fixture(type).o);
    assert.equal(renderHTML(plan, "fixture.mp4"), before, preset);
  }
});

test("vendored GSAP gives identical proof states on forward, reverse and shuffled seeks", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true }), elements = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const element = (selector) => {
    if (!elements.has(selector)) {
      const attrs = { x2: 180, y2: 44 };
      elements.set(selector, { opacity: /p2-arrow|chart-line|gauge-needle|streak-dot|trophy-outline|kpi-spark|odo-reel|score-led/.test(selector) ? 1 : 0, y: 0, clipPath: "inset(0 100% 0 0)", strokeDashoffset: 1, fill: "#343438", color: "#F5F1E8", borderColor: "#343438", attrs, getAttribute: (key) => attrs[key], setAttribute: (key, value) => { attrs[key] = value; } });
    }
    return elements.get(selector);
  };
  const tl = {};
  for (const method of ["fromTo", "to", "set"]) tl[method] = (selector, ...args) => { timeline[method](element(selector), ...args); return tl; };
  new Function("tl", proTimeline(Object.keys(BATCH).map((type) => fixture(type).o)))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...elements].map(([selector, el]) => {
      const parent = elements.get(selector.split(" ")[0]);
      if (parent?.opacity === 0 || el.opacity === 0) return null;
      return [selector, ...["opacity", "y", "clipPath", "strokeDashoffset", "fill", "color", "borderColor"].map((key) => el[key]), { ...el.attrs }];
    });
  };
  const frames = Array.from({ length: 420 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (let i = 0; i < frames.length; i++) { const frame = i * 137 % frames.length; assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`); }
});
