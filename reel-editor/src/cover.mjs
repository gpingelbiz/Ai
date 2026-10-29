import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { esc } from "./text.mjs";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { hyperframesBin, renderEnv } from "./render.mjs";
import { log, warn, run, ensureDir, readJSON, writeJSON, PKG_ROOT, fontFile } from "./util.mjs";
import { resolveBrandTokens, tokensCSS } from "./brandtokens.mjs";
import { detectFaces, headBoxFor } from "./placement.mjs";
import { signatureRulesCSS, signatureHTML } from "./signature.mjs";

const GREG_HANDLE = "@officialgregpingel";
const POWER = ["broke", "kills", "costs", "cost", "quit", "lies", "lie", "wrong", "nobody", "expensive", "losing", "lose", "weak", "rich", "pay", "beg", "every", "never", "stop", "fire", "fired", "blame", "own", "truth", "late", "dead", "fail", "failed"];
const BANNED = ["success", "mindset", "journey", "tips", "hacks", "grind", "10x", "crushing"];

export const ARCHETYPES = ["native-premise", "verdict", "interview", "proof-reaction", "editorial"];
export const STYLES = ["outline", "whitebox", "box"]; // Kept for callers that stored the old designed-cover names.
export const COVER_TARGETS = Object.freeze([
  { id: "reel", width: 1080, height: 1920 },
  { id: "grid-3x4", width: 1080, height: 1440 },
  { id: "feed-4x5", width: 1080, height: 1350 },
  { id: "square", width: 1080, height: 1080 },
  { id: "landscape", width: 1920, height: 1080 },
]);

const round = (n, places = 3) => { const p = 10 ** places; return Math.round(n * p) / p; };
const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/[!]+/g, "").trim();
const overlap = (a, b, gap = 0) => a && b && a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
const inside = (box, W, H, margin = 0) => !!box && box.x >= margin && box.y >= margin && box.x + box.w <= W - margin && box.y + box.h <= H - margin;
const largestFace = (faces = []) => faces.reduce((best, face) => !best || face.w * face.h > best.w * best.h ? face : best, null);

let activeFont = null;
let activeFontPath = null;
/** The real display font used by the current cover. */
export function useDisplayFont(file) { if (file !== activeFontPath) { activeFontPath = file; activeFont = null; } }
function displayFont() {
  if (activeFont) return activeFont;
  try {
    const fk = createRequire(import.meta.url)("fontkit");
    const f = fk.openSync(activeFontPath || path.join(PKG_ROOT, "assets", "fonts", "Anton-Regular.ttf"));
    activeFont = { cap: f.capHeight / f.unitsPerEm, width: (s) => f.layout(String(s)).advanceWidth / f.unitsPerEm };
  } catch {
    activeFont = { cap: 0.72, width: (s) => String(s).length * 0.45 };
  }
  return activeFont;
}

/** Width at cap height T. Starred emphasis is slightly wider, matching the cover CSS. */
export function lineWidthPx(line, T) {
  const { cap, width } = displayFont();
  const fontPx = T / cap;
  return String(line).split(" ").reduce((sum, word, i) => {
    const emphasis = word.includes("*") ? 1.08 : 1;
    const text = word.replace(/\*/g, "");
    return sum + (width(text) + 0.012 * text.length) * fontPx * emphasis + (i ? width(" ") * fontPx : 0);
  }, 0);
}

export function titlePrompt({ transcript, hook, voice = "", brand = null }) {
  const gregUpper = String(brand?.identity?.handle || "").toLowerCase() === GREG_HANDLE && brand?.type?.display?.case === "upper";
  const rules = gregUpper
    ? [
        "Rules: 2-4 words, hard max 5, at most 2 lines. Use only words or a short consecutive phrase that the speaker actually says. ONE power word may be marked with *asterisks*.",
        `Power words when they are actually spoken: ${POWER.map((w) => w.toUpperCase()).join(", ")}.`,
        `Banned: ${BANNED.map((w) => w.toUpperCase()).join(", ")}, emojis, exclamation marks, and invented claims.`,
      ]
    : [
        `Rules: 2-6 words, at most 2 lines, ${brand?.type?.display?.case === "upper" ? "uppercase" : "natural sentence case"}.`,
        "Use only words or a short consecutive phrase the speaker actually says. Keep the brand voice. Do not add power words, credentials, numbers, or claims.",
      ];
  return [
    "You package one talking-head cover from the speaker's own words. Reply with JSON only; use no tools.",
    "Write 10 candidate titles from THIS transcript. Score specificity, fidelity to the spoken promise, brevity, and stakes; return the top 3.",
    ...rules,
    "Optional teaser: one short line from the same spoken thought. Empty when nothing adds.",
    voice ? `\nVoice:\n${voice.trim()}` : "",
    "",
    `Hook already on the reel: ${hook || "(none)"}`,
    "Transcript:", transcript, "",
    'Reply: {"titles":[{"title":"the exact short phrase","teaser":"","score":34}]}',
  ].join("\n");
}

