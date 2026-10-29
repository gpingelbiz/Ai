import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeCutout } from "./behind.mjs";
import { firstExactLine } from "./graphics.mjs";
import { planWindowLayout } from "./layouts.mjs";
import { signatureSafeArea, titlePlate } from "./signature.mjs";
import { tokensCSS } from "./brandtokens.mjs";
import { esc } from "./text.mjs";
import { ensureDir, log, PKG_ROOT, r3, run, warn, writeJSON } from "./util.mjs";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".heic"]);
const POINTING_PHRASES = ["he sent me", "she sent me", "they sent me", "look at this", "this is the message", "i got this"];
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g;
const ADDRESS = /\b\d{1,6}\s+(?:[A-Z0-9.'-]+\s+){0,6}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Highway|Hwy)\b\.?/gi;
const DIGITS = /(?<!\d)(?:\d[\s-]?){8,19}(?!\d)/g;
const frame = (seconds, fps = 30) => r3(Math.round(seconds * fps) / fps);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const words = (text) => String(text || "").trim().split(/\s+/).filter(Boolean);

export function parseEvidenceSpec(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const pipe = raw.lastIndexOf("|");
  const left = pipe >= 0 ? raw.slice(0, pipe).trim() : raw;
  const label = pipe >= 0 ? raw.slice(pipe + 1).trim() : "";
  const timed = left.match(/@([0-9]+(?:\.[0-9]+)?)$/);
  const file = (timed ? left.slice(0, timed.index) : left).trim();
  if (!file) return null;
  return { file: path.resolve(file), at: timed ? Number(timed[1]) : null, label };
}

export function pairEvidenceFiles(clipName, fileNames = []) {
  const base = path.basename(String(clipName || ""), path.extname(String(clipName || "")));
  const key = base.split("__")[0].replace(/\s+#[^#]+$/g, "").trim().toLowerCase();
  return fileNames.filter((name) => {
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return false;
    const stem = path.basename(name, ext).toLowerCase();
    return stem.startsWith(`${key} proof`) || stem.startsWith(`${key} receipt`);
  }).sort((a, b) => a.localeCompare(b));
}

function boxOf(raw) {
  const box = raw?.box || raw?.boundingBox || raw;
  const x = Number(box?.x), y = Number(box?.y), w = Number(box?.w ?? box?.width), h = Number(box?.h ?? box?.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, 0, 1), h: clamp(h, 0, 1) };
}

export function parseOcrJSON(value) {
  const raw = typeof value === "string" ? JSON.parse(value.slice(value.indexOf("{"))) : value;
  if (!raw || !(Number(raw.width) > 0) || !(Number(raw.height) > 0)) throw new Error("OCR returned no image size");
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map((line) => ({
    text: String(line?.text || ""),
    confidence: clamp(Number(line?.confidence) || 0, 0, 1),
    box: boxOf(line),
    spans: (Array.isArray(line?.spans) ? line.spans : []).map((span) => ({ start: Number(span?.start), end: Number(span?.end), box: boxOf(span) })).filter((span) => Number.isInteger(span.start) && Number.isInteger(span.end) && span.end > span.start && span.box),
  })).filter((line) => line.text && line.box);
  const faces = (Array.isArray(raw.faces) ? raw.faces : []).map((face) => ({ confidence: clamp(Number(face?.confidence) || 0, 0, 1), box: boxOf(face) })).filter((face) => face.box);
  return { width: Number(raw.width), height: Number(raw.height), lines, faces };
}

function ranges(re, text, kind) {
  re.lastIndex = 0;
  return [...text.matchAll(re)].map((match) => ({ start: match.index, end: match.index + match[0].length, kind, value: match[0] }));
}

function literalRanges(text, values, kind) {
  const out = [];
  const lower = text.toLowerCase();
  for (const value of values) {
    const needle = String(value || "").trim().toLowerCase();
    if (!needle) continue;
    let at = 0;
    while ((at = lower.indexOf(needle, at)) >= 0) {
      const before = lower[at - 1], after = lower[at + needle.length];
      if ((!before || !/[\p{L}\p{N}_]/u.test(before)) && (!after || !/[\p{L}\p{N}_]/u.test(after))) out.push({ start: at, end: at + needle.length, kind, value: text.slice(at, at + needle.length) });
      at += Math.max(1, needle.length);
    }
  }
  return out;
}

function subtractProtected(hit, protectedRanges) {
  let parts = [{ start: hit.start, end: hit.end }];
  for (const keep of protectedRanges) {
    const next = [];
    for (const part of parts) {
      if (keep.end <= part.start || keep.start >= part.end) next.push(part);
      else {
        if (keep.start > part.start) next.push({ start: part.start, end: keep.start });
        if (keep.end < part.end) next.push({ start: keep.end, end: part.end });
      }
    }
    parts = next;
  }
  return parts.filter((part) => part.end > part.start).map((part) => ({ ...hit, ...part, value: hit.value.slice(part.start - hit.start, part.end - hit.start) }));
}

function rangeBox(line, hit, padding, width, height) {
  const exact = unionBoxes((line.spans || []).filter((span) => span.start < hit.end && span.end > hit.start).map((span) => span.box));
  if (exact) {
    const px = padding / width, py = padding / height;
    return { x: clamp(exact.x - px, 0, 1), y: clamp(exact.y - py, 0, 1), w: clamp(exact.w + 2 * px, 0, 1), h: clamp(exact.h + 2 * py, 0, 1) };
  }
  const n = Math.max(1, line.text.length);
  const x = line.box.x + line.box.w * hit.start / n;
  const w = line.box.w * Math.max(1, hit.end - hit.start) / n;
  const px = padding / width, py = padding / height;
  return { x: clamp(x - px, 0, 1), y: clamp(line.box.y - py, 0, 1), w: clamp(w + 2 * px, 0, 1), h: clamp(line.box.h + 2 * py, 0, 1) };
}

function masked(kind, value) {
  if (kind === "email") return "[email]";
  if (kind === "phone") return "[phone]";
  if (kind === "address") return "[address]";
  if (kind === "digits") return `[${String(value).replace(/\D/g, "").length}-digit number]`;
  return kind === "extra" ? "[extra word]" : `[${kind}]`;
}

/** Privacy matches are line-coordinate rectangles. Brand identity ranges are subtracted before any box is made. */
export function redactionsFor(ocr, { extraWords = [], identity = {}, padding = 0 } = {}) {
  const redactions = [];
  const protectedValues = [identity.handle, identity.name].filter(Boolean);
  for (const line of ocr.lines || []) {
    const keep = literalRanges(line.text, protectedValues, "identity");
    const raw = [
      ...ranges(EMAIL, line.text, "email"),
      ...ranges(PHONE, line.text, "phone"),
      ...ranges(ADDRESS, line.text, "address"),
      ...ranges(DIGITS, line.text, "digits"),
      ...literalRanges(line.text, extraWords, "extra"),
    ].sort((a, b) => (a.kind === "digits") - (b.kind === "digits") || a.start - b.start || b.end - a.end);
    const accepted = [];
    for (const hit of raw.flatMap((candidate) => subtractProtected(candidate, keep))) {
      if (accepted.some((prior) => hit.start < prior.end && hit.end > prior.start)) continue;
      accepted.push(hit);
      redactions.push({ what: hit.kind, match: masked(hit.kind, hit.value), box: rangeBox(line, hit, padding, ocr.width, ocr.height) });
    }
  }
  for (const face of ocr.faces || []) redactions.push({ what: "face", match: "[face]", box: face.box });
  return redactions;
}

function indexed(lines = []) {
  return lines.map((line, i) => ({ ...line, i: Number.isInteger(line?.i) ? line.i : i }));
}

function quotedMatches(ocrLines, transcript) {
  const matched = [];
  for (let i = 0; i < ocrLines.length; i++) {
    const text = ocrLines[i].text;
    let line = firstExactLine(transcript, text);
    if (line == null) {
      const tokens = words(text);
      outer: for (let size = Math.min(12, tokens.length); size >= 3; size--) {
        for (let start = 0; start <= tokens.length - size; start++) {
          line = firstExactLine(transcript, tokens.slice(start, start + size).join(" "));
          if (line != null) break outer;
        }
      }
    }
    if (line != null) matched.push({ ocr: i, line });
  }
  return matched;
}

export function evidenceTiming({ ocrLines = [], transcript = [], at = null, duration = Infinity, fps = 30 } = {}) {
  const lines = indexed(transcript);
  const byLine = new Map(lines.map((line) => [line.i, line]));
  const quoted = quotedMatches(ocrLines, lines).filter((match) => byLine.has(match.line));
  let start = quoted.length ? Math.min(...quoted.map((match) => Number(byLine.get(match.line).start))) : null;
  let reason = quoted.length ? "quoted text" : "";
  if (!Number.isFinite(start)) {
    const points = POINTING_PHRASES.map((phrase) => firstExactLine(lines, phrase)).filter((line) => line != null && byLine.has(line));
    if (points.length) { start = Number(byLine.get(Math.min(...points)).start); reason = "pointing phrase"; }
  }
  if (!Number.isFinite(start) && Number.isFinite(at)) { start = at; reason = "supplied time"; }
  if (!Number.isFinite(start)) return { skip: true, reason: "no OCR text matched the transcript, no pointing phrase was spoken, and no @seconds was supplied" };
  const readable = quoted.length ? quoted.map((match) => ocrLines[match.ocr]?.text).join(" ") : ocrLines.map((line) => line.text).join(" ");
  const hold = frame(clamp(3.5 + words(readable).length / 8, 3.5, 6), fps);
  start = frame(Math.max(0, start), fps);
  const end = frame(Math.min(duration, start + hold), fps);
  if (end - start < 1) return { skip: true, reason: "its grounded time is outside the reel" };
  return { start, duration: frame(end - start, fps), reason, quoted };
}

function unionBoxes(boxes) {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w)), bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: bottom - y };
}

