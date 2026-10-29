import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { inlineIconSVG } from "./icons.mjs";
import { exactLineMatches } from "./premise.mjs";
import { esc } from "./text.mjs";
import { log, warn, readJSON, writeJSON, r3, sha1 } from "./util.mjs";

const clean = (value, max = 64) => String(value ?? "").replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
const frame = (seconds, fps = 30) => r3(Math.round(seconds * fps) / fps);
const indexed = (lines = []) => lines.map((line, i) => ({ ...line, i: Number.isInteger(line?.i) ? line.i : i }));

export function parseTimeLabelsReply(value) {
  const raw = typeof value === "string" ? firstJSON(value) : value;
  const labels = Array.isArray(raw?.labels) ? raw.labels : [];
  return labels.map((item) => ({ text: clean(item?.text), line: Number.isInteger(item?.line) ? item.line : parseInt(item?.line, 10) })).filter((item) => item.text);
}

/** Exact spoken time phrases only, never under the hook, with one label at least three seconds after the prior. */
export function planTimeLabels(raw, { lines = [], hook = null, duration = 0, minSpacing = 3, max = 6, hold = 4, fps = 30 } = {}) {
  const list = indexed(lines);
  const byLine = new Map(list.map((line) => [line.i, line]));
  const hookEnd = hook ? (+hook.start || 0) + (+hook.duration || 0) : 0;
  const dropped = [];
  const grounded = [];
  for (const item of parseTimeLabelsReply(raw)) {
    const matches = exactLineMatches(list, item.text).filter((line) => byLine.has(line));
    if (!matches.length) { dropped.push(`"${item.text}" is not said in the transcript`); continue; }
    const hinted = Number.isInteger(item.line) ? item.line : matches[0];
    const line = matches.sort((a, b) => Math.abs(a - hinted) - Math.abs(b - hinted) || a - b)[0];
    const at = frame(Number(byLine.get(line)?.start), fps);
    if (!(at >= hookEnd) || !(at < duration)) { dropped.push(`"${item.text}" lands during the hook or outside the reel`); continue; }
    grounded.push({ text: item.text, line, at });
  }
  grounded.sort((a, b) => a.at - b.at || a.line - b.line);
  const labels = [];
  for (const item of grounded) {
    if (labels.length && item.at - labels.at(-1).at < minSpacing) { dropped.push(`"${item.text}" is under ${minSpacing}s after the prior label`); continue; }
    if (labels.length >= max) { dropped.push(`"${item.text}" is over the ${max}-label cap`); continue; }
    labels.push(item);
  }
  return {
    labels: labels.map((item, i) => {
      const next = labels[i + 1]?.at ?? Infinity;
      return { ...item, duration: frame(Math.min(hold, next - item.at, duration - item.at), fps), icon: /\b(?:days?|weeks?|months?|years?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday)\b/i.test(item.text) ? "calendar.svg" : "clock.svg" };
    }).filter((item) => item.duration > 0),
    dropped,
  };
}

export function timeLabelsPrompt({ lines = [], hook = null } = {}) {
  return [
    "You are finding spoken time markers in a talking-head reel. Reply with JSON only and never use tools.",
    "Choose only phrases that turn a story into a chronology: at 5 AM, day one, three months later, by Friday, two years later. Copy each phrase exactly and consecutively from the transcript; do not paraphrase or infer a date.",
    "Use at most 6 labels, at least 3 seconds apart. Never choose one during the opening hook. If there is no time-story progression, return an empty labels array.",
    `Hook ends at ${hook ? r3((+hook.start || 0) + (+hook.duration || 0)) : 0}s.`,
    "Transcript lines:",
    ...indexed(lines).map((line) => `${line.i}: ${Number(line.start || 0).toFixed(2)}s ${line.text || ""}`),
    'Reply: {"labels":[{"text":"exact spoken time phrase","line":0}]}',
  ].join("\n");
}

