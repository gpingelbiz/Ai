import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveBrandTokens, tokensCSS, readableOn, contrast } from "./brandtokens.mjs";
import { esc } from "./text.mjs";
import { identityLeaks } from "./speaker-guard.mjs";

const TYPES = ["title", "booking", "testimonial-name", "quote", "logo-wall", "topic"];
const HEADINGS = { "spoke-at": "Spoke at", client: "Hired by", "featured-in": "Featured in", "available-at": "Available at" };
const clean = (s) => typeof s === "string" ? s.trim() : "";
const words = (s) => clean(s).split(/\s+/u).filter(Boolean).length;
const problem = (code, message, level = "error") => ({ level, code, message });
const ceilFrame = (s, fps) => Math.ceil(s * fps - 1e-8) / fps;
const roundFrame = (s, fps) => Math.round(s * fps) / fps;
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const rectOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// Home-folder names in file paths are masked by speaker-guard.mjs; all copy is still inspected.
const identityLeak = (value) => identityLeaks(value).length > 0;

function rightsProblems(proof, manifest, final) {
  const right = (manifest.rights || []).find((r) => r.id === proof.rights);
  return right?.status === "approved" ? [] : [problem("card-rights", `proof ${proof.id}: rights ${proof.rights || "missing"} are ${right?.status || "unknown"}`, final ? "error" : "warn")];
}