function containBox(source, box) {
  const scale = Math.min(box.w / source.width, box.h / source.height);
  const w = source.width * scale, h = source.height * scale;
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w: Math.round(w), h: Math.round(h) };
}

export function renderedEvidenceTextPx(lines = [], imageBox, zoom = 1) {
  const sizes = lines.map((line) => line?.box?.h * imageBox.h * zoom).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return sizes.length ? r3(sizes[Math.floor(sizes.length / 2)]) : null;
}

export function chooseEvidenceLayout({ requested = "auto", quoted = [], cutoutAvailable = false, talkingHead = false } = {}) {
  if (["card", "focus", "over"].includes(requested)) {
    if (requested === "over" && !(cutoutAvailable && talkingHead)) return "card";
    return requested;
  }
  if (quoted.length) return "focus";
  if (cutoutAvailable && talkingHead) return "over";
  return "card";
}

export function ocrBinary() {
  if (process.platform !== "darwin") return Promise.resolve(null);
  const bin = path.join(process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "ocr");
  const src = path.join(PKG_ROOT, "scripts", "ocr.swift");
  try {
    if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
      ensureDir(path.dirname(bin));
      return run("swiftc", ["-O", "-o", bin, src], { capture: true }).then(() => bin).catch(() => null);
    }
    return Promise.resolve(bin);
  } catch { return Promise.resolve(null); }
}

