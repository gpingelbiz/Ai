import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { registerBoldOverlay, boldBoxesOverlap } from "./bold-overlays.mjs";
import { boldText, fitBoldText } from "./bold-render.mjs";
import { GREG_PRESETS, isClientJob } from "./client-mode.mjs";
import { ocrBinary, parseOcrJSON, redactionsFor, renderedEvidenceTextPx } from "./evidence.mjs";
import { eventClock } from "./event-clock.mjs";
import { parseBoldNumber } from "./bold-math.mjs";
import { run, warn } from "./util.mjs";

const DEFAULT_PROOF = { enabled: true, manifest: "~/Reels/brand-assets/proof/manifest.json", max: 2, width: 820, height: 360, soundVolume: 0.12 };
const DEFAULT_DEFINE = { enabled: true, max: 2, width: 820, maxWords: 14, soundVolume: 0.12 };
const cfg = (context, kind) => ({ ...(kind === "proof" ? DEFAULT_PROOF : DEFAULT_DEFINE), ...context.settings?.[kind] });
const clean = (text) => boldText(text).replace(/[\u2018\u2019]/g, "'");
const tokens = (text) => clean(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const span = (range, words, max = Infinity) => Number.isInteger(range?.from) && Number.isInteger(range?.to) && range.from >= 0 && range.to >= range.from && range.to < words.length && range.to - range.from < max;
const said = (range, words) => clean(words.slice(range.from, range.to + 1).map((w) => w.text).join(" "));
const within = (range, pick) => range.from >= pick.from && range.to <= pick.to;
const unitBox = (box) => box && [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= 1 && box.y + box.h <= 1;
const short = (text, maxWords, maxChars) => typeof text === "string" && clean(text).length > 0 && clean(text).length <= maxChars && clean(text).split(/\s+/).length <= maxWords;

export function boldEvidenceEnabled({ plan, env = process.env } = {}) {
  return plan?.style?.bold?.enabled === true && GREG_PRESETS.includes(plan?.preset) && !isClientJob(env) && plan.canvas?.height > plan.canvas?.width;
}

function report(context, message) {
  // One line per job even when several selected records fail. No screenshot contents in logs.
  const catalog = context.proofCatalog;
  if (catalog?.reported) return;
  if (catalog) catalog.reported = true;
  (context.log || warn)(`bold proof: ${message}; playing clean`);
}

/** A claim must share subject words, not just a generic number or a stop word. */
export function proofClaimMatches(claim, proves) {
  const stop = new Set("a an the and or of to for from with in on at is was are were be been this that it i we you my our your got have had has can did do does result results proof report screenshot client clients".split(" "));
  const stem = (word) => word.length > 4 ? word.replace(/s$/, "") : word;
  const subject = (text) => new Set(tokens(text).filter((word) => !stop.has(word) && /\p{L}/u.test(word)).map(stem));
  const a = subject(claim), b = subject(proves);
  const matches = [...a].filter((word) => b.has(word));
  // Share math's complete-number parser so 40 booked calls cannot select a 16-call record.
  const amounts = (text) => {
    const words = clean(text).split(/\s+/), out = [];
    for (let i = 0; i < words.length; i++) for (let end = Math.min(words.length, i + 12); end > i; end--) {
      const amount = parseBoldNumber(words.slice(i, end).join(" "));
      if (amount) { out.push(amount); i = end - 1; break; }
    }
    return out;
  };
  const supported = amounts(proves);
  if (amounts(claim).some((amount) => !supported.some((other) => amount.value === other.value && amount.percent === other.percent && (!amount.currency || amount.currency === other.currency)))) return false;
  // Retain a rare short metric such as CPM, but require two shared subject words otherwise.
  return matches.length >= 2 || matches.length === 1 && /^(cpm|roas|showrate)$/.test(matches[0]);
}

/** Read approved local metadata only. Images are inspected and staged only after a grounded pick. */
export function loadBoldProof(context = {}) {
  const catalog = { entries: [], glossary: [], error: null, reported: false };
  if (!boldEvidenceEnabled(context)) return catalog;
  const settings = cfg(context, "proof");
  if (!settings.enabled && !cfg(context, "define").enabled) return catalog;
  try {
    const file = path.resolve(String(settings.manifest).replace(/^~(?=\/)/, os.homedir()));
    const root = fs.realpathSync(path.dirname(file));
    catalog.root = root;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.entries)) throw new Error("invalid manifest");
    const ids = raw.entries.map((entry) => entry?.id);
    catalog.entries = raw.entries.slice(0, 100).filter((entry) => entry?.approved === true && /^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) && ids.filter((id) => id === entry.id).length === 1 && typeof entry.file === "string" && !path.isAbsolute(entry.file) && unitBox(entry.crop) && typeof entry.proves === "string" && entry.proves.trim() && entry.proves.length <= 600 && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Array.isArray(entry.redact) && entry.redact.every(unitBox) && (entry.label == null || short(entry.label, 7, 48))).flatMap((entry) => {
      try {
        const source = fs.realpathSync(path.resolve(root, entry.file));
        if (!source.startsWith(root + path.sep) || !/\.(png|jpe?g|heic)$/i.test(source) || !fs.statSync(source).isFile()) return [];
        return [{ ...structuredClone(entry), source }];
      } catch { catalog.error = "an approved source file is missing"; return []; }
    });
  } catch { catalog.error = "manifest folder or file is missing or invalid"; }
  // A glossary is independently approved and can be used even when there are no proof entries.
  if (catalog.root) try {
    const file = fs.realpathSync(path.join(catalog.root, "glossary.json"));
    if (!file.startsWith(catalog.root + path.sep)) throw new Error("outside proof folder");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw.schemaVersion === 1 && Array.isArray(raw.entries)) catalog.glossary = raw.entries.slice(0, 100).filter((entry) => entry?.approved === true && short(entry.term, 4, 40) && short(entry.definition, 14, 140) && raw.entries.filter((other) => tokens(other?.term).join(" ") === tokens(entry.term).join(" ")).length === 1).map((entry) => ({ term: clean(entry.term), definition: clean(entry.definition) }));
  } catch { /* An optional missing glossary cannot affect transcript definitions. */ }
  if (catalog.error && settings.enabled) report({ ...context, proofCatalog: catalog }, catalog.error);
  return catalog;
}

