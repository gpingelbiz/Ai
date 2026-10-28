import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeScene, placeScenes, sceneCandidates, graphicsCount, sceneHTML, scenesPrompt, sceneDuration } from "../src/graphics.mjs";
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

test("stat cards count up: the number is split from its words, a bar or a ring sweeps with it", async () => {
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
  assert.match(sceneHTML(bars), /g-bar-row g-in g-bar-hi.*data-to="45".*>45<\/span>k</s);
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

test("glass reply bubble: the client's accent on a brand preset, iMessage blue on Greg's, a preset setting wins", async () => {
  const { replyBubble, graphicsCSS, REPLY_BLUE } = await import("../src/graphics.mjs");
  const julee = { name: "brand-julee-gracey", colors: { accent: "#FFB27D", bg: "#111111" } };
  const greg = { name: "pingel-brand", colors: { accent: "#E8B33C", bg: "#0B0B0D" } };
  assert.deepEqual(replyBubble(julee), { bg: "#FFB27D", text: "#111111" });
  assert.deepEqual(replyBubble(greg), { bg: REPLY_BLUE, text: "#fff" });
  assert.deepEqual(replyBubble({ ...greg, graphics: { replyBubble: "accent" } }), { bg: "#E8B33C", text: "#0B0B0D" });
  assert.deepEqual(replyBubble({ ...julee, graphics: { replyBubble: "#0a80f8" } }), { bg: "#0a80f8", text: "#fff" });
  assert.match(graphicsCSS({ W: 1080, H: 1920, colors: julee.colors, reply: replyBubble(julee) }), /\.g-bubble\.g-me \{[^}]*background: #FFB27D; color: #111111;/);
  assert.match(graphicsCSS({ W: 1080, H: 1920, colors: greg.colors }), /\.g-bubble\.g-me \{[^}]*background: #0a80f8; color: #fff;/);
});
