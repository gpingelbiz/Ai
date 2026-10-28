import fs from "node:fs";
import path from "node:path";
import { probe } from "./probe.mjs";
import { transcribe, importTranscript, applyCorrections } from "./transcribe.mjs";
import { planCuts, applyCuts, remapWords, audioEnvelope, guardSilenceCuts, snapSegments } from "./cuts.mjs";
import { studioVoice, describeStudio, STUDIO_CHAIN } from "./studio.mjs";
import { fixWords, describeFix } from "./correct.mjs";
import { realignWords, describeAlignment, hasAlignment } from "./align.mjs";
import { makeCutout, describeCutout } from "./behind.mjs";
import { runPreflight, writePreflight, describePreflight } from "./preflight.mjs";
import { writeFeatures } from "./features.mjs";
import { watchRender, watchItems, describeWatch } from "./watch.mjs";
import { toneMapToSdr } from "./hdr.mjs";
import { resolveEngine, secondEngine, compareTranscripts, writeReview } from "./review.mjs";
import { detectFaces, headExtent, placeHook, placeCaptions, zoomDuring, captionsRepeatingHook, faceBox, baseFraming, hookBlockHeight, fitBlockHook, placeProgressRail, cardHeadTop, headBoxFor } from "./placement.mjs";
import { groupWords, markKeywords, hookWords } from "./captions.mjs";
import { pickHook, pickCta } from "./hook.mjs";
import { planZooms, planCadence } from "./zooms.mjs";
import { planBumps, planDrift } from "./motion.mjs";
import { soundCues, describeCues } from "./sounds.mjs";
import { makeStructure } from "./chapters.mjs";
import { composeProject, canvasFor } from "./compose.mjs";
import { peopleFrom, groupFraming, speakerTimeline, aimZooms } from "./group.mjs";
import { THEMES, applyTheme } from "./looks.mjs";

