import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as batch } from "../src/pro-cards/herk-ksection.mjs";
import { CARDS, CARD_GROUPS, tagsOf, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, proSize, proTextWidth, PRO_MOTION, PRO_RECTS } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";
import { renderHTML } from "../src/compose.mjs";
import { loadPreset } from "../src/presets.mjs";
import { fixturePlan } from "../scripts/golden.mjs";

const chapter = { number: "three", headline: "Qualify the lead" };
const fixtures = {
  "section-divider": { headline: "Move into discovery" },
  "section-rise": { headline: "Next comes the follow-up" },
  "section-trace": { headline: "Start with call reviews" },
  "section-wipe": { headline: "Let's talk about price" },
  "section-aperture": { headline: "Now for the handoff" },
  "section-ribbon": { headline: "Coach the next call" },
  "section-footer": { headline: "Check the decision process" },
  "section-node": { headline: "Move from discovery to fit" },
  "section-number": chapter,
  "chapter-count-ring": chapter,
  "chapter-watermark": chapter,
  "term-lead-title": { term: "Discovery", headline: "Find out what needs to change" },
  "term-badge-title": { term: "CRM", headline: "Keep every follow-up in one place" },
  "lesson-question": { headline: "What are they hesitating over?" },
  "section-title-strips": { lines: ["Ask the question", "that gets them", "to name the goal"] },
};

function input(type, overrides = {}) {
  const values = { ...fixtures[type], ...overrides };
  const words = [];
  const pick = { type: batch[type].variantOf || type, design: type };
  const range = (value) => {
    const from = words.length;
    for (const text of value.split(" ")) {
      const start = 3 + words.length * 0.4;
      words.push({ text, start, end: start + 0.3 });
    }
    return { from, to: words.length - 1 };
  };
  for (const [name, value] of Object.entries(values)) {
    pick[name] = Array.isArray(value) ? value.map(range) : range(value);
  }
  return { words, pick };
}

function overlay(type, overrides) {
  const { words, pick } = input(type, overrides);
  const o = groundCard(pick, type, words);
  assert.ok(o, `${type} grounds ${JSON.stringify(overrides || {})}`);
  return { ...o, id: `test-${type}`, place: { x: 180, y: 288, scale: 1 } };
}

function rendering(type, overrides) {
  const o = overlay(type, overrides), calls = [];
  const tl = {};
  for (const method of ["fromTo", "to"]) {
    tl[method] = (...args) => { calls.push({ method, args }); return tl; };
  }
  new Function("tl", proTimeline([o]))(tl);
  return { ...renderProOverlay(o), o, calls };
}

