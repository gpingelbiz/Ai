import fs from "node:fs";
import path from "node:path";
import { probe } from "./probe.mjs";
import { transcribe, importTranscript, applyCorrections } from "./transcribe.mjs";
import { planCuts, applyCuts, remapWords, audioEnvelope, guardSilenceCuts, snapSegments } from "./cuts.mjs";
import { toneMapToSdr } from "./hdr.mjs";
import { resolveEngine, secondEngine, compareTranscripts, writeReview } from "./review.mjs";
import { detectFaces, headExtent, placeHook, placeCaptions, zoomDuring, captionsRepeatingHook } from "./placement.mjs";
import { groupWords, markKeywords, hookWords } from "./captions.mjs";
import { pickHook, pickCta } from "./hook.mjs";
import { planZooms } from "./zooms.mjs";
import { composeProject, canvasFor } from "./compose.mjs";
import { makeBroll } from "./broll.mjs";
import { makeGraphics } from "./graphics.mjs";
import { planSlams } from "./slams.mjs";
import { voiceFile } from "../scripts/write-caption.mjs";
import { listTracks, moodsOf, pickTrack, chooseMoods, duckingLane, describePick } from "./music.mjs";
import { needsReframe, sampleTimes, faceCentres, smoothTrack, objectPositionLane } from "./reframe.mjs";
import { makeCover } from "./cover.mjs";
import { check, render, hyperframesBin } from "./render.mjs";
import { loadPreset, mergeOverrides, loadDictionary } from "./presets.mjs";
import * as eleven from "./elevenlabs.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, r3, slug, run, VIDEO_EXTS } from "./util.mjs";

/** A saved transcript is reused only for the same source file (same path, size and modified time). A work folder
 *  name can repeat for a different clip (IMG_0287 edited in chat, then dropped again), and reusing its words
 *  would caption the new video with the old transcript. Transcripts saved before this check carry only a path. */
/** A half-written words.json (a killed run) reads as absent instead of failing every retry. */
function readJSONSafe(p) {
  try { return readJSON(p); } catch { return null; }
}

