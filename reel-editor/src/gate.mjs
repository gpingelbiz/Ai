/**
 * The master gate: the last check every edited reel passes before it is delivered, and the one place that fixes what
 * it finds instead of only writing a note.
 *
 * Why it measures instead of predicting: the hook and the captions were placed from font arithmetic (Anton metrics),
 * so a serif look rendered taller than planned and its hook ran into the captions (a client's women's-event reel, Nov 24),
 * and the text check passed it because it never compared one piece of text with another. Here the real renderer draws
 * each text layer alone (every other layer hidden) at the moments that matter; the pixels each layer paints are its
 * true footprint, so overlap and the safe zone (Instagram, TikTok, Facebook) are read off real frames.
 *
 * What it does with a problem:
 *   hook over captions        captions move down below the measured hook (or the hook moves up when they cannot)
 *   a card / pro card /       that item is dropped (placement reads the same safe zone, so this is the backstop)
 *   slam / icon over other
 *   text or out of the zone
 *   a doubled caption word    the repeat is taken out ("Bootcamp Camp" -> "Bootcamp")
 *   a spoken ask cut off      the edit is run again ending after the ask (runEdit reads gate.json retry.endAfter)
 * Then the reel is rebuilt and checked again (at most twice). Anything still wrong holds the reel: gate.json and
 * gate.txt say why, and textcheck.json turns to "hold" so Publish and the Content Studio only ever make a draft of it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { hyperframesBin, renderEnv } from "./render.mjs";
import { editDistance, textTokens } from "./slide-preflight.mjs";
import { fontFile, readJSON, run, writeJSON } from "./util.mjs";
import { loadProMeasure, proLineBreaks, splitProPhrases, PRO_CAPTION_PLATE } from "./pro-captions.mjs";
import { attachProWordMarks } from "./pro.mjs";
import { shownText } from "./textcheck.mjs";
import { detectFaces } from "./placement.mjs";
import { SAFE_ZONE } from "./safe-zone.mjs";

// The shared safe zone (src/safe-zone.mjs: Instagram, TikTok and Facebook at 1080x1920): 150 px side strips, the right
// button column from 35% of the height down, the top bar and the bottom strip. Placement uses the same numbers; the
// gate allows 6 px of slack so a measured anti-aliased edge on the line itself is not a problem.
const SLACK = 6;
export const GATE_SAFE = Object.freeze({
  left: SAFE_ZONE.side - SLACK,
  right: SAFE_ZONE.width - SAFE_ZONE.side + SLACK,
  iconRight: SAFE_ZONE.width - SAFE_ZONE.rail + SLACK,
  iconFrom: SAFE_ZONE.railTop / SAFE_ZONE.height,
  iconTo: 1,
  top: SAFE_ZONE.top / SAFE_ZONE.height,
  bottom: SAFE_ZONE.bottom / SAFE_ZONE.height,
});
export const GATE_RULES = {
  step: 2,           // read every 2nd pixel (2 px precision is plenty for a collision)
  diff: 90,          // summed RGB change against the empty frame that counts as "this layer painted here"
  pad: 6,            // text closer than this many pixels to other text counts as touching
  minOverlap: 12,    // sampled pixels of overlap before it is a collision (ignores a stray anti-aliased edge)
  full: 0.4,         // a layer covering 40% of the frame is a full-screen card or photo: not checked as text
  outside: 0.01,     // share of a layer's pixels allowed outside the safe zone (shadows, glow bleed)
  gap: 40,           // the space a fix leaves between the hook and the captions (about one caption line's padding)
  maxTimes: 28,
  maxRounds: 2,
};

const n = (v, fallback = NaN) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback);
const r3 = (v) => Math.round(v * 1000) / 1000;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const attr = (attrs, name) => {
  const m = String(attrs).match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3]) : null;
};

/**
 * The composition's layers: the element children of #root in order (nth-child numbering), with their id, timing and
 * whether they hold any visible words. A small tag scanner is enough because compose.mjs writes the markup.
 */