const plain = (html) => html.replaceAll("<br>", " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
const selector = (r, suffix) => r.calls.find(({ args }) => args[0].endsWith(suffix))?.args;
const copySelectors = { headline: ".ks-copy", number: ".ks-number", term: ".ks-term" };

test("all sixty Kallaway sections have a decision and every built design lists its sources", () => {
  const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/herk-triage-ksection.json", import.meta.url), "utf8"));
  const names = `ascend aurora-bars beam boxed breath chaptercard column-light constellation countdown curtain dawn depth
    divider drift-grid duotone eclipse emblem flare-sweep glow-rule gradient-word gridfloor halo horizon index kinetic
    lensflare liquid marquee mesh monolith node-title numeral orb orbit particles pill portal prism question quoteopen
    reveal-mask ribbon ripple searchbar slab sphere-top split-reveal splitpanel spotlight spotlight-cone stack stacked-words
    starfield sweep tunnel type-scale typed underline-grow waveform wordmark`.split(/\s+/);
  assert.deepEqual(triage.map(({ id }) => id), names.map((name) => `kallaway.t1.section.${name}`));
  for (const entry of triage) {
    assert.ok(entry.reason.trim() && !entry.reason.includes("\n"), entry.id);
    switch (entry.outcome) {
      case "unfit":
        assert.equal(entry.type, undefined, entry.id);
        break;
      case "duplicate":
        assert.ok(CARDS[entry.type] && !batch[entry.type], entry.id);
        break;
      case "new":
      case "variant":
      case "merged":
        assert.ok(batch[entry.type]?.source.split(",").includes(`herk:${entry.id}`), entry.id);
        if (entry.outcome !== "merged") assert.equal(!!batch[entry.type].variantOf, entry.outcome === "variant", entry.id);
        break;
      default:
        assert.fail(`${entry.id}: ${entry.outcome}`);
    }
  }
  for (const [type, def] of Object.entries(batch)) {
    const entries = triage.filter((entry) => entry.type === type);
    assert.equal(entries.filter((entry) => ["new", "variant"].includes(entry.outcome)).length, 1, type);
    assert.deepEqual(def.source.split(",").sort(), entries.map(({ id }) => `herk:${id}`).sort(), type);
  }
});

test("every section design registers, grounds exact words and fits both safe placement widths", () => {
  assert.deepEqual(Object.keys(batch), Object.keys(fixtures));
  const zone = zoneFor();
  for (const [type, def] of Object.entries(batch)) {
    assert.equal(CARDS[type], def);
    const root = def.variantOf || type;
    assert.ok(CARD_GROUPS[root].includes(type));
    assert.ok(def.hint.length > 40 && !def.hint.includes("\n"));
    assert.ok(tagsOf(type).length >= 1 && tagsOf(type).length <= 3 && tagsOf(type).every((tag) => TAG_WORDS.includes(tag)));
    const { words, pick } = input(type);
    const grounded = groundCard(pick, type, words), planned = groundProOverlay(pick, words);
    assert.ok(grounded, type);
    assert.deepEqual(planned, CARD_GROUPS[root].length > 1 ? { ...grounded, group: root } : grounded, type);
    assert.ok(!def.fullscreen);
    const size = proSize(grounded);
    assert.ok(PRO_RECTS.some((r) => size.w <= r.w && size.h <= r.h), type);
    for (const y of [288, 928]) {
      assert.ok(180 >= zone.left && y >= zone.top && y + size.h <= zone.bottom);
      assert.ok(180 + size.w <= rightLimit(zone, y, y + size.h), type);
    }
    assert.deepEqual(grounded.reveals, grounded.phrases.map((item) => words[item.from].start), type);
    for (const [name, items] of Object.entries(grounded.slots)) {
      assert.deepEqual(items.map(({ text }) => text), [fixtures[type][name]].flat(), `${type}.${name}`);
      const slot = def.slots[name];
      for (const item of items) {
        const effectiveSize = item.fontSize || slot.size;
        assert.ok(effectiveSize >= (name === "number" ? 96 : 40));
        assert.ok(item.lines.every((line) => proTextWidth(line, effectiveSize) <= slot.width));
        assert.ok(item.lines.length <= slot.maxLines);
      }
    }
  }
});

test("every spoken slot rejects invented text, missing or reversed ranges and oversized copy", () => {
  for (const [type, def] of Object.entries(batch)) {
    const { words, pick } = input(type);
    for (const [name, slot] of Object.entries(def.slots)) {
      for (const value of [undefined, "invented phrase", { text: "invented phrase" }, { from: -1 }, { from: 2, to: 1 }, { from: words.length }]) {
        const raw = slot.repeat && value != null ? [value, pick[name][1]] : value;
        assert.equal(groundCard({ ...pick, [name]: raw }, type, words), null, `${type}.${name}: ${JSON.stringify(raw)}`);
      }
      const oversized = "x".repeat(slot.maxChars + 1);
      const value = slot.repeat ? [oversized, "Next action"] : oversized;
      const long = input(type, { [name]: value });
      assert.equal(groundCard(long.pick, type, long.words), null, `${type}.${name} length`);
    }
  }
  for (const type of ["section-number", "chapter-count-ring", "chapter-watermark"]) {
    for (const number of ["roughly", "three or four", "2.5", "4/9", "100", "2%", "I", "02 / 05"]) {
      const { words, pick } = input(type, { number });
      assert.equal(groundCard(pick, type, words), null, `${type}: ${number}`);
    }
    for (const number of ["0", "1", "02", "99", "zero", "ten", "seven", "Seven.", "THREE,"]) {
      const o = overlay(type, { number }), item = o.slots.number[0];
      assert.equal(item.text, number);
      assert.ok(item.fontSize == null || item.fontSize >= 96, `${type}: ${number}`);
    }
  }
  const longTerm = input("term-badge-title", { term: "Discovery" });
  assert.equal(groundCard(longTerm.pick, "term-badge-title", longTerm.words), null);
  assert.equal(groundProOverlay(longTerm.pick, longTerm.words).type, "term-lead-title");
});

test("copy is escaped and every spoken range writes in at its exact reveal", () => {
  const escaped = "<b> & 'x'";
  for (const [type, def] of Object.entries(batch)) {
    const overrides = def.slots.lines ? { lines: [escaped, "Name their goal"] } : { headline: escaped };
    const r = rendering(type, overrides);
    assert.doesNotMatch(r.html, /<b>/);
    assert.ok(plain(r.html).includes("&lt;b&gt; &amp; &#39;x&#39;"), type);
    const sample = rendering(type);
    const visible = plain(sample.html).replaceAll("&#39;", "'");
    for (const [name, items] of Object.entries(sample.o.slots)) {
      for (const [i, item] of items.entries()) {
        assert.ok(visible.includes(item.text), `${type}: ${item.text}`);
        const args = selector(sample, name === "lines" ? `.ks-strip-${i} .ks-copy` : copySelectors[name]);
        assert.equal(args[1].opacity, 0, type);
        assert.equal(args[2].opacity, 1, type);
        assert.equal(args[2].duration, PRO_MOTION.enter, type);
        assert.equal(args[3], item.at, type);
      }
    }
    for (const { method, args } of sample.calls) {
      const final = method === "fromTo" ? args[2] : args[1];
      if (method === "fromTo") assert.equal(final.immediateRender, false, type);
      assert.ok([PRO_MOTION.enter, PRO_MOTION.state, PRO_MOTION.exit].includes(final.duration));
      assert.equal(typeof final.ease, "function");
    }
    assert.doesNotMatch(sample.timeline, /NaN|undefined|Date|Math\.random|repeat:|yoyo:|rotation/);
    assert.deepEqual(visible.match(/\d+/g) || [], sample.o.phrases.flatMap(({ text }) => text.match(/\d+/g) || []));
  }
});

test("the source motion survives as seekable wipes, draws, rises and alternating strips", () => {
  const rise = rendering("section-rise");
  const word = selector(rise, ".ks-word");
  assert.equal(word[1].y, 12);
  assert.equal(word[2].y, 0);
  assert.equal(word[3], rise.o.reveals[0]);
  assert.equal((rise.html.match(/class="ks-word"/g) || []).length, rise.o.slots.headline[0].text.split(" ").length);

  const wipe = rendering("section-wipe");
  assert.equal(selector(wipe, ".ks-caret")[2].left, "100%");
  assert.equal(selector(wipe, ".ks-copy")[1].clipPath, "inset(0 100% 0 0)");
  assert.equal(selector(rendering("section-aperture"), ".ks-copy")[1].clipPath, "inset(50% 0 50% 0)");
  assert.equal(selector(rendering("section-ribbon"), ".ks-band")[2].clipPath, "inset(0 0% 0 0)");

  for (const [type, path] of [
    ["section-trace", ".ks-frame .ks-draw"],
    ["section-node", ".ks-link .ks-draw"],
    ["chapter-count-ring", ".ks-counter .ks-draw"],
  ]) {
    const r = rendering(type), args = selector(r, path);
    assert.match(r.html, /pathLength="1"/);
    assert.equal(args[1].strokeDashoffset, 1);
    assert.equal(args[2].strokeDashoffset, 0);
    assert.equal(args[2].duration, PRO_MOTION.state);
    assert.equal(args[3], r.o.reveals[0]);
  }
  const ring = rendering("chapter-count-ring", { number: "02" });
  assert.deepEqual(plain(ring.html).match(/\d+/g), ["02"], "no manufactured counts during the ring reveal");

  const strips = rendering("section-title-strips");
  assert.deepEqual(proSize(strips.o), { w: 720, h: 248 });
  assert.deepEqual(proSize(overlay("section-title-strips", { lines: ["How to handle", "the price objection"] })), { w: 720, h: 168 });
  assert.deepEqual(strips.o.reveals.map((at, i) => {
    const args = selector(strips, `.ks-strip-${i}`);
    assert.equal(args[3], at);
    return args[1].x;
  }), [-16, 16, -16]);
});

test("the pro composition includes each design's scoped CSS and existing looks ignore these overlays", () => {
  const palette = ["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"];
  for (const [type, { css }] of Object.entries(batch)) {
    assert.ok(proCSS({ types: new Set([type]) }).includes(css), type);
    assert.ok(!proCSS({ types: new Set(["objection"]) }).includes(css), type);
    for (const [, selectors] of css.matchAll(/([^{}]+)\{/g)) {
      for (const part of selectors.trim().split(",")) {
        const selector = part.trim();
        assert.ok(selector === `.pro-${type}` || selector.startsWith(`.pro-${type} `), selector);
      }
    }
    for (const [color] of css.matchAll(/#[\da-f]+/gi)) assert.ok(palette.includes(color), color);
    for (const [, font] of css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font), font);
    assert.doesNotMatch(css, /rgba?\(|hsla?\(|gradient|filter:|text-shadow|@keyframes|animation:/i);
  }
  const pro = fixturePlan("/fixture.mp4");
  pro.preset = "pingel-pro";
  pro.style = loadPreset(pro.preset);
  for (const [type, { css }] of Object.entries(batch)) {
    const o = overlay(type);
    pro.proGraphics = [o];
    const html = renderHTML(pro, "fixture.mp4");
    assert.ok(html.includes(`class="pro-overlay pro-${type}`), type);
    assert.ok(html.includes(css), type);
    assert.ok(html.includes(renderProOverlay(o).timeline), type);
  }
  for (const preset of ["pingel-brand", "pingel-bold", "clean", "vsl"]) {
    const plan = fixturePlan("/fixture.mp4");
    plan.preset = preset;
    plan.style = loadPreset(preset);
    const before = renderHTML(plan, "fixture.mp4");
    plan.proGraphics = Object.keys(batch).map((type) => overlay(type));
    assert.equal(renderHTML(plan, "fixture.mp4"), before, preset);
  }
});

test("vendored GSAP keeps staggered words and number states stable when shuffling frame seeks", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true }), targets = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const tl = {};
  for (const method of ["fromTo", "to"]) {
    tl[method] = (selector, ...args) => {
      if (!targets.has(selector)) {
        const count = selector.endsWith(".ks-word") ? fixtures["section-rise"].headline.split(" ").length : 1;
        targets.set(selector, Array.from({ length: count }, () => ({
          opacity: selector.endsWith(".ks-draw") ? 1 : 0,
          y: 0, scale: 1, clipPath: "inset(0 100% 0 0)", strokeDashoffset: 1,
        })));
      }
      timeline[method](targets.get(selector), ...args);
      return tl;
    };
  }
  const overlays = [overlay("section-rise"), overlay("chapter-count-ring")];
  new Function("tl", proTimeline(overlays))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...targets].flatMap(([selector, items]) => {
      const panel = targets.get(selector.split(" ")[0])[0];
      return items.map(({ opacity, y, clipPath, strokeDashoffset }) =>
        panel.opacity === 0 || opacity === 0 ? null : [opacity, y, clipPath, strokeDashoffset]);
    });
  };
  const frames = Array.from({ length: 251 }, (_, i) => i), forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (const i of frames) {
    const frame = i * 97 % frames.length;
    assert.deepEqual(snapshot(frame), forward[frame], `shuffle ${frame}`);
  }
});
