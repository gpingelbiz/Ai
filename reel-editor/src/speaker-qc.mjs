import fs from "node:fs";
import path from "node:path";
import { probe } from "./probe.mjs";
import { measureLoudness, silences } from "./preflight.mjs";
import { run, writeJSON } from "./util.mjs";
import { identityLeaks } from "./speaker-guard.mjs";
import { resolveCard } from "./speaker-cards.mjs";

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

/** Strict speaker delivery QC. deps makes media measurements replaceable in offline tests. */
export async function speakerQC(video, { resolvedPlan, manifest, final = false, captionFiles, deps = {} } = {}) {
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
