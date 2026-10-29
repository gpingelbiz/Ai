import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBrandTokens, tokensCSS, contrast } from "./brandtokens.mjs";
import { loadPreset } from "./presets.mjs";
import { signatureHTML, signatureRulesCSS } from "./signature.mjs";
import { esc } from "./text.mjs";
import { ensureDir, PKG_ROOT, warn } from "./util.mjs";

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHTS = new Set([1080, 1350]);
export const LEGACY_SLIDE_KINDS = ["photo", "photosplit", "phototop", "splittop", "cover", "body", "cta", "static", "static-light"];
export const FAMILY_SLIDE_KINDS = ["checklist", "compare", "postcard", "notes", "story", "evidence"];
export const SLIDE_KINDS = [...LEGACY_SLIDE_KINDS, ...FAMILY_SLIDE_KINDS];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const words = (value) => clean(String(value ?? "").replace(/\*/g, "")).split(/\s+/).filter(Boolean);
const kindOf = (slide) => clean(slide?.kind || "body").toLowerCase();
const assetValue = (slide) => slide.photo || slide.image || slide.screenshot || slide.file || "";

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
  const out = [slide.headline, slide.title, slide.sub, slide.body, slide.text, slide.postText, slide.caption, slide.decisionLine, slide.label, slide.sourceLabel, slide.date];
  for (const item of slide.items || []) out.push(typeof item === "string" ? item : item?.text, item?.note);
  for (const side of [slide.left, slide.right]) out.push(typeof side === "string" ? side : side?.label, side?.value, side?.note);
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

function legacyMarkup(slide) {
  const kind = kindOf(slide);
  const headline = accentHTML(slide.headline || slide.title);
  const sub = slide.sub || slide.body ? `<div class="legacy-sub">${accentHTML(slide.sub || slide.body)}</div>` : "";
  return `${commonHeader(slide)}<main class="legacy-main"><h1 class="legacy-head">${headline}</h1>${sub}</main>`;
}

function checklistMarkup(slide) {
  const rowSize = Math.min(...fittedTextSizes(slide).filter((x) => x.role === "checklist row").map((x) => x.size), 42);
  const rows = slide.items.map((item) => `<li class="check-row${item.checked ? " is-checked" : ""}" style="--row-size:${rowSize}px"><span class="check-box" aria-hidden="true">${item.checked ? "✓" : ""}</span><span class="check-copy"><strong>${accentHTML(item.text)}</strong>${item.note ? `<small>${accentHTML(item.note)}</small>` : ""}</span></li>`).join("");
  return `<main class="family-main checklist-main"><h1>${accentHTML(slide.title || slide.headline)}</h1><ul class="check-list">${rows}</ul></main>`;
}

function sideMarkup(side, fallbackLabel) {
  return `<section class="compare-side"><div class="compare-label">${accentHTML(side?.label || fallbackLabel)}</div><div class="compare-value">${accentHTML(side?.value)}</div>${side?.note ? `<div class="compare-note">${accentHTML(side.note)}</div>` : ""}</section>`;
}

function compareMarkup(slide) {
  const beforeAfter = slide.before != null || slide.after != null;
  const left = beforeAfter ? (typeof slide.before === "object" ? slide.before : { label: slide.beforeLabel || "", value: slide.before }) : slide.left;
  const right = beforeAfter ? (typeof slide.after === "object" ? slide.after : { label: slide.afterLabel || "", value: slide.after }) : slide.right;
  const orientation = slide.orientation === "stacked" ? "stacked" : "side-by-side";
  return `<main class="family-main compare-main"><h1>${accentHTML(slide.title || slide.headline)}</h1><div class="compare-grid ${orientation}">${sideMarkup(left, slide.leftLabel)}${sideMarkup(right, slide.rightLabel)}</div>${slide.decisionLine ? `<div class="decision-line">${accentHTML(slide.decisionLine)}</div>` : ""}</main>`;
}

