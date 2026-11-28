import { fitBlockHook, hookBlockHeight, BLOCK_HOOKS } from "./placement.mjs";
import { proLineBreaks, PRO_HOOK_LINE } from "./pro-captions.mjs";
import { norm } from "./text.mjs";
import { zoneFor, centredWidth } from "./safe-zone.mjs";

/** A single readable title; long supplied titles are shortened at word boundaries at the same type size. */
export function planProHook(words, { text, duration = 2.4, reelDuration, measure } = {}) {
  const source = pickHook(words, { text, maxWords: 12 });
  if (!source) return null;
  const all = source.text.replace(/\*/g, "").split(/\s+/).map((text) => ({ text }));
  const weak = /^(a|an|the|to|of|in|on|at|for|with|from|by|and|or|but|your|my|our|their|his|her|its|not|never|no|without|\d+)$/i;
  // Keep the whole title: step the size down (100, 88, 80, 72, 64 px on 1080x1920; measure is at 108), then try a
  // third line, before dropping a word. Since the 150 px side strips (Nov 26) the plate is narrower, and stopping at
  // 80 px cut written hooks mid-phrase ("...when you don't ease", IMG_4766 Nov 27).
  const seconds = Math.min(reelDuration, Math.max(2, Math.min(2.7, Number(duration) || 2.4)));
  const title = (lines, px) => ({ text: all.map((w) => w.text).join(" "), words: all, lines: lines.map((line) => line.length), fontSize: px, start: 0, duration: seconds });
  if (!weak.test(all.at(-1).text)) {
    for (const px of [100, 88, 80, 72, 64]) {
      const lines = proLineBreaks(all, { measure, maxWidth: PRO_HOOK_LINE * 108 / px });
      if (lines) return title(lines, px);
    }
    for (const px of [72, 64]) {
      const max = PRO_HOOK_LINE * 108 / px, lines = [];
      for (const w of all) {
        const line = lines.at(-1);
        if (line && measure([...line, w].map((x) => x.text).join(" ")) <= max) line.push(w); else lines.push([w]);
      }
      if (lines.length <= 3 && lines.every((line) => measure(line.map((x) => x.text).join(" ")) <= max)) return title(lines, px);
    }
  }
  const tokens = [...all];
  while (tokens.length) {
    const lines = proLineBreaks(tokens, { measure, maxWidth: PRO_HOOK_LINE * 108 / 80 });
    if (lines && !weak.test(tokens.at(-1).text)) {
      return { text: tokens.map((w) => w.text).join(" "), words: tokens, lines: lines.map((line) => line.length), fontSize: 80, start: 0, duration: Math.min(reelDuration, Math.max(2, Math.min(2.7, Number(duration) || 2.4))) };
    }
    tokens.pop();
  }
  throw new Error("pro hook cannot fit at 108 px; supply a shorter title");
}

/** The title itself carries duplicated opening words. Unrelated speech retains its caption. */
export function proCaptionsUnderHook(groups, hook, { measure } = {}) {
  if (!hook) return groups;
  const title = hook.words.map((w) => norm(w.text));
  const spoken = groups.flatMap((g) => g.words);
  const offset = spoken.findIndex((word, i) => word.start < hook.duration && title.every((t, j) => norm(spoken[i + j]?.text || "") === t));
  if (offset < 0) return groups;
  const hidden = new Set(spoken.slice(offset, offset + title.length).filter((w) => w.start < hook.duration));
  return groups.flatMap((g) => {
    const words = g.words.filter((w) => !hidden.has(w) || w.end > hook.duration);
    if (!words.length) return [];
    const start = hidden.has(words[0]) ? hook.duration : Math.max(g.start, words[0].start);
    const lines = proLineBreaks(words, { measure }) || [words];
    return [{ ...g, words, text: words.map((w) => w.text).join(" "), start, lines: lines.map((line) => line.length), ...(g.end - start < 0.5 ? { flags: ["short-cue"] } : {}) }];
  });
}

