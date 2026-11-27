import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CARDS as BATCH } from "../src/pro-cards/herk-koverview.mjs";
import { CARDS, CARD_GROUPS, tagsOf, TAG_WORDS } from "../src/pro-cards/index.mjs";
import { groundCard, groundProOverlay, placeProOverlay, proSize, PRO_MOTION } from "../src/pro.mjs";
import { renderProOverlay, proTimeline, proCSS } from "../src/pro-render.mjs";
import { zoneFor, rightLimit } from "../src/safe-zone.mjs";

const group = (keys, rows) => Object.fromEntries(rows.flatMap((row, i) => row.map((value, j) => [keys[j] + (i + 1), value])));
const paired = (rows) => group(["title", "detail"], rows);
const cases = {
  "session-agenda": group(["time", "topic"], [["3:00", "Set the goal"], ["five minutes", "Run the drill"], ["8:30", "Review the call"]]),
  "feature-bento": { feature: "Faster practice", detail: "Reps get feedback on the same day", supports: ["Live drills", "Call reviews", "Short scripts"] },
  "headline-rail": { title: "The practice loop", ...group(["action", "detail"], [["Ask once", "Pause here"], ["Take notes", "Save the quote"], ["Try again", "Keep it short"]]) },
  "scenario-pair": group(["title", "example"], [["Warm lead", "What got you curious?"], ["Cold lead", "Would this be a bad time?"]]),
  "principle-trio": paired([["Clarity", "Name the goal"], ["Trust", "Hear them out"], ["Patience", "Keep the pause"]]),
  "practice-pair": { do: ["Ask permission", "Listen first", "Name the goal", "Take a pause"], avoid: ["Pitch too soon", "Cut them off", "Fill the silence", "Chase a yes"] },
  "concept-tiles": paired([["Prep", "Read the notes"], ["Listen", "Hear the intent"], ["Probe", "Ask for a reason"], ["Recap", "Check the facts"]]),
  "topic-tiles": { topics: ["Warm leads", "Cold leads", "Permission", "Tone", "Openers", "Questions", "Follow-up", "Referrals", "Practice"] },
  "handoff-rail": { stages: ["Qualify", "Book", "Handoff", "Coach"] },
  "timeline-spine": group(["time", "topic"], [["Week one", "Train the reps"], ["Week three", "Start outreach"], ["Week eight", "Audit the calls"]]),
  "takeaway-rows": paired([["Silence helps", "Let them think"], ["Permission works", "Give them a choice"], ["Notes matter", "Keep their words"]]),
  "phase-stack": paired([["Before the call", "Read the notes"], ["During the call", "Ask permission"], ["After the call", "Review the tape"]]),
  "percentage-legend": group(["category", "percent"], [["Renewals", "40%"], ["Referrals", "twenty percent"], ["Upgrades", "5.5%"], ["Refunds", "zero percent"]]),
  "conversion-tiers": group(["stage", "percent"], [["Leads", "100%"], ["Reply", "60%"], ["Book", "30%"], ["Show", "10%"]]),
  "project-spans": group(["task", "start", "end"], [["Research", "week one", "week three"], ["Training", "week two", "week five"], ["Practice", "week four", "week six"], ["Review", "week six", "week eight"]]),
  "metric-tiles": group(["value", "context"], [["42", "Booked calls"], ["18%", "Renewals"], ["$50", "Lead cost"], ["six", "Referrals"]]),
  "metric-spokes": { claim: "The pilot worked", ...group(["value", "context"], [["34", "Booked calls"], ["8", "New clients"], ["24%", "Close rate"]]) },
  "offer-prices": group(["offer", "price"], [["Starter", "$49"], ["Coaching", "$99"], ["Team", "$199"]]),
  "offer-tiers": group(["tier", "first", "second", "third"], [["Starter", "Calls", "Scripts", "Reviews"], ["Plus", "Audit", "Practice", "Coaching"], ["Team", "Onboarding", "Reports", "Drills"]]),
  "tradeoff-table": { left: "Group", right: "Private", ...group(["criterion", "leftAnswer", "rightAnswer"], [["Live review", "Yes", "No"], ["Pace", "Weekly", "Daily"], ["Feedback", "Shared", "Private"]]) },
  "priority-ladder": group(["priority", "reason"], [["Qualify", "Save time"], ["Listen", "Hear intent"], ["Probe", "Find the issue"], ["Recap", "Confirm intent"], ["Follow up", "Keep momentum"]]),
  "teaching-outline": { section1: "Prep", points1: ["Read the notes", "Check the history"], section2: "Talk", points2: ["Ask permission", "Give a choice"], section3: "Review", points3: ["Review the tape"] },
  "chapter-index": { topics: ["Qualifying leads", "Opening well", "Better questions", "Handling pauses", "The follow-up"] },
  "alert-stack": group(["title", "message"], [["New inquiry", "Can you call me?"], ["Reply received", "Today works for me"], ["Call booked", "See you then"]]),
  "four-part-loop": paired([["Listen", "Find intent"], ["Ask", "Get clarity"], ["Recap", "Check the fit"], ["Listen again", "Catch changes"]]),
  "journey-stops": paired([["Discovery", "They see the need"], ["Research", "They ask around"], ["Trial", "They try it"], ["Decision", "They choose"]]),
  "pyramid-slabs": { layers: ["Daily practice", "Coached calls", "Mastery"] },
  "system-layers": { layers: ["Intake", "Qualification", "Coaching", "Feedback"] },
  "nested-context": { outside: "Sales process", inside: "Discovery call", core: "First question" },
  "axis-quadrants": { top: "High trust", bottom: "Low trust", left: "Low fit", right: "High fit", upperLeft: "Friendly mismatch", upperRight: "Ready buyer", lowerLeft: "Cold lead", lowerRight: "Needs proof" },
  "mapped-spectrum": { start: "Least pressure", end: "Most pressure", ...group(["example", "position"], [["Ask", "Low"], ["Invite", "Moderate"], ["Insist", "High"]]) },
  "idea-hub": { hub: "Sales coaching", leaves: ["Discovery", "Tone", "Review", "Follow-up"] },
  "linked-system": { nodes: ["Inbound", "Qualify", "Handoff", "Coach", "Review"] },
  "outcome-tree": { root: "A better opener", outcomes: ["Trust", "Permission", "More replies"] },
  "named-overlap": { left: "Buyer need", right: "Rep skill", overlap: "Good fit" },
  "center-spotlight": { left: "Without prep", leftDetail: "You guess", right: "With prep", rightDetail: "You know", focus: "Review their notes", focusDetail: "You can ask about their real problem" },
};

