import fs from "node:fs";
import path from "node:path";
import { run, r3 } from "./util.mjs";
import { probe } from "./probe.mjs";
import { hookBlockHeight } from "./placement.mjs";

/**
 * Preflight: checks on the finished file before it reaches the Desktop. Sound (integrated loudness, true peak,
 * loudness range), the open (a black or static first second, silence at the start), dead air anywhere, the render
 * length against the plan, and the layout from the plan (captions over the chin, the hook over the face, text in the
 * strip Instagram covers with its own caption and buttons). Thresholds follow the reel-qc project (MIT) and the
 * Instagram Reels safe-zone overlays.
 *
 * Nothing here blocks delivery unless preflight.strict is set; the report is written as preflight.txt either way.
 */

// Instagram Reels at 9:16: the caption and handle strip at the bottom, the icon column on the right, the top bar.
export const SAFE = { top: 0.07, bottom: 0.167, right: 0.11, rightFrom: 0.42, rightTo: 0.86 };

export async function measureLoudness(file) {
  const { err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true, allowFail: true });
  // The per-frame lines carry I:/LRA: too; only the Summary block at the end counts.
  const summary = err.slice(Math.max(0, err.lastIndexOf("Summary:")));
  const num = (re) => { const m = summary.match(re); return m ? r3(+m[1]) : null; };
  const peaks = [...summary.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].map((m) => +m[1]);
  return { i: num(/\bI:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), tp: peaks.length ? r3(peaks[peaks.length - 1]) : null };
}

