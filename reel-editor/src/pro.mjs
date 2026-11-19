import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { classifyBeats, linesFromWords, findFlips } from "./beat-jobs.mjs";
import { GREG_PRESETS, isClientJob } from "./client-mode.mjs";
import { readFrame, viewFor, overlaps } from "./frame-place.mjs";
import { eventClock } from "./event-clock.mjs";
import { r3, writeJSON, warn } from "./util.mjs";

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
  complete = Math.max(phrases.at(-1).end, reveals.at(-1) + (type === "wordMark" ? PRO_MOTION[pick.mark === "circle" ? "circle" : "underline"] : type === "steps" ? PRO_MOTION.state : PRO_MOTION.enter));
  const end = type === "label" ? Math.min(start + 2.5, complete + 1.2 + PRO_MOTION.exit) : complete + PRO_MOTION.hold + PRO_MOTION.exit;
  return { type, start, phrases, reveals, complete: r3(complete), end: r3(end), duration: r3(end - start), ...(label ? { label: textAt(words, label.from, label.to) } : {}), ...(type === "wordMark" ? { word: parts[0].from, mark: pick.mark === "circle" ? "circle" : "underline" } : {}) };
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

/** Rolling limits include exits and annotations: three starts and at most 15 occupied seconds in any 30s. */
export function budgetProOverlays(candidates, { duration = 0, hookEnd = 2.6 } = {}) {
  const kept = [];
  for (const c of [...candidates].sort((a, b) => a.start - b.start)) {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < Math.max(2.6, hookEnd) || c.end > duration || c.end <= c.start) continue;
    if (kept.some((p) => c.start - p.start < 4 || c.start < p.end)) continue;
    const trial = [...kept, c];
    // Occupancy maxima occur when a window edge meets an overlay edge, including a short reel's whole window.
    const windows = [0, ...trial.flatMap((p) => [p.start, p.end - 30])];
    if (windows.some((s) => {
      const end = Math.min(duration, s + 30), start = Math.max(0, s);
      const count = trial.filter((p) => p.start >= start && p.start < end).length;
      const occupied = trial.reduce((n, p) => n + Math.max(0, Math.min(end, p.end) - Math.max(start, p.start)), 0);
      return count > 3 || occupied > Math.min(15, duration / 2) + 1e-6;
    })) continue;
    kept.push({ ...c, id: `pro-${kept.length}` });
  }
  return kept;
}

export function proPrompt(words, { duration = 0 } = {}) {
  return [
    "Plan compact teaching overlays ON Greg's footage. No full-screen cards, icons, decoration, invented claims or paraphrases.",
    `Duration ${duration}s. Aim for 2-3 overlays per 30s only when earned, at least 4s apart, after 2.6s. Leave at least half the reel clean. Holds include 2.4s after completion.`,
    "Use inclusive word ranges {from,to} for every phrase. Types: correction {wrong:{from,to},right:{from,to}} ONLY for an explicit wrong/right correction; compare {left:{from,to},right:{from,to}}; steps {items:[{from,to},{from,to},{from,to}]} exactly three; stat {valueRange:{from,to},labelRange:{from,to}}; wordMark {word,mark:underline|circle}; label {from,to} at most three words.",
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
  let direction = !force && saved?.schema === 1 && saved.key === key && Array.isArray(saved.direction) ? saved.direction : null;
  if (!direction && budgetProOverlays(candidates, { duration }).length < 2 && available()) {
    try {
      const reply = firstJSON(await ask(proPrompt(words, { duration }), { timeoutMs: 240000 }));
      direction = Array.isArray(reply.overlays) ? reply.overlays : [];
    }
    catch (e) { warn(`pro graphics: ${String(e.message).split("\n")[0]}; keeping grounded beats`); }
  }
  direction ||= [];
  candidates = [...candidates, ...direction.map((p) => groundProOverlay(p, words, { groups })).filter(Boolean)];
  const overlays = budgetProOverlays(candidates, { duration, hookEnd: hook ? hook.start + hook.duration : 2.6 });
  writeJSON(file, { schema: 1, key, direction, overlays });
  return overlays;
}

export function proSize(overlay) {
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