function applyCase(text, mode) {
  if (mode === "upper") return text.toUpperCase();
  if (/[A-Z]/.test(text) && text === text.toUpperCase()) {
    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return text;
}

/** Greg keeps the legacy power-word treatment. Every other brand keeps its own case and voice. */
export function normalizeTitles(raw, { hook = "", brand = null } = {}) {
  const gregUpper = !brand || (String(brand.identity?.handle || "").toLowerCase() === GREG_HANDLE && brand.type?.display?.case === "upper");
  const mode = brand?.type?.display?.case || (gregUpper ? "upper" : "sentence");
  const maxWords = gregUpper ? 5 : 6;
  const out = [];
  for (const item of raw || []) {
    let title = applyCase(clean(item.title), mode);
    if (!title) continue;
    const words = title.replace(/\*/g, "").split(" ").filter(Boolean);
    if (words.length < 2 || words.length > maxWords) continue;
    if (gregUpper && words.some((word) => BANNED.includes(word.toLowerCase().replace(/[^a-z0-9]/g, "")))) continue;
    if (gregUpper && !/\*[^*]+\*/.test(title)) {
      const i = words.findIndex((word) => POWER.includes(word.toLowerCase().replace(/[^a-z]/g, "")));
      const k = i >= 0 ? i : words.length - 1;
      words[k] = `*${words[k]}*`;
      title = words.join(" ");
    }
    if (!gregUpper) title = title.replace(/\*/g, "");
    const teaser = applyCase(clean(item.teaser).split(" ").slice(0, 6).join(" "), mode);
    if (out.some((other) => other.title === title)) continue;
    out.push({ title, teaser, score: Number(item.score) || 0 });
  }
  if (!out.length && hook) {
    const words = applyCase(clean(hook).replace(/\*/g, ""), mode).split(" ").slice(0, gregUpper ? 4 : 6);
    if (gregUpper && words.length) words[words.length - 1] = `*${words[words.length - 1]}*`;
    out.push({ title: words.join(" "), teaser: "", score: 0 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

function splitLines(title, maxLines = 2) {
  const words = clean(title).split(" ").filter(Boolean);
  if (words.length <= 1) return [words.join(" ")];
  let best = [words.join(" ")], bestWidth = lineWidthPx(best[0], 100);
  for (let count = 2; count <= Math.min(maxLines, words.length); count++) {
    const lines = [];
    let at = 0;
    for (let line = 0; line < count; line++) {
      const left = words.length - at, slots = count - line;
      const take = Math.ceil(left / slots);
      lines.push(words.slice(at, at + take).join(" "));
      at += take;
    }
    const width = Math.max(...lines.map((line) => lineWidthPx(line, 100)));
    if (width < bestWidth * 0.92 || (width <= bestWidth && lines.length < best.length)) { best = lines; bestWidth = width; }
  }
  return best;
}

/** Legacy measured layout API, now backed by the selected brand display font. */
export function fitLines(title) {
  const lines = splitLines(title, 2);
  const widest = Math.max(...lines.map((line) => lineWidthPx(line, 100) * (line.includes("*") ? 1.22 : 1)));
  const T = Math.max(120, Math.min(190, Math.floor((1080 * 0.88) / Math.max(1, widest / 100))));
  const lineH = Math.round(T * 1.08);
  return { lines, T, fontPx: Math.round(T / displayFont().cap), lineH, blockH: lines.length * lineH };
}

export const titleFits = (title) => fitLines(title.title).T >= 130;

export function layoutTitle(title, { teaser = "", chinY = 0 } = {}) {
  const fit = fitLines(title);
  let T = Math.min(230, Math.max(120, fit.T));
  let withTeaser = !!teaser;
  const height = () => fit.lines.length * 1.18 * T + (withTeaser ? 0.9 * T : 0);
  while (chinY && 1400 - height() < chinY + 30 && T > 150) T -= 10;
  if (chinY && 1400 - height() < chinY + 30) withTeaser = false;
  return { lines: fit.lines, T, fontPx: Math.round(T / displayFont().cap), teaser: withTeaser ? teaser : "", teaserCap: withTeaser ? 0.4 * T : 0, blockH: height(), blockTop: Math.round(1400 - height()) };
}

export function placeOnFrame({ W = 1080, H = 1920, face, blockH }) {
  const f = face || { x: 0.25, y: 0.25, w: 0.5, h: 0.28 };
  const faceCy = (f.y + f.h / 2) * H, faceCx = (f.x + f.w / 2) * W;
  const scale = Math.max(1, Math.min(1.35, 0.42 / Math.max(0.2, f.w)));
  const tx = Math.round(Math.min(0, Math.max(W - W * scale, faceCx - faceCx * scale)));
  const ty = Math.round(Math.min(0, Math.max(H - H * scale, faceCy - faceCy * scale)));
  const chinY = (f.y + f.h) * H * scale + ty, headY = f.y * H * scale + ty;
  const below = chinY + 60;
  const fitsBelow = below + blockH <= H * 0.844, fitsAbove = headY - 50 - blockH >= H * 0.13;
  const blockTop = fitsBelow ? Math.round(Math.max(below, Math.min(H * 0.844 - blockH, H * 0.615))) : fitsAbove ? Math.round(headY - 50 - blockH) : Math.round(H * 0.844 - blockH);
  return { scale, tx, ty, blockTop, zone: fitsBelow ? "below" : fitsAbove ? "above" : "low" };
}

/** Candidate timestamps: dense, integer-frame samples in the hook, then the rest of the reel. */
export function coverTimes(duration, { fps = 30, hookEnd = 3 } = {}) {
  const frames = new Set();
  const add = (seconds) => { if (seconds >= 0 && seconds < duration) frames.add(Math.max(1, Math.round(seconds * fps))); };
  for (let t = 0.2; t < Math.min(duration, hookEnd); t += 0.3) add(t);
  for (let t = Math.max(hookEnd, 3.2); t < Math.min(duration, 20); t += 1) add(t);
  for (let t = 21; t < duration - 0.5; t += 3) add(t);
  if (!frames.size) add(Math.max(0.05, duration / 2));
  return [...frames].sort((a, b) => a - b).map((frame) => round(frame / fps));
}

function centeredInGrid(face) {
  if (!face) return 0;
  const cx = face.x + face.w / 2, cy = face.y + face.h / 2;
  const dx = Math.abs(cx - 0.5) / 0.5, dy = Math.abs(cy - 0.5) / 0.375;
  return Math.max(0, 1 - Math.hypot(dx, dy) / Math.SQRT2);
}

function inWindow(t, item, pad = 0) { return t >= Number(item.start ?? item.t ?? 0) - pad && t <= Number(item.start ?? item.t ?? 0) + Number(item.duration || 0) + pad; }

/** Pure ranking used by the Vision path and synthetic unit tests. */
export function scoreFrameCandidates(candidates, { duration = Infinity, hookEnd = 3, broll = [], cuts = [], hookBehind = false, cutPad = 4 / 30 } = {}) {
  const scored = (candidates || []).map((candidate) => {
    const t = Number(candidate.t ?? (candidate.frameTimeMs || 0) / 1000);
    const face = candidate.face || largestFace(candidate.faces);
    const parts = candidate.parts || {};
    const scores = {
      eyesOpen: Number(candidate.eyesOpen ?? parts.eyes ?? (face ? 0.5 : 0)),
      expression: Number(parts.expression ?? candidate.expression ?? (face ? 0.5 : 0)),
      faceSize: Number(parts.size ?? candidate.faceSize ?? (face ? Math.min(1, face.h / 0.28) : 0)),
      gridCenter: Number(parts.center ?? candidate.gridCenter ?? centeredInGrid(face)),
      sharpness: Number(parts.sharp ?? candidate.sharpness ?? 0),
      light: Number(parts.light ?? candidate.light ?? 0.5),
      angle: Number(parts.angle ?? candidate.angle ?? 0.5),
      firstThree: t <= hookEnd ? 1 : Math.max(0, 1 - (t - hookEnd) / Math.max(3, duration - hookEnd)),
      promise: t <= 1.5 ? 1 : t <= hookEnd ? 0.85 : Math.max(0, 0.55 - (t - hookEnd) / Math.max(6, duration)),
    };
    const blocked = {
      broll: broll.some((item) => inWindow(t, item)),
      jumpCut: cuts.some((cut) => Math.abs(t - Number(cut.t ?? cut.start ?? cut)) <= cutPad),
      hookBehind: !!candidate.hookBehind || (hookBehind && t <= hookEnd),
      hookOverlap: Number(candidate.hookOverlap || 0) > 0.02,
    };
    const eligible = !Object.values(blocked).some(Boolean);
    const total = 2.5 * scores.eyesOpen + 1.25 * scores.expression + 1.5 * scores.faceSize + 1.5 * scores.gridCenter + 2 * scores.sharpness + 0.75 * scores.light + 0.75 * scores.angle + 1.5 * scores.firstThree + scores.promise;
    return { ...candidate, t, frameTimeMs: Math.round(t * 1000), face, scores: { ...scores, total: round(total) }, blocked, eligible };
  });
  const usable = scored.filter((candidate) => candidate.eligible);
  return (usable.length ? usable : scored).sort((a, b) => b.scores.total - a.scores.total || a.t - b.t);
}

export function personBinary() {
  if (process.platform !== "darwin") return Promise.resolve(null);
  const bin = path.join(process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "person");
  const src = path.join(PKG_ROOT, "scripts", "person.swift");
  try {
    if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
      ensureDir(path.dirname(bin));
      return run("swiftc", ["-O", "-o", bin, src], { capture: true }).then(() => bin).catch(() => null);
    }
    return Promise.resolve(bin);
  } catch { return Promise.resolve(null); }
}

function faceOverlapWithHook(face, plan, t) {
  if (!face || !plan.hook || t > plan.hook.start + plan.hook.duration) return 0;
  const y = Math.max(0, Number(plan.hook.position ?? plan.style?.hook?.position ?? 0.22) - 0.02);
  const words = clean(plan.hook.text).split(" ").length;
  const h = Math.min(0.28, Math.max(0.08, Math.ceil(words / 4) * Number(plan.style?.hook?.fontSizeFrac || 0.05) * 1.2));
  const box = { x: 0.04, y, w: 0.92, h };
  const x1 = Math.max(face.x, box.x), y1 = Math.max(face.y, box.y), x2 = Math.min(face.x + face.w, box.x + box.w), y2 = Math.min(face.y + face.h, box.y + box.h);
  return x2 > x1 && y2 > y1 ? (x2 - x1) * (y2 - y1) / Math.max(0.0001, face.w * face.h) : 0;
}

/** Run Apple Vision and return the chosen time plus every component score. */
export async function scoreCoverFrames(workDir, plan, { fallbackMs = 50 } = {}) {
  const duration = Number(plan.video?.duration || 0), fps = Number(plan.video?.fps || plan.style?.render?.fps || 30);
  const hookEnd = Math.min(duration, Number(plan.hook?.start || 0) + Number(plan.hook?.duration || 3));
  const times = coverTimes(duration, { fps, hookEnd });
  const dir = ensureDir(path.join(path.resolve(workDir), "covers"));
  const bin = await personBinary();
  let person = null, personError = null;
  const detectionsPromise = detectFaces(plan.video.src, times);
  if (bin) {
    try {
      const { out } = await run(bin, [plan.video.src, ...times.map(String), "--out", path.join(dir, "person.png"), "--frame", path.join(dir, "vision-frame.png")], { capture: true });
      person = JSON.parse(out.slice(out.indexOf("{")));
    } catch (error) { personError = error; }
  }
  const detections = await detectionsPromise;
  if (!person && !detections?.frames?.length) throw new Error(personError ? String(personError.message).split("\n")[0] : "Apple Vision did not return candidate frames");
  if (personError) warn(`cover scoring: ${String(personError.message).split("\n")[0]}; using face geometry only`);
  const personByTime = new Map((person?.frames || []).map((frame) => [round(frame.t), frame]));
  const candidates = (detections?.frames?.length ? detections.frames : times.map((t) => ({ t, faces: [] }))).map((det) => {
    const measured = personByTime.get(round(det.t)) || {};
    const faces = det.faces || [];
    const face = measured.face?.w ? measured.face : largestFace(faces);
    const centre = face ? { cx: face.x + face.w / 2, cy: face.y + face.h / 2, w: face.w, h: face.h } : null;
    const guarded = headBoxFor(centre, { frames: [det] });
    const head = guarded ? { x: guarded.cx - guarded.w / 2, y: guarded.cy - guarded.h / 2, w: guarded.w, h: guarded.h } : face;
    return { t: det.t, faces, face, head, parts: measured.parts || {}, hookOverlap: faceOverlapWithHook(head, plan, det.t) };
  });
  for (const frame of person?.frames || []) if (!candidates.some((candidate) => Math.abs(candidate.t - frame.t) < 0.001)) candidates.push({ ...frame, faces: frame.face?.w ? [frame.face] : [] });
  let editCuts = [];
  try {
    const segments = readJSON(path.join(workDir, "cuts.json")).segments || [];
    let at = 0;
    for (let i = 0; i < segments.length - 1; i++) {
      at += Number(segments[i].end) - Number(segments[i].start);
      if (Number(segments[i + 1].start) > Number(segments[i].end)) editCuts.push({ t: at });
    }
  } catch {}
  const ranked = scoreFrameCandidates(candidates, {
    duration, hookEnd, broll: plan.broll || [], cuts: [...editCuts, ...(plan.zooms || []).filter((zoom) => zoom.cut)],
    hookBehind: !!plan.behind || !!plan.style?.hook?.behind, cutPad: 4 / fps,
  });
  const best = ranked[0];
  if (!best) return { frameTimeMs: fallbackMs, scores: { total: 0 }, ranked: [] };
  log(`cover: scored frame ${best.frameTimeMs}ms (eyes ${best.scores.eyesOpen.toFixed(2)}, face ${best.scores.faceSize.toFixed(2)}, grid ${best.scores.gridCenter.toFixed(2)}, sharp ${best.scores.sharpness.toFixed(2)})`);
  return { frameTimeMs: best.frameTimeMs, scores: best.scores, face: best.face, head: best.head, faces: best.faces || [], ranked };
}

function target(targetSpec) {
  const found = typeof targetSpec === "string" ? COVER_TARGETS.find((item) => item.id === targetSpec) : targetSpec;
  if (!found) throw new Error(`unknown cover target: ${targetSpec}`);
  return found;
}

function unionBox(boxes = []) {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w)), y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

function fitPhoto({ panel, focal, source = { width: 1080, height: 1920 }, contain = false }) {
  const scale = (contain ? Math.min : Math.max)(panel.w / source.width, panel.h / source.height);
  const w = source.width * scale, h = source.height * scale;
  const f = focal || { x: 0.25, y: 0.18, w: 0.5, h: 0.36 };
  let x = panel.x + panel.w / 2 - (f.x + f.w / 2) * w;
  let y = panel.y + panel.h / 2 - (f.y + f.h / 2) * h;
  if (!contain) {
    x = Math.min(panel.x, Math.max(panel.x + panel.w - w, x));
    y = Math.min(panel.y, Math.max(panel.y + panel.h - h, y));
  } else {
    x = panel.x + (panel.w - w) / 2;
    y = panel.y + (panel.h - h) / 2;
  }
  const image = { x: round(x), y: round(y), w: round(w), h: round(h) };
  const mapBox = (box) => box ? { x: round(x + box.x * w), y: round(y + box.y * h), w: round(box.w * w), h: round(box.h * h) } : null;
  return { image, faceBox: mapBox(focal), mapBox };
}

function chooseTitleBox({ W, H, faceBox, height, prefer = "bottom", wide = false, margin }) {
  const gap = Math.max(16, margin * 0.3), fullW = W - 2 * margin;
  const candidates = wide ? [
    { x: margin, y: margin, w: W * 0.4 - margin * 1.5, h: H - 2 * margin },
    { x: W * 0.6 + margin * 0.5, y: margin, w: W * 0.4 - margin * 1.5, h: H - 2 * margin },
  ] : [
    { x: margin, y: H - margin - height, w: fullW, h: height, at: "bottom" },
    { x: margin, y: margin, w: fullW, h: height, at: "top" },
  ];
  if (prefer === "top" && !wide) candidates.reverse();
  return candidates.find((box) => !overlap(box, faceBox, gap)) || candidates[0];
}

/** Geometry shared by HTML generation and crop QA. */
export function coverLayout({ template = "native-premise", target: targetSpec = "reel", face = null, head = null, faces = [], brand = null, title = "" } = {}) {
  const t = target(targetSpec), W = t.width, H = t.height;
  const tokens = resolveBrandTokens({ brand });
  const margin = Math.max(Math.round(tokens.spacing.xl * W / 1080), Math.round(W * 0.071));
  const wide = W / H > 1.2;
  let panel = { x: 0, y: 0, w: W, h: H };
  if (wide && template === "proof-reaction") panel = { x: Math.round(W * 0.56), y: 0, w: Math.round(W * 0.44), h: H };
  const sourceFocal = unionBox((faces || []).length > 1 && template === "interview" ? faces : [face].filter(Boolean)) || face;
  // Non-9:16 targets keep the whole photographed scene over a quiet blurred fill. That makes the same detected
  // face and title verifiably fit 3:4, 4:5, square and landscape instead of trusting a blind centre crop.
  let photo = fitPhoto({ panel, focal: sourceFocal, contain: template === "interview" || wide || t.id !== "reel" });
  if (sourceFocal && !inside(photo.faceBox, W, H, Math.min(12, margin / 4))) photo = fitPhoto({ panel, focal: sourceFocal, contain: true });
  const avoidBox = photo.mapBox(head) || photo.faceBox;
  const typeBase = Number(tokens.typeScale.display || 112) * (wide ? 1.15 : 1);
  const desiredH = template === "editorial" ? Math.min(H * 0.42, typeBase * 4.4) : Math.min(H * 0.34, typeBase * 3.5);
  let titleBox = chooseTitleBox({ W, H, faceBox: avoidBox, height: desiredH, prefer: template === "editorial" ? "top" : "bottom", wide, margin });
  let proofBox = null;
  if (template === "interview") titleBox = chooseTitleBox({ W, H, faceBox: avoidBox, height: Math.min(H * 0.25, desiredH), prefer: "bottom", wide: false, margin });
  if (template === "proof-reaction") {
    proofBox = wide
      ? { x: margin, y: margin, w: Math.round(W * 0.5) - margin * 1.4, h: H - 2 * margin }
      : chooseTitleBox({ W, H, faceBox: avoidBox, height: Math.min(H * 0.48, desiredH * 1.5), prefer: "top", wide: false, margin });
    titleBox = { ...proofBox };
  }
  if (avoidBox && overlap(titleBox, avoidBox, Math.max(16, margin * 0.3))) {
    const gap = Math.max(16, margin * 0.3), fullW = W - 2 * margin;
    const clear = [
      { x: margin, y: margin, w: fullW, h: avoidBox.y - gap - margin },
      { x: margin, y: avoidBox.y + avoidBox.h + gap, w: fullW, h: H - margin - avoidBox.y - avoidBox.h - gap },
    ].filter((box) => box.h >= Math.max(180, H * 0.18)).sort((a, b) => b.h - a.h)[0];
    if (clear) { titleBox = clear; if (template === "proof-reaction") proofBox = clear; }
  }
  const maxLines = template === "editorial" ? 5 : template === "native-premise" || template === "interview" ? 4 : 2;
  const lines = splitLines(title, maxLines);
  const cap = displayFont().cap;
  let fontPx = Math.round(typeBase / cap);
  const minPx = Math.max(48, Math.round(tokens.typeScale.lg || 54));
  while (fontPx > minPx && (Math.max(...lines.map((line) => lineWidthPx(line, fontPx * cap))) > titleBox.w || lines.length * fontPx * 1.08 > titleBox.h)) fontPx -= 2;
  return { target: t, margin, panel, image: photo.image, faceBox: photo.faceBox, headBox: avoidBox, titleBox, proofBox, lines, fontPx: Math.max(minPx, fontPx), wide };
}

/** Automated target check: title and detected face must remain wholly inside the delivered bitmap. */
export function checkCropBounds({ target: targetSpec, titleBox, faceBox }) {
  const t = target(targetSpec), issues = [];
  if (!inside(titleBox, t.width, t.height)) issues.push("title outside crop");
  if (faceBox && !inside(faceBox, t.width, t.height)) issues.push("face outside crop");
  if (titleBox && faceBox && overlap(titleBox, faceBox, Math.round(t.width * 0.012))) issues.push("title overlaps face");
  return { ok: issues.length === 0, issues, target: t.id };
}

function markedTitle(lines) {
  return lines.map((line) => `<div class="title-line">${esc(line).replace(/\*([^*]+)\*/g, '<span class="k">$1</span>')}</div>`).join("");
}

function proofText(proof) {
  if (!proof) return "";
  const label = clean(proof.eyebrow || proof.context || proof.headline || proof.title);
  const items = (proof.items || []).map((item) => clean(item.text || item.value)).filter(Boolean).slice(0, 4);
  const outcome = clean(proof.outcome?.text || proof.outcome?.value || proof.outcome);
  return `<div class="proof-label">${esc(label)}</div>${items.map((item) => `<div class="proof-item">${esc(item)}</div>`).join("")}${outcome ? `<div class="proof-outcome">${esc(outcome)}</div>` : ""}`;
}

/** One of the five cover archetypes. All visual roles are CSS variables emitted by tokensCSS(). */
export function archetypeHTML({ template = "native-premise", target: targetSpec = "reel", frame = "assets/frame.png", face = null, head = null, faces = [], title = "", brand = null, proof = null } = {}) {
  const tokens = resolveBrandTokens({ brand });
  const layout = coverLayout({ template, target: targetSpec, face, head, faces, brand: tokens, title });
  const { width: W, height: H } = layout.target;
  const styleClass = template.replace(/[^a-z0-9]+/g, "-");
  const photo = `<img id="frame-back" src="${esc(frame)}" alt="" /><img id="frame" src="${esc(frame)}" alt="" />`;
  const content = template === "proof-reaction" ? `<div id="proof">${proofText(proof)}</div>` : `<div id="title">${markedTitle(layout.lines)}</div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${W}, height=${H}" /><title>cover</title>
<script src="assets/vendor/gsap.min.js"></script>
<style>
${tokensCSS(tokens)}
html, body { margin: 0; background: var(--brand-surface); }
#root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--brand-surface); color: var(--brand-ink); }
#frame-back { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(calc(var(--space-sm) * .7)) brightness(.62); transform: scale(1.04); }
#frame { position: absolute; left: ${layout.image.x}px; top: ${layout.image.y}px; width: ${layout.image.w}px; height: ${layout.image.h}px; filter: brightness(.86) saturate(.94); }
#root::after { content: ""; position: absolute; inset: 0; background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--brand-surface) 56%, transparent)); opacity: calc(var(--brand-grain) + .38); pointer-events: none; }
#title, #proof { position: absolute; z-index: 2; left: ${layout.titleBox.x}px; top: ${layout.titleBox.y}px; width: ${layout.titleBox.w}px; min-height: ${layout.titleBox.h}px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; font-family: var(--brand-display-font); font-weight: var(--brand-display-weight); font-size: ${layout.fontPx}px; line-height: var(--brand-display-line-height); letter-spacing: var(--brand-display-tracking); text-transform: var(--brand-display-case); color: var(--brand-ink); }
.native-premise #title, .interview #title { padding: var(--space-md) var(--space-lg); background: color-mix(in srgb, var(--brand-surface) 82%, transparent); border-inline-start: max(2px, calc(var(--space-xs) / 2)) solid var(--brand-accent); border-radius: var(--brand-radius); }
.verdict #title { text-align: center; }
.editorial #title { font-family: var(--brand-editorial-font, var(--brand-display-font)); font-weight: var(--brand-editorial-weight, var(--brand-display-weight)); line-height: var(--brand-editorial-line-height, var(--brand-display-line-height)); text-transform: var(--brand-editorial-case, var(--brand-display-case)); padding: var(--space-lg); background: color-mix(in srgb, var(--brand-paper) 88%, transparent); color: var(--brand-surface); border-radius: var(--brand-radius-sm); }
.k { color: var(--brand-accent); }
#proof { padding: var(--space-lg); gap: var(--space-sm); background: color-mix(in srgb, var(--brand-paper) 94%, transparent); color: var(--brand-surface); border: max(2px, calc(var(--space-xs) / 2)) solid var(--brand-accent); border-radius: var(--brand-radius); font-family: var(--brand-body-font); text-transform: var(--brand-body-case); font-size: max(48px, var(--type-lg)); line-height: var(--brand-body-line-height); }
.proof-label { font-family: var(--brand-display-font); color: var(--brand-accent); }
.proof-item, .proof-outcome { padding-block: var(--space-xs); border-block-end: 1px solid var(--brand-muted); }
[data-slot="signature"] { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
${signatureRulesCSS()}
</style></head>
<body><div id="root" class="${styleClass}" data-composition-id="cover" data-start="0" data-width="${W}" data-height="${H}" data-duration="1" data-fps="30">
  ${photo}${content}<div data-slot="signature">${signatureHTML(tokens, { format: W > H ? "thumbnail" : "cover", width: W, height: H, head })}</div>
</div><script>window.__timelines = window.__timelines || {}; window.__timelines.cover = gsap.timeline({ paused: true });</script></body></html>`;
}

/** Compatibility wrapper: old callers get a brand-token verdict cover rather than a hard-coded palette skin. */
export function coverHTML({ W = 1080, H = 1920, frame, face, title, brand = null, palette = null, style = "outline" }) {
  const tokens = brand || resolveBrandTokens({ preset: { colors: palette ? { text: palette.accent2, accent: palette.accent, bg: palette.bg, stroke: palette.bg2 } : {} } });
  const targetSpec = COVER_TARGETS.find((item) => item.width === W && item.height === H) || { id: "custom", width: W, height: H };
  return archetypeHTML({ template: style === "whitebox" ? "editorial" : "verdict", target: targetSpec, frame, face, title, brand: tokens });
}

export function proofFromPlan(plan) {
  return (plan.graphics || []).find((graphic) => graphic.informationRole === "proof" || graphic.mode === "proof" || graphic.type === "message" || graphic.skin === "receipt" || graphic.look === "receipts") || null;
}

export function chooseArchetypes(plan, selection, { variants = 3 } = {}) {
  const proof = proofFromPlan(plan), people = Math.max(selection.faces?.length || 0, ...(selection.ranked || []).map((candidate) => candidate.faces?.length || 0));
  const calm = plan.style?.brand?.motion?.personality === "calm";
  const ordered = [proof ? "proof-reaction" : null, people >= 2 ? "interview" : null, "native-premise", calm || (selection.face?.h || 0) < 0.12 ? "editorial" : "verdict", calm ? "verdict" : "editorial"].filter(Boolean);
  return [...new Set(ordered)].slice(0, Math.max(1, variants));
}

export function makeCoverManifest({ variantId, template, frameTimeMs, title, targets = COVER_TARGETS.map((item) => item.id), focalBox = null, brand = null, scores = null, variants = null }) {
  const tokens = resolveBrandTokens({ brand });
  return {
    variantId: String(variantId), template: String(template), frameTimeMs: Math.max(0, Math.round(frameTimeMs)),
    title: clean(title).replace(/\*/g, ""), targets: [...targets],
    focalBox: focalBox ? Object.fromEntries(["x", "y", "w", "h"].map((key) => [key, round(Number(focalBox[key] || 0))])) : null,
    brand: tokens.identity?.handle || tokens.identity?.name || "",
    ...(scores ? { scores } : {}), ...(variants ? { variants } : {}),
  };
}

function fontSource(file) {
  if (!file) return null;
  if (path.isAbsolute(file)) return file;
  return [path.resolve(PKG_ROOT, file), path.resolve(file)].find((candidate) => fs.existsSync(candidate)) || null;
}

function prepareCoverAssets(dir, plan, tokens) {
  const assets = ensureDir(path.join(dir, "assets")), fonts = ensureDir(path.join(assets, "fonts")), vendor = ensureDir(path.join(assets, "vendor"));
  const local = structuredClone(tokens);
  for (const role of ["display", "body", "editorial", "mono"]) {
    const spec = local.type?.[role];
    let source = fontSource(spec?.file);
    if (!source && role === "display") { try { source = fontFile(plan.style, "Anton-Regular.ttf"); } catch {} }
    if (!source || !fs.existsSync(source)) continue;
    const name = `${role}${path.extname(source) || ".ttf"}`;
    fs.copyFileSync(source, path.join(fonts, name));
    spec.file = `assets/fonts/${name}`;
  }
  fs.copyFileSync(path.join(PKG_ROOT, "assets", "vendor", "gsap.min.js"), path.join(vendor, "gsap.min.js"));
  return local;
}

async function extractFrame(video, frameTimeMs, out) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(frameTimeMs / 1000), "-i", video, "-frames:v", "1", out], { quiet: true });
}