function cleanHook(s) {
  return s.replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/\s+/g, " ").replace(/[,.;:\-]+$/, "").trim();
}

/** Face-safe geometry for the solid house hook plaque. Null means there was no usable head measurement. */
export function plaqueLayout(words, options = {}) {
  const fit = fitBlockHook(words, { ...options, treat: "plaque" });
  if (!fit) return null;
  // Older block treatments express position at their text anchor. The plaque
  // is absolutely positioned from its top edge, so expose that coordinate.
  const above = { ...fit, position: fit.position - 1.2 * fit.fontSizeFrac, zone: "above" };
  // A head high in the frame leaves a thin band above it, and squeezing the plaque in there made a 12-word hook
  // unreadable on a phone (2026-10-30 real re-cut). When the text would drop below 85% or still not clear the head,
  // put the plaque at full size between the chin and the captions instead, if it fits there.
  const { headBottom, captionTop, fontSizeFrac, W = 1080, H = 1920, gap = 0.015 } = options;
  if (fit.fits && fit.fontSizeFrac >= fontSizeFrac * 0.85) return above;
  if (!(headBottom > 0) || !(captionTop > 0)) return above;
  const block = BLOCK_HOOKS.plaque;
  const top = headBottom + gap;
  // Between the chin and the captions the plaque is in the right button column's rows, so it keeps the column's
  // width clear on both sides (compose.mjs sets the same margins). Since the side strips (Nov 26) a long hook can need
  // a line more there: it gets one font step smaller (90%) before it is squeezed back above the head.
  const z = H / W >= 1.5 ? zoneFor(W, H) : null;
  const widthFrac = z ? centredWidth(z, top * H, captionTop * H) / W : undefined;
  for (const k of [1, 0.9]) {
    const frac = Math.round(fontSizeFrac * k * 10000) / 10000;
    const h = hookBlockHeight(words, { W, H, fontPx: Math.round(frac * H * block.em), widthFrac, charEm: block.charEm, lineHeight: block.lineHeight, padEm: block.padEm, goldScale: 1 });
    if (top + h <= captionTop - gap) return { fontSizeFrac: frac, position: Math.round(top * 1000) / 1000, fits: true, zone: "below" };
  }
  return above;
}

/**
 * The plaque beside the head on a wide (16:9) canvas. A head near the top of a wide frame leaves a band above it
 * that squeezed the plaque to a quarter of its size (Greg's VSL, 2026-11-04), while the wall beside the speaker sat
 * empty. This puts the plaque on the roomier side, at up to `grow` times the preset size on at most `maxLines` lines,
 * centred on the face and ending above the chin. Null when the canvas is not wide or neither side has the room.
 * left/right are the plaque's edges as fractions of the width from the left and right sides.
 */
export function sidePlaqueLayout(words, { headLeft, headRight, headTop, headBottom, fontSizeFrac, W = 1920, H = 1080, margin = 0.05, gap = 0.035, top = 0.06, maxLines = 3, grow = 1.4, minWidth = 0.24 } = {}) {
  if (!(W > H) || !(headRight > headLeft) || !(headBottom > headTop) || !(fontSizeFrac > 0)) return null;
  const room = { left: headLeft - gap - margin, right: 1 - margin - headRight - gap };
  const side = room.right >= room.left ? "right" : "left";
  const width = room[side];
  if (width < minWidth) return null;
  const block = BLOCK_HOOKS.plaque;
  const r = (x) => Math.round(x * 1000) / 1000;
  for (let frac = fontSizeFrac * grow; frac >= fontSizeFrac * 0.8; frac *= 0.94) {
    const fontPx = Math.round(frac * H * block.em);
    // The plaque's side padding (0.38 em each side) comes out of the width the words wrap in.
    const h = hookBlockHeight(words, { W, H, fontPx, widthFrac: width - (0.8 * fontPx) / W, charEm: block.charEm, lineHeight: block.lineHeight, padEm: block.padEm, goldScale: 1 });
    const lines = Math.round((h * H - block.padEm * fontPx) / (fontPx * block.lineHeight));
    const blockTop = Math.max(top, Math.min((headTop + headBottom) / 2 - h / 2, headBottom - h));
    if (lines > maxLines || blockTop < top - 1e-6 || blockTop + h > headBottom + 1e-6) continue;
    const left = side === "left" ? margin : headRight + gap;
    return { side, fontSizeFrac: r(frac), position: r(blockTop), left: r(left), right: r(1 - left - width), lines, zone: "side" };
  }
  return null;
}

