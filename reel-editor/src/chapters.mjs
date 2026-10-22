import fs from "node:fs";
import path from "node:path";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, run, r3 } from "./util.mjs";

/**
 * Structure for a whole YouTube video: the promise, the chapters, the re-hooks, and the packaging copy. Claude
 * reads the sentence-timed transcript once. Rules from YouTube and the retention research (docs/long-form-youtube.md):
 * chapters start at 0:00, at least 3, at least 10 s each; re-hooks near 3:00 and 6:00 and every 2-3 min after.
 */

export function sentenceLines(groups) {
  // Caption groups are 2-4 word phrases; join them into sentences for the prompt, keeping the start time.
  const out = [];
  let cur = null;
  for (const g of groups) {
    if (!cur) cur = { start: g.start, text: g.text, lines: [out.length ? g.i ?? 0 : 0] };
    else cur.text += " " + g.text;
    if (/[.!?]$/.test(g.text.trim()) || cur.text.length > 160) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.map((s, i) => ({ i, start: r3(s.start), text: s.text.replace(/\s+/g, " ").trim() }));
}

export function structurePrompt({ sentences, duration, handle = "", voice = "" }) {
  const mins = Math.round(duration / 60);
  return [
    "You are the editor and packager of one long-form YouTube video (a talking-head lesson). Reply with JSON only; use no tools.",
    `The video is ${mins} minutes. Use only what the speaker says; never invent claims, numbers or names.`,
    "",
    "Return:",
    '- promise: the on-screen hook for the first 3 seconds, 4-8 words, the key phrase in *asterisks*, true to the opening.',
    `- chapters: 3 to ${Math.max(3, Math.min(12, Math.round(duration / 120)))} chapters that follow the real topic changes. Each {sentence: <index where it starts>, title: 2-6 words, keyworded, plain language}. The first chapter starts at sentence 0. Chapters are at least 40 seconds apart.`,
    "- rehooks: 2 to 5 moments where the speaker opens a new problem or stake, near minute 3 and minute 6 and then every 2-3 minutes: {sentence, text: the line as a 4-8 word on-screen callout with the key phrase in *asterisks*}.",
    "- titles: 3 YouTube title options, at most 70 characters, key words first, no clickbait the video does not deliver.",
    "- description: 1-2 lines in the speaker's voice that say what the viewer gets (no links, no hashtags; the chapters are added after).",
    "- hashtags: 3.",
    "- pinned: one line for a pinned comment that asks the question the video raises.",
    voice ? `\nVoice:\n${voice.trim()}` : "",
    handle ? `\nThe speaker's handle: ${handle}` : "",
    "",
    "Sentences with start times (index: time text):",
    ...sentences.map((s) => `${s.i}: ${s.start.toFixed(1)}s ${s.text}`),
    "",
    'Reply: {"promise":"...","chapters":[{"sentence":0,"title":"..."}],"rehooks":[{"sentence":12,"text":"..."}],"titles":["..."],"description":"...","hashtags":["#a","#b","#c"],"pinned":"..."}',
  ].join("\n");
}

const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Apply YouTube's chapter rules and keep the rest tidy. Returns null when the reply is unusable. */
export function normalizeStructure(raw, sentences, duration, { minChapter = 10, minGapChapters = 40, endSafe = 20 } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const at = (i) => sentences[Number(i)]?.start;
  let chapters = (Array.isArray(raw.chapters) ? raw.chapters : [])
    .map((c) => ({ start: at(c.sentence), title: clean(c.title, 48) }))
    .filter((c) => Number.isFinite(c.start) && c.title)
    .sort((a, b) => a.start - b.start);
  if (chapters.length) chapters[0].start = 0;
  const kept = [];
  for (const c of chapters) {
    const prev = kept[kept.length - 1];
    if (prev && c.start - prev.start < Math.max(minChapter, minGapChapters)) continue;
    if (duration - c.start < minChapter) continue;
    kept.push({ start: r3(c.start), title: c.title });
  }
  chapters = kept.length >= 3 ? kept : [];
  const rehooks = (Array.isArray(raw.rehooks) ? raw.rehooks : [])
    .map((h) => ({ start: at(h.sentence), text: clean(h.text, 60) }))
    .filter((h) => Number.isFinite(h.start) && h.text && h.start > 45 && h.start < duration - endSafe)
    .sort((a, b) => a.start - b.start)
    .filter((h, i, arr) => !i || h.start - arr[i - 1].start >= 90)
    .slice(0, 5)
    .map((h) => ({ ...h, start: r3(h.start) }));
  return {
    promise: clean(raw.promise, 60),
    chapters,
    rehooks,
    titles: (Array.isArray(raw.titles) ? raw.titles : []).map((t) => clean(t, 100)).filter(Boolean).slice(0, 3),
    description: clean(raw.description, 400),
    hashtags: (Array.isArray(raw.hashtags) ? raw.hashtags : []).map((h) => (String(h).startsWith("#") ? String(h) : `#${h}`).replace(/\s+/g, "")).slice(0, 3),
    pinned: clean(raw.pinned, 200),
  };
}

export async function makeStructure({ workDir, groups, duration, handle = "", voice = "", force = false, endSafe = 20 }) {
  const planPath = path.join(workDir, "structure.json");
  const sentences = sentenceLines(groups);
  const key = sentences.map((s) => `${s.start}:${s.text}`).join("|");
  if (!force && fs.existsSync(planPath)) {
    const saved = readJSON(planPath);
    if (saved.key === key && saved.structure) { log(`structure: reusing ${saved.structure.chapters.length} chapters from ${planPath}`); return saved.structure; }
  }
  if (!hasClaude()) { warn("the structure (chapters, titles) needs the Claude Code CLI; skipped"); return null; }
  try {
    log("structure: Claude is reading the whole video for chapters, re-hooks and titles…");
    const reply = await claudeText(structurePrompt({ sentences, duration, handle, voice }), { timeoutMs: 300000 });
    const structure = normalizeStructure(firstJSON(reply), sentences, duration, { endSafe });
    if (!structure) throw new Error("unusable reply");
    writeJSON(planPath, { key, structure });
    log(`structure: ${structure.chapters.length} chapters, ${structure.rehooks.length} re-hooks, ${structure.titles.length} titles${structure.chapters.map((c) => `\n  ${fmt(c.start)} ${c.title}`).join("")}`);
    return structure;
  } catch (e) {
    warn(`structure: ${String(e.message).split("\n")[0]}; no chapters this time`);
    return null;
  }
}

export const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The description block YouTube reads chapters from: 0:00 first, one per line. */
export function descriptionText(structure, { duration, booking = "" } = {}) {
  const lines = [];
  if (structure.description) lines.push(structure.description, "");
  if (booking) lines.push(booking, "");
  if (structure.chapters.length >= 3) {
    lines.push("Chapters");
    for (const c of structure.chapters) lines.push(`${fmt(c.start)} ${c.title}`);
    lines.push("");
  }
  if (structure.hashtags.length) lines.push(structure.hashtags.join(" "));
  return lines.join("\n").trim() + "\n";
}

/** SRT from the cut words: one cue per caption line (2-4 words), times already in the finished video. */
export function srtText(groups) {
  const ts = (t) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), f = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(f).padStart(3, "0")}`;
  };
  // Merge caption lines into readable cues of up to ~8 words / 4 s.
  const cues = [];
  let cur = null;
  for (const g of groups) {
    if (cur && (cur.words + g.words.length > 8 || g.end - cur.start > 4 || g.start - cur.end > 0.7)) { cues.push(cur); cur = null; }
    if (!cur) cur = { start: g.start, end: g.end, text: g.text, words: g.words.length };
    else { cur.end = g.end; cur.text += " " + g.text; cur.words += g.words.length; }
  }
  if (cur) cues.push(cur);
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n") + "\n";
}

/** auto-editor's v3 timeline (Unlicense): the kept segments of the source, so Resolve or Premiere can take over. */
export function v3Timeline(segments, { source, fps = 30, width = 1920, height = 1080, sampleRate = 48000 }) {
  let at = 0;
  const clips = segments.map((s) => {
    const dur = Math.round((s.end - s.start) * fps);
    const c = { src: source, start: Math.round(at), dur, offset: Math.round(s.start * fps), stream: 0, speed: 1 };
    at += dur;
    return c;
  });
  return { version: "3", timebase: `${fps}/1`, background: "#000000", resolution: [width, height], samplerate: sampleRate, layout: "default", v: [clips.map((c) => ({ ...c, name: "video" }))], a: [clips.map((c) => ({ ...c, name: "audio", volume: 1 }))] };
}

/** Three clean best frames at 1920x1080 for the thumbnail (face big, mouth not mid-word), from the finished video. */
export async function thumbnailFrames(video, duration, outDir, { count = 3, personBinary } = {}) {
  const bin = personBinary ? await personBinary() : null;
  ensureDir(outDir);
  const times = [];
  for (let t = 1; t < duration - 1; t += Math.max(2, duration / 40)) times.push(+t.toFixed(2));
  let picks = times.slice(0, count);
  if (bin) {
    try {
      const { out } = await run(bin, [video, ...times.map(String), "--out", path.join(outDir, "person.png"), "--frame", path.join(outDir, "frame.png")], { capture: true });
      const j = JSON.parse(out.slice(out.indexOf("{")));
      const scored = [...(j.frames || [])].sort((a, b) => b.score - a.score);
      picks = [];
      for (const f of scored) { if (picks.every((p) => Math.abs(p - f.t) > 20)) picks.push(f.t); if (picks.length >= count) break; }
      for (const f of ["person.png", "frame.png"]) fs.rmSync(path.join(outDir, f), { force: true });
    } catch {}
  }
  const files = [];
  for (let k = 0; k < picks.length; k++) {
    const png = path.join(outDir, `Thumbnail ${k + 1}.png`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(picks[k]), "-i", video, "-frames:v", "1", "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080", png], { quiet: true });
    files.push(png);
  }
  return files;
}

/** End-screen plan: the last 20 s stay clean; one recommendation plus subscribe. */
export function endScreenPlan(duration, { seconds = 20 } = {}) {
  const start = r3(Math.max(0, duration - seconds));
  return { start, end: r3(duration), elements: [{ type: "video", source: "best_for_viewer", position: "right" }, { type: "subscribe", position: "left" }], note: "Set in YouTube Studio: End screen -> start at the time above. The video keeps the last 20 s free of overlays." };
}
