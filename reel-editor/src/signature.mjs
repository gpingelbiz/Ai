import { resolveBrandTokens, tokensCSS } from "./brandtokens.mjs";
import { esc } from "./text.mjs";

const KINDS = new Set(["edge-rule", "corner-mark", "title-plate"]);
const COLOR_ROLES = new Set(["ink", "accent", "accentInk", "surface", "surface2", "stroke", "muted", "paper", "warn"]);
const round = (n) => Math.round(n * 1000) / 1000;
const px = (n) => `${round(n)}px`;

/** The usable rectangle for a non-essential signature device in each output format. */
export function signatureSafeArea({ format = "reel", width = 1080, height = 1920, captionTop } = {}) {
  const sx = width / 1080;
  const vertical = height / 1920;
  if (format === "reel" || format === "story") {
    const bottom = Math.min(Number.isFinite(captionTop) ? captionTop : height * (1599 / 1920), height * (1599 / 1920));
    return { x: 76 * sx, y: 200 * vertical, w: (940 - 76) * sx, h: Math.max(0, bottom - 200 * vertical) };
  }
  if (format === "cover" && height / width > 1.5) {
    return { x: 76 * sx, y: 240 * vertical, w: (940 - 76) * sx, h: 1440 * vertical };
  }
  if (format === "cover") {
    const sy = height / 1350;
    return { x: 48 * sx, y: 48 * sy, w: 984 * sx, h: 1254 * sy };
  }
  if (format === "carousel" || format === "static") {
    const sy = height / 1350;
    return { x: 48 * sx, y: 48 * sy, w: 984 * sx, h: 1254 * sy };
  }
  if (format === "thumbnail") {
    const tx = width / 1920;
    const ty = height / 1080;
    return { x: 60 * tx, y: 48 * ty, w: 1800 * tx, h: 984 * ty };
  }
  return { x: 48 * sx, y: 48 * (height / 1350), w: 984 * sx, h: height - 96 * (height / 1350) };
}

function scaleFor(format, width) {
  return format === "thumbnail" ? width / 1280 : width / 1080;
}

