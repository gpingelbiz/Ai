import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { CARDS as batch } from "../src/pro-cards/ge-a.mjs";
import { CARDS, CARD_GROUPS, TAG_WORDS, tagsOf } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proPrompt, proSize, PRO_MOTION } from "../src/pro.mjs";
import { proCSS, proTimeline, renderProOverlay } from "../src/pro-render.mjs";
import { rightLimit, zoneFor } from "../src/safe-zone.mjs";

const triage = JSON.parse(readFileSync(new URL("../src/pro-cards/ge-triage-a.json", import.meta.url), "utf8"));
const sourceIds = `
date-picker-wheel lockscreen-notifications search-stalled-bar mail-inbox-call-banner tasks-five-to-one screen-time-report
live-dictation files-drafts camera-viewfinder-shutter app-switcher-flick home-badges-jiggle callback-open-app figma-selection-box
ios-text-selection perspective-text-ring battery-low-alert great-vibes-wipe markup-pen-marck quicktype-tap-up fullscreen-type-stop
broll-callback-cold calendar-day-fills maps-pin-drop ai-chat-summary-and-typing mini-site-builds-itself contract-signature-x2
bottom-sheet markup-highlighter-scribble countdown-pill signature-pad-bad-script screen-time-pill-counting book-card-apple-books
settings-notifications-toggles-off app-icon-badges-silenced activity-rings-over-broll marck-script-signature-word two-button-alert-tapped
storage-bar-free-space-grows phone-mockup-lockscreen maps-look-around-card maps-place-card-photo figma-reject-strike
figma-delete-backspace hero-number-card highlighter-sweep scene-caption-line italic-hero-word-card quoted-speech-italic-cards
label-rename-retype ios-notification-banner messages-chat-thread likes-notification-pile files-zip-unpack apple-pay-faceid-sheet
search-bar-typing contact-card-tags voice-memo-waveform translate-typing maps-route-hazards maps-directions-options maps-region-routes
maps-zoom-village-to-world`.trim().split(/\s+/).map((id) => `clean-os/${id}`);

const fixtures = {
  "focus-shortlist": { discard: ["Refresh the dashboard", "Rewrite the deck", "Order new cards", "Build a tracker"], keep: "Call the open opportunities" },
  "lead-tagging": { segment: "Inbound leads", tags: ["Budget approved", "Needs discovery", "Early-stage"] },
  "query-caret": { query: "Why are my qualified leads going cold?" },
  "dictated-message": { message: "Can we move the call to Thursday?" },
  "phrase-selection": { line: "The next question matters more than the pitch" },
  "strike-selection": { habit: "Explaining before you ask" },
  "retype-word": { before: "you need", word: "motivation", after: "to start", replacement: "discipline" },
  "decision-confirm": { first: "Send the deck", second: "Ask what's missing" },
  "route-choice": { left: "Jump into the price", right: "Ask about the problem" },
  "reply-promote": { incoming: "Can you send more info?", replies: ["Of course", "I'll send it", "Which part?"] },
  "pen-write-word": { word: "Certainty" },
  "stat-shutter": { value: "eighty-eight", context: "Discovery calls last month" },
  "battery-readout": { value: "eighty-eight percent", context: "of their capacity remaining" },
  "share-shift": { before: "eighty-eight percent", after: "twenty-eight percent", label: "Time spent rescheduling" },
  "countdown-window": { counts: ["eighty-eight", "fifty-four", "23", "1"] },
  "booking-stamp": { event: "Discovery call", date: "Wednesday at 4", details: "With the full team" },
  "layered-alerts": { title1: "New lead", message1: "Do you have time?", title2: "Missed call", message2: "Give me a ring", title3: "Booked", message3: "See you Thursday" },
  "thread-handoff": { messages: ["Send me the pricing", "Which option did you need?", "The one we discussed yesterday"] },
  "voicemail-playhead": { transcript: "Hey, quick question about the consult we booked" },
};

// Numeric slots use valid spoken quantities for their width checks.
const numericFields = {
  "stat-shutter": ["value"],
  "battery-readout": ["value"],
  "share-shift": ["before", "after"],
  "countdown-window": ["counts"],
};
const isNumeric = (type, name) => numericFields[type]?.includes(name);

function transcript(type, data = fixtures[type]) {
  const words = [], pick = { type };
  let clock = 3.125;
  for (const [name, slot] of Object.entries(batch[type].slots)) {
    const value = data[name];
    if (value === undefined) continue;
    const range = (line) => {
      const from = words.length;
      for (const text of line.split(/\s+/)) {
        words.push({ text, start: clock, end: clock + .125 });
        clock += .175;
      }
      clock += .3;
      return { from, to: words.length - 1 };
    };
    pick[name] = slot.repeat ? value.map(range) : range(value);
  }
  return { words, pick };
}

function grounded(type, data) {
  const { words, pick } = transcript(type, data);
  return groundCard(pick, type, words);
}

function replace(data, name, index, value) {
  const previous = data[name];
  return { ...data, [name]: Array.isArray(previous) ? previous.map((item, i) => i === index ? value : item) : value };
}