/** How long the hook stays up: hook.duration seconds, or the whole reel for "reel" (one-line reels). */
export function hookSeconds(setting, reel) {
  if (setting === "reel") return reel;
  const s = Number(setting);
  return Math.min(Number.isFinite(s) && s > 0 ? s : 3, reel);
}

/**
 * Hook title for the first seconds. Pass text for an AI-written hook; otherwise the opening phrase is used
 * (up to maxWords, cut at the first sentence end once 3 words are in).
 */
export function pickHook(words, { text, maxWords = 8, duration = 3, start = 0 } = {}) {
  if (text) return { text: cleanHook(text), start, duration };
  const early = words.filter((w) => w.start < 8).slice(0, maxWords + 4);
  const picked = [];
  for (const w of early) {
    picked.push(w.text);
    if (picked.length >= 3 && /[.!?]$/.test(w.text.trim())) break;
    if (picked.length >= maxWords) break;
  }
  if (picked.length < 3) return null;
  const t = cleanHook(picked.join(" "));
  return t ? { text: t, start, duration, auto: true } : null;
}

/**
 * The call to action a client's own words ask for. `keywords` maps what they say to what the card says, e.g.
 * [{ say: ["bootcamp", "business builder"], text: "Comment BOOTCAMP" }] for a ManyChat keyword. The offer named
 * last wins; the card comes up when it is named (no earlier than 6 s and no later than 2.5 s before the end) and
 * stays to the end. A reel whose client asked for a CTA and did not get one was a hand edit (Nov 24).
 */
export function autoCta(words = [], duration = 0, cta = {}) {
  const entries = Array.isArray(cta?.keywords) ? cta.keywords.filter((k) => k?.text && Array.isArray(k.say) && k.say.length) : [];
  if (!entries.length || !(duration > 0)) return null;
  const spoken = words.filter((w) => !w.drop && Number.isFinite(Number(w.start))).map((w) => ({ tok: norm(String(w.text).replace(/’/g, "'")), start: Number(w.start) })).filter((w) => w.tok);
  let best = null;
  for (const entry of entries) {
    for (const phrase of entry.say) {
      const want = String(phrase).split(/\s+/).map((t) => norm(t)).filter(Boolean);
      if (!want.length) continue;
      for (let i = spoken.length - want.length; i >= 0; i--) {
        if (!want.every((t, j) => spoken[i + j].tok === t)) continue;
        if (!best || spoken[i].start > best.at) best = { entry, at: spoken[i].start };
        break;
      }
    }
  }
  if (!best) return null;
  const start = Math.max(0, Math.min(Math.max(best.at, duration - 6), duration - 2.5));
  return pickCta(duration, { ...cta, text: best.entry.text, start, duration: duration - start, keywords: undefined });
}

/** Pop-up call to action. Defaults to the last `last` seconds; `start`/`duration` override. */
export function pickCta(duration, { text, last = 3, start = null, duration: dur = null, style = "pill", position = 0.62, uppercase = true } = {}) {
  if (!text) return null;
  const d = Math.min(dur ?? last, duration);
  const s = start != null ? Math.max(0, Math.min(start, duration - 0.3)) : Math.max(0, duration - d);
  const clean = cleanHook(text);
  return { text: uppercase ? clean.toUpperCase() : clean, start: Math.round(s * 1000) / 1000, duration: Math.round(Math.min(d, duration - s) * 1000) / 1000, style, position };
}

