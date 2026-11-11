/**
 * Bold overlay contract (schemaVersion 1): register a trusted module once, then import it here.
 * prompt describes its word-index picks. validate(pick, context) returns sanitized data or null;
 * it owns source/proof grounding and must never accept generated claims or personal assets for clients.
 * place(event, context) returns { box: { x, y, w, h }, landingFrame?, startFrame?, endFrame?, data? } or null. Trusted
 * kinds may bound a short effect or hold a conversation card using transcript-derived frames. All geometry is
 * canvas pixels. The shared placer rejects face, caption, headline and simultaneous overlay collisions.
 * html(event, { esc, ...context }), css(context), timeline(event, context) return scoped markup,
 * .bold-root CSS and seek-safe GSAP statements using tl. No playback callbacks or mutable clocks.
 * sounds(event, context) returns tracks only after placement succeeds. event.landing is seconds;
 * startFrame/endFrame/landingFrame are integer frames. Times always come from transcript indexes.
 * Context includes plan, words, argument, settings, zones and outDir/projectDir when staging a job.
 * Approved local assets can be staged in projectDir; return their relative URLs in data for html.
 * Unknown kinds fail closed. Personal asset paths belong only in Greg's preset.
 */
import "./bold-extras.mjs";
// Lazy storage also lets a registered module import this contract during this module's own imports.
function registry() { return registry.entries ||= new Map(); }

export function registerBoldOverlay(kind, handlers) {
  if (!/^[a-z][a-z0-9-]*$/.test(kind) || registry().has(kind)) throw new Error(`invalid or duplicate bold overlay: ${kind}`);
  if (!handlers || !["validate", "place", "html"].every((key) => typeof handlers[key] === "function")) throw new Error(`incomplete bold overlay: ${kind}`);
  registry().set(kind, Object.freeze({ ...handlers }));
  return () => registry().delete(kind);
}

export function boldOverlayKinds() { return [...registry().keys()]; }
export function boldOverlayHandler(kind) { return registry().get(kind) || null; }
export function boldOverlayPrompts(context = {}) {
  return [...registry()].map(([kind, h]) => `${kind}: ${typeof h.prompt === "function" ? h.prompt(context) : h.prompt || ""}`).join("\n");
}

export function validateBoldOverlay(pick, context) {
  const handler = registry().get(pick?.kind);
  if (!handler) return null;
  try {
    const data = handler.validate(structuredClone(pick), context);
    return data && typeof data === "object" ? { ...data, kind: pick.kind, from: pick.from, to: pick.to, reason: pick.reason } : null;
  } catch { return null; }
}

export function boldBoxesOverlap(a, b, gap = 0) {
  return !!a && !!b && a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/** One admission point for every visual. An unsafe proposal leaves the speaker and captions alone. */
export function placeBoldOverlays(picks, context) {
  const { words, zones, fps, duration, settings } = context;
  if (zones.measured === false) return [];
  const accepted = [];
  for (const pick of [...picks].sort((a, b) => (a.kind === "topic" ? 0 : 1) - (b.kind === "topic" ? 0 : 1) || a.from - b.from)) {
    const handler = registry().get(pick.kind);
    if (!handler || !words[pick.from] || !words[pick.to]) continue;
    const startFrame = Math.max(0, Math.round(words[pick.from].start * fps));
    const endFrame = Math.min(Math.round(duration * fps), Math.max(startFrame + 1, Math.ceil(words[pick.to].end * fps), startFrame + Math.round((pick.holdSeconds || 0) * fps)));
    if (endFrame <= startFrame) continue;
    const event = { ...pick, startFrame, endFrame, start: startFrame / fps, end: endFrame / fps };
    let proposal;
    try { proposal = handler.place(event, { ...context, overlays: accepted }); } catch { continue; }
    const first = proposal?.startFrame ?? startFrame, last = proposal?.endFrame ?? endFrame;
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last <= first || last > Math.round(duration * fps)) continue;
    Object.assign(event, { startFrame: first, endFrame: last, start: first / fps, end: last / fps });
    const box = proposal?.box, safe = zones.safe;
    if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) continue;
    if (box.x < safe.x || box.y < safe.y || box.x + box.w > safe.x + safe.w || box.y + box.h > safe.y + safe.h) continue;
    const active = accepted.filter((other) => event.start < other.end && event.end > other.start);
    const faces = zones.faces.filter((face) => event.start <= face.end && event.end >= face.start);
    const gap = settings.zone.overlayGap * safe.w / (settings.zone.right - settings.zone.left);
    if ([zones.caption, ...faces, ...active.map((other) => other.box), ...(event.start < (zones.headline?.end || 0) ? [zones.headline] : [])].some((other) => boldBoxesOverlap(box, other, gap))) continue;
    const landingFrame = proposal.landingFrame ?? event.startFrame;
    if (!Number.isInteger(landingFrame) || landingFrame < event.startFrame || landingFrame >= event.endFrame) continue;
    accepted.push({ ...event, ...(proposal.data ? { data: structuredClone(proposal.data) } : {}), box: { x: box.x, y: box.y, w: box.w, h: box.h }, landingFrame, landing: landingFrame / fps });
  }
  return accepted;
}
