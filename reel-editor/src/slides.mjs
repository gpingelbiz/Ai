import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBrandTokens, tokensCSS, contrast, readableOn } from "./brandtokens.mjs";
import { loadPreset } from "./presets.mjs";
import { detectPhotos } from "./photos.mjs";
import { signatureHTML, signatureRulesCSS } from "./signature.mjs";
import { esc } from "./text.mjs";
import { ensureDir, PKG_ROOT, run, warn } from "./util.mjs";

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHTS = new Set([1080, 1350]);
export const LEGACY_SLIDE_KINDS = ["photo", "photosplit", "phototop", "splittop", "cover", "body", "cta", "static", "static-light"];
export const FAMILY_SLIDE_KINDS = ["checklist", "compare", "postcard", "notes", "story", "evidence", "stat", "steps", "quote", "cover-top", "cover-doc", "cover-card", "cover-compare", "cover-list", "verdict", "note", "script"];
export const SLIDE_KINDS = [...LEGACY_SLIDE_KINDS, ...FAMILY_SLIDE_KINDS];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const words = (value) => clean(String(value ?? "").replace(/\*/g, "")).split(/\s+/).filter(Boolean);
const kindOf = (slide) => clean(slide?.kind || "body").toLowerCase();
const assetValue = (slide) => slide.photo || slide.image || slide.screenshot || slide.file || "";
const PHOTO_SLIDE_KINDS = new Set(["photo", "photosplit", "phototop", "splittop", "cover-top", "cover-doc", "cover-card", "cover-compare", "cover-list"]);

const wordCount = (value) => words(value).length;
const needWords = (value, min, max, message) => {
  const count = wordCount(value);
  if (count < min || count > max) throw new Error(`${message} needs ${min} to ${max} words, got ${count}`);
};

/** Largest whole-pixel size that passes `fits`, down to 70% by default. */
export function fitTextSize(baseSize, fits, minimum = Math.floor(Number(baseSize) * 0.7)) {
  const base = Math.max(1, Math.floor(Number(baseSize) || 1));
  const floor = Math.max(1, Math.min(base, Math.floor(Number(minimum) || 1)));
  if (fits(base)) return { size: base, shrunk: false, overflow: false };
  if (!fits(floor)) return { size: floor, shrunk: floor < base, overflow: true };
  let low = floor;
  let high = base - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return { size: low, shrunk: low < base, overflow: false };
}

/** Client brands balance lines by default. Greg's Pingel brands retain their established line breaks. */
export function typeBalanceEnabled(tokens, override) {
  if (typeof override === "boolean") return override;
  if (typeof tokens?.type?.balance === "boolean") return tokens.type.balance;
  const identity = `${clean(tokens?.identity?.name)} ${clean(tokens?.identity?.handle)} ${clean(tokens?.name)}`.toLowerCase();
  return !identity.includes("pingel");
}

function intersects(a, b) {
  return a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function largestClearBox(visible, avoid) {
  if (!intersects(visible, avoid)) return visible;
  const left = Math.max(visible.x, avoid.x);
  const top = Math.max(visible.y, avoid.y);
  const right = Math.min(visible.x + visible.w, avoid.x + avoid.w);
  const bottom = Math.min(visible.y + visible.h, avoid.y + avoid.h);
  const choices = [
    { x: visible.x, y: visible.y, w: Math.max(0, left - visible.x), h: visible.h },
    { x: right, y: visible.y, w: Math.max(0, visible.x + visible.w - right), h: visible.h },
    { x: visible.x, y: visible.y, w: visible.w, h: Math.max(0, top - visible.y) },
    { x: visible.x, y: bottom, w: visible.w, h: Math.max(0, visible.y + visible.h - bottom) },
  ].filter((box) => box.w > 0 && box.h > 0);
  return choices.sort((a, b) => b.w * b.h - a.w * a.h)[0] || visible;
}

const percent = (value) => {
  const rounded = Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
};

/**
 * Place detected faces inside the largest part of `visibleBox` that does not intersect `avoidArea`.
 * Face boxes may be normalized Vision boxes or source-pixel boxes. Null means the old position should be used.
 */
export function faceAwareObjectPosition(imageSize, faceBoxes, visibleBox, avoidArea = null) {
  const imageWidth = Number(imageSize?.width);
  const imageHeight = Number(imageSize?.height);
  const visible = { x: Number(visibleBox?.x || 0), y: Number(visibleBox?.y || 0), w: Number(visibleBox?.w), h: Number(visibleBox?.h) };
  const faces = (Array.isArray(faceBoxes) ? faceBoxes : []).filter((face) => [face?.x, face?.y, face?.w, face?.h].every(Number.isFinite) && face.w > 0 && face.h > 0);
  if (!(imageWidth > 0 && imageHeight > 0 && visible.w > 0 && visible.h > 0) || !faces.length) return null;
  const sourceFaces = faces.map((face) => {
    const normalized = Math.max(face.x, face.y, face.w, face.h) <= 1;
    return normalized
      ? { x: face.x * imageWidth, y: face.y * imageHeight, w: face.w * imageWidth, h: face.h * imageHeight }
      : { x: face.x, y: face.y, w: face.w, h: face.h };
  });
  const group = sourceFaces.reduce((box, face) => ({
    x: Math.min(box.x, face.x),
    y: Math.min(box.y, face.y),
    right: Math.max(box.right, face.x + face.w),
    bottom: Math.max(box.bottom, face.y + face.h),
  }), { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity });
  const scale = Math.max(visible.w / imageWidth, visible.h / imageHeight);
  const scaledWidth = imageWidth * scale;
  const scaledHeight = imageHeight * scale;
  const overflowX = Math.max(0, scaledWidth - visible.w);
  const overflowY = Math.max(0, scaledHeight - visible.h);
  const safe = largestClearBox(visible, avoidArea);
  const localSafe = { x: safe.x - visible.x, y: safe.y - visible.y, w: safe.w, h: safe.h };
  const margin = Math.min(0.08 * Math.min(visible.w, visible.h), localSafe.w * 0.12, localSafe.h * 0.12);
  const centerX = (group.x + group.right) * scale / 2;
  const centerY = (group.y + group.bottom) * scale / 2;
  const targetX = localSafe.x + localSafe.w / 2;
  const targetY = localSafe.y + localSafe.h / 2;
  const cropFor = (center, target, overflow, start, end, safeStart, safeEnd) => {
    if (!overflow) return 0;
    const desired = center - target;
    const low = Math.max(0, end - safeEnd + margin);
    const high = Math.min(overflow, start - safeStart - margin);
    return low <= high ? Math.max(low, Math.min(high, desired)) : Math.max(0, Math.min(overflow, desired));
  };
  const cropX = cropFor(centerX, targetX, overflowX, group.x * scale, group.right * scale, localSafe.x, localSafe.x + localSafe.w);
  const cropY = cropFor(centerY, targetY, overflowY, group.y * scale, group.bottom * scale, localSafe.y, localSafe.y + localSafe.h);
  return `${percent(overflowX ? cropX / overflowX * 100 : 50)} ${percent(overflowY ? cropY / overflowY * 100 : 50)}`;
}

/** Put a solid card in the side or corner opposite the detected face group. */
export function faceAwareFamilyPlacement(faceBoxes, imageSize = null) {
  const faces = (Array.isArray(faceBoxes) ? faceBoxes : []).filter((face) => [face?.x, face?.y, face?.w, face?.h].every(Number.isFinite) && face.w > 0 && face.h > 0);
  if (!faces.length) return null;
  const weighted = faces.reduce((sum, face) => {
    const normalized = Math.max(face.x, face.y, face.w, face.h) <= 1;
    const width = normalized ? 1 : Number(imageSize?.width) || 1;
    const height = normalized ? 1 : Number(imageSize?.height) || 1;
    const area = face.w * face.h;
    return { area: sum.area + area, x: sum.x + ((face.x + face.w / 2) / width) * area, y: sum.y + ((face.y + face.h / 2) / height) * area };
  }, { area: 0, x: 0, y: 0 });
  const x = weighted.x / weighted.area;
  const y = weighted.y / weighted.area;
  const side = x < 0.5 ? "right" : "left";
  const corner = `${y < 0.5 ? "b" : "t"}${x < 0.5 ? "r" : "l"}`;
  return { side, corner };
}

/** Escape copy and turn the content engine's *phrase* convention into the brand accent. */
export function accentHTML(value) {
  return esc(String(value ?? ""))
    .replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>')
    .replace(/\*/g, "")
    .replace(/\n/g, "<br>");
}

function itemObject(item) {
  if (typeof item === "string") return { text: clean(item), checked: false, note: "" };
  return { text: clean(item?.text || item?.value), checked: item?.checked === true, note: clean(item?.note) };
}

/** Validate the compatibility JSON boundary and return a normalized, non-mutating spec. */
export function normalizeSlideSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("slide spec must be a JSON object");
  if (!Array.isArray(spec.slides) || !spec.slides.length) throw new Error("slide spec needs a non-empty slides array");
  const width = Number(spec.width || SLIDE_WIDTH);
  const height = Number(spec.height || (spec.square ? 1080 : 1350));
  if (width !== SLIDE_WIDTH || !SLIDE_HEIGHTS.has(height)) throw new Error("slide size must be 1080x1350 or 1080x1080");
  const slides = spec.slides.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`slide ${index + 1} must be an object`);
    const kind = kindOf(source);
    if (!SLIDE_KINDS.includes(kind)) throw new Error(`unknown slide kind "${kind}" on slide ${index + 1}; expected ${SLIDE_KINDS.join(", ")}`);
    const slide = { ...structuredClone(source), kind };
    if (kind === "checklist") {
      if (!Array.isArray(slide.items)) throw new Error(`checklist slide ${index + 1} needs items[]`);
      if (slide.items.length > 8) throw new Error(`checklist slide ${index + 1} has ${slide.items.length} rows; the maximum is 8`);
      slide.items = slide.items.map(itemObject);
    }
    if (kind === "stat" && !(clean(slide.number) && clean(slide.headline))) throw new Error(`stat slide ${index + 1} needs a number and a headline`);
    if (kind === "steps" && !(Array.isArray(slide.steps) && slide.steps.length >= 2 && slide.steps.length <= 6)) throw new Error(`steps slide ${index + 1} needs 2 to 6 steps`);
    if (kind === "quote" && !(clean(slide.quote) && clean(slide.by))) throw new Error(`quote slide ${index + 1} needs the quote and who said it`);
    if (kind === "story" && !clean(slide.photo || slide.image)) throw new Error(`story slide ${index + 1} needs a real photo file`);
    if (kind === "story" && !(typeof slide.focalPoint === "string" || (Number.isFinite(slide.focalPoint?.x) && Number.isFinite(slide.focalPoint?.y)))) throw new Error(`story slide ${index + 1} needs a focalPoint`);
    if (kind === "evidence" && !clean(assetValue(slide))) throw new Error(`evidence slide ${index + 1} needs an image or screenshot file`);
    if (kind === "compare") {
      const paired = source.before != null && source.after != null;
      const sided = source.left != null && source.right != null;
      if (!paired && !sided) throw new Error(`compare slide ${index + 1} needs left/right values or before/after`);
      slide.left = typeof slide.left === "object" ? { ...slide.left } : { value: clean(slide.left) };
      slide.right = typeof slide.right === "object" ? { ...slide.right } : { value: clean(slide.right) };
    }
    if (["cover-top", "cover-doc", "cover-card", "cover-compare", "cover-list"].includes(kind) && !clean(slide.photo || slide.image)) throw new Error(`${kind} slide ${index + 1} needs a photo`);
    if (kind === "cover-top") {
      needWords(slide.headline, 5, 12, `cover-top slide ${index + 1} headline`);
      if (slide.sub) needWords(slide.sub, 1, 14, `cover-top slide ${index + 1} sub`);
    }
    if (kind === "cover-doc") {
      if (slide.headline) needWords(slide.headline, 3, 6, `cover-doc slide ${index + 1} headline`);
      if (slide.corner != null && !["tl", "tr", "bl", "br"].includes(slide.corner)) throw new Error(`cover-doc slide ${index + 1} corner must be tl, tr, bl or br`);
    }
    if (kind === "cover-card") {
      needWords(slide.headline, 6, 12, `cover-card slide ${index + 1} headline`);
      if (slide.sub) needWords(slide.sub, 1, 22, `cover-card slide ${index + 1} sub`);
      if (slide.side != null && !["left", "right"].includes(slide.side)) throw new Error(`cover-card slide ${index + 1} side must be left or right`);
    }
    if (kind === "cover-compare") {
      for (const side of ["left", "right"]) {
        const value = slide[side];
        if (!value || typeof value !== "object") throw new Error(`cover-compare slide ${index + 1} needs ${side} {label, text}`);
        needWords(value.label, 1, 3, `cover-compare slide ${index + 1} ${side} label`);
        needWords(value.text, 2, 5, `cover-compare slide ${index + 1} ${side} text`);
        slide[side] = { ...value, label: clean(value.label), text: clean(value.text) };
      }
      if (slide.decision != null && !["left", "right"].includes(slide.decision)) throw new Error(`cover-compare slide ${index + 1} decision must be left or right`);
      slide.decision = slide.decision === "left" ? "left" : "right";
    }
    if (kind === "cover-list") {
      needWords(slide.headline, 5, 8, `cover-list slide ${index + 1} headline`);
      if (slide.sub) needWords(slide.sub, 1, 14, `cover-list slide ${index + 1} sub`);
    }
    if (kind === "verdict") needWords(slide.headline, 5, 11, `verdict slide ${index + 1} headline`);
    if (kind === "note") needWords(slide.text, 7, 18, `note slide ${index + 1} text`);
    if (kind === "script") {
      needWords(slide.headline, 6, 10, `script slide ${index + 1} headline`);
      needWords(slide.say, 10, 18, `script slide ${index + 1} say`);
    }
    return slide;
  });
  return { ...structuredClone(spec), width, height, slides };
}

