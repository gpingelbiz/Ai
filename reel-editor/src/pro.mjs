import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { classifyBeats, linesFromWords, findFlips } from "./beat-jobs.mjs";
import { GREG_PRESETS, isClientJob } from "./client-mode.mjs";
import { readFrame, viewFor, overlaps } from "./frame-place.mjs";
import { eventClock } from "./event-clock.mjs";
import { r3, writeJSON, warn } from "./util.mjs";
import { CARDS } from "./pro-cards/index.mjs";

export const PRO_MOTION = Object.freeze({ enter: 0.233, state: 0.3, exit: 0.167, strike: 0.2, hold: 2.4, underline: 0.267, circle: 0.367 });
export const PRO_RECTS = Object.freeze([
  { slot: "upper", x: 120, y: 288, w: 720, h: 176 },
  { slot: "torso", x: 120, y: 928, w: 720, h: 160 },
  { slot: "explanation", x: 120, y: 288, w: 720, h: 560 },
]);

export function proEnabled(preset, plan, env = process.env) {
  return preset?.pro?.enabled === true && preset.name === "pingel-pro" && plan?.preset === "pingel-pro" && GREG_PRESETS.includes(plan.preset) && !isClientJob(env) && plan.canvas?.height > plan.canvas?.width;
}

const tokens = (s) => String(s || "").toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}'$%]+/gu) || [];
const textAt = (words, a, b) => words.slice(a, b + 1).map((w) => w.text).join(" ").replace(/["“”]/g, "");
const typeFor = (t) => ({ list: "steps", "steps-rail": "steps", versus: "compare", number: "stat", quote: "correction", flip: "correction", "word-mark": "wordMark" }[t] || t);

export function proTextWidth(text, size) {
  return [...String(text)].reduce((n, c) => n + (/\s/.test(c) ? 0.3 : /[ilI.,!'’]/.test(c) ? 0.32 : /[MW@]/.test(c) ? 0.95 : /[A-Z]/.test(c) ? 0.75 : 0.65) * size, 0);
}

/** Conservative word wrapping keeps the promised font sizes instead of squeezing instructional copy. */
export function proTextLines(text, { width, size, maxLines = 1 } = {}) {
  const measure = (s) => proTextWidth(s, size);
  if (!(width > 0 && size > 0 && maxLines >= 1)) return null;
  const lines = [];
  for (const word of String(text || "").trim().split(/\s+/).filter(Boolean)) {
    if (measure(word) > width) return null;
    const last = lines.at(-1);
    if (last && measure(`${last} ${word}`) <= width) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines.length && lines.length <= maxLines ? lines : null;
}

// Repeated phrases belong to the nearest planned beat, never an earlier occurrence in the hook.
function phraseSpan(value, words, anchor = 0) {
  const needle = tokens(value);
  if (!needle.length) return null;
  const flat = words.flatMap((w, i) => tokens(w.text).map((t) => ({ t, i })));
  const hits = [];
  for (let k = 0; k <= flat.length - needle.length; k++) {
    if (needle.every((t, j) => t === flat[k + j].t)) hits.push({ from: flat[k].i, to: flat[k + needle.length - 1].i });
  }
  return hits.sort((a, b) => Math.abs(words[a.from].start - anchor) - Math.abs(words[b.from].start - anchor))[0] || null;
}

/** Convert graphics scenes, glow picks or word-range direction into exact spoken phrases and absolute times. */
export function groundProOverlay(pick, words, { groups = [] } = {}) {
  if (!pick || !words?.length) return null;
  const type = typeFor(pick.type);
  if (CARDS[type]) return groundCard(pick, type, words);
  if (!["correction", "compare", "steps", "stat", "wordMark", "label"].includes(type)) return null;
  const anchor = words[pick.from]?.start ?? pick.start ?? groups[pick.line]?.start ?? 0;
  const span = (v) => {
    if (typeof v === "string") return phraseSpan(v, words, anchor);
    if (!v) return null;
    const from = v.from ?? v.word;
    if (Number.isInteger(from) && Number.isInteger(v.to ?? from) && from >= 0 && (v.to ?? from) >= from && (v.to ?? from) < words.length) {
      // Glow item labels may contain several words even though they carry only their first word index.
      if (v.to == null && (v.text || v.label)) return phraseSpan(v.text || v.label, words, words[from].start);
      return { from, to: v.to ?? from };
    }
    const at = groups[v.line]?.start ?? (anchor + (v.at || 0));
    return phraseSpan(v.text || v.label || v.value, words, at);
  };
  let parts, label = null;
  if (type === "correction") parts = [span(pick.wrong || pick.left), span(pick.right)];
  if (type === "compare") parts = [span(pick.left || pick.a), span(pick.right || pick.b)];
  if (type === "steps") parts = (pick.items || []).map(span);
  if (type === "stat") {
    parts = [span(pick.valueRange || pick.value || { from: pick.from, to: pick.to })];
    label = span(pick.labelRange || pick.label || pick.sub);
    if (!label) return null;
  }
  if (type === "wordMark") parts = [span({ from: pick.word ?? pick.from, to: pick.word ?? pick.from })];
  if (type === "label") parts = [span(pick.text || { from: pick.from, to: pick.to })];
  if (!parts?.length || parts.some((p) => !p) || (type === "steps" && parts.length !== 3)) return null;
  if (["correction", "compare", "steps"].includes(type) && parts.some((p, i) => i > 0 && p.from <= parts[i - 1].to)) return null;
  const phrases = parts.map((p) => ({ ...p, text: textAt(words, p.from, p.to), at: words[p.from].start, end: words[p.to].end }));
  if (phrases.some((p) => !Number.isFinite(p.at) || !Number.isFinite(p.end) || p.end < p.at || p.text.length > (type === "label" ? 26 : 48))) return null;
  if (type === "label" && tokens(phrases[0].text).length > 3) return null;
  const fit = (p, width, size, maxLines = 1) => proTextLines(p.text, { width, size, maxLines });
  const layouts = type === "correction" ? [fit(phrases[0], 656, 52), fit(phrases[1], 656, 64)]
    : type === "compare" ? phrases.map((p) => fit(p, 274, 52, 3))
    : type === "steps" ? phrases.map((p) => fit(p, 208, 40, 2))
    : type === "stat" ? [fit(phrases[0], 656, 128), fit({ text: textAt(words, label.from, label.to) }, 656, 40)]
    : type === "label" ? [fit(phrases[0], 656, 40)] : [[phrases[0].text]];
  if (layouts.some((lines) => !lines)) return null;
  phrases.forEach((p, i) => { p.lines = layouts[i]; });
  // A stat must contain a spoken quantity; never turn an arbitrary phrase into a numerical claim.
  if (type === "stat" && !/\d|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|percent)\b/i.test(phrases[0].text)) return null;
  const start = phrases[0].at;
  let reveals = phrases.map((p) => p.at), complete;
  if (type === "correction") {
    const strikeAt = Math.max(phrases[0].end, phrases[1].at - PRO_MOTION.strike - 0.1);
    reveals = [phrases[0].at, Math.max(phrases[1].at, strikeAt + PRO_MOTION.strike + 0.1)];
    complete = Math.max(phrases[1].end, reveals[1] + PRO_MOTION.enter);
    return { type, start, phrases, reveals, strikeAt: r3(strikeAt), complete: r3(complete), end: r3(complete + PRO_MOTION.hold + PRO_MOTION.exit), duration: r3(complete + PRO_MOTION.hold + PRO_MOTION.exit - start) };
  }
  complete = Math.max(phrases.at(-1).end, reveals.at(-1) + (type === "wordMark" ? PRO_MOTION["underline"] : type === "steps" ? PRO_MOTION.state : PRO_MOTION.enter));
  const end = type === "label" ? Math.min(start + 2.5, complete + 1.2 + PRO_MOTION.exit) : complete + PRO_MOTION.hold + PRO_MOTION.exit;
  return { type, start, phrases, reveals, complete: r3(complete), end: r3(end), duration: r3(end - start), ...(label ? { label: textAt(words, label.from, label.to) } : {}), ...(type === "wordMark" ? { word: parts[0].from, mark: "underline" } : {}) };
}


/** Registry cards: spoken slots are exact word ranges in order; label slots are short planner text with no digits. */
export function groundCard(pick, type, words) {
  const def = CARDS[type];
  const slots = {}, spoken = [];
  let last = -1;
  for (const [name, slot] of Object.entries(def.slots || {})) {
    const raw = pick[name] ?? pick.slots?.[name];
    const list = slot.repeat ? (Array.isArray(raw) ? raw : []) : raw == null ? [] : [raw];
    const [min, max] = slot.repeat || [slot.optional ? 0 : 1, 1];
    if (list.length < min || list.length > max) return null;
    slots[name] = [];
    for (const v of list) {
      let item;
      if (slot.kind === "label") {
        const text = String(typeof v === "string" ? v : v?.text || "").trim();
        if (!text || /\d/.test(text) || tokens(text).length > 4 || text.length > (slot.maxChars || 26)) return null;
        item = { text, at: null, end: null };
      } else {
        const from = v?.from, to = v?.to ?? v?.from;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= words.length || from <= last) return null;
        last = to;
        item = { text: textAt(words, from, to), from, to, at: words[from].start, end: words[to].end };
        if (item.text.length > (slot.maxChars || 48)) return null;
        spoken.push(item);
      }
      item.lines = proTextLines(item.text, { width: slot.width || 656, size: slot.size || 52, maxLines: slot.maxLines || 2 });
      if (!item.lines) return null;
      slots[name].push(item);
    }
  }
  if (!spoken.length) return null;
  const start = spoken[0].at;
  const reveals = spoken.map((p) => p.at);
  const complete = Math.max(spoken.at(-1).end, reveals.at(-1) + PRO_MOTION.enter);
  const end = complete + PRO_RULES.hold + PRO_MOTION.exit;
  return { type, card: true, start, slots, phrases: spoken, reveals, complete: r3(complete), end: r3(end), duration: r3(end - start), ...(def.fullscreen ? { fullscreen: true } : {}) };
}

/** Reuse the existing beat jobs and saved element picks before asking for new direction. */
export function proCandidates(words, { graphics = [], picks = {}, groups = [] } = {}) {
  const flips = findFlips(words).map((f) => ({ type: "correction", wrong: { from: f.wrongFrom, to: f.wrongTo }, right: { from: f.rightFrom, to: f.rightTo } }));
  const t = words.map((w) => tokens(w.text).join(""));
  for (let i = 0; i < words.length - 3; i++) {
    const a = t[i] === "don't" && t[i + 1] === "say" ? i + 2 : t[i] === "do" && t[i + 1] === "not" && t[i + 2] === "say" ? i + 3 : null;
    if (a == null) continue;
    const pivot = t.findIndex((v, k) => k > a && k <= a + 6 && v === "say");
    if (pivot < 0 || !words[pivot + 1]) continue;
    let b = pivot + 1;
    while (b + 1 < words.length && b < pivot + 5 && !/[.!?,;]$/.test(words[b].text)) b++;
    flips.push({ type: "correction", wrong: { from: a, to: pivot - 1 }, right: { from: pivot + 1, to: b } });
  }
  const raw = [...flips, ...graphics, ...(picks.scenes || []), ...(picks.overlays || [])];
  for (const f of picks.features || []) if (f.variant === "swap") raw.push({ type: "correction", wrong: { from: f.wrong, to: f.wrong }, right: { from: f.right, to: f.right } });
  return raw.map((p) => groundProOverlay(p, words, { groups })).filter(Boolean);
}

/** The card rules in docs/pro-card-rules.md: rhythm, variety, one full screen, clean edges. */
export const PRO_RULES = Object.freeze({ hookEnd: 2.4, tailClear: 3, minGap: 2.5, perWindow: 5, window: 30, coverShare: 0.7, fullMax: 4.5, hold: 2.0 });
const familyOf = (o) => (o.card ? CARDS[o.type]?.family : { correction: "distinction", compare: "distinction", steps: "procedure", stat: "proof", wordMark: "emphasis", label: "emphasis" }[o.type]) || o.type;
const surfaceOf = (o) => (o.card ? CARDS[o.type]?.surface : o.surface) || "obsidian";

export function budgetProOverlays(candidates, { duration = 0, hookEnd = PRO_RULES.hookEnd } = {}) {
  const R = PRO_RULES;
  const kept = [];
  for (const c of [...candidates].sort((a, b) => a.start - b.start)) {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.end <= c.start || c.start < Math.max(R.hookEnd, hookEnd) || c.end > duration || c.start > duration - R.tailClear) continue;
    if (c.fullscreen && (kept.some((p) => p.fullscreen) || c.end - c.start > R.fullMax)) continue;
    const prev = kept.filter((p) => p.type !== "wordMark").at(-1);
    if (c.type !== "wordMark") {
      if (prev && (c.start - prev.start < R.minGap || c.start < prev.end)) continue;
      if (kept.some((p) => p.type === c.type && (duration <= 45 || c.start - p.start < 20))) continue;
      if (prev && familyOf(prev) === familyOf(c)) continue;
      if (prev && surfaceOf(prev) === "bone" && surfaceOf(c) === "bone") continue;
    } else if (kept.some((p) => p.type === "wordMark" && c.start < p.end)) continue;
    const trial = [...kept, c].filter((p) => p.type !== "wordMark");
    const windows = [0, ...trial.flatMap((p) => [p.start, p.end - R.window])];
    if (windows.some((s) => {
      const end = Math.min(duration, s + R.window), start = Math.max(0, s);
      const count = trial.filter((p) => p.start >= start && p.start < end).length;
      const occupied = trial.reduce((n, p) => n + Math.max(0, Math.min(end, p.end) - Math.max(start, p.start)), 0);
      return count > R.perWindow || occupied > R.coverShare * Math.min(R.window, duration) + 1e-6;
    })) continue;
    kept.push({ ...c, id: `pro-${kept.length}` });
  }
  return kept;
}

export function proPrompt(words, { duration = 0 } = {}) {
  return [
    "Plan teaching cards ON Greg's footage that write in as he speaks (the card rules). At most one full-screen card. No decoration, invented claims or paraphrases in spoken slots.",
    `Duration ${duration}s. About one card per 6-8 s of talk, at most 5 per 30 s, at least 2.5 s apart, never two at once, none before 2.4 s or in the last 3 s. Each type once per reel, never the same family twice in a row. Pick the card whose family fits the words: distinction, procedure, proof, conversation, warning, payoff, emphasis.`,
    "Use inclusive word ranges {from,to} for every phrase. Types: correction {wrong:{from,to},right:{from,to}} ONLY for an explicit wrong/right correction; compare {left:{from,to},right:{from,to}}; steps {items:[{from,to},{from,to},{from,to}]} exactly three; stat {valueRange:{from,to},labelRange:{from,to}}; wordMark {word} (an underline drawn under one caption word); label {from,to} at most three words.",
    ...Object.entries(CARDS).map(([t, d]) => `${t} {${Object.entries(d.slots).map(([n, s]) => `${n}:${s.kind === "label" ? `"label, max ${s.maxChars || 26} chars, no digits"` : "{from,to}"}${s.repeat ? `[${s.repeat[0]}-${s.repeat[1]}]` : ""}`).join(",")}}${d.fullscreen ? " (FULL SCREEN, at most one per reel)" : ""} [${d.family}]: ${d.hint}`),
    "Use at least three different types in a reel when the words earn it, never the same type twice in a row. Every number on a card must be a number Greg says.",
    "Correction phrases at most 22 characters each; compare phrases at most 18; steps at most 12 each; stat value at most 8 and label at most 26. Keep qualifiers with numbers. Labels last at most 2.5s. No filler graphics to reach a quota.",
    words.map((w, i) => `${i} ${w.start.toFixed(3)} ${w.text}`).join("\n"),
    "Beat jobs from the existing planner (word range: job). Use correction/compare for distinctions, steps for procedures, stat for numerical proof, wordMark for emphasis. Leave takeaways and plain talk clean when no teaching aid is needed.",
    ...classifyBeats(linesFromWords(words), { duration }).map((b) => `${b.from}-${b.to}: ${b.job}`),
    'Reply with JSON only: {"overlays":[]}',
  ].join("\n");
}

export async function makeProGraphics({ workDir, words, groups = [], duration, hook, force = false, ask = claudeText, available = hasClaude, graphics = [], picks = null }) {
  const file = path.join(workDir, "pro-graphics.json");
  const key = JSON.stringify({ words, duration, hookEnd: hook ? hook.start + hook.duration : 2.6 });
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  if (!picks) {
    try { picks = JSON.parse(fs.readFileSync(path.join(workDir, "glow-picks.json"), "utf8")); } catch { picks = {}; }
  }
  if (!graphics.length) {
    try { graphics = JSON.parse(fs.readFileSync(path.join(workDir, "graphics.json"), "utf8")).scenes || []; } catch {}
  }
  let candidates = proCandidates(words, { groups, graphics, picks });
  let direction = !force && saved?.schema === 2 && saved.key === key && Array.isArray(saved.direction) ? saved.direction : null;
  if (!direction && available()) {
    try {
      const reply = firstJSON(await ask(proPrompt(words, { duration }), { timeoutMs: 240000 }));
      direction = Array.isArray(reply.overlays) ? reply.overlays : [];
    }
    catch (e) { warn(`pro graphics: ${String(e.message).split("\n")[0]}; keeping grounded beats`); }
  }
  direction ||= [];
  candidates = [...candidates, ...direction.map((p) => groundProOverlay(p, words, { groups })).filter(Boolean)];
  const overlays = budgetProOverlays(candidates, { duration, hookEnd: hook ? hook.start + hook.duration : 2.6 });
  writeJSON(file, { schema: 2, key, direction, overlays });
  return overlays;
}

export function proSize(overlay) {
  if (overlay.card && CARDS[overlay.type]) { const z = CARDS[overlay.type].size; return typeof z === "function" ? z(overlay) : z; }
  if (overlay.type === "label") return { w: Math.min(720, Math.max(160, Math.ceil(proTextWidth(overlay.phrases?.[0]?.text || "", 40)) + 64)), h: 112 };
  return { correction: { w: 720, h: 256 }, compare: { w: 720, h: 320 }, steps: { w: 720, h: 240 }, stat: { w: 720, h: 280 }, wordMark: { w: 0, h: 0 } }[overlay.type] || null;
}

/** Marks inherit their caption's lifetime; never leave a detached annotation on the footage. */
export function attachProWordMarks(overlays, captions) {
  return overlays.flatMap((o) => {
    if (o.type !== "wordMark") return [o];
    const caption = captions.findIndex((g) => g.words.some((w) => Math.abs(w.start - o.start) < 0.001));
    if (caption < 0) return [];
    const word = captions[caption].words.findIndex((w) => Math.abs(w.start - o.start) < 0.001);
    const end = Math.min(o.end, captions[caption].end);
    if (end < o.start + PRO_MOTION[o.mark] + PRO_MOTION.exit) return [];
    return [{ ...o, end: r3(end), duration: r3(end - o.start), caption, captionWord: word }];
  });
}

/** A candidate is a maximum rectangle, not permission to cover the face or shrink type below reading size. */
export function placeProOverlay(overlay, frame) {
  const size = proSize(overlay);
  if (!frame?.measured || !size) return null;
  const k = frame.W / 1080;
  if (Math.abs(frame.H / 1920 - k) > 0.01) return null;
  if (overlay.type === "wordMark") return { slot: "caption", ...size };
  if (overlay.fullscreen) return { slot: "full", x: 0, y: 0, w: frame.W, h: frame.H, scale: k };
  const head = frame.head;
  // Existing face detection has no microphone class. Protect Greg's lower-left mic conservatively when unmeasured.
  const mic = frame.mic || { x: 0, y: 880 * k, w: 280 * k, h: 480 * k };
  const caption = { x: 0, y: 1080 * k, w: frame.W, h: 220 * k };
  for (const rect of PRO_RECTS) {
    if (overlay.type === "label" && rect.slot !== "upper") continue;
    if (size.w > rect.w || size.h > rect.h) continue;
    const box = { x: rect.x * k, y: rect.y * k, w: size.w * k, h: size.h * k };
    // Include entrance and exit travel; a safe settled rectangle alone is insufficient.
    const swept = { ...box, y: box.y - 8 * k, h: box.h + 24 * k };
    if (overlaps(swept, head, 56 * k) || overlaps(swept, mic, 24 * k) || overlaps(swept, caption) || overlaps(swept, frame.caption)) continue;
    return { slot: rect.slot, ...box, scale: k };
  }
  return null;
}

/** Measure the entire overlay window in the same transformed coordinate system as the existing frame placer. */
export async function placeProGraphics(overlays, { video, detect, W = 1080, H = 1920, framingAt = () => ({}), zoomAt = () => 1, captionTop = 1080 / 1920, captionBottom = 1300 / 1920 } = {}) {
  const placed = [];
  for (const overlay of overlays) {
    const times = Array.from({ length: Math.ceil(overlay.duration * 4) + 1 }, (_, i) => Math.min(overlay.end - 0.001, overlay.start + i * 0.25));
    const det = await detect(video, times);
    if (!det?.frames?.length) continue;
    // Read each sample with its own framing, then union the moving head across the whole hold.
    const frames = det.frames.map((f) => {
      const opts = { W, H, view: viewFor({ framing: framingAt(f.t), zoom: zoomAt(overlay.start, overlay.end) }), captionTop, captionBottom };
      const frame = readFrame({ frames: [f] }, opts);
      const mics = f.mics || [{ x: 0, y: 880 / 1920, w: 280 / 1080, h: 480 / 1920 }];
      // Body mapping uses the same source-to-canvas transform without adding the head detector's margins.
      frame.mic = readFrame({ frames: [{ bodies: mics }] }, opts).body;
      return frame;
    });
    const bounds = (field) => {
      const boxes = frames.map((f) => f[field]).filter(Boolean);
      if (!boxes.length) return null;
      const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
      return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
    };
    const place = placeProOverlay(overlay, { ...frames[0], head: bounds("head"), mic: bounds("mic") });
    if (place) placed.push({ ...overlay, place });
  }
  return placed;
}

/** One quiet UI tick from the final admitted timeline; labels remain silent. */
export function proSoundCues(overlays, { fps = 30, level = 0.08 } = {}) {
  if (!Number.isFinite(level) || level <= 0) return [];
  return overlays.filter((o) => o.type !== "label").map((o) => ({
    id: `sfx-${o.id}`, eventId: o.id, src: "assets/sfx/card.wav",
    start: eventClock({ landAt: o.type === "correction" ? o.reveals[1] + PRO_MOTION.enter : o.start + (o.type === "wordMark" ? PRO_MOTION[o.mark] : PRO_MOTION.enter), sfx: "card.wav", fps }).start,
    duration: 0.294604, volume: Math.min(0.08, level), track: 9,
  }));
}