const sampleFrame = { measured: true, W: 1080, H: 1920, head: { x: 400, y: 740, w: 200, h: 200 } };
const zone = zoneFor();
const ownPal = ["#0b0b0d", "#f5f1e8", "#c8a24b", "#a8a49c", "#343438"];
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");

function capture(overlay) {
  const calls = [], tl = {};
  tl.fromTo = (target, from, to, at) => { calls.push({ target, from, to, at }); return tl; };
  tl.set = (target, to, at) => { calls.push({ target, to, at }); return tl; };
  tl.to = (target, to, at) => { calls.push({ target, to, at }); return tl; };
  vm.runInNewContext(proTimeline([overlay]), { tl });
  return calls;
}

test("Clean OS triage accounts for the 62 assigned elements and retained cards carry their MIT attribution", () => {
  assert.deepEqual(triage.map(({ id }) => id), sourceIds);
  assert.equal(new Set(sourceIds).size, 62);
  assert.ok(triage.filter(({ outcome }) => outcome === "new").length <= 8);
  for (const row of triage) {
    assert.match(row.reason, /^[^\n]+$/);
    if (row.outcome === "unfit") assert.equal(row.type, undefined);
    else if (row.outcome === "duplicate") assert.ok(CARDS[row.type] && !batch[row.type]);
    else if (row.outcome === "deferred") assert.ok(row.type && !CARDS[row.type]);
    // Cut at merge: the card was built, then deliberately dropped, so it must not survive in the registry.
    else if (row.outcome === "cut") { assert.ok(row.type && !CARDS[row.type], row.id); assert.match(row.reason, /^cut at merge:/, row.id); }
    else {
      assert.ok(["new", "variant", "merged"].includes(row.outcome));
      assert.ok(batch[row.type]?.source.split(",").includes(`ghost-editor:${row.id}`));
    }
  }
  for (const [type, def] of Object.entries(batch)) {
    const rows = triage.filter((row) => row.type === type);
    assert.equal(rows.filter((row) => row.outcome === (def.variantOf ? "variant" : "new")).length, 1);
    assert.deepEqual(def.source.split(",").sort(), rows.map(({ id }) => `ghost-editor:${id}`).sort());
  }
  const module = readFileSync(new URL("../src/pro-cards/ge-a.mjs", import.meta.url), "utf8");
  assert.match(module.split("\n")[0], /ghost-editor.*MIT.*2026 kurbaitaev.*GHOST-EDITOR-LICENSE\.md/);
  assert.match(readFileSync(new URL("../src/pro-cards/GHOST-EDITOR-LICENSE.md", import.meta.url), "utf8"), /MIT License[\s\S]*Copyright \(c\) 2026 kurbaitaev/);
});

