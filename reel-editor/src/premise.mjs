import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { log, warn, readJSON, writeJSON, r3, sha1 } from "./util.mjs";

const FILLERS = new Set(["ah", "er", "erm", "hmm", "mhm", "mm", "uh", "uhh", "uhm", "um", "umm"]);
const tokenList = (text) => String(text || "").toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || [];
const clean = (text) => String(text || "").replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim();
const frame = (seconds, fps = 30) => r3(Math.round(seconds * fps) / fps);

function sourceOwns(text, source) {
  const have = new Map();
  for (const word of tokenList(source)) have.set(word, (have.get(word) || 0) + 1);
  for (const word of tokenList(text)) {
    const left = have.get(word) || 0;
    if (!left) return false;
    have.set(word, left - 1);
  }
  return true;
}

function indexedLines(lines = []) {
  return lines.map((line, i) => ({ ...line, i: Number.isInteger(line?.i) ? line.i : i }));
}

/** Every transcript line where an exact spoken phrase begins. Filler words in the transcript may be omitted. */
export function exactLineMatches(lines, phrase) {
  const needle = tokenList(phrase);
  if (!needle.length) return [];
  const words = [];
  for (const line of indexedLines(lines)) {
    for (const word of tokenList(line.text)) words.push({ word, line: line.i });
  }
  const out = [];
  for (let i = 0; i < words.length; i++) {
    let at = i;
    let first = null;
    let matched = true;
    for (const wanted of needle) {
      while (at < words.length && FILLERS.has(words[at].word)) at++;
      if (words[at]?.word !== wanted) { matched = false; break; }
      if (!first) first = words[at];
      at++;
    }
    if (matched) out.push(first.line);
  }
  return [...new Set(out)];
}

/** Parse the small planner reply without trusting prose, code fences, field types, or a partial section list. */
export function parsePremiseReply(text) {
  const value = typeof text === "string" ? firstJSON(text) : text;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const premise = clean(value.premise);
  const sections = Array.isArray(value.sections)
    ? value.sections.map((section) => ({ label: clean(section?.label), line: Number.isInteger(section?.line) ? section.line : parseInt(section?.line, 10) }))
    : [];
  return { premise, sections };
}

/**
 * Truth-check and ground one reply. Generated copy is strict; a CLI-forced premise stays on screen and reports
 * its truth/length problem as a warning. Section labels always need an exact spoken landing point.
 */
export function planPremise(raw, { lines = [], hook = "", duration = 0, forced = false, minSpacing = 4, maxSections = 6, fps = 30 } = {}) {
  const dropped = [];
  const warnings = [];
  let parsed;
  try { parsed = parsePremiseReply(raw); }
  catch (error) { return { plan: null, dropped: [`reply could not be parsed (${error.message})`], warnings }; }
  if (!parsed?.premise) return { plan: null, dropped: ["reply contained no premise"], warnings };

  const list = indexedLines(lines);
  const transcript = list.map((line) => line.text || "").join(" ");
  const hookText = typeof hook === "object" ? hook?.text || "" : hook;
  const source = `${transcript} ${hookText}`;
  const premiseWords = tokenList(parsed.premise).length;
  if (premiseWords < 2 || premiseWords > 6) {
    const why = `premise "${parsed.premise}" has ${premiseWords} words (need 2-6)`;
    if (forced) warnings.push(why); else return { plan: null, dropped: [why], warnings };
  }
  if (!sourceOwns(parsed.premise, source)) {
    const why = `premise "${parsed.premise}" uses words outside the transcript or hook`;
    if (forced) warnings.push(why); else return { plan: null, dropped: [why], warnings };
  }

  const byLine = new Map(list.map((line) => [line.i, line]));
  const grounded = [];
  for (const section of parsed.sections) {
    const n = tokenList(section.label).length;
    if (n < 1 || n > 4) { dropped.push(`section "${section.label || "(empty)"}" has ${n} words (need 1-4)`); continue; }
    if (!sourceOwns(section.label, source)) { dropped.push(`section "${section.label}" uses words outside the transcript or hook`); continue; }
    const matches = exactLineMatches(list, section.label).filter((line) => byLine.has(line));
    if (!matches.length) { dropped.push(`section "${section.label}" is not said in the transcript`); continue; }
    const hinted = Number.isInteger(section.line) ? section.line : matches[0];
    const line = matches.sort((a, b) => Math.abs(a - hinted) - Math.abs(b - hinted) || a - b)[0];
    const at = frame(Number(byLine.get(line)?.start), fps);
    if (!Number.isFinite(at)) { dropped.push(`section "${section.label}" has no usable line time`); continue; }
    grounded.push({ label: section.label, line, at });
  }

  grounded.sort((a, b) => a.at - b.at || a.line - b.line);
  const sections = [];
  for (const section of grounded) {
    if (sections.length && section.at - sections.at(-1).at < minSpacing) {
      dropped.push(`section "${section.label}" is ${r3(section.at - sections.at(-1).at)}s after the prior section (need ${minSpacing}s)`);
      continue;
    }
    if (sections.length >= maxSections) { dropped.push(`section "${section.label}" is over the ${maxSections}-section cap`); continue; }
    sections.push(section);
  }

  const start = frame(hook && typeof hook === "object" ? (+hook.start || 0) + (+hook.duration || 0) : 0.5, fps);
  if (!(duration > start)) return { plan: null, dropped: [...dropped, "the hook leaves no time for a premise strip"], warnings };
  return { plan: { premise: parsed.premise, sections, start, duration: frame(duration - start, fps), forced: !!forced }, dropped, warnings };
}

