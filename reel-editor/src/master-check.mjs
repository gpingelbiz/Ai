import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readRecent, repeatedMotif, uniqueScenes } from "./broll.mjs";
import { fillerCard } from "./gate.mjs";
import { detectFaces } from "./placement.mjs";
import { runPreflight } from "./preflight.mjs";
import { attachProWordMarks, findProCollisions, proCaptionBox, proHookBox, proSize, PRO_MIN_CARDS } from "./pro.mjs";
import { cleanEdges, spokenWords } from "./reel-edges.mjs";
import { readJSON, run, writeJSON } from "./util.mjs";

const at = (time) => `${Number.isFinite(time) ? time.toFixed(2) : "?"}s`;
const rule = (id, severity, problems, detail) => ({ id, ok: !problems.length, severity, detail: problems.join("\n") || detail });
const endOf = (item) => item.end ?? ((item.start ?? 0) + (item.duration ?? 0));
const visible = (item, time) => (item.start ?? 0) <= time && time < endOf(item);
const firstLine = (error) => String(error.message || error).split("\n")[0];
const optionalJSON = (file) => { try { return readJSON(file); } catch { return null; } };
export const masterIsPro = (plan) => /^(?:pingel-)?pro$/i.test(plan.preset || "") || /^(?:pingel-)?pro$/i.test(plan.style?.name || plan.style || "") || plan.style?.pro?.enabled === true;
const cardsOf = (plan) => (plan.proGraphics || []).filter((card) => card.type !== "wordMark");
const isFull = (card) => card.fullscreen || card.place?.slot === "full";

function overlapArea(a, b) {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

function captionBox(group, style, canvas) {
  if (group.place?.h && group.place?.w) return group.place;
  const { H } = canvas;
  const y = group.y ?? (style?.pro || style?.position == null ? undefined : style.position * H);
  const lines = group.lines || Array(1 + (group.words || []).filter((w) => w.br).length);
  return proCaptionBox({ ...group, y, lines }, canvas);
}

async function faceRules(file, plan, duration, offset, detect) {
  const canvas = { W: plan.canvas?.width || 1080, H: plan.canvas?.height || 1920 };
  const captions = plan.bold?.groups || (plan.style?.captions?.enabled === false ? [] : plan.captions || []);
  const capItems = captions.map((group, i) => ({ ...group, box: captionBox(group, plan.style?.captions, canvas), label: `Caption ${i + 1}` }));
  const cardItems = masterIsPro(plan) ? cardsOf(plan).flatMap((card, i) => {
    if (!card.place) return [];
    const size = proSize(card);
    const { x, y, scale = 1, w = size?.w * scale, h = size?.h * scale } = card.place;
    return w > 0 && h > 0 ? [{ ...card, box: { x, y, w, h }, label: `Card ${card.id || i + 1}` }] : [];
  }) : [];
  // The render hides the title at the end of the hook hold. The same box is free for cards after that time.
  if (masterIsPro(plan) && plan.hook) cardItems.push({ ...plan.hook, box: proHookBox(plan.hook, canvas), label: "Hook" });
  const times = Array.from({ length: Math.ceil(duration * 2) }, (_, i) => i / 2);
  let frames = new Map();
  if (capItems.length || cardItems.length) {
    try {
      const result = await detect(file, times, { landmarks: true });
      frames = new Map((result?.frames || []).map((frame) => [frame.t ?? frame.time, frame.faces || []]));
    } catch { /* Missing samples are reported by both applicable rules below. */ }
  }
  const problems = (items, threshold) => {
    const misses = [], hits = [];
    for (const time of times) {
      const active = items.filter((item) => visible(item, time + offset));
      if (!active.length) continue;
      if (!frames.has(time)) { misses.push(at(time)); continue; }
      const faces = frames.get(time).map((face) => {
        // Older installed Vision helpers supply a face rectangle with no eye landmarks.
        const top = Math.max(face.y, Math.min(face.y + face.h, face.eyesY ?? face.y + 0.3 * face.h));
        return { x: face.x * canvas.W, y: top * canvas.H, w: face.w * canvas.W, h: (face.y + face.h - top) * canvas.H };
      });
      for (const { box, label } of active) {
        const share = Math.max(0, ...faces.map((face) => overlapArea(box, face) / (box.w * box.h)));
        if (share > threshold) hits.push(`${label} overlaps a face at ${at(time)} (${(share * 100).toFixed(1)}% of its box).`);
      }
    }
    if (misses.length) hits.push(`Face detection was unavailable at ${misses.join(", ")}.`);
    return hits;
  };
  return [
    rule("captions-off-face", "block", problems(capItems, 0.04), "No sampled face overlaps more than 4% of a caption plate."),
    rule("cards-off-face", "block", problems(cardItems, 0), "No sampled face overlaps a pro card or the hook."),
  ];
}

export function masterPlanningRules(plan, duration = plan.video?.duration || 0) {
  const pro = masterIsPro(plan);
  const cards = cardsOf(plan);
  const needsCards = pro && duration >= 15;
  const needsBroll = pro && plan.style?.broll?.enabled && duration >= 20;
  const count = plan.broll?.length || 0;
  const full = cards.filter(isFull);
  return [
    rule("card-floor", "block", needsCards && cards.length < PRO_MIN_CARDS ? [`Found ${cards.length} teaching cards. A pro reel of 15 seconds or more needs ${PRO_MIN_CARDS}.`] : [], needsCards ? `Found ${cards.length} teaching cards.` : "Card minimum does not apply."),
    rule("broll-present", "block", needsBroll && !count ? ["This pro reel is at least 20 seconds with B-roll enabled. It needs a B-roll insert."] : [], needsBroll ? `Found ${count} B-roll inserts.` : "B-roll minimum does not apply."),
    rule("full-screen-max", "block", pro && full.length > 1 ? [`${full.length} full-screen cards at ${full.map((card) => at(card.start)).join(", ")}. Keep at most one.`] : [], pro ? `Found ${full.length} full-screen cards.` : "Full-screen card limit does not apply."),
  ];
}

const COPY = new Set(["text", "title", "headline", "eyebrow", "value", "value2", "sub", "label", "note", "tag", "unit", "context", "name", "handle", "contact", "quote", "remark", "lines", "body", "question", "answer", "prefix", "suffix"]);
function mapCopy(value, visit, field) {
  if (Array.isArray(value)) {
    if (field === "lines" && value.length && value.every((item) => typeof item === "string")) {
      const joined = value.join(" ");
      if (visit(joined) === joined) return value;
      const rows = value.map((line) => line.trim().split(/\s+/));
      const { words, lines } = tidyCaption({ words: rows.flat().map((text) => ({ text })), lines: rows.map((row) => row.length) });
      let offset = 0;
      return lines.map((length) => {
        const line = wordText(words.slice(offset, offset + length));
        offset += length;
        return line;
      });
    }
    return value.map((item) => mapCopy(item, visit, field));
  }
  if (typeof value === "string" && COPY.has(field)) return visit(value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapCopy(item, visit, key)]));
}