/** Checklists keep six rows at most on a page and retain only supplied copy on the continuation. */
export function expandSlides(slides) {
  return slides.flatMap((slide, sourceIndex) => {
    const items = Array.isArray(slide.items) ? slide.items : [];
    if (kindOf(slide) !== "checklist" || items.length <= 6) return [{ ...slide, __sourceIndex: sourceIndex }];
    return [
      { ...slide, items: items.slice(0, 6), __sourceIndex: sourceIndex, __part: 1 },
      { ...slide, items: items.slice(6), __sourceIndex: sourceIndex, __part: 2 },
    ];
  });
}

function headlineOf(slide) {
  return clean(slide.headline || slide.title || slide.decisionLine || slide.postText || slide.text || slide.caption);
}

function allText(slide) {
  const out = [slide.headline, slide.title, slide.sub, slide.body, slide.text, slide.say, slide.postText, slide.caption, slide.decisionLine, slide.label, slide.sourceLabel, slide.date];
  for (const item of slide.items || []) out.push(typeof item === "string" ? item : item?.text, item?.note);
  for (const side of [slide.left, slide.right]) out.push(typeof side === "string" ? side : side?.label, side?.value, side?.text, side?.note);
  for (const line of slide.lines || []) out.push(typeof line === "string" ? line : line?.text);
  return clean(out.filter(Boolean).join(" "));
}

function estimateSize(text, start, charsPerLine, maxLines) {
  const length = clean(text).length;
  if (!length) return start;
  const lines = Math.max(1, Math.ceil(length / charsPerLine));
  return Math.max(24, Math.floor(start * Math.min(1, maxLines / lines)));
}

/** Deterministic pre-render sizes; the page uses these same values before Chrome sees it. */
export function fittedTextSizes(slide) {
  const kind = kindOf(slide);
  const sizes = [];
  const explicit = [slide.fontSize, slide.textSize, slide.rowFontSize, slide.bodyFontSize].filter(Number.isFinite);
  explicit.forEach((size) => sizes.push({ role: "specified text", size }));
  const headline = headlineOf(slide);
  if (headline) sizes.push({ role: "headline", size: estimateSize(headline, kind === "cover" ? 152 : 88, kind === "cover" ? 14 : 22, kind === "cover" ? 4 : 3) });
  if (kind === "checklist") {
    for (const item of slide.items || []) sizes.push({ role: "checklist row", size: estimateSize(item.text, 42, 34, 2) });
  }
  if (kind === "compare") {
    for (const side of [slide.left, slide.right]) sizes.push({ role: "comparison value", size: estimateSize(side?.value, 52, 24, 4) });
  }
  if (kind === "notes") for (const line of slide.lines || []) sizes.push({ role: "notes line", size: estimateSize(line?.text || line, 38, 42, 2) });
  if (slide.sub || slide.body || slide.postText || slide.text || slide.caption) {
    sizes.push({ role: "body text", size: estimateSize(slide.sub || slide.body || slide.postText || slide.text || slide.caption, 44, 40, 8) });
  }
  return sizes;
}

/** Plain-English sequence warnings. Rendering continues; these are editorial guards, not hard failures. */
export function checkSequence(slides) {
  const warnings = [];
  if (!Array.isArray(slides) || !slides.length) return ["sequence has no slides"];
  const first = slides[0];
  const firstHeadline = headlineOf(first);
  if (words(firstHeadline).length > 9) warnings.push("slide 1 has more than 9 words in its headline");
  const firstBody = clean(first.body || first.sub || first.postText || first.text);
  if ((firstBody && (words(firstBody).length > 16 || /[.!?].+[.!?]/.test(firstBody))) || /[.!?].+[.!?]/.test(firstHeadline)) warnings.push("slide 1 contains a paragraph; use one promise and one dominant object");
  if (slides[1]) {
    const second = headlineOf(slides[1]);
    if (!second) warnings.push("slide 2 cannot stand alone because it has no headline");
    else if (/^(?:and|so|but|because)\b/i.test(second.replace(/^\*+/, ""))) warnings.push(`slide 2 cannot stand alone because it starts with "${second.split(/\s+/)[0].replace(/\*/g, "")}"`);
  }
  const last = slides.at(-1);
  const lastText = allText(last).replace(/\*/g, "").trim();
  if (!lastText || /^(?:follow(?: me| us)?(?: for more)?|follow for more|logo|brand logo)[.!\s]*$/i.test(lastText)) {
    warnings.push("the last slide is only a logo or generic follow request; close with one useful idea");
  }
  slides.forEach((slide, index) => {
    if (kindOf(slide) === "checklist" && (slide.items || []).length < 3) warnings.push(`slide ${index + 1} checklist has fewer than 3 rows`);
    for (const fit of fittedTextSizes(slide)) if (fit.size < 34) warnings.push(`slide ${index + 1} ${fit.role} fits at ${fit.size}px, under the 34px minimum`);
  });
  return [...new Set(warnings)];
}

function commonHeader(slide) {
  return slide.label ? `<div class="slide-label">${accentHTML(slide.label)}</div>` : "";
}

function commonFooter(tokens) {
  const handle = clean(tokens.identity?.handle);
  return handle ? `<div class="slide-handle">${esc(handle)}</div>` : "";
}

