import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PNG } from "pngjs";
import { GREG_PRESETS, isClientJob } from "./client-mode.mjs";
import { listPhotos, detectPhotos, badShot, swiftTool } from "./photos.mjs";
import { run, sha1 } from "./util.mjs";
import { eventClock } from "./event-clock.mjs";
import { registerBoldOverlay, boldBoxesOverlap } from "./bold-overlays.mjs";
import "./bold-talk.mjs";

export const BOLD_EXTRAS_DEFAULTS = Object.freeze({
  sticker: { enabled: false, photosDir: null, iconsDir: null, width: 260, hold: 1.2, maxPerReel: 2, minSpacing: 10, maxReaction: 1, photoLimit: 24 },
  payoff: { enabled: false, width: 320, hold: 1, style: "stack", pieces: 9 },
});

const clamp = (n, lo, hi, fallback) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : fallback));
const inside = (root, file) => { const rel = path.relative(root, file); return rel && !rel.startsWith("..") && !path.isAbsolute(rel); };
const expand = (dir) => typeof dir === "string" && dir ? path.resolve(dir.startsWith("~/") ? path.join(os.homedir(), dir.slice(2)) : dir) : null;
const localFile = (root, file) => { try { return inside(fs.realpathSync(root), fs.realpathSync(file)) && fs.statSync(file).isFile(); } catch { return false; } };

export function boldExtrasAllowed({ plan, env = process.env } = {}) {
  return plan?.style?.bold?.enabled === true && GREG_PRESETS.includes(plan.preset) && !isClientJob(env) && plan.canvas?.height > plan.canvas?.width;
}

export function clearBoldPhoto(report) {
  const face = report?.faces?.[0];
  return report?.faces?.length === 1 && !badShot(report, { minShortSide: 640, minLight: 0.16, maxLight: 0.88, minSharp: 0.0012, minFaceQuality: 0.35, qualityFaceMin: 0, edge: 0.01 }) && [face?.x, face?.y, face?.w, face?.h, face?.quality, report.light, report.sharp].every(Number.isFinite) && face.w >= 0.06 && face.h >= 0.08 && face.quality >= 0.35;
}

/** Read only preset-owned folders. No source paths or pictures are bundled in the engine. */
export async function prepareBoldExtras(context, { detect = detectPhotos } = {}) {
  const { settings, outDir, projectDir } = context;
  if (!boldExtrasAllowed(context) || !settings.sticker.enabled || !outDir || !projectDir) return [];
  const assets = [], cfg = settings.sticker;
  const iconDir = expand(cfg.iconsDir), photoDir = expand(cfg.photosDir);
  try {
    const library = JSON.parse(fs.readFileSync(path.join(iconDir, "library.json"), "utf8"));
    for (const icon of Array.isArray(library) ? library : []) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icon.name)) continue;
      const file = path.join(iconDir, `icon-${icon.name}.png`);
      if (localFile(iconDir, file)) assets.push({ id: `icon-${icon.name}`, type: "icon", file, root: iconDir, description: String(icon.draw || icon.name).slice(0, 240) });
    }
  } catch { /* a missing personal icon library means no icon sticker */ }
  const photos = photoDir ? listPhotos(photoDir).filter((p) => localFile(photoDir, p.file)).slice(0, clamp(cfg.photoLimit, 0, 24, 24)) : [];
  if (!photos.length) return assets;
  const cacheDir = path.join(outDir, "bold-extras"), checksFile = path.join(cacheDir, "photo-checks.json");
  fs.mkdirSync(cacheDir, { recursive: true });
  let checks = {};
  try { checks = JSON.parse(fs.readFileSync(checksFile, "utf8")); } catch { /* first plan */ }
  const keyed = photos.map((photo) => ({ ...photo, hash: sha1(fs.readFileSync(photo.file)) }));
  const fresh = keyed.filter((p) => !checks[p.hash]);
  try {
    const reports = fresh.length ? await detect(fresh.map((p) => p.file)) : [];
    for (const photo of fresh) {
      const report = reports.find((r) => r.file === photo.file);
      if (report) checks[photo.hash] = { ...report, file: photo.file };
    }
    fs.writeFileSync(checksFile, JSON.stringify(checks, null, 2));
  } catch { /* no clear face report means no photo sticker */ }
  for (const photo of keyed) if (clearBoldPhoto(checks[photo.hash])) assets.push({ id: `photo-${photo.hash}`, hash: photo.hash, type: "photo", file: photo.file, root: photoDir, description: path.basename(photo.file).replace(/[\r\n]/g, " ").slice(0, 120) });
  return assets;
}