async function snapshotProject(projectDir, out) {
  const shots = ensureDir(path.join(projectDir, "shots"));
  for (const file of fs.readdirSync(shots)) fs.rmSync(path.join(shots, file), { force: true });
  const bin = hyperframesBin();
  await run(bin[0], [...bin.slice(1), "snapshot", projectDir, "--at", "0.5", "--no-end", "--keep", "-o", shots, "--describe", "false"], { capture: true, env: renderEnv() });
  const shot = path.join(shots, "at-0.5s.png");
  if (!fs.existsSync(shot)) throw new Error("snapshot missing");
  fs.copyFileSync(shot, out);
}

function targetsFor(plan) {
  const wanted = plan.style?.cover?.targets;
  const selected = Array.isArray(wanted) ? COVER_TARGETS.filter((item) => item.id === "reel" || wanted.includes(item.id)) : COVER_TARGETS;
  return selected.length ? selected : COVER_TARGETS;
}

async function renderArchetypeTargets(dir, variant, { tokens, proof, targets = COVER_TARGETS }) {
  const outDir = ensureDir(path.join(dir, variant.variantId));
  const outputs = {};
  for (const targetSpec of targets) {
    const layout = coverLayout({ template: variant.template, target: targetSpec, face: variant.face, head: variant.head, faces: variant.faces, brand: tokens, title: variant.title });
    const check = checkCropBounds({ target: targetSpec, titleBox: layout.titleBox, faceBox: layout.faceBox });
    if (!check.ok) throw new Error(`${targetSpec.id}: ${check.issues.join(", ")}`);
    const project = ensureDir(path.join(outDir, `${targetSpec.id}-project`));
    const link = path.join(project, "assets");
    fs.rmSync(link, { recursive: true, force: true });
    fs.symlinkSync(path.join(dir, "assets"), link);
    fs.writeFileSync(path.join(project, "index.html"), archetypeHTML({ template: variant.template, target: targetSpec, frame: "assets/frame.png", face: variant.face, head: variant.head, faces: variant.faces, title: variant.title, brand: tokens, proof }));
    const out = path.join(outDir, `${targetSpec.id}.png`);
    await snapshotProject(project, out);
    outputs[targetSpec.id] = out;
  }
  return outputs;
}

