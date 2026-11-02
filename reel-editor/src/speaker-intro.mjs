import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { assetPath } from "./speaker-intake.mjs";
import { activeBox, sourceCropOptions, prepareGrade } from "./speaker-look.mjs";
import { SDR_FILTER, SDR_TAGS, rotateFilters, evenFilters, hlgToSdrFilter, hasZscale, toneMapToSdr } from "./hdr.mjs";
import { personBinary } from "./cover.mjs";
import { probeSource } from "./speaker-index.mjs";
import { run, ensureDir } from "./util.mjs";
import { esc } from "./text.mjs";
import { identityLeaks } from "./speaker-guard.mjs";

const FPS = 30, SAFE = 96;
export const INTRO_FACE_MAX_FRAMES = 6;
const KINDS = ["text", "image", "video", "shape"];
export const INTRO_ANIMATIONS = ["rise", "slam", "wipe", "drift", "settle", "fade", "cut"];
const COLORS = ["ink", "surface", "accent", "paper"];
// A proof text layer shows the proof text by default, or one field of its supplied attribution.
const PROOF_FIELDS = ["text", "name", "title", "org"];
const row = (index, id) => index?.sources?.[id] || index?.[id];
const hash = (v) => createHash("sha256").update(v).digest("hex");
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const words = (s) => String(s || "").trim().split(/\s+/u).filter(Boolean);
const durationFrames = (i) => Math.round((i.kind === "clip" ? i.out - i.in : i.duration) * FPS);
const alphaPNG = (bytes) => bytes.length >= 26 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && [4, 6].includes(bytes[25]);

export function introItems(plan = {}) {
  let frame = 0;
  return (Array.isArray(plan.items) ? plan.items : []).map((entry) => {
    const i = entry && typeof entry === "object" ? entry : {};
    const result = { ...i, startFrame: frame, endFrame: frame + durationFrames(i) };
    frame = result.endFrame; return result;
  });
}

/** A span names an inclusive, forward sequence of ordinary clips; it never creates timeline time. */
export function introSpan(entry, plan) {
  const items = introItems(plan), first = items.findIndex((i) => i.id === entry.at);
  const last = entry.spanTo == null ? first : items.findIndex((i) => i.id === entry.spanTo);
  if (first < 0 || last < first) throw new Error("intro spanTo must name the target or a later contiguous item");
  if (items.slice(first, last + 1).some((i) => i.kind !== "clip")) throw new Error("intro span must contain only contiguous clip items");
  if (!Number.isFinite(entry.offset) || entry.offset < 0 || Math.round(entry.offset * FPS) >= durationFrames(items[first])) throw new Error("intro offset must be inside its first clip");
  const startFrame = items[first].startFrame + Math.round(entry.offset * FPS);
  const frames = entry.duration == null && entry.spanTo != null ? items[last].endFrame - startFrame : Math.round(entry.duration * FPS);
  if (!Number.isInteger(frames) || frames < 1 || startFrame + frames > items[last].endFrame) throw new Error("intro duration extends past its span");
  if (entry.spanTo != null && startFrame + frames !== items[last].endFrame) throw new Error("intro duration must end exactly at spanTo's boundary (omit duration to derive it)");
  return { startFrame, endFrame: startFrame + frames, frames, start: startFrame / FPS, end: (startFrame + frames) / FPS };
}

/** Shared by compile and final rights checks, including transcript and indirect proof sources. */
export function introReferences(card, manifest = {}, plan = {}) {
  const sourceIds = new Set(), proofIds = new Set();
  for (const l of Array.isArray(card?.layers) ? card.layers : []) {
    if (!l || typeof l !== "object") continue;
    if (l.sourceId) sourceIds.add(l.sourceId);
    if (l.proofId) proofIds.add(l.proofId);
    if (l.itemId) {
      const item = (Array.isArray(plan.items) ? plan.items : []).find((i) => i?.id === l.itemId);
      if (item?.sourceId) sourceIds.add(item.sourceId);
    }
  }
  for (const id of proofIds) {
    const p = manifest.proof?.find((p) => p.id === id);
    if (p?.sourceId) sourceIds.add(p.sourceId);
  }
  return { sourceIds: [...sourceIds], proofIds: [...proofIds] };
}

