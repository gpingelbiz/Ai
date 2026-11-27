// Restyled from the Herk Edit Kit (MIT, copyright 2026 Nate Herk). See src/pro-cards/HERK-LICENSE.md.
import { CARDS as proof } from "./proof-2.mjs";
import { CARDS as procedureProof } from "./procedure-proof.mjs";

const gold = "#C8A24B";
const rule = "#343438";
const small = Object.fromEntries("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ").map((word, i) => [word, i]));
const tens = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const scales = { thousand: 1e3, million: 1e6, billion: 1e9 };

function underThousand(words) {
  const [first, second, third] = words;
  if (second === "hundred" && Object.hasOwn(small, first) && small[first] > 0 && small[first] < 10) {
    if (words.length === 2) return small[first] * 100;
    const tail = underHundred(words.slice(third === "and" ? 3 : 2));
    return tail > 0 ? small[first] * 100 + tail : null;
  }
  return underHundred(words);
}

function underHundred(words) {
  const [first, second] = words;
  if (words.length === 1) {
    if (Object.hasOwn(small, first)) return small[first];
    if (Object.hasOwn(tens, first)) return tens[first];
  }
  if (words.length === 2 && Object.hasOwn(tens, first) && Object.hasOwn(small, second) && small[second] > 0 && small[second] < 10) {
    return tens[first] + small[second];
  }
  return null;
}

function unsigned(text) {
  const literal = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?(?:\s*(k|m|b|thousand|million|billion))?$/.exec(text);
  if (literal) {
    const [, whole, decimal, scale] = literal;
    const value = Number(whole.replaceAll(",", "") + (decimal ? "." + decimal : ""));
    return value * (scales[scale] || { k: 1e3, m: 1e6, b: 1e9 }[scale] || 1);
  }

  const words = text.replace(/(?<=[a-z])-(?=[a-z])/g, " ").split(/\s+/);
  let value = 0;
  let groupStart = 0;
  let lastScale = Infinity;
  for (const [i, word] of words.entries()) {
    if (!Object.hasOwn(scales, word)) continue;
    const group = decimalGroup(words.slice(groupStart, i));
    if (!(group > 0) || scales[word] >= lastScale) return null;
    value += group * scales[word];
    lastScale = scales[word];
    groupStart = i + 1;
  }
  if (groupStart === words.length) return value;
  if (groupStart > 0 && words[groupStart] === "and") groupStart++;
  const rest = decimalGroup(words.slice(groupStart));
  return rest === null ? null : value + rest;
}

function decimalGroup(words) {
  const point = words.indexOf("point");
  const whole = underThousand(point < 0 ? words : words.slice(0, point));
  if (whole === null) return null;
  if (point < 0) return whole;
  const decimal = words.slice(point + 1);
  if (!decimal.length || decimal.some((word) => !Object.hasOwn(small, word) || small[word] > 9)) return null;
  return whole + Number("0." + decimal.map((word) => small[word]).join(""));
}

// Quantities are measured for graphics only. Visible copy always uses the original range.
function quantity(text) {
  let raw = String(text ?? "").trim().toLowerCase().replace(/[.!?,;]+$/, "");
  const sign = /^(?:[+−-]|(?:plus|minus|negative|positive|up|down)\s+)/.exec(raw)?.[0] || "";
  raw = raw.slice(sign.length).trim();
  const dollar = raw.startsWith("$") || /\s+dollars?$/.test(raw);
  const percent = /%$|\s+per\s?cent$/.test(raw);
  const factor = /[0-9]\s*[×x]$|\s+times$/.test(raw);
  if (Number(dollar) + Number(percent) + Number(factor) > 1) return null;
  const unit = dollar ? "dollar" : percent ? "percent" : factor ? "factor" : "count";
  raw = raw.replace(/^\$\s*|\s+dollars?$|\s*%$|(?<=\d)\s*[×x]$|\s+per\s?cent$|\s+times$/g, "");
  const magnitude = unsigned(raw);
  if (magnitude === null || !Number.isFinite(magnitude) || magnitude > Number.MAX_SAFE_INTEGER) return null;
  const direction = sign ? (/^(?:[-−]|minus|negative|down)/.test(sign) ? -1 : 1) : 0;
  return { value: direction < 0 ? -magnitude : magnitude, unit, direction };
}

const numeric = (text) => quantity(text) !== null;
function share(text) {
  const q = quantity(text);
  return q?.unit === "percent" && q.direction === 0 && q.value <= 100 ? q.value / 100 : null;
}

function wholeCount(text) {
  const q = quantity(text);
  return q?.unit === "count" && q.direction === 0 && Number.isInteger(q.value) ? q.value : null;
}

function comparable(a, b) {
  return !!a && !!b && a.unit === b.unit;
}

