import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ocrBinary, parseOcrJSON } from "./evidence.mjs";
import { boxIntersection, matchExpectedText, textTokens } from "./slide-preflight.mjs";
import { ensureDir, readJSON, run, writeJSON } from "./util.mjs";

const VIDEO = /\.(mp4|mov|m4v)$/i;
const clean = (value) => String(value ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function shownText(value) {
  if (!value || typeof value !== "object") return "";
  const fields = ["eyebrow", "headline", "title", "text", "value", "value2", "sub", "label", "note", "unit", "context", "name", "handle"];
  const parts = fields.map((key) => typeof value[key] === "string" ? value[key] : "");
  for (const key of ["items", "messages", "steps", "rungs", "pulses"]) if (Array.isArray(value[key])) parts.push(...value[key].map(shownText));
  for (const key of ["a", "b", "left", "right", "before", "after", "outcome"]) if (value[key] && typeof value[key] === "object") parts.push(shownText(value[key]));
  return clean(parts.filter(Boolean).join(" "));
}

function atInside(start, end, offset = 0.5) {
  const duration = Math.max(0, end - start);
  return Math.round((start + Math.min(offset, duration / 2)) * 1000) / 1000;
}

/** Every final on-screen text interval the rendered reel asks the gate to inspect. */
export function textSamples(plan = {}) {
  const duration = n(plan.video?.duration);
  const out = [];
  const add = (kind, index, text, start, end, at = null) => {
    text = clean(text); start = n(start); end = n(end, start);
    if (!text || end <= start) return;
    out.push({ id: `${kind}-${index}`, kind, text, start, end, duration: end - start, at: at == null ? atInside(start, end) : Math.round(n(at) * 1000) / 1000 });
  };
  if (plan.hook) add("hook", 0, plan.hook.text, plan.hook.start, n(plan.hook.start) + n(plan.hook.duration));
  for (let i = 0; i < (plan.captions || []).length; i++) {
    const item = plan.captions[i];
    add("caption", i, item.text || (item.words || []).map((word) => word.text).join(" "), item.start, item.end);
  }
  if (plan.premise) {
    const start = n(plan.premise.start), end = Math.min(duration || Infinity, start + n(plan.premise.duration, Math.max(0, duration - start)));
    const base = plan.premise.premise || plan.premise.text || plan.premise.title;
    add("premise", 0, base, start, end);
    const sections = plan.premise.sections || [];
    for (let i = 0; i < sections.length; i++) {
      const sectionStart = Math.max(start, n(sections[i].at, start));
      const sectionEnd = Math.min(end, i + 1 < sections.length ? n(sections[i + 1].at, end) : end);
      add("premise", i + 1, `${base || ""} ${sections[i].label || sections[i].text || ""}`, sectionStart, sectionEnd);
    }
  }
  for (let i = 0; i < (plan.graphics || []).length; i++) {
    const item = plan.graphics[i];
    const start = n(item.start), end = start + n(item.duration);
    const text = shownText(item);
    add("card", i, text, start, end);
    const offsets = [...(item.items || []), ...(item.rungs || [])].map((part) => n(part.at, NaN)).filter(Number.isFinite).map((at) => start + at);
    if (Number.isFinite(Number(item.outcome?.at))) offsets.push(start + Number(item.outcome.at));
    if (Number.isFinite(Number(item.pivotAt))) offsets.push(start + Number(item.pivotAt));
    const absolute = (item.pulses || []).map((part) => n(part.at, NaN)).filter(Number.isFinite);
    [...offsets, ...absolute].forEach((at, j) => add("card", `${i}-${j + 1}`, text, start, end, Math.min(end - 0.001, Math.max(start, at + 0.2))));
  }
  return out.filter((sample, index, all) => all.findIndex((other) => other.kind === sample.kind && other.text === sample.text && other.at === sample.at) === index);
}

/** Add ten percent of the face height above the forehead, leaving the other edges unchanged. */
export function expandFaceUp(box) {
  const extra = n(box?.h) * 0.1;
  const y = Math.max(0, n(box?.y) - extra);
  return { x: n(box?.x), y, w: n(box?.w), h: n(box?.h) + n(box?.y) - y };
}

function relevantLines(sample, ocr) {
  const wanted = new Set(textTokens(sample.text));
  return (ocr.lines || []).filter((line) => {
    const tokens = textTokens(line.text);
    return tokens.length && tokens.filter((token) => wanted.has(token)).length / tokens.length >= 0.5;
  });
}

/** Pure verdict logic; tests pass Apple Vision-shaped JSON stand-ins. */
export function evaluateTextSamples(samples = [], { edgePx = 8, minShow = 0.3, hookCoverage = 0.8 } = {}) {
  const problems = [];
  for (const sample of samples) {
    if (["caption", "hook"].includes(sample.kind) && sample.duration < minShow) {
      problems.push({ code: "text-flash", sample: sample.id, at: sample.at, message: `${sample.kind} text is on screen for ${sample.duration.toFixed(2)}s (minimum ${minShow.toFixed(2)}s)` });
    }
    const ocr = parseOcrJSON(sample.ocr);
    const lines = relevantLines(sample, ocr);
    for (const line of lines) {
      const box = line.box;
      const clipped = box.x * ocr.width <= edgePx || box.y * ocr.height <= edgePx || (1 - box.x - box.w) * ocr.width <= edgePx || (1 - box.y - box.h) * ocr.height <= edgePx;
      if (clipped) problems.push({ code: "text-edge", sample: sample.id, at: sample.at, message: `text line "${clean(line.text).slice(0, 80)}" is within ${edgePx}px of the frame edge` });
      if ((ocr.faces || []).some((face) => boxIntersection(box, expandFaceUp(face.box)) > 0)) problems.push({ code: "text-face", sample: sample.id, at: sample.at, message: `text line "${clean(line.text).slice(0, 80)}" overlaps a face expanded 10% above the forehead` });
    }
    if (sample.kind === "hook") {
      const match = matchExpectedText([{ role: "hook", text: sample.text, critical: true }], ocr);
      if (match.coverage < hookCoverage) problems.push({ code: "hook-ocr", sample: sample.id, at: sample.at, message: `OCR read ${(match.coverage * 100).toFixed(0)}% of the hook words (minimum ${(hookCoverage * 100).toFixed(0)}%)` });
    }
  }
  const unique = problems.filter((problem, index, all) => all.findIndex((other) => other.code === problem.code && other.sample === problem.sample && other.message === problem.message) === index);
  return { verdict: unique.length ? "hold" : "schedule", notes: unique.map((problem) => `${problem.code} at ${problem.at.toFixed(2)}s: ${problem.message}`), problems: unique, sampleCount: samples.length };
}

export function textcheckHold(reason) {
  const message = clean(reason) || "text check could not run";
  return { verdict: "hold", notes: [`textcheck-unavailable: ${message}`], problems: [{ code: "textcheck-unavailable", message }], sampleCount: 0 };
}

function workdirFor(target) {
  const resolved = path.resolve(target);
  let stat = null;
  try { stat = fs.statSync(resolved); } catch {}
  if (stat?.isDirectory()) return resolved;
  const parent = path.dirname(resolved);
  if (fs.existsSync(path.join(parent, "plan.json"))) return parent;
  if (path.basename(parent) === "renders" && fs.existsSync(path.join(path.dirname(parent), "plan.json"))) return path.dirname(parent);
  return VIDEO.test(resolved) ? parent : resolved;
}

function renderedVideo(workDir, target, plan, explicit = null) {
  if (explicit && fs.existsSync(path.resolve(explicit))) return path.resolve(explicit);
  const resolved = path.resolve(target);
  try { if (fs.statSync(resolved).isFile() && VIDEO.test(resolved)) return resolved; } catch {}
  const named = path.join(workDir, "renders", `${plan.name}.mp4`);
  if (fs.existsSync(named)) return named;
  const dir = path.join(workDir, "renders");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => VIDEO.test(file)).sort() : [];
  return files[0] ? path.join(dir, files[0]) : null;
}

