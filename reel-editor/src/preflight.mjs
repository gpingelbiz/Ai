import fs from "node:fs";
import path from "node:path";
import { run, r3 } from "./util.mjs";
import { probe } from "./probe.mjs";
import { hookBlockHeight } from "./placement.mjs";
import { isPersistentScene, numberMotion, sceneDuration } from "./graphics.mjs";
import { creditValueGrounded, creditVerifiedGrounded } from "./credentials.mjs";

export {
  boxIntersection,
  contrastFromLuminances,
  contrastRatio,
  differenceHash,
  editDistance,
  expectedSlideText,
  faceOverlapRatio,
  hammingDistance,
  lintSlideCopy,
  matchExpectedText,
  preflightSlides,
  relativeLuminance,
  textTokens,
  verdictForProblems,
} from "./slide-preflight.mjs";

/**
 * Preflight: checks on the finished file before it reaches the Desktop. Sound (integrated loudness, true peak,
 * loudness range), the open (a black or static first second, silence at the start), dead air anywhere, the render
 * length against the plan, and the layout from the plan (captions over the chin, the hook over the face, text in the
 * strip Instagram covers with its own caption and buttons). Thresholds follow the reel-qc project (MIT) and the
 * Instagram Reels safe-zone overlays.
 *
 * Nothing here blocks delivery unless preflight.strict is set; the report is written as preflight.txt either way.
 */

// Instagram Reels at 9:16: the caption and handle strip at the bottom, the icon column on the right, the top bar.
export const SAFE = { top: 0.07, bottom: 0.167, right: 0.11, rightFrom: 0.42, rightTo: 0.86 };

export const CARD_RULES = {
  readingWpm: 160,
  orientationSeconds: 0.7,
  maxHold: 5,
  maxOccupancy: 0.25,
  saveWorthyOccupancy: 0.3,
  eventWindow: 10,
  maxMajorStarts: 2,
  minMajorGap: 3,
  left: 76,
  right: 940,
  top: 200,
};

export async function measureLoudness(file) {
  const { err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true, allowFail: true });
  // The per-frame lines carry I:/LRA: too; only the Summary block at the end counts.
  const summary = err.slice(Math.max(0, err.lastIndexOf("Summary:")));
  const num = (re) => { const m = summary.match(re); return m ? r3(+m[1]) : null; };
  const peaks = [...summary.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].map((m) => +m[1]);
  return { i: num(/\bI:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), tp: peaks.length ? r3(peaks[peaks.length - 1]) : null };
}