export function rootLayers(html) {
  const s = String(html || "");
  const rootAt = s.search(/<div\b[^>]*\bid\s*=\s*["']root["']/i);
  if (rootAt < 0) return [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g;
  re.lastIndex = rootAt;
  const layers = [];
  let depth = 0, cur = null, last = rootAt, skip = null, m;
  while ((m = re.exec(s))) {
    const between = s.slice(last, m.index);
    last = re.lastIndex;
    if (m[0].startsWith("<!--")) continue;
    if (!skip && cur && depth >= 2 && /[\p{L}\p{N}]/u.test(between.replace(/&[a-z0-9#]+;/gi, " "))) cur.text = true;
    const close = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] || "";
    if (skip) { if (close && tag === skip) skip = null; continue; }
    if (close) {
      depth--;
      if (depth <= 1) cur = depth === 1 ? null : cur;
      if (depth <= 0) break;
      continue;
    }
    const selfClose = VOID.has(tag) || /\/\s*$/.test(attrs);
    if (depth === 1) {
      // data-gate="backdrop": a picture made of words (reel proof's wall of texts), read like a photo, never as text.
      cur = { index: layers.length + 1, tag, id: attr(attrs, "id"), start: n(attr(attrs, "data-start")), duration: n(attr(attrs, "data-duration")), text: false, ...(attr(attrs, "data-gate") === "backdrop" ? { backdrop: true } : {}) };
      layers.push(cur);
    }
    if (tag === "script" || tag === "style") { if (!selfClose) skip = tag; continue; }
    if (!selfClose) depth++;
  }
  return layers;
}

/** The moments to look at: inside every timed text layer, and a spread across the reel for the untimed ones. */
export function gateTimes(layers = [], duration = 0, { max = GATE_RULES.maxTimes } = {}) {
  const D = n(duration, 0);
  if (!(D > 0)) return [];
  const out = [];
  for (const layer of layers) {
    if (!layer.text || !(layer.duration > 0)) continue;
    const s = Math.max(0, n(layer.start, 0)), e = Math.min(D, s + layer.duration), d = e - s;
    if (d <= 0.05) continue;
    out.push(s + Math.min(0.6, d / 2), s + d / 2);
    if (d > 1.4) out.push(e - 0.3);
  }
  if (layers.some((layer) => layer.text && !(layer.duration > 0))) for (let k = 1; k <= 6; k++) out.push((D * k) / 7);
  const sorted = [...new Set(out.map((t) => r3(Math.min(D - 0.05, Math.max(0.05, t)))))].sort((a, b) => a - b);
  const deduped = sorted.filter((t, i) => i === 0 || t - sorted[i - 1] >= 0.15);
  if (deduped.length <= max) return deduped;
  return Array.from({ length: max }, (_, i) => deduped[Math.round((i * (deduped.length - 1)) / (max - 1))]);
}

/** A layer is drawn at t when it is untimed (captions decide per line) or t falls inside its window. */
export const layerActive = (layer, t) => !(layer.duration > 0) || (t >= n(layer.start, 0) - 0.01 && t <= n(layer.start, 0) + layer.duration + 0.01);

/** The page with every root layer transparent except one (index), or all of them (index null) for the empty frame. */
export function isolationHtml(html, index = null) {
  const css = index == null ? "#root > * { opacity: 0 !important; }" : `#root > *:not(:nth-child(${index})) { opacity: 0 !important; }`;
  const tag = `<style id="reel-gate-isolate">${css}</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tag}</head>`) : `${tag}${html}`;
}

/** Pixels a layer painted, against the empty frame, at a coarse grid. */
export function layerMask(png, blank, { step = GATE_RULES.step, diff = GATE_RULES.diff } = {}) {
  const W = png.width, H = png.height, w = Math.ceil(W / step), h = Math.ceil(H / step);
  const mask = new Uint8Array(w * h);
  let count = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0, yy = 0; y < H; y += step, yy++) {
    for (let x = 0, xx = 0; x < W; x += step, xx++) {
      const i = (y * W + x) * 4;
      const d = Math.abs(png.data[i] - blank.data[i]) + Math.abs(png.data[i + 1] - blank.data[i + 1]) + Math.abs(png.data[i + 2] - blank.data[i + 2]);
      if (d <= diff) continue;
      mask[yy * w + xx] = 1;
      count++;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  const box = count ? { x: x0, y: y0, w: x1 - x0 + step, h: y1 - y0 + step } : null;
  return { mask, w, h, step, W, H, count, box, coverage: count / (w * h) };
}

const lum = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
/**
 * How well a light text layer reads in the finished frame: its letter bodies (bright pixels of the layer drawn alone)
 * against the pixels just around them in the full frame, which include any shadow, outline or plate. Returns a
 * contrast ratio ((lighter + 0.05) / (darker + 0.05)), or null when the layer has no light letters there.
 */
export function letterContrast(layerPng, fullPng, m, { ring = 3, minLetter = 0.6 } = {}) {
  if (!m?.count) return null;
  const { w, h, step, W } = m;
  const fill = new Uint8Array(w * h);
  let fillSum = 0, fillN = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    if (!m.mask[yy * w + xx]) continue;
    const i = (yy * step * W + xx * step) * 4;
    if (lum(layerPng.data, i) < minLetter) continue;
    fill[yy * w + xx] = 1;
    fillSum += lum(fullPng.data, i);
    fillN++;
  }
  if (fillN < 30) return null;
  let ringSum = 0, ringN = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    if (m.mask[yy * w + xx]) continue;
    let near = false;
    for (let dy = -ring; dy <= ring && !near; dy++) for (let dx = -ring; dx <= ring; dx++) {
      const y2 = yy + dy, x2 = xx + dx;
      if (y2 >= 0 && y2 < h && x2 >= 0 && x2 < w && fill[y2 * w + x2]) { near = true; break; }
    }
    if (!near) continue;
    ringSum += lum(fullPng.data, (yy * step * W + xx * step) * 4);
    ringN++;
  }
  if (!ringN) return null;
  const a = fillSum / fillN, b = ringSum / ringN;
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}

/** Sampled pixels of `a` that have a pixel of `b` within `pad` pixels (summed-area table, so it stays linear). */
export function overlapCount(a, b, { pad = GATE_RULES.pad } = {}) {
  if (!a.count || !b.count || a.w !== b.w || a.h !== b.h) return 0;
  const { w, h } = a, r = Math.max(0, Math.round(pad / a.step));
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += b.mask[y * w + x]; sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row; }
  }
  let hits = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!a.mask[y * w + x]) continue;
      const xa = Math.max(0, x - r), ya = Math.max(0, y - r), xb = Math.min(w, x + r + 1), yb = Math.min(h, y + r + 1);
      if (sum[yb * (w + 1) + xb] - sum[ya * (w + 1) + xb] - sum[yb * (w + 1) + xa] + sum[ya * (w + 1) + xa] > 0) hits++;
    }
  }
  return hits;
}

/** Share of a layer's pixels outside the safe zone, and which edges it crosses ("buttons" is the right button column). */
export function safeZoneSpill(m, safe = GATE_SAFE) {
  // The zone is the platforms' 9:16 overlay; a landscape render (YouTube, a wide VSL) has none.
  if (!m.count || m.H / m.W < 1.5) return { share: 0, edges: [] };
  const { w, h, step, W, H } = m;
  const sx = W / 1080;
  safe = { ...safe, left: safe.left * sx, right: safe.right * sx, iconRight: safe.iconRight * sx };
  const right = Math.min(safe.right, W), top = safe.top * H, bottom = safe.bottom * H;
  let out = 0;
  const edges = new Set();
  for (let yy = 0; yy < h; yy++) {
    const y = yy * step;
    const rightHere = y >= safe.iconFrom * H && y <= safe.iconTo * H ? Math.min(right, safe.iconRight) : right;
    for (let xx = 0; xx < w; xx++) {
      if (!m.mask[yy * w + xx]) continue;
      const x = xx * step;
      let bad = false;
      if (x < safe.left) { edges.add("left"); bad = true; }
      if (x > rightHere) { edges.add(rightHere < right ? "buttons" : "right"); bad = true; }
      if (y < top) { edges.add("top"); bad = true; }
      if (y > bottom) { edges.add("bottom"); bad = true; }
      if (bad) out++;
    }
  }
  return { share: out / m.count, edges: [...edges] };
}

const layerName = (layer) => layer.id || `${layer.tag} #${layer.index}`;
const kindOf = (layer) => {
  const id = String(layer.id || "");
  if (id === "hook") return "hook";
  if (id === "captions") return "captions";
  if (id === "cta") return "cta";
  if (/^gfx-\d+$/.test(id)) return "card";
  if (/^pro-\d+$/.test(id)) return "procard";
  if (/^slam-\d+$/.test(id)) return "slam";
  if (/^icon-\d+$/.test(id)) return "icon";
  return "other";
};
const indexOf = (layer) => Number(String(layer.id || "").match(/-(\d+)$/)?.[1]);

/**
 * Layout verdict from measured masks: frames = [{ t, layers: { [index]: mask } }]. Only layers that hold words are
 * compared; full-screen layers (a photo, a full card) are skipped because text over them is the design.
 */
