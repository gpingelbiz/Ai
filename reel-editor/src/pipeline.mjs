import fs from "node:fs";
import path from "node:path";
import { probe } from "./probe.mjs";
import { transcribe, importTranscript, applyCorrections } from "./transcribe.mjs";
import { planCuts, applyCuts, remapWords } from "./cuts.mjs";
import { groupWords, markKeywords } from "./captions.mjs";
import { pickHook, pickCta } from "./hook.mjs";
import { planZooms } from "./zooms.mjs";
import { composeProject, canvasFor } from "./compose.mjs";
import { check, render, hyperframesBin } from "./render.mjs";
import { loadPreset, mergeOverrides, loadDictionary } from "./presets.mjs";
import * as eleven from "./elevenlabs.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, r3, slug, run, VIDEO_EXTS } from "./util.mjs";

export async function runEdit(input, opts = {}) {
  input = path.resolve(input);
  if (!fs.existsSync(input)) throw new Error(`no such file: ${input}`);
  const name = slug(opts.title || path.basename(input, path.extname(input)));
  const workDir = path.resolve(opts.out || path.join("videos", name));
  ensureDir(workDir);
  const preset = mergeOverrides(loadPreset(opts.preset), opts);
  const dict = loadDictionary(opts.dictionary);
  log(`work dir: ${workDir}`);
  log(`preset: ${preset.name}`);

  const meta = await probe(input);
  writeJSON(path.join(workDir, "meta.json"), { input, ...meta });
  log(`source: ${meta.width}x${meta.height} ${r3(meta.duration)}s ${meta.fps}fps audio=${meta.hasAudio}`);

  // 1. Words
  const wordsPath = path.join(workDir, "words.json");
  let words;
  if (opts.transcript) {
    words = importTranscript(path.resolve(opts.transcript));
    log(`imported ${words.length} words from ${opts.transcript}`);
  } else if (fs.existsSync(wordsPath) && !opts.force) {
    words = readJSON(wordsPath).words;
    log(`reusing ${wordsPath} (${words.length} words); pass --force to re-transcribe`);
  } else {
    if (!meta.hasAudio) throw new Error("source has no audio track, nothing to transcribe (pass --transcript to supply words)");
    log(`transcribing with ${preset.transcribe.engine} (${preset.transcribe.model})…`);
    words = await transcribe(input, {
      engine: preset.transcribe.engine,
      model: preset.transcribe.model,
      language: preset.transcribe.language,
      prompt: (dict.terms || []).slice(0, 40).join(", "),
      out: wordsPath,
      hyperframesBin: hyperframesBin(),
    });
    log(`${words.length} words`);
  }
  words = applyCorrections(words, dict.corrections);
  writeJSON(wordsPath, { source: input, words });
  if (!words.length) warn("transcript is empty: no captions, no cuts");

  // 2. Cut plan
  const cutsOn = !opts.noCuts && words.length > 0 && (preset.cuts.silence !== "off" || preset.cuts.badTakes || preset.cuts.fillers);
  const cuts = cutsOn
    ? planCuts(words, meta.duration, preset.cuts)
    : { segments: [{ start: 0, end: r3(meta.duration) }], removed: [], originalDuration: r3(meta.duration), keptDuration: r3(meta.duration), words };
  writeJSON(path.join(workDir, "cuts.json"), cuts);
  const byReason = {};
  for (const r of cuts.removed) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  log(`cuts: ${cuts.removed.length} removed (${Object.entries(byReason).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}), ${r3(meta.duration)}s → ${cuts.keptDuration}s`);

  // 3. Clean footage
  const cleanPath = path.join(workDir, "clean.mp4");
  const needsPass = (cutsOn && cuts.removed.length > 0) || (preset.audio.cleanAudio && meta.hasAudio) || meta.rotation !== 0;
  let videoSrc = input;
  let cleanMeta = meta;
  if (needsPass) {
    log("encoding clean.mp4 (cuts" + (preset.audio.cleanAudio && meta.hasAudio ? " + clean audio" : "") + ")…");
    await applyCuts(input, cuts.segments, cleanPath, { hasAudio: meta.hasAudio, cleanAudio: preset.audio.cleanAudio, fps: preset.render.fps || 30 });
    videoSrc = cleanPath;
    cleanMeta = await probe(cleanPath);
  }
  const duration = r3(cleanMeta.duration);
  const cleanWords = remapWords(cuts.words, cuts.segments).filter((w) => w.start < duration);

  // 4. Captions, hook, zooms
  const groups = preset.captions.enabled ? markKeywords(groupWords(cleanWords, duration, preset.captions), dict, { maxPerLine: preset.captions.maxKeywordsPerLine }) : [];
  const hook = preset.hook.enabled ? pickHook(cleanWords, { text: opts.hook, maxWords: preset.hook.maxWords, duration: Math.min(preset.hook.duration, duration) }) : null;
  const zooms = preset.zooms.enabled ? planZooms(groups.length ? groups : cleanWords, duration, preset.zooms) : [];
  const cta = preset.cta?.enabled ? pickCta(duration, preset.cta) : null;
  log(`captions: ${groups.length} lines, ${groups.filter((g) => g.words.some((w) => w.key)).length} with a highlight`);
  log(`hook: ${hook ? `"${hook.text}"${hook.auto ? " (auto, pass --hook for a written one)" : ""}` : "none"}`);
  log(`zooms: ${zooms.length}`);
  if (cta) log(`cta: "${cta.text}" at ${cta.start}s for ${cta.duration}s (${cta.style})`);

  // 5. Audio extras
  const projectDir = path.join(workDir, "project");
  const audio = await prepareAudio({ projectDir, preset, opts, duration, hook, zooms });

  const plan = {
    version: 1,
    name,
    preset: preset.name,
    source: input,
    video: { src: videoSrc, duration, width: cleanMeta.width, height: cleanMeta.height, fps: cleanMeta.fps, hasAudio: cleanMeta.hasAudio },
    canvas: canvasFor(preset.canvas, cleanMeta),
    style: preset,
    hook,
    cta,
    captions: groups,
    zooms,
    audio,
    words: cleanWords,
  };
  writeJSON(path.join(workDir, "plan.json"), plan);
  composeProject(plan, projectDir);
  log(`project: ${projectDir} (edit ${path.join(workDir, "plan.json")} and run: reel build ${workDir})`);
  if (opts.noRender) return { workDir, plan };
  const output = await renderProject(workDir, opts);
  return { workDir, plan, output };
}

