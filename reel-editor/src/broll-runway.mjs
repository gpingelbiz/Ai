import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { claudeText, claudeLook, firstJSON, hasClaude } from "./claude.mjs";
import { brollCount, brollCandidates, checkPick, subjectWords, spokenInShot, readRecent, rememberScenes, uniqueScenes } from "./broll.mjs";
import { subjectMotion, contactSheet, validTimeline, eventInPoint, phonePreviews, localClipCheck, verifySound } from "./broll-qc.mjs";
import { norm } from "./text.mjs";
import { CREDIT_USD, dataURI, failurePolicy, hasRunway, makeClip, animateStill, estimateClip, organization, fitPrompt, modelInfo, makeSound } from "./runway.mjs";
import { recordUsage, reelUsageNote } from "./usage.mjs";
import { log, warn, readJSON, writeJSON, ensureDir, run, r3 } from "./util.mjs";
import { findLibraryClip, saveLibraryClip, writeBrollCredits } from "./broll-library.mjs";

export const PROMPT_VERSION = "literal-video-v6";

/** Stable across retries; a new prompt version intentionally starts a new comparison. */
export function shotSeed(workDir, line) {
  return createHash("sha256").update(`${path.basename(workDir)}|${line}|${PROMPT_VERSION}`).digest().readUInt32BE(0);
}

export function shotModels(pick, settings = {}) {
  const kind = pick.kind === "ambient" ? "ambient" : "action";
  const imageModel = settings.imageModel || "gen4_image";
  const videoModel = kind === "action" ? settings.actionVideoModel || settings.videoModel || "gen4_turbo" : settings.videoModel || "gen4_turbo";
  const info = modelInfo(videoModel, "video");
  const seconds = Math.max(info.duration[0], Math.min(info.duration[1], Math.round(settings.videoSeconds ?? 5)));
  return { kind, imageModel, videoModel, seconds, audio: false, lastFrame: !!(kind === "action" && settings.lastFrame && pick.endScene && info.fields.lastFrame) };
}

/**
 * B-roll as generated video: Claude picks the lines and writes each literal scene plus one line of camera
 * motion; Runway draws the still, Claude checks it, then Runway animates it into a short clip. Every
 * generation is recorded in the usage ledger, the reel gets a "runway usage.txt", and a per-reel credit cap
 * and the account balance are checked before anything is bought.
 */

/** Selection and field meanings shared by both first-frame engines. */
export const PICKS_RULES = `Choose only moments where a picture makes these exact words clearer,
demonstrates something useful or completes the joke.
Preserve Greg's reactions, conviction, personal admissions and final
instruction. Respect the supplied hook boundaries.

Every scene comes from this reel's words or its own established setting.
Show named objects, animals and places literally, including analogies.
A jungle stays a jungle; a snake stays a snake; a coconut stays a coconut.
Never replace the subject with another metaphor or a brand-world prop.
Skip abstract lines unless a specific picture makes them clearer.

endsAt: {line, wordIndex, text} identifies the LAST payoff word of the spoken idea, inclusive.
Use zero-based wordIndex within that caption line; text is that exact word.
endsBefore: {line, wordIndex, text} identifies the first unrelated word, exclusive.
Both boundaries must come from the supplied timed words. Include the whole payoff,
for example coconut just hits me in the head, then return to Greg.
sequenceGroup: Optional shared name ONLY for a rapid list of at least three named images,
such as a snake, an ape, a lion. Use 0.8–1.2 second shots and gap 0 inside that list.
Otherwise omit sequenceGroup and use the ordinary duration and spacing.
soundRole: "impact", "movement" or "none". Only describe visible physical sound; omit ambience.

Read every word covered by the proposed shot and the neighbouring phrases.
Start on the named word. End before an unrelated idea begins.

Each candidate has these fields:

kind: "action" when the named thing must do something that finishes,
such as a coconut dropping and landing. "ambient" for a place or gentle
continuous movement, such as leaves swaying in a jungle clearing.

endScene: For an action, describe the same subject and setting after the
event finishes, such as the same coconut resting on the sand below the ledge.
Preserve its appearance and identity from the opening scene.

sound: Optional short positive description of a real physical sound,
such as "a coconut thuds onto soft sand". Include only for an impact or
clear physical sound. Ambient shots usually omit this field.

line: An available caption-line number containing the first anchor word.

shows: One to three exact spoken words naming the visible subject: the noun itself, no article or verb ("snake", "coconut", "two by four").
A phrase may continue into the immediately following caption.
Preserve the phrase exactly and anchor its first word.

duration: This shot's useful screen time, independently chosen between
1.2 and MAX_DURATION seconds. Fit one readable event inside the relevant words.
Never extend a picture merely to fill a standard slot.

scene: A compact opening-image prompt using this house order:
photographic framing and angle; named subject and literal setting;
opening physical position and space for the event; light and colour;
useful focus and portrait composition.
The named subject is recognizable in the opening frame and big: it fills at least a third of the frame height.
Stage it ready for the event.
For this daylight reel, use natural daylight, believable colour,
readable shadows and ordinary phone-camera perspective.
Keep the complete action area visible and important details above captions.

action: One concrete, harmless physical event involving the named subject.
It begins immediately and visibly happens within the first second.
Describe direction and a readable result.
For action picks, camera movement, changing light and drifting atmosphere alone do not count.

motion: One simple camera instruction. Default: "Locked camera."
Use a camera move only for a place reveal or travel.

Write scene, action and motion entirely as positive descriptions.
Put exclusions in these planning rules, never in generation fields.

Safety and selection:
Exclude faces, real-person likenesses, readable text, numbers, labels,
logos and invented evidence.
Weapon lines stay on the speaker, including a knife or a two by four.
Exclude attacks, threats, distress, injury and weapon use against anyone.
Exclude hanging ropes or loops, neck contact, noose-like compositions,
self-harm and death associations.
Judge the picture together with overlapping and neighbouring words.
For dangerous spoken actions, choose harmless behaviour by the SAME
named subject only when the combined reading stays safe.
Otherwise leave Greg visible. Never substitute an unrelated object.

Use one physical event, one location and one camera instruction.
Keep the assembled Runway prompts under 1,000 JavaScript string units.`;