function catalogFor(context) { return context.proofCatalog || loadBoldProof(context); }

function basePick(pick, context, kind) {
  const { words = [], plan } = context;
  if (!boldEvidenceEnabled(context) || !cfg(context, kind).enabled || !span(pick, words) || typeof pick.reason !== "string" || !pick.reason.trim()) return null;
  const fps = plan.style.render?.fps || 30;
  if (Math.ceil(words[pick.to].end * fps) - Math.round(words[pick.from].start * fps) > 6 * fps) return null;
  if (pick.entrance != null && !["slide", "cut"].includes(pick.entrance)) return null;
  return { from: pick.from, to: pick.to, entrance: pick.entrance || "slide" };
}

export function validateProofPick(pick, context) {
  const base = basePick(pick, context, "proof");
  if (!base) return null;
  const catalog = catalogFor(context), entry = catalog.entries.find((entry) => entry.id === pick.entryId);
  if (!entry) { if (catalog.error) report({ ...context, proofCatalog: catalog }, catalog.error); return null; }
  if (!proofClaimMatches(said(pick, context.words), entry.proves)) return null;
  let label;
  if (pick.label != null) {
    if (!span(pick.label, context.words, 7) || !within(pick.label, pick) || !short(said(pick.label, context.words), 7, 48)) return null;
    label = { from: pick.label.from, to: pick.label.to };
  } else if (!entry.label) return null;
  const entrance = base.entrance === "cut" ? 0 : 8 / (context.plan.style.render?.fps || 30);
  return { ...base, entryId: entry.id, ...(label ? { label } : {}), holdSeconds: Math.min(6, Math.max(3.5 + entrance, 3.5 + tokens(entry.proves).length / 8)) };
}

function definitionData(pick, context) {
  if (!span(pick.term, context.words, 4) || !within(pick.term, pick)) return null;
  const term = said(pick.term, context.words);
  let definition;
  if (pick.definitionRange != null && pick.glossaryTerm != null) return null;
  if (pick.definitionRange) {
    if (!span(pick.definitionRange, context.words, Math.min(14, cfg(context, "define").maxWords)) || !within(pick.definitionRange, pick)) return null;
    definition = said(pick.definitionRange, context.words);
  } else {
    const entry = catalogFor(context).glossary.find((entry) => entry.term === pick.glossaryTerm && tokens(entry.term).join(" ") === tokens(term).join(" "));
    if (!entry) return null;
    definition = entry.definition;
  }
  return short(term, 4, 40) && short(definition, 14, 140) ? { term, definition } : null;
}

