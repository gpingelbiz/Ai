import fs from "node:fs";
import path from "node:path";
import { activeBox, letterboxCards } from "./speaker-look.mjs";
import { speakerCardsHTML, copyCardAssets } from "./speaker-cards.mjs";
import { compileVersion, resolvePlan, captionFiles } from "./speaker-compile.mjs";
import { licensedMusic, speakerMusicLane, speakerMusicCues, speechBedWarnings } from "./speaker-music.mjs";
import { assertNoGreg } from "./speaker-intake.mjs";
import { esc } from "./text.mjs";
import { ensureDir, copyOrLink, PKG_ROOT, readJSON, writeJSON, run } from "./util.mjs";

import { speakerBeats, sectionBeatTimes, snapSpeakerPlan, layoutMontage, validateKeywords, motionProblems } from "./speaker-beats.mjs";
import { probeSource } from "./speaker-index.mjs";
import { measureLoudness } from "./preflight.mjs";

const js = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

/** Small landscape composition: one untouched base, client cards and optional verbatim captions. */
export function speakerHTML(plan, { manifest, cards, cues = [], captions = false, music = null, audioCues = [] } = {}) {
  assertNoGreg({ plan, manifest, cards: { html: cards.html, css: cards.css, timeline: cards.timeline }, cues }, "speaker HTML");
  const D = plan.duration, { width, height, fps } = plan.canvas;
  const box = activeBox(plan.look?.letterbox, plan.canvas);
  if (width !== 1920 || height !== 1080 || fps !== 30) throw new Error("speaker composition requires 1920x1080 at 30 fps");
  cues = cues.map((cue) => ({ ...cue, start: Math.round(cue.start * fps) / fps, end: Math.min(D, Math.round(cue.end * fps) / fps) })).filter((cue) => cue.end > cue.start);
  const motion = speakerMotionHTML(plan);
  const captionHTML = captions ? cues.map((cue, i) => `<div id="caption-${i}" class="speaker-caption clip" data-start="${cue.start}" data-duration="${cue.end - cue.start}" data-track-index="5">${esc(cue.text)}</div>`).join("\n") : "";
  const captionTimeline = captions ? cues.map((cue, i) => `tl.set("#caption-${i}",{autoAlpha:1},${cue.start});tl.set("#caption-${i}",{autoAlpha:0},${cue.end});`).join("\n") : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(manifest.identity.name)} speaker reel</title>