function fitAttrs(role, value) {
  return ` data-fit-role="${role}"${String(value ?? "").includes("\n") ? ' data-explicit-break="1"' : ""}`;
}

function legacyMarkup(slide) {
  const kind = kindOf(slide);
  const headlineValue = slide.headline || slide.title;
  const subValue = slide.sub || slide.body;
  const headline = accentHTML(headlineValue);
  const sub = subValue ? `<div class="legacy-sub"${fitAttrs("sub", subValue)}>${accentHTML(subValue)}</div>` : "";
  return `${commonHeader(slide)}<main class="legacy-main"><h1 class="legacy-head"${fitAttrs("headline", headlineValue)}>${headline}</h1>${sub}</main>`;
}

function checklistMarkup(slide) {
  const rowSize = Math.min(...fittedTextSizes(slide).filter((x) => x.role === "checklist row").map((x) => x.size), 42);
  const rows = slide.items.map((item) => `<li class="check-row${item.checked ? " is-checked" : ""}" style="--row-size:${rowSize}px"><span class="check-box" aria-hidden="true">${item.checked ? "✓" : ""}</span><span class="check-copy"><strong${fitAttrs("sub", item.text)}>${accentHTML(item.text)}</strong>${item.note ? `<small${fitAttrs("sub", item.note)}>${accentHTML(item.note)}</small>` : ""}</span></li>`).join("");
  const title = slide.title || slide.headline;
  return `<main class="family-main checklist-main"><h1${fitAttrs("headline", title)}>${accentHTML(title)}</h1><ul class="check-list">${rows}</ul></main>`;
}

function sideMarkup(side, fallbackLabel) {
  return `<section class="compare-side"><div class="compare-label">${accentHTML(side?.label || fallbackLabel)}</div><div class="compare-value"${fitAttrs("sub", side?.value)}>${accentHTML(side?.value)}</div>${side?.note ? `<div class="compare-note"${fitAttrs("sub", side.note)}>${accentHTML(side.note)}</div>` : ""}</section>`;
}

function compareMarkup(slide) {
  const beforeAfter = slide.before != null || slide.after != null;
  const left = beforeAfter ? (typeof slide.before === "object" ? slide.before : { label: slide.beforeLabel || "", value: slide.before }) : slide.left;
  const right = beforeAfter ? (typeof slide.after === "object" ? slide.after : { label: slide.afterLabel || "", value: slide.after }) : slide.right;
  const orientation = slide.orientation === "stacked" ? "stacked" : "side-by-side";
  const title = slide.title || slide.headline;
  return `<main class="family-main compare-main"><h1${fitAttrs("headline", title)}>${accentHTML(title)}</h1><div class="compare-grid ${orientation}">${sideMarkup(left, slide.leftLabel)}${sideMarkup(right, slide.rightLabel)}</div>${slide.decisionLine ? `<div class="decision-line"${fitAttrs("sub", slide.decisionLine)}>${accentHTML(slide.decisionLine)}</div>` : ""}</main>`;
}