function historyPath(workDir) {
  const shared = process.env.REEL_WATCH_DONE && path.join(process.env.REEL_WATCH_DONE, "covers", "history.json");
  if (shared) { try { ensureDir(path.dirname(shared)); fs.accessSync(path.dirname(shared), fs.constants.W_OK); return shared; } catch {} }
  return path.join(workDir, "covers", "history.json");
}

async function gridPreview(workDir, current, entry, brand) {
  const file = historyPath(workDir);
  let history = [];
  try { history = readJSON(file).history || []; } catch {}
  const prior = history.map((item) => item.grid).filter((item) => item && fs.existsSync(item)).slice(-8);
  const images = [current, ...prior.reverse()].slice(0, 9);
  const args = ["-y", "-loglevel", "error"];
  for (const image of images) args.push("-i", image);
  const filters = images.map((_, i) => `[${i}:v]scale=360:480:force_original_aspect_ratio=increase,crop=360:480,format=rgba[t${i}]`);
  for (let i = images.length; i < 9; i++) filters.push(`color=c=${brand.colors.surface}:s=360x480,format=rgba[t${i}]`);
  filters.push(`${Array.from({ length: 9 }, (_, i) => `[t${i}]`).join("")}xstack=inputs=9:layout=0_0|360_0|720_0|0_480|360_480|720_480|0_960|360_960|720_960[out]`);
  const preview = path.join(workDir, "covers", "grid-preview.png");
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-frames:v", "1", preview);
  await run("ffmpeg", args, { quiet: true });
  history.push({ ...entry, grid: path.resolve(current) });
  writeJSON(file, { history: history.slice(-30) });
  return preview;
}

