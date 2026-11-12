import { applyScenePlan, layoutSceneBold } from "./stitch-scenes.mjs";
import { claudeText, firstJSON } from "./claude.mjs";
import path from "node:path";
import fs from "node:fs";
import { detectFaces, zoomDuring } from "./placement.mjs";
import { phraseSplit } from "./captions.mjs";
import { planZooms } from "./zooms.mjs";
import { GREG_PRESETS, isClientJob } from "./client-mode.mjs";
import { deepMerge, warn, sha1 } from "./util.mjs";
import { boldOverlayPrompts, validateBoldOverlay, placeBoldOverlays, boldOverlayHandler } from "./bold-overlays.mjs";
import { fitBoldText, boldText } from "./bold-render.mjs";
import { loadBoldProof, stageBoldProof } from "./bold-proof.mjs";
import { BOLD_TALK_DEFAULTS, boldTalkPrompt, validateBoldSpeakers, resolveBoldTalk } from "./bold-talk.mjs";
import { BOLD_EXTRAS_DEFAULTS, prepareBoldExtras, stageBoldExtras } from "./bold-extras.mjs";

export { boldText } from "./bold-render.mjs";

// These defaults also work in an installed engine without Greg's personal preset file.
const DEFAULTS = {
  schemaVersion: 1,
  colors: { black: "#0B0B0D", gold: "#C8A24B", bone: "#F5F1E8" },
  headline: { minWords: 4, maxWords: 8, hold: 3, longHold: 4.5, longWords: 7, size: 84, weight: 900, font: "Inter", lineHeight: 1.08, padding: 20, opacity: 0.94 },
  phrases: { targetWords: 3, minWords: 2, maxWords: 4, protectedMaxWords: 7, targetSeconds: 0.75, minSeconds: 0.4, maxSeconds: 1.8, lead: 0.05, maxGap: 0.7, goldShare: 0.25, punchShare: 0.4, protectedPhrases: [] },
  quiet: { size: 84, weight: 650, emphasisWeight: 900, lineHeight: 1.08, stroke: 6, shadow: "0 3px 8px rgba(0,0,0,0.85), 0 5px 22px rgba(0,0,0,0.65)" },
  punch: { size: 104, weight: 900, lineHeight: 1.02, stroke: 12, payoffScale: 1.9, payoffFrames: 4, payoffFrom: 0.96, payoffSettle: false },
  zone: { left: 76, right: 1004, top: 200, bottom: 1600, captionTop: 1056, chinGap: 32, overlayGap: 32, headMargin: 0.15 },
  faces: { samplesPerSecond: 4 },
  framing: { enabled: true, maxPer30: 4, minSpacing: 7.5 },
  talk: BOLD_TALK_DEFAULTS,
  ...BOLD_EXTRAS_DEFAULTS,
};

export function boldSettings(preset = {}) { return structuredClone(deepMerge(DEFAULTS, preset.bold || {})); }

/** The mode guard is used before planning, restyling and composing saved plans. Bold wins a mode conflict. */
export function boldEnabled(preset, plan, env = process.env) {
  return preset?.bold?.enabled === true && GREG_PRESETS.includes(plan?.preset) && !isClientJob(env) && plan?.canvas?.height > plan?.canvas?.width;
}

const token = (text) => boldText(text).toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
const reason = (pick) => typeof pick?.reason === "string" && pick.reason.trim().length > 0 && pick.reason.length <= 500;
const span = (pick, n) => Number.isInteger(pick?.from) && Number.isInteger(pick?.to) && pick.from >= 0 && pick.to >= pick.from && pick.to < n;
const overlaps = (a, b) => a.from <= b.to && a.to >= b.from;
const inside = (pick, i) => Number.isInteger(i) && i >= pick.from && i <= pick.to;

