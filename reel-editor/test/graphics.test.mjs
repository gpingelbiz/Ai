import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeScene, placeScenes, sceneCandidates, graphicsCount, sceneHTML, scenesPrompt, sceneDuration, GRAPHICS_SCHEMA, proofMessageCSS } from "../src/graphics.mjs";
import { brollCandidates } from "../src/broll.mjs";
import { firstJSON } from "../src/claude.mjs";
import { renderHTML } from "../src/compose.mjs";

const groups = Array.from({ length: 40 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.8, text: `line ${i}`, words: [] }));

test("scenes: unknown types, empty fields and short lists are dropped; text is trimmed", () => {
  assert.equal(normalizeScene({ type: "chart", line: 3 }), null);
  assert.equal(normalizeScene({ type: "stat", line: 3, value: "" }), null);
  assert.equal(normalizeScene({ type: "list", line: 3, items: [{ text: "only one" }] }), null);
  assert.equal(normalizeScene({ type: "headline", line: "x", text: "Hi" }), null);
  const l = normalizeScene({ type: "list", line: "5", eyebrow: "WHAT TO STOP", items: ["Slam the desk", { text: "Go cold", state: "strike" }, { text: "Breathe", state: "check", tag: "do" }, { text: "a" }, { text: "b" }] });
  assert.equal(l.line, 5);
  assert.equal(l.items.length, 4);
  assert.deepEqual(l.items.map((i) => i.state), ["plain", "strike", "check", "plain"]);
  assert.equal(l.duration, sceneDuration(l));
});

test("placement: after the hook, spaced, ends before the CTA and the last 1.5s", () => {
  const cands = sceneCandidates(groups, 80, { hook: { start: 0, duration: 3 }, cta: { start: 72.5, duration: 3 } });
  assert.ok(cands.every((c) => c.start >= 3.5));
  const scenes = [
    { type: "headline", line: 10, text: "a", duration: 2.6 },
    { type: "headline", line: 2, text: "b", duration: 2.6 },
    { type: "headline", line: 11, text: "too close", duration: 2.6 },
    { type: "headline", line: 35, text: "runs into the CTA", duration: 2.6 },
    { type: "headline", line: 36, text: "no room before the CTA", duration: 2.6 },
    { type: "headline", line: 0, text: "in the hook", duration: 2.6 },
  ].map((s) => ({ ...s, eyebrow: "" }));
  const placed = placeScenes(scenes, cands, { duration: 80, cta: { start: 72.5 }, gap: 3 });
  assert.deepEqual(placed.map((s) => s.line), [2, 10, 35]);
  assert.equal(placed[2].start, 70);
  assert.equal(placed[2].duration, 2.5, "trimmed to end at the CTA");
  assert.equal(graphicsCount(8), 0);
  assert.equal(graphicsCount(12), 1, "a short reel still gets one card");
  assert.equal(graphicsCount(67), 6);
});

test("b-roll keeps clear of the cards", () => {
  const busy = [{ start: 10, duration: 3 }];
  const c = brollCandidates(groups, 80, { hook: { start: 0, duration: 3 }, busy, len: 2.4, clear: 1.5 });
  assert.ok(c.every((x) => x.start + 2.4 <= 8.5 || x.start >= 14.5));
  assert.ok(c.some((x) => x.start === 6) && c.some((x) => x.start === 16));
});

test("cards: escaped text, gold and highlight markup, strike lines, step links", () => {
  assert.match(sceneHTML({ type: "headline", eyebrow: "X", text: "Not who. *What happened?*" }), /<span class="g-gold">What happened\?<\/span>/);
  assert.match(sceneHTML({ type: "quote", eyebrow: "", text: "a <b> *can hear it*" }), /a &lt;b&gt; <span class="g-hl">can hear it<\/span>/);
  const list = sceneHTML({ type: "list", eyebrow: "", items: [{ text: "Go cold", state: "strike", tag: "" }, { text: "Breathe", state: "check", tag: "do" }] });
  assert.match(list, /g-strike-line/);
  assert.match(list, /class="g-tag">do</);
  assert.equal((sceneHTML({ type: "steps", eyebrow: "", items: [{ text: "a" }, { text: "b" }, { text: "c" }] }).match(/g-link/g) || []).length, 2);
  assert.match(sceneHTML({ type: "stat", eyebrow: "", value: "Almost 8 years", value2: "", sub: "" }), /calc\(var\(--u\) \* 89\)/);
  assert.match(sceneHTML({ type: "stat", eyebrow: "", value: "$10K", value2: "", sub: "" }), /calc\(var\(--u\) \* 170\)/);
});

