// Restyled from the Herk Edit Kit, MIT license, copyright 2026 Nate Herk. See src/pro-cards/HERK-LICENSE.md.

const definition = {
  family: "payoff",
  tags: ["definition", "callout"],
  hint: "Greg names a specific sales or coaching term and immediately explains what it means; take the term and its definition from two consecutive spoken ranges",
};

// Match the card fitter's conservative width estimate without importing the planner from its own registry.
function estimatedWidth(text, size) {
  return [...text].reduce((sum, char) => sum + (/\s/.test(char) ? 0.3 : /[ilI.,!'’]/.test(char) ? 0.32 : /[MW@]/.test(char) ? 0.95 : /[A-Z]/.test(char) ? 0.75 : 0.65) * size, 0);
}

function fitsAtSize(text, { width, size, maxLines }) {
  if (!text.trim() || /[\p{Emoji_Presentation}\uFE0F]/u.test(text)) return false;
  let lines = 1, line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (estimatedWidth(word, size) > width) return false;
    const next = line ? `${line} ${word}` : word;
    if (estimatedWidth(next, size) > width) {
      if (++lines > maxLines) return false;
      line = word;
    } else {
      line = next;
    }
  }
  return true;
}

function spoken(maxChars, width, size, maxLines) {
  const bounds = { width, size, maxLines };
  return { kind: "spoken", maxChars, ...bounds, validate: (text) => fitsAtSize(text, bounds) };
}

function tween(h, selector, from, to, at, motion = "enter") {
  return `tl.fromTo(${h.sel(selector)},${h.js(from)},{...${h.js(to)},duration:${h.motion[motion]},ease:${motion === "enter" ? "proEnter" : "proState"},immediateRender:false},${h.at(at)});`;
}

function write(h, selector, item, clipPath = "inset(0 100% 0 0)") {
  return tween(h, selector, { opacity: 0, clipPath }, { opacity: 1, clipPath: "inset(0 0% 0 0)" }, item.at);
}

function draw(h, selector, at) {
  return tween(h, selector, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at, "state");
}

function copy(h, slot, item) {
  return `<div class="vl-copy vl-${slot}">${h.copy(item)}</div>`;
}

function definitionCSS(type) {
  return `
    .pro-${type} .vl-copy { opacity:0;white-space:nowrap; }
    .pro-${type} .vl-term { font:400 48px/56px "Anton",sans-serif; }
    .pro-${type} .vl-detail { font:600 40px/48px "Inter",sans-serif; }
    .pro-${type} .vl-draw { fill:none;stroke:#C8A24B;stroke-width:4;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1; }`;
}

const bracket = (side, path) => `<svg class="vl-bracket vl-${side}" viewBox="0 0 16 80" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" vector-effect="non-scaling-stroke"/></svg>`;

export const CARDS = {
  "term-explainer": {
    ...definition,
    source: "herk:vox-explainer.t2.label.margin-note,vox-explainer.t2.label.spotlight",
    slots: { term: spoken(24, 604, 48, 1), detail: spoken(72, 604, 40, 3) },
    size: { w: 688, h: 304 },
    surface: "bare",
    render(o, h) {
      const term = o.slots.term[0], detail = o.slots.detail[0];
      const inner = `<div class="vl-tab"><div class="vl-marker"></div>${copy(h, "term", term)}</div><div class="vl-detail-slab">${copy(h, "detail", detail)}</div>`;
      const timeline = [
        tween(h, ".vl-marker", { scaleX: 0 }, { scaleX: 1 }, term.at),
        write(h, ".vl-term", term),
        tween(h, ".vl-detail-slab", { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, detail.at),
        write(h, ".vl-detail", detail),
      ].join("\n");
      return { inner, timeline };
    },
    css: definitionCSS("term-explainer") + `
      .pro-term-explainer { display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:12px;padding:20px 24px; }
      .pro-term-explainer .vl-tab { position:relative;max-width:100%;padding:8px 18px;color:#0B0B0D; }
      .pro-term-explainer .vl-term { position:relative; }
      .pro-term-explainer .vl-marker { position:absolute;inset:0;background:#C8A24B;border-radius:6px;transform:scaleX(0);transform-origin:left center; }
      .pro-term-explainer .vl-detail-slab { max-width:100%;padding:12px 18px;background:#0B0B0D;border-radius:6px;color:#F5F1E8;opacity:0; }`,
  },
  "term-brackets": {
    ...definition,
    variantOf: "term-explainer",
    source: "herk:vox-explainer.t2.label.bracket",
    slots: { term: spoken(24, 568, 48, 2), detail: spoken(72, 624, 40, 3) },
    size: { w: 688, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const term = o.slots.term[0], detail = o.slots.detail[0];
      const inner = `<div class="vl-term-row">${bracket("left", "M14 2H2V78H14")}${copy(h, "term", term)}${bracket("right", "M2 2H14V78H2")}</div>${copy(h, "detail", detail)}`;
      const timeline = [
        tween(h, ".vl-left", { opacity: 0, x: -8 }, { opacity: 1, x: 0 }, term.at),
        tween(h, ".vl-right", { opacity: 0, x: 8 }, { opacity: 1, x: 0 }, term.at),
        write(h, ".vl-term", term, "inset(0 50% 0 50%)"),
        write(h, ".vl-detail", detail),
      ].join("\n");
      return { inner, timeline };
    },
    css: definitionCSS("term-brackets") + `
      .pro-term-brackets { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px 32px;text-align:center; }
      .pro-term-brackets .vl-term-row { position:relative;max-width:100%;padding:0 28px; }
      .pro-term-brackets .vl-bracket { position:absolute;top:0;width:16px;height:100%;fill:none;stroke:#C8A24B;stroke-width:4;opacity:0; }
      .pro-term-brackets .vl-left { left:0; }
      .pro-term-brackets .vl-right { right:0; }`,
  },
  "term-sticky": {
    ...definition,
    variantOf: "term-explainer",
    source: "herk:vox-explainer.t2.label.sticky,vox-explainer.t2.label.tag",
    slots: { term: spoken(24, 576, 48, 1), detail: spoken(72, 592, 40, 3) },
    size: { w: 688, h: 320 },
    surface: "bare",
    render(o, h) {
      const term = o.slots.term[0], detail = o.slots.detail[0];
      const fold = `<svg class="vl-fold" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24L0 24Z"/></svg>`;
      const inner = `<div class="vl-drop"><div class="vl-note">${copy(h, "term", term)}${fold}</div></div><div class="vl-detail-slab">${copy(h, "detail", detail)}</div>`;
      const timeline = [
        tween(h, ".vl-drop", { opacity: 0, y: -10 }, { opacity: 1, y: 0 }, term.at),
        write(h, ".vl-term", term),
        tween(h, ".vl-detail-slab", { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, detail.at),
        write(h, ".vl-detail", detail),
      ].join("\n");
      return { inner, timeline };
    },
    css: definitionCSS("term-sticky") + `
      .pro-term-sticky { display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:14px;padding:24px; }
      .pro-term-sticky .vl-drop { max-width:100%;opacity:0; }
      .pro-term-sticky .vl-note { position:relative;padding:12px 44px 12px 20px;transform:rotate(-1.5deg);background:#F5F1E8;color:#0B0B0D;clip-path:polygon(0 0,100% 0,100% calc(100% - 24px),calc(100% - 24px) 100%,0 100%); }
      .pro-term-sticky .vl-fold { position:absolute;right:0;bottom:0;width:24px;height:24px;fill:#C8A24B; }
      .pro-term-sticky .vl-detail-slab { max-width:calc(100% - 12px);margin-left:12px;padding:12px 18px;background:#0B0B0D;border-radius:6px;color:#F5F1E8;opacity:0; }`,
  },
  "term-underline": {
    ...definition,
    variantOf: "term-explainer",
    source: "herk:vox-explainer.t2.label.underline,vox-explainer.t2.label.circle,vox-explainer.t2.label.definition",
    slots: { term: spoken(24, 624, 48, 1), detail: spoken(72, 600, 40, 3) },
    size: { w: 688, h: 288 },
    surface: "obsidian",
    render(o, h) {
      const term = o.slots.term[0], detail = o.slots.detail[0];
      const line = `<svg class="vl-line" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><path class="vl-draw" pathLength="1" vector-effect="non-scaling-stroke" d="M2 3H98"/></svg>`;
      const inner = `<div class="vl-term-row">${copy(h, "term", term)}${line}</div>${copy(h, "detail", detail)}`;
      const timeline = [write(h, ".vl-term", term), draw(h, ".vl-line path", term.at), write(h, ".vl-detail", detail)].join("\n");
      return { inner, timeline };
    },
    css: definitionCSS("term-underline") + `
      .pro-term-underline { display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:18px;padding:20px 32px; }
      .pro-term-underline .vl-term-row { display:grid;gap:8px;width:max-content;max-width:100%; }
      .pro-term-underline .vl-line { display:block;width:100%;height:6px; }
      .pro-term-underline .vl-detail { margin-left:24px; }`,
  },
  "term-pin": {
    ...definition,
    variantOf: "term-explainer",
    source: "herk:vox-explainer.t2.label.pin,vox-explainer.t2.label.footnote",
    slots: { term: spoken(24, 568, 48, 2), detail: spoken(72, 568, 40, 3) },
    size: { w: 688, h: 320 },
    surface: "obsidian",
    render(o, h) {
      const term = o.slots.term[0], detail = o.slots.detail[0];
      const pin = `<svg class="vl-pin" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 30 16 16 30 2 16Z"/></svg>`;
      const rail = `<svg class="vl-rail" viewBox="0 0 8 100" preserveAspectRatio="none" aria-hidden="true"><path class="vl-draw" pathLength="1" vector-effect="non-scaling-stroke" d="M4 3V97"/></svg>`;
      const inner = `${pin}${copy(h, "term", term)}<div class="vl-gutter">${rail}</div>${copy(h, "detail", detail)}`;
      const timeline = [
        tween(h, ".vl-pin", { opacity: 0, y: -10 }, { opacity: 1, y: 0 }, term.at),
        write(h, ".vl-term", term),
        draw(h, ".vl-rail path", detail.at),
        write(h, ".vl-detail", detail),
      ].join("\n");
      return { inner, timeline };
    },
    css: definitionCSS("term-pin") + `
      .pro-term-pin { display:grid;grid-template-columns:48px 568px;align-content:center;gap:12px 16px;padding:24px 28px; }
      .pro-term-pin .vl-pin { justify-self:center;align-self:center;width:32px;height:32px;fill:#C8A24B;opacity:0; }
      .pro-term-pin .vl-gutter { position:relative; }
      .pro-term-pin .vl-rail { position:absolute;inset:0 auto 0 20px;width:8px;height:100%; }`,
  },
  "term-caption": {
    ...definition,
    variantOf: "term-explainer",
    source: "herk:vox-explainer.t2.label.caption",
    slots: { term: spoken(24, 232, 44, 2), detail: spoken(56, 368, 40, 4) },
    size: { w: 720, h: 248 },
    surface: "bone",
    render(o, h) {
      const term = o.slots.term[0], detail = o.slots.detail[0];
      const divider = `<svg class="vl-dash" viewBox="0 0 32 8" aria-hidden="true"><path class="vl-draw" pathLength="1" d="M3 4H29"/></svg>`;
      const inner = `<div class="vl-band"></div>${copy(h, "term", term)}${divider}${copy(h, "detail", detail)}`;
      const timeline = [
        tween(h, ".vl-band", { scaleX: 0 }, { scaleX: 1 }, term.at),
        write(h, ".vl-term", term),
        draw(h, ".vl-dash path", detail.at),
        write(h, ".vl-detail", detail),
      ].join("\n");
      return { inner, timeline };
    },
    css: definitionCSS("term-caption") + `
      .pro-term-caption { display:grid;grid-template-columns:232px 32px 368px;gap:20px;align-items:center;padding:24px;color:#0B0B0D; }
      .pro-term-caption.pro-bone { background:none;box-shadow:none; }
      .pro-term-caption .vl-band { position:absolute;inset:0;background:#F5F1E8;border-left:8px solid #C8A24B;border-radius:8px;transform:scaleX(0);transform-origin:left center; }
      .pro-term-caption .vl-copy,.pro-term-caption .vl-dash { position:relative; }
      .pro-term-caption .vl-term { font-size:44px;line-height:52px; }`,
  },
  "term-lens": {
    ...definition,
    variantOf: "term-explainer",
    source: "herk:vox-explainer.t2.label.magnify",
    slots: { term: spoken(18, 184, 42, 2), detail: spoken(72, 556, 40, 3) },
    size: { w: 640, h: 456 },
    surface: "bare",
    render(o, h) {
      const term = o.slots.term[0], detail = o.slots.detail[0];
      // The lens is a solid backing with the type entirely inside its rim.
      const lens = `<svg class="vl-lens-art" viewBox="0 0 272 240" aria-hidden="true"><path class="vl-draw vl-handle" pathLength="1" d="m201 191 40 38"/><circle cx="118" cy="118" r="112"/></svg>`;
      const inner = `<div class="vl-lens">${lens}<div class="vl-lens-window">${copy(h, "term", term)}</div></div><div class="vl-detail-slab">${copy(h, "detail", detail)}</div>`;
      const timeline = [
        tween(h, ".vl-lens", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1 }, term.at),
        write(h, ".vl-term", term),
        draw(h, ".vl-handle", term.at),
        tween(h, ".vl-detail-slab", { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, detail.at),
        write(h, ".vl-detail", detail),
      ].join("\n");
      return { inner, timeline };
    },
    css: definitionCSS("term-lens") + `
      .pro-term-lens { display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:12px;padding:16px 24px; }
      .pro-term-lens .vl-lens { position:relative;width:272px;height:240px;flex:none;transform-origin:118px 118px;opacity:0; }
      .pro-term-lens .vl-lens-art { position:absolute;inset:0;width:100%;height:100%; }
      .pro-term-lens .vl-lens-art circle { fill:#F5F1E8;stroke:#C8A24B;stroke-width:5; }
      .pro-term-lens .vl-handle { stroke-width:12; }
      .pro-term-lens .vl-lens-window { position:absolute;top:0;left:26px;width:184px;height:236px;display:grid;align-content:center;text-align:center; }
      .pro-term-lens .vl-term { font-size:42px;line-height:50px;color:#0B0B0D; }
      .pro-term-lens .vl-detail-slab { max-width:100%;padding:12px 18px;background:#0B0B0D;border-radius:6px;color:#F5F1E8;opacity:0; }`,
  },
  "quote-with-context": {
    family: "payoff",
    tags: ["quote", "callout"],
    hint: "Greg delivers a short line of his own worth quoting and immediately explains its meaning or why it matters; take both from separate spoken ranges",
    source: "herk:vox-explainer.t2.label.pull-quote",
    slots: { quote: spoken(60, 548, 48, 3), context: spoken(52, 548, 40, 2) },
    size: { w: 688, h: 352 },
    surface: "obsidian",
    render(o, h) {
      const quote = o.slots.quote[0], context = o.slots.context[0];
      const mark = `<svg class="vl-mark" viewBox="0 0 64 52" aria-hidden="true"><path d="M27 6v8c-9 3-13 8-13 14h13v20H3V31C3 18 12 9 27 6Zm33 0v8c-9 3-13 8-13 14h13v20H36V31C36 18 45 9 60 6Z"/></svg>`;
      const inner = `${mark}${copy(h, "quote", quote)}<div class="vl-context-row"><div class="vl-rule"></div>${copy(h, "context", context)}</div>`;
      const timeline = [
        tween(h, ".vl-mark", { opacity: 0, y: -10 }, { opacity: 1, y: 0 }, quote.at),
        write(h, ".vl-quote", quote),
        tween(h, ".vl-rule", { scaleX: 0 }, { scaleX: 1 }, context.at, "state"),
        write(h, ".vl-context", context),
      ].join("\n");
      return { inner, timeline };
    },
    css: `
      .pro-quote-with-context { display:grid;grid-template-columns:64px 548px;align-content:center;gap:16px 20px;padding:24px 28px; }
      .pro-quote-with-context .vl-copy { opacity:0;white-space:nowrap; }
      .pro-quote-with-context .vl-mark { display:block;width:64px;height:52px;fill:#C8A24B;opacity:0; }
      .pro-quote-with-context .vl-quote { font:400 48px/56px "Anton",sans-serif; }
      .pro-quote-with-context .vl-context-row { grid-column:2;display:grid;gap:12px; }
      .pro-quote-with-context .vl-rule { height:2px;background:#343438;transform-origin:left center;transform:scaleX(0); }
      .pro-quote-with-context .vl-context { font:600 40px/48px "Inter",sans-serif; }`,
  },
};