function initials(name) {
  return clean(name).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function postcardMarkup(slide, tokens) {
  const name = clean(slide.name || tokens.identity?.name);
  const handle = clean(slide.handle || tokens.identity?.handle);
  const logo = clean(tokens.identity?.logo);
  const avatar = logo ? `<img src="${esc(logo)}" alt="" />` : `<span>${esc(initials(name || handle))}</span>`;
  const copy = slide.postText || slide.text || slide.body;
  return `<main class="family-main postcard-main"><article class="post-card"><header><div class="postcard-avatar">${avatar}</div><div><strong>${esc(name)}</strong>${handle ? `<small>${esc(handle)}</small>` : ""}</div></header><div class="postcard-copy"${fitAttrs("sub", copy)}>${accentHTML(copy)}</div>${slide.metadata ? `<footer>${accentHTML(slide.metadata)}</footer>` : ""}</article></main>`;
}

function notesMarkup(slide) {
  const lines = Array.isArray(slide.lines) ? slide.lines : clean(slide.text || slide.body).split(/\n+/).filter(Boolean);
  const title = slide.title || slide.headline;
  return `<main class="family-main notes-main"><article class="note-paper"><header><h1${fitAttrs("headline", title)}>${accentHTML(title)}</h1>${slide.date ? `<time>${accentHTML(slide.date)}</time>` : ""}</header><div class="note-lines">${lines.map((line) => `<p${fitAttrs("sub", line?.text || line)}>${accentHTML(line?.text || line)}</p>`).join("")}</div></article></main>`;
}

/** Big number: one real, sourced number, what it means, and the source line (2026-10-30 carousel research, lanes 2 and 5). */
function statMarkup(slide) {
  const sub = slide.sub ? `<div class="stat-sub"${fitAttrs("sub", slide.sub)}>${accentHTML(slide.sub)}</div>` : "";
  const source = slide.source ? `<div class="stat-source">${esc(clean(slide.source))}</div>` : "";
  return `${commonHeader(slide)}<main class="family-main stat-main"><div class="stat-number"${fitAttrs("headline", slide.number)}>${accentHTML(slide.number)}</div><h1${fitAttrs("headline", slide.headline)}>${accentHTML(slide.headline)}</h1>${sub}${source}</main>`;
}

/** Steps: 3 to 5 numbered steps joined by a thin accent line. Step numbers are content, not slide counters. */
function stepsMarkup(slide) {
  const rows = slide.steps.map((step, index) => `<li><span class="step-n">${index + 1}</span><span class="step-t">${accentHTML(typeof step === "string" ? step : step?.text)}</span></li>`).join("");
  return `${commonHeader(slide)}<main class="family-main steps-main"><h1${fitAttrs("headline", slide.headline)}>${accentHTML(slide.headline)}</h1><ol class="step-list" data-fit-role="sub">${rows}</ol></main>`;
}

/** Quote: real words with who said them. Never a made-up testimonial. */
function quoteMarkup(slide) {
  const context = slide.context ? `<div class="quote-context">${esc(clean(slide.context))}</div>` : "";
  return `${commonHeader(slide)}<main class="family-main quote-main"><div class="quote-mark" aria-hidden="true">&ldquo;</div><blockquote${fitAttrs("headline", slide.quote)}>${accentHTML(slide.quote)}</blockquote><div class="quote-by">${esc(clean(slide.by))}</div>${context}</main>`;
}

function storyMarkup(slide) {
  const photo = slide.photo || slide.image;
  const focal = typeof slide.focalPoint === "object" ? `${Number(slide.focalPoint.x ?? 0.5) * 100}% ${Number(slide.focalPoint.y ?? 0.5) * 100}%` : clean(slide.focalPoint || slide.pos || "center center");
  const caption = slide.caption || slide.text || slide.headline;
  return `<img class="story-photo" src="${esc(photo)}" alt="" style="object-position:${esc(focal)}" /><div class="story-scrim"></div><main class="story-main">${slide.chapter != null ? `<div class="story-chapter">${esc(slide.chapter)}</div>` : ""}<div class="story-caption"${fitAttrs("sub", caption)}>${accentHTML(caption)}</div></main>`;
}

function evidenceFallbackMarkup(slide) {
  const caption = slide.sourceLabel || slide.label || slide.source;
  return `<main class="family-main evidence-main"><figure><div class="evidence-frame"><img src="${esc(assetValue(slide))}" alt="" /></div><figcaption${fitAttrs("sub", caption)}>${accentHTML(caption)}</figcaption></figure></main>`;
}

function coverTopMarkup(slide) {
  const sub = slide.sub ? `<div class="cover-top-sub"${fitAttrs("sub", slide.sub)}>${accentHTML(slide.sub)}</div>` : "";
  return `<div class="cover-top-scrim"></div><main class="cover-top-main"><h1${fitAttrs("headline", slide.headline)}>${accentHTML(slide.headline)}</h1>${sub}</main>`;
}

function coverDocMarkup(slide) {
  if (!slide.headline) return "";
  const corner = slide.corner || slide.__autoCorner || "bl";
  return `<main class="cover-doc-main corner-${esc(corner)}"><div class="cover-doc-card"><h1${fitAttrs("headline", slide.headline)}>${accentHTML(slide.headline)}</h1></div></main>`;
}

function coverCardMarkup(slide) {
  const side = slide.side || slide.__autoSide || "right";
  const sub = slide.sub ? `<div class="cover-card-sub"${fitAttrs("sub", slide.sub)}>${accentHTML(slide.sub)}</div>` : "";
  return `<main class="cover-card-main side-${esc(side)}"><article class="cover-card-panel"><h1${fitAttrs("headline", slide.headline)}>${accentHTML(slide.headline)}</h1>${sub}</article></main>`;
}

function coverCompareMarkup(slide) {
  const decision = slide.decision === "left" ? "left" : "right";
  const panel = (name) => `<section class="cover-compare-panel${decision === name ? " is-decision" : ""}"><div class="cover-compare-label">${accentHTML(slide[name].label)}</div><div class="cover-compare-value"${fitAttrs("sub", slide[name].text)}>${accentHTML(slide[name].text)}</div></section>`;
  const headline = slide.headline ? `<h1${fitAttrs("headline", slide.headline)}>${accentHTML(slide.headline)}</h1>` : "";
  return `<main class="cover-compare-main">${headline}<div class="cover-compare-panels">${panel("left")}${panel("right")}</div></main>`;
}

function coverListMarkup(slide) {
  const sub = slide.sub ? `<div class="cover-list-sub"${fitAttrs("sub", slide.sub)}>${accentHTML(slide.sub)}</div>` : "";
  return `<main class="cover-list-main"><h1${fitAttrs("headline", slide.headline)}>${accentHTML(slide.headline)}</h1>${sub}</main>`;
}

function verdictMarkup(slide) {
  return `<main class="family-main verdict-main"><h1${fitAttrs("headline", slide.headline)}>${accentHTML(slide.headline)}</h1></main>`;
}

function noteMarkup(slide) {
  const label = slide.label ? `<div class="note-label">${accentHTML(slide.label)}</div>` : "";
  return `<main class="family-main note-main"><div class="note-rule"></div>${label}<div class="note-text"${fitAttrs("sub", slide.text)}>${accentHTML(slide.text)}</div></main>`;
}

function scriptMarkup(slide) {
  const label = slide.label ? `<div class="script-label">${accentHTML(slide.label)}</div>` : "";
  return `<main class="family-main script-main">${label}<h1${fitAttrs("headline", slide.headline)}>${accentHTML(slide.headline)}</h1><article class="script-card"><div class="script-rule"></div><div class="script-say"${fitAttrs("sub", slide.say)}>${accentHTML(slide.say)}</div></article></main>`;
}

function slideRules() {
  return `
    * { box-sizing: border-box; hyphens: none; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    body { background: var(--brand-surface); color: var(--brand-ink); font-family: var(--brand-body-font); }
    .slide { position: relative; width: 1080px; height: var(--slide-height); overflow: hidden; background: var(--brand-surface); color: var(--brand-ink); padding: var(--space-xxl); }
    .signature-layer { z-index: 4; }
    .accent { color: var(--slide-accent-text, var(--brand-accent)); }
    .slide-label { position: relative; z-index: 3; color: var(--slide-accent-text, var(--brand-accent)); font-size: var(--type-sm); font-weight: 600; letter-spacing: .06em; text-transform: var(--brand-body-case); }
    .slide-label::before { content: ""; display: block; width: calc(var(--space-xl) + var(--space-xs)); height: var(--space-xs); margin-bottom: var(--space-md); background: var(--brand-accent); border-radius: var(--brand-radius-sm); }
    .slide-handle { position: absolute; z-index: 5; left: var(--space-xxl); bottom: var(--space-xl); color: var(--brand-muted); font-size: var(--type-sm); font-weight: 600; }
    .legacy-main { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; justify-content: center; }
    .legacy-head, .family-main h1 { margin: 0; font-family: var(--brand-display-font); font-weight: var(--brand-display-weight); line-height: var(--brand-display-line-height); letter-spacing: var(--brand-display-tracking); text-transform: var(--brand-display-case); }
    .type-balance .legacy-head:not([data-explicit-break="1"]), .type-balance .family-main h1:not([data-explicit-break="1"]) { text-wrap: balance; }
    .type-balance .legacy-sub, .type-balance .check-copy, .type-balance .compare-value, .type-balance .compare-note, .type-balance .decision-line, .type-balance .postcard-copy, .type-balance .note-lines, .type-balance .story-caption, .type-balance .evidence-main figcaption { text-wrap: pretty; }
    .legacy-head { font-size: var(--legacy-head-size); }
    .legacy-sub { margin-top: var(--space-lg); font-size: var(--legacy-sub-size); line-height: var(--brand-body-line-height); }
    .photo, .phototop { padding: var(--space-xxl); background-image: var(--slide-photo); background-size: cover; background-position: var(--slide-position); }
    .photo::before, .phototop::before, .photosplit::before, .splittop::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; }
    .photo::before { background: linear-gradient(to bottom, rgb(from var(--brand-surface) r g b / .62), rgb(from var(--brand-surface) r g b / .1) 45%, rgb(from var(--brand-surface) r g b / .97)); }
    .photo .slide-label, .photosplit .slide-label, .phototop .slide-label, .splittop .slide-label { display: none; }
    .photo .legacy-main { justify-content: flex-end; padding-bottom: calc(var(--space-xl) + var(--space-xxl)); }
    .photo { --legacy-head-size: var(--type-display); }
    .photosplit::after, .splittop::after { content: ""; position: absolute; z-index: 0; left: 0; right: 0; background-image: var(--slide-photo); background-size: var(--slide-photo-size); background-position: var(--slide-position); }
    .photosplit::after { top: 0; height: var(--slide-split); }
    .photosplit::before { bottom: auto; height: var(--slide-split); background: linear-gradient(to bottom, rgb(from var(--brand-surface) r g b / .3), rgb(from var(--brand-surface) r g b / 0) 35%, var(--brand-surface)); }
    .photosplit .legacy-main { justify-content: flex-end; padding-bottom: calc(var(--space-xl) + var(--space-xxl)); }
    .phototop::before { background: linear-gradient(to bottom, rgb(from var(--brand-surface) r g b / .94), rgb(from var(--brand-surface) r g b / .78) 30%, rgb(from var(--brand-surface) r g b / 0) 75%, rgb(from var(--brand-surface) r g b / .45)); }
    .phototop .legacy-main, .splittop .legacy-main { justify-content: flex-start; padding-top: var(--space-lg); }
    .splittop::after { bottom: 0; height: var(--slide-split); }
    .splittop::before { top: auto; bottom: 0; height: var(--slide-split); background: linear-gradient(to bottom, var(--brand-surface), rgb(from var(--brand-surface) r g b / .35) 25%, rgb(from var(--brand-surface) r g b / 0) 55%); }
    .cover { --legacy-head-size: 152px; } .body { --legacy-head-size: 108px; } .cta { --legacy-head-size: 120px; }
    .static, .static-light { --legacy-head-size: 116px; }
    .photosplit { --legacy-head-size: 100px; } .phototop { --legacy-head-size: 108px; } .splittop { --legacy-head-size: 96px; }
    .slide.evidence { padding: 0; }
    .slide.evidence .slide-handle { display: none; } /* the evidence frame carries its own source label there */
    .evidence-embed { position: absolute; inset: 0; }
    .static-light { background: var(--brand-paper); color: var(--slide-light-ink, var(--brand-surface)); }
    .static-light .slide-handle { color: var(--brand-muted); }
    /* Paper layouts take the accent darkened just enough to read on paper (a pale peach or gold turns deep). */
    .static-light .accent, .static-light .slide-label, .post-card .accent, .note-paper .accent { color: var(--slide-light-accent, var(--brand-accent)); }
    .static-light .slide-label::before { background: var(--slide-light-accent, var(--brand-accent)); }
    .family-main { position: relative; z-index: 2; height: 100%; }
    .stat-main, .steps-main, .quote-main { display: flex; flex-direction: column; justify-content: center; }
    .stat-number { font-family: var(--brand-display-font); font-weight: var(--brand-display-weight); font-size: 300px; line-height: .9; letter-spacing: var(--brand-display-tracking); text-transform: var(--brand-display-case); color: var(--slide-accent-text, var(--brand-accent)); }
    .stat-main h1 { font-size: 76px; margin-top: var(--space-lg); }
    .stat-sub { margin-top: var(--space-lg); font-size: var(--type-slide-body); line-height: var(--brand-body-line-height); opacity: .86; }
    .stat-source { margin-top: var(--space-lg); font-size: 26px; font-weight: 500; color: var(--brand-muted); }
    .steps-main h1 { font-size: 88px; }
    .step-list { list-style: none; margin: var(--type-lg) 0 0; padding: 0; font-size: var(--type-slide-body); }
    .step-list li { display: flex; align-items: flex-start; gap: 34px; padding-bottom: 34px; position: relative; }
    .step-list li:last-child { padding-bottom: 0; }
    .step-list li:not(:last-child)::after { content: ""; position: absolute; left: calc(0.935em - 1.5px); top: 1.75em; bottom: 6px; width: 3px; background: var(--brand-accent); opacity: .45; }
    .step-n { flex: none; width: 1.1em; font-family: var(--brand-display-font); font-weight: var(--brand-display-weight); font-size: 1.7em; line-height: .9; text-align: center; color: var(--slide-accent-text, var(--brand-accent)); }
    .step-t { font-weight: 500; line-height: 1.3; padding-top: .12em; }
    .quote-mark { height: 140px; font-family: var(--brand-display-font); font-size: 260px; line-height: .62; color: var(--slide-accent-text, var(--brand-accent)); }
    .quote-main blockquote { margin: 0; font-family: var(--brand-editorial-font, var(--brand-body-font)); font-weight: 600; font-size: 60px; line-height: 1.22; }
    .quote-by { margin-top: 48px; font-size: 30px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--slide-accent-text, var(--brand-accent)); }
    .quote-context { margin-top: 10px; font-size: 28px; color: var(--brand-muted); }
    .family-main h1 { font-size: var(--type-xl); }
    .check-list { list-style: none; margin: var(--space-xl) 0 0; padding: 0; display: grid; gap: var(--space-md); }
    .check-row { min-height: 112px; display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md); border: max(1px, calc(var(--space-xs) / 4)) solid var(--brand-stroke); border-radius: var(--brand-radius-md); background: var(--brand-surface2); }
    .check-box { flex: 0 0 48px; width: 48px; height: 48px; display: grid; place-items: center; border: max(1px, calc(var(--space-xs) / 4)) solid var(--brand-accent); border-radius: var(--brand-radius-sm); color: var(--brand-accent-ink); background: var(--brand-surface); font-size: 34px; font-weight: 700; }
    .check-row.is-checked .check-box { background: var(--brand-accent); }
    .check-copy { display: flex; flex-direction: column; gap: var(--space-xs); }
    .check-copy strong { font-size: var(--row-size); line-height: 1.12; }
    .check-copy small { color: var(--brand-muted); font-size: max(34px, var(--type-sm)); line-height: 1.2; }
    .compare-main { display: flex; flex-direction: column; gap: var(--space-lg); }
    .compare-grid { flex: 1; display: grid; gap: var(--space-md); }
    .compare-grid.side-by-side { grid-template-columns: 1fr 1fr; }
    .compare-grid.stacked { grid-template-rows: 1fr 1fr; }
    .compare-side { display: flex; flex-direction: column; justify-content: center; padding: var(--space-lg); border: max(1px, calc(var(--space-xs) / 4)) solid var(--brand-stroke); border-radius: var(--brand-radius-lg); background: var(--brand-surface2); }
    .compare-side + .compare-side { border-color: var(--brand-accent); }
    .compare-label { color: var(--slide-accent-text, var(--brand-accent)); font-size: 34px; font-weight: 700; letter-spacing: .05em; text-transform: var(--brand-body-case); }
    .compare-value { margin-top: var(--space-md); font-family: var(--brand-editorial-font, var(--brand-display-font)); font-size: var(--type-lg); line-height: 1.08; }
    .compare-note { margin-top: var(--space-md); color: var(--brand-muted); font-size: var(--type-slide-body); line-height: 1.25; }
    .decision-line { padding: var(--space-md) var(--space-lg); border-radius: var(--brand-radius-md); background: var(--brand-accent); color: var(--brand-accent-ink); font-size: var(--type-md); font-weight: 700; }
    .postcard-main { display: grid; place-items: center; }
    .post-card { width: 856px; max-height: 910px; padding: var(--space-xl); border: max(1px, calc(var(--space-xs) / 4)) solid var(--brand-stroke); border-radius: var(--brand-radius-lg); background: var(--brand-paper); color: var(--brand-stroke); box-shadow: 0 var(--space-sm) var(--space-xl) rgb(from var(--brand-stroke) r g b / .24); }
    .post-card header { display: flex; gap: var(--space-md); align-items: center; }
    .post-card header > div:last-child { display: flex; flex-direction: column; gap: var(--space-xs); }
    .post-card header strong { font-size: max(34px, var(--type-sm)); } .post-card header small, .post-card footer { color: var(--brand-muted); font-size: max(34px, var(--type-sm)); }
    .postcard-avatar { width: 64px; height: 64px; display: grid; place-items: center; overflow: hidden; border-radius: var(--brand-radius-pill); background: var(--brand-accent); color: var(--brand-accent-ink); font-size: max(34px, var(--type-sm)); font-weight: 700; }
    .postcard-avatar img { width: 100%; height: 100%; object-fit: contain; }
    .postcard-copy { margin-top: var(--space-lg); font-family: var(--brand-editorial-font, var(--brand-body-font)); font-size: var(--type-lg); line-height: 1.18; }
    .post-card footer { margin-top: var(--space-lg); padding-top: var(--space-md); border-top: max(1px, calc(var(--space-xs) / 4)) solid var(--brand-stroke); }
    .notes-main { display: grid; place-items: center; }
    .note-paper { width: 784px; min-height: 620px; padding: var(--space-xl); border-radius: var(--brand-radius-md); background: var(--brand-paper); color: var(--brand-stroke); box-shadow: 0 var(--space-sm) var(--space-xl) rgb(from var(--brand-stroke) r g b / .2); }
    .note-paper header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-md); padding-bottom: var(--space-md); border-bottom: max(1px, calc(var(--space-xs) / 4)) solid var(--brand-muted); }
    .note-paper h1 { color: var(--brand-stroke); font-family: var(--brand-editorial-font, var(--brand-display-font)); font-size: var(--type-lg); text-transform: var(--brand-editorial-case, none); }
    .note-paper time { color: var(--brand-muted); font-size: max(34px, var(--type-sm)); }
    .note-lines { margin-top: var(--space-lg); }
    .note-lines p { margin: 0; padding: var(--space-sm) 0; border-bottom: max(1px, calc(var(--space-xs) / 8)) solid var(--brand-muted); font-size: var(--type-slide-body); line-height: 1.35; }
    .story { padding: 0; }
    .story-photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .story-scrim { position: absolute; inset: 0; background: linear-gradient(to bottom, rgb(from var(--brand-surface) r g b / 0) 42%, rgb(from var(--brand-surface) r g b / .9)); }
    .story-main { position: absolute; z-index: 2; left: var(--space-xxl); right: var(--space-xxl); bottom: calc(var(--space-xxl) + var(--space-xl)); }
    .story-chapter { margin-bottom: var(--space-md); color: var(--slide-accent-text, var(--brand-accent)); font-size: max(34px, var(--type-sm)); font-weight: 700; }
    .story-caption { max-width: 888px; padding: var(--space-lg); border-radius: var(--brand-radius-md); background: rgb(from var(--brand-surface) r g b / .84); color: var(--brand-ink); font-size: var(--type-lg); line-height: 1.18; }
    .evidence-main { display: grid; place-items: center; }
    .evidence-main figure { width: 888px; margin: 0; }
    .evidence-frame { max-height: 880px; padding: var(--space-md); overflow: hidden; border: max(1px, calc(var(--space-xs) / 2)) solid var(--brand-accent); border-radius: var(--brand-radius-lg); background: var(--brand-surface2); }
    .evidence-frame img { display: block; width: 100%; max-height: 830px; object-fit: contain; border-radius: var(--brand-radius-md); }
    .evidence-main figcaption { margin-top: var(--space-md); color: var(--brand-muted); font-size: 34px; line-height: 1.2; }
    .cover-top, .cover-doc, .cover-card, .cover-compare, .cover-list { padding: 0; background-image: var(--slide-photo); background-size: cover; background-position: var(--slide-position); }
    .cover-top-scrim { position: absolute; z-index: 1; left: calc(var(--space-xxl) - var(--space-md)); right: calc(var(--space-xxl) - var(--space-md)); top: calc(var(--space-xl) + var(--space-md)); height: calc(var(--space-xxl) * 5 + var(--space-xl)); background: linear-gradient(to bottom, rgb(from var(--brand-surface) r g b / .72), rgb(from var(--brand-surface) r g b / .65) 72%, rgb(from var(--brand-surface) r g b / 0)); border-radius: var(--brand-radius-md) var(--brand-radius-md) 0 0; }
    .cover-top-main { position: absolute; z-index: 2; left: calc(var(--space-xxl) - var(--space-md)); right: calc(var(--space-xxl) - var(--space-md)); top: calc(var(--space-xl) + var(--space-md)); padding: var(--space-lg); color: var(--brand-ink); }
    .cover-top-main h1, .cover-list-main h1, .cover-card-panel h1, .cover-doc-card h1, .cover-compare-main h1, .verdict-main h1, .script-main h1 { margin: 0; font-family: var(--brand-display-font); font-weight: var(--brand-display-weight); line-height: var(--brand-display-line-height); letter-spacing: var(--brand-display-tracking); text-transform: var(--brand-display-case); }
    .cover-top-main h1 { max-width: 100%; font-size: var(--type-display); }
    .cover-top-sub, .cover-list-sub, .cover-card-sub { margin-top: var(--space-md); font-size: var(--type-slide-body); line-height: var(--brand-body-line-height); }
    .cover-doc-main { position: absolute; z-index: 2; inset: var(--space-xxl); display: flex; }
    .cover-doc-main.corner-tl { align-items: flex-start; justify-content: flex-start; } .cover-doc-main.corner-tr { align-items: flex-start; justify-content: flex-end; }
    .cover-doc-main.corner-bl { align-items: flex-end; justify-content: flex-start; } .cover-doc-main.corner-br { align-items: flex-end; justify-content: flex-end; }
    .cover-doc-card { max-width: calc(var(--space-xxl) * 7); padding: var(--space-lg); border-top: var(--space-xs) solid var(--brand-accent); border-radius: var(--brand-radius-md); background: var(--brand-surface); color: var(--brand-ink); }
    .cover-doc-card h1 { font-size: var(--type-lg); }
    .cover-card-main { position: absolute; z-index: 2; inset: 0; display: flex; align-items: center; padding: calc(var(--space-xxl) + var(--space-md)) var(--space-xl); }
    .cover-card-main.side-left { justify-content: flex-start; } .cover-card-main.side-right { justify-content: flex-end; }
    .cover-card-panel { width: calc(var(--space-xxl) * 4 + var(--space-md)); min-height: calc(var(--space-xxl) * 9 + var(--space-lg)); display: flex; flex-direction: column; justify-content: center; padding: var(--space-xl) var(--space-lg); border-top: var(--space-xs) solid var(--brand-accent); border-radius: var(--brand-radius-md); background: var(--brand-surface); color: var(--brand-ink); }
    .cover-card-panel h1 { font-size: var(--type-xl); }
    .cover-compare { background-image: none; background-color: var(--brand-surface); }
    .cover-compare::before { content: ""; position: absolute; inset: 0 0 auto; height: calc(var(--space-xxl) * 5 + var(--space-xl) + var(--space-sm)); background-image: var(--slide-photo); background-size: cover; background-position: var(--slide-position); }
    .cover-compare-main { position: absolute; z-index: 2; inset: calc(var(--space-xxl) * 5 + var(--space-xl) + var(--space-sm)) 0 0; display: flex; flex-direction: column; padding: var(--space-lg) var(--space-xxl) calc(var(--space-xxl) + var(--space-xl)); background: var(--brand-surface); }
    .cover-compare-main h1 { margin-bottom: var(--space-md); font-size: var(--type-lg); }
    .cover-compare-panels { min-height: 0; flex: 1; display: grid; grid-template-rows: 1fr 1fr; gap: var(--space-md); }
    .cover-compare-panel { display: flex; flex-direction: column; justify-content: center; padding: var(--space-md) var(--space-lg); border-top: calc(var(--space-xs) / 2) solid var(--brand-stroke); border-radius: var(--brand-radius-md); background: var(--brand-surface2); }
    .cover-compare-panel.is-decision { border-top: var(--space-xs) solid var(--brand-accent); }
    .cover-compare-label { color: var(--brand-muted); font-size: var(--type-sm); font-weight: 700; letter-spacing: var(--brand-body-tracking); text-transform: var(--brand-body-case); }
    .cover-compare-value { margin-top: var(--space-sm); font-family: var(--brand-display-font); font-size: var(--type-lg); line-height: var(--brand-display-line-height); text-transform: var(--brand-display-case); }
    .cover-list { background-image: none; background-color: var(--brand-surface); }
    .cover-list::before { content: ""; position: absolute; inset: 40% 0 0; background-image: var(--slide-photo); background-size: cover; background-position: var(--slide-position); }
    .cover-list-main { position: absolute; z-index: 2; inset: 0 0 60%; display: flex; flex-direction: column; justify-content: center; padding: var(--space-xl) var(--space-xxl); background: var(--brand-surface); color: var(--brand-ink); border-bottom: var(--space-xs) solid var(--brand-accent); }
    .cover-list-main h1 { font-size: var(--type-display); }
    .verdict.is-light, .note, .script.is-light { background: var(--brand-paper); color: var(--slide-light-ink, var(--brand-surface)); }
    .verdict.is-light .accent, .note .accent, .script.is-light .accent { color: var(--slide-light-accent, var(--brand-accent)); }
    .verdict-main { display: flex; align-items: center; }
    .verdict-main h1 { max-width: 65%; font-size: calc(var(--type-display) + var(--type-md)); }
    .note-main { display: flex; flex-direction: column; justify-content: center; padding-right: var(--space-xl); }
    .note-rule, .script-rule { width: calc(var(--space-xl) + var(--space-xs)); height: calc(var(--space-xs) * .75); margin-bottom: var(--space-lg); border-radius: var(--brand-radius-sm); background: var(--slide-light-accent, var(--brand-accent)); }
    .note-label, .script-label { margin-bottom: var(--space-md); color: var(--slide-light-accent, var(--brand-accent)); font-size: var(--type-sm); font-weight: 700; letter-spacing: var(--brand-body-tracking); text-transform: var(--brand-body-case); }
    .note-text { font-size: calc(var(--type-lg) + var(--space-xs)); line-height: var(--brand-body-line-height); font-weight: 500; }
    .script-main { display: flex; flex-direction: column; justify-content: center; }
    .script-main h1 { max-width: 86%; font-size: var(--type-xl); }
    .script-card { margin-top: var(--space-xl); padding: var(--space-lg); border-radius: var(--brand-radius-md); background: var(--brand-surface2); color: var(--brand-ink); }
    .script.is-light .script-card { background: var(--brand-surface); color: var(--brand-ink); }
    .script-say { font-size: calc(var(--type-slide-body) + var(--space-xs) / 2); line-height: var(--brand-body-line-height); font-weight: 500; }
    @media (max-height: 1080px) {
      .slide { padding: var(--space-xl); }
      .slide-handle { left: var(--space-xl); bottom: var(--space-lg); }
      .family-main h1 { font-size: var(--type-lg); }
      .check-list { margin-top: var(--space-lg); gap: var(--space-sm); }
      .check-row { min-height: 88px; padding: var(--space-sm); }
      .post-card { max-height: 780px; }
      .story-main { left: var(--space-xl); right: var(--space-xl); bottom: calc(var(--space-xl) + var(--space-lg)); }
    }
  `;
}

function textFitScript() {
  return `<script type="application/json" id="slide-fit-report"></script><script type="module">
    (async () => {
      const fitTextSize = ${fitTextSize.toString()};
      function fitSlides() {
        const slides = [];
        document.querySelectorAll(".slide").forEach((slide, index) => {
          const targets = [...slide.querySelectorAll("[data-fit-role]")].sort((a, b) => (a.dataset.fitRole === "headline" ? 0 : 1) - (b.dataset.fitRole === "headline" ? 0 : 1));
          slide.removeAttribute("data-fit");
          slide.removeAttribute("data-overflow");
          for (const el of targets) {
            if (!el.dataset.fitBase) el.dataset.fitBase = String(Math.floor(parseFloat(getComputedStyle(el).fontSize)));
            el.style.removeProperty("font-size");
            el.removeAttribute("data-fit");
          }
          const elementFits = (el) => {
            const rect = el.getBoundingClientRect();
            const slideRect = slide.getBoundingClientRect();
            const scope = el.closest(".legacy-main,.family-main,.story-main") || slide;
            const boxes = [...scope.querySelectorAll("[data-fit-role],.compare-label,.story-chapter")]
              .filter((node) => getComputedStyle(node).display !== "none")
              .map((node) => node.getBoundingClientRect());
            const footer = slide.querySelector(".slide-handle");
            // Measure the handle's painted text, not its padded box: layouts like compare put their decision bar right above it.
            const footerText = footer ? (() => { const range = document.createRange(); range.selectNodeContents(footer); return range.getBoundingClientRect(); })() : null;
            // Overlap means content reaching into the handle's letters (past half their height); a bar pinned just above it is fine.
            const footerTop = footer && getComputedStyle(footer).display !== "none" && footerText && footerText.height ? footerText.top + footerText.height / 2 : slideRect.bottom;
            const contentBottom = boxes.length ? Math.max(...boxes.map((box) => box.bottom)) : rect.bottom;
            // No scrollHeight test: display faces like Anton (line-height .95) always paint past their own line box.
            // What matters is a word wider than its box, text leaving the slide, or copy running into the handle row.
            return el.scrollWidth <= el.clientWidth + 1
              && rect.left >= slideRect.left - 1 && rect.right <= slideRect.right + 1 && rect.top >= slideRect.top - 1
              && contentBottom <= footerTop + 1;
          };
          const changed = [];
          for (const el of targets) {
            const base = Number(el.dataset.fitBase);
            const result = fitTextSize(base, (size) => { el.style.fontSize = size + "px"; return elementFits(el); });
            if (result.shrunk) {
              el.style.fontSize = result.size + "px";
              const value = base + "->" + result.size;
              el.dataset.fit = value;
              changed.push({ role: el.dataset.fitRole, from: base, to: result.size });
            } else {
              el.style.removeProperty("font-size");
            }
          }
          const overflow = targets.some((el) => !elementFits(el));
          if (changed.length) slide.dataset.fit = changed.map((item) => item.role + ":" + item.from + "->" + item.to).join(",");
          if (overflow) slide.dataset.overflow = "1";
          slides.push({ index, fit: changed, overflow });
        });
        const report = { slides };
        window.__SLIDE_FIT_REPORT__ = report;
        const output = document.getElementById("slide-fit-report");
        if (output) output.textContent = JSON.stringify(report);
        return report;
      }
      fitSlides();
      window.__SLIDE_FIT_READY__ = document.fonts ? document.fonts.ready.then(fitSlides) : Promise.resolve(fitSlides());
      await window.__SLIDE_FIT_READY__;
    })();
  </script>`;
}

/** The CSS headline size of each legacy kind, and how many lines it may take before it is set smaller. */
export const LEGACY_HEAD = { photo: [112, 4], photosplit: [100, 3], phototop: [108, 4], splittop: [96, 3], cover: [152, 4], body: [108, 3], cta: [120, 3], static: [116, 4], "static-light": [116, 4] };

/**
 * A legacy headline that would run past its kind's lines at the kind's size (a long sentence-case headline from a
 * client's copy) is set smaller, never under 56 px; one that fits keeps the kind's size (null: no override).
 * Estimate: a display glyph is about half the font size wide on the 888 px measure.
 */
export function legacyHeadSize(kind, headline) {
  const spec = LEGACY_HEAD[kind];
  const length = clean(String(headline ?? "").replace(/\*/g, "")).length;
  if (!spec || !length) return null;
  const [base, lines] = spec;
  const fits = (size) => Math.ceil(length / (888 / (0.5 * size))) <= lines;
  if (fits(base)) return null;
  let size = base;
  while (size > 56 && !fits(size)) size -= 4;
  return Math.max(56, size);
}

/** One complete, deterministic HTML page for a 1080-wide slide. */
export function slideHTML(slide, tokens, options = {}) {
  const t = resolveBrandTokens({ brand: tokens });
  const kind = kindOf(slide);
  const height = Number(slide.__height || options.height || 1350);
  const balance = typeBalanceEnabled(t, options.typeBalance);
  const staticKinds = new Set(["static", "static-light", "verdict", "note", "script"]);
  const signature = options.signature === false ? "" : signatureHTML(t, { format: staticKinds.has(kind) ? "static" : "carousel", width: SLIDE_WIDTH, height });
  let content;
  if (LEGACY_SLIDE_KINDS.includes(kind)) content = legacyMarkup(slide);
  else if (kind === "checklist") content = checklistMarkup(slide);
  else if (kind === "compare") content = compareMarkup(slide);
  else if (kind === "postcard") content = postcardMarkup(slide, t);
  else if (kind === "notes") content = notesMarkup(slide);
  else if (kind === "story") content = storyMarkup(slide);
  else if (kind === "stat") content = statMarkup(slide);
  else if (kind === "steps") content = stepsMarkup(slide);
  else if (kind === "quote") content = quoteMarkup(slide);
  else if (kind === "cover-top") content = coverTopMarkup(slide);
  else if (kind === "cover-doc") content = coverDocMarkup(slide);
  else if (kind === "cover-card") content = coverCardMarkup(slide);
  else if (kind === "cover-compare") content = coverCompareMarkup(slide);
  else if (kind === "cover-list") content = coverListMarkup(slide);
  else if (kind === "verdict") content = verdictMarkup(slide);
  else if (kind === "note") content = noteMarkup(slide);
  else if (kind === "script") content = scriptMarkup(slide);
  else if (kind === "evidence" && options.evidenceHTML) {
    try {
      const doc = options.evidenceHTML({ ...slide, src: slide.src || slide.image || slide.file, label: slide.label || slide.sourceLabel }, t, { width: SLIDE_WIDTH, height });
      if (typeof doc !== "string") throw new Error("evidenceSlideHTML did not return HTML");
      // The module returns a whole page: keep its own rules (minus the page reset) and its body inside this slide.
      const rules = (doc.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "").replace(/html,\s*body\s*\{[^}]*\}/, "");
      content = `<style>${rules}</style><div class="evidence-embed">${doc.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] || doc}</div>`;
    } catch (error) {
      warn(`evidence slide: ${error.message}; using the plain framed card`);
      content = evidenceFallbackMarkup(slide);
    }
  } else content = evidenceFallbackMarkup(slide);
  const photo = slide.photo || slide.image || "";
  const split = Math.max(0, Number(slide.split || 700));
  const suppliedPosition = String(slide.pos ?? "").trim();
  const explicitPosition = suppliedPosition && suppliedPosition.toLowerCase() !== "auto";
  const position = explicitPosition ? suppliedPosition : slide.__autoPosition || (kind === "photo" ? "center top" : kind.startsWith("cover-") ? "center center" : "center 30%"); // legacy kinds keep their old default crop
  const paper = t.colors?.paper || "#FFFFFF";
  const lightInk = [t.colors?.surface, t.colors?.stroke, t.colors?.ink].filter(Boolean).sort((a, b) => contrast(b, paper) - contrast(a, paper))[0];
  const lightAccent = readableOn(t.colors?.accent || lightInk, paper);
  // Accent words, labels and numbers are large type: on a light background a pale accent darkens to 3:1 (fills keep it).
  const accentText = readableOn(t.colors?.accent || t.colors?.ink, t.colors?.surface || "#0B0B0D", 3);
  const pingelLegacyBody = clean(t.identity?.handle).toLowerCase() === "@officialgregpingel";
  const legacySubSize = pingelLegacyBody ? (kind === "photosplit" ? 36 : kind === "splittop" ? 34 : 40) : Number(t.typeScale?.slideBody || 42);
  const style = `--slide-height:${height}px;--slide-light-ink:${lightInk};--slide-light-accent:${lightAccent};--slide-accent-text:${accentText};--slide-photo:url(&quot;${esc(photo)}&quot;);--slide-position:${esc(position)};--slide-split:${split}px;--slide-photo-size:${esc(slide.size || "cover")};--legacy-sub-size:${legacySubSize}px;`
    + (legacyHeadSize(kind, slide.headline || slide.title) ? `--legacy-head-size:${legacyHeadSize(kind, slide.headline || slide.title)}px;` : "");
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${SLIDE_WIDTH}, height=${height}" /><style>${tokensCSS(t)}\n${slideRules()}\n${signatureRulesCSS()}\n${options.evidenceCSS || ""}</style></head>
<body><section class="slide ${esc(kind)}${balance ? " type-balance" : ""}${slide.light ? " is-light" : ""}" style="${style}">${content}${signature}${commonFooter(t)}</section>${options.fitScript === false ? "" : textFitScript()}</body></html>`;
}

function resolveFile(file, roots) {
  if (!file || /^(?:data:|https?:)/i.test(file)) return null;
  if (path.isAbsolute(file) && fs.existsSync(file)) return file;
  for (const root of roots) {
    const candidate = path.resolve(root, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function copyAsset(file, projectDir, roots, prefix, index) {
  const source = resolveFile(file, roots);
  if (!source) return file;
  const ext = path.extname(source) || ".png";
  const relative = `assets/img/${prefix}-${index}${ext}`;
  fs.copyFileSync(source, path.join(projectDir, relative));
  return relative;
}

function autoCropGeometry(slide, height) {
  const split = Math.min(height, Math.max(1, Number(slide.split || 700)));
  if (slide.kind === "photo") return {
    visible: { x: 0, y: 0, w: SLIDE_WIDTH, h: height },
    avoid: { x: 0, y: height * 0.45, w: SLIDE_WIDTH, h: height * 0.55 },
  };
  if (slide.kind === "phototop") return {
    visible: { x: 0, y: 0, w: SLIDE_WIDTH, h: height },
    avoid: { x: 0, y: 0, w: SLIDE_WIDTH, h: height * 0.45 },
  };
  if (slide.kind === "cover-top") return {
    visible: { x: 0, y: 0, w: SLIDE_WIDTH, h: height },
    avoid: { x: 72, y: 88, w: 936, h: 390 },
  };
  if (slide.kind === "cover-card") {
    const side = slide.side || slide.__autoSide || "right";
    return { visible: { x: 0, y: 0, w: SLIDE_WIDTH, h: height }, avoid: { x: side === "left" ? 40 : 632, y: 120, w: 408, h: 900 } };
  }
  if (slide.kind === "cover-compare") return { visible: { x: 0, y: 0, w: SLIDE_WIDTH, h: 560 }, avoid: null };
  if (slide.kind === "cover-list") return { visible: { x: 0, y: height * 0.4, w: SLIDE_WIDTH, h: height * 0.6 }, avoid: null };
  if (slide.kind === "cover-doc") return { visible: { x: 0, y: 0, w: SLIDE_WIDTH, h: height }, avoid: null };
  return { visible: { x: 0, y: 0, w: SLIDE_WIDTH, h: split }, avoid: null };
}

async function automaticPhotoPositions(slides, roots, height) {
  const wanted = slides.map((slide, index) => {
    const supplied = String(slide.pos ?? "").trim();
    const needsCrop = !(supplied && supplied.toLowerCase() !== "auto");
    const needsFurniture = (slide.kind === "cover-card" && !slide.side) || (slide.kind === "cover-doc" && !slide.corner);
    if (!PHOTO_SLIDE_KINDS.has(slide.kind) || (!needsCrop && !needsFurniture)) return null;
    const file = resolveFile(slide.photo || slide.image, roots);
    return file ? { index, file, slide, needsCrop, needsFurniture } : null;
  }).filter(Boolean);
  if (!wanted.length) return new Map();
  try {
    const reports = await detectPhotos([...new Set(wanted.map((item) => item.file))]);
    const byFile = new Map(reports.map((report) => [report.file, report]));
    const placements = new Map();
    let unreadable = false;
    for (const item of wanted) {
      const report = byFile.get(item.file);
      if (!report || report.error) unreadable = true;
      const furniture = item.needsFurniture ? faceAwareFamilyPlacement(report?.faces, report) : null;
      const placedSlide = furniture ? { ...item.slide, __autoSide: furniture.side, __autoCorner: furniture.corner } : item.slide;
      const geometry = autoCropGeometry(placedSlide, height);
      const position = item.needsCrop ? faceAwareObjectPosition(report, report?.faces, geometry.visible, geometry.avoid) : null;
      if (position || furniture) placements.set(item.index, { position, ...furniture });
    }
    if (unreadable) warn("slides: one or more photos could not be read for face-aware crop; using the established position for those photos");
    return placements;
  } catch (error) {
    warn(`slides: face-aware crop unavailable: ${error.message}; using the established positions`);
    return new Map();
  }
}

function projectTokens(tokens, projectDir, roots) {
  const out = structuredClone(tokens);
  ensureDir(path.join(projectDir, "assets", "fonts"));
  const copied = new Map();
  for (const [role, spec] of Object.entries(out.type || {})) {
    if (!spec?.file) continue;
    const source = resolveFile(spec.file, roots);
    if (!source) continue;
    let relative = copied.get(source);
    if (!relative) {
      const ext = path.extname(source) || ".ttf";
      relative = `assets/fonts/${role}${ext}`;
      fs.copyFileSync(source, path.join(projectDir, relative));
      copied.set(source, relative);
    }
    spec.file = relative;
  }
  const logo = out.identity?.logo;
  if (typeof logo === "string") out.identity.logo = copyAsset(logo, projectDir, roots, "identity", 0);
  return out;
}

function compositionHTML(slides, tokens, options) {
  const pages = slides.map((slide, index) => {
    const html = slideHTML(slide, tokens, { ...options, fitScript: false });
    const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1] || "";
    return `<div class="clip-page clip" data-start="${index}" data-duration="1" data-track-index="0">${body}</div>`;
  }).join("\n");
  const one = slideHTML({ kind: "body", headline: "" }, tokens, { ...options, fitScript: false });
  const css = one.match(/<style>([\s\S]*)<\/style>/)?.[1] || "";
  return `<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=${SLIDE_WIDTH}, height=${options.height}" /><script src="assets/vendor/gsap.min.js"></script><style>${css}\n#root { position:relative; width:${SLIDE_WIDTH}px; height:${options.height}px; overflow:hidden; } .clip-page { position:absolute; inset:0; }</style></head><body><div id="root" data-composition-id="slides" data-start="0" data-width="${SLIDE_WIDTH}" data-height="${options.height}" data-duration="${slides.length}" data-fps="30">${pages}</div>${textFitScript()}<script>window.__timelines=window.__timelines||{};window.__timelines.slides=gsap.timeline({paused:true});</script></body></html>`;
}

