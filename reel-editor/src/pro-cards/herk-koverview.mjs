// Layout and motion ideas adapted from the Herk Edit Kit (MIT). See src/pro-cards/HERK-LICENSE.md.
import { CARDS as proof } from "./proof-2.mjs";

const ink = "#0B0B0D", bone = "#F5F1E8", gold = "#C8A24B", grey = "#A8A49C", rule = "#343438";

// Match the registry's conservative Inter estimate without importing the planner back into the registry.
function fits(text, width, maxLines, size) {
  const measure = (line) => [...line].reduce((sum, c) => sum +
    (/\s/.test(c) ? 0.3 : /[ilI.,!'’]/.test(c) ? 0.32 : /[MW@]/.test(c) ? 0.95 : /[A-Z]/.test(c) ? 0.75 : 0.65) * size, 0);
  let lines = 1, line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (measure(word) > width) return false;
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) line = next;
    else {
      lines++;
      line = word;
    }
  }
  return lines <= maxLines;
}

const spoken = (maxChars, width, maxLines = 1, size = 40, check) => ({
  kind: "spoken", maxChars, width, size, maxLines,
  // The registry can fall back to smaller fonts. These layouts are measured at the displayed size.
  validate: (text, slots) => fits(text, width, maxLines, size) && (!check || check(text, slots)),
});
const repeated = (slot, min, max = min) => ({ ...slot, repeat: [min, max] });
const optional = (slot) => ({ ...slot, optional: true });
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const numbered = (n, fields) => Object.fromEntries(range(n).flatMap((i) =>
  Object.entries(fields).map(([name, slot]) => [`${name}${i}`, slot])));

function card(type, { height, sources, rules, ...def }) {
  const scope = `.pro-${type}`;
  const base = {
    "": `display:flex;flex-direction:column;justify-content:center;padding:24px 32px;background:${ink};color:${bone};font:700 40px/48px "Inter",sans-serif;`,
    ".ko-copy": "min-width:0;opacity:0;clip-path:inset(0% 100% 0% 0%);",
    ".ko-enter": "opacity:0;",
    ".ko-draw": `fill:none;stroke:${gold};stroke-width:3;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;`,
    ".ko-label": `color:${gold};font:700 30px/36px "Inter",sans-serif;margin-bottom:12px;`,
  };
  const css = Object.entries({ ...base, ...rules }).map(([selector, style]) =>
    `  ${scope}${selector ? " " + selector : ""} { ${style} }`).join("\n");
  return { ...def, size: typeof height === "function" ? (o) => ({ w: 720, h: height(o) }) : { w: 720, h: height },
    surface: "obsidian", source: sources.split(" ").map((id) => `herk:kallaway.t1.overview.${id}`).join(","), css };
}

// Each copy target has one absolute transcript anchor. Structure can build around it at the same anchor.
function scene(o, h) {
  const motions = [];
  const tween = (selector, from, to, at, kind, ease) => {
    motions.push(`tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion[kind]},ease:${ease},immediateRender:false},${at});`);
  };
  const state = (selector, from, to, at) => tween(selector, from, to, at, "state", "proState");
  const enter = (selector, at, offset = {}) =>
    tween(selector, { opacity: 0, ...offset }, { opacity: 1, x: 0, y: 0 }, at, "enter", "proEnter");
  const word = (item, key, extra = "", roll = false) => {
    const start = roll ? { opacity: 0, y: 16, clipPath: "inset(100% 0% 0% 0%)" } : { opacity: 0, clipPath: "inset(0% 100% 0% 0%)" };
    const end = { opacity: 1, clipPath: "inset(0% 0% 0% 0%)", ...(roll ? { y: 0 } : {}) };
    tween(`.ko-said-${key}`, start, end, item.at, "enter", "proEnter");
    return `<div class="ko-copy ko-said-${key}${extra ? " " + extra : ""}">${h.copy(item)}</div>`;
  };
  const item = (slot) => o.slots[slot][0];
  return {
    word, item, state, enter,
    say: (slot, extra, roll) => item(slot) ? word(item(slot), slot, extra, roll) : "",
    draw: (selector, at) => state(selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at),
    done: (inner) => ({ inner, timeline: motions.join("\n") }),
  };
}

const paths = (width, height, lines, className = "ko-lines") =>
  `<svg class="${className}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${lines.map((d, i) =>
    `<path class="ko-draw ko-link-${i}" pathLength="1" d="${d}"/>`).join("")}</svg>`;
const paired = (s, i, first = "title", second = "detail") =>
  s.say(`${first}${i}`, "ko-head") + s.say(`${second}${i}`, "ko-detail");

const tile = `border:2px solid ${rule};border-radius:12px;min-width:0;`;
const detail = `color:${grey};font-weight:600;`;
const head = `color:${gold};font-weight:800;`;
const twoColumns = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;";
const value = `color:${gold};font:400 96px/104px "Anton",sans-serif;`;
const numeric = proof["kpi-tile"].slots.value.validate;
const percent = proof.gauge.slots.value.validate;
const money = proof["money-stack"].slots.value.validate;

// Measure percent bars against the stated quantity, never against the order the rows enter.
const units = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const tens = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const percentWords = new Map([
  ...units.map((word, i) => [word, i]),
  ...tens.flatMap((word, i) => units.slice(0, 10).map((unit, j) => [j ? `${word} ${unit}` : word, (i + 2) * 10 + j])),
  ["one hundred", 100],
]);
function percentValue(text) {
  if (!percent(text)) return null;
  const amount = text.trim().toLowerCase().replace(/\s*(?:%|percent|per cent)[.!?]?$/, "").replace(/,/g, "").replace(/[-\s]+/g, " ");
  return percentWords.get(amount) ?? Number(amount);
}

function relativeWeek(text) {
  const parts = /^week\s+(\d{1,2}|[a-z]+(?:[ -][a-z]+)?)[.!?]?$/i.exec(text);
  if (!parts) return null;
  const amount = parts[1].toLowerCase().replace("-", " ");
  const week = percentWords.get(amount) ?? Number(amount);
  return Number.isInteger(week) && week >= 1 && week <= 52 ? week : null;
}

function spokenTime(text) {
  const clock = /^(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:a\.?m\.?|p\.?m\.?))?[.!?]?$/i.test(text);
  const duration = text.match(/^(.+?)\s+(?:seconds?|minutes?|hours?)[.!?]?$/i);
  return clock || relativeWeek(text) !== null ||
    (!!duration && !/[$%]|\b(?:dollars?|percent|per cent)\b/i.test(duration[1]) && numeric(duration[1]));
}

function panelGroup(s, n, content, offset = { y: 12 }) {
  return range(n).map((i) => {
    const { html, at } = content(i);
    s.enter(`.ko-panel-${i}`, at, offset);
    return `<div class="ko-panel ko-panel-${i} ko-enter">${html}</div>`;
  }).join("");
}

const agendaHint = "Greg walks through three timed segments or milestones, saying each clock time, duration or relative week immediately before the event";
const layersHint = "Greg names three or four dependent layers of one system, saying the foundation first and building upward";

