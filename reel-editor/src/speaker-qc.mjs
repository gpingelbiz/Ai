import fs from "node:fs";
import path from "node:path";
import { probe } from "./probe.mjs";
import { measureLoudness, silences } from "./preflight.mjs";
import { run, writeJSON } from "./util.mjs";
import { identityLeaks } from "./speaker-guard.mjs";
import { audioQualityWarnings } from "./speaker-audio-quality.mjs";
import { resolveCard, cardCopyEvidence } from "./speaker-cards.mjs";
import { loadInsertFlags, insertWarnings } from "./speaker-inserts.mjs";

/** Accept the explicit output fields, or start/end from a compiled plan. Never use source in/out as output time. */
export function outputSpan(item) {
  const start = Number(item.outputStart ?? item.start ?? item.output?.start);
  const end = Number(item.outputEnd ?? item.end ?? item.output?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(`speaker item ${item.id || "?"}: invalid resolved output span`);
  return { start, end };
}

export function planDuration(plan) {
  if (!plan?.items?.length) throw new Error("speaker plan: no items");
  return Math.max(...plan.items.map((item) => outputSpan(item).end));
}

/** Only referenced proof is counted; testimonials also bring their original source into the rights check. */
export function usedAssets(plan, manifest) {
  const sourceIds = new Set(), proofIds = new Set();
  const entries = [...(plan.items || []), ...(plan.overlays || []), ...(plan.cutaways || [])];
  for (const item of entries) {
    if (item.card?.type === "event-list") for (const id of Array.isArray(item.card.sourceIds) ? item.card.sourceIds : []) sourceIds.add(id);
    if (item.card) for (const id of cardCopyEvidence(item.card, manifest).proofIds) proofIds.add(id);
    if (item.sourceId) sourceIds.add(item.sourceId);
    if (item.proofId) proofIds.add(item.proofId);
    if (item.card?.proofId) proofIds.add(item.card.proofId);
    for (const id of item.card?.logos || []) proofIds.add(id);
    // A quote or name card can be written by attribution instead of proofId: count the proof it actually matches.
    if (item.card) { const { card } = resolveCard(item.card, { manifest }); if (card.proofId) proofIds.add(card.proofId); }
  }
  // A testimonial used as footage remains proof even without a name overlay.
  for (const proof of manifest.proof || []) if (proof.sourceId && sourceIds.has(proof.sourceId)) proofIds.add(proof.id);
  for (const id of proofIds) {
    const proof = (manifest.proof || []).find((p) => p.id === id);
    if (proof?.sourceId) sourceIds.add(proof.sourceId);
  }
  return { sourceIds: [...sourceIds], proofIds: [...proofIds] };
}

export function rightsChecks(plan, manifest, final = false) {
  const used = usedAssets(plan, manifest), checks = [];
  for (const [type, ids, registry] of [["source", used.sourceIds, manifest.sources], ["proof", used.proofIds, manifest.proof]]) {
    for (const id of ids) {
      const asset = (registry || []).find((p) => p.id === id);
      const rights = (manifest.rights || []).find((r) => r.id === asset?.rights);
      const status = rights?.status || "unknown";
      checks.push({ code: "rights", level: !asset ? "fail" : status === "approved" ? "pass" : final ? "fail" : "warn", assetType: type, assetId: id, status,
        message: `${type} ${id}: ${!asset ? "unknown ID" : `${status} rights (${asset.rights || "missing rights reference"})`}` });
    }
  }
  // The headshot appears on the booking card and on an inserted title card: its photo needs clearing like proof.
  const identity = manifest.identity || {};
  const showsHeadshot = identity.headshot && [...(plan.items || []), ...(plan.overlays || [])].some((i) => i.card?.type === "booking" || (i.card?.type === "title" && i.kind === "card"));
  if (showsHeadshot) {
    const status = (manifest.rights || []).find((r) => r.id === identity.headshotRights)?.status || "unknown";
    checks.push({ code: "rights", level: status === "approved" ? "pass" : final ? "fail" : "warn", assetType: "headshot", assetId: "identity.headshot", status,
      message: `headshot ${identity.headshot}: ${status} rights (${identity.headshotRights || "missing rights reference"})` });
  }
  if (plan.music) {
    const licensed = (manifest.music || []).some((m) => m.file === plan.music.file && String(m.license || "").trim());
    checks.push({ code: "music-license", level: licensed ? "pass" : final ? "fail" : "warn", message: licensed ? "music licence recorded" : "music licence missing; draft music skipped" });
  }
  return checks;
}

/** Filesystem paths can contain the operator's home name; inspect all editorial text, excluding path metadata. */
export const identityProblems = (value, prefix = "") => identityLeaks(value, prefix);

/** Remove the union of card inserts from a detector span; a gap straddling a card still has to pass. */
export function gapsOutsideCards(gaps, plan, min = 1.5) {
  const cards = (plan.items || []).filter((i) => i.kind === "card").map(outputSpan).sort((a, b) => a.start - b.start);
  return gaps.flatMap((gap) => {
    let pieces = [{ start: gap.start, end: gap.end }];
    for (const card of cards) pieces = pieces.flatMap((p) => {
      if (card.end <= p.start || card.start >= p.end) return [p];
      return [p.start < card.start ? { start: p.start, end: card.start } : null, p.end > card.end ? { start: card.end, end: p.end } : null].filter(Boolean);
    });
    return pieces.filter((p) => p.end - p.start > min + 1e-6);
  });
}

export function captionEnd(text) {
  const toSeconds = (s) => s.replace(",", ".").split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
  const ends = [...String(text).matchAll(/(?:\d{1,}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*((?:\d{1,}:)?\d{2}:\d{2}[.,]\d{3})/g)].map((m) => toSeconds(m[1]));
  return ends.length ? Math.max(...ends) : null;
}

async function encoding(file) {
  const { out } = await run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file], { capture: true });
  const streams = JSON.parse(out).streams || [];
  return { video: streams.find((s) => s.codec_type === "video"), audio: streams.find((s) => s.codec_type === "audio") };
}