/** Exact field provenance. Problems use the same level/code/message shape as the existing preflight. */
export function resolveCard(input, { manifest = {}, final = false } = {}) {
  const problems = [];
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const type = clean(source.type);
  const card = { type };
  const identity = manifest.identity || {};
  const proofs = manifest.proof || [];
  const add = (code, message) => problems.push(problem(code, `${type || "card"}: ${message}`));
  if (!TYPES.includes(type)) add("card-type", `unknown type ${type || "(missing)"}`);
  if (identityLeak(source)) add("card-identity", "contains Greg's identity");
  let usedProof = null;
  const supplied = (key) => Object.hasOwn(source, key);
  const field = (key, value) => {
    const expected = clean(value);
    if (supplied(key) && (typeof source[key] !== "string" || clean(source[key]) !== expected)) add("card-provenance", `${key} must exactly match the manifest or proof`);
    card[key] = expected;
  };
  const allowed = new Set(["type"]);
  const allow = (...keys) => keys.forEach((key) => allowed.add(key));

  if (type === "title" || type === "booking") {
    allow("name", "roleLine");
    field("name", identity.name);
    field("roleLine", identity.roleLine);
    if (!card.name) add("card-name", "manifest.identity.name is missing");
    if (!card.roleLine) add("card-role", "manifest.identity.roleLine is missing");
  }
  if (type === "title") { allow("tagline"); field("tagline", identity.tagline); }
  if (type === "booking") {
    allow("mode", "text", "url", "email", "phone", "bureauName");
    const mode = clean(source.mode ?? identity.bookingMode);
    card.mode = mode;
    if (!["direct", "bureau"].includes(mode)) add("card-booking-mode", "mode must be direct or bureau");
    // A bureau ending is an allowed alternate of a direct ending; its approved name/text still come from intake.
    const bureau = identity.bureau || {};
    field("text", mode === "bureau" ? bureau.bookingText ?? identity.bookingText : identity.bookingText);
    if (!card.text) add("card-booking-text", "approved booking text is missing");
    if (mode === "bureau") {
      field("bureauName", typeof bureau === "string" ? bureau : bureau.name);
      if (!card.bureauName) add("card-bureau-name", "manifest.identity.bureau.name is missing");
      const contacts = [identity.email, identity.phone, identity.bookingUrl].map(clean).filter(Boolean);
      if ([source, { name: card.name, roleLine: card.roleLine, text: card.text, bureauName: card.bureauName }].some((v) => {
        const values = Object.values(v).filter((s) => typeof s === "string");
        return values.some((s) => contacts.some((contact) => s.toLowerCase().includes(contact.toLowerCase())));
      }) || ["url", "email", "phone"].some((key) => clean(source[key]))) add("card-contact-leak", "bureau ending contains direct contact details");
      // Strip direct fields even on invalid input, so an ignored problem can never put them on screen.
    } else {
      field("url", identity.bookingUrl);
      field("email", identity.email);
      field("phone", identity.phone);
      if (clean(source.bureauName)) add("card-provenance", "bureauName is not used in direct mode");
      if (!card.url) add("card-booking-url", "direct mode requires manifest.identity.bookingUrl");
    }
  }
  if (type === "testimonial-name" || type === "quote") {
    allow("proofId", "name", "title", "org");
    if (type === "quote") allow("text");
    const matches = (p) => {
      const a = p.attribution || {};
      return clean(source.name) && clean(source.name) === clean(a.name)
        && ["title", "org"].every((key) => !supplied(key) || clean(source[key]) === clean(a[key]))
        && (type !== "quote" || clean(source.text) === clean(p.text));
    };
    const kinds = ["quote", "testimonial-video"];
    usedProof = supplied("proofId") ? proofs.find((p) => p.id === source.proofId) : proofs.find((p) => kinds.includes(p.kind) && matches(p));
    if (!usedProof || !kinds.includes(usedProof.kind)) add("card-proof", `no matching ${type} proof ${source.proofId || "for supplied fields"}`);
    else {
      card.proofId = usedProof.id;
      const a = usedProof.attribution || {};
      for (const key of ["name", "title", "org"]) field(key, a[key]);
      if (type === "quote") field("text", usedProof.text);
      problems.push(...rightsProblems(usedProof, manifest, final));
    }
    if (!card.name) add("card-name", "testimonial or quote needs an attributed name");
    if (type === "quote") {
      if (!card.text) add("card-quote-text", "quote text is missing");
      if (words(card.text || source.text) > 25) add("card-quote-length", "quote exceeds 25 words");
    }
  }
  if (type === "logo-wall") {
    allow("heading", "relationship", "logos");
    card.relationship = clean(source.relationship);
    card.heading = clean(source.heading ?? HEADINGS[card.relationship]);
    card.logos = Array.isArray(source.logos) ? [...source.logos] : [];
    if (!HEADINGS[card.relationship]) add("card-logo-relationship", "unknown logo relationship");
    if (!card.heading || words(card.heading) >= 8) add("card-heading-length", "heading must have 1 to 7 words");
    const knownHeading = Object.entries(HEADINGS).find(([, text]) => text.toLowerCase() === card.heading.toLowerCase());
    if (knownHeading && knownHeading[0] !== card.relationship) add("card-logo-relationship", "heading contradicts the logo relationship");
    if (card.logos.length < 3 || card.logos.length > 6) add("card-logo-count", "logo wall needs 3 to 6 logos");
    if (new Set(card.logos).size !== card.logos.length) add("card-logo-duplicate", "a logo cannot be repeated to fill the wall");
    for (const id of card.logos) {
      const p = proofs.find((entry) => entry.id === id);
      if (!p || p.kind !== "logo" || !clean(p.file)) { add("card-logo", `logo ${String(id)} is missing its proof file`); continue; }
      if (p.relationship !== card.relationship) add("card-logo-relationship", `logo ${id} has a different relationship (${p.relationship})`);
      problems.push(...rightsProblems(p, manifest, final));
    }
  }
  if (type === "topic") {
    allow("text");
    card.text = clean(source.text);
    if (!card.text || words(card.text) >= 8) add("card-topic-length", "topic must have 1 to 7 words");
  }
  for (const key of Object.keys(source)) if (!allowed.has(key)) add("card-provenance", `unsupported field ${key}`);
  if (identityLeak(card) && !problems.some((p) => p.code === "card-identity")) add("card-identity", "resolved copy contains Greg's identity");
  return { card, problems };
}

/** Reading time is rounded up to complete frames. A 25-word excerpt uses the maximum eight seconds. */
export function cardDuration(card, { fps = 30 } = {}) {
  if (card.type === "quote") return ceilFrame(Math.max(5, Math.min(8, words(card.text) / 3 + 1.5)), fps);
  return ({ title: 4, booking: 6, "testimonial-name": 4, "logo-wall": 5, topic: 4 })[card.type] || 4;
}

function brandTokens(tokens) {
  if (!tokens?.type?.display?.family || !tokens?.type?.body?.family || !tokens?.colors?.ink || !tokens?.colors?.surface || !tokens?.colors?.accent) {
    throw new Error("speaker cards need resolved client colors and display/body fonts");
  }
  const t = resolveBrandTokens({ brand: tokens });
  // The shared resolver merges null files back to its repository defaults. A named client family must never
  // get one of those default binaries aliased under its name. Empty strings survive tokensCSS's second resolve.
  const defaults = resolveBrandTokens();
  for (const key of ["display", "body"]) {
    const role = t.type[key], fallback = defaults.type[key];
    if (role.file === fallback.file && role.family !== fallback.family) role.file = "";
  }
  if (identityLeak(t)) throw new Error("speaker cards: resolved brand contains Greg's identity");
  return t;
}

