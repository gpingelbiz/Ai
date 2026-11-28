// Card ideas from ghost-editor and its lemo-opuscar ports, both MIT. See src/pro-cards/GHOST-EDITOR-LICENSE.md.
import { CARDS as proof } from "./proof-2.mjs";
import { CARDS as herkStats } from "./herk-vstat.mjs";
import { CARDS as sections } from "./herk-ksection.mjs";
import { CARDS as overviews } from "./herk-koverview.mjs";
import { CARDS as lowerThirds } from "./herk-klower.mjs";
import { CARDS as payoffs } from "./distinction-payoff.mjs";
import { CARDS as procedures } from "./procedure-proof.mjs";
import { CARDS as fullCards } from "./warning-emphasis-full.mjs";

const roots = {
  "section-divider": sections["section-divider"],
  "chapter-index": overviews["chapter-index"],
  "topic-chip-grid": lowerThirds["topic-chip-grid"],
  "full-list": fullCards["full-list"],
  "gold-frame": fullCards["gold-frame"],
  "handoff-rail": overviews["handoff-rail"],
  "case-study": proof["case-study"],
  "stat-disc": herkStats["stat-disc"],
  scoreboard: proof.scoreboard,
  checklist: procedures.checklist,
  meter: fullCards.meter,
  quote: payoffs.quote,
};

const source = (...ids) => ids.map((id) => `ghost-editor:${id}`).join(",");
const spoken = (width = 656, size = 40, maxLines = 2, maxChars = 44, validate) =>
  ({ kind: "spoken", width, size, maxLines, maxChars, ...(validate ? { validate } : {}) });
const repeat = (slot, min, max) => ({ ...slot, repeat: [min, max] });
const heading = { kind: "label", optional: true, width: 640, size: 28, maxLines: 1, maxChars: 24 };
const panel = (h) => ({ w: 720, h });
const height = (item, lineHeight = 48) => item.lines.length * lineHeight;
const rowsHeight = (items, padding) => items.reduce((sum, item) => sum + height(item) + padding, 0);
const bound = (above, below = 0) => `inset(${above}% 0 ${below}% 0)`;

function card(def) {
  return {
    ...def,
    surface: def.surface || "obsidian",
    hint: def.hint || roots[def.variantOf].hint,
    // The legacy fitter can reduce type. Select another design if this one needs that fallback.
    validate(slots) {
      return Object.values(slots).flat().every((item) => !item.fontSize) && def.validate?.(slots) !== false;
    },
  };
}

function tween(h, selector, from, to, at, state = false) {
  const duration = state ? h.motion.state : h.motion.enter;
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${duration},ease:${state ? "proState" : "proEnter"},immediateRender:false},${h.at(at)});`;
}

function write(h, selector, at, from = "inset(0 100% 0 0)") {
  return tween(h, selector, { opacity: 0, clipPath: from }, { opacity: 1, clipPath: bound(0) }, at);
}

function draw(h, selector, at) {
  return tween(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at, true);
}

function copyCSS(type) {
  return `
    .pro-${type} .gh-copy { min-width:0;font:700 40px/48px "Inter",sans-serif;opacity:0; }`;
}

function strokeCSS(type) {
  return `
    .pro-${type} .gh-draw { fill:none;stroke:#C8A24B;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1; }`;
}

const units = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const tens = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const clean = (text) => text.trim().toLowerCase().replace(/[.!?]$/, "");

function smallAmount(text) {
  if (/^\d{1,3}(?:\.\d+)?$/.test(text)) return Number(text);
  if (text === "one hundred") return 100;
  const unit = units.indexOf(text);
  if (unit !== -1) return unit;
  const [decade, tail, extra] = text.replaceAll("-", " ").split(" ");
  const tensIndex = tens.indexOf(decade), onesIndex = tail ? units.indexOf(tail) : 0;
  return tensIndex >= 0 && onesIndex >= (tail ? 1 : 0) && onesIndex < 10 && !extra ? 20 + 10 * tensIndex + onesIndex : null;
}

function duration(text) {
  const match = clean(text).match(/^(.+?)\s+(minutes?|hours?|days?)$/);
  if (!match) return null;
  const amount = smallAmount(match[1]);
  return Number.isInteger(amount) && amount > 0 && amount <= 60 ? { amount, unit: match[2].replace(/s$/, "") } : null;
}

function percent(text) {
  const match = clean(text).match(/^(.+?)\s*(?:%|percent|per cent)$/);
  if (!match) return null;
  const amount = smallAmount(match[1]);
  return amount !== null && amount <= 100 ? amount : null;
}

