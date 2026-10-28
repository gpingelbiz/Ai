import { esc } from "./text.mjs";

/**
 * Brand looks: card looks built for a client brand with a display serif and a quiet sans (first one: Julee Gracey,
 * from the women-coach reel research in her notes, 2026-10-28). They are opt-in (`brandOnly`): only a preset that
 * lists them in `graphics.includeLooks` gets them, so Greg's reels never do.
 *
 * - atelier: a cream editorial card with an inner hairline frame, the serif in sentence case, the keyword in italic
 *   on an accent highlighter band, small tracked caps labels.
 * - note: Instagram's own text boxes, one white box per line, black sans, the keyword in an accent box. Pops on.
 * - serifonlife: the serif straight on the video with a soft local scrim, the keyword in italic with an accent
 *   underline. Fades in from a slight blur.
 *
 * Shared rules from the research: the accent is a fill, band or line and never a text color (peach on cream is about
 * 1.6:1); no ALL CAPS sentences, no glow, no bounce, no rotation. Type comes from the brand's own fonts: "Look Serif"
 * is the display font (Anton-Regular.ttf in the project, plus DisplayItalic.ttf when the brand has one) and
 * "Look Sans" the body font (Inter.ttf), declared with their full weight range so a variable font draws 500 and 600.
 */

export const BRAND_LOOKS = {
  atelier: {
    label: "Atelier",
    fits: "a framework, a list, steps, a split or comparison, a number, a quote, a script to say, a breakdown",
    brandOnly: true,
    skins: { stat: "atelier", headline: "atelier", quote: "atelier", list: "atelier", steps: "atelier", compare: "atelier", bars: "atelier", message: "atelier", post: "atelier", chapter: "atelier" },
  },
  note: {
    label: "Note",
    fits: "an objection and what to say back, a DM or text, what a client says, a quick list or split, anything that fits none of the others",
    brandOnly: true,
    skins: { stat: "note", headline: "note", quote: "note", list: "note", steps: "note", compare: "note", bars: "note", message: "note", post: "note", chapter: "note" },
  },
  serifonlife: {
    label: "Serif on life",
    fits: "one line over her day, a confession or turning point, an identity line, a quote, a story, a calm reflective reel",
    brandOnly: true,
    skins: { stat: "serifonlife", headline: "serifonlife", quote: "serifonlife", list: "serifonlife", steps: "serifonlife", compare: "serifonlife", bars: "serifonlife", message: "note", post: "serifonlife", chapter: "serifonlife" },
  },
};

export const BRAND_THEMES = {
  // Hard cuts only: the motion pass found no dissolves, whips or flashes in 13 women-coach reels.
  atelier: { hook: "cream", marker: "box", slam: "serif", grade: { preset: "muted-editorial", intensity: 0.35, details: { vignette: 0, grain: 0 } }, cut: "hard", zoom: "camera" },
  note: { hook: "linebox", marker: "box", slam: "bubble", grade: { preset: "soft-boost", intensity: 0.3 }, cut: "hard", zoom: "camera" },
  serifonlife: { hook: "quiet", marker: "underline", slam: "serif", grade: { preset: "vintage-wash", intensity: 0.3, details: { grain: 0.05 } }, cut: "hard", zoom: "camera" },
};

/** The skins that move quietly (GRAPHICS_JS reads this list). */
export const QUIET_SKINS = ["atelier", "note", "serifonlife"];

/** Hook treatments that need the brand fonts, by the skin whose fonts they load. */
export const BRAND_HOOK_FONTS = { cream: "atelier", linebox: "note", quiet: "serifonlife" };

/** Brand fonts, already in the project (compose copies them), declared over their full weight range. */
const LOOK_FONT_FACES = [
  ["Look Serif", "Anton-Regular.ttf", "300 900", "normal"],
  ["Look Serif", "DisplayItalic.ttf", "300 900", "italic"],
  ["Look Sans", "Inter.ttf", "100 900", "normal"],
];
export const BRAND_SKIN_FONTS = { atelier: LOOK_FONT_FACES, note: LOOK_FONT_FACES, serifonlife: LOOK_FONT_FACES };
/** Font files that come from the brand (or the house fonts), never from assets/fonts by these names. */
export const BRAND_FONT_FILES = new Set(["Anton-Regular.ttf", "Inter.ttf", "DisplayItalic.ttf"]);

const INK = "#111111";
const PAPER = "#FFF3EE";

/* ---------------------------------------------------------------- note: one box per line */