async function pngSource(source, dir, index) {
  const ext = path.extname(source).toLowerCase();
  if (ext !== ".heic") return source;
  const out = path.join(dir, `${index}-converted.png`);
  await run("sips", ["-s", "format", "png", source, "--out", out], { capture: true });
  return out;
}

function focusGeometry(item, media, target, tokens) {
  const imageBox = containBox(item.ocr, media);
  const quotedBoxes = item.timing.quoted.map((match) => item.ocr.lines[match.ocr]?.box).filter(Boolean);
  const quote = unionBoxes(quotedBoxes);
  // Nothing quoted: the whole screenshot sits between its label and the caption band, so captions never land on
  // the screenshot's own text.
  if (!quote) return { imageBox: containBox(item.ocr, target), zoom: 1, x: 0, y: 0, quote: null };
  const padX = (tokens.spacing?.md || 0) / item.ocr.width, padY = (tokens.spacing?.md || 0) / item.ocr.height;
  const q = { x: clamp(quote.x - padX, 0, 1), y: clamp(quote.y - padY, 0, 1), w: clamp(quote.w + 2 * padX, 0.001, 1), h: clamp(quote.h + 2 * padY, 0.001, 1) };
  const natural = Math.max(1, Math.min(item.ocr.width / imageBox.w, item.ocr.height / imageBox.h));
  const zoom = r3(Math.max(1, Math.min(natural, target.w / (q.w * imageBox.w), target.h / (q.h * imageBox.h))));
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  const x = Math.round(cx - imageBox.x - zoom * (q.x + q.w / 2) * imageBox.w);
  const y = Math.round(cy - imageBox.y - zoom * (q.y + q.h / 2) * imageBox.h);
  return { imageBox, zoom, x, y, quote: q };
}