/** Black at the start: seconds of (almost) black video from frame 0, or 0. */
export async function blackOpen(file, { seconds = 1.5 } = {}) {
  const { err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-t", String(seconds), "-i", file, "-an", "-vf", "blackdetect=d=0.08:pix_th=0.10", "-f", "null", "-"], { capture: true, allowFail: true });
  const m = err.match(/black_start:0(?:\.0+)?\s+black_end:([\d.]+)/);
  return m ? r3(+m[1]) : 0;
}

/** Mean frame-to-frame change over the first `seconds` (0-255 on a small grey copy): under ~0.4 reads as a still. */
export async function openMotion(file, { seconds = 2 } = {}) {
  const { out, err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-t", String(seconds), "-i", file, "-an", "-vf", "scale=120:-2,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], { capture: true, allowFail: true });
  const vals = [...`${out}\n${err}`.matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]).slice(1);
  return vals.length ? r3(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

/** Silences of at least `min` seconds: [{start, end}]. */
export async function silences(file, { noise = -45, min = 1.5 } = {}) {
  const { err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=n=${noise}dB:d=${min}`, "-f", "null", "-"], { capture: true, allowFail: true });
  const out = [];
  let start = null;
  for (const line of err.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (s) start = Math.max(0, +s[1]);
    if (e && start != null) { out.push({ start: r3(start), end: r3(+e[1]) }); start = null; }
  }
  return out;
}

/** Layout checks from the plan alone (no decoding). */
export function layoutChecks(plan) {
  const items = [];
  if (!plan) return items;
  const st = plan.style || {};
  const W = plan.canvas?.width || 1080, H = plan.canvas?.height || 1920;
  const portrait = H > W;
  const head = plan.head; // {top, bottom} fractions, when a face was found
  const cap = st.captions || {};
  if (plan.captions?.length && cap.enabled !== false) {
    const lines = Math.max(1, Math.ceil((cap.wordsPerLine || 3) / 3));
    const top = cap.position - 0.02;
    const bottom = cap.position + lines * (cap.fontSizeFrac || 0.04) * 1.35;
    if (head && top < head.bottom - 0.015) items.push({ level: "warn", code: "captions-face", message: `captions start at ${pct(top)}, over the chin (head ends at ${pct(head.bottom)})` });
    if (portrait && bottom > 1 - SAFE.bottom) items.push({ level: "warn", code: "captions-safe-zone", message: `captions reach ${pct(bottom)}, inside the strip Instagram covers with its caption (keep above ${pct(1 - SAFE.bottom)})` });
  }
  const hk = st.hook || {};
  if (plan.hook && head && !plan.behind) {
    const fontPx = Math.round((hk.fontSizeFrac || 0.052) * H * (hk.style === "headline" ? 1.08 : 1));
    const words = plan.hook.words || String(plan.hook.text || "").split(/\s+/).map((t) => ({ text: t }));
    const h = hookBlockHeight(words, { W, H, fontPx });
    const top = hk.position, bottom = hk.position + h;
    const overlap = Math.min(bottom, head.bottom) - Math.max(top, head.top);
    if (overlap > 0.02) items.push({ level: "warn", code: "hook-face", message: `the hook (${pct(top)}-${pct(bottom)}) sits over the face (${pct(head.top)}-${pct(head.bottom)})` });
    if (portrait && top < SAFE.top) items.push({ level: "warn", code: "hook-safe-zone", message: `the hook starts at ${pct(top)}, under the top bar` });
  }
  if (plan.cta && portrait) {
    const p = plan.cta.position ?? st.cta?.position ?? 0.62;
    if (p + 0.06 > 1 - SAFE.bottom) items.push({ level: "warn", code: "cta-safe-zone", message: `the CTA at ${pct(p)} is inside the Instagram caption strip` });
  }
  items.push(...premiseChecks(plan));
  items.push(...credentialChecks(plan));
  items.push(...evidenceChecks(plan));
  items.push(...graphicChecks(plan));
  return items;
}

const pct = (f) => `${Math.round(f * 100)}%`;

const words = (text) => String(text || "").replace(/\*/g, "").trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

/** The persistent strip is not a card hold, but it still has to clear the face, captions and platform-safe bounds. */
export function premiseChecks(plan) {
  const premise = plan?.premise;
  if (!premise?.box) return [];
  const items = [];
  const W = plan.canvas?.width || 1080, H = plan.canvas?.height || 1920;
  const box = premise.box;
  const right = box.x + box.w, bottom = box.y + box.h;
  const fontSize = Math.min(+premise.fontSize || 0, premise.sections?.length ? +premise.sectionFontSize || 0 : Infinity);
  const cap = plan.style?.captions || {};
  const captionTop = plan.captions?.length && cap.enabled !== false ? (cap.position ?? 0.6) * H - 0.6 * (cap.fontSizeFrac || 0.04) * H : H;
  const bad = [];
  if (box.x < 76) bad.push(`left ${Math.round(box.x)}px`);
  if (right > Math.min(940, W - 76)) bad.push(`right ${Math.round(right)}px`);
  if (box.y < 200) bad.push(`top ${Math.round(box.y)}px`);
  if (bottom > captionTop) bad.push(`bottom ${Math.round(bottom)}px past captions at ${Math.round(captionTop)}px`);
  if (bad.length) items.push({ level: "warn", code: "premise-bounds", message: `premise strip is outside x 76-${Math.min(940, W - 76)}px / y 200px-caption top (${bad.join(", ")})` });
  if (fontSize < 44) items.push({ level: "warn", code: "premise-size", message: `premise strip text is ${fontSize}px (minimum 44px)` });
  if (Number.isFinite(premise.headTop) && bottom > premise.headTop * H) items.push({ level: "warn", code: "premise-head", message: `premise strip ends at ${Math.round(bottom)}px, over the head at ${Math.round(premise.headTop * H)}px` });
  if (right > W - 140 && bottom > SAFE.rightFrom * H) items.push({ level: "warn", code: "premise-right-rail", message: "premise strip reaches Instagram's right action rail" });
  return items;
}

const rectOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Real evidence must keep its source and privacy audit, stay legible, and own its display window. */
export function evidenceChecks(plan) {
  const evidence = plan?.evidence || [];
  if (!evidence.length) return [];
  const items = [];
  for (const item of evidence) {
    const at = fmt(item.start || 0);
    if (!item.sourceFile || !fs.existsSync(item.sourceFile)) items.push({ level: "warn", code: "evidence-source", message: `evidence at ${at} has no supplied source file` });
    let record = null;
    try { record = item.recordFile && JSON.parse(fs.readFileSync(item.recordFile, "utf8")); } catch {}
    if (!record) items.push({ level: "warn", code: "evidence-redaction-record", message: `evidence at ${at} has no readable redaction record` });
    const lines = record?.ocr || item.ocr?.lines || [];
    const confidence = lines.length ? lines.reduce((sum, line) => sum + (+line.confidence || 0), 0) / lines.length : 0;
    if (!lines.length || confidence < 0.6) items.push({ level: "warn", code: "evidence-ocr", message: `evidence at ${at} has ${lines.length ? `low OCR confidence (${r3(confidence)})` : "no readable OCR text"}` });
    if (record?.longDigitRuns && !(record.redactions || []).length) items.push({ level: "warn", code: "evidence-private-digits", message: `evidence at ${at} contains a long digit run but nothing was redacted` });
    if (item.textPx != null && item.textPx < 32) items.push({ level: "warn", code: "evidence-legibility", message: `evidence at ${at} renders source text at ${Math.round(item.textPx)}px (minimum 32px)` });
    const clash = (plan.graphics || []).find((card) => card.type === "message" && card.mode === "proof" && card.start < item.start + item.duration && card.start + card.duration > item.start);
    if (clash) items.push({ level: "warn", code: "evidence-proof-overlap", message: `proof message card at ${fmt(clash.start)} overlaps real evidence at ${at}` });
  }
  return items;
}
/** Credential truth and collision checks. Every displayed fact must retain its exact input text in plan.json. */
export function credentialChecks(plan) {
  const credits = plan?.lowerThird?.credential && Array.isArray(plan.lowerThird.items) ? plan.lowerThird.items : [];
  if (!credits.length) return [];
  const items = [];
  const W = plan.canvas?.width || 1080, H = plan.canvas?.height || 1920;
  for (const credit of credits) {
    const label = `credential lower third at ${fmt(credit.at || 0)}`;
    const input = credit.input;
    const allowed = input?.kind === "cli" || input?.kind === "brand.identity";
    const fields = ["name", "credential", "organisation", "source"].filter((key) => credit[key]);
    if (!allowed || !String(input?.text || "").trim() || fields.some((key) => !creditValueGrounded(credit, key)) || (credit.verified && !creditVerifiedGrounded(credit))) {
      items.push({ level: "warn", code: "credential-grounding", message: `${label} contains text or a verified mark not preserved from --credit or brand identity` });
    }
    const p = credit.placement;
    if (!p || ![p.x, p.y, p.w, p.h].every(Number.isFinite)) {
      items.push({ level: "warn", code: "credential-bounds", message: `${label} has no measured placement` });
      continue;
    }
    const box = { x: p.x, y: p.y, w: p.w, h: p.h };
    const head = credit.head;
    if (head) {
      const face = { x: (head.cx - head.w / 2) * W, y: (head.cy - head.h / 2) * H, w: head.w * W, h: head.h * H };
      if (rectOverlap(box, face)) items.push({ level: "warn", code: "credential-face", message: `${label} overlaps the measured head` });
    }
    const captionTop = Number.isFinite(p.captionTop) ? p.captionTop : (plan.style?.captions?.position ?? 0.6) * H;
    if (p.y + p.h > captionTop) items.push({ level: "warn", code: "credential-caption", message: `${label} reaches the caption band at ${Math.round(captionTop)}px` });
    if (H > W && (p.x < 76 || p.x + p.w > 940 || p.y < 200)) items.push({ level: "warn", code: "credential-safe-zone", message: `${label} is outside x 76-940px / y 200px-caption top` });
  }
  return items;
}

/** The words a viewer must read on a card, excluding decorative skin chrome. */
export function cardWords(card) {
  const out = [card.eyebrow, card.title];
  if (card.type === "stat") out.push(card.value, card.value2, card.sub);
  else if (card.type === "compare") out.push(card.a?.label, card.a?.value, card.a?.note, card.b?.label, card.b?.value, card.b?.note);
  else if (card.type === "bars") for (const item of card.items || []) out.push(item.label, `${item.value || ""}${card.unit || ""}`);
  else if (card.type === "message") { out.push(card.contact); for (const item of card.items || []) out.push(item.text); }
  else if (["list", "steps"].includes(card.type)) for (const item of card.items || []) out.push(item.text, item.tag);
  else if (card.type === "ladder") for (const rung of card.rungs || []) out.push(rung.value, rung.label);
  else out.push(card.text);
  return words(out.filter(Boolean).join(" "));
}

export function cardOccupancy(cards, duration) {
  if (!(duration > 0)) return 0;
  const spans = (cards || []).map((g) => [Math.max(0, +g.start || 0), Math.min(duration, (+g.start || 0) + (+g.duration || 0))]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, run = null;
  for (const span of spans) {
    if (run && span[0] <= run[1]) run[1] = Math.max(run[1], span[1]);
    else { if (run) total += run[1] - run[0]; run = [...span]; }
  }
  if (run) total += run[1] - run[0];
  return total / duration;
}

export function majorEventStarts(plan) {
  return [
    ...(plan.graphics || []).filter((g) => !isPersistentScene(g)).map((g, i) => ({ t: +g.start || 0, kind: "card", label: `${g.type || "card"} ${i + 1}` })),
    ...(plan.broll || []).map((b, i) => ({ t: +b.start || 0, kind: "cutaway", label: `cutaway ${i + 1}` })),
    ...(plan.evidence || []).map((item, i) => ({ t: +item.start || 0, kind: "evidence", label: `evidence ${i + 1}` })),
    ...(plan.coldOpen ? [{ t: 0, kind: "cutaway", label: "cold open" }] : []),
  ].sort((a, b) => a.t - b.t);
}

export function maxMajorEvents(plan, seconds = 10) {
  const events = majorEventStarts(plan);
  let max = 0;
  for (let i = 0, j = 0; i < events.length; i++) {
    while (events[i].t - events[j].t >= seconds) j++;
    max = Math.max(max, i - j + 1);
  }
  return max;
}

function itemTimedDuration(card) {
  let found = false, end = 0;
  for (const item of card.items || []) {
    const rawStart = item.offset ?? item.at ?? item.start;
    const rawEnd = item.endOffset ?? item.end;
    if (rawStart == null && rawEnd == null && item.duration == null) continue;
    found = true;
    let start = Number(rawStart ?? 0), stop = Number(rawEnd ?? (start + Number(item.duration || 0)));
    if (start >= card.start && card.start > 0) start -= card.start;
    if (stop >= card.start && card.start > 0 && rawEnd != null) stop -= card.start;
    end = Math.max(end, stop, start);
  }
  return found && end > 0 ? end : null;
}

function dimension(v, size) {
  if (typeof v === "string" && /%$/.test(v)) return parseFloat(v) * size / 100;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 1 ? n * size : n;
}

function explicitCardBox(card, W, H) {
  const raw = card.box || card.bounds || card.layout?.box;
  const b = Array.isArray(raw) ? { x: raw[0], y: raw[1], width: raw[2], height: raw[3] } : raw;
  if (!b) return null;
  const x = dimension(b.x ?? b.left, W), y = dimension(b.y ?? b.top, H);
  let width = dimension(b.width ?? b.w, W), height = dimension(b.height ?? b.h, H);
  if (!(width >= 0) && (b.x2 ?? b.right) != null && Number.isFinite(x)) width = dimension(b.x2 ?? b.right, W) - x;
  if (!(height >= 0) && (b.y2 ?? b.bottom) != null && Number.isFinite(y)) height = dimension(b.y2 ?? b.bottom, H) - y;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height, estimated: false };
}

function estimatedCardBox(card, plan, W, H) {
  const mode = plan.style?.graphics?.mode || "overlay";
  if (mode === "full") return { x: 0.08 * W, y: 0.15 * H, width: 0.81 * W, height: 0.39 * H, estimated: true };
  const n = (card.items || []).length;
  const heights = { stat: 300, headline: 250, quote: 330, compare: 380, bars: 210 + n * 80, list: 190 + n * 78, steps: 300, ladder: 500, message: 190 + n * 105, post: 360, chapter: 250 };
  const height = Math.min((mode === "band" ? 0.62 : 0.4) * H, heights[card.type] || 340);
  if (mode !== "band") return { x: 0.04 * W, y: 0.055 * H, width: 0.92 * W, height, estimated: true };
  const f = plan.framing || {}, face = f.face;
  let x = 0.56 * W, width = 0.4 * W, y = 0.2 * H;
  if (f.multi && face) { x = 0.32 * W; width = 0.36 * W; y = 0.08 * H; }
  else if (face) {
    const room = (f.side === "right" ? 1 - (face.cx + face.w / 2) : face.cx - face.w / 2) - 0.2 * face.w - 0.04;
    width = Math.max(0.22, Math.min(0.3, room)) * W;
    x = (f.side === "right" ? 0.96 * W - width : 0.04 * W);
    y = Math.max(0.06, Math.min(0.5, face.cy - face.h * 0.6)) * H;
  }
  return { x, y, width, height, estimated: true };
}

function cardBox(card, plan, W, H) {
  return explicitCardBox(card, W, H) || estimatedCardBox(card, plan, W, H);
}

/** Retention guardrails for graphic cards. Warnings only; a plan with no cards returns exactly no new items. */
export function graphicChecks(plan) {
  // The progress rail is not a card: it shows during the hook and for 1.4 s pulses, placed clear of the hook, captions
  // and head by placeProgressRail, so its lifetime must not count as a long hold or as card coverage.
  const cards = (plan?.graphics || []).filter((g) => g.type !== "progress");
  if (!cards.length) return [];
  const items = [];
  const rules = { ...CARD_RULES, ...(plan.style?.preflight?.cards || {}) };
  const D = plan.video?.duration || 0;
  const W = plan.canvas?.width || 1080, H = plan.canvas?.height || 1920;
  const at = (g) => fmt(+g.start || 0);
  for (const card of cards) {
    const persistent = isPersistentScene(card);
    if (!persistent) {
      const count = cardWords(card).length;
      const budget = Math.max(0, Math.floor(((+card.duration || 0) - rules.orientationSeconds) / (60 / rules.readingWpm)));
      if (count > budget) items.push({ level: "warn", code: "card-reading-budget", message: `${card.type || "card"} at ${at(card)} shows ${count} words; its ${r3(+card.duration || 0)} s hold fits ${budget}` });
      if ((+card.duration || 0) > rules.maxHold) items.push({ level: "warn", code: "card-hold", message: `${card.type || "card"} at ${at(card)} holds ${r3(+card.duration)} s (keep cards at or under ${rules.maxHold} s)` });
      const timed = itemTimedDuration(card);
      // A timed card holds after its last item by design (1.2 s for steps, the reading time for a proof thread);
      // only a hold past what the card's own rule gives is lingering.
      const v2Timed = card.mode === "proof" || (card.items?.length && card.items.every((it) => Number.isFinite(it.at)));
      if (timed != null && (+card.duration || 0) > (v2Timed ? Math.max(timed, sceneDuration(card)) : timed) + 1 / 30) items.push({ level: "warn", code: "card-item-hold", message: `${card.type || "card"} at ${at(card)} holds ${r3(+card.duration)} s, past its last item at ${r3(timed)} s` });
    }

    const box = cardBox(card, plan, W, H), right = box.x + box.width, bottom = box.y + box.height;
    const cap = plan.style?.captions || {};
    const captionTop = plan.captions?.length && cap.enabled !== false ? (cap.position ?? 0.6) * H - 0.6 * (cap.fontSizeFrac || 0.04) * H : H;
    const bad = [];
    if (box.x < rules.left) bad.push(`left ${Math.round(box.x)}px`);
    if (right > rules.right) bad.push(`right ${Math.round(right)}px`);
    if (box.y < rules.top) bad.push(`top ${Math.round(box.y)}px`);
    if (bottom > captionTop) bad.push(`bottom ${Math.round(bottom)}px past captions at ${Math.round(captionTop)}px`);
    const source = box.estimated ? `estimated ${card.type || "card"} box` : `${card.type || "card"} box`;
    if (bad.length) items.push({ level: "warn", code: "card-bounds", message: `${source} at ${at(card)} is outside x ${rules.left}-${rules.right}px / y ${rules.top}px-caption top (${bad.join(", ")})` });
    if (right > rules.right && bottom > SAFE.rightFrom * H) items.push({ level: "warn", code: "card-right-rail", message: `${source} at ${at(card)} reaches the right action rail below ${pct(SAFE.rightFrom)}` });
    if (persistent && (+card.fontSize || 0) < 40) items.push({ level: "warn", code: "persistent-size", message: `${card.type || "persistent card"} at ${at(card)} uses ${+card.fontSize || 0}px item text (minimum 40px)` });
    if (persistent && card.head) {
      const face = { x: (card.head.cx - card.head.w / 2) * W, y: (card.head.cy - card.head.h / 2) * H, w: card.head.w * W, h: card.head.h * H };
      if (rectOverlap({ x: box.x, y: box.y, w: box.width, h: box.height }, face)) items.push({ level: "warn", code: "persistent-face", message: `${card.type || "persistent card"} at ${at(card)} overlaps the measured head` });
    }

    // Only the legacy zero count-up shows numbers that were never said; a v2 reveal prints the exact value and a
    // growth count starts at the spoken starting number.
    const legacyCount = !numberMotion(card, { schema: plan.graphicsSchema || plan.graphics?.schema || 1 });
    const countUp = card.type === "stat" && legacyCount && /\d/.test(String(card.value || "")) && !card.value2 && card.countUp !== false && card.animateNumber !== false && !["fixed", "threshold"].includes(card.display);
    if (countUp) items.push({ level: "warn", code: "card-truth-countup", message: `stat at ${at(card)} counts through numbers Greg did not say before it reaches "${card.value}"` });
  }

  const occupancyCards = cards.filter((g) => !isPersistentScene(g));
  const saveWorthy = occupancyCards.some((g) => g.saveWorthy === true || g.reference === true || g.informationRole === "reference" || g.role === "reference");
  const occupancy = cardOccupancy(occupancyCards, D), maxOccupancy = saveWorthy ? rules.saveWorthyOccupancy : rules.maxOccupancy;
  if (occupancy > maxOccupancy) items.push({ level: "warn", code: "card-occupancy", message: `cards occupy ${pct(occupancy)} of the reel (keep ${saveWorthy ? "one save-worthy reference reel" : "cards"} at or under ${pct(maxOccupancy)})` });

  const events = majorEventStarts(plan);
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].t - events[i - 1].t;
    if (gap < rules.minMajorGap) items.push({ level: "warn", code: "major-event-gap", message: `${events[i].label} at ${fmt(events[i].t)} starts ${r3(gap)} s after ${events[i - 1].label} (leave ${rules.minMajorGap} s)` });
  }
  const maxEvents = maxMajorEvents(plan, rules.eventWindow);
  if (maxEvents > rules.maxMajorStarts) items.push({ level: "warn", code: "major-event-budget", message: `${maxEvents} cards/cutaways start inside one rolling ${rules.eventWindow} s window (maximum ${rules.maxMajorStarts})` });

  const hook = plan.hook;
  const hookCount = hook && (+hook.start || 0) <= 1 / 30 ? words(hook.text).length : 0;
  if (hookCount < 4) items.push({ level: "warn", code: "frame-zero-hook", message: `frame zero has ${hookCount} hook words (target 4-8)` });
  else if (hookCount >= 9) items.push({ level: "warn", code: "frame-zero-hook", message: `frame zero has ${hookCount} hook words (target 4-8)` });
  return items;
}

/**
 * Pacing and caption readability from the plan (after herk-edit-kit's measured numbers and remotion-captioneer's
 * reading-speed gate, both MIT). A shot ends wherever the picture changes: a punch-in or jump cut, a card or a
 * cutaway in or out, the cold open. Captions follow the voice, so their reading speed is the speaking speed: a line
 * counts as missed when it flashes for under 0.3 s or runs over 30 characters a second (17 a second, the subtitle
 * guideline, is reported as a figure only; a fast talker passes it on half the lines).
 * Targets come from the preset's `pacing` (the fast overlay); without one only the reading speed is judged.
 */
export function pacingChecks(plan) {
  const items = [];
  if (!plan?.video?.duration) return { items, stats: null };
  const D = plan.video.duration;
  const changes = new Set([0, D]);
  for (const z of plan.zooms || []) changes.add(z.t);
  for (const g of plan.graphics || []) {
    if (g.type === "progress") { for (const p of g.pulses || []) if (!p.hidden) { changes.add(p.at); changes.add(p.at + 1.4); } }
    else if (!isPersistentScene(g)) { changes.add(g.start); changes.add(g.start + g.duration); }
  }
  for (const b of plan.broll || []) { changes.add(b.start); changes.add(b.start + b.duration); }
  for (const item of plan.evidence || []) { changes.add(item.start); changes.add(item.start + item.duration); }
  if (plan.coldOpen) changes.add(plan.coldOpen.duration);
  const t = [...changes].filter((x) => x >= 0 && x <= D).map((x) => Math.round(x * 1000) / 1000).sort((a, b) => a - b);
  const shots = [];
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > 0.05) shots.push({ start: t[i - 1], len: t[i] - t[i - 1] });
  const avgShot = shots.length ? shots.reduce((a, s) => a + s.len, 0) / shots.length : D;
  const longest = shots.reduce((a, s) => (s.len > a.len ? s : a), { len: 0, start: 0 });
  const firstCut = t.find((x) => x > 0.05 && x < D) ?? D;
  // Away: the speaker is off screen under a full-frame cutaway (cards sit over the speaker; a window, split or
  // cutout keeps the speaker in frame).
  const away = [...(plan.broll || []).filter((b) => !b.layout || b.layout === "full").map((b) => [b.start, b.start + b.duration]), ...(plan.coldOpen ? [[0, plan.coldOpen.duration]] : [])].sort((a, b) => a[0] - b[0]);
  let maxAway = 0, run = null;
  for (const [a, b] of away) { if (run && a <= run[1] + 0.05) run[1] = Math.max(run[1], b); else { if (run) maxAway = Math.max(maxAway, run[1] - run[0]); run = [a, b]; } }
  if (run) maxAway = Math.max(maxAway, run[1] - run[0]);
  // Reading speed per caption line, over the time it is on screen.
  const cps = (plan.captions || []).map((g) => ({ start: g.start, text: g.text || "", dur: g.end - g.start, cps: String(g.text || "").replace(/\s+/g, "").length / Math.max(0.1, g.end - g.start) }));
  const fast = cps.filter((c) => c.cps > 17);
  const missed = cps.filter((c) => c.dur < 0.28 || c.cps > 30).sort((a, b) => a.dur - b.dur);
  const stats = { shots: shots.length, avgShot: r3(avgShot), maxShot: r3(longest.len), maxShotAt: r3(longest.start), firstCut: r3(firstCut), maxAway: r3(maxAway), captionsOver17: fast.length, captionLines: cps.length };
  if (missed.length) items.push({ level: "warn", code: "caption-speed", message: `${missed.length} caption line${missed.length === 1 ? " flashes" : "s flash"} by too fast to read (worst "${missed[0].text}" for ${r3(missed[0].dur)} s at ${fmt(missed[0].start)})` });
  const tg = plan.style?.pacing;
  if (tg) {
    if (tg.avgShot && (avgShot < tg.avgShot[0] - 0.3 || avgShot > tg.avgShot[1] + 0.3)) items.push({ level: "warn", code: "pace-average", message: `shots average ${r3(avgShot)} s (target ${tg.avgShot[0]}-${tg.avgShot[1]} s)` });
    if (tg.maxShot && longest.len > tg.maxShot + 0.3) items.push({ level: "warn", code: "pace-longest", message: `one shot holds ${r3(longest.len)} s at ${fmt(longest.start)} (target under ${tg.maxShot} s)` });
    if (tg.firstCut && firstCut > tg.firstCut + 0.2) items.push({ level: "warn", code: "pace-first-cut", message: `the first cut lands at ${r3(firstCut)} s (target by ${tg.firstCut} s)` });
    if (tg.maxAway && maxAway > tg.maxAway + 0.2) items.push({ level: "warn", code: "pace-away", message: `the speaker is off screen for ${r3(maxAway)} s in a row (target under ${tg.maxAway} s)` });
  }
  return { items, stats };
}

/**
 * Run every check on `file`. Returns {status: ok|warn|fail, items, measures}. `plan` is the reel's plan.json when
 * available (layout checks and the expected length).
 */
export async function runPreflight(file, { plan = null, loudnessTarget = -14, loudnessTolerance = 1.5 } = {}) {
  const items = [];
  const meta = await probe(file);
  const measures = { duration: r3(meta.duration), width: meta.width, height: meta.height };
  const expected = plan?.video?.duration;
  if (expected && Math.abs(meta.duration - expected) > 0.5) items.push({ level: "fail", code: "length", message: `the file runs ${r3(meta.duration)}s, the plan is ${r3(expected)}s (render cut short?)` });
  if (plan?.video?.hasAudio && !meta.hasAudio) items.push({ level: "fail", code: "no-audio", message: "the file has no audio track" });
  if (meta.hasAudio) {
    const loud = await measureLoudness(file);
    Object.assign(measures, { lufs: loud.i, lra: loud.lra, truePeak: loud.tp });
    if (loud.i != null && Math.abs(loud.i - loudnessTarget) > loudnessTolerance) items.push({ level: "fail", code: "loudness", message: `loudness ${loud.i} LUFS (target ${loudnessTarget} ±${loudnessTolerance})` });
    if (loud.tp != null && loud.tp > -0.5) items.push({ level: "fail", code: "peak", message: `true peak ${loud.tp} dBTP (keep at or under -1)` });
    if (loud.lra != null && loud.lra > 14) items.push({ level: "warn", code: "range", message: `loudness range ${loud.lra} LU is wide (quiet lines will drop out on a phone)` });
    const quiet = await silences(file, { min: 1.5 });
    const open = quiet.find((s) => s.start < 0.05);
    if (open && open.end >= 1) items.push({ level: "fail", code: "silent-open", message: `no sound for the first ${open.end}s` });
    const longest = quiet.filter((s) => s !== open).sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (longest && longest.end - longest.start >= 2) items.push({ level: "warn", code: "dead-air", message: `${r3(longest.end - longest.start)}s of silence at ${fmt(longest.start)}` });
  }
  const black = await blackOpen(file);
  measures.blackOpen = black;
  if (black >= 0.3) items.push({ level: "fail", code: "black-open", message: `the first ${black}s are black` });
  const motion = await openMotion(file);
  measures.openMotion = motion;
  if (motion != null && motion < 0.4) items.push({ level: "warn", code: "static-open", message: `almost nothing moves in the first 2 s (motion ${motion})` });
  items.push(...layoutChecks(plan));
  const pace = pacingChecks(plan);
  items.push(...pace.items);
  if (pace.stats) measures.pacing = pace.stats;
  const status = items.some((i) => i.level === "fail") ? "fail" : items.length ? "warn" : "ok";
  return { status, items, measures };
}

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function preflightText(res) {
  const m = res.measures || {};
  const head = res.status === "ok" ? "Preflight: OK" : res.status === "warn" ? "Preflight: check these" : "Preflight: FAILED";
  const lines = [head, ""];
  for (const i of res.items) lines.push(`${i.level === "fail" ? "FAIL" : "warn"}  ${i.message}`);
  if (res.items.length) lines.push("");
  const facts = [];
  if (m.lufs != null) facts.push(`${m.lufs} LUFS`);
  if (m.truePeak != null) facts.push(`peak ${m.truePeak} dBTP`);
  if (m.lra != null) facts.push(`range ${m.lra} LU`);
  if (m.duration != null) facts.push(`${m.duration}s`);
  if (m.width) facts.push(`${m.width}x${m.height}`);
  if (m.openMotion != null) facts.push(`open motion ${m.openMotion}`);
  lines.push(`Measured: ${facts.join(", ")}`);
  if (m.pacing) lines.push(`Pacing: ${m.pacing.shots} shots, average ${m.pacing.avgShot} s, longest ${m.pacing.maxShot} s, first cut at ${m.pacing.firstCut} s, speaker away at most ${m.pacing.maxAway} s; ${m.pacing.captionsOver17} of ${m.pacing.captionLines} caption lines over 17 characters a second`);
  if (res.viewer) lines.push(`Cold viewer (Claude, from frames): ${res.viewer.first3s === "keep" ? "keeps watching" : "swipes"} after 3 s${res.viewer.why ? `: ${res.viewer.why}` : ""}${res.viewer.dropAt != null ? `. Most likely to stop at ${res.viewer.dropAt}s: ${res.viewer.dropWhy}` : ""}`);
  return lines.join("\n") + "\n";
}

/** One log line. */
export function describePreflight(res) {
  if (res.status === "ok") return "preflight: ok";
  const fails = res.items.filter((i) => i.level === "fail").length;
  const warns = res.items.length - fails;
  const parts = [];
  if (fails) parts.push(`${fails} fail${fails === 1 ? "" : "s"}`);
  if (warns) parts.push(`${warns} warning${warns === 1 ? "" : "s"}`);
  return `preflight: ${parts.join(", ")}: ${res.items.map((i) => i.message).join("; ")}`;
}

export function writePreflight(dir, res) {
  const p = path.join(dir, "preflight.txt");
  fs.writeFileSync(p, preflightText(res));
  fs.writeFileSync(path.join(dir, "preflight.json"), JSON.stringify(res, null, 2));
  return p;
}
