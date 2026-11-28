// Layout and motion ideas from ghost-editor (MIT, copyright 2026 kurbaitaev). See src/pro-cards/GHOST-EDITOR-LICENSE.md.
import { CARDS as proof } from "./proof-2.mjs";
import { CARDS as herkLabels } from "./herk-klabel.mjs";
import { CARDS as procedure } from "./procedure-proof.mjs";
import { CARDS as warnings } from "./warning-emphasis-full.mjs";

const ink = "#0B0B0D", bone = "#F5F1E8", gold = "#C8A24B", grey = "#A8A49C", rule = "#343438";
const focusHint = "Greg names two or three competing sales tasks and explicitly repeats the exact name of the one he chooses to focus on. Use the later repetition as the choice";
const movingHint = "Greg names one actual business metric and gives its explicit percentage decrease, then names a second metric and gives its explicit percentage increase in the same comparison";
const discardHint = "Greg quotes a short outreach line a rep started writing and then explicitly says to delete it or leave it unsent. Use the draft and the exact later instruction";
const source = (...ids) => ids.map((id) => `ghost-editor:clean-os/${id}`).join(",");
const repeat = (slot, min, max = min) => ({ ...slot, repeat: [min, max] });
const optional = (slot) => ({ ...slot, optional: true });

// Check at the displayed size so the planner's fallback never shrinks copy below the layout's budget.
function fits(text, width, size, maxLines) {
  const measure = (run) => [...run].reduce((sum, char) => sum +
    (/\s/.test(char) ? 0.3 : /[ilI.,!'’]/.test(char) ? 0.32 : /[MW@]/.test(char) ? 0.95 : /[A-Z]/.test(char) ? 0.75 : 0.65) * size, 0);
  if (!text.trim() || /[\p{Emoji_Presentation}\uFE0F\u20E3]/u.test(text)) return false;
  let lines = 1, line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (measure(word) > width) return false;
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) line = next;
    else {
      if (++lines > maxLines) return false;
      line = word;
    }
  }
  return true;
}

const spoken = (maxChars, width = 656, size = 40, maxLines = 2, check = () => true) => ({
  kind: "spoken", maxChars, width, size, maxLines,
  validate: (text, slots) => fits(text, width, size, maxLines) && check(text, slots),
});
const heading = optional({ kind: "label", maxChars: 24, width: 640, size: 30, maxLines: 1 });
const hero = (maxChars, width, check, maxLines = 2) => spoken(maxChars, width, 96, maxLines, check);
const wholeCount = proof.odometer.slots.value.validate;
const countAtMostSeven = proof.streak.slots.count.validate;
const normalize = (text) => text.trim().toLowerCase().replace(/[.,!?;:]+$/, "").replace(/\s+/g, " ");
const numberWords = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i;

function card(type, { h, w = 720, ids, rules, surface = "obsidian", validate, ...definition }) {
  const scope = `.pro-${type}`;
  const base = {
    "": `display:flex;flex-direction:column;justify-content:center;padding:24px 32px;background:${surface === "bone" ? bone : ink};color:${surface === "bone" ? ink : bone};font:700 40px/48px "Inter",sans-serif;`,
    ".gb-copy": "min-width:0;opacity:0;clip-path:inset(0 100% 0 0);",
  };
  const selectors = new Set([...Object.keys(base), ...Object.keys(rules)]);
  const css = [...selectors].map((selector) =>
    `${scope}${selector ? " " + selector : ""} { ${base[selector] ?? ""} ${rules[selector] ?? ""} }`).join("\n");
  const def = { ...definition, surface, source: source(...ids), size: typeof h === "function" ? (o) => ({ w, h: h(o) }) : { w, h }, css };
  if (definition.slots.heading) {
    def.validate = (slots) => slots.heading.every(({ text }) =>
      !/\p{N}/u.test(text) && !numberWords.test(text) && fits(text, heading.width, heading.size, heading.maxLines)) &&
      (!validate || validate(slots));
  } else if (validate) def.validate = validate;
  return def;
}

function tween(h, selector, from, to, at, motion) {
  const ease = motion === "enter" ? "proEnter" : "proState";
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion[motion]},ease:${ease},immediateRender:false},${h.at(at)});`;
}

const state = (h, selector, from, to, at) => tween(h, selector, from, to, at, "state");
const enter = (h, selector, from, to, at) => tween(h, selector, { opacity: 0, ...from }, { opacity: 1, ...to }, at, "enter");
const wipe = "inset(0 100% 0 0)", open = "inset(0 0% 0 0)";
const write = (h, name, item, from = {}, to = {}) =>
  enter(h, `.gb-${name}`, { clipPath: wipe, ...from }, { clipPath: open, ...to }, item.at);
const rise = (h, name, item) => write(h, name, item, { y: 12, clipPath: "inset(100% 0 0 0)" }, { y: 0 });
const draw = (h, selector, at) => state(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at);
const slideOut = (h, selector, at) => state(h, selector, { x: 0, opacity: 1 }, { x: -16, opacity: 0 }, at);
const copy = (h, name, item) => `<div class="gb-copy gb-${name}">${h.copy(item)}</div>`;
const label = (text) => `<div class="gb-label">${text}</div>`;
const svg = (name, box, paths) => `<svg class="gb-${name}" viewBox="${box}" aria-hidden="true">${paths}</svg>`;
const tick = '<path pathLength="1" d="m8 16 5 5 11-11"/>';
const searchIcon = svg("icon", "0 0 48 48", '<circle cx="20" cy="20" r="12"/><path d="m29 29 12 12"/>');
const trace = `fill:none;stroke:${gold};stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;`;
const numberStyle = `color:${gold};font:400 96px/112px "Anton",sans-serif;`;
const labelStyle = `color:${gold};font:750 30px/36px "Inter",sans-serif;letter-spacing:1px;`;

const signedChange = herkLabels["reported-change-chip"].slots.change.validate;
const unsignedChange = (text) => text.replace(/^(?:(?:up|down)\s+|[+−-])\s*/i, "");
const nonzeroChange = (text) => !/^(?:0+(?:\.0+)?|zero)\s*(?:%|per ?cent)[.!?]?$/i.test(unsignedChange(text)) && signedChange(text);
const decline = (text) => /^(?:down\s+|[-−])/i.test(text) && nonzeroChange(text);
const increase = (text) => /^(?:up\s+|\+)/i.test(text) && nonzeroChange(text);
const isPercent = proof.gauge.slots.value.validate;
const changeMagnitude = (text) => percentPoint(unsignedChange(text));

// Use explicit decimal percentages for ring geometry. Worded percentages stay eligible for the other case-study designs.
function percentPoint(text) {
  return isPercent(text) && /^\d+(?:\.\d+)?\s*(?:%|per ?cent)[.!?]?$/i.test(text) ? Number.parseFloat(text) : null;
}

// A proportional receipt design needs a single dollar figure per row and an independently spoken matching total.
function cents(text) {
  const matches = [...text.matchAll(/(?:\$\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?(?![\w,%]|\.\d)|(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})? dollars?\b)/gi)];
  if (matches.length !== 1 || /[-−–—]\s*[$\d]|\b(?:about|roughly|around|minus|negative|between|up to|at least|at most|cents)\b/i.test(text)) return null;
  const [match, dollars, fraction, wordDollars, wordFraction] = matches[0];
  const rest = text.slice(0, matches[0].index) + text.slice(matches[0].index + match.length);
  if (/\d|\$|\bdollars?\b/i.test(rest) || numberWords.test(rest)) return null;
  const value = 100 * Number((dollars ?? wordDollars).replaceAll(",", "")) + Number((fraction ?? wordFraction ?? ".0").slice(1).padEnd(2, "0"));
  return Number.isSafeInteger(value) ? value : null;
}

const choiceIndex = (slots) => slots.options.findIndex((item) => normalize(item.text) === normalize(slots.choice[0].text));
const validChoice = (slots) => new Set(slots.options.map((item) => normalize(item.text))).size === slots.options.length &&
  choiceIndex(slots) >= 0;
const statuses = (slots) => slots.blocks.map((_, i) => [slots.blocks[i], slots.replacements[i]]);

export const CARDS = {
  "counter-moving-results": card("counter-moving-results", {
    family: "proof", tags: ["comparison", "percent", "chart"],
    h: (o) => 126 + 106 * (o.slots.decrease[0].lines.length + o.slots.increase[0].lines.length),
    ids: ["cost-down-bars-up", "health-bars-fatigue-sleep"],
    hint: movingHint,
    slots: { fallingMetric: spoken(38, 520, 40, 1), decrease: hero(24, 520, decline), risingMetric: spoken(38, 520, 40, 1), increase: hero(24, 520, increase) },
    render(o, h) {
      const rows = [["fallingMetric", "decrease", "M8 12L88 63M61 63H88V36"], ["risingMetric", "increase", "M8 63L88 12M61 12H88V39"]];
      const timeline = [];
      const inner = rows.map(([metric, value, path]) => {
        const [name] = o.slots[metric], [change] = o.slots[value];
        timeline.push(write(h, metric, name), rise(h, value, change), draw(h, `.gb-${value}-arrow path`, change.at));
        return `<div class="gb-result">${svg(`${value}-arrow`, "0 0 96 76", `<path pathLength="1" d="${path}"/>`)}<div>${copy(h, value, change)}${copy(h, metric, name)}</div></div>`;
      }).join("");
      return { inner, timeline: timeline.join("\n") };
    },
    // Direction marks are arrows, so the graphic makes no claim about a common data scale.
    rules: {
      "": "display:grid;grid-template-columns:1fr;gap:6px;padding:12px 32px;",
      ".gb-result": `display:grid;grid-template-columns:96px 1fr;align-items:center;gap:24px;border-left:4px solid ${rule};padding-left:12px;`,
      ".gb-result svg": "width:96px;height:76px;",
      ".gb-result path": trace,
      ".gb-decrease": `${numberStyle}color:${grey};line-height:106px;`,
      ".gb-increase": `${numberStyle}line-height:106px;`,
      ".gb-fallingMetric": "line-height:46px;",
      ".gb-risingMetric": "line-height:46px;",
    },
  }),

  "marked-quote-page": card("marked-quote-page", {
    variantOf: "quote-explained", family: "payoff", tags: ["quote", "highlight"],
    hint: herkLabels["quote-explained"].hint,
    h: 352, surface: "bone", ids: ["quote-page-card"],
    slots: { quote: spoken(58, 632, 48, 3), explanation: spoken(66, 632, 40, 2) },
    render(o, h) {
      const [quote] = o.slots.quote, [explanation] = o.slots.explanation;
      const lines = quote.lines.map((line) => `<div class="gb-line"><div class="gb-marker"></div><span>${h.esc(line)}</span></div>`).join("");
      return {
        inner: `<div class="gb-copy gb-quote">${lines}</div><div class="gb-page-rule"></div>${copy(h, "explanation", explanation)}`,
        timeline: [write(h, "quote", quote), state(h, ".gb-marker", { clipPath: wipe }, { clipPath: open }, quote.at),
          write(h, "explanation", explanation)].join("\n"),
      };
    },
    rules: {
      "": "gap:14px;padding:24px 44px;",
      ".gb-quote": 'font:800 48px/58px "Inter",sans-serif;',
      ".gb-line": "position:relative;display:table;",
      ".gb-line span": "position:relative;",
      ".gb-marker": `position:absolute;inset:58% 0 5%;background:${gold};clip-path:${wipe};`,
      ".gb-page-rule": `height:2px;background:${rule};`,
      ".gb-explanation": `color:${rule};`,
    },
  }),

  "receipt-share-strip": card("receipt-share-strip", {
    variantOf: "receipt", family: "warning", tags: ["money", "number", "chart"],
    hint: warnings.receipt.hint,
    h: (o) => 244 + 48 * o.slots.items.reduce((sum, item) => sum + item.lines.length, 0),
    surface: "bone", ids: ["receipt-split-bar"],
    slots: {
      heading,
      items: repeat(spoken(44, 640, 40, 2, (text) => cents(text) !== null), 2, 3),
      total: hero(10, 640, (text) => proof["money-stack"].slots.value.validate(text) && cents(text) > 0, 1),
    },
    validate: ({ items, total }) => items.reduce((sum, item) => sum + cents(item.text), 0) === cents(total[0].text),
    render(o, h) {
      const [total] = o.slots.total;
      const [title] = o.slots.heading;
      const totalCents = cents(total.text);
      const timeline = [];
      const rows = o.slots.items.map((item, i) => {
        timeline.push(rise(h, `cost-${i}`, item));
        return copy(h, `cost-${i}`, item);
      });
      // Shares land with the stated total so provisional denominators never appear.
      const strips = o.slots.items.map((item, i) =>
        `<div class="gb-segment gb-segment-${i}" style="flex-basis:${100 * cents(item.text) / totalCents}%"></div>`);
      timeline.push(rise(h, "total", total), state(h, ".gb-strip", { scaleX: 0 }, { scaleX: 1 }, total.at));
      return {
        inner: label(title ? h.copy(title) : "The receipt") + rows.join("") +
          `<div class="gb-strip" aria-hidden="true">${strips.join("")}</div>${copy(h, "total", total)}`,
        timeline: timeline.join("\n"),
      };
    },
    rules: {
      "": "gap:4px;padding:16px 40px;",
      ".gb-label": `${labelStyle}color:${rule};margin-bottom:6px;`,
      ".gb-strip": "display:flex;transform-origin:left;transform:scaleX(0);height:22px;margin-top:8px;",
      ".gb-segment": `background:${rule};`,
      ".gb-segment-1": `background:${gold};`,
      ".gb-segment-2": `background:${grey};`,
      ".gb-total": `${numberStyle}color:${ink};`,
    },
  }),

  "opposing-levels": card("opposing-levels", {
    variantOf: "counter-moving-results", family: "proof", tags: ["comparison", "percent", "chart"],
    hint: movingHint,
    h: 352, ids: ["control-center-two-sliders"],
    slots: {
      fallingMetric: spoken(38, 500, 40, 1),
      decrease: hero(12, 500, (text) => decline(text) && changeMagnitude(text) !== null, 1),
      risingMetric: spoken(38, 500, 40, 1),
      increase: hero(12, 500, (text) => increase(text) && changeMagnitude(text) !== null, 1),
    },
    render(o, h) {
      const [fallingMetric] = o.slots.fallingMetric, [decrease] = o.slots.decrease;
      const [risingMetric] = o.slots.risingMetric, [increase] = o.slots.increase;
      const timeline = [
        write(h, "fallingMetric", fallingMetric), rise(h, "decrease", decrease),
        state(h, ".gb-drain", { scaleY: 1 }, { scaleY: h.at(1 - changeMagnitude(decrease.text) / 100) }, decrease.at),
        write(h, "risingMetric", risingMetric), rise(h, "increase", increase),
        state(h, ".gb-fill", { scaleY: 0 }, { scaleY: h.at(changeMagnitude(increase.text) / 100) }, increase.at),
      ];
      return {
        inner: `<div class="gb-sliders" aria-hidden="true"><div class="gb-slider"><div class="gb-drain"></div></div><div class="gb-slider"><div class="gb-fill"></div></div></div><div>${copy(h, "decrease", decrease)}${copy(h, "fallingMetric", fallingMetric)}${copy(h, "increase", increase)}${copy(h, "risingMetric", risingMetric)}</div>`,
        timeline: timeline.join("\n"),
      };
    },
    rules: {
      "": "display:grid;grid-template-columns:128px 1fr;align-items:center;gap:24px;",
      ".gb-sliders": "display:flex;gap:12px;",
      ".gb-slider": `width:56px;height:224px;background:${rule};border-radius:6px;overflow:hidden;`,
      ".gb-drain": `height:100%;transform-origin:bottom;background:${grey};`,
      ".gb-fill": `height:100%;transform-origin:bottom;transform:scaleY(0);background:${gold};`,
      ".gb-decrease": `${numberStyle}color:${grey};line-height:104px;`,
      ".gb-increase": `${numberStyle}line-height:104px;`,
    },
  }),

  "rate-change-ring": card("rate-change-ring", {
    variantOf: "case-study", family: "proof", tags: ["before-after", "percent", "chart"],
    hint: proof["case-study"].hint,
    h: 320, ids: ["wisdom-ring-segment-flip"],
    slots: {
      before: hero(7, 400, (text) => percentPoint(text) !== null, 1),
      after: hero(7, 400, (text) => percentPoint(text) !== null, 1),
      label: spoken(46),
    },
    validate: ({ before, after }) => percentPoint(before[0].text) !== percentPoint(after[0].text),
    render(o, h) {
      const [before] = o.slots.before, [after] = o.slots.after, [metric] = o.slots.label;
      const first = h.at(1 - percentPoint(before.text) / 100);
      const last = h.at(1 - percentPoint(after.text) / 100);
      const ring = svg("ring", "0 0 160 160", '<circle cx="80" cy="80" r="65"/><path pathLength="1" d="M80 15a65 65 0 1 1 0 130a65 65 0 1 1 0-130"/>');
      return {
        inner: `<div class="gb-rate">${ring}<div class="gb-window">${copy(h, "before", before)}${copy(h, "after", after)}</div></div>${copy(h, "metric", metric)}`,
        timeline: [rise(h, "before", before), state(h, ".gb-ring path", { strokeDashoffset: 1 }, { strokeDashoffset: first }, before.at),
          slideOut(h, ".gb-before", after.at), rise(h, "after", after),
          state(h, ".gb-ring path", { strokeDashoffset: first }, { strokeDashoffset: last }, after.at),
          write(h, "metric", metric)].join("\n"),
      };
    },
    rules: {
      ".gb-rate": "display:grid;grid-template-columns:160px 1fr;gap:32px;align-items:center;",
      ".gb-ring": "width:160px;height:160px;",
      ".gb-ring circle": `fill:none;stroke:${rule};stroke-width:10;`,
      ".gb-ring path": `${trace}stroke-width:10;stroke-linecap:butt;`,
      ".gb-window": "display:grid;",
      ".gb-window>div": `grid-area:1/1;${numberStyle}`,
      ".gb-window .gb-before": `color:${grey};`,
    },
  }),

  "progress-status-rail": card("progress-status-rail", {
    variantOf: "loading-bar", family: "proof", tags: ["progress", "list"],
    hint: procedure["loading-bar"].hint,
    h: (o) => (o.slots.heading.length ? 88 : 48) + o.slots.states.length * 112,
    ids: ["order-tracking-progress", "bluetooth-work-disconnect"],
    slots: { heading, states: repeat(spoken(44, 550), 1, 4) },
    render(o, h) {
      const [heading] = o.slots.heading;
      const timeline = [];
      const inner = o.slots.states.map((item, i) => {
        const next = o.slots.states[i + 1];
        timeline.push(write(h, `status-${i}`, item), draw(h, `.gb-node-${i} path`, item.at),
          state(h, `.gb-status-${i}`, { color: grey }, { color: bone }, item.at));
        if (next) timeline.push(state(h, `.gb-status-${i}`, { color: bone }, { color: grey }, next.at));
        return `<div class="gb-status-row">${svg(`node gb-node-${i}`, "0 0 40 44", '<path pathLength="1" d="M20 2v10m0 0a11 11 0 1 1 0 22 11 11 0 1 1 0-22Zm0 22v8"/>')}${copy(h, `status-${i}`, item)}</div>`;
      });
      return { inner: (heading ? label(h.copy(heading)) : "") + inner.join(""), timeline: timeline.join("\n") };
    },
    rules: {
      ".gb-label": `${labelStyle}margin-bottom:4px;`,
      ".gb-status-row": "display:grid;min-height:112px;grid-template-columns:40px 1fr;align-items:center;gap:20px;",
      ".gb-node": "width:40px;height:44px;",
      ".gb-node path": trace,
      ".gb-copy": `color:${grey};`,
    },
  }),

  "first-place-rows": card("first-place-rows", {
    variantOf: "ranking", family: "procedure", tags: ["ranking", "list"], h: 432,
    hint: procedure.ranking.hint,
    ids: ["ranked-list-first-fills"],
    slots: { heading, items: repeat(spoken(40, 540), 3) },
    render(o, h) {
      const [heading] = o.slots.heading;
      const timeline = [];
      const rows = o.slots.items.map((item, i) => {
        timeline.push(write(h, `rank-${i}`, item),
          state(h, `.gb-rank-row-${i}`, { borderColor: rule }, { borderColor: i ? grey : gold }, item.at));
        if (!i) timeline.push(draw(h, ".gb-first path", item.at));
        return `<div class="gb-rank-row gb-rank-row-${i}">${i ? "" : svg("first", "0 0 32 32", tick)}${copy(h, `rank-${i}`, item)}</div>`;
      });
      return { inner: (heading ? label(h.copy(heading)) : "") + rows.join(""), timeline: timeline.join("\n") };
    },
    rules: {
      "": "gap:8px;",
      ".gb-label": labelStyle,
      ".gb-rank-row": `display:grid;grid-template-columns:32px 1fr;gap:12px;align-items:center;min-height:104px;border:2px solid ${rule};border-radius:5px;padding:2px 12px;`,
      ".gb-rank-row .gb-copy": "grid-column:2;",
      ".gb-rank-0": `color:${gold};`,
      ".gb-first": "width:32px;height:32px;",
      ".gb-first path": trace,
    },
  }),

  "formula-chip-stack": card("formula-chip-stack", {
    variantOf: "formula", family: "procedure", tags: ["rule", "flow"], h: 448,
    hint: procedure.formula.hint,
    ids: ["role-combo-chips"],
    slots: { parts: repeat(spoken(29, 528, 40, 1), 2, 3), result: spoken(44, 528, 48) },
    render(o, h) {
      const [result] = o.slots.result;
      const timeline = [];
      const chips = o.slots.parts.map((item, i) => {
        const plus = svg("operator", "0 0 28 28", '<path d="M4 14h20M14 4v20"/>');
        timeline.push(enter(h, `.gb-ingredient-${i}`, { y: 12 }, { y: 0 }, item.at), write(h, `part-${i}`, item));
        return `<div class="gb-ingredient gb-ingredient-${i}">${i ? plus : ""}${copy(h, `part-${i}`, item)}</div>`;
      });
      timeline.push(enter(h, ".gb-equation", { y: 12 }, { y: 0 }, result.at), write(h, "result", result));
      const equals = svg("operator", "0 0 28 28", '<path d="M4 9h20M4 19h20"/>');
      return { inner: chips.join("") + `<div class="gb-equation">${equals}${copy(h, "result", result)}</div>`, timeline: timeline.join("\n") };
    },
    rules: {
      "": "gap:8px;",
      ".gb-ingredient": `display:grid;grid-template-columns:28px 1fr;gap:16px;align-items:center;padding:8px 14px;border:2px solid ${rule};border-radius:8px;opacity:0;`,
      ".gb-ingredient .gb-copy": "grid-column:2;",
      ".gb-equation": `display:grid;grid-template-columns:28px 1fr;gap:16px;align-items:center;color:${gold};padding:8px 14px;border-top:2px solid ${gold};opacity:0;`,
      ".gb-result": "font-size:48px;line-height:58px;",
      ".gb-operator": `display:block;width:28px;height:28px;fill:none;stroke:${gold};stroke-width:3;`,
    },
  }),

  "clock-ring-capsule": card("clock-ring-capsule", {
    variantOf: "stopwatch", family: "proof", tags: ["time", "number"],
    hint: procedure.stopwatch.hint,
    h: (o) => Math.max(176, 48 + 112 * o.slots.time[0].lines.length),
    ids: ["live-activity-workout-timer", "idea-4"],
    slots: {
      time: hero(30, 516, (text) => herkLabels["duration-bracket-label"].slots.time.validate(text) ||
        /^\d{1,2}:[0-5]\d[.!?]?$/.test(text), 3),
    },
    render(o, h) {
      const [time] = o.slots.time;
      const clock = svg("clock", "0 0 100 100", '<circle cx="50" cy="50" r="42"/><path class="gb-trace" pathLength="1" d="M50 8a42 42 0 1 1 0 84a42 42 0 1 1 0-84"/><path class="gb-hand" d="M50 26v24l17 10"/>');
      return {
        inner: clock + copy(h, "time", time),
        timeline: [rise(h, "time", time), draw(h, ".gb-trace", time.at)].join("\n"),
      };
    },
    rules: {
      "": "display:grid;grid-template-columns:104px 1fr;gap:20px;align-items:center;border-radius:36px;",
      ".gb-clock": "width:104px;height:104px;",
      ".gb-clock circle": `fill:none;stroke:${rule};stroke-width:5;`,
      ".gb-hand": `fill:none;stroke:${bone};stroke-width:4;stroke-linecap:round;`,
      ".gb-trace": `${trace}stroke-width:5;`,
      ".gb-time": numberStyle,
    },
  }),

  "streak-medallions": card("streak-medallions", {
    variantOf: "streak", family: "proof", tags: ["progress", "number"], h: 324,
    hint: proof.streak.hint,
    ids: ["win-streak-medals"],
    slots: { count: hero(7, 640, countAtMostSeven, 1), label: spoken(34, 640, 40, 2) },
    render(o, h) {
      const [count] = o.slots.count, [text] = o.slots.label;
      const quantity = normalize(count.text);
      const medals = ["zero", "one", "two", "three", "four", "five", "six", "seven"];
      const total = /^\d/.test(quantity) ? Number(quantity) : medals.indexOf(quantity);
      const marks = Array.from({ length: total }, (_, i) =>
        svg(`medal gb-medal-${i}`, "0 0 60 60", '<path d="M30 4 54 17v26L30 56 6 43V17Z"/>' + tick.replace('d="', 'transform="translate(14 14)" d="')));
      return {
        inner: copy(h, "count", count) + copy(h, "context", text) + `<div class="gb-medals">${marks.join("")}</div>`,
        timeline: [rise(h, "count", count), write(h, "context", text), ...marks.map((_, i) =>
          enter(h, `.gb-medal-${i}`, { y: 12 }, { y: 0 }, count.at))].join("\n"),
      };
    },
    rules: {
      "": "gap:4px;",
      ".gb-count": numberStyle,
      ".gb-medals": "display:flex;min-height:52px;gap:12px;",
      ".gb-medal": `width:52px;height:52px;fill:${gold};opacity:0;`,
      ".gb-medal path+path": `fill:none;stroke:${ink};stroke-width:3;stroke-linecap:round;stroke-linejoin:round;`,
    },
  }),

  "selected-term-popover": card("selected-term-popover", {
    variantOf: "term-definition", family: "emphasis", tags: ["definition", "callout"],
    hint: herkLabels["term-definition"].hint,
    h: 304, ids: ["lookup-popover-definition"],
    slots: { term: spoken(34, 620, 48), detail: spoken(62, 620) },
    render(o, h) {
      const [term] = o.slots.term, [detail] = o.slots.detail;
      return {
        inner: `<div class="gb-selection">${copy(h, "term", term)}</div><div class="gb-definition">${copy(h, "detail", detail)}</div>`,
        timeline: [write(h, "term", term),
          state(h, ".gb-selection", { borderColor: rule }, { borderColor: gold }, detail.at),
          enter(h, ".gb-definition", { y: -10 }, { y: 0 }, detail.at), write(h, "detail", detail)].join("\n"),
      };
    },
    rules: {
      "": "align-items:flex-start;gap:8px;",
      ".gb-selection": `max-width:100%;padding:4px 12px;border:2px solid ${rule};border-radius:6px;`,
      ".gb-term": "font-size:48px;line-height:54px;",
      ".gb-definition": `width:100%;padding:12px 16px;background:${bone};color:${ink};border-radius:6px;opacity:0;`,
    },
  }),

};