function titleForTemplate(template, titles, plan, proof) {
  const hook = clean(plan.hook?.text || plan.name);
  if (template === "proof-reaction") return clean(proof?.context || proof?.headline || proof?.title || hook);
  if (template === "native-premise" || template === "interview" || template === "editorial") return hook;
  return titles[0]?.title || hook;
}

function frameForTemplate(template, ranked, index, proof) {
  if (template === "interview") return ranked.find((candidate) => (candidate.faces || []).length >= 2) || ranked[index % ranked.length];
  if (template === "proof-reaction" && Number.isFinite(proof?.start)) {
    return [...ranked].sort((a, b) => Math.abs(a.t - proof.start) - Math.abs(b.t - proof.start) || b.scores.total - a.scores.total)[0];
  }
  if (template === "verdict") return [...ranked].sort((a, b) => ((b.scores.eyesOpen || 0) + (b.scores.faceSize || 0)) - ((a.scores.eyesOpen || 0) + (a.scores.faceSize || 0)) || b.scores.total - a.scores.total)[0];
  if (template === "editorial") return [...ranked].sort((a, b) => ((b.scores.sharpness || 0) + (b.scores.promise || 0)) - ((a.scores.sharpness || 0) + (a.scores.promise || 0)) || (a.t || 0) - (b.t || 0))[0];
  return ranked[index % ranked.length];
}