async function extractFrame(video, at, output) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(at), "-i", video, "-frames:v", "1", output], { capture: true });
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error(`no frame at ${at}s`);
}

/** Run the fail-closed Vision gate and always write textcheck.json beside plan.json. */
export async function runTextcheck(target, options = {}) {
  const workDir = workdirFor(target);
  ensureDir(workDir);
  const outputFile = path.join(workDir, "textcheck.json");
  let result;
  let temp = null;
  try {
    const planFile = path.join(workDir, "plan.json");
    if (!fs.existsSync(planFile)) throw new Error(`no plan.json in ${workDir}`);
    const plan = readJSON(planFile);
    const video = renderedVideo(workDir, target, plan, options.video);
    if (!video) throw new Error("no rendered video was found");
    const samples = textSamples(plan);
    const binary = options.analyzeFrame ? null : await ocrBinary();
    if (!options.analyzeFrame && !binary) throw new Error("Apple Vision OCR and face detection are unavailable");
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-textcheck-"));
    const analyzed = [];
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const frame = path.join(temp, `${String(i + 1).padStart(4, "0")}.png`);
      await (options.extractFrame || extractFrame)(video, sample.at, frame, sample);
      const raw = options.analyzeFrame ? await options.analyzeFrame(frame, sample, i) : (await run(binary, [frame], { capture: true })).out;
      analyzed.push({ ...sample, ocr: raw });
    }
    result = { ...evaluateTextSamples(analyzed, options), video: path.resolve(video) };
  } catch (error) {
    result = textcheckHold(String(error.message).split("\n")[0]);
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
  writeJSON(outputFile, result);
  return result;
}