async function prepareAudio({ projectDir, preset, opts, duration, hook, zooms }) {
  const assets = ensureDir(path.join(projectDir, "assets"));
  const audio = { tracks: [], replaceAudio: !!opts.replaceAudio };

  if (preset.audio.music) {
    const src = path.resolve(preset.audio.music);
    if (!fs.existsSync(src)) throw new Error(`music file not found: ${src}`);
    const dst = path.join(assets, "music.m4a");
    // Loop/trim the bed to the reel length so it always covers the whole video.
    await run("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "-1", "-i", src, "-t", String(duration), "-vn", "-c:a", "aac", "-b:a", "192k", dst]);
    audio.tracks.push({ id: "music", src: "assets/music.m4a", start: 0, duration, volume: preset.audio.musicVolume, fadeIn: 1, fadeOut: 1.5, track: 8 });
    log(`music: ${path.basename(src)} at ${preset.audio.musicVolume}`);
  }

  if (opts.voiceover) {
    const text = fs.readFileSync(path.resolve(opts.voiceover), "utf8").trim();
    const dst = path.join(assets, "narration.mp3");
    log("voiceover: generating with ElevenLabs…");
    await eleven.tts({ text, voiceId: opts.voice || preset.audio.voiceId || undefined, out: dst });
    audio.tracks.push({ id: "narration", src: "assets/narration.mp3", start: 0, volume: 1, track: 7 });
    if (audio.replaceAudio) log("voiceover replaces the footage audio");
  }

  if (preset.audio.sfx) {
    if (!eleven.hasKey()) warn("--sfx needs ELEVENLABS_API_KEY; skipping sound effects");
    else {
      const sfxDir = ensureDir(path.join(assets, "sfx"));
      const zoomIns = zooms.filter((z) => z.scale > 1);
      if (zoomIns.length) {
        await eleven.sfx({ prompt: preset.audio.sfxPrompts.zoom, durationSeconds: 0.7, out: path.join(sfxDir, "whoosh.mp3") });
        zoomIns.forEach((z, i) => audio.tracks.push({ id: `sfx-zoom-${i}`, src: "assets/sfx/whoosh.mp3", start: r3(Math.max(0, z.t - 0.05)), duration: 0.7, volume: preset.audio.sfxVolume, track: 9 }));
      }
      if (hook) {
        await eleven.sfx({ prompt: preset.audio.sfxPrompts.hook, durationSeconds: 0.6, out: path.join(sfxDir, "pop.mp3") });
        audio.tracks.push({ id: "sfx-hook", src: "assets/sfx/pop.mp3", start: r3(hook.start + 0.04), duration: 0.6, volume: preset.audio.sfxVolume, track: 9 });
      }
      log(`sfx: ${audio.tracks.filter((t) => t.id.startsWith("sfx")).length} hits`);
    }
  }
  return audio;
}

export async function buildProject(workDir, opts = {}) {
  workDir = path.resolve(workDir);
  const planPath = path.join(workDir, "plan.json");
  if (!fs.existsSync(planPath)) throw new Error(`no plan.json in ${workDir}`);
  const plan = readJSON(planPath);
  const projectDir = path.join(workDir, "project");
  composeProject(plan, projectDir);
  log(`project rebuilt from plan.json: ${projectDir}`);
  if (opts.noRender) return { workDir, plan };
  return { workDir, plan, output: await renderProject(workDir, opts) };
}

export async function renderProject(workDir, opts = {}) {
  workDir = path.resolve(workDir);
  const plan = readJSON(path.join(workDir, "plan.json"));
  const projectDir = path.join(workDir, "project");
  const output = path.resolve(opts.output || path.join(workDir, "renders", `${plan.name}.mp4`));
  if (!opts.noCheck) await check(projectDir);
  log(`rendering → ${output}`);
  const t0 = Date.now();
  await render(projectDir, output, { quality: opts.quality || plan.style?.render?.quality || "looks", fps: opts.fps || plan.style?.render?.fps });
  const outMeta = await probe(output);
  log(`done in ${Math.round((Date.now() - t0) / 1000)}s: ${output} (${outMeta.width}x${outMeta.height}, ${r3(outMeta.duration)}s)`);
  return output;
}

export async function batchEdit(folder, opts = {}) {
  folder = path.resolve(folder);
  const files = fs.readdirSync(folder).filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase())).sort();
  const results = [];
  for (const f of files) {
    const name = slug(path.basename(f, path.extname(f)));
    const workDir = path.resolve(opts.out ? path.join(opts.out, name) : path.join("videos", name));
    const done = fs.existsSync(path.join(workDir, "renders", `${name}.mp4`));
    if (done && !opts.force) {
      log(`skip ${f} (already rendered)`);
      continue;
    }
    log(`=== ${f}`);
    try {
      results.push(await runEdit(path.join(folder, f), { ...opts, out: workDir, title: name }));
    } catch (e) {
      warn(`${f}: ${e.message}`);
    }
  }
  return results;
}