export async function cutBoldPhoto(source, output) {
  const bin = await swiftTool("person");
  if (!bin) throw new Error("person cutout unavailable");
  const { out } = await run(bin, [source, "--still", "--out", output], { capture: true });
  const report = JSON.parse(out.slice(out.indexOf("{")));
  if (!(report.best?.person?.w > 0)) throw new Error("no person mask");
}

/** Trim transparent padding only. The subject's real pixels are retained, never synthesized. */
export function trimBoldStickerPNG(buffer) {
  const png = PNG.sync.read(buffer), { width, height, data } = png;
  let left = width, top = height, right = -1, bottom = -1, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 16) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++; }
  if (count < width * height * 0.01 || count > width * height * 0.95) throw new Error("sticker needs a usable transparent cutout");
  const cropped = new PNG({ width: right - left + 1, height: bottom - top + 1 });
  for (let y = 0; y < cropped.height; y++) data.copy(cropped.data, y * cropped.width * 4, ((y + top) * width + left) * 4, ((y + top) * width + right + 1) * 4);
  return { buffer: PNG.sync.write(cropped), width: cropped.width, height: cropped.height };
}

/** Only already-grounded proposals can cause a selected asset to be copied or a photo to be segmented. */
export async function stageBoldExtras(picks, context, { cutout = cutBoldPhoto } = {}) {
  const staged = new Map();
  if (!boldExtrasAllowed(context) || !context.settings.sticker.enabled || !context.projectDir || !context.outDir) return staged;
  const wanted = picks.filter((p) => p.kind === "sticker").sort((a, b) => a.from - b.from);
  const chosen = [];
  for (const pick of wanted) {
    if (chosen.length >= 2 || chosen.some((p) => Math.abs(context.plan.words[p.from].start - context.plan.words[pick.from].start) < 10)) continue;
    const asset = context.extraAssets?.find((a) => a.id === pick.asset);
    if (!asset || !localFile(asset.root, asset.file)) continue;
    try {
      const hash = sha1(fs.readFileSync(asset.file)), folder = path.join(context.projectDir, "assets", "bold-extras");
      if (asset.type === "photo" && asset.hash && hash !== asset.hash) continue;
      fs.mkdirSync(folder, { recursive: true });
      const src = `assets/bold-extras/${asset.type}-${hash}.png`, output = path.join(context.projectDir, src);
      let image;
      const cached = path.join(context.outDir, "bold-extras", `cutout-v1-${hash}.png`);
      if (asset.type === "photo") {
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        if (!fs.existsSync(cached)) {
          const pending = `${cached}.pending.png`;
          try {
            await cutout(asset.file, pending);
            trimBoldStickerPNG(fs.readFileSync(pending));
            fs.renameSync(pending, cached);
          } finally { fs.rmSync(pending, { force: true }); }
        }
        image = trimBoldStickerPNG(fs.readFileSync(cached));
      } else image = trimBoldStickerPNG(fs.readFileSync(asset.file));
      fs.writeFileSync(output, image.buffer);
      staged.set(asset.id, { src, width: image.width, height: image.height, sourceHash: hash, type: asset.type });
      chosen.push(pick);
    } catch { /* a bad matte, absent photo or unreadable icon leaves a clean reel */ }
  }
  return staged;
}

export function validateBoldSticker(pick, context) {
  const { settings } = context;
  if (!boldExtrasAllowed(context) || !settings.sticker.enabled || !["prop", "reaction"].includes(pick.purpose) || !context.extraAssets?.some((a) => a.id === pick.asset) || Object.keys(pick).some((k) => !["kind", "from", "to", "reason", "asset", "purpose"].includes(k))) return null;
  return { asset: pick.asset, purpose: pick.purpose };
}

/** Choose a side slot level with the face, or a slot below captions for a payoff. Shared placement rechecks it. */
export function placeBoldExtraBox(event, { zones, settings, plan, overlays }, width, height, beside) {
  const safe = zones.safe, gap = settings.zone.overlayGap * plan.canvas.width / 1080;
  const faces = zones.faces.filter((f) => event.start < f.end && event.end > f.start);
  if (!faces.length) return null;
  const center = faces.reduce((sum, face) => sum + face.y + face.h / 2, 0) / faces.length;
  // Beside the face first. A centered talking head leaves about 170 px a side, so a sticker then sits above the
  // head (after the headline) or on the shoulder below the chin; the checks below keep it off the face and captions.
  const top = Math.min(...faces.map((face) => face.y)), chin = Math.max(...faces.map((face) => face.y + face.h));
  // Face boxes stop at the hairline; a cap or hair sits higher (a coin stack landed on Greg's cap, 2026-11-11), so the
  // spot above the head keeps another third of a face height clear.
  const hair = Math.max(...faces.map((face) => face.h)) / 3;
  const ys = beside ? [center - height / 2, top - hair - gap - height, chin + gap] : [zones.caption.y + zones.caption.h + gap];
  const active = overlays.filter((e) => event.start < e.end && event.end > e.start);
  for (const raw of ys) for (const x of [...(beside ? [safe.x + (safe.w - width) / 2] : []), safe.x, safe.x + safe.w - width]) {
    if (raw < safe.y) continue;
    const y = Math.min(safe.y + safe.h - height, raw);
    const box = { x, y, w: width, h: height };
    if (x + width > safe.x + safe.w || y + height > safe.y + safe.h) continue;
    if ([zones.caption, ...faces, ...active.map((e) => e.box), ...(event.start < (zones.headline?.end || 0) ? [zones.headline] : [])].some((b) => boldBoxesOverlap(box, b, gap))) continue;
    return box;
  }
  return null;
}