async function evidenceExtension() {
  const file = fileURLToPath(new URL("./evidence.mjs", import.meta.url));
  if (!fs.existsSync(file)) return {};
  try {
    const module = await import("./evidence.mjs");
    return { evidenceHTML: module.evidenceSlideHTML, evidenceCSS: typeof module.evidenceSlideCSS === "function" ? module.evidenceSlideCSS() : module.evidenceSlideCSS || "" };
  } catch (error) {
    warn(`evidence slide: ${error.message}; using the plain framed card`);
    return {};
  }
}

function authoredBrand(brand) {
  if (!brand) return { tokens: loadPreset("pingel-brand").brand, root: PKG_ROOT };
  if (typeof brand === "string") {
    const file = path.resolve(brand);
    return { tokens: resolveBrandTokens({ brand: JSON.parse(fs.readFileSync(file, "utf8")) }), root: path.dirname(file) };
  }
  return { tokens: resolveBrandTokens({ brand }), root: PKG_ROOT };
}

function chromeExecutable() {
  const candidates = [
    process.env.REEL_CHROME,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  const installed = candidates.find((file) => fs.existsSync(file));
  if (installed) return installed;
  const cached = path.join(os.homedir(), ".cache", "hyperframes", "chrome");
  const find = (dir, depth = 0) => {
    if (depth > 5) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isFile() && /^(?:chrome|chrome-headless-shell)$/i.test(entry.name)) return file;
      if (entry.isDirectory()) { const nested = find(file, depth + 1); if (nested) return nested; }
    }
    return null;
  };
  return find(cached);
}

