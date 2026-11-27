// Adapted from the Herk Edit Kit (MIT License, copyright 2026 Nate Herk). See src/pro-cards/HERK-LICENSE.md.

const source = (...ids) => `herk:${ids.map((id) => `vox-explainer.t1.${id}`).join(",")}`;

// Match proTextLines' widths at the design size to prevent groundCard's smaller fallback.
// The registry loads this module before pro.mjs, so the check cannot import through it.
function fitsAtSize(text, { width, size, maxLines }) {
  const measure = (word) => [...word].reduce((sum, char) => sum +
    (char === " " ? 0.3 : /[ilI.,!'’]/.test(char) ? 0.32 : /[MW@]/.test(char) ? 0.95 : /[A-Z]/.test(char) ? 0.75 : 0.65) * size, 0);
  let lines = 0;
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (measure(word) > width) return false;
    if (line && measure(`${line} ${word}`) <= width) line += ` ${word}`;
    else {
      line = word;
      lines++;
    }
  }
  return lines > 0 && lines <= maxLines;
}

function spoken(maxChars, width, size = 40, maxLines = 2, check = () => true) {
  const fit = { width, size, maxLines };
  return { kind: "spoken", maxChars, ...fit, validate: (text, slots) => check(text, slots) && fitsAtSize(text, fit) };
}

const repeated = (slot, min, max) => ({ ...slot, repeat: [min, max] });
const optional = (slot) => ({ ...slot, optional: true });

function tween(h, selector, from, to, at, state = false) {
  const duration = state ? h.motion.state : h.motion.enter;
  const ease = state ? "proState" : "proEnter";
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${duration},ease:${ease},immediateRender:false},${at});`;
}

function write(h, selector, at, vertical = false) {
  return tween(h, selector, { opacity: 0, clipPath: vertical ? "inset(100% 0 0 0)" : "inset(0 100% 0 0)" },
    { opacity: 1, clipPath: "inset(0 0 0 0)" }, at);
}

const draw = (h, selector, at) => tween(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at, true);
const sweep = (h, selector, at) => tween(h, selector, { scaleX: 0 }, { scaleX: 1 }, at, true);
const fade = (h, selector, at) => tween(h, selector, { opacity: 1 }, { opacity: 0 }, at, true);
const activeFill = `<div class="vo-active" aria-hidden="true"></div>`;
const copyCSS = (type, size = 40, line = 48) => `
      .pro-${type} .vo-copy { font:700 ${size}px/${line}px "Inter",sans-serif;opacity:0; }`;

const chapterOrdinal = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)[.,:!?]?$/i;
const slateHint = "Greg explicitly introduces the next sales topic or drill with a self-contained spoken headline before he starts teaching it";
const agendaHint = "Greg explicitly previews three or four distinct topics he is about to teach; use the short names he actually says in preview order";
const noteSlots = { title: spoken(38, 616, 48), detail: spoken(52, 616) };
const noteHint = "Greg states a short sales lesson and immediately adds a specific consequence or instruction that clarifies it";
const threeRows = ["one", "two", "three"];
const outlineSlots = Object.fromEntries(threeRows.flatMap((n) => [
  [n, spoken(24, 568, 44, 1)], [`${n}Detail`, spoken(43, 568)],
]));
const outlineHint = "Greg names exactly three parts or phases of one method and follows each name with its own brief spoken explanation";
const milestoneHint = "Greg names exactly three relative times and the milestone at each, giving each time before its event; quote times such as week one and next month";
// The same slots as session-agenda (time1, topic1, ...): these designs are drawn for that type, which another lane
// built from the Kallaway timeline cards (Claude merged the lanes, 2026-11-27).
const milestoneSlots = (timeWidth, eventWidth) => Object.fromEntries(threeRows.flatMap((name, i) => [
  [`time${i + 1}`, spoken(18, timeWidth, 40, 2, isRelativeTime)], [`topic${i + 1}`, spoken(26, eventWidth, 42)],
]));
const milestones = (o) => threeRows.map((name, i) => ({ time: o.slots[`time${i + 1}`][0], event: o.slots[`topic${i + 1}`][0] }));

function outline(o, h, banded) {
  const rows = threeRows.map((name, i) => ({ i, title: o.slots[name][0], detail: o.slots[`${name}Detail`][0] }));
  const inner = rows.map(({ i, title, detail }) => `<div class="vo-row vo-row-${i}">${banded ? activeFill : ""}<div class="vo-copy vo-title">${h.copy(title)}</div><div class="vo-copy vo-detail">${h.copy(detail)}</div></div>`).join("");
  const timeline = rows.flatMap(({ i, title, detail }) => {
    const row = `.vo-row-${i}`;
    return [
      write(h, `${row} .vo-title`, title.at),
      ...(banded ? [
        sweep(h, `${row} .vo-active`, title.at),
        ...(i ? [fade(h, `.vo-row-${i - 1} .vo-active`, title.at)] : []),
      ] : []),
      write(h, `${row} .vo-detail`, detail.at),
    ];
  }).join("\n");
  return { inner, timeline };
}

const outlineCSS = (type) => `
      .pro-${type} { display:grid;grid-template-rows:repeat(3,1fr);gap:6px;padding:18px 24px; }
      .pro-${type} .vo-row { min-width:0;display:grid;grid-template-rows:50px 96px;align-content:center; }
      .pro-${type} .vo-title { font:800 44px/50px "Inter",sans-serif;opacity:0; }
      .pro-${type} .vo-detail { font:600 40px/48px "Inter",sans-serif;opacity:0; }`;

export const CARDS = {
  "stacked-title": {
    family: "emphasis",
    tags: ["title", "highlight"],
    hint: "Greg delivers one teaching headline in three or four short consecutive fragments that build to a decisive final phrase",
    source: source("section.markerbox", "section.stacked"),
    slots: { lines: repeated(spoken(18, 584, 48, 1), 3, 4) },
    size: (o) => ({ w: 720, h: 44 + 68 * o.slots.lines.length }),
    surface: "obsidian",
    render(o, h) {
      const inner = o.slots.lines.map((item, i) => `<div class="vo-line vo-line-${i}"><div class="vo-fill" aria-hidden="true"></div><div class="vo-copy">${h.copy(item)}</div></div>`).join("");
      const timeline = o.slots.lines.flatMap((item, i) => [
        tween(h, `.vo-line-${i} .vo-fill`, { scaleX: 0 }, { scaleX: 1 }, item.at),
        write(h, `.vo-line-${i} .vo-copy`, item.at, true),
      ]).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-stacked-title { display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:8px;padding:24px 32px; }
      .pro-stacked-title .vo-line { position:relative;width:max-content;max-width:100%;padding:3px 16px; }
      .pro-stacked-title .vo-fill { position:absolute;inset:0;background:#343438;transform:scaleX(0);transform-origin:left; }
      .pro-stacked-title .vo-line:last-child .vo-fill { background:#C8A24B; }
      .pro-stacked-title .vo-line:last-child .vo-copy { color:#0B0B0D; }
      .pro-stacked-title .vo-copy { position:relative;font:400 48px/54px "Anton",sans-serif;opacity:0; }`,
  },
  "chapter-screen": {
    family: "emphasis",
    tags: ["title"],
    hint: slateHint,
    source: source("section.crt"),
    slots: { headline: spoken(40, 600, 52) },
    size: { w: 720, h: 208 },
    surface: "obsidian",
    render(o, h) {
      const [item] = o.slots.headline;
      const inner = `<div class="vo-screen"><div class="vo-scan" aria-hidden="true"></div><div class="vo-copy">${h.copy(item)}</div></div>`;
      const timeline = [write(h, ".vo-copy", item.at, true),
        tween(h, ".vo-screen", { clipPath: "inset(49% 0 49% 0)" }, { clipPath: "inset(0 0 0 0)" }, item.at),
        tween(h, ".vo-scan", { scaleX: 0, opacity: 1 }, { scaleX: 1, opacity: 0 }, item.at, true),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-chapter-screen { padding:16px;border:4px solid #343438;border-radius:18px; }
      .pro-chapter-screen .vo-screen { position:relative;height:100%;display:grid;place-items:center;padding:12px 32px;background:#343438;text-align:center;clip-path:inset(49% 0 49% 0); }
      .pro-chapter-screen .vo-scan { position:absolute;top:50%;left:0;width:100%;height:3px;background:#C8A24B;transform:scaleX(0); }
      .pro-chapter-screen .vo-copy { position:relative;font:400 52px/62px "Anton",sans-serif;opacity:0; }`,
  },
  "tabbed-note": {
    family: "payoff",
    tags: ["callout", "title"],
    hint: noteHint,
    source: source("section.indexcard"),
    slots: noteSlots,
    size: { w: 720, h: 296 },
    surface: "bone",
    render(o, h) {
      const { title: [title], detail: [detail] } = o.slots;
      const inner = `<div class="vo-tab">Coaching note</div><div class="vo-copy vo-title">${h.copy(title)}</div><div class="vo-copy vo-detail">${h.copy(detail)}</div>`;
      const timeline = [
        tween(h, ".vo-tab", { y: 14, opacity: 0 }, { y: 0, opacity: 1 }, title.at),
        write(h, ".vo-title", title.at, true), write(h, ".vo-detail", detail.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-tabbed-note { padding:56px 32px 18px 52px;border-radius:4px; }
      .pro-tabbed-note::before { content:"";position:absolute;top:0;bottom:0;left:32px;width:3px;background:#C8A24B; }
      .pro-tabbed-note .vo-tab { position:absolute;top:0;left:52px;padding:6px 14px;background:#C8A24B;color:#0B0B0D;font:800 28px/32px "Inter",sans-serif;opacity:0; }
      ${copyCSS("tabbed-note")}
      .pro-tabbed-note .vo-title { font:400 48px/56px "Anton",sans-serif; }
      .pro-tabbed-note .vo-detail { margin-top:8px; }`,
  },
  "headline-strap": {
    variantOf: "tabbed-note",
    family: "payoff",
    tags: ["callout", "title"],
    hint: noteHint,
    source: source("section.ticker"),
    slots: noteSlots,
    size: { w: 720, h: 264 },
    surface: "obsidian",
    render(o, h) {
      const { title: [title], detail: [detail] } = o.slots;
      const inner = `<div class="vo-copy vo-title">${h.copy(title)}</div><div class="vo-strap"><div class="vo-copy">${h.copy(detail)}</div></div>`;
      const timeline = [write(h, ".vo-title", title.at),
        tween(h, ".vo-strap", { y: 16, clipPath: "inset(100% 0 0 0)" }, { y: 0, clipPath: "inset(0 0 0 0)" }, detail.at),
        write(h, ".vo-strap .vo-copy", detail.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-headline-strap { padding:0;display:grid;grid-template-rows:1fr 116px; }
      ${copyCSS("headline-strap")}
      .pro-headline-strap .vo-title { align-self:center;padding:0 32px;font:400 48px/56px "Anton",sans-serif; }
      .pro-headline-strap .vo-strap { display:flex;align-items:center;padding:8px 32px;background:#C8A24B;color:#0B0B0D;clip-path:inset(100% 0 0 0); }`,
  },
  "chapter-number": {
    family: "emphasis",
    tags: ["title", "number"],
    hint: "Greg explicitly says a short chapter or step number and then its topic; quote the ordinal or count by itself before the topic",
    source: source("section.numeral"),
    slots: { number: spoken(12, 640, 96, 1, isChapterNumber), headline: spoken(42, 640, 46) },
    size: { w: 720, h: 284 },
    surface: "obsidian",
    render(o, h) {
      const { number: [number], headline: [headline] } = o.slots;
      const inner = `<div class="vo-copy vo-number">${h.copy(number)}</div><div class="vo-copy vo-headline">${h.copy(headline)}</div><svg class="vo-rule" viewBox="0 0 160 8" aria-hidden="true"><path pathLength="1" d="M2 4h156"/></svg>`;
      const timeline = [write(h, ".vo-number", number.at), write(h, ".vo-headline", headline.at, true), draw(h, ".vo-rule path", headline.at)].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-chapter-number { padding:16px 32px;display:grid;grid-template-rows:108px 108px 8px;align-content:center;gap:8px; }
      .pro-chapter-number .vo-number { justify-self:end;color:#C8A24B;font:400 96px/108px "Anton",sans-serif;opacity:0; }
      ${copyCSS("chapter-number", 46, 54)}
      .pro-chapter-number .vo-headline { align-self:end; }
      .pro-chapter-number .vo-rule { display:block;width:160px;height:8px;fill:none;stroke:#C8A24B;stroke-width:4;stroke-dasharray:1;stroke-dashoffset:1; }`,
  },
  "bracket-slate": {
    variantOf: "chapter-screen",
    family: "emphasis",
    tags: ["highlight", "title"],
    hint: slateHint,
    source: source("section.bracket"),
    slots: { headline: spoken(40, 532, 48) },
    size: { w: 720, h: 236 },
    surface: "obsidian",
    render(o, h) {
      const [item] = o.slots.headline;
      const bracket = (side, d) => `<svg class="vo-bracket vo-${side}" viewBox="0 0 32 156" aria-hidden="true"><path d="${d}"/></svg>`;
      const inner = bracket("left", "M28 4H4v148h24") + bracket("right", "M4 4h24v148H4") +
        `<div class="vo-copy">${h.copy(item)}</div><div class="vo-line" aria-hidden="true"></div>`;
      const timeline = [write(h, ".vo-copy", item.at, true),
        tween(h, ".vo-left", { opacity: 0, x: -16 }, { opacity: 1, x: 0 }, item.at),
        tween(h, ".vo-right", { opacity: 0, x: 16 }, { opacity: 1, x: 0 }, item.at),
        sweep(h, ".vo-line", item.at),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-bracket-slate { display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:10px;padding:20px 86px; }
      .pro-bracket-slate .vo-bracket { position:absolute;top:40px;width:32px;height:156px;fill:none;stroke:#C8A24B;stroke-width:5;opacity:0; }
      .pro-bracket-slate .vo-left { left:34px; }
      .pro-bracket-slate .vo-right { right:34px; }
      .pro-bracket-slate .vo-line { width:104px;height:3px;background:#C8A24B;transform:scaleX(0); }
      ${copyCSS("bracket-slate", 48, 56)}`,
  },
  "location-pin": {
    family: "emphasis",
    tags: ["title", "callout"],
    hint: "Greg names the place where a specific real sales example happened, then states what happened there",
    source: source("section.map"),
    slots: { place: spoken(22, 444, 40, 1), event: spoken(53, 640, 46) },
    size: { w: 720, h: 236 },
    surface: "obsidian",
    render(o, h) {
      const { place: [place], event: [event] } = o.slots;
      // A locator gives the place a visual anchor without drawing unsupported geography.
      const pin = `<svg viewBox="0 0 64 64" aria-hidden="true"><path class="vo-reticle" pathLength="1" d="M20 5H5v15m39-15h15v15M5 44v15h15m39-15v15H44"/><path d="M32 51C27 44 19 36 19 28a13 13 0 0 1 26 0c0 8-8 16-13 23Z"/><circle cx="32" cy="28" r="4"/></svg>`;
      const inner = `<div class="vo-location">${pin}<div class="vo-copy vo-place">${h.copy(place)}</div></div><div class="vo-copy vo-event">${h.copy(event)}</div>`;
      const timeline = [write(h, ".vo-place", place.at), draw(h, ".vo-reticle", place.at), write(h, ".vo-event", event.at, true)].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-location-pin { display:flex;flex-direction:column;justify-content:center;gap:12px; }
      .pro-location-pin .vo-location { display:flex;align-items:center;gap:16px;color:#C8A24B; }
      .pro-location-pin .vo-location svg { width:48px;height:48px;flex:none;fill:none;stroke:#C8A24B;stroke-width:3; }
      .pro-location-pin .vo-reticle { stroke-dasharray:1;stroke-dashoffset:1; }
      ${copyCSS("location-pin")}
      .pro-location-pin .vo-event { font-size:46px;line-height:54px; }`,
  },
  "phrase-sweep": {
    family: "payoff",
    tags: ["highlight", "callout"],
    hint: "Greg lands a short lesson where one explicitly spoken phrase carries the point; quote its immediate setup, mark the focus and quote an adjacent ending only if needed",
    source: source("section.highlight", "section.collage", "section.tornstrip"),
    slots: { before: spoken(27, 620, 44, 1), focus: spoken(23, 576, 48, 1), after: optional(spoken(27, 620, 44, 1)) },
    size: (o) => ({ w: 720, h: 184 + 56 * o.slots.after.length }),
    surface: "obsidian",
    render(o, h) {
      const { before: [before], focus: [focus], after: [after] } = o.slots;
      const inner = `<div class="vo-copy vo-before">${h.copy(before)}</div><div class="vo-focus"><div class="vo-marker" aria-hidden="true"></div><div class="vo-copy">${h.copy(focus)}</div></div>${after ? `<div class="vo-copy vo-after">${h.copy(after)}</div>` : ""}`;
      const timeline = [write(h, ".vo-before", before.at), tween(h, ".vo-marker", { scaleX: 0 }, { scaleX: 1 }, focus.at),
        write(h, ".vo-focus .vo-copy", focus.at), after && write(h, ".vo-after", after.at)].filter(Boolean).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-phrase-sweep { display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px; }
      ${copyCSS("phrase-sweep", 44, 50)}
      .pro-phrase-sweep .vo-focus { position:relative;width:max-content;max-width:100%;padding:4px 10px; }
      .pro-phrase-sweep .vo-marker { position:absolute;inset:0;background:#C8A24B;transform:scaleX(0);transform-origin:left; }
      .pro-phrase-sweep .vo-focus .vo-copy { position:relative;color:#0B0B0D;font:400 48px/56px "Anton",sans-serif; }`,
  },
  "agenda-bands": {
    family: "procedure",
    tags: ["list", "title"],
    hint: agendaHint,
    source: source("overview.agenda-bars", "overview.big-type", "overview.dossier"),
    slots: { topics: repeated(spoken(24, 608, 44, 1), 3, 4) },
    size: (o) => ({ w: 720, h: 38 + 64 * o.slots.topics.length }),
    surface: "obsidian",
    render(o, h) {
      const items = o.slots.topics;
      const inner = items.map((item, i) => `<div class="vo-band vo-band-${i}"><div class="vo-fill" aria-hidden="true"></div><div class="vo-copy">${h.copy(item)}</div></div>`).join("");
      const timeline = items.flatMap((item, i) => {
        const row = `.vo-band-${i}`;
        return [write(h, `${row} .vo-copy`, item.at), sweep(h, `${row} .vo-fill`, item.at),
          ...(i ? [tween(h, `.vo-band-${i - 1} .vo-fill`, { borderLeftColor: "#C8A24B" }, { borderLeftColor: "#A8A49C" }, item.at, true)] : [])];
      }).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-agenda-bands { display:flex;flex-direction:column;justify-content:center;gap:6px;padding:18px 32px; }
      .pro-agenda-bands .vo-band { position:relative;padding:3px 18px;min-height:58px;border-left:4px solid #343438; }
      .pro-agenda-bands .vo-fill { position:absolute;inset:0;background:#343438;border-left:8px solid #C8A24B;transform:scaleX(0);transform-origin:left; }
      .pro-agenda-bands .vo-copy { position:relative;font:400 44px/52px "Anton",sans-serif;opacity:0; }`,
  },
  "three-part-method": {
    family: "procedure",
    tags: ["list"],
    hint: outlineHint,
    source: source("overview.outline", "overview.numbered-list"),
    slots: outlineSlots,
    size: { w: 720, h: 512 },
    surface: "obsidian",
    render: (o, h) => outline(o, h, false),
    css: `
      ${outlineCSS("three-part-method")}
      .pro-three-part-method .vo-row { padding:0 16px 0 32px;border-bottom:2px solid #343438; }
      .pro-three-part-method .vo-title { color:#C8A24B; }
      .pro-three-part-method .vo-detail { margin-left:24px;color:#F5F1E8; }`,
  },
  "phase-bands": {
    variantOf: "three-part-method",
    family: "procedure",
    tags: ["list", "steps"],
    hint: outlineHint,
    source: source("overview.phases"),
    slots: outlineSlots,
    size: { w: 720, h: 520 },
    surface: "obsidian",
    render: (o, h) => outline(o, h, true),
    css: `
      ${outlineCSS("phase-bands")}
      .pro-phase-bands .vo-row { position:relative;padding:0 22px;border:2px solid #343438;background:#0B0B0D; }
      .pro-phase-bands .vo-active { position:absolute;inset:0;background:#343438;border-left:8px solid #C8A24B;transform:scaleX(0);transform-origin:left; }
      .pro-phase-bands .vo-copy { position:relative; }
      .pro-phase-bands .vo-detail { color:#F5F1E8; }`,
  },
  "quadrant-notes": {
    family: "procedure",
    tags: ["list"],
    hint: "Greg names four parallel parts of the same coaching framework and gives each a very short description immediately after its name",
    source: source("overview.quad"),
    slots: Object.fromEntries(["one", "two", "three", "four"].flatMap((n) => [
      [n, spoken(16, 294, 44)], [`${n}Detail`, spoken(24, 294)],
    ])),
    size: { w: 720, h: 496 },
    surface: "obsidian",
    render(o, h) {
      const cells = ["one", "two", "three", "four"].map((name) => ({ name, title: o.slots[name][0], detail: o.slots[`${name}Detail`][0] }));
      const inner = cells.map(({ name, title, detail }) => `<div class="vo-cell vo-${name}"><div class="vo-copy vo-title">${h.copy(title)}</div><div class="vo-copy vo-detail">${h.copy(detail)}</div></div>`).join("");
      const timeline = cells.flatMap(({ name, title, detail }) => [
        write(h, `.vo-${name} .vo-title`, title.at),
        tween(h, `.vo-${name}`, { borderTopColor: "#343438" }, { borderTopColor: "#C8A24B" }, title.at, true),
        write(h, `.vo-${name} .vo-detail`, detail.at),
      ]).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-quadrant-notes { padding:16px 24px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,1fr);gap:8px; }
      .pro-quadrant-notes .vo-cell { padding:10px 16px;border:2px solid #343438;border-top-width:4px;display:grid;grid-template-rows:100px 96px;align-content:center; }
      .pro-quadrant-notes .vo-title { font:400 44px/50px "Anton",sans-serif;align-self:end;opacity:0; }
      .pro-quadrant-notes .vo-detail { font:600 40px/48px "Inter",sans-serif;color:#A8A49C;opacity:0; }`,
  },
  "six-topic-grid": {
    family: "procedure",
    tags: ["list"],
    hint: "Greg explicitly lists six short elements of one method, all at the same level with no ranking or individual explanations",
    source: source("overview.grid6"),
    slots: { items: repeated(spoken(22, 288, 42), 6, 6) },
    size: { w: 720, h: 400 },
    surface: "obsidian",
    render(o, h) {
      const items = o.slots.items;
      const inner = items.map((item, i) => `<div class="vo-cell vo-cell-${i}">${activeFill}<div class="vo-copy">${h.copy(item)}</div></div>`).join("");
      const timeline = items.flatMap((item, i) => {
        const cell = `.vo-cell-${i}`;
        // Wipe and fade separate properties so a fast handoff seeks the same in both directions.
        return [write(h, `${cell} .vo-copy`, item.at),
          sweep(h, `${cell} .vo-active`, item.at),
          ...(i ? [fade(h, `.vo-cell-${i - 1} .vo-active`, item.at)] : [])];
      }).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-six-topic-grid { padding:14px 24px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(3,1fr);gap:8px; }
      .pro-six-topic-grid .vo-cell { position:relative;border:2px solid #343438;display:flex;align-items:center;padding:7px 16px; }
      .pro-six-topic-grid .vo-active { position:absolute;inset:0;background:#343438;border:4px solid #C8A24B;transform:scaleX(0);transform-origin:left; }
      ${copyCSS("six-topic-grid", 42, 50)}
      .pro-six-topic-grid .vo-copy { position:relative; }`,
  },
  "deck-draw": {
    variantOf: "agenda-bands",
    family: "procedure",
    tags: ["list"],
    hint: agendaHint,
    source: source("overview.card-deck", "overview.index-cards"),
    slots: { topics: repeated(spoken(24, 548, 44), 3, 4) },
    size: { w: 720, h: 208 },
    surface: "obsidian",
    render(o, h) {
      // Each new front card covers the last copy while keeping the earlier card edges in view.
      const items = o.slots.topics;
      const inner = items.map((item, i) => `<div class="vo-sheet vo-sheet-${i}" style="left:${36 + 10 * i}px;top:${18 + 10 * i}px"><div class="vo-copy">${h.copy(item)}</div></div>`).join("");
      const timeline = items.flatMap((item, i) => [
        tween(h, `.vo-sheet-${i}`, { opacity: 0, x: 16 }, { opacity: 1, x: 0 }, item.at),
        write(h, `.vo-sheet-${i} .vo-copy`, item.at),
      ]).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-deck-draw { padding:0; }
      .pro-deck-draw .vo-sheet { position:absolute;width:612px;height:144px;display:flex;align-items:center;padding:12px 28px;background:#0B0B0D;border:3px solid #C8A24B;border-radius:8px;opacity:0; }
      .pro-deck-draw .vo-copy { width:100%;font:800 44px/52px "Inter",sans-serif;opacity:0; }`,
  },
  "milestone-timeline": {
    variantOf: "session-agenda",
    family: "procedure",
    tags: ["timeline", "steps"],
    hint: milestoneHint,
    source: source("overview.vertical-timeline"),
    slots: milestoneSlots(180, 380),
    size: { w: 720, h: 342 },
    surface: "obsidian",
    render(o, h) {
      const rows = milestones(o);
      const links = rows.slice(1).map((_, i) => `<path class="vo-link-${i}" pathLength="1" d="M22 ${51 + i * 102}v102"/>`).join("");
      const diamond = `<svg viewBox="0 0 44 44" aria-hidden="true"><path d="m22 6 16 16-16 16L6 22Z"/></svg>`;
      const nodes = rows.map(({ time, event }, i) => `<div class="vo-row vo-row-${i}"><div class="vo-copy vo-time">${h.copy(time)}</div>${diamond}<div class="vo-copy vo-event">${h.copy(event)}</div></div>`).join("");
      const inner = `<div class="vo-spine"><svg class="vo-links" viewBox="0 0 44 306" aria-hidden="true">${links}</svg>${nodes}</div>`;
      const timeline = rows.flatMap(({ time, event }, i) => [
        write(h, `.vo-row-${i} .vo-time`, time.at),
        tween(h, `.vo-row-${i} svg`, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1 }, time.at),
        ...(i ? [draw(h, `.vo-link-${i - 1}`, time.at)] : []),
        write(h, `.vo-row-${i} .vo-event`, event.at),
      ]).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-milestone-timeline { padding:18px 32px; }
      .pro-milestone-timeline .vo-spine { position:relative; }
      .pro-milestone-timeline .vo-links { position:absolute;top:0;left:204px;height:100%;width:44px;fill:none;stroke:#C8A24B;stroke-width:3;stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-milestone-timeline .vo-row { position:relative;display:grid;grid-template-columns:188px 44px minmax(0,1fr);align-items:center;gap:16px;height:102px; }
      .pro-milestone-timeline .vo-row svg { display:block;width:44px;height:44px;fill:#C8A24B;stroke:#0B0B0D;stroke-width:3;opacity:0; }
      ${copyCSS("milestone-timeline", 42, 50)}
      .pro-milestone-timeline .vo-time { color:#C8A24B;font:800 40px/48px "Inter",sans-serif; }`,
  },
  "route-trace": {
    variantOf: "session-agenda",
    family: "procedure",
    tags: ["steps", "timeline", "flow"],
    hint: milestoneHint,
    source: source("overview.roadmap"),
    slots: milestoneSlots(170, 232),
    size: { w: 720, h: 336 },
    surface: "obsidian",
    render(o, h) {
      const rows = milestones(o);
      const points = rows.map((_, i) => ({ x: i % 2 ? 166 : 46, y: 50 + 100 * i }));
      const paths = points.slice(1).map(({ x, y }, i) => {
        const previous = points[i];
        const d = `M${previous.x} ${previous.y}C${previous.x} ${previous.y + 62} ${x} ${y - 62} ${x} ${y}`;
        return `<path class="vo-link-${i}" pathLength="1" d="${d}"/>`;
      }).join("");
      const pins = points.map(({ x, y }, i) => `<circle class="vo-pin-${i}" cx="${x}" cy="${y}" r="12"/>`).join("");
      const inner = `<svg class="vo-route" viewBox="0 0 212 300" aria-hidden="true">${paths}${pins}</svg>` +
        rows.map(({ time, event }, i) => `<div class="vo-stop vo-stop-${i}"><div class="vo-copy vo-time">${h.copy(time)}</div><div class="vo-copy vo-event">${h.copy(event)}</div></div>`).join("");
      const timeline = rows.flatMap(({ time, event }, i) => [write(h, `.vo-stop-${i} .vo-time`, time.at),
        tween(h, `.vo-pin-${i}`, { opacity: 0 }, { opacity: 1 }, time.at),
        ...(i ? [draw(h, `.vo-link-${i - 1}`, time.at)] : []),
        write(h, `.vo-stop-${i} .vo-event`, event.at),
      ]).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-route-trace { position:absolute;padding:18px 32px 18px 268px; }
      .pro-route-trace .vo-route { position:absolute;top:18px;left:32px;width:212px;height:calc(100% - 36px); }
      .pro-route-trace .vo-route path { fill:none;stroke:#C8A24B;stroke-width:6;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-route-trace .vo-route circle { fill:#0B0B0D;stroke:#C8A24B;stroke-width:6;opacity:0; }
      .pro-route-trace .vo-stop { display:grid;grid-template-columns:170px minmax(0,1fr);gap:12px;align-items:center;height:100px; }
      ${copyCSS("route-trace", 42, 50)}
      .pro-route-trace .vo-time { color:#C8A24B;font:800 40px/48px "Inter",sans-serif; }`,
  },
  "timed-agenda": {
    family: "procedure",
    tags: ["list", "timeline", "time"],
    hint: "Greg lays out exactly three short agenda topics and says the timestamp or duration for each after naming it; quote each time and its unit verbatim",
    source: source("overview.board"),
    slots: Object.fromEntries(threeRows.flatMap((n) => [
      [n, spoken(26, 350, 40)], [`${n}Time`, spoken(21, 274, 40, 2, isAgendaTime)],
    ])),
    size: { w: 720, h: 396 },
    surface: "obsidian",
    render(o, h) {
      const rows = threeRows.map((name) => ({ name, topic: o.slots[name][0], time: o.slots[`${name}Time`][0] }));
      const inner = `<div class="vo-row vo-heading"><div>Topic</div><div>Time</div></div>` + rows.map(({ name, topic, time }) =>
        `<div class="vo-row vo-${name}"><div class="vo-copy vo-topic"><div>${h.copy(topic)}</div></div><div class="vo-time"><div class="vo-shutter" aria-hidden="true"></div><div class="vo-copy">${h.copy(time)}</div></div></div>`).join("");
      const timeline = rows.flatMap(({ name, topic, time }) => [
        write(h, `.vo-${name} .vo-topic`, topic.at),
        tween(h, `.vo-${name} .vo-shutter`, { scaleY: 0 }, { scaleY: 1 }, time.at, true),
        write(h, `.vo-${name} .vo-time .vo-copy`, time.at, true),
      ]).join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-timed-agenda { padding:18px 24px;display:grid;grid-template-rows:42px repeat(3,1fr); }
      .pro-timed-agenda .vo-row { display:grid;grid-template-columns:minmax(0,1fr) 296px;align-items:stretch;border-bottom:2px solid #343438; }
      .pro-timed-agenda .vo-row>div { min-width:0;display:flex;align-items:center;padding:0 10px; }
      .pro-timed-agenda .vo-row>div+div { border-left:2px solid #343438; }
      .pro-timed-agenda .vo-heading { color:#C8A24B;font:700 28px/34px "Inter",sans-serif; }
      ${copyCSS("timed-agenda")}
      .pro-timed-agenda .vo-time { position:relative;isolation:isolate;color:#C8A24B; }
      .pro-timed-agenda .vo-time .vo-copy { position:relative; }
      .pro-timed-agenda .vo-shutter { position:absolute;inset:0;background:#343438;transform:scaleY(0);transform-origin:center top; }`,
  },
  "comparison-columns": {
    family: "distinction",
    tags: ["comparison", "list"],
    hint: "Greg names one option and its three short traits, then a second option and its three traits on the same grounds; use only the names and traits he says",
    source: source("overview.compare"),
    slots: {
      left: spoken(21, 282, 44), leftPoints: repeated(spoken(24, 254), 3, 3),
      right: spoken(21, 282, 44), rightPoints: repeated(spoken(24, 254), 3, 3),
    },
    size: { w: 720, h: 464 },
    surface: "obsidian",
    render(o, h) {
      const column = (side) => {
        const title = o.slots[side][0];
        const points = o.slots[`${side}Points`];
        const bullet = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4"/></svg>`;
        const inner = `<div class="vo-column vo-${side}"><div class="vo-copy vo-title">${h.copy(title)}</div>${points.map((item, i) =>
          `<div class="vo-copy vo-trait vo-point-${i}">${bullet}<div>${h.copy(item)}</div></div>`).join("")}</div>`;
        const timeline = [write(h, `.vo-${side} .vo-title`, title.at, true),
          ...points.map((item, i) => write(h, `.vo-${side} .vo-point-${i}`, item.at))];
        return { inner, timeline };
      };
      const left = column("left"), right = column("right");
      return { inner: left.inner + right.inner, timeline: [...left.timeline, ...right.timeline].join("\n") };
    },
    css: `
      .pro-comparison-columns { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:16px 24px; }
      .pro-comparison-columns .vo-column { display:grid;grid-template-rows:108px repeat(3,102px);align-content:center;padding:0 16px;border:2px solid #343438;border-top:4px solid #C8A24B; }
      .pro-comparison-columns .vo-title { align-self:center;color:#C8A24B;font:400 44px/50px "Anton",sans-serif;opacity:0; }
      .pro-comparison-columns .vo-trait { display:grid;grid-template-columns:16px minmax(0,1fr);gap:10px;align-items:center;border-top:2px solid #343438; }
      .pro-comparison-columns .vo-trait svg { width:16px;height:16px;fill:#C8A24B; }
      ${copyCSS("comparison-columns")}`,
  },
  "yes-no-matrix": {
    family: "distinction",
    tags: ["comparison", "list"],
    hint: "Greg names two options, then exactly three short criteria with an explicit yes or no for each option after each criterion, in the original option order",
    source: source("overview.matrix"),
    slots: {
      left: spoken(14, 184, 40), right: spoken(14, 184, 40),
      ...Object.fromEntries(threeRows.flatMap((n) => [
        [n, spoken(19, 234)], [`${n}Left`, spoken(4, 150, 40, 1, isVerdict)], [`${n}Right`, spoken(4, 150, 40, 1, isVerdict)],
      ])),
    },
    size: { w: 720, h: 452 },
    surface: "obsidian",
    render(o, h) {
      const { left: [left], right: [right] } = o.slots;
      const badge = (item, side) => {
        const yes = /^yes\b/i.test(item.text);
        const icon = yes ? "m4 12 5 5L20 6" : "m6 6 12 12M18 6 6 18";
        return `<div class="vo-copy vo-result vo-${side}${yes ? " vo-yes" : ""}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg><div>${h.copy(item)}</div></div>`;
      };
      const cols = `<div class="vo-row vo-head"><div></div><div class="vo-copy vo-left"><div>${h.copy(left)}</div></div><div class="vo-copy vo-right"><div>${h.copy(right)}</div></div></div>`;
      const rows = threeRows.map((name) => ({ name, criterion: o.slots[name][0], left: o.slots[`${name}Left`][0], right: o.slots[`${name}Right`][0] }));
      const inner = cols + rows.map((row) => `<div class="vo-row vo-${row.name}"><div class="vo-copy vo-criterion"><div>${h.copy(row.criterion)}</div></div>${badge(row.left, "left")}${badge(row.right, "right")}</div>`).join("");
      const timeline = [write(h, ".vo-head .vo-left", left.at), write(h, ".vo-head .vo-right", right.at),
        ...rows.flatMap((row) => [
          write(h, `.vo-${row.name} .vo-criterion`, row.criterion.at),
          write(h, `.vo-${row.name} .vo-left`, row.left.at, true),
          write(h, `.vo-${row.name} .vo-right`, row.right.at, true),
        ])].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-yes-no-matrix { display:grid;grid-template-rows:repeat(4,1fr);padding:16px 24px; }
      .pro-yes-no-matrix .vo-row { display:grid;grid-template-columns:260px repeat(2,minmax(0,1fr));border-bottom:2px solid #343438; }
      .pro-yes-no-matrix .vo-copy { display:flex;align-items:center;justify-content:center;min-width:0;padding:0 8px;font:700 40px/48px "Inter",sans-serif;opacity:0; }
      .pro-yes-no-matrix .vo-head .vo-copy { background:#343438;color:#C8A24B;text-align:center; }
      .pro-yes-no-matrix .vo-copy+.vo-copy,.pro-yes-no-matrix .vo-head .vo-copy { border-left:2px solid #343438; }
      .pro-yes-no-matrix .vo-criterion { justify-content:flex-start; }
      .pro-yes-no-matrix .vo-result { gap:10px;color:#A8A49C; }
      .pro-yes-no-matrix .vo-yes { color:#C8A24B; }
      .pro-yes-no-matrix .vo-result svg { flex:none;width:30px;height:30px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round; }`,
  },
};

function isChapterNumber(text) {
  if (chapterOrdinal.test(text)) return true;
  const digits = text.match(/^([1-9]\d?)(st|nd|rd|th)?[.,:!?]?$/i);
  if (!digits) return false;
  const [, rawNumber, suffix] = digits;
  const number = Number(rawNumber);
  const ordinal = number >= 11 && number <= 13 ? "th" : [null, "st", "nd", "rd"][number % 10] || "th";
  return !suffix || suffix.toLowerCase() === ordinal;
}

function isAgendaTime(text) {
  return /^(?:\d{1,2}:[0-5]\d|\d{1,2}:[0-5]\d:[0-5]\d)[.,!?]?$/.test(text) ||
    /^(?:at )?(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|half an?) (?:seconds?|minutes?|hours?)[.,!?]?$/i.test(text);
}

function isRelativeTime(text) {
  if (/^(?:(?:by|in) )?(?:this|next|last) (?:day|week|month|quarter|year)[.,!?]?$/i.test(text)) return true;
  const numbered = text.match(/^(?:(?:by|in|on|at) )?(?:day|week|month|quarter|year) (.+)$/i);
  return !!numbered && isChapterNumber(numbered[1]);
}

function isVerdict(text) {
  return /^(?:yes|no)[.,!?]?$/.test(text.toLowerCase());
}