export function layoutGeometry(item, { W, H, captionTop, tokens, face, detection, framing, zoomScale }) {
  const plate = titlePlate(tokens, { format: "reel", width: W });
  const labelH = Math.max(48, Number(tokens.typeScale?.lg) || 48) + 2 * plate.paddingY + (["top", "bottom"].includes(plate.rulePosition) ? plate.ruleThickness : 0);
  if (item.layout === "card") {
    const fakeZooms = [{ t: item.start, scale: zoomScale }, { t: item.start + item.duration, scale: 1 }];
    const planned = planWindowLayout({ start: item.start, duration: item.duration }, { W, H, captionTop: captionTop / H, face, detection, zooms: fakeZooms, framing });
    if (planned.shot.layout !== "window") return { skip: true, reason: planned.skipped || "no face-safe evidence window fit" };
    const box = planned.shot.panel;
    const media = { x: box.x, y: box.y, w: box.w, h: Math.max(1, box.h - labelH) };
    return { box, media, labelBox: { x: box.x, y: box.y + media.h, w: box.w, h: labelH }, plate, imageBox: containBox(item.ocr, media) };
  }
  const box = { x: 0, y: 0, w: W, h: H };
  const media = { ...box };
  const labelBox = { x: 76, y: 200, w: Math.min(864, W - 152), h: labelH };
  const target = { x: 76, y: labelBox.y + labelBox.h + (Number(tokens.spacing?.sm) || 0), w: labelBox.w, h: Math.max(1, captionTop - labelBox.y - labelBox.h - (Number(tokens.spacing?.sm) || 0)) };
  const focus = focusGeometry(item, media, target, tokens);
  return { box, media, labelBox, plate, ...focus };
}

