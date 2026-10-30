import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { ocrBinary, parseOcrJSON } from "./evidence.mjs";
import { ensureDir, PKG_ROOT, run } from "./util.mjs";

const PHOTO_KINDS = new Set(["photo", "photosplit", "phototop", "splittop", "story"]);
const PHOTO_FIELDS = ["photo", "image"];
const RETRY_FIXES = new Set(["shorten", "recrop", "swap-photo"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const clean = (value) => String(value ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
const kindOf = (slide) => clean(slide?.kind || "body").toLowerCase();

function textPart(role, value, critical = false) {
  const text = clean(value);
  return text ? { role, text, critical } : null;
}

function sideParts(side, fallbackLabel) {
  const value = typeof side === "object" && side != null ? side : { value: side };
  return [textPart("compare-label", value.label || fallbackLabel), textPart("compare-value", value.value), textPart("compare-note", value.note)].filter(Boolean);
}

/** Text the renderer is expected to paint, grouped so headline and footer rules remain explicit. */
export function expectedSlideText(slide, brand = {}) {
  const kind = kindOf(slide);
  const parts = [];
  if (["photo", "photosplit", "phototop", "splittop", "cover", "body", "cta", "static", "static-light"].includes(kind)) {
    if (!["photo", "photosplit", "phototop", "splittop"].includes(kind)) parts.push(textPart("label", slide.label));
    parts.push(textPart("headline", slide.headline || slide.title, true));
    parts.push(textPart("sub", slide.sub || slide.body));
  } else if (kind === "checklist") {
    parts.push(textPart("headline", slide.title || slide.headline, true));
    for (const item of slide.items || []) {
      parts.push(textPart("item", typeof item === "string" ? item : item?.text || item?.value));
      parts.push(textPart("item-note", typeof item === "object" ? item?.note : ""));
    }
  } else if (kind === "compare") {
    parts.push(textPart("headline", slide.title || slide.headline, true));
    const paired = slide.before != null || slide.after != null;
    parts.push(...sideParts(paired ? slide.before : slide.left, paired ? slide.beforeLabel || slide.leftLabel : slide.leftLabel));
    parts.push(...sideParts(paired ? slide.after : slide.right, paired ? slide.afterLabel || slide.rightLabel : slide.rightLabel));
    parts.push(textPart("decision", slide.decisionLine));
  } else if (kind === "postcard") {
    parts.push(textPart("name", slide.name || brand.identity?.name));
    parts.push(textPart("postcard-handle", slide.handle || brand.identity?.handle));
    parts.push(textPart("body", slide.postText || slide.text || slide.body));
    parts.push(textPart("metadata", slide.metadata));
  } else if (kind === "notes") {
    parts.push(textPart("headline", slide.title || slide.headline, true));
    parts.push(textPart("date", slide.date));
    const lines = Array.isArray(slide.lines) ? slide.lines : String(slide.text || slide.body || "").split(/\n+/);
    for (const line of lines) parts.push(textPart("item", typeof line === "string" ? line : line?.text));
  } else if (kind === "story") {
    parts.push(textPart("label", slide.chapter));
    parts.push(textPart("headline", slide.caption || slide.text || slide.headline, true));
  } else if (kind === "evidence") {
    parts.push(textPart("source", slide.sourceLabel || slide.label || slide.source));
  } else if (kind === "stat") {
    // The big number itself is skipped: OCR misreads huge display digits ("3%" reads as "30/0"), and the fit step keeps it on the slide.
    parts.push(textPart("label", slide.label));
    parts.push(textPart("headline", slide.headline, true));
    parts.push(textPart("sub", slide.sub));
    parts.push(textPart("source", slide.source));
  } else if (kind === "steps") {
    parts.push(textPart("label", slide.label));
    parts.push(textPart("headline", slide.headline, true));
    for (const step of slide.steps || []) parts.push(textPart("item", typeof step === "string" ? step : step?.text));
    parts.push(textPart("source", slide.source));
  } else if (kind === "quote") {
    parts.push(textPart("label", slide.label));
    parts.push(textPart("headline", slide.quote, true));
    parts.push(textPart("by", slide.by));
    parts.push(textPart("context", slide.context));
    parts.push(textPart("source", slide.source));
  }
  // Every rendered family has commonFooter except evidence, whose frame owns the source-label band.
  if (kind !== "evidence") parts.push(textPart("handle", brand.identity?.handle, true));
  return parts.filter(Boolean);
}

/** Case- and punctuation-insensitive tokens; numeric punctuation and @ are deliberately non-semantic. */
export function textTokens(value) {
  return clean(value).normalize("NFKC").toLocaleLowerCase("en-US").replace(/(?<=\d)[,._](?=\d)/g, "")
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.map((token) => token.replace(/['’]/g, "")) || [];
}

export function editDistance(a, b) {
  const left = String(a), right = String(b);
  let prior = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) next[j] = Math.min(next[j - 1] + 1, prior[j] + 1, prior[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    prior = next;
  }
  return prior[right.length];
}

function tokenMatches(expected, actual) {
  if (expected === actual) return true;
  return expected.length >= 5 && /^[\p{L}]+$/u.test(expected) && /^[\p{L}]+$/u.test(actual) && editDistance(expected, actual) <= 1;
}

/** Match expected tokens one-to-one against OCR and retain the role of every miss. */
export function matchExpectedText(parts, ocr) {
  const expected = parts.flatMap((part) => textTokens(part.text).map((token) => ({ token, role: part.role, critical: part.critical })));
  const actual = (ocr?.lines || []).flatMap((line, lineIndex) => textTokens(line.text).map((token) => ({ token, lineIndex, confidence: Number(line.confidence) || 0 })));
  const used = new Set(), missing = [], matches = [];
  for (let i = 0; i < expected.length; i++) {
    const item = expected[i];
    const found = actual.findIndex((candidate, index) => !used.has(index) && tokenMatches(item.token, candidate.token));
    if (found >= 0) { used.add(found); matches.push({ ...item, ...actual[found] }); continue; }
    // OCR often runs two short words together ("WHAT I" reads "WHATI"): accept this word and the next as one OCR token.
    const next = expected[i + 1];
    const joined = next ? actual.findIndex((candidate, index) => !used.has(index) && candidate.token === item.token + next.token) : -1;
    if (joined >= 0) { used.add(joined); matches.push({ ...item, ...actual[joined] }, { ...next, ...actual[joined] }); i++; continue; }
    missing.push(item);
  }
  const lineConfidence = (ocr?.lines || []).map((line) => Number(line.confidence)).filter(Number.isFinite);
  return {
    expected,
    matches,
    missing,
    coverage: expected.length ? matches.length / expected.length : 1,
    meanConfidence: lineConfidence.length ? lineConfidence.reduce((sum, value) => sum + value, 0) / lineConfidence.length : 0,
  };
}

function lintTextFields(slide) {
  const out = [];
  for (const [key, value] of Object.entries(slide || {})) {
    if (["photo", "image", "screenshot", "file", "pos", "kind", "focalPoint"].includes(key)) continue;
    if (typeof value === "string") out.push({ field: key, text: value });
    else if (Array.isArray(value)) value.forEach((item, index) => {
      if (typeof item === "string") out.push({ field: `${key}[${index}]`, text: item });
      else if (item && typeof item === "object") for (const [child, text] of Object.entries(item)) if (typeof text === "string") out.push({ field: `${key}[${index}].${child}`, text });
    });
    else if (value && typeof value === "object") for (const [child, text] of Object.entries(value)) if (typeof text === "string") out.push({ field: `${key}.${child}`, text });
  }
  return out;
}

function phrasePattern(value) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");
}

/** Brand copy rules run on the supplied spec, before OCR can obscure punctuation. */
export function lintSlideCopy(slide, neverSay = []) {
  const problems = [];
  for (const { field, text } of lintTextFields(slide)) {
    if (/[—–]/u.test(text)) problems.push({ code: "copy-dash", message: `${field} contains an em or en dash` });
    if (/\b0?\d+\s*\/\s*0?\d+\b|\bslide\s+\d+\b/i.test(text)) problems.push({ code: "copy-counter", message: `${field} contains a slide counter` });
    if (/\bswipe\b/i.test(text)) problems.push({ code: "copy-swipe", message: `${field} says swipe` });
    if (/\bghost\s*(?:p\s*(?:&|and|n)?\s*l|pnl|p\.\s*l\.)\b/i.test(text)) problems.push({ code: "copy-ghost-pl", message: `${field} names Ghost P&L` });
    if (/\b(?:comment|dm|message|reply|text|type)\s+(?:me\s+)?["'“”]?ghost\b/i.test(text) || (kindOf(slide) === "cta" && /\bghost\b/i.test(text)) || (/cta|call.?to.?action/i.test(field) && /\bghost\b/i.test(text))) problems.push({ code: "copy-ghost-cta", message: `${field} uses GHOST as a call to action` });
    for (const phrase of neverSay) if (clean(phrase) && phrasePattern(clean(phrase)).test(text)) problems.push({ code: "copy-never-say", message: `${field} uses the never-say phrase "${clean(phrase)}"` });
  }
  return problems;
}

export function verdictForProblems(problems = []) {
  if (!problems.length) return "schedule";
  return problems.every((problem) => RETRY_FIXES.has(problem.fix)) ? "retry" : "hold";
}

export function boxIntersection(a, b) {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return width * height;
}

export function faceOverlapRatio(textBox, faceBox) {
  const faceArea = Math.max(0, faceBox.w) * Math.max(0, faceBox.h);
  return faceArea ? boxIntersection(textBox, faceBox) / faceArea : 0;
}

/** Vision's face box pads below the chin; drop the bottom 15% so text under the jaw is not a collision. */
export function faceCore(faceBox) {
  return { ...faceBox, h: faceBox.h * 0.85 };
}

/** OCR lines that belong to the slide's own copy (half or more of their words are expected); text inside a photo is ignored. */
export function slideCopyLines(lines = [], parts = []) {
  const expected = parts.flatMap((part) => textTokens(part.text));
  return lines.filter((line) => {
    const tokens = textTokens(line.text);
    const hits = tokens.filter((token) => expected.some((want) => tokenMatches(want, token))).length;
    return tokens.length > 0 && hits / tokens.length >= 0.5;
  });
}

export function relativeLuminance({ r, g, b }) {
  const channel = (value) => { const x = value / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a, b) {
  const [light, dark] = [a, b].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

/** Contrast estimate from the mean darkest and lightest deciles in an OCR box. */
export function contrastFromLuminances(values = []) {
  if (!values.length) return 1;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 1;
  const count = Math.max(1, Math.floor(sorted.length * 0.1));
  const mean = (items) => items.reduce((sum, value) => sum + value, 0) / items.length;
  return contrastRatio(mean(sorted.slice(0, count)), mean(sorted.slice(-count)));
}

function hasPngChunk(buffer, wanted) {
  let at = 8;
  while (at + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(at), type = buffer.toString("ascii", at + 4, at + 8);
    if (type === wanted) return true;
    at += 12 + length;
  }
  return false;
}

function pngInfo(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString("ascii", 12, 16) !== "IHDR") throw new Error("file is not a decodable PNG");
  const info = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bitDepth: buffer[24], colorType: buffer[25] };
  if (hasPngChunk(buffer, "tRNS")) info.transparent = true;
  info.png = PNG.sync.read(buffer);
  return info;
}

function boxPixels(png, box) {
  const x0 = Math.max(0, Math.floor(box.x * png.width)), y0 = Math.max(0, Math.floor(box.y * png.height));
  const x1 = Math.min(png.width, Math.ceil((box.x + box.w) * png.width)), y1 = Math.min(png.height, Math.ceil((box.y + box.h) * png.height));
  const values = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const at = (png.width * y + x) * 4;
    values.push(relativeLuminance({ r: png.data[at], g: png.data[at + 1], b: png.data[at + 2] }));
  }
  return values;
}

function sampleGray(png, x, y) {
  const sx = Math.min(png.width - 1, Math.max(0, Math.round(x * (png.width - 1))));
  const sy = Math.min(png.height - 1, Math.max(0, Math.round(y * (png.height - 1))));
  const at = (sy * png.width + sx) * 4;
  return 0.299 * png.data[at] + 0.587 * png.data[at + 1] + 0.114 * png.data[at + 2];
}

/** 9x8 difference hash, encoded as 16 lower-case hexadecimal characters. */
export function differenceHash(input) {
  const png = Buffer.isBuffer(input) ? PNG.sync.read(input) : input;
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const left = sampleGray(png, x / 8, (y + 0.5) / 8);
    const right = sampleGray(png, (x + 1) / 8, (y + 0.5) / 8);
    bits += left > right ? "1" : "0";
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export function hammingDistance(a, b) {
  if (!/^[0-9a-f]{16}$/i.test(String(a)) || !/^[0-9a-f]{16}$/i.test(String(b))) return Infinity;
  let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}

function brandNeverSay(brand, options) {
  const candidates = [options.neverSay, brand.neverSay, brand.copy?.neverSay, brand.words?.neverSay, brand.compat?.neverSay];
  return [...new Set(candidates.flatMap((value) => Array.isArray(value) ? value : []).map(clean).filter(Boolean))];
}

function problem(code, message, fix) {
  return { code, message, fix };
}

function relativeSource(file, spec, options) {
  if (path.isAbsolute(file)) return file;
  const roots = [options.specDir, spec.out_dir, spec.outDir, process.cwd()].filter(Boolean);
  for (const root of roots) {
    const candidate = path.resolve(root, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(options.specDir || process.cwd(), file);
}

async function analyzeOcr(file, index, options) {
  if (Array.isArray(options.ocrResults)) return parseOcrJSON(options.ocrResults[index]);
  if (typeof options.analyzeImage === "function") return parseOcrJSON(await options.analyzeImage(file, index));
  const binary = await ocrBinary();
  if (!binary) throw new Error("Apple Vision OCR is unavailable");
  const result = await run(binary, [file], { capture: true });
  return parseOcrJSON(result.out);
}

async function hashSource(file, options) {
  if (typeof options.hashPhoto === "function") return options.hashPhoto(file);
  if (path.extname(file).toLowerCase() === ".png") return differenceHash(fs.readFileSync(file));
  if (process.platform !== "darwin") throw new Error("JPEG photo hashing needs the macOS image helper");
  const source = path.join(PKG_ROOT, "scripts", "dhash.swift");
  const binary = path.join(process.env.REEL_CACHE || path.join(os.homedir(), ".cache", "reel-editor"), "dhash");
  if (!fs.existsSync(binary) || fs.statSync(binary).mtimeMs < fs.statSync(source).mtimeMs) {
    ensureDir(path.dirname(binary));
    await run("swiftc", ["-O", "-o", binary, source], { capture: true });
  }
  const result = await run(binary, [file], { capture: true });
  return String(result.out || "").trim();
}

function addTextProblems(problems, parts, ocr) {
  const matched = matchExpectedText(parts, ocr);
  const headline = matched.missing.filter((item) => item.role === "headline");
  const numbers = matched.missing.filter((item) => /\d/.test(item.token));
  const handle = matched.missing.filter((item) => item.role === "handle" || item.role === "postcard-handle");
  if (headline.length) problems.push(problem("ocr-headline", `headline words missing from the rendered PNG: ${[...new Set(headline.map((item) => item.token))].join(", ")}`, "shorten"));
  if (numbers.length) problems.push(problem("ocr-number", `numbers missing from the rendered PNG: ${[...new Set(numbers.map((item) => item.token))].join(", ")}`, "shorten"));
  if (handle.length) problems.push(problem("ocr-handle", "brand handle is missing from the rendered PNG", "shorten"));
  if (matched.coverage < 0.97) problems.push(problem("ocr-coverage", `OCR found ${(matched.coverage * 100).toFixed(1)}% of expected tokens (minimum 97%)`, "shorten"));
  if (matched.meanConfidence < 0.7) problems.push(problem("ocr-confidence", `mean OCR confidence is ${matched.meanConfidence.toFixed(2)} (minimum 0.70)`, "shorten"));
}

/** Shared fail-closed slide gate. Apple-only work can be injected through options for deterministic unit tests. */
export async function preflightSlides({ spec, files, brand, history = null, options = {} }) {
  const slides = Array.isArray(spec?.slides) ? spec.slides : [];
  const width = Number(spec?.width || 1080), height = Number(spec?.height || (spec?.square ? 1080 : 1350));
  const results = slides.map((slide, index) => ({ index: index + 1, file: files?.[index] || "", problems: lintSlideCopy(slide, brandNeverSay(brand || {}, options)).map((item) => ({ ...item, fix: "shorten" })) }));
  if (!slides.length) results.push({ index: 0, file: "", problems: [problem("spec-empty", "slide spec has no slides", "none")] });
  if (!Array.isArray(files) || files.length !== slides.length) {
    for (const result of results) result.problems.push(problem("file-count", `expected ${slides.length} rendered PNGs, got ${files?.length || 0}`, "none"));
  }
  if (history && (!Array.isArray(history.photos) || history.photos.some((item) => !/^[0-9a-f]{16}$/i.test(String(item?.hash || ""))))) {
    (results[0]?.problems || []).push(problem("history-invalid", "photo history must contain photos[] with 64-bit hexadecimal dHash values", "none"));
  }

  for (let index = 0; index < slides.length; index++) {
    const slide = slides[index], result = results[index], file = result.file;
    let decoded;
    try {
      if (!file || path.extname(file).toLowerCase() !== ".png") throw new Error("rendered file must have a .png extension");
      decoded = pngInfo(file);
      if (decoded.width !== width || decoded.height !== height) throw new Error(`PNG is ${decoded.width}x${decoded.height}; expected ${width}x${height}`);
      if (decoded.bitDepth !== 8 || decoded.colorType !== 2 || decoded.transparent) throw new Error(`PNG must be opaque 8-bit RGB (depth ${decoded.bitDepth}, color type ${decoded.colorType})`);
    } catch (error) {
      result.problems.push(problem("file-invalid", error.message, "none"));
      continue;
    }

    let ocr;
    try {
      ocr = await analyzeOcr(file, index, options);
      if (ocr.width !== decoded.width || ocr.height !== decoded.height) throw new Error(`OCR image size is ${ocr.width}x${ocr.height}; PNG is ${decoded.width}x${decoded.height}`);
      addTextProblems(result.problems, expectedSlideText(slide, brand || {}), ocr);
      ocr.copyLines = slideCopyLines(ocr.lines, expectedSlideText(slide, brand || {}));
    } catch (error) {
      result.problems.push(problem("ocr-unavailable", `OCR check could not run: ${error.message}`, "none"));
      continue;
    }

    if (PHOTO_KINDS.has(kindOf(slide))) {
      const collision = ocr.copyLines.some((line) => ocr.faces.some((face) => faceOverlapRatio(line.box, faceCore(face.box)) > 0.05));
      if (collision) result.problems.push(problem("face-collision", "slide text overlaps a detected face (more than 5% of the face, chin padding excluded)", "recrop"));
    }
    for (const line of ocr.copyLines) {
      try {
        const ratio = contrastFromLuminances(boxPixels(decoded.png, line.box));
        const minimum = line.box.h * decoded.height < 40 ? 4.5 : 3;
        if (ratio < minimum) result.problems.push(problem("low-contrast", `OCR text "${clean(line.text).slice(0, 80)}" has ${ratio.toFixed(2)}:1 contrast (minimum ${minimum}:1)`, PHOTO_KINDS.has(kindOf(slide)) ? "recrop" : "none"));
      } catch (error) {
        result.problems.push(problem("contrast-unavailable", `contrast check could not run: ${error.message}`, "none"));
        break;
      }
    }
  }

  const photoHashes = [];
  const seenFiles = new Set();
  for (let index = 0; index < slides.length; index++) {
    for (const field of PHOTO_FIELDS) {
      const named = clean(slides[index]?.[field]);
      if (!named) continue;
      const file = relativeSource(named, spec, options);
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);
      try {
        const hash = await hashSource(file, options);
        if (!/^[0-9a-f]{16}$/i.test(String(hash))) throw new Error("photo hash was not a 64-bit hexadecimal dHash");
        photoHashes.push({ file, hash: String(hash).toLowerCase() });
        const prior = (history?.photos || []).find((item) => hammingDistance(hash, item?.hash) <= 6);
        if (prior) results[index].problems.push(problem("photo-reused", `source photo matches recent history${prior.file ? ` (${prior.file})` : ""}`, "swap-photo"));
      } catch (error) {
        results[index].problems.push(problem("photo-hash-unavailable", `photo reuse check could not run for ${named}: ${error.message}`, "none"));
      }
    }
  }

  const allProblems = results.flatMap((slide) => slide.problems);
  return { verdict: verdictForProblems(allProblems), slides: results, photoHashes };
}