export function validateDefinePick(pick, context) {
  const base = basePick(pick, context, "define"), data = base && definitionData(pick, context);
  if (!data) return null;
  const entrance = base.entrance === "cut" ? 0 : 8 / (context.plan.style.render?.fps || 30);
  return { ...base, term: { from: pick.term.from, to: pick.term.to }, ...(pick.definitionRange ? { definitionRange: { from: pick.definitionRange.from, to: pick.definitionRange.to } } : { glossaryTerm: pick.glossaryTerm }), holdSeconds: Math.min(6, Math.max(3.5 + entrance, 3.5 + tokens(data.definition).length / 8)) };
}

/** Use the existing native OCR and irreversible redactor. Originals never enter project assets. */
export async function stageBoldProof(picks, context, { inspect, redact, crop } = {}) {
  const assets = {};
  if (!boldEvidenceEnabled(context) || !context.projectDir || !cfg(context, "proof").enabled) return assets;
  const catalog = catalogFor(context);
  let bin;
  const native = async () => { bin ||= await ocrBinary(); if (!bin) throw new Error("local OCR unavailable"); return bin; };
  inspect ||= async (file) => parseOcrJSON((await run(await native(), [file], { capture: true })).out);
  redact ||= async (file, boxes, out) => {
    const boxesFile = out + ".json";
    fs.writeFileSync(boxesFile, JSON.stringify(boxes));
    await run(await native(), ["--redact", file, boxesFile, out, "#0B0B0D", "0"], { capture: true });
  };
  crop ||= async (file, box, out) => run("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", `crop=${box.w}:${box.h}:${box.x}:${box.y}`, "-frames:v", "1", out], { capture: true });
  for (const pick of picks.filter((pick) => pick.kind === "proof").slice(0, 2)) {
    if (assets[pick.entryId] || !validateProofPick(pick, { ...context, proofCatalog: catalog })) continue;
    const entry = catalog.entries.find((entry) => entry.id === pick.entryId);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bold-proof-"));
    try {
      // Recheck the real path before reading in case a file was replaced since planning.
      if (fs.realpathSync(entry.source) !== entry.source || !entry.source.startsWith(catalog.root + path.sep)) throw new Error("source changed");
      const ocr = parseOcrJSON(await inspect(entry.source));
      const c = entry.crop;
      const box = { x: Math.floor(c.x * ocr.width), y: Math.floor(c.y * ocr.height), w: Math.floor(c.w * ocr.width), h: Math.floor(c.h * ocr.height) };
      if (box.w < 1 || box.h < 1) throw new Error("empty crop");
      const redactions = [...redactionsFor(ocr, { padding: 4 }).map((hit) => hit.box), ...entry.redact];
      // Keep every OCR line in the crop, including qualifiers and tiny metric labels.
      const lines = ocr.lines.filter((line) => boldBoxesOverlap(line.box, c) && !redactions.some((redaction) => redaction.x <= line.box.x && redaction.y <= line.box.y && redaction.x + redaction.w >= line.box.x + line.box.w && redaction.y + redaction.h >= line.box.y + line.box.h)).map((line) => {
        if (line.box.x < c.x || line.box.y < c.y || line.box.x + line.box.w > c.x + c.w || line.box.y + line.box.h > c.y + c.h) throw new Error("crop cuts source text");
        return { box: { h: line.box.h * ocr.height / box.h } };
      });
      if (!lines.length) throw new Error("no readable source text");
      const cleanFile = path.join(temp, "clean.png"), cropped = path.join(temp, "crop.png");
      await redact(entry.source, redactions, cleanFile);
      await crop(cleanFile, box, cropped);
      const bytes = fs.readFileSync(cropped), hash = createHash("sha256").update(bytes).digest("hex");
      const relative = `assets/bold-proof/${hash}.png`;
      fs.mkdirSync(path.join(context.projectDir, "assets/bold-proof"), { recursive: true });
      fs.writeFileSync(path.join(context.projectDir, relative), bytes);
      assets[entry.id] = { src: relative, hash, width: box.w, height: box.h, lines, redactionCount: redactions.length, date: entry.date };
    } catch { report({ ...context, proofCatalog: catalog }, "source unavailable, unreadable or unsafe"); }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
  return assets;
}