export function layoutProblems(frames = [], layers = [], rules = GATE_RULES, safe = GATE_SAFE, { fullIds = [] } = {}) {
  // A full-screen pro card (the full list, the split list) is a full layer by design even where it measures under
  // 40%: its obsidian panel over Greg's dark shirt barely differs from the footage (the split list, Nov 27).
  const full = new Set(fullIds);
  const byIndex = new Map(layers.map((layer) => [layer.index, layer]));
  const seen = new Map();
  const add = (problem) => {
    const key = `${problem.code}|${problem.layers.join("|")}`;
    const prior = seen.get(key);
    if (prior) { prior.times.push(problem.at); return; }
    problem.times = [problem.at];
    seen.set(key, problem);
  };
  for (const frame of frames) {
    const active = Object.entries(frame.layers || {}).map(([index, mask]) => ({ layer: byIndex.get(Number(index)), mask }))
      .filter((item) => item.layer && item.mask?.count && item.mask.coverage < rules.full && !full.has(item.layer.id));
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        const hits = Math.min(overlapCount(a.mask, b.mask, rules), overlapCount(b.mask, a.mask, rules));
        if (hits < rules.minOverlap) continue;
        add({ code: "text-overlap", level: "hold", at: frame.t, layers: [layerName(a.layer), layerName(b.layer)], kinds: [kindOf(a.layer), kindOf(b.layer)], boxes: [a.mask.box, b.mask.box], message: `${layerName(a.layer)} and ${layerName(b.layer)} touch on screen at ${frame.t.toFixed(2)}s (${hits * a.mask.step * a.mask.step} px)` });
      }
      const spill = safeZoneSpill(active[i].mask, safe);
      if (spill.share > rules.outside) {
        add({ code: "safe-zone", level: "hold", at: frame.t, layers: [layerName(active[i].layer)], kinds: [kindOf(active[i].layer)], boxes: [active[i].mask.box], edges: spill.edges, message: `${layerName(active[i].layer)} reaches past the safe zone (${spill.edges.join("/")}) at ${frame.t.toFixed(2)}s (${Math.round(spill.share * 100)}% of it)` });
      }
    }
  }
  return [...seen.values()];
}

const OK_DOUBLES = new Set(["very", "really", "no", "yes", "yeah", "bye", "ha", "go", "so", "now", "more", "again", "over", "down", "up", "round", "knock", "tick", "chop", "blah", "hey", "na", "la"]);

/**
 * Dead air: a stretch of the reel with no words over `max` s (Greg reading the chat, the room between takes: 6.2 s
 * of it passed the gate in an IMG_4766 clip, Nov 27). Talking-head vertical reels only: a proof reel's texts and a
 * speaker reel's music hold on purpose. Each problem carries the gap in source seconds (cutSource, from cuts.json)
 * so the edit can be run again with it cut, leaving 0.25 s after the last word and 0.15 s before the next.
 */
export function deadAirProblems(plan = {}, cuts = null, { max = 2.0 } = {}) {
  if (!(n(plan.canvas?.height, 0) > n(plan.canvas?.width, 0))) return [];
  if (plan.style?.look === "receipts" || plan.receipts || plan.speaker || plan.style?.speaker?.enabled) return [];
  const words = (plan.words || []).filter((w) => !w.drop && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end))).sort((a, b) => a.start - b.start);
  if (words.length < 2) return [];
  const segs = (cuts?.segments || []).map((x) => ({ start: Number(x.start), end: Number(x.end) }));
  // Reel time to source time through the kept segments, in order.
  const toSource = (t) => {
    let acc = 0;
    for (const sg of segs) {
      const len = sg.end - sg.start;
      if (t <= acc + len + 1e-6) return sg.start + (t - acc);
      acc += len;
    }
    return null;
  };
  const out = [];
  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  for (let k = 1; k < words.length; k++) {
    const a = Number(words[k - 1].end), b = Number(words[k].start);
    if (b - a <= max) continue;
    const s0 = toSource(a + 0.25), s1 = toSource(b - 0.15);
    const cutSource = segs.length && s0 != null && s1 != null && s1 - s0 > 0.3 ? { start: r3(s0), end: r3(s1) } : null;
    out.push({ code: "dead-air", level: "hold", at: r3(a), gap: r3(b - a), ...(cutSource ? { cutSource } : {}), message: `${r3(b - a)} s with no words at ${clock(a)} (after "${String(words[k - 1].text).trim()}")` });
  }
  return out;
}

/** Caption text that cannot be right: the same word twice in a row, or a word followed by its own tail ("Bootcamp Camp"). */
export function captionProblems(plan = {}) {
  const items = [];
  (plan.captions || []).forEach((cap, i) => {
    const words = cap.words?.length ? cap.words.map((w) => w.text) : String(cap.text || "").split(/\s+/);
    words.forEach((text, j) => textTokens(text).forEach((token) => items.push({ token, cap: i, word: j, t: n(cap.words?.[j]?.start, n(cap.start, 0)) })));
  });
  const problems = [];
  for (let k = 1; k < items.length; k++) {
    const a = items[k - 1], b = items[k];
    if (a.cap === b.cap && a.word === b.word) continue;
    const same = a.token === b.token && !OK_DOUBLES.has(a.token) && /[a-z]/.test(a.token);
    const tail = b.token.length >= 3 && a.token.length > b.token.length && a.token.endsWith(b.token);
    if (!same && !tail) continue;
    problems.push({ code: "caption-double", level: "hold", at: b.t, cap: b.cap, word: b.word, message: `caption shows "${a.token} ${b.token}" at ${b.t.toFixed(2)}s, a doubled word` });
  }
  return problems;
}

// Spoken asks the ending must keep. "Link in bio" is left out on purpose: cuts.mjs trims it as a sign-off.
const CTA_PATTERNS = [
  /\bcomment(?: the word)? [a-z]+/, /\b(?:dm|message|text) me\b/, /\bsend me\b/, /\bjoin (?:me|us)\b/, /\binvite you\b/,
  /\bbook (?:a|your|an) (?:free )?(?:call|session|spot|seat)\b/, /\bsign up\b/, /\bregister (?:now|today|here|for|at)\b/,
  /\bapply (?:now|today|here|at|for)\b/, /\b(?:click|tap) (?:on )?the link\b/, /\bfollow me\b/,
  // The v11 front door (Reel 11, 11-25: "Take the free sales scorecard." read as no ask at all).
  /\b(?:take|grab|get|try|do) (?:the|my|our|this) (?:free |quick )?(?:sales )?(?:score ?card|quiz|assessment)\b/,
];

/**
 * A spoken ask that the cut lost: cuts.words (source order, with drop flags) holds the ask late in the clip, every
 * word of it was dropped, and the same ask is not kept anywhere else. The fix is the same edit ending after it.
 */