/** One cached planner call. Any error leaves the old reel unchanged. */
export async function makeTimeLabels({ workDir, groups = [], hook = null, duration = 0, settings = {}, force = false } = {}) {
  if (settings.enabled !== true) return [];
  const lines = indexed(groups).map((line) => ({ i: line.i, start: line.start, text: line.text }));
  if (!lines.length) { log("time labels: no transcript lines, skipped"); return []; }
  if (!hasClaude()) { warn("time labels need the Claude Code CLI (claude) signed in; skipped"); return []; }
  const key = sha1(JSON.stringify({ lines: lines.map((line) => [line.start, line.text]), hook: hook ? [hook.start, hook.duration] : null }));
  const planPath = path.join(workDir, "time-labels.json");
  let raw = null;
  if (!force && fs.existsSync(planPath)) {
    try { const saved = readJSON(planPath); if (saved.schema === 1 && saved.key === key) raw = saved.raw; } catch {}
  }
  try {
    if (raw === null) {
      log("time labels: Claude is checking for a chronology…");
      raw = { labels: parseTimeLabelsReply(await claudeText(timeLabelsPrompt({ lines, hook }), { timeoutMs: 120000 })) };
      writeJSON(planPath, { schema: 1, key, raw });
    }
    const result = planTimeLabels(raw, { lines, hook, duration });
    for (const reason of result.dropped) log(`time labels: dropped ${reason}`);
    log(`time labels: ${result.labels.length}${result.labels.length ? ` (${result.labels.map((item) => `"${item.text}"`).join(", ")})` : ", none found"}`);
    return result.labels;
  } catch (error) {
    warn(`time labels: ${String(error.message).split("\n")[0]}; rendering without them`);
    return [];
  }
}

/** Fixed top-left chip, directly under the premise when one exists. */
export function timeLabelGeometry({ brand, W = 1080, H = 1920, premise = null, captionTop = H, head = null } = {}) {
  if (!brand) return { skip: true, reason: "brand tokens are unavailable" };
  const fontSize = Math.max(40, Math.min(44, Number(brand.typeScale?.md) || 40));
  const padX = Number(brand.spacing?.md) || 0;
  const padY = Number(brand.spacing?.sm) || 0;
  const y = premise?.box ? premise.box.y + premise.box.h + (Number(brand.spacing?.sm) || 0) : 200;
  const box = { x: 76, y, w: Math.min(420, W - 152), h: Math.ceil(fontSize * (Number(brand.type?.body?.lineHeight) || 1.2) + 2 * padY) };
  if (box.y + box.h > captionTop) return { skip: true, reason: "the time label would overlap the captions" };
  if (head) {
    const face = { x: (head.cx - head.w / 2) * W, y: (head.cy - head.h / 2) * H, w: head.w * W, h: head.h * H };
    if (box.x < face.x + face.w && box.x + box.w > face.x && box.y < face.y + face.h && box.y + box.h > face.y) return { skip: true, reason: "the top-left time label would overlap the head" };
  }
  return { box, fontSize, padX, padY, radius: "var(--brand-radius-md)", enter: frame(Math.max(1 / 30, (Number(brand.motion?.enterMs) || 0) / 1000)), enterEase: brand.motion?.enterEase || "none", exitEase: brand.motion?.exitEase || "none" };
}

export function timeLabelHTML(item, i) {
  return `<div id="time-label-${i}" class="time-label clip" data-start="${item.at}" data-duration="${item.duration}" data-track-index="3" data-layout-allow-overflow><span class="time-label-icon">${inlineIconSVG(item.icon)}</span><span>${esc(item.text)}</span></div>`;
}

export const TIME_LABELS_JS = `
        PLAN.timeLabels.forEach((item, i) => {
          const el = document.getElementById("time-label-" + i);
          const f = 1 / (PLAN.fps || 30);
          tl.fromTo(el, { opacity: 0, y: item.slide }, { opacity: 1, y: 0, duration: item.enter, ease: item.enterEase, immediateRender: false }, item.at);
          tl.to(el, { opacity: 0, duration: 5 * f, ease: item.exitEase }, item.at + item.duration - 5 * f);
        });`;
