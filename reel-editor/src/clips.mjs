import fs from "node:fs";
import path from "node:path";
import { probe } from "./probe.mjs";
import { transcribe, applyCorrections } from "./transcribe.mjs";
import { resolveEngine } from "./review.mjs";
import { claudeText, firstJSON, hasClaude } from "./claude.mjs";
import { hyperframesBin } from "./render.mjs";
import { loadPreset, loadDictionary } from "./presets.mjs";
import { runEdit } from "./pipeline.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, run, r3, slug } from "./util.mjs";
import { reframeClip, describeLayout } from "./speakers.mjs";
import { audioEnvelope } from "./cuts.mjs";
import { snapClipWindows } from "./reel-edges.mjs";
import { sentenceLines, lineEnergy, cutPoints, momentsPrompt, region, askEdges, resolveClips, describeEdges, shapeRegion, askShapes, resolveShapes, SHAPE_RULES } from "./moments.mjs";

/**
 * One long video (a live, a training, a podcast) into several reels. The whole thing is transcribed once, headless
 * Claude picks 30-90 s windows with a hook and a score, each window is cut out of the source and goes through the
 * normal edit with its slice of the transcript (no second transcription). clips.json in the work dir lists them.
 */

export const CLIPS_SCHEMA_HINT = '{"clips":[{"start":<seconds>,"end":<seconds>,"hook":"4-8 words, with the key phrase in *asterisks*","why":"...","score":<0-100>}]}';

// Greg 11-24 "make that a rule that we don't limit long form to only 5 things": a long recording gets about one reel
// per 3 minutes (a 52 min call -> 17), at least 5 and at most 25, unless --count gives a number.
export const CLIPS_PER_SECONDS = 180, CLIPS_MIN = 5, CLIPS_MAX = 25;
export function clipCount(requested, duration) {
  const n = parseInt(requested, 10);
  if (Number.isFinite(n) && n > 0) return Math.min(CLIPS_MAX, n);
  return Math.max(CLIPS_MIN, Math.min(CLIPS_MAX, Math.round((duration || 0) / CLIPS_PER_SECONDS)));
}

export function clipsPrompt({ words, duration, count, voice = "" }) {
  // Timestamped lines every ~8 words so Claude can point at real moments.
  const lines = [];
  for (let i = 0; i < words.length; i += 8) {
    const chunk = words.slice(i, i + 8);
    lines.push(`[${chunk[0].start.toFixed(1)}] ${chunk.map((w) => w.text).join(" ")}`);
  }
  return [
    "You are a short-form editor mining one long talking-head recording for Instagram reels. Reply with JSON only; use no tools.",
    `Pick up to ${count} windows of 30 to 90 seconds (the recording is ${Math.round(duration)} s). Each must start where a complete thought begins (the first spoken words are the hook's partner) and end on its payoff, never mid-sentence. Windows must not overlap.`,
    "Score each 0-100 for how well it would hold a cold viewer: a stake in the first 5 words, one idea, a payoff or turn, specifics (numbers, names, moments), and a line worth quoting. Prefer moments where the speaker is direct, not warm-ups, housekeeping or thanks.",
    "Write a hook for each: 4-8 words, true to what is said, the key phrase in *asterisks*.",
    voice ? `\nVoice:\n${voice.trim()}` : "",
    "",
    "Transcript with start times in seconds:",
    ...lines,
    "",
    `Reply: ${CLIPS_SCHEMA_HINT}`,
  ].join("\n");
}

/** Snap a window to word boundaries with a little air, keep it inside the recording and the length limits. */
export function tidyWindows(raw, words, duration, { min = 25, max = 95, pad = 0.25 } = {}) {
  const out = [];
  for (const c of raw || []) {
    let a = Number(c.start), b = Number(c.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const first = words.find((w) => w.start >= a - 0.5) || words[0];
    const lastIdx = words.findIndex((w) => w.start > b);
    const last = lastIdx > 0 ? words[lastIdx - 1] : words[words.length - 1];
    if (!first || !last) continue;
    a = Math.max(0, first.start - pad);
    b = Math.min(duration, last.end + pad);
    if (b - a < min || b - a > max + 10) continue;
    if (out.some((o) => a < o.end && b > o.start)) continue;
    out.push({ start: r3(a), end: r3(b), hook: String(c.hook || "").trim(), why: String(c.why || "").trim(), score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 0))) });
  }
  return out.sort((x, y) => y.score - x.score);
}

