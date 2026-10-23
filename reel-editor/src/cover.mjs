import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { esc } from "./text.mjs";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { hyperframesBin, renderEnv } from "./render.mjs";
import { log, warn, run, ensureDir, readJSON, writeJSON, PKG_ROOT, fontFile } from "./util.mjs";
import { createRequire } from "node:module";

// Real Anton metrics (fontkit ships with the renderer): cap height and the width of a string in em.
let anton = null;
let antonPath = null;
/** The display font the covers are measured with (a brand's own when it has one). */
export function useDisplayFont(file) { if (file !== antonPath) { antonPath = file; anton = null; } }
function antonFont() {
  if (anton) return anton;
  try {
    const fk = createRequire(import.meta.url)("fontkit");
    const f = fk.openSync(antonPath || path.join(PKG_ROOT, "assets", "fonts", "Anton-Regular.ttf"));
    anton = { cap: f.capHeight / f.unitsPerEm, width: (s) => f.layout(String(s)).advanceWidth / f.unitsPerEm };
  } catch {
    anton = { cap: 0.72, width: (s) => String(s).length * 0.45 };
  }
  return anton;
}
/** Width of a line in px at cap height T (letter-spacing 0.012 em added); the gold word is 1.18x. */
export function lineWidthPx(line, T) {
  const { cap, width } = antonFont();
  const fontPx = T / cap;
  return line.split(" ").reduce((acc, w, i) => {
    const k = w.includes("*") ? 1.18 : 1;
    const text = w.replace(/\*/g, "");
    return acc + (width(text) + 0.012 * text.length) * fontPx * k + (i ? width(" ") * fontPx : 0);
  }, 0);
}

/**
 * Covers, the thumbnail-system way: the speaker's real frame (scored for expression, light, sharpness and angle,
 * then cut out with Apple Vision person segmentation; no image model ever sees or draws a person), on a designed
 * background, with a 2-4 word title typeset in Anton, ALL CAPS, one gold power word, block bottom at y=1400 and no
 * glyph below y=1440 (Instagram's grid crop), a dual stroke and a shadow, grain over everything. Three variants:
 * the top titles across the brand palette, navy+gold and black+red.
 */

export const PALETTES = {
  brand: { name: "black+gold", bg: "#0B0B0D", bg2: "#000000", accent: "#C8A24B", accent2: "#E9C96A" },
  navy: { name: "navy+gold", bg: "#0B1B33", bg2: "#060F1F", accent: "#F7B500", accent2: "#FFCE45" },
  red: { name: "black+red", bg: "#0D0D0F", bg2: "#000000", accent: "#E5322D", accent2: "#FF5A3C" },
};

const POWER = ["broke", "kills", "costs", "cost", "quit", "lies", "lie", "wrong", "nobody", "expensive", "losing", "lose", "weak", "rich", "pay", "beg", "every", "never", "stop", "fire", "fired", "blame", "own", "truth", "late", "dead", "fail", "failed"];
const BANNED = ["success", "mindset", "journey", "tips", "hacks", "grind", "10x", "crushing"];

export function titlePrompt({ transcript, hook, voice = "" }) {
  return [
    "You write the cover title for one talking-head Instagram reel. Reply with JSON only; use no tools.",
    "Write 10 candidate titles from THIS transcript, then score each 0-10 on specificity, emotional charge, brevity (2 words = 10, 3 = 8, 4 = 6, 5 = 3) and curiosity/stakes, and return the top 3 by total.",
    "Rules: 2-4 words, hard max 5, at most 2 lines. ONE power word per title (BROKE, KILLS, COSTS, QUIT, LIES, WRONG, NOBODY, EXPENSIVE, LOSING, WEAK, RICH, PAY, BEG, EVERY...), marked with *asterisks*. A mid-title period is two punches. Read-aloud test: if a blunt sales coach would not say it to a room, rewrite.",
    "Banned: SUCCESS, MINDSET, JOURNEY, TIPS, HACKS, GRIND, 10X, CRUSHING, emojis, exclamation marks, questions that are just the hook again.",
    "Optional teaser: one short line (max 6 words) below the title that extends the SAME claim, never a second hook. Empty when nothing adds.",
    voice ? `\nVoice:\n${voice.trim()}` : "",
    "",
    `Hook already on the reel: ${hook || "(none)"}`,
    "Transcript:",
    transcript,
    "",
    'Reply: {"titles":[{"title":"OWN IT *FIRST*","teaser":"or your reps copy the blame","score":34}]}',
  ].join("\n");
}