/** Search free rectangles around the active face, captions and other accepted overlays. */
export function placeBoldCard(size, event, context, { beside = false } = {}) {
  const { zones, settings, overlays = [] } = context, safe = zones.safe;
  const gap = settings.zone.overlayGap * safe.w / (settings.zone.right - settings.zone.left);
  const faces = zones.faces.filter((face) => event.start <= face.end && event.end >= face.start);
  const headline = zones.headline && event.start < zones.headline.end ? zones.headline : null;
  const occupied = [zones.caption, ...faces, ...(headline ? [headline] : []), ...overlays.filter((other) => event.start < other.end && event.end > other.start).map((other) => other.box)];
  const { w, h } = size;
  const xs = [safe.x, safe.x + safe.w - w, safe.x + (safe.w - w) / 2];
  const ys = [safe.y, zones.caption.y - gap - h, zones.caption.y + zones.caption.h + gap, safe.y + safe.h - h, ...faces.flatMap((face) => [face.y, face.y + face.h - h, face.y + face.h + gap])];
  for (const y of ys) for (const x of xs) {
    const box = { x, y, w, h };
    if (x < safe.x || x + w > safe.x + safe.w || y < safe.y || y + h > safe.y + safe.h || occupied.some((other) => boldBoxesOverlap(box, other, gap))) continue;
    if (beside && (!faces.length || y + h > zones.caption.y - gap || zones.headline && y < zones.headline.y + zones.headline.h + gap || !faces.every((face) => (x + w + gap <= face.x || x >= face.x + face.w + gap) && y < face.y + face.h && y + h > face.y))) continue;
    return box;
  }
  return null;
}

function admitted(event, context, kind) {
  if (!boldEvidenceEnabled(context)) return false;
  const max = Math.min(2, Math.max(0, Math.floor(Number(cfg(context, kind).max) || 0)), context.duration <= 30 ? 1 : 2);
  return (context.overlays || []).filter((other) => other.kind === kind).length < max && event.endFrame - event.startFrame <= Math.floor(6 * context.fps) && event.endFrame - event.startFrame >= Math.ceil(3.5 * context.fps) + (event.entrance === "cut" ? 0 : 8);
}

function placeProof(event, context) {
  if (!admitted(event, context, "proof")) return null;
  const asset = context.proofAssets?.[event.entryId], entry = catalogFor(context).entries.find((entry) => entry.id === event.entryId);
  if (!asset || !entry || !validateProofPick(event, context)) return null;
  const scale = context.plan.canvas.width / 1080, settings = cfg(context, "proof");
  const label = event.label ? said(event.label, context.words) : clean(entry.label);
  const labelH = 64 * scale, maxH = Math.min(360, Math.max(1, settings.height)) * scale;
  const maxW = Math.min(820, Math.max(1, settings.width)) * scale;
  const w = Math.min(maxW, (maxH - labelH) * asset.width / asset.height), mediaH = w * asset.height / asset.width;
  const textPx = renderedEvidenceTextPx(asset.lines, { h: mediaH });
  if (!textPx || asset.lines.some((line) => line.box.h * mediaH < 32) || textPx < 32) return null;
  const labelSize = fitBoldText([label], { size: 40 * scale, width: w - 32 * scale }).size;
  if (labelSize < 32) return null;
  const box = placeBoldCard({ w, h: mediaH + labelH }, event, context);
  return box && { box, landingFrame: event.startFrame + (event.entrance === "cut" ? 0 : 8), data: { ...asset, lines: undefined, label, labelH, labelSize, mediaH, textPx } };
}

function placeDefine(event, context) {
  if (!admitted(event, context, "define") || !validateDefinePick(event, context)) return null;
  const data = definitionData(event, context);
  if ((context.overlays || []).some((other) => other.kind === "define" && tokens(other.data.term).join(" ") === tokens(data.term).join(" "))) return null;
  const scale = context.plan.canvas.width / 1080, w = Math.min(820, Math.max(1, cfg(context, "define").width)) * scale, padding = 32 * scale;
  const termSize = fitBoldText([data.term], { size: 56 * scale, width: w - 2 * padding }).size;
  const size = fitBoldText([data.definition], { size: 40 * scale, width: w - 2 * padding }).size;
  if (termSize < 32 || size < 32) return null;
  const box = placeBoldCard({ w, h: 2 * padding + termSize * 1.2 + size * 1.2 + 12 * scale }, event, context);
  return box && { box, landingFrame: event.startFrame + (event.entrance === "cut" ? 0 : 8), data: { ...data, padding, termSize, size } };
}