const keyed = (s) => esc(s).replace(/\*([^*]+)\*/g, '<span class="nb-key">$1</span>').replace(/\*/g, "");
const line = (inner, cls = "") => `<div class="nb-line g-in${cls ? ` ${cls}` : ""}"><span class="nb">${inner}</span></div>`;

/** Note skin markup: every line of text is its own inline box (the way Instagram's text tool draws them). */
export function noteHTML(s, { statHTML }) {
  const label = s.eyebrow ? line(esc(s.eyebrow), "nb-label") : "";
  if (s.type === "stat") return `<div class="g-box g-note">${label}<div class="nb-line g-in nb-big"><span class="nb">${statHTML(s.value, 120, " nb-stat")}${s.value2 ? ` to ${esc(s.value2)}` : ""}</span></div>${s.sub ? line(esc(s.sub)) : ""}</div>`;
  if (s.type === "headline" || s.type === "chapter") return `<div class="g-box g-note">${label}${line(keyed(s.text || ""), "nb-head")}</div>`;
  if (s.type === "quote") {
    const text = /["“”]/.test(s.text) ? keyed(s.text) : `&ldquo;${keyed(s.text)}&rdquo;`;
    return `<div class="g-box g-note">${line(text, "nb-quote")}${s.eyebrow ? line(esc(s.eyebrow), "nb-label") : ""}</div>`;
  }
  if (s.type === "list" || s.type === "steps") {
    const rows = (s.items || []).map((it, k) => {
      const lead = s.type === "steps" ? `<span class="nb-pill">${k + 1}</span>` : it.state === "check" || it.state === "strike" ? "" : `${k + 1}. `;
      const st = it.state === "check" ? " nb-check" : it.state === "strike" ? " nb-strike" : "";
      return `<div class="nb-line g-in nb-item${st}"><span class="nb">${lead}${esc(it.text)}</span></div>`;
    }).join("");
    return `<div class="g-box g-note g-note-list">${label}${s.title ? line(keyed(s.title), "nb-head") : ""}${rows}</div>`;
  }
  if (s.type === "compare") {
    const col = (x, cls) => `<div class="nb-col ${cls}">${line(`${esc(x.label)}`, "nb-label nb-side")}${x.value ? line(esc(x.value)) : ""}${x.note ? line(esc(x.note)) : ""}</div>`;
    return `<div class="g-box g-note">${s.title ? line(keyed(s.title), "nb-head") : label}<div class="nb-cols">${col(s.a, "nb-a")}${col(s.b, "nb-b")}</div></div>`;
  }
  if (s.type === "bars") {
    const rows = (s.items || []).map((it, k) => line(`${esc(it.label)}: ${esc(it.value)}${esc(s.unit || "")}`, k === s.emphasize ? "nb-check" : "")).join("");
    return `<div class="g-box g-note g-note-list">${s.title ? line(keyed(s.title), "nb-head") : label}${rows}</div>`;
  }
  return null; // message and post restyle the regular markup
}

/* ---------------------------------------------------------------- styles */

/** CSS for the brand skins in use (layered over the overlay card styles, like skinsCSS). */
export function brandSkinsCSS({ H, colors, skins = [] }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  const has = new Set(skins);
  const band = `linear-gradient(transparent 56%, ${c.accent} 56%, ${c.accent} 92%, transparent 92%)`;
  const out = [];
  if (has.has("atelier")) {
    const s = ".gfx.skin-atelier";
    out.push(`
      ${s}::after { background: none; }
      ${s} .g-box { left: 7%; right: 7%; top: 14%; bottom: auto; max-height: 42%; padding: ${px(58)} ${px(62)} ${px(54)}; gap: ${px(22)}; border-radius: 0; background: ${PAPER}f7; color: ${INK}; border: none; box-shadow: 0 ${px(12)} ${px(44)} rgba(17,17,17,0.16); align-items: flex-start; text-align: left; font-family: "Look Sans", sans-serif; }
      ${s} .g-box::before { content: ""; position: absolute; inset: ${px(14)}; border: ${px(1.5)} solid rgba(17,17,17,0.55); pointer-events: none; }
      ${s} .g-eyebrow { align-self: stretch; gap: 0; padding-bottom: ${px(13)}; border-bottom: ${px(1.5)} solid ${INK}; font-family: "Look Sans", sans-serif; font-size: ${px(25)}; font-weight: 600; letter-spacing: 0.32em; color: rgba(17,17,17,0.72); }
      ${s} .g-dot { display: none; }
      ${s} .g-headline { font-family: "Look Serif", serif; font-weight: 500; font-size: ${px(82)}; line-height: 1.08; letter-spacing: -0.01em; text-transform: none; text-align: left; color: ${INK}; }
      ${s} .g-chapter .g-headline { font-size: ${px(88)}; }
      ${s} .g-title { font-family: "Look Serif", serif; font-weight: 500; font-size: ${px(64)}; line-height: 1.1; letter-spacing: -0.005em; text-transform: none; color: ${INK}; }
      ${s} .g-gold { color: ${INK}; font-style: italic; background-image: ${band}; -webkit-box-decoration-break: clone; box-decoration-break: clone; padding: 0 0.06em; }
      ${s} .g-rule { width: 12%; height: ${px(6)}; border-radius: 0; background: ${c.accent}; transform-origin: 0 50%; }
      ${s} .g-stat, ${s} .g-stat2 { font-family: "Look Serif", serif; font-weight: 400; color: ${INK}; text-shadow: none; letter-spacing: -0.01em; font-variant-numeric: lining-nums tabular-nums; }
      ${s} .g-sym { font-size: 0.5em; align-self: flex-start; margin-top: 0.12em; }
      ${s} .g-arrow { color: ${INK}; font-family: "Look Serif", serif; font-style: italic; text-transform: none; letter-spacing: 0; font-weight: 400; }
      ${s} .g-fill { width: 100%; height: ${px(6)}; border-radius: 0; background: rgba(17,17,17,0.08); }
      ${s} .g-ring { background: conic-gradient(from -90deg, ${c.accent} 0 var(--ring), rgba(17,17,17,0.1) var(--ring) 100%); }
      ${s} .g-sub { font-family: "Look Sans", sans-serif; font-size: ${px(36)}; font-weight: 500; color: rgba(17,17,17,0.72); opacity: 1; }
      ${s} .g-rows { gap: 0; align-self: stretch; }
      ${s} .g-row, ${s} .g-row.g-check { padding: ${px(18)} 0; gap: ${px(22)}; border: none; border-bottom: ${px(1.5)} solid rgba(17,17,17,0.18); border-radius: 0; background: none; box-shadow: none; font-family: "Look Sans", sans-serif; font-size: ${px(44)}; font-weight: 500; text-transform: none; color: ${INK}; }
      ${s} .g-mark { width: auto; min-width: ${px(46)}; font-weight: 400; color: ${INK}; }
      ${s} .g-num { font-family: "Look Serif", serif; font-style: italic; font-size: ${px(40)}; letter-spacing: 0.02em; }
      ${s} .g-mark.g-check { min-width: 0; width: ${px(26)}; height: ${px(26)}; margin: 0 ${px(10)}; border-radius: 50%; background: ${c.accent}; color: ${INK}; font-size: ${px(16)}; line-height: ${px(26)}; font-weight: 700; }
      ${s} .g-mark.g-x { font-size: ${px(26)}; opacity: 0.45; }
      ${s} .g-strike-line { height: ${px(2)}; background: ${INK}; }
      ${s} .g-tag { color: ${INK}; }
      ${s} .g-icon path { stroke: ${INK}; stroke-width: 1.5; }
      ${s} .g-paper { width: 100%; padding: ${px(70)} 0 0; background: none; box-shadow: none; transform: none; color: ${INK}; }
      ${s} .g-paper::before { content: "\\201C"; position: absolute; left: ${px(-6)}; top: ${px(-36)}; font-family: "Look Serif", serif; font-style: italic; font-size: ${px(172)}; line-height: 1; color: ${c.accent}; }
      ${s} .g-paper-eyebrow { order: 2; margin: ${px(22)} 0 0; font-family: "Look Sans", sans-serif; font-size: ${px(25)}; font-weight: 600; letter-spacing: 0.3em; opacity: 0.72; }
      ${s} .g-paper { display: flex; flex-direction: column; }
      ${s} .g-quote { font-family: "Look Serif", serif; font-weight: 400; font-size: ${px(64)}; line-height: 1.2; letter-spacing: -0.005em; text-transform: none; }
      ${s} .g-hl { font-style: italic; }
      ${s} .g-paper-mark { display: none; }
      ${s} .g-steps { flex-direction: column; align-items: flex-start; gap: 0; }
      ${s} .g-node, ${s} .g-node-last { flex: none; flex-direction: row; justify-content: flex-start; gap: ${px(22)}; padding: ${px(8)} 0; background: none; border: none; box-shadow: none; font-family: "Look Sans", sans-serif; font-size: ${px(42)}; font-weight: 500; text-transform: none; text-align: left; color: ${INK}; }
      ${s} .g-node-num { flex: none; display: grid; place-items: center; width: ${px(58)}; height: ${px(58)}; border: ${px(1.5)} solid ${INK}; border-radius: 50%; font-family: "Look Serif", serif; font-style: italic; font-size: ${px(30)}; letter-spacing: 0; color: ${INK}; }
      ${s} .g-node-last .g-node-num { background: ${c.accent}; border-color: ${c.accent}; }
      ${s} .g-link { align-self: flex-start; width: ${px(1.5)}; height: ${px(24)}; margin-left: ${px(29)}; background: ${INK}; transform-origin: 50% 0; }
      ${s} .g-compare { gap: 0; align-self: stretch; }
      ${s} .g-side { padding: ${px(22)} ${px(26)}; min-height: 0; border: none; border-radius: 0; background: none; }
      ${s} .g-side-a { border-right: ${px(1.5)} solid ${INK}; }
      ${s} .g-side-b { background: ${c.accent}59; }
      ${s} .g-side-label { font-family: "Look Sans", sans-serif; font-size: ${px(25)}; font-weight: 600; letter-spacing: 0.22em; color: ${INK}; opacity: 0.6; }
      ${s} .g-side-b .g-side-label { color: ${INK}; opacity: 1; }
      ${s} .g-side-value { font-family: "Look Serif", serif; font-weight: 400; font-size: ${px(76)}; color: ${INK}; }
      ${s} .g-side-note { font-family: "Look Sans", sans-serif; font-size: ${px(36)}; font-weight: 500; color: ${INK}; opacity: 0.62; }
      ${s} .g-side-b .g-side-note { opacity: 1; }
      ${s} .g-side-bar { border-radius: 0; background: rgba(17,17,17,0.08); }
      ${s} .g-side-fill { background: ${INK}; opacity: 0.8; }
      ${s} .g-side-b .g-side-fill { background: ${INK}; }
      ${s} .g-vs { display: none; }
      ${s} .g-bars { gap: ${px(18)}; }
      ${s} .g-bar-label { font-family: "Look Sans", sans-serif; font-size: ${px(36)}; font-weight: 500; text-transform: none; color: ${INK}; opacity: 1; }
      ${s} .g-bar-value { font-family: "Look Serif", serif; font-size: ${px(46)}; font-weight: 400; color: ${INK}; }
      ${s} .g-bar-hi .g-bar-label, ${s} .g-bar-hi .g-bar-value { color: ${INK}; }
      ${s} .g-bar-track { height: ${px(17)}; border-radius: 0; background: rgba(17,17,17,0.08); }
      ${s} .g-bar-fill { border-radius: 0; background: rgba(17,17,17,0.8); }
      ${s} .g-bar-hi .g-bar-fill { background: ${c.accent}; }
      ${s} .g-thread { font-family: "Look Sans", sans-serif; }
      ${s} .g-thread-head { font-size: ${px(27)}; font-weight: 600; color: ${INK}; opacity: 1; }
      ${s} .g-avatar { background: ${c.accent}; color: ${INK}; font-family: "Look Serif", serif; font-weight: 500; }
      ${s} .g-bubble { font-size: ${px(38)}; font-weight: 500; border-radius: ${px(36)}; }
      ${s} .g-bubble.g-them, ${s} .g-typing { background: #FFFFFF; color: ${INK}; box-shadow: inset 0 0 0 ${px(1.5)} rgba(17,17,17,0.12); }
      ${s} .g-bubble.g-me { background: ${c.accent}; color: ${INK}; }
      ${s} .g-post { padding: 0; background: none; border: none; box-shadow: none; }
      ${s} .g-post-head { margin-bottom: ${px(20)}; padding-bottom: ${px(14)}; border-bottom: ${px(1.5)} solid ${INK}; }
      ${s} .g-post-avatar, ${s} .g-post-name, ${s} .g-post-foot { display: none; }
      ${s} .g-post-handle { font-family: "Look Sans", sans-serif; font-size: ${px(25)}; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: ${INK}; }
      ${s} .g-post-text { font-family: "Look Serif", serif; font-size: ${px(58)}; font-weight: 400; line-height: 1.2; color: ${INK}; }`);
  }
  if (has.has("note")) {
    const s = ".gfx.skin-note";
    out.push(`
      ${s}::after { background: none; }
      ${s} .g-box { left: 9%; right: 9%; top: 14%; bottom: auto; max-height: 46%; padding: 0; gap: ${px(6)}; border: none; border-radius: 0; background: none; box-shadow: none; color: ${INK}; align-items: center; text-align: center; font-family: "Look Sans", sans-serif; }
      ${s} .g-note-list { align-items: flex-start; text-align: left; }
      ${s} .nb-line { max-width: 100%; line-height: 1.5; }
      ${s} .nb { display: inline; padding: 0.2em 0.42em; border-radius: 0.3em; background: #FFFFFF; color: ${INK}; -webkit-box-decoration-break: clone; box-decoration-break: clone; box-shadow: 0 ${px(4)} ${px(16)} rgba(0,0,0,0.12); font-size: ${px(42)}; font-weight: 500; letter-spacing: 0; text-transform: none; }
      ${s} .nb-head .nb { font-size: ${px(52)}; font-weight: 600; letter-spacing: -0.005em; }
      ${s} .nb-label .nb { font-size: ${px(28)}; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
      ${s} .nb-quote .nb { font-family: "Look Serif", serif; font-style: italic; font-weight: 500; font-size: ${px(52)}; }
      ${s} .nb-big { line-height: 1.2; margin: ${px(6)} 0; }
      ${s} .nb-big .nb { display: inline-block; padding: 0.06em 0.3em; }
      ${s} .nb-stat { display: inline-flex; font-family: "Look Serif", serif; font-weight: 600; font-size: ${px(110)} !important; color: ${INK}; text-shadow: none; letter-spacing: -0.01em; }
      ${s} .nb-key, ${s} .nb-check .nb { background: ${c.accent}; color: ${INK}; }
      ${s} .nb-key { padding: 0 0.16em; border-radius: 0.2em; }
      ${s} .nb-strike .nb { color: rgba(17,17,17,0.5); text-decoration: line-through ${px(2)} ${INK}; }
      ${s} .nb-pill { display: inline-block; margin-right: 0.35em; padding: 0 0.45em; border-radius: 999px; background: ${INK}; color: ${PAPER}; font-size: 0.85em; font-weight: 600; }
      ${s} .nb-cols { display: grid; grid-template-columns: 1fr 1fr; gap: ${px(24)}; align-self: stretch; margin-top: ${px(10)}; text-align: left; }
      ${s} .nb-col { display: flex; flex-direction: column; align-items: flex-start; gap: ${px(6)}; }
      ${s} .nb-col .nb { font-size: ${px(38)}; }
      ${s} .nb-col .nb-label .nb { font-size: ${px(28)}; }
      ${s} .nb-b .nb-side .nb { background: ${c.accent}; }
      ${s} .g-thread { padding: ${px(30)} ${px(30)} ${px(34)}; border-radius: ${px(50)}; background: #FFFFFF; box-shadow: 0 ${px(14)} ${px(40)} rgba(0,0,0,0.22); font-family: "Look Sans", sans-serif; text-align: left; }
      ${s} .g-eyebrow { display: none; }
      ${s} .g-thread-head { font-size: ${px(29)}; font-weight: 600; color: ${INK}; opacity: 1; }
      ${s} .g-avatar { background: ${c.accent}; color: ${INK}; font-family: "Look Serif", serif; }
      ${s} .g-bubble { font-size: ${px(38)}; font-weight: 500; }
      ${s} .g-bubble.g-them, ${s} .g-typing { background: #E9E9EB; color: ${INK}; }
      ${s} .g-bubble.g-me { background: ${c.accent}; color: ${INK}; }
      ${s} .g-post { padding: ${px(30)} ${px(32)}; border-radius: ${px(38)}; background: #FFFFFF; border: none; box-shadow: 0 ${px(14)} ${px(40)} rgba(0,0,0,0.22); }
      ${s} .g-post-avatar { background: ${c.accent}; }
      ${s} .g-post-name { font-family: "Look Sans", sans-serif; font-size: ${px(27)}; font-weight: 600; color: ${INK}; }
      ${s} .g-post-badge, ${s} .g-post-foot { display: none; }
      ${s} .g-post-handle { color: rgba(17,17,17,0.55); }
      ${s} .g-post-text { font-family: "Look Sans", sans-serif; font-size: ${px(42)}; font-weight: 500; color: ${INK}; }`);
  }
  if (has.has("serifonlife")) {
    const s = ".gfx.skin-serifonlife";
    out.push(`
      ${s}::after { background: none; }
      ${s} .g-box { left: 8%; right: 8%; top: 15%; bottom: auto; max-height: 44%; padding: ${px(40)} ${px(30)}; gap: ${px(20)}; border: none; border-radius: 0; background: radial-gradient(ellipse at 50% 50%, rgba(17,17,17,0.62) 0%, rgba(17,17,17,0.42) 45%, rgba(17,17,17,0) 74%); box-shadow: none; color: #FFFFFF; align-items: center; text-align: center; font-family: "Look Sans", sans-serif; text-shadow: 0 ${px(2)} ${px(4)} rgba(0,0,0,0.55), 0 ${px(2)} ${px(18)} rgba(0,0,0,0.5); }
      ${s}::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 52%; background: linear-gradient(180deg, rgba(17,17,17,0.38) 0%, rgba(17,17,17,0.22) 60%, rgba(17,17,17,0) 100%); pointer-events: none; }
      ${s} .g-eyebrow { gap: 0; font-family: "Look Sans", sans-serif; font-size: ${px(25)}; font-weight: 500; letter-spacing: 0.3em; color: rgba(255,255,255,0.88); }
      ${s} .g-dot { display: none; }
      ${s} .g-headline { font-family: "Look Serif", serif; font-weight: 500; font-size: ${px(80)}; line-height: 1.16; letter-spacing: -0.005em; text-transform: none; text-align: center; color: #FFFFFF; }
      ${s} .g-chapter .g-headline { font-size: ${px(92)}; font-style: italic; }
      ${s} .g-title { font-family: "Look Serif", serif; font-weight: 500; font-size: ${px(60)}; line-height: 1.14; text-transform: none; color: #FFFFFF; }
      ${s} .g-gold { color: #FFFFFF; font-style: italic; text-decoration: underline ${px(5)} ${c.accent}; text-underline-offset: 0.14em; text-decoration-skip-ink: none; }
      ${s} .g-rule { width: 10%; height: ${px(2)}; border-radius: 0; background: rgba(255,255,255,0.7); }
      ${s} .g-stat, ${s} .g-stat2 { font-family: "Look Serif", serif; font-weight: 400; color: #FFFFFF; text-shadow: 0 ${px(2)} ${px(14)} rgba(0,0,0,0.4); }
      ${s} .g-arrow { color: #FFFFFF; font-family: "Look Serif", serif; font-style: italic; text-transform: none; letter-spacing: 0; font-weight: 400; }
      ${s} .g-fill, ${s} .g-ring { display: none; }
      ${s} .g-sub { font-family: "Look Sans", sans-serif; font-size: ${px(26)}; font-weight: 500; letter-spacing: 0.26em; text-transform: uppercase; opacity: 0.9; }
      ${s} .g-rows { gap: ${px(4)}; align-self: stretch; padding: 0 4%; }
      ${s} .g-row, ${s} .g-row.g-check { padding: ${px(10)} 0; gap: ${px(22)}; border: none; border-radius: 0; background: none; box-shadow: none; font-family: "Look Sans", sans-serif; font-size: ${px(42)}; font-weight: 500; text-transform: none; text-align: left; color: #FFFFFF; }
      ${s} .g-mark, ${s} .g-check, ${s} .g-num { width: auto; min-width: ${px(44)}; color: #FFFFFF; font-family: "Look Serif", serif; font-style: italic; font-weight: 400; font-size: ${px(40)}; }
      ${s} .g-strike-line { height: ${px(2)}; background: #FFFFFF; }
      ${s} .g-icon path { stroke: #FFFFFF; stroke-width: 1.5; }
      ${s} .g-paper { width: 100%; padding: 0; background: none; box-shadow: none; transform: none; color: #FFFFFF; text-align: center; display: flex; flex-direction: column; }
      ${s} .g-paper-eyebrow { order: 2; margin: ${px(22)} 0 0; font-size: ${px(25)}; font-weight: 500; letter-spacing: 0.3em; opacity: 0.88; }
      ${s} .g-quote { font-family: "Look Serif", serif; font-style: italic; font-weight: 400; font-size: ${px(72)}; line-height: 1.2; text-transform: none; }
      ${s} .g-hl { background-image: linear-gradient(transparent calc(100% - ${px(5)}), ${c.accent} calc(100% - ${px(5)})); }
      ${s} .g-paper-mark { display: none; }
      ${s} .g-steps { flex-direction: column; align-items: flex-start; gap: 0; align-self: center; }
      ${s} .g-node, ${s} .g-node-last { flex: none; flex-direction: row; justify-content: flex-start; gap: ${px(22)}; padding: ${px(6)} 0; background: none; border: none; box-shadow: none; font-family: "Look Sans", sans-serif; font-size: ${px(42)}; font-weight: 500; text-transform: none; text-align: left; color: #FFFFFF; }
      ${s} .g-node-num { flex: none; width: ${px(48)}; font-family: "Look Serif", serif; font-style: italic; font-size: ${px(40)}; letter-spacing: 0; color: #FFFFFF; }
      ${s} .g-link { align-self: flex-start; width: ${px(1.5)}; height: ${px(22)}; margin-left: ${px(14)}; background: rgba(255,255,255,0.6); }
      ${s} .g-compare { gap: 0; align-self: stretch; }
      ${s} .g-side { padding: ${px(14)} ${px(26)}; min-height: 0; border: none; border-radius: 0; background: none; text-align: center; clip-path: none; }
      ${s} .g-side-a { border-right: ${px(1.5)} solid rgba(255,255,255,0.7); }
      ${s} .g-side-label, ${s} .g-side-b .g-side-label { font-family: "Look Sans", sans-serif; font-size: ${px(25)}; font-weight: 500; letter-spacing: 0.26em; color: #FFFFFF; opacity: 0.88; }
      ${s} .g-side-note { font-family: "Look Serif", serif; font-size: ${px(52)}; font-weight: 400; line-height: 1.15; opacity: 1; }
      ${s} .g-side-b .g-side-note { font-style: italic; text-decoration: underline ${px(4)} ${c.accent}; text-underline-offset: 0.14em; }
      ${s} .g-side-value { font-family: "Look Serif", serif; font-weight: 400; color: #FFFFFF; }
      ${s} .g-side-bar { height: ${px(3)}; border-radius: 0; background: rgba(255,255,255,0.2); }
      ${s} .g-side-fill, ${s} .g-side-b .g-side-fill { background: #FFFFFF; opacity: 1; }
      ${s} .g-vs { display: none; }
      ${s} .g-bar-label { font-family: "Look Sans", sans-serif; font-size: ${px(34)}; font-weight: 500; text-transform: none; opacity: 1; }
      ${s} .g-bar-value { font-family: "Look Serif", serif; font-weight: 400; }
      ${s} .g-bar-hi .g-bar-label, ${s} .g-bar-hi .g-bar-value { color: #FFFFFF; }
      ${s} .g-bar-track { height: ${px(3)}; border-radius: 0; background: rgba(255,255,255,0.2); }
      ${s} .g-bar-fill { border-radius: 0; background: #FFFFFF; }
      ${s} .g-bar-hi .g-bar-track { height: ${px(5)}; }
      ${s} .g-bar-hi .g-bar-fill { background: ${c.accent}; }
      ${s} .g-post { padding: 0; background: none; border: none; box-shadow: none; text-align: center; }
      ${s} .g-post-head { order: 2; justify-content: center; margin: ${px(18)} 0 0; }
      ${s} .g-post { display: flex; flex-direction: column; }
      ${s} .g-post-avatar, ${s} .g-post-name, ${s} .g-post-foot { display: none; }
      ${s} .g-post-handle { font-family: "Look Sans", sans-serif; font-size: ${px(25)}; font-weight: 500; letter-spacing: 0.3em; text-transform: uppercase; color: rgba(255,255,255,0.88); }
      ${s} .g-post-text { font-family: "Look Serif", serif; font-style: italic; font-size: ${px(66)}; font-weight: 400; line-height: 1.2; color: #FFFFFF; }`);
  }
  return out.join("");
}

/**
 * The house pieces restyled for a preset that uses the brand looks (graphics.includeLooks): the phone look's labels
 * in ink instead of accent text, its headings in the serif, and the name tag as a two-line serif credit beside a
 * thin accent line. Greg's presets never get this block.
 */
export function brandQuietCSS({ H, colors }) {
  const c = { accent: "#FFD600", text: "#FFFFFF", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  return `
      .gfx.skin-notes .n-bar { color: ${INK}; }
      .gfx.skin-notes .n-heading, .gfx.skin-notify .n-title { font-family: "Look Serif", serif; font-weight: 500; line-height: 1.18; padding-top: 0.06em; text-transform: none; letter-spacing: -0.005em; }
      .gfx.skin-phone .g-eyebrow { color: rgba(17,17,17,0.6); }
      .gfx.skin-notes .n-item, .gfx.skin-notify .n-body, .gfx.skin-notify .n-head { font-family: "Look Sans", sans-serif; }
      .gfx.skin-notify .n-title .g-gold, .gfx.skin-notes .n-heading .g-gold { background: ${c.accent}; color: ${INK}; font-style: italic; }
      .gfx.skin-notes .n-check .n-circle { background: ${c.accent}; border-color: ${c.accent}; }
      .lt-bar { width: ${px(4)}; border-radius: 0; }
      .lt-name { font-family: "Look Serif", serif; font-weight: 500; letter-spacing: -0.005em; }
      .lt-handle { font-family: "Look Sans", sans-serif; font-weight: 600; letter-spacing: 0.28em; text-transform: uppercase; color: ${c.text}; opacity: 0.88; }`;
}

/** Hook treatments for the brand looks (layered over the headline hook, like themeCSS). */
export function brandHookCSS({ H, colors, hook }) {
  const c = { accent: "#FFD600", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  const band = `linear-gradient(transparent 56%, ${c.accent} 56%, ${c.accent} 92%, transparent 92%)`;
  return {
    cream: `#hook.hook-t-cream #hook-scrim { display: none; }
      #hook.hook-t-cream #hook-lines { display: inline; padding: 0.16em 0.36em; background: ${PAPER}; -webkit-box-decoration-break: clone; box-decoration-break: clone; font-family: "Look Serif", serif; font-weight: 500; font-size: 0.74em; line-height: 1.5; letter-spacing: -0.01em; text-transform: none; -webkit-text-stroke: 0; text-shadow: none; color: ${INK}; }
      #hook.hook-t-cream #hook-lines .hw { margin: 0 0.02em; }
      #hook.hook-t-cream #hook-lines .hw.k { color: ${INK}; font-style: italic; font-size: 1em; background-image: ${band}; }
      #hook.hook-t-cream #hook-bar { width: 30%; height: ${px(2)}; margin-top: 0.5em; border-radius: 0; background: ${PAPER}; box-shadow: none; }`,
    linebox: `#hook.hook-t-linebox #hook-scrim, #hook.hook-t-linebox #hook-bar { display: none; }
      #hook.hook-t-linebox #hook-lines { display: inline; padding: 0.2em 0.42em; border-radius: 0.3em; background: #FFFFFF; -webkit-box-decoration-break: clone; box-decoration-break: clone; font-family: "Look Sans", sans-serif; font-weight: 600; font-size: 0.54em; line-height: 1.55; letter-spacing: -0.005em; text-transform: none; -webkit-text-stroke: 0; text-shadow: none; color: ${INK}; box-shadow: 0 ${px(4)} ${px(16)} rgba(0,0,0,0.12); }
      #hook.hook-t-linebox #hook-lines .hw { margin: 0 0.02em; }
      #hook.hook-t-linebox #hook-lines .hw.k { color: ${INK}; font-size: 1em; background: ${c.accent}; padding: 0 0.14em; border-radius: 0.2em; }`,
    quiet: `#hook.hook-t-quiet #hook-scrim { background: radial-gradient(ellipse at 50% 50%, rgba(17,17,17,0.6) 0%, rgba(17,17,17,0.38) 45%, rgba(17,17,17,0) 74%); }
      #hook.hook-t-quiet #hook-lines { font-family: "Look Serif", serif; font-weight: 500; font-size: 0.74em; line-height: 1.16; letter-spacing: -0.005em; text-transform: none; -webkit-text-stroke: 0; color: #FFFFFF; text-shadow: 0 ${px(2)} ${px(4)} rgba(0,0,0,0.55), 0 ${px(2)} ${px(18)} rgba(0,0,0,0.5); }
      #hook.hook-t-quiet #hook-lines .hw.k { color: #FFFFFF; font-style: italic; font-size: 1em; text-decoration: underline ${px(5)} ${c.accent}; text-underline-offset: 0.14em; }
      #hook.hook-t-quiet #hook-bar { width: 10%; height: ${px(2)}; border-radius: 0; background: rgba(255,255,255,0.7); box-shadow: none; }`,
  }[hook] || "";
}

/**
 * Quiet motion for the brand skins (runs in the card loop before the house motion; `quiet` is the skin name or "").
 * atelier fades up 28 px over 0.45 s on expo.out; note boxes pop on with no movement; serifonlife fades in from an
 * 8 px blur over 0.6 s. No bounce, no rotation, nothing over 1.02 scale.
 */
export const QUIET_JS = `
          const quiet = ${JSON.stringify(QUIET_SKINS)}.find((k) => el.classList.contains("skin-" + k)) || "";`;