function fixture(type, edits = {}) {
  const words = [], pick = { type };
  const inputs = { ...cases[type], ...edits };
  const add = (text) => {
    const from = words.length;
    for (const textWord of text.split(/ +/)) {
      const start = 3 + words.length * 0.13;
      words.push({ text: textWord, start, end: start + 0.11 });
    }
    return { from, to: words.length - 1 };
  };
  for (const [name, slot] of Object.entries(BATCH[type].slots)) {
    const input = inputs[name];
    if (input === undefined) {
      assert.ok(slot.optional, `${type} fixture covers ${name}`);
      continue;
    }
    pick[name] = slot.kind === "label" ? input : slot.repeat ? input.map(add) : add(input);
  }
  return { words, pick };
}

const frame = {
  W: 1080, H: 1920, measured: true, head: { x: 470, y: 860, w: 170, h: 216 },
  caption: { x: 180, y: 1120, w: 720, h: 150 }, mic: { x: 70, y: 890, w: 180, h: 470 },
};
const ease = { enter: (x) => x, state: (x) => x, exit: (x) => x };
function capture(timeline) {
  const calls = [];
  const tl = { fromTo: (...args) => calls.push(args), to: (...args) => calls.push(args) };
  new Function("tl", "proEnter", "proState", "proExit", timeline)(tl, ease.enter, ease.state, ease.exit);
  return calls;
}

function render(type, edits) {
  const { words, pick } = fixture(type, edits);
  const o = groundCard(pick, type, words);
  assert.ok(o, `${type} grounds ${JSON.stringify(edits || {})}`);
  const place = placeProOverlay(o, frame);
  assert.ok(place, `${type} places in a clear frame`);
  Object.assign(o, { id: "ko-fixture", place });
  const { html, timeline } = renderProOverlay(o);
  return { o, words, pick, html, timeline, calls: capture(timeline) };
}