/** Black at the start: seconds of (almost) black video from frame 0, or 0. */
export async function blackOpen(file, { seconds = 1.5 } = {}) {
  const { err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-t", String(seconds), "-i", file, "-an", "-vf", "blackdetect=d=0.08:pix_th=0.10", "-f", "null", "-"], { capture: true, allowFail: true });
  const m = err.match(/black_start:0(?:\.0+)?\s+black_end:([\d.]+)/);
  return m ? r3(+m[1]) : 0;
}

/** Mean frame-to-frame change over the first `seconds` (0-255 on a small grey copy): under ~0.4 reads as a still. */
export async function openMotion(file, { seconds = 2 } = {}) {
  const { out, err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-t", String(seconds), "-i", file, "-an", "-vf", "scale=120:-2,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], { capture: true, allowFail: true });
  const vals = [...`${out}\n${err}`.matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]).slice(1);
  return vals.length ? r3(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

/** Silences of at least `min` seconds: [{start, end}]. */
export async function silences(file, { noise = -45, min = 1.5 } = {}) {
  const { err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=n=${noise}dB:d=${min}`, "-f", "null", "-"], { capture: true, allowFail: true });
  const out = [];
  let start = null;
  for (const line of err.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (s) start = Math.max(0, +s[1]);
    if (e && start != null) { out.push({ start: r3(start), end: r3(+e[1]) }); start = null; }
  }
  return out;
}

/** Layout checks from the plan alone (no decoding). */
export function layoutChecks(plan) {
  const items = [];
  if (!plan) return items;
  const st = plan.style || {};
  const W = plan.canvas?.width || 1080, H = plan.canvas?.height || 1920;
  const portrait = H > W;
  const head = plan.head; // {top, bottom} fractions, when a face was found
  const cap = st.captions || {};
  if (plan.captions?.length && cap.enabled !== false) {
    const lines = Math.max(1, Math.ceil((cap.wordsPerLine || 3) / 3));
    const top = cap.position - 0.02;
    const bottom = cap.position + lines * (cap.fontSizeFrac || 0.04) * 1.35;
    if (head && top < head.bottom - 0.015) items.push({ level: "warn", code: "captions-face", message: `captions start at ${pct(top)}, over the chin (head ends at ${pct(head.bottom)})` });
    if (portrait && bottom > 1 - SAFE.bottom) items.push({ level: "warn", code: "captions-safe-zone", message: `captions reach ${pct(bottom)}, inside the strip Instagram covers with its caption (keep above ${pct(1 - SAFE.bottom)})` });
  }
  const hk = st.hook || {};
  if (plan.hook && head && !plan.behind) {
    const fontPx = Math.round((hk.fontSizeFrac || 0.052) * H * (hk.style === "headline" ? 1.08 : 1));
    const words = plan.hook.words || String(plan.hook.text || "").split(/\s+/).map((t) => ({ text: t }));
    const h = hookBlockHeight(words, { W, H, fontPx });
    const top = hk.position, bottom = hk.position + h;
    const overlap = Math.min(bottom, head.bottom) - Math.max(top, head.top);
    if (overlap > 0.02) items.push({ level: "warn", code: "hook-face", message: `the hook (${pct(top)}-${pct(bottom)}) sits over the face (${pct(head.top)}-${pct(head.bottom)})` });
    if (portrait && top < SAFE.top) items.push({ level: "warn", code: "hook-safe-zone", message: `the hook starts at ${pct(top)}, under the top bar` });
  }
  if (plan.cta && portrait) {
    const p = plan.cta.position ?? st.cta?.position ?? 0.62;
    if (p + 0.06 > 1 - SAFE.bottom) items.push({ level: "warn", code: "cta-safe-zone", message: `the CTA at ${pct(p)} is inside the Instagram caption strip` });
  }
  return items;
}

const pct = (f) => `${Math.round(f * 100)}%`;

/**
 * Run every check on `file`. Returns {status: ok|warn|fail, items, measures}. `plan` is the reel's plan.json when
 * available (layout checks and the expected length).
 */
export async function runPreflight(file, { plan = null, loudnessTarget = -14, loudnessTolerance = 1.5 } = {}) {
  const items = [];
  const meta = await probe(file);
  const measures = { duration: r3(meta.duration), width: meta.width, height: meta.height };
  const expected = plan?.video?.duration;
  if (expected && Math.abs(meta.duration - expected) > 0.5) items.push({ level: "fail", code: "length", message: `the file runs ${r3(meta.duration)}s, the plan is ${r3(expected)}s (render cut short?)` });
  if (plan?.video?.hasAudio && !meta.hasAudio) items.push({ level: "fail", code: "no-audio", message: "the file has no audio track" });
  if (meta.hasAudio) {
    const loud = await measureLoudness(file);
    Object.assign(measures, { lufs: loud.i, lra: loud.lra, truePeak: loud.tp });
    if (loud.i != null && Math.abs(loud.i - loudnessTarget) > loudnessTolerance) items.push({ level: "fail", code: "loudness", message: `loudness ${loud.i} LUFS (target ${loudnessTarget} ±${loudnessTolerance})` });
    if (loud.tp != null && loud.tp > -0.5) items.push({ level: "fail", code: "peak", message: `true peak ${loud.tp} dBTP (keep at or under -1)` });
    if (loud.lra != null && loud.lra > 14) items.push({ level: "warn", code: "range", message: `loudness range ${loud.lra} LU is wide (quiet lines will drop out on a phone)` });
    const quiet = await silences(file, { min: 1.5 });
    const open = quiet.find((s) => s.start < 0.05);
    if (open && open.end >= 1) items.push({ level: "fail", code: "silent-open", message: `no sound for the first ${open.end}s` });
    const longest = quiet.filter((s) => s !== open).sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (longest && longest.end - longest.start >= 2) items.push({ level: "warn", code: "dead-air", message: `${r3(longest.end - longest.start)}s of silence at ${fmt(longest.start)}` });
  }
  const black = await blackOpen(file);
  measures.blackOpen = black;
  if (black >= 0.3) items.push({ level: "fail", code: "black-open", message: `the first ${black}s are black` });
  const motion = await openMotion(file);
  measures.openMotion = motion;
  if (motion != null && motion < 0.4) items.push({ level: "warn", code: "static-open", message: `almost nothing moves in the first 2 s (motion ${motion})` });
  items.push(...layoutChecks(plan));
  const status = items.some((i) => i.level === "fail") ? "fail" : items.length ? "warn" : "ok";
  return { status, items, measures };
}

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function preflightText(res) {
  const m = res.measures || {};
  const head = res.status === "ok" ? "Preflight: OK" : res.status === "warn" ? "Preflight: check these" : "Preflight: FAILED";
  const lines = [head, ""];
  for (const i of res.items) lines.push(`${i.level === "fail" ? "FAIL" : "warn"}  ${i.message}`);
  if (res.items.length) lines.push("");
  const facts = [];
  if (m.lufs != null) facts.push(`${m.lufs} LUFS`);
  if (m.truePeak != null) facts.push(`peak ${m.truePeak} dBTP`);
  if (m.lra != null) facts.push(`range ${m.lra} LU`);
  if (m.duration != null) facts.push(`${m.duration}s`);
  if (m.width) facts.push(`${m.width}x${m.height}`);
  if (m.openMotion != null) facts.push(`open motion ${m.openMotion}`);
  lines.push(`Measured: ${facts.join(", ")}`);
  return lines.join("\n") + "\n";
}

/** One log line. */
export function describePreflight(res) {
  if (res.status === "ok") return "preflight: ok";
  const fails = res.items.filter((i) => i.level === "fail").length;
  const warns = res.items.length - fails;
  const parts = [];
  if (fails) parts.push(`${fails} fail${fails === 1 ? "" : "s"}`);
  if (warns) parts.push(`${warns} warning${warns === 1 ? "" : "s"}`);
  return `preflight: ${parts.join(", ")}: ${res.items.map((i) => i.message).join("; ")}`;
}

export function writePreflight(dir, res) {
  const p = path.join(dir, "preflight.txt");
  fs.writeFileSync(p, preflightText(res));
  fs.writeFileSync(path.join(dir, "preflight.json"), JSON.stringify(res, null, 2));
  return p;
}