/** Resolve, OCR, redact, time and lay out real user-supplied images. Any failed item logs once and disappears. */
export async function makeEvidence({ specs = [], workDir, transcript = [], duration = 0, video, fps = 30, settings = {}, tokens, canvas, captionTop, face = null, detection = null, framing = {} } = {}) {
  if (settings.enabled === false || !specs.length) return [];
  if (settings.redact === false) warn("evidence: --no-redact exposes private text and faces; the supplied images will be rendered without automatic redaction");
  const bin = await ocrBinary();
  if (!bin) { warn("evidence: Apple Vision OCR is unavailable; rendering without supplied evidence"); return []; }
  const dir = ensureDir(path.join(workDir, "evidence"));
  const parsed = specs.map(parseEvidenceSpec).filter(Boolean);
  const extraWords = (Array.isArray(settings.extraWords) ? settings.extraWords : [settings.extraWords]).flatMap((value) => String(value || "").split(",")).map((value) => value.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < parsed.length; i++) {
    const input = parsed[i], n = i + 1;
    try {
      if (!fs.existsSync(input.file) || !IMAGE_EXTS.has(path.extname(input.file).toLowerCase())) throw new Error("source image is missing or not png, jpg, jpeg, or heic");
      const sourceFile = path.join(dir, `${n}-source${path.extname(input.file).toLowerCase()}`);
      fs.copyFileSync(input.file, sourceFile);
      const analyzable = await pngSource(sourceFile, dir, n);
      const result = await run(bin, [analyzable], { capture: true });
      const ocr = parseOcrJSON(result.out);
      const redactions = settings.redact === false ? [] : redactionsFor(ocr, { extraWords, identity: tokens.identity, padding: Number(tokens.spacing?.xs) || 0 });
      const cleanedFile = path.join(dir, `${n}-clean.png`);
      if (redactions.length) {
        const boxesFile = path.join(dir, `${n}-boxes.json`);
        writeJSON(boxesFile, redactions.map((item) => item.box));
        await run(bin, ["--redact", analyzable, boxesFile, cleanedFile, tokens.colors.surface, String(Number(tokens.radius?.sm) || 0)], { capture: true });
        fs.rmSync(boxesFile, { force: true });
      } else if (path.extname(analyzable).toLowerCase() === ".png") fs.copyFileSync(analyzable, cleanedFile);
      else await run("sips", ["-s", "format", "png", analyzable, "--out", cleanedFile], { capture: true });

      const timing = evidenceTiming({ ocrLines: ocr.lines, transcript, at: input.at, duration, fps });
      const recordFile = path.join(dir, `${n}.json`);
      const longDigitRuns = ocr.lines.some((line) => ranges(DIGITS, line.text, "digits").length > 0);
      const record = { schema: 1, source: sourceFile, cleaned: cleanedFile, width: ocr.width, height: ocr.height, ocr: ocr.lines, faces: ocr.faces, redactions, redactionDisabled: settings.redact === false, longDigitRuns };
      writeJSON(recordFile, record);
      if (timing.skip) { log(`evidence ${n}: skipped ${path.basename(input.file)} (${timing.reason})`); continue; }

      const requested = ["auto", "card", "focus", "over"].includes(settings.layout) ? settings.layout : "auto";
      let cutout = null;
      const talkingHead = !!face;
      const mayNeedCutout = (requested === "over" || (requested === "auto" && !timing.quoted.length)) && talkingHead;
      if (mayNeedCutout) {
        const made = await makeCutout({ video, start: timing.start, duration: timing.duration, fps, outDir: dir, name: `evidence-${n}` });
        if (!made.error) cutout = { file: made.src, start: made.start, duration: made.duration };
      }
      let layout = chooseEvidenceLayout({ requested, quoted: timing.quoted, cutoutAvailable: !!cutout, talkingHead });
      let item = { id: n, sourceFile, cleanedFile, recordFile, sourceName: path.basename(input.file), label: input.label || path.basename(input.file), ocr, timing, start: timing.start, duration: timing.duration, layout, cutout };
      let geometry = layoutGeometry(item, { W: canvas.width, H: canvas.height, captionTop, tokens, face, detection, framing, zoomScale: Math.max(1, ...(settings.zoomScales || [1])) });
      if (geometry.skip && timing.quoted.length) { layout = "focus"; item.layout = layout; item.cutout = null; geometry = layoutGeometry(item, { W: canvas.width, H: canvas.height, captionTop, tokens, face, detection, framing, zoomScale: 1 }); }
      if (geometry.skip) { log(`evidence ${n}: skipped ${path.basename(input.file)} (${geometry.reason})`); continue; }
      const quotedLines = timing.quoted.map((match) => ocr.lines[match.ocr]).filter(Boolean);
      const legibilityLines = quotedLines.length ? quotedLines : ocr.lines;
      let textPx = renderedEvidenceTextPx(legibilityLines, geometry.imageBox, layout === "focus" ? geometry.zoom : 1);
      if (textPx != null && textPx < 32 && layout !== "focus" && timing.quoted.length) {
        item.layout = layout = "focus"; item.cutout = null;
        geometry = layoutGeometry(item, { W: canvas.width, H: canvas.height, captionTop, tokens, face, detection, framing, zoomScale: 1 });
        textPx = renderedEvidenceTextPx(quotedLines, geometry.imageBox, geometry.zoom);
      }
      if (textPx != null && textPx < 32) { log(`evidence ${n}: skipped ${path.basename(input.file)} (source text would render at ${Math.round(textPx)}px, below 32px)`); continue; }
      const enter = frame((Number(tokens.motion?.enterMs) || 0) / 1000, fps), exit = frame((Number(tokens.motion?.exitMs) || 0) / 1000, fps);
      item = { ...item, layout, ...geometry, textPx, highlights: timing.quoted.map((match) => ocr.lines[match.ocr]?.box).filter(Boolean), motion: { enter, exit, enterEase: tokens.motion?.enterEase || "none", exitEase: tokens.motion?.exitEase || "none", slide: Number(tokens.spacing?.md) || 0, zoomStart: frame(timing.start + enter, fps), zoomDuration: frame(Math.max(1 / fps, timing.duration - enter - exit), fps) } };
      out.push(item);
      log(`evidence ${n}: ${path.basename(input.file)} → ${layout} at ${item.start}s for ${item.duration}s; OCR ${ocr.lines.length} line${ocr.lines.length === 1 ? "" : "s"}, ${redactions.length} redaction${redactions.length === 1 ? "" : "s"}`);
    } catch (error) {
      warn(`evidence ${n}: ${path.basename(input.file)} skipped (${String(error.message).split("\n")[0]})`);
    }
  }
  return out;
}

