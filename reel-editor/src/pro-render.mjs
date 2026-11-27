import { PRO_MOTION, proSize } from "./pro.mjs";
import { CARDS } from "./pro-cards/index.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const copy = (p) => { const t = (p.lines || [p.text]).map(esc).join("<br>"); return p.fontSize ? `<span style="font-size:${p.fontSize}px;line-height:${Math.round(p.fontSize * 1.18)}px">${t}</span>` : t; };
const js = (s) => JSON.stringify(s);
const at = (s) => Math.round(s * 1000) / 1000;

/** GSAP accepts ease functions; solve the CSS cubic directly so no CustomEase plugin is needed. */
export function proBezier(x1, y1, x2, y2) {
  return (x) => {
    if (x <= 0 || x >= 1) return Math.max(0, Math.min(1, x));
    const point = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (point(mid, x1, x2) < x) lo = mid; else hi = mid; }
    return point((lo + hi) / 2, y1, y2);
  };
}

function panel(overlay, inner, timeline) {
  const { id, place } = overlay, size = proSize(overlay);
  if (!place || !size) return { html: "", timeline: "" };
  const scale = place.scale || 1;
  const html = `<div id="${esc(id)}" class="pro-overlay pro-${overlay.type}${(overlay.surface || CARDS[overlay.type]?.surface) === "bone" ? " pro-bone" : ""}${CARDS[overlay.type]?.surface === "bare" ? " pro-bare" : ""}${overlay.fullscreen ? " pro-full" : ""}" style="left:${place.x}px;top:${place.y}px;width:${size.w}px;height:${size.h}px;transform:scale(${scale});transform-origin:0 0" data-start="${overlay.start}" data-duration="${overlay.duration}" data-track-index="3" data-layout-allow-overflow>${inner}</div>`;
  const selector = js(`#${id}`);
  return { html, timeline: `tl.fromTo(${selector},{opacity:0,y:${16 * scale}},{opacity:1,y:0,duration:${PRO_MOTION.enter},ease:proEnter,immediateRender:false},${overlay.start});\n${timeline}\ntl.to(${selector},{opacity:0,y:${-8 * scale},duration:${PRO_MOTION.exit},ease:proExit},${at(overlay.end - PRO_MOTION.exit)});` };
}

/** Wrong and right keep fixed rows; only the strike and the replacement change state. */
export function correction(overlay) {
  const sel = js(`#${overlay.id} .pro-strike`), right = js(`#${overlay.id} .pro-right`);
  return panel(overlay, `<div class="pro-wrong"><span>${copy(overlay.phrases[0])}<svg class="pro-strike" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M1 6 Q48 3 99 5"/></svg></span></div><div class="pro-right">${copy(overlay.phrases[1])}</div>`,
    `tl.fromTo(${sel}, {clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:0.2,ease:proState,immediateRender:false},${overlay.strikeAt});\ntl.fromTo(${right},{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)",duration:0.233,ease:proEnter,immediateRender:false},${overlay.reveals[1]});`);
}