function sameSource(saved, input) {
  if (!saved?.source || path.resolve(saved.source) !== input) {
    if (saved?.source) log(`saved transcript is for ${saved.source}; transcribing this file fresh`);
    return false;
  }
  if (!saved.sourceStat) return true;
  try {
    const st = fs.statSync(input);
    return st.size === saved.sourceStat.size && Math.round(st.mtimeMs) === saved.sourceStat.mtimeMs;
  } catch {
    return false;
  }
}

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
  const early = { second: null, envelope: meta.hasAudio ? audioEnvelope(input).catch(() => ({ step: 0.02, db: [] })) : null };
  let words;
  let primaryEngine = null;
  let reusedWords = false;
  if (opts.transcript) {
    words = importTranscript(path.resolve(opts.transcript));
    log(`imported ${words.length} words from ${opts.transcript}`);
  } else if (fs.existsSync(wordsPath) && !opts.force && sameSource(readJSONSafe(wordsPath), input)) {
    const saved = readJSONSafe(wordsPath);
    words = saved.words;
    primaryEngine = saved.engine || null;
    reusedWords = true;
    log(`reusing ${wordsPath} (${words.length} words); pass --force to re-transcribe`);
  } else {
    if (!meta.hasAudio) throw new Error("source has no audio track, nothing to transcribe (pass --transcript to supply words)");
    const eng = resolveEngine(preset.transcribe.engine);
    log(`transcribing with ${eng === "elevenlabs" ? "ElevenLabs Scribe" : `faster-whisper (${preset.transcribe.model})`}…`);
    // The second opinion and the audio level run alongside the first transcript: each decodes the input on its own.
    if (preset.transcribe.verify && !opts.noVerify) {
      const other = secondEngine(eng);
      if (other) {
        log(`second opinion from ${other === "elevenlabs" ? "ElevenLabs Scribe" : `faster-whisper (${preset.transcribe.verifyModel || preset.transcribe.model})`} (alongside)…`);
        early.second = transcribe(input, { engine: other, model: preset.transcribe.verifyModel || preset.transcribe.model, language: preset.transcribe.language, prompt: (dict.terms || []).slice(0, 40).join(", "), out: path.join(workDir, "words-second.json"), hyperframesBin: hyperframesBin() }).catch((e) => { warn(`second opinion failed: ${String(e.message).split("\n")[0]}`); return null; });
      }
    }
    words = await transcribe(input, {
      engine: preset.transcribe.engine,
      model: preset.transcribe.model,
      language: preset.transcribe.language,
      prompt: (dict.terms || []).slice(0, 40).join(", "),
      out: wordsPath,
      hyperframesBin: hyperframesBin(),
    });
    primaryEngine = readJSON(wordsPath).engine || resolveEngine(preset.transcribe.engine);
    log(`${words.length} words`);
  }
  words = applyCorrections(words, dict.corrections);
  let sourceStat = null;
  try { const st = fs.statSync(input); sourceStat = { size: st.size, mtimeMs: Math.round(st.mtimeMs) }; } catch {}
  writeJSON(wordsPath, { source: input, sourceStat, engine: primaryEngine, words });

  // 1b. Second opinion: a different engine hears the same audio; disagreements go into review.txt.
  let review = null;
  if (preset.transcribe.verify && !opts.transcript && !opts.noVerify && words.length) {
    const other = secondEngine(primaryEngine || "faster-whisper");
    const secondPath = path.join(workDir, "words-second.json");
    let second = null;
    if (early.second) second = await early.second;
    else if (fs.existsSync(secondPath) && !opts.force && reusedWords) second = readJSONSafe(secondPath)?.words || null;
    else if (other) {
      log(`second opinion from ${other === "elevenlabs" ? "ElevenLabs Scribe" : `faster-whisper (${preset.transcribe.verifyModel || preset.transcribe.model})`}…`);
      try {
        second = await transcribe(input, {
          engine: other,
          model: preset.transcribe.verifyModel || preset.transcribe.model,
          language: preset.transcribe.language,
          prompt: (dict.terms || []).slice(0, 40).join(", "),
          out: secondPath,
          hyperframesBin: hyperframesBin(),
        });
      } catch (e) {
        warn(`second opinion failed: ${String(e.message).split("\n")[0]}`);
      }
    }
    if (second) second = applyCorrections(second, dict.corrections);
    review = { items: compareTranscripts(words, second, { minProb: preset.transcribe.minProb ?? 0.5 }), primaryEngine, secondEngineName: second ? other || "saved" : null };
  }
  if (!words.length) warn("transcript is empty: no captions, no cuts");

  // 2. Cut plan
  const cutsOn = !opts.noCuts && words.length > 0 && (preset.cuts.silence !== "off" || preset.cuts.badTakes || preset.cuts.fillers);
  let cuts = cutsOn
    ? planCuts(words, meta.duration, preset.cuts)
    : { segments: [{ start: 0, end: r3(meta.duration) }], removed: [], originalDuration: r3(meta.duration), keptDuration: r3(meta.duration), words };
  if (cutsOn && meta.hasAudio && preset.cuts.audioGuard !== false) {
    const guarded = guardSilenceCuts(cuts, await early.envelope, meta.duration);
    cuts = guarded.cuts;
    if (guarded.restored) log(`audio check: kept sound in ${guarded.restored} cut${guarded.restored === 1 ? "" : "s"} the transcript timing would have clipped`);
    if (guarded.noisy) warn("audio check: the room is noisy (fan, AC, traffic?), so most silence cuts were kept; the reel will run longer. A quieter room or --silence off avoids this");
  }
  if (cutsOn) {
    // Frame-aligned edges keep video and audio cutting at the same instants (no lip-sync drift over many cuts).
    cuts.segments = snapSegments(cuts.segments, meta.fps || preset.render.fps || 30, meta.duration);
    cuts.keptDuration = r3(cuts.segments.reduce((a, s) => a + (s.end - s.start), 0));
  }
  writeJSON(path.join(workDir, "cuts.json"), cuts);
  const byReason = {};
  for (const r of cuts.removed) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  log(`cuts: ${cuts.removed.length} removed (${Object.entries(byReason).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}), ${r3(meta.duration)}s → ${cuts.keptDuration}s`);

  // 3. Clean footage
  const cleanPath = path.join(workDir, "clean.mp4");
  const needsPass = (cutsOn && cuts.removed.length > 0) || (preset.audio.cleanAudio && meta.hasAudio) || meta.rotation !== 0 || meta.hdr;
  let videoSrc = input;
  let cleanMeta = meta;
  let cutInput = input;
  let cutHdr = meta.hdr;
  if (meta.hdrKind === "pq") {
    const sdrPath = path.join(workDir, "source-sdr.mov");
    log("tone-mapping PQ HDR source to BT.709 with VideoToolbox…");
    if (await toneMapToSdr(input, sdrPath, meta)) {
      cutInput = sdrPath;
      cutHdr = false;
    } else {
      warn("VideoToolbox tone mapping unavailable: converting PQ with the colorspace filter, colors may look flat");
    }
  }
  if (needsPass) {
    log("encoding clean.mp4 (cuts" + (preset.audio.cleanAudio && meta.hasAudio ? " + clean audio" : "") + (cutHdr ? ` + ${meta.hdrKind} → BT.709 SDR` : "") + ")…");
    await applyCuts(cutInput, cuts.segments, cleanPath, { hasAudio: meta.hasAudio, cleanAudio: preset.audio.cleanAudio, fps: preset.render.fps || 30, hdr: cutHdr, scaleTo: canvasFor(preset.canvas, meta) });
    videoSrc = cleanPath;
    cleanMeta = await probe(cleanPath);
  }
  const duration = r3(cleanMeta.duration);
  const cleanWords = remapWords(cuts.words, cuts.segments).filter((w) => w.start < duration);

  // 4. Captions, hook, zooms
  const groups = preset.captions.enabled ? markKeywords(groupWords(cleanWords, duration, preset.captions), dict, { maxPerLine: preset.captions.maxKeywordsPerLine, auto: !!preset.captions.autoKeywords }) : [];
  const hook = preset.hook.enabled ? pickHook(cleanWords, { text: opts.hook, maxWords: preset.hook.maxWords, duration: Math.min(preset.hook.duration, duration) }) : null;
  if (hook) Object.assign(hook, hookWords(hook.text, dict));
  let zooms = []; // planned after the cards and cutaways are known, so punch-ins never land under them
  const cta = preset.cta?.enabled ? pickCta(duration, preset.cta) : null;

  // Face: captions sit just under the chin (never over the mouth), the hook stays off the head.
  let shownGroups = groups;
  const canvas0 = canvasFor(preset.canvas, cleanMeta);
  const sameShape = Math.abs(canvas0.width / canvas0.height - cleanMeta.width / cleanMeta.height) < 0.05;
  let detection = null;
  const wantFace = sameShape && ((preset.captions.autoPlace && opts.captionPosition == null && shownGroups.length) || (hook && preset.hook.autoPlace && opts.hookPosition == null));
  if (wantFace) {
    const t0 = hook ? hook.start : 0, t1 = hook ? hook.start + hook.duration : Math.min(duration, 6);
    const times = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.min(duration - 0.05, t0 + f * (t1 - t0)));
    detection = await detectFaces(videoSrc, times);
  }
  let captionTop = preset.captions.position - 0.04;
  if (preset.captions.autoPlace && opts.captionPosition == null && sameShape && shownGroups.length) {
    const head = headExtent(detection);
    const spot = placeCaptions(head, { fontSizeFrac: preset.captions.fontSizeFrac, defaultPosition: preset.captions.position });
    preset.captions.position = spot.position;
    captionTop = spot.top - 0.02;
    const where = { "below-chin": "just under the chin", capped: "as low as the caption overlay allows (chin is low in the frame)", "safe-zone": "at the safe-zone line (wide shot)", default: "at the preset height (no face found)" }[spot.zone];
    log(`captions: ${where}, ${Math.round(spot.position * 100)}% from the top`);
  }
  if (hook) {
    const hide = captionsRepeatingHook(groups, hook);
    if (hide.size) {
      shownGroups = groups.filter((_, i) => !hide.has(i));
      log(`captions: ${hide.size} line${hide.size === 1 ? "" : "s"} hidden while the hook shows the same words`);
    }
    if (preset.hook.autoPlace && opts.hookPosition == null && sameShape) {
      const t0 = hook.start, t1 = hook.start + hook.duration;
      const head = headExtent(detection, { zoom: 1.06 }); // the opening push-in reaches 1.06 by the end of the hook
      const fontPx = Math.round(preset.hook.fontSizeFrac * canvas0.height * (preset.hook.style === "headline" ? 1.08 : 1));
      const spot = placeHook(head, { words: hook.words || hook.text.split(/\s+/).map((t) => ({ text: t })), W: canvas0.width, H: canvas0.height, fontPx, captionTop, defaultPosition: preset.hook.position });
      if (head) {
        preset.hook.position = spot.position;
        preset.hook.fontSizeFrac = r3(preset.hook.fontSizeFrac * spot.fontScale);
        const where = { above: "above the head", below: "between the chin and the captions", fallback: "in the biggest gap (tight frame)" }[spot.zone];
        log(`hook placement: ${where} at ${Math.round(spot.position * 100)}%${spot.fontScale < 1 ? `, text at ${Math.round(spot.fontScale * 100)}%` : ""} (head spans ${Math.round(head.top * 100)}-${Math.round(head.bottom * 100)}%)`);
      } else {
        log(`hook placement: no face found, keeping ${Math.round(preset.hook.position * 100)}% from the top`);
      }
    }
  }
  // Wide source into a tall canvas: follow the face instead of cropping the middle.
  let reframe = null;
  const canvas1 = canvasFor(preset.canvas, cleanMeta);
  if (preset.reframe?.enabled !== false && needsReframe(cleanMeta, canvas1)) {
    const det = await detectFaces(videoSrc, sampleTimes(duration, preset.reframe?.step ?? 0.5));
    if (det?.frames?.length) {
      reframe = objectPositionLane(smoothTrack(faceCentres(det)), cleanMeta, canvas1);
      log(`reframe: following the face across ${reframe.length} move${reframe.length === 1 ? "" : "s"} (wide source into ${canvas1.mode})`);
    } else log("reframe: no face found in the wide shot, keeping the centre crop");
  }
  log(`captions: ${groups.length} lines, ${groups.filter((g) => g.words.some((w) => w.key)).length} with a highlight`);
  log(`hook: ${hook ? `"${hook.text}"${hook.auto ? " (auto, pass --hook for a written one)" : ""}` : "none"}`);
  if (cta) log(`cta: "${cta.text}" at ${cta.start}s for ${cta.duration}s (${cta.style})`);
  if (review) {
    const spots = writeReview(workDir, { ...review, segments: cuts.segments, title: hook?.text || name });
    log(spots.length ? `review: ${spots.length} spot${spots.length === 1 ? "" : "s"} to check, see ${path.join(workDir, "review.txt")}` : `review: both engines agree, nothing to check`);
  }

  // 4b. Graphic cards (Claude writes them from the transcript), then b-roll photos (Codex) in the gaps between
  // them. Either one failing leaves the reel without it. Punch-ins come last: on gold lines, clear of both.
  const headForZoom = headExtent(detection);
  const tightFrame = !!(headForZoom && headForZoom.bottom - headForZoom.top > 0.4);
  const graphics = preset.graphics?.enabled && shownGroups.length
    ? await makeGraphics({ workDir, groups: shownGroups, duration, hook, cta, settings: preset.graphics, voice: readVoice({ style: preset }), force: !!opts.newGraphics })
    : [];
  const broll = preset.broll?.enabled && shownGroups.length
    ? await makeBroll({ workDir, groups: shownGroups, duration, hook, cta, settings: preset.broll, force: !!opts.newBroll, busy: graphics })
    : [];
  if (preset.zooms.enabled) {
    zooms = planZooms(shownGroups, duration, { ...preset.zooms, busy: [...graphics, ...broll], hook, tight: tightFrame });
    log(`zooms: ${zooms.filter((z) => z.scale > 1).length} punch-in${zooms.filter((z) => z.scale > 1).length === 1 ? "" : "s"} on key lines${tightFrame ? " (tight frame, gentle)" : ""}${preset.zooms.style === "camera" ? ", camera move" : ""}`);
  }
  // Climax words: the strongest gold words stamp in big as they are said, clear of the cards and cutaways.
  const slams = preset.slams?.enabled && shownGroups.length ? planSlams(shownGroups, duration, { ...preset.slams, dict, hook, busy: [...graphics, ...broll], zooms }) : [];
  if (preset.slams?.enabled) log(`slams: ${slams.length} climax word${slams.length === 1 ? "" : "s"}${slams.length ? ": " + slams.map((sl) => `"${sl.text}" at ${sl.t}s`).join(", ") : ""}`);

  // 5. Audio extras
  const projectDir = path.join(workDir, "project");
  const audio = await prepareAudio({ workDir, projectDir, preset, opts, duration, hook, zooms, words: cleanWords, transcript: shownGroups.map((g) => g.text).join(" ") });

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
    captions: shownGroups,
    zooms,
    graphics,
    broll,
    slams,
    reframe,
    audio,
    words: cleanWords,
  };
  writeJSON(path.join(workDir, "plan.json"), plan);
  composeProject(plan, projectDir);
  log(`project: ${projectDir} (edit ${path.join(workDir, "plan.json")} and run: reel build ${workDir})`);
  if (opts.noRender) return { workDir, plan };
  const output = await renderProject(workDir, opts);
  let cover = null;
  if (preset.cover?.enabled !== false && hook) {
    try { cover = await makeCover(workDir, plan, { handle: preset.carousel?.handle || "" }); } catch (e) { warn(`cover skipped: ${String(e.message).split("\n")[0]}`); }
  }
  return { workDir, plan, output, cover };
}