const styleBox = (box) => `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
const highlightHTML = (item) => (item.highlights || []).map((box) => `<span class="evidence-highlight" style="left:${r3(box.x * 100)}%;top:${r3(box.y * 100)}%;width:${r3(box.w * 100)}%;height:${r3(box.h * 100)}%"></span>`).join("");

export function evidenceHTML(item, index = 0) {
  const localImage = { ...item.imageBox, x: item.imageBox.x - item.media.x, y: item.imageBox.y - item.media.y };
  const doc = `<div class="evidence-document" style="${styleBox(localImage)}"><img src="${esc(item.src || item.cleanedFile)}" alt=""><div class="evidence-highlights">${highlightHTML(item)}</div></div>`;
  const person = item.layout === "over" && item.cutout?.src ? `<div class="evidence-person-wrap evidence-person-${esc(item.personSide || "right")}"><video class="clip evidence-person" src="${esc(item.cutout.src)}" data-start="${item.cutout.start}" data-duration="${item.cutout.duration}" data-track-index="4" muted playsinline></video></div>` : "";
  const plate = item.plate || { radius: 0, paddingX: 0, paddingY: 0, rulePosition: "left", ruleThickness: 1 };
  const plateVars = `;--evidence-radius:${plate.radius}px;--evidence-pad-x:${plate.paddingX}px;--evidence-pad-y:${plate.paddingY}px;--evidence-rule:${plate.ruleThickness}px`;
  return `<div id="evidence-${index}" class="evidence evidence-${esc(item.layout)} clip" data-start="${item.start}" data-duration="${item.duration}" data-track-index="3" data-layout-allow-overflow><div class="evidence-frame" style="${styleBox(item.box)}"><div class="evidence-viewport" style="${styleBox({ x: item.media.x - item.box.x, y: item.media.y - item.box.y, w: item.media.w, h: item.media.h })}">${doc}</div><div class="evidence-label evidence-rule-${esc(plate.rulePosition)}" style="${styleBox({ x: item.labelBox.x - item.box.x, y: item.labelBox.y - item.box.y, w: item.labelBox.w, h: item.labelBox.h })}${plateVars}">${esc(item.label)}</div></div>${person}</div>`;
}

export function evidenceCSS(tokens) {
  const role = Object.hasOwn(tokens.colors || {}, tokens.signature?.colorRole) ? tokens.signature.colorRole : "accent";
  return `${tokensCSS(tokens)}
      .evidence { position:absolute; inset:0; opacity:0; pointer-events:none; }
      .evidence-frame { position:absolute; overflow:hidden; box-sizing:border-box; background:var(--brand-surface); border:calc(var(--space-xs) / 4) solid var(--brand-stroke); border-radius:var(--brand-radius-md); }
      .evidence-focus .evidence-frame, .evidence-over .evidence-frame { border:0; border-radius:0; }
      .evidence-viewport { position:absolute; overflow:hidden; background:var(--brand-surface); }
      .evidence-document { position:absolute; transform-origin:0 0; will-change:transform; }
      .evidence-document img { position:absolute; inset:0; width:100%; height:100%; object-fit:fill; }
      .evidence-highlights { position:absolute; inset:0; }
      .evidence-highlight { position:absolute; box-sizing:border-box; opacity:0; background:color-mix(in srgb, var(--brand-accent), transparent); outline:calc(var(--space-xs) / 2) solid var(--brand-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}); border-radius:var(--brand-radius-sm); }
      .evidence-label { position:absolute; display:flex; align-items:center; box-sizing:border-box; padding:var(--evidence-pad-y) var(--evidence-pad-x); overflow:hidden; color:var(--brand-ink); background:var(--brand-surface2); border-radius:var(--evidence-radius); font-family:var(--brand-body-font); font-size:max(48px, var(--type-lg)); font-weight:var(--brand-body-weight); line-height:var(--brand-body-line-height); text-transform:var(--brand-body-case); white-space:nowrap; }
      .evidence-rule-top { border-top:var(--evidence-rule) solid var(--brand-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}); }
      .evidence-rule-right { border-right:var(--evidence-rule) solid var(--brand-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}); }
      .evidence-rule-bottom { border-bottom:var(--evidence-rule) solid var(--brand-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}); }
      .evidence-rule-left { border-left:var(--evidence-rule) solid var(--brand-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}); }
      .evidence-person-wrap { position:absolute; inset:0; transform-origin:100% 100%; }
      .evidence-person-left { transform-origin:0 100%; }
      .evidence-person { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; filter:drop-shadow(calc(var(--space-xs) / 2) 0 0 var(--brand-ink)) drop-shadow(0 var(--space-md) var(--space-lg) var(--brand-stroke)); }
  `;
}

export const EVIDENCE_JS = `
        PLAN.evidence.forEach((item, i) => {
          const root = document.getElementById("evidence-" + i);
          const frameEl = root.querySelector(".evidence-frame");
          const doc = root.querySelector(".evidence-document");
          const outAt = item.start + item.duration - item.exit;
          tl.set(root, { opacity: 1 }, item.start);
          tl.fromTo(frameEl, { opacity: 0, y: item.slide }, { opacity: 1, y: 0, duration: item.enter, ease: item.enterEase, immediateRender: false }, item.start);
          if (item.layout === "focus" && item.zoom > 1) tl.to(doc, { scale: item.zoom, x: item.x, y: item.y, duration: item.zoomDuration, ease: item.enterEase }, item.zoomStart);
          root.querySelectorAll(".evidence-highlight").forEach((mark) => tl.fromTo(mark, { opacity: 0 }, { opacity: 1, duration: item.enter, ease: item.enterEase, immediateRender: false }, item.zoomStart));
          const person = root.querySelector(".evidence-person-wrap");
          if (person) tl.fromTo(person, { opacity: 0, scale: 0.56, y: item.slide }, { opacity: 1, scale: 0.56, y: 0, duration: item.enter, ease: item.enterEase, immediateRender: false }, item.start);
          tl.to(root, { opacity: 0, duration: item.exit, ease: item.exitEase }, outAt);
          tl.set(root, { opacity: 0 }, item.start + item.duration);
        });