export function boldPrompt(words, { duration = 0, settings = boldSettings(), context = {} } = {}) {
  return [
    "Plan the argument of Greg's sales coaching reel before choosing any visual. Reply with JSON only.",
    `Duration ${duration}s. Indexes below are inclusive. Choose word ranges and roles only, never times, positions or new copy.`,
    ...words.map((word, i) => `${i} ${word.text}`),
    "First identify argument.buyerProblem, argument.answer and argument.payoff: each {from,to,reason}, or null if absent. These three ranges must not overlap. Reasons explain the buyer's problem, useful answer and earned payoff.",
    `headline: {from,to,emphasis,reason}. Choose ${settings.headline.minWords} to ${settings.headline.maxWords} consecutive transcript words promising the actual lesson. emphasis is exactly one word index inside the range. Keep all qualifiers, negation and numbers. No rewritten headline, invented claims, dashes, catchphrases or artificial punctuation.`,
    'punch: [{from,to,role,reason,emphasis,payoff?}]. role is "money", "objection", "rant" or "payoff". Ranges must not overlap. payoff is one spoken number word index, only for role payoff. All other speech stays quiet.',
    `Use punch sparingly, at most ${settings.phrases.punchShare * 100}% of caption phrases. Default to quiet when unsure.`,
    `emphasis: [{word,gold,reason}] for quiet phrases. At most one emphasis per phrase; gold in at most ${settings.phrases.goldShare * 100}% of quiet phrases. Other emphasis uses bone bold weight.`,
    'turns: [{from,to,reason}] optional argument turns earning a camera change. No overlaps within turns. No timer-driven framing changes.',
    boldTalkPrompt(),
    "overlays: [] is valid. There is no graphic quota and no compulsory full-screen scene. Only registered kinds below may be proposed; each needs kind, from, to, reason and the fields its contract requires. Every word or number must be supplied by Greg's transcript or authentic supplied proof. Reasons must tie the visual to the argument.",
    boldOverlayPrompts({ ...context, words, settings }) || "No overlay kinds are available. Return overlays: [].",
    'Schema: {"schemaVersion":1,"argument":{"buyerProblem":null,"answer":null,"payoff":null},"headline":{"from":0,"to":3,"emphasis":3,"reason":"..."},"punch":[],"emphasis":[],"turns":[],"speakers":[],"overlays":[]}',
  ].join("\n");
}