const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/[!]+/g, "").trim();

/** Keep titles that pass the rules: 2-5 words, one starred power word (added when missing), nothing banned. */
export function normalizeTitles(raw, { hook = "" } = {}) {
  const out = [];
  for (const t of raw || []) {
    let title = clean(t.title).toUpperCase();
    if (!title) continue;
    const words = title.replace(/\*/g, "").split(" ").filter(Boolean);
    if (words.length < 2 || words.length > 5) continue;
    if (words.some((w) => BANNED.includes(w.toLowerCase().replace(/[^a-z0-9]/g, "")))) continue;
    if (!/\*[^*]+\*/.test(title)) {
      const i = words.findIndex((w) => POWER.includes(w.toLowerCase().replace(/[^a-z]/g, "")));
      const k = i >= 0 ? i : words.length - 1;
      words[k] = `*${words[k]}*`;
      title = words.join(" ");
    }
    const teaser = clean(t.teaser).toUpperCase().split(" ").slice(0, 6).join(" ");
    if (out.some((o) => o.title === title)) continue;
    out.push({ title, teaser, score: Number(t.score) || 0 });
  }
  if (!out.length && hook) {
    const words = clean(hook).toUpperCase().replace(/\*/g, "").split(" ").slice(0, 4);
    words[words.length - 1] = `*${words[words.length - 1]}*`;
    out.push({ title: words.join(" "), teaser: "", score: 0 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

/** A title fits when it sets at a cap height of 150 px or more (overflow means a shorter title, never cramming). */
export const titleFits = (t) => fitLines(t.title).T >= 130;

/**
 * Title block: cap height T from the longest line so the block fits 82-94% of the width (two lines max), then
 * shrunk (to 170 at the least) and the teaser dropped if needed, so the block's top clears the chin by 30 px with
 * its bottom anchored at y=1400. Returns the lines, T, the font size and the block height.
 */
export function layoutTitle(title, { teaser = "", chinY = 0 } = {}) {
  const words = title.split(" ");
  const plain = (w) => w.replace(/\*/g, "");
  let lines;
  if (words.length <= 2) lines = [words];
  else if (words.length === 3) lines = plain(words[0]).length + plain(words[1]).length + 1 <= 11 ? [[words[0], words[1]], [words[2]]] : [[words[0]], [words[1], words[2]]];
  else lines = [words.slice(0, Math.ceil(words.length / 2)), words.slice(Math.ceil(words.length / 2))];
  // Measured with the real font, so a line fits 92% of the width and never wraps or runs off the frame.
  const widest = Math.max(...lines.map((l) => lineWidthPx(l.join(" "), 100)));
  let T = Math.max(120, Math.min(230, Math.floor((1080 * 0.92) / (widest / 100))));
  let withTeaser = !!teaser;
  // The teaser is one line: its cap height is 0.42T, or smaller so it fits the width; dropped below 0.28T.
  const teaserCap = (t) => Math.min(0.42 * t, (1080 * 0.9) / Math.max(1, lineWidthPx(teaser, 100) / 100));
  if (withTeaser && teaserCap(T) < 0.28 * T) withTeaser = false;
  const height = (t, tz) => lines.length * 1.18 * t + (tz ? 0.45 * t + teaserCap(t) * 1.18 : 0);
  const top = () => 1400 - height(T, withTeaser);
  while (chinY && top() < chinY + 30 && T > 170) T -= 10;
  if (chinY && top() < chinY + 30 && withTeaser) withTeaser = false;
  while (chinY && top() < chinY + 30 && T > 150) T -= 10;
  return { lines: lines.map((l) => l.join(" ")), T, fontPx: Math.round(T / antonFont().cap), teaser: withTeaser ? teaser : "", teaserCap: withTeaser ? teaserCap(T) : 0, blockH: height(T, withTeaser), blockTop: Math.round(1400 - height(T, withTeaser)) };
}

/**
 * Where the text goes: under the chin when the face sits in the upper half (the usual close-up), else in the top
 * third. The frame is zoomed a little around the face so it reads at tile size. Returns the text block's top and
 * the frame transform.
 */
export function placeOnFrame({ W = 1080, H = 1920, face, blockH }) {
  const f = face || { x: 0.25, y: 0.25, w: 0.5, h: 0.28 };
  const faceCy = (f.y + f.h / 2) * H;
  const faceCx = (f.x + f.w / 2) * W;
  const scale = Math.max(1, Math.min(1.35, 0.42 / Math.max(0.2, f.w)));
  const chin = (f.y + f.h) * H * scale - (faceCy * scale - faceCy) * 0 ;
  // Zoom around the face centre, then slide so the face centre stays where it was (kept inside the frame).
  const tx = Math.round(Math.min(0, Math.max(W - W * scale, faceCx - faceCx * scale)));
  const ty = Math.round(Math.min(0, Math.max(H - H * scale, faceCy - faceCy * scale)));
  const chinY = (f.y + f.h) * H * scale + ty;
  const headY = f.y * H * scale + ty;
  const below = chinY + 60;
  const fitsBelow = below + blockH <= 1620;
  const fitsAbove = headY - 50 - blockH >= 250;
  const top = fitsBelow ? Math.round(Math.max(below, Math.min(1620 - blockH, 1180))) : fitsAbove ? Math.round(headY - 50 - blockH) : Math.round(1620 - blockH);
  return { scale, tx, ty, blockTop: top, zone: fitsBelow ? "below" : fitsAbove ? "above" : "low" };
}

/** Title lines sized to 92% of the width with the real font; 2 lines max; cap height 120-200 px. */
export function fitLines(title) {
  const words = title.split(" ");
  const plain = (w) => w.replace(/\*/g, "");
  let lines;
  if (words.length <= 2) lines = [words];
  else if (words.length === 3) lines = plain(words[0]).length + plain(words[1]).length + 1 <= 12 ? [[words[0], words[1]], [words[2]]] : [[words[0]], [words[1], words[2]]];
  else lines = [words.slice(0, Math.ceil(words.length / 2)), words.slice(Math.ceil(words.length / 2))];
  const widest = Math.max(...lines.map((l) => lineWidthPx(l.join(" "), 100) * (l.some((w) => w.includes("*")) ? 1.22 : 1)));
  const T = Math.max(120, Math.min(190, Math.floor((1080 * 0.88) / (widest / 100))));
  const blockH = Math.round(lines.reduce((a, l) => a + 1.12 * T * (l.some((w) => w.includes("*")) ? 1.22 : 1), 0));
  return { lines: lines.map((l) => l.join(" ")), T, fontPx: Math.round(T / antonFont().cap), lineH: Math.round(1.12 * T), blockH };
}

export const STYLES = ["outline", "whitebox", "box"];

/**
 * Cover on the real frame: the room stays, darkened a touch with a vignette; the title in Anton caps with one
 * word in the accent. Styles: outline (white, thick black stroke, shadow), bar (a solid near-black band with an
 * accent rule), box (the accent word on its own accent block). Grain over everything.
 */
export function coverHTML({ W = 1080, H = 1920, frame, face, title, palette, style = "outline" }) {
  const p = palette;
  const lay = fitLines(title);
  const pos = placeOnFrame({ W, H, face, blockH: lay.blockH + (style === "bar" ? 70 : 0) });
  const stroke = Math.max(6, Math.round(0.045 * lay.T));
  const mark = (s) => esc(s).replace(/\*([^*]+)\*/g, '<span class="k">$1</span>');
  // In the outline style the line that carries the accent word is the payoff: the whole line goes gold and larger.
  const lines = lay.lines.map((l) => `<div class="line${style === "outline" && l.includes("*") ? " payoff" : ""}">${mark(l)}</div>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${W}, height=${H}" /><title>cover</title>
<script src="assets/vendor/gsap.min.js"></script>
<style>
  @font-face { font-family: "Anton"; src: url("assets/fonts/Anton-Regular.ttf") format("truetype"); font-display: block; }
  html, body { margin: 0; background: #000; }
  #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
  #frame { position: absolute; left: ${pos.tx}px; top: ${pos.ty}px; width: ${Math.round(W * pos.scale)}px; height: ${Math.round(H * pos.scale)}px; filter: contrast(1.08) saturate(1.05) brightness(0.8); }
  #vig { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 46%, rgba(0,0,0,0.7) 88%), radial-gradient(ellipse at 50% 35%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.4) 100%); }
  #block { position: absolute; left: 50%; transform: translateX(-50%); top: ${pos.blockTop}px; text-align: center; white-space: nowrap; ${style === "whitebox" ? `padding: 22px 40px 26px; background: #fff; border-radius: 22px; box-shadow: 0 18px 50px rgba(0,0,0,0.55);` : ""} }
  .line { white-space: nowrap; font-family: "Anton", sans-serif; font-size: ${lay.fontPx}px; line-height: ${lay.lineH}px; letter-spacing: 0.015em; text-transform: uppercase; color: ${style === "whitebox" ? "#0b0b0d" : "#fff"}; ${style === "outline" ? `-webkit-text-stroke: ${stroke}px #000; paint-order: stroke fill;` : style === "box" ? `-webkit-text-stroke: ${stroke}px #000; paint-order: stroke fill;` : ""} }
  .line.payoff { font-size: ${Math.round(lay.fontPx * 1.22)}px; line-height: ${Math.round(lay.lineH * 1.22)}px; color: ${p.accent}; }
  .line.payoff .k { color: inherit; }
  .line .k { color: ${style === "whitebox" ? "#D7262C" : p.accent}; ${style === "box" ? `display: inline-block; line-height: 1.02; color: #0b0b0d; background: ${p.accent}; padding: 0.02em 0.14em 0; margin: 0 0.04em; border-radius: 0.06em; -webkit-text-stroke: 0; vertical-align: baseline;` : ""} }
  #grain { position: absolute; inset: 0; opacity: 0.05; mix-blend-mode: overlay; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 1 0'/></filter><rect width='300' height='300' filter='url(%23n)'/></svg>"); background-size: 300px 300px; }
</style></head>
<body><div id="root" data-composition-id="cover" data-start="0" data-width="${W}" data-height="${H}" data-duration="1" data-fps="30">
  <img id="frame" src="${esc(frame)}" alt="" />
  <div id="vig"></div>
  <div id="block" class="clip" data-start="0" data-duration="1">${lines}</div>
  <div id="grain"></div>
</div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["cover"] = gsap.timeline({ paused: true });</script>
</body></html>
`;
}

export function personBinary() {
  const bin = path.join(os.homedir(), ".cache", "reel-editor", "person");
  const src = path.join(PKG_ROOT, "scripts", "person.swift");
  try {
    if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
      ensureDir(path.dirname(bin));
      return run("swiftc", ["-O", "-o", bin, src], { capture: true }).then(() => bin).catch(() => null);
    }
    return Promise.resolve(bin);
  } catch { return Promise.resolve(null); }
}

/** Frames to score: every second through the first 20 s, then every 3 s (a between-sentence face is likelier later). */
export function coverTimes(duration) {
  const out = [];
  for (let t = 0.5; t < Math.min(duration, 20); t += 1) out.push(+t.toFixed(2));
  for (let t = 21; t < duration - 0.5; t += 3) out.push(+t.toFixed(2));
  return out.length ? out : [Math.max(0.05, duration / 2)];
}

/**
 * Make the covers for a reel: <workDir>/covers/Cover 1.png, 2, 3 (and cover.png = the first). Returns the paths.
 * Titles come from headless Claude (falls back to the hook); the frame comes from the person tool.
 */
export async function makeCover(workDir, plan, { handle = "", variants = 3, voice = "" } = {}) {
  useDisplayFont(fontFile(plan.style, "Anton-Regular.ttf"));
  workDir = path.resolve(workDir);
  const dir = ensureDir(path.join(workDir, "covers"));
  const bin = await personBinary();
  if (!bin) { warn("cover: the person tool did not compile (Xcode command line tools?)"); return []; }
  const personPng = path.join(dir, "person.png");
  const framePng = path.join(dir, "frame.png");
  const times = coverTimes(plan.video.duration);
  const { out } = await run(bin, [plan.video.src, ...times.map(String), "--out", personPng, "--frame", framePng], { capture: true });
  const pick = JSON.parse(out.slice(out.indexOf("{")));
  log(`cover: best frame at ${pick.best.t}s (score ${pick.best.score.toFixed(1)}: expression ${pick.best.parts.expression.toFixed(2)}, light ${pick.best.parts.light.toFixed(2)}, sharp ${pick.best.parts.sharp.toFixed(2)})`);

  // Titles.
  const transcript = (plan.captions || []).map((g) => g.text).join(" ");
  let titles = [];
  const titlesPath = path.join(dir, "titles.json");
  if (fs.existsSync(titlesPath)) titles = readJSON(titlesPath).titles;
  if (titles.filter(titleFits).length < 3 && hasClaude() && transcript) {
    try {
      const reply = await claudeText(titlePrompt({ transcript, hook: plan.hook?.text, voice }), { timeoutMs: 120000 });
      titles = normalizeTitles(firstJSON(reply).titles, { hook: plan.hook?.text });
    } catch (e) { warn(`cover titles: ${String(e.message).split("\n")[0]}; using the hook`); }
  }
  if (!titles.length) titles = normalizeTitles([], { hook: plan.hook?.text || plan.name });
  writeJSON(titlesPath, { titles });
  const fitting = titles.filter(titleFits);
  titles = fitting.length ? fitting : titles;

  // Compose and snapshot each variant.
  ensureDir(path.join(dir, "assets", "fonts")); ensureDir(path.join(dir, "assets", "vendor"));
  for (const f of ["Anton-Regular.ttf", "Inter.ttf"]) fs.copyFileSync(fontFile(plan.style, f), path.join(dir, "assets", "fonts", f));
  fs.copyFileSync(path.join(PKG_ROOT, "assets", "vendor", "gsap.min.js"), path.join(dir, "assets", "vendor", "gsap.min.js"));
  fs.copyFileSync(framePng, path.join(dir, "assets", "frame.png"));
  const pals = [PALETTES.brand, PALETTES.brand, PALETTES.red];
  const outs = [];
  const bin2 = hyperframesBin();
  for (let v = 0; v < Math.min(variants, 3); v++) {
    const t = titles[v % titles.length];
    const pdir = ensureDir(path.join(dir, `variant-${v + 1}`));
    fs.rmSync(path.join(pdir, "assets"), { recursive: true, force: true });
    fs.symlinkSync(path.join(dir, "assets"), path.join(pdir, "assets"));
    fs.writeFileSync(path.join(pdir, "index.html"), coverHTML({ frame: "assets/frame.png", face: pick.best.face, title: t.title, palette: pals[v], style: STYLES[v] }));
    const shots = ensureDir(path.join(pdir, "shots"));
    for (const f of fs.readdirSync(shots)) fs.rmSync(path.join(shots, f), { force: true });
    await run(bin2[0], [...bin2.slice(1), "snapshot", pdir, "--at", "0.5", "--no-end", "--keep", "-o", shots, "--describe", "false"], { capture: true, env: renderEnv() });
    const src = path.join(shots, "at-0.5s.png");
    if (!fs.existsSync(src)) { warn(`cover ${v + 1}: snapshot missing`); continue; }
    const outPath = path.join(dir, `Cover ${v + 1}.png`);
    fs.copyFileSync(src, outPath);
    outs.push(outPath);
    log(`cover ${v + 1}: "${t.title.replace(/\*/g, "")}" (${STYLES[v]}, ${pals[v].name})`);
  }
  if (outs[0]) fs.copyFileSync(outs[0], path.join(workDir, "cover.png"));
  return outs;
}
