import { esc } from "./text.mjs";
import { boldOverlayHandler } from "./bold-overlays.mjs";

export function boldText(text) {
  return String(text ?? "").replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/[–—]/g, " ").replace(/[“”"…]/g, "").replace(/\s+/g, " ").trim();
}

/** Deterministic initial fit. Whole words only; the page checks the loaded font and can only shrink this fit. */
export function fitBoldText(words, { size = 84, width = 928, lineHeight = 1.08, payoff = null, payoffScale = 1.9, blockedBreaks = [], maxHeight = Infinity, measure = (text) => [...text].reduce((sum, char) => sum + (/[MW@%]/.test(char) ? 0.95 : /[ilI1.,'!]/.test(char) ? 0.3 : /[A-Z0-9]/.test(char) ? 0.65 : 0.54), 0) } = {}) {
  if (!(size > 0) || !(width > 0) || !(lineHeight > 0) || !(maxHeight > 0)) throw new Error("invalid bold text rectangle");
  if (!words.length) return { size, lines: [], h: 0, payoffScale };
  const scaled = words.map((word, i) => measure(String(word)) * (i === payoff ? payoffScale : 1));
  const lineWidth = (from, to) => scaled.slice(from, to).reduce((sum, value) => sum + value, 0) + Math.max(0, to - from - 1) * 0.28;
  const options = [{ lines: [[0, words.length]], widths: [lineWidth(0, words.length)] }];
  for (let split = 1; split < words.length; split++) if (!blockedBreaks.includes(split)) options.push({ lines: [[0, split], [split, words.length]], widths: [lineWidth(0, split), lineWidth(split, words.length)] });
  for (const option of options) {
    const heights = option.lines.map(([from, to]) => lineHeight * (payoff != null && payoff >= from && payoff < to ? payoffScale : 1));
    option.size = Math.min(size, width / Math.max(...option.widths), maxHeight / heights.reduce((sum, h) => sum + h, 0));
    option.h = option.size * heights.reduce((sum, h) => sum + h, 0);
  }
  // Use one line at full size whenever it fits. Otherwise prefer legibility, then fewer lines.
  const full = options[0].size >= size ? options[0] : options.slice().sort((a, b) => b.size - a.size || a.lines.length - b.lines.length || Math.abs(a.widths[0] - a.widths.at(-1)) - Math.abs(b.widths[0] - b.widths.at(-1)))[0];
  const fontSize = Math.floor(full.size * 100) / 100;
  return { size: fontSize, lines: full.lines.map(([from, to]) => ({ from, to })), h: Math.ceil(full.h), payoffScale };
}

function rows(plan, item, headline = false) {
  const ws = plan.words.slice(item.from, item.to + 1);
  return item.place.lines.map(({ from, to }) => `<span class="bold-row">${ws.slice(from, to).map((word, i) => {
    const index = item.from + from + i;
    const emphasis = headline ? index === item.emphasis : index === item.emphasis?.word;
    const gold = emphasis && (headline || item.emphasis?.gold);
    const clean = boldText(word.text);
    const text = headline && index === item.from ? clean.replace(/^\p{L}/u, (letter) => letter.toUpperCase()) : clean;
    return `<span class="bold-word${emphasis ? " bold-emphasis" : ""}${gold ? " bold-gold" : ""}${index === item.payoff ? " bold-number" : ""}" data-word-index="${index}">${esc(item.mode === "punch" ? text.toUpperCase() : text)}</span>`;
  }).join(" ")}</span>`).join("");
}

export function boldHTML(plan, { settings } = {}) {
  if (!plan.bold) return "";
  const block = (item, id, cls, headline = false) => {
    const p = item.place;
    return `<div id="${id}" class="${cls}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;font-size:${p.size}px;--bold-payoff:${p.payoffScale || settings.punch.payoffScale}${item.startFrame === 0 ? ";opacity:1" : ""}" data-start="${item.start}" data-duration="${item.end - item.start}" data-layout-allow-caption-zone data-layout-allow-overflow><div class="bold-lines">${rows(plan, item, headline)}</div></div>`;
  };
  return [
    plan.bold.headline ? block(plan.bold.headline, "bold-headline", "bold-headline", true) : "",
    ...plan.bold.groups.map((g, i) => block(g, `bold-caption-${i}`, `bold-caption bold-${g.mode}`)),
    ...(plan.bold.overlays || []).map((event, i) => boldOverlayHandler(event.kind)?.html(event, { esc, plan, settings, i }) || ""),
  ].filter(Boolean).join("\n");
}

export function boldCSS(settings, plan) {
  const { colors: c, quiet, punch, headline } = settings;
  return `
      .bold-root .bold-caption, .bold-root .bold-headline { position:absolute; box-sizing:border-box; text-align:center; font-family:"Inter",sans-serif; color:${c.bone}; pointer-events:none; }
      .bold-root .bold-caption { opacity:0; z-index:20; }
      .bold-root .bold-headline { opacity:1; z-index:21; background:${c.black}; background:color-mix(in srgb, ${c.black} ${headline.opacity * 100}%, transparent); border-radius:12px; padding:${headline.padding * plan.canvas.width / 1080}px; font-family:"${headline.font === "Anton" ? "Anton" : "Inter"}",sans-serif; font-weight:${headline.weight}; line-height:${headline.lineHeight}; }
      .bold-root .bold-lines { display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; transform-origin:50% 50%; }
      .bold-root .bold-row { display:block; white-space:nowrap; }
      .bold-root .bold-word { display:inline-block; white-space:nowrap; word-break:keep-all; overflow-wrap:normal; }
      .bold-root .bold-quiet { font-weight:${quiet.weight}; line-height:${quiet.lineHeight}; text-shadow:${quiet.shadow}; }
      .bold-root .bold-quiet .bold-emphasis { font-weight:${quiet.emphasisWeight}; }
      .bold-root .bold-punch { font-weight:${punch.weight}; text-transform:uppercase; line-height:${punch.lineHeight}; -webkit-text-stroke:${punch.stroke * plan.canvas.width / 1080}px ${c.black}; paint-order:stroke fill; text-shadow:0 5px 0 ${c.black},0 5px 18px rgba(0,0,0,0.6); }
      .bold-root .bold-gold { color:${c.gold}; }
      .bold-root .bold-number { font-size:calc(1em * var(--bold-payoff)); }
${[...new Set((plan.bold?.overlays || []).map((event) => event.kind))].map((kind) => boldOverlayHandler(kind)?.css?.({ plan, settings }) || "").join("\n")}`;
}

export function boldRuntime(plan, settings) {
  const bold = plan.bold;
  return bold ? { headline: bold.headline && { endFrame: bold.headline.endFrame }, groups: bold.groups.map((g) => ({ startFrame: g.startFrame, endFrame: g.endFrame, settle: g.mode === "punch" && g.payoff != null && settings.punch.payoffSettle === true })), payoffFrames: settings.punch.payoffFrames, payoffFrom: settings.punch.payoffFrom } : { headline: null, groups: [] };
}

export function boldOverlayTimeline(plan, settings) {
  return (plan.bold?.overlays || []).map((event, i) => boldOverlayHandler(event.kind)?.timeline?.(event, { plan, settings, i }) || "").join("\n");
}

// Plain timeline sets have no playback state: seeking backwards or directly to a frame gives the same result.
// Font fitting always starts at the planned size and only shrinks; it never changes line breaks or placement.
export const BOLD_JS = `
        if (PLAN.bold.headline) {
          tl.set("#bold-headline", { opacity: 1 }, 0);
          tl.set("#bold-headline", { opacity: 0 }, PLAN.bold.headline.endFrame / PLAN.fps);
        }
        PLAN.bold.groups.forEach((g, i) => {
          const el = document.getElementById("bold-caption-" + i);
          if (g.startFrame > 0) tl.set(el, { opacity: 0 }, 0);
          tl.set(el, { opacity: 1 }, g.startFrame / PLAN.fps);
          if (g.settle) tl.fromTo(el.firstElementChild, { scale: PLAN.bold.payoffFrom }, { scale: 1, duration: PLAN.bold.payoffFrames / PLAN.fps, ease: "none", immediateRender: false }, g.startFrame / PLAN.fps);
          tl.set(el, { opacity: 0 }, g.endFrame / PLAN.fps);
        });
        const boldFit = () => document.querySelectorAll(".bold-root .bold-caption, .bold-root .bold-headline").forEach((el) => {
          if (!el.dataset.boldSize) el.dataset.boldSize = parseFloat(el.style.fontSize);
          const size = Number(el.dataset.boldSize);
          el.style.fontSize = size + "px";
          const style = getComputedStyle(el);
          const width = el.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
          const height = el.clientHeight - parseFloat(style.paddingTop || 0) - parseFloat(style.paddingBottom || 0);
          const rows = [...el.querySelectorAll(".bold-row")];
          const widest = Math.max(1, ...rows.map((row) => row.scrollWidth));
          const tallest = rows.reduce((sum, row) => sum + row.offsetHeight, 0);
          el.style.fontSize = (Math.floor(size * Math.min(1, width / widest, height / Math.max(1, tallest)) * 100) / 100) + "px";
        });
        boldFit();
        if (document.fonts) document.fonts.ready.then(boldFit);
`;
