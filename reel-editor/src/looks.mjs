import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { esc } from "./text.mjs";

/**
 * Looks: the visual direction of a reel's overlay cards, picked from what the reel is about so reels never look the
 * same. Claude picks the look in the same call that writes the cards (graphics.mjs); each card type then gets the
 * look's skin for that type. Every skin takes its colors from the brand (text, accent, bg) and keeps one accent per
 * card, so the looks work for Greg's black and gold and for any brand kit.
 */

export const LOOKS = {
  receipts: {
    label: "Receipts",
    fits: "money, pricing, revenue, profit, what something costs, a P&L, deals, discounts, payment plans",
    skins: { stat: "notify", headline: "notify", bars: "receipt", list: "receipt", steps: "receipt", compare: "receipt", quote: "type", message: "phone", post: "glass", chapter: "type" },
  },
  phone: {
    label: "Phone",
    fits: "sales calls, DMs, texts, objections, follow-up, leads, booking, what a prospect or client says",
    skins: { stat: "notify", headline: "notify", quote: "notify", list: "notes", steps: "notes", compare: "notes", bars: "notes", message: "phone", post: "glass", chapter: "notify" },
  },
  fieldnotes: {
    label: "Field notes",
    fits: "discipline, habits, mindset, faith, a personal story, lessons learned, the morning routine, family",
    skins: { stat: "paper", headline: "paper", quote: "paper", list: "paper", steps: "paper", compare: "paper", bars: "paper", message: "phone", post: "paper", chapter: "paper" },
  },
  gregcard: {
    label: "Typewriter card",
    fits: "one conviction line, a hard truth, faith as conviction, a short punchy reel with one idea",
    skins: { stat: "type", headline: "type", quote: "type", list: "type", steps: "type", compare: "type", bars: "receipt", message: "phone", post: "type", chapter: "type" },
  },
  briefing: {
    label: "Briefing",
    fits: "leadership, systems, hiring, team structure, frameworks, a breakdown or explainer, the numbers behind a business",
    skins: { stat: "editorial", headline: "editorial", quote: "editorial", list: "editorial", steps: "editorial", compare: "editorial", bars: "editorial", message: "phone", post: "editorial", chapter: "editorial" },
  },
  press: {
    label: "Press sheet",
    fits: "a hard truth, myth-busting, a contrarian take, what nobody tells you, testimony, a bold claim",
    skins: { stat: "press", headline: "press", quote: "press", list: "press", steps: "press", compare: "press", bars: "press", message: "phone", post: "press", chapter: "press" },
  },
  shopfloor: {
    label: "Instrument panel",
    fits: "close rates, KPIs, scorecards, quotas, standards, the numbers on the board, diagnosing a problem",
    skins: { stat: "panel", headline: "panel", quote: "panel", list: "panel", steps: "panel", compare: "panel", bars: "panel", message: "phone", post: "panel", chapter: "panel" },
  },
  blueprint: {
    label: "Sales schematic",
    fits: "a framework, a sales process, a pipeline, cause and effect, how a system is built, a step-by-step",
    skins: { stat: "blueprint", headline: "blueprint", quote: "blueprint", list: "blueprint", steps: "blueprint", compare: "blueprint", bars: "blueprint", message: "phone", post: "blueprint", chapter: "blueprint" },
  },
  casefile: {
    label: "Case file",
    fits: "proof, evidence, what really happened, a call review, a case study, a before and after, receipts of a result",
    skins: { stat: "case", headline: "case", quote: "case", list: "case", steps: "case", compare: "case", bars: "case", message: "phone", post: "case", chapter: "case" },
  },
  redline: {
    label: "Coach's redline",
    fits: "reviewing a mistake, what not to do, breaking down a script or a call, correcting a bad habit",
    skins: { stat: "redline", headline: "redline", quote: "redline", list: "redline", steps: "redline", compare: "redline", bars: "redline", message: "phone", post: "redline", chapter: "redline" },
  },
  glass: {
    label: "Glass",
    fits: "anything that fits none of the others",
    skins: {},
  },
};

export const LOOK_IDS = Object.keys(LOOKS);

/**
 * The rest of a reel's design follows its look: the hook title's treatment, the caption marker shape, the climax
 * slam style, the b-roll grade and cut, and the camera move. Caption type and timing never change (readability).
 * grade: a HyperFrames color-grading preset for the b-roll (with intensity and film details).
 */
export const THEMES = {
  receipts: { hook: "type", marker: "box", slam: "type", grade: { preset: "bright-pop", intensity: 0.5 }, cut: "flash", zoom: "snap" },
  phone: { hook: "headline", marker: "underline", slam: "bubble", grade: { preset: "soft-boost", intensity: 0.55 }, cut: "blur", zoom: "camera" },
  fieldnotes: { hook: "marker", marker: "scribble", slam: "marker", grade: { preset: "vintage-wash", intensity: 0.6, details: { grain: 0.14, grainSize: 0.2, grainRoughness: 0.6 } }, cut: "blur", zoom: "camera" },
  gregcard: { hook: "type", marker: "underline", slam: "type", grade: { preset: "mono-fade", intensity: 0.75 }, cut: "hard", zoom: "snap" },
  briefing: { hook: "serif", marker: "box", slam: "serif", grade: { preset: "muted-editorial", intensity: 0.55, details: { vignette: 0.14, vignetteFeather: 0.7 } }, cut: "hard", zoom: "camera" },
  press: { hook: "stamp", marker: "box", slam: "ghost", grade: { preset: "mono-clean", intensity: 0.7, details: { grain: 0.18, grainSize: 0.24, grainRoughness: 0.7 } }, cut: "flash", zoom: "snap" },
  shopfloor: { hook: "panel", marker: "bracket", slam: "panel", grade: { preset: "deep-contrast", intensity: 0.6 }, cut: "hard", zoom: "snap" },
  blueprint: { hook: "headline", marker: "bracket", slam: "outline", grade: { preset: "muted-editorial", intensity: 0.5 }, cut: "blur", zoom: "camera" },
  casefile: { hook: "type", marker: "box", slam: "stamp", grade: { preset: "mono-fade", intensity: 0.6, details: { grain: 0.1 } }, cut: "hard", zoom: "snap" },
  redline: { hook: "redline", marker: "circle", slam: "redline", grade: { preset: "deep-contrast", intensity: 0.55 }, cut: "flash", zoom: "snap" },
  glass: null,
};

/** The font files a theme needs beyond the house fonts (the hook and slam treatments that use them). */
export function themeFontSkins(theme) {
  if (!theme) return [];
  const want = new Set();
  for (const k of [theme.hook, theme.slam]) {
    if (k === "type") want.add("type");
    if (k === "marker") want.add("paper");
    if (k === "serif") want.add("editorial");
    if (k === "panel") want.add("panel");
  }
  return [...want];
}

/**
 * Apply a look's theme to a reel's settings (a copy). Settings the user passed on the command line win: `keep`
 * names the ones to leave alone (zoomStyle, brollCut).
 */
export function applyTheme(style, look, { keep = {} } = {}) {
  const t = THEMES[look];
  if (!t) return style;
  const s = structuredClone(style);
  s.look = look;
  s.hook = { ...s.hook, treat: t.hook };
  s.captions = { ...s.captions, marker: t.marker };
  s.slams = { ...s.slams, style: t.slam };
  if (s.broll) {
    const base = s.broll.grade || {};
    s.broll.grade = { preset: t.grade.preset, intensity: t.grade.intensity, adjust: {}, details: { ...(base.details || {}), ...(t.grade.details || {}) } };
    if (!keep.brollCut) s.broll.cut = t.cut;
  }
  if (!keep.zoomStyle && s.zooms) s.zooms.style = t.zoom;
  return s;
}