async function readFitReport(projectDir) {
  const executablePath = chromeExecutable();
  if (!executablePath) throw new Error("Chrome was not found");
  const profile = ensureDir(path.join(projectDir, ".fit-browser"));
  const { out } = await run(executablePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--allow-file-access-from-files",
    `--user-data-dir=${profile}`,
    "--dump-dom",
    pathToFileURL(path.join(projectDir, "index.html")).href,
  ], { capture: true });
  const encoded = out.match(/<script type="application\/json" id="slide-fit-report">([\s\S]*?)<\/script>/)?.[1];
  if (!encoded) throw new Error("Chrome did not return the fit report");
  return JSON.parse(encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
}

function renderedFiles(files, fitReport) {
  const fit = (fitReport?.slides || []).flatMap((slide) => (slide.fit || []).map((item) => ({ index: slide.index, file: files[slide.index], ...item })));
  const overflow = (fitReport?.slides || []).filter((slide) => slide.overflow).map((slide) => ({ index: slide.index, file: files[slide.index] }));
  Object.defineProperties(files, {
    fit: { value: fit, enumerable: false },
    overflow: { value: overflow, enumerable: false },
    report: { value: { fit, overflow }, enumerable: false },
  });
  return files;
}

/** Render a compatibility spec through HyperFrames and print-safe PNG snapshots. */
export async function renderSlides(spec, { brand, outDir, signature = true, warnings = true } = {}) {
  const normalized = normalizeSlideSpec(spec);
  const expanded = expandSlides(normalized.slides);
  if (warnings) checkSequence(expanded).forEach((message) => warn(`slides: ${message}`));
  const requestedOut = outDir || normalized.out_dir || normalized.outDir;
  if (!requestedOut) throw new Error("slide spec needs out_dir or renderSlides needs outDir");
  const destination = path.resolve(requestedOut);
  ensureDir(destination);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-slides-"));
  try {
    const projectDir = ensureDir(path.join(temp, "project"));
    ensureDir(path.join(projectDir, "assets", "img"));
    ensureDir(path.join(projectDir, "assets", "vendor"));
    fs.copyFileSync(path.join(PKG_ROOT, "assets", "vendor", "gsap.min.js"), path.join(projectDir, "assets", "vendor", "gsap.min.js"));
    const resolved = authoredBrand(brand);
    const roots = [resolved.root, PKG_ROOT, process.cwd()];
    const tokens = projectTokens(resolved.tokens, projectDir, roots);
    const autoPositions = await automaticPhotoPositions(expanded, roots, normalized.height);
    const placed = expanded.map((source, index) => {
      const auto = autoPositions.get(index);
      const slide = { ...source, __height: normalized.height, ...(auto?.position ? { __autoPosition: auto.position } : {}), ...(auto?.side ? { __autoSide: auto.side } : {}), ...(auto?.corner ? { __autoCorner: auto.corner } : {}) };
      if (slide.kind === "story" && !resolveFile(slide.photo || slide.image, roots)) throw new Error(`story slide ${index + 1} photo file not found: ${slide.photo || slide.image}`);
      if (slide.kind === "evidence" && !resolveFile(assetValue(slide), roots)) throw new Error(`evidence slide ${index + 1} image file not found: ${assetValue(slide)}`);
      for (const key of ["photo", "image", "screenshot", "file", "avatar"]) if (slide[key]) slide[key] = copyAsset(slide[key], projectDir, roots, `slide-${index + 1}-${key}`, index + 1);
      return slide;
    });
    const evidence = await evidenceExtension();
    fs.writeFileSync(path.join(projectDir, "index.html"), compositionHTML(placed, tokens, { ...evidence, height: normalized.height, signature }));
    let fitReport = { slides: [] };
    try {
      fitReport = await readFitReport(projectDir);
    } catch (error) {
      warn(`slides: text fit report unavailable: ${error.message}; the in-page fitter will still run during capture`);
    }
    const { snapshotSlides } = await import("./carousel.mjs");
    const shots = await snapshotSlides(projectDir, placed.length, path.join(temp, "shots"));
    const files = shots.map((source, index) => {
      const target = path.join(destination, `${String(index + 1).padStart(2, "0")}.png`);
      fs.copyFileSync(source, target);
      return target;
    });
    return renderedFiles(files, fitReport);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/** Deterministic review fixture covering every legacy and semantic family. */
export function sampleSlidesSpec(photo) {
  return {
    width: 1080,
    height: 1350,
    slides: [
      { kind: "photo", headline: "A *REAL PHOTO*", photo },
      { kind: "photosplit", headline: "PHOTO *SPLIT*", sub: "A compatibility sample.", photo },
      { kind: "phototop", headline: "PHOTO *TOP*", photo },
      { kind: "splittop", headline: "SPLIT *TOP*", sub: "A compatibility sample.", photo },
      { kind: "cover", label: "SAMPLE", headline: "COVER *FAMILY*" },
      { kind: "body", label: "SAMPLE", headline: "BODY *FAMILY*", sub: "A compatibility sample." },
      { kind: "cta", label: "SAMPLE", headline: "ONE *USEFUL* CLOSE" },
      { kind: "static", label: "SAMPLE", headline: "STATIC *DARK*" },
      { kind: "static-light", label: "SAMPLE", headline: "STATIC *LIGHT*" },
      { kind: "checklist", title: "REVIEW *CHECKLIST*", items: ["Clear promise", "Second entry point", "One job per slide"] },
      { kind: "compare", title: "COMPARE *OPTIONS*", left: { label: "FIRST", value: "One clear choice" }, right: { label: "SECOND", value: "Another clear choice" }, decisionLine: "Choose the one that fits the evidence." },
      { kind: "postcard", postText: "This is a brand-styled sample card with no platform metrics." },
      { kind: "notes", title: "Sample notes", date: "Review copy", lines: ["One idea per line.", "The brand owns the visual language."] },
      { kind: "story", photo, focalPoint: { x: 0.5, y: 0.4 }, chapter: "SAMPLE", caption: "A documentary frame uses a file named in the spec." },
      { kind: "evidence", image: photo, sourceLabel: "Golden frame fixture" },
      { kind: "stat", number: "3", headline: "SUPPLIED *SAMPLE* POINTS", source: "Sample fixture" },
      { kind: "steps", headline: "THREE *SAMPLE* STEPS", steps: ["Start with the supplied fact", "Show the useful decision", "Close with one clear action"] },
      { kind: "quote", quote: "A supplied sample quote stays attributed.", by: "Sample Coach" },
      { kind: "cover-top", photo, headline: "A *TOP* COVER USES LOCAL CONTRAST", sub: "The photo remains visible below." },
      { kind: "cover-doc", photo, headline: "REAL WORK SHOWN" },
      { kind: "cover-card", photo, headline: "THE *BRIEF CARD* SITS BESIDE THE FACE", sub: "Every value comes from the resolved brand tokens." },
      { kind: "cover-compare", photo, headline: "CHOOSE THE USEFUL PATH", left: { label: "OLD WAY", text: "Wait for later" }, right: { label: "DECISION", text: "Act while clear" }, decision: "right" },
      { kind: "cover-list", photo, headline: "FIVE *USEFUL* POINTS TO KEEP", sub: "One promise above the real photo." },
      { kind: "verdict", headline: "THE *CLEAR* DECISION BEATS MORE NOISE" },
      { kind: "note", label: "KEEP THIS", text: "A short useful note leaves the rest of the slide quiet." },
      { kind: "script", label: "SAY THIS INSTEAD", headline: "STOP ASKING IF THEY NEED MORE TIME", say: "Ask which part of the decision still feels unclear right now." },
    ],
  };
}

export async function renderSlideSamples(outDir) {
  const photo = path.join(PKG_ROOT, "test", "golden", "frame-01.png");
  const targets = [
    ["pingel", path.join(PKG_ROOT, "brands", "pingel.json")],
    ["calm", path.join(PKG_ROOT, "test", "fixtures", "brand-calm-v1.json")],
  ];
  const files = [];
  for (const [name, brand] of targets) {
    const rendered = await renderSlides(sampleSlidesSpec(photo), { brand, outDir: path.join(path.resolve(outDir), name) });
    files.push(...rendered);
  }
  return files;
}