function initials(name) {
  return clean(name).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function postcardMarkup(slide, tokens) {
  const name = clean(slide.name || tokens.identity?.name);
  const handle = clean(slide.handle || tokens.identity?.handle);
  const logo = clean(tokens.identity?.logo);
  const avatar = logo ? `<img src="${esc(logo)}" alt="" />` : `<span>${esc(initials(name || handle))}</span>`;
  return `<main class="family-main postcard-main"><article class="post-card"><header><div class="postcard-avatar">${avatar}</div><div><strong>${esc(name)}</strong>${handle ? `<small>${esc(handle)}</small>` : ""}</div></header><div class="postcard-copy">${accentHTML(slide.postText || slide.text || slide.body)}</div>${slide.metadata ? `<footer>${accentHTML(slide.metadata)}</footer>` : ""}</article></main>`;
}

function notesMarkup(slide) {
  const lines = Array.isArray(slide.lines) ? slide.lines : clean(slide.text || slide.body).split(/\n+/).filter(Boolean);
  return `<main class="family-main notes-main"><article class="note-paper"><header><h1>${accentHTML(slide.title || slide.headline)}</h1>${slide.date ? `<time>${accentHTML(slide.date)}</time>` : ""}</header><div class="note-lines">${lines.map((line) => `<p>${accentHTML(line?.text || line)}</p>`).join("")}</div></article></main>`;
}

function storyMarkup(slide) {
  const photo = slide.photo || slide.image;
  const focal = typeof slide.focalPoint === "object" ? `${Number(slide.focalPoint.x ?? 0.5) * 100}% ${Number(slide.focalPoint.y ?? 0.5) * 100}%` : clean(slide.focalPoint || slide.pos || "center center");
  return `<img class="story-photo" src="${esc(photo)}" alt="" style="object-position:${esc(focal)}" /><div class="story-scrim"></div><main class="story-main">${slide.chapter != null ? `<div class="story-chapter">${esc(slide.chapter)}</div>` : ""}<div class="story-caption">${accentHTML(slide.caption || slide.text || slide.headline)}</div></main>`;
}

function evidenceFallbackMarkup(slide) {
  return `<main class="family-main evidence-main"><figure><div class="evidence-frame"><img src="${esc(assetValue(slide))}" alt="" /></div><figcaption>${accentHTML(slide.sourceLabel || slide.label || slide.source)}</figcaption></figure></main>`;
}

function slideRules() {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    body { background: var(--brand-surface); color: var(--brand-ink); font-family: var(--brand-body-font); }
    .slide { position: relative; width: 1080px; height: var(--slide-height); overflow: hidden; background: var(--brand-surface); color: var(--brand-ink); padding: var(--space-xxl); }
    .signature-layer { z-index: 4; }
    .accent { color: var(--brand-accent); }
    .slide-label { position: relative; z-index: 3; color: var(--brand-accent); font-size: var(--type-sm); font-weight: 600; letter-spacing: .06em; text-transform: var(--brand-body-case); }
    .slide-label::before { content: ""; display: block; width: calc(var(--space-xl) + var(--space-xs)); height: var(--space-xs); margin-bottom: var(--space-md); background: var(--brand-accent); border-radius: var(--brand-radius-sm); }
    .slide-handle { position: absolute; z-index: 5; left: var(--space-xxl); bottom: var(--space-xl); color: var(--brand-muted); font-size: var(--type-sm); font-weight: 600; }
    .legacy-main { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; justify-content: center; }
    .legacy-head, .family-main h1 { margin: 0; font-family: var(--brand-display-font); font-weight: var(--brand-display-weight); line-height: var(--brand-display-line-height); letter-spacing: var(--brand-display-tracking); text-transform: var(--brand-display-case); }
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
    .slide.evidence { padding: 0; }
    .slide.evidence .slide-handle { display: none; } /* the evidence frame carries its own source label there */
    .evidence-embed { position: absolute; inset: 0; }
    .static-light { background: var(--brand-paper); color: var(--slide-light-ink, var(--brand-surface)); }
    .static-light .slide-handle { color: var(--brand-muted); }
    .family-main { position: relative; z-index: 2; height: 100%; }
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
    .compare-label { color: var(--brand-accent); font-size: 34px; font-weight: 700; letter-spacing: .05em; text-transform: var(--brand-body-case); }
    .compare-value { margin-top: var(--space-md); font-family: var(--brand-editorial-font, var(--brand-display-font)); font-size: var(--type-lg); line-height: 1.08; }
    .compare-note { margin-top: var(--space-md); color: var(--brand-muted); font-size: 34px; line-height: 1.25; }
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
    .note-lines p { margin: 0; padding: var(--space-sm) 0; border-bottom: max(1px, calc(var(--space-xs) / 8)) solid var(--brand-muted); font-size: 38px; line-height: 1.35; }
    .story { padding: 0; }
    .story-photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .story-scrim { position: absolute; inset: 0; background: linear-gradient(to bottom, rgb(from var(--brand-surface) r g b / 0) 42%, rgb(from var(--brand-surface) r g b / .9)); }
    .story-main { position: absolute; z-index: 2; left: var(--space-xxl); right: var(--space-xxl); bottom: calc(var(--space-xxl) + var(--space-xl)); }
    .story-chapter { margin-bottom: var(--space-md); color: var(--brand-accent); font-size: max(34px, var(--type-sm)); font-weight: 700; }
    .story-caption { max-width: 888px; padding: var(--space-lg); border-radius: var(--brand-radius-md); background: rgb(from var(--brand-surface) r g b / .84); color: var(--brand-ink); font-size: var(--type-lg); line-height: 1.18; }
    .evidence-main { display: grid; place-items: center; }
    .evidence-main figure { width: 888px; margin: 0; }
    .evidence-frame { max-height: 880px; padding: var(--space-md); overflow: hidden; border: max(1px, calc(var(--space-xs) / 2)) solid var(--brand-accent); border-radius: var(--brand-radius-lg); background: var(--brand-surface2); }
    .evidence-frame img { display: block; width: 100%; max-height: 830px; object-fit: contain; border-radius: var(--brand-radius-md); }
    .evidence-main figcaption { margin-top: var(--space-md); color: var(--brand-muted); font-size: 34px; line-height: 1.2; }
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

/** One complete, deterministic HTML page for a 1080-wide slide. */
export function slideHTML(slide, tokens, options = {}) {
  const t = resolveBrandTokens({ brand: tokens });
  const kind = kindOf(slide);
  const height = Number(slide.__height || options.height || 1350);
  const signature = options.signature === false ? "" : signatureHTML(t, { format: kind === "static" || kind === "static-light" ? "static" : "carousel", width: SLIDE_WIDTH, height });
  let content;
  if (LEGACY_SLIDE_KINDS.includes(kind)) content = legacyMarkup(slide);
  else if (kind === "checklist") content = checklistMarkup(slide);
  else if (kind === "compare") content = compareMarkup(slide);
  else if (kind === "postcard") content = postcardMarkup(slide, t);
  else if (kind === "notes") content = notesMarkup(slide);
  else if (kind === "story") content = storyMarkup(slide);
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
  const position = clean(slide.pos || (kind === "photo" ? "center top" : "center 30%"));
  const paper = t.colors?.paper || "#FFFFFF";
  const lightInk = [t.colors?.surface, t.colors?.stroke, t.colors?.ink].filter(Boolean).sort((a, b) => contrast(b, paper) - contrast(a, paper))[0];
  const style = `--slide-height:${height}px;--slide-light-ink:${lightInk};--slide-photo:url(&quot;${esc(photo)}&quot;);--slide-position:${esc(position)};--slide-split:${split}px;--slide-photo-size:${esc(slide.size || "cover")};--legacy-sub-size:${kind === "photosplit" ? 36 : kind === "splittop" ? 34 : 40}px;`;
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${SLIDE_WIDTH}, height=${height}" /><style>${tokensCSS(t)}\n${slideRules()}\n${signatureRulesCSS()}\n${options.evidenceCSS || ""}</style></head>
<body><section class="slide ${esc(kind)}" style="${style}">${content}${signature}${commonFooter(t)}</section></body></html>`;
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
    const html = slideHTML(slide, tokens, options);
    const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1] || "";
    return `<div class="clip-page clip" data-start="${index}" data-duration="1" data-track-index="0">${body}</div>`;
  }).join("\n");
  const one = slideHTML({ kind: "body", headline: "" }, tokens, options);
  const css = one.match(/<style>([\s\S]*)<\/style>/)?.[1] || "";
  return `<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=${SLIDE_WIDTH}, height=${options.height}" /><script src="assets/vendor/gsap.min.js"></script><style>${css}\n#root { position:relative; width:${SLIDE_WIDTH}px; height:${options.height}px; overflow:hidden; } .clip-page { position:absolute; inset:0; }</style></head><body><div id="root" data-composition-id="slides" data-start="0" data-width="${SLIDE_WIDTH}" data-height="${options.height}" data-duration="${slides.length}" data-fps="30">${pages}</div><script>window.__timelines=window.__timelines||{};window.__timelines.slides=gsap.timeline({paused:true});</script></body></html>`;
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
    const placed = expanded.map((source, index) => {
      const slide = { ...source, __height: normalized.height };
      if (slide.kind === "story" && !resolveFile(slide.photo || slide.image, roots)) throw new Error(`story slide ${index + 1} photo file not found: ${slide.photo || slide.image}`);
      if (slide.kind === "evidence" && !resolveFile(assetValue(slide), roots)) throw new Error(`evidence slide ${index + 1} image file not found: ${assetValue(slide)}`);
      for (const key of ["photo", "image", "screenshot", "file", "avatar"]) if (slide[key]) slide[key] = copyAsset(slide[key], projectDir, roots, `slide-${index + 1}-${key}`, index + 1);
      return slide;
    });
    const evidence = await evidenceExtension();
    fs.writeFileSync(path.join(projectDir, "index.html"), compositionHTML(placed, tokens, { ...evidence, height: normalized.height, signature }));
    const { snapshotSlides } = await import("./carousel.mjs");
    const shots = await snapshotSlides(projectDir, placed.length, path.join(temp, "shots"));
    const files = shots.map((source, index) => {
      const target = path.join(destination, `${String(index + 1).padStart(2, "0")}.png`);
      fs.copyFileSync(source, target);
      return target;
    });
    return files;
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