/** Caption marker shapes (SVG path, viewBox) for the gold word, by theme. */
export const MARKERS = {
  underline: { box: "0 0 100 20", d: "M3 9 C 20 3, 36 14, 54 8 S 84 3, 97 10", cls: "an-underline" },
  scribble: { box: "0 0 100 24", d: "M3 8 C 22 2, 40 13, 60 7 S 88 4, 97 9 M8 18 C 28 13, 52 21, 92 15", cls: "an-underline" },
  box: { box: "0 0 100 60", d: "M4 8 L 96 5 L 97 54 L 3 56 Z", cls: "an-circle" },
  bracket: { box: "0 0 100 60", d: "M14 4 L 4 4 L 4 56 L 14 56 M86 4 L 96 4 L 96 56 L 86 56", cls: "an-circle" },
  circle: { box: "0 0 100 60", d: "M8 31 C 9 11, 36 3, 58 6 C 84 9, 98 19, 96 33 C 94 49, 70 58, 46 56 C 22 54, 4 45, 6 31 C 8 19, 24 11, 44 9", cls: "an-circle" },
};

/** The skin a card gets in a look. */
export const skinFor = (look, type) => (LOOKS[look]?.skins?.[type]) || "glass";

/** Skins and fonts: which font files a skin needs (in assets/fonts) and the family name it uses. */
export const SKIN_FONTS = {
  panel: [["Courier Prime", "CourierPrime-Regular.ttf", 400], ["Courier Prime", "CourierPrime-Bold.ttf", 700]],
  case: [["Courier Prime", "CourierPrime-Regular.ttf", 400], ["Courier Prime", "CourierPrime-Bold.ttf", 700]],
  type: [["Courier Prime", "CourierPrime-Regular.ttf", 400], ["Courier Prime", "CourierPrime-Bold.ttf", 700]],
  receipt: [["Courier Prime", "CourierPrime-Regular.ttf", 400], ["Courier Prime", "CourierPrime-Bold.ttf", 700]],
  paper: [["Permanent Marker", "PermanentMarker-Regular.ttf", 400]],
  editorial: [["DM Serif Display", "DMSerifDisplay-Regular.ttf", 400]],
};

/* ---------------------------------------------------------------- variety memory */

const RECENT = () => path.join(process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "looks-recent.json");

export function recentLooks(n = 6) {
  try { return JSON.parse(fs.readFileSync(RECENT(), "utf8")).slice(-n); } catch { return []; }
}

export function rememberLook(look) {
  try {
    const list = [...recentLooks(20), look].slice(-20);
    fs.mkdirSync(path.dirname(RECENT()), { recursive: true });
    fs.writeFileSync(RECENT(), JSON.stringify(list));
  } catch {}
}

/** The lines added to the card prompt: the catalog, the recent looks to avoid, the reply field. */
export function looksPrompt(recent = [], { exclude = [] } = {}) {
  return [
    "Also pick ONE look for all the cards of this reel, from what the reel is about. Looks:",
    ...LOOK_IDS.filter((id) => !exclude.includes(id)).map((id) => `- ${id}: ${LOOKS[id].label}, for ${LOOKS[id].fits}`),
    recent.length ? `The last reels used, most recent last: ${recent.join(", ")}. Do not use any of the last three (${recent.slice(-3).join(", ")}), and prefer a look not in the list at all, unless this reel's topic plainly calls for one of them.` : "",
    'Put it in the reply as "look": "<id>", with "lookWhy": a short reason tied to the topic.',
  ].filter(Boolean).join("\n");
}

/** A look from Claude's reply, checked; otherwise one from the topic words, never the most recent. */
export function pickLook(reply, { transcript = "", recent = [], exclude = [] } = {}) {
  const asked = String(reply?.look || "").toLowerCase().replace(/[^a-z]/g, "");
  if (LOOKS[asked] && !exclude.includes(asked)) return { look: asked, why: String(reply?.lookWhy || "").trim(), source: "claude" };
  const t = transcript.toLowerCase();
  const score = (id) => LOOKS[id].fits.split(/,\s*/).reduce((a, w) => a + (t.includes(w.split(" ").pop()) ? 1 : 0), 0);
  const cool = new Set(recent.slice(-3));
  const ranked = LOOK_IDS.filter((id) => id !== "glass" && !cool.has(id) && !exclude.includes(id)).sort((a, b) => score(b) - score(a));
  return { look: ranked[0] || "glass", why: "picked from the topic words", source: "fallback" };
}

/* ---------------------------------------------------------------- artifact markup */