async function blackGaps(file) {
  const { err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", "scale=160:-2,blackdetect=d=0.1:pix_th=0.10:pic_th=0.999", "-f", "null", "-"], { capture: true });
  return [...err.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({ start: +m[1], end: +m[2] }));
}

/** Indexed timings are evidence for a listening check, not permission to rewrite the transcript. */
export function wordBoundaryProblems(item, words, { fps = 30 } = {}) {
  if (item.kind !== "clip" || item.audio === "mute") return [];
  const checks = [];
  for (const [n, word] of words.entries()) {
    if (![word.start, word.end].every(Number.isFinite) || word.end <= word.start) continue;
    for (const boundary of ["in", "out"]) {
      const at = item[boundary], excluded = boundary === "in" ? at - word.start : word.end - at;
      if (!(at > word.start && at < word.end && excluded > 0.05 + 1e-7)) continue;
      // Choose the nearest frame boundary that retains the whole indexed word, without adding a handle.
      const before = Math.max(0, Math.floor(word.start * fps + 1e-7) / fps);
      const after = Math.ceil(word.end * fps - 1e-7) / fps;
      const safeIn = before >= (words[n - 1]?.end ?? 0) ? before : word.start;
      const safeOut = after <= (words[n + 1]?.start ?? Infinity) ? after : word.end;
      checks.push({ code: "word-boundary", level: "warn", itemId: item.id, sourceId: item.sourceId, boundary, at,
        word: word.text, sourceStart: word.start, sourceEnd: word.end, safeIn, safeOut,
        message: `${item.id}: source ${boundary} ${at}s cuts inside “${word.text}” (${word.start}-${word.end}s); safe ${boundary} ${(boundary === "in" ? safeIn : safeOut).toFixed(3)}s; safe out ${safeOut.toFixed(3)}s — audition the indexed word` });
    }
  }
  return checks;
}

/** Adjacent frames must agree: scene cuts and sustained lighting changes are not isolated flashes. */
export function brightnessFlashes(frames, { minDelta = 18, maxNeighborDelta = 8, ignoreFrameRanges = [] } = {}) {
  const flashes = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const a = frames[i - 1], b = frames[i], c = frames[i + 1];
    if (![a.luma, b.luma, c.luma, b.time].every(Number.isFinite) || b.frame !== a.frame + 1 || c.frame !== b.frame + 1) continue;
    if (ignoreFrameRanges.some((r) => b.frame >= r.start && b.frame < r.end)) continue;
    const delta = b.luma - (a.luma + c.luma) / 2;
    if (Math.abs(a.luma - c.luma) > maxNeighborDelta || Math.abs(b.luma - a.luma) < minDelta || Math.abs(b.luma - c.luma) < minDelta || (b.luma - a.luma) * (b.luma - c.luma) <= 0) continue;
    flashes.push({ code: "brightness-flash", level: "warn", frame: b.frame, time: b.time, luma: b.luma, delta,
      message: `isolated ${delta > 0 ? "bright" : "dark"} frame at ${b.time.toFixed(3)}s (frame ${b.frame}, YAVG ${b.luma.toFixed(2)}, neighbor delta ${delta.toFixed(2)}); review picture` });
  }
  return flashes;
}

