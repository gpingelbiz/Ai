// Adapted from the Herk Edit Kit (MIT License). See src/pro-cards/HERK-LICENSE.md.

const sources = (...names) => names.map((name) => `herk:kallaway.t1.section.${name}`).join(",");
const spoken = (maxChars, width = 648, size = 54, maxLines = 2) => ({ kind: "spoken", maxChars, width, size, maxLines });
const sectionSlots = { headline: spoken(52) };
const sectionHint = "Greg explicitly opens a new teaching topic or names the next section of his method; use the exact topic phrase";
const chapterHint = "Greg explicitly numbers a teaching section, then names its topic; use only the spoken index and the following topic phrase";
const termHint = "Greg names a short sales term, then immediately explains or qualifies it in a separate spoken phrase";
const nextTopic = `<div class="ks-heading">Next topic</div>`;
const sectionLabel = `<div class="ks-heading">Section</div>`;

// A short index fits at 96 px in every design, including its common spoken forms.
const indexNumber = {
  ...spoken(6, 396, 96, 1),
  validate: (text) => /^(?:[0-9]{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)[.,]?$/i.test(text),
};
const chapterSlots = { number: indexNumber, headline: spoken(52) };

function enter(h, selector, at, from = {}, to = {}) {
  return `tl.fromTo(${h.sel(selector)},${h.js({ opacity: 0, ...from })},{...${h.js({ opacity: 1, ...to })},duration:${h.motion.enter},ease:proEnter,immediateRender:false},${at});`;
}

function write(h, selector, at, clipPath = "inset(0 100% 0 0)") {
  return enter(h, selector, at, { clipPath }, { clipPath: "inset(0 0% 0 0)" });
}

function state(h, selector, from, to, at) {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion.state},ease:proState,immediateRender:false},${at});`;
}

const draw = (h, selector, at) => state(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at);
const rule = `<div class="ks-rule" aria-hidden="true"></div>`;
const headline = (o, h) => `<div class="ks-copy">${h.copy(o.slots.headline[0])}</div>`;
const number = (o, h) => `<div class="ks-number">${h.copy(o.slots.number[0])}</div>`;
const term = (o, h) => `<div class="ks-term">${h.copy(o.slots.term[0])}</div>`;

const base = (type) => `
  .pro-${type} { display:flex;flex-direction:column;justify-content:center;gap:8px;padding:20px 32px;background:#0B0B0D;color:#F5F1E8; }
  .pro-${type} .ks-copy { min-width:0;font:750 54px/62px "Inter",sans-serif;opacity:0; }`;
const headingCSS = (type) => `
  .pro-${type} .ks-heading { color:#C8A24B;font:700 28px/34px "Inter",sans-serif;letter-spacing:2px;text-transform:uppercase; }`;
const ruleCSS = (type) => `
  .pro-${type} .ks-rule { height:4px;flex:none;background:#C8A24B;transform:scaleX(0); }`;
const strokeCSS = (type) => `
  .pro-${type} .ks-draw { fill:none;stroke:#C8A24B;stroke-width:3;stroke-dasharray:1;stroke-dashoffset:1; }`;
const numberCSS = (type) => `
  .pro-${type} .ks-number { color:#C8A24B;font:400 96px/110px "Anton",sans-serif;opacity:0; }`;

export const CARDS = {
  "section-divider": {
    family: "emphasis",
    tags: ["title"],
    hint: sectionHint,
    source: sources("divider", "aurora-bars", "breath", "column-light", "dawn", "drift-grid", "duotone", "gridfloor", "horizon", "mesh", "orb", "particles", "sphere-top", "splitpanel", "spotlight-cone", "starfield", "underline-grow", "waveform"),
    slots: sectionSlots,
    size: { w: 720, h: 224 },
    surface: "obsidian",
    render(o, h) {
      const at = o.slots.headline[0].at;
      return {
        inner: nextTopic + headline(o, h) + rule,
        timeline: [write(h, ".ks-copy", at), state(h, ".ks-rule", { scaleX: 0 }, { scaleX: 1 }, at)].join("\n"),
      };
    },
    css: base("section-divider") + headingCSS("section-divider") + ruleCSS("section-divider") + `
      .pro-section-divider .ks-rule { width:156px;margin-top:2px;transform-origin:left center; }`,
  },
  "section-rise": {
    variantOf: "section-divider",
    family: "emphasis",
    tags: ["title"],
    hint: sectionHint,
    source: sources("ascend", "depth", "kinetic", "stack"),
    slots: sectionSlots,
    size: { w: 720, h: 208 },
    surface: "obsidian",
    render(o, h) {
      const item = o.slots.headline[0];
      // Use the grounded lines so the text settles in the same place on a direct seek.
      const lines = item.lines.map((line) => line.split(" ").map((word) =>
        `<span class="ks-word">${h.esc(word)}</span>`).join(" ")).join("<br>");
      const fitted = item.fontSize ? ` style="font-size:${item.fontSize}px;line-height:${Math.round(item.fontSize * 1.18)}px"` : "";
      return {
        inner: nextTopic + `<div class="ks-copy"${fitted}>${lines}</div>`,
        timeline: [
          enter(h, ".ks-copy", item.at),
          enter(h, ".ks-word", item.at, { y: 12 }, { y: 0, stagger: { amount: 0.09 } }),
        ].join("\n"),
      };
    },
    css: base("section-rise") + headingCSS("section-rise") + `
      .pro-section-rise { text-align:center; }
      .pro-section-rise .ks-word { display:inline-block;opacity:0; }`,
  },
  "section-trace": {
    variantOf: "section-divider",
    family: "emphasis",
    tags: ["title"],
    hint: sectionHint,
    source: sources("boxed", "eclipse", "halo", "liquid", "monolith", "orbit", "ripple", "tunnel"),
    slots: { headline: spoken(52, 628) },
    size: { w: 720, h: 224 },
    surface: "obsidian",
    render(o, h) {
      const at = o.slots.headline[0].at;
      const frame = `<svg class="ks-frame" viewBox="0 0 720 224" aria-hidden="true"><rect class="ks-draw" x="14" y="12" width="692" height="200" rx="10" pathLength="1"/></svg>`;
      return {
        inner: frame + nextTopic + headline(o, h),
        timeline: [write(h, ".ks-copy", at), draw(h, ".ks-frame .ks-draw", at)].join("\n"),
      };
    },
    css: base("section-trace") + headingCSS("section-trace") + strokeCSS("section-trace") + `
      .pro-section-trace { padding:28px 44px;text-align:center; }
      .pro-section-trace .ks-frame { position:absolute;inset:0;width:100%;height:100%; }`,
  },
  "section-wipe": {
    variantOf: "section-divider",
    family: "emphasis",
    tags: ["title", "highlight"],
    hint: sectionHint,
    source: sources("reveal-mask", "beam", "flare-sweep", "lensflare", "spotlight", "typed", "wordmark"),
    slots: sectionSlots,
    size: { w: 720, h: 208 },
    surface: "obsidian",
    render(o, h) {
      const at = o.slots.headline[0].at;
      return {
        inner: nextTopic + `<div class="ks-window">${headline(o, h)}<span class="ks-caret" aria-hidden="true"></span></div>`,
        timeline: [
          write(h, ".ks-copy", at),
          enter(h, ".ks-caret", at, { left: "0%", opacity: 1 }, { left: "100%", opacity: 0 }),
        ].join("\n"),
      };
    },
    css: base("section-wipe") + headingCSS("section-wipe") + `
      .pro-section-wipe .ks-window { position:relative;width:max-content;max-width:100%; }
      .pro-section-wipe .ks-caret { position:absolute;top:0;bottom:0;left:0;width:4px;background:#C8A24B;opacity:0; }`,
  },
  "section-aperture": {
    variantOf: "section-divider",
    family: "emphasis",
    tags: ["title"],
    hint: sectionHint,
    source: sources("split-reveal", "curtain", "portal"),
    slots: sectionSlots,
    size: { w: 720, h: 208 },
    surface: "obsidian",
    render(o, h) {
      const at = o.slots.headline[0].at;
      // The middle seam parts in both directions while a single copy stays in place.
      return { inner: nextTopic + headline(o, h), timeline: write(h, ".ks-copy", at, "inset(50% 0 50% 0)") };
    },
    css: base("section-aperture") + headingCSS("section-aperture") + `
      .pro-section-aperture { text-align:center; }
      .pro-section-aperture .ks-copy { clip-path:inset(50% 0 50% 0); }`,
  },
  "section-ribbon": {
    variantOf: "section-divider",
    family: "emphasis",
    tags: ["title"],
    hint: sectionHint,
    source: sources("ribbon", "chaptercard", "pill", "slab"),
    slots: sectionSlots,
    size: { w: 720, h: 224 },
    surface: "obsidian",
    render(o, h) {
      const at = o.slots.headline[0].at;
      return {
        inner: nextTopic + `<div class="ks-band">${headline(o, h)}</div>`,
        timeline: [
          write(h, ".ks-copy", at),
          state(h, ".ks-band", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }, at),
        ].join("\n"),
      };
    },
    css: base("section-ribbon") + headingCSS("section-ribbon") + `
      .pro-section-ribbon { padding:18px 0; }
      .pro-section-ribbon .ks-heading { padding:0 32px; }
      .pro-section-ribbon .ks-band { padding:10px 32px;color:#0B0B0D;background:#C8A24B;clip-path:inset(0 100% 0 0); }`,
  },
  "section-footer": {
    variantOf: "section-divider",
    family: "emphasis",
    tags: ["title"],
    hint: sectionHint,
    source: sources("glow-rule", "type-scale"),
    slots: sectionSlots,
    size: { w: 720, h: 224 },
    surface: "obsidian",
    render(o, h) {
      const at = o.slots.headline[0].at;
      return {
        inner: headline(o, h) + rule + nextTopic,
        timeline: [
          enter(h, ".ks-copy", at, { scale: 0.97 }, { scale: 1 }),
          state(h, ".ks-rule", { scaleX: 0 }, { scaleX: 1 }, at),
        ].join("\n"),
      };
    },
    css: base("section-footer") + headingCSS("section-footer") + ruleCSS("section-footer") + `
      .pro-section-footer { text-align:center; }
      .pro-section-footer .ks-rule { width:100%;transform-origin:center; }`,
  },
  "section-node": {
    variantOf: "section-divider",
    family: "emphasis",
    tags: ["title", "flow"],
    hint: sectionHint,
    source: sources("node-title", "constellation"),
    slots: { headline: spoken(46, 518) },
    size: { w: 720, h: 208 },
    surface: "obsidian",
    render(o, h) {
      const at = o.slots.headline[0].at;
      const link = `<svg class="ks-link" viewBox="0 0 124 48" aria-hidden="true"><circle class="ks-node" cx="24" cy="24" r="16"/><path class="ks-draw" pathLength="1" d="M40 24H122"/></svg>`;
      return {
        inner: link + `<div class="ks-topic">${nextTopic}${headline(o, h)}</div>`,
        timeline: [draw(h, ".ks-link .ks-draw", at), write(h, ".ks-copy", at)].join("\n"),
      };
    },
    css: base("section-node") + headingCSS("section-node") + strokeCSS("section-node") + `
      .pro-section-node { display:grid;grid-template-columns:124px minmax(0,1fr);align-items:center;gap:12px; }
      .pro-section-node .ks-link { width:124px;height:48px; }
      .pro-section-node .ks-node { fill:#0B0B0D;stroke:#C8A24B;stroke-width:3; }
      .pro-section-node .ks-topic { display:flex;flex-direction:column;gap:8px; }`,
  },
  "section-number": {
    family: "emphasis",
    tags: ["title", "number"],
    hint: chapterHint,
    source: sources("index"),
    slots: { ...chapterSlots, headline: spoken(38, 232, 54, 3) },
    size: { w: 720, h: 240 },
    surface: "obsidian",
    render(o, h) {
      return {
        inner: `<div class="ks-index">${sectionLabel}${number(o, h)}</div>${rule}${headline(o, h)}`,
        timeline: [
          write(h, ".ks-number", o.slots.number[0].at),
          state(h, ".ks-rule", { scaleY: 0 }, { scaleY: 1 }, o.slots.number[0].at),
          write(h, ".ks-copy", o.slots.headline[0].at),
        ].join("\n"),
      };
    },
    css: base("section-number") + headingCSS("section-number") + ruleCSS("section-number") + numberCSS("section-number") + `
      .pro-section-number { display:grid;grid-template-columns:minmax(148px,max-content) 4px minmax(0,1fr);align-items:center;gap:12px; }
      .pro-section-number .ks-index { max-width:396px;text-align:center; }
      .pro-section-number .ks-number { padding-right:4px; }
      .pro-section-number .ks-rule { width:4px;height:168px;transform:scaleY(0);transform-origin:center top; }`,
  },
  "chapter-count-ring": {
    variantOf: "section-number",
    family: "emphasis",
    tags: ["title", "number"],
    hint: chapterHint,
    source: sources("countdown"),
    slots: chapterSlots,
    size: { w: 720, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const ring = `<svg viewBox="0 0 472 144" aria-hidden="true"><rect class="ks-draw" x="4" y="4" width="464" height="136" rx="68" pathLength="1"/></svg>`;
      // The moving rim gives the number its own beat without displaying intermediate values.
      return {
        inner: `<div class="ks-counter">${ring}${number(o, h)}</div>${headline(o, h)}`,
        timeline: [
          write(h, ".ks-number", o.slots.number[0].at),
          draw(h, ".ks-counter .ks-draw", o.slots.number[0].at),
          write(h, ".ks-copy", o.slots.headline[0].at),
        ].join("\n"),
      };
    },
    css: base("chapter-count-ring") + strokeCSS("chapter-count-ring") + numberCSS("chapter-count-ring") + `
      .pro-chapter-count-ring { align-items:center;text-align:center; }
      .pro-chapter-count-ring .ks-counter { position:relative;display:grid;place-items:center;width:472px;height:144px;flex:none; }
      .pro-chapter-count-ring .ks-counter svg { position:absolute;inset:0;width:100%;height:100%; }`,
  },
  "chapter-watermark": {
    variantOf: "section-number",
    family: "emphasis",
    tags: ["title", "number"],
    hint: chapterHint,
    source: sources("numeral"),
    slots: { ...chapterSlots, number: { ...indexNumber, size: 108, width: 448 } },
    size: { w: 720, h: 296 },
    surface: "obsidian",
    render(o, h) {
      return {
        inner: `<div class="ks-masthead">${sectionLabel}${number(o, h)}</div>${headline(o, h)}`,
        timeline: [
          enter(h, ".ks-number", o.slots.number[0].at, { y: 12 }, { y: 0 }),
          write(h, ".ks-copy", o.slots.headline[0].at),
        ].join("\n"),
      };
    },
    css: base("chapter-watermark") + headingCSS("chapter-watermark") + numberCSS("chapter-watermark") + `
      .pro-chapter-watermark .ks-masthead { display:flex;align-items:end;justify-content:space-between;min-height:124px; }
      .pro-chapter-watermark .ks-heading { border-top:3px solid #C8A24B;padding-top:8px; }
      .pro-chapter-watermark .ks-number { font-size:108px;line-height:124px;color:#0B0B0D;-webkit-text-stroke:2px #A8A49C; }`,
  },
  "term-lead-title": {
    family: "emphasis",
    tags: ["title", "definition"],
    hint: termHint,
    source: sources("gradient-word"),
    slots: {
      term: {
        ...spoken(16, 648, 88, 1),
        validate: (text) => /^(?:\p{L}+(?:[-’']\p{L}+)*)(?: \p{L}+(?:[-’']\p{L}+)*)?[.,:]?$/u.test(text),
      },
      headline: spoken(52),
    },
    size: { w: 720, h: 280 },
    surface: "obsidian",
    render(o, h) {
      return {
        inner: term(o, h) + headline(o, h),
        timeline: [write(h, ".ks-term", o.slots.term[0].at), write(h, ".ks-copy", o.slots.headline[0].at)].join("\n"),
      };
    },
    css: base("term-lead-title") + `
      .pro-term-lead-title .ks-term { color:#C8A24B;font:400 88px/104px "Anton",sans-serif;opacity:0; }`,
  },
  "term-badge-title": {
    variantOf: "term-lead-title",
    family: "emphasis",
    tags: ["title", "definition"],
    hint: termHint,
    source: sources("emblem"),
    slots: {
      term: { ...spoken(3, 124, 54, 1), validate: (text) => /^[A-Z]{2,3}$/.test(text) },
      headline: spoken(52),
    },
    size: { w: 720, h: 276 },
    surface: "obsidian",
    render(o, h) {
      return {
        inner: term(o, h) + headline(o, h),
        timeline: [
          enter(h, ".ks-term", o.slots.term[0].at, { y: -12 }, { y: 0 }),
          write(h, ".ks-copy", o.slots.headline[0].at),
        ].join("\n"),
      };
    },
    css: base("term-badge-title") + `
      .pro-term-badge-title { align-items:center;text-align:center; }
      .pro-term-badge-title .ks-term { display:grid;place-items:center;width:144px;height:96px;flex:none;border-radius:48px;background:#C8A24B;color:#0B0B0D;font:400 54px/62px "Anton",sans-serif;opacity:0; }`,
  },
  "lesson-question": {
    family: "emphasis",
    tags: ["title", "question"],
    hint: "Greg asks the viewer a short question that he is about to answer with a lesson; quote the question he asks the viewer",
    source: sources("question"),
    slots: sectionSlots,
    size: { w: 720, h: 256 },
    surface: "obsidian",
    render(o, h) {
      const glyph = `<svg class="ks-question" viewBox="0 0 40 44" aria-hidden="true"><path d="M9 12a11 10 0 1 1 18 8c-5 4-7 5-7 11"/><circle cx="20" cy="40" r="3"/></svg>`;
      return {
        inner: glyph + headline(o, h) + `<div class="ks-heading">Key question</div>`,
        timeline: write(h, ".ks-copy", o.slots.headline[0].at),
      };
    },
    css: base("lesson-question") + headingCSS("lesson-question") + `
      .pro-lesson-question { align-items:center;text-align:center; }
      .pro-lesson-question .ks-question { width:40px;height:40px;flex:none; }
      .pro-lesson-question .ks-question path { fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round; }
      .pro-lesson-question .ks-question circle { fill:#C8A24B; }`,
  },
  "section-title-strips": {
    family: "emphasis",
    tags: ["title"],
    hint: "Greg announces one teaching topic in two or three short phrases; split its exact title into adjacent spoken ranges",
    source: sources("stacked-words"),
    slots: { lines: { ...spoken(34, 628, 54, 1), repeat: [2, 3] } },
    size: (o) => ({ w: 720, h: 80 * o.slots.lines.length + 8 }),
    surface: "bare",
    render(o, h) {
      const inner = o.slots.lines.map((item, i) =>
        `<div class="ks-strip ks-strip-${i}"><div class="ks-copy">${h.copy(item)}</div></div>`).join("");
      const timeline = o.slots.lines.flatMap((item, i) => [
        enter(h, `.ks-strip-${i}`, item.at, { x: i % 2 ? 16 : -16 }, { x: 0 }),
        write(h, `.ks-strip-${i} .ks-copy`, item.at),
      ]).join("\n");
      return { inner, timeline };
    },
    css: base("section-title-strips") + `
      .pro-section-title-strips { justify-content:flex-start;padding:8px 16px;background:none;overflow:hidden; }
      .pro-section-title-strips .ks-strip { display:flex;align-items:center;height:72px;flex:none;padding:4px 24px;border-left:4px solid #C8A24B;border-radius:8px;background:#0B0B0D;opacity:0; }
      .pro-section-title-strips .ks-strip:nth-child(even) { border-left:0;border-right:4px solid #C8A24B;text-align:right;justify-content:flex-end; }`,
  },
};