const triage = JSON.parse(fs.readFileSync(new URL("../src/pro-cards/herk-triage-koverview.json", import.meta.url)));
const sources = ("agenda beforeafter bento bigleft callouts cardrow5 checklist cycle dashboard deck2 deck3 duallist featurecompare " +
  "featuregrid flashcards flow funnel gantt grid6 grid9 iconlist journey kpirow layers legend levels logowall mappoints " +
  "matrix milestones mindmap nested network notifs numlist orgchart outline phases pipeline pricing profiles proscons " +
  "pyramid quad quotegrid ranked roadmap spectrum split3 spotlightcard statgrid steps summary tiercompare timeline toc " +
  "tree tricards venn vstable").split(" ").map((id) => `kallaway.t1.overview.${id}`);

test("every Kallaway overview is triaged once and each adaptation credits all of its sources", () => {
  assert.deepEqual(triage.map(({ id }) => id), sources);
  for (const { id, type, outcome, reason } of triage) {
    assert.match(reason, /^.+$/);
    if (outcome === "unfit") assert.equal(type, undefined);
    else if (outcome === "duplicate") assert.ok(CARDS[type] && !BATCH[type], id);
    else {
      assert.ok(["new", "variant", "merged"].includes(outcome), id);
      assert.ok(BATCH[type]?.source.split(",").includes(`herk:${id}`), id);
      if (outcome !== "merged") assert.equal(!!BATCH[type].variantOf, outcome === "variant", id);
    }
  }
  for (const [type, def] of Object.entries(BATCH)) {
    const owned = triage.filter((entry) => entry.type === type);
    assert.equal(owned.filter(({ outcome }) => ["new", "variant"].includes(outcome)).length, 1, type);
    assert.deepEqual(def.source.split(",").toSorted(), owned.map(({ id }) => `herk:${id}`).toSorted(), type);
  }
});

test("every overview grounds, reveals exact spoken copy, rejects invented and oversized words, and escapes markup", () => {
  assert.deepEqual(Object.keys(cases).toSorted(), Object.keys(BATCH).toSorted());
  const escapes = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(CARDS[type], def, type);
    const { o, pick, words, html, calls } = render(type);
    const copies = [...html.matchAll(/<div class="ko-copy (ko-[\w-]+)(?: [^"]*)?">([^]*?)<\/div>/g)];
    assert.equal(copies.length, o.phrases.length, type);
    const copyCalls = copies.map(([, name, text]) => {
      const matching = calls.filter(([selector]) => selector === `#ko-fixture .${name}`);
      assert.equal(matching.length, 1, `${type} ${name}`);
      const [, from, to, at] = matching[0];
      assert.equal(from.opacity, 0);
      assert.equal(to.opacity, 1);
      assert.match(from.clipPath, /^inset\((?:\d+% ){3}\d+%\)$/);
      assert.equal(to.clipPath, "inset(0% 0% 0% 0%)");
      assert.equal(to.duration, PRO_MOTION.enter);
      assert.equal(to.ease, ease.enter);
      assert.equal(to.immediateRender, false);
      return [at, text];
    }).toSorted((a, b) => a[0] - b[0]);
    assert.deepEqual(copyCalls, o.phrases.map((item) => {
      const exact = words.slice(item.from, item.to + 1).map(({ text }) => text).join(" ");
      assert.equal(item.text, exact, type);
      assert.equal(item.fontSize, undefined, `${type} never shrinks`);
      return [item.at, item.lines.map(escapes).join("<br>")];
    }), type);
    assert.deepEqual(o.reveals, copyCalls.map(([at]) => at), type);

    const [key, slot] = Object.entries(def.slots).find(([, s]) => s.kind === "spoken");
    const first = slot.repeat ? pick[key][0] : pick[key];
    const replace = (value) => ({ ...pick, [key]: slot.repeat ? [value, ...pick[key].slice(1)] : value });
    assert.equal(groundCard(replace("invented"), type, words), null, type);
    assert.equal(groundCard(replace({ from: words.length }), type, words), null, type);
    assert.equal(groundCard(pick, type, words.map((word, i) => i === first.from ? { ...word, text: "W".repeat(slot.maxChars + 1) } : word)), null, type);
    const withInventedCopy = groundCard(replace({ ...first, text: "invented" }), type, words);
    assert.equal(withInventedCopy.slots[key][0].text, o.slots[key][0].text, type);
    const escapeKey = { "session-agenda": "topic1", "timeline-spine": "topic1", "metric-tiles": "context1" }[type] || key;
    const payload = "<b>&";
    const placed = render(type, { [escapeKey]: def.slots[escapeKey].repeat ? [payload, ...cases[type][escapeKey].slice(1)] : payload });
    assert.match(placed.html, /&lt;b&gt;&amp;/, type);
    assert.doesNotMatch(placed.html, /<b>|<img|<image/, type);
  }
});