function readVoice(plan) {
  try { return fs.readFileSync(voiceFile(plan), "utf8"); } catch { return ""; }
}

async function prepareAudio({ workDir, projectDir, preset, opts, duration, hook, zooms, words = [], transcript = "" }) {
  const assets = ensureDir(path.join(projectDir, "assets"));
  const audio = { tracks: [], replaceAudio: !!opts.replaceAudio };

  // The bed: a file (--music), or a pick from the music folder (--music-dir) by the mood of what is said.
  let src = preset.audio.music ? path.resolve(preset.audio.music) : null;
  let pickNote = null;
  if (src && !fs.existsSync(src)) throw new Error(`music file not found: ${src}`);
  if (!src && preset.audio.musicDir) {
    const tracks = listTracks(path.resolve(preset.audio.musicDir));
    if (!tracks.length) log(`music: no tracks in ${preset.audio.musicDir}`);
    else {
      const want = preset.audio.musicWant || "";
      const choice = want ? { moods: [] } : await chooseMoods({ transcript, hook: hook?.text, moods: moodsOf(tracks), voice: readVoice({ style: preset }) });
      if (choice.none && !want) log(`music: none for this one${choice.why ? ` (${choice.why})` : ""}`);
      else {
        const t = pickTrack(tracks, { want, moods: choice.moods, seed: workDir });
        src = t.file;
        pickNote = describePick(t, choice);
      }
    }
  }
  if (src) {
    const dst = path.join(assets, "music.m4a");
    const level = preset.audio.musicVolume;
    const startAt = Math.min(0.5, duration / 4);
    // Trim (or loop a short track) to the reel length and normalize the bed, so the level means the same for
    // a loud trap beat and a soft pad: -16 LUFS like the voice, then `level` under it.
    await run("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "-1", "-i", src, "-t", String(r3(duration - startAt)), "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", dst]);
    const lane = preset.audio.duck === false ? null : duckingLane(words, { duration, level, start: startAt });
    audio.tracks.push({ id: "music", src: "assets/music.m4a", start: startAt, duration: r3(duration - startAt), volume: level, fadeIn: 1, fadeOut: 1.5, lane, track: 8 });
    fs.writeFileSync(path.join(workDir, "music.txt"), `Music: ${path.basename(src)}\n`);
    log(`music: ${pickNote || path.basename(src)} at ${level}${lane ? ", swelling in the pauses" : ""}`);
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

/**
 * Hook A/B: the first `seconds` of the reel rendered once per alternative hook, into <workDir>/hooks/. The plan is
 * reused as is (same cuts, captions, music); only the hook text changes. Returns the output paths.
 */
export async function renderHookVariants(workDir, hooks, { seconds = 4, quality = "draft" } = {}) {
  workDir = path.resolve(workDir);
  const base = readJSON(path.join(workDir, "plan.json"));
  if (!base.hook) throw new Error("this reel has no hook to vary");
  const outDir = ensureDir(path.join(workDir, "hooks"));
  const outs = [];
  for (let i = 0; i < hooks.length; i++) {
    const text = String(hooks[i]).trim();
    if (!text) continue;
    const dict = loadDictionary();
    const plan = structuredClone(base);
    plan.name = `hook-${i + 1}`;
    plan.hook = { ...plan.hook, ...hookWords(text, dict) };
    const D = Math.min(seconds, plan.video.duration);
    plan.video = { ...plan.video, duration: D };
    plan.captions = (plan.captions || []).filter((g) => g.start < D).map((g) => ({ ...g, end: Math.min(g.end, D) }));
    plan.zooms = (plan.zooms || []).filter((z) => z.t < D);
    plan.graphics = (plan.graphics || []).filter((g) => g.start < D);
    plan.broll = (plan.broll || []).filter((b) => b.start < D);
    plan.slams = (plan.slams || []).filter((sl) => sl.t < D);
    plan.cta = null;
    plan.audio = { ...(plan.audio || {}), tracks: (plan.audio?.tracks || []).filter((t) => t.start < D).map((t) => ({ ...t, duration: Math.min(t.duration || D, D - t.start), lane: t.lane ? t.lane.filter((p) => p.t <= D) : t.lane })) };
    const projectDir = path.join(outDir, `project-${i + 1}`);
    // Assets (footage, music, stills) are shared with the main project.
    ensureDir(projectDir);
    const mainAssets = path.join(workDir, "project", "assets");
    if (fs.existsSync(mainAssets)) { fs.rmSync(path.join(projectDir, "assets"), { recursive: true, force: true }); fs.symlinkSync(mainAssets, path.join(projectDir, "assets")); }
    fs.writeFileSync(path.join(projectDir, "index.html"), (await import("./compose.mjs")).renderHTML(plan, `assets/footage${path.extname(plan.video.src) || ".mp4"}`));
    const output = path.join(outDir, `Hook ${i + 1} - ${text.replace(/\*/g, "").replace(/[/:"*?<>|\\]/g, "").replace(/[.\s]+$/, "")}.mp4`);
    log(`hook ${i + 1}: "${text}" → ${path.basename(output)}`);
    await render(projectDir, output, { quality });
    outs.push(output);
  }
  return outs;
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
  if (opts.check) await check(projectDir);
  log(`rendering → ${output}`);
  const t0 = Date.now();
  await render(projectDir, output, { quality: opts.quality || plan.style?.render?.quality || "looks", fps: opts.fps || plan.style?.render?.fps });
  if (plan.video.hasAudio && plan.style?.render?.deliveryLoudness !== false) await normalizeDelivery(output);
  const outMeta = await probe(output);
  log(`done in ${Math.round((Date.now() - t0) / 1000)}s: ${output} (${outMeta.width}x${outMeta.height}, ${r3(outMeta.duration)}s)`);
  return output;
}

/**
 * Delivery loudness: the mix lands at -14 LUFS integrated, -1 dBTP (what Instagram normalizes toward), measured
 * in a first pass and applied linearly in a second, video copied untouched. Skipped quietly on any failure.
 */
export async function normalizeDelivery(file) {
  const tmp = file.replace(/\.mp4$/, ".loud.mp4");
  try {
    const { err } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { capture: true, allowFail: true });
    const m = err.match(/\{[^{}]*"input_i"[^{}]*\}/);
    if (!m) return false;
    const j = JSON.parse(m[0]);
    const af = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true:print_format=summary`;
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", af, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", tmp]);
    fs.renameSync(tmp, file);
    log(`loudness: ${Number(j.input_i).toFixed(1)} LUFS → -14 LUFS, peak -1 dBTP`);
    return true;
  } catch (e) {
    warn(`loudness pass skipped: ${String(e.message).split("\n")[0]}`);
    fs.rmSync(tmp, { force: true });
    return false;
  }
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