function textLayout(l, text) {
  const list = words(text), lines = [[]];
  for (let i = 0; i < list.length; i++) {
    if (l.lineBreaks?.includes(i)) lines.push([]);
    lines.at(-1).push(list[i]);
  }
  const unit = (s) => [...s].reduce((sum, c) => sum + (/\s/u.test(c) ? 0.35 : /[MW@%]/u.test(c) ? 1 : /[il.,!']/u.test(c) ? 0.35 : 0.68), 0);
  const min = l.font === "body" ? 32 : 48, size = l.fontSize ?? (l.font === "body" ? 40 : 88);
  const fits = Number.isInteger(size) && size >= min && size <= 200 && lines.every((line) => unit(line.join(" ")) * size <= l.rect.w) && lines.length * size * 1.25 <= l.rect.h;
  return { fits, fontSize: size, minimum: min, lines: lines.map((line) => line.join(" ")) };
}

/** Resolve all displayed copy from evidence; no authored HTML, text or CSS enters the renderer. */
export function resolveIntro(input, { manifest = {}, index, plan, entry, clientDir, final = false, mode = "overlay" } = {}) {
  const problems = [], add = (message, level = "error") => problems.push({ level, code: "card-intro", message: `intro: ${message}` });
  const card = { type: "intro", layers: [] };
  if (input?.type !== "intro") add("type must be intro");
  if (mode !== "overlay") add("must be an overlay; clip items retain all audio");
  for (const key of Object.keys(input || {})) if (!["type", "layers"].includes(key)) add(`unsupported field ${key}`);
  if (!Array.isArray(input?.layers) || !input.layers.length || input.layers.length > 64) add("needs 1–64 layers");
  let span;
  if (plan && entry) { try { span = introSpan(entry, plan); } catch (error) { add(error.message); } }
  let box;
  try { box = activeBox(plan?.look?.letterbox, plan?.canvas); }
  catch (error) { add(error.message); box = activeBox(); }
  const ids = new Set();
  for (const raw of Array.isArray(input?.layers) ? input.layers : []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { add("layers must be objects"); continue; }
    const l = structuredClone(raw), label = l.id || "layer", fail = (s) => add(`${label}: ${s}`);
    const shared = ["id", "kind", "from", "to", "rect", "animations", "allowOverFace", "bleed"];
    const fields = { text: ["identity", "proofId", "itemId", "sourceWordRange", "wordByWord", "sourceTypography", "words", "font", "fontSize", "color", "accentWord", "lineBreaks", "proofField"], image: ["sourceId", "proofId", "fit", "crop", "cutout"], video: ["sourceId", "in", "out", "fit", "crop", "radius"], shape: ["shape", "color", "opacity", "direction"] };
    if (!KINDS.includes(l.kind)) fail("unknown kind");
    for (const key of Object.keys(l)) if (![...shared, ...(fields[l.kind] || [])].includes(key)) fail(`unsupported field ${key}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(l.id || "") || ids.has(l.id)) fail("id must be safe and unique");
    ids.add(l.id);
    if (!Number.isInteger(l.from) || !Number.isInteger(l.to) || l.from < 0 || l.to <= l.from || span && l.to > span.frames) fail("from/to must be integer half-open frames inside the overlay");
    if (l.allowOverFace != null && typeof l.allowOverFace !== "boolean") fail("allowOverFace must be boolean");
    if (l.bleed != null && (typeof l.bleed !== "boolean" || !["shape", "image", "video"].includes(l.kind))) fail("bleed must be boolean on a shape, image or video");
    const margin = l.bleed === true ? 0 : SAFE;
    const r = l.rect;
    if (!r || Object.keys(r).some((k) => !["x", "y", "w", "h"].includes(k)) || ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) { fail("rect requires finite x,y,w,h"); continue; }
    if (r.x < margin || r.y < box.y + margin || r.x + r.w > box.width - margin || r.y + r.h > box.y + box.height - margin) fail(l.bleed ? "bleed rect is outside the active picture" : "rect is outside the 96px active-picture safe margin");
    if (l.animations != null && (!Array.isArray(l.animations) || l.animations.length > 8)) fail("animations must be an array of at most eight motions");
    l.animations = Array.isArray(l.animations) ? l.animations : [];
    const animated = new Set();
    for (const a of l.animations) {
      if (!a || typeof a !== "object") { fail("invalid animation"); continue; }
      for (const k of Object.keys(a)) if (!["type", "from", "to", "side", "dx", "dy", "out"].includes(k)) fail(`unsupported animation field ${k}`);
      if (!INTRO_ANIMATIONS.includes(a.type) || !Number.isInteger(a.from) || !Number.isInteger(a.to) || a.from < l.from || a.to < a.from || a.to > l.to || a.to === a.from && a.type !== "cut") fail("animation needs a fixed type and integer endpoints inside its layer");
      if (a.side != null && !["left", "right", "top", "bottom"].includes(a.side)) fail("invalid wipe side");
      if (a.out != null && (typeof a.out !== "boolean" || a.type !== "fade")) fail("out is only supported on fade");
      if ([a.dx, a.dy].some((v) => v != null && (!Number.isFinite(v) || Math.abs(v) > 160))) fail("animation offsets must be finite within 160px");
      const props = ({ rise: ["y", "opacity"], slam: ["x", "y", "scale"], wipe: ["mask"], drift: ["x", "y"], settle: ["scale"], fade: [a.out ? "exit" : "opacity"], cut: [] })[a.type] || [];
      for (const prop of props) { if (animated.has(prop)) fail(`animations repeat ${prop}; split into consecutive layers instead`); animated.add(prop); }
    }
    // Reserve the entire swept rectangle, including scale entrances, for safe and face checks.
    const scale = l.animations.some((a) => a?.type === "slam") ? 1.08 : l.animations.some((a) => a?.type === "settle") ? 1.04 : 1;
    const dx = l.animations.map((a) => a?.dx ?? (a?.type === "slam" ? 80 : a?.type === "drift" ? -8 : 0));
    const dy = l.animations.map((a) => a?.dy ?? (["rise", "slam"].includes(a?.type) ? 24 : 0));
    l.bounds = { x: r.x - r.w * (scale - 1) / 2 + Math.min(0, ...dx), y: r.y - r.h * (scale - 1) / 2 + Math.min(0, ...dy), w: r.w * scale + Math.max(0, ...dx) - Math.min(0, ...dx), h: r.h * scale + Math.max(0, ...dy) - Math.min(0, ...dy) };
    const sweptMargin = l.bleed === true ? -160 : SAFE;
    if (l.bounds.x < sweptMargin - 1e-7 || l.bounds.y < box.y + sweptMargin - 1e-7 || l.bounds.x + l.bounds.w > box.width - sweptMargin + 1e-7 || l.bounds.y + l.bounds.h > box.y + box.height - sweptMargin + 1e-7) fail(l.bleed ? "animated bleed exceeds 160px overscan" : "animated bounds leave the safe margin");
    if (l.kind === "text") {
      const evidence = [l.identity != null, l.proofId != null, l.sourceWordRange != null].filter(Boolean).length;
      let text = "", deferred = false;
      if (evidence !== 1) fail("text needs exactly one identity, proofId or sourceWordRange provenance");
      if (l.identity != null) {
        if (["headshot", "headshotRights"].includes(l.identity) || typeof manifest.identity?.[l.identity] !== "string") fail("identity must name a manifest identity string");
        else text = manifest.identity[l.identity];
      }
      if (l.proofField != null && (l.proofId == null || !PROOF_FIELDS.includes(l.proofField))) fail("proofField needs proofId and one of text, name, title or org");
      if (l.proofId != null) {
        const proof = manifest.proof?.find((p) => p.id === l.proofId);
        text = (l.proofField && l.proofField !== "text" ? proof?.attribution?.[l.proofField] : proof?.text) || "";
      }
      if (l.sourceWordRange != null) {
        const item = introItems(plan).find((i) => i.id === l.itemId), range = l.sourceWordRange;
        const transcript = row(index, item?.sourceId)?.words;
        if (!item || item.kind !== "clip" || item.audio === "mute" || manifest.sources?.find((s) => s.id === item.sourceId)?.audio !== "ok") fail("sourceWordRange needs an audible retained item and indexed words");
        // A probe-only index (--plan-only) has no words yet: defer the provenance check to composition, like keywords.
        else if (!Array.isArray(transcript)) { deferred = true; add(`${label}: sourceWordRange is checked against indexed words at composition`, "warn"); }
        else if (!range || Object.keys(range).some((k) => !["start", "end"].includes(k)) || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end >= transcript.length) fail("invalid inclusive sourceWordRange");
        else {
          const selected = transcript.slice(range.start, range.end + 1);
          if (selected.some((w, i) => !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end <= w.start || w.start < item.in || w.end > item.out || w.end > item.in + durationFrames(item) / FPS || i && w.start < selected[i - 1].start)) fail("sourceWordRange must retain every complete word in timestamp order");
          if (l.wordByWord && selected.some((w) => words(w.text ?? w.word).length !== 1)) fail("wordByWord needs one timestamped word per indexed entry");
          text = selected.map((w) => w.text ?? w.word).join(" ");
          if (span) {
            l.wordFrames = selected.map((w) => item.startFrame + Math.round((w.start - item.in) * FPS) - span.startFrame);
            if (l.wordFrames[0] < l.from || l.wordFrames.at(-1) >= l.to) fail("layer must include the words' real timestamp frames");
          }
        }
      }
      if (l.sourceTypography != null && (l.sourceTypography !== "sentence" || !l.sourceWordRange)) fail("sourceTypography must be sentence on sourceWordRange text");
      if (l.sourceTypography === "sentence" && !deferred) {
        l.sourceText = text;
        text = text.replace(/^["“”]+|["“”]+$/gu, "");
        text = text.charAt(0).toLocaleUpperCase("en-US") + text.slice(1);
      }
      if (l.wordByWord != null && (typeof l.wordByWord !== "boolean" || !l.sourceWordRange)) fail("wordByWord requires sourceWordRange");
      if (l.itemId && !l.sourceWordRange) fail("itemId requires sourceWordRange");
      if (l.words != null) {
        const range = l.words, list = words(text);
        if (l.sourceWordRange || !Number.isInteger(range?.start) || !Number.isInteger(range?.end) || range.start < 0 || range.end < range.start || range.end >= list.length || Object.keys(range).some((k) => !["start", "end"].includes(k))) fail("words must select a contiguous identity/proof word range");
        else text = list.slice(range.start, range.end + 1).join(" ");
      }
      if (deferred) { l.text = ""; l.deferred = true; l.font ??= "display"; l.color ??= "ink"; if (!Array.isArray(l.lineBreaks)) l.lineBreaks = []; }
      else {
      if (!text.trim()) fail("missing evidence text");
      l.text = text;
      l.font ??= "display"; l.color ??= "ink";
      if (!["display", "body"].includes(l.font) || !COLORS.includes(l.color)) fail("text font/color must use brand tokens");
      if (l.lineBreaks != null && (!Array.isArray(l.lineBreaks) || l.lineBreaks.some((n, i) => !Number.isInteger(n) || n <= 0 || n >= words(text).length || i && n <= l.lineBreaks[i - 1]))) fail("lineBreaks must be ordered word indices");
      if (!Array.isArray(l.lineBreaks)) l.lineBreaks = [];
      if (l.accentWord != null && (!Number.isInteger(l.accentWord) || l.accentWord < 0 || l.accentWord >= words(text).length)) fail("accentWord must index an evidence word");
      l.layout = textLayout(l, text);
      if (!l.layout.fits) fail("text cannot fit at the minimum readable size (display 48px, body 32px)");
      }
    }
    if (["image", "video"].includes(l.kind)) {
      const source = manifest.sources?.find((s) => s.id === l.sourceId), proof = manifest.proof?.find((p) => p.id === l.proofId);
      if (l.kind === "image" && (Boolean(l.sourceId) === Boolean(l.proofId) || !(source?.kind === "photo" || proof?.file && /\.(jpe?g|png|heic|webp)$/i.test(proof.file)))) fail("image needs one manifest photo source or proof image id");
      if (l.kind === "video" && (!source || source.kind === "photo")) fail("video needs a manifest video source id");
      l.fit ??= "contain";
      if (!["contain", "cover"].includes(l.fit)) fail("fit must be contain or cover");
      if (l.cutout != null && (typeof l.cutout !== "boolean" || l.kind !== "image")) fail("cutout must be boolean on an image");
      if (l.radius != null && (!Number.isInteger(l.radius) || l.radius < 0 || l.radius > Math.min(r.w, r.h) / 2)) fail("invalid video radius");
      if (l.kind === "video") {
        const meta = row(index, l.sourceId);
        if (![l.in, l.out].every(Number.isFinite) || l.in < 0 || l.out <= l.in || Math.abs((l.out - l.in) * FPS - (l.to - l.from)) > 0.001) fail("video in/out must provide exactly one source second per output second");
        if (!meta || !(meta.duration >= l.out - 1e-7)) fail("video range needs an indexed source with enough duration");
      }
      if (l.crop != null) { try { sourceCropOptions(l.crop, row(index, l.sourceId) || { width: 1920, height: 1080 }); } catch (e) { fail(e.message); } }
      if (clientDir && (source?.path || proof?.file)) { try { const f = assetPath(clientDir, source?.path || proof.file); if (!fs.statSync(f).isFile()) fail("source must be a file"); } catch (e) { fail(`missing or unsafe asset: ${e.message}`); } }
    }
    if (l.kind === "shape") {
      l.shape ??= "field"; l.color ??= "surface";
      if (!["field", "scrim", "rule"].includes(l.shape) || !COLORS.includes(l.color)) fail("shape/color must use the fixed shape vocabulary and brand tokens");
      if (l.opacity != null && (!Number.isFinite(l.opacity) || l.opacity < 0 || l.opacity > 1)) fail("opacity must be 0–1");
      if (l.direction != null && !["left", "right", "top", "bottom"].includes(l.direction)) fail("invalid scrim direction");
    }
    if (span && !l.allowOverFace) {
      let covered = 0;
      for (const item of introItems(plan)) {
        if (!item.protect || item.audio === "mute" || manifest.sources?.find((s) => s.id === item.sourceId)?.audio !== "ok") continue;
        const n = Math.max(0, Math.min(item.endFrame, span.startFrame + l.to) - Math.max(item.startFrame, span.startFrame + l.from));
        // Output-pixel face rectangles are operator observations covering the entire item, including cutaways.
        const faces = item.faceRects;
        if (n && (!Array.isArray(faces) || !faces.length || faces.some((f) => ![f?.x, f?.y, f?.w, f?.h].every(Number.isFinite) || f.x < 0 || f.y < 0 || f.w <= 0 || f.h <= 0 || f.x + f.w > box.width || f.y + f.h > (plan?.canvas?.height || 1080) || overlaps(l.bounds, f)))) covered += n;
      }
      if (covered > INTRO_FACE_MAX_FRAMES) fail(`covers a protected speaking face (or unmeasured picture) for ${covered} frames; maximum ${INTRO_FACE_MAX_FRAMES}; inspect and set allowOverFace explicitly`);
    }
    card.layers.push(l);
  }
  const refs = introReferences(input, manifest, plan);
  if (identityLeaks(input).length || identityLeaks(card).length) add("contains Greg's identity");
  for (const [kind, ids, registry] of [["source", refs.sourceIds, manifest.sources], ["proof", refs.proofIds, manifest.proof]]) for (const id of ids) {
    const asset = registry?.find((a) => a.id === id);
    if (!asset) { add(`unknown ${kind} ${id}`); continue; }
    const rights = manifest.rights?.find((r) => r.id === asset.rights);
    if (rights?.status !== "approved") add(`${kind} ${id} rights are ${rights?.status || "missing"}`, final || !rights ? "error" : "warn");
  }
  return { card, problems, span };
}

async function fileHash(file) {
  const h = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

export async function segmentIntroPerson(source, output) {
  const bin = await personBinary({ cacheDir: path.join(path.dirname(path.dirname(output)), "../helper") });
  if (!bin) throw new Error("Apple Vision person helper unavailable");
  const { out } = await run(bin, [source, "--still", "--out", output], { capture: true });
  const result = JSON.parse(out.slice(out.indexOf("{")));
  if (!result.best?.person?.w) throw new Error("Apple Vision returned no person mask");
}

/** Native still decode applies EXIF once. The non-Mac path uses ffmpeg's ordinary autorotation. */
export async function normalizeIntroStill(source, output, { cacheDir, runImpl = run } = {}) {
  if (process.platform === "darwin") {
    const bin = await personBinary({ cacheDir });
    if (bin) { await runImpl(bin, [source, "--still", "--normalize-only", "--out", output], { capture: true }); return; }
  }
  await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-an", "-frames:v", "1", output], { capture: true });
  return { warning: "intro: native EXIF helper unavailable; ffmpeg image fallback; verify upright orientation" };
}

/** Fail open, cache successful mattes by full source bytes and helper version. A failed matte is never cached. */
export async function introCutout(source, cacheDir, { segmenter = segmentIntroPerson, print = console.log } = {}) {
  const key = hash(`intro-person-v1:${await fileHash(source)}:${await fileHash(new URL("../scripts/person.swift", import.meta.url))}`);
  const file = path.join(ensureDir(cacheDir), `${key}.png`);
  if (fs.existsSync(file) && alphaPNG(fs.readFileSync(file))) return { file, key, cutout: true };
  const dir = fs.mkdtempSync(path.join(cacheDir, ".person-")), temp = path.join(dir, "person.png");
  try {
    await segmenter(source, temp);
    const bytes = fs.readFileSync(temp);
    if (!alphaPNG(bytes)) throw new Error("segmenter did not produce an alpha PNG");
    fs.renameSync(temp, file);
    return { file, key, cutout: true };
  } catch (error) {
    const warning = `intro cutout: ${String(error.message).split("\n")[0]}; using the original rectangular photo`;
    print(`WARNING ${warning}`); return { file: source, key, cutout: false, warning };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Upright SDR proxy, exact output frames. Audio is neither mapped nor decoded into the project. */
export function introProxyFilter(layer, meta, { preFilter = "", grade = "" } = {}) {
  const crop = sourceCropOptions(layer.crop, meta);
  const r = layer.rect, w = Math.max(2, Math.ceil(r.w / 2) * 2), h = Math.max(2, Math.ceil(r.h / 2) * 2);
  const resize = layer.fit === "cover" ? `scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos,crop=${w}:${h}` : `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;
  return ["setpts=PTS-STARTPTS", preFilter, "fps=30:start_time=0:round=near", grade, crop?.filter, resize, "setsar=1", "tpad=stop_mode=clone:stop_duration=0.034", `trim=end_frame=${layer.to - layer.from}`, "settb=expr=1/30", "setpts=N", "format=yuv420p", "setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709"].filter(Boolean).join(",");
}

/** Prepare only intro assets. Everything written is in the render project, never beside originals. */
export async function prepareIntroAssets(plan, { manifest, index, clientDir, projectDir, print = console.log, runImpl = run, segmenter, normalizeStill = normalizeIntroStill, probeImpl = probeSource, gradeImpl = prepareGrade, toneMapImpl = toneMapToSdr, zscaleImpl = hasZscale } = {}) {
  const prepared = {}, warnings = [], dir = ensureDir(path.join(projectDir, "assets/speaker-intro")), hashes = new Map();
  const digest = async (file) => { if (!hashes.has(file)) hashes.set(file, await fileHash(file)); return hashes.get(file); };
  for (const entry of plan.overlays || []) {
    if (entry.card?.type !== "intro") continue;
    const resolved = resolveIntro(entry.card, { manifest, index, plan, entry, clientDir });
    const errors = resolved.problems.filter((p) => p.level === "error");
    if (errors.length) throw new Error(`${entry.id}: ${errors.map((p) => p.message).join("; ")}`);
    prepared[entry.id] = {};
    for (const l of resolved.card.layers) {
      if (!["image", "video"].includes(l.kind)) continue;
      const source = manifest.sources?.find((s) => s.id === l.sourceId), proof = manifest.proof?.find((p) => p.id === l.proofId);
      const original = assetPath(clientDir, source?.path || proof.file), sourceHash = await digest(original);
      let file = original, meta = row(index, l.sourceId) || await probeImpl(original), preFilter = "", grade = "", cutout;
      if (l.kind === "image") {
        const upright = path.join(dir, `upright-${sourceHash}.png`);
        if (!fs.existsSync(upright)) {
          const temp = `${upright}.tmp.png`;
          try {
            const result = await normalizeStill(original, temp, { cacheDir: path.join(dir, "helper"), runImpl });
            if (result?.warning) { warnings.push(result.warning); print(`WARNING ${result.warning}`); }
            fs.renameSync(temp, upright);
          }
          finally { fs.rmSync(temp, { force: true }); }
        }
        file = upright; meta = await probeImpl(upright);
      }
      let rotation = meta.rotationCw || 0, hdr = meta.hdr;
      if (meta.hdrKind === "pq") {
        const mapped = path.join(dir, `pq-${sourceHash}.mp4`);
        if (fs.existsSync(mapped) || await toneMapImpl(original, mapped, { ...meta, hasAudio: false })) { file = mapped; rotation = 0; hdr = false; }
        else { const warning = `${entry.id}/${l.id}: PQ tone mapping unavailable; using SDR fallback; review colour`; warnings.push(warning); print(`WARNING ${warning}`); }
      }
      const hlg = hdr && meta.hdrKind === "hlg" && plan.look?.hlg === "review";
      const review = hlg && await zscaleImpl();
      if (hlg && !review) { const warning = `${entry.id}/${l.id}: zscale unavailable; using legacy HLG conversion`; warnings.push(warning); print(`WARNING ${warning}`); }
      preFilter = [...rotateFilters(rotation), ...evenFilters(meta.width, meta.height), hdr ? review ? hlgToSdrFilter() : SDR_FILTER : ["smpte170m", "bt470bg"].includes(meta.colorSpace) ? `colorspace=iall=${meta.colorSpace}:all=bt709:format=yuv420p` : ""].filter(Boolean).join(",");
      if ((plan.look?.grade ?? "auto") === "auto") {
        const g = await gradeImpl(file, { sourceKey: sourceHash, meta, preFilter, ranges: l.kind === "video" ? [{ in: l.in, out: l.out }] : undefined, overrides: plan.look?.sources?.[l.sourceId] || {}, cacheDir: path.join(dir, "grade"), print });
        grade = g.filter || "";
      }
      let filter, name;
      if (l.kind === "image") {
        // Normalize once before segmentation/cropping. Windows from one photo share these bytes.
        const normalized = path.join(dir, `${hash(JSON.stringify([sourceHash, preFilter, grade, "image-v1"]))}.png`);
        if (!fs.existsSync(normalized)) {
          const temp = `${normalized}.tmp.png`;
          try { await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-noautorotate", "-i", file, "-map", "0:v:0", "-an", "-vf", [preFilter, grade, "format=rgba"].filter(Boolean).join(","), "-frames:v", "1", temp], { capture: true }); fs.renameSync(temp, normalized); }
          finally { fs.rmSync(temp, { force: true }); }
        }
        file = normalized;
        if (l.cutout) {
          cutout = await introCutout(file, path.join(dir, "mattes"), { segmenter, print }); file = cutout.file;
          if (cutout.warning) warnings.push(cutout.warning);
        }
        name = path.relative(projectDir, file).split(path.sep).join("/");
      } else {
        filter = introProxyFilter(l, meta, { preFilter, grade });
        name = `assets/speaker-intro/${hash(JSON.stringify([sourceHash, l.in, l.out, filter, "video-v1"]))}.mp4`;
        const output = path.join(projectDir, name);
        if (!fs.existsSync(output)) {
          const temp = `${output}.tmp.mp4`;
          try {
            await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-noautorotate", "-ss", String(l.in), "-t", String(l.out - l.in + 1 / FPS), "-i", file, "-map", "0:v:0", "-an", "-vf", filter, "-frames:v", String(l.to - l.from), "-r", "30", "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", ...SDR_TAGS, "-metadata:s:v:0", "rotate=0", "-movflags", "+faststart", temp], { capture: true });
            const check = await probeImpl(temp);
            if (check.hasAudio || Math.abs(check.duration - (l.to - l.from) / FPS) > 1 / FPS / 2) throw new Error(`${entry.id}/${l.id}: proxy has wrong duration or audio`);
            fs.renameSync(temp, output);
          } finally { fs.rmSync(temp, { force: true }); }
        }
      }
      prepared[entry.id][l.id] = { file: name, original, sourceHash, width: meta.width, height: meta.height, filter: filter && String(filter).replace(/\/(Users|home)\/[^/:,]+/g, "/$1/local"), ...(cutout ? { cutout: cutout.cutout, matteKey: cutout.key, warning: cutout.warning } : {}) };
    }
  }
  return { prepared, warnings };
}

function animationCode(target, a, start) {
  const offset = (start + a.from) / FPS, duration = (a.to - a.from) / FPS;
  if (a.type === "cut") return `tl.set(${js(target)},{autoAlpha:1},${offset});`;
  const masks = { left: "inset(0 100% 0 0)", right: "inset(0 0 0 100%)", top: "inset(0 0 100% 0)", bottom: "inset(100% 0 0 0)" };
  const props = {
    rise: [{ y: a.dy ?? 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1 }, "power2.out"],
    slam: [{ x: a.dx ?? 80, y: a.dy ?? 24, scale: 1.08 }, { x: 0, y: 0, scale: 1 }, "power3.out"],
    settle: [{ scale: 1.04 }, { scale: 1 }, "power2.out"],
    wipe: [{ clipPath: masks[a.side || "left"] }, { clipPath: "inset(0 0 0 0)" }, "power3.out"],
    drift: [{ x: 0, y: 0 }, { x: a.dx ?? -8, y: a.dy ?? 0 }, "none"],
    fade: [{ autoAlpha: a.out ? 1 : 0 }, { autoAlpha: a.out ? 0 : 1 }, "none"],
  }[a.type];
  return `tl.fromTo(${js(target)},${js(props[0])},${js({ ...props[1], duration, ease: props[2], immediateRender: false })},${offset});`;
}

/** Fragment on the caller's paused GSAP timeline; wrappers move, video elements never do. */
export function renderIntro(card, { id, span, tokens, assets = {}, offsetY = 0 } = {}) {
  const html = [], timeline = [], review = [];
  for (const [n, l] of card.layers.entries()) {
    const lid = `${id}-layer-${n}`, target = `#${lid}`, r = l.rect, first = span.startFrame + l.from, end = span.startFrame + l.to;
    let content = "", style = `left:${r.x}px;top:${r.y - offsetY}px;width:${r.w}px;height:${r.h}px;`;
    if (l.kind === "text") {
      let index = 0;
      content = l.layout.lines.map((line) => words(line).map((word) => {
        const i = index++;
        return `<span id="${lid}-word-${i}" style="${i === l.accentWord ? "color:var(--brand-accent);" : ""}${l.wordByWord ? "opacity:0;visibility:hidden" : ""}">${esc(word)}</span>`;
      }).join(" ")).join("<br>");
      style += `font-family:var(--brand-${l.font}-font);font-weight:var(--brand-${l.font}-weight);font-size:${l.layout.fontSize}px;line-height:1.25;color:var(--brand-${l.color});white-space:nowrap;`;
      if (l.wordByWord) for (const [i, frame] of l.wordFrames.entries()) timeline.push(`tl.set(${js(`#${lid}-word-${i}`)},{autoAlpha:1},${(span.startFrame + frame) / FPS});`);
    } else if (["image", "video"].includes(l.kind)) {
      const asset = assets[l.id];
      if (!asset?.file) throw new Error(`intro ${l.id}: prepared asset is missing`);
      if (l.kind === "video") content = `<video src="${esc(asset.file)}" muted playsinline preload="auto" data-start="${first / FPS}" data-duration="${(end - first) / FPS}" data-media-start="0" data-track-index="${10 + n}" data-has-audio="false" style="width:100%;height:100%;object-fit:${l.fit}"></video>`;
      else {
        const c = l.crop || { x: 0, y: 0, w: 1, h: 1 };
        const W = asset.width, H = asset.height;
        if (!(W > 0 && H > 0)) throw new Error(`intro ${l.id}: upright image dimensions are missing`);
        // SVG gives both windows one shared photo while cropping the upright normalized source exactly.
        content = `<svg width="100%" height="100%" viewBox="${c.x * W} ${c.y * H} ${c.w * W} ${c.h * H}" preserveAspectRatio="xMidYMid ${l.fit === "cover" ? "slice" : "meet"}"><image href="${esc(asset.file)}" width="${W}" height="${H}" /></svg>`;
      }
      style += `overflow:hidden;border-radius:${l.radius || 0}px;`;
    }
    // Separate a shape's authored opacity from visibility animation.
    const innerStyle = l.kind === "shape" ? ` style="opacity:${l.opacity ?? 1};width:100%;height:100%;background:${l.shape === "scrim" ? `linear-gradient(to ${l.direction || "right"},${tokens.colors[l.color]},transparent)` : tokens.colors[l.color]}"` : "";
    if (l.kind === "shape") style = `left:${r.x}px;top:${r.y - offsetY}px;width:${r.w}px;height:${r.h}px;`;
    html.push(`<div id="${lid}" class="speaker-intro-layer si-${l.kind} clip" style="${style}" data-start="${first / FPS}" data-duration="${(end - first) / FPS}" data-track-index="4"><div class="si-motion">${l.kind === "shape" ? `<div${innerStyle}></div>` : content}</div></div>`);
    timeline.push(`tl.set(${js(target)},{autoAlpha:1},${first / FPS});`);
    for (const a of l.animations) timeline.push(animationCode(a.out ? target : `${target} > .si-motion`, a, span.startFrame));
    timeline.push(`tl.set(${js(target)},{autoAlpha:0},${end / FPS});`);
    review.push({ id: l.id, kind: l.kind, firstFrame: first, lastFrame: end - 1, rect: r, bounds: l.bounds, sourceId: l.sourceId, proofId: l.proofId, proofField: l.proofField, identity: l.identity, sourceWordRange: l.sourceWordRange, itemId: l.itemId, wordFrames: l.wordFrames?.map((f) => span.startFrame + f), sourceIn: l.in, sourceOut: l.out, crop: l.crop, fit: l.fit, allowOverFace: l.allowOverFace === true, bleed: l.bleed === true, sourceTypography: l.sourceTypography, sourceText: l.sourceText, text: l.text, animations: l.animations, ...assets[l.id] });
  }
  return { html: html.join("\n"), css: ".speaker-intro-layer{position:absolute;opacity:0;visibility:hidden;pointer-events:none;z-index:4}.si-motion{width:100%;height:100%;transform-origin:center}.si-text{background:none;padding:0;text-shadow:0 2px 12px #0006}", timeline: timeline.join("\n"), assets: [], warnings: [], layout: { fits: true, activeAware: true }, text: card.layers.filter((l) => l.kind === "text").map((l) => l.text), layers: review };
}