`;

/** A self-contained 1080x1350 proof slide for the parallel carousel renderer. */
export function evidenceSlideHTML(item, tokens) {
  const src = item.src || item.cleanedFile || "";
  const label = item.label || item.sourceName || "";
  const safe = signatureSafeArea({ format: "carousel", width: 1080, height: 1350 });
  const plate = titlePlate(tokens, { format: "carousel", width: 1080 });
  const fontSize = Math.max(32, Number(tokens.typeScale?.sm) || 32);
  const labelH = Math.ceil(fontSize * (Number(tokens.type?.body?.lineHeight) || 1) + 2 * plate.paddingY + (["top", "bottom"].includes(plate.rulePosition) ? plate.ruleThickness : 0));
  const gap = Number(tokens.spacing?.md) || 0;
  const artifactH = safe.h - labelH - gap;
  const sourceY = safe.y + artifactH + gap;
  const role = Object.hasOwn(tokens.colors || {}, tokens.signature?.colorRole) ? tokens.signature.colorRole : "accent";
  const color = `var(--brand-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)})`;
  const border = `border-${plate.rulePosition}:${plate.ruleThickness}px solid ${color}`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080,height=1350"><style>${tokensCSS(tokens)}html,body{margin:0;background:var(--brand-surface)}#slide{position:relative;width:1080px;height:1350px;overflow:hidden;background:var(--brand-surface)}#artifact{position:absolute;left:${safe.x}px;top:${safe.y}px;width:${safe.w}px;height:${artifactH}px;overflow:hidden;box-sizing:border-box;background:var(--brand-surface2);border:${plate.ruleThickness}px solid var(--brand-stroke);border-radius:${plate.radius}px}#artifact img{width:100%;height:100%;object-fit:contain}#source{position:absolute;left:${safe.x}px;top:${sourceY}px;width:${safe.w}px;height:${labelH}px;display:flex;align-items:center;box-sizing:border-box;padding:${plate.paddingY}px ${plate.paddingX}px;color:var(--brand-ink);background:var(--brand-surface2);${border};border-radius:${plate.radius}px;font-family:var(--brand-body-font);font-size:${fontSize}px;font-weight:var(--brand-body-weight);line-height:var(--brand-body-line-height)}</style></head><body><div id="slide"><div id="artifact"><img src="${esc(src)}" alt=""></div><div id="source">${esc(label)}</div></div></body></html>`;
}
