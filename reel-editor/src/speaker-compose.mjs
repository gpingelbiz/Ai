import fs from "node:fs";
import path from "node:path";
import { activeBox, letterboxCards } from "./speaker-look.mjs";
import { speakerCardsHTML, copyCardAssets } from "./speaker-cards.mjs";
import { captionFiles } from "./speaker-compile.mjs";
import { licensedMusic, speakerMusicLane } from "./speaker-music.mjs";
import { assertNoGreg } from "./speaker-intake.mjs";
import { esc } from "./text.mjs";
import { ensureDir, copyOrLink, PKG_ROOT, readJSON, writeJSON, run } from "./util.mjs";

const js = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

/** Small landscape composition: one untouched base, client cards and optional verbatim captions. */
export function speakerHTML(plan, { manifest, cards, cues = [], captions = false, music = null } = {}) {
  assertNoGreg({ plan, manifest, cards: { html: cards.html, css: cards.css, timeline: cards.timeline }, cues }, "speaker HTML");
  const D = plan.duration, { width, height, fps } = plan.canvas;
  const box = activeBox(plan.look?.letterbox, plan.canvas);
  if (width !== 1920 || height !== 1080 || fps !== 30) throw new Error("speaker composition requires 1920x1080 at 30 fps");
  cues = cues.map((cue) => ({ ...cue, start: Math.round(cue.start * fps) / fps, end: Math.min(D, Math.round(cue.end * fps) / fps) })).filter((cue) => cue.end > cue.start);
  const captionHTML = captions ? cues.map((cue, i) => `<div id="caption-${i}" class="speaker-caption clip" data-start="${cue.start}" data-duration="${cue.end - cue.start}" data-track-index="5">${esc(cue.text)}</div>`).join("\n") : "";
  const captionTimeline = captions ? cues.map((cue, i) => `tl.set("#caption-${i}",{autoAlpha:1},${cue.start});tl.set("#caption-${i}",{autoAlpha:0},${cue.end});`).join("\n") : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(manifest.identity.name)} speaker reel</title>
<script src="assets/vendor/gsap.min.js"></script><style>
${cards.css}
${box.y ? `.speaker-letterbox{position:absolute;left:0;width:${width}px;height:${box.y}px;background:#000;z-index:20;pointer-events:none}.speaker-letterbox.top{top:0}.speaker-letterbox.bottom{bottom:0}.speaker-caption{bottom:${box.y + box.height * 0.06}px!important}` : ""}
*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:var(--brand-surface)}
#root{position:relative;width:${width}px;height:${height}px;overflow:hidden}#footage{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.speaker-caption{position:absolute;left:15%;bottom:6%;width:70%;padding:12px 20px;white-space:pre-line;text-align:center;font:500 40px/1.25 var(--brand-body-font);color:var(--brand-ink);background:var(--brand-surface);opacity:0;visibility:hidden}
</style></head><body><div id="root" data-composition-id="speaker" data-start="0" data-width="${width}" data-height="${height}" data-duration="${D}" data-fps="${fps}">
<video id="footage" src="assets/base.mp4" data-start="0" data-duration="${D}" data-track-index="0" data-has-audio="true" playsinline></video>
${cards.html}
${captionHTML}
${box.y ? '<div class="speaker-letterbox top"></div><div class="speaker-letterbox bottom"></div>' : ""}
${music ? `<audio id="speaker-music" src="assets/music.wav" data-start="0" data-duration="${D}" data-track-index="6" data-automation="${esc(JSON.stringify({ version: 1, lanes: [{ target: "volume", points: music }] }))}"></audio>` : ""}
</div><script>const tl=gsap.timeline({paused:true});
${cards.timeline}
${captionTimeline}
tl.to({}, {duration:${D}}, 0);
window.__timelines=window.__timelines||{};window.__timelines["speaker"]=tl;
</script></body></html>`;
}

/** Compose only; orchestration renders, normalizes, checks and builds review after this succeeds. */
export async function composeSpeakerProject(workDir, resolvedPlan, { manifest, preset, tokens, captions, print = console.log, prepareMusic = run } = {}) {
  assertNoGreg({ resolvedPlan, manifest, preset, tokens }, "speaker composition");
  const folder = path.resolve(workDir, "../.."), base = path.join(workDir, "base.mp4");
  const projectDir = ensureDir(path.join(workDir, "project"));
  ensureDir(path.join(projectDir, "assets", "vendor"));
  const box = activeBox(resolvedPlan.look?.letterbox, resolvedPlan.canvas);
  const cards = await copyCardAssets(letterboxCards(speakerCardsHTML(resolvedPlan, { manifest, tokens, canvas: { ...resolvedPlan.canvas, activeBox: box }, clientDir: folder, log: print }), box, resolvedPlan), projectDir);
  for (const p of cards.problems) print(`WARNING ${p.code}: ${p.message}`);
  copyOrLink(base, path.join(projectDir, "assets", "base.mp4"));
  fs.copyFileSync(path.join(PKG_ROOT, "assets", "vendor", "gsap.min.js"), path.join(projectDir, "assets", "vendor", "gsap.min.js"));
  const words = readJSON(path.join(workDir, "words.json"));
  const captionData = captionFiles(words, resolvedPlan.duration);
  for (const ext of ["srt", "vtt"]) fs.writeFileSync(path.join(workDir, `captions.${ext}`), captionData[ext]);
  const warnings = [];
  const track = licensedMusic(folder, resolvedPlan, manifest, { print: (message) => { print(message); warnings.push({ level: "warn", id: "music", message }); } });
  let music = null;
  if (track) {
    music = speakerMusicLane(resolvedPlan, words);
    // Prepare one looped, loudness-matched asset. The frame lane alone controls section gain and protection.
    await prepareMusic("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "-1", "-i", track, "-t", String(resolvedPlan.duration), "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", path.join(projectDir, "assets", "music.wav")], { capture: true });
  }
  const burn = captions === true || resolvedPlan.captions === true || resolvedPlan.captions?.enabled === true;
  const html = speakerHTML(resolvedPlan, { manifest, cards, cues: captionData.cues, captions: burn, music });
  fs.writeFileSync(path.join(projectDir, "index.html"), html);
  writeJSON(path.join(workDir, "composition.json"), { schemaVersion: 1, activeBox: box, letterbox: resolvedPlan.look?.letterbox ?? null, captions: burn, cards: cards.review, music: track ? { file: resolvedPlan.music.file, points: music } : null });
  return { base, projectDir, html: path.join(projectDir, "index.html"), captions: burn, cards: cards.review, cardProblems: cards.problems, warnings };
}