export function placeBoldSticker(event, context) {
  const { settings, overlays, fps, duration } = context, cfg = settings.sticker;
  if (!boldExtrasAllowed(context) || !cfg.enabled) return null;
  const previous = overlays.filter((e) => e.kind === "sticker");
  if (previous.length >= clamp(cfg.maxPerReel, 0, 2, 2) || previous.some((e) => Math.abs(event.startFrame - e.startFrame) < Math.max(10, Number(cfg.minSpacing) || 10) * fps) || (event.purpose === "reaction" && previous.filter((e) => e.purpose === "reaction").length >= clamp(cfg.maxReaction, 0, 1, 1))) return null;
  const image = context.stagedExtras?.get(event.asset);
  if (!image || !/^assets\/bold-extras\/(photo|icon)-[a-f0-9]+\.png$/.test(image.src)) return null;
  const endFrame = Math.min(Math.round(duration * fps), event.startFrame + Math.round(clamp(cfg.hold, 0.9, 1.5, 1.2) * fps));
  if (endFrame - event.startFrame < Math.ceil(0.9 * fps) || endFrame - event.startFrame <= 10) return null;
  const timed = { ...event, endFrame, end: endFrame / fps }, unit = context.plan.canvas.width / 1080;
  // Shrink toward 200 px when the only free spot (above a centered head) is short; never smaller.
  for (let w = clamp(cfg.width, 220, 320, 260); w >= 200; w -= 20) {
    const width = w * unit, box = placeBoldExtraBox(timed, context, width, width * image.height / image.width, true);
    if (box) return { box, endFrame, landingFrame: event.startFrame + 6, data: image };
  }
  return null;
}

export function validateBoldPayoff(pick, context) {
  if (!boldExtrasAllowed(context) || !context.settings.payoff.enabled || !["stack", "burst"].includes(pick.style || context.settings.payoff.style) || Object.keys(pick).some((key) => !["kind", "from", "to", "reason", "style"].includes(key))) return null;
  const punch = context.punch?.find((p) => p.role === "payoff" && pick.from >= p.from && pick.to <= p.to);
  if (!punch) return null;
  return { style: pick.style || context.settings.payoff.style };
}

/** Fixed integer sequence makes composition and arbitrary seek order independent of mutable RNG state. */
export function boldPayoffPieces(seed, count = 9, style = "stack") {
  let state = (Number(seed) >>> 0) || 1;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  return Array.from({ length: Math.round(clamp(count, 3, 12, 9)) }, (_, i) => {
    const x = style === "burst" ? 10 + next() * 80 : 14 + i % 3 * 28 + next() * 3;
    const y = style === "burst" ? 10 + next() * 70 : 72 - Math.floor(i / 3) * 23;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, angle: Math.round(next() * 30 - 15) };
  });
}

export function placeBoldPayoff(event, context) {
  if (!boldExtrasAllowed(context) || !context.settings.payoff.enabled || context.overlays.some((e) => e.kind === "payoff")) return null;
  // A direction mark must survive the punch budget; an abandoned punch never gains a celebration.
  if (!context.plan.bold?.groups.some((g) => g.mode === "punch" && g.role === "payoff" && g.from <= event.to && g.to >= event.from)) return null;
  const endFrame = Math.min(Math.round(context.duration * context.fps), event.startFrame + Math.round(clamp(context.settings.payoff.hold, 0.9, 1.2, 1) * context.fps));
  if (endFrame - event.startFrame < Math.ceil(0.9 * context.fps)) return null;
  const width = clamp(context.settings.payoff.width, 220, 360, 320) * context.plan.canvas.width / 1080;
  const box = placeBoldExtraBox({ ...event, end: endFrame / context.fps }, context, width, width * 0.65, false);
  return box && { box, endFrame, landingFrame: event.startFrame + 6, data: { pieces: boldPayoffPieces(event.from * 65537 + event.to + 1, context.settings.payoff.pieces, event.style) } };
}