/** Strict direction validation. Text and numeric values are never accepted from the reply. */
export function validateBoldPicks(reply, words, { settings = boldSettings(), context = {} } = {}) {
  if (!reply || reply.schemaVersion !== 1 || !reply.argument || !["punch", "emphasis", "turns", "overlays"].every((key) => Array.isArray(reply[key]))) throw new Error("invalid bold direction schema");
  if (reply.transcriptHash && reply.transcriptHash !== sha1(JSON.stringify(words.map((word) => word.text)))) throw new Error("saved bold direction belongs to another transcript; use --repick");
  const h = reply.headline, n = words.length;
  if (n && (!span(h, n) || !reason(h) || !inside(h, h.emphasis) || h.to - h.from + 1 < settings.headline.minWords || h.to - h.from + 1 > settings.headline.maxWords)) throw new Error("invalid bold headline");
  if (!n && h !== null) throw new Error("headline without words");
  if (h && Object.keys(h).some((key) => !["from", "to", "emphasis", "reason"].includes(key))) throw new Error("headline must select transcript words only");
  const argument = {};
  for (const key of ["buyerProblem", "answer", "payoff"]) {
    const pick = reply.argument[key];
    if (pick !== null && (!span(pick, n) || !reason(pick))) throw new Error(`invalid bold argument: ${key}`);
    argument[key] = pick && { from: pick.from, to: pick.to, reason: pick.reason.trim() };
  }
  const args = Object.values(argument).filter(Boolean);
  if (args.some((p, i) => args.slice(i + 1).some((q) => overlaps(p, q)))) throw new Error("overlapping bold argument");
  // One bad pick is dropped (with a note), never the whole direction: a punch without its emphasis word cost Pushy
  // every punch line and gold word on 2026-11-11. Overlaps keep the earlier pick.
  const dropped = [];
  const rangeList = (list, check = () => true) => {
    const kept = [];
    for (const p of [...list].filter((p) => p && typeof p === "object").sort((a, b) => a.from - b.from)) {
      if (!span(p, n) || !reason(p) || !check(p) || kept.some((q) => overlaps(p, q))) { dropped.push(p); continue; }
      kept.push({ ...p });
    }
    return kept;
  };
  for (const p of reply.punch) if (p && !Number.isInteger(p.emphasis) && span(p, n)) p.emphasis = p.role === "payoff" && Number.isInteger(p.payoff) ? p.payoff : p.to;
  const punch = rangeList(reply.punch, (p) => ["money", "objection", "rant", "payoff"].includes(p.role) && inside(p, p.emphasis) && (p.payoff == null || (p.role === "payoff" && inside(p, p.payoff) && /\d|^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)$/i.test(token(words[p.payoff].text)))));
  const emphasis = [];
  for (const p of reply.emphasis) {
    if (!p || !Number.isInteger(p.word) || p.word < 0 || p.word >= n || typeof p.gold !== "boolean" || !reason(p) || emphasis.some((q) => q.word === p.word)) { dropped.push(p); continue; }
    emphasis.push({ word: p.word, gold: p.gold, reason: p.reason.trim() });
  }
  const turns = rangeList(reply.turns);
  const speakers = validateBoldSpeakers(reply.speakers, words);
  // Topic label indexes may also occur in another visual; its display time is the conversation stretch.
  // Different kinds may share words (a price tag beside the math panel); the shared placer keeps their boxes apart.
  const kinds = [...new Set(reply.overlays.map((p) => p?.kind))];
  const overlayRanges = kinds.flatMap((kind) => kind === "topic" ? reply.overlays.filter((p) => p?.kind === "topic" && span(p, n) && reason(p)) : rangeList(reply.overlays.filter((p) => p?.kind === kind))).sort((a, b) => a.from - b.from);
  const overlays = overlayRanges.map((pick) => validateBoldOverlay(pick, { ...context, words, settings, argument, punch })).filter(Boolean);
  return { schemaVersion: 1, argument, headline: h && { from: h.from, to: h.to, emphasis: h.emphasis, reason: h.reason.trim() }, punch, emphasis, turns, ...(reply.speakers != null ? { speakers } : {}), overlays, ...(dropped.length ? { dropped: dropped.length } : {}) };
}