const styleBox = (box) => `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
function cardHTML(event, { esc, i }) {
  const data = event.data;
  const content = event.kind === "proof" ? `<img src="${esc(data.src)}" alt="" style="height:${data.mediaH}px"><div class="bold-proof-label" style="height:${data.labelH}px;font-size:${data.labelSize}px">${esc(data.label)}</div>` : `<div class="bold-definition-term" style="font-size:${data.termSize}px">${esc(data.term)}</div><div class="bold-definition-text" style="font-size:${data.size}px">${esc(data.definition)}</div>`;
  return `<div id="bold-card-${i}" class="bold-evidence-card bold-${esc(event.kind)}" style="${styleBox(event.box)}${event.kind === "define" ? `;padding:${data.padding}px` : ""}${event.startFrame === 0 && event.entrance === "cut" ? ";opacity:1" : ""}" data-start="${event.start}" data-duration="${event.end - event.start}">${content}</div>`;
}

function cardCSS({ settings }) {
  return `.bold-root .bold-evidence-card { position:absolute; box-sizing:border-box; opacity:0; z-index:18; overflow:hidden; pointer-events:none; border-radius:16px; background:${settings.colors.black}; color:${settings.colors.bone}; font-family:"Inter",sans-serif; box-shadow:0 18px 40px rgba(0,0,0,.4); }
    .bold-root .bold-evidence-card img { display:block; width:100%; object-fit:fill; }
    .bold-root .bold-proof-label { display:flex; align-items:center; padding:0 16px; white-space:nowrap; font-weight:650; }
    .bold-root .bold-definition-term { color:${settings.colors.gold}; font-weight:900; line-height:1.2; white-space:nowrap; margin-bottom:12px; }
    .bold-root .bold-definition-text { font-weight:650; line-height:1.2; white-space:nowrap; }`;
}

function cardTimeline(event, { i, plan }) {
  const fps = plan.style.render?.fps || 30, target = JSON.stringify(`#bold-card-${i}`);
  const enter = event.entrance === "cut" ? `tl.set(${target}, {opacity:1,y:0}, ${event.start});` : `tl.fromTo(${target}, {opacity:0,y:48}, {opacity:1,y:0,duration:${8 / fps},ease:"none",immediateRender:false}, ${event.start});`;
  return `tl.set(${target}, {opacity:0,y:${event.entrance === "cut" ? 0 : 48}}, 0);\n${enter}\ntl.set(${target}, {opacity:0}, ${event.end});`;
}

function cardSounds(event, context) {
  if (!boldEvidenceEnabled(context)) return [];
  const volume = Math.min(0.2, Math.max(0, Number(cfg(context, event.kind).soundVolume) || 0));
  if (!volume) return [];
  const sync = eventClock({ landAt: event.landing, sfx: "card.wav", fps: context.fps });
  return [{ id: `sfx-bold-${event.kind}-${event.startFrame}`, src: "assets/sfx/card.wav", start: sync.start, duration: 0.3, volume, track: 9 }];
}

registerBoldOverlay("proof", {
  prompt: (context) => !boldEvidenceEnabled(context) || !cfg(context, "proof").enabled ? "Disabled." : `Optional real proof only for an exact supported claim. Zero is fine. Pick {kind:"proof",from,to,reason,entryId,label?:{from,to},entrance:"slide"|"cut"}. No new text. Label must be at most seven transcript words or use the manifest label. Hold 3.5 to 6 seconds; at most one through 30s, two for longer reels. Approved candidates (id, proves, date, label): ${JSON.stringify(catalogFor(context).entries.map(({ id, proves, date, label }) => ({ id, proves, date, label })))}`,
  validate: validateProofPick, place: placeProof, html: cardHTML, css: cardCSS, timeline: cardTimeline, sounds: cardSounds,
});
registerBoldOverlay("define", {
  prompt: (context) => !boldEvidenceEnabled(context) || !cfg(context, "define").enabled ? "Disabled." : `Optional unfamiliar sales term Greg actually uses. Zero is fine. Pick {kind:"define",from,to,reason,term:{from,to},definitionRange?:{from,to},glossaryTerm?:"exact approved term",entrance:"slide"|"cut"}. Select his explanation range inside from..to OR an approved glossary term, never write a definition. One line, at most 14 words. Hold 3.5 to 6 seconds, once per term; at most one through 30s, two longer. Approved glossary: ${JSON.stringify(catalogFor(context).glossary)}`,
  validate: validateDefinePick, place: placeDefine, html: cardHTML, css: cardCSS, timeline: cardTimeline, sounds: cardSounds,
});