export const CARDS = {
  "session-agenda": card("session-agenda", {
    family: "procedure", tags: ["timeline", "time", "list"], sources: "agenda",
    height: (o) => 72 + range(3).reduce((sum, i) =>
      sum + 14 + 48 * Math.max(o.slots[`time${i}`][0].lines.length, o.slots[`topic${i}`][0].lines.length), 0),
    hint: agendaHint,
    slots: numbered(3, {
      time: spoken(22, 192, 2, 40, spokenTime),
      topic: spoken(46, 364, 2),
    }),
    render(o, h) {
      const s = scene(o, h);
      s.state(".ko-spine", { scaleY: 0 }, { scaleY: 1 }, s.item("time1").at);
      const rows = range(3).map((i) => {
        const at = s.item(`time${i}`).at;
        s.enter(`.ko-dot-${i}`, at);
        s.enter(`.ko-row-${i} .ko-agenda-body`, at, { x: 12 });
        return `<div class="ko-row ko-row-${i}"><span class="ko-dot ko-dot-${i} ko-enter"></span>
          <div class="ko-agenda-body ko-enter">${s.say(`time${i}`, "ko-time")}${s.say(`topic${i}`)}</div></div>`;
      }).join("");
      return s.done(`<div class="ko-agenda"><span class="ko-spine"></span>${rows}</div>`);
    },
    rules: {
      ".ko-agenda": "position:relative;",
      ".ko-row": "position:relative;padding-left:30px;",
      ".ko-row + .ko-row": "margin-top:12px;",
      ".ko-spine": `position:absolute;left:7px;top:0;bottom:0;width:2px;background:${rule};transform:scaleY(0);transform-origin:top;`,
      ".ko-dot": `position:absolute;left:2px;top:calc(50% - 6px);width:12px;height:12px;border-radius:50%;background:${gold};`,
      ".ko-agenda-body": `${tile}display:grid;grid-template-columns:194px 1fr;gap:20px;align-items:center;padding:5px 16px;`,
      ".ko-time": `color:${gold};border-right:2px solid ${rule};`,
    },
  }),

  "feature-bento": card("feature-bento", {
    family: "payoff", tags: ["callout", "list"], height: 392, sources: "bento",
    hint: "Greg names one main advantage and explains it, then names three shorter features that support that same advantage",
    slots: { feature: spoken(26, 240, 2), detail: spoken(42, 240, 4), supports: repeated(spoken(22, 306, 2), 3) },
    render(o, h) {
      const s = scene(o, h);
      const lead = s.say("feature", "ko-head") + s.say("detail", "ko-detail");
      s.enter(".ko-feature", s.item("feature").at, { y: 8 });
      const support = o.slots.supports.map((item, i) => {
        s.enter(`.ko-bento-${i}`, item.at, { y: 12 });
        return `<div class="ko-support ko-bento-${i} ko-enter">${s.word(item, `support-${i}`)}</div>`;
      }).join("");
      return s.done(`<div class="ko-bento"><div class="ko-feature ko-enter">${lead}</div><div class="ko-supports">${support}</div></div>`);
    },
    rules: {
      ".ko-bento": "display:grid;grid-template-columns:278px minmax(0,1fr);gap:12px;",
      ".ko-feature": `${tile}border-top:4px solid ${gold};padding:16px;display:flex;flex-direction:column;justify-content:center;gap:8px;`,
      ".ko-head": head, ".ko-detail": detail,
      ".ko-supports": "display:grid;gap:8px;",
      ".ko-support": `${tile}min-height:108px;display:flex;align-items:center;padding:4px 16px;`,
    },
  }),

  "headline-rail": card("headline-rail", {
    family: "procedure", tags: ["title", "list"], height: 408, sources: "bigleft",
    hint: "Greg explicitly introduces a short framework name, then says three compact action and explanation pairs in order",
    slots: { title: spoken(22, 240, 3, 48), ...numbered(3, { action: spoken(17, 364), detail: spoken(17, 364) }) },
    render(o, h) {
      const s = scene(o, h);
      const title = s.say("title");
      const rows = panelGroup(s, 3, (i) => ({ html: paired(s, i, "action"), at: s.item(`action${i}`).at }), { x: 12 });
      s.state(".ko-rule", { scaleX: 0 }, { scaleX: 1 }, s.item("title").at);
      return s.done(`<div class="ko-headline"><div>${title}<span class="ko-rule"></span></div><div class="ko-panels">${rows}</div></div>`);
    },
    rules: {
      ".ko-headline": "display:grid;grid-template-columns:240px 1fr;gap:16px;align-items:center;",
      ".ko-said-title": `font:700 48px/56px "Inter",sans-serif;color:${gold};`,
      ".ko-rule": `display:block;width:80px;height:3px;margin-top:16px;background:${gold};transform:scaleX(0);transform-origin:left;`,
      ".ko-panels": `display:grid;gap:10px;border-left:2px solid ${rule};padding-left:16px;`,
      ".ko-panel": `${tile}padding:5px 6px;`, ".ko-detail": detail,
    },
  }),

  "scenario-pair": card("scenario-pair", {
    family: "distinction", tags: ["comparison", "quote"], height: 368, sources: "deck2",
    hint: "Greg gives two alternative sales scenarios in order and actually says an example line for each one",
    slots: numbered(2, { title: spoken(26, 286, 2, 44), example: spoken(48, 286, 3) }),
    render(o, h) {
      const s = scene(o, h);
      const panels = panelGroup(s, 2, (i) => ({
        html: s.say(`title${i}`, "ko-head") + s.say(`example${i}`, "ko-example"),
        at: s.item(`title${i}`).at,
      }), { x: 12 });
      return s.done(`<div class="ko-scenarios">${panels}</div>`);
    },
    rules: {
      ".ko-scenarios": twoColumns,
      ".ko-panel": `${tile}padding:16px;display:flex;flex-direction:column;justify-content:space-between;gap:14px;min-height:288px;`,
      ".ko-head": `${head}font-size:44px;line-height:52px;`,
      ".ko-example": `${detail}border-top:2px solid ${rule};padding-top:12px;`,
    },
  }),

  "principle-trio": card("principle-trio", {
    family: "payoff", tags: ["list", "definition"], height: 360, sources: "deck3 split3 tricards",
    hint: "Greg names three parallel principles or approaches and immediately gives a short explanation of each",
    slots: numbered(3, { title: spoken(18, 200, 2), detail: spoken(28, 200, 3) }),
    render(o, h) {
      const s = scene(o, h);
      return s.done(`<div class="ko-deck">${panelGroup(s, 3, (i) => ({ html: paired(s, i), at: s.item(`title${i}`).at }))}</div>`);
    },
    rules: {
      ".ko-deck": "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;",
      ".ko-panel": `${tile}padding:16px 4px;min-height:290px;display:flex;flex-direction:column;gap:12px;border-top:3px solid ${gold};`,
      ".ko-head": head, ".ko-detail": detail,
    },
  }),

  "practice-pair": card("practice-pair", {
    family: "distinction", tags: ["comparison", "list"], height: 528, sources: "duallist",
    hint: "Greg lists two to four concrete habits to do, then two to four distinct mistakes to avoid on the same task",
    slots: { do: repeated(spoken(25, 258, 2), 2, 4), avoid: repeated(spoken(25, 258, 2), 2, 4) },
    render(o, h) {
      const s = scene(o, h);
      const column = (name, label, glyph) => `<div class="ko-practices"><div class="ko-label">${label}</div>${o.slots[name].map((item, i) => {
        const key = `${name}-${i}`;
        s.draw(`.ko-sign-${key} path`, item.at);
        return `<div class="ko-practice">${paths(24, 24, [glyph], `ko-sign ko-sign-${key}`)}${s.word(item, key)}</div>`;
      }).join("")}</div>`;
      return s.done(`<div class="ko-columns">${column("do", "Do this", "M3 12l6 6L21 5")}${column("avoid", "Avoid this", "M5 5l14 14M19 5 5 19")}</div>`);
    },
    rules: {
      ".ko-columns": twoColumns,
      ".ko-practices": `${tile}padding:12px 8px;display:flex;flex-direction:column;gap:6px;`,
      ".ko-practices .ko-label": "margin:0 0 2px 8px;",
      ".ko-practice": "display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;",
      ".ko-sign": "width:24px;height:24px;margin-top:12px;",
    },
  }),

  "concept-tiles": card("concept-tiles", {
    family: "payoff", tags: ["definition", "list"], height: 504, sources: "featuregrid flashcards",
    hint: "Greg names four distinct pillars of one method and immediately gives one short explanation for each",
    slots: numbered(4, { title: spoken(26, 274, 2), detail: spoken(26, 286, 2) }),
    render(o, h) {
      const s = scene(o, h);
      return s.done(`<div class="ko-grid">${panelGroup(s, 4, (i) => ({ html: paired(s, i), at: s.item(`title${i}`).at }))}</div>`);
    },
    rules: {
      ".ko-grid": twoColumns,
      ".ko-panel": `${tile}padding:10px 16px;display:flex;flex-direction:column;gap:4px;`,
      ".ko-head": `${head}border-left:3px solid ${gold};padding-left:8px;`, ".ko-detail": detail,
    },
  }),

  "topic-tiles": card("topic-tiles", {
    family: "procedure", tags: ["list"], sources: "grid9 cardrow5 grid6 quad",
    height(o) {
      const items = o.slots.topics;
      return 40 + range(Math.ceil(items.length / 2)).reduce((sum, row) => {
        const [left, right] = items.slice(2 * row - 2, 2 * row);
        return sum + 8 + (left.lines.length === 2 || right?.lines.length === 2 ? 96 : 64);
      }, 0);
    },
    hint: "Greg rapidly names four to nine compact components of one framework, with no explanation or ranking between them",
    slots: { topics: repeated(spoken(23, 274, 2), 4, 9) },
    render(o, h) {
      const s = scene(o, h);
      const tiles = o.slots.topics.map((item, i) => {
        s.enter(`.ko-topic-${i}`, item.at, { y: 8 });
        return `<div class="ko-topic ko-topic-${i} ko-enter">${s.word(item, `topic-copy-${i}`)}</div>`;
      }).join("");
      return s.done(`<div class="ko-grid">${tiles}</div>`);
    },
    rules: {
      ".ko-grid": twoColumns + "gap:8px;",
      ".ko-topic": `${tile}min-height:64px;display:flex;align-items:center;padding:0 20px;border-left:4px solid ${gold};`,
      ".ko-topic .ko-copy": "line-height:46px;",
    },
  }),

  "handoff-rail": card("handoff-rail", {
    family: "procedure", tags: ["steps", "flow"], height: 304, sources: "flow pipeline",
    hint: "Greg names three or four very short process stages that hand work from one stage to the next",
    slots: { stages: repeated(spoken(22, 274, 2), 3, 4) },
    render(o, h) {
      const s = scene(o, h);
      const items = o.slots.stages;
      const arrows = paths(656, 256, ["M308 54H348m-9-9 9 9-9 9", "M504 108V147m-9-9 9 9 9-9", "M348 202H308m9-9-9 9 9 9"].slice(0, items.length - 1));
      const stages = panelGroup(s, items.length, (i) => {
        const item = items[i - 1];
        if (i > 1) s.draw(`.ko-link-${i - 2}`, item.at);
        return { html: s.word(item, `stage-${i}`), at: item.at };
      }, {});
      return s.done(`<div class="ko-handoffs">${arrows}${stages}</div>`);
    },
    rules: {
      ".ko-handoffs": "position:relative;display:grid;grid-template-columns:304px 304px;grid-template-rows:108px 108px;gap:40px 48px;",
      ".ko-lines": "position:absolute;inset:0;width:100%;height:100%;",
      ".ko-panel": `${tile}display:grid;place-items:center;text-align:center;padding:4px 12px;border-top-color:${gold};`,
      ".ko-panel-3": "grid-area:2/2;", ".ko-panel-4": "grid-area:2/1;",
    },
  }),

  "timeline-spine": card("timeline-spine", {
    variantOf: "session-agenda", family: "procedure", tags: ["timeline", "steps"], height: 416, sources: "timeline roadmap milestones",
    hint: agendaHint,
    slots: numbered(3, { time: spoken(22, 560, 1, 40, spokenTime), topic: spoken(46, 560) }),
    render(o, h) {
      const s = scene(o, h);
      const stops = range(3).map((i) => {
        const at = s.item(`time${i}`).at;
        const link = i > 1 ? paths(26, 118, ["M13 11V107"]) : "";
        if (i > 1) s.draw(`.ko-stop-${i} .ko-link-0`, at);
        s.enter(`.ko-stop-${i} .ko-pin`, at);
        return `<div class="ko-stop ko-stop-${i}">${link}<span class="ko-pin ko-enter"></span>
          <div class="ko-event">${s.say(`time${i}`, "ko-head")}${s.say(`topic${i}`)}</div></div>`;
      }).join("");
      return s.done(stops);
    },
    rules: {
      ".ko-stop": "position:relative;display:grid;grid-template-columns:36px 1fr;gap:14px;align-items:center;height:104px;",
      ".ko-stop + .ko-stop": "margin-top:14px;",
      ".ko-stop .ko-lines": "position:absolute;top:-66px;left:5px;width:26px;height:118px;",
      ".ko-pin": `width:22px;height:22px;margin:auto;border-radius:50%;background:${gold};`,
      ".ko-event": `padding:2px 12px;border-bottom:2px solid ${rule};`, ".ko-head": head,
    },
  }),

  "takeaway-rows": card("takeaway-rows", {
    family: "payoff", tags: ["list", "callout"], height: 392, sources: "summary iconlist numlist",
    hint: "Greg recaps three separate teaching takeaways, stating each point and then a short concrete explanation",
    slots: numbered(3, { title: spoken(22, 530), detail: spoken(24, 530) }),
    render(o, h) {
      const s = scene(o, h);
      const rows = panelGroup(s, 3, (i) => {
        const at = s.item(`title${i}`).at;
        s.draw(`.ko-panel-${i} .ko-link-0`, at);
        return { html: paths(36, 36, ["M5 18H31M22 9l9 9-9 9"]) + `<div>${paired(s, i)}</div>`, at };
      }, { x: 12 });
      return s.done(`<div class="ko-rows">${rows}</div>`);
    },
    rules: {
      ".ko-rows": "display:grid;gap:8px;",
      ".ko-panel": `${tile}display:grid;grid-template-columns:36px 1fr;gap:16px;padding:4px 12px;align-items:center;`,
      ".ko-lines": "width:36px;height:36px;", ".ko-head": head, ".ko-detail": detail,
    },
  }),

  "phase-stack": card("phase-stack", {
    family: "procedure", tags: ["steps", "flow"], height: 428, sources: "phases steps",
    hint: "Greg walks through three successive phases of one process, naming each phase and saying what happens in it",
    slots: numbered(3, { title: spoken(22, 540), detail: spoken(24, 540) }),
    render(o, h) {
      const s = scene(o, h);
      const cards = panelGroup(s, 3, (i) => {
        const at = s.item(`title${i}`).at;
        if (i > 1) s.draw(`.ko-panel-${i} .ko-link-0`, at);
        return { html: (i > 1 ? paths(30, 24, ["M15 1v21m-6-6 6 6 6-6"]) : "") + paired(s, i), at };
      });
      return s.done(`<div class="ko-phases">${cards}</div>`);
    },
    rules: {
      ".ko-phases": "display:grid;gap:20px;",
      ".ko-panel": `${tile}position:relative;padding:5px 16px;margin-inline:36px;`,
      ".ko-lines": "position:absolute;left:calc(50% - 15px);top:-24px;width:30px;height:24px;",
      ".ko-head": head, ".ko-detail": detail,
    },
  }),

  "percentage-legend": card("percentage-legend", {
    family: "proof", tags: ["chart", "percent", "list"], sources: "legend",
    height: (o) => 78 + range(4).reduce((sum, i) => sum + 48 * o.slots[`percent${i}`][0].lines.length, 0),
    hint: "Greg gives four category names and explicit percentages on the same scale, saying each percentage immediately after its category",
    slots: numbered(4, { category: spoken(13, 246), percent: spoken(24, 280, 2, 40, percent) }),
    render(o, h) {
      const s = scene(o, h);
      const rows = range(4).map((i) => {
        const item = s.item(`percent${i}`);
        s.state(`.ko-fill-${i}`, { scaleX: 0 }, { scaleX: percentValue(item.text) / 100 }, item.at);
        return `<div class="ko-legend-row">${s.say(`category${i}`)}<div class="ko-track"><span class="ko-fill ko-fill-${i}"></span></div>${s.say(`percent${i}`, "ko-percent")}</div>`;
      }).join("");
      return s.done(`<div class="ko-legend">${rows}</div>`);
    },
    rules: {
      ".ko-legend": "display:grid;gap:10px;",
      ".ko-legend-row": "display:grid;grid-template-columns:246px minmax(0,1fr) 280px;gap:12px;align-items:center;",
      ".ko-track": `height:8px;background:${rule};border-radius:8px;`,
      ".ko-fill": `display:block;height:100%;background:${gold};transform:scaleX(0);transform-origin:left;`,
      ".ko-percent": `text-align:right;color:${gold};`,
    },
  }),

  "conversion-tiers": card("conversion-tiers", {
    family: "proof", tags: ["percent", "chart", "flow"], height: 552, sources: "funnel",
    hint: "Greg names four successive sales funnel stages and says the explicit share reaching each stage, using strictly decreasing percentages",
    slots: Object.fromEntries(range(4).flatMap((i) => [
      [`stage${i}`, spoken(22, 176, 2)],
      [`percent${i}`, spoken(6, 254, 1, 96, (text, slots) => {
        const amount = percentValue(text);
        return amount !== null && (i === 1 || amount < percentValue(slots[`percent${i - 1}`][0].text));
      })],
    ])),
    render(o, h) {
      const s = scene(o, h);
      const rows = panelGroup(s, 4, (i) => {
        const at = s.item(`stage${i}`).at;
        return { html: s.say(`stage${i}`) + s.say(`percent${i}`, "ko-value"), at };
      }, { x: 12 });
      return s.done(`<div class="ko-funnel">${rows}</div>`);
    },
    rules: {
      ".ko-funnel": "display:grid;gap:8px;",
      ".ko-panel": `${tile}width:100%;max-width:100%;margin-inline:auto;display:grid;grid-template-columns:minmax(0,1fr) 254px;gap:10px;align-items:center;padding:2px 14px;`,
      ".ko-panel-2": "width:600px;",
      ".ko-panel-3": "width:552px;",
      ".ko-panel-4": `width:504px;border-color:${gold};`,
      ".ko-value": value + "text-align:right;",
    },
  }),

  "project-spans": card("project-spans", {
    family: "proof", tags: ["timeline", "chart", "time"], height: 506, sources: "gantt",
    hint: "Greg describes four tasks on the same project schedule, saying each short task name followed by its relative start week and later end week",
    slots: Object.fromEntries(range(4).flatMap((i) => [
      [`task${i}`, spoken(26, 620)],
      [`start${i}`, spoken(18, 304, 1, 40, (text) => relativeWeek(text) !== null)],
      [`end${i}`, spoken(18, 304, 1, 40, (text, slots) => {
        const week = relativeWeek(text);
        return week !== null && week > relativeWeek(slots[`start${i}`][0].text);
      })],
    ])),
    render(o, h) {
      const s = scene(o, h);
      const spans = range(4).map((i) => ({
        start: relativeWeek(s.item(`start${i}`).text), end: relativeWeek(s.item(`end${i}`).text),
      }));
      const first = Math.min(...spans.map(({ start }) => start));
      const last = Math.max(...spans.map(({ end }) => end));
      const x = (week) => Math.round(6 + 644 * (week - first) / (last - first));
      const rows = spans.map(({ start, end }, j) => {
        const i = j + 1;
        s.draw(`.ko-span-${i} path`, s.item(`end${i}`).at);
        return `<div class="ko-span-row">${s.say(`task${i}`, "ko-head")}
          <div class="ko-dates">${s.say(`start${i}`)}${s.say(`end${i}`, "ko-end")}</div>
          ${paths(656, 10, [`M${x(start)} 5H${x(end)}`], `ko-span ko-span-${i}`)}</div>`;
      }).join("");
      return s.done(`<div class="ko-schedule">${rows}</div>`);
    },
    rules: {
      ".ko-schedule": "display:grid;gap:8px;",
      ".ko-dates": twoColumns + detail,
      ".ko-end": "text-align:right;",
      ".ko-head": head,
      ".ko-span": `display:block;width:656px;height:10px;background:${rule};border-radius:5px;`,
      ".ko-span .ko-draw": "stroke-width:6;",
    },
  }),

  "metric-tiles": card("metric-tiles", {
    family: "proof", tags: ["number", "chart"], height: 432, sources: "statgrid kpirow",
    hint: "Greg states three or four single business metrics together, saying each amount and then its short context; leave both fourth fields blank if he gives only three",
    slots: {
      ...numbered(3, { value: spoken(10, 288, 1, 96, numeric), context: spoken(20, 288, 1) }),
      value4: optional(spoken(10, 288, 1, 96, numeric)),
      context4: optional(spoken(20, 288, 1, 40, (_text, slots) => slots.value4.length > 0)),
    },
    render(o, h) {
      const s = scene(o, h);
      const tiles = panelGroup(s, s.item("value4") ? 4 : 3, (i) => ({
        html: s.say(`value${i}`, "ko-value", true) + s.say(`context${i}`, "ko-detail"),
        at: s.item(`value${i}`).at,
      }), { y: 8 });
      return s.done(`<div class="ko-grid">${tiles}</div>`);
    },
    rules: {
      ".ko-grid": twoColumns,
      ".ko-panel": `${tile}padding:12px 14px;min-height:178px;overflow:hidden;border-top:3px solid ${gold};`,
      ".ko-value": value, ".ko-detail": detail,
    },
  }),

  "metric-spokes": card("metric-spokes", {
    family: "proof", tags: ["number", "callout"], height: 548, sources: "callouts",
    hint: "Greg makes one compact claim and immediately backs it with three explicitly spoken amounts, each followed by what that amount measures",
    slots: { claim: spoken(28, 570), ...numbered(3, { value: spoken(9, 288, 1, 96, numeric), context: spoken(20, 288, 1) }) },
    render(o, h) {
      const s = scene(o, h);
      const spokes = paths(656, 494, ["M328 247 160 169", "M328 247 496 169", "M328 247V324"]);
      const cards = panelGroup(s, 3, (i) => {
        const at = s.item(`value${i}`).at;
        s.draw(`.ko-lines .ko-link-${i - 1}`, at);
        return { html: s.say(`value${i}`, "ko-value", true) + s.say(`context${i}`, "ko-detail"), at };
      }, {});
      const claim = s.say("claim");
      s.enter(".ko-hub", s.item("claim").at);
      return s.done(`<div class="ko-spokes">${spokes}<div class="ko-hub ko-enter">${claim}</div>${cards}</div>`);
    },
    rules: {
      ".ko-spokes": "height:494px;position:relative;",
      ".ko-lines": "position:absolute;width:100%;height:100%;",
      ".ko-hub": `${tile}position:absolute;inset:211px 20px auto;padding:10px;text-align:center;background:${ink};border-color:${gold};`,
      ".ko-panel": `${tile}position:absolute;width:316px;padding:6px 10px;background:${ink};`,
      ".ko-panel-1": "top:0;left:0;", ".ko-panel-2": "top:0;right:0;", ".ko-panel-3": "left:170px;top:324px;",
      ".ko-value": value + "text-align:center;", ".ko-detail": detail + "text-align:center;",
    },
  }),

  "offer-prices": card("offer-prices", {
    family: "proof", tags: ["comparison", "money"], height: 402, sources: "pricing",
    hint: "Greg names three offers or service tiers and immediately quotes an explicit dollar price for each in the same comparison",
    slots: numbered(3, { offer: spoken(26, 306, 2), price: spoken(10, 306, 1, 96, money) }),
    render(o, h) {
      const s = scene(o, h);
      const rows = panelGroup(s, 3, (i) => ({
        html: s.say(`offer${i}`) + s.say(`price${i}`, "ko-value", true), at: s.item(`offer${i}`).at,
      }), { x: 12 });
      return s.done(`<div class="ko-prices">${rows}</div>`);
    },
    rules: {
      ".ko-prices": "display:grid;gap:8px;",
      ".ko-panel": `${tile}padding:0 12px;display:grid;grid-template-columns:1fr 306px;gap:10px;align-items:center;border-left:4px solid ${gold};overflow:hidden;`,
      ".ko-value": value + "text-align:right;",
    },
  }),

  "offer-tiers": card("offer-tiers", {
    family: "distinction", tags: ["comparison", "list"], height: 548, sources: "tiercompare",
    hint: "Greg compares three service tiers, saying each tier name followed by three short inclusions before moving to the next tier",
    slots: numbered(3, { tier: spoken(22, 234, 2), first: spoken(22, 340), second: spoken(22, 340), third: spoken(22, 340) }),
    render(o, h) {
      const s = scene(o, h);
      const tiers = panelGroup(s, 3, (i) => ({
        html: s.say(`tier${i}`, "ko-head") + `<div class="ko-inclusions">${["first", "second", "third"].map((slot) => s.say(`${slot}${i}`)).join("")}</div>`,
        at: s.item(`tier${i}`).at,
      }));
      return s.done(`<div class="ko-tiers">${tiers}</div>`);
    },
    rules: {
      ".ko-tiers": "display:grid;gap:10px;",
      ".ko-panel": `${tile}padding:5px 12px;display:grid;grid-template-columns:240px 1fr;gap:14px;align-items:center;`,
      ".ko-head": head,
      ".ko-inclusions": `border-left:3px solid ${gold};padding-left:12px;`,
    },
  }),

  "tradeoff-table": card("tradeoff-table", {
    family: "distinction", tags: ["comparison", "list"], height: 536, sources: "vstable featurecompare",
    hint: "Greg names two options and then compares them on three stated criteria, saying the left and right answer in that order for each criterion",
    slots: { left: spoken(24, 310, 1), right: spoken(24, 310, 1),
      ...numbered(3, { criterion: spoken(30, 630, 1), leftAnswer: spoken(22, 288, 1), rightAnswer: spoken(22, 288, 1) }) },
    render(o, h) {
      const s = scene(o, h);
      const columns = s.say("left") + s.say("right");
      const rows = panelGroup(s, 3, (i) => {
        const at = s.item(`criterion${i}`).at;
        const answers = ["leftAnswer", "rightAnswer"].map((side) => {
          const slot = `${side}${i}`;
          const item = s.item(slot);
          const answer = s.say(slot);
          const status = /^(yes|no)[.!?]?$/i.exec(item.text)?.[1].toLowerCase();
          if (!status) return answer;
          const icon = `ko-status-${slot}`;
          const glyph = status === "yes" ? "M3 12l6 6L21 5" : "M5 5l14 14M19 5 5 19";
          s.draw(`.${icon} path`, item.at);
          return `<div class="ko-status">${paths(24, 24, [glyph], icon)}${answer}</div>`;
        }).join("");
        return { html: s.say(`criterion${i}`, "ko-criterion") + `<div class="ko-answers">${answers}</div>`, at };
      }, { y: 8 });
      return s.done(`<div class="ko-table"><div class="ko-columns">${columns}</div>${rows}</div>`);
    },
    rules: {
      ".ko-table": "display:grid;gap:8px;",
      ".ko-panel": `${tile}padding:6px 10px;`,
      ".ko-columns": twoColumns + head + "padding:0 8px;",
      ".ko-answers": twoColumns,
      ".ko-criterion": `${detail}border-bottom:2px solid ${rule};margin-bottom:4px;`,
      ".ko-status": "display:flex;align-items:center;gap:8px;",
      ".ko-status svg": "width:24px;height:24px;flex:none;",
    },
  }),

  "priority-ladder": card("priority-ladder", {
    family: "procedure", tags: ["ranking", "list"], height: 556, sources: "ranked",
    hint: "Greg explicitly ranks five priorities strongest first and immediately gives a short reason for each priority",
    slots: numbered(5, { priority: spoken(31, 594), reason: spoken(31, 594) }),
    render(o, h) {
      const s = scene(o, h);
      const rows = panelGroup(s, 5, (i) => ({
        html: paths(32, 28, ["M3 14H29"], `ko-rank-mark ko-rank-mark-${i}`) + `<div>${paired(s, i, "priority", "reason")}</div>`,
        at: s.item(`priority${i}`).at,
      }), { x: 10 });
      for (const i of range(5)) s.draw(`.ko-rank-mark-${i} path`, s.item(`priority${i}`).at);
      return s.done(`<div class="ko-priorities">${rows}</div>`);
    },
    rules: {
      "": `display:flex;flex-direction:column;justify-content:center;padding:16px 32px;background:${ink};color:${bone};font:700 40px/48px "Inter",sans-serif;`,
      ".ko-priorities": "display:grid;gap:6px;",
      ".ko-panel": `display:grid;grid-template-columns:32px 1fr;gap:14px;align-items:center;border-bottom:2px solid ${rule};`,
      ".ko-panel-1 .ko-head": head, ".ko-detail": detail,
      ".ko-rank-mark": "width:32px;height:28px;",
    },
  }),

  "teaching-outline": card("teaching-outline", {
    family: "procedure", tags: ["list", "steps"], height: 488, sources: "outline",
    hint: "Greg gives a three-part teaching outline, naming each section before its short subpoints, with two subpoints for each of the first two sections and one for the last",
    slots: {
      section1: spoken(28, 620), points1: repeated(spoken(30, 566), 2),
      section2: spoken(28, 620), points2: repeated(spoken(30, 566), 2),
      section3: spoken(28, 620), points3: repeated(spoken(30, 566), 1),
    },
    render(o, h) {
      const s = scene(o, h);
      const groups = range(3).map((i) => {
        const title = s.say(`section${i}`, "ko-head");
        const points = o.slots[`points${i}`].map((item, j) => {
          const key = `sub-${i}-${j}`;
          s.draw(`.ko-line-${key} path`, item.at);
          return `<div class="ko-sub">${paths(24, 28, ["M3 1v12h18"], `ko-elbow ko-line-${key}`)}${s.word(item, key)}</div>`;
        }).join("");
        return `<div class="ko-section">${title}${points}</div>`;
      }).join("");
      return s.done(`<div class="ko-outline">${groups}</div>`);
    },
    rules: {
      ".ko-outline": "display:grid;gap:12px;",
      ".ko-head": `${head}padding-inline:12px;border-bottom:2px solid ${rule};`,
      ".ko-sub": "padding-left:28px;display:grid;grid-template-columns:24px 1fr;gap:12px;align-items:center;",
      ".ko-elbow": "width:24px;height:28px;",
    },
  }),

  "chapter-index": card("chapter-index", {
    family: "procedure", tags: ["list", "title"], sources: "toc",
    height: (o) => 48 + o.slots.topics.length * 54,
    hint: "Greg previews three to five distinct topics he is about to teach in order, with short chapter titles and no timestamps",
    slots: { topics: repeated(spoken(29, 530), 3, 5) },
    render(o, h) {
      const s = scene(o, h);
      const rows = o.slots.topics.map((item, i) => {
        s.state(`.ko-leader-${i}`, { scaleX: 0 }, { scaleX: 1 }, item.at);
        return `<div class="ko-index-row">${s.word(item, `chapter-${i}`)}<span class="ko-leader ko-leader-${i}"></span></div>`;
      }).join("");
      return s.done(rows);
    },
    rules: {
      ".ko-index-row": "display:grid;grid-template-columns:minmax(0,max-content) minmax(86px,1fr);gap:12px;height:54px;align-items:center;",
      ".ko-leader": `border-bottom:3px dotted ${gold};transform:scaleX(0);transform-origin:left;`,
    },
  }),

  "alert-stack": card("alert-stack", {
    family: "conversation", tags: ["message", "conversation"], height: 392, sources: "notifs",
    hint: "Greg reenacts three alerts arriving in order, saying each exact notification title and its brief message without sender names or timestamps",
    slots: numbered(3, { title: spoken(25, 546), message: spoken(30, 546) }),
    render(o, h) {
      const s = scene(o, h);
      const rows = panelGroup(s, 3, (i) => {
        const at = s.item(`title${i}`).at;
        s.draw(`.ko-panel-${i} .ko-link-0`, at);
        return { html: paths(36, 36, ["M3 5H33V25H13L6 32V25H3ZM9 12H27M9 18H23"]) + `<div>${paired(s, i, "title", "message")}</div>`, at };
      }, { y: -12 });
      return s.done(`<div class="ko-alerts">${rows}</div>`);
    },
    rules: {
      ".ko-alerts": "display:grid;gap:8px;",
      ".ko-panel": `${tile}display:grid;grid-template-columns:36px 1fr;gap:14px;align-items:center;padding:4px 12px;border-left:4px solid ${gold};`,
      ".ko-lines": "width:36px;height:36px;", ".ko-head": head, ".ko-detail": detail,
    },
  }),

  "four-part-loop": card("four-part-loop", {
    family: "procedure", tags: ["flow", "steps"], height: 508, sources: "cycle",
    hint: "Greg names and briefly explains four actions in a repeatable loop and explicitly says the last leads back to the first",
    slots: numbered(4, { title: spoken(22, 262, 2), detail: spoken(24, 262, 2) }),
    render(o, h) {
      const s = scene(o, h);
      const arrows = paths(656, 460, [
        "M289 103Q328 76 367 103m-14-1 14 1-5-12",
        "M513 209q24 21 0 42m2-13-2 13 13-2",
        "M367 357Q328 384 289 357m14 1-14-1 5 12",
        "M143 251q-24-21 0-42m-2 13 2-13-13 2",
      ]);
      const panels = panelGroup(s, 4, (i) => {
        const at = s.item(`title${i}`).at;
        if (i > 1) s.draw(`.ko-link-${i - 2}`, at);
        if (i === 4) s.draw(".ko-link-3", s.item("detail4").at);
        return { html: paired(s, i), at };
      }, {});
      return s.done(`<div class="ko-loop">${arrows}${panels}</div>`);
    },
    rules: {
      ".ko-loop": "position:relative;height:460px;",
      ".ko-lines": "position:absolute;width:100%;height:100%;",
      ".ko-panel": `${tile}position:absolute;width:288px;height:208px;padding:6px 10px;background:${ink};text-align:center;display:flex;flex-direction:column;justify-content:center;`,
      ".ko-panel-1": "left:0;top:0;",
      ".ko-panel-2": "right:0;top:0;",
      ".ko-panel-3": "right:0;bottom:0;",
      ".ko-panel-4": "left:0;bottom:0;",
      ".ko-head": head, ".ko-detail": detail,
    },
  }),

  "journey-stops": card("journey-stops", {
    family: "procedure", tags: ["timeline", "flow"], height: 548, sources: "journey",
    hint: "Greg traces four named points in a buyer's journey and says a compact observation at each stop in travel order",
    slots: numbered(4, { title: spoken(18, 272), detail: spoken(24, 272, 2) }),
    render(o, h) {
      const s = scene(o, h);
      const route = paths(656, 500, [
        "M310 77C500 77 460 147 346 191",
        "M346 191C150 195 189 270 310 305",
        "M310 305C500 305 460 375 346 419",
      ]);
      const panels = panelGroup(s, 4, (i) => {
        const at = s.item(`title${i}`).at;
        if (i > 1) s.draw(`.ko-link-${i - 2}`, at);
        return { html: paired(s, i), at };
      }, { y: 8 });
      return s.done(`<div class="ko-route">${route}${panels}</div>`);
    },
    rules: {
      ".ko-route": "position:relative;height:500px;",
      ".ko-lines": "position:absolute;width:100%;height:100%;",
      ".ko-panel": `${tile}position:absolute;width:310px;height:154px;padding:3px 16px;background:${ink};`,
      ".ko-panel-1": "top:0;left:0;", ".ko-panel-2": "top:114px;right:0;",
      ".ko-panel-3": "top:228px;left:0;", ".ko-panel-4": "top:342px;right:0;",
      ".ko-head": head, ".ko-detail": detail,
    },
  }),

  "pyramid-slabs": card("pyramid-slabs", {
    variantOf: "system-layers", family: "procedure", tags: ["chart", "list"], sources: "pyramid levels",
    height: (o) => 42 + o.slots.layers.reduce((sum, layer) => sum + 18 + 48 * layer.lines.length, 0),
    hint: layersHint,
    slots: { layers: repeated(spoken(26, 310, 2), 3, 4) },
    render(o, h) {
      const s = scene(o, h);
      const slabs = o.slots.layers.map((item, i) => {
        s.enter(`.ko-slab-${i}`, item.at, { y: 16 });
        return `<div class="ko-slab ko-slab-${i} ko-enter">${s.word(item, `level-${i}`)}</div>`;
      }).join("");
      return s.done(`<div class="ko-pyramid">${slabs}</div>`);
    },
    rules: {
      ".ko-pyramid": "display:flex;flex-direction:column-reverse;align-items:center;gap:6px;",
      ".ko-slab": `${tile}padding:4px 16px;text-align:center;`,
      ".ko-slab-0": "width:656px;", ".ko-slab-1": "width:548px;",
      ".ko-slab-2": "width:440px;", ".ko-slab-3": "width:348px;",
      ".ko-slab:last-child": `background:${gold};border-color:${gold};color:${ink};`,
    },
  }),

  "system-layers": card("system-layers", {
    family: "procedure", tags: ["list", "flow"], sources: "layers",
    height: (o) => 44 + o.slots.layers.length * 72,
    hint: layersHint,
    slots: { layers: repeated(spoken(26, 550), 3, 4) },
    render(o, h) {
      const s = scene(o, h);
      const layers = panelGroup(s, o.slots.layers.length, (i) => {
        const item = o.slots.layers[i - 1];
        return { html: s.word(item, `layer-${i}`), at: item.at };
      }, { x: 12 });
      return s.done(`<div class="ko-layers">${layers}</div>`);
    },
    rules: {
      ".ko-layers": "display:flex;flex-direction:column-reverse;gap:4px;",
      ".ko-panel": `${tile}padding:8px 14px;width:600px;border-left:5px solid ${gold};`,
      ".ko-panel-1": "margin-left:0;", ".ko-panel-2": "margin-left:18px;",
      ".ko-panel-3": "margin-left:36px;", ".ko-panel-4": "margin-left:54px;",
    },
  }),

  "nested-context": card("nested-context", {
    family: "procedure", tags: ["flow", "definition"], height: 418, sources: "nested",
    hint: "Greg names three things that literally or conceptually contain one another, saying the outer context first and ending with the core",
    slots: { outside: spoken(28, 618), inside: spoken(24, 526), core: spoken(20, 434) },
    render(o, h) {
      const s = scene(o, h);
      const boxes = ["outside", "inside", "core"].reduceRight((children, slot) => {
        s.enter(`.ko-frame-${slot}`, s.item(slot).at, { x: 10 });
        return `<div class="ko-frame ko-frame-${slot} ko-enter">${s.say(slot)}${children}</div>`;
      }, "");
      return s.done(boxes);
    },
    rules: {
      ".ko-frame": `${tile}padding:12px 16px 16px;`,
      ".ko-frame .ko-frame": "margin:12px 6px 0 26px;",
      ".ko-frame-core": `border:3px solid ${gold};color:${gold};padding-bottom:24px;`,
    },
  }),

  "axis-quadrants": card("axis-quadrants", {
    family: "distinction", tags: ["comparison", "chart"], height: 466, sources: "matrix",
    hint: "Greg describes the low and high ends of two axes and explicitly places an example in each quadrant; provide the top, bottom, left, and right axis wording, then upper left, upper right, lower left, and lower right examples in that spoken order",
    slots: {
      top: spoken(18, 430), bottom: spoken(18, 430), left: spoken(18, 312), right: spoken(18, 312),
      upperLeft: spoken(24, 294, 2), upperRight: spoken(24, 294, 2),
      lowerLeft: spoken(24, 294, 2), lowerRight: spoken(24, 294, 2),
    },
    render(o, h) {
      const s = scene(o, h);
      const axes = paths(656, 244, ["M0 122H654M646 114l8 8-8 8", "M328 242V2m-8 8 8-8 8 8"]);
      s.draw(".ko-link-0", s.item("right").at);
      s.draw(".ko-link-1", s.item("bottom").at);
      const quadrants = ["upperLeft", "upperRight", "lowerLeft", "lowerRight"].map((slot) => {
        s.enter(`.ko-cell-${slot}`, s.item(slot).at, { y: 8 });
        return `<div class="ko-cell ko-cell-${slot} ko-enter">${s.say(slot)}</div>`;
      }).join("");
      return s.done(`<div class="ko-y">${s.say("top")}</div><div class="ko-matrix">${axes}${quadrants}</div><div class="ko-y">${s.say("bottom")}</div><div class="ko-axis-labels">${s.say("left")}${s.say("right")}</div>`);
    },
    rules: {
      ".ko-matrix": twoColumns + "position:relative;height:244px;gap:14px;",
      ".ko-cell": `${tile}display:flex;justify-content:center;align-items:center;text-align:center;padding:0 10px;`,
      ".ko-lines": "position:absolute;inset:0;width:100%;height:100%;",
      ".ko-y": "text-align:center;padding:3px;",
      ".ko-axis-labels": twoColumns + "border-top:2px solid " + rule + ";",
      ".ko-said-right": "text-align:right;",
    },
  }),

  "mapped-spectrum": card("mapped-spectrum", {
    family: "distinction", tags: ["comparison", "chart"], height: 476, sources: "spectrum",
    hint: "Greg names both ends of a continuum, then explicitly locates three examples from the first end toward the second, saying an example and its short qualitative position in order",
    slots: { start: spoken(24, 620), end: spoken(24, 620), ...numbered(3, { example: spoken(20, 277, 2), position: spoken(20, 270, 2) }) },
    render(o, h) {
      const s = scene(o, h);
      const endcaps = s.say("start", "ko-cap") + s.say("end", "ko-cap");
      const stops = panelGroup(s, 3, (i) => {
        const at = s.item(`example${i}`).at;
        s.draw(`.ko-panel-${i} .ko-link-0`, at);
        return { html: paths(34, 104, ["M17 0V53h16"]) + paired(s, i, "example", "position"), at };
      }, {});
      return s.done(`<div class="ko-spectrum">${endcaps}${stops}</div>`);
    },
    rules: {
      ".ko-spectrum": "display:flex;flex-direction:column;",
      ".ko-said-start": "order:-1;", ".ko-said-end": "order:1;",
      ".ko-cap": `${head}padding-left:16px;`,
      ".ko-panel": `display:grid;grid-template-columns:34px 1fr 1fr;gap:12px;align-items:center;border-left:2px solid ${rule};height:104px;margin-left:14px;`,
      ".ko-lines": "width:34px;height:104px;",
      ".ko-detail": detail,
    },
  }),

  "idea-hub": card("idea-hub", {
    family: "payoff", tags: ["definition", "flow"], height: 492, sources: "mindmap",
    hint: "Greg names a core idea and then names four distinct components he explicitly connects back to it",
    slots: { hub: spoken(29, 370, 2), leaves: repeated(spoken(24, 278, 2), 4) },
    render(o, h) {
      const s = scene(o, h);
      const arrows = paths(656, 438, ["M328 219 154 100", "M328 219 502 100", "M328 219 154 338", "M328 219 502 338"]);
      const leaves = panelGroup(s, 4, (i) => {
        const item = o.slots.leaves[i - 1];
        s.draw(`.ko-link-${i - 1}`, item.at);
        return { html: s.word(item, `leaf-${i}`), at: item.at };
      }, {});
      s.enter(".ko-hub", s.item("hub").at);
      return s.done(`<div class="ko-map">${arrows}${leaves}<div class="ko-hub ko-enter">${s.say("hub")}</div></div>`);
    },
    rules: {
      ".ko-map": "height:438px;position:relative;",
      ".ko-lines": "position:absolute;width:100%;height:100%;",
      ".ko-hub": `${tile}position:absolute;left:130px;top:161px;width:396px;height:116px;display:grid;place-items:center;padding:8px 10px;text-align:center;background:${ink};border-color:${gold};color:${gold};`,
      ".ko-panel": `${tile}position:absolute;width:304px;height:112px;display:grid;place-items:center;text-align:center;padding:4px 10px;background:${ink};`,
      ".ko-panel-1": "top:0;left:0;", ".ko-panel-2": "top:0;right:0;",
      ".ko-panel-3": "bottom:0;left:0;", ".ko-panel-4": "bottom:0;right:0;",
    },
  }),

  "linked-system": card("linked-system", {
    family: "procedure", tags: ["flow"], height: 474, sources: "network",
    hint: "Greg describes five system components in a chain with a shared handoff in the middle; each component needs a short spoken name and the links must follow that spoken order",
    slots: { nodes: repeated(spoken(21, 254, 2), 5) },
    render(o, h) {
      const s = scene(o, h);
      // Links represent only the stated chain. A crossing line alone never implies an added relationship.
      const links = paths(656, 420, ["M286 54H370", "M510 90 328 220", "M328 220 146 328", "M286 369H370"]);
      const nodes = panelGroup(s, 5, (i) => {
        const item = o.slots.nodes[i - 1];
        if (i > 1) s.draw(`.ko-link-${i - 2}`, item.at);
        return { html: s.word(item, `node-${i}`), at: item.at };
      }, {});
      return s.done(`<div class="ko-network">${links}${nodes}</div>`);
    },
    rules: {
      ".ko-network": "position:relative;height:420px;",
      ".ko-lines": "position:absolute;width:100%;height:100%;",
      ".ko-panel": `${tile}position:absolute;width:286px;height:108px;background:${ink};padding:4px 12px;display:grid;place-items:center;text-align:center;`,
      ".ko-panel-1": "top:0;left:0;", ".ko-panel-2": "top:0;right:0;",
      ".ko-panel-3": `top:156px;left:185px;border-color:${gold};`,
      ".ko-panel-4": "bottom:0;left:0;", ".ko-panel-5": "bottom:0;right:0;",
    },
  }),

  "outcome-tree": card("outcome-tree", {
    family: "procedure", tags: ["flow", "list"], height: 492, sources: "tree orgchart",
    hint: "Greg names one cause or parent category and gives exactly three outcomes or categories that branch directly from it",
    slots: { root: spoken(36, 610, 2), outcomes: repeated(spoken(28, 524, 2), 3) },
    render(o, h) {
      const s = scene(o, h);
      const tree = paths(656, 334, ["M328 1V12H34", "M34 12V71H88", "M34 71V177H88", "M34 177V283H88"]);
      s.enter(".ko-root-box", s.item("root").at);
      const root = s.say("root");
      const children = panelGroup(s, 3, (i) => {
        const item = o.slots.outcomes[i - 1];
        if (i === 1) s.draw(".ko-link-0", item.at);
        s.draw(`.ko-link-${i}`, item.at);
        return { html: s.word(item, `outcome-${i}`), at: item.at };
      }, {});
      return s.done(`<div class="ko-root-box ko-enter">${root}</div><div class="ko-outcomes">${tree}${children}</div>`);
    },
    rules: {
      ".ko-root-box": `${tile}min-height:108px;text-align:center;display:grid;place-items:center;padding:4px 12px;color:${gold};`,
      ".ko-lines": "position:absolute;inset:0;width:656px;height:334px;",
      ".ko-outcomes": "position:relative;display:grid;gap:4px;padding:20px 0 0 88px;",
      ".ko-panel": `${tile}height:102px;display:grid;align-items:center;padding:0 14px;`,
    },
  }),

  "named-overlap": card("named-overlap", {
    family: "distinction", tags: ["comparison", "definition"], height: 376, sources: "venn",
    hint: "Greg names two concepts, then explicitly names their intersection as a third short phrase",
    slots: { left: spoken(22, 172, 2), right: spoken(22, 172, 2), overlap: spoken(20, 192, 2) },
    render(o, h) {
      const s = scene(o, h);
      const atlas = paths(656, 296, ["M424 148a210 144 0 1 1-420 0 210 144 0 1 1 420 0Z", "M652 148a210 144 0 1 1-420 0 210 144 0 1 1 420 0Z"]);
      s.draw(".ko-link-0", s.item("left").at);
      s.draw(".ko-link-1", s.item("right").at);
      s.enter(".ko-cross", s.item("overlap").at, { y: 8 });
      return s.done(`<div class="ko-venn">${atlas}<div class="ko-venn-copy">${s.say("left")}${s.say("right")}<div class="ko-cross ko-enter">${s.say("overlap")}</div></div></div>`);
    },
    rules: {
      ".ko-venn": "position:relative;height:296px;display:grid;align-items:center;",
      ".ko-lines": "position:absolute;width:100%;height:100%;",
      ".ko-venn-copy": "z-index:1;display:grid;grid-template-columns:172px 216px 172px;gap:20px;justify-content:center;align-items:center;text-align:center;",
      ".ko-said-right": "grid-column:3;grid-row:1;",
      ".ko-cross": `${tile}grid-column:2;grid-row:1;background:${ink};border-color:${gold};color:${gold};padding:6px 10px;`,
    },
  }),

  "center-spotlight": card("center-spotlight", {
    family: "payoff", tags: ["comparison", "callout"], height: 432, sources: "spotlightcard",
    hint: "Greg describes two contrasting conditions, then explicitly names and explains the decisive change that takes a rep from the first condition to the second",
    slots: { left: spoken(22, 286, 2), leftDetail: spoken(20, 286), right: spoken(22, 286, 2), rightDetail: spoken(20, 286), focus: spoken(30, 614, 1, 48), focusDetail: spoken(48, 614, 2) },
    render(o, h) {
      const s = scene(o, h);
      const flank = (name, x) => {
        s.enter(`.ko-flank-${name}`, s.item(name).at, { x });
        return `<div class="ko-flank ko-flank-${name} ko-enter">${s.say(name, "ko-head")}${s.say(`${name}Detail`, "ko-detail")}</div>`;
      };
      const sides = flank("left", 12) + flank("right", -12);
      s.enter(".ko-focus-box", s.item("focus").at, { y: 16 });
      return s.done(`<div class="ko-flanks">${sides}</div><div class="ko-focus-box ko-enter">${s.say("focus")}${s.say("focusDetail", "ko-detail")}</div>`);
    },
    rules: {
      ".ko-flanks": twoColumns + "margin-bottom:16px;",
      ".ko-flank": `${tile}padding:10px 16px;`,
      ".ko-head": head, ".ko-detail": detail,
      ".ko-focus-box": `${tile}padding:12px 18px;border-color:${gold};border-top-width:5px;`,
      ".ko-said-focus": `color:${gold};font:800 48px/56px "Inter",sans-serif;`,
    },
  }),
};