/** Words inside a window, re-timed from its start. */
export function sliceWords(words, start, end) {
  return words.filter((w) => w.start >= start && w.end <= end).map((w) => ({ ...w, start: r3(w.start - start), end: r3(w.end - start) }));
}

/** The words of a clip made of kept ranges, in clip time (each range follows the one before it). */
export function keepWords(words, keeps) {
  let offset = 0;
  const out = [];
  for (const k of keeps) {
    out.push(...sliceWords(words, k.start, k.end).map((w) => ({ ...w, start: r3(w.start + offset), end: r3(w.end + offset) })));
    offset += k.end - k.start;
  }
  return out;
}

/** ffmpeg arguments that cut kept ranges out of the source and join them, with 30/40 ms audio fades at every join. */
export function keepsArgs(input, keeps, out, { encoder = process.platform === "darwin" ? ["-c:v", "h264_videotoolbox", "-q:v", "75"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"] } = {}) {
  const ins = keeps.flatMap((k) => ["-ss", String(k.start), "-t", String(r3(k.end - k.start)), "-i", input]);
  const parts = keeps.map((k, i) => {
    const d = r3(k.end - k.start);
    return `[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st=${r3(Math.max(0, d - 0.04))}:d=0.04[a${i}]`;
  });
  const join = `${keeps.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${keeps.length}:v=1:a=1[v][a]`;
  return ["-y", "-loglevel", "error", ...ins, "-filter_complex", `${parts.join(";")};${join}`, "-map", "[v]", "-map", "[a]", ...encoder, "-c:a", "aac", "-b:a", "192k", out];
}

export async function makeClips(input, opts = {}) {
  input = path.resolve(input);
  if (!fs.existsSync(input)) throw new Error(`no such file: ${input}`);
  const name = slug(opts.title || path.basename(input, path.extname(input)));
  const workDir = ensureDir(path.resolve(opts.out || path.join("videos", `${name}-clips`)));
  const preset = loadPreset(opts.preset);
  const dict = loadDictionary(opts.dictionary);
  const meta = await probe(input);
  const count = clipCount(opts.count, meta.duration);
  log(`clips: ${r3(meta.duration)}s source, up to ${count} reels → ${workDir}`);

  // 1. One transcript for the whole recording.
  const wordsPath = path.join(workDir, "words.json");
  let words;
  if (fs.existsSync(wordsPath) && !opts.force) {
    words = readJSON(wordsPath).words;
    log(`reusing ${wordsPath} (${words.length} words)`);
  } else {
    const eng = resolveEngine(preset.transcribe.engine);
    log(`transcribing with ${eng === "elevenlabs" ? "ElevenLabs Scribe" : `faster-whisper (${preset.transcribe.model})`}…`);
    words = await transcribe(input, { engine: preset.transcribe.engine, model: preset.transcribe.model, language: preset.transcribe.language, prompt: (dict.terms || []).slice(0, 40).join(", "), out: wordsPath, hyperframesBin: hyperframesBin() });
    words = applyCorrections(words, dict.corrections);
    writeJSON(wordsPath, { source: input, words });
  }
  if (!words.length) throw new Error("nothing was said in this recording");

  // 2. Claude picks the windows.
  const clipsPath = path.join(workDir, "clips.json");
  let clips;
  if (fs.existsSync(clipsPath) && !opts.force && !opts.replan) {
    clips = readJSON(clipsPath).clips;
    log(`reusing ${clips.length} windows from ${clipsPath} (--replan to pick again)`);
  } else {
    if (!hasClaude()) throw new Error("picking windows needs the Claude Code CLI (claude) signed in");
    log(`clips: Claude is picking up to ${count} moments…`);
    let voice = "";
    try { voice = fs.readFileSync(opts.voice || process.env.REEL_CAPTION_VOICE || path.join(path.dirname(new URL(import.meta.url).pathname), "..", "voice", /^pingel-/.test(preset.name) ? "greg.md" : "default.md"), "utf8"); } catch {}
    if (opts.picker === "legacy") {
      const reply = await claudeText(clipsPrompt({ words, duration: meta.duration, count, voice }), { timeoutMs: 300000 });
      clips = tidyWindows(firstJSON(reply).clips, words, meta.duration);
    } else if (opts.picker === "edges") clips = await pickCleanEdges({ input, words, duration: meta.duration, count, voice, workDir });
    else clips = await pickShapes({ input, words, duration: meta.duration, count, voice, workDir });
  }
  // A shaped clip's ranges already sit on word boundaries; a one-window clip is snapped to whole sentences.
  const shaped = clips.filter((c) => c.keeps?.length);
  clips = [...shaped, ...snapClipWindows(clips.filter((c) => !c.keeps?.length), words, meta.duration)];
  if (!clips.length) throw new Error("no usable windows with complete sentence edges were found");
  writeJSON(clipsPath, { source: input, clips });
  log(`clips: ${clips.length} window${clips.length === 1 ? "" : "s"}${clips.map((c) => `\n  ${c.score}  ${fmt(c.start)}-${fmt(c.end)}  "${c.hook}"  ${c.why}${c.problems ? `\n       ${describeEdges(c)}` : ""}`).join("")}`);
  if (opts.planOnly) return { workDir, clips };

  // 3. Cut each window out of the source (a fast re-encode so the cut lands exactly on the start) and edit it.
  const results = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const dir = ensureDir(path.join(workDir, `clip-${i + 1}`));
    const src = path.join(dir, "source.mp4");
    const cutPath = path.join(dir, "source-window.json");
    const sourceStat = fs.statSync(input);
    const multi = c.keeps?.length > 1;
    const cut = { input, size: sourceStat.size, mtime: sourceStat.mtimeMs, start: c.start, end: c.end, ...(c.keeps?.length ? { keeps: c.keeps } : {}) };
    let previous;
    try { previous = readJSON(cutPath); } catch {}
    const recut = !fs.existsSync(src) || opts.force || JSON.stringify(cut) !== JSON.stringify(previous);
    if (recut) {
      fs.rmSync(cutPath, { force: true });
      fs.rmSync(path.join(dir, "source-portrait.mp4"), { force: true });
      log(multi ? `clip ${i + 1}: cutting ${c.keeps.length} kept ranges (${c.keeps.map((k) => `${fmt(k.start)}-${fmt(k.end)}`).join(", ")})${c.lifted ? ", the claim line first" : ""}…` : `clip ${i + 1}: cutting ${fmt(c.start)}-${fmt(c.end)}…`);
      if (multi) await run("ffmpeg", keepsArgs(input, c.keeps, src));
      else await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(c.start), "-to", String(c.end), "-i", input, "-c:v", process.platform === "darwin" ? "h264_videotoolbox" : "libx264", ...(process.platform === "darwin" ? ["-q:v", "75"] : ["-preset", "veryfast", "-crf", "16"]), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", src], { quiet: true });
      writeJSON(cutPath, cut);
    }
    const clipWords = multi ? keepWords(words, c.keeps) : sliceWords(words, c.start, c.end);
    // Wide footage (a podcast, an interview, a screen recording) becomes a portrait source that follows whoever is
    // talking, cuts on the turn and splits the screen when two people trade lines; a portrait clip is used as is.
    let editSrc = src;
    if (opts.layout !== false && !opts.noLayout) {
      const portrait = path.join(dir, "source-portrait.mp4");
      try {
        if (!fs.existsSync(portrait) || opts.force) {
          const cm = await probe(src);
          const r = await reframeClip(src, portrait, { words: clipWords, meta: cm, fps: preset.render?.fps || 30 });
          if (r) log(`clip ${i + 1}: speaker framing: ${describeLayout(r.plan)}`);
          else log(`clip ${i + 1}: already portrait or no face found; using the plain cut`);
        }
        if (fs.existsSync(portrait)) editSrc = portrait;
      } catch (e) {
        warn(`clip ${i + 1}: speaker framing failed (${String(e.message).split("\n")[0]}); using the plain cut`);
      }
    }
    const tPath = path.join(dir, "transcript.json");
    writeJSON(tPath, { source: editSrc, words: clipWords });
    try {
      const r = await runEdit(editSrc, { ...opts, out: path.join(dir, "edit"), title: `${name}-${i + 1}`, transcript: tPath, clipSource: { input, start: c.start, end: c.end, snapped: !!c.snapped, ...(multi ? { keeps: c.keeps } : {}) }, hook: opts.autoHook ? undefined : c.hook || undefined, force: false, count: undefined, planOnly: undefined });
      results.push({ ...c, output: r.output, workDir: r.workDir });
    } catch (e) {
      warn(`clip ${i + 1} failed: ${String(e.message).split("\n")[0]}`);
    }
  }
  writeJSON(clipsPath, { source: input, clips: results.length ? results : clips });
  return { workDir, clips: results };
}

/**
 * The clean-edge picker (src/moments.mjs): Claude finds moments by their quotable line, then picks each clip's
 * opening and earliest complete ending among labelled real boundaries; code maps labels to times and gates the
 * edges. Two Claude calls for the whole recording.
 */
async function pickCleanEdges({ input, words, duration, count, voice, workDir }) {
  const lines = sentenceLines(words);
  let energy = [];
  try { energy = lineEnergy(lines, await audioEnvelope(input)); } catch {}
  log(`clips: ${lines.length} lines, ${energy.filter((e) => e.tag).length} with raised energy; Claude is finding the moments…`);
  const r1 = firstJSON(await claudeText(momentsPrompt({ lines, energy, count, duration, voice }), { timeoutMs: 600000 }));
  const moments = (r1.moments || []).filter((m) => lines.some((l) => l.id === m.anchor)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, count * 3);
  if (!moments.length) throw new Error("Claude found no moments with a valid line label");
  const points = cutPoints(lines, words);
  const regions = moments.map((m) => region(lines, points, m.anchor));
  const usable = regions.filter(Boolean);
  log(`clips: ${moments.length} moments; Claude is choosing clean openings and endings…`);
  const r2 = await askEdges(usable, async (prompt) => firstJSON(await claudeText(prompt, { timeoutMs: 600000 })), {
    onFail: (e, from, to) => warn(`clips: Claude gave no openings and endings for moments ${from}-${to} (${e.message}); those are dropped`),
  });
  // Region numbers in the reply count only the usable regions; line them back up with the moments.
  const order = regions.map((r, k) => (r ? k : -1)).filter((k) => k >= 0);
  const edges = r2.map((e) => ({ ...e, region: order[Number(e.region) - 1] + 1 }));
  const dropped = [];
  const clips = resolveClips({ moments, regions, edges, lines, words, duration, count, dropped });
  log(`clips: ${clips.length} clip${clips.length === 1 ? "" : "s"} (${clips.filter((c) => !c.problems.length).length} with clean edges)${dropped.length ? `; dropped ${dropped.length}: ${dropped.map((d) => `"${d.hook}" (${d.why})`).join(", ")}` : ""}`);
  // The raw picks, for tracing a bad clip back to its moment and edges.
  writeJSON(path.join(workDir, "clips-picker.json"), { moments, edges, dropped, lines: lines.length });
  return clips;
}

/**
 * The shaped picker (src/moments.mjs, Herk's long-to-short rules): Claude finds the moments, then shapes each one
 * (lead, body, lines to leave out, payoff) by line label; code builds up to three kept ranges, enforces the hard rules
 * (no opener that refers back or reads the chat, the payoff inside, 35-60 s) and drops what fails. Two Claude calls.
 */
async function pickShapes({ input, words, duration, count, voice, workDir }) {
  const lines = sentenceLines(words);
  let energy = [];
  try { energy = lineEnergy(lines, await audioEnvelope(input)); } catch {}
  log(`clips: ${lines.length} lines, ${energy.filter((e) => e.tag).length} with raised energy; Claude is finding the moments…`);
  const r1 = firstJSON(await claudeText(momentsPrompt({ lines, energy, count, duration, voice, minLen: SHAPE_RULES.min, maxLen: SHAPE_RULES.max }), { timeoutMs: 600000 }));
  const moments = (r1.moments || []).filter((m) => lines.some((l) => l.id === m.anchor)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, count * 3);
  if (!moments.length) throw new Error("Claude found no moments with a valid line label");
  const regions = moments.map((m) => shapeRegion(lines, m.anchor));
  const usable = regions.filter(Boolean);
  log(`clips: ${moments.length} moments; Claude is shaping each one (claim first, the body in order, the payoff inside)…`);
  const r2 = await askShapes(usable, async (prompt) => firstJSON(await claudeText(prompt, { timeoutMs: 600000 })), {
    onFail: (e, from, to) => warn(`clips: Claude gave no shapes for moments ${from}-${to} (${e.message}); those are dropped`),
  });
  const order = regions.map((r, k) => (r ? k : -1)).filter((k) => k >= 0);
  const shapes = r2.map((e) => ({ ...e, region: order[Number(e.region) - 1] + 1 }));
  const dropped = [];
  const clips = resolveShapes({ moments, regions, shapes, lines, words, count, dropped });
  log(`clips: ${clips.length} shaped clip${clips.length === 1 ? "" : "s"} (${clips.filter((c) => c.lifted).length} with the claim moved first, ${clips.filter((c) => c.keeps.length > 1).length} from more than one range)${dropped.length ? `; dropped ${dropped.length}: ${dropped.map((d) => `"${d.hook}" (${d.why})`).join(", ")}` : ""}`);
  writeJSON(path.join(workDir, "clips-picker.json"), { picker: "shaped", moments, shapes, dropped, lines: lines.length });
  return clips;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