// Words a title may never end on: they leave the thought hanging ("...is, who", "...to prospect, follow up").
const DANGLING = /^(a|an|the|to|of|in|on|at|for|with|from|by|and|or|but|so|that|which|who|what|when|is|are|was|were|be|your|my|our|their|his|her|its|not|if|because|than|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t|won'?t|can'?t|cannot)$/i;
const sentenceStop = (t) => /[.!?]["'”’)]*$/.test(String(t).trim());

/**
 * The opening line as the hook, only when it is a complete thought: the first sentence, 3 to `maxWords` words.
 * Null when the first sentence runs longer (cutting it at a word count is what made "...is, who" hooks on clips
 * that were already cut, Nov 27) or does not finish inside the first 8 s.
 */
export function openingHook(words = [], { maxWords = 12, within = 8 } = {}) {
  const picked = [];
  for (const w of words) {
    if (w.drop) continue;
    if (Number(w.start) > within) return null;
    picked.push(String(w.text).trim());
    if (sentenceStop(w.text)) break;
    if (picked.length > maxWords) return null;
  }
  if (picked.length < 3 || picked.length > maxWords || !sentenceStop(picked.at(-1))) return null;
  return cleanHook(picked.join(" "));
}

/** A written hook passes when it is a complete thought: 3 to 10 words, no trailing comma or dangling word. */
export function goodHook(text) {
  const t = String(text || "").replace(/\*/g, "").trim();
  const ws = t.split(/\s+/).filter(Boolean);
  if (ws.length < 3 || ws.length > 10 || /[,;:\-–—]$/.test(t)) return false;
  return !DANGLING.test(ws.at(-1).replace(/[’‘]/g, "'").replace(/[^\p{L}']/gu, ""));
}

/** The prompt the clip picker's hooks follow (src/clips.mjs), for one reel's opening. */
export function hookPrompt(words = [], { voice = "" } = {}) {
  const opening = words.filter((w) => !w.drop && Number(w.start) < 25).map((w) => w.text).join(" ");
  return [
    "Write the on-screen hook for an Instagram reel from what the speaker says at the start. Reply with JSON only; use no tools.",
    "Rules: 4-8 words; true to what is said (his claim, in his words where you can); a complete thought that never ends on a comma or a dangling word; the key phrase in *asterisks*; no emoji, no dashes, no quotes.",
    voice ? `Voice:\n${voice.trim()}` : "",
    `Opening: ${opening}`,
    'Reply: {"hook":"..."}',
  ].filter(Boolean).join("\n");
}

/**
 * The hook text for a reel given none: the opening line when it is a complete thought, else a hook written the way
 * `reel clips` writes them (ask = Claude). Cached per opening in `cache` (a file path), so a rebuild never asks again.
 * Returns null when neither works (the caller keeps its old behaviour).
 */
export async function autoHookText(words = [], { maxWords = 12, ask = null, cache = null, voice = "", fsx = null } = {}) {
  const spoken = openingHook(words, { maxWords });
  if (spoken) return { text: spoken, source: "opening line" };
  if (!ask) return null;
  const key = words.filter((w) => !w.drop).slice(0, 60).map((w) => w.text).join(" ");
  if (cache && fsx?.existsSync(cache)) {
    try { const saved = JSON.parse(fsx.readFileSync(cache, "utf8")); if (saved.key === key && goodHook(saved.hook)) return { text: saved.hook, source: "written (cached)" }; } catch {}
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let hook = null;
    try { hook = (await ask(hookPrompt(words, { voice })))?.hook; } catch { return null; }
    if (goodHook(hook)) {
      if (cache && fsx) try { fsx.writeFileSync(cache, JSON.stringify({ key, hook }, null, 1)); } catch {}
      return { text: String(hook).trim(), source: "written" };
    }
  }
  return null;
}
