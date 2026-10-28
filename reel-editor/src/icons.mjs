import fs from "node:fs";
import path from "node:path";
import { faceBox, headBoxFor, zoomDuring } from "./placement.mjs";
import { norm } from "./text.mjs";
import { PKG_ROOT, r3 } from "./util.mjs";

/** Spoken words with one unambiguous picture in Greg's world. Longer phrases win over their individual words. */
export const ICON_MAP = [
  { words: [["booked"], ["call", "calls"]], icon: "calendar-check.svg", kind: "noun" },
  { words: [["sales"], ["call", "calls"]], icon: "phone-call.svg", kind: "noun" },
  { words: [["phone"], ["call", "calls"]], icon: "phone-call.svg", kind: "noun" },
  { words: [["direct"], ["message", "messages"]], icon: "message-circle.svg", kind: "noun" },
  { words: [["text"], ["me"]], icon: "message-square.svg", kind: "verb" },
  { words: [["ten"], ["minute", "minutes"]], icon: "clock.svg", kind: "noun" },
  { words: [["sales"], ["lead", "leads"]], icon: "user-check.svg", kind: "noun" },
  { words: [["money", "cash", "dollar", "dollars", "buck", "bucks"]], icon: "dollar-sign.svg", kind: "noun" },
  { words: [["revenue", "revenues", "profit", "profits", "income"]], icon: "chart-line.svg", kind: "noun" },
  { words: [["price", "prices", "pricing", "commission", "commissions"]], icon: "banknote.svg", kind: "noun" },
  { words: [["payment", "payments", "paid", "paying"]], icon: "credit-card.svg", kind: "noun" },
  { words: [["call", "calls"]], icon: "phone-call.svg", kind: "noun" },
  { words: [["setter", "setters"]], icon: "phone-call.svg", kind: "noun" },
  { words: [["phone", "phones"]], icon: "phone.svg", kind: "noun" },
  { words: [["dm", "dms"]], icon: "message-circle.svg", kind: "noun" },
  { words: [["text", "texts", "texted", "texting"]], icon: "message-square.svg", kind: "verb" },
  { words: [["closer", "closers"]], icon: "handshake.svg", kind: "noun" },
  { words: [["deal", "deals"]], icon: "handshake.svg", kind: "noun" },
  { words: [["closed", "closing"]], icon: "handshake.svg", kind: "verb" },
  { words: [["minute", "minutes", "hour", "hours"]], icon: "clock.svg", kind: "noun" },
  { words: [["calendar", "calendars"]], icon: "calendar.svg", kind: "noun" },
  { words: [["booked", "booking", "bookings", "appointment", "appointments", "meeting", "meetings", "scheduled", "scheduling"]], icon: "calendar-check.svg", kind: "noun" },
  { words: [["objection", "objections"]], icon: "circle-x.svg", kind: "noun" },
  { words: [["trust", "trusted", "trusting"]], icon: "shield.svg", kind: "noun" },
  { words: [["family", "families", "wife", "kids", "daughter", "daughters", "son", "sons"]], icon: "heart.svg", kind: "noun" },
  { words: [["gym", "gyms", "workout", "workouts"]], icon: "dumbbell.svg", kind: "noun" },
  { words: [["truck", "trucks"]], icon: "truck.svg", kind: "noun" },
  { words: [["faith", "bible", "scripture"]], icon: "book-open.svg", kind: "noun" },
  { words: [["target", "targets", "goal", "goals"]], icon: "target.svg", kind: "noun" },
  { words: [["jail", "prison", "locked"]], icon: "lock.svg", kind: "noun" },
  { words: [["team", "teams"]], icon: "users.svg", kind: "noun" },
  { words: [["job", "jobs", "career", "boss", "manager"]], icon: "briefcase.svg", kind: "noun" },
  { words: [["email", "emails", "inbox"]], icon: "mail.svg", kind: "noun" },
  { words: [["zoom"]], icon: "video.svg", kind: "noun" },
  { words: [["results", "growth", "scale", "scaling"]], icon: "trending-up.svg", kind: "noun" },
  { words: [["idea", "ideas"]], icon: "lightbulb.svg", kind: "noun" },
];

const tokensOf = (text) => String(text).split(/\s+/).map(norm).filter(Boolean);
const fitsEntry = (tokens, at, entry) => entry.words.every((forms, j) => forms.includes(tokens[at + j]));

function matches(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = ICON_MAP.find((x) => fitsEntry(tokens, i, x));
    if (!entry) continue;
    out.push({ at: i, length: entry.words.length, icon: entry.icon, kind: entry.kind });
    i += entry.words.length - 1;
  }
  return out;
}

/** Dictionary matches in free text; token matching makes stems/plurals explicit without substring false positives. */
export function iconMatches(text) {
  const toks = tokensOf(text);
  return matches(toks).map((m) => ({ ...m, word: toks.slice(m.at, m.at + m.length).join(" ") }));
}