/** Make Cover 1-3 and every crop. The old `reel cover` command still calls this function. */
export async function makeCover(workDir, plan, { handle = "", variants = 3, voice = "", selection = null } = {}) {
  workDir = path.resolve(workDir);
  const dir = ensureDir(path.join(workDir, "covers"));
  let tokens = plan.style?.brand || resolveBrandTokens({ preset: plan.style || {} });
  useDisplayFont(fontSource(tokens.type?.display?.file) || fontFile(plan.style, "Anton-Regular.ttf"));
  if (!selection) {
    const fallbackMs = Math.round((plan.style?.cover?.at ?? 0.05) * 1000);
    selection = plan.style?.cover?.scoreFrames === false
      ? { frameTimeMs: fallbackMs, scores: { total: 0 }, face: null, faces: [], ranked: [] }
      : await scoreCoverFrames(workDir, plan, { fallbackMs });
  }
  const transcript = (plan.captions || []).map((group) => group.text).join(" ");
  let titles = [];
  const titlesPath = path.join(dir, "titles.json");
  try { titles = normalizeTitles(readJSON(titlesPath).titles || [], { hook: plan.hook?.text, brand: tokens }); } catch {}
  if (titles.filter(titleFits).length < 3 && hasClaude() && transcript) {
    try {
      const reply = await claudeText(titlePrompt({ transcript, hook: plan.hook?.text, voice, brand: tokens }), { timeoutMs: 120000 });
      titles = normalizeTitles(firstJSON(reply).titles, { hook: plan.hook?.text, brand: tokens });
    } catch (error) { warn(`cover titles: ${String(error.message).split("\n")[0]}; using the hook`); }
  }
  if (!titles.length) titles = normalizeTitles([], { hook: plan.hook?.text || plan.name, brand: tokens });
  writeJSON(titlesPath, { titles });
  tokens = prepareCoverAssets(dir, plan, tokens);
  const proof = proofFromPlan(plan), templates = chooseArchetypes(plan, selection, { variants }), coverTargets = targetsFor(plan);
  const ranked = selection.ranked?.length ? selection.ranked : [selection];
  const built = [];
  for (let i = 0; i < templates.length; i++) {
    const template = templates[i], candidate = frameForTemplate(template, ranked, i, proof), variantId = `${template}-v1`;
    const frame = path.join(dir, "assets", "frame.png");
    try {
      await extractFrame(plan.video.src, candidate.frameTimeMs, frame);
      const item = { variantId, template, frameTimeMs: candidate.frameTimeMs, scores: candidate.scores, face: candidate.face, head: candidate.head, faces: candidate.faces || [], title: titleForTemplate(template, titles.slice(i).concat(titles), plan, proof) };
      const outputs = await renderArchetypeTargets(dir, item, { tokens, proof, targets: coverTargets });
      if (!outputs.reel) throw new Error("the reel target is required for Cover 1-3");
      const numbered = path.join(dir, `Cover ${i + 1}.png`);
      fs.copyFileSync(outputs.reel, numbered);
      built.push({ ...item, outputs, path: numbered });
      log(`cover ${i + 1}: ${template}, ${candidate.frameTimeMs}ms, "${item.title.replace(/\*/g, "")}"`);
    } catch (error) { warn(`cover ${i + 1}: ${String(error.message).split("\n")[0]}; keeping the other covers`); }
  }
  if (!built.length) return [];
  fs.copyFileSync(built[0].outputs.reel, path.join(workDir, "cover.png"));
  const targetIds = coverTargets.map((item) => item.id);
  const manifest = makeCoverManifest({ ...built[0], targets: targetIds, focalBox: built[0].face, brand: tokens, variants: built.map((item) => makeCoverManifest({ ...item, targets: targetIds, focalBox: item.face, brand: tokens })) });
  writeJSON(path.join(dir, "manifest.json"), manifest);
  try { if (plan.style?.cover?.gridPreview !== false && built[0].outputs["grid-3x4"]) await gridPreview(workDir, built[0].outputs["grid-3x4"], { variantId: built[0].variantId, template: built[0].template }, tokens); }
  catch (error) { warn(`cover grid preview: ${String(error.message).split("\n")[0]}; covers are still ready`); }
  plan.cover = { style: "archetypes", frameTimeMs: built[0].frameTimeMs, scores: built[0].scores, variantId: built[0].variantId };
  writeJSON(path.join(workDir, "plan.json"), plan);
  return built.map((item) => item.path);
}