function palette(t) {
  const c = t.colors;
  // Use ink on a solid plate, including overlays. Accent is decoration, never low-contrast body copy.
  const normal = contrast(c.ink, c.surface) >= 4.5 && readableOn(c.ink, c.surface, 4.5) === c.ink;
  if (normal) return { ink: c.ink, surface: c.surface, warnings: [] };
  if (contrast(c.ink, c.paper) >= 4.5) return { ink: c.ink, surface: c.paper, warnings: ["speaker cards: low contrast; using the brand text/background pair"] };
  if (contrast(c.surface, c.paper) >= 4.5) return { ink: c.surface, surface: c.paper, warnings: ["speaker cards: low contrast; using the brand text/background pair"] };
  throw new Error("speaker cards: client brand has no text/background pair with 4.5:1 contrast");
}

function dimensions(canvas = {}) {
  const { width = 1920, height = 1080, fps = 30 } = canvas;
  if (width !== 1920 || height !== 1080 || fps !== 30) throw new Error("speaker cards require a 1920x1080 canvas at 30 fps");
  return { width, height, fps };
}

// Conservative widths keep layout deterministic without a browser or platform-specific font metrics.
// CSS wraps actual glyphs too; no ellipsis, truncation, horizontal scaling or text rewriting.
function fitText(text, preferred, minimum, width, lineHeight) {
  const charWidth = (c) => /\s/u.test(c) ? 0.35 : /[MW@%]/u.test(c) ? 1 : /[il.,!']/u.test(c) ? 0.35 : 0.68;
  const unitWidth = (s) => [...s].reduce((n, c) => n + charWidth(c), 0);
  const units = unitWidth(clean(text));
  const fontSize = Math.max(minimum, Math.min(preferred, Math.floor(width / Math.max(1, units))));
  if (!(width > 0)) return { fontSize, minimum, lines: Infinity, height: Infinity };
  let lines = 1, used = 0;
  for (const word of clean(text).split(/\s+/u).filter(Boolean)) {
    const size = unitWidth(word) * fontSize;
    const space = used ? 0.35 * fontSize : 0;
    if (used && used + space + size > width) { lines++; used = 0; }
    if (size > width) {
      for (const c of word) {
        const cw = charWidth(c) * fontSize;
        if (used + cw > width) { lines++; used = 0; }
        used += cw;
      }
    } else used += (used ? space : 0) + size;
  }
  return { fontSize, minimum, lines, height: Math.ceil(lines * fontSize * lineHeight) };
}

/** Shrink to the minimum, then wrap. Very long copy fails preflight instead of shrinking below readable sizes. */
export function bookingLayout(card, { tokens, canvas } = {}) {
  const t = brandTokens(tokens), { width: W, height: H } = dimensions(canvas);
  const inset = Math.max(W * 0.05, t.spacing.xxl), w = W - inset * 2, gap = t.spacing.md;
  const name = fitText(card.name, Math.max(72, t.typeScale.xl), 72, w, Math.max(1.1, t.type.display.lineHeight));
  const role = fitText(card.roleLine, Math.max(40, t.typeScale.md), 40, w, t.type.body.lineHeight);
  const text = fitText(card.text, Math.max(40, t.typeScale.md), 40, w, t.type.body.lineHeight);
  const route = fitText(card.mode === "bureau" ? card.bureauName : card.url, Math.max(48, t.typeScale.lg), 48, w, t.type.body.lineHeight);
  const h = name.height + role.height + text.height + route.height + gap * 3;
  return { x: inset, y: (H - h) / 2, w, h, inset, gap, name, role, text, route, fits: h <= H - inset * 2 };
}

/** A single evenly spaced row; every logo receives the same height and contain box. */
export function logoWallLayout(count, { tokens, canvas } = {}) {
  if (!Number.isInteger(count) || count < 3 || count > 6) throw new Error("logo wall needs 3 to 6 logos");
  const t = brandTokens(tokens), { width: W, height: H } = dimensions(canvas);
  const inset = Math.max(W * 0.05, t.spacing.xxl), gap = t.spacing.lg;
  const w = (W - inset * 2 - gap * (count - 1)) / count;
  if (w <= 0) throw new Error("logo wall: brand spacing leaves no room for the logos");
  const h = Math.min(H * 0.24, w);
  return Array.from({ length: count }, (_, i) => ({ x: inset + i * (w + gap), y: (H - h) / 2 + t.spacing.lg, w, h }));
}

function cssRules(t, colors) {
  // Escape style-tag terminators even for an unusual authored font family/path.
  return `${tokensCSS(t).replace(/</g, "\\3c ")}
.speaker-cards { position:absolute; inset:0; pointer-events:none; }
.speaker-cards, .speaker-card { --sc-ink:${colors.ink}; --sc-surface:${colors.surface}; }
.speaker-card { position:absolute; box-sizing:border-box; opacity:0; visibility:hidden; color:var(--sc-ink); background:var(--sc-surface); font-family:var(--brand-body-font); font-weight:var(--brand-body-weight); line-height:var(--brand-body-line-height); border-radius:var(--brand-radius-md); overflow-wrap:anywhere; }
.speaker-card.sc-insert { inset:0; border-radius:0; }
.sc-copy { position:absolute; box-sizing:border-box; display:flex; flex-direction:column; justify-content:center; gap:var(--space-md); }
.sc-name { font-family:var(--brand-display-font); font-weight:var(--brand-display-weight); line-height:var(--brand-display-line-height); letter-spacing:var(--brand-display-tracking); }
.sc-body { font-family:var(--brand-body-font); line-height:var(--brand-body-line-height); }
.sc-rule { width:var(--space-xxl); height:calc(var(--space-xs) / 2); background:var(--brand-accent); flex-shrink:0; }
.sc-attribution { display:flex; flex-direction:column; gap:var(--space-xs); }
.sc-attribution strong { font-weight:var(--sc-bold); }
.sc-logo { position:absolute; display:flex; align-items:center; justify-content:center; }
.sc-logo img { width:100%; height:100%; object-fit:contain; }
.sc-heading { position:absolute; margin:0; font-family:var(--brand-display-font); line-height:var(--brand-display-line-height); }
.sc-quote { margin:0; font-family:var(--brand-display-font); line-height:var(--brand-display-line-height); }
.sc-route { font-weight:var(--sc-bold); }
`;
}

function baseLayout(card, t, canvas, mode) {
  const { width: W, height: H } = dimensions(canvas), inset = Math.max(W * 0.05, t.spacing.xxl);
  const body = Math.max(30, t.typeScale.sm), name = Math.max(40, t.typeScale.md), meta = Math.max(24, t.typeScale.xs);
  if (card.type === "booking") return bookingLayout(card, { tokens: t, canvas });
  if (card.type === "testimonial-name") {
    const pad = t.spacing.md, gap = t.spacing.xs, w = W * 0.6;
    const n = fitText(card.name, name, 40, w - pad * 2, t.type.body.lineHeight);
    const title = card.title ? fitText(card.title, body, 30, w - pad * 2, t.type.body.lineHeight) : null;
    const org = card.org ? fitText(card.org, meta, 24, w - pad * 2, t.type.body.lineHeight) : null;
    const h = n.height + (title?.height || 0) + (org?.height || 0) + [title, org].filter(Boolean).length * gap + pad * 2;
    return { x: W * 0.05, y: H * 0.95 - h, w, h, pad, gap, name: n, title, org, fits: h <= H * 0.25 };
  }
  if (card.type === "topic") {
    const text = fitText(card.text, Math.max(40, t.typeScale.md), 40, W * 0.65, t.type.body.lineHeight);
    return { x: inset, y: H * 0.05, w: W * 0.7, h: text.height + t.spacing.md * 2, text, fits: text.height + t.spacing.md * 2 <= H * 0.25 };
  }
  const w = W - inset * 2, h = mode === "overlay" ? H * 0.25 : H - inset * 2;
  const pad = mode === "overlay" ? t.spacing.sm : 0, innerWidth = w - pad * 2;
  const titleName = fitText(card.name, Math.max(72, mode === "overlay" ? t.typeScale.xl : t.typeScale.display), 72, innerWidth, t.type.display.lineHeight);
  let contentHeight = 0;
  if (card.type === "title") {
    contentHeight = titleName.height + fitText(card.roleLine, Math.max(40, t.typeScale.md), 40, innerWidth, t.type.body.lineHeight).height
      + (card.tagline ? fitText(card.tagline, Math.max(30, t.typeScale.sm), 30, innerWidth, t.type.body.lineHeight).height : 0)
      + t.spacing.md * (card.tagline ? 3 : 2) + t.spacing.xs / 2;
  } else if (card.type === "quote") {
    contentHeight = fitText(card.text, Math.max(54, t.typeScale.lg), 54, innerWidth, t.type.display.lineHeight).height
      + [card.name, card.title, card.org].filter(Boolean).reduce((sum, text) => sum + fitText(text, body, 30, innerWidth, t.type.body.lineHeight).height, 0)
      + t.spacing.md * 2 + t.spacing.xs * 2 + t.spacing.xs / 2;
  }
  return { x: inset, y: mode === "overlay" ? H * 0.05 : inset, w, h, name: titleName, fits: w > 0 && contentHeight <= h - pad * 2 };
}

function attribution(card, t) {
  return `<div class="sc-attribution sc-body" style="font-size:${Math.max(30, t.typeScale.sm)}px"><strong>${esc(card.name)}</strong>${card.title ? `<span>${esc(card.title)}</span>` : ""}${card.org ? `<span>${esc(card.org)}</span>` : ""}</div>`;
}

/** One resolved card. Pure output; callers validate provenance with resolveCard before calling a renderer. */
function renderCard(card, { tokens, canvas, id = "speaker-card", mode = "insert", start = 0, end, manifest = {}, clientDir } = {}) {
  const t = brandTokens(tokens), size = dimensions(canvas), colors = palette(t), layout = baseLayout(card, t, size, mode);
  const duration = cardDuration(card, size);
  const stop = roundFrame(end ?? start + duration, size.fps);
  start = roundFrame(start, size.fps);
  if (!Number.isFinite(start) || !Number.isFinite(stop) || start < 0 || stop <= start) throw new Error(`speaker card ${id}: invalid output start/end`);
  const minHold = card.type === "booking" ? 5 : ["testimonial-name", "logo-wall"].includes(card.type) ? 4 : card.type === "quote" ? duration : 3;
  const slack = Math.max(0, Math.round((stop - start - minHold) * size.fps));
  const enterFrames = Math.min(9, Math.max(0, Math.floor(t.motion.enterMs * size.fps / 1000)), Math.floor(slack / 2));
  const exitFrames = Math.min(6, Math.max(0, Math.floor(t.motion.exitMs * size.fps / 1000)), slack - enterFrames);
  const assets = [];
  const fields = [];
  const display = (value, className, fontSize) => `<div class="${className}" style="font-size:${fontSize}px">${esc(value)}</div>`;
  const { x, y, w, h } = layout;
  const copyStyle = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  let content = "";
  if (card.type === "title") {
    const pad = mode === "overlay" ? t.spacing.sm : 0;
    content = `<div class="sc-copy" style="${mode === "overlay" ? `inset:${pad}px` : copyStyle}">${display(card.name, "sc-name", layout.name.fontSize)}<div class="sc-rule"></div>${display(card.roleLine, "sc-body", Math.max(40, t.typeScale.md))}${card.tagline ? display(card.tagline, "sc-body", Math.max(30, t.typeScale.sm)) : ""}</div>`;
    fields.push(card.name, card.roleLine, card.tagline);
  } else if (card.type === "booking") {
    content = `<div class="sc-copy" style="${copyStyle};gap:${layout.gap}px">${display(card.name, "sc-name", layout.name.fontSize)}${display(card.roleLine, "sc-body", layout.role.fontSize)}${display(card.text, "sc-body", layout.text.fontSize)}${display(card.mode === "bureau" ? card.bureauName : card.url, "sc-body sc-route", layout.route.fontSize)}</div>`;
    fields.push(card.name, card.roleLine, card.text, card.mode === "bureau" ? card.bureauName : card.url);
  } else if (card.type === "testimonial-name") {
    content = `<div class="sc-copy sc-attribution" style="inset:${layout.pad}px;gap:${layout.gap}px">${display(card.name, "sc-body sc-route", layout.name.fontSize)}${card.title ? display(card.title, "sc-body", layout.title.fontSize) : ""}${card.org ? display(card.org, "sc-body", layout.org.fontSize) : ""}</div>`;
    fields.push(card.name, card.title, card.org);
  } else if (card.type === "quote") {
    content = `<div class="sc-copy" style="${copyStyle}"><div class="sc-rule"></div><blockquote class="sc-quote" style="font-size:${Math.max(54, t.typeScale.lg)}px">${esc(card.text)}</blockquote>${attribution(card, t)}</div>`;
    fields.push(card.text, card.name, card.title, card.org);
  } else if (card.type === "logo-wall") {
    const boxes = logoWallLayout(card.logos.length, { tokens: t, canvas: size });
    content = `<h2 class="sc-heading" style="left:${x}px;top:${y}px;font-size:${Math.max(54, t.typeScale.lg)}px">${esc(card.heading)}</h2>`;
    content += card.logos.map((proofId, i) => {
      const proof = (manifest.proof || []).find((p) => p.id === proofId);
      if (!proof?.file) throw new Error(`speaker card ${id}: missing logo ${proofId}`);
      if (!path.isAbsolute(proof.file) && !clientDir) throw new Error(`speaker card ${id}: clientDir is required for relative logo ${proofId}`);
      const source = path.resolve(clientDir || ".", proof.file);
      const ref = `speaker-asset-${createHash("sha256").update(source).digest("hex").slice(0, 16)}${path.extname(source).toLowerCase()}`;
      assets.push({ ref, source, proofId, itemId: id });
      const b = boxes[i];
      // An empty alt avoids inventing a proof label; the approved artwork carries its own mark.
      return `<div class="sc-logo" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><img src="${esc(ref)}" alt=""></div>`;
    }).join("");
    fields.push(card.heading);
  } else if (card.type === "topic") {
    content = `<div class="sc-copy sc-body" style="inset:${t.spacing.md}px;font-size:${layout.text.fontSize}px">${esc(card.text)}</div>`;
    fields.push(card.text);
  } else throw new Error(`speaker card ${id}: unknown type ${card.type}`);
  const overlay = mode === "overlay" || ["testimonial-name", "topic"].includes(card.type);
  const bold = Math.max(...t.type.body.weights);
  const html = `<div id="${esc(id)}" class="speaker-card clip sc-${overlay ? "overlay" : "insert"} sc-${card.type}" style="--sc-bold:${bold};${overlay ? copyStyle : ""}" data-start="${start}" data-duration="${stop - start}" data-track-index="4">${content}</div>`;
  const enter = enterFrames / size.fps, exit = exitFrames / size.fps;
  const timeline = `tl.fromTo(${js(`#${id}`)}, {autoAlpha:0}, {autoAlpha:1,duration:${enter},ease:${js(t.motion.enterEase)},immediateRender:false}, ${start});\ntl.fromTo(${js(`#${id}`)}, {autoAlpha:1}, {autoAlpha:0,duration:${exit},ease:${js(t.motion.exitEase)},immediateRender:false}, ${stop - exit});`;
  return { html, css: cssRules(t, colors), timeline, layout, assets, warnings: colors.warnings,
    durationHints: { min: card.type === "booking" ? 5 : card.type === "testimonial-name" ? 4 : card.type === "quote" ? duration : card.type === "logo-wall" ? 4 : 3, recommended: duration, max: card.type === "quote" ? 8 : card.type === "logo-wall" ? 6 : null, enter, exit, fullyLegible: stop - start - enter - exit },
    text: fields.filter(Boolean) };
}

export const titleCard = (card, options) => renderCard({ ...card, type: "title" }, options);
export const bookingCard = (card, options) => renderCard({ ...card, type: "booking" }, options);
export const testimonialNameCard = (card, options) => renderCard({ ...card, type: "testimonial-name" }, { ...options, mode: "overlay" });
export const quoteCard = (card, options) => renderCard({ ...card, type: "quote" }, options);
export const logoWallCard = (card, options) => renderCard({ ...card, type: "logo-wall" }, options);
export const topicCard = (card, options) => renderCard({ ...card, type: "topic" }, { ...options, mode: "overlay" });

function outputSpan(entry, fps) {
  // outputStart/outputEnd are canonical; start/end and output.start/end support existing composition conventions.
  const start = entry.outputStart ?? entry.output?.start ?? entry.start;
  const end = entry.outputEnd ?? entry.output?.end ?? entry.end;
  if (![start, end].every(Number.isFinite) || start < 0 || end <= start) throw new Error(`speaker card ${entry.id || "(missing id)"}: invalid resolved output start/end`);
  const span = { start: roundFrame(start, fps), end: roundFrame(end, fps) };
  if (span.end <= span.start) throw new Error(`speaker card ${entry.id || "(missing id)"}: output span is shorter than one frame`);
  return span;
}

function cardEntries(plan) {
  return [...(plan.items || []).filter((i) => i.kind === "card").map((entry) => ({ entry, mode: "insert" })),
    ...(plan.overlays || []).map((entry) => ({ entry, mode: "overlay" }))];
}

/** Fragment contract: html + css + timeline (statements on the caller's paused `tl`), assets and review entries.
 * Pass clientDir for manifest-relative logos, or provide absolute proof files. No files or JSON are written here.
 */
export function speakerCardsHTML(resolvedPlan, { manifest = {}, tokens, canvas = resolvedPlan.canvas, clientDir, final = false, log = console.log } = {}) {
  const t = brandTokens(tokens), size = dimensions(canvas);
  const problems = cardChecks(resolvedPlan, { manifest, final, tokens: t });
  if (identityLeak(resolvedPlan)) throw new Error("speaker cards: plan contains Greg's identity");
  if (final && problems.some((p) => p.level === "error")) throw new Error(`speaker cards final preflight: ${problems.filter((p) => p.level === "error").map((p) => p.message).join("; ")}`);
  // Structural review findings are returned; invalid card copy and unsafe layouts cannot be rendered.
  const fragments = [], review = [];
  cardEntries(resolvedPlan).forEach(({ entry, mode }, i) => {
    const resolved = resolveCard(entry.card, { manifest, final });
    const errors = resolved.problems.filter((p) => p.level === "error");
    if (errors.length) throw new Error(`speaker card ${entry.id}: ${errors.map((p) => p.message).join("; ")}`);
    const span = outputSpan(entry, size.fps);
    const rendered = renderCard(resolved.card, { tokens: t, canvas: size, id: `speaker-card-${i}`, mode, ...span, manifest, clientDir });
    if (!rendered.layout.fits) throw new Error(`speaker card ${entry.id}: text cannot fit at the minimum readable sizes`);
    for (const asset of rendered.assets) asset.itemId = entry.id;
    fragments.push(rendered);
    review.push({ id: entry.id, type: resolved.card.type, mode, ...span, text: rendered.text, proofIds: resolved.card.logos || (resolved.card.proofId ? [resolved.card.proofId] : []), problems: resolved.problems, layout: rendered.layout });
  });
  const warnings = [...new Set(fragments.flatMap((f) => f.warnings))];
  for (const warning of warnings) log(`[reel] ${warning}`);
  const assets = fragments.flatMap((f) => f.assets);
  // Local font files travel with the fragment; named families must already be provisioned by the composition.
  for (const role of Object.values(t.type)) if (role?.file) {
    const source = path.resolve(clientDir || ".", role.file);
    if (assets.some((asset) => asset.source === source)) continue;
    assets.push({ ref: role.file, source, font: true });
  }
  return { html: `<div class="speaker-cards">${fragments.map((f) => f.html).join("\n")}</div>`, css: cssRules(t, palette(t)), timeline: fragments.map((f) => f.timeline).join("\n"), assets, review: review.sort((a, b) => a.start - b.start), problems, warnings };
}

/** Copy only supplied local files; stable content hashes avoid basename collisions and preserve originals. */
export async function copyCardAssets(fragment, projectDir) {
  const result = structuredClone(fragment);
  for (const asset of result.assets || []) {
    let bytes;
    try { bytes = await fs.readFile(asset.source); }
    catch (error) { throw new Error(`speaker card ${asset.itemId || "font"}: cannot read ${asset.source}: ${error.message}`); }
    const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 20)}${path.extname(asset.source).toLowerCase()}`;
    const relative = `assets/speaker-cards/${name}`;
    await fs.mkdir(path.join(projectDir, "assets/speaker-cards"), { recursive: true });
    await fs.writeFile(path.join(projectDir, relative), bytes);
    result.html = result.html.split(`src="${esc(asset.ref)}"`).join(`src="${relative}"`);
    const cssRef = String(asset.ref).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\3c ");
    result.css = result.css.split(`url("${cssRef}")`).join(`url("${relative}")`);
    asset.file = relative;
  }
  return result;
}

/** Card preflight returns findings only; an empty list means pass. Draft rights findings remain visible warnings. */
export function cardChecks(resolvedPlan = {}, { manifest = {}, final = false, tokens } = {}) {
  const findings = [];
  const add = (code, message) => findings.push(problem(code, message));
  if (identityLeak(resolvedPlan)) add("card-identity", "speaker plan contains Greg's identity");
  const entries = cardEntries(resolvedPlan), fps = resolvedPlan.canvas?.fps || 30;
  const cards = entries.map(({ entry, mode }) => {
    const resolved = resolveCard(entry.card, { manifest, final });
    findings.push(...resolved.problems.map((p) => ({ ...p, itemId: entry.id, message: `${entry.id}: ${p.message}` })));
    let span = null;
    try { span = outputSpan(entry, fps); } catch (error) { add("card-time", error.message); }
    if (tokens && TYPES.includes(resolved.card.type) && !baseLayout(resolved.card, brandTokens(tokens), resolvedPlan.canvas, mode).fits) add("card-text-fit", `${entry.id}: text cannot fit at the minimum readable sizes`);
    return { ...resolved, entry, mode, span };
  });
  const bookings = cards.filter((c) => c.card.type === "booking");
  if (!bookings.length) add("card-booking-missing", "booking card is missing");
  for (const c of bookings) {
    if (c.mode !== "insert" || resolvedPlan.items?.at(-1)?.id !== c.entry.id
      || cards.some((other) => other.span && c.span && other.span.end > c.span.end)) add("card-booking-last", `${c.entry.id}: booking card must be the last timeline item`);
  }
  if (bookings.length > 1) add("card-booking-count", "use one final booking card");
  for (const c of cards) {
    if (!c.span) continue;
    const duration = c.span.end - c.span.start;
    const minimum = c.card.type === "booking" ? 5 : c.card.type === "testimonial-name" ? 4 : c.card.type === "quote" ? cardDuration(c.card, { fps }) : c.card.type === "logo-wall" ? 4 : 0;
    if (duration < minimum - 1e-7) add("card-hold", `${c.entry.id}: ${c.card.type} holds ${duration}s; needs at least ${minimum}s`);
    if (["logo-wall", "quote"].includes(c.card.type) && duration > (c.card.type === "quote" ? 8 : 6) + 1e-7) add("card-hold", `${c.entry.id}: ${c.card.type} hold exceeds its reading window`);
    if (c.mode === "overlay" && ["booking", "quote", "logo-wall"].includes(c.card.type)) add("card-mode", `${c.entry.id}: ${c.card.type} must be an insert`);
    if (c.mode === "insert" && ["testimonial-name", "topic"].includes(c.card.type)) add("card-mode", `${c.entry.id}: ${c.card.type} must be an overlay`);
    // Authored size overrides are rejected by resolveCard; also report their readable minimum explicitly.
    const minima = c.card.type === "booking" ? { nameFontSize: 72, roleFontSize: 40, urlFontSize: 48, fontSize: 40 } : { fontSize: 24 };
    for (const [key, min] of Object.entries(minima)) if (Number.isFinite(c.entry.card?.[key]) && c.entry.card[key] < min) add("card-text-size", `${c.entry.id}: ${key} is below ${min}px`);
  }
  const overlays = cards.filter((c) => c.mode === "overlay" && c.span);
  // Without renderer geometry, use each family's reserved safe rectangle. Plans cannot override placement.
  const box = (c) => c.card.type === "testimonial-name" ? { x: 0.05, y: 0.7, w: 0.6, h: 0.25 } : { x: 0.05, y: 0.05, w: 0.9, h: 0.25 };
  for (let i = 0; i < overlays.length; i++) for (let j = i + 1; j < overlays.length; j++) {
    const a = overlays[i], b = overlays[j];
    if (a.span.start < b.span.end && a.span.end > b.span.start && rectOverlap(box(a), box(b))) add("card-overlay-collision", `${a.entry.id} and ${b.entry.id}: overlays collide`);
  }
  if (cards.filter((c) => c.card.type === "topic").length > 3) add("card-topic-count", "a reel may use at most three topic labels");
  for (const item of resolvedPlan.items || []) {
    if (item.kind !== "clip") continue;
    const source = (manifest.sources || []).find((s) => s.id === item.sourceId);
    if (!source) { add("card-source", `${item.id}: unknown sourceId ${item.sourceId}`); continue; }
    const right = (manifest.rights || []).find((r) => r.id === source.rights);
    if (right?.status !== "approved") findings.push(problem("card-source-rights", `${item.id}: source ${source.id} rights are ${right?.status || "unknown"}`, final ? "error" : "warn"));
    if (!Number.isFinite(item.in) || !Number.isFinite(item.out) || item.in < 0 || item.in >= item.out) add("card-source-range", `${item.id}: source in/out must be finite with 0 <= in < out`);
    if (source.kind !== "testimonial") continue;
    let span;
    try { span = outputSpan(item, fps); } catch (error) { add("card-time", error.message); continue; }
    const proof = (manifest.proof || []).filter((p) => p.kind === "testimonial-video" && p.sourceId === source.id && p.in <= item.in && p.out >= item.out);
    const identified = overlays.some((c) => c.card.type === "testimonial-name" && c.card.name && c.entry.at === item.id && c.span.start >= span.start && c.span.start <= span.start + 1 && c.span.end <= span.end + 1e-7 && c.span.end - c.span.start >= 4 - 1e-7 && proof.some((p) => p.id === c.card.proofId));
    if (!identified) add("card-testimonial-name", `${item.id}: needs a matching testimonial-name overlay starting within 1s, held at least 4s on this testimonial`);
  }
  return findings;
}