export function compare(overlay) {
  const html = overlay.phrases.map((p, i) => `<div class="pro-column${i ? " pro-decisive" : ""}"><div class="pro-phrase">${copy(p)}</div></div>`).join("");
  const timeline = overlay.reveals.map((t, i) => `tl.fromTo(${js(`#${overlay.id} .pro-column:nth-child(${i + 1}) .pro-phrase`)},{opacity:0},{opacity:1,duration:0.233,ease:proEnter,immediateRender:false},${t});`).join("\n");
  return panel(overlay, html, timeline);
}

export function stepsRail(overlay) {
  const connectors = `<svg class="pro-connectors" viewBox="0 0 656 48" aria-hidden="true"><path pathLength="1" d="M104 24 H328"/><path pathLength="1" d="M328 24 H552"/></svg>`;
  const html = overlay.phrases.map((p, i) => `<div class="pro-step"><div class="pro-node">${i + 1}</div><div class="pro-step-copy">${copy(p)}</div></div>`).join("");
  const timeline = overlay.reveals.map((t, i) => {
    const step = `#${overlay.id} .pro-step:nth-of-type(${i + 1})`;
    return `tl.to(${js(`${step} .pro-node`)},{backgroundColor:"#C8A24B",color:"#0B0B0D",duration:0.3,ease:proState},${t});\ntl.fromTo(${js(`${step} .pro-step-copy`)},{opacity:0},{opacity:1,duration:0.233,ease:proEnter,immediateRender:false},${t});` + (i ? `\ntl.to(${js(`#${overlay.id} .pro-connectors path:nth-child(${i})`)},{strokeDashoffset:0,duration:0.3,ease:proState},${t});\ntl.to(${js(`#${overlay.id} .pro-step:nth-of-type(${i}) .pro-node`)},{backgroundColor:"#343438",color:"#F5F1E8",duration:0.3,ease:proState},${t});` : "");
  }).join("\n");
  return panel(overlay, connectors + html, timeline);
}

export function stat(overlay) {
  return panel(overlay, `<div class="pro-value pro-decisive">${copy(overlay.phrases[0])}</div><div class="pro-stat-label">${esc(overlay.label)}</div>`, "");
}

/** The SVG is inserted INSIDE its caption word, so wrapping and caption placement carry the mark with it. */
export function wordMark(overlay) {
  const circle = overlay.mark === "circle";
  const path = circle ? "M184 32 C180 8 31 1 11 24 C-9 49 164 64 187 37 C198 13 41 -1 15 21" : "M3 12 Q47 4 93 11 T197 8";
  const html = `<svg id="${esc(overlay.id)}" class="pro-word-mark pro-${circle ? "circle" : "underline"}" viewBox="0 0 200 ${circle ? 64 : 24}" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" vector-effect="non-scaling-stroke" d="${path}" stroke-width="${circle ? 6 : 7}"/></svg>`;
  return { html, timeline: `tl.fromTo(${js(`#${overlay.id} path`)},{strokeDashoffset:1},{strokeDashoffset:0,duration:${circle ? PRO_MOTION.circle : PRO_MOTION.underline},ease:"none",immediateRender:false},${overlay.start});\ntl.to(${js(`#${overlay.id}`)},{opacity:0,duration:0.167,ease:proExit},${at(overlay.end - PRO_MOTION.exit)});` };
}

export function label(overlay) {
  return panel(overlay, `<div class="pro-topic">${copy(overlay.phrases[0])}</div>`, "");
}

const helpers = { esc, copy, js, at, motion: PRO_MOTION };

export function renderProOverlay(overlay) {
  const def = overlay.card && CARDS[overlay.type];
  if (def) { const r = def.render(overlay, { ...helpers, sel: (s) => js(`#${overlay.id} ${s}`) }); return panel(overlay, r.inner, r.timeline || ""); }
  const render = { correction, compare, steps: stepsRail, stat, wordMark, label }[overlay.type];
  return render ? render(overlay) : { html: "", timeline: "" };
}

export function proTimeline(overlays) {
  if (!overlays.length) return "";
  return `const proEase = ${proBezier.toString()};\nconst proEnter=proEase(.16,1,.3,1),proState=proEase(.65,0,.35,1),proExit=proEase(.4,0,1,1);\n${overlays.map((o) => renderProOverlay(o).timeline).join("\n")}\n`;
}

/** The pro look's styles. With `types`, only those cards' own rules are added (a reel carries a few of hundreds). */
export function proCSS({ types = null } = {}) {
  return `
      .pro-overlay { position:absolute;box-sizing:border-box;padding:32px;border-radius:16px;background:rgba(11,11,13,.92);color:#F5F1E8;box-shadow:0 12px 32px rgba(0,0,0,.22);font-family:"Inter",sans-serif;font-size:52px;font-weight:600;line-height:62px;opacity:0;pointer-events:none;text-shadow:none;overflow:hidden; }
      .pro-overlay * { box-sizing:border-box; }
      .pro-overlay.pro-bone { background:#F5F1E8;color:#0B0B0D; }
      .pro-decisive,.pro-right { color:#C8A24B; }
      .pro-bone .pro-decisive,.pro-bone .pro-right { color:#0B0B0D; }
      .pro-correction { display:flex;flex-direction:column;justify-content:center;gap:16px; }
      .pro-wrong>span { position:relative;display:inline-block; }
      .pro-strike { position:absolute;left:0;top:44%;width:100%;height:10px;clip-path:inset(0 100% 0 0); }
      .pro-strike path { fill:none;stroke:#C8A24B;stroke-width:5; }
      .pro-right { font-weight:750;font-size:64px;line-height:72px;opacity:0;clip-path:inset(0 100% 0 0); }
      .pro-compare { display:grid;grid-template-columns:340px 340px;gap:40px;padding:0;background:none;box-shadow:none;overflow:visible; }
      .pro-column { padding:32px;border-radius:16px;background:rgba(11,11,13,.92);box-shadow:0 12px 32px rgba(0,0,0,.22);min-height:100%; }
      .pro-bone .pro-column { background:#F5F1E8;color:#0B0B0D; }
      .pro-column+.pro-column { border-left:2px solid #343438; }
      .pro-phrase,.pro-step-copy { opacity:0; }
      .pro-steps { display:grid;grid-template-columns:repeat(3,1fr);gap:16px; }
      .pro-step { position:relative;display:flex;flex-direction:column;align-items:center;gap:16px;min-width:0; }
      .pro-node { width:48px;height:48px;border-radius:50%;background:#343438;font:400 40px/48px "Anton",sans-serif;text-align:center; }
      .pro-step-copy { font-size:40px;line-height:48px;text-align:center; }
      .pro-connectors { position:absolute;left:32px;top:32px;width:656px;height:48px; }
      .pro-connectors path { stroke:#C8A24B;stroke-width:2;fill:none;stroke-dasharray:1;stroke-dashoffset:1; }
      .pro-value { font:400 128px/144px "Anton",sans-serif; }
      .pro-stat-label { font-size:40px;line-height:48px;margin-top:16px; }
      .pro-label { width:max-content;border-radius:56px;font-size:40px;line-height:48px; }
      .pro-word-mark { position:absolute;pointer-events:none;overflow:visible;width:calc(100% + 24px);left:-12px; }
      .pro-underline { height:24px;bottom:-24px; }
      .pro-circle { height:calc(100% + 24px);top:-12px; }
      .pro-bare { background:none;box-shadow:none;padding:0;border-radius:0;overflow:visible; }
      .pro-full { border-radius:0;padding:110px; }
${Object.entries(CARDS).filter(([t]) => !types || types.has(t)).map(([, d]) => d.css || "").join("\n")}
      .pro-word-mark path { fill:none;stroke:#C8A24B;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1; }
`;
}