import { makeBroll } from "./broll.mjs";
import { makeRunwayBroll } from "./broll-runway.mjs";
import { planBrollLayouts } from "./layouts.mjs";
import { makeGraphics } from "./graphics.mjs";
import { planSlams } from "./slams.mjs";
import { makePopoutSlams, makeCutoutBroll, brollLayout } from "./cutouts.mjs";
import { iconCandidates, planIcons } from "./icons.mjs";
import { voiceFile } from "../scripts/write-caption.mjs";
import { listTracks, moodsOf, pickTrack, chooseMoods, duckingLane, describePick } from "./music.mjs";
import { needsReframe, sampleTimes, faceCentres, smoothTrack, objectPositionLane } from "./reframe.mjs";
import { makeCover } from "./cover.mjs";
import { check, render, hyperframesBin } from "./render.mjs";
import { loadPreset, mergeOverrides, loadDictionary } from "./presets.mjs";
import * as eleven from "./elevenlabs.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, r3, slug, run, sha1, VIDEO_EXTS } from "./util.mjs";

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

  // 1c. Caption word fix (Claude, text only, against the dictionary) and forced alignment (ElevenLabs), so a fixed
  // word and a faster-whisper word both land on the syllable. Both are cached in the work folder.
  if (words.length && !opts.transcript) {
    let changed = false;
    if (preset.transcribe.fix !== false) {
      const before = words;
      const fix = await fixWords({ words, dict, review, workDir, force: !!opts.force, minProb: preset.transcribe.minProb ?? 0.5 });
      (fix.note ? warn : log)(describeFix(fix, before));
      if (fix.edits.length) {
        words = fix.words;
        changed = true;
        // Review spots the fix resolved come off the list.
        if (review?.items?.length) {
          const spans = fix.edits.map((e) => [before[e.i].start - 0.015, before[e.i + e.n - 1].end]);
          review.items = review.items.filter((it) => !spans.some(([s, e]) => it.start >= s && it.start <= e));
        }
      }
    }
    const alignMode = preset.transcribe.align ?? "auto";
    const softTimings = (primaryEngine || "") !== "elevenlabs";
    if (alignMode === "always" || (alignMode === "auto" && (changed || softTimings))) {
      if (!hasAlignment()) log("word timing: ELEVENLABS_API_KEY not set, keeping the engine's timings");
      else {
        const alignedPath = path.join(workDir, "words-aligned.json");
        const key = sha1(JSON.stringify(words.map((w) => [w.text, w.start])));
        const saved = !opts.force && fs.existsSync(alignedPath) ? readJSONSafe(alignedPath) : null;
        let res;
        if (saved?.key === key) res = { ...saved.result, cached: true };
        else {
          res = await realignWords(input, words);
          if (!res.error) writeJSON(alignedPath, { key, result: res });
        }
        (res.error ? warn : log)(describeAlignment(res, changed ? "after the fix" : softTimings ? "faster-whisper timings" : "requested") + (res.cached ? " (saved)" : ""));
        if (!res.error) { words = res.words; changed = true; }
      }
    }
    if (changed) writeJSON(wordsPath, { source: input, sourceStat, engine: primaryEngine, words });
  }

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
  // Studio sound: DeepFilterNet denoises the whole voice on the source timeline; the cut pass then takes that WAV
  // instead of the source audio and runs the leveler chain. Falls back to the spectral denoiser when it is missing.
  let studio = null;
  if (needsPass && meta.hasAudio && preset.audio.cleanAudio && preset.audio.studio !== false) {
    const res = await studioVoice(cutInput, path.join(workDir, "studio-voice.wav"));
    if (res && !res.error) studio = res;
    (res && !res.error ? log : warn)(describeStudio(res));
  }
  if (needsPass) {
    log("encoding clean.mp4 (cuts" + (preset.audio.cleanAudio && meta.hasAudio ? (studio ? " + studio sound" : " + clean audio") : "") + (cutHdr ? ` + ${meta.hdrKind} → BT.709 SDR` : "") + ")…");
    await applyCuts(cutInput, cuts.segments, cleanPath, { hasAudio: meta.hasAudio, cleanAudio: preset.audio.cleanAudio, fps: preset.render.fps || 30, hdr: cutHdr, scaleTo: canvasFor(preset.canvas, meta), audioInput: studio?.wav || null, voiceChain: studio ? STUDIO_CHAIN : undefined });
    videoSrc = cleanPath;
    cleanMeta = await probe(cleanPath);
  }
  const duration = r3(cleanMeta.duration);
  const cleanWords = remapWords(cuts.words, cuts.segments).filter((w) => w.start < duration);

  // 4. Captions, hook, zooms
  // The caption lines are the timing backbone for everything (cards, stills, punch-ins, callouts, chapters, the
  // srt), so they are always built; whether they show on screen is captions.enabled.
  const groups = markKeywords(groupWords(cleanWords, duration, preset.captions), dict, { maxPerLine: preset.captions.maxKeywordsPerLine, auto: !!preset.captions.autoKeywords });
  const showCaptions = !!preset.captions.enabled;
  const hook = preset.hook.enabled ? pickHook(cleanWords, { text: opts.hook, maxWords: preset.hook.maxWords, duration: Math.min(preset.hook.duration, duration) }) : null;
  if (hook) Object.assign(hook, hookWords(hook.text, dict));
  let zooms = []; // planned after the cards and cutaways are known, so punch-ins never land under them
  const cta = preset.cta?.enabled ? pickCta(duration, preset.cta) : null;

  // Face: captions sit just under the chin (never over the mouth), the hook stays off the head.
  let shownGroups = groups;
  const canvas0 = canvasFor(preset.canvas, cleanMeta);
  const sameShape = Math.abs(canvas0.width / canvas0.height - cleanMeta.width / cleanMeta.height) < 0.05;
  let detection = null;
  const wantFace = sameShape && ((showCaptions && preset.captions.autoPlace && opts.captionPosition == null && shownGroups.length) || (hook && preset.hook.autoPlace && opts.hookPosition == null) || (hook && preset.hook.behind) || ["window", "split", "mix"].includes(preset.broll?.layout));
  if (wantFace) {
    const t0 = hook ? hook.start : 0, t1 = hook ? hook.start + hook.duration : Math.min(duration, 6);
    const times = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.min(duration - 0.05, t0 + f * (t1 - t0)));
    detection = await detectFaces(videoSrc, times);
  }
  // Base framing (long form): the face sampled across the whole video sets a tighter default frame on a wide
  // shot, and which side of the speaker has room for cards.
  let framing = { scale: 1, origin: preset.zooms.origin || "50% 40%" };
  let face = null;
  let people = [];
  if (preset.framing?.enabled && sameShape) {
    const det = await detectFaces(videoSrc, Array.from({ length: 12 }, (_, i) => r3(Math.min(duration - 0.05, 0.5 + (i * duration) / 12))));
    face = faceBox(det);
    people = peopleFrom(det);
    if (people.length >= 2) {
      // Two or more people in the shot: fit all of them, and aim the camera at whoever talks.
      const g = groupFraming(people, { max: preset.framing.max ?? 1.3, eyeLine: preset.framing.eyeLine ?? 0.42 });
      framing = { scale: g.scale, origin: g.origin, shift: g.shift, multi: true, people };
      face = g.face;
      detection = det; // the caption and hook placement see every person across the whole video
      log(`framing: ${people.length} people at ${people.map((p) => Math.round(p.cx * 100) + "%").join(", ")} across → base ${framing.scale}x on the group, zooms aim at whoever is talking, cards above the heads`);
    } else if (face) {
      framing = baseFraming(face, { target: preset.framing.faceHeight ?? 0.27, max: preset.framing.max ?? 1.3, eyeLine: preset.framing.eyeLine ?? 0.42 });
      log(`framing: face ${Math.round(face.h * 100)}% of the frame at ${Math.round(face.cx * 100)}% across → base ${framing.scale}x, cards on the ${face.cx < 0.5 ? "right" : "left"}`);
      if (detection) detection = { ...detection, frames: detection.frames }; // the hook and caption placement see the same frames, scaled below
    } else log("framing: no face found, keeping the frame as shot");
  }
  // Where the head is on the canvas: the base framing scales the footage about its origin AND slides it (framing.shift,
  // applied as the wrap's y in compose.mjs). Leaving the slide out put a v2 hook on the forehead: placement thought
  // the head sat 12% lower than it did.
  const zoomedHead = (d, z) => {
    const h = headExtent(d, { zoom: framing.scale * z, originY: parseFloat(framing.origin.split(" ")[1]) / 100 || 0.38 });
    const shift = framing.shift || 0;
    return h && shift ? { top: Math.max(0, h.top + shift), bottom: Math.min(1, h.bottom + shift) } : h;
  };
  let captionTop = preset.captions.position - 0.04;
  if (showCaptions && preset.captions.autoPlace && opts.captionPosition == null && sameShape && shownGroups.length) {
    const head = zoomedHead(detection, framing.multi ? Math.max(1, ...(preset.zooms.scales || [1])) : 1);
    const spot = placeCaptions(head, { fontSizeFrac: preset.captions.fontSizeFrac, defaultPosition: preset.captions.position, min: preset.captions.placeMin ?? 0.56, max: preset.captions.placeMax ?? 0.76, gap: preset.captions.placeGap ?? 0.03 });
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
      const head = zoomedHead(detection, 1.06); // the opening push-in reaches 1.06 by the end of the hook
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
  // Text behind you: the person is cut out of the hook window and layered over the headline, so the hook is placed
  // to run behind the top of the head (its lower part hidden by the forehead) instead of clearing it.
  let behindPlan = null;
  let behindHead = null;
  if (hook && preset.hook.behind && sameShape && opts.hookPosition == null) {
    const head0 = zoomedHead(detection, 1.06);
    if (!head0) log("hook behind you: off (no face found in the hook frames)");
    else {
      const cut = await makeCutout({ video: videoSrc, start: hook.start, duration: hook.duration, fps: preset.render.fps || 30, outDir: workDir });
      if (cut.error) warn(describeCutout(cut));
      else {
        behindPlan = { file: cut.src, start: cut.start, duration: cut.duration, coverage: cut.coverage };
        behindHead = { top: head0.top, fontSizeFrac: preset.hook.fontSizeFrac };
        preset.hook.fontSizeFrac = r3(preset.hook.fontSizeFrac * (preset.hook.behindScale ?? 1.12));
        const fontPx = Math.round(preset.hook.fontSizeFrac * canvas0.height * (preset.hook.style === "headline" ? 1.08 : 1));
        const h = hookBlockHeight(hook.words || hook.text.split(/\s+/).map((t) => ({ text: t })), { W: canvas0.width, H: canvas0.height, fontPx });
        // The head tucks under the bottom of the block, never more than about half of the last line: with three
        // lines, 40% of the block was a whole line, and the hook's payoff could not be read (Reel 9).
        const line = fontPx / canvas0.height;
        const tuck = Math.min((preset.hook.behindOverlap ?? 0.4) * h, 0.5 * line);
        preset.hook.position = r3(Math.max(0.06, head0.top - (h - tuck)));
        log(`${describeCutout(cut)}; hook at ${Math.round(preset.hook.position * 100)}%, the bottom ${Math.round((tuck / line) * 100)}% of its last line behind the head (head top ${Math.round(head0.top * 100)}%)`);
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
  const headForZoom = zoomedHead(detection, 1);
  const tightFrame = !!(headForZoom && headForZoom.bottom - headForZoom.top > 0.4);
  // Long form: the last `endSafe` seconds stay clean for YouTube's end screen; the structure (chapters, re-hooks)
  // comes first so its title cards take their slots before the other cards are planned around them.
  const endSafe = preset.youtube?.endSafe || 0;
  const tail = Math.max(1.5, endSafe);
  let structure = null;
  let structureCards = [];
  if (preset.youtube?.chapters && shownGroups.length) {
    structure = await makeStructure({ workDir, groups: shownGroups, duration, handle: preset.carousel?.handle || "", voice: readVoice({ style: preset }), force: !!opts.newGraphics, endSafe });
    if (structure) {
      if (hook && structure.promise && hook.auto) { Object.assign(hook, { text: structure.promise.replace(/\*/g, ""), auto: false }, hookWords(structure.promise, dict)); log(`hook: "${hook.text}" (the promise, from the structure)`); }
      structureCards = [
        ...structure.chapters.slice(1).map((c, i) => ({ type: "chapter", text: c.title, number: i + 2, eyebrow: "", start: r3(c.start), duration: 3.5 })),
        ...structure.rehooks.filter((h) => !structure.chapters.some((c) => Math.abs(c.start - h.start) < 8)).map((h) => ({ type: "headline", text: h.text, eyebrow: "", start: r3(h.start), duration: 4.5 })),
      ].filter((c) => c.start > (hook ? hook.start + hook.duration + 0.5 : 3) && c.start + c.duration < duration - tail).sort((a, b) => a.start - b.start);
    }
  }
  let graphics = preset.graphics?.enabled && shownGroups.length
    ? await makeGraphics({ workDir, groups: shownGroups, duration, hook, cta, settings: preset.graphics, voice: readVoice({ style: preset }), force: !!opts.newGraphics, handle: preset.carousel?.handle || "", tail })
    : [];
  const graphicsSchema = graphics.schema || 1;
  const sceneSchema = graphicsSchema;
  // The reel's look (picked with the cards) themes the rest of it: hook treatment, caption marker, slam style,
  // b-roll grade and cut, camera move. A reel without cards keeps its preset's look.
  const look = graphics.look;
  if (look && THEMES[look]) {
    Object.assign(preset, applyTheme(preset, look, { keep: { zoomStyle: !!opts.zoomStyle, brollCut: !!opts.brollCut } }));
    const t = THEMES[look];
    log(`look: ${look} also sets the hook (${t.hook}), the caption marker (${t.marker}), the slams (${t.slam}), the b-roll grade (${t.grade.preset}) and cut (${preset.broll.cut}), and the camera (${preset.zooms.style})`);
    // A hook on a solid block is opaque: it cannot run behind the head (the cutout would hide whole words of the
    // cover, frame 0) or reach the eyes. It is measured in its own type and sits above the head, smaller if that is
    // what it takes; the cutout stays under it (over a cold-open still, the cutout keeps the person on the cover).
    const headTop = behindHead?.top ?? (hook && detection ? zoomedHead(detection, 1.06)?.top : null);
    const above = !behindHead && headTop != null && preset.hook.position <= headTop;
    if (hook && (behindHead || above)) {
      const words = hook.words || hook.text.split(/\s+/).map((x) => ({ text: x }));
      const fit = fitBlockHook(words, { treat: t.hook, headTop, fontSizeFrac: behindHead?.fontSizeFrac ?? preset.hook.fontSizeFrac, W: canvas0.width, H: canvas0.height });
      if (fit) {
        if (behindPlan) behindPlan.under = true;
        preset.hook.fontSizeFrac = fit.fontSizeFrac;
        preset.hook.position = fit.position;
        log(`hook: the ${t.hook} block sits above the head${behindPlan ? " over the cutout" : ""} at ${Math.round(preset.hook.position * 100)}%, so every word shows on the cover and the eyes stay clear${fit.fits ? "" : " (it could not fully clear the head at 60% size)"}`);
      }
    }
  }
  // The payoff rail is laid out after the final hook treatment and caption position are known. The horizontal
  // band wins; a collision moves it to the empty face side, and an unsafe side strip drops it altogether.
  if (hook && graphics.some((g) => g.type === "progress")) {
    const words = hook.words || hook.text.split(/\s+/).map((text) => ({ text }));
    const fontPx = Math.round(preset.hook.fontSizeFrac * canvas0.height * (preset.hook.style === "headline" ? 1.08 : 1));
    const blockH = hookBlockHeight(words, { W: canvas0.width, H: canvas0.height, fontPx });
    const hookTop = preset.hook.style === "headline" ? preset.hook.position : Math.max(0, preset.hook.position - 1.2 * preset.hook.fontSizeFrac);
    const progressFace = face || faceBox(detection);
    // The rail must clear the whole head (hair included) at the strongest zoom, not only the face box.
    const railDrift = preset.motion?.drift?.enabled ? 1 + (preset.motion.drift.scale || 0) : 1;
    const railHead = headBoxFor(progressFace, detection, { zoom: Math.max(1.1, ...(preset.zooms?.scales || [1])) * railDrift, scale: framing.scale, originY: parseFloat(framing.origin.split(" ")[1]) / 100 || 0.38, shift: framing.shift || 0 });
    const placement = placeProgressRail({ W: canvas0.width, H: canvas0.height, hookTop, hookBottom: hookTop + blockH, captionTop, face: railHead, side: progressFace && progressFace.cx >= 0.5 ? "left" : "right" });
    if (placement.skip) {
      graphics = graphics.filter((g) => g.type !== "progress");
      log(`graphics: progress rail skipped (${placement.reason})`);
    } else {
      graphics = graphics.map((g) => g.type === "progress" ? { ...g, placement } : g);
      log(`graphics: progress rail ${placement.orientation === "vertical" ? "moved to the empty face side" : placement.at === "top" ? "placed at the top, above the hook and clear of the head" : "placed between the hook and captions"}`);
    }
  }
  // A card that only restates the hook title shows the same line twice in a row (the render reviewer caught one).
  if (hook && graphics.length) {
    const toks = (t) => String(t || "").toLowerCase().replace(/[*"“”'’.,!?:]/g, "").split(/\s+/).filter(Boolean);
    const hk = new Set(toks(hook.text));
    const repeats = (g) => { const t = toks(g.text || g.title); return t.length && t.filter((x) => hk.has(x)).length / t.length >= 0.8; };
    const before = graphics.length;
    graphics = graphics.filter((g) => !(["headline", "quote"].includes(g.type) && repeats(g)));
    graphics.schema = graphicsSchema;
    if (graphics.length < before) log(`graphics: dropped ${before - graphics.length} card${before - graphics.length === 1 ? "" : "s"} that only repeated the hook`);
  }
  // Structure cards win their slots: a planned card within 6 s of one is dropped.
  const progressGraphics = graphics.filter((g) => g.type === "progress");
  const regularGraphics = graphics.filter((g) => g.type !== "progress");
  const allCards = [
    ...structureCards.map((g) => ({ ...g, version: g.version || 1 })),
    ...regularGraphics.filter((g) => !structureCards.some((s) => Math.abs(s.start - g.start) < Math.max(6, s.duration + 2))).map((g) => ({ ...g, version: g.version || sceneSchema })),
  ].sort((a, b) => a.start - b.start);
  const progress = progressGraphics.map((g) => ({ ...g, version: g.version || sceneSchema, pulses: (g.pulses || []).map((p) => ({ ...p, hidden: p.hidden || allCards.some((c) => p.at < c.start + c.duration && p.at + 1.4 > c.start) })) }));
  const allGraphics = [...allCards, ...progress].sort((a, b) => a.start - b.start);
  allGraphics.schema = graphicsSchema;
  // Shared-frame layouts never sit under a card. The legacy full cutaway keeps the short-reel exception unchanged.
  const sharedBrollLayout = ["window", "split", "mix"].includes(preset.broll?.layout);
  const brollArgs = { workDir, groups: shownGroups, duration, hook, cta, settings: preset.broll, force: !!opts.newBroll, busy: sharedBrollLayout || duration >= 20 ? allCards : [], tail };
  let broll = preset.broll?.enabled && shownGroups.length
    ? (preset.broll.engine === "runway" ? await makeRunwayBroll({ ...brollArgs, voice: readVoice({ style: preset }) }) : await makeBroll(brollArgs))
    : [];
  // Cutout layout: the generated still or clip remains the moving background; a window-matched person matte stays
  // registered over it. Each failed matte falls back to the established full-frame cutaway.
  if (brollLayout(preset.broll?.layout) === "cutout") {
    const cutoutBroll = await makeCutoutBroll({ broll, layout: preset.broll.layout, video: videoSrc, fps: preset.render.fps || 30, outDir: workDir });
    broll = cutoutBroll.broll;
    if (cutoutBroll.events.length) cutoutBroll.events.forEach((event) => log(event));
    else log("cutout b-roll: no cutaways to matte");
  }
  if (preset.zooms.enabled) {
    zooms = planZooms(shownGroups, duration - Math.max(0, tail - 1.5), { ...preset.zooms, busy: [...allCards, ...broll], hook, tight: tightFrame });
    log(`zooms: ${zooms.filter((z) => z.scale > 1).length} punch-in${zooms.filter((z) => z.scale > 1).length === 1 ? "" : "s"} on key lines${tightFrame ? " (tight frame, gentle)" : ""}${preset.zooms.style === "camera" ? ", camera move" : ""}`);
    if (preset.zooms.cadence?.enabled) {
      zooms = planCadence(shownGroups, duration, zooms, { ...preset.zooms.cadence, busy: broll, hook, tight: tightFrame, tail });
      log(`cadence: ${zooms.filter((z) => z.cut).length} jump cuts between the punch-ins`);
    }
    if (framing.multi) {
      const tl = await speakerTimeline(videoSrc, cleanWords, { duration, people: framing.people });
      const ox = parseFloat(framing.origin) / 100;
      zooms = aimZooms(zooms, { people: framing.people, base: framing.scale, originX: ox, at: tl?.at });
      log(tl ? `speakers: ${tl.turns.length} turn${tl.turns.length === 1 ? "" : "s"}, ${zooms.filter((z) => z.who != null).length} of ${zooms.filter((z) => z.scale > 1).length} punch-ins and cuts aimed at the person talking` : "speakers: could not tell who talks, zooms aim at the middle of the group");
    }
  }
  // Shared-frame b-roll is placed after zooms: each panel clears the whole head at the strongest move in its window.
  if (broll.length && ["window", "split", "mix"].includes(preset.broll?.layout)) {
    const placed = planBrollLayouts(broll, { layout: preset.broll.layout, W: canvas0.width, H: canvas0.height, captionTop, face: face || faceBox(detection), detection, zooms, framing });
    broll = placed.shots;
    placed.logs.forEach((line) => log(line));
    // "mix" marks some items as cutouts; matte just those.
    if (broll.some((b) => b.layout === "cutout")) {
      const cutoutBroll = await makeCutoutBroll({ broll, layout: preset.broll.layout, video: videoSrc, fps: preset.render.fps || 30, outDir: workDir });
      broll = cutoutBroll.broll;
      cutoutBroll.events.forEach((event) => log(event));
    }
  }
  // The hook never covers the head either: in front of the speaker (not the text-behind-you cutout) the page measures
  // the real hook text and shrinks it toward its top until it ends above this head top (at the opening push-in).
  if (hook && !behindPlan && detection && sameShape) {
    const head = zoomedHead(detection, 1.06);
    if (head) { hook.headTop = r3(head.top); hook.headBottom = r3(head.bottom); }
  }
  // Cold open: the first b-roll still holds under the hook for a beat before the speaker appears.
  const coldOpen = preset.coldOpen?.enabled && broll.length ? { duration: r3(Math.min(preset.coldOpen.duration || 0.6, Math.max(0.3, duration / 20))), src: broll[0].src, file: broll[0].file } : null;
  if (preset.coldOpen?.enabled) log(coldOpen ? `cold open: ${coldOpen.duration}s on the first still` : "cold open: no still to open on");
  // Climax words: the strongest gold words stamp in big as they are said, clear of the cards and cutaways.
  // The rail's visible pulses count as busy too: a slam word stamping in at the top would land on the rail.
  const railPulses = progress.flatMap((g) => (g.pulses || []).filter((p) => !p.hidden).map((p) => ({ start: p.at, duration: 1.4 })));
  let slams = preset.slams?.enabled && shownGroups.length ? planSlams(shownGroups, duration, { ...preset.slams, dict, hook, busy: [...allCards, ...broll, ...railPulses], zooms, tail, includeRank: !!preset.slams?.popout?.enabled }) : [];
  if (preset.slams?.enabled) log(`slams: ${slams.length} climax word${slams.length === 1 ? "" : "s"}${slams.length ? ": " + slams.map((sl) => `"${sl.text}" at ${sl.t}s`).join(", ") : ""}`);
  // Pop-out slams reuse the already-spaced slam plan: only its highest-ranked words pay the Vision cost.
  if (preset.slams?.popout?.enabled) {
    const originY = parseFloat(framing.origin.split(" ")[1]) / 100 || 0.38;
    const popouts = await makePopoutSlams({ slams, video: videoSrc, fps: preset.render.fps || 30, outDir: workDir, canvas: canvas0, settings: preset.slams.popout, framing, zoomDuring: (t0, t1) => zoomDuring(zooms, t0, t1), headTopFor: (sl) => cardHeadTop(detection, { zooms, t0: sl.t, t1: sl.end, scale: framing.scale, originY, shift: framing.shift || 0 }) });
    slams = popouts.slams;
    if (popouts.events.length) popouts.events.forEach((event) => log(event));
    else log(`pop-out slams: none ranked at least ${preset.slams.popout.minRank ?? 2.5}`);
  }

  // Motion accents live on inner wrappers, independent of the punch-in transform. Drift is planned from the final
  // zoom/cutaway lanes; bumps use the exact card and slam landing times.
  const bumpPlan = planBumps(allCards, slams, zooms, { ...preset.motion?.impact, broll, hook, duration, tail });
  const driftPlan = planDrift(zooms, broll, duration, { ...preset.motion?.drift, hook, tail, zoomStyle: preset.zooms.style });
  const motion = preset.motion?.impact?.enabled || preset.motion?.drift?.enabled ? { bumps: bumpPlan.bumps, drift: driftPlan.stretches } : null;
  if (preset.motion?.impact?.enabled) {
    const reasons = [["nearMove", "near a punch-in/jump cut"], ["cutaway", "under a cutaway"], ["hook", "under the hook"], ["tail", "in the clean tail"], ["spacing", "too close together"], ["cap", "over the cap"]].filter(([k]) => bumpPlan.skipped[k]).map(([k, s]) => `${bumpPlan.skipped[k]} ${s}`);
    log(`motion: ${bumpPlan.bumps.length} bump${bumpPlan.bumps.length === 1 ? "" : "s"}${reasons.length ? `; skipped ${reasons.join(", ")}` : ""}`);
  }
  if (preset.motion?.drift?.enabled) {
    const ranges = driftPlan.stretches.map((d) => `${d.start.toFixed(1)}s to ${d.end.toFixed(1)}s`).join(", ");
    const why = !driftPlan.stretches.length && driftPlan.skipped.short ? `; no gap reached ${preset.motion.drift.minGap}s` : driftPlan.skipped.cap ? `; ${driftPlan.skipped.cap} shorter stretch${driftPlan.skipped.cap === 1 ? "" : "es"} skipped by the cap` : "";
    log(`motion: drift on ${driftPlan.stretches.length} stretch${driftPlan.stretches.length === 1 ? "" : "es"}${ranges ? ` (${ranges})` : ""}${why}`);
  }

  // Cards never cover the head: drift multiplies the strongest punch-in in each card window, and the page drops
  // the footage just far enough below the card's real bottom edge (graphics.mjs headGuard).
  if (detection && sameShape) {
    const originY = parseFloat(framing.origin.split(" ")[1]) / 100 || 0.38;
    for (const g of allCards) {
      const top = cardHeadTop(detection, { zooms, drift: driftPlan.stretches, t0: g.start, t1: g.start + g.duration, scale: framing.scale, originY, shift: framing.shift || 0 });
      if (top != null) g.headTop = top;
    }
  }
  // Spoken icon pops use the final zoom lane and every finished busy window, including a 0.3 s guard around slams.
  let iconDetection = detection;
  if (preset.icons?.enabled && sameShape && shownGroups.length) {
    const times = [...new Set(iconCandidates(shownGroups).map((x) => x.t))];
    if (times.length) iconDetection = await detectFaces(videoSrc, times) || detection;
  }
  const icons = preset.icons?.enabled && shownGroups.length ? planIcons(shownGroups, duration, {
    ...preset.icons,
    hook,
    busy: [
      ...allCards.map((g) => ({ ...g, kind: "card" })),
      ...broll.map((b) => ({ ...b, kind: "cutaway" })),
      ...railPulses.map((p) => ({ ...p, kind: "rail pulse" })),
      ...slams.map((sl) => ({ start: sl.t, duration: sl.end - sl.t, pad: 0.3, kind: "slam" })),
    ],
    zooms,
    face: face || faceBox(iconDetection),
    detection: iconDetection,
    framing,
    W: canvas0.width,
    H: canvas0.height,
    captionTop,
    tail,
  }) : [];
  if (preset.icons?.enabled) {
    const skipped = Object.entries(icons.skipped || {}).map(([why, n]) => `${n} ${why}`).join(", ");
    log(`icons: ${icons.length} spoken pop${icons.length === 1 ? "" : "s"}${icons.length ? ": " + icons.map((x) => `"${x.word}" at ${x.t}s`).join(", ") : ""}${skipped ? `; skipped ${skipped}` : ""}`);
  }

  // 5. Audio extras
  const projectDir = path.join(workDir, "project");
  const lowerThird = preset.lowerThird?.enabled && preset.lowerThird.name ? { name: preset.lowerThird.name, handle: preset.lowerThird.handle || "", at: Math.min(preset.lowerThird.at ?? 4, Math.max(0, duration - 8)), duration: preset.lowerThird.duration ?? 5 } : null;
  const audio = await prepareAudio({ workDir, projectDir, preset, opts, duration, hook, zooms, words: cleanWords, transcript: shownGroups.map((g) => g.text).join(" "), cues: { zooms, graphics: allCards, slams, icons, broll, brollCut: preset.broll.cut, coldOpen, captions: shownGroups, annotate: !!preset.captions.annotate } });

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
    captions: showCaptions ? shownGroups : [],
    lines: shownGroups,
    zooms,
    graphics: allGraphics,
    graphicsSchema,
    scenes: { schema: sceneSchema },
    broll,
    slams,
    ...(motion ? { motion } : {}),
    icons,
    coldOpen,
    lowerThird,
    structure,
    framing: { ...framing, face, side: face ? (face.cx < 0.5 ? "right" : "left") : "right" },
    reframe,
    behind: behindPlan,
    head: (() => { const h = zoomedHead(detection, 1); return h ? { top: r3(h.top), bottom: r3(h.bottom) } : null; })(),
    audio,
    words: cleanWords,
  };
  writeJSON(path.join(workDir, "plan.json"), plan);
  writeFeatures(workDir, plan, { sceneSchema });
  composeProject(plan, projectDir);
  log(`project: ${projectDir} (edit ${path.join(workDir, "plan.json")} and run: reel build ${workDir})`);
  if (opts.noRender) return { workDir, plan };
  const output = await renderProject(workDir, opts);
  let cover = null;
  if (preset.cover?.enabled !== false && hook) {
    // The cover is the reel's own first frame (the cold-open still with the hook on it, or the speaker under the
    // hook); the designed Cover 1-3 set is behind cover.style "designed" (Greg: they were not turning out right).
    try {
      cover = preset.cover?.style === "designed"
        ? await makeCover(workDir, plan, { handle: preset.carousel?.handle || "" })
        : await frameCover(workDir, output, { at: preset.cover?.at ?? 0.05 });
    } catch (e) { warn(`cover skipped: ${String(e.message).split("\n")[0]}`); }
  }
  return { workDir, plan, output, cover };
}

/** Cover from the finished render: its first frame as covers/Cover.png and cover.png. */
async function frameCover(workDir, output, { at = 0.05 } = {}) {
  const dir = ensureDir(path.join(workDir, "covers"));
  for (const f of fs.readdirSync(dir)) if (/^Cover( \d+)?\.png$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const png = path.join(dir, "Cover.png");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(at), "-i", output, "-frames:v", "1", png], { quiet: true });
  fs.copyFileSync(png, path.join(workDir, "cover.png"));
  log(`cover: the first frame (${at}s) → ${png}`);
  return [png];
}

function readVoice(plan) {
  try { return fs.readFileSync(voiceFile(plan), "utf8"); } catch { return ""; }
}

async function prepareAudio({ workDir, projectDir, preset, opts, duration, hook, zooms, words = [], transcript = "", cues = null }) {
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

  if (preset.audio.sounds && cues) {
    const tracks = soundCues({ ...cues, markers: !!preset.audio.soundMarkers, level: preset.audio.soundsVolume ?? 0.3 }).filter((t) => t.start < duration - 0.2);
    audio.tracks.push(...tracks);
    log(`sounds: ${tracks.length ? describeCues(tracks) : "nothing to sound"}`);
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
    plan.icons = (plan.icons || []).filter((icon) => icon.t < D);
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
  writeFeatures(workDir, plan);
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
  // Preflight: sound, the open, dead air, length and layout checked on the finished file; preflight.txt sits next
  // to plan.json. With preflight.strict a failing file is kept as <name>.failed.mp4 and the run stops.
  const pf = plan.style?.preflight;
  if (pf?.enabled !== false && !opts.noPreflight) {
    try {
      const res = await runPreflight(output, { plan });
      // The render reviewer: Claude looks at frames of the finished file; what it sees joins the check note.
      if (plan.style?.review?.watch !== false && !opts.noReview) {
        const seen = await watchRender(output, plan, { workDir, duration: res.measures.duration });
        log(describeWatch(seen));
        const extra = watchItems(seen);
        if (extra.length) { res.items.push(...extra); if (res.status === "ok") res.status = "warn"; }
        if (!seen.error) res.viewer = seen.viewer;
      }
      writePreflight(workDir, res);
      (res.status === "fail" ? warn : log)(describePreflight(res));
      if (res.status === "fail" && pf?.strict) {
        const failed = output.replace(/\.mp4$/, ".failed.mp4");
        fs.renameSync(output, failed);
        throw new Error(`preflight failed (${res.items.filter((i) => i.level === "fail").map((i) => i.message).join("; ")}); the file is at ${failed}`);
      }
    } catch (e) {
      if (/^preflight failed/.test(e.message)) throw e;
      warn(`preflight skipped: ${String(e.message).split("\n")[0]}`);
    }
  }
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
