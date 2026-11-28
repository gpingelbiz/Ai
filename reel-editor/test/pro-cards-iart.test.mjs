import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CARDS as imported } from "../src/pro-cards/iart-cards.mjs";
import { CARDS, rootOf, tagsOf } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proSize, proTextLines, PRO_MOTION } from "../src/pro.mjs";
import { proCSS, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const fixtures = {
  "handoff-duration": { origin: "Inbound", destination: "Discovery", duration: "15 minutes" },
  "message-read-state": { message: "Can we book the call?", status: "they left me on read" },
  "masked-topic": { headline: "The discovery question that changes the whole call" },
  "spelled-emphasis": { word: "Discovery" },
  "weight-emphasis": { word: "Confidence" },
  "outline-emphasis": { word: "Follow-up" },
  "alert-scroll-tray": {
    title1: "New inquiry", message1: "Can we talk next week?",
    title2: "Reply received", message2: "I could do Thursday",
    title3: "Call confirmed", message3: "Send me the details",
  },
  "client-quote-mask": { name: "Coaching client", quote: "I can diagnose the problem before I try to pitch the offer" },
  "count-hinge": { counts: ["four", "three", "two", "one"] },
  "tall-figure-wipe": { value: "forty percent", context: "of discovery calls booked" },
  "packet-handoff": { stages: ["Qualify leads", "Write the notes", "Confirm handoff", "Book a call"] },
  "sketched-outcomes": { root: "Ask for permission", outcomes: ["They elaborate", "They decline", "They ask why"] },
  "stacked-system-deck": { layers: ["Practice", "Discovery", "Recommendations", "Follow-up"] },
  "chapter-bullets": { topics: ["Goals", "Discovery", "Objections", "Price", "Close"] },
  "headline-word-build": { lines: ["Ask first", "Listen twice", "Give them space", "Close with confidence"] },
  "duration-benchmark-rail": { heading: "Call length", items: ["First call 5 minutes", "Discovery 15 minutes", "30 minutes for coaching", "one hour of review"] },
};

function grounded(type, overrides = {}, ground = groundCard) {
  const fields = { ...fixtures[type], ...overrides };
  const pick = { type: rootOf(type), design: type };
  const words = [];
  const span = (text) => {
    const from = words.length;
    for (const token of text.split(" ")) {
      const start = 3 + words.length * 0.347;
      words.push({ text: token, start, end: start + 0.26 });
    }
    // The grounder takes the transcript text even when a request also supplies a paraphrase.
    return { from, to: words.length - 1, text: "Invented copy" };
  };
  for (const [name, field] of Object.entries(imported[type].slots)) {
    const raw = fields[name];
    if (raw === undefined) continue;
    pick[name] = field.kind === "label" ? raw : field.repeat ? raw.map(span) : span(raw);
  }
  return ground === groundCard ? ground(pick, type, words) : ground(pick, words);
}

function render(o) {
  const zone = zoneFor();
  const head = { x: 410, y: 840, w: 260, h: 225 };
  const place = placeProOverlay(o, { W: zone.W, H: zone.H, measured: true, head });
  assert.ok(place, "chosen placement");
  assert.ok(place.x >= zone.left && place.y >= zone.top);
  assert.ok(place.x + place.w <= rightLimit(zone, place.y, place.y + place.h));
  assert.ok(place.y + place.h + 16 <= head.y - 56);
  const drawn = renderProOverlay({ ...o, id: "iart-sample", place });
  return drawn;
}

function events(timeline) {
  const records = [];
  const tl = { fromTo: (target, from, to, at) => records.push({ target, from, to, at }), to: () => {} };
  const proEnter = () => {}, proState = () => {}, proExit = () => {};
  new Function("tl", "proEnter", "proState", "proExit", timeline)(tl, proEnter, proState, proExit);
  return records;
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const colors = new Set(["#0b0b0d", "#f5f1e8", "#c8a24b", "#a8a49c", "#343438"]);
const twelveLetters = "illustration";

test("the iart triage accounts for every card source, covers the ten packs and keeps the MIT notice", () => {
  const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/iart-triage.json", import.meta.url)));
  const notice = fs.readFileSync(new URL("../src/pro-cards/IART-LICENSE.md", import.meta.url), "utf8");
  assert.match(notice, /MIT License/);
  assert.match(notice, /Copyright \(c\) 2026 iart\.ai/);
  assert.equal(new Set(triage.map(({ id }) => id)).size, triage.length);
  assert.equal(new Set(triage.map(({ id }) => id.split("/")[0])).size, 10);
  const skills = new Set(triage.map(({ id }) => id.split("#")[0]));
  for (const skill of skills) {
    assert.deepEqual(triage.find(({ id }) => id === `${skill}#technique`),
      { id: `${skill}#technique`, outcome: "unfit", reason: "technique, not a card" });
  }
  assert.ok(triage.filter((row) => row.outcome === "new").length <= 8);
  for (const row of triage) {
    assert.match(row.id, /^iart:iart-[a-z-]+-skills\/[a-z-]+#[a-z0-9-]+$/);
    assert.ok(row.reason && !row.reason.includes("\n"));
    switch (row.outcome) {
      case "new":
      case "variant":
      case "merged":
        assert.ok(imported[row.type]?.source.split(",").includes(row.id), row.id);
        if (row.outcome !== "merged") assert.equal(Boolean(imported[row.type].variantOf), row.outcome === "variant");
        break;
      case "duplicate":
        assert.ok(CARDS[row.type] && !imported[row.type], row.id);
        break;
      case "deferred":
        assert.match(row.type, /^[a-z]+(?:-[a-z]+)*$/);
        assert.ok(!CARDS[row.type], row.id);
        break;
      case "unfit":
        assert.equal(row.type, undefined);
        break;
      // Cut at merge: the card was built here, then deliberately dropped from this lane. role-handoff survives
      // in CARDS (ge-e kept its own build of the same meaning), so check this lane's own import, not the registry.
      case "cut":
        assert.ok(row.type && !imported[row.type], row.id);
        assert.match(row.reason, /^cut at merge:/, row.id);
        break;
      default:
        assert.fail(row.outcome);
    }
  }
  for (const [type, def] of Object.entries(imported)) {
    const ids = triage.filter((row) => row.type === type).map((row) => row.id);
    assert.deepEqual(def.source.split(",").sort(), ids.sort(), type);
    assert.equal(triage.filter((row) => row.type === type && ["new", "variant"].includes(row.outcome)).length, 1);
  }
});

for (const [type, def] of Object.entries(imported)) {
  test(`${type} registers, grounds exact copy and reveals it through the panel`, () => {
    assert.equal(CARDS[type], def);
    assert.ok(tagsOf(type).length);
    const o = grounded(type);
    assert.ok(o, "grounded fixture");
    assert.equal(grounded(type, {}, groundProOverlay)?.type, type, "routed through design selection");
    const expected = Object.entries(def.slots).flatMap(([name, field]) => field.kind === "spoken" ? fixtures[type][name] ?? [] : []);
    assert.deepEqual(o.phrases.map((p) => p.text), expected);
    assert.deepEqual(o.reveals, o.phrases.map((p) => p.at));

    const size = proSize(o);
    assert.ok(size.w > 0 && size.w <= 720 && size.h > 0 && size.h <= 560);
    assert.ok(!def.fullscreen);
    const { html, timeline } = render(o);
    assert.equal(html.includes("Invented copy"), false);
    const recorded = events(timeline).filter(({ target }) => target.startsWith("#iart-sample "));
    for (const p of o.phrases) {
      assert.ok(!p.fontSize, `Authored size for "${p.text}"`);
      assert.ok(html.includes(esc(p.text)) || html.includes(p.lines.map(esc).join("<br>")), p.text);
      assert.ok(recorded.some(({ at, from, to }) =>
        at === Number(p.at.toFixed(3)) && from.opacity === 0 && to.opacity === 1), `Reveal for "${p.text}"`);
    }
    for (const { target, to } of recorded) {
      assert.ok(target.startsWith("#iart-sample .ia-"));
      assert.ok([PRO_MOTION.enter, PRO_MOTION.state].includes(to.duration));
      assert.equal(typeof to.ease, "function");
      assert.equal(to.immediateRender, false);
    }
  });

  test(`${type} fits phone type and rejects unsupported spoken ranges`, () => {
    const css = def.css.trim();
    for (const block of css.split("}").filter((rule) => rule.trim())) {
      for (const selector of block.split("{")[0].split(",")) {
        assert.match(selector.trim(), new RegExp(`^\\.pro-${type}(?=[\\s.:#[]|$)`));
      }
    }
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css));
    assert.doesNotMatch(css, /\b(?:url|gradient|filter|text-shadow)\s*[:(]/i);
    for (const color of css.match(/#[\da-f]{6}\b/gi) ?? []) assert.ok(colors.has(color.toLowerCase()), color);
    for (const font of css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Anton", "Inter"].includes(font[1]));

    assert.equal(twelveLetters.length, 12);
    for (const [name, field] of Object.entries(def.slots)) {
      if (field.kind === "label") {
        assert.ok(field.size >= 28);
        assert.equal(grounded(type, { [name]: "Follow up 3 times" }), null);
        continue;
      }
      assert.ok(field.size >= 40 && field.maxChars >= 12, name);
      assert.deepEqual(proTextLines(twelveLetters, { ...field, maxLines: 1 }), [twelveLetters], name);
      const replace = (value) => {
        const raw = fixtures[type][name];
        return field.repeat ? [value, ...raw.slice(1)] : value;
      };
      assert.equal(grounded(type, { [name]: replace("W".repeat(field.maxChars + 1)) }), null, name);
      const fit = grounded(type, { [name]: replace(twelveLetters) });
      // Structured slots have a narrower semantic contract than the text box.
      const semantic = {
        "handoff-duration": ["duration"], "message-read-state": ["status"], "count-hinge": ["counts"],
        "tall-figure-wipe": ["value"], "duration-benchmark-rail": ["items"],
      };
      if (semantic[type]?.includes(name)) assert.equal(fit, null, name);
      else assert.ok(fit, `Grounded a twelve-letter word in ${name}`);
    }
  });
}

test("all iart designs escape spoken HTML while numeric designs reject markup in the quantity", () => {
  for (const [type, def] of Object.entries(imported)) {
    for (const [name, field] of Object.entries(def.slots)) {
      const value = fixtures[type][name];
      if (field.kind !== "spoken" || value === undefined) continue;
      const hostile = "<&>'";
      const o = grounded(type, { [name]: field.repeat ? [hostile, ...value.slice(1)] : hostile });
      if (!o) continue;
      const { html } = render(o);
      assert.doesNotMatch(html, /<&>/, `${type}.${name}`);
      assert.ok(html.includes("&lt;") && html.includes("&amp;") && html.includes("&gt;") && html.includes("&#39;"), type);
    }
  }
});

test("numeric graphics keep comparable units and never display generated intermediate readings", () => {
  // rated-client-quote, shared-start-gap, contest-lead-shift and area-milestones were cut at merge (see iart-triage.json).
  assert.equal(grounded("duration-benchmark-rail", { items: ["4 months of work", "review 5 days"] }), null);
  assert.equal(grounded("duration-benchmark-rail", { items: ["4 to 7 months for leads", "review 8 months"] }), null);
  assert.equal(grounded("count-hinge", { counts: ["four", "two", "three"] }), null);

  const flop = render(grounded("count-hinge", { counts: ["six", "four"] }));
  assert.doesNotMatch(flop.html, /\bfive\b/);
});