function monogram(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function labelFor(tokens, maxWidth, fontSize) {
  const requested = String(tokens.signature?.label || tokens.identity?.handle || monogram(tokens.identity?.name)).trim();
  if (!requested) return "";
  const width = requested.length * fontSize * 0.56;
  if (width <= maxWidth) return requested;
  return monogram(tokens.identity?.name) || requested;
}

function headRect(headBox, width, height) {
  if (!headBox || !Number.isFinite(headBox.cx) || !Number.isFinite(headBox.cy)) return null;
  const fractional = headBox.w <= 1.5 && headBox.h <= 1.5;
  const w = headBox.w * (fractional ? width : 1);
  const h = headBox.h * (fractional ? height : 1);
  const cx = headBox.cx * (fractional ? width : 1);
  const cy = headBox.cy * (fractional ? height : 1);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function overlaps(a, b, gap = 0) {
  return !!b && a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

function cornerOrder(position = "top-left") {
  const all = ["top-left", "top-right", "bottom-left", "bottom-right"];
  const at = all.indexOf(position);
  return at < 0 ? all : [all[at], ...all.filter((_, i) => i !== at)];
}

function cornerRect(corner, safe, w, h) {
  return {
    x: corner.endsWith("right") ? safe.x + safe.w - w : safe.x,
    y: corner.startsWith("bottom") ? safe.y + safe.h - h : safe.y,
    w,
    h,
  };
}

/** Shared title-container geometry for hooks, premise strips, cards, covers and the title-plate signature. */
export function titlePlate(tokens, { format = "reel", width = 1080 } = {}) {
  const t = resolveBrandTokens({ brand: tokens });
  const s = scaleFor(format, width);
  return {
    radius: round((t.signature?.radius ?? t.radius.md) * s),
    paddingX: round((t.signature?.paddingX ?? t.spacing.md) * s),
    paddingY: round((t.signature?.paddingY ?? t.spacing.sm) * s),
    rulePosition: ["top", "right", "bottom", "left"].includes(t.signature?.rulePosition) ? t.signature.rulePosition : "top",
    ruleThickness: round(Math.max(1, (t.signature?.thickness || t.spacing.xs / 2) * s)),
  };
}

export const titlePlateGeometry = titlePlate;

/** Deterministic device rectangle and content, including the existing head-box guard when supplied. */
export function signatureLayout(tokens, { format = "reel", width = 1080, height = 1920, captionTop, headBox } = {}) {
  const t = resolveBrandTokens({ brand: tokens });
  const kind = String(t.signature?.kind || "none");
  const safe = signatureSafeArea({ format, width, height, captionTop });
  if (!KINDS.has(kind) || safe.w <= 0 || safe.h <= 0) return { kind: "none", safe, skip: true };
  const scale = scaleFor(format, width);
  const thickness = Math.max(1, (t.signature?.thickness || t.spacing.xs / 2) * scale);
  const guard = t.spacing.sm * scale;
  const head = headRect(headBox, width, height);
  const colorRole = COLOR_ROLES.has(t.signature?.colorRole) ? t.signature.colorRole : "accent";

  if (kind === "edge-rule") {
    const length = Math.min(safe.h, safe.w, (t.signature?.length || t.spacing.xxl + t.spacing.md) * scale);
    const preferred = ["left", "right", "top", "bottom"].includes(t.signature?.position) ? t.signature.position : "left";
    const edges = [preferred, ...["left", "right", "top", "bottom"].filter((edge) => edge !== preferred)];
    const candidates = edges.flatMap((edge) => {
      const vertical = edge === "left" || edge === "right";
      const w = vertical ? thickness : length;
      const h = vertical ? length : thickness;
      const first = {
        x: edge === "right" ? safe.x + safe.w - w : safe.x,
        y: edge === "bottom" ? safe.y + safe.h - h : safe.y,
        w,
        h,
      };
      const second = vertical ? { ...first, y: safe.y + safe.h - h } : { ...first, x: safe.x + safe.w - w };
      return [{ ...first, edge }, { ...second, edge }];
    });
    const rect = candidates.find((candidate) => !overlaps(candidate, head, guard));
    return rect ? { kind, safe, colorRole, opacity: t.signature.opacity, ...rect } : { kind, safe, skip: true };
  }

  const fontSize = Math.max(26 * scale, Math.min(32 * scale, t.typeScale.sm * scale));
  const lineHeight = t.type.display.lineHeight || 1;
  const ruleLength = (t.signature?.length || t.spacing.xxl + t.spacing.md) * scale;
  const gap = t.spacing.sm * scale;
  const maxLabel = Math.max(0, safe.w - ruleLength - gap);
  const label = labelFor(t, maxLabel, fontSize);
  const labelWidth = Math.min(maxLabel, Math.max(fontSize, label.length * fontSize * 0.56));
  let w = ruleLength + gap + labelWidth;
  let h = Math.max(thickness, fontSize * lineHeight);
  let plate = null;
  if (kind === "title-plate") {
    plate = titlePlate(t, { format, width });
    w = Math.min(safe.w, labelWidth + plate.paddingX * 2);
    h = Math.min(safe.h, fontSize * lineHeight + plate.paddingY * 2 + plate.ruleThickness);
  }
  const position = String(t.signature?.position || "top-left");
  const candidate = cornerOrder(position).map((corner) => ({ ...cornerRect(corner, safe, w, h), corner })).find((rect) => !overlaps(rect, head, guard));
  return candidate ? { kind, safe, colorRole, opacity: t.signature.opacity, label, fontSize, thickness, ruleLength, gap, plate, ...candidate } : { kind, safe, skip: true };
}

function attrs(layout) {
  return `data-kind="${layout.kind}" data-x="${round(layout.x)}" data-y="${round(layout.y)}" data-w="${round(layout.w)}" data-h="${round(layout.h)}"`;
}

function style(layout, extra = "") {
  return `--sig-x:${px(layout.x)};--sig-y:${px(layout.y)};--sig-w:${px(layout.w)};--sig-h:${px(layout.h)};--sig-opacity:${round(layout.opacity)};--sig-color:var(--brand-${layout.colorRole.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)});${extra}`;
}

/** Persistent, non-essential brand signature markup. Empty means the old renderer path. */
export function signatureHTML(tokens, options = {}) {
  const layout = signatureLayout(tokens, options);
  if (layout.skip || layout.kind === "none") return "";
  const common = `class="signature-device signature-${layout.kind}" ${attrs(layout)}`;
  if (layout.kind === "edge-rule") return `<div class="signature-layer" aria-hidden="true"><div ${common} style="${style(layout)}"></div></div>`;
  if (layout.kind === "corner-mark") {
    return `<div class="signature-layer" aria-hidden="true"><div ${common} style="${style(layout, `--sig-gap:${px(layout.gap)};`)}"><span class="signature-rule" style="--sig-rule:${px(layout.ruleLength)};--sig-thickness:${px(layout.thickness)}"></span><span class="signature-label" style="--sig-font:${px(layout.fontSize)}">${esc(layout.label)}</span></div></div>`;
  }
  const p = layout.plate;
  return `<div class="signature-layer" aria-hidden="true"><div ${common} style="${style(layout, `--sig-font:${px(layout.fontSize)};--sig-radius:${px(p.radius)};--sig-pad-x:${px(p.paddingX)};--sig-pad-y:${px(p.paddingY)};--sig-thickness:${px(p.ruleThickness)};`)}"><span class="signature-label">${esc(layout.label)}</span><span class="signature-plate-rule signature-plate-rule-${p.rulePosition}"></span></div></div>`;
}

/** Brand-token CSS shared by reels, carousels and future cover/static renderers. */
export function signatureCSS(tokens) {
  const t = resolveBrandTokens({ brand: tokens });
  if (!KINDS.has(String(t.signature?.kind || "none"))) return "";
  return `${tokensCSS(t)}
      .signature-layer { position: absolute; inset: 0; pointer-events: none; }
      .signature-device { position: absolute; left: var(--sig-x); top: var(--sig-y); width: var(--sig-w); height: var(--sig-h); box-sizing: border-box; opacity: var(--sig-opacity); color: var(--brand-ink); }
      .signature-edge-rule { background: var(--sig-color); border-radius: var(--brand-radius-sm); }
      .signature-corner-mark { display: flex; align-items: center; gap: var(--sig-gap); }
      .signature-rule { display: block; flex: 0 0 var(--sig-rule); width: var(--sig-rule); height: var(--sig-thickness); background: var(--sig-color); border-radius: var(--brand-radius-sm); }
      .signature-label { font-family: var(--brand-display-font); font-size: var(--sig-font); font-weight: var(--brand-display-weight); line-height: var(--brand-display-line-height); letter-spacing: var(--brand-display-tracking); text-transform: var(--brand-display-case); white-space: nowrap; }
      .signature-title-plate { display: flex; align-items: center; padding: var(--sig-pad-y) var(--sig-pad-x); border-radius: var(--sig-radius); background: var(--brand-surface); }
      .signature-plate-rule { position: absolute; background: var(--sig-color); border-radius: var(--brand-radius-sm); }
      .signature-plate-rule-top, .signature-plate-rule-bottom { left: var(--sig-pad-x); right: var(--sig-pad-x); height: var(--sig-thickness); }
      .signature-plate-rule-top { top: 0; } .signature-plate-rule-bottom { bottom: 0; }
      .signature-plate-rule-left, .signature-plate-rule-right { top: var(--sig-pad-y); bottom: var(--sig-pad-y); width: var(--sig-thickness); }
      .signature-plate-rule-left { left: 0; } .signature-plate-rule-right { right: 0; }`;
}