for (const [type, def] of Object.entries(batch)) {
  const data = fixtures[type];
  const expected = Object.values(data).flat();

  test(`${type} registers, grounds exact ranges and starts each write at the spoken beat`, () => {
    assert.equal(CARDS[type], def);
    assert.ok(CARD_GROUPS[def.variantOf || type].includes(type));
    const { words, pick } = transcript(type);
    const prompt = proPrompt(words);
    assert.equal(prompt.split("\n").filter((line) => line.startsWith(`${type} <`)).length, def.variantOf ? 0 : 1);
    const card = groundProOverlay({ ...pick, type: def.variantOf || type, design: type }, words);
    assert.equal(card?.type, type);
    assert.deepEqual(card.phrases.map(({ text }) => text), expected);
    assert.deepEqual(card.reveals, card.phrases.map(({ from }) => words[from].start));
    const place = placeProOverlay(card, sampleFrame);
    assert.ok(place, "fits a real placement");
    const { w, h } = proSize(card);
    assert.ok(w > 0 && h > 0 && w <= 720 && h <= 560);
    const scale = place.scale ?? 1;
    assert.ok(place.x >= zone.left && place.y >= zone.top && place.y + h * scale <= zone.bottom);
    assert.ok(place.x + w * scale <= rightLimit(zone, place.y, place.y + h * scale) + 0.01);

    const overlay = { ...card, id: `test-${type}`, place };
    const { html, timeline } = renderProOverlay(overlay);
    assert.match(html, new RegExp(`pro-${type}[" ]`));
    assert.deepEqual(renderProOverlay(overlay), { html, timeline });
    for (const item of card.phrases) {
      for (const line of item.lines) assert.ok(html.includes(esc(line)), `${type} shows "${line}"`);
    }
    const events = capture(overlay);
    for (const at of card.reveals) {
      const rounded = Math.round(at * 1000) / 1000;
      assert.ok(events.some((event) => event.target.startsWith(`#${overlay.id} `) &&
        event.at === rounded && (event.to.clipPath || event.to.display === "inline")), `writes at ${rounded}`);
    }
    for (const event of events.filter(({ target }) => target.startsWith(`#${overlay.id} `))) {
      assert.ok(event.to.duration === undefined || [PRO_MOTION.enter, PRO_MOTION.state].includes(event.to.duration));
      assert.ok(event.to.ease === undefined || typeof event.to.ease === "function");
      assert.ok(Object.keys(event.to).every((key) => !["rotation", "repeat", "filter", "shake"].includes(key)));
      assert.ok(event.from?.y === undefined || Math.abs(event.from.y) <= 16);
    }
  });

  test(`${type} rejects invented/oversized prose and keeps long fields at their authored size`, () => {
    for (const [name, slot] of Object.entries(def.slots)) {
      const { words, pick } = transcript(type);
      pick[name] = slot.repeat ? pick[name].map(() => "invented words") : "invented words";
      assert.equal(groundCard(pick, type, words), null);
      const instances = slot.repeat ? data[name].length : 1;
      for (let i = 0; i < instances; i++) {
        assert.equal(grounded(type, replace(data, name, i, "x".repeat(slot.maxChars + 1))), null);
        const word = type === "battery-readout" && name === "context" ? "Confirmation remaining" : "Confirmation";
        if (!isNumeric(type, name)) {
          assert.equal("Confirmation".length, 12);
          const fit = grounded(type, replace(data, name, i, word));
          assert.ok(fit, `${name}[${i}] fits a 12-letter word`);
          assert.deepEqual(fit.slots[name][i].lines, [word]);
          assert.equal(fit.slots[name][i].fontSize, undefined);
        } else {
          assert.equal(grounded(type, replace(data, name, i, "not a value")), null);
        }
      }
    }
  });

  test(`${type} escapes exact markup and keeps CSS scoped to the house look`, () => {
    const field = Object.keys(def.slots).find((name) => !isNumeric(type, name));
    if (field) {
      const unsafe = type === "battery-readout" ? "<b>& left" : "<b>&";
      const card = grounded(type, replace(data, field, 0, unsafe));
      assert.ok(card?.slots[field][0].text === unsafe);
      const { html } = renderProOverlay({ ...card, id: "escape", place: { x: 160, y: 180 } });
      assert.ok(html.includes(esc(unsafe)), "shows escaped speech");
      assert.doesNotMatch(html, /<b>|<img|<video|<script/);
    }
    assert.ok(tagsOf(type).length > 0 && tagsOf(type).length <= 3 && tagsOf(type).every((tag) => TAG_WORDS.includes(tag)));
    for (const match of def.css.matchAll(/([^{}]+)\{/g)) {
      for (const selector of match[1].trim().split(",")) {
        assert.match(selector.trim(), new RegExp(`^\\.pro-${type}(?=$|[\\s.>:#\\[])`));
      }
    }
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css));
    const overlay = { ...grounded(type), id: "check", place: { x: 160, y: 180 } };
    const { html, timeline } = renderProOverlay(overlay);
    const authored = def.css + timeline + html;
    assert.ok((authored.match(/#[0-9a-f]{6}\b/gi) || []).every((color) => ownPal.includes(color.toLowerCase())));
    for (const font of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(font[1]));
    assert.doesNotMatch(authored, /(?:gradient|blur|Math\.random|new Date|url\(|font-size:\s*[1-3]\dpx)/i);
    for (const [, heading] of html.matchAll(/class="ga-label">([^<]+)</g)) {
      assert.doesNotMatch(heading, /\d/);
      assert.ok(heading.split(/\s+/).length <= 4);
    }
  });
}

test("percentage and duration graphics never invent a numeric value", () => {
  assert.equal(grounded("battery-readout", { value: "101%", context: "capacity remaining" }), null);
  assert.equal(grounded("battery-readout", { value: "40%", context: "close rate" }), null);
  assert.equal(grounded("share-shift", { before: "12%", after: "12 percent", label: "close rate" }), null);
  assert.equal(grounded("countdown-window", { counts: ["three", "four"] }), null);
  const card = grounded("share-shift", { before: "40%", after: "20%", label: "Lost opportunities" });
  const overlay = { ...card, id: "shares", place: { x: 180, y: 240 } };
  const { html } = renderProOverlay(overlay);
  assert.deepEqual(html.match(/\d+%(?=<)/g), ["40%", "20%"]);
  const calls = capture(overlay);
  assert.deepEqual(calls.filter(({ target }) => target.endsWith(".ga-part")).map(({ to }) => to.scaleX), [.4, .2]);
  assert.deepEqual(calls.filter(({ target }) => target.endsWith(".ga-rest")).map(({ to }) => to.scaleX), [.6, .8]);
});

test("optional slots and short repeats stay deployable", () => {
  assert.ok(grounded("booking-stamp", { event: "Booked a call" }));
  assert.ok(grounded("booking-stamp", { event: "Booked a call", details: "With the founder" }));
  assert.ok(grounded("thread-handoff", { messages: ["It works for me"] }));
  assert.ok(grounded("retype-word", { word: "busy", replacement: "focused" }));
  const { words, pick } = transcript("retype-word");
  const altered = { ...pick, before: { from: 0, to: 0 } };
  assert.equal(groundCard(altered, "retype-word", words), null, "surrounding words must be contiguous");
});