const cardCopy = (card) => {
  const copy = new Set();
  mapCopy(card, (text) => { if (text.trim()) copy.add(text); return text; });
  return [...copy];
};

const PUNCT_SPACE = /[^\S\r\n]+(?=[,.!?;:])/g;
const HYPHEN_SPACE = /(\p{L})(?:\s+-\s*|-\s+)(?=\p{L})/gu;
const DOUBLED_WORD = /(?<![\p{L}\p{N}’'])([\p{L}\p{N}’']+)(?:\s*,?\s+\1(?![\p{L}\p{N}’']))+/giu;
const tidyText = (text) => text.replace(PUNCT_SPACE, "").replace(HYPHEN_SPACE, "$1-").replace(DOUBLED_WORD, "$1");
const wordText = (words) => (words || []).map((word) => word.text).filter(Boolean).join(" ");
const displayCopy = (item) => typeof item === "string" ? [item] : [...new Set([item.text, wordText(item.words)].filter(Boolean))];

function tidyCaption(group) {
  if (!group.words?.length) return { ...group, text: tidyText(group.text || "") };
  const entries = [];
  let index = 0;
  for (const [row, length] of (group.lines || [group.words.length]).entries()) {
    for (const word of group.words.slice(index, index + length)) entries.push({ ...word, row, text: tidyText(word.text) });
    index += length;
  }
  const cleaned = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const previous = cleaned.at(-1);
    const following = entries[i + 1];
    if (entry.text === "-" && previous && following && /\p{L}$/u.test(previous.text) && /^\p{L}/u.test(following.text)) {
      previous.text += `-${following.text}`;
      previous.end = following.end ?? previous.end;
      i++;
      continue;
    }
    const pair = previous && `${previous.text} ${entry.text}`;
    const joined = pair && tidyText(pair);
    if (pair && pair !== joined && !/\s/.test(joined)) {
      previous.text = joined;
      previous.end = entry.end ?? previous.end;
    } else if (entry.text) cleaned.push(entry);
  }
  const countByRow = new Map();
  const words = cleaned.map(({ row, ...word }) => {
    countByRow.set(row, (countByRow.get(row) || 0) + 1);
    return word;
  });
  const lines = [...countByRow.values()];
  const text = tidyText(group.text ?? wordText(words));
  return { ...group, words, text, ...(group.lines ? { lines } : {}) };
}

function textPlan(plan, fix = false) {
  const problems = [];
  let next = plan;
  for (const key of ["graphics", "proGraphics", "glowOverlays", "glowScenes"]) {
    if (!plan[key]?.length) continue;
    const cards = plan[key].flatMap((card, i) => {
      if (card.type === "wordMark") return [card];
      const copy = cardCopy(card);
      const label = `Card ${card.id || i + 1} at ${at(card.start)}`;
      const filler = fillerCard({ text: [...new Set(copy.map(tidyText))].join(" ") });
      for (const text of copy.filter((text) => tidyText(text) !== text)) problems.push(`${label} has transcript artifacts in "${text}".`);
      if (filler) problems.push(`${label} contains only filler or a repeated word ("${copy.join(" ")}").`);
      return fix ? filler ? [] : [mapCopy(card, tidyText)] : [card];
    });
    if (fix) next = { ...next, [key]: cards };
  }
  const captions = (plan.captions || []).map((group, i) => {
    for (const text of displayCopy(group).filter((text) => tidyText(text) !== text)) problems.push(`Caption ${i + 1} at ${at(group.start)} has transcript artifacts in "${text}".`);
    return fix ? tidyCaption(group) : group;
  });
  if (fix && plan.captions) next = { ...next, captions, ...(next.proGraphics ? { proGraphics: attachProWordMarks(next.proGraphics, captions) } : {}) };
  const boldWords = plan.bold?.displayWords || plan.words || [];
  const displayWords = [...boldWords];
  for (const group of plan.bold?.groups || []) {
    const words = boldWords.slice(group.from, group.to + 1);
    const text = wordText(words);
    if (tidyText(text) === text) continue;
    problems.push(`Caption at ${at(group.start)} has transcript artifacts in "${text}".`);
    if (fix) {
      const cleaned = tidyCaption({ words: words.map((word, i) => ({ ...word, index: group.from + i })) }).words;
      for (let i = group.from; i <= group.to; i++) displayWords[i] = { ...displayWords[i], text: "" };
      for (const word of cleaned) displayWords[word.index] = { ...displayWords[word.index], text: word.text };
    }
  }
  if (fix && plan.bold?.groups?.length) next = { ...next, bold: { ...next.bold, displayWords } };
  return { plan: next, rule: rule("card-text-clean", "block", problems, "Card and caption text is clean.") };
}

const BANNED = [
  /\bGhost\s+P\s*(?:&|and)?\s*L\b|\bGhost\s+PnL\b/gi,
  /\bwife\b/gi,
  /\b(?:comment|dm|type|text|send|reply|message|write|drop|keyword)\s*:?\s+(?:me\s+)?(?:with\s+)?(?:the\s+(?:word|keyword)\s+)?["'“‘*]*ghost\b/gi,
  /^\s*["'“‘*]*GHOST["'”’*!.,?\s]*$/g,
];
const PRIVATE = [
  /\b(?:kids?|children|sons?|daughters?|wife|husband|spouse|parents?|mom|dad|siblings?)\b|\bmy (?:brothers?|sisters?)\b/gi,
  /\b(?:flights?|fly\s+out|flew\s+out|airports?)\b/gi,
  /\b(?:fly|flew)\s+to\s+(?:[\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,3}|[\p{Ll}][\p{L}'’-]*)/gu,
  /\b(?:Thanksgiving|Christmas|New Year(?:'s|’s)?(?: Day| Eve)?|Easter|Halloween|tonight|tomorrow|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+morning)?\s+this morning|this morning\s*,?\s*(?:on\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/gi,
  /\b(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?)\b/gi,
];

function matches(text, patterns) {
  const found = patterns.flatMap((pattern) => [...String(text || "").matchAll(pattern)]).sort((a, b) => a.index - b.index || b[0].length - a[0].length);
  return found.filter((match, i) => !found.slice(0, i).some((other) => match.index + match[0].length <= other.index + other[0].length));
}

function timedMatches(words, patterns) {
  let text = "";
  const positions = [];
  for (const word of words) {
    positions.push({ index: text.length, time: word.start });
    text += `${word.text} `;
  }
  return matches(text, patterns).map((match) => `"${match[0].trim()}" at ${at(positions.findLast((p) => p.index <= match.index)?.time)}`);
}

function bannedRule(plan, workDir, speech, captionFile) {
  const hits = timedMatches(speech, BANNED).map((hit) => `Spoken transcript contains ${hit}.`);
  const add = (label, texts) => {
    for (const hit of new Set(texts.flatMap((text) => matches(text, BANNED).map((match) => match[0].trim())))) hits.push(`${label} contains "${hit}".`);
  };
  const captions = plan.captions || [];
  captions.forEach((group, i) => add(`Caption ${i + 1} at ${at(group.start)}`, displayCopy(group)));
  for (let i = 1; i < captions.length; i++) {
    const a = captions[i - 1], b = captions[i];
    const left = displayCopy(a)[0] || "", right = displayCopy(b)[0] || "";
    const splitHits = matches(`${left} ${right}`, BANNED).filter((m) => m.index < left.length && m.index + m[0].length > left.length + 1);
    for (const hit of splitHits) hits.push(`Captions ${i} and ${i + 1} at ${at(a.start)}–${at(b.start)} contain "${hit[0]}".`);
  }
  add("Hook", [...displayCopy(plan.hook || {}), plan.bold?.headline?.text]);
  add("CTA", [...displayCopy(plan.cta || {}), plan.cta?.keyword]);
  for (const card of [...(plan.graphics || []), ...cardsOf(plan), ...(plan.glowOverlays || []), ...(plan.glowScenes || [])]) add(`Card at ${at(card.start)}`, cardCopy(card));
  const caption = optionalJSON(path.join(workDir, "caption.json"));
  if (caption) add("Post caption (caption.json)", typeof caption === "string" ? [caption] : [caption.caption, caption.text, caption.postCaption, caption.keyword, ...(caption.hashtags || [])]);
  const file = captionFile || path.join(workDir, "caption.txt");
  if (fs.existsSync(file)) add("Post caption (caption.txt)", [fs.readFileSync(file, "utf8")]);
  return rule("banned-words", "block", hits, "No banned words in the transcript, captions, cards, hook, CTA or post caption.");
}

async function measureFlash(file) {
  const filter = "trim=end_frame=61,setpts=PTS-STARTPTS,format=yuv420p,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-";
  const { out } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-an", "-vf", filter, "-frames:v", "61", "-f", "null", "-"], { capture: true });
  const frames = [...out.matchAll(/pts_time:\s*(-?[\d.e+-]+)[^\n]*\n[^\n]*YAVG=([\d.]+)/gi)].map((m) => ({ time: +m[1], luma: +m[2] }));
  const reference = frames.slice(6).map((f) => f.luma).sort((a, b) => a - b);
  if (!reference.length) throw new Error("fewer than seven video frames for the opening luma comparison");
  const median = (reference[Math.floor((reference.length - 1) / 2)] + reference[Math.floor(reference.length / 2)]) / 2;
  const spikes = frames.slice(0, 6).flatMap((frame, i) => Math.abs(frame.luma - median) > 35 ? [{ ...frame, i }] : []);
  const last = spikes.at(-1)?.i;
  const trim = last == null ? null : frames.find((frame, i) => i > last && Math.abs(frame.luma - median) <= 35)?.time;
  return { spikes, median, trim };
}

async function trimOpening(file, seconds) {
  const temp = path.join(path.dirname(file), `.master-trim-${randomUUID()}.mp4`);
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-ss", String(seconds), "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", temp], { capture: true });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function preflightRules(plan, result, gate) {
  const items = result.items || [];
  const messages = (...codes) => items.filter((item) => codes.includes(item.code)).map((item) => item.message);
  const pro = masterIsPro(plan);
  const clashes = pro ? findProCollisions({
    cards: cardsOf(plan).map((card) => ({ ...card, end: endOf(card), fullscreen: isFull(card) })),
    captions: plan.captions || [], hook: plan.hook,
    W: plan.canvas?.width, H: plan.canvas?.height,
  }) : [];
  const label = (kind, id) => kind === "caption" ? `caption ${Number(id.slice(4)) + 1}` : kind === "card" ? `card ${id}` : "the hook";
  const collisions = clashes.length
    ? clashes.map(({ a, b, kinds, at: time }) => `Overlap at ${at(time)} between ${label(kinds[0], a)} and ${label(kinds[1], b)}.`)
    : messages("overlap");
  collisions.push(...(gate?.problems || []).filter((p) => p.code === "text-overlap").map((p) => p.message));
  return [
    rule("loudness", "warn", messages("loudness", "peak", "range"), "Preflight found no loudness issues."),
    rule("fast-captions", "warn", messages("caption-speed"), "Preflight found no fast captions."),
    rule("black-open", "block", result.error ? [result.error] : messages("black-open"), "Preflight found no black opening."),
    rule("overlaps", "block", collisions, "Preflight found no overlapping cards, captions or hook."),
  ];
}

export const failedMasterRules = (result) => result.rules.filter((r) => !r.ok && r.severity === "block");
function verdict(rules) {
  return { status: rules.some((r) => !r.ok && r.severity === "block") ? "fail" : rules.some((r) => r.fixed) ? "fixed" : "pass", rules };
}

export function masterCheckText(result) {
  return [`Master check ${result.status.toUpperCase()}`, "", ...result.rules.flatMap((r) => [
    `${r.ok ? r.fixed ? "FIXED" : "OK" : r.severity === "block" ? "FAIL" : "WARN"}  ${r.id}`,
    ...r.detail.split("\n").map((line) => `  ${line}`),
  ]), ""].join("\n");
}

function isLongClip(workDir, plan) {
  if (plan.clipSource) return true;
  if (path.basename(workDir) !== "edit" || !/^clip-\d+$/.test(path.basename(path.dirname(workDir)))) return false;
  const parent = path.resolve(workDir, "..", "..");
  return (optionalJSON(path.join(parent, "clips.json"))?.clips || []).some((clip) => (
    clip.workDir && path.resolve(parent, clip.workDir) === workDir
    || clip.output && path.resolve(parent, clip.output).startsWith(path.join(workDir, "renders") + path.sep)
  ));
}

function writeReport(workDir, result) {
  fs.writeFileSync(path.join(workDir, "master-check.txt"), masterCheckText(result));
  writeJSON(path.join(workDir, "master-check.json"), result);
  return result;
}

/** The watcher creates post copy after rendering. Recheck it against the same rules without changing the video. */
export function refreshMasterCaption(workDir, captionFile) {
  const report = optionalJSON(path.join(workDir, "master-check.json"));
  if (!report) return null;
  const plan = readJSON(path.join(workDir, "plan.json"));
  const speech = spokenWords(plan.words).filter((w) => w.end > (plan.masterTrim || 0));
  return writeReport(workDir, verdict(report.rules.map((r) => r.id === "banned-words" ? bannedRule(plan, workDir, speech, captionFile) : r)));
}

/** Check a saved render. Rebuild and replan are supplied by the pipeline when repairs are requested. */
export async function runMasterCheck(workDir, { video, fix = false, preflight, rebuild, replan, onPreflight, useGate = true, deps = {} } = {}) {
  workDir = path.resolve(workDir);
  const planFile = path.join(workDir, "plan.json");
  let plan = readJSON(planFile);
  const file = path.resolve(video || plan.masterOutput || path.join(workDir, "renders", `${plan.name}.mp4`));
  const fixes = new Map(), attempted = new Map();
  const savedGate = () => useGate && optionalJSON(path.join(workDir, "gate.json"));
  if (fix && (savedGate()?.fixes || []).some((description) => /card .* text tidied|only said|caption word .* repeated/i.test(description))) {
    fixes.set("card-text-clean", "The existing render gate corrected transcript artifacts before the final render.");
  }
  let flash, flashError, trimAttempted = false, textAttempted = false;
  const attempt = async (ids, repair) => {
    try { await repair(); return true; }
    catch (error) { for (const id of ids) attempted.set(id, `Repair could not be completed. ${firstLine(error)}`); return false; }
  };
  const measure = async () => {
    const offset = plan.masterTrim || 0;
    try { preflight ??= await (deps.runPreflight || runPreflight)(file, { plan: { ...plan, video: { ...plan.video, duration: Math.max(0, (plan.video?.duration || 0) - offset) } } }); }
    catch (error) { preflight = { error: `Preflight could not inspect the render. ${firstLine(error)}` }; }
    flashError = null;
    try { flash = await (deps.measureFlash || measureFlash)(file); }
    catch (error) { flash = null; flashError = `Opening luma could not be checked. ${firstLine(error)}`; }
  };
  const rebuildPlan = async (changed) => {
    await rebuild(changed);
    plan = readJSON(planFile);
    preflight = null;
  };

  await measure();
  while (fix) {
    const text = textPlan(plan);
    const planning = masterPlanningRules(plan, preflight.measures?.duration ?? plan.video?.duration);
    const missing = planning.filter((r) => !r.ok && ["card-floor", "broll-present"].includes(r.id) && !attempted.has(r.id));
    if (rebuild && replan && missing.length) {
      const ids = missing.map((r) => r.id);
      for (const id of ids) attempted.set(id, "Replanned once. The minimum is still unmet.");
      let rebuilt = false;
      await attempt(ids, async () => {
        const next = await replan(plan, ids);
        if (!next) return;
        await rebuildPlan(next);
        rebuilt = true;
      });
      if (rebuilt) for (const id of ids) fixes.set(id, "Replanned once and rebuilt.");
    } else if (rebuild && !textAttempted && !text.rule.ok) {
      textAttempted = true;
      if (await attempt([text.rule.id], () => rebuildPlan(textPlan(plan, true).plan))) fixes.set(text.rule.id, "Cleaned display text and dropped filler cards, then rebuilt.");
    } else if (!trimAttempted && flash?.spikes.length && flash.trim > 0) {
      trimAttempted = true;
      if (await attempt(["no-flash"], async () => {
        await (deps.trimOpening || trimOpening)(file, flash.trim);
        plan = { ...plan, masterTrim: (plan.masterTrim || 0) + flash.trim };
        writeJSON(planFile, plan);
        preflight = null;
      })) fixes.set("no-flash", `Trimmed ${at(flash.trim)} from the start of the render.`);
    } else break;
    if (!preflight) await measure();
  }

  onPreflight?.(preflight);
  const offset = plan.masterTrim || 0;
  const duration = preflight.measures?.duration ?? Math.max(0, (plan.video?.duration || 0) - offset);
  const speech = spokenWords(plan.words).filter((w) => w.end > offset && w.start < duration + offset);
  const shiftedSpeech = offset ? speech.map((w) => ({ ...w, start: Math.max(0, w.start - offset), end: w.end - offset })) : speech;
  const faces = await faceRules(file, plan, duration, offset, deps.detectFaces || detectFaces);
  const [cardFloor, brollPresent, fullScreen] = masterPlanningRules(plan, duration);
  const shots = plan.broll || [];
  const own = new Set(uniqueScenes(shots.map((shot) => shot.scene || "")));
  const recent = shots.length ? (deps.readRecent || readRecent)(undefined, { excludeReel: workDir, ownScenes: own }) : [];
  const repeats = shots.flatMap((shot) => {
    const motif = repeatedMotif({ ...shot, ...shot.pick }, recent);
    return motif ? [`B-roll at ${at(shot.start - offset)} repeats the recent ${motif} motif (${shot.scene || shot.shows || motif}).`] : [];
  });
  const edges = cleanEdges(shiftedSpeech, duration);
  if (fix && plan.clipSource?.snapped) fixes.set("clean-edges", "Moved the source cut to complete sentence boundaries.");
  const flashProblems = flashError ? [flashError] : flash.spikes.map((frame) => `Frame ${frame.i + 1} at ${at(frame.time)} has luma ${frame.luma.toFixed(1)}. The reference median is ${flash.median.toFixed(1)}.`);
  const rules = [
    ...faces, cardFloor, brollPresent,
    rule("broll-no-repeat", "warn", repeats, "No B-roll insert repeats a recent motif."),
    { id: "clean-edges", severity: isLongClip(workDir, plan) ? "block" : "warn", ...edges },
    rule("no-flash", "block", flashProblems, "Opening luma stays within 35 levels of the reference median."),
    textPlan(plan).rule,
    bannedRule(plan, workDir, shiftedSpeech),
    rule("private-details", "warn", timedMatches(shiftedSpeech, PRIVATE).map((hit) => `Greg to review ${hit}.`), "No family details, travel plans or time-sensitive dates detected in the spoken words."),
    fullScreen, ...preflightRules(plan, preflight, savedGate()),
  ].map((r) => {
    if (r.ok && fixes.has(r.id)) return { ...r, fixed: true, detail: `${fixes.get(r.id)}\n${r.detail}` };
    if (!r.ok && attempted.has(r.id)) return { ...r, detail: `${r.detail}\n${attempted.get(r.id)}` };
    return r;
  });
  return writeReport(workDir, verdict(rules));
}