export function premisePrompt({ lines = [], hook = "" } = {}) {
  return [
    "You are planning one compact persistent premise strip for a talking-head reel. Reply with JSON only and never use tools.",
    "Return a premise only when the whole reel has a clear running premise, a numbered or stepwise structure, or distinct sections. Otherwise return {\"premise\":null,\"sections\":[]}.",
    "premise is 2-6 words. Every word must be copied from the transcript or the supplied hook; you may drop filler words but may not paraphrase.",
    "sections is optional and has at most 6 items. Each label is 1-4 consecutive spoken words and line is the transcript line where those words begin. Use sections only for real section changes, at least 4 seconds apart.",
    "Do not invent, summarize, add credentials, numbers, names, quotes, or calls to action.",
    `Hook: ${hook || "(none)"}`,
    "Transcript lines:",
    ...indexedLines(lines).map((line) => `${line.i}: ${Number(line.start || 0).toFixed(2)}s ${line.text || ""}`),
    'Reply: {"premise":"2-6 copied words","sections":[{"label":"1-4 copied words","line":0}]}',
  ].join("\n");
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Fade windows for cards and slams that occupy the strip. Windows are merged and quantized to whole frames. */
export function premiseDuckSchedule({ box, cards = [], slams = [], start = 0, end = Infinity, fps = 30 } = {}) {
  const events = [];
  for (const card of cards) {
    if (card?.type === "progress") continue;
    const b = card?.box || card?.bounds;
    if (box && b && [b.x, b.y, b.w ?? b.width, b.h ?? b.height].every(Number.isFinite)) {
      const cardBox = { x: b.x, y: b.y, w: b.w ?? b.width, h: b.h ?? b.height };
      if (!rectsOverlap(box, cardBox)) continue;
    }
    events.push({ start: +card.start || 0, end: (+card.start || 0) + (+card.duration || 0) });
  }
  for (const slam of slams) events.push({ start: +slam.t || 0, end: Number.isFinite(+slam.end) ? +slam.end : (+slam.t || 0) + (+slam.duration || 0) });
  const clipped = events
    .map((event) => ({ start: frame(Math.max(start, event.start), fps), end: frame(Math.min(end, event.end), fps) }))
    .filter((event) => event.end > event.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const event of clipped) {
    const prior = merged.at(-1);
    if (prior && event.start <= prior.end) prior.end = Math.max(prior.end, event.end);
    else merged.push({ ...event });
  }
  const fade = 6 / fps;
  return merged.map((event) => ({
    outAt: frame(Math.max(start, event.start - fade), fps),
    hiddenAt: event.start,
    inAt: event.end,
    shownAt: frame(Math.min(end, event.end + fade), fps),
  }));
}

/** Brand-token geometry after the existing face measurement has supplied the highest head top. */
export function premiseGeometry({ brand, W = 1080, H = 1920, sections = [], headTop = null, captionTop = H } = {}) {
  if (!brand) return { skip: true, reason: "brand tokens are unavailable" };
  const spacing = brand.spacing || {};
  const typeScale = brand.typeScale || {};
  const fontSize = Math.max(48, Math.min(52, Number(typeScale.lg) || Number(typeScale.md) || 48));
  const sectionFontSize = Math.max(48, Math.min(52, Number(typeScale.md) || fontSize));
  const gap = sections.length ? (Number(spacing.xs) || 0) / 2 : 0;
  const pad = sections.length ? (Number(spacing.xs) || 0) / 2 : Number(spacing.md) || 0;
  const displayLine = Number(brand.type?.display?.lineHeight) || 1;
  const bodyLine = Number(brand.type?.body?.lineHeight) || 1;
  const wantedH = Math.ceil(fontSize * displayLine + 2 * pad + (sections.length ? gap + sectionFontSize * bodyLine : 0));
  const h = Math.min(130, wantedH);
  const box = { x: 76, y: 200, w: Math.min(864, W - 152), h };
  const headLimit = Number.isFinite(headTop) ? Math.floor(headTop * H - (Number(spacing.sm) || 0)) : Infinity;
  if (box.y + box.h > headLimit) return { skip: true, reason: `the top band would overlap the head at ${Math.round(headTop * H)}px` };
  if (box.y + box.h > captionTop) return { skip: true, reason: "the top band would overlap the captions" };
  const fps = 30;
  return {
    box,
    pad,
    gap,
    fontSize,
    sectionFontSize,
    shape: brand.signature?.kind === "title-plate" ? "plate" : "pill",
    rule: Math.max(0, Number(brand.signature?.thickness) || 0),
    ruleColor: Object.hasOwn(brand.colors || {}, brand.signature?.colorRole) ? brand.signature.colorRole : "accent",
    enter: frame(Math.max(1 / fps, (Number(brand.motion?.enterMs) || 0) / 1000), fps),
    enterEase: brand.motion?.enterEase || "none",
    exitEase: brand.motion?.exitEase || "none",
    slide: Number(spacing.sm) || 0,
  };
}

function reportValidation(result, { forced = false } = {}) {
  for (const reason of result.dropped) log(`premise: dropped ${reason}`);
  for (const reason of result.warnings) (forced ? warn : log)(`premise: ${reason}`);
}

/** One small, cached Claude call. Any failure returns null so the old composition remains intact. */
export async function makePremise({ workDir, groups = [], hook = null, duration = 0, settings = {}, force = false } = {}) {
  const mode = ["auto", "on", "off"].includes(settings.mode) ? settings.mode : "off";
  if (mode === "off") return null;
  const lines = indexedLines(groups).map((line) => ({ i: line.i, start: line.start, text: line.text }));
  const forcedText = clean(settings.text);
  const context = { lines, hook, duration, forced: !!forcedText };
  if (hook && (+hook.start || 0) + (+hook.duration || 0) >= duration) { log("premise: the hook stays to the end, skipped"); return null; }
  if (forcedText) {
    const result = planPremise({ premise: forcedText, sections: [] }, context);
    reportValidation(result, { forced: true });
    if (result.plan) log(`premise: forced "${result.plan.premise}"`);
    return result.plan;
  }
  if (!lines.length) { log("premise: no transcript lines, skipped"); return null; }
  if (!hasClaude()) { warn("premise needs the Claude Code CLI (claude) signed in; skipped"); return null; }

  const key = sha1(JSON.stringify({ lines: lines.map((line) => [line.start, line.text]), hook: hook?.text || "" }));
  const planPath = path.join(workDir, "premise.json");
  let raw = null;
  if (!force && fs.existsSync(planPath)) {
    try {
      const saved = readJSON(planPath);
      if (saved.schema === 1 && saved.key === key) raw = saved.raw;
    } catch {}
  }
  try {
    if (raw === null) {
      log("premise: Claude is checking for a running premise…");
      raw = parsePremiseReply(await claudeText(premisePrompt({ lines, hook: hook?.text || "" }), { timeoutMs: 120000 }));
      writeJSON(planPath, { schema: 1, key, raw });
    }
    const result = planPremise(raw, context);
    reportValidation(result);
    if (!result.plan) { log("premise: no clear running premise, skipped"); return null; }
    log(`premise: "${result.plan.premise}"${result.plan.sections.length ? ` with ${result.plan.sections.length} section change${result.plan.sections.length === 1 ? "" : "s"}` : ""}`);
    return result.plan;
  } catch (error) {
    warn(`premise: ${String(error.message).split("\n")[0]}; rendering without it`);
    return null;
  }
}