export const PICKS_REPLY = '{"picks":[{"endsAt":{"line":N,"wordIndex":I,"text":"..."},"endsBefore":{"line":N,"wordIndex":I,"text":"..."},"line":N,"shows":"...","duration":S,"kind":"action","scene":"...","endScene":"...","action":"...","motion":"...","soundRole":"impact","sound":"..."}]}';

export function runwayPicksPrompt({ candidates, transcript, hook, count, spacing = 8, style = "", recent = [], duration = 2.4, world = "", instructions = "Reply with JSON only. Use no tools.", reply = PICKS_REPLY }) {
  return `You are choosing short moving cutaways for Greg's talking-head reel.
${instructions}

Read the whole passage first. Understand its story, setting, analogy,
joke and lesson before choosing pictures.

Return up to ${count + 2} useful candidates, ranked strongest first.
The editor may use at most ${count}. Fewer candidates, including zero,
are correct. Nearby alternatives may compete for one slot.
Accepted shots require ${spacing} seconds from one shot's END to the next START.

${PICKS_RULES.replace("MAX_DURATION", String(Math.min(2.5, duration)))}
${world ? `The speaker's world (only for lines about their own life and work; never use it to replace an image they name; the named thing wins): ${world}` : ""}
${style ? `Optional visual style: ${style}` : ""}
${recent.length ? `Recent scenes are visual references only. Never skip a named subject because a recent reel showed it. Show the same subject from a different angle, setting or action. The library's 10-reel exclusion applies per clip, never per subject:\n${uniqueScenes(recent).slice(-12).map((s) => `- ${s}`).join("\n")}` : ""}

Hook:
${hook || "(none)"}

Whole passage:
${transcript || ""}

Available caption lines and times:
${candidates.map((c) => `${c.i}: ${c.start.toFixed(1)}s ${c.text} | words: ${JSON.stringify(c.words || [])}`).join("\n")}

Reply exactly in this shape, ranked strongest first:
${reply}`;
}

/** Start on an exact subject phrase, which may finish in the next caption. */
export function runwayTiming(pick, candidate, groups, { len = 2.4, until = Infinity, busy = [], clear = 1.5 } = {}) {
  const words = (s) => String(s || "").split(/\s+/).map(norm).filter(Boolean);
  const subject = subjectWords(pick.shows, pick.scene), line = words(candidate.text);
  if (!subject.length) return null;
  const joined = [...line, ...words(groups[candidate.i + 1]?.text)];
  const anchor = line.findIndex((_, i) => subject.every((w, k) => joined[i + k] === w));
  if (anchor < 0) return null;
  const word = candidate.words?.filter((w) => norm(w.text))[anchor];
  if (candidate.words?.length && !word) return null;
  const start = word?.start ?? candidate.start;
  const requested = Number.isFinite(pick.duration) ? pick.duration : len;
  const card = Math.min(...busy.filter((b) => b.start + b.duration + clear > start).map((b) => b.start - clear), Infinity);
  const minimum = pick.rapidList ? 0.8 : 1.2;
  const boundary = (ref, inclusive) => {
    if (!ref) return Infinity;
    const w = groups[ref.line]?.words?.[ref.wordIndex];
    return w && norm(w.text) === norm(ref.text) && (inclusive ? w.end : w.start) >= start ? (inclusive ? w.end : w.start) : NaN;
  };
  const ideaEnd = boundary(pick.endsAt, true), unrelated = boundary(pick.endsBefore, false);
  if (Number.isNaN(ideaEnd) || Number.isNaN(unrelated) || ideaEnd > unrelated) return null;
  const end = Math.min(start + Math.max(minimum, Math.min(pick.rapidList ? 1.2 : len, requested)), ideaEnd, unrelated, until, card);
  const duration = end - start;
  if (duration < minimum - 0.000001) return null;
  return { start, duration };
}

/** Rank chooses the shots; neighbouring accepted shots can shorten a cutaway down to 1.2 seconds. */
export function placeRunwayBroll(picks, candidates, { max = 3, gap = 3, timing }) {
  if (max <= 0) return [];
  const shots = [];
  for (const p of picks) {
    const c = candidates.find((c) => c.i === p.line), t = c && timing(p, c);
    if (!t || shots.some((s) => s.line === p.line)) continue;
    const next = shots.filter((s) => s.start >= t.start).sort((a, b) => a.start - b.start)[0];
    const nextGap = next && p.rapidList && p.sequenceGroup === next.sequenceGroup ? 0 : gap;
    const duration = Math.min(t.duration, next ? next.start - nextGap - t.start : Infinity);
    const prev = shots.filter((s) => s.start < t.start).sort((a, b) => b.start - a.start)[0];
    const prevDuration = prev ? Math.min(prev.duration, t.start - (p.rapidList && p.sequenceGroup === prev.sequenceGroup ? 0 : gap) - prev.start) : Infinity;
    if (duration < (p.rapidList ? 0.8 : 1.2) - 0.000001 || prevDuration < (prev?.rapidList ? 0.8 : 1.2) - 0.000001) continue;
    if (prev) prev.duration = r3(prevDuration);
    shots.push({ rapidList: !!p.rapidList, ...(p.sequenceGroup ? { sequenceGroup: p.sequenceGroup } : {}), line: p.line, start: r3(t.start), duration: r3(duration), text: c.text, scene: String(p.scene).trim(), shows: p.shows, rank: p.rank });
    if (shots.length >= max) break;
  }
  return shots.sort((a, b) => a.start - b.start);
}

export const STILL_STYLE = "Natural daylight and colour, readable shadows, complete action area, simple lower caption area.";

/** Keep exclusions in the planner and checks, outside Runway's generation prose. */
export function positiveDescription(value, fallback = "") {
  const text = (String(value || "").match(/[^.!?;,]+[.!?;,]?/g) || []).map((s) => s.trim())
    .filter((s) => s && !/\b(no|not|never|without|avoid|don't|don’t|cannot|can't|can’t|exclude|excluding|neither|nor)\b/i.test(s)).join(" ").replace(/[;,]$/, ".");
  return text ? /[.!?]$/.test(text) ? text : `${text}.` : fallback;
}

export function stillPrompt(pick) {
  const scene = positiveDescription(pick.scene);
  if (!scene) throw new Error("still opening scene missing");
  return fitPrompt(`${scene} Vertical photograph. ${STILL_STYLE}`, { optionalStyle: STILL_STYLE });
}

/** The still supplies appearance; the video supplies one immediate physical event. */
export function videoMotion(pick, { retry = false, correction = "", soften = false } = {}) {
  const action = positiveDescription(pick.action, `${positiveDescription(pick.shows, "The subject.").replace(/\.$/, "")} moves.`);
  const brief = `${pick.scene || ""} ${action} ${positiveDescription(pick.motion)}`;
  const placeReveal = /\breveal(?:s|ing)?\b/i.test(positiveDescription(pick.motion)) && /\b(place|jungle|clearing|forest|path|road|street|destination|city|valley|room|beach|landscape)\b/i.test(brief);
  const moving = placeReveal || /\btravel(?:s|ling|ing)?\b/i.test(brief);
  const camera = !retry && moving ? positiveDescription(pick.motion, "Locked camera.") : "Locked camera.";
  return fitPrompt(`${soften ? "A gentle, harmless movement. " : ""}${action} Real-time movement beginning immediately. ${camera}${correction ? ` Correction: ${motionCorrection(pick, correction)}` : ""}`);
}

/** Mean absolute pixel change between quarter-second samples, on an 8-bit grey 64 x 64 picture. */
export function frameChange(pixels, size = 64 * 64) {
  const frames = Math.floor(pixels.length / size);
  if (frames < 2 || pixels.length % size) throw new Error("not enough complete motion samples");
  let change = 0;
  for (let i = size; i < pixels.length; i++) change += Math.abs(pixels[i] - pixels[i - size]);
  return { mean: change / ((frames - 1) * size), frames };
}

export async function measureMotion(file, duration, { runFn = run, dir = path.dirname(file) } = {}) {
  const tmp = fs.mkdtempSync(path.join(dir, "motion-"));
  try {
    const raw = path.join(tmp, "frames.gray");
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-t", String(duration), "-i", file, "-vf", "fps=8,scale=64:64,format=gray", "-f", "rawvideo", raw], { quiet: true });
    return subjectMotion(fs.readFileSync(raw));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** Find the first above-median change, leaving a short readable opening and room for the shot. */
export function actionInPoint(pixels, duration, clipDuration, { size = 64 * 64, fps = 8 } = {}) {
  frameChange(pixels, size);
  if (clipDuration < duration) return 0;
  const changes = [];
  for (let at = size; at < pixels.length; at += size) {
    let change = 0;
    for (let i = 0; i < size; i++) change += Math.abs(pixels[at + i] - pixels[at + i - size]);
    changes.push(change / size);
  }
  const sorted = [...changes].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const first = changes.findIndex((c) => c > median);
  return first < 0 ? 0 : Math.max(0, Math.min((first + 1) / fps - 0.15, clipDuration - duration));
}

/** Keep the full download and render/check the same selected action interval. */
export async function trimRunwayClip(file, duration, { runFn = run, dir = path.dirname(file), timeline, inPoint: chosen } = {}) {
  const full = file.replace(/\.mp4$/i, ".full.mp4");
  if (!fs.existsSync(full)) fs.renameSync(file, full);
  const tmp = fs.mkdtempSync(path.join(dir, "action-"));
  try {
    const probe = await runFn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", full], { capture: true });
    const clipDuration = Number(probe.out?.trim());
    if (!(clipDuration > 0)) throw new Error("clip duration unavailable");
    const raw = path.join(tmp, "frames.gray");
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-i", full, "-vf", "fps=8,scale=64:64,format=gray", "-f", "rawvideo", raw], { quiet: true });
    const inPoint = chosen ?? eventInPoint(timeline, duration, clipDuration, actionInPoint(fs.readFileSync(raw), duration, clipDuration));
    if (inPoint === null) throw Object.assign(new Error("complete event cannot fit spoken interval"), { code: "EVENT_WINDOW" });
    await runFn("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(inPoint), "-i", full, "-t", String(duration), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-r", "30", "-g", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { quiet: true });
    return { inPoint, full };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const neighbouringWords = (shot, groups) => {
  const after = groups.findIndex((g) => g.start > shot.start);
  const first = after < 0 ? groups.length - 1 : Math.max(0, after - 1);
  const end = groups.findIndex((g) => g.start >= shot.start + shot.duration);
  return groups.slice(Math.max(0, first - 1), end < 0 ? groups.length : end + 1).map((g) => g.text).join(" ");
};

export const stillOpenPrompt = (file) => `Inspect ${JSON.stringify(file)}.
Describe only what is visibly present: the main object or animal,
its position, surroundings and lighting. Do not guess intended meaning.
Reply JSON only: {"seen":"..."}`;

export function stillCheckPrompt({ file, seen, pick, shot, groups }) {
  return `Inspect ${JSON.stringify(file)}. Your independent description was ${JSON.stringify(seen)}.

Required subject: ${JSON.stringify(pick.shows)}.
Required next event: ${JSON.stringify(pick.action)}.
Overlapping captions and spoken words: ${JSON.stringify(spokenInShot(shot, groups, { len: shot.duration }))}.
Immediately neighbouring words: ${JSON.stringify(neighbouringWords(shot, groups))}.

Does the picture unmistakably show the required subject at phone size?
Is it intact, suitably lit and positioned for the event?
The supplied 360x640 previews show the actual caption lines or a reserved caption band.
Is the subject at least a third of the frame height, with clear head/detail and body thickness?
Is the complete action area visible above the actual captions?
Require detailReadable=true, actionAreaVisible=true, captionOcclusion=false and subjectLarge=true.
Check faces, readable lettering, labels and invented evidence.

Could this picture together with those words suggest a noose,
self-harm, death, an attack, weapon use against someone,
or anyone threatened or hurt?

Set shows=false for ambiguity, unsuitable framing, unwanted faces
or lettering, damaged anatomy, or uncertainty.
Set dark=true for a dangerous association.
Reply JSON only:
{"shows":true|false,"dark":true|false,"detailReadable":true|false,"actionAreaVisible":true|false,"captionOcclusion":true|false,"subjectLarge":true|false,"why":"..."}`;
}

export const clipOpenPrompt = (frames, sheet) => `Inspect the timestamped contact sheet ${JSON.stringify(sheet)} in row-major time order.
Frames: ${frames.map((f) => `${f.time}s`).join(", ")}.
Describe only the visible subject and physical changes. Distinguish subject movement from camera movement.
State uncertainty. Reply JSON only: {"seen":"..."}`;

export function clipCheckPrompt({ seen, frames, sheet, pick, shot, groups, inPoint = 0 }) {
  return `Used source interval: ${inPoint} to ${inPoint + shot.duration}.
Inspect the one contact sheet ${JSON.stringify(sheet)}, frames in row-major order at ${frames.map((f) => f.time).join(", ")} seconds.
Independent description: ${JSON.stringify(seen)}.
Required subject: ${JSON.stringify(pick.shows)}.
Required physical event: ${JSON.stringify(pick.action)}.
Shot kind: ${pick.kind || "action"}. Ambient shots need sustained subject motion.
Overlapping words and captions: ${JSON.stringify(spokenInShot(shot, groups, { len: shot.duration }))}.
Neighbouring words: ${JSON.stringify(neighbouringWords(shot, groups))}.
Is the same subject intact and recognizable throughout these frames?
Does its position or state change relative to the background, establishing the required event inside this interval?
Camera movement and lighting alone do not count. Identify event onset, first contact/landing (null if inapplicable),
and completion/settle, in SECONDS RELATIVE TO THE FIRST FRAME (0), not absolute source time.
Explicitly inspect rings, smears, extra limbs, disappearing parts, morphing, pass-through contact,
and objects hopping upward against gravity before contact. Natural sand displacement and motion blur are allowed.
Reject any artifact, implausible direction or uncertain identity/action. A bounce AFTER contact is allowed.
Check human faces and readable lettering. Animal faces are allowed.
Could any frame with these words suggest a noose, self-harm, death, an attack, weapon use or anyone hurt?
Name specific defects and give a positive corrective instruction in correction.
Reply JSON only:
{"shows":true|false,"action":true|false,"dark":true|false,"physicsPlausible":true|false,"identityStable":true|false,"artifacts":true|false,"directionPlausible":true|false,"humanFaces":true|false,"readableText":true|false,"onset":S,"contact":S|null,"completion":S,"defects":["..."],"correction":"...","why":"..."}`;
}

export function motionCorrection(pick, defect) {
  const subject = positiveDescription(pick.shows).replace(/\.$/, "");
  if (/upward|hop|gravity|rises/.test(defect.toLowerCase())) return `The ${subject} falls downward from its support, lands naturally and settles.`;
  if (/frozen|late|inactive|stationary/.test(defect.toLowerCase())) return `The ${subject} begins the requested movement immediately and completes it promptly.`;
  if (/ring|smear|morph|limb|shape/.test(defect.toLowerCase())) return `The ${subject} retains its original shape and natural surface throughout movement and contact.`;
  return positiveDescription(defect, `The ${subject} performs the requested event clearly and continuously.`);
}

/** A claimed sequence is allowed only when the transcript actually contains a rapid noun list. */
export function rapidListPicks(picks, candidates, groups) {
  const result = picks.map((p) => ({ ...p, rapidList: false }));
  for (const name of new Set(picks.map((p) => p.sequenceGroup).filter(Boolean))) {
    const list = result.filter((p) => p.sequenceGroup === name).map((p) => {
      const c = candidates.find((c) => c.i === p.line);
      return { p, t: c && runwayTiming({ ...p, rapidList: true }, c, groups) };
    }).sort((a, b) => (a.t?.start ?? Infinity) - (b.t?.start ?? Infinity));
    if (list.length < 3 || list.some((x) => !x.t)) continue;
    const words = groups.flatMap((g) => g.words || []);
    const valid = list.slice(1).every((item, i) => {
      const prev = list[i], delta = item.t.start - prev.t.start;
      const between = words.filter((w) => w.start >= prev.t.start && w.start < item.t.start).map((w) => norm(w.text));
      const subject = subjectWords(prev.p.shows, prev.p.scene);
      return delta >= 0.8 && delta <= 1.2 && between.length && between.slice(subject.length).every((w) => ["a", "an", "the", "and", "or"].includes(w));
    });
    if (valid) list.forEach(({ p }) => { p.rapidList = true; });
  }
  return result;
}

/** Validate and rank the same spoken ideas for either first-frame engine. */
export function validateBrollPicks(picks, candidates, groups, timing, settings = {}) {
  const ranked = picks.map((p, i) => ({ ...p, rank: i + 1 }));
  const planned = settings.rapidLists === false ? ranked : rapidListPicks(ranked, candidates, groups);
  return planned.filter((p) => {
    const c = candidates.find((c) => c.i === p.line), t = c && timing(p, c);
    const why = !p.endsAt || !p.endsBefore ? "missing spoken idea boundaries" : !t ? "no room for this subject" : checkPick(p, { ...c, start: t.start }, groups, { len: t.duration });
    if (why) warn(`b-roll: rejected line ${p.line}: ${why}`);
    return !why;
  });
}

/** Every named candidate bounds the preceding shot, even when spacing removes that candidate. */
export function placePlannedBroll(picks, candidates, { gap, max, timing }) {
  const boundedTiming = (p, c) => {
    const t = timing(p, c);
    if (!t) return null;
    const next = Math.min(...picks.filter((q) => q !== p).map((q) => { const c = candidates.find((c) => c.i === q.line); return c && timing(q, c)?.start; }).filter((start) => start > t.start), Infinity);
    const duration = Math.min(t.duration, next - t.start);
    return duration >= (p.rapidList ? 0.8 : 1.2) - 0.000001 ? { start: t.start, duration } : null;
  };
  return placeRunwayBroll(picks, candidates, { gap, max, timing: boundedTiming });
}

/** Retry unavailable vision once; a valid negative answer is final. */
async function lookJSON(prompt, valid, look, dir) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = firstJSON(await look(prompt, { cwd: dir, timeoutMs: 180000 }));
      if (!valid(result)) throw new Error("invalid vision reply");
      return result;
    } catch (e) { if (attempt) throw e; }
  }
}
const hasSeen = (r) => typeof r.seen === "string" && !!r.seen.trim();
const hasBools = (fields) => (r) => fields.every((f) => typeof r[f] === "boolean");

/** A moving camera alone is insufficient: the named subject and its action must survive the used part. */
export async function checkRunwayVideo({ file, shot, pick, groups, inPoint = 0, dir = path.dirname(file), threshold = 1, deps = {} }) {
  const runner = deps.runFn || run, look = deps.claudeLook || claudeLook;
  const evidence = fs.mkdtempSync(path.join(dir, "clip-check-"));
  try {
    const motion = await measureMotion(file, shot.duration, { runFn: runner, dir: evidence });
    const { frames, sheet } = await contactSheet(file, shot.duration, { dir: evidence, peakTime: motion.peakTime, inPoint, runFn: runner });
    const relativeSheet = path.relative(dir, sheet);
    const open = await lookJSON(clipOpenPrompt(frames, relativeSheet), hasSeen, look, dir);
    const result = await lookJSON(clipCheckPrompt({ seen: open.seen, frames, sheet: relativeSheet, pick, shot, groups, inPoint }), (r) => validTimeline(r, shot.duration), look, dir);
    const frozen = motion.mean < threshold;
    const contactRequired = /\b(drop|drops|fall|falls|land|lands|hit|hits|impact)\b/i.test(pick.action || "");
    const ok = (!contactRequired || result.contact !== null) && !frozen && result.shows && result.action && !result.dark && result.physicsPlausible && result.identityStable && !result.artifacts && result.directionPlausible && !result.humanFaces && !result.readableText;
    let local;
    if (ok) local = await (deps.localClipCheck || localClipCheck)(frames, { dir, runFn: runner, look, pick });
    const verdict = { ...result, look: "pass", motion, frames, sheet, local, ok: ok && local?.ok === true, why: frozen ? "frozen clip after background compensation" : local?.ok === false ? local.why : `${result.why || "event inspected"}; ${result.defects.join("; ")}` };
    writeJSON(path.join(evidence, "verdict.json"), verdict);
    return verdict;
  } catch (e) {
    const verdict = { ok: false, unavailable: true, look: "unavailable", why: `video verification unavailable after retry: ${String(e.message).split("\n")[0]}`, evidence };
    writeJSON(path.join(evidence, "verdict.json"), verdict);
    return verdict;
  }
}

export function planShotBudget(pick, duration, settings = {}) {
  const models = shotModels(pick, settings);
  const initial = estimateClip({ ...models, imageRatio: settings.imageRatio, sfxSeconds: hasPhysicalSound(pick, settings) ? Math.max(1, duration) : 0 });
  if (settings.stillSource === "codex") { initial.credits -= initial.image + (initial.endImage || 0); initial.image = 0; delete initial.endImage; initial.dollars = r3(initial.credits * CREDIT_USD); }
  const retryModel = settings.retrySameModelFirst === false ? settings.retryVideoModel || models.videoModel : models.videoModel;
  const retrySeconds = Math.max(modelInfo(retryModel).duration[0], models.seconds);
  const retry = estimateClip({ seconds: retrySeconds, videoModel: retryModel }).video;
  return { ...initial, retry, reserve: initial.credits + initial.image + retry };
}

export function hasPhysicalSound(pick, settings = {}) {
  return !!(settings.sfx && pick.kind !== "ambient" && pick.sound && (pick.soundRole === "impact" || pick.soundRole === "movement"));
}

export async function makeRunwayBroll({ workDir, groups, duration, hook, cta, settings = {}, force = false, busy = [], tail = 1, footage, caption = {}, stillSource = "runway", deps = {} }) {
  const dir = ensureDir(path.join(workDir, "broll")), planPath = path.join(dir, "broll.json");
  const seconds = Math.max(2, Math.min(10, Math.round(settings.videoSeconds ?? 5)));
  const len = Math.max(1.2, Math.min(2.5, seconds, settings.duration ?? 2.4)), gap = settings.gap ?? 6;
  const max = brollCount(duration, { max: busy.length ? settings.maxWithGraphics ?? 2 : settings.max ?? 3, every: settings.every ?? 12 });
  if (!max) return [];
  const candidates = brollCandidates(groups, duration, { hook, cta, len: settings.rapidLists === false ? 1.2 : 0.8, busy, tail, clearStart: settings.clearStart ?? 0 });
  if (!candidates.length) return [];
  const timing = (p, c) => runwayTiming(p, c, groups, { len, until: Math.min(duration - tail, cta?.start ?? Infinity), busy });
  const key = `${PROMPT_VERSION}|${JSON.stringify({ candidates, groups, settings, hook, cta, duration, busy, tail, footage, caption, stillSource })}`;
  const previous = fs.existsSync(planPath) ? readJSON(planPath) : {};
  const reusable = (s) => /\.mp4$/i.test(s.file || "") && s.move === "none" && s.moves?.ok && s.moves.look === "pass" && !s.soundPending && fs.existsSync(s.file) && (!s.sfx || fs.existsSync(s.sfx));
  if (!force && previous.key === key && previous.promptVersion === PROMPT_VERSION && previous.complete && previous.shots?.every(reusable)) { writeBrollCredits(workDir, previous.shots); return previous.shots; }
  const has = deps.hasRunway || hasRunway, claude = deps.claudeText || claudeText, look = deps.claudeLook || claudeLook;
  const make = deps.makeClip || makeClip, animate = deps.animateStill || animateStill, sound = deps.makeSound || makeSound;
  const org = deps.organization || organization, runner = deps.runFn || run;
  if (!(deps.hasClaude || hasClaude)() || !settings.library && !has()) { warn("Runway b-roll needs Runway and Claude; skipped"); return []; }
  const cap = settings.maxCreditsPerReel ?? 300, hard = settings.hardCreditsPerReel ?? 450;
  if (!(cap >= 0) || !(hard >= cap)) throw new Error("Runway budgets require hardCreditsPerReel >= maxCreditsPerReel >= 0");
  const tasks = previous.tasks || [], items = [...(previous.usage || [])], shots = previous.key === key ? (previous.shots || []).filter(reusable) : [];
  const reservations = previous.reservations || {}, attempts = previous.key === key ? previous.attempts || {} : {};
  let picks = previous.key === key ? previous.picks : null, complete = false;
  const namespace = createHash("sha256").update(key).digest("hex").slice(0, 10);
  const save = () => {
    const temporary = `${planPath}.tmp`;
    writeJSON(temporary, { key, promptVersion: PROMPT_VERSION, stillSource, shots, usage: items, tasks, reservations, attempts, picks, complete });
    fs.renameSync(temporary, planPath);
  };
  const journal = { tasks, save };
  const merge = (lines = []) => { for (const line of lines) { const at = line.taskId ? items.findIndex((i) => i.taskId === line.taskId) : -1; if (at < 0) items.push(line); else items[at] = line; } save(); };
  const spent = () => items.filter((i) => !i.taskId || !tasks.some((t) => t.taskId === i.taskId)).reduce((sum, i) => sum + (i.credits || 0), 0) + tasks.reduce((sum, t) => sum + (t.credits ?? t.estimatedCredits ?? 0), 0);
  let balance = null, accountLimit = Infinity, balanceChecked = false;
  const checkBalance = async () => {
    if (balanceChecked) return;
    balanceChecked = true;
    try { balance = (await org()).creditBalance; } catch (e) { warn(`runway: balance unavailable (${e.message})`); }
    accountLimit = balance == null ? Infinity : spent() + Math.max(0, balance - (settings.keepCredits ?? 0));
  };
  const openReserve = (except) => Object.entries(reservations).filter(([id, r]) => id !== except && r.open).reduce((sum, [id, r]) => sum + Math.max(0, r.total - tasks.filter((t) => t.scope === id).reduce((n, t) => n + (t.credits ?? t.estimatedCredits ?? 0), 0)), 0);
  const io = { runFn: runner, fetchFn: deps.fetchFn, sleepFn: deps.sleepFn, journal };
  if (!picks) {
    try {
      const request = { candidates, transcript: groups.map((g) => g.text).join(" "), hook: hook?.text, count: max, spacing: gap, style: settings.style || "", recent: readRecent(), duration: len, world: settings.worldInPrompt ? settings.world || "" : "" };
      const planned = deps.planPicks ? await deps.planPicks(request, dir) : firstJSON(await claude(runwayPicksPrompt(request), { timeoutMs: 240000 })).picks || [];
      picks = validateBrollPicks(planned, candidates, groups, timing, settings);
      save();
    } catch (e) { warn(`b-roll: planning failed (${e.message})`); return []; }
  }
  const placed = placePlannedBroll(picks, candidates, { gap, max, timing });
  let referenceImages;
  for (const [k, s] of placed.entries()) {
    const p = picks.find((p) => p.line === s.line), models = shotModels(p, settings), seed = shotSeed(workDir, s.line);
    const id = `${namespace}-${s.line}`, name = `broll-${k + 1}-${id}`, budget = planShotBudget(p, s.duration, { ...settings, stillSource });
    if (shots.some((shot) => shot.line === s.line)) { if (reservations[id]) reservations[id].open = false; continue; }
    if (settings.library) {
      const reused = await findLibraryClip({ pick: p, shot: s, groups, workDir, dir, deps });
      if (reused) { shots.push(reused); if (reservations[id]) reservations[id].open = false; save(); continue; }
    }
    if (!has()) { warn("b-roll: no library fit and Runway key missing; keeping the speaker"); continue; }
    await checkBalance();
    if (!referenceImages && stillSource === "runway" && footage && (settings.imageModel || "gen4_image") === "nano_banana_2.1") {
      try {
        const reference = path.join(dir, "daylight-reference.jpg");
        await runner("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(placed[0]?.start ?? 0), "-i", footage, "-frames:v", "1", "-vf", "scale=360:-2", reference], { quiet: true });
        referenceImages = [{ uri: dataURI(reference, "image/jpeg"), tag: "daylightlook" }];
      } catch (e) { warn(`b-roll: daylight reference unavailable (${e.message}); keeping the speaker`); continue; }
    }
    const state = attempts[id] ||= { stillAttempt: 0, videoAttempt: 0 };
    if (state.clip && previous.shots?.some((shot) => shot.line === s.line && !reusable(shot))) { state.done = false; reservations[id] = { ...reservations[id], open: true }; }
    const shotIO = { ...io, journal: { ...journal, scope: id } };
    const reservation = reservations[id];
    if (!reservation?.open) {
      if (attempts[id]?.done) continue;
      if (spent() + openReserve() + budget.reserve > Math.min(cap, accountLimit)) { warn(`b-roll: ${p.shows} skipped; complete shot reserve ${budget.reserve} exceeds working budget`); continue; }
      reservations[id] = { total: budget.reserve, spentAtStart: spent(), open: true }; save();
    }
    const beforeBuy = (kind, pending = [], retry = false) => {
      const pendingCost = pending.filter((i) => !i.taskId && !items.includes(i)).reduce((sum, i) => sum + (i.credits || 0), 0);
      const cost = kind === "image" || kind === "endImage" ? budget.image : kind === "sound" ? budget.sound || 0 : state.videoAttempt ? estimateClip({ seconds: state.retrySeconds, videoModel: state.retryModel }).video : budget.video;
      if (spent() + pendingCost + openReserve(id) + cost > Math.min(retry ? hard : cap, accountLimit)) throw Object.assign(new Error("per-reel or account budget exhausted"), { code: "BUDGET" });
    };
    const check = async (png, context = {}) => {
      try {
        const previewDir = fs.mkdtempSync(path.join(dir, "still-check-"));
        const previews = await (deps.phonePreviews || phonePreviews)(png, s, groups, { dir: previewDir, caption, runFn: runner });
        const open = await lookJSON(stillOpenPrompt(path.relative(dir, png)), hasSeen, look, dir);
        state.seen = open.seen;
        const prompt = stillCheckPrompt({ file: path.relative(dir, png), seen: open.seen, pick: p, shot: s, groups }) + `\nPhone previews: ${previews.map((v) => JSON.stringify(path.relative(dir, v.file))).join(", ")}.` + (context.end ? `\nCompare the same subject, camera, daylight and ground plane with ${JSON.stringify(path.relative(dir, context.first))}; this is the ending state ${p.endScene}.` : "");
        const result = await lookJSON(prompt, hasBools(["shows", "dark", "detailReadable", "actionAreaVisible", "captionOcclusion", "subjectLarge"]), look, dir);
        const ok = result.shows && !result.dark && result.detailReadable && result.actionAreaVisible && !result.captionOcclusion && result.subjectLarge;
        writeJSON(path.join(previewDir, "verdict.json"), { ...result, ok, previews });
        state.stillCheck = { ...result, ok }; save();
        return { ok, why: result.why || "subject framing or caption clearance failed" };
      } catch (e) { return { ok: false, unavailable: true, why: "still check unavailable after retry" }; }
    };
    let clip;
    try {
      // The first retry repairs the still; generation recovery reuses journalled tasks.
      clip = state.clip;
      for (; !clip && state.stillAttempt < 2; state.stillAttempt++) {
        save();
        try {
          const correction = state.stillAttempt ? ` Compose a closer, clearly recognizable ${p.shows} above the caption area. Preserve its natural anatomy, shape and surface.` : "";
          const scene = fitPrompt(`${state.stillPolicy?.remedy === "soften" ? "A calm, harmless scene in natural daylight. " : ""}${stillPrompt(p)}${referenceImages ? " Use @daylightlook as a colour and light reference only, not content." : ""}${correction}`);
          clip = await make({ scene, referenceImages, ...(deps.drawStill ? { drawStill: (args) => deps.drawStill({ ...args, pick: p, reason: state.stillCheck?.why, attempt: state.stillAttempt }) } : {}), endScene: models.lastFrame ? stillPrompt({ scene: p.endScene }) : undefined, motion: videoMotion(p), dir, name: `${name}-still${state.stillAttempt}`, ...models, seed, imageRatio: settings.imageRatio, ...shotIO, check, beforeBuy: (kind, pending) => beforeBuy(kind, pending, state.stillAttempt > 0) });
          merge(clip.items); state.clip = clip; save(); break;
        } catch (e) {
          merge(e.items);
          if (e.code === "CHECK" && state.stillAttempt === 0 && (stillSource === "codex" || !state.stillCheck?.dark)) continue;
          if (e.kind === "image" && e.policy?.retry && state.stillAttempt === 0) {
            state.stillPolicy = e.policy;
            if (e.policy.delayMs) await (deps.sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms))))(e.policy.delayMs);
            continue;
          }
          if (e.kind === "video" && e.policy?.retry && e.png) { clip = { png: e.png, last: e.last, failure: e.message, policy: e.policy }; state.clip = clip; save(); break; }
          throw e;
        }
      }
      if (!clip) throw new Error("still rejected twice");
      if (state.pendingVideo) {
        const result = await animate({ ...state.pendingVideo, ...shotIO, beforeBuy: (kind, pending) => beforeBuy(kind, pending, true) });
        merge(result.items); clip = { ...result, png: clip.png, videoModel: state.retryModel };
        state.clip = clip; delete state.pendingVideo; save();
      }
      for (; state.videoAttempt < (settings.retrySameModelFirst === false ? 2 : 3);) {
        save();
        let moves = { ok: false, why: clip.failure || "video missing", policy: clip.policy };
        if (clip.mp4) {
          const fullFile = clip.mp4.replace(/\.mp4$/i, ".full.mp4");
          const full = fs.existsSync(fullFile) ? fullFile : clip.mp4;
          const probe = await runner("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", full], { capture: true });
          const clipDuration = Number(probe.out?.trim());
          clip.sourceDuration = clipDuration;
          if (!(clipDuration > 0)) throw Object.assign(new Error("clip duration unavailable"), { code: "LOCAL_PROCESS" });
          const inspected = await checkRunwayVideo({ file: full, shot: { ...s, duration: clipDuration }, pick: { ...p, kind: models.kind }, groups, dir, threshold: settings.motionThreshold ?? 1, deps });
          if (inspected.unavailable) { state.review = inspected; throw Object.assign(new Error(inspected.why), { code: "CHECK_UNAVAILABLE" }); }
          moves = inspected;
          if (inspected.ok) {
            clip.sourceTimeline = { onset: inspected.onset, contact: inspected.contact, completion: inspected.completion };
            const timeline = models.kind === "action" ? inspected : null;
            try {
              Object.assign(clip, await trimRunwayClip(clip.mp4, s.duration, { runFn: runner, dir, timeline }));
              moves = await checkRunwayVideo({ file: clip.mp4, shot: s, pick: { ...p, kind: models.kind }, groups, dir, inPoint: clip.inPoint, threshold: settings.motionThreshold ?? 1, deps });
            } catch (e) { moves = { ok: false, unavailable: e.code !== "EVENT_WINDOW", why: `local selection unavailable: ${e.message}` }; }
          }
        }
        if (moves.ok && models.kind === "action" && eventInPoint(moves, s.duration, s.duration) === null) moves = { ...moves, ok: false, why: "trimmed event has no readable settle before the cut" };
        state.review = moves; save();
        if (moves.unavailable) throw Object.assign(new Error(moves.why), { code: "CHECK_UNAVAILABLE" });
        if (moves.ok) {
          let sfx, sfxMix;
          if (hasPhysicalSound(p, settings)) {
            try {
              const result = await sound({ file: clip.mp4, out: path.join(dir, `${name}.sfx.wav`), sound: p.sound, seconds: Math.max(1, s.duration), seed, ...shotIO, beforeBuy: (kind, pending) => beforeBuy(kind, pending, state.videoAttempt > 0) });
              merge(result.items);
              sfxMix = await (deps.verifySound || verifySound)(result.sfx, footage, s, moves, groups, { dir: fs.mkdtempSync(path.join(dir, "sound-check-")), runFn: runner, underDb: settings.sfxUnderSpeechDb ?? 12, impact: p.soundRole === "impact" });
              state.soundPending = false;
              if (sfxMix.ok) sfx = result.sfx;
              else warn(`b-roll: sound dropped (${sfxMix.why})`);
            } catch (e) { merge(e.items); state.soundPending = ["TASK_PENDING", "UNKNOWN_SUBMISSION", "OUTPUT_UNAVAILABLE", "LOCAL_PROCESS"].includes(e.code); warn(`b-roll: sound dropped (${e.message})`); }
          }
          shots.push({ ...s, kind: models.kind, seed: state.seed ?? seed, stillSource, imageModel: stillSource === "codex" ? "codex" : models.imageModel, videoModel: clip.videoModel || models.videoModel, file: clip.mp4, full: clip.full, original: clip.original, inPoint: clip.inPoint, still: clip.png, video: true, move: "none", motion: state.motion || videoMotion(p), scene: p.scene, action: p.action || "the subject moves", check: state.stillAttempt ? "retry-pass" : "pass", seen: state.seen, moves, sourceTimeline: clip.sourceTimeline, endsAt: p.endsAt, endsBefore: p.endsBefore, ...(p.endScene ? { endScene: p.endScene } : {}), ...(p.sound ? { sound: p.sound, soundRole: p.soundRole } : {}), ...(clip.last ? { last: clip.last } : {}), ...(state.soundPending ? { soundPending: true } : {}), ...(sfx ? { sfx, sfxMix } : {}) });
          if (settings.library) {
            try {
              const licence = { provider: "runway", taskIds: tasks.filter((t) => t.scope === id).map((t) => t.taskId).filter(Boolean) };
              const accepted = shots.at(-1);
              accepted.licence = licence;
              const saved = saveLibraryClip({ shot: accepted, pick: p, workDir, source: "runway", licence, duration: clip.sourceDuration, env: deps.env, now: (deps.now || Date.now)() });
              if (saved) accepted.libraryId = saved.id;
            } catch { warn("b-roll: approved Runway clip could not be saved to the library"); }
          }
          state.done = true; save(); break;
        }
        if (moves.dark || moves.humanFaces || moves.readableText || moves.local?.ok === false || state.videoAttempt >= (settings.retrySameModelFirst === false ? 1 : 2)) break;
        const retryIndex = state.videoAttempt + 1;
        state.retryModel = settings.retrySameModelFirst !== false && retryIndex === 1 ? models.videoModel : settings.retryVideoModel || models.videoModel;
        const info = modelInfo(state.retryModel, "video");
        state.retrySeconds = Math.max(info.duration[0], Math.min(info.duration[1], models.seconds));
        state.seed = (seed + retryIndex) >>> 0;
        const policy = moves.policy || failurePolicy("");
        if (policy.remedy === "soften" && state.safetyOutputRetries) break;
        if (policy.remedy === "soften") state.safetyOutputRetries = 1;
        if (policy.delayMs) await (deps.sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms))))(policy.delayMs);
        state.motion = videoMotion(p, { retry: true, correction: moves.correction || (moves.defects || []).join("; ") || moves.why, soften: policy.remedy === "soften" });
        // Each retry has its own file and seed. Never overwrite a rejected original.
        state.videoAttempt = retryIndex;
        save();
        state.pendingVideo = { png: clip.png, mp4: path.join(dir, `${name}-retry${retryIndex}.mp4`), last: clip.last, motion: state.motion, seed: state.seed, seconds: state.retrySeconds, videoModel: state.retryModel, audio: false };
        save();
        try {
          const result = await animate({ ...state.pendingVideo, ...shotIO, beforeBuy: (kind, pending) => beforeBuy(kind, pending, true) });
          merge(result.items); clip = { ...result, png: clip.png, videoModel: state.retryModel };
          state.clip = clip; delete state.pendingVideo; save();
        } catch (e) {
          merge(e.items);
          if (!e.policy?.retry) throw e;
          clip = { png: clip.png, last: clip.last, failure: e.message, policy: e.policy };
          state.clip = clip; delete state.pendingVideo; save();
        }
      }
      state.done = !state.soundPending;
      reservations[id].open = !!state.soundPending;
    } catch (e) {
      const held = ["TASK_PENDING", "UNKNOWN_SUBMISSION", "CHECK_UNAVAILABLE", "OUTPUT_UNAVAILABLE", "LOCAL_PROCESS"].includes(e.code) || tasks.some((t) => t.scope === id && ["pending", "unknown", "submitted", "submitting"].includes(t.state));
      state.error = e.message; state.done = !held;
      reservations[id].open = held;
      warn(`b-roll: ${p.shows} ${held ? "held" : "dropped"} (${e.message})`);
    }
    save();
  }
  complete = !Object.values(reservations).some((r) => r.open); save();
  let after = null;
  if (balanceChecked) try { after = (await org()).creditBalance; } catch {}
  const newItems = items.filter((i) => i.taskId || !(previous.usage || []).includes(i));
  try { (deps.recordUsage || recordUsage)({ reel: path.basename(workDir), items: newItems, balance: after }); } catch (e) { warn(`usage ledger: ${e.message}`); }
  fs.writeFileSync(path.join(workDir, "runway usage.txt"), reelUsageNote(items, { balance: after }));
  writeBrollCredits(workDir, shots);
  if (shots.length) rememberScenes(shots.map((s) => s.scene));
  log(`b-roll: ${shots.length} accepted Runway clips, ${spent()} credits`);
  return shots.sort((a, b) => a.start - b.start);
}