/** First sentence, bounded to eight words. A short transcript stays honest instead of gaining filler. */
export function fallbackBoldDirection(words, { settings = boldSettings() } = {}) {
  let to = Math.min(words.length, settings.headline.maxWords) - 1;
  const sentenceEnd = words.findIndex((word) => /[.!?]["'”’)]*$/.test(String(word.text).trim()));
  if (sentenceEnd >= 0) to = Math.min(to, sentenceEnd);
  return { schemaVersion: 1, argument: { buyerProblem: null, answer: null, payoff: null }, headline: to < 0 ? null : { from: 0, to, emphasis: to, reason: "Opening sentence from the transcript" }, punch: [], emphasis: [], turns: [], overlays: [], fallback: true };
}

/** Every input index is retained once, including repeated words and punctuation-only tokens. */
export function groupBoldWords(words, duration, picks = fallbackBoldDirection(words), { settings = boldSettings(), fps = 30, protectedPhrases = [] } = {}) {
  if (!words.length) return [];
  if (!(fps > 0) || !Number.isFinite(fps) || !(duration > 0) || words.some((w, i) => !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end < w.start || (i && w.start < words[i - 1].start))) throw new Error("invalid bold word timing");
  const cfg = settings.phrases;
  const indexed = words.map((w, index) => ({ ...w, index, text: boldText(w.text) }));
  const protectedSet = new Set([...cfg.protectedPhrases, ...protectedPhrases]);
  const punchAt = (index) => picks.punch.find((p) => index >= p.from && index <= p.to);
  const speakerAt = (index) => (picks.speakers || []).some((p) => index >= p.from && index <= p.to) ? "other" : "greg";
  const blocked = new Set();
  const toks = words.map((word) => token(word.text));
  for (const phrase of protectedSet) {
    const parts = String(phrase).split(/\s+/).map(token);
    for (let i = 0; i + parts.length <= words.length; i++) if (parts.length <= cfg.protectedMaxWords && parts.every((part, j) => part === toks[i + j])) for (let j = 1; j < parts.length; j++) blocked.add(i + j);
  }
  // Amounts and their units stay together even without a dictionary entry.
  for (let i = 1; i < words.length; i++) if (/\d|^(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)$/.test(toks[i - 1]) && /^(hundred|thousand|million|billion|percent|dollars|bucks|calls|clients|minutes|hours|days|weeks|months|years)$/.test(toks[i])) blocked.add(i);
  for (let i = 1; i < words.length; i++) if (speakerAt(i - 1) !== speakerAt(i)) blocked.delete(i);
  const runs = []; let run = [];
  for (const word of indexed) {
    const prev = run.at(-1);
    if (prev && (speakerAt(prev.index) !== speakerAt(word.index) || (!blocked.has(word.index) && (punchAt(prev.index) !== punchAt(word.index) || word.start - prev.end > cfg.maxGap || word.start - run[0].start >= cfg.maxSeconds)))) { runs.push(run); run = []; }
    run.push(word);
    if (/[.!?]["'”’)]*$/.test(String(words[word.index].text).trim()) && !blocked.has(word.index + 1)) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  const chunks = runs.flatMap((r) => {
    const elapsed = Math.max(cfg.targetSeconds, r.at(-1).end - r[0].start);
    const per = Math.max(cfg.minWords, Math.min(cfg.maxWords, Math.round(r.length * cfg.targetSeconds / elapsed), cfg.targetWords));
    return phraseSplit(r, per, { maxChars: 30, protectedPhrases: protectedSet });
  });
  const merged = [];
  for (let i = 0; i < chunks.length; i++) {
    const cur = [...chunks[i]];
    while (chunks[i + 1] && speakerAt(cur[0].index) === speakerAt(chunks[i + 1][0].index) && (blocked.has(chunks[i + 1][0].index) || (punchAt(cur[0].index) === punchAt(chunks[i + 1][0].index) && chunks[i + 1][0].start - cur[0].start < cfg.minSeconds && chunks[i + 1][0].start - cur.at(-1).end <= cfg.maxGap && cur.length + chunks[i + 1].length <= cfg.protectedMaxWords))) cur.push(...chunks[++i]);
    merged.push(cur);
  }
  const groups = merged.map((ws, i) => {
    const from = ws[0].index, to = ws.at(-1).index;
    const punch = speakerAt(from) === "other" ? null : picks.punch.find((p) => from >= p.from && to <= p.to);
    const emphasis = picks.emphasis.find((p) => p.word >= from && p.word <= to);
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const startFrame = i ? Math.min(totalFrames - 1, Math.round(Math.max(0, ws[0].start - cfg.lead) * fps)) : 0;
    const nextFrame = merged[i + 1] ? Math.min(totalFrames, Math.round(Math.max(0, merged[i + 1][0].start - cfg.lead) * fps)) : totalFrames;
    const endFrame = Math.max(startFrame + 1, Math.min(nextFrame, Math.max(Math.ceil(ws.at(-1).end * fps), startFrame + Math.round(cfg.maxSeconds * fps))));
    return { from, to, startFrame, endFrame, start: startFrame / fps, end: endFrame / fps, mode: punch ? "punch" : "quiet", role: punch?.role || null, reason: punch?.reason || "Running transcript", emphasis: punch ? { word: inside({ from, to }, punch.emphasis) ? punch.emphasis : to, gold: true } : emphasis ? { word: emphasis.word, gold: emphasis.gold } : null, payoff: punch && inside({ from, to }, punch.payoff) ? punch.payoff : null, protectedBreaks: [...blocked].filter((at) => at > from && at <= to).map((at) => at - from), text: ws.map((w) => w.text).join(" ") };
  });
  for (const g of groups) {
    if (speakerAt(g.from) === "other") { g.speaker = "other"; g.emphasis = null; g.payoff = null; }
    else if (picks.conversation && g.emphasis) g.emphasis.gold = false;
  }
  // Coincident timestamps cannot steal a word. Merge their captions rather than create invisible zero-frame groups.
  for (let i = groups.length - 2; i >= 0; i--) if (speakerAt(groups[i].from) === speakerAt(groups[i + 1].from) && groups[i + 1].startFrame <= groups[i].startFrame) {
    if (groups[i].mode !== groups[i + 1].mode) { groups[i].mode = "quiet"; groups[i].role = null; groups[i].emphasis = null; groups[i].payoff = null; }
    groups[i].to = groups[i + 1].to; groups[i].endFrame = groups[i + 1].endFrame; groups[i].end = groups[i + 1].end;
    groups[i].protectedBreaks = [...blocked].filter((at) => at > groups[i].from && at <= groups[i].to).map((at) => at - groups[i].from);
    groups[i].text = indexed.slice(groups[i].from, groups[i].to + 1).map((w) => w.text).join(" "); groups.splice(i + 1, 1);
  }
  // A clipped tail cannot borrow display time beyond the reel. Join it backwards instead of flashing it.
  for (let i = groups.length - 1; i > 0; i--) if (groups[i].endFrame - groups[i].startFrame < Math.ceil(cfg.minSeconds * fps)) {
    const prev = groups[i - 1], tail = groups[i];
    if (speakerAt(prev.from) !== speakerAt(tail.from) || tail.start - prev.end > cfg.maxGap) continue;
    prev.to = tail.to; prev.endFrame = tail.endFrame; prev.end = tail.end;
    prev.protectedBreaks = [...blocked].filter((at) => at > prev.from && at <= prev.to).map((at) => at - prev.from);
    prev.text = indexed.slice(prev.from, prev.to + 1).map((w) => w.text).join(" ");
    if (prev.mode !== tail.mode) { prev.mode = "quiet"; prev.role = null; prev.emphasis = null; prev.payoff = null; }
    groups.splice(i, 1);
  }
  if (picks.speakers?.length) {
    const totalFrames = Math.max(1, Math.round(duration * fps));
    if (groups.length > totalFrames) throw new Error("too many speaker turns for the bold frame clock");
    // Coincident turn timestamps get distinct frames instead of merging two voices into one phrase.
    const starts = groups.map((g) => g.startFrame);
    for (let i = 0; i < starts.length; i++) starts[i] = Math.min(totalFrames - (starts.length - i), Math.max(starts[i], i ? starts[i - 1] + 1 : 0));
    groups.forEach((g, i) => { g.startFrame = starts[i]; g.endFrame = Math.max(starts[i] + 1, Math.min(starts[i + 1] ?? totalFrames, g.endFrame)); g.start = g.startFrame / fps; g.end = g.endFrame / fps; });
  }
  let punchCount = 0;
  const punchBudget = Math.floor(groups.length * cfg.punchShare);
  for (const g of groups) if (g.mode === "punch" && ++punchCount > punchBudget) { g.mode = "quiet"; g.emphasis = null; g.payoff = null; g.role = null; }
  let goldCount = 0;
  const goldBudget = Math.floor(groups.filter((g) => g.mode === "quiet").length * cfg.goldShare);
  for (const g of groups) if (g.mode === "quiet" && g.emphasis?.gold && ++goldCount > goldBudget) g.emphasis.gold = false;
  return groups;
}

/** Project measurements from the baseline render through only the new, accepted framing lane. */
export function boldFaceBoxes(detection, { W = 1080, H = 1920, zooms = [], origin = "50% 38%", shift = 0, margin = 0.15 } = {}) {
  const [ox, oy] = origin.split(" ").map((value) => parseFloat(value) / 100);
  return (detection?.frames || []).flatMap((frame) => (frame.faces || []).filter((f) => [f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w > 0 && f.h > 0).map((face) => {
    const scale = zoomDuring(zooms, frame.t - 0.25, frame.t + 0.25);
    // Snap zooms use the shared compositor's -0.6% y lift.
    const lift = scale > 1 ? -0.006 * H : 0;
    return { x: (ox + (face.x - ox) * scale) * W, y: (oy + (face.y - face.h * margin - oy) * scale + shift) * H + lift, w: face.w * scale * W, h: face.h * (1 + margin) * scale * H, start: Math.max(0, frame.t - 0.25), end: frame.t + 0.25 };
  }));
}

/** Fixed caption reserve for this reel; the headline gets its own non-intersecting rectangle. */
export function layoutBold(plan, picks, detection, { settings = boldSettings(plan.style), faceShift = 0, protectedPhrases = [] } = {}) {
  const { width: W, height: H } = plan.canvas, sx = W / 1080, sy = H / 1920;
  const cfg = settings.zone;
  const safe = { x: cfg.left * sx, y: cfg.top * sy, w: (cfg.right - cfg.left) * sx, h: (cfg.bottom - cfg.top) * sy };
  const gap = cfg.chinGap * sy;
  const faces = boldFaceBoxes(detection, { W, H, zooms: plan.zooms, origin: plan.framing?.scale > 1 ? plan.framing.origin : plan.style.zooms?.origin, shift: faceShift, margin: cfg.headMargin });
  const fallbackChin = (plan.head?.bottom ?? (cfg.captionTop - cfg.chinGap) / 1920) * H;
  const chin = faces.length ? Math.max(...faces.map((face) => face.y + face.h)) : fallbackChin;
  const groups = groupBoldWords(plan.words, plan.video.duration, picks, { settings, fps: plan.style.render?.fps || 30, protectedPhrases });
  const hcfg = settings.headline;
  const headWords = picks.headline ? plan.words.slice(picks.headline.from, picks.headline.to + 1).map((w, i) => i ? boldText(w.text) : boldText(w.text).replace(/^\p{L}/u, (letter) => letter.toUpperCase())) : [];
  const hold = Math.min(plan.video.duration, headWords.length >= hcfg.longWords ? hcfg.longHold : hcfg.hold);
  const fps = plan.style.render?.fps || 30;
  const titleFit = fitBoldText(headWords, { size: hcfg.size * sx, width: safe.w - hcfg.padding * 2 * sx, lineHeight: hcfg.lineHeight });
  const titleHeight = headWords.length ? titleFit.h + hcfg.padding * 2 * sy : 0;
  const openingFaces = faces.filter((face) => face.start < hold);
  const headTop = openingFaces.length ? Math.min(...openingFaces.map((face) => face.y)) : safe.y;
  const above = safe.y + titleHeight + gap <= headTop;
  let y = Math.max(safe.y, cfg.captionTop * sy, chin + gap);
  let titleY = above ? safe.y : Math.max(safe.y, chin + gap);
  if (titleHeight && !above) y = Math.max(y, titleY + titleHeight + gap);
  // The footage is never lifted, so a low chin can leave too little room: keep at least two quiet lines inside the
  // safe area (over the lowest part of the chin) and send the headline to the top when the two would meet.
  const minRoom = settings.quiet.size * settings.quiet.lineHeight * 2 * sy;
  if (safe.y + safe.h - y < minRoom) {
    y = safe.y + safe.h - minRoom;
    if (titleHeight && !above && titleY + titleHeight + gap > y) titleY = safe.y;
  }
  const room = safe.y + safe.h - y;
  let height = 0;
  for (const g of groups) {
    const mode = settings[g.mode];
    const text = plan.words.slice(g.from, g.to + 1).map((w) => g.mode === "punch" ? boldText(w.text).toUpperCase() : boldText(w.text));
    const fit = fitBoldText(text, { size: mode.size * sx, width: safe.w - (g.mode === "punch" ? settings.punch.stroke * 2 * sx : 0), lineHeight: mode.lineHeight, payoff: g.payoff == null ? null : g.payoff - g.from, payoffScale: settings.punch.payoffScale, blockedBreaks: g.protectedBreaks, maxHeight: room });
    g.place = { x: safe.x, y, w: safe.w, ...fit }; height = Math.max(height, fit.h);
  }
  const headline = picks.headline && { ...picks.headline, text: headWords.join(" "), startFrame: 0, endFrame: Math.round(hold * fps), start: 0, end: Math.round(hold * fps) / fps, place: { x: safe.x, y: titleY, w: safe.w, ...titleFit, h: titleHeight } };
  const zones = { safe, caption: { x: safe.x, y, w: safe.w, h: height }, headline: headline && { x: safe.x, y: titleY, w: safe.w, h: titleHeight, end: headline.end }, faces, chin, measured: faces.length > 0 };
  return { schemaVersion: 1, headline, groups, argument: structuredClone(picks.argument), zones, overlays: [], events: [] };
}

/** Reset the old visual lanes before measuring a restyle baseline. Footage, cuts and music stay in the plan. */
export function prepareBoldPlan(input, preset = input.style) {
  const plan = structuredClone(input);
  plan.style = structuredClone(preset);
  plan.style.glow = { ...plan.style.glow, enabled: false };
  plan.style.hook = { ...plan.style.hook, push: false, behind: false };
  plan.preset = plan.style.name;
  for (const key of ["bold", "glowScenes", "glowOverlays", "glowPicks"]) delete plan[key];
  for (const key of ["captions", "graphics", "icons", "slams", "timeLabels", "evidence", "zooms"]) plan[key] = [];
  plan.broll = preset.broll?.enabled === true ? plan.broll || [] : [];
  for (const key of ["hook", "behind", "coldOpen", "premise", "motion", "cta", "lowerThird"]) plan[key] = null;
  plan.audio = { ...plan.audio, tracks: (plan.audio?.tracks || []).filter((t) => !String(t.id || "").startsWith("sfx-") || (plan.broll.length && String(t.id).startsWith("sfx-broll-"))) };
  return plan;
}

/** One argument call, then timing, framing, placement and sounds. All work commits to a cloned plan. */
export async function restyleBold(input, { render, ask = claudeText, picks: saved = null, detect = detectFaces, env = process.env, log = warn, outDir = null, protectedPhrases = [], proof = {}, talk: talkOptions = {}, extras: extraOptions = {} } = {}) {
  if (!boldEnabled(input.style, input, env)) {
    if (isClientJob(env) && (input.bold || input.style?.bold?.enabled)) log("bold look disabled for a client job");
    return { plan: input, picks: null, reply: null };
  }
  const plan = prepareBoldPlan(input);
  const settings = boldSettings(plan.style), fps = plan.style.render?.fps || 30, duration = plan.video.duration;
  const context = { plan, outDir, projectDir: outDir ? path.join(outDir, "project") : null, settings, env, log };
  context.proofCatalog = loadBoldProof(context);
  try { context.extraAssets = await prepareBoldExtras(context, extraOptions); } catch { context.extraAssets = []; }
  let reply = saved, picks;
  try {
    if (!plan.words.length) reply = fallbackBoldDirection(plan.words, { settings });
    if (!reply) {
      const raw = await ask(boldPrompt(plan.words, { duration, settings, context }), { timeoutMs: 900000 });
      reply = typeof raw === "string" ? firstJSON(raw) : raw;
      if (outDir) try { fs.writeFileSync(path.join(outDir, "bold-reply.json"), typeof raw === "string" ? raw : JSON.stringify(raw, null, 2)); } catch { /* a debugging copy only */ }
    }
    // Fallback picks are also cached; recompute them from this transcript rather than trusting their ranges.
    picks = reply?.fallback ? fallbackBoldDirection(plan.words, { settings }) : validateBoldPicks(reply, plan.words, { settings, context });
  } catch (error) {
    log(`bold direction fallback: ${String(error.message).split("\n")[0]}`);
    picks = fallbackBoldDirection(plan.words, { settings });
  }
  picks.transcriptHash = sha1(JSON.stringify(plan.words.map((word) => word.text)));
  const times = Array.from({ length: Math.max(1, Math.ceil(duration * settings.faces.samplesPerSecond)) }, (_, i) => Math.min(Math.max(0, duration - 1 / fps), Math.round(i / settings.faces.samplesPerSecond * fps) / fps));
  let detection = null;
  try { detection = render ? await detect(render, times) : null; } catch { /* measured fallback below */ }
  const talk = await resolveBoldTalk(plan, picks, detection, { settings, render, ...talkOptions });
  const groupPicks = { ...picks, speakers: talk.speakers, conversation: !!talk.conversation };
  const captionGroups = groupBoldWords(plan.words, duration, groupPicks, { settings, fps, protectedPhrases });
  const payoffs = picks.punch.filter((p) => p.role === "payoff" && captionGroups.some((g) => g.mode === "punch" && g.from >= p.from && g.to <= p.to)).map((p) => ({ ...p, from: p.payoff ?? p.from }));
  const candidates = [...picks.turns, ...payoffs].sort((a, b) => a.from - b.from);
  if (plan.style.zooms?.enabled && settings.framing.enabled) {
    const cameraGroups = candidates.map((p) => ({ start: plan.words[p.from].start, end: plan.words[p.to].end, words: [{ ...plan.words[p.from], key: true }] }));
    // Reuse the engine's spacing and tight-frame limits. Returns also wait for an argument beat.
    plan.zooms = planZooms(cameraGroups, duration, { ...plan.style.zooms, busy: plan.broll, onKey: false, hook: null, maxPer30: settings.framing.maxPer30, minSpacing: settings.framing.minSpacing, snap: 0, tight: (detection?.frames || []).some((frame) => (frame.faces || []).some((face) => face.h > 0.4)) }).filter((key) => key.scale > 1).map((key, i) => ({ ...key, scale: i % 2 ? 1 : key.scale, t: Math.round(key.t * fps) / fps, snap: 0, cut: true }));
  }
  // The footage never moves: lifting it left a black strip under a full-height source (Pushy, 2026-11-11). Captions
  // start under the chin and shrink to the room that is left.
  const shift = 0;
  plan.bold = layoutBold(plan, groupPicks, detection, { settings, faceShift: shift, protectedPhrases });
  if (plan.stitchScenes) plan.bold = layoutSceneBold(plan, groupPicks, detection, { settings, faceShift: shift, protectedPhrases }, layoutBold, fitBoldText, boldText);
  plan.bold.talk = talk;
  if (plan.bold.zones.measured) context.proofAssets = await stageBoldProof(picks.overlays, { ...context, words: plan.words }, proof);
  context.stagedExtras = await stageBoldExtras(picks.overlays, context, extraOptions);
  plan.bold.overlays = placeBoldOverlays(picks.overlays, { ...context, words: plan.words, argument: picks.argument, talk, zones: plan.bold.zones, sceneZones: plan.bold.sceneZones, fps, duration, settings });
  plan.bold.events = [
    ...plan.bold.overlays.map((event) => ({ kind: event.kind, from: event.from, to: event.to, landingFrame: event.landingFrame, landing: event.landing, reason: event.reason })),
    ...plan.zooms.map((key) => ({ kind: "framing", landingFrame: Math.round(key.t * fps), landing: key.t, reason: candidates.find((p) => Math.abs(plan.words[p.from].start - key.t) < 1 / fps)?.reason || "Argument beat" })),
  ].sort((a, b) => a.landingFrame - b.landingFrame);
  for (const event of plan.bold.overlays) {
    if (plan.style.audio?.sounds === false) continue;
    try { plan.audio.tracks.push(...(boldOverlayHandler(event.kind)?.sounds?.(event, { plan, settings, fps }) || [])); }
    catch { /* an optional sound cannot remove a caption or discard the accepted visual */ }
  }
  plan.captions = plan.bold.groups.map((g) => ({ ...g, words: plan.words.slice(g.from, g.to + 1).map((word, i) => ({ ...word, text: boldText(word.text), index: g.from + i, key: g.emphasis?.word === g.from + i })) }));
  plan.lines = plan.captions;
  if (plan.bold.headline) {
    const h = plan.bold.headline;
    plan.hook = { text: h.text, start: 0, duration: h.end, words: plan.words.slice(h.from, h.to + 1).map((w, i) => ({ text: boldText(w.text), key: h.from + i === h.emphasis })) };
    plan.style.hook.position = h.place.y / plan.canvas.height;
    plan.style.hook.fontSizeFrac = h.place.size / plan.canvas.height;
  }
  plan.style.captions.position = plan.bold.zones.caption.y / plan.canvas.height + 0.6 * plan.style.captions.fontSizeFrac;
  if (plan.stitchScenes) applyScenePlan(plan);
  return { plan, picks, reply };
}