test("the prompt keeps qualifiers, bans invented numbers and lists only allowed lines", () => {
  const cands = sceneCandidates(groups.slice(0, 6), 14, { hook: { start: 0, duration: 3 } });
  const p = scenesPrompt({ candidates: cands, transcript: "t", hook: "h", count: 1 });
  assert.match(p, /Almost 8 years/);
  assert.match(p, /Never invent numbers/);
  assert.match(p, /motion \("reveal" or "growth"\)/);
  assert.match(p, /at most two stat cards.*at least 8 seconds apart/);
  assert.match(p, /Set pivotLine to the line that contains the spoken contrast/);
  assert.match(p, /never reveal or make it readable before pivotLine/i);
  assert.match(p, /^2: 4\.0s line 2$/m);
  assert.doesNotMatch(p, /^0: /m);
  assert.deepEqual(firstJSON('Here: ```json\n{"scenes":[]}\n```'), { scenes: [] });
});

test("render: cards and reveal captions", () => {
  const plan = {
    name: "t",
    canvas: { width: 1080, height: 1920 },
    video: { duration: 20, hasAudio: true },
    style: { colors: { text: "#fff", accent: "#C8A24B", stroke: "#000", bg: "#0B0B0D" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none", style: "reveal" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: {}, cta: {} },
    captions: [{ start: 1, end: 2, text: "own it", words: [{ text: "own", start: 1, end: 1.4 }, { text: "it", start: 1.4, end: 1.8 }] }],
    graphics: [{ type: "headline", eyebrow: "E", text: "Own *it*", start: 6, duration: 2.6 }],
  };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /id="gfx-0" class="gfx clip gfx-headline skin-glass" data-start="6" data-duration="2.6"/);
  assert.ok(html.indexOf('id="gfx-0"') < html.indexOf('id="captions"'), "cards sit under the captions");
  assert.match(html, /"reveal":true/);
  assert.match(html, /\.cap \.w \{ opacity: 0\.38; \}/);
  assert.match(html, /PLAN\.graphics\.forEach/);
});

test("a close next card shortens the previous one instead of being dropped; never below 4 s", () => {
  const cands = sceneCandidates(groups, 80, { hook: { start: 0, duration: 3 } });
  const mk = (line) => ({ type: "headline", line, text: "x", eyebrow: "", duration: 6 });
  const placed = placeScenes([mk(5), mk(9), mk(11), mk(20)], cands, { duration: 80, gap: 3 });
  assert.deepEqual(placed.map((s) => [s.line, s.duration]), [[5, 5], [9, 6], [20, 6]], "line 9 shortens line 5 to 5 s; line 11 would leave line 9 under 4 s, so it is dropped");
});

test("legacy stat cards count up: the number is split from its words, a bar or a ring sweeps with it", async () => {
  const { splitStat } = await import("../src/graphics.mjs");
  assert.deepEqual(splitStat("$10,000"), { prefix: "$", number: "10,000", suffix: "", to: 10000, dec: 0, commas: true, percent: false });
  assert.deepEqual(splitStat("Almost 8 years"), { prefix: "Almost ", number: "8", suffix: " years", to: 8, dec: 0, commas: false, percent: false });
  assert.equal(splitStat("40%").percent, true);
  assert.equal(splitStat("2.5x").dec, 1);
  assert.equal(splitStat("Zero"), null);
  const money = sceneHTML({ type: "stat", eyebrow: "THE COST", value: "$10,000", sub: "a month" });
  assert.match(money, /<span class="g-affix g-sym">\$<\/span><span class="g-count" data-to="10000" data-dec="0" data-commas="1">10,000<\/span>/);
  assert.match(money, /g-fill-bar/, "a bar under a plain number");
  const pct = sceneHTML({ type: "stat", eyebrow: "", value: "40%" });
  assert.match(pct, /class="g-ring" style="--ring:0%" data-pct="40"/);
  assert.ok(!pct.includes("g-fill-bar"), "a percentage gets the ring, not the bar");
  const words = sceneHTML({ type: "stat", eyebrow: "", value: "Zero" });
  assert.ok(!words.includes("g-count"), "no number, no count");
});

test("truthful numbers: schema 2 reveals exact qualified facts; growth needs two unqualified ends and starts at the first", () => {
  const reveal = normalizeScene({ type: "stat", line: 2, value: "About 10 minutes", motion: "growth", sub: "after a bad number" });
  assert.equal(reveal.motion, "reveal", "a qualifier always forces reveal");
  const revealHTML = sceneHTML(reveal);
  assert.match(revealHTML, /g-stat-reveal/);
  assert.match(revealHTML, /About <\/span><span class="g-exact-number">10<\/span><span class="g-affix"> minutes<\/span>/);
  assert.doesNotMatch(revealHTML, /g-count|data-to=/, "the exact value emits no counting target or intermediate number");

  const missing = normalizeScene({ type: "stat", line: 2, value: "30", motion: "growth" });
  assert.equal(missing.motion, "reveal", "growth without its starting number is refused");
  const growth = normalizeScene({ type: "stat", line: 2, value: "3", value2: "30", motion: "growth" });
  assert.equal(growth.motion, "growth");
  assert.match(sceneHTML(growth), /class="g-count" data-from="3" data-to="30"[^>]*>3<\/span>/, "the first rendered growth value is the spoken start");
  assert.equal(normalizeScene({ type: "stat", line: 2, value: "$2k", value2: "Over $20k", motion: "growth" }).motion, "reveal");
});

test("truthful numbers: bars retain exact printed labels and schema 2 defaults to reveal", () => {
  const bars = normalizeScene({ type: "bars", line: 2, unit: "", items: [{ label: "Before", value: "$2k" }, { label: "After", value: "$20k" }] });
  assert.equal(bars.motion, "reveal");
  const html = sceneHTML(bars);
  assert.match(html, />\$2k<\/span>/);
  assert.match(html, />\$20k<\/span>/);
  assert.doesNotMatch(html, /g-count|data-to=/);
  assert.match(sceneHTML({ type: "stat", eyebrow: "", value: "40%" }, { schema: GRAPHICS_SCHEMA }), /g-stat-reveal/);
});

test("truthful numbers: schema 1 keeps the legacy zero-count markup and runtime; schema 2 carries motion", () => {
  const card = { type: "stat", eyebrow: "", value: "About 10 minutes", value2: "", sub: "" };
  const legacy = '<div class="g-box g-center"><div class="g-stat g-in" style="font-size:calc(var(--u) * 78)"><span class="g-affix">About </span><span class="g-count" data-to="10" data-dec="0" data-commas="0">10</span><span class="g-affix"> minutes</span></div><div class="g-fill g-in"><div class="g-fill-bar"></div></div></div>';
  assert.equal(sceneHTML(card), legacy);
  assert.equal(sceneHTML(card, { schema: 1 }), legacy);

  const plan = {
    name: "truthful", canvas: { width: 1080, height: 1920 }, video: { duration: 12, hasAudio: false }, graphicsSchema: 2,
    style: { colors: { text: "#fff", accent: "#c8a24b", stroke: "#000", bg: "#111" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, zooms: {}, cta: {}, graphics: {} },
    captions: [], graphics: [{ ...card, start: 4, duration: 5.5 }], zooms: [], broll: [], slams: [], reframe: [], audio: { tracks: [] },
  };
  const page = renderHTML(plan, "assets/footage.mp4");
  assert.match(page, /"graphics":\[\{"start":4,"duration":5\.5,"motion":"reveal"\}\]/);
  const cardHTML = page.slice(page.indexOf('id="gfx-0"'), page.indexOf('id="captions"'));
  assert.match(cardHTML, /About <\/span><span class="g-exact-number">10<\/span><span class="g-affix"> minutes<\/span>/);
  assert.doesNotMatch(cardHTML, /g-count|data-to=/);
});

test("truthful numbers: no more than two stats, each at least eight seconds apart", () => {
  const cands = sceneCandidates(groups, 80, { hook: { start: 0, duration: 3 } });
  const stat = (line) => ({ type: "stat", line, value: String(line), motion: "reveal", duration: 5.5 });
  const placed = placeScenes([stat(2), stat(5), stat(7), stat(12)], cands, { duration: 80, gap: 0 });
  assert.deepEqual(placed.map((s) => s.line), [2, 7]);
});

test("compare, bars, message and post cards: fields are checked, list rows get icons, post carries the handle", async () => {
  const { iconFor, ICONS } = await import("../src/graphics.mjs");
  assert.equal(normalizeScene({ type: "compare", line: 1, a: { label: "Old way" }, b: {} }), null, "both sides need a label");
  const cmp = normalizeScene({ type: "compare", line: 1, eyebrow: "TWO REPS", a: { label: "Rep A", value: "12 calls" }, b: { label: "Rep B", value: "forty" } });
  assert.deepEqual([cmp.a.value, cmp.b.value], ["", ""], "values show only when both sides have a number");
  const cmpHTML = sceneHTML(normalizeScene({ type: "compare", line: 1, eyebrow: "", a: { label: "Rep A", value: "12" }, b: { label: "Rep B", value: "48" } }));
  assert.match(cmpHTML, /g-side-a.*--w:25%.*g-vs.*g-side-b.*--w:100%/s, "bars scale to the bigger side");
  const bars = normalizeScene({ type: "bars", line: 2, eyebrow: "", unit: "k", items: [{ label: "Jan", value: "12" }, { label: "Feb", value: "x" }, { label: "Mar", value: "45" }], emphasize: 7 });
  assert.equal(bars.items.length, 2, "rows without a number are dropped");
  assert.equal(bars.emphasize, 1, "emphasize is clamped");
  assert.match(sceneHTML(bars), /g-bar-row g-in g-bar-hi.*g-value-lock">45k<\/span>/s);
  assert.equal(normalizeScene({ type: "bars", line: 2, items: [{ label: "Jan", value: "12" }] }), null);
  const msg = normalizeScene({ type: "message", line: 3, eyebrow: "THE TEXT", contact: "Rep", items: [{ from: "them", text: "Can we push the call?" }, { from: "me", text: "No. What happened?" }, { from: "bot", text: "x" }, { text: "" }] });
  assert.deepEqual(msg.items.map((i) => i.from), ["them", "me", "them"]);
  assert.match(sceneHTML(msg), /g-avatar">R<.*g-typing.*g-bubble g-in g-them.*g-bubble g-in g-me/s);
  assert.equal(normalizeScene({ type: "post", line: 4, text: "" }), null);
  const post = sceneHTML({ ...normalizeScene({ type: "post", line: 4, text: "Your team remembers what it cost you." }), handle: "@officialgregpingel" });
  assert.match(post, /g-post-name">gregpingel<svg.*g-post-handle">@officialgregpingel<.*g-post-text">Your team remembers/s);
  assert.ok(!sceneHTML(normalizeScene({ type: "post", line: 4, text: "No handle" })).includes("g-post-handle"));
  assert.equal(iconFor("Make the calls"), "phone");
  assert.equal(iconFor("Make the calls", "dollar"), "dollar", "Claude's pick wins");
  assert.equal(iconFor("Breathe", "nope"), "", "unknown pick and no keyword: no icon");
  const list = normalizeScene({ type: "list", line: 5, items: [{ text: "Make the calls", icon: "PHONE" }, { text: "Own the number" }] });
  assert.deepEqual(list.items.map((i) => i.icon), ["phone", "chart"]);
  assert.match(sceneHTML(list), new RegExp(`<svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.phone.slice(0, 12)}`));
  const steps = normalizeScene({ type: "steps", line: 5, items: [{ text: "Make the calls" }, { text: "Own the number" }] });
  assert.ok(!sceneHTML(steps).includes("g-icon"), "icons are for list rows only");
});

test("contrast wipe: pivot lines resolve to frames, side copy fits its cap and only one is placed", () => {
  const candidates = [
    { i: 2, start: 4, text: "They count activity", words: [{ text: "They", start: 4 }, { text: "count", start: 4.2 }, { text: "activity", start: 4.5 }] },
    { i: 3, start: 5.2, text: "but ignore outcomes", words: [{ text: "but", start: 5.31 }, { text: "ignore", start: 5.5 }, { text: "outcomes", start: 5.8 }] },
    { i: 8, start: 12, text: "Owners say this", words: [] },
    { i: 9, start: 13.2, text: "instead buyers hear that", words: [{ text: "instead", start: 13.27 }] },
  ];
  const mk = (line, pivotLine) => normalizeScene({
    type: "compare", line, pivotLine, kind: "roles", title: "The whole comparison title",
    a: { label: "what the owner keeps saying", note: "inside every single weekly meeting" },
    b: { label: "what the buyer actually hears", note: "when the price comes up" },
  });
  const first = mk(2, 3);
  assert.equal(first.duration, 4.5);
  for (const side of [first.a, first.b]) assert.ok(`${side.label} ${side.value} ${side.note}`.trim().split(/\s+/).length <= 6);
  const placed = placeScenes([first, mk(8, 9)], candidates, { duration: 20, gap: 3, fps: 30 });
  assert.equal(placed.length, 1, "one contrast card per reel");
  assert.equal(placed[0].pivotAt, 1.3, "the spoken 'but' is quantized to frame 39");
  assert.equal(placed[0].kind, "roles");
  const readable = [placed[0].title, placed[0].a.label, placed[0].a.value, placed[0].a.note, placed[0].b.label, placed[0].b.value, placed[0].b.note].join(" ").trim().split(/\s+/).filter(Boolean).length;
  assert.ok(readable <= Math.floor((placed[0].duration - 0.7) / 0.375), "the whole card fits its reading budget");
});

test("contrast wipe: side B stays masked until pivotAt and runtime carries the kind", () => {
  const plan = {
    name: "pivot",
    canvas: { width: 1080, height: 1920 },
    video: { duration: 12, hasAudio: false },
    style: { colors: { text: "#eee", accent: "#abc", stroke: "#111", bg: "#222" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, graphics: { mode: "overlay" }, zooms: {}, cta: {}, render: { fps: 30 } },
    captions: [],
    graphics: [{ type: "compare", eyebrow: "THE SHIFT", kind: "before-after", pivotAt: 1.3, start: 4, duration: 4.5, a: { label: "Old belief", value: "", note: "" }, b: { label: "New belief", value: "", note: "" } }],
  };
  plan.graphics.schema = 2;
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /g-compare-dynamic g-kind-before-after/);
  assert.match(html, /\.g-compare-dynamic \.g-side-b \{ clip-path: inset\(0 100% 0 0\); \}/);
  assert.match(html, /"pivotAt":1\.3,"kind":"before-after","faceSide":"left"/);
  assert.match(html, /const pivot = g\.start \+ g\.pivotAt;/);
  assert.match(html, /clipPath: "inset\(0 0% 0 0\)", duration: 10 \* frame, ease: "power3\.out"[^]*, pivot\)/);
  assert.doesNotMatch(sceneHTML(plan.graphics[0]), /g-compare g-in/);
});

test("legacy compare markup is unchanged when pivotLine is absent", () => {
  const legacy = { type: "compare", eyebrow: "TWO REPS", title: "Calls", a: { label: "Rep A", value: "12", note: "old way" }, b: { label: "Rep B", value: "48", note: "new way" } };
  assert.equal(sceneHTML(legacy), '<div class="g-box g-center"><div class="g-eyebrow g-in"><span class="g-dot"></span>TWO REPS</div><div class="g-title g-in">Calls</div><div class="g-compare g-in"><div class="g-side g-side-a"><div class="g-side-label">Rep A</div><div class="g-side-value">12</div><div class="g-side-bar"><div class="g-side-fill" style="--w:25%"></div></div><div class="g-side-note">old way</div></div><div class="g-vs">VS</div><div class="g-side g-side-b"><div class="g-side-label">Rep B</div><div class="g-side-value">48</div><div class="g-side-bar"><div class="g-side-fill" style="--w:100%"></div></div><div class="g-side-note">new way</div></div></div></div>');
});

test("proof messages start at the first exact mention and reveal only exact transcript text on their line", () => {
  const lines = [
    { i: 0, start: 5, text: "He messaged us yesterday" },
    { i: 1, start: 7, text: "and said I left the jail" },
    { i: 2, start: 9.7, text: "Two years later I am in sales" },
  ];
  const proof = normalizeScene({
    type: "message", mode: "proof", line: 2, context: "He messaged us",
    contact: "Invented Sender",
    items: [{ from: "them", line: 1, text: "I left the jail" }],
    outcome: { line: 2, text: "I am in sales" },
  });
  const placed = placeScenes([proof], lines, { duration: 20, lines });
  assert.equal(placed.length, 1);
  assert.equal(placed[0].line, 0, "context is re-anchored to its first transcript occurrence");
  assert.equal(placed[0].start, 5);
  assert.equal(placed[0].items[0].at, 2);
  assert.equal(placed[0].outcome.at, 4.7);
  assert.ok(placed[0].duration >= placed[0].outcome.at + 10 / 30 + 1.5 - 0.001, "holds 1.5 s after the underline finishes");
  assert.ok(!("contact" in proof), "proof mode never keeps a sender name");

  const invented = normalizeScene({ type: "message", mode: "proof", line: 0, context: "He messaged us", items: [{ from: "them", line: 1, text: "He promised us money" }] });
  assert.deepEqual(placeScenes([invented], lines, { duration: 20, lines }), [], "invented bubble copy is rejected");
  const repeatedLate = normalizeScene({ type: "message", mode: "proof", line: 0, context: "He messaged us", items: [{ from: "them", line: 2, text: "I left the jail" }] });
  assert.deepEqual(placeScenes([repeatedLate], lines, { duration: 20, lines }), [], "a real phrase with the wrong first-line anchor is rejected");
});

test("proof messages trim bubbles to 16 words, enforce the total reading budget and allow one per reel", () => {
  const twenty = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty";
  const trimmed = normalizeScene({ type: "message", mode: "proof", line: 0, context: "He messaged us with the answer", items: [{ line: 1, text: twenty }] });
  assert.equal(trimmed.items[0].text.split(/\s+/).length, 16);

  const lines = [
    { i: 0, start: 5, text: "He messaged us with the answer" },
    { i: 1, start: 6, text: twenty },
    { i: 2, start: 14, text: "She texted me" },
    { i: 3, start: 15, text: "I got the job" },
  ];
  assert.deepEqual(placeScenes([trimmed], lines, { duration: 24, lines }), [], "a thread that cannot fit its reading budget is rejected");
  const one = normalizeScene({ type: "message", mode: "proof", line: 0, context: "He messaged us", items: [{ line: 1, text: "one two three" }] });
  const two = normalizeScene({ type: "message", mode: "proof", line: 2, context: "She texted me", items: [{ line: 3, text: "I got the job" }] });
  assert.equal(placeScenes([one, two], lines, { duration: 24, lines, gap: 0 }).filter((s) => s.mode === "proof").length, 1);
});

test("proof message markup is source-labelled, brand-colored and timed without changing legacy messages", () => {
  const proof = normalizeScene({ type: "message", mode: "proof", line: 0, context: "He messaged us", contact: "Fake Name", items: [{ from: "them", line: 1, text: "I left the jail" }], outcome: { line: 2, text: "I am in sales" } });
  const html = sceneHTML(proof);
  assert.match(html, /IN HIS WORDS/);
  assert.match(html, /data-proof-item="0"/);
  assert.match(html, /g-proof-underline/);
  assert.doesNotMatch(html, /Fake Name|g-avatar|n-time/);
  const css = proofMessageCSS({ H: 1920, colors: { text: "#EDEAE2", accent: "#39FF88", bg: "#19132A" }, captionTop: 1382 });
  assert.match(css, /left: 76px;[\s\S]*top: 200px;[\s\S]*width: 864px/);
  assert.match(css, /background: #39FF88; color: #19132A/);
  assert.match(css, /font-size: 48px/);
  assert.doesNotMatch(css, /#0a80f8|#007aff|#fff(?:fff)?/i);

  const legacy = normalizeScene({ type: "message", line: 3, eyebrow: "THE TEXT", contact: "Rep", items: [{ from: "them", text: "Can we talk?" }] });
  assert.equal(sceneHTML(legacy), '<div class="g-box"><div class="g-eyebrow g-in"><span class="g-dot"></span>THE TEXT</div><div class="g-thread"><div class="g-thread-head g-in"><span class="g-avatar">R</span>Rep</div><div class="g-typing"><i></i><i></i><i></i></div><div class="g-bubble g-in g-them">Can we talk?</div></div></div>');
});

test("proof message prompt and runtime carry first-mention guidance and per-beat timing", () => {
  const p = scenesPrompt({ candidates: [{ i: 0, start: 5, text: "He messaged us" }], transcript: "He messaged us", hook: "The proof", count: 1 });
  assert.match(p, /anchor the card where the speaker first establishes that the message exists/);
  assert.match(p, /anchor each bubble or outcome to the first line where its content becomes known/);
  assert.match(p, /Never invent a sender name, timestamp, read receipt or outcome/);
  assert.match(p, /at most one proof message/);

  const plan = {
    name: "proof", canvas: { width: 1080, height: 1920 }, video: { duration: 16, hasAudio: false },
    style: { colors: { text: "#EDEAE2", accent: "#39FF88", stroke: "#111111", bg: "#19132A" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, graphics: { mode: "overlay" }, zooms: {}, cta: {}, render: { fps: 30 } },
    captions: [], graphicsSchema: 2, graphics: [{ type: "message", mode: "proof", skin: "phone", context: "He messaged us", items: [{ from: "them", text: "I left the jail", at: 2 }], outcome: { text: "I am in sales", at: 4.7 }, start: 5, duration: 6.534 }],
  };
  const rendered = renderHTML(plan, "assets/footage.mp4");
  assert.match(rendered, /gfx-message gfx-message-proof skin-phone/);
  assert.match(rendered, /"mode":"proof","items":\[\{"at":2,"from":"them"\}\],"outcome":\{"at":4\.7\}/);
  assert.match(rendered, /"graphicsSchema":2/);
  assert.match(rendered, /at \+ 12 \* frame/);
  assert.match(rendered, /scale: 0\.72[\s\S]*back\.out\(1\.5\)/);
});

test("saved plans survive a hook change: cards and stills follow their lines by start time", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { makeGraphics } = await import("../src/graphics.mjs");
  const { makeBroll } = await import("../src/broll.mjs");
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), "reuse-"));
  const lines = Array.from({ length: 12 }, (_, i) => ({ start: 4 + i * 3, end: 6 + i * 3, text: `line ${i}`, words: [] }));
  const hook = { start: 0, duration: 3 };
  // A plan saved against the full line list, then the same reel with line 2 hidden (a new hook repeats its words).
  fs.writeFileSync(path.join(wd, "graphics.json"), JSON.stringify({ key: "stale", scenes: [{ type: "headline", line: 5, start: 19, eyebrow: "", text: "Own it", duration: 5.5 }] }));
  const hidden = lines.filter((_, i) => i !== 2);
  const scenes = await makeGraphics({ workDir: wd, groups: hidden, duration: 40, hook, cta: null, settings: {} });
  assert.equal(scenes.length, 1, "reused without a Claude call");
  assert.equal(scenes[0].start, 19, "the card stays on its line");
  assert.equal(scenes[0].line, 4, "line number re-mapped after the hidden line");
  const still = path.join(wd, "still.png");
  fs.writeFileSync(still, "x");
  fs.mkdirSync(path.join(wd, "broll"));
  fs.writeFileSync(path.join(wd, "broll", "broll.json"), JSON.stringify({ key: "stale", shots: [{ line: 7, start: 25, duration: 2, text: "line 7", scene: "a desk", file: still, motion: "in" }] }));
  const shots = await makeBroll({ workDir: wd, groups: hidden, duration: 40, hook, cta: null, settings: {} });
  assert.equal(shots.length, 1, "stills reused without a Codex session");
  assert.equal(shots[0].start, 25);
  fs.rmSync(wd, { recursive: true, force: true });
});

test("cards: a quote that carries its own quote marks gets no extra ones; a long compare label is set smaller", async () => {
  const { sceneHTML } = await import("../src/graphics.mjs");
  const q = sceneHTML({ type: "quote", text: 'Not "Who dropped it?" *"What happened?"*' });
  assert.doesNotMatch(q, /&rdquo;|&ldquo;/);
  assert.match(sceneHTML({ type: "quote", text: "Own the number" }), /&ldquo;Own the number&rdquo;/);
  const c = sceneHTML({ type: "compare", a: { label: "Slam the desk" }, b: { label: "Breathe, lower your voice" } });
  assert.match(c, /g-side g-side-b g-side-long/);
});

test("spoken steps: item lines are all-or-nothing, ordered and short", () => {
  const raw = { type: "steps", line: 2, items: [{ text: "First point" }, { text: "Second point" }] };
  const legacy = normalizeScene(raw);
  assert.ok(legacy, "all lines missing falls back to the legacy card");
  assert.ok(legacy.items.every((it) => !Object.hasOwn(it, "line")));
  assert.equal(normalizeScene({ ...raw, items: [{ text: "First point", line: 2 }, { text: "Second point" }] }), null, "partial timing is rejected");
  assert.equal(normalizeScene({ ...raw, items: [{ text: "First point", line: "x" }, { text: "Second point", line: 4 }] }), null, "invalid lines are rejected");
  assert.equal(normalizeScene({ ...raw, items: [{ text: "First point", line: 4 }, { text: "Second point", line: 3 }] }), null, "cue lines must increase");
  assert.equal(normalizeScene({ ...raw, items: [{ text: "This item has five words", line: 2 }, { text: "Second point", line: 4 }] }), null, "timed items have four words at most");
});

test("spoken steps: placement quantizes offsets and derives duration from the final item", () => {
  const cands = [
    { i: 2, start: 10.01, text: "first" },
    { i: 3, start: 10.52, text: "second" },
    { i: 4, start: 12.38, text: "third" },
    { i: 5, start: 19.2, text: "later" },
  ];
  const scene = normalizeScene({ type: "list", line: 2, items: [{ text: "First", line: 2 }, { text: "Second", line: 3 }, { text: "Third", line: 4 }] });
  const [placed] = placeScenes([scene], cands, { duration: 30 });
  assert.deepEqual(placed.items.map((it) => it.at), [0, 0.5, 2.367]);
  assert.equal(placed.duration, 3.567, "last cue plus a 1.2 second hold, on the frame grid");
  const tooWide = normalizeScene({ type: "steps", line: 2, items: [{ text: "First", line: 2 }, { text: "Later", line: 5 }] });
  assert.deepEqual(placeScenes([tooWide], cands, { duration: 30 }), [], "item cues more than eight seconds apart are rejected");
  const tooManyWords = normalizeScene({ type: "list", line: 2, eyebrow: "THE FULL PLAYBOOK", items: [{ text: "First point", line: 2 }, { text: "Second point", line: 3 }] });
  assert.deepEqual(placeScenes([tooManyWords], cands, { duration: 30 }), [], "the whole card must fit the reading budget");
});

test("spoken steps: future text starts hidden, item offsets reach the timeline, legacy stagger stays intact", () => {
  const plan = {
    name: "timed",
    canvas: { width: 1080, height: 1920 },
    video: { duration: 20, hasAudio: true },
    style: { colors: { text: "#FAFAFA", accent: "#C8A24B", stroke: "#000", bg: "#0B0B0D" }, captions: { fontSizeFrac: 0.04, strokeWidthFrac: 0.005, sideMarginFrac: 0.05, position: 0.72, shadow: "none", style: "reveal" }, hook: { fontSizeFrac: 0.05, position: 0.2 }, graphics: { mode: "overlay" }, zooms: {}, cta: {}, render: { fps: 30 } },
    captions: [],
    framing: { side: "left" },
    graphics: [{ type: "steps", eyebrow: "", start: 6, duration: 3.2, items: [{ text: "First", at: 0 }, { text: "Second", at: 2 }] }],
  };
  const html = renderHTML(plan, "assets/footage.mp4");
  assert.match(html, /gfx-steps gfx-timed skin-glass/);
  assert.match(html, /"items":\[\{"at":0\},\{"at":2\}\]/, "per-item offsets are in runtimePlan.graphics");
  assert.match(html, /\.gfx\.gfx-timed \.g-item-text \{[^}]*opacity: 0/s, "future item text is hidden before its cue");
  assert.match(html, /const cue = g\.start \+ g\.items\[k\]\.at/);
  assert.match(html, /Math\.max\(g\.start, cue - 1 \/ fps\)/, "the dot appears one frame before the cue");

  plan.graphics = [{ type: "list", eyebrow: "", start: 6, duration: 5.9, items: [{ text: "First", state: "plain", tag: "" }, { text: "Second", state: "plain", tag: "" }] }];
  const legacy = renderHTML(plan, "assets/footage.mp4");
  assert.doesNotMatch(legacy, /gfx-list gfx-timed/);
  assert.match(legacy, /g-row g-in g-plain/);
  assert.match(legacy, /tl\.fromTo\(ins, \{ opacity: 0, y: 46 \}, \{ opacity: 1, y: 0, duration: 0\.42, ease: "power3\.out"/);
});