<script src="assets/vendor/gsap.min.js"></script><style>
${cards.css}
${motion.css}
${box.y ? `.speaker-letterbox{position:absolute;left:0;width:${width}px;height:${box.y}px;background:#000;z-index:20;pointer-events:none}.speaker-letterbox.top{top:0}.speaker-letterbox.bottom{bottom:0}.speaker-caption{bottom:${box.y + box.height * 0.06}px!important}` : ""}
*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:var(--brand-surface)}
#root{position:relative;width:${width}px;height:${height}px;overflow:hidden}#footage{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.speaker-caption{position:absolute;left:15%;bottom:6%;width:70%;padding:12px 20px;white-space:pre-line;text-align:center;font:500 40px/1.25 var(--brand-body-font);color:var(--brand-ink);background:var(--brand-surface);opacity:0;visibility:hidden}
</style></head><body><div id="root" data-composition-id="speaker" data-start="0" data-width="${width}" data-height="${height}" data-duration="${D}" data-fps="${fps}">
<video id="footage" src="assets/base.mp4" data-start="0" data-duration="${D}" data-track-index="0" data-has-audio="true" playsinline></video>
${cards.html}
${motion.html}
${box.y ? '<div class="speaker-letterbox top"></div><div class="speaker-letterbox bottom"></div>' : ""}
${captionHTML}
${audioCues.map((cue, n) => `<audio id="speaker-cue-${n}" src="${esc(cue.asset)}" data-start="0" data-duration="${D}" data-track-index="${6 + n}" data-automation="${esc(JSON.stringify({ version: 1, lanes: [{ target: "volume", points: cue.points }] }))}"></audio>`).join("\n")}
${music ? `<audio id="speaker-music" src="assets/music.wav" data-start="0" data-duration="${D}" data-track-index="6" data-automation="${esc(JSON.stringify({ version: 1, lanes: [{ target: "volume", points: music }] }))}"></audio>` : ""}
</div><script>const tl=gsap.timeline({paused:true});
${cards.timeline}
${motion.timeline}
${captionTimeline}
tl.to({}, {duration:${D}}, 0);
window.__timelines=window.__timelines||{};window.__timelines["speaker"]=tl;
</script></body></html>`;
}

/** Compose only; orchestration renders, normalizes, checks and builds review after this succeeds. */
export async function composeSpeakerProject(workDir, resolvedPlan, { manifest, preset, tokens, captions, print = console.log, prepareMusic = run, beatsImpl = speakerBeats, compileImpl = compileVersion, measureImpl = measureLoudness, probeAudio = probeSource } = {}) {
  assertNoGreg({ resolvedPlan, manifest, preset, tokens }, "speaker composition");
  const folder = path.resolve(workDir, "../.."), base = path.join(workDir, "base.mp4");
  const warnings = [], warning = (message) => { print(message); warnings.push({ level: "warn", id: "music", message }); };
  const licenses = licensedMusic(folder, resolvedPlan, manifest, { print: warning });
  const files = typeof licenses === "string" ? { main: licenses } : licenses || {};
  const metadata = new Map();
  const audioMeta = async (file, id) => {
    if (!metadata.has(file)) metadata.set(file, await probeAudio(file));
    const meta = metadata.get(file);
    if (!meta.hasAudio || !(meta.duration > 0)) throw new Error(`${id}: music/SFX file has no usable audio`);
    return meta;
  };
  if (resolvedPlan.music?.sections?.some((section) => section.snap === "beats")) {
    const sectionBeats = [];
    for (const section of resolvedPlan.music.sections.filter((s) => s.snap === "beats")) {
      const file = files[section.track || "main"];
      if (!file) { warning(`WARNING beats ${section.from}: licensed track unavailable; picture timing unchanged`); continue; }
      try {
        const beats = await beatsImpl(file, { indexDir: path.join(folder, "work/index") });
        if (!beats.length) throw new Error("no reliable beats detected");
        const start = resolvedPlan.items.find((i) => i.id === section.from).start;
        const end = resolvedPlan.items.find((i) => i.id === section.to).end;
        const meta = await audioMeta(file, section.from);
        sectionBeats.push({ section, beats: sectionBeatTimes(beats, { sourceStart: section.start || 0, outputStart: start, outputEnd: end, trackDuration: meta.duration }) });
      } catch (error) { warning(`WARNING beats ${section.from}: ${error.message.split("\n")[0]}; picture timing unchanged`); }
    }
    if (sectionBeats.length) {
      const index = readJSON(path.join(folder, "work/index/sources.json"));
      let adjusted = snapSpeakerPlan(resolvedPlan, sectionBeats, { index });
      // Resolve item changes before deriving montage offsets. The existing compiler owns all media handling.
      adjusted = resolvePlan(adjusted, { manifest, index, draft: true });
      const helperIds = new Set((adjusted.montage || []).map((m) => m.id));
      adjusted.cutaways = adjusted.cutaways.filter((x) => !helperIds.has(x.montageId));
      for (const montage of adjusted.montage || []) {
        const item = adjusted.items.find((i) => i.id === montage.over);
        const grid = sectionBeats.find(({ section }) => adjusted.items.find((i) => i.id === section.from).start <= item.start && adjusted.items.find((i) => i.id === section.to).end >= item.end);
        if (grid) adjusted.cutaways.push(...layoutMontage(montage, item, grid.beats));
      }
      const compiled = await compileImpl(folder, adjusted, { manifest, index, preset, tokens, draft: true, print });
      Object.assign(resolvedPlan, compiled.resolvedPlan);
    }
  }
  const words = readJSON(path.join(workDir, "words.json"));
  const keywordErrors = validateKeywords(resolvedPlan, words, manifest);
  const motionErrors = motionProblems(resolvedPlan, manifest);
  if (keywordErrors.length || motionErrors.length) throw new Error([...keywordErrors, ...motionErrors].map((p) => `${p.id}: ${p.message}`).join("\n"));
  const projectDir = ensureDir(path.join(workDir, "project"));
  ensureDir(path.join(projectDir, "assets", "vendor"));
  const box = activeBox(resolvedPlan.look?.letterbox, resolvedPlan.canvas);
  const cards = await copyCardAssets(letterboxCards(speakerCardsHTML(resolvedPlan, { manifest, tokens, canvas: { ...resolvedPlan.canvas, activeBox: box }, clientDir: folder, log: print }), box, resolvedPlan), projectDir);
  for (const p of cards.problems) print(`WARNING ${p.code}: ${p.message}`);
  copyOrLink(base, path.join(projectDir, "assets", "base.mp4"));
  fs.copyFileSync(path.join(PKG_ROOT, "assets", "vendor", "gsap.min.js"), path.join(projectDir, "assets", "vendor", "gsap.min.js"));
  for (const card of cards.review) if (card.type === "booking" && card.end - card.start < 6.6 - 1e-7) {
    const finding = { level: "warn", id: card.id, message: `${card.id}: reserve 6.6 seconds for six readable seconds after the name reveal` };
    warnings.push(finding); print(`WARNING ${finding.message}`);
  }
  const captionData = captionFiles(words, resolvedPlan.duration);
  for (const ext of ["srt", "vtt"]) fs.writeFileSync(path.join(workDir, `captions.${ext}`), captionData[ext]);
  let music = null;
  const audioCues = [];
  const advanced = Boolean(resolvedPlan.music?.tracks || resolvedPlan.music?.sections?.some((s) => s.gainDb == null || s.start != null || s.fadeIn != null || s.fadeOut != null || s.snap) || resolvedPlan.sfx?.length);
  if (advanced) {
    for (const [n, cue] of speakerMusicCues(resolvedPlan, words).entries()) {
      if (!files[cue.track]) continue;
      const meta = await audioMeta(files[cue.track], `music section ${cue.section.from}`);
      if (cue.start >= meta.duration) throw new Error(`music section ${cue.section.from}: start ${cue.start}s is past track duration ${meta.duration}s`);
      cue.asset = `assets/music-${n}.wav`;
      await prepareMusic("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "-1", "-ss", String(cue.start), "-i", files[cue.track], "-t", String(resolvedPlan.duration), "-vn", "-af", `atrim=duration=${cue.duration},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,asetpts=N/SR/TB,adelay=${Math.round(cue.outputStart * 48000)}S:all=1,apad,atrim=end_sample=${Math.round(resolvedPlan.duration * 48000)},asetpts=N/SR/TB`, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", path.join(projectDir, cue.asset)], { capture: true });
      audioCues.push(cue);
    }
    // Legacy QC reads music.file; the multi-track licensing guard still validates every listed track at final.
    if (resolvedPlan.music?.tracks?.length) resolvedPlan.music.file = resolvedPlan.music.tracks[0].file;
  } else if (files.main) {
    music = speakerMusicLane(resolvedPlan, words);
    await prepareMusic("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "-1", "-i", files.main, "-t", String(resolvedPlan.duration), "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", path.join(projectDir, "assets/music.wav")], { capture: true });
  }
  for (const [n, cue] of speakerSfxCues(resolvedPlan).entries()) {
    const file = files[`sfx:${cue.id || cue.file}`];
    if (!file) continue;
    const meta = await audioMeta(file, `SFX ${cue.id}`);
    if ((cue.start || 0) >= meta.duration) throw new Error(`SFX ${cue.id}: start is past file duration ${meta.duration}s`);
    cue.asset = `assets/sfx-${n}.wav`;
    await prepareMusic("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(cue.start || 0), "-i", file, "-vn", "-af", `atrim=duration=${cue.duration},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, cue.duration - 0.03)}:d=0.03,aresample=48000,asetpts=N/SR/TB,adelay=${Math.round(cue.outputStart * 48000)}S:all=1,apad,atrim=end_sample=${Math.round(resolvedPlan.duration * 48000)},asetpts=N/SR/TB`, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", path.join(projectDir, cue.asset)], { capture: true });
    audioCues.push(cue);
  }
  const bedCues = music ? [{ asset: "assets/music.wav", points: music }] : audioCues.filter((c) => c.section);
  if (bedCues.length && words.length) {
    try {
      const windows = await measureSpeechBed(base, projectDir, resolvedPlan, words, bedCues, { runImpl: prepareMusic, measureImpl });
      writeJSON(path.join(workDir, "music-qc.json"), { schemaVersion: 1, minimumLU: 8, windows });
      for (const finding of speechBedWarnings(windows)) { warnings.push(finding); print(`WARNING ${finding.message}`); }
    } catch (error) { warning(`WARNING music stem QC unavailable: ${error.message.split("\n")[0]}`); }
  }
  const burn = captions === true || resolvedPlan.captions === true || resolvedPlan.captions?.enabled === true;
  const html = speakerHTML(resolvedPlan, { manifest, cards, cues: captionData.cues, captions: burn, music, audioCues });
  fs.writeFileSync(path.join(projectDir, "index.html"), html);
  writeJSON(path.join(workDir, "composition.json"), { schemaVersion: 1, activeBox: box, letterbox: resolvedPlan.look?.letterbox ?? null, captions: burn, cards: cards.review, music: music ? { file: resolvedPlan.music.file, points: music } : audioCues, warnings });
  writeJSON(path.join(workDir, "plan.resolved.json"), resolvedPlan);
  return { base, projectDir, html: path.join(projectDir, "index.html"), captions: burn, cards: cards.review, cardProblems: cards.problems, warnings };
}

/** All effects use absolute frame times. Title masks finish at 18 frames and then hold. */
export function speakerMotionHTML(plan) {
  const fps = plan.canvas.fps, html = [], timeline = [];
  const entries = [...(plan.items || []).filter((i) => i.kind === "card"), ...(plan.overlays || [])];
  for (const [n, entry] of entries.entries()) if (["title", "booking"].includes(entry.card?.type)) {
    const start = entry.start ?? entry.outputStart;
    timeline.push(`tl.fromTo(${js(`#speaker-card-${n} .sc-name`)},{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:0.6,ease:"power2.out",immediateRender:false},${start});`);
  }
  for (const [n, item] of (plan.items || []).entries()) {
    const type = item.transition || "cut";
    if (type === "cut") continue;
    const boundary = item.start ?? item.outputStart;
    if (type === "whip") {
      timeline.push(`tl.fromTo("#footage",{x:0,filter:"blur(0px)"},{x:-96,filter:"blur(18px)",duration:${3 / fps},ease:"power2.in",immediateRender:false},${boundary - 3 / fps});\ntl.fromTo("#footage",{x:96,filter:"blur(18px)"},{x:0,filter:"blur(0px)",duration:${3 / fps},ease:"power2.out",immediateRender:false},${boundary});`);
    } else {
      const frames = type === "flash" ? 4 : 8, start = boundary - frames / 2 / fps, id = `speaker-transition-${n}`;
      html.push(`<div id="${id}" class="speaker-transition" style="background:${type === "flash" ? "white" : "var(--brand-surface)"}"></div>`);
      timeline.push(`tl.fromTo(${js(`#${id}`)},{autoAlpha:0},{autoAlpha:${type === "flash" ? 0.6 : 1},duration:${frames / 2 / fps},ease:"none",immediateRender:false},${start});\ntl.fromTo(${js(`#${id}`)},{autoAlpha:${type === "flash" ? 0.6 : 1}},{autoAlpha:0,duration:${frames / 2 / fps},ease:"none",immediateRender:false},${boundary});`);
    }
  }
  return { html: html.join("\n"), css: ".speaker-transition{position:absolute;inset:0;opacity:0;visibility:hidden;pointer-events:none;z-index:10}", timeline: timeline.join("\n") };
}

/** Effects can enter only at a card or transition, never overlap any protected item. */
export function speakerSfxCues(plan) {
  const fps = plan.canvas.fps, entries = [...plan.items, ...(plan.overlays || [])];
  return (plan.sfx || []).map((s) => {
    const target = entries.find((i) => i.id === s.at);
    if (!target || !(target.card || target.transition && target.transition !== "cut")) throw new Error(`SFX ${s.id}: needs a transition or card entry`);
    const outputStart = target.start ?? target.outputStart, duration = Math.round((s.duration ?? 0.6) * fps) / fps;
    const outputEnd = Math.min(plan.duration, outputStart + duration);
    if (plan.items.some((i) => i.protect && (i.start ?? i.outputStart) < outputEnd && (i.end ?? i.outputEnd) > outputStart)) throw new Error(`SFX ${s.id}: overlaps protected speech or reaction`);
    return { ...s, outputStart, duration: outputEnd - outputStart, points: [{ t: 0, v: 10 ** (s.gainDb / 20) }, { t: plan.duration, v: 10 ** (s.gainDb / 20) }] };
  });
}

/** Measure the real automated bed and dialogue over matching speech windows, including cue crossfades. */
export async function measureSpeechBed(base, projectDir, plan, words, cues, { runImpl = run, measureImpl = measureLoudness } = {}) {
  const dir = fs.mkdtempSync(path.join(projectDir, ".music-qc-")), sampleRate = 48000;
  const fds = [];
  try {
    for (const [n, cue] of cues.entries()) {
      const file = path.join(dir, `cue-${n}.f32`);
      await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(projectDir, cue.asset), "-ar", String(sampleRate), "-ac", "2", "-f", "f32le", file], { capture: true });
      fds.push(fs.openSync(file, "r"));
    }
    const bedFile = path.join(dir, "bed.f32"), output = fs.openSync(bedFile, "w");
    try {
      const count = Math.round(plan.duration * sampleRate) * 2, size = 16384;
      for (let offset = 0; offset < count; offset += size) {
        const samples = Math.min(size, count - offset), mixed = Buffer.alloc(samples * 4);
        for (const [n, cue] of cues.entries()) {
          const input = Buffer.alloc(samples * 4), available = fs.readSync(fds[n], input, 0, input.length, offset * 4);
          for (let i = 0; i * 4 < available; i++) {
            const t = (offset + i) / 2 / sampleRate, frame = t * plan.canvas.fps;
            const a = cue.points[Math.min(cue.points.length - 1, Math.floor(frame))], b = cue.points[Math.min(cue.points.length - 1, Math.floor(frame) + 1)];
            // Legacy lanes and cue lanes are both frame-sampled, including their final zero point.
            const gain = a.v + (b.v - a.v) * (frame - Math.floor(frame));
            mixed.writeFloatLE(mixed.readFloatLE(i * 4) + input.readFloatLE(i * 4) * gain, i * 4);
          }
        }
        fs.writeSync(output, mixed);
      }
    } finally { fs.closeSync(output); }
    const windows = [];
    for (const item of plan.items.filter((i) => i.kind === "clip" && i.audio !== "mute")) {
      const spoken = words.filter((w) => (w.itemId === item.id || !w.itemId && w.sourceId === item.sourceId) && w.end > item.start && w.start < item.end);
      if (!spoken.length) continue;
      const start = Math.max(item.start, Math.min(...spoken.map((w) => w.start))), end = Math.min(item.end, Math.max(...spoken.map((w) => w.end)));
      if (end - start < 0.4 || !cues.some((c) => c.points.some((p) => p.t >= start && p.t < end && p.v > 0))) continue;
      const dialogue = path.join(dir, "speech.wav"), bed = path.join(dir, "bed.wav");
      await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(start), "-i", base, "-t", String(end - start), "-vn", "-c:a", "pcm_s16le", dialogue], { capture: true });
      await runImpl("ffmpeg", ["-y", "-loglevel", "error", "-f", "f32le", "-ar", String(sampleRate), "-ac", "2", "-ss", String(start), "-i", bedFile, "-t", String(end - start), "-c:a", "pcm_s16le", bed], { capture: true });
      const speechLevel = await measureImpl(dialogue), bedLevel = await measureImpl(bed);
      windows.push({ itemId: item.id, start, end, speechLUFS: speechLevel.i, bedLUFS: bedLevel.i });
    }
    return windows;
  } finally {
    for (const fd of fds) fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