export const FRAME_INTEGRITY_FILTER = "scale=160:90:flags=area,format=yuv420p,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-";

/** Decode every frame, including cards. Small full-frame luma measurements keep the scan inexpensive. */
export async function frameIntegrityChecks(file, options = {}) {
  const { out } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostats", "-i", file, "-map", "0:v:0", "-an", "-vf", FRAME_INTEGRITY_FILTER, "-fps_mode", "passthrough", "-f", "null", "-"], { capture: true });
  // Metadata prints one header followed by the requested key, at the original decoded timestamp.
  const measured = [...out.matchAll(/frame:\s*(\d+)[^\n]*pts_time:([\d.eE+-]+)\s*\nlavfi\.signalstats\.YAVG=([\d.eE+-]+)/g)]
    .map((m) => ({ frame: +m[1], time: +m[2], luma: +m[3] }));
  if (!measured.length) throw new Error("no decoded frame luminance measurements");
  return brightnessFlashes(measured, options);
}

/** Strict speaker delivery QC. deps makes media measurements replaceable in offline tests. */
export async function speakerQC(video, { resolvedPlan, manifest, final = false, captionFiles, folder, candidates = null, index = null, frameIntegrityExclusions = [], deps = {} } = {}) {
  const plan = typeof resolvedPlan === "string" ? JSON.parse(fs.readFileSync(resolvedPlan, "utf8")) : resolvedPlan;
  const checks = [], duration = planDuration(plan), canvas = plan.canvas || { width: 1920, height: 1080, fps: 30 };
  const add = (code, ok, message) => checks.push({ code, level: ok ? "pass" : "fail", message });
  try {
    const meta = await (deps.probe || probe)(video);
    const enc = await (deps.encoding || encoding)(video);
    const loud = await (deps.measureLoudness || measureLoudness)(video);
    add("loudness", Number.isFinite(loud.i) && Math.abs(loud.i + 14) <= 1, `integrated loudness ${loud.i} LUFS; target -14 ±1`);
    add("peak", Number.isFinite(loud.tp) && loud.tp <= -1, `true peak ${loud.tp} dBTP; maximum -1`);
    add("duration", Math.abs(meta.duration - duration) <= 1 / (canvas.fps || 30) + 1e-6, `duration ${meta.duration}s; plan ${duration}s`);
    add("dimensions", meta.width === canvas.width && meta.height === canvas.height, `${meta.width}x${meta.height}; expected ${canvas.width}x${canvas.height}`);
    const rate = (s) => { const [n, d = 1] = String(s).split("/").map(Number); return n / d; };
    add("fps", Math.abs(meta.fps - (canvas.fps || 30)) < 0.001 && Math.abs(rate(enc.video?.avg_frame_rate) - meta.fps) < 0.001, `${meta.fps} fps; expected ${canvas.fps || 30} CFR`);
    add("pixel-format", meta.pixFmt === "yuv420p", `${meta.pixFmt}; expected yuv420p`);
    add("video-codec", meta.codec === "h264", `${meta.codec}; expected H.264`);
    add("audio", enc.audio?.codec_name === "aac" && Number(enc.audio?.sample_rate) === 48000 && enc.audio?.channels === 2, "audio must be AAC, 48 kHz stereo");
    for (const [code, detect] of [["silence", deps.silences || silences], ["black", deps.blackGaps || blackGaps]]) {
      const gaps = gapsOutsideCards(await detect(video, { min: 1.5 }), plan);
      add(code, !gaps.length, gaps.length ? gaps.map((g) => `${code} gap ${g.start}-${g.end}s`).join("; ") : `no ${code} gap over 1.5s outside cards`);
    }
    for (const ext of ["srt", "vtt"]) {
      const adjacent = video.replace(/\.[^.]+$/, `.${ext}`);
      const file = captionFiles?.[ext] || (fs.existsSync(adjacent) ? adjacent : path.join(path.dirname(video), `captions.${ext}`));
      const end = fs.existsSync(file) ? captionEnd(fs.readFileSync(file, "utf8")) : null;
      const empty = end == null && fs.existsSync(file) && !fs.readFileSync(file, "utf8").replace(/^WEBVTT\s*/, "").trim();
      add(`captions-${ext}`, (end != null && end < meta.duration) || empty, `${path.basename(file)}: ${end != null ? `last cue ${end}s; video ${meta.duration}s` : empty ? "no spoken cues" : "missing or invalid captions"}`);
    }
  } catch (error) { add("media", false, `cannot check ${video}: ${error.message}`); }
  try {
    const flashes = await (deps.frameIntegrityChecks || frameIntegrityChecks)(video, { ignoreFrameRanges: frameIntegrityExclusions });
    checks.push(...flashes);
    if (!flashes.length) checks.push({ code: "brightness-flash", level: "pass", message: "no isolated full-frame brightness excursions" });
  } catch (error) { checks.push({ code: "brightness-flash", level: "warn", message: `frame integrity scan unavailable: ${error.message.split("\n")[0]}` }); }
  const clientFolder = folder || path.resolve(path.dirname(typeof resolvedPlan === "string" ? resolvedPlan : video), "../..");
  try {
    const indexFile = path.join(clientFolder, "work", "index", "sources.json");
    const sourceIndex = index || (fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : null);
    for (const item of plan.items || []) {
      if (item.kind !== "clip" || item.audio === "mute" || ["none", "bad"].includes(manifest.sources?.find((s) => s.id === item.sourceId)?.audio)) continue;
      const words = (sourceIndex?.sources?.[item.sourceId] || sourceIndex?.[item.sourceId])?.words;
      if (Array.isArray(words)) checks.push(...wordBoundaryProblems(item, words, { fps: canvas.fps || 30 }));
      else checks.push({ code: "word-boundary", level: "warn", itemId: item.id, message: `${item.id}: indexed words unavailable; word boundaries not checked` });
    }
  } catch (error) { checks.push({ code: "word-boundary", level: "warn", message: `word boundary check unavailable: ${error.message}` }); }
  // Quality is advisory; final byte/rights checks still control approval.
  let audioCandidates = candidates || [];
  const candidateFile = path.join(folder || path.resolve(path.dirname(video), "../.."), "work", "candidates", "all.json");
  if (!candidates && candidateFile && fs.existsSync(candidateFile)) {
    try { audioCandidates = JSON.parse(fs.readFileSync(candidateFile, "utf8")); }
    catch { /* Optional alternate evidence must not block delivery checks. */ }
  }
  checks.push(...audioQualityWarnings(plan, audioCandidates, manifest));
  // Optional original-picture flags: subtract cutaways, then inspect their own picture sources too.
  checks.push(...insertWarnings(plan, deps.inserts || loadInsertFlags(clientFolder)));
  checks.push(...rightsChecks(plan, manifest, final));
  for (const p of plan.composition?.cardProblems || []) checks.push({ code: p.code, level: p.level === "error" ? "fail" : "warn", message: p.message });
  const identity = [...identityProblems(plan, "plan"), ...identityProblems(manifest, "manifest")];
  add("identity", !identity.length, identity.length ? `forbidden Greg identity at ${identity.join(", ")}` : "client identity only");
  const last = [...plan.items].sort((a, b) => outputSpan(a).start - outputSpan(b).start).at(-1);
  const span = outputSpan(last);
  add("booking", last.card?.type === "booking" && span.end - span.start >= 5 - 1e-6, `last item ${last.id} must be a booking card held at least 5s`);
  return { ok: !checks.some((c) => c.level === "fail"), checks };
}

export function writeQC(dir, res) {
  writeJSON(path.join(dir, "qc.json"), res);
  const file = path.join(dir, "qc.txt");
  fs.writeFileSync(file, [`Speaker QC: ${res.ok ? "OK" : "FAILED"}`, ...res.checks.map((c) => `${c.level.toUpperCase()} ${c.code}: ${c.message}`), ""].join("\n"));
  return file;
}