/** Multi-crop export for cover.style=frame, from the scored rendered frame. */
export async function makeFrameCover(workDir, output, plan, selection) {
  workDir = path.resolve(workDir);
  const dir = ensureDir(path.join(workDir, "covers"));
  const master = path.join(dir, "frame-master.png");
  const hookEndMs = Math.round((Number(plan.hook?.start || 0) + Number(plan.hook?.duration || 0)) * 1000);
  // A rendered hook-behind frame is never a cover. On a very short reel where no later frame exists, keep the
  // scored photography and omit the composited hook rather than hiding title glyphs behind the head.
  const source = (plan.behind || plan.style?.hook?.behind) && selection.frameTimeMs <= hookEndMs ? plan.video.src : output;
  await extractFrame(source, selection.frameTimeMs, master);
  const outputs = {};
  const coverTargets = targetsFor(plan);
  for (const targetSpec of coverTargets) {
    const out = path.join(dir, `frame-${targetSpec.id}.png`);
    if (targetSpec.id === "reel") {
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", master, "-vf", "scale=1080:1920", "-frames:v", "1", out], { quiet: true });
    } else {
      // Keep the complete rendered title and detected face. A softly filled copy occupies the changed aspect ratio;
      // the full 9:16 frame sits above it, so a 3:4/square/landscape export never relies on a blind centre crop.
      const W = targetSpec.width, H = targetSpec.height;
      const filter = `[0:v]split=2[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[bg];[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[out]`;
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", master, "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", out], { quiet: true });
    }
    outputs[targetSpec.id] = out;
  }
  const png = path.join(dir, "Cover.png");
  fs.copyFileSync(outputs.reel, png);
  fs.copyFileSync(outputs.reel, path.join(workDir, "cover.png"));
  const manifest = makeCoverManifest({ variantId: "frame-v1", template: "frame", frameTimeMs: selection.frameTimeMs, title: plan.hook?.text || "", targets: coverTargets.map((item) => item.id), focalBox: selection.face, brand: plan.style.brand, scores: selection.scores });
  writeJSON(path.join(dir, "manifest.json"), manifest);
  try { if (plan.style?.cover?.gridPreview !== false && outputs["grid-3x4"]) await gridPreview(workDir, outputs["grid-3x4"], { variantId: "frame-v1", template: "frame" }, plan.style.brand); }
  catch (error) { warn(`cover grid preview: ${String(error.message).split("\n")[0]}; frame cover is still ready`); }
  log(`cover: scored frame ${selection.frameTimeMs}ms → ${png}`);
  return [png];
}