// Match proTextWidth's conservative metrics without making the registry import its own grounder.
// Require the specified font size so grounding can keep the phone typography.
function fitsAtSize(text, { width, size, maxLines }) {
  const measure = (line) => [...line].reduce((sum, ch) =>
    sum + (/\s/.test(ch) ? 0.3 : /[ilI.,!'’]/.test(ch) ? 0.32 : /[MW@]/.test(ch) ? 0.95 : /[A-Z]/.test(ch) ? 0.75 : 0.65) * size, 0);
  let lines = 1, current = "";
  for (const word of text.trim().split(/\s+/)) {
    if (measure(word) > width) return false;
    if (current && measure(`${current} ${word}`) > width) { lines++; current = ""; }
    current = current ? `${current} ${word}` : word;
  }
  return !!current && lines <= maxLines;
}

function spoken(width, size, maxLines, maxChars, validate = () => true) {
  const box = { width, size, maxLines };
  return { kind: "spoken", ...box, maxChars, validate: (text, slots) => fitsAtSize(text, box) && validate(text, slots) };
}

const headline = (width, maxLines = 2, validate = numeric) => spoken(width, 96, maxLines, 30, validate);
const copy = (width, maxLines = 2, maxChars = 44, validate) => spoken(width, 40, maxLines, maxChars, validate);
const optional = (slot) => ({ ...slot, optional: true });
const heading = { kind: "label", width: 656, size: 28, maxLines: 1, maxChars: 22 };
const isShare = (text) => share(text) !== null;
const rateSlots = (width = 656, lines = 3) => ({ value: headline(width, lines, isShare), context: copy(width) });
const height = (item, lineHeight) => item.lines.length * lineHeight;
const rateHeight = (o) => height(o.slots.value[0], 106) + height(o.slots.context[0], 48);
const sideRateSize = (graphicHeight) => (o) => ({ w: 720, h: 40 + Math.max(graphicHeight, rateHeight(o)) });

function write(h, selector, at, rise = false) {
  const from = rise ? { opacity: 0, y: 16, clipPath: "inset(0 0 100% 0)" } : { opacity: 0, clipPath: "inset(0 100% 0 0)" };
  const to = rise ? { y: 0 } : {};
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},opacity:1,clipPath:"inset(0 0 0 0)",duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

function state(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${h.at(at)});`;
}

const draw = (h, selector, at, offset = 0) => state(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: offset }, at);
const horizontal = (h, selector, ratio, at) => state(h, selector, { scaleX: 0 }, { scaleX: ratio }, at);
const text = (h, item, name, role = "copy") => `<div class="ks-said ks-${role} ${name}">${h.copy(item)}</div>`;
const label = (content) => `<div class="ks-label">${content}</div>`;
const plot = (name, w, h, inner) => `<svg class="${name}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${inner}</svg>`;
const path = (name, d) => `<path class="${name}" pathLength="1" d="${d}"/>`;

function proofCard(type, origins, { css, ...def }) {
  const scope = `.pro-${type}`;
  return {
    family: "proof",
    surface: "obsidian",
    source: "herk:" + origins.map((id) => "kallaway.t1.stat." + id).join(","),
    ...def,
    css: `
      ${scope} { padding:20px 32px; }
      ${scope} .ks-said { opacity:0;clip-path:inset(0 100% 0 0); }
      ${scope} .ks-headline { font:400 96px/106px "Anton",sans-serif;color:#C8A24B; }
      ${scope} .ks-copy { font:650 40px/48px "Inter",sans-serif;color:#F5F1E8; }
      ${scope} .ks-label { font:700 28px/34px "Inter",sans-serif;color:#A8A49C; }
      ${scope} .ks-draw { fill:none;stroke:#C8A24B;stroke-width:4;stroke-dasharray:1;stroke-dashoffset:1; }
      ${css.replaceAll("&", scope)}`,
  };
}

function rateText(o, h) {
  return text(h, o.slots.value[0], "rate-value", "headline") + text(h, o.slots.context[0], "rate-context");
}

function rateReveals(o, h) {
  return [write(h, ".rate-value", o.reveals[0]), write(h, ".rate-context", o.reveals[1])];
}

const rateHint = procedureProof["percent-ring"].hint;
const caseHint = proof["case-study"].hint;
const barTrack = (cls) => `<div class="ks-track ${cls}" aria-hidden="true"><div class="ks-fill"></div></div>`;
const trackCSS = `
      & .ks-track { height:16px;border-radius:8px;background:#343438;overflow:hidden; }
      & .ks-fill { height:100%;background:#C8A24B;transform:scaleX(0);transform-origin:left; }`;

export const CARDS = {
  "annotated-figure": proofCard("annotated-figure", ["annot", "orbitmoons", "nodes"], {
    hint: "Greg states one headline amount and then one or two concise qualifications or related figures that he explicitly ties to it in later spoken phrases",
    tags: ["number", "callout"],
    slots: { value: headline(624), note: { ...copy(564, 2, 36), repeat: [1, 2] } },
    size: (o) => ({ w: 720, h: 40 + height(o.slots.value[0], 106) + o.slots.note.reduce((sum, item) => sum + 8 + height(item, 48), 0) }),
    render(o, h) {
      const { value, note } = o.slots;
      const notes = note.map((item, i) => {
        const leader = plot("annotation-leader", 64, 40, path("ks-draw", "M4 2v18h56"));
        return `<div class="annotation-row annotation-${i}">${leader}${text(h, item, "annotation-note")}</div>`;
      });
      return {
        inner: text(h, value[0], "annotation-value", "headline") + notes.join(""),
        timeline: [write(h, ".annotation-value", value[0].at), ...note.flatMap((item, i) => [
          draw(h, `.annotation-${i} path`, item.at), write(h, `.annotation-${i} .annotation-note`, item.at),
        ])].join("\n"),
      };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;gap:8px; }
      & .annotation-row { display:grid;grid-template-columns:64px 564px;gap:12px;align-items:start; }
      & .annotation-leader { width:64px;height:40px; }`,
  }),

  "paired-rate-bars": proofCard("paired-rate-bars", ["cbars"], {
    variantOf: "case-study",
    hint: caseHint,
    tags: ["before-after", "percent", "chart"],
    slots: { before: headline(656, 1, isShare), after: headline(656, 1, isShare), label: copy(656) },
    size: (o) => ({ w: 720, h: 376 + height(o.slots.label[0], 48) }),
    render(o, h) {
      const { before, after, label: context } = o.slots;
      const rows = [["Before", before[0]], ["After", after[0]]];
      const inner = rows.map(([title, item], i) => `<div class="rate-row rate-row-${i}">${label(title)}${text(h, item, "rate-number", "headline")}${barTrack("rate-bar")}</div>`).join("") +
        text(h, context[0], "rate-context");
      const timeline = rows.flatMap(([, item], i) => [
        write(h, `.rate-row-${i} .rate-number`, item.at),
        horizontal(h, `.rate-row-${i} .ks-fill`, share(item.text), item.at),
      ]);
      timeline.push(write(h, ".rate-context", context[0].at));
      return { inner, timeline: timeline.join("\n") };
    },
    css: trackCSS + `
      & { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      & .rate-row-0 .rate-number { color:#F5F1E8; }
      & .rate-row-0 .ks-fill { background:#A8A49C; }`,
  }),

  "percent-bubble": proofCard("percent-bubble", ["bubble"], {
    variantOf: "percent-ring",
    hint: rateHint,
    tags: ["percent", "chart"],
    slots: rateSlots(448, 3),
    size: sideRateSize(180),
    render(o, h) {
      const radius = 94 * Math.sqrt(share(o.slots.value[0].text));
      const inner = plot("rate-disc", 200, 200, '<circle class="rate-bound" cx="100" cy="100" r="96"/><circle class="rate-bubble" cx="100" cy="100" r="0"/>') +
        `<div>${rateText(o, h)}</div>`;
      const timeline = [...rateReveals(o, h), state(h, ".rate-bubble", { attr: { r: 0 } }, { attr: { r: radius } }, o.reveals[0])];
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & { display:grid;grid-template-columns:180px 448px;gap:24px;align-items:center;justify-content:center; }
      & .rate-disc { width:180px;height:180px; }
      & .rate-bound { fill:none;stroke:#343438;stroke-width:3; }
      & .rate-bubble { fill:#C8A24B; }`,
  }),

  "percent-grid": proofCard("percent-grid", ["waffle", "dotgrid"], {
    variantOf: "percent-ring",
    hint: rateHint,
    tags: ["percent", "chart"],
    slots: rateSlots(448, 3),
    size: sideRateSize(180),
    render(o, h) {
      const fraction = share(o.slots.value[0].text);
      const grid = Array.from({ length: 100 }, (_, i) =>
        `<rect x="${(i % 10) * 22}" y="${Math.floor(i / 10) * 22}" width="18" height="18" rx="2"/>`).join("");
      const wholeRows = Math.floor(fraction * 10 + 1e-10);
      const nextRow = fraction * 10 - wholeRows;
      // The mask counts cells, including the fractional cell of a decimal percentage.
      const filledRows = wholeRows ? `<rect width="220" height="${wholeRows * 22}"/>` : "";
      const nextCells = Math.max(0, nextRow * 10);
      const wholeCells = Math.floor(nextCells + 1e-10);
      const nextWidth = wholeCells * 22 + Math.max(0, nextCells - wholeCells) * 18;
      const remainder = nextWidth ? `<rect y="${wholeRows * 22}" width="${h.at(nextWidth)}" height="18"/>` : "";
      const mask = `${o.id}-rate-grid`;
      const inner = plot("rate-grid", 220, 220, `<defs><clipPath id="${h.esc(mask)}">${filledRows}${remainder}</clipPath></defs><g class="rate-cells">${grid}</g><g clip-path="url(#${h.esc(mask)})"><g class="rate-lit">${grid}</g></g>`) +
        `<div>${rateText(o, h)}</div>`;
      return { inner, timeline: [...rateReveals(o, h), state(h, ".rate-lit", { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)" }, o.reveals[0])].join("\n") };
    },
    css: `
      & { display:grid;grid-template-columns:180px 448px;gap:24px;align-items:center;justify-content:center; }
      & .rate-grid { width:180px;height:180px; }
      & .rate-cells { fill:#343438; }
      & .rate-lit { fill:#C8A24B;clip-path:inset(0 0 100% 0); }`,
  }),

  "percent-tank": proofCard("percent-tank", ["fillshape"], {
    variantOf: "percent-ring",
    hint: rateHint,
    tags: ["percent", "progress", "chart"],
    slots: rateSlots(444, 3),
    size: sideRateSize(208),
    render(o, h) {
      const ratio = share(o.slots.value[0].text);
      const inner = `<div>${rateText(o, h)}</div><div class="rate-tank" aria-hidden="true"><div class="rate-water"></div></div>`;
      return { inner, timeline: [...rateReveals(o, h), state(h, ".rate-water", { scaleY: 0 }, { scaleY: ratio }, o.reveals[0])].join("\n") };
    },
    css: `
      & { display:grid;grid-template-columns:444px 128px;gap:36px;align-items:center;justify-content:center; }
      & .rate-tank { width:128px;height:208px;background:#343438;border:4px solid #A8A49C;border-radius:16px;overflow:hidden; }
      & .rate-water { height:100%;background:#C8A24B;transform:scaleY(0);transform-origin:bottom; }`,
  }),

  "percent-track": proofCard("percent-track", ["milestone", "meter", "needle", "spectrum", "segbar"], {
    variantOf: "percent-ring",
    hint: rateHint,
    tags: ["percent", "progress", "chart"],
    slots: rateSlots(),
    size: (o) => ({ w: 720, h: 84 + rateHeight(o) }),
    render(o, h) {
      const at = o.reveals[0];
      const x = h.at(624 * share(o.slots.value[0].text));
      const track = plot("rate-track", 656, 28, path("rate-rail", "M16 14H640") + path("ks-draw", "M16 14H640") +
        '<circle class="rate-marker" cx="16" cy="14" r="9"/>');
      const inner = text(h, o.slots.value[0], "rate-value", "headline") + track + text(h, o.slots.context[0], "rate-context");
      const timeline = [...rateReveals(o, h), draw(h, ".rate-track .ks-draw", at, 1 - share(o.slots.value[0].text)),
        state(h, ".rate-marker", { opacity: 0, x: 0 }, { opacity: 1, x }, at)];
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;gap:8px;text-align:center; }
      & .rate-track { width:656px;height:28px;flex:none; }
      & .rate-rail { stroke:#343438;stroke-width:6; }
      & .rate-marker { fill:#F5F1E8;opacity:0; }`,
  }),

  "arc-gauge": proofCard("arc-gauge", ["semigauge"], {
    variantOf: "gauge",
    hint: proof.gauge.hint,
    tags: ["percent", "rating", "chart"],
    slots: rateSlots(),
    size: (o) => ({ w: 720, h: 136 + rateHeight(o) }),
    render(o, h) {
      const at = o.reveals[0];
      const arc = "M12 116a104 104 0 0 1 208 0";
      const inner = plot("rate-arc", 232, 128, path("rate-arc-track", arc) + path("ks-draw", arc)) + rateText(o, h);
      return { inner, timeline: [...rateReveals(o, h), draw(h, ".rate-arc .ks-draw", at, 1 - share(o.slots.value[0].text))].join("\n") };
    },
    css: `
      & { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center; }
      & .rate-arc { width:160px;height:88px;flex:none; }
      & .rate-arc-track { fill:none;stroke:#343438;stroke-width:8; }
      & .rate-arc .ks-draw { stroke-width:8; }`,
  }),

  "delta-arrow": proofCard("delta-arrow", ["growtharrow", "delta"], {
    hint: "Greg explicitly says how far a metric went up or down as one signed percentage or with up or down in the range, then names the metric",
    tags: ["percent", "chart"],
    slots: {
      value: headline(448, 3, (line) => {
        const q = quantity(line);
        return q?.unit === "percent" && q.direction !== 0 && q.value !== 0;
      }),
      context: copy(448),
    },
    size: sideRateSize(144),
    render(o, h) {
      const up = quantity(o.slots.value[0].text).direction > 0;
      const d = up ? "M12 132L148 12M112 12h36v36" : "M12 12l136 120m-36 0h36V96";
      const inner = `<div>${rateText(o, h)}</div>` + plot("delta-arrow", 160, 144, path("ks-draw", d));
      return { inner, timeline: [...rateReveals(o, h), draw(h, ".delta-arrow path", o.reveals[0])].join("\n") };
    },
    css: `
      & { display:grid;grid-template-columns:448px 160px;gap:36px;align-items:center;justify-content:center; }
      & .delta-arrow { width:160px;height:144px; }
      & .delta-arrow path { stroke-width:8;stroke-linecap:round;stroke-linejoin:round; }`,
  }),

  "rising-figure": proofCard("rising-figure", ["risewall", "underscore"], {
    hint: "Greg lands one standout amount as evidence for a point and immediately says a short qualification explaining what the number represents",
    tags: ["number", "callout"],
    slots: { value: headline(656, 3), context: copy(624) },
    size: (o) => ({ w: 720, h: 56 + rateHeight(o) }),
    render(o, h) {
      const inner = text(h, o.slots.value[0], "figure-value", "headline") +
        plot("figure-rim", 656, 8, path("ks-draw", "M0 4H656")) + text(h, o.slots.context[0], "figure-context");
      return { inner, timeline: [
        write(h, ".figure-value", o.reveals[0], true), draw(h, ".figure-rim path", o.reveals[0]),
        write(h, ".figure-context", o.reveals[1]),
      ].join("\n") };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;gap:4px;text-align:center; }
      & .figure-rim { width:656px;height:8px;flex:none; }
      & .figure-context { background:#343438;padding:0 16px;color:#F5F1E8; }`,
  }),

  "people-fraction": proofCard("people-fraction", ["isotype"], {
    hint: "Greg explicitly says how many people out of a named group of at most twelve, followed by what those people did, with both numbers and out of in the fraction range",
    tags: ["number", "chart"],
    slots: {
      value: headline(416, 3, (line) => peopleFraction(line) !== null),
      context: copy(416),
    },
    size: sideRateSize(174),
    render(o, h) {
      const { part, total } = peopleFraction(o.slots.value[0].text);
      const people = Array.from({ length: total }, (_, i) =>
        `<g class="fraction-person${i < part ? " fraction-hit" : ""}" transform="translate(${i % 4 * 50} ${Math.floor(i / 4) * 58})"><circle cx="24" cy="13" r="10"/><path d="M5 51V42a19 19 0 0 1 38 0v9Z"/></g>`).join("");
      const inner = `<div>${rateText(o, h)}</div>` + plot("fraction-people", 200, 174, `<g class="fraction-group">${people}</g>`);
      const timeline = [...rateReveals(o, h), write(h, ".fraction-group", o.reveals[0])];
      if (part) timeline.push(state(h, ".fraction-hit", { fill: rule }, { fill: gold }, o.reveals[0]));
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & { display:grid;grid-template-columns:416px 200px;gap:24px;align-items:center;justify-content:center; }
      & .fraction-people { width:200px;height:174px; }
      & .fraction-group { opacity:0; }
      & .fraction-person { fill:#A8A49C; }
      & .fraction-hit { fill:#343438; }`,
  }),

  "rank-medallion": proofCard("rank-medallion", ["rank"], {
    hint: "Greg states an actual ordinal placement such as first or number one, optionally with a spoken field size, then says what was ranked",
    tags: ["ranking", "number"],
    slots: {
      value: headline(656, 2, (line) => rank(line) !== null),
      context: copy(560),
    },
    size: (o) => ({ w: 720, h: 82 + height(o.slots.value[0], 106) + Math.max(76, height(o.slots.context[0], 48)) }),
    render(o, h) {
      const inner = label("Rank") + text(h, o.slots.value[0], "rank-value", "headline") +
        plot("rank-seal", 76, 76, path("ks-draw", "M38 5a33 33 0 1 1 0 66 33 33 0 0 1 0-66Zm-14 34 9 9 19-20")) +
        text(h, o.slots.context[0], "rank-context");
      return { inner, timeline: [
        write(h, ".rank-value", o.reveals[0]), draw(h, ".rank-seal path", o.reveals[0]), write(h, ".rank-context", o.reveals[1]),
      ].join("\n") };
    },
    css: `
      & { display:grid;grid-template-columns:76px 560px;align-content:center;align-items:center;gap:4px 12px; }
      & .ks-label { grid-column:2;color:#C8A24B; }
      & .rank-value { grid-column:1/-1; }
      & .rank-seal { width:76px;height:76px; }`,
  }),

  "percentile-tail": proofCard("percentile-tail", ["percentile"], {
    hint: "Greg explicitly says top or bottom followed by a percentage of a population, then names that population",
    tags: ["ranking", "percent", "chart"],
    slots: {
      value: headline(656, 2, (line) => percentile(line) !== null),
      context: copy(656),
    },
    size: (o) => ({ w: 720, h: 80 + rateHeight(o) }),
    render(o, h) {
      const { top, ratio } = percentile(o.slots.value[0].text);
      const edge = top ? 640 : 16;
      const tail = plot("percentile-rail", 656, 24, path("percentile-track", "M16 12H640") +
        path("ks-draw", `M${edge} 12H${top ? 16 : 640}`));
      const inner = text(h, o.slots.value[0], "rank-value", "headline") + tail + text(h, o.slots.context[0], "rank-context");
      return { inner, timeline: [
        write(h, ".rank-value", o.reveals[0]), draw(h, ".percentile-rail .ks-draw", o.reveals[0], 1 - ratio),
        write(h, ".rank-context", o.reveals[1]),
      ].join("\n") };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;gap:8px;text-align:center; }
      & .percentile-rail { width:656px;height:24px;flex:none; }
      & .percentile-track { stroke:#343438;stroke-width:12; }
      & .percentile-rail .ks-draw { stroke-width:12; }`,
  }),

  "ratio-lockup": proofCard("ratio-lockup", ["ratio"], {
    hint: "Greg explicitly states a ratio as one compact phrase like three to one, then says what the ratio compares",
    tags: ["number", "comparison"],
    slots: { value: headline(688, 1, (line) => ratioParts(line) !== null), context: copy(656) },
    size: (o) => ({ w: 720, h: 158 + height(o.slots.context[0], 48) }),
    render(o, h) {
      const [left, separator, right] = ratioParts(o.slots.value[0].text);
      const inner = `<div class="ks-said ks-headline ratio-value"><span class="ratio-left">${h.esc(left)}</span><span class="ratio-separator">${h.esc(separator)}</span><span class="ratio-right">${h.esc(right)}</span></div>` +
        text(h, o.slots.context[0], "ratio-context");
      return { inner, timeline: [
        write(h, ".ratio-value", o.reveals[0]),
        state(h, ".ratio-left", { x: -12 }, { x: 0 }, o.reveals[0]),
        state(h, ".ratio-right", { x: 12 }, { x: 0 }, o.reveals[0]),
        write(h, ".ratio-context", o.reveals[1]),
      ].join("\n") };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;gap:12px;padding:20px 16px;text-align:center; }
      & .ratio-context { width:656px;align-self:center; }
      & .ratio-value { white-space:pre; }
      & .ratio-value span { display:inline-block; }
      & .ratio-separator { color:#A8A49C; }`,
  }),

  "digital-duration": proofCard("digital-duration", ["timer"], {
    variantOf: "stopwatch",
    hint: procedureProof.stopwatch.hint,
    tags: ["time", "number"],
    slots: { time: spoken(656, 96, 4, 42, duration) },
    size: (o) => ({ w: 720, h: 46 + height(o.slots.time[0], 106) }),
    render(o, h) {
      const inner = `<div class="duration-window">${text(h, o.slots.time[0], "duration-value", "headline")}</div>`;
      return { inner, timeline: write(h, ".duration-value", o.reveals[0], true) };
    },
    css: `
      & { display:flex;align-items:center; }
      & .duration-window { width:100%;border-top:3px solid #C8A24B;border-bottom:3px solid #C8A24B;text-align:center; }
      & .duration-value { font-variant-numeric:tabular-nums; }`,
  }),

  "quantified-quote": proofCard("quantified-quote", ["quotestat"], {
    hint: "Greg says a self-contained outcome or lesson with a numeric claim in the middle, with exact contiguous ranges for the lead, numeric value and tail",
    tags: ["number", "quote", "highlight"],
    slots: { lead: copy(624), value: headline(624), tail: copy(624) },
    size: (o) => ({ w: 720, h: 56 + height(o.slots.lead[0], 48) + height(o.slots.value[0], 106) + height(o.slots.tail[0], 48) }),
    render(o, h) {
      const { lead, value, tail } = o.slots;
      const inner = text(h, lead[0], "quote-lead") + text(h, value[0], "quote-value", "headline") + text(h, tail[0], "quote-tail");
      const timeline = [write(h, ".quote-lead", lead[0].at), write(h, ".quote-value", value[0].at), write(h, ".quote-tail", tail[0].at)];
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;gap:8px;border-left:6px solid #C8A24B; }`,
  }),

  "side-by-side-metrics": proofCard("side-by-side-metrics", ["pair", "split", "versus"], {
    hint: "Greg compares or pairs two explicit outcome measures and identifies each one with a short spoken description immediately after each compact amount",
    tags: ["number", "comparison"],
    slots: { first: headline(312), firstContext: copy(312, 2, 25), second: headline(312), secondContext: copy(312, 2, 25) },
    size: { w: 720, h: 368 },
    render(o, h) {
      const inner = ["first", "second"].map((name) => `<div class="metric-column metric-${name}">` +
        text(h, o.slots[name][0], `metric-${name}-value`, "headline") +
        text(h, o.slots[`${name}Context`][0], `metric-${name}-context`) + "</div>").join("") +
        plot("metric-rule", 8, 280, path("ks-draw", "M4 0V280"));
      const timeline = ["first", "second"].flatMap((name) => [
        write(h, `.metric-${name}-value`, o.slots[name][0].at), write(h, `.metric-${name}-context`, o.slots[`${name}Context`][0].at),
      ]);
      timeline.push(draw(h, ".metric-rule path", o.slots.second[0].at));
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & { display:grid;grid-template-columns:312px 312px;gap:32px;align-content:center; }
      & .metric-column { display:grid;grid-template-rows:212px auto; }
      & .metric-column .ks-headline { align-self:end; }
      & .metric-first .ks-headline { color:#F5F1E8; }
      & .metric-rule { position:absolute;left:356px;top:44px;width:8px;height:280px; }`,
  }),

  "range-marker": proofCard("range-marker", ["range"], {
    hint: "Greg states a numeric lower bound, upper bound and one amount between them in that order, with the same spoken units for all three",
    tags: ["number", "chart"],
    slots: {
      min: copy(308, 2, 24, numeric),
      max: copy(308, 2, 24, (line, slots) => {
        const a = quantity(slots.min[0].text), b = quantity(line);
        return comparable(a, b) && a.value < b.value;
      }),
      value: headline(656, 2, (line, slots) => {
        const a = quantity(slots.min[0].text), b = quantity(slots.max[0].text), q = quantity(line);
        return comparable(a, q) && q.value >= a.value && q.value <= b.value;
      }),
    },
    size: (o) => ({
      w: 720,
      h: 88 + height(o.slots.value[0], 106) + Math.max(height(o.slots.min[0], 48), height(o.slots.max[0], 48)),
    }),
    render(o, h) {
      const { min: [min], max: [max], value: [value] } = o.slots;
      const low = quantity(min.text).value, high = quantity(max.text).value;
      const x = h.at(624 * (quantity(value.text).value - low) / (high - low));
      const track = plot("bounds-track", 656, 32, path("bounds-rail", "M16 16H640M16 8v16M640 8v16") +
        '<circle class="bounds-marker" cx="16" cy="16" r="11"/>');
      const inner = text(h, value, "bounds-value", "headline") + track + '<div class="bounds-labels">' +
        text(h, min, "bounds-min") + text(h, max, "bounds-max") + "</div>";
      const timeline = [write(h, ".bounds-min", min.at), write(h, ".bounds-max", max.at),
        write(h, ".bounds-value", value.at), state(h, ".bounds-marker", { opacity: 0, x: 0 }, { opacity: 1, x }, value.at)];
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & { display:flex;flex-direction:column;justify-content:center;gap:8px; }
      & .bounds-value { text-align:center; }
      & .bounds-track { width:656px;height:32px;flex:none; }
      & .bounds-rail { fill:none;stroke:#A8A49C;stroke-width:4; }
      & .bounds-marker { opacity:0;fill:#C8A24B; }
      & .bounds-labels { display:grid;grid-template-columns:308px 308px;justify-content:space-between; }
      & .bounds-max { text-align:right; }`,
  }),

  "trend-points": proofCard("trend-points", ["curve", "sparkline", "trendline"], {
    hint: "Greg states three or four comparable amounts for the same metric in chronological order, with spoken units in each observation",
    tags: ["number", "chart"],
    slots: {
      samples: { ...copy(284, 2, 24, (line, slots) => {
        const q = quantity(line), first = slots.samples[0];
        return !!q && q.value >= 0 && (!first || comparable(q, quantity(first.text)));
      }), repeat: [3, 4] },
      context: optional(copy(656, 1, 22)),
    },
    size: (o) => ({ w: 720, h: 40 + o.slots.samples.length * 96 + (o.slots.context.length ? 56 : 0) }),
    render(o, h) {
      const { samples, context: [context] } = o.slots;
      const values = samples.map((item) => quantity(item.text).value);
      const max = Math.max(1, ...values);
      // The sequence runs down the panel. Rightward movement means a larger stated value.
      const points = values.map((value, i) => [h.at(12 + 324 * value / max), 48 + i * 96]);
      const segments = points.slice(1).map(([x, y], i) => path(`ks-draw trend-segment-${i + 1}`, `M${points[i].join(" ")}L${x} ${y}`));
      const dots = points.map(([x, y], i) => `<circle class="trend-dot trend-dot-${i}" cx="${x}" cy="${y}" r="8"/>`);
      const rows = samples.map((item, i) => text(h, item, `trend-reading-${i}`)).join("");
      const inner = '<div class="trend-layout"><div class="trend-readings">' + rows + "</div>" +
        plot("trend-plot", 348, samples.length * 96, segments.join("") + dots.join("")) + "</div>" +
        (context ? text(h, context, "trend-context") : "");
      const timeline = samples.flatMap((item, i) => [
        write(h, `.trend-reading-${i}`, item.at), write(h, `.trend-dot-${i}`, item.at),
        ...(i ? [draw(h, `.trend-segment-${i}`, item.at)] : []),
      ]);
      if (context) timeline.push(write(h, ".trend-context", context.at));
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & .trend-layout { display:grid;grid-template-columns:284px 348px;gap:24px; }
      & .trend-readings { display:grid;grid-auto-rows:96px;align-items:center; }
      & .trend-plot { width:348px;align-self:center; }
      & .trend-dot { opacity:0;fill:#F5F1E8; }
      & .trend-context { margin-top:8px; }`,
  }),

  "comparison-rows": proofCard("comparison-rows", ["stackedbars"], {
    variantOf: "bars",
    hint: procedureProof.bars.hint,
    tags: ["number", "comparison", "chart"],
    slots: { heading: optional(heading), items: { ...copy(656, 2, 38, (line, slots) => {
      const q = entry(line);
      return !!q && q.value >= 0 && (!slots.items.length || comparable(q, entry(slots.items[0].text)));
    }), repeat: [2, 4] } },
    size: (o) => ({
      w: 720,
      h: 32 + (o.slots.heading.length ? 42 : 0) + o.slots.items.reduce((sum, item) => sum + height(item, 48) + 24, 0),
    }),
    render(o, h) {
      const { heading: [title], items } = o.slots;
      const amounts = items.map((item) => entry(item.text));
      const max = Math.max(amounts[0].unit === "percent" ? 100 : 1, ...amounts.map((q) => q.value));
      const rows = items.map((item, i) => `<div class="bar-row bar-row-${i}">${text(h, item, "bar-reading")}${barTrack("bar-track")}</div>`).join("");
      const inner = (title ? label(h.copy(title)) : "") + rows;
      const timeline = items.flatMap((item, i) => [
        write(h, `.bar-row-${i} .bar-reading`, item.at), horizontal(h, `.bar-row-${i} .ks-fill`, amounts[i].value / max, item.at),
      ]);
      return { inner, timeline: timeline.join("\n") };
    },
    css: trackCSS + `
      & .ks-label { margin-bottom:8px; }
      & .bar-row+.bar-row { margin-top:8px; }`,
  }),

  "benchmark-rings": proofCard("benchmark-rings", ["multiring", "radialbars"], {
    hint: "Greg reports three explicit benchmark percentages, each immediately followed by the group or metric it measures in the same spoken range",
    tags: ["percent", "comparison", "chart"],
    slots: { items: { ...copy(380, 2, 36, (line) => {
      const q = entry(line);
      return q?.unit === "percent" && q.direction === 0 && q.value <= 100;
    }), repeat: [3, 3] } },
    size: { w: 720, h: 368 },
    render(o, h) {
      const { items } = o.slots;
      const rings = [106, 75, 44].map((r, i) => {
        const d = `M118 ${118 - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`;
        return path("bench-track", d) + path(`ks-draw bench-fill-${i}`, d);
      });
      const readings = items.map((item, i) => text(h, item, `bench-reading-${i}`)).join("");
      const inner = plot("bench-rings", 236, 236, rings.join("")) + `<div class="bench-readings">${readings}</div>`;
      const timeline = items.flatMap((item, i) => [
        write(h, `.bench-reading-${i}`, item.at), draw(h, `.bench-fill-${i}`, item.at, 1 - entry(item.text).value / 100),
      ]);
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & { display:grid;grid-template-columns:236px 380px;gap:32px;align-items:center; }
      & .bench-rings { width:236px;height:236px; }
      & .bench-track { fill:none;stroke:#343438;stroke-width:10; }
      & .bench-rings .ks-draw { stroke-width:10; }
      & .bench-readings { display:flex;flex-direction:column;gap:8px; }
      & .bench-readings>div { border-bottom:2px solid #343438;padding-bottom:4px; }`,
  }),

  "funnel-counts": proofCard("funnel-counts", ["funnel"], {
    hint: "Greg gives three or four successive funnel stages, each as an explicit whole count followed by the stage name, with counts staying level or decreasing",
    tags: ["flow", "number", "chart"],
    slots: { items: { ...copy(366, 2, 36, (line, slots) => {
      const q = entry(line);
      if (q?.unit !== "count" || q.direction !== 0 || !Number.isInteger(q.value)) return false;
      const previous = slots.items.at(-1);
      return previous ? q.value <= entry(previous.text).value : q.value > 0;
    }), repeat: [3, 4] } },
    size: (o) => ({ w: 720, h: 80 + o.slots.items.length * 104 }),
    render(o, h) {
      const { items } = o.slots;
      const max = entry(items[0].text).value;
      const inner = label("Funnel") + items.map((item, i) => `<div class="funnel-row funnel-row-${i}"><div class="funnel-stage" aria-hidden="true"><div class="funnel-band"></div></div>${text(h, item, "funnel-reading")}</div>`).join("");
      const timeline = items.flatMap((item, i) => [
        write(h, `.funnel-row-${i} .funnel-reading`, item.at),
        horizontal(h, `.funnel-row-${i} .funnel-band`, entry(item.text).value / max, item.at),
      ]);
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & .ks-label { margin-bottom:6px;color:#C8A24B; }
      & .funnel-row { display:grid;grid-template-columns:258px 366px;gap:32px;height:104px;align-items:center; }
      & .funnel-stage { height:70px; }
      & .funnel-band { height:100%;background:#C8A24B;transform:scaleX(0);transform-origin:center;clip-path:polygon(0 0,100% 0,90% 100%,10% 100%); }
      & .funnel-row:nth-child(even) .funnel-band { background:#A8A49C; }`,
  }),

  "waterfall-build": proofCard("waterfall-build", ["waterfall"], {
    hint: "Greg walks through a total built from zero, stating two to four signed contributions with each contribution's short name, then states the matching total in the same unit",
    tags: ["number", "chart", "steps"],
    slots: {
      changes: { ...copy(364, 2, 37, (line, slots) => {
        const q = entry(line), first = slots.changes[0];
        return !!q && q.direction !== 0 && q.value !== 0 && ledgerUnits(q) !== null &&
          (!first || comparable(q, entry(first.text)));
      }), repeat: [2, 4] },
      total: headline(656, 1, (line, slots) => {
        const q = quantity(line), changes = slots.changes.map((item) => entry(item.text));
        let sum = 0;
        for (const change of changes) {
          sum += ledgerUnits(change);
          if (!Number.isSafeInteger(sum)) return false;
        }
        return comparable(q, changes[0]) && sum === ledgerUnits(q);
      }),
    },
    size: (o) => ({ w: 720, h: 156 + o.slots.changes.length * 96 }),
    render(o, h) {
      const { changes, total: [total] } = o.slots;
      const positions = [0];
      for (const change of changes) positions.push(positions.at(-1) + ledgerUnits(entry(change.text)));
      const lo = Math.min(...positions), hi = Math.max(...positions);
      const x = (value) => h.at(8 + 252 * (value - lo) / (hi - lo));
      const inner = changes.map((item, i) => {
        const start = x(positions[i]), end = x(positions[i + 1]);
        const block = `<rect class="waterfall-block${end < start ? " waterfall-debit" : ""}" x="${Math.min(start, end)}" y="5" width="${h.at(Math.abs(end - start))}" height="22"/>`;
        const joint = i < changes.length - 1 ? path("ks-draw waterfall-joint", `M${end} 16v96`) : "";
        return `<div class="waterfall-row waterfall-row-${i}">${text(h, item, "waterfall-reading")}${plot("waterfall-plot", 268, 32, joint + block)}</div>`;
      }).join("") + text(h, total, "waterfall-total", "headline");
      const timeline = changes.flatMap((item, i) => [
        write(h, `.waterfall-row-${i} .waterfall-reading`, item.at),
        horizontal(h, `.waterfall-row-${i} .waterfall-block`, 1, item.at),
        ...(i ? [draw(h, `.waterfall-row-${i - 1} .waterfall-joint`, item.at)] : []),
      ]);
      timeline.push(write(h, ".waterfall-total", total.at));
      return { inner, timeline: timeline.join("\n") };
    },
    css: `
      & .waterfall-row { display:grid;grid-template-columns:364px 268px;gap:24px;align-items:center;height:96px; }
      & .waterfall-plot { width:268px;height:32px;overflow:visible; }
      & .waterfall-block { fill:#C8A24B;transform:scaleX(0);transform-box:fill-box;transform-origin:left; }
      & .waterfall-debit { fill:#A8A49C;transform-origin:right; }
      & .waterfall-plot .waterfall-joint { stroke:#A8A49C;stroke-width:2; }
      & .waterfall-total { text-align:right;margin-top:6px; }`,
  }),
};

function peopleFraction(line) {
  const [a, b, ...rest] = line.split(/\s+out of\s+|\s*\/\s*/i);
  const part = wholeCount(a), total = wholeCount(b);
  return !rest.length && part !== null && total > 0 && total <= 12 && part <= total ? { part, total } : null;
}

function rank(line) {
  const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const [position, total, ...rest] = line.trim().toLowerCase().replace(/[.!?,;]+$/, "").split(/\s+out of\s+/);
  if (rest.length) return null;
  const prefix = /^(?:number\s+|#\s*)(.+)$/.exec(position);
  const ordinal = /^(\d+)(st|nd|rd|th)$/.exec(position);
  let value = ordinals.includes(position) ? ordinals.indexOf(position) + 1 : null;
  if (prefix) value = wholeCount(prefix[1]);
  if (ordinal) {
    const n = wholeCount(ordinal[1]), ending = (n % 100 >= 11 && n % 100 <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
    if (ordinal[2] === ending) value = n;
  }
  return value > 0 && (total === undefined || wholeCount(total) >= value) ? value : null;
}

function percentile(line) {
  const match = /^(top|bottom)\s+(.+)$/i.exec(line);
  if (!match) return null;
  const ratio = share(match[2]);
  return ratio > 0 ? { top: match[1].toLowerCase() === "top", ratio } : null;
}

function ratioParts(line) {
  const parts = line.split(/(\s*:\s*|\s+to\s+)/i);
  const [left, , right] = parts;
  const a = quantity(left), b = quantity(right);
  return parts.length === 3 && a?.unit === "count" && b?.unit === "count" &&
    a.direction === 0 && b.direction === 0 && b.value > 0 ? parts : null;
}

function duration(line) {
  const text = line.trim().toLowerCase().replace(/[.!?,;]+$/, "");
  if (/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(text)) return true;
  let rest = text;
  let previous = Infinity;
  const measures = { hour: 3600, minute: 60, second: 1 };
  while (rest) {
    const match = /^(.+?)\s+(hours?|minutes?|seconds?)(?:\s+|$)/.exec(rest);
    if (!match) return false;
    const unit = measures[match[2].replace(/s$/, "")], q = quantity(match[1]);
    if (q?.unit !== "count" || q.direction !== 0 || unit >= previous) return false;
    previous = unit;
    rest = rest.slice(match[0].length).replace(/^and\s+/, "");
  }
  return previous < Infinity;
}

function ledgerUnits(q) {
  if (q.unit === "count") return Number.isSafeInteger(q.value) ? q.value : null;
  if (q.unit !== "dollar") return null;
  const cents = Math.round(q.value * 100);
  return Number.isSafeInteger(cents) && cents / 100 === q.value ? cents : null;
}

// Chart items carry their measurement and its spoken category in one range.
function entry(line) {
  const words = line.trim().split(/\s+/);
  for (let i = words.length - 1; i > 0; i--) {
    const q = quantity(words.slice(0, i).join(" "));
    if (!q) continue;
    const category = words.slice(i).join(" ");
    const first = words[i].toLowerCase();
    if (Object.hasOwn(small, first) || Object.hasOwn(tens, first)) return null;
    if (!/^\p{L}/u.test(category) || /^(?:and|or|to|through|plus|minus|negative|positive|point|hundred|thousand|million|billion|dollars?|per\s?cent|times)\b/i.test(category)) return null;
    return q;
  }
  return null;
}