const sentenceEnd = (text) => /[.!?]["”’']*$/.test(String(text).trim());

export function ctaProblems(cuts = null, { tailShare = 0.4, tailSeconds = 15 } = {}) {
  const words = (cuts?.words || []).filter((w) => Number.isFinite(Number(w.start)));
  if (!words.length) return [];
  const end = n(cuts.originalDuration, n(words.at(-1).end, 0));
  const toks = words.map((w, i) => ({ i, tok: textTokens(w.text).join(" ") })).filter((x) => x.tok);
  const kept = toks.filter((x) => !words[x.i].drop).map((x) => x.tok).join(" ");
  const problems = [];
  for (let k = 0; k < toks.length; k++) {
    const w = words[toks[k].i];
    if (w.start < Math.min(end * (1 - tailShare), end - tailSeconds)) continue;
    const ahead = toks.slice(k, k + 8).map((x) => x.tok).join(" ");
    const hit = CTA_PATTERNS.find((re) => { const m = ahead.match(re); return m && m.index === 0; });
    if (!hit) continue;
    // The ask runs to the end of its sentence (at most 16 words); the phrase to end after starts with the sentence.
    let last = k, first = k;
    while (last < toks.length - 1 && last - k < 15 && !sentenceEnd(words[toks[last].i].text)) last++;
    while (first > 0 && k - first < 6 && !sentenceEnd(words[toks[first - 1].i].text)) first--;
    const span = toks.slice(k, last + 1);
    const phrase = toks.slice(first, last + 1).map((x) => String(words[x.i].text).replace(/[.,!?;:"“”]+/g, "")).join(" ").trim();
    const allDropped = span.every((x) => words[x.i].drop);
    const keptElsewhere = ` ${kept} `.includes(` ${span.slice(0, 3).map((x) => x.tok).join(" ")} `);
    if (allDropped && !keptElsewhere) problems.push({ code: "cta-cut", level: "hold", at: r3(w.start), endAfter: phrase, message: `the spoken ask "${phrase}" (${r3(w.start)}s in the clip) was cut from the ending` });
    k = last;
  }
  return problems.slice(-1);
}

/** Quiet captions that read poorly in at least 30% of the frames looked at (2 at least) hold until boxed. */
export function contrastProblems(frames = [], { minRatio = 1.8, share = 0.3 } = {}) {
  const read = frames.filter((f) => Number.isFinite(f.contrast?.captions));
  const poor = read.filter((f) => f.contrast.captions < minRatio);
  if (poor.length < 2 || poor.length < share * read.length) return [];
  return [{ code: "caption-contrast", level: "hold", at: poor[0].t, times: poor.map((f) => f.t), layers: ["captions"], kinds: ["captions"], message: `captions wash out against the picture at ${poor.slice(0, 4).map((f) => `${f.t.toFixed(2)}s (${f.contrast.captions}:1)`).join(", ")}` }];
}

/** Notes only (never a hold): no spoken ask and no on-screen CTA anywhere. */
export function ctaNotes(plan = {}) {
  const spoken = (plan.words || []).filter((w) => !w.drop).map((w) => textTokens(w.text).join(" ")).filter(Boolean).join(" ");
  if (plan.cta || CTA_PATTERNS.some((re) => re.test(spoken)) || /\b(?:link|score ?card|quiz) (?:is )?in (?:my )?bio\b/.test(spoken)) return [];
  return [{ code: "no-cta", level: "note", message: "nothing in the reel asks the viewer to do anything (no spoken ask, no CTA card); the post caption has to carry it" }];
}

const CARD_TEXT_FIELDS = new Set(["eyebrow", "headline", "title", "text", "value", "value2", "sub", "label", "note", "unit", "context", "name"]);
/** Close up transcript spacing in a card's shown text, in place. */
export function tidyCardText(value) {
  if (Array.isArray(value)) { value.forEach((item, i) => { if (typeof item === "string") value[i] = tidyText(item); else tidyCardText(item); }); return value; }
  if (!value || typeof value !== "object") return value;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "string" && CARD_TEXT_FIELDS.has(key)) value[key] = tidyText(v);
    else if (v && typeof v === "object") tidyCardText(v);
  }
  return value;
}
const tidyText = (text) => String(text)
  .replace(/(\d) ([,.])(\d)/g, "$1$2$3")          // 1 ,000 -> 1,000; 2 .5 -> 2.5
  .replace(/([\p{L}\p{N}]) ([,.!?;:%])(?=\s|$)/gu, "$1$2") // word , -> word,
  .replace(/(\p{L}) -(\p{L})/gu, "$1-$2")          // Re -loop -> Re-loop
  .replace(/(\p{L})- (\p{Ll})/gu, "$1-$2")         // self- made -> self-made
  .replace(/ {2,}/g, " ");

const FILLER = new Set(["right", "ok", "okay", "so", "um", "uh", "like", "yeah", "yes", "no", "well", "and", "but", "you", "know", "i", "mean", "guys", "alright", "hey", "oh", "wow"]);
/** A card whose words are only filler, or one word said over and over. */
export function fillerCard(card) {
  if (!card || typeof card !== "object") return false;
  const tokens = textTokens(shownText(card));
  if (!tokens.length) return false;
  const unique = new Set(tokens);
  return tokens.every((t) => FILLER.has(t)) || (unique.size === 1 && tokens.length >= 2 && !/\d/.test(tokens[0]));
}

/** Same spelling except case and punctuation around it ("Confidence," keeps its comma). */
const swapWord = (original, replacement) => {
  const m = String(original).match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}'’]+)([^\p{L}\p{N}]*)$/u);
  if (!m) return original;
  const word = m[2] === m[2].toUpperCase() && m[2].length > 1 ? replacement.toUpperCase() : /^\p{Lu}/u.test(m[2]) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  return `${m[1]}${word}${m[3]}`;
};

/**
 * A hook word the speaker never says but nearly does: same start, same ending, about the same length
 * ("competence" on screen, "confidence" spoken; a Nov 23 clip). Returns the spoken word to use, or null.
 */
export function spokenNearMiss(token, spoken = new Map()) {
  const counts = spoken instanceof Map ? spoken : new Map([...spoken].map((w) => [w, 1]));
  if (token.length < 5 || !/^[a-z]+$/.test(token) || counts.has(token)) return null;
  let best = null;
  for (const [word, count] of counts) {
    if (!/^[a-z]+$/.test(word) || Math.abs(word.length - token.length) > 2 || word.slice(0, 2) !== token.slice(0, 2) || word.slice(-3) !== token.slice(-3)) continue;
    const d = editDistance(token, word);
    // A one- or two-letter slip, or a same-length word the speaker keeps saying (competence / confidence, said twice+).
    const ok = d <= 2 || (word.length === token.length && d <= 4 && count >= 2);
    if (ok && (!best || d < best.d)) best = { word, d };
  }
  return best?.word || null;
}

/**
 * Fixes that need no measuring, made to plan.json before the render so they cost no extra pass: a doubled caption
 * word, a caption line too short to read (merged into its neighbour), a hook word that is a near miss of the word
 * actually spoken. Returns { plan, applied }.
 */
export function planFixes(plan = {}, { minShow = 0.3 } = {}) {
  let next = JSON.parse(JSON.stringify(plan));
  const applied = [];
  const doubles = captionProblems(next);
  if (doubles.length) {
    const fixed = gateFixes(doubles, next);
    next = fixed.plan;
    applied.push(...fixed.applied);
  }
  // Card text: transcript spacing that leaked onto a card ("1 ,000", "Re -loop.") is closed up, and a card that says
  // only filler ("RIGHT", "bat, bat, bat"; Nov 19) is dropped.
  if (Array.isArray(next.graphics)) {
    next.graphics.forEach((card, i) => {
      if (!card || typeof card !== "object") return;
      const before = shownText(card);
      tidyCardText(card);
      const after = shownText(card);
      if (after !== before) applied.push(`card ${i + 1} text tidied: "${before.slice(0, 60)}" -> "${after.slice(0, 60)}"`);
    });
    const kept = next.graphics.filter((card, i) => {
      if (!fillerCard(card)) return true;
      applied.push(`card ${i + 1} (${card.type || "card"}) dropped: it only said "${shownText(card).slice(0, 40)}"`);
      return false;
    });
    next.graphics = kept;
  }
  // A card with no words on it (an empty note card, Oct 29) never reaches the render.
  if (Array.isArray(next.graphics)) {
    const keep = next.graphics.filter((card) => !card || typeof card !== "object" || shownText(card) || card.image || card.src || card.photo);
    if (keep.length < next.graphics.length) {
      next.graphics.forEach((card, i) => { if (!keep.includes(card)) applied.push(`card ${i + 1} (${card.type || "card"}) dropped: it had no words on it`); });
      next.graphics = keep;
    }
  }
  // Lines on screen under 0.3 s join the next line when it follows at once (or the one before); pro captions carry
  // their own layout per line, so they are left to the text check.
  const caps = next.captions || [];
  if (!next.style?.captions?.pro && caps.length > 1) {
    const maxChars = Number(next.style?.captions?.maxChars) || 22;
    for (let i = 0; i < caps.length; i++) {
      const cap = caps[i];
      if (!(n(cap.end, 0) - n(cap.start, 0) < minShow) || !cap.words?.length) continue;
      const after = caps[i + 1], before = caps[i - 1];
      const fits = (other) => other?.words?.length && `${other.text || ""} ${cap.text || ""}`.length <= Math.round(maxChars * 1.5);
      const target = after && fits(after) && n(after.start, 0) - n(cap.end, 0) < 0.25 ? after : before && fits(before) && n(cap.start, 0) - n(before.end, 0) < 0.25 ? before : null;
      if (!target) continue;
      if (target === after) { target.words = [...cap.words, ...target.words]; target.start = Math.min(n(target.start, 0), n(cap.start, 0)); }
      else { target.words = [...target.words, ...cap.words]; target.end = Math.max(n(target.end, 0), n(cap.end, 0)); }
      target.text = target.words.map((w) => w.text).join(" ");
      applied.push(`caption "${cap.text}" (${(n(cap.end, 0) - n(cap.start, 0)).toFixed(2)}s, too quick to read) joined to "${target.text}"`);
      caps.splice(i, 1);
      i--;
    }
  }
  // Hook words: the on-screen hook says what the speaker says.
  const spoken = new Map();
  for (const token of (next.words || []).filter((w) => !w.drop).flatMap((w) => textTokens(w.text))) spoken.set(token, (spoken.get(token) || 0) + 1);
  if (next.hook && spoken.size) {
    const words = Array.isArray(next.hook.words) ? next.hook.words : null;
    const parts = String(next.hook.text || "").split(/(\s+)/);
    let changed = false;
    for (let k = 0; k < parts.length; k++) {
      const token = textTokens(parts[k].replace(/\*/g, ""))[0];
      const fix = token && textTokens(parts[k]).length === 1 ? spokenNearMiss(token, spoken) : null;
      if (!fix) continue;
      const before = parts[k];
      parts[k] = parts[k].replace(/[\p{L}\p{N}'’]+/u, (m) => swapWord(m, fix));
      if (words) for (const w of words) if (textTokens(w.text)[0] === token) w.text = swapWord(w.text, fix);
      applied.push(`hook word "${before.replace(/\*/g, "")}" changed to "${fix}", the word actually said`);
      changed = true;
    }
    if (changed) next.hook.text = parts.join("");
  }
  return { plan: next, applied };
}

/**
 * Captions over silence: a line whose time is at least 80% inside a stretch of the voice track with nothing heard
 * captions words nobody can hear (inaudible audio left in, Nov 19: "25 seconds of silence in it"). They go.
 */
export function silentCaptions(plan = {}, quiet = [], { share = 0.8 } = {}) {
  const next = JSON.parse(JSON.stringify(plan));
  const applied = [];
  if (!Array.isArray(next.captions) || !quiet.length) return { plan: next, applied };
  next.captions = next.captions.filter((cap) => {
    const s0 = n(cap.start, 0), e0 = n(cap.end, s0), d = e0 - s0;
    if (!(d > 0)) return true;
    const silent = quiet.reduce((sum, q) => sum + Math.max(0, Math.min(e0, q.end) - Math.max(s0, q.start)), 0);
    if (silent < share * d) return true;
    applied.push(`caption "${cap.text}" at ${s0.toFixed(2)}s removed: nothing is heard there`);
    return false;
  });
  return { plan: next, applied };
}

const unionBox = (boxes) => {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  const x = Math.min(...list.map((b) => b.x)), y = Math.min(...list.map((b) => b.y));
  return { x, y, w: Math.max(...list.map((b) => b.x + b.w)) - x, h: Math.max(...list.map((b) => b.y + b.h)) - y };
};

/**
 * Turn problems into plan changes. Returns the changed plan (a copy), what was done, and what could not be fixed.
 * frames/layers are the measured masks, so moves use real pixel extents rather than font estimates.
 */
export function gateFixes(problems = [], plan = {}, { frames = [], layers = [], faces = [], rules = GATE_RULES, safe = GATE_SAFE } = {}) {
  const next = JSON.parse(JSON.stringify(plan));
  const H = n(plan.canvas?.height, 1920);
  const applied = [], unfixable = [];
  const drop = { graphics: new Set(), slams: new Set(), icons: new Set(), pro: new Set() };
  const boxesOf = (id, times = null) => frames.filter((f) => !times || times.includes(f.t)).flatMap((f) => {
    const layer = layers.find((l) => l.id === id);
    const m = layer && f.layers?.[layer.index];
    return m?.count && m.coverage < rules.full ? [m.box] : [];
  });
  let movedText = false, rebroke = false;
  for (const p of problems) {
    if (p.code === "safe-zone" && p.kinds[0] === "captions" && next.style?.captions?.pro && Array.isArray(next.captions) && p.edges.every((e) => ["left", "right", "buttons"].includes(e))) {
      // Pro captions broken for an older, wider plate (a plan made before the 150 px side strips, Nov 26) reach the
      // side strip or the button column: break them again at today's width; a cue that no longer fits two lines
      // becomes shorter cues the way the edit splits them. Its word marks follow their words.
      if (rebroke) continue;
      let measure = null;
      try { measure = loadProMeasure(fontFile(next.style, "Inter.ttf")); } catch {}
      if (measure) {
        let changed = 0;
        next.captions = next.captions.flatMap((g) => {
          if (!g.words?.length) return [g];
          const lines = proLineBreaks(g.words, { measure });
          if (lines) {
            const counts = lines.map((l) => l.length);
            if (JSON.stringify(counts) !== JSON.stringify(g.lines)) changed++;
            return [{ ...g, lines: counts }];
          }
          changed++;
          try { return splitProPhrases(g.words, n(g.end, Infinity), { measure }).map((part) => ({ ...part, ...(g.y != null ? { y: g.y } : {}), ...(g.thought != null ? { thought: g.thought } : {}) })); } catch { return [g]; }
        });
        if (changed) {
          if (Array.isArray(next.proGraphics)) next.proGraphics = attachProWordMarks(next.proGraphics, next.captions);
          applied.push(`captions broken again for the ${PRO_CAPTION_PLATE} px plate (${changed} cue${changed === 1 ? "" : "s"}), clear of the side strips and the button column`);
          rebroke = true;
          continue;
        }
      }
      unfixable.push(p);
      continue;
    }
    if (p.code === "text-overlap" && p.kinds.includes("hook") && p.kinds.includes("captions") && !movedText) {
      const hook = unionBox(boxesOf("hook", p.times)), capsAt = unionBox(boxesOf("captions", p.times)), capsAll = unionBox(boxesOf("captions"));
      const capStyle = next.style?.captions, hookStyle = next.style?.hook;
      if (hook && capsAt && capsAll && capStyle && Number.isFinite(Number(capStyle.position))) {
        const shift = hook.y + hook.h + rules.gap - capsAt.y;
        if (capsAll.y + capsAll.h + shift <= safe.bottom * H) {
          const pos = r3(Number(capStyle.position) + shift / H);
          capStyle.position = pos;
          if (Number.isFinite(Number(capStyle.placeMin))) capStyle.placeMin = Math.max(Number(capStyle.placeMin), pos);
          if (Number.isFinite(Number(capStyle.placeMax))) capStyle.placeMax = Math.max(Number(capStyle.placeMax), pos);
          applied.push(`captions moved down ${Math.round(shift)} px (to ${Math.round(pos * 100)}% of the height) to clear the hook`);
          movedText = true;
          continue;
        }
        const hookShift = capsAt.y - rules.gap - (hook.y + hook.h);
        if (hookStyle && Number.isFinite(Number(hookStyle.position)) && hook.y + hookShift >= safe.top * H) {
          const pos = r3(Number(hookStyle.position) + hookShift / H);
          hookStyle.position = pos;
          applied.push(`hook moved up ${Math.round(-hookShift)} px (to ${Math.round(pos * 100)}% of the height) to clear the captions`);
          movedText = true;
          continue;
        }
      }
      unfixable.push(p);
      continue;
    }
    if (p.code === "text-overlap" && p.kinds.includes("cta") && (p.kinds.includes("captions") || p.kinds.includes("hook"))) {
      // The CTA card moves up, clear of the other text; it is the ask, so it is never the one dropped.
      const other = p.kinds.includes("captions") ? "captions" : "hook";
      const cta = unionBox(boxesOf("cta", p.times)), below = unionBox(boxesOf(other, p.times));
      if (cta && below && next.cta) {
        const shift = below.y - rules.gap - (cta.y + cta.h);
        const pos = Number(next.cta.position ?? next.style?.cta?.position ?? 0.62);
        if (shift < 0 && cta.y + shift >= safe.top * H && Number.isFinite(pos)) {
          next.cta.position = r3(pos + shift / H);
          applied.push(`CTA moved up ${Math.round(-shift)} px to clear the ${other}`);
          continue;
        }
      }
      unfixable.push(p);
      continue;
    }
    if (p.code === "safe-zone" && p.kinds[0] === "cta" && p.edges.every((e) => ["left", "right", "buttons"].includes(e))) {
      // A CTA too wide for the frame (a long "Comment KEYWORD" pill under the platform buttons, Nov 24) gets smaller
      // text, sized to fit with room for its 6% pulse. Never dropped: it is the ask.
      const box = unionBox(boxesOf("cta", p.times));
      const W = n(plan.canvas?.width, 1080), sx = W / 1080;
      const style = next.style || (next.style = {});
      const ct = style.cta || (style.cta = {});
      if (box) {
        const c = box.x + box.w / 2;
        const right = p.edges.includes("buttons") ? safe.iconRight * sx : safe.right * sx;
        const half = Math.min(c - safe.left * sx, right - c);
        const factor = Math.min(0.95, (2 * half - 12) / (box.w * 1.06));
        if (factor > 0.5) {
          const before = Number(ct.fontSizeFrac) || 0.036;
          ct.fontSizeFrac = Math.round(before * factor * 10000) / 10000;
          applied.push(`CTA text made ${Math.round((1 - factor) * 100)}% smaller so it clears the ${p.edges.includes("buttons") ? "button column" : "side strip"}`);
          continue;
        }
      }
      unfixable.push(p);
      continue;
    }
    if (p.code === "text-overlap" || p.code === "safe-zone") {
      // Drop the extra (a card, a slam, an icon); the hook and the captions are never the one dropped.
      const names = p.layers.map((name, i) => ({ name, kind: p.kinds[i] }));
      const extra = names.find((x) => x.kind === "card") || names.find((x) => x.kind === "procard") || names.find((x) => x.kind === "slam") || names.find((x) => x.kind === "icon");
      // A pro card is found by its id (pro-N), which is not its place in plan.proGraphics.
      if (extra?.kind === "procard" && Array.isArray(next.proGraphics) && next.proGraphics.some((g) => g.id === extra.name)) {
        if (!drop.pro.has(extra.name)) applied.push(`card ${extra.name} dropped (${p.code === "safe-zone" ? `it reached past the safe zone (${p.edges.join("/")})` : `it touched ${names.find((x) => x !== extra)?.name}`})`);
        drop.pro.add(extra.name);
        continue;
      }
      if (extra && extra.kind !== "procard") {
        const i = Number(extra.name.match(/-(\d+)$/)?.[1]);
        const bucket = extra.kind === "card" ? "graphics" : extra.kind === "slam" ? "slams" : "icons";
        if (Number.isInteger(i) && Array.isArray(next[bucket]) && next[bucket][i]) {
          if (!drop[bucket].has(i)) applied.push(`${extra.kind} ${i + 1} dropped (${p.code === "safe-zone" ? `it reached past the safe zone (${p.edges.join("/")})` : `it touched ${names.find((x) => x !== extra)?.name}`})`);
          drop[bucket].add(i);
          continue;
        }
      }
      unfixable.push(p);
      continue;
    }
    if (p.code === "caption-face" && !movedText) {
      // Captions over a face go under the chin: below the lowest face the detector saw at those moments.
      const capsAll = unionBox(boxesOf("captions"));
      const capStyle = next.style?.captions;
      const chin = faces.length ? Math.max(...faces.map((f) => f.y + f.h * 0.92)) : null;
      if (capsAll && chin != null && capStyle && Number.isFinite(Number(capStyle.position))) {
        const shift = chin + rules.gap - capsAll.y;
        if (shift > 0 && capsAll.y + capsAll.h + shift <= safe.bottom * H) {
          const pos = r3(Number(capStyle.position) + shift / H);
          capStyle.position = pos;
          if (Number.isFinite(Number(capStyle.placeMin))) capStyle.placeMin = Math.max(Number(capStyle.placeMin), pos);
          if (Number.isFinite(Number(capStyle.placeMax))) capStyle.placeMax = Math.max(Number(capStyle.placeMax), pos);
          applied.push(`captions moved down ${Math.round(shift)} px (to ${Math.round(pos * 100)}% of the height), under the face`);
          movedText = true;
          continue;
        }
      }
      unfixable.push(p);
      continue;
    }
    if (p.code === "caption-contrast") {
      const cap = next.style?.captions;
      if (cap?.quiet && !cap.plate) {
        cap.plate = 0.62;
        applied.push(`captions put on a soft dark box (they washed out against the picture at ${p.times.slice(0, 3).map((t) => `${t.toFixed(1)}s`).join(", ")})`);
        continue;
      }
      unfixable.push(p);
      continue;
    }
    if (p.code === "caption-double") {
      const cap = next.captions?.[p.cap];
      if (cap?.words?.[p.word]) {
        const removed = cap.words.splice(p.word, 1)[0];
        cap.text = cap.words.map((w) => w.text).join(" ");
        applied.push(`caption word "${removed.text}" at ${p.at.toFixed(2)}s taken out (it repeated the word before)`);
        continue;
      }
      unfixable.push(p);
      continue;
    }
    unfixable.push(p);
  }
  for (const [bucket, set] of Object.entries(drop)) if (set.size && bucket !== "pro") next[bucket] = next[bucket].filter((_, i) => !set.has(i));
  if (drop.pro.size) next.proGraphics = next.proGraphics.filter((g) => !drop.pro.has(g.id));
  // A caption emptied by a removal hands its time to the one before it.
  if (Array.isArray(next.captions)) {
    const kept = [];
    for (const cap of next.captions) {
      if ((cap.words && !cap.words.length) || (!cap.words && !String(cap.text || "").trim())) { if (kept.length) kept.at(-1).end = Math.max(n(kept.at(-1).end, 0), n(cap.end, 0)); continue; }
      kept.push(cap);
    }
    next.captions = kept;
  }
  return { plan: next, applied, unfixable };
}

function firstJSONObject(text) {
  const s = String(text || "");
  const at = s.indexOf("{");
  if (at < 0) return null;
  try { return JSON.parse(s.slice(at)); } catch { return null; }
}

/** One hyperframes snapshot run for a page variant: PNG paths keyed by time. */
async function snapshotTimes(projectDir, times, outDir) {
  const bin = hyperframesBin();
  const { out } = await run(bin[0], [...bin.slice(1), "snapshot", projectDir, "--at", times.join(","), "--no-end", "--keep", "-o", outDir, "--json"], { capture: true, env: renderEnv() });
  const j = firstJSONObject(out);
  if (!j?.frames?.length) throw new Error("snapshot returned no frames");
  return j.frames.map((f) => ({ t: r3(Number(f.time)), path: f.path }));
}

/** Copy of the project with one layer visible: every entry symlinked except the page itself. */
function variantDir(projectDir, html, index, base) {
  const dir = path.join(base, index == null ? "blank" : index === "all" ? "full" : `layer-${index}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(projectDir)) {
    if (entry === "index.html" || entry.startsWith(".")) continue;
    fs.symlinkSync(path.join(projectDir, entry), path.join(dir, entry));
  }
  fs.writeFileSync(path.join(dir, "index.html"), index === "all" ? html : isolationHtml(html, index));
  return dir;
}

/** Real-renderer footprint of every text layer at the chosen moments. */
export async function measureLayers(projectDir, { duration, rules = GATE_RULES, contrast = false, snapshot = snapshotTimes, readPng = (file) => PNG.sync.read(fs.readFileSync(file)) } = {}) {
  const html = fs.readFileSync(path.join(projectDir, "index.html"), "utf8");
  const layers = rootLayers(html);
  const textLayers = layers.filter((layer) => layer.text && !layer.backdrop);
  const times = gateTimes(textLayers, duration, rules);
  if (!textLayers.length || !times.length) return { layers, frames: [], times };
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "reel-gate-"));
  try {
    const blankShots = await snapshot(variantDir(projectDir, html, null, base), times, path.join(base, "out-blank"));
    const blank = new Map(blankShots.map((f) => [f.t, readPng(f.path)]));
    const frames = times.map((t) => ({ t, layers: {} }));
    for (const layer of textLayers) {
      const own = times.filter((t) => layerActive(layer, t));
      if (!own.length) continue;
      const shots = await snapshot(variantDir(projectDir, html, layer.index, base), own, path.join(base, `out-${layer.index}`));
      const captions = contrast && layer.id === "captions";
      const kept = new Map();
      for (const shot of shots) {
        const empty = blank.get(shot.t);
        const frame = frames.find((f) => Math.abs(f.t - shot.t) < 0.001);
        if (!empty || !frame) continue;
        const png = readPng(shot.path);
        frame.layers[layer.index] = layerMask(png, empty, rules);
        if (captions && frame.layers[layer.index].count) kept.set(shot.t, png);
      }
      // Quiet captions (no outline) can wash out over a bright wall or shirt: read them against the finished frame.
      if (captions && kept.size) {
        const full = await snapshot(variantDir(projectDir, html, "all", base), [...kept.keys()], path.join(base, "out-full"));
        for (const shot of full) {
          const frame = frames.find((f) => Math.abs(f.t - shot.t) < 0.001);
          const ratio = frame && letterContrast(kept.get(shot.t), readPng(shot.path), frame.layers[layer.index]);
          if (ratio != null) frame.contrast = { ...(frame.contrast || {}), captions: ratio };
        }
      }
    }
    return { layers, frames, times };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/** The human note: what was fixed, what holds the reel, what is only worth knowing. */
export function gateText(result) {
  const head = { hold: "HELD, not ready to post", fix: `fixing (round ${(result.round || 0) + 1})`, ok: "OK" }[result.verdict] || result.verdict;
  const lines = [`Master check: ${head}`, ""];
  const holds = (result.problems || []).filter((p) => p.level === "hold");
  if (holds.length) lines.push(result.verdict === "fix" ? "Found:" : "Why it's held:", ...holds.map((p) => `- ${p.message}`), "");
  if (result.fixes?.length) lines.push("Fixed before delivery:", ...result.fixes.map((f) => `- ${f}`), "");
  const notes = (result.problems || []).filter((p) => p.level !== "hold");
  if (notes.length) lines.push("Worth knowing:", ...notes.map((p) => `- ${p.message}`), "");
  return `${lines.join("\n").trimEnd()}\n`;
}

const brief = (p) => {
  const { mask, ...rest } = p;
  if (rest.boxes) rest.boxes = rest.boxes.map((b) => (b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) } : null));
  return rest;
};

/**
 * Run the gate on a rendered work folder. Returns { verdict: "ok" | "fix" | "hold", problems, fixes, plan? }.
 * "fix" carries the changed plan for the caller to rebuild; the caller runs the gate again on the new render.
 */
export async function runGate(workDir, { round = 0, fixes = [], rules = GATE_RULES, measure = measureLayers, faces: findFaces = detectFaces } = {}) {
  const planFile = path.join(workDir, "plan.json");
  const plan = readJSON(planFile);
  const read = (name) => { try { return readJSON(path.join(workDir, name)); } catch { return null; } };
  const problems = [];
  if (plan.video?.mirrored && !fixes.some((f) => /mirrored/.test(f))) fixes = ["footage flipped: it was mirrored (words in the shot read backwards)", ...fixes];
  let measured = { layers: [], frames: [], times: [] };
  try {
    const quiet = !!plan.style?.captions?.quiet && !plan.style?.captions?.plate;
    measured = await measure(path.join(workDir, "project"), { duration: n(plan.video?.duration, 0), rules, contrast: quiet });
    problems.push(...layoutProblems(measured.frames, measured.layers, rules, GATE_SAFE, { fullIds: (plan.proGraphics || []).filter((o) => o.fullscreen).map((o) => o.id) }));
    if (quiet) problems.push(...contrastProblems(measured.frames));
  } catch (error) {
    problems.push({ code: "gate-unavailable", level: "hold", message: `the layout could not be measured: ${String(error.message).split("\n")[0]}` });
  }
  problems.push(...captionProblems(plan));
  const air = deadAirProblems(plan, read("cuts.json"));
  problems.push(...air);
  const cta = ctaProblems(read("cuts.json"));
  problems.push(...cta);
  problems.push(...ctaNotes(plan));
  const textcheck = read("textcheck.json");
  // Captions over a face are the gate's to fix; the text check's other holds stand as they are.
  const onFace = (textcheck?.problems || []).filter((p) => p.code === "text-face" && /^caption-/.test(String(p.sample || "")));
  if (onFace.length) problems.push({ code: "caption-face", level: "hold", at: onFace[0].at, times: onFace.map((p) => p.at), layers: ["captions"], kinds: ["captions"], message: `captions sit on the face at ${[...new Set(onFace.map((p) => `${Number(p.at).toFixed(2)}s`))].slice(0, 4).join(", ")}` });
  if (textcheck?.verdict === "hold") {
    // The text check's own rule: a few quick caption lines are a note; only a systemic run of them holds.
    const own = (textcheck.problems || []).filter((p) => !onFace.includes(p));
    const flashes = own.filter((p) => p.code === "text-flash" && /^caption /.test(String(p.message)));
    for (const p of own) {
      if (flashes.includes(p) && flashes.length <= 2) continue;
      problems.push({ code: "textcheck", level: "hold", message: `text check: ${p.code}${Number.isFinite(Number(p.at)) ? ` at ${Number(p.at).toFixed(2)}s` : ""}: ${p.message}` });
    }
  }

  const holds = problems.filter((p) => p.level === "hold");
  const fixable = holds.filter((p) => ["text-overlap", "safe-zone", "caption-double", "caption-face", "caption-contrast"].includes(p.code));
  let result;
  if (holds.length && fixable.length && round < rules.maxRounds) {
    let faceBoxes = [];
    const faceProblem = fixable.find((p) => p.code === "caption-face");
    if (faceProblem && textcheck?.video) {
      const det = await findFaces(textcheck.video, faceProblem.times).catch(() => null);
      const W = n(plan.canvas?.width, 1080), H = n(plan.canvas?.height, 1920);
      faceBoxes = (det?.frames || []).flatMap((f) => f.faces || []).map((b) => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H }));
    }
    const fixed = gateFixes(fixable, plan, { frames: measured.frames, layers: measured.layers, faces: faceBoxes, rules });
    if (fixed.applied.length) result = { verdict: "fix", round, problems, fixes: [...fixes, ...fixed.applied], plan: fixed.plan };
  }
  if (!result) {
    const gaps = air.filter((p) => p.cutSource).map((p) => p.cutSource);
    const ask = cta.find((p) => p.endAfter);
    const retry = ask || gaps.length ? { ...(ask ? { endAfter: ask.endAfter } : {}), ...(gaps.length ? { cutGaps: gaps } : {}) } : null;
    result = { verdict: holds.length ? "hold" : "ok", round, problems, fixes, ...(retry ? { retry } : {}) };
  }
  const saved = { verdict: result.verdict, round, fixes: result.fixes, retry: result.retry || null, problems: problems.map(brief), notes: problems.map((p) => `gate-${p.code}: ${p.message}`), times: measured.times };
  writeJSON(path.join(workDir, "gate.json"), saved);
  fs.writeFileSync(path.join(workDir, "gate.txt"), gateText(result));
  // Publish and the Content Studio already draft anything whose text check holds; a gate hold rides the same file.
  if (result.verdict === "hold") {
    const tc = textcheck || { verdict: "hold", notes: [], problems: [] };
    const notes = [...(tc.notes || []).filter((x) => !/^gate-/.test(x)), ...holds.map((p) => `gate-${p.code}: ${p.message}`)];
    writeJSON(path.join(workDir, "textcheck.json"), { ...tc, verdict: "hold", notes });
  }
  return result;
}