test("overview CSS stays in its own panel and placement clears the shared safe zone", () => {
  const zone = zoneFor();
  for (const [type, def] of Object.entries(BATCH)) {
    assert.equal(def.fullscreen, undefined, type);
    assert.ok(tagsOf(type).every((tag) => TAG_WORDS.includes(tag)), type);
    assert.ok(proCSS({ types: new Set([type]) }).includes(def.css), type);
    for (const [, selector] of def.css.matchAll(/([^{}]+)\{/g)) {
      const scope = `.pro-${type}`;
      assert.ok(selector.trim() === scope || selector.trim().startsWith(scope + " "), selector);
    }
    for (const [color] of def.css.matchAll(/#[\da-f]+/gi)) assert.ok(["#0B0B0D", "#F5F1E8", "#C8A24B", "#A8A49C", "#343438"].includes(color), color);
    for (const [, face] of def.css.matchAll(/"([^"]+)",sans-serif/g)) assert.ok(["Inter", "Anton"].includes(face), face);
    assert.doesNotMatch(def.css, /gradient\(|(?:backdrop-)?filter\s*:|text-shadow|@keyframes|animation:/i);
    const { o, html, calls } = render(type);
    assert.ok(proSize(o).w <= 720 && proSize(o).h <= 560, type);
    const { x, y, w, h } = o.place;
    assert.ok(x >= zone.left && x + w <= rightLimit(zone, y - 8, y + h + 16), type);
    assert.ok(y - 8 >= zone.top && y + h + 16 <= zone.bottom, type);
    for (const slot of Object.values(def.slots)) assert.ok(slot.size >= (slot.kind === "spoken" ? 40 : 28), type);
    for (const [selector, from, to] of calls.slice(1, -1)) {
      const classes = selector.match(/\.[\w-]+/g);
      assert.ok(classes?.every((name) => new RegExp(`class="[^"]*\\b${name.slice(1)}(?=[\\s"])`).test(html)), selector);
      assert.ok(Math.abs(from.x || 0) <= 16 && Math.abs(from.y || 0) <= 16, selector);
      assert.equal(to.duration, to.ease === ease.state ? PRO_MOTION.state : PRO_MOTION.enter, selector);
      assert.equal(to.immediateRender, false, selector);
    }
  }
  assert.equal(proSize(render("topic-tiles", { topics: ["Text", "Calls", "Email", "Coaching"] }).o).h, 184);
  assert.equal(proSize(render("topic-tiles", { topics: Array(9).fill("Coaching calls") }).o).h, 560);
  assert.equal(proSize(render("chapter-index", { topics: ["Text", "Calls", "Email"] }).o).h, 210);
});

test("variants ground through the new roots and the original timeline and pyramid keep their designs", () => {
  for (const [root, variant] of [["session-agenda", "timeline-spine"], ["system-layers", "pyramid-slabs"]]) {
    assert.ok(CARD_GROUPS[root].includes(variant));
    const { words, pick } = fixture(variant);
    const overlay = groundProOverlay({ ...pick, type: root, design: variant }, words);
    assert.equal(overlay?.type, variant);
    assert.equal(overlay.group, root);
  }
  for (const type of ["timeline", "pyramid"]) assert.equal(CARDS[type].variantOf, undefined);
  const labels = [...render("practice-pair").html.matchAll(/class="ko-label">([^<]+)/g)].map(([, label]) => label);
  assert.deepEqual(labels, ["Do this", "Avoid this"]);
  assert.ok(labels.every((label) => label.split(" ").length <= 4 && !/\d/.test(label)));
});

test("proof cards require the stated quantities and draw only earned comparisons", () => {
  for (const [type, edits] of [
    ["session-agenda", { time1: "tomorrow" }], ["session-agenda", { time1: "20% minutes" }],
    ["percentage-legend", { percent1: "120%" }], ["percentage-legend", { percent1: "forty" }],
    ["conversion-tiers", { percent3: "60%" }], ["conversion-tiers", { percent2: "fewer" }],
    ["project-spans", { end1: "week one" }], ["project-spans", { start1: "March 4" }],
    ["metric-tiles", { value3: "more" }], ["metric-tiles", { value4: undefined }],
    ["metric-spokes", { value1: "2 to 3" }], ["offer-prices", { price2: "99" }],
  ]) {
    const { words, pick } = fixture(type, edits);
    assert.equal(groundCard(pick, type, words), null, `${type} ${JSON.stringify(edits)}`);
  }
  const three = render("metric-tiles", { value4: undefined, context4: undefined });
  assert.doesNotMatch(three.html, /ko-panel-4/);
  const legend = render("percentage-legend");
  const fills = legend.calls.filter(([selector]) => selector.includes(".ko-fill-"));
  assert.deepEqual(fills.map(([, , to]) => to.scaleX), [0.4, 0.2, 0.055, 0]);
  assert.deepEqual(fills.map(([, , , at]) => at), [1, 2, 3, 4].map((i) => legend.o.slots[`percent${i}`][0].at));
  const schedule = render("project-spans");
  assert.deepEqual([...schedule.html.matchAll(/pathLength="1" d="M(\d+) 5H(\d+)"/g)].map((m) => m.slice(1)), [
    ["6", "190"], ["98", "374"], ["282", "466"], ["466", "650"],
  ]);
  const table = render("tradeoff-table");
  assert.deepEqual(table.calls.filter(([selector]) => selector.includes(".ko-status-")).map(([selector, , , at]) => [selector.split(" ")[1], at]),
    [[".ko-status-leftAnswer1", table.o.slots.leftAnswer1[0].at], [".ko-status-rightAnswer1", table.o.slots.rightAnswer1[0].at]]);
});

test("overview motion has the same states on first, reversed and shuffled seeks", (t) => {
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(fs.readFileSync(new URL("../assets/vendor/gsap.min.js", import.meta.url), "utf8"), context);
  const gsap = context.window.gsap, timeline = gsap.timeline({ paused: true }), targets = new Map();
  t.after(() => { timeline.kill(); gsap.ticker.sleep(); });
  const overlays = Object.keys(BATCH).map((type, i) => ({ ...render(type).o, id: `overview-${i}` }));
  const tl = {
    fromTo(selector, from, to, at) {
      if (!targets.has(selector)) targets.set(selector, { ...from });
      timeline.fromTo(targets.get(selector), from, to, at);
    },
    to(selector, to, at) { timeline.to(targets.get(selector), to, at); },
  };
  new Function("tl", proTimeline(overlays))(tl);
  const snapshot = (frame) => {
    timeline.totalTime(frame / 30, false);
    return [...targets].map(([selector, target]) =>
      !targets.get(selector.split(" ")[0])?.opacity || target.opacity === 0 ? null :
        [target.opacity, target.x, target.y, target.clipPath, target.strokeDashoffset, target.scaleX, target.scaleY, target.backgroundColor]);
  };
  const frames = Array.from({ length: 257 }, (_, i) => i);
  const forward = frames.map(snapshot);
  for (const frame of frames.toReversed()) assert.deepEqual(snapshot(frame), forward[frame], `reverse ${frame}`);
  for (const i of frames) {
    const frame = i * 137 % frames.length;
    assert.deepEqual(snapshot(frame), forward[frame], `shuffled ${frame}`);
  }
});