export function boldExtraSounds(event, { fps, plan }) {
  const sticker = event.kind === "sticker", sfx = sticker ? "card.wav" : "slam.wav";
  const sync = eventClock({ landAt: event.landing, sfx, fps });
  return [{ id: `sfx-bold-${event.kind}-${event.from}`, src: `assets/sfx/${sfx}`, start: sync.start, duration: sticker ? 0.3 : 0.18, volume: Math.min(0.2, plan.style.audio?.soundsVolume ?? 0.2) * (sticker ? 0.45 : 1), track: 9, sync }];
}

export function boldExtraTimeline(event, { fps, i }) {
  const target = `#bold-extra-${i}`, outFrame = event.endFrame - 4;
  return `tl.set("${target}", { opacity:0 }, 0);\ntl.fromTo("${target}", { opacity:0 }, { opacity:1, duration:${6 / fps}, ease:"none", immediateRender:false }, ${event.start});\ntl.fromTo("${target}", { opacity:1 }, { opacity:0, duration:${4 / fps}, ease:"none", immediateRender:false }, ${outFrame / fps});\ntl.set("${target}", { opacity:0 }, ${event.end});`;
}

registerBoldOverlay("sticker", {
  prompt: ({ extraAssets = [] }) => `Rare and optional. Zero is fine. Use only when the sentence earns a specific prop or reaction, never a quota. {kind:"sticker",from,to,asset,purpose:"prop"|"reaction",reason}. At most two per reel, ten seconds apart and one reaction. Assets are real Greg photo cutouts or Greg's gold icons only. Never invent a photo, use emoji fonts or download imagery. Available asset IDs: ${extraAssets.map((a) => `${a.id} (${a.type}: ${a.description})`).join("; ") || "none"}.`,
  validate: validateBoldSticker, place: placeBoldSticker,
  html: (event, { esc, i }) => `<div id="bold-extra-${i}" class="bold-sticker" style="left:${event.box.x}px;top:${event.box.y}px;width:${event.box.w}px;height:${event.box.h}px" data-start="${event.start}" data-duration="${event.end - event.start}"><img src="${esc(event.data.src)}" alt=""></div>`,
  css: () => '\n      .bold-root .bold-sticker { position:absolute; z-index:17; opacity:0; pointer-events:none; }\n      .bold-root .bold-sticker img { display:block; width:100%; height:100%; object-fit:contain; }',
  timeline: (event, { plan, i }) => boldExtraTimeline(event, { fps: plan.style.render?.fps || 30, i }), sounds: boldExtraSounds,
});

registerBoldOverlay("payoff", {
  prompt: 'Rare and optional, at most one per reel and zero is fine. {kind:"payoff",from,to,style:"stack"|"burst",reason}. Only on a spoken money or result payoff already marked as a punch role payoff range. Gold coins are decorative, never proof or a numeric count of the result. No labels, invented amounts or counters.',
  validate: validateBoldPayoff, place: placeBoldPayoff,
  html: (event, { i }) => `<div id="bold-extra-${i}" class="bold-payoff" style="left:${event.box.x}px;top:${event.box.y}px;width:${event.box.w}px;height:${event.box.h}px" data-start="${event.start}" data-duration="${event.end - event.start}" aria-hidden="true">${event.data.pieces.map((p) => `<span class="bold-coin" style="left:${p.x}%;top:${p.y}%;transform:rotate(${p.angle}deg)"></span>`).join("")}</div>`,
  css: ({ settings }) => `\n      .bold-root .bold-payoff { position:absolute; z-index:16; opacity:0; overflow:hidden; pointer-events:none; }\n      .bold-root .bold-coin { position:absolute; opacity:0; width:14%; height:19%; box-sizing:border-box; border-radius:50%; border:3px solid ${settings.colors.bone}; background:${settings.colors.gold}; box-shadow:0 4px 0 ${settings.colors.black}; }`,
  timeline: (event, { plan, i }) => {
    const fps = plan.style.render?.fps || 30, target = `#bold-extra-${i}`;
    const particles = event.data.pieces.map((p, k) => {
      const delay = event.style === "stack" ? Math.floor(k * 3 / event.data.pieces.length) : 0;
      const coin = `${target} .bold-coin:nth-child(${k + 1})`;
      return `tl.set("${coin}", { opacity:0 }, 0);\ntl.fromTo("${coin}", { opacity:0, xPercent:${event.style === "burst" ? (50 - p.x) * 5 : 0}, yPercent:${event.style === "burst" ? (50 - p.y) * 5 : -30}, scale:0.5 }, { opacity:1, xPercent:0, yPercent:0, scale:1, duration:${(6 - delay) / fps}, ease:"none", immediateRender:false }, ${(event.startFrame + delay) / fps});`;
    }).join("\n");
    return boldExtraTimeline(event, { fps, i }) + "\n" + particles;
  }, sounds: boldExtraSounds,
});