const marked = (s, cls) => esc(s).replace(/\*([^*]+)\*/g, `<span class="${cls}">$1</span>`).replace(/\*/g, "");
const plain = (s) => String(s || "").replace(/\*/g, "");
// Sentence case for the typewriter: the cards are written in caps-friendly fragments.
const sentence = (s) => { const t = plain(s).trim(); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
const chars = (s, cls = "") => [...String(s)].map((ch) => (ch === " " ? `<span class="t-ch t-sp${cls}"> </span>` : `<span class="t-ch${cls}">${esc(ch)}</span>`)).join("");
const glyph = { stat: "$", headline: "!", quote: "“", post: "@", chapter: "#" };

/**
 * Card HTML for skins that reshape a card into an artifact (a notification, a Notes list, a receipt, a typed card).
 * Returns null when the skin only restyles the regular markup (paper, editorial, phone, glass). `statHTML` is the
 * regular stat number, passed in so its schema-specific motion keeps working.
 */
export function skinHTML(s, skin, { statHTML }) {
  const live = (s.type === "list" || s.type === "steps") && s.items?.length && s.items.every((it) => Number.isFinite(it.at));
  const liveRow = (html, k) => `<div class="g-live-item">${k ? '<span class="g-live-connector"></span>' : ""}<span class="g-item-dot"></span>${html}</div>`;
  if (skin === "notify") {
    const app = plain(s.eyebrow || "Update").toLowerCase().replace(/^./, (c) => c.toUpperCase());
    const title = s.type === "stat" ? statHTML(s.value, Math.round(Math.min(130, 900 / Math.max(1, String(s.value).length)))) : `<div class="n-title">${marked(s.text || s.title || s.value || "", "g-gold")}</div>`;
    const body = s.type === "stat" ? (s.sub ? `<div class="n-body g-in">${esc(s.sub)}</div>` : "") : s.sub ? `<div class="n-body g-in">${esc(s.sub)}</div>` : "";
    return `<div class="g-box g-notify g-drop"><div class="n-head g-in"><span class="n-icon">${glyph[s.type] || "•"}</span><span class="n-app">${esc(app)}</span><span class="n-time">now</span></div><div class="n-main g-in">${title}</div>${body}</div>`;
  }
  if (skin === "notes") {
    let items = [];
    if (s.type === "compare") items = [{ text: [s.a?.label, s.a?.note].filter(Boolean).join(": "), state: "strike" }, { text: [s.b?.label, s.b?.note].filter(Boolean).join(": "), state: "check" }];
    else if (s.type === "bars") items = (s.items || []).map((it, k) => ({ text: `${it.label}: ${it.value}${s.unit || ""}`, state: k === s.emphasize ? "check" : "plain" }));
    else items = (s.items || []).map((it, k) => ({ text: s.type === "steps" ? `${k + 1}. ${it.text}` : it.text, state: it.state || "plain" }));
    const rows = items.map((it, k) => live ? liveRow(`<div class="n-item n-${it.state} g-item-text"><span class="n-text">${esc(it.text)}${it.state === "strike" ? '<span class="g-strike-line"></span>' : ""}</span></div>`, k) : `<div class="n-item g-in n-${it.state}"><span class="n-circle"></span><span class="n-text">${esc(it.text)}${it.state === "strike" ? '<span class="g-strike-line"></span>' : ""}</span></div>`).join("");
    return `<div class="g-box g-notes"><div class="n-bar g-in"><span class="n-back">‹ Notes</span><span class="n-done">Done</span></div><div class="n-heading g-in">${marked(s.title || s.eyebrow || "", "g-gold")}</div><div class="n-list">${rows}</div></div>`;
  }
  if (skin === "receipt") {
    let rows = [], total = null;
    if (s.type === "bars") { rows = (s.items || []).map((it, k) => [it.label, `${it.value}${s.unit || ""}`, k === s.emphasize]); const e = (s.items || [])[s.emphasize ?? -1]; if (e) total = [e.label, `${e.value}${s.unit || ""}`]; }
    else if (s.type === "compare") rows = [[s.a?.label, s.a?.value || s.a?.note || "", false], [s.b?.label, s.b?.value || s.b?.note || "", true]];
    else if (s.type === "stat") total = [s.sub || "Total", s.value];
    else rows = (s.items || []).map((it, k) => [s.type === "steps" ? `${k + 1}. ${it.text}` : it.text, it.tag || (it.state === "check" ? "✓" : it.state === "strike" ? "✕" : ""), it.state === "check"]);
    const row = ([a, b, hi], k) => live ? liveRow(`<div class="r-row g-item-text${hi ? " r-hi" : ""}"><span class="r-l">${esc(a || "")}</span><span class="r-dots"></span><span class="r-r">${esc(b || "")}</span></div>`, k) : `<div class="r-row g-in${hi ? " r-hi" : ""}"><span class="r-l">${esc(a || "")}</span><span class="r-dots"></span><span class="r-r">${esc(b || "")}</span></div>`;
    const totalHTML = total ? `<div class="r-total g-in"><span class="r-l">${esc(total[0])}</span>${statHTML(total[1], 92, " r-total-v")}</div>` : "";
    return `<div class="g-box g-receipt"><div class="r-head g-in">${esc(plain(s.eyebrow || s.title || "Receipt"))}</div>${s.title && s.eyebrow ? `<div class="r-sub g-in">${esc(plain(s.title))}</div>` : ""}<div class="r-rule g-in"></div>${rows.map(row).join("")}${rows.length && total ? '<div class="r-rule g-in"></div>' : ""}${totalHTML}<div class="r-foot g-in">* * * thank you * * *</div></div>`;
  }
  if (skin === "type") {
    if (s.type === "stat" && s.motion) {
      const value = statHTML(s.value, Math.round(Math.min(130, 900 / Math.max(1, String(s.motion === "growth" ? s.value2 : s.value).length))));
      return `<div class="g-box g-type-card"><div class="t-text">${value}</div>${s.sub ? `<div class="t-line g-in">${esc(sentence(s.sub))}</div>` : ""}${s.eyebrow ? `<div class="t-sign g-in">— ${esc(plain(s.eyebrow).toLowerCase())}</div>` : ""}</div>`;
    }
    let text;
    if (s.type === "list" || s.type === "steps") text = (s.items || []).map((it) => `— ${sentence(it.text)}`).join("\n");
    else if (s.type === "compare") text = `${sentence(s.a?.label)}${s.a?.note ? `: ${plain(s.a.note)}` : ""}.\n${sentence(s.b?.label)}${s.b?.note ? `: ${plain(s.b.note)}` : ""}.`;
    else if (s.type === "stat") text = `${plain(s.value)}${s.value2 ? ` → ${plain(s.value2)}` : ""}.${s.sub ? `\n${sentence(s.sub)}` : ""}`;
    else text = sentence(s.text || s.title || "");
    const lines = text.split("\n").map((l, k) => live ? liveRow(`<div class="t-line g-item-text">${esc(l)}</div>`, k) : `<div class="t-line">${chars(l)}</div>`).join("");
    return `<div class="g-box g-type-card"><div class="t-text">${lines}</div>${s.eyebrow ? `<div class="t-sign g-in">— ${esc(plain(s.eyebrow).toLowerCase())}</div>` : ""}</div>`;
  }
  return null;
}

/* ---------------------------------------------------------------- styles */

/** CSS for the skins in use, layered over the overlay cards (specific enough to win over the base styles). */
export function skinsCSS({ H, colors, skins = [] }) {
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", stroke: "#000000", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  const has = new Set(skins);
  const out = [];
  if (has.has("notify")) out.push(`
      .gfx.skin-notify::after { background: linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 30%); }
      .gfx.skin-notify .g-box { left: 3.5%; right: 3.5%; top: 4.5%; padding: ${px(30)} ${px(34)} ${px(34)}; gap: ${px(10)}; border-radius: ${px(44)}; background: rgba(246,246,248,0.9); color: #111; border: none; box-shadow: 0 ${px(18)} ${px(60)} rgba(0,0,0,0.45); backdrop-filter: blur(${px(24)}); align-items: stretch; text-align: left; }
      .gfx.skin-notify .n-head { display: flex; align-items: center; gap: ${px(16)}; font-size: ${px(30)}; color: #555; font-weight: 600; }
      .gfx.skin-notify .n-icon { width: ${px(58)}; height: ${px(58)}; border-radius: ${px(14)}; background: ${c.accent}; color: ${c.bg}; display: grid; place-items: center; font-weight: 900; font-size: ${px(34)}; }
      .gfx.skin-notify .n-app { flex: 1; text-transform: none; letter-spacing: 0; }
      .gfx.skin-notify .n-time { font-size: ${px(26)}; color: #888; }
      .gfx.skin-notify .n-main .g-stat { color: #111; text-shadow: none; font-weight: 900; letter-spacing: -0.03em; }
      .gfx.skin-notify .n-title { font-size: ${px(60)}; font-weight: 800; line-height: 1.1; color: #111; text-transform: none; letter-spacing: -0.01em; }
      .gfx.skin-notify .n-title .g-gold { color: #111; background: ${c.accent}55; padding: 0 0.08em; border-radius: ${px(6)}; }
      .gfx.skin-notify .n-body { font-size: ${px(38)}; font-weight: 500; color: #333; line-height: 1.25; text-transform: none; }`);
  if (has.has("notes")) out.push(`
      .gfx.skin-notes .g-box { left: 5%; right: 5%; top: 4.5%; padding: ${px(26)} ${px(40)} ${px(38)}; gap: ${px(12)}; border-radius: ${px(30)}; background: #FFFFFF; color: #111; border: none; box-shadow: 0 ${px(18)} ${px(60)} rgba(0,0,0,0.5); align-items: stretch; text-align: left; }
      .gfx.skin-notes .n-bar { display: flex; justify-content: space-between; font-size: ${px(32)}; font-weight: 600; color: ${c.accent}; }
      .gfx.skin-notes .n-heading { font-size: ${px(60)}; font-weight: 800; line-height: 1.05; color: #111; text-transform: none; margin-bottom: ${px(6)}; }
      .gfx.skin-notes .n-heading .g-gold { color: #111; }
      .gfx.skin-notes .n-list { display: flex; flex-direction: column; }
      .gfx.skin-notes .n-item { display: flex; align-items: center; gap: ${px(22)}; padding: ${px(18)} 0; border-bottom: ${px(2)} solid #E5E5EA; font-size: ${px(44)}; font-weight: 500; color: #111; text-transform: none; }
      .gfx.skin-notes .n-text { position: relative; }
      .gfx.skin-notes .n-circle { flex: none; width: ${px(40)}; height: ${px(40)}; border-radius: 50%; border: ${px(4)} solid #C7C7CC; }
      .gfx.skin-notes .n-check .n-circle { background: ${c.accent}; border-color: ${c.accent}; box-shadow: inset 0 0 0 ${px(7)} #fff; }
      .gfx.skin-notes .n-strike .n-text { color: #8E8E93; }
      .gfx.skin-notes .g-strike-line { background: #8E8E93; height: ${px(4)}; }`);
  if (has.has("receipt")) out.push(`
      .gfx.skin-receipt::after { background: linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 40%); }
      .gfx.skin-receipt .g-box { left: 10%; right: 10%; top: 3.5%; max-height: 44%; padding: ${px(40)} ${px(44)} ${px(56)}; gap: ${px(12)}; border-radius: 0; background: #F6F3EC; color: #161616; border: none; font-family: "Courier Prime", "Courier New", monospace; box-shadow: 0 ${px(22)} ${px(50)} rgba(0,0,0,0.5); align-items: stretch; text-align: left; -webkit-mask: radial-gradient(${px(14)} at 50% 100%, transparent 98%, #000) 50% 100% / ${px(28)} 51% repeat-x, linear-gradient(#000, #000) top / 100% calc(100% - ${px(13)}) no-repeat; transform: rotate(-0.8deg); }
      .gfx.skin-receipt .r-head { font-weight: 700; font-size: ${px(46)}; letter-spacing: 0.16em; text-transform: uppercase; text-align: center; }
      .gfx.skin-receipt .r-sub { font-size: ${px(36)}; text-align: center; opacity: 0.75; }
      .gfx.skin-receipt .r-rule { border-top: ${px(3)} dashed #161616; opacity: 0.55; margin: ${px(6)} 0; }
      .gfx.skin-receipt .r-row { display: flex; align-items: baseline; gap: ${px(12)}; font-size: ${px(46)}; text-transform: uppercase; }
      .gfx.skin-receipt .r-dots { flex: 1; border-bottom: ${px(3)} dotted #16161688; transform: translateY(-${px(8)}); }
      .gfx.skin-receipt .r-hi { font-weight: 700; }
      .gfx.skin-receipt .r-hi .r-r { background: ${c.accent}; padding: 0 0.2em; }
      .gfx.skin-receipt .r-total { display: flex; align-items: baseline; justify-content: space-between; gap: ${px(16)}; font-size: ${px(46)}; font-weight: 700; text-transform: uppercase; }
      .gfx.skin-receipt .r-total .g-stat { color: #161616; text-shadow: none; font-family: "Courier Prime", monospace; font-weight: 700; letter-spacing: -0.02em; }
      .gfx.skin-receipt .r-foot { text-align: center; font-size: ${px(26)}; letter-spacing: 0.2em; opacity: 0.6; margin-top: ${px(8)}; }`);
  if (has.has("type")) out.push(`
      .gfx.skin-type::after { background: none; }
      .gfx.skin-type .g-box { left: 6%; right: 6%; top: 5%; padding: ${px(48)} ${px(52)} ${px(44)}; gap: ${px(22)}; border-radius: ${px(6)}; background: rgba(0,0,0,0.9); color: #F2F0EA; border: ${px(2)} solid rgba(255,255,255,0.08); box-shadow: 0 ${px(24)} ${px(70)} rgba(0,0,0,0.6); align-items: stretch; text-align: left; }
      .gfx.skin-type .t-text { font-family: "Courier Prime", "Courier New", monospace; font-size: ${px(64)}; line-height: 1.32; white-space: pre-wrap; text-transform: none; }
      .gfx.skin-type .t-line + .t-line { margin-top: ${px(10)}; }
      .gfx.skin-type .t-ch { opacity: 0; }
      .gfx.skin-type .t-sign { font-family: "Courier Prime", monospace; font-size: ${px(32)}; color: ${c.accent}; text-transform: none; letter-spacing: 0.04em; }`);
  if (has.has("paper")) out.push(`
      .gfx.skin-paper::after { background: linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 40%); }
      .gfx.skin-paper .g-box { left: 6%; right: 6%; top: 5%; padding: ${px(54)} ${px(48)} ${px(48)}; border-radius: ${px(4)}; color: #1B1A17; border: none; box-shadow: 0 ${px(20)} ${px(50)} rgba(0,0,0,0.5); transform: rotate(-1.6deg); background: repeating-linear-gradient(0deg, rgba(60,90,140,0.13) 0 ${px(2)}, transparent ${px(2)} ${px(64)}), #F4EFE2; }
      .gfx.skin-paper .g-box::before, .gfx.skin-paper .g-box::after { content: ""; position: absolute; top: -${px(22)}; width: ${px(170)}; height: ${px(52)}; background: rgba(232,220,190,0.82); box-shadow: 0 ${px(2)} ${px(6)} rgba(0,0,0,0.15); }
      .gfx.skin-paper .g-box::before { left: ${px(40)}; transform: rotate(-5deg); }
      .gfx.skin-paper .g-box::after { right: ${px(40)}; transform: rotate(4deg); }
      .gfx.skin-paper .g-eyebrow { color: #1B1A17; opacity: 0.65; }
      .gfx.skin-paper .g-dot { background: ${c.accent}; box-shadow: none; }
      .gfx.skin-paper .g-headline, .gfx.skin-paper .g-title, .gfx.skin-paper .g-stat, .gfx.skin-paper .g-row, .gfx.skin-paper .g-node, .gfx.skin-paper .g-side-label, .gfx.skin-paper .g-side-value, .gfx.skin-paper .g-bar-label, .gfx.skin-paper .g-bar-value { font-family: "Permanent Marker", "Inter", sans-serif; font-weight: 400; color: #1B1A17; text-shadow: none; letter-spacing: 0; }
      .gfx.skin-paper .g-gold { color: #1B1A17; background: linear-gradient(transparent 55%, ${c.accent}cc 55%, ${c.accent}cc 90%, transparent 90%); }
      .gfx.skin-paper .g-row, .gfx.skin-paper .g-node, .gfx.skin-paper .g-side { background: none; border: none; box-shadow: none; padding-left: 0; }
      .gfx.skin-paper .g-row.g-check { box-shadow: none; }
      .gfx.skin-paper .g-check, .gfx.skin-paper .g-num, .gfx.skin-paper .g-node-num { color: ${c.accent}; font-family: "Permanent Marker", sans-serif; }
      .gfx.skin-paper .g-strike-line { background: ${c.accent}; height: ${px(7)}; border-radius: ${px(4)}; transform: rotate(-1.5deg); }
      .gfx.skin-paper .g-fill { background: rgba(0,0,0,0.12); }
      .gfx.skin-paper .g-fill-bar, .gfx.skin-paper .g-bar-fill, .gfx.skin-paper .g-side-fill, .gfx.skin-paper .g-rule { background: ${c.accent}; }
      .gfx.skin-paper .g-bar-track, .gfx.skin-paper .g-side-bar { background: rgba(0,0,0,0.1); }
      .gfx.skin-paper .g-paper { background: none; box-shadow: none; padding: 0; transform: none; width: 100%; }
      .gfx.skin-paper .g-quote { font-family: "Permanent Marker", sans-serif; font-weight: 400; color: #1B1A17; }
      .gfx.skin-paper .g-hl { background-image: linear-gradient(${c.accent}cc, ${c.accent}cc); }
      .gfx.skin-paper .g-sub, .gfx.skin-paper .g-side-note { color: #3a3833; opacity: 1; }
      .gfx.skin-paper .g-vs { background: #F4EFE2; }
      .gfx.skin-paper .g-post { background: none; border: none; box-shadow: none; padding: 0; }
      .gfx.skin-paper .g-post-name, .gfx.skin-paper .g-post-text { color: #1B1A17; }
      .gfx.skin-paper .g-post-text { font-family: "Permanent Marker", sans-serif; font-weight: 400; }`);
  if (has.has("editorial")) out.push(`
      .gfx.skin-editorial::after { background: linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 40%); }
      .gfx.skin-editorial .g-box { left: 5%; right: 5%; top: 4.5%; padding: ${px(44)} ${px(48)} ${px(46)}; border-radius: 0; background: #EFE8DA; color: #141311; border: none; border-top: ${px(14)} solid #141311; box-shadow: 0 ${px(20)} ${px(50)} rgba(0,0,0,0.45); }
      .gfx.skin-editorial .g-eyebrow { color: #141311; font-size: ${px(26)}; letter-spacing: 0.3em; padding-bottom: ${px(14)}; border-bottom: ${px(2)} solid #141311; align-self: stretch; }
      .gfx.skin-editorial .g-dot { width: ${px(22)}; height: ${px(22)}; border-radius: 0; background: ${c.accent}; box-shadow: none; }
      .gfx.skin-editorial .g-headline, .gfx.skin-editorial .g-title, .gfx.skin-editorial .g-quote, .gfx.skin-editorial .g-stat, .gfx.skin-editorial .g-side-value { font-family: "DM Serif Display", Georgia, serif; font-weight: 400; text-transform: none; letter-spacing: -0.01em; color: #141311; text-shadow: none; }
      .gfx.skin-editorial .g-gold { color: #141311; background: ${c.accent}; padding: 0 0.12em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
      .gfx.skin-editorial .g-row, .gfx.skin-editorial .g-node, .gfx.skin-editorial .g-side { background: none; border: none; border-bottom: ${px(2)} solid #14131133; border-radius: 0; box-shadow: none; padding-left: 0; text-transform: none; font-weight: 600; color: #141311; }
      .gfx.skin-editorial .g-row.g-check { box-shadow: none; }
      .gfx.skin-editorial .g-check, .gfx.skin-editorial .g-num, .gfx.skin-editorial .g-node-num { color: #141311; font-family: "DM Serif Display", serif; }
      .gfx.skin-editorial .g-strike-line { background: ${c.accent}; }
      .gfx.skin-editorial .g-fill { background: #14131122; }
      .gfx.skin-editorial .g-fill-bar, .gfx.skin-editorial .g-bar-fill, .gfx.skin-editorial .g-rule, .gfx.skin-editorial .g-side-b .g-side-fill { background: ${c.accent}; }
      .gfx.skin-editorial .g-bar-track, .gfx.skin-editorial .g-side-bar { background: #14131118; border-radius: 0; }
      .gfx.skin-editorial .g-bar-label, .gfx.skin-editorial .g-bar-value, .gfx.skin-editorial .g-side-label, .gfx.skin-editorial .g-sub, .gfx.skin-editorial .g-side-note { color: #141311; opacity: 1; }
      .gfx.skin-editorial .g-side-b { background: ${c.accent}22; }
      .gfx.skin-editorial .g-vs { background: #EFE8DA; color: #141311; border-color: #141311; }
      .gfx.skin-editorial .g-paper { background: none; box-shadow: none; padding: 0; transform: none; width: 100%; }
      .gfx.skin-editorial .g-paper-mark { display: none; }
      .gfx.skin-editorial .g-hl { background-image: linear-gradient(${c.accent}aa, ${c.accent}aa); background-position: 0 92%; }
      .gfx.skin-editorial .g-post { background: none; border: none; box-shadow: none; padding: 0; }
      .gfx.skin-editorial .g-post-name, .gfx.skin-editorial .g-post-text { color: #141311; font-family: "DM Serif Display", serif; font-weight: 400; }`);
  if (has.has("press")) out.push(`
      .gfx.skin-press::after { background: linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 40%); }
      .gfx.skin-press .g-box { left: 5%; right: 5%; top: 4.5%; padding: ${px(46)} ${px(46)} ${px(70)}; border-radius: 0; border: none; color: #111; box-shadow: none; filter: drop-shadow(0 ${px(14)} ${px(22)} rgba(0,0,0,0.5)); background: radial-gradient(circle, rgba(0,0,0,0.10) ${px(2)}, transparent ${px(3)}) 0 0 / ${px(11)} ${px(11)}, #F1ECDF; clip-path: polygon(0 0, 100% 0, 100% 93%, 93% 96%, 85% 94%, 76% 97.5%, 67% 94.5%, 58% 97%, 49% 93.5%, 40% 96.5%, 31% 94%, 22% 97.5%, 13% 94.5%, 5% 97%, 0 94%); }
      .gfx.skin-press .g-eyebrow { color: #111; border: ${px(4)} solid #111; padding: ${px(6)} ${px(14)}; letter-spacing: 0.2em; font-weight: 900; }
      .gfx.skin-press .g-dot { display: none; }
      .gfx.skin-press .g-headline, .gfx.skin-press .g-title, .gfx.skin-press .g-stat, .gfx.skin-press .g-quote, .gfx.skin-press .g-side-value, .gfx.skin-press .g-post-text { font-family: "Anton", sans-serif; font-weight: 400; text-transform: uppercase; letter-spacing: 0.01em; color: #111; text-shadow: ${px(5)} ${px(4)} 0 ${c.accent}b3; }
      .gfx.skin-press .g-headline { font-size: ${px(108)}; line-height: 0.98; }
      .gfx.skin-press .g-gold { color: ${c.accent}; text-shadow: -${px(4)} ${px(3)} 0 #111; }
      .gfx.skin-press .g-row, .gfx.skin-press .g-node, .gfx.skin-press .g-side { background: none; border: none; border-top: ${px(4)} solid #111; border-radius: 0; box-shadow: none; color: #111; padding-left: 0; }
      .gfx.skin-press .g-row.g-check { box-shadow: none; }
      .gfx.skin-press .g-check, .gfx.skin-press .g-num, .gfx.skin-press .g-node-num { color: ${c.accent}; }
      .gfx.skin-press .g-strike-line { background: ${c.accent}; height: ${px(8)}; }
      .gfx.skin-press .g-fill, .gfx.skin-press .g-bar-track, .gfx.skin-press .g-side-bar { background: rgba(0,0,0,0.12); border-radius: 0; }
      .gfx.skin-press .g-fill-bar, .gfx.skin-press .g-bar-fill, .gfx.skin-press .g-side-fill, .gfx.skin-press .g-rule, .gfx.skin-press .g-link { background: #111; border-radius: 0; }
      .gfx.skin-press .g-bar-hi .g-bar-fill, .gfx.skin-press .g-side-b .g-side-fill { background: ${c.accent}; }
      .gfx.skin-press .g-sub, .gfx.skin-press .g-side-note, .gfx.skin-press .g-bar-label, .gfx.skin-press .g-bar-value, .gfx.skin-press .g-side-label { color: #111; opacity: 1; }
      .gfx.skin-press .g-paper { background: none; box-shadow: none; padding: 0; transform: none; width: 100%; }
      .gfx.skin-press .g-paper-mark { display: none; }
      .gfx.skin-press .g-vs { background: #F1ECDF; color: #111; border-color: #111; }
      .gfx.skin-press .g-post { background: none; border: none; box-shadow: none; padding: 0; }
      .gfx.skin-press .g-post-name { color: #111; }`);
  if (has.has("panel")) out.push(`
      .gfx.skin-panel .g-box { left: 5%; right: 5%; top: 4.5%; padding: ${px(48)} ${px(46)} ${px(46)}; border-radius: 0; color: #EDEDED; border: ${px(3)} solid #3B3D40; box-shadow: inset 0 0 0 ${px(8)} #0E0F10, inset 0 0 0 ${px(10)} #26282B, 0 ${px(20)} ${px(50)} rgba(0,0,0,0.6); background: radial-gradient(circle at ${px(22)} ${px(22)}, #6a6c70 ${px(5)}, #2b2d30 ${px(6)}, transparent ${px(7)}), radial-gradient(circle at calc(100% - ${px(22)}) ${px(22)}, #6a6c70 ${px(5)}, #2b2d30 ${px(6)}, transparent ${px(7)}), radial-gradient(circle at ${px(22)} calc(100% - ${px(22)}), #6a6c70 ${px(5)}, #2b2d30 ${px(6)}, transparent ${px(7)}), radial-gradient(circle at calc(100% - ${px(22)}) calc(100% - ${px(22)}), #6a6c70 ${px(5)}, #2b2d30 ${px(6)}, transparent ${px(7)}), #0E0F10; }
      .gfx.skin-panel .g-eyebrow { font-family: "Courier Prime", monospace; font-weight: 700; color: #A0A0A0; letter-spacing: 0.22em; }
      .gfx.skin-panel .g-dot { width: ${px(18)}; height: ${px(18)}; border-radius: ${px(2)}; background: ${c.accent}; box-shadow: 0 0 0 ${px(3)} #0E0F10, 0 0 0 ${px(5)} #3B3D40; }
      .gfx.skin-panel .g-headline, .gfx.skin-panel .g-title, .gfx.skin-panel .g-stat, .gfx.skin-panel .g-side-value, .gfx.skin-panel .g-bar-value { font-family: "Anton", sans-serif; font-weight: 400; letter-spacing: 0.02em; color: #F2F2F2; text-shadow: none; }
      .gfx.skin-panel .g-gold { color: ${c.accent}; }
      .gfx.skin-panel .g-row, .gfx.skin-panel .g-node, .gfx.skin-panel .g-side { background: #141517; border: ${px(2)} solid #34363A; border-radius: 0; box-shadow: none; font-family: "Courier Prime", monospace; font-weight: 700; letter-spacing: 0.04em; }
      .gfx.skin-panel .g-row.g-check, .gfx.skin-panel .g-node-last { border-color: ${c.accent}; box-shadow: inset ${px(8)} 0 0 ${c.accent}; }
      .gfx.skin-panel .g-quote, .gfx.skin-panel .g-post-text { font-family: "Courier Prime", monospace; font-weight: 700; color: #EDEDED; }
      .gfx.skin-panel .g-paper, .gfx.skin-panel .g-post { background: none; box-shadow: none; border: none; padding: 0; transform: none; width: 100%; }
      .gfx.skin-panel .g-paper-eyebrow { color: #A0A0A0; opacity: 1; }
      .gfx.skin-panel .g-fill, .gfx.skin-panel .g-bar-track, .gfx.skin-panel .g-side-bar { background: #1E2023; border-radius: 0; height: ${px(22)}; }
      .gfx.skin-panel .g-fill-bar, .gfx.skin-panel .g-bar-fill, .gfx.skin-panel .g-side-fill { border-radius: 0; background: repeating-linear-gradient(90deg, #CFCFCF 0 ${px(14)}, transparent ${px(14)} ${px(19)}); opacity: 1; }
      .gfx.skin-panel .g-bar-hi .g-bar-fill, .gfx.skin-panel .g-side-b .g-side-fill, .gfx.skin-panel .g-fill-bar { background: repeating-linear-gradient(90deg, ${c.accent} 0 ${px(14)}, transparent ${px(14)} ${px(19)}); }
      .gfx.skin-panel .g-rule, .gfx.skin-panel .g-link { background: ${c.accent}; border-radius: 0; }
      .gfx.skin-panel .g-side-b { background: #141517; }
      .gfx.skin-panel .g-vs { background: #0E0F10; border-radius: 0; }
      .gfx.skin-panel .g-sub, .gfx.skin-panel .g-side-note { font-family: "Courier Prime", monospace; color: #BDBDBD; opacity: 1; }`);
  if (has.has("blueprint")) out.push(`
      .gfx.skin-blueprint .g-box { left: 4.5%; right: 4.5%; top: 4.5%; padding: ${px(48)} ${px(46)}; border-radius: 0; color: #F2F2F2; border: ${px(2)} dashed ${c.accent}99; box-shadow: 0 ${px(20)} ${px(50)} rgba(0,0,0,0.55); background: repeating-linear-gradient(0deg, ${c.accent}1f 0 ${px(2)}, transparent ${px(2)} ${px(44)}), repeating-linear-gradient(90deg, ${c.accent}1f 0 ${px(2)}, transparent ${px(2)} ${px(44)}), rgba(12,13,15,0.92); }
      .gfx.skin-blueprint .g-box::before { content: ""; position: absolute; left: ${px(14)}; top: ${px(14)}; width: ${px(40)}; height: ${px(40)}; border-left: ${px(4)} solid ${c.accent}; border-top: ${px(4)} solid ${c.accent}; }
      .gfx.skin-blueprint .g-box::after { content: ""; position: absolute; right: ${px(14)}; bottom: ${px(14)}; width: ${px(40)}; height: ${px(40)}; border-right: ${px(4)} solid ${c.accent}; border-bottom: ${px(4)} solid ${c.accent}; }
      .gfx.skin-blueprint .g-eyebrow { color: ${c.accent}; letter-spacing: 0.26em; }
      .gfx.skin-blueprint .g-dot { border-radius: 0; box-shadow: none; transform: rotate(45deg); }
      .gfx.skin-blueprint .g-stat, .gfx.skin-blueprint .g-headline, .gfx.skin-blueprint .g-title { text-shadow: none; letter-spacing: 0; }
      .gfx.skin-blueprint .g-row, .gfx.skin-blueprint .g-node, .gfx.skin-blueprint .g-side { background: rgba(12,13,15,0.7); border: ${px(2)} solid ${c.text}66; border-radius: 0; box-shadow: none; }
      .gfx.skin-blueprint .g-row.g-check, .gfx.skin-blueprint .g-node-last { border-color: ${c.accent}; box-shadow: none; }
      .gfx.skin-blueprint .g-node-num, .gfx.skin-blueprint .g-num { display: inline-grid; place-items: center; width: 1.9em; height: 1.9em; border: ${px(2)} solid ${c.accent}; border-radius: 50%; }
      .gfx.skin-blueprint .g-link { background: repeating-linear-gradient(90deg, ${c.accent} 0 ${px(8)}, transparent ${px(8)} ${px(14)}); }
      .gfx.skin-blueprint .g-paper, .gfx.skin-blueprint .g-post { background: none; box-shadow: none; border: ${px(2)} solid ${c.text}55; transform: none; width: 100%; color: #F2F2F2; }
      .gfx.skin-blueprint .g-paper-eyebrow { color: ${c.accent}; opacity: 1; }
      .gfx.skin-blueprint .g-paper-mark { border-radius: 0; }
      .gfx.skin-blueprint .g-post-name, .gfx.skin-blueprint .g-post-text { color: #F2F2F2; }
      .gfx.skin-blueprint .g-fill, .gfx.skin-blueprint .g-bar-track, .gfx.skin-blueprint .g-side-bar { background: transparent; border: ${px(2)} solid ${c.text}55; border-radius: 0; }
      .gfx.skin-blueprint .g-fill-bar, .gfx.skin-blueprint .g-bar-fill, .gfx.skin-blueprint .g-side-fill { border-radius: 0; }
      .gfx.skin-blueprint .g-vs { border-radius: 0; transform: translate(-50%, -50%) rotate(45deg) scale(0); }`);
  if (has.has("case")) out.push(`
      .gfx.skin-case::after { background: linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 40%); }
      .gfx.skin-case .g-box { left: 5%; right: 5%; top: 4.5%; padding: ${px(52)} ${px(46)} ${px(46)} ${px(110)}; border-radius: ${px(3)}; color: #151515; border: none; font-family: "Courier Prime", monospace; box-shadow: 0 ${px(20)} ${px(50)} rgba(0,0,0,0.5); background: linear-gradient(90deg, transparent ${px(84)}, ${c.accent}88 ${px(84)}, ${c.accent}88 ${px(88)}, transparent ${px(88)}), repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0 ${px(2)}, transparent ${px(2)} ${px(58)}), #F7F4EC; }
      .gfx.skin-case .g-box::after { content: "EXHIBIT A"; position: absolute; right: ${px(30)}; top: ${px(26)}; padding: ${px(4)} ${px(14)}; border: ${px(5)} solid ${c.accent}; color: ${c.accent}; font-family: "Anton", sans-serif; font-size: ${px(30)}; letter-spacing: 0.1em; transform: rotate(6deg); opacity: 0.85; }
      .gfx.skin-case .g-eyebrow { font-family: "Courier Prime", monospace; color: #151515; opacity: 0.7; letter-spacing: 0.18em; }
      .gfx.skin-case .g-dot { display: none; }
      .gfx.skin-case .g-headline, .gfx.skin-case .g-title, .gfx.skin-case .g-stat, .gfx.skin-case .g-quote, .gfx.skin-case .g-side-value, .gfx.skin-case .g-post-text { font-family: "Courier Prime", monospace; font-weight: 700; text-transform: none; letter-spacing: -0.01em; color: #151515; text-shadow: none; }
      .gfx.skin-case .g-gold { color: #151515; background: ${c.accent}66; padding: 0 0.1em; }
      .gfx.skin-case .g-row, .gfx.skin-case .g-node, .gfx.skin-case .g-side { background: none; border: none; border-radius: 0; box-shadow: none; padding-left: 0; font-family: "Courier Prime", monospace; font-weight: 700; color: #151515; text-transform: none; }
      .gfx.skin-case .g-row.g-check { box-shadow: none; }
      .gfx.skin-case .g-row.g-strike .g-row-text { opacity: 1; color: #F7F4EC; background: #151515; padding: 0 0.25em; }
      .gfx.skin-case .g-strike-line { display: none; }
      .gfx.skin-case .g-check, .gfx.skin-case .g-num, .gfx.skin-case .g-node-num { color: ${c.accent}; }
      .gfx.skin-case .g-x { opacity: 1; color: #151515; }
      .gfx.skin-case .g-fill, .gfx.skin-case .g-bar-track, .gfx.skin-case .g-side-bar { background: rgba(0,0,0,0.1); border-radius: 0; }
      .gfx.skin-case .g-fill-bar, .gfx.skin-case .g-bar-fill, .gfx.skin-case .g-side-fill, .gfx.skin-case .g-rule, .gfx.skin-case .g-link { background: #151515; border-radius: 0; }
      .gfx.skin-case .g-bar-hi .g-bar-fill, .gfx.skin-case .g-side-b .g-side-fill { background: ${c.accent}; }
      .gfx.skin-case .g-sub, .gfx.skin-case .g-side-note, .gfx.skin-case .g-bar-label, .gfx.skin-case .g-bar-value, .gfx.skin-case .g-side-label { color: #151515; opacity: 1; font-family: "Courier Prime", monospace; }
      .gfx.skin-case .g-paper, .gfx.skin-case .g-post { background: none; box-shadow: none; border: none; padding: 0; transform: none; width: 100%; }
      .gfx.skin-case .g-paper-mark { display: none; }
      .gfx.skin-case .g-side-b { background: ${c.accent}1a; }
      .gfx.skin-case .g-vs { background: #F7F4EC; color: #151515; border-color: #151515; }
      .gfx.skin-case .g-box > .g-eyebrow, .gfx.skin-case .g-box > .g-title, .gfx.skin-case .g-box > .g-headline { padding-right: ${px(200)}; }

      .gfx.skin-case .g-post-name { color: #151515; }`);
  if (has.has("redline")) out.push(`
      .gfx.skin-redline::after { background: linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0) 46%); }
      .gfx.skin-redline .g-box { left: 5%; right: 5%; top: 4.5%; padding: ${px(20)} ${px(10)}; border-radius: 0; background: none; border: none; box-shadow: none; color: #FFFFFF; }
      .gfx.skin-redline .g-eyebrow { color: #111; background: ${c.accent}; padding: ${px(6)} ${px(16)}; letter-spacing: 0.16em; font-weight: 900; transform: rotate(-2deg); }
      .gfx.skin-redline .g-dot { display: none; }
      .gfx.skin-redline .g-headline, .gfx.skin-redline .g-title, .gfx.skin-redline .g-stat, .gfx.skin-redline .g-quote, .gfx.skin-redline .g-side-value, .gfx.skin-redline .g-post-text { font-family: "Anton", sans-serif; font-weight: 400; text-transform: uppercase; letter-spacing: 0.01em; color: #FFFFFF; -webkit-text-stroke: ${px(3)} #000; paint-order: stroke fill; text-shadow: 0 ${px(6)} ${px(18)} rgba(0,0,0,0.7); }
      .gfx.skin-redline .g-gold { color: #FFFFFF; border: ${px(7)} solid ${c.accent}; border-radius: 52% 48% 55% 45% / 60% 55% 45% 40%; padding: 0 0.16em; margin: 0 -0.08em; transform: rotate(-2deg); display: inline-block; -webkit-text-stroke: ${px(3)} #000; }
      .gfx.skin-redline .g-row, .gfx.skin-redline .g-node, .gfx.skin-redline .g-side { background: none; border: none; border-radius: 0; box-shadow: none; padding-left: 0; font-family: "Anton", sans-serif; font-weight: 400; color: #FFFFFF; -webkit-text-stroke: ${px(2)} #000; paint-order: stroke fill; text-shadow: 0 ${px(4)} ${px(14)} rgba(0,0,0,0.8); }
      .gfx.skin-redline .g-row.g-check { box-shadow: none; }
      .gfx.skin-redline .g-row.g-strike .g-row-text { opacity: 0.85; }
      .gfx.skin-redline .g-strike-line { background: ${c.accent}; height: ${px(11)}; border-radius: ${px(6)}; transform: rotate(-3deg); box-shadow: 0 0 0 ${px(2)} #000; }
      .gfx.skin-redline .g-check, .gfx.skin-redline .g-num, .gfx.skin-redline .g-node-num { color: ${c.accent}; -webkit-text-stroke: ${px(2)} #000; }
      .gfx.skin-redline .g-rule, .gfx.skin-redline .g-link { background: ${c.accent}; height: ${px(14)}; border-radius: ${px(8)}; transform: rotate(-1.5deg); }
      .gfx.skin-redline .g-paper, .gfx.skin-redline .g-post { background: none; box-shadow: none; border: none; padding: 0; transform: none; width: 100%; color: #FFFFFF; }
      .gfx.skin-redline .g-paper-eyebrow { color: ${c.accent}; opacity: 1; }
      .gfx.skin-redline .g-paper-mark { display: none; }
      .gfx.skin-redline .g-hl { background-image: none; color: ${c.accent}; }
      .gfx.skin-redline .g-sub, .gfx.skin-redline .g-side-note, .gfx.skin-redline .g-bar-label, .gfx.skin-redline .g-side-label { color: #FFFFFF; opacity: 1; text-shadow: 0 ${px(3)} ${px(10)} rgba(0,0,0,0.9); }
      .gfx.skin-redline .g-fill, .gfx.skin-redline .g-bar-track, .gfx.skin-redline .g-side-bar { background: rgba(255,255,255,0.25); }
      .gfx.skin-redline .g-fill-bar, .gfx.skin-redline .g-bar-fill, .gfx.skin-redline .g-side-fill { background: ${c.accent}; opacity: 1; }
      .gfx.skin-redline .g-vs { background: #111; }
      .gfx.skin-redline .g-post-name { color: #FFFFFF; }`);
  if (has.has("phone")) out.push(`
      .gfx.skin-phone .g-box { background: #FFFFFF; color: #111; border: none; box-shadow: 0 ${px(18)} ${px(60)} rgba(0,0,0,0.5); }
      .gfx.skin-phone .g-eyebrow { color: #8E8E93; }
      .gfx.skin-phone .g-dot { background: ${c.accent}; box-shadow: none; }
      .gfx.skin-phone .g-thread-head { color: #111; }
      .gfx.skin-phone .g-bubble.g-them, .gfx.skin-phone .g-typing { background: #E9E9EB; color: #111; }
      .gfx.skin-phone .g-bubble.g-me { background: ${c.accent}; color: ${c.bg}; }`);
  return out.join("");
}

/** CSS for the hook treatment and slam style of a theme (layered over the house hook and slam styles). */
export function themeCSS({ H, colors, theme }) {
  if (!theme) return "";
  const c = { text: "#FFFFFF", accent: "#FFD600", bg: "#0B0B0D", stroke: "#000000", ...colors };
  const u = H / 1920;
  const px = (n) => `${Math.round(n * u)}px`;
  const hook = {
    type: `#hook.hook-t-type #hook-lines { display: inline-block; font-family: "Courier Prime", monospace; font-weight: 700; font-size: 0.98em; line-height: 1.14; letter-spacing: -0.01em; text-transform: none; -webkit-text-stroke: 0; color: #F2F0EA; text-shadow: none; background: rgba(0,0,0,0.86); padding: 0.2em 0.34em 0.16em; }
      #hook.hook-t-type #hook-lines .hw.k { color: ${c.accent}; font-size: 1em; }
      #hook.hook-t-type #hook-bar, #hook.hook-t-type #hook-scrim { display: none; }`,
    marker: `#hook.hook-t-marker #hook-lines { font-family: "Permanent Marker", sans-serif; font-weight: 400; font-size: 0.92em; line-height: 1.08; -webkit-text-stroke: 0; color: #FFFFFF; text-shadow: 0 ${px(4)} ${px(16)} rgba(0,0,0,0.8); }
      #hook.hook-t-marker #hook-lines .hw { transform: rotate(-1.5deg); }
      #hook.hook-t-marker #hook-lines .hw.k { color: ${c.accent}; }
      #hook.hook-t-marker #hook-bar { height: ${px(14)}; border-radius: ${px(8)}; transform: rotate(-2deg); }`,
    serif: `#hook.hook-t-serif #hook-lines { font-family: "DM Serif Display", Georgia, serif; font-weight: 400; font-size: 1em; text-transform: none; line-height: 1.04; letter-spacing: -0.01em; -webkit-text-stroke: 0; text-shadow: 0 ${px(4)} ${px(18)} rgba(0,0,0,0.8); }
      #hook.hook-t-serif #hook-lines .hw.k { color: #111; background: ${c.accent}; padding: 0 0.12em; font-size: 1em; }
      #hook.hook-t-serif #hook-bar { width: 40%; height: ${px(4)}; border-radius: 0; }`,
    stamp: `#hook.hook-t-stamp #hook-lines { color: #111; background: #F1ECDF; padding: 0.18em 0.3em 0.12em; box-decoration-break: clone; -webkit-box-decoration-break: clone; -webkit-text-stroke: 0; text-shadow: ${px(5)} ${px(4)} 0 ${c.accent}b3; display: inline-block; transform: rotate(-1.5deg); }
      #hook.hook-t-stamp #hook-lines .hw.k { color: ${c.accent}; text-shadow: -${px(4)} ${px(3)} 0 #111; }
      #hook.hook-t-stamp #hook-scrim, #hook.hook-t-stamp #hook-bar { display: none; }`,
    panel: `#hook.hook-t-panel #hook-lines { display: inline-block; padding: 0.22em 0.4em; background: #0E0F10; border: ${px(4)} solid #3B3D40; box-shadow: inset 0 0 0 ${px(6)} #0E0F10, inset 0 0 0 ${px(8)} #26282B; -webkit-text-stroke: 0; text-shadow: none; color: #F2F2F2; }
      #hook.hook-t-panel #hook-lines::before { content: ""; display: block; width: ${px(22)}; height: ${px(22)}; margin: 0 auto 0.12em; border-radius: ${px(3)}; background: ${c.accent}; }
      #hook.hook-t-panel #hook-scrim, #hook.hook-t-panel #hook-bar { display: none; }`,
    redline: `#hook.hook-t-redline #hook-lines { -webkit-text-stroke: ${px(4)} #000; paint-order: stroke fill; color: #FFFFFF; }
      #hook.hook-t-redline #hook-lines .hw.k { color: #FFFFFF; border: ${px(8)} solid ${c.accent}; border-radius: 52% 48% 55% 45% / 60% 55% 45% 40%; padding: 0 0.14em; transform: rotate(-2deg); font-size: 1em; }
      #hook.hook-t-redline #hook-bar { height: ${px(16)}; border-radius: ${px(8)}; transform: rotate(-1.5deg); }`,
  }[theme.hook] || "";
  const slam = {
    type: `.slam-word.slam-t-type { font-family: "Courier Prime", monospace; font-weight: 700; text-transform: none; color: #F2F0EA; -webkit-text-stroke: 0; background: rgba(0,0,0,0.88); padding: 0.06em 0.3em; font-size: 0.8em; text-shadow: none; }
      .slam-word.slam-t-type::after { content: ""; display: inline-block; width: 0.5em; height: 0.9em; margin-left: 0.1em; vertical-align: -0.08em; background: ${c.accent}; }`,
    ghost: `.slam-word.slam-t-ghost { color: #111; -webkit-text-stroke: 0; background: #F1ECDF; padding: 0.04em 0.24em; text-shadow: ${px(7)} ${px(6)} 0 ${c.accent}cc; }`,
    marker: `.slam-word.slam-t-marker { font-family: "Permanent Marker", sans-serif; color: ${c.accent}; -webkit-text-stroke: 0.02em #000; transform: rotate(-3deg); }`,
    serif: `.slam-word.slam-t-serif { font-family: "DM Serif Display", Georgia, serif; text-transform: none; color: #111; -webkit-text-stroke: 0; background: ${c.accent}; padding: 0 0.2em; text-shadow: none; }`,
    stamp: `.slam-word.slam-t-stamp { color: ${c.accent}; -webkit-text-stroke: 0; border: 0.07em solid ${c.accent}; padding: 0.02em 0.22em; transform: rotate(-5deg); text-shadow: none; background: rgba(0,0,0,0.35); }`,
    panel: `.slam-word.slam-t-panel { color: #F2F2F2; -webkit-text-stroke: 0; background: #0E0F10; border: ${px(5)} solid #3B3D40; padding: 0.04em 0.3em; text-shadow: none; box-shadow: inset 0 -0.08em 0 ${c.accent}; }`,
    outline: `.slam-word.slam-t-outline { color: transparent; -webkit-text-stroke: 0.035em ${c.accent}; text-shadow: none; }`,
    redline: `.slam-word.slam-t-redline { color: #FFFFFF; -webkit-text-stroke: 0.03em #000; border-bottom: 0.1em solid ${c.accent}; }`,
    bubble: `.slam-word.slam-t-bubble { color: ${c.bg}; -webkit-text-stroke: 0; background: ${c.accent}; padding: 0.06em 0.36em; border-radius: 0.5em 0.5em 0.5em 0.12em; text-shadow: none; font-size: 0.85em; }`,
  }[theme.slam] || "";
  return `\n      ${hook}\n      ${slam}`;
}

/** @font-face rules and the font files to copy for the skins in use. */
export function skinFonts(skins = []) {
  const seen = new Map();
  for (const sk of skins) for (const [fam, file, weight] of SKIN_FONTS[sk] || []) seen.set(file, [fam, file, weight]);
  const files = [...seen.keys()];
  const css = [...seen.values()].map(([fam, file, weight]) => `@font-face { font-family: "${fam}"; src: url("assets/fonts/${file}") format("truetype"); font-weight: ${weight}; font-style: normal; font-display: block; }`).join("\n      ");
  return { files, css };
}

/** GSAP for the skins (runs inside the card loop; el, box, g and tl are in scope). */
export const SKINS_JS = `
          if (box && box.classList.contains("g-drop")) tl.fromTo(box, { yPercent: -140, scale: 0.97 }, { yPercent: 0, scale: 1, duration: 0.55, ease: "back.out(1.6)", immediateRender: false }, g.start);
          // Press sheet: stamped down; instrument panel: snaps on with the status lamp blinking twice.
          if (el.classList.contains("skin-press")) tl.fromTo(box, { scale: 1.08, rotation: -3 }, { scale: 1, rotation: -0.6, duration: 0.3, ease: "back.out(1.4)", immediateRender: false }, g.start);
          if (el.classList.contains("skin-panel")) {
            tl.fromTo(box, { opacity: 0 }, { opacity: 1, duration: 0.06, ease: "steps(2)", immediateRender: false }, g.start);
            el.querySelectorAll(".g-dot").forEach((d) => { for (let k = 0; k < 2; k++) { tl.set(d, { opacity: 0.2 }, g.start + 0.2 + k * 0.18); tl.set(d, { opacity: 1 }, g.start + 0.29 + k * 0.18); } });
          }
          const typed = el.querySelectorAll(".t-ch");
          if (typed.length) {
            // Typed out at a steady pace that fits the card: about 0.035 s a letter, never past 60% of the card.
            const per = Math.min(0.035, (g.duration * 0.6) / typed.length);
            typed.forEach((ch, k) => tl.set(ch, { opacity: 1 }, g.start + 0.2 + k * per));
          }`;