const check = '<svg viewBox="0 0 32 32" aria-hidden="true"><path class="gh-draw" pathLength="1" d="m6 16 7 7L26 9"/></svg>';
const signal = '<svg viewBox="0 0 36 36" aria-hidden="true"><path d="M5 7h26v18H17l-6 5v-5H5Z"/><path d="M11 13h14m-14 6h9"/></svg>';

export const CARDS = {
  "topic-slab-rise": card({
    variantOf: "section-divider",
    family: "emphasis",
    tags: ["title"],
    source: source("swiss-grid/signal-slab-overprint", "caption-news/sting-bottom-band"),
    slots: { headline: spoken(624, 52, 2, 48) },
    size: (o) => panel(108 + height(o.slots.headline[0], 60)),
    render(o, h) {
      const [headline] = o.slots.headline;
      const inner = `<div class="gh-label">Next topic</div><div class="gh-slab"><div class="gh-copy">${h.copy(headline)}</div></div>`;
      const timeline = [
        tween(h, ".gh-slab", { clipPath: bound(100) }, { clipPath: bound(0) }, headline.at),
        write(h, ".gh-copy", headline.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: copyCSS("topic-slab-rise") + `
      .pro-topic-slab-rise { padding:20px 32px;display:grid;align-content:center;gap:12px; }
      .pro-topic-slab-rise .gh-label { color:#A8A49C;font:700 28px/32px "Inter",sans-serif; }
      .pro-topic-slab-rise .gh-slab { padding:10px 16px;border-left:4px solid #F5F1E8;background:#C8A24B;clip-path:inset(100% 0 0 0); }
      .pro-topic-slab-rise .gh-copy { color:#0B0B0D;font:400 52px/60px "Anton",sans-serif; }`,
  }),
  "module-outline": card({
    variantOf: "chapter-index",
    family: "procedure",
    tags: ["list", "title"],
    source: source("swiss-grid/modules-programme"),
    slots: { topics: repeat(spoken(304, 40, 2, 24), 3, 5) },
    size: (o) => panel(20 + 130 * Math.ceil(o.slots.topics.length / 2)),
    render(o, h) {
      const inner = o.slots.topics.map((item, i) => `<div class="gh-module gh-module-${i}"><svg viewBox="0 0 336 116" preserveAspectRatio="none" aria-hidden="true"><rect class="gh-draw" pathLength="1" x="2" y="2" width="332" height="112" vector-effect="non-scaling-stroke"/></svg><div class="gh-copy">${h.copy(item)}</div></div>`).join("");
      const timeline = o.slots.topics.flatMap((item, i) =>
        [draw(h, `.gh-module-${i} .gh-draw`, item.at), write(h, `.gh-module-${i} .gh-copy`, item.at)]).join("\n");
      return { inner, timeline };
    },
    css: copyCSS("module-outline") + strokeCSS("module-outline") + `
      .pro-module-outline { padding:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:116px;gap:14px;align-content:center; }
      .pro-module-outline .gh-module { position:relative;display:grid;align-items:center;padding:8px 16px; }
      .pro-module-outline .gh-module:last-child:nth-child(odd) { grid-column:span 2; }
      .pro-module-outline .gh-module svg { position:absolute;inset:0;width:100%;height:100%; }
      .pro-module-outline .gh-copy { position:relative; }`,
  }),
  "off-track-reset": card({
    variantOf: "meter",
    family: "distinction",
    tags: ["comparison", "before-after"],
    source: source("swiss-grid/bleeding-bar"),
    slots: { heading, left: spoken(600), right: spoken(600) },
    size: (o) => panel(116 + Math.max(height(o.slots.left[0]), height(o.slots.right[0]))),
    render(o, h) {
      const { heading: [title], left: [old], right: [replacement] } = o.slots;
      const inner = `<div class="gh-label">${title ? h.copy(title) : "Change course"}</div><div class="gh-guide" aria-hidden="true"></div><div class="gh-rail" aria-hidden="true"></div><div class="gh-stage"><div class="gh-old"><div class="gh-copy">${h.copy(old)}</div></div><div class="gh-copy gh-new">${h.copy(replacement)}</div></div>`;
      const timeline = [
        write(h, ".gh-old .gh-copy", old.at),
        tween(h, ".gh-rail", { scaleX: 0, x: 16 }, { scaleX: 1, x: 16 }, old.at),
        tween(h, ".gh-rail", { x: 16, backgroundColor: "#A8A49C" }, { x: 0, backgroundColor: "#C8A24B" }, replacement.at, true),
        `tl.set(${h.sel(".gh-old")},{visibility:"hidden"},${h.at(replacement.at)});`,
        write(h, ".gh-new", replacement.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: copyCSS("off-track-reset") + `
      .pro-off-track-reset { position:absolute;padding:20px 32px;display:grid;grid-template-rows:32px 8px 1fr;align-content:center;gap:12px; }
      .pro-off-track-reset .gh-label { color:#A8A49C;font:700 28px/32px "Inter",sans-serif; }
      .pro-off-track-reset .gh-guide { position:absolute;left:632px;top:18px;bottom:18px;width:2px;background:#343438; }
      .pro-off-track-reset .gh-rail { width:600px;background:#A8A49C;transform:scaleX(0);transform-origin:left; }
      .pro-off-track-reset .gh-stage { display:grid;align-items:start; }
      .pro-off-track-reset .gh-old,.pro-off-track-reset .gh-new { grid-area:1 / 1;max-width:600px; }
      .pro-off-track-reset .gh-old { color:#A8A49C; }`,
  }),
  "scrolling-read-list": card({
    variantOf: "full-list",
    family: "procedure",
    tags: ["list"],
    source: source("swiss-grid/idea-3"),
    slots: { heading, items: repeat(spoken(656, 56, 2, 50), 3, 4) },
    size: { w: 1080, h: 1920 },
    fullscreen: true,
    render(o, h) {
      const { heading: [title], items } = o.slots;
      const inner = `<div class="gh-header">${title ? h.copy(title) : "Put it into practice"}</div><div class="gh-window"><div class="gh-page">${items.map((item, i) =>
        `<div class="gh-copy gh-line-${i}">${h.copy(item)}</div>`).join("")}</div></div>`;
      const timeline = items.flatMap((item, i) => [
        write(h, `.gh-line-${i}`, item.at, bound(0, 100)),
        ...(i ? [`tl.to(${h.sel(".gh-page")},{y:${-16 * i},duration:${h.motion.state},ease:proState},${h.at(item.at)});`] : []),
      ]).join("\n");
      return { inner, timeline };
    },
    css: copyCSS("scrolling-read-list") + `
      .pro-scrolling-read-list { padding:200px 180px 320px;background:#0B0B0D;display:grid;align-content:center;gap:28px; }
      .pro-scrolling-read-list .gh-header { font:700 32px/40px "Inter",sans-serif;color:#C8A24B; }
      .pro-scrolling-read-list .gh-window { overflow:hidden;border:2px solid #343438;border-left:6px solid #C8A24B;padding:52px 26px 4px; }
      .pro-scrolling-read-list .gh-copy { padding:24px 0;border-top:2px solid #343438;font:750 56px/64px "Inter",sans-serif; }`,
  }),
  "channel-signal-rows": card({
    variantOf: "topic-chip-grid",
    family: "emphasis",
    tags: ["list", "highlight"],
    source: source("caption-news/lit-grid-apps"),
    slots: { items: repeat(spoken(538, 40, 2, 34), 2, 4) },
    size: (o) => panel(34 + rowsHeight(o.slots.items, 28)),
    render(o, h) {
      const { items } = o.slots;
      const inner = items.map((item, i) =>
        `<div class="gh-tile gh-tile-${i}">${signal}<div class="gh-copy">${h.copy(item)}</div><svg class="gh-dot" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/></svg></div>`).join("");
      const timeline = items.flatMap((item, i) => [
        tween(h, `.gh-tile-${i}`, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, item.at),
        write(h, `.gh-tile-${i} .gh-copy`, item.at),
        tween(h, `.gh-tile-${i} .gh-dot`, { scale: 0 }, { scale: 1 }, item.at, true),
      ]).join("\n");
      return { inner, timeline };
    },
    css: copyCSS("channel-signal-rows") + `
      .pro-channel-signal-rows { display:grid;align-content:center;gap:8px;padding:16px 24px; }
      .pro-channel-signal-rows .gh-tile { display:grid;grid-template-columns:36px minmax(0,1fr) 16px;align-items:center;gap:14px;padding:8px 20px;border:2px solid #C8A24B;background:#0B0B0D;opacity:0; }
      .pro-channel-signal-rows .gh-tile svg { width:36px;fill:none;stroke:#A8A49C;stroke-width:2; }
      .pro-channel-signal-rows .gh-tile .gh-dot { width:16px;fill:#C8A24B;stroke:none;transform:scale(0); }`,
  }),
  "score-rollover": card({
    variantOf: "scoreboard",
    family: "proof",
    tags: ["comparison", "number"],
    source: source("caption-news/idea-3"),
    slots: {
      leftTeam: spoken(624, 40, 1, 24),
      leftScore: spoken(624, 96, 2, 24, proof.scoreboard.slots.leftScore.validate),
      rightTeam: spoken(624, 40, 1, 24),
      rightScore: spoken(624, 96, 2, 24, proof.scoreboard.slots.rightScore.validate),
    },
    size: (o) => panel(148 + height(o.slots.leftScore[0], 100) + height(o.slots.rightScore[0], 100)),
    render(o, h) {
      const sides = ["left", "right"].map((side) => ({ side, team: o.slots[`${side}Team`][0], score: o.slots[`${side}Score`][0] }));
      const inner = sides.map(({ side, team, score }) => `<div class="gh-counter gh-${side}"><div class="gh-copy">${h.copy(team)}</div><div class="gh-gate"><div class="gh-number">${h.copy(score)}</div></div></div>`).join("");
      const timeline = sides.flatMap(({ side, team, score }) => [
        write(h, `.gh-${side} .gh-copy`, team.at),
        tween(h, `.gh-${side} .gh-number`, { opacity: 0, y: 16, clipPath: bound(0, 100) },
          { opacity: 1, y: 0, clipPath: bound(0) }, score.at),
      ]).join("\n");
      return { inner, timeline };
    },
    css: copyCSS("score-rollover") + `
      .pro-score-rollover { padding:16px 32px;display:grid;align-content:center;gap:8px; }
      .pro-score-rollover .gh-counter { padding:0 14px;border:2px solid #343438;background:#0B0B0D; }
      .pro-score-rollover .gh-gate { overflow:hidden;border-top:2px solid #343438; }
      .pro-score-rollover .gh-number { color:#C8A24B;font:400 96px/100px "Anton",sans-serif;opacity:0; }`,
  }),
  "flap-state-change": card({
    variantOf: "meter",
    family: "distinction",
    tags: ["comparison", "before-after"],
    source: source("news-package/flap-board-on-off"),
    slots: { heading, left: spoken(624, 44), right: spoken(624, 44) },
    size: (o) => panel(104 + Math.max(height(o.slots.left[0], 52), height(o.slots.right[0], 52))),
    render(o, h) {
      const { heading: [title], left: [old], right: [replacement] } = o.slots;
      const inner = `<div class="gh-label">${title ? h.copy(title) : "Change course"}</div><div class="gh-board"><div class="gh-flap gh-old"><div class="gh-copy">${h.copy(old)}</div></div><div class="gh-flap gh-new"><div class="gh-copy">${h.copy(replacement)}</div></div></div>`;
      const timeline = [
        tween(h, ".gh-old", { opacity: 0 }, { opacity: 1 }, old.at),
        write(h, ".gh-old .gh-copy", old.at),
        tween(h, ".gh-old", { clipPath: bound(0) }, { clipPath: bound(50, 50) }, replacement.at, true),
        tween(h, ".gh-new", { opacity: 1, clipPath: bound(50, 50) }, { opacity: 1, clipPath: bound(0) }, replacement.at, true),
        write(h, ".gh-new .gh-copy", replacement.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: copyCSS("flap-state-change") + `
      .pro-flap-state-change { display:grid;align-content:center;gap:10px;padding:20px 32px; }
      .pro-flap-state-change .gh-label { color:#A8A49C;font:700 28px/32px "Inter",sans-serif; }
      .pro-flap-state-change .gh-board { display:grid;border:2px solid #343438;background:#0B0B0D; }
      .pro-flap-state-change .gh-flap { grid-area:1 / 1;display:grid;align-content:center;position:relative;padding:8px 14px;opacity:0; }
      .pro-flap-state-change .gh-flap::after { content:"";position:absolute;left:0;right:0;top:50%;height:2px;background:#A8A49C;opacity:.35; }
      .pro-flap-state-change .gh-old { background:#343438; }
      .pro-flap-state-change .gh-new { background:#C8A24B;color:#0B0B0D;clip-path:inset(50% 0 50% 0); }
      .pro-flap-state-change .gh-copy { z-index:1;font:700 44px/52px "Inter",sans-serif; }`,
  }),
  "fold-checklist": card({
    variantOf: "checklist",
    family: "procedure",
    tags: ["checklist", "list"],
    source: source("news-package/check-rows-off"),
    slots: { heading, items: repeat(spoken(548), 2, 4) },
    size: (o) => panel(32 + (o.slots.heading.length ? 40 : 0) + rowsHeight(o.slots.items, 24)),
    render(o, h) {
      const { heading: [title], items } = o.slots;
      const inner = (title ? `<div class="gh-label">${h.copy(title)}</div>` : "") + items.map((item, i) =>
        `<div class="gh-row gh-row-${i}"><div class="gh-box">${check}</div><div class="gh-copy">${h.copy(item)}</div></div>`).join("");
      const timeline = items.flatMap((item, i) => {
        const row = `.gh-row-${i}`;
        return [
          tween(h, row, { clipPath: bound(49, 49), opacity: 0 }, { clipPath: bound(0), opacity: 1 }, item.at),
          write(h, `${row} .gh-copy`, item.at),
          draw(h, `${row} .gh-draw`, item.at),
        ];
      }).join("\n");
      return { inner, timeline };
    },
    css: copyCSS("fold-checklist") + strokeCSS("fold-checklist") + `
      .pro-fold-checklist { display:grid;align-content:center;gap:8px;padding:16px 24px; }
      .pro-fold-checklist .gh-label { color:#C8A24B;font:700 28px/32px "Inter",sans-serif; }
      .pro-fold-checklist .gh-row { display:grid;grid-template-columns:42px minmax(0,1fr);align-items:center;gap:18px;padding:8px 20px;background:#343438;border-left:4px solid #C8A24B;opacity:0; }
      .pro-fold-checklist .gh-box { width:36px;height:36px;border:2px solid #A8A49C; }
      .pro-fold-checklist .gh-box svg { display:block;width:32px;height:32px; }`,
  }),
  "actions-to-principle": card({
    family: "procedure",
    tags: ["list", "rule"],
    hint: "Greg gives three concrete sales actions or examples, then explicitly states the single principle they illustrate; quote all three examples and his closing synthesis",
    source: source("news-package/accent-cards-bracket"),
    slots: { examples: repeat(spoken(530, 40, 2, 36), 3, 3), principle: spoken(608, 44, 2, 48) },
    size: (o) => panel(86 + rowsHeight(o.slots.examples, 20) + height(o.slots.principle[0], 52)),
    render(o, h) {
      const { examples, principle: [principle] } = o.slots;
      const bracket = '<svg class="gh-brace" viewBox="0 0 40 180" preserveAspectRatio="none" aria-hidden="true"><path class="gh-draw" pathLength="1" vector-effect="non-scaling-stroke" d="M3 3h20v150q0 19-20 24"/></svg>';
      const inner = `<div class="gh-group">${examples.map((item, i) =>
        `<div class="gh-example gh-example-${i}"><div class="gh-copy">${h.copy(item)}</div></div>`).join("")}${bracket}</div><div class="gh-rule"><div class="gh-copy">${h.copy(principle)}</div></div>`;
      const timeline = examples.flatMap((item, i) => [
        tween(h, `.gh-example-${i}`, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, item.at),
        write(h, `.gh-example-${i} .gh-copy`, item.at),
      ]);
      timeline.push(draw(h, ".gh-draw", principle.at), write(h, ".gh-rule", principle.at), write(h, ".gh-rule .gh-copy", principle.at));
      return { inner, timeline: timeline.join("\n") };
    },
    css: copyCSS("actions-to-principle") + strokeCSS("actions-to-principle") + `
      .pro-actions-to-principle { padding:24px 32px;display:grid;align-content:center;gap:20px; }
      .pro-actions-to-principle .gh-group { position:relative;display:grid;gap:8px;padding-right:48px; }
      .pro-actions-to-principle .gh-example { padding:6px 10px 6px 18px;background:#343438;border-left:4px solid #C8A24B;opacity:0; }
      .pro-actions-to-principle .gh-brace { position:absolute;right:1px;top:0;height:calc(100% + 18px);width:40px; }
      .pro-actions-to-principle .gh-rule { background:#C8A24B;padding:9px 20px;opacity:0; }
      .pro-actions-to-principle .gh-rule .gh-copy { color:#0B0B0D;font:750 44px/52px "Inter",sans-serif; }`,
  }),
  "contracting-share": card({
    variantOf: "case-study",
    family: "proof",
    tags: ["before-after", "percent", "chart"],
    source: source("news-package/proportion-bar-cells"),
    slots: {
      before: spoken(624, 40, 1, 24, (text) => percent(text) !== null),
      after: spoken(624, 96, 2, 25, (text, slots) => percent(text) !== null && percent(text) < percent(slots.before[0].text)),
      label: spoken(624, 40, 2, 46),
    },
    size: (o) => panel(158 + height(o.slots.after[0], 104) + height(o.slots.label[0])),
    render(o, h) {
      const { before: [before], after: [after], label: [label] } = o.slots;
      const start = percent(before.text) / 100, finish = percent(after.text) / 100;
      const dividers = Array.from({ length: 9 }, (_, i) => `M${(i + 1) * 64} 0v24`).join("");
      const inner = `<div class="gh-copy gh-before">${h.copy(before)}</div><div class="gh-track" aria-hidden="true"><div class="gh-fill"></div><svg viewBox="0 0 640 24" preserveAspectRatio="none"><path d="${dividers}"/></svg></div><div class="gh-copy gh-after">${h.copy(after)}</div><div class="gh-copy gh-metric">${h.copy(label)}</div>`;
      const timeline = [
        write(h, ".gh-before", before.at),
        tween(h, ".gh-fill", { scaleX: 0 }, { scaleX: start }, before.at),
        tween(h, ".gh-fill", { scaleX: start }, { scaleX: finish }, after.at, true),
        write(h, ".gh-after", after.at),
        write(h, ".gh-metric", label.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: copyCSS("contracting-share") + `
      .pro-contracting-share { padding:20px 32px;display:grid;align-content:center;gap:10px; }
      .pro-contracting-share .gh-before { color:#A8A49C; }
      .pro-contracting-share .gh-track { position:relative;height:24px;background:#343438; }
      .pro-contracting-share .gh-fill { height:100%;background:#C8A24B;transform:scaleX(0);transform-origin:left; }
      .pro-contracting-share .gh-track svg { position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:#0B0B0D;stroke-width:2; }
      .pro-contracting-share .gh-after { color:#C8A24B;font:400 96px/104px "Anton",sans-serif; }`,
  }),
  "advice-imprint": card({
    variantOf: "gold-frame",
    family: "payoff",
    tags: ["rule", "callout"],
    source: source("telestrator/stamp-simple-advice"),
    slots: { heading, quote: spoken(600, 48, 2, 42) },
    size: (o) => panel(110 + height(o.slots.quote[0], 56) + (o.slots.heading.length ? 44 : 0)),
    surface: "bone",
    render(o, h) {
      const { heading: [title], quote: [line] } = o.slots;
      const inner = (title ? `<div class="gh-label">${h.copy(title)}</div>` : "") +
        `<div class="gh-paper"><div class="gh-stamp"><div class="gh-copy">${h.copy(line)}</div></div></div>`;
      const timeline = [
        tween(h, ".gh-stamp", { y: -14, scale: 1.04, opacity: 0 }, { y: 0, scale: 1, opacity: 1 }, line.at),
        write(h, ".gh-copy", line.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: copyCSS("advice-imprint") + `
      .pro-advice-imprint { display:grid;align-content:center;gap:12px;padding:28px 40px; }
      .pro-advice-imprint .gh-label { font:700 28px/32px "Inter",sans-serif;color:#343438; }
      .pro-advice-imprint .gh-paper { transform:rotate(-2deg); }
      .pro-advice-imprint .gh-stamp { border:5px double #0B0B0D;padding:12px 14px;background:#C8A24B;opacity:0; }
      .pro-advice-imprint .gh-copy { font:400 48px/56px "Anton",sans-serif;color:#0B0B0D; }`,
  }),
  "underlined-actions": card({
    variantOf: "handoff-rail",
    family: "procedure",
    tags: ["list", "steps"],
    source: source("telestrator/board-numbered-rows-icons"),
    slots: { stages: repeat(spoken(556, 40, 2, 38), 3, 4) },
    size: (o) => panel(34 + rowsHeight(o.slots.stages, 30)),
    render(o, h) {
      const inner = o.slots.stages.map((item, i) =>
        `<div class="gh-note gh-note-${i}"><svg class="gh-marker" viewBox="0 0 32 32" aria-hidden="true"><path class="gh-draw" pathLength="1" d="M5 22 14 9l12 5-6 11Z"/></svg><div class="gh-copy">${h.copy(item)}</div><svg class="gh-rule" viewBox="0 0 560 12" preserveAspectRatio="none" aria-hidden="true"><path class="gh-draw" pathLength="1" d="M3 7Q265 4 554 6"/></svg></div>`).join("");
      const timeline = o.slots.stages.flatMap((item, i) => [
        write(h, `.gh-note-${i} .gh-copy`, item.at),
        draw(h, `.gh-note-${i} .gh-draw`, item.at),
      ]).join("\n");
      return { inner, timeline };
    },
    css: copyCSS("underlined-actions") + strokeCSS("underlined-actions") + `
      .pro-underlined-actions { display:grid;align-content:center;gap:8px;padding:16px 32px; }
      .pro-underlined-actions .gh-note { display:grid;grid-template-columns:32px minmax(0,1fr);gap:0 18px;padding:6px 10px 4px;background:#0B0B0D; }
      .pro-underlined-actions .gh-marker { width:32px;height:32px;align-self:center; }
      .pro-underlined-actions .gh-rule { grid-column:2;width:100%;height:12px; }
      .pro-underlined-actions .gh-rule .gh-draw { stroke-width:2; }`,
  }),
  "rising-stat": card({
    variantOf: "stat-disc",
    family: "proof",
    tags: ["number", "callout"],
    source: source("halftone-dossier/prop-halftone-numeral"),
    slots: {
      value: spoken(640, 96, 2, 32, herkStats["qualified-stat"].slots.value.validate),
      context: spoken(640, 40, 2, 52),
    },
    size: (o) => panel(66 + height(o.slots.value[0], 104) + height(o.slots.context[0])),
    render(o, h) {
      const { value: [value], context: [context] } = o.slots;
      const inner = `<div class="gh-well"><div class="gh-number">${h.copy(value)}</div><div class="gh-floor" aria-hidden="true"></div></div><div class="gh-copy">${h.copy(context)}</div>`;
      const timeline = [
        tween(h, ".gh-floor", { scaleX: 0 }, { scaleX: 1 }, value.at),
        tween(h, ".gh-number", { opacity: 0, y: 16, clipPath: bound(0, 100) }, { opacity: 1, y: 0, clipPath: bound(0) }, value.at),
        write(h, ".gh-copy", context.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: copyCSS("rising-stat") + `
      .pro-rising-stat { display:grid;align-content:center;gap:10px;padding:24px 32px; }
      .pro-rising-stat .gh-well { position:relative;overflow:hidden; }
      .pro-rising-stat .gh-floor { height:3px;background:#C8A24B;transform:scaleX(0);transform-origin:left; }
      .pro-rising-stat .gh-number { font:400 96px/104px "Anton",sans-serif;color:#C8A24B;opacity:0; }`,
  }),
  "pinned-actions": card({
    variantOf: "handoff-rail",
    family: "procedure",
    tags: ["list", "steps"],
    source: source("halftone-dossier/scene-evidence-board"),
    slots: { stages: repeat(spoken(544, 40, 2, 40), 3, 4) },
    size: (o) => panel(32 + (Math.max(...o.slots.stages.map((item) => height(item))) + 24) * o.slots.stages.length),
    render(o, h) {
      const { stages: items } = o.slots;
      const stride = Math.max(...items.map((item) => height(item))) + 24;
      const pins = items.map((_, i) => [i % 2 ? 42 : 20, i * stride + (stride - 12) / 2]);
      const board = `<svg class="gh-string" viewBox="0 0 64 ${stride * items.length}" aria-hidden="true">${pins.map(([x, y], i) =>
        i ? `<path class="gh-draw gh-line-${i}" pathLength="1" d="M${pins[i - 1].join(" ")}L${x} ${y}"/>` : "").join("")}</svg>`;
      const inner = `<div class="gh-board" style="grid-auto-rows:${stride}px">${board}${items.map((item, i) =>
        `<div class="gh-pin-row gh-pin-row-${i}"><svg class="gh-pin" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/></svg><div class="gh-copy">${h.copy(item)}</div></div>`).join("")}</div>`;
      const timeline = items.flatMap((item, i) => [
        tween(h, `.gh-pin-row-${i}`, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, item.at),
        write(h, `.gh-pin-row-${i} .gh-copy`, item.at),
        ...(i ? [draw(h, `.gh-line-${i}`, item.at)] : []),
      ]).join("\n");
      return { inner, timeline };
    },
    css: copyCSS("pinned-actions") + strokeCSS("pinned-actions") + `
      .pro-pinned-actions { padding:16px 32px;display:grid;align-content:center; }
      .pro-pinned-actions .gh-board { display:grid;position:relative; }
      .pro-pinned-actions .gh-string { position:absolute;top:0;left:0;width:64px;height:100%; }
      .pro-pinned-actions .gh-pin-row { position:relative;display:grid;align-items:center;margin:0 0 12px 20px;padding:4px 16px 4px 28px;border:2px solid #343438;border-left:0;background:#343438;opacity:0; }
      .pro-pinned-actions .gh-pin-row:nth-of-type(even) { margin-left:42px; }
      .pro-pinned-actions .gh-pin { position:absolute;left:-10px;top:calc(50% - 10px);width:20px;height:20px;fill:#C8A24B;stroke:#0B0B0D;stroke-width:3; }`,
  }),
  "obstacle-reassurance": card({
    family: "payoff",
    tags: ["callout", "highlight"],
    hint: "Greg names a specific intimidating sales task or obstacle, then directly reassures reps about their ability to face it; use the obstacle and his actual reassurance",
    source: source("halftone-dossier/scene-mountain-verdict"),
    slots: { obstacle: spoken(528, 40, 2, 38), reassurance: spoken(528, 44, 2, 40) },
    size: (o) => panel(92 + height(o.slots.obstacle[0]) + height(o.slots.reassurance[0], 52)),
    render(o, h) {
      const { obstacle: [obstacle], reassurance: [reassurance] } = o.slots;
      const climb = '<svg class="gh-climb" viewBox="0 0 96 108" aria-hidden="true"><path class="gh-draw gh-slope" pathLength="1" d="M6 96 33 72l18 8L82 48"/><path class="gh-draw gh-flag" pathLength="1" d="M82 48V12H56l6 7-6 7h26"/></svg>';
      const inner = `${climb}<div class="gh-lines"><div class="gh-copy gh-obstacle">${h.copy(obstacle)}</div><div class="gh-stamp"><div class="gh-copy">${h.copy(reassurance)}</div></div></div>`;
      const timeline = [
        draw(h, ".gh-slope", obstacle.at),
        write(h, ".gh-obstacle", obstacle.at),
        draw(h, ".gh-flag", reassurance.at),
        tween(h, ".gh-stamp", { opacity: 0, y: -12, scale: 1.035 }, { opacity: 1, y: 0, scale: 1 }, reassurance.at),
        write(h, ".gh-stamp .gh-copy", reassurance.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: copyCSS("obstacle-reassurance") + strokeCSS("obstacle-reassurance") + `
      .pro-obstacle-reassurance { display:grid;grid-template-columns:88px minmax(0,1fr);align-items:center;gap:20px;padding:20px 24px; }
      .pro-obstacle-reassurance .gh-climb { width:88px;height:104px; }
      .pro-obstacle-reassurance .gh-slope { stroke:#A8A49C; }
      .pro-obstacle-reassurance .gh-lines { display:grid;gap:10px; }
      .pro-obstacle-reassurance .gh-obstacle { padding:0 12px;color:#A8A49C; }
      .pro-obstacle-reassurance .gh-stamp { border:2px solid #C8A24B;padding:7px 12px;opacity:0; }
      .pro-obstacle-reassurance .gh-stamp .gh-copy { color:#C8A24B;font:750 44px/52px "Inter",sans-serif; }`,
  }),
  "pull-quote-unmask": card({
    variantOf: "quote",
    family: "payoff",
    tags: ["quote", "highlight"],
    source: source("halftone-dossier/idea-1"),
    slots: { quote: spoken(640, 44, 3, 70) },
    size: (o) => panel(64 + 64 * o.slots.quote[0].lines.length),
    render(o, h) {
      const [item] = o.slots.quote;
      const inner = item.lines.map((line, i) => `<div class="gh-row gh-row-${i}"><div class="gh-copy">${h.copy({ text: line })}</div><div class="gh-mask" aria-hidden="true"></div></div>`).join("");
      const timeline = item.lines.flatMap((_, i) => {
        const row = `.gh-row-${i}`;
        return [write(h, `${row} .gh-copy`, item.at, bound(100)),
          tween(h, `${row} .gh-mask`, { scaleY: 1 }, { scaleY: 0 }, item.at + i * 0.036, true)];
      }).join("\n");
      return { inner, timeline };
    },
    css: copyCSS("pull-quote-unmask") + `
      .pro-pull-quote-unmask { padding:24px 32px;display:grid;align-content:center;gap:10px; }
      .pro-pull-quote-unmask .gh-row { position:relative;background:#343438; }
      .pro-pull-quote-unmask .gh-copy { position:relative;padding:0 8px;font:750 44px/54px "Inter",sans-serif;color:#F5F1E8; }
      .pro-pull-quote-unmask .gh-mask { position:absolute;inset:0;background:#A8A49C;border-bottom:4px solid #C8A24B;transform-origin:top; }`,
  }),
};