/** Icon candidates from the actual caption words, at the first spoken word of a match. */
export function iconCandidates(groups) {
  const words = groups.flatMap((g, line) => (g.words || []).map((w) => ({ ...w, line }))).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const toks = words.map((w) => norm(w.text));
  return matches(toks).map((m) => {
    const run = words.slice(m.at, m.at + m.length);
    return {
      t: r3(run[0].start),
      wordEnd: r3(run[run.length - 1].end ?? run[0].start),
      word: run.map((w) => String(w.text).replace(/[.,!?;:"]+$/g, "")).join(" "),
      icon: m.icon,
      key: run.some((w) => w.key),
      noun: m.kind === "noun",
    };
  });
}

const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** Place one square beside the head at eye/forehead height; if neither side is safe, try above it. */
export function placeIcon({ face, detection = null, zooms = [], t = 0, end = 1.2, size = 0.12, W = 1080, H = 1920, scale = 1, originY = 0.38, shift = 0, captionTop = 0.68 } = {}) {
  if (!face) return { skip: true, reason: "no face found" };
  const px = Math.max(48, Math.round(size <= 1 ? size * W : size));
  const zoom = zoomDuring(zooms, t, end);
  const box = headBoxFor(face, detection, { zoom, scale, originY, shift });
  if (!box) return { skip: true, reason: "no head box found" };
  const head = { x: (box.cx - box.w / 2) * W, y: (box.cy - box.h / 2) * H, w: box.w * W, h: box.h * H };
  const rightEdge = Math.min(940, W - 76);
  const gap = Math.max(18, Math.round(px * 0.14));
  const y = Math.round(Math.max(200, head.y + head.h * 0.16));
  const vertical = y + px <= captionTop * H - 20;
  const spots = {
    left: { x: Math.round(head.x - gap - px), y },
    right: { x: Math.round(head.x + head.w + gap), y },
  };
  const preferred = box.cx < 0.5 ? "right" : "left";
  for (const side of [preferred, preferred === "right" ? "left" : "right"]) {
    const p = { ...spots[side], w: px, h: px };
    if (vertical && p.x >= 76 && p.x + p.w <= rightEdge && !overlaps(p, head, 1)) return { x: p.x, y: p.y, size: px, side, head };
  }
  const above = { x: Math.round(box.cx * W - px / 2), y: Math.round(head.y - gap - px), w: px, h: px };
  if (above.x >= 76 && above.x + above.w <= rightEdge && above.y >= 200 && above.y + above.h <= captionTop * H - 20 && !overlaps(above, head, 1)) {
    return { x: above.x, y: above.y, size: px, side: "above", head };
  }
  return { skip: true, reason: "no room beside or above the head" };
}

const rollingOver = (items, maxPer30) => {
  const a = [...items].sort((x, y) => x.t - y.t);
  for (let i = 0; i < a.length; i++) if (a.filter((x) => x.t >= a[i].t && x.t < a[i].t + 30).length > maxPer30) return true;
  return false;
};

const repeatedNeighbor = (items) => {
  const a = [...items].sort((x, y) => x.t - y.t);
  return a.some((x, i) => i && x.icon === a[i - 1].icon);
};

/**
 * Rank gold matches, then nouns, then time. Keep the winners clear of every supplied busy window and place each
 * against the strongest zoom in its hold. The returned array carries a transient `skipped` count for one log line.
 */
export function planIcons(groups, duration, { hook = null, busy = [], zooms = [], face = null, detection = null, framing = {}, W = 1080, H = 1920, captionTop = 0.68, minSpacing = 6, max = 4, maxPer30 = 3, hold = 1.2, size = 0.12, tail = 1.5 } = {}) {
  const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  const windows = [...busy, ...(hook ? [{ start: hook.start, duration: hook.duration, kind: "hook" }] : [])];
  const candidates = iconCandidates(groups).sort((a, b) => Number(b.key) - Number(a.key) || Number(b.noun) - Number(a.noun) || a.t - b.t);
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= max) { skip("cap"); continue; }
    const end = r3(Math.max(c.t + hold, c.wordEnd + 0.2));
    if (end > duration - tail) { skip("tail"); continue; }
    const hit = windows.find((w) => c.t < w.start + w.duration + (w.pad || 0) && end > w.start - (w.pad || 0));
    if (hit) { skip(hit.kind || "busy window"); continue; }
    if (picked.some((p) => Math.abs(p.t - c.t) < minSpacing)) { skip("spacing"); continue; }
    const timed = [...picked, { ...c, end }];
    if (rollingOver(timed, maxPer30)) { skip("30-second cap"); continue; }
    if (repeatedNeighbor(timed)) { skip("repeat"); continue; }
    const nearest = detection?.frames?.length ? detection.frames.reduce((best, frame) => Math.abs(frame.t - c.t) < Math.abs(best.t - c.t) ? frame : best) : null;
    const localDetection = nearest ? { ...detection, frames: [nearest] } : detection;
    const localFace = framing.multi ? face : faceBox(localDetection) || face;
    const spot = placeIcon({ face: localFace, detection: localDetection, zooms, t: c.t, end, size, W, H, scale: framing.scale || 1, originY: parseFloat(String(framing.origin || "50% 38%").split(" ")[1]) / 100 || 0.38, shift: framing.shift || 0, captionTop });
    if (spot.skip) { skip(spot.reason); continue; }
    picked.push({ t: c.t, end, icon: c.icon, word: c.word, x: spot.x, y: spot.y, size: spot.size });
  }
  picked.sort((a, b) => a.t - b.t);
  picked.skipped = skipped;
  return picked;
}

/** Inline a vendored Lucide icon. Only its drawing elements survive; color and width come from the icon skin. */
export function inlineIconSVG(file) {
  const name = path.basename(String(file));
  if (!/^[a-z0-9-]+\.svg$/.test(name)) return "";
  const src = path.join(PKG_ROOT, "assets", "icons", name);
  if (!fs.existsSync(src)) return "";
  const body = fs.readFileSync(src, "utf8").match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i)?.[1] || "";
  const paths = (body.match(/<(?:path|line|polyline|polygon|circle|ellipse|rect)\b[^>]*\/?\s*>/gi) || []).join("");
  return paths ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>` : "";
}
